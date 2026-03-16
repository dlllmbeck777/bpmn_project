import asyncio
import base64
from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import json
import os
import secrets
from typing import Any, Dict, List, Optional

import httpx
from fastapi import HTTPException

from coreapi.storage import audit, execute, query, to_json_ready, track_request_event, tracker_payload
from shared import check_rate_limit, config_cache, decrypt_field, decrypt_sensitive, encrypt_field, encrypt_sensitive, get_correlation_id, get_logger, mask_field, metrics, resilient_post

API_KEY = os.getenv("GATEWAY_API_KEY", "")
ADMIN_API_KEY = os.getenv("ADMIN_API_KEY", API_KEY)
SENIOR_ANALYST_API_KEY = os.getenv("SENIOR_ANALYST_API_KEY", ADMIN_API_KEY)
ANALYST_API_KEY = os.getenv("ANALYST_API_KEY", SENIOR_ANALYST_API_KEY)
INTERNAL_API_KEY = os.getenv("INTERNAL_API_KEY", "")
FLOWABLE_USER = os.getenv("FLOWABLE_USER", "admin")
FLOWABLE_PASSWORD = os.getenv("FLOWABLE_PASSWORD", "test")
FLOWABLE_PASSWORD_FALLBACKS = [
    item.strip()
    for item in os.getenv("FLOWABLE_PASSWORD_FALLBACKS", "test").split(",")
    if item.strip()
]
ADMIN_LOGIN_USERNAME = os.getenv("ADMIN_LOGIN_USERNAME", "admin")
ADMIN_LOGIN_PASSWORD = os.getenv("ADMIN_LOGIN_PASSWORD", "admin")
SENIOR_ANALYST_LOGIN_USERNAME = os.getenv("SENIOR_ANALYST_LOGIN_USERNAME", "senior")
SENIOR_ANALYST_LOGIN_PASSWORD = os.getenv("SENIOR_ANALYST_LOGIN_PASSWORD", "senior")
ANALYST_LOGIN_USERNAME = os.getenv("ANALYST_LOGIN_USERNAME", "analyst")
ANALYST_LOGIN_PASSWORD = os.getenv("ANALYST_LOGIN_PASSWORD", "analyst")
RATE_LIMIT = int(os.getenv("RATE_LIMIT_PER_MIN", "120"))
SESSION_TTL_HOURS = int(os.getenv("SESSION_TTL_HOURS", "8"))
SERVICE_NAME = "core-api"
log = get_logger(SERVICE_NAME)
DEFAULT_PRODUCT_TYPE = (os.getenv("DEFAULT_PRODUCT_TYPE", "loan") or "loan").strip() or "loan"
DEFAULT_ORCHESTRATION_MODE = (os.getenv("DEFAULT_ORCHESTRATION_MODE", "auto") or "auto").strip().lower() or "auto"
REQUEST_ID_PREFIX = (os.getenv("REQUEST_ID_PREFIX", "REQ") or "REQ").strip().upper() or "REQ"
SUPPORTED_ORCHESTRATION_MODES = {"auto", "custom", "flowable"}
APPLICANT_INPUT_FIELDS = (
    "firstName",
    "lastName",
    "address",
    "city",
    "state",
    "zipCode",
    "ssn",
    "dateOfBirth",
    "email",
    "phone",
)

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
FLOWABLE_DEFAULT_URL = "http://flowable-rest:8080/flowable-rest/service"
FLOWABLE_RUNTIME_FINAL_STATES = {"COMPLETED", "REVIEW", "REJECTED"}
FLOWABLE_REQUEST_FINAL_STATES = FLOWABLE_RUNTIME_FINAL_STATES | {"FAILED", "ENGINE_ERROR", "ENGINE_UNREACHABLE"}
REQUEST_BUSINESS_STATUSES = {"COMPLETED", "REVIEW", "REJECTED"}
REQUEST_TECHNICAL_STATUSES = {"ENGINE_ERROR", "ENGINE_UNREACHABLE"}
REQUEST_ACTIONABLE_CLASSES = {"technical", "integration"}
FLOWABLE_STEP_MAP = (
    ("isoftpull", "isoRawBody", "iso_status", "skip_reason_isoftpull"),
    ("creditsafe", "csRawBody", "creditsafe_status", "skip_reason_creditsafe"),
    ("plaid", "plaidRawBody", "plaid_status", "skip_reason_plaid"),
    ("crm", "crmRawBody", "crm_status", "skip_reason_crm"),
)
PASSWORD_SCHEME = "pbkdf2_sha256"
PASSWORD_ITERATIONS = 480_000


def normalize_username(username: str) -> str:
    return (username or "").strip().lower()


def hash_password(password: str, *, salt: Optional[str] = None, iterations: int = PASSWORD_ITERATIONS) -> str:
    password = password or ""
    raw_salt = salt or secrets.token_urlsafe(12)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), raw_salt.encode("utf-8"), iterations)
    encoded = base64.b64encode(digest).decode("ascii")
    return f"{PASSWORD_SCHEME}${iterations}${raw_salt}${encoded}"


def verify_password(password: str, stored_hash: str) -> bool:
    try:
        scheme, iteration_text, salt, expected = (stored_hash or "").split("$", 3)
        if scheme != PASSWORD_SCHEME:
            return False
        candidate = hash_password(password, salt=salt, iterations=int(iteration_text))
        return hmac.compare_digest(candidate, stored_hash)
    except Exception:
        return False


def _issue_session_token() -> str:
    return secrets.token_urlsafe(32)


def _admin_user_by_username(username: str, *, enabled_only: bool = False):
    normalized = normalize_username(username)
    if not normalized:
        return None
    sql = "SELECT * FROM admin_users WHERE username=%s"
    params: List[Any] = [normalized]
    if enabled_only:
        sql += " AND enabled=TRUE"
    return to_json_ready(query(sql, params, "one"))


def _admin_user_by_session_token(token: str):
    if not (token or "").strip():
        return None
    return to_json_ready(query(
        "SELECT * FROM admin_users WHERE session_token=%s AND enabled=TRUE AND (session_expires_at IS NULL OR session_expires_at > NOW())",
        ((token or "").strip(),), "one"
    ))


def ensure_default_ui_users():
    profiles = [
        (normalize_username(ADMIN_LOGIN_USERNAME), ADMIN_LOGIN_USERNAME, ROLE_ADMIN, ADMIN_LOGIN_PASSWORD),
        (normalize_username(SENIOR_ANALYST_LOGIN_USERNAME), SENIOR_ANALYST_LOGIN_USERNAME, ROLE_SENIOR_ANALYST, SENIOR_ANALYST_LOGIN_PASSWORD),
        (normalize_username(ANALYST_LOGIN_USERNAME), ANALYST_LOGIN_USERNAME, ROLE_ANALYST, ANALYST_LOGIN_PASSWORD),
    ]
    for username, display_name, role, password in profiles:
        if not username or _admin_user_by_username(username):
            continue
        execute(
            """
            INSERT INTO admin_users (username,display_name,role,password_hash,enabled,source)
            VALUES (%s,%s,%s,%s,%s,%s)
            """,
            (username, display_name, normalize_role(role), hash_password(password), True, "seed"),
        )


def require_gateway_auth(key: str):
    if API_KEY and not secrets.compare_digest(key or "", API_KEY):
        metrics.inc("auth_failures", 'scope="gateway"')
        raise HTTPException(401, "invalid api key")


def require_admin_auth(key: str):
    if ADMIN_API_KEY and not secrets.compare_digest(key or "", ADMIN_API_KEY):
        metrics.inc("auth_failures", 'scope="admin"')
        raise HTTPException(401, "invalid admin api key")


def require_internal_auth(key: str):
    if INTERNAL_API_KEY and not secrets.compare_digest(key or "", INTERNAL_API_KEY):
        metrics.inc("auth_failures", 'scope="internal"')
        raise HTTPException(401, "invalid internal api key")


def require_internal_or_min_role(key: str, requested_role: str, minimum_role: str) -> str:
    key = (key or "").strip()
    if INTERNAL_API_KEY and secrets.compare_digest(key, INTERNAL_API_KEY):
        return "internal"
    return require_min_role(key, requested_role, minimum_role)


def authenticate_ui_login(username: str, password: str):
    username = normalize_username(username)
    password = password or ""
    db_user = _admin_user_by_username(username)
    if db_user:
        if not db_user.get("enabled"):
            metrics.inc("auth_failures", 'scope="ui-login"')
            raise HTTPException(403, "user account is disabled")
        if verify_password(password, db_user.get("password_hash", "")):
            session_token = _issue_session_token()
            from datetime import datetime, timedelta, timezone as tz
            session_expires = datetime.now(tz.utc) + timedelta(hours=SESSION_TTL_HOURS)
            execute(
                """
                UPDATE admin_users
                SET session_token=%s, session_issued_at=NOW(), session_expires_at=%s, last_login_at=NOW(), updated_at=NOW()
                WHERE username=%s
                """,
                (session_token, session_expires, username),
            )
            role = normalize_role(db_user.get("role"))
            metrics.inc("auth_logins", f'role="{role}"')
            return {
                "status": "ok",
                "username": db_user.get("username") or username,
                "role": role,
                "api_key": session_token,
            }
        metrics.inc("auth_failures", 'scope="ui-login"')
        raise HTTPException(401, "invalid username or password")

    profiles = [
        (ROLE_ADMIN, normalize_username(ADMIN_LOGIN_USERNAME), ADMIN_LOGIN_PASSWORD, ADMIN_API_KEY),
        (ROLE_SENIOR_ANALYST, normalize_username(SENIOR_ANALYST_LOGIN_USERNAME), SENIOR_ANALYST_LOGIN_PASSWORD, SENIOR_ANALYST_API_KEY),
        (ROLE_ANALYST, normalize_username(ANALYST_LOGIN_USERNAME), ANALYST_LOGIN_PASSWORD, ANALYST_API_KEY),
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
    session_user = _admin_user_by_session_token(key)
    if session_user:
        actual_role = normalize_role(session_user.get("role"))
        if normalized_role and normalized_role != actual_role:
            metrics.inc("auth_failures", f'scope="ui",role="{normalized_role}"')
            raise HTTPException(401, "invalid user role for current session")
        return actual_role
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


def _clean_text(value: Any) -> str:
    return str(value or "").strip()


def _normalize_mode(value: Any) -> str:
    normalized = _clean_text(value).lower() or DEFAULT_ORCHESTRATION_MODE
    return normalized if normalized in SUPPORTED_ORCHESTRATION_MODES else DEFAULT_ORCHESTRATION_MODE


def _generate_request_id() -> str:
    now = datetime.now(timezone.utc)
    return f"{REQUEST_ID_PREFIX}-{now:%Y%m%d%H%M%S}-{secrets.token_hex(3).upper()}"


def _build_customer_id(applicant: Dict[str, Any], fallback_request_id: str) -> str:
    seed = (
        _clean_text(applicant.get("ssn"))
        or _clean_text(applicant.get("email"))
        or _clean_text(applicant.get("phone"))
        or fallback_request_id
    )
    digest = hashlib.sha256(seed.encode("utf-8")).hexdigest()[:12].upper()
    return f"CUST-{digest}"


def _looks_like_applicant_input(data: Dict[str, Any]) -> bool:
    return all(_clean_text(data.get(field)) for field in APPLICANT_INPUT_FIELDS)


def _build_applicant_from_input(data: Dict[str, Any]) -> Dict[str, Any]:
    return {field: _clean_text(data.get(field)) for field in APPLICANT_INPUT_FIELDS}


def _build_applicant_from_legacy(data: Dict[str, Any]) -> Dict[str, Any]:
    payload = data.get("payload") if isinstance(data.get("payload"), dict) else {}
    source = data.get("applicant") if isinstance(data.get("applicant"), dict) else payload.get("applicant")
    source = source if isinstance(source, dict) else {}
    applicant = {
        "firstName": _clean_text(source.get("firstName")),
        "lastName": _clean_text(source.get("lastName")),
        "address": _clean_text(source.get("address")),
        "city": _clean_text(source.get("city")),
        "state": _clean_text(source.get("state")),
        "zipCode": _clean_text(source.get("zipCode")),
        "ssn": _clean_text(source.get("ssn") or data.get("ssn") or data.get("iin")),
        "dateOfBirth": _clean_text(source.get("dateOfBirth")),
        "email": _clean_text(source.get("email")),
        "phone": _clean_text(source.get("phone")),
    }
    return {key: value for key, value in applicant.items() if value not in ("", None)}


def normalize_incoming_request(data: Dict[str, Any]) -> Dict[str, Any]:
    applicant = _build_applicant_from_input(data) if _looks_like_applicant_input(data) else _build_applicant_from_legacy(data)
    request_id = _clean_text(data.get("request_id")) or _generate_request_id()
    customer_id = _clean_text(data.get("customer_id")) or _build_customer_id(applicant, request_id)
    product_type = _clean_text(data.get("product_type")) or DEFAULT_PRODUCT_TYPE
    orchestration_mode = _normalize_mode(data.get("orchestration_mode"))
    ssn_value = _clean_text(applicant.get("ssn")) or _clean_text(data.get("ssn") or data.get("iin"))

    payload = dict(data.get("payload") or {})
    if applicant:
        payload.setdefault("applicant", applicant)

    internal = {
        "request_id": request_id,
        "customer_id": customer_id,
        "iin": ssn_value,
        "ssn": ssn_value,
        "product_type": product_type,
        "orchestration_mode": orchestration_mode,
        "payload": payload,
        "applicant": applicant,
    }
    if applicant:
        internal.update(applicant)

    return {
        "request_id": request_id,
        "customer_id": customer_id,
        "product_type": product_type,
        "orchestration_mode": orchestration_mode,
        "internal": internal,
        "applicant_profile": applicant,
        "applicant_profile_encrypted": encrypt_sensitive(applicant) if applicant else {},
        "ssn_encrypted": encrypt_field(ssn_value) if ssn_value else "",
    }


def _mask_tail(value: Any, visible: int = 4) -> str:
    text = _clean_text(value)
    if not text:
        return ""
    if len(text) <= visible:
        return "***"
    return f"***{text[-visible:]}"


def _mask_email(value: Any) -> str:
    text = _clean_text(value)
    if not text:
        return ""
    if "@" not in text:
        return _mask_tail(text)
    local, domain = text.split("@", 1)
    visible_local = local[:1] if local else ""
    return f"{visible_local}***@{domain}"


def build_applicant_name(applicant: Dict[str, Any]) -> str:
    first = _clean_text((applicant or {}).get("firstName"))
    last = _clean_text((applicant or {}).get("lastName"))
    return " ".join(part for part in (first, last) if part)


def build_applicant_location(applicant: Dict[str, Any]) -> str:
    city = _clean_text((applicant or {}).get("city"))
    state = _clean_text((applicant or {}).get("state"))
    return ", ".join(part for part in (city, state) if part)


def _nested_values(value: Any):
    if isinstance(value, dict):
        for item in value.values():
            yield from _nested_values(item)
    elif isinstance(value, list):
        for item in value:
            yield from _nested_values(item)
    else:
        yield value


def _normalize_request_error_payload(value: Any):
    parsed = _parse_embedded_json(value)
    return parsed if isinstance(parsed, dict) else {}


def _payload_has_status(payload: Dict[str, Any], statuses: set[str]) -> bool:
    normalized_statuses = {str(item).upper() for item in statuses}
    for value in _nested_values(payload):
        if isinstance(value, str) and value.upper() in normalized_statuses:
            return True
    return False


def classify_request_error(row: Optional[Dict[str, Any]]) -> str:
    if not row:
        return ""

    status = str((row or {}).get("status") or "").upper()
    if status in REQUEST_BUSINESS_STATUSES:
        return "business"
    if status in REQUEST_TECHNICAL_STATUSES:
        return "technical"

    result = normalize_result_payload((row or {}).get("result") or {}) if isinstance((row or {}).get("result"), dict) else _normalize_request_error_payload((row or {}).get("result"))
    error_payload = _normalize_request_error_payload((row or {}).get("error"))

    engine_hints = {
        str(error_payload.get("service") or "").lower(),
        str(result.get("service") or "").lower(),
        str(result.get("adapter") or "").lower(),
        str(result.get("status") or "").upper(),
    }
    if status == "FAILED":
        if any("adapter" in hint or "engine" in hint for hint in engine_hints if hint):
            return "technical"
        if _payload_has_status(result, {"FAILED", "UNAVAILABLE", "CIRCUIT_OPEN", "PARSER_ERROR", "PARSER_UNAVAILABLE"}):
            return "integration"
        if _payload_has_status(error_payload, {"FAILED", "UNAVAILABLE", "CIRCUIT_OPEN"}):
            service_hint = str(error_payload.get("service") or "").lower()
            return "technical" if ("adapter" in service_hint or "engine" in service_hint) else "integration"
        return "technical"

    if _payload_has_status(result, REQUEST_TECHNICAL_STATUSES) or _payload_has_status(error_payload, REQUEST_TECHNICAL_STATUSES):
        return "technical"
    return ""


def request_needs_operator_action(row: Optional[Dict[str, Any]]) -> bool:
    if not row:
        return False
    if bool((row or {}).get("ignored")):
        return False
    return classify_request_error(row) in REQUEST_ACTIONABLE_CLASSES


def build_request_ops(row: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    item = dict(row or {})
    error_class = classify_request_error(item)
    instance_id = extract_flowable_instance_id(item.get("result"))
    ignored = bool(item.get("ignored"))
    status = str(item.get("status") or "").upper()
    return {
        "error_class": error_class,
        "needs_operator_action": request_needs_operator_action(item),
        "instance_id": instance_id,
        "can_retry_as_new": not ignored and error_class in REQUEST_ACTIONABLE_CLASSES,
        "can_clone": True,
        "can_ignore": not ignored and error_class in REQUEST_ACTIONABLE_CLASSES,
        "can_restore": ignored,
        "can_reconcile_flowable": item.get("orchestration_mode") == "flowable" and bool(instance_id) and status not in REQUEST_BUSINESS_STATUSES,
        "can_retry_failed_flowable_jobs": item.get("orchestration_mode") == "flowable" and bool(instance_id) and error_class in REQUEST_ACTIONABLE_CLASSES,
        "can_add_note": True,
    }


def build_request_view(row: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not row:
        return row
    item = dict(row)
    if isinstance(item.get("result"), dict):
        item["result"] = normalize_result_payload(item.get("result"))
    if item.get("error"):
        item["error"] = _normalize_request_error_payload(item.get("error")) or item.get("error")
    if not item.get("result") and isinstance(item.get("error"), dict):
        item["result"] = dict(item["error"])
    applicant = item.get("applicant_profile")
    applicant = decrypt_sensitive(applicant) if isinstance(applicant, dict) else {}
    if not applicant and item.get("ssn_encrypted"):
        applicant = {"ssn": decrypt_field(item["ssn_encrypted"])}
    elif not applicant and item.get("iin_encrypted"):
        applicant = {"ssn": decrypt_field(item["iin_encrypted"])}

    ssn_masked = ""
    if item.get("ssn_encrypted"):
        ssn_masked = mask_field(item["ssn_encrypted"])
    elif item.get("iin_encrypted"):
        ssn_masked = mask_field(item["iin_encrypted"])
    elif applicant.get("ssn"):
        ssn_masked = _mask_tail(applicant.get("ssn"))

    email_masked = _mask_email(applicant.get("email"))
    phone_masked = _mask_tail(applicant.get("phone"))
    applicant_view = dict(applicant)
    if applicant_view.get("ssn"):
        applicant_view["ssn"] = ssn_masked
    if applicant_view.get("email"):
        applicant_view["email"] = email_masked
    if applicant_view.get("phone"):
        applicant_view["phone"] = phone_masked

    item["applicant_profile"] = applicant_view
    item["applicant_name"] = build_applicant_name(applicant)
    item["applicant_location"] = build_applicant_location(applicant)
    item["ssn_masked"] = ssn_masked
    item["iin_masked"] = ssn_masked
    item["email_masked"] = email_masked
    item["phone_masked"] = phone_masked
    item["ignored"] = bool(item.get("ignored"))
    item["error_class"] = classify_request_error(item)
    item["needs_operator_action"] = request_needs_operator_action(item)
    item["ops"] = build_request_ops(item)
    return item


def _safe_user_view(row: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not row:
        return None
    item = dict(row)
    item.pop("password_hash", None)
    item.pop("session_token", None)
    item["role"] = normalize_role(item.get("role"))
    item["session_active"] = bool(row.get("session_token"))
    return item


def _admin_count() -> int:
    return int(query("SELECT COUNT(*) FROM admin_users WHERE role=%s AND enabled=TRUE", (ROLE_ADMIN,), "scalar") or 0)


def list_admin_users() -> List[Dict[str, Any]]:
    rows = query("SELECT * FROM admin_users ORDER BY role DESC, username")
    return [_safe_user_view(to_json_ready(row)) for row in rows]


def create_admin_user(username: str, display_name: str, role: str, password: str, enabled: bool = True) -> Dict[str, Any]:
    normalized_username = normalize_username(username)
    if not normalized_username:
        raise HTTPException(400, "username is required")
    normalized_role = normalize_role(role)
    if _admin_user_by_username(normalized_username):
        raise HTTPException(409, "username already exists")
    execute(
        """
        INSERT INTO admin_users (username,display_name,role,password_hash,enabled,source)
        VALUES (%s,%s,%s,%s,%s,%s)
        """,
        (normalized_username, (display_name or "").strip(), normalized_role, hash_password(password), enabled, "db"),
    )
    return _safe_user_view(_admin_user_by_username(normalized_username))


def update_admin_user(username: str, *, display_name: str, role: str, password: Optional[str], enabled: bool, actor_username: str = "") -> Dict[str, Any]:
    normalized_username = normalize_username(username)
    existing = _admin_user_by_username(normalized_username)
    if not existing:
        raise HTTPException(404, "user not found")

    normalized_role = normalize_role(role)
    actor_username = normalize_username(actor_username)
    if normalize_role(existing.get("role")) == ROLE_ADMIN and (normalized_role != ROLE_ADMIN or not enabled) and _admin_count() <= 1:
        raise HTTPException(409, "at least one enabled admin user must remain")
    if actor_username and actor_username == normalized_username and (normalized_role != ROLE_ADMIN or not enabled):
        raise HTTPException(409, "you cannot remove your own admin access or disable your current account")

    password_hash = existing.get("password_hash", "")
    rotate_session = False
    if password:
        password_hash = hash_password(password)
        rotate_session = True
    if normalize_role(existing.get("role")) != normalized_role or bool(existing.get("enabled")) != bool(enabled):
        rotate_session = True

    execute(
        """
        UPDATE admin_users
        SET display_name=%s,
            role=%s,
            password_hash=%s,
            enabled=%s,
            session_token=%s,
            session_issued_at=%s,
            updated_at=NOW()
        WHERE username=%s
        """,
        (
            (display_name or "").strip(),
            normalized_role,
            password_hash,
            enabled,
            None if rotate_session else existing.get("session_token"),
            None if rotate_session else existing.get("session_issued_at"),
            normalized_username,
        ),
    )
    return _safe_user_view(_admin_user_by_username(normalized_username))


def delete_admin_user(username: str, actor_username: str = ""):
    normalized_username = normalize_username(username)
    existing = _admin_user_by_username(normalized_username)
    if not existing:
        raise HTTPException(404, "user not found")
    actor_username = normalize_username(actor_username)
    if actor_username and actor_username == normalized_username:
        raise HTTPException(409, "you cannot delete your current account")
    if normalize_role(existing.get("role")) == ROLE_ADMIN and _admin_count() <= 1:
        raise HTTPException(409, "at least one enabled admin user must remain")
    execute("DELETE FROM admin_users WHERE username=%s", (normalized_username,))


def revoke_admin_user_session(username: str) -> Dict[str, Any]:
    normalized_username = normalize_username(username)
    existing = _admin_user_by_username(normalized_username)
    if not existing:
        raise HTTPException(404, "user not found")
    execute(
        "UPDATE admin_users SET session_token=NULL, session_issued_at=NULL, updated_at=NOW() WHERE username=%s",
        (normalized_username,),
    )
    return _safe_user_view(_admin_user_by_username(normalized_username))


def build_requests_list_query(limit: int, status: Optional[str] = None, created_from: Optional[datetime] = None, created_to: Optional[datetime] = None, ignored: Optional[bool] = None):
    sql = "SELECT * FROM requests WHERE TRUE"
    params: List[Any] = []
    if status:
        sql += " AND status=%s"
        params.append(status)
    if created_from:
        sql += " AND created_at >= %s"
        params.append(created_from)
    if created_to:
        sql += " AND created_at <= %s"
        params.append(created_to)
    if ignored is not None:
        sql += " AND ignored=%s"
        params.append(bool(ignored))
    sql += " ORDER BY created_at DESC LIMIT %s"
    params.append(limit)
    return sql, params


def _read_rule_value(data: Dict[str, Any], field_path: str):
    current: Any = data
    for part in str(field_path or "").split("."):
        if not part:
            continue
        if isinstance(current, dict):
            current = current.get(part)
        else:
            return None
    return current


def _rule_matches(rule: Dict[str, Any], data: Dict[str, Any]) -> bool:
    value = str(_read_rule_value(data, rule.get("condition_field", "")) or "")
    expected = str(rule.get("condition_value", ""))
    return {
        "eq": value == expected,
        "neq": value != expected,
        "contains": expected in value,
    }.get(rule.get("condition_op"), False)


def _deterministic_sample_bucket(value: Any) -> int:
    digest = hashlib.sha256(str(value or "").encode("utf-8")).hexdigest()
    return int(digest[:8], 16) % 100


def _rule_canary_matches(rule: Dict[str, Any], data: Dict[str, Any]) -> bool:
    meta = rule.get("meta")
    meta = meta if isinstance(meta, dict) else {}
    sample_raw = meta.get("sample_percent")
    if sample_raw in (None, "", False):
        return True
    try:
        sample_percent = float(sample_raw)
    except (TypeError, ValueError):
        return True

    if sample_percent <= 0:
        return False
    if sample_percent >= 100:
        return True

    sticky_field = str(meta.get("sticky_field") or "request_id")
    sticky_value = _read_rule_value(data, sticky_field)
    if sticky_value in (None, ""):
        sticky_value = data.get("request_id") or data.get("customer_id") or json.dumps(data, sort_keys=True, ensure_ascii=True)
    return _deterministic_sample_bucket(sticky_value) < sample_percent


def _rule_daily_quota_matches(rule: Dict[str, Any]) -> bool:
    meta = rule.get("meta")
    meta = meta if isinstance(meta, dict) else {}
    if not meta.get("daily_quota_enabled"):
        return True

    try:
        daily_quota_max = int(meta.get("daily_quota_max") or 0)
    except (TypeError, ValueError):
        return True

    if daily_quota_max <= 0:
        return True

    now = datetime.now(timezone.utc)
    day_start = datetime(now.year, now.month, now.day, tzinfo=timezone.utc)
    day_end = day_start + timedelta(days=1)
    current_count = int(query(
        "SELECT COUNT(*) FROM requests WHERE orchestration_mode=%s AND created_at >= %s AND created_at < %s",
        (rule.get("target_mode"), day_start, day_end),
        "scalar",
    ) or 0)
    return current_count < daily_quota_max


def resolve_mode(data: Dict[str, Any]) -> str:
    mode = data.get("orchestration_mode", "auto")
    if mode not in ("auto", ""):
        return mode
    for rule in query("SELECT * FROM routing_rules WHERE enabled=TRUE ORDER BY priority"):
        matched = _rule_matches(rule, data)
        if matched and _rule_canary_matches(rule, data) and _rule_daily_quota_matches(rule):
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
        """
        SELECT request_id, customer_id, product_type, orchestration_mode, correlation_id,
               applicant_profile, ssn_encrypted, iin_encrypted
        FROM requests
        WHERE request_id=%s
        """,
        (request_id,),
        "one",
    ) or {}
    context = to_json_ready(row) or {}
    applicant = context.get("applicant_profile")
    applicant = decrypt_sensitive(applicant) if isinstance(applicant, dict) else {}
    if not applicant and context.get("ssn_encrypted"):
        applicant["ssn"] = decrypt_field(context["ssn_encrypted"])
    elif not applicant and context.get("iin_encrypted"):
        applicant["ssn"] = decrypt_field(context["iin_encrypted"])
    if applicant:
        context["applicant"] = applicant
        context.update({key: value for key, value in applicant.items() if value not in ("", None)})
        context.setdefault("ssn", applicant.get("ssn", ""))
        context.setdefault("iin", applicant.get("ssn", ""))
    return context


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
    track_request_event(
        request_id,
        "stop_factor_post",
        "STATE",
        "POST stop factors evaluated",
        status=sf_post.get("decision"),
        payload=sf_post,
        correlation_id=cid,
    )
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
            "applicant": context.get("applicant") or {},
            "result": normalized_result,
            "post_stop_factor": sf_post,
        }
    )
    execute("UPDATE requests SET snp_result=%s WHERE request_id=%s", (json.dumps(snp), request_id))
    metrics.inc("requests_completed", f'mode="{mode}",status="{final_status}"')
    summary = normalized_result.get("summary") if isinstance(normalized_result.get("summary"), dict) else {}
    decision_reason = normalized_result.get("decision_reason") or summary.get("decision_reason") or sf_post.get("reason")
    track_request_event(
        request_id,
        "request",
        "STATE",
        "Request finalized",
        status=final_status,
        payload={
            "mode": mode,
            "status": final_status,
            "decision_reason": decision_reason,
            "summary": summary,
            "engine": normalized_result.get("engine", {}),
            "snp_result": snp,
        },
        correlation_id=cid,
    )

    return {
        "status": final_status,
        "result": normalized_result,
        "post_stop_factor": sf_post,
        "snp_result": snp,
    }


def list_request_notes(request_id: str) -> List[Dict[str, Any]]:
    rows = query("SELECT * FROM request_notes WHERE request_id=%s ORDER BY id DESC", (request_id,))
    return [to_json_ready(row) for row in rows]


def add_request_note(request_id: str, note_text: str, created_by: str = "") -> Dict[str, Any]:
    if not (note_text or "").strip():
        raise HTTPException(400, "note text is required")
    existing = query("SELECT request_id, correlation_id FROM requests WHERE request_id=%s", (request_id,), "one")
    if not existing:
        raise HTTPException(404, "request not found")
    note_id = execute_returning(
        """
        INSERT INTO request_notes (request_id,note_text,created_by)
        VALUES (%s,%s,%s)
        RETURNING id
        """,
        (request_id, note_text.strip(), (created_by or "").strip()),
    )
    audit("request", request_id, "note_added", {"note": note_text.strip()}, performed_by=(created_by or "").strip() or None)
    track_request_event(
        request_id,
        "operations",
        "STATE",
        "Operator note added",
        status="NOTED",
        payload={"note": note_text.strip(), "created_by": (created_by or "").strip()},
        correlation_id=(existing or {}).get("correlation_id"),
    )
    return to_json_ready(query("SELECT * FROM request_notes WHERE id=%s", (note_id,), "one")) or {}


def set_request_ignored(request_id: str, ignored: bool, requested_role: str, reason: str = "", actor_username: str = "") -> Dict[str, Any]:
    existing = query("SELECT request_id, correlation_id, ignored FROM requests WHERE request_id=%s", (request_id,), "one")
    if not existing:
        raise HTTPException(404, "request not found")

    if ignored:
        execute(
            """
            UPDATE requests
            SET ignored=TRUE, ignored_reason=%s, ignored_at=NOW(), ignored_by=%s, updated_at=NOW()
            WHERE request_id=%s
            """,
            (reason.strip(), (actor_username or "").strip(), request_id),
        )
        action = "ignored"
        title = "Request marked as ignored"
        status = "IGNORED"
    else:
        execute(
            """
            UPDATE requests
            SET ignored=FALSE, ignored_reason=NULL, ignored_at=NULL, ignored_by=NULL, updated_at=NOW()
            WHERE request_id=%s
            """,
            (request_id,),
        )
        action = "restored"
        title = "Ignored request restored"
        status = "RESTORED"

    audit(
        "request",
        request_id,
        action,
        {"reason": reason.strip(), "requested_role": requested_role},
        performed_by=(actor_username or "").strip() or None,
    )
    track_request_event(
        request_id,
        "operations",
        "STATE",
        title,
        status=status,
        payload={"reason": reason.strip(), "requested_role": requested_role, "requested_by": (actor_username or "").strip()},
        correlation_id=(existing or {}).get("correlation_id"),
    )
    return build_request_view(to_json_ready(query("SELECT * FROM requests WHERE request_id=%s", (request_id,), "one"))) or {}


async def submit_request_payload(
    incoming: Dict[str, Any],
    cid: str,
    *,
    origin_stage: str = "gateway",
    origin_title: str = "Request received by gateway",
    origin_status: str = "RECEIVED",
    origin_payload: Optional[Dict[str, Any]] = None,
):
    normalized = normalize_incoming_request(incoming)
    data = normalized["internal"]
    request_id = normalized["request_id"]
    customer_id = normalized["customer_id"]
    product_type = normalized["product_type"]
    requested_mode = normalized["orchestration_mode"]
    applicant_profile = normalized["applicant_profile_encrypted"]
    ssn_encrypted = normalized["ssn_encrypted"]
    iin_encrypted = ssn_encrypted
    metrics.inc("requests_total", f'product="{product_type}"')

    existing = query("SELECT status FROM requests WHERE request_id=%s", (request_id,), "one")
    if existing:
        raise HTTPException(409, f"request_id '{request_id}' already exists (status: {existing.get('status')})")

    track_request_event(
        request_id,
        origin_stage,
        "IN",
        origin_title,
        status=origin_status,
        payload=origin_payload or incoming,
        correlation_id=cid,
    )

    sf_pre = await run_stop_factor_check("pre", data, cid)
    track_request_event(
        request_id,
        "stop_factor_pre",
        "STATE",
        "PRE stop factors evaluated",
        status=sf_pre.get("decision"),
        payload=sf_pre,
        correlation_id=cid,
    )
    if sf_pre["decision"] == "REJECT":
        execute(
            """
            INSERT INTO requests (request_id,customer_id,iin_encrypted,ssn_encrypted,applicant_profile,product_type,orchestration_mode,status,correlation_id,result,post_stop_factor)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            """,
            (
                request_id,
                customer_id,
                iin_encrypted,
                ssn_encrypted,
                json.dumps(applicant_profile),
                product_type,
                requested_mode,
                "REJECTED",
                cid,
                json.dumps({"status": "REJECTED", "reason": sf_pre.get("reason")}),
                json.dumps(sf_pre),
            ),
        )
        track_request_event(
            request_id,
            origin_stage,
            "STATE",
            "Request rejected before orchestration",
            status="REJECTED",
            payload={"reason": sf_pre.get("reason")},
            correlation_id=cid,
        )
        metrics.inc("requests_rejected")
        return {"request_id": request_id, "selected_mode": "none", "result": {"status": "REJECTED", "reason": sf_pre.get("reason")}, "http_error": None}

    mode = resolve_mode(data)
    track_request_event(
        request_id,
        "routing",
        "STATE",
        "Routing mode selected",
        status=mode.upper(),
        payload={"selected_mode": mode},
        correlation_id=cid,
    )
    adapter_id = "flowable-adapter" if mode == "flowable" else "custom-adapter"
    service = to_json_ready(query("SELECT * FROM services WHERE id=%s", (adapter_id,), "one")) or {}
    base_url = service.get("base_url", "")
    endpoint_path = service.get("endpoint_path", "/orchestrate")
    if not base_url:
        raise HTTPException(503, f"{adapter_id} not configured")

    execute(
        """
        INSERT INTO requests (request_id,customer_id,iin_encrypted,ssn_encrypted,applicant_profile,product_type,orchestration_mode,status,correlation_id)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
        """,
        (request_id, customer_id, iin_encrypted, ssn_encrypted, json.dumps(applicant_profile), product_type, mode, "SUBMITTED", cid),
    )
    track_request_event(
        request_id,
        "orchestrator",
        "OUT",
        f"Request dispatched to {adapter_id}",
        service_id=adapter_id,
        status="SUBMITTED",
        payload={"mode": mode, "adapter_id": adapter_id},
        correlation_id=cid,
    )

    result = await resilient_post(
        adapter_id,
        f"{base_url}{endpoint_path}",
        data,
        timeout=service.get("timeout_ms", 60000) / 1000,
        max_retries=service.get("retry_count", 2),
        cid=cid,
    )
    if result.get("status") in ("CIRCUIT_OPEN", "UNAVAILABLE"):
        execute("UPDATE requests SET status=%s,error=%s,updated_at=NOW() WHERE request_id=%s", ("FAILED", json.dumps(result), request_id))
        track_request_event(
            request_id,
            "orchestrator",
            "IN",
            f"{adapter_id} returned failure",
            service_id=adapter_id,
            status=result.get("status"),
            payload=result,
            correlation_id=cid,
        )
        return {
            "request_id": request_id,
            "selected_mode": mode,
            "result": {"status": "FAILED", "error": result, "adapter": adapter_id, "request_id": request_id},
            "http_error": f"orchestrator failed: {result}",
        }

    normalized_result = dict(result)
    current_status = normalized_result.get("status", "COMPLETED")
    execute("UPDATE requests SET status=%s,result=%s,updated_at=NOW() WHERE request_id=%s", (current_status, json.dumps(normalized_result), request_id))
    track_request_event(
        request_id,
        "orchestrator",
        "IN",
        f"{adapter_id} returned result",
        service_id=adapter_id,
        status=current_status,
        payload=normalized_result,
        correlation_id=cid,
    )

    if current_status == "RUNNING":
        metrics.inc("requests_running", f'mode="{mode}"')
        track_request_event(
            request_id,
            "request",
            "STATE",
            "Async completion pending",
            status="RUNNING",
            payload={"mode": mode},
            correlation_id=cid,
        )
        return {"request_id": request_id, "selected_mode": mode, "result": normalized_result, "http_error": None}

    finalized = await finalize_request(request_id, mode, normalized_result, cid, request_data=data)
    return {"request_id": request_id, "selected_mode": mode, "result": finalized["result"], "http_error": None}


def _request_retry_input(request_id: str) -> Dict[str, Any]:
    request_row = to_json_ready(query("SELECT request_id, product_type, orchestration_mode FROM requests WHERE request_id=%s", (request_id,), "one"))
    if not request_row:
        raise HTTPException(404, "request not found")
    context = get_request_context(request_id)
    applicant = context.get("applicant") or {}
    if not applicant:
        raise HTTPException(409, "request does not contain applicant data for retry")
    return {
        **applicant,
        "product_type": request_row.get("product_type") or DEFAULT_PRODUCT_TYPE,
        "orchestration_mode": request_row.get("orchestration_mode") or DEFAULT_ORCHESTRATION_MODE,
        "payload": {
            "operator_action": {
                "source_request_id": request_id,
            }
        },
    }


async def retry_request_as_new(request_id: str, requested_role: str, reason: str = "", actor_username: str = "") -> Dict[str, Any]:
    request_row = build_request_view(to_json_ready(query("SELECT * FROM requests WHERE request_id=%s", (request_id,), "one")))
    if not request_row:
        raise HTTPException(404, "request not found")
    if request_row.get("error_class") not in REQUEST_ACTIONABLE_CLASSES:
        raise HTTPException(409, "only technical or integration issues can be retried as new")

    incoming = _request_retry_input(request_id)
    incoming.setdefault("payload", {}).setdefault("operator_action", {})
    incoming["payload"]["operator_action"].update({"type": "retry_as_new", "reason": reason.strip()})
    result = await submit_request_payload(
        incoming,
        get_correlation_id(),
        origin_stage="operations",
        origin_title="Request retried as new",
        origin_status="RETRIED",
        origin_payload={"source_request_id": request_id, "reason": reason.strip(), "requested_role": requested_role, "requested_by": (actor_username or "").strip()},
    )
    audit(
        "request",
        request_id,
        "retry_as_new",
        {"new_request_id": result["request_id"], "reason": reason.strip(), "requested_role": requested_role},
        performed_by=(actor_username or "").strip() or None,
    )
    track_request_event(
        request_id,
        "operations",
        "STATE",
        "Retry as new requested",
        status="RETRIED",
        payload={"new_request_id": result["request_id"], "reason": reason.strip(), "requested_role": requested_role},
        correlation_id=request_row.get("correlation_id"),
    )
    return {**result, "source_request_id": request_id}


async def clone_request_submission(request_id: str, requested_role: str, reason: str = "", actor_username: str = "") -> Dict[str, Any]:
    request_row = build_request_view(to_json_ready(query("SELECT * FROM requests WHERE request_id=%s", (request_id,), "one")))
    if not request_row:
        raise HTTPException(404, "request not found")

    incoming = _request_retry_input(request_id)
    incoming.setdefault("payload", {}).setdefault("operator_action", {})
    incoming["payload"]["operator_action"].update({"type": "clone", "reason": reason.strip()})
    result = await submit_request_payload(
        incoming,
        get_correlation_id(),
        origin_stage="operations",
        origin_title="Request cloned from existing case",
        origin_status="CLONED",
        origin_payload={"source_request_id": request_id, "reason": reason.strip(), "requested_role": requested_role, "requested_by": (actor_username or "").strip()},
    )
    audit(
        "request",
        request_id,
        "cloned",
        {"new_request_id": result["request_id"], "reason": reason.strip(), "requested_role": requested_role},
        performed_by=(actor_username or "").strip() or None,
    )
    track_request_event(
        request_id,
        "operations",
        "STATE",
        "Clone request requested",
        status="CLONED",
        payload={"new_request_id": result["request_id"], "reason": reason.strip(), "requested_role": requested_role},
        correlation_id=request_row.get("correlation_id"),
    )
    return {**result, "source_request_id": request_id}

def get_connector_urls():
    cached = config_cache.get("conn_urls")
    if cached:
        return cached
    rows = query("SELECT id, base_url, endpoint_path FROM services WHERE type='connector' AND enabled=TRUE")
    result = {row["id"]: f"{row['base_url']}{row['endpoint_path']}" for row in rows}
    config_cache.set("conn_urls", result)
    return result


def extract_flowable_instance_id(result: Any) -> str:
    normalized = normalize_result_payload(result if isinstance(result, dict) else {"value": result})
    if "value" in normalized and len(normalized) == 1:
        normalized = normalized["value"] if isinstance(normalized["value"], dict) else {}
    engine = normalized.get("engine", {})
    return engine.get("instance_id", "") if isinstance(engine, dict) else ""


def normalize_flowable_variables(items: Any) -> Dict[str, Any]:
    if isinstance(items, dict):
        return {str(key): _parse_embedded_json(value) for key, value in items.items()}
    normalized = {}
    for item in items or []:
        if isinstance(item, dict) and item.get("name"):
            normalized[str(item["name"])] = _parse_embedded_json(item.get("value"))
    return normalized


def build_flowable_steps(process_variables: Dict[str, Any]) -> Dict[str, Any]:
    steps = {}
    for service_id, raw_key, status_key, reason_key in FLOWABLE_STEP_MAP:
        raw_value = _parse_embedded_json(process_variables.get(raw_key, {}))
        status = process_variables.get(status_key, "UNKNOWN")
        reason = process_variables.get(reason_key)
        if isinstance(raw_value, dict) and raw_value:
            step_payload = dict(raw_value)
            step_payload.setdefault("status", status)
            if reason and "reason" not in step_payload:
                step_payload["reason"] = reason
            steps[service_id] = step_payload
            continue

        step_payload = {"service": service_id, "status": status}
        if reason:
            step_payload["reason"] = reason
        steps[service_id] = step_payload
    return steps


def build_flowable_summary(process_variables: Dict[str, Any]) -> Dict[str, Any]:
    orchestration_result = _parse_embedded_json(process_variables.get("orchestration_result", {}))
    if isinstance(orchestration_result, dict):
        summary = orchestration_result.get("summary")
        if isinstance(summary, dict):
            return summary

    summary = {"request_id": process_variables.get("request_id", ""), "route_mode": process_variables.get("route_mode", "FLOWABLE")}
    for service_id, _, status_key, _ in FLOWABLE_STEP_MAP:
        summary[f"{service_id}_status"] = process_variables.get(status_key, "UNKNOWN")
    return summary


def build_flowable_result_from_variables(request_id: str, instance_id: str, process_variables: Dict[str, Any]) -> Dict[str, Any]:
    normalized_variables = normalize_flowable_variables(process_variables)
    orchestration_result = _parse_embedded_json(normalized_variables.get("orchestration_result", {}))
    result = normalize_result_payload(orchestration_result) if isinstance(orchestration_result, dict) else {}
    result.setdefault("status", "COMPLETED")
    result["adapter"] = "flowable"
    result["request_id"] = request_id
    result["engine"] = {"engine": "flowable", "started": True, "instance_id": instance_id, "completed": True}
    result["process_variables"] = normalized_variables
    result["steps"] = build_flowable_steps(normalized_variables)
    result["summary"] = build_flowable_summary(normalized_variables)
    return result


def _flowable_auth():
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


async def _flowable_request(method: str, url: str, *, params: Optional[Dict[str, Any]] = None, body: Optional[Dict[str, Any]] = None, retry_attempts: int = 3):
    last_response = None
    last_error = None
    auth_candidates = _flowable_auth_candidates()
    headers = {"X-Correlation-ID": get_correlation_id()}

    for attempt in range(retry_attempts):
        for index, auth in enumerate(auth_candidates):
            try:
                async with httpx.AsyncClient(timeout=20.0) as client:
                    response = await client.request(method, url, params=params, json=body, auth=auth, headers=headers)
            except Exception as exc:
                last_error = exc
                break

            if response.status_code == 401 and index < len(auth_candidates) - 1:
                last_response = response
                continue

            if index > 0 and response.status_code < 400:
                log.warning("Flowable auth fallback credential accepted in core-api")

            if response.status_code >= 500 and attempt < retry_attempts - 1:
                last_response = response
                break

            return response

        if attempt < retry_attempts - 1:
            await asyncio.sleep(min(1.5 * (attempt + 1), 3.0))

    if last_response is not None:
        return last_response
    raise last_error or RuntimeError("flowable request failed without response")


def _flowable_base_url() -> str:
    service = to_json_ready(query("SELECT * FROM services WHERE id=%s", ("flowable-rest",), "one")) or {}
    return (service.get("base_url") or FLOWABLE_DEFAULT_URL).rstrip("/")


def _flowable_definition_key(process_definition_id: str) -> str:
    process_definition_id = str(process_definition_id or "")
    return process_definition_id.split(":", 1)[0] if ":" in process_definition_id else process_definition_id


def _find_request_for_flowable_instance(instance_id: str):
    row = query(
        """
        SELECT *
        FROM requests
        WHERE orchestration_mode='flowable'
          AND result->'engine'->>'instance_id'=%s
        ORDER BY created_at DESC
        LIMIT 1
        """,
        (instance_id,),
        "one",
    )
    return to_json_ready(row) or None


def _flowable_request_for_list(limit: int, request_id: Optional[str] = None):
    sql = """
        SELECT request_id, customer_id, product_type, orchestration_mode, status, result, error, correlation_id,
               created_at, updated_at, applicant_profile, ssn_encrypted
        FROM requests
        WHERE orchestration_mode='flowable'
    """
    params: List[Any] = []
    if request_id:
        sql += " AND request_id=%s"
        params.append(request_id)
    sql += " ORDER BY created_at DESC LIMIT %s"
    params.append(limit)
    return [to_json_ready(row) for row in query(sql, params)]


async def _flowable_call(method: str, path: str, *, params: Optional[Dict[str, Any]] = None, body: Optional[Dict[str, Any]] = None, allow_404: bool = False):
    url = f"{_flowable_base_url()}{path}"
    try:
        response = await _flowable_request(method, url, params=params, body=body, retry_attempts=3)
    except Exception as exc:
        raise HTTPException(502, f"flowable unavailable: {exc}")

    if allow_404 and response.status_code == 404:
        return None
    if response.status_code >= 400:
        detail = response.text[:400] if response.text else response.reason_phrase
        raise HTTPException(502, f"flowable error {response.status_code}: {detail}")
    if response.status_code == 204 or not response.content:
        return {}
    try:
        return response.json()
    except ValueError:
        return {"raw": response.text}


async def _flowable_runtime_instance(instance_id: str):
    return await _flowable_call("GET", f"/runtime/process-instances/{instance_id}", allow_404=True)


async def _flowable_runtime_variables(instance_id: str):
    return await _flowable_call("GET", f"/runtime/process-instances/{instance_id}/variables", allow_404=True) or []


async def _flowable_historic_instance(instance_id: str):
    response = await _flowable_call(
        "GET",
        "/history/historic-process-instances",
        params={"processInstanceId": instance_id, "includeProcessVariables": "true"},
    )
    items = response.get("data", []) if isinstance(response, dict) else []
    return to_json_ready(items[0]) if items else None


async def _flowable_jobs(instance_id: str):
    response = await _flowable_call("GET", "/management/jobs", params={"processInstanceId": instance_id})
    return [to_json_ready(item) for item in response.get("data", [])] if isinstance(response, dict) else []


async def _load_flowable_bundle(instance_id: str):
    runtime = await _flowable_runtime_instance(instance_id)
    historic_task = asyncio.create_task(_flowable_historic_instance(instance_id))
    jobs_task = asyncio.create_task(_flowable_jobs(instance_id))
    variables_task = asyncio.create_task(_flowable_runtime_variables(instance_id)) if runtime else None

    historic = await historic_task
    jobs = await jobs_task
    variables = normalize_flowable_variables(await variables_task) if variables_task else {}
    if not variables and historic and historic.get("processVariables"):
        variables = normalize_flowable_variables(historic.get("processVariables"))

    return {"runtime": to_json_ready(runtime) if runtime else None, "historic": historic, "variables": variables, "jobs": jobs}


def _flowable_engine_status(runtime: Optional[Dict[str, Any]], historic: Optional[Dict[str, Any]], request_status: str) -> str:
    if runtime:
        if (request_status or "").upper() in FLOWABLE_REQUEST_FINAL_STATES:
            return "ORPHANED"
        if runtime.get("suspended"):
            return "SUSPENDED"
        return "RUNNING"
    if historic:
        if historic.get("deleteReason"):
            return "CANCELLED"
        if historic.get("endTime"):
            return "COMPLETED"
    if request_status == "FAILED":
        return "FAILED"
    return "UNKNOWN"


def _flowable_failed_jobs(jobs: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return [job for job in jobs if job.get("exceptionMessage")]


def _flowable_summary_from_bundle(request_row: Optional[Dict[str, Any]], instance_id: str, bundle: Dict[str, Any]) -> Dict[str, Any]:
    runtime = bundle.get("runtime")
    historic = bundle.get("historic")
    jobs = bundle.get("jobs", [])
    process_variables = bundle.get("variables", {})
    request_row = build_request_view(request_row or {}) or {}
    process_definition_id = (
        (runtime or {}).get("processDefinitionId")
        or (historic or {}).get("processDefinitionId")
        or ((runtime or {}).get("processDefinitionUrl", "").rstrip("/").split("/")[-1] if (runtime or {}).get("processDefinitionUrl") else "")
    )

    return {
        "instance_id": instance_id,
        "request_id": request_row.get("request_id") or process_variables.get("request_id"),
        "applicant_name": request_row.get("applicant_name", ""),
        "request_status": request_row.get("status", "UNKNOWN"),
        "orchestration_mode": request_row.get("orchestration_mode", "flowable"),
        "engine_status": _flowable_engine_status(runtime, historic, request_row.get("status", "")),
        "suspended": bool((runtime or {}).get("suspended")),
        "current_activity": (runtime or {}).get("activityId") or (runtime or {}).get("activityName") or "-",
        "process_definition_id": process_definition_id,
        "process_definition_key": _flowable_definition_key(process_definition_id),
        "start_time": (runtime or {}).get("startTime") or (historic or {}).get("startTime") or request_row.get("created_at"),
        "end_time": (historic or {}).get("endTime"),
        "failed_jobs": len(_flowable_failed_jobs(jobs)),
        "job_count": len(jobs),
        "correlation_id": request_row.get("correlation_id", ""),
    }


def _flowable_operator_hint(summary: Dict[str, Any]) -> str:
    engine_status = str(summary.get("engine_status") or "").upper()
    current_activity = str(summary.get("current_activity") or "").strip() or "-"
    failed_jobs = int(summary.get("failed_jobs") or 0)
    request_status = str(summary.get("request_status") or "").upper()
    if engine_status == "RUNNING":
        if failed_jobs > 0:
            return f"Flowable is running with {failed_jobs} failed job(s). Open Flowable engine and retry jobs."
        if current_activity and current_activity != "-":
            return f"Flowable is still executing at activity: {current_activity}."
        return "Flowable is still running. Wait for async completion or inspect the instance in Flowable engine."
    if engine_status == "ORPHANED":
        return "The platform request is already finalized, but the Flowable runtime instance is still alive."
    if engine_status == "SUSPENDED":
        return "The Flowable instance is suspended and needs operator action."
    if engine_status == "FAILED":
        return "Flowable instance details could not be loaded. Check Flowable engine connectivity and logs."
    if engine_status == "COMPLETED" and request_status == "RUNNING":
        return "Flowable has completed, but the platform request has not been reconciled yet."
    return ""


def _flowable_status_matches(item: Dict[str, Any], status: str) -> bool:
    normalized = (status or "all").strip().lower()
    if normalized in ("", "all"):
        return True
    if normalized == "failed":
        return item.get("engine_status") == "FAILED" or int(item.get("failed_jobs", 0)) > 0
    return item.get("engine_status", "").lower() == normalized


async def list_flowable_instances(limit: int = 50, request_id: Optional[str] = None, status: str = "all"):
    rows = _flowable_request_for_list(limit, request_id=request_id)

    async def enrich(row: Dict[str, Any]):
        instance_id = extract_flowable_instance_id(row.get("result"))
        if not instance_id:
            return {
                "instance_id": "",
                "request_id": row.get("request_id"),
                "request_status": row.get("status", "UNKNOWN"),
                "orchestration_mode": row.get("orchestration_mode", "flowable"),
                "engine_status": "MISSING_INSTANCE",
                "suspended": False,
                "current_activity": "-",
                "process_definition_id": "",
                "process_definition_key": "",
                "start_time": row.get("created_at"),
                "end_time": None,
                "failed_jobs": 0,
                "job_count": 0,
                "correlation_id": row.get("correlation_id", ""),
            }
        try:
            bundle = await _load_flowable_bundle(instance_id)
            return _flowable_summary_from_bundle(row, instance_id, bundle)
        except HTTPException as exc:
            return {
                "instance_id": instance_id,
                "request_id": row.get("request_id"),
                "request_status": row.get("status", "UNKNOWN"),
                "orchestration_mode": row.get("orchestration_mode", "flowable"),
                "engine_status": "FAILED",
                "suspended": False,
                "current_activity": "-",
                "process_definition_id": "",
                "process_definition_key": "",
                "start_time": row.get("created_at"),
                "end_time": None,
                "failed_jobs": 0,
                "job_count": 0,
                "correlation_id": row.get("correlation_id", ""),
                "error": exc.detail,
            }

    items = await asyncio.gather(*(enrich(row) for row in rows))
    return [item for item in items if _flowable_status_matches(item, status)]


async def get_flowable_instance_detail(instance_id: str) -> Dict[str, Any]:
    request_row = _find_request_for_flowable_instance(instance_id)
    bundle = await _load_flowable_bundle(instance_id)
    if not bundle.get("runtime") and not bundle.get("historic") and not request_row:
        raise HTTPException(404, "flowable instance not found")

    summary = _flowable_summary_from_bundle(request_row, instance_id, bundle)
    linked_request_id = summary.get("request_id")
    tracker_items = []
    if linked_request_id:
        tracker_items = [to_json_ready(row) for row in query("SELECT * FROM request_tracker_events WHERE request_id=%s ORDER BY id DESC LIMIT 200", (linked_request_id,))]

    request_view = dict(request_row or {})
    request_view = build_request_view(request_view) or request_view
    if request_view.get("result"):
        request_view["result"] = tracker_payload(normalize_result_payload(request_view.get("result")))

    return {
        "instance": summary,
        "request": request_view or None,
        "variables": tracker_payload(bundle.get("variables", {})),
        "jobs": [tracker_payload(job) for job in bundle.get("jobs", [])],
        "runtime_raw": tracker_payload(bundle.get("runtime") or {}),
        "history_raw": tracker_payload(bundle.get("historic") or {}),
        "tracker": [to_json_ready(item) for item in tracker_items],
    }


async def get_request_detail_view(request_id: str) -> Dict[str, Any]:
    request_row = build_request_view(to_json_ready(query("SELECT * FROM requests WHERE request_id=%s", (request_id,), "one")))
    if not request_row:
        raise HTTPException(404, "Request not found")

    request_row["notes"] = list_request_notes(request_id)
    if request_row.get("orchestration_mode") != "flowable":
        return request_row

    instance_id = extract_flowable_instance_id(request_row.get("result"))
    if not instance_id:
        return request_row

    try:
        bundle = await _load_flowable_bundle(instance_id)
        summary = _flowable_summary_from_bundle(request_row, instance_id, bundle)
        request_row["flowable_live_state"] = {
            "instance_id": summary.get("instance_id"),
            "engine_status": summary.get("engine_status"),
            "current_activity": summary.get("current_activity"),
            "failed_jobs": summary.get("failed_jobs"),
            "job_count": summary.get("job_count"),
            "start_time": summary.get("start_time"),
            "end_time": summary.get("end_time"),
            "hint": _flowable_operator_hint(summary),
        }
    except HTTPException as exc:
        request_row["flowable_live_state"] = {
            "instance_id": instance_id,
            "engine_status": "UNAVAILABLE",
            "current_activity": "-",
            "failed_jobs": 0,
            "job_count": 0,
            "hint": exc.detail,
            "error": exc.detail,
        }
    return request_row


async def set_flowable_instance_state(instance_id: str, action: str, requested_role: str, reason: str = "") -> Dict[str, Any]:
    runtime = await _flowable_runtime_instance(instance_id)
    if not runtime:
        raise HTTPException(409, "flowable process is not running")

    await _flowable_call("PUT", f"/runtime/process-instances/{instance_id}", body={"action": action})
    request_row = _find_request_for_flowable_instance(instance_id)
    audit("flowable_instance", instance_id, action, {"request_id": (request_row or {}).get("request_id"), "reason": reason, "requested_role": requested_role})

    if request_row:
        track_request_event(
            request_row["request_id"],
            "flowable_ops",
            "STATE",
            f"Flowable instance {action} requested",
            service_id="flowable-rest",
            status=action.upper(),
            payload={"instance_id": instance_id, "reason": reason, "requested_role": requested_role},
            correlation_id=request_row.get("correlation_id"),
        )

    return {"status": "ok", "action": action, "instance_id": instance_id, "request_id": (request_row or {}).get("request_id")}


async def retry_flowable_failed_jobs(instance_id: str, requested_role: str, reason: str = "") -> Dict[str, Any]:
    request_row = _find_request_for_flowable_instance(instance_id)
    jobs = await _flowable_jobs(instance_id)
    failed_jobs = _flowable_failed_jobs(jobs)
    if not failed_jobs:
        raise HTTPException(409, "no failed jobs found for this process instance")

    executed_job_ids = []
    for job in failed_jobs:
        job_id = job.get("id")
        if not job_id:
            continue
        await _flowable_call("POST", f"/management/jobs/{job_id}", body={"action": "execute"})
        executed_job_ids.append(job_id)

    audit(
        "flowable_instance",
        instance_id,
        "retry_failed_jobs",
        {"request_id": (request_row or {}).get("request_id"), "job_ids": executed_job_ids, "reason": reason, "requested_role": requested_role},
    )

    if request_row:
        track_request_event(
            request_row["request_id"],
            "flowable_ops",
            "STATE",
            "Retry failed Flowable jobs requested",
            service_id="flowable-rest",
            status="RETRY",
            payload={"instance_id": instance_id, "job_ids": executed_job_ids, "reason": reason, "requested_role": requested_role},
            correlation_id=request_row.get("correlation_id"),
        )

    return {"status": "ok", "action": "retry_failed_jobs", "instance_id": instance_id, "job_ids": executed_job_ids, "request_id": (request_row or {}).get("request_id")}


async def retry_request_flowable_jobs(request_id: str, requested_role: str, reason: str = "") -> Dict[str, Any]:
    request_row = to_json_ready(query("SELECT * FROM requests WHERE request_id=%s", (request_id,), "one"))
    if not request_row:
        raise HTTPException(404, "request not found")
    if request_row.get("orchestration_mode") != "flowable":
        raise HTTPException(400, "only flowable requests support Flowable job retry")
    instance_id = extract_flowable_instance_id(request_row.get("result"))
    if not instance_id:
        raise HTTPException(409, "flowable instance id not found on request")
    return await retry_flowable_failed_jobs(instance_id, requested_role, reason)


async def terminate_flowable_instance(instance_id: str, requested_role: str, reason: str = "") -> Dict[str, Any]:
    runtime = await _flowable_runtime_instance(instance_id)
    if not runtime:
        raise HTTPException(409, "flowable process is not running")

    request_row = _find_request_for_flowable_instance(instance_id)
    request_id = (request_row or {}).get("request_id")
    correlation_id = (request_row or {}).get("correlation_id") or get_correlation_id()

    await _flowable_call("DELETE", f"/runtime/process-instances/{instance_id}")
    audit(
        "flowable_instance",
        instance_id,
        "terminate",
        {"request_id": request_id, "reason": reason, "requested_role": requested_role},
    )

    if request_id:
        track_request_event(
            request_id,
            "flowable_ops",
            "STATE",
            "Flowable runtime terminated",
            service_id="flowable-rest",
            status="TERMINATED",
            payload={"instance_id": instance_id, "reason": reason, "requested_role": requested_role},
            correlation_id=correlation_id,
        )

        request_status = (request_row or {}).get("status", "")
        if request_status.upper() not in FLOWABLE_REQUEST_FINAL_STATES:
            await finalize_request(
                request_id,
                "flowable",
                {
                    "status": "FAILED",
                    "adapter": "flowable",
                    "request_id": request_id,
                    "decision_reason": "Flowable runtime instance terminated by operator",
                    "engine": {
                        "engine": "flowable",
                        "instance_id": instance_id,
                        "terminated": True,
                    },
                    "summary": {
                        "decision_reason": "Flowable runtime instance terminated by operator",
                    },
                },
                correlation_id,
                request_data=get_request_context(request_id),
            )

    return {"status": "ok", "action": "terminate", "instance_id": instance_id, "request_id": request_id}


async def reconcile_flowable_request(request_id: str, requested_role: str, reason: str = "") -> Dict[str, Any]:
    request_row = to_json_ready(query("SELECT * FROM requests WHERE request_id=%s", (request_id,), "one"))
    if not request_row:
        raise HTTPException(404, "request not found")
    if request_row.get("orchestration_mode") != "flowable":
        raise HTTPException(400, "only flowable requests can be reconciled")
    if request_row.get("status") in FLOWABLE_RUNTIME_FINAL_STATES:
        return {"status": "already-finalized", "request_id": request_id, "final_status": request_row.get("status")}

    instance_id = extract_flowable_instance_id(request_row.get("result"))
    if not instance_id:
        raise HTTPException(409, "flowable instance id not found on request")

    bundle = await _load_flowable_bundle(instance_id)
    historic = bundle.get("historic")
    if not historic or not historic.get("endTime"):
        raise HTTPException(409, "flowable process is not completed yet")

    correlation_id = request_row.get("correlation_id") or get_correlation_id()
    track_request_event(
        request_id,
        "flowable_ops",
        "STATE",
        "Manual reconcile requested",
        service_id="flowable-rest",
        status="RECONCILE",
        payload={"instance_id": instance_id, "reason": reason, "requested_role": requested_role},
        correlation_id=correlation_id,
    )

    result = build_flowable_result_from_variables(request_id, instance_id, bundle.get("variables", {}))
    finalized = await finalize_request(
        request_id,
        "flowable",
        result,
        correlation_id,
        request_data=get_request_context(request_id),
    )

    audit(
        "flowable_request",
        request_id,
        "reconciled",
        {"instance_id": instance_id, "reason": reason, "requested_role": requested_role, "final_status": finalized["status"]},
    )

    return {"status": "reconciled", "request_id": request_id, "instance_id": instance_id, "final_status": finalized["status"]}
