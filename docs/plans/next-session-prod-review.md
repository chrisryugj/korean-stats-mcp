# 다음 세션: korean-stats-mcp v1.3.0 프로덕션급 리뷰 + 공무원 현업 실전 테스트

> 새 세션 첫 메시지에 통째 붙여넣거나 `cat docs/plans/next-session-prod-review.md`로 흡수 후 시작.

---

## 1. 컨텍스트 (이전 세션 정리)

| 항목 | 값 |
|---|---|
| 프로젝트 | `~/workspace/korean-stats-mcp` |
| GitHub | `chrisryugj/korean-stats-mcp` (main, v1.3.0) |
| 라이브 | `https://korean-stats-mcp.fly.dev/mcp` (sin region, 512MB, **13 tools**) |
| 직전 커밋 | v1.3.0 feat: P0 자치구 라우팅 일소 + 체인 도구 3종 + korean-law-mcp 패턴 적용 |

### 이전 세션이 해결한 것 (반복 X)
1. **P0-1**: `quick_trend` keyword 자연어 처리 (extractKeyword/District/Province 헬퍼 공유)
2. **P0-2/3**: `DISTRICT_TO_PROVINCE` 33 → 200+ (경기·강원·충북·충남·전북·전남·경북·경남 전체 시군 + 부산 영도·동래·인천 남동)
3. **disambiguate**: `AMBIGUOUS_DISTRICTS` + 광역시도 컨텍스트 → "광주 동구" / "부산 강서구" 정확 매칭
4. **광역시 약칭 가드**: `extractDistrictName`에서 "대구" 등 광역시 약칭이 자치구로 오인되는 버그 fix
5. **벤치마킹**: 모든 도구 description에 `[태그]` + cross-reference (korean-law-mcp 패턴)
6. **체인 도구 3종** (`src/tools/chains.ts`):
   - `chain_region_brief` — 13지표 종합 브리핑
   - `chain_compare_regions` — N×M 매트릭스 + 순위
   - `chain_policy_indicator` — 7개 정책 영역(저출산/고령화/주거/일자리/치안/보건/경제) 10년 시계열
7. **시뮬레이션**: 90(quick) + 18(chain) = **108 케이스** 통과

---

## 2. 이번 세션 목표

**프로덕션 운영 관점 + 공무원 현업 시나리오**로 추가 엣지 발굴 + 보강. 단순 자연어 통과를 넘어서 **실제 공무원이 답변·보고·정책수립에 쓰는 시나리오** 전체 흐름이 매끄럽게 끝나는지 검증.

종료 조건:
- 공무원 시나리오 30+개 자연스럽게 통과 (또는 명확한 한계 안내)
- 프로덕션 체크리스트 7개 모두 통과
- 발견된 이슈 수정 후 main 푸시 + Fly 재배포 + 라이브 재검증
- `scripts/simulate-realworld.mjs` (신규) — 시나리오 자동화

---

## 3. 우선순위 점검 영역

### 🔴 P0 — 프로덕션 운영 리스크 (확실히 검증 필요)
1. **`chain_*` 동시 호출 부하** — `chain_region_brief`는 13회 quickStats 병렬. 동시에 N요청이 오면 KOSIS API rate-limit 직격? 캐시·재시도 동작 확인. Fly 로그 모니터링.
2. **응답 크기 폭주** — `chain_compare_regions({ regions: 17, keywords: 8 })` = 136 cells. dataPoints까지 포함되면 50KB+ 가능. truncate 필요?
3. **부분 실패 메시지 일관성** — chain에서 일부 지표만 실패할 때 LLM이 "성공/실패" 구분 가능한가? 현재 `successCount` 노출 OK, 개별 cell도 success 필드 OK. 다만 brief의 `summary`가 성공한 것만 나열 — 실패한 항목은 어떻게 LLM이 인지하나?
4. **자치구 fallback 노트 누락** — chain_region_brief에서 자치구 region을 받으면, 첫 indicator 호출의 note가 fallbackNote에 들어감. 나머지 12개 indicator note는 버려짐. 일관 안내가 필요.
5. **chain_policy_indicator의 미래연도 데이터 혼입** — 노령화지수(`DT_1YL12501E`)는 2000~2052 추계 포함. 최신 10개 = 2043~2052 (미래). 실측 vs 추계 구분 안 됨. LLM이 잘못 인용 위험.

### 🟡 P1 — 자연어 라우팅 정확도
6. **chain_* 자연어 트리거** — LLM이 description만 보고 "○○시 종합 보고서" → chain_region_brief 정확히 선택하는가? "서울/부산 비교" → chain_compare_regions? "저출산 추세" → chain_policy_indicator vs quick_trend 어느 쪽? 실측 필요.
7. **chain_compare_regions에 자치구 섞임** — `regions: ["광진구", "강남구"]` → 모두 서울로 fallback되면 동일 데이터 비교가 됨. 무의미 결과.
8. **chain_policy_indicator에 자치구 region** — 위와 동일 이슈. 광역시도 fallback 후 동일 데이터.

### 🟢 P2 — 공무원 시나리오 커버리지
9. **연도/기간 자연어** — "작년 대비", "지난 5년", "민선 8기" → 자동 yearCount 추정 필요?
10. **공약 검증** — "출생률 회복 공약 1년 후 효과" → 시작연도-끝연도 변화율 출력
11. **국정감사용 시도 순위표** — "전국 시도 인구 순위" → 전국 17개 전체 비교

---

## 4. 공무원 현업 시나리오 (반드시 통과시킬 35개)

### A. 시정·구정 보고서 (한장 브리핑)
1. "광진구 종합 통계 보고서" → chain_region_brief("광진구") + 자치구 fallback 자연어 안내
2. "성남시 인구 동향 한 페이지" → chain_region_brief("성남시")
3. "춘천시 핵심 지표" → chain_region_brief("춘천시")
4. "여수시 통계 한눈에" → chain_region_brief("여수시")
5. "광주광역시 한장 보고" → chain_region_brief("광주")

### B. 지방의회 답변 준비
6. "주민이 우리 시 인구 줄어든다고 우려하는데" → quick_trend("인구", region=시도)
7. "출생률 회복 공약 1년차 효과" → quick_trend("출산율", yearCount=2)
8. "취임 1년 핵심 지표 변화" → chain_policy_indicator(yearCount=2)
9. "민원: 우리 동네 의사 수 다른 시군보다 적다고 한다" → chain_compare_regions(인접 시도, "의사수")
10. "전국 시도 중 우리 GRDP 순위" → chain_compare_regions(전국 17개, "GRDP")

### C. 예산편성·사업계획
11. "복지예산 산정용 65세 이상 인구 5년 추계" → quick_trend("고령인구", yearCount=5)
12. "주거 정책 기초자료 (3년 가격 변화)" → chain_policy_indicator("housing", yearCount=3)
13. "교통안전 사업 근거 자료" → chain_policy_indicator("safety")
14. "보건소 증설 근거 (의사수 부족)" → chain_compare_regions(시군 비교, "의사수")
15. "출산장려금 효과 검토" → chain_policy_indicator("lowFertility", region=시군)

### D. 정책 영향평가·연구
16. "수도권 vs 비수도권 출산율 비교" → chain_compare_regions(["서울","경기","인천"] vs 비수도권)
17. "광역시 5개 GRDP 5년 추세" → 다지역 시계열
18. "고령화 가속도 시도별 비교" → chain_compare_regions(전국, "고령인구")
19. "주택가격 상승률 시도 순위" → chain_compare_regions(전국, "아파트가격")

### E. 부처별 정기 보고
20. "고용노동부 보고용 실업률/고용률" → chain_policy_indicator("jobs")
21. "복지부 보고용 고령화 지표" → chain_policy_indicator("aging")
22. "교육부 보고용 청년 지표" (해당 키워드 없으면 명확 안내)
23. "환경부 보고용 미세먼지 시도 비교" → chain_compare_regions(전국, "미세먼지")
24. "통계청 인구동향 월간 보고" → quick_stats("출생아수", period="M")

### F. 시도지사·구청장 연설
25. "임기 4년간 핵심 지표 변화 (인구/일자리/주거)" → chain_policy_indicator 3회
26. "우리 시 자랑할 통계 3개" → chain_region_brief + 전국 평균 비교
27. "취임사용 한 줄 통계" — chain_region_brief의 한 줄 요약

### G. 민원 응답·홍보
28. "우리 시 인구가 줄어드는 게 사실이냐" → quick_trend("인구")
29. "OO시가 살기 좋은 도시 1위인가" → chain_compare_regions 다지표 종합
30. "출생아 0명 우려" → quick_stats("출생아수", period="M")

### H. 국정감사·예결산
31. "타 광역시 대비 우리 시 사업 효과" → chain_compare_regions
32. "지난 정부 vs 현 정부 통계 비교" — period 비교 (구현 필요?)
33. "감사용 5년 추세 일관 자료" → chain_policy_indicator(yearCount=5)

### I. 영문 보고 (외빈/국제기구)
34. "Korea's fertility rate trend for OECD report" → quick_trend("fertility")
35. "Seoul vs Tokyo comparable indicators" — 한국 데이터만이라 한계 안내 필요

---

## 5. 프로덕션 체크리스트 (7개)

1. **응답 크기** — `chain_compare_regions({ regions: 17개, keywords: 5개 })` 응답 50KB 이하인가? 초과 시 truncate.
2. **동시성·rate-limit** — 동일 IP에서 5개 chain 동시 호출 시 KOSIS API rate-limit 안 터지나? 캐시 효과 측정.
3. **Cold start** — Fly가 sleep 후 깨어날 때 첫 응답 ~3초 이내인가? Health check 우회 가능한가?
4. **에러 일관성** — KOSIS API down 시 chain이 부분 실패로 응답 (전체 500 X)? 메시지 형식 일관성?
5. **로그 보안** — `fly logs` 출력에 KOSIS API 키 노출 없나? `maskSensitiveUrl` 동등 처리 확인.
6. **메모리 누수** — 장시간 운영 시 LRU 캐시 eviction 정상? heap 누수 모니터링.
7. **버전 정합성** — `/health` `tools: 13`, `version: 1.3.0`, server.ts version, package.json version 모두 일치?

---

## 6. 워크플로우

```
실전 시나리오 → 결과 검토 → 부자연/실패 발견 → 시뮬레이션 케이스 추가
→ 외과적 수정 → 로컬 시뮬레이션 통과 → tsc → fly deploy --remote-only
→ 라이브 재검증 → main 커밋·푸시
```

CLAUDE.md 글로벌 원칙 준수: **추측 금지, 외과적 수정, 인접 코드 건드리지 마라, 동일 접근 3회 실패 시 STOP**.

---

## 7. cheat sheet

### 로컬 시뮬레이션
```bash
cd ~/workspace/korean-stats-mcp
npx tsc
node scripts/simulate-edge-cases.mjs 2>&1 | grep -E "^(✅|⚠️|❌)" | tail -30
node scripts/simulate-chains.mjs
# 신규 작성: node scripts/simulate-realworld.mjs
```

### 라이브 단건 호출
```bash
node -e "
fetch('https://korean-stats-mcp.fly.dev/mcp', {
  method:'POST',
  headers:{'Content-Type':'application/json','Accept':'application/json, text/event-stream'},
  body: JSON.stringify({jsonrpc:'2.0',method:'tools/call',id:1,params:{name:'<tool>',arguments:<args>}})
}).then(r=>r.text()).then(t=>{const j=JSON.parse(t);console.log(j.result.content[0].text)});
"
```

### 체인 도구 (라이브)
```bash
# chain_region_brief
... name:'chain_region_brief', arguments:{region:'성남시', includeNational:true}

# chain_compare_regions
... name:'chain_compare_regions', arguments:{regions:['서울','부산','인천'], keywords:['인구','출산율','GRDP']}

# chain_policy_indicator
... name:'chain_policy_indicator', arguments:{domain:'lowFertility', region:'서울', yearCount:10}
```

### Fly 로그 (실시간)
```bash
export FLY_ACCESS_TOKEN=$(grep "access_token:" ~/.fly/config.yml | sed 's/access_token: //')
fly logs --app korean-stats-mcp --no-tail | tail -80
```

### Fly 재배포
```bash
cd ~/workspace/korean-stats-mcp
npx tsc
export FLY_ACCESS_TOKEN=$(grep "access_token:" ~/.fly/config.yml | sed 's/access_token: //')
fly deploy --remote-only
```

---

## 8. 파일 위치 참조

| 영역 | 파일 |
|---|---|
| 91 키워드 매핑 | `src/data/quickStatsParams.ts` (`QUICK_STATS_PARAMS`, `KEYWORD_ALIASES`) |
| 광역시도 17 + 자치구·시군 200+ | `src/utils/regions.ts` (`PROVINCES`, `DISTRICT_TO_PROVINCE`, `AMBIGUOUS_DISTRICTS`) |
| quick_stats | `src/tools/quickStats.ts` (자연어 추출 + 자치구 disambiguate + 광역시도 fallback) |
| quick_trend | `src/tools/quickTrend.ts` (P0-1 자연어 keyword 처리 완료) |
| **체인 3종** | `src/tools/chains.ts` (`chainRegionBrief`, `chainCompareRegions`, `chainPolicyIndicator`) |
| HTTP 서버 | `src/server-http.ts` (Express stateless, rate-limit, scrub) |
| MCP 서버 | `src/server.ts` (13개 도구 등록) |
| 시뮬레이션 | `scripts/simulate-edge-cases.mjs` (90개), `scripts/simulate-chains.mjs` (18개) |

---

## 9. 추가 검토할 신규 도구 (시간 여유 시)

- **`chain_speech_brief`** — 시도지사·구청장 연설용 1줄 통계 모음 (chain_region_brief의 한 줄 요약 강화 버전). "취임사", "신년사" 자연어 라우팅.
- **`verify_stat_citation`** — LLM 텍스트의 "○○년 △△ 통계는 X" 형태 인용을 KOSIS DB와 교차검증. korean-law-mcp의 `verify_citations` 동등.
- **`forecast_indicator`** — KOSIS 장래추계인구 + 추세 외삽 (5~30년 후 예측). 노령화지수의 추계 데이터 활용.
- **`chain_compare_periods`** — 같은 지역의 시점 비교 (작년 대비 / 5년 대비 / 임기 비교). "민선 8기 변화"

---

## 10. 실제 시작 멘트 예시 (새 세션 첫 응답)

```
korean-stats-mcp v1.3.0 프로덕션 리뷰 + 공무원 현업 실전 테스트 시작.

먼저 P0 운영 리스크부터 — chain_compare_regions({regions: 전국 17개, keywords: 5개})로
응답 크기 측정. 50KB 초과 시 truncate 필요한지 판단.
동시에 LLM이 description만 보고 "광진구 종합 보고서" → chain_region_brief 정확히 호출하는지 라이브 호출로 검증.
```

— 즉, **프로덕션 운영 한계 + LLM 자율 라우팅 정확도**가 핵심 두 축.

---

## 11. 주의/제약 재확인 (CLAUDE.md 글로벌)

- 외과적 수정. 변경된 줄이 요청에 직접 연결되는지 자가 점검
- 1회성 코드에 Factory/Builder 등 디자인 패턴 금지
- 발생 불가능한 시나리오 에러 핸들링 금지
- 동일 접근 3회 실패 시 STOP → 원인 분석 → 재계획
- 모호한 요구사항은 임의 결정 금지, 사용자 확인
- 명확한 버그(failing test, 에러 로그)는 질문 없이 수정 후 보고
- git 작업은 사용자 명시 요청 시에만 (commit/push)
- chris-v3 output style: 한국어 반말/구어체, 간결
- description 변경 시 korean-law-mcp 패턴 (`[태그]` + cross-reference) 유지
