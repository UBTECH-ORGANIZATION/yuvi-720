"""Question instances: what a game actually asks, one fresh draw per ``next()``.

The served game holds no questions. Each ``next()`` reaches the backend
(through the parent bridge), which picks the next usable blueprint of the
component in a per-run shuffled cycle, instantiates it with a seed derived
from the run, renders the figure and stores the answer in
``game_question_instances``. ``grade`` compares against that row. The kid's
page therefore never carries a key, and a replay asks different questions
about the same skills.

Ids are ``qi-…``; the legacy grader keeps handling ``item#question`` ids of
games built before blueprints. Answers are attributed to the blueprint (its
skill), not to a catalog question: blueprints are written from the learning
profile, not from the Kata rows.
"""

from __future__ import annotations

import hashlib
import random
import re
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from app.brain.repository import _get_collection_named
from app.services.games import blueprint_dsl as dsl
from app.services.games import blueprints, store

COLLECTION = "game_question_instances"
ID_PREFIX = "qi-"
TTL = timedelta(hours=48)
_WS = re.compile(r"\s+")
# Hebrew points/cantillation and Arabic tashkeel: a kid who types with or
# without them typed the same word.
_DIACRITICS = re.compile(r"[֑-ׇؐ-ًؚ-ٰٟۖ-ۭ]")
# A comma separates values ("(4,3)", "3, 5"); only a dot is a decimal point.
_NUMBER = re.compile(r"-?\d+(?:\.\d+)?")
_ARABIC_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹", "01234567890123456789")


class InstanceError(Exception):
    """Stable code the route may show."""


def is_instance_id(question_id: Any) -> bool:
    return str(question_id or "").startswith(ID_PREFIX)


# ── normalisation ────────────────────────────────────────────────────────────

def normalize(value: Any) -> str:
    """Text the way it is compared: whitespace collapsed, case folded, no
    diacritics, ASCII digits, and numeric content reduced to its numbers so
    ``(4, 3)`` = ``(4,3)`` and ``4.0`` = ``4``."""
    text = str(value if value is not None else "").translate(_ARABIC_DIGITS)
    text = _DIACRITICS.sub("", text)
    text = _WS.sub(" ", text).strip().casefold()
    numbers = _NUMBER.findall(text)
    letters = re.sub(r"[\s\d.,()\[\]{}:;\-–—+×x*/=]+", "", text)
    if numbers and not letters:
        cleaned = []
        for n in numbers:
            try:
                f = float(n)
            except ValueError:
                cleaned.append(n)
                continue
            cleaned.append(str(int(f)) if f.is_integer() else f"{f:g}")
        return "#" + ",".join(cleaned)
    return text.replace("־", "-").replace("’", "'").replace("'", "").replace('"', "")


def matches(answer: Any, accept: list[str]) -> bool:
    given = normalize(answer)
    return bool(given) and any(given == normalize(a) for a in accept)


# ── picking ──────────────────────────────────────────────────────────────────

def _order(run_id: str, count: int) -> list[int]:
    order = list(range(count))
    random.Random(f"order:{run_id}").shuffle(order)
    return order


def _seed(run_id: str, index: int) -> str:
    return hashlib.sha1(f"{run_id}:{index}".encode("utf-8")).hexdigest()[:16]


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def _store_row(row: dict[str, Any]) -> None:
    handle = _get_collection_named(COLLECTION)
    if handle is None:
        store._memory_instances[row["_id"]] = row  # type: ignore[attr-defined]
        return
    await handle.replace_one({"_id": row["_id"]}, row, upsert=True)


async def _load_row(instance_id: str) -> Optional[dict[str, Any]]:
    handle = _get_collection_named(COLLECTION)
    if handle is None:
        return store._memory_instances.get(instance_id)  # type: ignore[attr-defined]
    return await handle.find_one({"_id": instance_id})


async def next_instance(game: dict[str, Any], *, run_id: str, index: int,
                        docs: Optional[list[dict[str, Any]]] = None) -> Optional[dict[str, Any]]:
    """The question at ``index`` of run ``run_id``, or None past the end.
    Deterministic for a (run, index) pair, so a game that asks twice for the
    same index (a retry after a dropped frame) gets the same question."""
    usable = blueprints.usable(docs if docs is not None else await blueprints.cached_for_component(str(game.get("component_id") or "")))
    total = int(game.get("question_total") or blueprints.run_total(len(usable)))
    if not usable or index < 0 or index >= total:
        return None
    order = _order(run_id, len(usable))
    doc = usable[order[index % len(usable)]]
    seed = _seed(run_id, index)
    theme = game.get("theme_vocab") if isinstance(game.get("theme_vocab"), dict) else None
    try:
        inst = dsl.instantiate(doc["blueprint"], seed, theme)
    except dsl.DslError as exc:
        raise InstanceError(f"blueprint_failed:{exc}") from None
    digest = hashlib.sha1(f"{game.get('_id')}:{run_id}:{index}".encode("utf-8")).hexdigest()[:12]
    instance_id = f"{ID_PREFIX}{digest}{secrets.token_hex(2)}"
    public = blueprints.public_instance(inst, instance_id, index, total)
    await _store_row({
        "_id": instance_id, "game_id": str(game.get("_id") or ""), "learner_id": str(game.get("learner_id") or ""),
        "run_id": run_id, "index": index, "blueprint_id": doc["_id"], "skill": doc.get("skill"),
        "interaction": inst["interaction"],
        "answer": inst["answer"], "accept": list(inst["accept"]), "options": list(inst["options"]),
        "created_at": _now().isoformat(), "expires_at": (_now() + TTL).isoformat(),
    })
    return public


# ── grading ──────────────────────────────────────────────────────────────────

def answer_text(row: dict[str, Any], answer: Any) -> Optional[str]:
    if isinstance(answer, bool) or answer is None:
        return None
    if isinstance(answer, int):
        options = row.get("options") or []
        return str(options[answer]) if 0 <= answer < len(options) else None
    return str(answer)


async def grade(game: dict[str, Any], instance_id: str, answer: Any,
                *, latency_ms: Optional[int] = None) -> dict[str, Any]:
    row = await _load_row(str(instance_id))
    if not row or str(row.get("game_id") or "") != str(game.get("_id") or ""):
        raise InstanceError("unknown_question")
    chosen = answer_text(row, answer)
    correct = chosen is not None and matches(chosen, list(row.get("accept") or [row.get("answer")]))
    await store.record_answer(
        game_id=str(game["_id"]), learner_id=str(game["learner_id"]),
        question_id=str(row.get("blueprint_id") or instance_id), item_id="",
        component_id=str(game.get("component_id") or ""), correct=correct, latency_ms=latency_ms,
        blueprint_id=str(row.get("blueprint_id") or ""), instance_id=str(instance_id),
    )
    return {"correct": correct, "correct_answer": None if correct else str(row.get("answer") or "")}
