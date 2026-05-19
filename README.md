# Korean Stats MCP

**KOSIS 통계청 OpenAPI를 12개 도구로.** 인구, 경제, 고용, 주거, 사회, 환경 등 91개 키워드 + 17개 시도 + 자치구·시군 230+ 자동 라우팅을 AI 어시스턴트에서 바로 사용.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![MCP](https://img.shields.io/badge/MCP-Compatible-blue)](https://modelcontextprotocol.io/)
[![KOSIS](https://img.shields.io/badge/KOSIS-OpenAPI-green)](https://kosis.kr/openapi/)

> 통계청 KOSIS OpenAPI 기반 MCP 서버. Claude Desktop, Cursor, Windsurf, Claude.ai 등에서 바로 사용 가능.

---

## v1.6 — 자치구·시군 230+ 정밀 라우팅 + 자연어 정규화 + 체인 도구

**LLM이 통계청 수치를 학습 시점으로 답하는 문제를 끝낸다.** 매 질문마다 KOSIS 공식 DB를 직접 조회.

```
"한국 인구가 몇 명이야?"
"GDP 추세 보여줘"
"전국 17개 시도 인구·출산율·GRDP 비교"
"성남시 핵심 지표 한장 브리핑"
"민선 4기 출산율 추이"
```

→ 한 번의 호출로 KOSIS API 실시간 조회 + 자연어 응답. 별도 SQL·API 호출 불필요.

**ChatGPT·Claude가 추정한 통계 수치를 그대로 믿지 마세요.** 정책 보고서, 시정 연설, 민원 답변, 연구 자료 등 수치 신뢰가 필요한 모든 곳에 필수.

---

## 자연어 한 줄이면 끝

**그냥 자연어로 물어보세요.** AI가 키워드·지역·연도·주기·기간을 알아서 추출합니다.

### 약어·오타·공백 변형 자동 정규화 (v1.4 신규)

| 입력 | 매칭 결과 |
|------|----------|
| `GDP` / `gdp` / `G D P` | 국내총생산 |
| `출산률` / `출산율` / `합계출산` | 합계출산율 |
| `고용율` / `취업률` | 고용률 |
| `실엄률` / `실업률` / `청년실업` | 실업률 |
| `노인` / `노년` / `65세 이상` | 65세 이상 고령인구 |
| `집값` / `주택값` | 주택매매가격지수 |
| `아파트값` / `전셋값` | 아파트·전세 가격지수 |
| `연봉` / `월소득` / `봉급` | 상용근로자 월평균 임금 |
| `population` / `fertility` / `inflation` | 영문 별칭 (인구·출산율·물가) |

→ 100개 이상의 줄임말·오타·공백 변형을 정식 키워드로 자동 매핑. 사용자가 정식 용어를 몰라도 동작.

### 시도·자치구·시군 자동 라우팅

```
"한국 인구"           → 51,117,378명 (2025)
"서울 인구"           → 9,299,548명
"제주 인구"           → 664,792명
```

전국 230+ 자치구·시군도 **정밀 라우팅**합니다. `광진구 인구`, `해운대구 고용률`, `수원시 사망률`처럼 자치구를 입력하면 KOSIS 자치구 단위 통계표(14종)로 직접 조회해 정확한 수치를 돌려줍니다 — 인구·출산·고령인구·의사수·아파트/전세가격·고용률·취업자·실업률·사망자수·사망률·혼인(건수·율)·이혼(건수·율). 자치구 통계연보(`.xlsx`)가 있으면 그쪽을 우선 쓰고, 없으면 KOSIS OpenAPI 자치구 코드로 라우팅합니다. 매핑이 없거나 KOSIS가 자치구 데이터를 미수록한 경우에만 소속 광역시도로 fallback + 안내합니다. 동명 자치구(`중구`, `남구` 등)는 광역시 컨텍스트가 같이 있으면 정확히 disambiguate.

### 시계열 추세 + 자연어 기간 추출

```
"최근 10년 출산율 추이"
"민선 4기 인구 변화"
"임기 4년차 GRDP"
"작년 대비 실업률"
"역대 출산율"
```

→ "지난 N년", "민선 N기", "임기 N년차", "작년 대비", "역대" 같은 표현이 자동으로 `yearCount`로 환산됩니다. 응답에는 평균 변화율, 최고/최저점, 변동성, 추세 분류(상승·하락·안정·변동)가 함께 나옵니다.

### 체인 도구 — 한 번에 다지표·다지역·정책영역

```
"성남시 통계 한장 보고"
"전국 17개 시도 인구·출산율·GRDP 비교"
"저출산 영역 10년 추세"
```

세 체인 도구가 여러 `quick_stats`/`quick_trend` 호출을 자동으로 묶어줍니다:

- **`chain_region_brief`** — 단일 지역의 13개 핵심 지표(인구·고용·경제·주거·사회·환경) 한장 브리핑. `format='speech'`면 한 줄 요약(취임사·신년사용)
- **`chain_compare_regions`** — N개 지역 × M개 지표 매트릭스 + 자동 순위 (전국 17개 동시 비교 가능)
- **`chain_policy_indicator`** — 7개 정책 영역(저출산·고령화·주거·일자리·치안·보건·경제) 묶음 10년 시계열

### 장래추계 데이터 안내

노령화지수 같이 KOSIS DB가 **장래추계 데이터를 포함**하는 통계는 응답에 `isProjection: true` + "추계" 명시 안내가 자동 부착됩니다. LLM이 미래 추계를 실측처럼 인용하는 위험 방지.

---

## 왜 만들었나

대한민국 정부 통계는 [KOSIS](https://kosis.kr)에 모여 있지만, 공무원·연구자·기자가 매번 사이트를 뒤지거나 OpenAPI 파라미터를 조립하는 비용이 너무 큽니다. 그리고 LLM은 통계 수치를 학습 시점으로 환각하기 일쑤입니다.

이 프로젝트는 KOSIS의 핵심 통계를 **자연어 한 줄로 호출 가능한 12개 MCP 도구**로 감싸서, AI 어시스턴트나 스크립트가 KOSIS 공식 DB를 직접 조회하도록 만듭니다.

---

## 설치 및 사용법

### 방법 1: Claude.ai 웹 커넥터 (설치 없이 바로) ⭐ 가장 쉬움

Claude Pro/Max/Team/Enterprise 요금제에서 동작.

1. [claude.ai](https://claude.ai) 로그인 → 좌측 사이드바 본인 이름 → **설정** → **커넥터**
2. **커스텀 커넥터 추가** 클릭
3. 입력:
   - **이름**: `korean-stats` (원하는 이름)
   - **URL**: `https://korean-stats-mcp.fly.dev/mcp`
4. **추가** → 추가된 커넥터 **구성** → 모든 도구를 **"항상 사용"**으로 설정
5. 채팅창에 `"한국 출산율 추세 보여줘"` 같이 자연어로 질문하면 끝

### 방법 2: AI 데스크톱 앱 (설치 없음)

Claude Desktop / Cursor / Windsurf 설정 파일에 추가.

**설정 파일 위치:**

| 앱 | Windows | macOS |
|------|---------|-----|
| Claude Desktop | `%APPDATA%\Claude\claude_desktop_config.json` | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Cursor | 프로젝트 `.cursor/mcp.json` | 프로젝트 `.cursor/mcp.json` |
| Windsurf | 프로젝트 `.windsurf/mcp.json` | 프로젝트 `.windsurf/mcp.json` |

**설정 내용:**

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

저장 후 앱 재시작.

### 방법 3: 로컬 설치 (오프라인 가능)

**사전 준비:** [Node.js](https://nodejs.org) 20 이상 · [KOSIS OpenAPI 키](https://kosis.kr/openapi/) (무료 발급).

```bash
git clone https://github.com/chrisryugj/korean-stats-mcp.git
cd korean-stats-mcp
pnpm install
pnpm run build
```

AI 앱 설정 (`KOSIS_API_KEY`에 발급받은 키 입력):

```json
{
  "mcpServers": {
    "korean-stats": {
      "command": "node",
      "args": ["/absolute/path/korean-stats-mcp/dist/index.js"],
      "env": { "KOSIS_API_KEY": "발급받은_키" }
    }
  }
}
```

**자동 설치 스크립트:**

```bash
curl -fsSL https://raw.githubusercontent.com/chrisryugj/korean-stats-mcp/main/install.sh | bash
```

---

## 도구 구조 (12개)

| 구분 | 도구 | 설명 |
|------|------|------|
| **빠른 자연어** ⭐ | `quick_stats` | 자연어 한 줄 → KOSIS 수치 즉답. 91 키워드 + 100+ 별칭/오타 정규화. |
| | `quick_trend` | 시계열 추세 + 평균 변화율 + 최고/최저점 + 자연어 기간 추출 ("민선 4기" 등). |
| **체인** ⛓ | `chain_region_brief` | 단일 지역 13지표 한장 브리핑. `format='speech'`로 연설용 한 줄. |
| | `chain_compare_regions` | N지역 × M지표 매트릭스 + 자동 순위 (전국 17개 동시 가능). |
| | `chain_policy_indicator` | 7개 정책 영역(저출산·고령화·주거·일자리·치안·보건·경제) 10년 시계열. |
| **검색·탐색** | `search_statistics` | KOSIS 90만+ 통계표 키워드 검색 → orgId/tableId 메타 획득. |
| | `get_statistics_list` | 주제별·기관별 트리 탐색 + 9개 분야 추천 카드(`recommendedTopic` 옵션). |
| | `get_table_info` | 통계표 메타데이터 (분류·항목·주기). 경량 응답. |
| **데이터** | `get_statistics_data` | 특정 통계표 데이터 조회. regionName/itemName 자동 매칭. |
| | `compare_statistics` | 시점별·항목별 정밀 비교. |
| | `analyze_time_series` | 상세 시계열 (CAGR·표준편차·추세선). |
| **특수** | `fetch_kosis_excel` | KOSIS 파일통계표(.xlsx) 다운로드 + 파싱 ([kordoc](https://github.com/chrisryugj/kordoc) 엔진). **자치구 기본통계** 등 OpenAPI 미지원 표 커버. |

---

## 지원 키워드 (91개 정식 + 100+ 자연어 별칭)

### 인구·출산·사망·고령화
인구, 총인구, 출산율, 합계출산율, 출생아수, 조출생률, 사망자수, 조사망률, 사망률, 자연증가(율), 기대수명, 평균수명, 고령인구, 노인인구, 65세이상인구, 노령화지수, 고령화지수

### 혼인·이혼
혼인건수, 혼인율, 조혼인율, 이혼건수, 이혼율, 조이혼율, 초혼연령, 평균초혼연령, 남성·여성초혼연령

### 고용·소득
실업률, 고용률, 취업자수, 실업자수, 경제활동인구, 비경제활동인구, 임금, 월평균임금, 월급, 평균임금

### 경제
GDP, 국내총생산, 경제성장률, GDP성장률, 물가, 소비자물가, 소비자물가지수, GRDP, 지역내총생산

### 무역
수출, 수출액, 수입, 수입액, 무역수지

### 주거
주택가격, 주택매매가격, 아파트가격, 아파트매매가격, 전세가격, 주택전세, 전세, 아파트전세

### 환경·교통·사회
미세먼지(PM2.5), PM10, 대기오염, 초미세먼지, 자동차, 자동차등록, 교통사고, 사고건수, 범죄, 범죄율, 범죄발생, 의사, 의사수, 의료인력, 외래관광객, 입국자, 관광객

### 자연어 별칭 (v1.4 신규)
출산·출생·노인·청년실업·연봉·집값·아파트값·전셋값·의료진·차량·관광객수 등 + 영문 (`population`, `fertility`, `aging`, `inflation`, `gdp` 등) + 률/율 오타 (`출산률`, `고용율`, `실엄률`, `이혼률` 등).

---

## 지역 라우팅

- **17개 광역시도** — 서울, 부산, 대구, 인천, 광주, 대전, 울산, 세종, 경기, 강원, 충북, 충남, 전북, 전남, 경북, 경남, 제주 (풀네임·약칭 모두 인식)
- **자치구·시군 230+ 정밀 라우팅** — 자치구 통계연보(`.xlsx`) 또는 KOSIS 자치구 단위 통계표(14종)로 직접 조회. 커버 분야: 인구·출산·고령인구·의사수·아파트/전세가격·고용률·취업자·실업률·사망자수·사망률·혼인·이혼
- **fallback** — 매핑이 없거나 KOSIS가 자치구 데이터를 미수록한 경우에만 소속 광역시도로 대체 + 안내
- **동명 자치구 disambiguate** — `중구`, `남구`, `동구` 등은 광역시 컨텍스트가 같이 있으면 정확히 매칭

---

## 변경 이력

<details>
<summary>v1.6 — 자치구 고용·인구동태 정밀 라우팅 확장</summary>

**자치구 단위 OpenAPI 라우팅 14개 분야로 확장**
- 고용 — `DT_1ES3A03_A01S` (고용률·취업자, objL2 연령 코드)
- 실업 — `DT_1ES3A01S` (실업률·실업자·경제활동인구)
- 인구동태 — `INH_1B82A01`(사망자수) · `INH_1B80A18`(사망률) · `INH_1B83A35`(혼인건수) · `INH_1B85033`(이혼건수) · `INH_1B8000I_01`(조이혼율) · `INH_1B8000I_02`(조혼인율)
- `getDistrictKscdCodeFor` — UP_ITM_ID 없는 메타(고용 통계표) 대응: "서울 광진구" 결합형 / "수원시" 단일형 직접 인덱스 + 동명 시군(고성군) ambiguous 처리
- `DistrictOpenApiRoute` — `objL2`(보조 분류) · `districtObjLevel`/`extraObjL1`(자치구 코드 objLevel swap) 옵션 추가
- 통계연보(`.xlsx`) value 추출 실패 시 OpenAPI 라우팅으로 fall-through
- KOSIS 자치구 데이터 미수록(`-`) 시 광역 fallback로 degrade
- 시뮬레이션 108 케이스 100% 통과 (전국 자치구 정밀값)

</details>

<details>
<summary>v1.4 — 자연어 정규화 + 체인 도구 + 통폐합</summary>

**자연어 약어/오타/공백 정규화 (법령 MCP의 `LAW_ALIAS_ENTRIES` 패턴 차용)**
- `KEYWORD_ALIASES` 100+ 별칭으로 확장 (출생·노인·연봉·집값·청년실업·영문 별칭 등)
- `BASIC_TYPO_MAP` 신설 — 률/율 받침 오타 자동 교정 (`출산률→출산율`, `고용율→고용률`)
- `normalizeKeywordKey` — 공백·대소문자·중점/하이픈 정규화 후 매칭
- `extractKeyword` 단일 정규화 매칭으로 재작성. "G D P", "65세 이상", "경기 노인 인구" 등 자동 인식

**체인 도구 3종**
- `chain_region_brief` — 13지표 한장 브리핑, `format='speech'` 옵션 추가
- `chain_compare_regions` — N지역×M지표 매트릭스, **전국 17개 동시 비교** (max 10→17)
- `chain_policy_indicator` — 7개 정책 영역 10년 시계열

**P0 fixes**
- 자치구 region 파라미터 fallback 미동작 버그 — `quickStats`에서 `input.region`이 자치구일 때 광역시도 변환 분기를 skip하던 가드 제거
- `chain_region_brief.fallbackNote` — 자치구→광역시도 변환 노트 우선 노출
- 노령화지수 등 장래추계 데이터 — `isProjection: true` 메타 + "추계" 명시 안내

**자연어 기간 추출**
- `quick_trend` 키워드에서 "지난 N년", "민선 N기", "임기 N년차", "작년 대비", "역대" 자동 → `yearCount`

**통폐합**
- 도구 13개 → **12개**. `get_recommended_statistics`를 `get_statistics_list`의 `recommendedTopic` 옵션으로 흡수

</details>

<details>
<summary>v1.3 — P0 자치구 라우팅 일소 + 체인 도구 도입</summary>

- `DISTRICT_TO_PROVINCE` 33 → 200+ (경기·강원·충북·충남·전북·전남·경북·경남 전체 시군 + 부산 영도·동래·인천 남동 등)
- `AMBIGUOUS_DISTRICTS` + 광역시도 컨텍스트로 "광주 동구" / "부산 강서구" 정확 매칭
- `extractDistrictName` 광역시 약칭 가드 — "대구" 같은 광역시 약칭이 자치구로 오인되는 버그 fix
- 체인 도구 3종 신설 (region_brief, compare_regions, policy_indicator)

</details>

<details>
<summary>v1.2 — 자치구 라우팅 + 부분매칭 버그 픽스</summary>

- `quick_trend` keyword 자연어 처리 (extract* 헬퍼 공유)
- `extractProvinceName` 단어 경계 매칭으로 "해운대구"의 "대구" 부분매칭 버그 차단
- 자치구 → 광역시도 fallback + 자치구 단위 정밀 조회 경로(`fetch_kosis_excel`) 안내

</details>

---

## 주요 특징

- **91개 키워드 + 100+ 자연어 별칭** — 줄임말·률/율 오타·공백 변형 자동 정규화
- **17개 시도 + 자치구·시군 230+ 정밀 라우팅** — 자치구 통계연보(`.xlsx`) 또는 KOSIS 자치구 단위 통계표(14종)로 직접 조회, 미수록 시에만 광역 fallback
- **체인 도구 3종** — 단일 지역 13지표 한장 브리핑, N지역×M지표 매트릭스(전국 17개 동시), 7개 정책 영역 시계열
- **자연어 기간 추출** — "민선 4기", "임기 4년차", "작년 대비", "역대" 자동 환산
- **장래추계 안내** — 노령화지수 등 추계 데이터는 `isProjection: true` + "추계" 명시 안내
- **파일통계표 파싱** — KOSIS OpenAPI 미지원 표(.xlsx)는 [kordoc](https://github.com/chrisryugj/kordoc) 엔진으로 다운로드·파싱·Markdown 변환
- **캐시** — LRU 기반, 통계 데이터 6시간 TTL
- **원격 엔드포인트** — 설치 없이 `https://korean-stats-mcp.fly.dev/mcp`로 바로 사용

---

## 원격 엔드포인트

- **`https://korean-stats-mcp.fly.dev/mcp`** — Fly.io Singapore 리전, stateless HTTP, 12개 도구 전체 동작
- 헬스체크: `https://korean-stats-mcp.fly.dev/health`

---

## 라이선스

[MIT](./LICENSE)
