"""Matching a teacher's free-text description to learning GOALS.

The pin dialog lets a teacher SAY what they want ("תרגול חיבור שברים עם
מכנים שונים") instead of scanning the whole shelf. The model reads the
group's actual catalog — never anything outside it — and hands back up to
three ranked OBJECTIVES (learning goals) with a one-line reason each. Goals,
not single components: the pin names the destination, and the planner keeps
allocating the fitting component inside it as the child progresses.

The search runs over the WHOLE catalog, every subject at once — a teacher
typing a math request while the science shelf is open must still find the
math goal; the answer carries each goal's subject so the dialog can say
where it lives.

When nothing truly fits, the answer is navigation, not a dead end: the model
may name ONE adjacent topic that DOES exist in the catalog, so the dialog can
offer "יש לי לומדה בנושא X — לחפש איתו?". A request unrelated to anything on
the shelf returns nothing at all — inventing a stretch match would send a
child to the wrong goal on a teacher's trust.

Every id the model returns is checked against the catalog before it leaves
this module; a hallucinated id is dropped, silently, because the teacher can
only ever be shown real goals.
"""

from __future__ import annotations

from app.services import learning_analytics

# The model reads the shelf, not the library: a huge catalog is truncated
# rather than shipped whole, and the prompt says so.
_MAX_ROWS = 200
_MAX_OPTIONS = 3
_MAX_UNITS_PER_GOAL = 8

_PROMPT = """You match a teacher's request to learning goals from a fixed catalog.

The teacher teaches a school class and described the learning they want:
REQUEST: {query}

CATALOG (the ONLY valid goals — one per line, "id | goal title | subject | lessons it contains"):
{catalog}

Rules:
- Pick at most {max_options} catalog goals that genuinely match the request, best first.
- Use ONLY ids that appear in the catalog. Never invent an id.
- A match must be about the requested topic — do not stretch. If nothing
  matches, return an empty list.
- The request may belong to any subject in the catalog, regardless of which
  subject the teacher was browsing.
- When the list is empty but the catalog holds something ADJACENT to the
  request (same area, neighbouring topic), set "similar_topic" to that topic's
  short name (a few words, in the same language as the catalog titles) so the
  teacher can be pointed there. If the request is unrelated to everything in
  the catalog, set it to null.
- "reason" is one short sentence in {language_name}, telling the teacher why
  this goal fits their request.

Answer with JSON only:
{{"options": [{{"objective_id": "...", "reason": "..."}}], "similar_topic": null}}"""

_LANGUAGE_NAMES = {"he": "Hebrew", "ar": "Arabic", "en": "English"}


def _goals_of(rows: list[dict]) -> list[dict]:
    """The catalog rows folded into unique goals, in catalog order.

    A goal's display title falls back exactly like the dialog's: the
    objective's own name, else its unit's, else nothing better than the id —
    so the model and the teacher read the same words.
    """
    goals: dict[str, dict] = {}
    for row in rows:
        objective_id = str(row.get("objective_id") or "")
        if not objective_id:
            continue
        named = (
            row.get("objective_title")
            if row.get("objective_title") and row.get("objective_title") != objective_id
            else None
        )
        goal = goals.setdefault(objective_id, {
            "objective_id": objective_id,
            "title": named or row.get("unit_title") or objective_id,
            "subject": row.get("subject"),
            "lessons": [],
        })
        title = row.get("title")
        if title and title not in goal["lessons"]:
            goal["lessons"].append(str(title))
    return list(goals.values())


def _catalog_lines(goals: list[dict]) -> str:
    lines = []
    for goal in goals[:_MAX_ROWS]:
        lessons = "; ".join(goal["lessons"][:_MAX_UNITS_PER_GOAL])
        lines.append(" | ".join(str(part or "") for part in (
            goal["objective_id"], goal["title"], goal["subject"], lessons)))
    if len(goals) > _MAX_ROWS:
        lines.append(f"(+{len(goals) - _MAX_ROWS} more goals not listed)")
    return "\n".join(lines)


async def find_learnings(
    group_id: str,
    *,
    query: str,
    subject: str | None = None,
    language: str = "he",
    teacher_id: str,
) -> dict:
    """Up to three ranked goal matches for the teacher's description.

    Returns ``{"options": [{objective_id, title, subject, reason}],
    "similar_topic"}``. ``similar_topic`` is only ever set when ``options``
    is empty — a navigation hint has no place next to actual answers. The
    ``subject`` parameter survives for older callers but the search itself is
    catalog-wide by design.
    """
    del subject  # catalog-wide on purpose — see the module docstring
    view = await learning_analytics.group_learnings(group_id, language=language)
    goals = _goals_of(view.get("learnings") or [])
    if not goals:
        return {"options": [], "similar_topic": None}

    from app.services.ai_usage import UsageContext
    from app.services.llm import call_llm
    from app.services.tasks.spec import loads_model_json

    prompt = _PROMPT.format(
        query=query,
        catalog=_catalog_lines(goals),
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

    by_id = {goal["objective_id"]: goal for goal in goals}
    options: list[dict] = []
    for item in data.get("options") or []:
        if not isinstance(item, dict):
            continue
        objective_id = str(item.get("objective_id") or "")
        goal = by_id.get(objective_id)
        if goal is None or any(o["objective_id"] == objective_id for o in options):
            continue  # hallucinated or repeated — never shown
        options.append({
            "objective_id": objective_id,
            "title": goal["title"],
            "subject": goal["subject"],
            "reason": str(item.get("reason") or "").strip()[:240],
        })
        if len(options) >= _MAX_OPTIONS:
            break

    similar = data.get("similar_topic")
    similar_topic = (
        str(similar).strip()[:80] if similar and not options else None
    ) or None
    return {"options": options, "similar_topic": similar_topic}
