"""xAPI LRS + `slxapi` launch routes (P1, §8.2).

Thin transport: mint a launch context, and accept xAPI statements from content
(iframe) over HTTP. All validation/normalization/idempotency/brain-update lives
in `app.services.events`.
"""

from typing import Any, Optional

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from app.services.events import ingest_statement, mint_launch, verify_launch
from learner_state import normalize_learner_id  # type: ignore


router = APIRouter(prefix="/api/xapi", tags=["xapi"])


class LaunchRequest(BaseModel):
    learner_id: str = Field(default="demo-learner", max_length=120)
    objective_id: Optional[str] = Field(default=None, max_length=180)
    component_id: Optional[str] = Field(default=None, max_length=180)
    unit_id: Optional[str] = Field(default=None, max_length=180)
    subject: Optional[str] = Field(default=None, max_length=80)
    is_assessment: bool = False


@router.post("/launch")
async def create_launch(data: LaunchRequest):
    """Mint an `slxapi` launch context for a learner + (optional) objective/component."""
    learner_id = normalize_learner_id(data.learner_id)
    return JSONResponse(
        content=mint_launch(
            learner_id,
            objective_id=data.objective_id,
            component_id=data.component_id,
            unit_id=data.unit_id,
            subject=data.subject,
            is_assessment=data.is_assessment,
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
    if request.headers.get("authorization") != f"Basic {launch}":
        return JSONResponse(content={"error": "invalid_launch_authorization"}, status_code=401)

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
