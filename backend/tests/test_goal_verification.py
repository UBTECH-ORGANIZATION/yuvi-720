"""#462 — a conversational goal is verified by what was said, not how much.

Reut's line draws the boundary: "צריך שהשאלות עם יובי יהיו ענייניות ולא סתם
הודעות". These tests pin the contract: twenty empty messages satisfy nothing,
a few substantive questions satisfy the goal, the judgement is never the
teacher's, an unlabeled-but-active goal is flagged for the teacher's eye
instead of silently judged, and the nav badge counts verified-met goals the
same as summarized ones."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services import goal_progress, mentoring


ASSIGNED = "2026-08-10T08:00:00+00:00"
GOAL = {"deadline": "2026-08-17", "action": {"kind": "ask_yuvi", "target": 3}}


def _quality(label: str, at: str) -> dict:
    return {"kind": "question_quality", "at": at, "meta": {"label": label}}


def _stamps(count: int, day: int = 11) -> list[str]:
    return [f"2026-08-{day}T10:{i:02d}:00+00:00" for i in range(count)]


def _progress(goal, yuvi=(), quality=()):
    return goal_progress.progress_from_sources(
        goal, ASSIGNED, [], [], list(yuvi), list(quality))


class VerifiedNotCounted(unittest.TestCase):

    def test_many_empty_messages_satisfy_nothing(self):
        # Twenty messages, all judged off-topic or answer-fishing: the child
        # hit the old count target and earned zero.
        quality = (
            [_quality("off_topic", at) for at in _stamps(12)]
            + [_quality("answer_seeking", at) for at in _stamps(8, day=12)]
        )
        progress = _progress(GOAL, yuvi=_stamps(20), quality=quality)
        self.assertEqual(progress["count"], 0)
        self.assertFalse(progress["met"])
        self.assertFalse(progress["quality"]["uncertain"])   # judged, not unknown

    def test_a_few_substantive_questions_do_satisfy(self):
        quality = [
            _quality("conceptual", "2026-08-11T10:00:00+00:00"),
            _quality("procedural", "2026-08-12T10:00:00+00:00"),
            _quality("self_diagnostic", "2026-08-13T10:00:00+00:00"),
            _quality("off_topic", "2026-08-13T11:00:00+00:00"),
        ]
        progress = _progress(GOAL, yuvi=_stamps(4), quality=quality)
        self.assertEqual(progress["count"], 3)
        self.assertTrue(progress["met"])
        self.assertEqual(progress["quality"]["labels"]["off_topic"], 1)

    def test_labels_outside_the_window_do_not_count(self):
        quality = [
            _quality("conceptual", "2026-08-09T10:00:00+00:00"),   # before
            _quality("conceptual", "2026-08-18T10:00:00+00:00"),   # after
            _quality("conceptual", "2026-08-12T10:00:00+00:00"),
        ]
        progress = _progress(GOAL, quality=quality)
        self.assertEqual(progress["count"], 1)

    def test_enough_chat_but_no_labels_is_flagged_not_judged(self):
        # Messages predating the classifier (or a classifier outage): the
        # child visibly did the thing, the system cannot say how well. Silence
        # would recreate the chore this item removes — flag it instead.
        progress = _progress(GOAL, yuvi=_stamps(5))
        self.assertFalse(progress["met"])
        self.assertTrue(progress["quality"]["uncertain"])
        self.assertEqual(progress["quality"]["chatted"], 5)

    def test_too_little_chat_with_no_labels_is_simply_unmet(self):
        progress = _progress(GOAL, yuvi=_stamps(1))
        self.assertFalse(progress["quality"]["uncertain"])

    def test_countable_kinds_carry_no_quality_verdict(self):
        goal = {"deadline": "2026-08-17", "action": {"kind": "use_hint", "target": 1}}
        progress = goal_progress.progress_from_sources(
            goal, ASSIGNED, [{"kind": "hint", "at": "2026-08-11T10:00:00+00:00"}],
            [], [], [_quality("conceptual", "2026-08-11T10:00:00+00:00")])
        self.assertNotIn("quality", progress)
        self.assertTrue(progress["met"])


class PendingMeansEarned(unittest.TestCase):
    """One definition for inbox, assistant, and badge — now with two arms."""

    def test_summarized_unapproved_is_pending(self):
        self.assertTrue(mentoring._is_pending(
            {"progress_stage": "summarized", "approved_by": None}))

    def test_verified_met_is_pending_even_before_the_child_summarizes(self):
        self.assertTrue(mentoring._is_pending({
            "progress_stage": "progressed",
            "approved_by": None,
            "progress": {"kind": "ask_yuvi", "target": 3, "count": 3, "met": True},
        }))

    def test_unenriched_unsummarized_falls_to_the_strict_subset(self):
        self.assertFalse(mentoring._is_pending(
            {"progress_stage": "progressed", "approved_by": None,
             "action": {"kind": "ask_yuvi", "target": 3}}))

    def test_approved_or_deleted_is_never_pending(self):
        self.assertFalse(mentoring._is_pending(
            {"progress_stage": "summarized", "approved_by": "t1"}))
        self.assertFalse(mentoring._is_pending(
            {"progress_stage": "summarized", "deleted": True}))


class BadgeCountsVerifiedGoals(unittest.IsolatedAsyncioTestCase):

    async def test_the_count_verifies_action_goals_before_counting(self):
        rows = [{
            "learner_id": "kid",
            "created_at": ASSIGNED,
            "goals": [
                {"id": "g1", "progress_stage": "summarized", "approved_by": None},
                {"id": "g2", "progress_stage": "progressed", "approved_by": None,
                 "deadline": "2026-08-17",
                 "action": {"kind": "ask_yuvi", "target": 1}},
            ],
        }]

        async def enrich(_lid, conversations):
            for conversation in conversations:
                for goal in conversation["goals"]:
                    if goal.get("action"):
                        goal["progress"] = {"kind": "ask_yuvi", "target": 1,
                                            "count": 1, "met": True}

        class _Cursor:
            def __aiter__(self):
                async def _gen():
                    for row in rows:
                        yield row
                return _gen()

        collection = type("C", (), {"find": lambda self, *a, **k: _Cursor()})()
        with (
            patch.object(mentoring, "_get_collection_named", return_value=collection),
            patch("app.services.goal_progress.enrich_conversations",
                  new=AsyncMock(side_effect=enrich)),
        ):
            count = await mentoring.count_pending_approvals(["kid"])
        self.assertEqual(count, 2)   # the summarized one AND the verified one

    async def test_verification_failure_degrades_to_the_strict_count(self):
        rows = [{
            "learner_id": "kid",
            "created_at": ASSIGNED,
            "goals": [
                {"id": "g1", "progress_stage": "summarized", "approved_by": None},
                {"id": "g2", "progress_stage": "progressed", "approved_by": None,
                 "action": {"kind": "ask_yuvi", "target": 1}},
            ],
        }]

        class _Cursor:
            def __aiter__(self):
                async def _gen():
                    for row in rows:
                        yield row
                return _gen()

        collection = type("C", (), {"find": lambda self, *a, **k: _Cursor()})()
        with (
            patch.object(mentoring, "_get_collection_named", return_value=collection),
            patch("app.services.goal_progress.enrich_conversations",
                  new=AsyncMock(side_effect=RuntimeError("sources down"))),
        ):
            count = await mentoring.count_pending_approvals(["kid"])
        self.assertEqual(count, 1)   # a broken read never breaks the badge


class TheBadgeFollowsTheClassPicker(unittest.TestCase):
    """A badge saying 8 over an inbox showing 5 reads as a bug. The route
    narrows to the picker's class when asked — and only to a class the
    session actually teaches, so a foreign id counts nothing rather than
    leaking a number."""

    GROUPS = [{"_id": "class-a"}, {"_id": "class-b"}]
    ROSTERS = {"class-a": ["gal", "dana"], "class-b": ["moti"]}

    def _count(self, url: str) -> tuple[int, AsyncMock]:
        from fastapi import FastAPI
        from fastapi.testclient import TestClient

        from app.auth.dependencies import require_teacher_session
        from app.routes import teacher_students as routes

        app = FastAPI()
        app.include_router(routes.router)
        app.dependency_overrides[require_teacher_session] = (
            lambda: {"sub": "teach"})
        counted = AsyncMock(return_value=0)
        with (
            patch("app.brain.org.groups_for_teacher",
                  new=AsyncMock(return_value=list(self.GROUPS))),
            patch("app.brain.org.learners_in_group",
                  new=AsyncMock(side_effect=lambda gid: self.ROSTERS.get(gid, []))),
            patch("app.services.mentoring.count_pending_approvals", new=counted),
        ):
            response = TestClient(app).get(url)
        self.assertEqual(response.status_code, 200)
        return response.json()["count"], counted

    def test_without_a_group_the_count_spans_every_class(self):
        _, counted = self._count("/api/teacher/goals/pending-count")
        counted.assert_awaited_once_with(["gal", "dana", "moti"])

    def test_a_group_id_narrows_to_that_class(self):
        _, counted = self._count(
            "/api/teacher/goals/pending-count?group_id=class-a")
        counted.assert_awaited_once_with(["gal", "dana"])

    def test_a_class_the_session_does_not_teach_counts_nothing(self):
        count, counted = self._count(
            "/api/teacher/goals/pending-count?group_id=someone-elses")
        counted.assert_awaited_once_with([])
        self.assertEqual(count, 0)


if __name__ == "__main__":
    unittest.main()
