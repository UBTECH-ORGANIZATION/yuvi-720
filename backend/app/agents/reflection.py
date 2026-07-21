"""Reflection Agent — self-awareness (F4 competency) + meta-cognition (§5.3).

Prompts the learner to reflect after a hard task / at intervals, and stores the
answer with a self vs system estimate. The full log lives in the `reflections`
collection; the brain embeds only the recent window (`reflections_recent`, R2).
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from app.brain.context_engine import apply_writes
from app.brain.repository import _get_collection_named, get_brain

REFLECTION_PROMPTS = {
    "hard_task": {
        "he": "אחרי המשימה הזו — מה הרגיש הכי מאתגר, ומה עזר לך להתקדם?",
        "ar": "بعد هذه المهمة — ما الذي شعرت أنه الأصعب، وما الذي ساعدك على التقدّم؟",
        "en": "After this task — what felt hardest, and what helped you move forward?",
    },
    "interval": {
        "he": "מה למדת על עצמך כלומד/ת השבוע?",
        "ar": "ما الذي تعلمته عن نفسك كمتعلّم/ة هذا الأسبوع؟",
        "en": "What did you learn about yourself as a learner this week?",
    },
}
_MAX_RECENT = 8


def get_prompt(language: str = "he", kind: str = "hard_task") -> dict[str, str]:
    table = REFLECTION_PROMPTS.get(kind, REFLECTION_PROMPTS["hard_task"])
    return {"prompt_id": kind, "text": table.get(language) or table["he"]}


async def store_reflection(
    learner_id: str,
    prompt_id: str,
    answer: str,
    self_rating: Optional[int] = None,
    system_estimate: Optional[float] = None,
) -> dict[str, Any]:
    """Persist a reflection (full log + recent window) with self vs system estimate."""
    entry = {
        "prompt_id": prompt_id,
        "answer": (answer or "").strip(),
        "self_rating": self_rating,
        "system_estimate": system_estimate,
        "at": datetime.now(timezone.utc).isoformat(),
    }

    # Full log → reflections collection (append-only).
    collection = _get_collection_named("reflections")
    if collection is not None:
        try:
            await collection.insert_one({**entry, "learner_id": learner_id})
        except Exception as exc:
            print(f"⚠️ reflections write failed: {exc}")

    # Recent window → brain (capped projection, R2).
    brain = await get_brain(learner_id)
    recent = list(brain.get("reflections_recent") or [])
    recent.append(entry)
    recent = recent[-_MAX_RECENT:]
    await apply_writes("reflection", learner_id, {"reflections_recent": recent})

    # A completed reflection is meaningful evidence — refresh the description
    # lazily on the next context build (system lane, not the agent scope).
    try:
        from app.brain.repository import apply_brain_operators
        await apply_brain_operators(learner_id, {"student_description.stale": True})
    except Exception:
        pass
    return entry
