"""Kata client adapter + xAPI compatibility tests."""

from __future__ import annotations

import unittest
from unittest.mock import AsyncMock, patch

import httpx

from app.services import kata_client
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
    "id": "methodica-math-angles-01",
    "title": "זוויות",
    "subTopic": "MOE.MATH.G7.GEO.ANGLES",
    "learningObjective": "MOE.MATH.G7.GEO.ANGLES.VERTICAL",
    "prerequisiteLearningObjective": [],
    "components": [
        {
            "id": "methodica-math-angles-01-04",
            "learningUnitId": "methodica-math-angles-01",
            "title": "הערכה: חישוב זווית חסרה",
            "componentPurpose": "practice",
            "isAssessment": True,
            "isRequired": True,
            "relativeDifficulty": 3,
            "masteryLevel": "intermediate",
            "order": 4,
            "languages": ["Hebrew"],
            "estimatedTimeInMinutes": 5,
            "recommendedAfterFail": ["methodica-math-angles-01-02"],
            "subContent": [
                {
                    "id": "methodica-math-angles-01-04-001",
                    "informationToBot": "מטרת הפריט: זווית קודקודית.",
                    "questions": [{
                        "questionId": "q1",
                        "questionType": "choice",
                        "questionText": "מה ניתן להסיק על זוויות קודקודיות?",
                        "answers": ["הן תמיד שוות זו לזו", "הן תמיד סמוכות"],
                        "correctAnswers": ["הן תמיד שוות זו לזו"],
                    }],
                }
            ],
        }
    ],
}


class KataNormalizationTests(unittest.TestCase):
    def test_normalizes_grounded_metadata_for_catalog_and_coach(self) -> None:
        unit = kata_client.normalize_unit(UNIT)
        component = unit["components"][0]

        self.assertEqual(unit["subject"], "math")
        self.assertEqual(unit["objective_id"], "MOE.MATH.G7.GEO.ANGLES.VERTICAL")
        self.assertEqual(component["languages"], ["he"])
        self.assertTrue(component["is_assessment"])
        self.assertEqual(component["estimated_minutes"], 5)
        self.assertEqual(component["question_ids"], ["q1"])
        self.assertIn("זווית קודקודית", component["information_to_bot"])
        # Per-item bot text is keyed by both the sub-content id and question id.
        self.assertIn("זווית קודקודית", component["information_by_item"]["q1"])
        self.assertEqual(
            component["recommended_after_fail"],
            ["methodica-math-angles-01-02"],
        )
        # Server-only question snapshot (text/options/correct) keyed by sub-item id.
        rows = component["questions_by_item"]["methodica-math-angles-01-04-001"]
        self.assertEqual(rows[0]["questionId"], "q1")
        self.assertEqual(rows[0]["questionText"], "מה ניתן להסיק על זוויות קודקודיות?")
        self.assertEqual(rows[0]["correctAnswers"], ["הן תמיד שוות זו לזו"])
        self.assertEqual(len(rows[0]["answers"]), 2)

    def test_subject_derives_from_dotted_moe_key(self) -> None:
        self.assertEqual(kata_client.subject_from_objective("MOE.SCI.G7.CHEM.X"), "science")
        self.assertEqual(kata_client.subject_from_objective("MOE.MATH.G7.GEO.X"), "math")
        self.assertEqual(kata_client.subject_from_objective("MOE.HIST.G7.X"), "other")

    def test_rejects_unsafe_ids(self) -> None:
        with self.assertRaises(kata_client.KataError) as raised:
            kata_client._safe_id("../secret", "component_id")
        self.assertEqual(raised.exception.status_code, 422)


class KataHttpTests(unittest.IsolatedAsyncioTestCase):
    async def test_get_unit_normalizes_kata_response(self) -> None:
        with patch(
            "app.services.kata_client._get_json",
            new=AsyncMock(return_value=UNIT),
        ):
            unit = await kata_client.get_unit(UNIT["id"])
        self.assertEqual(unit["components"][0]["id"], UNIT["components"][0]["id"])

    async def test_transport_error_is_safe(self) -> None:
        request = httpx.Request("GET", "https://kata.example/api/v1/catalog/content-units")
        with patch.dict("os.environ", {"KATA_API_KEY": "test-key"}):
            with patch(
                "httpx.AsyncClient.get",
                new=AsyncMock(side_effect=httpx.ConnectError("secret upstream detail", request=request)),
            ):
                with self.assertRaises(kata_client.KataError) as raised:
                    await kata_client._get_json("/api/v1/catalog/content-units")
        self.assertEqual(raised.exception.code, "kata_unavailable")
        self.assertNotIn("secret upstream detail", str(raised.exception))

    async def test_create_launch_context_returns_launch_url(self) -> None:
        with patch(
            "app.services.kata_client._post_json",
            new=AsyncMock(return_value={"launchUrl": "https://lomdot.example/x", "registrationId": "reg-1"}),
        ):
            ctx = await kata_client.create_launch_context(
                component_id="methodica-math-angles-01-04",
                student_id="learner-1",
                platform_url="https://spark.example",
                lrs_endpoint="https://spark.example/api/xapi/tok/",
                lrs_auth="Basic tok",
            )
        self.assertEqual(ctx["launch_url"], "https://lomdot.example/x")
        self.assertEqual(ctx["registration_id"], "reg-1")


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


class ProactiveNudgeTests(unittest.IsolatedAsyncioTestCase):
    """First-mistake nudge (per-question dedupe) + idle watchdog arming."""

    def setUp(self) -> None:
        triggers._last_mistake_key.clear()
        triggers._last_streak_session.clear()
        triggers._last_published.clear()
        for handle in list(triggers._idle_handles.values()):
            handle.cancel()
        triggers._idle_handles.clear()

    def tearDown(self) -> None:
        for handle in list(triggers._idle_handles.values()):
            handle.cancel()
        triggers._idle_handles.clear()

    async def _evaluate(self, event, learner="nudge-learner"):
        with (
            patch("app.services.events.get_recent_events", new=AsyncMock(return_value=[])),
            patch("app.services.triggers._publish") as publish,
        ):
            trigger = await triggers.evaluate(learner, event)
        return trigger, publish

    def _wrong(self, object_id, effortful=True):
        return {
            "verb": "answered", "objective_id": "obj-1", "question_id": "q1",
            "object_id": object_id, "effortful": effortful,
            "result": {"success": False}, "timing": {},
        }

    async def test_first_effortful_mistake_publishes(self) -> None:
        trigger, publish = await self._evaluate(self._wrong("comp-001/q1"))
        self.assertIsNotNone(trigger)
        self.assertEqual(trigger["type"], "mistake")
        self.assertNotIn("_key", trigger)          # internal key stripped before publish
        publish.assert_called_once()

    async def test_same_question_is_deduped(self) -> None:
        await self._evaluate(self._wrong("comp-001/q1"))
        trigger, publish = await self._evaluate(self._wrong("comp-001/q1"))
        self.assertIsNone(trigger)                 # never nag twice on the same Q
        publish.assert_not_called()

    async def test_new_question_nudges_again(self) -> None:
        await self._evaluate(self._wrong("comp-001/q1"))
        trigger, _ = await self._evaluate(self._wrong("comp-002/q1"))
        self.assertEqual((trigger or {}).get("type"), "mistake")

    async def test_non_effortful_wrong_is_not_a_mistake_nudge(self) -> None:
        trigger, _ = await self._evaluate(self._wrong("comp-003/q1", effortful=False))
        self.assertIsNone(trigger)                 # a rapid guess is not a "mistake"

    async def test_idle_armed_on_activity_cancelled_on_completion(self) -> None:
        await self._evaluate(
            {"verb": "answered", "objective_id": "obj-1", "object_id": "comp-001/q1",
             "effortful": True, "result": {"success": True}, "timing": {}},
            learner="idle-learner",
        )
        self.assertIn("idle-learner", triggers._idle_handles)
        await self._evaluate(
            {"verb": "completed", "objective_id": "obj-1", "object_id": "comp",
             "result": {"success": True}},
            learner="idle-learner",
        )
        self.assertNotIn("idle-learner", triggers._idle_handles)

    def test_publish_idle_emits_idle_trigger(self) -> None:
        with patch("app.services.triggers._publish") as publish:
            triggers.publish_idle("idle-emit-learner", "obj-1")
        publish.assert_called_once()
        self.assertEqual(publish.call_args[0][1]["type"], "idle")

    async def test_component_completion_publishes_completion_signal(self) -> None:
        # Phase 4: a COMPONENT-level `completed` pushes a `completion` STATE
        # signal over SSE (alongside the `success` nudge) so the UI finalizes
        # without polling. object tail == launch component → component-level.
        event = {
            "verb": "completed", "objective_id": "obj-1", "launch": "comp",
            "unit_id": "unit-1", "object_id": "https://kata/content/comp",
            "result": {"success": True},
        }
        _, publish = await self._evaluate(event, learner="done-learner")
        completion = [c.args[1] for c in publish.call_args_list
                      if c.args[1].get("type") == "completion"]
        self.assertEqual(len(completion), 1)
        self.assertEqual(completion[0]["component_id"], "comp")
        self.assertEqual(completion[0]["unit_id"], "unit-1")

    async def test_per_screen_completed_does_not_publish_completion(self) -> None:
        # A per-screen `completed` (object is a sub-item) is item progress, not
        # "the lesson is done" — it must NOT flip the roadmap node.
        event = {
            "verb": "completed", "objective_id": "obj-1", "launch": "comp",
            "object_id": "https://kata/content/comp/comp-01", "sub_item_id": "comp-01",
            "result": {"success": True},
        }
        _, publish = await self._evaluate(event, learner="screen-learner")
        self.assertFalse([c.args[1] for c in publish.call_args_list
                          if c.args[1].get("type") == "completion"])

    async def test_success_after_fail_streak_is_recovery(self) -> None:
        event = {
            "verb": "answered", "objective_id": "obj-1", "object_id": "comp-002/q1",
            "_id": "cur", "effortful": True, "result": {"success": True}, "timing": {},
        }
        prior = [
            {"verb": "answered", "_id": "f1", "effortful": True, "result": {"success": False}},
            {"verb": "answered", "_id": "f2", "effortful": True, "result": {"success": False}},
        ]
        with (
            patch("app.services.events.get_recent_events", new=AsyncMock(return_value=[event, *prior])),
            patch("app.services.triggers._publish") as publish,
        ):
            trigger = await triggers.evaluate("recovery-learner", event)
        self.assertIsNotNone(trigger)
        self.assertEqual(trigger["type"], "success")
        self.assertEqual(trigger["reason"], "recovery")
        self.assertNotIn("_streak_session", trigger)   # private field stripped
        publish.assert_called_once()

    async def test_misconception_attaches_alternative_representation(self) -> None:
        event = {
            "verb": "answered", "objective_id": "obj-1", "object_id": "comp-001/q1",
            "launch": "comp-001", "_id": "cur", "effortful": True,
            "result": {"success": False}, "timing": {},
        }
        fails = [event] + [
            {"verb": "answered", "_id": f"f{i}", "effortful": True, "result": {"success": False}}
            for i in range(2)
        ]
        alt = {"component_id": "comp-video-1", "unit_id": "unit-1",
               "title": "וידאו", "media_format": "Video"}
        with (
            patch("app.services.events.get_recent_events", new=AsyncMock(return_value=fails)),
            patch("app.services.kata_catalog.ensure_loaded", new=AsyncMock(return_value=None)),
            patch("app.services.content_catalog.alternate_representation", return_value=alt),
            patch("app.services.triggers._publish"),
        ):
            trigger = await triggers.evaluate("misc-learner", event)
        # A repeated failure fires the representation-response trigger with the
        # concrete different-representation component attached.
        self.assertIn(trigger["type"], ("misconception", "wheel_spinning"))
        self.assertEqual(trigger["alternative"]["component_id"], "comp-video-1")


class LearningRoadmapProjectionTests(unittest.IsolatedAsyncioTestCase):
    async def test_completion_and_unlock_are_derived_from_real_evidence(self) -> None:
        unit = kata_client.normalize_unit({
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
