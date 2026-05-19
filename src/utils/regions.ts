/**
 * 지자체 매핑
 *
 * KOSIS에서 "OO광역시도 기본통계" 시리즈는 광역시도별 orgId(201~218)를 쓴다.
 * 각 시도 안의 자치구·시·군은 `parentListId=<orgId>` 호출로 LIST_ID를 얻는다.
 * 자치구별 데이터의 ITM_ID는 통계표마다 다르므로 (메타 lookup 필요) — 여기서는 분류 단계만 다룬다.
 *
 * 광진구 케이스:
 *   광역시도: 서울 (orgId=201)
 *   자치구 LIST: 201_201A_505
 *   기본통계 데이터: orgId=201, tblId=DT_201004_*, ITM_NM="광진구"
 */
import { getKosisClient } from '../api/client.js';
import { getCacheManager } from '../cache/index.js';

/** 광역시도 → orgId / 표준명 */
export interface ProvinceInfo {
  orgId: string;
  fullName: string;
  shortName: string;
  /** 「OO 기본통계」 통계표 prefix (DT_${orgId}004_) */
  baseStatPrefix: string;
}

export const PROVINCES: ProvinceInfo[] = [
  { orgId: '201', fullName: '서울특별시',       shortName: '서울', baseStatPrefix: 'DT_201004_' },
  { orgId: '202', fullName: '부산광역시',       shortName: '부산', baseStatPrefix: 'DT_202004_' },
  { orgId: '203', fullName: '대구광역시',       shortName: '대구', baseStatPrefix: 'DT_203004_' },
  { orgId: '204', fullName: '인천광역시',       shortName: '인천', baseStatPrefix: 'DT_204004_' },
  { orgId: '205', fullName: '광주광역시',       shortName: '광주', baseStatPrefix: 'DT_205004_' },
  { orgId: '206', fullName: '대전광역시',       shortName: '대전', baseStatPrefix: 'DT_206004_' },
  { orgId: '207', fullName: '울산광역시',       shortName: '울산', baseStatPrefix: 'DT_207004_' },
  { orgId: '208', fullName: '세종특별자치시',   shortName: '세종', baseStatPrefix: 'DT_208004_' },
  { orgId: '210', fullName: '경기도',           shortName: '경기', baseStatPrefix: 'DT_210004_' },
  { orgId: '211', fullName: '강원특별자치도',   shortName: '강원', baseStatPrefix: 'DT_211004_' },
  { orgId: '212', fullName: '충청북도',         shortName: '충북', baseStatPrefix: 'DT_212004_' },
  { orgId: '213', fullName: '충청남도',         shortName: '충남', baseStatPrefix: 'DT_213004_' },
  { orgId: '214', fullName: '전북특별자치도',   shortName: '전북', baseStatPrefix: 'DT_214004_' },
  { orgId: '215', fullName: '전라남도',         shortName: '전남', baseStatPrefix: 'DT_215004_' },
  { orgId: '216', fullName: '경상북도',         shortName: '경북', baseStatPrefix: 'DT_216004_' },
  { orgId: '217', fullName: '경상남도',         shortName: '경남', baseStatPrefix: 'DT_217004_' },
  { orgId: '218', fullName: '제주특별자치도',   shortName: '제주', baseStatPrefix: 'DT_218004_' },
];

/** 자치구·시·군명 → 광역시도 매핑 (오프라인 정적 — KOSIS 행정구역 코드 기반) */
const DISTRICT_TO_PROVINCE: Record<string, string> = {
  // 서울 25개 자치구
  '종로구': '201', '중구': '201', '용산구': '201', '성동구': '201', '광진구': '201',
  '동대문구': '201', '중랑구': '201', '성북구': '201', '강북구': '201', '도봉구': '201',
  '노원구': '201', '은평구': '201', '서대문구': '201', '마포구': '201', '양천구': '201',
  '강서구': '201', '구로구': '201', '금천구': '201', '영등포구': '201', '동작구': '201',
  '관악구': '201', '서초구': '201', '강남구': '201', '송파구': '201', '강동구': '201',
  // 부산 16개 (자치구 15 + 군 1)
  '부산진구': '202', '해운대구': '202', '사하구': '202', '금정구': '202',
  '연제구': '202', '수영구': '202', '사상구': '202', '기장군': '202',
  '남구': '202', // 모호 — 부산/광주/대구/인천/울산 모두 있음. 첫 매칭만 적용. context로 보강 필요
  // 대구 8개 (군위군은 2023.7.1 편입)
  '달서구': '203', '달성군': '203', '군위군': '203', '북구': '203', '수성구': '203',
  // 인천 10개
  '미추홀구': '204', '연수구': '204', '계양구': '204', '부평구': '204',
  '강화군': '204', '옹진군': '204',
  // 광주 5개
  '광산구': '205',
  // 대전 5개
  '유성구': '206', '대덕구': '206',
  // 울산 5개
  '울주군': '207',
};

/**
 * 광역시도 이름/별칭 → ProvinceInfo
 */
export function findProvince(nameOrShort: string): ProvinceInfo | null {
  const q = nameOrShort.trim();
  for (const p of PROVINCES) {
    if (p.fullName === q || p.shortName === q || p.fullName.startsWith(q) || q.startsWith(p.shortName)) {
      return p;
    }
  }
  return null;
}

/**
 * 자치구·시·군명 → 해당 광역시도 orgId
 * 예: "광진구" → "201"
 */
export function findProvinceByDistrict(districtName: string): ProvinceInfo | null {
  const q = districtName.trim();
  const orgId = DISTRICT_TO_PROVINCE[q];
  if (orgId) return PROVINCES.find((p) => p.orgId === orgId) ?? null;
  return null;
}

/**
 * 자치구·시·군 LIST_ID에서 파일통계표 ID 도출
 * LIST_ID 패턴: `201_201A_<districtOrgId>_<districtOrgId><nn>`
 * 예: 광진구 `201_201A_505_50501` → orgId=505, tblId=DT_505001_FILE{year}
 *     강남구 `201_201A_523_52302` → orgId=523, tblId=DT_523002_FILE{year}
 *
 * @returns { orgId, tblIdSeq } orgId=자치구 코드, tblIdSeq=2자리 시리즈 번호("01","02"...)
 */
export function parseDistrictListId(listId: string): { orgId: string; tblIdSeq: string } | null {
  // LIST_ID 끝 5자리에서 자치구 코드(3) + 시리즈 번호(2) 추출
  const m = listId.match(/(\d{3})(\d{2})$/);
  if (!m) return null;
  return { orgId: m[1], tblIdSeq: m[2] };
}

/**
 * 자치구·시·군 LIST 동적 조회 (캐싱)
 * @returns [{ LIST_NM, LIST_ID }] 형태
 */
export async function listDistricts(orgId: string): Promise<Array<{ LIST_NM: string; LIST_ID: string }>> {
  const cache = getCacheManager();
  return cache.getStatisticsList(
    { kind: 'province_districts', orgId },
    async () => {
      const client = getKosisClient();
      const rows = await client.getStatisticsList('MT_OTITLE', orgId);
      return rows.map((r) => ({ LIST_NM: String(r.LIST_NM ?? ''), LIST_ID: String(r.LIST_ID ?? '') }));
    }
  );
}

/**
 * 자치구·시·군 이름 → 파일통계표 (orgId, tblId, 시도할 year 후보)
 * "광진구" → { orgId: "505", tblIds: ["DT_505001_FILE2025", "DT_505001_FILE2024", ...] }
 *
 * KOSIS 자치구 file 통계표는 매년 1번 발행되며 1~2년 후행으로 올라온다.
 * 호출 측에서 year 미지정 시 [currentYear-1, -2, -3] 순서로 시도 후보 반환.
 *
 * @param year 기준연도 (예: 2024). 지정 시 그 연도만, 미지정 시 currentYear-1 ~ -3 다 시도
 */
export async function resolveDistrictFileTable(
  districtName: string,
  year?: number
): Promise<{ orgId: string; tblId: string; tblIdCandidates: string[]; listNm: string } | null> {
  const prov = findProvinceByDistrict(districtName);
  if (!prov) return null;
  const districts = await listDistricts(prov.orgId);
  // 자치구명이 LIST_NM에 포함되는 항목 찾기 (LIST_NM은 보통 "강남구" 형식)
  const cand = districts.find((d) => d.LIST_NM === districtName);
  if (!cand) return null;
  // 자치구 하위 LIST 한 단계 더 들어가야 file 통계표 LIST_ID가 나온다
  const subList = await listDistricts(cand.LIST_ID);
  // 보통 "서울특별시OO구기본통계" 하나뿐
  const target = subList[0];
  if (!target) return null;
  const parsed = parseDistrictListId(target.LIST_ID);
  if (!parsed) return null;
  const buildTblId = (y: number) =>
    `DT_${parsed.orgId}${parsed.tblIdSeq.padStart(3, '0').slice(-3)}_FILE${y}`;
  const currentY = new Date().getFullYear();
  const years = year != null ? [year] : [currentY - 1, currentY - 2, currentY - 3];
  const tblIdCandidates = years.map(buildTblId);
  return {
    orgId: parsed.orgId,
    tblId: tblIdCandidates[0],
    tblIdCandidates,
    listNm: target.LIST_NM,
  };
}

/**
 * 통계표 ID가 「OO 기본통계」 시리즈에 속하는지 판단
 */
export function isProvinceBaseStat(orgId: string, tblId: string): ProvinceInfo | null {
  const p = PROVINCES.find((x) => x.orgId === orgId);
  if (!p) return null;
  if (tblId.startsWith(p.baseStatPrefix)) return p;
  return null;
}

/**
 * 입력 문자열에서 광역시도 또는 자치구명을 추출
 */
export function detectRegion(query: string): {
  province?: ProvinceInfo;
  district?: string;
} {
  // 자치구/시/군 먼저 (더 구체적)
  for (const name of Object.keys(DISTRICT_TO_PROVINCE)) {
    if (query.includes(name)) {
      return {
        district: name,
        province: PROVINCES.find((p) => p.orgId === DISTRICT_TO_PROVINCE[name]) ?? undefined,
      };
    }
  }
  // 광역시도
  for (const p of PROVINCES) {
    if (query.includes(p.fullName) || query.includes(p.shortName)) {
      return { province: p };
    }
  }
  return {};
}
