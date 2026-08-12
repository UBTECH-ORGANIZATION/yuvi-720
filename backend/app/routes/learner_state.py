"""Learner state API routes.

The learner id comes from the session cookie only — a client-supplied
`learner_id` in the query string or body is ignored.
"""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from app.auth.dependencies import require_learner, require_learner_session
from app.auth.repository import get_user_by_id, set_agency_started_at
from app.services.lrs import reporter as lrs_reporter
from learner_state import get_learner_state, update_learner_state


router = APIRouter(prefix="/api", tags=["learner-state"])


@router.get("/learner-state")
async def read_learner_state(learner_id: str = Depends(require_learner)):
    """Return persisted learner UI state from MongoDB, with local fallback.

    `avatar` is filled in when the learner has never chosen one: their best
    earned badge, exactly as the teacher's roster derives it, so a child sees
    the same coin their teacher sees. Derived, never stored — the moment they
    earn a better one it changes, and picking one still overwrites it for good.
    """
    state = await get_learner_state(learner_id)
    # ANY saved choice wins, including `{"kind": "initial"}` — that one is a
    # learner who pressed "back to my letter", and re-deriving over it would
    # make the reset button do nothing.
    avatar = state.get("avatar")
    if not (isinstance(avatar, dict) and avatar.get("kind")):
        state = {**state, "avatar": await _earned_avatar(learner_id)}
    return JSONResponse(content=state)


async def _earned_avatar(learner_id: str):
    """The learner's best earned coin, or `None`. Never raises: an avatar is
    decoration, and a failure here must not take the whole state read down."""
    try:
        from app.brain.repository import get_brain
        from app.services import kata_catalog
        from app.services.badges import best_badge

        await kata_catalog.ensure_loaded()
        return best_badge(await get_brain(learner_id))
    except Exception as exc:      # pragma: no cover — an initial is a fine avatar
        print(f"⚠️ derived avatar skipped: {type(exc).__name__}")
        return None


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


@router.patch("/learner-state")
async def patch_learner_state(data: dict, session=Depends(require_learner_session)):
    """Persist learner UI state such as language, mapping, profile, dashboard, or progress."""
    learner_id = session["sub"]
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
