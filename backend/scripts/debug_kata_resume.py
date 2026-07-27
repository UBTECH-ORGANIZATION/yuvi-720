"""Debug: why the Kata iframe restarts on refresh (720 §6 resume).

Checks the three things that decide whether content can resume:
  1. Kata keys the attempt deterministically (same registrationId per
     student+component) — if so, Kata's side supports resume.
  2. The reporting endpoint we hand the content is PUBLIC (reachable from the
     content origin), not localhost.
  3. Our LRS implements the xAPI **State API** (PUT/GET .../activities/state) —
     the standard way content saves/restores "where am I / answers so far".
     Without it, the content's save/load calls 404 and it restarts at Q1.

    python -m scripts.debug_kata_resume
"""
from __future__ import annotations

import asyncio
import json
import os
import urllib.parse
import warnings

warnings.filterwarnings("ignore")

from app.services import events, kata_client

COMPONENT = "methodica-science-mass-measure-01-01"


async def check_registration_stable() -> None:
    print("① Kata attempt key (registration) stability")
    try:
        a = await kata_client.create_launch_context(
            component_id=COMPONENT, student_id="debug_resume_probe",
            platform_url="https://spark.yuvilab.ai",
            lrs_endpoint="https://spark.yuvilab.ai/api/xapi/tok/", lrs_auth="Basic tok",
        )
        b = await kata_client.create_launch_context(
            component_id=COMPONENT, student_id="debug_resume_probe",
            platform_url="https://spark.yuvilab.ai",
            lrs_endpoint="https://spark.yuvilab.ai/api/xapi/tok/", lrs_auth="Basic tok",
        )
        same = a.get("registration_id") == b.get("registration_id")
        print(f"   registrationId stable across launches: {same}  ({a.get('registration_id')})")
        print("   → Kata CAN resume this attempt." if same else
              "   → Kata mints a new attempt each launch (cannot resume).")
    except Exception as exc:
        print(f"   launcher probe failed: {type(exc).__name__}: {exc}")


def check_endpoint_public() -> None:
    print("\n② Statement-relay endpoint reachability (Bug 2: events/current_state)")
    public = os.environ.get("PUBLIC_APP_URL")
    launch = events.mint_launch(
        "debug_resume_probe", component_id=COMPONENT, source="kata",
        reporting_base_url=public,  # None -> relative /api/xapi/... (localhost in dev)
    )
    endpoint = launch["slxapi"]["endpoint"]
    print(f"   PUBLIC_APP_URL           : {public!r}")
    print(f"   Kata relays statements to: {endpoint[:70]}")
    reachable = bool(public) and public.startswith("https://")
    print("   → Endpoint is PUBLIC — Kata's relay can deliver statements." if reachable else
          "   → Endpoint is NOT public (relative/localhost). Kata's server cannot "
          "POST statements to it → no events reach the backend → current_state "
          "never advances → the coach is stuck on the first question. "
          "Set PUBLIC_APP_URL to a public tunnel (e.g. cloudflared).")


async def check_reporting_target() -> None:
    print("\n③ Who owns the resume (xAPI State API)?")
    try:
        ctx = await kata_client.create_launch_context(
            component_id=COMPONENT, student_id="debug_resume_probe",
            platform_url="https://spark.yuvilab.ai",
            lrs_endpoint="https://tunnel.example/api/xapi/tok/", lrs_auth="Basic tok",
        )
        params = urllib.parse.parse_qs(urllib.parse.urlparse(ctx["launch_url"]).query)
        slx = json.loads(params.get("slxapi", ["{}"])[0])
        endpoint = slx.get("endpoint", "")
        print(f"   content reports its xAPI to: {endpoint}")
        ours = "/api/xapi/" in endpoint and "kata.cet.ac.il" not in endpoint
        print("   → Content reports to OUR LRS — we own State API/resume." if ours else
              "   → Content reports to KATA's LRS. Statements are relayed to us, "
              "but the State API (save/restore progress, 720 §6) is KATA's. Our "
              "own State API would be dead code. Resume restarting = Kata-side "
              "gap; we already pass a stable studentId + Kata mints a stable "
              "registration, so the resume identity is correct on our side.")
    except Exception as exc:
        print(f"   launcher probe failed: {type(exc).__name__}: {exc}")


async def main() -> None:
    await check_registration_stable()
    check_endpoint_public()
    await check_reporting_target()


if __name__ == "__main__":
    asyncio.run(main())
