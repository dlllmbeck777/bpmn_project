"""AI Risk Advisor — GPT-4o-mini structured risk assessment after bureau report parsing."""
import json
import os
import time
from typing import Any, Dict, List, Optional

from fastapi import FastAPI
from openai import AsyncOpenAI
from pydantic import BaseModel, Field

from prompts import build_system_prompt, build_user_prompt

AI_MODEL = os.getenv("AI_MODEL", "gpt-4o-mini")
AI_TEMPERATURE = float(os.getenv("AI_TEMPERATURE", "0.1"))
AI_MAX_TOKENS = int(os.getenv("AI_MAX_TOKENS", "1000"))
AI_FALLBACK_ON_ERROR = os.getenv("AI_FALLBACK_ON_ERROR", "true").lower() in {"1", "true", "yes"}

app = FastAPI(title="ai-advisor", version="1.0.0")
_client = AsyncOpenAI()


class ApplicantIn(BaseModel):
    city: str = ""
    state: str = ""
    zipCode: str = ""
    age: Optional[int] = None


class ParsedReportSummary(BaseModel):
    credit_score: Optional[int] = None
    collection_count: Optional[int] = None
    creditsafe_compliance_alert_count: Optional[int] = None
    required_reports_available: Optional[bool] = None
    accounts_found: Optional[int] = None
    cashflow_stability: Optional[str] = None


class ParsedReport(BaseModel):
    summary: ParsedReportSummary = Field(default_factory=ParsedReportSummary)


class ContextIn(BaseModel):
    route_mode: str = ""
    product_type: str = "loan"


class AssessRequest(BaseModel):
    request_id: str
    applicant: ApplicantIn = Field(default_factory=ApplicantIn)
    parsed_report: ParsedReport = Field(default_factory=ParsedReport)
    history: Optional[Dict[str, Any]] = None
    context: ContextIn = Field(default_factory=ContextIn)


@app.get("/health")
def health():
    return {"status": "ok", "service": "ai-advisor", "model": AI_MODEL}


@app.post("/api/v1/assess")
async def assess(body: AssessRequest):
    start = time.time()
    summary = body.parsed_report.summary

    system_prompt = build_system_prompt()
    user_prompt = build_user_prompt(
        applicant=body.applicant.model_dump(),
        summary=summary.model_dump(),
        product_type=body.context.product_type,
        history=body.history,
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
        tokens = {
            "prompt": response.usage.prompt_tokens,
            "completion": response.usage.completion_tokens,
        }
        red_flags: List[str] = ai_result.get("red_flags") or []
        return {
            "request_id": body.request_id,
            "model": AI_MODEL,
            "risk_score": int(ai_result.get("risk_score", 50)),
            "risk_level": ai_result.get("risk_level", "MEDIUM"),
            "recommendation": ai_result.get("recommendation", "REVIEW"),
            "confidence": float(ai_result.get("confidence", 0.5)),
            "red_flags": red_flags,
            "positive_factors": ai_result.get("positive_factors") or [],
            "narrative": ai_result.get("narrative", ""),
            "suggested_conditions": ai_result.get("suggested_conditions") or [],
            "red_flags_count": len(red_flags),
            "processing_time_ms": int((time.time() - start) * 1000),
            "tokens_used": tokens,
        }
    except Exception as exc:
        if not AI_FALLBACK_ON_ERROR:
            raise
        return {
            "request_id": body.request_id,
            "model": AI_MODEL,
            "risk_score": 50,
            "risk_level": "MEDIUM",
            "recommendation": "REVIEW",
            "confidence": 0.0,
            "red_flags": ["AI assessment unavailable"],
            "positive_factors": [],
            "narrative": f"AI advisor error: {exc}. Defaulting to REVIEW.",
            "suggested_conditions": [],
            "red_flags_count": 1,
            "processing_time_ms": int((time.time() - start) * 1000),
            "tokens_used": {"prompt": 0, "completion": 0},
            "fallback": True,
        }
