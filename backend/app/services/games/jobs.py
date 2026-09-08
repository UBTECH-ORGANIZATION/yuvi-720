"""The job envelope the worker consumes, and how it reaches the worker.

## The payload is complete

A job document holds everything ``workers/game_gen/pipeline.JobSpec`` needs:
``kind, genre, vibe, clarifications, language, device, instruction,
runtime_errors, history`` and ``context = {component, unit, objective}``. The
context is the **live** ``kata_catalog`` snapshot at enqueue time — the
normalized component INCLUDING ``questions_by_item`` with ``correctAnswers``.
That is deliberate: the worker builds the context pack and the answer key from
it (``context_pack.build_context_pack``) and the validator needs the key to
prove the learning contract. It is also why no route ever returns a job
document: the job is the one place correct answers are written down outside
the catalog.

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
from app.services.games import store

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


# ── context ──────────────────────────────────────────────────────────────────

def _unit_without_components(unit: Optional[dict[str, Any]]) -> Optional[dict[str, Any]]:
    """A unit row minus its `components` list. Every component on the unit
    carries its own question snapshots; copying all of them onto a job for
    one component would multiply the payload by the unit's size."""
    if not unit:
        return None
    return {key: value for key, value in unit.items() if key != "components"}


async def build_context(
    component_id: str, unit_id: Optional[str] = None, objective_id: Optional[str] = None,
) -> Optional[dict[str, Any]]:
    """``{component, unit, objective}`` from the live catalog, or None when the
    component is unknown. Server-side only — this holds correct answers."""
    await kata_catalog.ensure_loaded()
    component = kata_catalog.get_component(component_id)
    if not component:
        return None
    unit = kata_catalog.get_unit(unit_id or component.get("unit_id") or "")
    objective = kata_catalog.get_objective(
        objective_id or component.get("objective_id") or (unit or {}).get("objective_id") or ""
    )
    return {
        "component": dict(component),
        "unit": _unit_without_components(unit),
        "objective": dict(objective) if objective else None,
    }


def gradeable_question_count(component: dict[str, Any]) -> int:
    """How many questions the context pack will keep: text + options + a key.
    The same rule as ``context_pack.build_context_pack``, so the picker's count
    is the count the game will be built on."""
    total = 0
    for rows in (component.get("questions_by_item") or {}).values():
        for row in rows or []:
            if (isinstance(row, dict) and row.get("questionId")
                    and str(row.get("questionText") or "").strip()
                    and row.get("answers") and row.get("correctAnswers")):
                total += 1
    return total


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
    deep_thinking: bool = False, version: Optional[int] = None,
) -> dict[str, Any]:
    """Write the job, then hand it to the worker. Returns the job document.

    The game is moved to `queued` here as well, so a card refresh between the
    two writes never shows a `ready` game with a queued job under it.
    """
    if kind not in store.JOB_KINDS:
        raise store.GameStoreError("bad_kind")
    context = await build_context(
        str(game.get("component_id") or ""), game.get("unit_id"), game.get("objective_id"),
    )
    if context is None:
        raise store.GameStoreError("unknown_component")

    payload = {
        "kind": kind,
        "genre": genre or game.get("genre") or "surprise",
        "vibe": (vibe if vibe is not None else game.get("prompt")) or "",
        "clarifications": dict(clarifications or {}),
        "inspirations": list(inspirations or [])[:6],
        "language": language or game.get("language") or "he",
        "device": device or game.get("device") or "keyboard",
        "instruction": (instruction or "")[:1200],
        "runtime_errors": list(runtime_errors or [])[:20],
        "history": _history(game),
        # A design is worth the long think; a patch is not. Edits and fixes run
        # a tier lower so a change lands in minutes, not a quarter of an hour.
        "reasoning_effort": ("xhigh" if deep_thinking else "high") if kind == "create" else ("high" if deep_thinking else "medium"),
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
    if connection:
        client = ServiceBusClient.from_connection_string(connection)
    elif namespace:
        from azure.identity.aio import DefaultAzureCredential

        client = ServiceBusClient(namespace, credential=DefaultAzureCredential())
    else:
        raise EnqueueError("servicebus_not_configured")

    body = json.dumps({
        "job_id": job["_id"], "game_id": job["game_id"],
        "learner_id": job["learner_id"], "kind": job["kind"],
    })
    async with client:
        sender = client.get_queue_sender(queue_name=_queue_name())
        async with sender:
            await sender.send_messages(ServiceBusMessage(
                body, session_id=str(job["game_id"]), content_type="application/json",
            ))
