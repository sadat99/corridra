#!/bin/sh
# Runtime control coverage collector. Usage: sh scripts/ux10x-runtime-coverage/run.sh <output-dir>
# Run from the repository root on a clean, committed tree with the isolated local database and
# scanner prepared (docs/runbooks/development.md). It runs the existing public and protected
# browser suites unchanged behind a passive recorder, then links recorded controls to the
# statically discovered control inventory of the current HEAD.
set -eu
OUT="${1:?output directory required}"
mkdir -p "$OUT"
COV_OUT=$(cd "$OUT" && pwd)
export COV_OUT
rm -f "$COV_OUT"/*.jsonl
sed "s/'--port', '3200'/'--port', '3202'/" scripts/operator-browser-server.ts > scripts/zz-coverage-operator-server.ts
trap 'rm -f scripts/zz-coverage-operator-server.ts' EXIT
pnpm exec playwright test --config scripts/ux10x-runtime-coverage/playwright.public.config.ts
pnpm exec playwright test --config scripts/ux10x-runtime-coverage/playwright.operator.config.ts
mkdir -p "$COV_OUT/inventory"
cp docs/ux10x/ux06/verification.json "$COV_OUT/inventory/verification.json"
node scripts/ux10x-inventory.mjs "$(git rev-parse HEAD)" "$COV_OUT/inventory" > /dev/null
python3 scripts/ux10x-runtime-coverage/match.py "$COV_OUT/inventory/coverage.json" "$COV_OUT/runtime-coverage.json" \
  "$COV_OUT/public-events.jsonl" "$COV_OUT/operator-events.jsonl"
