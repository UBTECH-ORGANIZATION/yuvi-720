"""Static assets, React shell, and standalone learning content routes."""

from fastapi import APIRouter, FastAPI
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from app.core.paths import (
    CAMPAIGN_DIR,
    ENGLISH_ASSETS_DIR,
    ENGLISH_PLAYER_DIR,
    LEARNING_GAME_FILE,
    LOCALES_DIR,
    REACT_APP_DIR,
    REACT_ASSETS_DIR,
    SHARED_DIR,
    UNITY_WORLD_DIR,
)


class _ImmutableStaticFiles(StaticFiles):
    """Static files that may be cached forever.

    Safe only because every filename carries a hash of the prompt that produced
    it: change the picture and you change the URL, so a browser is never asked
    to notice that a file it already has is now different. That is what makes an
    image on an embedded screen appear instantly on the second visit — and on
    the first, if the previous screen preloaded it.
    """

    def file_response(self, *args, **kwargs):
        response = super().file_response(*args, **kwargs)
        response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        return response


router = APIRouter(tags=["static"])


def mount_static_assets(app: FastAPI) -> None:
    """Mount shared static directories used by React and iframe content."""
    app.mount("/shared", StaticFiles(directory=str(SHARED_DIR)), name="shared")
    app.mount("/locales", StaticFiles(directory=str(LOCALES_DIR)), name="locales")
    if CAMPAIGN_DIR.exists():
        app.mount("/campaign", StaticFiles(directory=str(CAMPAIGN_DIR)), name="campaign")
    if REACT_ASSETS_DIR.exists():
        app.mount("/assets", StaticFiles(directory=str(REACT_ASSETS_DIR)), name="react-assets")
    if UNITY_WORLD_DIR.exists():
        app.mount("/unity-world", StaticFiles(directory=str(UNITY_WORLD_DIR)), name="unity-world")
    # BEFORE the player mount below, not after: Starlette matches mounts in the
    # order they are added, so the broader `/content/player-assets` would
    # otherwise swallow every `/media/...` path and 404 on all of them.
    if ENGLISH_ASSETS_DIR.exists():
        app.mount(
            "/content/player-assets/media",
            _ImmutableStaticFiles(directory=str(ENGLISH_ASSETS_DIR)),
            name="content-media",
        )
    if ENGLISH_PLAYER_DIR.exists():
        app.mount(
            "/content/player-assets",
            StaticFiles(directory=str(ENGLISH_PLAYER_DIR)),
            name="content-player-assets",
        )


def serve_react_app():
    """Serve the built React SPA shell, or a clear error if it is missing."""
    index_file = REACT_APP_DIR / "index.html"
    if index_file.exists():
        return FileResponse(index_file)
    return JSONResponse(
        content={"error": "React build missing. Run `npm run build` in frontend/."},
        status_code=503,
    )


@router.get("/")
async def root():
    """Serve the React app shell at the site root."""
    return serve_react_app()


@router.get("/results")
@router.get("/results/{path:path}")
async def results_route(path: str = ""):
    """Serve the React app shell for the results route."""
    return serve_react_app()


@router.get("/report")
@router.get("/report/{path:path}")
async def report_route(path: str = ""):
    """Serve the React app shell for the public fault report page."""
    return serve_react_app()


@router.get("/learner-mapping")
@router.get("/learner-mapping/{path:path}")
async def learner_mapping_route(path: str = ""):
    """Serve the React app shell for the learner mapping route."""
    return serve_react_app()


@router.get("/student-dashboard")
@router.get("/student-dashboard/{path:path}")
async def student_dashboard_route(path: str = ""):
    """Serve the React app shell for the student dashboard route."""
    return serve_react_app()


@router.get("/yuvi-studio")
@router.get("/yuvi-studio/{path:path}")
async def yuvi_studio_route(path: str = ""):
    """Serve the React app shell for the Yuvi studio route."""
    return serve_react_app()


@router.get("/teacher-view")
@router.get("/teacher-view/{path:path}")
async def teacher_view_route(path: str = ""):
    """Serve the React app shell for the teacher view route."""
    return serve_react_app()


# `/teacher` is where the React router actually lives; `/teacher-view` above is
# the legacy path. Without this, a teacher who refreshes or opens a shared link
# gets a raw JSON 404 instead of the app.
@router.get("/teacher")
@router.get("/teacher/{path:path}")
async def teacher_route(path: str = ""):
    """Serve the React app shell for the teacher app routes."""
    return serve_react_app()


@router.get("/admin")
@router.get("/admin/{path:path}")
async def admin_route(path: str = ""):
    """Serve the React app shell for the org administration routes."""
    return serve_react_app()


@router.get("/badges")
@router.get("/badges/{path:path}")
async def badges_route(path: str = ""):
    """Serve the React app shell for the badges route."""
    return serve_react_app()


@router.get("/mentoring")
@router.get("/mentoring/{path:path}")
async def mentoring_route(path: str = ""):
    """Serve the React app shell for the mentoring route."""
    return serve_react_app()


@router.get("/learning/game.html")
async def learning_game():
    """Serve the self-contained interactive game as a standalone iframe document."""
    if LEARNING_GAME_FILE.exists():
        return FileResponse(LEARNING_GAME_FILE)
    return JSONResponse(content={"error": "game not found"}, status_code=404)


@router.get("/learning")
@router.get("/learning/{path:path}")
async def learning_route(path: str = ""):
    """Serve the React app shell for the learning portal/lesson/create routes."""
    return serve_react_app()


@router.get("/app")
@router.get("/app/{path:path}")
async def old_react_app_path(path: str = ""):
    """Redirect the temporary migration URL to the root app."""
    return RedirectResponse(url="/")