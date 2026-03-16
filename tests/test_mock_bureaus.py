import importlib.util
import sys
from pathlib import Path
from types import SimpleNamespace
import unittest


PROJECT_ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = PROJECT_ROOT / "connectors" / "mock-bureaus" / "app.py"


class _DummyFastAPI:
    def __init__(self, *args, **kwargs):
        pass

    def get(self, *args, **kwargs):
        return lambda func: func

    def put(self, *args, **kwargs):
        return lambda func: func

    def post(self, *args, **kwargs):
        return lambda func: func


class _DummyHTTPException(Exception):
    def __init__(self, status_code=500, detail="error"):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


class _DummyBaseModel:
    def __init__(self, **kwargs):
        annotations = getattr(self.__class__, "__annotations__", {})
        for key in annotations:
            default = getattr(self.__class__, key, None)
            if isinstance(default, dict):
                default = dict(default)
            setattr(self, key, kwargs.get(key, default))
        for key, value in kwargs.items():
            setattr(self, key, value)


sys.modules.setdefault("fastapi", SimpleNamespace(FastAPI=_DummyFastAPI, HTTPException=_DummyHTTPException))
sys.modules.setdefault("pydantic", SimpleNamespace(BaseModel=_DummyBaseModel))

spec = importlib.util.spec_from_file_location("mock_bureaus_app", MODULE_PATH)
mock_bureaus = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(mock_bureaus)

sys.modules.pop("fastapi", None)
sys.modules.pop("pydantic", None)


class MockBureausTests(unittest.TestCase):
    def setUp(self):
        mock_bureaus.reset_config()

    def test_isoftpull_reject_collections_case_exposes_collection_count(self):
        mock_bureaus.update_provider_config(
            "isoftpull",
            mock_bureaus.ProviderConfigUpdate(scenario="reject_collections_6"),
        )

        response = mock_bureaus._build_response("isoftpull", {"request_id": "REQ-1"})

        self.assertEqual(response["result"]["collectionCount"], 6)
        self.assertEqual(response["creditScore"], 720)

    def test_creditsafe_alert_case_exposes_alerts_and_derogatory_count(self):
        mock_bureaus.update_provider_config(
            "creditsafe",
            mock_bureaus.ProviderConfigUpdate(scenario="reject_alerts_2"),
        )

        response = mock_bureaus._build_response("creditsafe", {"request_id": "REQ-2"})

        self.assertEqual(response["result"]["complianceAlertCount"], 2)
        self.assertEqual(len(response["rawResponse"]["compliance"]["alerts"]), 2)
        self.assertEqual(response["rawResponse"]["bestMatch"]["company"]["derogatoryCount"], 2)

    def test_plaid_pending_case_returns_pending_link_shape(self):
        response = mock_bureaus._build_response("plaid", {"request_id": "REQ-3"})

        self.assertEqual(response["status"], "PENDING")
        self.assertEqual(response["intelligenceIndicator"], "PENDING_LINK")
        self.assertIn("trackingId", response["rawResponse"])
        self.assertEqual(response["result"]["accounts_found"], 0)

    def test_controls_override_numeric_values(self):
        updated = mock_bureaus.update_provider_config(
            "isoftpull",
            mock_bureaus.ProviderConfigUpdate(
                scenario="pass_775",
                controls={"creditScore": 540, "collectionCount": 8},
            ),
        )

        response = mock_bureaus._build_response("isoftpull", {"request_id": "REQ-4"})

        self.assertEqual(updated["controls"]["creditScore"], 540)
        self.assertEqual(response["creditScore"], 540)
        self.assertEqual(response["result"]["collectionCount"], 8)


if __name__ == "__main__":
    unittest.main()
