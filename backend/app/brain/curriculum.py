"""Curriculum spine + content catalog seed (§4.3, §5.6, §8.6).

For math/science the objective graph AND the content are **supplied by the
Ministry** — this module is a small SEED/placeholder so the planner + pedagogical
loop are demoable end-to-end. Replace with the official MoE catalog import (do not
invent objectives/content for math/science beyond approved material).

- `learning_objectives`: ordered spine (topic → sub-topic → objective) with
  `order` (linear within a sub-topic) and `prerequisites[]`.
- `content_components`: per-objective components with 720 metadata
  (`masteryLevel`, `relativeDifficulty`, `languages`, `isAssessment`,
  `informationToBot`, `recommendedAfterFail`, activity `type`).
"""

from __future__ import annotations

from typing import Any, Optional

# ── Learning objectives (ordered spine) ──────────────────────────────────────
# DEMO catalog: a broader-but-still-placeholder 720 spine so the WHOLE flow
# (planner → pedagogical → dashboard → teacher view) is demoable across two
# subjects and multiple sub-topics. `order` is globally increasing within a
# subject so the planner walks a clean linear frontier. Replace with the
# official MoE import; ids stay stable so instrumented content keeps working.
LEARNING_OBJECTIVES: list[dict[str, Any]] = [
    # ── math · geometry · angles ──
    {"id": "math-angles", "subject": "math", "topic": "גאומטריה", "sub_topic": "זוויות",
     "order": 1, "prerequisites": [], "title": "זוויות — סוגים והגדרות"},
    {"id": "math-angles-vertical", "subject": "math", "topic": "גאומטריה", "sub_topic": "זוויות",
     "order": 2, "prerequisites": ["math-angles"], "title": "זוויות קודקודיות"},
    {"id": "math-angles-triangle", "subject": "math", "topic": "גאומטריה", "sub_topic": "זוויות",
     "order": 3, "prerequisites": ["math-angles-vertical"], "title": "סכום זוויות במשולש"},
    # ── math · arithmetic · fractions ──
    {"id": "math-fractions-intro", "subject": "math", "topic": "חשבון", "sub_topic": "שברים",
     "order": 4, "prerequisites": [], "title": "שברים — מבוא"},
    {"id": "math-fractions-equiv", "subject": "math", "topic": "חשבון", "sub_topic": "שברים",
     "order": 5, "prerequisites": ["math-fractions-intro"], "title": "שברים שווי ערך"},
    {"id": "math-fractions-percent", "subject": "math", "topic": "חשבון", "sub_topic": "שברים",
     "order": 6, "prerequisites": ["math-fractions-equiv"], "title": "משברים לאחוזים"},
    # ── science · matter ──
    {"id": "sci-matter-states", "subject": "science", "topic": "חומר", "sub_topic": "מצבי צבירה",
     "order": 1, "prerequisites": [], "title": "מצבי צבירה של החומר"},
    {"id": "sci-matter-changes", "subject": "science", "topic": "חומר", "sub_topic": "מצבי צבירה",
     "order": 2, "prerequisites": ["sci-matter-states"], "title": "מעברי מצב"},
    # ── science · electricity ──
    {"id": "sci-circuit-basic", "subject": "science", "topic": "חשמל", "sub_topic": "מעגלים",
     "order": 3, "prerequisites": [], "title": "מעגל חשמלי פשוט"},
    {"id": "sci-circuit-series", "subject": "science", "topic": "חשמל", "sub_topic": "מעגלים",
     "order": 4, "prerequisites": ["sci-circuit-basic"], "title": "מעגל טורי"},
]

# ── Content components (per objective) ────────────────────────────────────────
# Each objective has at least one assessment component (mastery gate), and a few
# carry an alternative representation via `recommendedAfterFail` (§8.6).
CONTENT_COMPONENTS: list[dict[str, Any]] = [
    # math · angles
    {"id": "YuviDori-math-angles-0001-lesson", "objective_id": "math-angles",
     "type": "onlinelesson", "masteryLevel": "basic", "relativeDifficulty": 0.3,
     "languages": ["he", "ar", "en"], "isAssessment": True,
     "informationToBot": "מטרת הפריט: לזהות סוגי זוויות (חדה/ישרה/קהה/שטוחה). טעות נפוצה: בלבול בין זווית חדה לקהה לפי גודל הפתיחה.",
     "recommendedAfterFail": "YuviDori-math-angles-0001-video"},
    {"id": "YuviDori-math-angles-0001-video", "objective_id": "math-angles",
     "type": "video", "masteryLevel": "basic", "relativeDifficulty": 0.2,
     "languages": ["he", "ar", "en"], "isAssessment": False,
     "informationToBot": "ייצוג חלופי (וידאו קצר) להסבר סוגי זוויות אחרי כישלון.",
     "recommendedAfterFail": None},
    {"id": "YuviDori-math-vertical-0002-practice", "objective_id": "math-angles-vertical",
     "type": "simulation", "masteryLevel": "intermediate", "relativeDifficulty": 0.5,
     "languages": ["he", "ar"], "isAssessment": True,
     "informationToBot": "מטרת הפריט: זוויות קודקודיות שוות. טעות נפוצה: בלבול בין קודקודיות לצמודות.",
     "recommendedAfterFail": None},
    {"id": "Yuvi-math-triangle-0003", "objective_id": "math-angles-triangle",
     "type": "onlinelesson", "masteryLevel": "intermediate", "relativeDifficulty": 0.55,
     "languages": ["he", "ar", "en"], "isAssessment": True,
     "informationToBot": "מטרת הפריט: סכום זוויות במשולש = 180°. טעות נפוצה: שכחת זווית שלישית.",
     "recommendedAfterFail": None},
    # math · fractions
    {"id": "Yuvi-math-fractions-0004", "objective_id": "math-fractions-intro",
     "type": "onlinelesson", "masteryLevel": "basic", "relativeDifficulty": 0.3,
     "languages": ["he", "ar", "en"], "isAssessment": True,
     "informationToBot": "מטרת הפריט: מונה ומכנה, ייצוג שבר. טעות נפוצה: בלבול בין מונה למכנה.",
     "recommendedAfterFail": None},
    {"id": "Yuvi-math-fractions-equiv-0005", "objective_id": "math-fractions-equiv",
     "type": "simulation", "masteryLevel": "intermediate", "relativeDifficulty": 0.5,
     "languages": ["he", "ar"], "isAssessment": True,
     "informationToBot": "מטרת הפריט: שברים שווי ערך על ידי הרחבה/צמצום.",
     "recommendedAfterFail": None},
    {"id": "Yuvi-math-fractions-percent-0006", "objective_id": "math-fractions-percent",
     "type": "onlinelesson", "masteryLevel": "advanced", "relativeDifficulty": 0.7,
     "languages": ["he", "ar", "en"], "isAssessment": True,
     "informationToBot": "מטרת הפריט: המרת שבר לאחוז. טעות נפוצה: בלבול בין מונה למכנה בהמרה.",
     "recommendedAfterFail": None},
    # science · matter
    {"id": "Yuvi-sci-matter-0001", "objective_id": "sci-matter-states",
     "type": "onlinelesson", "masteryLevel": "basic", "relativeDifficulty": 0.3,
     "languages": ["he", "ar", "en"], "isAssessment": True,
     "informationToBot": "מטרת הפריט: מוצק/נוזל/גז ותכונותיהם.",
     "recommendedAfterFail": None},
    {"id": "Yuvi-sci-matter-changes-0002", "objective_id": "sci-matter-changes",
     "type": "simulation", "masteryLevel": "intermediate", "relativeDifficulty": 0.5,
     "languages": ["he", "ar", "en"], "isAssessment": True,
     "informationToBot": "מטרת הפריט: התכה/קיפאון/רתיחה/עיבוי. טעות נפוצה: כיוון המעבר.",
     "recommendedAfterFail": None},
    # science · electricity
    {"id": "Yuvi-sci-circuit-0003", "objective_id": "sci-circuit-basic",
     "type": "simulation", "masteryLevel": "basic", "relativeDifficulty": 0.35,
     "languages": ["he", "ar", "en"], "isAssessment": True,
     "informationToBot": "מטרת הפריט: סגירת מעגל עם סוללה, חוט ונורה. טעות נפוצה: מעגל פתוח.",
     "recommendedAfterFail": "Yuvi-sci-circuit-0003-video"},
    {"id": "Yuvi-sci-circuit-0003-video", "objective_id": "sci-circuit-basic",
     "type": "video", "masteryLevel": "basic", "relativeDifficulty": 0.25,
     "languages": ["he", "ar", "en"], "isAssessment": False,
     "informationToBot": "ייצוג חלופי (וידאו קצר) — הדגמת סגירת מעגל.",
     "recommendedAfterFail": None},
    {"id": "Yuvi-sci-circuit-series-0004", "objective_id": "sci-circuit-series",
     "type": "simulation", "masteryLevel": "intermediate", "relativeDifficulty": 0.55,
     "languages": ["he", "ar"], "isAssessment": True,
     "informationToBot": "מטרת הפריט: חיבור נורות בטור. טעות נפוצה: השפעת נורה שרופה על המעגל.",
     "recommendedAfterFail": None},
]

_OBJ_BY_ID = {o["id"]: o for o in LEARNING_OBJECTIVES}
_COMP_BY_ID = {c["id"]: c for c in CONTENT_COMPONENTS}


def objectives_for(subject: str) -> list[dict[str, Any]]:
    """Ordered objective spine for a subject (linear within a sub-topic)."""
    return sorted(
        (o for o in LEARNING_OBJECTIVES if o["subject"] == subject),
        key=lambda o: o["order"],
    )


def get_objective(objective_id: str) -> Optional[dict[str, Any]]:
    return _OBJ_BY_ID.get(objective_id)


def get_component(component_id: str) -> Optional[dict[str, Any]]:
    return _COMP_BY_ID.get(component_id)


def components_for(objective_id: str) -> list[dict[str, Any]]:
    return [c for c in CONTENT_COMPONENTS if c["objective_id"] == objective_id]
