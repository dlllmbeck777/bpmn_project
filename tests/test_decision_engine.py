import asyncio
import sys
from pathlib import Path
from types import SimpleNamespace
import unittest


PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "processors"))


class _DummyFastAPI:
    def __init__(self, *args, **kwargs):
        pass

    def get(self, *args, **kwargs):
        return lambda func: func

    def post(self, *args, **kwargs):
        return lambda func: func


class _DummyBaseModel:
    def __init__(self, **kwargs):
        for key, value in kwargs.items():
            setattr(self, key, value)


class _DummyAsyncClient:
    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def get(self, *args, **kwargs):
        raise RuntimeError("httpx stub should not be used directly in decision tests")


sys.modules.setdefault("fastapi", SimpleNamespace(FastAPI=_DummyFastAPI))
sys.modules.setdefault("pydantic", SimpleNamespace(BaseModel=_DummyBaseModel))
sys.modules.setdefault("httpx", SimpleNamespace(AsyncClient=_DummyAsyncClient))

import decision_engine  # noqa: E402

sys.modules.pop("fastapi", None)
sys.modules.pop("pydantic", None)
sys.modules.pop("httpx", None)


class DecisionEngineTests(unittest.TestCase):
    def test_decision_rejects_when_credit_score_rule_fails(self):
        original_fetch_rules = decision_engine._fetch_rules
        try:
            async def fake_fetch_rules():
                return [
                    {
                        "id": 1,
                        "name": "Min credit score 580",
                        "enabled": True,
                        "priority": 10,
                        "field_path": "result.parsed_report.summary.credit_score",
                        "operator": "gte",
                        "threshold": "580",
                        "action_on_fail": "REJECT",
                    }
                ]

            decision_engine._fetch_rules = fake_fetch_rules
            response = asyncio.run(
                decision_engine.decide(
                    decision_engine.DecideRequest(
                        request_id="REQ-1",
                        route_mode="FLOWABLE",
                        external_applicant_id="EXT-1",
                        steps={
                            "isoftpull": {"creditScore": 550},
                            "creditsafe": {"creditScore": 72},
                        },
                    )
                )
            )
            self.assertEqual(response["status"], "REJECTED")
            self.assertEqual(response["matched_rule"]["name"], "Min credit score 580")
            self.assertEqual(response["external_reports"]["isoftpull"]["creditScore"], 550)
            self.assertEqual(response["request_context"]["external_applicant_id"], "EXT-1")
        finally:
            decision_engine._fetch_rules = original_fetch_rules

    def test_decision_rules_can_target_raw_external_reports(self):
        original_fetch_rules = decision_engine._fetch_rules
        try:
            async def fake_fetch_rules():
                return [
                    {
                        "id": 2,
                        "name": "Reject when iSoftPull score below 600",
                        "enabled": True,
                        "priority": 10,
                        "field_path": "result.steps.isoftpull.creditScore",
                        "operator": "gte",
                        "threshold": "600",
                        "action_on_fail": "REJECT",
                    }
                ]

            decision_engine._fetch_rules = fake_fetch_rules
            response = asyncio.run(
                decision_engine.decide(
                    decision_engine.DecideRequest(
                        request_id="REQ-RAW-1",
                        steps={
                            "isoftpull": {"status": "OK", "creditScore": 590},
                            "creditsafe": {"status": "OK", "creditScore": 72},
                        },
                    )
                )
            )
            self.assertEqual(response["status"], "REJECTED")
            self.assertEqual(response["matched_rule"]["name"], "Reject when iSoftPull score below 600")
        finally:
            decision_engine._fetch_rules = original_fetch_rules

    def test_decision_reviews_when_required_reports_are_unavailable(self):
        original_fetch_rules = decision_engine._fetch_rules
        try:
            async def fake_fetch_rules():
                return []

            decision_engine._fetch_rules = fake_fetch_rules
            response = asyncio.run(
                decision_engine.decide(
                    decision_engine.DecideRequest(
                        request_id="REQ-2",
                        steps={
                            "isoftpull": {"status": "FAILED"},
                            "creditsafe": {"creditScore": 72},
                        },
                    )
                )
            )
            self.assertEqual(response["status"], "REVIEW")
            self.assertIn("required report providers", response["decision_reason"])
            self.assertEqual(response["decision"], "PASS TO CUSTOM")
        finally:
            decision_engine._fetch_rules = original_fetch_rules

    def test_decision_returns_engine_error_when_rules_are_unavailable(self):
        original_fetch_rules = decision_engine._fetch_rules
        try:
            async def fake_fetch_rules():
                return None

            decision_engine._fetch_rules = fake_fetch_rules
            response = asyncio.run(
                decision_engine.decide(
                    decision_engine.DecideRequest(
                        request_id="REQ-3",
                        steps={
                            "isoftpull": {"creditScore": 775},
                            "creditsafe": {"creditScore": 72},
                        },
                    )
                )
            )
            self.assertEqual(response["status"], "ENGINE_ERROR")
            self.assertIn("rules are unavailable", response["decision_reason"])
        finally:
            decision_engine._fetch_rules = original_fetch_rules

    def test_decision_returns_pass_to_custom_when_no_rules_configured(self):
        original_fetch_rules = decision_engine._fetch_rules
        try:
            async def fake_fetch_rules():
                return []

            decision_engine._fetch_rules = fake_fetch_rules
            response = asyncio.run(
                decision_engine.decide(
                    decision_engine.DecideRequest(
                        request_id="REQ-4",
                        steps={
                            "isoftpull": {"status": "OK", "creditScore": 775},
                            "creditsafe": {"status": "OK", "creditScore": 72},
                        },
                    )
                )
            )
            self.assertEqual(response["status"], "COMPLETED")
            self.assertEqual(response["decision"], "PASS TO CUSTOM")
            self.assertEqual(response["decision_reason"], "No active decision rules configured")
        finally:
            decision_engine._fetch_rules = original_fetch_rules


if __name__ == "__main__":
    unittest.main()
