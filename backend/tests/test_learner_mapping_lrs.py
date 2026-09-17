"""LRS wiring coverage for the learner-agency questionnaire."""

from __future__ import annotations

import os
import sys
import unittest
from unittest.mock import AsyncMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import httpx
from fastapi import FastAPI

from app.auth.dependencies import require_learner_session
from app.routes import learner_mapping
from app.services import agency_mapping


class LearnerMappingLrsTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        app = FastAPI()
        app.include_router(learner_mapping.router)
        app.dependency_overrides[require_learner_session] = lambda: {
            "sub": "learner-1",
            "sid": "session-1",
            "roles": ["learner"],
        }
        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        )

    async def asyncTearDown(self):
        await self.client.aclose()

    async def test_approved_answer_is_reported_with_official_identifiers(self):
        official = agency_mapping.resolve_official_answer(1, 0)
        report = AsyncMock()

        with patch.object(
            learner_mapping.lrs_reporter, "report_agency_answered", report
        ):
            response = await self.client.post(
                "/api/questionnaire/answer",
                json={"question_number": 1, "option_index": 0},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"reported": True})
        # Spec v1.1: the response is the answer as the learner saw it; the
        # ministry's catalog ids ride along for the questionnaire mapping.
        self.assertTrue(official["answer_he"])
        report.assert_awaited_once_with(
            "learner-1",
            "session-1",
            1,
            official["answer_he"],
            score_raw=float(official["value"]),
            question_he=official["question_he"],
            question_id=official["question_id"],
            answer_id=official["answer_id"],
        )

    async def test_invalid_answer_is_rejected_before_reporting(self):
        report = AsyncMock()

        with patch.object(
            learner_mapping.lrs_reporter, "report_agency_answered", report
        ):
            response = await self.client.post(
                "/api/questionnaire/answer",
                json={"question_number": 1, "option_index": 99},
            )

        self.assertEqual(response.status_code, 422)
        report.assert_not_awaited()


if __name__ == "__main__":
    unittest.main()