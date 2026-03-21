"""Prompt templates for AI Risk Advisor."""
from typing import Any, Dict, Optional


def build_system_prompt() -> str:
    return (
        "You are a credit risk analyst AI assistant for a lending platform.\n"
        "Analyze applicant data and credit bureau reports to provide structured risk assessment.\n\n"
        "RULES:\n"
        "- Respond ONLY with valid JSON matching the specified schema\n"
        "- You are an ADVISOR — your assessment informs human decision-makers\n"
        "- Be conservative: when in doubt, recommend REVIEW\n"
        "- Never recommend APPROVE for credit scores below 600 or collections > 3\n"
        "- Risk levels: LOW (0-30), MEDIUM (31-60), HIGH (61-80), CRITICAL (81-100)\n"
        "- Recommendations: APPROVE, REVIEW, DECLINE"
    )


def build_user_prompt(
    applicant: Dict[str, Any],
    summary: Dict[str, Any],
    product_type: str = "loan",
    history: Optional[Dict[str, Any]] = None,
) -> str:
    history_section = ""
    if history and history.get("history_available"):
        history_section = (
            "\nCLIENT HISTORY:\n"
            f"- Previous applications: {history.get('total_applications', 0)}\n"
            f"- Last decision: {history.get('last_decision', 'N/A')}\n"
            f"- Approval rate: {int(history.get('approval_rate', 0) * 100)}%\n"
            f"- Score trend: {history.get('score_trend', 'N/A')}\n"
            f"- Days since last application: {history.get('days_since_last', 'N/A')}\n"
        )

    return (
        "Analyze this credit application:\n\n"
        f"APPLICANT: {applicant.get('city', '')}, {applicant.get('state', '')} "
        f"{applicant.get('zipCode', '')}, age {applicant.get('age', 'unknown')}\n\n"
        "CREDIT DATA:\n"
        f"- Credit Score: {summary.get('credit_score', 'N/A')} (min threshold: 580)\n"
        f"- Collections: {summary.get('collection_count', 'N/A')} (max allowed: 5)\n"
        f"- Compliance Alerts: {summary.get('creditsafe_compliance_alert_count', 'N/A')} (max allowed: 1)\n"
        f"- Bank Accounts: {summary.get('accounts_found', 'N/A')}\n"
        f"- Cashflow: {summary.get('cashflow_stability', 'N/A')}\n"
        f"- Reports Available: {summary.get('required_reports_available', 'N/A')}\n"
        f"{history_section}\n"
        f"PRODUCT: {product_type}\n\n"
        "Return JSON: {risk_score, risk_level, recommendation, confidence, "
        "red_flags[], positive_factors[], narrative, suggested_conditions[]}"
    )
