/**
 * 빠른 통계 조회 도구
 * 자연어 질문으로 한 번에 통계 데이터를 조회하고 자연어 응답을 생성
 *
 * 개선: 정적으로 검증된 파라미터 사용 (동적 조회 대신)
 */

import { z } from 'zod';
import { getKosisClient } from '../api/client.js';
import { getCacheManager } from '../cache/index.js';
import {
  QUICK_STATS_PARAMS,
  KEYWORD_ALIASES,
  KEYWORD_LOOKUP,
  MISLEADING_KEYWORD_HINTS,
  VITAL_STATS_TABLE_IDS,
  getQuickStatsParam,
  getRegionCode,
  normalizeKeywordKey,
} from '../data/quickStatsParams.js';
import {
  findProvinceByDistrict,
  normalizeProvinceName,
  PROVINCES,
  PROVINCE_NAME_VARIANTS,
  AMBIGUOUS_DISTRICTS,
} from '../utils/regions.js';
import { fetchKosisExcel } from './fetchKosisExcel.js';
import {
  DISTRICT_KEYWORD_TO_FILESN,
  DISTRICT_OPENAPI_ROUTES,
  extractDistrictHighlight,
} from '../data/districtFileMap.js';
import { getDistrictKscdCandidatesFor } from '../utils/districtKosisCodes.js';
import { parseKosisNumber } from '../utils/dataFormatter.js';

/**
 * 자치구로 오판하면 안 되는 키워드 집합
 * (예: "인구"는 "구"로 끝나지만 자치구 아님)
 */
const NON_DISTRICT_WORDS = new Set<string>([
  '인구', '총인구', '수입', '수출', '집값', '월급', '취업', '주가',
  '노인구', '고령인구', '65세이상인구',
]);

export const quickStatsSchema = {
  name: 'quick_stats',
  description: `[빠른조회] 자연어 한 줄 → KOSIS 수치 즉답. 91개 키워드 + 17 시도 + 자치구·시군 자동 라우팅.

🔄 도구 라우팅:
• "~얼마/몇명/현황" → 이 도구
• "~추세/추이/변화/증감" → quick_trend
• 지역 한장 종합 브리핑 → chain_region_brief
• 다지역 비교 → chain_compare_regions
• 키워드 미지원 → search_statistics
• 자치구별 정밀 데이터 → fetch_kosis_excel

■ 지원 키워드: 인구, 출산율, 실업률, 고용률, GDP, GRDP, 물가, 아파트가격, 전세가격, 미세먼지, 교통사고, 의사수, 범죄율, 초혼연령, 노령화지수, 고령인구 등 91개
■ 지역: 17개 광역시도 + 자치구·시군 230+ → 광역시도 fallback + 안내
■ 별칭: 저출산→출산율, 고령화→고령인구, population/gdp 등 영문 18개

⚠️ 자연어 그대로 query에 넣어도 추출됨. region 명시 가능.`,
  inputSchema: z.object({
    query: z
      .string()
      .describe('통계 키워드 또는 자연어 질문. 예: "인구", "실업률", "서울 인구". 추세/증감 등 시계열 수식어는 quick_trend 사용.'),
    region: z
      .string()
      .optional()
      .describe('지역명 — 17개 광역시도 약칭(서울/부산/…/제주) 또는 풀네임(전라북도 등), 자치구·시군(광진구/수원시)도 가능. 미인식 지역명은 에러 반환(전국값 대체 안 함). 전국은 생략.'),
    year: z
      .number()
      .optional()
      .describe('조회 연도. 질문에 연도가 있으면 반드시 추출. "2020년 GDP" → year: 2020'),
    period: z
      .enum(['Y', 'Q', 'M'])
      .optional()
      .describe('조회 주기. Y=연간(기본), Q=분기, M=월별. "10월 출생아수" → period: "M"'),
    month: z
      .number()
      .min(1)
      .max(12)
      .optional()
      .describe('월 (period="M"일 때). "10월 출생아수" → month: 10'),
    quarter: z
      .number()
      .min(1)
      .max(4)
      .optional()
      .describe('분기 (period="Q"일 때). "3분기 실업률" → quarter: 3'),
  }),
};

export type QuickStatsInput = z.infer<typeof quickStatsSchema.inputSchema>;

interface QuickStatsResult {
  success: boolean;
  answer: string;
  value?: number | string;
  unit?: string;
  period?: string;
  source?: {
    orgId: string;
    tableId: string;
    tableName: string;
    /** KOSIS 자료 최종수정일 (LST_CHN_DE) — 공문서 인용용 */
    lastUpdated?: string;
    /** 조회(추출) 시점 ISO 날짜 — 공문서 인용용 */
    retrievedAt?: string;
  };
  isProjection?: boolean;
  note?: string;
}

/**
 * 지역명 목록 (쿼리에서 지역 추출용)
 * - shortName: 17개 광역시도 약칭
 * - fullName: 풀네임 (서울특별시, 경기도 등). 풀네임 매칭 우선.
 */
const PROVINCE_SHORT_NAMES = PROVINCES.map((p) => p.shortName);
const PROVINCE_FULL_NAMES = PROVINCES.map((p) => p.fullName);

/**
 * 쿼리에서 광역시도 추출
 *
 * 부분매칭 버그 방지:
 *   1. 자치구가 먼저 감지되면 광역시도 매칭은 스킵 (예: "해운대구"에 "대구" 부분매칭 방지)
 *   2. 풀네임 우선 매칭 (예: "서울특별시" > "서울")
 *   3. shortName은 단어 단위로 매칭 (앞뒤가 한글이 아니거나 끝)
 */
export function extractProvinceName(query: string, districtDetected: boolean): string | null {
  if (districtDetected) return null;

  // 풀네임 우선 — 현행 명칭 + 구명칭("전라북도"·"강원도" 등) 변형 포함, 긴 이름부터
  for (const { name, short } of PROVINCE_NAME_VARIANTS) {
    if (query.includes(name)) {
      return short;
    }
  }

  // shortName: 단어 단위 매칭 (앞뒤가 한글 자치구/시군 글자가 아닐 때만)
  for (const name of PROVINCE_SHORT_NAMES) {
    const idx = query.indexOf(name);
    if (idx === -1) continue;
    const before = idx > 0 ? query[idx - 1] : '';
    const after = idx + name.length < query.length ? query[idx + name.length] : '';
    // 자치구/시/군 일부일 가능성: 뒤 글자가 '구/시/군'이면 잘못된 부분매칭
    if (after === '구' || after === '시' || after === '군' || after === '도') {
      // 단, "경기도", "강원도" 같은 패턴은 위 풀네임 매칭에서 잡혔어야 함.
      // 여기서는 "해운대구"의 "대구"처럼 잘못 매칭되는 케이스 차단.
      continue;
    }
    // 앞 글자가 한글이면 자치구 일부일 수 있음 (예: "해운대" + "구" 패턴은 위에서 거름)
    return name;
  }
  return null;
}

/**
 * 쿼리에서 자치구 감지
 * 반환: 자치구명 또는 null
 *
 * 보장:
 *   - "인구"/"수입"/"수출" 등 "구/군/시"로 끝나는 키워드는 자치구 아님
 *   - 광역시도 풀네임("서울특별시" 등) 자치구 아님
 *   - 정식 KOSIS 키워드/별칭은 자치구 아님
 */
export function extractDistrictName(query: string): string | null {
  // 단어 단위로 분리하여 검사 (공백 기준)
  // "광진구 인구"에서 "광진구"만 자치구 후보로
  const tokens = query.split(/\s+/);
  for (const token of tokens) {
    // 자치구 길이: "남구"(2) ~ "부산진구"(4) — "구/군/시" 포함 총 2~5글자
    if (!/^[가-힣]{1,4}(구|군|시)$/.test(token)) continue;
    if (PROVINCE_FULL_NAMES.includes(token)) continue;
    if (PROVINCE_SHORT_NAMES.includes(token)) continue; // "대구" 같은 광역시 약칭 제외
    if (NON_DISTRICT_WORDS.has(token)) continue;
    if (QUICK_STATS_PARAMS[token]) continue;
    if (KEYWORD_ALIASES[token]) continue;
    return token;
  }
  return null;
}

export async function quickStats(input: QuickStatsInput): Promise<QuickStatsResult> {
  const client = getKosisClient();
  const cache = getCacheManager();

  try {
    // 0. 빈 쿼리 가드
    const trimmedQuery = (input.query ?? '').trim();
    if (!trimmedQuery) {
      return {
        success: false,
        answer: '조회할 통계 키워드를 입력해주세요.',
        note: '예: "인구", "실업률", "GDP", "서울 아파트가격". 카테고리별 키워드는 get_statistics_list(recommendedTopic) 참고.',
      };
    }

    // 1. 쿼리에서 키워드 추출
    const keyword = extractKeyword(trimmedQuery);
    const param = getQuickStatsParam(keyword);

    if (!param) {
      // 매핑이 없으면 카테고리별 지원 키워드 안내
      const keywordGuide = `
📊 지원 키워드 (카테고리별 대표 예시):
• 인구/출산: 인구, 출산율, 출생아수, 사망률, 기대수명
• 고령화: 고령인구, 노인인구, 노령화지수, 65세이상인구
• 고용/노동: 실업률, 고용률, 취업자수, 임금
• 경제: GDP, GRDP, 경제성장률, 물가
• 무역: 수출, 수입, 무역수지
• 혼인/이혼: 혼인율, 이혼율, 초혼연령, 여성초혼연령
• 부동산: 주택가격, 아파트가격, 전세가격
• 교통: 자동차, 교통사고
• 환경: 미세먼지, PM2.5, PM10
• 사회: 범죄율, 의사수, 외래관광객

💡 지역별: "서울 실업률", "부산 인구" (17개 시도)
💡 월별: "2024년 10월 출생아수" (일부 키워드)`.trim();

      // 유사하지만 정의가 다른 지표(청년실업률·연봉·가계소득 등) — 오답 대신 안내
      const normQ = normalizeKeywordKey(trimmedQuery);
      const misleadingHint = MISLEADING_KEYWORD_HINTS.find((h) => h.pattern.test(normQ))?.hint;

      return {
        success: false,
        answer: `"${input.query}"에 대한 빠른 조회가 지원되지 않습니다.`,
        note:
          (misleadingHint ? `${misleadingHint}\n\n` : '') +
          `${keywordGuide}\n\n🔍 다른 통계는 search_statistics("${input.query}")로 검색해보세요.`,
      };
    }

    // 2. 지역 결정
    let regionName = '전국';
    let objL1 = param.objL1;
    let objL2 = param.objL2;
    let requestedRegion: string | null = null;
    let districtNote: string | null = null;

    // 자치구·시군 추출: input.region 우선, 없으면 query에서.
    // (quickStats는 광역시도 단위까지 지원. 자치구는 fetch_kosis_excel 권장)
    const trimmedRegion = input.region?.trim() ?? '';
    const districtFromRegion = trimmedRegion ? extractDistrictName(trimmedRegion) : null;
    const districtFromQuery = !districtFromRegion ? extractDistrictName(trimmedQuery) : null;
    const districtName = districtFromRegion ?? districtFromQuery;
    const provFromQuery = extractProvinceName(trimmedQuery, /* districtDetected: */ false);

    if (districtName) {
      let prov = findProvinceByDistrict(districtName);

      // 모호한 자치구(예: '동구', '북구') + 광역시도 컨텍스트가 함께 있으면 그쪽 우선
      if (provFromQuery && AMBIGUOUS_DISTRICTS[districtName]?.includes(provFromQuery)) {
        const candidate = PROVINCES.find((p) => p.shortName === provFromQuery);
        if (candidate) prov = candidate;
      }

      if (prov) {
        requestedRegion = prov.shortName;
        districtNote = `💡 "${districtName}" 자치구 데이터는 quick_stats가 지원하지 않아 ${prov.shortName} 광역시도 데이터로 표시했습니다. 자치구 단위는 fetch_kosis_excel("${districtName}", "${keyword}")로 조회하세요.`;
      } else if (provFromQuery) {
        // 자치구 매핑 실패했지만 광역시도는 명시 → 그걸로 fallback
        requestedRegion = provFromQuery;
        districtNote = `💡 "${districtName}"은(는) 자치구 매핑이 모호합니다. ${provFromQuery} 광역시도 데이터로 표시합니다.`;
      } else {
        // 자치구도 광역시도도 매칭 실패 → 전국 데이터
        districtNote = `💡 "${districtName}"은(는) 자치구 매핑이 모호합니다 (여러 광역시도에 동명 자치구 존재 가능). 전국 데이터로 표시합니다. 정확한 자치구 조회는 search_statistics("${districtName} ${keyword}") 사용.`;
      }
    } else if (trimmedRegion) {
      // 명시적 region 파라미터 (광역시도)
      requestedRegion = trimmedRegion;
    } else if (provFromQuery) {
      // query에서 광역시도만 추출
      requestedRegion = provFromQuery;
    }

    // 2.5. 자치구 OpenAPI 라우팅 (DISTRICT_OPENAPI_ROUTES 기반) — 자치구 정밀 조회 1순위
    //
    // KOSIS 표준 OpenAPI + 자치구 행정코드(KSCD)로 자치구 단위 정밀 조회.
    // 표준 통계표는 전국 226개 시군구가 동일 구조(objL1=자치구코드)로 수록돼
    // 자치구별 구조 차이 없이 일관적이고 다지역 비교가능성도 보장 — 통계연보(.xlsx)보다 우선.
    // 강남구(PDF)·해운대구(미제공)·수원시(시군구) 등도 cover.
    //
    // 키워드별 (orgId, tblId, itmId, prdSe) 매핑은 districtFileMap.DISTRICT_OPENAPI_ROUTES.
    // route가 없는 키워드(임금·초혼연령 등)는 2.6 통계연보 .xlsx로 진행.
    const route = DISTRICT_OPENAPI_ROUTES[keyword];
    if (districtName && route) {
      try {
        // 동명 자치구 보정 — query 광역시도 힌트
        let provHint = findProvinceByDistrict(districtName) ?? undefined;
        if (provFromQuery && AMBIGUOUS_DISTRICTS[districtName]?.includes(provFromQuery)) {
          const cand = PROVINCES.find((p) => p.shortName === provFromQuery);
          if (cand) provHint = cand;
        }

        // 자치구 코드 후보 — 행정구역 통합 자치구(청주시·창원시)는 구코드+통합코드 2개.
        const districtCodes = await getDistrictKscdCandidatesFor(
          route.orgId,
          route.tblId,
          districtName,
          provHint,
          route.objId ?? 'auto'
        );

        // 사용자 지정 year 처리 (후보와 무관)
        // month/quarter 미지정 시 해당 연도 전체를 범위 조회하고 응답에서 최신
        // 기간 행을 선택한다 — S(반기)·M(월)·Q(분기) 모두 연도만 줘도 year가 반영됨.
        let startPrd: string | undefined;
        let endPrd: string | undefined;
        if (input.year) {
          const y = String(input.year);
          if (route.prdSe === 'Y') {
            startPrd = y;
            endPrd = y;
          } else if (route.prdSe === 'M') {
            startPrd = input.month ? `${y}${String(input.month).padStart(2, '0')}` : `${y}01`;
            endPrd = input.month ? `${y}${String(input.month).padStart(2, '0')}` : `${y}12`;
          } else if (route.prdSe === 'Q') {
            startPrd = input.quarter ? `${y}${String(input.quarter).padStart(2, '0')}` : `${y}01`;
            endPrd = input.quarter ? `${y}${String(input.quarter).padStart(2, '0')}` : `${y}04`;
          } else if (route.prdSe === 'S') {
            // 반기 — PRD_DE 끝 2자리 01=상반기, 02=하반기
            startPrd = `${y}01`;
            endPrd = `${y}02`;
          }
        }

        // 후보 코드 순회 — 데이터 있는 코드를 찾으면 즉시 응답. 통합 자치구 구코드 결측 대응.
        for (const districtCode of districtCodes) {
          // 자치구 코드 objLevel 결정 — 기본 objL1, INH_1B80A18 같은 swap 케이스는 objL2.
          const objL1Final =
            route.districtObjLevel === 2 ? (route.extraObjL1 ?? '0') : districtCode;
          const objL2Final =
            route.districtObjLevel === 2 ? districtCode : route.objL2;

          // 후보별 개별 try — 구코드가 KOSIS err(데이터 없음)를 던져도 다음 후보 계속 시도
          let rows: Awaited<ReturnType<typeof client.getStatisticsData>>;
          try {
            rows = await cache.getStatisticsData(
              {
                orgId: route.orgId,
                tableId: route.tblId,
                objL1: objL1Final,
                objL2: objL2Final,
                itemId: route.itmId,
                periodType: route.prdSe,
                recentCount: startPrd ? undefined : 1,
                year: input.year,
                month: input.month,
                quarter: input.quarter,
              },
              async () => {
                return client.getStatisticsData({
                  orgId: route.orgId,
                  tblId: route.tblId,
                  objL1: objL1Final,
                  ...(objL2Final ? { objL2: objL2Final } : {}),
                  itmId: route.itmId,
                  prdSe: route.prdSe,
                  newEstPrdCnt: startPrd ? undefined : 1,
                  startPrdDe: startPrd,
                  endPrdDe: endPrd,
                });
              }
            );
          } catch {
            continue; // 이 후보 코드 조회 실패 — 다음 후보
          }
          if (rows.length > 0) {
            // 범위 조회(연도만 지정한 S/M/Q)는 여러 행 — 결측 아닌 최신 기간 행 선택.
            // 비수치·결측이면 다음 후보 코드 시도, 끝까지 없으면 광역 fallback.
            const valid = rows.filter((x) => parseKosisNumber(x.DT) !== null);
            if (valid.length > 0) {
              const r = valid.reduce((a, b) => (a.PRD_DE >= b.PRD_DE ? a : b));
              const period = r.PRD_DE;
              // 라벨은 KOSIS 응답의 실제 주기(PRD_SE)로 — route.prdSe는 호출 힌트일 뿐.
              const periodLabel = formatPeriodWithType(period, r.PRD_SE || route.prdSe);
              const numValue = parseKosisNumber(r.DT)!;
              const formattedValue = numValue.toLocaleString('ko-KR');
              const suffix = getKoreanParticle(route.description);
              const answer =
                `${periodLabel} ${districtName}의 ${route.description}${suffix} ${formattedValue}${route.unit}입니다.` +
                `\n\n📊 출처: ${route.description} (KOSIS ${route.tblId})`;
              return {
                success: true,
                answer,
                value: formattedValue,
                unit: route.unit,
                period: periodLabel,
                source: {
                  orgId: route.orgId,
                  tableId: route.tblId,
                  tableName: route.description,
                },
                ...(route.isProjection ? { isProjection: true } : {}),
              };
            }
          }
        }
        // 후보 코드는 있었으나 전부 결측 — 2.6 통계연보·광역으로 degrade
        if (districtCodes.length > 0) {
          districtNote =
            `💡 ${districtName} ${route.description}: KOSIS 자치구 단위 데이터 미수록.`;
        }
      } catch {
        // OpenAPI 라우팅 실패 — 2.6 통계연보·광역으로 degrade
      }
    }

    // 2.6. 자치구 통계연보 .xlsx (KOSIS file 통계표) — OpenAPI route 미보유/조회 실패 시 보조
    //
    // 표준 OpenAPI에 없는 분야이거나 2.5가 자치구 데이터 미수록인 경우의 보조 경로.
    // file_sn은 키워드→분야명 매칭으로 자치구별 동적 도출 (fetchKosisExcel keyword 인자) —
    // 통계연보 분야 순서가 자치구마다 달라 정적 file_sn 하드코딩이 깨지는 것을 방지.
    // 안정성: fetchKosisExcel 3개 fetch에 retry/timeout 적용 (cold path 안전).
    if (districtName && DISTRICT_KEYWORD_TO_FILESN[keyword] !== undefined) {
      try {
        const excelResult = await fetchKosisExcel({
          districtName,
          keyword,
          year: input.year,
          listOnly: false,
        });

        if (excelResult.success && excelResult.markdown) {
          const yearMatch = excelResult.tblId.match(/FILE(\d{4})/);
          const yearLabel = yearMatch?.[1] ?? (input.year ? String(input.year) : '');
          const fileLabel =
            excelResult.fileName ??
            (excelResult.fileSn ? `file_sn=${excelResult.fileSn}` : '');
          const sourceName = `${districtName} 통계연보 ${fileLabel}`.trim();
          const tableId = excelResult.tblId;
          const periodLabel = yearLabel ? `${yearLabel}년` : '';

          const { value, unit, highlightLines } = extractDistrictHighlight(
            excelResult.markdown,
            keyword
          );

          if (value) {
            const unitLabel = (unit ?? param.unit ?? '').trim();
            const formattedValue = value.includes(',')
              ? value
              : !Number.isNaN(parseFloat(value))
                ? parseFloat(value).toLocaleString('ko-KR')
                : value;
            const suffix = getKoreanParticle(param.description);
            const subject = periodLabel
              ? `${periodLabel} ${districtName}의`
              : `${districtName}의`;
            const answer =
              `${subject} ${param.description}${suffix} ${formattedValue}${unitLabel ? unitLabel : ''}입니다.` +
              `\n\n📊 출처: ${sourceName} (KOSIS ${tableId})`;
            return {
              success: true,
              answer,
              value,
              unit: unitLabel,
              period: periodLabel || undefined,
              source: { orgId: excelResult.orgId, tableId, tableName: sourceName },
            };
          }

          // value 자동 추출 실패 — highlight markdown 첨부로 degrade.
          // (OpenAPI route는 2.5에서 이미 시도했으므로 추가 fall-through 없음)
          const highlightBlock =
            highlightLines.length > 0
              ? highlightLines.join('\n')
              : excelResult.markdown.slice(0, 2500);
          const subjectMd = periodLabel ? `${periodLabel} ${districtName}` : districtName;
          const answer =
            `${subjectMd} ${param.description} 통계연보를 조회했습니다 (자동 수치 추출 실패 → 원본 표 첨부).` +
            `\n\n${highlightBlock}` +
            `\n\n📊 출처: ${sourceName} (KOSIS ${tableId})`;
          return {
            success: true,
            answer,
            period: periodLabel || undefined,
            source: { orgId: excelResult.orgId, tableId, tableName: sourceName },
            note: `자동 value 추출 실패 — highlight pattern 보강 필요 (keyword="${keyword}").`,
          };
        }

        // fetchKosisExcel 실패 — 광역 fallback으로 degrade. note에 사유 명시.
        const reason = excelResult.error ? excelResult.error.slice(0, 200) : '알 수 없는 사유';
        districtNote =
          `⚠️ "${districtName}" 자치구 통계연보(.xlsx) 조회 실패: ${reason}` +
          (requestedRegion ? ` → ${requestedRegion} 광역시도 데이터로 대체합니다.` : '');
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        districtNote =
          `⚠️ "${districtName}" 자치구 통계연보 조회 예외: ${msg.slice(0, 150)}` +
          (requestedRegion ? ` → ${requestedRegion} 광역시도 데이터로 대체합니다.` : '');
      }
    }

    // 지역 요청이 있는 경우 처리
    if (requestedRegion) {
      if (!param.regionCodes) {
        return {
          success: false,
          answer: `"${keyword}" 통계는 지역별 조회를 지원하지 않습니다. 전국 데이터만 제공됩니다.`,
          note: `지역별 조회 가능: 인구, 출산율, 사망률, 혼인율, 이혼율, 실업률, 고용률, GRDP, 물가, 주택가격, 아파트가격, 전세가격, 미세먼지, 교통사고, 범죄율, 의사수, 자동차 등`,
        };
      }
      const regionCode = getRegionCode(param, requestedRegion);
      if (regionCode === null) {
        // 지역명 미인식 — 전국값을 그 지역값처럼 반환하지 않는다 (silent fallback 금지)
        return {
          success: false,
          answer: `"${requestedRegion}" 지역명을 인식하지 못해 조회를 중단했습니다.`,
          note:
            `지원 지역: 17개 광역시도 — 약칭(서울/부산/대구/인천/광주/대전/울산/세종/경기/강원/충북/충남/전북/전남/경북/경남/제주) 또는 풀네임(전라북도, 강원특별자치도 등). ` +
            `자치구·시군(예: "광진구", "수원시")은 자동 라우팅됩니다. 전국값은 region 생략.`,
        };
      }
      const normalizedRegion = normalizeProvinceName(requestedRegion);
      if (normalizedRegion !== '전국') {
        if (param.regionObjLevel === 2) {
          objL2 = regionCode;
        } else {
          objL1 = regionCode;
        }
        regionName = normalizedRegion;
      }
    }

    // 3. 주기(period) 결정 및 검증
    const supportedPeriods = param.supportedPeriods || ['Y'];
    // 사용자가 주기를 지정하지 않으면 키워드의 첫 번째 지원 주기 사용
    const defaultPeriod = supportedPeriods[0];
    const requestedPeriod = input.period || defaultPeriod;

    if (!supportedPeriods.includes(requestedPeriod)) {
      const periodNames = { 'Y': '연간', 'Q': '분기', 'M': '월별' } as const;
      const supportedNames = supportedPeriods.map(p => periodNames[p]).join(', ');
      return {
        success: false,
        answer: `"${input.query}"는 ${periodNames[requestedPeriod]} 조회를 지원하지 않습니다.`,
        note: `지원 주기: ${supportedNames}`,
      };
    }

    // 4. 조회 기간 계산
    let startPrd: string | undefined;
    let endPrd: string | undefined;

    if (input.year) {
      if (requestedPeriod === 'Y') {
        startPrd = input.year.toString();
        endPrd = input.year.toString();
      } else if (requestedPeriod === 'Q' && input.quarter) {
        const qStr = `${input.year}${input.quarter.toString().padStart(2, '0')}`;
        startPrd = qStr;
        endPrd = qStr;
      } else if (requestedPeriod === 'M' && input.month) {
        const mStr = `${input.year}${input.month.toString().padStart(2, '0')}`;
        startPrd = mStr;
        endPrd = mStr;
      } else if (requestedPeriod === 'Q') {
        // 해당 연도의 모든 분기
        startPrd = `${input.year}01`;
        endPrd = `${input.year}04`;
      } else if (requestedPeriod === 'M') {
        // 해당 연도의 모든 월
        startPrd = `${input.year}01`;
        endPrd = `${input.year}12`;
      }
    }

    // 5. 데이터 조회 (검증된 정적 파라미터 사용)
    const results = await cache.getStatisticsData(
      {
        orgId: param.orgId,
        tableId: param.tableId,
        objL1,
        objL2,
        itemId: param.itemId,
        periodType: requestedPeriod,
        recentCount: startPrd ? undefined : 1,
        year: input.year,
        month: input.month,
        quarter: input.quarter,
      },
      async () => {
        return client.getStatisticsData({
          orgId: param.orgId,
          tblId: param.tableId,
          objL1,
          objL2,
          itmId: param.itemId,
          prdSe: requestedPeriod,
          newEstPrdCnt: startPrd ? undefined : 1,
          startPrdDe: startPrd,
          endPrdDe: endPrd,
        });
      }
    );

    if (results.length === 0) {
      return {
        success: false,
        answer: `"${input.query}"에 대한 데이터를 찾을 수 없습니다.`,
        note: `테이블: ${param.tableName} (${param.tableId})\n다른 검색어로 시도하거나 search_statistics를 사용해보세요.`,
      };
    }

    // 6. 결과 파싱 — 결측 아닌 최신 기간 행 선택 (범위 조회 시 여러 행 대응).
    //    비수치 값을 그대로 응답하면 Number()→NaN으로 깨지므로 사전 차단.
    const validResults = results.filter((r) => parseKosisNumber(r.DT) !== null);
    if (validResults.length === 0) {
      return {
        success: false,
        answer: `"${input.query}"에 대한 수치 데이터를 찾을 수 없습니다 (조회 결과가 모두 결측).`,
        note: `테이블: ${param.tableName} (${param.tableId})\n다른 연도로 시도하거나 search_statistics를 사용해보세요.`,
      };
    }
    const latestData = validResults.reduce((a, b) => (a.PRD_DE >= b.PRD_DE ? a : b));
    const value = latestData.DT;
    const period = latestData.PRD_DE;
    const periodFormatted = formatPeriodWithType(period, requestedPeriod);
    const unit = param.unit;

    // 5. 자연어 응답 생성
    // districtName이 있는데 여기까지 왔다 = 자치구 경로(2.5 OpenAPI·2.6 통계연보) 모두 실패.
    // 광역시도 값을 자치구 값인 척 답하지 않는다 — 자치구 미수록을 문장 첫머리에 명시하고
    // 광역값은 "참고값"으로만 격하한다 (README '자치구 데이터 무결성' 원칙).
    let baseAnswer: string;
    if (districtName) {
      const formattedValue = value.includes(',') ? value : Number(value).toLocaleString();
      const suffix = getKoreanParticle(param.description);
      const refLabel =
        regionName === '전국' ? '참고로 전국' : `참고로 상위 지역 ${regionName}의`;
      baseAnswer =
        `${districtName} 단위 ${param.description} 데이터는 KOSIS 자치구 통계에 수록돼 있지 않습니다. ` +
        `${refLabel} ${param.description}${suffix} ${periodFormatted} 기준 ${formattedValue}${unit}입니다.`;
    } else {
      baseAnswer = generateNaturalResponse({
        keyword,
        regionName,
        value,
        unit,
        period: periodFormatted,
        description: param.description,
      });
    }

    // 장래추계 데이터 안내 (미래연도 데이터는 실측이 아님)
    const projectionNote = param.isProjection
      ? `⚠️ 본 수치는 국가데이터처 장래추계 데이터입니다 (실측 아닌 미래 추계). 정책·보고 인용 시 "추계" 명시 권장.`
      : null;

    // 인구동향(출생·사망·혼인·이혼) 최근 시점은 잠정치 가능 — 확정치는 익년 공표
    const provisionalNote =
      VITAL_STATS_TABLE_IDS.has(param.tableId) && isWithinMonths(period, 24)
        ? `⚠️ 인구동향조사 최근 시점 수치는 잠정치일 수 있습니다 (확정치는 익년 공표). 공식 인용 시 "잠정" 여부 확인 권장.`
        : null;

    // 출처 + 자치구 + 추계 안내 부착 — 표 ID 포함 (자치구 경로와 인용 형식 통일)
    const noteSuffix = [districtNote, projectionNote, provisionalNote].filter(Boolean).join('\n\n');
    const answer = `${baseAnswer}\n\n📊 출처: ${param.tableName} (KOSIS ${param.tableId})${noteSuffix ? `\n\n${noteSuffix}` : ''}`;

    const combinedNote = [districtNote, projectionNote, provisionalNote]
      .filter(Boolean)
      .join(' / ');

    return {
      success: true,
      answer,
      value,
      unit,
      period: periodFormatted,
      source: {
        orgId: param.orgId,
        tableId: param.tableId,
        tableName: param.tableName,
        ...(latestData.LST_CHN_DE ? { lastUpdated: latestData.LST_CHN_DE } : {}),
        retrievedAt: new Date().toISOString().slice(0, 10),
      },
      ...(param.isProjection ? { isProjection: true } : {}),
      ...(combinedNote ? { note: combinedNote } : {}),
    };
  } catch (error) {
    console.error('Quick stats error:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);

    // KOSIS "데이터가 존재하지 않습니다" → 친절한 안내
    const isMissing = /데이터가 존재하지 않습니다/.test(errorMessage);
    if (isMissing) {
      const yearHint = input.year != null
        ? (input.year > new Date().getFullYear()
            ? `${input.year}년은 아직 발표되지 않았을 가능성이 큽니다. 연도 미지정 시 최신 데이터를 자동 조회합니다.`
            : `${input.year}년 데이터가 해당 통계표에 없습니다. 가용 연도 범위를 좁혀 다시 시도해보세요.`)
        : '해당 통계표에 데이터가 없습니다.';
      return {
        success: false,
        answer: `"${input.query}" 데이터를 찾을 수 없습니다.`,
        note: `${yearHint}\n다른 검색은 search_statistics("${input.query}") 사용.`,
      };
    }

    return {
      success: false,
      answer: `조회 중 오류가 발생했습니다: ${errorMessage}`,
      note: `search_statistics("${input.query}")로 직접 검색해보세요.`,
    };
  }
}

/**
 * 쿼리에서 키워드 추출 (korean-law-mcp의 정규화 alias 패턴 차용)
 *
 * 알고리즘:
 *   1. 정규화 (공백·대소문자·중점/하이픈 제거 + 률/율 오타 매핑)
 *   2. KEYWORD_LOOKUP에서 가장 긴 정규화 키 부분 매칭 (긴 키 우선 → 충돌 방지)
 *      → "경기 노인 인구"는 '노인인구'(4자)가 '인구'(2자)보다 먼저 매칭
 *      → "G D P"·"출산률"·"PM 2.5"도 모두 정규화 후 매칭
 *   3. 매칭 실패 시 원문 그대로 반환 (getQuickStatsParam에서 추가 처리)
 *
 * KEYWORD_LOOKUP은 정식 키워드 + KEYWORD_ALIASES + BASIC_TYPO_MAP을 통합한 사전 빌드 Map.
 */
const SORTED_NORM_KEYS = Array.from(KEYWORD_LOOKUP.keys())
  .filter((k) => k.length >= 2)
  .sort((a, b) => b.length - a.length);

/**
 * 키워드 매칭 위치 앞이 "지역명·시점·전국 표현"으로 끝나는지 검사.
 *
 * substring 매칭의 오답 방지: "다문화인구"·"유소년인구"·"청년실업률"처럼
 * 한글 수식어가 직접 붙은 복합어는 별개 지표인데, '인구'·'실업률'에 부분 매칭되어
 * 주민등록 총인구·전체 실업률을 그 질문의 답처럼 반환하던 P0 버그 차단.
 * 지역명("서울인구")·시점("2024년인구")·조사("서울의인구")·전국 표현 뒤는 정상 질의로 허용.
 */
function isAllowedKeywordPrefix(prefix: string): boolean {
  if (!prefix) return true;
  // 조사 '의'는 제거 후 판정 ("서울의인구")
  const p = prefix.endsWith('의') ? prefix.slice(0, -1) : prefix;
  if (!p) return true;
  const last = p[p.length - 1];
  if (!/[가-힣]/.test(last)) return true; // 숫자·영문·기호 뒤는 허용
  if (/(시|도|구|군|읍|면|동|월|분기)$/.test(p)) return true; // 지역·시점 접미
  // '년'은 숫자·작년류 시점 표현만 허용 — '유소년'·'청년' 같은 수식어는 차단
  if (/(\d년|작년|전년|금년|올해)$/.test(p)) return true;
  if (/(전국|한국|대한민국|우리나라|국내)$/.test(p)) return true;
  for (const name of PROVINCE_SHORT_NAMES) {
    if (p.endsWith(name)) return true;
  }
  return false; // 한글 수식어 직접 결합 — 다른 지표일 가능성, 매칭 거부
}

export function extractKeyword(query: string): string {
  if (!query) return query;
  const normQuery = normalizeKeywordKey(query);
  if (!normQuery) return query;

  for (const nk of SORTED_NORM_KEYS) {
    let idx = normQuery.indexOf(nk);
    while (idx !== -1) {
      if (isAllowedKeywordPrefix(normQuery.slice(0, idx))) {
        return KEYWORD_LOOKUP.get(nk)!;
      }
      idx = normQuery.indexOf(nk, idx + 1);
    }
  }

  return query;
}

/**
 * PRD_DE 시점이 현재로부터 N개월 이내인지 (잠정치 안내 판정용)
 * period: "2025"(연) 또는 "202505"(월·분기·반기)
 */
function isWithinMonths(period: string, months: number): boolean {
  const year = parseInt(period.slice(0, 4), 10);
  if (!Number.isFinite(year)) return false;
  const month = period.length >= 6 ? parseInt(period.slice(4, 6), 10) || 12 : 12;
  const now = new Date();
  const monthsAgo = (now.getFullYear() - year) * 12 + (now.getMonth() + 1 - month);
  return monthsAgo <= months;
}

/**
 * 기간 형식 포맷팅 (주기 타입 명시)
 *
 * periodType은 KOSIS 응답의 PRD_SE(수록주기)를 그대로 받는다 — 'Y'/'Q'/'M'/'S'(반기) 등.
 * 반기('S')는 PRD_DE 끝 2자리 01=상반기, 02=하반기.
 */
function formatPeriodWithType(period: string, periodType: string): string {
  if (period.length === 4) {
    return `${period}년`;
  } else if (period.length === 6) {
    const year = period.slice(0, 4);
    const num = parseInt(period.slice(4), 10);

    if (periodType === 'Q') {
      return `${year}년 ${num}분기`;
    } else if (periodType === 'M') {
      return `${year}년 ${num}월`;
    } else if (periodType === 'S') {
      return `${year}년 ${num === 1 ? '상' : '하'}반기`;
    }
  }
  return period;
}

/**
 * 한국어 받침 유무에 따라 조사 선택
 * 받침이 있으면 '은', 없으면 '는'
 */
function getKoreanParticle(text: string): string {
  if (!text || text.length === 0) return '은';

  const lastChar = text.charAt(text.length - 1);
  const code = lastChar.charCodeAt(0);

  // 한글 유니코드 범위: 0xAC00 ~ 0xD7A3
  if (code >= 0xAC00 && code <= 0xD7A3) {
    // 종성(받침) 존재 여부 확인
    // (code - 0xAC00) % 28 === 0 이면 받침 없음
    const hasJongseong = (code - 0xAC00) % 28 !== 0;
    return hasJongseong ? '은' : '는';
  }

  // 숫자나 영문 등은 기본적으로 '는' 사용
  return '는';
}

/**
 * 자연어 응답 생성
 */
function generateNaturalResponse(data: {
  keyword: string;
  regionName: string;
  value: string;
  unit: string;
  period: string;
  description: string;
}): string {
  const { regionName, value, unit, period, description } = data;

  // 숫자 포맷팅 (콤마 추가)
  const formattedValue = value.includes(',') ? value : Number(value).toLocaleString();

  // 단위 포맷팅 (지수 기준연도는 괄호로 감싸기)
  let formattedUnit = unit;
  if (unit.includes('=')) {
    // 지수 단위 (예: 2020=100, 2021.6=100)
    formattedUnit = unit.startsWith('(') ? ` ${unit}` : ` (${unit})`;
  }

  // 한국어 문법: 받침 유무에 따라 은/는 선택
  const suffix = getKoreanParticle(description);

  if (regionName === '전국') {
    return `${period} 한국의 ${description}${suffix} ${formattedValue}${formattedUnit}입니다.`;
  } else {
    return `${period} ${regionName}의 ${description}${suffix} ${formattedValue}${formattedUnit}입니다.`;
  }
}
