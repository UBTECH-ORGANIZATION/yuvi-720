"""Standalone authenticated administration API and static frontend host."""

from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
import asyncio
import os
from pathlib import Path
import secrets
from typing import Any, Optional

from authlib.integrations.starlette_client import OAuth
from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response
from fastapi.responses import JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from starlette.middleware.sessions import SessionMiddleware

from .auth import create_admin_token, decode_admin_token, is_allowed_admin, normalize_email
from .config import Settings
from .database import UsageEventRepository
from .usage_report import UsageSummary, build_usage_summary


_ADMIN_COOKIE = "spark_admin_token"
_FRONTEND_DIST = Path(__file__).resolve().parents[1] / "frontend" / "dist"


class AdminIdentity(BaseModel):
    email: str
    name: str


class AuthStatus(BaseModel):
    authenticated: bool
    admin: Optional[AdminIdentity] = None
    oauth_configured: bool = True
    public_access: bool = False


def _environment_flag(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _create_oauth(settings: Settings) -> OAuth:
    oauth = OAuth()
    if settings.oauth_configured:
        oauth.register(
            name="google",
            client_id=settings.google_client_id,
            client_secret=settings.google_client_secret,
            server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
            client_kwargs={"scope": "openid email profile"},
        )
    return oauth


def _settings(request: Request) -> Settings:
    return request.app.state.settings


def _repository(request: Request) -> UsageEventRepository:
    return request.app.state.usage_repository


async def admin_required(request: Request) -> dict[str, Any]:
    settings = _settings(request)
    token = request.cookies.get(_ADMIN_COOKIE)
    payload = decode_admin_token(token, settings) if token else None
    if payload is None:
        raise HTTPException(status_code=401, detail="admin_authentication_required")
    return payload


def create_app(
    settings: Optional[Settings] = None,
    public_access: Optional[bool] = None,
) -> FastAPI:
    requested_public_access = (
        _environment_flag("ADMIN_PUBLIC_ACCESS", False)
        if public_access is None
        else public_access
    )
    if (
        settings is None
        and requested_public_access
        and os.getenv("ADMIN_ENV", "development").strip().lower() in {"production", "prod"}
        and not os.getenv("ADMIN_SECRET_KEY", "").strip()
    ):
        # Public mode never creates an auth cookie. The ephemeral key only
        # satisfies SessionMiddleware until Google auth is enabled later.
        os.environ["ADMIN_SECRET_KEY"] = secrets.token_urlsafe(48)
    resolved_settings = settings or Settings.from_environment()
    resolved_public_access = requested_public_access
    is_production = resolved_settings.environment in {"production", "prod"}
    if is_production:
        required_settings = [
            ("MONGODB_CONNECTION_STRING", bool(resolved_settings.mongodb_connection_string)),
        ]
        if not resolved_public_access:
            required_settings.extend([
                ("ADMIN_EMAILS", bool(resolved_settings.admin_emails)),
                ("GOOGLE_CLIENT_ID", bool(resolved_settings.google_client_id)),
                ("GOOGLE_CLIENT_SECRET", bool(resolved_settings.google_client_secret)),
            ])
        missing_settings = [name for name, configured in required_settings if not configured]
        if missing_settings:
            raise RuntimeError(f"Missing required production settings: {', '.join(missing_settings)}")
        if not resolved_public_access and len(resolved_settings.admin_secret_key) < 32:
            raise RuntimeError("ADMIN_SECRET_KEY must contain at least 32 characters in production")
        if not resolved_public_access and not resolved_settings.secure_cookies:
            raise RuntimeError("ADMIN_COOKIE_SECURE must be enabled in production")
        if not _FRONTEND_DIST.exists():
            raise RuntimeError("Admin frontend build is required in production")
    repository = UsageEventRepository(resolved_settings)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        if resolved_public_access:
            print("⚠️ Admin public access is enabled; Google authentication is bypassed")
        elif not resolved_settings.admin_emails:
            print("⚠️ ADMIN_EMAILS is empty; all administrator logins are disabled")
        try:
            await repository.ping()
            print("✅ Admin read-only MongoDB connection verified")
        except Exception as exc:
            if is_production:
                raise RuntimeError("Admin MongoDB readiness check failed") from exc
            print(f"⚠️ Admin MongoDB unavailable at startup: {type(exc).__name__}")
        yield
        repository.close()

    app = FastAPI(
        title="Yuvilab Spark Admin",
        version="1.0.0",
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
        lifespan=lifespan,
    )
    app.state.settings = resolved_settings
    app.state.public_access = resolved_public_access
    app.state.oauth = _create_oauth(resolved_settings)
    app.state.usage_repository = repository
    app.add_middleware(
        SessionMiddleware,
        secret_key=resolved_settings.admin_secret_key,
        session_cookie="spark_admin_oauth",
        max_age=600,
        same_site="lax",
        https_only=resolved_settings.secure_cookies,
    )

    @app.middleware("http")
    async def security_headers(request: Request, call_next):
        response = await call_next(request)
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; script-src 'self'; style-src 'self'; "
            "img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'"
        )
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        if resolved_settings.secure_cookies:
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        return response

    @app.get("/health")
    @app.get("/health/live")
    async def health() -> dict[str, str]:
        return {"status": "ok", "service": "spark-admin"}

    @app.get("/health/ready")
    async def readiness(
        usage_repository: UsageEventRepository = Depends(_repository),
    ) -> dict[str, str]:
        if not _FRONTEND_DIST.exists():
            raise HTTPException(status_code=503, detail="frontend_build_unavailable")
        try:
            await usage_repository.ping()
        except Exception as exc:
            print(f"⚠️ Admin readiness check failed: {type(exc).__name__}")
            raise HTTPException(status_code=503, detail="database_unavailable") from None
        return {"status": "ready", "service": "spark-admin"}

    @app.get("/auth/login")
    async def login(request: Request):
        if not resolved_settings.oauth_configured:
            raise HTTPException(status_code=503, detail="google_oauth_not_configured")
        redirect_uri = f"{resolved_settings.admin_base_url}/auth/callback"
        return await request.app.state.oauth.google.authorize_redirect(request, redirect_uri)

    @app.get("/auth/callback")
    async def callback(request: Request):
        if not resolved_settings.oauth_configured:
            return RedirectResponse(url="/?auth_error=configuration", status_code=303)
        try:
            token = await request.app.state.oauth.google.authorize_access_token(request)
            user_info = token.get("userinfo") or {}
            email = normalize_email(str(user_info.get("email") or ""))
            verified = user_info.get("email_verified") is True
            if not verified or not is_allowed_admin(email, resolved_settings):
                return RedirectResponse(url="/?auth_error=forbidden", status_code=303)
            admin_token = create_admin_token(
                email=email,
                name=str(user_info.get("name") or "")[:160],
                settings=resolved_settings,
            )
        except Exception as exc:
            print(f"⚠️ Administrator OAuth callback failed: {type(exc).__name__}")
            return RedirectResponse(url="/?auth_error=oauth", status_code=303)

        response = RedirectResponse(url="/", status_code=303)
        response.set_cookie(
            _ADMIN_COOKIE,
            admin_token,
            max_age=12 * 60 * 60,
            httponly=True,
            secure=resolved_settings.secure_cookies,
            samesite="lax",
            path="/",
        )
        return response

    @app.get("/api/auth/status", response_model=AuthStatus)
    async def auth_status(request: Request) -> AuthStatus:
        if resolved_public_access:
            return AuthStatus(
                authenticated=False,
                oauth_configured=resolved_settings.oauth_configured,
                public_access=True,
            )
        token = request.cookies.get(_ADMIN_COOKIE)
        payload = decode_admin_token(token, resolved_settings) if token else None
        if payload is None:
            return AuthStatus(
                authenticated=False,
                oauth_configured=resolved_settings.oauth_configured,
                public_access=False,
            )
        return AuthStatus(
            authenticated=True,
            oauth_configured=resolved_settings.oauth_configured,
            public_access=False,
            admin=AdminIdentity(
                email=str(payload["sub"]),
                name=str(payload.get("name") or ""),
            ),
        )

    @app.post("/api/auth/logout", status_code=204)
    async def logout() -> Response:
        response = Response(status_code=204)
        response.delete_cookie(
            _ADMIN_COOKIE,
            path="/",
            secure=resolved_settings.secure_cookies,
            httponly=True,
            samesite="lax",
        )
        return response

    async def usage_access(request: Request) -> dict[str, Any]:
        if resolved_public_access:
            return {"role": "public_preview"}
        return await admin_required(request)

    @app.get("/api/ai-usage/summary", response_model=UsageSummary)
    async def usage_summary(
        _: dict[str, Any] = Depends(usage_access),
        days: int = Query(default=30, ge=1, le=365),
        actor_id: Optional[str] = Query(default=None, max_length=120),
        endpoint: Optional[str] = Query(default=None, max_length=240),
        usage_repository: UsageEventRepository = Depends(_repository),
    ) -> UsageSummary:
        end = datetime.now(timezone.utc) + timedelta(seconds=1)
        start = end - timedelta(days=days)
        try:
            events, pricing = await asyncio.gather(
                usage_repository.fetch_events(
                    start=start,
                    end=end,
                    actor_id=actor_id,
                    endpoint=endpoint,
                ),
                usage_repository.fetch_pricing(at=end),
            )
        except Exception as exc:
            print(f"⚠️ Admin usage report query failed: {type(exc).__name__}")
            raise HTTPException(status_code=503, detail="usage_data_unavailable") from None
        return build_usage_summary(
            events=events,
            days=days,
            start=start,
            end=end,
            actor_id=actor_id,
            endpoint=endpoint,
            pricing=pricing,
            access_mode="public_preview" if resolved_public_access else "authenticated_admin",
        )

    if _FRONTEND_DIST.exists():
        app.mount("/", StaticFiles(directory=str(_FRONTEND_DIST), html=True), name="admin-frontend")
    else:
        @app.get("/")
        async def frontend_missing() -> JSONResponse:
            return JSONResponse(
                status_code=503,
                content={"error": "Admin frontend build is missing"},
            )

    return app


app = create_app()
