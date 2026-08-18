"""Every lomda screen, side by side, through the real launch path — dev only.

Reviewing authored content used to mean minting a launch on the command line and
pasting a 900-character URL into a browser, one component at a time. That is slow
enough that screens stop being looked at, which is how a unit ships with a
paragraph that overflows on a tablet.

This serves a page that iframes **every** English component at once, each through
`/content/player/{id}` with a genuine HMAC launch — not a mock, not a fixture. So
what you review is the thing a learner gets: the same payload, the same stripped
answer keys, the same CSP, the same xAPI.

Two deliberate choices:

* **It lives outside `learning-agent/english-player/`.** That whole directory is
  mounted unauthenticated at `/content/player-assets` so an embedding platform
  can fetch the player's own CSS and modules; a gallery placed there would be
  world-readable too.
* **Each frame launches as its own throwaway learner** (`gallery-{component}`),
  so browsing the gallery cannot move a real learner's position, mastery or
  roadmap — and two frames cannot resume into each other's state.

Access is a teacher session, or `ENABLE_PLAYER_GALLERY=1` for local work. Neither
means it is learner-facing: there is no link to it anywhere in the product.
"""

from __future__ import annotations

import os
from typing import Any, Optional

from fastapi import APIRouter, Request
from fastapi.responses import FileResponse, JSONResponse

from app.auth.dependencies import ROLE_ADMIN, ROLE_TEACHER, optional_user
from app.core.paths import LEARNING_AGENT_DIR
from app.services import kata_catalog, native_content
from app.services.events import mint_launch

router = APIRouter(prefix="/content/player-gallery", tags=["content"])

GALLERY_DIR = LEARNING_AGENT_DIR / "player-gallery"

#: Statements from the gallery land under these ids. Anything reading learner
#: analytics should exclude the prefix rather than discover it in a chart.
LEARNER_PREFIX = "gallery-"


def _enabled() -> bool:
    return os.environ.get("ENABLE_PLAYER_GALLERY", "").strip().lower() in {"1", "true", "yes"}


async def _allowed(request: Request) -> bool:
    """A teacher or admin session, or an explicit dev opt-in. Never a learner."""
    if _enabled():
        return True
    session = await optional_user(request)
    roles = set((session or {}).get("roles") or [])
    return bool({ROLE_TEACHER, ROLE_ADMIN} & roles)


def _not_found() -> JSONResponse:
    # 404 rather than 403: an unauthorized caller should not learn the route is
    # real. It is a development surface and does not advertise itself.
    return JSONResponse(content={"error": "not_found"}, status_code=404)


@router.get("")
@router.get("/")
async def gallery_page(request: Request):
    if not await _allowed(request):
        return _not_found()
    index = GALLERY_DIR / "gallery.html"
    if not index.exists():
        return JSONResponse(content={"error": "gallery_missing"}, status_code=404)
    return FileResponse(index, headers={"Cache-Control": "no-store"})


@router.get("/asset/{name}")
async def gallery_asset(name: str, request: Request):
    """The gallery's own CSS/JS. Same gate as the page; no directory traversal."""
    if not await _allowed(request):
        return _not_found()
    if name not in {"gallery.css", "gallery.js"}:
        return _not_found()
    return FileResponse(GALLERY_DIR / name, headers={"Cache-Control": "no-store"})


@router.get("/launches")
async def gallery_launches(request: Request, subject: str = "english", lang: str = "he"):
    """One real launch per component, ready to drop into an iframe."""
    if not await _allowed(request):
        return _not_found()

    await kata_catalog.ensure_loaded()
    units = [u for u in kata_catalog.all_units() if u.get("source") == native_content.SOURCE]
    if subject:
        units = [u for u in units if (u.get("subject") or "") == subject]

    rows: list[dict[str, Any]] = []
    for unit in sorted(units, key=lambda u: str(u.get("id"))):
        for component in sorted(
            unit.get("components") or [], key=lambda c: (c.get("order") or 0, str(c.get("id")))
        ):
            launch_url = await _launch_url(unit, component, lang)
            if not launch_url:
                continue
            rows.append({
                "componentId": component["id"],
                "unitId": unit["id"],
                # Named in the requested language, like the learner-facing
                # chrome — the ids stay in the payload for the dev who needs
                # to know which file a card is.
                "unitTitle": (unit.get("titles") or {}).get(lang)
                or unit.get("title") or unit["id"],
                "title": (component.get("titles") or {}).get(lang)
                or component.get("title") or component["id"],
                "isAssessment": bool(component.get("is_assessment")),
                "kinds": await _kinds(component["id"], unit["id"]),
                "launchUrl": launch_url,
            })
    return JSONResponse(content={"count": len(rows), "items": rows})


async def _launch_url(unit: dict, component: dict, lang: str) -> Optional[str]:
    try:
        launch = mint_launch(
            f"{LEARNER_PREFIX}{component['id']}",
            objective_id=unit.get("objective_id"),
            component_id=component["id"],
            unit_id=unit["id"],
            subject=unit.get("subject"),
            is_assessment=component.get("is_assessment"),
            source=native_content.SOURCE,
        )
        context = await native_content.create_launch_context(
            component_id=component["id"],
            student_id=launch["slxapi"]["actor"]["account"]["name"],
            platform_url="",
            lrs_endpoint=launch["slxapi"]["endpoint"],
            lrs_auth=launch["slxapi"]["auth"],
            slxapi=launch["slxapi"],
        )
    except Exception:  # noqa: BLE001 - one bad component must not empty the gallery
        return None
    return f"{context['launch_url']}&lang={lang}"


async def _kinds(component_id: str, unit_id: str) -> list[str]:
    """The presentation kinds on this component, for filtering the grid."""
    resolved = await native_content.get_raw_component(component_id, unit_id)
    if not resolved:
        return []
    _unit, raw = resolved
    seen: list[str] = []
    for item in raw.get("subContent") or []:
        kind = ((item.get("presentation") or {}).get("kind")) or "none"
        if kind not in seen:
            seen.append(kind)
    return seen
