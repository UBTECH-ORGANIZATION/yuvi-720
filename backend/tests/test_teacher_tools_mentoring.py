"""The four mentoring tools the teaching assistant gained.

Three properties are worth a test each, and they are the three that would fail
silently rather than loudly:

  1. **The ranking is arithmetic, not an opinion.** `suggest_students_to_meet`
     tells a teacher which children need them. A model score would make that
     claim unexplainable and unreproducible; these tests pin the order to the
     reasons, and the reasons to the record.
  2. **The action vocabulary is derived, not restated.** The closed set of
     platform actions is already written down in three places that have to
     agree. The goals schema here must read it, not copy it.
  3. **A teachers-only note stays with the teacher who wrote it.** The same
     line `get_teacher_notes` draws — another teacher's private writing about a
     shared student is theirs, not assistant fuel.
"""

from __future__ import annotations

import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.agents.teacher_tools import action_tools, data_tools, install, registry
from app.services.ai_usage import UsageContext
from app.services.goal_progress import ACTION_KINDS

install()

MINE = "kid-mine"
OTHER = "kid-other"


def _context(**overrides) -> registry.TeacherToolContext:
    base = dict(
        teacher_id="teacher-a", language="he",
        allowed_group_ids=frozenset({"group-1"}),
        allowed_learner_ids=frozenset({MINE, OTHER}),
        is_admin=False,
        usage_context=UsageContext(
            actor_id="teacher-a", actor_type="teacher",
            endpoint="/api/teacher/assistant", feature="feature_6_teacher_view",
            operation="teacher_assistant.round_0", source="teacher_assistant",
        ),
    )
    base.update(overrides)
    return registry.TeacherToolContext(**base)


def _day(offset: int) -> str:
    """A `YYYY-MM-DD` `offset` days ago — the shape conversations store."""
    return (datetime.now(timezone.utc).date() - timedelta(days=offset)).isoformat()


def _conversation(**overrides) -> dict:
    record = {
        "id": "ment_1", "date": _day(3), "author": "teacher",
        "teacher_id": "teacher-a", "teacher_name": "מירי",
        "visibility": "shared", "notes": "דיברנו על שברים",
        "meeting_stage": "", "teacher_only_note": "", "goals": [],
    }
    record.update(overrides)
    return record


def _goal(**overrides) -> dict:
    goal = {"id": "g1", "title": "לתרגל שברים", "deadline": _day(-7),
            "progress_stage": "chosen", "approved_by": None, "needs_help": False}
    goal.update(overrides)
    return goal


class ReadTests(unittest.IsolatedAsyncioTestCase):
    """`get_student_mentorings` — the record, not just its goals."""

    async def test_returns_conversations_newest_first_with_a_gap(self):
        rows = [_conversation(id="new", date=_day(2)),
                _conversation(id="old", date=_day(40))]
        with patch("app.services.mentoring.list_conversations",
                   AsyncMock(return_value=rows)):
            result = await data_tools._get_student_mentorings(
                _context(), {"learner_id": MINE})

        self.assertEqual([row["conversation_id"] for row in result["data"]],
                         ["new", "old"])
        self.assertEqual(result["data"][0]["days_ago"], 2)
        self.assertEqual(result["data"][1]["days_ago"], 40)

    async def test_says_so_rather_than_returning_an_empty_list(self):
        with patch("app.services.mentoring.list_conversations",
                   AsyncMock(return_value=[])):
            result = await data_tools._get_student_mentorings(
                _context(), {"learner_id": MINE})
        self.assertIsNone(result["data"])
        self.assertEqual(result["reason"], "no_mentoring_conversations")

    async def test_another_teachers_private_note_is_not_assistant_fuel(self):
        rows = [_conversation(teacher_id="teacher-b",
                              teacher_only_note="ההורים בהליך גירושין")]
        with patch("app.services.mentoring.list_conversations",
                   AsyncMock(return_value=rows)):
            result = await data_tools._get_student_mentorings(
                _context(), {"learner_id": MINE})

        self.assertNotIn("teacher_only_note", result["data"][0])
        self.assertFalse(result["data"][0]["by_me"])

    async def test_this_teachers_own_private_note_comes_back(self):
        rows = [_conversation(teacher_id="teacher-a", teacher_only_note="לשים לב")]
        with patch("app.services.mentoring.list_conversations",
                   AsyncMock(return_value=rows)):
            result = await data_tools._get_student_mentorings(
                _context(), {"learner_id": MINE})

        self.assertEqual(result["data"][0]["teacher_only_note"], "לשים לב")
        self.assertTrue(result["data"][0]["by_me"])

    async def test_no_name_of_any_kind_reaches_the_model(self):
        # The model refers to people by id. A staff member's name is no more
        # its business than a child's, and `teacher_name` is on every record.
        rows = [_conversation(teacher_name="מירי")]
        with patch("app.services.mentoring.list_conversations",
                   AsyncMock(return_value=rows)):
            result = await data_tools._get_student_mentorings(
                _context(), {"learner_id": MINE})
        self.assertNotIn("teacher_name", result["data"][0])

    async def test_does_not_spend_model_calls_pricing_old_goals(self):
        reader = AsyncMock(return_value=[_conversation()])
        with patch("app.services.mentoring.list_conversations", reader):
            await data_tools._get_student_mentorings(_context(), {"learner_id": MINE})
        self.assertIs(reader.await_args.kwargs["price_backfill"], False)

    async def test_the_limit_is_bounded_at_both_ends(self):
        rows = [_conversation(id=f"c{index}", date=_day(index)) for index in range(30)]
        with patch("app.services.mentoring.list_conversations",
                   AsyncMock(return_value=rows)):
            for asked, expected in ((None, 5), (0, 5), (2, 2), (999, 20), ("x", 5)):
                result = await data_tools._get_student_mentorings(
                    _context(), {"learner_id": MINE, "limit": asked})
                self.assertEqual(len(result["data"]), expected, asked)
                # The count is the truth even when the rows are cut.
                self.assertEqual(result["total"], 30)


class DraftShapeTests(unittest.IsolatedAsyncioTestCase):
    """The goals a draft carries, and the fields it admits it is missing."""

    def test_the_action_enum_is_derived_from_the_counter(self):
        # If this ever becomes a literal, the closed vocabulary lives in FOUR
        # places instead of three and the copy nothing imports is the one that
        # drifts. `draft_calendar_event` sets the same precedent.
        enum = action_tools._GOALS_SCHEMA["items"]["properties"]["action"] \
            ["properties"]["kind"]["enum"]
        self.assertEqual(enum, sorted(ACTION_KINDS))

    async def test_notes_are_reported_missing_even_when_goals_were_drafted(self):
        # The composer cannot save a record with nothing in "what was
        # discussed", so an offer without notes would open a dead form.
        result = await action_tools._draft_mentoring_conversation(_context(), {
            "learner_id": MINE,
            "goals": [{"title": "לתרגל שברים", "deadline": _day(-7)}],
        })
        self.assertEqual(result["offer"]["missing"], ["notes"])
        self.assertEqual(len(result["offer"]["goal_drafts"]), 1)

    async def test_a_draft_for_nobody_says_who_is_missing(self):
        result = await action_tools._draft_mentoring_conversation(
            _context(), {"notes": "דיברנו"})
        self.assertEqual(result["offer"]["missing"], ["learner"])

    async def test_an_invented_action_becomes_no_action_not_a_bad_one(self):
        result = await action_tools._draft_mentoring_conversation(_context(), {
            "learner_id": MINE, "notes": "דיברנו",
            "goals": [
                {"title": "א", "action": {"kind": "do_homework", "target": 3}},
                {"title": "ב", "action": {"kind": "use_hint", "target": 3}},
            ],
        })
        drafts = result["offer"]["goal_drafts"]
        self.assertIsNone(drafts[0]["action"])
        self.assertEqual(drafts[1]["action"], {"kind": "use_hint", "target": 3})

    async def test_a_malformed_deadline_is_dropped_not_repaired(self):
        result = await action_tools._draft_mentoring_conversation(_context(), {
            "learner_id": MINE, "notes": "דיברנו",
            "goals": [{"title": "א", "deadline": "next tuesday"}],
        })
        self.assertEqual(result["offer"]["goal_drafts"][0]["deadline"], "")

    async def test_a_goal_with_neither_title_nor_steps_is_not_a_goal(self):
        result = await action_tools._draft_mentoring_conversation(_context(), {
            "learner_id": MINE, "notes": "דיברנו",
            "goals": [{"deadline": _day(-7)}, "not a dict", {"next_steps": "לתרגל"}],
        })
        drafts = result["offer"]["goal_drafts"]
        self.assertEqual(len(drafts), 1)
        # A goal given only next steps is titled by them rather than untitled.
        self.assertEqual(drafts[0]["title"], "לתרגל")

    async def test_the_cap_matches_what_the_write_path_accepts(self):
        result = await action_tools._draft_mentoring_conversation(_context(), {
            "learner_id": MINE, "notes": "דיברנו",
            "goals": [{"title": f"יעד {index}"} for index in range(12)],
        })
        self.assertEqual(len(result["offer"]["goal_drafts"]),
                         action_tools.MAX_DRAFT_GOALS)

    async def test_goals_into_a_conversation_open_on_the_goals_step(self):
        result = await action_tools._draft_goals_into_conversation(_context(), {
            "learner_id": MINE, "goals": [{"title": "לתרגל"}],
        })
        self.assertEqual(result["offer"]["kind"], "draft_mentoring")
        self.assertEqual(result["offer"]["step"], 1)
        self.assertEqual(result["offer"]["missing"], [])

    async def test_goals_into_a_conversation_with_no_goals_says_so(self):
        result = await action_tools._draft_goals_into_conversation(
            _context(), {"learner_id": MINE, "goals": []})
        self.assertEqual(result["offer"]["missing"], ["goals"])


class MeetRankingTests(unittest.IsolatedAsyncioTestCase):
    """Who to sit down with — and why, checkably."""

    def _roster(self, by_learner: dict[str, list[dict]]):
        """Patch the roster and the per-learner conversation read together."""
        async def conversations(learner_id, **_kwargs):
            return by_learner.get(learner_id, [])

        return (
            patch("app.brain.org.learners_in_group",
                  AsyncMock(return_value=sorted(by_learner))),
            patch("app.services.mentoring.list_conversations",
                  AsyncMock(side_effect=conversations)),
        )

    async def _run(self, by_learner, *, scope=None):
        """`scope` defaults to the whole fixture — pass it to test the filter."""
        roster, reader = self._roster(by_learner)
        with roster, reader:
            return await action_tools._suggest_students_to_meet(
                _context(allowed_learner_ids=frozenset(
                    by_learner if scope is None else scope)),
                {"group_id": "group-1"})

    async def test_a_student_nobody_has_written_up_outranks_a_stale_one(self):
        result = await self._run({
            MINE: [],
            OTHER: [_conversation(date=_day(action_tools.MEET_STALE_DAYS + 5))],
        })
        students = result["data"]["students"]
        self.assertEqual([row["learner_id"] for row in students], [MINE, OTHER])
        self.assertEqual(students[0]["because"], ["never_met"])
        self.assertEqual(students[1]["because"], ["no_recent_meeting"])

    async def test_a_recent_conversation_with_nothing_open_is_not_on_the_list(self):
        result = await self._run({MINE: [_conversation(date=_day(2))]})
        self.assertIsNone(result["data"])
        self.assertEqual(result["reason"], "nobody_is_overdue_a_conversation")

    async def test_asking_for_help_puts_a_recently_met_student_back_on_it(self):
        result = await self._run({
            MINE: [_conversation(date=_day(1), goals=[_goal(needs_help=True)])],
        })
        row = result["data"]["students"][0]
        self.assertEqual(row["because"], ["asked_for_help"])
        self.assertEqual(row["open_goals_needing_help"], 1)
        self.assertEqual(row["days_since_meeting"], 1)

    async def test_an_overdue_goal_counts_but_a_finished_one_does_not(self):
        result = await self._run({
            MINE: [_conversation(date=_day(1), goals=[
                _goal(id="late", deadline=_day(9)),
                # Summarized or approved is finished — a passed date on it is
                # not a reason to call the teacher in.
                _goal(id="done", deadline=_day(9), progress_stage="summarized"),
                _goal(id="ok", deadline=_day(9), approved_by="teacher-a"),
            ])],
        })
        row = result["data"]["students"][0]
        self.assertEqual(row["open_goals_overdue"], 1)
        self.assertEqual(row["because"], ["goal_overdue"])

    async def test_the_order_is_the_same_twice_and_explains_itself(self):
        by_learner = {
            "kid-a": [],
            "kid-b": [_conversation(date=_day(2), goals=[_goal(needs_help=True)])],
            "kid-c": [_conversation(date=_day(90))],
        }
        first = await self._run(by_learner)
        second = await self._run(by_learner)
        order = [row["learner_id"] for row in first["data"]["students"]]

        self.assertEqual(order, [row["learner_id"] for row in second["data"]["students"]])
        self.assertEqual(order, ["kid-a", "kid-b", "kid-c"])
        # Every row on the list names what put it there — nothing is ranked by
        # a reason the teacher cannot read.
        for row in first["data"]["students"]:
            self.assertTrue(row["because"])

    async def test_ties_break_on_the_id_so_two_runs_cannot_disagree(self):
        by_learner = {"kid-z": [], "kid-a": [], "kid-m": []}
        result = await self._run(by_learner)
        self.assertEqual([row["learner_id"] for row in result["data"]["students"]],
                         ["kid-a", "kid-m", "kid-z"])

    async def test_a_learner_outside_the_teachers_scope_is_dropped(self):
        # `learners_in_group` is the org's answer; the scope set is the
        # server's. A row surviving only the first would name somebody else's
        # child in an offer.
        result = await self._run({MINE: [], "kid-someone-elses": []}, scope={MINE})
        self.assertEqual([row["learner_id"] for row in result["data"]["students"]],
                         [MINE])

    async def test_the_fan_out_does_not_price_a_single_goal(self):
        # Up to MAX_OFFER_LEARNERS reads in one tool call. Leaving the pricing
        # backfill on multiplies model calls by the roster while a teacher waits.
        roster, reader = self._roster({MINE: [], OTHER: []})
        with roster, reader as read:
            await action_tools._suggest_students_to_meet(
                _context(), {"group_id": "group-1"})
        for call in read.await_args_list:
            self.assertIs(call.kwargs["price_backfill"], False)

    async def test_an_empty_class_is_named_not_returned_as_nobody_overdue(self):
        result = await self._run({})
        self.assertEqual(result["reason"], "group_has_no_students")


class RegistrationTests(unittest.TestCase):
    """The four are registered, scoped, and readable by the manifest."""

    def test_all_four_are_registered_with_their_scope_declared(self):
        expected = {
            "get_student_mentorings": ("learner_id",),
            "draft_mentoring_conversation": ("learner_id",),
            "draft_goals_into_conversation": ("learner_id",),
        }
        for name, learner_args in expected.items():
            tool = registry.get(name)
            self.assertIsNotNone(tool, name)
            self.assertEqual(tool.learner_args, learner_args, name)

        meet = registry.get("suggest_students_to_meet")
        self.assertIsNotNone(meet)
        self.assertEqual(meet.group_args, ("group_id",))

    def test_the_manifest_can_offer_them(self):
        names = {row["name"] for row in registry.manifest()}
        self.assertTrue({"get_student_mentorings", "draft_mentoring_conversation",
                         "draft_goals_into_conversation",
                         "suggest_students_to_meet"} <= names)


class ScreenRouteTests(unittest.TestCase):
    """`navigate` must still be able to reach the screen it was renamed to."""

    def test_the_mentoring_screen_is_reachable_and_the_old_name_is_gone(self):
        from app.agents.teacher_tools import help_tools

        self.assertEqual(help_tools.ROUTES["mentoring"], "/teacher/goals")
        self.assertNotIn("goals", help_tools.ROUTES)

    def test_every_screen_the_enum_offers_has_a_label(self):
        import json
        from app.agents.teacher_tools import help_tools

        root = Path(__file__).resolve().parents[2] / "locales"
        for language in ("he", "en", "ar"):
            table = json.loads((root / f"{language}.json").read_text(encoding="utf-8"))
            for screen in help_tools.ROUTES:
                key = f"tch.assistant.action.open.{screen}"
                self.assertIn(key, table, f"{language} is missing {key}")


if __name__ == "__main__":
    unittest.main()


class ScreenPurposeTests(unittest.TestCase):
    """A screen name is not a description.

    The `screen` enum was bare keys, so the model had to infer what each word
    meant from the word alone — and asked to open the mentoring screen it
    offered the roster, both being "about students" and only one of them ever
    described. Every route now carries what it HOLDS, and the two tables are
    pinned together so a new screen cannot be added to one alone.
    """

    def test_every_route_says_what_it_holds(self):
        from app.agents.teacher_tools import help_tools

        self.assertEqual(set(help_tools.ROUTES), set(help_tools.SCREEN_PURPOSE))
        for name, purpose in help_tools.SCREEN_PURPOSE.items():
            self.assertGreater(len(purpose.split()), 4, f"{name} is described in a phrase")

    def test_the_mentoring_screen_is_described_as_the_place_talks_are_written(self):
        from app.agents.teacher_tools import help_tools

        purpose = help_tools.SCREEN_PURPOSE["mentoring"].lower()
        self.assertIn("conversation", purpose)
        self.assertIn("approval", purpose)

    def test_the_description_reaches_the_model(self):
        """Registered in the schema, not merely defined beside it."""
        from app.agents.teacher_tools import help_tools, registry

        registry.reset_for_tests()
        help_tools.register_all()
        tool = registry.get("navigate")
        schema = tool.as_openai_schema()["function"]["parameters"]
        described = schema["properties"]["screen"]["description"]
        for name in help_tools.ROUTES:
            self.assertIn(f"`{name}`", described)
