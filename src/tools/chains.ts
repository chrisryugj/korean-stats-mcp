/**
 * 체인 도구 — 여러 도구를 묶어 공무원 업무용 종합 브리핑 생성
 *
 * 설계 원칙 (korean-law-mcp의 chains 패턴 차용):
 *   - 단일 자연어 호출로 여러 quickStats / quickTrend 병렬 실행
 *   - 결과를 카드/매트릭스 형태로 정리하여 LLM이 그대로 보고서화 가능
 *   - 부분 실패 허용 (한 지표 못 가져와도 다른 지표는 표시)
 */

import { z } from 'zod';
import { quickStats } from './quickStats.js';
import { quickTrend } from './quickTrend.js';

// ═══════════════════════════════════════════════════════════
// chain_region_brief — 지역 한장 종합 브리핑
// ═══════════════════════════════════════════════════════════

const REGION_BRIEF_INDICATORS = [
  { key: '인구',         label: '주민등록 인구',            tier: 'core' },
  { key: '출산율',       label: '합계출산율',                tier: 'core' },
  { key: '고령인구',     label: '65세 이상 고령인구',       tier: 'core' },
  { key: '실업률',       label: '실업률',                    tier: 'core' },
  { key: '고용률',       label: '고용률',                    tier: 'core' },
  { key: 'GRDP',         label: '지역내총생산(명목)',        tier: 'econ' },
  { key: '월급',         label: '월평균 임금',               tier: 'econ' },
  { key: '아파트가격',   label: '아파트매매가격지수',        tier: 'housing' },
  { key: '전세가격',     label: '주택전세가격지수',          tier: 'housing' },
  { key: '의사수',       label: '인구 천명당 의사수',        tier: 'social' },
  { key: '교통사고',     label: '자동차 천대당 교통사고',   tier: 'social' },
  { key: '범죄율',       label: '인구 천명당 범죄발생',     tier: 'social' },
  { key: '미세먼지',     label: 'PM2.5 농도',                tier: 'env' },
] as const;

export const chainRegionBriefSchema = {
  name: 'chain_region_brief',
  description: `[⛓체인] 지역 한장 종합 브리핑 — 인구·고용·경제·주거·사회·환경 핵심 13지표 병렬 조회.

🎯 사용 시점: "OO시 통계 보고서", "지역 종합 브리핑", "시정연설/지방의회 답변 준비", "도시 현황 한눈에", "취임사·신년사 한 줄 통계"
🔄 도구 비교:
• 단일 지표만 필요 → quick_stats
• 다지역 비교 매트릭스 → chain_compare_regions
• 정책 영역 추세 묶음 → chain_policy_indicator

■ 반환: 13개 지표(인구/출산율/고령/실업률/고용률/GRDP/임금/주택/전세/의사수/교통사고/범죄율/미세먼지) + 자치구→광역시도 fallback 자동
■ format='speech'면 연설용 1줄 요약만 (취임사·신년사·연설문 통계 인용용)
■ 부분 실패 허용 (지표별 데이터 가용성 상이)`,
  inputSchema: z.object({
    region: z
      .string()
      .describe('지역명 (예: "서울", "부산", "성남시", "광진구"). 자치구·시군은 광역시도로 자동 fallback.'),
    includeNational: z
      .boolean()
      .optional()
      .default(false)
      .describe('전국 평균 동시 조회 여부 (지역과 비교용)'),
    format: z
      .enum(['detail', 'speech'])
      .optional()
      .default('detail')
      .describe('출력 형식. detail=13지표 전체, speech=상위 5개 한 줄 요약(취임사·신년사용)'),
  }),
};

export type ChainRegionBriefInput = z.infer<typeof chainRegionBriefSchema.inputSchema>;

export async function chainRegionBrief(input: ChainRegionBriefInput) {
  const { region, includeNational, format } = input;

  const fetchOne = async (kw: string, regionArg?: string) => {
    try {
      return await quickStats({ query: kw, region: regionArg });
    } catch (e) {
      return {
        success: false,
        answer: `조회 실패: ${e instanceof Error ? e.message : String(e)}`,
      } as any;
    }
  };

  const regional = await Promise.all(
    REGION_BRIEF_INDICATORS.map(async (ind) => {
      const r = await fetchOne(ind.key, region);
      return {
        keyword: ind.key,
        label: ind.label,
        tier: ind.tier,
        success: r.success,
        value: r.value ?? null,
        unit: r.unit ?? null,
        period: r.period ?? null,
        source: r.source?.tableName ?? null,
        note: r.note ?? null,
        message: r.success ? r.answer?.split('\n')[0] : r.answer,
      };
    })
  );

  let national: any[] | undefined;
  if (includeNational) {
    national = await Promise.all(
      REGION_BRIEF_INDICATORS.map(async (ind) => {
        const r = await fetchOne(ind.key);
        return {
          keyword: ind.key,
          label: ind.label,
          value: r.value ?? null,
          unit: r.unit ?? null,
          period: r.period ?? null,
          success: r.success,
        };
      })
    );
  }

  const successCount = regional.filter((r) => r.success).length;
  const successItems = regional.filter((r) => r.success);
  const failedItems = regional.filter((r) => !r.success);

  // 자치구→광역시도 fallback 노트가 있으면 우선 노출 (모든 indicator에 동일 노트가 들어가므로 첫 1개)
  const districtFallbackNote =
    regional.find((r) => r.note && r.note.includes('자치구'))?.note ?? null;
  const otherNote = regional.find((r) => r.note && !r.note.includes('자치구'))?.note ?? null;

  // speech 형식: 상위 5개 핵심 지표만 한 줄 요약
  if (format === 'speech') {
    const speechIndicators = ['인구', '출산율', '고령인구', '실업률', 'GRDP'];
    const speechLines = successItems
      .filter((r) => speechIndicators.includes(r.keyword))
      .map((r) => `${r.label} ${r.value}${r.unit ?? ''}`);
    return {
      success: true,
      region,
      format: 'speech',
      coverage: `${successCount}/${REGION_BRIEF_INDICATORS.length} 지표 가용`,
      speechLine: `${region}의 ${speechLines.join(', ')} (${successItems[0]?.period ?? '-'} 기준).`,
      indicators: successItems.filter((r) => speechIndicators.includes(r.keyword)),
      fallbackNote: districtFallbackNote ?? otherNote ?? null,
    };
  }

  return {
    success: true,
    region,
    format: 'detail',
    coverage: `${successCount}/${REGION_BRIEF_INDICATORS.length} 지표 조회 성공`,
    indicators: regional,
    national,
    summary:
      `📍 **${region} 종합 브리핑** (${successCount}/${REGION_BRIEF_INDICATORS.length} 지표 가용)\n` +
      successItems
        .map((r) => `• ${r.label}: ${r.value}${r.unit ?? ''} (${r.period ?? '-'})`)
        .join('\n') +
      (failedItems.length > 0
        ? `\n\n⚠️ 미가용 지표(${failedItems.length}): ${failedItems.map((r) => r.keyword).join(', ')}`
        : ''),
    fallbackNote:
      districtFallbackNote ??
      otherNote ??
      '광역시도 단위 데이터. 자치구별 정밀 데이터는 fetch_kosis_excel 사용.',
  };
}

// ═══════════════════════════════════════════════════════════
// chain_compare_regions — N지역 × M지표 매트릭스 비교
// ═══════════════════════════════════════════════════════════

export const chainCompareRegionsSchema = {
  name: 'chain_compare_regions',
  description: `[⛓체인] N개 지역 × M개 지표 매트릭스 비교 — 자연어로 다지역 비교 한 번에.

🎯 사용 시점: "서울/부산/인천 인구·실업률 비교", "수도권 vs 광역시 GRDP", "지자체 정책 벤치마크"
🔄 도구 비교:
• 동일 통계표 내 시점·항목 비교 → compare_statistics
• 단일 지역 종합 브리핑 → chain_region_brief
• 정책 영역 추세 → chain_policy_indicator

■ 매트릭스 + 지표별 최고/최저 자동 산출 + 순위
■ regions·keywords 모두 자연어 가능 (성남시 → 경기 자동 fallback)`,
  inputSchema: z.object({
    regions: z
      .array(z.string())
      .min(2)
      .max(17)
      .describe('비교 지역 배열 (2~17개, 전국 광역시도 17개 동시 비교 가능). 예: ["서울", "부산", "인천"]'),
    keywords: z
      .array(z.string())
      .min(1)
      .max(8)
      .describe('비교 지표 키워드 배열 (1~8개). 예: ["인구", "출산율", "실업률"]'),
  }),
};

export type ChainCompareRegionsInput = z.infer<typeof chainCompareRegionsSchema.inputSchema>;

export async function chainCompareRegions(input: ChainCompareRegionsInput) {
  const { regions, keywords } = input;

  type Cell = {
    region: string;
    keyword: string;
    value: any;
    numericValue: number | null;
    unit: string | null;
    period: string | null;
    success: boolean;
    note?: string | null;
    sourceTableId: string | null;
  };

  const matrix: { region: string; cells: Cell[] }[] = await Promise.all(
    regions.map(async (region) => {
      const cells: Cell[] = await Promise.all(
        keywords.map(async (kw) => {
          try {
            const r = await quickStats({ query: kw, region });
            const raw = r.value;
            const numeric =
              raw == null
                ? null
                : parseFloat(String(raw).replace(/,/g, '')) || null;
            return {
              region,
              keyword: kw,
              value: raw ?? null,
              numericValue: numeric,
              unit: r.unit ?? null,
              period: r.period ?? null,
              success: r.success,
              note: r.note ?? null,
              sourceTableId: r.source?.tableId ?? null,
            };
          } catch (e) {
            return {
              region,
              keyword: kw,
              value: null,
              numericValue: null,
              unit: null,
              period: null,
              success: false,
              note: e instanceof Error ? e.message : String(e),
              sourceTableId: null,
            };
          }
        })
      );
      return { region, cells };
    })
  );

  // 지표별 최고/최저 및 순위 + 소스 혼합(비교가능성) 감지
  const insights = keywords.map((kw) => {
    // 같은 지표인데 지역마다 다른 KOSIS 통계표에서 조회되면(자치구 OpenAPI·통계연보·
    // 광역 fallback 혼재) 정의·기준시점이 달라 직접 비교가 부정확해진다 — 경고 부착.
    const successCells = matrix.flatMap((m) =>
      m.cells.filter((c) => c.keyword === kw && c.success)
    );
    const tableIds = new Set(
      successCells.map((c) => c.sourceTableId).filter((t): t is string => !!t)
    );
    const comparabilityWarning =
      tableIds.size > 1
        ? `⚠️ '${kw}' 지표가 지역별로 서로 다른 KOSIS 통계표(${[...tableIds].join(', ')})에서 조회됨 — 정의·기준시점 상이로 직접 비교가 부정확할 수 있습니다.`
        : null;

    const cells = successCells
      .filter((c) => c.numericValue != null)
      .sort((a, b) => (b.numericValue ?? 0) - (a.numericValue ?? 0));
    if (cells.length === 0) {
      return { keyword: kw, ranking: [], note: '모든 지역 데이터 조회 실패', comparabilityWarning };
    }
    const ranking = cells.map((c, i) => ({
      rank: i + 1,
      region: c.region,
      value: c.value,
      unit: c.unit,
      period: c.period,
    }));
    return {
      keyword: kw,
      highest: ranking[0],
      lowest: ranking[ranking.length - 1],
      ranking,
      comparabilityWarning,
    };
  });

  // 자치구→광역시도 fallback 노트 중복 제거하여 region별 1건만 노출
  const fallbackNotesByRegion = new Map<string, string>();
  for (const m of matrix) {
    for (const c of m.cells) {
      if (c.note && c.note.includes('자치구') && !fallbackNotesByRegion.has(m.region)) {
        fallbackNotesByRegion.set(m.region, c.note);
        break;
      }
    }
  }
  const fallbackNotes = Array.from(fallbackNotesByRegion.entries()).map(
    ([region, note]) => ({ region, note })
  );

  const comparabilityWarnings = insights
    .map((i) => i.comparabilityWarning)
    .filter((w): w is string => !!w);

  return {
    success: true,
    regions,
    keywords,
    matrix,
    insights,
    summary:
      `📊 **${regions.length}개 지역 × ${keywords.length}개 지표 비교**\n` +
      insights
        .filter((i) => i.highest)
        .map(
          (i) =>
            `• ${i.keyword}: 최고 ${i.highest!.region}(${i.highest!.value}${i.highest!.unit ?? ''}), 최저 ${i.lowest!.region}(${i.lowest!.value}${i.lowest!.unit ?? ''})`
        )
        .join('\n') +
      (comparabilityWarnings.length > 0 ? `\n\n${comparabilityWarnings.join('\n')}` : ''),
    ...(comparabilityWarnings.length > 0 ? { comparabilityWarnings } : {}),
    ...(fallbackNotes.length > 0 ? { fallbackNotes } : {}),
  };
}

// ═══════════════════════════════════════════════════════════
// chain_policy_indicator — 정책 영역 묶음 시계열
// ═══════════════════════════════════════════════════════════

const POLICY_DOMAINS = {
  lowFertility: {
    label: '저출산',
    indicators: ['출산율', '출생아수', '혼인건수', '평균초혼연령'],
    description: '합계출산율·출생아수·혼인건수·평균초혼연령',
  },
  aging: {
    label: '고령화',
    indicators: ['고령인구', '노령화지수', '기대수명'],
    description: '고령인구·노령화지수·기대수명',
  },
  housing: {
    label: '주거',
    indicators: ['아파트가격', '전세가격', '주택가격'],
    description: '아파트/주택 매매·전세 가격지수',
  },
  jobs: {
    label: '일자리',
    indicators: ['실업률', '고용률', '취업자수', '월급'],
    description: '실업률·고용률·취업자수·월평균임금',
  },
  safety: {
    label: '치안·안전',
    indicators: ['범죄율', '교통사고', '사망률'],
    description: '범죄율·교통사고·사망률',
  },
  health: {
    label: '보건·의료',
    indicators: ['의사수', '기대수명', '사망률'],
    description: '의사수·기대수명·사망률',
  },
  economy: {
    label: '경제',
    indicators: ['GDP', '경제성장률', '물가', '수출'],
    description: 'GDP·경제성장률·물가·수출',
  },
} as const;

export const chainPolicyIndicatorSchema = {
  name: 'chain_policy_indicator',
  description: `[⛓체인] 정책 영역 묶음 10년 시계열 — 저출산·고령화·주거·일자리·치안·보건·경제.

🎯 사용 시점: "저출산 정책 브리프", "고령화 추세 보고", "주거 시장 동향", "일자리 5년 변화"
🔄 도구 비교:
• 단일 키워드 추세 → quick_trend
• 지역 종합 브리핑 → chain_region_brief
• 정밀 분석(차원 명시) → analyze_time_series

■ 도메인별 3~4개 지표 시계열 + 추세 요약. 정책설명서/연구보고서 첨부용.
■ region 선택. 미지정 시 전국. 자치구 → 광역시도 fallback.`,
  inputSchema: z.object({
    domain: z
      .enum(['lowFertility', 'aging', 'housing', 'jobs', 'safety', 'health', 'economy'])
      .describe(
        '정책 영역: lowFertility(저출산), aging(고령화), housing(주거), jobs(일자리), safety(치안·안전), health(보건·의료), economy(경제)'
      ),
    region: z.string().optional().describe('지역명 (선택). 자치구/시군은 광역시도로 자동 fallback.'),
    yearCount: z
      .number()
      .min(2)
      .max(20)
      .optional()
      .default(10)
      .describe('분석 기간 (년, 기본 10)'),
  }),
};

export type ChainPolicyIndicatorInput = z.infer<typeof chainPolicyIndicatorSchema.inputSchema>;

export async function chainPolicyIndicator(input: ChainPolicyIndicatorInput) {
  const { domain, region, yearCount } = input;
  const def = POLICY_DOMAINS[domain];

  const results = await Promise.all(
    def.indicators.map(async (kw) => {
      try {
        const r = await quickTrend({ keyword: kw, region, yearCount });
        const points = r.dataPoints ?? [];
        const first = points[0];
        const last = points[points.length - 1];
        const change =
          first && last && first.value !== 0
            ? (((last.value - first.value) / Math.abs(first.value)) * 100).toFixed(1)
            : null;
        return {
          keyword: kw,
          region: r.region,
          success: r.success,
          trend: r.trend,
          trendDescription: r.trendDescription,
          startYear: first?.year ?? null,
          endYear: last?.year ?? null,
          startValue: first?.formatted ?? null,
          endValue: last?.formatted ?? null,
          totalChangeRate: change == null ? null : `${parseFloat(change) >= 0 ? '+' : ''}${change}%`,
          dataPoints: points,
          source: r.source?.tableName ?? null,
          note: r.note ?? null,
        };
      } catch (e) {
        return {
          keyword: kw,
          success: false,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    })
  );

  const successItems = results.filter((r: any) => r.success);

  return {
    success: true,
    domain: def.label,
    domainDescription: def.description,
    region: region || '전국',
    yearCount,
    indicators: results,
    summary:
      `📑 **${def.label} 영역 ${yearCount}년 추세** (${region || '전국'}, ${successItems.length}/${def.indicators.length} 지표 가용)\n` +
      successItems
        .map(
          (r: any) =>
            `• ${r.keyword}: ${r.trendDescription} (${r.startYear}→${r.endYear}년, ${r.totalChangeRate ?? '-'})`
        )
        .join('\n'),
  };
}
