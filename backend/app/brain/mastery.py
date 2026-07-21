"""Mastery v2 — a deterministic, explainable per-objective skill model (B-1).

Replaces the last-score latch with: score EWMA + evidence-based confidence,
a spaced-review half-life (FSRS-inspired, no dependency), a misconception
lifecycle (seen → counted → resolved, never silently dropped), and a real
basic→intermediate→advanced level progression. Everything here is a pure
function over the stored entry + one normalized event — no I/O, no LLM, and
every stored number is traceable to real events (never invented).

`achieved` stays as a dated historical claim; decay/failure sets
`needs_review=True` (demotion without erasing the record).
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Optional

EWMA_ALPHA = 0.3
ACHIEVE_STREAK = 3            # 3 consecutive effortful successes = mastered (Beck & Gong)
ADVANCED_EWMA = 0.85
ADVANCED_CONFIDENCE = 0.7
MAX_MISCONCEPTIONS = 12
MISCONCEPTION_RESOLVE_STREAK = 2
MIN_STABILITY_DAYS = 0.5
MAX_STABILITY_DAYS = 60.0


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def mastery_key(objective_id: object) -> str:
    """Mongo-safe mastery map key — real MoE objective ids contain dots
    (`MOE.SCI.G7…`), which would fragment dotted `$set` paths."""
    return str(objective_id).replace(".", "·")


def entry_for(mastery: Optional[dict[str, Any]], objective_id: object) -> dict[str, Any]:
    """Look up one objective's entry, tolerating both key forms."""
    table = mastery or {}
    return table.get(mastery_key(objective_id)) or table.get(str(objective_id)) or {}


def _parse(value: object) -> Optional[datetime]:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def event_score(result: dict[str, Any]) -> Optional[float]:
    """The honest scalar magnitude of one scored event, if any (for the EWMA)."""
    scaled = result.get("score_scaled")
    if isinstance(scaled, (int, float)):
        return max(0.0, min(1.0, float(scaled)))
    success = result.get("success")
    if success is True:
        return 1.0
    if success is False:
        return 0.0
    return None


def event_success(result: dict[str, Any], score: float) -> bool:
    """Pass/fail decision. An EXPLICIT `success` flag always wins — a content
    provider that reports `success:true` with a 0.6 scaled score means a pass at
    60%, not a failure (a scaled-only threshold would silently invert it)."""
    explicit = result.get("success")
    if explicit is True:
        return True
    if explicit is False:
        return False
    return score >= 0.7


def _confidence(entry: dict[str, Any]) -> float:
    """Deterministic confidence: how much evidence, how consistent it is."""
    successes = int(entry.get("successes") or 0)
    failures = int(entry.get("failures") or 0)
    evidence = successes + failures
    if evidence == 0:
        return 0.0
    evidence_factor = min(1.0, evidence / 8)
    accuracy = successes / evidence
    return round(min(0.98, evidence_factor * (0.4 + 0.6 * accuracy)), 3)


def apply_scored_event(
    entry: dict[str, Any],
    event: dict[str, Any],
    *,
    effortful: bool = True,
    probable_slip: bool = False,
    now: Optional[str] = None,
) -> dict[str, Any]:
    """Fold one scored event into a mastery entry; returns the new entry.

    `effortful=False` (rapid guess) advances nothing except the attempt count —
    a 2-second wrong tap must not create a misconception or drop mastery.
    `probable_slip` records the miss without a misconception tag, streak reset,
    or stability slash (the learner clearly knows this skill).
    """
    now = now or event.get("occurred_at") or _now_iso()
    updated = dict(entry or {})
    verb = event.get("verb")
    result = event.get("result") or {}

    if event.get("subject"):
        updated["subject"] = event["subject"]
    if verb in {"answered", "attempted"}:
        updated["attempts"] = int(updated.get("attempts") or 0) + 1

    score = event_score(result)
    if score is None or not effortful:
        return updated

    success = event_success(result, score)
    prior_streak = int(updated.get("consecutive_successes") or 0)

    updated["last_score"] = score
    prior_ewma = updated.get("score_ewma")
    updated["score_ewma"] = round(
        score if not isinstance(prior_ewma, (int, float))
        else EWMA_ALPHA * score + (1 - EWMA_ALPHA) * float(prior_ewma),
        3,
    )
    if success:
        updated["successes"] = int(updated.get("successes") or 0) + 1
        updated["consecutive_successes"] = prior_streak + 1
    else:
        updated["failures"] = int(updated.get("failures") or 0) + 1
        if not probable_slip:
            updated["consecutive_successes"] = 0
    updated["confidence"] = _confidence(updated)

    # Spaced-review half-life: grows with spaced successes, halves on real failure.
    stability = float(updated.get("stability_days") or 1.0)
    last_at = _parse(updated.get("last_evidence_at"))
    event_at = _parse(now) or datetime.now(timezone.utc)
    if success:
        spacing_bonus = 0.0
        if last_at is not None and stability > 0:
            days_since = max(0.0, (event_at - last_at).total_seconds() / 86400)
            spacing_bonus = min(1.0, days_since / stability)
        stability = min(MAX_STABILITY_DAYS, stability * (1.5 + spacing_bonus))
    elif not probable_slip:
        stability = max(MIN_STABILITY_DAYS, stability * 0.5)
    updated["stability_days"] = round(stability, 2)
    updated["last_evidence_at"] = now
    updated["review_due"] = (event_at + timedelta(days=stability)).isoformat()

    # Misconception lifecycle (effortful misses only; resolved on a real streak).
    misconceptions = [
        dict(m) for m in (updated.get("misconceptions") or []) if isinstance(m, dict)
    ]
    tag = event.get("misconception")
    if tag and not success and not probable_slip:
        for m in misconceptions:
            if m.get("tag") == tag:
                m["count"] = int(m.get("count") or 1) + 1
                m["last_seen"] = now
                m["resolved"] = False
                m.pop("resolved_at", None)
                break
        else:
            misconceptions.append(
                {"tag": tag, "first_seen": now, "last_seen": now, "count": 1, "resolved": False}
            )
    if int(updated.get("consecutive_successes") or 0) >= MISCONCEPTION_RESOLVE_STREAK:
        for m in misconceptions:
            if not m.get("resolved"):
                m["resolved"] = True
                m["resolved_at"] = now
    updated["misconceptions"] = misconceptions[-MAX_MISCONCEPTIONS:]

    # Achievement: assessment completion with success (existing rule), or a
    # 3-streak with enough evidence (wheel-spinning mastery definition).
    achieved_now = (
        verb == "completed" and event.get("is_assessment") and result.get("success") is True
    ) or int(updated.get("consecutive_successes") or 0) >= ACHIEVE_STREAK
    if achieved_now and not updated.get("achieved"):
        updated["achieved"] = True
        updated["achieved_at"] = now
    updated["achieved"] = bool(updated.get("achieved", False))

    # needs_review: failed after achieving → flag for review, never un-achieve.
    if updated["achieved"]:
        updated["needs_review"] = bool(not success and not probable_slip)
    if success and updated.get("needs_review"):
        updated["needs_review"] = False

    # Level progression (never demoted once earned).
    level = updated.get("level") or "basic"
    if updated["achieved"] and level == "basic":
        level = "intermediate"
    if (
        level == "intermediate"
        and int(updated.get("consecutive_successes") or 0) >= ACHIEVE_STREAK
        and float(updated.get("score_ewma") or 0) >= ADVANCED_EWMA
        and float(updated.get("confidence") or 0) >= ADVANCED_CONFIDENCE
    ):
        level = "advanced"
    updated["level"] = level
    return updated


def is_due_for_review(entry: dict[str, Any], now: Optional[datetime] = None) -> bool:
    """An achieved skill whose spaced-review window has lapsed (or was flagged)."""
    if not isinstance(entry, dict) or not entry.get("achieved"):
        return False
    if entry.get("needs_review"):
        return True
    due = _parse(entry.get("review_due"))
    return due is not None and (now or datetime.now(timezone.utc)) >= due


def unresolved_misconceptions(entry: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        m for m in (entry or {}).get("misconceptions") or []
        if isinstance(m, dict) and not m.get("resolved")
    ]


# ── Verbal stance for the coach bundle (B-4) — no numbers shown onward ───────
_STANCE = {
    "he": {
        "struggling": "בניסיונות האחרונים על {name} היו כמה טעויות רצופות — כדאי צעד קטן או ייצוג אחר.",
        "misconception": "נראה קושי חוזר סביב {tags} — עדיף רמז ממוקד או הסבר מזווית אחרת, לא את התשובה.",
        "solid": "לאחרונה {name} הולך טוב — אפשר להעלות מעט את רמת האתגר.",
        "review_due": "עבר זמן מאז שתורגל {name} — חזרה קצרה תחזק את הזיכרון.",
        "fresh": "אין עדיין מספיק ראיות על {name} — התקדם בזהירות ובדוק הבנה.",
    },
    "ar": {
        "struggling": "في المحاولات الأخيرة على {name} كانت هناك أخطاء متتالية — يُفضَّل خطوة صغيرة أو تمثيل آخر.",
        "misconception": "تظهر صعوبة متكررة حول {tags} — قدّم تلميحًا مركّزًا أو شرحًا من زاوية أخرى، لا الإجابة.",
        "solid": "الأداء مؤخرًا على {name} جيد — يمكن رفع مستوى التحدي قليلًا.",
        "review_due": "مرّ وقت منذ التدرّب على {name} — مراجعة قصيرة ستقوّي التذكّر.",
        "fresh": "لا توجد أدلة كافية بعد على {name} — تقدّم بحذر وتحقق من الفهم.",
    },
    "en": {
        "struggling": "Recent attempts on {name} had several consecutive misses — prefer a small step or a different representation.",
        "misconception": "A repeated difficulty shows around {tags} — give a focused hint or another angle, not the answer.",
        "solid": "{name} is going well lately — the challenge level can rise a little.",
        "review_due": "It has been a while since {name} was practiced — a short review would strengthen retention.",
        "fresh": "Not enough evidence yet on {name} — advance carefully and check understanding.",
    },
}


def stance_for(
    mastery: dict[str, Any],
    objective_id: Optional[str],
    objective_title: str = "",
    locale: str = "he",
) -> list[str]:
    """1–2 short evidence-grounded lines about where the learner stands."""
    table = _STANCE.get(locale, _STANCE["he"])
    lines: list[str] = []
    name = objective_title or (objective_id or "")
    entry = entry_for(mastery, objective_id) if objective_id else None
    if isinstance(entry, dict) and (int(entry.get("successes") or 0) + int(entry.get("failures") or 0)):
        open_misconceptions = unresolved_misconceptions(entry)
        if open_misconceptions:
            tags = ", ".join(str(m.get("tag")) for m in open_misconceptions[:2])
            lines.append(table["misconception"].format(tags=tags, name=name))
        elif int(entry.get("consecutive_successes") or 0) == 0 and int(entry.get("failures") or 0) >= 2:
            lines.append(table["struggling"].format(name=name))
        elif float(entry.get("score_ewma") or 0) >= 0.8:
            lines.append(table["solid"].format(name=name))
    elif objective_id:
        lines.append(table["fresh"].format(name=name))

    now = datetime.now(timezone.utc)
    current_key = mastery_key(objective_id) if objective_id else None
    due = [
        e for oid, e in (mastery or {}).items()
        if oid != current_key and isinstance(e, dict) and is_due_for_review(e, now)
    ]
    if due:
        # Prefer the entry's own stored objective_id for a human-readable name.
        due_name = due[0].get("objective_id") or ""
        lines.append(table["review_due"].format(name=due_name))
    return lines[:2]
