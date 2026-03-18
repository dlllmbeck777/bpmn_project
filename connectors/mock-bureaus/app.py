"""Unified mock applicant backend for iSoftPull, Creditsafe, and Plaid."""
from __future__ import annotations

import os
import re
import random
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from threading import RLock
from typing import Any, Dict, List
from uuid import uuid4

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI(title="mock-bureaus", version="2.0.0")

SERVICE_NAME = "mock-bureaus"
MOCK_PUBLIC_BASE_URL = (os.getenv("MOCK_PUBLIC_BASE_URL", "http://mock-bureaus:8110") or "http://mock-bureaus:8110").strip().rstrip("/")
MOCK_UPSTREAM_LABEL = (os.getenv("MOCK_UPSTREAM_LABEL", MOCK_PUBLIC_BASE_URL) or MOCK_PUBLIC_BASE_URL).strip().rstrip("/")
MOCK_MODES = {"scenario", "random", "custom"}
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


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    normalized = str(value).replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(normalized)
    except ValueError:
        return None


def _deep_merge(base: Dict[str, Any], updates: Dict[str, Any]) -> Dict[str, Any]:
    merged = deepcopy(base)
    for key, value in (updates or {}).items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = _deep_merge(merged[key], value)
        else:
            merged[key] = deepcopy(value)
    return merged


def _clean_text(value: Any) -> str:
    return str(value or "").strip()


def _to_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _to_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _to_bool(value: Any) -> bool | None:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"true", "1", "yes", "y", "on"}:
            return True
        if normalized in {"false", "0", "no", "n", "off"}:
            return False
    return None


def _clamp(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, value))


def _provider_key(provider: str) -> str:
    normalized = (provider or "").strip().lower()
    aliases = {
        "isoftpull": "isoftpull",
        "creditsafe": "creditsafe",
        "plaid": "plaid",
    }
    if normalized not in aliases:
        raise HTTPException(404, f"unsupported provider: {provider}")
    return aliases[normalized]


def _scenario_supported(provider: str, scenario: str) -> bool:
    scenario = str(scenario or "").strip()
    if scenario in SCENARIO_CATALOG.get(provider, {}):
        return True
    dynamic_patterns = {
        "isoftpull": (
            r"pass_\d+",
            r"reject_score_\d+",
            r"reject_collections_\d+",
        ),
        "creditsafe": (
            r"clean_\d+",
            r"reject_alerts_\d+",
        ),
        "plaid": (
            r"accounts_\d+",
        ),
    }
    return any(re.fullmatch(pattern, scenario) for pattern in dynamic_patterns.get(provider, ()))


def _normalize_mode(mode: Any) -> str:
    normalized = str(mode or "scenario").strip().lower() or "scenario"
    if normalized not in MOCK_MODES:
        raise HTTPException(400, f"unsupported mock mode '{mode}'")
    return normalized


def _rng(provider: str, controls: Dict[str, Any]) -> random.Random:
    seed = controls.get("seed")
    if seed in (None, ""):
        return random.Random()
    return random.Random(f"{provider}:{seed}")


def _random_int(controls: Dict[str, Any], key: str, minimum: int, maximum: int, rng: random.Random) -> int:
    exact_value = controls.get(key)
    if exact_value is not None:
        return _to_int(exact_value, minimum)
    lower = _to_int(controls.get(f"{key}Min"), minimum)
    upper = _to_int(controls.get(f"{key}Max"), maximum)
    if upper < lower:
        lower, upper = upper, lower
    return rng.randint(lower, upper)


def _random_choice(controls: Dict[str, Any], key: str, options: List[Any], rng: random.Random, default: Any = None) -> Any:
    exact_value = controls.get(key)
    if exact_value not in (None, ""):
        return exact_value
    custom_options = controls.get(f"{key}Options")
    if isinstance(custom_options, list) and custom_options:
        options = custom_options
    if not options:
        return default
    return rng.choice(options)


def _random_bool(controls: Dict[str, Any], key: str, *, chance_key: str, default_chance: float, rng: random.Random) -> bool:
    exact_value = _to_bool(controls.get(key))
    if exact_value is not None:
        return exact_value
    chance = _clamp(_to_float(controls.get(chance_key), default_chance), 0.0, 1.0)
    return rng.random() < chance


def _request_id(body: Dict[str, Any]) -> str:
    return str(body.get("request_id") or f"MOCK-{uuid4().hex[:12].upper()}")


def _customer_id(body: Dict[str, Any]) -> str:
    return str(body.get("customer_id") or "MOCK-CUSTOMER")


def _applicant_names(body: Dict[str, Any]) -> Dict[str, str]:
    applicant = body.get("applicant") if isinstance(body.get("applicant"), dict) else body
    first_name = applicant.get("firstName") or applicant.get("first_name") or "John"
    last_name = applicant.get("lastName") or applicant.get("last_name") or "Doe"
    return {"first_name": str(first_name), "last_name": str(last_name)}


def _public_applicant_record(applicant: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": applicant["id"],
        "firstName": applicant["firstName"],
        "lastName": applicant["lastName"],
        "address": applicant["address"],
        "city": applicant["city"],
        "state": applicant["state"],
        "zipCode": applicant["zipCode"],
        "createdAt": applicant["createdAt"],
        "updatedAt": applicant["updatedAt"],
    }


def _extract_external_applicant_id(body: Dict[str, Any]) -> int:
    payload = body.get("payload") if isinstance(body.get("payload"), dict) else {}
    return _to_int(
        body.get("external_applicant_id")
        or body.get("externalApplicantId")
        or payload.get("external_applicant_id")
        or payload.get("externalApplicantId"),
        0,
    )


def _extract_applicant_payload(body: Dict[str, Any]) -> Dict[str, Any]:
    payload = body.get("payload") if isinstance(body.get("payload"), dict) else {}
    candidates = []
    if isinstance(body.get("applicant"), dict):
        candidates.append(body["applicant"])
    if isinstance(payload.get("applicant"), dict):
        candidates.append(payload["applicant"])
    candidates.append(body)

    merged: Dict[str, Any] = {}
    for source in candidates:
        for field in APPLICANT_FIELDS:
            value = _clean_text(source.get(field))
            if value:
                merged[field] = value
    return merged


def _provider_request_body(applicant: Dict[str, Any], body: Dict[str, Any] | None = None) -> Dict[str, Any]:
    request_body = deepcopy(body or {})
    applicant_payload = _extract_applicant_payload(request_body) or {
        field: applicant.get(field, "")
        for field in APPLICANT_FIELDS
        if _clean_text(applicant.get(field))
    }
    merged = {
        **deepcopy(applicant),
        **{field: value for field, value in applicant_payload.items() if value},
        "applicant": applicant_payload,
    }
    if isinstance(request_body, dict):
        for key in ("request_id", "customer_id", "product_type", "iin"):
            value = request_body.get(key)
            if value not in (None, ""):
                merged[key] = value
    merged["external_applicant_id"] = str(applicant["id"])
    return merged


def _provider_catalog() -> List[Dict[str, Any]]:
    return [
        {
            "code": "ISOFTPULL",
            "providerCode": "ISOFTPULL",
            "providerName": "iSoftPull",
            "name": "iSoftPull",
            "enabled": True,
            "available": True,
            "status": "ENABLED",
            "type": "consumer_credit",
            "server": MOCK_UPSTREAM_LABEL,
            "endpoint": f"{MOCK_PUBLIC_BASE_URL}/api/v1/applicants/{{id}}/credit-check/isoftpull",
        },
        {
            "code": "CREDITSAFE",
            "providerCode": "CREDITSAFE",
            "providerName": "Creditsafe",
            "name": "Creditsafe",
            "enabled": True,
            "available": True,
            "status": "ENABLED",
            "type": "business_credit",
            "server": MOCK_UPSTREAM_LABEL,
            "endpoint": f"{MOCK_PUBLIC_BASE_URL}/api/v1/applicants/{{id}}/credit-check/creditsafe",
        },
        {
            "code": "PLAID",
            "providerCode": "PLAID",
            "providerName": "Plaid",
            "name": "Plaid",
            "enabled": True,
            "available": True,
            "status": "ENABLED",
            "type": "bank_link",
            "server": MOCK_UPSTREAM_LABEL,
            "endpoint": f"{MOCK_PUBLIC_BASE_URL}/api/v1/applicants/{{id}}/credit-check/plaid",
        },
    ]


def _iso_trade_accounts(collection_count: int) -> list[Dict[str, Any]]:
    if collection_count <= 0:
        return [
            {
                "company": "CHASE",
                "account_status": "Open",
                "account_rating": "PAYS ACCOUNT AS AGREED",
                "30_day_delinquencies": "0",
                "60_day_delinquencies": "0",
                "90_day_delinquencies": "0",
            }
        ]

    remaining = collection_count
    accounts = []
    thirty = min(remaining, 4)
    remaining -= thirty
    sixty = min(remaining, 2)
    remaining -= sixty
    ninety = remaining
    accounts.append(
        {
            "company": "ABC BANK",
            "account_status": "Open",
            "account_rating": "NOT MORE THAN FOUR PAYMENTS PAST DUE",
            "30_day_delinquencies": str(thirty),
            "60_day_delinquencies": str(sixty),
            "90_day_delinquencies": str(ninety),
        }
    )
    return accounts


def _plaid_tracking_url(tracking_id: str) -> str:
    return f"{MOCK_PUBLIC_BASE_URL}/api/v1/plaid/link/{tracking_id}"


def _iso_defaults_for_scenario(scenario: str) -> Dict[str, Any]:
    defaults = {
        "pass_775": {"status": "COMPLETED", "creditScore": 775, "collectionCount": 0, "bureauHit": True, "intelligenceIndicator": "PASS"},
        "reject_score_550": {"status": "COMPLETED", "creditScore": 550, "collectionCount": 0, "bureauHit": True, "intelligenceIndicator": "PASS"},
        "reject_collections_6": {"status": "COMPLETED", "creditScore": 720, "collectionCount": 6, "bureauHit": True, "intelligenceIndicator": "PASS"},
        "no_hit": {"status": "NO_HIT", "creditScore": None, "collectionCount": 0, "bureauHit": False, "intelligenceIndicator": "NO_HIT"},
    }
    if scenario not in defaults:
        if match := re.fullmatch(r"pass_(\d+)", scenario):
            defaults[scenario] = {
                "status": "COMPLETED",
                "creditScore": _to_int(match.group(1)),
                "collectionCount": 0,
                "bureauHit": True,
                "intelligenceIndicator": "PASS",
            }
        elif match := re.fullmatch(r"reject_score_(\d+)", scenario):
            defaults[scenario] = {
                "status": "COMPLETED",
                "creditScore": _to_int(match.group(1)),
                "collectionCount": 0,
                "bureauHit": True,
                "intelligenceIndicator": "PASS",
            }
        elif match := re.fullmatch(r"reject_collections_(\d+)", scenario):
            defaults[scenario] = {
                "status": "COMPLETED",
                "creditScore": 720,
                "collectionCount": _to_int(match.group(1)),
                "bureauHit": True,
                "intelligenceIndicator": "PASS",
            }
    return defaults.get(scenario, defaults["pass_775"])


def _resolve_iso_controls(config: Dict[str, Any]) -> Dict[str, Any]:
    scenario = str(config.get("scenario") or "pass_775")
    controls = deepcopy(config.get("controls", {}))
    mode = _normalize_mode(config.get("mode"))
    if mode != "random":
        return _deep_merge(_iso_defaults_for_scenario(scenario), controls)

    randomizer = _rng("isoftpull", controls)
    explicit_bureau_hit = _to_bool(controls.get("bureauHit"))
    if explicit_bureau_hit is None:
        bureau_hit = not _random_bool(controls, "noHit", chance_key="noHitChance", default_chance=0.12, rng=randomizer)
    else:
        bureau_hit = explicit_bureau_hit
    if not bureau_hit:
        return {
            "status": str(controls.get("status") or "NO_HIT"),
            "creditScore": None,
            "collectionCount": 0,
            "bureauHit": False,
            "intelligenceIndicator": str(controls.get("intelligenceIndicator") or "NO_HIT"),
        }

    credit_score = _random_int(controls, "creditScore", 300, 850, randomizer)
    collection_count = _random_int(controls, "collectionCount", 0, 8, randomizer)
    return {
        "status": str(controls.get("status") or "COMPLETED"),
        "creditScore": credit_score,
        "collectionCount": collection_count,
        "bureauHit": True,
        "intelligenceIndicator": str(controls.get("intelligenceIndicator") or "PASS"),
    }


def _creditsafe_defaults_for_scenario(scenario: str) -> Dict[str, Any]:
    defaults = {
        "clean_72": {
            "status": "COMPLETED",
            "creditScore": 72,
            "complianceAlertCount": 0,
            "derogatoryCount": 0,
            "intelligenceIndicator": "MULTIPLE_MATCHES",
            "totalDirectorMatches": 5,
        },
        "reject_alerts_2": {
            "status": "COMPLETED",
            "creditScore": 72,
            "complianceAlertCount": 2,
            "derogatoryCount": 2,
            "intelligenceIndicator": "MULTIPLE_MATCHES",
            "totalDirectorMatches": 5,
        },
        "no_data": {
            "status": "NO_HIT",
            "creditScore": None,
            "complianceAlertCount": 0,
            "derogatoryCount": 0,
            "intelligenceIndicator": "NO_HIT",
            "totalDirectorMatches": 0,
        },
    }
    if scenario not in defaults:
        if match := re.fullmatch(r"clean_(\d+)", scenario):
            defaults[scenario] = {
                "status": "COMPLETED",
                "creditScore": _to_int(match.group(1)),
                "complianceAlertCount": 0,
                "derogatoryCount": 0,
                "intelligenceIndicator": "MULTIPLE_MATCHES",
                "totalDirectorMatches": 5,
            }
        elif match := re.fullmatch(r"reject_alerts_(\d+)", scenario):
            alert_count = _to_int(match.group(1))
            defaults[scenario] = {
                "status": "COMPLETED",
                "creditScore": 72,
                "complianceAlertCount": alert_count,
                "derogatoryCount": alert_count,
                "intelligenceIndicator": "MULTIPLE_MATCHES",
                "totalDirectorMatches": 5,
            }
    return defaults.get(scenario, defaults["clean_72"])


def _resolve_creditsafe_controls(config: Dict[str, Any]) -> Dict[str, Any]:
    scenario = str(config.get("scenario") or "clean_72")
    controls = deepcopy(config.get("controls", {}))
    mode = _normalize_mode(config.get("mode"))
    if mode != "random":
        return _deep_merge(_creditsafe_defaults_for_scenario(scenario), controls)

    randomizer = _rng("creditsafe", controls)
    no_data = _random_bool(controls, "noData", chance_key="noDataChance", default_chance=0.08, rng=randomizer)
    if no_data:
        return {
            "status": str(controls.get("status") or "NO_HIT"),
            "creditScore": None,
            "complianceAlertCount": 0,
            "derogatoryCount": 0,
            "intelligenceIndicator": str(controls.get("intelligenceIndicator") or "NO_HIT"),
            "totalDirectorMatches": 0,
        }

    total_matches = _random_int(controls, "totalDirectorMatches", 1, 6, randomizer)
    compliance_alert_count = _random_int(controls, "complianceAlertCount", 0, 3, randomizer)
    derogatory_count = controls.get("derogatoryCount")
    if derogatory_count is None:
        derogatory_count = _random_int(controls, "derogatoryCount", compliance_alert_count, max(compliance_alert_count, 4), randomizer)
    intelligence = controls.get("intelligenceIndicator")
    if intelligence in (None, ""):
        intelligence = "MATCH_FOUND" if total_matches == 1 else "MULTIPLE_MATCHES"
    return {
        "status": str(controls.get("status") or "COMPLETED"),
        "creditScore": _random_int(controls, "creditScore", 0, 100, randomizer),
        "complianceAlertCount": compliance_alert_count,
        "derogatoryCount": _to_int(derogatory_count, compliance_alert_count),
        "intelligenceIndicator": str(intelligence),
        "totalDirectorMatches": total_matches,
    }


def _plaid_defaults_for_scenario(scenario: str) -> Dict[str, Any]:
    defaults = {
        "pending_link": {
            "status": "PENDING",
            "intelligenceIndicator": "PENDING_LINK",
            "accountsFound": 0,
            "cashflowStability": "PENDING",
            "errorMessage": None,
            "autoCompleteOnClick": False,
            "autoCompleteAfterSeconds": 0,
        },
        "accounts_3": {
            "status": "COMPLETED",
            "intelligenceIndicator": "PASS",
            "accountsFound": 3,
            "cashflowStability": "GOOD",
            "errorMessage": None,
        },
        "no_accounts": {
            "status": "COMPLETED",
            "intelligenceIndicator": "NO_ACCOUNTS",
            "accountsFound": 0,
            "cashflowStability": "LOW",
            "errorMessage": None,
        },
        "failed_missing_ssn": {
            "status": "FAILED",
            "intelligenceIndicator": "FAILED",
            "accountsFound": 0,
            "cashflowStability": "UNKNOWN",
            "errorMessage": "SSN is required for Plaid CRA credit check",
        },
    }
    if scenario not in defaults and (match := re.fullmatch(r"accounts_(\d+)", scenario)):
        accounts_found = _to_int(match.group(1))
        defaults[scenario] = {
            "status": "COMPLETED",
            "intelligenceIndicator": "PASS" if accounts_found > 0 else "NO_ACCOUNTS",
            "accountsFound": accounts_found,
            "cashflowStability": "GOOD" if accounts_found > 0 else "LOW",
            "errorMessage": None,
        }
    return defaults.get(scenario, defaults["pending_link"])


def _resolve_plaid_controls(config: Dict[str, Any]) -> Dict[str, Any]:
    scenario = str(config.get("scenario") or "pending_link")
    controls = deepcopy(config.get("controls", {}))
    mode = _normalize_mode(config.get("mode"))
    if mode != "random":
        return _deep_merge(_plaid_defaults_for_scenario(scenario), controls)

    randomizer = _rng("plaid", controls)
    status = str(controls.get("status") or "").upper()
    if not status:
        failed = _random_bool(controls, "failed", chance_key="failedChance", default_chance=0.05, rng=randomizer)
        pending = _random_bool(controls, "pending", chance_key="pendingChance", default_chance=0.15, rng=randomizer)
        if failed:
            status = "FAILED"
        elif pending:
            status = "PENDING"
        else:
            status = "COMPLETED"

    accounts_found = _random_int(controls, "accountsFound", 0, 6, randomizer)
    cashflow = _random_choice(
        controls,
        "cashflowStability",
        ["GOOD", "FAIR", "LOW"],
        randomizer,
        default="GOOD" if accounts_found > 0 else "LOW",
    )
    if status == "PENDING":
        return {
            "status": "PENDING",
            "intelligenceIndicator": str(controls.get("intelligenceIndicator") or "PENDING_LINK"),
            "accountsFound": accounts_found,
            "cashflowStability": str(cashflow or "PENDING"),
            "errorMessage": controls.get("errorMessage"),
            "autoCompleteOnClick": bool(controls.get("autoCompleteOnClick", False)),
            "autoCompleteAfterSeconds": _to_int(controls.get("autoCompleteAfterSeconds", 0)),
        }
    if status == "FAILED":
        return {
            "status": "FAILED",
            "intelligenceIndicator": str(controls.get("intelligenceIndicator") or "FAILED"),
            "accountsFound": 0,
            "cashflowStability": str(cashflow or "UNKNOWN"),
            "errorMessage": controls.get("errorMessage") or "Plaid link flow failed",
        }
    return {
        "status": "COMPLETED",
        "intelligenceIndicator": str(controls.get("intelligenceIndicator") or ("PASS" if accounts_found > 0 else "NO_ACCOUNTS")),
        "accountsFound": accounts_found,
        "cashflowStability": str(cashflow or ("GOOD" if accounts_found > 0 else "LOW")),
        "errorMessage": controls.get("errorMessage"),
    }


def _resolve_provider_controls(provider: str, config: Dict[str, Any]) -> Dict[str, Any]:
    if provider == "isoftpull":
        return _resolve_iso_controls(config)
    if provider == "creditsafe":
        return _resolve_creditsafe_controls(config)
    if provider == "plaid":
        return _resolve_plaid_controls(config)
    raise HTTPException(404, f"unsupported provider: {provider}")


def _materialize_provider_config(provider: str, config: Dict[str, Any]) -> Dict[str, Any]:
    mode = _normalize_mode(config.get("mode"))
    return {
        "scenario": str(config.get("scenario") or DEFAULT_CONFIG[provider]["scenario"]),
        # Freeze random mode into concrete controls for a single request lifecycle.
        "mode": "custom" if mode == "random" else mode,
        "controls": _resolve_provider_controls(provider, config),
        "overrides": deepcopy(config.get("overrides", {})),
    }


def _build_isoftpull_response(
    body: Dict[str, Any],
    config: Dict[str, Any],
    *,
    applicant_id: int = 42,
    report_id: int = 9001,
    requested_at: datetime | None = None,
    completed_at: datetime | None = None,
) -> Dict[str, Any]:
    names = _applicant_names(body)
    request_id = _request_id(body)
    customer_id = _customer_id(body)
    now = requested_at or _utcnow()
    mode = _normalize_mode(config.get("mode"))
    resolved = _materialize_provider_config("isoftpull", config)
    scenario = resolved["scenario"]
    controls = deepcopy(resolved.get("controls", {}))

    credit_score = controls.get("creditScore")
    collection_count = _to_int(controls.get("collectionCount", 0))
    bureau_hit = bool(controls.get("bureauHit", credit_score is not None))
    status = str(controls.get("status", "COMPLETED")).upper()
    intelligence = str(controls.get("intelligenceIndicator", "PASS"))
    report_url = f"{MOCK_PUBLIC_BASE_URL}/api/v1/applicants/{applicant_id}/credit-reports"

    if not bureau_hit or credit_score is None or status == "NO_HIT":
        response = {
            "id": report_id,
            "applicantId": applicant_id,
            "providerCode": "ISOFTPULL",
            "providerName": "iSoftPull",
            "status": status,
            "intelligenceIndicator": intelligence,
            "reportUrl": report_url,
            "mockMode": mode,
            "rawResponse": {
                "reports": {
                    "link": report_url,
                    "equifax": {"status": "failure", "message": "No-hit", "failure_type": "no-hit"},
                    "experian": {"status": "failure", "message": "NO RECORD FOUND", "failure_type": "no-hit"},
                    "transunion": {"status": "failure", "message": "A no-hit file is returned.", "failure_type": "no-hit"},
                },
                "applicant": names,
                "reportUrl": report_url,
                "intelligenceIndicator": intelligence,
            },
            "requestedAt": _iso(now),
            "completedAt": _iso(completed_at or (now + timedelta(seconds=3))),
            "result": {"bureau_hit": False, "score": None, "creditScore": None, "collectionCount": 0},
            "mockScenario": scenario,
            "received_request_id": request_id,
            "customer_id": customer_id,
            "server": MOCK_UPSTREAM_LABEL,
        }
        return _deep_merge(response, config.get("overrides", {}))

    transunion_score = _to_int(controls.get("transunionScore", (_to_int(credit_score) or 0) + 5))
    equifax_score = _to_int(controls.get("equifaxScore", _to_int(credit_score, transunion_score)))
    accounts = _iso_trade_accounts(collection_count)
    response = {
        "id": report_id,
        "applicantId": applicant_id,
        "providerCode": "ISOFTPULL",
        "providerName": "iSoftPull",
        "status": status,
        "creditScore": _to_int(credit_score),
        "equifaxScore": equifax_score,
        "transunionScore": transunion_score,
        "intelligenceIndicator": intelligence,
        "reportUrl": report_url,
        "mockMode": mode,
        "rawResponse": {
            "equifaxScore": equifax_score,
            "transunionScore": transunion_score,
            "firstScore": _to_int(credit_score),
            "intelligenceIndicator": intelligence,
            "reportUrl": report_url,
            "applicant": names,
            "reports": {
                "link": report_url,
                "equifax": {
                    "status": "success",
                    "message": "Equifax credit report generation succeeded",
                    "full_feed": {
                        "credit_score": {"fico_8": {"scoreValue": equifax_score, "score": equifax_score}},
                        "trade_accounts": accounts,
                    },
                },
                "transunion": {
                    "status": "success",
                    "message": "Transunion credit report generation succeeded",
                    "full_feed": {
                        "credit_score": {"fico_8": {"scoreValue": transunion_score, "score": transunion_score}},
                        "trade_accounts": accounts,
                    },
                },
            },
        },
        "requestedAt": _iso(now),
        "completedAt": _iso(completed_at or (now + timedelta(seconds=5))),
        "result": {
            "bureau_hit": True,
            "score": _to_int(credit_score),
            "creditScore": _to_int(credit_score),
            "collectionCount": collection_count,
        },
        "mockScenario": scenario,
        "received_request_id": request_id,
        "customer_id": customer_id,
        "server": MOCK_UPSTREAM_LABEL,
    }
    return _deep_merge(response, config.get("overrides", {}))


def _build_creditsafe_response(
    body: Dict[str, Any],
    config: Dict[str, Any],
    *,
    applicant_id: int = 42,
    report_id: int = 9002,
    requested_at: datetime | None = None,
    completed_at: datetime | None = None,
) -> Dict[str, Any]:
    names = _applicant_names(body)
    request_id = _request_id(body)
    customer_id = _customer_id(body)
    now = requested_at or _utcnow()
    mode = _normalize_mode(config.get("mode"))
    resolved = _materialize_provider_config("creditsafe", config)
    scenario = resolved["scenario"]
    controls = deepcopy(resolved.get("controls", {}))

    credit_score = controls.get("creditScore")
    compliance_alert_count = _to_int(controls.get("complianceAlertCount", 0))
    derogatory_count = _to_int(controls.get("derogatoryCount", compliance_alert_count))
    status = str(controls.get("status", "COMPLETED")).upper()
    intelligence = str(controls.get("intelligenceIndicator", "MULTIPLE_MATCHES"))
    total_matches = _to_int(controls.get("totalDirectorMatches", 5))
    alerts = [{"id": f"alert-{index + 1}", "severity": "HIGH"} for index in range(compliance_alert_count)]
    report_url = f"{MOCK_PUBLIC_BASE_URL}/api/v1/applicants/{applicant_id}/credit-reports"

    response = {
        "id": report_id,
        "applicantId": applicant_id,
        "providerCode": "CREDITSAFE",
        "providerName": "Creditsafe",
        "status": status,
        "creditScore": credit_score,
        "intelligenceIndicator": intelligence,
        "reportUrl": report_url,
        "mockMode": mode,
        "rawResponse": {
            "bestMatch": {
                "peopleId": "US-S1283486724",
                "firstName": names["first_name"].upper(),
                "lastName": names["last_name"].upper(),
                "title": "CEO",
                "country": "US",
                "company": {
                    "companyName": f"{names['first_name'].upper()} {names['last_name'].upper()} HOLDINGS LLC",
                    "safeNumber": "US46120715",
                    "charterNumber": "J714207",
                    "rating": credit_score,
                    "limit": 2000,
                    "derogatoryCount": derogatory_count,
                    "derogatoryAmount": 0,
                },
                "address": {
                    "simpleValue": "123 MAIN STREET, NEW YORK, NY, 10001",
                    "street": "123 MAIN STREET",
                    "city": "NEW YORK",
                    "postCode": "10001",
                    "province": "NY",
                },
                "source": "S",
                "taxCode": "US-S1283486724",
            },
            "directors": [],
            "businessCredit": {
                "riskScoreDescription": "Very Low Risk" if (_to_int(credit_score) >= 70) else "Moderate Risk",
                "companyName": f"{names['first_name'].upper()} {names['last_name'].upper()} HOLDINGS LLC",
                "riskScoreGrade": "A" if (_to_int(credit_score) >= 70) else "C",
                "riskScore": credit_score,
                "derogatoryCount": derogatory_count,
            },
            "compliance": {"alerts": alerts},
            "totalDirectorMatches": total_matches,
        },
        "requestedAt": _iso(now),
        "completedAt": _iso(completed_at or (now + timedelta(seconds=8))),
        "result": {
            "creditScore": credit_score,
            "company_score": credit_score,
            "complianceAlertCount": compliance_alert_count,
            "compliance_alert_count": compliance_alert_count,
        },
        "mockScenario": scenario,
        "received_request_id": request_id,
        "customer_id": customer_id,
        "server": MOCK_UPSTREAM_LABEL,
    }

    if status == "NO_HIT" or credit_score is None or total_matches <= 0:
        response["rawResponse"] = {
            "bestMatch": None,
            "directors": [],
            "businessCredit": {},
            "compliance": {"alerts": []},
            "totalDirectorMatches": 0,
        }
        response["result"] = {"creditScore": None, "company_score": None, "complianceAlertCount": 0}

    return _deep_merge(response, config.get("overrides", {}))


def _build_plaid_response(
    body: Dict[str, Any],
    config: Dict[str, Any],
    *,
    applicant_id: int = 42,
    report_id: int = 9003,
    requested_at: datetime | None = None,
    completed_at: datetime | None = None,
    tracking_state: Dict[str, Any] | None = None,
) -> Dict[str, Any]:
    request_id = _request_id(body)
    customer_id = _customer_id(body)
    now = requested_at or _utcnow()
    mode = _normalize_mode(config.get("mode"))
    resolved = _materialize_provider_config("plaid", config)
    scenario = resolved["scenario"]
    controls = deepcopy(resolved.get("controls", {}))

    if tracking_state:
        tracking_id = tracking_state["trackingId"]
        link_state = tracking_state["status"]
        accounts_found = _to_int(tracking_state.get("accountsFound", 0))
        cashflow_stability = str(tracking_state.get("cashflowStability", "PENDING"))
        error_message = tracking_state.get("errorMessage")
        if link_state in {"CREATED", "CLICKED"}:
            status = "PENDING"
            intelligence = "PENDING_LINK"
        elif link_state == "REPORT_READY":
            status = "COMPLETED"
            intelligence = "PASS" if accounts_found > 0 else "NO_ACCOUNTS"
        else:
            status = "FAILED"
            intelligence = "FAILED"
        requested_at = _parse_iso(tracking_state.get("requestedAt")) or now
        completed_at = _parse_iso(tracking_state.get("completedAt")) if tracking_state.get("completedAt") else completed_at
    else:
        tracking_id = controls.get("trackingId") or str(uuid4())
        status = str(controls.get("status", "PENDING"))
        intelligence = str(controls.get("intelligenceIndicator", "PENDING_LINK"))
        accounts_found = _to_int(controls.get("accountsFound", 0))
        cashflow_stability = str(controls.get("cashflowStability", "PENDING"))
        error_message = controls.get("errorMessage")

    report_url = _plaid_tracking_url(tracking_id)
    response = {
        "id": report_id,
        "applicantId": applicant_id,
        "providerCode": "PLAID",
        "providerName": "Plaid",
        "status": status,
        "intelligenceIndicator": intelligence,
        "reportUrl": report_url,
        "mockMode": mode,
        "rawResponse": {
            "sessionId": 100,
            "trackingId": tracking_id,
            "plaidUserId": "usr_mock_plaid_user",
            "trackingUrl": report_url,
            "hostedLinkUrl": f"https://secure.plaid.com/hl/{tracking_id.replace('-', '')}",
            "linkToken": f"link-sandbox-{tracking_id}",
            "linkTokenExpiration": _iso(now + timedelta(minutes=30)),
            "accounts": [{"accountId": f"mock-{index + 1}"} for index in range(accounts_found)],
        },
        "requestedAt": _iso(requested_at or now),
        "completedAt": _iso(completed_at or (now + timedelta(seconds=2))) if status in {"COMPLETED", "FAILED"} else None,
        "result": {
            "accounts_found": accounts_found,
            "cashflow_stability": cashflow_stability,
            "status": "OK" if status == "COMPLETED" else ("PENDING_LINK" if status == "PENDING" else status),
        },
        "mockScenario": scenario,
        "received_request_id": request_id,
        "customer_id": customer_id,
        "server": MOCK_UPSTREAM_LABEL,
    }
    if error_message:
        response["errorMessage"] = error_message
    return _deep_merge(response, config.get("overrides", {}))


SCENARIO_CATALOG = {
    "isoftpull": {
        "pass_775": "Completed report with score 775 and zero collections.",
        "pass_<score>": "Completed report with the requested score and zero collections.",
        "reject_score_550": "Completed report with score 550 for Flowable reject-by-score testing.",
        "reject_score_<score>": "Completed report with the requested score for reject-by-score testing.",
        "reject_collections_6": "Completed report with score 720 and collection_count 6 for reject-by-collections testing.",
        "reject_collections_<count>": "Completed report with score 720 and the requested collection count.",
        "no_hit": "No-hit bureau response without score.",
    },
    "creditsafe": {
        "clean_72": "Completed response with score 72 and zero compliance alerts.",
        "clean_<score>": "Completed response with the requested business score and zero compliance alerts.",
        "reject_alerts_2": "Completed response with two compliance alerts for reject testing.",
        "reject_alerts_<count>": "Completed response with the requested compliance alert count.",
        "no_data": "No-hit business lookup without company score.",
    },
    "plaid": {
        "pending_link": "Pending link flow with trackingUrl and status transitions.",
        "accounts_3": "Completed response with three linked accounts.",
        "accounts_<count>": "Completed response with the requested number of linked accounts.",
        "no_accounts": "Completed response with zero linked accounts.",
        "failed_missing_ssn": "Failed response for missing SSN validation.",
    },
}

DEFAULT_CONFIG = {
    "isoftpull": {"mode": "scenario", "scenario": "pass_775", "controls": {}, "overrides": {}},
    "creditsafe": {"mode": "scenario", "scenario": "clean_72", "controls": {}, "overrides": {}},
    "plaid": {"mode": "scenario", "scenario": "pending_link", "controls": {}, "overrides": {}},
}

DEFAULT_RUNTIME = {
    "next_applicant_id": 42,
    "next_report_id": 100,
    "applicants": {},
    "reports": {},
    "plaid_links": {},
}

_state_lock = RLock()
_state = deepcopy(DEFAULT_CONFIG)
_runtime = deepcopy(DEFAULT_RUNTIME)


class ProviderConfigUpdate(BaseModel):
    mode: str | None = None
    scenario: str | None = None
    controls: Dict[str, Any] = {}
    overrides: Dict[str, Any] = {}


class BulkConfigUpdate(BaseModel):
    isoftpull: ProviderConfigUpdate | None = None
    creditsafe: ProviderConfigUpdate | None = None
    plaid: ProviderConfigUpdate | None = None


class ApplicantIn(BaseModel):
    firstName: str = ""
    lastName: str = ""
    address: str = ""
    city: str = ""
    state: str = ""
    zipCode: str = ""
    ssn: str = ""
    dateOfBirth: str = ""
    email: str = ""
    phone: str = ""


class ApplicantUpdateIn(BaseModel):
    firstName: str | None = None
    lastName: str | None = None
    address: str | None = None
    city: str | None = None
    state: str | None = None
    zipCode: str | None = None
    ssn: str | None = None
    dateOfBirth: str | None = None
    email: str | None = None
    phone: str | None = None


class PlaidLinkActionIn(BaseModel):
    accountsFound: int | None = None
    cashflowStability: str | None = None
    errorMessage: str | None = None


def get_current_config() -> Dict[str, Any]:
    with _state_lock:
        return deepcopy(_state)


def reset_config() -> Dict[str, Any]:
    with _state_lock:
        _state.clear()
        _state.update(deepcopy(DEFAULT_CONFIG))
        _runtime.clear()
        _runtime.update(deepcopy(DEFAULT_RUNTIME))
        return deepcopy(_state)


def update_provider_config(provider: str, update: ProviderConfigUpdate) -> Dict[str, Any]:
    provider = _provider_key(provider)
    with _state_lock:
        current = deepcopy(_state[provider])
        current["mode"] = _normalize_mode(update.mode or current.get("mode"))
        scenario = update.scenario or current["scenario"]
        if not _scenario_supported(provider, scenario):
            raise HTTPException(400, f"unsupported scenario '{scenario}' for provider '{provider}'")
        current["scenario"] = scenario
        current["controls"] = deepcopy(update.controls or {})
        current["overrides"] = deepcopy(update.overrides or {})
        _state[provider] = current
        return deepcopy(current)


def _build_response(provider: str, body: Dict[str, Any]) -> Dict[str, Any]:
    config = get_current_config()[provider]
    builders = {
        "isoftpull": _build_isoftpull_response,
        "creditsafe": _build_creditsafe_response,
        "plaid": _build_plaid_response,
    }
    return builders[provider](body, config)


def _require_applicant(applicant_id: int) -> Dict[str, Any]:
    applicant = _runtime["applicants"].get(applicant_id)
    if not applicant:
        raise HTTPException(404, f"applicant {applicant_id} not found")
    return applicant


def _next_applicant_id() -> int:
    applicant_id = _runtime["next_applicant_id"]
    _runtime["next_applicant_id"] += 1
    return applicant_id


def _next_report_id() -> int:
    report_id = _runtime["next_report_id"]
    _runtime["next_report_id"] += 1
    return report_id


def _store_report(applicant_id: int, report: Dict[str, Any]) -> Dict[str, Any]:
    reports = _runtime["reports"].setdefault(applicant_id, [])
    for index, current in enumerate(reports):
        if current.get("id") == report.get("id"):
            reports[index] = deepcopy(report)
            return deepcopy(report)
    reports.append(deepcopy(report))
    reports.sort(key=lambda item: item.get("requestedAt") or "", reverse=True)
    return deepcopy(report)


def _list_reports(applicant_id: int) -> List[Dict[str, Any]]:
    return deepcopy(_runtime["reports"].get(applicant_id, []))


def _refresh_plaid_link_state(tracking_id: str) -> Dict[str, Any]:
    state = _runtime["plaid_links"].get(tracking_id)
    if not state:
        raise HTTPException(404, f"tracking id {tracking_id} not found")
    auto_seconds = _to_int(state.get("autoCompleteAfterSeconds", 0))
    clicked_at = _parse_iso(state.get("clickedAt"))
    if state.get("status") == "CLICKED" and auto_seconds > 0 and clicked_at:
        if (_utcnow() - clicked_at).total_seconds() >= auto_seconds:
            _complete_plaid_link(
                tracking_id,
                accounts_found=_to_int(state.get("accountsFound", 0)),
                cashflow_stability=str(state.get("cashflowStability", "GOOD")),
            )
            state = _runtime["plaid_links"][tracking_id]
    return deepcopy(state)


def _sync_plaid_report(tracking_id: str) -> Dict[str, Any]:
    state = _refresh_plaid_link_state(tracking_id)
    applicant_id = state["applicantId"]
    applicant = _require_applicant(applicant_id)
    config = {
        "mode": state.get("mode", "custom"),
        "scenario": state.get("scenario", "pending_link"),
        "controls": state.get("configControls", {}),
        "overrides": state.get("overrides", {}),
    }
    body = dict(applicant)
    body["request_id"] = state.get("request_id") or f"TRACK-{tracking_id}"
    report = _build_plaid_response(
        body,
        config,
        applicant_id=applicant_id,
        report_id=state["reportId"],
        requested_at=_parse_iso(state.get("requestedAt")),
        completed_at=_parse_iso(state.get("completedAt")),
        tracking_state=state,
    )
    _store_report(applicant_id, report)
    return report


def _create_plaid_link(applicant_id: int, request_id: str, config: Dict[str, Any]) -> Dict[str, Any]:
    controls = deepcopy(config.get("controls", {}))
    tracking_id = str(controls.get("trackingId") or uuid4())
    now = _utcnow()
    state = {
        "trackingId": tracking_id,
        "applicantId": applicant_id,
        "reportId": _next_report_id(),
        "requestedAt": _iso(now),
        "clickedAt": None,
        "completedAt": None,
        "status": "CREATED",
        "clicked": False,
        "reportReady": False,
        "mode": _normalize_mode(config.get("mode")),
        "scenario": str(config.get("scenario") or "pending_link"),
        "request_id": request_id,
        "configControls": controls,
        "overrides": deepcopy(config.get("overrides", {})),
        "accountsFound": _to_int(controls.get("accountsFound", 0)),
        "cashflowStability": str(controls.get("cashflowStability", "PENDING")),
        "errorMessage": controls.get("errorMessage"),
        "autoCompleteOnClick": bool(controls.get("autoCompleteOnClick", False)),
        "autoCompleteAfterSeconds": _to_int(controls.get("autoCompleteAfterSeconds", 0)),
        "trackingUrl": _plaid_tracking_url(tracking_id),
        "hostedLinkUrl": f"https://secure.plaid.com/hl/{tracking_id.replace('-', '')}",
    }
    _runtime["plaid_links"][tracking_id] = state
    return deepcopy(state)


def _click_plaid_link(tracking_id: str) -> Dict[str, Any]:
    state = _refresh_plaid_link_state(tracking_id)
    if state["status"] not in {"CREATED", "CLICKED"}:
        return state
    current = _runtime["plaid_links"][tracking_id]
    current["status"] = "CLICKED"
    current["clicked"] = True
    current["clickedAt"] = current.get("clickedAt") or _iso(_utcnow())
    if current.get("autoCompleteOnClick"):
        _complete_plaid_link(
            tracking_id,
            accounts_found=_to_int(current.get("accountsFound", 0)),
            cashflow_stability=str(current.get("cashflowStability", "GOOD")),
        )
    return deepcopy(_runtime["plaid_links"][tracking_id])


def _complete_plaid_link(tracking_id: str, *, accounts_found: int | None = None, cashflow_stability: str | None = None) -> Dict[str, Any]:
    state = _runtime["plaid_links"].get(tracking_id)
    if not state:
        raise HTTPException(404, f"tracking id {tracking_id} not found")
    current = _runtime["plaid_links"][tracking_id]
    current["status"] = "REPORT_READY"
    current["clicked"] = True
    current["reportReady"] = True
    if not current.get("clickedAt"):
        current["clickedAt"] = _iso(_utcnow())
    current["completedAt"] = _iso(_utcnow())
    if accounts_found is not None:
        current["accountsFound"] = _to_int(accounts_found)
    if cashflow_stability is not None:
        current["cashflowStability"] = str(cashflow_stability)
    _sync_plaid_report(tracking_id)
    return deepcopy(current)


def _fail_plaid_link(tracking_id: str, *, error_message: str | None = None) -> Dict[str, Any]:
    state = _runtime["plaid_links"].get(tracking_id)
    if not state:
        raise HTTPException(404, f"tracking id {tracking_id} not found")
    current = _runtime["plaid_links"][tracking_id]
    current["status"] = "FAILED"
    current["clicked"] = bool(current.get("clickedAt"))
    current["reportReady"] = False
    if not current.get("clickedAt"):
        current["clickedAt"] = _iso(_utcnow())
    current["completedAt"] = _iso(_utcnow())
    current["errorMessage"] = error_message or current.get("errorMessage") or "Plaid link flow failed"
    _sync_plaid_report(tracking_id)
    return deepcopy(current)


def _plaid_status_payload(state: Dict[str, Any]) -> Dict[str, Any]:
    link_state = _refresh_plaid_link_state(state["trackingId"])
    payload = {
        "trackingId": link_state["trackingId"],
        "status": link_state["status"],
        "clicked": bool(link_state.get("clicked")),
        "clickedAt": link_state.get("clickedAt"),
        "reportReady": bool(link_state.get("reportReady")),
        "reportUrl": link_state.get("trackingUrl"),
        "trackingUrl": link_state.get("trackingUrl"),
        "hostedLinkUrl": link_state.get("hostedLinkUrl"),
        "applicantId": link_state["applicantId"],
    }
    if link_state.get("completedAt"):
        payload["completedAt"] = link_state["completedAt"]
    if link_state.get("errorMessage"):
        payload["errorMessage"] = link_state["errorMessage"]
    return payload


def _create_applicant_record(payload: Dict[str, Any], *, applicant_id: int | None = None) -> Dict[str, Any]:
    now = _utcnow()
    resolved_applicant_id = applicant_id if applicant_id is not None and applicant_id > 0 else _next_applicant_id()
    if applicant_id is not None and applicant_id > 0:
        _runtime["next_applicant_id"] = max(_runtime["next_applicant_id"], applicant_id + 1)
    record = {field: _clean_text(payload.get(field)) for field in APPLICANT_FIELDS}
    record["id"] = resolved_applicant_id
    record["createdAt"] = _iso(now)
    record["updatedAt"] = _iso(now)
    _runtime["applicants"][resolved_applicant_id] = record
    _runtime["reports"].setdefault(resolved_applicant_id, [])
    return deepcopy(record)


def _update_applicant_record(applicant_id: int, payload: Dict[str, Any]) -> Dict[str, Any]:
    current = _require_applicant(applicant_id)
    for field in APPLICANT_FIELDS:
        if field in payload and payload[field] is not None:
            current[field] = _clean_text(payload[field])
    current["updatedAt"] = _iso(_utcnow())
    _runtime["applicants"][applicant_id] = current
    return deepcopy(current)


def _ensure_applicant_for_provider_request(body: Dict[str, Any]) -> Dict[str, Any]:
    applicant_payload = _extract_applicant_payload(body)
    applicant_id = _extract_external_applicant_id(body)
    if applicant_id:
        existing = _runtime["applicants"].get(applicant_id)
        if existing:
            if applicant_payload:
                return _update_applicant_record(applicant_id, applicant_payload)
            return deepcopy(existing)
        if applicant_payload:
            return _create_applicant_record(applicant_payload, applicant_id=applicant_id)
    if applicant_payload:
        return _create_applicant_record(applicant_payload)
    raise HTTPException(400, "provider request requires applicant payload or external_applicant_id")


def _trigger_isoftpull(applicant_id: int, body: Dict[str, Any] | None = None) -> Dict[str, Any]:
    applicant = _require_applicant(applicant_id)
    report = _build_isoftpull_response(
        _provider_request_body(applicant, body),
        get_current_config()["isoftpull"],
        applicant_id=applicant_id,
        report_id=_next_report_id(),
    )
    return _store_report(applicant_id, report)


def _trigger_creditsafe(applicant_id: int, body: Dict[str, Any] | None = None) -> Dict[str, Any]:
    applicant = _require_applicant(applicant_id)
    report = _build_creditsafe_response(
        _provider_request_body(applicant, body),
        get_current_config()["creditsafe"],
        applicant_id=applicant_id,
        report_id=_next_report_id(),
    )
    return _store_report(applicant_id, report)


def _trigger_plaid(applicant_id: int, body: Dict[str, Any] | None = None) -> Dict[str, Any]:
    applicant = _require_applicant(applicant_id)
    current_config = get_current_config()["plaid"]
    config = {
        "mode": _normalize_mode(current_config.get("mode")),
        "scenario": str(current_config.get("scenario") or "pending_link"),
        "controls": _resolve_plaid_controls(current_config),
        "overrides": deepcopy(current_config.get("overrides", {})),
    }
    request_body = _provider_request_body(applicant, body)
    request_id = str(request_body.get("request_id") or f"PLAID-{applicant_id}-{uuid4().hex[:8].upper()}")
    status = str(config.get("controls", {}).get("status", "PENDING")).upper()
    if status == "FAILED":
        report = _build_plaid_response(request_body, config, applicant_id=applicant_id, report_id=_next_report_id())
        return _store_report(applicant_id, report)
    if status == "PENDING":
        link_state = _create_plaid_link(applicant_id, request_id, config)
        report = _build_plaid_response(
            request_body,
            config,
            applicant_id=applicant_id,
            report_id=link_state["reportId"],
            requested_at=_parse_iso(link_state["requestedAt"]),
            tracking_state=link_state,
        )
        return _store_report(applicant_id, report)
    report = _build_plaid_response(request_body, config, applicant_id=applicant_id, report_id=_next_report_id())
    return _store_report(applicant_id, report)


def _run_provider_check(applicant_id: int, provider: str, body: Dict[str, Any] | None = None) -> Dict[str, Any]:
    provider = _provider_key(provider)
    if provider == "isoftpull":
        return _trigger_isoftpull(applicant_id, body)
    if provider == "creditsafe":
        return _trigger_creditsafe(applicant_id, body)
    return _trigger_plaid(applicant_id, body)


@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": SERVICE_NAME,
        "mode": "unified-mock-backend",
        "upstream_label": MOCK_UPSTREAM_LABEL,
    }


@app.get("/api/v1/mock/catalog")
def catalog():
    return {
        "service": SERVICE_NAME,
        "base_url": MOCK_PUBLIC_BASE_URL,
        "upstream_label": MOCK_UPSTREAM_LABEL,
        "available_modes": sorted(MOCK_MODES),
        "providers": {
            "isoftpull": {
                "endpoint_path": "/api/pull",
                "credit_check_path": "/api/v1/applicants/{id}/credit-check/isoftpull",
                "available_modes": sorted(MOCK_MODES),
                "config_controls": [
                    "creditScore",
                    "creditScoreMin",
                    "creditScoreMax",
                    "collectionCount",
                    "collectionCountMin",
                    "collectionCountMax",
                    "bureauHit",
                    "noHitChance",
                    "status",
                    "intelligenceIndicator",
                    "seed",
                ],
                "scenarios": SCENARIO_CATALOG["isoftpull"],
            },
            "creditsafe": {
                "endpoint_path": "/api/report",
                "credit_check_path": "/api/v1/applicants/{id}/credit-check/creditsafe",
                "available_modes": sorted(MOCK_MODES),
                "config_controls": [
                    "creditScore",
                    "creditScoreMin",
                    "creditScoreMax",
                    "complianceAlertCount",
                    "complianceAlertCountMin",
                    "complianceAlertCountMax",
                    "derogatoryCount",
                    "derogatoryCountMin",
                    "derogatoryCountMax",
                    "totalDirectorMatches",
                    "totalDirectorMatchesMin",
                    "totalDirectorMatchesMax",
                    "status",
                    "intelligenceIndicator",
                    "noDataChance",
                    "seed",
                ],
                "scenarios": SCENARIO_CATALOG["creditsafe"],
            },
            "plaid": {
                "endpoint_path": "/api/accounts",
                "credit_check_path": "/api/v1/applicants/{id}/credit-check/plaid",
                "available_modes": sorted(MOCK_MODES),
                "config_controls": [
                    "accountsFound",
                    "accountsFoundMin",
                    "accountsFoundMax",
                    "cashflowStability",
                    "cashflowStabilityOptions",
                    "status",
                    "intelligenceIndicator",
                    "errorMessage",
                    "autoCompleteOnClick",
                    "autoCompleteAfterSeconds",
                    "pendingChance",
                    "failedChance",
                    "seed",
                ],
                "scenarios": SCENARIO_CATALOG["plaid"],
            },
        },
    }


@app.get("/api/v1/mock/config")
def current_config():
    return {"service": SERVICE_NAME, "config": get_current_config()}


@app.get("/api/v1/mock/runtime")
def runtime_snapshot():
    with _state_lock:
        return {
            "service": SERVICE_NAME,
            "applicants": [_public_applicant_record(item) for item in _runtime["applicants"].values()],
            "plaid_links": deepcopy(list(_runtime["plaid_links"].values())),
            "reports": deepcopy(_runtime["reports"]),
        }


@app.put("/api/v1/mock/config/{provider}")
def set_provider_config(provider: str, body: ProviderConfigUpdate):
    updated = update_provider_config(provider, body)
    return {"provider": _provider_key(provider), "config": updated}


@app.put("/api/v1/mock/config")
def set_bulk_config(body: BulkConfigUpdate):
    updated = {}
    for provider in ("isoftpull", "creditsafe", "plaid"):
        provider_update = getattr(body, provider)
        if provider_update is not None:
            updated[provider] = update_provider_config(provider, provider_update)
    return {"updated": updated, "config": get_current_config()}


@app.post("/api/v1/mock/reset")
def reset_mock():
    return {"config": reset_config()}


@app.post("/api/v1/mock/plaid/{tracking_id}/click")
def click_plaid_link(tracking_id: str):
    with _state_lock:
        state = _click_plaid_link(tracking_id)
        return _plaid_status_payload(state)


@app.post("/api/v1/mock/plaid/{tracking_id}/complete")
def complete_plaid_link(tracking_id: str, body: PlaidLinkActionIn):
    with _state_lock:
        state = _complete_plaid_link(
            tracking_id,
            accounts_found=body.accountsFound,
            cashflow_stability=body.cashflowStability,
        )
        return _plaid_status_payload(state)


@app.post("/api/v1/mock/plaid/{tracking_id}/fail")
def fail_plaid_link(tracking_id: str, body: PlaidLinkActionIn):
    with _state_lock:
        state = _fail_plaid_link(tracking_id, error_message=body.errorMessage)
        return _plaid_status_payload(state)


@app.post("/api/v1/applicants")
def create_applicant(body: ApplicantIn):
    with _state_lock:
        record = _create_applicant_record(body.__dict__)
        return _public_applicant_record(record)


@app.get("/api/v1/applicants")
def list_applicants():
    with _state_lock:
        items = [_public_applicant_record(item) for item in _runtime["applicants"].values()]
        items.sort(key=lambda item: item["id"])
        return items


@app.get("/api/v1/applicants/{applicant_id}")
def get_applicant(applicant_id: int):
    with _state_lock:
        return _public_applicant_record(_require_applicant(applicant_id))


@app.put("/api/v1/applicants/{applicant_id}")
def update_applicant(applicant_id: int, body: ApplicantUpdateIn):
    with _state_lock:
        record = _update_applicant_record(applicant_id, body.__dict__)
        return _public_applicant_record(record)


@app.delete("/api/v1/applicants/{applicant_id}")
def delete_applicant(applicant_id: int):
    with _state_lock:
        _require_applicant(applicant_id)
        _runtime["applicants"].pop(applicant_id, None)
        _runtime["reports"].pop(applicant_id, None)
        stale_links = [tracking_id for tracking_id, state in _runtime["plaid_links"].items() if state.get("applicantId") == applicant_id]
        for tracking_id in stale_links:
            _runtime["plaid_links"].pop(tracking_id, None)
        return {"status": "deleted", "id": applicant_id}


@app.post("/api/v1/applicants/{applicant_id}/credit-check")
def run_all_credit_checks(applicant_id: int):
    with _state_lock:
        _require_applicant(applicant_id)
        return [
            _run_provider_check(applicant_id, "isoftpull"),
            _run_provider_check(applicant_id, "creditsafe"),
            _run_provider_check(applicant_id, "plaid"),
        ]


@app.post("/api/v1/applicants/{applicant_id}/credit-check/isoftpull")
def run_isoftpull_check(applicant_id: int):
    with _state_lock:
        return _run_provider_check(applicant_id, "isoftpull")


@app.post("/api/v1/applicants/{applicant_id}/credit-check/creditsafe")
def run_creditsafe_check(applicant_id: int):
    with _state_lock:
        return _run_provider_check(applicant_id, "creditsafe")


@app.post("/api/v1/applicants/{applicant_id}/credit-check/plaid")
def run_plaid_check(applicant_id: int):
    with _state_lock:
        return _run_provider_check(applicant_id, "plaid")


@app.get("/api/v1/applicants/{applicant_id}/credit-reports")
def get_credit_reports(applicant_id: int):
    with _state_lock:
        _require_applicant(applicant_id)
        for tracking_id, state in list(_runtime["plaid_links"].items()):
            if state.get("applicantId") == applicant_id:
                _sync_plaid_report(tracking_id)
        return _list_reports(applicant_id)


@app.get("/api/v1/credit-providers")
def list_credit_providers():
    return _provider_catalog()


@app.get("/api/v1/credit-providers/enabled")
def list_enabled_credit_providers():
    return [item for item in _provider_catalog() if item.get("enabled")]


@app.get("/api/v1/credit-providers/available")
def list_available_credit_providers():
    return [item for item in _provider_catalog() if item.get("available")]


@app.get("/api/v1/plaid/link/{tracking_id}")
def plaid_tracking(tracking_id: str):
    with _state_lock:
        state = _click_plaid_link(tracking_id)
        return {
            **_plaid_status_payload(state),
            "redirectUrl": state.get("hostedLinkUrl"),
            "message": "Mock Plaid link clicked. In real mode the client would be redirected to Plaid Link.",
        }


@app.get("/api/v1/plaid/link/{tracking_id}/status")
def plaid_tracking_status(tracking_id: str):
    with _state_lock:
        state = _refresh_plaid_link_state(tracking_id)
        return _plaid_status_payload(state)


@app.post("/api/pull")
def isoftpull_mock(body: Dict[str, Any]):
    with _state_lock:
        applicant = _ensure_applicant_for_provider_request(body)
        return _run_provider_check(applicant["id"], "isoftpull", body)


@app.post("/api/report")
def creditsafe_mock(body: Dict[str, Any]):
    with _state_lock:
        applicant = _ensure_applicant_for_provider_request(body)
        return _run_provider_check(applicant["id"], "creditsafe", body)


@app.post("/api/accounts")
def plaid_mock(body: Dict[str, Any]):
    with _state_lock:
        applicant = _ensure_applicant_for_provider_request(body)
        return _run_provider_check(applicant["id"], "plaid", body)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8110)
