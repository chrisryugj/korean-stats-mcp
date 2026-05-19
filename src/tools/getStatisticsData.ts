/**
 * 통계 데이터 조회 도구
 * 특정 통계표의 실제 데이터를 조회
 */

import { z } from 'zod';
import { getKosisClient } from '../api/client.js';
import { getCacheManager } from '../cache/index.js';
import { simplifyStatisticsData, recommendVisualization } from '../utils/dataFormatter.js';
import { resolveDimensions, summarizeTableMeta, type ResolveResult } from '../utils/metaLookup.js';
import type { SimplifiedDataItem } from '../api/types.js';

export const getStatisticsDataSchema = {
  name: 'get_statistics_data',
  description: `특정 통계표의 실제 데이터를 조회합니다.

자동 메타 lookup 지원:
• regionName="광진구" 처럼 자치구·시·군 이름을 주면 objL1·objL2가 자동으로 채워집니다 (시군구별/자치구별/구군별/행정구역별 OBJ에서 매칭).
• itemName으로 항목명 매칭도 가능 (예: "여자", "65세이상").
• objL1·itemId를 직접 넣으면 lookup 없이 그 값 사용.

자치구·시·군 통계 조회 경로 (광역시도별로 패턴이 다름):

【Path A — 광역시도 기본통계 시리즈】 가장 일반적
• 서울: orgId=201, tblId=DT_201004_* (예: DT_201004_O110054 보육시설)
• 부산: orgId=202, tblId=DT_xxx (예: DT_202 구·군별 세대 및 등록인구)
• 대구: orgId=203, tblId=DT_Bxxxxx (예: DT_B40001 구군별 세대 및 등록인구)
• 인천 이하: 자치구별 [구군별]/[행정구역별] 분류에 ITM_NM으로 자치구가 들어있음
• 광역시도별 LIST_ID 패턴이 다르므로, search_statistics 로 표 ID 먼저 확인

【Path B — 자치구 단독 OpenAPI 시리즈】 챕터별 세분화 통계
• orgId=5xx (자치구 코드), tblId=DT_<자치구코드>0?_<챕터><번호>
• 예: 해운대구 orgId=539, tblId=DT_53902_B001003 (인구추이)
• 예: 수성구 orgId=556, tblId=DT_55601_B001003 (인구추이)
• regionName 없이 그대로 조회 (이미 자치구 한정 표)

【Path C — 통계청 e-지방지표 (orgId=101)】 256개 행정구역 통합
• DT_1YLxxxxx 시리즈 (예: DT_1YL15001 학급당 학생수)
• regionName="수성구" / "해운대구" 등 모든 시군구가 [행정구역별] 분류에 들어있음
• 광역시도 기본통계가 미비할 때 가장 광범위한 폴백

ITM_ID는 통계표마다 다른 코드 체계를 쓰므로(예: "001005", "1520213102303231A.09", "22060"), 직접 입력 대신 regionName/itemName 사용을 권장합니다.

「OO광역시도 OO구 기본통계」 컨테이너 LIST_ID(예: 201_201A_505_50501)는 직접 조회하지 말 것 — TBL_ID가 아님.`,
  inputSchema: z.object({
    orgId: z.string().describe('기관 ID (예: 201 = 서울특별시)'),
    tableId: z.string().describe('통계표 ID (예: DT_201004_O110054)'),
    regionName: z
      .string()
      .optional()
      .describe('자치구·시·군 이름 (예: "광진구", "수성구"). 주어지면 objL1/objL2 자동 lookup. 전국·합계는 비워둠.'),
    itemName: z
      .string()
      .optional()
      .describe('항목 이름 (예: "여자", "총인구"). 주어지면 itemId 자동 lookup. 보통 통계표 항목이 하나면 생략.'),
    objL1: z
      .string()
      .optional()
      .describe('분류1 코드 직접 지정 (선택). regionName이 있으면 무시.'),
    objL2: z.string().optional().describe('분류2 코드 (선택)'),
    objL3: z.string().optional().describe('분류3 코드 (선택)'),
    objL4: z.string().optional().describe('분류4 코드 (선택)'),
    itemId: z
      .string()
      .optional()
      .describe('항목 ID 직접 지정 (선택). itemName이 있으면 무시.'),
    periodType: z
      .enum(['Y', 'M', 'Q', 'S', 'D', 'F', 'IR'])
      .describe(
        '주기: Y(년), M(월), Q(분기), S(반기), D(일), F(다년), IR(부정기)'
      ),
    startPeriod: z
      .string()
      .optional()
      .describe('시작 시점 (예: 2020, 202001)'),
    endPeriod: z
      .string()
      .optional()
      .describe('종료 시점 (예: 2024, 202412)'),
    recentCount: z
      .number()
      .min(1)
      .max(100)
      .optional()
      .describe('최근 N개 시점 (startPeriod/endPeriod 대신 사용)'),
  }),
};

export type GetStatisticsDataInput = z.infer<typeof getStatisticsDataSchema.inputSchema>;

export async function getStatisticsData(
  input: GetStatisticsDataInput
): Promise<{
  success: boolean;
  tableName?: string;
  unit?: string;
  data: SimplifiedDataItem[];
  totalCount: number;
  visualization?: {
    recommendedType: string;
    reason: string;
  };
  metadata?: {
    orgId: string;
    tableId: string;
    periodType: string;
    periodRange?: string;
  };
  resolved?: ResolveResult['resolved'];
  usageHint?: string;
}> {
  const client = getKosisClient();
  const cache = getCacheManager();

  try {
    // 자동 메타 lookup — regionName/itemName이 있거나 objL1/itemId가 비어있으면 실행
    let resolvedObjL1 = input.objL1;
    let resolvedObjL2 = input.objL2;
    let resolvedObjL3 = input.objL3;
    let resolvedObjL4 = input.objL4;
    let resolvedItmId = input.itemId;
    let resolveLog: ResolveResult['resolved'] = [];

    const needsLookup =
      input.regionName ||
      input.itemName ||
      (!input.objL1 && !input.itemId);

    if (needsLookup) {
      const r = await resolveDimensions(input.orgId, input.tableId, {
        regionName: input.regionName,
        itemName: input.itemName,
      });

      // 명시적 regionName/itemName 매칭 실패 → 잘못된 폴백 데이터 방지 위해 즉시 에러
      if (r.unmatched) {
        const candidateLines = r.candidates
          ? Object.entries(r.candidates)
              .map(([objNm, names]) => `  - ${objNm}: ${names.slice(0, 8).join(', ')}${names.length > 8 ? ' ...' : ''}`)
              .join('\n')
          : '';
        const missMsg = [
          r.unmatched.regionName ? `regionName="${r.unmatched.regionName}"` : '',
          r.unmatched.itemName ? `itemName="${r.unmatched.itemName}"` : '',
        ].filter(Boolean).join(', ');

        return {
          success: false,
          data: [],
          totalCount: 0,
          metadata: {
            orgId: input.orgId,
            tableId: input.tableId,
            periodType: input.periodType,
          },
          resolved: r.resolved,
          usageHint: `
## 메타 lookup 실패

요청한 ${missMsg} 이(가) 이 통계표의 어느 분류에서도 매칭되지 않았습니다.

### 사용 가능한 후보
${candidateLines || '(메타 정보 없음)'}

### 해결
1. 광역시도가 다른 자치구일 수 있습니다. 광역시도별 표 ID 패턴은 다음과 같습니다:
   - 서울(201): DT_201004_* — 자치구 분류 포함
   - 부산(202): DT_202, DT_BA102 등 — [구군별] 분류
   - 대구(203): DT_B40001, DT_B70001 등 — [행정구역(구군)별] 분류
   - 통계청(101): DT_1IN1503 시군구 주민등록인구, DT_1YL* e-지방지표 — 모든 시군구
2. \`search_statistics\` 로 "${input.regionName ?? ''} <원하는 통계>" 검색해서 표 ID 확인.
3. \`get_table_info\` 로 메타에서 정확한 분류명을 확인.`,
        };
      }

      // 사용자가 직접 지정한 값은 덮어쓰지 않음
      resolvedObjL1 = input.objL1 ?? r.objL1;
      resolvedObjL2 = input.objL2 ?? r.objL2;
      resolvedObjL3 = input.objL3 ?? r.objL3;
      resolvedObjL4 = input.objL4 ?? r.objL4;
      resolvedItmId = input.itemId ?? r.itmId;
      resolveLog = r.resolved;
    }

    // 캐시된 데이터 조회
    const results = await cache.getStatisticsData(
      {
        orgId: input.orgId,
        tableId: input.tableId,
        objL1: resolvedObjL1,
        objL2: resolvedObjL2,
        objL3: resolvedObjL3,
        objL4: resolvedObjL4,
        itemId: resolvedItmId,
        periodType: input.periodType,
        startPeriod: input.startPeriod,
        endPeriod: input.endPeriod,
        recentCount: input.recentCount,
      },
      async () => {
        return client.getStatisticsData({
          orgId: input.orgId,
          tblId: input.tableId,
          objL1: resolvedObjL1,
          objL2: resolvedObjL2,
          objL3: resolvedObjL3,
          objL4: resolvedObjL4,
          itmId: resolvedItmId,
          prdSe: input.periodType,
          startPrdDe: input.startPeriod,
          endPrdDe: input.endPeriod,
          newEstPrdCnt: input.recentCount,
        });
      }
    );

    if (results.length === 0) {
      // 매칭 실패 디버깅용: 메타 요약 반환
      let candidates: string | undefined;
      try {
        const summary = await summarizeTableMeta(input.orgId, input.tableId, {
          sampleSize: 8,
          filter: input.regionName,
        });
        candidates = summary.groups
          .map(
            (g) =>
              `### [${g.objIdSn === '0' ? '항목' : 'objL' + g.objIdSn}] ${g.objNm} (총 ${g.totalItems}개)\n` +
              g.sample.map((it) => `  - \`${it.ITM_ID}\` ${it.ITM_NM}`).join('\n')
          )
          .join('\n\n');
      } catch {}

      return {
        success: true,
        data: [],
        totalCount: 0,
        metadata: {
          orgId: input.orgId,
          tableId: input.tableId,
          periodType: input.periodType,
        },
        resolved: resolveLog,
        usageHint: `
## 데이터를 찾을 수 없습니다

### 사용된 파라미터
- orgId: "${input.orgId}"
- tableId: "${input.tableId}"
- objL1: "${resolvedObjL1}"
- objL2: "${resolvedObjL2 ?? ''}"
- itemId: "${resolvedItmId}"
- periodType: "${input.periodType}"

### 사용 가능한 분류값
${candidates ?? '(메타 조회 실패)'}

### 해결 방법
1. **get_table_info 호출**하여 유효한 코드를 확인하세요:
   \`\`\`json
   { "orgId": "${input.orgId}", "tableId": "${input.tableId}" }
   \`\`\`

2. **파라미터 확인**:
   - objL1: 분류값 코드 (예: "00"=전국, "11"=서울)
   - itemId: 항목 코드 (예: "T10", "T1")
   - ⚠️ OBJ_ID(예: "ITEM", "B")가 아닌 실제 분류값 코드를 사용하세요

### 예시 호출
{
  "orgId": "${input.orgId}",
  "tableId": "${input.tableId}",
  "objL1": "00",
  "itemId": "T1",
  "periodType": "${input.periodType}",
  "recentCount": 5
}
`,
      };
    }

    // 데이터 간소화
    const simplifiedData = simplifyStatisticsData(results);

    // 메타데이터 추출
    const firstItem = results[0];
    const periods = results.map((r) => r.PRD_DE);
    const periodRange =
      periods.length > 1
        ? `${periods[periods.length - 1]} ~ ${periods[0]}`
        : periods[0];

    // 시각화 추천
    const hasMultipleCategories =
      new Set(simplifiedData.map((d) => d.classification)).size > 1;
    const visualization = recommendVisualization(
      simplifiedData.length,
      hasMultipleCategories,
      ['Y', 'M', 'Q'].includes(input.periodType)
    );

    return {
      success: true,
      tableName: firstItem.TBL_NM,
      unit: firstItem.UNIT_NM,
      data: simplifiedData,
      totalCount: simplifiedData.length,
      visualization: {
        recommendedType: visualization.type,
        reason: visualization.reason,
      },
      metadata: {
        orgId: input.orgId,
        tableId: input.tableId,
        periodType: input.periodType,
        periodRange,
      },
    };
  } catch (error) {
    console.error('Data error:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      data: [],
      totalCount: 0,
      metadata: {
        orgId: input.orgId,
        tableId: input.tableId,
        periodType: input.periodType,
      },
      usageHint: `
## 데이터 조회 중 오류 발생

### 오류 내용
${errorMessage}

### 확인 사항
1. orgId, tableId가 올바른지 확인하세요
2. get_table_info로 유효한 objL1, itemId 코드를 확인하세요
3. periodType이 해당 통계표에서 지원되는지 확인하세요

### get_table_info 호출 예시
{
  "orgId": "${input.orgId}",
  "tableId": "${input.tableId}"
}
`,
    };
  }
}
