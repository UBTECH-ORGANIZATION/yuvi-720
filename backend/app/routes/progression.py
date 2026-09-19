"""Learner XP progression routes. Award mutations remain service-internal."""

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from app.auth.dependencies import require_learner
from app.core.env import is_production
from app.services import progression

router = APIRouter(prefix="/api/progression", tags=["progression"])


class HintTokenUseRequest(BaseModel):
    component_id: str = Field(alias="componentId", min_length=1, max_length=180)
    question_id: str = Field(alias="questionId", min_length=1, max_length=180)


@router.get("/status")
async def read_status(learner_id: str = Depends(require_learner)):
    """Return the authenticated learner's personal XP progress."""
    return JSONResponse(content=await progression.get_status(learner_id))


@router.get("/ledger")
async def read_ledger(
    limit: int = Query(default=20, ge=1, le=100),
    learner_id: str = Depends(require_learner),
):
    """Return recent evidence-backed XP reasons, newest first."""
    from app.services.progression.rewards import public_reward_for_level

    entries = await progression.list_ledger(learner_id, limit)
    receipts = [
        {
            **entry,
            "levelRewards": [
                public_reward_for_level(level)
                for level in range(entry["levelBefore"] + 1, entry["levelAfter"] + 1)
            ],
        }
        for entry in entries
    ]
    return JSONResponse(content={
        "entries": receipts,
        "progression": await progression.get_status(learner_id),
    })


@router.get("/roadmap")
async def read_roadmap(learner_id: str = Depends(require_learner)):
    """The whole ladder — every level, the XP that opens it and what it
    unlocks — with the learner's place on it. A read-only projection of the
    server-owned rules, so the roadmap screen never carries its own copy of
    the curve or the reward table to drift out of step with the settlement."""
    from app.services.progression.curve import MAX_LEVEL, level_table
    from app.services.progression.rewards import public_reward_for_level

    levels = [
        {**row, "reward": public_reward_for_level(row["level"])}
        for row in level_table()
    ]
    return JSONResponse(content={
        "rulesVersion": progression.RULES_VERSION,
        "maxLevel": MAX_LEVEL,
        "levels": levels,
        "progression": await progression.get_status(learner_id),
    })


@router.post("/debug/grant-xp")
async def grant_debug_xp(learner_id: str = Depends(require_learner)):
    """Local-only XP increment for exercising level rewards and catalog locks."""
    if is_production():
        raise HTTPException(status_code=404, detail="Not found")
    return JSONResponse(content=await progression.award_debug_xp(learner_id))


@router.post("/hint-token/use")
async def use_hint_token(
    payload: HintTokenUseRequest,
    learner_id: str = Depends(require_learner),
):
    """Spend one earned token to re-arm a hint on the active question."""
    from app.agents import tutor_decision
    from app.brain.repository import apply_brain_operators, get_brain
    from app.services.progression import ledger

    brain = await get_brain(learner_id)
    current = brain.get("current_state") or {}
    if (
        current.get("component_id") != payload.component_id
        or current.get("question_id") != payload.question_id
    ):
        return JSONResponse(status_code=409, content={"ok": False, "code": "question_changed"})

    question_key = tutor_decision.support_question_key(current, payload.component_id)
    used = tutor_decision.support_used(current, question_key)
    if not used["hint"]:
        return JSONResponse(status_code=409, content={"ok": False, "code": "standard_hint_available"})

    consumed = await ledger.consume_entitlement(
        learner_id, field="extra_hint_tokens"
    )
    if not consumed["consumed"]:
        return JSONResponse(status_code=409, content={"ok": False, "code": "no_hint_tokens"})

    await apply_brain_operators(learner_id, {
        "current_state.support_used": {
            **used,
            "question_key": question_key,
            "hint": False,
            "hint_level": 0,
            "extra_hint_token_used": True,
        }
    })
    return {
        "ok": True,
        "remaining": consumed["remaining"],
        "questionKey": question_key,
    }