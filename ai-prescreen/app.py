"""AI Pre-Screen — GPT-4o-mini decision on whether to run bureau pull."""
import json
import os
import time
from typing import Any, Dict, List, Optional

import httpx
from fastapi import FastAPI
from openai import AsyncOpenAI
from pydantic import BaseModel, Field

from prompts import build_system_prompt, build_user_prompt

AI_MODEL = os.getenv("AI_MODEL", "gpt-4o-mini")
AI_TEMPERATURE = float(os.getenv("AI_TEMPERATURE", "0.1"))
AI_MAX_TOKENS = int(os.getenv("AI_MAX_TOKENS", "500"))
AI_FALLBACK_ON_ERROR = os.getenv("AI_FALLBACK_ON_ERROR", "true").lower() in {"1", "true", "yes"}
CONFIG_URL = os.getenv("CONFIG_SERVICE_URL", "http://core-api:8000")

app = FastAPI(title="ai-prescreen", version="1.0.0")
_client = AsyncOpenAI()

_meta_cache: Dict[str, Any] = {}


async def _fetch_meta(ttl: int = 60) -> Dict[str, Any]:
    cached = _meta_cache.get("ai-prescreen")
    if cached and time.time() < cached[1]:
        return cached[0]
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            r = await client.get(f"{CONFIG_URL}/api/v1/services/ai-prescreen")
            data = r.json() if r.status_code == 200 else {}
            meta = data.get("meta") or {}
    except Exception:
        meta = {}
    _meta_cache["ai-prescreen"] = (meta, time.time() + ttl)
    return meta


class ApplicantIn(BaseModel):
    city: str = ""
    state: str = ""
    zipCode: str = ""
    age: Optional[int] = None


class HistoryIn(BaseModel):
    history_available: bool = False
    total_applications: int = 0
    last_30_days: int = 0
    last_decision: Optional[str] = None
    last_credit_score: Optional[int] = None
    avg_credit_score: Optional[int] = None
    score_trend: Optional[str] = None
    rejection_count: int = 0
    approval_count: int = 0
    approval_rate: float = 0.0
    rejection_reasons: List[str] = Field(default_factory=list)
    days_since_last: Optional[int] = None
    last_ai_risk_score: Optional[int] = None


class PrescreenRequest(BaseModel):
    request_id: str
    applicant: ApplicantIn = Field(default_factory=ApplicantIn)
    history: HistoryIn = Field(default_factory=HistoryIn)
    product_type: str = "loan"


@app.get("/health")
def health():
    return {"status": "ok", "service": "ai-prescreen", "model": AI_MODEL}


@app.post("/api/v1/prescreen")
async def prescreen(body: PrescreenRequest):
    start = time.time()

    meta = await _fetch_meta()
    system_prompt = meta.get("system_prompt") or build_system_prompt()
    user_prompt = build_user_prompt(
        applicant=body.applicant.model_dump(),
        history=body.history.model_dump(),
        product_type=body.product_type,
    )

    try:
        response = await _client.chat.completions.create(
            model=AI_MODEL,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            response_format={"type": "json_object"},
            temperature=AI_TEMPERATURE,
            max_tokens=AI_MAX_TOKENS,
        )
        ai_result = json.loads(response.choices[0].message.content)
        flags: List[str] = ai_result.get("flags") or []
        confidence = float(ai_result.get("confidence", 0.0))
        skip_bureau = bool(ai_result.get("skip_bureau", False))
        recommendation = ai_result.get("recommendation", "REVIEW")

        # Enforce safety: skip_bureau only for DECLINE + high confidence
        if recommendation != "DECLINE" or confidence < 0.85:
            skip_bureau = False

        return {
            "request_id": body.request_id,
            "skip_bureau": skip_bureau,
            "confidence": confidence,
            "reason": ai_result.get("reason", ""),
            "risk_level": ai_result.get("risk_level", "MEDIUM"),
            "recommendation": recommendation,
            "flags": flags,
            "model": AI_MODEL,
            "processing_time_ms": int((time.time() - start) * 1000),
        }
    except Exception as exc:
        if not AI_FALLBACK_ON_ERROR:
            raise
        # Fallback: don't skip bureau — safest default
        return {
            "request_id": body.request_id,
            "skip_bureau": False,
            "confidence": 0.0,
            "reason": f"AI pre-screen error: {exc}. Bureau pull will proceed.",
            "risk_level": "MEDIUM",
            "recommendation": "REVIEW",
            "flags": ["AI pre-screen unavailable"],
            "model": AI_MODEL,
            "processing_time_ms": int((time.time() - start) * 1000),
            "fallback": True,
        }
