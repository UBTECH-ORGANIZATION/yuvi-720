"""Spark rewards routes (wallet, shop catalog, purchase). Thin: validate + delegate."""

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse

from app.auth.dependencies import require_learner
from app.services import rewards
from learner_state import get_learner_state  # type: ignore


router = APIRouter(prefix="/api/rewards", tags=["rewards"])


@router.get("/wallet")
async def read_wallet(learner_id: str = Depends(require_learner)):
    """Current spark balance. Effort feedback, not a grade — no comparisons."""
    return JSONResponse(content=await rewards.get_wallet(learner_id))


@router.get("/catalog")
async def read_catalog(learner_id: str = Depends(require_learner)):
    """Shop rows with server-side prices plus the learner's owned items."""
    state = await get_learner_state(learner_id)
    return JSONResponse(content={
        "items": rewards.catalog_for_client(state.get("avatar_unlocks") or []),
        "wallet": await rewards.get_wallet(learner_id),
    })


@router.get("/ledger")
async def read_ledger(limit: int = 20, learner_id: str = Depends(require_learner)):
    """Recent spark movements, so every balance change is explainable."""
    return JSONResponse(content={"entries": await rewards.list_ledger(learner_id, limit)})


@router.post("/purchase")
async def purchase(data: dict, learner_id: str = Depends(require_learner)):
    """Spend sparks on one cosmetic. The client sends an id only, never a price."""
    asset_id = (data.get("assetId") or data.get("asset_id") or "").strip()
    if not asset_id:
        raise HTTPException(status_code=400, detail="assetId is required")
    result = await rewards.purchase_asset(learner_id, asset_id)
    if not result.get("ok"):
        reason = result.get("reason")
        if reason == "not_for_sale":
            raise HTTPException(status_code=404, detail="Item is not for sale")
        return JSONResponse(status_code=409, content=result)
    return JSONResponse(content=result)
