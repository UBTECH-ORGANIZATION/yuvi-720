"""Learner state API routes.

The learner id comes from the session cookie only — a client-supplied
`learner_id` in the query string or body is ignored.
"""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from app.auth.dependencies import require_learner, require_learner_session
from app.auth.repository import get_user_by_id, set_agency_started_at
from app.services import unlock_sync, unlocks
from app.services.lrs import reporter as lrs_reporter
from learner_state import get_learner_state, update_learner_state


router = APIRouter(prefix="/api", tags=["learner-state"])


@router.get("/learner-state")
async def read_learner_state(learner_id: str = Depends(require_learner)):
    """Return persisted learner UI state from MongoDB, with local fallback."""
    return JSONResponse(content=await get_learner_state(learner_id))


def _completed(progress) -> bool:
    return bool(isinstance(progress, dict) and progress.get("completed"))


async def _report_onboarding_completed(session: dict) -> None:
    """Onboarding ended = the results/profile-summary step finished. Reports the
    MoE agency/PRE `completed` with duration = results-approved − mapping-start."""
    learner_id = session["sub"]
    duration_seconds = 0.0
    try:
        user = await get_user_by_id(learner_id)
        started_raw = (user or {}).get("agency_started_at")
        if started_raw:
            started = datetime.fromisoformat(str(started_raw))
            duration_seconds = max(
                0.0, (datetime.now(timezone.utc) - started).total_seconds()
            )
    except Exception:
        pass
    await lrs_reporter.report_agency_completed(
        learner_id, session["sid"], duration_seconds
    )
    await set_agency_started_at(learner_id, None)  # next mapping = a new journey


async def _screen_room_items(learner_id: str, data: dict) -> None:
    """Drop earned furniture the learner has not earned, in place.

    `room` is client-writable, so hiding a locked prop in the studio would
    otherwise be the only thing standing between a learner and a hand-written
    PATCH. Unearned items are stripped rather than rejected: the rest of the
    room is legitimate, and failing the whole write would lose it.
    """
    room = data.get("room")
    if not isinstance(room, dict):
        return
    items = room.get("items")
    if not isinstance(items, list):
        return
    gated = {
        str(item.get("kind"))
        for item in items
        if isinstance(item, dict) and unlocks.is_gated_prop(str(item.get("kind")))
    }
    if not gated:
        return
    try:
        held = await unlock_sync.held_props(learner_id)
    except Exception:
        held = set()
    if gated <= held:
        return
    room["items"] = [
        item for item in items
        if not (isinstance(item, dict)
                and unlocks.is_gated_prop(str(item.get("kind")))
                and str(item.get("kind")) not in held)
    ]


@router.patch("/learner-state")
async def patch_learner_state(data: dict, session=Depends(require_learner_session)):
    """Persist learner UI state such as language, mapping, profile, dashboard, or progress."""
    learner_id = session["sub"]
    await _screen_room_items(learner_id, data)
    # A badge chosen as the profile picture must actually be earned — the picker
    # only offers earned coins, so this rejects tampering, not normal use.
    avatar = data.get("avatar")
    if isinstance(avatar, dict) and avatar.get("kind") == "badge":
        badge = avatar.get("badge") or {}
        try:
            from app.brain.repository import get_brain
            from app.services import kata_catalog
            from app.services.badges import project_badges
            from app.services.events import get_learner_events
            await kata_catalog.ensure_loaded()
            brain = await get_brain(learner_id)
            # MUST pass events — return-over-days milestones (streak/dedicated) are
            # only "earned" with the event history, exactly like GET /api/badges.
            try:
                events = await get_learner_events(learner_id)
            except Exception:
                events = []
            earned = {(b["subject"], b["tier"]) for b in project_badges(brain, events=events) if b["earned"]}
        except Exception:
            earned = set()
        if (badge.get("subject"), badge.get("tier")) not in earned:
            return JSONResponse(status_code=400, content={"error": "badge not earned"})
    # Detect the onboarding-completed transition BEFORE writing the new state.
    finishing_onboarding = False
    if session.get("sid") and _completed(data.get("profile_summary_progress")):
        try:
            previous = await get_learner_state(learner_id)
            finishing_onboarding = not _completed(
                previous.get("profile_summary_progress")
            )
        except Exception:
            finishing_onboarding = False
    result = await update_learner_state(learner_id, data)
    # Keep the brain's locale in sync with the learner's UI language choice —
    # otherwise the coach/reflection phrasing stays stuck on the locale the
    # brain was created with (Arabic learners were answered in Hebrew).
    if data.get("language") in ("he", "ar", "en"):
        try:
            from app.brain.repository import apply_brain_updates
            await apply_brain_updates(learner_id, {"identity.locale": data["language"]})
        except Exception as exc:
            print(f"⚠️ locale sync skipped: {type(exc).__name__}")
    if finishing_onboarding:
        try:
            await _report_onboarding_completed(session)
        except Exception as exc:  # reporting must never break state saves
            print(f"⚠️ agency completed report skipped: {type(exc).__name__}")
        try:
            from app.brain.description import seed_from_onboarding
            await seed_from_onboarding(learner_id)
        except Exception as exc:
            print(f"⚠️ student_description seed skipped: {type(exc).__name__}")
    return JSONResponse(content=result)
