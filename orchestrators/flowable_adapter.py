"""
Flowable adapter:
  - deploys BPMN on startup
  - injects connector URLs into process variables
  - completes requests through an adapter-side callback to core-api
  - normalizes Flowable variables into the same result shape as custom mode
"""
import asyncio
import json
import logging
import os
import sys
import time
from typing import Any, Dict, Optional

import httpx
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

CONFIG_URL = os.getenv("CONFIG_SERVICE_URL", "http://core-api:8000")
BPMN_PATH = os.getenv("BPMN_PATH", "/processes/credit-service-chain.bpmn20.xml")
FLOWABLE_USER = os.getenv("FLOWABLE_USER", "admin")
FLOWABLE_PASSWORD = os.getenv("FLOWABLE_PASSWORD", "test")
CORE_CALLBACK_URL = os.getenv("CORE_CALLBACK_URL", f"{CONFIG_URL}/internal/cases/complete")
INTERNAL_API_KEY = os.getenv("INTERNAL_API_KEY", "")
SERVICE_NAME = "flowable-adapter"


class JsonFormatter(logging.Formatter):
    def format(self, record):
        return json.dumps({"ts": time.time(), "level": record.levelname, "svc": SERVICE_NAME, "msg": record.getMessage()})


log = logging.getLogger(SERVICE_NAME)
log.addHandler(handler := logging.StreamHandler(sys.stdout))
handler.setFormatter(JsonFormatter())
log.setLevel(logging.INFO)

app = FastAPI(title=SERVICE_NAME, version="5.1.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

_cache: Dict[str, tuple] = {}
_background_tasks = set()


def _auth():
    return (FLOWABLE_USER, FLOWABLE_PASSWORD)


def _parse_jsonish(value: Any):
    if isinstance(value, str):
        stripped = value.strip()
        if stripped.startswith("{") or stripped.startswith("["):
            try:
                return json.loads(stripped)
            except json.JSONDecodeError:
                return value
    return value


def _cached_cfg(path, ttl=30):
    if path in _cache:
        value, expires_at = _cache[path]
        if time.time() < expires_at:
            return value
    try:
        response = httpx.get(f"{CONFIG_URL}{path}", timeout=5.0)
        value = response.json() if response.status_code == 200 else {}
    except Exception:
        value = {}
    _cache[path] = (value, time.time() + ttl)
    return value


async def _acfg(path, ttl=30):
    if path in _cache:
        value, expires_at = _cache[path]
        if time.time() < expires_at:
            return value
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(f"{CONFIG_URL}{path}")
            value = response.json() if response.status_code == 200 else {}
    except Exception:
        value = {}
    _cache[path] = (value, time.time() + ttl)
    return value


def _build_steps(process_variables: Dict[str, Any]):
    raw_map = {
        "isoftpull": ("isoRawBody", "iso_status"),
        "creditsafe": ("csRawBody", "creditsafe_status"),
        "plaid": ("plaidRawBody", "plaid_status"),
        "crm": ("crmRawBody", "crm_status"),
    }
    steps = {}
    for service_id, (raw_key, status_key) in raw_map.items():
        raw_value = _parse_jsonish(process_variables.get(raw_key, {}))
        if isinstance(raw_value, dict) and raw_value:
            steps[service_id] = raw_value
        else:
            steps[service_id] = {"service": service_id, "status": process_variables.get(status_key, "UNAVAILABLE")}
    return steps


def _track_task(task: asyncio.Task):
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)


def _extract_summary(process_variables: Dict[str, Any]):
    result = _parse_jsonish(process_variables.get("orchestration_result", {}))
    if isinstance(result, dict):
        return result.get("summary", result)
    return result


async def _parsed_report(request_id: str, steps: Dict[str, Any], cid: str):
    parser = await _acfg("/api/v1/services/report-parser")
    base_url = parser.get("base_url", "")
    endpoint_path = parser.get("endpoint_path", "/api/v1/parse")
    if not base_url:
        return {"status": "PARSER_NOT_CONFIGURED"}
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(
                f"{base_url}{endpoint_path}",
                json={"request_id": request_id, "steps": steps},
                headers={"X-Correlation-ID": cid},
            )
        return response.json() if response.status_code < 400 else {"status": "PARSER_ERROR", "error": response.text}
    except Exception as exc:
        return {"status": "PARSER_UNAVAILABLE", "error": str(exc)}


async def _load_completed_variables(flowable_url: str, instance_id: str) -> Optional[Dict[str, Any]]:
    async with httpx.AsyncClient(timeout=10.0) as client:
        history = await client.get(
            f"{flowable_url}/history/historic-process-instances/{instance_id}",
            auth=_auth(),
        )
        if history.status_code != 200:
            return None
        if not history.json().get("endTime"):
            return None

        variables_response = await client.get(
            f"{flowable_url}/history/historic-process-instances/{instance_id}/variables",
            auth=_auth(),
        )
        if variables_response.status_code != 200:
            return {}
    return {item["name"]: item.get("value") for item in variables_response.json()}


async def _build_result_payload(body: "RequestIn", instance_id: str, process_variables: Dict[str, Any], connector_urls: Dict[str, str], cid: str):
    steps = _build_steps(process_variables)
    parsed_report = await _parsed_report(body.request_id, steps, cid)
    return {
        "status": "COMPLETED",
        "adapter": "flowable",
        "request_id": body.request_id,
        "engine": {"engine": "flowable", "started": True, "instance_id": instance_id, "completed": True},
        "connector_urls_injected": connector_urls,
        "process_variables": {key: _parse_jsonish(value) for key, value in process_variables.items()},
        "steps": steps,
        "parsed_report": parsed_report,
        "summary": _extract_summary(process_variables),
    }


async def _notify_core(request_id: str, result: Dict[str, Any], cid: str):
    headers = {}
    if cid:
        headers["X-Correlation-ID"] = cid
    if INTERNAL_API_KEY:
        headers["X-Internal-Api-Key"] = INTERNAL_API_KEY

    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.post(
            CORE_CALLBACK_URL,
            json={"request_id": request_id, "mode": "flowable", "result": result},
            headers=headers,
        )
    if response.status_code >= 400:
        raise RuntimeError(f"core callback failed: {response.status_code} {response.text}")


async def _watch_process_completion(flowable_url: str, instance_id: str, body: "RequestIn", cid: str, connector_urls: Dict[str, str]):
    for _ in range(60):
        await asyncio.sleep(2)
        try:
            process_variables = await _load_completed_variables(flowable_url, instance_id)
        except Exception as exc:
            log.warning(f"[{cid}] watcher poll failed for {instance_id}: {exc}")
            continue
        if process_variables is None:
            continue

        try:
            result = await _build_result_payload(body, instance_id, process_variables, connector_urls, cid)
            await _notify_core(body.request_id, result, cid)
            log.info(f"[{cid}] completion pushed for {body.request_id}")
        except Exception as exc:
            log.error(f"[{cid}] completion push failed for {body.request_id}: {exc}")
        return

    log.error(f"[{cid}] flowable instance {instance_id} did not finish before watcher timeout")


@app.on_event("startup")
async def auto_deploy_bpmn():
    if not os.path.exists(BPMN_PATH):
        log.warning(f"BPMN file not found: {BPMN_PATH}")
        return
    flowable_cfg = _cached_cfg("/api/v1/services/flowable-rest")
    flowable_url = flowable_cfg.get("base_url", "http://flowable-rest:8080/flowable-rest/service")

    for attempt in range(10):
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                with open(BPMN_PATH, "rb") as bpm_file:
                    response = await client.post(
                        f"{flowable_url}/repository/deployments",
                        files={"file": ("process.bpmn20.xml", bpm_file, "application/xml")},
                        data={"tenantId": ""},
                        auth=_auth(),
                    )
                if response.status_code < 400:
                    log.info(f"BPMN deployed: {response.json().get('id', 'ok')}")
                    return
                log.warning(f"BPMN deploy attempt {attempt + 1}: {response.status_code}")
        except Exception as exc:
            log.warning(f"BPMN deploy attempt {attempt + 1}: {exc}")
        await asyncio.sleep(5)
    log.error("BPMN auto-deploy failed after 10 attempts")


class RequestIn(BaseModel):
    request_id: str
    customer_id: str
    iin: str
    product_type: str
    orchestration_mode: str = "flowable"
    payload: Dict[str, Any] = Field(default_factory=dict)


@app.get("/health")
def health():
    return {"status": "ok", "service": SERVICE_NAME}


@app.post("/orchestrate")
async def orchestrate(body: RequestIn, request: Request):
    cid = request.headers.get("X-Correlation-ID", "")
    log.info(f"[{cid}] orchestrate {body.request_id}")

    flowable_cfg = await _acfg("/api/v1/services/flowable-rest")
    flowable_url = flowable_cfg.get("base_url", "http://flowable-rest:8080/flowable-rest/service")
    meta = flowable_cfg.get("meta", {})
    process_key = meta.get("process_key", "creditServiceChainOrchestration") if isinstance(meta, dict) else "creditServiceChainOrchestration"
    connector_urls = await _acfg("/api/v1/connector-urls") or {}

    variables = [
        {"name": "request_id", "value": body.request_id},
        {"name": "customer_id", "value": body.customer_id},
        {"name": "iin", "value": body.iin},
        {"name": "product_type", "value": body.product_type},
        {"name": "route_mode", "value": "FLOWABLE"},
    ]
    for service_id, url in connector_urls.items():
        variables.append({"name": f"{service_id}_url", "value": url})

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.post(
                f"{flowable_url}/runtime/process-instances",
                json={"processDefinitionKey": process_key, "variables": variables},
                auth=_auth(),
                headers={"X-Correlation-ID": cid},
            )
        if response.status_code >= 400:
            return {"status": "ENGINE_ERROR", "adapter": "flowable", "request_id": body.request_id, "error": response.text}
        engine_response = response.json()
    except Exception as exc:
        return {"status": "ENGINE_UNREACHABLE", "adapter": "flowable", "request_id": body.request_id, "error": str(exc)}

    instance_id = engine_response.get("id")
    completed = False
    process_variables = {}
    for wait_seconds in [0.3, 0.5, 1.0, 1.5]:
        await asyncio.sleep(wait_seconds)
        try:
            maybe_completed = await _load_completed_variables(flowable_url, instance_id)
            if maybe_completed is not None:
                process_variables = maybe_completed
                completed = True
                break
        except Exception:
            pass

    if not completed:
        _track_task(asyncio.create_task(_watch_process_completion(flowable_url, instance_id, body, cid, connector_urls)))
        return {
            "status": "RUNNING",
            "adapter": "flowable",
            "request_id": body.request_id,
            "engine": {"engine": "flowable", "started": True, "instance_id": instance_id, "completed": False},
            "connector_urls_injected": connector_urls,
            "callback_expected": True,
        }

    return await _build_result_payload(body, instance_id, process_variables, connector_urls, cid)
