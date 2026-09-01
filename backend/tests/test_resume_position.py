"""An entry without a reported screen must respect saved progress.

Measured 2026-09-01 on `COMPL-00001`: CET saves per student+component and
reopens the lomda MID-way, but the entry fallback always grounded on the first
catalog item. Worse, that component's items 1/2 are look-alike VARIANTS (same
question texts, mirrored data) of which the player deals ONE — the coach
described item 1's points (a column at x=6) to a learner looking at item 2's
row at y=3, quoting coordinates that were simply not on their screen.

The guess is now progress-aware (the learner's last recorded screen in THIS
component beats "screen one") and variant-aware (look-alike siblings raise a
hedge flag so the coach never quotes variant-specific values as fact).
"""

from __future__ import annotations

import os
import sys
import unittest
from unittest.mock import AsyncMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.brain import context_engine  # noqa: E402


COMPONENT = "c-01"

BRAIN_NO_SCREEN = {
    "current_state": {"component_id": COMPONENT, "unit_id": "u-1"},
    "goals": [],
    "identity": {"locale": "he"},
}

ROWS = [
    {"id": "c-01-001", "title": "חקר", "media_format": "interactive-content",
     "content_type": "practice", "question_count": 2},
    {"id": "c-01-002", "title": "חקר (וריאציה)", "media_format": "interactive-content",
     "content_type": "practice", "question_count": 2},
    {"id": "c-01-003", "title": "השלמה", "media_format": "interactive-content",
     "content_type": "practice", "question_count": 1},
]

# Items 1/2 share the learner-visible ordinal — the variant family.
VARIANT_ORDINALS = {"c-01-001": 1, "c-01-002": 1, "c-01-003": 2}
PLAIN_ORDINALS = {"c-01-001": 1, "c-01-002": 2, "c-01-003": 3}


def _answered(item_id):
    return {"verb": "answered", "sub_item_id": item_id, "launch": COMPONENT,
            "result": {}, "question_id": "qb1"}


class ResumePositionTests(unittest.IsolatedAsyncioTestCase):
    async def _current(self, component_events, ordinals=PLAIN_ORDINALS):
        def recent(learner_id, objective_id=None, limit=5, component_id=None):
            return component_events if component_id else []

        with patch.object(context_engine, "view_for",
                          new=AsyncMock(return_value=BRAIN_NO_SCREEN)), \
             patch("app.services.kata_catalog.ensure_loaded", new=AsyncMock()), \
             patch("app.services.kata_catalog.get_component",
                   return_value={"id": COMPONENT}), \
             patch("app.services.kata_catalog.questions_for_item", return_value=[]), \
             patch("app.services.kata_catalog.item_profile",
                   side_effect=lambda c, i: next((r for r in ROWS if r["id"] == i), None)), \
             patch("app.services.kata_catalog.item_profiles", return_value=ROWS), \
             patch("app.services.kata_catalog.question_item_ordinals",
                   return_value=ordinals), \
             patch("app.services.kata_catalog.resolve_catalog_item_id",
                   side_effect=lambda c, i, **k: i), \
             patch("app.services.events.get_recent_events",
                   new=AsyncMock(side_effect=recent)):
            bundle = await context_engine.build_coach_bundle(
                "L", surface_context={"screen": "learning_lesson"},
            )
        return bundle.get("current") or {}

    async def test_a_fresh_component_assumes_its_first_screen(self):
        current = await self._current([])
        self.assertEqual(current.get("item_id"), "c-01-001")
        self.assertTrue(current.get("position_assumed"))

    async def test_saved_progress_grounds_on_the_last_recorded_screen(self):
        # The player reopens mid-lomda — "screen one" is provably wrong the
        # moment any event exists here.
        current = await self._current([_answered("c-01-003")])
        self.assertEqual(current.get("item_id"), "c-01-003")
        self.assertTrue(current.get("position_assumed"))

    async def test_a_variant_screen_raises_the_hedge_flag(self):
        current = await self._current(
            [_answered("c-01-002")], ordinals=VARIANT_ORDINALS)
        self.assertEqual(current.get("item_id"), "c-01-002")
        self.assertTrue(current.get("screen_has_variants"))

    async def test_a_screen_without_siblings_stays_unflagged(self):
        current = await self._current([_answered("c-01-003")],
                                      ordinals=VARIANT_ORDINALS)
        self.assertFalse(current.get("screen_has_variants"))

    async def test_a_reported_position_is_never_flagged_assumed(self):
        brain = {"current_state": {"component_id": COMPONENT, "unit_id": "u-1",
                                   "item_id": "c-01-002"},
                 "goals": [], "identity": {"locale": "he"}}
        with patch.object(context_engine, "view_for",
                          new=AsyncMock(return_value=brain)), \
             patch("app.services.kata_catalog.ensure_loaded", new=AsyncMock()), \
             patch("app.services.kata_catalog.get_component",
                   return_value={"id": COMPONENT}), \
             patch("app.services.kata_catalog.questions_for_item", return_value=[]), \
             patch("app.services.kata_catalog.item_profile",
                   side_effect=lambda c, i: next((r for r in ROWS if r["id"] == i), None)), \
             patch("app.services.kata_catalog.resolve_catalog_item_id",
                   side_effect=lambda c, i, **k: i), \
             patch("app.services.events.get_recent_events",
                   new=AsyncMock(return_value=[])):
            bundle = await context_engine.build_coach_bundle(
                "L", surface_context={"screen": "learning_lesson"},
            )
        current = bundle.get("current") or {}
        self.assertFalse(current.get("position_assumed"))
        self.assertFalse(current.get("screen_has_variants"))


if __name__ == "__main__":
    unittest.main()
