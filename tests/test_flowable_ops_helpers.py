import sys
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
import unittest


PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / 'core-api'))


class _DummyAsyncClient:
    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def request(self, *args, **kwargs):
        raise RuntimeError("httpx stub should not be called in flowable helper tests")

    async def post(self, *args, **kwargs):
        raise RuntimeError("httpx stub should not be called in flowable helper tests")


class _DummyHTTPException(Exception):
    def __init__(self, status_code, detail):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


class _DummyFastAPI:
    def __init__(self, *args, **kwargs):
        pass

    def get(self, *args, **kwargs):
        return lambda func: func

    def post(self, *args, **kwargs):
        return lambda func: func


sys.modules.setdefault(
    'httpx',
    SimpleNamespace(
        AsyncClient=_DummyAsyncClient,
    ),
)
sys.modules.setdefault('fastapi', SimpleNamespace(HTTPException=_DummyHTTPException, FastAPI=_DummyFastAPI))

from coreapi import services  # noqa: E402


class FlowableOpsHelperTests(unittest.TestCase):
    def test_authenticate_ui_login_prefers_db_user_session(self):
        original_lookup = services._admin_user_by_username
        original_verify = services.verify_password
        original_execute = services.execute
        original_issue = services._issue_session_token
        try:
            services._admin_user_by_username = lambda username, enabled_only=False: {
                "username": "admin",
                "role": "admin",
                "enabled": True,
                "password_hash": "stored",
            }
            services.verify_password = lambda password, stored_hash: password == "secret-123"
            services.execute = lambda *args, **kwargs: None
            services._issue_session_token = lambda: "session-token-1"
            result = services.authenticate_ui_login("admin", "secret-123")
            self.assertEqual(result["api_key"], "session-token-1")
            self.assertEqual(result["role"], "admin")
        finally:
            services._admin_user_by_username = original_lookup
            services.verify_password = original_verify
            services.execute = original_execute
            services._issue_session_token = original_issue

    def test_authenticate_ui_login_blocks_disabled_db_user(self):
        original_lookup = services._admin_user_by_username
        try:
            services._admin_user_by_username = lambda username, enabled_only=False: {
                "username": "analyst",
                "role": "analyst",
                "enabled": False,
                "password_hash": "stored",
            }
            with self.assertRaises(Exception) as ctx:
                services.authenticate_ui_login("analyst", "anything")
            self.assertEqual(getattr(ctx.exception, "status_code", None), 403)
        finally:
            services._admin_user_by_username = original_lookup

    def test_hash_password_roundtrip(self):
        hashed = services.hash_password("secret-123")
        self.assertTrue(services.verify_password("secret-123", hashed))
        self.assertFalse(services.verify_password("wrong", hashed))

    def test_normalize_username_trims_and_lowercases(self):
        self.assertEqual(services.normalize_username(" Admin.User "), "admin.user")

    def test_extract_flowable_instance_id_from_normalized_result(self):
        result = {"engine": {"instance_id": "proc-123"}}
        self.assertEqual(services.extract_flowable_instance_id(result), "proc-123")

    def test_normalize_flowable_variables_parses_json_values(self):
        variables = [
            {"name": "request_id", "value": "REQ-42"},
            {"name": "isoRawBody", "value": '{"status":"OK","score":712}'},
        ]
        normalized = services.normalize_flowable_variables(variables)
        self.assertEqual(normalized["request_id"], "REQ-42")
        self.assertEqual(normalized["isoRawBody"]["score"], 712)

    def test_build_flowable_steps_includes_skip_reason(self):
        variables = {
            "iso_status": "SKIPPED",
            "skip_reason_isoftpull": "pipeline step bypassed for flowable mode",
        }
        steps = services.build_flowable_steps(variables)
        self.assertEqual(steps["isoftpull"]["status"], "SKIPPED")
        self.assertEqual(steps["isoftpull"]["reason"], "pipeline step bypassed for flowable mode")

    def test_flowable_auth_candidates_prefer_configured_password_and_keep_test_fallback(self):
        original_password = services.FLOWABLE_PASSWORD
        original_fallbacks = services.FLOWABLE_PASSWORD_FALLBACKS
        original_user = services.FLOWABLE_USER
        try:
            services.FLOWABLE_USER = "admin"
            services.FLOWABLE_PASSWORD = "secret-1"
            services.FLOWABLE_PASSWORD_FALLBACKS = ["test", "secret-1", "legacy-pass"]
            self.assertEqual(
                services._flowable_auth_candidates(),
                [("admin", "secret-1"), ("admin", "test"), ("admin", "legacy-pass")],
            )
        finally:
            services.FLOWABLE_USER = original_user
            services.FLOWABLE_PASSWORD = original_password
            services.FLOWABLE_PASSWORD_FALLBACKS = original_fallbacks

    def test_flowable_engine_status_marks_finalized_runtime_as_orphaned(self):
        runtime = {"id": "proc-1", "activityId": "task_init"}
        self.assertEqual(services._flowable_engine_status(runtime, None, "COMPLETED"), "ORPHANED")
        self.assertEqual(services._flowable_engine_status(runtime, None, "ENGINE_ERROR"), "ORPHANED")
        self.assertEqual(services._flowable_engine_status(runtime, None, "RUNNING"), "RUNNING")

    def test_classify_request_error_marks_engine_error_as_technical(self):
        row = {"status": "ENGINE_ERROR", "ignored": False, "result": {"status": "ENGINE_ERROR"}}
        self.assertEqual(services.classify_request_error(row), "technical")
        self.assertTrue(services.request_needs_operator_action(row))

    def test_classify_request_error_marks_connector_failed_as_integration(self):
        row = {
            "status": "FAILED",
            "ignored": False,
            "result": {
                "status": "FAILED",
                "steps": {
                    "creditsafe": {"status": "UNAVAILABLE"},
                },
            },
        }
        self.assertEqual(services.classify_request_error(row), "integration")
        self.assertTrue(services.request_needs_operator_action(row))

    def test_resolve_request_decision_reason_does_not_mask_engine_error_with_post_check_pass(self):
        reason = services._resolve_request_decision_reason(
            {"status": "ENGINE_ERROR"},
            {"reason": "all checks passed", "decision": "PASS"},
            "ENGINE_ERROR",
        )
        self.assertEqual(reason, "Orchestration engine returned an error")

    def test_resolve_request_decision_reason_uses_post_check_reason_for_business_outcome(self):
        reason = services._resolve_request_decision_reason(
            {"status": "COMPLETED"},
            {"reason": "all checks passed", "decision": "PASS"},
            "COMPLETED",
        )
        self.assertEqual(reason, "all checks passed")

    def test_build_request_view_respects_ignored_flag_for_needs_action(self):
        original_credit_backend_service = services._credit_backend_service
        row = {
            "request_id": "REQ-1",
            "status": "ENGINE_UNREACHABLE",
            "ignored": True,
            "applicant_profile": {},
            "result": {"status": "ENGINE_UNREACHABLE"},
        }
        try:
            services._credit_backend_service = lambda: {"base_url": "http://mock-bureaus:8110"}
            view = services.build_request_view(row)
            self.assertEqual(view["error_class"], "technical")
            self.assertFalse(view["needs_operator_action"])
            self.assertTrue(view["ops"]["can_restore"])
        finally:
            services._credit_backend_service = original_credit_backend_service

    def test_flowable_operator_hint_explains_running_activity(self):
        summary = {
            "engine_status": "RUNNING",
            "current_activity": "task_parse_plaid",
            "failed_jobs": 0,
            "request_status": "RUNNING",
        }
        self.assertIn("task_parse_plaid", services._flowable_operator_hint(summary))

    def test_build_flowable_result_from_variables_adds_engine_and_steps(self):
        variables = {
            "request_id": "REQ-55",
            "route_mode": "FLOWABLE",
            "isoRawBody": {"status": "OK", "bureau": "isoftpull"},
            "iso_status": "OK",
            "creditsafe_status": "SKIPPED",
            "skip_reason_creditsafe": "pipeline step bypassed for flowable mode",
            "orchestration_result": {"status": "REJECTED", "decision_reason": "Decision rule failed: Min credit score 580", "summary": {"request_id": "REQ-55"}},
        }
        result = services.build_flowable_result_from_variables("REQ-55", "instance-55", variables)
        self.assertEqual(result["status"], "REJECTED")
        self.assertEqual(result["engine"]["instance_id"], "instance-55")
        self.assertEqual(result["steps"]["isoftpull"]["bureau"], "isoftpull")
        self.assertEqual(result["steps"]["creditsafe"]["status"], "SKIPPED")
        self.assertNotIn("crm", result["steps"])
        self.assertEqual(result["summary"]["request_id"], "REQ-55")

    def test_build_flowable_result_from_variables_falls_back_to_decision_raw_body(self):
        variables = {
            "request_id": "REQ-56",
            "route_mode": "FLOWABLE",
            "decisionRawBody": {
                "status": "COMPLETED",
                "decision": "APPROVED",
                "decision_reason": "Decision rules passed",
                "decision_source": "decision-service",
                "matched_rule": None,
                "request_context": {
                    "request_id": "REQ-56",
                    "route_mode": "FLOWABLE",
                    "external_applicant_id": "57",
                },
                "steps": {
                    "isoftpull": {
                        "status": "OK",
                        "creditScore": 775,
                    },
                },
                "external_reports": {
                    "isoftpull": {
                        "status": "OK",
                        "creditScore": 775,
                    },
                },
                "step_statuses": {
                    "isoftpull": "OK",
                },
                "parsed_report": {
                    "status": "OK",
                    "summary": {
                        "credit_score": 775,
                        "collection_count": 0,
                    },
                },
                "summary": {
                    "credit_score": 775,
                    "collection_count": 0,
                    "decision_reason": "Decision rules passed",
                },
            },
        }
        result = services.build_flowable_result_from_variables("REQ-56", "instance-56", variables)
        self.assertEqual(result["status"], "COMPLETED")
        self.assertEqual(result["decision"], "APPROVED")
        self.assertEqual(result["decision_reason"], "Decision rules passed")
        self.assertEqual(result["decision_source"], "decision-service")
        self.assertEqual(result["summary"]["credit_score"], 775)
        self.assertEqual(result["parsed_report"]["status"], "OK")
        self.assertEqual(result["external_reports"]["isoftpull"]["creditScore"], 775)
        self.assertEqual(result["request_context"]["external_applicant_id"], "57")
        self.assertEqual(result["step_statuses"]["isoftpull"], "OK")

    def test_build_flowable_result_from_variables_assigns_pass_to_custom_when_decision_missing(self):
        variables = {
            "request_id": "REQ-57",
            "route_mode": "FLOWABLE",
            "iso_status": "OK",
            "creditsafe_status": "OK",
            "plaid_status": "OK",
        }
        result = services.build_flowable_result_from_variables("REQ-57", "instance-57", variables)
        self.assertEqual(result["status"], "COMPLETED")
        self.assertEqual(result["decision"], "PASS TO CUSTOM")
        self.assertEqual(result["decision_source"], "flowable-fallback")
        self.assertEqual(result["decision_reason"], "Flowable completed without a decision result")

    def test_resolve_orchestrator_call_settings_disables_flowable_retries(self):
        settings = services.resolve_orchestrator_call_settings(
            "flowable-adapter",
            {"timeout_ms": 10000, "retry_count": 2},
        )
        self.assertEqual(settings["max_retries"], 0)
        self.assertGreaterEqual(settings["timeout"], 45.0)

    def test_resolve_orchestrator_call_settings_keeps_custom_retries(self):
        settings = services.resolve_orchestrator_call_settings(
            "custom-adapter",
            {"timeout_ms": 12000, "retry_count": 2},
        )
        self.assertEqual(settings["max_retries"], 2)
        self.assertEqual(settings["timeout"], 12.0)

    def test_resolve_mode_supports_deterministic_canary_rules(self):
        original_query = services.query
        try:
            services.query = lambda *args, **kwargs: [
                {
                    "name": "5% Flowable Canary",
                    "condition_field": "orchestration_mode",
                    "condition_op": "eq",
                    "condition_value": "auto",
                    "target_mode": "flowable",
                    "meta": {"sample_percent": 5, "sticky_field": "request_id"},
                },
                {
                    "name": "Fallback Custom",
                    "condition_field": "orchestration_mode",
                    "condition_op": "eq",
                    "condition_value": "auto",
                    "target_mode": "custom",
                    "meta": {},
                },
            ]
            flowable_request = {"request_id": "REQ-56", "customer_id": "CUST-001", "orchestration_mode": "auto"}
            custom_request = {"request_id": "REQ-1", "customer_id": "CUST-001", "orchestration_mode": "auto"}
            self.assertEqual(services.resolve_mode(flowable_request), "flowable")
            self.assertEqual(services.resolve_mode(custom_request), "custom")
        finally:
            services.query = original_query

    def test_rule_canary_uses_fallback_identity_when_sticky_field_missing(self):
        rule = {"meta": {"sample_percent": 100, "sticky_field": "payload.customer_segment"}}
        self.assertTrue(services._rule_canary_matches(rule, {"request_id": "REQ-1"}))

    def test_rule_daily_quota_disabled_by_default(self):
        self.assertTrue(services._rule_daily_quota_matches({"target_mode": "flowable", "meta": {}}))

    def test_rule_daily_quota_respects_daily_limit(self):
        original_query = services.query
        try:
            services.query = lambda *args, **kwargs: 3
            self.assertFalse(services._rule_daily_quota_matches({
                "target_mode": "flowable",
                "meta": {"daily_quota_enabled": True, "daily_quota_max": 3},
            }))
            self.assertTrue(services._rule_daily_quota_matches({
                "target_mode": "flowable",
                "meta": {"daily_quota_enabled": True, "daily_quota_max": 4},
            }))
        finally:
            services.query = original_query

    def test_resolve_mode_falls_back_when_canary_quota_is_reached(self):
        original_query = services.query
        try:
            def fake_query(sql, params=None, fetch=None):
                if "SELECT COUNT(*) FROM requests" in sql:
                    return 2
                return [
                    {
                        "name": "Auto -> Flowable canary",
                        "condition_field": "orchestration_mode",
                        "condition_op": "eq",
                        "condition_value": "auto",
                        "target_mode": "flowable",
                        "meta": {
                            "sample_percent": 100,
                            "sticky_field": "request_id",
                            "daily_quota_enabled": True,
                            "daily_quota_max": 2,
                        },
                    },
                    {
                        "name": "Auto -> Custom default",
                        "condition_field": "orchestration_mode",
                        "condition_op": "eq",
                        "condition_value": "auto",
                        "target_mode": "custom",
                        "meta": {},
                    },
                ]

            services.query = fake_query
            self.assertEqual(services.resolve_mode({
                "request_id": "REQ-77",
                "customer_id": "CUST-001",
                "orchestration_mode": "auto",
            }), "custom")
        finally:
            services.query = original_query

    def test_build_requests_list_query_supports_status_and_time_filters(self):
        created_from = datetime(2026, 3, 16, 8, 0, tzinfo=timezone.utc)
        created_to = datetime(2026, 3, 16, 10, 0, tzinfo=timezone.utc)
        sql, params = services.build_requests_list_query(50, status="FAILED", created_from=created_from, created_to=created_to)
        self.assertIn("status=%s", sql)
        self.assertIn("created_at >= %s", sql)
        self.assertIn("created_at <= %s", sql)
        self.assertEqual(params, ["FAILED", created_from, created_to, 50])


if __name__ == '__main__':
    unittest.main()
