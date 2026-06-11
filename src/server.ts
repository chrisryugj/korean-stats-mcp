/**
 * Korea Stats MCP 서버
 * 국가데이터처 KOSIS OpenAPI 기반 MCP 서버
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createRequire } from 'node:module';
import { z } from 'zod';

// 버전 단일 출처 — package.json (server.ts·server-http.ts 하드코딩 drift 방지)
const pkg = createRequire(import.meta.url)('../package.json') as { version: string };
export const SERVER_VERSION: string = pkg.version;
/** MCP 도구 수 — /health·루트 응답용. 도구 추가 시 server.tool 등록과 함께 갱신. */
export const TOOL_COUNT = 14;

// 도구 가져오기
import {
  searchStatistics,
  searchStatisticsSchema,
  getStatisticsList,
  getStatisticsListSchema,
  getStatisticsData,
  getStatisticsDataSchema,
  compareStatistics,
  compareStatisticsSchema,
  analyzeTimeSeries,
  analyzeTimeSeriesSchema,
  getTableInfo,
  getTableInfoSchema,
  quickStats,
  quickStatsSchema,
  quickTrend,
  quickTrendSchema,
  quickRank,
  quickRankSchema,
  explainStatistic,
  explainStatisticSchema,
  fetchKosisExcel,
  fetchKosisExcelSchema,
  chainRegionBrief,
  chainRegionBriefSchema,
  chainCompareRegions,
  chainCompareRegionsSchema,
  chainPolicyIndicator,
  chainPolicyIndicatorSchema,
} from './tools/index.js';

// 리소스 가져오기
import { getCategoryTreeJson, getKeyIndicatorsJson } from './resources/index.js';

// 프롬프트 가져오기
import {
  statisticsAssistantPromptSchema,
  generateStatisticsAssistantPrompt,
} from './prompts/index.js';

// 설정 가져오기
import { config, validateConfig } from './config/index.js';

/**
 * MCP 서버 생성 및 설정
 */
export function createServer(): McpServer {
  // 설정 유효성 검사
  validateConfig();

  const server = new McpServer({
    name: 'korean-stats-mcp',
    version: SERVER_VERSION,
    description:
      '한국 국가데이터처 KOSIS OpenAPI 기반 MCP 서버 - 92개 키워드, 17 시도 + 자치구 230+ 라우팅, 시계열 추세, 전국 순위(quick_rank), 출처 각주 생성(explain_statistic), 3개 체인 도구(지역 브리핑·다지역 비교·정책 영역) — 공무원 업무 종합 통계 도우미. v1.8.0: 지역명 미인식 시 전국값 대체 금지(에러 반환), 유사 지표 silent 치환 제거(청년실업률·연봉), 노령화지수 실측표(DT_1IN2030) 교체, 인구동향 잠정치 안내, 출처에 표 ID·자료수정일 포함.',
  });

  // ===== 도구 등록 =====

  // 1. 통계 검색
  server.tool(
    searchStatisticsSchema.name,
    searchStatisticsSchema.description,
    searchStatisticsSchema.inputSchema.shape,
    async (args) => {
      const result = await searchStatistics(args as any);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  // 2. 통계 목록 조회
  server.tool(
    getStatisticsListSchema.name,
    getStatisticsListSchema.description,
    getStatisticsListSchema.inputSchema.shape,
    async (args) => {
      const result = await getStatisticsList(args as any);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  // 3. 통계 데이터 조회
  server.tool(
    getStatisticsDataSchema.name,
    getStatisticsDataSchema.description,
    getStatisticsDataSchema.inputSchema.shape,
    async (args) => {
      const result = await getStatisticsData(args as any);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  // 4. 통계 비교
  server.tool(
    compareStatisticsSchema.name,
    compareStatisticsSchema.description,
    compareStatisticsSchema.inputSchema.shape,
    async (args) => {
      const result = await compareStatistics(args as any);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  // 5. 시계열 분석
  server.tool(
    analyzeTimeSeriesSchema.name,
    analyzeTimeSeriesSchema.description,
    analyzeTimeSeriesSchema.inputSchema.shape,
    async (args) => {
      const result = await analyzeTimeSeries(args as any);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  // 6. 통계표 정보 조회 (경량화 — filter + sampleSize)
  server.tool(
    getTableInfoSchema.name,
    getTableInfoSchema.description,
    getTableInfoSchema.inputSchema.shape,
    async (args) => {
      const result = await getTableInfo(args as any);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  // 8. 빠른 통계 조회 (원스텝)
  server.tool(
    quickStatsSchema.name,
    quickStatsSchema.description,
    quickStatsSchema.inputSchema.shape,
    async (args) => {
      const result = await quickStats(args as any);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  // 9. 빠른 추세 분석 (시계열)
  server.tool(
    quickTrendSchema.name,
    quickTrendSchema.description,
    quickTrendSchema.inputSchema.shape,
    async (args) => {
      const result = await quickTrend(args as any);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  // 9.5. 전국 순위 카드 — "우리 지역 몇 위?"
  server.tool(
    quickRankSchema.name,
    quickRankSchema.description,
    quickRankSchema.inputSchema.shape,
    async (args) => {
      const result = await quickRank(args as any);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // 9.6. 통계설명·인용 각주 생성기
  server.tool(
    explainStatisticSchema.name,
    explainStatisticSchema.description,
    explainStatisticSchema.inputSchema.shape,
    async (args) => {
      const result = await explainStatistic(args as any);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // 10. KOSIS 엑셀 파일 통계표 파싱 (OpenAPI 미지원 통계 — 자치구 기본통계 등)
  server.tool(
    fetchKosisExcelSchema.name,
    fetchKosisExcelSchema.description,
    fetchKosisExcelSchema.inputSchema.shape,
    async (args) => {
      const result = await fetchKosisExcel(args as any);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  // 11. 체인 — 지역 한장 종합 브리핑 (공무원 킬링 기능)
  server.tool(
    chainRegionBriefSchema.name,
    chainRegionBriefSchema.description,
    chainRegionBriefSchema.inputSchema.shape,
    async (args) => {
      const result = await chainRegionBrief(args as any);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // 12. 체인 — N지역 × M지표 비교 매트릭스
  server.tool(
    chainCompareRegionsSchema.name,
    chainCompareRegionsSchema.description,
    chainCompareRegionsSchema.inputSchema.shape,
    async (args) => {
      const result = await chainCompareRegions(args as any);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // 13. 체인 — 정책 영역 묶음 시계열
  server.tool(
    chainPolicyIndicatorSchema.name,
    chainPolicyIndicatorSchema.description,
    chainPolicyIndicatorSchema.inputSchema.shape,
    async (args) => {
      const result = await chainPolicyIndicator(args as any);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // ===== 리소스 등록 =====

  // 1. 통계 분류 체계
  server.resource(
    'category-tree',
    'kosis://categories/tree',
    {
      description: 'KOSIS 통계 분류 체계 - 주제별/기관별 분류 구조',
      mimeType: 'application/json',
    },
    async () => ({
      contents: [
        {
          uri: 'kosis://categories/tree',
          text: getCategoryTreeJson(),
          mimeType: 'application/json',
        },
      ],
    })
  );

  // 2. 주요 지표 목록
  server.resource(
    'key-indicators',
    'kosis://indicators/list',
    {
      description: '자주 조회되는 주요 경제사회 지표 목록',
      mimeType: 'application/json',
    },
    async () => ({
      contents: [
        {
          uri: 'kosis://indicators/list',
          text: getKeyIndicatorsJson(),
          mimeType: 'application/json',
        },
      ],
    })
  );

  // ===== 프롬프트 등록 =====

  server.prompt(
    statisticsAssistantPromptSchema.name,
    statisticsAssistantPromptSchema.description,
    statisticsAssistantPromptSchema.argsSchema.shape,
    async (args) => {
      const result = generateStatisticsAssistantPrompt(args.question as string);
      return {
        messages: result.messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
      };
    }
  );

  return server;
}
