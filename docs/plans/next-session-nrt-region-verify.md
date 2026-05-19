# 다음 세션: korean-stats-mcp 리전 재검증 — nrt(도쿄) KOSIS 연결 재확인

> 새 세션 첫 메시지에 통째 붙여넣거나 `cat docs/plans/next-session-nrt-region-verify.md`로 흡수 후 시작.

---

## 1. 배경

| 항목 | 값 |
|---|---|
| 프로젝트 | `~/workspace/korean-stats-mcp` |
| 현재 프로덕션 리전 | Fly `sin` (싱가포르) |
| 라이브 | `https://korean-stats-mcp.fly.dev/mcp` |

`fly.toml` 주석에 채택 사유가 박혀 있음:

```
primary_region = 'sin'  # icn(Seoul)은 일반 plan 미지원, nrt(Tokyo)는 KOSIS API에서 ECONNRESET.
```

- **icn(서울)** — Fly 일반 플랜 미지원 리전.
- **nrt(도쿄)** — 한국에 지리적으로 가장 가깝지만, 과거 측정에서 도쿄 Fly 머신 → `kosis.kr` 호출 시 **ECONNRESET**(연결 강제 종료) 발생 → sin으로 후퇴.
- **sin** — KOSIS 호출 안정적 → 현행 채택.

ECONNRESET은 **과거 측정** 결과라 현재 Fly 네트워크/ KOSIS 방화벽 동작이 달라졌을 수 있음. nrt가 안정적이면 한국 사용자 레이턴시 이득 → 재검증 요청 (2026-05-20, v1.6.0 출시 직후).

---

## 2. 목표

nrt(및 hkg 후보)에서 KOSIS API 연결 안정성을 재측정 → `sin → nrt` 마이그레이션 가능 여부 결정.

종료 조건: nrt/hkg ECONNRESET 발생률 측정 완료 + sin 대비 비교 + 마이그레이션 여부 결정(+사유 기록).

---

## 3. 검증 절차

1. **임시 테스트 머신** — `fly machine run` 으로 nrt에 일회성 머신(예: alpine + curl) 띄우고, 머신 내부에서 KOSIS 두 호스트를 반복 호출:
   - OpenAPI: `https://kosis.kr/openapi/statisticsData.do` (apiKey 필요 — env로 주입)
   - 엑셀 경로: `https://stat.kosis.kr/...` (fetchKosisExcel 3-fetch 대상 호스트)
   - 각 50~100회 호출 → ECONNRESET / timeout 발생 횟수 집계.
2. **hkg(홍콩)** 도 동일 측정 — 한국 근접 + 대체 후보.
3. **sin 대비 비교**: (a) Fly→KOSIS 에러율, (b) Fly→KOSIS 응답시간 p50/p95, (c) 엔드유저(한국)→Fly 라운드트립.
4. **판정**:
   - nrt(또는 hkg) ECONNRESET ≈ 0 → `fly.toml` `primary_region` 변경 + 재배포 + 라이브 스모크. `fly.toml` 주석도 갱신.
   - 여전히 ECONNRESET → `sin` 유지, `fly.toml` 주석에 `재확인 2026-MM-DD, nrt 여전히 불가` 명시.

---

## 4. 주의

- 리전 변경 = 재배포 + 외부 영향 → **사용자 확인 필수**.
- KOSIS는 호스트가 둘 (`kosis.kr/openapi` OpenAPI / `stat.kosis.kr` 엑셀 다운로드) — **둘 다** 테스트. ECONNRESET이 한쪽에서만 날 수도 있음.
- 테스트 머신/앱은 검증 후 **반드시 삭제** (`fly machine destroy` / `fly apps destroy`).
- Fly 인증: 이 머신 셸은 flyctl 네이티브 인증이 안 잡힐 수 있음 — `fly auth login`(브라우저) 필요. **계정은 GitHub 연동 쪽**(앱 소유 = `korean-stats-mcp` 보이는 계정). gmail 계정 아님.

---

## 5. cheat sheet

```bash
cd ~/workspace/korean-stats-mcp
# Fly 인증 (브라우저 — GitHub 계정으로)
fly auth login
fly apps list   # korean-stats-mcp 보이면 올바른 계정

# nrt 임시 머신
fly machine run alpine --region nrt --rm -it -- sh
# 머신 안에서: apk add curl; for i in $(seq 1 80); do curl -sS -o /dev/null -w "%{http_code}\n" "https://kosis.kr/..." || echo ECONNRESET; done

# 리전 변경 시 (판정 후, 사용자 확인 하에)
# fly.toml: primary_region = 'nrt'
fly deploy --remote-only
```

---

## 6. 파일

| 영역 | 파일 |
|---|---|
| 리전 설정 | `fly.toml` (`primary_region`) |
| KOSIS OpenAPI 클라이언트 | `src/api/client.ts` (retry/timeout — ECONNRESET 재시도 동작 참고) |
| KOSIS 엑셀 fetch | `src/tools/fetchKosisExcel.ts` (`fetchWithRetry`, `stat.kosis.kr`) |
