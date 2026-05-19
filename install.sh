#!/usr/bin/env bash
#
# Korean Stats MCP — 자동 설치 스크립트 (macOS / Linux)
#
# Claude Desktop / Cursor / Windsurf 설정에 원격 MCP 서버를 등록합니다.
# 기존 설정은 보존하면서 'korean-stats' 항목만 추가/갱신합니다.
#
# 사용:
#   curl -fsSL https://raw.githubusercontent.com/chrisryugj/korean-stats-mcp/main/install.sh | bash
#   curl -fsSL https://raw.githubusercontent.com/chrisryugj/korean-stats-mcp/main/install.sh | bash -s -- --client cursor
#

set -euo pipefail

REMOTE_URL="https://korean-stats-mcp.fly.dev/mcp"
SERVER_NAME="korean-stats"
CLIENT="all"  # claude|cursor|windsurf|all

# CLI 인자
while [[ $# -gt 0 ]]; do
  case "$1" in
    --client) CLIENT="$2"; shift 2 ;;
    --url) REMOTE_URL="$2"; shift 2 ;;
    -h|--help)
      cat <<EOF
Korean Stats MCP 자동 설치 스크립트

옵션:
  --client {claude|cursor|windsurf|all}   설치할 클라이언트 (기본: all)
  --url <URL>                              원격 MCP 서버 URL (기본: $REMOTE_URL)
  -h, --help                               도움말

예시:
  bash install.sh                          # 모든 클라이언트에 설치
  bash install.sh --client cursor          # Cursor만 설치
EOF
      exit 0
      ;;
    *) echo "알 수 없는 옵션: $1" >&2; exit 1 ;;
  esac
done

# 색상
RED=$'\033[0;31m'; GREEN=$'\033[0;32m'; YELLOW=$'\033[0;33m'; BLUE=$'\033[0;34m'; NC=$'\033[0m'

log()   { echo "${BLUE}[korean-stats-mcp]${NC} $*"; }
ok()    { echo "${GREEN}✓${NC} $*"; }
warn()  { echo "${YELLOW}⚠${NC}  $*"; }
err()   { echo "${RED}✗${NC} $*" >&2; }

# OS 감지
OS="$(uname -s)"
case "$OS" in
  Darwin) PLATFORM="mac" ;;
  Linux)  PLATFORM="linux" ;;
  *) err "지원하지 않는 OS: $OS"; exit 1 ;;
esac

log "플랫폼: $PLATFORM"
log "원격 서버: $REMOTE_URL"
log "대상 클라이언트: $CLIENT"
echo

# jq 또는 python3 필요
if command -v jq >/dev/null 2>&1; then
  JSON_TOOL="jq"
elif command -v python3 >/dev/null 2>&1; then
  JSON_TOOL="python3"
else
  err "jq 또는 python3가 필요합니다."
  exit 1
fi

# JSON merge: 입력 파일에 'mcpServers' 객체 추가/병합. python3 또는 jq 사용.
merge_config() {
  local file="$1"
  local config_json="$2"

  mkdir -p "$(dirname "$file")"

  if [[ ! -s "$file" ]]; then
    echo '{}' > "$file"
  fi

  # 기존 파일 백업
  cp "$file" "${file}.bak.$(date +%s)" 2>/dev/null || true

  if [[ "$JSON_TOOL" == "jq" ]]; then
    local tmp="${file}.tmp"
    jq --argjson new "$config_json" '
      .mcpServers = (.mcpServers // {}) * $new
    ' "$file" > "$tmp" && mv "$tmp" "$file"
  else
    python3 - <<PY
import json, sys
path = "$file"
new = json.loads('''$config_json''')
try:
    with open(path) as f:
        cfg = json.load(f)
except Exception:
    cfg = {}
cfg.setdefault("mcpServers", {}).update(new)
with open(path, "w") as f:
    json.dump(cfg, f, indent=2, ensure_ascii=False)
PY
  fi
}

CLAUDE_CONFIG='{"'"$SERVER_NAME"'":{"command":"npx","args":["-y","mcp-remote","'"$REMOTE_URL"'"]}}'
CURSOR_CONFIG='{"'"$SERVER_NAME"'":{"command":"npx","args":["-y","mcp-remote","'"$REMOTE_URL"'"]}}'
WINDSURF_CONFIG='{"'"$SERVER_NAME"'":{"serverUrl":"'"$REMOTE_URL"'"}}'

install_claude() {
  local path
  if [[ "$PLATFORM" == "mac" ]]; then
    path="$HOME/Library/Application Support/Claude/claude_desktop_config.json"
  else
    path="$HOME/.config/Claude/claude_desktop_config.json"
  fi
  log "Claude Desktop: $path"
  merge_config "$path" "$CLAUDE_CONFIG"
  ok "Claude Desktop 등록 완료. Claude를 재시작하세요."
}

install_cursor() {
  local path
  if [[ "$PLATFORM" == "mac" ]]; then
    path="$HOME/.cursor/mcp.json"
  else
    path="$HOME/.cursor/mcp.json"
  fi
  log "Cursor: $path"
  merge_config "$path" "$CURSOR_CONFIG"
  ok "Cursor 등록 완료. Cursor를 재시작하세요."
}

install_windsurf() {
  local path
  if [[ "$PLATFORM" == "mac" ]]; then
    path="$HOME/.codeium/windsurf/mcp_config.json"
  else
    path="$HOME/.codeium/windsurf/mcp_config.json"
  fi
  log "Windsurf: $path"
  merge_config "$path" "$WINDSURF_CONFIG"
  ok "Windsurf 등록 완료. Windsurf를 재시작하세요."
}

# 헬스 체크
log "원격 서버 헬스 체크..."
if curl -sSf "$REMOTE_URL%2Fhealth" >/dev/null 2>&1 || \
   curl -sSf "${REMOTE_URL%/mcp}/health" >/dev/null 2>&1; then
  ok "원격 서버 응답 정상"
else
  warn "원격 서버 헬스 체크 실패 (계속 진행). URL: $REMOTE_URL"
fi
echo

case "$CLIENT" in
  claude)   install_claude ;;
  cursor)   install_cursor ;;
  windsurf) install_windsurf ;;
  all)
    install_claude
    echo
    install_cursor
    echo
    install_windsurf
    ;;
  *)
    err "알 수 없는 클라이언트: $CLIENT"
    exit 1
    ;;
esac

echo
ok "설치 완료. 통계 질의 예시:"
echo "  - \"한국 인구가 몇 명이야?\""
echo "  - \"광진구 인구 알려줘\"   ← 자치구 자동 라우팅"
echo "  - \"저출산 현황\"           ← 자연어 별칭"
echo "  - \"서울 아파트가격\""
echo "  - \"최근 10년 출산율 추이\""
