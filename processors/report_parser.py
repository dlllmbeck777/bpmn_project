"""Report Parser — normalizes credit connector responses."""
from datetime import datetime, timezone
from typing import Any, Dict
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="report-parser", version="4.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

class ParseRequest(BaseModel):
    request_id: str
    steps: Dict[str, Any] = {}

def _extract_isoftpull(data: dict) -> dict:
    r = data.get("result", data)
    return {"provider": "isoftpull", "credit_score": r.get("score"), "bureau_hit": r.get("bureau_hit", False),
            "status": "OK" if r.get("bureau_hit") else "NO_HIT"}

def _extract_creditsafe(data: dict) -> dict:
    r = data.get("result", data)
    return {"provider": "creditsafe", "company_score": r.get("company_score"), "risk_band": r.get("risk_band"),
            "status": "OK" if r.get("company_score") else "NO_DATA"}

def _extract_plaid(data: dict) -> dict:
    r = data.get("result", data)
    return {"provider": "plaid", "accounts_found": r.get("accounts_found", 0),
            "cashflow_stability": r.get("cashflow_stability"),
            "status": "OK" if r.get("accounts_found", 0) > 0 else "NO_ACCOUNTS"}


def _extract_crm(data: dict) -> dict:
    r = data.get("result", data)
    return {"provider": "crm", "crm_updated": r.get("crm_updated", False), "segment": r.get("segment"),
            "status": "OK" if r.get("crm_updated") else "NO_UPDATE"}

@app.get("/health")
def health():
    return {"status": "ok", "service": "report-parser"}

@app.post("/api/v1/parse")
def parse(body: ParseRequest):
    extractors = {"isoftpull": _extract_isoftpull, "creditsafe": _extract_creditsafe, "plaid": _extract_plaid, "crm": _extract_crm}
    providers = {}
    for key, data in body.steps.items():
        if key in extractors and isinstance(data, dict):
            providers[key] = extractors[key](data)
    iso = providers.get("isoftpull", {})
    plaid = providers.get("plaid", {})
    crm = providers.get("crm", {})
    return {"request_id": body.request_id, "parsed_at": datetime.now(timezone.utc).isoformat(),
            "providers": providers,
            "summary": {"credit_score": iso.get("credit_score"),
                        "accounts_found": plaid.get("accounts_found", 0),
                        "cashflow_stability": plaid.get("cashflow_stability"),
                        "crm_segment": crm.get("segment"),
                        "all_providers_ok": all(p.get("status") == "OK" for p in providers.values())}}
