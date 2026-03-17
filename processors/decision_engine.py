"""Decision service evaluates editable rules against parsed reports."""
import os
from typing import Any, Dict, List, Optional

import httpx
from fastapi import FastAPI
from pydantic import BaseModel

import report_parser

CONFIG_URL = os.getenv("CONFIG_SERVICE_URL", "http://core-api:8000").rstrip("/")
INTERNAL_API_KEY = os.getenv("INTERNAL_API_KEY", "")

app = FastAPI(title="decision-service", version="1.0.0")

DECISION_APPROVED = "APPROVED"
DECISION_REJECTED = "REJECTED"
DECISION_PASS_TO_CUSTOM = "PASS TO CUSTOM"


class DecideRequest(BaseModel):
    request_id: str
    route_mode: str = "FLOWABLE"
    external_applicant_id: str = ""
    steps: Dict[str, Any] = {}
    external_reports: Dict[str, Any] = {}
    parsed_report: Optional[Dict[str, Any]] = None


def _internal_headers() -> Dict[str, str]:
    headers: Dict[str, str] = {}
    if INTERNAL_API_KEY:
        headers["X-Internal-Api-Key"] = INTERNAL_API_KEY
    return headers


def _resolve(data: Any, path: str) -> Any:
    current = data
    for part in str(path or "").split("."):
        if not part:
            continue
        if isinstance(current, dict):
            current = current.get(part)
            continue
        if isinstance(current, list):
            try:
                current = current[int(part)]
                continue
            except (ValueError, IndexError):
                return None
        return None
    return current


def _coerce_bool(value: Any) -> Optional[bool]:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"true", "1", "yes", "y"}:
            return True
        if normalized in {"false", "0", "no", "n"}:
            return False
    return None


def _evaluate_rule(rule: Dict[str, Any], data: Dict[str, Any]) -> bool:
    value = _resolve(data, rule.get("field_path", ""))
    if value is None:
        return True

    operator = str(rule.get("operator", "gte")).lower()
    threshold = rule.get("threshold", "")

    bool_value = _coerce_bool(value)
    bool_threshold = _coerce_bool(threshold)
    if bool_value is not None and bool_threshold is not None:
        if operator == "eq":
            return bool_value == bool_threshold
        if operator == "neq":
            return bool_value != bool_threshold

    try:
        value_number = float(value)
        threshold_number = float(threshold)
        if operator == "gte":
            return value_number >= threshold_number
        if operator == "lte":
            return value_number <= threshold_number
        if operator == "gt":
            return value_number > threshold_number
        if operator == "lt":
            return value_number < threshold_number
        if operator == "eq":
            return value_number == threshold_number
        if operator == "neq":
            return value_number != threshold_number
    except (TypeError, ValueError):
        value_text = str(value)
        threshold_text = str(threshold)
        if operator == "eq":
            return value_text == threshold_text
        if operator == "neq":
            return value_text != threshold_text
        if operator == "contains":
            return threshold_text in value_text
        if operator == "not_in":
            return value_text not in threshold_text
    return True


def _step_statuses(steps: Dict[str, Any]) -> Dict[str, str]:
    statuses: Dict[str, str] = {}
    for service_id, payload in (steps or {}).items():
        if isinstance(payload, dict):
            statuses[service_id] = str(payload.get("status") or "UNKNOWN")
        else:
            statuses[service_id] = "UNKNOWN"
    return statuses


def _merge_report_inputs(steps: Dict[str, Any], external_reports: Dict[str, Any]) -> Dict[str, Any]:
    merged = {key: dict(value) if isinstance(value, dict) else value for key, value in (steps or {}).items()}
    for service_id, payload in (external_reports or {}).items():
        if not isinstance(payload, dict):
            if service_id not in merged:
                merged[service_id] = payload
            continue
        current = merged.get(service_id)
        merged_payload = dict(current) if isinstance(current, dict) else {}
        merged_payload.update(payload)
        merged_payload.setdefault("service", service_id)
        merged[service_id] = merged_payload
    return merged


def _decision_value(status: str, *, enabled_rules_count: int) -> Optional[str]:
    normalized = str(status or "").upper()
    if enabled_rules_count <= 0:
        return DECISION_PASS_TO_CUSTOM
    if normalized == "REJECTED":
        return DECISION_REJECTED
    if normalized == "COMPLETED":
        return DECISION_APPROVED
    if normalized == "REVIEW":
        return DECISION_PASS_TO_CUSTOM
    return None


def _build_decision_inputs(parsed_report: Dict[str, Any], steps: Dict[str, Any], external_reports: Dict[str, Any]) -> Dict[str, Any]:
    merged_reports = _merge_report_inputs(steps, external_reports)
    return {
        "result": {
            "parsed_report": parsed_report,
            "steps": merged_reports,
            "external_reports": external_reports or merged_reports,
        }
    }


def _baseline_decision(parsed_report: Dict[str, Any]) -> tuple[str, str]:
    summary = parsed_report.get("summary") if isinstance(parsed_report.get("summary"), dict) else {}
    if parsed_report.get("status") != "OK":
        return "REVIEW", "Parsed report is unavailable for decisioning"
    if not summary.get("required_reports_available", False):
        return "REVIEW", "One or more required report providers were unavailable"
    return "COMPLETED", "Decision rules passed"


def _apply_rules(parsed_report: Dict[str, Any], rules: List[Dict[str, Any]], steps: Dict[str, Any], external_reports: Dict[str, Any]) -> tuple[str, str, Dict[str, Any]]:
    envelope = _build_decision_inputs(parsed_report, steps, external_reports)
    enabled_rules = [rule for rule in rules if rule.get("enabled", True)]
    enabled_rules.sort(key=lambda rule: int(rule.get("priority", 0)))
    for rule in enabled_rules:
        if _evaluate_rule(rule, envelope):
            continue
        action = str(rule.get("action_on_fail", "REJECT")).upper()
        status = "REVIEW" if action == "REVIEW" else "REJECTED"
        reason = f"Decision rule failed: {rule.get('name', 'unnamed rule')}"
        return status, reason, {
            "id": rule.get("id"),
            "name": rule.get("name"),
            "action_on_fail": action,
            "field_path": rule.get("field_path"),
            "operator": rule.get("operator"),
            "threshold": rule.get("threshold"),
        }
    return "COMPLETED", "Decision rules passed", {}


async def _fetch_rules() -> Optional[List[Dict[str, Any]]]:
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(
                f"{CONFIG_URL}/api/v1/stop-factors?stage=decision",
                headers=_internal_headers(),
            )
        response.raise_for_status()
        payload = response.json() if response.content else {}
        return payload.get("items", []) if isinstance(payload, dict) else []
    except Exception:
        return None


def _ensure_parsed_report(body: DecideRequest) -> Dict[str, Any]:
    if isinstance(body.parsed_report, dict) and body.parsed_report:
        return body.parsed_report
    report_inputs = _merge_report_inputs(body.steps, body.external_reports)
    return report_parser.parse(report_parser.ParseRequest(request_id=body.request_id, steps=report_inputs))


@app.get("/health")
def health():
    return {"status": "ok", "service": "decision-service"}


@app.post("/api/v1/decide")
async def decide(body: DecideRequest):
    parsed_report = _ensure_parsed_report(body)
    merged_reports = _merge_report_inputs(body.steps, body.external_reports)
    rules = await _fetch_rules()
    step_statuses = _step_statuses(merged_reports)
    enabled_rules = [rule for rule in (rules or []) if rule.get("enabled", True)]
    enabled_rules_count = len(enabled_rules)
    request_context = {
        "request_id": body.request_id,
        "route_mode": body.route_mode,
        "external_applicant_id": body.external_applicant_id,
    }
    if rules is None:
        return {
            "status": "ENGINE_ERROR",
            "request_id": body.request_id,
            "decision_reason": "Decision rules are unavailable",
            "decision_source": "decision-service",
            "request_context": request_context,
            "steps": merged_reports,
            "external_reports": body.external_reports or merged_reports,
            "step_statuses": step_statuses,
            "parsed_report": parsed_report,
            "summary": {
                **(parsed_report.get("summary") if isinstance(parsed_report.get("summary"), dict) else {}),
                "request_id": body.request_id,
                "decision_source": "decision-service",
                "decision_reason": "Decision rules are unavailable",
                "decision": None,
                "rules_evaluated": 0,
                "matched_rule": None,
                **{f"{service_id}_status": status for service_id, status in step_statuses.items()},
            },
        }

    baseline_status, baseline_reason = _baseline_decision(parsed_report)
    status, reason = baseline_status, baseline_reason
    matched_rule: Dict[str, Any] = {}
    if enabled_rules_count <= 0:
        if status == "COMPLETED":
            reason = "No active decision rules configured"
    elif status == "COMPLETED":
        status, reason, matched_rule = _apply_rules(parsed_report, rules, body.steps, body.external_reports)
    decision = _decision_value(status, enabled_rules_count=enabled_rules_count)

    summary = {
        **(parsed_report.get("summary") if isinstance(parsed_report.get("summary"), dict) else {}),
        "request_id": body.request_id,
        "decision": decision,
        "decision_source": "decision-service",
        "decision_reason": reason,
        "rules_evaluated": enabled_rules_count,
        "matched_rule": matched_rule or None,
        "plaid_considered": False,
        **{f"{service_id}_status": status_value for service_id, status_value in step_statuses.items()},
    }
    return {
        "status": status,
        "request_id": body.request_id,
        "decision": decision,
        "decision_reason": reason,
        "decision_source": "decision-service",
        "matched_rule": matched_rule or None,
        "request_context": request_context,
        "steps": merged_reports,
        "external_reports": body.external_reports or merged_reports,
        "step_statuses": step_statuses,
        "baseline_decision": {
            "status": baseline_status,
            "reason": baseline_reason,
        },
        "parsed_report": parsed_report,
        "summary": summary,
    }
