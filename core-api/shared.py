import base64
import hashlib
import importlib
import json
import logging
import os
import sys
import time
import uuid
from contextvars import ContextVar
from datetime import datetime, timezone
from typing import Any, Dict, Optional


correlation_id: ContextVar[str] = ContextVar("correlation_id", default="")


def new_correlation_id() -> str:
    cid = str(uuid.uuid4())[:12]
    correlation_id.set(cid)
    return cid


def get_correlation_id() -> str:
    return correlation_id.get() or "no-cid"


class JSONFormatter(logging.Formatter):
    def format(self, record):
        return json.dumps(
            {
                "ts": datetime.now(timezone.utc).isoformat(),
                "level": record.levelname,
                "service": getattr(record, "service", os.getenv("SERVICE_NAME", "unknown")),
                "cid": get_correlation_id(),
                "msg": record.getMessage(),
                "module": record.module,
            },
            default=str,
        )


def get_logger(name: str) -> logging.Logger:
    logger = logging.getLogger(name)
    if not logger.handlers:
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(JSONFormatter())
        logger.addHandler(handler)
        logger.setLevel(logging.INFO)
    return logger


ENCRYPT_KEY = os.getenv("ENCRYPT_KEY", "default-dev-key-change-in-prod!!")


def _derive_hash(key: str) -> bytes:
    return hashlib.sha256(key.encode()).digest()


def _legacy_encrypt(value: str) -> str:
    key = _derive_hash(ENCRYPT_KEY)
    encrypted = bytes(b ^ key[i % len(key)] for i, b in enumerate(value.encode()))
    return "ENC:" + base64.b64encode(encrypted).decode()


def _legacy_decrypt(value: str) -> str:
    key = _derive_hash(ENCRYPT_KEY)
    data = base64.b64decode(value[4:])
    return bytes(b ^ key[i % len(key)] for i, b in enumerate(data)).decode()


def _load_fernet():
    cryptography_fernet = importlib.import_module("cryptography.fernet")
    fernet_key = base64.urlsafe_b64encode(_derive_hash(ENCRYPT_KEY))
    return cryptography_fernet.Fernet(fernet_key), cryptography_fernet.InvalidToken


def encrypt_field(value: str) -> str:
    if not value:
        return value
    fernet, _ = _load_fernet()
    return "ENC2:" + fernet.encrypt(value.encode()).decode()


def decrypt_field(value: str) -> str:
    if not value:
        return value
    if value.startswith("ENC2:"):
        fernet, invalid_token = _load_fernet()
        try:
            return fernet.decrypt(value[5:].encode()).decode()
        except invalid_token as exc:
            raise ValueError("invalid encrypted value") from exc
    if value.startswith("ENC:"):
        return _legacy_decrypt(value)
    return value


def mask_field(value: str) -> str:
    if not value:
        return value
    plain = decrypt_field(value) if value.startswith("ENC") else value
    if len(plain) <= 4:
        return "***"
    return "***" + plain[-4:]


SENSITIVE_FIELDS = {"ssn", "iin", "dateOfBirth"}


def encrypt_sensitive(data: dict) -> dict:
    result = dict(data)
    for field in SENSITIVE_FIELDS:
        if field in result and result[field] and not str(result[field]).startswith("ENC"):
            result[field] = encrypt_field(str(result[field]))
    return result


def decrypt_sensitive(data: dict) -> dict:
    result = dict(data)
    for field in SENSITIVE_FIELDS:
        if field in result and isinstance(result[field], str) and result[field].startswith("ENC"):
            result[field] = decrypt_field(result[field])
    return result


_db_pool = None
_pg_pool_module = None


def init_pool(minconn=2, maxconn=10):
    global _db_pool, _pg_pool_module
    if _db_pool is not None:
        return _db_pool
    psycopg2 = importlib.import_module("psycopg2")
    _pg_pool_module = importlib.import_module("psycopg2.pool")
    _db_pool = _pg_pool_module.ThreadedConnectionPool(
        minconn,
        maxconn,
        host=os.getenv("DB_HOST", "config-db"),
        port=int(os.getenv("DB_PORT", "5432")),
        dbname=os.getenv("DB_NAME", "config"),
        user=os.getenv("DB_USER", "config"),
        password=os.getenv("DB_PASSWORD", "config"),
    )
    return _db_pool


def get_conn():
    if _db_pool is None:
        init_pool()
    conn = _db_pool.getconn()
    try:
        conn.autocommit = True
        # Test the connection is alive (handles PostgreSQL restart)
        cur = conn.cursor()
        cur.execute("SELECT 1")
        cur.close()
        return conn
    except Exception:
        # Connection is stale — discard and get a fresh one
        try:
            _db_pool.putconn(conn, close=True)
        except Exception:
            pass
        conn = _db_pool.getconn()
        conn.autocommit = True
        return conn


def put_conn(conn):
    if _db_pool and conn is not None:
        try:
            _db_pool.putconn(conn)
        except Exception:
            # Connection already closed or pool is gone — ignore
            pass


def close_pool():
    global _db_pool
    if _db_pool:
        _db_pool.closeall()
        _db_pool = None


def _safe_scalar(sql: str, params=None):
    if _db_pool is None:
        return None
    conn = get_conn()
    try:
        cur = conn.cursor()
        cur.execute(sql, params)
        row = cur.fetchone()
        cur.close()
        return row[0] if row else None
    except Exception:
        return None
    finally:
        put_conn(conn)


_config_version_cache = {"value": 0, "expires": 0.0}
_config_version_local = 0


def _read_config_version():
    global _config_version_local
    now = time.time()
    if now < _config_version_cache["expires"]:
        return _config_version_cache["value"]
    version = _safe_scalar("SELECT value_text FROM system_state WHERE key='config_version'")
    if version is None:
        value = _config_version_local
    else:
        try:
            value = int(version)
        except (TypeError, ValueError):
            value = 0
        _config_version_local = value
    _config_version_cache["value"] = value
    _config_version_cache["expires"] = now + 2.0
    return value


def _bump_config_version():
    global _config_version_local
    if _db_pool is None:
        _config_version_local += 1
        _config_version_cache["value"] = _config_version_local
        _config_version_cache["expires"] = time.time() + 2.0
        return _config_version_local
    conn = get_conn()
    try:
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO system_state (key, value_text)
            VALUES ('config_version', '1')
            ON CONFLICT (key) DO UPDATE
            SET value_text = ((COALESCE(NULLIF(system_state.value_text, ''), '0'))::bigint + 1)::text,
                updated_at = NOW()
            RETURNING value_text
            """
        )
        value = int(cur.fetchone()[0])
        cur.close()
        _config_version_local = value
        _config_version_cache["value"] = value
        _config_version_cache["expires"] = time.time() + 2.0
        return value
    except Exception:
        _config_version_local += 1
        _config_version_cache["value"] = _config_version_local
        _config_version_cache["expires"] = time.time() + 2.0
        return _config_version_local
    finally:
        put_conn(conn)


class VersionedTTLCache:
    def __init__(self, ttl_seconds: float = 30.0):
        self.ttl = ttl_seconds
        self._store: Dict[str, tuple] = {}

    def get(self, key: str) -> Optional[Any]:
        if key not in self._store:
            return None
        value, expires_at, version = self._store[key]
        if time.time() >= expires_at:
            del self._store[key]
            return None
        if version != _read_config_version():
            del self._store[key]
            return None
        return value

    def set(self, key: str, value: Any):
        self._store[key] = (value, time.time() + self.ttl, _read_config_version())

    def invalidate(self, prefix: str = ""):
        if prefix:
            keys = [key for key in self._store if key.startswith(prefix)]
            for key in keys:
                del self._store[key]
        else:
            self._store.clear()
        _bump_config_version()


config_cache = VersionedTTLCache(ttl_seconds=30.0)


_rate_limit_fallback: Dict[str, list] = {}


def check_rate_limit(bucket_key: str, limit: int, window_seconds: int = 60) -> bool:
    bucket_start = int(time.time() // window_seconds) * window_seconds
    if _db_pool is not None:
        conn = get_conn()
        try:
            cur = conn.cursor()
            cur.execute(
                """
                INSERT INTO rate_limit_buckets (bucket_key, window_start, hits)
                VALUES (%s, %s, 1)
                ON CONFLICT (bucket_key, window_start) DO UPDATE
                SET hits = rate_limit_buckets.hits + 1,
                    updated_at = NOW()
                RETURNING hits
                """,
                (bucket_key, bucket_start),
            )
            hits = int(cur.fetchone()[0])
            cur.execute("DELETE FROM rate_limit_buckets WHERE window_start < %s", (bucket_start - window_seconds * 2,))
            cur.close()
            return hits <= limit
        except Exception:
            pass
        finally:
            put_conn(conn)

    now = time.time()
    hits = _rate_limit_fallback.setdefault(bucket_key, [])
    hits[:] = [value for value in hits if now - value < window_seconds]
    if len(hits) >= limit:
        return False
    hits.append(now)
    return True


_breaker_fallback: Dict[str, Dict[str, Any]] = {}


class CircuitBreaker:
    def __init__(self, service_id: str, threshold: int = 5, window: float = 60.0, cooldown: float = 30.0):
        self.service_id = service_id
        self.threshold = threshold
        self.window = window
        self.cooldown = cooldown

    def _default_state(self):
        return {"state": "CLOSED", "failures": [], "opened_at": 0.0}

    def _load_state(self):
        fallback = _breaker_fallback.get(self.service_id, self._default_state())
        if _db_pool is None:
            return fallback
        conn = get_conn()
        try:
            cur = conn.cursor()
            cur.execute(
                "SELECT state, opened_at_epoch, failures_json FROM circuit_breakers WHERE service_id=%s",
                (self.service_id,),
            )
            row = cur.fetchone()
            cur.close()
            if not row:
                return fallback
            state, opened_at_epoch, failures_json = row
            if isinstance(failures_json, str):
                failures = json.loads(failures_json or "[]")
            elif isinstance(failures_json, list):
                failures = failures_json
            else:
                failures = []
            return {"state": state or "CLOSED", "opened_at": float(opened_at_epoch or 0.0), "failures": failures}
        except Exception:
            return fallback
        finally:
            put_conn(conn)

    def _save_state(self, state: Dict[str, Any]):
        _breaker_fallback[self.service_id] = dict(state)
        if _db_pool is None:
            return
        conn = get_conn()
        try:
            cur = conn.cursor()
            cur.execute(
                """
                INSERT INTO circuit_breakers (service_id, state, opened_at_epoch, failures_json)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (service_id) DO UPDATE
                SET state = EXCLUDED.state,
                    opened_at_epoch = EXCLUDED.opened_at_epoch,
                    failures_json = EXCLUDED.failures_json,
                    updated_at = NOW()
                """,
                (self.service_id, state["state"], float(state["opened_at"]), json.dumps(state["failures"])),
            )
            cur.close()
        except Exception:
            pass
        finally:
            put_conn(conn)

    @property
    def state(self) -> str:
        state = self._load_state()
        if state["state"] == "OPEN" and time.time() - float(state["opened_at"]) >= self.cooldown:
            state["state"] = "HALF_OPEN"
            self._save_state(state)
        return state["state"]

    def record_success(self):
        self._save_state({"state": "CLOSED", "failures": [], "opened_at": 0.0})

    def record_failure(self):
        state = self._load_state()
        now = time.time()
        failures = [value for value in state["failures"] if now - value < self.window]
        failures.append(now)
        breaker_state = "OPEN" if len(failures) >= self.threshold else state.get("state", "CLOSED")
        opened_at = now if breaker_state == "OPEN" else 0.0
        self._save_state({"state": breaker_state, "failures": failures, "opened_at": opened_at})

    def allow_request(self) -> bool:
        current_state = self.state
        return current_state in {"CLOSED", "HALF_OPEN"}

    def to_dict(self) -> dict:
        state = self._load_state()
        return {
            "state": self.state,
            "failures": len(state["failures"]),
            "threshold": self.threshold,
            "window": self.window,
            "cooldown": self.cooldown,
        }


_breakers: Dict[str, CircuitBreaker] = {}


def get_breaker(service_id: str) -> CircuitBreaker:
    if service_id not in _breakers:
        _breakers[service_id] = CircuitBreaker(service_id)
    return _breakers[service_id]


def all_breaker_states() -> Dict[str, dict]:
    return {service_id: breaker.to_dict() for service_id, breaker in _breakers.items()}


class Metrics:
    def __init__(self):
        self._counters: Dict[str, int] = {}
        self._histograms: Dict[str, list] = {}

    def inc(self, name: str, labels: str = "", amount: int = 1):
        key = f"{name}{{{labels}}}" if labels else name
        self._counters[key] = self._counters.get(key, 0) + amount

    def observe(self, name: str, value: float, labels: str = ""):
        key = f"{name}{{{labels}}}" if labels else name
        self._histograms.setdefault(key, []).append(value)
        if len(self._histograms[key]) > 1000:
            self._histograms[key] = self._histograms[key][-500:]

    def to_prometheus(self) -> str:
        lines = []
        for key, value in self._counters.items():
            lines.append(f"# TYPE {key.split('{')[0]} counter")
            lines.append(f"{key} {value}")
        for key, values in self._histograms.items():
            name = key.split("{")[0]
            lines.append(f"# TYPE {name} summary")
            if values:
                lines.append(f'{key.replace("}", ",quantile=\"0.5\"}")} {sorted(values)[len(values)//2]}')
                lines.append(f"{key}_count {len(values)}")
                lines.append(f"{key}_sum {sum(values)}")
        return "\n".join(lines) + "\n"


metrics = Metrics()


async def resilient_post(service_id: str, url: str, json_data: dict, timeout: float = 10.0, max_retries: int = 2, cid: str = "") -> Dict[str, Any]:
    httpx = importlib.import_module("httpx")
    breaker = get_breaker(service_id)
    log = get_logger(service_id)

    if not breaker.allow_request():
        log.warning(f"circuit OPEN for {service_id}, skipping")
        metrics.inc("circuit_breaker_rejections", f'service="{service_id}"')
        return {"status": "CIRCUIT_OPEN", "service": service_id}

    last_error = None
    for attempt in range(max_retries + 1):
        start = time.time()
        try:
            headers = {"X-Correlation-ID": cid or get_correlation_id()}
            async with httpx.AsyncClient(timeout=timeout) as client:
                response = await client.post(url, json=json_data, headers=headers)
            elapsed = time.time() - start
            metrics.observe("http_request_duration_seconds", elapsed, f'service="{service_id}"')
            if response.status_code < 400:
                breaker.record_success()
                metrics.inc("http_requests_total", f'service="{service_id}",status="success"')
                return response.json()
            last_error = f"HTTP {response.status_code}"
            breaker.record_failure()
        except Exception as exc:
            elapsed = time.time() - start
            metrics.observe("http_request_duration_seconds", elapsed, f'service="{service_id}"')
            last_error = str(exc)
            breaker.record_failure()
            log.warning(f"attempt {attempt + 1}/{max_retries + 1} failed for {service_id}: {exc}")

        if attempt < max_retries:
            import asyncio

            await asyncio.sleep(0.5 * (2 ** attempt))

    metrics.inc("http_requests_total", f'service="{service_id}",status="failure"')
    return {"status": "UNAVAILABLE", "service": service_id, "error": last_error}
