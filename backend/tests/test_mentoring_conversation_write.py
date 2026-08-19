"""One talk, several goals, one record — and everything downstream runs once.

`assign_goal` creates a conversation per goal, so a teacher who agreed three
things in one conversation got three unrelated records and nowhere to put what
was actually discussed. `document_conversation` writes the talk instead.

The properties worth protecting are all "exactly once": one document, one brain
projection, one notification, one meeting statement. Getting any of them wrong
is invisible in the UI and expensive somewhere else — a second spark ledger
entry, a child's phone ringing six times, a duplicated ministry statement.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services import goal_approval, mentoring


class _FakeCollection:
    """Just enough Mongo to catch the insert."""

    def __init__(self):
        self.inserted: list[dict] = []

    async def insert_one(self, document):
        self.inserted.append(document)


class ConversationWriteTest(unittest.IsolatedAsyncioTestCase):
    GOALS = [
        {"title": "לתרגל זוויות", "next_steps": "עשר דקות ביום", "deadline": "2026-09-01"},
        {"title": "לבקש עזרה מוקדם", "next_steps": "", "deadline": "2026-09-01"},
        {"title": "להשלים משימות", "next_steps": "", "deadline": "2026-09-08"},
    ]

    async def asyncSetUp(self):
        self.collection = _FakeCollection()
        self._patches = [
            patch("app.brain.org.teacher_can_access_learner", AsyncMock(return_value=True)),
            patch.object(mentoring, "_get_collection_named", return_value=self.collection),
            patch.object(mentoring, "_project_goals", AsyncMock(return_value=None)),
            patch.object(
                mentoring.rewards, "price_goal",
                AsyncMock(return_value={"value": 10, "why": "because"}),
            ),
            patch("app.services.notifications.notify", AsyncMock(return_value={})),
            patch("app.services.lrs.reporter.report_mentor_meeting_completed",
                  AsyncMock(return_value=None)),
            patch("app.services.lrs.reporter.report_student_goal", AsyncMock(return_value=None)),
        ]
        (self.access, _coll, self.project, self.price,
         self.notify, self.meeting, self.goal_statement) = [p.start() for p in self._patches]

    async def asyncTearDown(self):
        for handle in self._patches:
            handle.stop()

    async def _document(self, **overrides):
        payload = {
            "notes": "דיברנו על הקושי בזוויות",
            "goals": list(self.GOALS),
            "lrs_session_id": "sid-1",
        }
        payload.update(overrides)
        return await goal_approval.document_conversation("teacher-1", "kid-a", **payload)

    # ── one record ───────────────────────────────────────────────────────────

    async def test_three_goals_become_one_conversation(self):
        record = await self._document()
        self.assertEqual(len(self.collection.inserted), 1, "one talk is one document")
        self.assertEqual(len(record["goals"]), 3)
        self.assertEqual(record["notes"], "דיברנו על הקושי בזוויות")
        self.assertEqual(record["author"], "teacher")
        self.assertEqual(record["teacher_id"], "teacher-1")

    async def test_every_goal_is_priced_and_the_brain_is_rebuilt_once(self):
        """Pricing is per goal; the projection is per conversation. Rebuilding
        the mirror once per goal would be three reads and three writes."""
        await self._document()
        self.assertEqual(self.price.await_count, 3)
        self.assertEqual(self.project.await_count, 1)

    async def test_one_bell_for_the_talk_not_one_per_goal(self):
        await self._document()
        self.assertEqual(self.notify.await_count, 1)
        self.assertEqual(self.notify.await_args.kwargs["params"], {"count": 3})

    async def test_a_talk_with_no_goals_is_still_worth_recording(self):
        record = await self._document(goals=[])
        self.assertEqual(record["goals"], [])
        self.assertEqual(record["notes"], "דיברנו על הקושי בזוויות")
        self.assertEqual(
            self.notify.await_args.kwargs["title_key"],
            "notif.mentoring.documented.noGoals",
        )

    async def test_a_form_with_neither_notes_nor_goals_is_refused(self):
        with self.assertRaises(goal_approval.ApprovalError) as caught:
            await self._document(notes="", goals=[])
        self.assertEqual(caught.exception.code, "empty_conversation")

    async def test_a_teacher_off_the_roster_is_refused(self):
        self.access.return_value = False
        with self.assertRaises(goal_approval.ApprovalError) as caught:
            await self._document()
        self.assertEqual(caught.exception.code, "not_authorized")
        self.assertEqual(self.collection.inserted, [])

    async def test_more_goals_than_a_talk_produces_are_dropped(self):
        record = await self._document(
            goals=[{"title": f"goal {n}"} for n in range(20)])
        self.assertEqual(len(record["goals"]), goal_approval.MAX_GOALS_PER_CONVERSATION)

    # ── idempotency ──────────────────────────────────────────────────────────

    async def test_the_same_draft_submitted_twice_writes_once(self):
        """Pricing runs a model call per goal, so the button stays live for
        seconds. A double-click must not produce a second conversation."""
        first = await self._document(draft_id="draft-abc")
        with patch.object(
            mentoring, "list_conversations", AsyncMock(return_value=[first]),
        ):
            second = await self._document(draft_id="draft-abc")
        self.assertEqual(first["id"], second["id"])
        self.assertEqual(len(self.collection.inserted), 1)
        self.assertEqual(self.notify.await_count, 1)

    # ── ministry reporting ───────────────────────────────────────────────────

    async def test_a_teacher_documented_talk_reports_the_meeting_and_every_goal(self):
        """This is what used to be missing entirely: reporting lived in the
        learner's route, and no teacher path went through it."""
        await self._document()
        self.assertEqual(self.meeting.await_count, 1)
        self.assertEqual(self.goal_statement.await_count, 3)
        for call in self.goal_statement.await_args_list:
            self.assertEqual(call.args[2], "initialized")
            self.assertIsNotNone(
                call.kwargs.get("instructor_exid"),
                "a teacher-authored goal names the instructor",
            )

    async def test_a_teacher_only_talk_reports_no_goals_at_all(self):
        """The child never sees it, so there is no learning event to report.
        The meeting itself still happened."""
        await self._document(visibility="teacher_only")
        self.assertEqual(self.meeting.await_count, 1)
        self.assertEqual(self.goal_statement.await_count, 0)

    async def test_a_teacher_only_talk_does_not_ring_the_learners_bell(self):
        """A notification deep-linking to a record they cannot open."""
        await self._document(visibility="teacher_only")
        self.assertEqual(self.notify.await_count, 0)

    async def test_a_teacher_talk_is_never_filed_under_the_teachers_session(self):
        """The actor is the LEARNER; the `sid` the route holds is the teacher's.

        Hanging it on the statement would group the child's event inside
        someone else's session, so these carry no session activity at all —
        which `build_grouping` allows, and which is the only honest option: a
        teacher writing up a talk is not inside a learning session.
        """
        await self._document(lrs_session_id="sid-1")
        self.assertIsNone(self.meeting.await_args.args[1])
        self.assertIsNone(self.goal_statement.await_args.args[1])

    async def test_a_teacher_talk_reports_even_with_no_session_to_offer(self):
        """Follows from the above: the session was never the thing that made
        this reportable, so its absence cannot make it unreportable."""
        await self._document(lrs_session_id=None)
        self.assertEqual(self.meeting.await_count, 1)
        self.assertEqual(self.goal_statement.await_count, 3)

    async def test_a_reporting_failure_does_not_lose_the_conversation(self):
        self.meeting.side_effect = RuntimeError("LRS down")
        record = await self._document()
        self.assertEqual(len(self.collection.inserted), 1)
        self.assertEqual(len(record["goals"]), 3)


class AssignGoalStillReportsTest(unittest.IsolatedAsyncioTestCase):
    """The single-goal path keeps its own shape — and gains the statement it
    was always documented as sending."""

    async def asyncSetUp(self):
        self.collection = _FakeCollection()
        self._patches = [
            patch("app.brain.org.teacher_can_access_learner", AsyncMock(return_value=True)),
            patch.object(mentoring, "_get_collection_named", return_value=self.collection),
            patch.object(mentoring, "_project_goals", AsyncMock(return_value=None)),
            patch.object(
                mentoring.rewards, "price_goal",
                AsyncMock(return_value={"value": 10, "why": "because"}),
            ),
            patch("app.services.notifications.notify", AsyncMock(return_value={})),
            patch("app.services.lrs.reporter.report_mentor_meeting_completed",
                  AsyncMock(return_value=None)),
            patch("app.services.lrs.reporter.report_student_goal", AsyncMock(return_value=None)),
        ]
        (_access, _coll, _project, _price,
         self.notify, self.meeting, self.goal_statement) = [p.start() for p in self._patches]

    async def asyncTearDown(self):
        for handle in self._patches:
            handle.stop()

    async def test_an_assigned_goal_now_reaches_the_ministry(self):
        await goal_approval.assign_goal(
            "teacher-1", "kid-a", {"title": "לתרגל זוויות"}, lrs_session_id="sid-1")
        self.assertEqual(self.meeting.await_count, 1)
        self.assertEqual(self.goal_statement.await_count, 1)

    async def test_it_keeps_its_own_notification(self):
        """Only the documented conversation uses the new key; a single assigned
        goal still says "a goal was set for you"."""
        await goal_approval.assign_goal(
            "teacher-1", "kid-a", {"title": "לתרגל זוויות"}, lrs_session_id="sid-1")
        self.assertEqual(self.notify.await_args.kwargs["title_key"], "notif.goal.assigned")


if __name__ == "__main__":
    unittest.main()
