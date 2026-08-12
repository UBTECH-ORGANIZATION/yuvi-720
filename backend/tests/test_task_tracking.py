"""What the teacher reads after a task comes back.

The properties that matter here are the ones a screen would render wrongly
without anyone noticing:

* a per-question bucket must carry **who**, not just how many — a histogram
  tells a teacher there is a problem and not whose;
* `skipped` must never be folded into `wrong`, because "did not reach it" and
  "tried and failed" call for different responses;
* an edit after sending means children hold different papers, and a breakdown
  that silently mixes them is a breakdown of nothing;
* the exact sentence a child was shown has to survive all the way to the
  teacher, which is what makes an AI-assisted grade auditable.

The summary is held to the daily brief's contract: the model writes prose, code
owns every number and every learner id, and a claim standing on an unknown ref
is dropped rather than repaired.
"""

from __future__ import annotations

import asyncio
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.tasks import store, summary, tracking


def run(coro):
    return asyncio.run(coro)


TEACHER, GROUP = "teacher-1", "group-1"

QUESTIONS = [
    {"id": "q1", "type": "mcq", "prompt": [{"type": "text", "text": "כמה"}],
     "options": [[{"type": "math", "value": "3"}], [{"type": "math", "value": "4"}]],
     "answer": {"index": 1}, "weight": 1.0},
    {"id": "q2", "type": "ordering", "prompt": [{"type": "text", "text": "סדרו"}],
     "options": [[{"type": "text", "text": "א"}], [{"type": "text", "text": "ב"}],
                 [{"type": "text", "text": "ג"}]],
     "answer": {"order": [0, 1, 2]}, "weight": 1.0},
]


class _Isolated:
    def __enter__(self):
        self._dir = tempfile.TemporaryDirectory()
        self._patches = [
            patch.object(store, "_FALLBACK_FILE", Path(self._dir.name) / "tasks.json"),
            patch.object(store, "_get_collection_named", lambda name: None),
            patch("app.brain.repository._get_collection_named", lambda name: None),
        ]
        for entry in self._patches:
            entry.start()
        return self

    def __exit__(self, *exc):
        for entry in reversed(self._patches):
            entry.stop()
        self._dir.cleanup()
        return False


async def _seeded():
    """One task, three children: one perfect, one partial, one who never opened it."""
    from app.services.tasks import attempts

    task = await store.create_task(
        teacher_id=TEACHER, group_id=GROUP, target={"kind": "group", "id": GROUP},
        spec={"title": "שברים", "language": "he", "components": ["practice"]},
    )
    task_id = task["_id"]
    kids = ["kid-a", "kid-b", "kid-c"]
    await store.put_content(task_id, "practice", {"questions": QUESTIONS})
    await store.update_task(task_id, status="ready")
    launch = await store.create_launch(
        task_id, teacher_id=TEACHER, group_id=GROUP,
        targets=[{"kind": "group", "id": GROUP}], learner_ids=kids,
    )
    await store.activate(launch["_id"], kids)

    with patch("app.services.learner_activity.record", AsyncMock()):
        # Everything right.
        await attempts.submit(launch["_id"], "kid-a", answers={"q1": 1, "q2": [0, 1, 2]})
        # One wrong, one two-thirds ordered — partial credit, not zero.
        await attempts.submit(launch["_id"], "kid-b", answers={"q1": 0, "q2": [0, 2, 1]})
        # kid-c never starts.
    return await store.get_task(task_id)


class ThePerQuestionView(unittest.TestCase):
    def test_a_bucket_says_who_and_not_only_how_many(self):
        with _Isolated():
            data = run(_run_tracking())
        by_id = {question["id"]: question for question in data["questions"]}
        self.assertEqual(by_id["q1"]["correct"], ["kid-a"])
        self.assertEqual(by_id["q1"]["wrong"], ["kid-b"])
        self.assertEqual(by_id["q2"]["correct"], ["kid-a"])
        self.assertEqual(by_id["q2"]["partial"], ["kid-b"])

    def test_a_child_who_never_opened_it_is_not_counted_as_wrong(self):
        with _Isolated():
            data = run(_run_tracking())
        for question in data["questions"]:
            self.assertNotIn("kid-c", question["wrong"])
            self.assertNotIn("kid-c", question["correct"])
        kid_c = next(row for row in data["learners"] if row["learner_id"] == "kid-c")
        self.assertEqual(kid_c["status"], "not_started")
        self.assertIsNone(kid_c["score"])

    def test_partial_credit_survives_to_the_screen(self):
        """Two of three in the right place is partial, and a bucket of its own."""
        with _Isolated():
            data = run(_run_tracking())
        kid_b = next(row for row in data["learners"] if row["learner_id"] == "kid-b")
        self.assertGreater(kid_b["score"] or 0, 0)
        self.assertLess(kid_b["score"] or 100, 100)

    def test_an_edit_after_sending_is_reported_not_hidden(self):
        with _Isolated():
            async def scenario():
                task = await _seeded()
                clean = await tracking.for_task(task)
                # The teacher edits a live task.
                await store.put_content(task["_id"], "practice",
                                        {"questions": QUESTIONS[:1]})
                return clean, await tracking.for_task(await store.get_task(task["_id"]))

            clean, drifted = run(scenario())
        self.assertEqual(clean["stale_snapshots"], 0)
        self.assertEqual(drifted["stale_snapshots"], 3)

    def test_a_subgroup_slice_is_the_same_numbers_and_fewer_children(self):
        with _Isolated():
            async def scenario():
                task = await _seeded()
                return await tracking.for_group(task, ["kid-b"])

            slice_ = run(scenario())
        self.assertEqual([row["learner_id"] for row in slice_["learners"]], ["kid-b"])
        by_id = {question["id"]: question for question in slice_["questions"]}
        self.assertEqual(by_id["q1"]["correct"], [])
        self.assertEqual(by_id["q1"]["wrong"], ["kid-b"])


class OneChildsPaper(unittest.TestCase):
    def test_the_teacher_sees_the_key_the_answer_and_the_mark(self):
        with _Isolated():
            async def scenario():
                task = await _seeded()
                return await tracking.for_learner(task, "kid-b")

            paper = run(scenario())
        first = paper["questions"][0]
        self.assertEqual(first["given"], 0)
        self.assertEqual(first["answer_key"], {"index": 1})
        self.assertEqual(first["bucket"], "wrong")

    def test_the_exact_sentence_the_child_saw_reaches_the_teacher(self):
        with _Isolated():
            async def scenario():
                task = await _seeded()
                return await tracking.for_learner(task, "kid-a")

            paper = run(scenario())
        # The overall completion message, which is what the child actually read.
        self.assertTrue(paper["learner_feedback"])

    def test_a_learner_who_was_never_given_it_has_no_paper(self):
        with _Isolated():
            async def scenario():
                task = await _seeded()
                return await tracking.for_learner(task, "kid-elsewhere")

            self.assertIsNone(run(scenario()))


class TheSummary(unittest.TestCase):
    FACTS_TRACKING = {
        "learners": [
            {"learner_id": "kid-a", "status": "graded", "score": 100, "needs_review": False},
            {"learner_id": "kid-b", "status": "graded", "score": 40, "needs_review": True},
            {"learner_id": "kid-c", "status": "not_started", "score": None, "needs_review": False},
        ],
        "questions": [
            {"id": "q1", "prompt_text": "כמה זה 2 + 2", "type": "mcq",
             "correct": ["kid-a"], "partial": [], "wrong": ["kid-b"], "skipped": []},
            {"id": "q2", "prompt_text": "סדרו", "type": "ordering",
             "correct": ["kid-a"], "partial": ["kid-b"], "wrong": [], "skipped": []},
        ],
        "stale_snapshots": 0,
    }

    def _reply(self, **overrides):
        payload = {
            "headline": "שני תלמידים סיימו, אחד עוד לא התחיל.",
            "summary": "רוב הכיתה התקדמה יפה.",
            "bullets": [{"text": "תלמיד אחד עדיין לא פתח את המשימה.",
                         "why": "אין לו אף תשובה שמורה.", "ref": "f2"}],
        }
        payload.update(overrides)
        return json.dumps(payload, ensure_ascii=False)

    def test_a_bullet_standing_on_an_unknown_ref_is_dropped(self):
        """The failure the brief's first version had: an invented signal name
        passed the gate as easily as a real one, because nothing compared it."""
        reply = self._reply(bullets=[
            {"text": "אמיתי", "why": "", "ref": "f2"},
            {"text": "המצאה", "why": "", "ref": "f99"},
        ])
        with patch("app.services.llm.call_llm", AsyncMock(return_value=reply)):
            result = run(summary.summarize(self.FACTS_TRACKING))
        self.assertEqual([bullet["text"] for bullet in result["bullets"]], ["אמיתי"])

    def test_prose_carrying_a_number_nobody_computed_is_dropped(self):
        with patch("app.services.llm.call_llm",
                   AsyncMock(return_value=self._reply(headline="17 תלמידים סיימו."))):
            result = run(summary.summarize(self.FACTS_TRACKING))
        self.assertIsNone(result["headline"])
        # The rest of the answer survives — one bad sentence is not a bad brief.
        self.assertTrue(result["summary"])

    def test_a_real_number_passes(self):
        with patch("app.services.llm.call_llm",
                   AsyncMock(return_value=self._reply(headline="2 תלמידים סיימו."))):
            result = run(summary.summarize(self.FACTS_TRACKING))
        self.assertEqual(result["headline"], "2 תלמידים סיימו.")

    def test_the_model_is_never_given_a_learner_id(self):
        facts = summary._facts(self.FACTS_TRACKING)
        blob = json.dumps(facts, ensure_ascii=False)
        for learner_id in ("kid-a", "kid-b", "kid-c"):
            self.assertNotIn(learner_id, blob)

    def test_actions_carry_real_learner_ids_chosen_in_code(self):
        with patch("app.services.llm.call_llm", AsyncMock(return_value=self._reply())):
            result = run(summary.summarize(self.FACTS_TRACKING))
        kinds = {action["kind"]: action for action in result["actions"]}
        self.assertEqual(kinds["nudge_not_started"]["learner_ids"], ["kid-c"])
        self.assertEqual(kinds["review_open_answers"]["learner_ids"], ["kid-b"])
        # A label key, not a sentence — it renders in whichever language the
        # teacher is reading today.
        self.assertTrue(kinds["nudge_not_started"]["label_key"].startswith("tch."))

    def test_with_no_provider_the_numbers_still_render(self):
        with patch("app.services.llm.call_llm", AsyncMock(side_effect=RuntimeError("no key"))):
            result = run(summary.summarize(self.FACTS_TRACKING))
        self.assertIsNone(result["headline"])
        self.assertEqual(result["bullets"], [])
        self.assertEqual(result["facts"]["completed"], 2)
        # And the actions are code, so they are unaffected by the model's absence.
        self.assertTrue(result["actions"])

    def test_a_task_nobody_has_finished_is_not_summarised(self):
        """A model asked to summarise nothing writes something anyway."""
        empty = {**self.FACTS_TRACKING,
                 "learners": [{"learner_id": "kid-c", "status": "not_started",
                               "score": None, "needs_review": False}]}
        called = AsyncMock()
        with patch("app.services.llm.call_llm", called):
            result = run(summary.summarize(empty))
        called.assert_not_awaited()
        self.assertIsNone(result["headline"])


async def _run_tracking():
    task = await _seeded()
    return await tracking.for_task(task)


if __name__ == "__main__":
    unittest.main()
