"""Custom Adapter v5 — config caching, correlation ID, retry."""
import os, time, json, logging, sys
from typing import Any, Dict
import httpx
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

CONFIG_URL = os.getenv("CONFIG_SERVICE_URL", "http://core-api:8000")

app = FastAPI(title="custom-adapter", version="5.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

_cache: Dict[str, tuple] = {}
async def _acfg(path, ttl=30):
    if path in _cache:
        v, e = _cache[path]
        if time.time() < e: return v
    try:
        async with httpx.AsyncClient(timeout=5.0) as c:
            r = await c.get(f"{CONFIG_URL}{path}")
            v = r.json() if r.status_code == 200 else {}
    except: v = {}
    _cache[path] = (v, time.time() + ttl)
    return v

class RequestIn(BaseModel):
    request_id: str; customer_id: str; iin: str; product_type: str
    orchestration_mode: str = "custom"; payload: Dict[str, Any] = Field(default_factory=dict)

@app.get("/health")
def health():
    return {"status": "ok", "service": "custom-adapter"}

@app.post("/orchestrate")
async def orchestrate(body: RequestIn, request: Request):
    cid = request.headers.get("X-Correlation-ID", "")
    steps = (await _acfg("/api/v1/pipeline-steps?pipeline_name=default")).get("items", [])
    results, accumulated = {}, body.model_dump()
    parsed_report = {"status": "NOT_REQUESTED"}

    for step in steps:
        sid = step.get("service_id", "")
        if not step.get("enabled", True): continue
        svc = await _acfg(f"/api/v1/services/{sid}")
        url, ep = svc.get("base_url", ""), svc.get("endpoint_path", "/api/process")
        timeout = svc.get("timeout_ms", 10000) / 1000
        retries = svc.get("retry_count", 2)
        if not url:
            results[sid] = {"status": "NOT_CONFIGURED"}; continue

        # Retry with backoff
        last_err = None
        for attempt in range(retries + 1):
            try:
                async with httpx.AsyncClient(timeout=timeout) as c:
                    resp = await c.post(f"{url}{ep}", json=accumulated,
                        headers={"X-Correlation-ID": cid})
                    if resp.status_code < 400:
                        sr = resp.json(); results[sid] = sr; accumulated[sid] = sr; last_err = None; break
                    last_err = f"HTTP {resp.status_code}"
            except Exception as exc:
                last_err = str(exc)
            if attempt < retries:
                import asyncio; await asyncio.sleep(0.5 * (2 ** attempt))
        if last_err:
            results[sid] = {"status": "UNAVAILABLE", "error": last_err}

    # Parse
    parser = await _acfg("/api/v1/services/report-parser")
    purl, pep = parser.get("base_url", ""), parser.get("endpoint_path", "/api/v1/parse")
    if purl:
        try:
            async with httpx.AsyncClient(timeout=10.0) as c:
                pr = await c.post(f"{purl}{pep}", json={"request_id": body.request_id, "steps": results},
                    headers={"X-Correlation-ID": cid})
                parsed_report = pr.json()
                results["parsed_report"] = parsed_report
        except:
            parsed_report = {"status": "PARSER_UNAVAILABLE"}
            results["parsed_report"] = parsed_report

    return {"status": "COMPLETED", "adapter": "custom", "request_id": body.request_id, "steps": results, "parsed_report": parsed_report}
