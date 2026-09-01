"""The nightly pipeline's promises: idempotent, contained, validated.

Exercised at the stage level with programmatic catalog models (the same shape
``fetch_catalog_model`` builds), so each property is pinned without HTTP, a
browser, or a model: a quiet catalog writes byte-identical shards; a removed
lomda disappears; generation rejects every row that cannot be trusted; and a
browser failure becomes a verdict, never a crash.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services import content_intelligence as ci  # noqa: E402
from scripts import content_pipeline as pipeline  # noqa: E402


def _model(question_text: str = "מהי מסה?") -> dict:
    """One-component catalog model, fingerprints computed the real way."""
    info = "מסך על מדידת מסה"
    q_print = ci.compute_fingerprint_question(question_text, "פתיחה", [], info)
    i_print = ci.compute_fingerprint_item(
        "פתיחה", "presentation", "video", info, [question_text])
    return {"comp-1": {
        "subject": "MOE.SCI",
        "objective_id": "MOE.SCI.X",
        "objective_title_he": "מדידות",
        "title": "מדידת מסה",
        "cognitive_level": "understanding",
        "provider": "methodica",
        "kata_updated_at": "2026-08-01T00:00:00Z",
        "component_fingerprint": ci.compute_fingerprint_component(
            "מדידות", "מדידת מסה", [i_print]),
        "slides": [{
            "item_id": "comp-1-001", "title": "פתיחה",
            "content_type": "presentation", "media_format": "video",
            "role": "mixed", "position": 1, "information_to_bot": info,
            "fingerprint": i_print,
            "questions": [{
                "question_id": "q1", "question_type": "single-choice",
                "question_text": question_text,
                "answers": ["גרם", "ניוטון"], "correct": ["גרם"],
                "fingerprint": q_print,
            }],
        }],
    }}


def _generated_for(model: dict) -> dict:
    """A valid generation block for every slot the model wants."""
    out = {}
    for cid, comp in model.items():
        targets = pipeline.collect_generation_targets({cid: comp}, {})
        for target in targets:
            out[target["id"]] = {
                "he": "טקסט שנוצר מראש",
                "prompt_version": ci.prompt_version_for(target["kind"]),
                "source_fingerprint": target["fingerprint"],
                "generated_at": "2026-08-31T01:00:00Z",
                "model": "mini",
            }
    return out


class TheWriteIsIdempotent(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        self.out = Path(self.dir.name)

    def _write(self, model: dict) -> dict[str, str]:
        committed = pipeline.load_committed(self.out)
        shards = pipeline.build_shards(
            model, committed, {}, _generated_for(model) if not committed else {})
        pipeline.write_output(self.out, shards, [], {"lomdot": len(model)})
        return {str(p.relative_to(self.out)): p.read_text(encoding="utf-8")
                for p in ci.shard_paths(self.out)}

    def test_an_unchanged_catalog_writes_identical_bytes(self):
        first = self._write(_model())
        second = self._write(_model())
        self.assertEqual(first, second)
        self.assertIn("MOE.SCI/MOE.SCI.X.json", first)

    def test_generated_texts_survive_the_next_quiet_night(self):
        self._write(_model())
        rewritten = self._write(_model())
        shard = json.loads(rewritten["MOE.SCI/MOE.SCI.X.json"])
        texts = shard["lomdot"][0]["slides"][0]["questions"][0]["texts"]
        self.assertEqual(texts["question_intro"]["he"], "טקסט שנוצר מראש")

    def test_a_vendor_edit_drops_only_the_affected_texts(self):
        self._write(_model())
        edited = _model("מהי מסה? (מנוסח מחדש)")
        committed = pipeline.load_committed(self.out)
        shards = pipeline.build_shards(edited, committed, {}, {})
        lomda = shards[Path("MOE.SCI/MOE.SCI.X.json")]["lomdot"][0]
        # the welcome hung off the component fingerprint, which changed too —
        # every text keyed to drifted content is gone, none survive wrongly
        self.assertEqual(lomda["texts"], {})
        self.assertEqual(lomda["slides"][0]["questions"][0]["texts"], {})

    def test_a_removed_lomda_leaves_the_config(self):
        self._write(_model())
        pipeline.write_output(self.out, {}, [], {})
        self.assertEqual(ci.shard_paths(self.out), [])

    def test_no_correct_answers_reach_the_disk(self):
        self._write(_model())
        for path in ci.shard_paths(self.out):
            self.assertNotIn("correctAnswers", path.read_text(encoding="utf-8"))
            self.assertNotIn('"correct"', path.read_text(encoding="utf-8"))


class TheTargetsFollowTheFingerprints(unittest.TestCase):
    def test_a_fresh_config_has_no_targets(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            model = _model()
            shards = pipeline.build_shards(model, {}, {}, _generated_for(model))
            pipeline.write_output(out, shards, [], {})
            committed = pipeline.load_committed(out)
            self.assertEqual(
                pipeline.collect_generation_targets(model, committed), [])

    def test_every_slot_of_a_new_lomda_is_a_target(self):
        targets = pipeline.collect_generation_targets(_model(), {})
        kinds = sorted(t["kind"] for t in targets)
        # mixed slide: step intro + video summary; question: all three kinds
        self.assertEqual(kinds, ["explanation", "hint_l1", "lesson_step_intro",
                                 "lesson_welcome", "question_intro",
                                 "video_summary"])

    def test_only_question_kinds_carry_the_answers(self):
        # Question kinds keep them for echo-validation (an intro must not blurt
        # the answer either); lesson/slide kinds never see them at all.
        for target in pipeline.collect_generation_targets(_model(), {}):
            if target["kind"] in ci.QUESTION_TEXT_KINDS:
                self.assertEqual(target["correct"], ["גרם"])
            else:
                self.assertEqual(target["correct"], [])


class GenerationTrustsNothing(unittest.TestCase):
    def _generate(self, responses: list[str], max_calls: int = 10) -> dict:
        targets = pipeline.collect_generation_targets(_model(), {})
        calls = iter(responses)
        async_mock = mock.AsyncMock(side_effect=lambda *a, **k: next(calls, None))
        with mock.patch("app.services.llm.call_llm", async_mock):
            return asyncio.run(pipeline.generate_texts(targets, max_calls)), targets

    def test_valid_rows_land_with_full_metadata(self):
        targets = pipeline.collect_generation_targets(_model(), {})
        payload = json.dumps({"rows": [
            {"id": t["id"], "text": f"טקסט תקין עבור {t['kind']}"}
            for t in targets if t["kind"] != "hint_l1"]}, ensure_ascii=False)
        generated, targets = self._generate([payload])
        self.assertEqual(len(generated), len(targets) - 1)
        block = generated[targets[0]["id"]]
        self.assertEqual(block["prompt_version"],
                         ci.prompt_version_for(targets[0]["kind"]))
        self.assertEqual(block["source_fingerprint"], targets[0]["fingerprint"])

    def test_renamed_rows_cannot_be_matched_back(self):
        generated, _ = self._generate([json.dumps(
            {"rows": [{"id": "someone|else||question_intro", "text": "טקסט"}]})])
        self.assertEqual(generated, {})

    def test_rows_without_hebrew_are_rejected(self):
        targets = pipeline.collect_generation_targets(_model(), {})
        generated, _ = self._generate([json.dumps(
            {"rows": [{"id": targets[0]["id"], "text": "English only"}]})])
        self.assertEqual(generated, {})

    def test_over_length_rows_are_rejected(self):
        targets = pipeline.collect_generation_targets(_model(), {})
        cap = ci.TEXT_LENGTH_CAPS[targets[0]["kind"]]
        generated, _ = self._generate([json.dumps(
            {"rows": [{"id": targets[0]["id"], "text": "ארוך " * cap}]},
            ensure_ascii=False)])
        self.assertEqual(generated, {})

    def test_a_hint_that_says_the_answer_is_not_a_hint(self):
        targets = pipeline.collect_generation_targets(_model(), {})
        hint = next(t for t in targets if t["kind"] == "hint_l1")
        generated, _ = self._generate([json.dumps(
            {"rows": [{"id": hint["id"], "text": "התשובה היא גרם כמובן"}]},
            ensure_ascii=False)])
        self.assertNotIn(hint["id"], generated)

    def test_capture_bytes_never_survive_to_the_write(self):
        model = {"c": {"slides": [{"enrichment": {"media": [
            {"kind": "image", "shot_b64": "abc", "description": "תמונה"},
            {"kind": "video"},
        ]}}]}}
        pipeline.strip_capture_bytes(model)
        media = model["c"]["slides"][0]["enrichment"]["media"]
        self.assertNotIn("shot_b64", media[0])
        self.assertEqual(media[0]["description"], "תמונה")

    def test_old_capture_formats_requeue_for_browsing(self):
        model = _model()
        committed = {
            "comp-1": {"slides": [{"item_id": "i1", "enrichment": {
                "visible_text": "x", "capture_version": ci.CAPTURE_VERSION - 1}}]},
            "comp-legacy": {"slides": [{"item_id": "i1", "enrichment": {
                "visible_text": "x"}}]},          # pre-versioning capture
            "comp-current": {"slides": [{"item_id": "i1", "enrichment": {
                "visible_text": "x", "capture_version": ci.CAPTURE_VERSION}}]},
            "comp-unbrowsed": {"slides": [{"item_id": "i1"}]},
            "comp-gone": {"slides": [{"item_id": "i1", "enrichment": {
                "visible_text": "x"}}]},          # no longer in the catalog
        }
        model.update({cid: model["comp-1"] for cid in
                      ("comp-legacy", "comp-current", "comp-unbrowsed")})
        self.assertEqual(
            pipeline.components_needing_recapture(model, committed),
            ["comp-1", "comp-legacy"])

    def test_markdown_emphasis_cannot_hide_an_echoed_answer(self):
        targets = pipeline.collect_generation_targets(_model(), {})
        hint = next(t for t in targets if t["kind"] == "hint_l1")
        generated, _ = self._generate([json.dumps(
            {"rows": [{"id": hint["id"], "text": "התשובה היא **גר**ם כמובן"}]},
            ensure_ascii=False)])
        self.assertNotIn(hint["id"], generated)

    def test_the_budget_stops_the_batches(self):
        many = {}
        for n in range(30):
            many.update({f"comp-{n}": json.loads(json.dumps(
                _model()["comp-1"], ensure_ascii=False))})
        targets = pipeline.collect_generation_targets(many, {})
        self.assertGreater(len(targets), pipeline.BATCH)
        async_mock = mock.AsyncMock(return_value=json.dumps({"rows": []}))
        with mock.patch("app.services.llm.call_llm", async_mock):
            asyncio.run(pipeline.generate_texts(targets, 2))
        self.assertEqual(async_mock.await_count, 2)


class BrowsingFailuresBecomeVerdicts(unittest.TestCase):
    def test_a_launcher_404_is_a_verdict_not_a_crash(self):
        from app.services.kata_client import KataError

        with mock.patch.object(pipeline, "_launch_url",
                               mock.AsyncMock(side_effect=KataError("kata_launch_rejected", 502))):
            extraction = asyncio.run(pipeline.browse_component(
                "comp-1", _model()["comp-1"], Path(tempfile.mkdtemp())))
        self.assertEqual(extraction["verdict"], "launch_404")

    def test_an_unexpected_explosion_is_contained(self):
        with mock.patch.object(pipeline, "_launch_url",
                               mock.AsyncMock(side_effect=RuntimeError("boom"))):
            extraction = asyncio.run(pipeline.browse_component(
                "comp-1", _model()["comp-1"], Path(tempfile.mkdtemp())))
        self.assertEqual(extraction["verdict"], "driver_error")


class ScreensMapOntoSlides(unittest.TestCase):
    SLIDES = [{"item_id": f"c-00{n}", "title": t}
              for n, t in ((1, "פתיחה"), (2, "ניסוי"), (3, "סיכום"))]

    def test_aligned_dumps_map_one_to_one(self):
        screens = [{"title": "פתיחה"}, {"title": "ניסוי"}, {"title": "סיכום"}]
        mapped = pipeline.map_screens_to_slides(screens, self.SLIDES)
        self.assertEqual(mapped["c-001"]["title"], "פתיחה")
        self.assertEqual(len(mapped), 3)

    def test_a_leading_cover_screen_is_skipped(self):
        screens = [{"title": "ברוכים הבאים"}, {"title": "פתיחה"},
                   {"title": "ניסוי"}, {"title": "סיכום"}]
        mapped = pipeline.map_screens_to_slides(screens, self.SLIDES)
        self.assertEqual(mapped["c-001"]["title"], "פתיחה")
        self.assertEqual(mapped["c-003"]["title"], "סיכום")

    def test_question_text_detects_a_cover_when_titles_carry_no_signal(self):
        # The mass-measure-01-02 shape: the player opens with a cover the
        # catalog does not list, and no screen title matches any slide title.
        # The old more-screens-aligned bias then chose offset 0, landing every
        # enrichment one slide late. The slide's own question text appearing
        # in a screen's visible text is the decisive signal.
        slides = [
            {"item_id": "c-001", "title": "בסיסי 1",
             "questions": [{"question_text":
                            "עדן, פלג ושחר ביצעו סדרת מדידות של מסת מוצק"}]},
            {"item_id": "c-002", "title": "בסיסי 2",
             "questions": [{"question_text":
                            "ד\"ר בוחבוט מדדה מסת חומר 4 פעמים"}]},
        ]
        screens = [
            {"title": "", "visible_text": "אין כמו תרגול לחיזוק הלמידה 3 שאלות"},
            # The RENDERED wording drifts from the catalog metadata (extra
            # "בשיעור מדעים") — token overlap must still recognize it.
            {"title": "שאלה 1", "visible_text":
             "עדן, פלג ושחר ביצעו בשיעור מדעים סדרת מדידות של מסת מוצק. "
             "סעיף א: האם ישנה תוצאה חריגה בעיניכם?"},
        ]
        mapped = pipeline.map_screens_to_slides(screens, slides)
        self.assertEqual(mapped["c-001"]["title"], "שאלה 1",
                         "the question screen belongs to the question slide")
        self.assertNotIn("c-002", mapped)


class StuckWalksDoNotSpreadOnePage(unittest.TestCase):
    """COMPL-00001's first page gates navigation behind a drag task the walk
    cannot perform — every 'advance' re-captured page one with enough
    answer-state noise to defeat the text hash, and the positional mapper
    spread four captures of ONE page across four catalog slides."""

    NOT_PAGE_IDS = {"c-01", "c-01-001", "c-01-002"}

    def test_a_recaptured_page_id_collapses_to_its_first_capture(self):
        screens = [
            {"title": "עמוד 1", "vendor_page_ids": ["mr-page-1"],
             "anchor_breakpoints": [{"w": 1280, "anchors": [1]}]},
            {"title": "עמוד 1 אחרי קליק", "vendor_page_ids": ["mr-page-1"],
             "anchor_breakpoints": [{"w": 1280, "anchors": [2]}]},
            {"title": "עמוד 2", "vendor_page_ids": ["mr-page-2"],
             "anchor_breakpoints": [{"w": 1280, "anchors": [3]}]},
        ]
        kept = pipeline.collapse_stuck_screens(screens, self.NOT_PAGE_IDS)
        self.assertEqual([s["title"] for s in kept], ["עמוד 1", "עמוד 2"])

    def test_identical_geometry_collapses_when_no_ids_fire(self):
        # methodica announces no page ids — byte-identical measured geometry
        # is the remaining same-page signal.
        geometry = [{"w": 1280, "anchors": [{"region": "question"}]}]
        screens = [
            {"title": "א", "anchor_breakpoints": json.loads(json.dumps(geometry))},
            {"title": "ב", "anchor_breakpoints": json.loads(json.dumps(geometry))},
            {"title": "ג", "anchor_breakpoints": [{"w": 1280, "anchors": []}]},
        ]
        kept = pipeline.collapse_stuck_screens(screens, self.NOT_PAGE_IDS)
        self.assertEqual([s["title"] for s in kept], ["א", "ג"])

    def test_distinct_screens_all_survive(self):
        screens = [
            {"title": "א", "vendor_page_ids": ["mr-page-1"]},
            {"title": "ב", "vendor_page_ids": ["mr-page-2"]},
            {"title": "ג"},   # no ids, no geometry — nothing to match on
        ]
        kept = pipeline.collapse_stuck_screens(screens, self.NOT_PAGE_IDS)
        self.assertEqual(len(kept), 3)

    def test_an_ambiguous_claim_is_blanked_on_every_slide(self):
        slides = [
            {"item_id": "c-01-001",
             "questions": [{"question_text": "שאלה על ריבוע"}],
             "enrichment": {"vendor_page_id": "mr-dup"}},
            {"item_id": "c-01-002",
             "questions": [{"question_text": "שאלה על משולש"}],
             "enrichment": {"vendor_page_id": "mr-dup"}},
            {"item_id": "c-01-003",
             "questions": [{"question_text": "שאלה שלישית"}],
             "enrichment": {"vendor_page_id": "mr-solo"}},
        ]
        pipeline.blank_ambiguous_page_ids(slides)
        self.assertEqual(slides[0]["enrichment"]["vendor_page_id"], "")
        self.assertEqual(slides[1]["enrichment"]["vendor_page_id"], "")
        self.assertEqual(slides[2]["enrichment"]["vendor_page_id"], "mr-solo")

    def test_variant_siblings_keep_their_shared_claim(self):
        slides = [
            {"item_id": "c-01-001",
             "questions": [{"question_text": "אותה שאלה בדיוק"}],
             "enrichment": {"vendor_page_id": "mr-shared"}},
            {"item_id": "c-01-002",
             "questions": [{"question_text": "אותה שאלה בדיוק"}],
             "enrichment": {"vendor_page_id": "mr-shared"}},
        ]
        pipeline.blank_ambiguous_page_ids(slides)
        self.assertEqual(slides[0]["enrichment"]["vendor_page_id"], "mr-shared")
        self.assertEqual(slides[1]["enrichment"]["vendor_page_id"], "mr-shared")


if __name__ == "__main__":
    unittest.main()
