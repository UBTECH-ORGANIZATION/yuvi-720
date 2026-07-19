"""Yuvilab Spark FastAPI application bootstrap."""

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
from app.routes.brain import router as brain_router
from app.routes.agent import router as agent_router
from app.routes.teacher import router as teacher_router
from app.routes.mentoring import router as mentoring_router
from app.routes.contact import router as contact_router
from app.routes.dashboard import router as dashboard_router
from app.routes.learner_mapping import router as learner_mapping_router
from app.routes.learner_state import router as learner_state_router
from app.routes.learning_catalog import router as learning_catalog_router
from app.routes.learning_content import router as learning_content_router
from app.routes.mapping_chat import router as mapping_chat_router
from app.routes.profile import router as profile_router
from app.routes.static_pages import mount_static_assets, router as static_pages_router
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


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    """Start shared application resources, including the MCP session manager."""
    async with content_catalog_mcp_lifespan():
        yield


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
    app.include_router(learner_mapping_router)
    app.include_router(learner_state_router)
    app.include_router(brain_router)
    app.include_router(xapi_router)
    app.include_router(learning_catalog_router)
    app.include_router(agent_router)
    app.include_router(teacher_router)
    app.include_router(mentoring_router)
    app.include_router(profile_router)
    app.include_router(dashboard_router)
    app.include_router(mapping_chat_router)
    app.include_router(learning_content_router)
    app.include_router(contact_router)

    mount_content_catalog_mcp(app)

    mount_static_assets(app)
    app.include_router(static_pages_router)

    configure_telemetry(app, service_name="spark-backend")

    return app


app = create_app()


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "8720")))
