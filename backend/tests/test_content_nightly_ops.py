"""The nightly's operating discipline: what it browses first, what it
remembers, what it refuses to commit, and when it may merge on its own.

Pure stages only (no HTTP, browser or model): the browse planner
(scripts/content_browse.py), the merge gate (scripts/content_guard.py), and
the pipeline's leak scan, generation order, carry-forward and usage ledger.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import tempfile
import unittest
from datetime import date
from pathlib import Path
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services import content_intelligence as ci  # noqa: E402
from scripts import content_browse as browse  # noqa: E402
from scripts import content_guard as guard  # noqa: E402
from scripts import content_pipeline as pipeline  # noqa: E402
from tests.test_content_pipeline import _generated_for, _model  # noqa: E402

TODAY = date(2026, 9, 24)


def _live(*cids: str, provider: str = "methodica") -> dict:
    return {cid: {"provider": provider} for cid in cids}


class TheBrowsePlan(unittest.TestCase):
    def _plan(self, **kw) -> dict:
        args = dict(live={}, committed={}, diff={"new": [], "changed": []},
                    recapture=[], state={}, today=TODAY, budget=10)
        args.update(kw)
        return browse.plan_browse(**args)

    def test_new_and_changed_come_before_recapture_and_coverage(self):
        live = _live("new", "changed", "recap", "never")
        committed = {"changed": {"extraction": {"probed_at": "2026-09-20"}},
                     "recap": {"extraction": {"probed_at": "2026-09-20"}}}
        plan = self._plan(live=live, committed=committed,
                          diff={"new": ["new"], "changed": ["changed"]},
                          recapture=["recap"], budget=3)
        self.assertEqual(plan["browse"], ["new", "changed", "recap"])
        self.assertEqual(plan["reasons"]["recap"], "recapture")

    def test_a_failing_lomda_backs_off_instead_of_heading_every_night(self):
        state: dict = {}
        browse.record_attempt(state, "dead", "launch_rejected", TODAY)
        plan = self._plan(live=_live("dead", "fresh"), state=state, budget=1)
        self.assertEqual(plan["browse"], ["fresh"])
        self.assertIn("dead", plan["backed_off"])
        tomorrow = date.fromordinal(TODAY.toordinal() + 1)
        again = self._plan(live=_live("dead", "fresh"), state=state, budget=5,
                           today=tomorrow)
        self.assertEqual(again["reasons"].get("dead"), "retry")

    def test_backoff_doubles_and_caps(self):
        self.assertEqual([browse.backoff_days(n) for n in range(1, 8)],
                         [1, 2, 4, 8, 16, 16, 16])
        state: dict = {}
        browse.record_attempt(state, "x", "timeout", TODAY)
        browse.record_attempt(state, "x", "timeout", TODAY)
        self.assertEqual(state["x"]["failures"], 2)
        self.assertEqual(state["x"]["next_after"], "2026-09-26")
        browse.record_attempt(state, "x", "extracted", TODAY)
        self.assertNotIn("failures", state["x"])
        self.assertNotIn("next_after", state["x"])

    def test_retries_cannot_fill_the_night(self):
        state: dict = {}
        cids = [f"f{n}" for n in range(10)]
        for cid in cids:
            browse.record_attempt(state, cid, "timeout", date(2026, 9, 1))
        plan = self._plan(live=_live(*cids, "never"), state=state, budget=8)
        retries = [c for c, r in plan["reasons"].items() if r == "retry"]
        self.assertEqual(len(retries), 2)          # max(2, 8 // 4)
        self.assertIn("never", plan["browse"])
        # A capped retry is NOT carried as backlog, where it would jump the cap.
        self.assertFalse(set(cids) & set(plan["waiting"]))

    def test_providers_take_turns_inside_a_class(self):
        live = {**_live("m1", "m2", "m3"), **_live("c1", "c2", provider="cet")}
        plan = self._plan(live=live, diff={"new": ["m1", "m2", "m3", "c1", "c2"],
                                           "changed": []}, budget=4)
        self.assertEqual(plan["browse"], ["c1", "m1", "c2", "m2"])
        self.assertEqual(plan["waiting"], ["m3"])

    def test_leftover_work_is_queued_first_next_night(self):
        plan = self._plan(live=_live("a", "b"), queued=["b"], budget=1)
        self.assertEqual(plan["browse"], ["b"])
        self.assertEqual(plan["reasons"]["b"], "queued")

    def test_a_forced_lomda_ignores_its_backoff(self):
        state: dict = {}
        browse.record_attempt(state, "dead", "launch_rejected", TODAY)
        plan = self._plan(live=_live("dead"), state=state, forced=["dead"], budget=1)
        self.assertEqual(plan["browse"], ["dead"])

    def test_the_breaker_opens_on_a_provider_streak_only(self):
        breaker = browse.ProviderBreaker(threshold=2)
        breaker.record("cet", "launch_unavailable")
        breaker.record("cet", "extracted")         # a success resets
        breaker.record("cet", "launch_unavailable")
        self.assertFalse(breaker.open("cet"))
        breaker.record("cet", "launch_unavailable")
        self.assertTrue(breaker.open("cet"))
        self.assertFalse(breaker.open("methodica"))
        breaker.record("methodica", "timeout")     # a lomda's own failure
        breaker.record("methodica", "timeout")
        self.assertFalse(breaker.open("methodica"))

    def test_state_for_removed_lomdot_is_pruned_and_sorted(self):
        state = {"b": {"verdict": "x"}, "gone": {"verdict": "x"}, "a": {"verdict": "x"}}
        self.assertEqual(list(browse.prune_state(state, ["a", "b"])), ["a", "b"])


def _shard_of(model: dict) -> dict:
    shards = pipeline.build_shards(model, {}, {}, _generated_for(model))
    return {str(path): json.loads(ci.dump_shard(shard)) for path, shard in shards.items()}


class TheGuard(unittest.TestCase):
    def test_an_identical_night_passes(self):
        shards = _shard_of(_model())
        result = guard.evaluate(shards, shards, [])
        self.assertTrue(result["ok"], result)

    def test_a_silently_lost_text_fails(self):
        base = _shard_of(_model())
        new = json.loads(json.dumps(base))
        question = next(iter(new.values()))["lomdot"][0]["slides"][0]["questions"][0]
        del question["texts"]["hint_l1"]
        result = guard.evaluate(base, new, [])
        self.assertFalse(result["ok"])
        self.assertEqual(result["regression"]["by_reason"], {"unexplained": 1})

    def test_a_recorded_leak_removal_is_explained(self):
        base = _shard_of(_model())
        new = json.loads(json.dumps(base))
        question = next(iter(new.values()))["lomdot"][0]["slides"][0]["questions"][0]
        del question["texts"]["hint_l1"]
        decisions = [{"cid": "comp-1", "iid": "comp-1-001", "what": "text:q1:hint_l1",
                      "action": "removed", "reason": "answer_guard"}]
        result = guard.evaluate(base, new, decisions)
        self.assertTrue(result["ok"], result)
        self.assertEqual(result["regression"]["by_reason"], {"answer_guard": 1})

    def test_a_vendor_edit_explains_its_own_losses(self):
        base = _shard_of(_model())
        new = _shard_of(_model("מהי מסה של גוף?"))
        for shard in new.values():
            for slide in shard["lomdot"][0]["slides"]:
                slide["texts"] = {}
                for q in slide["questions"]:
                    q["texts"] = {}
        result = guard.evaluate(base, new, [])
        self.assertTrue(result["ok"], result)
        self.assertIn("content_changed", result["regression"]["by_reason"])

    def test_a_text_that_states_the_answer_fails_the_invariants(self):
        shards = _shard_of(_model())
        question = next(iter(shards.values()))["lomdot"][0]["slides"][0]["questions"][0]
        question["texts"]["hint_l1"]["he"] = "התשובה היא גרם"
        result = guard.evaluate(shards, shards, [])
        self.assertFalse(result["ok"])
        self.assertTrue(any("asserts an answer" in p for p in result["invariant_failures"]))

    def test_a_dishonest_extraction_record_fails(self):
        shards = _shard_of(_model())
        lomda = next(iter(shards.values()))["lomdot"][0]
        lomda["extraction"]["screens_mapped"] = 3
        result = guard.evaluate(shards, shards, [])
        self.assertFalse(result["ok"])

    def test_a_wrong_slide_capture_is_explained_by_reverification(self):
        base = _shard_of(_model())
        slide = next(iter(base.values()))["lomdot"][0]["slides"][0]
        slide["enrichment"] = {"visible_text": "מסך אחר לגמרי על אנרגיה",
                               "capture_version": 7}
        new = _shard_of(_model())
        result = guard.evaluate(base, new, [])
        self.assertEqual(result["regression"]["by_reason"], {"failed_reverify": 1})
        self.assertTrue(result["ok"], result)

    def test_the_markdown_carries_counts_not_content(self):
        shards = _shard_of(_model())
        body = guard.render_markdown(guard.evaluate(shards, shards, []))
        self.assertIn("Guard: ✅ passed", body)
        self.assertNotIn("גרם", body)


class NothingThatGivesAnAnswerAwayIsCommitted(unittest.TestCase):
    def test_the_runtime_guard_catches_what_the_substring_test_missed(self):
        question = {"correct": ["הבלון המנופח כבד יותר"],
                    "answers": ["הבלון המנופח כבד יותר", "הבלון הריק כבד יותר"]}
        self.assertTrue(pipeline.leaks_an_answer(
            "שימו לב: המנופח כבד יותר, נכון?", [question]))
        self.assertFalse(pipeline.leaks_an_answer(
            "מה ההבדל בין שני הבלונים?", [question]))
        self.assertTrue(pipeline.leaks_an_answer("התשובה היא 12", []))

    def test_questions_without_a_single_answer_to_reveal_are_not_guarded(self):
        one_option = {"correct": ["מסלול ב"], "answers": ["מסלול ב"]}
        mostly_correct = {"correct": ["יחס 3/4", "יחס 15:20", "יחס 3/7"],
                          "answers": ["יחס 3/4", "יחס 15:20", "יחס 3/7", "פי 6"]}
        matching = {"correct": ["{'source': 'צנצנת ריקה', 'target': 'טרה'}"],
                    "answers": ["{'source': ['צנצנת ריקה'], 'target': ['טרה', 'נטו']}"]}
        for question in (one_option, mostly_correct, matching):
            self.assertFalse(pipeline._singles_out(question), question)
        self.assertFalse(pipeline.leaks_an_answer("איזה מסלול נשאר קבוע?", [one_option]))
        # Two correct of four still singles out: "look for the empty ones".
        two_of_four = {"correct": ["הקופסה הריקה", "הפחית הריקה"],
                       "answers": ["הקופסה הריקה", "הפחית הריקה", "המשחק", "הפחית המלאה"]}
        self.assertTrue(pipeline._singles_out(two_of_four))

    def test_scan_removes_carried_leaks_and_records_why(self):
        model = _model()
        shards = pipeline.build_shards(model, {}, {}, _generated_for(model))
        shard = next(iter(shards.values()))
        question = shard["lomdot"][0]["slides"][0]["questions"][0]
        question["texts"]["hint_l1"]["he"] = "התשובה הנכונה היא גרם."
        decisions: list = []
        removed = pipeline.scan_leaks(model, shards, decisions)
        self.assertEqual(removed, 1)
        self.assertNotIn("hint_l1", question["texts"])
        self.assertEqual(decisions, [{"cid": "comp-1", "iid": "comp-1-001",
                                      "what": "text:q1:hint_l1", "action": "removed",
                                      "reason": "answer_guard"}])
        self.assertNotIn("גרם", json.dumps(decisions, ensure_ascii=False))

    def test_generation_counts_its_rejections(self):
        targets = pipeline.collect_generation_targets(_model(), {})
        hint = next(t for t in targets if t["kind"] == "hint_l1")
        intro = next(t for t in targets if t["kind"] == "question_intro")
        payload = json.dumps({"rows": [
            {"id": hint["id"], "text": "זה גרם, כמובן."},
            {"id": intro["id"], "text": "English"}]}, ensure_ascii=False)
        rejections: dict = {}
        with mock.patch("app.services.llm.call_llm", mock.AsyncMock(return_value=payload)):
            generated = asyncio.run(pipeline.generate_texts(targets, 1, rejections))
        self.assertEqual(generated, {})
        self.assertEqual(rejections["answer_guard"], 1)
        self.assertEqual(rejections["not_hebrew"], 1)
        self.assertEqual(rejections["missing_row"], len(targets) - 2)

    def test_the_spend_cap_stops_generation(self):
        targets = pipeline.collect_generation_targets(_model(), {})
        async_mock = mock.AsyncMock(return_value=json.dumps({"rows": []}))
        with mock.patch("app.services.llm.call_llm", async_mock):
            asyncio.run(pipeline.generate_texts(targets, 10, should_stop=lambda: True))
        self.assertEqual(async_mock.await_count, 0)


class GenerationOrder(unittest.TestCase):
    def test_arrival_texts_first_and_rotation_inside_a_kind(self):
        targets = [{"id": f"{k}-{n}", "kind": k}
                   for k in ("explanation", "question_intro") for n in range(3)]
        first = pipeline.order_targets(targets, rotation=0)
        self.assertEqual([t["kind"] for t in first[:3]], ["question_intro"] * 3)
        self.assertEqual(first[0]["id"], "question_intro-0")
        second = pipeline.order_targets(targets, rotation=1)
        self.assertEqual(second[0]["id"], "question_intro-1")

    def test_intros_are_regenerated_under_the_new_prompt(self):
        self.assertEqual(ci.prompt_version_for("question_intro"), "cp-v3")
        self.assertEqual(ci.prompt_version_for("lesson_step_intro"), "cp-v3")
        self.assertEqual(ci.prompt_version_for("hint_l1"), ci.PROMPT_VERSION)


class CarryForward(unittest.TestCase):
    def _lomda(self, model: dict) -> dict:
        shard = next(iter(pipeline.build_shards(model, {}, {}, _generated_for(model)).values()))
        return json.loads(ci.dump_shard(shard))["lomdot"][0]

    def test_an_open_prs_work_is_not_paid_for_again(self):
        model = _model()
        main = {"comp-1": self._lomda(model)}
        for slide in main["comp-1"]["slides"]:
            for q in slide["questions"]:
                q["texts"] = {}
        carried = {"comp-1": self._lomda(model)}
        merged = pipeline.merge_carried(main, carried)
        self.assertEqual(pipeline.collect_generation_targets(model, merged), [])
        self.assertEqual(len(pipeline.collect_generation_targets(model, main)), 3)

    def test_the_newer_side_wins_and_the_other_fills_gaps(self):
        model = _model()
        main = {"comp-1": self._lomda(model)}
        carried = {"comp-1": self._lomda(model)}
        carried["comp-1"]["extraction"] = {"verdict": "extracted",
                                           "probed_at": "2026-09-30T00:00:00Z"}
        for slide in carried["comp-1"]["slides"]:
            slide["texts"] = {}
        merged = pipeline.merge_carried(main, carried)["comp-1"]
        self.assertEqual(merged["extraction"]["verdict"], "extracted")
        self.assertEqual(merged["slides"][0]["texts"], main["comp-1"]["slides"][0]["texts"])

    def test_merging_never_mutates_its_inputs(self):
        model = _model()
        main = {"comp-1": self._lomda(model)}
        snapshot = json.dumps(main, sort_keys=True)
        pipeline.merge_carried(main, {"comp-1": self._lomda(model)})
        self.assertEqual(json.dumps(main, sort_keys=True), snapshot)


class TheUsageLedger(unittest.TestCase):
    def test_prices_every_observed_call(self):
        ledger = pipeline.UsageLedger()
        ledger({"operation": "content.pregen_texts.batch", "deployment": "gpt-5.4-mini",
                "usage": {"input_tokens": 1_000_000, "output_tokens": 0}})
        ledger({"operation": "content.vision", "deployment": "gpt-5.4",
                "usage": {"input_tokens": 0, "output_tokens": 1_000_000}})
        summary = ledger.summary()
        self.assertEqual(summary["calls"], 2)
        self.assertAlmostEqual(summary["usd"], 0.75 + 15.0)
        self.assertEqual(summary["by_operation"]["content.vision"]["output"], 1_000_000)
        self.assertNotIn("messages", json.dumps(ledger.events))


class TheMigrationIsHonest(unittest.TestCase):
    def test_wrong_slide_captures_go_and_counts_follow(self):
        model = _model()
        shards = pipeline.build_shards(model, {}, {}, _generated_for(model))
        shard = json.loads(ci.dump_shard(next(iter(shards.values()))))
        lomda = shard["lomdot"][0]
        lomda["extraction"] = {"verdict": "partial", "probed_at": "x",
                               "player_host": "", "screens_seen": 3, "screens_mapped": 2}
        lomda["slides"][0]["enrichment"] = {"visible_text": "מסך על אנרגיה",
                                            "capture_version": 7}
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "MOE.SCI" / "X.json"
            path.parent.mkdir(parents=True)
            path.write_text(json.dumps(shard, ensure_ascii=False), encoding="utf-8")
            self.assertEqual(pipeline.migrate_committed_shards(Path(tmp)), 1)
            self.assertEqual(pipeline.migrate_committed_shards(Path(tmp)), 0)
            written = json.loads(path.read_text(encoding="utf-8"))["lomdot"][0]
        self.assertNotIn("enrichment", written["slides"][0])
        self.assertEqual(written["extraction"]["screens_mapped"], 0)


if __name__ == "__main__":
    unittest.main()
