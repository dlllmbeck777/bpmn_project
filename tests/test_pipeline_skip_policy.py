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


sys.modules.setdefault(
    'httpx',
    SimpleNamespace(
        AsyncClient=_DummyAsyncClient,
        get=lambda *args, **kwargs: SimpleNamespace(status_code=503, json=lambda: {}),
    ),
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


sys.modules.setdefault('fastapi', SimpleNamespace(FastAPI=_DummyFastAPI, Request=object))
sys.modules.setdefault('fastapi.middleware', SimpleNamespace())
sys.modules.setdefault('fastapi.middleware.cors', SimpleNamespace(CORSMiddleware=object))
sys.modules.setdefault('pydantic', SimpleNamespace(BaseModel=_DummyBaseModel, Field=_dummy_field))

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


if __name__ == '__main__':
    unittest.main()
