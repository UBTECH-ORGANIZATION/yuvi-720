"""Yuvilab Spark FastAPI application bootstrap."""

import asyncio
import os
from contextlib import asynccontextmanager
from typing import AsyncIterator

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.env import ensure_env_loaded


# Local development secrets live in backend/.env (gitignored). Azure App
# Service process settings retain precedence over file values.
ensure_env_loaded()

from app.routes.auth import router as auth_router
from app.routes.auth_moe import router as auth_moe_router
from app.routes.badges import router as badges_router
from app.routes.brain import router as brain_router
from app.routes.agent import router as agent_router
from app.routes.admin_org import router as admin_org_router
from app.routes.teacher import router as teacher_router
from app.routes.teacher_students import router as teacher_students_router
from app.routes.teacher_catalog import router as teacher_catalog_router
from app.routes.teacher_state import router as teacher_state_router
from app.routes.teacher_subgroups import router as teacher_subgroups_router
from app.routes.teacher_wellbeing import router as teacher_wellbeing_router
from app.routes.teacher_tasks import router as teacher_tasks_router
from app.routes.student_tasks import router as student_tasks_router
from app.routes.student_calendar import router as student_calendar_router
from app.routes.teacher_live import router as teacher_live_router
from app.routes.teacher_calendar import router as teacher_calendar_router
from app.routes.notifications import router as notifications_router
from app.routes.me import router as me_router
from app.routes.teacher_assistant import router as teacher_assistant_router
from app.routes.mentoring import router as mentoring_router
from app.routes.rewards import router as rewards_router
from app.routes.campaign import router as campaign_router
from app.routes.contact import router as contact_router
from app.routes.dashboard import router as dashboard_router
from app.routes.learner_mapping import router as learner_mapping_router
from app.routes.learner_state import router as learner_state_router
from app.routes.learning_catalog import router as learning_catalog_router
from app.routes.learning_content import router as learning_content_router
from app.routes.checkin import router as checkin_router
from app.routes.illustrations import router as illustrations_router
from app.routes.mapping_chat import router as mapping_chat_router
from app.routes.profile import router as profile_router
from app.routes.static_pages import mount_static_assets, router as static_pages_router
from app.routes.support import internal_router as support_internal_router, router as support_router
from app.routes.xapi import router as xapi_router
from app.core.telemetry import configure_telemetry
from app.services.content_catalog_mcp import content_catalog_mcp_lifespan, mount_content_catalog_mcp


_DEV_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"]


def _allowed_origins() -> list[str]:
    """Explicit CORS origins, required because the session cookie is credentialed."""
    configured = os.environ.get("ALLOWED_ORIGINS", "")
    origins = [origin.strip() for origin in configured.split(",") if origin.strip()]
    for key in ("PUBLIC_APP_URL", "FRONTEND_URL"):
        value = (os.environ.get(key) or "").strip().rstrip("/")
        if value and value not in origins:
            origins.append(value)
    if not origins:
        return list(_DEV_ORIGINS)
    return origins + [o for o in _DEV_ORIGINS if o not in origins]


async def run_index_steps(steps) -> list[str]:
    """Run each index-creation step in isolation; return the labels that failed.

    A named function rather than an inline loop so the isolation is *testable*:
    these steps used to share one `try`, which meant the first failure silently
    skipped every index after it — the slowest possible failure mode, and one no
    source-shape assertion reliably catches. A test can now make step one raise
    and check step two still ran.

    Never raises: a missing index makes the product slow, not broken, and must
    never stop a boot.
    """
    failed: list[str] = []
    for label, step in steps:
        try:
            await step()
        except Exception as exc:  # pragma: no cover - best effort by design
            failed.append(label)
            print(f"⚠️ {label} index setup skipped: {type(exc).__name__}")
    return failed


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    """Start shared application resources, including the MCP session manager."""
    # MoE-LRS outbox sweeper (Retry/Resend) — only when reporting is enabled.
    from app.services.lrs import config as lrs_config, outbox as lrs_outbox

    sweeper = (
        asyncio.create_task(lrs_outbox.run_sweeper()) if lrs_config.is_enabled() else None
    )
    # Is the address we hand Kata for xAPI relay actually reachable? A dead
    # tunnel drops every content statement in silence, so it gets checked once
    # at boot rather than discovered days later in an empty events collection.
    from app.services.learning_sessions import probe_relay_base_url

    relay_probe = asyncio.create_task(probe_relay_base_url())
    # Presence listens to the bus's connect/disconnect hooks. Not an index step,
    # but it has to happen before the first SSE connection either way.
    from app.services import presence

    presence.install_hooks()

    # Index setup for every collection the teacher lane introduced.
    #
    # Best-effort per module, and deliberately one try *each*: these used to
    # share a single `except`, so the first failure silently skipped every
    # index after it — the slowest possible failure mode, and invisible.
    # A missing index is slow, never broken, and must never stop a boot.
    from app.agents.teacher_tools import registry as teacher_tool_registry
    from app.auth.moe import transactions as moe_transactions
    from app.services import (
        daily_brief, direct_messages, kudos, mentoring_assist, notifications,
        org_repository, school_calendar, teacher_alerts, teacher_insights_store,
        weekly_digest, wellbeing,
    )

    index_steps = (
        # Authorization hot path: every teacher read resolves links + enrollments.
        ("org", org_repository.ensure_indexes),
        # TTL on in-flight MoE sign-ins, so abandoned logins expire themselves.
        ("oidc_transactions", moe_transactions.ensure_indexes),
        # The replay cursor query, (teacher_id, seq).
        ("teacher_alerts", teacher_alerts.ensure_indexes),
        ("notifications", notifications.ensure_indexes),
        ("kudos", kudos.ensure_indexes),
        # The message thread: read by (conversation, created_at) on every open,
        # and by (conversation, sender, read_at) on every mark-read.
        ("direct_messages", direct_messages.ensure_indexes),
        # Read on every open of a student's Notes tab.
        ("teacher_insights", teacher_insights_store.ensure_indexes),
        ("group_digests", weekly_digest.ensure_indexes),
        ("teacher_briefs", daily_brief.ensure_indexes),
        # The assistant's audit trail — the only unbounded collection here.
        ("teacher_tool_calls", teacher_tool_registry.ensure_indexes),
        # Read by (learner_id, at) every time a teacher opens the wellbeing tab.
        ("wellbeing_flags", wellbeing.ensure_indexes),
        # Cleared per learner when a teacher's suggestions are invalidated.
        ("goal_suggestions", mentoring_assist.ensure_goal_suggestion_indexes),
        # Read by (group_id, start_at) on every open of the class calendar.
        ("calendar_events", school_calendar.ensure_indexes),
    )
    await run_index_steps(index_steps)

    # Presence lives in this process's memory, so a restart wipes it and every
    # child reads offline until they next reconnect. Read the last snapshots
    # back — after the indexes, because unlike `install_hooks()` above this one
    # needs the database. Liveness is not restored, only what was last seen.
    try:
        restored = await presence.rehydrate()
        if restored:
            print(f"↻ presence: {restored} learners restored as last-seen (none online)")
    except Exception as exc:  # a cold cache is a slow screen, never a failed boot
        print(f"⚠️ presence rehydrate skipped: {type(exc).__name__}")

    # The bus is in-process, so with more than one worker a learner's events and
    # their teacher's stream can land on different processes and simply never
    # meet. Warn loudly rather than let it look like a flaky feature.
    workers = os.environ.get("WEB_CONCURRENCY")
    if workers and workers.isdigit() and int(workers) > 1:
        print(
            f"⚠️ WEB_CONCURRENCY={workers}: the realtime bus is in-process, so "
            "presence and teacher alerts will fragment across workers. Run a "
            "single worker, or move `app.services.realtime` onto a shared bus."
        )

    try:
        async with content_catalog_mcp_lifespan():
            yield
    finally:
        if sweeper:
            sweeper.cancel()
        relay_probe.cancel()


def create_app() -> FastAPI:
    """Create and configure the Yuvilab Spark API application."""
    app = FastAPI(title="Yuvilab Spark", version="1.0.0", lifespan=lifespan)

    # Credentialed requests (the session cookie) are incompatible with a
    # wildcard origin — browsers reject the response outright. Origins must be
    # explicit. In dev the Vite proxy makes /api same-origin, so this only
    # matters once the frontend is served from a different host.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_allowed_origins(),
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(auth_router)
    app.include_router(auth_moe_router)
    # Development-only OpenID provider, so the ministry sign-in path can be
    # built and demoed before the ministry issues real connection details.
    from app.auth.moe import config as moe_config

    if moe_config.mock_enabled():
        from app.routes.dev_oidc import router as dev_oidc_router

        app.include_router(dev_oidc_router)
        print("🔑 MoE mock IdP enabled at /dev-idp — never use in production")
    elif moe_config.is_enabled():
        print("🔑 MoE unified sign-in enabled")
    else:
        missing = ", ".join(moe_config.missing_settings())
        print(f"🔑 MoE unified sign-in disabled (missing: {missing or 'MOE_OIDC_ENABLED'})")
    app.include_router(learner_mapping_router)
    app.include_router(learner_state_router)
    app.include_router(brain_router)
    app.include_router(badges_router)
    app.include_router(xapi_router)
    app.include_router(learning_catalog_router)
    app.include_router(illustrations_router)
    app.include_router(agent_router)
    app.include_router(teacher_router)
    app.include_router(teacher_students_router)
    app.include_router(teacher_state_router)
    app.include_router(teacher_subgroups_router)
    app.include_router(teacher_wellbeing_router)
    app.include_router(teacher_catalog_router)
    app.include_router(teacher_tasks_router)
    app.include_router(student_tasks_router)
    app.include_router(student_calendar_router)
    app.include_router(teacher_live_router)
    app.include_router(teacher_calendar_router)
    app.include_router(notifications_router)
    app.include_router(me_router)
    app.include_router(teacher_assistant_router)
    app.include_router(admin_org_router)
    app.include_router(mentoring_router)
    app.include_router(rewards_router)
    app.include_router(profile_router)
    app.include_router(dashboard_router)
    app.include_router(mapping_chat_router)
    app.include_router(learning_content_router)
    app.include_router(contact_router)
    app.include_router(campaign_router)
    app.include_router(support_router)
    app.include_router(support_internal_router)
    app.include_router(checkin_router)

    mount_content_catalog_mcp(app)

    mount_static_assets(app)
    app.include_router(static_pages_router)

    configure_telemetry(app, service_name="spark-backend")

    return app


app = create_app()


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "8720")))
