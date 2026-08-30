"""The guard that keeps a laptop off the production cluster.

Every case here is a way the old single-connection-string setup went wrong in
practice: a script on a developer machine reaching live learner records, and a
deployment that lost its variable and wrote to container-local JSON instead.
"""

import os
import unittest
from unittest.mock import patch

from app.core import database


def _env(**overrides: str) -> dict:
    base = {
        "MONGODB_CONNECTION_STRING": "",
        "MONGODB_DATABASE": "",
        "MONGODB_DB": "",
        "SPARK_STORAGE": "",
        "SPARK_ENVIRONMENT": "",
        "ENVIRONMENT": "",
        "SPARK_ALLOW_PRODUCTION_DB": "",
        "WEBSITE_SLOT_NAME": "",
    }
    base.update(overrides)
    return base


DEV_URI = "mongodb+srv://dbadmin:pw@yuvi720-dev.mongocluster.cosmos.azure.com/?tls=true"
PROD_URI = "mongodb+srv://dbadmin:pw@yuvi720.mongocluster.cosmos.azure.com/?tls=true"


class DatabaseConfigTests(unittest.TestCase):
    def setUp(self) -> None:
        database.reset_verification_cache()
        self.addCleanup(database.reset_verification_cache)

    def test_host_is_extracted_without_the_password(self) -> None:
        with patch.dict(os.environ, _env(MONGODB_CONNECTION_STRING=PROD_URI), clear=True):
            self.assertEqual(
                database.connection_host(), "yuvi720.mongocluster.cosmos.azure.com"
            )
            self.assertNotIn("pw", database.describe_line())

    def test_dev_host_is_not_production(self) -> None:
        with patch.dict(os.environ, _env(MONGODB_CONNECTION_STRING=DEV_URI), clear=True):
            self.assertFalse(database.is_production_host())
            database.verify_configuration()  # must not raise

    def test_production_host_refused_from_a_developer_machine(self) -> None:
        with patch.dict(os.environ, _env(MONGODB_CONNECTION_STRING=PROD_URI), clear=True):
            with self.assertRaises(RuntimeError) as ctx:
                database.verify_configuration()
            self.assertIn("production database", str(ctx.exception))

    def test_production_host_allowed_when_the_environment_says_production(self) -> None:
        env = _env(MONGODB_CONNECTION_STRING=PROD_URI, SPARK_ENVIRONMENT="production")
        with patch.dict(os.environ, env, clear=True):
            database.verify_configuration()
            self.assertTrue(database.is_production_host())

    def test_escape_hatch_allows_one_off_production_access(self) -> None:
        env = _env(MONGODB_CONNECTION_STRING=PROD_URI, SPARK_ALLOW_PRODUCTION_DB="1")
        with patch.dict(os.environ, env, clear=True):
            database.verify_configuration()  # loud, but permitted

    def test_missing_connection_string_fails_loudly(self) -> None:
        with patch.dict(os.environ, _env(), clear=True):
            with self.assertRaises(RuntimeError) as ctx:
                database.verify_configuration()
            self.assertIn("MONGODB_CONNECTION_STRING", str(ctx.exception))

    def test_json_fallback_is_allowed_only_when_asked_for(self) -> None:
        with patch.dict(os.environ, _env(SPARK_STORAGE="json"), clear=True):
            database.verify_configuration()
            self.assertEqual(database.storage_mode(), database.JSON)
            self.assertIsNone(database.describe()["database"])

    def test_production_never_accepts_the_json_fallback(self) -> None:
        env = _env(SPARK_STORAGE="json", SPARK_ENVIRONMENT="production")
        with patch.dict(os.environ, env, clear=True):
            with self.assertRaises(RuntimeError) as ctx:
                database.verify_configuration()
            self.assertIn("required in production", str(ctx.exception))

    def test_slot_name_names_the_environment_when_nothing_else_does(self) -> None:
        env = _env(MONGODB_CONNECTION_STRING=DEV_URI, WEBSITE_SLOT_NAME="dev")
        with patch.dict(os.environ, env, clear=True):
            self.assertEqual(database.environment_name(), "dev")

    def test_describe_reports_the_host_actually_loaded(self) -> None:
        env = _env(MONGODB_CONNECTION_STRING=DEV_URI, MONGODB_DATABASE="yuvi720")
        with patch.dict(os.environ, env, clear=True):
            info = database.describe()
            self.assertEqual(info["host"], "yuvi720-dev.mongocluster.cosmos.azure.com")
            self.assertEqual(info["database"], "yuvi720")
            self.assertEqual(info["storage"], "mongo")


if __name__ == "__main__":
    unittest.main()
