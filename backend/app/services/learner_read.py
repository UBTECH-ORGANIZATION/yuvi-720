"""One read of a child, in words, cached for a day.

## What it is for

A teacher about to set a goal is asking a question no screen answered directly:
*where is this child actually at?* The profile has the parts — mastery bars,
struggle rows, an attention flag, a moments feed — and asks the teacher to
assemble them. This assembles them: what is hard, what has got better, how
engaged they are, and one thing worth doing next.

It sits beside the goal composer rather than inside it, because it is context
for a decision the teacher makes, not a draft of the decision. The drafts
(`mentoring_assist.suggest_goals_for_teacher`) remain what they were.

## Cached for 24 hours, and that is a product decision

The underlying evidence moves in days, not minutes: a child's difficulties do
not change between two clicks. Regenerating per open would cost a strong-tier
call every time a teacher reopened a dialog — and, worse, would show them a
differently-worded account of the same child each time, which reads as the
system changing its mind. So one read per child per day, stored, with the
timestamp shown.

`refresh=True` forces a new one. A teacher who has just spoken to the child
knows something the cache does not.

## Grounded, and scoped

Built from `context_engine.view_for("teacher_assistant")` — the view without
identity, raw instrument scores or the child's private memory — plus the same
insights the profile shows. Nothing here reads the coach transcript.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from app.services.ai_usage import UsageContext

COLLECTION = "learner_reads"

#: How long a read stays fresh. A day: the evidence behind it moves in days.
TTL_HOURS = 24

#: Bounds on what comes back, so one long list cannot become the whole panel.
#: The read is a glance, not a report.
MAX_POINT_CHARS = 220
#: The overview is the one field that is allowed to be a paragraph.
MAX_OVERVIEW_CHARS = 420


class LearnerReadError(RuntimeError):
    """No read could be produced. Raised rather than returning an empty one, so
    a caller cannot mistake "the model was down" for "nothing to say"."""


def _collection():
    from app.brain.repository import _get_collection_named
    return _get_collection_named(COLLECTION)


def _now() -> datetime:
    return datetime.now(timezone.utc)


#: Part of the cache key. Bumped when the prompt or the answer shape changes,
#: so a cached old-shape read is simply never found rather than migrated.
#: v7: dropped `involvement`/`notable` (PBI 451 — the two repeated prose lines).
PROMPT_VERSION = "v7"


def read_id(learner_id: str, language: str) -> str:
    """Per language: the read is prose, and a Hebrew one is not an English one."""
    return f"{learner_id}:{language}:{PROMPT_VERSION}"


def is_fresh(row: Optional[dict[str, Any]]) -> bool:
    if not row or not row.get("generated_at"):
        return False
    try:
        made = datetime.fromisoformat(str(row["generated_at"]).replace("Z", "+00:00"))
    except ValueError:
        return False
    if made.tzinfo is None:
        made = made.replace(tzinfo=timezone.utc)
    return _now() - made < timedelta(hours=TTL_HOURS)


_PROMPT = """You are Yuvi, reading one student's record for their teacher. The
teacher wants to know, in a few sentences: where the student stands, what has
actually been hard, and anything the system has noticed that a teacher looking
at grades would not know.

Everything you may use is below. It is the whole of what you know — you have not
met this student and you have not read their chats. Say nothing the evidence
does not support, and do not invent a number.

EVIDENCE:
{evidence}

WHAT COULD BE WORKED ON NEXT (the only things a suggestion may point at):
{anchors}

Answer with JSON only:
{{"overview": "2-3 SHORT sentences of free prose with NO digits and NO
               percentages: your overall analysis of this student as a
               learner — what kind of work is harder for them, what carries
               them. This is the first paragraph the teacher reads; it must
               say something a glance at the numbers would not.",
  "subjects": [{{"subject": "a subject id copied exactly from the evidence
                 (e.g. math, science) — only subjects the evidence
                 actually says something about",
    "summary": "one or two SHORT sentences in your own words: how the
                student is actually doing in this subject — what goes well,
                what kind of question trips them. Prose, not a restatement
                of the numbers below.",
    "points": ["one SHORT sentence: where they stand there, with the numbers",
               "one SHORT sentence: what has been hard OR got better there,
                with the numbers — omit if the evidence has neither",
               ...up to 2]}}, ...up to 3],
  "suggestion": "one sentence: the single most useful thing to work on next,
                 naming one item from the list above",
  "suggestion_target": "the key of that item, copied exactly"}}

Rules:
- Write in {language}.
- BE BRIEF. The points together must stay under 55 words — a teacher reads
  them in one glance between two questions. Every sentence at most ~12 words.
  Cut the least informative claim before you cut a number. The overview and
  summaries are the only prose; keep each of them to its sentence count.
- The overview carries NO digits: it is the reading between the numbers, and
  the numbers are already on the screen beside it.
- Call the child by the school word for a student (Hebrew: תלמיד/ה — never
  סטודנט), and NEVER assume their gender: in Hebrew and Arabic write the
  paired forms (מצליח/ה, השלים/ה, התלמיד/ה), in every field including the
  overview and the summaries.
- NEVER quote a field name, an id or an internal value from the evidence. Words
  like "last_event_at" or "working" are plumbing; a teacher reading them learns
  nothing and stops trusting the rest. Say "three days without activity".
- Each point must be a DIFFERENT finding with its own evidence: "4 of 6 wrong
  in X", "achieved 1 of 3". Never write near-identical sentences that differ
  only in wording, and never pad with a vague one.
- A subject the evidence says nothing about gets NO entry — an empty subjects
  list is a correct answer.
- Things the student said about themselves in onboarding are self-description,
  not recorded difficulties. Do not list one as one.
- A goal the student is working on is not a difficulty. Do not list one as one.
- Never diagnose, never describe the child's character or home life, and never
  compare them to another student.
"""

_LANG = {"he": "Hebrew", "ar": "Arabic", "en": "English"}


def _labels(items: Any) -> list[str]:
    """A list of dicts or of strings → a list of readable labels."""
    out: list[str] = []
    for item in (items or [])[:5]:
        if isinstance(item, dict):
            text = str(item.get("label") or item.get("title") or "").strip()
        else:
            text = str(item or "").strip()
        if text:
            out.append(text)
    return out


def _description(raw: Any) -> list[str]:
    """The student-description document → the sentences inside it.

    A nested `{"blocks": {"learning_preferences": [{"text": …, "evidence": …}]}}`
    passed through whole put timestamps and evidence tags in front of a model
    that then quoted them.
    """
    if isinstance(raw, str):
        return [raw.strip()] if raw.strip() else []
    if not isinstance(raw, dict):
        return []
    lines: list[str] = []
    for entries in (raw.get("blocks") or {}).values():
        for entry in (entries if isinstance(entries, list) else [])[:3]:
            text = str((entry or {}).get("text") or "").strip() \
                if isinstance(entry, dict) else str(entry or "").strip()
            if text:
                lines.append(text)
    return lines[:6]


def _days_since(iso: Optional[str]) -> Optional[int]:
    if not iso:
        return None
    try:
        seen = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
    except ValueError:
        return None
    if seen.tzinfo is None:
        seen = seen.replace(tzinfo=timezone.utc)
    return max(0, (_now() - seen).days)


def _anchors(student: dict[str, Any],
             rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """What a suggestion is allowed to point at: the planner's next objective
    and the topics the numbers say were hardest. The model picks one BY KEY and
    the key is validated on the way back — it can never send the teacher to
    build a task about something the record does not contain."""
    from app.services import topic_digest

    anchors: list[dict[str, Any]] = []
    focus = student.get("focus") or {}
    if focus.get("objective_id") and focus.get("objective_title"):
        anchors.append({
            "key": f"obj:{focus['objective_id']}",
            "title": focus["objective_title"],
            "subject": focus.get("subject"),
            "objective_id": focus["objective_id"],
            "kind": "next_in_plan",
        })
    for topic in topic_digest.build_topics(rows)[:4]:
        if any(a["key"] == topic["key"] for a in anchors):
            continue  # already here as the planner's pick — keep that framing
        anchors.append({
            "key": topic["key"],
            "title": topic["label"],
            "subject": topic["subject"] or None,
            "objective_id": topic.get("objective_id"),
            "kind": "hard_topic",
            "attempts": topic["attempts"],
            "correct": topic["correct"],
        })
    return anchors


def _recent_work(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """What the child actually did, as counts — the model turns these into the
    'lately' sentence instead of guessing engagement from goal states."""
    minutes = round(sum(float(r.get("time_seconds") or 0) for r in rows) / 60)
    return {
        "questions_touched": len(rows),
        "answers_given": sum(int(r.get("attempts") or 0) for r in rows),
        "distinct_learnings": len({r.get("component_id") for r in rows if r.get("component_id")}),
        "minutes_in_questions": minutes,
    }


async def _evidence(learner_id: str, language: str,
                    subject: Optional[str] = None,
                    ) -> tuple[dict[str, Any], list[dict[str, Any]], set[str]]:
    """Everything the read is allowed to be built from, in words — plus the
    anchor list the suggestion must choose from and the subject ids a section
    may be written about.

    Written out as SENTENCES and labelled counts rather than handed over as the
    internal documents. The first version passed the raw shapes through, and the
    model dutifully quoted them back: a teacher read "יש שלושה יעדים פתוחים
    במצב working" and "0 ימי חוסר פעילות עם last_event_at". A field name in a
    sentence about a child is the payload leaking through the prose, which is
    the exact failure the evidence disclosures were rewritten to stop.
    """
    from app.brain.context_engine import view_for
    from app.services import insights, kata_catalog, learner_activity, learning_analytics

    try:
        view = await view_for("teacher_assistant", learner_id)
    except Exception:
        view = {}

    student = await insights.student_insights(learner_id, language=language, subject=subject)
    activity = student.get("activity") or {}

    try:
        await kata_catalog.ensure_loaded()
        rows = learning_analytics.label_learner_rows(
            await learner_activity.question_summary(learner_id, subject=subject),
            language=language)
    except Exception:  # pragma: no cover - the read survives without rows
        rows = []

    from app.services.learner_activity import HIDDEN_SUBJECTS

    progress = []
    for subject_id, stats in (student.get("progress") or {}).items():
        if subject_id in HIDDEN_SUBJECTS:
            continue
        total = stats.get("objectives_total") or 0
        if not total:
            continue
        progress.append(
            f"{subject_id}: mastered {stats.get('objectives_mastered', 0)} of {total} objectives")

    goals = [
        str(goal.get("title") or "").strip()
        for goal in (view.get("goals") or [])[:5]
        if str(goal.get("title") or "").strip()
    ]

    anchors = _anchors(student, rows)
    # Every subject the evidence below can NAME: the catalogue-backed ones and
    # the brain's own progress keys (English lives only in the latter). A
    # subject missing here gets its section dropped at validation — so this
    # set must cover exactly what `progress_by_subject` will say.
    known_subjects = (
        {a["subject"] for a in anchors if a.get("subject")}
        | {str(s) for s in (student.get("objectives_progress") or {})}
        | {str(s) for s in (student.get("progress") or {})}
    ) - HIDDEN_SUBJECTS

    evidence = {
        "difficulties_recorded": [
            " — ".join(part for part in [
                str(item.get("label") or "").strip(),
                str(item.get("evidence") or "").strip(),
            ] if part)
            for item in (student.get("struggle_items") or [])[:6]
        ],
        "strengths_recorded": (student.get("strengths") or [])[:5],
        "flags_raised": [
            str(flag.get("evidence") or "").strip()
            for flag in (student.get("attention_all") or [])[:4]
            if str(flag.get("evidence") or "").strip()
        ],
        "has_ever_started": bool(activity.get("started")),
        "days_since_last_activity": activity.get("days_inactive"),
        "days_since_last_recorded_event": _days_since(activity.get("last_event_at")),
        "progress_by_subject": progress,
        # Both of these arrive as STRUCTURES and were being stringified whole.
        # `str({'label': …, 'status': 'working'})` is how "במצב working" reached
        # a teacher's screen: the dict's own repr, quoted back as prose.
        "open_challenges": _labels(view.get("challenges")),
        "how_the_student_describes_themselves": _description(view.get("student_description")),
        "goals_the_student_is_working_on": goals,
        "what_they_did_recently": _recent_work(rows),
        "hardest_topics_by_the_numbers": [
            {"topic": a["title"], "subject": a.get("subject"),
             "attempts": a.get("attempts"), "correct": a.get("correct")}
            for a in anchors if a.get("kind") == "hard_topic"
        ],
    }
    return evidence, anchors, known_subjects


#: Bounds for the per-subject sections.
MAX_SUBJECTS = 3
MAX_SUBJECT_POINTS = 2


def _clean(payload: Any, anchors: list[dict[str, Any]],
           known_subjects: frozenset[str] | set[str] = frozenset(),
           ) -> Optional[dict[str, Any]]:
    """Bound and type-check what the model returned. `None` if it is unusable.

    The suggestion's target is validated against the anchors WE offered, and
    the anchor stored on the read is rebuilt from our own record — title,
    subject and objective id are never taken from the model. Subject sections
    are validated the same way: a subject the evidence never named is dropped,
    because a section about it could only be invented.
    """
    if not isinstance(payload, dict):
        return None

    def line(key: str) -> str:
        return str(payload.get(key) or "").strip()[:MAX_POINT_CHARS]

    from app.services.learner_activity import HIDDEN_SUBJECTS

    subjects: list[dict[str, Any]] = []
    for item in (payload.get("subjects") or [])[:MAX_SUBJECTS]:
        if not isinstance(item, dict):
            continue
        subject_id = str(item.get("subject") or "").strip()
        if not subject_id or subject_id in HIDDEN_SUBJECTS:
            continue
        if known_subjects and subject_id not in known_subjects:
            continue
        summary = str(item.get("summary") or "").strip()[:MAX_POINT_CHARS]
        points = [
            str(point).strip()[:MAX_POINT_CHARS]
            for point in (item.get("points") or [])[:MAX_SUBJECT_POINTS]
            if str(point or "").strip()
        ]
        if points or summary:
            subjects.append({"subject": subject_id, "summary": summary,
                             "points": points})

    target = str(payload.get("suggestion_target") or "").strip()
    anchor = next((a for a in anchors if a["key"] == target), None)

    # The overview promised the teacher prose with no figures in it — a "%"
    # means the model restated the dashboard instead, and the paragraph under
    # the numbers must not repeat them.
    overview = str(payload.get("overview") or "").strip()[:MAX_OVERVIEW_CHARS]
    if "%" in overview:
        overview = ""

    read = {
        "overview": overview,
        "subjects": subjects,
        "suggestion": line("suggestion"),
        "suggestion_anchor": {
            "key": anchor["key"], "title": anchor["title"],
            "subject": anchor.get("subject"),
            "objective_id": anchor.get("objective_id"),
        } if anchor else None,
    }
    # Every field empty means the model said nothing at all, which is not the
    # same as "this child has nothing to say" and must not be cached as it.
    if not (read["subjects"] or read["overview"] or read["suggestion"]):
        return None
    return read


async def generate(learner_id: str, teacher_id: str, *, language: str = "he",
                   subject: Optional[str] = None) -> dict[str, Any]:
    """One fresh read. Raises `LearnerReadError` when nothing usable came back."""
    from app.services.llm import call_llm
    from app.services.tasks.spec import loads_model_json

    language = language if language in _LANG else "he"
    evidence, anchors, known_subjects = await _evidence(learner_id, language, subject)
    prompt = _PROMPT.format(
        evidence=json.dumps(evidence, ensure_ascii=False)[:6000],
        anchors=json.dumps(
            [{"key": a["key"], "title": a["title"], "subject": a.get("subject"),
              "why_here": a.get("kind")} for a in anchors],
            ensure_ascii=False)[:2000] or "[]",
        language=_LANG[language],
    )
    raw = await call_llm(
        [{"role": "user", "content": prompt}],
        # Attributed to the TEACHER who asked, not to "system". They pressed a
        # button; the cost is theirs, and a per-teacher figure is the only one
        # an org can act on.
        usage_context=UsageContext(
            actor_id=teacher_id, actor_type="teacher",
            endpoint="internal:learner_read", feature="feature_6_teacher_view",
            operation="teacher.learner_read", source="goal_composer",
            request_id=learner_id,
        ),
        max_tokens=900, json_mode=True, model_tier="strong",
    )
    read = _clean(loads_model_json(raw), anchors, known_subjects) if raw else None
    if read is None:
        raise LearnerReadError("no_read")
    return read


def _without_hidden(read: dict[str, Any]) -> dict[str, Any]:
    """Strip hidden-subject sections at serving time.

    Generation already refuses them, but a read cached BEFORE a subject was
    hidden would keep showing it for up to a day — the stored row is served
    as-is, so the filter has to ride the way out.
    """
    from app.services.learner_activity import HIDDEN_SUBJECTS

    sections = read.get("subjects")
    if not isinstance(sections, list):
        return read
    return {**read, "subjects": [
        section for section in sections
        if not (isinstance(section, dict)
                and section.get("subject") in HIDDEN_SUBJECTS)
    ]}


async def get(learner_id: str, teacher_id: str, *, language: str = "he",
              subject: Optional[str] = None,
              refresh: bool = False) -> dict[str, Any]:
    """The cached read, or a fresh one. Always carries `generated_at`.

    A stale row survives a failed refresh: an account of the child from this
    morning is worth more than an error panel, and it says when it was written.
    """
    key = read_id(learner_id, language)
    handle = _collection()
    existing = None
    if handle is not None:
        try:
            existing = await handle.find_one({"_id": key})
        except Exception:  # pragma: no cover - a cache miss, not a failure
            existing = None

    if existing and is_fresh(existing) and not refresh:
        return {**_without_hidden(existing["read"]),
                "generated_at": existing["generated_at"], "cached": True}

    try:
        read = await generate(learner_id, teacher_id, language=language, subject=subject)
    except Exception as exc:
        if existing and existing.get("read"):
            print(f"⚠️ learner read refresh failed, serving stale: {type(exc).__name__}")
            return {**_without_hidden(existing["read"]),
                    "generated_at": existing["generated_at"],
                    "cached": True, "stale": True}
        raise

    at = _now().isoformat()
    if handle is not None:
        try:
            await handle.update_one(
                {"_id": key},
                {"$set": {"_id": key, "learner_id": learner_id, "language": language,
                          "read": read, "generated_at": at}},
                upsert=True,
            )
        except Exception as exc:  # pragma: no cover - the read still returns
            print(f"⚠️ learner read not cached: {type(exc).__name__}: {exc}")
    return {**read, "generated_at": at, "cached": False}
