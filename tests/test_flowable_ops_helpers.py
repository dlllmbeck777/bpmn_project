import sys
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


sys.modules.setdefault(
    'httpx',
    SimpleNamespace(
        AsyncClient=_DummyAsyncClient,
    ),
)
sys.modules.setdefault('fastapi', SimpleNamespace(HTTPException=_DummyHTTPException))

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
            with self.assertRaises(_DummyHTTPException) as ctx:
                services.authenticate_ui_login("analyst", "anything")
            self.assertEqual(ctx.exception.status_code, 403)
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

    def test_build_flowable_result_from_variables_adds_engine_and_steps(self):
        variables = {
            "request_id": "REQ-55",
            "route_mode": "FLOWABLE",
            "isoRawBody": {"status": "OK", "bureau": "isoftpull"},
            "iso_status": "OK",
            "creditsafe_status": "SKIPPED",
            "skip_reason_creditsafe": "pipeline step bypassed for flowable mode",
        }
        result = services.build_flowable_result_from_variables("REQ-55", "instance-55", variables)
        self.assertEqual(result["engine"]["instance_id"], "instance-55")
        self.assertEqual(result["steps"]["isoftpull"]["bureau"], "isoftpull")
        self.assertEqual(result["steps"]["creditsafe"]["status"], "SKIPPED")
        self.assertEqual(result["summary"]["request_id"], "REQ-55")


if __name__ == '__main__':
    unittest.main()
