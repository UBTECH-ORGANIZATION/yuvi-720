"""Daily game caps and the per-learner cost report (admin control plane).

Caps come from three layers, most specific first:

1. a learner row in ``learner_game_limits`` set by an admin,
2. the ``__defaults__`` row in the same collection (admin-set defaults),
3. the ``GAMES_DAILY_CREATE_CAP`` / ``GAMES_DAILY_EDIT_CAP`` env values
   (3 and 10 when unset).

Cost is what the worker measured: every job carries ``usage_summary.cost_usd``
estimated from the Copilot SDK billing prices, failed jobs included, because a
failed build spent the money too. Sparks are that cost in cents, the same
number the learner sees on a card.
"""

from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any, Optional

from app.auth.repository import get_user_by_id, public_user
from app.services import org_repository
from app.services.games import store

DEFAULT_CREATE_CAP = 3
DEFAULT_EDIT_CAP = 10
MAX_CAP = 1000
SPARKS_PER_USD = 100


def _env_cap(name: str, default: int) -> int:
    try:
        return max(0, int(os.environ.get(name) or default))
    except ValueError:
        return default


def env_caps() -> dict[str, int]:
    return {
        "create_per_day": _env_cap("GAMES_DAILY_CREATE_CAP", DEFAULT_CREATE_CAP),
        "edit_per_day": _env_cap("GAMES_DAILY_EDIT_CAP", DEFAULT_EDIT_CAP),
    }


def _caps_from_row(row: Optional[dict[str, Any]]) -> Optional[dict[str, int]]:
    if not row:
        return None
    try:
        return {
            "create_per_day": max(0, int(row.get("create_per_day"))),
            "edit_per_day": max(0, int(row.get("edit_per_day"))),
        }
    except (TypeError, ValueError):
        return None


async def default_caps() -> dict[str, Any]:
    """Admin-set defaults when present, else the env values."""
    row = _caps_from_row(await store.get_limits(store.LIMITS_DEFAULTS_ID))
    if row:
        return {**row, "source": "admin"}
    return {**env_caps(), "source": "env"}


async def effective_caps(learner_id: str) -> dict[str, Any]:
    """What this learner may do today: override → defaults → env."""
    own = _caps_from_row(await store.get_limits(learner_id))
    if own:
        return {**own, "source": "learner"}
    return await default_caps()


def _validate(create_per_day: int, edit_per_day: int) -> None:
    for value in (create_per_day, edit_per_day):
        if not isinstance(value, int) or value < 0 or value > MAX_CAP:
            raise store.GameStoreError("bad_cap")


async def set_defaults(actor_id: str, *, create_per_day: int, edit_per_day: int) -> dict[str, Any]:
    _validate(create_per_day, edit_per_day)
    before = _caps_from_row(await store.get_limits(store.LIMITS_DEFAULTS_ID))
    await store.set_limits(
        store.LIMITS_DEFAULTS_ID, create_per_day=create_per_day,
        edit_per_day=edit_per_day, updated_by=actor_id,
    )
    after = await default_caps()
    await org_repository.record_audit(
        actor_id=actor_id, action="set_game_limit_defaults", target_type="game_limits",
        target_id=store.LIMITS_DEFAULTS_ID, before=before, after=after,
    )
    return after


async def set_learner_caps(
    actor_id: str, learner_id: str, *, create_per_day: int, edit_per_day: int, note: str = "",
) -> dict[str, Any]:
    _validate(create_per_day, edit_per_day)
    before = await effective_caps(learner_id)
    await store.set_limits(
        learner_id, create_per_day=create_per_day, edit_per_day=edit_per_day,
        updated_by=actor_id, note=note,
    )
    after = await effective_caps(learner_id)
    await org_repository.record_audit(
        actor_id=actor_id, action="set_game_limits", target_type="learner",
        target_id=learner_id, before=before, after=after, reason=note or None,
    )
    return after


async def clear_learner_caps(actor_id: str, learner_id: str) -> dict[str, Any]:
    before = await effective_caps(learner_id)
    if await store.clear_limits(learner_id):
        after = await effective_caps(learner_id)
        await org_repository.record_audit(
            actor_id=actor_id, action="clear_game_limits", target_type="learner",
            target_id=learner_id, before=before, after=after,
        )
        return after
    return before


# ── report ───────────────────────────────────────────────────────────────────

def _cost(job: dict[str, Any]) -> float:
    summary = job.get("usage_summary") or {}
    try:
        return float(summary.get("cost_usd") or 0.0)
    except (TypeError, ValueError):
        return 0.0


def _day_start() -> str:
    now = datetime.now(timezone.utc)
    return now.replace(hour=0, minute=0, second=0, microsecond=0).isoformat()


async def usage_report() -> dict[str, Any]:
    """One row per learner who ever built a game: totals, today's counts
    against their caps, and where those caps come from."""
    games = await store.list_all_games()
    jobs = await store.list_all_jobs()
    overrides = {row["_id"]: row for row in await store.list_limits()}
    defaults = await default_caps()
    today = _day_start()

    rows: dict[str, dict[str, Any]] = {}

    def row_for(learner_id: str) -> dict[str, Any]:
        entry = rows.get(learner_id)
        if entry is None:
            entry = rows[learner_id] = {
                "learner_id": learner_id, "display_name": None, "username": None,
                "games": 0, "games_deleted": 0, "jobs": 0, "jobs_failed": 0,
                "cost_usd": 0.0, "cost_today_usd": 0.0,
                "creates_today": 0, "edits_today": 0, "last_activity": None,
            }
        return entry

    for game in games:
        entry = row_for(str(game.get("learner_id") or ""))
        if game.get("deleted_at"):
            entry["games_deleted"] += 1
        else:
            entry["games"] += 1
        if str(game.get("created_at") or "") >= today:
            entry["creates_today"] += 1

    for job in jobs:
        entry = row_for(str(job.get("learner_id") or ""))
        entry["jobs"] += 1
        if job.get("status") == "failed":
            entry["jobs_failed"] += 1
        cost = _cost(job)
        entry["cost_usd"] += cost
        created = str(job.get("created_at") or "")
        if created >= today:
            entry["cost_today_usd"] += cost
            if job.get("kind") == "edit":
                entry["edits_today"] += 1
        if created and (entry["last_activity"] is None or created > entry["last_activity"]):
            entry["last_activity"] = created

    # Learners with a cap override but no games yet still get a row: the admin
    # set something for them and must be able to see and undo it.
    for learner_id in overrides:
        if learner_id != store.LIMITS_DEFAULTS_ID:
            row_for(learner_id)

    learners = []
    for learner_id, entry in rows.items():
        if not learner_id:
            continue
        user = public_user(await get_user_by_id(learner_id)) or {}
        entry["display_name"] = user.get("display_name")
        entry["username"] = user.get("username")
        own = _caps_from_row(overrides.get(learner_id))
        entry["caps"] = {**own, "source": "learner"} if own else {**defaults}
        entry["note"] = (overrides.get(learner_id) or {}).get("note") or ""
        entry["cost_usd"] = round(entry["cost_usd"], 4)
        entry["cost_today_usd"] = round(entry["cost_today_usd"], 4)
        entry["sparks"] = int(round(entry["cost_usd"] * SPARKS_PER_USD))
        learners.append(entry)
    learners.sort(key=lambda item: (-item["cost_usd"], item["learner_id"]))

    totals = {
        "learners": len(learners),
        "games": sum(item["games"] for item in learners),
        "jobs": sum(item["jobs"] for item in learners),
        "jobs_failed": sum(item["jobs_failed"] for item in learners),
        "cost_usd": round(sum(item["cost_usd"] for item in learners), 4),
        "cost_today_usd": round(sum(item["cost_today_usd"] for item in learners), 4),
        "creates_today": sum(item["creates_today"] for item in learners),
    }
    return {"defaults": defaults, "env": env_caps(), "totals": totals, "learners": learners}
