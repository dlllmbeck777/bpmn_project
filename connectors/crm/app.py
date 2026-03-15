from datetime import datetime, timezone
from typing import Any, Dict
from fastapi import FastAPI
# CORS removed for internal service

app = FastAPI(title="crm", version="5.0.0")

@app.get("/health")
def health():
    return {"status": "ok", "service": "crm"}

@app.post("/api/update")
def handle(body: Dict[str, Any]):
    return {"service": "crm", "received_request_id": body.get("request_id"),
            "customer_id": body.get("customer_id"),
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "result": {"crm_updated": True, "segment": "PRIME"}}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8104)
