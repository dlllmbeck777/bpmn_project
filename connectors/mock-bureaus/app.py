"""Temporary mock service for iSoftPull, Creditsafe, and Plaid."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from threading import Lock
from typing import Any, Dict
from uuid import uuid4

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI(title="mock-bureaus", version="1.0.0")


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.isoformat().replace("+00:00", "Z")


def _deep_merge(base: Dict[str, Any], updates: Dict[str, Any]) -> Dict[str, Any]:
    merged = deepcopy(base)
    for key, value in (updates or {}).items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = _deep_merge(merged[key], value)
        else:
            merged[key] = deepcopy(value)
    return merged


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


def _request_id(body: Dict[str, Any]) -> str:
    return str(body.get("request_id") or f"MOCK-{uuid4().hex[:12].upper()}")


def _customer_id(body: Dict[str, Any]) -> str:
    return str(body.get("customer_id") or "MOCK-CUSTOMER")


def _applicant_names(body: Dict[str, Any]) -> Dict[str, str]:
    applicant = body.get("applicant") if isinstance(body.get("applicant"), dict) else {}
    first_name = applicant.get("firstName") or applicant.get("first_name") or "John"
    last_name = applicant.get("lastName") or applicant.get("last_name") or "Doe"
    return {"first_name": str(first_name), "last_name": str(last_name)}


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


def _build_isoftpull_response(body: Dict[str, Any], config: Dict[str, Any]) -> Dict[str, Any]:
    names = _applicant_names(body)
    request_id = _request_id(body)
    customer_id = _customer_id(body)
    now = _utcnow()
    scenario = config["scenario"]
    controls = deepcopy(config.get("controls", {}))

    defaults = {
        "pass_775": {"status": "COMPLETED", "creditScore": 775, "collectionCount": 0, "bureauHit": True, "intelligenceIndicator": "PASS"},
        "reject_score_550": {"status": "COMPLETED", "creditScore": 550, "collectionCount": 0, "bureauHit": True, "intelligenceIndicator": "PASS"},
        "reject_collections_6": {"status": "COMPLETED", "creditScore": 720, "collectionCount": 6, "bureauHit": True, "intelligenceIndicator": "PASS"},
        "no_hit": {"status": "COMPLETED", "creditScore": None, "collectionCount": 0, "bureauHit": False, "intelligenceIndicator": "NO_HIT"},
    }
    controls = _deep_merge(defaults.get(scenario, defaults["pass_775"]), controls)

    credit_score = controls.get("creditScore")
    collection_count = int(controls.get("collectionCount", 0) or 0)
    bureau_hit = bool(controls.get("bureauHit", credit_score is not None))
    status = str(controls.get("status", "COMPLETED"))
    intelligence = str(controls.get("intelligenceIndicator", "PASS"))
    report_url = f"https://mock-bureaus.local/isoftpull/reports/{request_id}"

    if not bureau_hit or scenario == "no_hit":
        response = {
            "id": 9001,
            "applicantId": 42,
            "providerCode": "ISOFTPULL",
            "providerName": "iSoftPull",
            "status": status,
            "intelligenceIndicator": intelligence,
            "reportUrl": report_url,
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
            "completedAt": _iso(now + timedelta(seconds=3)),
            "result": {"bureau_hit": False, "score": None, "creditScore": None, "collectionCount": 0},
            "mockScenario": scenario,
            "received_request_id": request_id,
            "customer_id": customer_id,
        }
        return _deep_merge(response, config.get("overrides", {}))

    transunion_score = int(controls.get("transunionScore", (credit_score or 0) + 5))
    equifax_score = int(controls.get("equifaxScore", credit_score or transunion_score))
    accounts = _iso_trade_accounts(collection_count)
    response = {
        "id": 9001,
        "applicantId": 42,
        "providerCode": "ISOFTPULL",
        "providerName": "iSoftPull",
        "status": status,
        "creditScore": int(credit_score),
        "equifaxScore": equifax_score,
        "transunionScore": transunion_score,
        "intelligenceIndicator": intelligence,
        "reportUrl": report_url,
        "rawResponse": {
            "equifaxScore": equifax_score,
            "transunionScore": transunion_score,
            "firstScore": int(credit_score),
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
        "completedAt": _iso(now + timedelta(seconds=5)),
        "result": {
            "bureau_hit": True,
            "score": int(credit_score),
            "creditScore": int(credit_score),
            "collectionCount": collection_count,
        },
        "mockScenario": scenario,
        "received_request_id": request_id,
        "customer_id": customer_id,
    }
    return _deep_merge(response, config.get("overrides", {}))


def _build_creditsafe_response(body: Dict[str, Any], config: Dict[str, Any]) -> Dict[str, Any]:
    names = _applicant_names(body)
    request_id = _request_id(body)
    customer_id = _customer_id(body)
    now = _utcnow()
    scenario = config["scenario"]
    controls = deepcopy(config.get("controls", {}))

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
            "status": "COMPLETED",
            "creditScore": None,
            "complianceAlertCount": 0,
            "derogatoryCount": 0,
            "intelligenceIndicator": "NO_DATA",
            "totalDirectorMatches": 0,
        },
    }
    controls = _deep_merge(defaults.get(scenario, defaults["clean_72"]), controls)

    credit_score = controls.get("creditScore")
    compliance_alert_count = int(controls.get("complianceAlertCount", 0) or 0)
    derogatory_count = int(controls.get("derogatoryCount", compliance_alert_count) or 0)
    status = str(controls.get("status", "COMPLETED"))
    intelligence = str(controls.get("intelligenceIndicator", "MULTIPLE_MATCHES"))
    total_matches = int(controls.get("totalDirectorMatches", 5) or 0)
    alerts = [{"id": f"alert-{index + 1}", "severity": "HIGH"} for index in range(compliance_alert_count)]

    response = {
        "id": 9002,
        "applicantId": 42,
        "providerCode": "CREDITSAFE",
        "providerName": "Creditsafe",
        "status": status,
        "creditScore": credit_score,
        "intelligenceIndicator": intelligence,
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
                "riskScoreDescription": "Very Low Risk" if (credit_score or 0) >= 70 else "Medium Risk",
                "companyName": f"{names['first_name'].upper()} {names['last_name'].upper()} HOLDINGS LLC",
                "riskScoreGrade": "A" if (credit_score or 0) >= 70 else "C",
                "riskScore": credit_score,
                "derogatoryCount": derogatory_count,
            },
            "compliance": {"alerts": alerts},
            "totalDirectorMatches": total_matches,
        },
        "requestedAt": _iso(now),
        "completedAt": _iso(now + timedelta(seconds=8)),
        "result": {
            "creditScore": credit_score,
            "company_score": credit_score,
            "complianceAlertCount": compliance_alert_count,
            "compliance_alert_count": compliance_alert_count,
        },
        "mockScenario": scenario,
        "received_request_id": request_id,
        "customer_id": customer_id,
    }

    if scenario == "no_data":
        response["rawResponse"] = {
            "bestMatch": None,
            "directors": [],
            "businessCredit": {},
            "compliance": {"alerts": []},
            "totalDirectorMatches": 0,
        }
        response["result"] = {"creditScore": None, "company_score": None, "complianceAlertCount": 0}

    return _deep_merge(response, config.get("overrides", {}))


def _build_plaid_response(body: Dict[str, Any], config: Dict[str, Any]) -> Dict[str, Any]:
    request_id = _request_id(body)
    customer_id = _customer_id(body)
    now = _utcnow()
    scenario = config["scenario"]
    controls = deepcopy(config.get("controls", {}))

    defaults = {
        "pending_link": {
            "status": "PENDING",
            "intelligenceIndicator": "PENDING_LINK",
            "accountsFound": 0,
            "cashflowStability": "PENDING",
            "errorMessage": None,
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
    controls = _deep_merge(defaults.get(scenario, defaults["pending_link"]), controls)

    tracking_id = controls.get("trackingId") or str(uuid4())
    status = str(controls.get("status", "PENDING"))
    intelligence = str(controls.get("intelligenceIndicator", "PENDING_LINK"))
    accounts_found = int(controls.get("accountsFound", 0) or 0)
    cashflow_stability = str(controls.get("cashflowStability", "PENDING"))
    error_message = controls.get("errorMessage")

    response = {
        "id": 9003,
        "applicantId": 42,
        "providerCode": "PLAID",
        "providerName": "Plaid",
        "status": status,
        "intelligenceIndicator": intelligence,
        "reportUrl": f"http://mock-bureaus:8110/api/v1/plaid/link/{tracking_id}",
        "rawResponse": {
            "sessionId": 100,
            "trackingId": tracking_id,
            "plaidUserId": "usr_mock_plaid_user",
            "trackingUrl": f"http://mock-bureaus:8110/api/v1/plaid/link/{tracking_id}",
            "hostedLinkUrl": f"https://secure.plaid.com/hl/{tracking_id.replace('-', '')}",
            "linkToken": f"link-sandbox-{tracking_id}",
            "linkTokenExpiration": _iso(now + timedelta(minutes=30)),
            "accounts": [{"accountId": f"mock-{index + 1}"} for index in range(accounts_found)],
        },
        "requestedAt": _iso(now),
        "completedAt": _iso(now + timedelta(seconds=2)) if status in {"COMPLETED", "FAILED"} else None,
        "result": {
            "accounts_found": accounts_found,
            "cashflow_stability": cashflow_stability,
            "status": "OK" if status == "COMPLETED" and accounts_found > 0 else status,
        },
        "mockScenario": scenario,
        "received_request_id": request_id,
        "customer_id": customer_id,
    }
    if error_message:
        response["errorMessage"] = error_message
    return _deep_merge(response, config.get("overrides", {}))


SCENARIO_CATALOG = {
    "isoftpull": {
        "pass_775": "Completed report with score 775 and zero collections.",
        "reject_score_550": "Completed report with score 550 for Flowable reject-by-score testing.",
        "reject_collections_6": "Completed report with score 720 and collection_count 6 for reject-by-collections testing.",
        "no_hit": "No-hit bureau response without score.",
    },
    "creditsafe": {
        "clean_72": "Completed response with score 72 and zero compliance alerts.",
        "reject_alerts_2": "Completed response with two compliance alerts for reject testing.",
        "no_data": "Completed response without match or score.",
    },
    "plaid": {
        "pending_link": "Pending link flow similar to hosted Plaid Link responses.",
        "accounts_3": "Completed response with three linked accounts.",
        "no_accounts": "Completed response with zero linked accounts.",
        "failed_missing_ssn": "Failed response for missing SSN validation.",
    },
}

DEFAULT_CONFIG = {
    "isoftpull": {"scenario": "pass_775", "controls": {}, "overrides": {}},
    "creditsafe": {"scenario": "clean_72", "controls": {}, "overrides": {}},
    "plaid": {"scenario": "pending_link", "controls": {}, "overrides": {}},
}

_state_lock = Lock()
_state = deepcopy(DEFAULT_CONFIG)


class ProviderConfigUpdate(BaseModel):
    scenario: str | None = None
    controls: Dict[str, Any] = {}
    overrides: Dict[str, Any] = {}


class BulkConfigUpdate(BaseModel):
    isoftpull: ProviderConfigUpdate | None = None
    creditsafe: ProviderConfigUpdate | None = None
    plaid: ProviderConfigUpdate | None = None


def get_current_config() -> Dict[str, Any]:
    with _state_lock:
        return deepcopy(_state)


def reset_config() -> Dict[str, Any]:
    with _state_lock:
        _state.clear()
        _state.update(deepcopy(DEFAULT_CONFIG))
        return deepcopy(_state)


def update_provider_config(provider: str, update: ProviderConfigUpdate) -> Dict[str, Any]:
    provider = _provider_key(provider)
    with _state_lock:
        current = deepcopy(_state[provider])
        scenario = update.scenario or current["scenario"]
        if scenario not in SCENARIO_CATALOG[provider]:
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


@app.get("/health")
def health():
    return {"status": "ok", "service": "mock-bureaus"}


@app.get("/api/v1/mock/catalog")
def catalog():
    return {
        "service": "mock-bureaus",
        "providers": {
            "isoftpull": {
                "endpoint_path": "/api/pull",
                "config_controls": ["creditScore", "collectionCount", "bureauHit", "status", "intelligenceIndicator"],
                "scenarios": SCENARIO_CATALOG["isoftpull"],
            },
            "creditsafe": {
                "endpoint_path": "/api/report",
                "config_controls": ["creditScore", "complianceAlertCount", "derogatoryCount", "status", "intelligenceIndicator"],
                "scenarios": SCENARIO_CATALOG["creditsafe"],
            },
            "plaid": {
                "endpoint_path": "/api/accounts",
                "config_controls": ["accountsFound", "cashflowStability", "status", "intelligenceIndicator", "errorMessage"],
                "scenarios": SCENARIO_CATALOG["plaid"],
            },
        },
    }


@app.get("/api/v1/mock/config")
def current_config():
    return {"service": "mock-bureaus", "config": get_current_config()}


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


@app.post("/api/pull")
def isoftpull_mock(body: Dict[str, Any]):
    return _build_response("isoftpull", body)


@app.post("/api/report")
def creditsafe_mock(body: Dict[str, Any]):
    return _build_response("creditsafe", body)


@app.post("/api/accounts")
def plaid_mock(body: Dict[str, Any]):
    return _build_response("plaid", body)


@app.get("/api/v1/plaid/link/{tracking_id}")
def plaid_tracking(tracking_id: str):
    response = _build_response("plaid", {"request_id": f"TRACK-{tracking_id}"})
    response["reportUrl"] = f"http://mock-bureaus:8110/api/v1/plaid/link/{tracking_id}"
    if isinstance(response.get("rawResponse"), dict):
        response["rawResponse"]["trackingId"] = tracking_id
        response["rawResponse"]["trackingUrl"] = response["reportUrl"]
    return {
        "trackingId": tracking_id,
        "status": response.get("status"),
        "intelligenceIndicator": response.get("intelligenceIndicator"),
        "mockScenario": response.get("mockScenario"),
        "response": response,
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8110)
