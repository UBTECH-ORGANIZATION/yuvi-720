"""The runtime side of the content-intelligence config: load once, serve fresh.

The loader's rule set is what makes the feature safe to default-on: any
failure — missing dir, malformed file, smuggled correct answer, fingerprint
drift, prompt-version drift — must resolve to ``None`` lookups (→ live
generation, today's behavior), never to an exception on the coach path.

Shards here are built with the module's OWN fingerprint functions against a
mocked catalog, so freshness is consistent by construction and drift tests
mutate exactly one authored fact.
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
from app.services import kata_catalog  # noqa: E402

COMPONENT = "comp-1"
ITEM = "comp-1-001"


def _catalog_component(question_text: str = "מהי מסה?") -> dict:
    return {
        "id": COMPONENT,
        "title": "מדידת מסה",
        "objective_id": "MOE.SCI.X",
        "items": [{
            "id": ITEM, "title": "פתיחה", "content_type": "presentation",
            "media_format": "video", "question_count": 1,
        }],
        "questions_by_item": {ITEM: [
            {"questionId": "q1", "questionText": question_text},
        ]},
        "information_by_item": {ITEM: "מסך פתיחה על מסה"},
        "information_to_bot": "מסך פתיחה על מסה",
    }


def _prints() -> tuple[str, str, str]:
    q = ci.compute_fingerprint_question("מהי מסה?", "פתיחה", [], "מסך פתיחה על מסה")
    i = ci.compute_fingerprint_item("פתיחה", "presentation", "video",
                                    "מסך פתיחה על מסה", ["מהי מסה?"])
    c = ci.compute_fingerprint_component("מדידות ותכונות", "מדידת מסה", [i])
    return q, i, c


def _block(text: str, fingerprint: str, prompt_version: str | None = None,
           kind: str = "lesson_welcome") -> dict:
    return {"he": text,
            "prompt_version": prompt_version or ci.prompt_version_for(kind),
            "source_fingerprint": fingerprint,
            "generated_at": "2026-08-31T01:00:00Z", "model": "mini"}


def _shard(**overrides) -> dict:
    q_print, i_print, c_print = _prints()
    shard = {
        "schema_version": ci.SCHEMA_VERSION,
        "subject": "MOE.SCI",
        "objective_id": "MOE.SCI.X",
        "lomdot": [{
            "component_id": COMPONENT,
            "title": "מדידת מסה",
            "component_fingerprint": c_print,
            "texts": {"lesson_welcome": _block("היום נכיר את מדידת המסה", c_print)},
            "slides": [{
                "item_id": ITEM,
                "title": "פתיחה",
                "content_type": "presentation",
                "media_format": "video",
                "fingerprint": i_print,
                "enrichment": {
                    "visible_text": "טקסט שנקרא מהמסך " * 100,   # over the cap
                    "media": [{"kind": "video", "title": "מסה ומשקל",
                               "duration_seconds": 143}],
                    "captured_at": "2026-08-31T01:00:00Z",
                },
                "texts": {"video_summary": _block("בסרטון רואים שקילה", i_print)},
                "questions": [{
                    "question_id": "q1",
                    "question_text": "מהי מסה?",
                    "fingerprint": q_print,
                    "texts": {"question_intro": _block(
                        "שאלה ראשונה לפניך", q_print, kind="question_intro")},
                }],
            }],
        }],
    }
    shard.update(overrides)
    return shard


class ContentIntelWorld(unittest.TestCase):
    """A temp config dir + a mocked catalog that agrees with it."""

    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        os.environ["CONTENT_INTEL_CONFIG_PATH"] = self.dir.name
        self.addCleanup(os.environ.pop, "CONTENT_INTEL_CONFIG_PATH", None)
        os.environ.pop("CONTENT_INTEL_ENABLED", None)
        ci.reset_for_tests()
        self.addCleanup(ci.reset_for_tests)
        self.catalog = _catalog_component()
        for name, value in (
            ("get_component", lambda cid: self.catalog if cid == COMPONENT else None),
            ("localized_objective_title", lambda oid, locale="he": "מדידות ותכונות"),
        ):
            patcher = mock.patch.object(kata_catalog, name, side_effect=value)
            patcher.start()
            self.addCleanup(patcher.stop)

    def write_shard(self, shard: dict, name: str = "MOE.SCI.X.json") -> None:
        path = Path(self.dir.name) / "MOE.SCI" / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(shard, ensure_ascii=False), encoding="utf-8")


class FreshTextsAreServed(ContentIntelWorld):
    def test_question_intro_round_trips(self):
        self.write_shard(_shard())
        hit = ci.pregen_text("question_intro", COMPONENT, ITEM, "q1")
        self.assertIsNotNone(hit)
        self.assertEqual(hit["text"], "שאלה ראשונה לפניך")

    def test_component_scope_serves_the_welcome(self):
        self.write_shard(_shard())
        hit = ci.pregen_text("lesson_welcome", COMPONENT)
        self.assertEqual(hit["text"], "היום נכיר את מדידת המסה")

    def test_item_scope_serves_the_video_summary(self):
        self.write_shard(_shard())
        hit = ci.pregen_text("video_summary", COMPONENT, ITEM)
        self.assertEqual(hit["text"], "בסרטון רואים שקילה")

    def test_unknown_key_and_absent_kind_miss_quietly(self):
        self.write_shard(_shard())
        self.assertIsNone(ci.pregen_text("question_intro", COMPONENT, ITEM, "q9"))
        self.assertIsNone(ci.pregen_text("hint_l1", COMPONENT, ITEM, "q1"))


class StalenessMeansLiveGeneration(ContentIntelWorld):
    def test_a_vendor_edit_kills_the_pregen(self):
        self.write_shard(_shard())
        self.catalog.update(_catalog_component("מהי מסה? (מנוסח מחדש)"))
        self.assertIsNone(ci.pregen_text("question_intro", COMPONENT, ITEM, "q1"))

    def test_prompt_version_drift_kills_the_pregen(self):
        shard = _shard()
        block = shard["lomdot"][0]["slides"][0]["questions"][0]["texts"]["question_intro"]
        block["prompt_version"] = "cp-v0"
        self.write_shard(shard)
        self.assertIsNone(ci.pregen_text("question_intro", COMPONENT, ITEM, "q1"))

    def test_cold_catalog_means_not_fresh_not_a_crash(self):
        self.write_shard(_shard())
        with mock.patch.object(kata_catalog, "get_component", return_value=None):
            self.assertIsNone(ci.pregen_text("lesson_welcome", COMPONENT))


class BrokenInputsDegradeToToday(ContentIntelWorld):
    def test_the_flag_is_a_kill_switch(self):
        self.write_shard(_shard())
        os.environ["CONTENT_INTEL_ENABLED"] = "0"
        self.addCleanup(os.environ.pop, "CONTENT_INTEL_ENABLED", None)
        self.assertIsNone(ci.pregen_text("lesson_welcome", COMPONENT))

    def test_missing_dir_and_malformed_file_never_raise(self):
        os.environ["CONTENT_INTEL_CONFIG_PATH"] = "/nonexistent/nowhere"
        ci.reset_for_tests()
        self.assertIsNone(ci.pregen_text("lesson_welcome", COMPONENT))
        os.environ["CONTENT_INTEL_CONFIG_PATH"] = self.dir.name
        ci.reset_for_tests()
        (Path(self.dir.name) / "broken.json").write_text("{not json", encoding="utf-8")
        self.assertIsNone(ci.pregen_text("lesson_welcome", COMPONENT))

    def test_a_smuggled_correct_answer_discards_the_whole_file(self):
        shard = _shard()
        shard["lomdot"][0]["slides"][0]["questions"][0]["correctAnswers"] = ["מסה"]
        self.write_shard(shard)
        # Not just the poisoned question — the entire shard must be dead.
        self.assertIsNone(ci.pregen_text("lesson_welcome", COMPONENT))
        self.assertIsNone(ci.pregen_text("question_intro", COMPONENT, ITEM, "q1"))

    def test_an_invalid_shard_is_discarded_not_partially_loaded(self):
        shard = _shard(schema_version=99)
        self.write_shard(shard)
        self.assertIsNone(ci.pregen_text("lesson_welcome", COMPONENT))


class EnrichmentIsBoundedAndFresh(ContentIntelWorld):
    def test_visible_text_is_capped_and_media_is_labelled(self):
        self.write_shard(_shard())
        enr = ci.enrichment(COMPONENT, ITEM)
        self.assertIsNotNone(enr)
        self.assertLessEqual(len(enr["visible_text"]), ci.ENRICHMENT_VISIBLE_TEXT_CAP)
        self.assertEqual(len(enr["media"]), 1)
        self.assertIn("video", enr["media"][0])
        self.assertIn("143s", enr["media"][0])

    def test_stale_enrichment_is_withheld(self):
        self.write_shard(_shard())
        self.catalog.update(_catalog_component("שאלה חדשה לגמרי"))
        self.assertIsNone(ci.enrichment(COMPONENT, ITEM))

    def test_missing_enrichment_is_a_quiet_none(self):
        shard = _shard()
        shard["lomdot"][0]["slides"][0].pop("enrichment")
        self.write_shard(shard)
        self.assertIsNone(ci.enrichment(COMPONENT, ITEM))


class ScreenAnchorsServeOnlyTrustedGeometry(ContentIntelWorld):
    def _anchored_shard(self, **enrichment_overrides) -> dict:
        shard = _shard()
        shard["lomdot"][0]["slides"][0]["enrichment"].update({
            "capture_version": ci.CAPTURE_VERSION,
            "capture_viewport": {"w": 1280, "h": 860,
                                 "scroll_w": 1280, "scroll_h": 860},
            "no_internal_scroll": True,
            "anchor_breakpoints": [
                {"w": 1024, "h": 860, "content_w": 1024, "content_h": 700,
                 "anchors": [
                     {"region": "question",
                      "rect": {"x": 100, "y": 120, "w": 400, "h": 90}},
                 ]},
                {"w": 1280, "h": 640, "content_w": 1280, "content_h": 640,
                 "anchors": [
                     {"region": "question",
                      "rect": {"x": 150, "y": 110, "w": 500, "h": 84}},
                 ]},
                {"w": 1280, "h": 860, "content_w": 1280, "content_h": 860,
                 "anchors": [
                     {"region": "question",
                      "rect": {"x": 150, "y": 150, "w": 500, "h": 112}},
                     {"region": "image",
                      "rect": {"x": 40, "y": 300, "w": 300, "h": 240}},
                 ]},
            ],
            **enrichment_overrides,
        })
        return shard

    def test_fresh_current_capture_serves_per_size_pixels(self):
        self.write_shard(self._anchored_shard())
        anchors = ci.screen_anchors(COMPONENT, ITEM)
        self.assertEqual(set(anchors["regions"]), {"question", "image"})
        question = anchors["regions"]["question"]
        self.assertEqual([(e["w"], e["h"]) for e in question],
                         [(1024, 860), (1280, 640), (1280, 860)])
        self.assertEqual(question[0]["rect"],
                         {"x": 100.0, "y": 120.0, "w": 400.0, "h": 90.0})
        self.assertEqual(question[2]["content_h"], 860)
        # A region sampled at one grid point serves that point alone.
        self.assertEqual([(e["w"], e["h"]) for e in anchors["regions"]["image"]],
                         [(1280, 860)])

    def test_an_old_capture_format_is_refused(self):
        self.write_shard(self._anchored_shard(capture_version=4))
        self.assertIsNone(ci.screen_anchors(COMPONENT, ITEM))

    def test_stale_content_is_refused(self):
        self.write_shard(self._anchored_shard())
        self.catalog.update(_catalog_component("שאלה חדשה לגמרי"))
        self.assertIsNone(ci.screen_anchors(COMPONENT, ITEM))

    def test_junk_geometry_is_filtered(self):
        self.write_shard(self._anchored_shard(anchor_breakpoints=[
            {"w": 1280, "h": 860, "content_w": 1280, "content_h": 860,
             "anchors": [
                 {"region": "sidebar", "rect": {"x": 0, "y": 0, "w": 10, "h": 10}},
                 {"region": "options", "rect": {"x": -5, "y": 200, "w": 9999, "h": 80}},
                 {"region": "table", "rect": {"x": 10, "y": 10, "w": 0, "h": 20}},
                 {"region": "video", "rect": "not-a-rect"},
             ]},
            {"w": 0, "h": 860, "content_w": 1280, "content_h": 860, "anchors": [
                {"region": "question", "rect": {"x": 1, "y": 1, "w": 5, "h": 5}},
            ]},
            {"w": 1024, "content_w": 1024, "content_h": 860, "anchors": [
                {"region": "question", "rect": {"x": 1, "y": 1, "w": 5, "h": 5}},
            ]},  # a heightless (pre-v6) row is refused, not guessed at
            "not-a-breakpoint",
        ]))
        anchors = ci.screen_anchors(COMPONENT, ITEM)
        self.assertEqual(set(anchors["regions"]), {"options"})
        rect = anchors["regions"]["options"][0]["rect"]
        self.assertEqual(rect["x"], 0.0)
        self.assertEqual(rect["w"], 8000.0)

    def test_no_usable_regions_means_none(self):
        self.write_shard(self._anchored_shard(anchor_breakpoints=[]))
        self.assertIsNone(ci.screen_anchors(COMPONENT, ITEM))

    def test_solo_question_id_reads_the_slide(self):
        self.write_shard(_shard())
        self.assertEqual(ci.single_question_id(COMPONENT, ITEM), "q1")

    def test_solo_question_id_is_none_off_config(self):
        self.write_shard(_shard())
        self.assertIsNone(ci.single_question_id(COMPONENT, "other-item"))

    def test_arrival_question_is_the_slides_first(self):
        # An arriving learner lands at the TOP of the slide — its first
        # question grounds the intro even on a multi-part screen.
        shard = _shard()
        shard["lomdot"][0]["slides"][0]["questions"].append(
            {"question_id": "q2", "question_text": "הסיקו מסקנה:",
             "fingerprint": "beef" * 4, "texts": {}})
        self.write_shard(shard)
        self.assertEqual(ci.arrival_question_id(COMPONENT, ITEM), "q1")
        self.assertEqual(ci.arrival_question_id(COMPONENT, ITEM, "q9"), "q1",
                         "a stale pointer from another screen doesn't block")

    def test_arrival_defers_to_a_pointer_on_this_slide(self):
        # The pointer names a question that IS here (either part): the learner
        # is mid-screen, not arriving — never re-open part 1 on them.
        shard = _shard()
        shard["lomdot"][0]["slides"][0]["questions"].append(
            {"question_id": "q2", "question_text": "הסיקו מסקנה:",
             "fingerprint": "beef" * 4, "texts": {}})
        self.write_shard(shard)
        self.assertIsNone(ci.arrival_question_id(COMPONENT, ITEM, "q1"))
        self.assertIsNone(ci.arrival_question_id(COMPONENT, ITEM, "q2"))

    def test_arrival_question_is_none_off_config(self):
        self.write_shard(_shard())
        self.assertIsNone(ci.arrival_question_id(COMPONENT, "other-item"))

    def test_vendor_page_id_maps_the_players_screen(self):
        # The walk overheard the player announce this page id (CET narrates
        # navigation with opaque ids the catalog never lists) — a live
        # learner's page-enter must resolve to the slide that announced it.
        shard = _shard()
        shard["lomdot"][0]["slides"][0].setdefault("enrichment", {})
        shard["lomdot"][0]["slides"][0]["enrichment"]["vendor_page_id"] = \
            "mriro31m3ib50cl4i"
        self.write_shard(shard)
        self.assertEqual(
            ci.vendor_screen_item(COMPONENT, "mriro31m3ib50cl4i"), ITEM)
        self.assertIsNone(ci.vendor_screen_item(COMPONENT, "unknown-tail"))
        self.assertIsNone(ci.vendor_screen_item("other-comp", "mriro31m3ib50cl4i"))

    def test_an_id_claimed_by_non_variants_is_dropped(self):
        # A walk stuck on a drag-gated page stamped ONE physical page's id on
        # several different slides (measured 2026-09-01 on COMPL-00001) —
        # resolving any of them would move a live learner's pointer to the
        # wrong item. The map refuses the whole claim: not moving beats wrong.
        shard = _shard()
        slides = shard["lomdot"][0]["slides"]
        second = json.loads(json.dumps(slides[0]))
        second["item_id"] = ITEM + "-b"
        second["questions"][0]["question_text"] = "שאלה אחרת לגמרי"
        slides.append(second)
        for slide in slides:
            slide.setdefault("enrichment", {})["vendor_page_id"] = "dup-page"
        self.write_shard(shard)
        self.assertIsNone(ci.vendor_screen_item(COMPONENT, "dup-page"))

    def test_variant_siblings_keep_their_shared_page_id(self):
        # Variants ARE one physical page — the shared claim is genuine; the
        # first sibling anchors it and the variants hedge covers which one.
        shard = _shard()
        slides = shard["lomdot"][0]["slides"]
        second = json.loads(json.dumps(slides[0]))
        second["item_id"] = ITEM + "-b"   # identical question text = variant
        slides.append(second)
        for slide in slides:
            slide.setdefault("enrichment", {})["vendor_page_id"] = "shared-page"
        self.write_shard(shard)
        self.assertEqual(ci.vendor_screen_item(COMPONENT, "shared-page"), ITEM)


class TheHitIsMeasured(ContentIntelWorld):
    def test_record_pregen_hit_swallows_metering_failures(self):
        context = mock.Mock()
        context.for_operation.side_effect = RuntimeError("meter down")
        asyncio.run(ci.record_pregen_hit(context, "question_intro", "טקסט"))


if __name__ == "__main__":
    unittest.main()
