#!/usr/bin/env bash
# Rebuild and restart the local API under the memory guard, regenerate the TypeScript client.
set -euo pipefail
cd "$(dirname "$0")/.."
MEMGUARD_MAX_SWAP_USED_MB=${MEMGUARD_MAX_SWAP_USED_MB:-32000} ~/nexconn-hackathon/tools/safejob.sh cargo build -q -p pehle-api
pkill -f "target/debug/pehle-api" || true
sleep 0.5
nohup ./target/debug/pehle-api > /tmp/pehle-api.log 2>&1 &
./target/debug/pehle-api openapi > packages/api-client/openapi.json
(cd packages/api-client && bunx openapi-typescript openapi.json -o src/schema.d.ts > /dev/null)
sleep 1.5
curl -fsS localhost:8790/readyz && echo
