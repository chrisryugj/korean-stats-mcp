/**
 * 실전 통계 질의 100개 종합 시뮬레이션
 *
 * 커버 목표:
 *   - 91개 키워드 전부 (인구·인구동태·고용·경제·부동산·교통·환경·사회·보건)
 *   - 17개 광역시도 전부 + 자치구·시군 정밀 라우팅
 *   - 자연어 변형 (현황/얼마/작년) + 연도 지정
 *
 * 합격 기준 (100% 커버):
 *   ok      = success=true + value(수치) 추출 완료
 *   novalue = success=true 이나 value 없음 (highlight 패턴/데이터 보강 필요)
 *   fail    = success=false
 *   → 100개 전부 ok 여야 통과
 */
import { quickStats, extractKeyword } from '../dist/tools/quickStats.js';
import { QUICK_STATS_PARAMS } from '../dist/data/quickStatsParams.js';

const ALL_PROVINCES = ['서울', '부산', '대구', '인천', '광주', '대전', '울산', '세종',
  '경기', '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주'];

const CASES = [
  // ── A. 인구·출산·고령 (14키워드 × 14개 시도) ───────────────────────────
  { id: 'pop-seoul',        q: { query: '서울 인구' },             cat: '인구' },
  { id: 'totpop-busan',     q: { query: '부산 총인구' },           cat: '인구' },
  { id: 'fert-daegu',       q: { query: '대구 출산율' },           cat: '인구' },
  { id: 'tfr-incheon',      q: { query: '인천 합계출산율' },       cat: '인구' },
  { id: 'births-gwangju',   q: { query: '광주 출생아수' },         cat: '인구' },
  { id: 'birth-daejeon',    q: { query: '대전 출생아' },           cat: '인구' },
  { id: 'cbr-ulsan',        q: { query: '울산 조출생률' },         cat: '인구' },
  { id: 'elderly-sejong',   q: { query: '세종 고령인구' },         cat: '인구' },
  { id: 'senior-gyeonggi',  q: { query: '경기 노인인구' },         cat: '인구' },
  { id: 'over65-gangwon',   q: { query: '강원 65세이상인구' },     cat: '인구' },
  { id: 'aging-chungbuk',   q: { query: '충북 노령화지수' },       cat: '인구' },
  { id: 'agingidx-chungnam',q: { query: '충남 고령화지수' },       cat: '인구' },
  { id: 'natinc-jeonbuk',   q: { query: '전북 자연증가' },         cat: '인구' },
  { id: 'natincr-jeonnam',  q: { query: '전남 자연증가율' },       cat: '인구' },

  // ── B. 사망·혼인·이혼·초혼 (14키워드) ──────────────────────────────────
  { id: 'deaths-gyeongbuk', q: { query: '경북 사망자수' },         cat: '인구동태' },
  { id: 'death-gyeongnam',  q: { query: '경남 사망자' },           cat: '인구동태' },
  { id: 'cdr-jeju',         q: { query: '제주 조사망률' },         cat: '인구동태' },
  { id: 'deathrate-seoul',  q: { query: '서울 사망률' },           cat: '인구동태' },
  { id: 'marr-busan',       q: { query: '부산 혼인건수' },         cat: '인구동태' },
  { id: 'marrate-daegu',    q: { query: '대구 혼인율' },           cat: '인구동태' },
  { id: 'cmr-incheon',      q: { query: '인천 조혼인율' },         cat: '인구동태' },
  { id: 'div-gwangju',      q: { query: '광주 이혼건수' },         cat: '인구동태' },
  { id: 'divrate-daejeon',  q: { query: '대전 이혼율' },           cat: '인구동태' },
  { id: 'cdivr-ulsan',      q: { query: '울산 조이혼율' },         cat: '인구동태' },
  { id: 'fmarr-gyeonggi',   q: { query: '경기 초혼연령' },         cat: '인구동태' },
  { id: 'avgmarr-gangwon',  q: { query: '강원 평균초혼연령' },     cat: '인구동태' },
  { id: 'mmarr-chungbuk',   q: { query: '충북 남성초혼연령' },     cat: '인구동태' },
  { id: 'wmarr-chungnam',   q: { query: '충남 여성초혼연령' },     cat: '인구동태' },

  // ── C. 고용·노동 (12키워드 — 취업자류는 자치구/전국) ─────────────────────
  { id: 'unemp-jeonbuk',    q: { query: '전북 실업률' },           cat: '고용' },
  { id: 'emp-jeonnam',      q: { query: '전남 고용률' },           cat: '고용' },
  { id: 'jobs-gangnam',     q: { query: '강남구 취업자수' },       cat: '고용' },
  { id: 'job-suwon',        q: { query: '수원시 취업자' },         cat: '고용' },
  { id: 'unempn-haeundae',  q: { query: '해운대구 실업자수' },     cat: '고용' },
  { id: 'unempr-gwangjin',  q: { query: '광진구 실업자' },         cat: '고용' },
  { id: 'eap-cheongju',     q: { query: '청주시 경제활동인구' },   cat: '고용' },
  { id: 'neap-jeonju',      q: { query: '전주시 비경제활동인구' }, cat: '고용' },
  { id: 'wage-gyeongbuk',   q: { query: '경북 임금' },             cat: '고용' },
  { id: 'mwage-gyeongnam',  q: { query: '경남 월평균임금' },       cat: '고용' },
  { id: 'pay-jeju',         q: { query: '제주 월급' },             cat: '고용' },
  { id: 'avgwage-seoul',    q: { query: '서울 평균임금' },         cat: '고용' },

  // ── D. 경제·무역·물가 (15키워드) ───────────────────────────────────────
  { id: 'gdp-nation',       q: { query: 'GDP' },                   cat: '경제' },
  { id: 'gdp2-nation',      q: { query: '국내총생산' },            cat: '경제' },
  { id: 'grdp-busan',       q: { query: '부산 GRDP' },             cat: '경제' },
  { id: 'grdp2-daegu',      q: { query: '대구 지역내총생산' },     cat: '경제' },
  { id: 'growth-nation',    q: { query: '경제성장률' },            cat: '경제' },
  { id: 'growth2-nation',   q: { query: '성장률' },                cat: '경제' },
  { id: 'gdpgrowth-nation', q: { query: 'GDP성장률' },             cat: '경제' },
  { id: 'expval-incheon',   q: { query: '인천 수출액' },           cat: '무역' },
  { id: 'exp-gyeonggi',     q: { query: '경기 수출' },             cat: '무역' },
  { id: 'impval-nation',    q: { query: '수입액' },                cat: '무역' },
  { id: 'imp-nation',       q: { query: '수입' },                  cat: '무역' },
  { id: 'trade-nation',     q: { query: '무역수지' },              cat: '무역' },
  { id: 'cpi-gwangju',      q: { query: '광주 물가' },             cat: '물가' },
  { id: 'cpi2-daejeon',     q: { query: '대전 소비자물가' },       cat: '물가' },
  { id: 'cpi3-ulsan',       q: { query: '울산 소비자물가지수' },   cat: '물가' },

  // ── E. 부동산 (13키워드) ───────────────────────────────────────────────
  { id: 'house-seoul',      q: { query: '서울 주택가격' },         cat: '부동산' },
  { id: 'housesale-busan',  q: { query: '부산 주택매매가격' },     cat: '부동산' },
  { id: 'houseidx-daegu',   q: { query: '대구 주택가격지수' },     cat: '부동산' },
  { id: 'apt-incheon',      q: { query: '인천 아파트가격' },       cat: '부동산' },
  { id: 'aptsale-gwangju',  q: { query: '광주 아파트매매가격' },   cat: '부동산' },
  { id: 'aptidx-daejeon',   q: { query: '대전 아파트가격지수' },   cat: '부동산' },
  { id: 'apt2-ulsan',       q: { query: '울산 아파트' },           cat: '부동산' },
  { id: 'jeonse-gyeonggi',  q: { query: '경기 전세가격' },         cat: '부동산' },
  { id: 'jeonseidx-gangwon',q: { query: '강원 전세가격지수' },     cat: '부동산' },
  { id: 'hjeonse-chungbuk', q: { query: '충북 주택전세' },         cat: '부동산' },
  { id: 'jeonse2-chungnam', q: { query: '충남 전세' },             cat: '부동산' },
  { id: 'aptjeonse-jeonbuk',q: { query: '전북 아파트전세' },       cat: '부동산' },
  { id: 'aptjp-jeonnam',    q: { query: '전남 아파트전세가격' },   cat: '부동산' },

  // ── F. 교통·환경 (11키워드) ────────────────────────────────────────────
  { id: 'car-gyeongbuk',    q: { query: '경북 자동차' },           cat: '교통' },
  { id: 'carreg-gyeongnam', q: { query: '경남 자동차등록' },       cat: '교통' },
  { id: 'carcnt-jeju',      q: { query: '제주 자동차대수' },       cat: '교통' },
  { id: 'accident-seoul',   q: { query: '서울 교통사고' },         cat: '교통' },
  { id: 'accident2-busan',  q: { query: '부산 교통사고발생' },     cat: '교통' },
  { id: 'accidentn-daegu',  q: { query: '대구 사고건수' },         cat: '교통' },
  { id: 'pm-incheon',       q: { query: '인천 미세먼지' },         cat: '환경' },
  { id: 'pm25-gwangju',     q: { query: '광주 PM2.5' },            cat: '환경' },
  { id: 'pm25b-daejeon',    q: { query: '대전 초미세먼지' },       cat: '환경' },
  { id: 'pm10-ulsan',       q: { query: '울산 PM10' },             cat: '환경' },
  { id: 'air-gyeonggi',     q: { query: '경기 대기오염' },         cat: '환경' },

  // ── G. 사회·보건·관광 (12키워드) ───────────────────────────────────────
  { id: 'crime-gangwon',    q: { query: '강원 범죄' },             cat: '사회' },
  { id: 'crimerate-chungbuk',q:{ query: '충북 범죄율' },           cat: '사회' },
  { id: 'crimeocc-chungnam',q: { query: '충남 범죄발생' },         cat: '사회' },
  { id: 'doctor-jeonbuk',   q: { query: '전북 의사' },             cat: '보건' },
  { id: 'doctorn-jeonnam',  q: { query: '전남 의사수' },           cat: '보건' },
  { id: 'medstaff-gyeongbuk',q:{ query: '경북 의료인력' },         cat: '보건' },
  { id: 'life-nation',      q: { query: '기대수명' },              cat: '보건' },
  { id: 'life2-nation',     q: { query: '기대여명' },              cat: '보건' },
  { id: 'life3-nation',     q: { query: '평균수명' },              cat: '보건' },
  { id: 'tour-nation',      q: { query: '관광객' },                cat: '관광' },
  { id: 'tour2-nation',     q: { query: '외래관광객' },            cat: '관광' },
  { id: 'entry-nation',     q: { query: '입국자' },                cat: '관광' },

  // ── H. 자치구 정밀 라우팅 (9개) ────────────────────────────────────────
  { id: 'dist-gangnam-pop', q: { query: '강남구 인구' },           cat: '자치구' },
  { id: 'dist-gwangjin-emp',q: { query: '광진구 고용률' },         cat: '자치구' },
  { id: 'dist-suwon-death', q: { query: '수원시 사망률' },         cat: '자치구' },
  { id: 'dist-haeundae-tfr',q: { query: '해운대구 합계출산율' },   cat: '자치구' },
  { id: 'dist-cheongju-mar',q: { query: '청주시 혼인율' },         cat: '자치구' },
  { id: 'dist-jeonju-unemp',q: { query: '전주시 실업률' },         cat: '자치구' },
  { id: 'dist-pohang-elder',q: { query: '포항시 고령인구' },       cat: '자치구' },
  { id: 'dist-changwon-doc',q: { query: '창원시 의사수' },         cat: '자치구' },
  { id: 'dist-jeju-apt',    q: { query: '서귀포시 아파트가격' },   cat: '자치구' },

  // ── I. 자연어 변형 + 연도 지정 (5개) ───────────────────────────────────
  { id: 'nl-busan-status',  q: { query: '부산 인구 현황' },        cat: '자연어' },
  { id: 'nl-jeju-howmany',  q: { query: '제주 의사수 얼마야' },    cat: '자연어' },
  { id: 'nl-seoul-lastyear',q: { query: '서울 출산율', year: 2023 },cat: '자연어' },
  { id: 'nl-gyeonggi-curr', q: { query: '경기 인구 몇명' },        cat: '자연어' },
  { id: 'nl-daegu-2022gdp', q: { query: '대구 GRDP', year: 2022 }, cat: '자연어' },
];

function classify(result) {
  if (!result || result.success !== true) return 'fail';
  const v = result.value;
  if (v === undefined || v === null || v === '' || v === '-') return 'novalue';
  return 'ok';
}

async function runCase(c) {
  const start = Date.now();
  try {
    const result = await quickStats(c.q);
    const status = classify(result);
    return {
      id: c.id, cat: c.cat, query: c.q.query,
      status, pass: status === 'ok',
      value: result.value ?? null, unit: result.unit ?? null,
      period: result.period ?? null, source: result.source?.tableId ?? null,
      answerHead: typeof result.answer === 'string' ? result.answer.slice(0, 120).replace(/\n/g, ' ⏎ ') : null,
      noteHead: typeof result.note === 'string' ? result.note.slice(0, 160).replace(/\n/g, ' ⏎ ') : null,
      ms: Date.now() - start,
    };
  } catch (e) {
    return { id: c.id, cat: c.cat, query: c.q.query, status: 'exception', pass: false,
      error: e instanceof Error ? e.message : String(e), ms: Date.now() - start };
  }
}

(async () => {
  console.log(`\n실전 통계 질의 시뮬레이션 — 총 ${CASES.length} 케이스\n`);
  const results = [];
  for (const c of CASES) {
    const r = await runCase(c);
    results.push(r);
    const mark = r.pass ? '✅' : (r.status === 'novalue' ? '⚠️ ' : '❌');
    const summary = r.status === 'ok'
      ? `${r.value}${r.unit ?? ''} (${r.period ?? ''}) [${r.source ?? ''}]`
      : r.status === 'novalue'
        ? `value 없음 [${r.source ?? ''}] ${r.noteHead?.slice(0, 70) ?? ''}`
        : r.status === 'fail'
          ? `FAIL ${r.noteHead?.slice(0, 90) ?? r.answerHead?.slice(0, 90) ?? ''}`
          : `EXCEPTION ${r.error?.slice(0, 90)}`;
    console.log(`${mark} [${r.cat.padEnd(8)}] ${r.id.padEnd(24)} "${r.query.padEnd(22)}" → ${r.status.padEnd(9)} (${r.ms}ms) ${summary}`);
  }

  const total = results.length;
  const passed = results.filter((r) => r.pass).length;
  const byCat = {};
  for (const r of results) {
    if (!byCat[r.cat]) byCat[r.cat] = { total: 0, pass: 0 };
    byCat[r.cat].total += 1;
    if (r.pass) byCat[r.cat].pass += 1;
  }
  const failures = results.filter((r) => !r.pass);

  console.log('\n──────────────────────────────────────────────');
  console.log(`전체 ${passed}/${total} (${((passed / total) * 100).toFixed(1)}%)\n`);
  for (const [cat, s] of Object.entries(byCat)) {
    console.log(`  ${cat.padEnd(10)} ${s.pass}/${s.total}`);
  }

  if (failures.length > 0) {
    console.log('\n❌ 미통과:');
    for (const r of failures) {
      console.log(`  [${r.status}] ${r.id} "${r.query}"`);
      if (r.answerHead) console.log(`    answer: ${r.answerHead}`);
      if (r.noteHead) console.log(`    note:   ${r.noteHead}`);
      if (r.error) console.log(`    error:  ${r.error}`);
    }
  }

  // ── 커버리지 검증: 91개 키워드 + 17개 시도 전부 커버하는지 ──
  const allKeywords = Object.keys(QUICK_STATS_PARAMS);
  const coveredKeywords = new Set();
  for (const c of CASES) coveredKeywords.add(extractKeyword(c.q.query));
  const missingKw = allKeywords.filter((k) => !coveredKeywords.has(k));

  const coveredProv = new Set();
  for (const c of CASES) {
    for (const p of ALL_PROVINCES) if (c.q.query.includes(p)) coveredProv.add(p);
  }
  const missingProv = ALL_PROVINCES.filter((p) => !coveredProv.has(p));

  // ── value sanity: NaN이거나, 음수 불가 지표인데 0 이하인 ok 케이스 ──
  // 자연증가·성장률·무역수지는 음수가 정상값(인구감소·역성장·적자) — 제외.
  const NEGATIVE_OK = new Set(['자연증가', '자연증가율', '경제성장률', '성장률', 'GDP성장률', '무역수지']);
  const sanityWarn = [];
  for (const r of results) {
    if (r.status !== 'ok') continue;
    const num = parseFloat(String(r.value).replace(/,/g, ''));
    if (Number.isNaN(num)) { sanityWarn.push(r); continue; }
    if (num <= 0 && !NEGATIVE_OK.has(extractKeyword(r.query))) sanityWarn.push(r);
  }

  console.log('\n── 커버리지 검증 ──');
  console.log(`  키워드: ${allKeywords.length - missingKw.length}/${allKeywords.length}` +
    (missingKw.length ? ` — 누락: ${missingKw.join(', ')}` : ' ✅'));
  console.log(`  광역시도: ${ALL_PROVINCES.length - missingProv.length}/${ALL_PROVINCES.length}` +
    (missingProv.length ? ` — 누락: ${missingProv.join(', ')}` : ' ✅'));
  console.log(`  value sanity: ${sanityWarn.length === 0 ? '✅ 이상 없음' : `⚠️ ${sanityWarn.length}건 (${sanityWarn.map((r) => r.id).join(', ')})`}`);

  const coverageOk = missingKw.length === 0 && missingProv.length === 0 && sanityWarn.length === 0;
  const allOk = failures.length === 0 && coverageOk;
  console.log(`\n${allOk ? '✅ 100% 커버 — 통계범위·지역 전부 + 전 케이스 통과' : '❌ 미달 — 위 항목 확인'}`);

  process.exit(allOk ? 0 : 1);
})();
