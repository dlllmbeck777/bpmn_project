import asyncio
import sys
from pathlib import Path
from types import SimpleNamespace
import unittest


PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / 'orchestrators'))


class _DummyAsyncClient:
    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def get(self, *args, **kwargs):
        raise RuntimeError("httpx stub should not be used in skip policy tests")

    async def post(self, *args, **kwargs):
        raise RuntimeError("httpx stub should not be used in skip policy tests")


sys.modules['httpx'] = SimpleNamespace(
    AsyncClient=_DummyAsyncClient,
    get=lambda *args, **kwargs: SimpleNamespace(status_code=503, json=lambda: {}),
)


class _DummyFastAPI:
    def __init__(self, *args, **kwargs):
        pass

    def add_middleware(self, *args, **kwargs):
        return None

    def get(self, *args, **kwargs):
        def decorator(func):
            return func
        return decorator

    def post(self, *args, **kwargs):
        def decorator(func):
            return func
        return decorator

    def on_event(self, *args, **kwargs):
        def decorator(func):
            return func
        return decorator


class _DummyHTTPException(Exception):
    def __init__(self, status_code, detail):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


class _DummyBaseModel:
    def __init__(self, **kwargs):
        for key, value in kwargs.items():
            setattr(self, key, value)

    def model_dump(self):
        return dict(self.__dict__)


def _dummy_field(default=None, **kwargs):
    if "default_factory" in kwargs:
        return kwargs["default_factory"]()
    return default


sys.modules['fastapi'] = SimpleNamespace(FastAPI=_DummyFastAPI, Request=object, HTTPException=_DummyHTTPException)
sys.modules['fastapi.middleware'] = SimpleNamespace()
sys.modules['fastapi.middleware.cors'] = SimpleNamespace(CORSMiddleware=object)
sys.modules['pydantic'] = SimpleNamespace(BaseModel=_DummyBaseModel, Field=_dummy_field)

import custom_adapter  # noqa: E402
import flowable_adapter  # noqa: E402


class PipelineSkipPolicyTests(unittest.TestCase):
    def test_custom_mode_respects_mode_specific_skip_flag(self):
        step = {"enabled": True, "meta": {"skip_in_custom": True, "skip_in_flowable": False}}
        policy = custom_adapter._resolve_skip_policy(step, "custom")
        self.assertTrue(policy["skip"])
        self.assertEqual(policy["source"], "skip_in_custom")

    def test_custom_mode_ignores_flowable_only_skip_flag(self):
        step = {"enabled": True, "meta": {"skip_in_custom": False, "skip_in_flowable": True}}
        policy = custom_adapter._resolve_skip_policy(step, "custom")
        self.assertFalse(policy["skip"])

    def test_custom_adapter_does_not_load_decision_service(self):
        original_acfg = custom_adapter._acfg
        try:
            seen_paths = []

            async def fake_acfg(path, ttl=30):
                seen_paths.append(path)
                if path == "/api/v1/pipeline-steps?pipeline_name=default":
                    return {"items": []}
                if path == "/api/v1/services/report-parser":
                    return {}
                if path == "/api/v1/services/decision-service":
                    raise AssertionError("custom adapter should not query decision-service")
                return {}

            custom_adapter._acfg = fake_acfg
            body = custom_adapter.RequestIn(
                request_id="REQ-CUSTOM-1",
                customer_id="CUST-1",
                iin="IIN-1",
                product_type="loan",
                orchestration_mode="custom",
            )
            result = asyncio.run(custom_adapter.orchestrate(body, SimpleNamespace(headers={})))
            self.assertEqual(result["status"], "COMPLETED")
            self.assertEqual(result["adapter"], "custom")
            self.assertNotIn("decision_reason", result)
            self.assertNotIn("/api/v1/services/decision-service", seen_paths)
        finally:
            custom_adapter._acfg = original_acfg

    def test_flowable_mode_marks_missing_step_as_skipped(self):
        policy = flowable_adapter._resolve_skip_policy(None, "flowable")
        self.assertTrue(policy["skip"])
        self.assertEqual(policy["source"], "missing")

    def test_flowable_mode_keeps_step_when_only_custom_skip_is_set(self):
        step = {"enabled": True, "meta": {"skip_in_custom": True, "skip_in_flowable": False}}
        policy = flowable_adapter._resolve_skip_policy(step, "flowable")
        self.assertFalse(policy["skip"])

    def test_disabled_step_overrides_mode_specific_policy(self):
        step = {"enabled": False, "meta": {"skip_in_custom": False, "skip_in_flowable": False}}
        policy = flowable_adapter._resolve_skip_policy(step, "flowable")
        self.assertTrue(policy["skip"])
        self.assertEqual(policy["reason"], "pipeline step disabled")

    def test_flowable_skip_flags_mark_disabled_service_when_connector_url_missing(self):
        original_acfg = flowable_adapter._acfg
        try:
            async def fake_acfg(path, ttl=30):
                if path == "/api/v1/pipeline-steps?pipeline_name=default":
                    return {"items": [{"service_id": "isoftpull", "enabled": True, "meta": {}}]}
                return {}

            flowable_adapter._acfg = fake_acfg
            steps, flags, reasons, policies = asyncio.run(flowable_adapter._pipeline_skip_flags({}))
            self.assertEqual(len(steps), 1)
            self.assertTrue(flags["isoftpull"])
            self.assertEqual(reasons["isoftpull"], "service disabled or connector url unavailable")
            self.assertEqual(policies["isoftpull"]["source"], "service")
        finally:
            flowable_adapter._acfg = original_acfg

    def test_build_watch_timeout_result_marks_running_instance_as_engine_error(self):
        result = flowable_adapter._build_watch_timeout_result(
            "REQ-1",
            "inst-1",
            {
                "runtime": {"id": "inst-1"},
                "current_activity": "task_init",
                "failed_jobs": 0,
                "job_count": 1,
            },
        )
        self.assertEqual(result["status"], "ENGINE_ERROR")
        self.assertTrue(result["engine"]["timed_out"])
        self.assertEqual(result["engine"]["current_activity"], "task_init")
        self.assertIn("task_init", result["decision_reason"])

    def test_build_watch_timeout_result_mentions_failed_jobs(self):
        result = flowable_adapter._build_watch_timeout_result(
            "REQ-2",
            "inst-2",
            {
                "runtime": {"id": "inst-2"},
                "current_activity": "task_plaid",
                "failed_jobs": 2,
                "job_count": 2,
            },
        )
        self.assertEqual(result["status"], "ENGINE_ERROR")
        self.assertIn("failed job", result["decision_reason"].lower())
        self.assertEqual(result["summary"]["failed_jobs"], 2)

    def test_flowable_start_context_includes_decision_service_url(self):
        body = flowable_adapter.RequestIn(
            request_id="REQ-FLOW-1",
            customer_id="CUST-1",
            iin="IIN-1",
            external_applicant_id="APP-1",
            product_type="loan",
            orchestration_mode="flowable",
            applicant={"firstName": "John"},
        )
        variables, tracker_payload = flowable_adapter._build_flowable_start_context(
            body,
            process_key="creditServiceChainOrchestration",
            flowable_url="http://flowable-rest:8080/flowable-rest/service",
            flowable_connector_urls={"isoftpull": "http://isoftpull:8101/api/pull"},
            decision_service_url="http://processors:8107/api/v1/decide",
            pipeline_steps=[{"service_id": "isoftpull"}],
            skip_flags={"isoftpull": False, "creditsafe": False, "plaid": True},
            skip_reasons={"isoftpull": "", "creditsafe": "", "plaid": "pipeline step bypassed for flowable mode"},
            skip_policies={"plaid": {"skip": True, "reason": "pipeline step bypassed for flowable mode", "source": "skip_in_flowable"}},
        )
        variables_by_name = {item["name"]: item["value"] for item in variables}
        self.assertEqual(variables_by_name["decision_service_url"], "http://processors:8107/api/v1/decide")
        self.assertEqual(tracker_payload["decision_service_url"], "http://processors:8107/api/v1/decide")
        self.assertEqual(variables_by_name["external_applicant_id"], "APP-1")
        self.assertEqual(variables_by_name["applicant_json"], '{"firstName": "John"}')


if __name__ == '__main__':
    unittest.main()
