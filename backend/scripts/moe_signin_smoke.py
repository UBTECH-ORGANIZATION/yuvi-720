"""Drive the whole ministry sign-in flow against the development IdP.

Not a unit test: it walks the real HTTP path a browser walks — /login → the
IdP's picker → /callback → a live session cookie — for every persona, and
asserts the refusals too. Run it against a backend started with MOE_OIDC_MOCK=1.
"""

from __future__ import annotations

import re
import sys

import httpx

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8721"

PERSONAS = {
    "student": {"roles": ["learner"], "schools": 1},
    "student_multi": {"roles": ["learner"], "schools": 2},
    "teacher": {"roles": ["teacher"], "schools": 2},
    "ict": {"roles": ["teacher"], "schools": 1},
}

failures: list[str] = []


def check(label: str, condition: bool, detail: str = "") -> None:
    print(f"{'✅' if condition else '❌'} {label}{'' if condition else f' — {detail}'}")
    if not condition:
        failures.append(label)


def sign_in(persona: str) -> httpx.Client:
    session = httpx.Client(base_url=BASE, follow_redirects=False, timeout=20)
    start = session.get("/api/auth/moe/login", params={"return_to": "/student-dashboard"})
    assert start.status_code == 302, start.status_code
    picker = session.get(start.headers["location"])
    assert picker.status_code == 200, picker.status_code
    match = re.search(rf'href="([^"]*persona={persona}[^"]*)"', picker.text)
    assert match, f"persona {persona} not offered"
    chosen = session.get(match.group(1).replace("&amp;", "&"))
    assert chosen.status_code == 302, chosen.status_code
    callback = session.get(chosen.headers["location"])
    assert callback.status_code == 302, callback.status_code
    session.headers["x-final-location"] = callback.headers["location"]
    return session


for persona, expected in PERSONAS.items():
    session = sign_in(persona)
    check(f"{persona}: lands in the app",
          session.headers["x-final-location"] == "/student-dashboard",
          session.headers["x-final-location"])
    me = session.get("/api/auth/me").json()
    check(f"{persona}: session established", me.get("authenticated") is True, str(me))
    user = me.get("user") or {}
    check(f"{persona}: roles {expected['roles']}", user.get("roles") == expected["roles"],
          str(user.get("roles")))
    check(f"{persona}: id is opaque", str(user.get("user_id", "")).startswith("moe_"),
          str(user.get("user_id")))
    check(f"{persona}: identity source", user.get("identity_source") == "moe")
    check(f"{persona}: {expected['schools']} school(s)",
          len(user.get("institutions") or []) == expected["schools"],
          str(user.get("institutions")))
    check(f"{persona}: no exidentifier leaves the backend",
          "exidentifier" not in session.get("/api/auth/me").text)

    # Signing in twice must return the same person to the same brain.
    again = sign_in(persona)
    check(f"{persona}: learner id is stable across logins",
          (again.get("/api/auth/me").json().get("user") or {}).get("user_id")
          == user.get("user_id"))

    out = session.post("/api/auth/logout").json()
    check(f"{persona}: logout routes through the ministry",
          bool(out.get("logout_url")), str(out))
    check(f"{persona}: session is gone",
          session.get("/api/auth/me").json().get("authenticated") is False)

# Authenticated, but no role: the ministry test appendix §11.4.3 case.
denied = sign_in("unauthorized")
check("unauthorized: sent to the not-permitted screen",
      denied.headers["x-final-location"] == "/auth/error?reason=no_role",
      denied.headers["x-final-location"])
check("unauthorized: no session was created",
      denied.get("/api/auth/me").json().get("authenticated") is False)

# A replayed callback must not mint a second session.
replay = httpx.Client(base_url=BASE, follow_redirects=False, timeout=20)
start = replay.get("/api/auth/moe/login")
picker = replay.get(start.headers["location"])
link = re.search(r'href="([^"]*persona=student[^"]*)"', picker.text).group(1)
chosen = replay.get(link.replace("&amp;", "&"))
callback_url = chosen.headers["location"]
replay.get(callback_url)
second = replay.get(callback_url)
check("replayed callback is refused",
      second.headers["location"].startswith("/auth/error?reason="),
      second.headers.get("location", ""))

print()
print("FAILURES:", failures if failures else "none")
sys.exit(1 if failures else 0)
