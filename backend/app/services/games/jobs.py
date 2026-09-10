"""The job envelope the worker consumes, and how it reaches the worker.

## The payload is complete — and small

A job document holds everything ``workers/game_gen/pipeline.JobSpec`` needs:
``kind, genre, vibe, inspirations, clarifications, language, device,
instruction, runtime_errors, history, model, reasoning_effort, judge, plan``
and ``context = {component, unit, objective, learning_description}``.

The context is a **trimmed** snapshot of the live ``kata_catalog`` — ids,
titles, subject, purpose, difficulty, the objective's pedagogy paragraph and
curriculum title — plus ONE paragraph, ``learning_description``, that says
what the kid learns in this lesson (``learning_descriptions.py``: generated
with the mini model, cached per component and language). No question rows, no
answers, no teacher notes travel: the model designs the game around the idea,
not around a question bank. The job is still never returned by a route — the
context is the worker's business, not the card's.

## Model and effort

``model`` / ``reasoning_effort`` come from the GAME row (decided at create:
an admin's pick or ``GAME_MODEL_DEFAULT``; ``medium`` with deep thinking,
``low`` otherwise) so edits and fixes stay on the model that wrote the game.
``model`` None means the worker's own default. ``judge`` is always on —
the worker's judge never discards a finished game, it asks for one revision.
``plan`` (the mini pitch pre-pass) runs for creates only.

## Two ways to the worker

``GAME_JOBS_MODE``:

    mongo       (default) the job row with ``status: "queued"`` IS the queue.
                A worker polls ``learner_game_jobs`` — nothing more to do here.
    servicebus  a small message ``{job_id, game_id, learner_id, kind}`` goes to
                the Service Bus queue ``GAME_JOBS_QUEUE`` (default
                ``game-jobs``) with ``session_id = game_id``, so edits and fixes
                on one game never interleave. The SDK is imported lazily; a
                failed send marks the job AND the game failed, because a job
                that nobody will ever pick up is worse than an honest error.

Both modes write the same row first, so a worker can always fall back to the
poll, and the message body is a pointer rather than a copy: the body limit is
4 KB and the context is not.
"""

from __future__ import annotations

import logging
import os
from typing import Any, Optional

from app.services import kata_catalog
from app.services.games import learning_descriptions, store

log = logging.getLogger(__name__)

MODE_MONGO = "mongo"
MODE_SERVICEBUS = "servicebus"
_DEFAULT_QUEUE = "game-jobs"

#: The 720 feature every token event of a game build is attributed to.
FEATURE = "feature_7_learning_games"

#: The genres the Create wizard offers. "surprise" lets the model choose.
# `genre` is the card's tile; "open" (the default) means Yuvi picked the form.
GENRES = ("open", "shooter", "runner", "platformer", "puzzle", "boss", "tower", "boss-quiz", "tower-defense", "surprise")
# Flavour chips the kid may tick on the brief step — context for the designer, never a constraint.
INSPIRATIONS = ("shooter", "runner", "platformer", "puzzle", "boss", "tower", "3d", "story", "world", "surprise")


class EnqueueError(Exception):
    """The job exists but could not be handed to a worker. Stable code."""


def jobs_mode() -> str:
    mode = (os.environ.get("GAME_JOBS_MODE") or MODE_MONGO).strip().lower()
    if mode not in (MODE_MONGO, MODE_SERVICEBUS):
        log.warning("GAME_JOBS_MODE=%r is not mongo|servicebus; using mongo", mode)
        return MODE_MONGO
    return mode


def _queue_name() -> str:
    return (os.environ.get("GAME_JOBS_QUEUE") or _DEFAULT_QUEUE).strip()


def default_model() -> Optional[str]:
    """``GAME_MODEL_DEFAULT``, or None — the worker then falls back to its own
    ``COPILOT_MODEL``. Decided here (not in the worker) so a bake-off can move
    the whole fleet with one app setting."""
    return (os.environ.get("GAME_MODEL_DEFAULT") or "").strip() or None


#: Deep thinking is a different model, not just more effort: the bake-off
#: (2026-09-10) showed Sonnet at medium scores like Sonnet at low, while an
#: Opus at medium is the only cell that scored higher. Gal asked for Opus 4.6;
#: it is not on the Copilot catalog; Opus 4.8 stood in until 2026-09-10, when Gal moved deep thinking to Opus 5.
DEEP_MODEL_FALLBACK = "claude-opus-5"


def deep_model() -> str:
    """The model behind the "deep thinking" toggle (``GAME_MODEL_DEEP``)."""
    return (os.environ.get("GAME_MODEL_DEEP") or "").strip() or DEEP_MODEL_FALLBACK


# ── context ──────────────────────────────────────────────────────────────────

async def build_context(
    component_id: str, unit_id: Optional[str] = None, objective_id: Optional[str] = None,
    *, actor_id: str = "", language: str = "he",
) -> Optional[dict[str, Any]]:
    """``{component, unit, objective, learning_description}`` — the trimmed
    catalog snapshot plus the lesson paragraph — or None when the component
    is unknown. Waits for the paragraph (cached after the first call)."""
    await kata_catalog.ensure_loaded()
    component = kata_catalog.get_component(component_id)
    if not component:
        return None
    unit = kata_catalog.get_unit(unit_id or component.get("unit_id") or "")
    objective = kata_catalog.get_objective(
        objective_id or component.get("objective_id") or (unit or {}).get("objective_id") or ""
    )
    description = await learning_descriptions.ensure_description(
        component, unit, objective, actor_id=actor_id or "system", language=language,
    )
    unit = unit or {}
    objective = objective or {}
    return {
        "component": {
            "id": str(component.get("id") or component_id),
            "title": kata_catalog.component_title(component_id, language) or str(component.get("title") or ""),
            "purpose": str(component.get("purpose") or ""),
            "relative_difficulty": component.get("relative_difficulty"),
        },
        "unit": {
            "id": str(unit.get("id") or unit_id or component.get("unit_id") or ""),
            "title": kata_catalog.unit_title(unit.get("id"), language) or str(unit.get("title") or ""),
            "subject": str(unit.get("subject") or component.get("subject") or objective.get("subject") or ""),
        },
        "objective": {
            "id": str(objective.get("id") or objective_id or component.get("objective_id") or ""),
            "title": kata_catalog.objective_title(objective.get("id"), language) or str(objective.get("title") or ""),
            "description": str(objective.get("description") or ""),
            "curriculum_title": str(objective.get("curriculum_title") or ""),
        },
        "learning_description": description,
    }


# ── enqueue ──────────────────────────────────────────────────────────────────

def _history(game: dict[str, Any]) -> list[str]:
    """What earlier versions changed — the "you already tried X" memory."""
    return [str(entry.get("summary")) for entry in (game.get("versions") or [])
            if entry.get("summary")][-5:]


async def enqueue(
    game: dict[str, Any], kind: str, *, genre: Optional[str] = None,
    vibe: Optional[str] = None, clarifications: Optional[dict[str, str]] = None,
    inspirations: Optional[list[str]] = None,
    language: Optional[str] = None, device: Optional[str] = None,
    instruction: str = "", runtime_errors: Optional[list[dict[str, Any]]] = None,
    learner_title: str = "", version: Optional[int] = None,
) -> dict[str, Any]:
    """Write the job, then hand it to the worker. Returns the job document.

    The game is moved to `queued` here as well, so a card refresh between the
    two writes never shows a `ready` game with a queued job under it.
    """
    if kind not in store.JOB_KINDS:
        raise store.GameStoreError("bad_kind")
    job_language = language or game.get("language") or "he"
    context = await build_context(
        str(game.get("component_id") or ""), game.get("unit_id"), game.get("objective_id"),
        actor_id=str(game.get("learner_id") or ""), language=job_language,
    )
    if context is None:
        raise store.GameStoreError("unknown_component")

    payload = {
        "kind": kind,
        "genre": genre or game.get("genre") or "surprise",
        "vibe": (vibe if vibe is not None else game.get("prompt")) or "",
        "clarifications": dict(clarifications or {}),
        "inspirations": list(inspirations or [])[:6],
        "language": job_language,
        "device": device or game.get("device") or "keyboard",
        "instruction": (instruction or "")[:1200],
        "runtime_errors": list(runtime_errors or [])[:20],
        "history": _history(game),
        "learner_title": (learner_title or "")[:40],
        # The game row decides; an edit never changes the model that wrote it.
        "model": game.get("model") or default_model(),
        "reasoning_effort": game.get("reasoning_effort") or "low",
        "judge": True,
        "plan": kind == "create",
        "feature": FEATURE,
        "context": context,
    }
    job = await store.create_job(
        game_id=str(game["_id"]), learner_id=str(game["learner_id"]),
        kind=kind, payload=payload, version=version,
    )
    await store.update_status(str(game["_id"]), "queued")

    if jobs_mode() == MODE_SERVICEBUS:
        try:
            await _send_to_service_bus(job)
        except Exception as exc:
            log.warning("game job %s: service bus send failed: %s", job["_id"], type(exc).__name__)
            await store.update_job(job["_id"], status="failed", error_class="EnqueueFailed",
                                   finished_at=store._now())
            await store.update_status(str(game["_id"]), "failed")
            raise EnqueueError("enqueue_failed") from None
    return job


async def _send_to_service_bus(job: dict[str, Any]) -> None:
    """One session-keyed message per job. Imported here so the SDK is only a
    production dependency."""
    import json

    from azure.servicebus import ServiceBusMessage
    from azure.servicebus.aio import ServiceBusClient

    connection = (os.environ.get("GAME_JOBS_SERVICEBUS_CONNECTION_STRING")
                  or os.environ.get("SERVICEBUS_CONNECTION_STRING") or "").strip()
    namespace = (os.environ.get("GAME_JOBS_SERVICEBUS_NAMESPACE") or "").strip()
    credential = None
    if connection:
        client = ServiceBusClient.from_connection_string(connection)
    elif namespace:
        from azure.identity.aio import DefaultAzureCredential

        # The credential owns an aiohttp session; closing it below is what
        # keeps a long-lived backend (and the bake-off script) from leaking
        # one per enqueue.
        credential = DefaultAzureCredential()
        client = ServiceBusClient(namespace, credential=credential)
    else:
        raise EnqueueError("servicebus_not_configured")

    body = json.dumps({
        "job_id": job["_id"], "game_id": job["game_id"],
        "learner_id": job["learner_id"], "kind": job["kind"],
    })
    try:
        async with client:
            sender = client.get_queue_sender(queue_name=_queue_name())
            async with sender:
                await sender.send_messages(ServiceBusMessage(
                    body, session_id=str(job["game_id"]), content_type="application/json",
                ))
    finally:
        if credential is not None:
            await credential.close()
