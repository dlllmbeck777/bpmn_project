import json
import os
from typing import Any, Dict, Optional

import httpx
from fastapi import HTTPException

from coreapi.storage import execute, query, to_json_ready
from shared import check_rate_limit, config_cache, get_correlation_id, get_logger, metrics, resilient_post

API_KEY = os.getenv("GATEWAY_API_KEY", "")
ADMIN_API_KEY = os.getenv("ADMIN_API_KEY", API_KEY)
SENIOR_ANALYST_API_KEY = os.getenv("SENIOR_ANALYST_API_KEY", ADMIN_API_KEY)
ANALYST_API_KEY = os.getenv("ANALYST_API_KEY", SENIOR_ANALYST_API_KEY)
INTERNAL_API_KEY = os.getenv("INTERNAL_API_KEY", "")
ADMIN_LOGIN_USERNAME = os.getenv("ADMIN_LOGIN_USERNAME", "admin")
ADMIN_LOGIN_PASSWORD = os.getenv("ADMIN_LOGIN_PASSWORD", "admin")
SENIOR_ANALYST_LOGIN_USERNAME = os.getenv("SENIOR_ANALYST_LOGIN_USERNAME", "senior")
SENIOR_ANALYST_LOGIN_PASSWORD = os.getenv("SENIOR_ANALYST_LOGIN_PASSWORD", "senior")
ANALYST_LOGIN_USERNAME = os.getenv("ANALYST_LOGIN_USERNAME", "analyst")
ANALYST_LOGIN_PASSWORD = os.getenv("ANALYST_LOGIN_PASSWORD", "analyst")
RATE_LIMIT = int(os.getenv("RATE_LIMIT_PER_MIN", "120"))
SERVICE_NAME = "core-api"
log = get_logger(SERVICE_NAME)

ROLE_ANALYST = "analyst"
ROLE_SENIOR_ANALYST = "senior_analyst"
ROLE_ADMIN = "admin"
ROLE_LEVELS = {
    ROLE_ANALYST: 1,
    ROLE_SENIOR_ANALYST: 2,
    ROLE_ADMIN: 3,
}
ROLE_HEADERS = {
    "analyst": ROLE_ANALYST,
    "senior_analyst": ROLE_SENIOR_ANALYST,
    "senior-analyst": ROLE_SENIOR_ANALYST,
    "senior analyst": ROLE_SENIOR_ANALYST,
    "admin": ROLE_ADMIN,
}


def require_gateway_auth(key: str):
    if API_KEY and key != API_KEY:
        metrics.inc("auth_failures", 'scope="gateway"')
        raise HTTPException(401, "invalid api key")


def require_admin_auth(key: str):
    if ADMIN_API_KEY and key != ADMIN_API_KEY:
        metrics.inc("auth_failures", 'scope="admin"')
        raise HTTPException(401, "invalid admin api key")


def require_internal_auth(key: str):
    if INTERNAL_API_KEY and key != INTERNAL_API_KEY:
        metrics.inc("auth_failures", 'scope="internal"')
        raise HTTPException(401, "invalid internal api key")


def authenticate_ui_login(username: str, password: str):
    username = (username or "").strip()
    password = password or ""
    profiles = [
        (ROLE_ADMIN, ADMIN_LOGIN_USERNAME, ADMIN_LOGIN_PASSWORD, ADMIN_API_KEY),
        (ROLE_SENIOR_ANALYST, SENIOR_ANALYST_LOGIN_USERNAME, SENIOR_ANALYST_LOGIN_PASSWORD, SENIOR_ANALYST_API_KEY),
        (ROLE_ANALYST, ANALYST_LOGIN_USERNAME, ANALYST_LOGIN_PASSWORD, ANALYST_API_KEY),
    ]
    for role, expected_username, expected_password, api_key in profiles:
        if username == expected_username and password == expected_password:
            metrics.inc("auth_logins", f'role="{role}"')
            return {"status": "ok", "username": expected_username, "role": role, "api_key": api_key or ""}
    metrics.inc("auth_failures", 'scope="ui-login"')
    raise HTTPException(401, "invalid username or password")


def normalize_role(role: str) -> str:
    normalized = (role or "").strip().lower()
    return ROLE_HEADERS.get(normalized, normalized if normalized in ROLE_LEVELS else ROLE_ANALYST)


def _has_any_role_keys() -> bool:
    return any([ADMIN_API_KEY, SENIOR_ANALYST_API_KEY, ANALYST_API_KEY])


def _role_key_matches(role: str, key: str, include_fallback: bool = True) -> bool:
    key = (key or "").strip()
    direct = {
        ROLE_ADMIN: [ADMIN_API_KEY],
        ROLE_SENIOR_ANALYST: [SENIOR_ANALYST_API_KEY],
        ROLE_ANALYST: [ANALYST_API_KEY],
    }
    fallback = {
        ROLE_ADMIN: [],
        ROLE_SENIOR_ANALYST: [ADMIN_API_KEY],
        ROLE_ANALYST: [SENIOR_ANALYST_API_KEY, ADMIN_API_KEY],
    }
    candidates = [candidate for candidate in direct.get(role, []) if candidate]
    if include_fallback:
        candidates.extend([candidate for candidate in fallback.get(role, []) if candidate])
    return key in candidates if key else not _has_any_role_keys()


def resolve_ui_role(key: str, requested_role: str = "") -> str:
    normalized_role = normalize_role(requested_role)
    key = (key or "").strip()
    if not _has_any_role_keys():
        return normalized_role or ROLE_ADMIN
    if normalized_role and _role_key_matches(normalized_role, key, include_fallback=True):
        return normalized_role
    if requested_role:
        metrics.inc("auth_failures", f'scope="ui",role="{normalized_role}"')
        raise HTTPException(401, "invalid api key for selected role")
    for role in (ROLE_ADMIN, ROLE_SENIOR_ANALYST, ROLE_ANALYST):
        if _role_key_matches(role, key, include_fallback=False):
            return role
    metrics.inc("auth_failures", 'scope="ui"')
    raise HTTPException(401, "invalid ui api key")


def require_min_role(key: str, requested_role: str, minimum_role: str) -> str:
    actual_role = resolve_ui_role(key, requested_role)
    if ROLE_LEVELS[actual_role] < ROLE_LEVELS[minimum_role]:
        raise HTTPException(403, f"{minimum_role} role required")
    return actual_role


def authorize_request_view(key: str, requested_role: str) -> str:
    key = (key or "").strip()
    if API_KEY and key == API_KEY:
        return "gateway"
    return require_min_role(key, requested_role, ROLE_ANALYST)


def apply_rate_limit(ip: str):
    if not check_rate_limit(f"ip:{ip}", RATE_LIMIT, window_seconds=60):
        raise HTTPException(429, "rate limit exceeded")


def resolve_mode(data: Dict[str, Any]) -> str:
    mode = data.get("orchestration_mode", "auto")
    if mode not in ("auto", ""):
        return mode
    for rule in query("SELECT * FROM routing_rules WHERE enabled=TRUE ORDER BY priority"):
        value = str(data.get(rule["condition_field"], ""))
        matched = {
            "eq": value == rule["condition_value"],
            "neq": value != rule["condition_value"],
            "contains": rule["condition_value"] in value,
        }.get(rule["condition_op"], False)
        if matched:
            return rule["target_mode"]
    return "flowable"


async def run_stop_factor_check(stage: str, data: Dict[str, Any], cid: str):
    service = to_json_ready(query("SELECT * FROM services WHERE id=%s", ("stop-factor",), "one")) or {}
    base_url = service.get("base_url", "")
    if not base_url:
        return {"decision": "PASS", "reason": "stop-factor service not configured"}

    result = await resilient_post(
        "stop-factor",
        f"{base_url}{service.get('endpoint_path', '/api/v1/check')}",
        {"stage": stage, "data": data},
        timeout=service.get("timeout_ms", 10000) / 1000,
        max_retries=service.get("retry_count", 2),
        cid=cid,
    )
    if result.get("status") in ("CIRCUIT_OPEN", "UNAVAILABLE"):
        return {"decision": "PASS", "reason": "stop-factor service unavailable"}
    return result or {"decision": "PASS", "reason": "empty stop-factor response"}


def _parse_embedded_json(value: Any):
    if isinstance(value, str):
        stripped = value.strip()
        if stripped.startswith("{") or stripped.startswith("["):
            try:
                return json.loads(stripped)
            except json.JSONDecodeError:
                return value
    return value


def normalize_result_payload(result: Dict[str, Any]):
    normalized = dict(result or {})
    for key, value in list(normalized.items()):
        normalized[key] = _parse_embedded_json(value)
    return normalized


def get_request_context(request_id: str):
    row = query(
        "SELECT request_id, customer_id, product_type, orchestration_mode, correlation_id FROM requests WHERE request_id=%s",
        (request_id,),
        "one",
    ) or {}
    return to_json_ready(row) or {}


async def ensure_parsed_report(request_id: str, result: Dict[str, Any], cid: str):
    normalized = normalize_result_payload(result)
    if normalized.get("parsed_report"):
        return normalized
    if isinstance(normalized.get("steps"), dict) and normalized["steps"].get("parsed_report"):
        normalized["parsed_report"] = normalized["steps"]["parsed_report"]
        return normalized
    if not isinstance(normalized.get("steps"), dict):
        return normalized

    service = to_json_ready(query("SELECT * FROM services WHERE id=%s", ("report-parser",), "one")) or {}
    base_url = service.get("base_url", "")
    if not base_url:
        return normalized

    parsed = await resilient_post(
        "report-parser",
        f"{base_url}{service.get('endpoint_path', '/api/v1/parse')}",
        {"request_id": request_id, "steps": normalized["steps"]},
        timeout=service.get("timeout_ms", 10000) / 1000,
        max_retries=service.get("retry_count", 2),
        cid=cid,
    )
    if parsed.get("status") not in ("CIRCUIT_OPEN", "UNAVAILABLE"):
        normalized["parsed_report"] = parsed
        normalized.setdefault("steps", {})["parsed_report"] = parsed
    return normalized


async def notify_snp(envelope: Dict[str, Any]):
    snp_url = os.getenv("SNP_EXTERNAL_URL", "")
    if not snp_url:
        row = query("SELECT base_url FROM services WHERE id='snp-external'", fetch="one")
        snp_url = (row or {}).get("base_url", "")

    forwarded = False
    response_code = None
    error = None
    if snp_url:
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                response = await client.post(
                    snp_url,
                    json=envelope,
                    headers={"X-Correlation-ID": get_correlation_id()},
                )
            forwarded = response.status_code < 400
            response_code = response.status_code
        except Exception as exc:
            error = str(exc)

    execute(
        "INSERT INTO snp_notifications (request_id,snp_target,forwarded,response_code,error) VALUES (%s,%s,%s,%s,%s)",
        (envelope.get("request_id"), snp_url or "NOT_CONFIGURED", forwarded, response_code, error),
    )
    return {"forwarded": forwarded, "target": snp_url or "NOT_CONFIGURED"}


async def finalize_request(request_id: str, mode: str, result: Dict[str, Any], cid: str, request_data: Optional[Dict[str, Any]] = None):
    normalized_result = await ensure_parsed_report(request_id, result, cid)
    context = dict(request_data or {})
    if not context:
        context = get_request_context(request_id)
    stop_payload = {**context, "result": normalized_result}

    sf_post = await run_stop_factor_check("post", stop_payload, cid)
    final_status = normalized_result.get("status", "COMPLETED")
    if sf_post.get("decision") == "REJECT":
        final_status = "REJECTED"
    elif sf_post.get("decision") == "REVIEW" and final_status == "COMPLETED":
        final_status = "REVIEW"

    execute(
        "UPDATE requests SET status=%s, result=%s, post_stop_factor=%s, updated_at=NOW() WHERE request_id=%s",
        (final_status, json.dumps(normalized_result), json.dumps(sf_post), request_id),
    )

    snp = await notify_snp(
        {
            "request_id": request_id,
            "status": final_status,
            "mode": mode,
            "result": normalized_result,
            "post_stop_factor": sf_post,
        }
    )
    execute("UPDATE requests SET snp_result=%s WHERE request_id=%s", (json.dumps(snp), request_id))
    metrics.inc("requests_completed", f'mode="{mode}",status="{final_status}"')

    return {
        "status": final_status,
        "result": normalized_result,
        "post_stop_factor": sf_post,
        "snp_result": snp,
    }


def get_connector_urls():
    cached = config_cache.get("conn_urls")
    if cached:
        return cached
    rows = query("SELECT id, base_url, endpoint_path FROM services WHERE type='connector' AND enabled=TRUE")
    result = {row["id"]: f"{row['base_url']}{row['endpoint_path']}" for row in rows}
    config_cache.set("conn_urls", result)
    return result
