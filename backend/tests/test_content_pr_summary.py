"""The nightly PR body says what changed, per file, with a reason a reader can
check — from the structured diff, never from the raw JSON."""

from __future__ import annotations

import os
import sys
import unittest
from unittest.mock import AsyncMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))

import content_pr_summary as prs  # noqa: E402


def _lomda(cid: str, title: str, *, updated="2026-08-31T09:00:00Z", fp="aaaa", text_at="2026-08-31T11:00:00Z",
           slides=None, verdict="extracted", mapped=2, seen=2):
    return {
        "component_id": cid, "title": title, "kata_updated_at": updated, "component_fingerprint": fp,
        "extraction": {"verdict": verdict, "screens_mapped": mapped, "screens_seen": seen},
        "texts": {"lesson_welcome": {"he": "…", "generated_at": text_at, "prompt_version": "cp-v2"}},
        "slides": slides if slides is not None else [
            {"item_id": "s1", "texts": {}, "questions": [{"question_id": "q1", "texts": {}}],
             "enrichment": {"media": [{"src": "a.png"}]}},
        ],
    }


def _shard(lomdot):
    return {"schema_version": 3, "subject": "math", "objective_id": "MOE.MATH.X", "objective_title_he": "יחס", "lomdot": lomdot}


class StructuralDiffTest(unittest.TestCase):
    def test_added_removed_and_changed_lomdot_are_named_with_reasons(self):
        old = _shard([_lomda("c1", "דוגמא 1"), _lomda("c2", "תרגול")])
        new_c1 = _lomda("c1", "דוגמא 1", updated="2026-09-15T09:00:00Z", fp="bbbb", text_at="2026-09-16T01:00:00Z",
                        slides=[{"item_id": "s1", "texts": {}, "questions": [{"question_id": "q1", "texts": {}}, {"question_id": "q2", "texts": {}}],
                                 "enrichment": {"media": [{"src": "a.png", "description": "a graph"}]}}])
        new = _shard([new_c1, _lomda("c3", "חדש")])
        d = prs.diff_shard(old, new)
        self.assertEqual(d["lomdot_added"], ["חדש"])
        self.assertEqual(d["lomdot_removed"], ["תרגול"])
        c1 = d["lomdot_changed"]["c1"]
        self.assertEqual(c1["catalog_updated"]["to"], "2026-09-15T09:00:00Z")
        self.assertTrue(c1["content_fingerprint_changed"])
        self.assertEqual(c1["questions"], {"from": 1, "to": 2})
        self.assertEqual(c1["graphics_described"], {"from": 0, "to": 1})
        self.assertEqual(c1["lomda_texts_regenerated"], ["lesson_welcome"])

    def test_same_title_under_a_new_id_is_a_rename_not_a_churn(self):
        old = _shard([_lomda("methodica-math-ratio-01-01", "פותרים")])
        new = _shard([_lomda("https://lomdot.example/ratio/01", "פותרים", fp="bbbb")])
        d = prs.diff_shard(old, new)
        self.assertNotIn("lomdot_added", d)
        self.assertNotIn("lomdot_removed", d)
        r = d["lomdot_id_changed"][0]
        self.assertEqual((r["from"], r["to"]), ("methodica-math-ratio-01-01", "https://lomdot.example/ratio/01"))
        self.assertTrue(r["content_fingerprint_changed"])

    def test_a_reserialised_shard_is_called_out_not_hidden(self):
        shard = _shard([_lomda("c1", "דוגמא 1")])
        d = prs.diff_shard(shard, dict(shard))
        self.assertIn("note", d)
        self.assertNotIn("lomdot_changed", d)

    def test_extraction_verdict_change_is_a_reason(self):
        old = _shard([_lomda("c1", "דוגמא 1", verdict="frame_blocked", mapped=0, seen=0)])
        new = _shard([_lomda("c1", "דוגמא 1")])
        c1 = prs.diff_shard(old, new)["lomdot_changed"]["c1"]
        self.assertIn("frame_blocked", c1["extraction"]["from"])
        self.assertIn("extracted", c1["extraction"]["to"])

    def test_answers_never_enter_the_summary(self):
        """The diff is what the model sees; question answers must not be in it."""
        slide = {"item_id": "s1", "texts": {}, "questions": [{"question_id": "q1", "answers": [{"text": "42", "correct": True}], "texts": {}}], "enrichment": {}}
        old = _shard([_lomda("c1", "x", slides=[])])
        new = _shard([_lomda("c1", "x", slides=[slide])])
        self.assertNotIn("42", prs.render_fallback({"files": {"math/x.json": prs.diff_shard(old, new)}, "index": {}}))


class RenderingTest(unittest.TestCase):
    def test_fallback_has_a_section_per_file_and_the_fixed_tail(self):
        summary = {
            "files": {"math/MOE.MATH.X.json": prs.diff_shard(_shard([_lomda("c1", "דוגמא 1")]), _shard([_lomda("c1", "דוגמא 1"), _lomda("c2", "חדש")]))},
            "index": {"prompt_version": {"from": "cp-v1", "to": "cp-v2"}},
        }
        body = prs.render_fallback(summary)
        self.assertIn("### `math/MOE.MATH.X.json` — יחס", body)
        self.assertIn("Added lomda «חדש»", body)
        self.assertIn("prompt_version: cp-v1 → cp-v2", body)
        self.assertIn("manual promote", body)

    def test_model_answer_is_used_and_the_tail_is_restored_if_dropped(self):
        summary = {"files": {"math/x.json": {"objective_title_he": "יחס", "lomdot_added": ["חדש"]}}, "index": {}, "run_report": ""}
        with patch("app.services.llm.call_llm", new=AsyncMock(return_value="## Refresh\n\n" + "x" * 100)):
            import asyncio
            body = asyncio.run(prs.render_with_model(summary))
        self.assertTrue(body.startswith("## Refresh"))
        self.assertIn("manual promote", body)

    def test_a_short_or_missing_model_answer_falls_back(self):
        summary = {"files": {"math/x.json": {"objective_title_he": "יחס", "lomdot_added": ["חדש"]}}, "index": {}, "run_report": ""}
        with patch("app.services.llm.call_llm", new=AsyncMock(return_value=None)):
            import asyncio
            self.assertIsNone(asyncio.run(prs.render_with_model(summary)))


if __name__ == "__main__":
    unittest.main()
