#!/usr/bin/env bash
# Apply every data/seed/*.sql file to D1. Usage: bash scripts/seed.sh --local | --remote
set -eu
MODE=${1:---local}
for f in data/seed/pleco-*.sql data/seed/sheet.sql data/seed/lessons.sql; do
  [ -f "$f" ] || continue
  printf '%s: ' "$f"
  npx wrangler d1 execute language-tutor "$MODE" --file "$f" 2>&1 | grep -oE "[0-9]+ commands? executed successfully|ERROR.*" | head -1
done
