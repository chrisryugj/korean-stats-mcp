/**
 * 엣지케이스 시뮬레이션 — 실제 자연어 질의를 quickStats/quickTrend에 던지고 결과 검증
 *
 * 분류:
 *  [정상]    expected: 'ok'  — 데이터가 와야 함
 *  [엣지]    expected: 'edge' — 명세상 실패해야 함 (지원되지 않는 지역/주기 등)
 *  [회색지대] expected: 'gray' — 사용자 자연어로 자주 들어오지만 처리 모호한 케이스
 */
import { quickStats } from '../dist/tools/quickStats.js';
import { quickTrend } from '../dist/tools/quickTrend.js';

const CASES = [
  // ─── 정상 기본 케이스 ───
  { id: 'pop-basic',       q: { query: '인구' },                                       expect: 'ok' },
  { id: 'pop-region',      q: { query: '서울 인구' },                                  expect: 'ok' },
  { id: 'pop-year',        q: { query: '인구', year: 2020 },                           expect: 'ok' },
  { id: 'unemp-basic',     q: { query: '실업률' },                                     expect: 'ok' },
  { id: 'gdp',             q: { query: 'GDP' },                                        expect: 'ok' },
  { id: 'fertility',       q: { query: '출산율' },                                     expect: 'ok' },
  { id: 'apt-region',      q: { query: '서울 아파트가격' },                            expect: 'ok' },
  { id: 'jeonse',          q: { query: '경기 전세가격' },                              expect: 'ok' },
  { id: 'grdp',            q: { query: '경기 GRDP' },                                  expect: 'ok' },
  { id: 'pm25',            q: { query: '서울 미세먼지' },                              expect: 'ok' },
  { id: 'crime',           q: { query: '부산 범죄율' },                                expect: 'ok' },
  { id: 'doctor',          q: { query: '서울 의사수' },                                expect: 'ok' },
  { id: 'tourist',         q: { query: '외래관광객' },                                 expect: 'ok' },

  // ─── 월별/분기별 ───
  { id: 'birth-monthly',   q: { query: '출생아수', year: 2024, month: 10, period: 'M' }, expect: 'ok' },
  { id: 'death-quarterly', q: { query: '사망자수', year: 2024, quarter: 3, period: 'Q' }, expect: 'ok' },

  // ─── 추세 ───
  { id: 'trend-fertility', t: 'trend', q: { query: '출산율', years: 10 },              expect: 'ok' },

  // ─── 엣지: 지원하지 않는 키워드 ───
  { id: 'unknown-keyword', q: { query: '암호화폐 거래량' },                            expect: 'edge' },
  { id: 'typo',            q: { query: '실업율' },                                     expect: 'edge' },  // '률'이 맞음

  // ─── 엣지: 지역 미지원 통계에 지역 ───
  { id: 'region-unsupported', q: { query: '서울 GDP' },                                expect: 'edge' },  // GDP는 전국만

  // ─── 회색지대: 자연어 그대로 ───
  { id: 'nl-trend',        q: { query: '인구감소 추세' },                              expect: 'gray' },
  { id: 'nl-region-full',  q: { query: '서울특별시 인구' },                            expect: 'gray' },
  { id: 'nl-fullword',     q: { query: '경기도 인구' },                                expect: 'gray' },
  { id: 'nl-province-jeju',q: { query: '제주도 인구' },                                expect: 'gray' },
  { id: 'nl-english',      q: { query: 'population' },                                 expect: 'gray' },
  { id: 'nl-future-year',  q: { query: '인구', year: 2030 },                           expect: 'gray' },
  { id: 'nl-old-year',     q: { query: 'GDP', year: 1960 },                            expect: 'gray' },
  { id: 'nl-empty',        q: { query: '' },                                           expect: 'gray' },
  { id: 'nl-whitespace',   q: { query: '   ' },                                        expect: 'gray' },
  { id: 'nl-only-region',  q: { query: '서울' },                                       expect: 'gray' },
  { id: 'nl-only-year',    q: { query: '2024년' },                                     expect: 'gray' },

  // ─── 자치구: ec7667a 커밋의 Path A/B/C ───
  { id: 'district-gwangjin',  q: { query: '광진구 인구' },                             expect: 'gray' },
  { id: 'district-gangnam',   q: { query: '강남구 인구' },                             expect: 'gray' },
  { id: 'district-haeundae',  q: { query: '해운대구 인구' },                           expect: 'gray' },

  // ─── 모호: 같은 이름 자치구 (남구) ───
  { id: 'ambiguous-namgu',  q: { query: '남구 인구' },                                 expect: 'gray' },

  // ─── 주기 미스매치 ───
  { id: 'period-mismatch',  q: { query: 'GDP', period: 'M' },                          expect: 'edge' },  // GDP는 연간만
  { id: 'period-mismatch2', q: { query: '인구', period: 'Q' },                         expect: 'edge' },

  // ─── 키워드 + 수식어 ───
  { id: 'modifier-1',       q: { query: '인구 감소율' },                               expect: 'gray' },
  { id: 'modifier-2',       q: { query: '저출산 현황' },                               expect: 'gray' },
  { id: 'modifier-3',       q: { query: '고령화 문제' },                               expect: 'gray' },

  // ─── 키워드 우선순위 (긴 키워드 vs 짧은 키워드) ───
  { id: 'priority-1',       q: { query: '아파트전세' },                                expect: 'ok' },
  { id: 'priority-2',       q: { query: '주택전세가격' },                              expect: 'gray' },  // '전세가격지수' 매칭?

  // ─── 대소문자 ───
  { id: 'case-gdp-lower',   q: { query: 'gdp' },                                       expect: 'gray' },
  { id: 'case-pm25-lower',  q: { query: 'pm2.5' },                                     expect: 'gray' },
  { id: 'case-pm10',        q: { query: 'pm10' },                                      expect: 'gray' },
];

function shorten(s, n = 200) {
  if (!s) return s;
  s = String(s).replace(/\s+/g, ' ');
  return s.length > n ? s.slice(0, n) + '…' : s;
}

async function runOne(c) {
  try {
    const fn = c.t === 'trend' ? quickTrend : quickStats;
    const r = await fn(c.q);
    return {
      ok: !!r.success,
      answer: shorten(r.answer),
      note: shorten(r.note),
      value: r.value,
      period: r.period,
    };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

(async () => {
  const results = [];
  for (const c of CASES) {
    const r = await runOne(c);
    results.push({ id: c.id, expect: c.expect, query: c.q.query ?? c.q, ...r });
    const verdict = (r.ok && c.expect === 'ok') ? '✅'
                  : (!r.ok && c.expect === 'edge') ? '✅'
                  : '⚠️ ';
    console.log(`${verdict} [${c.expect.padEnd(4)}] ${c.id.padEnd(28)} → ${r.ok ? 'OK' : 'FAIL'}`);
    console.log(`     answer: ${r.answer ?? r.error}`);
    if (r.note) console.log(`     note:   ${r.note}`);
    console.log();
  }
  console.log('\n=== JSON ===');
  console.log(JSON.stringify(results, null, 2));
})();
