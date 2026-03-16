#!/usr/bin/env python3
"""Run predefined demo test cases against mock-bureaus and the platform API."""

from __future__ import annotations

import argparse
import json
import ssl
import sys
import time
from copy import deepcopy
from pathlib import Path
from typing import Any, Dict, Iterable, Optional
from urllib import error, request


DEMO_CONNECTOR_IDS = ("isoftpull", "creditsafe", "plaid")
DEMO_CONNECTOR_BASE_URL = "http://mock-bureaus:8110"
DEFAULT_LIVE_BASE_URLS = {
    "isoftpull": "http://isoftpull:8101",
    "creditsafe": "http://creditsafe:8102",
    "plaid": "http://plaid:8103",
}
FINAL_STATUSES = {"COMPLETED", "REVIEW", "REJECTED", "FAILED"}


def _trim_base(url: str) -> str:
    return (url or "").strip().rstrip("/")


def _deep_merge(base: Dict[str, Any], updates: Dict[str, Any]) -> Dict[str, Any]:
    merged = deepcopy(base)
    for key, value in (updates or {}).items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = _deep_merge(merged[key], value)
        else:
            merged[key] = deepcopy(value)
    return merged


def _load_cases(path: Path) -> Dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _http_request(method: str, url: str, *, headers: Optional[Dict[str, str]] = None, payload: Any = None, insecure: bool = False) -> Any:
    data = None
    req_headers = dict(headers or {})
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        req_headers.setdefault("Content-Type", "application/json")
    req = request.Request(url, method=method.upper(), data=data, headers=req_headers)
    context = ssl._create_unverified_context() if insecure and url.startswith("https://") else None
    try:
        with request.urlopen(req, context=context, timeout=30) as response:
            body = response.read().decode("utf-8")
            return json.loads(body) if body else {}
    except error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"{method} {url} -> HTTP {exc.code}: {body}") from exc
    except error.URLError as exc:
        raise RuntimeError(f"{method} {url} -> network error: {exc.reason}") from exc


def _switch_demo_connectors(api_base: str, admin_api_key: str, *, insecure: bool, enable_demo: bool) -> None:
    headers = {"X-Api-Key": admin_api_key, "X-User-Role": "admin"}
    services = _http_request("GET", f"{api_base}/api/v1/services", headers=headers, insecure=insecure).get("items", [])
    for service_id in DEMO_CONNECTOR_IDS:
        service = next((item for item in services if item.get("id") == service_id), None)
        if not service:
            continue
        meta = dict(service.get("meta") or {})
        if enable_demo:
            if service.get("base_url") and service.get("base_url") != DEMO_CONNECTOR_BASE_URL:
                meta["live_base_url"] = service["base_url"]
            meta["demo_mode"] = True
            meta["demo_base_url"] = DEMO_CONNECTOR_BASE_URL
            service["base_url"] = DEMO_CONNECTOR_BASE_URL
        else:
            service["base_url"] = meta.get("live_base_url") or DEFAULT_LIVE_BASE_URLS.get(service_id) or service.get("base_url")
            meta["demo_mode"] = False
        service["meta"] = meta
        _http_request("PUT", f"{api_base}/api/v1/services/{service_id}", headers=headers, payload=service, insecure=insecure)


def _prepare_mock_config(case: Dict[str, Any], defaults: Dict[str, Any]) -> Dict[str, Any]:
    config = deepcopy(defaults.get("mock", {}))
    for provider, provider_update in (case.get("mock") or {}).items():
        config[provider] = _deep_merge(config.get(provider, {}), provider_update)
    return config


def _apply_mock_config(mock_base: str, config: Dict[str, Any], *, insecure: bool) -> None:
    _http_request("POST", f"{mock_base}/api/v1/mock/reset", insecure=insecure)
    _http_request("PUT", f"{mock_base}/api/v1/mock/config", payload=config, insecure=insecure)


def _build_payload(case: Dict[str, Any], defaults: Dict[str, Any]) -> Dict[str, Any]:
    payload = deepcopy(defaults.get("api_payload", {}))
    return _deep_merge(payload, case.get("request") or {})


def _poll_request(api_base: str, gateway_api_key: str, request_id: str, *, insecure: bool, timeout_seconds: int, poll_interval: float) -> Dict[str, Any]:
    headers = {"X-Api-Key": gateway_api_key}
    deadline = time.time() + timeout_seconds
    last_response = {}
    while time.time() < deadline:
        last_response = _http_request("GET", f"{api_base}/api/v1/requests/{request_id}", headers=headers, insecure=insecure)
        status = str(last_response.get("status") or last_response.get("result", {}).get("status") or "").upper()
        if status in FINAL_STATUSES:
            return last_response
        time.sleep(poll_interval)
    return last_response


def _case_ids(cases: Iterable[Dict[str, Any]]) -> list[str]:
    return [case["id"] for case in cases]


def _print_case_result(case: Dict[str, Any], created: Dict[str, Any], final: Dict[str, Any]) -> None:
    expected = case.get("expected") or {}
    result = final.get("result") if isinstance(final.get("result"), dict) else {}
    final_status = final.get("status") or result.get("status") or created.get("result", {}).get("status")
    decision_reason = result.get("decision_reason") or result.get("summary", {}).get("decision_reason")
    print("=" * 88)
    print(f"{case['id']} :: {case['title']}")
    print(f"Description : {case.get('description', '-')}")
    print(f"Request ID   : {created.get('request_id')}")
    print(f"Selected mode: {created.get('selected_mode')}")
    print(f"Final status : {final_status}")
    if decision_reason:
        print(f"Decision     : {decision_reason}")
    print(f"Expected     : {expected}")
    print()


def main() -> int:
    parser = argparse.ArgumentParser(description="Run demo cases against mock-bureaus and Credit Platform.")
    parser.add_argument("--api-base", default="https://65.109.174.58", help="Base URL of platform API")
    parser.add_argument("--mock-base", help="Base URL of mock-bureaus service; defaults to <api-base>/mock-bureaus")
    parser.add_argument("--gateway-api-key", help="Gateway API key for POST/GET requests")
    parser.add_argument("--admin-api-key", help="Admin API key, required only for --enable-demo-connectors or --restore-live-connectors")
    parser.add_argument("--cases-file", default="scripts/demo-test-cases.json", help="Path to JSON case catalog")
    parser.add_argument("--case", dest="case_id", help="Run a single case by id")
    parser.add_argument("--list", action="store_true", help="List available cases and exit")
    parser.add_argument("--enable-demo-connectors", action="store_true", help="Switch platform connectors to built-in demo mock URLs before running")
    parser.add_argument("--restore-live-connectors", action="store_true", help="Restore saved live connector URLs and exit")
    parser.add_argument("--timeout-seconds", type=int, default=60, help="Polling timeout for request completion")
    parser.add_argument("--poll-interval", type=float, default=2.0, help="Polling interval in seconds")
    parser.add_argument("--insecure", action="store_true", help="Disable TLS certificate verification")
    args = parser.parse_args()

    cases_file = Path(args.cases_file)
    catalog = _load_cases(cases_file)
    defaults = catalog.get("defaults", {})
    cases = catalog.get("cases", [])
    api_base = _trim_base(args.api_base)
    mock_base = _trim_base(args.mock_base or f"{api_base}/mock-bureaus")

    if args.list:
        print("Available demo cases:")
        for case in cases:
            print(f"- {case['id']}: {case['title']}")
        return 0

    if args.restore_live_connectors:
        if not args.admin_api_key:
            raise SystemExit("--admin-api-key is required with --restore-live-connectors")
        _switch_demo_connectors(api_base, args.admin_api_key, insecure=args.insecure, enable_demo=False)
        print("Live connector URLs restored.")
        return 0

    if not args.gateway_api_key:
        raise SystemExit("--gateway-api-key is required unless --list or --restore-live-connectors is used")

    if args.enable_demo_connectors:
        if not args.admin_api_key:
            raise SystemExit("--admin-api-key is required with --enable-demo-connectors")
        _switch_demo_connectors(api_base, args.admin_api_key, insecure=args.insecure, enable_demo=True)
        print("Demo mock connectors enabled.")

    selected_cases = cases
    if args.case_id:
        selected_cases = [case for case in cases if case["id"] == args.case_id]
        if not selected_cases:
            raise SystemExit(f"Unknown case '{args.case_id}'. Available: {', '.join(_case_ids(cases))}")

    headers = {"X-Api-Key": args.gateway_api_key}
    for case in selected_cases:
        mock_config = _prepare_mock_config(case, defaults)
        _apply_mock_config(mock_base, mock_config, insecure=args.insecure)
        payload = _build_payload(case, defaults)
        created = _http_request("POST", f"{api_base}/api/v1/requests", headers=headers, payload=payload, insecure=args.insecure)
        request_id = created.get("request_id")
        if not request_id:
            raise RuntimeError(f"Case {case['id']} did not return request_id: {created}")
        final = _poll_request(
            api_base,
            args.gateway_api_key,
            request_id,
            insecure=args.insecure,
            timeout_seconds=args.timeout_seconds,
            poll_interval=args.poll_interval,
        )
        _print_case_result(case, created, final)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
