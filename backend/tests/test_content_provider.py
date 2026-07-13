"""Approved content-provider adapter and xAPI compatibility tests."""

from __future__ import annotations

import json
import unittest
from unittest.mock import AsyncMock, patch
from urllib.parse import parse_qs, urlparse

import httpx

from app.services import content_provider
from app.services.events import (
    _attach_timing_evidence,
    mint_launch,
    normalize_statement,
    statement_matches_launch,
    verify_launch,
)
from app.services.learning_timing import summarize_session
from app.services.learning_progress import project_unit_roadmap
from app.services import triggers


UNIT = {
    "id": "YuviDori-math-angles-00001",
    "title": "זוויות",
    "subTopic": "זוויות",
    "learningObjective": "angles-vertical",
    "components": [
        {
            "id": "YuviDori-math-angles-00001-00004",
            "learningUnitId": "YuviDori-math-angles-00001",
            "title": "הערכה: חישוב זווית חסרה",
            "componentPurpose": "practice",
            "isAssessment": True,
            "isRequired": True,
            "relativeDifficulty": 3,
            "masteryLevel": "intermediate",
            "order": 4,
            "languages": ["Hebrew"],
            "estimatedTimeInMinutes": 5,
            "recommendedAfterFail": ["YuviDori-math-angles-00001-00002-basic"],
            "subContent": [
                {
                    "informationToBot": "מטרת הפריט: זווית קודקודית.",
                    "questions": [{"questionId": "q1"}],
                }
            ],
        }
    ],
}


class ContentProviderNormalizationTests(unittest.TestCase):
    def test_normalizes_grounded_metadata_for_catalog_and_coach(self) -> None:
        unit = content_provider.normalize_unit(UNIT)
        component = unit["components"][0]

        self.assertEqual(unit["subject"], "math")
        self.assertEqual(unit["objective_id"], "angles-vertical")
        self.assertEqual(component["languages"], ["he"])
        self.assertTrue(component["is_assessment"])
        self.assertEqual(component["estimated_minutes"], 5)
        self.assertEqual(component["question_ids"], ["q1"])
        self.assertIn("זווית קודקודית", component["information_to_bot"])
        self.assertEqual(
            component["recommended_after_fail"],
            ["YuviDori-math-angles-00001-00002-basic"],
        )

    def test_rejects_unsafe_provider_ids(self) -> None:
        with self.assertRaises(content_provider.ContentProviderError) as raised:
            content_provider.build_player_url("../secret", "component", {})
        self.assertEqual(raised.exception.status_code, 422)

    def test_player_url_contains_compact_slxapi(self) -> None:
        slxapi = {
            "endpoint": "https://spark.example/api/xapi/signed/",
            "auth": "Basic signed",
            "actor": {"account": {"name": "learner-1"}},
        }
        with patch.dict("os.environ", {"CONTENT_PROVIDER_BASE_URL": "https://provider.example/"}):
            url = content_provider.build_player_url(
                "YuviDori-math-angles-00001",
                "YuviDori-math-angles-00001-00004",
                slxapi,
            )

        parsed = urlparse(url)
        query = parse_qs(parsed.query)
        self.assertEqual(parsed.path, "/player")
        self.assertEqual(query["component"][0], "YuviDori-math-angles-00001-00004")
        self.assertEqual(json.loads(query["slxapi"][0]), slxapi)


class ContentProviderHttpTests(unittest.IsolatedAsyncioTestCase):
    async def test_get_unit_normalizes_provider_response(self) -> None:
        with patch(
            "app.services.content_provider._get_json",
            new=AsyncMock(return_value=UNIT),
        ):
            unit = await content_provider.get_unit(UNIT["id"])
        self.assertEqual(unit["components"][0]["id"], UNIT["components"][0]["id"])

    async def test_provider_transport_error_is_safe(self) -> None:
        request = httpx.Request("GET", "https://provider.example/api/catalog/units")
        with patch(
            "httpx.AsyncClient.get",
            new=AsyncMock(side_effect=httpx.ConnectError("secret upstream detail", request=request)),
        ):
            with self.assertRaises(content_provider.ContentProviderError) as raised:
                await content_provider._get_json("/api/catalog/units")
        self.assertEqual(raised.exception.code, "content_provider_unavailable")
        self.assertNotIn("secret upstream detail", str(raised.exception))


class ProviderXapiCompatibilityTests(unittest.TestCase):
    def setUp(self) -> None:
        minted = mint_launch(
            "learner-1",
            objective_id="angles-vertical",
            component_id="YuviDori-math-angles-00001-00004",
            unit_id="YuviDori-math-angles-00001",
            subject="math",
            is_assessment=True,
            source="content_provider",
            reporting_base_url="https://spark.example/",
        )
        self.launch_context = minted
        self.launch = verify_launch(minted["launch"])
        assert self.launch is not None

    def test_launch_uses_absolute_endpoint(self) -> None:
        self.assertTrue(
            self.launch_context["slxapi"]["endpoint"].startswith("https://spark.example/api/xapi/")
        )

    def test_maps_provider_adl_answer_and_preserves_provenance(self) -> None:
        statement = {
            "id": "provider-statement-1",
            "actor": self.launch_context["slxapi"]["actor"],
            "verb": {"id": "http://adlnet.gov/expapi/verbs/answered"},
            "object": {"id": "https://provider.example/activity/q1"},
            "result": {"success": False, "duration": "PT42S"},
        }
        event = normalize_statement(statement, self.launch)

        assert event is not None
        self.assertEqual(event["verb"], "answered")
        self.assertEqual(event["normalization"], "provider_adl_compat")
        self.assertEqual(event["source_verb_iri"], statement["verb"]["id"])
        self.assertEqual(event["question_id"], "q1")
        self.assertTrue(event["is_assessment"])
        self.assertEqual(event["result"]["duration"], "PT42S")

    def test_provider_compatibility_is_not_enabled_for_native_launches(self) -> None:
        native = verify_launch(mint_launch("learner-1")["launch"])
        assert native is not None
        statement = {"verb": {"id": "http://adlnet.gov/expapi/verbs/answered"}}
        self.assertIsNone(normalize_statement(statement, native))

    def test_rejects_wrong_actor_and_other_provider_component(self) -> None:
        wrong_actor = {
            "actor": {"account": {"name": "another-learner"}},
            "object": {"id": "q1"},
        }
        wrong_component = {
            "actor": self.launch_context["slxapi"]["actor"],
            "object": {"id": "https://provider/YuviDori-math-fractions-00001-00004/q1"},
        }
        self.assertFalse(statement_matches_launch(wrong_actor, self.launch))
        self.assertFalse(statement_matches_launch(wrong_component, self.launch))


class LearningTimingTests(unittest.TestCase):
    def test_summarizes_component_and_question_elapsed_evidence(self) -> None:
        events = [
            {
                "verb": "enter",
                "launch": "component-1",
                "unit_id": "unit-1",
                "objective_id": "objective-1",
                "object_id": "component-1",
                "occurred_at": "2026-07-13T12:00:00+00:00",
            },
            {
                "verb": "answered",
                "launch": "component-1",
                "object_id": "item-1#q1",
                "question_id": "q1",
                "result": {"success": False},
                "occurred_at": "2026-07-13T12:00:42+00:00",
            },
            {
                "verb": "answered",
                "launch": "component-1",
                "object_id": "item-1#q1",
                "question_id": "q1",
                "result": {"success": True},
                "occurred_at": "2026-07-13T12:01:00+00:00",
            },
            {
                "verb": "completed",
                "launch": "component-1",
                "object_id": "component-1",
                "occurred_at": "2026-07-13T12:01:10+00:00",
            },
        ]
        summary = summarize_session(events, "session-1")

        self.assertEqual(summary["status"], "completed")
        self.assertEqual(summary["total_elapsed_seconds"], 70.0)
        self.assertFalse(summary["active_time_available"])
        self.assertEqual(summary["total_timing_quality"], "elapsed_between_events")
        self.assertEqual(summary["questions"][0]["attempts"], 2)
        self.assertEqual(summary["questions"][0]["elapsed_seconds"], 60.0)
        self.assertTrue(summary["questions"][0]["last_success"])

    def test_does_not_invent_timing_without_start_evidence(self) -> None:
        summary = summarize_session([
            {
                "verb": "answered",
                "object_id": "item-1#q1",
                "result": {"success": False},
                "occurred_at": "2026-07-13T12:00:42+00:00",
            }
        ], "session-2")
        self.assertIsNone(summary["total_elapsed_seconds"])
        self.assertEqual(summary["total_timing_quality"], "unavailable")
        self.assertIsNone(summary["questions"][0]["elapsed_seconds"])


class EventTimingAndTriggerTests(unittest.IsolatedAsyncioTestCase):
    async def test_attaches_elapsed_evidence_from_previous_session_event(self) -> None:
        event = {
            "_id": "answer-1",
            "learner_id": "learner-1",
            "session_id": "session-1",
            "occurred_at": "2026-07-13T12:03:01+00:00",
        }
        prior = [{
            "_id": "enter-1",
            "occurred_at": "2026-07-13T12:00:00+00:00",
        }]
        with patch(
            "app.services.events.get_session_events",
            new=AsyncMock(return_value=prior),
        ):
            await _attach_timing_evidence(event)

        self.assertEqual(event["timing"]["elapsed_since_previous_seconds"], 181.0)
        self.assertEqual(event["timing"]["quality"], "elapsed_between_events")

    async def test_prolonged_answer_publishes_slow_progress(self) -> None:
        event = {
            "verb": "answered",
            "objective_id": "angles-vertical",
            "question_id": "q1",
            "result": {"success": True},
            "timing": {
                "elapsed_since_previous_seconds": triggers.PROLONGED_INTERACTION_SECONDS + 1,
                "quality": "elapsed_between_events",
            },
        }
        with patch("app.services.triggers._publish") as publish:
            trigger = await triggers.evaluate("learner-1", event)

        assert trigger is not None
        self.assertEqual(trigger["type"], "slow_progress")
        self.assertEqual(trigger["question_id"], "q1")
        publish.assert_called_once_with("learner-1", trigger)


class LearningRoadmapProjectionTests(unittest.IsolatedAsyncioTestCase):
    async def test_completion_and_unlock_are_derived_from_real_evidence(self) -> None:
        unit = content_provider.normalize_unit({
            **UNIT,
            "components": [
                {**UNIT["components"][0], "id": "component-1", "order": 1, "isAssessment": False},
                {**UNIT["components"][0], "id": "component-2", "order": 2, "isAssessment": False},
                {**UNIT["components"][0], "id": "component-3", "order": 3, "isAssessment": False},
            ],
        })
        events = [{
            "_id": "completed-1",
            "verb": "completed",
            "launch": "component-1",
            "result": {"success": True},
        }]
        brain = {"current_state": {"unit_id": unit["id"], "component_id": "component-2"}}
        with (
            patch("app.services.learning_progress.get_unit_events", new=AsyncMock(return_value=events)),
            patch("app.services.learning_progress.get_brain", new=AsyncMock(return_value=brain)),
        ):
            roadmap = await project_unit_roadmap(unit, "learner-1")

        self.assertEqual(
            [component["progress_state"] for component in roadmap["components"]],
            ["completed", "current", "locked"],
        )
        self.assertEqual(
            roadmap["components"][0]["progress_evidence"],
            {"kind": "xapi_completed", "event_id": "completed-1"},
        )
