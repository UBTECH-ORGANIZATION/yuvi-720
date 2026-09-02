"""The lesson-shaped questions the assistant could not answer.

    python -m pytest tests/test_teacher_learning_tools.py -q

A teacher asked "תביא לי לפי הלומדות, מהי הלומדה שהכי התקשו בה" and was told
there was not enough data to answer with confidence. There was: the
`/teacher/learnings` screen has been reading `learning_analytics.group_learnings`
all along. The model simply had no door to it, and "I don't have that" is what
this assistant correctly says when no tool can fetch something.

So these tests are about the door and its shape:

* the ordering IS the answer — "hardest" has one definition in this product and
  the tool holds it, or two teachers asking the same question get two lessons;
* a lesson nobody has opened is not a lesson they did badly in;
* counts, never a ranking of children (MoE C5) — no learner id may leave here;
* and the task the answer leads to arrives as an OFFER, filled in from the
  conversation, that writes nothing until a teacher presses it.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.agents.teacher_tools import data_tools, install, registry     # noqa: E402

install()


def _context(**overrides):
    from app.services.ai_usage import UsageContext

    kwargs = {
        "teacher_id": "teacher-a", "language": "he",
        "allowed_group_ids": frozenset({"group-1"}),
        "allowed_learner_ids": frozenset({"kid-a", "kid-b"}),
        "is_admin": False,
        **overrides,
    }
    return registry.TeacherToolContext(
        usage_context=UsageContext(
            actor_id="teacher-a", actor_type="teacher",
            endpoint="/api/teacher/assistant", feature="feature_6_teacher_view",
            operation="teacher_assistant.round_0", source="teacher_assistant",
        ),
        **kwargs,
    )


async def _dispatch(name, args, *, in_scope=True):
    """One tool call, with the live DB half of the scope gate stubbed.

    `registry._authorize` checks the resolved set AND asks the database again,
    so a link revoked mid-conversation lands immediately. With no database that
    second check refuses everything — which is the right failure, and not the
    one under test here.
    """
    with patch("app.brain.org.teacher_can_access_group",
               AsyncMock(return_value=in_scope)), \
         patch("app.brain.org.teacher_can_access_learner",
               AsyncMock(return_value=in_scope)), \
         patch("app.agents.teacher_tools.registry._audit", AsyncMock()):
        return await registry.dispatch(name, args, _context())


def _learning(component_id, *, title, rate, attempts=20, started=True, **extra):
    return {
        "component_id": component_id, "title": title, "unit_title": "יחידה",
        "objective_title": "יעד", "subject": "math", "is_assessment": False,
        "learners_engaged": 5, "group_size": 6, "attempts": attempts,
        "correct": int((rate or 0) * attempts), "success_rate": rate,
        "struggling_count": 2, "hints_used": 3, "explanations_used": 1,
        "avg_minutes_per_learner": 4.5, "timing_available": True,
        "last_activity_at": "2026-08-01T10:00:00Z", "hard_questions": [],
        "started": started, **extra,
    }


def _view(*rows):
    return {
        "group_id": "group-1", "learnings": list(rows), "subjects": ["math"],
        "totals": {"learnings": sum(1 for row in rows if row["started"]),
                   "catalog_total": len(rows), "attempts": 40, "correct": 20,
                   "success_rate": 0.5, "group_size": 6},
    }


class TheHardestLearning(unittest.IsolatedAsyncioTestCase):
    async def _call(self, view, **args):
        with patch("app.services.learning_analytics.group_learnings",
                   AsyncMock(return_value=view)):
            return await _dispatch(
                "get_group_learnings", {"group_id": "group-1", **args})

    async def test_lowest_success_rate_comes_first(self):
        result = await self._call(_view(
            _learning("c-easy", title="קל", rate=0.9),
            _learning("c-hard", title="קשה", rate=0.31),
            _learning("c-mid", title="בינוני", rate=0.62),
        ))
        titles = [row["title"] for row in result["data"]["learnings"]]
        self.assertEqual(titles[0], "קשה")
        self.assertEqual(result["data"]["sorted_by"], "hardest")

    async def test_a_learning_with_no_rate_is_unknown_not_hardest(self):
        # `success_rate: None` means nobody answered anything in it. Sorting it
        # to the top would name a lesson the class never worked as their worst.
        result = await self._call(_view(
            _learning("c-none", title="בלי נתונים", rate=None, attempts=0),
            _learning("c-hard", title="קשה", rate=0.3),
        ))
        titles = [row["title"] for row in result["data"]["learnings"]]
        self.assertEqual(titles[0], "קשה")
        self.assertEqual(titles[-1], "בלי נתונים")

    async def test_untouched_catalogue_rows_are_counted_not_listed(self):
        result = await self._call(_view(
            _learning("c-1", title="נלמד", rate=0.4),
            _learning("c-2", title="לא נפתח", rate=None, attempts=0, started=False),
            _learning("c-3", title="גם לא", rate=None, attempts=0, started=False),
        ))
        self.assertEqual(len(result["data"]["learnings"]), 1)
        self.assertEqual(result["data"]["not_started_in_catalog"], 2)

    async def test_a_class_that_has_opened_nothing_says_so(self):
        result = await self._call(_view(
            _learning("c-2", title="לא נפתח", rate=None, attempts=0, started=False),
        ))
        # Explicit emptiness — never an empty list a model reads as a zero.
        self.assertIsNone(result["data"])
        self.assertEqual(result["reason"], "no_learning_activity_yet")

    async def test_most_recent_is_a_different_ordering(self):
        old = _learning("c-old", title="ישן", rate=0.2)
        old["last_activity_at"] = "2026-07-01T09:00:00Z"
        new = _learning("c-new", title="חדש", rate=0.8)
        new["last_activity_at"] = "2026-08-09T09:00:00Z"
        result = await self._call(_view(old, new), sort="most_recent")
        self.assertEqual(result["data"]["learnings"][0]["title"], "חדש")

    async def test_an_invented_sort_is_named_rather_than_silently_reordered(self):
        # The registry's schema check gets here first, which is the better
        # outcome: the model is told its argument was wrong and can retry,
        # instead of reading a differently-ordered list as the one it asked for.
        result = await self._call(_view(
            _learning("c-easy", title="קל", rate=0.9),
            _learning("c-hard", title="קשה", rate=0.3),
        ), sort="by_vibes")
        self.assertEqual(result["error"], "invalid_argument_value:sort")

    async def test_no_sort_at_all_means_hardest(self):
        result = await self._call(_view(
            _learning("c-easy", title="קל", rate=0.9),
            _learning("c-hard", title="קשה", rate=0.3),
        ))
        self.assertEqual(result["data"]["sorted_by"], "hardest")
        self.assertEqual(result["data"]["learnings"][0]["title"], "קשה")

    async def test_the_list_is_bounded(self):
        rows = [_learning(f"c-{index}", title=f"שיעור {index}", rate=index / 100)
                for index in range(40)]
        result = await self._call(_view(*rows))
        self.assertLessEqual(len(result["data"]["learnings"]),
                             data_tools.MAX_LEARNING_ROWS)


class NoChildIsNamed(unittest.IsolatedAsyncioTestCase):
    """Counts, never a ranking of students — and never a name, ever."""

    async def test_no_learner_id_or_name_survives_the_tool(self):
        row = _learning("c-1", title="שברים", rate=0.4)
        row["learner_ids"] = ["kid-a", "kid-b"]
        row["display_name"] = "גל"
        with patch("app.services.learning_analytics.group_learnings",
                   AsyncMock(return_value=_view(row))):
            result = await _dispatch("get_group_learnings", {"group_id": "group-1"})
        rendered = repr(result)
        self.assertNotIn("גל", rendered)
        self.assertNotIn("display_name", rendered)
        self.assertNotIn("kid-a", rendered)
        # What remains is the count, which is the answer a teacher can act on.
        self.assertEqual(result["data"]["learnings"][0]["struggling_count"], 2)


class InsideOneLearning(unittest.IsolatedAsyncioTestCase):
    def _detail(self, started=True):
        return {
            "group_id": "group-1",
            "learning": _learning("c-1", title="שברים", rate=0.42, started=started),
            "questions": [
                {"question_id": "q1", "label": {"question": "שאלה 1", "screen": "מסך א"},
                 "attempts": 12, "correct": 3, "success_rate": 0.25, "learners": 5,
                 "hints_used": 4, "explanations_used": 2, "teaches": "שברים"},
                {"question_id": "q2", "label": {"question": "שאלה 2", "screen": "מסך א"},
                 "attempts": 10, "correct": 9, "success_rate": 0.9, "learners": 5,
                 "hints_used": 0, "explanations_used": 0, "teaches": "שברים"},
                {"question_id": "q3", "label": {"question": "שאלה 3"},
                 "attempts": 0, "correct": 0, "success_rate": None, "learners": 0},
            ],
            "screens": [],
        }

    async def test_the_worst_question_comes_first_and_unanswered_ones_are_dropped(self):
        with patch("app.services.learning_analytics.learning_detail",
                   AsyncMock(return_value=self._detail())):
            result = await _dispatch(
                "get_learning_detail", {"group_id": "group-1", "component_id": "c-1"})
        questions = result["data"]["hardest_questions"]
        self.assertEqual(questions[0]["question"], "שאלה 1")
        # A question nobody reached is not a question they got wrong.
        self.assertEqual(len(questions), 2)

    async def test_a_learning_nobody_opened_is_named_as_such(self):
        with patch("app.services.learning_analytics.learning_detail",
                   AsyncMock(return_value=self._detail(started=False))):
            result = await _dispatch(
                "get_learning_detail", {"group_id": "group-1", "component_id": "c-1"})
        self.assertIsNone(result["data"])
        self.assertEqual(result["reason"], "nobody_has_opened_this_learning")

    async def test_another_teachers_group_is_refused(self):
        with patch("app.brain.org.teacher_can_access_group", AsyncMock(return_value=False)):
            result = await registry.dispatch(
                "get_learning_detail",
                {"group_id": "group-9", "component_id": "c-1"}, _context())
        self.assertEqual(result["error"], "not_authorized")


class DraftingATask(unittest.IsolatedAsyncioTestCase):
    """The offer the answer leads to. It fills a form; it never creates a task."""

    def _catalog(self, subjects=("math", "science"), component=None):
        return [
            patch("app.services.kata_catalog.ensure_loaded", AsyncMock(return_value=None)),
            patch("app.services.kata_catalog.subjects", lambda: list(subjects)),
            patch("app.services.kata_catalog.get_component", lambda _id: component),
        ]

    async def _draft(self, args, **catalog):
        entered = self._catalog(**catalog)
        for item in entered:
            item.start()
        try:
            return await _dispatch("draft_task", args)
        finally:
            for item in reversed(entered):
                item.stop()

    async def test_a_full_draft_becomes_one_offer(self):
        result = await self._draft({
            "title": "תרגול שברים", "topic": "חיבור שברים עם מכנה שונה",
            "subject": "math", "components": ["practice", "presentation"],
        })
        offer = result["offer"]
        self.assertEqual(offer["kind"], "draft_task")
        self.assertEqual(offer["missing"], [])
        # Ordered as a child meets them, not as the model happened to list them.
        self.assertEqual(offer["components"], ["presentation", "practice"])

    async def test_a_subject_with_no_material_is_dropped_and_asked_for(self):
        # A task filed under a subject the catalogue does not have is a task the
        # tasks list can never filter to — it is lost the moment it is made.
        result = await self._draft({
            "title": "משימה", "topic": "משהו", "subject": "astrology",
        })
        self.assertEqual(result["offer"]["subject"], "")
        self.assertIn("subject", result["offer"]["missing"])

    async def test_a_lesson_that_does_not_exist_is_dropped(self):
        result = await self._draft(
            {"title": "משימה", "topic": "משהו", "subject": "math",
             "source_component_id": "not-a-lesson"},
            component=None)
        self.assertEqual(result["offer"]["source_component_id"], "")

    async def test_a_real_lesson_is_kept_and_answers_the_subject(self):
        result = await self._draft(
            {"title": "משימה", "source_component_id": "kata-c-77"},
            component={"id": "kata-c-77", "subject": "science"})
        offer = result["offer"]
        self.assertEqual(offer["source_component_id"], "kata-c-77")
        self.assertEqual(offer["subject"], "science")
        # The lesson IS the subject matter — nothing else is missing.
        self.assertEqual(offer["missing"], [])

    async def test_a_retired_component_name_cannot_reach_the_generator(self):
        result = await self._draft({
            "title": "משימה", "topic": "משהו", "subject": "math",
            "components": ["interactive", "quiz"],
        })
        # Neither survives, and the default stands rather than an empty task.
        self.assertEqual(result["offer"]["components"], ["practice"])

    async def test_a_bare_title_reports_what_it_still_needs(self):
        result = await self._draft({"title": "משהו"})
        self.assertEqual(set(result["offer"]["missing"]), {"subject", "subject_matter"})

    async def test_it_creates_nothing(self):
        writes = {
            "app.services.tasks.store.create_task": AsyncMock(),
            "app.services.tasks.generate.generate_task": AsyncMock(),
        }
        entered = [patch(target, mock) for target, mock in writes.items()]
        for item in entered:
            item.start()
        try:
            await self._draft({"title": "משימה", "topic": "נושא", "subject": "math"})
        finally:
            for item in reversed(entered):
                item.stop()
        for target, mock in writes.items():
            self.assertEqual(mock.await_count, 0, f"{target} was called by a draft")


class TheRegistryStaysHonest(unittest.IsolatedAsyncioTestCase):
    async def test_the_new_tools_are_in_the_manifest_the_assistant_offers(self):
        names = {row["name"] for row in registry.manifest()}
        self.assertIn("get_group_learnings", names)
        self.assertIn("get_learning_detail", names)
        self.assertIn("draft_task", names)

    async def test_every_learning_tool_declares_its_group_argument(self):
        # The scope gate checks DECLARED arguments. A tool that takes a group id
        # without declaring it is a tool that skips the check.
        for name in ("get_group_learnings", "get_learning_detail"):
            tool = registry.get(name)
            self.assertIn("group_id", tool.group_args, name)


if __name__ == "__main__":
    unittest.main()


class WhoIsInsideALearning(unittest.IsolatedAsyncioTestCase):
    """#536: "מי התנסה בלומדה / מי מתקשה בה" used to get a count and a shrug."""

    async def test_the_tool_returns_ids_by_a_stated_rule(self):
        view = {"component_id": "c-hard", "group_size": 3,
                "tried": ["kid-a", "kid-b"], "struggling": ["kid-b"],
                "solved_everything": ["kid-a"], "not_started": ["kid-c"],
                "evidence": {"struggle_min_attempts": 3, "struggle_max_success": 0.5}}
        with patch("app.services.learning_analytics.learners_in_learning",
                   AsyncMock(return_value=view)):
            result = await _dispatch(
                "get_learning_learners", {"group_id": "group-1", "component_id": "c-hard"})
        self.assertEqual(result["data"]["struggling"], ["kid-b"])
        self.assertEqual(result["data"]["tried"], ["kid-a", "kid-b"])
        self.assertNotIn("display_name", str(result))

    async def test_a_learning_nobody_opened_is_empty_not_a_list_of_nobody(self):
        view = {"component_id": "c-new", "group_size": 3, "tried": [], "struggling": [],
                "solved_everything": [], "not_started": ["kid-a", "kid-b", "kid-c"],
                "evidence": {}}
        with patch("app.services.learning_analytics.learners_in_learning",
                   AsyncMock(return_value=view)):
            result = await _dispatch(
                "get_learning_learners", {"group_id": "group-1", "component_id": "c-new"})
        self.assertIsNone(result["data"])
        self.assertEqual(result["reason"], "nobody_has_opened_this_learning")

    async def test_the_analytics_judge_struggling_exactly_as_the_listing_counts(self):
        from app.services import learning_analytics as la
        rows = [
            ("kid-a", [{"component_id": "c1", "attempts": 4, "correct": 4}]),
            ("kid-b", [{"component_id": "c1", "attempts": 6, "correct": 1}]),      # struggling
            ("kid-c", [{"component_id": "c1", "attempts": 1, "correct": 0}]),      # too few to judge
            ("kid-d", [{"component_id": "c2", "attempts": 9, "correct": 0}]),      # other lesson
        ]
        with patch.object(la, "_per_learner_rows", AsyncMock(return_value=rows)), \
             patch("app.brain.org.learners_in_group",
                   AsyncMock(return_value=["kid-a", "kid-b", "kid-c", "kid-d"])):
            view = await la.learners_in_learning("group-1", "c1")
        self.assertEqual(view["tried"], ["kid-a", "kid-b", "kid-c"])
        self.assertEqual(view["struggling"], ["kid-b"])
        self.assertEqual(view["solved_everything"], ["kid-a"])
        self.assertEqual(view["not_started"], ["kid-d"])


class TheSubjectFilterKnowsItsNames(unittest.IsolatedAsyncioTestCase):
    """#539: 125 attempts on linear equations answered "no math activity"."""

    def test_teacher_words_map_to_catalogue_ids(self):
        self.assertEqual(data_tools.normalize_subject("מתמטיקה"), "math")
        self.assertEqual(data_tools.normalize_subject("הנדסה"), "math")
        self.assertEqual(data_tools.normalize_subject("Math"), "math")
        self.assertEqual(data_tools.normalize_subject("מדעים"), "science")
        self.assertIsNone(data_tools.normalize_subject(""))
        self.assertEqual(data_tools.normalize_subject("history"), "history")

    async def test_an_empty_filter_falls_back_to_the_whole_picture_labelled(self):
        wide = {"progress": {"math": {"percent": 40, "objectives_mastered": 2,
                                      "objectives_in_progress": 3}},
                "struggle_items": [{"label": "משוואות", "subject": "math"}]}
        calls = []

        async def insights(learner_id, language="he", subject=None):
            calls.append(subject)
            return {"progress": {}, "struggle_items": []} if subject else wide

        with patch("app.services.insights.student_insights", AsyncMock(side_effect=insights)):
            result = await _dispatch(
                "get_student_overview", {"learner_id": "kid-a", "subject": "הנדסה"})
        self.assertEqual(calls, ["math", None])
        self.assertEqual(result["data"]["subject_filter_ignored"], "math")
        self.assertEqual(result["data"]["subjects_with_activity"], ["math"])
        self.assertIn("progress", result["data"])

    async def test_a_child_with_no_activity_anywhere_still_says_so(self):
        with patch("app.services.insights.student_insights",
                   AsyncMock(return_value={"progress": {}, "struggle_items": []})):
            result = await _dispatch(
                "get_student_overview", {"learner_id": "kid-a", "subject": "math"})
        self.assertIsNone(result["data"])
        self.assertEqual(result["reason"], "learner_has_no_activity")



class WellbeingLeavesItsWordsOnTheProfile(unittest.IsolatedAsyncioTestCase):
    """#538: the chat said "עלה משפט על גירושי ההורים", verbatim, from a flag."""

    def test_a_flag_is_projected_to_its_shape(self):
        from app.agents.teacher_tools.wellbeing_projection import soften_wellbeing
        payload = {
            "attention": {"kind": "wellbeing", "reason": "שיתף/ה מצוקה",
                          "evidence": "עלה משפט על גירושי ההורים",
                          "raw_evidence": {"at": "2026-08-27", "category": "distress"}},
            "wellbeing_flags": [{"evidence": "ההורים שלי מתגרשים", "at": "2026-08-27",
                                 "source": "coach_chat", "category": "distress"}],
            "attention_all": [{"kind": "rapid_guessing", "evidence": "4 תשובות מהירות מדי"}],
        }
        out = soften_wellbeing(payload, "he")
        text = str(out)
        self.assertNotIn("גירוש", text)
        self.assertNotIn("מתגרשים", text)
        self.assertTrue(out["attention"]["detail_on_profile"])
        self.assertEqual(out["wellbeing_flags"][0]["at"], "2026-08-27")
        # Academic evidence is untouched — it is a number, not a confidence.
        self.assertEqual(out["attention_all"][0]["evidence"], "4 תשובות מהירות מדי")

    async def test_the_overview_tool_never_ships_the_words(self):
        wide = {"progress": {"math": {"percent": 40}}, "struggle_items": [],
                "attention": {"kind": "wellbeing", "evidence": "משפט על גירושי ההורים"},
                "wellbeing_flags": [{"evidence": "משפט על גירושי ההורים", "category": "distress"}]}
        with patch("app.services.insights.student_insights", AsyncMock(return_value=wide)):
            result = await _dispatch("get_student_overview", {"learner_id": "kid-a"})
        self.assertNotIn("גירוש", str(result))
        self.assertTrue(result["data"]["attention"]["detail_on_profile"])


class ActivityWithoutMasteryIsStillActivity(unittest.IsolatedAsyncioTestCase):
    """#539: 125 attempts on linear equations, no mastery entry yet → the
    overview must say WHERE the child has been working, not "no activity"."""

    async def test_attempts_fold_by_subject_when_insights_are_empty(self):
        rows = [
            {"objective_id": "MOE.MATH.LIN-1", "subject": "math", "attempts": 100, "correct": 60,
             "last_at": "2026-08-25T10:00:00Z"},
            {"objective_id": "MOE.MATH.LIN-1", "subject": "math", "attempts": 25, "correct": 13,
             "last_at": "2026-08-20T10:00:00Z"},
        ]
        with patch("app.services.insights.student_insights",
                   AsyncMock(return_value={"progress": {}, "struggle_items": []})), \
             patch("app.services.learner_activity.question_summary",
                   AsyncMock(side_effect=lambda lid, subject=None:
                             rows if subject in (None, "math") else [])), \
             patch("app.services.kata_catalog.get_objective",
                   return_value={"title": "פתרון משוואות ליניאריות"}):
            asked_math = await _dispatch(
                "get_student_overview", {"learner_id": "kid-a", "subject": "מתמטיקה"})
            asked_geometry = await _dispatch(
                "get_student_overview", {"learner_id": "kid-a", "subject": "הנדסה"})
        math = asked_math["data"]["activity_by_subject"]["math"]
        self.assertEqual((math["attempts"], math["correct"]), (125, 73))
        self.assertEqual(math["last_at"], "2026-08-25T10:00:00Z")
        self.assertEqual(math["objectives"][0]["title"], "פתרון משוואות ליניאריות")
        # Geometry is math in the catalogue: same answer, and no "no activity".
        self.assertEqual(asked_geometry["data"]["subjects_with_activity"], ["math"])
