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
MAX_POINTS = 4
MAX_POINT_CHARS = 220


class LearnerReadError(RuntimeError):
    """No read could be produced. Raised rather than returning an empty one, so
    a caller cannot mistake "the model was down" for "nothing to say"."""


def _collection():
    from app.brain.repository import _get_collection_named
    return _get_collection_named(COLLECTION)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def read_id(learner_id: str, language: str) -> str:
    """Per language: the read is prose, and a Hebrew one is not an English one."""
    return f"{learner_id}:{language}"


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


_PROMPT = """You are Yuvi, reading one student's record for their teacher, who is
about to set them a goal.

Everything you may use is below. It is the whole of what you know — you have not
met this student and you have not read their chats. Say nothing the evidence
does not support, and do not invent a number.

EVIDENCE:
{evidence}

Answer with JSON only:
{{"difficulties": ["one short sentence naming a specific difficulty, with what
                   it is based on", ...up to {max_points}],
  "improvements": ["one short sentence naming something that has got better",
                   ...up to {max_points}],
  "involvement": "one sentence on how engaged they are, based on activity and
                  goals — never a judgement of character",
  "suggestion": "one sentence: the single most useful thing to work on next"}}

Rules:
- Write in {language}.
- NEVER quote a field name, an id or an internal value from the evidence. Words
  like "last_event_at" or "working" are plumbing; a teacher reading them learns
  nothing and stops trusting the rest. Say "three days without activity".
- A goal the student is working on is not a difficulty. Do not list one as one.
- Each sentence names the evidence: "5 wrong in a row on X", "3 days without
  activity", not "seems to be struggling".
- An empty list is a correct answer. If nothing has improved, return
  "improvements": [] — a made-up improvement is worse than none.
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


async def _evidence(learner_id: str, language: str,
                    subject: Optional[str] = None) -> dict[str, Any]:
    """Everything the read is allowed to be built from, in words.

    Written out as SENTENCES and labelled counts rather than handed over as the
    internal documents. The first version passed the raw shapes through, and the
    model dutifully quoted them back: a teacher read "יש שלושה יעדים פתוחים
    במצב working" and "0 ימי חוסר פעילות עם last_event_at". A field name in a
    sentence about a child is the payload leaking through the prose, which is
    the exact failure the evidence disclosures were rewritten to stop.
    """
    from app.brain.context_engine import view_for
    from app.services import insights

    try:
        view = await view_for("teacher_assistant", learner_id)
    except Exception:
        view = {}

    student = await insights.student_insights(learner_id, language=language, subject=subject)
    activity = student.get("activity") or {}

    progress = []
    for subject_id, stats in (student.get("progress") or {}).items():
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

    return {
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
    }


def _clean(payload: Any) -> Optional[dict[str, Any]]:
    """Bound and type-check what the model returned. `None` if it is unusable."""
    if not isinstance(payload, dict):
        return None

    def points(key: str) -> list[str]:
        raw = payload.get(key)
        if not isinstance(raw, list):
            return []
        return [
            str(item).strip()[:MAX_POINT_CHARS]
            for item in raw[:MAX_POINTS] if str(item or "").strip()
        ]

    def line(key: str) -> str:
        return str(payload.get(key) or "").strip()[:MAX_POINT_CHARS]

    read = {
        "difficulties": points("difficulties"),
        "improvements": points("improvements"),
        "involvement": line("involvement"),
        "suggestion": line("suggestion"),
    }
    # Every field empty means the model said nothing at all, which is not the
    # same as "this child has no difficulties" and must not be cached as it.
    if not any(read.values()):
        return None
    return read


async def generate(learner_id: str, teacher_id: str, *, language: str = "he",
                   subject: Optional[str] = None) -> dict[str, Any]:
    """One fresh read. Raises `LearnerReadError` when nothing usable came back."""
    from app.services.llm import call_llm
    from app.services.tasks.spec import loads_model_json

    language = language if language in _LANG else "he"
    evidence = await _evidence(learner_id, language, subject)
    prompt = _PROMPT.format(
        evidence=json.dumps(evidence, ensure_ascii=False)[:6000],
        language=_LANG[language],
        max_points=MAX_POINTS,
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
    read = _clean(loads_model_json(raw)) if raw else None
    if read is None:
        raise LearnerReadError("no_read")
    return read


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
        return {**existing["read"], "generated_at": existing["generated_at"],
                "cached": True}

    try:
        read = await generate(learner_id, teacher_id, language=language, subject=subject)
    except Exception as exc:
        if existing and existing.get("read"):
            print(f"⚠️ learner read refresh failed, serving stale: {type(exc).__name__}")
            return {**existing["read"], "generated_at": existing["generated_at"],
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
