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
# CORS removed for internal service
from pydantic import BaseModel, Field

CONFIG_URL = os.getenv("CONFIG_SERVICE_URL", "http://core-api:8000")
BPMN_PATH = os.getenv("BPMN_PATH", "/processes/credit-service-chain.bpmn20.xml")
FLOWABLE_USER = os.getenv("FLOWABLE_USER", "admin")
FLOWABLE_PASSWORD = os.getenv("FLOWABLE_PASSWORD", "test")
FLOWABLE_AUTO_DEPLOY_BPMN = os.getenv("FLOWABLE_AUTO_DEPLOY_BPMN", "true").strip().lower() in {"1", "true", "yes", "on"}
CORE_CALLBACK_URL = os.getenv("CORE_CALLBACK_URL", f"{CONFIG_URL}/internal/cases/complete")
INTERNAL_API_KEY = os.getenv("INTERNAL_API_KEY", "")
SERVICE_NAME = "flowable-adapter"
TRACKER_URL = f"{CONFIG_URL}/internal/requests/track"
FLOWABLE_STEPS = (
    {"service_id": "isoftpull", "raw_key": "isoRawBody", "status_key": "iso_status", "request_key": None, "skip_key": "skip_isoftpull", "reason_key": "skip_reason_isoftpull"},
    {"service_id": "creditsafe", "raw_key": "csRawBody", "status_key": "creditsafe_status", "request_key": "creditsafe_request_body", "skip_key": "skip_creditsafe", "reason_key": "skip_reason_creditsafe"},
    {"service_id": "plaid", "raw_key": "plaidRawBody", "status_key": "plaid_status", "request_key": "plaid_request_body", "skip_key": "skip_plaid", "reason_key": "skip_reason_plaid"},
    {"service_id": "crm", "raw_key": "crmRawBody", "status_key": "crm_status", "request_key": "crm_request_body", "skip_key": "skip_crm", "reason_key": "skip_reason_crm"},
)


class JsonFormatter(logging.Formatter):
    def format(self, record):
        return json.dumps({"ts": time.time(), "level": record.levelname, "svc": SERVICE_NAME, "msg": record.getMessage()})


log = logging.getLogger(SERVICE_NAME)
log.addHandler(handler := logging.StreamHandler(sys.stdout))
handler.setFormatter(JsonFormatter())
log.setLevel(logging.INFO)

app = FastAPI(title=SERVICE_NAME, version="5.1.0")

_cache: Dict[str, tuple] = {}
_background_tasks = set()


def _auth():
    return (FLOWABLE_USER, FLOWABLE_PASSWORD)


def _internal_headers(cid: str = ""):
    headers = {}
    if INTERNAL_API_KEY:
        headers["X-Internal-Api-Key"] = INTERNAL_API_KEY
    if cid:
        headers["X-Correlation-ID"] = cid
    return headers


def _parse_jsonish(value: Any):
    if isinstance(value, str):
        stripped = value.strip()
        if stripped.startswith("{") or stripped.startswith("["):
            try:
                return json.loads(stripped)
            except json.JSONDecodeError:
                return value
    return value


def _step_meta(step: Dict[str, Any]) -> Dict[str, Any]:
    meta = step.get("meta")
    return meta if isinstance(meta, dict) else {}


def _resolve_skip_policy(step: Optional[Dict[str, Any]], mode: str) -> Dict[str, Any]:
    if not step:
        return {"skip": True, "reason": "pipeline step not configured", "source": "missing"}

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


def _cached_cfg(path, ttl=30):
    if path in _cache:
        value, expires_at = _cache[path]
        if time.time() < expires_at:
            return value
    try:
        response = httpx.get(f"{CONFIG_URL}{path}", timeout=5.0, headers=_internal_headers())
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
            response = await client.get(f"{CONFIG_URL}{path}", headers=_internal_headers())
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


async def _track(request_id: str, stage: str, direction: str, title: str, *, cid: str = "", service_id: Optional[str] = None, status: Optional[str] = None, payload: Any = None):
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


async def _pipeline_skip_flags():
    steps = (await _acfg("/api/v1/pipeline-steps?pipeline_name=default")).get("items", [])
    step_map = {step.get("service_id"): step for step in steps if step.get("service_id")}
    flags = {}
    reasons = {}
    policies = {}
    for step in FLOWABLE_STEPS:
        service_id = step["service_id"]
        policy = _resolve_skip_policy(step_map.get(service_id), "flowable")
        flags[service_id] = policy["skip"]
        reasons[service_id] = policy["reason"]
        policies[service_id] = policy
    return steps, flags, reasons, policies


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


async def _emit_flowable_trace(body: "RequestIn", process_variables: Dict[str, Any], parsed_report: Dict[str, Any], cid: str):
    for step in FLOWABLE_STEPS:
        service_id = step["service_id"]
        status = process_variables.get(step["status_key"], "UNKNOWN")
        if step["request_key"]:
            request_payload = _parse_jsonish(process_variables.get(step["request_key"], {}))
        else:
            request_payload = {
                "request_id": body.request_id,
                "customer_id": body.customer_id,
                "iin": body.iin,
                "product_type": body.product_type,
            }
        response_payload = _parse_jsonish(process_variables.get(step["raw_key"], {}))
        if status == "SKIPPED":
            await _track(
                body.request_id,
                "connector",
                "STATE",
                "Flowable step skipped",
                cid=cid,
                service_id=service_id,
                status="SKIPPED",
                payload={"request": request_payload, "response": response_payload},
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
            payload=request_payload,
        )
        await _track(
            body.request_id,
            "connector",
            "IN",
            f"Response from {service_id}",
            cid=cid,
            service_id=service_id,
            status=status,
            payload=response_payload,
        )
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
            await _emit_flowable_trace(body, process_variables, result.get("parsed_report", {}), cid)
            await _notify_core(body.request_id, result, cid)
            log.info(f"[{cid}] completion pushed for {body.request_id}")
        except Exception as exc:
            log.error(f"[{cid}] completion push failed for {body.request_id}: {exc}")
        return

    log.error(f"[{cid}] flowable instance {instance_id} did not finish before watcher timeout")


@app.on_event("startup")
async def auto_deploy_bpmn():
    if not FLOWABLE_AUTO_DEPLOY_BPMN:
        log.info("BPMN auto-deploy disabled; Flowable UI/database is the source of truth")
        return
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
    pipeline_steps, skip_flags, skip_reasons, skip_policies = await _pipeline_skip_flags()

    variables = [
        {"name": "request_id", "value": body.request_id},
        {"name": "customer_id", "value": body.customer_id},
        {"name": "iin", "value": body.iin},
        {"name": "product_type", "value": body.product_type},
        {"name": "route_mode", "value": "FLOWABLE"},
    ]
    for service_id, url in connector_urls.items():
        variables.append({"name": f"{service_id}_url", "value": url})
    for service_id, skip in skip_flags.items():
        variables.append({"name": f"skip_{service_id}", "value": skip})
    for service_id, reason in skip_reasons.items():
        variables.append({"name": f"skip_reason_{service_id}", "value": reason})

    await _track(
        body.request_id,
        "flowable",
        "OUT",
        "Flowable process started",
        cid=cid,
        service_id="flowable-rest",
        status="STARTED",
        payload={
            "connector_urls": connector_urls,
            "skip_flags": skip_flags,
            "skip_policies": skip_policies,
            "pipeline_steps": pipeline_steps,
        },
    )

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

    result = await _build_result_payload(body, instance_id, process_variables, connector_urls, cid)
    await _emit_flowable_trace(body, process_variables, result.get("parsed_report", {}), cid)
    return result
