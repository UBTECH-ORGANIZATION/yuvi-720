"""The action tools: they offer, they never act.

The whole feature rests on one property — a tool that puts a filled-in form in
front of a teacher must not be able to write anything itself. If that ever
stops being true, a prompt injection in a student's name becomes a goal
assigned to a class, and the registry's own docstring becomes a lie.

So the first test here does not check a return value. It stubs every write path
the assistant could conceivably reach and asserts none of them is called, for
every tool in the registry, with arguments designed to tempt them.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.agents.teacher_tools import action_tools, install, registry

install()

CONTEXT_KWARGS = dict(
    teacher_id="teacher-a",
    language="he",
    allowed_group_ids=frozenset({"group-1"}),
    allowed_learner_ids=frozenset({"kid-a", "kid-b"}),
    is_admin=False,
)


def _context(**overrides):
    from app.services.ai_usage import UsageContext

    kwargs = {**CONTEXT_KWARGS, **overrides}
    return registry.TeacherToolContext(
        usage_context=UsageContext(
            actor_id=kwargs["teacher_id"], actor_type="teacher",
            endpoint="/api/teacher/assistant", feature="feature_6_teacher_view",
            operation="teacher_assistant.round_0", source="teacher_assistant",
        ),
        **kwargs,
    )


class NothingWritesTests(unittest.IsolatedAsyncioTestCase):
    """The invariant `registry.py` promises, asserted rather than assumed."""

    async def test_no_action_tool_reaches_any_write_path(self):
        # Every real mutation an assistant tool could plausibly reach. The names
        # are checked below rather than assumed: a renamed function would make
        # `patch` fail loudly, where a silently-wrong name would make this test
        # pass while guarding nothing.
        writes = {
            "app.services.goal_approval.assign_goal": AsyncMock(),
            "app.services.goal_approval.approve_goal": AsyncMock(),
            "app.services.goal_approval.assign_to_group": AsyncMock(),
            "app.services.mentoring.create_conversation": AsyncMock(),
            "app.services.mentoring.update_goal_progress": AsyncMock(),
            "app.services.kudos.send_kudos": AsyncMock(),
            "app.services.teacher_insights_store.create": AsyncMock(),
            "app.services.teacher_alerts.acknowledge": AsyncMock(),
            "app.services.teacher_alerts.raise_alert": AsyncMock(),
            "app.services.notifications.notify": AsyncMock(),
        }
        patches = [patch(target, mock) for target, mock in writes.items()]

        # Arguments chosen to look like an instruction to act, not to draft.
        tempting = {
            "learner_ids": ["kid-a", "kid-b"], "learner_id": "kid-a",
            "title": "assign this now", "text": "save this", "message": "send this",
            "questions": ["and then?"], "screen": "students",
        }

        for entered in patches:
            entered.__enter__()
        try:
            for tool in registry.all_tools():
                await registry.dispatch(tool.name, dict(tempting), _context())
        finally:
            for entered in reversed(patches):
                entered.__exit__(None, None, None)

        for target, mock in writes.items():
            self.assertEqual(
                mock.await_count, 0,
                f"{target} was called — an assistant tool must never write",
            )


class ScopeTests(unittest.IsolatedAsyncioTestCase):
    """A list argument is not one id, so it needs its own filter."""

    async def test_a_learner_outside_the_teachers_groups_is_dropped(self):
        result = await action_tools._draft_goal(
            _context(), {"learner_ids": ["kid-a", "kid-someone-elses"], "title": "x"}
        )
        self.assertEqual(result["offer"]["learner_ids"], ["kid-a"])

    async def test_a_draft_for_nobody_in_scope_is_refused_not_emptied(self):
        """An empty goal form would read as "assign to nobody" and be pressable."""
        result = await action_tools._draft_goal(
            _context(), {"learner_ids": ["kid-someone-elses"], "title": "x"}
        )
        self.assertIsNone(result["data"])
        self.assertNotIn("offer", result)

    async def test_an_admin_is_not_narrowed_to_a_roster_they_do_not_have(self):
        result = await action_tools._draft_goal(
            _context(is_admin=True), {"learner_ids": ["kid-z"], "title": "x"}
        )
        self.assertEqual(result["offer"]["learner_ids"], ["kid-z"])

    async def test_the_offer_is_capped(self):
        many = [f"kid-{index}" for index in range(200)]
        result = await action_tools._draft_goal(
            _context(is_admin=True), {"learner_ids": many, "title": "x"}
        )
        self.assertEqual(
            len(result["offer"]["learner_ids"]), action_tools.MAX_OFFER_LEARNERS
        )


class GuidedFillTests(unittest.IsolatedAsyncioTestCase):
    """`missing` is what lets the model ask instead of guessing."""

    async def test_a_goal_with_no_title_reports_it_rather_than_refusing(self):
        result = await action_tools._draft_goal(_context(), {"learner_ids": ["kid-a"]})
        self.assertEqual(result["offer"]["missing"], ["title"])
        self.assertEqual(result["offer"]["title"], "")

    async def test_a_complete_goal_reports_nothing_missing(self):
        result = await action_tools._draft_goal(
            _context(), {"learner_ids": ["kid-a"], "title": "מערכת צירים"}
        )
        self.assertEqual(result["offer"]["missing"], [])

    async def test_a_malformed_deadline_is_dropped_not_repaired(self):
        """The form's own default is a better guess than half a parsed date."""
        result = await action_tools._draft_goal(
            _context(), {"learner_ids": ["kid-a"], "title": "x", "deadline": "next tuesday"}
        )
        self.assertEqual(result["offer"]["deadline"], "")

    async def test_a_real_deadline_survives(self):
        result = await action_tools._draft_goal(
            _context(), {"learner_ids": ["kid-a"], "title": "x", "deadline": "2026-09-01"}
        )
        self.assertEqual(result["offer"]["deadline"], "2026-09-01")

    async def test_an_invented_note_kind_falls_back_to_a_real_one(self):
        """A fifth kind would save fine and render as a blank chip."""
        result = await action_tools._draft_note(
            _context(), {"learner_id": "kid-a", "text": "t", "kind": "vibes"}
        )
        self.assertEqual(result["offer"]["note_kind"], "note")

    async def test_a_goal_naming_nobody_asks_who_rather_than_pointing_at_nobody(self):
        """The bug this round fixes, at its source.

        `missing` was built from a one-element tuple, so it could only ever say
        "title". A goal the model knew was the right move but had no target for
        therefore produced a form aimed at nobody — and pressable. Who it is for
        is a required field like any other.
        """
        result = await action_tools._draft_goal(_context(), {"title": "מערכת צירים"})
        self.assertIn("learners", result["offer"]["missing"])
        self.assertEqual(result["offer"]["learner_ids"], [])

    async def test_a_goal_with_neither_target_nor_title_reports_both(self):
        result = await action_tools._draft_goal(_context(), {})
        self.assertEqual(sorted(result["offer"]["missing"]), ["learners", "title"])

    async def test_naming_nobody_and_naming_the_wrong_person_differ(self):
        """Two emptinesses that must not collapse into one answer.

        Naming no one is a gap the teacher fills from the roster. Naming only
        children this teacher does not teach is a request about somebody else's
        class — it stays a refusal, and the reason stays vague so it cannot be
        used to probe whether an id exists.
        """
        unfilled = await action_tools._draft_goal(_context(), {"title": "x"})
        out_of_scope = await action_tools._draft_goal(
            _context(), {"learner_ids": ["kid-someone-elses"], "title": "x"})

        self.assertIn("offer", unfilled)
        self.assertNotIn("offer", out_of_scope)
        self.assertIsNone(out_of_scope["data"])

    async def test_a_note_for_nobody_reports_the_learner_missing(self):
        """Asymmetric before this: `draft_goal` guarded its target, these did
        not, so a note offer could carry `learner_id=""` — a save button that
        posts to nobody."""
        result = await action_tools._draft_note(_context(), {"text": "t"})
        self.assertIn("learner", result["offer"]["missing"])

    async def test_a_kudos_for_nobody_reports_the_learner_missing(self):
        result = await action_tools._draft_kudos(_context(), {"message": "m"})
        self.assertIn("learner", result["offer"]["missing"])

    async def test_a_complete_note_and_kudos_report_nothing_missing(self):
        note = await action_tools._draft_note(
            _context(), {"learner_id": "kid-a", "text": "t"})
        kudos = await action_tools._draft_kudos(
            _context(), {"learner_id": "kid-a", "message": "m"})
        self.assertEqual(note["offer"]["missing"], [])
        self.assertEqual(kudos["offer"]["missing"], [])


class OfferShapeTests(unittest.IsolatedAsyncioTestCase):
    async def test_every_offer_carries_a_locale_key_not_a_sentence(self):
        """A button caption is a lookup. Only prose is the model's job."""
        offers = [
            (await action_tools._draft_goal(_context(), {"learner_ids": ["kid-a"]}))["offer"],
            (await action_tools._draft_note(_context(), {"learner_id": "kid-a", "text": "t"}))["offer"],
            (await action_tools._draft_kudos(_context(), {"learner_id": "kid-a", "message": "m"}))["offer"],
        ]
        for offer in offers:
            self.assertTrue(offer["label_key"].startswith("tch."), offer["label_key"])

    async def test_followups_are_capped_and_stripped(self):
        result = await action_tools._suggest_followups(
            _context(), {"questions": ["  a  ", "b", "c", "d", ""]}
        )
        self.assertEqual(result["offer"]["questions"], ["a", "b", "c"])

    async def test_no_followups_is_an_honest_empty(self):
        result = await action_tools._suggest_followups(_context(), {"questions": []})
        self.assertIsNone(result["data"])
        self.assertNotIn("offer", result)


SNAPSHOT = {"students": [
    {"learner_id": "kid-a", "status": "active",
     "activity": {"started": True, "days_inactive": 0}},
    {"learner_id": "kid-b", "status": "attention",
     "activity": {"started": True, "days_inactive": 12}},
    {"learner_id": "kid-c", "status": "not_started",
     "activity": {"started": False, "days_inactive": None}},
]}


def _snapshot(*_args, **_kwargs):
    return SNAPSHOT


class DescribedSetTests(unittest.IsolatedAsyncioTestCase):
    """Turning "the inactive students" into the actual ids.

    The observed failure: asked about a described set, the assistant said it had
    no way to list them — untrue — and then drafted a goal for one arbitrary
    child. Nothing named a source for "who matches this description", so this is
    that source.
    """

    def _ctx(self):
        # kid-c is in the snapshot but outside this teacher's roster, so it also
        # proves the filter never widens scope.
        return _context(allowed_learner_ids=frozenset({"kid-a", "kid-b", "kid-c"}))

    async def _run(self, args, context=None):
        from app.agents.teacher_tools import data_tools

        with patch("app.services.insights.group_insights", AsyncMock(side_effect=_snapshot)), \
             patch("app.brain.org.learners_in_group",
                   AsyncMock(return_value=["kid-a", "kid-b", "kid-c"])):
            return await data_tools._list_students(context or self._ctx(), args)

    async def test_no_filter_still_returns_everyone(self):
        result = await self._run({})
        self.assertEqual([row["learner_id"] for row in result["data"]],
                         ["kid-a", "kid-b", "kid-c"])

    async def test_each_status_resolves_to_its_own_people(self):
        for wanted, expected in (("active", ["kid-a"]), ("attention", ["kid-b"]),
                                 ("not_started", ["kid-c"])):
            with self.subTest(filter=wanted):
                result = await self._run({"filter": wanted})
                self.assertEqual([row["learner_id"] for row in result["data"]], expected)

    async def test_inactive_cuts_across_status_rather_than_being_one(self):
        """kid-b is `attention` AND has not been seen in 12 days. Both are true,
        and a status-only filter would make the second unaskable."""
        result = await self._run({"filter": "inactive"})
        self.assertEqual([row["learner_id"] for row in result["data"]], ["kid-b"])

    async def test_the_day_threshold_is_honoured(self):
        self.assertEqual(
            [row["learner_id"] for row in (await self._run(
                {"filter": "inactive", "days": 5}))["data"]], ["kid-b"])
        self.assertIsNone((await self._run({"filter": "inactive", "days": 30}))["data"])

    async def test_a_junk_threshold_falls_back_rather_than_crashing(self):
        result = await self._run({"filter": "inactive", "days": "soon"})
        self.assertEqual(result["days"], 7)

    async def test_an_absurd_threshold_is_clamped(self):
        result = await self._run({"filter": "inactive", "days": 99999})
        self.assertEqual(result["days"], 90)

    async def test_an_invented_filter_is_named_not_silently_ignored(self):
        """Ignoring it would return the whole class looking like a match — the
        exact shape of a wrong draft aimed at everybody."""
        result = await self._run({"filter": "struggling-ish"})
        self.assertIsNone(result["data"])
        self.assertEqual(result["reason"], "unknown_filter")
        self.assertEqual(result["supported"], sorted(action_tools_roster_filters()))

    async def test_an_empty_match_is_honest(self):
        result = await self._run({"filter": "attention"},
                                 _context(allowed_learner_ids=frozenset({"kid-a"})))
        self.assertIsNone(result["data"])
        self.assertEqual(result["reason"], "no_students_match_filter")

    async def test_the_filter_never_widens_scope(self):
        """A learner in the snapshot but not on this teacher's roster is not
        theirs to be told about, however well they match."""
        result = await self._run({"filter": "not_started"},
                                 _context(allowed_learner_ids=frozenset({"kid-a", "kid-b"})))
        self.assertIsNone(result["data"])

    async def test_no_name_ever_leaves_the_tool(self):
        import json

        named = {"students": [{**SNAPSHOT["students"][0], "display_name": "דביר"}]}
        from app.agents.teacher_tools import data_tools

        with patch("app.services.insights.group_insights",
                   AsyncMock(return_value=named)), \
             patch("app.brain.org.learners_in_group", AsyncMock(return_value=["kid-a"])):
            result = await data_tools._list_students(self._ctx(), {"filter": "active"})
        self.assertNotIn("דביר", json.dumps(result, ensure_ascii=False))


def action_tools_roster_filters():
    from app.agents.teacher_tools import data_tools
    return data_tools.ROSTER_FILTERS


class FilterContractTests(unittest.TestCase):
    def test_the_roster_deep_link_accepts_every_filter_the_model_can_resolve(self):
        """Otherwise the assistant can *find* a set it cannot *link to* — which
        is what `inactive` did: resolvable in prose, and `navigate` dropped it."""
        from app.agents.teacher_tools import data_tools, help_tools

        self.assertIs(help_tools.ROSTER_FILTERS, data_tools.ROSTER_FILTERS)


class PromptTests(unittest.TestCase):
    """The two rules that exist because the model broke them."""

    def _prompt(self):
        from app.agents import teacher_assistant

        return teacher_assistant._system_prompt("he", {})

    def test_it_forbids_drawing_a_button_in_prose(self):
        """Observed live: `[navigate_button: תלמידים לא פעילים]` in the answer.

        `grep navigate_button` finds nothing in this repo — the model invented
        the syntax, because the prompt said "the button IS the sentence" while
        the tool result it saw carried no evidence a button had rendered.
        """
        prompt = self._prompt()
        self.assertIn("navigate_button", prompt)
        self.assertIn("[[action:", prompt)

    def test_it_requires_resolving_a_described_set_before_drafting(self):
        prompt = self._prompt()
        self.assertIn("list_students", prompt)
        self.assertIn("RESOLVE BEFORE YOU DRAFT", prompt)

    def test_it_permits_one_question_instead_of_a_wrong_draft(self):
        self.assertIn("ask ONE short question", self._prompt())


class NavigateTests(unittest.IsolatedAsyncioTestCase):
    async def test_a_filter_outside_the_closed_set_is_ignored(self):
        """The model must not be able to mint an arbitrary query string."""
        from app.agents.teacher_tools import help_tools

        result = await help_tools._navigate(
            _context(), {"screen": "students", "filter": "../../admin"}
        )
        self.assertEqual(result["offer"]["route"], "/teacher/students")

    async def test_a_real_filter_becomes_a_deep_link(self):
        from app.agents.teacher_tools import help_tools

        result = await help_tools._navigate(
            _context(), {"screen": "students", "filter": "attention"}
        )
        self.assertEqual(result["offer"]["route"], "/teacher/students?filter=attention")

    async def test_an_unknown_screen_offers_nothing(self):
        from app.agents.teacher_tools import help_tools

        result = await help_tools._navigate(_context(), {"screen": "billing"})
        self.assertNotIn("offer", result)


class HarvestTests(unittest.IsolatedAsyncioTestCase):
    """`_run_tools` splits one result two ways: trace for proof, offer for buttons."""

    async def test_offers_are_collected_and_kept_out_of_the_model_transcript(self):
        import json

        from app.agents import teacher_assistant

        message = {"tool_calls": [{
            "id": "call-1",
            "function": {"name": "draft_goal",
                         "arguments": json.dumps({"learner_ids": ["kid-a"], "title": "x"})},
        }]}
        trace: list = []
        offers: list = []
        results = await teacher_assistant._run_tools(message, _context(), trace, offers)

        self.assertEqual(len(offers), 1)
        self.assertEqual(offers[0]["kind"], "draft_goal")
        self.assertTrue(offers[0]["id"])
        self.assertEqual(len(trace), 1)

        # The offer PAYLOAD is for the browser. Leaving it in the tool result
        # invites the model to describe the button in prose as well.
        echoed = json.loads(results[0]["content"])
        self.assertNotIn("offer", echoed)
        # But a stub says one rendered. Deleting the offer outright left the
        # model with no evidence in its own transcript that a button existed —
        # while the prompt told it "the button IS the sentence" — so it typed
        # one, and `[navigate_button: ...]` reached a teacher's screen.
        self.assertIs(echoed["offer_rendered"], True)
        self.assertNotIn("learner_ids", echoed)

    async def test_a_silent_model_does_not_throw_away_the_card_it_drafted(self):
        """Caught by the live eval, not by reasoning.

        Tightening the prompt against drawing buttons made the model stop
        writing prose at all after offering one. The old branch turned that into
        "not enough evidence" *and dropped the offer* — telling a teacher their
        request failed while a scope-checked, ready-to-press goal was discarded.
        The prompt is the fix; this is the net under it.
        """
        import json

        from app.agents import teacher_assistant

        drafted = {"tool_calls": [{
            "id": "call-1",
            "function": {"name": "draft_goal",
                         "arguments": json.dumps({"learner_ids": ["kid-a"], "title": "x"})},
        }]}
        silent = {"role": "assistant", "content": ""}

        with patch.object(teacher_assistant, "_round",
                          AsyncMock(side_effect=[drafted, silent])), \
             patch.object(teacher_assistant, "_needs_grounding", lambda _text: False):
            result = await teacher_assistant.run_assistant(
                "teacher-a", "תכין יעד", language="he", context=_context())

        self.assertEqual(result["text_key"], teacher_assistant.UNKNOWN_OFFER_ONLY)
        self.assertEqual(len(result["actions"]), 1)
        self.assertEqual(result["actions"][0]["learner_ids"], ["kid-a"])

    async def test_a_silent_model_with_nothing_drafted_still_says_so(self):
        """The two states must not collapse: no answer is not the same as an
        answer that is a card."""
        from app.agents import teacher_assistant

        silent = {"role": "assistant", "content": ""}
        with patch.object(teacher_assistant, "_round", AsyncMock(return_value=silent)), \
             patch.object(teacher_assistant, "_needs_grounding", lambda _text: False):
            result = await teacher_assistant.run_assistant(
                "teacher-a", "שלום", language="he", context=_context())
        self.assertEqual(result["text_key"], teacher_assistant.UNKNOWN_NOT_ENOUGH)
        self.assertEqual(result.get("actions") or [], [])

    async def test_a_tool_without_an_offer_does_not_claim_one_rendered(self):
        import json

        from app.agents import teacher_assistant

        message = {"tool_calls": [{
            "id": "call-1",
            "function": {"name": "list_available_data", "arguments": "{}"},
        }]}
        results = await teacher_assistant._run_tools(message, _context(), [], [])
        self.assertNotIn("offer_rendered", json.loads(results[0]["content"]))

    async def test_the_same_draft_twice_in_a_turn_is_one_button(self):
        """Observed live: the model called `draft_goal` twice and the teacher got
        two identical chips, either of which would write the same goal."""
        import json

        from app.agents import teacher_assistant

        call = {"function": {"name": "draft_goal",
                             "arguments": json.dumps({"learner_ids": ["kid-a"], "title": "x"})}}
        offers: list = []
        # Two rounds, because that is how it actually happened — the dedupe has
        # to survive across messages, not just within one.
        await teacher_assistant._run_tools(
            {"tool_calls": [{"id": "call-1", **call}]}, _context(), [], offers)
        await teacher_assistant._run_tools(
            {"tool_calls": [{"id": "call-2", **call}]}, _context(), [], offers)

        self.assertEqual(len(offers), 1)

    async def test_two_different_drafts_both_survive(self):
        """The dedupe must compare content, not the tool that produced it."""
        import json

        from app.agents import teacher_assistant

        message = {"tool_calls": [
            {"id": "call-1", "function": {"name": "draft_goal", "arguments": json.dumps(
                {"learner_ids": ["kid-a"], "title": "x"})}},
            {"id": "call-2", "function": {"name": "draft_goal", "arguments": json.dumps(
                {"learner_ids": ["kid-b"], "title": "y"})}},
        ]}
        offers: list = []
        await teacher_assistant._run_tools(message, _context(), [], offers)

        self.assertEqual(len(offers), 2)
        self.assertNotEqual(offers[0]["id"], offers[1]["id"])

    async def test_a_tool_with_no_offer_adds_none(self):
        import json

        from app.agents import teacher_assistant

        message = {"tool_calls": [{
            "id": "call-1",
            "function": {"name": "list_available_data", "arguments": "{}"},
        }]}
        offers: list = []
        await teacher_assistant._run_tools(message, _context(), [], offers)
        self.assertEqual(offers, [])


if __name__ == "__main__":
    unittest.main()
