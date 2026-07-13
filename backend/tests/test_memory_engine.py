"""Learner Memory Engine v1: provenance, retrieval, privacy, and control."""

from __future__ import annotations

import unittest
import json
from unittest.mock import AsyncMock, patch

from app.brain.consolidator import capture_and_consolidate
from app.brain.context_engine import build_coach_bundle
from app.brain.memory import (
    active_themes,
    build_learner_portrait,
    classify_query_intent,
    contradict_theme_by_value,
    correct_theme,
    ensure_memory_state,
    forget_theme,
    memory_defaults,
    profile_answer_fallback,
    public_memory_projection,
    upsert_theme,
)


class LearnerMemoryTests(unittest.TestCase):
    def test_theme_reaffirmation_keeps_provenance_without_raw_quote(self) -> None:
        state, first, changed = upsert_theme(
            memory_defaults(),
            kind="preference",
            value="דוגמה חזותית לפני הסבר",
            source="coach_chat",
            reference="chat:thread:turn-1",
            confidence=0.72,
            explicit=True,
        )
        self.assertTrue(changed)
        self.assertIsNotNone(first)
        state, repeated, changed = upsert_theme(
            state,
            kind="preference",
            value="דוגמה חזותית לפני הסבר",
            source="mapping_reflection",
            reference="reflection:phase-2:visual",
            confidence=0.78,
            explicit=True,
        )
        self.assertTrue(changed)
        self.assertEqual(repeated["reaffirmations"], 2)
        self.assertEqual(set(repeated["source_types"]), {"coach_chat", "mapping_reflection"})
        self.assertEqual(len(repeated["evidence_refs"]), 2)
        self.assertNotIn("raw_quote", repeated)

    def test_learner_can_correct_and_forget_memory(self) -> None:
        state, theme, _ = upsert_theme(
            memory_defaults(),
            kind="interest",
            value="כדורגל",
            source="coach_chat",
            reference="chat:1:1",
            confidence=0.7,
        )
        state, corrected = correct_theme(state, theme["id"], "אסטרונומיה")
        self.assertEqual(corrected["value"], "אסטרונומיה")
        self.assertTrue(corrected["learner_confirmed"])
        state, changed = forget_theme(state, theme["id"])
        self.assertTrue(changed)
        self.assertEqual(active_themes(state), [])
        self.assertEqual(public_memory_projection({"memory": state})["themes"], [])

    def test_correction_contradicts_superseded_belief_with_evidence(self) -> None:
        state, old_theme, _ = upsert_theme(
            memory_defaults(),
            kind="preference",
            value="הסברים ארוכים",
            source="coach_chat",
            reference="chat:1:old",
            confidence=0.78,
        )
        state, contradicted = contradict_theme_by_value(
            state,
            "preference",
            "הסברים ארוכים",
            reference="chat:1:correction",
        )
        self.assertEqual(contradicted, [old_theme["id"]])
        self.assertEqual(state["themes"][0]["status"], "contradicted")
        self.assertEqual(state["themes"][0]["evidence_refs"][-1]["ref"], "chat:1:correction")
        self.assertEqual(active_themes(state), [])

    def test_pii_is_redacted_before_memory_storage(self) -> None:
        state, theme, _ = upsert_theme(
            memory_defaults(),
            kind="goal",
            value="Email me at child@example.com and practice fractions",
            source="coach_chat",
            reference="chat:1:2",
            confidence=0.8,
            explicit=True,
        )
        self.assertNotIn("child@example.com", theme["value"])

    def test_legacy_profile_migration_is_idempotent(self) -> None:
        brain = {
            "profile": {
                "interests": ["ציור"],
                "preferences": ["צעדים קצרים"],
                "source": "mapping",
                "updated_at": "2026-01-01T00:00:00+00:00",
            }
        }
        migrated, changed = ensure_memory_state(brain)
        self.assertTrue(changed)
        repeated, changed_again = ensure_memory_state(migrated)
        self.assertFalse(changed_again)
        self.assertEqual(repeated["memory"], migrated["memory"])

        interest = next(theme for theme in migrated["memory"]["themes"] if theme["kind"] == "interest")
        corrected_memory, _ = correct_theme(migrated["memory"], interest["id"], "אסטרונומיה")
        corrected_brain, _ = ensure_memory_state({**migrated, "memory": corrected_memory})
        active_interest_values = [
            theme["value"] for theme in active_themes(corrected_brain["memory"], {"interest"})
        ]
        self.assertEqual(active_interest_values, ["אסטרונומיה"])

        forgotten_memory, _ = forget_theme(corrected_brain["memory"], interest["id"])
        forgotten_brain, _ = ensure_memory_state({**migrated, "memory": forgotten_memory})
        self.assertEqual(active_themes(forgotten_brain["memory"], {"interest"}), [])

    def test_profile_answers_are_short_and_invite_correction(self) -> None:
        state, _theme, _ = upsert_theme(
            memory_defaults(),
            kind="preference",
            value="המחשה חזותית בצעדים קצרים",
            source="mapping_reflection",
            reference="reflection:1",
            confidence=0.8,
        )
        brain = {
            "profile": {},
            "memory": state,
            "strengths": [{"label": "סקרנות"}],
            "goals": [{"text": "לתרגל זוויות", "visible_to_learner": True, "status": "open"}],
        }
        portrait = build_learner_portrait(brain, "he")
        answer = profile_answer_fallback(portrait, "he")
        self.assertLessEqual(len([part for part in answer.split(".") if part.strip()]), 3)
        self.assertIn("לתקן", answer)
        self.assertNotIn("confidence", answer)

    def test_query_intent_prioritizes_memory_control(self) -> None:
        self.assertEqual(classify_query_intent("מה אתה יודע עליי?", "he"), "profile_question")
        self.assertEqual(classify_query_intent("מה למדת על דרך הלמידה שלי?", "he"), "profile_question")
        self.assertEqual(classify_query_intent("אל תזכור שאני אוהב כדורגל", "he"), "memory_forget")
        self.assertEqual(classify_query_intent("בעצם אני מעדיף דוגמאות", "he"), "memory_correct")


class QueryAwareContextTests(unittest.IsolatedAsyncioTestCase):
    async def test_profile_query_gets_portrait_but_not_evidence_internals(self) -> None:
        state, _theme, _ = upsert_theme(
            memory_defaults(),
            kind="interest",
            value="חלל",
            source="coach_chat",
            reference="chat:private-ref",
            confidence=0.8,
            explicit=True,
        )
        scoped = {
            "identity": {"locale": "he"},
            "profile": {},
            "memory": state,
            "strengths": [],
            "challenges": [],
            "strategies": [],
            "goals": [],
            "current_state": {},
            "teacher_directives": [],
        }
        with (
            patch("app.brain.context_engine.view_for", new=AsyncMock(return_value=scoped)),
            patch("app.services.events.get_recent_events", new=AsyncMock(return_value=[])),
        ):
            bundle = await build_coach_bundle(
                "learner-pseudonym",
                user_message="מה אתה יודע עליי?",
            )
        self.assertEqual(bundle["query_intent"], "profile_question")
        self.assertEqual(bundle["portrait"]["interests"], ["חלל"])
        self.assertNotIn("evidence_refs", str(bundle))
        self.assertNotIn("private-ref", str(bundle))


class MemoryConsolidationTests(unittest.IsolatedAsyncioTestCase):
    async def test_explicit_preference_becomes_evidence_backed_theme(self) -> None:
        apply_updates = AsyncMock()
        model_payload = {
            "candidates": [{
                "kind": "preference",
                "action": "upsert",
                "value": "דוגמאות חזותיות",
                "replaces_value": "הסברים ארוכים",
                "confidence": 0.82,
            }]
        }
        existing_memory, _old_theme, _ = upsert_theme(
            memory_defaults(),
            kind="preference",
            value="הסברים ארוכים",
            source="coach_chat",
            reference="chat:thread-1:old",
            confidence=0.78,
        )
        with (
            patch("app.brain.consolidator.call_llm", new=AsyncMock(return_value=json.dumps(model_payload))),
            patch(
                "app.brain.consolidator.get_brain",
                new=AsyncMock(return_value={"profile": {}, "memory": existing_memory}),
            ),
            patch("app.brain.consolidator.apply_brain_updates", new=apply_updates),
        ):
            changed = await capture_and_consolidate(
                "learner-pseudonym",
                "אני מעדיף דוגמאות חזותיות",
                "he",
                session_id="thread-1",
                exchange_id="turn-1",
            )

        self.assertEqual(changed, ["הסברים ארוכים", "דוגמאות חזותיות"])
        updates = apply_updates.await_args.args[1]
        old_theme, theme = updates["memory"]["themes"]
        self.assertEqual(old_theme["status"], "contradicted")
        self.assertEqual(theme["kind"], "preference")
        self.assertEqual(theme["evidence_refs"][0]["ref"], "chat:thread-1:turn-1")
        self.assertTrue(theme["learner_confirmed"])

    async def test_ordinary_learning_question_skips_memory_model(self) -> None:
        model = AsyncMock()
        with patch("app.brain.consolidator.call_llm", new=model):
            changed = await capture_and_consolidate(
                "learner-pseudonym",
                "איך פותרים את התרגיל?",
                "he",
            )
        self.assertEqual(changed, [])
        model.assert_not_awaited()


if __name__ == "__main__":
    unittest.main()
