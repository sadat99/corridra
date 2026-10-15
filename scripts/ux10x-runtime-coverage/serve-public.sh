#!/bin/sh
# Starts the isolated public production server on 3102 and the recorder proxy on 3100.
node scripts/ux10x-runtime-coverage/proxy.mjs 3100 3102 "$COV_OUT/public-events.jsonl" &
P=$!
pnpm --filter @corridra/web start --port 3102 &
T=$!
trap 'kill -TERM $T 2>/dev/null; kill $P 2>/dev/null; wait' TERM INT
wait $T
kill $P 2>/dev/null
