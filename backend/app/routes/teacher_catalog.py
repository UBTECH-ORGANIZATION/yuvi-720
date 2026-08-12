"""What an objective actually is — the catalogue, read out loud.

Every teacher screen in this app names objectives: the attention inbox says a
child failed three times "on the same objective", the moments feed says they
broke through on one, the learnings list groups material under them. None of
those could say *what the objective is*, so the noun did no work — a teacher
reading "three consecutive failures on the same objective" had to already know
which one, and what it asks a child to be able to do.

The catalogue has known this the whole time. `kata_catalog` holds the ministry's
own goal registry: a title, a written description, the sub-topic and topic it
sits under, the curriculum it belongs to, its prerequisites, and every lesson
that teaches it. This hands that over.

**Read-only, and scoped by role rather than by group.** The curriculum is not
per-class data — two teachers looking up the same objective are entitled to the
same answer, and there is no learner id anywhere in this payload. The session
gate is here because the catalogue is not public, not because one teacher's view
of an objective differs from another's.
"""

from typing import Any, Optional

from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse

from app.auth.dependencies import require_teacher_session
from app.services import kata_catalog

router = APIRouter(prefix="/api/teacher", tags=["teacher"])

#: A page asking about more than this is not asking a question, it is scraping.
MAX_IDS = 40

#: The catalogue changes on a deploy, not on a lesson. Cached privately so a
#: teacher scrolling the moments feed does not re-fetch the same goal per row.
_CACHE = {"Cache-Control": "private, max-age=300"}


def _localized(entry: dict[str, Any], field: str, locale: str) -> str:
    """The `he`/`en`/`ar` variant when the registry shipped one, else the
    vendor's own string — never an empty box where a sentence belongs."""
    plural = f"{field}s"
    table = entry.get(plural)
    if isinstance(table, dict):
        value = str(table.get(locale) or "").strip()
        if value:
            return value
    return str(entry.get(field) or "").strip()


def describe(objective_id: str, locale: str = "he") -> Optional[dict[str, Any]]:
    """Everything the catalogue knows about one objective, in one shape.

    `None` when the id is not in the snapshot — a stale id from an old event is
    an ordinary case here, and the caller renders nothing rather than an error.
    """
    entry = kata_catalog.get_objective(objective_id)
    if not entry:
        return None

    lessons = [
        {
            "component_id": component.get("id"),
            "title": kata_catalog.component_title(component.get("id"), locale)
            or component.get("title"),
            "media_format": component.get("media_format"),
            "unit_id": component.get("unit_id"),
        }
        for component in kata_catalog.components_for(objective_id)
    ]

    # Prerequisites by name. The ids are what the spine stores and exactly what
    # a teacher cannot read; one that is not itself in the catalogue is dropped
    # rather than shown as a dotted key.
    prerequisites = []
    for prereq_id in entry.get("prerequisites") or []:
        title = kata_catalog.objective_title(prereq_id, locale)
        if title:
            prerequisites.append({"id": prereq_id, "title": title})

    return {
        "id": objective_id,
        "title": kata_catalog.objective_title(objective_id, locale) or objective_id,
        "subject": entry.get("subject"),
        "description": _localized(entry, "description", locale),
        "topic_title": entry.get("topic_title") or "",
        "curriculum_title": entry.get("curriculum_title") or "",
        "order": entry.get("order"),
        "prerequisites": prerequisites,
        "lessons": lessons,
    }


@router.get("/objectives")
async def objectives(
    ids: str = Query(default="", description="Comma-separated objective ids"),
    lang: str = "he",
    _session: dict = Depends(require_teacher_session),
) -> JSONResponse:
    """Describe up to `MAX_IDS` objectives at once.

    Batched because the surfaces that need this are lists: an attention inbox
    naming eight objectives should cost one request, not eight.
    """
    await kata_catalog.ensure_loaded()
    wanted = [part.strip() for part in ids.split(",") if part.strip()][:MAX_IDS]
    described = [row for oid in wanted if (row := describe(oid, lang))]
    # Ids the catalogue does not know are reported rather than silently missing:
    # the client caches misses too, or it re-asks for them on every render.
    found = {row["id"] for row in described}
    return JSONResponse(
        content={"objectives": described, "unknown": [oid for oid in wanted if oid not in found]},
        headers=_CACHE,
    )
