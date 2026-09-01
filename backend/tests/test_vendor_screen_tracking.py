"""Navigation must move the position pointer, not only answers.

Measured 2026-09-01 on `COMPL-00001`: CET narrates every page change (and
every resume) with an `initialized` whose object is
``…/metadata/{activity}/{pageId}`` — an opaque id that exists nowhere in the
DOM or the catalog. The ingest stored ``sub_item_id: null`` for all of them,
so a learner three pages in still had the coach grounded (confidently — the
position read as REPORTED) on the page of their last answer.

Two mechanisms fix it: the nightly walk overhears the player's own xAPI and
records each page's id on its slide (``vendor_page_id``, capture v7), which
`resolve_object_item` consults; and a page-enter we can NOT map still clears
the pointer — the learner has provably left the old screen, and unknown
(assumed + hedged) beats confidently wrong.
"""

from __future__ import annotations

import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services import content_intelligence, events, kata_catalog  # noqa: E402


COMPONENT = "CET.MATH.G7.NUM.COORD-SYS-A.POS-NUM.COMPL-00001"
PAGE_OBJECT = "https://learning.cet.ac.il/metadata/6a6078100dc15822c43655a2/msvi90dt1kxpui6fl"
COMPONENT_OBJECT = f"https://learning.cet.ac.il/metadata/{COMPONENT}"


class ResolveObjectItemUsesTheVendorMap(unittest.TestCase):
    def test_a_walked_page_id_names_its_catalog_item(self):
        component = {"id": COMPONENT, "items": [], "questions_by_item": {
            f"{COMPONENT}-item-00003": [{"questionId": "q-x"}]}}
        with mock.patch.object(kata_catalog, "get_component", return_value=component), \
             mock.patch.object(content_intelligence, "vendor_screen_item",
                               return_value=f"{COMPONENT}-item-00003"):
            item, question = kata_catalog.resolve_object_item(COMPONENT, PAGE_OBJECT)
        self.assertEqual(item, f"{COMPONENT}-item-00003")
        self.assertIsNone(question)

    def test_an_unlearned_page_id_stays_unmapped(self):
        component = {"id": COMPONENT, "items": [], "questions_by_item": {}}
        with mock.patch.object(kata_catalog, "get_component", return_value=component), \
             mock.patch.object(content_intelligence, "vendor_screen_item",
                               return_value=None):
            item, _ = kata_catalog.resolve_object_item(COMPONENT, PAGE_OBJECT)
        self.assertIsNone(item)


class UnmappedScreenEntries(unittest.TestCase):
    def _event(self, verb="enter", object_id=PAGE_OBJECT, sub_item=None):
        return {"verb": verb, "object_id": object_id, "sub_item_id": sub_item,
                "launch": COMPONENT}

    def test_a_page_enter_we_cannot_name_is_a_screen_move(self):
        self.assertTrue(events._is_unmapped_screen_entry(self._event()))
        self.assertTrue(events._is_unmapped_screen_entry(
            self._event(verb="initialized")))

    def test_a_component_open_is_not_a_page_move(self):
        self.assertFalse(events._is_unmapped_screen_entry(
            self._event(object_id=COMPONENT_OBJECT)))

    def test_a_mapped_screen_is_handled_by_the_pointer_branch(self):
        self.assertFalse(events._is_unmapped_screen_entry(
            self._event(sub_item=f"{COMPONENT}-item-00003")))

    def test_only_navigation_verbs_qualify(self):
        self.assertFalse(events._is_unmapped_screen_entry(
            self._event(verb="completed")))
        self.assertFalse(events._is_unmapped_screen_entry(
            self._event(verb="answered")))


if __name__ == "__main__":
    unittest.main()
