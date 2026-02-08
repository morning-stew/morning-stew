#!/bin/bash
# Daily newsletter generation script for Railway cron
# Runs at 6 AM PT (1 PM UTC) every day

set -e

echo "🍵 Morning Stew Daily Generation - $(date)"

cd /app

# Generate the newsletter
echo "[cron] Generating newsletter..."
npm run generate

# Publish to the API server
echo "[cron] Publishing to API..."
API_URL="${API_URL:-https://morning-stew-production.up.railway.app}"
npm run publish

echo "[cron] ✅ Done at $(date)"
