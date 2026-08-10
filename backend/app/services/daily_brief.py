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
    """True when the cached brief is young enough to serve as-is."""
    generated = _parse((cached or {}).get("generated_at"))
    if generated is None:
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


async def _gather_facts(
    group_id: str, language: str, days: int,
) -> tuple[dict[str, Any], list[dict[str, Any]], dict[str, Any]]:
    """The aggregates a bullet may be written about, plus the two sources an
    ACTION may be built from. Counts only in the first; the gaps and the snapshot
    are returned separately because they carry learner ids the model never sees."""
    from app.services import group_analytics, insights, moments

    snapshot = await insights.group_insights(group_id, language)
    engagement = await group_analytics.engagement(group_id, days=days)
    gaps = await group_analytics.learning_gaps(group_id)
    feed = await moments.moments_for_group(group_id, language=language, days=days, limit=40)

    kinds: dict[str, int] = {}
    for row in feed:
        kinds[row["kind"]] = kinds.get(row["kind"], 0) + 1

    trends = snapshot.get("trends") or {}
    return {
        "window_days": days,
        "students_total": trends.get("students_total"),
        "active_in_window": engagement.get("active_students"),
        "active_pct": engagement.get("active_pct"),
        "needing_attention": trends.get("needing_attention"),
        "not_started": trends.get("not_started"),
        "objectives_mastered_total": trends.get("objectives_mastered_total"),
        "avg_active_minutes": engagement.get("avg_active_minutes"),
        "timing_available": engagement.get("timing_available"),
        "gaps": [
            {"label": gap.get("label"), "struggling_count": gap.get("struggling_count"),
             "with_evidence": gap.get("with_evidence"), "kind": gap.get("kind")}
            for gap in gaps[:4]
        ],
        "moment_counts": kinds,
        # Kinds only — a headline never names a child, and the model is not
        # given learner ids at all.
        "attention_kinds": _count_kinds(snapshot.get("attention") or []),
    }, gaps, snapshot


def _count_kinds(rows: list[dict[str, Any]]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for row in rows:
        kind = row.get("kind")
        if kind:
            counts[kind] = counts.get(kind, 0) + 1
    return counts


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


def _instruction(language: str, facts: dict[str, Any]) -> str:
    return f"""{_SYSTEM.get(language, _SYSTEM['he'])}

Here are the only facts you may use, as JSON:
{json.dumps(facts, ensure_ascii=False, default=str)}

Write a one-sentence headline and up to {MAX_BULLETS} bullets, in the teacher's \
language ({language}). Rules:
- The headline is the single most important thing that changed. One sentence, under \
20 words, and it must rest on a number that appears above.
- Address the teacher directly. Never refer to them in the third person.
- Every claim must be about a number that appears above. Do not invent any figure, \
and do not compute new ones — no percentages the facts do not already contain.
- Never compare or rank individual students, and never name one. You have not been \
given any student's name or id, and counts are what you speak in.
- If a fact is missing or null, do not write about it. Fewer honest lines beat \
padded ones.
- Never build a sentence around a zero. "0 students were active" is a fact about \
absence, so say the absence plainly ("no one has been in this week") rather than \
making zero the subject of a count.
- No gendered slash forms. Keep each line to something a teacher can act on before \
first period.

Return JSON: {{"headline": {{"text": "...", "because": {{"signal": "<the fact key you \
used>", "value": <the number>}}}}, "bullets": [{{"text": "...", "because": {{"signal": \
"...", "value": <number>}}}}]}}"""


def _grounded(item: Any) -> Optional[dict[str, Any]]:
    """Keep a line only if it cites a fact. Everything else is narration."""
    if not isinstance(item, dict):
        return None
    text = str(item.get("text") or "").strip()
    because = item.get("because") or {}
    signal = because.get("signal")
    if not text or not signal:
        return None
    return {
        "text": text,
        "because": {"signal": signal, "value": because.get("value"),
                    "raw": {signal: because.get("value")}},
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
                "headline": None, "bullets": [], "stats": [], "actions": [],
                "source": "empty", "reason": "group_has_no_students",
                "group_id": group_id, "teacher_id": teacher_id, "language": language}

    headline: Optional[dict[str, Any]] = None
    bullets: list[dict[str, Any]] = []
    source = "fallback"

    raw = await call_llm(
        [{"role": "user", "content": _instruction(language, facts)}],
        usage_context=UsageContext(
            actor_id=teacher_id, actor_type="teacher",
            endpoint="/api/teacher/brief",
            feature="feature_6_teacher_view", operation="teacher.daily_brief",
            source="daily_brief",
        ),
        max_tokens=700, json_mode=True, model_tier="mini",
    )
    if raw:
        try:
            parsed = json.loads(raw)
            headline = _grounded(parsed.get("headline"))
            bullets = [
                line for line in
                (_grounded(item) for item in (parsed.get("bullets") or [])[:MAX_BULLETS])
                if line
            ]
            if headline or bullets:
                source = "ai"
        except (TypeError, ValueError):
            headline, bullets = None, []

    if source != "ai":
        headline, bullets = _fallback(facts)

    brief = {
        "since": since.isoformat() if since else None,
        "generated_at": _now().isoformat(),
        "window_days": days,
        "headline": headline,
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
