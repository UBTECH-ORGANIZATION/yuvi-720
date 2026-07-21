"""Dashboard projection (F4) — a deterministic view of the Learner Brain.

Progress comes from real mastery events, goals come from mentoring, and learner
profile information comes from mapping. The LLM invents no values here. The v2
projection adds a read-only next-step preview, resume context, localized
curriculum labels, reflection preview, and learner-safe verbal descriptors.
"""

from __future__ import annotations

from typing import Any, Optional

from app.brain.curriculum import (
    get_component,
    localized_objective_title,
    objectives_for,
)
from app.services import content_catalog
from app.services.planner import plan_next

# Scope for תשפ"ז — the two Ministry subjects (§8.6).
DEFAULT_SUBJECTS = ("math", "science")

SUBJECT_NAMES = {
    "math":    {"he": "מתמטיקה", "en": "Mathematics", "ar": "الرياضيات"},
    "science": {"he": "מדע וטכנולוגיה", "en": "Science & Technology", "ar": "العلوم والتكنولوجيا"},
}
SUBJECT_ICON = {"math": "📐", "science": "🔬"}
SUBJECT_GRADIENT = {
    "math": "linear-gradient(135deg, #7c5cff, #9f7afe)",
    "science": "linear-gradient(135deg, #4CC9F0, #4299e1)",
}
SUBJECT_ICON_BG = {"math": "rgba(124,92,255,0.1)", "science": "rgba(76,201,240,0.12)"}

LEVEL_WORDS = {
    "great":    {"he": "בהתקדמות מצוינת", "en": "Progressing excellently", "ar": "تقدّم ممتاز"},
    "good":     {"he": "בהתקדמות יפה", "en": "Progressing nicely", "ar": "تقدّم جيد"},
    "building": {"he": "בבנייה", "en": "Building up", "ar": "قيد البناء"},
    "starting": {"he": "רק מתחילים", "en": "Just getting started", "ar": "بداية الطريق"},
}
STATUS_WORDS = {
    "done":     {"he": "הושלם", "en": "Done", "ar": "تم"},
    "current":  {"he": "לומדים עכשיו", "en": "Learning now", "ar": "قيد التعلم"},
    "upcoming": {"he": "בהמשך", "en": "Coming up", "ar": "لاحقًا"},
}
COMPETENCY_META = {
    "motivation_relevance":      {"icon": "🎯", "he": "מוטיבציה ורלוונטיות", "en": "Motivation & relevance", "ar": "الدافعية والصلة"},
    "growth_mindset":            {"icon": "🌱", "he": "תפיסת צמיחה", "en": "Growth mindset", "ar": "عقلية النمو"},
    "initiative_responsibility": {"icon": "🚀", "he": "יוזמה ואחריות", "en": "Initiative & responsibility", "ar": "المبادرة والمسؤولية"},
    "self_regulation":           {"icon": "🧭", "he": "ויסות עצמי", "en": "Self-regulation", "ar": "التنظيم الذاتي"},
    "self_awareness":            {"icon": "🔍", "he": "מודעות עצמית", "en": "Self-awareness", "ar": "الوعي الذاتي"},
    "support_emotional":         {"icon": "🤝", "he": "תמיכה וחוויה רגשית", "en": "Support & emotional experience", "ar": "الدعم والتجربة العاطفية"},
}
COMPETENCY_ORDER = list(COMPETENCY_META.keys())

BAND_WORDS = {
    "strong": {"he": "מוכן/ה לאתגר", "en": "Ready for a challenge", "ar": "جاهز/ة للتحدي"},
    "steady": {"he": "מתקדם/ת יפה", "en": "Progressing steadily", "ar": "يتقدّم/تتقدّم بثبات"},
    "support": {"he": "כדאי לחזק", "en": "Worth strengthening", "ar": "يستحق التعزيز"},
}

HERO_REASON = {
    "resume": {
        "he": "אפשר להמשיך בדיוק מהמקום שבו עצרת.",
        "en": "You can continue exactly where you stopped.",
        "ar": "يمكنك المتابعة من المكان الذي توقفت فيه بالضبط.",
    },
    "next": {
        "he": "זה הצעד הבא במסלול, אחרי היעדים שכבר השלמת.",
        "en": "This is the next step after the objectives you have completed.",
        "ar": "هذه هي الخطوة التالية بعد الأهداف التي أنجزتها.",
    },
    "complete": {
        "he": "השלמת את כל היעדים הזמינים במסלול הנוכחי.",
        "en": "You completed all currently available objectives.",
        "ar": "أكملت جميع الأهداف المتاحة حاليًا.",
    },
}

PACE_WORDS = {
    "on_track": {"he": "בקצב שמתאים לך", "en": "At a pace that suits you", "ar": "بوتيرة تناسبك"},
    "ahead": {"he": "מתקדם/ת בביטחון", "en": "Moving ahead confidently", "ar": "تتقدّم/ين بثقة"},
    "behind": {"he": "אפשר להתקדם בקצב שלך", "en": "You can move at your own pace", "ar": "يمكنك التقدّم بوتيرتك"},
}


def _t(table: dict, key: str, language: str) -> str:
    entry = table.get(key, {})
    return entry.get(language) or entry.get("he") or key


def _level_key(progress: int, has_events: bool) -> str:
    if not has_events:
        return "starting"
    if progress >= 80:
        return "great"
    if progress >= 50:
        return "good"
    return "building"


def _subject_curriculum(
    brain: dict, subject: str, language: str, next_objective: Optional[str]
) -> list[dict[str, Any]]:
    """Project the ordered curriculum spine against real mastery evidence."""
    mastery = brain.get("mastery") or {}
    items = []
    for objective in objectives_for(subject):
        objective_id = objective["id"]
        from app.brain.mastery import entry_for
        entry = entry_for(mastery, objective_id)
        done = bool(entry.get("achieved"))
        status_key = "done" if done else "current" if objective_id == next_objective else "upcoming"
        items.append({
            "objectiveId": objective_id,
            "topic": localized_objective_title(objective_id, language),
            "status": _t(STATUS_WORDS, status_key, language),
            "statusClass": (
                "curr-done" if done else "curr-current" if status_key == "current" else "curr-upcoming"
            ),
        })
    return items


def _project_subjects(brain: dict, language: str) -> list[dict[str, Any]]:
    plan = plan_next(brain)
    out = []
    for subject in DEFAULT_SUBJECTS:
        p = plan.get(subject) or {}
        total = int(p.get("total", 0))
        mastered = int(p.get("mastered", 0))
        pct = round((mastered / total) * 100) if total else 0
        has_events = any(
            isinstance(entry, dict) and entry.get("subject") == subject
            for entry in (brain.get("mastery") or {}).values()
        )
        level_key = _level_key(pct, has_events)
        next_ids = p.get("next") or []
        out.append({
            "key": subject,
            "name": _t(SUBJECT_NAMES, subject, language),
            "icon": SUBJECT_ICON.get(subject, "📘"),
            "iconBg": SUBJECT_ICON_BG.get(subject, "rgba(124,92,255,0.1)"),
            "progress": pct,
            "level": _t(LEVEL_WORDS, level_key, language),
            "levelClass": "level-great" if pct >= 80 else "level-good" if pct >= 50 else "level-building",
            "gradient": SUBJECT_GRADIENT.get(subject, "linear-gradient(135deg, #7c5cff, #9f7afe)"),
            "description": _t(LEVEL_WORDS, level_key, language),
            "curriculum": _subject_curriculum(
                brain, subject, language, next_ids[0] if next_ids else None
            ),
        })
    return out


def _project_competencies(brain: dict, language: str) -> list[dict[str, Any]]:
    activeness = (brain.get("profile") or {}).get("activeness") or {}
    out = []
    for key in COMPETENCY_ORDER:
        meta = COMPETENCY_META[key]
        value = int(activeness.get(key, 0))
        tone = "strong" if value >= 70 else "steady" if value >= 45 else "support"
        out.append({
            "key": key,
            "icon": meta["icon"],
            "label": _t(COMPETENCY_META, key, language),
            # Kept for backward compatibility and internal visualization only.
            # The v2 learner UI renders descriptor/tone, never this number.
            "value": value,
            "descriptor": _t(BAND_WORDS, tone, language),
            "tone": tone,
        })
    return out


def _hero(brain: dict, language: str) -> dict[str, Any]:
    """Build a read-only resume/next preview; never mutate current_state."""
    mastery = brain.get("mastery") or {}
    current = brain.get("current_state") or {}
    current_component_id = current.get("component_id") or current.get("item_id")
    current_component = get_component(current_component_id) if current_component_id else None
    current_objective_id = (current_component or {}).get("objective_id")
    from app.brain.mastery import entry_for
    can_resume = bool(
        current.get("resume_token")
        and current_component
        and not entry_for(mastery, current_objective_id).get("achieved")
    )

    if can_resume:
        subject = entry_for(mastery, current_objective_id).get("subject")
        if not subject:
            subject = "science" if str(current_objective_id).startswith("sci-") else "math"
        return {
            "mode": "resume",
            "subjectKey": subject,
            "subjectName": _t(SUBJECT_NAMES, subject, language),
            "objectiveId": current_objective_id,
            "objectiveTitle": localized_objective_title(current_objective_id, language),
            "componentId": current_component_id,
            "canResume": True,
            "reason": _t(HERO_REASON, "resume", language),
            "pace": _t(PACE_WORDS, current.get("pace"), language) if current.get("pace") else None,
        }

    plan = plan_next(brain)
    subject = None
    objective_id = None
    for subject_key in DEFAULT_SUBJECTS:
        next_ids = (plan.get(subject_key) or {}).get("next") or []
        if next_ids:
            subject, objective_id = subject_key, next_ids[0]
            break

    if objective_id:
        candidates = content_catalog.list_available_content(objective_id, mastery, language)
        component = candidates[0] if candidates else None
        return {
            "mode": "next",
            "subjectKey": subject,
            "subjectName": _t(SUBJECT_NAMES, subject, language),
            "objectiveId": objective_id,
            "objectiveTitle": localized_objective_title(objective_id, language),
            "componentId": (component or {}).get("id"),
            "canResume": False,
            "reason": _t(HERO_REASON, "next", language),
            "pace": _t(PACE_WORDS, current.get("pace"), language) if current.get("pace") else None,
        }

    return {
        "mode": "complete",
        "subjectKey": None,
        "subjectName": None,
        "objectiveId": None,
        "objectiveTitle": None,
        "componentId": None,
        "canResume": False,
        "reason": _t(HERO_REASON, "complete", language),
        "pace": None,
    }


def project_hero_metrics(brain: dict, events: list[dict[str, Any]]) -> dict[str, Any]:
    """Project real platform-level totals; absent timing remains unavailable."""
    plans = plan_next(brain)
    total = sum(int((plans.get(subject) or {}).get("total", 0)) for subject in DEFAULT_SUBJECTS)
    mastered = sum(int((plans.get(subject) or {}).get("mastered", 0)) for subject in DEFAULT_SUBJECTS)
    elapsed_seconds = sum(
        float((event.get("timing") or {}).get("elapsed_since_previous_seconds") or 0)
        for event in events
        if (event.get("timing") or {}).get("quality") == "elapsed_between_events"
    )
    completed_units = {
        event.get("unit_id")
        for event in events
        if event.get("verb") == "completed" and event.get("unit_id")
    }
    return {
        "timeSpentMinutes": round(elapsed_seconds / 60) if elapsed_seconds else None,
        "overallProgress": round((mastered / total) * 100) if total else 0,
        "completedUnits": len(completed_units),
        "timingAvailable": bool(elapsed_seconds),
    }


def project_dashboard(brain: dict, name: str, language: str = "he") -> dict[str, Any]:
    """Project the brain into the dashboard DTO (real numbers only)."""
    profile = brain.get("profile") or {}
    display_name = (brain.get("identity") or {}).get("display_name") or name or "תלמיד/ה"

    difficulties = [
        {
            "subject": "",
            "text": c.get("label", ""),
            "status": c.get("status", "working"),
            "statusClass": "status-working" if c.get("status") == "working" else "status-new",
        }
        for c in (brain.get("challenges") or [])
        if isinstance(c, dict) and c.get("status") != "resolved"
    ]

    goals = [
        {
            "id": g.get("id"),
            "text": g.get("text", ""),
            "meta": g.get("source", ""),
            "source": g.get("source", ""),
            "status": g.get("status", ""),
            "steps": g.get("steps") if isinstance(g.get("steps"), dict) else None,
            "done": g.get("status") == "done",
            "deadline": g.get("deadline"),
        }
        for g in (brain.get("goals") or [])
        if isinstance(g, dict) and g.get("visible_to_learner", True)
    ]

    mapping = {
        "interests": profile.get("interests") or [],
        "learningStyle": profile.get("learning_style") or "",
        "preferences": profile.get("preferences") or [],
        "environment": profile.get("environment") or "",
        "strengths": [
            s.get("label")
            for s in (brain.get("strengths") or [])
            if isinstance(s, dict) and s.get("learner_feedback") != "inaccurate"
        ],
    }

    reflections = [r for r in (brain.get("reflections_recent") or []) if isinstance(r, dict)]
    reflection_preview = None
    if reflections:
        latest = reflections[-1]
        reflection_preview = {
            "answer": latest.get("answer", ""),
            "promptId": latest.get("prompt_id"),
            "at": latest.get("at"),
        }

    # B-5 learner-facing self-awareness nudge — VERBAL only, never a number.
    self_awareness_note = None
    if (
        reflections
        and isinstance(reflections[-1].get("self_rating"), (int, float))
        and isinstance(reflections[-1].get("system_estimate"), (int, float))
    ):
        gap = (float(reflections[-1]["self_rating"]) / 5.0) - float(
            reflections[-1]["system_estimate"]
        )
        key = (
            "selfAbove" if gap >= 0.25 else "selfBelow" if gap <= -0.25 else "calibrated"
        )
        self_awareness_note = {
            "he": {
                "selfAbove": "שווה לבדוק יחד עם יובי אילו חלקים באמת יושבים חזק — לפעמים ההרגשה מקדימה את התרגול.",
                "selfBelow": "הביצועים שלך בפועל חזקים ממה שהרגשת — מגיע לך יותר קרדיט 💪",
                "calibrated": "ההערכה העצמית שלך מדויקת — סימן ליכולת למידה חזקה 👏",
            }[key],
            "ar": {
                "selfAbove": "يستحق الأمر أن تتحقق مع يوفي أي الأجزاء راسخة فعلًا — أحيانًا يسبق الشعورُ التمرينَ.",
                "selfBelow": "أداؤك الفعلي أقوى مما شعرت — تستحق تقديرًا أكبر 💪",
                "calibrated": "تقييمك الذاتي دقيق — علامة على قدرة تعلم قوية 👏",
            }[key],
            "en": {
                "selfAbove": "Worth checking with Yuvi which parts are really solid — sometimes the feeling runs ahead of the practice.",
                "selfBelow": "Your actual work is stronger than it felt — give yourself more credit 💪",
                "calibrated": "Your self-assessment is accurate — a sign of strong learning skill 👏",
            }[key],
        }.get(language) or None

    return {
        "contractVersion": 2,
        "brainVersion": int(brain.get("version", 1)),
        "hasProfile": bool(profile.get("mapping_scores") or profile.get("activeness")),
        "hasLearningEvidence": bool(brain.get("mastery")),
        "name": display_name,
        "avatar": display_name[0] if display_name else "ת",
        "hero": _hero(brain, language),
        "subjects": _project_subjects(brain, language),
        "difficulties": difficulties,
        "goals": goals,
        "mapping": mapping,
        "competencies": _project_competencies(brain, language),
        "reflectionPreview": reflection_preview,
        "selfAwarenessNote": self_awareness_note,
        "updatedAt": brain.get("updated_at"),
    }
