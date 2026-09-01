"""Teacher insights (F6) — deterministic + explainable (§5.3, §9, §11).

Numbers come from real `learning_events` + brain projections, never invented.
Every attention flag returns its **raw evidence**. No student-to-student
comparison (group views are aggregates only). The Teacher Insights agent may
reword this evidence but never adds facts.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Any

from app.brain.org import get_group, learners_in_group
from app.brain.repository import get_brain
from app.services.events import get_recent_events
from app.services.learner_activity import HIDDEN_SUBJECTS
from app.services.learning_timing import PROLONGED_INTERACTION_SECONDS
from app.services.planner import next_focus, plan_next

INACTIVITY_DAYS = 6
LOW_SUCCESS_STREAK = 3

# How a learner is described in one word on the roster. Derived here rather than
# in the UI so the roster, the home strip and the assistant can never disagree.
#
#   attention    — a flag fired; the card shows the flag and its evidence.
#   not_started  — no learning event has EVER been recorded for this learner.
#   active       — there is activity, recent enough that no inactivity flag
#                  fired, and nothing else is flagged.
#
# `not_started` exists because the absence of a flag used to read as a positive:
# a learner who never logged in produced no events, so `days_inactive` was None,
# no criterion could fire, and the roster called them "progressing". Silence is
# not progress — and it is the one state a teacher most needs to see.
STATUS_ATTENTION = "attention"
STATUS_NOT_STARTED = "not_started"
STATUS_ACTIVE = "active"

REASON = {
    "inactivity": {"he": "אין פעילות", "ar": "لا يوجد نشاط", "en": "No activity"},
    "low_success": {"he": "כישלונות רצופים", "ar": "إخفاقات متتالية", "en": "Consecutive failures"},
    "slow_progress": {"he": "זמן ממושך בשאלה", "ar": "وقت طويل في السؤال", "en": "Long question interval"},
    "wellbeing": {"he": "שיתף/ה מצוקה — דורש תשומת לב", "ar": "شارك ضائقة — يتطلب انتباهًا", "en": "Shared distress — needs attention"},
}
# Recommendation sentences.
#
# Each key comes in two shapes: a NAMED one that interpolates the thing this
# child's data actually points at, and the bare one it falls back to when the
# catalogue cannot name it. The bare ones are what a teacher used to get every
# time — "תרגול ממוקד בנושא שבו יש קושי" is true of every struggling child in
# the country, so it told this teacher nothing about this child. A named
# recommendation is the same pedagogy with the subject of the sentence filled
# in, which is the whole difference between advice and a slogan.
#
# `{...}` fields are `str.format` params supplied at the call site; a template
# whose params cannot be resolved must not be selected (see `_recommendation`).
REC = {
    "reach_out": {"he": "צור/צרי קשר והצע/י משימה קצרה לחזרה", "ar": "تواصل واقترح مهمة قصيرة", "en": "Reach out and offer a short re-entry task"},
    "reach_out_days": {
        "he": "{days} ימים ללא פעילות — צור/צרי קשר והצע/י משימה קצרה לחזרה",
        "ar": "{days} أيام دون نشاط — تواصل واقترح مهمة قصيرة للعودة",
        "en": "{days} days without activity — reach out and offer a short re-entry task",
    },
    "targeted": {"he": "תרגול ממוקד בנושא שבו יש קושי", "ar": "تدريب مركّز على النقطة الصعبة", "en": "Targeted practice on the struggling objective"},
    "targeted_at": {
        "he": "תרגול ממוקד ב\"{topic}\" — שם נמצא הקושי",
        "ar": "تدريب مركّز على \"{topic}\" — هناك تكمن الصعوبة",
        "en": "Targeted practice on \"{topic}\" — that is where the difficulty is",
    },
    "alt_rep": {"he": "הצע/י ייצוג חלופי (וידאו/סימולציה)", "ar": "اقترح تمثيلًا بديلًا", "en": "Offer an alternative representation"},
    "alt_rep_at": {
        "he": "הסבר חוזר לא עבד ב\"{topic}\" — הצע/י ייצוג אחר: הדגמה, סרטון או סימולציה",
        "ar": "لم يُجدِ الشرح المتكرر في \"{topic}\" — اقترح تمثيلًا آخر: عرضًا عمليًا أو فيديو أو محاكاة",
        "en": "Re-explaining has not worked on \"{topic}\" — offer another representation: a demo, a video or a simulation",
    },
    "build_strength": {"he": "בסס/י על חוזקה קיימת", "ar": "ابنِ على نقطة قوة", "en": "Build on an existing strength"},
    "build_strength_named": {
        "he": "\"{strength}\" היא חוזקה מתועדת — פתח/י את הנושא הקשה הבא בדוגמה מהתחום הזה, או בנה/י משימה שנשענת עליו",
        "ar": "\"{strength}\" نقطة قوة موثّقة — افتتح/ي الموضوع الصعب التالي بمثال من هذا المجال، أو ابنِ مهمة تستند إليها",
        "en": "\"{strength}\" is a recorded strength — open the next hard topic with an example from it, or build a task that leans on it",
    },
    "check_in": {"he": "בדוק/י אם כדאי לפרק את המשימה לצעד קטן או להציע רמז", "ar": "تحقق إن كان من المفيد تقسيم المهمة أو تقديم تلميح", "en": "Check whether to break the task into a smaller step or offer a hint"},
    "check_in_minutes": {
        "he": "שאלה אחת לקחה כ-{minutes} דקות — כדאי לפרק אותה לצעד קטן או להציע רמז",
        "ar": "استغرق سؤال واحد نحو {minutes} دقيقة — يُنصح بتقسيمه إلى خطوة صغيرة أو تقديم تلميح",
        "en": "One question took about {minutes} minutes — break it into a smaller step or offer a hint",
    },
    "deepen_subject": {
        "he": "{subject}: {mastered} מתוך {total} היעדים הושגו — כדאי אתגר מעבר לתוכנית",
        "ar": "{subject}: تحقّق {mastered} من {total} أهداف — يُنصح بتحدٍّ يتجاوز المنهاج",
        "en": "{subject}: {mastered} of {total} objectives achieved — offer a challenge beyond the syllabus",
    },
    # "1 מתוך 1 היעדים הושגו" is arithmetic, not Hebrew. When the fraction is
    # whole there is a word for it.
    "deepen_subject_all": {
        "he": "{subject}: כל היעדים הושגו — כדאי אתגר מעבר לתוכנית",
        "ar": "{subject}: تحقّقت كل الأهداف — يُنصح بتحدٍّ يتجاوز المنهاج",
        "en": "{subject}: every objective achieved — offer a challenge beyond the syllabus",
    },
    "refer_distress": {
        "he": "{count} כישלונות רצופים יחד עם פנייה שסומנה לתשומת לב — כדאי שיחה אישית, לא עוד תרגול",
        "ar": "{count} إخفاقات متتالية مع بلاغ مُعلَّم للانتباه — يُفضّل حديث شخصي لا مزيد من التمارين",
        "en": "{count} consecutive failures alongside a flagged disclosure — this calls for a conversation, not more drill",
    },
}

# Subject names, server-side, because the recommendation sentence is composed
# here. The frontend has the same four in `locales/*.json` under `tch.subject.*`
# and a parity test keeps the two tables from drifting.
SUBJECT_LABEL = {
    "math": {"he": "מתמטיקה", "ar": "الرياضيات", "en": "Mathematics"},
    "science": {"he": "מדעים", "ar": "العلوم", "en": "Science"},
    "english": {"he": "אנגלית", "ar": "الإنجليزية", "en": "English"},
    "other": {"he": "כללי", "ar": "عام", "en": "General"},
}

# The five pedagogical categories the MoE spec names (F6, student level §2):
# חיזוק · תרגול נוסף · העמקה · העשרה · הפניה להתערבות חינוכית.
# The category is the machine-readable contract; `text` is the human line. Each
# recommendation the engine emits carries the datum that triggered it, so a
# teacher can always ask "why are you telling me this?" and get an answer.
CATEGORY_REINFORCE = "reinforce"
CATEGORY_EXTRA_PRACTICE = "extra_practice"
CATEGORY_DEEPEN = "deepen"
CATEGORY_ENRICH = "enrich"
CATEGORY_REFER = "refer_intervention"

CATEGORY_LABEL = {
    CATEGORY_REINFORCE: {"he": "חיזוק", "ar": "تعزيز", "en": "Reinforce"},
    CATEGORY_EXTRA_PRACTICE: {"he": "תרגול נוסף", "ar": "تدريب إضافي", "en": "Extra practice"},
    CATEGORY_DEEPEN: {"he": "העמקה", "ar": "تعميق", "en": "Deepen"},
    CATEGORY_ENRICH: {"he": "העשרה", "ar": "إثراء", "en": "Enrich"},
    CATEGORY_REFER: {"he": "הפניה להתערבות חינוכית", "ar": "إحالة لتدخل تربوي",
                     "en": "Refer for educational intervention"},
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


async def _days_inactive(
    learner_id: str, recent: list[dict[str, Any]]
) -> tuple[int | None, str | None, str | None]:
    """Days since this learner last did anything — across BOTH stores.

    `learning_events` is the Kata/xAPI record and is the only source this used
    to consult. Teacher-authored tasks deliberately write nothing to it: they
    are not Kata objectives, and forcing them into that taxonomy would distort
    mastery, the coach and the MoE report.

    The consequence, if only one store is read, is a portal that contradicts
    itself — "10 ימים ללא פעילות" beside three tasks the child completed this
    week. So the count is the smaller of the two gaps.

    Compared as day counts rather than as timestamps on purpose: the two stores
    format their ISO strings independently, and `"...Z"` sorts above
    `"...+00:00"` in a plain string comparison whatever the actual instants.

    Returns the gap, the stamp it was measured from, and which store that stamp
    came from — so the evidence a teacher opens names the activity it counted
    rather than a learning event that may be older than the real one.
    """
    from app.services.tasks import store as task_store

    candidates: list[tuple[int, str, str]] = []
    if recent and recent[0].get("stored_at"):
        gap = _days_since(recent[0]["stored_at"])
        if gap is not None:
            candidates.append((gap, recent[0]["stored_at"], "learning_event"))
    try:
        completed = await task_store.latest_completion(learner_id)
        gap = _days_since(completed)
        if gap is not None and completed:
            candidates.append((gap, completed, "task"))
    except Exception as exc:  # the task store must never break the insight
        print(f"⚠️ task activity lookup failed: {type(exc).__name__}")

    if not candidates:
        return None, None, None
    return min(candidates, key=lambda entry: entry[0])


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


def _subject_label(subject: str | None, language: str) -> str:
    """A subject a teacher reads. Unknown subjects come back as themselves
    rather than as a blank, so a new vendor subject degrades to its own name."""
    if not subject:
        return ""
    entry = SUBJECT_LABEL.get(str(subject).lower())
    if not entry:
        return str(subject).replace("_", " ").replace("-", " ").strip().title()
    return entry.get(language) or entry["he"]


def _recommendation(
    category: str, text_key: str, language: str, *,
    signal: str, value: Any, raw: dict[str, Any] | None = None,
    params: dict[str, Any] | None = None, fallback_key: str | None = None,
) -> dict[str, Any]:
    """One pedagogical recommendation, carrying the datum that produced it.

    `because` is not decoration: F6 requires that anything the system tells a
    teacher can be traced to the raw evidence behind it.

    A named template is used only when every `{...}` it needs resolves to
    something non-empty; otherwise the bare `fallback_key` sentence is used.
    The failure this guards is specific and would be shipped to a teacher: a
    catalogue miss rendering `תרגול ממוקד ב"{topic}"` on screen, which is worse
    than the generic line it was meant to improve on.
    """
    text = _t(REC, text_key, language)
    if params is not None:
        if not fallback_key:
            # Static per call site, so this fires in the test suite and never in
            # front of a teacher — and it is the only thing standing between a
            # catalogue miss and a literal `{topic}` on screen.
            raise ValueError(f"{text_key!r} interpolates but names no fallback")
        usable = all(
            value_ is not None and str(value_).strip()
            for value_ in params.values()
        )
        if usable:
            try:
                text = text.format(**params)
            except (KeyError, IndexError, ValueError):
                usable = False
        if not usable:
            text = _t(REC, fallback_key, language)
    return {
        "category": category,
        "category_label": _t(CATEGORY_LABEL, category, language),
        "text": text,
        "because": {"signal": signal, "value": value, "raw": raw or {}},
    }


def objectives_progress(
    brain: dict[str, Any], *, subject: str | None = None
) -> dict[str, dict[str, Any]]:
    """Per-subject progress against the learning objectives (F6 student §4).

    `brain.progress` only counts what the learner has *seen*; the catalog knows
    how many objectives the subject actually has, which is what "progress toward
    the learning goals" means to a teacher.
    """
    from app.brain.mastery import entry_for
    from app.services import kata_catalog

    mastery = brain.get("mastery") or {}
    result: dict[str, dict[str, Any]] = {}
    for subject_id in kata_catalog.subjects():
        if subject and subject_id != subject:
            continue
        objectives = kata_catalog.objectives_for(subject_id)
        mastered = in_progress = needs_review = 0
        for objective in objectives:
            entry = entry_for(mastery, objective.get("id", ""))
            if not entry:
                continue
            if entry.get("achieved"):
                mastered += 1
            elif entry.get("attempts"):
                in_progress += 1
            if entry.get("needs_review"):
                needs_review += 1
        total = len(objectives)
        result[subject_id] = {
            "objectives_total": total,
            "objectives_mastered": mastered,
            "objectives_in_progress": in_progress,
            "objectives_needs_review": needs_review,
            "not_started": max(0, total - mastered - in_progress),
            "percent": round(100 * mastered / total) if total else 0,
        }
    return result


def objective_breakdown(
    brain: dict[str, Any], *, subject: str, language: str = "he",
    activity_rows: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """Every objective the subject has, with where this child stands on it.

    The status band's dial says "1 of 3"; this is the list behind that number —
    catalogue objectives in curriculum order, each carrying its mastery state
    and the raw counts it derives from. Nothing is estimated: `percent` is 100
    when mastery marked it achieved, otherwise the mastery score the evidence
    engine already keeps, otherwise 0.
    """
    from app.brain.mastery import entry_for
    from app.services import kata_catalog

    mastery = brain.get("mastery") or {}

    # What the child actually DID there, from the same per-question rows the
    # profile shows — questions touched, minutes, help leaned on, and when.
    worked: dict[str, dict[str, Any]] = {}
    for row in activity_rows or []:
        oid = row.get("objective_id")
        if not oid or not row.get("attempts"):
            continue
        slot = worked.setdefault(oid, {"questions": 0, "seconds": 0.0,
                                       "help_used": 0, "last_at": None})
        slot["questions"] += 1
        slot["seconds"] += float(row.get("time_seconds") or 0)
        slot["help_used"] += (
            int(row.get("hints_used") or 0) + int(row.get("content_hints_used") or 0)
            + int(row.get("explanations_used") or 0) + int(row.get("chat_turns") or 0))
        last = row.get("last_at")
        if last and (slot["last_at"] is None or str(last) > str(slot["last_at"])):
            slot["last_at"] = last

    rows: list[dict[str, Any]] = []
    for objective in kata_catalog.objectives_for(subject):
        objective_id = str(objective.get("id") or "")
        entry = entry_for(mastery, objective_id)
        achieved = bool(entry.get("achieved"))
        attempts = int(entry.get("attempts") or 0)
        score = entry.get("score_ewma")
        percent = 100 if achieved else (
            max(0, min(99, round(100 * float(score))))
            if isinstance(score, (int, float)) else 0)
        rows.append({
            "objective_id": objective_id,
            "title": kata_catalog.objective_title(objective_id, language)
            or objective.get("title"),
            # For the collision fallback below — never sent to the client.
            "_unit_ids": objective.get("unit_ids") or [],
            "order": objective.get("order"),
            "status": ("mastered" if achieved
                       else "in_progress" if attempts else "not_started"),
            "needs_review": bool(entry.get("needs_review")),
            "attempts": attempts,
            "successes": int(entry.get("successes") or 0),
            "percent": percent,
            "questions": (worked.get(objective_id) or {}).get("questions", 0),
            "minutes": round((worked.get(objective_id) or {}).get("seconds", 0) / 60),
            "help_used": (worked.get(objective_id) or {}).get("help_used", 0),
            "last_at": (worked.get(objective_id) or {}).get("last_at"),
        })
    # The registry names objectives at the SUB-TOPIC level, so two objectives
    # under one sub-topic genuinely share a title (MASS-PRACTICE and GROSS-NET
    # are both "מסה ונפח של גופים") — two identical rows read as a bug. Where
    # titles collide, each row falls to its own unit's title, exactly as the
    # hardest-topics panel does.
    title_count: dict[str, int] = {}
    for row in rows:
        title_count[row["title"]] = title_count.get(row["title"], 0) + 1
    for row in rows:
        if title_count.get(row["title"], 0) >= 2:
            unit_names = [
                name for name in (
                    kata_catalog.unit_title(unit_id, language)
                    for unit_id in row["_unit_ids"]
                ) if name
            ]
            if unit_names:
                row["title"] = " · ".join(dict.fromkeys(unit_names))
        del row["_unit_ids"]

    rows.sort(key=lambda row: (row.get("order") is None, row.get("order") or 0))
    return rows


def _strengths_detail(
    brain: dict[str, Any], events: list[dict[str, Any]], language: str
) -> list[dict[str, Any]]:
    """Success areas, consistent improvement, engagement and achievements.

    Nice-to-have §1. Every row names the evidence, same rule as the flags — a
    strength a teacher can't explain to a child is not usable praise.
    """
    from app.brain import detectors
    from app.brain.mastery import entry_for
    from app.services import kata_catalog

    rows: list[dict[str, Any]] = []
    mastery = brain.get("mastery") or {}

    for subject_id in kata_catalog.subjects():
        for objective in kata_catalog.objectives_for(subject_id):
            entry = entry_for(mastery, objective.get("id", ""))
            if entry.get("achieved") and (entry.get("score_ewma") or 0) >= 0.8:
                rows.append({
                    "kind": "success_area",
                    "label": kata_catalog.objective_title(objective["id"], language) or "",
                    "objective_id": objective["id"],
                    "subject": subject_id,
                    "evidence": {
                        "attempts": entry.get("attempts"),
                        "successes": entry.get("successes"),
                        "level": entry.get("level"),
                    },
                })

    # Consistent improvement: a recovery after failures on the same objective.
    by_objective: dict[str, list[dict[str, Any]]] = {}
    for event in events:
        if event.get("objective_id"):
            by_objective.setdefault(event["objective_id"], []).append(event)
    for objective_id, objective_events in by_objective.items():
        ordered = list(reversed(objective_events))          # oldest first
        for index, event in enumerate(ordered):
            if (event.get("result") or {}).get("success") is True and index:
                if detectors.detect_recovery(list(reversed(ordered[:index])), event):
                    rows.append({
                        "kind": "consistent_improvement",
                        "label": kata_catalog.objective_title(objective_id, language) or "",
                        "objective_id": objective_id,
                        "evidence": {"event_id": event.get("_id"), "at": event.get("stored_at")},
                    })
                    break

    for strength in (brain.get("strengths") or []):
        if isinstance(strength, dict) and strength.get("learner_feedback") != "inaccurate":
            rows.append({
                "kind": "profile_strength",
                "label": strength.get("label"),
                "source": strength.get("source") or "system",
                "evidence": {"source": strength.get("source") or "system"},
            })

    return rows[:12]


# The order the portrait reads in. Not the storage order: a teacher opening a
# profile asks "how do I reach this child" before "what motivates them", and
# `render_text` already uses this same order for the coach's prompt.
PORTRAIT_ORDER = ("how_to_reach", "what_frustrates", "learning_preferences", "motivational_patterns")


def _portrait(brain: dict[str, Any]) -> dict[str, Any] | None:
    """The paragraph the system can already write about this learner.

    `student_description` (A-5) is built continuously from observed evidence —
    a mini-tier reconcile pass that runs lazily off the coach bundle, debounced,
    never on this request. So the teacher-facing portrait costs nothing beyond
    reading it: no call here, no call on page load, no per-teacher generation.

    Only ACTIVE entries are shown. The block history keeps superseded sentences
    with an `invalid_at` for provenance, and a belief the learner has since
    taken back must not be described to their teacher as a current trait.

    Returns `None` rather than an empty shell when nothing has been observed
    yet, so the UI can stay silent instead of drawing an empty card.
    """
    from app.brain.description import active_entries

    description = brain.get("student_description") or {}
    if not isinstance(description, dict):
        return None
    stored = description.get("blocks") or {}

    blocks: list[dict[str, Any]] = []
    evidence_keys: set[str] = set()
    for key in PORTRAIT_ORDER:
        lines = []
        for entry in active_entries(stored.get(key)):
            text = str(entry.get("text") or "").strip()
            if not text:
                continue
            # The evidence keys are internal paths (`mastery.X`, `activeness.Y`).
            # The COUNT is honest provenance a teacher can read; the paths are
            # not, and they would leak objective ids onto the screen.
            evidence_keys.update(
                str(item) for item in (entry.get("evidence") or []) if item)
            # Teacher-asserted and system-inferred sentences stay separately
            # attributed (#454) — never merged into one anonymous paragraph.
            lines.append({
                "text": text,
                "by_teacher": any(
                    str(item).startswith("stated_by_teacher")
                    for item in entry.get("evidence") or []
                ),
            })
        if lines:
            blocks.append({"key": key, "lines": lines})

    if not blocks:
        return None
    return {
        "blocks": blocks,
        "evidence_count": len(evidence_keys),
        "updated_at": description.get("last_generated_at") or description.get("updated_at"),
    }


async def student_insights(
    learner_id: str, language: str = "he", subject: str | None = None,
    window_days: int = 7,
) -> dict[str, Any]:
    """Explainable per-student insight — struggle, progress, attention + evidence.

    `window_days` is the dashboard's selected period; it reaches only the band,
    which re-judges against it (see `teacher_bands.base_band`). Everything else
    here describes the child's current state and is period-independent.
    """
    from app.services import kata_catalog
    await kata_catalog.ensure_loaded()
    brain = await get_brain(learner_id)
    recent = await get_recent_events(learner_id, limit=20)
    # Same computation `plan_next` did, plus the cross-subject pick the student
    # dashboard's hero is built on — so teacher and child see the same "next".
    focus = next_focus(brain)
    plan = focus["plan"]

    days_inactive, last_activity_at, activity_source = await _days_inactive(learner_id, recent)
    fail_streak = _trailing_fail_streak(recent)
    prolonged_events = [
        event for event in recent
        if event.get("verb") in ("answered", "attempted")
        and isinstance((event.get("timing") or {}).get("elapsed_since_previous_seconds"), (int, float))
        and (event.get("timing") or {}).get("elapsed_since_previous_seconds") >= PROLONGED_INTERACTION_SECONDS
    ]

    from app.brain.mastery import entry_for
    struggle_items = []
    for challenge in (brain.get("challenges") or []):
        if not isinstance(challenge, dict):
            continue
        objective_id = challenge.get("objective_id", "")
        entry = entry_for(brain.get("mastery"), objective_id)
        # Mastery entries predating the subject field still resolve through the
        # catalog. When a filter is active and the subject stays unknown the
        # item is dropped: asking for one subject and being shown unattributed
        # rows is exactly the cognitive load F6 §4 exists to remove.
        item_subject = entry.get("subject")
        if not item_subject and objective_id:
            from app.services import kata_catalog
            item_subject = (kata_catalog.get_objective(objective_id) or {}).get("subject")
        if item_subject in HIDDEN_SUBJECTS:
            continue
        if subject and item_subject != subject:
            continue
        struggle_items.append({
            "label": challenge.get("label"),
            "objective_id": objective_id,
            "subject": item_subject,
            # Two kinds of row have always shared this list and they are not the
            # same claim. An EVIDENCE row means "this child answered these
            # questions and got them wrong"; a QUESTIONNAIRE row is a trait the
            # child described about themselves during onboarding ("לזהות מה
            # עוזר לי ללמוד") — real signal, no objective behind it, and nothing
            # that ever retires it. Under one heading called "difficulties" the
            # second kind reads as a permanent deficiency the system detected.
            #
            # Tagged rather than filtered: the questionnaire answers are worth
            # showing, just not here. The presence of an objective id is the
            # discriminator, because that is exactly what the two differ by.
            "source": "evidence" if objective_id else "questionnaire",
            "evidence": entry.get("misconceptions"),
            # The raw counters behind "the system says they struggle here".
            "raw_evidence": {
                "attempts": entry.get("attempts"),
                "successes": entry.get("successes"),
                "failures": entry.get("failures"),
                "score_ewma": entry.get("score_ewma"),
                "level": entry.get("level"),
                "needs_review": entry.get("needs_review"),
            },
        })

    # Attention flag — always with raw evidence (F6 explainability).
    # A genuine distress disclosure OUTRANKS academic flags. A `review`
    # classifier-outage flag is an OPERATIONAL signal (safety screen was down),
    # NOT a child-distress claim — it must never present as "shared distress".
    attention = None
    open_wellbeing = [f for f in (brain.get("wellbeing_flags") or [])
                      if isinstance(f, dict) and not f.get("resolved")]
    open_distress = [f for f in open_wellbeing if f.get("category") != "review"]
    open_review = [f for f in open_wellbeing if f.get("category") == "review"]
    # Every branch carries `raw_evidence`. This is the F6 explainability rule in
    # its most literal form: "כשהמערכת מסמנת תלמיד כ'דורש תשומת לב', היא חייבת
    # להציג את הנתון הגולמי שהוביל למסקנה". Three of these four flags used to
    # ship the sentence without the datum, so the teacher UI had nothing to open.
    if open_distress:
        latest = open_distress[-1]
        attention = {"reason": _t(REASON, "wellbeing", language),
                     "evidence": latest.get("evidence") or "",
                     "kind": "wellbeing",
                     "raw_evidence": {
                         "at": latest.get("at"),
                         "source": latest.get("source"),
                         "category": latest.get("category") or "distress",
                         "open_flags": len(open_distress),
                     }}
    elif days_inactive is not None and days_inactive >= INACTIVITY_DAYS:
        attention = {"reason": _t(REASON, "inactivity", language),
                     "evidence": f"{days_inactive} ימים ללא פעילות" if language == "he"
                                 else f"{days_inactive} days without activity",
                     "kind": "inactivity",
                     "raw_evidence": {
                         "days_inactive": days_inactive,
                         "threshold": INACTIVITY_DAYS,
                         # The activity the count was actually measured from,
                         # which is not always the last learning event.
                         "last_activity_at": last_activity_at,
                         "last_activity_source": activity_source,
                         "last_event_at": recent[0].get("stored_at") if recent else None,
                         "last_event_id": recent[0].get("_id") if recent else None,
                     }}
    elif fail_streak >= LOW_SUCCESS_STREAK:
        attention = {"reason": _t(REASON, "low_success", language),
                     "evidence": f"{fail_streak} כישלונות רצופים" if language == "he"
                                 else f"{fail_streak} consecutive failures",
                     "kind": "low_success",
                     "raw_evidence": {
                         "fail_streak": fail_streak,
                         "threshold": LOW_SUCCESS_STREAK,
                         "objective_id": recent[0].get("objective_id") if recent else None,
                         "evidence_event_ids": [
                             event.get("_id") for event in recent[:fail_streak]
                         ],
                     }}
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

    # 2–5 actionable recommendations, each tagged with one of the five MoE
    # categories and carrying the signal that triggered it (deterministic — no
    # LLM, so it can never invent a reason).
    progress_by_subject = objectives_progress(brain, subject=subject)
    recommendations: list[dict[str, Any]] = []

    # The objective the recent failures are actually in — the thing "תרגול
    # ממוקד בנושא שבו יש קושי" was silently referring to and never naming.
    struggling_objective_id = recent[0].get("objective_id") if recent else None
    struggling_topic = (
        kata_catalog.objective_title(struggling_objective_id, language)
        if struggling_objective_id else None
    )

    if (days_inactive or 0) >= INACTIVITY_DAYS:
        recommendations.append(_recommendation(
            CATEGORY_REFER, "reach_out_days", language,
            signal="days_inactive", value=days_inactive,
            params={"days": days_inactive}, fallback_key="reach_out",
            raw={"days_inactive": days_inactive,
                 "threshold": INACTIVITY_DAYS,
                 "last_activity_at": last_activity_at,
                 "last_activity_source": activity_source},
        ))
    if fail_streak >= 2:
        streak_raw = {
            "fail_streak": fail_streak,
            "threshold": LOW_SUCCESS_STREAK,
            "objective_id": struggling_objective_id,
            "objective_title": struggling_topic,
        }
        recommendations.append(_recommendation(
            CATEGORY_EXTRA_PRACTICE, "targeted_at", language,
            signal="trailing_fail_streak", value=fail_streak,
            params={"topic": struggling_topic}, fallback_key="targeted",
            raw=dict(streak_raw),
        ))
        recommendations.append(_recommendation(
            CATEGORY_REINFORCE, "alt_rep_at", language,
            signal="trailing_fail_streak", value=fail_streak,
            params={"topic": struggling_topic}, fallback_key="alt_rep",
            raw=dict(streak_raw),
        ))
    if fail_streak >= LOW_SUCCESS_STREAK and open_distress:
        # Repeated failure *and* a distress disclosure is the case the spec
        # explicitly names for referral, not for more drill.
        recommendations.append(_recommendation(
            CATEGORY_REFER, "refer_distress", language,
            signal="distress_with_failure", value=fail_streak,
            params={"count": fail_streak}, fallback_key="reach_out",
            raw={"fail_streak": fail_streak, "open_flags": len(open_distress)},
        ))
    if prolonged_events:
        latest_prolonged = prolonged_events[0]
        elapsed = (latest_prolonged.get("timing") or {}).get("elapsed_since_previous_seconds")
        recommendations.append(_recommendation(
            CATEGORY_REINFORCE, "check_in_minutes", language,
            signal="prolonged_interaction", value=elapsed,
            params={"minutes": max(1, round(elapsed / 60)) if elapsed else None},
            fallback_key="check_in",
            raw={"elapsed_seconds": elapsed,
                 "event_id": latest_prolonged.get("_id"),
                 "question_id": latest_prolonged.get("question_id")},
        ))
    # Mastered everything in a subject → deepen, then enrich. A learner who is
    # ahead is a teaching decision too, not just an absence of problems.
    for subject_id, stats in progress_by_subject.items():
        if stats["objectives_total"] and stats["percent"] >= 80:
            whole = stats["objectives_mastered"] >= stats["objectives_total"]
            recommendations.append(_recommendation(
                CATEGORY_DEEPEN, "deepen_subject_all" if whole else "deepen_subject", language,
                signal="subject_mastery_percent", value=stats["percent"],
                params={"subject": _subject_label(subject_id, language),
                        "mastered": stats["objectives_mastered"],
                        "total": stats["objectives_total"]},
                fallback_key="targeted",
                raw={"subject": subject_id, **stats},
            ))
            break
    strength_labels = [
        str(s.get("label")).strip()
        for s in (brain.get("strengths") or [])
        if isinstance(s, dict) and str(s.get("label") or "").strip()
        and s.get("learner_feedback") != "inaccurate"
    ]
    if strength_labels:
        recommendations.append(_recommendation(
            CATEGORY_ENRICH, "build_strength_named", language,
            signal="existing_strength", value=len(strength_labels),
            # The first one, not all three: a recommendation naming three things
            # to build on is a list, and a teacher cannot act on a list.
            params={"strength": strength_labels[0]}, fallback_key="build_strength",
            raw={"labels": strength_labels[:3]},
        ))
    recommendations = recommendations[:5] or [_recommendation(
        CATEGORY_EXTRA_PRACTICE, "targeted", language,
        signal="default", value=None, raw={},
    )]

    # ── supplier-defined attention criteria (F6 group §2, third bullet) ──────
    # The spec names inactivity and consecutive failure and lets the supplier
    # add more. These are ours; each keeps its raw datum so the teacher sees
    # exactly what fired.
    from app.brain import detectors           # lazy: avoid an import cycle

    attention_all: list[dict[str, Any]] = []
    if attention:
        attention_all.append(attention)

    rapid_guesses = detectors.count_recent_rapid_guesses(recent, window=5)
    if rapid_guesses >= 3:
        attention_all.append({
            "kind": "rapid_guessing", "reason": _t(REASON, "low_success", language),
            "evidence": f"{rapid_guesses} תשובות מהירות מדי" if language == "he"
                        else f"{rapid_guesses} rapid answers",
            "raw_evidence": {"rapid_guesses": rapid_guesses, "window": 5},
        })

    if objective_events := {
        event.get("objective_id"): event for event in recent if event.get("objective_id")
    }:
        for objective_id in list(objective_events)[:3]:
            same = [
                event for event in reversed(recent)
                if event.get("objective_id") == objective_id
                and event.get("effortful") is not False
            ]
            state = detectors.wheel_spinning_state(same)
            if state.get("spinning"):
                attention_all.append({
                    "kind": "wheel_spinning", "reason": _t(REASON, "low_success", language),
                    "evidence": f"{state['opportunities']} ניסיונות ללא שליטה" if language == "he"
                                else f"{state['opportunities']} attempts without mastery",
                    "raw_evidence": {"objective_id": objective_id, **state},
                })
                break

    overdue = [
        goal for goal in (brain.get("goals") or [])
        if isinstance(goal, dict) and goal.get("deadline")
        and goal.get("status") not in ("done", "summarized")
        and str(goal["deadline"]) < datetime.now(timezone.utc).date().isoformat()
    ]
    if overdue:
        attention_all.append({
            "kind": "overdue_goal", "reason": _t(REASON, "inactivity", language),
            "evidence": f"{len(overdue)} יעדים שעבר זמנם" if language == "he"
                        else f"{len(overdue)} overdue goals",
            "raw_evidence": {"goal_ids": [g.get("id") for g in overdue][:5]},
        })

    help_requested = [
        goal for goal in (brain.get("goals") or [])
        if isinstance(goal, dict) and goal.get("needs_help")
    ]
    if help_requested:
        attention_all.append({
            "kind": "help_requested", "reason": _t(REASON, "wellbeing", language),
            "evidence": f"{len(help_requested)} בקשות עזרה פתוחות" if language == "he"
                        else f"{len(help_requested)} open help requests",
            "raw_evidence": {"goal_ids": [g.get("id") for g in help_requested][:5]},
        })

    # `recent` is unwindowed (newest-first, capped at 20), so an empty list means
    # this learner has never produced a single learning event — not merely that
    # they have been quiet lately. That is the difference between "טרם התחיל/ה"
    # and "מתקדם/ת", and the roster used to collapse it.
    activity = {
        "started": bool(recent),
        "last_event_at": recent[0].get("stored_at") if recent else None,
        "days_inactive": days_inactive,
    }
    status = (
        STATUS_ATTENTION if attention
        else STATUS_NOT_STARTED if not recent
        else STATUS_ACTIVE
    )

    # The daily check-in (#452): today's feeling (null once the school day
    # turns), a 14-day strip, and the skip streak. Visible to every scoped
    # teacher through the same `_guard_learner` gate as the rest of this
    # payload; deliberately NO automatic escalation — a feeling is a
    # conversation opener, not an alert.
    from app.services import checkin_flow
    from app.services.school_calendar import today_school_date

    checkin_history = await checkin_flow.history(learner_id)
    today_key = today_school_date()
    today_feeling = next(
        (row for row in checkin_history
         if row["date"] == today_key and row["valence"]),
        None,
    )
    checkin_skip_streak = 0
    for row in checkin_history:                     # newest first
        if row["skipped"]:
            checkin_skip_streak += 1
        else:
            break

    # The deterministic dashboard band (#450). Base only: the two group-stage
    # inputs (blocked messages, week-over-week trends) are folded in by
    # `group_insights`, each able to move a student one way (red / green-up).
    from app.services import teacher_bands

    band = teacher_bands.base_band(
        brain,
        attention_all=attention_all,
        today_feeling=today_feeling,
        status=status,
        objectives_progress=progress_by_subject,
        window_days=window_days,
    )

    return {
        "learner_id": learner_id,
        "display_name": (brain.get("identity") or {}).get("display_name"),
        "band": band,
        "today_feeling": today_feeling,
        "checkin_history": checkin_history,
        "checkin_skip_streak": checkin_skip_streak,
        # Hidden subjects (english this year) are dropped HERE, not just at the
        # screens: brain.progress keys come from the vendor's own tags and are
        # the one place a hidden subject survives the catalog's math/science/
        # other collapse — every consumer (the AI read included) inherits this.
        "progress": {
            key: value for key, value in (brain.get("progress") or {}).items()
            if key not in HIDDEN_SUBJECTS
        },
        "activity": activity,
        "status": status,
        # Progress measured against the objectives the subject actually has,
        # which is what "progress toward the learning goals" means (F6 §4).
        "objectives_progress": progress_by_subject,
        "subject_filter": subject,
        "next": {s: plan[s]["next_titles"] for s in plan},
        # Where the platform would take this child next — the profile's focus
        # dial. Additive: `next` above keeps its shape for existing consumers.
        "focus": {
            "subject": focus.get("subject"),
            "objective_id": focus.get("objective_id"),
            "objective_title": kata_catalog.objective_title(
                focus.get("objective_id"), language)
            if focus.get("objective_id") else None,
            "mode": focus.get("mode"),
        },
        "struggle_items": struggle_items,
        # How the system sees this learner, in sentences it has already written.
        "portrait": _portrait(brain),
        "strengths_detail": _strengths_detail(brain, recent, language),
        "attention_all": attention_all,
        "strengths": [
            s.get("label")
            for s in (brain.get("strengths") or [])
            if isinstance(s, dict) and s.get("learner_feedback") != "inaccurate"
        ],
        "attention": attention,
        "wellbeing_flags": [
            {"evidence": f.get("evidence"), "at": f.get("at"),
             "source": f.get("source"), "category": f.get("category") or "distress"}
            for f in open_distress
        ],
        # Operational notice, kept separate from child-distress signals.
        "safety_screen_notices": [
            {"at": f.get("at"), "source": f.get("source")} for f in open_review
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
        "self_awareness": _self_awareness_gap(brain.get("reflections_recent") or []),
    }


def _self_awareness_gap(reflections: list) -> dict[str, Any] | None:
    """B-5: compare the learner's self-ratings to the server-computed session
    success rate — the F4 self-vs-system delivery signal, teacher-facing."""
    samples = [
        {
            "self_rating": r.get("self_rating"),
            "system_estimate": r.get("system_estimate"),
            "at": r.get("at"),
        }
        for r in reflections
        if isinstance(r, dict)
        and isinstance(r.get("self_rating"), (int, float))
        and isinstance(r.get("system_estimate"), (int, float))
    ][-5:]
    if not samples:
        return None
    latest = samples[-1]
    gap = (float(latest["self_rating"]) / 5.0) - float(latest["system_estimate"])
    if gap >= 0.25:
        reading = "self_above_evidence"     # מעריך/ה את עצמו/ה מעל הביצוע בפועל
    elif gap <= -0.25:
        reading = "self_below_evidence"     # מעריך/ה את עצמו/ה מתחת לביצוע בפועל
    else:
        reading = "calibrated"
    return {"reading": reading, "gap": round(gap, 2), "samples": samples}


async def group_insights(
    group_id: str, language: str = "he", window_days: int = 7,
) -> dict[str, Any]:
    """Group aggregates + per-student summaries. NO student-to-student comparison.

    `window_days` is the dashboard's period. It re-judges every band, so it is
    part of the cache identity — without it the weekly and monthly readings of
    the same class would serve each other's answers for a minute.
    """
    from app.services import teacher_bands

    # A short TTL because #450 doubled what this computes (bands + a lazy
    # trends fan-out) and the dashboard, the roster and the students page all
    # call it. 60s of staleness on a summary screen is invisible; the second
    # tab paying the full fan-out again was not.
    cache_key = (group_id, language, window_days)
    cached = teacher_bands.cache_get(cache_key)
    if cached is not None:
        return cached

    group = await get_group(group_id)
    learner_ids = await learners_in_group(group_id)
    # Fan out, don't queue: this used to await one learner at a time, so a
    # 30-student group meant 30 sequential rounds of brain fetch + events +
    # planner on every page load. The semaphore keeps the burst civil.
    semaphore = asyncio.Semaphore(8)

    async def _one(learner_id: str) -> dict[str, Any]:
        async with semaphore:
            return await student_insights(learner_id, language, window_days=window_days)

    students = list(await asyncio.gather(*(_one(lid) for lid in learner_ids)))

    # ── finalize the bands (#450) ────────────────────────────────────────────
    # Two group-stage inputs. Blocked messages: one windowed roster query — a
    # RED input regardless of anything else. Period-over-period improvement: a
    # trends read per student, LAZILY — only students the cheap rules left
    # orange with some activity can be upgraded, so most classes pay for a
    # handful, not for everyone.
    from app.services import learner_trends as learner_trends_service
    from app.services.direct_messages import blocked_moderation_events

    blocked_by_user = await blocked_moderation_events(learner_ids)
    for s in students:
        s["band"] = teacher_bands.apply_blocked_messages(
            s["band"], blocked_by_user.get(s["learner_id"]) or [])

    upgradeable = [
        s for s in students
        if s["band"]["band"] == "orange" and s["status"] == STATUS_ACTIVE
    ]

    async def _maybe_upgrade(s: dict[str, Any]) -> None:
        async with semaphore:
            try:
                trends = await learner_trends_service.learner_trends(
                    s["learner_id"], days=window_days * 2)
            except Exception:
                return
        reason = teacher_bands.improvement_from_trends(trends, window_days)
        if reason:
            s["band"] = {"band": "green", "reasons": [reason]}

    await asyncio.gather(*(_maybe_upgrade(s) for s in upgradeable))

    # Movement memory for the "new" badge — first sighting stores silently.
    changes = await teacher_bands.note_band_changes(
        {s["learner_id"]: s["band"]["band"] for s in students})

    # Follows the period like the bands do. The key keeps its name because the
    # weekly digest reads it and takes the default 7, where it means exactly
    # what it always did.
    active_7d = sum(1 for s in students if s["timeline"] and _days_since(s["timeline"][0]["at"]) is not None
                    and _days_since(s["timeline"][0]["at"]) <= window_days)
    needing_attention = [s for s in students if s["attention"]]
    total_mastered = sum(
        sum(p.get("objectives_mastered", 0) for p in (s["progress"] or {}).values())
        for s in students
    )

    payload = {
        "group": group,
        "students": [
            {"learner_id": s["learner_id"], "display_name": s["display_name"],
             "progress": s["progress"], "attention": s["attention"],
             "status": s["status"], "activity": s["activity"],
             # The band, its whys, and when it last moved (None until a real
             # transition — a child is not "new" for existing).
             "band": {**s["band"], **changes.get(s["learner_id"], {})},
             "today_feeling": s["today_feeling"]}
            for s in students
        ],
        # Aggregate trends only (no comparisons between students).
        "trends": {
            "students_total": len(students),
            "window_days": window_days,
            "active_last_7d": active_7d,
            "needing_attention": len(needing_attention),
            # The dashboard KPI: how many students read RED right now.
            "needing_attention_red": sum(
                1 for s in students if s["band"]["band"] == "red"),
            # Enrolled but never seen. A count, like every other trend — it says
            # how many, never who is "behind" whom.
            "not_started": sum(1 for s in students if s["status"] == STATUS_NOT_STARTED),
            "objectives_mastered_total": total_mastered,
        },
        "attention": [
            {"learner_id": s["learner_id"], "display_name": s["display_name"], **s["attention"]}
            for s in needing_attention
        ],
    }
    teacher_bands.cache_put(cache_key, payload)
    return payload
