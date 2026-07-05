"""Static assets, React shell, and standalone learning content routes."""

from fastapi import APIRouter, FastAPI
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from app.core.paths import LEARNING_GAME_FILE, LOCALES_DIR, REACT_APP_DIR, REACT_ASSETS_DIR, SHARED_DIR


router = APIRouter(tags=["static"])


def mount_static_assets(app: FastAPI) -> None:
    """Mount shared static directories used by React and iframe content."""
    app.mount("/shared", StaticFiles(directory=str(SHARED_DIR)), name="shared")
    app.mount("/locales", StaticFiles(directory=str(LOCALES_DIR)), name="locales")
    if REACT_ASSETS_DIR.exists():
        app.mount("/assets", StaticFiles(directory=str(REACT_ASSETS_DIR)), name="react-assets")


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


@router.get("/student-dashboard")
@router.get("/student-dashboard/{path:path}")
async def student_dashboard_route(path: str = ""):
    """Serve the React app shell for the student dashboard route."""
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