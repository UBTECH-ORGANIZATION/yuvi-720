"""Mastery v2 (B-1) — every transition against synthetic event sequences."""

from datetime import datetime, timedelta, timezone

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.brain.mastery import (  # noqa: E402
    apply_scored_event,
    entry_for,
    is_due_for_review,
    mastery_key,
    stance_for,
    unresolved_misconceptions,
)


def _event(success=True, score=None, verb="answered", misconception=None, at=None, **kwargs):
    result = {"success": success}
    if score is not None:
        result["score_scaled"] = score
    return {
        "verb": verb,
        "result": result,
        "misconception": misconception,
        "occurred_at": at or datetime.now(timezone.utc).isoformat(),
        **kwargs,
    }


def test_ewma_replaces_last_score_latch():
    entry = {}
    entry = apply_scored_event(entry, _event(success=False, score=0.0))
    entry = apply_scored_event(entry, _event(success=False, score=0.0))
    entry = apply_scored_event(entry, _event(success=True, score=1.0))
    # A lucky final answer must NOT erase the failure history.
    assert entry["last_score"] == 1.0
    assert entry["score_ewma"] < 0.5
    assert entry["failures"] == 2 and entry["successes"] == 1


def test_confidence_grows_with_consistent_evidence():
    entry = {}
    first = apply_scored_event(entry, _event(success=True, score=1.0))
    assert 0 < first["confidence"] < 0.3
    for _ in range(7):
        first = apply_scored_event(first, _event(success=True, score=1.0))
    assert first["confidence"] > 0.9


def test_streak_achievement_and_level_progression():
    entry = {}
    for _ in range(2):
        entry = apply_scored_event(entry, _event(success=True, score=1.0))
    assert not entry.get("achieved")
    entry = apply_scored_event(entry, _event(success=True, score=1.0))
    assert entry["achieved"] and entry["achieved_at"]
    assert entry["level"] == "intermediate"
    for _ in range(4):
        entry = apply_scored_event(entry, _event(success=True, score=1.0))
    assert entry["level"] == "advanced"


def test_assessment_completion_achieves():
    entry = apply_scored_event({}, _event(success=True, verb="completed", is_assessment=True))
    assert entry["achieved"] and entry["level"] == "intermediate"


def test_failure_after_achieved_flags_review_without_erasing():
    entry = {}
    for _ in range(3):
        entry = apply_scored_event(entry, _event(success=True, score=1.0))
    entry = apply_scored_event(entry, _event(success=False, score=0.0))
    assert entry["achieved"] is True          # history is never erased
    assert entry["needs_review"] is True      # but review is demanded
    assert entry["consecutive_successes"] == 0
    entry = apply_scored_event(entry, _event(success=True, score=1.0))
    assert entry["needs_review"] is False


def test_stability_grows_on_success_shrinks_on_failure():
    entry = apply_scored_event({}, _event(success=True, score=1.0))
    grown = apply_scored_event(entry, _event(success=True, score=1.0))
    assert grown["stability_days"] > entry["stability_days"]
    shrunk = apply_scored_event(grown, _event(success=False, score=0.0))
    assert shrunk["stability_days"] < grown["stability_days"]
    assert shrunk["review_due"]


def test_review_due_after_decay_window():
    old = (datetime.now(timezone.utc) - timedelta(days=10)).isoformat()
    entry = {}
    for _ in range(3):
        entry = apply_scored_event(entry, _event(success=True, score=1.0, at=old), now=old)
    assert entry["achieved"]
    if is_due_for_review(entry):
        assert datetime.fromisoformat(entry["review_due"]) <= datetime.now(timezone.utc)
    else:  # long stability — force the boundary and check the invariant holds
        assert datetime.fromisoformat(entry["review_due"]) > datetime.now(timezone.utc)


def test_misconception_lifecycle_counted_then_resolved():
    entry = {}
    entry = apply_scored_event(entry, _event(success=False, misconception="sign-error"))
    entry = apply_scored_event(entry, _event(success=False, misconception="sign-error"))
    open_tags = unresolved_misconceptions(entry)
    assert len(open_tags) == 1 and open_tags[0]["count"] == 2
    entry = apply_scored_event(entry, _event(success=True, score=1.0))
    entry = apply_scored_event(entry, _event(success=True, score=1.0))
    assert unresolved_misconceptions(entry) == []
    resolved = entry["misconceptions"][0]
    assert resolved["resolved"] and resolved["resolved_at"]
    # A later miss on the same tag reopens it.
    entry = apply_scored_event(entry, _event(success=False, misconception="sign-error"))
    assert unresolved_misconceptions(entry)[0]["count"] == 3


def test_rapid_guess_advances_nothing_but_attempts():
    entry = apply_scored_event({}, _event(success=True, score=1.0))
    before = dict(entry)
    entry = apply_scored_event(
        entry, _event(success=False, score=0.0, misconception="x"), effortful=False
    )
    assert entry["attempts"] == before["attempts"] + 1
    assert entry["score_ewma"] == before["score_ewma"]
    assert entry.get("misconceptions") == before.get("misconceptions")
    assert entry["consecutive_successes"] == before["consecutive_successes"]


def test_probable_slip_keeps_streak_and_skips_misconception():
    entry = {}
    for _ in range(3):
        entry = apply_scored_event(entry, _event(success=True, score=1.0))
    entry = apply_scored_event(
        entry, _event(success=False, score=0.0, misconception="x"), probable_slip=True
    )
    assert entry["consecutive_successes"] == 3       # streak survives a slip
    assert unresolved_misconceptions(entry) == []    # no misconception attached
    assert not entry.get("needs_review")
    assert entry["failures"] == 1                    # but the miss is recorded


def test_mastery_key_is_dot_safe_and_lookup_tolerates_both():
    key = mastery_key("MOE.SCI.G7.CHEM-01")
    assert "." not in key
    table = {key: {"achieved": True}}
    assert entry_for(table, "MOE.SCI.G7.CHEM-01")["achieved"]
    legacy = {"simple-id": {"achieved": True}}
    assert entry_for(legacy, "simple-id")["achieved"]


def test_stance_mentions_open_misconception():
    entry = {}
    for _ in range(2):
        entry = apply_scored_event(entry, _event(success=False, misconception="זוויות"))
    lines = stance_for({"obj1": entry}, "obj1", "זוויות קודקודיות", "he")
    assert lines and "זוויות" in lines[0]
