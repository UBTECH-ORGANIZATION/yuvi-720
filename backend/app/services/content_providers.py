"""Content-provider registry — one catalog, two sources.

720 content reaches the learner from Kata (CET) for math + science and from our
own authored catalog for English. Both speak the same normalized shape, so this
module is the single place that decides WHICH adapter answers for a given piece
of content; everything downstream keeps treating the catalog as one thing.

Resolution order is local-first: the authored catalog is an in-process lookup,
while Kata is a network call that also fails when no API key is configured.
"""

from __future__ import annotations

from typing import Any, Optional

from app.services import kata_client, native_content

PROVIDERS: dict[str, Any] = {
    "kata": kata_client,
    native_content.SOURCE: native_content,
}


def provider_for(source: Optional[str]) -> Any:
    return PROVIDERS.get(str(source or "kata"), kata_client)


def is_native(unit_or_component: dict[str, Any]) -> bool:
    return (unit_or_component or {}).get("source") == native_content.SOURCE


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
