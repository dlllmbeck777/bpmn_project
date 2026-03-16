"""Report parser normalizes connector responses into decision-ready metrics."""
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, Optional

from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI(title="report-parser", version="4.1.0")


class ParseRequest(BaseModel):
    request_id: str
    steps: Dict[str, Any] = {}


def _nested(data: Any, *path: Any) -> Any:
    current = data
    for key in path:
        if isinstance(current, dict):
            current = current.get(key)
        elif isinstance(current, list) and isinstance(key, int) and 0 <= key < len(current):
            current = current[key]
        else:
            return None
    return current


def _as_number(value: Any) -> Optional[float]:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        cleaned = value.strip().replace(",", "")
        if not cleaned or cleaned.upper() in {"N/A", "NA", "NULL"}:
            return None
        try:
            return float(cleaned)
        except ValueError:
            return None
    return None


def _as_int(value: Any, default: int = 0) -> int:
    number = _as_number(value)
    return int(number) if number is not None else default


def _first_number(data: Dict[str, Any], paths: Iterable[Iterable[Any]]) -> Optional[float]:
    for path in paths:
        value = _as_number(_nested(data, *path))
        if value is not None:
            return value
    return None


def _first_count(data: Dict[str, Any], paths: Iterable[Iterable[Any]]) -> Optional[int]:
    for path in paths:
        value = _nested(data, *path)
        if isinstance(value, list):
            return len(value)
        number = _as_number(value)
        if number is not None:
            return int(number)
    return None


def _bureau_collection_total(accounts: Any) -> int:
    if not isinstance(accounts, list):
        return 0
    total = 0
    for account in accounts:
        if not isinstance(account, dict):
            continue
        total += _as_int(account.get("30_day_delinquencies"))
        total += _as_int(account.get("60_day_delinquencies"))
        total += _as_int(account.get("90_day_delinquencies"))
    return total


def _extract_isoftpull(data: dict) -> dict:
    r = data.get("result", data)
    credit_score = _first_number(
        data,
        (
            ("creditScore",),
            ("result", "creditScore"),
            ("result", "credit_score"),
            ("result", "score"),
            ("rawResponse", "firstScore"),
            ("rawResponse", "creditScore"),
            ("equifaxScore",),
            ("transunionScore",),
            ("rawResponse", "equifaxScore"),
            ("rawResponse", "transunionScore"),
            ("rawResponse", "reports", "equifax", "full_feed", "credit_score", "fico_8", "scoreValue"),
            ("rawResponse", "reports", "equifax", "full_feed", "credit_score", "fico_8", "score"),
            ("rawResponse", "reports", "transunion", "full_feed", "credit_score", "fico_8", "scoreValue"),
            ("rawResponse", "reports", "transunion", "full_feed", "credit_score", "fico_8", "score"),
            ("rawResponse", "reports", "experian", "full_feed", "credit_score", "fico_8", "scoreValue"),
            ("rawResponse", "reports", "experian", "full_feed", "credit_score", "fico_8", "score"),
        ),
    )
    explicit_collection_count = _first_count(
        data,
        (
            ("collectionCount",),
            ("collection_count",),
            ("collections",),
            ("result", "collectionCount"),
            ("result", "collection_count"),
            ("result", "collections"),
            ("rawResponse", "collectionCount"),
            ("rawResponse", "collection_count"),
            ("rawResponse", "collections"),
        ),
    )
    bureau_totals = [
        _bureau_collection_total(_nested(data, "rawResponse", "reports", "equifax", "full_feed", "trade_accounts")),
        _bureau_collection_total(_nested(data, "rawResponse", "reports", "transunion", "full_feed", "trade_accounts")),
        _bureau_collection_total(_nested(data, "rawResponse", "reports", "experian", "full_feed", "trade_accounts")),
        _bureau_collection_total(_nested(data, "rawResponse", "trade_accounts")),
    ]
    collection_count = explicit_collection_count if explicit_collection_count is not None else max(bureau_totals or [0])
    bureau_hit = bool(r.get("bureau_hit", credit_score is not None))
    return {
        "provider": "isoftpull",
        "credit_score": int(credit_score) if credit_score is not None else None,
        "collection_count": int(collection_count),
        "bureau_hit": bureau_hit,
        "status": "OK" if bureau_hit else "NO_HIT",
    }


def _extract_creditsafe(data: dict) -> dict:
    r = data.get("result", data)
    company_score = _first_number(
        data,
        (
            ("creditScore",),
            ("result", "creditScore"),
            ("rawResponse", "businessCredit", "riskScore"),
            ("rawResponse", "bestMatch", "company", "rating"),
        ),
    )
    compliance_alert_count = _first_count(
        data,
        (
            ("complianceAlertCount",),
            ("compliance_alert_count",),
            ("result", "complianceAlertCount"),
            ("result", "compliance_alert_count"),
            ("rawResponse", "complianceAlertCount"),
            ("rawResponse", "compliance_alert_count"),
            ("rawResponse", "complianceAlerts"),
            ("rawResponse", "alerts"),
            ("rawResponse", "compliance", "alerts"),
            ("rawResponse", "complianceResult", "alerts"),
            ("rawResponse", "bestMatch", "complianceAlerts"),
        ),
    )
    derogatory_count = _first_count(
        data,
        (
            ("rawResponse", "bestMatch", "company", "derogatoryCount"),
            ("rawResponse", "businessCredit", "derogatoryCount"),
        ),
    )
    effective_alert_count = compliance_alert_count if compliance_alert_count is not None else (derogatory_count or 0)
    return {
        "provider": "creditsafe",
        "company_score": int(company_score) if company_score is not None else r.get("company_score"),
        "risk_band": r.get("risk_band"),
        "compliance_alert_count": int(effective_alert_count),
        "derogatory_count": int(derogatory_count or 0),
        "status": "OK" if company_score is not None or effective_alert_count is not None else "NO_DATA",
    }


def _extract_plaid(data: dict) -> dict:
    r = data.get("result", data)
    return {
        "provider": "plaid",
        "accounts_found": r.get("accounts_found", 0),
        "cashflow_stability": r.get("cashflow_stability"),
        "status": "OK" if r.get("accounts_found", 0) > 0 else "NO_ACCOUNTS",
    }


def _extract_crm(data: dict) -> dict:
    r = data.get("result", data)
    return {
        "provider": "crm",
        "crm_updated": r.get("crm_updated", False),
        "segment": r.get("segment"),
        "status": "OK" if r.get("crm_updated") else "NO_UPDATE",
    }


@app.get("/health")
def health():
    return {"status": "ok", "service": "report-parser"}


@app.post("/api/v1/parse")
def parse(body: ParseRequest):
    extractors = {
        "isoftpull": _extract_isoftpull,
        "creditsafe": _extract_creditsafe,
        "plaid": _extract_plaid,
        "crm": _extract_crm,
    }
    providers = {}
    for key, data in body.steps.items():
        if key in extractors and isinstance(data, dict):
            providers[key] = extractors[key](data)
    iso = providers.get("isoftpull", {})
    creditsafe = providers.get("creditsafe", {})
    plaid = providers.get("plaid", {})
    crm = providers.get("crm", {})
    return {
        "status": "OK",
        "request_id": body.request_id,
        "parsed_at": datetime.now(timezone.utc).isoformat(),
        "providers": providers,
        "summary": {
            "credit_score": iso.get("credit_score"),
            "collection_count": iso.get("collection_count", 0),
            "creditsafe_compliance_alert_count": creditsafe.get("compliance_alert_count", 0),
            "accounts_found": plaid.get("accounts_found", 0),
            "cashflow_stability": plaid.get("cashflow_stability"),
            "crm_segment": crm.get("segment"),
            "all_providers_ok": all(p.get("status") == "OK" for p in providers.values()),
        },
    }
