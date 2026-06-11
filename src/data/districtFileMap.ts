/**
 * 자치구 통계연보 파일 매핑 (KOSIS file 통계표)
 *
 * 자치구청 발행 통계연보(DT_<orgId>001_FILE<year>)는 14개 분야 .xlsx 파일로 구성.
 * 정식 키워드(QUICK_STATS_PARAMS의 키 또는 KEYWORD_ALIASES 정규화 결과) →
 * 해당 분야 file_sn(1~14) 매핑.
 *
 * 광진구 기준 14개 파일 구조:
 *   1: Ⅱ.토지/기후 · 2: Ⅲ.인구 · 3: Ⅳ.노동/사업체 · 4: Ⅴ.농림/제조
 *   5: Ⅵ.가스/상하수도 · 6: Ⅶ.유통/금융/무역수지 · 7: Ⅷ.주택/건설
 *   8: Ⅸ.교통/관광 · 9: Ⅹ.보건 · 10: XI.사회보장 · 11: XII.환경
 *   12: XIII.교육/문화 · 13: XIV.재정 · 14: XV.공공행정/사법
 *
 * P0 범위: 인구·노동·주거·보건 4분야만 매핑. 나머지는 P2에서 자치구별 검증 후 확장.
 */

/**
 * 자치구 단위 KOSIS OpenAPI 라우팅 매핑 (키워드 → 테이블·항목 코드)
 *
 * fetchKosisExcel(.xlsx 자치구 통계연보)이 미제공/PDF인 자치구에서도 자치구 정밀값을 보장.
 * objL1은 런타임에 `getDistrictKscdCodeFor(orgId, tblId, districtName)` 으로 동적 lookup.
 *
 * 정확도 — KOSIS getMeta로 자치구 OBJ_ID=A 자치구별 ITM_ID 추출 후 호출. 라이브 검증 완료:
 *   - DT_1B040A3 광진구(11215) → 331,029명 ✓
 *   - DT_1B81A23 합계출산율 — 자치구별 코드 보유
 */
export interface DistrictOpenApiRoute {
  orgId: string;
  tblId: string;
  itmId: string;
  /** KOSIS 수록주기. 라벨링은 응답 PRD_SE 우선 — route 값은 호출 힌트. 'S'=반기. */
  prdSe: 'Y' | 'Q' | 'M' | 'S';
  /** 자연어 응답 description (예: '주민등록 총인구', '합계출산율') */
  description: string;
  /** 단위 (예: '명', '%') — 응답에서 자동 부착 */
  unit: string;
  /** 자치구 객체 OBJ_ID (KOSIS 테이블마다 다름: 'A'/'SGG'/'region'/'C1'/'S' 등). 'auto'면 후보 순회 */
  objId?: string;
  /** 보조 분류 코드 (예: DT_1ES3A03_A01S 연령 YRE — '000'=계, '060'=15-64세) */
  objL2?: string;
  /**
   * 자치구 코드가 들어가는 objLevel. 기본 1 — objL1=districtCode.
   * 일부 KOSIS 테이블(예: INH_1B80A18 사망률 — OBJ_ID 순서 SBB/S)은 자치구가 objL2.
   * 2로 지정하면 objL1=extraObjL1(고정값), objL2=districtCode.
   */
  districtObjLevel?: 1 | 2;
  /** districtObjLevel=2일 때 objL1에 들어가는 고정값 (예: SBB=계=='0'). */
  extraObjL1?: string;
  /** 국가데이터처 장래추계 데이터 — 미래연도 실측 아닌 추계 안내 */
  isProjection?: boolean;
}

export const DISTRICT_OPENAPI_ROUTES: Record<string, DistrictOpenApiRoute> = {
  // ── 인구 (DT_1B040A3, 행정안전부 주민등록인구) ─ OBJ_ID=A ──
  '인구': { orgId: '101', tblId: 'DT_1B040A3', itmId: 'T20', prdSe: 'M', objId: 'A', description: '주민등록 총인구', unit: '명' },
  '총인구': { orgId: '101', tblId: 'DT_1B040A3', itmId: 'T20', prdSe: 'M', objId: 'A', description: '주민등록 총인구', unit: '명' },

  // ── 출생/출산 (DT_1B81A23, 국가데이터처 인구동향) ─ OBJ_ID=A ──
  '출산율': { orgId: '101', tblId: 'DT_1B81A23', itmId: 'T2', prdSe: 'Y', objId: 'A', description: '합계출산율', unit: '명' },
  '합계출산율': { orgId: '101', tblId: 'DT_1B81A23', itmId: 'T2', prdSe: 'Y', objId: 'A', description: '합계출산율', unit: '명' },
  '출생아수': { orgId: '101', tblId: 'DT_1B81A23', itmId: 'T1', prdSe: 'Y', objId: 'A', description: '출생아수', unit: '명' },
  '출생아': { orgId: '101', tblId: 'DT_1B81A23', itmId: 'T1', prdSe: 'Y', objId: 'A', description: '출생아수', unit: '명' },

  // ── 고령인구·노인 (DT_1YL20631 고령인구비율 e-지방지표) ─ OBJ_ID=SGG ──
  // T001=65세이상인구, T002=전체인구, T10=고령인구비율
  '고령인구': { orgId: '101', tblId: 'DT_1YL20631', itmId: 'T001', prdSe: 'Y', objId: 'SGG', description: '65세 이상 고령인구', unit: '명' },
  '노인인구': { orgId: '101', tblId: 'DT_1YL20631', itmId: 'T001', prdSe: 'Y', objId: 'SGG', description: '65세 이상 노인인구', unit: '명' },
  '65세이상인구': { orgId: '101', tblId: 'DT_1YL20631', itmId: 'T001', prdSe: 'Y', objId: 'SGG', description: '65세 이상 인구', unit: '명' },
  '고령인구비율': { orgId: '101', tblId: 'DT_1YL20631', itmId: 'T10', prdSe: 'Y', objId: 'SGG', description: '고령인구비율', unit: '%' },
  // 노령화지수 ≠ 고령인구비율 (지수=65+/0~14세×100, 비율=65+/전체×100) — 정의가 다른
  // 지표를 같은 키워드로 응답하던 매핑 오류 수정. DT_1IN2030(인구총조사 실측,
  // objL1=구분 01=총인구, objL2=행정구역 5자리 시군구) 라이브 검증: 광진구 2024=241.6.
  '고령화지수': { orgId: '101', tblId: 'DT_1IN2030', itmId: 'T4', prdSe: 'Y', objId: 'auto', districtObjLevel: 2, extraObjL1: '01', description: '노령화지수 (유소년인구 100명당 65세 이상 인구)', unit: '' },
  '노령화지수': { orgId: '101', tblId: 'DT_1IN2030', itmId: 'T4', prdSe: 'Y', objId: 'auto', districtObjLevel: 2, extraObjL1: '01', description: '노령화지수 (유소년인구 100명당 65세 이상 인구)', unit: '' },

  // ── 의사수 (DT_1YL20981 인구 천명당 의사수 e-지방지표) ─ OBJ_ID=SGG ──
  // T001=의료기관 종사 의사수, T002=주민등록인구, T10=인구 천명당 의사수
  '의사': { orgId: '101', tblId: 'DT_1YL20981', itmId: 'T001', prdSe: 'Y', objId: 'SGG', description: '의료기관 종사 의사수', unit: '명' },
  '의사수': { orgId: '101', tblId: 'DT_1YL20981', itmId: 'T001', prdSe: 'Y', objId: 'SGG', description: '의료기관 종사 의사수', unit: '명' },
  '의료인력': { orgId: '101', tblId: 'DT_1YL20981', itmId: 'T001', prdSe: 'Y', objId: 'SGG', description: '의료기관 종사 의사수', unit: '명' },

  // ── 아파트 매매가격 (DT_1YL20161E e-지방지표 KAB) ─ OBJ_ID=region ──
  '아파트가격': { orgId: '101', tblId: 'DT_1YL20161E', itmId: 'sales', prdSe: 'M', objId: 'region', description: '아파트매매가격지수', unit: '' },
  '아파트매매가격': { orgId: '101', tblId: 'DT_1YL20161E', itmId: 'sales', prdSe: 'M', objId: 'region', description: '아파트매매가격지수', unit: '' },
  '아파트가격지수': { orgId: '101', tblId: 'DT_1YL20161E', itmId: 'sales', prdSe: 'M', objId: 'region', description: '아파트매매가격지수', unit: '' },
  '아파트': { orgId: '101', tblId: 'DT_1YL20161E', itmId: 'sales', prdSe: 'M', objId: 'region', description: '아파트매매가격지수', unit: '' },

  // ── 주택 전세가격 (DT_1YL13601E e-지방지표 KAB) ─ OBJ_ID=region ──
  '전세가격': { orgId: '101', tblId: 'DT_1YL13601E', itmId: 'sales', prdSe: 'M', objId: 'region', description: '주택전세가격지수', unit: '' },
  '전세가격지수': { orgId: '101', tblId: 'DT_1YL13601E', itmId: 'sales', prdSe: 'M', objId: 'region', description: '주택전세가격지수', unit: '' },
  '주택전세': { orgId: '101', tblId: 'DT_1YL13601E', itmId: 'sales', prdSe: 'M', objId: 'region', description: '주택전세가격지수', unit: '' },
  '전세': { orgId: '101', tblId: 'DT_1YL13601E', itmId: 'sales', prdSe: 'M', objId: 'region', description: '주택전세가격지수', unit: '' },

  // ── 고용 (DT_1ES3A03_A01S 시군구/연령별 취업자 및 고용률) ─ OBJ_ID=A, objL2=YRE(연령) ──
  // ITEM: T00=취업자(천명), T12=고용률(%). objL2='000'=전체 연령(계).
  // ITM_NM 패턴 — 광역시 자치구: "서울 광진구"(결합), 도 시군: "수원시"(단일). UP_ITM_ID 비어있음 — 결합/단일 fallback 필요.
  // 주기 — 반기 공표(prdSe='S'). PRD_DE 끝 2자리 01=상반기/02=하반기. 라벨은 응답 PRD_SE 기준.
  '고용률':    { orgId: '101', tblId: 'DT_1ES3A03_A01S', itmId: 'T12', prdSe: 'S', objId: 'A', objL2: '000', description: '고용률', unit: '%' },
  '취업자수':  { orgId: '101', tblId: 'DT_1ES3A03_A01S', itmId: 'T00', prdSe: 'S', objId: 'A', objL2: '000', description: '취업자', unit: '천명' },
  '취업자':    { orgId: '101', tblId: 'DT_1ES3A03_A01S', itmId: 'T00', prdSe: 'S', objId: 'A', objL2: '000', description: '취업자', unit: '천명' },

  // ── 실업 (DT_1ES3A01S 시군구 경제활동인구 총괄) ─ OBJ_ID=A, ITM_NM 패턴 동일 ──
  // ITEM: T3=취업자, T4=실업자, T7=고용률, T8=실업률(%). 자치구 4자리 코드.
  // 주기 — 반기 공표(prdSe='S'). 라벨은 응답 PRD_SE 기준.
  '실업률':    { orgId: '101', tblId: 'DT_1ES3A01S', itmId: 'T8', prdSe: 'S', objId: 'A', description: '실업률', unit: '%' },
  '실업자수':  { orgId: '101', tblId: 'DT_1ES3A01S', itmId: 'T4', prdSe: 'S', objId: 'A', description: '실업자', unit: '천명' },
  '실업자':    { orgId: '101', tblId: 'DT_1ES3A01S', itmId: 'T4', prdSe: 'S', objId: 'A', description: '실업자', unit: '천명' },
  '경제활동인구': { orgId: '101', tblId: 'DT_1ES3A01S', itmId: 'T2', prdSe: 'S', objId: 'A', description: '경제활동인구', unit: '천명' },
  '비경제활동인구': { orgId: '101', tblId: 'DT_1ES3A01S', itmId: 'T5', prdSe: 'S', objId: 'A', description: '비경제활동인구', unit: '천명' },

  // ── 인구동태 시군구 (INH_* 인디케이터 테이블 — 자치구 단위 연간 데이터) ──
  // 주의: DT_1B8000I 메타에는 자치구 행이 있으나 KOSIS API 실 데이터 0건(전국/광역/자치구 모두 미제공) → 사용 불가.
  // 대신 INH_1B82A01(사망자수)/INH_1B83A35(혼인건수)/INH_1B85033(이혼건수)/INH_1B8000I_01(조이혼율)/INH_1B8000I_02(조혼인율) 사용.
  '사망자수':  { orgId: '101', tblId: 'INH_1B82A01', itmId: 'T1', objL2: '0', prdSe: 'Y', objId: 'A', description: '사망자수', unit: '명' },
  '사망자':    { orgId: '101', tblId: 'INH_1B82A01', itmId: 'T1', objL2: '0', prdSe: 'Y', objId: 'A', description: '사망자수', unit: '명' },
  '혼인건수':  { orgId: '101', tblId: 'INH_1B83A35', itmId: 'T3', prdSe: 'Y', objId: 'A', description: '혼인건수', unit: '건' },
  '이혼건수':  { orgId: '101', tblId: 'INH_1B85033', itmId: 'T4', prdSe: 'Y', objId: 'A', description: '이혼건수', unit: '건' },
  '혼인율':    { orgId: '101', tblId: 'INH_1B8000I_02', itmId: 'T41', prdSe: 'Y', objId: 'A', description: '조혼인율', unit: '천명당' },
  '조혼인율':  { orgId: '101', tblId: 'INH_1B8000I_02', itmId: 'T41', prdSe: 'Y', objId: 'A', description: '조혼인율', unit: '천명당' },
  '이혼율':    { orgId: '101', tblId: 'INH_1B8000I_01', itmId: 'T51', prdSe: 'Y', objId: 'A', description: '조이혼율', unit: '천명당' },
  '조이혼율':  { orgId: '101', tblId: 'INH_1B8000I_01', itmId: 'T51', prdSe: 'Y', objId: 'A', description: '조이혼율', unit: '천명당' },

  // ── 사망률 (INH_1B80A18) ─ OBJ 순서 SBB→S, 자치구가 objL2 ──
  // KOSIS 단위 '십만명당' (인구 10만명당 사망자수). 천명당 변환 X — 원본 그대로 응답.
  '사망률':    { orgId: '101', tblId: 'INH_1B80A18', itmId: 'T4', prdSe: 'Y', objId: 'S', districtObjLevel: 2, extraObjL1: '0', description: '사망률', unit: '십만명당' },
  '조사망률':  { orgId: '101', tblId: 'INH_1B80A18', itmId: 'T4', prdSe: 'Y', objId: 'S', districtObjLevel: 2, extraObjL1: '0', description: '사망률', unit: '십만명당' },
};

export const DISTRICT_KEYWORD_TO_FILESN: Record<string, number> = {
  // ── Ⅲ. 인구 (file_sn=2) ─────────────────────────────────────────────
  '인구': 2,
  '총인구': 2,
  '고령인구': 2,
  '노인인구': 2,
  '65세이상인구': 2,
  '출산율': 2,
  '합계출산율': 2,
  '출생아수': 2,
  '출생아': 2,
  '조출생률': 2,
  '사망자수': 2,
  '사망자': 2,
  '조사망률': 2,
  '사망률': 2,
  '혼인율': 2,
  '조혼인율': 2,
  '혼인건수': 2,
  '이혼율': 2,
  '조이혼율': 2,
  '이혼건수': 2,
  '자연증가': 2,
  '자연증가율': 2,
  '노령화지수': 2,
  '고령화지수': 2,
  '초혼연령': 2,
  '평균초혼연령': 2,
  '남성초혼연령': 2,
  '여성초혼연령': 2,

  // ── Ⅳ. 노동·사업체 (file_sn=3) ─────────────────────────────────────
  '취업자수': 3,
  '취업자': 3,
  '실업률': 3,
  '실업자수': 3,
  '실업자': 3,
  '고용률': 3,
  '경제활동인구': 3,
  '비경제활동인구': 3,
  '임금': 3,
  '월평균임금': 3,
  '월급': 3,
  '평균임금': 3,

  // ── Ⅷ. 주택·건설 (file_sn=7) ───────────────────────────────────────
  '주택가격': 7,
  '주택매매가격': 7,
  '주택가격지수': 7,
  '아파트가격': 7,
  '아파트매매가격': 7,
  '아파트가격지수': 7,
  '아파트': 7,
  '전세가격': 7,
  '전세가격지수': 7,
  '주택전세': 7,
  '전세': 7,
  '아파트전세': 7,
  '아파트전세가격': 7,

  // ── Ⅹ. 보건 (file_sn=9) ────────────────────────────────────────────
  '의사': 9,
  '의사수': 9,
  '의료인력': 9,
};

/**
 * file_sn(광진구 기준 분야) → 통계연보 분야 파일명 매칭 패턴
 *
 * 자치구마다 통계연보 .xlsx의 분야 순서가 달라 file_sn 하드코딩은 광진구에서만 검증됨.
 * (서울 자치구는 "기관>연도별통계연보>분야", 일부 광역시 자치구는 분야 순서·개수가 상이)
 * fetchKosisExcel가 파싱한 파일 목록의 분야명(file_nm)을 이 패턴으로 매칭해
 * file_sn을 자치구별로 동적 도출한다 — resolveFileSnByKeyword().
 */
const FILESN_BUNYA_PATTERN: Record<number, RegExp> = {
  2: /인구|가구|세대/,         // Ⅲ.인구
  3: /노동|사업체|고용|취업/,   // Ⅳ.노동·사업체
  7: /주택|건설|주거/,         // Ⅷ.주택·건설
  9: /보건|의료|위생/,         // Ⅹ.보건
};

/**
 * 자치구 통계연보 파일 목록에서 키워드에 해당하는 file_sn 동적 도출
 *
 * DISTRICT_KEYWORD_TO_FILESN(광진구 기준 정적 매핑)으로 "어느 분야"인지 식별한 뒤,
 * 실제 file_sn은 파일 목록의 분야명(file_nm)을 FILESN_BUNYA_PATTERN으로 매칭해 결정.
 * 통계연보 분야 순서가 광진구와 다른 자치구에서도 정확한 분야 파일을 가리킨다.
 *
 * @returns 매칭된 file_sn. 키워드 미매핑·분야명 매칭 실패 시 null (xlsx 경로 포기 신호).
 */
export function resolveFileSnByKeyword(
  files: { file_sn: number; file_nm: string }[],
  keyword: string
): number | null {
  const staticSn = DISTRICT_KEYWORD_TO_FILESN[keyword];
  if (staticSn === undefined) return null;
  const pattern = FILESN_BUNYA_PATTERN[staticSn];
  if (!pattern) return null;
  const matched = files.find((f) => pattern.test(f.file_nm));
  return matched ? matched.file_sn : null;
}

/**
 * 키워드 → 자치구 통계연보 markdown 행 매칭 정규식
 * extractDistrictHighlight()에서 사용. 첫 매칭 행 + 인접 행(헤더·단위)을 추출.
 * value/unit 자동 추정에도 동일 패턴 적용.
 */
const HIGHLIGHT_PATTERNS: Record<string, RegExp> = {
  '인구': /(?:총|등록|주민등록)?\s*인구(?!\s*동태)|인구밀도/,
  '총인구': /총\s*인구|등록\s*인구|주민등록\s*인구/,
  '고령인구': /65세\s*이상|고령\s*인구|노인\s*인구/,
  '노인인구': /65세\s*이상|고령\s*인구|노인\s*인구/,
  '65세이상인구': /65세\s*이상/,
  '출산율': /합계\s*출산율|조출생률|출생률/,
  '합계출산율': /합계\s*출산율/,
  '출생아수': /출생아\s*수|출생자\s*수/,
  '출생아': /출생아|출생자/,
  '조출생률': /조출생률|출생률/,
  '사망자수': /사망자\s*수|사망자/,
  '사망자': /사망자/,
  '조사망률': /조사망률|사망률/,
  '사망률': /사망률/,
  '혼인율': /혼인율|조혼인율/,
  '조혼인율': /조혼인율/,
  '혼인건수': /혼인\s*건수|혼인/,
  '이혼율': /이혼율|조이혼율/,
  '조이혼율': /조이혼율/,
  '이혼건수': /이혼\s*건수|이혼/,
  '자연증가': /자연증가/,
  '자연증가율': /자연증가율/,
  '노령화지수': /노령화\s*지수|고령화\s*지수/,
  '고령화지수': /노령화\s*지수|고령화\s*지수/,
  '초혼연령': /초혼\s*연령|평균\s*초혼/,
  '평균초혼연령': /평균\s*초혼/,
  '남성초혼연령': /남(?:자|성)\s*평균?\s*초혼/,
  '여성초혼연령': /여(?:자|성)\s*평균?\s*초혼/,

  '취업자수': /취업자\s*(?:수)?/,
  '취업자': /취업자\s*(?:수)?/,
  '실업률': /실업률/,
  '실업자수': /실업자\s*(?:수)?/,
  '실업자': /실업자\s*(?:수)?/,
  '고용률': /고용률/,
  '경제활동인구': /경제활동\s*인구(?!\s*비)/,
  '비경제활동인구': /비\s*경제활동\s*인구/,
  '임금': /(?:월\s*평균|평균)?\s*임금|월\s*급여/,
  '월평균임금': /월\s*평균\s*임금/,
  '월급': /(?:월\s*평균)?\s*임금|월\s*급여/,
  '평균임금': /평균\s*임금/,

  '주택가격': /주택\s*(?:매매)?\s*가격|주택매매/,
  '주택매매가격': /주택\s*매매/,
  '주택가격지수': /주택\s*가격\s*지수|주택매매\s*가격\s*지수/,
  '아파트가격': /아파트\s*(?:매매)?\s*가격|아파트매매/,
  '아파트매매가격': /아파트\s*매매/,
  '아파트가격지수': /아파트\s*가격\s*지수/,
  '아파트': /아파트/,
  '전세가격': /전세\s*(?:가격)?/,
  '전세가격지수': /전세\s*가격\s*지수/,
  '주택전세': /(?:주택|아파트)?\s*전세/,
  '전세': /전세/,
  '아파트전세': /아파트\s*전세/,
  '아파트전세가격': /아파트\s*전세/,

  '의사': /(?:^|[^원])의사\s*(?:수)?/,
  '의사수': /의사\s*수/,
  '의료인력': /의료\s*인력|의사\s*수/,
};

/**
 * 자치구 markdown에서 숫자값 + 단위 추출용 정규식
 *
 * 우선순위: "숫자+단위" 패턴이 더 신뢰도 높음 (연도·표 헤더 회피).
 *   - 1차: `1,234 명` / `56,819명` / `20,584명/km²` 같이 단위 동반
 *   - 2차: 단위 없는 콤마 포함 큰 수 (1,000 이상)
 * 연도(4자리, 콤마 없음, 1900~2100)는 제외.
 */
const NUMBER_WITH_UNIT_RX =
  /([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{5,})\s*(?:명\s*\/\s*km²|명|세대|호|개소|개|%|m²|km²|건|대|원|만원|점|위|년|세)/;
const NUMBER_BARE_RX = /(?<![0-9.,])([0-9]{1,3}(?:,[0-9]{3})+)(?![0-9.,])/;

/**
 * 키워드 → 자치구 통계연보 HTML 표 컬럼 매칭 패턴
 *
 * kordoc는 자치구 .xlsx의 복잡한 시트(다중 헤더·rowspan·colspan)는 HTML `<table>` 형태로 보존.
 * 헤더 cell 텍스트에서 keyword를 매칭해 해당 컬럼의 인덱스를 찾고,
 * 최신 연도 데이터 행에서 같은 인덱스 td 값을 추출.
 *
 * 광진구 통계연보 "1.등록인구추이" 표 예시:
 *   헤더 컬럼: 세 대 | 등록인구(합계,남,여) | 한국인(합계,남,여) | 외국인(합계,남,여) | 인구증가율 | 세대당인구 | 65세 이상 고령자 | 인구밀도 | 면적
 *   2024 행:  169931 | 348652, 166045, 182607 | 331963, 159237, 172726 | 16689, 6808, 9881 | -0.71 | 1.95 | 59743 | 20436 | 17.06
 */
const KEYWORD_TO_HEADER_PATTERN: Record<string, RegExp> = {
  '인구': /^등록인구$|^인구$|^총인구$|^주민등록\s*총인구$|^합\s*계$/,
  '총인구': /^등록인구$|^인구$|^총인구$/,
  '고령인구': /65세\s*이상/,
  '노인인구': /65세\s*이상/,
  '65세이상인구': /65세\s*이상/,
  '세대': /^세\s*대$|^세대수$/,
  '취업자수': /^취업자(?:\s*수)?$/,
  '취업자': /^취업자(?:\s*수)?$/,
  '실업률': /^실업률$/,
  '고용률': /^고용률$/,
  '의사': /^의\s*사(?:\s*수)?$/,
  '의사수': /^의\s*사\s*수$/,
};

interface HtmlExtraction {
  value: string | null;
  unit: string | null;
  contextRows: string[];
}

/**
 * <td>/<th> 텍스트 추출 (HTML 태그·br 제거 + 공백 정규화)
 */
function cleanCellText(raw: string): string {
  return raw
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * HTML <table> 한 개를 [row][col] grid로 평탄화 (colspan/rowspan 풀기)
 *
 * 광진구 통계연보 같은 다중 헤더(rowspan/colspan) 표를 정확한 컬럼 인덱스로 정렬.
 * 헤더 cell 텍스트로 keyword를 찾을 때 인덱스가 데이터 행과 직접 매핑되도록.
 */
function buildGrid(tableHtml: string): string[][] {
  const trMatches = [...tableHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => m[1]);
  const grid: string[][] = [];
  // carryDown[col] = { text, remaining } — 해당 열에 rowspan으로 이월된 텍스트
  const carryDown: Map<number, { text: string; remaining: number }> = new Map();

  for (let r = 0; r < trMatches.length; r++) {
    const cells = [...trMatches[r].matchAll(/<(t[hd])([^>]*)>([\s\S]*?)<\/\1>/g)];
    const row: string[] = [];
    let col = 0;

    const consumeCarry = (): void => {
      while (carryDown.has(col)) {
        const carry = carryDown.get(col)!;
        row[col] = carry.text;
        carry.remaining -= 1;
        if (carry.remaining === 0) carryDown.delete(col);
        col += 1;
      }
    };

    for (const m of cells) {
      consumeCarry();
      const attrs = m[2];
      const text = cleanCellText(m[3]);
      const csMatch = attrs.match(/colspan\s*=\s*"?(\d+)"?/);
      const rsMatch = attrs.match(/rowspan\s*=\s*"?(\d+)"?/);
      const cs = csMatch ? parseInt(csMatch[1], 10) : 1;
      const rs = rsMatch ? parseInt(rsMatch[1], 10) : 1;

      for (let c = 0; c < cs; c++) {
        row[col + c] = text;
        if (rs > 1) {
          carryDown.set(col + c, { text, remaining: rs - 1 });
        }
      }
      col += cs;
    }
    // 행 끝에 남은 carry 처리
    consumeCarry();

    grid.push(row);
  }
  return grid;
}

/**
 * grid에서 헤더 행과 데이터 행 분리
 * 데이터 행: 첫 컬럼이 4자리 연도(1900~2099) 또는 두 번째 컬럼이 연도
 * 그 외는 헤더 행
 */
function splitGrid(grid: string[][]): { headerRows: string[][]; dataRows: string[][] } {
  const yearRx = /^(?:19|20)\d{2}$/;
  const headerRows: string[][] = [];
  const dataRows: string[][] = [];
  for (const row of grid) {
    const isData =
      (row[0] && yearRx.test(row[0])) ||
      (row[1] && yearRx.test(row[1])) ||
      (row[0] === '' && row[1] && yearRx.test(row[1]));
    if (isData) {
      dataRows.push(row);
    } else {
      headerRows.push(row);
    }
  }
  return { headerRows, dataRows };
}

/**
 * 단일 td 텍스트에서 숫자값 + 단위 추출
 */
function parseCellValue(cell: string): { value: string | null; unit: string | null } {
  if (!cell) return { value: null, unit: null };
  // 단위 포함 — "1,234 명" / "20,584명/km²"
  const withUnit = cell.match(NUMBER_WITH_UNIT_RX);
  if (withUnit) {
    const after = cell.slice(withUnit.index! + withUnit[1].length);
    const u = after.match(/^\s*(명\s*\/\s*km²|명|세대|호|개소|개|%|m²|km²|건|대|원|만원|점|위|년|세)/);
    return {
      value: withUnit[1],
      unit: u?.[1]?.replace(/\s+/g, '') ?? null,
    };
  }
  // 콤마 포함 큰 수 / 소수 / 정수 — 연도(1900~2099, 콤마 없는 4자리) 제외
  const bare = cell.match(/^-?[0-9]{1,3}(?:,[0-9]{3})+$|^-?[0-9]{4,}$|^-?[0-9]+(?:\.[0-9]+)?$/);
  if (bare) {
    const n = parseFloat(bare[0].replace(/,/g, ''));
    if (!(Number.isInteger(n) && n >= 1900 && n <= 2099 && !cell.includes(','))) {
      return { value: bare[0], unit: null };
    }
  }
  return { value: null, unit: null };
}

/**
 * grid 헤더에서 keyword 매칭 첫 컬럼 인덱스 찾기
 */
function findKeywordColumn(
  headerRows: string[][],
  headerPattern: RegExp
): number {
  // 1차: 정확 매칭 (셀 전체가 패턴)
  for (let r = 0; r < headerRows.length; r++) {
    const row = headerRows[r];
    for (let c = 0; c < row.length; c++) {
      if (row[c] && headerPattern.test(row[c])) return c;
    }
  }
  return -1;
}

/**
 * HTML <table> markdown에서 키워드 매칭 컬럼의 최신 연도 값 추출
 */
function extractFromHtmlTable(markdown: string, keyword: string): HtmlExtraction {
  const tableBlocks = [...markdown.matchAll(/<table>[\s\S]*?<\/table>/g)].map((m) => m[0]);
  if (tableBlocks.length === 0) return { value: null, unit: null, contextRows: [] };

  const keywordSnippet = HIGHLIGHT_PATTERNS[keyword] ?? new RegExp(keyword);
  const headerPattern = KEYWORD_TO_HEADER_PATTERN[keyword];

  // 후보 표 — 키워드 매칭 + 데이터 행(연도) 보유
  const dataRowRx = /<t[hd][^>]*>\s*(?:19|20)\d{2}\s*<\/t[hd]>/;
  const candidates = tableBlocks.filter(
    (t) => keywordSnippet.test(t) && dataRowRx.test(t)
  );
  // 키워드 매칭 표가 없으면 데이터 표 중 첫 표 fallback
  const fallback = tableBlocks.find((t) => dataRowRx.test(t));
  const targetTable = candidates[0] ?? fallback;
  if (!targetTable) return { value: null, unit: null, contextRows: [] };

  const grid = buildGrid(targetTable);
  const { headerRows, dataRows } = splitGrid(grid);
  if (dataRows.length === 0) return { value: null, unit: null, contextRows: [] };

  // 최신 연도 행
  const yearOf = (row: string[]): number => {
    const y = row[0] && /^(?:19|20)\d{2}$/.test(row[0]) ? row[0] : row[1];
    return parseInt(y, 10);
  };
  const sortedDataRows = [...dataRows].sort((a, b) => yearOf(b) - yearOf(a));
  const latest = sortedDataRows[0];
  const latestYear = String(yearOf(latest));

  // contextRows — 헤더 + 최신 5년 데이터 (응답 토큰 절약)
  const headerJoined = headerRows
    .slice(0, 5)
    .map((r) => r.filter((c) => c !== '').join(' | '))
    .filter((s) => s.length > 0);
  const dataJoined = sortedDataRows
    .slice(0, 5)
    .map((r) => `[${yearOf(r)}] ` + r.slice(1).filter((c) => c !== '').join(' | '));
  const contextRows = [...headerJoined, ...dataJoined];

  // 헤더에서 keyword 매칭 컬럼 인덱스
  let value: string | null = null;
  let unit: string | null = null;

  if (headerPattern) {
    const col = findKeywordColumn(headerRows, headerPattern);
    if (col >= 0 && col < latest.length) {
      const parsed = parseCellValue(latest[col]);
      if (parsed.value) {
        value = parsed.value;
        unit = parsed.unit;
      }
    }
  }

  // 컬럼 매칭 실패 → 키워드별 fallback 전략
  if (!value) {
    if (keyword === '인구' || keyword === '총인구') {
      // 가장 큰 수가 등록인구 합계
      let maxNum = 0;
      let maxStr: string | null = null;
      for (const td of latest.slice(1)) {
        const parsed = parseCellValue(td);
        if (!parsed.value) continue;
        const n = parseFloat(parsed.value.replace(/,/g, ''));
        if (n > maxNum && n > 1000) {
          maxNum = n;
          maxStr = parsed.value;
        }
      }
      if (maxStr) {
        value = maxStr;
        unit = '명';
      }
    }
  }

  // 키워드 기반 단위 보강 (헤더 매칭은 됐는데 단위 못 잡은 경우)
  if (value && !unit) {
    if (keyword === '인구' || keyword === '총인구' || keyword === '고령인구' || keyword === '노인인구' || keyword === '65세이상인구') {
      unit = '명';
    } else if (keyword === '세대') {
      unit = '세대';
    } else if (keyword === '실업률' || keyword === '고용률') {
      unit = '%';
    }
  }

  // contextRows 라벨에 연도 정보 추가
  if (value) {
    contextRows.unshift(`(최신 ${latestYear}년 데이터)`);
  }

  return { value, unit, contextRows };
}

/**
 * markdown에서 키워드 관련 핵심 행과 추정 value/unit 추출
 *
 * - highlightLines: 키워드 매칭 행 + 인접 행 (최대 50줄, 표 헤더·단위 정보 포함)
 * - value/unit: 첫 매칭 행에서 "숫자+단위" 1차 시도, 실패 시 콤마 큰 수 2차 시도
 *
 * 매칭 패턴 없거나 value 추출 실패 시 value=null. answer는 markdown만 노출로 degrade.
 */
export function extractDistrictHighlight(
  markdown: string,
  keyword: string
): {
  value: string | null;
  unit: string | null;
  highlightLines: string[];
} {
  // kordoc 결과는 자치구별로 (1) HTML <table> 보존, (2) markdown 표·평문 두 가지 형태.
  // HTML이 우세하므로 먼저 HTML 추출 시도, 실패 시 markdown 행 매칭 fallback.

  // 1차: HTML 표 컬럼 매칭 (광진구 등 .xlsx 자치구 통계연보 본 형태)
  if (/<table>/.test(markdown)) {
    const html = extractFromHtmlTable(markdown, keyword);
    if (html.value) {
      return {
        value: html.value,
        unit: html.unit,
        highlightLines: html.contextRows,
      };
    }
    // HTML이지만 추출 실패 — 표 행 컨텍스트 일부 첨부
    if (html.contextRows.length > 0) {
      return { value: null, unit: null, highlightLines: html.contextRows };
    }
  }

  // 2차: markdown 행 단위 패턴 매칭 (markdown 형태 자치구)
  const pattern = HIGHLIGHT_PATTERNS[keyword];
  if (!pattern) return { value: null, unit: null, highlightLines: [] };

  const lines = markdown.split('\n');
  const highlightLines: string[] = [];
  const includedIdx = new Set<number>();

  for (let i = 0; i < lines.length; i++) {
    if (!pattern.test(lines[i])) continue;
    const start = Math.max(0, i - 1);
    const end = Math.min(lines.length, i + 3);
    for (let j = start; j < end; j++) {
      if (includedIdx.has(j)) continue;
      includedIdx.add(j);
      highlightLines.push(lines[j]);
    }
    if (highlightLines.length >= 50) break;
  }

  let value: string | null = null;
  let unit: string | null = null;
  for (const line of highlightLines) {
    const withUnit = line.match(NUMBER_WITH_UNIT_RX);
    if (withUnit) {
      value = withUnit[1];
      const u = line.slice(withUnit.index! + withUnit[1].length).match(
        /^\s*(명\s*\/\s*km²|명|세대|호|개소|개|%|m²|km²|건|대|원|만원|점|위|년|세)/
      );
      unit = u?.[1]?.replace(/\s+/g, '') ?? null;
      break;
    }
    const bare = line.match(NUMBER_BARE_RX);
    if (bare && !value) {
      const num = parseInt(bare[1].replace(/,/g, ''), 10);
      if (num >= 1000 && (num < 1900 || num > 2100)) {
        value = bare[1];
      }
    }
  }

  return { value, unit, highlightLines };
}
