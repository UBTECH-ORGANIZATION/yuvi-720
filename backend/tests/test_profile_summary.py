"""Grounded Feature 2 profile summary and learner-verification checks."""

from __future__ import annotations

import json
import unittest
from unittest.mock import AsyncMock, patch

from app.brain.memory import memory_defaults, upsert_theme
from app.services.profile_summary import (
    apply_profile_feedback,
    build_profile_sources,
    generate_profile_summary,
)


def _brain() -> dict:
    memory, _theme, _changed = upsert_theme(
        memory_defaults(),
        kind="preference",
        value="דוגמאות חזותיות בצעדים קצרים",
        source="mapping_reflection",
        reference="reflection:part-2:visual",
        confidence=0.82,
        explicit=True,
    )
    return {
        "profile": {
            "learning_style": "למידה דרך המחשה",
            "preferences": ["צעדים קצרים"],
            "interests": [],
        },
        "memory": memory,
        "strengths": [{"label": "סקרנות והתמדה"}],
        "challenges": [{"label": "שמירה על ריכוז לאורך זמן"}],
    }


class ProfileSourceTests(unittest.TestCase):
    def test_sources_are_bounded_grounded_and_pii_redacted(self) -> None:
        brain = _brain()
        brain["profile"]["preferences"].insert(0, "כתבו אליי child@example.com")
        sources = build_profile_sources(brain, "he")

        self.assertLessEqual(len(sources), 6)
        self.assertTrue(all(source["source_id"] for source in sources))
        self.assertNotIn("child@example.com", str(sources))
        self.assertTrue(all(source["evidence_label"] for source in sources))

    def test_inaccurate_projected_claim_is_not_presented_again(self) -> None:
        brain = _brain()
        brain["strengths"][0]["learner_feedback"] = "inaccurate"
        sources = build_profile_sources(brain, "he")

        self.assertNotIn("סקרנות והתמדה", [source["value"] for source in sources])

    def test_feedback_lookup_keeps_disputed_and_inactive_source_ids(self) -> None:
        brain = _brain()
        visible = build_profile_sources(brain, "he")
        strength = next(source for source in visible if source["category"] == "strength")
        brain["strengths"][0]["learner_feedback"] = "inaccurate"
        brain["memory"]["themes"][0]["status"] = "contradicted"

        lookup = build_profile_sources(
            brain,
            "he",
            include_disputed=True,
            max_sources=None,
        )

        self.assertIn(strength["source_id"], {source["source_id"] for source in lookup})
        self.assertTrue(any(source["path"].startswith("memory.") for source in lookup))


class ProfileSummaryTests(unittest.IsolatedAsyncioTestCase):
    async def test_model_can_phrase_but_cannot_add_claims(self) -> None:
        brain = _brain()
        sources = build_profile_sources(brain, "he")
        allowed = sources[0]
        model_payload = {
            "hero_message": "חיברתי את מה שסיפרת לתמונה ראשונה.",
            "claims": [
                {
                    "source_id": allowed["source_id"],
                    "title": "כותרת מדויקת",
                    "description": "ניסוח שמסביר את המקור בלי להוסיף עובדה.",
                    "icon_key": "spark",
                },
                {
                    "source_id": "invented:unknown",
                    "title": "אוהב כדורגל",
                    "description": "תכונה שלא הופיעה במקורות.",
                    "icon_key": "interest",
                },
            ],
        }
        model = AsyncMock(return_value=json.dumps(model_payload, ensure_ascii=False))
        with (
            patch("app.services.profile_summary.get_brain", new=AsyncMock(return_value=brain)),
            patch("app.services.profile_summary.call_llm", new=model),
        ):
            summary = await generate_profile_summary("learner-pseudonym", "he")

        returned_ids = {claim["source_id"] for claim in summary["claims"]}
        self.assertEqual(returned_ids, {source["source_id"] for source in sources})
        self.assertNotIn("invented:unknown", returned_ids)
        self.assertNotIn("כדורגל", str(summary))
        model.assert_awaited_once()
        usage = model.await_args.kwargs["usage_context"]
        self.assertEqual(usage.endpoint, "/api/profile-summary")
        self.assertEqual(usage.feature, "feature_2_mapping")

    async def test_inaccurate_feedback_contradicts_memory_and_projection(self) -> None:
        brain = _brain()
        source = next(
            item for item in build_profile_sources(brain, "he")
            if item["category"] == "strength"
        )
        apply_updates = AsyncMock()
        with (
            patch("app.services.profile_summary.get_brain", new=AsyncMock(return_value=brain)),
            patch("app.services.profile_summary.apply_brain_updates", new=apply_updates),
        ):
            applied = await apply_profile_feedback(
                "learner-pseudonym",
                source["source_id"],
                "inaccurate",
                "he",
            )

        self.assertTrue(applied)
        updates = apply_updates.await_args.args[1]
        self.assertEqual(updates["strengths"][0]["learner_feedback"], "inaccurate")
        disputed = next(
            theme for theme in updates["memory"]["themes"]
            if theme["value"] == "סקרנות והתמדה"
        )
        self.assertEqual(disputed["status"], "contradicted")

    async def test_unsure_feedback_creates_open_question(self) -> None:
        brain = _brain()
        source = build_profile_sources(brain, "he")[0]
        apply_updates = AsyncMock()
        with (
            patch("app.services.profile_summary.get_brain", new=AsyncMock(return_value=brain)),
            patch("app.services.profile_summary.apply_brain_updates", new=apply_updates),
        ):
            applied = await apply_profile_feedback(
                "learner-pseudonym",
                source["source_id"],
                "unsure",
                "he",
            )

        self.assertTrue(applied)
        memory = apply_updates.await_args.args[1]["memory"]
        question = memory["open_questions"][-1]
        self.assertEqual(question["source_id"], source["source_id"])
        self.assertEqual(question["status"], "unsure")

    async def test_repeated_inaccurate_feedback_is_idempotent(self) -> None:
        brain = _brain()
        source = next(
            item for item in build_profile_sources(brain, "he")
            if item["category"] == "strength"
        )
        brain["strengths"][0]["learner_feedback"] = "inaccurate"
        apply_updates = AsyncMock()
        with (
            patch("app.services.profile_summary.get_brain", new=AsyncMock(return_value=brain)),
            patch("app.services.profile_summary.apply_brain_updates", new=apply_updates),
        ):
            applied = await apply_profile_feedback(
                "learner-pseudonym",
                source["source_id"],
                "inaccurate",
                "he",
            )

        self.assertTrue(applied)
        apply_updates.assert_awaited_once()


if __name__ == "__main__":
    unittest.main()
