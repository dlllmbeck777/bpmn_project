"""Prompt templates for AI Pre-Screen service."""
from typing import Any, Dict


def build_system_prompt() -> str:
    return (
        "You are a pre-screening AI for a credit lending platform.\n"
        "Analyze applicant history to decide if a bureau credit pull is warranted.\n\n"
        "RULES:\n"
        "- Respond ONLY with valid JSON matching the specified schema\n"
        "- skip_bureau=true ONLY when confidence >= 0.85 AND recommendation is DECLINE\n"
        "- skip_bureau=true ONLY for DECLINE recommendation, never for APPROVE\n"
        "- If history_available=false (new client) → skip_bureau=false, confidence=0\n"
        "- If last_credit_score >= 700 AND approval_rate > 0.5 → skip_bureau=false (good client, run bureau)\n"
        "- Never skip bureau for returning clients with IMPROVING score_trend\n"
        "- Risk levels: LOW, MEDIUM, HIGH, CRITICAL\n"
        "- Recommendations: APPROVE, REVIEW, DECLINE"
    )


def build_user_prompt(
    applicant: Dict[str, Any],
    history: Dict[str, Any],
    product_type: str = "loan",
) -> str:
    if not history.get("history_available"):
        history_summary = "No history available (new client)"
    else:
        history_summary = (
            f"- Total applications: {history.get('total_applications', 0)}\n"
            f"- Applications in last 30 days: {history.get('last_30_days', 0)}\n"
            f"- Last decision: {history.get('last_decision', 'N/A')}\n"
            f"- Last credit score: {history.get('last_credit_score', 'N/A')}\n"
            f"- Average credit score: {history.get('avg_credit_score', 'N/A')}\n"
            f"- Score trend: {history.get('score_trend', 'N/A')}\n"
            f"- Rejection count: {history.get('rejection_count', 0)}\n"
            f"- Approval rate: {int(history.get('approval_rate', 0) * 100)}%\n"
            f"- Rejection reasons: {', '.join(history.get('rejection_reasons', []))}\n"
            f"- Days since last application: {history.get('days_since_last', 'N/A')}\n"
            f"- Last AI risk score: {history.get('last_ai_risk_score', 'N/A')}"
        )

    return (
        "Pre-screen credit application for bureau pull decision:\n\n"
        f"APPLICANT: {applicant.get('city', '')}, {applicant.get('state', '')} "
        f"age {applicant.get('age', 'unknown')}\n"
        f"PRODUCT: {product_type}\n\n"
        "CLIENT HISTORY:\n"
        f"{history_summary}\n\n"
        "Should we spend $3-5 on bureau pull?\n"
        "Return JSON: {skip_bureau, confidence, reason, risk_level, recommendation, flags[]}"
    )
