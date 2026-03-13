"""Creditsafe connector — mock implementation with stable contract."""
from datetime import datetime, timezone
from typing import Any, Dict
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="creditsafe", version="2.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.get("/health")
def health():
    return {"status": "ok", "service": "creditsafe"}


@app.post("/api/report")
def handle(body: Dict[str, Any]):
    return {
        "service": "creditsafe",
        "received_request_id": body.get("request_id"),
        "customer_id": body.get("customer_id"),
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "result": {"company_score": "A", "risk_band": "LOW"},
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8102)
