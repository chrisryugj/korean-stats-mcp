# 다음 세션: korean-stats-mcp v1.6.0 출시 전 프로덕션 리뷰 + 최종 성능 검증

> 새 세션 첫 메시지에 통째 붙여넣거나 `cat docs/plans/next-session-prod-review.md`로 흡수 후 시작.

---

## 1. 컨텍스트 — v1.6.0 현재 상태

| 항목 | 값 |
|---|---|
| 프로젝트 | `~/workspace/korean-stats-mcp` |
| GitHub | `chrisryugj/korean-stats-mcp` (main) |
| 라이브 | `https://korean-stats-mcp.fly.dev/mcp` (Fly sin region) — **현재 v1.5.0 배포본** |
| 로컬 상태 | v1.6.0 코드 완료, **로컬 커밋 3개 미푸시** |
| npm | 게시본 1.5.0 — v1.6.0 미게시 |
| MCP 도구 | 12개 (search/list/data/compare/analyze/tableInfo/quickStats/quickTrend/fetchKosisExcel/chain×3) |

### 미푸시 로컬 커밋 (이번 세션이 출시할 대상)
- `934ef1a` feat: v1.6.0 — 자치구 고용·인구동태 정밀 라우팅 확장 (14종 KOSIS 통계표)
- `69adb3a` fix: 행정구역 통합 자치구 코드 후보 순회 + 실전 질의 100 종합 시뮬
- `35e8e9c` fix: 전국 시군구 전수 라우팅 — 군포시 누락·광역시도명 변형·동명 시군

### v1.6.0에서 완료된 것 (반복 X)
- 자치구 정밀 라우팅 14종 통계표 — 인구·출산·고령·의사·아파트/전세·고용률·취업자·실업률·사망자수·사망률·혼인·이혼
- `getDistrictKscdCandidatesFor` — 통합 자치구(청주·창원) 코드 후보 순회, 광역시도명 정규화, 동명 시군(고성군) 코드 disambiguate
- `DistrictOpenApiRoute` — objL2 / districtObjLevel·extraObjL1 (objLevel swap) 옵션
- 시뮬 3종 **897 케이스 100%** — district-routing 108 + realworld-100 105 + nationwide 684

---

## 2. 이번 세션 목표 — 출시 전 최종 관문

**프로덕션 리뷰 + 성능 검증을 통과시킨 뒤 v1.6.0 출시**.

종료 조건:
- 프로덕션 리뷰 체크리스트 전 항목 통과 (또는 의식적 보류 결정 + 사유 기록)
- 성능 검증 항목 전부 측정 + 기준 충족
- 시뮬 3종 897 케이스 회귀 100% 유지
- Fly 재배포(v1.5.0 → v1.6.0) + 라이브 스모크 테스트 + npm v1.6.0 게시 + main 푸시
- ※ 배포·게시·푸시는 외부 영향 작업 — 직전 세션에서 사용자가 "로컬 커밋만" 선택했으므로 **이번에도 진행 전 사용자 확인 필수**

---

## 3. 프로덕션 리뷰 체크리스트

### 🔴 P0 — 출시 차단 가능 항목
1. **빌드·타입 클린** — `rm -rf dist && npx tsc` 무경고. (ESLint는 설정 파일 없음 — 기존 상태, 무시)
2. **회귀 100%** — 시뮬 3종 전부 재실행:
   ```bash
   node scripts/simulate-district-routing.mjs   # 108/108
   node scripts/simulate-realworld-100.mjs      # 105/105 + 키워드 91/91 + 시도 17/17
   node scripts/simulate-nationwide.mjs         # 684/684 자치구 정밀 100%
   ```
3. **버전 정합성** — `package.json`(1.6.0) · `server.ts` 내 version · `/health` 응답 · `fly.toml` 모두 일치. 도구 수 12개 일치.
4. **보안 — API 키 노출 평가** — `src/config/index.ts:4` `DEFAULT_KOSIS_KEY` 하드코딩 (GitHub public 노출 상태). KOSIS 키는 무료 발급이나 노출 시 일 쿼터 소진 위험. 판단: (a) `.env` 전용으로 옮기고 fallback 제거, (b) 의도적 데모용 fallback으로 유지 + 문서화 — **사용자와 결정**.
5. **에러 핸들링 일관성** — KOSIS API 다운/타임아웃 시 quickStats가 부분 degrade(자치구→광역→전국)로 끝나는지, 전체 throw 없는지. chain 도구는 부분 실패를 successCount로 노출하는지.
6. **로그 보안** — `fly logs`에 KOSIS API 키가 URL 쿼리로 노출되지 않는지 (`maskSensitiveUrl` 등 스크럽 확인).

### 🟡 P1 — 출시 후 후속 가능하나 점검 권장
7. **파일 크기** (CLAUDE.md 기준) — `quickStatsParams.ts` **1398줄 (>1200, 분리 권고)**, `quickStats.ts` 773줄(⚠️), `districtFileMap.ts` 609줄(⚠️). 분리 여부 판단 — 단 출시 직전 대규모 리팩터링은 회귀 리스크, 별도 작업 권장 가능.
8. **데드코드** — `getDistrictKscdCode`(DT_1B040A3 전용 wrapper)가 현재 미사용. 언급만 — 삭제는 신중히.
9. **README 정합성** — v1.6.0 변경 이력·키워드 수·14종 통계표 반영 확인 (직전 세션에서 갱신함).
10. **노령화지수 매핑 불일치** (직전 세션 발견, 범위 밖 보류) — 광역은 `DT_1YL12501E` 2052년 추계 / 자치구는 `DT_1YL20631` 고령인구비율. 명칭·기준 불일치. 출시 차단은 아님 — 별도 이슈로 기록할지 결정.

---

## 4. 최종 성능 검증

측정 항목 (라이브 또는 로컬 `node -e`):

1. **자치구 라우팅 응답시간** — cold path: `.xlsx` 통계연보 시도 → 실패 → OpenAPI 라우팅 fallback 체인. 자치구 인구/고용률/사망률 각 p50·p95 측정. 기준: 단건 < 2s.
2. **통합 자치구 후보 순회 비용** — 청주시·창원시는 구코드 결측 → 통합코드 재시도로 KOSIS 호출 2회. 정상 자치구(1회) 대비 지연 폭 측정.
3. **캐시 효율** — 동일 질의 2회차 응답시간 (메타 캐시 + 데이터 캐시 hit). cold 대비 단축률.
4. **chain 도구 부하** — `chain_region_brief`는 다지표 병렬 quickStats. 동시 호출 시 KOSIS rate-limit 직격 여부 + 응답 크기.
5. **KOSIS API 안정성** — `fetchKosisExcel` 3-fetch 및 OpenAPI client의 retry/timeout(15s, 지수 백오프 3회)이 실제 타임아웃 상황에서 동작하는지.
6. **Fly cold start** — 슬립 후 첫 응답 시간.

성능 시뮬 스크립트 신규 작성 고려: `scripts/benchmark.mjs` — 위 1~3을 자동 측정·리포트.

---

## 5. 출시 절차 (검증 통과 후, 사용자 확인 하에)

```
rm -rf dist && npx tsc
→ 시뮬 3종 재실행 (897/897 확인)
→ export FLY_ACCESS_TOKEN=$(grep "access_token:" ~/.fly/config.yml | sed 's/access_token: //')
→ fly deploy --remote-only
→ 라이브 스모크 테스트 (아래 cheat sheet)
→ npm publish   (npm 게시본 1.5.0 → 1.6.0)
→ git push origin main   (커밋 3개)
```

주의: git committer가 `Mongmini <mong-e@...local>`로 자동 설정됨 — 푸시 전 author 확인. Vercel 아닌 Fly라 author 차단 이슈는 없음.

---

## 6. cheat sheet

### 시뮬 3종
```bash
cd ~/workspace/korean-stats-mcp && rm -rf dist && npx tsc
node scripts/simulate-district-routing.mjs
node scripts/simulate-realworld-100.mjs
node scripts/simulate-nationwide.mjs
```

### 라이브 스모크 테스트 (배포 후)
```bash
node -e "
fetch('https://korean-stats-mcp.fly.dev/mcp', {
  method:'POST',
  headers:{'Content-Type':'application/json','Accept':'application/json, text/event-stream'},
  body: JSON.stringify({jsonrpc:'2.0',method:'tools/call',id:1,params:{name:'quick_stats',arguments:{query:'광진구 고용률'}}})
}).then(r=>r.text()).then(t=>console.log(t.slice(0,600)))"
```

### 로컬 quickStats 직접 호출
```bash
node -e "import('./dist/tools/quickStats.js').then(async({quickStats})=>{console.log(await quickStats({query:'수원시 사망률'}))})"
```

### Fly 로그·배포
```bash
export FLY_ACCESS_TOKEN=$(grep "access_token:" ~/.fly/config.yml | sed 's/access_token: //')
fly logs --app korean-stats-mcp --no-tail | tail -80
fly deploy --remote-only
```

---

## 7. 파일 위치

| 영역 | 파일 |
|---|---|
| 91 키워드 매핑 | `src/data/quickStatsParams.ts` (1398줄) |
| 자치구 라우팅 매핑 | `src/data/districtFileMap.ts` (`DISTRICT_OPENAPI_ROUTES`) |
| 자치구 코드 lookup | `src/utils/districtKosisCodes.ts` (`getDistrictKscdCandidatesFor`) |
| 광역시도·정규화 | `src/utils/regions.ts` (`normalizeProvinceName`, `DISTRICT_TO_PROVINCE`) |
| quickStats | `src/tools/quickStats.ts` (773줄 — 2.5 xlsx / 2.6 OpenAPI 라우팅 분기) |
| KOSIS 클라이언트 | `src/api/client.ts` (retry/timeout) |
| 설정·API 키 | `src/config/index.ts` |
| MCP 서버 | `src/server.ts` (12개 도구 등록) |
| 시뮬 | `scripts/simulate-{district-routing,realworld-100,nationwide}.mjs` |

---

## 8. 시작 멘트 예시

```
korean-stats-mcp v1.6.0 출시 전 프로덕션 리뷰 + 성능 검증 시작.

먼저 P0 — 클린 빌드 후 시뮬 3종(897 케이스) 회귀 확인.
이어서 버전 정합성 + DEFAULT_KOSIS_KEY 노출 평가 + 에러 핸들링 점검.
성능: 자치구 라우팅 응답시간 p50/p95, 통합 자치구 후보 순회 비용, 캐시 효율 측정.

전부 통과하면 출시 절차(Fly 배포 + npm + push)는 사용자 확인 후 진행.
```

---

## 9. 주의 (CLAUDE.md 글로벌)

- 외과적 수정 — 출시 직전이라 회귀 리스크 최소화. 변경된 줄이 요청에 직접 연결되는지 자가 점검.
- 큰 파일 분리는 출시 후 별도 작업 권장 (출시 직전 대규모 리팩터링 지양).
- 배포·게시·푸시는 외부 영향 — 사용자 확인 필수.
- 동일 접근 3회 실패 시 STOP → 원인 분석 → 재계획.
