#!/usr/bin/env bash
# Stops the audit preview server (the tsx wrapper forwards SIGTERM to Next). Postgres keeps running.
pkill -TERM -f 'scripts/operator-browser-server.ts' 2>/dev/null || true
for i in $(seq 1 20); do curl -s -o /dev/null http://127.0.0.1:3200/robots.txt || exit 0; sleep 0.5; done
pkill -KILL -f 'next/dist/bin/next start --hostname 127.0.0.1 --port 3200' 2>/dev/null || true
