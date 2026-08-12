"""Opening a task: who it reaches, and the bell ringing exactly when it should.

Target resolution is the only place a task turns from a document into a list of
children, so it is the only place scope has to be right. Every branch re-checks
against the live org rather than trusting a stored id — a task made last term
must not still reach a child who has left the class.

## What "idempotent" means now, and what it stopped meaning

The notification lane's contract is still idempotency, but the unit changed.
A double click on one opening must not ring twice; a **second opening** must,
because it is a genuinely new assignment with a genuinely new blank paper.

That is the retake, and it is the thing this suite most needs to hold: two
openings of one task give a child two papers, and answering the second must
leave the first exactly as it was. Papers used to be keyed by task, so the
second sitting would have silently overwritten the first — the failure mode
being a teacher watching a score change with no record of what it was.
"""

from __future__ import annotations

import asyncio
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services import notifications
from app.services.tasks import assign, store
from app.services.tasks.assign import AssignError


def run(coro):
    return asyncio.run(coro)


TEACHER = "teacher-1"
OTHER = "teacher-2"
GROUP = "group-1"
ROSTER = ["kid-a", "kid-b", "kid-c"]

CONTENT = {"questions": [
    {"id": "q1", "type": "true_false", "prompt": [{"type": "text", "text": "נכון"}],
     "answer": {"value": True}, "explanation": [], "hint": [],
     "difficulty": "easy", "weight": 1.0},
]}


class _Isolated:
    def __init__(self, *extra):
        self._extra = list(extra)

    def __enter__(self):
        self._dir = tempfile.TemporaryDirectory()
        self._patches = [
            patch.object(store, "_FALLBACK_FILE", Path(self._dir.name) / "tasks.json"),
            patch.object(store, "_get_collection_named", lambda name: None),
            # `notifications._collection()` imports this lazily on every call,
            # so patching only the task store's copy leaves the notification
            # lane pointed at the real database. Without this line the suite
            # writes `task_assigned` rows into whatever Mongo `.env` names.
            patch("app.brain.repository._get_collection_named", lambda name: None),
            patch("app.brain.org.teacher_can_access_group",
                  AsyncMock(side_effect=lambda teacher, group: teacher == TEACHER and group == GROUP)),
            patch("app.brain.org.teacher_can_access_learner",
                  AsyncMock(side_effect=lambda teacher, learner: teacher == TEACHER and learner in ROSTER)),
            patch("app.brain.org.learners_in_group", AsyncMock(return_value=list(ROSTER))),
            patch("app.brain.org.get_group", AsyncMock(return_value={"_id": GROUP})),
            *self._extra,
        ]
        for entry in self._patches:
            entry.start()
        # The notification store has a module-level in-memory fallback that
        # would otherwise carry ids between tests — and this suite is entirely
        # about ids being remembered.
        notifications._memory.clear()
        return self

    def __exit__(self, *exc):
        for entry in reversed(self._patches):
            entry.stop()
        self._dir.cleanup()
        notifications._memory.clear()
        return False


async def _ready_task(kind="group", target_id=GROUP, teacher_id=TEACHER):
    task = await store.create_task(
        teacher_id=teacher_id, group_id=GROUP,
        target={"kind": kind, "id": target_id},
        spec={"title": "שברים", "language": "he", "components": ["practice"]},
    )
    await store.put_content(task["_id"], "practice", CONTENT)
    await store.update_task(task["_id"], status="ready")
    return task["_id"]


class WhoTheTaskReaches(unittest.TestCase):
    def test_a_group_resolves_through_the_live_roster(self):
        with _Isolated():
            async def scenario():
                task_id = await _ready_task()
                return await assign.resolve_target(TEACHER, await store.get_task(task_id))

            self.assertEqual(run(scenario()), ROSTER)

    def test_a_subgroup_resolves_through_its_own_gate(self):
        with _Isolated(patch("app.services.subgroups.members_of",
                             AsyncMock(return_value=["kid-a", "kid-c"]))):
            async def scenario():
                task_id = await _ready_task(kind="subgroup", target_id="sg-1")
                return await assign.resolve_target(TEACHER, await store.get_task(task_id))

            self.assertEqual(run(scenario()), ["kid-a", "kid-c"])

    def test_a_single_learner_is_checked_individually(self):
        """The target ultimately comes from the chat builder, so from a model."""
        with _Isolated():
            async def scenario():
                task_id = await _ready_task(kind="learner", target_id="kid-elsewhere")
                await assign.resolve_target(TEACHER, await store.get_task(task_id))

            with self.assertRaises(AssignError):
                run(scenario())

    def test_another_teachers_group_is_refused(self):
        with _Isolated():
            async def scenario():
                task_id = await _ready_task()
                await assign.resolve_target(OTHER, await store.get_task(task_id))

            with self.assertRaises(AssignError):
                run(scenario())

    def test_a_group_that_never_existed_is_refused_even_for_an_admin(self):
        """`teacher_can_access_group` returns True for an admin on ANY id."""
        with _Isolated(patch("app.brain.org.teacher_can_access_group",
                             AsyncMock(return_value=True)),
                       patch("app.brain.org.get_group", AsyncMock(return_value=None))):
            async def scenario():
                task_id = await _ready_task()
                await assign.resolve_target(TEACHER, await store.get_task(task_id))

            with self.assertRaises(AssignError):
                run(scenario())

    def test_a_missing_subgroup_and_someone_elses_look_identical(self):
        from app.services.subgroups import SubgroupError

        for code in ("not_found", "not_authorized"):
            with _Isolated(patch("app.services.subgroups.members_of",
                                 AsyncMock(side_effect=SubgroupError(code)))):
                async def scenario():
                    task_id = await _ready_task(kind="subgroup", target_id="sg-1")
                    await assign.resolve_target(TEACHER, await store.get_task(task_id))

                with self.assertRaises(AssignError) as caught:
                    run(scenario())
                self.assertEqual(str(caught.exception), "not_authorized")


class LaunchingIsIdempotent(unittest.TestCase):
    def test_the_bell_rings_once_per_learner_within_one_opening(self):
        """A double click, a retry, a slow network — one bell each."""
        with _Isolated():
            async def scenario():
                task_id = await _ready_task()
                result = await assign.launch(TEACHER, task_id)
                # The same opening, activated again — the retry path.
                again = await store.activate(result["launch_id"], ROSTER)
                return result, again

            with patch("app.services.realtime.publish"):
                result, again = run(scenario())

            self.assertEqual(result["assigned"], 3)
            self.assertEqual(again["activated"], [])
            self.assertEqual(again["already_active"], ROSTER)
            rung = [row for row in notifications._memory.values()
                    if row["kind"] == "task_assigned"]
            self.assertEqual(len(rung), 3)

    def test_a_second_opening_rings_again_because_it_is_a_new_assignment(self):
        with _Isolated():
            async def scenario():
                task_id = await _ready_task()
                first = await assign.launch(TEACHER, task_id)
                second = await assign.launch(TEACHER, task_id)
                return first, second

            with patch("app.services.realtime.publish"):
                first, second = run(scenario())

            self.assertEqual(first["seq"], 1)
            self.assertEqual(second["seq"], 2)
            # Everyone gets a fresh paper, so everyone is told.
            self.assertEqual(second["assigned"], 3)
            self.assertEqual(second["already_assigned"], 0)
            self.assertEqual(len(notifications._memory), 6)

    def test_the_second_opening_is_a_second_blank_paper(self):
        """The whole point of the re-key, asserted end to end."""
        from app.services.tasks import attempts

        with _Isolated():
            async def scenario():
                task_id = await _ready_task()
                first = await assign.launch(TEACHER, task_id)
                with patch("app.services.learner_activity.record", AsyncMock()):
                    await attempts.submit(first["launch_id"], "kid-a",
                                          answers={"q1": True})
                second = await assign.launch(TEACHER, task_id)
                return (
                    await store.get_attempt(first["launch_id"], "kid-a"),
                    await attempts.open_task(second["launch_id"], "kid-a"),
                )

            with patch("app.services.realtime.publish"):
                sat, retake = run(scenario())

            # The first sitting keeps its answers and its mark…
            self.assertEqual(sat["status"], "submitted")
            self.assertEqual(sat["score"], 100)
            # …and the second is blank, not a view of the first.
            self.assertEqual(retake["answers"], {})
            self.assertEqual(retake["status"], "in_progress")

    def test_one_opening_can_go_to_several_targets_at_once(self):
        with _Isolated(patch("app.services.subgroups.members_of",
                             AsyncMock(return_value=["kid-b", "kid-c"]))):
            async def scenario():
                task_id = await _ready_task()
                return await assign.launch(TEACHER, task_id, targets=[
                    {"kind": "learner", "id": "kid-a"},
                    {"kind": "subgroup", "id": "sg-1"},
                ])

            with patch("app.services.realtime.publish"):
                result = run(scenario())

            self.assertEqual(result["assigned"], 3)
            self.assertEqual(sorted(result["learner_ids"]), ROSTER)

    def test_a_child_in_two_selected_targets_gets_one_paper(self):
        with _Isolated(patch("app.services.subgroups.members_of",
                             AsyncMock(return_value=["kid-a", "kid-b"]))):
            async def scenario():
                task_id = await _ready_task()
                return await assign.launch(TEACHER, task_id, targets=[
                    {"kind": "learner", "id": "kid-a"},
                    {"kind": "subgroup", "id": "sg-1"},
                ])

            with patch("app.services.realtime.publish"):
                result = run(scenario())

            self.assertEqual(result["assigned"], 2)
            self.assertEqual(sorted(result["learner_ids"]), ["kid-a", "kid-b"])

    def test_one_unauthorised_target_refuses_the_whole_opening(self):
        """Not a partial send. A teacher told "sent" must not have to count."""
        with _Isolated():
            async def scenario():
                task_id = await _ready_task()
                await assign.launch(TEACHER, task_id, targets=[
                    {"kind": "learner", "id": "kid-a"},
                    {"kind": "learner", "id": "kid-not-mine"},
                ])
                return task_id

            with patch("app.services.realtime.publish"):
                with self.assertRaises(AssignError):
                    run(scenario())
            # Nothing rang, and no opening exists.
            self.assertEqual(notifications._memory, {})

    def test_the_deep_link_points_at_the_opening(self):
        with _Isolated():
            async def scenario():
                task_id = await _ready_task()
                return await assign.launch(TEACHER, task_id)

            with patch("app.services.realtime.publish"):
                result = run(scenario())

            launch_id = result["launch_id"]
            row = next(iter(notifications._memory.values()))
            # The task id alone could not say WHICH paper — a child may hold two.
            self.assertEqual(row["actions"][0]["route"], f"/tasks/{launch_id}")
            self.assertEqual(row["_id"], f"task_assigned:{launch_id}:kid-a")
            # Rendered client-side from a key, never a frozen sentence.
            self.assertEqual(row["title_key"], "notif.task.assigned")
            self.assertEqual(row["params"]["title"], "שברים")

    def test_a_task_that_has_not_generated_cannot_be_sent(self):
        with _Isolated():
            async def scenario():
                task = await store.create_task(
                    teacher_id=TEACHER, group_id=GROUP, target={"kind": "group", "id": GROUP},
                    spec={"title": "x"})
                await assign.launch(TEACHER, task["_id"])

            with self.assertRaises(AssignError) as caught:
                run(scenario())
            self.assertEqual(str(caught.exception), "not_ready")

    def test_another_teacher_cannot_send_your_task(self):
        with _Isolated():
            async def scenario():
                task_id = await _ready_task()
                await assign.launch(OTHER, task_id)

            with self.assertRaises(AssignError):
                run(scenario())

    def test_a_task_that_does_not_exist_refuses_the_same_way_as_one_that_is_not_yours(self):
        with _Isolated():
            async def scenario():
                task_id = await _ready_task()
                errors = []
                for target in ("tsk-nonexistent", task_id):
                    try:
                        await assign.launch(OTHER, target)
                    except AssignError as error:
                        errors.append(str(error))
                return errors

            self.assertEqual(run(scenario()), ["not_authorized", "not_authorized"])


class ClosingKeepsTheEvidence(unittest.TestCase):
    def test_closing_leaves_activations_and_attempts_in_place(self):
        with _Isolated():
            async def scenario():
                task_id = await _ready_task()
                await assign.launch(TEACHER, task_id)
                await assign.close(TEACHER, task_id)
                return (await store.get_task(task_id),
                        await store.list_activations_for_task(task_id))

            with patch("app.services.realtime.publish"):
                task, activations = run(scenario())

            self.assertEqual(task["status"], "closed")
            self.assertEqual(len(activations), 3)

    def test_a_closed_opening_refuses_work_and_a_reopened_one_accepts_it(self):
        from app.services.tasks import attempts

        with _Isolated():
            async def scenario():
                task_id = await _ready_task()
                result = await assign.launch(TEACHER, task_id)
                launch = result["launch_id"]
                await assign.close(TEACHER, task_id, launch_id=launch)

                refused = None
                try:
                    await attempts.save_answers(launch, "kid-a", {"q1": True})
                except attempts.AttemptError as error:
                    refused = str(error)

                await assign.reopen(TEACHER, task_id, launch)
                saved = await attempts.save_answers(launch, "kid-a", {"q1": True})
                return refused, saved, await store.get_task(task_id)

            with patch("app.services.realtime.publish"):
                refused, saved, task = run(scenario())

            self.assertEqual(refused, "closed")
            self.assertTrue(saved["saved"])
            # Reopening one opening puts the whole task back to live.
            self.assertEqual(task["status"], "live")

    def test_closing_one_opening_leaves_the_other_accepting_work(self):
        with _Isolated():
            async def scenario():
                task_id = await _ready_task()
                first = await assign.launch(TEACHER, task_id)
                second = await assign.launch(TEACHER, task_id)
                await assign.close(TEACHER, task_id, launch_id=first["launch_id"])
                return (await store.list_launches(task_id),
                        await store.get_task(task_id))

            with patch("app.services.realtime.publish"):
                launches, task = run(scenario())

            self.assertEqual([row["status"] for row in launches], ["closed", "active"])
            # One shut opening does not shut the task — the other is still out.
            self.assertEqual(task["status"], "live")

    def test_closing_with_no_opening_named_closes_all_of_them(self):
        with _Isolated():
            async def scenario():
                task_id = await _ready_task()
                await assign.launch(TEACHER, task_id)
                await assign.launch(TEACHER, task_id)
                await assign.close(TEACHER, task_id)
                return (await store.list_launches(task_id),
                        await store.get_task(task_id))

            with patch("app.services.realtime.publish"):
                launches, task = run(scenario())

            self.assertEqual([row["status"] for row in launches], ["closed", "closed"])
            self.assertEqual(task["status"], "closed")

    def test_reopening_something_that_is_not_this_tasks_opening_is_refused(self):
        with _Isolated():
            async def scenario():
                task_id = await _ready_task()
                await assign.launch(TEACHER, task_id)
                await assign.reopen(TEACHER, task_id, "tsk-someone-else:1")

            with patch("app.services.realtime.publish"):
                with self.assertRaises(AssignError):
                    run(scenario())

    def test_another_teacher_cannot_reopen_your_opening(self):
        with _Isolated():
            async def scenario():
                task_id = await _ready_task()
                result = await assign.launch(TEACHER, task_id)
                await assign.reopen(OTHER, task_id, result["launch_id"])

            with patch("app.services.realtime.publish"):
                with self.assertRaises(AssignError):
                    run(scenario())


if __name__ == "__main__":
    unittest.main()
