"""Kata player-screen ids are offset from catalog sub-content ids by a leading
cover screen (player `-002` == catalog `-001`). `resolve_catalog_item_id` maps
them back so the coach grounds hints on the item the learner is actually on,
not the next one. Self-anchored: a unique question id pins the exact item, else
the earliest visited player screen aligns to the earliest catalog item."""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services import kata_catalog  # noqa: E402

C = "methodica-science-mass-measure-01-02"


def _rows(*qids):
    return [{"questionId": q, "questionText": f"text-{q}"} for q in qids]


# Catalog: -001 has q1+q2 (unique q2), -002 and -003 are q1-only. The player
# reports these as screens -002/-003/-004 (a +1 cover offset).
_COMPONENT = {
    "id": C,
    "questions_by_item": {
        f"{C}-001": _rows("q1", "q2"),
        f"{C}-002": _rows("q1"),
        f"{C}-003": _rows("q1"),
    },
}


class ReconcileItemIdTests(unittest.TestCase):
    def setUp(self):
        self._prev = kata_catalog._SNAPSHOT.get("components")
        kata_catalog._SNAPSHOT["components"] = {C: _COMPONENT}

    def tearDown(self):
        kata_catalog._SNAPSHOT["components"] = self._prev

    def R(self, runtime, q=None, seen=None):
        return kata_catalog.resolve_catalog_item_id(
            C, f"{C}-{runtime}", question_id=q,
            seen_item_ids=[f"{C}-{s}" for s in (seen or [])],
        )

    def test_unique_question_pins_exact_item(self):
        # q2 exists only on -001, so player screen -002/q2 -> catalog -001.
        self.assertEqual(self.R("002", "q2"), f"{C}-001")

    def test_ambiguous_q1_uses_ordinal_offset(self):
        # q1 is on every item; the earliest visited player screen (-002) anchors
        # the offset so -002/q1 -> -001 and a later -003/q1 -> -002.
        self.assertEqual(self.R("002", "q1"), f"{C}-001")
        self.assertEqual(self.R("003", "q1", seen=["002"]), f"{C}-002")
        self.assertEqual(self.R("004", "q1", seen=["002", "003"]), f"{C}-003")

    def test_navigation_without_question_uses_ordinal(self):
        self.assertEqual(self.R("002", None), f"{C}-001")
        self.assertEqual(self.R("003", None, seen=["002"]), f"{C}-002")

    def test_zero_offset_component_is_identity(self):
        # A component whose player numbers screens from -001 (no cover) must not
        # be shifted: min visited == min catalog -> offset 0.
        self.assertEqual(self.R("001", "q1"), f"{C}-001")

    def test_unknown_component_returns_runtime_id(self):
        raw = f"other-comp-002"
        self.assertEqual(
            kata_catalog.resolve_catalog_item_id("other-comp", raw, question_id="q1"),
            raw,
        )

    def test_missing_inputs_are_passthrough(self):
        self.assertIsNone(kata_catalog.resolve_catalog_item_id(C, None))
        self.assertEqual(kata_catalog.resolve_catalog_item_id(None, f"{C}-002"), f"{C}-002")


if __name__ == "__main__":
    unittest.main()
