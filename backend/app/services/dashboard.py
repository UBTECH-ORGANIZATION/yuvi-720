"""Dashboard projection (F4) — the dashboard is a projection of the brain, not
LLM invention (§9). Progress comes from real `mastery`/`progress`; competencies
from `profile.activeness`; strengths/challenges/goals/mapping from the brain.
The LLM invents **no numbers** here. Output keeps the existing dashboard DTO so
the current UI renders unchanged; the verbal, non-numeric refactor is P4 (§17).
"""

from __future__ import annotations

from typing import Any

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


def _subject_curriculum(brain: dict, subject: str, language: str) -> list[dict[str, Any]]:
    """Curriculum list from real mastery entries tagged with this subject."""
    mastery = brain.get("mastery") or {}
    items = []
    for objective_id, entry in mastery.items():
        if not isinstance(entry, dict) or entry.get("subject") != subject:
            continue
        done = bool(entry.get("achieved"))
        status_key = "done" if done else "current"
        items.append({
            "topic": objective_id,
            "status": _t(STATUS_WORDS, status_key, language),
            "statusClass": "curr-done" if done else "curr-current",
        })
    return items


def _project_subjects(brain: dict, language: str) -> list[dict[str, Any]]:
    progress = brain.get("progress") or {}
    subjects_present = [s for s in DEFAULT_SUBJECTS if s in progress] or list(DEFAULT_SUBJECTS)
    out = []
    for subject in subjects_present:
        p = progress.get(subject) or {}
        total = int(p.get("objectives_total", 0))
        mastered = int(p.get("objectives_mastered", 0))
        pct = round((mastered / total) * 100) if total else 0
        has_events = total > 0
        level_key = _level_key(pct, has_events)
        out.append({
            "name": _t(SUBJECT_NAMES, subject, language),
            "icon": SUBJECT_ICON.get(subject, "📘"),
            "iconBg": SUBJECT_ICON_BG.get(subject, "rgba(124,92,255,0.1)"),
            "progress": pct,
            "level": _t(LEVEL_WORDS, level_key, language),
            "levelClass": "level-great" if pct >= 80 else "level-good" if pct >= 50 else "level-building",
            "gradient": SUBJECT_GRADIENT.get(subject, "linear-gradient(135deg, #7c5cff, #9f7afe)"),
            "description": _t(LEVEL_WORDS, level_key, language),
            "curriculum": _subject_curriculum(brain, subject, language),
        })
    return out


def _project_competencies(brain: dict, language: str) -> list[dict[str, Any]]:
    activeness = (brain.get("profile") or {}).get("activeness") or {}
    out = []
    for key in COMPETENCY_ORDER:
        meta = COMPETENCY_META[key]
        out.append({
            "icon": meta["icon"],
            "label": _t(COMPETENCY_META, key, language),
            "value": int(activeness.get(key, 0)),
            "descriptor": "",
        })
    return out


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
        if isinstance(c, dict)
    ]

    goals = [
        {
            "text": g.get("text", ""),
            "meta": g.get("source", ""),
            "source": g.get("source", ""),
            "done": g.get("status") == "done",
        }
        for g in (brain.get("goals") or [])
        if isinstance(g, dict) and g.get("visible_to_learner", True)
    ]

    mapping = {
        "interests": profile.get("interests") or [],
        "learningStyle": profile.get("learning_style") or "",
        "preferences": profile.get("preferences") or [],
        "environment": profile.get("environment") or "",
        "strengths": [s.get("label") for s in (brain.get("strengths") or []) if isinstance(s, dict)],
    }

    return {
        "name": display_name,
        "avatar": display_name[0] if display_name else "ת",
        "subjects": _project_subjects(brain, language),
        "difficulties": difficulties,
        "goals": goals,
        "mapping": mapping,
        "competencies": _project_competencies(brain, language),
    }
