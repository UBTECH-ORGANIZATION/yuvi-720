"""Learning context pack: the bounded, PII-free description of ONE learning
component that a game is built around.

Built on the Yuvi side (from the Kata catalog snapshot, see
``backend/app/services/kata_client.normalize_component``) and shipped with the
job. Correct answers are kept in a separate ``answer_key`` that is used ONLY by
the headless validator and by server-side grading — it never enters the model
prompt and never ships in the served HTML.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field, asdict
from typing import Any, Iterable

MAX_QUESTIONS = 12
MAX_BOT_INFO_CHARS = 1800
MAX_QUESTION_CHARS = 400
MAX_ANSWER_CHARS = 160


@dataclass
class Question:
    id: str
    item_id: str
    type: str
    text: str
    answers: list[str] = field(default_factory=list)


@dataclass
class ContextPack:
    component_id: str
    component_title: str
    unit_id: str
    unit_title: str
    objective_id: str
    objective_title: str
    subject: str
    language: str = "he"
    grade_band: str = ""
    purpose: str = ""
    information_to_bot: str = ""
    questions: list[Question] = field(default_factory=list)
    device: str = "keyboard"  # keyboard | touch

    def to_prompt_json(self) -> str:
        """Compact JSON for the model prompt (no answer key)."""
        payload = {
            "component": {
                "id": self.component_id,
                "title": self.component_title,
                "purpose": self.purpose,
                "unit": self.unit_title,
                "objective": self.objective_title,
                "subject": self.subject,
                "grade_band": self.grade_band,
            },
            "language": self.language,
            "device": self.device,
            "teaching_notes": self.information_to_bot,
            "questions": [asdict(q) for q in self.questions],
        }
        return json.dumps(payload, ensure_ascii=False, indent=1)

    def to_learn_data(self) -> dict[str, Any]:
        """The object the serve-time harness exposes as ``window.__YUVI_LEARN_DATA``."""
        return {
            "component": {"id": self.component_id, "title": self.component_title},
            "objective": {"id": self.objective_id, "title": self.objective_title},
            "language": self.language,
            "questions": [asdict(q) for q in self.questions],
        }


@dataclass
class AnswerKey:
    """question_id -> accepted answers (verbatim strings). Server/validator only."""
    correct: dict[str, list[str]] = field(default_factory=dict)

    def to_json(self) -> str:
        return json.dumps(self.correct, ensure_ascii=False)


_WS = re.compile(r"\s+")


def _clean(text: Any, limit: int) -> str:
    return _WS.sub(" ", str(text or "")).strip()[:limit]


#: What a game can render: `choice` (buttons) or `text` (an input box).
DROPPED_TYPES = ("matching",)


def question_kind(row: dict[str, Any], answers: list[str], correct: list[str]) -> str | None:
    """`choice` needs at least one wrong option among the answers (a lone
    correct option is a give-away, and a dict-shaped answer is a drag item
    in disguise); anything else that has a key is typed by the kid."""
    qtype = str(row.get("questionType") or "choice")
    if qtype in DROPPED_TYPES or not correct:
        return None
    if any(a.startswith("{") for a in answers + correct):
        return None
    if qtype in ("choice", "true-false"):
        wrong = [a for a in answers if a not in correct]
        return "choice" if wrong else None
    return "text"


def _iter_question_rows(component: dict[str, Any]) -> Iterable[tuple[str, dict[str, Any]]]:
    by_item = component.get("questions_by_item") or {}
    for item_id, rows in by_item.items():
        for row in rows or []:
            if isinstance(row, dict) and row.get("questionId"):
                yield str(item_id), row


def build_context_pack(
    component: dict[str, Any],
    unit: dict[str, Any] | None = None,
    objective: dict[str, Any] | None = None,
    *,
    language: str = "he",
    device: str = "keyboard",
    max_questions: int = MAX_QUESTIONS,
    typed: bool = True,
) -> tuple[ContextPack, AnswerKey]:
    """Turn a normalized Kata component (+ unit + objective) into a pack and key.

    Only questions that have both text and at least one answer option are kept
    (open questions cannot be graded client-side or server-side without a key).
    """
    unit = unit or {}
    objective = objective or {}
    questions: list[Question] = []
    key = AnswerKey()
    for item_id, row in _iter_question_rows(component):
        text = _clean(row.get("questionText"), MAX_QUESTION_CHARS)
        answers = [_clean(a, MAX_ANSWER_CHARS) for a in (row.get("answers") or []) if _clean(a, MAX_ANSWER_CHARS)]
        correct = [_clean(a, MAX_ANSWER_CHARS) for a in (row.get("correctAnswers") or []) if _clean(a, MAX_ANSWER_CHARS)]
        qtype = question_kind(row, answers, correct)
        if not text or not correct or qtype is None or (qtype == "text" and not typed):
            continue
        # Kata question ids repeat across sub-content items ("q1" on every
        # screen), so the pack id is item-scoped; grading splits it on "#".
        qid = f"{item_id}#{row.get('questionId')}"
        questions.append(Question(
            id=qid,
            item_id=item_id,
            type=qtype,
            text=text,
            answers=answers if qtype == "choice" else [],
        ))
        key.correct[qid] = correct
        if len(questions) >= max_questions:
            break

    pack = ContextPack(
        component_id=str(component.get("id") or ""),
        component_title=_clean(component.get("title"), 200),
        unit_id=str(component.get("unit_id") or unit.get("id") or ""),
        unit_title=_clean(unit.get("title"), 200),
        objective_id=str(unit.get("objective_id") or objective.get("id") or ""),
        objective_title=_clean(objective.get("title"), 200),
        subject=str(unit.get("subject") or objective.get("subject") or ""),
        language=language,
        grade_band=str(unit.get("grade") or objective.get("grade") or ""),
        purpose=_clean(component.get("purpose"), 120),
        information_to_bot=_clean(component.get("information_to_bot"), MAX_BOT_INFO_CHARS),
        questions=questions,
        device=device,
    )
    return pack, key


def split_question_id(pack_id: str) -> tuple[str, str]:
    """``"item#q1"`` → ``("item", "q1")`` — the Kata item id and question id."""
    item_id, _, qid = str(pack_id).partition("#")
    return item_id, qid


def load_fixture(path: str, index: int = 0, **kwargs: Any) -> tuple[ContextPack, AnswerKey]:
    """Load ``fixtures/sample_components.json`` (written by the spike prep script)."""
    with open(path, encoding="utf-8") as fh:
        rows = json.load(fh)
    row = rows[index]
    return build_context_pack(row["component"], row.get("unit"), row.get("objective"), **kwargs)
