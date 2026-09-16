"""Learning Game Lab: daily caps, the per-learner cost report, the job ledger.

Ported from Spark's ``app/services/games/budget.py`` plus the slice of
``app/services/games/store.py`` the admin console reads (Mongo path only).

Caps come from three layers, most specific first:

1. a learner row in ``learner_game_limits`` set by an admin,
2. the ``__defaults__`` row in the same collection (admin-set defaults),
3. the ``GAMES_DAILY_CREATE_CAP`` / ``GAMES_DAILY_EDIT_CAP`` env values
   (3 and 10 when unset).

Cost is what the worker measured: every job carries ``usage_summary.cost_usd``,
failed jobs included. Sparks are that cost in cents.
"""

from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from .org_repository import OrgRepository
from .users import UserRepository, public_user

GAMES = "learner_games"
JOBS = "learner_game_jobs"
LIMITS = "learner_game_limits"
LIMITS_DEFAULTS_ID = "__defaults__"

DEFAULT_CREATE_CAP = 3
DEFAULT_EDIT_CAP = 10
MAX_CAP = 1000
SPARKS_PER_USD = 100


class GameStoreError(Exception):
    """A refusal the caller may see. The message is a stable code."""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _day_start() -> str:
    """UTC midnight as an ISO string; ISO-8601 UTC timestamps compare as strings."""
    now = datetime.now(timezone.utc)
    return now.replace(hour=0, minute=0, second=0, microsecond=0).isoformat()


class GamesStore:
    """The console's reads and the caps writes on the ``learner_game_*`` collections."""

    def __init__(self, db: Any) -> None:
        self._db = db

    async def _find(
        self, collection: str, query: Dict[str, Any], *,
        sort: Optional[tuple] = None, limit: int = 5000,
    ) -> List[Dict[str, Any]]:
        cursor = self._db.collection(collection).find(query)
        if sort is not None:
            cursor = cursor.sort(*sort)
        return await cursor.limit(limit).to_list(length=limit)

    async def _find_one(self, collection: str, document_id: str) -> Optional[Dict[str, Any]]:
        return await self._db.collection(collection).find_one({"_id": document_id})

    async def _upsert(self, collection: str, document: Dict[str, Any]) -> Dict[str, Any]:
        await self._db.collection(collection).update_one(
            {"_id": document["_id"]}, {"$set": document}, upsert=True
        )
        return document

    async def _delete_one(self, collection: str, document_id: str) -> bool:
        result = await self._db.collection(collection).delete_one({"_id": document_id})
        return bool(result.deleted_count)

    # ── learner_game_limits ──────────────────────────────────────────────────

    async def get_limits(self, learner_id: str) -> Optional[Dict[str, Any]]:
        return await self._find_one(LIMITS, learner_id)

    async def list_limits(self) -> List[Dict[str, Any]]:
        return await self._find(LIMITS, {})

    async def set_limits(
        self, learner_id: str, *, create_per_day: int, edit_per_day: int,
        updated_by: str, note: str = "",
    ) -> Dict[str, Any]:
        if create_per_day < 0 or edit_per_day < 0:
            raise GameStoreError("bad_cap")
        return await self._upsert(LIMITS, {
            "_id": learner_id,
            "create_per_day": int(create_per_day),
            "edit_per_day": int(edit_per_day),
            "note": (note or "")[:200],
            "updated_by": updated_by,
            "updated_at": _now(),
        })

    async def clear_limits(self, learner_id: str) -> bool:
        return await self._delete_one(LIMITS, learner_id)

    # ── games + jobs (read only) ─────────────────────────────────────────────

    async def list_all_games(self, limit: int = 5000) -> List[Dict[str, Any]]:
        return await self._find(GAMES, {}, sort=("created_at", -1), limit=limit)

    async def list_all_jobs(self, limit: int = 10000) -> List[Dict[str, Any]]:
        return await self._find(JOBS, {}, sort=("created_at", -1), limit=limit)

    async def list_jobs_since(self, hours: int = 168, limit: int = 200) -> List[Dict[str, Any]]:
        """Every learner's jobs created in the last ``hours``, newest first."""
        since = (datetime.now(timezone.utc) - timedelta(hours=max(1, int(hours)))).isoformat()
        limit = max(1, min(int(limit), 1000))
        return await self._find(JOBS, {"created_at": {"$gte": since}},
                                sort=("created_at", -1), limit=limit)

    async def get_games(self, game_ids: List[str]) -> Dict[str, Dict[str, Any]]:
        """Rows by id, deleted included — one read for a report's title column."""
        ids = list(dict.fromkeys(str(game_id) for game_id in game_ids if game_id))
        if not ids:
            return {}
        rows = await self._find(GAMES, {"_id": {"$in": ids}}, limit=len(ids))
        return {str(row["_id"]): row for row in rows}


# ── caps ─────────────────────────────────────────────────────────────────────

def _env_cap(name: str, default: int) -> int:
    try:
        return max(0, int(os.environ.get(name) or default))
    except ValueError:
        return default


def env_caps() -> Dict[str, int]:
    return {
        "create_per_day": _env_cap("GAMES_DAILY_CREATE_CAP", DEFAULT_CREATE_CAP),
        "edit_per_day": _env_cap("GAMES_DAILY_EDIT_CAP", DEFAULT_EDIT_CAP),
    }


def _caps_from_row(row: Optional[Dict[str, Any]]) -> Optional[Dict[str, int]]:
    if not row:
        return None
    try:
        return {
            "create_per_day": max(0, int(row.get("create_per_day"))),
            "edit_per_day": max(0, int(row.get("edit_per_day"))),
        }
    except (TypeError, ValueError):
        return None


def _validate(create_per_day: int, edit_per_day: int) -> None:
    for value in (create_per_day, edit_per_day):
        if not isinstance(value, int) or value < 0 or value > MAX_CAP:
            raise GameStoreError("bad_cap")


def _cost(job: Dict[str, Any]) -> float:
    summary = job.get("usage_summary") or {}
    try:
        return float(summary.get("cost_usd") or 0.0)
    except (TypeError, ValueError):
        return 0.0


class GamesBudget:
    def __init__(self, store: GamesStore, users: UserRepository, org: OrgRepository) -> None:
        self.store = store
        self.users = users
        self.org = org

    async def default_caps(self) -> Dict[str, Any]:
        """Admin-set defaults when present, else the env values."""
        row = _caps_from_row(await self.store.get_limits(LIMITS_DEFAULTS_ID))
        if row:
            return {**row, "source": "admin"}
        return {**env_caps(), "source": "env"}

    async def effective_caps(self, learner_id: str) -> Dict[str, Any]:
        """What this learner may do today: override → defaults → env."""
        own = _caps_from_row(await self.store.get_limits(learner_id))
        if own:
            return {**own, "source": "learner"}
        return await self.default_caps()

    async def set_defaults(
        self, actor_id: str, *, create_per_day: int, edit_per_day: int
    ) -> Dict[str, Any]:
        _validate(create_per_day, edit_per_day)
        before = _caps_from_row(await self.store.get_limits(LIMITS_DEFAULTS_ID))
        await self.store.set_limits(
            LIMITS_DEFAULTS_ID, create_per_day=create_per_day,
            edit_per_day=edit_per_day, updated_by=actor_id,
        )
        after = await self.default_caps()
        await self.org.record_audit(
            actor_id=actor_id, action="set_game_limit_defaults", target_type="game_limits",
            target_id=LIMITS_DEFAULTS_ID, before=before, after=after,
        )
        return after

    async def set_learner_caps(
        self, actor_id: str, learner_id: str, *, create_per_day: int, edit_per_day: int,
        note: str = "",
    ) -> Dict[str, Any]:
        _validate(create_per_day, edit_per_day)
        before = await self.effective_caps(learner_id)
        await self.store.set_limits(
            learner_id, create_per_day=create_per_day, edit_per_day=edit_per_day,
            updated_by=actor_id, note=note,
        )
        after = await self.effective_caps(learner_id)
        await self.org.record_audit(
            actor_id=actor_id, action="set_game_limits", target_type="learner",
            target_id=learner_id, before=before, after=after, reason=note or None,
        )
        return after

    async def clear_learner_caps(self, actor_id: str, learner_id: str) -> Dict[str, Any]:
        before = await self.effective_caps(learner_id)
        if await self.store.clear_limits(learner_id):
            after = await self.effective_caps(learner_id)
            await self.org.record_audit(
                actor_id=actor_id, action="clear_game_limits", target_type="learner",
                target_id=learner_id, before=before, after=after,
            )
            return after
        return before

    # ── report ───────────────────────────────────────────────────────────────

    async def usage_report(self) -> Dict[str, Any]:
        """One row per learner who ever built a game: totals, today's counts
        against their caps, and where those caps come from."""
        games = await self.store.list_all_games()
        jobs = await self.store.list_all_jobs()
        overrides = {row["_id"]: row for row in await self.store.list_limits()}
        defaults = await self.default_caps()
        today = _day_start()

        rows: Dict[str, Dict[str, Any]] = {}

        def row_for(learner_id: str) -> Dict[str, Any]:
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

        # Learners with a cap override but no games yet still get a row: the
        # admin set something for them and must be able to see and undo it.
        for learner_id in overrides:
            if learner_id != LIMITS_DEFAULTS_ID:
                row_for(learner_id)

        learners = []
        for learner_id, entry in rows.items():
            if not learner_id:
                continue
            user = public_user(await self.users.get_user_by_id(learner_id)) or {}
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
