"""One deterministic state per student for the teacher dashboard (#450).

Every student carries exactly one band — ``red`` / ``orange`` / ``green`` —
computed by fixed rules over evidence the platform already stores. **No model
call anywhere in this path**: a band is a claim about a child, and it must be
the same claim on every reload, explainable line by line.

The contract:
  - RED means "needs the teacher today" — any one wellbeing, stuck-in-learning,
    disengagement or waiting-on-you signal fires it.
  - GREEN means "positive evidence of thriving" — never the absence of bad news.
  - ORANGE is everything else, INCLUDING a child with no evidence at all
    ("אין מספיק נתונים"): silence is not distress and not thriving.
  - Every band carries ``reasons`` — ``[{signal, evidence}]`` — because the
    dialog behind the face must show the teacher exactly why (MoE C4).
  - Bands are rendered per child with evidence, never as a ranking (C5), and
    they are TEACHER-FACING ONLY: no student ever sees their own band.
  - A heavy check-in feeling makes a child red ON THE DASHBOARD but raises no
    alert — deliberately, echoing the check-in's own design decision that a
    feeling is a conversation opener, not an alarm (see insights.py). Band
    changes never notify either; the screen is the whole delivery.

Struggle threshold: this module adopts ``learning_path``'s tested cut
(``_STRUGGLE_SCORE`` = 0.4 EWMA) so the band and the learning-path planner can
never disagree about who is struggling. The other three thresholds in the
codebase measure different quantities and deliberately stay: group gaps' 0.6 is
an EWMA cut for OBJECTIVE-level class gaps, and learning_analytics' 0.5/0.6 are
raw success RATES per learning / per question.
"""

from __future__ import annotations

import time
from datetime import datetime, timezone
from typing import Any, Optional

from app.services import learning_path

# The attention flags that mean "needs the teacher today". `slow_progress` is
# deliberately absent — taking long on questions is a watch signal, not a red
# one, and it is already visible in the timing columns.
_RED_ATTENTION_KINDS = {
    "wellbeing": "wellbeing_distress",
    "inactivity": "days_inactive",
    "low_success": "fail_streak",
    "rapid_guessing": "rapid_guessing",
    "wheel_spinning": "wheel_spinning",
    "overdue_goal": "overdue_goal",
    "help_requested": "help_requested",
}

# GREEN thresholds come from learning_path so the two judgements agree.
_GREEN_EWMA = learning_path._CONFIDENT_SCORE          # 0.75
_GREEN_CONFIDENCE = learning_path._CONFIDENT_CONF     # 0.5
_GREEN_STREAK = learning_path._CONFIDENT_STREAK       # 3
# The mastery `level` never demotes (mastery.py), so level alone must never be
# green — it is re-checked against CURRENT evidence, the same stricter pattern
# `learning_path._may_skip_optional` uses instead of trusting `band_for` raw.
_LEVEL_RECHECK_EWMA = 0.6
_SUBJECT_STRONG_PERCENT = 80
_RECENT_MASTERY_DAYS = 7

# Week-over-week improvement (the optional trends upgrade for orange students):
# this week's success rate beats last week's by a real margin, on enough
# attempts that the margin is not one lucky answer.
_IMPROVE_MIN_ATTEMPTS = 5
_IMPROVE_MIN_PRIOR_ATTEMPTS = 3
_IMPROVE_RATE_DELTA = 0.15


def _days_since(stamp: Any) -> Optional[float]:
    if not stamp:
        return None
    try:
        parsed = datetime.fromisoformat(str(stamp).replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return (datetime.now(timezone.utc) - parsed).total_seconds() / 86400
    except Exception:
        return None


def base_band(
    brain: dict[str, Any],
    *,
    attention_all: list[dict[str, Any]],
    today_feeling: Optional[dict[str, Any]],
    status: str,
    objectives_progress: Optional[dict[str, dict[str, Any]]] = None,
) -> dict[str, Any]:
    """The band from everything already in scope inside ``student_insights``.

    Two inputs arrive later, at the group stage, and can only move a student in
    one direction each: a blocked message (adds RED), and week-over-week
    improvement (upgrades ORANGE to GREEN). So this base is final for red
    students and correct-or-pending for the rest.
    """
    reasons: list[dict[str, Any]] = []

    # ── RED: any one signal ──────────────────────────────────────────────────
    for flag in attention_all or []:
        signal = _RED_ATTENTION_KINDS.get(str(flag.get("kind") or ""))
        if signal:
            reasons.append({
                "signal": signal,
                "evidence": dict(flag.get("raw_evidence") or {}),
            })
    # Heavy feeling on TODAY's check-in (callers pass today_feeling only when
    # its date is the current school day). Rendering only — never an alert.
    from app.services.checkin_flow import NEGATIVE_VALENCES

    if today_feeling and today_feeling.get("valence") in NEGATIVE_VALENCES:
        reasons.append({
            "signal": "heavy_feeling_today",
            "evidence": {"valence": today_feeling.get("valence"),
                         "feeling": today_feeling.get("feeling")},
        })
    # Answer cycling lives on the brain, not in attention_all. The detector
    # stores type "rapid_answer_cycling" (detectors.py) — `band_for` used to
    # look for "answer_cycling" and therefore never saw it; accept the real
    # name here.
    for row in brain.get("behavior_signals") or []:
        if str(row.get("type") or "") in ("rapid_answer_cycling", "answer_cycling"):
            reasons.append({
                "signal": "answer_cycling",
                "evidence": {"at": row.get("at"), "objective_id": row.get("objective_id")},
            })
            break
    if reasons:
        return {"band": "red", "reasons": reasons}

    # ── GREEN: positive evidence only ────────────────────────────────────────
    entries = [
        entry for entry in (brain.get("mastery") or {}).values()
        if isinstance(entry, dict) and (entry.get("attempts") or 0) > 0
    ]
    for entry in entries:
        ewma = float(entry.get("score_ewma") or 0)
        confidence = float(entry.get("confidence") or 0)
        level = str(entry.get("level") or "basic")
        if ewma >= _GREEN_EWMA and confidence >= _GREEN_CONFIDENCE:
            reasons.append({"signal": "high_mastery",
                            "evidence": {"score_ewma": round(ewma, 2),
                                         "confidence": round(confidence, 2)}})
            break
        if (level in ("intermediate", "advanced")
                and not entry.get("needs_review")
                and ewma >= _LEVEL_RECHECK_EWMA):
            reasons.append({"signal": "mastery_level_confirmed",
                            "evidence": {"level": level, "score_ewma": round(ewma, 2)}})
            break
        if (entry.get("consecutive_successes") or 0) >= _GREEN_STREAK:
            reasons.append({"signal": "success_streak",
                            "evidence": {"streak": entry.get("consecutive_successes")}})
            break
        achieved_days = _days_since(entry.get("achieved_at"))
        if achieved_days is not None and achieved_days <= _RECENT_MASTERY_DAYS:
            reasons.append({"signal": "improving_week",
                            "evidence": {"achieved_days_ago": round(achieved_days, 1)}})
            break
    if not reasons:
        # Percent is against the catalog's objective count (insights.
        # objectives_progress), not against what the child happens to have seen.
        for subject, stats in (objectives_progress or {}).items():
            percent = (stats or {}).get("percent")
            if percent is not None and percent >= _SUBJECT_STRONG_PERCENT:
                reasons.append({"signal": "subject_strength",
                                "evidence": {"subject": subject, "percent": percent}})
                break
    if reasons:
        return {"band": "green", "reasons": reasons}

    # ── ORANGE ───────────────────────────────────────────────────────────────
    if not entries and status == "not_started":
        return {"band": "orange",
                "reasons": [{"signal": "insufficient_evidence", "evidence": {}}]}
    return {"band": "orange", "reasons": [{"signal": "steady", "evidence": {}}]}


def apply_blocked_messages(band: dict[str, Any], blocked: list[dict[str, Any]]) -> dict[str, Any]:
    """A blocked harmful message is a RED input regardless of everything else."""
    if not blocked:
        return band
    reason = {
        "signal": "blocked_message",
        "evidence": {"count": len(blocked), "last_at": blocked[0].get("created_at"),
                     "category": blocked[0].get("category")},
    }
    if band["band"] == "red":
        return {"band": "red", "reasons": band["reasons"] + [reason]}
    return {"band": "red", "reasons": [reason]}


def improvement_from_trends(trends: dict[str, Any]) -> Optional[dict[str, Any]]:
    """Week-over-week: sum the per-day series halves and compare rates.

    ``per_day`` is chronological and gapless (learner_trends); with days=14 the
    last 7 rows are this week. Only ever returns an upgrade reason — never a
    downgrade: a quiet week is orange by other rules, not a penalty here.
    """
    per_day = trends.get("per_day") or []
    if len(per_day) < 14:
        return None
    prior, current = per_day[:7], per_day[-7:]
    attempts_now = sum(row.get("attempts") or 0 for row in current)
    attempts_prior = sum(row.get("attempts") or 0 for row in prior)
    if attempts_now < _IMPROVE_MIN_ATTEMPTS or attempts_prior < _IMPROVE_MIN_PRIOR_ATTEMPTS:
        return None
    rate_now = sum(row.get("correct") or 0 for row in current) / attempts_now
    rate_prior = sum(row.get("correct") or 0 for row in prior) / attempts_prior
    if rate_now - rate_prior >= _IMPROVE_RATE_DELTA:
        return {"signal": "improving_week",
                "evidence": {"rate_now": round(rate_now, 2),
                             "rate_prior": round(rate_prior, 2),
                             "attempts": attempts_now}}
    return None


# ── Band-change memory (the "new" badge) ─────────────────────────────────────
# One row per learner: the band we last computed and when it last CHANGED.
# The dashboard marks recently-changed students so a teacher opening the screen
# sees movement first. First-ever computation stores silently — a child is not
# "new" for existing at all.
_BAND_STATES = "band_states"
_CHANGE_FRESH_HOURS = 48


async def note_band_changes(bands: dict[str, str]) -> dict[str, dict[str, Any]]:
    """Persist band transitions; return {learner_id: {changed_at, previous}}.

    Returns an entry for every learner (changed_at may be old); ``previous`` is
    None until a first transition has ever happened. Storage failures degrade to
    "nothing is new" rather than blocking the snapshot.
    """
    from app.brain.repository import _get_collection_named

    out: dict[str, dict[str, Any]] = {
        lid: {"changed_at": None, "previous": None} for lid in bands
    }
    try:
        collection = _get_collection_named(_BAND_STATES)
        if collection is None:
            return out
        stored: dict[str, dict[str, Any]] = {}
        async for doc in collection.find({"_id": {"$in": list(bands.keys())}}):
            stored[doc["_id"]] = doc
        now = datetime.now(timezone.utc).isoformat()
        for lid, band in bands.items():
            row = stored.get(lid)
            if row is None:
                await collection.update_one(
                    {"_id": lid},
                    {"$set": {"band": band, "changed_at": now, "previous": None}},
                    upsert=True,
                )
                continue
            if row.get("band") != band:
                await collection.update_one(
                    {"_id": lid},
                    {"$set": {"band": band, "changed_at": now,
                              "previous": row.get("band")}},
                )
                out[lid] = {"changed_at": now, "previous": row.get("band")}
            else:
                out[lid] = {"changed_at": row.get("changed_at"),
                            "previous": row.get("previous")}
    except Exception as exc:  # the badge must never cost the snapshot
        print(f"⚠️ band-change tracking skipped: {type(exc).__name__}")
    return out


def is_fresh_change(change: dict[str, Any]) -> bool:
    """Recently moved AND from a real previous band (not the first sighting)."""
    if not change.get("previous"):
        return False
    days = _days_since(change.get("changed_at"))
    return days is not None and days * 24 <= _CHANGE_FRESH_HOURS


_ttl_cache: dict[tuple[str, str], tuple[float, dict[str, Any]]] = {}
_TTL_SECONDS = 60.0


def cache_get(key: tuple[str, str]) -> Optional[dict[str, Any]]:
    row = _ttl_cache.get(key)
    if row and time.monotonic() - row[0] < _TTL_SECONDS:
        return row[1]
    return None


def cache_put(key: tuple[str, str], value: dict[str, Any]) -> None:
    _ttl_cache[key] = (time.monotonic(), value)
