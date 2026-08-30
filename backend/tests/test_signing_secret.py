"""The app-wide signing secret must never fall back to the dev value in production.

Regression cover for a live incident: production set `SPARK_ENVIRONMENT` but the
guard only looked at `ENVIRONMENT`, so it signed real session tokens with the
`yuvi720-dev-secret` constant that ships in this repo. The xAPI launch signer in
`app.services.events` had drifted further and carried no guard at all.
"""

from __future__ import annotations

import os
import unittest
from unittest.mock import patch

from app.auth import tokens
from app.core.env import signing_secret
from app.services import events

_CLEARED = {"SECRET_KEY": "", "ENVIRONMENT": "", "SPARK_ENVIRONMENT": ""}


def _env(**overrides: str) -> dict[str, str]:
    merged = dict(os.environ)
    merged.update(_CLEARED)
    merged.update(overrides)
    return {key: value for key, value in merged.items() if value != ""}


class SigningSecretTests(unittest.TestCase):
    def test_configured_secret_wins(self) -> None:
        with patch.dict(os.environ, _env(SECRET_KEY="s3cret", SPARK_ENVIRONMENT="production"), clear=True):
            self.assertEqual(signing_secret(), "s3cret")

    def test_missing_secret_raises_when_environment_says_production(self) -> None:
        with patch.dict(os.environ, _env(ENVIRONMENT="production"), clear=True):
            with self.assertRaises(RuntimeError):
                signing_secret()

    def test_missing_secret_raises_when_spark_environment_says_production(self) -> None:
        """The App Service only sets SPARK_ENVIRONMENT — this is the case that leaked."""
        with patch.dict(os.environ, _env(SPARK_ENVIRONMENT="production"), clear=True):
            with self.assertRaises(RuntimeError):
                signing_secret()

    def test_local_development_still_gets_a_usable_secret(self) -> None:
        with patch.dict(os.environ, _env(SPARK_ENVIRONMENT="dev"), clear=True):
            self.assertTrue(signing_secret())

    def test_both_signers_share_the_guard(self) -> None:
        with patch.dict(os.environ, _env(SPARK_ENVIRONMENT="production"), clear=True):
            with self.assertRaises(RuntimeError):
                tokens._secret()
            with self.assertRaises(RuntimeError):
                events._secret()

    def test_both_signers_use_the_same_key(self) -> None:
        with patch.dict(os.environ, _env(SECRET_KEY="shared-key"), clear=True):
            self.assertEqual(tokens._secret(), "shared-key")
            self.assertEqual(events._secret(), b"shared-key")


if __name__ == "__main__":
    unittest.main()
