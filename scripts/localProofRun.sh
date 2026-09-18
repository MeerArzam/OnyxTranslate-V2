#!/bin/bash
# =============================================================================
# OnyxTranslate — P1/P2/P3 LOCAL PROOF HARNESS (self-terminating)
#
# Runs the REAL deployed Convex functions against the OFFICIAL open-source
# Convex backend, entirely inside ONE synchronous shell command:
#   start backend -> push functions -> run proof suite -> dump evidence JSON
#   -> kill backend -> exit. Nothing is left running.
#
# Usage:  bash scripts/localProofRun.sh [quick|full]
#   quick = probes + P1 recovery + T4 kill test with short TTL override
#   full  = quick + T1 rate conformance (real 10-min dispatcher window)
# =============================================================================
set -u
BACKEND_DIR=/tmp/onyx-backend
BIN=$BACKEND_DIR/convex-local-backend
DB=$BACKEND_DIR/proof_$$.sqlite3
PORT=3219
SECRET=af518a2a5c2f9f82be718c4b8e25a5f1e5b1d0e93a8c17d64f2e5a9b7c6d3e21
MODE=${1:-quick}
OUT=/tmp/onyx/local-proof-results.json

cd "$(dirname "$0")/.."

cleanup() {
  [ -n "${BPID:-}" ] && kill "$BPID" 2>/dev/null
  rm -f "$DB"
}
trap cleanup EXIT

echo "== [1/5] starting local OSS backend (port $PORT) =="
"$BIN" --instance-name onyx-proof --instance-secret "$SECRET" \
       --port "$PORT" "$DB" > "$BACKEND_DIR/proof_$$.log" 2>&1 &
BPID=$!
for i in $(seq 1 30); do
  sleep 1
  if curl -s -o /dev/null --max-time 2 "http://127.0.0.1:$PORT/api/"; then break; fi
done
curl -s -o /dev/null --max-time 2 "http://127.0.0.1:$PORT/api/" || { echo "BACKEND FAILED"; tail -20 "$BACKEND_DIR/proof_$$.log"; exit 2; }
echo "backend up (pid $BPID)"

echo "== [2/5] pushing functions =="
export CONVEX_URL="http://127.0.0.1:$PORT"
ADMIN_KEY="$(cd /tmp/onyx-backend && ./convex-local-backend keygen admin-key --instance-name onyx-proof --instance-secret "$SECRET" | cut -d"|" -f2)"
bunx convex deploy --url "http://127.0.0.1:$PORT" --admin-key "$ADMIN_KEY" --yes 2>&1 | tail -3 || exit 3

echo "== [3/5] Gemini keys: using dummy values (T1/T4 paths handle key errors without throwing) =="
bunx convex env set --url "http://127.0.0.1:$PORT" --admin-key "$ADMIN_KEY" Gemini_API_Key_1 "DUMMY_KEY_FOR_LOCAL_PROOF" >/dev/null 2>&1

echo "== [4/5] running proof suite ($MODE) =="
LOCAL_BACKEND_URL="http://127.0.0.1:$PORT" LOCAL_ADMIN_KEY="$SECRET" PROOF_MODE="$MODE" \
  node scripts/localProofSuite.mjs
SUITE=$?

echo "== [5/5] done (suite exit $SUITE) — evidence: $OUT =="
exit $SUITE
