"""The content-intelligence contract: fingerprints, schema, the answers ban.

These pin the properties the nightly pipeline and the coach BOTH depend on:
the fingerprint functions are deterministic and react only to authored
content; the serializer produces stable bytes (a no-change run must be a
no-change commit); and no committed shard can ever carry a correct answer —
the config lives in a world-readable repo.
"""

from __future__ import annotations

import json
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services import content_intelligence as ci  # noqa: E402


def _text_block(fingerprint: str) -> dict:
    return {
        "he": "בואו נתחיל ללמוד על מדידת מסה",
        "prompt_version": ci.PROMPT_VERSION,
        "source_fingerprint": fingerprint,
        "generated_at": "2026-08-31T01:00:00Z",
        "model": "mini",
    }


def _shard() -> dict:
    q_print = ci.compute_fingerprint_question("מהי מסה?", "פתיחה", [], "מסך פתיחה")
    i_print = ci.compute_fingerprint_item("פתיחה", "presentation", "video",
                                          "מסך פתיחה", ["מהי מסה?"])
    c_print = ci.compute_fingerprint_component("מדידות", "מדידת מסה", [i_print])
    return {
        "schema_version": ci.SCHEMA_VERSION,
        "subject": "MOE.SCI",
        "objective_id": "MOE.SCI.X",
        "lomdot": [{
            "component_id": "comp-1",
            "title": "מדידת מסה",
            "component_fingerprint": c_print,
            "texts": {"lesson_welcome": _text_block(c_print)},
            "slides": [{
                "item_id": "comp-1-001",
                "title": "פתיחה",
                "content_type": "presentation",
                "media_format": "video",
                "fingerprint": i_print,
                "texts": {"video_summary": _text_block(i_print)},
                "questions": [{
                    "question_id": "q1",
                    "question_text": "מהי מסה?",
                    "fingerprint": q_print,
                    "texts": {"question_intro": _text_block(q_print)},
                }],
            }],
        }],
    }


class TheFingerprintsReactOnlyToAuthoredContent(unittest.TestCase):
    def test_identical_input_gives_identical_prints(self):
        a = ci.compute_fingerprint_question("טקסט", "מסך", ["אח"], "מידע")
        b = ci.compute_fingerprint_question("טקסט", "מסך", ["אח"], "מידע")
        self.assertEqual(a, b)
        self.assertEqual(len(a), 16)

    def test_sibling_order_does_not_matter(self):
        a = ci.compute_fingerprint_question("טקסט", "מסך", ["א", "ב"], "")
        b = ci.compute_fingerprint_question("טקסט", "מסך", ["ב", "א"], "")
        self.assertEqual(a, b)

    def test_a_text_edit_is_news(self):
        a = ci.compute_fingerprint_question("טקסט", "מסך", [], "")
        b = ci.compute_fingerprint_question("טקסט אחר", "מסך", [], "")
        self.assertNotEqual(a, b)

    def test_item_print_reacts_to_question_edits(self):
        a = ci.compute_fingerprint_item("t", "quiz", "", "info", ["ש1"])
        b = ci.compute_fingerprint_item("t", "quiz", "", "info", ["ש1 ערוכה"])
        self.assertNotEqual(a, b)

    def test_component_print_reacts_to_slide_order(self):
        a = ci.compute_fingerprint_component("יעד", "לומדה", ["aa", "bb"])
        b = ci.compute_fingerprint_component("יעד", "לומדה", ["bb", "aa"])
        self.assertNotEqual(a, b)  # slide ORDER is authored content


class TheSchemaHoldsItsShape(unittest.TestCase):
    def test_a_complete_shard_validates_clean(self):
        self.assertEqual(ci.validate_shard(_shard()), [])

    def test_wrong_schema_version_is_flagged(self):
        shard = _shard()
        shard["schema_version"] = 99
        self.assertTrue(any("schema_version" in p for p in ci.validate_shard(shard)))

    def test_a_text_without_hebrew_body_is_flagged(self):
        shard = _shard()
        shard["lomdot"][0]["texts"]["lesson_welcome"]["he"] = ""
        self.assertTrue(any("lesson_welcome" in p for p in ci.validate_shard(shard)))

    def test_an_unknown_text_kind_is_flagged(self):
        shard = _shard()
        block = shard["lomdot"][0]["texts"].pop("lesson_welcome")
        shard["lomdot"][0]["texts"]["surprise_kind"] = block
        self.assertTrue(any("surprise_kind" in p for p in ci.validate_shard(shard)))


class TheSerializerIsStableAndGuarded(unittest.TestCase):
    def test_same_shard_serializes_to_identical_bytes(self):
        self.assertEqual(ci.dump_shard(_shard()), ci.dump_shard(_shard()))

    def test_lomdot_are_sorted_so_input_order_cannot_leak(self):
        shard = _shard()
        second = json.loads(json.dumps(shard["lomdot"][0], ensure_ascii=False))
        second["component_id"] = "aaa-first"
        shard["lomdot"].append(second)
        dumped = json.loads(ci.dump_shard(shard))
        self.assertEqual(
            [l["component_id"] for l in dumped["lomdot"]], ["aaa-first", "comp-1"])

    def test_correct_answers_cannot_be_serialized_at_any_depth(self):
        for key in ("correctAnswers", "correct_answers", "correct"):
            shard = _shard()
            shard["lomdot"][0]["slides"][0]["questions"][0][key] = ["42"]
            with self.assertRaises(ValueError):
                ci.dump_shard(shard)

    def test_the_finder_reports_where_the_smuggle_is(self):
        shard = _shard()
        shard["lomdot"][0]["slides"][0]["enrichment"] = {"correct": ["x"]}
        self.assertIn("enrichment", ci.find_forbidden_key(shard) or "")


class TheDiffSeesWhatChangedOvernight(unittest.TestCase):
    def test_new_changed_removed_are_separated(self):
        catalog = {"a": "1", "b": "2", "c": "3"}
        config = {"b": "2", "c": "old", "d": "gone"}
        diff = ci.diff_components(catalog, config)
        self.assertEqual(diff["new"], ["a"])
        self.assertEqual(diff["changed"], ["c"])
        self.assertEqual(diff["removed"], ["d"])

    def test_identical_sides_mean_a_quiet_night(self):
        both = {"a": "1", "b": "2"}
        diff = ci.diff_components(both, dict(both))
        self.assertEqual(diff, {"new": [], "changed": [], "removed": []})


if __name__ == "__main__":
    unittest.main()
