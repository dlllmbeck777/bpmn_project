#!/bin/sh
set -e
uvicorn report_parser:app --host 0.0.0.0 --port 8105 &
PID1=$!
uvicorn stop_factor:app --host 0.0.0.0 --port 8106 &
PID2=$!
trap "kill $PID1 $PID2 2>/dev/null; exit 1" TERM INT
wait -n
EXIT_CODE=$?
kill $PID1 $PID2 2>/dev/null
exit $EXIT_CODE
