#!/usr/bin/env bash
#
# RDOL mod 发布脚本
#
# 用法（在服务器上执行）：
#   ./scripts/publish-mod.sh /path/to/RDOnline.zip <release-id> [clientVersion] [--no-activate]
#
# 例：
#   ./scripts/publish-mod.sh ~/RDOnline-2.0.0.zip 2.0.0
#   ./scripts/publish-mod.sh ~/hotfix.zip 2.0.0-2 2.0.0        # 客户端仍是 2.0.0，只热更新
#   ./scripts/publish-mod.sh ~/rollback.zip 2.0.0-1            # 回滚
#
# 说明：
#   - release-id 是服务端内部编号（可含 - _ .），仅用于排序与回滚。
#   - clientVersion 是客户端 BuiltInVersion，必须与客户端一致，否则客户端会
#     判定「有新版本」而拒绝进入游戏。省略时取 release-id 开头的 x.y.z。
#   - 服务端会把整包拆成两层：能热更新的进 CacheAssets，必须重启的进 boot。
#
# 脚本只做三件事：调管理端点传包、打印本次清单、打印当前生效版本。
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$HERE")"

ZIP="${1:-}"
RELEASE="${2:-}"
CLIENT_VERSION="${3:-}"
ACTIVATE="1"

for arg in "$@"; do
  case "$arg" in
    --no-activate) ACTIVATE="0" ;;
  esac
done
case "$CLIENT_VERSION" in
  --no-activate) CLIENT_VERSION="" ;;
esac

if [[ -z "$ZIP" || -z "$RELEASE" ]]; then
  echo "用法: $0 <整包 zip> <release-id> [clientVersion] [--no-activate]" >&2
  exit 1
fi
[[ -f "$ZIP" ]] || { echo "找不到文件: $ZIP" >&2; exit 1; }

if [[ -z "$CLIENT_VERSION" ]]; then
  CLIENT_VERSION="$(printf '%s' "$RELEASE" | grep -oE '^[0-9]+\.[0-9]+\.[0-9]+' || true)"
  [[ -n "$CLIENT_VERSION" ]] || CLIENT_VERSION="$RELEASE"
fi

# 从 .env 读端口与 token（不打印 token）
ENV_FILE="$ROOT/.env"
API_PORT="$(grep -E '^API_PORT=' "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- || true)"
API_PORT="${API_PORT:-3004}"
API_TOKEN="$(grep -E '^API_TOKEN=' "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- || true)"
if [[ -z "$API_TOKEN" ]]; then
  echo "错误: $ENV_FILE 里没有 API_TOKEN，先补一个再发布" >&2
  exit 1
fi

BASE="http://127.0.0.1:${API_PORT}"
SAFE_RELEASE="$(printf '%s' "$RELEASE" | sed 's/[^0-9A-Za-z._-]//g')"
SAFE_CV="$(printf '%s' "$CLIENT_VERSION" | sed 's/[^0-9A-Za-z._-]//g')"
URL="${BASE}/mods/admin/publish?release=${SAFE_RELEASE}&clientVersion=${SAFE_CV}&activate=${ACTIVATE}"

echo "== 发布 $SAFE_RELEASE（clientVersion=$SAFE_CV, activate=$ACTIVATE）"
echo "== 包大小: $(du -h "$ZIP" | cut -f1)"

RESP="$(curl -sS -X POST \
  -H "X-Api-Token: ${API_TOKEN}" \
  -H "Content-Type: application/octet-stream" \
  --data-binary "@${ZIP}" \
  --max-time 600 \
  "$URL")"

echo "== 服务端响应:"
printf '%s\n' "$RESP" | python3 -m json.tool 2>/dev/null || printf '%s\n' "$RESP"

case "$RESP" in
  *'"success":true'*) ;;
  *) echo "发布失败，见上面的响应" >&2; exit 1 ;;
esac

echo
echo "== 当前生效版本:"
curl -sS -H "X-Api-Token: ${API_TOKEN}" "${BASE}/mods/admin/releases" \
  | python3 -m json.tool 2>/dev/null || true

echo
echo "== 客户端看到的清单（前 300 字符）："
curl -sS "${BASE}/checkupdate?platform=win" | head -c 300; echo
