"""Learner-coach batch 5 (#522, #524, #525, #527).

Three of the four reports share one root: a turn that died before its first
word. The distress branch of the safety gate named `prompt_text`, a variable
resolved only after the gate, so a message like "הלב דופק מהר בהתרגשות ופחד"
raised UnboundLocalError, the SSE stream broke, and the client painted '…' —
the typing indicator — for a reply that would never come.
"""

from __future__ import annotations

import asyncio
import os
import sys
import unittest
from unittest import mock
from unittest.mock import AsyncMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.agents import coach, safety  # noqa: E402
from app.brain import context_engine  # noqa: E402
from app.routes import agent as agent_routes  # noqa: E402
from app.services import answer_diagnostics, triggers  # noqa: E402


class ADistressDisclosureStillGetsAnAnswer(unittest.IsolatedAsyncioTestCase):
    async def test_the_wellbeing_flag_is_written_with_the_screened_message(self):
        message = "הלב דופק מהר בהתרגשות ופחד"
        with patch.object(coach.safety, "classify_disclosure", new=AsyncMock(return_value="distress")), \
             patch.object(coach.safety, "record_wellbeing_flag", new=AsyncMock()) as flag, \
             patch.object(coach.sessions, "get_recent", new=AsyncMock(return_value=[])):
            streamed = [
                piece async for piece in coach.run_coach_stream(
                    "test-learner", user_message=message, language="he", session_id="s-distress",
                )
            ]
        self.assertEqual("".join(streamed), safety.redirect_message("distress", "he"))
        flag.assert_awaited_once()
        self.assertEqual(flag.await_args.kwargs["evidence"], message)


class AReplyThatDiesBeforeSpeakingSaysSo(unittest.IsolatedAsyncioTestCase):
    async def _collect(self, gen):
        trace: list = []
        out = [c async for c in agent_routes._guarded_reply(gen, language="he", exchange_id="x1", debug_trace=trace)]
        return out, trace

    async def test_a_crash_before_the_first_word_becomes_a_sentence(self):
        async def broken():
            raise NameError("prompt_text")
            yield  # pragma: no cover

        out, trace = await self._collect(broken())
        self.assertEqual(out, [agent_routes.REPLY_FAILED["he"]])
        self.assertEqual(trace[-1]["name"], "reply_failed")

    async def test_a_crash_after_speaking_keeps_what_was_said(self):
        async def half():
            yield "חצי תשובה"
            raise RuntimeError("provider closed")

        out, _ = await self._collect(half())
        self.assertEqual(out, ["חצי תשובה"])

    async def test_a_healthy_reply_is_untouched(self):
        async def fine():
            yield "א"
            yield "ב"

        out, trace = await self._collect(fine())
        self.assertEqual(out, ["א", "ב"])
        self.assertEqual(trace, [])


class PartialCreditIsNotACelebration(unittest.IsolatedAsyncioTestCase):
    """#525: CET accepted "3, ימינה, 2, למעלה" with success=true, scaled=0.75,
    showed the child "עוד קצת", and Yuvi said "יפה מאוד … 2 למטה"."""

    COMP = "CET.MATH.G7.NUM.COORD-SYS-A.POS-NUM.INTRO-00003"

    def setUp(self):
        triggers._last_published.clear()
        triggers._last_partial_key.clear()
        triggers._success_acknowledged.clear()
        self.published: list[dict] = []
        patches = [
            patch("app.services.events.get_recent_events", new=AsyncMock(return_value=[])),
            patch("app.services.events.get_session_events", new=AsyncMock(return_value=[])),
            patch("app.services.events.is_component_completion", return_value=False),
            patch("app.brain.repository.get_brain", new=AsyncMock(return_value={"current_state": {}})),
            patch("app.brain.repository.apply_brain_operators", new=AsyncMock()),
            patch.object(triggers, "_publish", lambda _lid, trigger: self.published.append(trigger)),
            patch.object(triggers, "_arm_idle", lambda *a, **k: None),
            patch.object(triggers, "_cancel_idle", lambda *a, **k: None),
            patch("app.services.teacher_alerts.escalate_trigger", new=AsyncMock()),
        ]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)

    def _event(self, scaled, success=True, response="3[,]ימינה[,]2[,]למעלה"):
        return {
            "_id": f"e-{scaled}", "learner_id": "L", "verb": "answered", "launch": self.COMP,
            "objective_id": "MOE.MATH.G7.NUM.COORD-SYS-A.POS-NUM.INTRO", "session_id": "s1",
            "sub_item_id": f"{self.COMP}-item-00008", "question_id": "mrncx7xk24cj6eqol",
            "object_id": "https://learning.cet.ac.il/metadata/x/mrncx7xk24cj6eqol",
            "result": {"success": success, "score_scaled": scaled, "response": response},
            "effortful": True, "timing": {},
        }

    def test_the_provider_s_accepted_three_of_four_is_partial(self):
        self.assertTrue(triggers.is_partial_success({"success": True, "score_scaled": 0.75}))
        self.assertFalse(triggers.is_partial_success({"success": True, "score_scaled": 1}))
        self.assertFalse(triggers.is_partial_success({"success": False, "score_scaled": 0.5}))
        self.assertFalse(triggers.is_partial_success({"success": True}))

    async def test_a_partial_answer_gets_the_partial_nudge_not_praise(self):
        await triggers.evaluate("L", self._event(0.75))
        kinds = [t["type"] for t in self.published]
        self.assertIn("partial", kinds)
        self.assertNotIn("success", kinds)

    async def test_the_same_question_is_nudged_once_and_a_full_answer_still_earns_praise(self):
        await triggers.evaluate("L", self._event(0.75))
        await triggers.evaluate("L", self._event(0.75))
        self.assertEqual([t["type"] for t in self.published].count("partial"), 1)
        triggers._last_published.clear()
        await triggers.evaluate("L", self._event(1, response="3[,]ימינה[,]2[,]למטה"))
        self.assertIn("success", [t["type"] for t in self.published])

    def test_the_diagnostic_reads_the_score_before_the_flag(self):
        verdict = answer_diagnostics.diagnose_answer(
            {"correctAnswers": ["3, ימינה, 2, למטה"]}, "3, ימינה, 2, למעלה",
            provider_success=True, provider_score_scaled=0.75,
        )
        self.assertEqual(verdict["outcome"], "partial")
        full = answer_diagnostics.diagnose_answer(
            {"correctAnswers": ["x"]}, "x", provider_success=True, provider_score_scaled=1,
        )
        self.assertEqual(full["outcome"], "correct")

    def test_the_partial_nudge_has_a_prompt_and_a_moe_mapping(self):
        self.assertIn("partial", coach.PROACTIVE_PROMPTS)
        self.assertIn("partial", agent_routes._MOE_TRIGGER)
        self.assertIn("partial", triggers._PRIORITY)


class TheMapTheLearnerSeesReachesTheCoach(unittest.TestCase):
    """#527: "why is my self-awareness so low?" got a generic routine."""

    def test_each_domain_is_one_line_in_the_dashboard_s_own_words(self):
        lines = context_engine._activeness_map_lines(
            {"self_awareness": 30, "growth_mindset": 80, "motivation_relevance": 50}, "he")
        self.assertEqual(len(lines), 3)
        joined = "\n".join(lines)
        self.assertIn("מודעות עצמית: כדאי לחזק", joined)
        self.assertIn("תפיסת צמיחה: מוכן/ה לאתגר", joined)
        self.assertIn("one thing to do", joined)
        self.assertNotIn("30", joined)

    def test_an_empty_map_says_nothing(self):
        self.assertEqual(context_engine._activeness_map_lines({}, "he"), [])
        self.assertEqual(context_engine._activeness_map_lines({"self_awareness": None}, "he"), [])


class TheLearnerIsAddressedInTheirOwnForm(unittest.TestCase):
    """#522: a girl was addressed as "אתה". The onboarding form knows better."""

    def _system_prompt(self, gender):
        from tests.test_coach_answer_block import _drive

        async def state(_lid=None):
            return {"gender": gender}

        with mock.patch("learner_state.get_learner_state", new=state):
            _, persisted = _drive(["נסי לחשוב על זה."], user_message="מה זה מולקולה?")
        return persisted["model_messages"][0]["content"]

    def test_a_girl_is_addressed_in_the_feminine(self):
        self.assertIn(coach.ADDRESS_FORM["he"]["female"], self._system_prompt("female"))

    def test_no_choice_means_no_rule(self):
        prompt = self._system_prompt(None)
        self.assertNotIn(coach.ADDRESS_FORM["he"]["female"], prompt)
        self.assertNotIn(coach.ADDRESS_FORM["he"]["male"], prompt)

    def test_children_s_language_rules_are_always_present(self):
        self.assertIn(coach.NATURAL_LANGUAGE_RULES["he"], self._system_prompt(None))


if __name__ == "__main__":
    unittest.main()
