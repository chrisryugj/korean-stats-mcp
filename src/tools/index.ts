/**
 * MCP 도구 등록 통합
 */

export {
  searchStatistics,
  searchStatisticsSchema,
  type SearchStatisticsInput,
} from './searchStatistics.js';

export {
  getStatisticsList,
  getStatisticsListSchema,
  getAvailableViewCodes,
  getAvailableRecommendedTopics,
  type GetStatisticsListInput,
} from './getStatisticsList.js';

export {
  getStatisticsData,
  getStatisticsDataSchema,
  type GetStatisticsDataInput,
} from './getStatisticsData.js';

export {
  compareStatistics,
  compareStatisticsSchema,
  type CompareStatisticsInput,
} from './compareStatistics.js';

export {
  analyzeTimeSeries,
  analyzeTimeSeriesSchema,
  type AnalyzeTimeSeriesInput,
} from './analyzeTimeSeries.js';

// v1.4.0: get_recommended_statistics → get_statistics_list(recommendedTopic) 통폐합

// 경량화 후 재활성화: filter + sampleSize로 응답량 제한
export {
  getTableInfo,
  getTableInfoSchema,
  type GetTableInfoInput,
} from './getTableInfo.js';

export {
  quickStats,
  quickStatsSchema,
  type QuickStatsInput,
} from './quickStats.js';

export {
  quickTrend,
  quickTrendSchema,
  type QuickTrendInput,
} from './quickTrend.js';

export {
  fetchKosisExcel,
  fetchKosisExcelSchema,
  type FetchKosisExcelInput,
} from './fetchKosisExcel.js';

// 체인 도구 (공무원 업무 킬링 기능)
export {
  chainRegionBrief,
  chainRegionBriefSchema,
  type ChainRegionBriefInput,
  chainCompareRegions,
  chainCompareRegionsSchema,
  type ChainCompareRegionsInput,
  chainPolicyIndicator,
  chainPolicyIndicatorSchema,
  type ChainPolicyIndicatorInput,
} from './chains.js';

// 도구 스키마들은 개별적으로 export되어 있습니다.
// server.ts에서 직접 import하여 사용하세요.
