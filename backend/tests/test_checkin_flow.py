"""The daily check-in's contract (#452).

The FIRST test is the reason `today_school_date` exists: day boundaries are
the school's, and a UTC comparison gives the wrong answer for every login
between 21:00 UTC and Israeli midnight.
"""

from __future__ import annotations

import unittest
from unittest.mock import AsyncMock, patch

from app.brain.context_engine import AgentScopeError, apply_writes, today_valid_feeling
from app.brain.schema import flatten_updates
from app.services import checkin_flow


def _no_db():
    # The service binds `_get_collection_named` at import, so the patch must
    # land on the BOUND name — patching the repository module leaves the flow
    # talking to the real database.
    return patch("app.services.checkin_flow._get_collection_named", return_value=None)


class DueRuleTest(unittest.IsolatedAsyncioTestCase):
    """Show until today's check-in is ANSWERED or SKIPPED — never again after
    either, never before the next Israeli day."""

    def setUp(self):
        checkin_flow.reset_for_tests()

    async def test_no_doc_today_means_due(self):
        with patch("app.services.checkin_flow.today_school_date",
                   return_value="2026-08-19"), _no_db():
            self.assertTrue(await checkin_flow.is_due("kid"))

    async def test_a_started_but_unanswered_checkin_is_still_due(self):
        """A crashed tab must not eat the day's ask: an open doc with no
        feeling and no recorded skip re-offers (and `start` resumes it)."""
        with patch("app.services.checkin_flow.today_school_date",
                   return_value="2026-08-19"), \
             patch.object(checkin_flow, "_last_session_evidence",
                          new=AsyncMock(return_value={})), _no_db():
            started = await checkin_flow.start("kid", "he")
            self.assertTrue(await checkin_flow.is_due("kid"))
            resumed = await checkin_flow.start("kid", "he")
            self.assertEqual(started["_id"], resumed["_id"])

    async def test_a_skip_silences_the_rest_of_the_day(self):
        store = AsyncMock()
        with patch("app.services.checkin_flow.today_school_date",
                   return_value="2026-08-19"), \
             patch.object(checkin_flow, "_last_session_evidence",
                          new=AsyncMock(return_value={})), \
             patch("app.agents.reflection.store_reflection", new=store), _no_db():
            doc = await checkin_flow.start("kid", "he")
            await checkin_flow.record_skip(doc["_id"], "kid", ["feeling"])
            self.assertFalse(await checkin_flow.is_due("kid"))

    async def test_an_answer_silences_the_rest_of_the_day(self):
        with patch("app.services.checkin_flow.today_school_date",
                   return_value="2026-08-19"), \
             patch.object(checkin_flow, "_last_session_evidence",
                          new=AsyncMock(return_value={})), \
             patch("app.services.checkin_flow.apply_writes", new=AsyncMock()), \
             patch("app.agents.reflection.store_reflection", new=AsyncMock()), \
             patch("app.services.checkin_flow.call_llm",
                   new=AsyncMock(side_effect=RuntimeError("model down"))), _no_db():
            doc = await checkin_flow.start("kid", "he")
            await checkin_flow.record_feeling(doc["_id"], "kid", "good", "calm", "he")
            self.assertFalse(await checkin_flow.is_due("kid"))

    async def test_yesterdays_skip_does_not_cover_today(self):
        """The day boundary is the ISRAELI calendar's (`today_school_date`),
        so a skip recorded yesterday leaves today due again."""
        store = AsyncMock()
        with patch.object(checkin_flow, "_last_session_evidence",
                          new=AsyncMock(return_value={})), \
             patch("app.agents.reflection.store_reflection", new=store), _no_db():
            with patch("app.services.checkin_flow.today_school_date",
                       return_value="2026-08-18"):
                doc = await checkin_flow.start("kid", "he")
                await checkin_flow.record_skip(doc["_id"], "kid", ["feeling"])
                self.assertFalse(await checkin_flow.is_due("kid"))
            with patch("app.services.checkin_flow.today_school_date",
                       return_value="2026-08-19"):
                self.assertTrue(await checkin_flow.is_due("kid"))

    async def test_the_environment_kill_switch_holds_the_gate_shut(self):
        with patch.dict("os.environ", {"DAILY_CHECKIN_DISABLED": "1"}), _no_db():
            self.assertFalse(await checkin_flow.is_due("kid"))


class StartTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        checkin_flow.reset_for_tests()

    async def test_start_is_idempotent_per_day(self):
        with patch("app.services.checkin_flow.today_school_date",
                   return_value="2026-08-19"), \
             patch.object(checkin_flow, "_last_session_evidence",
                          new=AsyncMock(return_value={})), _no_db():
            first = await checkin_flow.start("kid", "he")
            second = await checkin_flow.start("kid", "he")
        self.assertEqual(first["_id"], second["_id"])
        self.assertEqual(first["_id"], "checkin:kid:2026-08-19")

    async def test_no_evidence_means_zero_questions(self):
        """A learner with nothing scored last time gets a two-step dialog —
        no fabricated look-back, and no LLM call to invent one."""
        with patch.object(checkin_flow, "_last_session_evidence",
                          new=AsyncMock(return_value={})), \
             patch("app.services.checkin_flow.call_llm",
                   new=AsyncMock(side_effect=AssertionError("no LLM without evidence"))), \
             _no_db():
            doc = await checkin_flow.start("kid", "he")
        self.assertEqual(doc["questions"], [])

    async def test_evidence_without_wrong_answers_also_asks_nothing(self):
        with patch.object(checkin_flow, "_last_session_evidence",
                          new=AsyncMock(return_value={"scored_count": 5, "wrong_count": 0})), \
             _no_db():
            doc = await checkin_flow.start("kid", "he")
        self.assertEqual(doc["questions"], [])


class FallbackTest(unittest.IsolatedAsyncioTestCase):
    """The dialog must never be empty-mouthed: every LLM path has a literal."""

    async def test_step0_falls_back_in_every_language(self):
        for language in ("he", "ar", "en"):
            with self.subTest(language=language), \
                 patch("app.services.checkin_flow.call_llm",
                       new=AsyncMock(side_effect=RuntimeError("model down"))):
                questions = await checkin_flow._step0_questions(
                    "kid", {"wrong_count": 2, "misconceptions": ["m1"]}, language)
            self.assertEqual(len(questions), 1)
            self.assertGreater(len(questions[0]["text"]), 10)

    async def test_closing_line_falls_back_per_valence_and_language(self):
        for valence in checkin_flow.VALENCES:
            for language in ("he", "ar", "en"):
                with self.subTest(valence=valence, language=language), \
                     patch("app.services.checkin_flow.call_llm",
                           new=AsyncMock(side_effect=RuntimeError("model down"))):
                    line = await checkin_flow._closing_line(
                        "kid", valence, checkin_flow.VALENCE_FEELINGS[valence][0], language)
                self.assertGreater(len(line), 10)


class FeelingTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        checkin_flow.reset_for_tests()

    async def _started(self):
        with patch("app.services.checkin_flow.today_school_date",
                   return_value="2026-08-19"), \
             patch.object(checkin_flow, "_last_session_evidence",
                          new=AsyncMock(return_value={})), _no_db():
            return await checkin_flow.start("kid", "he")

    async def test_the_vocabulary_is_closed(self):
        doc = await self._started()
        with self.assertRaises(checkin_flow.CheckinError), _no_db():
            await checkin_flow.record_feeling(doc["_id"], "kid", "great", "smug", "he")
        with self.assertRaises(checkin_flow.CheckinError), _no_db():
            await checkin_flow.record_feeling(doc["_id"], "kid", "meh", "fine", "he")

    async def test_feeling_writes_brain_and_reflection_once(self):
        doc = await self._started()
        writes = AsyncMock()
        store = AsyncMock()
        with patch("app.services.checkin_flow.apply_writes", new=writes), \
             patch("app.agents.reflection.store_reflection", new=store), \
             patch("app.services.checkin_flow.call_llm",
                   new=AsyncMock(side_effect=RuntimeError("model down"))), \
             patch("app.services.checkin_flow.today_school_date",
                   return_value="2026-08-19"), _no_db():
            result = await checkin_flow.record_feeling(
                doc["_id"], "kid", "uneasy", "worried", "he")
            # A completion after the feeling must not store a second reflection.
            await checkin_flow.complete(doc["_id"], "kid")

        agent, learner, updates = writes.await_args.args
        self.assertEqual((agent, learner), ("checkin", "kid"))
        feeling = updates["current_state"]["daily_feeling"]
        self.assertEqual(feeling["valence"], "uneasy")
        self.assertEqual(feeling["feeling"], "worried")
        self.assertEqual(feeling["date"], "2026-08-19")
        self.assertEqual(store.await_count, 1)
        self.assertEqual(store.await_args.kwargs["meta"], {
            "valence": "uneasy", "feeling": "worried",
            "skipped": False, "step0_answered": False,
        })
        self.assertTrue(result["closing_line"])

    async def test_a_skipped_feeling_is_data(self):
        doc = await self._started()
        store = AsyncMock()
        with patch("app.agents.reflection.store_reflection", new=store), _no_db():
            result = await checkin_flow.record_skip(doc["_id"], "kid", ["feeling"])
        self.assertEqual(result["status"], "skipped")
        self.assertEqual(store.await_args.kwargs["meta"]["skipped"], True)
        self.assertIsNone(store.await_args.kwargs["meta"]["valence"])

    async def test_another_learner_cannot_touch_the_doc(self):
        doc = await self._started()
        with self.assertRaises(checkin_flow.CheckinError), _no_db():
            await checkin_flow.record_feeling(doc["_id"], "intruder", "good", "calm", "he")


class ScopeTest(unittest.IsolatedAsyncioTestCase):
    async def test_checkin_may_write_only_the_daily_feeling(self):
        with self.assertRaises(AgentScopeError):
            await apply_writes("checkin", "kid", {"mastery": {"x": 1}})
        with self.assertRaises(AgentScopeError):
            await apply_writes("checkin", "kid", {"current_state": {"component_id": "c"}})

    def test_a_pedagogical_write_cannot_clobber_the_feeling(self):
        """The planner writes `current_state` keys; flattening must produce
        dotted sibling sets that leave `daily_feeling` untouched, and the
        feeling itself must flatten WHOLE (opaque leaf, WriteError-28 rule)."""
        flat = flatten_updates({"current_state": {"component_id": "c", "pace": "slow"}})
        self.assertNotIn("current_state.daily_feeling", flat)
        self.assertEqual(set(flat), {"current_state.component_id", "current_state.pace"})
        whole = flatten_updates({"current_state": {"daily_feeling": {"valence": "good"}}})
        self.assertEqual(set(whole), {"current_state.daily_feeling"})


class ExpiryTest(unittest.TestCase):
    def test_the_feeling_dies_at_the_israeli_midnight(self):
        with patch("app.brain.context_engine._today_school_date",
                   return_value="2026-08-19"):
            today = {"valence": "good", "feeling": "calm", "date": "2026-08-19"}
            self.assertEqual(today_valid_feeling(today), today)
            self.assertIsNone(today_valid_feeling({**today, "date": "2026-08-18"}))
            self.assertIsNone(today_valid_feeling(None))


if __name__ == "__main__":
    unittest.main()
