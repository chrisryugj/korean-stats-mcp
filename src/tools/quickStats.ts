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
  getQuickStatsParam,
  getRegionCode,
} from '../data/quickStatsParams.js';
import { findProvinceByDistrict, PROVINCES } from '../utils/regions.js';

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
  description: `【수치/데이터 질문 → 이 도구 사용】 한국 통계 수치를 즉시 반환합니다.

■ 사용 시점: "~얼마야?", "~알려줘", "~몇 명이야?", "~수치", "~현황", "~추세", "~감소", "~증가" 등
■ 반환 형식: "2024년 서울의 실업률은 3.2%입니다" 같은 실제 데이터 값
■ 지원 키워드: 인구, 출산율, 실업률, 고용률, GDP, GRDP, 물가, 아파트가격, 전세가격, 미세먼지, 교통사고, 의사수, 범죄율, 초혼연령, 노령화지수, 고령인구 등 90개 이상
■ 지역 조회: 서울, 부산, 대구 등 17개 시도별 조회 가능

⚠️ 핵심 키워드만 추출하세요:
• "인구감소 추세" → query: "인구" (감소/증가/추세 제외)
• "서울 실업률 현황" → query: "실업률", region: "서울"
• "고령화 문제" → query: "고령인구" 또는 "노령화지수"
• "저출산 현황" → query: "출산율" 또는 "출생아수"`,
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
function extractProvinceName(query: string, districtDetected: boolean): string | null {
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
function extractDistrictName(query: string): string | null {
  // 단어 단위로 분리하여 검사 (공백 기준)
  // "광진구 인구"에서 "광진구"만 자치구 후보로
  const tokens = query.split(/\s+/);
  for (const token of tokens) {
    // 자치구 길이: "남구"(2) ~ "부산진구"(4) — "구/군/시" 포함 총 2~5글자
    if (!/^[가-힣]{1,4}(구|군|시)$/.test(token)) continue;
    if (PROVINCE_FULL_NAMES.includes(token)) continue;
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
        note: '예: "인구", "실업률", "GDP", "서울 아파트가격". 카테고리별 키워드는 get_recommended_statistics 참고.',
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

    // 명시적 region 파라미터 우선
    if (input.region) {
      requestedRegion = input.region;
    }

    // 쿼리에서 자치구 → 광역시도 fallback
    // (quickStats는 광역시도 단위까지 지원. 자치구는 fetch_kosis_excel 권장)
    if (!requestedRegion) {
      const districtName = extractDistrictName(trimmedQuery);
      if (districtName) {
        const prov = findProvinceByDistrict(districtName);
        if (prov) {
          requestedRegion = prov.shortName;
          districtNote = `💡 "${districtName}" 자치구 데이터는 quick_stats가 지원하지 않아 ${prov.shortName} 광역시도 데이터로 표시했습니다. 자치구 단위는 fetch_kosis_excel("${districtName}", "${keyword}")로 조회하세요.`;
        } else {
          // DISTRICT_TO_PROVINCE에 없는 자치구 (모호하거나 미등록)
          districtNote = `💡 "${districtName}"은(는) 자치구 매핑이 모호합니다 (여러 광역시도에 동명 자치구 존재 가능). 전국 데이터로 표시합니다. 정확한 자치구 조회는 search_statistics("${districtName} ${keyword}") 사용.`;
        }
      }

      // 자치구 없으면 광역시도 추출 (부분매칭 버그 방지)
      if (!requestedRegion) {
        const provName = extractProvinceName(trimmedQuery, /* districtDetected: */ false);
        if (provName) requestedRegion = provName;
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

    // 출처 + 자치구 안내 부착
    const answer = `${baseAnswer}\n\n📊 출처: ${param.tableName} (KOSIS)${districtNote ? `\n\n${districtNote}` : ''}`;

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
      ...(districtNote ? { note: districtNote } : {}),
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
 * 쿼리에서 키워드 추출
 *
 * 매칭 우선순위:
 *   1. 정식 키워드 직접 매칭 (긴 것 우선)
 *   2. 별칭 매칭 (저출산→출산율 등, 긴 것 우선)
 *   3. 공백 분리 후 단어별 직접/별칭 매칭
 *   4. 원본 쿼리 그대로 반환
 */
function extractKeyword(query: string): string {
  // 1. 정식 키워드
  const sortedKeywords = Object.keys(QUICK_STATS_PARAMS).sort((a, b) => b.length - a.length);
  for (const keyword of sortedKeywords) {
    if (query.includes(keyword)) {
      return keyword;
    }
  }

  // 2. 별칭 (저출산, 고령화, population 등)
  const sortedAliases = Object.keys(KEYWORD_ALIASES).sort((a, b) => b.length - a.length);
  for (const alias of sortedAliases) {
    if (query.includes(alias) || query.toLowerCase().includes(alias.toLowerCase())) {
      return alias;
    }
  }

  // 3. 공백 분리 매칭
  const words = query.split(/\s+/);
  for (const word of words) {
    if (QUICK_STATS_PARAMS[word]) return word;
    if (KEYWORD_ALIASES[word]) return word;
    const lower = word.toLowerCase();
    if (KEYWORD_ALIASES[lower]) return lower;
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
