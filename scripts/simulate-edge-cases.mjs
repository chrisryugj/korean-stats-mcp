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

  // ─── M. 시군 매핑 보강 (P0-2/P0-3) ───
  { id: 'sgg-seongnam',     q: { query: '성남시 인구' },                               expect: 'gray' },
  { id: 'sgg-suwon',        q: { query: '수원시 인구' },                               expect: 'gray' },
  { id: 'sgg-yongin-grdp',  q: { query: '용인시 GRDP' },                               expect: 'gray' },
  { id: 'sgg-bucheon',      q: { query: '부천시 인구' },                               expect: 'gray' },
  { id: 'sgg-cheongju',     q: { query: '청주시 인구' },                               expect: 'gray' },
  { id: 'sgg-cheonan',      q: { query: '천안시 인구' },                               expect: 'gray' },
  { id: 'sgg-jeonju',       q: { query: '전주시 인구' },                               expect: 'gray' },
  { id: 'sgg-pohang',       q: { query: '포항시 인구' },                               expect: 'gray' },
  { id: 'sgg-changwon',     q: { query: '창원시 인구' },                               expect: 'gray' },
  { id: 'sgg-chuncheon',    q: { query: '춘천시 인구' },                               expect: 'gray' },
  { id: 'sgg-yeosu',        q: { query: '여수시 출산율' },                             expect: 'gray' },
  { id: 'sgg-gapyeong',     q: { query: '가평군 인구' },                               expect: 'gray' },
  { id: 'sgg-yeongwol',     q: { query: '영월군 인구' },                               expect: 'gray' },
  { id: 'sgg-danyang',      q: { query: '단양군 인구' },                               expect: 'gray' },
  { id: 'sgg-buyeo',        q: { query: '부여군 인구' },                               expect: 'gray' },
  { id: 'sgg-yeongdeok',    q: { query: '영덕군 인구' },                               expect: 'gray' },
  { id: 'sgg-geoje',        q: { query: '거제시 인구' },                               expect: 'gray' },
  { id: 'sgg-ulleung',      q: { query: '울릉군 인구' },                               expect: 'gray' },

  // ─── N. 동명 자치구 disambiguate (광역시도 컨텍스트로 정밀 매칭) ───
  { id: 'dis-gj-donggu',    q: { query: '광주 동구 인구' },                            expect: 'gray' },
  { id: 'dis-dg-donggu',    q: { query: '대구 동구 인구' },                            expect: 'gray' },
  { id: 'dis-bs-donggu',    q: { query: '부산 동구 인구' },                            expect: 'gray' },
  { id: 'dis-ic-donggu',    q: { query: '인천 동구 인구' },                            expect: 'gray' },
  { id: 'dis-dj-donggu',    q: { query: '대전 동구 인구' },                            expect: 'gray' },
  { id: 'dis-us-namgu',     q: { query: '울산 남구 인구' },                            expect: 'gray' },
  { id: 'dis-gj-namgu',     q: { query: '광주 남구 인구' },                            expect: 'gray' },
  { id: 'dis-bs-gangseo',   q: { query: '부산 강서구 인구' },                          expect: 'gray' },
  { id: 'dis-dj-junggu',    q: { query: '대전 중구 인구' },                            expect: 'gray' },
  { id: 'dis-gj-seogu',     q: { query: '광주 서구 인구' },                            expect: 'gray' },
  { id: 'dis-full-gj-dong', q: { query: '광주광역시 동구 인구' },                      expect: 'gray' },

  // ─── O. 미등록·모호 자치구 fallback ───
  { id: 'amb-donggu-alone', q: { query: '동구 인구' },                                 expect: 'gray' },
  { id: 'amb-seogu-alone',  q: { query: '서구 인구' },                                 expect: 'gray' },
  { id: 'amb-gj-city',      q: { query: '광주시 인구' },                               expect: 'gray' },
  { id: 'amb-goseong',      q: { query: '고성군 인구' },                               expect: 'gray' },

  // ─── P. quick_trend 자치구·시군 처리 (P0-1) ───
  { id: 'trend-district-gwangjin',  t: 'trend', q: { query: '광진구 인구' },           expect: 'ok' },
  { id: 'trend-district-gangnam',   t: 'trend', q: { query: '강남구 인구' },           expect: 'ok' },
  { id: 'trend-district-haeundae',  t: 'trend', q: { query: '해운대구 출산율' },       expect: 'ok' },
  { id: 'trend-district-natural',   t: 'trend', q: { query: '광진구 인구 추이' },      expect: 'ok' },
  { id: 'trend-sgg-seongnam',       t: 'trend', q: { query: '성남시 인구' },           expect: 'ok' },
  { id: 'trend-sgg-suwon-grdp',     t: 'trend', q: { query: '수원시 GRDP' },           expect: 'ok' },
  { id: 'trend-prov-seoul',         t: 'trend', q: { query: '서울 인구' },             expect: 'ok' },
  { id: 'trend-prov-fullname',      t: 'trend', q: { query: '경기도 인구' },           expect: 'ok' },
  { id: 'trend-natural-decline',    t: 'trend', q: { query: '출산율 떨어진 추세' },    expect: 'ok' },
  { id: 'trend-en-natural',         t: 'trend', q: { query: 'population' },            expect: 'ok' },

  // ─── Q. quick_trend 회색지대 (모호/미지원) ───
  { id: 'trend-unknown-kw',         t: 'trend', q: { query: '암호화폐' },              expect: 'edge' },
  { id: 'trend-amb-namgu',          t: 'trend', q: { query: '남구 인구' },             expect: 'ok' },
  { id: 'trend-amb-donggu',         t: 'trend', q: { query: '동구 인구' },             expect: 'gray' },
];

function shorten(s, n = 200) {
  if (!s) return s;
  s = String(s).replace(/\s+/g, ' ');
  return s.length > n ? s.slice(0, n) + '…' : s;
}

async function runOne(c) {
  try {
    if (c.t === 'trend') {
      // quickTrend는 keyword 필드 사용
      const input = {
        keyword: c.q.keyword ?? c.q.query ?? '',
        region: c.q.region,
        yearCount: c.q.years ?? c.q.yearCount,
      };
      const r = await quickTrend(input);
      return {
        ok: !!r.success,
        answer: shorten(r.summary),
        note: shorten(r.note),
        value: r.dataPoints?.length ? `${r.dataPoints.length} points` : undefined,
        period: r.region,
      };
    }
    const r = await quickStats(c.q);
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
