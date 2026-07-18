"""xAPI ingestion + `slxapi` launch — the fuel pipeline for the brain (P1, §8).

Content runs in an iframe and **reports back** xAPI statements to an endpoint we
control, using a per-launch token we mint. This module is a lightweight LRS:
validate against the MoE closed verb list, normalize, append to `learning_events`
(idempotent on the statement `id` — the mandated retry policy *guarantees*
duplicates, §8.2 / R14), then update the brain's `mastery / current_state /
progress` from **real** results (never invented numbers).

Authoritative vocabulary: `.github/skills/720-content-standards/references/xapi-reporting.md`.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import time
from datetime import datetime, timezone
from typing import Any, Optional

from app.brain.repository import _get_collection_named, apply_brain_updates, get_brain
from learner_state import normalize_learner_id  # type: ignore


# ── MoE LXP closed verb list (wire verbs; no Initialized/Selected/Requested) ──
VERB_IRI_BASE = "https://lxp.education.gov.il/xapi/moe/verbs/"
ACTIVITY_IRI_BASE = "https://lxp.education.gov.il/xapi/moe/activities/"
MOE_VERBS = {
    "enter", "exit", "attempted", "answered", "scored", "completed", "submitted",
    "read", "watched", "listened", "played", "paused", "play", "downloaded",
    "install", "assigned", "created", "joined", "leave", "voided",
}
# Verbs that carry a scored result we fold into mastery.
SCORING_VERBS = {"answered", "attempted", "scored", "completed"}

# The deployed provider simulator currently emits standard ADL verbs. They are
# accepted only for launches explicitly minted for that provider, then mapped
# into the MoE wire vocabulary while retaining the original IRI for audit.
ADL_PROVIDER_VERB_MAP = {
    "http://adlnet.gov/expapi/verbs/initialized": "enter",
    "http://adlnet.gov/expapi/verbs/answered": "answered",
    "http://adlnet.gov/expapi/verbs/completed": "completed",
    "http://adlnet.gov/expapi/verbs/attempted": "attempted",
    "http://adlnet.gov/expapi/verbs/exited": "exit",
    "http://id.tincanapi.com/verb/selected": "selected",
    "http://id.tincanapi.com/verb/requested": "requested",
    "https://w3id.org/xapi/video/verbs/played": "played",
    "https://w3id.org/xapi/video/verbs/paused": "paused",
}
PROVIDER_INTERACTION_VERBS = {"selected", "requested"}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _secret() -> bytes:
    return (os.environ.get("SECRET_KEY") or "yuvi720-dev-secret").encode("utf-8")


# ── slxapi launch token (stateless, HMAC-signed) ─────────────────────────────
def mint_launch(
    learner_id: str,
    *,
    objective_id: Optional[str] = None,
    component_id: Optional[str] = None,
    unit_id: Optional[str] = None,
    subject: Optional[str] = None,
    is_assessment: bool = False,
    source: str = "spark",
    reporting_base_url: Optional[str] = None,
    ttl_seconds: int = 60 * 60 * 4,
) -> dict[str, Any]:
    """Mint a non-identifying `slxapi` launch context (§8.2).

    Returns `{launch, slxapi}` where `slxapi.endpoint` is the BASE reporting URL
    (content appends `statements`), `slxapi.auth` is the per-launch token, and
    `slxapi.actor` carries only a **pseudonymous** learner id — never PII.
    """
    safe_id = normalize_learner_id(learner_id)
    session_id = secrets.token_urlsafe(12)
    payload = {
        "lid": safe_id,
        "obj": objective_id,
        "cmp": component_id,
        "unit": unit_id,
        "subj": subject,
        "assessment": bool(is_assessment),
        "src": source,
        "sid": session_id,
        "exp": int(time.time()) + ttl_seconds,
    }
    raw = base64.urlsafe_b64encode(json.dumps(payload, separators=(",", ":")).encode()).decode()
    sig = hmac.new(_secret(), raw.encode(), hashlib.sha256).hexdigest()[:32]
    token = f"{raw}.{sig}"
    endpoint = f"/api/xapi/{token}/"
    if reporting_base_url:
        endpoint = f"{reporting_base_url.rstrip('/')}{endpoint}"
    return {
        "launch": token,
        "session_id": session_id,
        "slxapi": {
            "endpoint": endpoint,
            "auth": f"Basic {token}",
            "actor": {
                "account": {
                    "name": safe_id,                       # pseudonymous id, not ת"ז
                    "homePage": "https://yuvilab.spark",
                }
            },
        },
    }


def verify_launch(token: str) -> Optional[dict[str, Any]]:
    """Return the launch payload if the token is valid + unexpired, else None."""
    try:
        raw, sig = token.rsplit(".", 1)
    except ValueError:
        return None
    expected = hmac.new(_secret(), raw.encode(), hashlib.sha256).hexdigest()[:32]
    if not hmac.compare_digest(sig, expected):
        return None
    try:
        payload = json.loads(base64.urlsafe_b64decode(raw.encode()).decode())
    except (ValueError, json.JSONDecodeError):
        return None
    if int(payload.get("exp", 0)) < int(time.time()):
        return None
    return payload


# ── Normalization ────────────────────────────────────────────────────────────
def _verb_slug(statement: dict[str, Any]) -> Optional[str]:
    verb = statement.get("verb") or {}
    iri = verb.get("id") if isinstance(verb, dict) else None
    if isinstance(iri, str) and iri.startswith(VERB_IRI_BASE):
        return iri[len(VERB_IRI_BASE):].strip("/").lower()
    # Tolerate a bare slug for our own reference content.
    if isinstance(iri, str) and iri.lower() in MOE_VERBS:
        return iri.lower()
    display = statement.get("verb_slug")
    return display.lower() if isinstance(display, str) else None


def _provider_verb_slug(statement: dict[str, Any], launch: dict[str, Any]) -> tuple[Optional[str], bool]:
    """Return the normalized slug and whether provider compatibility was used."""
    slug = _verb_slug(statement)
    if slug in MOE_VERBS:
        return slug, False
    if launch.get("src") != "content_provider":
        return None, False
    verb = statement.get("verb") or {}
    iri = verb.get("id") if isinstance(verb, dict) else None
    mapped = ADL_PROVIDER_VERB_MAP.get(iri) if isinstance(iri, str) else None
    return mapped, bool(mapped)


def statement_matches_launch(statement: dict[str, Any], launch: dict[str, Any]) -> bool:
    """Enforce pseudonymous actor and provider component scope when supplied."""
    actor = statement.get("actor") or {}
    account = actor.get("account") if isinstance(actor, dict) else None
    actor_name = account.get("name") if isinstance(account, dict) else None
    if actor_name and actor_name != launch.get("lid"):
        return False

    if launch.get("src") != "content_provider":
        return True
    obj = statement.get("object") or {}
    object_id = str(obj.get("id") or "") if isinstance(obj, dict) else ""
    component_id = str(launch.get("cmp") or "")
    unit_id = str(launch.get("unit") or "")
    # Provider item/question ids may be short (e.g. q1). Reject only an obvious
    # attempt to report a different provider component or unit.
    if "YuviDori-" in object_id and component_id not in object_id and unit_id not in object_id:
        return False
    return True


def _context_extensions(statement: dict[str, Any]) -> dict[str, Any]:
    ctx = statement.get("context") or {}
    ext = ctx.get("extensions") if isinstance(ctx, dict) else None
    return ext if isinstance(ext, dict) else {}


def normalize_statement(
    statement: dict[str, Any], launch: dict[str, Any]
) -> Optional[dict[str, Any]]:
    """Validate + flatten an xAPI statement into a `learning_events` document.

    Returns None if the verb is not in the MoE closed list (we never invent verbs).
    """
    slug, compatibility_used = _provider_verb_slug(statement, launch)
    if slug not in MOE_VERBS | PROVIDER_INTERACTION_VERBS:
        return None

    obj = statement.get("object") or {}
    definition = obj.get("definition") or {}
    obj_type_iri = definition.get("type") if isinstance(definition, dict) else None
    obj_type = None
    if isinstance(obj_type_iri, str) and obj_type_iri.startswith(ACTIVITY_IRI_BASE):
        obj_type = obj_type_iri[len(ACTIVITY_IRI_BASE):].strip("/")

    result = statement.get("result") or {}
    score = result.get("score") or {}
    ext = _context_extensions(statement)

    stmt_id = statement.get("id") or hashlib.sha256(
        json.dumps(statement, sort_keys=True, ensure_ascii=False).encode()
    ).hexdigest()

    original_verb = statement.get("verb") or {}
    original_verb_iri = original_verb.get("id") if isinstance(original_verb, dict) else None
    object_id = obj.get("id")
    question_id = ext.get("question_id")
    if not question_id and slug == "answered" and isinstance(object_id, str):
        tail = object_id.rstrip("/").rsplit("/", 1)[-1].rsplit("#", 1)[-1]
        if tail.lower().startswith("q") and tail[1:].isdigit():
            question_id = tail

    return {
        "_id": stmt_id,
        "learner_id": launch["lid"],
        "verb": slug,
        "verb_iri": (
            f"{VERB_IRI_BASE}{slug}" if slug in MOE_VERBS else original_verb_iri
        ),
        "source_verb_iri": original_verb_iri,
        "normalization": "provider_adl_compat" if compatibility_used else "moe_native",
        "object_id": object_id,
        "object_type": obj_type,
        "objective_id": ext.get("objective_id") or launch.get("obj"),
        "subject": ext.get("subject") or launch.get("subj"),
        "question_id": question_id,
        "is_assessment": bool(ext.get("is_assessment", launch.get("assessment", False))),
        "misconception": ext.get("misconception"),
        "resume_token": ext.get("resume_token"),
        "result": {
            "success": result.get("success"),
            "response": result.get("response"),
            "score_scaled": score.get("scaled"),   # internal-only, never shown
            "duration": result.get("duration"),
            "completion": result.get("completion"),
        },
        "launch": launch.get("cmp") or launch.get("obj"),
        "unit_id": launch.get("unit"),
        "source": launch.get("src") or "spark",
        "session_id": launch.get("sid"),
        "occurred_at": statement.get("timestamp") or _now(),
        "timestamp_source": "statement" if statement.get("timestamp") else "received",
        "stored_at": _now(),
    }


# ── Ingestion (idempotent) + brain update ────────────────────────────────────
async def _events_collection():
    return _get_collection_named("learning_events")


async def get_recent_events(
    learner_id: str, objective_id: Optional[str] = None, limit: int = 5
) -> list[dict[str, Any]]:
    """Recent normalized events (newest first) — for the Coach bundle + triggers."""
    query: dict[str, Any] = {"learner_id": normalize_learner_id(learner_id)}
    if objective_id:
        query["objective_id"] = objective_id
    collection = await _events_collection()
    if collection is not None:
        try:
            cursor = collection.find(query).sort("stored_at", -1).limit(limit)
            return [e async for e in cursor]
        except Exception as exc:
            print(f"⚠️ recent events read failed, using fallback: {exc}")
    # Fallback: filter the JSON store.
    events = list(_fallback_read().values())
    events = [e for e in events if e.get("learner_id") == query["learner_id"]
              and (objective_id is None or e.get("objective_id") == objective_id)]
    events.sort(key=lambda e: e.get("stored_at", ""), reverse=True)
    return events[:limit]


async def get_learner_events(learner_id: str, limit: int = 500) -> list[dict[str, Any]]:
    """Return bounded event evidence for learner-owned aggregate projections."""
    safe_id = normalize_learner_id(learner_id)
    collection = await _events_collection()
    if collection is not None:
        try:
            cursor = collection.find({"learner_id": safe_id}).sort("stored_at", -1).limit(limit)
            return [event async for event in cursor]
        except Exception as exc:
            print(f"⚠️ learner events read failed, using fallback: {exc}")
    events = [event for event in _fallback_read().values() if event.get("learner_id") == safe_id]
    events.sort(key=lambda event: event.get("stored_at", ""), reverse=True)
    return events[:limit]


async def get_session_events(learner_id: str, session_id: str) -> list[dict[str, Any]]:
    """Return one pseudonymous launch's events in reported occurrence order."""
    query = {
        "learner_id": normalize_learner_id(learner_id),
        "session_id": session_id,
    }
    collection = await _events_collection()
    if collection is not None:
        try:
            cursor = collection.find(query).sort("occurred_at", 1)
            return [event async for event in cursor]
        except Exception as exc:
            print(f"⚠️ session events read failed, using fallback: {exc}")
    events = [
        event for event in _fallback_read().values()
        if event.get("learner_id") == query["learner_id"]
        and event.get("session_id") == session_id
    ]
    events.sort(key=lambda event: event.get("occurred_at") or event.get("stored_at") or "")
    return events


async def get_unit_events(learner_id: str, unit_id: str) -> list[dict[str, Any]]:
    """Return one unit's evidence in occurrence order for roadmap projection."""
    query = {
        "learner_id": normalize_learner_id(learner_id),
        "unit_id": unit_id,
    }
    collection = await _events_collection()
    if collection is not None:
        try:
            cursor = collection.find(query).sort("occurred_at", 1)
            return [event async for event in cursor]
        except Exception as exc:
            print(f"⚠️ unit events read failed, using fallback: {exc}")
    events = [
        event for event in _fallback_read().values()
        if event.get("learner_id") == query["learner_id"]
        and event.get("unit_id") == unit_id
    ]
    events.sort(key=lambda event: event.get("occurred_at") or event.get("stored_at") or "")
    return events


async def _attach_timing_evidence(event: dict[str, Any]) -> None:
    """Attach honest elapsed-wall-clock evidence from the preceding event."""
    session_id = event.get("session_id")
    if not session_id:
        event["timing"] = {"elapsed_since_previous_seconds": None, "quality": "unavailable"}
        return
    from app.services.learning_timing import elapsed_seconds, parse_timestamp

    prior_events = await get_session_events(event["learner_id"], session_id)
    event_time = parse_timestamp(event.get("occurred_at") or event.get("stored_at"))
    previous = next(
        (
            candidate for candidate in reversed(prior_events)
            if candidate.get("_id") != event.get("_id")
            and parse_timestamp(candidate.get("occurred_at") or candidate.get("stored_at"))
            and event_time
            and parse_timestamp(candidate.get("occurred_at") or candidate.get("stored_at")) <= event_time
        ),
        None,
    )
    previous_time = parse_timestamp(
        (previous or {}).get("occurred_at") or (previous or {}).get("stored_at")
    )
    seconds = elapsed_seconds(previous_time, event_time)
    event["timing"] = {
        "elapsed_since_previous_seconds": seconds,
        "quality": "elapsed_between_events" if seconds is not None else "unavailable",
        "previous_event_id": (previous or {}).get("_id"),
    }


async def _ensure_indexes(collection) -> None:
    try:
        await collection.create_index("learner_id")
        await collection.create_index([("learner_id", 1), ("objective_id", 1)])
        await collection.create_index([("learner_id", 1), ("session_id", 1)])
    except Exception:  # pragma: no cover - best effort; _id is unique by default
        pass


async def ingest_statement(
    statement: dict[str, Any], launch: dict[str, Any]
) -> dict[str, Any]:
    """Append one statement idempotently, then update the brain on first sight.

    A replayed statement (same `id`) is acked WITHOUT re-counting attempts,
    moving mastery, or re-firing downstream effects (R14).
    """
    if not statement_matches_launch(statement, launch):
        return {"stored": False, "reason": "statement_outside_launch_scope"}
    event = normalize_statement(statement, launch)
    if event is None:
        return {"stored": False, "reason": "verb_not_in_moe_list"}

    await _attach_timing_evidence(event)
    collection = await _events_collection()
    is_new = True
    if collection is not None:
        try:
            await _ensure_indexes(collection)
            res = await collection.update_one(
                {"_id": event["_id"]},
                {"$setOnInsert": event},
                upsert=True,
            )
            is_new = res.upserted_id is not None
        except Exception as exc:
            print(f"⚠️ learning_events write failed, using fallback: {exc}")
            is_new = _fallback_append(event)
    else:
        is_new = _fallback_append(event)

    if is_new:
        await _apply_event_to_brain(event)
        if event.get("verb") == "completed":
            try:
                from app.agents import sessions
                await sessions.close_activity_conversations(
                    event["learner_id"],
                    event.get("unit_id"),
                    event.get("launch"),
                )
            except Exception as exc:  # completion evidence must still be acked
                print(f"⚠️ activity conversation closure failed: {exc}")
        # Proactivity: evaluate triggers from the real event (lazy import — cycle).
        try:
            from app.services import triggers
            await triggers.evaluate(event["learner_id"], event)
        except Exception as exc:  # never block ingest on trigger evaluation
            print(f"⚠️ trigger evaluation failed: {exc}")
    return {"stored": True, "duplicate": not is_new, "event_id": event["_id"]}


async def _apply_event_to_brain(event: dict[str, Any]) -> None:
    """Fold a real event into the brain — mastery/current_state/progress only.

    Chat never sets mastery; only these event verbs do (§5.7). This is the trusted
    system write lane (not an agent scope): it may write mastery/progress/current.
    """
    learner_id = event["learner_id"]
    objective_id = event.get("objective_id")
    subject = event.get("subject")
    verb = event["verb"]
    result = event.get("result") or {}
    updates: dict[str, Any] = {}

    # Live "where am I" — always advance current_state for resume (F1.6).
    current: dict[str, Any] = {}
    if event.get("object_id"):
        current["item_id"] = event["object_id"]
    if event.get("launch"):
        current["component_id"] = event["launch"]
    if event.get("unit_id"):
        current["unit_id"] = event["unit_id"]
    if event.get("resume_token") is not None:
        current["resume_token"] = event["resume_token"]
    if current:
        updates["current_state"] = current

    if objective_id and verb in SCORING_VERBS:
        brain = await get_brain(learner_id)
        mastery = dict((brain.get("mastery") or {}).get(objective_id) or {})
        if subject:
            mastery["subject"] = subject
        # attempts count only genuine scored attempts.
        if verb in {"answered", "attempted"}:
            mastery["attempts"] = int(mastery.get("attempts", 0)) + 1
        if result.get("score_scaled") is not None:
            mastery["last_score"] = result["score_scaled"]
        if event.get("misconception"):
            misc = list(mastery.get("misconceptions") or [])
            if event["misconception"] not in misc:
                misc.append(event["misconception"])
            mastery["misconceptions"] = misc
        # Objective mastered: a `completed` assessment component with success.
        if verb == "completed" and event.get("is_assessment") and result.get("success"):
            mastery["achieved"] = True
            mastery.setdefault("level", "intermediate")
        mastery.setdefault("achieved", bool(mastery.get("achieved", False)))
        updates[f"mastery.{objective_id}"] = mastery

        if subject:
            updates[f"progress.{subject}"] = _rollup_progress(
                brain, subject, objective_id, mastery
            )

    if updates:
        await apply_brain_updates(learner_id, updates)


def _rollup_progress(
    brain: dict[str, Any], subject: str, objective_id: str, mastery_entry: dict[str, Any]
) -> dict[str, Any]:
    """Recount mastered objectives for a subject from real mastery (never invented)."""
    all_mastery = dict(brain.get("mastery") or {})
    all_mastery[objective_id] = mastery_entry
    # Which objectives belong to this subject: those seen via events tagged subject.
    seen = {
        oid
        for oid, m in all_mastery.items()
        if isinstance(m, dict) and (m.get("subject") == subject or oid == objective_id)
    }
    mastered = sum(1 for oid in seen if all_mastery.get(oid, {}).get("achieved"))
    prior = (brain.get("progress") or {}).get(subject) or {}
    total = max(int(prior.get("objectives_total", 0)), len(seen))
    return {"objectives_total": total, "objectives_mastered": mastered}


# ── JSON fallback for learning_events (demo resilience only) ──────────────────
from pathlib import Path

_FALLBACK_EVENTS = Path(__file__).resolve().parents[2] / ".runtime" / "learning_events.json"


def _fallback_read() -> dict[str, Any]:
    try:
        return json.loads(_FALLBACK_EVENTS.read_text(encoding="utf-8")) if _FALLBACK_EVENTS.exists() else {}
    except (OSError, json.JSONDecodeError):
        return {}


def _fallback_append(event: dict[str, Any]) -> bool:
    """Append to the JSON fallback; return True if newly inserted (idempotent)."""
    data = _fallback_read()
    if event["_id"] in data:
        return False
    data[event["_id"]] = event
    try:
        _FALLBACK_EVENTS.parent.mkdir(parents=True, exist_ok=True)
        _FALLBACK_EVENTS.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    except OSError as exc:
        print(f"⚠️ learning_events fallback write failed: {exc}")
    return True
