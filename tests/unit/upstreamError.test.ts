/**
 * 업스트림 장애 → MCP isError 회귀 (chrisryugj/gomdori-mcp#4)
 *
 * 2026-10-03 프로덕션(도쿄 머신)에서 KOSIS TCP 443 연결이 시간 초과됐을 때 quick_stats 는 본문 JSON 에
 * success=false 만 넣고 MCP isError 없이 정상 도구 결과로 나갔고, 연결 오류 코드도 사라졌다.
 * 실 네트워크 없이 fetch 에 undici 연결 시간 초과를 주입하고, MCP 클라이언트로 도구를 호출해 확인한다.
 */
import { inspect } from 'node:util';
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';

// config 는 import 시점에 KOSIS_API_KEY 를 읽는다 — 가짜 키를 먼저 심고, 응답·로그로 새지 않는지 본다
const env = vi.hoisted(() => {
  const original = process.env.KOSIS_API_KEY;
  const apiKey = 'TEST-KOSIS-KEY-must-not-leak';
  process.env.KOSIS_API_KEY = apiKey;
  return { original, apiKey };
});

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../../src/server.js';
import { getCacheManager } from '../../src/cache/index.js';
import { invalidateDistrictKscdCache } from '../../src/utils/districtKosisCodes.js';
import { toUpstreamError } from '../../src/utils/errorHandler.js';

const API_KEY = env.apiKey;
// 캐시 싱글톤은 실제 타이머로 먼저 만든다 (10분 주기 청소 setInterval 이 가짜 시계에 걸리지 않게)
const cache = getCacheManager();
const fetchMock = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>();

const withCode = <E extends Error>(err: E, code: string) => Object.assign(err, { code });
const fetchFailed = (cause: Error) => new TypeError('fetch failed', { cause });

/** undici 가 TCP 연결 시간 초과 때 던지는 모양 그대로 (Node 26 실측: TypeError('fetch failed') + cause ConnectTimeoutError) */
function connectTimeout(): TypeError {
  const cause = withCode(
    new Error('Connect Timeout Error (attempted address: kosis.kr:443, timeout: 10000ms)'),
    'UND_ERR_CONNECT_TIMEOUT'
  );
  cause.name = 'ConnectTimeoutError';
  return fetchFailed(cause);
}

/** 헤더는 받았는데 본문을 받다가 끊긴 응답 — 본문 읽기가 reason 으로 실패한다 */
const brokenBody = (reason: unknown) =>
  new Response(new ReadableStream({ pull(controller) { controller.error(reason); } }), { status: 200 });
/** undici: 본문 수신 중 소켓이 닫히면 TypeError('terminated') + cause SocketError UND_ERR_SOCKET */
const socketClosed = () => new TypeError('terminated', { cause: withCode(new Error('other side closed'), 'UND_ERR_SOCKET') });

let client: Client;
let closeAll: () => Promise<void>;

beforeEach(async () => {
  cache.flush();
  invalidateDistrictKscdCache();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const server = createServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  client = new Client({ name: 'upstream-test', version: '0.0.0' });
  await client.connect(clientTransport);
  closeAll = async () => {
    await client.close();
    await server.close();
  };
  // KOSIS 재시도 백오프(800ms·1600ms)는 가짜 시계로 넘긴다
  vi.useFakeTimers();
});

afterEach(async () => {
  vi.useRealTimers();
  const logged = vi.mocked(console.error).mock.calls.map((args) => args.map((a) => inspect(a, { depth: 8 })).join(' '));
  await closeAll();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  // 서버 로그(stderr)에도 API 키가 새지 않는다
  for (const line of logged) expect(line).not.toContain(API_KEY);
});

afterAll(() => {
  if (env.original === undefined) delete process.env.KOSIS_API_KEY;
  else process.env.KOSIS_API_KEY = env.original;
});

async function call(name: string, args: Record<string, unknown>) {
  const pending = client.callTool({ name, arguments: args });
  // 재시도 2회 대기(2.4s) × 체인 동시성(8) 두 바퀴까지 넉넉히
  await vi.advanceTimersByTimeAsync(10_000);
  const res = await pending;
  const text = (res.content as Array<{ type: string; text: string }>)[0].text;
  return { isError: res.isError, text, body: JSON.parse(text) };
}

function expectMaskedUpstream(r: Awaited<ReturnType<typeof call>>, code: string, host: string) {
  expect(r.isError).toBe(true);
  expect(r.body.success).toBe(false);
  expect(r.body.upstream).toEqual({ code, host });
  // 원인 코드와 호스트 이름만 — 키·URL·쿼리스트링·원본 오류 메시지는 싣지 않는다
  expect(r.text).not.toContain(API_KEY);
  expect(r.text).not.toMatch(/apiKey|https?:\/\/|\.do\b|attempted address/);
}

describe('업스트림 장애는 isError=true + 마스킹된 원인', () => {
  it('quick_stats 재현 입력 — TCP 443 연결 시간 초과', async () => {
    fetchMock.mockImplementation(async () => {
      throw connectTimeout();
    });
    const r = await call('quick_stats', { query: '인구', region: '서울', year: 2024 });
    expectMaskedUpstream(r, 'UND_ERR_CONNECT_TIMEOUT', 'kosis.kr');
    expect(fetchMock).toHaveBeenCalledTimes(3); // 3회 시도 뒤 실패
    // 요청 URL 에는 키가 실려 있었다 — 응답에 없는 건 마스킹 덕분
    expect(String(fetchMock.mock.calls[0][0])).toContain(API_KEY);
  });

  const kosisErr = (err: string, errMsg: string) => async () => Response.json({ err, errMsg });

  // calls: 네트워크·시간 초과·5xx·비 JSON 은 3회 재시도, HTTP 4xx·KOSIS 오류 코드는 1회 (재시도 무의미)
  it.each<{ label: string; respond: () => Promise<Response>; code: string; calls: number }>([
    {
      label: 'ECONNRESET',
      respond: async () => { throw fetchFailed(withCode(new Error('read ECONNRESET'), 'ECONNRESET')); },
      code: 'ECONNRESET',
      calls: 3,
    },
    {
      label: 'DNS 실패',
      respond: async () => { throw fetchFailed(withCode(new Error('getaddrinfo ENOTFOUND kosis.kr'), 'ENOTFOUND')); },
      code: 'ENOTFOUND',
      calls: 3,
    },
    {
      label: '듀얼스택 연결 시간 초과(AggregateError)',
      respond: async () => {
        const each = withCode(new Error('connect ETIMEDOUT 203.0.113.7:443'), 'ETIMEDOUT');
        throw fetchFailed(withCode(new AggregateError([each], ''), 'ETIMEDOUT'));
      },
      code: 'ETIMEDOUT',
      calls: 3,
    },
    {
      label: '자체 15초 시간 초과(abort)',
      respond: async () => { throw new DOMException('This operation was aborted', 'AbortError'); },
      code: 'TIMEOUT',
      calls: 3,
    },
    { label: 'HTTP 503', respond: async () => new Response('Service Unavailable', { status: 503 }), code: 'HTTP_503', calls: 3 },
    { label: 'HTTP 403', respond: async () => new Response('Forbidden', { status: 403 }), code: 'HTTP_403', calls: 1 },
    { label: 'KOSIS err 10 인증키 누락', respond: kosisErr('10', '인증KEY가 누락되었습니다.'), code: 'KOSIS_ERR_10', calls: 1 },
    { label: 'KOSIS err 11 인증키', respond: kosisErr('11', '유효하지않은 인증KEY입니다.'), code: 'KOSIS_ERR_11', calls: 1 },
    { label: 'KOSIS err 40 호출가능건수 제한', respond: kosisErr('40', '호출가능건수 제한'), code: 'KOSIS_ERR_40', calls: 1 },
    { label: 'KOSIS err 41 호출가능ROW수 제한', respond: kosisErr('41', '호출가능ROW수 제한'), code: 'KOSIS_ERR_41', calls: 1 },
    { label: 'KOSIS err 42 사용자별 이용 제한', respond: kosisErr('42', '사용자별 이용 제한'), code: 'KOSIS_ERR_42', calls: 1 },
    { label: 'KOSIS err 50 서버오류', respond: kosisErr('50', '서버오류'), code: 'KOSIS_ERR_50', calls: 1 },
    {
      label: '비 JSON 응답(점검 페이지)',
      respond: async () => new Response('<html>시스템 점검 중</html>', { status: 200 }),
      code: 'INVALID_JSON',
      calls: 3,
    },
  ])('$label → $code', async ({ respond, code, calls }) => {
    fetchMock.mockImplementation(respond);
    expectMaskedUpstream(await call('quick_stats', { query: '인구', region: '서울', year: 2024 }), code, 'kosis.kr');
    expect(fetchMock).toHaveBeenCalledTimes(calls);
  });

  it('원인 코드가 식별자 모양이 아니면 버린다 (메시지·URL 유입 차단)', () => {
    const err = new TypeError('fetch failed', { cause: { code: `https://kosis.kr/openapi?apiKey=${API_KEY}` } });
    expect(toUpstreamError(err, 'kosis.kr')).toMatchObject({ code: 'NETWORK_ERROR', host: 'kosis.kr' });
  });
});

describe('KOSIS·외부 API 를 부르는 모든 도구', () => {
  const CASES: Array<[string, Record<string, unknown>, string]> = [
    ['search_statistics', { query: '인구' }, 'kosis.kr'],
    ['get_statistics_list', { viewCode: 'MT_ZTITLE' }, 'kosis.kr'],
    ['get_statistics_list', { viewCode: 'MT_ZTITLE', recommendedTopic: 'population', limit: 10 }, 'kosis.kr'],
    ['get_statistics_data', { orgId: '101', tableId: 'DT_1B040A3', objL1: '00', itemId: 'T20', periodType: 'Y' }, 'kosis.kr'],
    ['compare_statistics', { orgId: '101', tableId: 'DT_1B040A3', compareType: 'item', periodType: 'Y' }, 'kosis.kr'],
    ['analyze_time_series', { orgId: '101', tableId: 'DT_1B040A3', objL1: '00', itemId: 'T20', periodType: 'Y' }, 'kosis.kr'],
    ['get_table_info', { orgId: '101', tableId: 'DT_1B040A3' }, 'kosis.kr'],
    ['quick_stats', { query: '인구', region: '서울', year: 2024 }, 'kosis.kr'],
    ['quick_trend', { keyword: '인구', region: '서울' }, 'kosis.kr'],
    ['quick_rank', { keyword: '인구', region: '서울' }, 'kosis.kr'],
    ['quick_rank', { keyword: '인구', region: '광진구' }, 'kosis.kr'],
    ['explain_statistic', { keyword: '출산율' }, 'kosis.kr'],
    ['fetch_kosis_excel', { orgId: '505', tblId: 'DT_505001_FILE2024', fileSn: 2 }, 'stat.kosis.kr'],
    ['fetch_kosis_excel', { districtName: '광진구', keyword: '인구' }, 'kosis.kr'],
    ['chain_region_brief', { region: '서울' }, 'kosis.kr'],
    ['chain_compare_regions', { regions: ['서울', '부산'], keywords: ['인구'] }, 'kosis.kr'],
    ['chain_policy_indicator', { domain: 'aging' }, 'kosis.kr'],
  ];

  it('등록된 도구 전부가 아래 표에 있다 (새 도구가 빠지지 않게)', async () => {
    const { tools } = await client.listTools();
    expect(new Set(tools.map((t) => t.name))).toEqual(new Set(CASES.map(([name]) => name)));
  });

  it.each(CASES)('%s %j', async (name, args, host) => {
    fetchMock.mockImplementation(async () => {
      throw connectTimeout();
    });
    expectMaskedUpstream(await call(name, args), 'UND_ERR_CONNECT_TIMEOUT', host);
  });
});

describe('성공·0건·요청 문제는 종전처럼 isError 아님', () => {
  it('quick_stats 정상 응답', async () => {
    fetchMock.mockImplementation(async () => Response.json([{ PRD_DE: '2024', DT: '9331828', LST_CHN_DE: '2025-01-15' }]));
    const r = await call('quick_stats', { query: '인구', region: '서울', year: 2024 });
    expect(r.isError).toBeFalsy();
    expect(r.body.success).toBe(true);
    expect(r.body.answer).toContain('9,331,828');
    expect(r.body.upstream).toBeUndefined();
  });

  it.each<[string, () => Promise<Response>]>([
    ['KOSIS err 30 조회결과 없음', async () => Response.json({ err: '30', errMsg: '데이터가 존재하지 않습니다.' })],
    ['빈 배열', async () => Response.json([])],
  ])('quick_stats 0건 (%s)', async (_label, respond) => {
    fetchMock.mockImplementation(respond);
    const r = await call('quick_stats', { query: '인구', region: '서울', year: 2024 });
    expect(r.isError).toBeFalsy();
    expect(r.body.success).toBe(false);
    expect(r.body.answer).toContain('찾을 수 없습니다');
    expect(r.body.upstream).toBeUndefined();
  });

  it('search_statistics 0건', async () => {
    fetchMock.mockImplementation(async () => Response.json([]));
    const r = await call('search_statistics', { query: 'zzz없는통계표' });
    expect(r.isError).toBeFalsy();
    expect(r.body).toMatchObject({ success: true, totalCount: 0, results: [] });
  });

  it('미지원 키워드는 요청 없이 안내한다', async () => {
    const r = await call('quick_stats', { query: 'zzz' });
    expect(r.isError).toBeFalsy();
    expect(r.body.success).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fetch_kosis_excel 404 는 "파일 통계표 미제공" 안내 (장애 아님)', async () => {
    fetchMock.mockImplementation(async () => new Response('Not Found', { status: 404 }));
    const r = await call('fetch_kosis_excel', { orgId: '505', tblId: 'DT_505001_FILE2024', fileSn: 2 });
    expect(r.isError).toBeFalsy();
    expect(r.body.success).toBe(false);
    expect(r.body.error).toContain('미제공');
  });

  it('explain_statistic — 통계설명 KOSIS 오류 응답은 종전처럼 표 메타 기반 각주로 degrade', async () => {
    fetchMock.mockImplementation(async (input) => {
      if (new URL(String(input)).pathname.endsWith('/statisticsExplData.do')) {
        return Response.json({ err: '30', errMsg: '데이터가 존재하지 않습니다.' });
      }
      return Response.json([{ TBL_NM: '합계출산율', ORG_NM: '국가데이터처' }]);
    });
    const r = await call('explain_statistic', { keyword: '출산율' });
    expect(r.isError).toBeFalsy();
    expect(r.body.success).toBe(true);
    expect(r.body.citation).toContain('합계출산율');
  });
});

describe('부분 장애', () => {
  it('chain_compare_regions — 한 지역만 장애면 부분 결과를 주고 실패 칸에 원인을 남긴다', async () => {
    fetchMock.mockImplementation(async (input) => {
      if (new URL(String(input)).searchParams.get('objL1') === '11') {
        return Response.json([{ PRD_DE: '2025', DT: '9331828' }]);
      }
      throw connectTimeout();
    });
    const r = await call('chain_compare_regions', { regions: ['서울', '부산'], keywords: ['인구'] });
    expect(r.isError).toBeFalsy();
    const cellOf = (region: string) =>
      r.body.matrix.find((m: { region: string }) => m.region === region).cells[0];
    expect(cellOf('서울')).toMatchObject({ success: true });
    expect(cellOf('서울').upstream).toBeUndefined();
    expect(cellOf('부산')).toMatchObject({
      success: false,
      upstream: { code: 'UND_ERR_CONNECT_TIMEOUT', host: 'kosis.kr' },
    });
    expect(r.text).not.toContain(API_KEY);
  });
});

// 광역(서울) 값은 받아지는 상황에서 자치구 경로 하나만 장애가 나도, 장애를 삼키면
// "광진구 단위 … 데이터는 KOSIS 자치구 통계에 수록돼 있지 않습니다. 참고로 상위 지역 서울의 …" 가 성공으로 나간다.
// 경로마다 다른 경로는 장애가 아니게(빈 목록 등) 막아 두어, 각 재throw 가 빠지면 그 테스트가 실패하게 한다.
describe('quick_stats 자치구 — 연결 장애를 "자치구 미수록" 안내로 둔갑시키지 않는다', () => {
  const SEOUL_ROW = [{ PRD_DE: '2025', DT: '9331828' }];
  const pathOf = (input: unknown) => new URL(String(input)).pathname;
  const objL1Of = (input: unknown) => new URL(String(input)).searchParams.get('objL1');

  async function expectNoFalseDistrictAnswer(query: string, code: string, host: string) {
    const r = await call('quick_stats', { query });
    expectMaskedUpstream(r, code, host);
    expect(r.text).not.toMatch(/수록돼 있지 않습니다|미수록/);
  }

  it('OpenAPI 경로 — 자치구 코드(메타) 조회 장애', async () => {
    fetchMock.mockImplementation(async (input) => {
      if (pathOf(input).endsWith('/statisticsParameterData.do') && objL1Of(input) === '11') return Response.json(SEOUL_ROW);
      if (pathOf(input).endsWith('/statisticsList.do')) return Response.json([]); // 통계연보 경로는 장애 아닌 '도출 불가'
      throw connectTimeout();
    });
    await expectNoFalseDistrictAnswer('광진구 인구', 'UND_ERR_CONNECT_TIMEOUT', 'kosis.kr');
  });

  it('OpenAPI 경로 — 메타는 받았지만 광진구 데이터 호출 장애', async () => {
    fetchMock.mockImplementation(async (input) => {
      const path = pathOf(input);
      if (path.endsWith('/statisticsData.do')) {
        return Response.json([
          { OBJ_ID: 'A', ITM_ID: '11', ITM_NM: '서울특별시', UP_ITM_ID: '' },
          { OBJ_ID: 'A', ITM_ID: '11215', ITM_NM: '광진구', UP_ITM_ID: '11' },
        ]);
      }
      if (path.endsWith('/statisticsList.do')) return Response.json([]);
      if (path.endsWith('/statisticsParameterData.do') && objL1Of(input) === '11') return Response.json(SEOUL_ROW);
      throw connectTimeout(); // objL1=11215 (광진구)
    });
    await expectNoFalseDistrictAnswer('광진구 인구', 'UND_ERR_CONNECT_TIMEOUT', 'kosis.kr');
    // 메타 단계에서 끝난 게 아니라 광진구 코드로 데이터 호출까지 갔다
    expect(fetchMock.mock.calls.some(([input]) => objL1Of(input) === '11215')).toBe(true);
  });

  // '임금'은 OpenAPI 자치구 라우트가 없어 통계연보(.xlsx) 경로만 탄다
  it('통계연보 경로 — 자치구 목록(kosis.kr) 연결 장애', async () => {
    fetchMock.mockImplementation(async (input) => {
      if (pathOf(input).endsWith('/statisticsParameterData.do')) return Response.json(SEOUL_ROW);
      throw connectTimeout();
    });
    await expectNoFalseDistrictAnswer('광진구 임금', 'UND_ERR_CONNECT_TIMEOUT', 'kosis.kr');
  });

  it('통계연보 경로 — 파일 목록(stat.kosis.kr) 본문 수신 중 끊김', async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/statisticsList.do')) {
        return url.searchParams.get('parentListId') === '201'
          ? Response.json([{ LIST_NM: '광진구', LIST_ID: '201_201A_505' }])
          : Response.json([{ LIST_NM: '서울특별시광진구기본통계', LIST_ID: '201_201A_505_50501' }]);
      }
      if (url.pathname.endsWith('/fileStblView.do')) return brokenBody(socketClosed());
      if (url.pathname.endsWith('/statisticsParameterData.do')) return Response.json(SEOUL_ROW);
      throw connectTimeout();
    });
    await expectNoFalseDistrictAnswer('광진구 임금', 'UND_ERR_SOCKET', 'stat.kosis.kr');
  });
});

describe('fetch_kosis_excel — stat.kosis.kr 단계별 HTTP 오류·본문 수신 중 장애', () => {
  const page = () => new Response('<html></html>', { status: 200, headers: { 'set-cookie': 'JSESSIONID=abc; Path=/' } });
  const info = () => Response.json({ resultMap: { dwldFilePath: '/p/', dwldFileNm: 'x.xlsx', srvcNm: 'x.xlsx' } });
  const timedOut = () => new DOMException('The operation was aborted due to timeout', 'TimeoutError');

  it.each<{ label: string; view?: () => Response; itm?: () => Response; file?: () => Response; code: string }>([
    { label: '파일 목록 HTTP 503', view: () => new Response('', { status: 503 }), code: 'HTTP_503' },
    { label: '다운로드 정보 HTTP 500', itm: () => new Response('', { status: 500 }), code: 'HTTP_500' },
    { label: '파일 다운로드 HTTP 502', file: () => new Response('', { status: 502 }), code: 'HTTP_502' },
    { label: '파일 목록 본문 수신 중 끊김', view: () => brokenBody(socketClosed()), code: 'UND_ERR_SOCKET' },
    { label: '다운로드 정보 본문 수신 중 끊김', itm: () => brokenBody(socketClosed()), code: 'UND_ERR_SOCKET' },
    { label: '파일 본문 수신 중 15초 시간 초과', file: () => brokenBody(timedOut()), code: 'TIMEOUT' },
  ])('$label → $code', async ({ view, itm, file, code }) => {
    fetchMock.mockImplementation(async (input) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith('/fileStblView.do')) return (view ?? page)();
      if (path.endsWith('/fileItmDownload.do')) return (itm ?? info)();
      return (file ?? (() => new Response('unexpected')))();
    });
    const r = await call('fetch_kosis_excel', { orgId: '505', tblId: 'DT_505001_FILE2024', fileSn: 2 });
    expectMaskedUpstream(r, code, 'stat.kosis.kr');
  });
});
