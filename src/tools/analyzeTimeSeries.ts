/**
 * 시계열 분석 도구
 * 통계 데이터의 시계열 추세를 분석
 */

import { z } from 'zod';
import { getKosisClient } from '../api/client.js';
import { getCacheManager } from '../cache/index.js';
import { analyzeTrend, formatPeriod } from '../utils/dataFormatter.js';

export const analyzeTimeSeriesSchema = {
  name: 'analyze_time_series',
  description:
    '[시계열정밀] orgId+tableId+objL1+itemId 명시한 정밀 시계열 분석. 증감/추세/성장률/변동성. 키워드만 알면 quick_trend가 즉시 응답 (자치구 fallback도 자동). 차원·항목 코드는 먼저 get_table_info로 확인.',
  inputSchema: z.object({
    orgId: z.string().describe('기관 ID'),
    tableId: z.string().describe('통계표 ID'),
    objL1: z
      .string()
      .describe('분류1 코드 (필수) - get_table_info로 유효한 값 조회 필요. 예: "00"(전국), "0"(계)'),
    objL2: z
      .string()
      .optional()
      .describe('분류2 코드 (선택) - 일부 테이블에서 필요. 예: 실업률 테이블의 연령계층별 "00"(계)'),
    itemId: z
      .string()
      .describe('항목 ID (필수) - get_table_info로 유효한 값 조회 필요. 예: "T10"(출생건수)'),
    periodType: z
      .enum(['Y', 'M', 'Q'])
      .describe('주기: Y(년), M(월), Q(분기)'),
    yearCount: z
      .number()
      .min(2)
      .max(30)
      .optional()
      .default(10)
      .describe('분석할 기간 수 (기본: 10)'),
  }),
};

export type AnalyzeTimeSeriesInput = z.infer<typeof analyzeTimeSeriesSchema.inputSchema>;

interface TimeSeriesAnalysis {
  trend: 'increasing' | 'decreasing' | 'stable' | 'fluctuating';
  trendDescription: string;
  averageGrowthRate: number;
  volatility: number;
  maxValue: { period: string; value: number; formatted: string };
  minValue: { period: string; value: number; formatted: string };
  recentChange: {
    rate: number;
    direction: 'up' | 'down' | 'stable';
    formatted: string;
  };
  forecast?: string;
}

export async function analyzeTimeSeries(
  input: AnalyzeTimeSeriesInput
): Promise<{
  success: boolean;
  tableName?: string;
  unit?: string;
  analysis?: TimeSeriesAnalysis;
  dataPoints: Array<{ period: string; value: number }>;
  interpretation: string[];
}> {
  const client = getKosisClient();
  const cache = getCacheManager();

  try {
    // 데이터 조회
    const results = await cache.getStatisticsData(
      {
        orgId: input.orgId,
        tableId: input.tableId,
        objL1: input.objL1,
        objL2: input.objL2,
        itemId: input.itemId,
        periodType: input.periodType,
        yearCount: input.yearCount,
      },
      async () => {
        return client.getStatisticsData({
          orgId: input.orgId,
          tblId: input.tableId,
          objL1: input.objL1,
          objL2: input.objL2,
          itmId: input.itemId,
          prdSe: input.periodType,
          newEstPrdCnt: input.yearCount,
        });
      }
    );

    if (results.length < 2) {
      return {
        success: true,
        dataPoints: [],
        interpretation: [
          '분석에 필요한 충분한 데이터가 없습니다.',
          `사용된 파라미터: objL1="${input.objL1}", itemId="${input.itemId}"`,
          '',
          '💡 해결 방법:',
          '1. get_table_info로 유효한 분류/항목 코드를 확인하세요.',
          '2. 예시: objL1="00"(전국) 또는 "11"(서울), itemId="T10"(출생건수)',
        ],
      };
    }

    // 데이터 정리 (시간순 정렬)
    const sortedData = results
      .map((r) => ({
        period: r.PRD_DE,
        value: parseFloat(r.DT.replace(/,/g, '')) || 0,
        formatted: r.DT,
      }))
      .sort((a, b) => a.period.localeCompare(b.period));

    const values = sortedData.map((d) => d.value);
    const { trend, avgGrowthRate, volatility } = analyzeTrend(values);

    // 최대/최소값 찾기
    const maxIdx = values.indexOf(Math.max(...values));
    const minIdx = values.indexOf(Math.min(...values));

    // 최근 변화율
    const lastValue = values[values.length - 1];
    const prevValue = values[values.length - 2];
    const recentChangeRate = prevValue !== 0 ? ((lastValue - prevValue) / Math.abs(prevValue)) * 100 : 0;

    const analysis: TimeSeriesAnalysis = {
      trend,
      trendDescription: getTrendDescription(trend),
      averageGrowthRate: Math.round(avgGrowthRate * 100) / 100,
      volatility: Math.round(volatility * 100) / 100,
      maxValue: {
        period: formatPeriod(sortedData[maxIdx].period, input.periodType),
        value: sortedData[maxIdx].value,
        formatted: sortedData[maxIdx].formatted,
      },
      minValue: {
        period: formatPeriod(sortedData[minIdx].period, input.periodType),
        value: sortedData[minIdx].value,
        formatted: sortedData[minIdx].formatted,
      },
      recentChange: {
        rate: Math.round(recentChangeRate * 100) / 100,
        direction: recentChangeRate > 0.1 ? 'up' : recentChangeRate < -0.1 ? 'down' : 'stable',
        formatted: `${recentChangeRate > 0 ? '+' : ''}${recentChangeRate.toFixed(1)}%`,
      },
    };

    // 예측 (단순 선형 추세)
    if (trend === 'increasing') {
      analysis.forecast = `현재 추세가 지속된다면 향후 지속적인 증가가 예상됩니다.`;
    } else if (trend === 'decreasing') {
      analysis.forecast = `현재 추세가 지속된다면 향후 지속적인 감소가 예상됩니다.`;
    }

    // 해석 생성
    const interpretation: string[] = [];
    interpretation.push(
      `📊 **추세**: ${analysis.trendDescription}`
    );
    interpretation.push(
      `📈 **평균 성장률**: ${analysis.averageGrowthRate > 0 ? '+' : ''}${analysis.averageGrowthRate}%`
    );
    interpretation.push(
      `🔝 **최고점**: ${analysis.maxValue.period} (${analysis.maxValue.formatted})`
    );
    interpretation.push(
      `🔻 **최저점**: ${analysis.minValue.period} (${analysis.minValue.formatted})`
    );
    interpretation.push(
      `📅 **최근 변화**: ${analysis.recentChange.formatted}`
    );

    if (volatility > 20) {
      interpretation.push(
        `⚠️ **주의**: 변동성이 높습니다 (${volatility.toFixed(1)}%). 데이터 해석에 주의가 필요합니다.`
      );
    }

    if (analysis.forecast) {
      interpretation.push(`🔮 **전망**: ${analysis.forecast}`);
    }

    return {
      success: true,
      tableName: results[0].TBL_NM,
      unit: results[0].UNIT_NM,
      analysis,
      dataPoints: sortedData.map((d) => ({
        period: formatPeriod(d.period, input.periodType),
        value: d.value,
      })),
      interpretation,
    };
  } catch (error) {
    console.error('Analysis error:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);

    return {
      success: false,
      dataPoints: [],
      interpretation: [
        '## 시계열 분석 중 오류 발생',
        '',
        '### 사용된 파라미터',
        `- orgId: "${input.orgId}"`,
        `- tableId: "${input.tableId}"`,
        `- objL1: "${input.objL1}"`,
        `- itemId: "${input.itemId}"`,
        `- periodType: "${input.periodType}"`,
        '',
        '### 오류 내용',
        errorMessage,
        '',
        '### 해결 방법',
        '1. **get_table_info 먼저 호출**하여 유효한 코드 확인:',
        '   ```json',
        `   { "orgId": "${input.orgId}", "tableId": "${input.tableId}" }`,
        '   ```',
        '',
        '2. **파라미터 확인**:',
        '   - objL1: 지역 코드 (예: "00"=전국, "11"=서울)',
        '   - itemId: 항목 코드 (예: "T10", "T1")',
        '   - ⚠️ OBJ_ID(예: "ITEM", "A")가 아닌 실제 분류값 코드 사용',
        '',
        '### 올바른 호출 예시',
        '```json',
        '{',
        `  "orgId": "${input.orgId}",`,
        `  "tableId": "${input.tableId}",`,
        '  "objL1": "00",',
        '  "itemId": "T1",',
        '  "periodType": "Y",',
        '  "yearCount": 10',
        '}',
        '```',
      ],
    };
  }
}

function getTrendDescription(trend: string): string {
  switch (trend) {
    case 'increasing':
      return '지속적인 상승 추세를 보이고 있습니다.';
    case 'decreasing':
      return '지속적인 하락 추세를 보이고 있습니다.';
    case 'stable':
      return '안정적인 흐름을 유지하고 있습니다.';
    case 'fluctuating':
      return '변동이 큰 불안정한 흐름을 보이고 있습니다.';
    default:
      return '추세를 파악하기 어렵습니다.';
  }
}
