"""Two features, two fields — and neither one erases the other.

`learner_state.avatar` used to hold both the profile-picture choice and the Yuvi
Studio character. The read below fills an unset `avatar` with the learner's best
earned coin, and a saved design has no `kind`, so it failed that test and was
replaced on every read: children designed a robot, saved it, reloaded, and got
the default back. Saving in the studio also wiped whichever coin they had picked
as their picture, and picking a coin wiped the robot.

So the properties worth pinning are the ones that were broken: a design survives
a read, a coin survives a design, and a design saved under the old field is
still found.
"""

from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import learner_state as learner_state_store
from app.routes import learner_state as route

LEARNER = "kid-1"

DESIGN = {
    "version": 1,
    "variant": "girl",
    "colors": {"body": "#9cc1e8", "eyes": "#4eeef0", "smile": "#74f7ff", "glow": "#7C6BFF"},
    "equipped": {"headTop": "beanie", "face": None, "back": None, "handR": None, "body": None},
}
COIN = {"kind": "badge", "badge": {"subject": "science", "glyph": "flask", "tier": "gold"}}
BEST = {"kind": "badge", "badge": {"subject": "math", "glyph": "abc", "tier": "silver"}}


async def _read(stored: dict) -> dict:
    """GET /api/learner-state against a fixed stored document."""
    state = {"learner_id": LEARNER, "avatar": None, "yuvi_design": None, **stored}
    with patch.object(route, "get_learner_state", AsyncMock(return_value=state)), \
         patch.object(route, "_earned_avatar", AsyncMock(return_value=BEST)):
        response = await route.read_learner_state(learner_id=LEARNER)
    return json.loads(bytes(response.body))


class TheStudioDesignSurvives(unittest.IsolatedAsyncioTestCase):
    async def test_a_saved_design_is_returned_untouched(self) -> None:
        state = await _read({"yuvi_design": DESIGN})
        self.assertEqual(state["yuvi_design"], DESIGN)

    async def test_the_earned_coin_never_lands_on_the_design(self) -> None:
        """The bug itself: the coin is derived onto `avatar`, and only `avatar`."""
        state = await _read({"yuvi_design": DESIGN})
        self.assertEqual(state["avatar"], BEST)
        self.assertEqual(state["yuvi_design"]["variant"], "girl")

    async def test_a_chosen_coin_and_a_design_coexist(self) -> None:
        state = await _read({"avatar": COIN, "yuvi_design": DESIGN})
        self.assertEqual(state["avatar"], COIN)
        self.assertEqual(state["yuvi_design"], DESIGN)

    async def test_no_design_stays_no_design(self) -> None:
        """An empty studio must not be handed a badge dict to render as a robot."""
        state = await _read({"avatar": COIN})
        self.assertIsNone(state["yuvi_design"])


class DesignsSavedBeforeTheSplit(unittest.IsolatedAsyncioTestCase):
    async def test_a_legacy_design_under_avatar_is_served_as_the_design(self) -> None:
        state = await _read({"avatar": DESIGN})
        self.assertEqual(state["yuvi_design"], DESIGN)

    async def test_the_legacy_document_still_gets_its_derived_coin(self) -> None:
        """It is not a choice, so the picture falls back to the earned coin."""
        state = await _read({"avatar": DESIGN})
        self.assertEqual(state["avatar"], BEST)

    async def test_a_new_design_wins_over_the_legacy_copy(self) -> None:
        stale = {**DESIGN, "variant": "classic"}
        state = await _read({"avatar": stale, "yuvi_design": DESIGN})
        self.assertEqual(state["yuvi_design"]["variant"], "girl")

    async def test_a_choice_is_never_mistaken_for_a_design(self) -> None:
        for choice in (COIN, {"kind": "initial"}):
            with self.subTest(choice=choice):
                self.assertIsNone(route._legacy_design(choice))

    async def test_junk_is_not_a_design(self) -> None:
        for junk in (None, "classic", {}, {"language": "he"}, []):
            with self.subTest(junk=junk):
                self.assertIsNone(route._legacy_design(junk))


class WhatAClientMayWrite(unittest.TestCase):
    def test_the_design_is_client_writable_and_the_unlocks_are_not(self) -> None:
        """Cosmetics are earned; the design they are worn on is the learner's."""
        source = Path(learner_state_store.__file__).read_text(encoding="utf-8")
        allowed = source.split("allowed = {", 1)[1].split("}", 1)[0]
        self.assertIn('"yuvi_design"', allowed)
        self.assertIn('"avatar"', allowed)
        self.assertNotIn('"avatar_unlocks"', allowed)
        self.assertNotIn('"room_unlocks"', allowed)

    def test_the_field_exists_on_a_learner_who_has_never_saved(self) -> None:
        self.assertIn("yuvi_design", learner_state_store._empty_state(LEARNER))


async def _screen(payload: dict, held: set[str]) -> dict:
    """Run a PATCH body through the equipped screen with a fixed unlock set."""
    with patch.object(route.unlock_sync, "held_cosmetics", AsyncMock(return_value=held)):
        await route._screen_equipped(LEARNER, payload)
    return payload


def _design(**equipped) -> dict:
    slots = {"headTop": None, "face": None, "back": None, "handR": None, "body": None}
    return {**DESIGN, "equipped": {**slots, **equipped}}


class YuviWearsOnlyWhatWasEarned(unittest.IsolatedAsyncioTestCase):
    """The studio hides locked items, which stops a learner and stops nobody
    else. The design is client-writable, so without this a hand-written PATCH
    dressed Yuvi in the whole shop for free — and sparks are the reward loop."""

    async def test_an_unpaid_shop_item_comes_straight_back_off(self) -> None:
        body = await _screen({"yuvi_design": _design(headTop="ironhelmet")}, held=set())
        self.assertIsNone(body["yuvi_design"]["equipped"]["headTop"])

    async def test_an_unearned_badge_cosmetic_comes_off_too(self) -> None:
        body = await _screen({"yuvi_design": _design(headTop="laurel")}, held=set())
        self.assertIsNone(body["yuvi_design"]["equipped"]["headTop"])

    async def test_what_the_learner_paid_for_stays_on(self) -> None:
        body = await _screen({"yuvi_design": _design(headTop="ironhelmet")}, held={"ironhelmet"})
        self.assertEqual(body["yuvi_design"]["equipped"]["headTop"], "ironhelmet")

    async def test_free_gear_never_needs_permission(self) -> None:
        body = await _screen({"yuvi_design": _design(headTop="snapback", body="jacket")}, held=set())
        self.assertEqual(body["yuvi_design"]["equipped"]["headTop"], "snapback")
        self.assertEqual(body["yuvi_design"]["equipped"]["body"], "jacket")

    async def test_only_the_offending_slot_is_emptied(self) -> None:
        """The rest of the design is the learner's own work — refusing the whole
        write would throw away colours they really did choose."""
        body = await _screen(
            {"yuvi_design": _design(headTop="ironhelmet", body="jacket")}, held=set(),
        )
        design = body["yuvi_design"]
        self.assertIsNone(design["equipped"]["headTop"])
        self.assertEqual(design["equipped"]["body"], "jacket")
        self.assertEqual(design["variant"], "girl")
        self.assertEqual(design["colors"], DESIGN["colors"])

    async def test_the_old_field_is_not_a_way_around_the_screen(self) -> None:
        """A design written to `avatar` is still served back as the design (see
        `_legacy_design`), so it has to be screened as one."""
        body = await _screen({"avatar": _design(handR="lightsaber")}, held=set())
        self.assertIsNone(body["avatar"]["equipped"]["handR"])

    async def test_a_profile_picture_choice_is_left_alone(self) -> None:
        body = await _screen({"avatar": COIN}, held=set())
        self.assertEqual(body["avatar"], COIN)

    async def test_a_write_with_nothing_gated_asks_the_database_nothing(self) -> None:
        """The screen runs on every PATCH — language, progress, mentoring — so
        it must not cost a read on writes with no cosmetics in them."""
        held = AsyncMock(return_value=set())
        with patch.object(route.unlock_sync, "held_cosmetics", held):
            await route._screen_equipped(LEARNER, {"language": "ar"})
            await route._screen_equipped(LEARNER, {"yuvi_design": _design(headTop="snapback")})
        held.assert_not_awaited()

    async def test_an_unreadable_unlock_list_undresses_rather_than_trusts(self) -> None:
        with patch.object(route.unlock_sync, "held_cosmetics", AsyncMock(side_effect=RuntimeError)):
            body = {"yuvi_design": _design(headTop="ironhelmet")}
            await route._screen_equipped(LEARNER, body)
        self.assertIsNone(body["yuvi_design"]["equipped"]["headTop"])


if __name__ == "__main__":
    unittest.main()
