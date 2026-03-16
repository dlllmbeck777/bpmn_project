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
        raise RuntimeError("httpx stub should not be called in applicant contract tests")

    async def post(self, *args, **kwargs):
        raise RuntimeError("httpx stub should not be called in applicant contract tests")


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
sys.modules.setdefault(
    'fastapi',
    SimpleNamespace(
        HTTPException=_DummyHTTPException,
        FastAPI=lambda *args, **kwargs: None,
    ),
)

from coreapi import services  # noqa: E402
from coreapi.storage import tracker_payload  # noqa: E402


class ApplicantInputContractTests(unittest.TestCase):
    def setUp(self):
        self._orig_encrypt_sensitive = services.encrypt_sensitive
        self._orig_encrypt_field = services.encrypt_field
        self._orig_decrypt_sensitive = services.decrypt_sensitive
        self._orig_decrypt_field = services.decrypt_field
        self._orig_mask_field = services.mask_field

        def fake_encrypt_field(value):
            return f"ENC::{value}" if value else value

        def fake_decrypt_field(value):
            if isinstance(value, str) and value.startswith("ENC::"):
                return value.split("::", 1)[1]
            return value

        def fake_encrypt_sensitive(data):
            return {key: fake_encrypt_field(value) for key, value in (data or {}).items()}

        def fake_decrypt_sensitive(data):
            return {key: fake_decrypt_field(value) for key, value in (data or {}).items()}

        def fake_mask_field(value):
            plain = fake_decrypt_field(value) or ""
            return f"***{plain[-4:]}" if len(plain) > 4 else "***"

        services.encrypt_sensitive = fake_encrypt_sensitive
        services.encrypt_field = fake_encrypt_field
        services.decrypt_sensitive = fake_decrypt_sensitive
        services.decrypt_field = fake_decrypt_field
        services.mask_field = fake_mask_field

    def tearDown(self):
        services.encrypt_sensitive = self._orig_encrypt_sensitive
        services.encrypt_field = self._orig_encrypt_field
        services.decrypt_sensitive = self._orig_decrypt_sensitive
        services.decrypt_field = self._orig_decrypt_field
        services.mask_field = self._orig_mask_field

    def test_normalize_incoming_request_generates_internal_context(self):
        normalized = services.normalize_incoming_request({
            "firstName": "John",
            "lastName": "Doe",
            "address": "123 Main Street",
            "city": "New York",
            "state": "NY",
            "zipCode": "10001",
            "ssn": "123456789",
            "dateOfBirth": "1985-06-15",
            "email": "john@example.com",
            "phone": "555-123-4567",
        })

        internal = normalized["internal"]
        self.assertTrue(normalized["request_id"].startswith("REQ-"))
        self.assertTrue(normalized["customer_id"].startswith("CUST-"))
        self.assertEqual(internal["iin"], "123456789")
        self.assertEqual(internal["ssn"], "123456789")
        self.assertEqual(internal["product_type"], services.DEFAULT_PRODUCT_TYPE)
        self.assertEqual(internal["orchestration_mode"], services.DEFAULT_ORCHESTRATION_MODE)
        self.assertEqual(internal["applicant"]["email"], "john@example.com")
        self.assertEqual(internal["payload"]["applicant"]["firstName"], "John")
        self.assertTrue(normalized["ssn_encrypted"].startswith("ENC"))

    def test_normalize_incoming_request_keeps_legacy_contract_working(self):
        normalized = services.normalize_incoming_request({
            "request_id": "REQ-LEGACY-1",
            "customer_id": "CUST-1",
            "iin": "999888777",
            "product_type": "loan",
            "orchestration_mode": "custom",
            "payload": {},
        })
        self.assertEqual(normalized["request_id"], "REQ-LEGACY-1")
        self.assertEqual(normalized["internal"]["iin"], "999888777")
        self.assertEqual(normalized["internal"]["customer_id"], "CUST-1")
        self.assertEqual(normalized["internal"]["orchestration_mode"], "custom")

    def test_build_request_view_exposes_applicant_summary_and_masks_sensitive_values(self):
        normalized = services.normalize_incoming_request({
            "firstName": "John",
            "lastName": "Doe",
            "address": "123 Main Street",
            "city": "New York",
            "state": "NY",
            "zipCode": "10001",
            "ssn": "123456789",
            "dateOfBirth": "1985-06-15",
            "email": "john@example.com",
            "phone": "555-123-4567",
        })
        view = services.build_request_view({
            "request_id": normalized["request_id"],
            "customer_id": normalized["customer_id"],
            "ssn_encrypted": normalized["ssn_encrypted"],
            "iin_encrypted": normalized["ssn_encrypted"],
            "product_type": normalized["product_type"],
            "orchestration_mode": normalized["orchestration_mode"],
            "applicant_profile": normalized["applicant_profile_encrypted"],
        })

        self.assertEqual(view["applicant_name"], "John Doe")
        self.assertEqual(view["applicant_location"], "New York, NY")
        self.assertEqual(view["ssn_masked"], "***6789")
        self.assertEqual(view["applicant_profile"]["email"], "j***@example.com")
        self.assertEqual(view["applicant_profile"]["phone"], "***4567")
        self.assertEqual(view["applicant_profile"]["address"], "123 Main Street")

    def test_tracker_payload_masks_applicant_pii(self):
        masked = tracker_payload({
            "request_id": "REQ-1",
            "applicant": {
                "firstName": "John",
                "lastName": "Doe",
                "ssn": "123456789",
                "email": "john@example.com",
                "phone": "555-123-4567",
            },
        })
        self.assertEqual(masked["applicant"]["ssn"], "***6789")
        self.assertEqual(masked["applicant"]["email"], "***.com")
        self.assertEqual(masked["applicant"]["phone"], "***4567")


if __name__ == '__main__':
    unittest.main()
