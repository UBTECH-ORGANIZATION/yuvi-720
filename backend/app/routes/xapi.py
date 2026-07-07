"""xAPI LRS + `slxapi` launch routes (P1, §8.2).

Thin transport: mint a launch context, and accept xAPI statements from content
(iframe) over HTTP. All validation/normalization/idempotency/brain-update lives
in `app.services.events`.
"""

from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app.services.events import ingest_statement, mint_launch, verify_launch
from learner_state import normalize_learner_id  # type: ignore


router = APIRouter(prefix="/api/xapi", tags=["xapi"])


@router.post("/launch")
async def create_launch(data: dict):
    """Mint an `slxapi` launch context for a learner + (optional) objective/component."""
    learner_id = normalize_learner_id(data.get("learner_id"))
    return JSONResponse(
        content=mint_launch(
            learner_id,
            objective_id=data.get("objective_id"),
            component_id=data.get("component_id"),
            unit_id=data.get("unit_id"),
            subject=data.get("subject"),
        )
    )


@router.post("/{launch}/statements")
async def post_statements(launch: str, request: Request):
    """LRS endpoint: accept one statement or an array (content appends `statements`).

    The per-launch token authenticates + scopes the report to one learner+session.
    Duplicates (mandated retry policy) are acked without double-counting (R14).
    """
    payload = verify_launch(launch)
    if payload is None:
        return JSONResponse(content={"error": "invalid_or_expired_launch"}, status_code=401)

    try:
        body: Any = await request.json()
    except Exception:
        return JSONResponse(content={"error": "invalid_json"}, status_code=400)

    statements = body if isinstance(body, list) else [body]
    results = []
    for statement in statements:
        if isinstance(statement, dict):
            results.append(await ingest_statement(statement, payload))
    return JSONResponse(content={"results": results})
