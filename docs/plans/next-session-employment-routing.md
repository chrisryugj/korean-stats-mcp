# 다음 세션: 자치구 고용·인구동태·동적라우팅 일소 (v1.6.0)

> 새 세션 첫 메시지에 통째 붙여넣거나 `cat docs/plans/next-session-employment-routing.md`로 흡수 후 시작.

---

## 1. 컨텍스트 — v1.5.0 직전 상황

### 끝낸 것 (2026-05-19/20, v1.5.0)
- `fetchKosisExcel` 3 fetch + KOSIS OpenAPI client 모두 retry/timeout 15s + 지수 백오프 3회
- 자치구 정밀 OpenAPI 라우팅 7분야 (전국 230+ 자치구):
  - 인구/총인구 → `DT_1B040A3` (OBJ_ID=A, itmId=T20)
  - 출산율/합계출산율/출생아수 → `DT_1B81A23` (OBJ_ID=A)
  - 고령인구/노인인구/65세이상/고령화지수 → `DT_1YL20631` (OBJ_ID=SGG)
  - 의사수/의료인력 → `DT_1YL20981` (OBJ_ID=SGG)
  - 아파트가격 → `DT_1YL20161E` (OBJ_ID=region, KAB 코드)
  - 전세가격 → `DT_1YL13601E` (OBJ_ID=region, KAB 코드)
- HTML 통계연보 표 colspan/rowspan grid 평탄화 + 키워드 헤더 컬럼 매칭 (광진구 .xlsx → 348,652명 정확 추출)
- 동명 자치구 disambiguate (광역시도 힌트 활용)
- 시뮬 53/53 (100%) + Fly 배포 + npm v1.5.0 + 라이브 10/10 검증

### 미커버 — 다음 세션 P0
| 키워드 | 상태 | 원인 |
|---|---|---|
| 고용률/실업률/취업자수 | 광역 fallback | KOSIS `DT_1ES3A03_A01S` 자치구 ITM_ID 4자리 (수원시=3101 등) + `objL2=YRE` 연령 필수. 광역시도 UP_ITM_ID 비어있어 현재 일반화 lookup 미적용 |
| 미세먼지/PM2.5/PM10 | 광역 fallback | KOSIS 자치구 단위 대기오염도 테이블 미확인 |
| 범죄율/범죄발생 | 광역 fallback | 시군구 범죄통계 테이블 미확인 |
| 사망률/사망자수 | 광역 fallback | `DT_1B83A05` 등 시군구 사망 통계 미매핑 |
| 혼인율/이혼율 | 광역 fallback | `DT_1B82A*` / `DT_1B82B*` 등 시군구 혼인·이혼 미매핑 |
| 자동차/교통사고 | 광역 fallback | 시군구 단위 매핑 미확인 |
| 광진구 외 자치구 통계연보 value 자동 추출 | 일부 null | HTML 표 헤더 패턴 자치구별 미세 차이 |

---

## 2. 이번 세션 목표 (v1.6.0)

**자치구 정밀 OpenAPI 라우팅 분야 11+ 분야로 확장 + 동적 라우팅 fallback**.

종료 조건:
- 시뮬 70+ 케이스, 95%+ 자치구 정밀값 (precise) 달성
- 고용률/실업률 전국 자치구 precise
- 사망률/혼인율/이혼율 전국 자치구 precise (가능한 만큼)
- search_statistics 동적 라우팅 옵션 추가 — 매핑 없는 키워드도 자치구 단위 시도
- 광진구 통계연보 value 자동 추출 보강 (취업자/고용률/의사수 value=null → 정확 추출)
- Fly 재배포 + npm v1.6.0 게시 + main 커밋·푸시

---

## 3. 작업 항목

### 🔴 P0-1 고용 시군구 라우팅 (DT_1ES3A03_A01S)

[src/data/districtFileMap.ts](src/data/districtFileMap.ts:DISTRICT_OPENAPI_ROUTES) 에 추가:

```ts
'고용률':    { orgId: '101', tblId: 'DT_1ES3A03_A01S', itmId: 'T12', objL2: 'YRE0001', prdSe: 'Y', objId: 'A', description: '고용률', unit: '%' },
'취업자수':  { orgId: '101', tblId: 'DT_1ES3A03_A01S', itmId: 'T00', objL2: 'YRE0001', prdSe: 'Y', objId: 'A', description: '취업자', unit: '천명' },
'취업자':    { orgId: '101', tblId: 'DT_1ES3A03_A01S', itmId: 'T00', objL2: 'YRE0001', prdSe: 'Y', objId: 'A', description: '취업자', unit: '천명' },
'실업률':    { orgId: '101', tblId: 'DT_1ES3A05_A01S', itmId: '?',   objL2: 'YRE0001', prdSe: 'Y', objId: 'A', description: '실업률', unit: '%' },
```

**문제**: DT_1ES3A03_A01S 자치구 ITM_ID 4자리 (예: 수원시=3101, 광진구=?) — UP_ITM_ID 없음.
- 메타 조회로 자치구 ITM_ID lookup해야 함
- 광역시도 정보 없이 ITM_NM만으로 매칭 (동명 자치구 동작 안 함)

해결:
1. `DistrictOpenApiRoute`에 `objL2` 필드 추가
2. `getDistrictKscdCodeFor`에서 광역시도 매칭 안 되면 districtName만으로 fallback lookup (UP_ITM_ID 없을 때)
3. 동명 자치구 별도 처리 — 메타에 광역시도 시군구 같이 등록되어 있을 수도, 확인 필요

라이브 메타 확인 명령:
```bash
KEY=$(grep DEFAULT_KOSIS_KEY src/config/index.ts | grep -oE "'[A-Za-z0-9=+/]+='" | tr -d "'")
curl -s "https://kosis.kr/openapi/statisticsData.do?method=getMeta&apiKey=${KEY}&orgId=101&tblId=DT_1ES3A03_A01S&type=ITM&format=json&jsonVD=Y" | python3 -c "
import json,sys
d=json.load(sys.stdin)
A=[r for r in d if r.get('OBJ_ID')=='A']
for r in A[:50]: print(f\"  ITM={r['ITM_ID']:8} NM={r['ITM_NM']}\")"
```

### 🔴 P0-2 사망률/혼인율/이혼율 시군구 라우팅

KOSIS 인구동향:
- `DT_1B83A05` — 시군구별 사망 (조사망률, 사망자수)
- `DT_1B82A04` 또는 `DT_1B82A02` — 시군구별 혼인
- `DT_1B82B04` — 시군구별 이혼

검색 명령:
```bash
curl -s ".../statisticsSearch.do?...searchNm=시군구%20사망&resultCount=5"
curl -s ".../statisticsSearch.do?...searchNm=시군구%20혼인&resultCount=5"
curl -s ".../statisticsSearch.do?...searchNm=시군구%20이혼&resultCount=5"
```

ITM_ID 확인 후 DISTRICT_OPENAPI_ROUTES에 추가:
```ts
'사망률':    { orgId: '101', tblId: 'DT_1B83A05', itmId: '?', ... },
'사망자수':  { ... },
'혼인율':    { orgId: '101', tblId: 'DT_1B82A?', ... },
'이혼율':    { ... },
```

### 🟡 P1 광진구 통계연보 value 자동 추출 보강

[src/data/districtFileMap.ts](src/data/districtFileMap.ts:extractFromHtmlTable) 에 추가:
- `KEYWORD_TO_HEADER_PATTERN` 확장 — 취업자/고용률/실업률/주택수/의사수 헤더 정규식
- 광진구 Ⅳ.노동/사업체 시트(fileSn=3) 표 구조 분석 후 컬럼 매칭 보강
- Ⅸ.보건 (fileSn=9) 의사수 컬럼 — 한글 헤더 "의사" / "한의사" 구분

검증:
- `광진구 취업자` → 통계연보에서 정확한 취업자 수치
- `광진구 의사수` → 의료기관 종사 의사수

### 🟡 P1 search_statistics 동적 라우팅 (fallback)

매핑(DISTRICT_OPENAPI_ROUTES) + .xlsx 통계연보 모두 실패 시 마지막 시도:
1. `search_statistics(`${districtName} ${keyword}`)` 호출
2. 첫 결과 중 시군구 단위 테이블 선택 (`TBL_NM`에 "시군구" 포함 또는 메타 자치구 행 있음)
3. 메타로 자치구 ITM_ID lookup → getStatisticsData

위치: [src/tools/quickStats.ts](src/tools/quickStats.ts) 자치구 분기 2.7 추가.

장점: 광범위 cover. 단점: 정확도 보장 X. 응답에 `note: '동적 검색 결과 (정확도 검증 미완)'` 명시.

### 🟢 P2 미세먼지·범죄·교통사고 자치구

각 키워드별 KOSIS 자치구 단위 테이블 검색 + 매핑 추가. 우선순위 낮음 (P0-1/P0-2 완료 후).

---

## 4. 검증 케이스 (시뮬 확장)

`scripts/simulate-district-routing.mjs` 추가 케이스 (70+ 케이스):

### A. 고용 (전국 자치구)
- `광진구 고용률` `강남구 고용률` `해운대구 고용률` `수원시 고용률` `청주시 고용률` `포항시 고용률`
- `마포구 실업률` `강남구 실업률` `해운대구 실업률`
- `강남구 취업자수` `수원시 취업자`

### B. 사망/혼인/이혼
- `광진구 사망률` `강남구 조사망률` `해운대구 사망자수`
- `강남구 혼인율` `수원시 이혼율`

### C. 동적 라우팅 검증
- `광진구 사업체수` (매핑 없음, search 동적 시도)
- `강남구 학생수`

### D. value 추출 보강
- `광진구 취업자` value 정확 추출
- `광진구 의사수` value 정확 추출

---

## 5. 워크플로우

```
KOSIS 메타 분석 (DT_1ES3A03_A01S 자치구 코드 패턴)
→ P0-1: 고용 라우팅 + getDistrictKscdCodeFor 보강 → 시뮬 통과
→ P0-2: 사망/혼인/이혼 라우팅 추가 → 시뮬 통과
→ P1: search_statistics 동적 라우팅 추가 (선택) → 시뮬 통과
→ P1: HTML value 추출 보강 → 시뮬 통과
→ npx tsc → fly deploy --remote-only → 라이브 검증
→ npm version 1.6.0 + publish → main 커밋·푸시
```

---

## 6. 파일 위치

| 영역 | 파일 |
|---|---|
| 자치구 라우팅 매핑 | `src/data/districtFileMap.ts:DISTRICT_OPENAPI_ROUTES` |
| 자치구 코드 lookup | `src/utils/districtKosisCodes.ts:getDistrictKscdCodeFor` (objId 후보 순회 일반화 완료) |
| quickStats 분기 | `src/tools/quickStats.ts` 2.5/2.6 (자치구 통계연보 → OpenAPI 라우팅 fallback) |
| HTML 추출 | `src/data/districtFileMap.ts:extractFromHtmlTable` (colspan/rowspan grid 평탄화 완료) |
| 시뮬레이션 | `scripts/simulate-district-routing.mjs` |

---

## 7. cheat sheet

### KOSIS getMeta probe (자치구 ITM_ID 코드 패턴 확인)
```bash
KEY=$(grep DEFAULT_KOSIS_KEY src/config/index.ts | grep -oE "'[A-Za-z0-9=+/]+='" | tr -d "'")
inspect() {
  curl -s "https://kosis.kr/openapi/statisticsData.do?method=getMeta&apiKey=${KEY}&orgId=$1&tblId=$2&type=ITM&format=json&jsonVD=Y" | python3 -c "
import json,sys
d=json.load(sys.stdin)
objs={}
for r in d:
  o=r.get('OBJ_ID','?'); objs.setdefault(o,[]).append(r)
print('OBJ types:', list(objs.keys()))
for o,rows in objs.items():
  if o=='ITEM': continue
  print(f'[{o}] {len(rows)} rows')
  sample=[r for r in rows if r.get('ITM_NM') in ('광진구','강남구','해운대구','수원시','마포구','서울특별시','부산광역시','경기도')]
  for r in sample[:6]: print(f\"  {r['ITM_NM']:10} ITM_ID={r['ITM_ID']:15} UP={r.get('UP_ITM_ID','-')}\")"
}
inspect 101 DT_1ES3A03_A01S    # 시군구/연령별 취업자 및 고용률
inspect 101 DT_1B83A05         # 시군구별 사망 (확인 필요)
inspect 101 DT_1B82A04         # 시군구별 혼인 (확인 필요)
```

### 자치구 OpenAPI 정밀 조회 라이브 probe
```bash
URL="https://korean-stats-mcp.fly.dev/mcp"
node -e "
fetch('${URL}', {
  method:'POST',
  headers:{'Content-Type':'application/json','Accept':'application/json, text/event-stream'},
  body: JSON.stringify({jsonrpc:'2.0',method:'tools/call',id:1,params:{name:'quick_stats',arguments:{query:'광진구 고용률'}}})
}).then(r=>r.text()).then(t=>console.log(t.slice(0,500)))"
```

### 시뮬레이션 실행
```bash
npx tsc && node scripts/simulate-district-routing.mjs
```

---

## 8. 주의

- **외과적 수정**. v1.5.0 7분야 동작 중. 그쪽 회귀 방지.
- 메모리: [feedback-git-author-fix-no-force-push.md](~/.claude/projects/-Users-mong-e/memory/feedback-git-author-fix-no-force-push.md) — author 차단 시 amend 금지, 새 커밋으로.
- DT_1ES3A03_A01S의 자치구 코드 4자리 + objL2=YRE 필수 — 동명 자치구 disambiguate 어려움. 우선 동명 자치구는 시뮬 제외 또는 별도 처리.

---

## 9. 시작 멘트 예시

```
korean-stats-mcp v1.6.0 자치구 고용·인구동태 라우팅 확장 시작.

먼저 P0-1 — DT_1ES3A03_A01S (시군구/연령별 취업자 및 고용률) 메타 분석.
자치구 ITM_ID 4자리 패턴 + objL2=YRE 연령 코드 매핑 확인.
getDistrictKscdCodeFor에 광역시도 UP_ITM_ID 비어있을 때 fallback 처리 추가.

이어서 P0-2 — 시군구별 사망/혼인/이혼 테이블 검색 + 라우팅 매핑 추가.
P1 search_statistics 동적 라우팅 + HTML value 추출 보강.

시뮬 70+ 케이스 95%+ 통과 후 Fly 재배포 + npm v1.6.0.
```
