#!/bin/sh
set -e
uvicorn flowable_adapter:app --host 0.0.0.0 --port 8011 &
PID1=$!
uvicorn custom_adapter:app --host 0.0.0.0 --port 8012 &
PID2=$!
trap "kill $PID1 $PID2 2>/dev/null; exit 1" TERM INT
wait -n
EXIT_CODE=$?
kill $PID1 $PID2 2>/dev/null
exit $EXIT_CODE
