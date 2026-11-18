#!/usr/bin/env bash
# Reproducible local setup for the LibreChat foundation (no Docker required).
#
# The Freebuff cloud VM cannot use Docker (root-only socket), so this runs the same
# stack natively: real mongod (via mongodb-memory-server) + LibreChat API on :3080.
# For a normal server, use deploy/librechat/docker-compose.yml instead.
#
# Usage:  bash tools/setup-librechat.sh
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LC="$ROOT/librechat"
TAG="v0.8.9"          # pinned LibreChat release
cd "$ROOT"

if [ ! -d "$LC/.git" ]; then
  echo "==> cloning LibreChat $TAG"
  git clone --depth 1 --branch "$TAG" https://github.com/LibreChat-AI/LibreChat.git "$LC"
fi

echo "==> installing LibreChat dependencies (npm ci)"
(cd "$LC" && npm ci --no-audit --no-fund)

echo "==> building workspace packages"
(cd "$LC" && npm run build:packages)

echo "==> building the client bundle (API serves it in production mode)"
(cd "$LC" && npm run build:client)

echo "==> applying the SHAVI AI runtime config + file support patch"
cp "$ROOT/librechat-deploy/librechat.yaml" "$LC/librechat.yaml"
node "$ROOT/librechat-file-support/apply-file-support.mjs"

echo "==> installing local mongo helper"
mkdir -p "$ROOT/tools/librechat-dev"
[ -f "$ROOT/tools/librechat-dev/package.json" ] || printf '{"name":"librechat-dev-tools","private":true,"type":"module"}\n' > "$ROOT/tools/librechat-dev/package.json"
(cd "$ROOT/tools/librechat-dev" && npm i mongodb-memory-server --no-audit --no-fund)

cat <<'MSG'

==> done.

Start in two shells:
  1) node tools/librechat-dev/mongod-server.mjs          # real mongod on 127.0.0.1:27017
  2) cd librechat && SHAVI_AI_KEY="$(cat ../ai-key.txt)" npm run backend

Then open http://localhost:3080 and create the first account (it becomes ADMIN).
No SMTP is configured, so verify accounts with:
  cd librechat && node scripts-shavi/verify-email.mjs
MSG
