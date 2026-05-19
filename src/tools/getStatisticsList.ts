/**
 * 통계 목록 조회 도구
 * 주제별/기관별 트리 탐색 + 9개 분야 추천 카드 통합 (recommendedTopic 옵션)
 */

import { z } from 'zod';
import { getKosisClient } from '../api/client.js';
import { getCacheManager } from '../cache/index.js';
import { config } from '../config/index.js';
import type { ListItem, SimplifiedStatisticsItem } from '../api/types.js';

// ═══════════════════════════════════════════════════════════
// 추천 통계 (이전 get_recommended_statistics 흡수)
// ═══════════════════════════════════════════════════════════

const PRIORITY_TABLES: Record<string, Array<{ orgId: string; tableId: string; name: string }>> = {
  population: [
    { orgId: '101', tableId: 'DT_1B04005', name: '시도/성/연령별 주민등록인구' },
    { orgId: '101', tableId: 'DT_1IN1503', name: '주민등록인구현황' },
    { orgId: '101', tableId: 'DT_1B8000H', name: '인구동태건수 (출생/사망)' },
    { orgId: '101', tableId: 'DT_1B81A17', name: '합계출산율' },
    { orgId: '101', tableId: 'DT_1BPA002', name: '주요인구지표' },
  ],
  economy: [
    { orgId: '301', tableId: 'DT_200Y001', name: '국내총생산(GDP)' },
    { orgId: '101', tableId: 'DT_1J20001', name: '소비자물가지수' },
    { orgId: '101', tableId: 'DT_1J22001', name: '소비자물가 등락률' },
    { orgId: '301', tableId: 'DT_2AS004', name: '경제성장률' },
  ],
  employment: [
    { orgId: '101', tableId: 'DT_1DA7102S', name: '성/연령별 실업률' },
    { orgId: '101', tableId: 'DT_1DA7001', name: '경제활동인구총괄' },
    { orgId: '101', tableId: 'DT_1DA7012', name: '취업자수' },
    { orgId: '118', tableId: 'DT_118N_PAYM02', name: '평균임금' },
  ],
  housing: [
    { orgId: '116', tableId: 'DT_1YL21101', name: '아파트 매매/전세 가격지수' },
    { orgId: '116', tableId: 'DT_1YL20111E', name: '주택매매가격지수' },
    { orgId: '101', tableId: 'DT_1YL20001', name: '주택수' },
  ],
  education: [
    { orgId: '101', tableId: 'DT_1YL21121', name: '학생수' },
    { orgId: '101', tableId: 'DT_1YL21131', name: '학교수' },
  ],
  health: [
    { orgId: '101', tableId: 'DT_1B41', name: '기대수명' },
    { orgId: '101', tableId: 'DT_1B34E01', name: '사망원인' },
  ],
  environment: [
    { orgId: '106', tableId: 'DT_106N_99_2400001', name: '미세먼지 농도' },
  ],
  transport: [
    { orgId: '101', tableId: 'DT_1YL12001', name: '자동차등록현황' },
  ],
  social: [
    { orgId: '101', tableId: 'DT_1YL13001', name: '범죄발생 현황' },
  ],
};

const TOPIC_RECOMMENDATIONS: Record<string, {
  name: string;
  description: string;
  searchTerms: string[];
}> = {
  population: {
    name: '인구',
    description: '인구수, 출생, 사망, 혼인, 이혼 등',
    searchTerms: ['주민등록인구', '출생', '사망', '혼인', '합계출산율'],
  },
  economy: {
    name: '경제',
    description: 'GDP, 물가, 수출입, 경제성장률 등',
    searchTerms: ['GDP', '경제성장률', '소비자물가', '수출', '무역수지'],
  },
  employment: {
    name: '고용/노동',
    description: '취업자, 실업률, 임금, 근로시간 등',
    searchTerms: ['취업자', '실업률', '고용률', '임금', '근로시간'],
  },
  housing: {
    name: '주거/부동산',
    description: '주택가격, 전월세, 주거환경 등',
    searchTerms: ['아파트가격', '전세', '주택매매', '월세', '주거'],
  },
  education: {
    name: '교육',
    description: '학생수, 학교, 진학률, 사교육비 등',
    searchTerms: ['학생수', '학교', '진학률', '사교육비', '대학'],
  },
  health: {
    name: '보건/의료',
    description: '기대수명, 의료비, 건강보험 등',
    searchTerms: ['기대수명', '의료비', '건강보험', '병원', '사망원인'],
  },
  environment: {
    name: '환경',
    description: '대기질, 미세먼지, 폐기물, 에너지 등',
    searchTerms: ['미세먼지', '대기오염', '폐기물', '재활용', '탄소배출'],
  },
  transport: {
    name: '교통',
    description: '자동차, 대중교통, 도로, 사고 등',
    searchTerms: ['자동차등록', '대중교통', '교통사고', '도로'],
  },
  social: {
    name: '사회/복지',
    description: '사회보장, 범죄, 안전, 문화 등',
    searchTerms: ['사회보장', '범죄', '안전', '문화', '여가'],
  },
};

const RELATED_TOPICS: Record<string, string[]> = {
  population: ['economy', 'housing', 'social'],
  economy: ['employment', 'housing', 'transport'],
  employment: ['economy', 'education', 'social'],
  housing: ['economy', 'population', 'transport'],
  education: ['employment', 'social', 'population'],
  health: ['social', 'environment', 'population'],
  environment: ['health', 'transport', 'economy'],
  transport: ['environment', 'housing', 'economy'],
  social: ['health', 'education', 'population'],
};

export const getStatisticsListSchema = {
  name: 'get_statistics_list',
  description:
    '[목록탐색] 주제별/기관별/지방지표/국제/북한 통계 트리 탐색 + 9개 분야 추천 카드 통합. recommendedTopic 옵션 사용 시 추천 카드(분야별 핵심 통계표 5개) 반환. parentId로 트리 단계별 진입. "무엇을 봐야 할지 모를 때" recommendedTopic 사용.',
  inputSchema: z.object({
    viewCode: z
      .string()
      .transform((val) => {
        if (!val || val.trim() === '') return 'MT_ZTITLE';
        return val;
      })
      .pipe(
        z.enum([
          'MT_ZTITLE',
          'MT_OTITLE',
          'MT_GTITLE01',
          'MT_GTITLE02',
          'MT_RTITLE',
          'MT_BUKHAN',
          'MT_TM1_TITLE',
          'MT_TM2_TITLE',
        ])
      )
      .describe(
        '서비스뷰 코드: MT_ZTITLE(주제별, 기본값), MT_OTITLE(기관별), MT_GTITLE01(e-지방지표 주제별), MT_GTITLE02(e-지방지표 지역별), MT_RTITLE(국제통계), MT_BUKHAN(북한통계)'
      ),
    parentId: z
      .string()
      .optional()
      .default('')
      .describe('상위 목록 ID (비어있으면 최상위 목록 조회). recommendedTopic 사용 시 무시됨.'),
    recommendedTopic: z
      .enum([
        'population',
        'economy',
        'employment',
        'housing',
        'education',
        'health',
        'environment',
        'transport',
        'social',
      ])
      .optional()
      .describe(
        '[추천 모드] 9개 분야 추천 카드. 지정 시 트리 탐색 대신 분야별 핵심 통계표 반환. population(인구), economy(경제), employment(고용), housing(주거), education(교육), health(보건), environment(환경), transport(교통), social(사회)'
      ),
    limit: z
      .number()
      .min(1)
      .max(20)
      .optional()
      .default(5)
      .describe('recommendedTopic 사용 시 추천 개수 (기본 5)'),
  }),
};

export type GetStatisticsListInput = z.infer<typeof getStatisticsListSchema.inputSchema>;

type ListResult = {
  success: boolean;
  viewName: string;
  parentId: string;
  items: ListItem[];
  hasMore: boolean;
  navigation?: {
    canGoUp: boolean;
    instruction: string;
  };
};

type RecommendedResult = {
  success: boolean;
  mode: 'recommended';
  topic: { code: string; name: string; description: string };
  recommendations: SimplifiedStatisticsItem[];
  relatedTopics: string[];
  searchSuggestions: string[];
};

export async function getStatisticsList(
  input: GetStatisticsListInput
): Promise<ListResult | RecommendedResult> {
  const client = getKosisClient();
  const cache = getCacheManager();

  // 추천 모드 — 9개 분야 카드
  if (input.recommendedTopic) {
    const topicInfo = TOPIC_RECOMMENDATIONS[input.recommendedTopic];
    if (!topicInfo) {
      return {
        success: false,
        mode: 'recommended',
        topic: { code: input.recommendedTopic, name: '알 수 없음', description: '' },
        recommendations: [],
        relatedTopics: [],
        searchSuggestions: [],
      };
    }

    try {
      const limit = input.limit ?? 5;
      const recommendations: SimplifiedStatisticsItem[] = [];

      const priorityTables = PRIORITY_TABLES[input.recommendedTopic] || [];
      for (const table of priorityTables) {
        if (recommendations.length >= limit) break;
        recommendations.push({
          orgId: table.orgId,
          orgName:
            table.orgId === '101'
              ? '통계청'
              : table.orgId === '301'
              ? '한국은행'
              : table.orgId === '116'
              ? '한국부동산원'
              : '기타기관',
          tableId: table.tableId,
          tableName: table.name,
          statisticsName: topicInfo.name + ' 통계',
          period: '',
          periodType: '',
          lastUpdated: '',
          isPriority: true,
        } as SimplifiedStatisticsItem);
      }

      if (recommendations.length < limit) {
        const searchResults = await cache.getSearchResults(
          { topic: input.recommendedTopic, limit },
          async () => {
            const allResults = [];
            for (const term of topicInfo.searchTerms.slice(0, 2)) {
              const results = await client.searchStatistics(term, {
                sort: 'RANK',
                startCount: 1,
                resultCount: Math.ceil(limit / 2),
              });
              allResults.push(...results);
            }
            return allResults;
          }
        );

        const addedTableIds = new Set(recommendations.map((r) => r.tableId));
        for (const item of searchResults) {
          if (recommendations.length >= limit) break;
          if (addedTableIds.has(item.TBL_ID)) continue;
          recommendations.push({
            orgId: item.ORG_ID,
            orgName: item.ORG_NM,
            tableId: item.TBL_ID,
            tableName: item.TBL_NM,
            statisticsName: item.STAT_NM,
            period:
              item.STRT_PRD_DE && item.END_PRD_DE
                ? `${item.STRT_PRD_DE}~${item.END_PRD_DE}`
                : item.STRT_PRD_DE || item.END_PRD_DE || '',
            periodType: item.VW_CD || '',
            lastUpdated: item.END_PRD_DE,
          });
          addedTableIds.add(item.TBL_ID);
        }
      }

      return {
        success: true,
        mode: 'recommended',
        topic: {
          code: input.recommendedTopic,
          name: topicInfo.name,
          description: topicInfo.description,
        },
        recommendations,
        relatedTopics: RELATED_TOPICS[input.recommendedTopic] || [],
        searchSuggestions: topicInfo.searchTerms,
      };
    } catch (error) {
      console.error('Recommendation error:', error);
      return {
        success: false,
        mode: 'recommended',
        topic: {
          code: input.recommendedTopic,
          name: topicInfo.name,
          description: topicInfo.description,
        },
        recommendations: [],
        relatedTopics: [],
        searchSuggestions: topicInfo.searchTerms,
      };
    }
  }

  // 일반 트리 탐색 모드
  const viewName =
    config.viewCodes[input.viewCode as keyof typeof config.viewCodes] || input.viewCode;

  try {
    const results = await cache.getStatisticsList(
      { viewCode: input.viewCode, parentId: input.parentId },
      async () => {
        return client.getStatisticsList(input.viewCode, input.parentId);
      }
    );

    const items: ListItem[] = results.map((item) => {
      const isTable = !!item.TBL_ID;
      return {
        id: isTable ? item.TBL_ID! : item.LIST_ID!,
        name: isTable ? item.TBL_NM! : item.LIST_NM!,
        isTable,
        orgId: item.ORG_ID,
        tableId: item.TBL_ID,
        tableName: item.TBL_NM,
      };
    });

    const hasMore = items.some((item) => !item.isTable);
    const canGoUp = input.parentId !== '';

    return {
      success: true,
      viewName,
      parentId: input.parentId,
      items,
      hasMore,
      navigation: {
        canGoUp,
        instruction: hasMore
          ? '폴더 ID를 parentId로 전달하면 하위 목록을 조회할 수 있습니다. 또는 recommendedTopic 옵션으로 분야별 추천 카드 사용.'
          : '통계표 ID와 기관 ID를 사용하여 get_statistics_data로 데이터를 조회하세요.',
      },
    };
  } catch (error) {
    console.error('List error:', error);
    return {
      success: false,
      viewName,
      parentId: input.parentId,
      items: [],
      hasMore: false,
    };
  }
}

/**
 * 사용 가능한 서비스뷰 목록 반환
 */
export function getAvailableViewCodes(): Array<{
  code: string;
  name: string;
  description: string;
}> {
  return [
    { code: 'MT_ZTITLE', name: '국내통계 주제별', description: '주제(인구, 경제 등)로 분류된 국내 통계' },
    { code: 'MT_OTITLE', name: '국내통계 기관별', description: '작성기관별로 분류된 국내 통계' },
    { code: 'MT_GTITLE01', name: 'e-지방지표(주제별)', description: '지방자치단체 통계 (주제별)' },
    { code: 'MT_GTITLE02', name: 'e-지방지표(지역별)', description: '지방자치단체 통계 (지역별)' },
    { code: 'MT_RTITLE', name: '국제통계', description: 'OECD, UN 등 국제기구 통계' },
    { code: 'MT_BUKHAN', name: '북한통계', description: '북한 관련 통계' },
    { code: 'MT_TM1_TITLE', name: '대상별통계', description: '여성, 청소년, 고령자 등 대상별 통계' },
    { code: 'MT_TM2_TITLE', name: '이슈별통계', description: '사회적 이슈별 통계' },
  ];
}

/**
 * 추천 토픽 목록 (이전 getAvailableTopics와 동일)
 */
export function getAvailableRecommendedTopics(): Array<{
  code: string;
  name: string;
  description: string;
}> {
  return Object.entries(TOPIC_RECOMMENDATIONS).map(([code, info]) => ({
    code,
    name: info.name,
    description: info.description,
  }));
}
