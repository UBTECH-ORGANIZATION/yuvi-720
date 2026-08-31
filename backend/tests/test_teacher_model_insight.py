"""#454 — the teacher's insight entering the student model.

Covers the whole contract: the deterministic drastic-change warning, the two
writes (memory theme + description entry) through the scope gate, PII
scrubbing, bi-temporal contradiction (nothing deleted), the non-decay of a
teacher-sourced theme, and the symmetric override bell when the evidence later
wins."""

from __future__ import annotations

import json
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

from app.brain.context_engine import AGENT_VIEWS, AgentScopeError, apply_writes
from app.brain.description import (
    apply_ops,
    description_defaults,
    active_entries,
    gather_evidence,
)
from app.brain.memory import active_themes, memory_defaults, upsert_theme
from app.services import student_model_insight as smi


def _brain_with_block(block: str, entries: list[dict]) -> dict:
    description = description_defaults()
    description["blocks"][block] = entries
    return {"student_description": description, "memory": memory_defaults(), "profile": {}}


def _entry(text: str, evidence: list[str]) -> dict:
    return {"text": text, "evidence": evidence, "valid_at": "2026-08-01T00:00:00+00:00", "invalid_at": None}


class PreviewTest(unittest.TestCase):
    def test_plain_addition_to_a_quiet_block_is_not_drastic(self) -> None:
        diff = smi.preview(_brain_with_block("learning_preferences", []), "learning_preferences", "עוזר לצייר את הבעיה")
        self.assertFalse(diff["drastic"])
        self.assertEqual(diff["reasons"], [])

    def test_how_to_reach_always_warns(self) -> None:
        diff = smi.preview(_brain_with_block("how_to_reach", []), "how_to_reach", "לפתוח בשאלה קלה")
        self.assertTrue(diff["drastic"])
        self.assertIn("how_to_reach", diff["reasons"])

    def test_disagreement_with_an_active_sentence_is_a_contradiction(self) -> None:
        brain = _brain_with_block("what_frustrates", [_entry("טעויות מלחיצות", ["mastery.a", "activeness.b"])])
        diff = smi.preview(brain, "what_frustrates", "דווקא נהנה מטעויות", "טעויות מלחיצות")
        self.assertIn("contradicts", diff["reasons"])
        self.assertIn("strong_evidence", diff["reasons"])
        self.assertEqual(diff["contradicted"]["evidence_count"], 2)

    def test_cap_overflow_surfaces_the_displaced_sentence(self) -> None:
        entries = [_entry(f"משפט {i}", ["mastery.a", "mastery.b"] if i == 0 else ["x"]) for i in range(3)]
        brain = _brain_with_block("learning_preferences", entries)
        diff = smi.preview(brain, "learning_preferences", "משהו חדש לגמרי")
        self.assertIn("displaces", diff["reasons"])
        self.assertIn("strong_evidence", diff["reasons"])
        self.assertEqual(diff["displaced"]["text"], "משפט 0")

    def test_stale_disagrees_target_still_checks_displacement(self) -> None:
        entries = [_entry(f"משפט {i}", ["x"]) for i in range(3)]
        brain = _brain_with_block("learning_preferences", entries)
        diff = smi.preview(brain, "learning_preferences", "חדש", "משפט שכבר איננו")
        self.assertIsNone(diff["contradicted"])
        self.assertIn("displaces", diff["reasons"])


class AddInsightTest(unittest.IsolatedAsyncioTestCase):
    async def test_unconfirmed_drastic_change_is_refused_with_the_diff(self) -> None:
        with patch.object(smi, "get_brain", new=AsyncMock(return_value=_brain_with_block("how_to_reach", []))):
            with self.assertRaises(smi.DrasticChange) as caught:
                await smi.add_insight("kid", "teacher-1", block="how_to_reach", text="לפתוח בהומור")
        self.assertIn("how_to_reach", caught.exception.diff["reasons"])

    async def test_saved_insight_lands_in_both_structures_attributed(self) -> None:
        applied = AsyncMock()
        brain = _brain_with_block("learning_preferences", [])
        with (
            patch.object(smi, "get_brain", new=AsyncMock(return_value=brain)),
            patch("app.brain.context_engine.apply_brain_updates", new=applied),
        ):
            result = await smi.add_insight(
                "kid", "teacher-1", block="learning_preferences", text="לומד/ת טוב דרך ציור",
            )
        self.assertTrue(result["saved"])
        flat = applied.await_args.args[1]
        themes = flat["memory.themes"]
        self.assertEqual(themes[-1]["source_types"], ["teacher"])
        self.assertEqual(themes[-1]["confidence"], smi.TEACHER_CONFIDENCE)
        self.assertEqual(themes[-1]["status"], "active")
        entries = active_entries(flat["student_description.blocks.learning_preferences"])
        self.assertEqual(entries[-1]["evidence"], ["stated_by_teacher:teacher-1"])
        self.assertTrue(flat["student_description.stale"])

    async def test_detected_disagreement_contradicts_and_invalidates_without_deleting(self) -> None:
        applied = AsyncMock()
        memory, _theme, _ = upsert_theme(
            memory_defaults(), kind="challenge", value="טעויות מלחיצות",
            source="coach_chat", reference="chat:s1", confidence=0.8,
        )
        brain = _brain_with_block("what_frustrates", [_entry("טעויות מלחיצות", ["mastery.a"])])
        brain["memory"] = memory
        # The mini classifier says sentence 0 is the one being contradicted —
        # the teacher never labels the disagreement themselves.
        classified = AsyncMock(return_value=json.dumps({"contradicts": 0}))
        with (
            patch.object(smi, "get_brain", new=AsyncMock(return_value=brain)),
            patch("app.brain.context_engine.apply_brain_updates", new=applied),
            patch("app.services.llm.call_llm", new=classified),
        ):
            await smi.add_insight(
                "kid", "teacher-1", block="what_frustrates",
                text="טעויות דווקא מסקרנות אותו/ה", confirmed=True,
            )
        self.assertEqual(classified.await_count, 1)
        flat = applied.await_args.args[1]
        old_theme = flat["memory.themes"][0]
        self.assertEqual(old_theme["status"], "contradicted")
        self.assertIn("teacher", old_theme["source_types"])
        block = flat["student_description.blocks.what_frustrates"]
        superseded = [e for e in block if e.get("invalid_at")]
        self.assertEqual(len(superseded), 1)          # invalidated, still present
        self.assertEqual(len(active_entries(block)), 1)

    async def test_text_is_pii_scrubbed_before_any_write(self) -> None:
        applied = AsyncMock()
        with (
            patch.object(smi, "get_brain", new=AsyncMock(return_value=_brain_with_block("learning_preferences", []))),
            patch("app.brain.context_engine.apply_brain_updates", new=applied),
        ):
            await smi.add_insight(
                "kid", "teacher-1", block="learning_preferences",
                text="אפשר להתקשר לאמא 054-1234567 כשקשה",
            )
        flat = applied.await_args.args[1]
        stored = json.dumps(flat, ensure_ascii=False)
        self.assertNotIn("054-1234567", stored)

    async def test_writes_go_through_the_scope_gate(self) -> None:
        self.assertEqual(sorted(AGENT_VIEWS["teacher_voice"]["write"]), ["memory", "student_description"])
        with self.assertRaises(AgentScopeError):
            await apply_writes("teacher_voice", "kid", {"wellbeing_flags": []})

    async def test_invalid_block_and_empty_text_are_refused(self) -> None:
        with self.assertRaises(smi.InsightError):
            await smi.add_insight("kid", "t", block="nope", text="טקסט")
        with self.assertRaises(smi.InsightError):
            await smi.add_insight("kid", "t", block="how_to_reach", text=" ")

    async def test_classifier_failure_degrades_to_a_plain_addition(self) -> None:
        applied = AsyncMock()
        brain = _brain_with_block("learning_preferences", [_entry("קיים", ["x"])])
        with (
            patch.object(smi, "get_brain", new=AsyncMock(return_value=brain)),
            patch("app.brain.context_engine.apply_brain_updates", new=applied),
            patch("app.services.llm.call_llm", new=AsyncMock(side_effect=RuntimeError("down"))),
        ):
            result = await smi.add_insight(
                "kid", "teacher-1", block="learning_preferences", text="משהו חדש",
            )
        self.assertTrue(result["saved"])
        self.assertIsNone(result["contradicted"])

    async def test_confirmed_repost_applies_the_diff_the_teacher_read(self) -> None:
        smi._pending.clear()
        applied = AsyncMock()
        brain = _brain_with_block("what_frustrates", [_entry("טעויות מלחיצות", ["mastery.a"])])
        first = AsyncMock(return_value=json.dumps({"contradicts": 0}))
        with (
            patch.object(smi, "get_brain", new=AsyncMock(return_value=brain)),
            patch("app.brain.context_engine.apply_brain_updates", new=applied),
            patch("app.services.llm.call_llm", new=first),
        ):
            with self.assertRaises(smi.DrasticChange):
                await smi.add_insight(
                    "kid", "teacher-1", block="what_frustrates", text="טעויות מסקרנות",
                )
            # A re-roll on the confirm pass would let the classifier change its
            # mind between the warning and the save — the cache prevents it.
            with patch("app.services.llm.call_llm",
                       new=AsyncMock(side_effect=AssertionError("must not re-classify"))):
                result = await smi.add_insight(
                    "kid", "teacher-1", block="what_frustrates", text="טעויות מסקרנות",
                    confirmed=True,
                )
        self.assertTrue(result["saved"])
        self.assertEqual(result["contradicted"]["text"], "טעויות מלחיצות")


class WithdrawTest(unittest.IsolatedAsyncioTestCase):
    async def test_withdraw_restores_what_the_model_believed_beforehand(self) -> None:
        # A teacher insight replaced an inferred sentence and contradicted the
        # matching theme; the regret path must bring both back — bi-temporally.
        memory, _t, _ = upsert_theme(
            memory_defaults(), kind="challenge", value="טעויות מלחיצות",
            source="coach_chat", reference="chat:s1", confidence=0.8,
        )
        brain = _brain_with_block("what_frustrates", [_entry("טעויות מלחיצות", ["mastery.a"])])
        brain["memory"] = memory
        saved: dict = {}

        async def capture(_learner, flat):
            saved.update(flat)

        classified = AsyncMock(return_value=json.dumps({"contradicts": 0}))
        with (
            patch.object(smi, "get_brain", new=AsyncMock(return_value=brain)),
            patch("app.brain.context_engine.apply_brain_updates", new=AsyncMock(side_effect=capture)),
            patch("app.services.llm.call_llm", new=classified),
        ):
            await smi.add_insight(
                "kid", "teacher-1", block="what_frustrates",
                text="טעויות דווקא מסקרנות", confirmed=True,
            )

        after_add = {
            "student_description": {
                **description_defaults(),
                "blocks": {
                    **description_defaults()["blocks"],
                    "what_frustrates": saved["student_description.blocks.what_frustrates"],
                },
            },
            "memory": {**memory_defaults(), "themes": saved["memory.themes"]},
            "profile": {},
        }
        saved.clear()
        with (
            patch.object(smi, "get_brain", new=AsyncMock(return_value=after_add)),
            patch("app.brain.context_engine.apply_brain_updates", new=AsyncMock(side_effect=capture)),
        ):
            result = await smi.withdraw_insight(
                "kid", "teacher-1", block="what_frustrates", text="טעויות דווקא מסקרנות",
            )
        self.assertTrue(result["withdrawn"])
        self.assertEqual(result["restored"], 1)
        block = saved["student_description.blocks.what_frustrates"]
        active = active_entries(block)
        self.assertEqual([e["text"] for e in active], ["טעויות מלחיצות"])   # restored
        self.assertTrue(any(
            e.get("invalid_at") and "stated_by_teacher:teacher-1" in (e.get("evidence") or [])
            for e in block
        ))                                                                   # kept, invalidated
        themes = saved["memory.themes"]
        by_value = {t["value"]: t for t in themes}
        self.assertEqual(by_value["טעויות מלחיצות"]["status"], "active")     # un-contradicted
        self.assertEqual(by_value["טעויות דווקא מסקרנות"]["status"], "forgotten")

    async def test_withdrawing_an_unknown_or_inferred_sentence_is_refused(self) -> None:
        brain = _brain_with_block("what_frustrates", [_entry("משפט של המערכת", ["mastery.a"])])
        with patch.object(smi, "get_brain", new=AsyncMock(return_value=brain)):
            with self.assertRaises(smi.InsightError):
                await smi.withdraw_insight(
                    "kid", "teacher-1", block="what_frustrates", text="משפט של המערכת",
                )


class TeacherWeightTest(unittest.TestCase):
    def test_teacher_theme_does_not_decay_while_chat_theme_does(self) -> None:
        old = (datetime.now(timezone.utc) - timedelta(days=119)).isoformat()
        memory, _t, _ = upsert_theme(
            memory_defaults(), kind="preference", value="עבודה בשקט",
            source="teacher", reference="teacher_insight:t1", confidence=0.8, at=old,
        )
        memory, _t, _ = upsert_theme(
            memory, kind="preference", value="הסברים קצרים",
            source="coach_chat", reference="chat:s", confidence=0.8, at=old,
        )
        by_value = {t["value"]: t for t in active_themes(memory, minimum_confidence=0.0)}
        self.assertEqual(by_value["עבודה בשקט"]["retrieval_confidence"], 0.8)
        self.assertLess(by_value["הסברים קצרים"]["retrieval_confidence"], 0.8)

    def test_gather_evidence_separates_the_two_voices(self) -> None:
        memory, _t, _ = upsert_theme(
            memory_defaults(), kind="preference", value="עבודה בשקט",
            source="teacher", reference="teacher_insight:t1", confidence=0.8,
        )
        memory, _t, _ = upsert_theme(
            memory, kind="interest", value="כדורגל",
            source="coach_chat", reference="chat:s", confidence=0.9, explicit=True,
        )
        evidence = gather_evidence({"memory": memory, "profile": {}})
        self.assertEqual(evidence["stated_by_teacher"], ["memory.preference: עבודה בשקט"])
        self.assertEqual(evidence["stated_by_learner"], ["memory.interest: כדורגל"])


class AttributionSurvivesRewordingTest(unittest.TestCase):
    def test_update_op_carries_the_teacher_key_forward(self) -> None:
        """The regen rephrasing a teacher sentence must not strip its voice —
        chip, withdraw path and override bell all hang off that evidence key."""
        state = apply_ops(description_defaults(), [{
            "block": "learning_preferences", "action": "add",
            "text": "דוגמה מעולם הספורט", "evidence": ["stated_by_teacher:t1"],
        }])
        state = apply_ops(state, [{
            "block": "learning_preferences", "action": "update",
            "text": "נוח להתחיל בדוגמה מהספורט", "replaces": "דוגמה מעולם הספורט",
            "evidence": ["current_blocks.learning_preferences"],
        }])
        entry = active_entries(state["blocks"]["learning_preferences"])[-1]
        self.assertIn("stated_by_teacher:t1", entry["evidence"])
        self.assertIn("current_blocks.learning_preferences", entry["evidence"])


class OverrideBellTest(unittest.IsolatedAsyncioTestCase):
    async def test_notify_parses_the_author_from_the_evidence_key(self) -> None:
        sent = AsyncMock()
        with patch("app.services.notifications.notify", new=sent):
            await smi.notify_teacher_overridden(
                "kid", "עבודה בשקט", ["stated_by_teacher:teacher-9", "mastery.a"],
            )
        kwargs = sent.await_args.kwargs
        self.assertEqual(sent.await_args.args[0], "teacher-9")
        self.assertEqual(kwargs["recipient_role"], "teacher")
        self.assertEqual(kwargs["title_key"], "notif.modelOverride")
        self.assertEqual(kwargs["actions"][0]["route"], "/teacher/student/kid")

    async def test_regeneration_that_drops_a_teacher_sentence_rings_the_bell(self) -> None:
        from app.brain import description as description_module

        stored = description_defaults()
        stored = apply_ops(stored, [{
            "block": "learning_preferences", "action": "add",
            "text": "לומד/ת דרך ציור", "evidence": ["stated_by_teacher:teacher-3"],
        }])
        stored["stale"] = True
        brain = {
            "student_description": stored, "memory": memory_defaults(),
            "profile": {}, "current_state": {"pace": "steady"},
        }
        delete_op = {"ops": [{
            "block": "learning_preferences", "action": "delete",
            "replaces": "לומד/ת דרך ציור", "evidence": ["mastery.x"],
        }]}
        overridden = AsyncMock()
        with (
            patch("app.brain.repository.get_brain", new=AsyncMock(return_value=brain)),
            patch("app.brain.repository.apply_brain_updates", new=AsyncMock()),
            patch("app.services.llm.call_llm", new=AsyncMock(return_value=json.dumps(delete_op))),
            patch("app.services.student_model_insight.notify_teacher_overridden", new=overridden),
        ):
            await description_module.regenerate("kid")
        self.assertEqual(overridden.await_args.args[0], "kid")
        self.assertEqual(overridden.await_args.args[1], "לומד/ת דרך ציור")

    async def test_theme_override_reaches_every_asserting_teacher(self) -> None:
        theme = {
            "value": "עבודה בשקט",
            "evidence_refs": [
                {"source": "teacher", "ref": "teacher_insight:t1", "at": "x"},
                {"source": "coach_chat", "ref": "chat:s", "at": "x"},
            ],
        }
        sent = AsyncMock()
        with patch("app.services.notifications.notify", new=sent):
            await smi.notify_theme_overridden("kid", theme)
        self.assertEqual(sent.await_args.args[0], "t1")


if __name__ == "__main__":
    unittest.main()
