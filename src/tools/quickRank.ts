/**
 * 전국 순위 카드 — "우리 시·구가 전국 몇 위?"
 *
 * 동급 지자체 전체(17개 시도 또는 220+ 시군구)를 단일 KOSIS 호출(objL='ALL')로 받아
 * 해당 지역의 순위·백분위·전국 평균 대비 격차·직전 시점 대비 순위 변동을 산출한다.
 *
 * 연설문·보도자료의 핵심 수사는 절대값이 아니라 상대 위치와 순위 변동 —
 * "OO구 합계출산율은 전국 시군구 중 12위, 전년보다 5계단 상승" 한 줄을 만들어준다.
 *
 * 모든 지역이 같은 통계표·같은 시점에서 조회되므로 비교가능성이 보장된다
 * (chain_compare_regions의 테이블 혼합 문제 없음).
 */

import { z } from 'zod';
import { getKosisClient } from '../api/client.js';
import { getCacheManager } from '../cache/index.js';
import {
  getQuickStatsParam,
  getRegionCode,
  type QuickStatsParam,
} from '../data/quickStatsParams.js';
import { DISTRICT_OPENAPI_ROUTES } from '../data/districtFileMap.js';
import { getDistrictKscdCandidatesFor } from '../utils/districtKosisCodes.js';
import {
  findProvinceByDistrict,
  normalizeProvinceName,
  PROVINCES,
  AMBIGUOUS_DISTRICTS,
} from '../utils/regions.js';
import { parseKosisNumber } from '../utils/dataFormatter.js';
import { extractKeyword, extractDistrictName, extractProvinceName } from './quickStats.js';
import type { StatisticsDataItem } from '../api/types.js';

export const quickRankSchema = {
  name: 'quick_rank',
  description: `[순위] "우리 지역이 전국 몇 위?" — 동급 지자체 전체 대비 순위·백분위·평균 격차·순위 변동 한 번에.

🎯 사용 시점: "광진구 출산율 전국 몇 위", "서울 실업률 순위", "우리 구 고령화 심한 편인가", 시정연설·보도자료의 "전국 N위" 문구 생성
🔄 도구 비교:
• 단일 수치만 → quick_stats
• 사용자가 지정한 2~17개 지역 비교 → chain_compare_regions (이 도구는 동급 전체 자동 비교)
• 추세 → quick_trend

■ region이 시도(서울 등) → 17개 시도 중 순위, 시군구(광진구 등) → 전국 시군구 전수 중 순위
■ 같은 통계표·같은 시점 단일 호출 — 비교가능성 보장 + 직전 시점 대비 순위 변동(↑↓) 포함
■ 정렬은 값 내림차순(값 큰 순 = 1위). 실업률처럼 낮을수록 좋은 지표는 해석 주의 문구 자동 부착`,
  inputSchema: z.object({
    keyword: z
      .string()
      .describe('통계 키워드 (quick_stats와 동일 — 예: "출산율", "고령인구비율", "실업률", "노령화지수")'),
    region: z
      .string()
      .describe('기준 지역 — 시도(예: "서울", "전라북도") 또는 시군구(예: "광진구", "수원시")'),
  }),
};

export type QuickRankInput = z.infer<typeof quickRankSchema.inputSchema>;

interface RankEntry {
  rank: number;
  region: string;
  value: number;
  formatted: string;
}

interface QuickRankResult {
  success: boolean;
  answer: string;
  keyword?: string;
  region?: string;
  scope?: 'sido' | 'sigungu';
  rank?: number;
  total?: number;
  percentile?: string;
  value?: number;
  unit?: string;
  period?: string;
  average?: number | null;
  national?: number | null;
  rankChange?: number | null;
  top5?: RankEntry[];
  bottom5?: RankEntry[];
  source?: { orgId: string; tableId: string; tableName: string; retrievedAt: string };
  note?: string;
}

/** 낮을수록 긍정적으로 읽히는 지표 — 1위(값 최대)가 "나쁨"일 수 있어 해석 주의 부착 */
const LOWER_IS_BETTER = new Set([
  '실업률', '범죄율', '교통사고', '사망률', '조사망률', '미세먼지', 'PM2.5', 'PM10',
  '노령화지수', '고령화지수', '이혼율', '조이혼율', '물가',
]);

/** 시도 단위로 집계되지 않는 행 이름 (전국·읍면동부 등) */
function isProvinceLevelName(name: string): boolean {
  return PROVINCES.some((p) => p.fullName === name || p.shortName === name);
}

function fmt(n: number): string {
  return n.toLocaleString('ko-KR', { maximumFractionDigits: 2 });
}

function buildRanking(
  rows: Array<{ name: string; code: string; value: number }>
): RankEntry[] {
  return rows
    .slice()
    .sort((a, b) => b.value - a.value)
    .map((r, i) => ({ rank: i + 1, region: r.name, value: r.value, formatted: fmt(r.value) }));
}

export async function quickRank(input: QuickRankInput): Promise<QuickRankResult> {
  const client = getKosisClient();
  const cache = getCacheManager();

  try {
    const trimmedRegion = (input.region ?? '').trim();
    if (!trimmedRegion) {
      return { success: false, answer: '기준 지역(region)을 입력해주세요. 예: "서울", "광진구".' };
    }

    const keyword = extractKeyword((input.keyword ?? '').trim());
    const param = getQuickStatsParam(keyword);

    // 시군구 판정 — quick_stats와 동일 로직 재사용
    const districtName = extractDistrictName(trimmedRegion);

    // ── 시군구 전수 순위 ──
    if (districtName) {
      const route = DISTRICT_OPENAPI_ROUTES[keyword];
      if (!route) {
        const available = Object.keys(DISTRICT_OPENAPI_ROUTES).join(', ');
        return {
          success: false,
          answer: `"${keyword}"는 시군구 전수 순위를 지원하지 않습니다.`,
          note: `시군구 순위 지원 키워드: ${available}. 시도 단위 순위는 region에 시도명을 입력하세요.`,
        };
      }

      // 기준 지역 코드 — quick_stats와 같은 동적 lookup (동명 자치구는 광역시도 힌트)
      let provHint = findProvinceByDistrict(districtName) ?? undefined;
      const provFromRegion = extractProvinceName(trimmedRegion.replace(districtName, ''), false);
      if (provFromRegion && AMBIGUOUS_DISTRICTS[districtName]?.includes(provFromRegion)) {
        const cand = PROVINCES.find((p) => p.shortName === provFromRegion);
        if (cand) provHint = cand;
      }
      const targetCodes = await getDistrictKscdCandidatesFor(
        route.orgId,
        route.tblId,
        districtName,
        provHint,
        route.objId ?? 'auto'
      );
      if (targetCodes.length === 0) {
        return {
          success: false,
          answer: `"${districtName}"의 행정구역 코드를 찾지 못했습니다.`,
          note: AMBIGUOUS_DISTRICTS[districtName]
            ? `동명 자치구입니다 — "${AMBIGUOUS_DISTRICTS[districtName].join('/')} ${districtName}"처럼 광역시도를 함께 입력하세요.`
            : `quick_stats("${districtName} ${keyword}")로 단일 조회를 먼저 확인해보세요.`,
        };
      }

      // 전수 조회 — 자치구 분류를 ALL로 단일 호출 (최근 2개 시점: 순위 변동용)
      const objL1Final = route.districtObjLevel === 2 ? (route.extraObjL1 ?? '0') : 'ALL';
      const objL2Final = route.districtObjLevel === 2 ? 'ALL' : route.objL2;
      const rows = await cache.getStatisticsData(
        {
          kind: 'rank_sigungu',
          orgId: route.orgId,
          tableId: route.tblId,
          objL1: objL1Final,
          objL2: objL2Final,
          itemId: route.itmId,
          periodType: route.prdSe,
        },
        async () =>
          client.getStatisticsData({
            orgId: route.orgId,
            tblId: route.tblId,
            objL1: objL1Final,
            ...(objL2Final ? { objL2: objL2Final } : {}),
            itmId: route.itmId,
            prdSe: route.prdSe,
            newEstPrdCnt: 2,
          })
      );
      if (rows.length === 0) {
        return {
          success: false,
          answer: `"${keyword}" 시군구 전수 데이터를 조회하지 못했습니다.`,
          note: `quick_stats("${districtName} ${keyword}")로 단일 조회를 시도해보세요.`,
        };
      }

      // 자치구 코드/이름은 districtObjLevel에 따라 C1 또는 C2
      const codeOf = (r: StatisticsDataItem) =>
        route.districtObjLevel === 2 ? (r.C2 ?? '') : (r.C1 ?? '');
      const nameOf = (r: StatisticsDataItem) =>
        route.districtObjLevel === 2 ? (r.C2_NM ?? '') : (r.C1_NM ?? '');

      // 시군구 행만 — 전국·시도·읍면동부 행 제외. 이름 기준(코드 체계는 표마다 다름):
      // 구/군/시로 끝나되 광역시도 풀네임("서울특별시")·약칭은 제외.
      const isDistrictRow = (r: StatisticsDataItem) => {
        const nm = nameOf(r).trim();
        const last = nm.split(/\s+/).pop() ?? nm; // "서울 광진구" 결합형 대응
        if (!/[구군시]$/.test(last)) return false;
        if (isProvinceLevelName(nm) || isProvinceLevelName(last)) return false;
        if (/특별시$|광역시$|특별자치/.test(nm)) return false;
        return true;
      };

      const periods = [...new Set(rows.map((r) => r.PRD_DE))].sort();
      const latestPrd = periods[periods.length - 1];
      const prevPrd = periods.length > 1 ? periods[periods.length - 2] : null;

      const toEntries = (prd: string) => {
        const seen = new Set<string>();
        const out: Array<{ name: string; code: string; value: number }> = [];
        for (const r of rows) {
          if (r.PRD_DE !== prd || !isDistrictRow(r)) continue;
          const code = codeOf(r);
          if (seen.has(code)) continue;
          const v = parseKosisNumber(r.DT);
          if (v === null) continue;
          seen.add(code);
          out.push({ name: nameOf(r).trim(), code, value: v });
        }
        return out;
      };

      const latest = toEntries(latestPrd);
      if (latest.length < 10) {
        return {
          success: false,
          answer: `"${keyword}" 시군구 전수 응답이 비정상적으로 적습니다 (${latest.length}곳).`,
          note: '통계표 분류 구조가 예상과 다를 수 있습니다 — chain_compare_regions로 직접 비교하세요.',
        };
      }

      const ranking = buildRanking(latest);
      const targetIdx = ranking.findIndex((e) =>
        latest.some((l) => l.name === e.region && targetCodes.includes(l.code) && l.value === e.value)
      );
      if (targetIdx === -1) {
        return {
          success: false,
          answer: `${districtName}의 "${keyword}" 값이 최신 시점(${latestPrd})에 결측입니다.`,
          note: `전수 ${ranking.length}곳 순위 자체는 산출 가능 — chain_compare_regions 참고.`,
        };
      }
      const target = ranking[targetIdx];
      const total = ranking.length;
      const percentile = ((target.rank / total) * 100).toFixed(0);
      const average = latest.reduce((s, e) => s + e.value, 0) / total;

      // 직전 시점 순위 변동
      let rankChange: number | null = null;
      if (prevPrd) {
        const prevRanking = buildRanking(toEntries(prevPrd));
        const prevIdx = prevRanking.findIndex((e) => e.region === target.region);
        if (prevIdx !== -1) rankChange = prevRanking[prevIdx].rank - target.rank; // +N = 상승
      }

      const unit = route.unit;
      const changeText =
        rankChange === null
          ? ''
          : rankChange === 0
            ? ' (직전 시점과 동일 순위)'
            : ` (직전 시점 대비 ${Math.abs(rankChange)}계단 ${rankChange > 0 ? '상승 ↑' : '하락 ↓'})`;
      const cautionNote = LOWER_IS_BETTER.has(keyword)
        ? `\n⚠️ "${route.description}"은(는) 값이 낮을수록 긍정적으로 해석되는 지표입니다 — 순위는 값 큰 순(1위=최고값) 기준이므로 인용 시 방향 주의.`
        : '';

      const answer =
        `${latestPrd.length === 4 ? `${latestPrd}년` : latestPrd} ${route.description} 기준, ` +
        `${districtName}은(는) 전국 시군구 ${total}곳 중 ${target.rank}위입니다 (상위 ${percentile}%, ${target.formatted}${unit})${changeText}.\n` +
        `전국 시군구 평균 ${fmt(average)}${unit} 대비 ${target.value >= average ? '+' : ''}${fmt(target.value - average)}${unit}.` +
        cautionNote +
        `\n\n📊 출처: ${route.description} (KOSIS ${route.tblId}) — 전체 시군구 동일 표·동일 시점 단일 조회 (비교가능성 보장)`;

      return {
        success: true,
        answer,
        keyword,
        region: districtName,
        scope: 'sigungu',
        rank: target.rank,
        total,
        percentile: `상위 ${percentile}%`,
        value: target.value,
        unit,
        period: latestPrd,
        average,
        national: null,
        rankChange,
        top5: ranking.slice(0, 5),
        bottom5: ranking.slice(-5),
        source: {
          orgId: route.orgId,
          tableId: route.tblId,
          tableName: route.description,
          retrievedAt: new Date().toISOString().slice(0, 10),
        },
      };
    }

    // ── 시도(17곳) 순위 ──
    if (!param) {
      return {
        success: false,
        answer: `"${input.keyword}" 키워드를 인식하지 못했습니다.`,
        note: `quick_stats 지원 키워드와 동일합니다 — search_statistics("${input.keyword}")로 검색해보세요.`,
      };
    }
    if (!param.regionCodes) {
      return {
        success: false,
        answer: `"${keyword}"는 지역별 데이터가 없어 순위를 산출할 수 없습니다 (전국 단일 지표).`,
      };
    }
    const targetShort = normalizeProvinceName(trimmedRegion);
    const targetCode = getRegionCode(param, targetShort);
    if (targetCode === null || targetShort === '전국') {
      return {
        success: false,
        answer: `"${trimmedRegion}" 지역명을 인식하지 못했습니다.`,
        note: '17개 광역시도 약칭/풀네임 또는 시군구명을 입력하세요. 전국은 순위 기준 지역이 될 수 없습니다.',
      };
    }

    const codeToName = new Map<string, string>();
    for (const [name, code] of Object.entries(param.regionCodes)) {
      if (name !== '전국') codeToName.set(code, name);
    }
    const nationalCode = param.regionCodes['전국'];

    const prdSe = param.supportedPeriods?.[0] ?? 'Y';
    const regionAtL2 = param.regionObjLevel === 2;
    const rows = await cache.getStatisticsData(
      {
        kind: 'rank_sido',
        orgId: param.orgId,
        tableId: param.tableId,
        objL1: regionAtL2 ? param.objL1 : 'ALL',
        objL2: regionAtL2 ? 'ALL' : param.objL2,
        itemId: param.itemId,
        periodType: prdSe,
      },
      async () =>
        client.getStatisticsData({
          orgId: param.orgId,
          tblId: param.tableId,
          objL1: regionAtL2 ? param.objL1 : 'ALL',
          ...(regionAtL2 ? { objL2: 'ALL' } : param.objL2 ? { objL2: param.objL2 } : {}),
          itmId: param.itemId,
          prdSe,
          newEstPrdCnt: 2,
        })
    );
    if (rows.length === 0) {
      return {
        success: false,
        answer: `"${keyword}" 시도 전체 데이터를 조회하지 못했습니다.`,
        note: `chain_compare_regions(regions=[17개 시도], keywords=["${keyword}"])로 대체 가능합니다.`,
      };
    }

    const codeOf = (r: StatisticsDataItem) => (regionAtL2 ? (r.C2 ?? '') : (r.C1 ?? ''));
    const periods = [...new Set(rows.map((r) => r.PRD_DE))].sort();
    const latestPrd = periods[periods.length - 1];
    const prevPrd = periods.length > 1 ? periods[periods.length - 2] : null;

    const toEntries = (prd: string) => {
      const out: Array<{ name: string; code: string; value: number }> = [];
      const seen = new Set<string>();
      for (const r of rows) {
        if (r.PRD_DE !== prd) continue;
        const code = codeOf(r);
        const name = codeToName.get(code);
        if (!name || seen.has(code)) continue;
        const v = parseKosisNumber(r.DT);
        if (v === null) continue;
        seen.add(code);
        out.push({ name, code, value: v });
      }
      return out;
    };

    const latest = toEntries(latestPrd);
    if (latest.length < 10) {
      return {
        success: false,
        answer: `"${keyword}" 시도 전체 응답이 불완전합니다 (${latest.length}/17곳).`,
        note: 'chain_compare_regions로 직접 비교하세요.',
      };
    }

    const ranking = buildRanking(latest);
    const target = ranking.find((e) => e.region === targetShort);
    if (!target) {
      return {
        success: false,
        answer: `${targetShort}의 "${keyword}" 값이 최신 시점(${latestPrd})에 결측입니다.`,
      };
    }
    const total = ranking.length;
    const percentile = ((target.rank / total) * 100).toFixed(0);
    const average = latest.reduce((s, e) => s + e.value, 0) / total;
    const nationalRow = nationalCode
      ? rows.find((r) => r.PRD_DE === latestPrd && codeOf(r) === nationalCode)
      : undefined;
    const national = nationalRow ? parseKosisNumber(nationalRow.DT) : null;

    let rankChange: number | null = null;
    if (prevPrd) {
      const prevRanking = buildRanking(toEntries(prevPrd));
      const prev = prevRanking.find((e) => e.region === targetShort);
      if (prev) rankChange = prev.rank - target.rank;
    }

    const unit = param.unit;
    const changeText =
      rankChange === null
        ? ''
        : rankChange === 0
          ? ' (직전 시점과 동일 순위)'
          : ` (직전 시점 대비 ${Math.abs(rankChange)}계단 ${rankChange > 0 ? '상승 ↑' : '하락 ↓'})`;
    const cautionNote = LOWER_IS_BETTER.has(keyword)
      ? `\n⚠️ "${param.description}"은(는) 값이 낮을수록 긍정적으로 해석되는 지표입니다 — 순위는 값 큰 순(1위=최고값) 기준이므로 인용 시 방향 주의.`
      : '';
    const projectionNote = param.isProjection
      ? `\n⚠️ 장래추계 데이터 기준 순위입니다 (실측 아님).`
      : '';

    const answer =
      `${latestPrd.length === 4 ? `${latestPrd}년` : latestPrd} ${param.description} 기준, ` +
      `${targetShort}은(는) 17개 시도 중 ${target.rank}위입니다 (${target.formatted}${unit})${changeText}.\n` +
      `시도 평균 ${fmt(average)}${unit} 대비 ${target.value >= average ? '+' : ''}${fmt(target.value - average)}${unit}` +
      (national !== null ? `, 전국값 ${fmt(national)}${unit}` : '') +
      '.' +
      cautionNote +
      projectionNote +
      `\n\n📊 출처: ${param.tableName} (KOSIS ${param.tableId}) — 17개 시도 동일 표·동일 시점 단일 조회 (비교가능성 보장)`;

    return {
      success: true,
      answer,
      keyword,
      region: targetShort,
      scope: 'sido',
      rank: target.rank,
      total,
      percentile: `상위 ${percentile}%`,
      value: target.value,
      unit,
      period: latestPrd,
      average,
      national,
      rankChange,
      top5: ranking.slice(0, 5),
      bottom5: ranking.slice(-5),
      source: {
        orgId: param.orgId,
        tableId: param.tableId,
        tableName: param.tableName,
        retrievedAt: new Date().toISOString().slice(0, 10),
      },
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      answer: `순위 조회 중 오류가 발생했습니다: ${msg}`,
      note: `quick_stats("${input.region} ${input.keyword}")로 단일 조회는 가능할 수 있습니다.`,
    };
  }
}
