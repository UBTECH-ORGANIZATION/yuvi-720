"""Admin routes must be unreachable without BOTH the role and a live grant.

`require_admin` is deliberately two gates: the JWT `roles` claim (cheap, from the
token) and an `org_admins` record (authoritative, from the database). A 12-hour
token means a revoked admin would otherwise keep full access until it expired.
"""

from __future__ import annotations

import asyncio
import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi import HTTPException

from app.auth.dependencies import require_admin


class _Request:
    """Minimal stand-in — `require_admin` only reads the session cookie."""

    def __init__(self, cookies: dict[str, str]) -> None:
        self.cookies = cookies


def run(coro):
    return asyncio.run(coro)


def _request_for(session: dict | None):
    request = _Request({"spark_session": "token"} if session else {})
    return request


class AdminRouteGateTest(unittest.TestCase):
    def _call(self, session, *, granted: bool):
        with patch("app.auth.dependencies._session_from_request", return_value=session), \
             patch("app.brain.org.is_admin", new=AsyncMock(return_value=granted)):
            return run(require_admin(_request_for(session)))

    def test_anonymous_is_401(self):
        with patch("app.auth.dependencies._session_from_request", return_value=None):
            with self.assertRaises(HTTPException) as caught:
                run(require_admin(_request_for(None)))
        self.assertEqual(caught.exception.status_code, 401)

    def test_learner_is_403(self):
        with self.assertRaises(HTTPException) as caught:
            self._call({"sub": "kid", "roles": ["learner"]}, granted=True)
        self.assertEqual(caught.exception.status_code, 403)
        self.assertEqual(caught.exception.detail, "admin_role_required")

    def test_plain_teacher_is_403(self):
        with self.assertRaises(HTTPException) as caught:
            self._call({"sub": "alice", "roles": ["teacher"]}, granted=True)
        self.assertEqual(caught.exception.status_code, 403)
        self.assertEqual(caught.exception.detail, "admin_role_required")

    def test_admin_role_without_a_live_grant_is_403(self):
        # The revocation case: the token still says admin, the database does not.
        with self.assertRaises(HTTPException) as caught:
            self._call({"sub": "root", "roles": ["teacher", "admin"]}, granted=False)
        self.assertEqual(caught.exception.status_code, 403)
        self.assertEqual(caught.exception.detail, "admin_grant_required")

    def test_admin_with_role_and_grant_passes(self):
        self.assertEqual(
            self._call({"sub": "root", "roles": ["teacher", "admin"]}, granted=True),
            "root",
        )


if __name__ == "__main__":
    unittest.main()
