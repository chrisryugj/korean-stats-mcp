/**
 * KOSIS 파일 통계표(엑셀) 다운로드 + 파싱 도구
 *
 * OpenAPI 미지원 통계 (자치구 기본통계 등)는 KOSIS 사이트에 엑셀 파일로만 제공된다.
 * 광진구 기본통계 케이스:
 *   orgId=505, tblId=DT_505001_FILE2024, file_sn=1~14 (Ⅱ.토지·기후 ~ XV.공공행정·사법)
 *
 * 다운로드 3단계 (KOSIS nsibsHtmlSvc 내부 흐름):
 *   1) GET  fileStblView.do?in_org_id=...&in_tbl_id=...   → JSESSIONID 쿠키 + 파일 목록 HTML
 *   2) POST fileItmDownload.do (org_id, tbl_id, file_sn)  → {dwldFilePath, dwldFileNm} JSON
 *   3) POST dwldServerFile.do  (file_path, file_name echo)→ xlsx 바이너리
 *
 * 파싱: kordoc.parse() 가 XLSX → 마크다운 변환 (시트별 표)
 */

import { z } from 'zod';
// kordoc은 optionalDependencies — 원격 배포(Vercel)에서는 함수 사이즈 한도(250MB)
// 때문에 제외됩니다. 로컬 설치에서만 동적으로 로드합니다.
async function loadKordoc(): Promise<((ab: ArrayBuffer) => Promise<any>) | null> {
  try {
    const mod = await import('kordoc' as any);
    return mod.parse as (ab: ArrayBuffer) => Promise<any>;
  } catch {
    return null;
  }
}
import { resolveDistrictFileTable } from '../utils/regions.js';

const KOSIS_HOST = 'https://stat.kosis.kr';
const KOSIS_BASE = `${KOSIS_HOST}/nsibsHtmlSvc/fileView/FileStbl`;

export const fetchKosisExcelSchema = {
  name: 'fetch_kosis_excel',
  description: `KOSIS 사이트의 파일 통계표(엑셀로만 제공)를 다운로드해서 파싱한 마크다운을 반환합니다.

⚠️ 자치구 file 통계표 제공은 광역시도마다 차이:
• **확인된 제공**: 서울 자치구 일부 (광진구 orgId=505, 강남구 orgId=523 등) — DT_{orgId}001_FILE{year} 형식
• **미제공 확인**: 부산 해운대구(539), 대구 수성구(556) 등 비-서울 다수 자치구 — 404 발생
• 비-서울 자치구는 file 통계표 대신 \`get_statistics_data\` 로 OpenAPI 경로 사용 권장:
  - Path A: 광역시도 기본통계 (orgId=202/203, regionName="해운대구"/"수성구")
  - Path B: 자치구 단독 OpenAPI (orgId=539, tblId=DT_53902_B001003 등)
  - Path C: 통계청 e-지방지표 (orgId=101, DT_1YL*)

언제 사용:
• OpenAPI(get_statistics_data) 가 "통계표 없음" 에러를 내고, 해당 자치구가 서울 자치구일 때
• 「작성중지통계」 카테고리 등 파일 형태로만 제공되는 통계

사용 흐름:
1. listOnly=true 로 파일 목록 먼저 조회 → file_sn(1~N) + 파일명(Ⅲ.인구 등) 확인
2. file_sn 지정해서 다시 호출 → 해당 파일을 마크다운으로 반환

광진구 기본통계 예시:
{ orgId: "505", tblId: "DT_505001_FILE2024", listOnly: true }       // 14개 파일 목록
{ orgId: "505", tblId: "DT_505001_FILE2024", fileSn: 3 }             // Ⅲ.인구 파일 파싱

자치구 이름으로 자동 도출 (서울 자치구만 안정적):
{ districtName: "광진구", listOnly: true }                           // orgId/tblId 자동 도출
{ districtName: "강남구", fileSn: 3, year: 2024 }`,
  inputSchema: z.object({
    districtName: z
      .string()
      .optional()
      .describe('자치구·시·군 이름 (예: "광진구", "강남구"). 주어지면 orgId/tblId 자동 도출. 단독 사용 시 orgId/tblId 생략 가능.'),
    year: z.number().int().optional().describe('기준 연도 (예: 2024). districtName 사용시 적용. 기본은 현재 연도-1.'),
    orgId: z.string().optional().describe('파일 통계표 기관 ID (예: "505" = 서울특별시 광진구). districtName 있으면 무시.'),
    tblId: z.string().optional().describe('파일 통계표 ID (예: "DT_505001_FILE2024"). districtName 있으면 무시.'),
    fileSn: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe('파일 일련번호 (1부터). listOnly=true 면 무시.'),
    listOnly: z
      .boolean()
      .optional()
      .default(false)
      .describe('true면 파일 목록만 조회. 어느 file_sn을 받을지 결정할 때 먼저 호출.'),
  }),
};

export type FetchKosisExcelInput = z.infer<typeof fetchKosisExcelSchema.inputSchema>;

interface FileItem {
  file_sn: number;
  file_nm: string;
}

interface ExcelFetchResult {
  success: boolean;
  orgId: string;
  tblId: string;
  files?: FileItem[];
  fileSn?: number;
  fileName?: string;
  markdown?: string;
  fileType?: string;
  byteSize?: number;
  warnings?: string[];
  error?: string;
}

/**
 * Set-Cookie 헤더에서 "JSESSIONID=...; WMONID=...; ..." 형태로 추출
 * Node 20+ fetch는 getSetCookie() 지원. 폴백으로 set-cookie 헤더 단일 split.
 */
function extractCookies(res: Response): string {
  const sc =
    (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.()
    ?? (res.headers.get('set-cookie')?.split(/,(?=\s*[A-Za-z0-9_-]+=)/) ?? []);
  return sc
    .map((c) => c.split(';')[0].trim())
    .filter(Boolean)
    .join('; ');
}

/** 1단계: 파일 통계표 페이지 GET → 쿠키 + HTML */
async function fetchTableView(orgId: string, tblId: string): Promise<{ cookie: string; html: string }> {
  const url = `${KOSIS_BASE}/fileStblView.do?in_org_id=${encodeURIComponent(orgId)}&in_tbl_id=${encodeURIComponent(tblId)}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 korea-stats-mcp',
      'Accept': 'text/html',
    },
  });
  if (!res.ok) throw new Error(`fileStblView.do HTTP ${res.status}`);
  return { cookie: extractCookies(res), html: await res.text() };
}

/**
 * HTML에서 파일 목록 추출
 * KOSIS는 `fn_fileitm_download('N')` 호출과 그 근처(보통 <li>의 텍스트)에 파일명을 둔다.
 *
 * 예시 구조:
 *   <li>
 *     <span class="...">Ⅲ.인구</span>
 *     <a href="javascript:file_prev_obj.fn_fileitm_download('3');">...</a>
 *   </li>
 */
function parseFileList(html: string): FileItem[] {
  const out: FileItem[] = [];
  const seen = new Set<number>();

  // 패턴 A: <li> 단위로 파일명 + sn 한 번에 묶기
  const liRx = /<li\b[^>]*>([\s\S]*?)<\/li>/g;
  let m: RegExpExecArray | null;
  while ((m = liRx.exec(html)) !== null) {
    const block = m[1];
    const snMatch = block.match(/fn_fileitm_download\s*\(\s*['"]?(\d+)['"]?\s*\)/);
    if (!snMatch) continue;
    const sn = parseInt(snMatch[1], 10);
    if (seen.has(sn)) continue;
    // 파일명 = li 안의 텍스트에서 태그·script 제거 후 가장 긴 의미있는 줄
    const text = block
      .replace(/<script[\s\S]*?<\/script>/g, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) continue;
    seen.add(sn);
    out.push({ file_sn: sn, file_nm: text.length > 80 ? text.slice(0, 80) + '…' : text });
  }

  // 패턴 B: <li>로 못 잡았으면 함수 호출만이라도 추출
  if (out.length === 0) {
    const rx = /fn_fileitm_download\s*\(\s*['"]?(\d+)['"]?\s*\)/g;
    while ((m = rx.exec(html)) !== null) {
      const sn = parseInt(m[1], 10);
      if (seen.has(sn)) continue;
      seen.add(sn);
      out.push({ file_sn: sn, file_nm: `file_sn=${sn}` });
    }
  }

  out.sort((a, b) => a.file_sn - b.file_sn);
  return out;
}

/** 2단계: fileItmDownload.do POST → {dwldFilePath, dwldFileNm} */
async function fetchDownloadInfo(
  orgId: string,
  tblId: string,
  fileSn: number,
  cookie: string
): Promise<{ dwldFilePath: string; dwldFileNm: string; dwldFileSize?: number }> {
  const url = `${KOSIS_BASE}/fileItmDownload.do`;
  const body = new URLSearchParams({
    vw_cd: 'NULL',
    list_id: 'NULL',
    org_id: orgId,
    tbl_id: tblId,
    file_svc: '',
    file_sn: String(fileSn),
    conn_path: '',
  });
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'User-Agent': 'Mozilla/5.0 korea-stats-mcp',
      'Cookie': cookie,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
    },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`fileItmDownload.do HTTP ${res.status}`);
  const json = (await res.json()) as {
    resultMap?: { dwldFilePath?: string; dwldFileNm?: string; dwldFileSize?: number; srvcNm?: string };
    dwldFilePath?: string;
    dwldFileNm?: string;
    dwldFileSize?: number;
  };
  // 응답 형식: { resultMap: { dwldFilePath, dwldFileNm, dwldFileSize }, baseinfo, success }
  // 일부 응답은 최상위에 직접 둘 수 있으므로 양쪽 모두 확인
  const path = json.resultMap?.dwldFilePath ?? json.dwldFilePath;
  const name = json.resultMap?.dwldFileNm ?? json.dwldFileNm;
  const size = json.resultMap?.dwldFileSize ?? json.dwldFileSize;
  if (!path || !name) {
    throw new Error(`fileItmDownload.do 응답 누락: ${JSON.stringify(json).slice(0, 300)}`);
  }
  return { dwldFilePath: path, dwldFileNm: name, dwldFileSize: size };
}

/** 3단계: dwldServerFile.do POST → 실제 xlsx 바이너리 */
async function downloadFile(
  orgId: string,
  tblId: string,
  fileSn: number,
  info: { dwldFilePath: string; dwldFileNm: string },
  cookie: string
): Promise<ArrayBuffer> {
  const url = `${KOSIS_BASE}/dwldServerFile.do`;
  const body = new URLSearchParams({
    org_id: orgId,
    tbl_id: tblId,
    file_sn: String(fileSn),
    img_yn: '',
    fileSvc: '',
    file_path: info.dwldFilePath,
    file_name: info.dwldFileNm,
  });
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'User-Agent': 'Mozilla/5.0 korea-stats-mcp',
      'Cookie': cookie,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/octet-stream,*/*',
    },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`dwldServerFile.do HTTP ${res.status}`);
  return res.arrayBuffer();
}

export async function fetchKosisExcel(input: FetchKosisExcelInput): Promise<ExcelFetchResult> {
  try {
    // districtName 우선 — 자동 도출
    let orgId = input.orgId;
    let tblId = input.tblId;
    let tblIdCandidates: string[] = tblId ? [tblId] : [];

    if (input.districtName) {
      const resolved = await resolveDistrictFileTable(input.districtName, input.year);
      if (!resolved) {
        return {
          success: false,
          orgId: orgId ?? '',
          tblId: tblId ?? '',
          error: `자치구 "${input.districtName}" 의 파일통계표를 도출할 수 없습니다. 광역시도 매핑(DISTRICT_TO_PROVINCE)에 있는지 확인하세요.`,
        };
      }
      orgId = resolved.orgId;
      tblId = resolved.tblId;
      tblIdCandidates = resolved.tblIdCandidates;
    }

    if (!orgId || !tblId) {
      return {
        success: false,
        orgId: orgId ?? '',
        tblId: tblId ?? '',
        error: 'orgId·tblId 또는 districtName 중 하나는 반드시 지정해야 합니다.',
      };
    }

    // 1단계 — 페이지 GET (쿠키 + 파일 목록). year 후보 순회 (currentYear-1 → -2 → -3).
    let cookie: string | undefined;
    let html: string | undefined;
    let pickedTblId = tblId;
    const tried: string[] = [];
    for (const candidate of tblIdCandidates) {
      tried.push(candidate);
      try {
        const res = await fetchTableView(orgId, candidate);
        cookie = res.cookie;
        html = res.html;
        pickedTblId = candidate;
        break;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('HTTP 404')) continue;
        throw e;
      }
    }
    tblId = pickedTblId;
    if (!cookie || !html) {
      // 모든 후보 404 — 해당 자치구는 KOSIS file 통계표 미제공
      const dn = input.districtName ?? '';
      return {
        success: false,
        orgId,
        tblId,
        error: `KOSIS 파일 통계표 미제공: ${dn ? `자치구 "${dn}"` : `orgId=${orgId}`} 에 해당하는 파일 통계표가 KOSIS 사이트에 없습니다.

시도한 tblId: ${tried.join(', ')}

대안 (OpenAPI 경로) — get_statistics_data 사용:
• Path A — 광역시도 기본통계: 해당 광역시도(예: 부산=202, 대구=203)의 구·군별 표 (DT_202, DT_B40001 등)에 regionName 지정
• Path B — 자치구 단독 OpenAPI: orgId=${orgId} tblId 시리즈 (DT_${orgId}xx_<chapter><nnnnnn> 형식)를 search_statistics 로 검색
• Path C — 통계청 e-지방지표 (orgId=101, DT_1YL*) 에 regionName 지정

자치구별 file 통계표 제공 확정 자치구: 서울 25개 자치구 일부 (광진구 505, 강남구 523 등)`,
      };
    }
    const files = parseFileList(html);

    if (input.listOnly || !input.fileSn) {
      return {
        success: true,
        orgId,
        tblId,
        files,
        warnings: files.length === 0 ? ['파일 목록 파싱 실패 — file_sn=1부터 직접 시도해보세요.'] : undefined,
      };
    }

    const fileMeta = files.find((f) => f.file_sn === input.fileSn);

    // 2단계 — 다운로드 정보
    const info = await fetchDownloadInfo(orgId, tblId, input.fileSn, cookie);

    // 3단계 — 실제 파일
    const ab = await downloadFile(orgId, tblId, input.fileSn, info, cookie);

    // 매직바이트 확인 (xlsx = PK\x03\x04)
    const head = new Uint8Array(ab.slice(0, 4));
    if (!(head[0] === 0x50 && head[1] === 0x4b)) {
      const decoder = new TextDecoder('utf-8', { fatal: false });
      const snippet = decoder.decode(ab.slice(0, 500));
      return {
        success: false,
        orgId,
        tblId,
        fileSn: input.fileSn,
        fileName: fileMeta?.file_nm ?? info.dwldFileNm,
        byteSize: ab.byteLength,
        error: `XLSX가 아닌 응답 (${ab.byteLength}B): ${snippet.slice(0, 300)}`,
      };
    }

    // kordoc 파싱 (XLSX → 마크다운). 원격 배포에선 미설치라 안내 후 종료.
    const parse = await loadKordoc();
    if (!parse) {
      return {
        success: false,
        orgId,
        tblId,
        fileSn: input.fileSn,
        fileName: fileMeta?.file_nm ?? info.dwldFileNm,
        byteSize: ab.byteLength,
        error: 'kordoc 모듈이 설치돼 있지 않습니다. 자치구 .xlsx 파일 파싱은 로컬 설치(pnpm install)에서만 지원됩니다. 원격 MCP에서는 search_statistics / get_statistics_data 사용.',
      };
    }
    const result = await parse(ab);

    if (!result.success) {
      return {
        success: false,
        orgId,
        tblId,
        fileSn: input.fileSn,
        fileName: fileMeta?.file_nm ?? info.dwldFileNm,
        byteSize: ab.byteLength,
        error: `kordoc 파싱 실패: ${result.error ?? '알 수 없음'} (code=${result.code ?? '?'})`,
      };
    }

    return {
      success: true,
      orgId,
      tblId,
      fileSn: input.fileSn,
      fileName: fileMeta?.file_nm ?? info.dwldFileNm,
      fileType: result.fileType,
      byteSize: ab.byteLength,
      markdown: result.markdown,
      warnings: result.warnings?.map((w: { message: string }) => w.message),
    };
  } catch (e) {
    return {
      success: false,
      orgId: input.orgId ?? '',
      tblId: input.tblId ?? '',
      fileSn: input.fileSn,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
