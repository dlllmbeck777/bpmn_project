"""AI Risk Advisor — GPT-4o-mini structured risk assessment after bureau report parsing.

Production-ready:
  • exponential-backoff retry  (429 / 500 / 503)
  • per-service budget check   via core-api before each call
  • usage logging              (tokens + cost) after each call
"""
import asyncio
import json
import logging
import os
import time
from typing import Any, Dict, List, Optional

import httpx
from fastapi import FastAPI
from openai import AsyncOpenAI, APIStatusError
from pydantic import BaseModel, Field

from prompts import build_system_prompt, build_user_prompt

# ── Config ────────────────────────────────────────────────────────────────────
AI_MODEL         = os.getenv("AI_MODEL", "gpt-4o-mini")
AI_TEMPERATURE   = float(os.getenv("AI_TEMPERATURE", "0.1"))
AI_MAX_TOKENS    = int(os.getenv("AI_MAX_TOKENS", "1000"))
AI_FALLBACK      = os.getenv("AI_FALLBACK_ON_ERROR", "true").lower() in {"1", "true", "yes"}
AI_MAX_RETRIES   = int(os.getenv("AI_MAX_RETRIES", "3"))
AI_RETRY_BASE_S  = float(os.getenv("AI_RETRY_BASE_S", "1.0"))
CONFIG_URL       = os.getenv("CONFIG_SERVICE_URL", "http://core-api:8000")
INTERNAL_API_KEY = os.getenv("INTERNAL_API_KEY", "")
SERVICE_ID       = "ai-advisor"

# gpt-4o-mini pricing (USD per token)
_COST_IN  = 0.150 / 1_000_000
_COST_OUT = 0.600 / 1_000_000

log = logging.getLogger(SERVICE_ID)
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")

app = FastAPI(title=SERVICE_ID, version="2.0.0")
_client = AsyncOpenAI()

# ── Meta / system-prompt cache ────────────────────────────────────────────────
_meta_cache: Dict[str, Any] = {}


async def _fetch_meta(ttl: int = 60) -> Dict[str, Any]:
    cached = _meta_cache.get(SERVICE_ID)
    if cached and time.time() < cached[1]:
        return cached[0]
    try:
        async with httpx.AsyncClient(timeout=3.0) as hx:
            r = await hx.get(f"{CONFIG_URL}/api/v1/services/{SERVICE_ID}")
            meta = (r.json().get("meta") or {}) if r.status_code == 200 else {}
    except Exception:
        meta = {}
    _meta_cache[SERVICE_ID] = (meta, time.time() + ttl)
    return meta


# ── Budget check ──────────────────────────────────────────────────────────────
async def _budget_check() -> tuple[bool, str]:
    if not INTERNAL_API_KEY:
        return True, "no internal key configured"
    try:
        async with httpx.AsyncClient(timeout=3.0) as hx:
            r = await hx.get(
                f"{CONFIG_URL}/api/v1/ai/budget/check/{SERVICE_ID}",
                headers={"x-internal-api-key": INTERNAL_API_KEY},
            )
            if r.status_code == 200:
                d = r.json()
                return d.get("allowed", True), d.get("reason", "")
    except Exception as e:
        log.warning("budget check failed: %s", e)
    return True, "budget check unavailable"


# ── Usage log ─────────────────────────────────────────────────────────────────
async def _log_usage(
    request_id: Optional[str],
    prompt_tokens: int,
    completion_tokens: int,
    status: str = "ok",
    error_code: Optional[str] = None,
) -> None:
    cost = prompt_tokens * _COST_IN + completion_tokens * _COST_OUT
    try:
        async with httpx.AsyncClient(timeout=3.0) as hx:
            await hx.post(
                f"{CONFIG_URL}/internal/ai/usage",
                json={
                    "request_id":        request_id,
                    "service_id":        SERVICE_ID,
                    "model":             AI_MODEL,
                    "prompt_tokens":     prompt_tokens,
                    "completion_tokens": completion_tokens,
                    "cost_usd":          round(cost, 6),
                    "status":            status,
                    "error_code":        error_code,
                },
                headers={"x-internal-api-key": INTERNAL_API_KEY},
            )
    except Exception as e:
        log.warning("usage log failed: %s", e)


# ── OpenAI call with retry ────────────────────────────────────────────────────
_RETRYABLE_CODES = {429, 500, 502, 503, 504}


async def _call_openai(system_prompt: str, user_prompt: str) -> Any:
    last_exc: Exception = RuntimeError("no attempts")
    for attempt in range(AI_MAX_RETRIES):
        try:
            return await _client.chat.completions.create(
                model=AI_MODEL,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user",   "content": user_prompt},
                ],
                response_format={"type": "json_object"},
                temperature=AI_TEMPERATURE,
                max_tokens=AI_MAX_TOKENS,
            )
        except APIStatusError as e:
            last_exc = e
            if e.status_code not in _RETRYABLE_CODES:
                raise
            wait = AI_RETRY_BASE_S * (2 ** attempt)
            log.warning("OpenAI %s on attempt %d/%d — retrying in %.1fs",
                        e.status_code, attempt + 1, AI_MAX_RETRIES, wait)
            await asyncio.sleep(wait)
        except Exception:
            raise
    raise last_exc


# ── Models ────────────────────────────────────────────────────────────────────
class ApplicantIn(BaseModel):
    city: str = ""; state: str = ""; zipCode: str = ""; age: Optional[int] = None


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
    route_mode: str = ""; product_type: str = "loan"


class AssessRequest(BaseModel):
    request_id: str
    applicant:     ApplicantIn  = Field(default_factory=ApplicantIn)
    parsed_report: ParsedReport = Field(default_factory=ParsedReport)
    history:       Optional[Dict[str, Any]] = None
    context:       ContextIn    = Field(default_factory=ContextIn)


# ── Endpoints ─────────────────────────────────────────────────────────────────
@app.get("/health")
def health():
    return {"status": "ok", "service": SERVICE_ID, "model": AI_MODEL}


@app.post("/api/v1/assess")
async def assess(body: AssessRequest):
    start   = time.time()
    summary = body.parsed_report.summary

    # 1. Budget check
    allowed, budget_reason = await _budget_check()
    if not allowed:
        log.warning("[%s] budget exceeded: %s", body.request_id, budget_reason)
        asyncio.create_task(_log_usage(body.request_id, 0, 0, "budget_exceeded"))
        return _fallback(body, start, f"Budget limit reached: {budget_reason}", "budget_exceeded")

    # 2. Fetch meta / system prompt
    meta = await _fetch_meta()
    system_prompt = meta.get("system_prompt") or build_system_prompt()
    user_prompt   = build_user_prompt(
        applicant=body.applicant.model_dump(),
        summary=summary.model_dump(),
        product_type=body.context.product_type,
        history=body.history,
    )

    # 3. Call OpenAI with retry
    try:
        response   = await _call_openai(system_prompt, user_prompt)
        ai_result  = json.loads(response.choices[0].message.content)
        p_tok      = response.usage.prompt_tokens
        c_tok      = response.usage.completion_tokens

        asyncio.create_task(_log_usage(body.request_id, p_tok, c_tok, "ok"))
        log.info("[%s] assess ok  prompt=%d compl=%d cost=$%.5f",
                 body.request_id, p_tok, c_tok, p_tok * _COST_IN + c_tok * _COST_OUT)

        red_flags: List[str] = ai_result.get("red_flags") or []
        cost = round(p_tok * _COST_IN + c_tok * _COST_OUT, 6)
        raw_conf = ai_result.get("confidence", 0.5)
        try:
            confidence = float(raw_conf)
            if confidence > 1.0:  # AI returns 0-100 scale, normalize to 0-1
                confidence = confidence / 100.0
        except (TypeError, ValueError):
            confidence = 0.5
        return {
            "request_id":          body.request_id,
            "model":               AI_MODEL,
            "risk_score":          int(ai_result.get("risk_score") or 50),
            "risk_level":          ai_result.get("risk_level", "MEDIUM"),
            "recommendation":      ai_result.get("recommendation", "REVIEW"),
            "confidence":          confidence,
            "red_flags":           red_flags,
            "positive_factors":    ai_result.get("positive_factors") or [],
            "narrative":           ai_result.get("narrative", ""),
            "suggested_conditions":ai_result.get("suggested_conditions") or [],
            "red_flags_count":     len(red_flags),
            "tokens_used":         {"prompt": p_tok, "completion": c_tok},
            "cost_usd":            cost,
            "processing_time_ms":  int((time.time() - start) * 1000),
        }

    except APIStatusError as e:
        err_code = str(e.status_code)
        asyncio.create_task(_log_usage(body.request_id, 0, 0, "fallback", err_code))
        log.error("[%s] OpenAI error %s: %s", body.request_id, e.status_code, e.message)
        if not AI_FALLBACK:
            raise
        return _fallback(body, start, f"AI advisor error: {e}. Defaulting to REVIEW.", err_code)

    except Exception as exc:
        asyncio.create_task(_log_usage(body.request_id, 0, 0, "fallback", "unknown"))
        log.error("[%s] unexpected error: %s", body.request_id, exc)
        if not AI_FALLBACK:
            raise
        return _fallback(body, start, f"AI advisor error: {exc}. Defaulting to REVIEW.")


def _fallback(body: AssessRequest, start: float, reason: str, error_code: Optional[str] = None) -> dict:
    return {
        "request_id":          body.request_id,
        "model":               AI_MODEL,
        "risk_score":          50,
        "risk_level":          "MEDIUM",
        "recommendation":      "REVIEW",
        "confidence":          0.0,
        "red_flags":           ["AI assessment unavailable"],
        "positive_factors":    [],
        "narrative":           reason,
        "suggested_conditions":[],
        "red_flags_count":     1,
        "tokens_used":         {"prompt": 0, "completion": 0},
        "cost_usd":            0.0,
        "processing_time_ms":  int((time.time() - start) * 1000),
        "fallback":            True,
        "error_code":          error_code,
    }
