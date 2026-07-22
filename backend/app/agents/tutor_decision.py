"""Tutor decision layer (A-4b) — deterministic pedagogy routing, logged per turn.

Bridge/Tutor-CoPilot pattern (RCT: +4pp mastery): before the coach generates,
classify the learner's situation (error type) → pick a strategy + intention from
FIXED taxonomies → condition the generation on that decision → log the triple.
The log is the explainable "why the tutor did X" evidence for teachers, and the
taxonomies encode the RCT quality labels: probing beats telling, and praise must
name what was right — generic praise is a low-quality move.

Also owns the VanLehn hint ladder (L1 nudge → L2 teach → L3 worked example),
tracked per component in `current_state.hint_ladder`; L3-reached is a
descriptive teacher signal, never a score.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

ERROR_TYPES = ("guess", "careless", "misinterpret", "right-idea", "no-attempt", "unknown")
STRATEGIES = (
    "explain", "question", "hint", "worked-example", "simplify",
    "change-representation", "affirm", "encourage",
)
INTENTIONS = (
    "diagnose", "elaborate", "correct", "motivate", "check-understanding", "consolidate",
)

MAX_HINT_LEVEL = 3

# Strategy → generation guidance (Hebrew-first; the coach answers in the
# learner's language regardless — this line steers the MOVE, not the words).
_STRATEGY_GUIDANCE = {
    "question": "שאל/י שאלה מנחה אחת שמקדמת חשיבה — אל תסביר/י עדיין (probing beats telling).",
    "hint": "רמז ממוקד אחד בלבד, בלי הפתרון ובלי הצעד הסופי.",
    "explain": "הסבר/י את הרעיון בקצרה ובשלבים, ועצור/עצרי לבדוק הבנה.",
    "worked-example": "הראה/י דוגמה פתורה מלאה על מקרה מקביל — לא על התרגיל עצמו — ואז בקש/י ניסיון חדש.",
    "simplify": "פרק/י לצעד הקטן ביותר האפשרי והתחל/י ממנו.",
    "change-representation": "החלף/י ייצוג (סיפור, ציור, מספרים קטנים, דוגמה מתחום העניין) — לא עוד מאותו הדבר.",
    "affirm": "חיזוק שמציין במדויק מה היה נכון ולמה — שבח כללי הוא מהלך חלש.",
    "encourage": "נרמל/י את הקושי, ציין/י מאמץ אמיתי שנראה בראיות, והצע/י צעד קטן אחד.",
}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def classify_error_type(recent_events: list[dict[str, Any]]) -> str:
    """Deterministic error-type read from the newest scored evidence.

    Input rows are the coach bundle's flat `recent_events` view
    (`{verb, success, misconception, effortful, ...}`, newest first)."""
    scored = [
        e for e in recent_events
        if e.get("verb") in {"answered", "attempted"} and e.get("success") is not None
    ]
    if not scored:
        return "no-attempt"
    newest = scored[0]
    if newest.get("success"):
        return "right-idea"
    if newest.get("effortful") is False:
        return "guess"
    if newest.get("misconception"):
        return "misinterpret"
    # A miss right after successes on the same objective → likely careless slip.
    if len(scored) >= 3 and all(e.get("success") for e in scored[1:3]):
        return "careless"
    return "unknown"


def decide(
    *,
    error_type: str,
    query_intent: str,
    support_mode: Optional[str],
    trigger: Optional[str],
    hint_level: int,
    has_open_misconception: bool,
) -> Optional[dict[str, str]]:
    """Pick (strategy, intention) from the fixed taxonomies. None = no decision
    needed (profile/memory/small-talk turns are not tutoring moves)."""
    if query_intent in {"profile_question", "memory_correct", "memory_forget"}:
        return None

    if support_mode == "hint":
        strategy = ("hint", "explain", "worked-example")[min(hint_level, MAX_HINT_LEVEL) - 1]
        intention = "diagnose" if hint_level == 1 else "elaborate"
    elif support_mode == "explanation":
        strategy, intention = "explain", "elaborate"
    elif trigger in {"misconception", "wheel_spinning"}:
        strategy, intention = "change-representation", "correct"
    elif trigger == "rapid_guessing":
        strategy, intention = "simplify", "check-understanding"
    elif trigger == "slow_progress":
        strategy, intention = "simplify", "diagnose"
    elif trigger in {"success"}:
        strategy, intention = "affirm", "consolidate"
    elif trigger == "idle":
        strategy, intention = "hint", "motivate"
    elif query_intent == "encouragement" or error_type == "guess":
        strategy, intention = "encourage", "motivate"
    elif error_type == "misinterpret" or has_open_misconception:
        strategy, intention = "change-representation", "correct"
    elif error_type == "careless":
        strategy, intention = "question", "check-understanding"
    elif error_type == "right-idea":
        strategy, intention = "question", "elaborate"
    else:
        strategy, intention = "question", "diagnose"   # probing beats telling
    return {"error_type": error_type, "strategy": strategy, "intention": intention}


def guidance_line(decision: dict[str, str], hint_level: int) -> str:
    """The single instruction line that conditions the coach's generation."""
    guidance = _STRATEGY_GUIDANCE.get(decision["strategy"], "")
    ladder = ""
    if decision["strategy"] in {"hint", "explain", "worked-example"} and hint_level > 1:
        ladder = (
            f" (רמת עזרה {min(hint_level, MAX_HINT_LEVEL)}/{MAX_HINT_LEVEL}; "
            "אם לא היה ניסיון מאז העזרה הקודמת — בקש/י קודם ניסיון קטן)"
        )
    return (
        f"tutor_decision: strategy={decision['strategy']}, intention={decision['intention']}, "
        f"error_type={decision['error_type']} — {guidance}{ladder}"
    )


# ── Hint ladder state (per component, in current_state.hint_ladder) ──────────
def next_hint_level(current_state: dict[str, Any], component_id: Optional[str]) -> int:
    """Escalating help level for repeated requests on the SAME component."""
    ladder = (current_state or {}).get("hint_ladder") or {}
    if component_id and ladder.get("component_id") == component_id:
        return min(int(ladder.get("level") or 0) + 1, MAX_HINT_LEVEL)
    return 1


async def record_hint_level(learner_id: str, component_id: Optional[str], level: int) -> None:
    """Persist the ladder position (trusted system lane, never blocks)."""
    if not component_id:
        return
    try:
        from app.brain.repository import apply_brain_operators
        await apply_brain_operators(learner_id, {
            "current_state.hint_ladder": {
                "component_id": component_id,
                "level": level,
                "updated_at": _now(),
            },
        })
    except Exception:
        pass


async def recent_tutor_decisions(learner_id: str, limit: int = 300) -> list[dict[str, Any]]:
    """Recent coach decisions (hint/explain/worked-example + hint_level) for a
    learner — best-effort evidence for the activeness help/hint signals. Returns
    an empty list when the collection is unavailable (never raises)."""
    try:
        from app.brain.repository import _get_collection_named
        collection = _get_collection_named("tutor_decisions")
        if collection is None:
            return []
        cursor = collection.find({"learner_id": learner_id}).sort("at", -1).limit(limit)
        return [d async for d in cursor]
    except Exception:
        return []


async def log_decision(
    learner_id: str,
    decision: dict[str, str],
    *,
    session_id: Optional[str],
    exchange_id: Optional[str],
    hint_level: Optional[int] = None,
    surface_component: Optional[str] = None,
) -> None:
    """Append the decision triple to `tutor_decisions` (CLASS-style decision
    codes) — teacher-explainable, never blocks the reply."""
    try:
        from app.brain.repository import _get_collection_named
        collection = _get_collection_named("tutor_decisions")
        if collection is None:
            return
        await collection.insert_one({
            "learner_id": learner_id,
            **decision,
            "hint_level": hint_level,
            "component_id": surface_component,
            "session_id": session_id,
            "exchange_id": exchange_id,
            "at": _now(),
        })
    except Exception:
        pass
