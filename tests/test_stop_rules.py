import sys
from pathlib import Path
import unittest


PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / 'core-api'))

from coreapi.stop_rules import evaluate_rule, resolve_path  # noqa: E402


class StopRulesTests(unittest.TestCase):
    def test_resolve_path_handles_nested_result(self):
        payload = {'result': {'parsed_report': {'summary': {'credit_score': 712}}}}
        self.assertEqual(resolve_path(payload, 'result.parsed_report.summary.credit_score'), 712)

    def test_evaluate_rule_numeric_threshold(self):
        rule = {'field_path': 'result.parsed_report.summary.credit_score', 'operator': 'gte', 'threshold': '600'}
        payload = {'result': {'parsed_report': {'summary': {'credit_score': 712}}}}
        self.assertTrue(evaluate_rule(rule, payload))

    def test_evaluate_rule_missing_field_defaults_to_pass(self):
        rule = {'field_path': 'result.parsed_report.summary.accounts_found', 'operator': 'gte', 'threshold': '1'}
        payload = {'result': {'parsed_report': {'summary': {}}}}
        self.assertTrue(evaluate_rule(rule, payload))


if __name__ == '__main__':
    unittest.main()

