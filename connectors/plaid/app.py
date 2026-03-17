"""Plaid connector proxying requests to the unified applicant backend."""
import os
import time
from typing import Any, Dict

import httpx
from fastapi import FastAPI, HTTPException

SERVICE_NAME = "plaid"
CONFIG_SERVICE_URL = os.getenv("CONFIG_SERVICE_URL", "http://core-api:8000").rstrip("/")
INTERNAL_API_KEY = os.getenv("INTERNAL_API_KEY", "")
CREDIT_BACKEND_DEFAULT_URL = (os.getenv("CREDIT_BACKEND_DEFAULT_URL", "http://18.119.38.114") or "http://18.119.38.114").strip().rstrip("/")
APPLICANT_FIELDS = (
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

app = FastAPI(title=SERVICE_NAME, version="3.0.0")

_cache: Dict[str, tuple] = {}


def _internal_headers():
    return {"X-Internal-Api-Key": INTERNAL_API_KEY} if INTERNAL_API_KEY else {}


async def _acfg(path: str, ttl: int = 30):
    if path in _cache:
        value, expires_at = _cache[path]
        if time.time() < expires_at:
            return value
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(f"{CONFIG_SERVICE_URL}{path}", headers=_internal_headers())
        value = response.json() if response.status_code == 200 else {}
    except Exception:
        value = {}
    _cache[path] = (value, time.time() + ttl)
    return value


async def _credit_backend_cfg():
    cfg = await _acfg("/api/v1/services/credit-backend")
    return {
        "base_url": (str(cfg.get("base_url") or CREDIT_BACKEND_DEFAULT_URL)).rstrip("/"),
        "timeout": max(5.0, float(cfg.get("timeout_ms", 15000)) / 1000),
    }


async def _credit_backend_request(method: str, path: str, *, body: Dict[str, Any] | None = None):
    cfg = await _credit_backend_cfg()
    url = f"{cfg['base_url']}{path if path.startswith('/') else f'/{path}'}"
    try:
        async with httpx.AsyncClient(timeout=cfg["timeout"]) as client:
            response = await client.request(method, url, json=body)
    except Exception as exc:
        raise HTTPException(502, f"credit backend unavailable: {exc}") from exc

    payload: Any
    if not response.content:
        payload = {}
    else:
        try:
            payload = response.json()
        except ValueError:
            payload = {"raw": response.text}

    if response.status_code >= 400:
        raise HTTPException(response.status_code if response.status_code < 500 else 502, payload)
    return payload


def _clean_text(value: Any) -> str:
    return str(value or "").strip()


def _extract_applicant(body: Dict[str, Any]) -> Dict[str, Any]:
    source = body.get("applicant") if isinstance(body.get("applicant"), dict) else body
    return {field: _clean_text(source.get(field)) for field in APPLICANT_FIELDS if _clean_text(source.get(field))}


async def _ensure_external_applicant_id(body: Dict[str, Any]) -> str:
    payload = body.get("payload") if isinstance(body.get("payload"), dict) else {}
    existing = (
        _clean_text(body.get("external_applicant_id"))
        or _clean_text(body.get("externalApplicantId"))
        or _clean_text(payload.get("external_applicant_id"))
        or _clean_text(payload.get("externalApplicantId"))
    )
    if existing:
        return existing

    applicant = _extract_applicant(body)
    missing = [field for field in APPLICANT_FIELDS if field not in applicant]
    if missing:
        raise HTTPException(400, f"missing applicant fields for upstream create: {', '.join(missing)}")

    created = await _credit_backend_request("POST", "/api/v1/applicants", body=applicant)
    applicant_id = _clean_text((created or {}).get("id"))
    if not applicant_id:
        raise HTTPException(502, "credit backend returned applicant without id")
    return applicant_id


@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": SERVICE_NAME,
        "mode": "proxy",
        "upstream_service_id": "credit-backend",
    }


@app.post("/api/accounts")
async def handle(body: Dict[str, Any]):
    applicant_id = await _ensure_external_applicant_id(body)
    upstream = await _credit_backend_request("POST", f"/api/v1/applicants/{applicant_id}/credit-check/plaid")
    if isinstance(upstream, dict):
        payload = dict(upstream)
        payload["external_applicant_id"] = applicant_id
        payload["service"] = SERVICE_NAME
        return payload
    return {"service": SERVICE_NAME, "external_applicant_id": applicant_id, "upstream": upstream}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8103)
