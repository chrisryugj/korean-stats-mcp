/**
 * 통계표 분류·항목 메타 조회 (경량)
 *
 * 응답 크기가 컸던 이전 구현은 raw 메타를 통째로 반환하여 클라이언트(Cursor 등)를
 * 초기화시키는 문제가 있었다. 이번에는 OBJ_NM 그룹별로 샘플 N개(기본 10)만 노출하고
 * `filter`로 ITM_NM 부분일치 검색을 지원한다.
 *
 * 사용 예: "광진구" 코드를 찾을 때
 *   get_table_info({ orgId: "201", tblId: "DT_201004_O110054", filter: "광진구" })
 */
import { z } from 'zod';
import { summarizeTableMeta } from '../utils/metaLookup.js';

export const getTableInfoSchema = {
  name: 'get_table_info',
  description: `통계표의 분류(OBJ_NM)와 항목(ITM_ID, ITM_NM) 목록을 조회합니다. get_statistics_data 호출 전에 objL1·objL2·itemId 코드를 확인할 때 사용하세요.

응답이 무거울 수 있으니 filter로 좁히세요.
• filter="광진구" → 자치구별 분류에서 "광진구" 항목만 노출
• sampleSize 조절 (기본 10, 최대 50)

자치구·시군구 통계는 통계표마다 ITM_ID 패턴이 다릅니다 (예: 광진구가 "001005"이거나 "13102127569D1.HCD_11050"). 항상 이 도구로 실제 코드를 확인하세요.`,
  inputSchema: z.object({
    orgId: z.string().describe('기관 ID (예: 201 = 서울특별시)'),
    tableId: z.string().describe('통계표 ID (예: DT_201004_O110054)'),
    filter: z
      .string()
      .optional()
      .describe('ITM_NM 부분일치 필터 (예: "광진구", "여자"). 비우면 OBJ 그룹별 첫 N개만 노출'),
    sampleSize: z
      .number()
      .min(1)
      .max(50)
      .optional()
      .default(10)
      .describe('OBJ 그룹별 표시 개수 (기본 10, 최대 50)'),
  }),
};

export type GetTableInfoInput = z.infer<typeof getTableInfoSchema.inputSchema>;

export async function getTableInfo(input: GetTableInfoInput) {
  try {
    const summary = await summarizeTableMeta(input.orgId, input.tableId, {
      sampleSize: input.sampleSize ?? 10,
      filter: input.filter,
    });

    if (summary.groups.length === 0) {
      return {
        success: false,
        orgId: input.orgId,
        tableId: input.tableId,
        usageHint: '메타데이터를 찾을 수 없습니다. orgId와 tableId를 확인하세요.',
      };
    }

    const lines: string[] = [];
    lines.push(`## ${input.orgId} / ${input.tableId} 메타`);
    if (input.filter) lines.push(`(filter="${input.filter}")\n`);
    for (const g of summary.groups) {
      const label = g.objIdSn === '0' ? '[항목]' : `[objL${g.objIdSn}]`;
      lines.push(`### ${label} ${g.objNm} — 총 ${g.totalItems}개`);
      for (const it of g.sample) {
        lines.push(`  - \`${it.ITM_ID}\` ${it.ITM_NM}`);
      }
      if (g.totalItems > g.sample.length) {
        lines.push(`  ... +${g.totalItems - g.sample.length}개 (filter로 좁히세요)`);
      }
    }

    return {
      success: true,
      orgId: input.orgId,
      tableId: input.tableId,
      groups: summary.groups,
      hint: lines.join('\n'),
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      orgId: input.orgId,
      tableId: input.tableId,
      error: msg,
      usageHint: `메타 조회 실패: ${msg}`,
    };
  }
}
