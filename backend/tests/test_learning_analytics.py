"""Group learning analytics: catalogue spine, aggregation honesty, C5 no-names."""

from __future__ import annotations

import json
import sys
import unittest
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def _row(component_id: str, question_id: str, *, attempts: int, correct: int,
         seconds: float = 0, hints: int = 0, last_at: str = "2026-08-01T10:00:00Z"):
    return {
        "question_key": f"{component_id}|item-1|{question_id}",
        "component_id": component_id,
        "item_id": "item-1",
        "question_id": question_id,
        "objective_id": "obj-1",
        "subject": "math",
        "attempts": attempts,
        "correct": correct,
        "time_seconds": seconds,
        "hints_used": hints,
        "content_hints_used": 0,
        "explanations_used": 0,
        "different_way_used": 0,
        "chat_turns": 0,
        "helped_reported": [],
        "first_at": "2026-08-01T09:00:00Z",
        "last_at": last_at,
    }


# Two published learnings; the fixtures below only ever touch cmp-1.
CATALOG = [
    {"id": "cmp-1", "title": "הקנייה א", "unit_id": "unit-1", "objective_id": "obj-1",
     "subject": "math", "estimated_minutes": 20, "order": 1,
     "questions_by_item": {"item-1": [{"questionId": "q1"}, {"questionId": "q2"}]}},
    {"id": "cmp-2", "title": "תרגול ב", "unit_id": "unit-1", "objective_id": "obj-1",
     "subject": "math", "estimated_minutes": 15, "order": 2,
     "questions_by_item": {"item-9": [{"questionId": "q1"}]}},
]

UNITS = {"unit-1": {"id": "unit-1", "title": "יחידה", "titles": {}, "subject": "math"}}


def _catalog_patches(stack: ExitStack):
    p = "app.services.kata_catalog."
    stack.enter_context(patch(p + "ensure_loaded", AsyncMock()))
    stack.enter_context(patch(p + "all_components", return_value=CATALOG))
    stack.enter_context(patch(p + "get_unit", side_effect=lambda uid: UNITS.get(uid)))
    # Lesson names now resolve through `component_title`, which reads the
    # catalogue through `get_component` and then the translation store — Kata
    # ships `titleTranslations: null` on every component, so the locale-specific
    # name cannot come off the row.
    stack.enter_context(patch(
        p + "get_component",
        side_effect=lambda cid: next((c for c in CATALOG if c["id"] == cid), None)))
    stack.enter_context(patch(
        p + "item_profiles",
        side_effect=lambda cid: [{"id": "item-1", "title": "מסך ראשון", "question_count": 2}]))
    stack.enter_context(patch(
        p + "item_profile",
        side_effect=lambda cid, iid: {"id": iid, "title": "מסך ראשון", "kind": "question"}))
    stack.enter_context(patch(p + "kind_for_row", return_value="question"))
    stack.enter_context(patch(
        p + "question_item_ordinals", return_value={"item-1|q-hard": 3, "item-1": 3}))
    stack.enter_context(patch(p + "question_part_indexes", return_value={}))
    stack.enter_context(patch(
        p + "localized_objective_title", side_effect=lambda oid, lang: f"title:{oid}"))
    # The screen-facing half. Everything a teacher reads goes through this one.
    stack.enter_context(patch(
        p + "objective_title", side_effect=lambda oid, lang=None: f"title:{oid}"))


class GroupLearnings(unittest.IsolatedAsyncioTestCase):
    async def _run(self, per_learner: dict[str, list[dict]], **kwargs):
        from app.services import learning_analytics

        async def _summary(learner_id, subject=None, component_id=None):
            return per_learner.get(learner_id, [])

        with ExitStack() as stack:
            stack.enter_context(patch("app.brain.org.learners_in_group",
                                      AsyncMock(return_value=list(per_learner))))
            stack.enter_context(patch("app.services.learner_activity.question_summary",
                                      side_effect=_summary))
            _catalog_patches(stack)
            return await learning_analytics.group_learnings("g1", language="he", **kwargs)

    async def test_untouched_learnings_are_listed_as_not_started(self):
        view = await self._run({"kid-a": [_row("cmp-1", "q1", attempts=2, correct=2)]})
        by_id = {row["component_id"]: row for row in view["learnings"]}
        self.assertEqual(set(by_id), {"cmp-1", "cmp-2"})
        self.assertTrue(by_id["cmp-1"]["started"])
        # The lesson nobody opened is present and honest about it.
        self.assertFalse(by_id["cmp-2"]["started"])
        self.assertEqual(by_id["cmp-2"]["attempts"], 0)
        self.assertIsNone(by_id["cmp-2"]["success_rate"])
        self.assertEqual(by_id["cmp-2"]["title"], "תרגול ב")
        # Totals count real work only; the catalogue size is reported separately.
        self.assertEqual(view["totals"]["learnings"], 1)
        self.assertEqual(view["totals"]["catalog_total"], 2)

    async def test_aggregates_across_learners_without_naming_them(self):
        view = await self._run({
            "kid-a": [_row("cmp-1", "q1", attempts=3, correct=3, seconds=120)],
            "kid-b": [_row("cmp-1", "q1", attempts=4, correct=0, seconds=300, hints=2)],
        })
        learning = next(r for r in view["learnings"] if r["component_id"] == "cmp-1")
        self.assertEqual(learning["learners_engaged"], 2)
        self.assertEqual(learning["attempts"], 7)
        self.assertEqual(learning["correct"], 3)
        self.assertEqual(learning["hints_used"], 2)
        # kid-b worked hard (4 attempts) and failed everything → one struggler.
        self.assertEqual(learning["struggling_count"], 1)
        # MoE C5: the payload never carries a learner id anywhere.
        self.assertNotIn("kid-a", json.dumps(view))
        self.assertNotIn("kid-b", json.dumps(view))

    async def test_no_timing_evidence_reports_none_not_zero(self):
        view = await self._run({"kid-a": [_row("cmp-1", "q1", attempts=2, correct=1, seconds=0)]})
        learning = next(r for r in view["learnings"] if r["component_id"] == "cmp-1")
        self.assertFalse(learning["timing_available"])
        self.assertIsNone(learning["total_minutes"])
        self.assertIsNone(learning["avg_minutes_per_learner"])
        self.assertIsNone(view["totals"]["total_minutes"])

    async def test_hard_questions_are_labelled_and_evidenced(self):
        view = await self._run({
            # q-hard: 5 class attempts, 1 correct → hard. q-fine: high success.
            # q-thin: only 2 attempts — never flagged on thin evidence.
            "kid-a": [
                _row("cmp-1", "q-hard", attempts=3, correct=1),
                _row("cmp-1", "q-fine", attempts=4, correct=4),
                _row("cmp-1", "q-thin", attempts=2, correct=0),
            ],
            "kid-b": [_row("cmp-1", "q-hard", attempts=2, correct=0)],
        })
        learning = next(r for r in view["learnings"] if r["component_id"] == "cmp-1")
        hard = learning["hard_questions"]
        self.assertEqual([row["question_id"] for row in hard], ["q-hard"])
        self.assertEqual(hard[0]["attempts"], 5)
        self.assertEqual(hard[0]["learners"], 2)
        # A teacher must be able to tell WHICH question this is.
        self.assertEqual(hard[0]["ordinal"], 3)
        self.assertEqual(hard[0]["screen_title"], "מסך ראשון")

    async def test_subject_filter_narrows_the_catalogue(self):
        view = await self._run({"kid-a": []}, subject="science")
        self.assertEqual(view["learnings"], [])
        view_math = await self._run({"kid-a": []}, subject="math")
        self.assertEqual(len(view_math["learnings"]), 2)

    async def test_the_offered_subjects_survive_being_filtered_by_one(self):
        """Picking a subject must not delete the other subjects from the list.

        `subjects` used to be read off the already-narrowed rows, so choosing
        "math" returned `["math"]` — the control that had just been used to
        filter erased every other way back out of the filter.
        """
        rows = {"kid-a": [{**_row("gone-1", "q1", attempts=2, correct=0),
                           "subject": "language_arts"}]}
        wide = await self._run(rows)
        self.assertEqual(wide["subjects"], ["language_arts", "math"])
        narrowed = await self._run(rows, subject="math")
        self.assertEqual(narrowed["subjects"], ["language_arts", "math"])

    async def test_a_hidden_subject_never_reaches_the_screen(self):
        """English is not running this year — its rows and its chip both go.

        The rows are normally dropped at the `question_summary` seam; this
        exercises the listing's own guard, because a row that slipped past
        would grow its own subject section on the screen.
        """
        rows = {"kid-a": [{**_row("gone-eng", "q1", attempts=3, correct=1),
                           "subject": "english"}]}
        view = await self._run(rows)
        self.assertEqual(view["subjects"], ["math"])
        self.assertNotIn(
            "english", {row.get("subject") for row in view["learnings"]})


class ClassSubjects(unittest.IsolatedAsyncioTestCase):
    """What the scope bar is allowed to offer."""

    async def _subjects(self, per_learner: dict[str, list[dict]], *, group_id="g1"):
        from app.services import learning_analytics

        # The answer is cached per class for ten minutes, which is right in a
        # process and wrong across tests that all fold different fixtures for
        # the same class.
        learning_analytics._subjects_cache.clear()

        async def _summary(learner_id, subject=None, component_id=None):
            return per_learner.get(learner_id, [])

        with ExitStack() as stack:
            stack.enter_context(patch("app.brain.org.learners_in_group",
                                      AsyncMock(return_value=list(per_learner))))
            stack.enter_context(patch("app.services.learner_activity.question_summary",
                                      side_effect=_summary))
            _catalog_patches(stack)
            return await learning_analytics.class_subjects(group_id, language="he")

    async def test_a_class_with_no_history_still_has_its_catalogue(self):
        # Nothing worked yet is not "no subjects": the material exists, and a
        # teacher planning next week narrows by it before anyone has opened it.
        self.assertEqual(await self._subjects({"kid-a": []}), ["math"])

    async def test_a_subject_only_the_class_history_knows_is_offered(self):
        """A vendor-tagged subject reaches a teacher through here or not at all.

        `kata_client.subject_from_objective` collapses everything that is not
        SCI or MATH into `other`, so the published catalogue cannot name such a
        subject. The only place the real tag survives is a row for a component
        the catalogue no longer publishes — which is why this list is folded
        from observed rows and not read off the spine.
        """
        subjects = await self._subjects({
            "kid-a": [{**_row("gone-la", "q1", attempts=3, correct=1),
                       "subject": "language_arts"}],
            "kid-b": [_row("cmp-1", "q1", attempts=2, correct=2)],
        })
        self.assertEqual(subjects, ["language_arts", "math"])

    async def test_a_hidden_subject_is_never_offered(self):
        # English is hidden this year (`learner_activity.HIDDEN_SUBJECTS`):
        # even history that carries its tag must not put a chip in the bar.
        subjects = await self._subjects({
            "kid-a": [{**_row("gone-eng", "q1", attempts=3, correct=1),
                       "subject": "english"}],
            "kid-b": [_row("cmp-1", "q1", attempts=2, correct=2)],
        })
        self.assertEqual(subjects, ["math"])

    async def test_one_class_is_folded_once_per_window_not_once_per_page(self):
        """The scope bar asks on every teacher page load.

        Without the cache, the cost of opening the learnings screen — every
        learner's rows, folded — sits behind opening any screen at all.
        """
        from app.services import learning_analytics

        learning_analytics._subjects_cache.clear()
        calls = 0

        async def _summary(learner_id, subject=None, component_id=None):
            nonlocal calls
            calls += 1
            return []

        with ExitStack() as stack:
            stack.enter_context(patch("app.brain.org.learners_in_group",
                                      AsyncMock(return_value=["kid-a", "kid-b"])))
            stack.enter_context(patch("app.services.learner_activity.question_summary",
                                      side_effect=_summary))
            _catalog_patches(stack)
            first = await learning_analytics.class_subjects("g1", language="he")
            second = await learning_analytics.class_subjects("g1", language="he")
            # A second class is its own answer, not the first one reused.
            await learning_analytics.class_subjects("g2", language="he")

        self.assertEqual(first, second)
        self.assertEqual(calls, 4)  # two learners, twice: g1 once and g2 once

    async def test_a_caller_cannot_edit_the_next_callers_answer(self):
        # The cached list is handed out by value; a client that sorts or appends
        # to what it got back must not be editing everyone else's copy.
        from app.services import learning_analytics

        subjects = await self._subjects({"kid-a": []}, group_id="g9")
        subjects.append("hacked")
        with ExitStack() as stack:
            stack.enter_context(patch("app.brain.org.learners_in_group",
                                      AsyncMock(return_value=[])))
            _catalog_patches(stack)
            again = await learning_analytics.class_subjects("g9", language="he")
        self.assertEqual(again, ["math"])

    async def test_an_untagged_row_adds_no_blank_option(self):
        # A blank segment in the bar is unreadable and unclearable.
        subjects = await self._subjects({
            "kid-a": [{**_row("gone-2", "q1", attempts=1, correct=0), "subject": None}],
        })
        self.assertEqual(subjects, ["math"])


class LearningDetail(unittest.IsolatedAsyncioTestCase):
    async def _detail(self, rows, *, topics=None):
        from app.services import learning_analytics

        async def _summary(learner_id, subject=None, component_id=None):
            return rows.get(learner_id, [])

        with ExitStack() as stack:
            stack.enter_context(patch("app.brain.org.learners_in_group",
                                      AsyncMock(return_value=list(rows))))
            stack.enter_context(patch("app.services.learner_activity.question_summary",
                                      side_effect=_summary))
            stack.enter_context(patch("app.services.question_topics.topics_for",
                                      AsyncMock(return_value=topics or {})))
            _catalog_patches(stack)
            return await learning_analytics.learning_detail("g1", "cmp-1", language="he")

    async def test_detail_returns_questions_and_difficulties(self):
        # kid-a really worked at q1 and never got it; kid-b solved it. The
        # question is hard (6 attempts, 50% ≤ 60%) and the difficulty row must
        # name exactly the learner who tried and never succeeded.
        view = await self._detail({
            "kid-a": [_row("cmp-1", "q1", attempts=4, correct=0, seconds=200)],
            "kid-b": [_row("cmp-1", "q1", attempts=2, correct=2, seconds=60)],
        })

        self.assertEqual(view["learning"]["title"], "הקנייה א")
        self.assertEqual(view["learning"]["attempts"], 6)
        self.assertEqual(len(view["questions"]), 1)
        self.assertEqual(view["questions"][0]["attempts"], 6)
        self.assertEqual(view["questions"][0]["learners"], 2)
        # The screens spine is gone — the difficulties replaced it (#455).
        self.assertNotIn("screens", view)
        self.assertEqual(len(view["difficulties"]), 1)
        difficulty = view["difficulties"][0]
        self.assertEqual(difficulty["learner_ids"], ["kid-a"])
        self.assertEqual(difficulty["evidence"]["tried_count"], 2)
        self.assertEqual(difficulty["evidence"]["failed_count"], 1)

    async def test_learner_ids_appear_nowhere_but_the_difficulties(self):
        # The C5 exception is exactly one field wide: strip
        # `difficulties[].learner_ids` and no learner id may remain anywhere.
        view = await self._detail({
            "kid-a": [_row("cmp-1", "q1", attempts=4, correct=0)],
            "kid-b": [_row("cmp-1", "q1", attempts=2, correct=2)],
        })
        stripped = json.loads(json.dumps(view))
        for row in stripped["difficulties"]:
            ids = row.pop("learner_ids")
            self.assertNotIn("kid-b", ids)  # solved it — a selection, not a roster echo
        self.assertNotIn("kid-a", json.dumps(stripped))
        self.assertNotIn("kid-b", json.dumps(stripped))

    async def test_topics_and_texts_ride_the_question_rows(self):
        view = await self._detail(
            {"kid-a": [_row("cmp-1", "q1", attempts=4, correct=0)]},
            topics={"cmp-1|item-1|q1": "זיהוי תוצאה חריגה"},
        )
        row = view["questions"][0]
        self.assertEqual(row["topic"], "זיהוי תוצאה חריגה")
        self.assertIn("question_text", row)
        # A key with no stored decision is what flips the pending flag off/on.
        self.assertFalse(view["topics_pending"])

    async def test_missing_topic_decisions_flip_pending(self):
        view = await self._detail(
            {"kid-a": [_row("cmp-1", "q1", attempts=4, correct=0)]},
            topics={},
        )
        self.assertTrue(view["topics_pending"])


class NamesReachTheScreen(unittest.IsolatedAsyncioTestCase):
    """Nothing internal may leave here wearing the costume of a name.

    Three of these shipped: an untitled component handed over its component id,
    an untitled unit handed over its unit id, and an objective the catalogue did
    not know handed over its dotted MOE key — because
    ``localized_objective_title`` falls back to the key, which is right for a
    log line and wrong for a heading.
    """

    async def _run(self, per_learner, *, catalog=None, units=None):
        from app.services import learning_analytics

        async def _summary(learner_id, subject=None, component_id=None):
            return per_learner.get(learner_id, [])

        with ExitStack() as stack:
            stack.enter_context(patch("app.brain.org.learners_in_group",
                                      AsyncMock(return_value=list(per_learner))))
            stack.enter_context(patch("app.services.learner_activity.question_summary",
                                      side_effect=_summary))
            _catalog_patches(stack)
            if catalog is not None:
                stack.enter_context(patch("app.services.kata_catalog.all_components",
                                          return_value=catalog))
            if units is not None:
                stack.enter_context(patch("app.services.kata_catalog.get_unit",
                                          side_effect=lambda uid: units.get(uid)))
            return await learning_analytics.group_learnings("g1", language="he")

    async def test_an_untitled_unit_does_not_become_a_section_heading(self):
        view = await self._run(
            {"kid-a": [_row("cmp-1", "q1", attempts=1, correct=1)]},
            units={"unit-1": {"id": "unit-1", "title": "", "titles": {}, "subject": "math"}})
        row = next(r for r in view["learnings"] if r["component_id"] == "cmp-1")
        # Null, not "unit-1": the id still travels in its own field, and the
        # client can label a null. It cannot label an id.
        self.assertIsNone(row["unit_title"])
        self.assertEqual(row["unit_id"], "unit-1")

    async def test_an_unknown_objective_is_null_not_its_dotted_key(self):
        # Against the REAL catalogue accessor, not a stub of it: the guard now
        # lives in `kata_catalog.objective_title`, and a test that patched the
        # thing under test would prove nothing.
        from app.services import kata_catalog, learning_analytics

        unknown = "MOE.ENG.G7.PEOPLE.FAMILY.SPEAK"
        with patch.dict(kata_catalog._SNAPSHOT, {"objectives": {}}, clear=False):
            # This is what the OTHER accessor still does, and why the pair exists.
            self.assertEqual(kata_catalog.localized_objective_title(unknown, "he"), unknown)
            self.assertIsNone(learning_analytics._objective_title(unknown, "he"))

        known = {unknown: {"titles": {"he": "דיבור על המשפחה"}}}
        with patch.dict(kata_catalog._SNAPSHOT, {"objectives": known}, clear=False):
            self.assertEqual(
                learning_analytics._objective_title(unknown, "he"), "דיבור על המשפחה")

        self.assertIsNone(learning_analytics._objective_title(None, "he"))

    async def test_a_row_off_the_catalogue_still_gets_its_objective_title(self):
        # The class worked in a component the catalogue no longer publishes, so
        # `title` can only be the id — but the OBJECTIVE is usually still known,
        # and that title is the only human name such a row can ever carry. It
        # used to be hard-coded None, which is how `ENG.G7.FAMILY.SPEAK-01`
        # reached a teacher as a title.
        view = await self._run({"kid-a": [_row("gone-1", "q1", attempts=2, correct=0)]})
        row = next(r for r in view["learnings"] if r["component_id"] == "gone-1")
        self.assertEqual(row["title"], "gone-1")
        self.assertEqual(row["objective_title"], "title:obj-1")
        self.assertEqual(row["subject"], "math")
        self.assertTrue(row["started"])

    async def test_the_detail_page_names_an_off_catalogue_learning_the_same_way(self):
        from app.services import learning_analytics

        rows = {"kid-a": [_row("gone-1", "q1", attempts=2, correct=0)]}

        async def _summary(learner_id, subject=None, component_id=None):
            return rows.get(learner_id, [])

        with ExitStack() as stack:
            stack.enter_context(patch("app.brain.org.learners_in_group",
                                      AsyncMock(return_value=list(rows))))
            stack.enter_context(patch("app.services.learner_activity.question_summary",
                                      side_effect=_summary))
            stack.enter_context(patch("app.services.question_topics.topics_for",
                                      AsyncMock(return_value={})))
            _catalog_patches(stack)
            view = await learning_analytics.learning_detail("g1", "gone-1", language="he")

        # The card and the page it opens must agree on what this is called.
        self.assertEqual(view["learning"]["objective_title"], "title:obj-1")
        self.assertEqual(view["learning"]["subject"], "math")
        self.assertIsNone(view["learning"]["unit_title"])


class OneLearnersRowsAreLabelled(unittest.IsolatedAsyncioTestCase):
    """`q1` is not the name of a question.

    The content numbers questions WITHIN a screen, so `q1` names a different
    question in every screen of a lesson — the student profile printed it four
    times down one table and a teacher could see that something went badly and
    not what it was. Everything attached here is authored content read out of
    the catalogue; nothing is inferred and nothing is generated.
    """

    def _labelled(self, rows):
        from app.services import learning_analytics

        with ExitStack() as stack:
            _catalog_patches(stack)
            stack.enter_context(patch(
                "app.services.kata_catalog.get_component",
                side_effect=lambda cid: next((c for c in CATALOG if c["id"] == cid), None)))
            stack.enter_context(patch(
                "app.services.kata_catalog.information_for_item",
                side_effect=lambda cid, iid: "מטרת הפריט: להבין מהי מסה"))
            return learning_analytics.label_learner_rows(rows, language="he")

    def test_a_row_carries_the_lesson_it_belongs_to(self):
        row = self._labelled([_row("cmp-1", "q1", attempts=2, correct=1)])[0]
        self.assertEqual(row["learning_title"], "הקנייה א")
        self.assertEqual(row["objective_title"], "title:obj-1")

    def test_the_question_number_is_the_one_on_screen(self):
        # `q-hard` on `item-1` is the content's third screen; the raw id says
        # nothing about that.
        row = self._labelled([_row("cmp-1", "q-hard", attempts=1, correct=0)])[0]
        self.assertEqual(row["ordinal"], 3)
        self.assertEqual(row["screen_title"], "מסך ראשון")

    def test_the_content_says_what_the_item_is_for(self):
        row = self._labelled([_row("cmp-1", "q1", attempts=1, correct=1)])[0]
        self.assertEqual(row["teaches"], "להבין מהי מסה")

    def test_an_untitled_lesson_hands_over_nothing_rather_than_its_id(self):
        # The client owns the "untitled" wording and already has one.
        row = self._labelled([_row("gone-1", "q1", attempts=1, correct=1)])[0]
        self.assertEqual(row["learning_title"], "")
        self.assertNotIn("gone-1", str(row["learning_title"]))

    def test_the_original_row_survives_intact(self):
        # Labels are added, never substituted: the counters are what the tab is
        # actually about.
        original = _row("cmp-1", "q1", attempts=4, correct=3, hints=2)
        row = self._labelled([original])[0]
        for key, value in original.items():
            self.assertEqual(row[key], value, key)

    def test_the_vendor_boilerplate_opener_is_dropped(self):
        from app.services.learning_analytics import _teaches

        self.assertEqual(_teaches("מטרת הפריט: להבין מהי מסה"), "להבין מהי מסה")
        self.assertEqual(_teaches("Item goal: understand mass"), "understand mass")
        # Only the opener, and only when it IS the opener.
        self.assertEqual(_teaches("להבין מהי מטרת הפריט: כאן"), "להבין מהי מטרת הפריט: כאן")
        self.assertIsNone(_teaches(None))
        self.assertIsNone(_teaches("   "))


class GroupLearningsRoute(unittest.IsolatedAsyncioTestCase):
    async def test_out_of_scope_teacher_is_refused_with_no_reads(self):
        from app.routes import teacher_students as routes

        with patch.object(routes, "_guard_group", AsyncMock(return_value=False)), \
             patch("app.services.learning_analytics.group_learnings",
                   AsyncMock()) as engine:
            response = await routes.group_learnings(
                "g1", subject=None, language="he", session={"sub": "teacher-1"})
        self.assertEqual(response.status_code, 403)
        engine.assert_not_awaited()

    async def test_detail_route_is_scoped_too(self):
        from app.routes import teacher_students as routes

        with patch.object(routes, "_guard_group", AsyncMock(return_value=False)), \
             patch("app.services.learning_analytics.learning_detail",
                   AsyncMock()) as engine:
            response = await routes.group_learning_detail(
                "g1", "cmp-1", language="he", session={"sub": "teacher-1"})
        self.assertEqual(response.status_code, 403)
        engine.assert_not_awaited()

    async def test_topics_generation_is_scoped_and_never_paid_on_403(self):
        from app.routes import teacher_students as routes

        with patch.object(routes, "_guard_group", AsyncMock(return_value=False)), \
             patch("app.services.question_topics.ensure_topics",
                   AsyncMock()) as engine:
            response = await routes.generate_question_topics(
                "g1", "cmp-1", data={"language": "he"}, session={"sub": "teacher-1"})
        self.assertEqual(response.status_code, 403)
        engine.assert_not_awaited()

    async def test_the_subject_list_is_scoped_like_every_other_group_read(self):
        from app.routes import teacher_students as routes

        with patch.object(routes, "_guard_group", AsyncMock(return_value=False)), \
             patch("app.services.learning_analytics.class_subjects",
                   AsyncMock()) as engine:
            response = await routes.group_subjects(
                "g1", language="he", session={"sub": "teacher-1"})
        self.assertEqual(response.status_code, 403)
        engine.assert_not_awaited()

    async def test_the_snapshot_no_longer_accepts_a_subject_it_drops(self):
        """`group_insights` has no subject parameter and never had one.

        The signature declared `subject`, FastAPI bound it, and it went nowhere
        — which was invisible only because the scope subject was permanently
        null. Pinned here because the fix is a deletion, and a deletion grows
        back the moment someone wires the bar to this endpoint by analogy.
        """
        import inspect
        from app.routes import teacher_students as routes
        from app.services import insights

        self.assertNotIn("subject", inspect.signature(routes.group_snapshot).parameters)
        self.assertNotIn("subject", inspect.signature(insights.group_insights).parameters)

    async def test_reports_dashboard_viewed_only_after_guard(self):
        from app.routes import teacher_students as routes

        with patch.object(routes, "_guard_group", AsyncMock(return_value=True)), \
             patch("app.services.learning_analytics.group_learnings",
                   AsyncMock(return_value={"learnings": [], "totals": {}})), \
             patch("app.services.group_analytics.learning_gaps",
                   AsyncMock(return_value=[])), \
             patch("app.services.group_analytics.group_recommendations",
                   return_value=[]), \
             patch.object(routes, "_report", AsyncMock()) as report:
            response = await routes.group_learnings(
                "g1", subject=None, language="he", session={"sub": "teacher-1"})
        self.assertEqual(response.status_code, 200)
        report.assert_awaited_once()
        body = json.loads(response.body)
        self.assertIn("recommendations", body)


if __name__ == "__main__":
    unittest.main()


class GapDiagnosis(unittest.IsolatedAsyncioTestCase):
    """The real "למה?" behind a class gap (#507): where inside the objective,
    which questions, and how it goes wrong — folded evidence, never a repeat
    of the row's own counters."""

    async def _diagnose(self, per_learner, decisions=None, objective_id="obj-1",
                        llm=None, group_id="g1"):
        from app.services import learning_analytics

        learning_analytics._diagnosis_cache.clear()

        async def _summary(learner_id, subject=None, component_id=None):
            return per_learner.get(learner_id, [])

        async def _decisions(learner_id, limit=300):
            return (decisions or {}).get(learner_id, [])

        with ExitStack() as stack:
            _catalog_patches(stack)
            stack.enter_context(patch(
                "app.services.kata_catalog.information_for_item",
                side_effect=lambda cid, iid: "מטרת הפריט: מושגי ברוטו ונטו"
                if cid == "cmp-1" else None))
            stack.enter_context(patch("app.brain.org.learners_in_group",
                                      new=AsyncMock(return_value=list(per_learner))))
            stack.enter_context(patch("app.services.learner_activity.question_summary",
                                      side_effect=_summary))
            stack.enter_context(patch("app.agents.tutor_decision.recent_tutor_decisions",
                                      side_effect=_decisions))
            stack.enter_context(patch("app.services.llm.call_llm",
                                      new=llm or AsyncMock(side_effect=RuntimeError("no llm"))))
            return await learning_analytics.gap_diagnosis(group_id, objective_id)

    async def test_parts_come_back_hardest_first_with_titles(self):
        diagnosis = await self._diagnose({
            "k1": [_row("cmp-1", "q-hard", attempts=4, correct=0),
                   _row("cmp-2", "q1", attempts=4, correct=4)],
            "k2": [_row("cmp-1", "q-hard", attempts=3, correct=1)],
        })
        self.assertEqual([part["component_id"] for part in diagnosis["parts"]],
                         ["cmp-1", "cmp-2"])
        hardest = diagnosis["parts"][0]
        self.assertEqual(hardest["title"], "הקנייה א")
        self.assertAlmostEqual(hardest["success_rate"], 1 / 7, places=2)
        self.assertEqual(diagnosis["objective_title"], "title:obj-1")

    async def test_the_failing_question_is_named_the_way_the_learner_sees_it(self):
        diagnosis = await self._diagnose({
            "k1": [_row("cmp-1", "q-hard", attempts=4, correct=1)],
            "k2": [_row("cmp-1", "q-hard", attempts=3, correct=0)],
        })
        self.assertEqual(len(diagnosis["hard_questions"]), 1)
        question = diagnosis["hard_questions"][0]
        self.assertEqual(question["ordinal"], 3)
        self.assertEqual(question["screen_title"], "מסך ראשון")
        self.assertEqual(question["learning_title"], "הקנייה א")

    async def test_error_types_fold_only_diagnostic_kinds_on_this_objective(self):
        diagnosis = await self._diagnose(
            {
                "k1": [_row("cmp-1", "q-hard", attempts=4, correct=1)],
                "k2": [_row("cmp-1", "q-hard", attempts=4, correct=1)],
            },
            decisions={
                "k1": [
                    {"objective_id": "obj-1", "error_type": "misinterpret"},
                    {"objective_id": "obj-1", "error_type": "misinterpret"},
                    {"objective_id": "obj-1", "error_type": "right-idea"},
                    {"objective_id": "obj-OTHER", "error_type": "guess"},
                ],
                "k2": [{"objective_id": "obj-1", "error_type": "guess"}],
            },
        )
        self.assertEqual(diagnosis["error_types"],
                         [("misinterpret", 2), ("guess", 1)])

    async def test_an_untouched_objective_diagnoses_to_empty_not_error(self):
        diagnosis = await self._diagnose(
            {"k1": [_row("cmp-1", "q1", attempts=2, correct=2)]},
            objective_id="obj-nobody-met",
        )
        self.assertEqual(diagnosis["parts"], [])
        self.assertEqual(diagnosis["hard_questions"], [])
        self.assertEqual(diagnosis["error_types"], [])
        self.assertIsNone(diagnosis["focus_text"])

    async def test_the_failing_question_carries_its_topic_description(self):
        """`informationToBot` is the topic behind the number — without it the
        panel can only talk in question mechanics, which is the complaint."""
        diagnosis = await self._diagnose({
            "k1": [_row("cmp-1", "q-hard", attempts=4, correct=1)],
            "k2": [_row("cmp-1", "q-hard", attempts=3, correct=0)],
        })
        self.assertEqual(diagnosis["hard_questions"][0]["teaches"],
                         "מושגי ברוטו ונטו")

    async def test_focus_text_is_phrased_from_the_fold_or_absent(self):
        """The one generated field: present when the model rewords the topics,
        None on any failure — the client then composes deterministically."""
        import json as _json
        phrased = await self._diagnose(
            {"k1": [_row("cmp-1", "q-hard", attempts=4, correct=1)],
             "k2": [_row("cmp-1", "q-hard", attempts=3, correct=0)]},
            llm=AsyncMock(return_value=_json.dumps(
                {"text": "הקושי מתרכז במושגי ברוטו ונטו — כדאי להתחיל מהם."})),
        )
        self.assertIn("ברוטו", phrased["focus_text"])
        silent = await self._diagnose(
            {"k1": [_row("cmp-1", "q-hard", attempts=4, correct=1)],
             "k2": [_row("cmp-1", "q-hard", attempts=3, correct=0)]},
        )
        self.assertIsNone(silent["focus_text"])

    async def test_a_second_read_is_served_from_cache(self):
        """The fold fans out over the roster and the phrasing costs a model
        call — one diagnosis per (class, objective, language) per window."""
        from app.services import learning_analytics
        counted = AsyncMock(side_effect=RuntimeError("no llm"))
        first = await self._diagnose(
            {"k1": [_row("cmp-1", "q-hard", attempts=4, correct=1)]}, llm=counted)
        # Same key, NO patches active — a recompute would blow up on the real
        # roster read, so returning the same payload proves the cache answered.
        second = await learning_analytics.gap_diagnosis("g1", "obj-1")
        self.assertIs(second, first)
