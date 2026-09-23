"""Regression tests for the Yuvi Studio hourly break limit."""

import sys
import asyncio
from unittest.mock import AsyncMock
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest

from app.services import studio_time


@pytest.fixture(autouse=True)
def _default_allowance(monkeypatch):
    """The app loads `backend/.env` on import, so a developer's own
    `STUDIO_TIME_LIMIT_SECONDS` would reach these tests; every one of them
    reasons about the twenty-minute default."""
    monkeypatch.delenv("STUDIO_TIME_LIMIT_SECONDS", raising=False)


def test_studio_time_limit_defaults_to_twenty_minutes():
    assert studio_time.studio_time_limit_seconds() == 20 * 60


def test_studio_time_limit_uses_the_environment_value(monkeypatch):
    monkeypatch.setenv("STUDIO_TIME_LIMIT_SECONDS", "900")

    assert studio_time.studio_time_limit_seconds() == 900


def test_remaining_time_is_preserved_within_the_same_hour():
    now = datetime(2026, 9, 9, 12, 30, tzinfo=timezone.utc)
    saved = {
        "hour": "2026-09-09T15:00:00+0300",
        "used_seconds": 8 * 60,
        "active_started_at": None,
    }

    assert studio_time._response(studio_time._state_for_now(saved, now), now)["remaining_seconds"] == 12 * 60


def test_hour_change_resets_the_full_twenty_minute_allowance():
    now = datetime(2026, 9, 9, 13, 0, tzinfo=timezone.utc)
    saved = {
        "hour": "2026-09-09T15:00:00+0300",
        "used_seconds": studio_time.DEFAULT_STUDIO_TIME_LIMIT_SECONDS,
        "active_started_at": None,
    }

    reset = studio_time._state_for_now(saved, now)

    assert studio_time._response(reset, now)["allowed"] is True
    assert studio_time._response(reset, now)["remaining_seconds"] == studio_time.DEFAULT_STUDIO_TIME_LIMIT_SECONDS


def test_active_time_cannot_exceed_the_twenty_minute_cap():
    now = datetime(2026, 9, 9, 12, 30, tzinfo=timezone.utc)
    active = {
        "hour": "2026-09-09T12:00:00Z",
        "used_seconds": 19 * 60 + 59,
        "active_started_at": "2026-09-09T12:00:00+00:00",
    }

    stopped = studio_time._apply_elapsed(active, now)

    assert stopped["used_seconds"] == studio_time.DEFAULT_STUDIO_TIME_LIMIT_SECONDS
    assert studio_time._response(stopped, now)["allowed"] is False


@pytest.mark.parametrize("environment,enabled", [("dev", True), ("local", True), ("production", False), ("english", False)])
def test_debug_expiry_is_only_available_in_development(monkeypatch, environment, enabled):
    monkeypatch.setenv("SPARK_ENVIRONMENT", environment)
    monkeypatch.delenv("ENVIRONMENT", raising=False)
    assert studio_time.studio_time_debug_enabled() is enabled


def test_debug_expiry_updates_only_active_learner_time(monkeypatch):
    monkeypatch.setenv("SPARK_ENVIRONMENT", "dev")
    monkeypatch.delenv("ENVIRONMENT", raising=False)
    now = datetime.now(timezone.utc)
    read = AsyncMock(return_value={"room": {"introDone": True}, "studio_time": {
        "hour": studio_time._hour_key(now), "used_seconds": 5, "active_started_at": now.isoformat(),
    }})
    write = AsyncMock()
    monkeypatch.setattr(studio_time, "get_learner_state", read)
    monkeypatch.setattr(studio_time, "update_learner_state", write)
    response = asyncio.run(studio_time.expire_studio_time("learner"))
    assert response["remaining_seconds"] == 0
    assert response["allowed"] is False
    learner, updates = write.await_args.args
    assert learner == "learner"
    assert set(updates) == {"studio_time"}
    assert updates["studio_time"]["active_started_at"] is None


@pytest.mark.parametrize("production", [True, False])
def test_expire_endpoint_rejects_production_and_inactive_sessions(monkeypatch, production):
    from fastapi import HTTPException
    from app.routes.studio_time import post_studio_expire

    monkeypatch.setenv("SPARK_ENVIRONMENT", "production" if production else "dev")
    monkeypatch.delenv("ENVIRONMENT", raising=False)
    read = AsyncMock(return_value={})
    write = AsyncMock()
    monkeypatch.setattr(studio_time, "get_learner_state", read)
    monkeypatch.setattr(studio_time, "update_learner_state", write)
    with pytest.raises(HTTPException) as error:
        asyncio.run(post_studio_expire("learner"))
    assert error.value.status_code == (404 if production else 409)
    write.assert_not_awaited()
    if production:
        read.assert_not_awaited()