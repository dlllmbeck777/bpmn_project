import json
from datetime import datetime
from typing import Any, Dict, Optional

from shared import get_conn, put_conn

TRACKER_MASK_SUFFIX = 4
TRACKER_SENSITIVE_KEYS = {
    "iin",
    "iin_encrypted",
    "ssn",
    "ssn_encrypted",
    "dateofbirth",
    "firstname",
    "lastname",
    "address",
    "zipcode",
    "email",
    "phone",
    "api_key",
    "internal_api_key",
    "password",
    "authorization",
    "cookie",
    "set-cookie",
    "x-api-key",
    "x-internal-api-key",
    "token",
    "access_token",
    "refresh_token",
    "secret",
}


def query(sql: str, params=None, fetch: str = "all"):
    conn = get_conn()
    try:
        cur = conn.cursor()
        cur.execute(sql, params)
        if fetch == "all":
            cols = [d[0] for d in cur.description]
            rows = [dict(zip(cols, r)) for r in cur.fetchall()]
            cur.close()
            return rows
        if fetch == "one":
            cols = [d[0] for d in cur.description]
            row = cur.fetchone()
            cur.close()
            return dict(zip(cols, row)) if row else None
        if fetch == "scalar":
            row = cur.fetchone()
            cur.close()
            return row[0] if row else None
        cur.close()
        return None
    finally:
        put_conn(conn)


def execute(sql: str, params=None):
    conn = get_conn()
    try:
        cur = conn.cursor()
        cur.execute(sql, params)
        cur.close()
    finally:
        put_conn(conn)


def execute_returning(sql: str, params=None):
    conn = get_conn()
    try:
        cur = conn.cursor()
        cur.execute(sql, params)
        value = cur.fetchone()[0]
        cur.close()
        return value
    finally:
        put_conn(conn)


def execute_returning_one(sql: str, params=None):
    """Like execute_returning but returns None if no rows matched (safe for conditional UPDATEs)."""
    conn = get_conn()
    try:
        cur = conn.cursor()
        cur.execute(sql, params)
        row = cur.fetchone()
        cur.close()
        return row[0] if row else None
    finally:
        put_conn(conn)


def to_json_ready(item: Optional[Dict[str, Any]]):
    if not item:
        return item
    fixed = dict(item)
    for key, value in fixed.items():
        if isinstance(value, datetime):
            fixed[key] = value.isoformat()
    return fixed


def _mask_sensitive(value: Any):
    if isinstance(value, str) and len(value) > TRACKER_MASK_SUFFIX:
        return f"***{value[-TRACKER_MASK_SUFFIX:]}"
    if isinstance(value, str):
        return "***"
    return "***"


def tracker_payload(payload: Any):
    if isinstance(payload, dict):
        sanitized = {}
        for key, value in payload.items():
            normalized_key = str(key).lower()
            if (
                normalized_key in TRACKER_SENSITIVE_KEYS
                or "iin" in normalized_key
                or "ssn" in normalized_key
                or "password" in normalized_key
                or "api_key" in normalized_key
                or "email" in normalized_key
                or "phone" in normalized_key
                or "token" in normalized_key
                or "secret" in normalized_key
                or "authorization" in normalized_key
                or "cookie" in normalized_key
            ):
                sanitized[key] = _mask_sensitive(value)
            else:
                sanitized[key] = tracker_payload(value)
        return sanitized
    if isinstance(payload, list):
        return [tracker_payload(item) for item in payload]
    return payload


def track_request_event(
    request_id: str,
    stage: str,
    direction: str,
    title: str,
    *,
    service_id: Optional[str] = None,
    status: Optional[str] = None,
    payload: Any = None,
    correlation_id: Optional[str] = None,
):
    execute(
        """
        INSERT INTO request_tracker_events (request_id,stage,service_id,direction,status,title,payload,correlation_id)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
        """,
        (
            request_id,
            stage,
            service_id,
            direction,
            status,
            title,
            json.dumps(tracker_payload(payload)),
            correlation_id,
        ),
    )


def audit(entity_type: str, entity_id: Any, action: str, changes=None, performed_by: Optional[str] = None):
    execute(
        "INSERT INTO audit_log (entity_type,entity_id,action,changes,performed_by) VALUES (%s,%s,%s,%s,%s)",
        (entity_type, str(entity_id), action, json.dumps(changes or {}), performed_by),
    )
