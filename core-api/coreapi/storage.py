import json
from datetime import datetime
from typing import Any, Dict, Optional

from shared import get_conn, put_conn


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


def to_json_ready(item: Optional[Dict[str, Any]]):
    if not item:
        return item
    fixed = dict(item)
    for key, value in fixed.items():
        if isinstance(value, datetime):
            fixed[key] = value.isoformat()
    return fixed


def audit(entity_type: str, entity_id: Any, action: str, changes=None):
    execute(
        "INSERT INTO audit_log (entity_type,entity_id,action,changes) VALUES (%s,%s,%s,%s)",
        (entity_type, str(entity_id), action, json.dumps(changes or {})),
    )

