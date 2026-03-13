#!/bin/sh
uvicorn flowable_adapter:app --host 0.0.0.0 --port 8011 &
uvicorn custom_adapter:app --host 0.0.0.0 --port 8012 &
wait
