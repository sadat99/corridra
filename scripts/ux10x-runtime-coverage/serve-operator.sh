#!/bin/sh
# Starts the protected-suite server (its Next process moved to 3202) and the recorder on 3200.
# The browser still sees the original 3200 origin, so origin-bound tests are unchanged.
node scripts/ux10x-runtime-coverage/proxy.mjs 3200 3202 "$COV_OUT/operator-events.jsonl" &
P=$!
pnpm exec tsx scripts/zz-coverage-operator-server.ts &
T=$!
trap 'kill -TERM $T 2>/dev/null; kill $P 2>/dev/null; wait' TERM INT
wait $T
kill $P 2>/dev/null
