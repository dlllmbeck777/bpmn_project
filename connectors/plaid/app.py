"""Plaid connector — mock implementation with stable contract."""
from datetime import datetime, timezone
from typing import Any, Dict
from fastapi import FastAPI
# CORS removed for internal service

app = FastAPI(title="plaid", version="2.0.0")


@app.get("/health")
def health():
    return {"status": "ok", "service": "plaid"}


@app.post("/api/accounts")
def handle(body: Dict[str, Any]):
    return {
        "service": "plaid",
        "received_request_id": body.get("request_id"),
        "customer_id": body.get("customer_id"),
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "result": {"accounts_found": 3, "cashflow_stability": "GOOD"},
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8103)
