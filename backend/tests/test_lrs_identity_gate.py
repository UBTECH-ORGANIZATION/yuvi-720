"""A placeholder identity must never reach the ministry a second time.

The MoE's first review finding was that `grouping→lms` was the example domain
and `content-vendor` was `ECAT-720-contract`. `config.identity_problems()` was
added to detect that, but nothing consulted it on the live path — so the same
placeholders would have shipped again the moment `LRS_ENABLED` was on. These
tests pin the gate: statements are permanent and de-duplicated by id at the LRS,
so an unsent statement is recoverable and a wrongly-stamped one is not.
"""

from __future__ import annotations


import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services.lrs import reporter  # noqa: E402

GOOD = {
    "LRS_ENABLED": "true",
    "LRS_TOKEN_URL": "https://lrs-stg.education.gov.il/auth/oauth/v2/token",
    "LRS_STATEMENTS_URL": "https://lrs-stg.education.gov.il/xAPI/statements",
    "LRS_CLIENT_ID": "cid",
    "LRS_CLIENT_SECRET": "secret",
    "LRS_SUPPLIER_DOMAIN": "https://spark.yuvilab.co.il",
    "LRS_KATA_ECAT_ID": "123456",
    "LRS_TEST_EXIDENTIFIER": "1012345678",
}


class PlaceholderIdentityGate(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        reporter._warned_identities.clear()

    async def _enqueued_with(self, **overrides) -> int:
        env = {**GOOD, **overrides}
        with mock.patch.dict(os.environ, env, clear=False):
            with mock.patch.object(
                reporter.outbox, "enqueue", new_callable=mock.AsyncMock
            ) as enqueue, mock.patch.object(
                reporter.identity_mod,
                "resolve_reporting_identity",
                new_callable=mock.AsyncMock,
                return_value={
                    "exidentifier": "1012345678", "school": "123456", "nmm": None
                },
            ):
                await reporter.report_session_enter("learner-1", "sess-1")
                return enqueue.await_count

    async def test_a_real_identity_reports(self):
        self.assertEqual(await self._enqueued_with(), 1)

    async def test_the_example_domain_is_refused(self):
        """The exact value the ministry rejected."""
        self.assertEqual(
            await self._enqueued_with(LRS_SUPPLIER_DOMAIN="https://720.example.co.il"), 0
        )

    async def test_the_contract_ecat_placeholder_is_refused(self):
        self.assertEqual(
            await self._enqueued_with(LRS_KATA_ECAT_ID="ECAT-720-contract"), 0
        )

    async def test_a_missing_single_ecat_id_no_longer_blocks_reporting(self):
        """Content events must carry a content-vendor id — but since the MoE's
        03/08 clarification that id is the SUPPLIER's ("methodica" / "10"),
        resolved per content from the catalog's `manufacture`. With the supplier
        map answering, an empty `LRS_KATA_ECAT_ID` is no longer a reason to hold
        every statement back."""
        self.assertEqual(await self._enqueued_with(LRS_KATA_ECAT_ID=""), 1)

    async def test_no_vendor_and_no_ecat_id_is_still_refused(self):
        """Improvising an identifier remains out of the question."""
        self.assertEqual(
            await self._enqueued_with(LRS_KATA_ECAT_ID="", LRS_CONTENT_VENDORS="{}"), 0
        )

    async def test_the_warning_is_logged_once_not_per_statement(self):
        with mock.patch.dict(
            os.environ, {**GOOD, "LRS_KATA_ECAT_ID": "ECAT-720-contract"}, clear=False
        ):
            with mock.patch("builtins.print") as printed:
                for _ in range(5):
                    await reporter.report_session_enter("learner-1", "sess-1")
        self.assertEqual(printed.call_count, 1)

    async def test_reporting_still_never_raises(self):
        """The gate must not become a new way for reporting to break a feature."""
        with mock.patch.dict(
            os.environ, {**GOOD, "LRS_SUPPLIER_DOMAIN": "https://720.example.co.il"},
            clear=False,
        ):
            await reporter.report_session_enter("learner-1", "sess-1")  # no raise


if __name__ == "__main__":
    unittest.main()
