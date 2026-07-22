"""Tests for the curated (no-model) lesson illustration library."""

from __future__ import annotations

import unittest
from xml.etree import ElementTree as ET

from app.services import lesson_illustrations as illustrations


class LibraryStructureTests(unittest.TestCase):
    def test_library_has_ten_topics_plus_default(self) -> None:
        keys = {asset["key"] for asset in illustrations.LIBRARY.values()}
        self.assertIn("default", keys)
        self.assertGreaterEqual(len(keys - {"default"}), 10)

    def test_every_asset_is_well_formed_animated_svg_with_static_variant(self) -> None:
        for asset_id, asset in illustrations.LIBRARY.items():
            with self.subTest(asset_id=asset_id):
                # Parses as XML and is a real <svg> on the 960x540 canvas.
                root = ET.fromstring(asset["svg"])
                self.assertTrue(root.tag.endswith("svg"))
                self.assertEqual(root.attrib.get("viewBox"), "0 0 960 540")
                # Animated variant carries motion; static variant strips it.
                self.assertIn("<animate", asset["svg"])
                self.assertNotIn("<animate", asset["static_svg"])
                # Static variant is still valid XML.
                ET.fromstring(asset["static_svg"])
                # No text/script/foreign content in either variant.
                for markup in (asset["svg"], asset["static_svg"]):
                    self.assertNotIn("<script", markup)
                    self.assertNotIn("<text", markup)
                    self.assertNotIn("foreignObject", markup)

    def test_static_stripping_is_idempotent(self) -> None:
        for asset in illustrations.LIBRARY.values():
            self.assertEqual(
                illustrations._to_static(asset["static_svg"]),
                asset["static_svg"],
            )


class ResolverTests(unittest.IsolatedAsyncioTestCase):
    async def test_maps_known_objectives_to_specific_diagrams(self) -> None:
        cases = {
            ("math-angles-vertical", "YuviDori-math-vertical-0002-practice"): "lib-angles-vertical",
            ("math-angles-triangle", None): "lib-triangle-angles",
            ("math-angles", None): "lib-angles-types",
            ("math-fractions-percent", None): "lib-percent",
            ("math-fractions-intro", None): "lib-fractions",
            ("sci-matter-states", None): "lib-matter-states",
            ("sci-circuit-basic", None): "lib-circuit",
        }
        for (objective_id, component_id), expected in cases.items():
            with self.subTest(objective_id=objective_id):
                asset = await illustrations.find_for_lesson(objective_id, component_id)
                self.assertEqual(asset["_id"], expected)

    async def test_unknown_lesson_falls_back_to_default(self) -> None:
        asset = await illustrations.find_for_lesson("history-ancient-rome", None)
        self.assertEqual(asset["_id"], "lib-default")

    async def test_find_for_lesson_is_never_none(self) -> None:
        asset = await illustrations.find_for_lesson(None, None)
        self.assertEqual(asset["_id"], "lib-default")


class MetadataTests(unittest.IsolatedAsyncioTestCase):
    async def test_public_metadata_is_localized_and_not_ai(self) -> None:
        asset = await illustrations.find_for_lesson("math-angles-vertical", None)
        meta = illustrations.public_metadata(asset, "he")
        self.assertFalse(meta["aiGenerated"])
        self.assertEqual(meta["url"], "/api/learning/illustrations/lib-angles-vertical.svg")
        self.assertIn("motion=reduce", meta["staticUrl"])
        self.assertTrue(meta["tip"])
        self.assertEqual(meta["width"], 960)
        self.assertEqual(meta["height"], 540)

    async def test_get_asset_roundtrip_and_unknown(self) -> None:
        self.assertIsNotNone(await illustrations.get_asset("lib-circuit"))
        self.assertIsNone(await illustrations.get_asset("lib-does-not-exist"))


if __name__ == "__main__":
    unittest.main()
