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


def _provider_status(data: Dict[str, Any], *, fallback: str, no_hit_status: str = "NO_HIT") -> str:
    upstream_status = str(_nested(data, "status") or _nested(data, "result", "status") or "").upper()
    indicator = str(_nested(data, "intelligenceIndicator") or _nested(data, "rawResponse", "intelligenceIndicator") or "").upper()
    if upstream_status in {"FAILED", "ERROR"}:
        return "FAILED"
    if upstream_status == "PENDING" or indicator == "PENDING_LINK":
        return "PENDING_LINK"
    if upstream_status == "NO_HIT" or indicator == "NO_HIT":
        return no_hit_status
    if upstream_status in {"COMPLETED", "REPORT_READY"}:
        return fallback
    return fallback


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
    status = _provider_status(data, fallback="OK")
    if status == "OK" and not bureau_hit:
        status = "NO_HIT"
    return {
        "provider": "isoftpull",
        "credit_score": int(credit_score) if credit_score is not None else None,
        "collection_count": int(collection_count),
        "bureau_hit": bureau_hit,
        "status": status,
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
        "status": _provider_status(data, fallback="OK", no_hit_status="NO_DATA") if (company_score is not None or effective_alert_count is not None) else _provider_status(data, fallback="NO_DATA", no_hit_status="NO_DATA"),
    }


def _extract_plaid(data: dict) -> dict:
    r = data.get("result", data)
    accounts_found = _first_count(
        data,
        (
            ("accounts_found",),
            ("accountsFound",),
            ("result", "accounts_found"),
            ("result", "accountsFound"),
            ("rawResponse", "accounts_found"),
            ("rawResponse", "accountsFound"),
            ("rawResponse", "accounts"),
            ("rawResponse", "bankAccounts"),
        ),
    ) or 0
    status = _provider_status(data, fallback="OK", no_hit_status="NO_ACCOUNTS")
    if status == "OK" and accounts_found <= 0:
        status = "NO_ACCOUNTS"
    return {
        "provider": "plaid",
        "accounts_found": accounts_found,
        "cashflow_stability": (
            r.get("cashflow_stability")
            or _nested(data, "cashflowStability")
            or _nested(data, "rawResponse", "cashflowStability")
        ),
        "tracking_url": (
            data.get("reportUrl")
            or _nested(data, "rawResponse", "trackingUrl")
            or _nested(data, "rawResponse", "hostedLinkUrl")
        ),
        "report_ready": bool(
            _nested(data, "reportReady")
            or _nested(data, "rawResponse", "reportReady")
            or _nested(data, "rawResponse", "report_ready")
        ),
        "status": status,
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
    }
    providers = {}
    for key, data in body.steps.items():
        if key in extractors and isinstance(data, dict):
            providers[key] = extractors[key](data)
    iso = providers.get("isoftpull", {})
    creditsafe = providers.get("creditsafe", {})
    plaid = providers.get("plaid", {})
    iso_status = iso.get("status")
    creditsafe_status = creditsafe.get("status")
    plaid_status = plaid.get("status")
    required_reports_available = iso_status not in {"UNAVAILABLE", "FAILED"} and creditsafe_status not in {"UNAVAILABLE", "FAILED"}
    all_providers_ok = all(p.get("status") == "OK" for p in providers.values()) if providers else False
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
            "iso_status": iso_status,
            "creditsafe_status": creditsafe_status,
            "plaid_status": plaid_status,
            "plaid_tracking_url": plaid.get("tracking_url"),
            "plaid_report_ready": plaid.get("report_ready", False),
            "required_reports_available": required_reports_available,
            "all_providers_ok": all_providers_ok,
        },
    }
