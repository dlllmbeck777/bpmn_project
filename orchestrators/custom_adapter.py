"""Custom adapter with config caching, request tracking, and skip-aware pipeline execution."""
import asyncio
import os
import time
from typing import Any, Dict, Optional

import httpx
from fastapi import FastAPI, Request
# CORS removed for internal service
from pydantic import BaseModel, Field

CONFIG_URL = os.getenv("CONFIG_SERVICE_URL", "http://core-api:8000")
INTERNAL_API_KEY = os.getenv("INTERNAL_API_KEY", "")
TRACKER_URL = f"{CONFIG_URL}/internal/requests/track"

app = FastAPI(title="custom-adapter", version="5.1.0")

_cache: Dict[str, tuple] = {}


def _internal_headers(cid: str = ""):
    headers = {}
    if INTERNAL_API_KEY:
        headers["X-Internal-Api-Key"] = INTERNAL_API_KEY
    if cid:
        headers["X-Correlation-ID"] = cid
    return headers


async def _acfg(path: str, ttl: int = 30):
    if path in _cache:
        value, expires_at = _cache[path]
        if time.time() < expires_at:
            return value
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(f"{CONFIG_URL}{path}", headers=_internal_headers())
            value = response.json() if response.status_code == 200 else {}
    except Exception:
        value = {}
    _cache[path] = (value, time.time() + ttl)
    return value


def _step_meta(step: Dict[str, Any]) -> Dict[str, Any]:
    meta = step.get("meta")
    return meta if isinstance(meta, dict) else {}


def _resolve_skip_policy(step: Dict[str, Any], mode: str) -> Dict[str, Any]:
    if not step.get("enabled", True):
        return {"skip": True, "reason": "pipeline step disabled", "source": "enabled"}

    meta = _step_meta(step)
    policy_key = f"skip_in_{mode}"
    if meta.get(policy_key):
        return {
            "skip": True,
            "reason": f"pipeline step bypassed for {mode} mode",
            "source": policy_key,
        }

    return {"skip": False, "reason": "", "source": None}


async def _track(
    request_id: str,
    stage: str,
    direction: str,
    title: str,
    *,
    cid: str = "",
    service_id: Optional[str] = None,
    status: Optional[str] = None,
    payload: Any = None,
):
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            await client.post(
                TRACKER_URL,
                json={
                    "request_id": request_id,
                    "stage": stage,
                    "direction": direction,
                    "title": title,
                    "service_id": service_id,
                    "status": status,
                    "payload": payload or {},
                },
                headers=_internal_headers(cid),
            )
    except Exception:
        pass


class RequestIn(BaseModel):
    request_id: str
    customer_id: str
    iin: str
    product_type: str
    orchestration_mode: str = "custom"
    payload: Dict[str, Any] = Field(default_factory=dict)


@app.get("/health")
def health():
    return {"status": "ok", "service": "custom-adapter"}


@app.post("/orchestrate")
async def orchestrate(body: RequestIn, request: Request):
    cid = request.headers.get("X-Correlation-ID", "")
    steps = (await _acfg("/api/v1/pipeline-steps?pipeline_name=default")).get("items", [])
    results = {}
    accumulated = body.model_dump()
    parsed_report = {"status": "NOT_REQUESTED"}

    for step in steps:
        service_id = step.get("service_id", "")
        skip_policy = _resolve_skip_policy(step, "custom")
        if skip_policy["skip"]:
            skipped = {
                "status": "SKIPPED",
                "reason": skip_policy["reason"],
                "step_order": step.get("step_order"),
                "mode": "custom",
                "policy_source": skip_policy["source"],
            }
            results[service_id] = skipped
            await _track(
                body.request_id,
                "connector",
                "STATE",
                "Pipeline step skipped",
                cid=cid,
                service_id=service_id,
                status="SKIPPED",
                payload={"pipeline_step": step, "skip_policy": skip_policy},
            )
            continue

        service = await _acfg(f"/api/v1/services/{service_id}")
        base_url = service.get("base_url", "")
        endpoint_path = service.get("endpoint_path", "/api/process")
        timeout = service.get("timeout_ms", 10000) / 1000
        retries = service.get("retry_count", 2)
        if not service.get("enabled", True):
            results[service_id] = {"status": "SKIPPED", "reason": "service disabled"}
            await _track(
                body.request_id,
                "connector",
                "STATE",
                "Connector skipped because service is disabled",
                cid=cid,
                service_id=service_id,
                status="SKIPPED",
                payload={"pipeline_step": step, "service": service},
            )
            continue
        if not base_url:
            results[service_id] = {"status": "NOT_CONFIGURED"}
            await _track(
                body.request_id,
                "connector",
                "STATE",
                "Connector not configured",
                cid=cid,
                service_id=service_id,
                status="NOT_CONFIGURED",
                payload={"pipeline_step": step},
            )
            continue

        await _track(
            body.request_id,
            "connector",
            "OUT",
            f"Dispatch to {service_id}",
            cid=cid,
            service_id=service_id,
            status="DISPATCHED",
            payload=accumulated,
        )

        last_err = None
        for attempt in range(retries + 1):
            try:
                async with httpx.AsyncClient(timeout=timeout) as client:
                    response = await client.post(
                        f"{base_url}{endpoint_path}",
                        json=accumulated,
                        headers={"X-Correlation-ID": cid},
                    )
                if response.status_code < 400:
                    step_result = response.json()
                    results[service_id] = step_result
                    accumulated[service_id] = step_result
                    last_err = None
                    await _track(
                        body.request_id,
                        "connector",
                        "IN",
                        f"Response from {service_id}",
                        cid=cid,
                        service_id=service_id,
                        status=step_result.get("status", "OK"),
                        payload=step_result,
                    )
                    break
                last_err = f"HTTP {response.status_code}"
            except Exception as exc:
                last_err = str(exc)
            if attempt < retries:
                await asyncio.sleep(0.5 * (2 ** attempt))
        if last_err:
            results[service_id] = {"status": "UNAVAILABLE", "error": last_err}
            await _track(
                body.request_id,
                "connector",
                "IN",
                f"Connector failure: {service_id}",
                cid=cid,
                service_id=service_id,
                status="UNAVAILABLE",
                payload=results[service_id],
            )

    parser = await _acfg("/api/v1/services/report-parser")
    parser_url = parser.get("base_url", "")
    parser_endpoint = parser.get("endpoint_path", "/api/v1/parse")
    if parser_url:
        try:
            await _track(
                body.request_id,
                "parser",
                "OUT",
                "Dispatch to report parser",
                cid=cid,
                service_id="report-parser",
                status="DISPATCHED",
                payload={"steps": results},
            )
            async with httpx.AsyncClient(timeout=10.0) as client:
                parser_response = await client.post(
                    f"{parser_url}{parser_endpoint}",
                    json={"request_id": body.request_id, "steps": results},
                    headers={"X-Correlation-ID": cid},
                )
            parsed_report = parser_response.json()
            results["parsed_report"] = parsed_report
            await _track(
                body.request_id,
                "parser",
                "IN",
                "Report parser response",
                cid=cid,
                service_id="report-parser",
                status=parsed_report.get("status", "OK"),
                payload=parsed_report,
            )
        except Exception:
            parsed_report = {"status": "PARSER_UNAVAILABLE"}
            results["parsed_report"] = parsed_report
            await _track(
                body.request_id,
                "parser",
                "IN",
                "Report parser unavailable",
                cid=cid,
                service_id="report-parser",
                status="UNAVAILABLE",
                payload=parsed_report,
            )

    return {
        "status": "COMPLETED",
        "adapter": "custom",
        "request_id": body.request_id,
        "steps": results,
        "parsed_report": parsed_report,
    }
