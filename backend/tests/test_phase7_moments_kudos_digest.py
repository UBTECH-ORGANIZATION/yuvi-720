"""Phase 7 — moments, kudos, the weekly digest, and meeting prep.

The sharp edges here are different from the earlier phases:

* A **moment** is an inference ("recovered"), so it must carry the events it was
  inferred from, and it must never be invented from thin data.
* **Kudos** puts words in a teacher's mouth, delivered by a companion a child
  trusts. The client must not be able to author them, and they must not be
  delivered twice.
* A **digest** is the easiest surface in the product on which to drift into
  pleasant, unfalsifiable narration. Every bullet must cite a number.
"""

from __future__ import annotations

import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services import kudos, moments, weekly_digest


def _iso(days_ago: float = 0) -> str:
    return (datetime.now(timezone.utc) - timedelta(days=days_ago)).isoformat()


def _event(**kwargs):
    base = {
        "_id": kwargs.pop("_id", "e1"),
        "learner_id": "kid-a",
        "verb": "answered",
        "objective_id": "math.frac",
        "effortful": True,
        "occurred_at": kwargs.pop("occurred_at", _iso(1)),
        "result": {"success": kwargs.pop("success", True)},
    }
    base.update(kwargs)
    return base


class _Catalog:
    """kata_catalog stubbed to a readable objective title."""

    def __enter__(self):
        self.patches = [
            patch("app.services.kata_catalog.ensure_loaded", AsyncMock(return_value=None)),
            patch("app.services.kata_catalog.localized_objective_title",
                  lambda oid, lang="he": "שברים" if oid else ""),
        ]
        for item in self.patches:
            item.start()
        return self

    def __exit__(self, *exc):
        for item in self.patches:
            item.stop()


class MomentsTests(unittest.IsolatedAsyncioTestCase):
    async def _moments(self, events, brain=None):
        with _Catalog(), \
             patch("app.services.events.get_learner_events", AsyncMock(return_value=events)), \
             patch("app.brain.repository.get_brain",
                   AsyncMock(return_value=brain or {"mastery": {}})):
            return await moments.moments_for_learner("kid-a", language="he")

    async def test_a_recovery_names_the_failures_behind_it(self):
        events = [
            _event(_id="f1", success=False, occurred_at=_iso(3)),
            _event(_id="f2", success=False, occurred_at=_iso(2)),
            _event(_id="s1", success=True, occurred_at=_iso(1)),
        ]
        rows = await self._moments(events)
        recovery = [row for row in rows if row["kind"] == moments.KIND_RECOVERY]
        self.assertTrue(recovery, "a success after two failures is a recovery")
        self.assertEqual(recovery[0]["evidence"]["raw"]["failures_before"], 2)

    async def test_a_success_with_no_failures_is_not_a_recovery(self):
        """The feed must not narrate an ordinary correct answer as a comeback."""
        rows = await self._moments([_event(_id="s1", success=True)])
        self.assertEqual([r for r in rows if r["kind"] == moments.KIND_RECOVERY], [])

    async def test_every_moment_carries_raw_evidence(self):
        """C4 — a moment is an inference and must show its working."""
        events = [
            _event(_id="f1", success=False, occurred_at=_iso(9)),
            _event(_id="f2", success=False, occurred_at=_iso(8.9)),
            _event(_id="s1", success=True, occurred_at=_iso(1)),   # also a comeback
        ]
        rows = await self._moments(events)
        self.assertTrue(rows)
        for row in rows:
            self.assertTrue(row["evidence"]["raw"], f"{row['kind']} has no raw datum")

    async def test_a_gap_in_activity_becomes_a_comeback(self):
        events = [
            _event(_id="a", success=True, occurred_at=_iso(12)),
            _event(_id="b", success=True, occurred_at=_iso(1)),
        ]
        rows = await self._moments(events)
        comeback = [row for row in rows if row["kind"] == moments.KIND_COMEBACK]
        self.assertTrue(comeback)
        self.assertGreaterEqual(comeback[0]["evidence"]["raw"]["days_away"],
                                moments.COMEBACK_GAP_DAYS)

    async def test_a_short_break_is_not_a_comeback(self):
        events = [
            _event(_id="a", success=True, occurred_at=_iso(2)),
            _event(_id="b", success=True, occurred_at=_iso(1)),
        ]
        rows = await self._moments(events)
        self.assertEqual([r for r in rows if r["kind"] == moments.KIND_COMEBACK], [])

    async def test_moments_are_newest_first(self):
        events = [
            _event(_id="a", success=False, occurred_at=_iso(10)),
            _event(_id="b", success=False, occurred_at=_iso(9)),
            _event(_id="c", success=True, occurred_at=_iso(8)),
            _event(_id="d", success=False, occurred_at=_iso(3)),
            _event(_id="e", success=False, occurred_at=_iso(2)),
            _event(_id="f", success=True, occurred_at=_iso(1)),
        ]
        rows = await self._moments(events)
        stamps = [row["at"] for row in rows]
        self.assertEqual(stamps, sorted(stamps, reverse=True))

    async def test_no_events_means_no_moments_rather_than_an_invented_one(self):
        self.assertEqual(await self._moments([]), [])

    async def test_text_is_a_key_and_params_never_a_rendered_sentence(self):
        """A teacher can switch language; a stored sentence would be frozen."""
        events = [
            _event(_id="f1", success=False, occurred_at=_iso(3)),
            _event(_id="f2", success=False, occurred_at=_iso(2)),
            _event(_id="s1", success=True, occurred_at=_iso(1)),
        ]
        for row in await self._moments(events):
            self.assertTrue(row["text_key"].startswith("tch.moment."))
            self.assertIsInstance(row["params"], dict)

    async def test_a_group_feed_never_ranks_learners(self):
        """C5 — merged by time, and each row speaks about one child only."""
        events = [
            _event(_id="f1", success=False, occurred_at=_iso(3)),
            _event(_id="f2", success=False, occurred_at=_iso(2)),
            _event(_id="s1", success=True, occurred_at=_iso(1)),
        ]
        with _Catalog(), \
             patch("app.brain.org.learners_in_group",
                   AsyncMock(return_value=["kid-a", "kid-b"])), \
             patch("app.services.events.get_learner_events", AsyncMock(return_value=events)), \
             patch("app.brain.repository.get_brain", AsyncMock(return_value={"mastery": {}})):
            rows = await moments.moments_for_group("group-1", language="he")

        self.assertTrue(rows)
        stamps = [row["at"] for row in rows]
        self.assertEqual(stamps, sorted(stamps, reverse=True))
        for row in rows:
            # One learner per row; no row pairs two children.
            self.assertIn("learner_id", row)
            self.assertIsInstance(row["learner_id"], str)

    async def test_one_learners_bad_data_does_not_break_the_group_feed(self):
        async def flaky(learner_id, **kwargs):
            if learner_id == "kid-b":
                raise RuntimeError("bad row")
            return [_event(_id="a", success=True, occurred_at=_iso(9)),
                    _event(_id="b", success=True, occurred_at=_iso(1))]

        with _Catalog(), \
             patch("app.brain.org.learners_in_group",
                   AsyncMock(return_value=["kid-a", "kid-b"])), \
             patch("app.services.events.get_learner_events", flaky), \
             patch("app.brain.repository.get_brain", AsyncMock(return_value={"mastery": {}})):
            rows = await moments.moments_for_group("group-1", language="he")

        self.assertTrue(rows, "kid-a's moments were lost to kid-b's failure")


class _KudosStore:
    """A tiny in-memory stand-in for the kudos collection."""

    def __init__(self):
        self.rows: list[dict] = []

    async def insert_one(self, document):
        self.rows.append(dict(document))

    async def find_one(self, query):
        for row in self.rows:
            if all(row.get(key) == value for key, value in query.items()):
                return row
        return None

    def find(self, query):
        matched = [
            row for row in self.rows
            if row.get("learner_id") == query.get("learner_id")
            and row.get("delivered_at") == query.get("delivered_at")
        ]
        store = self

        class _Cursor:
            def sort(self, *_a, **_k): return self
            def limit(self, *_a, **_k): return self
            async def to_list(self, length=None):
                return sorted(matched, key=lambda r: r["created_at"])[:length or len(matched)]

        return _Cursor()

    async def update_one(self, query, update):
        class _Result:
            modified_count = 0
        result = _Result()
        for row in self.rows:
            if row["_id"] == query["_id"] and row.get("delivered_at") == query.get("delivered_at"):
                row.update(update["$set"])
                result.modified_count = 1
                break
        return result

    async def create_index(self, *_a, **_k):
        return None


class KudosTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.store = _KudosStore()
        self._patch = patch.object(kudos, "_collection", lambda: self.store)
        self._patch.start()

    def tearDown(self):
        self._patch.stop()

    async def _send(self, message="כל הכבוד על ההתמדה", teacher="teacher-a"):
        with patch("app.brain.org.teacher_can_access_learner", AsyncMock(return_value=True)), \
             patch("app.services.notifications.notify", AsyncMock()) as notify, \
             patch("app.services.realtime.publish") as publish, \
             patch("app.agents.safety.screen_output", lambda text, lang: type("S", (), {"text": text})):
            record = await kudos.send_kudos(teacher, "kid-a", message)
        return record, notify, publish

    async def test_sending_rings_the_bell_and_nudges_the_chat(self):
        """Both lanes: the bell survives being offline, the nudge speaks now."""
        _, notify, publish = await self._send()
        notify.assert_awaited_once()
        publish.assert_called_once()
        topic, payload = publish.call_args[0]
        self.assertEqual(topic, "learner:kid-a")
        self.assertEqual(payload["type"], "kudos")

    async def test_the_nudge_carries_no_message_text(self):
        """The client is told there is praise, never what it says."""
        _, _, publish = await self._send(message="מילים של המורה")
        _, payload = publish.call_args[0]
        self.assertNotIn("message", payload)
        self.assertNotIn("מילים של המורה", repr(payload))

    async def test_a_teacher_outside_the_group_cannot_send(self):
        with patch("app.brain.org.teacher_can_access_learner", AsyncMock(return_value=False)):
            with self.assertRaises(kudos.KudosError) as caught:
                await kudos.send_kudos("outsider", "kid-a", "היי")
        self.assertEqual(caught.exception.code, "not_authorized")

    async def test_an_empty_message_is_refused(self):
        with patch("app.brain.org.teacher_can_access_learner", AsyncMock(return_value=True)):
            with self.assertRaises(kudos.KudosError) as caught:
                await kudos.send_kudos("teacher-a", "kid-a", "   ")
        self.assertEqual(caught.exception.code, "message_required")

    async def test_praise_is_shown_exactly_once(self):
        """A reload must not show a child the same praise card twice."""
        await self._send()
        pending = await kudos.pending_for("kid-a")
        self.assertIsNotNone(pending)
        await kudos.acknowledge("kid-a", pending["_id"])
        self.assertIsNone(await kudos.pending_for("kid-a"),
                          "the same kudos was offered twice")

    async def test_the_card_carries_the_teachers_actual_words(self):
        await self._send(message="ראיתי שהתאוששת בשברים")
        pending = await kudos.pending_for("kid-a")
        self.assertEqual(pending["message"], "ראיתי שהתאוששת בשברים")

    async def test_nothing_pending_shows_nothing(self):
        self.assertIsNone(await kudos.pending_for("kid-a"))

    async def test_two_kudos_arrive_in_the_order_they_were_sent(self):
        await self._send(message="ראשון")
        await self._send(message="שני")
        first = await kudos.pending_for("kid-a")
        self.assertEqual(first["message"], "ראשון")
        await kudos.acknowledge("kid-a", first["_id"])
        self.assertEqual((await kudos.pending_for("kid-a"))["message"], "שני")

    async def test_another_learner_cannot_acknowledge_your_praise(self):
        """The id reaches the client, so ownership is a filter, not a guess."""
        await self._send(message="שלך")
        pending = await kudos.pending_for("kid-a")
        self.assertIsNone(await kudos.acknowledge("kid-b", pending["_id"]))
        self.assertIsNotNone(await kudos.pending_for("kid-a"))

    async def test_acknowledging_twice_is_a_no_op(self):
        await self._send()
        pending = await kudos.pending_for("kid-a")
        self.assertIsNotNone(await kudos.acknowledge("kid-a", pending["_id"]))
        self.assertIsNotNone(await kudos.acknowledge("kid-a", pending["_id"]))
        self.assertIsNone(await kudos.pending_for("kid-a"))


class DigestTests(unittest.IsolatedAsyncioTestCase):
    FACTS = {
        "students_total": 12, "active_last_7d": 10, "needing_attention": 7,
        "objectives_mastered_total": 3, "active_pct": 83, "avg_active_minutes": 4.8,
        "timing_available": True,
        "gaps": [{"label": "שברים", "struggling_count": 6, "with_evidence": 12, "kind": "gap"}],
        "moment_counts": {"recovery": 2},
    }

    async def test_the_fallback_is_a_real_digest_not_a_placeholder(self):
        """With no LLM the panel must still say three useful things."""
        with patch.object(weekly_digest, "_gather_facts", AsyncMock(return_value=self.FACTS)), \
             patch.object(weekly_digest, "_load", AsyncMock(return_value=None)), \
             patch.object(weekly_digest, "_store", AsyncMock()), \
             patch("app.services.llm.call_llm", AsyncMock(return_value=None)):
            digest = await weekly_digest.get_digest("group-1", language="he")

        self.assertEqual(digest["source"], "fallback")
        self.assertTrue(digest["bullets"])
        for bullet in digest["bullets"]:
            self.assertTrue(bullet["because"]["raw"], "a bullet with no datum behind it")

    async def test_a_bullet_with_no_cited_signal_is_dropped(self):
        """Unfalsifiable narration is exactly what this panel must not produce."""
        payload = ('{"bullets": ['
                   '{"text": "הכיתה בתנופה יפה"},'
                   '{"text": "10 מתוך 12 היו פעילים", "because": {"signal": "active_last_7d", "value": 10}}'
                   ']}')
        with patch.object(weekly_digest, "_gather_facts", AsyncMock(return_value=self.FACTS)), \
             patch.object(weekly_digest, "_load", AsyncMock(return_value=None)), \
             patch.object(weekly_digest, "_store", AsyncMock()), \
             patch("app.services.llm.call_llm", AsyncMock(return_value=payload)):
            digest = await weekly_digest.get_digest("group-1", language="he")

        texts = [bullet.get("text") for bullet in digest["bullets"]]
        self.assertNotIn("הכיתה בתנופה יפה", texts)
        self.assertIn("10 מתוך 12 היו פעילים", texts)

    async def test_an_empty_group_says_so_rather_than_reporting_zeros(self):
        with patch.object(weekly_digest, "_gather_facts",
                          AsyncMock(return_value={"students_total": 0})), \
             patch.object(weekly_digest, "_load", AsyncMock(return_value=None)):
            digest = await weekly_digest.get_digest("group-1", language="he")

        self.assertEqual(digest["bullets"], [])
        self.assertEqual(digest["reason"], "group_has_no_students")

    async def test_the_cache_is_used_and_costs_no_llm_call(self):
        cached = {"bullets": [{"text": "x", "because": {"signal": "a", "value": 1, "raw": {}}}],
                  "generated_at": "2026-08-04T00:00:00+00:00", "source": "ai"}
        llm = AsyncMock()
        with patch.object(weekly_digest, "_load", AsyncMock(return_value=cached)), \
             patch("app.services.llm.call_llm", llm):
            digest = await weekly_digest.get_digest("group-1", language="he")

        self.assertTrue(digest["cached"])
        llm.assert_not_awaited()

    def test_the_cache_key_is_the_iso_week(self):
        monday = datetime(2026, 8, 3, tzinfo=timezone.utc)
        sunday = datetime(2026, 8, 9, tzinfo=timezone.utc)
        next_monday = datetime(2026, 8, 10, tzinfo=timezone.utc)
        self.assertEqual(weekly_digest.week_key(monday), weekly_digest.week_key(sunday))
        self.assertNotEqual(weekly_digest.week_key(sunday), weekly_digest.week_key(next_monday))


class MeetingPrepTests(unittest.IsolatedAsyncioTestCase):
    async def test_no_observations_produces_an_honest_card(self):
        from app.services import mentoring_assist

        with patch("app.brain.context_engine.view_for", AsyncMock(return_value={})), \
             patch("app.services.insights.student_insights",
                   AsyncMock(return_value={"struggle_items": [], "strengths_detail": []})):
            prep = await mentoring_assist.suggest_meeting_prep("kid-a", "teacher-a")

        self.assertTrue(prep["unavailable"])
        self.assertTrue(prep["because"]["raw"])
        self.assertEqual(prep["questions"], [])

    async def test_the_fallback_produces_questions_grounded_in_struggles(self):
        from app.services import mentoring_assist

        insights_payload = {
            "struggle_items": [{"objective_id": "math.frac", "label": "שברים",
                                "evidence": {"attempts": 5}}],
            "strengths_detail": [],
        }
        with patch("app.brain.context_engine.view_for", AsyncMock(return_value={})), \
             patch("app.services.insights.student_insights",
                   AsyncMock(return_value=insights_payload)), \
             patch("app.services.mentoring_assist.call_llm", AsyncMock(return_value=None)):
            prep = await mentoring_assist.suggest_meeting_prep("kid-a", "teacher-a")

        self.assertTrue(prep["questions"])
        for row in prep["questions"] + prep["goal_ideas"]:
            self.assertTrue(row["because"]["raw"], "a suggestion with nothing behind it")

    async def test_a_suggestion_citing_an_unknown_signal_is_dropped(self):
        """The model must not attribute a question to an observation we never made."""
        from app.services import mentoring_assist

        payload = ('{"questions": ['
                   '{"text": "למה נעדרת מהמבחן?", "signal": "attendance"},'
                   '{"text": "מה הכי קשה בשברים?", "signal": "struggle_items"}'
                   '], "insights": [], "goal_ideas": []}')
        insights_payload = {
            "struggle_items": [{"objective_id": "math.frac", "label": "שברים",
                                "evidence": {"attempts": 5}}],
            "strengths_detail": [],
        }
        with patch("app.brain.context_engine.view_for", AsyncMock(return_value={})), \
             patch("app.services.insights.student_insights",
                   AsyncMock(return_value=insights_payload)), \
             patch("app.services.mentoring_assist.call_llm", AsyncMock(return_value=payload)), \
             patch("app.agents.safety.screen_output",
                   lambda text, lang: type("S", (), {"text": text})):
            prep = await mentoring_assist.suggest_meeting_prep("kid-a", "teacher-a")

        texts = [row["text"] for row in prep["questions"]]
        self.assertNotIn("למה נעדרת מהמבחן?", texts)
        self.assertIn("מה הכי קשה בשברים?", texts)


if __name__ == "__main__":
    unittest.main()


class EmptyDescriptionTests(unittest.TestCase):
    """The brain always returns the `student_description` container.

    A plain truthiness check on it passes for a learner nobody has observed, so
    the honest "no evidence" card never fired and the model was asked to invent
    a goal from nothing.
    """

    def test_the_empty_container_does_not_count_as_evidence(self):
        from app.services.mentoring_assist import _has_description

        empty = {"blocks": {"learning_preferences": [], "motivational_patterns": [],
                            "what_frustrates": [], "how_to_reach": []},
                 "text": None, "stale": False, "events_since_generation": 0}
        self.assertFalse(_has_description(empty))
        self.assertFalse(_has_description({}))
        self.assertFalse(_has_description(""))
        self.assertFalse(_has_description(None))

    def test_real_content_does_count(self):
        from app.services.mentoring_assist import _has_description

        self.assertTrue(_has_description({"text": "works in short bursts", "blocks": {}}))
        self.assertTrue(_has_description(
            {"text": None, "blocks": {"how_to_reach": ["football examples"]}}))
        self.assertTrue(_has_description("works in short bursts"))


class NoEvidenceCardTests(unittest.IsolatedAsyncioTestCase):
    async def test_a_learner_with_no_observations_gets_the_honest_card(self):
        from app.services import mentoring_assist

        empty_description = {"blocks": {"how_to_reach": []}, "text": None}
        llm = AsyncMock()
        with patch("app.brain.context_engine.view_for",
                   AsyncMock(return_value={"student_description": empty_description})), \
             patch("app.services.insights.student_insights",
                   AsyncMock(return_value={"struggle_items": [], "strengths_detail": []})), \
             patch("app.services.mentoring_assist.call_llm", llm):
            drafts = await mentoring_assist.suggest_goals_for_teacher("kid-a", "teacher-a")

        self.assertTrue(all(d.get("unavailable") for d in drafts))
        llm.assert_not_awaited()   # and it costs nothing to say "I don't know"
