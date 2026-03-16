import json
import unittest
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
CASES_PATH = PROJECT_ROOT / "scripts" / "demo-test-cases.json"


class DemoTestCasesCatalogTests(unittest.TestCase):
    def test_catalog_has_ten_unique_cases(self):
        catalog = json.loads(CASES_PATH.read_text(encoding="utf-8"))
        cases = catalog["cases"]
        case_ids = [case["id"] for case in cases]

        self.assertEqual(len(cases), 10)
        self.assertEqual(len(case_ids), len(set(case_ids)))

    def test_each_case_has_request_and_expected(self):
        catalog = json.loads(CASES_PATH.read_text(encoding="utf-8"))
        for case in catalog["cases"]:
            self.assertIn("request", case)
            self.assertIn("expected", case)
            self.assertIn("title", case)


if __name__ == "__main__":
    unittest.main()
