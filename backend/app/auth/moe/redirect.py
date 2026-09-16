"""Where the Ministry sends the browser back after sign-in.

The Ministry matches redirect URIs as exact strings, and the dev client is
registered with the bare origin only — a request for
`https://dev.spark.yuvilab.ai/api/auth/moe/callback` is rejected with
`invalid_grant: Invalid redirect_uri`. `MOE_OIDC_REDIRECT_URI` pins the value
we send to whatever is actually registered, so the callback can land on the
site root until the dedicated path is registered. Clearing the variable
restores the dedicated path with no code change.
"""

from __future__ import annotations

import os
from urllib.parse import urlsplit

from app.auth.moe import config


def redirect_uri() -> str:
    override = (os.environ.get("MOE_OIDC_REDIRECT_URI") or "").strip()
    return override or config.redirect_uri()


def is_root_callback() -> bool:
    """True when the Ministry returns the browser to the site root.

    The root route only inspects its query string while this holds, so the
    normal path-based callback never has to share the SPA entry point.
    """
    return urlsplit(redirect_uri()).path in ("", "/")
