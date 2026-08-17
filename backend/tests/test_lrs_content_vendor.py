"""`grouping→content-vendor` — the content SUPPLIER's ministry id.

The 28/07 integration report rejected the value we sent (`ECAT-720-contract`)
as "not an id from the catalog". The MoE clarified on 03/08 what it actually
wants:

    "אנחנו נברר מה מספר ספק התוכן (content-vendor) שאתם צריכים לכתוב שם, לכל
     תחום דעת ולכל שכבת גיל יהיה משהו אחר (כרגע יש את מט"ח ומתודיקה), בינתיים
     כיתבו methodica עבור מתודיקה ו-10 עבור מטח… לא אמורה להעשות שום עבודה
     ידנית, אתם אמורים להתחבר לקטלוג ולשלוף ממנו את המידע המתאים"

Two requirements, both tested here: the id identifies the SUPPLIER (not the
content item), and it is derived from the catalog rather than from a list
someone maintains by hand. Kata publishes the supplier per component as
`manufacture` ("מתודיקה", "מטח - תוכן"), so that is the key.

Integration round 3 (17/08) pinned the actual catalog ids — מטח 10, קמפוס 521,
מתודיקה 310 — sent under the base the ministry's own examples page uses:
`…/xapi/moe/content-vendor/<id>`.
"""

from __future__ import annotations

import json
import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services.lrs import config, context  # noqa: E402


class SupplierIdTests(unittest.TestCase):
    def test_the_ministrys_catalog_ids_are_the_default(self):
        """The ids from the catalog update (17/08): מטח 10 · קמפוס 521 · מתודיקה 310."""
        with mock.patch.dict(os.environ, {"LRS_CONTENT_VENDORS": ""}, clear=False):
            self.assertEqual(config.content_vendor_id("מתודיקה"), "310")
            self.assertEqual(config.content_vendor_id("מטח - תוכן"), "10")
            self.assertEqual(config.content_vendor_id("קמפוס"), "521")

    def test_the_catalogs_own_suffix_still_matches_the_vendor(self):
        """CET publishes "מטח - תוכן", not "מטח" — matching has to survive that."""
        for spelling in ("מטח", "מטח - תוכן", " מטח - תוכן "):
            self.assertEqual(config.content_vendor_id(spelling), "10", spelling)

    def test_an_unknown_supplier_yields_nothing_rather_than_a_guess(self):
        self.assertEqual(config.content_vendor_id("ספק חדש"), "")
        self.assertEqual(config.content_vendor_id(None), "")
        self.assertEqual(config.content_vendor_id(""), "")

    def test_a_per_subject_and_grade_id_wins_over_the_general_one(self):
        """"לכל תחום דעת ולכל שכבת גיל יהיה משהו אחר" — when the ministry issues
        those numbers they arrive as configuration, not as a code change."""
        mapping = {"מטח": "10", "מטח|math": "11", "מטח|math|7": "12"}
        with mock.patch.dict(os.environ, {"LRS_CONTENT_VENDORS": json.dumps(mapping)}):
            self.assertEqual(config.content_vendor_id("מטח - תוכן", subject="math", grade="7"), "12")
            self.assertEqual(config.content_vendor_id("מטח - תוכן", subject="math", grade="8"), "11")
            self.assertEqual(config.content_vendor_id("מטח - תוכן", subject="science"), "10")

    def test_the_specific_key_wins_whatever_order_the_json_lists_them_in(self):
        mapping = {"מטח|math|7": "12", "מטח": "10"}
        reversed_mapping = {"מטח": "10", "מטח|math|7": "12"}
        for candidate in (mapping, reversed_mapping):
            with mock.patch.dict(os.environ, {"LRS_CONTENT_VENDORS": json.dumps(candidate)}):
                self.assertEqual(
                    config.content_vendor_id("מטח", subject="math", grade="7"), "12"
                )

    def test_broken_json_falls_back_rather_than_dropping_the_grouping(self):
        with mock.patch.dict(os.environ, {"LRS_CONTENT_VENDORS": "{not json"}):
            self.assertEqual(config.content_vendor_id("מתודיקה"), "310")

    def test_an_explicit_empty_map_is_honoured(self):
        """An operator who writes `{}` means it — that is how the identity gate
        can still refuse to report when nothing is configured."""
        with mock.patch.dict(os.environ, {"LRS_CONTENT_VENDORS": "{}"}):
            self.assertEqual(config.content_vendor_id("מתודיקה"), "")


class GroupingTests(unittest.TestCase):
    def test_the_vendor_iri_matches_the_ministry_examples_page_exactly(self):
        """The examples page (720_xAPI_JSON_Examples, 16/08) shows
        `https://lxp.education.gov.il/xapi/moe/content-vendor/10` for מטח — the
        wire value must be byte-identical to that shape."""
        self.assertEqual(
            f"{context.CONTENT_VENDOR_BASE}/10",
            "https://lxp.education.gov.il/xapi/moe/content-vendor/10",
        )
        self.assertEqual(
            f"{context.CONTENT_VENDOR_BASE}/{config.content_vendor_id('קמפוס')}",
            "https://lxp.education.gov.il/xapi/moe/content-vendor/521",
        )
        self.assertEqual(
            f"{context.CONTENT_VENDOR_BASE}/{config.content_vendor_id('מתודיקה')}",
            "https://lxp.education.gov.il/xapi/moe/content-vendor/310",
        )

    def test_a_supplier_iri_is_sent_as_it_is(self):
        """An xAPI activity id must be an IRI, so the bare "10" is namespaced by
        `hierarchy` — and must not then be namespaced a second time here."""
        vendor = f"{context.CONTENT_VENDOR_BASE}/10"
        grouping = context.build_grouping("sess-1", ecat_item_id=vendor)
        entry = next(
            g for g in grouping
            if (g.get("definition") or {}).get("type", "").endswith("/content-vendor")
        )
        self.assertEqual(entry["id"], vendor)

    def test_a_bare_catalog_item_id_is_still_namespaced(self):
        grouping = context.build_grouping("sess-1", ecat_item_id="12345")
        entry = next(
            g for g in grouping
            if (g.get("definition") or {}).get("type", "").endswith("/content-vendor")
        )
        self.assertEqual(entry["id"], f"{context.ECAT_ITEM_BASE}/12345")

    def test_content_vendor_is_absent_when_nothing_resolves(self):
        """A platform-only event (a session, a dashboard) has no supplier, and an
        empty grouping entry would be worse than none."""
        grouping = context.build_grouping("sess-1", ecat_item_id=None)
        types = {(g.get("definition") or {}).get("type", "").split("/")[-1] for g in grouping}
        self.assertNotIn("content-vendor", types)
        self.assertEqual(types, {"lms", "session", "program"})


if __name__ == "__main__":
    unittest.main()
