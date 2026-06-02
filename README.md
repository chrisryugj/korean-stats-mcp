# Korean Stats MCP

**국가데이터처 KOSIS, 이제 사이트에 들어가지 않습니다.**
AI 어시스턴트에게 한국어로 물어보면 국가데이터처 공식 수치가 출처와 함께 바로 나옵니다.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![MCP](https://img.shields.io/badge/MCP-Compatible-blue)](https://modelcontextprotocol.io/)
[![KOSIS](https://img.shields.io/badge/KOSIS-OpenAPI-green)](https://kosis.kr/openapi/)

> 국가데이터처 KOSIS OpenAPI 기반 MCP 서버. Claude Desktop·Cursor·Claude.ai 등에서 바로 사용. 설치 없이 웹 커넥터로도 가능.

---

## 30초 만에 겪어보기

> 채팅창에 이렇게 칩니다 (Claude.ai 커넥터 등록 후 — [아래 설치법](#설치-3가지-방법) 참고)

```
나: 광진구 고용률 알려줘

AI: 2025년 하반기 광진구의 고용률은 61.6%입니다.
    📊 출처: 고용률 (KOSIS DT_1ES3A03_A01S)
```

KOSIS 사이트에 들어가 통계표를 찾고 → 분류 코드를 고르고 → 자치구 행을 스크롤할 필요가 없습니다.
**자치구 이름과 궁금한 것만 한국어로 던지면 됩니다.**

---

## 공무원 업무, 이렇게 바뀝니다

국가데이터처 통계는 [KOSIS](https://kosis.kr)에 다 있습니다. 문제는 **꺼내 쓰는 비용**입니다.
통계표 ID를 모르면 검색에서 헤매고, 찾아도 분류·항목·주기 코드를 조립해야 하고, 자치구 단위는 표 안에서 행을 뒤져야 합니다. 그래서 보고서 마감 직전마다 KOSIS와 씨름합니다.

이 도구는 그 과정을 **자연어 한 줄**로 줄입니다. 실제 업무 장면으로 봅니다.

---

### 📋 시정연설·신년사·업무보고 — 30분이 5초로

> **상황** — 시장 신년사 원고에 "우리 시 현황" 한 단락을 넣어야 한다. 인구·출산율·고용·지역경제 수치를 KOSIS에서 하나씩 베껴오는 데 매번 30분~1시간.

```
나: 성남시 신년사에 넣을 핵심 통계 한 줄로 정리해줘

AI: 성남시의 주민등록 인구 ○○만 명, 합계출산율 ○.○○명,
    65세 이상 고령인구 ○○만 명, 실업률 ○.○%, 지역내총생산 ○○조 원
    (○○○○년 기준)입니다.
```

`chain_region_brief`의 **연설용 한 줄 모드**가 핵심 지표를 자동으로 추려 한 문장으로 만듭니다. 13개 지표 전체 브리핑도 한 번에 가능합니다.

---

### 🏛 지방의회 답변·행정사무감사 대비 — "옆 동네보다 낮은 거 아니냐"

> **상황** — 의원이 "우리 구 실업률이 인접 구보다 높은 것 아니냐"고 질의할 예정. 인접 자치구를 일일이 조회해 비교표를 만들어야 한다.

```
나: 강남구, 서초구, 송파구 실업률이랑 고용률 비교해줘

AI: 📊 3개 지역 × 2개 지표 비교
    • 실업률: 최고 ○○구(○.○%), 최저 ○○구(○.○%)
    • 고용률: 최고 ○○구(○○.○%), 최저 ○○구(○○.○%)
    [지역별 순위 매트릭스 + 기준시점 포함]
```

`chain_compare_regions`는 **최대 17개 지역 × 8개 지표**를 한 번에 매트릭스로 만들고 지표별 순위까지 매깁니다. "전국 17개 시도 출산율 순위"도 한 줄입니다.

---

### 📑 정책보고서·연구용역 현황 분석 — 10년 추세를 한 번에

> **상황** — 저출산 대응 5개년 계획 보고서. "최근 10년 추세" 챕터에 들어갈 시계열 데이터가 필요하다.

```
나: 저출산 영역 최근 10년 추세 정리해줘

AI: 📑 저출산 영역 10년 추세
    • 합계출산율: 지속 하락 (20○○→20○○년, -○○%)
    • 출생아수: 지속 하락 (-○○%)
    • 혼인건수: 지속 하락 (-○○%)
    • 평균초혼연령: 상승 (+○.○세)
    [연도별 데이터포인트 + 변화율 전체]
```

`chain_policy_indicator`는 **7개 정책 영역**(저출산·고령화·주거·일자리·치안·보건·경제)을 영역별 3~4개 지표 묶음으로 시계열 분석합니다. 평균 변화율·최고/최저점·추세 분류가 함께 나옵니다.

---

### 🗣 민원 응대·보도자료 — 묻는 즉시 공식 수치

> **상황** — "우리 동네 미세먼지가 요즘 어떠냐"는 민원 전화. 또는 보도자료에 들어갈 수치를 30분 뒤 회신해야 한다.

```
나: 충남 미세먼지 수치
AI: 20○○년 충남의 PM2.5 농도는 ○○㎍/㎥입니다. 📊 출처: KOSIS

나: 부산 인구 최근 10년 변화는?
AI: 부산의 인구 10년 추세: 지속적인 하락 추세. ... (변화율·최고/최저점 포함)
```

단일 수치는 `quick_stats`, 추세는 `quick_trend`. **모든 응답에 통계표 출처가 붙어** 그대로 인용할 수 있습니다.

---

### 🎯 자치구·시군 단위까지 — 광역 평균에 묻히지 않습니다

> **상황** — "광진구" 고용률이 필요한데 검색하면 늘 "서울특별시" 평균만 나온다.

```
나: 광진구 고용률, 광진구 65세 이상 인구

AI: 2025년 하반기 광진구의 고용률은 61.6%입니다.
    2024년 광진구의 65세 이상 고령인구는 ○○,○○○명입니다.
```

전국 **230개 이상의 자치구·시군**을 KOSIS 자치구 단위 통계표로 직접 조회합니다. 전국 226개 시군구가 동일 구조로 수록된 **KOSIS 표준 통계표(자치구 코드 라우팅)를 우선** 쓰고, 표준표에 없는 분야만 자치구 통계연보(`.xlsx`)로 보완합니다. `중구`·`남구`처럼 여러 시에 있는 이름도 "부산 중구"처럼 광역시를 같이 말하면 정확히 구분합니다.

---

### 🛡 ChatGPT가 찍어준 통계, 그대로 보고서에 넣지 마세요

일반 AI는 통계 수치를 **학습 시점 기준으로 기억**합니다. "서울 인구"를 물으면 몇 년 전 값을 자신 있게 답합니다. 그 수치가 보고서·연설문·국정감사 자료에 들어가면 사고입니다.

이 커넥터를 켜면 AI는 **질문할 때마다 KOSIS 공식 DB를 실시간 조회**하고, 답변에 통계표 ID(출처)를 함께 표기합니다. 추정이 아니라 인용입니다.

> 장래추계가 포함된 통계(노령화지수 등)는 "이 수치는 실측이 아닌 국가데이터처 추계"라는 안내가 자동으로 붙습니다. 미래 추계를 실측처럼 인용하는 실수를 막습니다.

---

## 무엇을 물어볼 수 있나

### 통계 키워드 — 91개 + 자연어 별칭 100개 이상

| 분야 | 예시 키워드 |
|------|------------|
| 인구·출산·고령 | 인구, 출산율, 출생아수, 사망률, 기대수명, 고령인구, 노령화지수 |
| 혼인·이혼 | 혼인건수, 이혼율, 초혼연령, 평균초혼연령 |
| 고용·소득 | 실업률, 고용률, 취업자수, 경제활동인구, 월평균임금 |
| 경제 | GDP, 경제성장률, 물가(소비자물가지수), GRDP(지역내총생산) |
| 무역 | 수출, 수입, 무역수지 |
| 주거 | 주택매매가격, 아파트가격, 전세가격 |
| 환경·교통·사회 | 미세먼지(PM2.5/PM10), 자동차등록, 교통사고, 범죄율, 의사수, 외래관광객 |

**정식 용어를 몰라도 됩니다.** `집값`→주택매매가격, `노인`→고령인구, `연봉`→월평균임금, `청년실업`→실업률처럼 줄임말·구어체를 자동 변환합니다. `출산률`·`고용율` 같은 률/율 오타, `G D P` 같은 공백, `population`·`gdp` 같은 영문도 인식합니다.

### 지역 — 17개 시도 + 자치구·시군 230개 이상

전국 광역시도 17개(풀네임·약칭 모두)와 자치구·시군 230여 곳. `"민선 8기 출산율 추이"`, `"임기 4년차 GRDP"`, `"작년 대비 실업률"`, `"역대 인구"` 같은 한국 행정 어법의 기간 표현도 자동으로 분석 연수로 환산합니다.

---

## 12개 도구

대부분의 질문은 **`quick_stats`·`quick_trend`·체인 도구 3종**이면 끝납니다. 나머지는 정밀 조회용입니다.

| 구분 | 도구 | 하는 일 |
|------|------|---------|
| **자연어 즉답** ⭐ | `quick_stats` | 자연어 한 줄 → KOSIS 수치 즉답 |
| | `quick_trend` | 시계열 추세 + 변화율 + 최고/최저점 (자연어 기간 인식) |
| **체인** ⛓ | `chain_region_brief` | 한 지역 13개 지표 종합 브리핑 (연설용 한 줄 모드 포함) |
| | `chain_compare_regions` | N개 지역 × M개 지표 매트릭스 + 순위 (최대 17×8) |
| | `chain_policy_indicator` | 7개 정책 영역 묶음 10년 시계열 |
| **검색·탐색** | `search_statistics` | KOSIS 통계표 키워드 검색 |
| | `get_statistics_list` | 주제별·기관별 트리 탐색 + 분야별 추천 |
| | `get_table_info` | 통계표 메타데이터(분류·항목·주기) |
| **정밀 데이터** | `get_statistics_data` | 특정 통계표 데이터 조회 (지역명·항목명 자동 매칭) |
| | `compare_statistics` | 시점별·항목별 정밀 비교 |
| | `analyze_time_series` | 상세 시계열 (CAGR·표준편차·추세선) |
| **파일 통계표** | `fetch_kosis_excel` | KOSIS 파일통계표(`.xlsx`) 다운로드·파싱 — 자치구 통계연보 등 OpenAPI 미지원 표 커버 |

---

## 설치 (3가지 방법)

### 방법 1 — Claude.ai 웹 커넥터 (설치 없음) ⭐ 가장 쉬움

Claude Pro/Max/Team/Enterprise 요금제에서 동작합니다.

1. [claude.ai](https://claude.ai) 로그인 → 좌측 본인 이름 → **설정** → **커넥터**
2. **커스텀 커넥터 추가**
3. 입력 — 이름: `korean-stats` / URL: `https://korean-stats-mcp.fly.dev/mcp`
4. **추가** → 추가된 커넥터 **구성** → 모든 도구를 **"항상 사용"**으로
5. 채팅창에 `"광진구 고용률 알려줘"` 처럼 한국어로 질문하면 끝

### 방법 2 — AI 데스크톱 앱 (설치 없음)

Claude Desktop / Cursor / Windsurf에 원격 MCP 서버를 등록합니다.

#### 원클릭 자동 설치 ⭐

설치 스크립트가 클라이언트 설정 파일을 자동으로 찾아 `korean-stats` 항목을 등록합니다. 기존 설정은 백업(`*.bak.*`) 후 보존되고, 다른 MCP 서버 항목은 그대로 둡니다.

**macOS / Linux** (`jq` 또는 `python3` 필요)

```bash
curl -fsSL https://raw.githubusercontent.com/chrisryugj/korean-stats-mcp/main/install.sh | bash
```

**Windows (PowerShell)**

```powershell
irm https://raw.githubusercontent.com/chrisryugj/korean-stats-mcp/main/install.ps1 | iex
```

기본값은 세 클라이언트 모두 등록(`all`)입니다. 특정 클라이언트만 설치하려면 `--client`(`claude`·`cursor`·`windsurf`·`all`) 옵션을 씁니다.

```bash
# macOS / Linux — Cursor만
curl -fsSL https://raw.githubusercontent.com/chrisryugj/korean-stats-mcp/main/install.sh | bash -s -- --client cursor
```

```powershell
# Windows — Cursor만
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/chrisryugj/korean-stats-mcp/main/install.ps1))) -Client cursor
```

스크립트는 등록 전 원격 서버 헬스 체크를 수행합니다. 설치 후 해당 앱을 재시작하세요.

#### 수동 등록

설정 파일을 직접 편집해도 됩니다.

| 앱 | 설정 파일 위치 |
|----|---------------|
| Claude Desktop | Windows `%APPDATA%\Claude\claude_desktop_config.json` · macOS `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Cursor | 프로젝트 `.cursor/mcp.json` |
| Windsurf | 프로젝트 `.windsurf/mcp.json` |

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

저장 후 앱을 재시작합니다.

### 방법 3 — 로컬 설치 (오프라인 가능)

**준비물**: [Node.js](https://nodejs.org) 20 이상 · [KOSIS OpenAPI 키](https://kosis.kr/openapi/) (무료 발급)

```bash
git clone https://github.com/chrisryugj/korean-stats-mcp.git
cd korean-stats-mcp
pnpm install
pnpm run build
```

AI 앱 설정에 발급받은 키를 넣습니다.

```json
{
  "mcpServers": {
    "korean-stats": {
      "command": "node",
      "args": ["/절대경로/korean-stats-mcp/dist/index.js"],
      "env": { "KOSIS_API_KEY": "발급받은_키" }
    }
  }
}
```

> 로컬에서 직접 실행할 때는 프로젝트 루트에 `.env` 파일을 만들어 `KOSIS_API_KEY=...`를 넣어도 됩니다. (`.env.example` 참고)

---

## 정확성과 신뢰

- **공식 출처** — 모든 수치는 국가데이터처 KOSIS OpenAPI를 실시간 조회합니다. 응답에 통계표 ID가 표기되어 그대로 인용·검증할 수 있습니다.
- **추계 데이터 구분** — 장래추계가 포함된 통계는 "추계" 안내가 자동으로 붙습니다.
- **자치구 데이터 무결성** — 자치구 단위 데이터가 KOSIS에 없으면 임의로 광역시도 값을 자치구 값인 척 답하지 않고, "광역시도 데이터로 대체했다"고 명시합니다.
- **캐시** — 동일 질의는 6시간 캐싱하여 빠르게 응답하되, 통계 갱신 주기를 해치지 않습니다.

---

## 원격 엔드포인트

- 엔드포인트: `https://korean-stats-mcp.fly.dev/mcp` (12개 도구 전체 동작)
- 헬스체크: `https://korean-stats-mcp.fly.dev/health`

---

## 변경 이력

<details>
<summary>v1.7 — 자치구 데이터 소스 우선순위 재정립 + HTTP 서버 안정화</summary>

- 자치구 조회 우선순위 전환 — KOSIS **표준 OpenAPI(자치구 코드 라우팅)를 1순위**로, 통계연보(`.xlsx`)는 표준표에 없는 분야의 보조 경로로. 표준표는 전국 226개 시군구가 동일 구조라 일관성·다지역 비교가능성이 보장됨
- 통계연보 `.xlsx`의 `file_sn`을 분야명 매칭으로 **자치구별 동적 도출** — 자치구마다 다른 통계연보 분야 순서 때문에 엉뚱한 분야 파일을 읽던 문제 차단
- 자치구 데이터 미수록 시 광역값을 자치구 값인 척 답하지 않도록 **응답 격하 강화** — "○○구 단위 미수록, 참고로 상위 지역 □□는 X" 형태로 첫 문장부터 명시
- `chain_compare_regions` **소스 혼합 감지** — 같은 지표가 지역별로 다른 KOSIS 통계표에서 조회되면 비교가능성 경고 자동 부착
- HTTP 서버 메모리 누수 차단 (v1.7.1) — rate-limit IP 버킷 주기적 정리, 매 요청 생성되는 MCP Server 인스턴스 명시적 종료, SIGTERM graceful shutdown (korean-law-mcp 안정화 패턴 적용)

</details>

<details>
<summary>v1.6 — 자치구 고용·인구동태 정밀 라우팅 확장</summary>

- 자치구 단위 OpenAPI 라우팅을 14개 분야로 확장 — 고용(`DT_1ES3A03_A01S`)·실업(`DT_1ES3A01S`)·인구동태(`INH_*` 사망·혼인·이혼)
- 고용·실업 통계표의 반기(`prdSe='S'`) 주기를 응답의 `PRD_SE` 필드 기준으로 라벨링 — "2025년 하반기"처럼 정확 표기
- `getDistrictKscdCodeFor` — `UP_ITM_ID` 없는 메타 대응("서울 광진구" 결합형 / "수원시" 단일형), 동명 시군 ambiguous 처리
- 자치구 통계연보(`.xlsx`) value 추출 실패 시 OpenAPI 라우팅으로 자동 fall-through
- 배포를 Fly.io 컨테이너로 전환 — 자치구 `.xlsx` 파싱(kordoc) 엔진 포함

</details>

<details>
<summary>v1.4 — 자연어 정규화 + 체인 도구</summary>

- 약어·오타·공백 변형 자동 정규화 (`KEYWORD_ALIASES` 100개 이상, 률/율 오타 교정)
- 체인 도구 3종 — `chain_region_brief`(연설용 한 줄 모드 포함)·`chain_compare_regions`(전국 17개 동시)·`chain_policy_indicator`
- `quick_trend` 자연어 기간 추출 — "민선 N기", "임기 N년차", "작년 대비", "역대"
- 도구 13개 → 12개 통폐합

</details>

<details>
<summary>v1.2 ~ v1.3 — 자치구 라우팅 도입</summary>

- `DISTRICT_TO_PROVINCE` 자치구·시군 매핑 200개 이상으로 확장
- 동명 자치구를 광역시도 컨텍스트로 구분 (`AMBIGUOUS_DISTRICTS`)
- "해운대구"의 "대구" 부분매칭 등 부분매칭 버그 차단
- 자치구 정밀 조회 경로(`fetch_kosis_excel`) 도입

</details>

---

## 라이선스

[MIT](./LICENSE)

---

## 참고한 프로젝트

- **[Dayoooun/korea-stats-mcp](https://github.com/Dayoooun/korea-stats-mcp)** — 이 프로젝트의 포크 시작점. 원본에 깊은 감사를 표합니다. 라이선스는 원본과 동일한 MIT.
- **[kordoc](https://github.com/chrisryugj/kordoc)** — KOSIS 파일통계표(`.xlsx`)를 다운로드·파싱하는 엔진. `fetch_kosis_excel` 도구가 이 엔진을 사용합니다.
- **[korean-law-mcp](https://github.com/chrisryugj/korean-law-mcp)** — HTTP 서버 안정화 패턴(rate-limit 버킷 정리, MCP 인스턴스 명시적 종료, SIGTERM graceful shutdown)을 v1.7.1에 적용했습니다.
