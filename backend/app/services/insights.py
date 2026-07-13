"""Teacher insights (F6) — deterministic + explainable (§5.3, §9, §11).

Numbers come from real `learning_events` + brain projections, never invented.
Every attention flag returns its **raw evidence**. No student-to-student
comparison (group views are aggregates only). The Teacher Insights agent may
reword this evidence but never adds facts.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from app.brain.org import get_group, learners_in_group
from app.brain.repository import get_brain
from app.services.events import get_recent_events
from app.services.learning_timing import PROLONGED_INTERACTION_SECONDS
from app.services.planner import plan_next

INACTIVITY_DAYS = 6
LOW_SUCCESS_STREAK = 3

REASON = {
    "inactivity": {"he": "אין פעילות", "ar": "لا يوجد نشاط", "en": "No activity"},
    "low_success": {"he": "כישלונות רצופים", "ar": "إخفاقات متتالية", "en": "Consecutive failures"},
    "slow_progress": {"he": "זמן ממושך בשאלה", "ar": "وقت طويل في السؤال", "en": "Long question interval"},
    "wellbeing": {"he": "שיתף/ה מצוקה — דורש תשומת לב", "ar": "شارك ضائقة — يتطلب انتباهًا", "en": "Shared distress — needs attention"},
}
REC = {
    "reach_out": {"he": "צור/צרי קשר והצע/י משימה קצרה לחזרה", "ar": "تواصل واقترح مهمة قصيرة", "en": "Reach out and offer a short re-entry task"},
    "targeted": {"he": "תרגול ממוקד בנושא שבו יש קושי", "ar": "تدريب مركّز على النقطة الصعبة", "en": "Targeted practice on the struggling objective"},
    "alt_rep": {"he": "הצע/י ייצוג חלופי (וידאו/סימולציה)", "ar": "اقترح تمثيلًا بديلًا", "en": "Offer an alternative representation"},
    "build_strength": {"he": "בסס/י על חוזקה קיימת", "ar": "ابنِ على نقطة قوة", "en": "Build on an existing strength"},
    "check_in": {"he": "בדוק/י אם כדאי לפרק את המשימה לצעד קטן או להציע רמז", "ar": "تحقق إن كان من المفيد تقسيم المهمة أو تقديم تلميح", "en": "Check whether to break the task into a smaller step or offer a hint"},
}


def _t(table: dict, key: str, language: str) -> str:
    return table.get(key, {}).get(language) or table.get(key, {}).get("he") or key


def _days_since(iso: str | None) -> int | None:
    if not iso:
        return None
    try:
        dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
        return (datetime.now(timezone.utc) - dt).days
    except ValueError:
        return None


def _trailing_fail_streak(events: list[dict[str, Any]]) -> int:
    """Consecutive most-recent failures. ANY success (including a passed
    `completed` assessment) breaks the streak — a recovery must reset it."""
    streak = 0
    for e in events:  # newest first
        success = (e.get("result") or {}).get("success")
        if e.get("verb") in ("answered", "attempted"):
            if success is False:
                streak += 1
            else:
                break
        elif success is True:   # e.g. completed with success — recovery
            break
    return streak


async def student_insights(learner_id: str, language: str = "he") -> dict[str, Any]:
    """Explainable per-student insight — struggle, progress, attention + evidence."""
    brain = await get_brain(learner_id)
    recent = await get_recent_events(learner_id, limit=20)
    plan = plan_next(brain)

    days_inactive = _days_since(recent[0]["stored_at"]) if recent else None
    fail_streak = _trailing_fail_streak(recent)
    prolonged_events = [
        event for event in recent
        if event.get("verb") in ("answered", "attempted")
        and isinstance((event.get("timing") or {}).get("elapsed_since_previous_seconds"), (int, float))
        and (event.get("timing") or {}).get("elapsed_since_previous_seconds") >= PROLONGED_INTERACTION_SECONDS
    ]

    struggle_items = [
        {"label": c.get("label"), "objective_id": c.get("objective_id"),
         "evidence": (brain.get("mastery") or {}).get(c.get("objective_id", ""), {}).get("misconceptions")}
        for c in (brain.get("challenges") or []) if isinstance(c, dict)
    ]

    # Attention flag — always with raw evidence (F6 explainability).
    # Wellbeing (a learner-shared distress signal) OUTRANKS academic flags: a
    # student's safety takes priority over inactivity/low-success.
    attention = None
    open_wellbeing = [f for f in (brain.get("wellbeing_flags") or [])
                      if isinstance(f, dict) and not f.get("resolved")]
    if open_wellbeing:
        latest = open_wellbeing[-1]
        attention = {"reason": _t(REASON, "wellbeing", language),
                     "evidence": latest.get("evidence") or "",
                     "kind": "wellbeing"}
    elif days_inactive is not None and days_inactive >= INACTIVITY_DAYS:
        attention = {"reason": _t(REASON, "inactivity", language),
                     "evidence": f"{days_inactive} ימים ללא פעילות" if language == "he"
                                 else f"{days_inactive} days without activity",
                     "kind": "inactivity"}
    elif fail_streak >= LOW_SUCCESS_STREAK:
        attention = {"reason": _t(REASON, "low_success", language),
                     "evidence": f"{fail_streak} כישלונות רצופים" if language == "he"
                                 else f"{fail_streak} consecutive failures",
                     "kind": "low_success"}
    elif prolonged_events:
        latest = prolonged_events[0]
        elapsed_seconds = (latest.get("timing") or {}).get("elapsed_since_previous_seconds")
        elapsed_minutes = max(1, round(elapsed_seconds / 60))
        evidence_text = {
            "he": f"כ-{elapsed_minutes} דקות בין אירועי שאלה",
            "ar": f"حوالي {elapsed_minutes} دقائق بين أحداث السؤال",
            "en": f"About {elapsed_minutes} minutes between question events",
        }.get(language, f"About {elapsed_minutes} minutes between question events")
        attention = {
            "reason": _t(REASON, "slow_progress", language),
            "evidence": evidence_text,
            "kind": "slow_progress",
            "raw_evidence": {
                "event_id": latest.get("_id"),
                "question_id": latest.get("question_id"),
                "elapsed_seconds": elapsed_seconds,
                "timing_quality": (latest.get("timing") or {}).get("quality"),
                "occurred_at": latest.get("occurred_at"),
            },
        }

    # 2–5 actionable recommendations (deterministic).
    recommendations: list[str] = []
    if (days_inactive or 0) >= INACTIVITY_DAYS:
        recommendations.append(_t(REC, "reach_out", language))
    if fail_streak >= 2:
        recommendations.extend([_t(REC, "targeted", language), _t(REC, "alt_rep", language)])
    if prolonged_events:
        recommendations.append(_t(REC, "check_in", language))
    if brain.get("strengths"):
        recommendations.append(_t(REC, "build_strength", language))
    recommendations = recommendations[:5] or [_t(REC, "targeted", language)]

    return {
        "learner_id": learner_id,
        "display_name": (brain.get("identity") or {}).get("display_name"),
        "progress": brain.get("progress") or {},
        "next": {s: plan[s]["next_titles"] for s in plan},
        "struggle_items": struggle_items,
        "strengths": [
            s.get("label")
            for s in (brain.get("strengths") or [])
            if isinstance(s, dict) and s.get("learner_feedback") != "inaccurate"
        ],
        "attention": attention,
        "wellbeing_flags": [
            {"evidence": f.get("evidence"), "at": f.get("at"), "source": f.get("source")}
            for f in open_wellbeing
        ],
        "recommendations": recommendations,
        "timeline": [
            {"verb": e.get("verb"), "objective_id": e.get("objective_id"),
             "success": (e.get("result") or {}).get("success"), "at": e.get("stored_at"),
             "question_id": e.get("question_id"), "timing": e.get("timing")}
            for e in recent[:10]
        ],
        # self vs system awareness (F4 self-awareness)
        "reflections_recent": brain.get("reflections_recent") or [],
    }


async def group_insights(group_id: str, language: str = "he") -> dict[str, Any]:
    """Group aggregates + per-student summaries. NO student-to-student comparison."""
    group = get_group(group_id)
    learner_ids = learners_in_group(group_id)
    students = [await student_insights(lid, language) for lid in learner_ids]

    active_7d = sum(1 for s in students if s["timeline"] and _days_since(s["timeline"][0]["at"]) is not None
                    and _days_since(s["timeline"][0]["at"]) <= 7)
    needing_attention = [s for s in students if s["attention"]]
    total_mastered = sum(
        sum(p.get("objectives_mastered", 0) for p in (s["progress"] or {}).values())
        for s in students
    )

    return {
        "group": group,
        "students": [
            {"learner_id": s["learner_id"], "display_name": s["display_name"],
             "progress": s["progress"], "attention": s["attention"]}
            for s in students
        ],
        # Aggregate trends only (no comparisons between students).
        "trends": {
            "students_total": len(students),
            "active_last_7d": active_7d,
            "needing_attention": len(needing_attention),
            "objectives_mastered_total": total_mastered,
        },
        "attention": [
            {"learner_id": s["learner_id"], "display_name": s["display_name"], **s["attention"]}
            for s in needing_attention
        ],
    }
