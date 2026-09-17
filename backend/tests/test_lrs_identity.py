"""`resolve_reporting_identity`: the user's own identity first, the staging
stub second, and nothing invented."""

from __future__ import annotations

import os
import unittest
from unittest import mock

from app.services.lrs import identity


def _user(**fields):
    return mock.AsyncMock(return_value=fields or None)


class ResolveReportingIdentityTests(unittest.IsolatedAsyncioTestCase):
    async def test_user_fields_win_over_the_env_stub(self):
        env = {"LRS_TEST_EXIDENTIFIER": "1012345678", "LRS_DEFAULT_SCHOOL": "111111", "LRS_DEFAULT_NMM": "222222"}
        with mock.patch.dict(os.environ, env), mock.patch(
            "app.auth.repository.get_user_by_id",
            _user(exidentifier="1020000001", school_symbol="333333", nmm_id="90635956"),
        ):
            resolved = await identity.resolve_reporting_identity("u1")
        self.assertEqual(resolved, {"exidentifier": "1020000001", "school": "333333", "nmm": "90635956"})

    async def test_env_stub_fills_what_the_user_lacks(self):
        env = {"LRS_TEST_EXIDENTIFIER": "1012345678", "LRS_DEFAULT_SCHOOL": "111111", "LRS_DEFAULT_NMM": ""}
        with mock.patch.dict(os.environ, env), mock.patch(
            "app.auth.repository.get_user_by_id", _user(display_name="x"),
        ):
            resolved = await identity.resolve_reporting_identity("u1")
        self.assertEqual(resolved, {"exidentifier": "1012345678", "school": "111111", "nmm": None})

    async def test_no_identity_anywhere_is_none_not_a_guess(self):
        env = {"LRS_TEST_EXIDENTIFIER": "", "LRS_DEFAULT_SCHOOL": "", "LRS_DEFAULT_NMM": ""}
        with mock.patch.dict(os.environ, env), mock.patch(
            "app.auth.repository.get_user_by_id", _user(display_name="x"),
        ):
            self.assertIsNone(await identity.resolve_reporting_identity("u1"))

    async def test_a_user_with_an_exidentifier_reports_without_any_stub(self):
        env = {"LRS_TEST_EXIDENTIFIER": "", "LRS_DEFAULT_SCHOOL": "", "LRS_DEFAULT_NMM": ""}
        with mock.patch.dict(os.environ, env), mock.patch(
            "app.auth.repository.get_user_by_id", _user(exidentifier="1020000001", nmm_id="90635956"),
        ):
            resolved = await identity.resolve_reporting_identity("u1")
        self.assertEqual(resolved, {"exidentifier": "1020000001", "school": None, "nmm": "90635956"})

    async def test_a_repository_failure_falls_back_to_the_env(self):
        env = {"LRS_TEST_EXIDENTIFIER": "1012345678", "LRS_DEFAULT_SCHOOL": "111111", "LRS_DEFAULT_NMM": ""}
        with mock.patch.dict(os.environ, env), mock.patch(
            "app.auth.repository.get_user_by_id", mock.AsyncMock(side_effect=RuntimeError("db down")),
        ):
            resolved = await identity.resolve_reporting_identity("u1")
        self.assertEqual(resolved["exidentifier"], "1012345678")


if __name__ == "__main__":
    unittest.main()
