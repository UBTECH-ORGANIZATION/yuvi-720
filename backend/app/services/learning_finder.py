"""Matching a teacher's free-text description to catalog learnings.

The pin dialog lets a teacher SAY what they want ("תרגול חיבור שברים עם
מכנים שונים") instead of scanning the whole shelf. The model reads the
group's actual catalog — never anything outside it — and hands back up to
three ranked component ids with a one-line reason each.

When nothing truly fits, the answer is navigation, not a dead end: the model
may name ONE adjacent topic that DOES exist in the catalog, so the dialog can
offer "יש לי למידה בנושא X — לחפש איתו?". A request unrelated to anything on
the shelf returns nothing at all — inventing a stretch match would send a
child to the wrong lesson on a teacher's trust.

Every id the model returns is checked against the catalog before it leaves
this module; a hallucinated id is dropped, silently, because the teacher can
only ever be shown real learnings.
"""

from __future__ import annotations

from app.services import learning_analytics

# The model reads the shelf, not the library: a huge catalog is truncated
# rather than shipped whole, and the prompt says so.
_MAX_ROWS = 300
_MAX_OPTIONS = 3

_PROMPT = """You match a teacher's request to lessons from a fixed catalog.

The teacher teaches a school class and described the lesson they want:
REQUEST: {query}

CATALOG (the ONLY valid lessons — one per line, "id | title | unit | objective | subject"):
{catalog}

Rules:
- Pick at most {max_options} catalog lessons that genuinely match the request, best first.
- Use ONLY ids that appear in the catalog. Never invent an id.
- A match must be about the requested topic — do not stretch. If nothing
  matches, return an empty list.
- When the list is empty but the catalog holds something ADJACENT to the
  request (same area, neighbouring topic), set "similar_topic" to that topic's
  short name (a few words, in the same language as the catalog titles) so the
  teacher can be pointed there. If the request is unrelated to everything in
  the catalog, set it to null.
- "reason" is one short sentence in {language_name}, telling the teacher why
  this lesson fits their request.

Answer with JSON only:
{{"options": [{{"component_id": "...", "reason": "..."}}], "similar_topic": null}}"""

_LANGUAGE_NAMES = {"he": "Hebrew", "ar": "Arabic", "en": "English"}


def _catalog_lines(rows: list[dict]) -> str:
    lines = []
    for row in rows[:_MAX_ROWS]:
        lines.append(" | ".join(str(part or "") for part in (
            row.get("component_id"), row.get("title"), row.get("unit_title"),
            row.get("objective_title"), row.get("subject"))))
    if len(rows) > _MAX_ROWS:
        lines.append(f"(+{len(rows) - _MAX_ROWS} more lessons not listed)")
    return "\n".join(lines)


async def find_learnings(
    group_id: str,
    *,
    query: str,
    subject: str | None = None,
    language: str = "he",
    teacher_id: str,
) -> dict:
    """Up to three ranked catalog matches for the teacher's description.

    Returns ``{"options": [{component_id, title, reason}], "similar_topic"}``.
    ``similar_topic`` is only ever set when ``options`` is empty — a
    navigation hint has no place next to actual answers.
    """
    view = await learning_analytics.group_learnings(
        group_id, subject=subject, language=language)
    rows = [row for row in (view.get("learnings") or []) if row.get("component_id")]
    if not rows:
        return {"options": [], "similar_topic": None}

    from app.services.ai_usage import UsageContext
    from app.services.llm import call_llm
    from app.services.tasks.spec import loads_model_json

    prompt = _PROMPT.format(
        query=query,
        catalog=_catalog_lines(rows),
        max_options=_MAX_OPTIONS,
        language_name=_LANGUAGE_NAMES.get(language, "Hebrew"),
    )
    raw = await call_llm(
        [{"role": "user", "content": prompt}],
        usage_context=UsageContext(
            actor_id=teacher_id,
            actor_type="teacher",
            endpoint="/api/teacher/groups/learnings/find",
            feature="teacher_learning_finder",
            operation="teacher.learning_finder",
            source="focus_panel",
            request_id=group_id,
        ),
        max_tokens=500,
        json_mode=True,
        model_tier="mini",
    )
    data = loads_model_json(raw or "") or {}

    by_id = {str(row["component_id"]): row for row in rows}
    options: list[dict] = []
    for item in data.get("options") or []:
        if not isinstance(item, dict):
            continue
        component_id = str(item.get("component_id") or "")
        row = by_id.get(component_id)
        if row is None or any(o["component_id"] == component_id for o in options):
            continue  # hallucinated or repeated — never shown
        options.append({
            "component_id": component_id,
            "title": str(row.get("title") or component_id),
            "reason": str(item.get("reason") or "").strip()[:240],
        })
        if len(options) >= _MAX_OPTIONS:
            break

    similar = data.get("similar_topic")
    similar_topic = (
        str(similar).strip()[:80] if similar and not options else None
    ) or None
    return {"options": options, "similar_topic": similar_topic}
