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

/**
 * 자치구·시·군명 → 광역시도 매핑 (오프라인 정적 — KOSIS 행정구역 코드 기반)
 *
 * 매핑 원칙:
 *   - 단독 자치구·시·군(전국 1곳뿐) → 명시적 매핑
 *   - 동명 자치구 → 가장 흔히 언급되는 광역시 1곳에 매핑(첫 매칭 규칙)
 *   - 광역시도 풀네임과 충돌하는 시(예: 광주시) → 매핑 제외 (사용자 disambiguate 요구)
 *   - 강원/경남 모두 있는 고성군 → 매핑 제외
 */
const DISTRICT_TO_PROVINCE: Record<string, string> = {
  // ───── 서울 25개 자치구 ─────
  '종로구': '201', '중구': '201', '용산구': '201', '성동구': '201', '광진구': '201',
  '동대문구': '201', '중랑구': '201', '성북구': '201', '강북구': '201', '도봉구': '201',
  '노원구': '201', '은평구': '201', '서대문구': '201', '마포구': '201', '양천구': '201',
  '강서구': '201', '구로구': '201', '금천구': '201', '영등포구': '201', '동작구': '201',
  '관악구': '201', '서초구': '201', '강남구': '201', '송파구': '201', '강동구': '201',
  // 동명 자치구는 서울에 우선 매핑됨: 중구/강서구 (다른 광역시에도 있지만 서울이 압도적)

  // ───── 부산 16개 (자치구 15 + 군 1) ─────
  '부산진구': '202', '해운대구': '202', '사하구': '202', '금정구': '202',
  '연제구': '202', '수영구': '202', '사상구': '202', '기장군': '202',
  '영도구': '202', '동래구': '202',
  '남구': '202', // 동명 — 부산/광주/대구/인천/울산 모두. 첫 매칭(부산)

  // ───── 대구 9개 (군위군 2023.7.1 편입) ─────
  '달서구': '203', '달성군': '203', '군위군': '203', '수성구': '203',
  '북구': '203', // 동명 — 부산/대구/광주/울산. 첫 매칭(대구)

  // ───── 인천 10개 (자치구 8 + 군 2) ─────
  '미추홀구': '204', '연수구': '204', '계양구': '204', '부평구': '204',
  '남동구': '204', // 인천 단독
  '강화군': '204', '옹진군': '204',

  // ───── 광주 5개 ─────
  '광산구': '205',
  // 동/서/남/북구는 모두 동명 → 미등록 (광주 풀네임으로 disambiguate 필요)

  // ───── 대전 5개 ─────
  '유성구': '206', '대덕구': '206',
  // 동/중/서구는 동명 → 미등록

  // ───── 울산 5개 ─────
  '울주군': '207',
  // 중/남/동/북구는 동명 → 미등록 (남구는 부산에 매핑됨)

  // ───── 경기 31개 시군 ─────
  '수원시': '210', '성남시': '210', '용인시': '210', '부천시': '210',
  '안산시': '210', '안양시': '210', '평택시': '210', '시흥시': '210',
  '화성시': '210', '광명시': '210', '의정부시': '210', '김포시': '210',
  '하남시': '210', '오산시': '210', '이천시': '210', '안성시': '210',
  '구리시': '210', '의왕시': '210', '동두천시': '210', '과천시': '210',
  '여주시': '210', '양주시': '210', '포천시': '210', '파주시': '210',
  '남양주시': '210', '고양시': '210', '군포시': '210',
  '가평군': '210', '연천군': '210', '양평군': '210',
  // 광주시: 광주광역시와 충돌 → 미등록 ("경기 광주시"로 사용자 명시 권장)

  // ───── 강원 18개 시군 ─────
  '춘천시': '211', '원주시': '211', '강릉시': '211', '동해시': '211',
  '태백시': '211', '속초시': '211', '삼척시': '211',
  '정선군': '211', '철원군': '211', '화천군': '211', '양구군': '211',
  '인제군': '211', '홍천군': '211', '횡성군': '211', '영월군': '211',
  '평창군': '211', '양양군': '211',
  // 고성군: 강원/경남 모두 → 미등록

  // ───── 충북 11개 시군 ─────
  '청주시': '212', '충주시': '212', '제천시': '212',
  '보은군': '212', '옥천군': '212', '영동군': '212', '증평군': '212',
  '진천군': '212', '괴산군': '212', '음성군': '212', '단양군': '212',

  // ───── 충남 15개 시군 ─────
  '천안시': '213', '공주시': '213', '보령시': '213', '아산시': '213',
  '서산시': '213', '논산시': '213', '계룡시': '213', '당진시': '213',
  '부여군': '213', '서천군': '213', '청양군': '213', '홍성군': '213',
  '예산군': '213', '태안군': '213', '금산군': '213',

  // ───── 전북 14개 시군 ─────
  '전주시': '214', '군산시': '214', '익산시': '214', '정읍시': '214',
  '남원시': '214', '김제시': '214',
  '완주군': '214', '진안군': '214', '무주군': '214', '장수군': '214',
  '임실군': '214', '순창군': '214', '부안군': '214', '고창군': '214',

  // ───── 전남 22개 시군 ─────
  '목포시': '215', '여수시': '215', '순천시': '215', '나주시': '215', '광양시': '215',
  '담양군': '215', '곡성군': '215', '구례군': '215', '고흥군': '215',
  '보성군': '215', '화순군': '215', '장흥군': '215', '강진군': '215',
  '해남군': '215', '영암군': '215', '무안군': '215', '함평군': '215',
  '영광군': '215', '장성군': '215', '완도군': '215', '진도군': '215',
  '신안군': '215',

  // ───── 경북 22개 시군 ─────
  '포항시': '216', '경주시': '216', '김천시': '216', '안동시': '216',
  '구미시': '216', '영주시': '216', '영천시': '216', '상주시': '216',
  '문경시': '216', '경산시': '216',
  '의성군': '216', '청송군': '216', '영양군': '216', '영덕군': '216',
  '청도군': '216', '고령군': '216', '성주군': '216', '칠곡군': '216',
  '예천군': '216', '봉화군': '216', '울진군': '216', '울릉군': '216',

  // ───── 경남 18개 시군 ─────
  '창원시': '217', '진주시': '217', '통영시': '217', '사천시': '217',
  '김해시': '217', '밀양시': '217', '거제시': '217', '양산시': '217',
  '의령군': '217', '함안군': '217', '창녕군': '217',
  '하동군': '217', '산청군': '217', '함양군': '217', '거창군': '217',
  '합천군': '217', '남해군': '217',
  // 고성군: 강원과 충돌 → 미등록

  // ───── 제주 ─────
  '제주시': '218', '서귀포시': '218',
};

/**
 * 동명 자치구·시 — 사용자가 "광역시도명 + 자치구명" 함께 던졌을 때 disambiguate에 사용
 * (현재는 readonly 데이터로 두고 detectRegion() 등에서 참조 가능)
 */
export const AMBIGUOUS_DISTRICTS: Record<string, string[]> = {
  '중구':   ['서울', '부산', '대구', '인천', '대전', '울산'],
  '동구':   ['부산', '대구', '광주', '인천', '대전', '울산'],
  '서구':   ['부산', '대구', '광주', '인천', '대전'],
  '남구':   ['부산', '대구', '광주', '인천', '울산'],
  '북구':   ['부산', '대구', '광주', '울산'],
  '강서구': ['서울', '부산'],
  '광주시': ['광주', '경기'],
  '고성군': ['강원', '경남'],
};

/**
 * KOSIS 메타의 광역시도 ITM_NM → 표준 약칭(shortName).
 *
 * KOSIS는 통계표마다 광역시도명 표기가 다르다 — 같은 전북도 INH_1B80A18은 "전라북도",
 * DT_1B040A3은 "전북특별자치도". 자치구 코드 매칭이 명칭 변형에 깨지지 않도록 정규화한다.
 */
const PROVINCE_NAME_TO_SHORT: Record<string, string> = {
  '서울특별시': '서울', '서울': '서울',
  '부산광역시': '부산', '부산': '부산',
  '대구광역시': '대구', '대구': '대구',
  '인천광역시': '인천', '인천': '인천',
  '광주광역시': '광주', '광주': '광주',
  '대전광역시': '대전', '대전': '대전',
  '울산광역시': '울산', '울산': '울산',
  '세종특별자치시': '세종', '세종특별자치도': '세종', '세종': '세종',
  '경기도': '경기', '경기': '경기',
  '강원도': '강원', '강원특별자치도': '강원', '강원': '강원',
  '충청북도': '충북', '충북': '충북',
  '충청남도': '충남', '충남': '충남',
  '전라북도': '전북', '전북특별자치도': '전북', '전북': '전북',
  '전라남도': '전남', '전남': '전남',
  '경상북도': '경북', '경북': '경북',
  '경상남도': '경남', '경남': '경남',
  '제주도': '제주', '제주특별자치도': '제주', '제주': '제주',
};

/** 광역시도 이름(풀네임·구명칭·약칭)을 표준 약칭으로 정규화. 미인식이면 원본 그대로. */
export function normalizeProvinceName(name: string): string {
  return PROVINCE_NAME_TO_SHORT[name.trim()] ?? name.trim();
}

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
