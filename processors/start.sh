#!/bin/sh
# Start both processors in one container
uvicorn report_parser:app --host 0.0.0.0 --port 8105 &
uvicorn stop_factor:app --host 0.0.0.0 --port 8106 &
wait
