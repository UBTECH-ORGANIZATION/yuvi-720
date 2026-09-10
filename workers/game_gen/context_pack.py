"""Learning context pack: the bounded, PII-free description of ONE learning
component a game is designed around.

The backend ships it in the job payload (``payload["context"]``) with a
one-paragraph ``learning_description`` written by the mini model. The model
designs freely from that paragraph; the game owns its own questions.

No answers exist anywhere in this package: no answer key, no question rows,
nothing to grade against. What reaches the served page is only the titles
and the language (``to_learn_data``).
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any

MAX_DESCRIPTION_CHARS = 1500

_WS = re.compile(r"\s+")
_EN_GRADE = re.compile(r"(\d{1,2})(?:st|nd|rd|th)?\s*grade", re.IGNORECASE)
_HE_GRADE = re.compile(r"כיתה\s+([א-ת]{1,2})")


def _clean(text: Any, limit: int) -> str:
    return _WS.sub(" ", str(text or "")).strip()[:limit]


def grade_from_curriculum_title(title: Any) -> str:
    """``"8th Grade Science"`` → ``"8"``; ``"מדעים כיתה ח"`` → ``"ח"``; else the title (40 chars)."""
    text = _clean(title, 200)
    m = _EN_GRADE.search(text)
    if m:
        return m.group(1)
    m = _HE_GRADE.search(text)
    if m:
        return m.group(1)
    return text[:40]


@dataclass
class ContextPack:
    component_id: str = ""
    component_title: str = ""
    unit_id: str = ""
    unit_title: str = ""
    objective_id: str = ""
    objective_title: str = ""
    subject: str = ""
    grade: str = ""
    purpose: str = ""
    learning_description: str = ""
    language: str = "he"
    device: str = "keyboard"  # keyboard | touch

    def to_prompt_json(self) -> str:
        """Compact JSON for the model prompt."""
        payload = {
            "component": {
                "id": self.component_id,
                "title": self.component_title,
                "purpose": self.purpose,
                "unit": self.unit_title,
                "objective": self.objective_title,
                "subject": self.subject,
                "grade": self.grade,
            },
            "language": self.language,
            "device": self.device,
            "learning_description": self.learning_description,
        }
        return json.dumps(payload, ensure_ascii=False, indent=1)

    def to_learn_data(self) -> dict[str, Any]:
        """The object the serve-time harness exposes as ``window.__YUVI_LEARN_DATA``."""
        return {
            "component": {"id": self.component_id, "title": self.component_title},
            "objective": {"id": self.objective_id, "title": self.objective_title},
            "language": self.language,
        }


def build_context_pack(context: dict[str, Any] | None, *, language: str = "he", device: str = "keyboard") -> ContextPack:
    """Turn the job payload's ``context`` into a pack. Every key is optional."""
    context = context or {}
    component = context.get("component") or {}
    unit = context.get("unit") or {}
    objective = context.get("objective") or {}
    return ContextPack(
        component_id=str(component.get("id") or ""),
        component_title=_clean(component.get("title"), 200),
        unit_id=str(unit.get("id") or component.get("unit_id") or ""),
        unit_title=_clean(unit.get("title"), 200),
        objective_id=str(objective.get("id") or unit.get("objective_id") or ""),
        objective_title=_clean(objective.get("title"), 200),
        subject=str(unit.get("subject") or objective.get("subject") or ""),
        grade=grade_from_curriculum_title(objective.get("curriculum_title") or unit.get("grade") or objective.get("grade") or ""),
        purpose=_clean(component.get("purpose"), 120),
        learning_description=_clean(context.get("learning_description"), MAX_DESCRIPTION_CHARS),
        language=str(language or "he"),
        device=str(device or "keyboard"),
    )


__all__ = ["ContextPack", "MAX_DESCRIPTION_CHARS", "build_context_pack", "grade_from_curriculum_title"]
