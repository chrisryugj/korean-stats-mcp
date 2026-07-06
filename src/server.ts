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
 * 마켓플레이스(playmcp 등) 광고용 메타데이터.
 *   - 서비스명: 모든 도구 description에 "Korean-stats-mcp" 접두 (등록 심사 요구 충족)
 *   - annotations: MCP ToolAnnotations. 14개 도구 모두 KOSIS 공식 DB read-only 조회(멱등) + 외부 API 호출.
 */
const SERVICE_NAME = 'Korean-stats-mcp';
const READONLY_ANN = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;

type ToolSchema = { name: string; description: string; inputSchema: { shape: z.ZodRawShape } };

/** server.tool 등록 래퍼 — 서비스명·annotations 일괄 주입, 핸들러 결과를 JSON 텍스트로 래핑 */
function registerTool(
  server: McpServer,
  schema: ToolSchema,
  handler: (args: any) => Promise<unknown>
): void {
  server.tool(
    schema.name,
    `${SERVICE_NAME} — ${schema.description}`,
    schema.inputSchema.shape,
    { ...READONLY_ANN },
    async (args: any) => ({
      content: [{ type: 'text' as const, text: JSON.stringify(await handler(args), null, 2) }],
    })
  );
}

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

  // ===== 도구 등록 (registerTool: 서비스명·annotations 자동 주입) =====
  registerTool(server, searchStatisticsSchema, searchStatistics);
  registerTool(server, getStatisticsListSchema, getStatisticsList);
  registerTool(server, getStatisticsDataSchema, getStatisticsData);
  registerTool(server, compareStatisticsSchema, compareStatistics);
  registerTool(server, analyzeTimeSeriesSchema, analyzeTimeSeries);
  registerTool(server, getTableInfoSchema, getTableInfo);
  registerTool(server, quickStatsSchema, quickStats);
  registerTool(server, quickTrendSchema, quickTrend);
  registerTool(server, quickRankSchema, quickRank);
  registerTool(server, explainStatisticSchema, explainStatistic);
  registerTool(server, fetchKosisExcelSchema, fetchKosisExcel);
  registerTool(server, chainRegionBriefSchema, chainRegionBrief);
  registerTool(server, chainCompareRegionsSchema, chainCompareRegions);
  registerTool(server, chainPolicyIndicatorSchema, chainPolicyIndicator);

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
