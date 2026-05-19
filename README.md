# Korean Stats MCP

**KOSIS 통계청 91개 키워드 + 17개 시도 + 자치구 라우팅 + 시계열 추세를 MCP 하나로.** 자연어로 한국 공식 통계를 AI에서 바로 조회.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![MCP](https://img.shields.io/badge/MCP-Compatible-blue)](https://modelcontextprotocol.io/)
[![KOSIS](https://img.shields.io/badge/KOSIS-OpenAPI-green)](https://kosis.kr/openapi/)

> 통계청 KOSIS OpenAPI 기반 MCP 서버. Claude Desktop, Cursor, Windsurf, Claude.ai 등에서 바로 사용 가능.

---

## v1.2 — 자치구 라우팅 + 부분매칭 버그 픽스 + 친절한 에러

**LLM이 통계청 수치를 학습 시점으로 답하는 문제를 끝내자.** 매 질문마다 KOSIS 공식 DB를 직접 조회.

```
"한국 인구가 몇 명이야?"
"광진구 인구 알려줘"
"해운대구 인구는?"
"저출산 현황"
"고령화 추세 10년"
```

→ 한 번의 도구 호출로 (실제 KOSIS API 호출 결과):

- ✓ "2025년 한국의 주민등록 총인구는 51,117,378명입니다."
- ✓ "2025년 서울의 주민등록 총인구는 9,299,548명입니다." + 💡 *광진구 자치구 데이터는 quick_stats가 지원하지 않아 서울 광역시도 데이터로 표시했습니다. 자치구 단위는 fetch_kosis_excel("광진구", "인구")로 조회하세요.*
- ✓ "2025년 부산의 주민등록 총인구는 3,241,600명입니다." (해운대구 → 부산 자동 라우팅. 이전 v1.1까지는 "대구"로 잘못 매칭되던 부분매칭 버그 수정)
- ✓ "저출산 현황" → 자동으로 합계출산율 0.748명 (자연어 별칭)
- ✓ "고령화" → 자동으로 고령인구 매핑 + 시계열 추세

**ChatGPT·Claude가 추정한 통계 수치를 그대로 믿지 마세요.** 정책·연구·기획·뉴스레터 등 수치 신뢰가 필요한 모든 곳에서 필수.

---

## 자연어 한 줄이면 끝

사용법은 단순합니다. **그냥 자연어로 물어보세요.** AI가 키워드/지역/연도/주기를 알아서 추출합니다.

### 한국 인구가 몇 명이야?

```
"한국 인구"            → 2025년 51,117,378명
"서울 인구"            → 2025년 9,299,548명
"제주 인구"            → 2025년 664,792명
"광진구 인구"          → 서울 9,299,548명 + 자치구 안내
```

→ **광역시도 + 자치구** 모두 처리. 자치구는 광역시도로 fallback하면서 명확한 자치구 조회 경로 안내. "해운대구"의 "대구" 부분매칭 같은 잘못된 케이스 방지.

### 출산율이 얼마나 떨어졌지?

```
"저출산 현황"          → 합계출산율 0.748 (자연어 별칭)
"최근 10년 출산율 추이"  → 시계열 분석 + 평균 변화율 + 최고/최저점
"2024년 10월 출생아수"  → 21,426명 (월별 조회)
```

→ "저출산", "고령화" 같은 자연어 표현이 자동으로 정식 KOSIS 키워드로 매핑. 시계열은 추세/평균변화율/변동성까지 한 번에.

### 부동산·물가·고용·환경 다 조회

```
"서울 아파트가격"      → 매매가격지수 (2021.6=100)
"경기 전세가격"        → 주택전세가격지수
"부산 미세먼지"        → PM2.5 농도 (월별)
"울산 임금"            → 월평균임금
"경기 GRDP"            → 지역내총생산
"서울 교통사고"        → 발생건수 (연)
"제주 의사수"          → 의료기관 종사 의사수
```

→ 인구·고용·경제·무역·부동산·자동차·범죄·관광·교통·의료·대기환경 **91개 키워드**, **17개 시도** 지역별 조회 가능. 일부는 월/분기 조회도 지원.

### 영문 키워드도 지원

```
"population"   → 인구
"unemployment" → 실업률
"fertility"    → 출산율
"gdp"          → GDP (대소문자 무관)
"pm2.5"        → 초미세먼지
```

→ 영문 별칭 + 대소문자 무시. AI가 영문 컨텍스트에서 한국 통계를 부를 때 자연스럽게 동작.

---

## 사용 방법

### 방법 1: 원격 서버 (설치 없이 바로) ⭐ 권장

원격 MCP 서버: **`https://korean-stats-mcp.fly.dev/mcp`** (Fly.io, Seoul/Singapore region, 10 tools 전체 동작 — 자치구 .xlsx 파싱 포함)

#### Claude Desktop

`claude_desktop_config.json` 위치:
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "korean-stats": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://korean-stats-mcp.fly.dev/mcp"]
    }
  }
}
```

#### Cursor / Windsurf

설정 → MCP → Add server:

```json
{
  "korean-stats": {
    "command": "npx",
    "args": ["-y", "mcp-remote", "https://korean-stats-mcp.fly.dev/mcp"]
  }
}
```

### 방법 2: 로컬 설치

```bash
git clone https://github.com/chrisryugj/korean-stats-mcp.git
cd korean-stats-mcp
pnpm install --store-dir /tmp/.pnpm-store --ignore-scripts
pnpm run build
```

Claude Desktop 설정:

```json
{
  "mcpServers": {
    "korean-stats": {
      "command": "node",
      "args": ["/absolute/path/korean-stats-mcp/dist/index.js"]
    }
  }
}
```

### 방법 3: 자동 설치 스크립트

```bash
curl -fsSL https://raw.githubusercontent.com/chrisryugj/korean-stats-mcp/main/install.sh | bash
```

→ Claude Desktop / Cursor / Windsurf 설정에 자동 등록 (현재 OS 자동 감지).

---

## 제공 도구 (10개)

### 핵심 ⭐

| 도구 | 설명 |
|------|------|
| `quick_stats` | 91개 키워드 즉시 조회. 자치구 → 광역시도 자동 라우팅 + 안내. |
| `quick_trend` | 시계열 추세 분석. 평균 변화율, 최고/최저점, 변동성. |

### 고급

| 도구 | 설명 |
|------|------|
| `search_statistics` | KOSIS 90만+ 통계표 키워드 검색. 자치구 → 광역시도 OpenAPI 자동 라우팅. |
| `get_statistics_list` | 주제별/기관별 통계 목록 탐색. |
| `get_statistics_data` | 특정 통계표 데이터 조회. regionName/itemName 자동 매칭. |
| `compare_statistics` | 시점별/항목별 비교 분석. |
| `analyze_time_series` | 상세 시계열 분석 (CAGR/표준편차/추세선). |
| `get_recommended_statistics` | 분야별 추천 통계 목록. |
| `get_table_info` | 통계표 메타데이터 (분류/항목/주기). 경량(filter + sampleSize) 응답. |
| `fetch_kosis_excel` | KOSIS 파일통계표(.xlsx) 다운로드 + kordoc 파싱. **자치구 기본통계** 등 OpenAPI 미지원 표 커버. |

---

## 지원 통계 (91개 키워드)

### 인구·출산·사망·고령화

`인구` `총인구` `출산율` `합계출산율` `출생아수` `출생아` `조출생률` `사망자수` `사망자` `조사망률` `사망률` `자연증가` `자연증가율` `기대수명` `기대여명` `평균수명` `고령인구` `노인인구` `65세이상인구` `노령화지수` `고령화지수`

### 혼인·이혼·초혼

`혼인율` `혼인건수` `조혼인율` `이혼율` `이혼건수` `조이혼율` `초혼연령` `평균초혼연령` `남성초혼연령` `여성초혼연령`

### 고용·노동·임금

`실업률` `고용률` `취업자수` `취업자` `실업자수` `실업자` `경제활동인구` `비경제활동인구` `임금` `월평균임금` `월급` `평균임금`

### 경제·물가·GRDP

`GDP` `국내총생산` `GRDP` `지역내총생산` `경제성장률` `성장률` `GDP성장률` `물가` `소비자물가` `소비자물가지수`

### 무역

`수출액` `수출` `수입액` `수입` `무역수지`

### 부동산

`주택가격` `주택매매가격` `주택가격지수` `아파트` `아파트가격` `아파트매매가격` `아파트가격지수` `전세` `전세가격` `전세가격지수` `주택전세` `아파트전세` `아파트전세가격`

### 자동차·교통·범죄·관광·의료·환경

`자동차` `자동차등록` `자동차대수` `교통사고` `교통사고발생` `사고건수` `범죄` `범죄율` `범죄발생` `관광객` `외래관광객` `입국자` `의사` `의사수` `의료인력` `미세먼지` `PM2.5` `초미세먼지` `대기오염` `PM10`

### 자연어 별칭 (자동 매핑)

`저출산` → 출산율 / `고령화` → 고령인구 / `노령화` → 노령화지수 / `population` → 인구 / `unemployment` → 실업률 / `fertility` → 출산율 / `gdp` → GDP / `pm2.5` → 미세먼지 / 그 외 영문 다수

---

## 지역 라우팅

### 17개 광역시도

`전국` `서울` `부산` `대구` `인천` `광주` `대전` `울산` `세종` `경기` `강원` `충북` `충남` `전북` `전남` `경북` `경남` `제주`

풀네임(`서울특별시`, `경기도`, `제주특별자치도`)도 인식. **단어 경계 매칭**으로 "해운대구"의 "대구" 부분매칭 같은 오류 차단.

### 자치구·시·군

서울 25개 자치구, 부산 16개 자치구·군, 대구·인천·광주·대전·울산 일부 자치구·군 매핑. 자치구 입력 시:

1. 자동으로 **광역시도로 fallback** (예: 광진구 → 서울)
2. 응답에 **`fetch_kosis_excel`로 자치구 단위 조회 안내** 부착
3. 동명 자치구(예: `남구` — 부산/광주/대구/인천/울산) → 모호 안내 메시지

### 주기 (연/분기/월)

지원 키워드 일부는 월/분기 조회 가능 (출생아수, 사망자수, 혼인건수, 이혼건수, 자연증가, 물가, 주택가격, 아파트가격, 전세가격, 관광객, 미세먼지).

```
"2024년 10월 출생아수"   → period=M, month=10
"2024년 3분기 사망자수"   → period=Q, quarter=3
```

---

## 개발자 가이드

### 로컬 개발

```bash
pnpm run dev                    # tsc --watch
pnpm run inspector              # MCP Inspector
node scripts/simulate-edge-cases.mjs  # 엣지케이스 시뮬레이션 (44 케이스)
```

### 프로젝트 구조

```
korean-stats-mcp/
├── src/
│   ├── index.ts                # stdio 진입점
│   ├── server.ts               # MCP 서버 (10 tools)
│   ├── tools/                  # 도구 구현
│   │   ├── quickStats.ts       # 91 키워드 즉시 조회 + 자치구 라우팅
│   │   ├── quickTrend.ts       # 시계열 추세
│   │   ├── fetchKosisExcel.ts  # 파일통계표(.xlsx) 다운로드 + kordoc 파싱
│   │   ├── getTableInfo.ts     # 경량 메타 조회
│   │   └── ...
│   ├── data/quickStatsParams.ts  # 91 키워드 + 별칭 + 지역코드 6종
│   ├── utils/regions.ts        # 광역시도 17 + 자치구 라우팅
│   ├── utils/metaLookup.ts     # regionName/itemName 동적 lookup
│   └── api/client.ts           # KOSIS API 클라이언트
├── src/server-http.ts          # Fly.io HTTP 서버 (stateless MCP, 10 tools)
├── Dockerfile                  # 컨테이너 빌드 (multi-stage, sharp/onnxruntime 포함)
├── fly.toml                    # Fly.io 배포 구성 (sin region, 512MB)
├── scripts/
│   └── simulate-edge-cases.mjs # 44개 엣지케이스 자동 검증
└── docs/plans/                 # 변경 계획 기록
```

### 새 키워드 추가

`src/data/quickStatsParams.ts`에 추가:

```ts
'새키워드': {
  orgId: '101',           // 기관 (101 = 통계청)
  tableId: 'DT_XXXXX',    // 통계표 ID
  tableName: '통계표명',
  description: '설명',
  objL1: '00',            // 분류값 (전국 기본)
  itemId: 'T10',          // 항목
  unit: '단위',
  regionCodes: REGION_CODES_POPULATION,  // 지역별 지원 시
  supportedPeriods: ['Y'],               // 주기 (기본 연간)
}
```

### 별칭 추가

`KEYWORD_ALIASES`에 자연어 → 정식 키워드 매핑 추가:

```ts
'새별칭': '정식키워드',
```

---

## API 키

API 키가 내장되어 있어 별도 설정 없이 바로 사용 가능합니다.

자체 키를 쓰려면 [KOSIS OpenAPI](https://kosis.kr/openapi/)에서 발급받아 `src/config/index.ts`의 `apiKey` 값을 교체하세요.

---

## v1.2 변경 이력

<details>
<summary>v1.2.0 — 엣지케이스 일소 + 자치구 라우팅 안정화</summary>

실제 자연어 질의 44개 시나리오를 시뮬레이션해 발견한 8개 케이스 일괄 수정.

**P0 — Critical**

- **"해운대구" → "대구" 부분매칭 버그** — `quickStats.ts`의 광역시도 매칭이 단순 `includes`였음. "해운대구"에 "대구"가 포함돼 부산 데이터 대신 대구 데이터 반환되던 문제. **단어 경계 검사** 추가 (`구/시/군/도`로 끝나면 자치구 일부로 판단, shortName 매칭 차단)
- **자치구 처리 누락** — `regions.ts:DISTRICT_TO_PROVINCE` 매핑이 있는데 `quickStats`/`quickTrend`가 사용 안 함 → 광진구/강남구/해운대구 모두 전국 데이터로 fallback되던 문제. **자치구 감지 → 광역시도 자동 라우팅 + `fetch_kosis_excel` 안내** 부착

**P1 — High**

- **대소문자 무시** — `gdp` / `pm2.5` / `pm10` 등 영문 키워드가 정확한 case로만 매칭되던 문제. `getQuickStatsParam`에 정확매칭 → 별칭 → case-insensitive 3단계 우선순위 도입
- **친절 에러** — 미래 연도(예: 2030) 조회 시 KOSIS raw error "데이터가 존재하지 않습니다" 노출되던 문제. "아직 발표되지 않았을 가능성이 큽니다" 안내로 교체. 빈 쿼리/공백도 명확한 가이드 메시지

**P2 — Medium**

- **자연어 별칭** — "저출산 현황" → 출산율, "고령화 문제" → 고령인구 자동 매핑. `KEYWORD_ALIASES` 테이블 도입 (한글 5개 + 영문 13개)
- **모호 자치구 안내** — `남구`(부산/광주/대구/인천/울산 5곳 존재) 입력 시 첫 매칭 사용하되 모호함 명시
- **원격 배포 일관성** — 로컬 stdio와 원격 HTTP 양쪽에서 동일한 10 tools 노출되도록 정합성 보장
- **버전/이름 통일** — `name: 'korea-stats-mcp', version: '1.0.0'`이 코드에 박혀 있던 문제. `korean-stats-mcp` / `1.2.0`로 통일

**검증**: `scripts/simulate-edge-cases.mjs` 44 케이스 — 정상/엣지 자동평가 21건 전수 통과, gray 23건 응답 메시지 자연성 수동 확인.

</details>

<details>
<summary>v1.1.0 — 91개 키워드 확대 + 시도별 + 월/분기</summary>

- 키워드 56 → 91개 확대 (자동차, 범죄, 교통사고, 의사수, 초혼연령, 고령인구, 미세먼지 PM2.5/PM10 등)
- 17개 시도별 조회 전면 지원 (실업률·고용률·임금·GRDP·물가·주택가격·아파트·전세 등)
- 월/분기 데이터 지원 (출생아수·사망자수·혼인·이혼·자연증가·물가·주택가격·아파트가격·전세가격·관광객)
- `광역시도·자치구 통계 조회 경로 확장 (Path A/B/C)` — `regions.ts` + `metaLookup.ts` + `fetchKosisExcel.ts` 신설로 KOSIS 파일통계표 자동 다운로드/파싱 (서울 광진구/강남구, 부산 해운대구, 대구 수성구 검증 통과)
- `get_table_info` 경량화 (filter + sampleSize)
- `search_statistics` 자치구 키워드 → 광역시도 OpenAPI 자동 라우팅
- `quick_stats` description 개선 — AI 키워드 추출 정확도 향상

</details>

<details>
<summary>v1.0.0 — 초기 릴리스</summary>

- KOSIS OpenAPI 기반 MCP 서버 초기 구현
- 8개 도구, 51개 키워드, 자연어 질의 응답
- Vercel 서버리스 원격 MCP 지원 (v1.2에서 Fly.io로 전환 — kordoc/sharp 의존성이 250MB 한도 초과)
- Playwright E2E 테스트

</details>

---

## 원본 포크 크레딧

이 프로젝트는 **[Dayoooun/korea-stats-mcp](https://github.com/Dayoooun/korea-stats-mcp)** 를 시작점으로 합니다. 원본에 대한 깊은 감사를 표합니다.

이 fork (`chrisryugj/korean-stats-mcp`)는 다음 작업으로 원본을 발전시켰습니다:

- **광역시도·자치구 통계 조회 경로 확장 (Path A/B/C)** — `regions.ts`·`metaLookup.ts`·`fetchKosisExcel.ts` 신설로 KOSIS 파일통계표 다운로드/kordoc 파싱
- **91개 키워드 + 17개 시도 + 월/분기** — 키워드/주기/지역 매트릭스 대폭 확장
- **44개 엣지케이스 자동 검증** — `scripts/simulate-edge-cases.mjs`
- **자치구 단어 경계 매칭** — "해운대구→대구" 부분매칭 버그 수정
- **자연어 별칭** — 저출산/고령화/영문 키워드 자동 매핑
- **친절 에러** — KOSIS raw error → 사용자 친화 안내
- **`get_table_info` 경량화** — filter + sampleSize 응답 형식
- **원격 MCP 도구 일치** — `api/mcp.ts`에 `getTableInfo`/`fetchKosisExcel` 추가
- **버전/이름 정합성 정리**

라이선스는 원본과 동일한 MIT.

---

## 관련 링크

- [KOSIS 국가통계포털](https://kosis.kr/)
- [KOSIS OpenAPI 가이드](https://kosis.kr/openapi/)
- [Model Context Protocol](https://modelcontextprotocol.io/)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [원본 포크: Dayoooun/korea-stats-mcp](https://github.com/Dayoooun/korea-stats-mcp)

---

## 라이선스

[MIT](LICENSE)
