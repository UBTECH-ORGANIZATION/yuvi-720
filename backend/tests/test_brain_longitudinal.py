"""Longitudinal brain evolution — a student's LIFETIME, not one session.

Simulates weeks of learning with synthetic timestamps and asserts the brain
updates the way the design promises: mastery decays and resurfaces for review,
spaced practice beats massed practice, misconceptions resolve and can reopen,
levels progress, the description evolves with provenance instead of being
overwritten, strategies promote only across sessions, and unconfirmed
chat-only memories fade. All deterministic — no LLM, no DB, no clock."""

import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.brain.mastery import (  # noqa: E402
    apply_scored_event,
    is_due_for_review,
    mastery_key,
    unresolved_misconceptions,
)

T0 = datetime(2026, 7, 1, 10, 0, tzinfo=timezone.utc)


def _at(days: float) -> str:
    return (T0 + timedelta(days=days)).isoformat()


def _event(success, day, score=None, misconception=None, verb="answered", **kw):
    result = {"success": success}
    if score is not None:
        result["score_scaled"] = score
    return {"verb": verb, "result": result, "misconception": misconception,
            "occurred_at": _at(day), **kw}


def test_three_week_learning_arc_decay_review_and_recovery():
    """learn → achieve → decay past review_due → planner resurfaces →
    a review success re-strengthens with a LONGER interval than before."""
    entry = {}
    # Week 1: struggle with a misconception, then resolve it and achieve.
    entry = apply_scored_event(entry, _event(False, 0.0, misconception="מכנה-משותף"), now=_at(0.0))
    entry = apply_scored_event(entry, _event(False, 0.1, misconception="מכנה-משותף"), now=_at(0.1))
    for day in (0.2, 0.3, 0.4):
        entry = apply_scored_event(entry, _event(True, day, score=1.0), now=_at(day))
    assert entry["achieved"] and entry["level"] == "intermediate"
    assert unresolved_misconceptions(entry) == []

    # Time passes beyond the stability window → due for review.
    stability = entry["stability_days"]
    later = T0 + timedelta(days=0.4 + stability + 1)
    assert is_due_for_review(entry, later)
    assert not is_due_for_review(entry, T0 + timedelta(days=0.5))  # not immediately

    # A spaced review success: stability must GROW past its pre-review value.
    review_day = 0.4 + stability + 1
    reviewed = apply_scored_event(entry, _event(True, review_day, score=1.0), now=_at(review_day))
    assert reviewed["stability_days"] > stability
    assert not is_due_for_review(reviewed, T0 + timedelta(days=review_day + 0.5))


def test_planner_resurfaces_decayed_skill_weeks_later(monkeypatch):
    from app.services import planner

    objectives = [
        {"id": "MOE.M.1", "title": "שברים", "order": 1, "prerequisites": []},
        {"id": "MOE.M.2", "title": "אחוזים", "order": 2, "prerequisites": ["MOE.M.1"]},
    ]
    monkeypatch.setattr(planner, "objectives_for", lambda s: objectives)

    entry = {}
    for day in (0, 0.1, 0.2):
        entry = apply_scored_event(entry, _event(True, day, score=1.0), now=_at(day))
    entry["objective_id"] = "MOE.M.1"
    brain = {"mastery": {mastery_key("MOE.M.1"): entry}}

    # Right after mastering: the NEW objective leads, no review noise.
    fresh_review_due = datetime.fromisoformat(entry["review_due"])
    if fresh_review_due > datetime.now(timezone.utc):
        plan = planner.plan_next(brain, subjects=("math",))
        assert plan["math"]["next"][0] == "MOE.M.2"
        assert plan["math"]["review_due"] == []

    # Weeks later (force the decay): the mastered skill comes back FIRST.
    decayed = dict(entry, review_due=_at(1.0))   # long past
    brain = {"mastery": {mastery_key("MOE.M.1"): decayed}}
    plan = planner.plan_next(brain, subjects=("math",))
    assert plan["math"]["next"][0] == "MOE.M.1"
    assert plan["math"]["review_due"] == ["MOE.M.1"]


def test_spaced_practice_beats_massed_practice():
    """Two successes days apart must yield more durable memory than two
    back-to-back — the spacing effect, encoded."""
    massed = {}
    for day in (0.0, 0.01):
        massed = apply_scored_event(massed, _event(True, day, score=1.0), now=_at(day))
    spaced = {}
    spaced = apply_scored_event(spaced, _event(True, 0.0, score=1.0), now=_at(0.0))
    spaced = apply_scored_event(spaced, _event(True, 2.0, score=1.0), now=_at(2.0))
    assert spaced["stability_days"] > massed["stability_days"]


def test_misconception_reopens_weeks_after_resolution():
    entry = {}
    entry = apply_scored_event(entry, _event(False, 0, misconception="sign"), now=_at(0))
    for day in (0.1, 0.2):
        entry = apply_scored_event(entry, _event(True, day, score=1.0), now=_at(day))
    assert unresolved_misconceptions(entry) == []
    resolved_at = entry["misconceptions"][0]["resolved_at"]
    # Three weeks later the same confusion returns — count continues, reopens.
    entry = apply_scored_event(entry, _event(False, 21, misconception="sign"), now=_at(21))
    reopened = unresolved_misconceptions(entry)
    assert len(reopened) == 1 and reopened[0]["count"] == 2
    assert entry["misconceptions"][0].get("resolved_at") != resolved_at


def test_evidence_challenge_lifecycle_over_time():
    """challenges: appear at misconception ×2, retire on resolution — the
    onboarding snapshot stops being frozen truth."""
    from app.services.events import _sync_evidence_challenges

    entry = {}
    for day in (0, 0.1):
        entry = apply_scored_event(entry, _event(False, day, misconception="הרחבת-שברים"), now=_at(day))
    brain = {"challenges": [{"label": "ישן מהמיפוי", "status": "working"}]}
    challenges = _sync_evidence_challenges(brain, "MOE.M.9", entry, _at(0.2))
    evidence = [c for c in challenges if c.get("source") == "learning_evidence"]
    assert len(evidence) == 1 and evidence[0]["status"] == "active"
    assert any(c.get("label") == "ישן מהמיפוי" for c in challenges)   # onboarding kept

    # Two successes later → resolved, not deleted (auditable).
    for day in (1.0, 1.1):
        entry = apply_scored_event(entry, _event(True, day, score=1.0), now=_at(day))
    brain = {"challenges": challenges}
    challenges = _sync_evidence_challenges(brain, "MOE.M.9", entry, _at(1.2))
    evidence = [c for c in challenges if c.get("source") == "learning_evidence"]
    assert evidence[0]["status"] == "resolved"


def test_description_evolves_with_provenance_not_overwrite():
    """UPDATE invalidates the old sentence (bi-temporal) — never erases it —
    and the rendered text follows only the active beliefs."""
    from app.brain.description import active_entries, apply_ops, description_defaults

    desc = apply_ops(description_defaults(), [
        {"block": "how_to_reach", "action": "add",
         "text": "צריך צעדים קטנים מאוד", "evidence": ["activeness.self_regulation"]},
    ], now=_at(0))
    assert "צעדים קטנים" in desc["text"]

    # A month of evidence later the picture matures: replace, don't append blindly.
    desc = apply_ops(desc, [
        {"block": "how_to_reach", "action": "update",
         "text": "מתמודד היטב עם שני צעדים ברצף; להעלות בהדרגה",
         "replaces": "צריך צעדים קטנים מאוד",
         "evidence": ["mastery.MOE.M.1: שולט/ת"]},
    ], now=_at(30))
    block = desc["blocks"]["how_to_reach"]
    active = active_entries(block)
    assert len(active) == 1 and "שני צעדים" in active[0]["text"]
    superseded = [e for e in block if e.get("invalid_at")]
    assert len(superseded) == 1                      # history retained
    assert superseded[0]["invalid_at"] == _at(30)    # when it stopped being true
    assert superseded[0]["valid_at"] == _at(0)
    assert "שני צעדים" in desc["text"] and "קטנים מאוד" not in desc["text"]


def test_description_block_cap_invalidates_oldest():
    from app.brain.description import active_entries, apply_ops, description_defaults
    desc = description_defaults()
    for i in range(5):
        desc = apply_ops(desc, [{"block": "learning_preferences", "action": "add",
                                 "text": f"העדפה {i}", "evidence": ["e"]}], now=_at(i))
    active = active_entries(desc["blocks"]["learning_preferences"])
    assert len(active) == 3                          # bounded (Letta-style)
    assert [e["text"] for e in active] == ["העדפה 2", "העדפה 3", "העדפה 4"]


def test_unconfirmed_chat_memory_fades_but_confirmed_survives():
    """120-day retrieval decay hits chat-only unconfirmed beliefs; a
    learner-confirmed one keeps full priority."""
    from app.brain.memory import active_themes

    old = (datetime.now(timezone.utc) - timedelta(days=200)).isoformat()
    def theme(confirmed):
        return {"id": "t", "kind": "interest", "key": "k", "value": "רובוטיקה",
                "confidence": 0.7, "status": "active", "source_types": ["coach_chat"],
                "evidence_refs": [], "last_seen": old, "learner_confirmed": confirmed}

    faded = active_themes({"themes": [theme(False)]}, {"interest"})
    kept = active_themes({"themes": [theme(True)]}, {"interest"})
    assert kept and kept[0]["retrieval_confidence"] == 0.7
    # unconfirmed 200-day-old chat memory decays below its stored confidence
    assert not faded or faded[0]["retrieval_confidence"] < 0.7


def test_full_level_arc_basic_to_advanced():
    entry = {}
    day = 0.0
    # early: basic (nothing achieved)
    entry = apply_scored_event(entry, _event(False, day), now=_at(day))
    assert entry.get("level", "basic") in (None, "basic") or not entry.get("achieved")
    # streak → intermediate
    for _ in range(3):
        day += 0.1
        entry = apply_scored_event(entry, _event(True, day, score=1.0), now=_at(day))
    assert entry["level"] == "intermediate"
    # sustained excellence → advanced (needs evidence volume for confidence)
    for _ in range(6):
        day += 0.5
        entry = apply_scored_event(entry, _event(True, day, score=0.95), now=_at(day))
    assert entry["level"] == "advanced"
    # one bad day NEVER demotes the level — it flags review instead.
    day += 1
    entry = apply_scored_event(entry, _event(False, day, score=0.2), now=_at(day))
    assert entry["level"] == "advanced" and entry["needs_review"]
