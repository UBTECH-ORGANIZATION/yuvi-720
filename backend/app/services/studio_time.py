"""Server-authoritative time budget for learner visits to Yuvi Studio."""

from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from learner_state import get_learner_state, update_learner_state


DEFAULT_STUDIO_TIME_LIMIT_SECONDS = 20 * 60
STUDIO_TIMEZONE = ZoneInfo("Asia/Jerusalem")


def studio_time_limit_seconds() -> int:
    """Return the per-hour Studio allowance configured for this deployment."""
    raw = (os.environ.get("STUDIO_TIME_LIMIT_SECONDS") or "").strip()
    if not raw:
        return DEFAULT_STUDIO_TIME_LIMIT_SECONDS
    try:
        limit = int(raw)
    except ValueError as exc:
        raise ValueError("STUDIO_TIME_LIMIT_SECONDS must be a positive integer") from exc
    if limit <= 0:
        raise ValueError("STUDIO_TIME_LIMIT_SECONDS must be a positive integer")
    return limit


def _hour_key(now: datetime) -> str:
    return now.astimezone(STUDIO_TIMEZONE).strftime("%Y-%m-%dT%H:00:00%z")


def _parse_time(value: object) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)
    except ValueError:
        return None


def _state_for_now(saved: object, now: datetime) -> dict:
    limit = studio_time_limit_seconds()
    hour = _hour_key(now)
    data = saved if isinstance(saved, dict) else {}
    if data.get("hour") != hour:
        return {"hour": hour, "used_seconds": 0, "active_started_at": None}
    return {
        "hour": hour,
        "used_seconds": max(0, min(limit, int(data.get("used_seconds") or 0))),
        "active_started_at": data.get("active_started_at") if isinstance(data.get("active_started_at"), str) else None,
    }


def _apply_elapsed(data: dict, now: datetime) -> dict:
    limit = studio_time_limit_seconds()
    started = _parse_time(data.get("active_started_at"))
    if started:
        elapsed = max(0, int((now - started).total_seconds()))
        data["used_seconds"] = min(limit, data["used_seconds"] + elapsed)
    data["active_started_at"] = None
    return data


def _response(data: dict, now: datetime) -> dict:
    limit = studio_time_limit_seconds()
    used = data["used_seconds"]
    started = _parse_time(data.get("active_started_at"))
    if started:
        used = min(limit, used + max(0, int((now - started).total_seconds())))
    remaining = max(0, limit - used)
    local_now = now.astimezone(STUDIO_TIMEZONE)
    next_hour = local_now.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)
    return {
        "allowed": remaining > 0,
        "remaining_seconds": remaining,
        "available_at": next_hour.astimezone(timezone.utc).isoformat(),
    }


async def studio_time_status(learner_id: str) -> dict:
    state = await get_learner_state(learner_id)
    now = datetime.now(timezone.utc)
    data = _state_for_now(state.get("studio_time"), now)
    return _response(data, now)


async def enter_studio(learner_id: str) -> dict:
    now = datetime.now(timezone.utc)
    state = await get_learner_state(learner_id)
    data = _apply_elapsed(_state_for_now(state.get("studio_time"), now), now)
    response = _response(data, now)
    if response["allowed"]:
        data["active_started_at"] = now.isoformat()
        response = _response(data, now)
    await update_learner_state(learner_id, {"studio_time": data})
    return response


async def leave_studio(learner_id: str) -> dict:
    now = datetime.now(timezone.utc)
    state = await get_learner_state(learner_id)
    data = _apply_elapsed(_state_for_now(state.get("studio_time"), now), now)
    await update_learner_state(learner_id, {"studio_time": data})
    return _response(data, now)