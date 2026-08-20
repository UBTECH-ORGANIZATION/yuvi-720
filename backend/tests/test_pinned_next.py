"""The teacher's pin (#249, minimal slice of #244): one component, chosen by a
person, that outranks the planner until it is completed.

The behaviours worth protecting: scope before any write, the catalog as the
only source of what a pin points at, both chokepoints (hero + route) honouring
the same pin the same way, and the ONE place completion is adjudicated being
the one place the pin clears.
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
                        "notif.pinnedNext", "notif.action.openLesson"):
                self.assertIn(key, data, f"{key} missing from {lang}")


if __name__ == "__main__":
    unittest.main()
