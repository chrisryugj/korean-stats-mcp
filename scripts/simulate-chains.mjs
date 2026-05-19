/**
 * 체인 도구 검증 시뮬레이션 (chain_region_brief, chain_compare_regions, chain_policy_indicator)
 *
 * - 단일 실패 허용 (지표 일부 실패해도 chain 자체 success=true이면 통과)
 * - 부분 결과 카운트 검증: 최소 N개 지표 성공해야 진짜 통과
 */
import { chainRegionBrief, chainCompareRegions, chainPolicyIndicator } from '../dist/tools/chains.js';

const CASES = [
  // ─── chain_region_brief ───
  { id: 'brief-seoul',     fn: 'brief',  args: { region: '서울' },                                 minSuccess: 10 },
  { id: 'brief-busan',     fn: 'brief',  args: { region: '부산' },                                 minSuccess: 10 },
  { id: 'brief-gyeonggi',  fn: 'brief',  args: { region: '경기' },                                 minSuccess: 10 },
  { id: 'brief-district',  fn: 'brief',  args: { region: '광진구' },                               minSuccess: 8  },
  { id: 'brief-sgg-city',  fn: 'brief',  args: { region: '성남시' },                               minSuccess: 8  },
  { id: 'brief-national',  fn: 'brief',  args: { region: '서울', includeNational: true },          minSuccess: 10 },

  // ─── chain_compare_regions ───
  { id: 'cmp-3sido-pop',   fn: 'cmp',    args: { regions: ['서울','부산','인천'], keywords: ['인구'] },                 minSuccess: 3 },
  { id: 'cmp-2sido-2kw',   fn: 'cmp',    args: { regions: ['서울','부산'], keywords: ['인구','실업률'] },                minSuccess: 4 },
  { id: 'cmp-metro-4sido', fn: 'cmp',    args: { regions: ['서울','부산','대구','인천'], keywords: ['출산율','GRDP'] },  minSuccess: 6 },
  { id: 'cmp-sgg-mixed',   fn: 'cmp',    args: { regions: ['성남시','수원시'],   keywords: ['인구','출산율'] },           minSuccess: 4 },

  // ─── chain_policy_indicator ───
  { id: 'pol-lowfert',     fn: 'pol',    args: { domain: 'lowFertility', yearCount: 10 },          minSuccess: 3 },
  { id: 'pol-aging',       fn: 'pol',    args: { domain: 'aging', yearCount: 10 },                 minSuccess: 2 },
  { id: 'pol-housing',     fn: 'pol',    args: { domain: 'housing', yearCount: 10 },               minSuccess: 2 },
  { id: 'pol-jobs',        fn: 'pol',    args: { domain: 'jobs', yearCount: 10 },                  minSuccess: 3 },
  { id: 'pol-safety',      fn: 'pol',    args: { domain: 'safety', yearCount: 10 },                minSuccess: 2 },
  { id: 'pol-health',      fn: 'pol',    args: { domain: 'health', yearCount: 10 },                minSuccess: 2 },
  { id: 'pol-economy',     fn: 'pol',    args: { domain: 'economy', yearCount: 10 },               minSuccess: 2 },
  { id: 'pol-region',      fn: 'pol',    args: { domain: 'lowFertility', region: '부산' },         minSuccess: 2 },
];

const FN_MAP = {
  brief: chainRegionBrief,
  cmp:   chainCompareRegions,
  pol:   chainPolicyIndicator,
};

(async () => {
  let pass = 0, fail = 0;
  for (const c of CASES) {
    try {
      const r = await FN_MAP[c.fn](c.args);
      const successCount =
        c.fn === 'brief' ? r.indicators.filter((i) => i.success).length
      : c.fn === 'cmp'   ? r.matrix.flatMap((m) => m.cells).filter((c) => c.success).length
      :                    r.indicators.filter((i) => i.success).length;
      const ok = r.success && successCount >= c.minSuccess;
      console.log(`${ok ? '✅' : '❌'} ${c.id.padEnd(20)} success=${r.success} hit=${successCount}/${c.minSuccess}`);
      ok ? pass++ : fail++;
    } catch (e) {
      console.log(`❌ ${c.id.padEnd(20)} ERROR: ${e?.message || e}`);
      fail++;
    }
  }
  console.log(`\n=== 합계: ${pass}/${pass + fail} 통과 ===`);
  process.exit(fail === 0 ? 0 : 1);
})();
