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


class _DummyHTTPException(Exception):
    def __init__(self, status_code=500, detail="error"):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


class _DummyBaseModel:
    def __init__(self, **kwargs):
        for key, value in kwargs.items():
            setattr(self, key, value)


sys.modules.setdefault("fastapi", SimpleNamespace(FastAPI=_DummyFastAPI, HTTPException=_DummyHTTPException))
sys.modules.setdefault("pydantic", SimpleNamespace(BaseModel=_DummyBaseModel))

import report_parser  # noqa: E402

sys.modules.pop("fastapi", None)
sys.modules.pop("pydantic", None)


class ReportParserTests(unittest.TestCase):
    def test_extract_isoftpull_uses_report_score_and_derives_collection_count(self):
        payload = {
            "creditScore": 775,
            "rawResponse": {
                "reports": {
                    "equifax": {
                        "full_feed": {
                            "trade_accounts": [
                                {"30_day_delinquencies": "3", "60_day_delinquencies": "1", "90_day_delinquencies": "1"},
                            ]
                        }
                    },
                    "transunion": {
                        "full_feed": {
                            "trade_accounts": [
                                {"30_day_delinquencies": "1", "60_day_delinquencies": "0", "90_day_delinquencies": "0"},
                            ]
                        }
                    },
                }
            },
        }

        parsed = report_parser._extract_isoftpull(payload)

        self.assertEqual(parsed["credit_score"], 775)
        self.assertEqual(parsed["collection_count"], 5)
        self.assertEqual(parsed["status"], "OK")

    def test_extract_creditsafe_prefers_explicit_compliance_alert_count(self):
        payload = {
            "creditScore": 72,
            "rawResponse": {
                "compliance": {
                    "alerts": [
                        {"id": "a1"},
                        {"id": "a2"},
                    ]
                },
                "bestMatch": {
                    "company": {
                        "derogatoryCount": 7,
                    }
                },
            },
        }

        parsed = report_parser._extract_creditsafe(payload)

        self.assertEqual(parsed["company_score"], 72)
        self.assertEqual(parsed["compliance_alert_count"], 2)
        self.assertEqual(parsed["derogatory_count"], 7)

    def test_extract_creditsafe_falls_back_to_derogatory_count(self):
        payload = {
            "rawResponse": {
                "bestMatch": {
                    "company": {
                        "rating": 72,
                        "derogatoryCount": 3,
                    }
                }
            }
        }

        parsed = report_parser._extract_creditsafe(payload)

        self.assertEqual(parsed["company_score"], 72)
        self.assertEqual(parsed["compliance_alert_count"], 3)

    def test_parse_summary_exposes_flowable_decision_metrics(self):
        request = report_parser.ParseRequest(
            request_id="REQ-1",
            steps={
                "isoftpull": {
                    "creditScore": 575,
                    "rawResponse": {
                        "reports": {
                            "equifax": {
                                "full_feed": {
                                    "trade_accounts": [
                                        {"30_day_delinquencies": "4", "60_day_delinquencies": "1", "90_day_delinquencies": "1"},
                                    ]
                                }
                            }
                        }
                    },
                },
                "creditsafe": {
                    "rawResponse": {
                        "compliance": {
                            "alerts": [{"id": "1"}, {"id": "2"}]
                        }
                    }
                },
            },
        )

        parsed = report_parser.parse(request)

        self.assertEqual(parsed["summary"]["credit_score"], 575)
        self.assertEqual(parsed["summary"]["collection_count"], 6)
        self.assertEqual(parsed["summary"]["creditsafe_compliance_alert_count"], 2)


if __name__ == "__main__":
    unittest.main()
