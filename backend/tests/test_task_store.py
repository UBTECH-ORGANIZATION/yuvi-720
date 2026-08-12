"""The task store, and the guarantee the four collections exist to give.

The property everything else here supports: **a child's paper is frozen when
they are given it.** A teacher who edits a live task must not change what
somebody halfway through is looking at, and a class where half answered
version 1 and half answered version 2 has a per-question breakdown that means
nothing.

Also covered: the answer key never reaching the browser, the child never being
shown a percentage, and the completion actually registering as activity — the
last of which is the consequence the plan flagged and the one that would show
up as the teacher's own portal contradicting itself.
"""

from __future__ import annotations

import asyncio
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.tasks import attempts, store


def run(coro):
    return asyncio.run(coro)


TEACHER = "teacher-1"
GROUP = "group-1"
KID = "kid-a"

PRACTICE_V1 = {"questions": [
    {"id": "q1", "type": "mcq", "prompt": [{"type": "text", "text": "כמה זה שתיים ועוד שתיים"}],
     "options": [[{"type": "math", "value": "3"}], [{"type": "math", "value": "4"}]],
     "answer": {"index": 1}, "explanation": [{"type": "text", "text": "כי"}],
     "hint": [], "difficulty": "easy", "weight": 1.0},
]}
PRACTICE_V2 = {"questions": [
    {"id": "q1", "type": "mcq", "prompt": [{"type": "text", "text": "שאלה אחרת לגמרי"}],
     "options": [[{"type": "math", "value": "9"}], [{"type": "math", "value": "10"}]],
     "answer": {"index": 0}, "explanation": [], "hint": [], "difficulty": "easy", "weight": 1.0},
]}


class _Isolated:
    """The real fallback code path, against a throwaway file.

    Exercising the JSON store rather than mocking it is deliberate: it is the
    path a credential-less dev box actually runs on, and its upsert semantics
    are where an idempotency bug would hide.
    """

    def __enter__(self):
        self._dir = tempfile.TemporaryDirectory()
        self._patches = [
            patch.object(store, "_FALLBACK_FILE", Path(self._dir.name) / "tasks.json"),
            patch.object(store, "_get_collection_named", lambda name: None),
            # Every other collection accessor in the process, because modules
            # that import it lazily (notifications, learner_activity) are not
            # covered by patching the task store's own copy — and a test that
            # reaches the real database writes to it.
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


async def _task_with(content, component="practice"):
    task = await store.create_task(
        teacher_id=TEACHER, group_id=GROUP,
        target={"kind": "learner", "id": KID},
        spec={"title": "שברים", "language": "he", "components": [component]},
    )
    await store.put_content(task["_id"], component, content)
    return task["_id"]


async def _launch(task_id, learners=(KID,)):
    """An opening with nobody activated yet. Returns the LAUNCH id.

    That is the handle everything downstream takes now — a paper belongs to an
    opening, not to a task, which is what lets the same child sit the same task
    twice without the second sitting overwriting the first.
    """
    row = await store.create_launch(
        task_id, teacher_id=TEACHER, group_id=GROUP,
        targets=[{"kind": "group", "id": GROUP}], learner_ids=list(learners),
    )
    return row["_id"]


async def _open(task_id, learners=(KID,)):
    """An opening with its papers handed out."""
    launch = await _launch(task_id, learners)
    await store.activate(launch, list(learners))
    return launch


class TheSnapshotIsFrozen(unittest.TestCase):
    def test_editing_a_live_task_does_not_change_an_in_progress_paper(self):
        with _Isolated():
            async def scenario():
                task_id = await _task_with(PRACTICE_V1)
                launch = await _open(task_id)

                # The teacher edits the task after it has gone out.
                await store.put_content(task_id, "practice", PRACTICE_V2)

                activation = await store.get_activation(launch, KID)
                return task_id, activation

            task_id, activation = run(scenario())
            question = activation["content_snapshot"]["practice"]["questions"][0]
            self.assertEqual(question["prompt"][0]["text"], "כמה זה שתיים ועוד שתיים")
            self.assertEqual(question["answer"]["index"], 1)

            # And the live content really did change — otherwise this test
            # passes because the edit never happened.
            live = run(store.all_content(task_id))
            self.assertEqual(live["practice"]["questions"][0]["answer"]["index"], 0)

    def test_reactivating_never_reissues_a_new_paper(self):
        """A retry, a second click, a learner joining late — all idempotent."""
        with _Isolated():
            async def scenario():
                task_id = await _task_with(PRACTICE_V1)
                launch = await _launch(task_id)
                first = await store.activate(launch, [KID])
                await store.put_content(task_id, "practice", PRACTICE_V2)
                second = await store.activate(launch, [KID, "kid-b"])
                return first, second, await store.get_activation(launch, KID)

            first, second, activation = run(scenario())
            self.assertEqual(first["activated"], [KID])
            self.assertEqual(second["already_active"], [KID])
            self.assertEqual(second["activated"], ["kid-b"])
            # The one who already had it keeps version 1.
            self.assertEqual(
                activation["content_snapshot"]["practice"]["questions"][0]["answer"]["index"], 1)

    def test_a_task_with_no_content_cannot_be_sent(self):
        with _Isolated():
            async def scenario():
                task = await store.create_task(
                    teacher_id=TEACHER, group_id=GROUP,
                    target={"kind": "group", "id": GROUP}, spec={"title": "x"},
                )
                await store.activate(store.launch_id(task["_id"], 1), [KID])

            with self.assertRaises(store.TaskStoreError):
                run(scenario())


class WhatTheChildReceives(unittest.TestCase):
    def test_the_answer_key_never_reaches_the_browser(self):
        with _Isolated():
            async def scenario():
                task_id = await _task_with(PRACTICE_V1)
                launch = await _open(task_id)
                return await attempts.open_task(launch, KID)

            payload = run(scenario())
            question = payload["content"]["practice"]["questions"][0]
            self.assertNotIn("answer", question)
            # The explanation is the answer in a longer sentence.
            self.assertNotIn("explanation", question)
            self.assertIn("prompt", question)
            self.assertIn("options", question)

    def test_a_learner_who_was_not_given_the_task_cannot_open_it(self):
        with _Isolated():
            async def scenario():
                task_id = await _task_with(PRACTICE_V1)
                launch = await _open(task_id)
                await attempts.open_task(launch, "kid-someone-else")

            with self.assertRaises(attempts.AttemptError):
                run(scenario())

    def test_the_child_is_told_in_words_and_never_in_a_percentage(self):
        with _Isolated():
            async def scenario():
                task_id = await _task_with(PRACTICE_V1)
                launch = await _open(task_id)
                result = await attempts.submit(
                    launch, KID, answers={"q1": 1}, language="he")
                return result, await store.get_attempt(launch, KID)

            with patch("app.services.learner_activity.record", AsyncMock()):
                result, attempt = run(scenario())

            self.assertNotIn("score", result)
            self.assertTrue(result["message"])
            self.assertGreater(result["sparks"], 0)
            # The teacher's number exists — it is simply not in the child's payload.
            self.assertEqual(attempt["score"], 100)
            self.assertEqual(attempt["status"], "submitted")

    def test_after_submitting_the_explanation_is_released(self):
        with _Isolated():
            async def scenario():
                task_id = await _task_with(PRACTICE_V1)
                launch = await _open(task_id)
                return await attempts.submit(launch, KID, answers={"q1": 0})

            with patch("app.services.learner_activity.record", AsyncMock()):
                result = run(scenario())
            question = result["content"]["practice"]["questions"][0]
            self.assertEqual(question["explanation"][0]["text"], "כי")
            self.assertFalse(question["verdict"]["correct"])
            # Still no key, even now.
            self.assertNotIn("answer", question)

    def test_a_submitted_attempt_cannot_be_answered_again(self):
        with _Isolated():
            async def scenario():
                task_id = await _task_with(PRACTICE_V1)
                launch = await _open(task_id)
                await attempts.submit(launch, KID, answers={"q1": 1})
                await attempts.save_answers(launch, KID, {"q1": 0})

            with patch("app.services.learner_activity.record", AsyncMock()):
                with self.assertRaises(attempts.AttemptError):
                    run(scenario())


class CompletionCountsAsActivity(unittest.TestCase):
    """The consequence of a separate store, and the thing that pre-empts it."""

    def test_finishing_a_task_writes_a_learner_activity_row(self):
        with _Isolated():
            async def scenario():
                task_id = await _task_with(PRACTICE_V1)
                launch = await _open(task_id)
                await attempts.submit(launch, KID, answers={"q1": 1})

            with patch("app.services.learner_activity.record", AsyncMock()) as record:
                run(scenario())
            record.assert_awaited()
            self.assertEqual(record.await_args.args[1], "task")

    def test_the_store_reports_when_a_learner_last_finished_something(self):
        with _Isolated():
            async def scenario():
                task_id = await _task_with(PRACTICE_V1)
                launch = await _open(task_id)
                before = await store.latest_completion(KID)
                await attempts.submit(launch, KID, answers={"q1": 1})
                return before, await store.latest_completion(KID)

            with patch("app.services.learner_activity.record", AsyncMock()):
                before, after = run(scenario())
            self.assertIsNone(before)
            self.assertTrue(after)

    def test_days_inactive_counts_a_task_a_learning_event_never_saw(self):
        """The teacher's portal must not contradict itself.

        `days_inactive` is computed from `learning_events`, and a
        teacher-authored task deliberately writes nothing there. Reading only
        that store reports "10 ימים ללא פעילות" beside a task the child
        finished today.
        """
        from app.services import insights

        stale = "2026-07-01T09:00:00+00:00"
        fresh = "2026-08-10T09:00:00+00:00"
        events = [{"stored_at": stale, "_id": "e1"}]

        with patch("app.services.tasks.store.latest_completion",
                   AsyncMock(return_value=None)):
            only_events, _, source = run(insights._days_inactive(KID, events))
        self.assertEqual(source, "learning_event")

        with patch("app.services.tasks.store.latest_completion",
                   AsyncMock(return_value=fresh)):
            with_task, stamp, source = run(insights._days_inactive(KID, events))

        self.assertLess(with_task, only_events)
        self.assertEqual(stamp, fresh)
        self.assertEqual(source, "task")

    def test_a_task_row_does_not_appear_in_the_per_question_view(self):
        """It has no question to belong to, and would render as an empty row."""
        from app.services import learner_activity

        rows = [{"learner_id": KID, "kind": "task", "component_id": None,
                 "item_id": None, "question_id": None, "meta": {"task_id": "tsk-1"}},
                {"learner_id": KID, "kind": "hint", "component_id": "comp-1",
                 "item_id": "i1", "question_id": "q1"}]

        with patch.object(learner_activity, "_activity_rows", AsyncMock(return_value=rows)):
            with patch("app.services.events.get_learner_events", AsyncMock(return_value=[])):
                summary = run(learner_activity.question_summary(KID))

        self.assertEqual(len(summary), 1)
        self.assertEqual(summary[0]["component_id"], "comp-1")

    def test_the_task_store_failing_never_breaks_the_insight(self):
        from app.services import insights

        events = [{"stored_at": "2026-08-01T09:00:00+00:00", "_id": "e1"}]
        with patch("app.services.tasks.store.latest_completion",
                   AsyncMock(side_effect=RuntimeError("mongo is down"))):
            days, _, source = run(insights._days_inactive(KID, events))
        self.assertIsNotNone(days)
        self.assertEqual(source, "learning_event")


class TheStoreRefusesNonsense(unittest.TestCase):
    def test_a_task_needs_a_real_target(self):
        with _Isolated():
            for target in ({"kind": "nobody", "id": "x"}, {"kind": "learner"}, {}):
                with self.assertRaises(store.TaskStoreError):
                    run(store.create_task(teacher_id=TEACHER, group_id=GROUP,
                                          target=target, spec={"title": "x"}))

    def test_content_is_only_stored_under_a_known_component(self):
        with _Isolated():
            async def scenario():
                task = await store.create_task(
                    teacher_id=TEACHER, group_id=GROUP,
                    target={"kind": "group", "id": GROUP}, spec={"title": "x"})
                await store.put_content(task["_id"], "minigame", {})

            with self.assertRaises(store.TaskStoreError):
                run(scenario())

    def test_the_generation_log_keeps_the_failures(self):
        """A teacher whose task is missing a deck deserves to know why."""
        with _Isolated():
            async def scenario():
                task_id = await _task_with(PRACTICE_V1)
                await store.record_generation(task_id, component="presentation",
                                              ok=False, detail="SpecError: too_few_slides")
                await store.record_generation(task_id, component="practice", ok=True)
                return await store.get_task(task_id)

            task = run(scenario())
            self.assertEqual(len(task["generation"]), 2)
            self.assertFalse(task["generation"][0]["ok"])
            self.assertIn("too_few_slides", task["generation"][0]["detail"])


if __name__ == "__main__":
    unittest.main()
