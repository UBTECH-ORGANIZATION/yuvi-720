"""Work done in one component must not be booked against another.

Measured 29/07: three seconds after `completed` on `…-01-03`, Kata's content
emitted `initialized` for `…-01-04` — still inside the launch minted for `-03`,
while the platform's completion dialog was waiting for the learner to choose a
next step. Clicking on inside the iframe then ran the whole of `-04` (the
weighing simulation) under a `-03` launch.

720 F1 gives the PLATFORM the route between components. The statement is kept —
it is real evidence of what the learner did, and the defect report to Kata needs
it — but folding it would credit `-04`'s work to `-03` and accrue mastery to the
wrong component.
"""

from __future__ import annotations

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services import events  # noqa: E402


UNIT = "methodica-science-mass-measure-01"
BASE = "https://lomdot.education.gov.il/metodica/720active/science/mass-measure/01"


def _event(object_id: str, launch: str = f"{UNIT}-03") -> dict:
    return {"launch": launch, "unit_id": UNIT, "object_id": object_id}


class ForeignComponentTests(unittest.TestCase):
    def test_the_launched_component_itself_is_not_foreign(self):
        self.assertFalse(events._names_a_foreign_component(_event(f"{BASE}/{UNIT}-03")))

    def test_an_item_of_the_launched_component_is_not_foreign(self):
        self.assertFalse(events._names_a_foreign_component(_event(f"{BASE}/{UNIT}-03-001")))

    def test_a_question_under_that_item_is_not_foreign(self):
        self.assertFalse(events._names_a_foreign_component(_event(f"{BASE}/{UNIT}-03-001/q1")))

    def test_the_sibling_component_it_walked_into_is_foreign(self):
        """The exact statement captured at 12:15:53."""
        self.assertTrue(events._names_a_foreign_component(_event(f"{BASE}/{UNIT}-04")))

    def test_an_item_of_that_sibling_is_foreign(self):
        self.assertTrue(events._names_a_foreign_component(_event(f"{BASE}/{UNIT}-04-001")))

    def test_an_unreadable_object_id_is_left_alone(self):
        """Better to fold a strange id than to silently drop real evidence."""
        self.assertFalse(events._names_a_foreign_component(_event("urn:something:else")))

    def test_a_missing_launch_never_trips_the_guard(self):
        self.assertFalse(events._names_a_foreign_component(
            {"launch": None, "unit_id": UNIT, "object_id": f"{BASE}/{UNIT}-04"}
        ))

    def test_a_missing_unit_never_trips_the_guard(self):
        self.assertFalse(events._names_a_foreign_component(
            {"launch": f"{UNIT}-03", "unit_id": None, "object_id": f"{BASE}/{UNIT}-04"}
        ))


if __name__ == "__main__":
    unittest.main()
