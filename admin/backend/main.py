"""Standalone authenticated administration API and static frontend host."""

from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
import asyncio
import csv
import io
import os
from pathlib import Path
import secrets
from typing import Any, Optional

from authlib.integrations.starlette_client import OAuth
from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response
from fastapi.responses import JSONResponse, RedirectResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from starlette.middleware.sessions import SessionMiddleware

from .auth import create_admin_token, decode_admin_token, is_allowed_admin, normalize_email
from .config import Settings
from .database import UsageEventRepository
from .leads import LEAD_STATUSES, LeadRepository
from .support import TICKET_STATUSES, SupportRepository
from .telemetry import configure_telemetry
from .usage_report import UsageSummary, build_usage_summary


_ADMIN_COOKIE = "spark_admin_token"
_FRONTEND_DIST = Path(__file__).resolve().parents[1] / "frontend" / "dist"
_LEAD_EXPORT_COLUMNS = (
    "lead_id",
    "created_at",
    "status",
    "full_name",
    "role",
    "organization",
    "city",
    "phone",
    "email",
    "grades",
    "message",
    "source",
    "notes",
    "updated_at",
    "updated_by",
)
_TICKET_EXPORT_COLUMNS = (
    "ticket_id",
    "created_at",
    "status",
    "severity",
    "category",
    "source",
    "reporter_type",
    "reporter_id",
    "reporter_name",
    "contact_email",
    "title",
    "description",
    "admin_notes",
    "updated_at",
    "updated_by",
)


class AdminIdentity(BaseModel):
    email: str
    name: str


class Lead(BaseModel):
    lead_id: str
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    status: str = "new"
    notes: str = ""
    full_name: str = ""
    role: str = ""
    organization: str = ""
    city: str = ""
    phone: str = ""
    email: str = ""
    grades: str = ""
    message: str = ""
    source: str = ""
    updated_by: Optional[str] = None


class LeadBoard(BaseModel):
    leads: list[Lead]
    statuses: list[str]
    sources: list[str]
    counts_by_status: dict[str, int]
    total: int


class LeadUpdate(BaseModel):
    status: Optional[str] = Field(default=None, max_length=40)
    notes: Optional[str] = Field(default=None, max_length=2000)


class SupportTicket(BaseModel):
    ticket_id: str
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    status: str = "new"
    admin_notes: str = ""
    updated_by: Optional[str] = None
    source: str = ""
    reporter_type: str = ""
    reporter_id: Optional[str] = None
    reporter_name: str = ""
    contact_email: str = ""
    category: str = ""
    severity: str = ""
    title: str = ""
    description: str = ""
    context: dict[str, Any] = Field(default_factory=dict)
    attachments: list[dict[str, Any]] = Field(default_factory=list)


class SupportBoard(BaseModel):
    tickets: list[SupportTicket]
    statuses: list[str]
    counts_by_status: dict[str, int]
    total: int


class SupportTicketUpdate(BaseModel):
    status: Optional[str] = Field(default=None, max_length=40)
    admin_notes: Optional[str] = Field(default=None, max_length=4000)


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


def _lead_repository(request: Request) -> LeadRepository:
    return request.app.state.lead_repository


def _support_repository(request: Request) -> SupportRepository:
    return request.app.state.support_repository


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
    lead_repository = LeadRepository(resolved_settings)
    support_repository = SupportRepository(resolved_settings)

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
        lead_repository.close()
        support_repository.close()

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
    app.state.lead_repository = lead_repository
    app.state.support_repository = support_repository
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

    def _lead_window(days: Optional[int]) -> tuple[Optional[datetime], Optional[datetime]]:
        if days is None:
            return None, None
        end = datetime.now(timezone.utc) + timedelta(seconds=1)
        return end - timedelta(days=days), end

    async def _query_leads(
        repository: LeadRepository,
        *,
        days: Optional[int],
        status: Optional[str],
        source: Optional[str],
        search: Optional[str],
        limit: int,
    ) -> list[dict[str, Any]]:
        if status and status not in LEAD_STATUSES:
            raise HTTPException(status_code=422, detail="unknown_lead_status")
        start, end = _lead_window(days)
        try:
            return await repository.fetch_leads(
                start=start,
                end=end,
                status=status,
                source=source,
                search=search,
                limit=limit,
            )
        except Exception as exc:
            print(f"⚠️ Admin lead query failed: {type(exc).__name__}")
            raise HTTPException(status_code=503, detail="lead_data_unavailable") from None

    @app.get("/api/leads", response_model=LeadBoard)
    async def list_leads(
        _: dict[str, Any] = Depends(admin_required),
        days: Optional[int] = Query(default=None, ge=1, le=730),
        status: Optional[str] = Query(default=None, max_length=40),
        source: Optional[str] = Query(default=None, max_length=60),
        search: Optional[str] = Query(default=None, max_length=120),
        limit: int = Query(default=500, ge=1, le=2000),
        lead_repository: LeadRepository = Depends(_lead_repository),
    ) -> LeadBoard:
        leads = await _query_leads(
            lead_repository,
            days=days,
            status=status,
            source=source,
            search=search,
            limit=limit,
        )
        try:
            sources = await lead_repository.list_sources()
        except Exception:
            sources = sorted({str(lead.get("source") or "") for lead in leads} - {""})
        counts = {value: 0 for value in LEAD_STATUSES}
        for lead in leads:
            key = str(lead.get("status") or "new")
            counts[key] = counts.get(key, 0) + 1
        return LeadBoard(
            leads=[Lead(**lead) for lead in leads],
            statuses=list(LEAD_STATUSES),
            sources=sources,
            counts_by_status=counts,
            total=len(leads),
        )

    @app.get("/api/leads/export")
    async def export_leads(
        _: dict[str, Any] = Depends(admin_required),
        days: Optional[int] = Query(default=None, ge=1, le=730),
        status: Optional[str] = Query(default=None, max_length=40),
        source: Optional[str] = Query(default=None, max_length=60),
        search: Optional[str] = Query(default=None, max_length=120),
        limit: int = Query(default=2000, ge=1, le=5000),
        lead_repository: LeadRepository = Depends(_lead_repository),
    ) -> StreamingResponse:
        leads = await _query_leads(
            lead_repository,
            days=days,
            status=status,
            source=source,
            search=search,
            limit=limit,
        )
        buffer = io.StringIO()
        buffer.write("\ufeff")  # BOM so Excel opens the Hebrew export as UTF-8
        writer = csv.DictWriter(
            buffer,
            fieldnames=list(_LEAD_EXPORT_COLUMNS),
            extrasaction="ignore",
            lineterminator="\r\n",
        )
        writer.writeheader()
        for lead in leads:
            row = {column: lead.get(column, "") for column in _LEAD_EXPORT_COLUMNS}
            for column in ("created_at", "updated_at"):
                value = row[column]
                row[column] = value.isoformat() if isinstance(value, datetime) else (value or "")
            writer.writerow(row)
        buffer.seek(0)
        stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M")
        return StreamingResponse(
            iter([buffer.getvalue()]),
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="spark-leads-{stamp}.csv"'},
        )

    @app.get("/api/leads/{lead_id}", response_model=Lead)
    async def get_lead(
        lead_id: str,
        _: dict[str, Any] = Depends(admin_required),
        lead_repository: LeadRepository = Depends(_lead_repository),
    ) -> Lead:
        try:
            lead = await lead_repository.fetch_lead(lead_id)
        except Exception as exc:
            print(f"⚠️ Admin lead read failed: {type(exc).__name__}")
            raise HTTPException(status_code=503, detail="lead_data_unavailable") from None
        if lead is None:
            raise HTTPException(status_code=404, detail="lead_not_found")
        return Lead(**lead)

    @app.patch("/api/leads/{lead_id}", response_model=Lead)
    async def update_lead(
        lead_id: str,
        payload: LeadUpdate,
        admin: dict[str, Any] = Depends(admin_required),
        lead_repository: LeadRepository = Depends(_lead_repository),
    ) -> Lead:
        updates: dict[str, Any] = {}
        if payload.status is not None:
            if payload.status not in LEAD_STATUSES:
                raise HTTPException(status_code=422, detail="unknown_lead_status")
            updates["status"] = payload.status
        if payload.notes is not None:
            updates["notes"] = payload.notes.strip()
        if not updates:
            raise HTTPException(status_code=422, detail="no_lead_changes")
        try:
            lead = await lead_repository.update_lead(
                lead_id,
                updates=updates,
                updated_by=str(admin.get("sub") or "admin"),
                now=datetime.now(timezone.utc),
            )
        except Exception as exc:
            print(f"⚠️ Admin lead update failed: {type(exc).__name__}")
            raise HTTPException(status_code=503, detail="lead_data_unavailable") from None
        if lead is None:
            raise HTTPException(status_code=404, detail="lead_not_found")
        return Lead(**lead)

    async def _query_tickets(
        repository: SupportRepository,
        *,
        days: Optional[int],
        status: Optional[str],
        category: Optional[str],
        severity: Optional[str],
        reporter_type: Optional[str],
        search: Optional[str],
        limit: int,
    ) -> list[dict[str, Any]]:
        if status and status not in TICKET_STATUSES:
            raise HTTPException(status_code=422, detail="unknown_ticket_status")
        start, end = _lead_window(days)
        try:
            return await repository.fetch_tickets(
                start=start,
                end=end,
                status=status,
                category=category,
                severity=severity,
                reporter_type=reporter_type,
                search=search,
                limit=limit,
            )
        except Exception as exc:
            print(f"⚠️ Admin support query failed: {type(exc).__name__}")
            raise HTTPException(status_code=503, detail="support_data_unavailable") from None

    @app.get("/api/support/tickets", response_model=SupportBoard)
    async def list_tickets(
        _: dict[str, Any] = Depends(admin_required),
        days: Optional[int] = Query(default=None, ge=1, le=730),
        status: Optional[str] = Query(default=None, max_length=40),
        category: Optional[str] = Query(default=None, max_length=40),
        severity: Optional[str] = Query(default=None, max_length=40),
        reporter_type: Optional[str] = Query(default=None, max_length=40),
        search: Optional[str] = Query(default=None, max_length=120),
        limit: int = Query(default=500, ge=1, le=2000),
        support_repository: SupportRepository = Depends(_support_repository),
    ) -> SupportBoard:
        tickets = await _query_tickets(
            support_repository,
            days=days,
            status=status,
            category=category,
            severity=severity,
            reporter_type=reporter_type,
            search=search,
            limit=limit,
        )
        counts = {value: 0 for value in TICKET_STATUSES}
        for ticket in tickets:
            key = str(ticket.get("status") or "new")
            counts[key] = counts.get(key, 0) + 1
        return SupportBoard(
            tickets=[SupportTicket(**ticket) for ticket in tickets],
            statuses=list(TICKET_STATUSES),
            counts_by_status=counts,
            total=len(tickets),
        )

    @app.get("/api/support/tickets/export")
    async def export_tickets(
        _: dict[str, Any] = Depends(admin_required),
        days: Optional[int] = Query(default=None, ge=1, le=730),
        status: Optional[str] = Query(default=None, max_length=40),
        category: Optional[str] = Query(default=None, max_length=40),
        severity: Optional[str] = Query(default=None, max_length=40),
        reporter_type: Optional[str] = Query(default=None, max_length=40),
        search: Optional[str] = Query(default=None, max_length=120),
        limit: int = Query(default=2000, ge=1, le=5000),
        support_repository: SupportRepository = Depends(_support_repository),
    ) -> StreamingResponse:
        tickets = await _query_tickets(
            support_repository,
            days=days,
            status=status,
            category=category,
            severity=severity,
            reporter_type=reporter_type,
            search=search,
            limit=limit,
        )
        buffer = io.StringIO()
        buffer.write("\ufeff")  # BOM so Excel opens the Hebrew export as UTF-8
        writer = csv.DictWriter(
            buffer,
            fieldnames=list(_TICKET_EXPORT_COLUMNS),
            extrasaction="ignore",
            lineterminator="\r\n",
        )
        writer.writeheader()
        for ticket in tickets:
            writer.writerow(
                {column: ticket.get(column, "") or "" for column in _TICKET_EXPORT_COLUMNS}
            )
        buffer.seek(0)
        stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M")
        return StreamingResponse(
            iter([buffer.getvalue()]),
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="spark-support-{stamp}.csv"'},
        )

    @app.get("/api/support/tickets/{ticket_id}", response_model=SupportTicket)
    async def get_ticket(
        ticket_id: str,
        _: dict[str, Any] = Depends(admin_required),
        support_repository: SupportRepository = Depends(_support_repository),
    ) -> SupportTicket:
        try:
            ticket = await support_repository.fetch_ticket(ticket_id)
        except Exception as exc:
            print(f"⚠️ Admin support read failed: {type(exc).__name__}")
            raise HTTPException(status_code=503, detail="support_data_unavailable") from None
        if ticket is None:
            raise HTTPException(status_code=404, detail="ticket_not_found")
        return SupportTicket(**ticket)

    @app.patch("/api/support/tickets/{ticket_id}", response_model=SupportTicket)
    async def update_ticket(
        ticket_id: str,
        payload: SupportTicketUpdate,
        admin: dict[str, Any] = Depends(admin_required),
        support_repository: SupportRepository = Depends(_support_repository),
    ) -> SupportTicket:
        updates: dict[str, Any] = {}
        if payload.status is not None:
            if payload.status not in TICKET_STATUSES:
                raise HTTPException(status_code=422, detail="unknown_ticket_status")
            updates["status"] = payload.status
        if payload.admin_notes is not None:
            updates["admin_notes"] = payload.admin_notes.strip()
        if not updates:
            raise HTTPException(status_code=422, detail="no_ticket_changes")
        try:
            ticket = await support_repository.update_ticket(
                ticket_id,
                updates=updates,
                updated_by=str(admin.get("sub") or "admin"),
                now=datetime.now(timezone.utc),
            )
        except Exception as exc:
            print(f"⚠️ Admin support update failed: {type(exc).__name__}")
            raise HTTPException(status_code=503, detail="support_data_unavailable") from None
        if ticket is None:
            raise HTTPException(status_code=404, detail="ticket_not_found")
        return SupportTicket(**ticket)

    if _FRONTEND_DIST.exists():
        app.mount("/", StaticFiles(directory=str(_FRONTEND_DIST), html=True), name="admin-frontend")
    else:
        @app.get("/")
        async def frontend_missing() -> JSONResponse:
            return JSONResponse(
                status_code=503,
                content={"error": "Admin frontend build is missing"},
            )

    configure_telemetry(app, service_name="spark-admin")

    return app


app = create_app()
