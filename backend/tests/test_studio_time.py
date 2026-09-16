"""Regression tests for the Yuvi Studio hourly break limit."""

import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.services import studio_time


def test_studio_time_limit_defaults_to_twenty_minutes(monkeypatch):
    monkeypatch.delenv("STUDIO_TIME_LIMIT_SECONDS", raising=False)

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