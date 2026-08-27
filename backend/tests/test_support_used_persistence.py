"""Per-question state objects must be written WHOLE, not merged through a null.

Measured 29/07 on a live lesson: the learner pressed "תן/י לי רמז" three times on
one question and got three hints, and the "מה עזר לך?" chips never offered
hint/explanation. `current_state.support_used` was `null` in the brain the whole
time even though the hint had been served.

Cause: every lesson launch resets `current_state.support_used` to `None`
(the content restarts, so the one-shot gate must too). `record_support_used`
then wrote a nested dict, which `flatten_updates` exploded into
`current_state.support_used.hint` — and Mongo refuses to create a field inside a
null parent:

    WriteError 28: Failed to create the field 'support_used' within the element
    specified by {support_used: null}

`apply_brain_operators` swallowed that into the JSON fallback, which is not the
read path, so the write vanished silently. Marking these keys opaque makes the
whole object the value of one `$set`, which replaces the null outright.
"""

from __future__ import annotations

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.brain.schema import flatten_updates  # noqa: E402


SUPPORT = {"question_key": "c|i|q1", "hint": True, "explanation": False, "updated_at": "now"}


class OpaqueStateObjectTests(unittest.TestCase):
    def test_support_used_is_set_as_one_value(self):
        flat = flatten_updates({"current_state.support_used": SUPPORT})
        self.assertEqual(flat, {"current_state.support_used": SUPPORT})

    def test_the_hint_ladder_too(self):
        ladder = {"component_id": "c", "level": 2, "updated_at": "now"}
        flat = flatten_updates({"current_state.hint_ladder": ladder})
        self.assertEqual(flat, {"current_state.hint_ladder": ladder})

    def test_the_nested_spelling_flattens_to_the_same_single_key(self):
        flat = flatten_updates({"current_state": {"support_used": SUPPORT}})
        self.assertEqual(flat, {"current_state.support_used": SUPPORT})

    def test_ordinary_nested_updates_still_merge_field_by_field(self):
        """Opacity is per-key, not a blanket change to how the brain is written."""
        flat = flatten_updates({"profile": {"interests": ["a"], "learning_style": "v"}})
        self.assertEqual(
            flat, {"profile.interests": ["a"], "profile.learning_style": "v"}
        )


class SupportRoundTripTests(unittest.IsolatedAsyncioTestCase):
    """`record_support_used` → `support_used` must survive the reset-to-null."""

    async def test_a_hint_is_recorded_over_a_null_parent(self):
        from unittest.mock import AsyncMock, patch

        from app.agents import tutor_decision

        stored: dict = {"current_state": {"support_used": None}}

        async def fake_apply(_lid, set_fields, inc_fields=None):
            flat = flatten_updates(set_fields)
            for path, value in flat.items():
                if path == "current_state.support_used":
                    # A single-value $set replaces the null; a dotted sub-path
                    # against null is what Mongo rejects, so assert we never emit one.
                    stored["current_state"]["support_used"] = value
                else:
                    self.assertNotIn("support_used", path)

        with (
            patch("app.brain.repository.get_brain", new=AsyncMock(return_value=stored)),
            patch("app.brain.repository.apply_brain_operators", new=fake_apply),
        ):
            await tutor_decision.record_support_used("L", "c|i|q1", "hint")

        used = tutor_decision.support_used(stored["current_state"], "c|i|q1")
        self.assertEqual(used, {"hint": True, "explanation": False, "hint_level": 1})

    async def test_one_hint_exhausts_only_the_current_question(self):
        from unittest.mock import AsyncMock, patch

        from app.agents import tutor_decision

        stored: dict = {"current_state": {"support_used": None}}

        async def fake_apply(_lid, set_fields, inc_fields=None):
            stored["current_state"]["support_used"] = flatten_updates(set_fields)["current_state.support_used"]

        with (
            patch("app.brain.repository.get_brain", new=AsyncMock(side_effect=lambda _lid: stored)),
            patch("app.brain.repository.apply_brain_operators", new=fake_apply),
        ):
            levels = [await tutor_decision.record_support_used("L", "c|i|q1", "hint")]

        self.assertEqual(levels, [1])
        self.assertEqual(
            tutor_decision.support_used(stored["current_state"], "c|i|q1"),
            {"hint": True, "explanation": False, "hint_level": 1},
        )

    async def test_moving_to_the_next_question_re_arms_the_buttons(self):
        from app.agents import tutor_decision

        state = {"support_used": {"question_key": "c|i|q1", "hint": True, "explanation": True}}
        self.assertEqual(
            tutor_decision.support_used(state, "c|i|q2"),
            {"hint": False, "explanation": False, "hint_level": 0},
        )


if __name__ == "__main__":
    unittest.main()
