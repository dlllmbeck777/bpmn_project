#!/bin/sh
set -eu

uvicorn report_parser:app --host 0.0.0.0 --port 8105 &
PID1=$!
uvicorn stop_factor:app --host 0.0.0.0 --port 8106 &
PID2=$!

cleanup() {
  kill "$PID1" "$PID2" 2>/dev/null || true
  wait "$PID1" "$PID2" 2>/dev/null || true
}

trap 'cleanup; exit 1' INT TERM

while kill -0 "$PID1" 2>/dev/null && kill -0 "$PID2" 2>/dev/null; do
  sleep 1
done

STATUS1=0
STATUS2=0
wait "$PID1" || STATUS1=$?
wait "$PID2" || STATUS2=$?

cleanup

if [ "$STATUS1" -ne 0 ]; then
  exit "$STATUS1"
fi
if [ "$STATUS2" -ne 0 ]; then
  exit "$STATUS2"
fi
exit 0
