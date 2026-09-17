"""Ministry of Education OIDC sign-in endpoints.

The browser leaves for the Ministry at `/login` and comes back at `/callback`;
between those two requests the only thing we keep is the signed transaction
cookie. On success this issues the same `spark_session` cookie password login
issues, so every downstream guard, route and beacon is unchanged.
"""

from __future__ import annotations

import os
import uuid
from typing import Any, Optional

from fastapi import APIRouter, Request, Response
from fastapi.responses import RedirectResponse

from app.auth.dependencies import COOKIE_NAME
from app.auth.moe import claims as moe_claims
from app.auth.moe import client as moe_client
from app.auth.moe import config as moe_config
from app.auth.moe import provisioning, verify
from app.auth.moe import state as oidc_state
from app.auth.moe.client import OidcError
from app.auth.repository import touch_last_login
from app.auth.tokens import TOKEN_LIFETIME, create_session_token
from app.core.env import password_login_allowed

router = APIRouter(prefix="/api/auth", tags=["auth"])

_NO_STORE = {"Cache-Control": "private, no-store"}


def _cookie_is_secure() -> bool:
    public_url = os.environ.get("PUBLIC_APP_URL") or os.environ.get("FRONTEND_URL") or ""
    return public_url.startswith("https://")


def _failure(reason: str) -> RedirectResponse:
    """Back to the landing page with a code the UI can translate.

    The reason is a fixed vocabulary, never provider text: an error page is the
    one place an attacker gets to read our side of a failed exchange.
    """
    response = RedirectResponse(url=f"/?auth_error={reason}", status_code=303)
    response.delete_cookie(oidc_state.TX_COOKIE_NAME, path="/")
    response.headers.update(_NO_STORE)
    return response


def _home_for(roles: list[str]) -> str:
    if "teacher" in roles:
        return "/teacher"
    if "admin" in roles:
        return "/admin"
    return "/student-dashboard"


@router.get("/providers")
async def providers() -> dict[str, Any]:
    """What the login screen may offer. The UI renders nothing it is not told
    about, so turning a method off here removes it from the screen too."""
    return {
        "password": password_login_allowed(),
        "moe": moe_config.is_enabled(),
    }


@router.get("/moe/login")
async def moe_login(return_to: Optional[str] = None) -> Response:
    if not moe_config.is_enabled():
        return _failure("sso_disabled")
    missing = moe_config.verify_configuration()
    if missing:
        print(f"⚠️ MoE OIDC misconfigured: {missing} is not set")
        return _failure("sso_unavailable")

    transaction = oidc_state.create_transaction(return_to=return_to)
    try:
        url = await moe_client.build_authorization_url(
            state=transaction["state"],
            nonce=transaction["nonce"],
            challenge=transaction["code_challenge"],
        )
    except Exception:
        return _failure("sso_unavailable")

    response = RedirectResponse(url=url, status_code=303)
    response.set_cookie(
        oidc_state.TX_COOKIE_NAME,
        oidc_state.encode_transaction(transaction),
        httponly=True,
        # `lax` and not `strict`: the callback arrives as a top-level navigation
        # from the Ministry's domain, and `strict` would withhold the cookie.
        samesite="lax",
        secure=_cookie_is_secure(),
        max_age=int(oidc_state.TX_LIFETIME.total_seconds()),
        path="/",
    )
    response.headers.update(_NO_STORE)
    return response


@router.get("/moe/callback")
async def moe_callback(
    request: Request,
    code: Optional[str] = None,
    state: Optional[str] = None,
    error: Optional[str] = None,
) -> Response:
    return await complete_login(request, code=code, state=state, error=error)


async def complete_login(
    request: Request,
    *,
    code: Optional[str] = None,
    state: Optional[str] = None,
    error: Optional[str] = None,
) -> Response:
    """Turn an authorization code into a session.

    Lives apart from the route because the Ministry may return the browser to
    the site root instead of the dedicated path (see `app.auth.moe.redirect`),
    and both entry points must behave identically.
    """
    if not moe_config.is_enabled():
        return _failure("sso_disabled")
    if error:
        print(f"⚠️ MoE authorization returned an error: {error}")
        return _failure("sso_denied")
    if not code or not state:
        return _failure("bad_callback")

    transaction = oidc_state.decode_transaction(
        request.cookies.get(oidc_state.TX_COOKIE_NAME)
    )
    if transaction is None:
        return _failure("login_expired")
    if state != transaction["state"]:
        return _failure("state_mismatch")

    try:
        tokens = await moe_client.exchange_code(
            code=code, code_verifier=transaction["cv"]
        )
        id_claims = await verify.verify_id_token(
            tokens["id_token"], nonce=transaction["nonce"]
        )
        userinfo = await moe_client.fetch_userinfo(tokens.get("access_token") or "")
        identity = moe_claims.build_identity(
            id_claims, userinfo, granted_scopes=tokens.get("scope") or moe_config.scopes()
        )
    except OidcError as exc:
        return _failure(exc.code)
    except ValueError as exc:
        return _failure(str(exc) or "bad_claims")
    except Exception as exc:
        print(f"⚠️ MoE callback failed: {type(exc).__name__}")
        return _failure("sso_failed")

    try:
        user = await provisioning.provision(identity)
    except Exception as exc:
        print(f"⚠️ MoE provisioning failed: {type(exc).__name__}")
        return _failure("provisioning_failed")

    user_id = user["_id"]
    roles = list(user.get("roles") or [])
    moe_session_id = str(uuid.uuid4())
    session_token = create_session_token(
        user_id=user_id,
        username=user.get("username") or user_id,
        roles=roles,
        session_id=moe_session_id,
    )

    destination = transaction.get("rt") or "/"
    if destination == "/":
        destination = _home_for(roles)
    response = RedirectResponse(url=destination, status_code=303)
    response.set_cookie(
        COOKIE_NAME,
        session_token,
        httponly=True,
        samesite="lax",
        secure=_cookie_is_secure(),
        max_age=int(TOKEN_LIFETIME.total_seconds()),
        path="/",
    )
    response.delete_cookie(oidc_state.TX_COOKIE_NAME, path="/")
    response.headers.update(_NO_STORE)

    await touch_last_login(user_id)
    # The registry closes any session this user still had open (a re-login
    # ends the previous visit), records the new one and reports `enter`.
    from app.auth.device import device_from_request
    from app.services.lrs import session_registry

    await session_registry.open(
        user_id, moe_session_id, roles=roles, device=device_from_request(request)
    )
    return response
