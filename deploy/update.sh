#!/usr/bin/env bash
# อัปเดตโค้ดบน droplet หลัง push ขึ้น GitHub:  bash deploy/update.sh
set -euo pipefail
cd "$(dirname "$0")/.."
git pull --ff-only
npm ci --omit=dev || npm install --omit=dev
pm2 reload drhuk-line --update-env
pm2 status drhuk-line
