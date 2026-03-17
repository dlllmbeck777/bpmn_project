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

    def delete(self, *args, **kwargs):
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

    def test_applicant_crud_roundtrip(self):
        created = mock_bureaus.create_applicant(
            mock_bureaus.ApplicantIn(
                firstName="John",
                lastName="Doe",
                address="123 Main Street",
                city="New York",
                state="NY",
                zipCode="10001",
                ssn="123456789",
                dateOfBirth="1985-06-15",
                email="john@example.com",
                phone="555-123-4567",
            )
        )

        self.assertEqual(created["id"], 42)
        self.assertEqual(created["firstName"], "John")

        fetched = mock_bureaus.get_applicant(42)
        self.assertEqual(fetched["lastName"], "Doe")

        updated = mock_bureaus.update_applicant(
            42,
            mock_bureaus.ApplicantUpdateIn(
                lastName="Smith",
                city="Los Angeles",
                state="CA",
                zipCode="90001",
            ),
        )
        self.assertEqual(updated["lastName"], "Smith")
        self.assertEqual(updated["city"], "Los Angeles")

        items = mock_bureaus.list_applicants()
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["id"], 42)

        deleted = mock_bureaus.delete_applicant(42)
        self.assertEqual(deleted["status"], "deleted")
        self.assertEqual(mock_bureaus.list_applicants(), [])

    def test_run_all_credit_checks_stores_reports_for_applicant(self):
        created = mock_bureaus.create_applicant(
            mock_bureaus.ApplicantIn(
                firstName="John",
                lastName="Doe",
                address="123 Main Street",
                city="New York",
                state="NY",
                zipCode="10001",
            )
        )

        reports = mock_bureaus.run_all_credit_checks(created["id"])
        stored = mock_bureaus.get_credit_reports(created["id"])

        self.assertEqual(len(reports), 3)
        self.assertEqual(len(stored), 3)
        self.assertEqual({item["providerCode"] for item in stored}, {"ISOFTPULL", "CREDITSAFE", "PLAID"})

    def test_plaid_pending_link_can_be_clicked_and_completed(self):
        mock_bureaus.update_provider_config(
            "plaid",
            mock_bureaus.ProviderConfigUpdate(scenario="pending_link"),
        )
        created = mock_bureaus.create_applicant(
            mock_bureaus.ApplicantIn(
                firstName="John",
                lastName="Doe",
                address="123 Main Street",
                city="New York",
                state="NY",
                zipCode="10001",
            )
        )

        report = mock_bureaus.run_plaid_check(created["id"])
        tracking_id = report["rawResponse"]["trackingId"]

        initial = mock_bureaus.plaid_tracking_status(tracking_id)
        clicked = mock_bureaus.plaid_tracking(tracking_id)
        completed = mock_bureaus.complete_plaid_link(
            tracking_id,
            mock_bureaus.PlaidLinkActionIn(accountsFound=4, cashflowStability="GOOD"),
        )
        stored = mock_bureaus.get_credit_reports(created["id"])
        latest = next(item for item in stored if item["providerCode"] == "PLAID")

        self.assertEqual(initial["status"], "CREATED")
        self.assertEqual(clicked["status"], "CLICKED")
        self.assertTrue(clicked["clicked"])
        self.assertEqual(completed["status"], "REPORT_READY")
        self.assertTrue(completed["reportReady"])
        self.assertEqual(latest["status"], "COMPLETED")
        self.assertEqual(latest["result"]["accounts_found"], 4)


if __name__ == "__main__":
    unittest.main()
