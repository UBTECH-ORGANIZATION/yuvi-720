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
from typing import Any, Optional

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
            "title": unit["title"],
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
        "registration_id": context.get("registration_id"),
        "launch": launch["launch"],
        "session_id": launch["session_id"],
        "timing_url": (
            f"{public_base}/api/learning/sessions/{launch['session_id']}/timing"
        ),
        "resume_token": None,
        "source": "kata",
    }
