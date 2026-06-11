/**
 * 통계설명·각주 생성기 — 보고서/의회답변의 출처 각주를 한 호출로.
 *
 * KOSIS statsExplain(통계설명) + getMeta(TBL/PRD)를 묶어
 * 작성기관·작성목적·조사주기·수록기간·주요 용어해설과 함께
 * 공문서 인용 표준 형식의 각주 문구를 생성한다.
 *
 * 의회답변·정책보고서는 수치보다 출처 각주와 용어 정의에서 반려된다 —
 * "합계출산율 정의가 뭐냐"는 질의에 공식 문구로 답하는 도구.
 */

import { z } from 'zod';
import { getKosisClient } from '../api/client.js';
import { getCacheManager } from '../cache/index.js';
import { getQuickStatsParam } from '../data/quickStatsParams.js';
import { extractKeyword } from './quickStats.js';

export const explainStatisticSchema = {
  name: 'explain_statistic',
  description: `[출처·각주] 통계의 공식 정의·작성목적·조사주기·용어해설 + 보고서 인용 각주 문구 생성.

🎯 사용 시점: "이 통계 정의가 뭐야", "출처 각주 만들어줘", "조사 방법/주기 알려줘", quick_stats 응답의 수치를 보고서에 인용할 때
🔄 도구 비교:
• 수치 조회 → quick_stats (이 도구는 수치가 아니라 통계 자체의 설명·각주)
• 표 구조(분류·항목) → get_table_info

■ 입력: keyword(예: "출산율") 또는 orgId+tableId (quick_stats/search 응답의 source 그대로)
■ 반환: 작성기관·작성목적·조사주기·수록기간·주요 용어해설 + 인용문구(citation) — 보고서 각주에 복붙 가능
■ 통계설명이 미등록인 표는 메타 기반 인용문구만 반환`,
  inputSchema: z.object({
    keyword: z
      .string()
      .optional()
      .describe('quick_stats 키워드 (예: "출산율", "노령화지수"). orgId/tableId를 모를 때 사용'),
    orgId: z.string().optional().describe('기관 ID (예: "101"). quick_stats 응답의 source.orgId'),
    tableId: z
      .string()
      .optional()
      .describe('통계표 ID (예: "DT_1B81A17"). quick_stats 응답의 source.tableId'),
  }),
};

export type ExplainStatisticInput = z.infer<typeof explainStatisticSchema.inputSchema>;

/**
 * statisticsExplData.do 응답 필드(camelCase) → 한국어 라벨.
 * KOSIS devGuide_0401 기준 — 표마다 일부만 채워짐.
 */
const EXPLAIN_FIELD_LABELS: Array<{ key: string; label: string }> = [
  { key: 'statsNm', label: '통계조사명' },
  { key: 'statsKind', label: '통계종류' },
  { key: 'basisLaw', label: '법적 근거' },
  { key: 'writingPurps', label: '작성목적' },
  { key: 'examinPd', label: '조사주기' },
  { key: 'examinObjrange', label: '조사대상범위' },
  { key: 'examinObjArea', label: '조사대상지역' },
  { key: 'josaUnit', label: '조사단위' },
  { key: 'statsPeriod', label: '수록기간' },
  { key: 'pubPeriod', label: '공표주기' },
  { key: 'pubDate', label: '공표시기' },
  { key: 'dataUserNote', label: '이용 시 유의사항' },
  { key: 'mainTermExpl', label: '주요 용어해설' },
  { key: 'writingTel', label: '작성기관 연락처' },
];

function pick(row: Record<string, string> | undefined, key: string): string | null {
  const v = row?.[key];
  if (!v || !String(v).trim()) return null;
  return String(v).trim();
}

export async function explainStatistic(input: ExplainStatisticInput): Promise<{
  success: boolean;
  answer: string;
  citation?: string;
  explanation?: Record<string, string>;
  source?: { orgId: string; tableId: string; tableName: string; retrievedAt: string };
  note?: string;
}> {
  const client = getKosisClient();
  const cache = getCacheManager();

  try {
    // 1. orgId/tableId 결정 — 직접 입력 우선, 없으면 keyword로 resolve
    let orgId = input.orgId?.trim();
    let tableId = input.tableId?.trim();
    let tableNameHint: string | null = null;

    if ((!orgId || !tableId) && input.keyword) {
      const kw = extractKeyword(input.keyword.trim());
      const param = getQuickStatsParam(kw);
      if (param) {
        orgId = orgId || param.orgId;
        tableId = tableId || param.tableId;
        tableNameHint = param.tableName;
      }
    }
    if (!orgId || !tableId) {
      return {
        success: false,
        answer: 'orgId+tableId 또는 지원 keyword가 필요합니다.',
        note: 'quick_stats 응답의 source.orgId/source.tableId를 그대로 넣거나, keyword(예: "출산율")를 입력하세요. 표를 모르면 search_statistics 먼저.',
      };
    }

    // 2. 통계설명 + 표 메타 병렬 조회 (각각 실패 허용 — 부분 정보로도 각주 생성)
    const [explainRows, tblMeta, prdMeta] = await Promise.all([
      cache
        .getExplanation({ orgId, tableId }, () => client.getStatisticsExplain(orgId!, tableId!))
        .catch(() => [] as Record<string, string>[]),
      cache
        .getTableMeta({ orgId, tableId, type: 'TBL' }, () =>
          client.getTableMeta(orgId!, tableId!, 'TBL')
        )
        .catch(() => [] as Record<string, string>[]),
      cache
        .getTableMeta({ orgId, tableId, type: 'PRD' }, () =>
          client.getTableMeta(orgId!, tableId!, 'PRD')
        )
        .catch(() => [] as Record<string, string>[]),
    ]);

    // statisticsExplData.do는 필드 1~2개씩 담긴 partial 객체 "배열"을 반환 —
    // 전 행을 병합해야 완전한 설명 객체가 된다 (첫 행만 읽으면 연락처만 남음)
    const explain =
      explainRows.length > 0
        ? (Object.assign({}, ...(explainRows as Record<string, string>[])) as Record<string, string>)
        : undefined;
    const tbl = tblMeta[0] as Record<string, string> | undefined;
    const prd = prdMeta as Record<string, string>[];

    const tableName =
      pick(tbl, 'TBL_NM') ?? tableNameHint ?? tableId;
    const orgName = pick(tbl, 'ORG_NM') ?? (orgId === '101' ? '국가데이터처' : `기관 ${orgId}`);
    const statName = pick(explain, 'statsNm');

    // 수록정보 — 주기별 수록기간 (PRD 메타: PRD_SE + PRD_DE 범위)
    const prdLines = prd
      .map((p) => {
        const se = pick(p, 'PRD_SE');
        const from = pick(p, 'STRT_PRD_DE') ?? pick(p, 'PRD_FROM') ?? '';
        const to = pick(p, 'END_PRD_DE') ?? pick(p, 'PRD_TO') ?? pick(p, 'PRD_DE') ?? '';
        if (!se && !from && !to) return null;
        return `${se ?? '?'}: ${from}${from || to ? '~' : ''}${to}`;
      })
      .filter((x): x is string => !!x);

    // 3. 인용문구 (공문서 각주 표준 형식)
    const today = new Date().toISOString().slice(0, 10);
    const citation =
      `출처: ${orgName}` +
      (statName ? `, 「${statName}」` : '') +
      `, ${tableName} (KOSIS, 통계표 ID: ${tableId}), ${today} 추출.`;

    // 4. 설명 본문
    const explanation: Record<string, string> = {};
    const bodyLines: string[] = [];
    for (const { key, label } of EXPLAIN_FIELD_LABELS) {
      const v = pick(explain, key);
      if (v) {
        explanation[label] = v;
        bodyLines.push(`• ${label}: ${v}`);
      }
    }
    if (prdLines.length > 0) {
      explanation['수록정보'] = prdLines.join(' / ');
      bodyLines.push(`• 수록정보: ${prdLines.join(' / ')}`);
    }

    const hasExplain = bodyLines.length > 0;
    const answer =
      `📚 ${tableName} (${orgName}, KOSIS ${tableId})\n\n` +
      (hasExplain
        ? bodyLines.join('\n')
        : '이 통계표는 KOSIS 통계설명 자료가 등록되어 있지 않습니다 (표 메타 기반 인용문구만 제공).') +
      `\n\n📎 인용 각주:\n${citation}`;

    return {
      success: true,
      answer,
      citation,
      ...(hasExplain ? { explanation } : {}),
      source: { orgId, tableId, tableName, retrievedAt: today },
      ...(hasExplain
        ? {}
        : { note: '용어 정의가 필요하면 해당 조사의 대표 표 ID로 다시 시도하거나 search_statistics로 본조사 표를 찾으세요.' }),
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      answer: `통계설명 조회 중 오류: ${msg}`,
      note: 'orgId/tableId 조합을 quick_stats 응답의 source와 대조해보세요.',
    };
  }
}
