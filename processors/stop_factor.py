"""
Processors — combines Stop Factor (:8106) and Report Parser (:8105)
in a single container. Uses two separate uvicorn workers.
This file is the stop-factor app (port 8106).
"""
import os
from typing import Any, Dict

import httpx
from fastapi import FastAPI
# CORS removed for internal service
from pydantic import BaseModel

CONFIG_URL = os.getenv("CONFIG_SERVICE_URL", "http://core-api:8000")

app = FastAPI(title="stop-factor", version="4.0.0")


class CheckRequest(BaseModel):
    stage: str = "pre"
    data: Dict[str, Any] = {}


def _resolve(data: dict, path: str):
    parts = path.split(".")
    v = data
    for p in parts:
        if isinstance(v, dict): v = v.get(p)
        else: return None
    return v


def _evaluate(rule: dict, data: dict) -> bool:
    field = rule.get("field_path", ""); op = rule.get("operator", "gte"); threshold = rule.get("threshold", "")
    value = _resolve(data, field)
    if value is None: return True
    try:
        vf, tf = float(value), float(threshold)
        if op == "gte": return vf >= tf
        elif op == "lte": return vf <= tf
        elif op == "gt": return vf > tf
        elif op == "lt": return vf < tf
        elif op == "eq": return vf == tf
    except (ValueError, TypeError):
        if op == "eq": return str(value) == str(threshold)
        elif op == "neq": return str(value) != str(threshold)
        elif op == "not_in": return str(value) not in str(threshold)
    return True


@app.get("/health")
def health():
    return {"status": "ok", "service": "stop-factor"}


@app.post("/api/v1/check")
async def check(body: CheckRequest):
    try:
        async with httpx.AsyncClient(timeout=5.0) as c:
            resp = await c.get(f"{CONFIG_URL}/api/v1/stop-factors?stage={body.stage}")
            rules = resp.json().get("items", [])
    except Exception:
        return {"decision": "PASS", "reason": "config unavailable"}

    for rule in rules:
        if not rule.get("enabled"): continue
        if not _evaluate(rule, body.data):
            return {"decision": rule.get("action_on_fail", "REJECT"),
                    "reason": f"Failed: {rule.get('name')} ({rule.get('field_path')} {rule.get('operator')} {rule.get('threshold')})",
                    "rule_id": rule.get("id")}
    return {"decision": "PASS", "reason": "all checks passed"}
