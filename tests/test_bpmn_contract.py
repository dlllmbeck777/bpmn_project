from pathlib import Path
import unittest


PROJECT_ROOT = Path(__file__).resolve().parents[1]
BPMN_PATH = PROJECT_ROOT / "processes" / "credit-service-chain.bpmn20.xml"


class BpmnContractTests(unittest.TestCase):
    def test_decision_tasks_do_not_depend_on_groovy_json_module(self):
        xml = BPMN_PATH.read_text(encoding="utf-8")
        self.assertNotIn("groovy.json.JsonOutput", xml)
        self.assertNotIn("groovy.json.JsonSlurper", xml)
        self.assertIn("com.fasterxml.jackson.databind.ObjectMapper", xml)

    def test_init_task_sets_decision_defaults(self):
        xml = BPMN_PATH.read_text(encoding="utf-8")
        self.assertIn("execution.setVariable('decision_service_url'", xml)
        self.assertIn("execution.setVariable('decision_request_body'", xml)


if __name__ == "__main__":
    unittest.main()
