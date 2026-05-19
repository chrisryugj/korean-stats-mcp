# 다음 세션: korean-stats-mcp 실전 테스트 + 엣지케이스 추가 발굴

> 이 파일을 새 세션 첫 메시지로 통째 붙여넣거나, 새 세션에서 `cat docs/plans/next-session-realworld-test.md` 후 컨텍스트로 흡수하고 실전 테스트 모드 시작.

---

## 1. 컨텍스트 (이전 세션 정리)

| 항목 | 값 |
|---|---|
| 프로젝트 디렉토리 | `~/workspace/korean-stats-mcp` |
| GitHub | `chrisryugj/korean-stats-mcp` (main, v1.2.0, MIT) |
| 원본 fork | `Dayoooun/korea-stats-mcp` (크레딧은 README에 명시) |
| 라이브 원격 MCP | `https://korean-stats-mcp.fly.dev/mcp` (Fly.io, sin region, 512MB, 10 tools) |
| 직전 커밋 | `64c669f feat: v1.2.0 — 엣지케이스 일소 + Fly.io + install.sh` |
| 자동설치 | `bash install.sh` (Mac/Linux), `iwr ... \| iex` (Windows) |
| KOSIS API 키 | 코드 fallback + Fly secret(`KOSIS_API_KEY`) 양쪽 |

### 이전 세션이 잡은 엣지케이스 (반복 안 해도 됨)
1. "해운대구"→"대구" 단어 경계 부분매칭 fix
2. 자치구 → 광역시도 자동 fallback + `fetch_kosis_excel` 안내
3. "인구"가 자치구 패턴(OO구$)에 오매칭되던 문제 (`NON_DISTRICT_WORDS`)
4. 대소문자 무시(gdp/pm2.5/pm10) + 영문 별칭 13개
5. 자연어 별칭(저출산→출산율, 고령화→고령인구) + 한글 별칭 5개
6. 미래연도/빈쿼리/지역만입력 친절 에러
7. Vercel→Fly 전환 (kordoc/sharp 250MB 한도 회피)
8. `api/mcp.ts` 도구 누락 정합성 ('이제는 src/server-http.ts 단일)

---

## 2. 이번 세션 목표

**실전 자연어 질의를 던지면서 10개 도구의 추가 버그·엣지케이스 발굴하고 즉시 수정.** 발견할 때마다 `scripts/simulate-edge-cases.mjs`에 케이스 추가해 자동화 회귀 망 강화.

종료 조건:
- 시드 50개 + 추가 발견 케이스 모두 통과(또는 의도된 미지원으로 명확 안내)
- `simulate-edge-cases.mjs` 케이스 80개 이상
- 발견 버그 수정 후 main 푸시 + Fly 재배포 + 라이브 검증

---

## 3. 우선순위 점검 영역 (잠재 이슈, 미검증)

### 🔴 P0 — 거의 확실히 버그
- **quick_trend는 자치구 단어 경계 매칭 없음** — `src/tools/quickTrend.ts:75`의 `REGION_NAMES` 변수만 선언, 실제로는 안 씀. `input.region`이 자치구면 fallback하지만, `input.keyword`에 자치구가 들어왔을 때 처리 미검증
- **DISTRICT_TO_PROVINCE 누락 자치구 다수** — `src/utils/regions.ts:46`. 동/서/중/남/북구가 광주/대구/인천/대전/울산 등에 광범위 미등록. "동구 인구" 같은 모호 케이스 라우팅 자연성 검증
- **경기도 시군 미매핑** — 성남시/수원시/용인시/부천시/안양시 등 경기도 시 단위 미등록. 광역시도 fallback도 안 됨 → 사용자에게 명확 안내?

### 🟡 P1 — 가능성 있음
- **search_statistics Path A/B/C** 라이브 검증 부족 (ec7667a 커밋에서 추가된 자치구 → 광역시도 OpenAPI 자동 라우팅)
- **fetch_kosis_excel 라이브 동작** — sin region에서 onnxruntime/sharp 워밍업 시간, 512MB 메모리에서 .xlsx 처리 성능
- **get_table_info** 경량 응답이 실제 LLM 컨텍스트에서 충분한지

### 🟢 P2 — 커버리지
- `compare_statistics` / `analyze_time_series` / `get_statistics_data` / `get_statistics_list` / `get_recommended_statistics` — 각 도구별 자연어 패턴 부족
- 시뮬레이션 자동 평가 케이스가 quick_stats 위주 → 다른 도구도 자동화

---

## 4. 워크플로우

```
실전 질의 → 실패/이상 발견 → 시뮬레이션 케이스 추가 → 로컬 재현 → 외과적 수정
→ 로컬 시뮬레이션 통과 → tsc → fly deploy --remote-only → 라이브 검증 (node fetch)
→ main 커밋
```

CLAUDE.md 원칙 준수: **추측 금지, 외과적 수정, 인접 코드 건드리지 마라, 동일 접근 3회 실패 시 STOP.**

---

## 5. cheat sheet

### 로컬 시뮬레이션
```bash
cd ~/workspace/korean-stats-mcp
npx tsc && node scripts/simulate-edge-cases.mjs 2>&1 | grep -E "^(✅|⚠️|❌)"
```

### 라이브 호출 (⚠️ curl + bash tool은 응답 가공됨 → node fetch 필수)
```bash
node -e "
fetch('https://korean-stats-mcp.fly.dev/mcp', {
  method:'POST',
  headers:{'Content-Type':'application/json','Accept':'application/json, text/event-stream'},
  body: JSON.stringify({jsonrpc:'2.0',method:'tools/call',id:1,params:{name:'quick_stats',arguments:{query:'<쿼리>'}}})
}).then(r=>r.text()).then(t=>{const j=JSON.parse(t);console.log(j.result.content[0].text)});
"
```

### Fly 로그
```bash
export FLY_ACCESS_TOKEN=$(grep "access_token:" ~/.fly/config.yml | sed 's/access_token: //')
fly logs --app korean-stats-mcp --no-tail | tail -50
```

### Fly 재배포
```bash
cd ~/workspace/korean-stats-mcp
npx tsc
export FLY_ACCESS_TOKEN=$(grep "access_token:" ~/.fly/config.yml | sed 's/access_token: //')
fly deploy --remote-only
```

---

## 6. 실전 자연어 시드 (50개)

### A. 자치구 라우팅 — quick_stats
1. `노원구 인구` — 매핑됨(서울), 안내 부착되어야
2. `구로구 출산율` — 출산율은 시도별만, 서울 fallback + 안내
3. `기장군 교통사고` — 군 단위(부산)
4. `성남시 인구` — DISTRICT_TO_PROVINCE 미등록 시, 어떻게 처리?
5. `광주광역시 광산구 인구` — 풀네임 광역시도 + 자치구 동시
6. `용인시 GRDP` — 미매핑 시
7. `남구` 단독 — 모호
8. `수원시 영통구` — 시 + 구 (둘 다 모호/미매핑)
9. `동구 인구` — 5개 광역시에 동명, 모호 처리 자연성
10. `중구 인구` — 동일

### B. 시계열 — quick_trend
11. `최근 5년 GDP 추이` (yearCount=5)
12. `광진구 인구 추이` — **자치구 quick_trend 처리 검증 (P0)**
13. `해운대구 출산율 변화` — keyword에 자치구 + 통계 동시
14. `서울 아파트가격 20년 추이`
15. `출산율 떨어진 추세 보여줘` — 자연어 표현
16. `population 10year trend` — 영문 (별칭 + 시계열 결합)

### C. 모호/다중 키워드
17. `결혼이랑 이혼율 차이` — 두 통계
18. `서울이랑 부산 인구 비교` — compare_statistics 트리거 검증
19. `남자 출생아수` — 성별 필터, KOSIS DT_1B040A3는 성별 분류 있음. 미지원 안내?
20. `20대 실업률` — 연령대 필터, 미지원
21. `수도권 인구` — 광역 묶음(서울+경기+인천), 미지원 안내
22. `북한 인구` — 데이터 없음, 안내

### D. 시간 극단
23. `1900년 인구` — KOSIS 시작 연도 이전
24. `1948년 GDP` — 정부 수립 직전
25. `2030년 GDP` — 미래(이전 세션에서 fix됨, 라이브 재확인)
26. `이번 주 출생아수` — 주 단위 미지원

### E. 별칭/오타
27. `저출산이 얼마나 심각해?` — 별칭
28. `고령화 문제 데이터` — 별칭
29. `실업율 알려줘` — 오타 (률→율)
30. `인구가 몇명이지` — 가벼운 자연어
31. `결혼 안 하는 사람들` — 추상적 (혼인율 매핑?)

### F. 영문
32. `Korea population 2024`
33. `korean fertility rate trend` — 영문 + 시계열
34. `GDP growth rate Korea`

### G. search_statistics
35. `장애인 통계` — 키워드 검색
36. `다문화가구 통계`
37. `에너지 소비량`
38. `자살률` (quick_stats 미지원, search로)

### H. fetch_kosis_excel (자치구 .xlsx)
39. `광진구 기본통계 엑셀로 받아줘` — Path A 검증
40. `강남구 통계 다운로드` — 다른 자치구
41. `수성구 산업현황` — 비-서울 자치구 (Path C)
42. `해운대구 시군구 통계` — 부산 자치구

### I. get_recommended_statistics
43. `인구 관련 통계 추천해줘`
44. `경제 데이터 어떤거 있어?`

### J. compare_statistics
45. `2020년이랑 2024년 인구 비교`
46. `남녀 임금 차이`

### K. analyze_time_series
47. `출산율 시계열 분석` — quick_trend와 어떤 차이?

### L. 시스템 한계
48. 빈 body POST
49. 매우 긴 query (1000자+)
50. Unicode/이모지 섞인 query `🇰🇷 인구`

---

## 7. 파일 위치 참조

| 영역 | 파일 |
|---|---|
| 91 키워드 매핑 | `src/data/quickStatsParams.ts` (`QUICK_STATS_PARAMS`) |
| 별칭 18개 | `src/data/quickStatsParams.ts` (`KEYWORD_ALIASES`) |
| 광역시도 17 | `src/utils/regions.ts` (`PROVINCES`) |
| 자치구 매핑 | `src/utils/regions.ts` (`DISTRICT_TO_PROVINCE`, 광범위하게 누락) |
| quick_stats | `src/tools/quickStats.ts` (자치구 라우팅 + 가드 완료) |
| quick_trend | `src/tools/quickTrend.ts` (⚠️ 자치구 input 키워드 처리 미흡) |
| search_statistics | `src/tools/searchStatistics.ts` (Path A/B/C, ec7667a) |
| fetch_kosis_excel | `src/tools/fetchKosisExcel.ts` (dynamic kordoc) |
| get_table_info | `src/tools/getTableInfo.ts` (경량) |
| HTTP 서버 | `src/server-http.ts` (express stateless, rate limit) |
| KOSIS 클라이언트 | `src/api/client.ts` (network error 패턴 확인) |
| 시뮬레이션 | `scripts/simulate-edge-cases.mjs` |

---

## 8. 실제 시작 멘트 예시 (새 세션 첫 응답)

```
korean-stats-mcp v1.2.0 실전 테스트 시작.

먼저 우선순위 P0부터 — quick_trend가 자치구 input 처리 안 되는 거 확인.
node fetch로 라이브에 "광진구 인구 추이" 던져보고 결과 확인 후 패치 진행.
```

— 즉, 가장 의심되는 P0 한 건부터 라이브 호출로 재현 → 코드 보강 → 시뮬레이션 + 재배포 → 다음 P0/P1 순회.

---

## 9. 주의/제약 (CLAUDE.md 글로벌 원칙 재확인)

- 외과적 수정. 변경된 줄이 요청에 직접 연결되는지 자가 점검
- 1회성 코드에 Factory/Builder 등 디자인 패턴 금지
- 발생 불가능한 시나리오 에러 핸들링 금지
- 동일 접근 3회 실패 시 STOP → 원인 분석 → 재계획
- 모호한 요구사항은 임의 결정 금지, 사용자 확인
- 명확한 버그(failing test, 에러 로그)는 질문 없이 수정 후 보고
- git 작업은 사용자 명시 요청 시에만 (commit/push)
- chris-v3 output style: 한국어 반말/구어체, 간결
