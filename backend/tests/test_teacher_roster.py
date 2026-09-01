"""The roster endpoint: every class this teacher teaches, and not one more.

This route exists because a name must not depend on the class picker — see
`services/teacher_roster`. It is also the only teacher-facing endpoint that
returns `display_name` for a whole cohort in one read, so the property worth
asserting is the boundary: the union is over *this teacher's* groups, and a
learner in someone else's class is not in it.

The PII direction matters too, and it is the opposite of the tool layer's: this
serves the browser, so names are the point. `test_teacher_tools_auth` asserts the
other half — that the model never sees them.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services import teacher_roster

MINE_A = "kid-a"
MINE_B = "kid-b"
THEIRS = "kid-theirs"

GROUPS = {
    "teacher-a": [{"_id": "group-1", "name": "ז1"}, {"_id": "group-2", "name": "ז2"}],
    "teacher-b": [{"_id": "group-9", "name": "ח1"}],
}
MEMBERS = {
    "group-1": [MINE_A],
    "group-2": [MINE_B, MINE_A],   # co-enrolled on purpose
    "group-9": [THEIRS],
}
NAMES = {MINE_A: "Tal", MINE_B: None, THEIRS: "Someone Else"}


def _patches():
    return (
        patch("app.brain.org.groups_for_teacher",
              AsyncMock(side_effect=lambda teacher_id: GROUPS.get(teacher_id, []))),
        patch("app.brain.org.learners_in_group",
              AsyncMock(side_effect=lambda group_id: MEMBERS.get(group_id, []))),
        patch.object(teacher_roster, "names_for",
                     AsyncMock(side_effect=lambda ids: {i: NAMES.get(i) for i in ids})),
    )


class RosterTests(unittest.IsolatedAsyncioTestCase):
    async def _roster(self, teacher_id: str) -> dict:
        group_patch, member_patch, name_patch = _patches()
        with group_patch, member_patch, name_patch:
            return await teacher_roster.roster_for_teacher(teacher_id)

    async def test_it_spans_every_group_the_teacher_teaches(self):
        """The whole point: one map, not one per class."""
        roster = await self._roster("teacher-a")
        self.assertEqual(
            {row["learner_id"] for row in roster["students"]}, {MINE_A, MINE_B}
        )

    async def test_another_teachers_learner_is_absent(self):
        roster = await self._roster("teacher-a")
        ids = {row["learner_id"] for row in roster["students"]}
        self.assertNotIn(THEIRS, ids)

    async def test_a_co_enrolled_learner_appears_once(self):
        """A duplicate row would make the roster length a lie about class size."""
        roster = await self._roster("teacher-a")
        ids = [row["learner_id"] for row in roster["students"]]
        self.assertEqual(len(ids), len(set(ids)))

    async def test_a_learner_with_no_name_is_null_not_the_id(self):
        """The client decides how to render an unnamed child; the API does not
        pre-empt it by echoing the id into the name field."""
        roster = await self._roster("teacher-a")
        row = next(r for r in roster["students"] if r["learner_id"] == MINE_B)
        self.assertIsNone(row["display_name"])

    async def test_every_row_says_which_class_it_came_from(self):
        roster = await self._roster("teacher-a")
        for row in roster["students"]:
            self.assertIn(row["group_id"], {"group-1", "group-2"})

    async def test_a_teacher_with_no_groups_gets_an_empty_roster(self):
        roster = await self._roster("teacher-nobody")
        self.assertEqual(roster["students"], [])
        self.assertEqual(roster["groups"], [])


class TheAvatarOnEveryRow(unittest.IsolatedAsyncioTestCase):
    """A chosen coin wins; an earned coin fills in; a letter is a real answer.

    The roster is where a learner's picture reaches every teacher screen at
    once, so this is where the precedence has to hold.
    """

    COIN = {"kind": "badge", "badge": {"subject": "science", "glyph": "flask",
                                       "tier": "gold"}}
    DERIVED = {"kind": "badge", "badge": {"subject": "math", "glyph": "math",
                                          "tier": "silver"}}

    async def _roster(self, *, chosen, decided, derived):
        group_patch, member_patch, name_patch = _patches()
        with group_patch, member_patch, name_patch, \
             patch.object(teacher_roster, "_avatars_for",
                          AsyncMock(return_value=(chosen, decided))), \
             patch.object(teacher_roster, "_earned_avatars_for",
                          AsyncMock(return_value=derived)) as earned:
            roster = await teacher_roster.roster_for_teacher("teacher-a")
        return roster, earned

    def _row(self, roster, learner_id):
        return next(r for r in roster["students"] if r["learner_id"] == learner_id)

    async def test_a_chosen_coin_is_what_shows(self):
        roster, earned = await self._roster(
            chosen={MINE_A: self.COIN}, decided={MINE_A}, derived={})
        self.assertEqual(self._row(roster, MINE_A)["avatar"], self.COIN)
        # And nothing was derived for them — a default must not overrule a choice.
        self.assertNotIn(MINE_A, earned.await_args.args[0])

    async def test_a_learner_who_chose_nothing_gets_their_best_earned_coin(self):
        roster, _ = await self._roster(
            chosen={}, decided=set(), derived={MINE_B: self.DERIVED})
        self.assertEqual(self._row(roster, MINE_B)["avatar"], self.DERIVED)

    async def test_choosing_the_plain_letter_is_a_choice_and_survives(self):
        # `{"kind": "initial"}` draws no coin but IS a decision — the learner
        # pressed "back to my letter". Deriving over it would make that button
        # appear to do nothing.
        roster, earned = await self._roster(
            chosen={}, decided={MINE_A}, derived={MINE_B: self.DERIVED})
        self.assertIsNone(self._row(roster, MINE_A)["avatar"])
        self.assertNotIn(MINE_A, earned.await_args.args[0])

    async def test_a_learner_with_nothing_earned_keeps_their_letter(self):
        roster, _ = await self._roster(chosen={}, decided=set(), derived={})
        self.assertIsNone(self._row(roster, MINE_A)["avatar"])


if __name__ == "__main__":
    unittest.main()
