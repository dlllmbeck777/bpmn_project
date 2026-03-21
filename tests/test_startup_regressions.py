import importlib.util
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def _load_migrations_module():
    path = ROOT / "core-api" / "migrations.py"
    spec = importlib.util.spec_from_file_location("migrations", path)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


class StartupRegressionTests(unittest.TestCase):
    def test_migration_12_bootstraps_pipeline_services_before_pipeline_steps(self):
        migrations = _load_migrations_module()
        sql = dict(migrations.MIGRATIONS)[12]

        self.assertIn("'isoftpull'", sql)
        self.assertIn("'creditsafe'", sql)
        self.assertIn("'plaid'", sql)

        services_bootstrap_pos = sql.index("INSERT INTO services")
        pipeline_insert_pos = sql.index("INSERT INTO pipeline_steps")
        self.assertLess(services_bootstrap_pos, pipeline_insert_pos)

    def test_flowable_rest_healthcheck_uses_busybox_compatible_auth(self):
        compose = (ROOT / "docker-compose.yml").read_text(encoding="utf-8")

        self.assertIn("Authorization: Basic", compose)
        self.assertNotIn("--password=${FLOWABLE_PASSWORD:-test}", compose)


if __name__ == "__main__":
    unittest.main()
