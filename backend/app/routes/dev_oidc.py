"""In-process OpenID provider for development.

The ministry issues connection details only after the supplier form is
approved, so without this the whole sign-in path would be unbuildable and
undemoable until then. It speaks the same protocol and emits the same type-3
claim shape, which means **no production code branches on it** — only
`MOE_OIDC_DISCOVERY_URL` changes when the real endpoints arrive.

Mounted only when `MOE_OIDC_MOCK=true`, and `config.mock_enabled()` refuses
that flag outright in production. The signing key is generated per process and
never persisted: a token minted by one dev run cannot be replayed against the
next, and there is no key material in the repository to leak.
"""

from __future__ import annotations

import base64
import html
import os
import secrets
import time
from typing import Any, Optional

import jwt
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import APIRouter, Form
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse

from app.auth.moe import config
from app.auth.moe.client import pkce_challenge

router = APIRouter(prefix="/dev-idp", tags=["dev"])

_KEY_ID = "dev-idp-key"
_CODE_TTL_SECONDS = 300

_private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)

# Pending authorizations (browser is on the picker) and issued codes.
_requests: dict[str, dict[str, Any]] = {}
_codes: dict[str, dict[str, Any]] = {}


def _base_url() -> str:
    """Fixed rather than derived from the request.

    Discovery is fetched by this same process over loopback while the browser
    arrives from the Vite origin; deriving the base per request would produce
    two different issuers for one login and fail `iss` validation.
    """
    return (os.environ.get("MOE_OIDC_MOCK_BASE_URL") or "http://127.0.0.1:8720").rstrip("/")


# Ministry type-3 claim shapes, one per scenario the connection guidelines and
# the test appendix (§11.4) require us to handle.
PERSONAS: dict[str, dict[str, Any]] = {
    "student": {
        "label": "תלמיד — כיתה ו'2, מוסד 270041",
        "claims": {
            "exidentifier": "1003106405",
            "givenname": "יאיר",
            "surname": "כהן",
            "displayname": "יאיר כהן",
            "isstudent": "Yes",
            "studentmosad": "270041",
            "studentkita": "6",
            "studentmakbila": "2",
            "IshurHorim": "13",
        },
    },
    "student_multi": {
        "label": "תלמיד רב־מוסדי — 270041 ו־112409",
        "claims": {
            "exidentifier": "1003106406",
            "givenname": "נור",
            "surname": "עבד",
            "displayname": "נור עבד",
            "isstudent": "Yes",
            "studentmosad": "270041",
            "studentkita": "6",
            "studentmakbila": "2",
            "shibutznosaf": "3[112409:6,1]",
            "IshurHorim": "11",
        },
    },
    "teacher": {
        "label": "עובד הוראה — שני מוסדות",
        "claims": {
            "exidentifier": "1003106407",
            "givenname": "רונית",
            "surname": "לוי",
            "displayname": "רונית לוי",
            "isstudent": "No",
            "orgrolessimple": "667,1",
            "orgrolecomplex": "667[mosad:189084],1[mosad:390153]",
            "orgrolesyeshuyot": "189084,390153",
        },
    },
    "ict": {
        "label": "מדריך תקשוב במוסד (795)",
        "claims": {
            "exidentifier": "1003106408",
            "givenname": "עומר",
            "surname": "ברק",
            "displayname": "עומר ברק",
            "isstudent": "No",
            "orgrolessimple": "795",
            "orgrolecomplex": "795[mosad:110110]",
            "orgrolesyeshuyot": "110110",
        },
    },
    "unauthorized": {
        "label": "מזדהה בהצלחה, ללא תפקיד במערכת",
        "claims": {
            "exidentifier": "1003106409",
            "givenname": "דנה",
            "surname": "שגב",
            "displayname": "דנה שגב",
            "isstudent": "No",
        },
    },
}


def _b64(value: int) -> str:
    raw = value.to_bytes((value.bit_length() + 7) // 8, "big")
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _prune() -> None:
    now = time.time()
    for store in (_requests, _codes):
        for key in [k for k, row in store.items() if row["expires_ts"] <= now]:
            store.pop(key, None)


@router.get("/.well-known/openid-configuration")
async def discovery_document() -> JSONResponse:
    base = _base_url()
    return JSONResponse({
        "issuer": base,
        "authorization_endpoint": f"{base}/dev-idp/authorize",
        "token_endpoint": f"{base}/dev-idp/token",
        "jwks_uri": f"{base}/dev-idp/jwks.json",
        "userinfo_endpoint": f"{base}/dev-idp/userinfo",
        "end_session_endpoint": f"{base}/dev-idp/logout",
        "response_types_supported": ["code"],
        "grant_types_supported": ["authorization_code"],
        "id_token_signing_alg_values_supported": ["RS256"],
        "code_challenge_methods_supported": ["S256"],
        "scopes_supported": ["openid", "profile"],
    })


@router.get("/jwks.json")
async def jwks() -> JSONResponse:
    numbers = _private_key.public_key().public_numbers()
    return JSONResponse({"keys": [{
        "kty": "RSA",
        "use": "sig",
        "alg": "RS256",
        "kid": _KEY_ID,
        "n": _b64(numbers.n),
        "e": _b64(numbers.e),
    }]})


@router.get("/authorize")
async def authorize(
    redirect_uri: str,
    state: str,
    nonce: str = "",
    code_challenge: str = "",
    code_challenge_method: str = "",
    client_id: str = "",
    scope: str = "",
    response_type: str = "code",
) -> HTMLResponse:
    """Stand-in for the ministry password page: pick who is signing in."""
    _prune()
    request_id = secrets.token_urlsafe(16)
    _requests[request_id] = {
        "redirect_uri": redirect_uri,
        "state": state,
        "nonce": nonce,
        "code_challenge": code_challenge,
        "expires_ts": time.time() + _CODE_TTL_SECONDS,
    }
    buttons = "".join(
        f'<li><a href="/dev-idp/authorize/pick?req={html.escape(request_id)}'
        f'&persona={html.escape(key)}">{html.escape(persona["label"])}</a></li>'
        for key, persona in PERSONAS.items()
    )
    return HTMLResponse(
        "<!doctype html><html lang='he' dir='rtl'><meta charset='utf-8'>"
        "<title>Dev IdP</title>"
        "<style>body{font-family:system-ui;margin:3rem auto;max-width:36rem}"
        "li{margin:.6rem 0}a{font-size:1.05rem}</style>"
        "<h1>ספק זהויות לפיתוח</h1>"
        "<p>מדמה את ההזדהות האחידה של משרד החינוך. לא לשימוש בייצור.</p>"
        f"<ul>{buttons}</ul></html>"
    )


@router.get("/authorize/pick")
async def authorize_pick(req: str, persona: str) -> RedirectResponse:
    _prune()
    pending = _requests.pop(req, None)
    if pending is None or persona not in PERSONAS:
        return RedirectResponse("/auth/error?reason=provider_error", status_code=302)

    code = secrets.token_urlsafe(24)
    _codes[code] = {
        "persona": persona,
        "nonce": pending["nonce"],
        "code_challenge": pending["code_challenge"],
        "expires_ts": time.time() + _CODE_TTL_SECONDS,
    }
    separator = "&" if "?" in pending["redirect_uri"] else "?"
    return RedirectResponse(
        f"{pending['redirect_uri']}{separator}code={code}&state={pending['state']}",
        status_code=302,
    )


@router.post("/token")
async def token(
    grant_type: str = Form(""),
    code: str = Form(""),
    redirect_uri: str = Form(""),
    client_id: str = Form(""),
    client_secret: str = Form(""),
    code_verifier: str = Form(""),
) -> JSONResponse:
    _prune()
    row = _codes.pop(code, None)
    if grant_type != "authorization_code" or row is None:
        return JSONResponse({"error": "invalid_grant"}, status_code=400)

    if row["code_challenge"]:
        # PKCE is verified here too, so the real flow is exercised rather than
        # merely accepted — a broken verifier must fail in dev, not in staging.
        if pkce_challenge(code_verifier) != row["code_challenge"]:
            return JSONResponse({"error": "invalid_grant"}, status_code=400)

    now = int(time.time())
    base = _base_url()
    claims = {
        **PERSONAS[row["persona"]]["claims"],
        "iss": base,
        "aud": client_id or config.client_id(),
        "sub": PERSONAS[row["persona"]]["claims"]["exidentifier"],
        "iat": now,
        "exp": now + 600,
        "nonce": row["nonce"],
    }
    id_token = jwt.encode(
        claims, _private_key, algorithm="RS256", headers={"kid": _KEY_ID}
    )
    return JSONResponse({
        "access_token": secrets.token_urlsafe(24),
        "token_type": "Bearer",
        "expires_in": 600,
        "id_token": id_token,
    })


@router.get("/userinfo")
async def userinfo() -> JSONResponse:
    """Empty on purpose: the mock puts everything in the id_token, so the
    merge in the callback is exercised without hiding a missing claim."""
    return JSONResponse({})


@router.get("/logout")
async def logout(logoutURL: Optional[str] = None, post_logout_redirect_uri: Optional[str] = None):
    target = post_logout_redirect_uri or logoutURL or "/"
    return RedirectResponse(target if target.startswith("http") or target.startswith("/") else "/",
                            status_code=302)
