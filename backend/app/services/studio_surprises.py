"""One teacher-approved, goal-linked Studio surprise per learner and ISO week."""

from __future__ import annotations

import json
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Optional

from app.brain.repository import _get_collection_named
from app.services.weekly_digest import week_key
from learner_state import normalize_learner_id  # type: ignore

COLLECTION = "weekly_studio_surprises"
_FALLBACK = Path(__file__).resolve().parents[2] / ".runtime" / "weekly_studio_surprises.json"

# These ids are deliberately private to the Studio surprise catalog, never the
# room shop. The frontend receives one only once the teacher-approved reveal is due.
REWARD_KINDS = (
    "surprise_arcade", "surprise_garden", "surprise_basketball", "surprise_football",
    "surprise_volleyball", "surprise_racket", "surprise_goalie_gloves", "surprise_sneakers",
    "surprise_gaming_chair", "surprise_console", "surprise_observatory", "surprise_music_poster",
)


class SurpriseClaimError(ValueError):
    """A learner tried to collect a surprise that is not ready yet."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _record_id(learner_id: str, week: str) -> str:
    return f"{learner_id}:{week}"


def _read_fallback() -> list[dict[str, Any]]:
    try:
        return json.loads(_FALLBACK.read_text(encoding="utf-8")) if _FALLBACK.exists() else []
    except (OSError, json.JSONDecodeError):
        return []


def _write_fallback(rows: list[dict[str, Any]]) -> None:
    try:
        _FALLBACK.parent.mkdir(parents=True, exist_ok=True)
        _FALLBACK.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
    except OSError as exc:  # pragma: no cover - local fallback only
        print(f"weekly Studio surprise fallback write failed: {type(exc).__name__}")


def _deadline(raw: object) -> Optional[date]:
    try:
        return date.fromisoformat(str(raw))
    except (TypeError, ValueError):
        return None


async def _candidate(learner_id: str) -> Optional[dict[str, str]]:
    from app.services import mentoring

    candidates: list[tuple[date, str, dict[str, Any], dict[str, Any]]] = []
    for conversation in await mentoring._raw_conversations(learner_id):
        if conversation.get("visibility", "shared") != "shared":
            continue
        mentoring._ensure_goals(conversation)
        for goal in mentoring._active_goals(conversation):
            deadline = _deadline(goal.get("deadline"))
            if goal.get("status") == "open" and deadline and goal.get("id"):
                candidates.append((deadline, str(goal["id"]), conversation, goal))
    if not candidates:
        return None
    _, _, conversation, goal = min(candidates, key=lambda row: (row[0], row[1]))
    return {
        "conversation_id": str(conversation.get("id") or ""),
        "goal_id": str(goal["id"]),
        "goal_title": str(goal.get("title") or goal.get("next_steps") or ""),
    }


async def _approved_candidate(learner_id: str, conversation_id: str, goal_id: str) -> Optional[dict[str, str]]:
    """Recover the goal title after approval has closed it before Studio opens."""
    from app.services import mentoring

    for conversation in await mentoring._raw_conversations(learner_id):
        if conversation.get("visibility", "shared") != "shared" or str(conversation.get("id") or "") != conversation_id:
            continue
        mentoring._ensure_goals(conversation)
        for goal in conversation.get("goals", []):
            if isinstance(goal, dict) and str(goal.get("id") or "") == goal_id:
                return {
                    "conversation_id": conversation_id,
                    "goal_id": goal_id,
                    "goal_title": str(goal.get("title") or goal.get("next_steps") or ""),
                }
    return None


def _reward_kind(learner_id: str, week: str) -> str:
    # Stable rotation avoids both random reloads and a new persistence query.
    return REWARD_KINDS[sum(map(ord, f"{learner_id}:{week}")) % len(REWARD_KINDS)]


async def _load(record_id: str) -> Optional[dict[str, Any]]:
    collection = _get_collection_named(COLLECTION)
    if collection is not None:
        try:
            record = await collection.find_one({"_id": record_id})
            if record:
                record.pop("_id", None)
            return record
        except Exception as exc:  # pragma: no cover - fallback preserves the demo
            print(f"weekly Studio surprise read failed: {type(exc).__name__}")
    return next((row for row in _read_fallback() if row.get("id") == record_id), None)


async def _create(record: dict[str, Any]) -> dict[str, Any]:
    collection = _get_collection_named(COLLECTION)
    if collection is not None:
        try:
            await collection.update_one({"_id": record["id"]}, {"$setOnInsert": {"_id": record["id"], **record}}, upsert=True)
            stored = await collection.find_one({"_id": record["id"]})
            if stored:
                stored.pop("_id", None)
                return stored
        except Exception as exc:  # pragma: no cover
            print(f"weekly Studio surprise write failed: {type(exc).__name__}")
    rows = _read_fallback()
    existing = next((row for row in rows if row.get("id") == record["id"]), None)
    if existing:
        return existing
    rows.append(record)
    _write_fallback(rows)
    return record


async def get_weekly_surprise(learner_id: str, moment: Optional[datetime] = None) -> dict[str, Any]:
    """Get or reserve this week's covered surprise; never exposes its reward early."""
    lid = normalize_learner_id(learner_id)
    week = week_key(moment)
    record_id = _record_id(lid, week)
    record = await _load(record_id)
    if record is None:
        candidate = await _candidate(lid)
        if candidate is None:
            return {"available": False, "week": week}
        record = await _create({
            "id": record_id, "learner_id": lid, "week": week, **candidate,
            "reward_kind": _reward_kind(lid, week), "state": "covered", "created_at": _now(),
        })
    state = record.get("state", "covered")
    if state == "claimed":
        return {"available": False, "week": week, "state": "claimed"}
    # `revealed` is the durable internal approval state. The client calls it
    # `ready`: the box can now draw attention, but never reveals its contents.
    return {
        "available": True,
        "week": week,
        "state": "ready" if state == "revealed" else "covered",
        "goal": {"title": record.get("goal_title", "")},
    }


async def claim_weekly_surprise(learner_id: str, moment: Optional[datetime] = None) -> dict[str, Any]:
    """Collect this week's approved surprise exactly once and reveal its item."""
    lid = normalize_learner_id(learner_id)
    week = week_key(moment)
    record_id = _record_id(lid, week)
    record = await _load(record_id)
    if record is None:
        raise SurpriseClaimError("not_found")
    if record.get("state") == "claimed":
        return {"week": week, "state": "claimed", "reward_kind": record.get("reward_kind")}
    if record.get("state") != "revealed":
        raise SurpriseClaimError("not_ready")

    claimed_at = _now()
    collection = _get_collection_named(COLLECTION)
    if collection is not None:
        try:
            await collection.update_one(
                {"_id": record_id, "state": "revealed"},
                {"$set": {"state": "claimed", "claimed_at": claimed_at}},
            )
            stored = await collection.find_one({"_id": record_id})
            if stored:
                record = stored
        except Exception as exc:  # pragma: no cover - fallback preserves the demo
            print(f"weekly Studio surprise claim failed: {type(exc).__name__}")
        else:
            return {"week": week, "state": "claimed", "reward_kind": record.get("reward_kind")}

    rows = _read_fallback()
    for row in rows:
        if row.get("id") == record_id:
            row.update({"state": "claimed", "claimed_at": claimed_at})
            _write_fallback(rows)
            return {"week": week, "state": "claimed", "reward_kind": row.get("reward_kind")}
    raise SurpriseClaimError("not_found")


async def claimed_reward_kinds(learner_id: str) -> list[str]:
    """Return each collected private prop once, in stable catalog order."""
    lid = normalize_learner_id(learner_id)
    rows: list[dict[str, Any]] = []
    collection = _get_collection_named(COLLECTION)
    if collection is not None:
        try:
            rows = await collection.find(
                {"learner_id": lid, "state": "claimed"}, {"reward_kind": 1}
            ).to_list(length=len(REWARD_KINDS))
        except Exception as exc:  # pragma: no cover - fallback preserves the demo
            print(f"weekly Studio surprise reward list failed: {type(exc).__name__}")
    if not rows:
        rows = [row for row in _read_fallback() if row.get("learner_id") == lid and row.get("state") == "claimed"]
    owned = {str(row.get("reward_kind")) for row in rows}
    return [kind for kind in REWARD_KINDS if kind in owned]


async def reveal_approved_goal(learner_id: str, conversation_id: str, goal_id: str) -> None:
    """Reveal this week's matching surprise, reserving it if approval came first."""
    lid = normalize_learner_id(learner_id)
    record_id = _record_id(lid, week_key())
    record = await _load(record_id)
    if record is None:
        candidate = await _approved_candidate(lid, conversation_id, goal_id)
        if candidate is None:
            return
        record = await _create({
            "id": record_id, "learner_id": lid, "week": week_key(), **candidate,
            "reward_kind": _reward_kind(lid, week_key()), "state": "revealed", "created_at": _now(), "revealed_at": _now(),
        })
    if record.get("conversation_id") != conversation_id or record.get("goal_id") != goal_id:
        return
    if record.get("state") == "revealed":
        return
    record["state"] = "revealed"
    record["revealed_at"] = _now()
    collection = _get_collection_named(COLLECTION)
    if collection is not None:
        try:
            await collection.update_one({"_id": record_id, "state": {"$ne": "revealed"}}, {"$set": {"state": "revealed", "revealed_at": record["revealed_at"]}})
            return
        except Exception as exc:  # pragma: no cover
            print(f"weekly Studio surprise reveal failed: {type(exc).__name__}")
    rows = _read_fallback()
    for row in rows:
        if row.get("id") == record_id:
            row.update(record)
            _write_fallback(rows)
            return


async def can_hold_reward(learner_id: str, kind: str) -> bool:
    """Whether this learner owns a revealed private Studio furniture kind."""
    if kind not in REWARD_KINDS:
        return False
    lid = normalize_learner_id(learner_id)
    collection = _get_collection_named(COLLECTION)
    if collection is not None:
        try:
            return bool(await collection.find_one({"learner_id": lid, "reward_kind": kind, "state": "claimed"}, {"_id": 1}))
        except Exception as exc:  # pragma: no cover
            print(f"weekly Studio surprise entitlement read failed: {type(exc).__name__}")
    return any(row.get("learner_id") == lid and row.get("reward_kind") == kind and row.get("state") == "claimed" for row in _read_fallback())


async def ensure_indexes() -> None:
    collection = _get_collection_named(COLLECTION)
    if collection is not None:
        await collection.create_index([("learner_id", 1), ("week", 1)], unique=True)