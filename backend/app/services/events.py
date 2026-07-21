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

from app.brain import detectors
from app.brain import mastery as mastery_model
from app.brain.repository import (
    _get_collection_named,
    apply_brain_operators,
    apply_brain_updates,
    get_brain,
)
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
    await _attach_effort_evidence(event)
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
        # Isolate the brain fold: a bug folding ONE event must not 500 the
        # request, because the provider would then retry, find the id already
        # stored, ack it as a duplicate, and lose the mastery update forever
        # (and drop later statements in the same batch). Store-then-fold means
        # the event is preserved; a fold failure is logged, not fatal.
        try:
            await _update_item_stats(event)
            await _apply_event_to_brain(event)
        except Exception as exc:
            print(f"⚠️ brain fold failed for {event.get('_id')}: {type(exc).__name__}")
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
        # MoE LRS forward (720): enrich the raw content statement with the
        # outbound envelope and enqueue — first sight only, never blocks ingest.
        try:
            await _forward_to_moe_lrs(statement, launch, event["learner_id"])
        except Exception as exc:
            print(f"⚠️ MoE LRS forward skipped: {type(exc).__name__}")
    return {"stored": True, "duplicate": not is_new, "event_id": event["_id"]}


async def _forward_to_moe_lrs(
    statement: dict[str, Any], launch: dict[str, Any], learner_id: str
) -> None:
    """Forward one content-origin statement to the Ministry LRS.

    Session: the learner's active MoE login session (minted at login); the
    per-launch `sid` is only a fallback so content played outside a tracked
    login still carries *a* session grouping.
    """
    from app.auth.repository import get_user_by_id
    from app.services.lrs import config as lrs_config
    from app.services.lrs import reporter as lrs_reporter

    if not lrs_config.is_enabled():
        return
    user = await get_user_by_id(learner_id)
    session_id = (user or {}).get("current_moe_session_id") or launch.get("sid")
    await lrs_reporter.report_content_statement(
        learner_id,
        session_id,
        statement,
        ecat_item_id=lrs_config.kata_ecat_id() or None,
    )


async def _attach_effort_evidence(event: dict[str, Any]) -> None:
    """Rapid-guess gate (A-3): a too-fast response is stored but is NOT evidence.

    Threshold = max(2s, min(10% of the item's mean RT, 10s)); 3s floor until the
    item has ≥30 observations. The flag rides on the stored event so detectors
    and teacher views can point at the exact statements.
    """
    if event.get("verb") not in {"answered", "attempted"}:
        return
    mean_rt, n = await _item_rt_stats(event.get("object_id"))
    seconds = detectors.response_seconds(event)
    event["response_seconds"] = seconds
    event["effort_threshold_seconds"] = detectors.rapid_guess_threshold(mean_rt, n)
    event["effortful"] = not detectors.is_rapid_guess(event, mean_rt, n)


async def _item_rt_stats(object_id: Optional[str]) -> tuple[Optional[float], int]:
    """Per-item mean response time (internal norm, never shown as comparison)."""
    if not object_id:
        return None, 0
    collection = _get_collection_named("item_stats")
    if collection is None:
        return None, 0
    try:
        doc = await collection.find_one({"_id": object_id})
    except Exception:
        return None, 0
    n = int((doc or {}).get("n") or 0)
    total = float((doc or {}).get("total_seconds") or 0.0)
    return (total / n if n else None), n


async def _update_item_stats(event: dict[str, Any]) -> None:
    """Atomically fold one observed EFFORTFUL response time into the item's RT
    norm. Rapid guesses are excluded so a burst of 2s spam can't drag the item
    mean toward the floor and slowly erode the gate on gamed items."""
    if event.get("verb") not in {"answered", "attempted"} or event.get("effortful") is False:
        return
    seconds = event.get("response_seconds")
    object_id = event.get("object_id")
    if not object_id or not isinstance(seconds, (int, float)) or not 0 < seconds <= 600:
        return
    collection = _get_collection_named("item_stats")
    if collection is None:
        return
    try:
        await collection.update_one(
            {"_id": object_id},
            {"$inc": {"n": 1, "total_seconds": float(seconds)}},
            upsert=True,
        )
    except Exception:
        pass


async def _compute_pace(event: dict[str, Any]) -> Optional[str]:
    """on_track | ahead | behind — actual component time vs the Kata estimate."""
    component_id = event.get("launch")
    if not component_id:
        return None
    try:
        from app.services import content_provider
        _unit, component = await content_provider.resolve_component(
            component_id, event.get("unit_id")
        )
    except Exception:
        return None
    estimated_minutes = (component or {}).get("estimated_minutes")
    if not isinstance(estimated_minutes, (int, float)) or estimated_minutes <= 0:
        return None
    actual = detectors.parse_iso_duration_seconds(
        (event.get("result") or {}).get("duration")
    )
    if actual is None and event.get("session_id"):
        from app.services.learning_timing import parse_timestamp
        session_events = await get_session_events(event["learner_id"], event["session_id"])
        stamps = [
            parsed for e in session_events
            if (parsed := parse_timestamp(e.get("occurred_at") or e.get("stored_at")))
        ]
        if len(stamps) >= 2:
            actual = (max(stamps) - min(stamps)).total_seconds()
    if actual is None or actual <= 0:
        return None
    estimated_seconds = float(estimated_minutes) * 60
    if actual > estimated_seconds * 1.5:
        return "behind"
    if actual < estimated_seconds * 0.5:
        return "ahead"
    return "on_track"


def _sync_evidence_challenges(
    brain: dict[str, Any], objective_id: str, entry: dict[str, Any], now: str
) -> Optional[list[dict[str, Any]]]:
    """Evidence-driven challenges (B-6): an unresolved misconception seen ≥2
    times surfaces as a challenge; it retires when mastery marks it resolved.
    Onboarding challenges are untouched — they stop being frozen truth, not
    erased."""
    challenges = [
        dict(c) if isinstance(c, dict) else {"label": str(c)}
        for c in brain.get("challenges") or []
    ]
    open_tags = {
        str(m.get("tag"))
        for m in mastery_model.unresolved_misconceptions(entry)
        if int(m.get("count") or 0) >= 2
    }
    changed = False
    seen_tags = set()
    for challenge in challenges:
        if (
            challenge.get("source") != "learning_evidence"
            or challenge.get("objective_id") != objective_id
        ):
            continue
        tag = str(challenge.get("misconception"))
        seen_tags.add(tag)
        status = "active" if tag in open_tags else "resolved"
        if challenge.get("status") != status:
            challenge["status"] = status
            challenge["updated_at"] = now
            changed = True
    for tag in open_tags - seen_tags:
        challenges.append({
            "label": tag,
            "source": "learning_evidence",
            "objective_id": objective_id,
            "misconception": tag,
            "status": "active",
            "at": now,
        })
        changed = True
    return challenges[-20:] if changed else None


async def _apply_event_to_brain(event: dict[str, Any]) -> None:
    """Fold a real event into the brain — mastery/current_state/progress only.

    Chat never sets mastery; only these event verbs do (§5.7). This is the trusted
    system write lane (not an agent scope). Mastery v2 (B-1): EWMA + confidence +
    spaced review + misconception lifecycle + level progression, with counters
    written atomically (B-7) so concurrent retried deliveries lose nothing.
    """
    learner_id = event["learner_id"]
    objective_id = event.get("objective_id")
    subject = event.get("subject")
    verb = event["verb"]
    set_updates: dict[str, Any] = {}
    inc_updates: dict[str, float] = {}

    # Live "where am I" — always advance current_state for resume (F1.6).
    if event.get("object_id"):
        set_updates["current_state.item_id"] = event["object_id"]
    if event.get("launch"):
        set_updates["current_state.component_id"] = event["launch"]
    if event.get("unit_id"):
        set_updates["current_state.unit_id"] = event["unit_id"]
    if event.get("resume_token") is not None:
        set_updates["current_state.resume_token"] = event["resume_token"]
    if verb == "completed":
        try:
            pace = await _compute_pace(event)
        except Exception:
            pace = None
        if pace:
            set_updates["current_state.pace"] = pace
        if (event.get("result") or {}).get("success"):
            set_updates["current_state.hint_ladder"] = {}   # fresh ladder next task

    if objective_id and verb in SCORING_VERBS:
        now = event.get("occurred_at") or _now()
        brain = await get_brain(learner_id)
        objective_key = mastery_model.mastery_key(objective_id)
        prior_entry = dict(mastery_model.entry_for(brain.get("mastery"), objective_id))
        recent = await get_recent_events(learner_id, objective_id, limit=20)

        effortful = event.get("effortful") is not False
        probable_slip = False
        if effortful:
            probable_slip = detectors.is_probable_slip(
                prior_entry, event, detectors.learner_median_rt(recent)
            )
        entry = mastery_model.apply_scored_event(
            prior_entry, event, effortful=effortful, probable_slip=probable_slip, now=now
        )
        entry["objective_id"] = objective_id
        merged_entry = dict(entry)
        # Counters go through $inc so concurrent deliveries never lose one (B-7).
        for counter in ("attempts", "successes", "failures"):
            delta = int(entry.get(counter) or 0) - int(prior_entry.get(counter) or 0)
            entry.pop(counter, None)
            if delta:
                inc_updates[f"mastery.{objective_key}.{counter}"] = delta
        for field, value in entry.items():
            set_updates[f"mastery.{objective_key}.{field}"] = value

        if subject:
            # subject is content-controlled (content extensions win at line ~244);
            # dot/$-sanitize it so a value like "MOE.SCI" can't fragment the
            # progress path or make Mongo reject the whole brain write.
            subject_key = mastery_model.mastery_key(subject).replace("$", "_")
            set_updates[f"progress.{subject_key}"] = _rollup_progress(
                brain, subject, objective_key, merged_entry
            )

        challenges = _sync_evidence_challenges(brain, objective_id, merged_entry, now)
        if challenges is not None:
            set_updates["challenges"] = challenges

        # Answer-cycling signal (A-3) — behavior + exact statements, no judgment.
        if effortful:
            signal = detectors.detect_answer_cycling(recent)
            if signal is not None:
                signals = [
                    s for s in brain.get("behavior_signals") or []
                    if isinstance(s, dict) and not (
                        s.get("type") == signal["type"]
                        and s.get("session_id") == signal.get("session_id")
                    )
                ]
                set_updates["behavior_signals"] = (signals + [signal])[-10:]

        # student_description freshness: meaningful evidence marks it stale; the
        # regeneration itself is lazy (next context-bundle build).
        meaningful = (
            verb == "completed"
            or bool(event.get("misconception"))
            or (merged_entry.get("achieved") and not prior_entry.get("achieved"))
            or bool(merged_entry.get("needs_review")) != bool(prior_entry.get("needs_review"))
        )
        if meaningful and effortful:
            set_updates["student_description.stale"] = True
        inc_updates["student_description.events_since_generation"] = 1

    if set_updates or inc_updates:
        await apply_brain_operators(learner_id, set_updates, inc_updates)


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
