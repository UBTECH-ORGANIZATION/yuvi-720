"""What happened while you were away — the teacher's front door.

The dashboard used to open on four numbers and a list, which is a filing cabinet,
not a briefing. This is the thing a teacher reads first: a short account of what
changed since they were last here, and two or three moves they can make about it.

Three decisions shape the whole file.

**The window is personal, not a calendar day.** A brief covers the ground since
the *previous brief* (falling back to the teacher's previous login, then a week),
so nothing is missed and nothing is counted twice. "Yesterday" is meaningless to
a teacher who was away Thursday and Friday.

**It regenerates on visit, but at most once a day.** There is no scheduler in
this codebase and adding one for this would fan out per worker. Instead the first
page load after `MIN_REGENERATE_HOURS` pays for the generation and everyone else
reads the cache — including the teacher's other tabs, via `_tasks`, which is the
in-flight dedupe `weekly_digest` lacks.

**Actions are assembled here, never by the model.** Every action's `learner_ids`
comes out of `learning_gaps` or the attention list, which are computed from
mastery evidence. The model writes the sentence; it does not choose the children.
That is the same rule as the `because` gate one line down — a claim with no
signal behind it is dropped rather than shown.

Nothing here compares children. The inputs are group aggregates and counts.
"""

from __future__ import annotations

import asyncio
import json
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from app.brain.repository import _get_collection_named

COLLECTION = "teacher_briefs"

MAX_BULLETS = 3
MAX_ACTIONS = 3

# A brief that regenerated on every page load would be an LLM call per refresh
# and a subtly different story every time a teacher blinked. Once a day is the
# cadence the content actually changes at.
MIN_REGENERATE_HOURS = 24

# How far back a first brief looks when there is nothing to date it from.
DEFAULT_WINDOW_DAYS = 7
# The analytics windows are day-grained and stop being meaningful past a
# fortnight; a teacher back from a month's leave gets "the last two weeks",
# stated honestly, rather than a number that pretends to cover it all.
MAX_WINDOW_DAYS = 14

# Two tabs, or two co-teachers opening the same class at 07:58, must not each
# pay for a generation. Same pattern as `question_explainer`.
_tasks: dict[str, asyncio.Task] = {}

#: Keys every brief this module writes carries. A cached document missing any
#: of them was written by an older build and is regenerated on sight — see
#: `is_fresh`. Add to this set whenever the payload's shape changes.
_REQUIRED_KEYS = frozenset({"scene", "worked_on"})

#: The moods `YuviScene` can draw. Closed set: the model picks one, code draws
#: it, and anything else is dropped rather than passed through to a component
#: that has no art for it. Mirrored by the frontend catalogue, with a contract
#: test between the two.
SCENES = ("celebrating", "cheering_on", "pointing", "waiting", "thinking")


def _fallback_scene(facts: dict[str, Any]) -> str:
    """The mood, read off the aggregates, for when no model ran.

    Deliberate rather than a default: `source: 'fallback'` still gets a hero
    that looks like it is about this class, not a shrug.
    """
    total = facts.get("students_total") or 0
    active = facts.get("active_in_window") or 0
    if not total:
        return "thinking"
    if facts.get("not_started") and active <= total / 3:
        return "waiting"
    if facts.get("gaps"):
        return "pointing"
    if active >= total * 0.75:
        return "celebrating"
    return "cheering_on"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _cache_id(teacher_id: str, group_id: str, language: str) -> str:
    return f"{teacher_id}:{group_id}:{language}"


def _parse(value: Any) -> Optional[datetime]:
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def window_days(since: Optional[datetime], now: Optional[datetime] = None) -> int:
    """Whole days of ground to cover, clamped to what the analytics can answer."""
    if since is None:
        return DEFAULT_WINDOW_DAYS
    elapsed = ((now or _now()) - since).total_seconds() / 86400
    return max(1, min(MAX_WINDOW_DAYS, int(elapsed) + (1 if elapsed % 1 else 0)))


def is_fresh(cached: Optional[dict[str, Any]], now: Optional[datetime] = None) -> bool:
    """True when the cached brief is young enough AND new enough to serve as-is.

    Age alone is not the question. A brief cached by an older build of this
    module is *young* and *wrong* — it has no scene, no people under its
    bullets, and a stat row the card no longer renders. For a whole day after
    a deploy every teacher would read the previous version of the feature.

    So the document's own shape decides. A key this writer always emits, absent
    from the cache, means the cache predates the writer. No version field: the
    content says what wrote it, which is one fewer thing to remember to bump.
    """
    cached = cached or {}
    generated = _parse(cached.get("generated_at"))
    if generated is None:
        return False
    if any(key not in cached for key in _REQUIRED_KEYS):
        return False
    return (now or _now()) - generated < timedelta(hours=MIN_REGENERATE_HOURS)


async def _load(cache_id: str) -> Optional[dict[str, Any]]:
    collection = _get_collection_named(COLLECTION)
    if collection is None:
        return None
    try:
        return await collection.find_one({"_id": cache_id})
    except Exception as exc:      # pragma: no cover
        print(f"⚠️ brief cache read failed: {type(exc).__name__}")
        return None


async def _store(cache_id: str, brief: dict[str, Any]) -> None:
    collection = _get_collection_named(COLLECTION)
    if collection is None:
        return
    try:
        await collection.update_one(
            {"_id": cache_id}, {"$set": {"_id": cache_id, **brief}}, upsert=True)
    except Exception as exc:      # pragma: no cover
        print(f"⚠️ brief cache write failed: {type(exc).__name__}")


async def _previous_login(teacher_id: str) -> Optional[datetime]:
    """When this teacher was last here *before* the session reading this.

    `touch_last_login` carries the old stamp into `previous_login_at` precisely
    so this is answerable — by the time a dashboard request arrives,
    `last_login_at` is already the current session.
    """
    try:
        from app.auth.repository import get_user_by_id

        return _parse((await get_user_by_id(teacher_id) or {}).get("previous_login_at"))
    except Exception as exc:      # pragma: no cover — a wider window is not a failure
        print(f"⚠️ previous login read skipped: {type(exc).__name__}")
        return None


def _subject_progress(snapshot: dict[str, Any]) -> list[dict[str, Any]]:
    """How far the class is through each subject, rolled up from per-learner rows.

    `student_insights` computes this for every learner on every call and the
    group snapshot then throws all of it away except one grand total. Summing
    it here costs nothing and is the difference between "42 objectives mastered"
    and "the class is 42% through algebra" — the second is a sentence a teacher
    can act on.
    """
    totals: dict[str, dict[str, int]] = {}
    for student in snapshot.get("students") or []:
        for subject, row in (student.get("progress") or {}).items():
            bucket = totals.setdefault(subject, {"mastered": 0, "possible": 0, "in_progress": 0})
            bucket["mastered"] += int(row.get("objectives_mastered") or 0)
            bucket["in_progress"] += int(row.get("objectives_in_progress") or 0)
            bucket["possible"] += int(row.get("objectives_total") or 0)

    rows = [
        {"subject": subject, "mastered": bucket["mastered"],
         "in_progress": bucket["in_progress"], "possible": bucket["possible"],
         "percent": round(100 * bucket["mastered"] / bucket["possible"])}
        for subject, bucket in totals.items() if bucket["possible"]
    ]
    # Only subjects the class has actually touched; a 0% row for every subject
    # in the catalogue is noise the model would dutifully write about.
    rows = [row for row in rows if row["mastered"] or row["in_progress"]]
    rows.sort(key=lambda row: row["percent"], reverse=True)
    return rows[:4]


async def _goal_backlog(learner_ids: list[str]) -> dict[str, int]:
    """Two things the brief has never been able to see: goals waiting on the
    teacher, and goals where the learner asked for help.

    A fan-out, so it is bounded and it fails soft — a brief without this line is
    a smaller brief, not a broken one. It is affordable because the brief is
    cached per teacher/class/language and deduped in flight.
    """
    import asyncio

    from app.services import mentoring

    semaphore = asyncio.Semaphore(6)

    async def one(learner_id: str) -> tuple[int, int]:
        async with semaphore:
            try:
                conversations = await mentoring.list_conversations(
                    learner_id, viewer_role="teacher")
            except Exception:
                return 0, 0
        waiting = helping = 0
        for conversation in conversations or []:
            for goal in conversation.get("goals") or []:
                if goal.get("progress_stage") == "summarized" and not goal.get("approved_by"):
                    waiting += 1
                if goal.get("needs_help"):
                    helping += 1
        return waiting, helping

    rows = await asyncio.gather(*(one(learner_id) for learner_id in learner_ids[:60]))
    return {"awaiting_approval": sum(row[0] for row in rows),
            "needs_help": sum(row[1] for row in rows)}


async def _worked_on(group_id: str, language: str) -> list[dict[str, Any]]:
    """What the class actually did — the thing the brief could never say.

    Every other fact is a property of the learners; this is a property of the
    material. "They spent the week on coordinate systems and got 49% of it
    right" is the sentence a teacher opens the dashboard hoping to read.
    """
    from app.services import learning_analytics

    try:
        payload = await learning_analytics.group_learnings(group_id, language=language)
    except Exception as exc:
        print(f"⚠️ brief worked-on read skipped: {type(exc).__name__}")
        return []

    rows = [row for row in (payload.get("learnings") or []) if row.get("attempts")]
    rows.sort(key=lambda row: row["attempts"], reverse=True)
    return [
        {"title": row.get("title"), "subject": row.get("subject"),
         "attempts": row.get("attempts"), "success_rate": row.get("success_rate"),
         "learners_engaged": row.get("learners_engaged"),
         "struggling_count": row.get("struggling_count")}
        for row in rows[:4]
    ]


async def _gather_facts(
    group_id: str, language: str, days: int,
) -> tuple[dict[str, Any], list[dict[str, Any]], dict[str, Any]]:
    """The aggregates a bullet may be written about, plus the two sources an
    ACTION may be built from. Counts only in the first; the gaps and the snapshot
    are returned separately because they carry learner ids the model never sees.

    Everything added here was already being computed and thrown away. The old
    prompt reduced a whole week to nine scalars, which is why the writing came
    out flat: with only `active_in_window: 10` to work from there is no way to
    say anything but "10 students were active". The misconception samples and
    the per-day series are what let it say something a teacher did not know.
    """
    from app.services import group_analytics, insights, moments

    snapshot = await insights.group_insights(group_id, language)
    engagement = await group_analytics.engagement(group_id, days=days)
    gaps = await group_analytics.learning_gaps(group_id)
    feed = await moments.moments_for_group(group_id, language=language, days=days, limit=40)
    # Both of these are fan-outs, and an empty class has nothing for them to
    # find — `get_brief` is about to return "empty" anyway.
    learner_ids = [row.get("learner_id") for row in (snapshot.get("students") or [])
                   if row.get("learner_id")]
    worked_on = await _worked_on(group_id, language) if learner_ids else []
    backlog = await _goal_backlog(learner_ids) if learner_ids else {}

    kinds: dict[str, int] = {}
    for row in feed:
        kinds[row["kind"]] = kinds.get(row["kind"], 0) + 1

    # Reasons, not people. `attention` rows carry a learner id and a display
    # name; only the translated reason and its kind cross into the prompt, so
    # the model can say *why* someone needs attention without knowing who.
    reasons: dict[tuple[str, str], int] = {}
    for row in snapshot.get("attention") or []:
        key = (str(row.get("kind") or ""), str(row.get("reason") or ""))
        if key[1]:
            reasons[key] = reasons.get(key, 0) + 1

    trends = snapshot.get("trends") or {}
    return {
        "window_days": days,
        "students_total": trends.get("students_total"),
        "active_in_window": engagement.get("active_students"),
        "active_pct": engagement.get("active_pct"),
        "active_last_7d": trends.get("active_last_7d"),
        "needing_attention": trends.get("needing_attention"),
        "not_started": trends.get("not_started"),
        "objectives_mastered_total": trends.get("objectives_mastered_total"),
        "avg_active_minutes": engagement.get("avg_active_minutes"),
        "timing_available": engagement.get("timing_available"),
        # The shape of the week, not just its average. "Tuesday was empty and
        # they all came back Thursday" is a sentence only this makes possible.
        "active_per_day": [
            {"date": row.get("date"), "active": row.get("active")}
            for row in (engagement.get("per_day_active") or [])[-14:]
        ],
        "gaps": [
            # `objective_id` is a curriculum id, not a person — it crosses into
            # the facts so the fallback path's gap bullet can find its people
            # and its destination the same way an AI one does.
            {"objective_id": gap.get("objective_id"),
             "label": gap.get("label"), "subject": gap.get("subject"),
             "struggling_count": gap.get("struggling_count"),
             "mastered_count": gap.get("mastered_count"),
             "with_evidence": gap.get("with_evidence"),
             "group_size": gap.get("group_size"),
             "struggle_share": gap.get("struggle_share"),
             "kind": gap.get("kind"),
             # The single most useful field in the whole payload: *how* they are
             # getting it wrong, rather than how many of them are.
             "common_mistakes": [
                 {"tag": tag, "count": count}
                 for tag, count in
                 ((gap.get("evidence") or {}).get("sample_misconceptions") or [])[:3]
             ]}
            for gap in gaps[:4]
        ],
        "moment_counts": kinds,
        # The feed's own rows, not just a histogram of them. A moment carries an
        # objective label and a weight and no name at all, so the class's actual
        # story crosses over while the children stay anonymous.
        "moments": [
            {"kind": row.get("kind"), "label": row.get("label"),
             "weight": row.get("weight"), "headline": row.get("headline")}
            for row in sorted(
                feed, key=lambda row: row.get("weight") or 0, reverse=True)[:8]
        ],
        # Kinds only — a headline never names a child, and the model is not
        # given learner ids at all.
        "attention_kinds": _count_kinds(snapshot.get("attention") or []),
        "attention_reasons": [
            {"kind": kind, "reason": reason, "count": count}
            for (kind, reason), count in sorted(
                reasons.items(), key=lambda item: item[1], reverse=True)[:4]
        ],
        "subject_progress": _subject_progress(snapshot),
        "goal_backlog": backlog,
        "worked_on": worked_on,
    }, gaps, snapshot


def _count_kinds(rows: list[dict[str, Any]]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for row in rows:
        kind = row.get("kind")
        if kind:
            counts[kind] = counts.get(kind, 0) + 1
    return counts


#: Signals whose claim is about specific children, and where to find them.
#:
#: The model still never receives a learner id — `_facts` is scrubbed and the
#: prompt says so, and `test_the_model_is_never_given_a_learner_id` holds. The
#: people are attached HERE, after the sentence has been written and grounded,
#: from the same evidence `_build_actions` picks its targets out of. The model
#: wrote "four students have not started"; code puts the four faces under it.
_PEOPLE_SIGNALS = frozenset({"not_started", "needing_attention", "learning_gap"})


def _people_for(
    fact: dict[str, Any], gaps: list[dict[str, Any]], snapshot: dict[str, Any],
) -> list[str]:
    """Who a grounded claim is about, or nothing when it is about no one.

    Signals like `subject_progress` and `worked_on` are properties of the
    material rather than of people; attaching a roster to them would put faces
    under a sentence they have nothing to do with.

    Deliberately UNCAPPED, like `_build_actions` beside it. Capping here was a
    quiet lie: the client shows four faces and "+N more" computed from the list
    it was given, so a server-side cap of eight rendered "+4" under a sentence
    that said twelve. Where to stop drawing faces is the client's decision and
    it needs the true total to make it.
    """
    signal = str(fact.get("signal") or "")
    if signal.startswith("attention_") or signal == "needing_attention":
        return [row.get("learner_id") for row in (snapshot.get("attention") or [])
                if row.get("learner_id")]
    if signal == "not_started":
        return [row.get("learner_id") for row in (snapshot.get("students") or [])
                if row.get("learner_id") and row.get("status") == "not_started"]
    if signal == "learning_gap":
        # Matched on the objective the ref carries, not on the label: two gaps
        # can share a label across subjects, and an id cannot collide.
        wanted = fact.get("objective_id")
        for gap in gaps:
            if wanted and gap.get("objective_id") == wanted:
                return list(gap.get("learner_ids") or [])
    return []


def _build_actions(
    gaps: list[dict[str, Any]], snapshot: dict[str, Any],
) -> list[dict[str, Any]]:
    """Moves the teacher can make, derived from evidence — not from the model.

    Every `learner_ids` here came out of `learning_gaps` (computed over mastery
    entries) or the attention list. The model never sees a learner id and never
    picks who an action is about; it writes prose about counts.
    """
    actions: list[dict[str, Any]] = []

    for gap in gaps:
        if gap.get("kind") != "gap" or not gap.get("learner_ids"):
            continue
        actions.append({
            "kind": "assign_subgroup",
            "objective_id": gap.get("objective_id"),
            "label": gap.get("label"),
            "learner_ids": gap["learner_ids"],
            "because": {"signal": "learning_gap", "value": gap.get("struggling_count"),
                        "raw": {"label": gap.get("label"),
                                "struggling_count": gap.get("struggling_count"),
                                "with_evidence": gap.get("with_evidence")}},
        })
        if len(actions) >= MAX_ACTIONS - 1:
            break

    attention = snapshot.get("attention") or []
    if attention:
        actions.append({
            "kind": "open_roster",
            "filter": "attention",
            "learner_ids": [row.get("learner_id") for row in attention if row.get("learner_id")],
            "because": {"signal": "needing_attention", "value": len(attention),
                        "raw": {"needing_attention": len(attention)}},
        })

    return actions[:MAX_ACTIONS]


def _fallback(facts: dict[str, Any]) -> tuple[Optional[dict[str, Any]], list[dict[str, Any]]]:
    """A real brief with no LLM: locale keys over the same numbers.

    Not a placeholder — with no credentials configured the panel still tells a
    teacher the three things that changed, from the aggregates directly.
    """
    bullets: list[dict[str, Any]] = []

    active, total = facts.get("active_in_window"), facts.get("students_total")
    headline = None
    if total:
        headline = {
            "text_key": "tch.brief.fallback.headline",
            "params": {"active": active or 0, "total": total,
                       "days": facts.get("window_days") or DEFAULT_WINDOW_DAYS},
            "because": {"signal": "active_in_window", "value": active,
                        "raw": {"active_in_window": active, "students_total": total}},
        }

    attention = facts.get("needing_attention")
    if attention:
        bullets.append({
            "text_key": "tch.brief.fallback.attention",
            "params": {"count": attention},
            "because": {"signal": "needing_attention", "value": attention,
                        "raw": {"needing_attention": attention}},
        })

    gaps = facts.get("gaps") or []
    if gaps:
        gap = gaps[0]
        bullets.append({
            "text_key": "tch.brief.fallback.gap",
            "params": {"label": gap.get("label") or "",
                       "count": gap.get("struggling_count") or 0},
            "because": {"signal": "learning_gap", "value": gap.get("struggling_count"),
                        "raw": gap},
        })

    not_started = facts.get("not_started")
    if not_started:
        bullets.append({
            "text_key": "tch.brief.fallback.notStarted",
            "params": {"count": not_started},
            "because": {"signal": "not_started", "value": not_started,
                        "raw": {"not_started": not_started}},
        })

    return headline, bullets[:MAX_BULLETS]


_SYSTEM = {
    "he": "אתה כותב למורה תקציר קצר על מה שקרה בכיתה מאז שהיה כאן בפעם הקודמת.",
    "ar": "أنت تكتب للمعلّم ملخصًا قصيرًا عمّا حدث في الصف منذ زيارته الأخيرة.",
    "en": "You write a teacher a short brief on what happened in their class since "
          "they were last here.",
}


def _refs(facts: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """The facts a bullet may stand on, each behind an opaque id.

    Opaque on purpose. The old contract asked the model to name the "signal" it
    used, and then believed whatever it wrote — an invented key passed the gate
    as easily as a real one, because nothing compared it to anything. A short
    id it can only have got from this table cannot be guessed into existence.
    """
    table: dict[str, dict[str, Any]] = {}

    def add(key: str, value: Any, **extra: Any) -> None:
        if value in (None, ""):
            return
        table[f"f{len(table) + 1}"] = {"signal": key, "value": value, **extra}

    add("active_in_window", facts.get("active_in_window"), total=facts.get("students_total"))
    add("active_pct", facts.get("active_pct"))
    add("needing_attention", facts.get("needing_attention"))
    add("not_started", facts.get("not_started"))
    add("objectives_mastered_total", facts.get("objectives_mastered_total"))
    if facts.get("timing_available"):
        add("avg_active_minutes", facts.get("avg_active_minutes"))
    for gap in facts.get("gaps") or []:
        # `objective_id` rides along so a bullet about this gap has somewhere to
        # go. It carried the label and not the id, which is why a gap bullet was
        # the one claim on the card a teacher could read and not open.
        add("learning_gap", gap.get("struggling_count"),
            label=gap.get("label"), with_evidence=gap.get("with_evidence"),
            group_size=gap.get("group_size"), kind=gap.get("kind"),
            objective_id=gap.get("objective_id"))
    for kind, count in (facts.get("attention_kinds") or {}).items():
        add(f"attention_{kind}", count)
    for kind, count in (facts.get("moment_counts") or {}).items():
        add(f"moment_{kind}", count)
    for row in facts.get("subject_progress") or []:
        add("subject_progress", row.get("percent"), subject=row.get("subject"),
            mastered=row.get("mastered"), possible=row.get("possible"))
    for row in facts.get("worked_on") or []:
        add("worked_on", row.get("attempts"), label=row.get("title"),
            success_rate=row.get("success_rate"),
            learners_engaged=row.get("learners_engaged"))
    backlog = facts.get("goal_backlog") or {}
    add("goals_awaiting_approval", backlog.get("awaiting_approval") or None)
    add("goals_needing_help", backlog.get("needs_help") or None)
    return table


def _instruction(language: str, facts: dict[str, Any], refs: dict[str, dict[str, Any]]) -> str:
    """The prompt asks for prose and nothing else.

    Deliberately no stats, no actions, no greeting: those are a lookup, a table
    and a time-of-day branch, and asking a model to produce them buys nothing
    but three more ways to be subtly wrong in three languages. What is left is
    exactly the part that needs judgement — which of a dozen signals matters
    most this morning, and how to say it to a person.
    """
    catalogue = "\n".join(
        f'  {ref}: {json.dumps(value, ensure_ascii=False, default=str)}'
        for ref, value in refs.items()
    )
    return f"""{_SYSTEM.get(language, _SYSTEM['he'])}

Everything that happened, as JSON:
{json.dumps(facts, ensure_ascii=False, default=str)}

Each claim you make must cite one of these ids:
{catalogue}

Write in {language}, addressing the teacher directly. Return prose only — the \
numbers beside your text, the buttons under it and the greeting above it are \
already handled, so do not write any of them.

- `headline`: the single most important thing that changed, one sentence under 20 words.
- `summary`: two or three sentences tying the week together — what moved, what did \
not, and what it means for the next lesson. This is the part a teacher actually reads.
- `bullets`: up to {MAX_BULLETS}, each one specific thing. Every bullet needs a `ref`.
- `why` on each bullet: one plain sentence explaining what the claim rests on, \
naming the noun and the denominator. Write "ארבעה מתוך שנים־עשר תלמידים שניסו את \
היעד" — never "active_in_window: 10". A teacher opens this to check you, so it must \
read like a person wrote it.

Rules:
- Never invent a figure and never compute a new one. No percentage that is not above.
- Never name or rank a student. You have not been given any names or ids; you speak \
in counts.
- Never build a sentence around a zero — say the absence plainly ("אף אחד לא נכנס \
השבוע"), rather than making zero the subject of a count.
- If something is missing or null, do not write about it. Fewer honest lines beat \
padded ones.
- No gendered slash forms anywhere — not in the headline, the summary or a \
`why`. Write "ארבעה תלמידים", never "ארבע/ה תלמידות/ים". When a sentence would \
need one, rewrite the sentence.

- `scene`: the mood of this week, as ONE of exactly these words — \
{", ".join(SCENES)}. `celebrating` when real ground was gained; `cheering_on` when a \
few moved and others lagged; `pointing` when one gap is the thing to teach next; \
`waiting` for a quiet week or a class that has not started; `thinking` when there is \
too little to say yet. It is drawn as an illustration beside your text, so choose the \
one that matches what you actually wrote. Never invent a sixth.

Return JSON:
{{"headline": "...", "summary": "...", "scene": "waiting", \
"bullets": [{{"text": "...", "why": "...", "ref": "f1"}}]}}"""


def _prose(value: Any, limit: int = 400) -> str:
    return " ".join(str(value or "").split())[:limit]


def _digits_are_real(text: str, facts: dict[str, Any]) -> bool:
    """Reject a sentence containing a number that appears nowhere in the facts.

    Cheap and deliberately conservative — it only catches an outright invented
    figure, not a misread one. The same spirit as the no-arithmetic rule: the
    model is allowed to choose what matters, never to produce a new quantity.
    """
    known = set(re.findall(r"\d+", json.dumps(facts, ensure_ascii=False, default=str)))
    return all(number in known for number in re.findall(r"\d+", text))


def _grounded(item: Any, refs: dict[str, dict[str, Any]], facts: dict[str, Any]):
    """Keep a bullet only if it cites a ref that exists. Everything else is narration."""
    if not isinstance(item, dict):
        return None
    text = _prose(item.get("text"), 240)
    ref = str(item.get("ref") or "")
    fact = refs.get(ref)
    if not text or fact is None or not _digits_are_real(text, facts):
        return None
    return {
        "text": text,
        # The model's own sentence, in the teacher's language, about the actual
        # claim. This replaces `describeEvidence` for AI briefs — which, given a
        # one-key `{signal: value}` raw, was rendering `active in window: 10`.
        "why": _prose(item.get("why"), 240),
        "because": {"signal": fact["signal"], "value": fact.get("value"),
                    "raw": {k: v for k, v in fact.items() if k != "signal"}},
    }


async def _generate(
    teacher_id: str, group_id: str, language: str, since: Optional[datetime],
) -> dict[str, Any]:
    from app.services.ai_usage import UsageContext
    from app.services.llm import call_llm

    days = window_days(since)
    facts, gaps, snapshot = await _gather_facts(group_id, language, days)

    if not facts.get("students_total"):
        return {"since": since.isoformat() if since else None,
                "generated_at": _now().isoformat(), "window_days": days,
                "headline": None, "summary": "", "bullets": [],
                "stats": [], "actions": [],
                # Present so `is_fresh`'s shape check passes: an empty class is
                # a valid cached brief, and re-deriving it on every page load
                # would fan out over the roster to learn nothing each time.
                "scene": "thinking", "worked_on": None,
                "source": "empty", "reason": "group_has_no_students",
                "group_id": group_id, "teacher_id": teacher_id, "language": language}

    headline: Optional[dict[str, Any]] = None
    summary = ""
    bullets: list[dict[str, Any]] = []
    scene: Optional[str] = None
    source = "fallback"
    refs = _refs(facts)

    raw = await call_llm(
        [{"role": "user", "content": _instruction(language, facts, refs)}],
        usage_context=UsageContext(
            actor_id=teacher_id, actor_type="teacher",
            endpoint="/api/teacher/brief",
            feature="feature_6_teacher_view", operation="teacher.daily_brief",
            source="daily_brief",
        ),
        max_tokens=900, json_mode=True, model_tier="mini",
    )
    if raw:
        try:
            parsed = json.loads(raw)
            # The headline and summary are prose about the whole picture rather
            # than one cited number, so they carry no ref — but they still may
            # not contain a figure the facts do not.
            head_text = _prose(parsed.get("headline"), 160)
            if head_text and _digits_are_real(head_text, facts):
                headline = {"text": head_text, "because": None}
            summary_text = _prose(parsed.get("summary"), 500)
            if summary_text and _digits_are_real(summary_text, facts):
                summary = summary_text
            bullets = [
                line for line in
                (_grounded(item, refs, facts)
                 for item in (parsed.get("bullets") or [])[:MAX_BULLETS])
                if line
            ]
            # A surviving summary counts. Without it, a response whose headline
            # was refused for an invented number but whose paragraph was clean
            # would be labelled "computed from the data" while showing the
            # model's own prose — and the deterministic fallback would then
            # overwrite a headline the model never got to keep.
            # Validated against the closed set, never trusted. A model that
            # writes "hopeful" would otherwise reach a component with no art
            # for it, and the hero's whole left half would render blank.
            proposed = str(parsed.get("scene") or "").strip().lower()
            scene = proposed if proposed in SCENES else None
            if headline or bullets or summary:
                source = "ai"
        except (TypeError, ValueError):
            headline, summary, bullets, scene = None, "", [], None

    if source != "ai":
        headline, bullets = _fallback(facts)

    # Who each claim is about, and where it leads. Both are attached after the
    # prose exists, from evidence — never from anything the model wrote.
    for bullet in bullets:
        because = bullet.get("because") or {}
        fact = {"signal": because.get("signal"), **(because.get("raw") or {})}
        bullet["learner_ids"] = _people_for(fact, gaps, snapshot)

    brief = {
        "since": since.isoformat() if since else None,
        "generated_at": _now().isoformat(),
        "window_days": days,
        "headline": headline,
        "summary": summary,
        "bullets": bullets,
        # The numbers the teacher reads beside the prose. Straight from the
        # aggregates, never re-derived, so the card and the dashboard agree.
        "stats": [
            {"key": "active_in_window", "value": facts.get("active_in_window"),
             "total": facts.get("students_total")},
            {"key": "needing_attention", "value": facts.get("needing_attention")},
            {"key": "not_started", "value": facts.get("not_started")},
        ],
        "actions": _build_actions(gaps, snapshot),
        # Never null: a hero with no scene is a hero with an empty half.
        "scene": scene or _fallback_scene(facts),
        # The material the class actually spent the week on — one quiet line
        # under the illustration. Already computed for the prompt and, until
        # now, discarded before the payload.
        "worked_on": (facts.get("worked_on") or [None])[0],
        "source": source,
        "group_id": group_id,
        "teacher_id": teacher_id,
        "language": language,
    }
    return brief


async def get_brief(
    teacher_id: str, group_id: str, *, language: str = "he", force: bool = False,
) -> dict[str, Any]:
    """This teacher's brief for this class — cached, grounded, honest when empty."""
    cache_id = _cache_id(teacher_id, group_id, language)
    cached = await _load(cache_id)

    if not force and is_fresh(cached):
        return {**{k: v for k, v in cached.items() if k != "_id"}, "cached": True}

    # Only one generation per cache id in flight, so a teacher's second tab and
    # their co-teacher both wait on the same call rather than paying twice.
    running = _tasks.get(cache_id)
    if running is None or running.done():
        since = _parse((cached or {}).get("generated_at")) or await _previous_login(teacher_id)
        running = asyncio.create_task(_generate(teacher_id, group_id, language, since))
        _tasks[cache_id] = running

    try:
        brief = await asyncio.shield(running)
    finally:
        if _tasks.get(cache_id) is running and running.done():
            _tasks.pop(cache_id, None)

    await _store(cache_id, brief)
    return {**brief, "cached": False}


async def ensure_indexes() -> None:
    """The cache is read by `_id` (already indexed); this exists for pruning.

    One document per teacher per class per language, rewritten in place — the
    collection is bounded by the staff list, not by time, which is why there is
    no TTL. The index makes "drop everything older than term N" a range scan.
    """
    handle = _get_collection_named(COLLECTION)
    if handle is None:
        return
    try:
        await handle.create_index([("generated_at", 1)])
    except Exception as exc:          # pragma: no cover - best effort
        print(f"⚠️ teacher_briefs index failed: {type(exc).__name__}")
