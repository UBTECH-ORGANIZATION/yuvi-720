"""Sign-in through the Ministry of Education unified identity (הזדהות אחידה).

Browser-visible flow, so every failure is a redirect to `/auth/error?reason=…`
rather than a JSON body: the person is mid-navigation and has no client code
listening. The reason codes are opaque on purpose — a ministry error message can
name the account it was about.
"""

from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Request, Response
from fastapi.responses import RedirectResponse

from app.auth.moe import claims as moe_claims
from app.auth.moe import client, config, provisioning, transactions
from app.auth.repository import public_user
from app.auth.session import establish_session

router = APIRouter(prefix="/api/auth/moe", tags=["auth"])

ERROR_PATH = "/auth/error"


def _safe_return_to(value: Optional[str]) -> str:
    """Only in-app paths.

    `return_to` is attacker-controllable and is handed straight to a redirect
    after a successful sign-in, which is the textbook open-redirect phishing
    setup. A bare `/…` path, with no scheme-relative `//` and no backslash, is
    the only thing that can be honoured.
    """
    candidate = (value or "").strip()
    if not candidate.startswith("/"):
        return config.post_login_redirect()
    if candidate.startswith("//") or "\\" in candidate:
        return config.post_login_redirect()
    return candidate


def _fail(reason: str) -> RedirectResponse:
    return RedirectResponse(f"{ERROR_PATH}?reason={reason}", status_code=302)


@router.get("/login")
async def moe_login(return_to: str = "/") -> RedirectResponse:
    """Open a login transaction and hand the browser to the ministry."""
    if not config.is_enabled():
        return _fail("not_configured")

    verifier = client.generate_pkce_verifier() if config.use_pkce() else None
    nonce = transactions.new_token()
    try:
        state = await transactions.create(
            nonce=nonce,
            code_verifier=verifier,
            return_to=_safe_return_to(return_to),
        )
        url = await client.build_authorization_url(
            state=state,
            nonce=nonce,
            code_challenge=client.pkce_challenge(verifier) if verifier else None,
        )
    except client.MoeOidcError as exc:
        print(f"⚠️ MoE login could not start: {exc}")
        return _fail("provider_unavailable")
    return RedirectResponse(url, status_code=302)


@router.get("/callback")
async def moe_callback(
    request: Request,
    code: Optional[str] = None,
    state: Optional[str] = None,
    error: Optional[str] = None,
) -> Response:
    """Ministry redirect target: verify, provision, sign in."""
    if error:
        print(f"⚠️ MoE returned an authorization error: {error}")
        return _fail("provider_error")
    if not code or not state:
        return _fail("invalid_request")

    transaction = await transactions.consume(state)
    if transaction is None:
        # Unknown, expired, or already used — a replayed `state` lands here.
        return _fail("expired")

    try:
        tokens = await client.exchange_code(code, transaction.get("code_verifier"))
        verified = await client.verify_id_token(
            tokens["id_token"], nonce=transaction.get("nonce") or ""
        )
    except client.MoeOidcError as exc:
        print(f"⚠️ MoE sign-in rejected: {exc}")
        return _fail("provider_error")

    # The ministry has not confirmed whether the type-3 attributes ride the
    # id_token or userinfo, so both are read. Verified id_token claims win on
    # any collision — userinfo is not signed.
    merged: dict[str, Any] = {}
    access_token = tokens.get("access_token")
    if access_token:
        merged.update(await client.fetch_userinfo(access_token))
    merged.update(verified)

    try:
        profile = moe_claims.parse_profile(merged)
    except moe_claims.ClaimsError as exc:
        print(f"⚠️ MoE token unusable: {exc}")
        return _fail("missing_identity")

    try:
        document = await provisioning.provision(profile)
    except provisioning.NotPermittedError:
        # Authenticated, but holds no role this product serves. The ministry
        # test appendix (§11.4.3) requires an explicit message, not a 403.
        return _fail("no_role")
    except Exception as exc:
        print(f"⚠️ MoE provisioning failed: {type(exc).__name__}")
        return _fail("failed")

    user = public_user(document)
    if user is None:
        return _fail("failed")

    response = RedirectResponse(
        _safe_return_to(transaction.get("return_to")), status_code=302
    )
    await establish_session(request=request, response=response, user=user)
    return response
