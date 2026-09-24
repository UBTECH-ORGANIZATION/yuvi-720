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

    def test_file_flags_follow_the_shard_status(self):
        self.assertEqual(prs.file_flag({"file": "added"}), "🟢")
        self.assertEqual(prs.file_flag({"file": "removed"}), "🔴")
        self.assertEqual(prs.file_flag({"lomdot_changed": {}}), "🟠")
        body = prs.render_fallback({"files": {"math/gone.json": {"file": "removed", "objective_title_he": "יחס", "lomdot_removed": ["א"]}}, "index": {}})
        self.assertIn("### 🔴 «יחס» — `math/gone.json`", body)
        self.assertIn("- 🔴 הוסרה הלומדה «א»", body)

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
        self.assertTrue(body.startswith('<div dir="rtl">\n\n'), body[:40])
        self.assertIn("### 🟠 «יחס» — `math/MOE.MATH.X.json`", body)
        self.assertIn("- 🟢 נוספה הלומדה «חדש»", body)
        self.assertIn(prs.LEGEND, body)
        self.assertIn("prompt_version: cp-v1 → cp-v2", body)
        self.assertIn("promote ידני", body)
        self.assertNotIn("'", body.replace("«", "").replace("»", ""))  # no bare apostrophe in RTL copy

    def test_model_answer_is_used_and_the_tail_is_restored_if_dropped(self):
        summary = {"files": {"math/x.json": {"objective_title_he": "יחס", "lomdot_added": ["חדש"]}}, "index": {}, "run_report": ""}
        model_text = "## Refresh\n\nפסקת פתיחה.\n\n### 🟠 «יחס» — `math/x.json`\n- 🟢 " + "x" * 100
        with patch("app.services.llm.call_llm", new=AsyncMock(return_value=model_text)):
            import asyncio
            body = asyncio.run(prs.render_with_model(summary))
        self.assertTrue(body.startswith('<div dir="rtl">\n\n## Refresh'), body[:40])
        self.assertIn("promote ידני", body)
        self.assertLess(body.index(prs.LEGEND), body.index("### 🟠"))  # legend sits between intro and sections
        self.assertTrue(body.rstrip().endswith("</div>"))

    def test_a_file_the_model_skipped_gets_its_deterministic_section(self):
        """A cut-off answer (max_tokens) must not drop a shard from the PR silently."""
        summary = {"files": {
            "math/a.json": {"objective_title_he": "יחס", "lomdot_added": ["חדש"]},
            "science/b.json": {"file": "removed", "objective_title_he": "מסה", "lomdot_removed": ["ישן"]},
        }, "index": {}, "run_report": ""}
        model_text = "פתיחה.\n\n### 🟠 «יחס» — `math/a.json`\n- 🟢 נוספה «חדש» — חדשה בקטלוג.\n\n" + prs.FIXED_TAIL
        with patch("app.services.llm.call_llm", new=AsyncMock(return_value=model_text)):
            import asyncio
            body = asyncio.run(prs.render_with_model(summary))
        self.assertIn("### 🔴 «מסה» — `science/b.json`", body)
        self.assertIn("- 🔴 הוסרה הלומדה «ישן»", body)
        self.assertLess(body.index("`science/b.json`"), body.index(prs.FIXED_TAIL))
        self.assertEqual(body.count("`math/a.json`"), 1)

    def test_a_short_or_missing_model_answer_falls_back(self):
        summary = {"files": {"math/x.json": {"objective_title_he": "יחס", "lomdot_added": ["חדש"]}}, "index": {}, "run_report": ""}
        with patch("app.services.llm.call_llm", new=AsyncMock(return_value=None)):
            import asyncio
            self.assertIsNone(asyncio.run(prs.render_with_model(summary)))



class TheRunSections(unittest.TestCase):
    def test_the_backlog_counts_queued_ids_not_mapping_keys(self):
        out = prs.diff_index({"backlog": {"browse": ["a"]}},
                             {"backlog": {"browse": ["a", "b", "c"]}})
        self.assertEqual(out["backlog"]["from"], 1)
        self.assertEqual(out["backlog"]["to"], 3)
        legacy = prs.diff_index({"backlog": ["a", "b"]}, {"backlog": {"browse": []}})
        self.assertEqual((legacy["backlog"]["from"], legacy["backlog"]["to"]), (2, 0))

    def test_guard_and_usage_are_appended_verbatim(self):
        usage = {"calls": 3, "usd": 0.4213, "by_operation": {
            "content.pregen_texts.batch": {"calls": 3, "input": 900, "cached": 0,
                                           "output": 300, "usd": 0.4213}}}
        body = prs.append_sections("גוף", "### Guard: ✅ passed\n", usage)
        self.assertTrue(body.startswith("גוף"))
        self.assertIn("### Guard: ✅ passed", body)
        self.assertIn("### Usage: 3 model calls · $0.42", body)
        self.assertIn("| content.pregen_texts.batch | 3 | 900 | 0 | 300 | 0.421 |", body)
        self.assertEqual(prs.append_sections("גוף", None, None), "גוף")


if __name__ == "__main__":
    unittest.main()
