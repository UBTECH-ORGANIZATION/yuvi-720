"""Yuvilab Spark FastAPI application bootstrap."""

import os

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routes.contact import router as contact_router
from app.routes.dashboard import router as dashboard_router
from app.routes.learner_mapping import router as learner_mapping_router
from app.routes.learner_state import router as learner_state_router
from app.routes.learning_content import router as learning_content_router
from app.routes.mapping_chat import router as mapping_chat_router
from app.routes.profile import router as profile_router
from app.routes.static_pages import mount_static_assets, router as static_pages_router


def create_app() -> FastAPI:
    """Create and configure the Yuvilab Spark API application."""
    app = FastAPI(title="Yuvilab Spark", version="1.0.0")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(learner_mapping_router)
    app.include_router(learner_state_router)
    app.include_router(profile_router)
    app.include_router(dashboard_router)
    app.include_router(mapping_chat_router)
    app.include_router(learning_content_router)
    app.include_router(contact_router)

    mount_static_assets(app)
    app.include_router(static_pages_router)

    return app


app = create_app()


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "8720")))
