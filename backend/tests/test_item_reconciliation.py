"""`resolve_catalog_item_id` decides WHICH catalog screen an event is about.

Order of evidence, strongest first:
  1. a question id owned by exactly one catalog item pins that item;
  2. an id the catalog recognizes is taken at face value;
  3. only for an id the catalog does NOT know, align by ordinal — the earliest
     visited player screen maps to the earliest catalog item (a leading cover of
     at most `_MAX_COVER_OFFSET` frames).

Rule 2 is the one measured into place. The ordinal anchor used to run for every
event, and it fired on any SESSION that happened to start on `-002`: min seen 2,
min catalog 1 → offset 1 → four events of a real 28/07 session were stored one
screen back. That is what put Yuvi's reply on the previous question's thread and
left two threads captioned "שאלה 3". In that same session every id the player
sent (`-001`…`-005`) existed in the catalog — there was nothing to reconcile."""

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
        # q2 exists only on -001, so an event carrying q2 is about -001 even
        # though the id it came with (-002) is a real screen of its own.
        self.assertEqual(self.R("002", "q2"), f"{C}-001")

    def test_a_known_screen_id_is_believed(self):
        """The regression: a session that starts on -002 is on -002.

        q1 exists on every screen, so it pins nothing; the ordinal anchor used to
        step in here and rewind the learner one screen for the whole session.
        """
        self.assertEqual(self.R("002", "q1"), f"{C}-002")
        self.assertEqual(self.R("003", "q1", seen=["002"]), f"{C}-003")
        self.assertEqual(self.R("002", None), f"{C}-002")

    def test_an_unknown_screen_id_is_still_aligned(self):
        """-004 is not a screen of this component, so the anchor may reconcile it."""
        self.assertEqual(self.R("004", "q1", seen=["002", "003"]), f"{C}-003")

    def test_zero_offset_component_is_identity(self):
        self.assertEqual(self.R("001", "q1"), f"{C}-001")

    def test_unknown_component_returns_runtime_id(self):
        raw = f"other-comp-002"
        self.assertEqual(
            kata_catalog.resolve_catalog_item_id("other-comp", raw, question_id="q1"),
            raw,
        )

    def test_landing_deep_in_the_component_is_not_rewound(self):
        """Resuming (or jumping) mid-component is not a five-screen cover.

        Observed: arriving at the teaching screen `…-01-04-006` — the learner's
        first event of that launch — anchored an offset of 5 and stored `…-001`,
        so the coach and the chat both placed the learner five screens back.
        """
        self.assertEqual(self.R("006"), f"{C}-006")
        self.assertEqual(self.R("004", seen=["004"]), f"{C}-004")

    def test_missing_inputs_are_passthrough(self):
        self.assertIsNone(kata_catalog.resolve_catalog_item_id(C, None))
        self.assertEqual(kata_catalog.resolve_catalog_item_id(None, f"{C}-002"), f"{C}-002")


# ── CET-shaped components: the object id IS the catalog item id ──────────────
CET = "CET.MATH.G7.NUM.COORD-SYS-A.POS-NUM.WRITE-00001"
_META = "https://learning.cet.ac.il/metadata/6a5cd81c15692669432e4e5d"

_CET_COMPONENT = {
    "id": CET,
    "items": [
        {"id": f"{_META}/mriro31m3ib50cl4i", "title": "חפש את המטמון"},
        {"id": f"{_META}/mriwy5ub14z7d79e2", "title": "לוח השחמט"},
        # Some rows carry a composite id whose TAIL is still the screen id.
        {"id": f"{CET}-item-{_META}/mrj2jntc3fjzenkxg", "title": "נקודה"},
    ],
    "questions_by_item": {
        f"{_META}/mriwy5ub14z7d79e2": [{"questionId": "mrix0rcacunhro62"}],
    },
}


class ResolveObjectItemTests(unittest.TestCase):
    """CET screens (measured 2026-08-23) send their catalog ``subContent`` id
    verbatim — a full metadata URL the ``{component}-NNN`` parser never sees.
    Without this match every CET event stored ``sub_item_id: null`` and the
    coach never learned which screen the learner was on."""

    def setUp(self):
        self._prev = kata_catalog._SNAPSHOT.get("components")
        kata_catalog._SNAPSHOT["components"] = {CET: _CET_COMPONENT}

    def tearDown(self):
        kata_catalog._SNAPSHOT["components"] = self._prev

    def test_the_exact_catalog_url_is_the_item(self):
        self.assertEqual(
            kata_catalog.resolve_object_item(CET, f"{_META}/mriwy5ub14z7d79e2"),
            (f"{_META}/mriwy5ub14z7d79e2", None),
        )

    def test_a_composite_catalog_id_is_matched_by_tail(self):
        self.assertEqual(
            kata_catalog.resolve_object_item(CET, f"{_META}/mrj2jntc3fjzenkxg"),
            (f"{CET}-item-{_META}/mrj2jntc3fjzenkxg", None),
        )

    def test_a_question_object_resolves_to_its_owning_item(self):
        self.assertEqual(
            kata_catalog.resolve_object_item(CET, f"{_META}/mrix0rcacunhro62"),
            (f"{_META}/mriwy5ub14z7d79e2", "mrix0rcacunhro62"),
        )

    def test_the_component_level_object_is_not_an_item(self):
        self.assertEqual(
            kata_catalog.resolve_object_item(
                CET, f"https://learning.cet.ac.il/metadata/{CET}"),
            (None, None),
        )

    def test_a_foreign_object_matches_nothing(self):
        self.assertEqual(
            kata_catalog.resolve_object_item(CET, f"{_META}/zznotascreen"),
            (None, None),
        )
        self.assertEqual(kata_catalog.resolve_object_item(None, "x"), (None, None))
        self.assertEqual(kata_catalog.resolve_object_item(CET, None), (None, None))


if __name__ == "__main__":
    unittest.main()
