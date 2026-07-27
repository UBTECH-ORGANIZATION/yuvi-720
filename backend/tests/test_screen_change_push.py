"""`screen_change` SSE push (orchestration refactor): the server tells the
companion which question SCREEN the learner is on the instant an ingested xAPI
event advances `current_state`, instead of the client waiting for its ~2.5s
support-state poll. Direct-published like `completion` — no cooldown, no
priority competition, deduped per screen.
"""

from __future__ import annotations

import os
import sys
import unittest
from unittest.mock import AsyncMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services import events, triggers  # noqa: E402


class PublishScreenChangeTests(unittest.TestCase):
    def setUp(self) -> None:
        triggers._last_screen_key.clear()
        triggers._last_published.clear()

    def test_publishes_screen_change_with_exact_key(self) -> None:
        with patch("app.services.triggers._publish") as publish:
            triggers.publish_screen_change(
                "L", "comp-01|comp-01-002", component_id="comp-01", unit_id="unit-1"
            )
        publish.assert_called_once()
        payload = publish.call_args[0][1]
        self.assertEqual(payload["type"], "screen_change")
        self.assertEqual(payload["question_key"], "comp-01|comp-01-002")
        self.assertEqual(payload["component_id"], "comp-01")
        self.assertEqual(payload["unit_id"], "unit-1")

    def test_same_screen_does_not_republish(self) -> None:
        with patch("app.services.triggers._publish") as publish:
            triggers.publish_screen_change("L", "comp-01|comp-01-002")
            triggers.publish_screen_change("L", "comp-01|comp-01-002")
        publish.assert_called_once()

    def test_new_screen_republishes(self) -> None:
        with patch("app.services.triggers._publish") as publish:
            triggers.publish_screen_change("L", "comp-01|comp-01-002")
            triggers.publish_screen_change("L", "comp-01|comp-01-003")
        self.assertEqual(publish.call_count, 2)

    def test_bypasses_cooldown_and_burns_no_nudge_state(self) -> None:
        # Two navigations back-to-back both fire even though the first stamps
        # `_last_published[(L, screen_change)]` — publish_screen_change never
        # consults `_on_cooldown` (proof: the second still publishes). A screen
        # change never STAMPS a mistake/success cooldown (it CLEARS pre-existing
        # ones so the next question can react — see test_subquestion_transition);
        # here none exist, so none appear.
        with patch("app.services.triggers._publish",
                   wraps=triggers._publish) as publish:
            triggers.publish_screen_change("L", "comp-01|comp-01-002")
            triggers.publish_screen_change("L", "comp-01|comp-01-003")
        self.assertEqual(publish.call_count, 2)
        self.assertNotIn(("L", "mistake"), triggers._last_published)
        self.assertNotIn(("L", "success"), triggers._last_published)


class IngestOrderingTests(unittest.IsolatedAsyncioTestCase):
    """The push must precede the nudge from the SAME event, so a wrong answer
    that also advances the screen lands the client on the new screen first."""

    def setUp(self) -> None:
        triggers._last_screen_key.clear()

    async def _ingest(self, event: dict) -> dict:
        # Drive ingest_statement with the pipeline stubbed to first-sight, so we
        # observe only the trigger-hook ordering. normalize returns our event.
        with (
            patch.object(events, "statement_matches_launch", return_value=True),
            patch.object(events, "normalize_statement", return_value=event),
            patch.object(events, "_reconcile_sub_item_id", new=AsyncMock()),
            patch.object(events, "_attach_timing_evidence", new=AsyncMock()),
            patch.object(events, "_attach_effort_evidence", new=AsyncMock()),
            patch.object(events, "_events_collection", new=AsyncMock(return_value=None)),
            patch.object(events, "_fallback_append", return_value=True),
            patch.object(events, "_update_item_stats", new=AsyncMock()),
            patch.object(events, "_apply_event_to_brain", new=AsyncMock()),
            patch.object(events, "is_component_completion", return_value=False),
            patch.object(events, "_forward_to_moe_lrs", new=AsyncMock()),
        ):
            return await events.ingest_statement({"id": "s1"}, {"cmp": "comp-01"})

    async def test_screen_change_published_before_mistake(self) -> None:
        event = {
            "_id": "e1", "learner_id": "L", "verb": "answered",
            "launch": "comp-01", "unit_id": "unit-1",
            "sub_item_id": "comp-01-003", "question_id": "q1",
            "object_id": "https://kata/comp-01/comp-01-003/q1",
            "effortful": True, "result": {"success": False}, "timing": {},
        }
        order: list[str] = []
        with (
            patch.object(triggers, "publish_screen_change",
                         side_effect=lambda *a, **k: order.append("screen_change")),
            patch.object(triggers, "evaluate",
                         new=AsyncMock(side_effect=lambda *a, **k: order.append("evaluate"))),
        ):
            result = await self._ingest(event)
        self.assertTrue(result["stored"])
        self.assertEqual(order, ["screen_change", "evaluate"])

    async def test_no_sub_item_skips_screen_change(self) -> None:
        event = {
            "_id": "e2", "learner_id": "L", "verb": "answered",
            "launch": "comp-01", "result": {"success": False}, "timing": {},
        }
        with (
            patch.object(triggers, "publish_screen_change") as push,
            patch.object(triggers, "evaluate", new=AsyncMock()),
        ):
            await self._ingest(event)
        push.assert_not_called()

    async def test_publish_failure_never_blocks_ingest(self) -> None:
        event = {
            "_id": "e3", "learner_id": "L", "verb": "enter",
            "launch": "comp-01", "sub_item_id": "comp-01-002",
        }
        with (
            patch.object(triggers, "publish_screen_change",
                         side_effect=RuntimeError("bus down")),
            patch.object(triggers, "evaluate", new=AsyncMock()),
        ):
            result = await self._ingest(event)
        self.assertTrue(result["stored"])


class IdleThenMistakeTests(unittest.IsolatedAsyncioTestCase):
    """Regression lock for the live bug (server side): an idle nudge followed
    seconds later by a wrong answer must publish BOTH — the client queue then
    guarantees both are shown."""

    def setUp(self) -> None:
        triggers._last_mistake_key.clear()
        triggers._last_streak_session.clear()
        triggers._last_published.clear()
        for handle in list(triggers._idle_handles.values()):
            handle.cancel()
        triggers._idle_handles.clear()

    async def test_idle_then_mistake_both_publish(self) -> None:
        published: list[dict] = []
        with patch("app.services.triggers._publish",
                   side_effect=lambda lid, t: published.append(t)):
            triggers.publish_idle("L", "obj-1")
            with patch("app.services.events.get_recent_events",
                       new=AsyncMock(return_value=[])):
                await triggers.evaluate("L", {
                    "verb": "answered", "objective_id": "obj-1", "question_id": "q1",
                    "object_id": "comp-01/q1", "effortful": True,
                    "result": {"success": False}, "timing": {},
                })
        types = [t["type"] for t in published]
        self.assertIn("idle", types)
        self.assertIn("mistake", types)


if __name__ == "__main__":
    unittest.main()
