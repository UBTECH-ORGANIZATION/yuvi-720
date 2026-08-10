"""The Sunday-morning co-teacher: a three-bullet brief on what changed (A11 #3).

One LLM call per group per week, cached exactly like `question_explainer` —
generated on the first Home visit of the week and read from cache thereafter, so
a class of thirty teachers refreshing all morning costs one generation.

**Every bullet carries its `because`.** A digest is the easiest place in the
product to drift into pleasant, unfalsifiable narration ("the class is showing
good momentum"), which is worth nothing to a teacher and violates C4. So the
model is given real aggregates and told to cite the number behind each bullet,
and the deterministic fallback does the same without an LLM at all — meaning the
panel is useful even with no credentials configured.

Nothing here compares children. The inputs are group aggregates and counts.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Optional

from app.brain.repository import _get_collection_named

COLLECTION = "group_digests"

MAX_BULLETS = 3


def week_key(moment: Optional[datetime] = None) -> str:
    """ISO year-week. The cache unit, and what "this week" means everywhere here."""
    moment = moment or datetime.now(timezone.utc)
    year, week, _ = moment.isocalendar()
    return f"{year}-W{week:02d}"


def _cache_id(group_id: str, week: str, language: str) -> str:
    return f"{group_id}:{week}:{language}"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _load(cache_id: str) -> Optional[dict[str, Any]]:
    collection = _get_collection_named(COLLECTION)
    if collection is None:
        return None
    try:
        return await collection.find_one({"_id": cache_id})
    except Exception as exc:      # pragma: no cover
        print(f"⚠️ digest cache read failed: {type(exc).__name__}")
        return None


async def _store(cache_id: str, digest: dict[str, Any]) -> None:
    collection = _get_collection_named(COLLECTION)
    if collection is None:
        return
    try:
        await collection.update_one(
            {"_id": cache_id}, {"$set": {"_id": cache_id, **digest}}, upsert=True)
    except Exception as exc:      # pragma: no cover
        print(f"⚠️ digest cache write failed: {type(exc).__name__}")


async def _gather_facts(group_id: str, language: str) -> dict[str, Any]:
    """The aggregates a bullet may be written about. Counts only."""
    from app.services import group_analytics, insights, moments

    snapshot = await insights.group_insights(group_id, language)
    engagement = await group_analytics.engagement(group_id)
    gaps = await group_analytics.learning_gaps(group_id)
    feed = await moments.moments_for_group(group_id, language=language, days=7, limit=40)

    kinds: dict[str, int] = {}
    for row in feed:
        kinds[row["kind"]] = kinds.get(row["kind"], 0) + 1

    trends = snapshot.get("trends") or {}
    return {
        "students_total": trends.get("students_total"),
        "active_last_7d": trends.get("active_last_7d"),
        "needing_attention": trends.get("needing_attention"),
        "objectives_mastered_total": trends.get("objectives_mastered_total"),
        "active_pct": engagement.get("active_pct"),
        "avg_active_minutes": engagement.get("avg_active_minutes"),
        "timing_available": engagement.get("timing_available"),
        "gaps": [
            {"label": gap.get("label"), "struggling_count": gap.get("struggling_count"),
             "with_evidence": gap.get("with_evidence"), "kind": gap.get("kind")}
            for gap in gaps[:4]
        ],
        "moment_counts": kinds,
    }


def _fallback(facts: dict[str, Any], language: str) -> list[dict[str, Any]]:
    """A real digest with no LLM: locale keys over the same numbers.

    Not a placeholder — these are the three things a teacher most needs on a
    Sunday, stated from the aggregates directly.
    """
    bullets: list[dict[str, Any]] = []

    active, total = facts.get("active_last_7d"), facts.get("students_total")
    if total:
        bullets.append({
            "text_key": "tch.digest.fallback.engagement",
            "params": {"active": active or 0, "total": total},
            "because": {"signal": "active_last_7d", "value": active,
                        "raw": {"active_last_7d": active, "students_total": total}},
        })

    gaps = facts.get("gaps") or []
    if gaps:
        gap = gaps[0]
        bullets.append({
            "text_key": "tch.digest.fallback.gap",
            "params": {"label": gap.get("label") or "",
                       "count": gap.get("struggling_count") or 0},
            "because": {"signal": "learning_gap", "value": gap.get("struggling_count"),
                        "raw": gap},
        })

    attention = facts.get("needing_attention")
    if attention is not None:
        bullets.append({
            "text_key": "tch.digest.fallback.attention",
            "params": {"count": attention},
            "because": {"signal": "needing_attention", "value": attention,
                        "raw": {"needing_attention": attention}},
        })

    return bullets[:MAX_BULLETS]


_SYSTEM = {
    "he": "אתה כותב תקציר שבועי קצר למורה על קבוצת לימוד.",
    "ar": "أنت تكتب ملخصًا أسبوعيًا قصيرًا للمعلّم عن مجموعة تعليمية.",
    "en": "You write a short weekly brief for a teacher about one learning group.",
}


def _instruction(language: str, facts: dict[str, Any]) -> str:
    return f"""{_SYSTEM.get(language, _SYSTEM['he'])}

Here are the only facts you may use, as JSON:
{json.dumps(facts, ensure_ascii=False, default=str)}

Write exactly {MAX_BULLETS} bullets about WHAT CHANGED this week, in the teacher's \
language ({language}). Rules:
- Address the teacher directly, or write impersonally about the class. Never refer to \
the teacher in the third person ("he should", "she has") — you are writing TO them.
- Every bullet must be about a number that appears above. Do not invent any figure, \
and do not compute new ones (no percentages the facts do not already contain).
- Never compare or rank individual students. Speak in counts about the group.
- If a fact is missing or null, do not write about it. Fewer honest bullets beat \
three padded ones.
- Keep each bullet to one sentence a teacher can act on.

Return JSON: {{"bullets": [{{"text": "...", "because": {{"signal": "<the fact key you \
used>", "value": <the number>}}}}]}}"""


async def get_digest(
    group_id: str, *, language: str = "he", force: bool = False,
) -> dict[str, Any]:
    """This week's brief for a group — cached, grounded, and honest when empty."""
    from app.services.ai_usage import UsageContext
    from app.services.llm import call_llm

    week = week_key()
    cache_id = _cache_id(group_id, week, language)

    if not force:
        cached = await _load(cache_id)
        if cached:
            return {"week": week, "bullets": cached.get("bullets") or [],
                    "generated_at": cached.get("generated_at"),
                    "source": cached.get("source") or "cache", "cached": True}

    facts = await _gather_facts(group_id, language)
    if not facts.get("students_total"):
        return {"week": week, "bullets": [], "generated_at": None,
                "source": "empty", "cached": False,
                "reason": "group_has_no_students"}

    bullets: list[dict[str, Any]] = []
    source = "fallback"

    usage_context = UsageContext(
        actor_id=group_id, actor_type="teacher",
        endpoint="/api/teacher/groups/{id}/digest",
        feature="feature_6_teacher_view", operation="teacher.weekly_digest",
        source="weekly_digest",
    )
    raw = await call_llm(
        [{"role": "user", "content": _instruction(language, facts)}],
        usage_context=usage_context, max_tokens=600, json_mode=True, model_tier="mini",
    )
    if raw:
        try:
            parsed = json.loads(raw)
            for item in (parsed.get("bullets") or [])[:MAX_BULLETS]:
                text = str(item.get("text") or "").strip()
                because = item.get("because") or {}
                # A bullet with no cited signal is exactly the unfalsifiable
                # narration this panel exists to avoid — drop it.
                if text and because.get("signal"):
                    bullets.append({
                        "text": text,
                        "because": {"signal": because.get("signal"),
                                    "value": because.get("value"),
                                    "raw": {because.get("signal"): because.get("value")}},
                    })
            if bullets:
                source = "ai"
        except (TypeError, ValueError):
            bullets = []

    if not bullets:
        bullets = _fallback(facts, language)

    digest = {"bullets": bullets, "generated_at": _now(), "source": source,
              "week": week, "group_id": group_id, "language": language}
    await _store(cache_id, digest)
    return {**digest, "cached": False}


async def ensure_indexes() -> None:
    """The cache is read by `_id` (already indexed), so this exists for pruning.

    One document per group per week per language: a school year is a few hundred
    rows, which is why there is no TTL here — but an index on `week` means the
    eventual "drop everything before term N" is a range scan rather than a walk
    of the whole collection.
    """
    handle = _get_collection_named(COLLECTION)
    if handle is None:
        return
    try:
        await handle.create_index([("week", 1)])
    except Exception as exc:          # pragma: no cover - best effort
        print(f"⚠️ group_digests index failed: {type(exc).__name__}")
