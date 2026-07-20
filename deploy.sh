#!/usr/bin/env bash
# One-command deploy: pull latest, install deps only when the lockfile changed,
# zero-downtime reload under pm2.
#
# Usage on the server:   ./deploy.sh
# Secrets (AWS keys etc.) live in /etc/driveinnovate/secrets.env — loaded by
# app.js before .env, so nothing here needs to export them.
set -euo pipefail
cd "$(dirname "$0")"

APP_NAME="di-server"   # adjust if your pm2 process name differs (pm2 ls)

BEFORE=$(git rev-parse HEAD)
git pull --ff-only
AFTER=$(git rev-parse HEAD)

if [ "$BEFORE" != "$AFTER" ] && git diff --name-only "$BEFORE" "$AFTER" | grep -q '^package-lock\.json$'; then
  echo "package-lock.json changed — installing dependencies…"
  npm ci --omit=dev
fi

# reload = zero-downtime restart; falls back to a fresh start on first deploy
pm2 reload "$APP_NAME" --update-env 2>/dev/null || pm2 start app.js --name "$APP_NAME"
pm2 save

echo "Deployed $(git rev-parse --short HEAD)"
