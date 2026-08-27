"""The teacher's pin (#249 shipped the slice; #244 completed the instrument).

The behaviours worth protecting: scope before any write, the catalog (or the
task activation) as the only source of what a pin points at, both chokepoints
(hero + route) honouring the same pin the same way, the ONE place each kind of
completion is adjudicated being the one place that kind of pin clears, expiry
judged read-side by one shared helper, and the ending of a pin surviving as
`pinned_last` — "done" and "never pinned" must not be the same blank.
"""

from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

_COMPONENT = {
    "id": "cmp-pin", "unit_id": "unit-1", "objective_id": "OBJ.1",
    "subject": "math", "title": "מערכת צירים",
}

_PIN = {
    "component_id": "cmp-pin", "unit_id": "unit-1", "objective_id": "OBJ.1",
    "pinned_by": "teacher-1", "pinned_at": "2026-08-20T08:00:00+00:00",
}


class PinRouteTest(unittest.IsolatedAsyncioTestCase):
    async def _pin(self, *, guarded, component=_COMPONENT, body=None):
        from app.routes import teacher_students as routes

        with patch.object(routes, "_guard_learner",
                          AsyncMock(return_value="kid" if guarded else None)), \
             patch("app.services.kata_catalog.ensure_loaded", AsyncMock()), \
             patch("app.services.kata_catalog.get_component", return_value=component), \
             patch("app.brain.repository.apply_brain_updates", AsyncMock()) as write, \
             patch("app.services.notifications.notify", AsyncMock()) as notify:
            response = await routes.pin_next(
                "kid", body or {"component_id": "cmp-pin"},
                session={"sub": "teacher-1"},
            )
        return response, write, notify

    async def test_an_off_roster_teacher_is_refused_before_any_write(self):
        response, write, notify = await self._pin(guarded=False)
        self.assertEqual(response.status_code, 403)
        write.assert_not_awaited()
        notify.assert_not_awaited()

    async def test_a_component_the_catalog_does_not_know_is_a_422_not_a_pin(self):
        """A pin that steers nowhere is worse than no pin: the hero would show
        a step with no title and the route would fall through silently."""
        response, write, notify = await self._pin(guarded=True, component=None)
        self.assertEqual(response.status_code, 422)
        write.assert_not_awaited()
        notify.assert_not_awaited()

    async def test_the_pin_is_resolved_from_the_catalog_not_the_request(self):
        """The client sends only the id. Unit and objective come from the
        catalog, so the stored pin can never disagree with what the learner's
        route will open."""
        response, write, _notify = await self._pin(
            guarded=True,
            body={"component_id": "cmp-pin", "unit_id": "forged", "objective_id": "forged"},
        )
        self.assertEqual(response.status_code, 200)
        pinned = write.await_args.args[1]["pinned_next"]
        self.assertEqual(pinned["component_id"], "cmp-pin")
        self.assertEqual(pinned["unit_id"], "unit-1")
        self.assertEqual(pinned["objective_id"], "OBJ.1")
        self.assertEqual(pinned["pinned_by"], "teacher-1")

    async def test_the_learner_notice_is_idempotent_per_component(self):
        _response, _write, notify = await self._pin(guarded=True)
        self.assertEqual(
            notify.await_args.kwargs["notification_id"], "pinned_next:kid:cmp-pin")

    async def test_unpin_writes_null_and_stays_scoped(self):
        from app.routes import teacher_students as routes

        with patch.object(routes, "_guard_learner", AsyncMock(return_value=None)), \
             patch("app.brain.repository.apply_brain_updates", AsyncMock()) as write:
            response = await routes.unpin_next("kid", session={"sub": "teacher-1"})
        self.assertEqual(response.status_code, 403)
        write.assert_not_awaited()

        with patch.object(routes, "_guard_learner", AsyncMock(return_value="kid")), \
             patch("app.brain.repository.apply_brain_updates", AsyncMock()) as write:
            response = await routes.unpin_next("kid", session={"sub": "teacher-1"})
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(write.await_args.args[1]["pinned_next"])


class HeroPinTest(unittest.TestCase):
    def _hero(self, brain, completed_ids=frozenset()):
        from app.services import dashboard

        with patch.object(dashboard, "get_component",
                          lambda cid: _COMPONENT if cid == "cmp-pin" else None), \
             patch.object(dashboard, "localized_objective_title",
                          lambda oid, lang=None: "כותרת"), \
             patch.object(dashboard.content_catalog, "objective_plan",
                          lambda *a, **k: {"progress_ratio": 0.4}), \
             patch.object(dashboard.content_catalog, "learner_signals",
                          lambda _brain: {}), \
             patch.object(dashboard, "next_focus",
                          lambda _brain: {"subject": None, "objective_id": None,
                                          "mode": "new", "plan": {}}), \
             patch("app.services.kata_catalog.get_objective", lambda oid: {}):
            return dashboard._hero(brain, "he", completed_ids)

    def test_a_pin_outranks_resume(self):
        """The pin exists precisely for "not that one — this one", said to a
        child who is mid-something-else."""
        hero = self._hero({
            "pinned_next": dict(_PIN),
            "current_state": {"component_id": "cmp-other"},
            "mastery": {},
        })
        self.assertEqual(hero["mode"], "pinned")
        self.assertEqual(hero["componentId"], "cmp-pin")
        self.assertEqual(hero["unitId"], "unit-1")
        self.assertFalse(hero["canResume"])
        self.assertTrue(hero["reason"])

    def test_a_completed_pin_no_longer_steers(self):
        hero = self._hero(
            {"pinned_next": dict(_PIN), "current_state": {}, "mastery": {}},
            completed_ids={"cmp-pin"},
        )
        self.assertNotEqual(hero["mode"], "pinned")


class SelectNextPinTest(unittest.IsolatedAsyncioTestCase):
    async def _select(self, brain, events):
        from app.agents import pedagogical

        with patch.object(pedagogical, "get_brain", AsyncMock(return_value=brain)), \
             patch.object(pedagogical.kata_catalog, "ensure_loaded", AsyncMock()), \
             patch.object(pedagogical.kata_catalog, "get_component",
                          lambda cid: _COMPONENT if cid == "cmp-pin" else None), \
             patch.object(pedagogical, "get_learner_events",
                          AsyncMock(return_value=events)), \
             patch.object(pedagogical, "apply_writes", AsyncMock()), \
             patch.object(pedagogical, "next_focus",
                          return_value={"subject": None, "objective_id": None,
                                        "mode": "new", "plan": {}}) as planner:
            decision = await pedagogical.select_next("kid")
        return decision, planner

    async def test_the_route_honours_the_pin_without_consulting_the_planner(self):
        decision, planner = await self._select({"pinned_next": dict(_PIN)}, events=[])
        self.assertEqual(decision["reason"], "pinned")
        self.assertEqual(decision["component"]["id"], "cmp-pin")
        self.assertEqual(decision["objective_id"], "OBJ.1")
        planner.assert_not_called()

    async def test_a_completed_pin_is_skipped_not_served_again(self):
        """The fold clears a pin on completion, but a spent pin that somehow
        survived (a race, a replayed event) must not send the child back."""
        completion = {"verb": "completed", "launch": "cmp-pin", "result": {"success": True}}
        decision, planner = await self._select(
            {"pinned_next": dict(_PIN)}, events=[completion])
        self.assertNotEqual(decision["reason"], "pinned")
        planner.assert_called_once()


class FoldClearsPinTest(unittest.IsolatedAsyncioTestCase):
    """Completion is adjudicated in exactly one place; the pin clears there."""

    async def _fold(self, event, brain):
        from app.services import events as events_service

        with patch.object(events_service, "get_brain", AsyncMock(return_value=brain)), \
             patch.object(events_service, "apply_brain_operators", AsyncMock()) as apply, \
             patch.object(events_service, "_compute_pace", AsyncMock(return_value=None)):
            await events_service._apply_event_to_brain(event)
        return apply

    async def test_completing_the_pinned_component_clears_the_pin(self):
        apply = await self._fold(
            {"learner_id": "kid", "verb": "completed", "launch": "cmp-pin",
             "result": {"success": True}},
            {"current_state": {}, "pinned_next": dict(_PIN), "mastery": {}},
        )
        set_updates = apply.await_args.args[1]
        self.assertIn("pinned_next", set_updates)
        self.assertIsNone(set_updates["pinned_next"])

    async def test_completing_something_else_leaves_the_pin_alone(self):
        apply = await self._fold(
            {"learner_id": "kid", "verb": "completed", "launch": "cmp-other",
             "result": {"success": True}},
            {"current_state": {}, "pinned_next": dict(_PIN), "mastery": {}},
        )
        for call in apply.await_args_list:
            self.assertNotIn("pinned_next", call.args[1])


class PinSchemaTest(unittest.TestCase):
    def test_a_repin_after_unpin_sets_the_whole_object(self):
        """Unpin writes null. If a later pin were flattened into dotted keys,
        Mongo would $set `pinned_next.component_id` against that null and fail
        with WriteError 28 — silently, into the JSON fallback. The opaque-leaf
        list is what prevents that; this pins `pinned_next`'s place on it."""
        from app.brain.schema import flatten_updates

        flat = flatten_updates({"pinned_next": dict(_PIN)})
        self.assertIn("pinned_next", flat)
        self.assertNotIn("pinned_next.component_id", flat)


class PinLocaleTest(unittest.TestCase):
    def test_the_hero_and_notification_keys_exist_in_all_three_locales(self):
        root = Path(__file__).resolve().parents[2] / "locales"
        for lang in ("he", "en", "ar"):
            data = json.loads((root / f"{lang}.json").read_text(encoding="utf-8"))
            for key in ("sdash.hero.pinned.eyebrow", "sdash.hero.pinned.action",
                        "sdash.hero.resumeAside",
                        "notif.pinnedNext", "notif.action.openLesson",
                        "notif.action.openTask",
                        "tch.liveView.focusPanel.tab.tasks",
                        "tch.liveView.focusPanel.until",
                        "tch.liveView.focusPanel.title",
                        "tch.student.pin.by",
                        "tch.student.pin.outcome.completed",
                        "tch.calendar.pinTask"):
                self.assertIn(key, data, f"{key} missing from {lang}")


# ── #244: expiry, task pins, the spent record, bulk ─────────────────────────

_TASK_PIN = {
    "kind": "task", "task_id": "tsk-abc", "launch_id": "tsk-abc:1",
    "title": "משימת שברים", "pinned_by": "teacher-1",
    "pinned_at": "2026-08-20T08:00:00+00:00",
}


class PinningHelperTest(unittest.TestCase):
    """The one judgement all four read sites share."""

    def test_a_legacy_pin_without_kind_still_steers(self):
        from app.services import pinning

        pin = pinning.active_pin({"pinned_next": dict(_PIN)})
        self.assertIsNotNone(pin)
        self.assertEqual(pinning.pin_kind(pin), "component")

    def test_a_future_date_steers_and_a_past_one_does_not(self):
        from app.services import pinning

        self.assertIsNotNone(pinning.active_pin(
            {"pinned_next": {**_PIN, "expires_at": "2999-01-01T00:00:00+00:00"}}))
        self.assertIsNone(pinning.active_pin(
            {"pinned_next": {**_PIN, "expires_at": "2020-01-01T00:00:00+00:00"}}))

    def test_a_date_we_cannot_read_fails_closed(self):
        """A pin we cannot date must not steer a child forever on a typo."""
        from app.services import pinning

        self.assertIsNone(pinning.active_pin(
            {"pinned_next": {**_PIN, "expires_at": "not-a-date"}}))

    def test_the_spent_gate_is_component_only(self):
        """Task completion is adjudicated at submission, never in events —
        `completed_ids` speaks component ids and must not judge a task pin."""
        from app.services import pinning

        self.assertIsNone(pinning.active_pin(
            {"pinned_next": dict(_PIN)}, completed_ids={"cmp-pin"}))
        self.assertIsNotNone(pinning.active_pin(
            {"pinned_next": dict(_TASK_PIN)}, completed_ids={"tsk-abc:1"}))

    def test_the_spent_record_keeps_the_pin_and_adds_the_ending(self):
        from app.services import pinning

        record = pinning.spent_record(dict(_PIN), pinning.OUTCOME_UNPINNED)
        self.assertEqual(record["component_id"], "cmp-pin")
        self.assertEqual(record["outcome"], "unpinned")
        self.assertTrue(record["ended_at"])


class HeroPinExpiryTest(HeroPinTest):
    """The hero reads the shared judgement — expiry and the resume aside."""

    def _hero(self, brain, completed_ids=frozenset()):
        from app.services import dashboard

        known = {"cmp-pin": _COMPONENT,
                 "cmp-other": {"id": "cmp-other", "unit_id": "unit-2",
                               "objective_id": "OBJ.2", "subject": "math",
                               "title": "אחר"}}
        with patch.object(dashboard, "get_component",
                          lambda cid: known.get(cid)), \
             patch.object(dashboard, "localized_objective_title",
                          lambda oid, lang=None: "כותרת"), \
             patch.object(dashboard.content_catalog, "objective_plan",
                          lambda *a, **k: {"progress_ratio": 0.4}), \
             patch.object(dashboard.content_catalog, "learner_signals",
                          lambda _brain: {}), \
             patch.object(dashboard, "next_focus",
                          lambda _brain: {"subject": None, "objective_id": None,
                                          "mode": "new", "plan": {}}), \
             patch("app.services.kata_catalog.get_objective", lambda oid: {}):
            return dashboard._hero(brain, "he", completed_ids)

    def test_an_expired_pin_falls_through_to_resume(self):
        hero = self._hero({
            "pinned_next": {**_PIN, "expires_at": "2020-01-01T00:00:00+00:00"},
            "current_state": {"component_id": "cmp-other"},
            "mastery": {},
        })
        self.assertEqual(hero["mode"], "resume")

    def test_a_task_pin_renders_without_catalog_coordinates(self):
        hero = self._hero({
            "pinned_next": dict(_TASK_PIN), "current_state": {}, "mastery": {},
        })
        self.assertEqual(hero["mode"], "pinned")
        self.assertEqual(hero["pinnedKind"], "task")
        self.assertEqual(hero["launchId"], "tsk-abc:1")
        self.assertEqual(hero["objectiveTitle"], "משימת שברים")
        self.assertIsNone(hero["componentId"])

    def test_the_displaced_lesson_rides_the_pinned_payload(self):
        """The child mid-something-else keeps a door back to it."""
        hero = self._hero({
            "pinned_next": dict(_PIN),
            "current_state": {"component_id": "cmp-other"},
            "mastery": {},
        })
        self.assertEqual(hero["mode"], "pinned")
        self.assertEqual(hero["resume"]["componentId"], "cmp-other")
        self.assertEqual(hero["resume"]["unitId"], "unit-2")

    def test_no_aside_when_the_pin_is_the_lesson_they_are_in(self):
        hero = self._hero({
            "pinned_next": dict(_PIN),
            "current_state": {"component_id": "cmp-pin"},
            "mastery": {},
        })
        self.assertEqual(hero["mode"], "pinned")
        self.assertIsNone(hero["resume"])


class SelectNextTaskPinTest(SelectNextPinTest):
    async def test_a_task_pin_leaves_the_planner_in_charge(self):
        """The route speaks only catalog components; the hero owns task-pin
        steering by navigating straight to the task. A caller landing here
        under a task pin is mid-something-else and gets the planner's answer."""
        decision, planner = await self._select(
            {"pinned_next": dict(_TASK_PIN)}, events=[])
        self.assertNotEqual(decision["reason"], "pinned")
        planner.assert_called_once()


class FoldSpentRecordTest(FoldClearsPinTest):
    async def test_the_fold_records_how_the_pin_ended(self):
        apply = await self._fold(
            {"learner_id": "kid", "verb": "completed", "launch": "cmp-pin",
             "result": {"success": True}},
            {"current_state": {}, "pinned_next": dict(_PIN), "mastery": {}},
        )
        set_updates = apply.await_args.args[1]
        self.assertIsNone(set_updates["pinned_next"])
        self.assertEqual(set_updates["pinned_last"]["outcome"], "completed")
        self.assertEqual(set_updates["pinned_last"]["component_id"], "cmp-pin")


class UnpinOutcomeTest(unittest.IsolatedAsyncioTestCase):
    async def _unpin(self, standing_pin):
        from app.routes import teacher_students as routes

        with patch.object(routes, "_guard_learner", AsyncMock(return_value="kid")), \
             patch("app.brain.repository.get_brain",
                   AsyncMock(return_value={"pinned_next": standing_pin})), \
             patch("app.brain.repository.apply_brain_updates", AsyncMock()) as write:
            response = await routes.unpin_next("kid", session={"sub": "teacher-1"})
        self.assertEqual(response.status_code, 200)
        return write.await_args.args[1]

    async def test_withdrawing_a_live_pin_is_recorded_as_unpinned(self):
        updates = await self._unpin(dict(_PIN))
        self.assertIsNone(updates["pinned_next"])
        self.assertEqual(updates["pinned_last"]["outcome"], "unpinned")

    async def test_clearing_a_lapsed_pin_is_recorded_as_expired(self):
        updates = await self._unpin({**_PIN, "expires_at": "2020-01-01T00:00:00+00:00"})
        self.assertEqual(updates["pinned_last"]["outcome"], "expired")

    async def test_unpinning_nothing_writes_no_ending(self):
        updates = await self._unpin(None)
        self.assertIsNone(updates["pinned_next"])
        self.assertNotIn("pinned_last", updates)


class TaskPinRouteTest(unittest.IsolatedAsyncioTestCase):
    async def _pin_task(self, *, activation, body=None):
        from app.routes import teacher_students as routes

        task = {"spec": {"title": "משימת שברים"}}
        with patch.object(routes, "_guard_learner", AsyncMock(return_value="kid")), \
             patch("app.services.kata_catalog.ensure_loaded", AsyncMock()), \
             patch("app.services.tasks.store.get_activation",
                   AsyncMock(return_value=activation)), \
             patch("app.services.tasks.store.get_task",
                   AsyncMock(return_value=task)), \
             patch("app.brain.repository.get_brain",
                   AsyncMock(return_value={})), \
             patch("app.brain.repository.apply_brain_updates", AsyncMock()) as write, \
             patch("app.services.notifications.notify", AsyncMock()) as notify:
            response = await routes.pin_next(
                "kid", body or {"launch_id": "tsk-abc:1"},
                session={"sub": "teacher-1"},
            )
        return response, write, notify

    async def test_an_assigned_task_pins_with_its_frozen_title(self):
        response, write, notify = await self._pin_task(activation={"launch_id": "tsk-abc:1"})
        self.assertEqual(response.status_code, 200)
        pinned = write.await_args.args[1]["pinned_next"]
        self.assertEqual(pinned["kind"], "task")
        self.assertEqual(pinned["task_id"], "tsk-abc")
        self.assertEqual(pinned["launch_id"], "tsk-abc:1")
        self.assertEqual(pinned["title"], "משימת שברים")
        self.assertEqual(
            notify.await_args.kwargs["notification_id"], "pinned_next:kid:tsk-abc:1")
        self.assertEqual(
            notify.await_args.kwargs["actions"][0]["route"], "/tasks/tsk-abc:1")

    async def test_a_task_the_child_was_never_given_is_a_422_not_a_pin(self):
        """The activation IS the authorization boundary — the same rule the
        learner's own task route applies."""
        response, write, notify = await self._pin_task(activation=None)
        self.assertEqual(response.status_code, 422)
        write.assert_not_awaited()
        notify.assert_not_awaited()

    async def test_a_pin_born_expired_is_refused_before_any_write(self):
        """Read-side expiry has no sweeper: a pin already past its date would
        be a record nothing ever honours."""
        response, write, _notify = await self._pin_task(
            activation={"launch_id": "tsk-abc:1"},
            body={"launch_id": "tsk-abc:1", "expires_at": "2020-01-01"},
        )
        self.assertEqual(response.status_code, 422)
        write.assert_not_awaited()


class BulkPinTest(unittest.IsolatedAsyncioTestCase):
    async def _bulk(self, *, guarded=True, resolved=("kid-a", "kid-b"),
                    body=None, activations=None):
        from app.routes import teacher_students as routes

        async def _activation(launch, learner_id):
            if activations is None:
                return {"launch_id": launch}
            return activations.get(learner_id)

        with patch.object(routes, "_guard_group",
                          AsyncMock(return_value=guarded)), \
             patch("app.services.kata_catalog.ensure_loaded", AsyncMock()), \
             patch("app.services.kata_catalog.get_component",
                   lambda cid: _COMPONENT if cid == "cmp-pin" else None), \
             patch("app.services.tasks.assign.resolve_targets",
                   AsyncMock(return_value=list(resolved))) as resolve, \
             patch("app.services.tasks.store.get_activation",
                   AsyncMock(side_effect=_activation)), \
             patch("app.services.tasks.store.get_task",
                   AsyncMock(return_value={"spec": {"title": "משימה"}})), \
             patch("app.brain.repository.get_brain",
                   AsyncMock(return_value={})), \
             patch("app.brain.repository.apply_brain_updates", AsyncMock()) as write, \
             patch("app.services.notifications.notify", AsyncMock()) as notify:
            response = await routes.bulk_pin_next(
                "grp",
                body or {"targets": [{"kind": "group", "id": "grp"}],
                         "pin": {"component_id": "cmp-pin"}},
                session={"sub": "teacher-1"},
            )
        return response, resolve, write, notify

    async def test_a_foreign_group_is_refused_before_any_resolution(self):
        response, resolve, write, notify = await self._bulk(guarded=False)
        self.assertEqual(response.status_code, 403)
        resolve.assert_not_awaited()
        write.assert_not_awaited()
        notify.assert_not_awaited()

    async def test_every_resolved_learner_is_pinned_and_notified_once(self):
        response, _resolve, write, notify = await self._bulk()
        self.assertEqual(response.status_code, 200)
        body = json.loads(response.body)
        self.assertEqual(body["pinned"], ["kid-a", "kid-b"])
        self.assertEqual(body["skipped"], [])
        self.assertEqual(write.await_count, 2)
        self.assertEqual(notify.await_count, 2)
        self.assertEqual(
            {call.kwargs["notification_id"] for call in notify.await_args_list},
            {"pinned_next:kid-a:cmp-pin", "pinned_next:kid-b:cmp-pin"},
        )

    async def test_a_task_bulk_skips_the_unassigned_and_says_so(self):
        """A child the task was never given is reported, never silently pinned
        to a paper their own route would answer with 404."""
        response, _resolve, write, _notify = await self._bulk(
            body={"targets": [{"kind": "group", "id": "grp"}],
                  "pin": {"launch_id": "tsk-abc:1"}},
            activations={"kid-a": {"launch_id": "tsk-abc:1"}, "kid-b": None},
        )
        body = json.loads(response.body)
        self.assertEqual(body["pinned"], ["kid-a"])
        self.assertEqual(body["skipped"],
                         [{"learner_id": "kid-b", "reason": "not_assigned"}])
        self.assertEqual(write.await_count, 1)

    async def test_an_unknown_component_pins_nobody(self):
        response, _resolve, write, _notify = await self._bulk(
            body={"targets": [{"kind": "group", "id": "grp"}],
                  "pin": {"component_id": "cmp-nope"}},
        )
        self.assertEqual(response.status_code, 422)
        write.assert_not_awaited()


class TaskSubmitClearsPinTest(unittest.IsolatedAsyncioTestCase):
    async def _clear(self, brain, launch="tsk-abc:1"):
        from app.services.tasks import attempts

        with patch("app.brain.repository.get_brain",
                   AsyncMock(return_value=brain)), \
             patch("app.brain.repository.apply_brain_updates", AsyncMock()) as write:
            await attempts._clear_task_pin(launch, "kid")
        return write

    async def test_submitting_the_pinned_task_retires_the_pin(self):
        write = await self._clear({"pinned_next": dict(_TASK_PIN)})
        updates = write.await_args.args[1]
        self.assertIsNone(updates["pinned_next"])
        self.assertEqual(updates["pinned_last"]["outcome"], "completed")

    async def test_submitting_a_different_task_leaves_the_pin_alone(self):
        write = await self._clear({"pinned_next": dict(_TASK_PIN)}, launch="tsk-zzz:4")
        write.assert_not_awaited()

    async def test_a_component_pin_is_not_the_fold_of_this_lane(self):
        write = await self._clear({"pinned_next": dict(_PIN)}, launch="cmp-pin")
        write.assert_not_awaited()

    async def test_a_failed_brain_write_never_blocks_the_submission(self):
        from app.services.tasks import attempts

        with patch("app.brain.repository.get_brain",
                   AsyncMock(side_effect=RuntimeError("db down"))):
            await attempts._clear_task_pin("tsk-abc:1", "kid")  # must not raise


class PinnedLastSchemaTest(unittest.TestCase):
    def test_the_spent_record_is_replaced_whole(self):
        """Component and task records have different fields; a merge would keep
        stale keys from the longer predecessor."""
        from app.brain.schema import flatten_updates

        flat = flatten_updates({"pinned_last": {**_PIN, "outcome": "unpinned"}})
        self.assertIn("pinned_last", flat)
        self.assertNotIn("pinned_last.component_id", flat)


if __name__ == "__main__":
    unittest.main()
