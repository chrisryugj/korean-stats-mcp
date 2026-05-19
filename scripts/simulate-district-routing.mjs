/**
 * 자치구 정밀 조회 라우팅 시뮬레이션 (실전 공무원 질의 패턴, 전국 자치구 범용)
 *
 * 합격 기준:
 *   - 인구/출산율/출생아수 = 전국 자치구 100% precise (DT_1B040A3 / DT_1B81A23 라우팅)
 *   - 광진구 등 KOSIS .xlsx 자치구 = 광범위 키워드 precise (통계연보)
 *   - 비-서울 자치구 + 미매핑 키워드 = 광역 fallback (자치구 단위 OpenAPI 테이블 추가 매핑 필요)
 *   - 회귀 = province (변경 없음)
 *
 * 분류:
 *   precise:  자치구 정밀값 (FILE 통계연보 또는 자치구 OpenAPI 라우팅)
 *   fallback: 광역 fallback (자치구 → 광역시도로 대체)
 *   province: 광역시도 단독 (자치구 없는 회귀 case)
 *   fail:     success=false
 */
import { quickStats } from '../dist/tools/quickStats.js';

const CASES = [
  // ── 1. 인구 — 전국 자치구 (서울 + 6대 광역시 + 9개도 시군) precise ────────────
  { id: 'seoul-gwangjin-pop',    q: { query: '광진구 인구' },                    expect: 'precise', tier: 'seoul-pop' },
  { id: 'seoul-gangnam-pop',     q: { query: '강남구 인구' },                    expect: 'precise', tier: 'seoul-pop' },
  { id: 'seoul-songpa-pop',      q: { query: '송파구 인구' },                    expect: 'precise', tier: 'seoul-pop' },
  { id: 'seoul-mapo-pop',        q: { query: '마포구 인구' },                    expect: 'precise', tier: 'seoul-pop' },
  { id: 'seoul-yongsan-pop',     q: { query: '용산구 인구' },                    expect: 'precise', tier: 'seoul-pop' },
  { id: 'seoul-jongno-pop',      q: { query: '종로구 인구' },                    expect: 'precise', tier: 'seoul-pop' },
  { id: 'seoul-nowon-pop',       q: { query: '노원구 인구' },                    expect: 'precise', tier: 'seoul-pop' },
  { id: 'seoul-eunpyeong-pop',   q: { query: '은평구 인구' },                    expect: 'precise', tier: 'seoul-pop' },

  // 광역시 자치구
  { id: 'busan-haeundae-pop',   q: { query: '해운대구 인구' },                   expect: 'precise', tier: 'nonseoul-pop' },
  { id: 'busan-jin-pop',        q: { query: '부산진구 인구' },                   expect: 'precise', tier: 'nonseoul-pop' },
  { id: 'daegu-suseong-pop',    q: { query: '수성구 인구' },                     expect: 'precise', tier: 'nonseoul-pop' },
  { id: 'incheon-yeonsu-pop',   q: { query: '연수구 인구' },                     expect: 'precise', tier: 'nonseoul-pop' },
  { id: 'gwangju-gwangsan-pop', q: { query: '광산구 인구' },                     expect: 'precise', tier: 'nonseoul-pop' },
  { id: 'daejeon-yuseong-pop',  q: { query: '유성구 인구' },                     expect: 'precise', tier: 'nonseoul-pop' },
  { id: 'ulsan-uljoo-pop',      q: { query: '울주군 인구' },                     expect: 'precise', tier: 'nonseoul-pop' },

  // 도 시군
  { id: 'gyeonggi-suwon-pop',   q: { query: '수원시 인구' },                     expect: 'precise', tier: 'nonseoul-pop' },
  { id: 'gyeonggi-seongnam-pop',q: { query: '성남시 인구' },                     expect: 'precise', tier: 'nonseoul-pop' },
  { id: 'gangwon-chuncheon-pop',q: { query: '춘천시 인구' },                     expect: 'precise', tier: 'nonseoul-pop' },
  { id: 'chungbuk-cheongju-pop',q: { query: '청주시 인구' },                     expect: 'precise', tier: 'nonseoul-pop' },
  { id: 'chungnam-cheonan-pop', q: { query: '천안시 인구' },                     expect: 'precise', tier: 'nonseoul-pop' },
  { id: 'jeonbuk-jeonju-pop',   q: { query: '전주시 인구' },                     expect: 'precise', tier: 'nonseoul-pop' },
  { id: 'jeonnam-suncheon-pop', q: { query: '순천시 인구' },                     expect: 'precise', tier: 'nonseoul-pop' },
  { id: 'gyeongbuk-pohang-pop', q: { query: '포항시 인구' },                     expect: 'precise', tier: 'nonseoul-pop' },
  { id: 'gyeongnam-changwon-pop',q: { query: '창원시 인구' },                    expect: 'precise', tier: 'nonseoul-pop' },
  { id: 'jeju-pop',             q: { query: '제주시 인구' },                     expect: 'precise', tier: 'nonseoul-pop' },

  // 연도 지정
  { id: 'seoul-gwangjin-pop-2024', q: { query: '광진구 인구', year: 2024 },      expect: 'precise', tier: 'year-spec' },
  { id: 'seoul-gangnam-pop-2023',  q: { query: '강남구 인구', year: 2023 },      expect: 'precise', tier: 'year-spec' },

  // ── 2. 출산율 / 출생아수 — 자치구 OpenAPI (DT_1B81A23) ────────────────────
  { id: 'fert-gwangjin',  q: { query: '광진구 합계출산율' },                     expect: 'precise', tier: 'fertility' },
  { id: 'fert-gangnam',   q: { query: '강남구 합계출산율' },                     expect: 'precise', tier: 'fertility' },
  { id: 'fert-haeundae',  q: { query: '해운대구 합계출산율' },                   expect: 'precise', tier: 'fertility' },
  { id: 'fert-suwon',     q: { query: '수원시 합계출산율' },                     expect: 'precise', tier: 'fertility' },
  { id: 'birth-gwangjin', q: { query: '광진구 출생아수' },                       expect: 'precise', tier: 'fertility' },
  { id: 'birth-gangnam',  q: { query: '강남구 출생아수' },                       expect: 'precise', tier: 'fertility' },

  // ── 3. 광진구(.xlsx 통계연보) — 광범위 키워드 precise (인구·노동·주거·보건) ──
  { id: 'gwangjin-elderly',  q: { query: '광진구 고령인구' },                    expect: 'precise', tier: 'gwangjin-xlsx' },
  { id: 'gwangjin-employ',   q: { query: '광진구 취업자' },                      expect: 'precise', tier: 'gwangjin-xlsx' },
  { id: 'gwangjin-employ2',  q: { query: '광진구 고용률' },                      expect: 'precise', tier: 'gwangjin-xlsx' },
  { id: 'gwangjin-doctor',   q: { query: '광진구 의사수' },                      expect: 'precise', tier: 'gwangjin-xlsx' },

  // ── 4. PDF/.xlsx 미제공 자치구 + OpenAPI 라우팅 분야 — precise (DT_1YL*) ────
  { id: 'gangnam-elderly', q: { query: '강남구 고령인구' },                      expect: 'precise',  tier: 'pdf-routed' },
  { id: 'gangnam-apt',     q: { query: '강남구 아파트가격' },                    expect: 'precise',  tier: 'pdf-routed' },
  { id: 'songpa-jeonse',   q: { query: '송파구 전세가격' },                      expect: 'precise',  tier: 'pdf-routed' },
  { id: 'gangnam-doctor',  q: { query: '강남구 의사수' },                        expect: 'precise',  tier: 'pdf-routed' },

  // ── 4b. 시군구 고용 통계 KOSIS 코드 체계 분석 미완 — 광역 fallback (다음 세션) ──
  { id: 'gangnam-employ',  q: { query: '강남구 고용률' },                        expect: 'fallback', tier: 'pending-employ' },
  { id: 'mapo-unemploy',   q: { query: '마포구 실업률' },                        expect: 'fallback', tier: 'pending-employ' },

  // ── 5. 동명 자치구 disambiguate (광역시도 힌트로 정확 라우팅) ────────────────
  { id: 'ambig-nam-busan',  q: { query: '부산 남구 인구' },                      expect: 'precise', tier: 'ambiguous' },
  { id: 'ambig-buk-daegu',  q: { query: '대구 북구 인구' },                      expect: 'precise', tier: 'ambiguous' },
  { id: 'ambig-seo-incheon',q: { query: '인천 서구 인구' },                      expect: 'precise', tier: 'ambiguous' },

  // ── 6. 자연어 변형 ─────────────────────────────────────────────────────
  { id: 'nl-gwangjin-status', q: { query: '광진구 인구 현황' },                  expect: 'precise', tier: 'natural-lang' },
  { id: 'nl-gangnam-2024',    q: { query: '강남구 2024년 인구' },                expect: 'precise', tier: 'natural-lang' },
  { id: 'nl-suwon-current',   q: { query: '수원시 인구 얼마야' },                expect: 'precise', tier: 'natural-lang' },

  // ── 7. 매핑 안 된 키워드 (자치구 + 미세먼지/범죄) ─ 광역 fallback (정상) ────
  { id: 'unmapped-pm25',  q: { query: '광진구 미세먼지' },                       expect: 'fallback', tier: 'unmapped-keyword' },
  { id: 'unmapped-crime', q: { query: '강남구 범죄율' },                         expect: 'fallback', tier: 'unmapped-keyword' },

  // ── 8. 회귀 — 광역시도 단독 ─────────────────────────────────────────────
  { id: 'reg-seoul-pop',  q: { query: '서울 인구' },                             expect: 'province', tier: 'regression' },
  { id: 'reg-busan-grdp', q: { query: '부산 GRDP' },                             expect: 'province', tier: 'regression' },
];

function classify(result, c) {
  if (!result.success) return 'fail';
  const answer = result.answer || '';
  const note = result.note || '';

  // .xlsx 자치구 통계연보 (광진구 등)
  if (result.source?.tableId?.includes('FILE')) return 'precise';

  // 자치구 통계연보 실패 안내 = fallback
  if (note.includes('자치구 통계연보(.xlsx) 조회 실패')) return 'fallback';

  // 자치구 매핑 모호 안내 = fallback
  if (note.includes('자치구 매핑이 모호') || note.includes('자치구 데이터는 quick_stats가 지원')) return 'fallback';

  // 회귀 case (자치구 없는 광역 단독)
  const isDistrictQuery = c.tier && c.tier !== 'regression';
  if (!isDistrictQuery) return 'province';

  // 자치구 query인데 광역 fallback 안내 없음 = 자치구 정밀값 (OpenAPI 라우팅)
  // 또는 자치구 통계연보 OK 분기
  return 'precise';
}

async function runCase(c) {
  const start = Date.now();
  try {
    const result = await quickStats(c.q);
    const status = classify(result, c);
    return {
      id: c.id,
      tier: c.tier,
      query: c.q.query,
      expect: c.expect,
      status,
      pass: status === c.expect,
      value: result.value ?? null,
      unit: result.unit ?? null,
      period: result.period ?? null,
      source: result.source?.tableId ?? null,
      answerHead: typeof result.answer === 'string' ? result.answer.slice(0, 150).replace(/\n/g, ' ⏎ ') : null,
      noteHead: typeof result.note === 'string' ? result.note.slice(0, 150).replace(/\n/g, ' ⏎ ') : null,
      ms: Date.now() - start,
    };
  } catch (e) {
    return {
      id: c.id,
      tier: c.tier,
      query: c.q.query,
      expect: c.expect,
      status: 'exception',
      pass: false,
      error: e instanceof Error ? e.message : String(e),
      ms: Date.now() - start,
    };
  }
}

(async () => {
  console.log(`\n자치구 라우팅 시뮬레이션 — 총 ${CASES.length} 케이스\n`);
  const results = [];
  for (const c of CASES) {
    const r = await runCase(c);
    results.push(r);
    const mark = r.pass ? '✅' : '❌';
    const summary = r.status === 'precise'
      ? `${r.value ?? '(value=null)'}${r.unit ?? ''} ${r.source ?? ''}`
      : r.status === 'fallback'
        ? `fallback ${r.source ?? ''}`
        : r.status === 'province'
          ? `province ${r.source ?? ''}`
          : r.status === 'fail'
            ? `fail ${r.noteHead?.slice(0, 80) ?? ''}`
            : `exception: ${r.error?.slice(0, 80)}`;
    console.log(`${mark} [${r.tier.padEnd(18)}] ${r.id.padEnd(28)} "${r.query.padEnd(20)}" → ${r.status.padEnd(9)} (${r.ms}ms) ${summary}`);
  }

  const total = results.length;
  const passed = results.filter((r) => r.pass).length;
  const byTier = {};
  for (const r of results) {
    if (!byTier[r.tier]) byTier[r.tier] = { total: 0, pass: 0, statuses: {} };
    byTier[r.tier].total += 1;
    if (r.pass) byTier[r.tier].pass += 1;
    byTier[r.tier].statuses[r.status] = (byTier[r.tier].statuses[r.status] ?? 0) + 1;
  }
  const failures = results.filter((r) => !r.pass);

  console.log('\n──────────────────────────────────────────────');
  console.log(`전체 ${passed}/${total} (${((passed / total) * 100).toFixed(1)}%)\n`);
  for (const [tier, s] of Object.entries(byTier)) {
    const statusStr = Object.entries(s.statuses).map(([k, v]) => `${k}=${v}`).join(', ');
    console.log(`  ${tier.padEnd(20)} ${s.pass}/${s.total}   { ${statusStr} }`);
  }

  if (failures.length > 0) {
    console.log('\n❌ FAILURES:');
    for (const r of failures) {
      console.log(`  ${r.id}: expected=${r.expect}, got=${r.status}`);
      if (r.answerHead) console.log(`    answer: ${r.answerHead}`);
      if (r.noteHead) console.log(`    note:   ${r.noteHead}`);
      if (r.error) console.log(`    error:  ${r.error}`);
    }
  }

  process.exit(failures.length === 0 ? 0 : 1);
})();
