/**
 * 빠른 추세 분석 도구
 * 자연어 키워드로 시계열 추세를 간편하게 분석
 */

import { z } from 'zod';
import { getKosisClient } from '../api/client.js';
import { getCacheManager } from '../cache/index.js';
import {
  QUICK_STATS_PARAMS,
  getQuickStatsParam,
  getRegionCode,
} from '../data/quickStatsParams.js';
import { findProvinceByDistrict, PROVINCES, AMBIGUOUS_DISTRICTS } from '../utils/regions.js';
import { analyzeTrend } from '../utils/dataFormatter.js';
import {
  extractKeyword,
  extractDistrictName,
  extractProvinceName,
} from './quickStats.js';

const DISTRICT_PATTERN = /^[가-힣]{1,4}(구|군|시)$/;

/**
 * 자연어 키워드에서 yearCount 추정
 *
 * 인식 패턴:
 *   - "지난/최근 N년", "N년 추세/추이" → N
 *   - "작년 대비", "전년 대비" → 2
 *   - "민선 N기" → N*4 (지방선거 임기 4년)
 *   - "임기 N년" → N
 *   - "취임 N년", "취임 N년차" → N+1 (취임 시점 포함)
 *   - "역대", "장기" → 20
 */
export function extractYearCount(query: string): number | null {
  // "민선 N기" → N*4
  const minseon = query.match(/민선\s*(\d+)\s*기/);
  if (minseon) {
    const term = parseInt(minseon[1], 10);
    if (term >= 1 && term <= 20) return Math.min(term * 4, 20);
  }

  // "지난/최근/근래/요즘 N년" or "N년 추세/추이/변화/대비"
  const nYears = query.match(/(?:지난|최근|근래|요즘)\s*(\d+)\s*년/) ||
                 query.match(/(\d+)\s*년\s*(?:추세|추이|변화|대비|간)/);
  if (nYears) {
    const n = parseInt(nYears[1], 10);
    if (n >= 2 && n <= 20) return n;
  }

  // "임기 N년", "취임 N년차"
  const imgi = query.match(/(?:임기|취임)\s*(\d+)\s*년/);
  if (imgi) {
    const n = parseInt(imgi[1], 10);
    if (n >= 1 && n <= 20) return Math.min(n + 1, 20); // 비교 위해 +1 시점 포함
  }

  // "작년 대비", "전년 대비", "전년동기"
  if (/(?:작년|전년)\s*(?:대비|동기)/.test(query)) return 2;

  // "역대", "장기"
  if (/역대|장기/.test(query)) return 20;

  return null;
}

export const quickTrendSchema = {
  name: 'quick_trend',
  description: `[빠른추세] 자연어 → 시계열 + 증감률 + 최고/최저 + 추세 한 번에 (기본 10년).

🔄 도구 라우팅:
• "~추세/추이/변화/증감/감소/증가/경향" → 이 도구
• 단일 시점 수치 → quick_stats
• 정책 영역(저출산/고령화/주거/일자리) 묶음 추세 → chain_policy_indicator
• 차원·항목 코드 알면 정밀 분석 → analyze_time_series

■ 자연어 자동 추출: keyword에 "광진구 인구 추이"처럼 통째 넣어도 추출됨
■ 자치구·시군 → 광역시도 fallback + 안내(자치구별은 fetch_kosis_excel 권장)
■ 별칭 자동 변환: 저출산→출산율, 고령화→고령인구, population 등
■ 자연어 기간 자동 추출: "지난 5년", "민선 8기"(=32년→상한 20), "임기 4년차", "작년 대비"(=2), "역대"(=20)
■ 장래추계 데이터(예: 노령화지수)는 isProjection=true + "추계" 안내 자동 부착`,
  inputSchema: z.object({
    keyword: z
      .string()
      .describe('통계 키워드만 입력 (추세/감소/증가/변화 등 수식어 제외). 예: "인구", "출산율", "실업률", "GDP", "고령인구"'),
    region: z
      .string()
      .optional()
      .describe('지역명 (선택, 미지정시 전국). 예: "서울", "부산"'),
    yearCount: z
      .number()
      .min(2)
      .max(20)
      .optional()
      .describe('분석 기간 (년 수). 미지정 시 keyword에서 "지난 N년"·"민선 N기"·"임기 N년차"·"작년 대비" 자연어 자동 추출. 모두 없으면 10.'),
  }),
};

export type QuickTrendInput = z.infer<typeof quickTrendSchema.inputSchema>;

export interface TrendDataPoint {
  year: string;
  value: number;
  formatted: string;
  changeRate?: string;
}

interface QuickTrendResult {
  success: boolean;
  keyword: string;
  region: string;
  trend: 'increasing' | 'decreasing' | 'stable' | 'fluctuating';
  trendDescription: string;
  summary: string;
  dataPoints: TrendDataPoint[];
  insights: string[];
  source?: {
    orgId: string;
    tableId: string;
    tableName: string;
  };
  isProjection?: boolean;
  note?: string;
}

/**
 * 지역명 목록 (쿼리에서 지역 추출용)
 */
const REGION_NAMES = [
  '서울', '부산', '대구', '인천', '광주', '대전', '울산', '세종', '경기',
  '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주'
];

export async function quickTrend(input: QuickTrendInput): Promise<QuickTrendResult> {
  const client = getKosisClient();
  const cache = getCacheManager();

  try {
    // 0. 빈 키워드 가드
    const trimmedKeyword = (input.keyword ?? '').trim();
    if (!trimmedKeyword) {
      return {
        success: false,
        keyword: input.keyword ?? '',
        region: '전국',
        trend: 'stable',
        trendDescription: '',
        summary: '추세 분석할 통계 키워드를 입력해주세요.',
        dataPoints: [],
        insights: [],
        note: '예: "인구", "출산율", "실업률", "GDP"',
      };
    }

    // 1. 키워드 추출 (자연어 → 정식 키워드) + 파라미터 조회
    const extractedKw = extractKeyword(trimmedKeyword);
    const param = getQuickStatsParam(extractedKw);

    if (!param) {
      const supportedKeywords = Object.keys(QUICK_STATS_PARAMS).slice(0, 30).join(', ') + ' 등';
      return {
        success: false,
        keyword: trimmedKeyword,
        region: '전국',
        trend: 'stable',
        trendDescription: '',
        summary: `"${trimmedKeyword}"에 대한 추세 분석이 지원되지 않습니다.`,
        dataPoints: [],
        insights: [],
        note: `지원 키워드: ${supportedKeywords}`,
      };
    }

    // 2. 지역 결정
    //   우선순위: input.region > keyword에서 추출한 자치구/광역시도
    //   자치구는 광역시도로 fallback + 안내
    let regionName = '전국';
    let objL1 = param.objL1;
    let districtNote: string | null = null;
    let requestedRegion: string | undefined = input.region?.trim() || undefined;
    let detectedDistrict: string | null = null;

    // input.region이 자치구 형식이면 자치구로 격하
    if (requestedRegion && DISTRICT_PATTERN.test(requestedRegion)) {
      detectedDistrict = requestedRegion;
      requestedRegion = undefined;
    }

    // input.region 없을 때 keyword에서 자치구/광역시도 자동 추출
    // 광역시도명도 함께 추출 — 모호한 자치구 disambiguate에 활용
    let provFromKw: string | null = null;
    if (!requestedRegion && !detectedDistrict) {
      detectedDistrict = extractDistrictName(trimmedKeyword);
      provFromKw = extractProvinceName(trimmedKeyword, false);
      if (!detectedDistrict && provFromKw) {
        requestedRegion = provFromKw;
      }
    }

    // 자치구 → 광역시도 fallback + 안내 (모호하면 광역시도 컨텍스트로 disambiguate)
    if (detectedDistrict) {
      let prov = findProvinceByDistrict(detectedDistrict);
      if (provFromKw && AMBIGUOUS_DISTRICTS[detectedDistrict]?.includes(provFromKw)) {
        const candidate = PROVINCES.find((p) => p.shortName === provFromKw);
        if (candidate) prov = candidate;
      }
      if (prov) {
        requestedRegion = prov.shortName;
        districtNote = `💡 "${detectedDistrict}" 자치구 시계열은 quick_trend가 지원하지 않아 ${prov.shortName} 광역시도 추세로 표시했습니다. 자치구별은 fetch_kosis_excel("${detectedDistrict}", "${extractedKw}")로 조회.`;
      } else if (provFromKw) {
        requestedRegion = provFromKw;
        districtNote = `💡 "${detectedDistrict}"은(는) 자치구 매핑이 모호합니다. ${provFromKw} 광역시도 추세로 표시합니다.`;
      } else {
        districtNote = `💡 "${detectedDistrict}"은(는) 자치구 매핑이 모호합니다 (여러 광역시도에 동명 자치구 존재 가능). 전국 추세로 표시합니다.`;
      }
    }

    if (requestedRegion && param.regionCodes) {
      const regionCode = getRegionCode(param, requestedRegion);
      if (regionCode !== param.objL1) {
        objL1 = regionCode;
        regionName = requestedRegion;
      }
    } else if (requestedRegion && !param.regionCodes) {
      return {
        success: false,
        keyword: extractedKw,
        region: requestedRegion,
        trend: 'stable',
        trendDescription: '',
        summary: `"${extractedKw}" 통계는 지역별 추세를 지원하지 않습니다. 전국 데이터만 제공됩니다.`,
        dataPoints: [],
        insights: [],
      };
    }

    // 3. 시계열 데이터 조회
    // 우선순위: input.yearCount 명시 > 키워드 자연어 추출 > default 10
    const naturalYearCount = extractYearCount(trimmedKeyword);
    const yearCount = input.yearCount ?? naturalYearCount ?? 10;
    const results = await cache.getStatisticsData(
      {
        orgId: param.orgId,
        tableId: param.tableId,
        objL1,
        objL2: param.objL2,
        itemId: param.itemId,
        periodType: 'Y',
        yearCount,
      },
      async () => {
        return client.getStatisticsData({
          orgId: param.orgId,
          tblId: param.tableId,
          objL1,
          objL2: param.objL2,
          itmId: param.itemId,
          prdSe: 'Y',
          newEstPrdCnt: yearCount,
        });
      }
    );

    if (results.length < 2) {
      return {
        success: false,
        keyword: extractedKw,
        region: regionName,
        trend: 'stable',
        trendDescription: '',
        summary: '추세 분석에 필요한 충분한 데이터가 없습니다.',
        dataPoints: [],
        insights: [],
        source: {
          orgId: param.orgId,
          tableId: param.tableId,
          tableName: param.tableName,
        },
      };
    }

    // 4. 데이터 정렬 및 분석
    const sortedData = results
      .map((r) => ({
        year: r.PRD_DE,
        value: parseFloat(r.DT.replace(/,/g, '')) || 0,
        formatted: r.DT,
      }))
      .sort((a, b) => a.year.localeCompare(b.year));

    const values = sortedData.map((d) => d.value);
    const { trend, avgGrowthRate, volatility } = analyzeTrend(values);

    // 5. 변화율 계산
    const dataPoints: TrendDataPoint[] = sortedData.map((d, i) => {
      if (i === 0) {
        return { ...d };
      }
      const prevValue = sortedData[i - 1].value;
      const changeRate = prevValue !== 0
        ? ((d.value - prevValue) / Math.abs(prevValue) * 100).toFixed(1)
        : '0';
      return {
        ...d,
        changeRate: `${parseFloat(changeRate) >= 0 ? '+' : ''}${changeRate}%`,
      };
    });

    // 6. 추세 설명 생성
    const trendDescriptions: Record<string, string> = {
      increasing: '지속적인 상승 추세',
      decreasing: '지속적인 하락 추세',
      stable: '안정적인 흐름',
      fluctuating: '변동이 큰 불안정한 흐름',
    };

    // 7. 최고/최저점 찾기
    const maxIdx = values.indexOf(Math.max(...values));
    const minIdx = values.indexOf(Math.min(...values));
    const firstValue = values[0];
    const lastValue = values[values.length - 1];
    const totalChange = firstValue !== 0
      ? ((lastValue - firstValue) / Math.abs(firstValue) * 100).toFixed(1)
      : '0';

    // 8. 인사이트 생성
    const insights: string[] = [];

    const trendEmoji = trend === 'increasing' ? '📈' : trend === 'decreasing' ? '📉' : '📊';
    insights.push(`${trendEmoji} **추세**: ${trendDescriptions[trend]}`);
    insights.push(`📊 **평균 변화율**: ${avgGrowthRate >= 0 ? '+' : ''}${avgGrowthRate.toFixed(1)}%/년`);
    insights.push(`🔝 **최고점**: ${sortedData[maxIdx].year}년 (${sortedData[maxIdx].formatted}${param.unit})`);
    insights.push(`🔻 **최저점**: ${sortedData[minIdx].year}년 (${sortedData[minIdx].formatted}${param.unit})`);
    insights.push(`📅 **전체 변화**: ${sortedData[0].year}→${sortedData[sortedData.length - 1].year}년, ${parseFloat(totalChange) >= 0 ? '+' : ''}${totalChange}%`);

    if (volatility > 20) {
      insights.push(`⚠️ **주의**: 변동성이 높습니다 (${volatility.toFixed(1)}%)`);
    }

    // 9. 추계 데이터 안내 (장래추계 테이블이면 모든 데이터포인트가 미래연도)
    const projectionNote = param.isProjection
      ? `⚠️ 본 시계열은 통계청 장래추계 데이터입니다 (실측 아닌 미래 추계). 정책·보고 인용 시 "추계" 명시 권장.`
      : null;

    // 10. 요약 생성
    const summary = `${regionName}의 ${param.description} ${sortedData.length}년 추세: ${trendDescriptions[trend]}입니다. ` +
      `${sortedData[0].year}년 ${sortedData[0].formatted}${param.unit}에서 ` +
      `${sortedData[sortedData.length - 1].year}년 ${sortedData[sortedData.length - 1].formatted}${param.unit}로 ` +
      `${parseFloat(totalChange) >= 0 ? '증가' : '감소'}했습니다 (${parseFloat(totalChange) >= 0 ? '+' : ''}${totalChange}%).\n\n` +
      `📊 출처: ${param.tableName} (KOSIS)` +
      (districtNote ? `\n\n${districtNote}` : '') +
      (projectionNote ? `\n\n${projectionNote}` : '');

    const combinedNote = [districtNote, projectionNote].filter(Boolean).join(' / ');

    return {
      success: true,
      keyword: extractedKw,
      region: regionName,
      trend,
      trendDescription: trendDescriptions[trend],
      summary,
      dataPoints,
      insights,
      source: {
        orgId: param.orgId,
        tableId: param.tableId,
        tableName: param.tableName,
      },
      ...(param.isProjection ? { isProjection: true } : {}),
      ...(combinedNote ? { note: combinedNote } : {}),
    };
  } catch (error) {
    console.error('Quick trend error:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      keyword: input.keyword,
      region: input.region || '전국',
      trend: 'stable',
      trendDescription: '',
      summary: `추세 분석 중 오류가 발생했습니다: ${errorMessage}`,
      dataPoints: [],
      insights: [],
      note: `analyze_time_series를 직접 사용해보세요.`,
    };
  }
}
