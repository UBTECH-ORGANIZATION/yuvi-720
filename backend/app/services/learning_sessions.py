"""Kata-backed learning-session launches for 720 Feature 1.

A session joins the Kata catalog channel (what may be learned) with the xAPI
channel (what happened). It writes only the current component location to the
Brain; mastery remains exclusively event-derived.

Launch/relay flow (plan §4):
  1. Mint OUR signed launch token → gives a reporting endpoint
     (``{PUBLIC_APP_URL}/api/xapi/{token}/``) + ``Basic {token}`` auth.
  2. Call the Kata launcher, handing it that endpoint as ``lrsEndpoint``/``lrsAuth``
     and ``studentId == launch.lid`` (so the forwarded statement's actor matches
     what our ingest scopes against). Kata returns a ready-to-embed ``launchUrl``.
  3. The learner solves inside the iframe; content reports xAPI to Kata; Kata
     relays each statement to our ingest, which folds it into the Brain and
     forwards to the MoE LRS.
"""

from __future__ import annotations

import os
import time
from typing import Any, Optional
from urllib.parse import urlsplit

from app.brain.repository import apply_brain_updates, get_brain
from app.services import kata_client
from app.services.events import mint_launch
from app.services.learning_progress import project_unit_roadmap
from learner_state import normalize_learner_id  # type: ignore


def _public_base_url(request_base_url: str) -> str:
    configured = os.environ.get("PUBLIC_APP_URL")
    base = (configured or request_base_url).rstrip("/")
    # Kata relays content statements to this base from its own servers. A
    # localhost / non-https base is unreachable from Kata → every statement is
    # silently dropped, so current_state never advances and the coach is stuck
    # on the first question. Make that failure LOUD instead of silent.
    host = base.split("://", 1)[-1].split("/", 1)[0].split(":", 1)[0]
    if not base.startswith("https://") or host in {"localhost", "127.0.0.1", "0.0.0.0"}:
        print(
            f"⚠️ PUBLIC_APP_URL not set to a public https base (using {base!r}). "
            "Kata cannot relay xAPI here — events will NOT reach the backend and "
            "the coach will not track the current question. Set PUBLIC_APP_URL to "
            "a public tunnel (e.g. `cloudflared tunnel --url http://localhost:8000`)."
        )
    return base


# Player hosts that are known to be unusable inside our lesson frame, so we can
# say so before the learner watches a reload storm. Configurable, because this is
# a property of a provider's deployment on a given day — not of our code.
#
# learning.cet.ac.il lived here from 2026-08-02 (its SPA found no SSO session in
# a cross-site frame and reload-looped through auth.cet.ac.il/v2/logout forever)
# until 2026-08-23, when the promised day came: the player now authenticates
# from the launch context itself (POST /api/authentication/content-session
# succeeds inside a frame), renders, grades and persists state, and its relayed
# events were verified arriving in our LRS from a framed run. The client-side
# reload-storm detector (`embedGuard`) remains the safety net if any provider —
# CET included — regresses; re-blocking is an env change, not a deploy.
_DEFAULT_NON_EMBEDDABLE_HOSTS = ""


def _non_embeddable_hosts() -> set[str]:
    raw = os.environ.get("NON_EMBEDDABLE_PLAYER_HOSTS", _DEFAULT_NON_EMBEDDABLE_HOSTS)
    return {host.strip().lower() for host in raw.split(",") if host.strip()}


def is_embeddable(player_url: str) -> bool:
    """Can this launch be rendered in our lesson frame?

    Content that cannot be framed is not broken content — it just has to open in
    a tab of its own. Everything else about the lesson (the route, the coach, the
    completion signal, which arrives via the Kata relay rather than the frame)
    is unchanged, so this is a rendering decision and nothing more.
    """
    host = urlsplit(player_url or "").hostname or ""
    return host.lower() not in _non_embeddable_hosts()


async def probe_relay_base_url() -> None:
    """Warn loudly, at startup, when the address we hand Kata is not reachable.

    ``PUBLIC_APP_URL`` is what Kata relays content xAPI to. When it points at a
    dead tunnel every statement is dropped *silently*: the lesson renders, the
    learner works, and nothing reaches the Brain. That has happened, so the check
    is worth a single HEAD request at boot.
    """
    base = (os.environ.get("PUBLIC_APP_URL") or "").rstrip("/")
    if not base:
        return
    try:
        import httpx

        async with httpx.AsyncClient(timeout=6.0, follow_redirects=True) as client:
            response = await client.get(f"{base}/api/health")
        if response.status_code >= 500:
            raise RuntimeError(f"status {response.status_code}")
        print(f"✅ xAPI relay base reachable: {base}")
    except Exception as exc:
        print(
            f"⚠️ PUBLIC_APP_URL ({base}) is NOT reachable ({type(exc).__name__}: {exc}). "
            "Kata relays content xAPI to this address — while it is down, NOTHING "
            "the learner does reaches the Brain, the roadmap or the LRS. Restart "
            "the tunnel and update PUBLIC_APP_URL."
        )


async def _assert_component_reachable(
    learner_id: str, unit: dict[str, Any], component: dict[str, Any]
) -> None:
    """Refuse a launch the learner's route has not opened yet.

    Uses the SAME projection the roadmap renders, so the gate and the UI can
    never disagree. A projection failure opens the gate rather than stranding a
    learner mid-unit: the route is a pedagogical order, not a security boundary,
    and losing the catalog must not lock everyone out of their lesson.
    """
    try:
        roadmap = await project_unit_roadmap(unit, learner_id)
        row = next(
            (c for c in roadmap.get("components") or [] if c.get("id") == component["id"]),
            None,
        )
    except Exception as exc:  # pragma: no cover - defensive
        print(f"⚠️ route check skipped ({type(exc).__name__}); allowing launch")
        return
    if row is not None and row.get("progress_state") == "locked":
        raise kata_client.KataError("component_locked", status_code=409)


async def _assert_objective_reachable(learner_id: str, unit: dict[str, Any]) -> None:
    """Refuse a goal whose prerequisites the learner has not achieved.

    720 §3 closes with "יעדי הלמידה בנויים לינארית, כך שלא ניתן לבצע יעד לפני
    שביצעו את היעד הקודם לו". The component gate above is scoped *inside* a unit,
    so without this a pasted URL walks straight into a later goal. Dependencies
    come from the unit's ``prerequisiteLearningObjective`` — the goal registry has
    no prerequisites field — so a provider that declares none gates nothing.
    """
    prerequisites = [p for p in (unit.get("prerequisites") or []) if p]
    if not prerequisites:
        return
    try:
        from app.brain.mastery import entry_for
        from app.brain.repository import get_brain
        mastery = (await get_brain(learner_id)).get("mastery") or {}
    except Exception as exc:  # pragma: no cover - defensive
        print(f"⚠️ objective gate skipped ({type(exc).__name__}); allowing launch")
        return
    missing = [p for p in prerequisites if not entry_for(mastery, p).get("achieved")]
    if missing:
        raise kata_client.KataError("objective_locked", status_code=409)


async def create_provider_session(
    learner_id: str,
    component_id: str,
    *,
    unit_id: Optional[str],
    language: str,
    request_base_url: str,
    restart: bool = False,
) -> dict[str, Any]:
    safe_learner_id = normalize_learner_id(learner_id)
    unit, component = await kata_client.resolve_component(component_id, unit_id)

    # 720 F1: the PLATFORM owns the route between components ("התהלוך בין
    # הרכיבים מתבצע על ידי המערכת"). The roadmap projected that route and the UI
    # honoured it, but the launch did not — pasting a component id in the URL
    # minted a session for any component in the unit, locked or not. That let a
    # learner walk straight into `…-05` (`isAssessment`), whose success
    # establishes כשירות ביעד הלמידה under §3.3, without doing the practice the
    # mastery is supposed to evidence.
    #
    # Re-entry to a FINISHED component stays open (§6 explicitly allows
    # reviewing or redoing it), as do recovery and equal-order alternatives —
    # they all project as `completed`/`available`, never `locked`.
    await _assert_objective_reachable(safe_learner_id, unit)
    await _assert_component_reachable(safe_learner_id, unit, component)

    content_language = language if language in component["languages"] else (
        component["languages"][0] if component["languages"] else None
    )
    public_base = _public_base_url(request_base_url)

    launch = mint_launch(
        safe_learner_id,
        objective_id=unit["objective_id"],
        component_id=component["id"],
        unit_id=unit["id"],
        subject=unit["subject"],
        is_assessment=component["is_assessment"],
        source="kata",
        reporting_base_url=public_base,
    )

    # Kata relays content xAPI to our ingest. studentId MUST equal the launch id
    # so the forwarded actor.account.name matches what the ingest scopes against.
    context = await kata_client.create_launch_context(
        component_id=component["id"],
        student_id=launch["slxapi"]["actor"]["account"]["name"],
        platform_url=public_base,
        lrs_endpoint=launch["slxapi"]["endpoint"],
        lrs_auth=launch["slxapi"]["auth"],
    )

    # Continuity is the default (720 §6: "save the student's progress and return
    # to the same point" — the CONTENT owns position, keyed by the stable
    # studentId we pass). We therefore preserve the coach thread + one-shot hint
    # state across a relaunch. Only an EXPLICIT redo (§6 re-entry-after-completion
    # → "redo the component") is a fresh attempt that resets our side.
    if restart:
        try:
            from app.agents import sessions as agent_sessions
            await agent_sessions.reset_activity_conversations(
                safe_learner_id, unit["id"], component["id"]
            )
        except Exception as exc:  # a reset failure must never block the launch
            print(f"⚠️ activity conversation reset failed: {exc}")

    # Kata's content ALWAYS restarts on (re)launch — its iframe does not resume
    # its own position (that is content-side per §6; we verified the launch is
    # stable and hand Kata everything it needs, but it re-initialises from the
    # top). So the "current question" pointer + one-shot hint state are reset on
    # EVERY launch: the coach panel and hint start fresh to match the restarted
    # content, then re-establish per-question as the learner navigates/answers
    # (each screen emits a sub-item event). Preserving them stranded the coach a
    # screen behind — the hint stayed "used" and old messages lingered after a
    # reload. The activity CONVERSATION is preserved (continuity); a question's
    # messages reappear when the learner returns to it (they are tagged by
    # question). An explicit redo additionally clears the conversation, above.
    updates: dict[str, Any] = {
        "current_state.unit_id": unit["id"],
        "current_state.component_id": component["id"],
        "current_state.item_id": None,
        "current_state.question_id": None,
        "current_state.resume_token": None,
        "current_state.support_used": None,
        # Which screens were already congratulated. A relaunch is a new sitting,
        # and the keys are session-scoped anyway — clearing keeps the list from
        # growing across every launch of every lesson.
        "current_state.praised_screens": [],
        # …and which screen completions were already folded into mastery. Same
        # reason: session-scoped keys, cleared with the sitting.
        "current_state.scored_screens": [],
        "current_state.learning_choice": None,
        # The position clock belongs to ONE attempt. It exists so a stale or
        # replayed statement cannot rewind the learner mid-lesson; carrying it
        # into a new launch would instead freeze them, because the content
        # restarts its own timeline and every fresh event would look older than
        # the last one of the previous run.
        "current_state.at": None,
    }
    await apply_brain_updates(safe_learner_id, updates)

    roadmap = await project_unit_roadmap(unit, safe_learner_id)
    # Per-item bot notes + question snapshots (incl. correct answers) are
    # server-only coach context — never ship them to the client.
    _server_only = {"information_by_item", "questions_by_item"}
    public_component = {k: v for k, v in component.items() if k not in _server_only}
    for row in roadmap.get("components") or []:
        for key in _server_only:
            row.pop(key, None)
    return {
        "unit": {
            "id": unit["id"],
            # The flat `title` on CET rows is an English machine label; the
            # learner-facing name lives in the translations (same trap
            # `title_translations` documents). Requested language first,
            # Hebrew-first fallback like every other catalog surface.
            "title": (unit.get("titles") or {}).get(language)
                     or (unit.get("titles") or {}).get("he")
                     or unit["title"],
            "sub_topic": unit["sub_topic"],
            "objective_id": unit["objective_id"],
            "subject": unit["subject"],
        },
        "component": public_component,
        "roadmap": roadmap,
        "content_language": content_language,
        "requested_language": language,
        "language_supported": language in component["languages"],
        "player_url": context["launch_url"],
        # False → the lesson page offers the activity in its own tab instead of
        # framing it. The client ALSO detects a reload storm on its own, so a
        # provider we have never met is handled without a config change.
        "embeddable": is_embeddable(context["launch_url"]),
        "registration_id": context.get("registration_id"),
        "launch": launch["launch"],
        "session_id": launch["session_id"],
        "timing_url": (
            f"{public_base}/api/learning/sessions/{launch['session_id']}/timing"
        ),
        "resume_token": None,
        "source": "kata",
    }


# ── Teacher preview ───────────────────────────────────────────────────────────
# One Kata launch per component is enough for every preview open within the
# TTL — the launcher mints a registration per context, and a teacher paging
# through lomdot should not mint dozens.
_PREVIEW_TTL_SECONDS = 30 * 60
_preview_cache: dict[str, tuple[float, dict[str, Any]]] = {}


async def create_preview_launch(
    teacher_id: str, component_id: str, *, request_base_url: str
) -> dict[str, Any]:
    """A playable URL for a teacher's own eyes — content only, no tracking.

    Unlike a learner session: no route gate (a teacher may look at anything in
    the catalog), no learner state touched, no launch token minted on our side.
    The xAPI context handed to Kata points at ``/api/xapi/preview/`` — not a
    valid launch token, so our ingest 401s every statement the content reports
    and nothing ever reaches the Brain or the LRS. The studentId is a
    ``preview-`` pseudonym so even Kata's own records never mistake a teacher's
    browsing for a learner working.
    """
    now = time.monotonic()
    cached = _preview_cache.get(component_id)
    if cached and now - cached[0] < _PREVIEW_TTL_SECONDS:
        return cached[1]
    unit, component = await kata_client.resolve_component(component_id, None)
    public_base = _public_base_url(request_base_url)
    context = await kata_client.create_launch_context(
        component_id=component["id"],
        student_id=f"preview-{normalize_learner_id(teacher_id)}",
        platform_url=public_base,
        lrs_endpoint=f"{public_base}/api/xapi/preview/",
        lrs_auth="Basic preview",
    )
    result = {
        "player_url": context["launch_url"],
        "embeddable": is_embeddable(context["launch_url"]),
        "title": component.get("title") or unit.get("title") or component["id"],
    }
    _preview_cache[component_id] = (now, result)
    return result
