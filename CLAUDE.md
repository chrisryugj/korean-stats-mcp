# CLAUDE.md

## ⚠️ 배포 — 통합 호스트 (2026-07-02부터)

프로덕션 공식 서빙은 **[gomdori-mcp](https://github.com/chrisryugj/gomdori-mcp) 통합 호스트**(fly 앱 `korean-law-mcp` 1대, MCP 5종 동거)다.

- 공식 주소: `https://mcp.gomdori.app/stats`
- 구 앱 `korean-stats-mcp`는 통합 완료로 **scale 0 처리됨** (fly.dev 주소 비활성)
- **반영 절차**: 이 레포 커밋·푸시 → `npm publish` → `~/workspace/gomdori-mcp/Dockerfile`의 `korean-stats-mcp@X.Y.Z` 핀 갱신 → `cd ~/workspace/gomdori-mcp && fly deploy -c fly.production.toml` → `curl https://mcp.gomdori.app/healthz` 확인
- 구 앱은 scale 0이므로 이 레포에서 `fly deploy` 직접 실행은 무의미 — 통합 반영은 반드시 위 절차로
- 배경·비용 근거: [korean-law-mcp/docs/FLY-COST.md](https://github.com/chrisryugj/korean-law-mcp/blob/main/docs/FLY-COST.md)

## 빌드 함정

- **pnpm 10.28 고정** — pnpm 11로 install하면 lockfile이 변조돼 fly 빌드가 `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH`로 깨진다. 워킹트리의 pnpm-lock.yaml이 변조돼 있으면 `git checkout -- pnpm-lock.yaml` 후 배포
- HTTP 서버 요청 로그는 `ACCESS_LOG=1` 환경변수로 활성화 (쿼리스트링 미기록 — API 키 보호)
