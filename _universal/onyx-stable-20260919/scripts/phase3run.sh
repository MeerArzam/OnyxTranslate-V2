#!/bin/bash
# PHASE 3 OS-supervised launcher — immune to event-loop blocking inside the
# worker: if the worker outlives its budget (or the terminal dies), the OS
# kill terminates the whole process group (worker + vite preview + chromium).
STAGE="$1"
BUDGET="$2"   # seconds
LOG="/tmp/onyx/stage${STAGE}.out"
rm -f "$LOG"
WATCHDOG_MS=$(( (BUDGET - 40) * 1000 )) setsid node scripts/phase3ClientTest.mjs --stage="$STAGE" > "$LOG" 2>&1 &
WPID=$!
ELAPSED=0
while kill -0 $WPID 2>/dev/null; do
  sleep 2
  ELAPSED=$((ELAPSED + 2))
  if [ "$ELAPSED" -ge "$BUDGET" ]; then
    echo "SUPERVISOR: killing stage $STAGE after ${BUDGET}s"
    kill -TERM -- -"$WPID" 2>/dev/null
    sleep 3
    kill -KILL -- -"$WPID" 2>/dev/null
    echo "SUPERVISOR: killed (progress log tail follows)"
    tail -5 /tmp/onyx/phase3-progress.log 2>/dev/null
    exit 2
  fi
done
tail -40 "$LOG"
