import json
import os
import time
import threading
from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel

import psycopg2
from fastapi import FastAPI, Header, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware

from coreapi.models import AdminUserCreateIn, AdminUserUpdateIn, ApplicantIn, ApplicantUpdateIn, FlowableActionIn, HealthResponse, ListResponse, LoginIn, LoginResponse, PipelineStepIn, RequestActionIn, RequestIn, RequestNoteIn, RequestResponse, RuleIn, ServiceIn, ServiceOut, StatusResponse, StopFactorIn, TrackerEventIn
from coreapi.services import ROLE_ADMIN, ROLE_ANALYST, ROLE_SENIOR_ANALYST, add_request_note, apply_rate_limit, authenticate_ui_login, authorize_request_view, build_request_view, build_requests_list_query, clone_request_submission, create_admin_user, create_external_applicant, delete_admin_user, delete_external_applicant, ensure_default_ui_users, finalize_request, get_connector_urls, get_external_applicant, get_external_credit_reports, get_external_plaid_link, get_external_plaid_link_status, get_flowable_instance_detail, get_process_model, get_request_detail_view, list_admin_users, list_external_applicants, list_external_credit_providers, list_flowable_instances, list_request_notes, normalize_incoming_request, reconcile_flowable_request, require_gateway_auth, require_internal_auth, require_internal_or_min_role, require_min_role, resolve_mode, retry_request_as_new, retry_request_flowable_jobs, revoke_admin_user_session, retry_flowable_failed_jobs, run_stop_factor_check, set_flowable_instance_state, set_request_ignored, submit_request_payload, terminate_flowable_instance, trigger_external_credit_check, update_admin_user, update_external_applicant
from coreapi.storage import audit, execute, execute_returning, query, to_json_ready, track_request_event
from migrations import run_migrations, seed_defaults
from shared import all_breaker_states, close_pool, config_cache, get_correlation_id, get_conn, get_logger, init_pool, metrics, new_correlation_id, put_conn, resilient_post

PORT = int(os.getenv("CORE_PORT", "8000"))
CORS_ORIGINS = [o.strip() for o in os.getenv("CORS_ORIGINS", "").split(",") if o.strip()]
SERVICE_NAME = "core-api"
log = get_logger(SERVICE_NAME)

INSECURE_ENCRYPT_KEYS = {"change-me-in-production-32chars!", "default-dev-key-change-in-prod!!", ""}


def _config_auth_key(x_api_key: str = "", x_internal_api_key: str = "") -> str:
    """Prefer the internal service key for config reads when present."""
    return (x_internal_api_key or x_api_key or "").strip()


def _validate_config():
    """Fail fast if critical configuration is missing or insecure."""
    errors = []
    warnings = []

    encrypt_key = os.getenv("ENCRYPT_KEY", "")
    if encrypt_key in INSECURE_ENCRYPT_KEYS:
        errors.append("ENCRYPT_KEY must be changed from default value")
    elif len(encrypt_key) < 32:
        errors.append(f"ENCRYPT_KEY must be at least 32 characters (current: {len(encrypt_key)})")

    for var in ("DB_HOST", "DB_NAME", "DB_USER", "DB_PASSWORD"):
        if not os.getenv(var):
            errors.append(f"{var} is not set")

    cors_raw = os.getenv("CORS_ORIGINS", "")
    if not cors_raw or cors_raw.strip() == "*":
        warnings.append("CORS_ORIGINS is empty or '*' — all origins allowed; restrict for production")

    if not os.getenv("GATEWAY_API_KEY"):
        warnings.append("GATEWAY_API_KEY is empty — gateway API is open without authentication")
    if not os.getenv("INTERNAL_API_KEY"):
        warnings.append("INTERNAL_API_KEY is empty — internal endpoints are open")

    for w in warnings:
        log.warning(f"CONFIG WARNING: {w}")
    if errors:
        for e in errors:
            log.error(f"CONFIG ERROR: {e}")
        raise RuntimeError(f"Configuration errors: {'; '.join(errors)}")

    log.info("Configuration validated OK")


app = FastAPI(
    title="Credit Platform API",
    version="5.2.0",
    description="""
## Credit check orchestration platform

Central API that combines configuration management, request routing,
stop-factor evaluation, and external service notification.
""",
    openapi_tags=[
        {"name": "Health", "description": "System health and metrics"},
        {"name": "Requests", "description": "Credit check request lifecycle"},
        {"name": "Services", "description": "Service registry"},
        {"name": "Routing Rules", "description": "Dynamic routing"},
        {"name": "Stop Factors", "description": "Pre/post checks"},
        {"name": "Pipeline", "description": "Connector execution order"},
        {"name": "Audit", "description": "Configuration change history"},
        {"name": "SNP", "description": "External SNP notifications"},
        {"name": "Auth", "description": "Admin UI login"},
        {"name": "Users", "description": "Admin user access management"},
        {"name": "Process Tracker", "description": "Request step timeline and in/out payloads"},
        {"name": "Flowable Ops", "description": "Operational visibility and controlled actions for Flowable instances"},
    ],
)

# P0-08: CORS — restrict origins, methods, headers (no wildcard in production)
_cors_origins = CORS_ORIGINS if CORS_ORIGINS else ["*"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "X-Api-Key", "X-User-Role", "X-User-Name", "X-Correlation-ID", "X-Internal-Api-Key"],
    allow_credentials=True,
    max_age=3600,
)


@app.middleware("http")
async def body_size_limit(request: Request, call_next):
    """P0-07: Reject oversized request bodies (64KB max)."""
    MAX_BODY = 65536
    cl = request.headers.get("content-length")
    if cl and int(cl) > MAX_BODY:
        return Response(status_code=413, content='{"detail":"Request body too large"}', media_type="application/json")
    return await call_next(request)


@app.middleware("http")
async def correlation_middleware(request: Request, call_next):
    cid = request.headers.get("X-Correlation-ID") or new_correlation_id()
    from shared import correlation_id as cid_var

    cid_var.set(cid)
    start = time.time()
    response = await call_next(request)
    elapsed = time.time() - start
    response.headers["X-Correlation-ID"] = cid
    metrics.observe("http_request_duration_seconds", elapsed, f'path="{request.url.path}"')
    metrics.inc("http_requests_total", f'path="{request.url.path}",status="{response.status_code}"')
    log.info(f"{request.method} {request.url.path} -> {response.status_code} ({elapsed:.3f}s)")
    return response


def _data_retention_worker():
    """P1-05: Periodically clean old data to prevent unbounded table growth."""
    while True:
        time.sleep(3600)  # every hour
        try:
            conn = get_conn()
            cur = conn.cursor()
            # Rate limit buckets older than 2 hours
            cur.execute("DELETE FROM rate_limit_buckets WHERE window_start < %s", (int(time.time()) - 7200,))
            # Tracker events older than 90 days
            cur.execute("DELETE FROM request_tracker_events WHERE created_at < NOW() - INTERVAL '90 days'")
            # SNP notifications older than 90 days
            cur.execute("DELETE FROM snp_notifications WHERE sent_at < NOW() - INTERVAL '90 days'")
            # Audit log older than 365 days
            cur.execute("DELETE FROM audit_log WHERE performed_at < NOW() - INTERVAL '365 days'")
            cur.close()
            put_conn(conn)
            log.info("data retention cleanup completed")
        except Exception as exc:
            log.warning(f"data retention cleanup failed: {exc}")


@app.on_event("startup")
def startup():
    _validate_config()
    init_pool()
    conn = get_conn()
    run_migrations(conn)
    seed_defaults(conn)
    put_conn(conn)
    ensure_default_ui_users()
    # P1-05: Start background cleanup thread
    threading.Thread(target=_data_retention_worker, daemon=True, name="data-retention").start()
    log.info("core-api started (v5.2.0)")


@app.on_event("shutdown")
def shutdown():
    close_pool()


@app.get("/health", response_model=HealthResponse, tags=["Health"])
def health():
    try:
        query("SELECT 1", fetch="scalar")
        db_ok = True
    except Exception:
        db_ok = False
    return {
        "status": "ok" if db_ok else "degraded",
        "service": SERVICE_NAME,
        "db": "connected" if db_ok else "down",
        "circuit_breakers": all_breaker_states(),
    }


@app.get("/metrics", tags=["Health"], response_class=Response)
def prom_metrics():
    return Response(content=metrics.to_prometheus(), media_type="text/plain")


@app.post("/api/v1/applicants", tags=["Requests"])
async def create_applicant(body: ApplicantIn, request: Request, x_api_key: str = Header(default="")):
    require_gateway_auth(x_api_key)
    apply_rate_limit(request.client.host if request.client else "unknown")
    return await create_external_applicant(body.model_dump(exclude_none=True), get_correlation_id())


@app.get("/api/v1/applicants", tags=["Requests"])
async def list_applicants(request: Request, x_api_key: str = Header(default="")):
    require_gateway_auth(x_api_key)
    apply_rate_limit(request.client.host if request.client else "unknown")
    return await list_external_applicants(get_correlation_id())


@app.get("/api/v1/applicants/{applicant_id}", tags=["Requests"])
async def get_applicant(applicant_id: str, request: Request, x_api_key: str = Header(default="")):
    require_gateway_auth(x_api_key)
    apply_rate_limit(request.client.host if request.client else "unknown")
    return await get_external_applicant(applicant_id, get_correlation_id())


@app.put("/api/v1/applicants/{applicant_id}", tags=["Requests"])
async def edit_applicant(applicant_id: str, body: ApplicantUpdateIn, request: Request, x_api_key: str = Header(default="")):
    require_gateway_auth(x_api_key)
    apply_rate_limit(request.client.host if request.client else "unknown")
    return await update_external_applicant(applicant_id, body.model_dump(exclude_none=True), get_correlation_id())


@app.delete("/api/v1/applicants/{applicant_id}", tags=["Requests"])
async def remove_applicant(applicant_id: str, request: Request, x_api_key: str = Header(default="")):
    require_gateway_auth(x_api_key)
    apply_rate_limit(request.client.host if request.client else "unknown")
    return await delete_external_applicant(applicant_id, get_correlation_id())


@app.post("/api/v1/applicants/{applicant_id}/credit-check", tags=["Requests"])
async def run_credit_check(applicant_id: str, request: Request, x_api_key: str = Header(default="")):
    require_gateway_auth(x_api_key)
    apply_rate_limit(request.client.host if request.client else "unknown")
    return await trigger_external_credit_check(applicant_id, cid=get_correlation_id())


@app.post("/api/v1/applicants/{applicant_id}/credit-check/isoftpull", tags=["Requests"])
async def run_isoftpull_credit_check(applicant_id: str, request: Request, x_api_key: str = Header(default="")):
    require_gateway_auth(x_api_key)
    apply_rate_limit(request.client.host if request.client else "unknown")
    return await trigger_external_credit_check(applicant_id, "isoftpull", get_correlation_id())


@app.post("/api/v1/applicants/{applicant_id}/credit-check/creditsafe", tags=["Requests"])
async def run_creditsafe_credit_check(applicant_id: str, request: Request, x_api_key: str = Header(default="")):
    require_gateway_auth(x_api_key)
    apply_rate_limit(request.client.host if request.client else "unknown")
    return await trigger_external_credit_check(applicant_id, "creditsafe", get_correlation_id())


@app.post("/api/v1/applicants/{applicant_id}/credit-check/plaid", tags=["Requests"])
async def run_plaid_credit_check(applicant_id: str, request: Request, x_api_key: str = Header(default="")):
    require_gateway_auth(x_api_key)
    apply_rate_limit(request.client.host if request.client else "unknown")
    return await trigger_external_credit_check(applicant_id, "plaid", get_correlation_id())


@app.get("/api/v1/applicants/{applicant_id}/credit-reports", tags=["Requests"])
async def get_credit_reports(applicant_id: str, request: Request, x_api_key: str = Header(default="")):
    require_gateway_auth(x_api_key)
    apply_rate_limit(request.client.host if request.client else "unknown")
    return await get_external_credit_reports(applicant_id, get_correlation_id())


@app.get("/api/v1/credit-providers", tags=["Requests"])
async def list_credit_providers(request: Request, x_api_key: str = Header(default="")):
    require_gateway_auth(x_api_key)
    apply_rate_limit(request.client.host if request.client else "unknown")
    return await list_external_credit_providers(cid=get_correlation_id())


@app.get("/api/v1/credit-providers/enabled", tags=["Requests"])
async def list_enabled_credit_providers(request: Request, x_api_key: str = Header(default="")):
    require_gateway_auth(x_api_key)
    apply_rate_limit(request.client.host if request.client else "unknown")
    return await list_external_credit_providers("enabled", get_correlation_id())


@app.get("/api/v1/credit-providers/available", tags=["Requests"])
async def list_available_credit_providers(request: Request, x_api_key: str = Header(default="")):
    require_gateway_auth(x_api_key)
    apply_rate_limit(request.client.host if request.client else "unknown")
    return await list_external_credit_providers("available", get_correlation_id())


@app.get("/api/v1/plaid/link/{tracking_id}", tags=["Requests"])
async def get_plaid_link(tracking_id: str, request: Request, x_api_key: str = Header(default="")):
    require_gateway_auth(x_api_key)
    apply_rate_limit(request.client.host if request.client else "unknown")
    return await get_external_plaid_link(tracking_id, get_correlation_id())


@app.get("/api/v1/plaid/link/{tracking_id}/status", tags=["Requests"])
async def get_plaid_link_status(tracking_id: str, request: Request, x_api_key: str = Header(default="")):
    require_gateway_auth(x_api_key)
    apply_rate_limit(request.client.host if request.client else "unknown")
    return await get_external_plaid_link_status(tracking_id, get_correlation_id())


@app.post("/api/v1/auth/login", response_model=LoginResponse, tags=["Auth"])
def login(body: LoginIn, request: Request):
    apply_rate_limit(request.client.host if request.client else "unknown")
    return authenticate_ui_login(body.username, body.password)


@app.get("/api/v1/admin-users", response_model=ListResponse, tags=["Users"])
def get_admin_users(x_api_key: str = Header(default=""), x_user_role: str = Header(default="")):
    require_min_role(x_api_key, x_user_role, ROLE_ADMIN)
    return {"items": list_admin_users()}


@app.post("/api/v1/admin-users", response_model=StatusResponse, status_code=201, tags=["Users"])
def add_admin_user(body: AdminUserCreateIn, x_api_key: str = Header(default=""), x_user_role: str = Header(default=""), x_user_name: str = Header(default="")):
    require_min_role(x_api_key, x_user_role, ROLE_ADMIN)
    created = create_admin_user(body.username, body.display_name, body.role, body.password, body.enabled)
    audit("admin_user", created["username"], "created", created, performed_by=x_user_name)
    return {"status": "created", "id": created["username"]}


@app.put("/api/v1/admin-users/{username}", response_model=StatusResponse, tags=["Users"])
def edit_admin_user(
    username: str,
    body: AdminUserUpdateIn,
    x_api_key: str = Header(default=""),
    x_user_role: str = Header(default=""),
    x_user_name: str = Header(default=""),
):
    require_min_role(x_api_key, x_user_role, ROLE_ADMIN)
    updated = update_admin_user(
        username,
        display_name=body.display_name,
        role=body.role,
        password=body.password,
        enabled=body.enabled,
        actor_username=x_user_name,
    )
    audit("admin_user", updated["username"], "updated", updated, performed_by=x_user_name)
    return {"status": "updated", "id": updated["username"]}


@app.post("/api/v1/admin-users/{username}/revoke-session", response_model=StatusResponse, tags=["Users"])
def revoke_user_session(username: str, x_api_key: str = Header(default=""), x_user_role: str = Header(default=""), x_user_name: str = Header(default="")):
    require_min_role(x_api_key, x_user_role, ROLE_ADMIN)
    updated = revoke_admin_user_session(username)
    audit("admin_user", updated["username"], "session_revoked", updated, performed_by=x_user_name)
    return {"status": "updated", "id": updated["username"]}


@app.delete("/api/v1/admin-users/{username}", response_model=StatusResponse, tags=["Users"])
def remove_admin_user(
    username: str,
    x_api_key: str = Header(default=""),
    x_user_role: str = Header(default=""),
    x_user_name: str = Header(default=""),
):
    require_min_role(x_api_key, x_user_role, ROLE_ADMIN)
    delete_admin_user(username, actor_username=x_user_name)
    audit("admin_user", username, "deleted", {"username": username}, performed_by=x_user_name)
    return {"status": "deleted", "id": username}


@app.get("/api/v1/services", response_model=ListResponse, tags=["Services"])
def list_services(
    type: Optional[str] = Query(None),
    enabled: Optional[bool] = Query(None),
    x_api_key: str = Header(default=""),
    x_user_role: str = Header(default=""),
    x_internal_api_key: str = Header(default=""),
):
    require_internal_or_min_role(_config_auth_key(x_api_key, x_internal_api_key), x_user_role, ROLE_ANALYST)
    cache_key = f"services:{type}:{enabled}"
    cached = config_cache.get(cache_key)
    if cached:
        return cached
    sql = "SELECT * FROM services WHERE TRUE"
    params = []
    if type:
        sql += " AND type=%s"
        params.append(type)
    if enabled is not None:
        sql += " AND enabled=%s"
        params.append(enabled)
    result = {"items": [to_json_ready(row) for row in query(f"{sql} ORDER BY id", params)]}
    config_cache.set(cache_key, result)
    return result


@app.get("/api/v1/services/{sid}", response_model=ServiceOut, tags=["Services"])
def get_service(
    sid: str,
    x_api_key: str = Header(default=""),
    x_user_role: str = Header(default=""),
    x_internal_api_key: str = Header(default=""),
):
    require_internal_or_min_role(_config_auth_key(x_api_key, x_internal_api_key), x_user_role, ROLE_ANALYST)
    cached = config_cache.get(f"svc:{sid}")
    if cached:
        return cached
    row = to_json_ready(query("SELECT * FROM services WHERE id=%s", (sid,), "one"))
    if not row:
        raise HTTPException(404, "Service not found")
    config_cache.set(f"svc:{sid}", row)
    return row


@app.post("/api/v1/services", response_model=StatusResponse, status_code=201, tags=["Services"])
def create_service(body: ServiceIn, x_api_key: str = Header(default=""), x_user_role: str = Header(default=""),  x_user_name: str = Header(default="")):
    require_min_role(x_api_key, x_user_role, ROLE_ADMIN)
    try:
        execute(
            "INSERT INTO services (id,name,type,base_url,health_path,enabled,timeout_ms,retry_count,endpoint_path,meta) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
            (body.id, body.name, body.type, body.base_url, body.health_path, body.enabled, body.timeout_ms, body.retry_count, body.endpoint_path, json.dumps(body.meta)),
        )
    except psycopg2.IntegrityError:
        raise HTTPException(409, "Service ID already exists")
    audit("service", body.id, "created", body.model_dump(), performed_by=x_user_name)
    config_cache.invalidate("svc:")
    config_cache.invalidate("services:")
    config_cache.invalidate("conn_urls")
    return {"status": "created", "id": body.id}


@app.put("/api/v1/services/{sid}", response_model=StatusResponse, tags=["Services"])
def update_service(sid: str, body: ServiceIn, x_api_key: str = Header(default=""), x_user_role: str = Header(default=""),  x_user_name: str = Header(default="")):
    require_min_role(x_api_key, x_user_role, ROLE_ADMIN)
    execute(
        "UPDATE services SET name=%s,type=%s,base_url=%s,health_path=%s,enabled=%s,timeout_ms=%s,retry_count=%s,endpoint_path=%s,meta=%s,updated_at=NOW() WHERE id=%s",
        (body.name, body.type, body.base_url, body.health_path, body.enabled, body.timeout_ms, body.retry_count, body.endpoint_path, json.dumps(body.meta), sid),
    )
    audit("service", sid, "updated", body.model_dump(), performed_by=x_user_name)
    config_cache.invalidate("svc:")
    config_cache.invalidate("services:")
    config_cache.invalidate("conn_urls")
    return {"status": "updated", "id": sid}


@app.delete("/api/v1/services/{sid}", response_model=StatusResponse, tags=["Services"])
def delete_service(sid: str, x_api_key: str = Header(default=""), x_user_role: str = Header(default=""),  x_user_name: str = Header(default="")):
    require_min_role(x_api_key, x_user_role, ROLE_ADMIN)
    execute("DELETE FROM services WHERE id=%s", (sid,))
    audit("service", sid, "deleted", performed_by=x_user_name)
    config_cache.invalidate()
    return {"status": "deleted", "id": sid}


@app.get("/api/v1/routing-rules", response_model=ListResponse, tags=["Routing Rules"])
def list_rules(x_api_key: str = Header(default=""), x_user_role: str = Header(default="")):
    require_min_role(x_api_key, x_user_role, ROLE_ANALYST)
    cached = config_cache.get("rules")
    if cached:
        return cached
    result = {"items": [to_json_ready(row) for row in query("SELECT * FROM routing_rules ORDER BY priority")]}
    config_cache.set("rules", result)
    return result


@app.post("/api/v1/routing-rules", response_model=StatusResponse, status_code=201, tags=["Routing Rules"])
def create_rule(body: RuleIn, x_api_key: str = Header(default=""), x_user_role: str = Header(default=""),  x_user_name: str = Header(default="")):
    require_min_role(x_api_key, x_user_role, ROLE_SENIOR_ANALYST)
    entity_id = execute_returning(
        "INSERT INTO routing_rules (name,priority,condition_field,condition_op,condition_value,target_mode,enabled,meta) VALUES (%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id",
        (body.name, body.priority, body.condition_field, body.condition_op, body.condition_value, body.target_mode, body.enabled, json.dumps(body.meta)),
    )
    audit("routing_rule", entity_id, "created", body.model_dump(), performed_by=x_user_name)
    config_cache.invalidate("rules")
    return {"status": "created", "id": entity_id}


@app.put("/api/v1/routing-rules/{rid}", response_model=StatusResponse, tags=["Routing Rules"])
def update_rule(rid: int, body: RuleIn, x_api_key: str = Header(default=""), x_user_role: str = Header(default=""),  x_user_name: str = Header(default="")):
    require_min_role(x_api_key, x_user_role, ROLE_SENIOR_ANALYST)
    execute(
        "UPDATE routing_rules SET name=%s,priority=%s,condition_field=%s,condition_op=%s,condition_value=%s,target_mode=%s,enabled=%s,meta=%s,updated_at=NOW() WHERE id=%s",
        (body.name, body.priority, body.condition_field, body.condition_op, body.condition_value, body.target_mode, body.enabled, json.dumps(body.meta), rid),
    )
    audit("routing_rule", rid, "updated", body.model_dump(), performed_by=x_user_name)
    config_cache.invalidate("rules")
    return {"status": "updated", "id": rid}


@app.delete("/api/v1/routing-rules/{rid}", response_model=StatusResponse, tags=["Routing Rules"])
def delete_rule(rid: int, x_api_key: str = Header(default=""), x_user_role: str = Header(default=""),  x_user_name: str = Header(default="")):
    require_min_role(x_api_key, x_user_role, ROLE_SENIOR_ANALYST)
    execute("DELETE FROM routing_rules WHERE id=%s", (rid,))
    audit("routing_rule", rid, "deleted", performed_by=x_user_name)
    config_cache.invalidate("rules")
    return {"status": "deleted", "id": rid}


@app.get("/api/v1/stop-factors", response_model=ListResponse, tags=["Stop Factors"])
def list_stop_factors(
    stage: Optional[str] = Query(None),
    x_api_key: str = Header(default=""),
    x_user_role: str = Header(default=""),
    x_internal_api_key: str = Header(default=""),
):
    require_internal_or_min_role(_config_auth_key(x_api_key, x_internal_api_key), x_user_role, ROLE_ANALYST)
    cache_key = f"stops:{stage}"
    cached = config_cache.get(cache_key)
    if cached:
        return cached
    sql = "SELECT * FROM stop_factors WHERE TRUE"
    params = []
    if stage:
        sql += " AND stage=%s"
        params.append(stage)
    result = {"items": [to_json_ready(row) for row in query(f"{sql} ORDER BY priority", params)]}
    config_cache.set(cache_key, result)
    return result


@app.post("/api/v1/stop-factors", response_model=StatusResponse, status_code=201, tags=["Stop Factors"])
def create_stop_factor(body: StopFactorIn, x_api_key: str = Header(default=""), x_user_role: str = Header(default=""),  x_user_name: str = Header(default="")):
    require_min_role(x_api_key, x_user_role, ROLE_SENIOR_ANALYST)
    entity_id = execute_returning(
        "INSERT INTO stop_factors (name,stage,check_type,field_path,operator,threshold,action_on_fail,enabled,priority,meta) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id",
        (body.name, body.stage, body.check_type, body.field_path, body.operator, body.threshold, body.action_on_fail, body.enabled, body.priority, json.dumps(body.meta)),
    )
    audit("stop_factor", entity_id, "created", body.model_dump(), performed_by=x_user_name)
    config_cache.invalidate("stops:")
    return {"status": "created", "id": entity_id}


@app.put("/api/v1/stop-factors/{sfid}", response_model=StatusResponse, tags=["Stop Factors"])
def update_stop_factor(sfid: int, body: StopFactorIn, x_api_key: str = Header(default=""), x_user_role: str = Header(default=""),  x_user_name: str = Header(default="")):
    require_min_role(x_api_key, x_user_role, ROLE_SENIOR_ANALYST)
    execute(
        "UPDATE stop_factors SET name=%s,stage=%s,check_type=%s,field_path=%s,operator=%s,threshold=%s,action_on_fail=%s,enabled=%s,priority=%s,meta=%s,updated_at=NOW() WHERE id=%s",
        (body.name, body.stage, body.check_type, body.field_path, body.operator, body.threshold, body.action_on_fail, body.enabled, body.priority, json.dumps(body.meta), sfid),
    )
    audit("stop_factor", sfid, "updated", body.model_dump(), performed_by=x_user_name)
    config_cache.invalidate("stops:")
    return {"status": "updated", "id": sfid}


@app.delete("/api/v1/stop-factors/{sfid}", response_model=StatusResponse, tags=["Stop Factors"])
def delete_stop_factor(sfid: int, x_api_key: str = Header(default=""), x_user_role: str = Header(default=""),  x_user_name: str = Header(default="")):
    require_min_role(x_api_key, x_user_role, ROLE_SENIOR_ANALYST)
    execute("DELETE FROM stop_factors WHERE id=%s", (sfid,))
    audit("stop_factor", sfid, "deleted", performed_by=x_user_name)
    config_cache.invalidate("stops:")
    return {"status": "deleted", "id": sfid}


@app.get("/api/v1/pipeline-steps", response_model=ListResponse, tags=["Pipeline"])
def list_pipeline_steps(
    pipeline_name: str = Query("default"),
    x_api_key: str = Header(default=""),
    x_user_role: str = Header(default=""),
    x_internal_api_key: str = Header(default=""),
):
    require_internal_or_min_role(_config_auth_key(x_api_key, x_internal_api_key), x_user_role, ROLE_ANALYST)
    cache_key = f"pipeline:{pipeline_name}"
    cached = config_cache.get(cache_key)
    if cached:
        return cached
    rows = query(
        "SELECT ps.*, s.name as service_name, s.base_url, s.endpoint_path FROM pipeline_steps ps LEFT JOIN services s ON ps.service_id=s.id WHERE ps.pipeline_name=%s ORDER BY ps.step_order",
        (pipeline_name,),
    )
    result = {"items": [to_json_ready(row) for row in rows]}
    config_cache.set(cache_key, result)
    return result


@app.post("/api/v1/pipeline-steps", response_model=StatusResponse, status_code=201, tags=["Pipeline"])
def create_pipeline_step(body: PipelineStepIn, x_api_key: str = Header(default=""), x_user_role: str = Header(default=""),  x_user_name: str = Header(default="")):
    require_min_role(x_api_key, x_user_role, ROLE_SENIOR_ANALYST)
    entity_id = execute_returning(
        "INSERT INTO pipeline_steps (pipeline_name,step_order,service_id,enabled,meta) VALUES (%s,%s,%s,%s,%s) RETURNING id",
        (body.pipeline_name, body.step_order, body.service_id, body.enabled, json.dumps(body.meta)),
    )
    audit("pipeline_step", entity_id, "created", body.model_dump(), performed_by=x_user_name)
    config_cache.invalidate("pipeline:")
    return {"status": "created", "id": entity_id}


@app.put("/api/v1/pipeline-steps/{pid}", response_model=StatusResponse, tags=["Pipeline"])
def update_pipeline_step(pid: int, body: PipelineStepIn, x_api_key: str = Header(default=""), x_user_role: str = Header(default=""),  x_user_name: str = Header(default="")):
    require_min_role(x_api_key, x_user_role, ROLE_SENIOR_ANALYST)
    execute(
        "UPDATE pipeline_steps SET pipeline_name=%s,step_order=%s,service_id=%s,enabled=%s,meta=%s,updated_at=NOW() WHERE id=%s",
        (body.pipeline_name, body.step_order, body.service_id, body.enabled, json.dumps(body.meta), pid),
    )
    audit("pipeline_step", pid, "updated", body.model_dump(), performed_by=x_user_name)
    config_cache.invalidate("pipeline:")
    return {"status": "updated", "id": pid}


@app.delete("/api/v1/pipeline-steps/{pid}", response_model=StatusResponse, tags=["Pipeline"])
def delete_pipeline_step(pid: int, x_api_key: str = Header(default=""), x_user_role: str = Header(default=""),  x_user_name: str = Header(default="")):
    require_min_role(x_api_key, x_user_role, ROLE_SENIOR_ANALYST)
    execute("DELETE FROM pipeline_steps WHERE id=%s", (pid,))
    audit("pipeline_step", pid, "deleted", performed_by=x_user_name)
    config_cache.invalidate("pipeline:")
    return {"status": "deleted", "id": pid}


@app.get("/api/v1/audit-log", response_model=ListResponse, tags=["Audit"])
def list_audit(limit: int = Query(50, le=200), x_api_key: str = Header(default=""), x_user_role: str = Header(default="")):
    require_min_role(x_api_key, x_user_role, ROLE_ANALYST)
    return {"items": [to_json_ready(row) for row in query("SELECT * FROM audit_log ORDER BY id DESC LIMIT %s", (limit,))]}


@app.get("/api/v1/process-tracker", response_model=ListResponse, tags=["Process Tracker"])
def list_tracker_events(
    request_id: Optional[str] = Query(None),
    limit: int = Query(200, le=500),
    x_api_key: str = Header(default=""),
    x_user_role: str = Header(default=""),
):
    require_min_role(x_api_key, x_user_role, ROLE_ANALYST)
    sql = "SELECT * FROM request_tracker_events WHERE TRUE"
    params = []
    if request_id:
        sql += " AND request_id=%s"
        params.append(request_id)
    sql += " ORDER BY id DESC LIMIT %s"
    params.append(limit)
    return {"items": [to_json_ready(row) for row in query(sql, params)]}


@app.get("/api/v1/flowable/instances", response_model=ListResponse, tags=["Flowable Ops"])
async def flowable_instances(
    request_id: Optional[str] = Query(None),
    status: str = Query("all"),
    limit: int = Query(50, le=100),
    x_api_key: str = Header(default=""),
    x_user_role: str = Header(default=""),
):
    require_min_role(x_api_key, x_user_role, ROLE_ANALYST)
    return {"items": await list_flowable_instances(limit=limit, request_id=request_id, status=status)}


@app.get("/api/v1/flowable/instances/{instance_id}", tags=["Flowable Ops"])
async def flowable_instance_detail(instance_id: str, x_api_key: str = Header(default=""), x_user_role: str = Header(default="")):
    require_min_role(x_api_key, x_user_role, ROLE_ANALYST)
    return await get_flowable_instance_detail(instance_id)


@app.post("/api/v1/flowable/instances/{instance_id}/suspend", tags=["Flowable Ops"])
async def suspend_flowable_instance(instance_id: str, body: FlowableActionIn, x_api_key: str = Header(default=""), x_user_role: str = Header(default="")):
    role = require_min_role(x_api_key, x_user_role, ROLE_SENIOR_ANALYST)
    return await set_flowable_instance_state(instance_id, "suspend", role, body.reason)


@app.post("/api/v1/flowable/instances/{instance_id}/activate", tags=["Flowable Ops"])
async def activate_flowable_instance(instance_id: str, body: FlowableActionIn, x_api_key: str = Header(default=""), x_user_role: str = Header(default="")):
    role = require_min_role(x_api_key, x_user_role, ROLE_SENIOR_ANALYST)
    return await set_flowable_instance_state(instance_id, "activate", role, body.reason)


@app.post("/api/v1/flowable/instances/{instance_id}/retry-failed-jobs", tags=["Flowable Ops"])
async def retry_flowable_jobs(instance_id: str, body: FlowableActionIn, x_api_key: str = Header(default=""), x_user_role: str = Header(default="")):
    role = require_min_role(x_api_key, x_user_role, ROLE_SENIOR_ANALYST)
    return await retry_flowable_failed_jobs(instance_id, role, body.reason)


@app.post("/api/v1/flowable/instances/{instance_id}/terminate", tags=["Flowable Ops"])
async def terminate_flowable_runtime(instance_id: str, body: FlowableActionIn, x_api_key: str = Header(default=""), x_user_role: str = Header(default="")):
    role = require_min_role(x_api_key, x_user_role, ROLE_SENIOR_ANALYST)
    return await terminate_flowable_instance(instance_id, role, body.reason)


@app.post("/api/v1/flowable/requests/{request_id}/reconcile", tags=["Flowable Ops"])
async def reconcile_flowable(request_id: str, body: FlowableActionIn, x_api_key: str = Header(default=""), x_user_role: str = Header(default="")):
    role = require_min_role(x_api_key, x_user_role, ROLE_SENIOR_ANALYST)
    return await reconcile_flowable_request(request_id, role, body.reason)


@app.get("/api/v1/process-model", tags=["Flowable Ops"])
async def process_model(
    process_key: str = Query("creditServiceChainOrchestration"),
    x_api_key: str = Header(default=""),
    x_user_role: str = Header(default=""),
):
    require_min_role(x_api_key, x_user_role, ROLE_ANALYST)
    return await get_process_model(process_key)


@app.get("/api/v1/requests/{request_id}/tracker", response_model=ListResponse, tags=["Process Tracker"])
def get_request_tracker(request_id: str, limit: int = Query(500, le=1000), x_api_key: str = Header(default=""), x_user_role: str = Header(default="")):
    authorize_request_view(x_api_key, x_user_role)
    rows = query("SELECT * FROM request_tracker_events WHERE request_id=%s ORDER BY id DESC LIMIT %s", (request_id, limit))
    return {"items": [to_json_ready(row) for row in rows]}


@app.get("/api/v1/connector-urls", response_model=Dict[str, str], tags=["Services"])
def connector_urls():
    return get_connector_urls()


@app.get("/api/v1/requests", response_model=ListResponse, tags=["Requests"])
def list_requests(
    request: Request,
    x_api_key: str = Header(default=""),
    x_user_role: str = Header(default=""),
    limit: int = Query(50, le=200),
    status: Optional[str] = Query(None),
    created_from: Optional[datetime] = Query(None),
    created_to: Optional[datetime] = Query(None),
    needs_action: bool = Query(False),
    ignored: Optional[bool] = Query(None),
):
    authorize_request_view(x_api_key, x_user_role)
    apply_rate_limit(request.client.host if request.client else "unknown")
    sql, params = build_requests_list_query(limit, status=status, created_from=created_from, created_to=created_to, ignored=ignored)
    rows = [build_request_view(to_json_ready(row)) for row in query(sql, params)]
    if needs_action:
        rows = [row for row in rows if row.get("needs_operator_action")]
    return {"items": rows}


@app.post("/api/v1/requests", response_model=RequestResponse, tags=["Requests"])
async def create_request(body: RequestIn, request: Request, x_api_key: str = Header(default="")):
    require_gateway_auth(x_api_key)
    apply_rate_limit(request.client.host if request.client else "unknown")

    cid = get_correlation_id()
    result = await submit_request_payload(body.model_dump(exclude_none=True), cid)
    if result.get("http_error"):
        raise HTTPException(502, result["http_error"])
    return {"request_id": result["request_id"], "selected_mode": result["selected_mode"], "result": result["result"]}


@app.get("/api/v1/requests/{request_id}", tags=["Requests"])
async def get_request_detail(request_id: str, x_api_key: str = Header(default=""), x_user_role: str = Header(default="")):
    authorize_request_view(x_api_key, x_user_role)
    return await get_request_detail_view(request_id)


@app.get("/api/v1/requests/{request_id}/notes", response_model=ListResponse, tags=["Requests"])
def get_request_notes(request_id: str, x_api_key: str = Header(default=""), x_user_role: str = Header(default="")):
    authorize_request_view(x_api_key, x_user_role)
    return {"items": list_request_notes(request_id)}


@app.post("/api/v1/requests/{request_id}/notes", tags=["Requests"])
def create_request_note(request_id: str, body: RequestNoteIn, x_api_key: str = Header(default=""), x_user_role: str = Header(default=""), x_user_name: str = Header(default="")):
    require_min_role(x_api_key, x_user_role, ROLE_ANALYST)
    return add_request_note(request_id, body.note, x_user_name)


@app.post("/api/v1/requests/{request_id}/retry-as-new", tags=["Requests"])
async def retry_request(request_id: str, body: RequestActionIn, x_api_key: str = Header(default=""), x_user_role: str = Header(default=""), x_user_name: str = Header(default="")):
    role = require_min_role(x_api_key, x_user_role, ROLE_SENIOR_ANALYST)
    return await retry_request_as_new(request_id, role, body.reason, x_user_name)


@app.post("/api/v1/requests/{request_id}/clone", tags=["Requests"])
async def clone_request(request_id: str, body: RequestActionIn, x_api_key: str = Header(default=""), x_user_role: str = Header(default=""), x_user_name: str = Header(default="")):
    role = require_min_role(x_api_key, x_user_role, ROLE_SENIOR_ANALYST)
    return await clone_request_submission(request_id, role, body.reason, x_user_name)


@app.post("/api/v1/requests/{request_id}/ignore", tags=["Requests"])
def ignore_request(request_id: str, body: RequestActionIn, x_api_key: str = Header(default=""), x_user_role: str = Header(default=""), x_user_name: str = Header(default="")):
    role = require_min_role(x_api_key, x_user_role, ROLE_SENIOR_ANALYST)
    return set_request_ignored(request_id, True, role, body.reason, x_user_name)


@app.post("/api/v1/requests/{request_id}/restore", tags=["Requests"])
def restore_request(request_id: str, body: RequestActionIn, x_api_key: str = Header(default=""), x_user_role: str = Header(default=""), x_user_name: str = Header(default="")):
    role = require_min_role(x_api_key, x_user_role, ROLE_SENIOR_ANALYST)
    return set_request_ignored(request_id, False, role, body.reason, x_user_name)


@app.post("/api/v1/requests/{request_id}/flowable/retry-failed-jobs", tags=["Requests"])
async def retry_request_flowable_jobs_route(request_id: str, body: RequestActionIn, x_api_key: str = Header(default=""), x_user_role: str = Header(default="")):
    role = require_min_role(x_api_key, x_user_role, ROLE_SENIOR_ANALYST)
    return await retry_request_flowable_jobs(request_id, role, body.reason)


@app.get("/api/v1/snp-notifications", response_model=ListResponse, tags=["SNP"])
def list_snp(x_api_key: str = Header(default=""), x_user_role: str = Header(default="")):
    require_min_role(x_api_key, x_user_role, ROLE_ADMIN)
    return {"items": [to_json_ready(row) for row in query("SELECT * FROM snp_notifications ORDER BY id DESC LIMIT 50")]}


@app.post("/internal/cases/complete", tags=["Requests"])
async def complete_case(body: Dict[str, Any], x_internal_api_key: str = Header(default="")):
    require_internal_auth(x_internal_api_key)
    request_id = body.get("request_id")
    if not request_id:
        raise HTTPException(400, "request_id is required")

    existing = query("SELECT status, correlation_id FROM requests WHERE request_id=%s", (request_id,), "one")
    if not existing:
        raise HTTPException(404, "Request not found")
    if existing.get("status") in ("COMPLETED", "REVIEW", "REJECTED") and body.get("result"):
        return {"status": "already-finalized", "request_id": request_id}

    result = body.get("result", {})
    if isinstance(result, str):
        try:
            result = json.loads(result)
        except json.JSONDecodeError:
            result = {"raw_result": result}

    mode = body.get("mode") or query("SELECT orchestration_mode FROM requests WHERE request_id=%s", (request_id,), "scalar") or "flowable"
    async_status = result.get("status", "COMPLETED") if isinstance(result, dict) else "COMPLETED"
    track_request_event(
        request_id,
        "orchestrator",
        "IN",
        "Async completion callback received",
        service_id=f"{mode}-adapter",
        status=async_status,
        payload=result,
        correlation_id=existing.get("correlation_id"),
    )
    finalized = await finalize_request(request_id, mode, result, existing.get("correlation_id") or get_correlation_id())
    return {"status": "completed-noted", "request_id": request_id, "final_status": finalized["status"]}


@app.post("/internal/requests/track", tags=["Process Tracker"])
def record_tracker_event(body: TrackerEventIn, x_internal_api_key: str = Header(default="")):
    require_internal_auth(x_internal_api_key)
    track_request_event(
        body.request_id,
        body.stage,
        body.direction,
        body.title,
        service_id=body.service_id,
        status=body.status,
        payload=body.payload,
        correlation_id=get_correlation_id(),
    )
    return {"status": "tracked"}


# ── AI Usage & Budget ──────────────────────────────────────────────────────────

class AiUsageLogIn(BaseModel):
    request_id: Optional[str] = None
    service_id: str
    model: str = "gpt-4o-mini"
    prompt_tokens: int = 0
    completion_tokens: int = 0
    cost_usd: float = 0.0
    status: str = "ok"
    error_code: Optional[str] = None


@app.post("/internal/ai/usage", tags=["AI Usage"], status_code=201)
def log_ai_usage(body: AiUsageLogIn, x_internal_api_key: str = Header(default="")):
    require_internal_auth(x_internal_api_key)
    execute(
        """INSERT INTO ai_usage_log
           (request_id, service_id, model, prompt_tokens, completion_tokens,
            total_tokens, cost_usd, status, error_code)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
        (body.request_id, body.service_id, body.model,
         body.prompt_tokens, body.completion_tokens,
         body.prompt_tokens + body.completion_tokens,
         round(body.cost_usd, 6), body.status, body.error_code),
    )
    return {"status": "logged"}


@app.get("/api/v1/ai/usage", tags=["AI Usage"])
def get_ai_usage(
    period: str = "30d",
    service_id: Optional[str] = None,
    x_api_key: str = Header(default=""),
    x_user_role: str = Header(default=""),
):
    """Return aggregated AI usage stats. period: today|7d|30d|all"""
    require_min_role(x_api_key, x_user_role, ROLE_ANALYST)
    if period == "today":
        since = "NOW() - INTERVAL '1 day'"
    elif period == "7d":
        since = "NOW() - INTERVAL '7 days'"
    elif period == "30d":
        since = "NOW() - INTERVAL '30 days'"
    else:
        since = "NOW() - INTERVAL '3650 days'"

    svc_filter = "AND service_id = %s" if service_id else ""
    params: list = [service_id] if service_id else []

    rows = query(
        f"""SELECT service_id, model,
               COUNT(*) AS calls,
               SUM(prompt_tokens) AS prompt_tokens,
               SUM(completion_tokens) AS completion_tokens,
               SUM(total_tokens) AS total_tokens,
               SUM(cost_usd) AS cost_usd,
               SUM(CASE WHEN status='fallback' THEN 1 ELSE 0 END) AS fallbacks,
               SUM(CASE WHEN status='budget_exceeded' THEN 1 ELSE 0 END) AS budget_exceeded
           FROM ai_usage_log
           WHERE created_at >= {since} {svc_filter}
           GROUP BY service_id, model
           ORDER BY service_id""",
        params or None,
    )

    # Daily breakdown
    daily = query(
        f"""SELECT DATE(created_at AT TIME ZONE 'UTC') AS day,
               service_id,
               COUNT(*) AS calls,
               SUM(cost_usd) AS cost_usd
           FROM ai_usage_log
           WHERE created_at >= {since} {svc_filter}
           GROUP BY day, service_id
           ORDER BY day DESC""",
        params or None,
    )

    # Recent entries
    recent = query(
        f"""SELECT id, request_id, service_id, model,
               prompt_tokens, completion_tokens, total_tokens, cost_usd,
               status, error_code, created_at
           FROM ai_usage_log
           WHERE created_at >= {since} {svc_filter}
           ORDER BY created_at DESC LIMIT 100""",
        params or None,
    )

    return to_json_ready({
        "summary": rows,
        "daily": daily,
        "recent": recent,
        "period": period,
    })


@app.get("/api/v1/ai/budget", tags=["AI Usage"])
def get_ai_budget(x_api_key: str = Header(default=""), x_user_role: str = Header(default="")):
    """Return budget config for all AI services (from services.meta)."""
    require_min_role(x_api_key, x_user_role, ROLE_ANALYST)
    rows = query(
        "SELECT id, name, enabled, meta FROM services WHERE id IN ('ai-prescreen','ai-advisor')"
    )
    today_rows = query(
        """SELECT service_id, SUM(cost_usd) AS cost_usd
           FROM ai_usage_log
           WHERE created_at >= DATE_TRUNC('day', NOW())
           GROUP BY service_id"""
    )
    month_rows = query(
        """SELECT service_id, SUM(cost_usd) AS cost_usd
           FROM ai_usage_log
           WHERE created_at >= DATE_TRUNC('month', NOW())
           GROUP BY service_id"""
    )
    today_map  = {r["service_id"]: float(r["cost_usd"] or 0) for r in today_rows}
    month_map  = {r["service_id"]: float(r["cost_usd"] or 0) for r in month_rows}

    result = []
    for r in rows:
        meta = r.get("meta") or {}
        result.append({
            "service_id":         r["id"],
            "name":               r["name"],
            "enabled":            r["enabled"],
            "daily_budget_usd":   meta.get("daily_budget_usd"),
            "monthly_budget_usd": meta.get("monthly_budget_usd"),
            "budget_enabled":     meta.get("budget_enabled", False),
            "today_usd":          today_map.get(r["id"], 0.0),
            "month_usd":          month_map.get(r["id"], 0.0),
        })
    return to_json_ready({"items": result})


class AiBudgetUpdate(BaseModel):
    daily_budget_usd:   Optional[float] = None
    monthly_budget_usd: Optional[float] = None
    budget_enabled:     bool = True


@app.put("/api/v1/ai/budget/{service_id}", tags=["AI Usage"])
def update_ai_budget(
    service_id: str,
    body: AiBudgetUpdate,
    x_api_key: str = Header(default=""),
    x_user_role: str = Header(default=""),
    x_user_name: str = Header(default=""),
):
    require_min_role(x_api_key, x_user_role, ROLE_ADMIN)
    if service_id not in ("ai-prescreen", "ai-advisor"):
        raise HTTPException(404, "Unknown AI service")
    patch: Dict[str, Any] = {"budget_enabled": body.budget_enabled}
    if body.daily_budget_usd is not None:
        patch["daily_budget_usd"] = body.daily_budget_usd
    if body.monthly_budget_usd is not None:
        patch["monthly_budget_usd"] = body.monthly_budget_usd
    execute(
        "UPDATE services SET meta = COALESCE(meta,'{}') || %s::jsonb, updated_at=NOW() WHERE id=%s",
        (json.dumps(patch), service_id),
    )
    audit("ai_budget", service_id, "updated", patch, performed_by=x_user_name)
    config_cache.clear()
    return {"status": "updated"}


@app.get("/api/v1/ai/budget/check/{service_id}", tags=["AI Usage"])
def check_ai_budget(service_id: str, x_internal_api_key: str = Header(default="")):
    """Called by AI services before invoking OpenAI. Returns {allowed, reason}."""
    require_internal_auth(x_internal_api_key)
    row = query("SELECT meta, enabled FROM services WHERE id=%s", (service_id,), "one")
    if not row or not row.get("enabled"):
        return {"allowed": False, "reason": "service disabled"}
    meta = row.get("meta") or {}
    if not meta.get("budget_enabled"):
        return {"allowed": True, "reason": "no budget limit"}

    daily   = meta.get("daily_budget_usd")
    monthly = meta.get("monthly_budget_usd")

    if daily is not None:
        today_row = query(
            "SELECT COALESCE(SUM(cost_usd),0) AS s FROM ai_usage_log WHERE service_id=%s AND created_at>=DATE_TRUNC('day',NOW())",
            (service_id,), "one",
        )
        if float(today_row["s"]) >= float(daily):
            return {"allowed": False, "reason": f"daily budget ${daily} exceeded (spent ${today_row['s']:.4f})"}

    if monthly is not None:
        month_row = query(
            "SELECT COALESCE(SUM(cost_usd),0) AS s FROM ai_usage_log WHERE service_id=%s AND created_at>=DATE_TRUNC('month',NOW())",
            (service_id,), "one",
        )
        if float(month_row["s"]) >= float(monthly):
            return {"allowed": False, "reason": f"monthly budget ${monthly} exceeded (spent ${month_row['s']:.4f})"}

    return {"allowed": True, "reason": "within budget"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=PORT)
