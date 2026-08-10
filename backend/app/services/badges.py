"""Badge projection — badges are a read-only view of the learner brain.

Same discipline as the dashboard: nothing is invented or separately tracked.
Every badge carries a localized ``how_to_earn`` so the shelf can teach a kid how
to win it, and a ``category`` so the UI can group them:

- ``subject``   one coin per Kata subject; state+tier from mastered/total + level.
- ``milestone`` behavioural coins (streaks, first steps, comeback…), each derived
                from a real brain signal; gold "spark" family, no star tiers.
- ``world``     the capstone — earned when every subject coin is earned.
- ``coming``    subjects Kata does not carry yet, shown locked as "coming soon".
"""

from __future__ import annotations

from typing import Any, Callable

from app.brain.mastery import entry_for
from app.services import kata_catalog
from app.services.planner import DEFAULT_SUBJECTS, plan_next

# ── localized copy helper ──
Str = dict[str, str]


def _t(text: Str, locale: str) -> str:
    return text.get("en") if locale == "en" else text.get("he", text.get("en", ""))


# Subject → coin glyph + display name + how-to.
_SUBJECT_META: dict[str, dict[str, Any]] = {
    "science": {
        "glyph": "flask", "motif": "orbit",
        "badge": {"he": "חוקר/ת מעבדה", "en": "Lab Explorer"},
        "howto": {"he": "התקדמו בכל יעדי הלמידה במדע. הטבעת מתמלאת ככל שמתקדמים — וכשמסיימים הכל, המטבע שלכם.",
                  "en": "Progress through every science goal. The ring fills as you go — finish them all to earn the coin."},
    },
    "math": {
        "glyph": "math", "motif": "rays",
        "badge": {"he": "מגלה/ת מספרים", "en": "Number Navigator"},
        "howto": {"he": "התקדמו בכל יעדי הלמידה במתמטיקה. כשמסיימים את כולם — המטבע שלכם.",
                  "en": "Progress through every math goal. Finish them all to earn the coin."},
    },
    "english": {
        "glyph": "book", "motif": "rays",
        "badge": {"he": "אמן/ית מילים", "en": "Word Weaver"},
        "howto": {"he": "התקדמו בכל יעדי הלמידה באנגלית — הקשבה, קריאה, כתיבה ודיבור. כשמסיימים את כולם — המטבע שלכם.",
                  "en": "Progress through every English goal — listening, reading, writing and speaking. Finish them all to earn the coin."},
    },
}
_DEFAULT_GLYPH = "gear"

_WORLD_TITLE = {"he": "עמק הנחיתה", "en": "Arrival Valley"}
_WORLD_HOWTO = {"he": "סיימו את כל המקצועות כדי לזכות במטבע העולם — ההישג הכי גדול.",
                "en": "Complete every subject to win the world coin — the biggest achievement."}

# Subjects Kata does not carry yet — shown locked so the shelf feels whole.
_COMING: list[dict[str, Any]] = [
    {"subject": "discovery", "glyph": "planet", "title": {"he": "חוקר/ת חלל", "en": "Cosmic Explorer"}},
    {"subject": "stem", "glyph": "gear", "title": {"he": "יוצר/ת", "en": "Maker Spark"}},
]
_COMING_HOWTO = {"he": "בקרוב — כשנוסיף תוכן במקצוע הזה תוכלו להתחיל לאסוף אותו.",
                 "en": "Coming soon — when this subject gets content you can start earning it."}

_LEVEL_RANK = {"basic": 0, "intermediate": 1, "advanced": 2}


# ── shared brain readers ──
def _entries(mastery: dict[str, Any]) -> list[dict[str, Any]]:
    return [e for e in mastery.values() if isinstance(e, dict)]


# ── milestone difficulty (tunable). The demanding ones reward *coming back* —
#    real learning happens across sessions and days, not one long sitting. ──
_ON_FIRE_TARGET = 8        # correct answers in a row, no miss
_SHARP_TARGET = 3          # assessments passed
_COMEBACK_TARGET = 2       # goals recovered from real struggle
_COMEBACK_MIN_FAILS = 2    # ...where "real struggle" = ≥2 failures before mastery
_DEDICATED_DAYS = 5        # learn on this many different days (any spacing)
_CONSISTENCY_STREAK = 3    # ...on this many days *in a row* — the return habit


def _achieved_count(mastery: dict[str, Any]) -> int:
    return sum(1 for e in _entries(mastery) if e.get("achieved"))


def _max_streak(mastery: dict[str, Any]) -> int:
    return max((int(e.get("consecutive_successes") or 0) for e in _entries(mastery)), default=0)


def _comeback_count(mastery: dict[str, Any]) -> int:
    return sum(1 for e in _entries(mastery)
               if e.get("achieved") and int(e.get("failures") or 0) >= _COMEBACK_MIN_FAILS)


def _best_score(mastery: dict[str, Any]) -> float:
    return max((float(e.get("score_ewma") or 0) for e in _entries(mastery)), default=0.0)


def _subjects_with_mastery(mastery: dict[str, Any], subjects: tuple[str, ...]) -> int:
    count = 0
    for subject in subjects:
        ids = [o["id"] for o in kata_catalog.objectives_for(subject)]
        if any(entry_for(mastery, oid).get("achieved") for oid in ids):
            count += 1
    return count


def _active_days(events: list[dict[str, Any]] | None) -> set[str]:
    """Distinct calendar days (YYYY-MM-DD) the learner was active, from events."""
    return {str(e.get("occurred_at"))[:10] for e in (events or []) if e.get("occurred_at")}


def _longest_day_streak(days: set[str]) -> int:
    """Longest run of consecutive calendar days present in ``days``."""
    from datetime import date
    parsed = []
    for d in days:
        try:
            parsed.append(date.fromisoformat(d))
        except ValueError:
            continue
    if not parsed:
        return 0
    parsed.sort()
    best = run = 1
    for prev, cur in zip(parsed, parsed[1:]):
        gap = (cur - prev).days
        if gap == 1:
            run += 1
            best = max(best, run)
        elif gap > 1:
            run = 1
    return best


# ── milestone predicates: (mastery, subjects, stats) -> (state, progress) ──
def _p_first_steps(mastery, subjects, stats):
    if _achieved_count(mastery) >= 1:
        return ("earned", 1.0)
    if any(e.get("last_evidence_at") for e in _entries(mastery)):
        return ("inprogress", round(min(_best_score(mastery), 0.99), 3))
    return ("locked", 0.0)


def _p_sharpshooter(mastery, subjects, stats):
    n = _achieved_count(mastery)
    if n >= _SHARP_TARGET:
        return ("earned", 1.0)
    return ("inprogress", round(n / _SHARP_TARGET, 3)) if n > 0 else ("locked", 0.0)


def _p_on_fire(mastery, subjects, stats):
    cs = _max_streak(mastery)
    if cs >= _ON_FIRE_TARGET:
        return ("earned", 1.0)
    return ("inprogress", round(cs / _ON_FIRE_TARGET, 3)) if cs > 0 else ("locked", 0.0)


def _p_comeback(mastery, subjects, stats):
    n = _comeback_count(mastery)
    if n >= _COMEBACK_TARGET:
        return ("earned", 1.0)
    return ("inprogress", round(n / _COMEBACK_TARGET, 3)) if n > 0 else ("locked", 0.0)


def _p_dedicated(mastery, subjects, stats):
    d = int(stats.get("active_days") or 0)
    if d >= _DEDICATED_DAYS:
        return ("earned", 1.0)
    return ("inprogress", round(d / _DEDICATED_DAYS, 3)) if d > 0 else ("locked", 0.0)


def _p_consistency(mastery, subjects, stats):
    s = int(stats.get("day_streak") or 0)
    if s >= _CONSISTENCY_STREAK:
        return ("earned", 1.0)
    return ("inprogress", round(s / _CONSISTENCY_STREAK, 3)) if s > 0 else ("locked", 0.0)


def _p_explorer(mastery, subjects, stats):
    n = _subjects_with_mastery(mastery, subjects)
    if n >= 2:
        return ("earned", 1.0)
    return ("inprogress", 0.5) if n == 1 else ("locked", 0.0)


# Each milestone gets its OWN coin colour (`subject`) + background motif, so the
# shelf reads as a varied collection, not seven gold clones.
_MILESTONES: list[dict[str, Any]] = [
    {"key": "first_steps", "subject": "spark", "glyph": "flame", "motif": "rays", "predicate": _p_first_steps,
     "title": {"he": "צעד ראשון", "en": "First Steps"},
     "howto": {"he": "השלימו את יעד הלמידה הראשון שלכם — לא רק לנסות, אלא לשלוט בו.",
               "en": "Complete your first learning goal — not just try it, master it."}},
    {"key": "consistency", "subject": "streak", "glyph": "valley", "motif": "orbit", "predicate": _p_consistency,
     "title": {"he": "רצף התמדה", "en": "Streak"},
     "howto": {"he": "היכנסו ולמדו שלושה ימים ברציפות — יום אחרי יום.",
               "en": "Come back and learn three days in a row — day after day."}},
    {"key": "dedicated", "subject": "devote", "glyph": "book", "motif": "sparkle", "predicate": _p_dedicated,
     "title": {"he": "מתמידים", "en": "Dedicated"},
     "howto": {"he": "למדו בחמישה ימים שונים — לחזור שוב ושוב זה מה שבונה ידע.",
               "en": "Learn on five different days — coming back again and again is what builds real knowledge."}},
    {"key": "on_fire", "subject": "flame", "glyph": "flame", "motif": "rays", "predicate": _p_on_fire,
     "title": {"he": "רצף לוהט", "en": "On Fire"},
     "howto": {"he": "ענו נכון על שמונה שאלות ברצף — בלי אף טעות.",
               "en": "Answer eight questions in a row — no misses."}},
    {"key": "sharpshooter", "subject": "aim", "glyph": "gear", "motif": "target", "predicate": _p_sharpshooter,
     "title": {"he": "קליעה למטרה", "en": "Sharpshooter"},
     "howto": {"he": "עברו בהצלחה שלושה מבחנים בשלושה יעדי למידה.",
               "en": "Pass the assessment on three different learning goals."}},
    {"key": "comeback", "subject": "revive", "glyph": "comeback", "motif": "orbit", "predicate": _p_comeback,
     "title": {"he": "חזרה מנצחת", "en": "Comeback Kid"},
     "howto": {"he": "התמידו בשני יעדים קשים: טעיתם שוב ושוב, לא ויתרתם — ובסוף הצלחתם.",
               "en": "Push through two tough goals: miss again and again, don't quit, and finally master them."}},
    {"key": "explorer", "subject": "cosmos", "glyph": "planet", "motif": "sparkle", "predicate": _p_explorer,
     "title": {"he": "חוקר/ת סקרן/ית", "en": "Explorer"},
     "howto": {"he": "הגיעו לשליטה בלפחות יעד אחד גם במתמטיקה וגם במדע.",
               "en": "Reach mastery in at least one goal in both math and science."}},
]


def _tier_for(objective_ids: list[str], mastery: dict[str, Any]) -> str:
    if not objective_ids:
        return "bronze"
    ranks = [_LEVEL_RANK.get(entry_for(mastery, oid).get("level") or "basic", 0) for oid in objective_ids]
    if all(r >= 2 for r in ranks):
        return "gold"
    if all(r >= 1 for r in ranks):
        return "silver"
    return "bronze"


def _has_evidence(objective_ids: list[str], mastery: dict[str, Any]) -> bool:
    return any(entry_for(mastery, oid).get("last_evidence_at") for oid in objective_ids)


def _subject_badge(subject: str, info: dict[str, Any], mastery: dict[str, Any], locale: str) -> dict[str, Any] | None:
    objectives = kata_catalog.objectives_for(subject)
    if not objectives:
        return None
    objective_ids = [o["id"] for o in objectives]
    total = int(info.get("total") or 0)
    mastered = int(info.get("mastered") or 0)
    ratio = (mastered / total) if total else 0.0

    if ratio >= 1 and total:
        state, earned = "earned", True
    elif ratio > 0 or _has_evidence(objective_ids, mastery):
        state, earned = "inprogress", False
    else:
        state, earned = "locked", False

    meta = _SUBJECT_META.get(subject, {"glyph": _DEFAULT_GLYPH, "badge": {}, "howto": {}})
    title = (meta.get("badge") or {}).get(locale) or kata_catalog.localized_objective_title(objective_ids[0], locale)
    certifies = [kata_catalog.localized_objective_title(oid, locale) for oid in objective_ids]

    return {
        "subject": subject, "glyph": meta.get("glyph", _DEFAULT_GLYPH),
        "tier": _tier_for(objective_ids, mastery), "state": state,
        "progress": round(ratio, 3), "title": title,
        "meta": certifies[0] if certifies else "", "certifies": certifies,
        "earned": earned, "earnedAt": None, "category": "subject", "noStars": False,
        "motif": meta.get("motif"), "howToEarn": _t(meta.get("howto") or {}, locale),
    }


def project_badges(
    brain: dict[str, Any],
    *,
    locale: str = "he",
    subjects: tuple[str, ...] = DEFAULT_SUBJECTS,
    events: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """All badges for a learner, computed from the brain. ``events`` powers the
    return-over-days milestones. Prime ``kata_catalog.ensure_loaded()`` first."""
    mastery = brain.get("mastery") or {}
    plan = plan_next(brain, subjects)
    days = _active_days(events)
    stats = {"active_days": len(days), "day_streak": _longest_day_streak(days)}
    badges: list[dict[str, Any]] = []

    # 1. Subject coins.
    subject_badges = []
    for subject in subjects:
        badge = _subject_badge(subject, plan.get(subject) or {}, mastery, locale)
        if badge is not None:
            subject_badges.append(badge)
    badges.extend(subject_badges)

    # 2. World capstone — earned only when every subject coin is earned.
    total = sum(int((plan.get(s) or {}).get("total") or 0) for s in subjects)
    mastered = sum(int((plan.get(s) or {}).get("mastered") or 0) for s in subjects)
    ratio = (mastered / total) if total else 0.0
    all_earned = bool(subject_badges) and all(b["earned"] for b in subject_badges)
    badges.append({
        "subject": "world", "glyph": "valley", "tier": "gold",
        "state": "earned" if all_earned else ("inprogress" if ratio > 0 else "locked"),
        "progress": round(ratio, 3), "title": _t(_WORLD_TITLE, locale),
        "meta": _t(_WORLD_TITLE, locale), "certifies": [b["title"] for b in subject_badges],
        "earned": all_earned, "earnedAt": None, "category": "world", "noStars": False,
        "motif": "rays", "howToEarn": _t(_WORLD_HOWTO, locale),
    })

    # 3. Milestone (behavioural) coins — each its own colour + motif, no star tiers.
    predicate: Callable[..., tuple[str, float]]
    for m in _MILESTONES:
        predicate = m["predicate"]
        state, progress = predicate(mastery, subjects, stats)
        badges.append({
            "subject": m["subject"], "glyph": m["glyph"], "tier": "gold", "state": state,
            "progress": progress, "title": _t(m["title"], locale), "meta": "",
            "certifies": [], "earned": state == "earned", "earnedAt": None,
            "category": "milestone", "noStars": True, "motif": m["motif"],
            "howToEarn": _t(m["howto"], locale),
        })

    # 4. Coming-soon subjects (not yet in Kata).
    present = {b["subject"] for b in subject_badges}
    for c in _COMING:
        if c["subject"] in present:
            continue
        badges.append({
            "subject": c["subject"], "glyph": c["glyph"], "tier": "bronze", "state": "locked",
            "progress": 0.0, "title": _t(c["title"], locale), "meta": "", "certifies": [],
            "earned": False, "earnedAt": None, "category": "coming", "noStars": False,
            "howToEarn": _t(_COMING_HOWTO, locale),
        })

    return badges
