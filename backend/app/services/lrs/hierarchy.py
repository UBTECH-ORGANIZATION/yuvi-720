"""Content statements carry their whole ancestry — object, parent, grouping, and
every level's metadata (MoE integration review, 28/07).

The rule the ministry stated, verbatim in shape:

    learning-unit → object = unit;      grouping = [unit];
                    extensions = unit metadata
    component     → object = component; parent = [unit];
                    grouping = [unit, component];
                    extensions = unit + component metadata
    item          → object = item;      parent = [component];
                    grouping = [unit, component, item];
                    extensions = unit + component + item metadata

"The lower the object sits in the hierarchy, the more levels above it you send —
with all of their extensions." Our content events used to carry the object and
nothing above it, so the LRS could not place a question inside its component or
its unit without joining on ids it does not have.

Metadata comes from the Kata catalog snapshot (already loaded for the coach), so
nothing here is invented: a field we do not have is a field we do not send.
"""

from __future__ import annotations

from typing import Any, Optional

from app.services.lrs import config
from app.services.lrs.context import MEDIA_ACTIVITY_TYPES, activity


def _iri(kind: str, identifier: str) -> str:
    return f"{config.supplier_domain()}/{kind}/{identifier}"


def unit_activity(unit_id: str, name_he: Optional[str] = None) -> dict[str, Any]:
    return activity(_iri("learning-unit", unit_id), "learning-unit", name_he)


def component_activity(component_id: str, name_he: Optional[str] = None) -> dict[str, Any]:
    return activity(_iri("component", component_id), "component", name_he)


def item_activity(
    item_id: str, name_he: Optional[str] = None, media_format: Optional[str] = None
) -> dict[str, Any]:
    """The Activity type of an item FOLLOWS ITS MEDIA where it has one — the
    spec's own item example types a video item `activities/video`. Anything
    outside the published media dictionary stays `item`."""
    return activity(_iri("item", item_id), MEDIA_ACTIVITY_TYPES.get(
        str(media_format or "").lower(), "item"
    ), name_he)


# ── Catalog → 720 metadata extensions (short keys; `extensions()` adds the IRI) ─
def unit_metadata(unit: Optional[dict[str, Any]]) -> dict[str, Any]:
    if not unit:
        return {}
    return _clean({
        "learningUnitId": unit.get("id"),
        "learningUnitTitle": unit.get("title"),
        "subTopic": unit.get("sub_topic"),
        "learningObjective": unit.get("objective_id"),
        "subject": unit.get("subject"),
        "prerequisiteLearningObjective": unit.get("prerequisites") or [],
        # Who the unit was authored FOR — both are in the spec's unit table and
        # both are already normalized off the catalog, they were simply never
        # mapped through to the statement.
        "targetSector": unit.get("target_sector") or None,
        "targetAudience": unit.get("target_audience") or None,
    })


def component_metadata(component: Optional[dict[str, Any]]) -> dict[str, Any]:
    if not component:
        return {}
    return _clean({
        "componentId": component.get("id"),
        "componentTitle": component.get("title"),
        "componentPurpose": component.get("purpose"),
        "isAssessment": component.get("is_assessment"),
        "isRequired": component.get("is_required"),
        "relativeDifficulty": component.get("relative_difficulty"),
        "masteryLevel": component.get("mastery_level"),
        "order": component.get("order"),
        "depthLevel": component.get("depth_level"),
        "cognitiveLevel": component.get("cognitive_level"),
        "estimatedTimeInMinutes": component.get("estimated_minutes"),
        "languages": component.get("languages") or None,
        # `mediaFormat` belongs to the ITEM in the 720 metadata table; emitting a
        # component-level one too would collide with it inside a single
        # extensions map and the item's — the specific one — would be the one
        # lost, on exactly the media events that need it.
        "recommendedAfterFail": component.get("recommended_after_fail") or [],
        # The last two rows of the spec's component table: the מיומנויות the
        # component exercises, and the provider it came from (provenance in a
        # multi-provider catalog).
        "skills": component.get("skills") or [],
        "manufacture": component.get("manufacture"),
    })


def _question_digest(rows: Optional[list[dict[str, Any]]]) -> Optional[list[dict[str, Any]]]:
    """The spec's item-level `questions` array — what is asked, not what the
    answer is.

    The catalog rows carry `correctAnswers` so the coach can guide without
    revealing them; forwarding that into a statement would publish the answer
    key of every screen the learner touches. Identity and type are what makes an
    event analysable, so those go and the answers stay home.
    """
    if not rows:
        return None
    digest = [
        _clean({
            "questionId": row.get("questionId"),
            "questionType": row.get("questionType"),
            "questionText": str(row.get("questionText") or "")[:300] or None,
        })
        for row in rows[:12]
        if isinstance(row, dict)
    ]
    return [row for row in digest if row] or None


def item_metadata(
    item: Optional[dict[str, Any]], component: Optional[dict[str, Any]] = None
) -> dict[str, Any]:
    """`item` is one row of the component's item spine (`kata_catalog.item_profiles`).

    `component` supplies the three item fields that Kata keeps on the component's
    `subContent` rather than on the spine — `informationToBot`, `questions` and
    the owning `componentId` — all three named in the spec's item table.
    """
    if not item:
        return {}
    item_id = item.get("id")
    return _clean({
        "itemId": item_id,
        "itemTitle": item.get("title"),
        "contentType": item.get("content_type"),
        "mediaFormat": item.get("media_format"),
        "componentId": (component or {}).get("id"),
        "informationToBot": ((component or {}).get("information_by_item") or {}).get(item_id),
        "questions": _question_digest(
            ((component or {}).get("questions_by_item") or {}).get(item_id)
        ),
    })


# Spec-listed list fields that are reported even when the content has none.
# An absent key reads as "not implemented" — which is exactly what the 28/07
# review wrote against fields we do map — whereas `[]` says "reported, and this
# content has none". Everything else is still dropped when empty.
_ALWAYS_REPORTED: tuple[str, ...] = (
    "prerequisiteLearningObjective",
    "recommendedAfterFail",
    "skills",
)


def _clean(values: dict[str, Any]) -> dict[str, Any]:
    return {
        k: v
        for k, v in values.items()
        if v not in (None, "", [], {}) or (k in _ALWAYS_REPORTED and v == [])
    }


class ContentHierarchy(dict):
    """`{parent, grouping, extensions}` for one content statement."""


def build(
    *,
    unit: Optional[dict[str, Any]] = None,
    component: Optional[dict[str, Any]] = None,
    item: Optional[dict[str, Any]] = None,
    level: str = "item",
) -> ContentHierarchy:
    """Ancestry for a statement whose object sits at `level`.

    `unit` / `component` are normalized Kata catalog objects; `item` is an item
    spine row. Levels at or below the object are still listed in `grouping` (the
    object belongs to its own grouping per the ministry's examples); `parent` is
    the single level directly above.
    """
    unit_id = (unit or {}).get("id")
    component_id = (component or {}).get("id")
    item_id = (item or {}).get("id")

    grouping: list[dict[str, Any]] = []
    if unit_id:
        grouping.append(unit_activity(unit_id, (unit or {}).get("title")))
    if component_id and level in {"component", "item"}:
        grouping.append(component_activity(component_id, (component or {}).get("title")))
    if item_id and level == "item":
        grouping.append(item_activity(
            item_id, (item or {}).get("title"), (item or {}).get("media_format")
        ))

    parent: list[dict[str, Any]] = []
    if level == "item" and component_id:
        parent = [component_activity(component_id, (component or {}).get("title"))]
    elif level == "component" and unit_id:
        parent = [unit_activity(unit_id, (unit or {}).get("title"))]

    extensions: dict[str, Any] = {}
    extensions.update(unit_metadata(unit))
    if level in {"component", "item"}:
        extensions.update(component_metadata(component))
    if level == "item":
        extensions.update(item_metadata(item, component))

    return ContentHierarchy(parent=parent, grouping=grouping, extensions=extensions)


async def ecat_item_for(
    component_id: Optional[str],
    item_id: Optional[str] = None,
    *,
    unit_id: Optional[str] = None,
) -> Optional[str]:
    """The `grouping→content-vendor` catalog id for this piece of content.

    "ספק התוכן יזוהה באמצעות מזהה הפריט בקטלוג החינוכי" — the id identifies the
    CONTENT ITEM, so it is resolved per event, not once per deployment. The
    catalog is asked first (a provider that publishes its ECAT id is the source
    of truth), then the configured map.

    The integration report reviewed 13/08 rejected the SUPPLIER placeholder
    ("methodica"/"10") this used to fall back to when no real catalog id was
    registered — it wants an actual catalog item id, not a stand-in for the
    vendor name. `config.content_vendor_id()` answered "who made this", never
    "what item is this in the ministry's catalog", so it is no longer consulted
    here: a field we do not have (Kata publishes no ECAT id today) is a field we
    do not send, same as everywhere else in this module.
    """
    published: Optional[str] = None
    try:
        from app.services import kata_catalog

        await kata_catalog.ensure_loaded()
        component = kata_catalog.get_component(component_id) if component_id else None
        resolved_unit_id = unit_id or (component or {}).get("unit_id")
        unit = kata_catalog.get_unit(resolved_unit_id) if resolved_unit_id else None
        published = (component or {}).get("ecat_item_id") or (unit or {}).get("ecat_item_id")
        unit_id = resolved_unit_id or unit_id
    except Exception:  # the catalog is an optimization here, never a gate
        published = None
    configured = config.ecat_item_id(
        item_id=item_id, component_id=component_id, unit_id=unit_id
    )
    return published or configured or None


async def for_content(
    component_id: Optional[str],
    item_id: Optional[str] = None,
    *,
    unit_id: Optional[str] = None,
) -> ContentHierarchy:
    """Resolve the ancestry straight from the Kata catalog snapshot.

    Best-effort: an unknown component yields an empty hierarchy rather than a
    guessed one, so a statement is never enriched with someone else's metadata.
    """
    try:
        from app.services import kata_catalog

        await kata_catalog.ensure_loaded()
        component = kata_catalog.get_component(component_id) if component_id else None
        unit = None
        resolved_unit_id = unit_id or (component or {}).get("unit_id")
        if resolved_unit_id:
            unit = kata_catalog.get_unit(resolved_unit_id)
        item = (
            kata_catalog.item_profile(component_id, item_id)
            if component_id and item_id
            else None
        )
        return build(
            unit=unit,
            component=component,
            item=item or None,
            level="item" if item_id else ("component" if component_id else "unit"),
        )
    except Exception:  # reporting must never break on catalog trouble
        return ContentHierarchy(parent=[], grouping=[], extensions={})
