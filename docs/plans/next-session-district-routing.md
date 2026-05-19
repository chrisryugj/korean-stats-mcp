# 다음 세션: 자치구 정밀 조회 일소 — fetch_kosis_excel retry + quick_stats 자동 fallback

> 새 세션 첫 메시지에 통째 붙여넣거나 `cat docs/plans/next-session-district-routing.md`로 흡수 후 시작.

---

## 1. 컨텍스트 — 직전 세션(v1.4.1) 결과 + 남은 통증

### 직전 세션이 끝낸 것
- v1.4.0: 자연어 약어/오타 정규화 + 체인 강화 + 통폐합(13→12) + isProjection
- v1.4.1: README 표현 정정
- npm 게시 `korean-stats-mcp@1.4.1`, Fly `korean-stats-mcp.fly.dev` 배포 완료

### 직전 세션 실증으로 드러난 미해결 통증 (광진구 인구 조회 사례)

**시나리오**: 사용자 `"광진구 인구 얼마야"`

**현재 동작**:
1. `quick_stats("광진구 인구")` → 서울 9,299,548명 + 💡 자치구 안내 노트
   - 광진구 단위 데이터 안 나옴. 사용자가 다음 도구 호출하길 LLM에 위임
2. `fetch_kosis_excel(districtName:'광진구', fileSn:2)` 호출 시 **첫 시도 fetch failed** (timeout/네트워크).
   - 두 번째 호출은 정상 — `orgId:505 / DT_505001_FILE2024 / Ⅲ.인구` 파싱 성공
3. 결과: 광진구 통계연보 2024 등록인구 **348,652명** (세대 169,931 / 65세 이상 56,819 / 외국인 포함 / 인구밀도 20,584명/km²)
4. LLM이 fetch_kosis_excel 실패 보고 우회 경로(search → table_info → 코드 추측 → get_statistics_data 4단계) 갔다가 시도통계 자치구별 테이블에서 다른 값(331,167) 가져옴 — 비효율 + 값 불일치

**근본 원인 두 가지**:

| 원인 | 위치 | 영향 |
|---|---|---|
| ① `fetch_kosis_excel` retry/timeout 미설정 | [src/tools/fetchKosisExcel.ts:119,201,248](src/tools/fetchKosisExcel.ts) — 3개 fetch 모두 단발성 | KOSIS stat.kosis.kr 첫 호출 콜드 시 fail. 사용자 한 번에 못 뽑음 |
| ② `quick_stats` 자치구 region 시 자동 후속 액션 없음 | [src/tools/quickStats.ts](src/tools/quickStats.ts) `requestedRegion` 처리부 | 자치구 입력 → 광역 fallback + 안내만. LLM이 두 번째 도구 호출해야 함 |

부수: KOSIS OpenAPI client timeout 8s ([src/api/client.ts:61](src/api/client.ts)) 도 Fly Singapore→Korea cold path에서 일시 abort 유발.

---

## 2. 이번 세션 목표

**자치구 자연어 질의 한 번에 끝나도록** 마무리. 사용자가 `"광진구 인구"` 입력 시 `quick_stats` 한 호출만으로 자치구 통계연보 정밀값(348,652) + 세대·고령·밀도 부가 데이터가 함께 응답에 포함되어야 함.

종료 조건:
- `quick_stats("광진구 인구")` 한 호출에 광역시도 fallback 결과 + 자치구 통계연보 결과 두 블록 동시 반환
- `fetch_kosis_excel`이 콜드 호출 시 자동 재시도해서 첫 호출도 성공
- 자치구 인구·노동·주거·보건 5개 분야 정밀 조회가 자연어 한 줄로 동작
- 시뮬레이션 통과 + Fly 재배포 + npm v1.5.0 게시

---

## 3. 작업 항목 (우선순위)

### 🔴 P0-1 `fetch_kosis_excel` retry + timeout 강화

[src/tools/fetchKosisExcel.ts](src/tools/fetchKosisExcel.ts)의 3개 fetch 위치 (119, 201, 248)에 공통 wrapper 적용:

```ts
async function fetchWithRetry(url: string, init: RequestInit, attempts = 3): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(15000),
      });
    } catch (e) {
      lastErr = e;
      if (i < attempts - 1) await new Promise(r => setTimeout(r, 800 * (i + 1)));
    }
  }
  throw lastErr;
}
```

- timeout 15초 (Fly Singapore → KOSIS Korea cold path 여유)
- 지수 백오프 800ms / 1600ms (총 3회 = ~2.4초 추가 대기 상한)
- KOSIS 호출 단발성 한국 사이트라 retry 안전

### 🔴 P0-2 `quick_stats` 자치구 region 시 `fetch_kosis_excel` 자동 결합

지금 자치구 region 처리부에서 광역시도로 변환 + districtNote만 부착. 추가로:

1. 자치구로 식별됐고 키워드가 자치구 통계연보 매핑에 있으면 `fetchKosisExcel({districtName, fileSn, year})` **병렬 호출**
2. 두 결과를 응답에 함께 노출:
   - `answer`: 광역 fallback 자연어 문장 (기존 그대로)
   - `district`: { districtName, value, source, period, extras } 추가 필드
   - `note`: 자치구 안내 + 자치구 통계연보 출처 통합

매핑 신규 — `src/data/districtFileMap.ts` (또는 `quickStatsParams.ts` 확장):

```ts
// 자치구 통계연보 키워드 → file_sn (서울 25개 자치구 공통 패턴: DT_<orgId>_FILE<year>)
const DISTRICT_KEYWORD_TO_FILESN: Record<string, number> = {
  '인구': 2,        // Ⅲ. 인구
  '고령인구': 2,
  '세대': 2,
  '출산율': 2,      // Ⅲ. 인구 안에 인구동태 포함
  '취업': 3,        // Ⅳ. 노동 및 사업체
  '실업률': 3,
  '고용률': 3,
  '주택': 7,        // Ⅷ. 주택·건설
  '아파트가격': 7,
  '전세가격': 7,
  '의사수': 9,      // Ⅸ. 보건
  '보건': 9,
};
```

**주의**: 자치구 → orgId 매핑은 이미 `fetchKosisExcel.ts:resolveDistrictFileTable`에 있음. 그 함수 재사용.

### 🟡 P1 KOSIS OpenAPI client timeout + retry

[src/api/client.ts:61](src/api/client.ts) `timeout = 8000` → `15000` + fetch에 1회 재시도. 광범위 영향이라 별도 PR 분리 권장 (혹시 회귀 발생 시 부분 롤백 쉽게).

### 🟢 P2 자치구 통계연보 fileSn 매핑 확장

현재 광진구 케이스로 검증된 14개 파일 매핑(Ⅱ~XV). 다른 자치구도 동일 카테고리 구조인지 샘플 검증:
- 강남구(orgId 547) Ⅲ.인구 = fileSn 2 ?
- 부산 해운대구 Ⅲ.인구 = fileSn 2 ?

다르면 자치구별 매핑 분기 필요.

---

## 4. 검증 케이스 (시뮬레이션 추가)

`scripts/simulate-district-routing.mjs` 신규 작성. 다음 30 케이스 통과:

### A. 광진구·강남구·해운대구 자연어 직접
1. `"광진구 인구"` → 자치구 정밀값 + 서울 광역 동시 반환
2. `"광진구 65세 이상"` → 56,819 (Ⅲ.인구 내 고령자)
3. `"강남구 인구"` → 자치구 통계연보 정밀값
4. `"해운대구 인구"` → 부산 해운대구 통계연보
5. `"성남시 인구"` → 경기 성남시 정밀값

### B. 자치구 + 분야별
6. `"광진구 취업자"` → Ⅳ.노동 fileSn=3
7. `"광진구 주택"` → Ⅷ.주택·건설 fileSn=7
8. `"강남구 보건"` → Ⅸ.보건 fileSn=9

### C. 콜드 호출 retry 검증
9. 첫 호출 시 일부러 stat.kosis.kr 응답 지연 시뮬레이션 (HTTP mock) → retry 후 성공
10. 3회 모두 실패 시 깔끔한 에러 + 광역 fallback만 반환

### D. 회귀 (기존 기능 유지)
11~20. 광역시도 단독 조회 (서울 인구, 부산 GRDP 등) — 변경 없음 확인
21~30. 자치구 매핑 없는 키워드(예: `"광진구 미세먼지"`) — 기존처럼 광역 fallback만

---

## 5. 워크플로우

```
재현 (광진구 인구 콜드 호출 fail 재현)
→ P0-1 fix (fetchWithRetry wrapper, 15s timeout) → 시뮬 통과
→ P0-2 fix (quick_stats 자동 결합 + DISTRICT_KEYWORD_TO_FILESN) → 시뮬 통과
→ P1 fix (api/client.ts timeout) → 기존 시뮬 전체 통과 확인
→ P2 (자치구 매핑 검증, 필요 시 분기) → 추가 시뮬 통과
→ tsc → npx tsc
→ fly deploy --remote-only → 라이브 콜드 호출 재검증
→ npm version 1.5.0, npm publish → main 커밋 + push
```

CLAUDE.md 글로벌 원칙: **외과적 수정, 인접 코드 X, 동일 접근 3회 실패 시 STOP**.

---

## 6. 파일 위치 참조

| 영역 | 파일 |
|---|---|
| fetch_kosis_excel 본체 | `src/tools/fetchKosisExcel.ts` (3개 fetch + resolveDistrictFileTable) |
| quick_stats 자치구 분기 | `src/tools/quickStats.ts:209-249` (자치구 detection + fallback) |
| KOSIS OpenAPI client | `src/api/client.ts:60-110` (timeout, retry 없음) |
| 자치구 → 광역시도 매핑 | `src/utils/regions.ts:DISTRICT_TO_PROVINCE` (200+) |
| 키워드 사전 | `src/data/quickStatsParams.ts` (91 + 100+ alias, KEYWORD_LOOKUP) |
| 시뮬레이션 | `scripts/simulate-edge-cases.mjs`, `scripts/simulate-chains.mjs` (신규: `simulate-district-routing.mjs`) |
| 다음 작업 plan | 본 문서 |

---

## 7. cheat sheet

### 광진구 콜드 호출 재현
```bash
# 라이브
cat > /tmp/probe.mjs <<'EOF'
const r = await fetch('https://korean-stats-mcp.fly.dev/mcp', {
  method:'POST',
  headers:{'Content-Type':'application/json','Accept':'application/json, text/event-stream'},
  body: JSON.stringify({jsonrpc:'2.0',method:'tools/call',id:1,params:{name:'fetch_kosis_excel',arguments:{districtName:'광진구', fileSn:2, year:2024}}})
});
console.log((await r.json()).result.content[0].text.slice(0, 500));
EOF
node /tmp/probe.mjs
```

### 광진구 통계연보 알려진 메타
- orgId: `505`
- 최신 tblId: `DT_505001_FILE2024` (2026-05-19 시점)
- **2025·2026년본은 KOSIS 미등록** — 자치구청 발행 일정상 매년 말~다음 해 초에 갱신. 라이브 확인 결과 `DT_505001_FILE2025`, `DT_505001_FILE2026` 모두 404
- year 미지정 시 `resolveDistrictFileTable`이 자동으로 최신 가용 연도(2024) 선택
- 파일 14개: Ⅱ.토지/기후(1), Ⅲ.인구(2), Ⅳ.노동/사업체(3), Ⅴ.농림/제조(4), Ⅵ.가스/상하수도(5), Ⅶ.유통/금융/무역수지(6), Ⅷ.주택/건설(7), Ⅸ.교통/관광(8), Ⅹ.보건(9), XI.사회보장(10), XII.환경(11), XIII.교육/문화(12), XIV.재정(13), XV.공공행정/사법(14)

### 광진구 인구 검증 기준값 (두 출처 차이 인지 필수)

| 출처 | tblId | 연도 | 값 | 정의 |
|---|---|---|---|---|
| 광진구 통계연보 (자치구청) | `DT_505001_FILE2024` Ⅲ.인구 | **2024** | **348,652명** | 한국인+외국인 합계 |
| 서울 시도통계 (서울특별시) | `DT_201004_O020004` | **2025** | **331,167명** | **내국인만** (테이블명 "내국인 각 세별/구별") |

부가(2024 통계연보): 세대 169,931 / 65세 이상 56,819 / 인구밀도 20,584명/km² (면적 17.06㎢) / 한국인 331,xxx (남 166,045 / 여 182,607)

**P0-2 자동 결합 응답 설계 시 주의**: 두 출처 값이 다르므로 quick_stats 응답에 둘 다 노출하려면 출처·정의·연도 명시 필수. 안 그러면 LLM이 둘 중 임의로 인용하여 사용자 혼란.

### Fly 재배포
```bash
cd ~/workspace/korean-stats-mcp
npx tsc
export FLY_ACCESS_TOKEN=$(grep "access_token:" ~/.fly/config.yml | sed 's/access_token: //')
fly deploy --remote-only
```

### npm v1.5.0 게시
```bash
# package.json version 1.4.1 → 1.5.0 수동 bump
npm run build
npm publish --access public
```

---

## 8. 주의/제약

- **외과적 수정**. quickStats.ts 자치구 분기에 fetch_kosis_excel 호출 추가는 isolated. 광역 fallback 동작은 그대로.
- **fetch_kosis_excel retry는 안전**. KOSIS는 멱등 GET. 재시도 부작용 없음.
- **OpenAPI client timeout 변경(P1)은 영향 큼**. 별도 커밋 분리.
- **자치구 매핑 검증(P2)이 안 끝나면 P2는 다음 다음 세션으로 미룸**. P0만 끝나도 광진구 케이스는 해결.
- 모호한 결정 사항: 자치구 정밀값과 광역 fallback 값을 **둘 다 반환할지** vs **자치구 정밀값을 primary로 두고 광역은 비교용 옵션**으로 둘지. 사용자 확인 후 결정.

---

## 9. 시작 멘트 예시

```
korean-stats-mcp v1.5.0 자치구 정밀 조회 일소 시작.

먼저 P0-1 — fetch_kosis_excel 3개 fetch 호출에 timeout(15s) + 지수 백오프 retry
wrapper 적용. 광진구 fileSn=2 콜드 호출이 첫 시도부터 성공해야 함.
이어서 P0-2 — quick_stats 자치구 분기에서 fetch_kosis_excel 자동 호출 통합.
응답에 광역 fallback + 자치구 정밀값 두 블록 동시 반환.
```
