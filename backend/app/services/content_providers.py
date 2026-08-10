"""Content-provider registry — one catalog, two sources.

720 content reaches the learner from Kata (CET) for math + science and from our
own authored catalog for English. Both speak the same normalized shape, so this
module is the single place that decides WHICH adapter answers for a given piece
of content; everything downstream keeps treating the catalog as one thing.

Resolution order is local-first: the authored catalog is an in-process lookup,
while Kata is a network call that also fails when no API key is configured.
"""

from __future__ import annotations

import logging
from typing import Any, Optional

from app.services import kata_client, native_content

logger = logging.getLogger(__name__)

PROVIDERS: dict[str, Any] = {
    "kata": kata_client,
    native_content.SOURCE: native_content,
}

# So callers can keep a single `except content_provider.ContentProviderError`.
ContentProviderError = kata_client.ContentProviderError


def provider_for(source: Optional[str]) -> Any:
    return PROVIDERS.get(str(source or "kata"), kata_client)


def is_native(unit_or_component: dict[str, Any]) -> bool:
    return (unit_or_component or {}).get("source") == native_content.SOURCE


async def list_units(
    language: Optional[str] = None,
    **filters: Any,
) -> list[dict[str, Any]]:
    """Every unit the learner may open, from both sources, in one list.

    A Kata outage (or a missing API key on a local machine) must not take the
    English catalog down with it: we author that content ourselves and serve it
    from disk, so it stays available. The reverse is also true — the ministry's
    math and science keep working while the authored catalog is empty.
    """
    native_units: list[dict[str, Any]] = []
    try:
        native_units = await native_content.list_units(language=language, **filters)
    except native_content.ContentProviderError:
        logger.exception("authored catalog unavailable")

    try:
        kata_units = await kata_client.list_units(language=language, **filters)
    except kata_client.ContentProviderError:
        if not native_units:
            raise
        logger.warning("kata catalog unavailable; serving the authored catalog only")
        kata_units = []

    return [*kata_units, *native_units]


async def get_unit(unit_id: str, language: Optional[str] = None) -> dict[str, Any]:
    """Resolve a unit against whichever provider owns it (local first)."""
    try:
        return await native_content.get_unit(unit_id, language)
    except native_content.ContentProviderError:
        pass
    return await kata_client.get_unit(unit_id, language)


async def resolve_component(
    component_id: str,
    unit_id: Optional[str] = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Resolve a component against whichever provider owns it."""
    try:
        return await native_content.resolve_component(component_id, unit_id)
    except native_content.ContentProviderError:
        pass
    return await kata_client.resolve_component(component_id, unit_id)
