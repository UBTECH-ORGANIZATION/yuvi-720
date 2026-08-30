"""Dashboard projection (F4) — a deterministic view of the Learner Brain.

Progress comes from real mastery events, goals come from mentoring, and learner
profile information comes from mapping. The LLM invents no values here. The v2
projection adds a read-only next-step preview, resume context, localized
curriculum labels, reflection preview, and learner-safe verbal descriptors.
"""

from __future__ import annotations

from typing import Any, Optional

from app.services import content_catalog
from app.services.kata_catalog import (
    get_component,
    localized_objective_title,
    objectives_for,
)
from app.services.planner import next_focus, plan_next

# Scope for תשפ"ז — the two Ministry subjects (§8.6).
DEFAULT_SUBJECTS = ("math", "science")

SUBJECT_NAMES = {
    "math":    {"he": "מתמטיקה", "en": "Mathematics", "ar": "الرياضيات"},
    "science": {"he": "מדע וטכנולוגיה", "en": "Science & Technology", "ar": "العلوم والتكنولوجيا"},
    "english": {"he": "אנגלית", "en": "English", "ar": "الإنجليزية"},
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

# Each activeness competency maps 1:1 to an official MoE agency measure (1–6);
# measure 7 (attitude to computer learning) has no competency domain. Used to
# surface the rubric level (1–5) per domain on the activeness map.
COMPETENCY_TO_MEASURE = {
    "motivation_relevance": 1,
    "growth_mindset": 2,
    "initiative_responsibility": 3,
    "self_regulation": 4,
    "self_awareness": 5,
    "support_emotional": 6,
}

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
    "pinned": {
        "he": "המורה בחר/ה בשבילך את הצעד הזה.",
        "en": "Your teacher chose this step for you.",
        "ar": "اختار معلّمك/معلّمتك هذه الخطوة لك.",
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


# Mastery ranks a single objective; a subject needs one word for many of them.
_MASTERY_RANK = {"basic": 0, "intermediate": 1, "advanced": 2}


def _subject_mastery_level(mastery: dict, subject: str) -> str:
    """One level word for a whole subject, from its objectives' mastery levels.

    The **median**, not the maximum: a single objective carried to `advanced`
    must not label the entire subject advanced while the rest sit at `basic`.
    """
    ranks = sorted(
        _MASTERY_RANK.get(str(entry.get("level") or "basic"), 0)
        for entry in mastery.values()
        if isinstance(entry, dict)
        and entry.get("subject") == subject
        and int(entry.get("attempts") or 0) > 0
    )
    if not ranks:
        return "starting"
    median = ranks[(len(ranks) - 1) // 2]
    return next(key for key, rank in _MASTERY_RANK.items() if rank == median)


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
        # Same rule as `insights.objective_breakdown`, so the child's bar and the
        # teacher's row can never disagree about the same objective.
        score = entry.get("score_ewma")
        percent = 100 if done else (
            max(0, min(99, round(100 * float(score))))
            if isinstance(score, (int, float)) else 0)
        items.append({
            "objectiveId": objective_id,
            "topic": localized_objective_title(objective_id, language),
            "status": _t(STATUS_WORDS, status_key, language),
            "statusClass": (
                "curr-done" if done else "curr-current" if status_key == "current" else "curr-upcoming"
            ),
            "percent": percent,
            "needsReview": bool(entry.get("needs_review")),
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
            # The mastery scale (basic/intermediate/advanced), localized client-side.
            "levelKey": _subject_mastery_level(brain.get("mastery") or {}, subject),
            "gradient": SUBJECT_GRADIENT.get(subject, "linear-gradient(135deg, #7c5cff, #9f7afe)"),
            "description": _t(LEVEL_WORDS, level_key, language),
            "curriculum": _subject_curriculum(
                brain, subject, language, next_ids[0] if next_ids else None
            ),
        })
    return out


def _project_competencies(
    brain: dict, language: str, effective: dict[str, dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """Project the six activeness competencies for the learner UI.

    `effective` (from app.brain.activeness) carries the dynamic score — the
    questionnaire base nudged by recent activity — plus per-domain "cause" tags
    that drive state-aware improve tips. When absent, we fall back to the raw
    onboarding base so the projection never depends on live signals being ready.
    """
    from app.brain.activeness import MIN_CAUSE_CONF

    base = (brain.get("profile") or {}).get("activeness") or {}
    # Official rubric level (1–5) per measure from the mapping, keyed by measure
    # number → the map shows each domain's self-reported agency level (verbal).
    measures = (brain.get("profile") or {}).get("mapping_measures") or []
    level_by_measure: dict[int, dict[str, Any]] = {}
    if isinstance(measures, list):
        for m in measures:
            if isinstance(m, dict) and isinstance(m.get("measure"), int):
                level_by_measure[m["measure"]] = m
    out = []
    for key in COMPETENCY_ORDER:
        meta = COMPETENCY_META[key]
        eff = (effective or {}).get(key) or {}
        value = int(eff.get("value", base.get(key, 0)))
        tone = "strong" if value >= 70 else "steady" if value >= 45 else "support"
        measure_row = level_by_measure.get(COMPETENCY_TO_MEASURE.get(key, 0))
        out.append({
            "key": key,
            "icon": meta["icon"],
            "label": _t(COMPETENCY_META, key, language),
            # Kept for backward compatibility and internal visualization only.
            # The v2 learner UI renders descriptor/tone, never this number.
            "value": value,
            "descriptor": _t(BAND_WORDS, tone, language),
            "tone": tone,
            # Official rubric level (1–5) + its key for the map's verbal reflection
            # (localized on the client via `mapping.level.<key>`). Null until the
            # learner completes the mapping questionnaire.
            "mappingLevel": (measure_row or {}).get("level") or None,
            "mappingLevelKey": (measure_row or {}).get("level_key") or None,
            # State-aware "how to improve" cause tags (behavioural, no numbers).
            "improve": list(eff.get("causes") or []),
            # Where this domain stood a week ago, from the same engine that
            # names the reason — so the arrow and its explanation cannot
            # disagree. Null when there is no live signal to compare.
            "priorValue": eff.get("prior_value"),
            # What actually moved this domain, signed. The learner UI names it
            # when explaining a change, so the reason is an observed behaviour.
            "drivers": [
                {
                    **{k: v for k, v in d.items() if k != "objective_id"},
                    # Resolved here, not in the brain: the ministry title is a
                    # catalog concern and it has to follow the UI's language.
                    **({"lesson": localized_objective_title(d["objective_id"], language)}
                       if d.get("objective_id") else {}),
                }
                for d in (eff.get("drivers") or [])
            ],
            # True only when there's enough real activity to name *why* the score
            # sits where it does. The map gates its change arrow on this so it can
            # never claim a movement it couldn't explain (seeded/fabricated
            # history with no events behind it → no arrow).
            "evidenceBacked": float(eff.get("confidence") or 0) >= MIN_CAUSE_CONF,
        })
    return out



def _goal_context(objective_id: Optional[str]) -> dict[str, Any]:
    """The goal's own words, for a hero visual that matches the lesson.

    The dashboard hero used to pick its interactive scene from two keywords in a
    title and otherwise draw a planet in orbit — so a goal about weighing solids
    on a balance opened the page with a solar system. The registry has the real
    vocabulary; this hands it to the client.
    """
    if not objective_id:
        return {"subTopicTitle": "", "topicTitle": "", "goalDescription": ""}
    from app.services.kata_catalog import get_objective
    goal = get_objective(objective_id) or {}
    return {
        "subTopicTitle": goal.get("title") or "",
        "topicTitle": goal.get("topic_title") or "",
        "goalDescription": goal.get("description") or "",
    }

def _hero(
    brain: dict, language: str, completed_ids: frozenset[str] | set[str] = frozenset()
) -> dict[str, Any]:
    """Build a read-only resume/next preview; never mutate current_state."""
    from app.brain.mastery import entry_for
    from app.services import pinning

    mastery = brain.get("mastery") or {}
    current = brain.get("current_state") or {}

    # The resume candidate is judged BEFORE the pin (#244), even though the pin
    # outranks it: while a pin holds the hero, the unfinished lesson is still
    # sitting in `current_state`, and the child must be able to get back to it.
    # Resume used to require `current_state.resume_token`, which is only ever
    # written from an xAPI extension no provider has ever sent — so the branch
    # was dead and a learner mid-lesson was greeted with "start something new".
    # The real signal is the one we already have: they launched a component and
    # have not finished it. §6 puts the position INSIDE the component on the
    # content anyway ("שמירת התקדמות … וחזרה לאותה הנקודה"), so the token is a
    # bonus, never the gate.
    current_component_id = current.get("component_id") or current.get("item_id")
    current_component = get_component(current_component_id) if current_component_id else None
    current_objective_id = (current_component or {}).get("objective_id")
    can_resume = bool(
        current_component
        and str(current_component_id) not in set(completed_ids)
        and not entry_for(mastery, current_objective_id).get("achieved")
    )

    # A teacher's pin outranks everything, resume included: it exists precisely
    # for "not that one — this one", said to a child mid-something-else. What
    # still steers is `pinning.active_pin`'s single judgement — uncompleted,
    # unexpired — shared with the route and the teacher reads, so the four can
    # never disagree about whether a pin is live.
    pinned = pinning.active_pin(brain, completed_ids=completed_ids)
    # An objective pin resolves to a component HERE, per read: the teacher
    # named the goal, the planner allocates the fitting step inside it as the
    # child progresses. None = the goal ran dry for this learner — the pin is
    # spent, and the hero falls back to its own reading of the moment.
    allocated = None
    if pinned is not None and pinning.pin_kind(pinned) == pinning.KIND_OBJECTIVE:
        allocated = pinning.objective_next(pinned, brain, completed_ids, language)
        if allocated is None:
            pinned = None
    if pinned is not None:
        # The lesson the pin displaced, carried on the payload so the hero can
        # keep "continue where you stopped" reachable as a secondary door. Not
        # when it IS the pinned thing — a second link to the primary is noise.
        aside = None
        pinned_target = (
            str(allocated.get("id")) if allocated is not None
            else pinning.target_id(pinned)
        )
        if can_resume and str(current_component_id) != pinned_target:
            aside = {
                "componentId": current_component_id,
                "unitId": (current_component or {}).get("unit_id") or current.get("unit_id"),
                "objectiveTitle": localized_objective_title(current_objective_id, language)
                or (current_component or {}).get("title"),
            }

        if pinning.pin_kind(pinned) == pinning.KIND_TASK:
            # A task is not catalog content: no component, no unit, no plan —
            # the frontend routes straight to `/tasks/{launchId}` and must not
            # ask the planner, which only speaks components.
            return {
                "mode": "pinned",
                "pinnedKind": "task",
                "taskId": pinned.get("task_id"),
                "launchId": pinned.get("launch_id"),
                "subjectKey": None,
                "subjectName": None,
                "objectiveId": None,
                # The task's own title, frozen at pin time — the one honest
                # headline we have for content the catalog has never seen.
                "objectiveTitle": pinned.get("title"),
                **_goal_context(None),
                "componentId": None,
                "unitId": None,
                "canResume": False,
                "resume": aside,
                "reason": _t(HERO_REASON, "pinned", language),
                "pace": _t(PACE_WORDS, current.get("pace"), language)
                if current.get("pace") else None,
            }

        if allocated is not None:
            # The goal's allocation, already resolved above — the payload is a
            # component pin's in every field the frontend routes on, so the
            # child's start button needs no new path.
            pinned_component_id = str(allocated.get("id"))
            pinned_component = allocated
            pinned_objective_id = str(pinned["objective_id"])
        else:
            pinned_component_id = pinned["component_id"]
            pinned_component = get_component(pinned_component_id) or {}
            pinned_objective_id = (
                pinned.get("objective_id") or pinned_component.get("objective_id"))
        subject = pinned_component.get("subject") or entry_for(
            mastery, pinned_objective_id).get("subject")
        plan: dict[str, Any] = {}
        if pinned_objective_id:
            plan = content_catalog.objective_plan(
                pinned_objective_id,
                mastery_entry=entry_for(mastery, pinned_objective_id),
                completed_ids=completed_ids,
                signals=content_catalog.learner_signals(brain),
                locale=language,
            ) or {}
        return {
            "mode": "pinned",
            "pinnedKind": pinning.pin_kind(pinned),
            "subjectKey": subject,
            "subjectName": _t(SUBJECT_NAMES, subject, language),
            "objectiveId": pinned_objective_id,
            "objectiveTitle": localized_objective_title(pinned_objective_id, language)
            if pinned_objective_id else pinned_component.get("title"),
            **_goal_context(pinned_objective_id),
            "componentId": pinned_component_id,
            "unitId": pinned.get("unit_id") or pinned_component.get("unit_id"),
            "pathNodeId": f"{pinned_component_id}#1",
            "progressRatio": plan.get("progress_ratio"),
            "canResume": False,
            "resume": aside,
            "reason": _t(HERO_REASON, "pinned", language),
            "pace": _t(PACE_WORDS, current.get("pace"), language) if current.get("pace") else None,
        }

    if can_resume:
        subject = entry_for(mastery, current_objective_id).get("subject")
        if not subject:
            # `startswith("sci-")` predated the MoE ids and resolved every
            # `MOE.SCI.…` goal to math; the catalog already knows the answer.
            from app.services.kata_client import subject_from_objective
            subject = subject_from_objective(
                str(current_objective_id or ""), (current_component or {}).get("sub_topic") or "",
            )
        return {
            "mode": "resume",
            "resume": None,
            "subjectKey": subject,
            "subjectName": _t(SUBJECT_NAMES, subject, language),
            "objectiveId": current_objective_id,
            "objectiveTitle": localized_objective_title(current_objective_id, language),
            **_goal_context(current_objective_id),
            "componentId": current_component_id,
            "unitId": (current_component or {}).get("unit_id") or current.get("unit_id"),
            "pathNodeId": f"{current_component_id}#1",
            "progressRatio": (content_catalog.objective_plan(
                current_objective_id,
                mastery_entry=entry_for(mastery, current_objective_id),
                completed_ids=completed_ids,
                signals=content_catalog.learner_signals(brain),
                locale=language,
            ) or {}).get("progress_ratio"),
            "canResume": True,
            "reason": _t(HERO_REASON, "resume", language),
            "pace": _t(PACE_WORDS, current.get("pace"), language) if current.get("pace") else None,
        }

    # Cross-subject focus: global review-due first, else most-behind subject.
    focus = next_focus(brain)
    subject = focus["subject"]
    objective_id = focus["objective_id"]

    if objective_id:
        # The SAME plan the roadmap renders — the hero used to run its own picker
        # and could name a component the route did not consider next.
        plan = content_catalog.objective_plan(
            objective_id,
            mastery_entry=entry_for(mastery, objective_id),
            completed_ids=completed_ids,
            signals=content_catalog.learner_signals(brain),
            locale=language,
        ) or {}
        return {
            "mode": "next",
            "resume": None,
            "subjectKey": subject,
            "subjectName": _t(SUBJECT_NAMES, subject, language),
            "objectiveId": objective_id,
            "objectiveTitle": localized_objective_title(objective_id, language),
            **_goal_context(objective_id),
            "componentId": plan.get("next_component_id"),
            "unitId": plan.get("id"),
            "pathNodeId": plan.get("next_path_node_id"),
            # A ratio, not a count: the learner is never shown "step 3 of 5",
            # because an adaptive path's denominator moves (§C of the design).
            "progressRatio": plan.get("progress_ratio"),
            "canResume": False,
            "reason": _t(HERO_REASON, "next", language),
            "pace": _t(PACE_WORDS, current.get("pace"), language) if current.get("pace") else None,
        }

    return {
        "mode": "complete",
        "resume": None,
        "subjectKey": None,
        "subjectName": None,
        "objectiveId": None,
        "objectiveTitle": None,
        **_goal_context(None),
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


# A mentoring goal advances through three visible steps after being chosen, so
# the learner-facing progress bar reflects real self-reported progress.
_GOAL_STEP_DONE = {"chosen": 0, "started": 1, "progressed": 2, "summarized": 3}


def _goal_steps(goal: dict[str, Any]) -> dict[str, Any] | None:
    """Derive `{done, total}` from the goal's progress stage."""
    stage = goal.get("progress_stage")
    if isinstance(stage, str) and stage in _GOAL_STEP_DONE:
        return {"done": _GOAL_STEP_DONE[stage], "total": 3}
    if goal.get("status") == "done":
        return {"done": 3, "total": 3}
    steps = goal.get("steps")
    return steps if isinstance(steps, dict) else None


def project_dashboard(
    brain: dict, name: str, language: str = "he",
    effective_activeness: dict[str, dict[str, Any]] | None = None,
    completed_component_ids: frozenset[str] | set[str] = frozenset(),
) -> dict[str, Any]:
    """Project the brain into the dashboard DTO (real numbers only).

    `effective_activeness` is the dynamic competency map (base + live signals);
    when omitted the projection uses the raw onboarding base.
    """
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
            "steps": _goal_steps(g),
            "done": g.get("status") == "done",
            "deadline": g.get("deadline"),
            "rewardValue": g.get("reward_value"),
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
        "hero": _hero(brain, language, completed_component_ids),
        "subjects": _project_subjects(brain, language),
        "difficulties": difficulties,
        "goals": goals,
        "mapping": mapping,
        "competencies": _project_competencies(brain, language, effective_activeness),
        "reflectionPreview": reflection_preview,
        "selfAwarenessNote": self_awareness_note,
        "updatedAt": brain.get("updated_at"),
    }
