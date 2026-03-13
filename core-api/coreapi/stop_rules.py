from typing import Any, Dict


def resolve_path(data: Dict[str, Any], path: str):
    value: Any = data
    for part in path.split("."):
        if isinstance(value, dict):
            value = value.get(part)
        else:
            return None
    return value


def evaluate_rule(rule: Dict[str, Any], data: Dict[str, Any]) -> bool:
    value = resolve_path(data, rule.get("field_path", ""))
    if value is None:
        return True
    operator = rule.get("operator", "gte")
    threshold = rule.get("threshold", "")
    try:
        numeric_value = float(value)
        numeric_threshold = float(threshold)
        return {
            "gte": numeric_value >= numeric_threshold,
            "lte": numeric_value <= numeric_threshold,
            "gt": numeric_value > numeric_threshold,
            "lt": numeric_value < numeric_threshold,
            "eq": numeric_value == numeric_threshold,
        }.get(operator, True)
    except (TypeError, ValueError):
        text_value = str(value)
        text_threshold = str(threshold)
        return {
            "eq": text_value == text_threshold,
            "neq": text_value != text_threshold,
            "not_in": text_value not in text_threshold,
            "contains": text_threshold in text_value,
        }.get(operator, True)

