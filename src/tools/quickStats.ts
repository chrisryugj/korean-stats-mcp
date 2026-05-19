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
  getQuickStatsParam,
  getRegionCode,
  normalizeKeywordKey,
} from '../data/quickStatsParams.js';
import { findProvinceByDistrict, PROVINCES, AMBIGUOUS_DISTRICTS } from '../utils/regions.js';
import { fetchKosisExcel } from './fetchKosisExcel.js';
import {
  DISTRICT_KEYWORD_TO_FILESN,
  DISTRICT_OPENAPI_ROUTES,
  extractDistrictHighlight,
} from '../data/districtFileMap.js';
import { getDistrictKscdCodeFor } from '../utils/districtKosisCodes.js';

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
      .describe('통계 키워드만 입력 (감소/증가/추세/현황 등 수식어 제외). 예: "인구", "실업률", "GDP", "출산율", "고령인구"'),
    region: z
      .string()
      .optional()
      .describe('지역명. 예: "서울", "부산", "경기". 질문에 지역이 있으면 추출. "서울 인구" → region: "서울"'),
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

  // 풀네임 우선
  for (const name of PROVINCE_FULL_NAMES) {
    if (query.includes(name)) {
      const idx = PROVINCE_FULL_NAMES.indexOf(name);
      return PROVINCE_SHORT_NAMES[idx];
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

      return {
        success: false,
        answer: `"${input.query}"에 대한 빠른 조회가 지원되지 않습니다.`,
        note: `${keywordGuide}\n\n🔍 다른 통계는 search_statistics("${input.query}")로 검색해보세요.`,
      };
    }

    // 2. 지역 결정
    let regionName = '전국';
    let objL1 = param.objL1;
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

    // 2.5. 자치구 정밀 조회 (KOSIS 자치구 통계연보 .xlsx) — 자치구 + 매핑된 키워드 일 때 우선 시도
    //
    // 매핑이 있고 fetchKosisExcel이 성공하면 광역 OpenAPI 호출 없이 자치구 정밀값으로 즉시 응답.
    // 실패 시 districtNote에 사유 부착 후 광역 fallback으로 degrade (기존 흐름 유지).
    //
    // 안정성: P0-1로 fetchKosisExcel 3개 fetch에 retry/timeout 적용 (cold path 안전).
    if (districtName && DISTRICT_KEYWORD_TO_FILESN[keyword] !== undefined) {
      const fileSn = DISTRICT_KEYWORD_TO_FILESN[keyword];
      try {
        const excelResult = await fetchKosisExcel({
          districtName,
          fileSn,
          year: input.year,
          listOnly: false,
        });

        if (excelResult.success && excelResult.markdown) {
          const yearMatch = excelResult.tblId.match(/FILE(\d{4})/);
          const yearLabel = yearMatch?.[1] ?? (input.year ? String(input.year) : '');
          const fileLabel = excelResult.fileName ?? `file_sn=${fileSn}`;
          const sourceName = `${districtName} 통계연보 ${fileLabel}`;
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

          // value 자동 추출 실패. DISTRICT_OPENAPI_ROUTES 매핑이 있으면 2.6 OpenAPI 라우팅으로 fall-through.
          if (DISTRICT_OPENAPI_ROUTES[keyword]) {
            districtNote =
              `💡 ${districtName} 통계연보(.xlsx)에서 "${keyword}" 자동 추출 실패 → OpenAPI 라우팅으로 대체 조회.`;
            // (return 없음 — try 블록 끝나면 2.6 분기로 자연 진행)
          } else {
            // 매핑 없으면 highlight markdown 첨부로 degrade (기존 흐름)
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

    // 2.6. 자치구 OpenAPI 라우팅 (DISTRICT_OPENAPI_ROUTES 기반)
    //
    // 위 2.5에서 fetchKosisExcel이 실패했거나(.xlsx 미제공·PDF 형식 자치구),
    // 또는 fileSn 매핑이 없어도 KOSIS 표준 OpenAPI + 자치구 행정코드(KSCD)로
    // 자치구 단위 정밀 조회. 강남구(PDF), 해운대구(미제공), 수원시(시군구) 등 cover.
    //
    // 키워드별 (orgId, tblId, itmId, prdSe) 매핑은 districtFileMap.DISTRICT_OPENAPI_ROUTES.
    // objL1(자치구 코드)는 테이블별로 다를 수 있어 (orgId, tblId)별 메타 캐시.
    const route = DISTRICT_OPENAPI_ROUTES[keyword];
    if (districtName && route) {
      try {
        // 동명 자치구 보정 — query 광역시도 힌트
        let provHint = findProvinceByDistrict(districtName) ?? undefined;
        if (provFromQuery && AMBIGUOUS_DISTRICTS[districtName]?.includes(provFromQuery)) {
          const cand = PROVINCES.find((p) => p.shortName === provFromQuery);
          if (cand) provHint = cand;
        }

        const districtCode = await getDistrictKscdCodeFor(
          route.orgId,
          route.tblId,
          districtName,
          provHint,
          route.objId ?? 'auto'
        );
        if (districtCode) {
          // 사용자 지정 year 처리
          let startPrd: string | undefined;
          let endPrd: string | undefined;
          if (input.year) {
            if (route.prdSe === 'Y') {
              startPrd = String(input.year);
              endPrd = String(input.year);
            } else if (route.prdSe === 'M' && input.month) {
              const m = `${input.year}${String(input.month).padStart(2, '0')}`;
              startPrd = m;
              endPrd = m;
            } else if (route.prdSe === 'Q' && input.quarter) {
              const q = `${input.year}${String(input.quarter).padStart(2, '0')}`;
              startPrd = q;
              endPrd = q;
            }
          }

          // 자치구 코드 objLevel 결정 — 기본 objL1, INH_1B80A18 같은 swap 케이스는 objL2.
          const objL1Final =
            route.districtObjLevel === 2 ? (route.extraObjL1 ?? '0') : districtCode;
          const objL2Final =
            route.districtObjLevel === 2 ? districtCode : route.objL2;

          const rows = await cache.getStatisticsData(
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
          if (rows.length > 0) {
            const r = rows[0];
            const rawValue = r.DT;
            // KOSIS 데이터 누락 표시("-"/공백) — fall-through 하여 광역 fallback으로 degrade
            if (rawValue && rawValue !== '-' && rawValue.trim() !== '') {
              const period = r.PRD_DE;
              const periodLabel = formatPeriodWithType(period, route.prdSe);
              const numValue = parseFloat(rawValue);
              const formattedValue = Number.isNaN(numValue)
                ? rawValue
                : numValue.toLocaleString('ko-KR');
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
            districtNote =
              `💡 ${districtName} ${route.description} KOSIS 자치구 단위 데이터 미수록 — 광역시도 데이터로 대체합니다.`;
          }
        }
      } catch {
        // OpenAPI 라우팅 실패 — 광역 fallback으로 degrade
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
      if (regionCode !== param.objL1) {
        objL1 = regionCode;
        regionName = requestedRegion;
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
        objL2: param.objL2,
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
          objL2: param.objL2,
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

    // 6. 결과 파싱
    const latestData = results[0];
    const value = latestData.DT;
    const period = latestData.PRD_DE;
    const periodFormatted = formatPeriodWithType(period, requestedPeriod);
    const unit = param.unit;

    // 5. 자연어 응답 생성
    const baseAnswer = generateNaturalResponse({
      keyword,
      regionName,
      value,
      unit,
      period: periodFormatted,
      description: param.description,
    });

    // 장래추계 데이터 안내 (미래연도 데이터는 실측이 아님)
    const projectionNote = param.isProjection
      ? `⚠️ 본 수치는 통계청 장래추계 데이터입니다 (실측 아닌 미래 추계). 정책·보고 인용 시 "추계" 명시 권장.`
      : null;

    // 출처 + 자치구 + 추계 안내 부착
    const noteSuffix = [districtNote, projectionNote].filter(Boolean).join('\n\n');
    const answer = `${baseAnswer}\n\n📊 출처: ${param.tableName} (KOSIS)${noteSuffix ? `\n\n${noteSuffix}` : ''}`;

    const combinedNote = [districtNote, projectionNote].filter(Boolean).join(' / ');

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

export function extractKeyword(query: string): string {
  if (!query) return query;
  const normQuery = normalizeKeywordKey(query);
  if (!normQuery) return query;

  for (const nk of SORTED_NORM_KEYS) {
    if (normQuery.includes(nk)) {
      return KEYWORD_LOOKUP.get(nk)!;
    }
  }

  return query;
}

/**
 * 기간 형식 포맷팅 (년/분기/월 지원)
 */
function formatPeriod(period: string): string {
  if (period.length === 4) {
    // 연간: "2024" → "2024년"
    return `${period}년`;
  } else if (period.length === 6) {
    const year = period.slice(0, 4);
    const suffix = period.slice(4);
    const num = parseInt(suffix, 10);

    // 분기인지 월인지 구분 (01~04는 분기일 수도, 01~12는 월)
    // KOSIS API는 분기를 01, 02, 03, 04로, 월을 01~12로 표현
    // 구분을 위해 값의 범위로 판단 (5 이상이면 월)
    if (num >= 5 && num <= 12) {
      // 월간: "202410" → "2024년 10월"
      return `${year}년 ${num}월`;
    } else if (num >= 1 && num <= 4) {
      // 분기: "202401" → "2024년 1분기" (단, 월일 수도 있음)
      // 이 경우 호출 컨텍스트에서 판단해야 함
      // 기본적으로 월로 처리 (1~4월)
      return `${year}년 ${num}월`;
    }
  }
  return period;
}

/**
 * 기간 형식 포맷팅 (주기 타입 명시)
 */
function formatPeriodWithType(period: string, periodType: 'Y' | 'Q' | 'M'): string {
  if (period.length === 4) {
    return `${period}년`;
  } else if (period.length === 6) {
    const year = period.slice(0, 4);
    const num = parseInt(period.slice(4), 10);

    if (periodType === 'Q') {
      return `${year}년 ${num}분기`;
    } else if (periodType === 'M') {
      return `${year}년 ${num}월`;
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
