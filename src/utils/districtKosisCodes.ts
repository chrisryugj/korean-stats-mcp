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
import { findProvinceByDistrict, normalizeProvinceName, type ProvinceInfo } from './regions.js';

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
  /**
   * Map<`${provinceName}:${districtName}`, districtCode[]> — 광역시도 ITM_NM 기반.
   * 행정구역 통합 자치구(청주시 33010 구코드 + 33040 통합코드, 창원시 등)는 한 키에
   * 코드가 여러 개 — 호출 측이 데이터 있는 코드를 순회 선택한다.
   */
  byProvinceName: Map<string, string[]>;
  /** 광역시도 ITM_NM → ITM_ID (예: "서울특별시" → "11"). 자치구 UP_ITM_ID 매칭용 */
  provinceItmIdByName: Map<string, string>;
  /**
   * UP_ITM_ID 비어있는 메타용 ITM_NM 직접 인덱스 (예: DT_1ES3A03_A01S).
   * 광역시 자치구는 "서울 광진구" 결합형, 도 시군은 "수원시" 단일형으로 등록되어 있어
   * UP_ITM_ID 기반 매칭이 불가능 — 두 패턴 모두 그대로 키로 등록.
   */
  byItmName: Map<string, string>;
  /**
   * byItmName에서 동명으로 중복 등장한 ITM_NM (예: 강원·경남 "고성군").
   * 광역시도 정보 없이 disambiguate 불가 — lookup 시 매칭 회피하고 광역 fallback.
   */
  ambiguousItmNames: Set<string>;
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
const OBJ_ID_CANDIDATES = ['A', 'B', 'SGG', 'region', 'C1', 'C2'] as const;

/**
 * 자치구 인덱스로 쓸 수 있는 OBJ 그룹인지 검증 ('auto' 순회용).
 *
 * DT_1IN2030처럼 첫 OBJ가 '구분'(총인구/내국인)인 테이블에서 'auto'가
 * 자치구 아닌 그룹을 잡으면 lookup이 전부 실패한다 — 그룹 안에
 * 시군구 모양 이름(구/군/시로 끝나되 광역시도 변형 아님)이 있어야 채택.
 */
function hasDistrictEntries(idx: TableCodeIndex): boolean {
  if (idx.byProvinceName.size > 0) return true;
  for (const name of idx.byItmName.keys()) {
    const last = name.split(/\s+/).pop() ?? name;
    if (!/^[가-힣]{1,4}(구|군|시)$/.test(last)) continue;
    // '서울특별시' 같은 광역시도 명칭 변형은 자치구 아님
    if (normalizeProvinceName(name) !== name || normalizeProvinceName(last) !== last) continue;
    return true;
  }
  return false;
}

/**
 * DT_1ES3A03_A01S·DT_1ES3A01S 도 시군 코드(4자리 3Xnn) 둘째 자리 → 광역시도 약칭.
 * 동명 시군(고성군)을 광역시도 명시로 disambiguate할 때 사용.
 */
const KOSIS_DIST_CODE_PROVINCE: Record<string, string> = {
  '1': '경기', '2': '강원', '3': '충북', '4': '충남',
  '5': '전북', '6': '전남', '7': '경북', '8': '경남', '9': '제주',
};

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

      // 광역시도 ITM_ID → 표준 약칭 역색인 (테이블별 명칭 변형 정규화 — "전라북도"/"전북특별자치도" → "전북")
      const provinceNameByItmId = new Map<string, string>();
      for (const [name, id] of provinceItmIdByName.entries()) {
        provinceNameByItmId.set(id, normalizeProvinceName(name));
      }

      // 2) 자치구 행 (UP_ITM_ID 보유) + UP_ITM_ID 비어있는 자치구 ITM_NM 직접 인덱스
      const byProvinceName = new Map<string, string[]>();
      const byItmName = new Map<string, string>();
      const ambiguousItmNames = new Set<string>();
      for (const r of meta) {
        if (r.OBJ_ID !== objId) continue;
        if (!r.ITM_NM || !r.ITM_ID) continue;
        const parentId = r.UP_ITM_ID;
        if (parentId && parentId.trim().length > 0) {
          const provinceName = provinceNameByItmId.get(parentId);
          if (provinceName) {
            const key = `${provinceName}:${r.ITM_NM}`;
            // 통합 자치구는 코드가 여러 개 — 모두 수집 (중복 ITM_ID는 제외)
            const arr = byProvinceName.get(key);
            if (arr) {
              if (!arr.includes(r.ITM_ID)) arr.push(r.ITM_ID);
            } else {
              byProvinceName.set(key, [r.ITM_ID]);
            }
          }
        } else {
          // UP_ITM_ID 비어있음 — DT_1ES3A03_A01S 같은 케이스.
          // ITM_NM 그대로 키 (광역시 자치구는 "서울 광진구" 결합형, 도 시군은 "수원시" 단일형).
          // 동명 중복(강원·경남 "고성군")은 단일 키로는 disambiguate 불가 — ambiguous로 마킹.
          if (byItmName.has(r.ITM_NM)) {
            ambiguousItmNames.add(r.ITM_NM);
          } else {
            byItmName.set(r.ITM_NM, r.ITM_ID);
          }
          // 도 시군 4자리 코드(3Xnn — X=도 번호)면 "{도} {시군}" 결합 키도 등록.
          // 동명 시군(고성군 3240=강원/3834=경남)을 광역시도 명시로 disambiguate.
          const m = r.ITM_ID.match(/^3(\d)\d\d$/);
          if (m) {
            const provShort = KOSIS_DIST_CODE_PROVINCE[m[1]];
            if (provShort) byItmName.set(`${provShort} ${r.ITM_NM}`, r.ITM_ID);
          }
        }
      }

      if (byProvinceName.size === 0 && byItmName.size === 0) return null;
      return { byProvinceName, provinceItmIdByName, byItmName, ambiguousItmNames };
    };

    // 명시 objId가 'auto'면 후보 순회
    const tryOrder: readonly string[] =
      objIdHint === 'auto' ? OBJ_ID_CANDIDATES : [objIdHint];
    let result: TableCodeIndex | null = null;
    for (const oid of tryOrder) {
      const idx = buildIndex(oid);
      if (!idx) continue;
      // 'auto'는 자치구 모양 항목이 있는 그룹만 채택 (구분·항목 그룹 오인 방지)
      if (objIdHint === 'auto' && !hasDistrictEntries(idx)) continue;
      result = idx;
      break;
    }
    // 자치구 매핑 못 찾았으면 빈 인덱스
    const finalIdx: TableCodeIndex = result ?? {
      byProvinceName: new Map(),
      provinceItmIdByName: new Map(),
      byItmName: new Map(),
      ambiguousItmNames: new Set(),
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
 * 특정 KOSIS 테이블의 자치구 행정코드 후보 lookup
 *
 * 일반화: 테이블마다 광역시도 코드 체계가 다른 문제(KSCD vs 인구동향 코드 vs ...)는
 * KOSIS 메타의 광역시도 ITM_NM(예: "서울특별시")으로 매칭해서 해결.
 *
 * 후보 배열 반환: 행정구역 통합 자치구(청주시·창원시 등)는 KOSIS에 코드가 2개
 * (구코드 + 통합코드) — 구코드는 데이터 결측인 경우가 많아 호출 측이 순회 선택해야 한다.
 *
 * @returns 자치구 코드 후보 배열 (없으면 빈 배열). 첫 원소 우선.
 */
export async function getDistrictKscdCandidatesFor(
  orgId: string,
  tblId: string,
  districtName: string,
  provinceHint?: ProvinceInfo,
  objIdHint: string = 'auto'
): Promise<string[]> {
  const prov = provinceHint ?? findProvinceByDistrict(districtName);
  const idx = await loadDistrictCodesFor(orgId, tblId, objIdHint);
  const { byProvinceName, byItmName, ambiguousItmNames } = idx;

  // ── 1) UP_ITM_ID 기반 매칭 (DT_1B040A3, DT_1B81A23, INH_* 등 표준 구조) ──
  // byProvinceName 키는 normalizeProvinceName으로 표준 약칭화돼 있어 prov.shortName 직접 매칭.
  if (prov) {
    const codes = byProvinceName.get(`${prov.shortName}:${districtName}`);
    if (codes && codes.length > 0) return codes;
  }

  // ── 2) UP_ITM_ID 없는 메타 fallback (DT_1ES3A03_A01S 등) ──
  // 광역시 자치구: ITM_NM = "서울 광진구" / "부산 해운대구" (광역시 shortName + 공백 + 자치구)
  // 도 시군:      ITM_NM = "수원시" / "포항시" (단일)
  // 동명 자치구는 prov.shortName 결합으로 disambiguate.
  if (byItmName.size > 0) {
    // 2a) 도 시군 단일형 (수원시/청주시 등). 동명 중복(고성군)은 회피 → 광역 fallback.
    if (!ambiguousItmNames.has(districtName)) {
      const single = byItmName.get(districtName);
      if (single) return [single];
    }

    // 2b) 광역시 자치구 결합형 — prov 필요
    if (prov) {
      const combinedShort = byItmName.get(`${prov.shortName} ${districtName}`);
      if (combinedShort) return [combinedShort];
      const combinedFull = byItmName.get(`${prov.fullName} ${districtName}`);
      if (combinedFull) return [combinedFull];
    }
  }

  return [];
}

/** 단일 코드 lookup (후보 중 첫 번째). 통합 자치구 데이터 결측 가능성은 후보 순회로 처리할 것. */
export async function getDistrictKscdCodeFor(
  orgId: string,
  tblId: string,
  districtName: string,
  provinceHint?: ProvinceInfo,
  objIdHint: string = 'auto'
): Promise<string | null> {
  const codes = await getDistrictKscdCandidatesFor(
    orgId,
    tblId,
    districtName,
    provinceHint,
    objIdHint
  );
  return codes[0] ?? null;
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
