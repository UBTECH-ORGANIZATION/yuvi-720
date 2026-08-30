"""Static assets, React shell, and standalone learning content routes."""

from fastapi import APIRouter, FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.paths import (
    CAMPAIGN_DIR,
    LEARNING_GAME_FILE,
    LOCALES_DIR,
    REACT_APP_DIR,
    REACT_ASSETS_DIR,
    SHARED_DIR,
    UNITY_WORLD_DIR,
)


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

    # Everything Vite copies verbatim from `frontend/public` lands at the build
    # ROOT (`/moments/…`, `/yuvi-favicon.png`), not under `/assets` — only
    # hashed bundle output goes there. Nothing mounted above covers the root, so
    # every one of those files answered 404 in every deployed environment while
    # working perfectly in dev, where Vite's own server serves `public/` at `/`.
    # That divergence is why it went unnoticed: the class book quietly fell back
    # to its hand-drawn SVG scenes in production and looked deliberate.
    #
    # Mounted per directory rather than mounting the build root at "/", which
    # would sit in front of the API routers and the SPA shell.
    for public_dir in ("moments",):
        directory = REACT_APP_DIR / public_dir
        if directory.exists():
            app.mount(
                f"/{public_dir}",
                StaticFiles(directory=str(directory)),
                name=f"react-public-{public_dir}",
            )


@router.get("/yuvi-favicon.png", include_in_schema=False)
async def favicon():
    """The tab icon — `public/`, so it had no route either (see above)."""
    icon = REACT_APP_DIR / "yuvi-favicon.png"
    if icon.exists():
        return FileResponse(icon)
    return JSONResponse(content={"error": "not found"}, status_code=404)


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


def install_spa_fallback(app: FastAPI) -> None:
    """Reloading any client route serves the shell, never `{"detail":"Not Found"}`.

    The routes above are an allow-list, and it kept losing (ADO #507's report
    caught it): `/teacher` — the entire teacher lane — was never added, so a
    reload anywhere in it worked in dev (Vite serves everything) and returned
    raw JSON in every deployed environment. Rather than growing the list one
    forgotten route at a time, an unmatched GET that a BROWSER is navigating to
    (`Accept: text/html`) falls back to the React shell and lets the client
    router take it from there.

    API consumers are untouched: anything under `/api` keeps its JSON 404 with
    its original detail, as does any request that does not ask for HTML.
    """

    @app.exception_handler(404)
    async def _spa_fallback(request: Request, exc: StarletteHTTPException):
        wants_html = "text/html" in (request.headers.get("accept") or "")
        if request.method == "GET" and wants_html \
                and not request.url.path.startswith("/api"):
            return serve_react_app()
        detail = getattr(exc, "detail", None) or "Not Found"
        return JSONResponse(content={"detail": detail}, status_code=404)