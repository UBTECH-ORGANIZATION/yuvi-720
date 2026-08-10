"""Phase 6 — the privacy gate the teacher assistant reads through.

This is the first thing built in Phase 6 and the reason: `view_for` raises
`AgentScopeError` for an unknown agent, so *every* assistant read fails closed
until this entry exists. That property is worth a test, because the failure mode
in the other direction — a scope entry that quietly grows an `identity` path — is
invisible at runtime and leaks a child's name into an LLM prompt.

Three exclusions are asserted explicitly rather than by counting keys, so that
adding a legitimate new readable path does not require editing this file, while
adding a forbidden one fails immediately.
"""

from __future__ import annotations

import asyncio
import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.brain import context_engine
from app.brain.context_engine import AGENT_VIEWS, AgentScopeError, view_for


def run(coro):
    return asyncio.run(coro)


FULL_BRAIN = {
    "learner_id": "kid-1",
    "identity": {"display_name": "רון", "grade": "ז", "locale": "he"},
    "profile": {
        "mapping_scores": {"numeracy": 0.31, "literacy": 0.62},
        "interests": ["football"],
    },
    "memory": {"episodes": [{"text": "told Yuvi he hates being called on in class"}]},
    "mastery": {"math·obj·frac": {"score": 0.42}},
    "progress": {"math": {"percent": 40}},
    "strengths": ["persists after a wrong answer"],
    "challenges": ["word problems"],
    "goals": [{"goal_id": "g1", "title": "finish fractions"}],
    "teacher_directives": [{"text": "go gently on word problems"}],
    "reflections_recent": [{"self_rating": 4}],
    "student_description": {"summary": "works in short bursts"},
    "current_state": {"component_id": "comp-01"},
    "wellbeing_flags": [],
    "enrollments": ["group-a"],
}


class TeacherAssistantScopeTests(unittest.TestCase):
    def test_scope_entry_exists(self):
        """Without this, every assistant tool raises AgentScopeError."""
        self.assertIn("teacher_assistant", AGENT_VIEWS)

    def test_never_reads_identity(self):
        """PII must not reach an LLM prompt (§4.1)."""
        read = AGENT_VIEWS["teacher_assistant"]["read"]
        self.assertFalse(
            [path for path in read if path == "identity" or path.startswith("identity.")],
            "teacher_assistant must not read identity — the client resolves names at render",
        )

    def test_never_reads_raw_instrument_scores(self):
        read = AGENT_VIEWS["teacher_assistant"]["read"]
        self.assertNotIn("profile.mapping_scores", read)
        self.assertNotIn("profile", read, "reading all of `profile` would pull mapping_scores back in")

    def test_never_reads_the_learners_private_memory(self):
        """The companion is not a surveillance channel (A10)."""
        read = AGENT_VIEWS["teacher_assistant"]["read"]
        self.assertFalse([path for path in read if path == "memory" or path.startswith("memory.")])

    def test_writes_nothing(self):
        """No AI write into a child's brain, jailbroken prompt or not."""
        self.assertEqual(AGENT_VIEWS["teacher_assistant"]["write"], [])

    def test_a_write_attempt_raises(self):
        with patch.object(context_engine, "get_brain", AsyncMock(return_value=dict(FULL_BRAIN))):
            with self.assertRaises(AgentScopeError):
                run(context_engine.apply_writes(
                    "teacher_assistant", "kid-1", {"challenges": ["invented by an LLM"]},
                ))

    def test_the_projected_view_actually_excludes_the_three(self):
        """The allow-list is the contract; this asserts the projection honours it."""
        with patch.object(context_engine, "get_brain", AsyncMock(return_value=dict(FULL_BRAIN))):
            view = run(view_for("teacher_assistant", "kid-1"))

        self.assertNotIn("identity", view)
        self.assertNotIn("memory", view)
        self.assertNotIn("mapping_scores", (view.get("profile") or {}))

        serialized = repr(view)
        self.assertNotIn("רון", serialized, "the learner's name leaked into the assistant view")
        self.assertNotIn("hates being called on", serialized, "private memory leaked")

    def test_the_view_carries_what_the_assistant_needs(self):
        """A gate that excludes everything is also a bug — the teacher gets nothing."""
        with patch.object(context_engine, "get_brain", AsyncMock(return_value=dict(FULL_BRAIN))):
            view = run(view_for("teacher_assistant", "kid-1"))

        for path in ("mastery", "progress", "strengths", "challenges", "goals",
                     "student_description", "reflections_recent", "teacher_directives"):
            self.assertIn(path, view, f"assistant cannot answer without `{path}`")


class GoalSuggestionGroundingTests(unittest.TestCase):
    """Phase 5's teacher goal suggestions read through this same gate.

    They were written against a scope entry that did not exist yet and swallowed
    the resulting `AgentScopeError`, so they ran ungrounded. This asserts the
    error is no longer swallowed — a missing scope must fail loudly.
    """

    def test_scope_error_is_not_swallowed(self):
        from app.services import mentoring_assist

        async def boom(agent, learner_id):
            raise AgentScopeError("unknown agent scope: 'teacher_assistant'")

        with patch("app.brain.context_engine.view_for", boom):
            with self.assertRaises(AgentScopeError):
                run(mentoring_assist.suggest_goals_for_teacher(
                    "kid-1", "teacher-1", language="he",
                ))

    def test_a_brain_read_failure_still_degrades_gracefully(self):
        """A DB blip must not take the teacher's goal composer down with it."""
        from app.services import mentoring_assist

        async def blip(agent, learner_id):
            raise RuntimeError("cosmos timeout")

        insights_stub = AsyncMock(return_value={
            "mastery_gaps": [], "challenges": [], "student_description": {},
        })
        with patch("app.brain.context_engine.view_for", blip), \
             patch("app.services.insights.student_insights", insights_stub):
            drafts = run(mentoring_assist.suggest_goals_for_teacher(
                "kid-1", "teacher-1", language="he",
            ))

        # It degrades to the honest card, not to invented goals — with no brain and
        # no insights there is nothing to ground a suggestion in, and saying so is
        # the correct output (anti-hallucination layer 3: explicit emptiness).
        self.assertIsInstance(drafts, list)
        self.assertTrue(drafts, "a failure must still return a card, not an empty list")
        self.assertTrue(all(d.get("unavailable") for d in drafts))
        self.assertTrue(all(d.get("because", {}).get("raw") for d in drafts),
                        "even the unavailable card states why")


if __name__ == "__main__":
    unittest.main()
