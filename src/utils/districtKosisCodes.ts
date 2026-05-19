/**
 * KOSIS 자치구 행정구역 코드 동적 lookup
 *
 * DT_1B040A3 (행정구역(시군구)별 성별 인구수) 같은 KOSIS OpenAPI 테이블은
 * 자치구를 5자리 행정구역 코드(KSCD)로 식별 — 예: 광진구=11215, 해운대구=26350.
 *
 * 코드 표는 KOSIS getMeta(orgId=101, tblId=DT_1B040A3, type=ITM)로 한 번에 가져오고
 * 메모리에 캐싱한다. 광역시도(2자리) + 자치구(3자리) 패턴 단순 + 정확.
 *
 * 동명 자치구(중구·남구·북구·서구·동구) disambiguate: 광역시도 코드와 함께 lookup.
 */

import { getKosisClient } from '../api/client.js';
import { findProvinceByDistrict, type ProvinceInfo } from './regions.js';

/** ProvinceInfo.orgId (201~218) → KOSIS 행정구역 코드 (2자리) */
const PROVINCE_ORGID_TO_KSCD: Record<string, string> = {
  '201': '11', // 서울
  '202': '26', // 부산
  '203': '27', // 대구
  '204': '28', // 인천
  '205': '29', // 광주
  '206': '30', // 대전
  '207': '31', // 울산
  '208': '36', // 세종
  '210': '41', // 경기
  '211': '51', // 강원 (강원특별자치도, 2023년 51 변경)
  '212': '43', // 충북
  '213': '44', // 충남
  '214': '52', // 전북 (전북특별자치도, 2024년 52 변경)
  '215': '46', // 전남
  '216': '47', // 경북
  '217': '48', // 경남
  '218': '50', // 제주
};

/** province orgId → KOSIS 행정코드 (없으면 null) */
export function getProvinceKscd(orgId: string): string | null {
  return PROVINCE_ORGID_TO_KSCD[orgId] ?? null;
}

/** 캐시 데이터 구조 */
interface TableCodeIndex {
  /** Map<`${provinceName}:${districtName}`, districtCode> — 광역시도 ITM_NM(예: "서울특별시") 기반 */
  byProvinceName: Map<string, string>;
  /** 광역시도 ITM_NM → ITM_ID (예: "서울특별시" → "11"). 자치구 UP_ITM_ID 매칭용 */
  provinceItmIdByName: Map<string, string>;
}

const cachedCodesMap = new Map<string, TableCodeIndex>();
const loadingPromises = new Map<string, Promise<TableCodeIndex>>();

/**
 * KOSIS 테이블별 자치구 OBJ_ID:
 *   - 'A':       표준 행정구역 (DT_1B040A3 인구, DT_1B81A23 출산 등)
 *   - 'SGG':     e-지방지표 시군구 분류 (DT_1YL20631 고령인구비율, DT_1YL20981 의사수 등)
 *   - 'region':  KAB 부동산 코드 (DT_1YL20161E 아파트, DT_1YL13601E 전세 등)
 *   - 'C1' 등:   기타 (자치구별 객체 OBJ_ID)
 *
 * `loadDistrictCodesFor`는 명시된 objId의 모든 행 분류·자치구 매핑.
 * objId='auto'면 OBJ_ID 후보(A→SGG→region→C1)를 순회해서 자치구 행이 있는 첫 OBJ_ID 사용.
 */
const OBJ_ID_CANDIDATES = ['A', 'SGG', 'region', 'C1', 'C2'] as const;

async function loadDistrictCodesFor(
  orgId: string,
  tblId: string,
  objIdHint: string = 'auto'
): Promise<TableCodeIndex> {
  const cacheKey = `${orgId}:${tblId}:${objIdHint}`;
  if (cachedCodesMap.has(cacheKey)) return cachedCodesMap.get(cacheKey)!;
  if (loadingPromises.has(cacheKey)) return loadingPromises.get(cacheKey)!;

  const promise = (async () => {
    const client = getKosisClient();
    const meta = (await client.getTableMeta(orgId, tblId, 'ITM')) as Record<string, string>[];

    const buildIndex = (objId: string): TableCodeIndex | null => {
      // 1) 광역시도 행 (UP_ITM_ID 비어있음)
      const provinceItmIdByName = new Map<string, string>();
      for (const r of meta) {
        if (r.OBJ_ID !== objId) continue;
        const hasParent = r.UP_ITM_ID && r.UP_ITM_ID.trim().length > 0;
        if (hasParent) continue;
        if (!r.ITM_NM || !r.ITM_ID) continue;
        if (!provinceItmIdByName.has(r.ITM_NM)) {
          provinceItmIdByName.set(r.ITM_NM, r.ITM_ID);
        }
      }

      // 광역시도 ITM_ID → ITM_NM 역색인
      const provinceNameByItmId = new Map<string, string>();
      for (const [name, id] of provinceItmIdByName.entries()) {
        provinceNameByItmId.set(id, name);
      }

      // 2) 자치구 행 (UP_ITM_ID 보유)
      const byProvinceName = new Map<string, string>();
      for (const r of meta) {
        if (r.OBJ_ID !== objId) continue;
        const parentId = r.UP_ITM_ID;
        if (!parentId || !r.ITM_NM || !r.ITM_ID) continue;
        const provinceName = provinceNameByItmId.get(parentId);
        if (!provinceName) continue;
        const key = `${provinceName}:${r.ITM_NM}`;
        if (!byProvinceName.has(key)) {
          byProvinceName.set(key, r.ITM_ID);
        }
      }

      if (byProvinceName.size === 0) return null;
      return { byProvinceName, provinceItmIdByName };
    };

    // 명시 objId가 'auto'면 후보 순회
    const tryOrder: readonly string[] =
      objIdHint === 'auto' ? OBJ_ID_CANDIDATES : [objIdHint];
    let result: TableCodeIndex | null = null;
    for (const oid of tryOrder) {
      const idx = buildIndex(oid);
      if (idx) {
        result = idx;
        break;
      }
    }
    // 자치구 매핑 못 찾았으면 빈 인덱스
    const finalIdx: TableCodeIndex = result ?? {
      byProvinceName: new Map(),
      provinceItmIdByName: new Map(),
    };
    cachedCodesMap.set(cacheKey, finalIdx);
    return finalIdx;
  })();
  loadingPromises.set(cacheKey, promise);

  try {
    return await promise;
  } finally {
    loadingPromises.delete(cacheKey);
  }
}

/**
 * 특정 KOSIS 테이블의 자치구 행정코드 lookup
 *
 * 일반화: 테이블마다 광역시도 코드 체계가 다른 문제(KSCD vs 인구동향 코드 vs ...)는
 * KOSIS 메타의 광역시도 ITM_NM(예: "서울특별시")으로 매칭해서 해결.
 *
 * @param orgId KOSIS 기관 ID
 * @param tblId KOSIS 통계표 ID
 * @param districtName 자치구·시·군 이름
 * @param provinceHint 광역시도 힌트 (없으면 findProvinceByDistrict 사용)
 * @returns 자치구 코드 또는 null
 */
export async function getDistrictKscdCodeFor(
  orgId: string,
  tblId: string,
  districtName: string,
  provinceHint?: ProvinceInfo,
  objIdHint: string = 'auto'
): Promise<string | null> {
  const prov = provinceHint ?? findProvinceByDistrict(districtName);
  if (!prov) return null;
  const { byProvinceName } = await loadDistrictCodesFor(orgId, tblId, objIdHint);

  // 광역시도 ITM_NM 후보 — fullName 우선, shortName 등
  const candidates: string[] = [prov.fullName, prov.shortName];
  for (const c of candidates) {
    const code = byProvinceName.get(`${c}:${districtName}`);
    if (code) return code;
  }
  // shortName이 메타 광역시도명의 startsWith 매칭 (예: "강원" → "강원특별자치도")
  for (const [key, code] of byProvinceName.entries()) {
    const colon = key.indexOf(':');
    if (colon === -1) continue;
    const provNm = key.slice(0, colon);
    const distNm = key.slice(colon + 1);
    if (distNm !== districtName) continue;
    if (provNm.startsWith(prov.shortName) || prov.fullName.startsWith(provNm)) {
      return code;
    }
  }
  return null;
}

/** DT_1B040A3 (인구) 전용 — 가장 자주 쓰이는 자치구 인구 lookup */
export async function getDistrictKscdCode(
  districtName: string,
  provinceHint?: ProvinceInfo
): Promise<string | null> {
  return getDistrictKscdCodeFor('101', 'DT_1B040A3', districtName, provinceHint);
}

/** 캐시 무효화 (테스트/갱신용) */
export function invalidateDistrictKscdCache(): void {
  cachedCodesMap.clear();
}
