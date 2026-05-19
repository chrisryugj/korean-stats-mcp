# 다음 세션 검증 임무 — 비-서울 자치구 통계 조회 경로 확보

## 컨텍스트 (이전 세션 결과)

프로젝트: `d:/AI_Project/korea-stats-mcp-gj` (korea-stats-mcp, MCP 서버, TypeScript, Vercel deploy)

이전 세션에서 광진구 통계 조회 기능 추가/검증 완료. 변경 파일:

- [src/utils/regions.ts](../../src/utils/regions.ts) — 광역시도 17개 orgId 매핑, `DISTRICT_TO_PROVINCE` (서울 25개구 + 일부 타시도 자치구), `detectRegion()`, `resolveDistrictFileTable()`
- [src/utils/metaLookup.ts](../../src/utils/metaLookup.ts) — `fetchTableMeta`, `findItmIdInMeta`, `resolveDimensions` (regionName→ITM_ID 자동 매칭), `summarizeTableMeta`
- [src/tools/getStatisticsData.ts](../../src/tools/getStatisticsData.ts) — `regionName`·`itemName` 입력, 매칭 실패 시 즉시 에러 + 후보 노출
- [src/tools/searchStatistics.ts](../../src/tools/searchStatistics.ts) — 자치구 키워드 → 광역시도 orgId 자동 + 「OO 기본통계」 시리즈 상위 정렬
- [src/tools/getTableInfo.ts](../../src/tools/getTableInfo.ts) — 경량 메타 조회 (filter + sampleSize), 재활성화
- [src/tools/fetchKosisExcel.ts](../../src/tools/fetchKosisExcel.ts) — KOSIS 파일통계표 3단계 다운로드 + kordoc.parse() → 마크다운. `districtName` 자동 도출 지원.

검증 통과 (서울):
- `regionName="광진구"` → 보육시설 152/138/126개소 (DT_201004_O110054, OpenAPI 라우트)
- `regionName="광진구"` → 요보호아동 41/9명 (DT_201004_O110047, 다른 ITM_ID 패턴)
- `districtName="광진구"` → 14개 파일 자동 도출 (orgId=505, tblId=DT_505001_FILE2024)
- `districtName="강남구"` → 14개 파일 자동 도출 (orgId=523, tblId=DT_523002_FILE2024)

**미해결**:
- `districtName="수성구"` → `fileStblView.do HTTP 404` (KOSIS file 통계표 `DT_556001_FILE2024` 미제공)
- `regionName="해운대구"` + 서울 통계표 → 에러는 정상이지만 부산 통계표로 라우팅하는 경로 미검증

---

## 임무

**대구·부산 등 비-서울 광역시도 자치구의 통계 조회 경로**를 찾아 검증하고, 필요시 도구 보강하라.

## 가설 (우선순위 순)

1. **Path A — 광역시도 기본통계 시리즈 (DT_2xx004_*)**: 서울처럼 광역시도 단위 기본통계 OpenAPI 시리즈가 있고, 그 안에 자치구가 ITM_NM으로 들어가 있을 가능성. **이게 동작하면 추가 코드 거의 불필요**.
2. **Path B — 자치구 단독 file 통계표 (DT_5xx00x_FILE)**: 서울 자치구처럼 별개 orgId(`5xx`)로 file 통계표 존재. KOSIS 사이트에서 직접 탐색.
3. **Path C — e-지방지표 (DT_1YL*, orgId=101)**: 통계청 e-지방지표 시리즈에 시군구 단위 데이터가 들어있음. 「학급당 학생수(시도/시/군/구)」(DT_1YL15001) 같은 패턴.

---

## 작업 단계

### 1. Path A 검증 — 광역시도 기본통계 시리즈

```bash
# 부산광역시 기본통계 — orgId=202 LIST 조회
curl 'https://kosis.kr/openapi/statisticsList.do?method=getList&apiKey=MTIyZDEyMjlkOGNiNjhhNjY0YzFmNjNiNzVmMTU2Njg=&vwCd=MT_OTITLE&parentListId=202&format=json&jsonVD=Y'

# 대구도 동일
curl 'https://kosis.kr/openapi/statisticsList.do?method=getList&apiKey=MTIyZDEyMjlkOGNiNjhhNjY0YzFmNjNiNzVmMTU2Njg=&vwCd=MT_OTITLE&parentListId=203&format=json&jsonVD=Y'
```

각 광역시도의 「OO 기본통계」 LIST_ID를 찾고, 그 하위 통계표 ID 가져와서 메타 조회. 자치구별 분류 있는지 확인.

```typescript
// 검증 코드 예시
const r = await getStatisticsData({
  orgId: '202',
  tableId: 'DT_202004_???',  // 부산 기본통계 시리즈에서 자치구별 분류 있는 표
  regionName: '해운대구',
  periodType: 'Y',
  recentCount: 3,
});
```

### 2. Path B 검증 — 자치구 단독 file 통계표

KOSIS 사이트에서 직접 자치구 LIST를 끝까지 따라가서 file 통계표 LIST_ID 확보. 광진구 패턴(`201_201A_505_50501` → `DT_505001_FILE2024`)에 비추어 다른 광역시도 자치구도 비슷한 규칙인지 확인.

수성구는 LIST_ID가 `203_203A_556_55601`인데 `DT_556001_FILE2024`가 404. **확인 필요**:
- 작성주기가 다른가? (`FILE2023` `FILE2022` 등)
- 광역시도가 자치구 단위 통계 제공 자체를 안 하는가?
- 다른 tbl_id prefix 패턴?
- KOSIS 메뉴에서 직접 페이지를 띄워서 fileStblView.do URL 어떻게 생성되는지 확인.

확인 URL:
```
https://kosis.kr/statisticsList/statisticsListIndex.do?menuId=M_01_02&vwcd=MT_OTITLE&parmTabId=M_01_02&parentId=203_203A_556_55601
```

### 3. Path C 검증 — e-지방지표

```typescript
// 모든 시군구가 ITM_NM에 들어있는 통계청 e-지방지표 시리즈
const r = await getStatisticsData({
  orgId: '101',
  tableId: 'DT_1YL15001',  // 학급당 학생수
  regionName: '수성구',
  periodType: 'Y',
  recentCount: 3,
});
```

이게 동작하면 **모든 시군구가 path C로 커버됨** (KOSIS 메뉴: 주제별 > e-지방지표).

### 4. searchStatistics 라우팅 검증

```typescript
await searchStatistics({ query: '해운대구 인구', limit: 5 });
await searchStatistics({ query: '수성구 인구', limit: 5 });
```
top 5에 적절한 통계표(부산/대구 기본통계 또는 e-지방지표)가 나오는지.

### 5. 필요시 도구 보강

- Path A가 통하면 → `regions.ts`에 부산 16개·대구 8개 등 자치구 추가 매핑 (이미 일부 있음, 검토)
- Path C가 통하면 → `searchStatistics` 의 자치구 키워드 매칭에 e-지방지표(`DT_1YL*`) 추천 추가
- Path B가 KOSIS에서 미제공인 자치구 → `fetchKosisExcel` 의 `districtName` 흐름에서 미제공 광역시도는 명시적 에러 + Path A/C로 폴백 권장 안내

---

## 검증 케이스 (다 통과해야 함)

```typescript
// 부산 해운대구
await getStatisticsData({ orgId, tableId: '<부산 기본통계 또는 e-지방지표>', regionName: '해운대구', periodType:'Y', recentCount:3 });
await searchStatistics({ query: '해운대구 인구' }); // top1이 의미있는 표

// 대구 수성구
await getStatisticsData({ orgId, tableId: '<대구 기본통계 또는 e-지방지표>', regionName: '수성구', periodType:'Y', recentCount:3 });
await searchStatistics({ query: '수성구 인구' });

// 일관성 — 광진구는 여전히 동작 (회귀)
await getStatisticsData({ orgId:'201', tableId:'DT_201004_O110054', regionName:'광진구', periodType:'Y', recentCount:3 });
```

---

## 빌드 / 실행

```bash
cd d:/AI_Project/korea-stats-mcp-gj
./node_modules/.bin/tsc          # 빌드
node .tmp_verify_*.mjs           # 검증 (ESM, dist/ 사용)
```

KOSIS API key는 [src/config/index.ts](../../src/config/index.ts) 에 내장.

웹 베이스: `https://stat.kosis.kr/nsibsHtmlSvc/fileView/FileStbl/`
- 1: `GET fileStblView.do?in_org_id=...&in_tbl_id=...`
- 2: `POST fileItmDownload.do` (body: vw_cd=NULL&list_id=NULL&org_id=...&tbl_id=...&file_svc=&file_sn=N&conn_path=)
- 3: `POST dwldServerFile.do` (body: org_id=...&tbl_id=...&file_sn=N&img_yn=&fileSvc=&file_path=<>&file_name=<>)
- 응답 JSON 형식: `{ resultMap: { dwldFilePath, dwldFileNm, dwldFileSize } }`

---

## 작업 후 보고 항목

1. **동작한 경로별 정리** (Path A/B/C 각각 어느 케이스에서 통하는지)
2. **KOSIS 자체 한계** (특정 광역시도가 자치구 단위 통계 미제공) 명시
3. **코드 변경 사항** — `regions.ts` 매핑, 도구 라우팅 로직, description 업데이트
4. **회귀 없음 확인** — 광진구·강남구 케이스 재실행
5. **임시 파일 정리** — `.tmp_*` 전부 제거 (단 사용자가 만든 `.tmp_kosis_dl.py`는 보존)
6. **README 업데이트 필요성** — 17개 광역시도별 자치구 지원 범위표

---

## 주의

- `regionName` 매칭 실패 시 폴백하지 말 것 (이전 버그). 이미 `metaLookup.ts`의 `unmatched` 필드로 차단함 — 회귀 방지.
- kordoc 2.8.0 사용 중. 응답 길이 큰 마크다운(>100KB)은 시트별로 잘라서 노출하는 옵션 추가 검토.
- Vercel serverless 환경에서 kordoc 4.3MB cold start 영향은 별도 확인 필요 (이전 세션 미검증).
