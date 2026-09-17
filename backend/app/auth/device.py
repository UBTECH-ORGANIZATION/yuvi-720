"""Device extensions for the MoE 720 session `enter` statement.

Shared by every sign-in path (password login, the ministry's OIDC callback)
and by the session registry when it reopens a session after a timeout.
"""

from __future__ import annotations

import os
import re
from typing import Optional

from fastapi import Request


def _ua_version(user_agent: str, *patterns: str) -> Optional[str]:
    """First version number one of `patterns` captures in the User-Agent."""
    for pattern in patterns:
        match = re.search(pattern, user_agent, re.IGNORECASE)
        if match:
            return match.group(1).replace("_", ".").strip()
    return None


def device_from_request(request: Request) -> dict[str, str]:
    """Best-effort device extensions for the MoE session `enter` statement.

    The 720 test script (TC-SES-01/07) asks for seven: deviceType, platform,
    operatingSystem, osVersion, browser, browserVersion, applicationVersion.
    Everything but the last is read off the User-Agent; a version that header
    does not disclose is omitted rather than guessed.
    """
    ua = request.headers.get("user-agent", "")
    lowered = ua.lower()
    if "ipad" in lowered or "tablet" in lowered:
        device_type = "Tablet"
    elif "mobile" in lowered or "iphone" in lowered or "android" in lowered:
        device_type = "Mobile"
    else:
        device_type = "Desktop"
    if "windows" in lowered:
        operating_system = "Windows"
    elif "android" in lowered:
        # Before macOS and Linux: an Android UA says "Linux", and an iPhone UA
        # says "like Mac OS X" — checked in this order, both used to be misread.
        operating_system = "Android"
    elif "iphone" in lowered or "ipad" in lowered or "ipod" in lowered:
        operating_system = "iOS"
    elif "mac os" in lowered or "macintosh" in lowered:
        operating_system = "macOS"
    elif "linux" in lowered:
        operating_system = "Linux"
    else:
        operating_system = "Other"
    if "edg/" in lowered:
        browser = "Edge"
        browser_version = _ua_version(ua, r"Edg/([\d.]+)")
    elif "chrome/" in lowered:
        browser = "Chrome"
        browser_version = _ua_version(ua, r"Chrome/([\d.]+)")
    elif "firefox/" in lowered:
        browser = "Firefox"
        browser_version = _ua_version(ua, r"Firefox/([\d.]+)")
    elif "safari/" in lowered:
        browser = "Safari"
        browser_version = _ua_version(ua, r"Version/([\d.]+)")
    else:
        browser = "Other"
        browser_version = None
    os_version = _ua_version(
        ua,
        r"Windows NT ([\d.]+)",
        r"Mac OS X ([\d_.]+)",
        r"(?:iPhone|CPU) OS ([\d_.]+)",
        r"Android ([\d.]+)",
    )
    device = {
        "deviceType": device_type,
        "platform": "Web",
        "operatingSystem": operating_system,
        "browser": browser,
    }
    # The build the learner is actually running. Absent everywhere (no deploy
    # stamp, no git) it is left out — a made-up version is worse than none.
    for key, value in (
        ("osVersion", os_version),
        ("browserVersion", browser_version),
        ("applicationVersion", application_version()),
    ):
        if value:
            device[key] = value
    return device


_git_version: Optional[str] = None


def application_version() -> str:
    """The `applicationVersion` extension of `session enter` (spec v1.1).

    `APP_VERSION` when someone sets it explicitly; else the release the deploy
    pipeline stamps on the image (`SPARK_RELEASE` = the commit sha — the same
    value telemetry reports, so a statement and a trace name one build); else
    the working tree's short sha for a local run. Deployed slots never set
    `APP_VERSION`, which is how the extension went missing in the 07/09 run.
    """
    global _git_version
    explicit = os.getenv("APP_VERSION", "").strip()
    if explicit:
        return explicit[:40]
    for key in ("SPARK_RELEASE", "IMAGE_TAG", "GIT_SHA", "GITHUB_SHA"):
        value = os.getenv(key, "").strip()
        if value:
            return value[:12]
    if _git_version is None:
        try:
            import subprocess

            _git_version = subprocess.run(
                ["git", "rev-parse", "--short", "HEAD"],
                capture_output=True, text=True, timeout=2,
                cwd=os.path.dirname(os.path.abspath(__file__)),
            ).stdout.strip()
        except Exception:
            _git_version = ""
    return _git_version
