import sys
from pathlib import Path
from types import SimpleNamespace
import unittest


PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "processors"))


class _DummyAsyncClient:
    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False


class _DummyFastAPI:
    def __init__(self, *args, **kwargs):
        pass

    def get(self, *args, **kwargs):
        return lambda func: func

    def post(self, *args, **kwargs):
        return lambda func: func


class _DummyBaseModel:
    pass


sys.modules.setdefault("httpx", SimpleNamespace(AsyncClient=_DummyAsyncClient))
sys.modules.setdefault("fastapi", SimpleNamespace(FastAPI=_DummyFastAPI))
sys.modules.setdefault("pydantic", SimpleNamespace(BaseModel=_DummyBaseModel))

import stop_factor  # noqa: E402


class InternalServiceAuthTests(unittest.TestCase):
    def test_stop_factor_internal_headers_empty_without_key(self):
        original = stop_factor.INTERNAL_API_KEY
        try:
            stop_factor.INTERNAL_API_KEY = ""
            self.assertEqual(stop_factor._internal_headers(), {})
        finally:
            stop_factor.INTERNAL_API_KEY = original

    def test_stop_factor_internal_headers_include_internal_key(self):
        original = stop_factor.INTERNAL_API_KEY
        try:
            stop_factor.INTERNAL_API_KEY = "internal-secret"
            self.assertEqual(
                stop_factor._internal_headers(),
                {"X-Internal-Api-Key": "internal-secret"},
            )
        finally:
            stop_factor.INTERNAL_API_KEY = original


if __name__ == "__main__":
    unittest.main()
