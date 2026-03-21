"""
Flowable adapter:
  - deploys BPMN on startup
  - injects connector URLs into process variables
  - completes requests through an adapter-side callback to core-api
  - normalizes Flowable variables into the same result shape as custom mode
"""
import asyncio
import copy
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
FLOWABLE_PASSWORD_FALLBACKS = [
    item.strip()
    for item in os.getenv("FLOWABLE_PASSWORD_FALLBACKS", "test").split(",")
    if item.strip()
]
FLOWABLE_AUTO_DEPLOY_BPMN = os.getenv("FLOWABLE_AUTO_DEPLOY_BPMN", "true").strip().lower() in {"1", "true", "yes", "on"}
FLOWABLE_WATCH_TIMEOUT_SECONDS = max(15, int((os.getenv("FLOWABLE_WATCH_TIMEOUT_SECONDS", "90") or "90").strip()))
FLOWABLE_WATCH_POLL_SECONDS = max(1.0, float((os.getenv("FLOWABLE_WATCH_POLL_SECONDS", "2") or "2").strip()))
FLOWABLE_READY_TIMEOUT_SECONDS = max(5, int((os.getenv("FLOWABLE_READY_TIMEOUT_SECONDS", "75") or "75").strip()))
FLOWABLE_READY_POLL_SECONDS = max(1.0, float((os.getenv("FLOWABLE_READY_POLL_SECONDS", "3") or "3").strip()))
CORE_CALLBACK_URL = os.getenv("CORE_CALLBACK_URL", f"{CONFIG_URL}/internal/cases/complete")
INTERNAL_API_KEY = os.getenv("INTERNAL_API_KEY", "")
SERVICE_NAME = "flowable-adapter"
TRACKER_URL = f"{CONFIG_URL}/internal/requests/track"
FLOWABLE_STEPS = (
    {"service_id": "isoftpull",  "raw_key": "isoRawBody",  "status_key": "iso_status",         "request_key": None,                    "skip_key": "skip_isoftpull",  "reason_key": "skip_reason_isoftpull"},
    {"service_id": "creditsafe", "raw_key": "csRawBody",   "status_key": "creditsafe_status",   "request_key": "creditsafe_request_body","skip_key": "skip_creditsafe", "reason_key": "skip_reason_creditsafe"},
    {"service_id": "plaid",      "raw_key": "plaidRawBody","status_key": "plaid_status",        "request_key": "plaid_request_body",    "skip_key": "skip_plaid",      "reason_key": "skip_reason_plaid"},
    {"service_id": "ai-advisor", "raw_key": "aiRawBody",   "status_key": "ai_status",           "request_key": None,                    "skip_key": None,              "reason_key": None},
)
FLOWABLE_VARIABLE_ALIASES = {
    "isoRawBody": ("isoRawResponseBody",),
    "csRawBody": ("csRawResponseBody",),
    "plaidRawBody": ("plaidRawResponseBody",),
    "decisionRawBody": ("decisionRawResponseBody",),
    "aiRawBody": ("aiRawResponseBody",),
}


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
_orchestrate_cache: Dict[str, tuple] = {}
_orchestrate_inflight: Dict[str, asyncio.Future] = {}
_orchestrate_lock = asyncio.Lock()
FLOWABLE_ORCHESTRATE_CACHE_TTL_SECONDS = max(
    60,
    int((os.getenv("FLOWABLE_ORCHESTRATE_CACHE_TTL_SECONDS", "600") or "600").strip()),
)


def _auth():
    return (FLOWABLE_USER, FLOWABLE_PASSWORD)


def _flowable_auth_candidates():
    candidates = []
    seen = set()
    for password in [FLOWABLE_PASSWORD, *FLOWABLE_PASSWORD_FALLBACKS]:
        password = (password or "").strip()
        if not password:
            continue
        candidate = (FLOWABLE_USER, password)
        if candidate in seen:
            continue
        seen.add(candidate)
        candidates.append(candidate)
    return candidates or [(FLOWABLE_USER, "test")]


async def _flowable_request(method: str, url: str, *, timeout: float = 15.0, retry_attempts: int = 3, **kwargs):
    last_response = None
    last_error = None
    auth_candidates = _flowable_auth_candidates()

    for attempt in range(retry_attempts):
        for index, auth in enumerate(auth_candidates):
            try:
                async with httpx.AsyncClient(timeout=timeout) as client:
                    response = await client.request(method, url, auth=auth, **kwargs)
            except Exception as exc:
                last_error = exc
                break

            if response.status_code == 401 and index < len(auth_candidates) - 1:
                last_response = response
                continue

            if index > 0 and response.status_code < 400:
                log.warning("Flowable auth fallback credential accepted")

            if response.status_code >= 500 and attempt < retry_attempts - 1:
                last_response = response
                break

            return response

        if attempt < retry_attempts - 1:
            await asyncio.sleep(min(1.5 * (attempt + 1), 3.0))

    if last_response is not None:
        return last_response
    raise last_error or RuntimeError("flowable request failed without response")


def _flowable_health_url(flowable_url: str) -> str:
    base = (flowable_url or "").rstrip("/")
    if base.endswith("/service"):
        base = base[:-len("/service")]
    return f"{base}/actuator/health"


async def _wait_for_flowable_ready(flowable_url: str, cid: str = ""):
    health_url = _flowable_health_url(flowable_url)
    attempts = max(1, int(FLOWABLE_READY_TIMEOUT_SECONDS / FLOWABLE_READY_POLL_SECONDS))
    last_error = ""
    for attempt in range(attempts):
        try:
            response = await _flowable_request(
                "GET",
                health_url,
                timeout=10.0,
                retry_attempts=1,
            )
            if response.status_code < 400:
                return
            last_error = f"health returned {response.status_code}"
        except Exception as exc:
            last_error = str(exc)
        if attempt < attempts - 1:
            await asyncio.sleep(FLOWABLE_READY_POLL_SECONDS)
    raise RuntimeError(f"Flowable is not ready: {last_error or 'healthcheck failed'}")


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


def _canonicalize_flowable_variables(process_variables: Dict[str, Any]) -> Dict[str, Any]:
    normalized = {
        str(key): _parse_jsonish(value)
        for key, value in (process_variables or {}).items()
    }
    for canonical_key, aliases in FLOWABLE_VARIABLE_ALIASES.items():
        current_value = normalized.get(canonical_key)
        if current_value not in (None, "", {}, []):
            continue
        for alias in aliases:
            alias_value = normalized.get(alias)
            if alias_value in (None, "", {}, []):
                continue
            normalized[canonical_key] = alias_value
            break
    return normalized


def _provider_key(value: Any) -> str:
    normalized = str(value or "").strip().lower()
    aliases = {
        "isoftpull": "isoftpull",
        "creditsafe": "creditsafe",
        "plaid": "plaid",
    }
    return aliases.get(normalized, normalized)


def _report_rank(report: Dict[str, Any]) -> tuple[str, str, str]:
    return (
        str(report.get("completedAt") or ""),
        str(report.get("requestedAt") or ""),
        str(report.get("updatedAt") or ""),
    )


def _reports_by_provider(payload: Any) -> Dict[str, Any]:
    if not isinstance(payload, list):
        return {}
    reports: Dict[str, Any] = {}
    for item in payload:
        if not isinstance(item, dict):
            continue
        provider_key = _provider_key(
            item.get("service")
            or item.get("provider")
            or item.get("providerName")
            or item.get("providerCode")
            or item.get("provider_code")
        )
        if not provider_key:
            continue
        report_payload = dict(item)
        report_payload.setdefault("service", provider_key)
        existing = reports.get(provider_key)
        if isinstance(existing, dict) and _report_rank(existing) >= _report_rank(report_payload):
            continue
        reports[provider_key] = report_payload
    return reports


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
    process_variables = _canonicalize_flowable_variables(process_variables)
    raw_map = {
        "isoftpull": ("isoRawBody", "iso_status"),
        "creditsafe": ("csRawBody", "creditsafe_status"),
        "plaid": ("plaidRawBody", "plaid_status"),
        "ai-advisor": ("aiRawBody", "ai_status"),
    }
    steps = {}
    for service_id, (raw_key, status_key) in raw_map.items():
        raw_value = _parse_jsonish(process_variables.get(raw_key, {}))
        if isinstance(raw_value, dict) and raw_value:
            step_payload = dict(raw_value)
            step_payload.setdefault("service", service_id)
            step_payload.setdefault("status", process_variables.get(status_key, "UNKNOWN"))
            steps[service_id] = step_payload
        else:
            steps[service_id] = {"service": service_id, "status": process_variables.get(status_key, "UNAVAILABLE")}
    return steps


def _merge_step_payloads(runtime_steps: Dict[str, Any], embedded_steps: Any):
    merged = dict(runtime_steps or {})
    if isinstance(embedded_steps, dict):
        for service_id, payload in embedded_steps.items():
            if isinstance(payload, dict):
                existing = merged.get(service_id)
                merged[service_id] = {**existing, **payload} if isinstance(existing, dict) else payload
            elif service_id not in merged:
                merged[service_id] = payload
    return merged


async def _external_credit_reports(external_applicant_id: str, cid: str = "") -> Dict[str, Any]:
    applicant_id = str(external_applicant_id or "").strip()
    if not applicant_id:
        return {}

    service = await _acfg("/api/v1/services/credit-backend")
    base_url = str(service.get("base_url") or "").rstrip("/")
    if not base_url:
        return {}

    timeout = max(5.0, float(service.get("timeout_ms", 15000)) / 1000)
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.get(
                f"{base_url}/api/v1/applicants/{applicant_id}/credit-reports",
                headers={"X-Correlation-ID": cid} if cid else {},
            )
        if response.status_code >= 400:
            return {}
        return _reports_by_provider(response.json() if response.content else [])
    except Exception:
        return {}


def _copy_jsonish(value: Any):
    return copy.deepcopy(value)


def _read_orchestrate_cache(request_id: str):
    cached = _orchestrate_cache.get(request_id)
    if not cached:
        return None
    value, expires_at = cached
    if time.time() >= expires_at:
        _orchestrate_cache.pop(request_id, None)
        return None
    return _copy_jsonish(value)


def _write_orchestrate_cache(request_id: str, result: Dict[str, Any]):
    _orchestrate_cache[request_id] = (_copy_jsonish(result), time.time() + FLOWABLE_ORCHESTRATE_CACHE_TTL_SECONDS)


def _ensure_flowable_decision_payload(result_payload: Dict[str, Any]):
    payload = dict(result_payload or {})
    summary = payload.get("summary") if isinstance(payload.get("summary"), dict) else {}
    if payload.get("decision"):
        return payload

    status = str(payload.get("status") or "").upper()
    source = str(payload.get("decision_source") or "").strip()
    inferred = None
    if source == "decision-service":
        if status == "REJECTED":
            inferred = "REJECTED"
        elif status == "COMPLETED":
            inferred = "APPROVED"
        elif status == "REVIEW":
            inferred = "PASS TO CUSTOM"
    else:
        if status == "REJECTED":
            inferred = "REJECTED"
        elif status in {"COMPLETED", "REVIEW"}:
            inferred = "PASS TO CUSTOM"

    if not inferred:
        return payload

    payload["decision"] = inferred
    if summary and not summary.get("decision"):
        summary["decision"] = inferred
        payload["summary"] = summary

    if not source:
        payload["decision_source"] = "flowable-fallback"
        if summary and not summary.get("decision_source"):
            summary["decision_source"] = "flowable-fallback"
            payload["summary"] = summary

    if inferred == "PASS TO CUSTOM" and not payload.get("decision_reason"):
        payload["decision_reason"] = "Flowable completed without a decision result"
        if summary and not summary.get("decision_reason"):
            summary["decision_reason"] = payload["decision_reason"]
            payload["summary"] = summary
    return payload


def _track_task(task: asyncio.Task):
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)


def _extract_summary(process_variables: Dict[str, Any]):
    result = _extract_decision_payload(process_variables)
    if isinstance(result, dict):
        return result.get("summary", result)
    return result


def _extract_decision_payload(process_variables: Dict[str, Any]):
    process_variables = _canonicalize_flowable_variables(process_variables)
    orchestration_result = _parse_jsonish(process_variables.get("orchestration_result", {}))
    if isinstance(orchestration_result, dict) and orchestration_result:
        return orchestration_result
    decision_raw = _parse_jsonish(process_variables.get("decisionRawBody", {}))
    if isinstance(decision_raw, dict):
        return decision_raw
    return {}


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


async def _pipeline_skip_flags(connector_urls: Dict[str, str]):
    steps = (await _acfg("/api/v1/pipeline-steps?pipeline_name=default")).get("items", [])
    step_map = {step.get("service_id"): step for step in steps if step.get("service_id")}
    flags = {}
    reasons = {}
    policies = {}
    for step in FLOWABLE_STEPS:
        service_id = step["service_id"]
        policy = _resolve_skip_policy(step_map.get(service_id), "flowable")
        if not policy["skip"] and not connector_urls.get(service_id):
            policy = {
                "skip": True,
                "reason": "service disabled or connector url unavailable",
                "source": "service",
            }
        flags[service_id] = policy["skip"]
        reasons[service_id] = policy["reason"]
        policies[service_id] = policy
    return steps, flags, reasons, policies


async def _load_completed_variables(flowable_url: str, instance_id: str) -> Optional[Dict[str, Any]]:
    history = await _flowable_request(
        "GET",
        f"{flowable_url}/history/historic-process-instances",
        timeout=10.0,
        retry_attempts=2,
        params={"processInstanceId": instance_id, "includeProcessVariables": "true"},
    )
    if history.status_code != 200:
        return None
    history_payload = history.json() if history.content else {}
    items = history_payload.get("data", []) if isinstance(history_payload, dict) else []
    historic = items[0] if items else {}
    if not historic.get("endTime"):
        return None
    variables = historic.get("variables") or historic.get("processVariables") or []
    if variables:
        return _canonicalize_flowable_variables({item["name"]: item.get("value") for item in variables if item.get("name")})

    variables_response = await _flowable_request(
        "GET",
        f"{flowable_url}/history/historic-variable-instances",
        timeout=10.0,
        retry_attempts=2,
        params={"processInstanceId": instance_id},
    )
    if variables_response.status_code != 200:
        return {}
    variable_payload = variables_response.json() if variables_response.content else {}
    variable_items = variable_payload.get("data", []) if isinstance(variable_payload, dict) else []
    normalized = {}
    for item in variable_items:
        variable = item.get("variable") if isinstance(item, dict) else None
        if isinstance(variable, dict) and variable.get("name"):
            normalized[variable["name"]] = variable.get("value")
        elif isinstance(item, dict) and item.get("name"):
            normalized[item["name"]] = item.get("value")
    return _canonicalize_flowable_variables(normalized)


async def _load_runtime_snapshot(flowable_url: str, instance_id: str) -> Dict[str, Any]:
    runtime_response = await _flowable_request(
        "GET",
        f"{flowable_url}/runtime/process-instances/{instance_id}",
        timeout=10.0,
        retry_attempts=2,
    )
    historic_response = await _flowable_request(
        "GET",
        f"{flowable_url}/history/historic-process-instances/{instance_id}",
        timeout=10.0,
        retry_attempts=2,
    )
    jobs_response = await _flowable_request(
        "GET",
        f"{flowable_url}/management/jobs",
        timeout=10.0,
        retry_attempts=2,
        params={"processInstanceId": instance_id},
    )

    runtime = runtime_response.json() if runtime_response.status_code == 200 else {}
    historic = historic_response.json() if historic_response.status_code == 200 else {}
    jobs_payload = jobs_response.json() if jobs_response.status_code == 200 else {}
    jobs = jobs_payload.get("data", []) if isinstance(jobs_payload, dict) else []

    current_activity = ""
    if isinstance(runtime, dict):
        current_activity = runtime.get("activityId") or runtime.get("activityName") or ""
    if not current_activity and isinstance(historic, dict):
        current_activity = historic.get("endActivityId") or ""

    failed_jobs = [
        job for job in jobs
        if isinstance(job, dict) and (job.get("exceptionMessage") or job.get("exceptionStacktrace"))
    ]

    return {
        "runtime": runtime if isinstance(runtime, dict) else {},
        "historic": historic if isinstance(historic, dict) else {},
        "job_count": len(jobs),
        "failed_jobs": len(failed_jobs),
        "current_activity": current_activity or "-",
        "end_time": historic.get("endTime") if isinstance(historic, dict) else None,
    }


def _build_watch_timeout_result(request_id: str, instance_id: str, snapshot: Dict[str, Any]) -> Dict[str, Any]:
    current_activity = str(snapshot.get("current_activity") or "-")
    failed_jobs = int(snapshot.get("failed_jobs") or 0)
    job_count = int(snapshot.get("job_count") or 0)
    if failed_jobs > 0:
        decision_reason = f"Flowable stalled with {failed_jobs} failed job(s)"
    elif current_activity and current_activity != "-":
        decision_reason = f"Flowable did not finish before timeout at activity {current_activity}"
    else:
        decision_reason = "Flowable did not finish before timeout"

    summary = {
        "request_id": request_id,
        "route_mode": "FLOWABLE",
        "decision_source": "flowable_watchdog",
        "decision_reason": decision_reason,
        "engine_status": "RUNNING" if snapshot.get("runtime") else "UNKNOWN",
        "current_activity": current_activity,
        "failed_jobs": failed_jobs,
        "job_count": job_count,
    }
    return {
        "status": "ENGINE_ERROR",
        "adapter": "flowable",
        "request_id": request_id,
        "decision_reason": decision_reason,
        "error": decision_reason,
        "engine": {
            "engine": "flowable",
            "started": True,
            "instance_id": instance_id,
            "completed": False,
            "timed_out": True,
            "current_activity": current_activity,
            "failed_jobs": failed_jobs,
            "job_count": job_count,
        },
        "summary": summary,
    }


async def _build_result_payload(body: "RequestIn", instance_id: str, process_variables: Dict[str, Any], connector_urls: Dict[str, str], cid: str):
    process_variables = _canonicalize_flowable_variables(process_variables)
    runtime_steps = _build_steps(process_variables)
    decision_payload = _extract_decision_payload(process_variables)
    steps = _merge_step_payloads(runtime_steps, decision_payload.get("steps"))
    request_context = decision_payload.get("request_context") if isinstance(decision_payload.get("request_context"), dict) else {
        "request_id": body.request_id,
        "route_mode": "FLOWABLE",
        "external_applicant_id": body.external_applicant_id or "",
    }
    unified_reports = await _external_credit_reports(
        request_context.get("external_applicant_id") or body.external_applicant_id or "",
        cid,
    )
    if unified_reports:
        steps = _merge_step_payloads(steps, unified_reports)
    embedded_parsed_report = decision_payload.get("parsed_report") if isinstance(decision_payload.get("parsed_report"), dict) else None
    parsed_report = await _parsed_report(body.request_id, steps, cid) if steps else embedded_parsed_report
    if not isinstance(parsed_report, dict) or parsed_report.get("status") in {"PARSER_ERROR", "PARSER_UNAVAILABLE", "PARSER_NOT_CONFIGURED"}:
        parsed_report = embedded_parsed_report or parsed_report

    decision_summary = decision_payload.get("summary") if isinstance(decision_payload.get("summary"), dict) else {}
    parsed_summary = parsed_report.get("summary") if isinstance(parsed_report, dict) and isinstance(parsed_report.get("summary"), dict) else {}
    summary = {**decision_summary, **parsed_summary} if (decision_summary or parsed_summary) else {}
    if not summary:
        summary = _extract_summary(process_variables)
    for key in ("decision", "decision_reason", "decision_source", "matched_rule"):
        if decision_payload.get(key) is not None and key not in summary:
            summary[key] = decision_payload.get(key)
    external_reports = _merge_step_payloads(runtime_steps, decision_payload.get("external_reports"))
    if unified_reports:
        external_reports = _merge_step_payloads(external_reports, unified_reports)
    if not external_reports:
        external_reports = steps
    step_statuses = decision_payload.get("step_statuses") if isinstance(decision_payload.get("step_statuses"), dict) else {
        service_id: payload.get("status", "UNKNOWN") if isinstance(payload, dict) else "UNKNOWN"
        for service_id, payload in steps.items()
    }
    result = {
        "status": decision_payload.get("status", "COMPLETED"),
        "adapter": "flowable",
        "request_id": body.request_id,
        "external_applicant_id": body.external_applicant_id or "",
        "decision": decision_payload.get("decision"),
        "decision_reason": decision_payload.get("decision_reason"),
        "decision_source": decision_payload.get("decision_source"),
        "matched_rule": decision_payload.get("matched_rule"),
        "engine": {"engine": "flowable", "started": True, "instance_id": instance_id, "completed": True},
        "connector_urls_injected": connector_urls,
        "process_variables": {key: _parse_jsonish(value) for key, value in process_variables.items()},
        "steps": steps,
        "external_reports": external_reports,
        "step_statuses": step_statuses,
        "request_context": request_context,
        "parsed_report": parsed_report,
        "summary": summary,
    }
    return _ensure_flowable_decision_payload(result)


async def _emit_flowable_trace(body: "RequestIn", process_variables: Dict[str, Any], parsed_report: Dict[str, Any], cid: str):
    process_variables = _canonicalize_flowable_variables(process_variables)
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
                "external_applicant_id": body.external_applicant_id or "",
                "product_type": body.product_type,
                "applicant": body.applicant or (body.payload.get("applicant", {}) if isinstance(body.payload, dict) else {}),
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
    decision_payload = _extract_decision_payload(process_variables)
    if isinstance(decision_payload, dict) and decision_payload:
        await _track(
            body.request_id,
            "decision",
            "IN",
            "Decision service response",
            cid=cid,
            service_id="decision-service",
            status=decision_payload.get("status", "OK"),
            payload=decision_payload,
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
    iterations = max(1, int(FLOWABLE_WATCH_TIMEOUT_SECONDS / FLOWABLE_WATCH_POLL_SECONDS))
    for _ in range(iterations):
        await asyncio.sleep(FLOWABLE_WATCH_POLL_SECONDS)
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

    try:
        snapshot = await _load_runtime_snapshot(flowable_url, instance_id)
    except Exception as exc:
        snapshot = {
            "current_activity": "-",
            "failed_jobs": 0,
            "job_count": 0,
            "runtime": {},
            "historic": {},
            "watch_error": str(exc),
        }

    result = _build_watch_timeout_result(body.request_id, instance_id, snapshot)
    await _track(
        body.request_id,
        "flowable",
        "IN",
        "Flowable completion timed out",
        cid=cid,
        service_id="flowable-rest",
        status="ENGINE_ERROR",
        payload={
            "instance_id": instance_id,
            "flowable_url": flowable_url,
            "watch_timeout_seconds": FLOWABLE_WATCH_TIMEOUT_SECONDS,
            **snapshot,
        },
    )
    try:
        await _notify_core(body.request_id, result, cid)
    except Exception as exc:
        log.error(f"[{cid}] timeout callback failed for {body.request_id}: {exc}")
        return

    log.error(
        f"[{cid}] flowable instance {instance_id} did not finish within "
        f"{FLOWABLE_WATCH_TIMEOUT_SECONDS}s; finalized as ENGINE_ERROR"
    )


def _build_flowable_start_context(
    body: "RequestIn",
    *,
    process_key: str,
    flowable_url: str,
    flowable_connector_urls: Dict[str, str],
    decision_service_url: str,
    ai_advisor_url: str = "",
    pipeline_steps: Any,
    skip_flags: Dict[str, bool],
    skip_reasons: Dict[str, str],
    skip_policies: Dict[str, Dict[str, Any]],
):
    variables = [
        {"name": "request_id", "value": body.request_id},
        {"name": "customer_id", "value": body.customer_id},
        {"name": "iin", "value": body.iin},
        {"name": "external_applicant_id", "value": body.external_applicant_id or ""},
        {"name": "product_type", "value": body.product_type},
        {"name": "route_mode", "value": "FLOWABLE"},
    ]
    applicant_payload = body.applicant or (body.payload.get("applicant", {}) if isinstance(body.payload, dict) else {})
    variables.append({"name": "applicant_json", "value": json.dumps(applicant_payload or {})})
    for service_id, url in flowable_connector_urls.items():
        variables.append({"name": f"{service_id}_url", "value": url})
    variables.append({"name": "decision_service_url", "value": decision_service_url})
    variables.append({"name": "ai_advisor_url", "value": ai_advisor_url})
    for service_id, skip in skip_flags.items():
        variables.append({"name": f"skip_{service_id}", "value": skip})
    for service_id, reason in skip_reasons.items():
        variables.append({"name": f"skip_reason_{service_id}", "value": reason})

    tracker_payload = {
        "process_key": process_key,
        "flowable_url": flowable_url,
        "connector_urls": flowable_connector_urls,
        "decision_service_url": decision_service_url,
        "ai_advisor_url": ai_advisor_url,
        "skip_flags": skip_flags,
        "skip_policies": skip_policies,
        "pipeline_steps": pipeline_steps,
    }
    return variables, tracker_payload


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
            with open(BPMN_PATH, "rb") as bpm_file:
                response = await _flowable_request(
                    "POST",
                    f"{flowable_url}/repository/deployments",
                    timeout=10.0,
                    retry_attempts=1,
                    files={"file": ("process.bpmn20.xml", bpm_file, "application/xml")},
                    data={"tenantId": ""},
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
    external_applicant_id: str = ""
    product_type: str
    orchestration_mode: str = "flowable"
    applicant: Dict[str, Any] = Field(default_factory=dict)
    payload: Dict[str, Any] = Field(default_factory=dict)


@app.get("/health")
def health():
    return {"status": "ok", "service": SERVICE_NAME}


async def _orchestrate_once(body: RequestIn, cid: str):
    log.info(f"[{cid}] orchestrate {body.request_id}")

    flowable_cfg = await _acfg("/api/v1/services/flowable-rest")
    flowable_url = flowable_cfg.get("base_url", "http://flowable-rest:8080/flowable-rest/service")
    meta = flowable_cfg.get("meta", {})
    process_key = meta.get("process_key", "creditServiceChainOrchestration") if isinstance(meta, dict) else "creditServiceChainOrchestration"
    try:
        await _wait_for_flowable_ready(flowable_url, cid)
    except Exception as exc:
        log.error(f"[{cid}] flowable readiness failed for {body.request_id}: process_key={process_key}, error={exc}")
        await _track(
            body.request_id,
            "flowable",
            "IN",
            "Flowable engine not ready",
            cid=cid,
            service_id="flowable-rest",
            status="ENGINE_UNREACHABLE",
            payload={
                "process_key": process_key,
                "flowable_url": flowable_url,
                "error": str(exc),
            },
        )
        return {
            "status": "ENGINE_UNREACHABLE",
            "adapter": "flowable",
            "request_id": body.request_id,
            "error": str(exc),
            "process_key": process_key,
            "flowable_url": flowable_url,
        }
    connector_urls = await _acfg("/api/v1/connector-urls") or {}
    flowable_connector_urls = {
        step["service_id"]: connector_urls.get(step["service_id"])
        for step in FLOWABLE_STEPS
        if connector_urls.get(step["service_id"])
    }
    decision_service = await _acfg("/api/v1/services/decision-service")
    decision_service_url = ""
    if decision_service.get("base_url"):
        decision_service_url = f"{decision_service.get('base_url')}{decision_service.get('endpoint_path', '/api/v1/decide')}"
    ai_advisor_service = await _acfg("/api/v1/services/ai-advisor")
    ai_advisor_url = ""
    if ai_advisor_service.get("base_url") and ai_advisor_service.get("enabled", True):
        ai_advisor_url = f"{ai_advisor_service.get('base_url')}{ai_advisor_service.get('endpoint_path', '/api/v1/assess')}"
    pipeline_steps, skip_flags, skip_reasons, skip_policies = await _pipeline_skip_flags(flowable_connector_urls)
    variables, tracker_payload = _build_flowable_start_context(
        body,
        process_key=process_key,
        flowable_url=flowable_url,
        flowable_connector_urls=flowable_connector_urls,
        decision_service_url=decision_service_url,
        ai_advisor_url=ai_advisor_url,
        pipeline_steps=pipeline_steps,
        skip_flags=skip_flags,
        skip_reasons=skip_reasons,
        skip_policies=skip_policies,
    )

    await _track(
        body.request_id,
        "flowable",
        "OUT",
        "Flowable start requested",
        cid=cid,
        service_id="flowable-rest",
        status="SUBMITTED",
        payload=tracker_payload,
    )

    try:
        response = await _flowable_request(
            "POST",
            f"{flowable_url}/runtime/process-instances",
            timeout=60.0,
            # Starting a process instance is not a safe operation to retry blindly.
            retry_attempts=1,
            json={"processDefinitionKey": process_key, "variables": variables},
            headers={"X-Correlation-ID": cid},
        )
        if response.status_code >= 400:
            response_text = (response.text or "").strip()
            error_detail = response_text or response.reason_phrase or "empty response body"
            log.error(
                f"[{cid}] flowable start failed for {body.request_id}: "
                f"status={response.status_code}, process_key={process_key}, detail={error_detail[:300]}"
            )
            await _track(
                body.request_id,
                "flowable",
                "IN",
                "Flowable start failed",
                cid=cid,
                service_id="flowable-rest",
                status="ENGINE_ERROR",
                payload={
                    "status_code": response.status_code,
                    "process_key": process_key,
                    "flowable_url": flowable_url,
                    "error": error_detail,
                },
            )
            return {
                "status": "ENGINE_ERROR",
                "adapter": "flowable",
                "request_id": body.request_id,
                "error": error_detail,
                "status_code": response.status_code,
                "process_key": process_key,
                "flowable_url": flowable_url,
            }
        engine_response = response.json()
    except Exception as exc:
        log.error(f"[{cid}] flowable engine unreachable for {body.request_id}: process_key={process_key}, error={exc}")
        await _track(
            body.request_id,
            "flowable",
            "IN",
            "Flowable engine unreachable",
            cid=cid,
            service_id="flowable-rest",
            status="ENGINE_UNREACHABLE",
            payload={
                "process_key": process_key,
                "flowable_url": flowable_url,
                "error": str(exc),
            },
        )
        return {
            "status": "ENGINE_UNREACHABLE",
            "adapter": "flowable",
            "request_id": body.request_id,
            "error": str(exc),
            "process_key": process_key,
            "flowable_url": flowable_url,
        }

    instance_id = engine_response.get("id")
    await _track(
        body.request_id,
        "flowable",
        "IN",
        "Flowable process started",
        cid=cid,
        service_id="flowable-rest",
        status="STARTED",
        payload={
            "instance_id": instance_id,
            "process_key": process_key,
            "flowable_url": flowable_url,
        },
    )
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
        _track_task(asyncio.create_task(_watch_process_completion(flowable_url, instance_id, body, cid, flowable_connector_urls)))
        return {
            "status": "RUNNING",
            "adapter": "flowable",
            "request_id": body.request_id,
            "external_applicant_id": body.external_applicant_id or "",
            "engine": {"engine": "flowable", "started": True, "instance_id": instance_id, "completed": False},
            "connector_urls_injected": flowable_connector_urls,
            "callback_expected": True,
        }

    result = await _build_result_payload(body, instance_id, process_variables, flowable_connector_urls, cid)
    await _emit_flowable_trace(body, process_variables, result.get("parsed_report", {}), cid)
    return result


@app.post("/orchestrate")
async def orchestrate(body: RequestIn, request: Request):
    cid = request.headers.get("X-Correlation-ID", "")

    async with _orchestrate_lock:
        cached = _read_orchestrate_cache(body.request_id)
        if cached is not None:
            log.info(f"[{cid}] dedupe cache hit for {body.request_id}")
            return cached

        in_flight = _orchestrate_inflight.get(body.request_id)
        if in_flight is None:
            in_flight = asyncio.get_running_loop().create_future()
            _orchestrate_inflight[body.request_id] = in_flight
            owner = True
        else:
            owner = False

    if not owner:
        log.info(f"[{cid}] dedupe waiting on in-flight orchestration for {body.request_id}")
        try:
            result = await asyncio.shield(in_flight)
        except Exception:
            raise
        return _copy_jsonish(result)

    try:
        result = await _orchestrate_once(body, cid)
        _write_orchestrate_cache(body.request_id, result)
        if not in_flight.done():
            in_flight.set_result(_copy_jsonish(result))
        return _copy_jsonish(result)
    except Exception as exc:
        if not in_flight.done():
            in_flight.set_exception(exc)
        raise
    finally:
        async with _orchestrate_lock:
            current = _orchestrate_inflight.get(body.request_id)
            if current is in_flight:
                _orchestrate_inflight.pop(body.request_id, None)
