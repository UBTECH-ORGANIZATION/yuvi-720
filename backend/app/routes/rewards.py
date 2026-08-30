"""Spark rewards routes (wallet, shop catalog, purchase). Thin: validate + delegate."""

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse

from app.auth.dependencies import require_learner
from app.services import rewards, unlock_sync, unlocks
from learner_state import get_learner_state  # type: ignore


router = APIRouter(prefix="/api/rewards", tags=["rewards"])


@router.get("/wallet")
async def read_wallet(learner_id: str = Depends(require_learner)):
    """Current spark balance. Effort feedback, not a grade — no comparisons."""
    return JSONResponse(content=await rewards.get_wallet(learner_id))


@router.get("/catalog")
async def read_catalog(learner_id: str = Depends(require_learner)):
    """Shop rows with server-side prices, plus what the learner has earned."""
    # Opening the studio is the moment a learner expects a new reward to be
    # there, so grants are settled on the way in rather than by a background job.
    try:
        earned = await unlock_sync.sync_unlocks(learner_id)
    except Exception as exc:
        print(f"⚠️ unlock sync skipped: {type(exc).__name__}")
        earned = {"avatar_unlocks": [], "room_unlocks": [], "streak": 0, "newly_unlocked": []}
    state = await get_learner_state(learner_id)
    owned_avatar = state.get("avatar_unlocks") or earned["avatar_unlocks"]
    owned_props = state.get("room_unlocks") or earned["room_unlocks"]
    return JSONResponse(content={
        "items": rewards.catalog_for_client(owned_avatar),
        "wallet": await rewards.get_wallet(learner_id),
        "unlocks": unlocks.catalog_for_client(owned_avatar, owned_props),
        "roomUnlocks": sorted(owned_props),
        "streak": earned["streak"],
        "newlyUnlocked": earned["newly_unlocked"],
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
    if result.get("reason") == "not_for_sale":
        raise HTTPException(status_code=404, detail="Item is not for sale")
    # `owned` / `insufficient` are ordinary UI states, not transport errors, so
    # they come back as 200 with `ok: false` and enough context to explain them.
    return JSONResponse(content=result)
