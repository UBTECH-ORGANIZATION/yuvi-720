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
import re
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


# ── MoE LXP closed verb list for inbound learning-content statements ─────────
VERB_IRI_BASE = "https://lxp.education.gov.il/xapi/moe/verbs/"
ACTIVITY_IRI_BASE = "https://lxp.education.gov.il/xapi/moe/activities/"
MOE_VERBS = {
    "enter", "exit", "initialized", "attempted", "answered", "scored", "completed", "skipped", "submitted",
    "read", "watched", "listened", "played", "paused", "play", "downloaded",
    "install", "assigned", "created", "joined", "leave", "voided",
    # 720 content→platform verbs (§"אינטראקציה של המשתמש עם התוכן"): a choice that is
    # not an assessable answer, and a learner-initiated request for help. They
    # only reached us through the ADL bridge before, so content reporting with
    # the MoE wire slugs had both dropped on the floor.
    "selected", "requested",
}
# Verbs that carry a scored result we fold into mastery.
SCORING_VERBS = {"answered", "attempted", "scored", "completed"}
# Media playback (720 §Played/Paused). Kata sends these against the COMPONENT
# with no screen id, so they are the only signal that a learner is on a video.
_MEDIA_VERBS = {"played", "paused", "play", "watched", "listened"}

# ── media ticker damper ──────────────────────────────────────────────────────
# Measured 29/07 on `…-01-02`: the content emitted a `played`+`paused` PAIR
# roughly once a second for as long as the learner sat on the screen — 182 of
# the 600 most recent stored events for one visit — all against the COMPONENT,
# with no screen id and an entirely null `result`. It is a decorative animation
# ticker on the provider side, not playback.
#
# We cannot ask Kata to stop, but we must not let it into the brain's evidence
# store: it costs writes, it dilutes every count built on `learning_events`, and
# a burst on a component that DOES hold a video could walk the pointer.
#
# The damper keeps the FIRST of a repeating media statement (so the pointer move
# and the "they were on the video" evidence both survive) and drops the
# identical repeats that follow inside the window. It only ever fires on
# statements that carry NO result payload — a real Played/Paused with a duration,
# a scrub position or a completion is always stored.
#
# Crucially the ticker is only noise while NOTHING ELSE is happening. Any
# non-media event (an `enter`, an answer, a selection) means the learner acted,
# so the next `played` is new information — playback on a screen Kata never
# announced is our only signal that a video started. The epoch below re-arms the
# damper on every such event, which is what keeps
# `test_lesson_navigation` A3b (playback after paging back) alive.
_MEDIA_NOISE_WINDOW_SECONDS = 5.0
_MEDIA_NOISE_MEMORY_LIMIT = 400
_media_last_seen: dict[str, float] = {}
_media_epoch: dict[str, int] = {}


def _is_empty_result(event: dict[str, Any]) -> bool:
    result = event.get("result") or {}
    return not any(value is not None for value in result.values())


def _names_a_foreign_component(event: dict[str, Any]) -> bool:
    """True when the object belongs to a DIFFERENT component of the same unit.

    Kata ids are hierarchical — `…-01-04` and `…-01-04-001` both start with the
    component id — so an ordinary item never trips this. It fires only when the
    content walks itself into a sibling component the launch does not cover.
    """
    launch_component = str(event.get("launch") or "")
    object_id = str(event.get("object_id") or "")
    unit_id = str(event.get("unit_id") or "")
    if not launch_component or not object_id or not unit_id:
        return False
    if launch_component in object_id:
        return False
    # Only judge ids we can actually read: an object naming this unit but not
    # this component is a sibling. Anything else (a differently-shaped provider
    # id) is left alone rather than guessed at.
    return f"{unit_id}-" in object_id


def _is_media_ticker_noise(event: dict[str, Any]) -> bool:
    """True for a bare media repeat we have just seen, with nothing in between."""
    learner = str(event.get("learner_id"))
    if event.get("verb") not in _MEDIA_VERBS:
        # The learner did something. Whatever media follows is a fresh signal.
        _media_epoch[learner] = _media_epoch.get(learner, 0) + 1
        return False
    if not _is_empty_result(event):
        return False
    key = "|".join(str(part) for part in (
        learner, _media_epoch.get(learner, 0), event.get("session_id"),
        event.get("verb"), event.get("object_id"), event.get("sub_item_id"),
    ))
    now = time.monotonic()
    previous = _media_last_seen.get(key)
    _media_last_seen[key] = now
    if len(_media_last_seen) > _MEDIA_NOISE_MEMORY_LIMIT:
        for stale in sorted(_media_last_seen, key=_media_last_seen.get)[:_MEDIA_NOISE_MEMORY_LIMIT // 2]:
            _media_last_seen.pop(stale, None)
    return previous is not None and (now - previous) < _MEDIA_NOISE_WINDOW_SECONDS

# Launches minted for an external content provider (Kata) may carry standard ADL
# verbs instead of the MoE wire slugs. They are accepted only for those launches,
# then mapped into the MoE vocabulary while retaining the original IRI for audit.
# The exact set the real Kata content emits is confirmed by launch+solve capture;
# this map is the documented ADL↔MoE bridge and is pruned to reality thereafter.
ADL_PROVIDER_VERB_MAP = {
    "http://adlnet.gov/expapi/verbs/initialized": "enter",
    "http://adlnet.gov/expapi/verbs/answered": "answered",
    "http://adlnet.gov/expapi/verbs/completed": "completed",
    "http://adlnet.gov/expapi/verbs/attempted": "attempted",
    "http://adlnet.gov/expapi/verbs/exited": "exit",
    "http://id.tincanapi.com/verb/selected": "selected",
    # What Kata actually sends for the 720 §Selected choice (captured live
    # 29/07): `…adb/verbs/selected` on the COMPONENT, category
    # `…/categories/learning-type`, `result.response` = the chosen path
    # ("listening" / "cards"). Without this IRI the statement was dropped, so the
    # platform never learned which representation the learner picked.
    "https://w3id.org/xapi/adb/verbs/selected": "selected",
    "http://id.tincanapi.com/verb/requested": "requested",
    # And what it actually sends for 720 §Requested — the content's OWN hint
    # button ("אפשר רמז?" inside the iframe). Captured live 29/07 against the
    # component, no screen id. Without this IRI the statement was dropped before
    # storage, so a learner leaning entirely on the content's hints looked like a
    # learner who never asked for help.
    "https://w3id.org/xapi/acrossx/verbs/requested": "requested",
    "http://id.tincanapi.com/verb/skipped": "skipped",
    "https://w3id.org/xapi/video/verbs/played": "played",
    "https://w3id.org/xapi/video/verbs/paused": "paused",
}
PROVIDER_INTERACTION_VERBS = {"selected", "requested", "skipped"}
# Non-native launch sources whose content reports through the relay (Kata) or the
# retired local simulator; both may use the ADL-compat verb bridge + scope check.
PROVIDER_SOURCES = {"kata", "content_provider"}


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
    if launch.get("src") not in PROVIDER_SOURCES:
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

    src = launch.get("src")
    if src not in PROVIDER_SOURCES:
        return True

    obj = statement.get("object") or {}
    object_id = str(obj.get("id") or "") if isinstance(obj, dict) else ""
    component_id = str(launch.get("cmp") or "")
    unit_id = str(launch.get("unit") or "")

    if src == "content_provider":
        # Legacy simulator ids are YuviDori-prefixed and self-describing — reject
        # an obvious attempt to report a DIFFERENT provider component/unit.
        if "YuviDori-" in object_id and component_id not in object_id and unit_id not in object_id:
            return False
        return True

    # Kata: content reports through the signed per-launch token (verified before
    # we get here) and Kata relays only this launch's statements. The token +
    # actor match ARE the boundary — the object-id format is content-defined, so
    # we don't reject on it (a strict guess would drop real events).
    return True


# Kata question objects are `…/{subContentId}/q{N}` (or `#q{N}`). Question ids
# repeat across sub-content items (`q1` in nearly every screen), so the SUB-ITEM
# id — not the question id — is the identity of "the question the learner is on".
_ITEM_QUESTION_TAIL = re.compile(
    r"(?:^|[/#])(?P<item>[^/#]+)[/#](?P<question>q\d+)$", re.IGNORECASE
)


def split_item_question(object_id: Any) -> tuple[Optional[str], Optional[str]]:
    """Parse a provider object id into (sub_item_id, question_id), else (None, None)."""
    if not isinstance(object_id, str) or not object_id:
        return None, None
    match = _ITEM_QUESTION_TAIL.search(object_id.rstrip("/"))
    if match:
        return match.group("item"), match.group("question").lower()
    return None, None


def resolve_item_question(
    object_id: Any, component_id: Optional[str]
) -> tuple[Optional[str], Optional[str]]:
    """Resolve (sub_item_id, question_id) from any provider object id.

    Two shapes reach us:
    - ANSWER objects: ``…/{sub_item}/q{N}`` → ``(sub_item, qN)`` (via
      :func:`split_item_question`).
    - NAVIGATION objects (Kata emits ``initialized`` per screen): ``…/{sub_item}``
      with NO question tail. The tail IS the screen sub-item id — it extends the
      launched component id (``…-01-02`` → ``…-01-02-002``). Detecting it lets
      ``current_state`` advance when the learner *navigates*, not only when they
      *answer* — the difference between the coach knowing the current question or
      lagging a screen behind. A tail equal to the component id is component-level
      (no sub-item).
    """
    item, question = split_item_question(object_id)
    if item:
        return item, question
    tail = _object_tail(object_id)
    if component_id and tail and tail.startswith(f"{component_id}-"):
        return tail, None
    return None, None


def _selection_category(statement: dict[str, Any]) -> Optional[str]:
    """The kind of choice a `selected` statement reports (720 selection dictionary).

    Kata sends `category: [{id: "http://720.edu.il/xapi/categories/learning-type"}]`
    with `result.response` = "listening" / "cards" — which representation the
    learner chose for a teaching screen.
    """
    context = statement.get("context") or {}
    activities = context.get("contextActivities") or context
    categories = activities.get("category") if isinstance(activities, dict) else None
    if isinstance(categories, dict):
        categories = [categories]
    for entry in categories or []:
        identifier = entry.get("id") if isinstance(entry, dict) else None
        if isinstance(identifier, str) and identifier:
            return _object_tail(identifier)
    return None


def _object_tail(object_id: Any) -> str:
    if not isinstance(object_id, str):
        return ""
    return object_id.rstrip("/").rsplit("/", 1)[-1].rsplit("#", 1)[-1]


def is_learning_type_choice(event: dict[str, Any]) -> bool:
    """A 720 `selected` naming which REPRESENTATION the learner picked.

    Emitted the moment they commit a path on a playlist screen ("לצפות בסרטון" /
    "להפוך קלפים"), so it is positional evidence as well as a preference.
    """
    return (
        event.get("verb") == "selected"
        and event.get("selection_category") == "learning-type"
    )


async def _reconcile_sub_item_id(event: dict[str, Any]) -> None:
    """Rewrite ``event['sub_item_id']`` from the Kata player screen id to the
    catalog sub-content id (see ``kata_catalog.resolve_catalog_item_id``).

    Uses this session's already-visited screens to anchor the ordinal offset for
    question-ambiguous screens. Best-effort: any failure leaves the id untouched.
    """
    runtime_item = event.get("sub_item_id")
    component_id = event.get("launch")
    if not runtime_item or not component_id:
        return
    # Preserve the raw PLAYER id: `sub_item_id` becomes the catalog id, so the
    # ordinal anchor for LATER events must read runtime suffixes from here (prior
    # `sub_item_id`s are already catalog ids and would corrupt the offset math).
    event["runtime_item_id"] = runtime_item
    try:
        from app.services import kata_catalog

        await kata_catalog.ensure_loaded()
        seen: list[str] = []
        session_id = event.get("session_id")
        if session_id:
            prior = await get_session_events(event["learner_id"], session_id)
            seen = [
                e.get("runtime_item_id") or e.get("sub_item_id")
                for e in prior
                if e.get("runtime_item_id") or e.get("sub_item_id")
            ]
        resolved = kata_catalog.resolve_catalog_item_id(
            component_id,
            runtime_item,
            question_id=event.get("question_id"),
            seen_item_ids=seen,
        )
        if resolved and resolved != runtime_item:
            event["sub_item_id"] = resolved
    except Exception as exc:  # reconciliation must never block ingest
        print(f"⚠️ sub-item reconciliation skipped: {type(exc).__name__}")


def is_component_completion(event: dict[str, Any]) -> bool:
    """True only for a COMPONENT-level ``completed`` (720 §"Completed").

    Kata may emit ``completed`` per screen/item as well as for the whole
    component. Only the component-level one ("object == the component") should
    remove the component from the roadmap, close the coach thread, or compute
    pace — a per-screen ``completed`` (object == a sub-item, e.g. ``…-04-001``
    or ``…/q1``) is item progress, not "the lesson is done". Sub-item ids are
    ``{component}-NNN`` so a prefix match would false-positive; we match the
    exact object tail against the launched component id.
    """
    if event.get("verb") != "completed":
        return False
    component_id = str(event.get("launch") or "")
    if not component_id or event.get("sub_item_id"):
        return False
    object_id = event.get("object_id")
    # A `completed` with no explicit object is the historical component-level
    # shape (seed/native reference content) — treat it as component completion.
    # A per-screen `completed` always carries a sub-item object, so it is caught
    # by the exact tail check below and correctly excluded.
    if not object_id:
        return True
    return _object_tail(object_id) == component_id


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
    sub_item_id, parsed_question_id = resolve_item_question(object_id, launch.get("cmp"))
    question_id = ext.get("question_id") or parsed_question_id
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
        "sub_item_id": sub_item_id,
        "objective_id": ext.get("objective_id") or launch.get("obj"),
        "subject": ext.get("subject") or launch.get("subj"),
        "question_id": question_id,
        "is_assessment": bool(ext.get("is_assessment", launch.get("assessment", False))),
        "misconception": ext.get("misconception"),
        "resume_token": ext.get("resume_token"),
        # 720 §Selected: the SAME verb carries several kinds of choice
        # (learningType / practiceDecision / isUnderstood / …), told apart only
        # by the context category. Kept so "cards" is never read as an answer.
        "selection_category": _selection_category(statement),
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


async def record_path_choice(
    learner_id: str, component_id: str, unit_id: Optional[str], choice: str,
) -> dict[str, Any]:
    """Store a route decision the LEARNER made, not the content.

    720 §1 makes פעלנות a design principle, and the selection dictionary already
    carries the provider's version of this (`practiceDecision` / `isRepeat`) when
    the choice is offered inside a component. This is the platform's own
    affordance — "אני רוצה עוד תרגול" in the completion dialog — recorded as the
    same kind of evidence so the path engine reads both through one rule.

    Deliberately NOT an xAPI statement: it describes a choice about our routing,
    not an interaction with provider content, so it is never relayed onward.
    """
    safe_id = normalize_learner_id(learner_id)
    event = {
        "_id": hashlib.sha256(
            f"{safe_id}|{component_id}|{choice}|{datetime.now(timezone.utc).isoformat()}".encode()
        ).hexdigest(),
        "learner_id": safe_id,
        "verb": "path_choice",
        "launch": component_id,
        "unit_id": unit_id,
        "response": choice,
        "source": "platform",
        "occurred_at": datetime.now(timezone.utc).isoformat(),
        "stored_at": datetime.now(timezone.utc).isoformat(),
    }
    collection = await _events_collection()
    if collection is not None:
        try:
            await collection.update_one({"_id": event["_id"]}, {"$setOnInsert": event}, upsert=True)
            return event
        except Exception as exc:
            print(f"⚠️ path choice write failed, using fallback: {exc}")
    _fallback_append(event)
    return event


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
    # Phase 0 raw audit: record EXACTLY what arrived, before any scope/verb
    # filtering, so out-of-scope statements and verbs outside the MoE list are
    # still captured (needed for verb-map extension + idle-signal discovery).
    try:
        from app.services import xapi_audit

        xapi_audit.capture(statement, launch)
    except Exception:
        pass
    if not statement_matches_launch(statement, launch):
        return {"stored": False, "reason": "statement_outside_launch_scope"}
    event = normalize_statement(statement, launch)
    if event is None:
        return {"stored": False, "reason": "verb_not_in_moe_list"}

    # Reconcile the Kata PLAYER screen id to the CATALOG sub-content id before
    # storing/folding, so the event, current_state, AND teacher analytics all key
    # on the catalog item — otherwise the coach grounds hints on the NEXT item
    # (player `-002` == catalog `-001`, a leading-cover offset). Self-anchored
    # from the catalog + this session's visited screens; best-effort, never fatal.
    await _reconcile_sub_item_id(event)

    # Drop the provider's decorative animation ticker before it reaches the
    # evidence store. Checked AFTER reconciliation so the key matches the item
    # the rest of the pipeline uses, and after the first of a burst has already
    # been stored and folded.
    if _is_media_ticker_noise(event):
        return {"stored": False, "reason": "media_repeat_within_window"}

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
        # Kata's content self-routes ACROSS component boundaries: measured
        # 29/07, three seconds after `completed` on `…-01-03` it emitted
        # `initialized` for `…-01-04` — still inside the launch minted for
        # `-03`, while the platform's completion dialog was waiting for the
        # learner to choose. 720 F1 gives the platform the route between
        # components, so we keep the statement (it is real evidence of what the
        # learner did, and the report to Kata needs it) but refuse to FOLD it:
        # otherwise `-04`'s work is booked as `-03` progress and mastery accrues
        # to the wrong component.
        if _names_a_foreign_component(event):
            print(
                f"⚠️ provider self-advanced outside the launch: "
                f"{event.get('object_id')} reported on launch {event.get('launch')}"
            )
            return {"stored": True, "folded": False, "reason": "foreign_component"}
        # Isolate the brain fold: a bug folding ONE event must not 500 the
        # request, because the provider would then retry, find the id already
        # stored, ack it as a duplicate, and lose the mastery update forever
        # (and drop later statements in the same batch). Store-then-fold means
        # the event is preserved; a fold failure is logged, not fatal.
        effective_state: Optional[dict[str, Any]] = None
        try:
            await _update_item_stats(event)
            effective_state = await _apply_event_to_brain(event)
        except Exception as exc:
            print(f"⚠️ brain fold failed for {event.get('_id')}: {type(exc).__name__}")
        try:
            await _record_content_support(event, effective_state)
        except Exception as exc:  # analytics must never break ingest
            print(f"⚠️ content support record failed: {type(exc).__name__}")
        if is_component_completion(event):
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
            # Push the screen key FIRST so the companion re-keys before any nudge
            # from this same event (a wrong answer that also advances the screen
            # must land the client on the new screen, then react). Built from the
            # FOLDED state (sticky question included) so q1→q2 on one screen is a
            # real change; the same-key dedupe inside publish_screen_change makes
            # bare re-emits cheap.
            if event.get("sub_item_id"):
                from app.agents import tutor_decision
                key_state = effective_state or {
                    "component_id": event.get("launch"),
                    "item_id": event["sub_item_id"],
                    "question_id": event.get("question_id"),
                }
                triggers.publish_screen_change(
                    event["learner_id"],
                    tutor_decision.support_question_key(key_state, event.get("launch")),
                    component_id=event.get("launch"),
                    unit_id=event.get("unit_id"),
                )
            await triggers.evaluate(event["learner_id"], event)
        except Exception as exc:  # never block ingest on trigger evaluation
            print(f"⚠️ trigger evaluation failed: {exc}")
        # Live presence for the teacher's classroom strip. After the event is
        # stored, so presence can never claim activity that was not recorded,
        # and guarded separately — a presence failure must not cost the learner
        # their trigger evaluation or the LRS forward.
        try:
            from app.services import presence
            presence.note_event(event["learner_id"], event)
        except Exception as exc:
            print(f"⚠️ presence update failed: {type(exc).__name__}")
        # MoE LRS forward (720): enrich the raw content statement with the
        # outbound envelope and enqueue — first sight only, never blocks ingest.
        try:
            await _forward_to_moe_lrs(statement, launch, event["learner_id"], event)
        except Exception as exc:
            print(f"⚠️ MoE LRS forward skipped: {type(exc).__name__}")
    return {"stored": True, "duplicate": not is_new, "event_id": event["_id"]}


async def _record_content_support(
    event: dict[str, Any], position: Optional[dict[str, Any]] = None
) -> None:
    """Log help and choices the learner took INSIDE the content (720 §3.3).

    Two signals were reaching `learning_events` and stopping there:

    - `requested` — the content's own hint button ("אפשר רמז?" inside the Kata
      iframe). The 720 criteria name hint usage from the content explicitly as
      evidence for the platform's routing decisions, but only Yuvi's own buttons
      were counted, so a learner who leaned entirely on the content's hints
      looked like a learner who never asked for help.
    - `selected` self-reports — practiceDecision / isUnderstood / isRepeat /
      externalLearning. `learningType` already drives the coach's grounding; the
      other four were parsed and dropped.

    Both arrive against the COMPONENT with no screen id, so the row is anchored
    to the position the same event just folded (`position`) — otherwise every
    help request lands in one nameless bucket instead of on the question the
    learner was actually stuck on.

    Best-effort and side-effect free for the learner.
    """
    from app.services import learner_activity

    verb = event.get("verb")
    if verb not in ("requested", "selected"):
        return
    if verb == "selected" and is_learning_type_choice(event):
        return   # already consumed as position + chosen representation

    kind = "content_hint" if verb == "requested" else "content_choice"
    meta: Optional[dict[str, Any]] = None
    if verb == "selected":
        meta = {
            "category": event.get("selection_category"),
            "response": (event.get("result") or {}).get("response"),
        }
    where = position or {}
    await learner_activity.record(
        event["learner_id"],
        kind,
        component_id=event.get("launch") or where.get("component_id"),
        item_id=event.get("sub_item_id") or where.get("item_id"),
        question_id=event.get("question_id") or where.get("question_id"),
        objective_id=event.get("objective_id"),
        subject=event.get("subject"),
        meta=meta,
    )


async def _forward_to_moe_lrs(
    statement: dict[str, Any],
    launch: dict[str, Any],
    learner_id: str,
    event: Optional[dict[str, Any]] = None,
) -> None:
    """Forward one content-origin statement to the Ministry LRS.

    Session: the learner's active MoE login session (minted at login); the
    per-launch `sid` is only a fallback so content played outside a tracked
    login still carries *a* session grouping.

    The content knows only its own object, so everything the ministry asks for
    ABOVE it — the component and unit in `grouping`, the component in `parent`,
    and all three levels' metadata — is resolved here from the catalog, together
    with the per-verb fields the integration review found missing.
    """
    from app.auth.repository import get_user_by_id
    from app.services.lrs import config as lrs_config
    from app.services.lrs import hierarchy as lrs_hierarchy
    from app.services.lrs import reporter as lrs_reporter

    if not lrs_config.is_enabled():
        return
    user = await get_user_by_id(learner_id)
    session_id = (user or {}).get("current_moe_session_id") or launch.get("sid")
    event = event or {}
    ancestry = await lrs_hierarchy.for_content(
        event.get("launch") or launch.get("cmp"),
        event.get("sub_item_id"),
        unit_id=event.get("unit_id") or launch.get("unit"),
    )
    context_extensions, result_extra = await _content_report_fields(event, statement)
    # The content-vendor id belongs to the CONTENT, not to the deployment: it is
    # "מזהה הפריט בקטלוג החינוכי", so it is resolved per event from the item /
    # component / unit this statement is about.
    ecat_item_id = await lrs_hierarchy.ecat_item_for(
        event.get("launch") or launch.get("cmp"),
        event.get("sub_item_id"),
        unit_id=event.get("unit_id") or launch.get("unit"),
    )
    await lrs_reporter.report_content_statement(
        learner_id,
        session_id,
        statement,
        ecat_item_id=ecat_item_id,
        hierarchy=ancestry,
        context_extensions=context_extensions,
        result_extra=result_extra,
        # A question-level relay (an answer to one question inside a screen)
        # nests under its questionnaire screen in grouping/parent, per the
        # ministry's answered example.
        object_below_self=bool(
            event.get("verb") in {"answered", "attempted"} and event.get("question_id")
        ),
    )


# The xAPI Video Profile's own field names for "where in the clip" and "how long
# the clip is", both in SECONDS — exactly what the MoE's `mediaPosition` /
# `mediaDuration` want. Reading the STANDARD names (rather than anything Kata
# specific) means any provider that follows the profile satisfies the ministry
# automatically, and Kata starts complying the day it sends them.
_VIDEO_TIME_KEYS = (
    "https://w3id.org/xapi/video/extensions/time",
    "https://w3id.org/xapi/video/extensions/time-to",
)
_VIDEO_LENGTH_KEY = "https://w3id.org/xapi/video/extensions/length"


def _video_profile_seconds(statement: dict[str, Any]) -> dict[str, Any]:
    """Pull position/length out of a relayed statement, if it carries them.

    Both `result.extensions` and `context.extensions` are searched because the
    profile puts `time` on the result and `length` on the context, and players
    are inconsistent about it. Non-numeric values are ignored rather than
    coerced — a bad number is worse than an absent one.
    """
    pools = [
        (statement.get("result") or {}).get("extensions") or {},
        (statement.get("context") or {}).get("extensions") or {},
    ]

    def pick(keys: tuple[str, ...] | str) -> Optional[float]:
        wanted = (keys,) if isinstance(keys, str) else keys
        for pool in pools:
            for key in wanted:
                value = pool.get(key)
                if isinstance(value, bool) or not isinstance(value, (int, float)):
                    continue
                if value >= 0:
                    return round(float(value), 3)
        return None

    found: dict[str, Any] = {}
    position = pick(_VIDEO_TIME_KEYS)
    length = pick(_VIDEO_LENGTH_KEY)
    if position is not None:
        found["mediaPosition"] = int(position) if position == int(position) else position
    if length is not None:
        found["mediaDuration"] = int(length) if length == int(length) else length
    return found


async def _content_report_fields(
    event: dict[str, Any], statement: Optional[dict[str, Any]] = None
) -> tuple[dict[str, Any], dict[str, Any]]:
    """The per-verb fields the MoE review asked for on relayed content events.

    - answered → `questionId` (not `question_id`), `questionType`, `attemptNumber`
    - media    → `mediaFormat`, `mediaPosition`/`mediaDuration` when the player
      reports them, and `result.duration` on paused/completed
    Everything is read from what we already know (catalog + stored events + the
    relayed statement). A value nobody told us — the position inside a clip that
    Kata never reports — is left out rather than invented.
    """
    verb = event.get("verb")
    component_id = event.get("launch")
    item_id = event.get("sub_item_id")
    extensions: dict[str, Any] = {}
    result_extra: dict[str, Any] = {}

    if verb in {"answered", "attempted"} and event.get("question_id"):
        from app.services import kata_catalog

        question_id = event["question_id"]
        extensions["questionId"] = question_id
        extensions["attemptNumber"] = await _attempt_number(event)
        rows = kata_catalog.questions_for_item(component_id, item_id)
        match = next(
            (r for r in rows if (r.get("questionId") or "") == question_id), None
        )
        if match and match.get("questionType"):
            extensions["questionType"] = match["questionType"]

    if verb == "completed" and not _is_media_item(component_id, item_id):
        # The ministry's questionnaire example: a completed questionnaire
        # reports `result.completion: true` (media completions carry only
        # duration). Tautological on a completed event, so never invented.
        result_extra["completion"] = True

    if verb in {"played", "paused", "watched", "listened"} or (
        verb == "completed" and _is_media_item(component_id, item_id)
    ):
        media_format = _media_format(component_id, item_id)
        if media_format:
            extensions["mediaFormat"] = media_format
        extensions.update(_video_profile_seconds(statement or {}))
        elapsed = (event.get("timing") or {}).get("elapsed_since_previous_seconds")
        if verb in {"paused", "completed"} and isinstance(elapsed, (int, float)):
            from app.services.lrs.statements import iso_duration

            result_extra["duration"] = iso_duration(elapsed)
    return extensions, result_extra


def _media_format(component_id: Optional[str], item_id: Optional[str]) -> Optional[str]:
    from app.services import kata_catalog

    profile = kata_catalog.item_profile(component_id, item_id) if item_id else {}
    media = (profile or {}).get("media_format")
    return media if media in {"video", "audio", "animation"} else None


def _is_media_item(component_id: Optional[str], item_id: Optional[str]) -> bool:
    return _media_format(component_id, item_id) is not None


async def _attempt_number(event: dict[str, Any]) -> int:
    """How many times this learner has answered THIS question in this session."""
    try:
        prior = await get_session_events(event["learner_id"], event.get("session_id"))
    except Exception:
        return 1
    same = [
        e for e in prior
        if e.get("verb") in {"answered", "attempted"}
        and e.get("sub_item_id") == event.get("sub_item_id")
        and e.get("question_id") == event.get("question_id")
        and e.get("_id") != event.get("_id")
    ]
    return len(same) + 1


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
        from app.services import kata_catalog, kata_client
        await kata_catalog.ensure_loaded()
        component = kata_catalog.get_component(component_id)
        if component is None:
            _unit, component = await kata_client.resolve_component(
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


def _completion_credit_key(event: dict[str, Any]) -> str:
    """Identity of "this screen finished, in this sitting" for mastery credit."""
    return "|".join(
        str(part or "")
        for part in (event.get("session_id"), event.get("sub_item_id") or event.get("launch"))
    )


def _already_credited(event: dict[str, Any], prior_state: dict[str, Any]) -> bool:
    """True when this screen's evidence has already been folded into mastery.

    Kata reports a question TWICE: `answered …-001/q1` and then, on leaving,
    `completed …-001`. Both are scoring verbs, but only `answered` counts an
    attempt — so one question added two successes and one attempt. It re-emits
    `completed success=true` again for every screen the learner pages BACK
    through, and one walk backwards through a finished lesson added seven more.
    Measured after a full clean run: `attempts 13 · successes 15 · failures 6`
    — 21 verdicts over 13 attempts, which inflated confidence, the success
    streak, and with them `achieved` and `level`. Mastery invented by navigation
    rather than earned by evidence, which "numbers are never invented" forbids.

    So a `completed` counts only when the screen has no scored evidence yet.
    That keeps a **closed** content unit working — 720 §3.2 explicitly allows a
    component that routes internally and reports only its own completion, and
    that completion is its one piece of evidence — while a completion that merely
    echoes an answer we already scored adds nothing.

    An `answered` is never gated: a second genuine attempt IS new evidence.
    """
    if event.get("verb") != "completed":
        return False
    key = _completion_credit_key(event)
    return key in ((prior_state or {}).get("scored_screens") or [])


_CREDIT_MEMORY_LIMIT = 200


async def _apply_event_to_brain(event: dict[str, Any]) -> dict[str, Any]:
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

    # Read prior state once (reused by the scoring block below) so the sticky
    # question rule can compare against where the learner just was.
    brain = await get_brain(learner_id)
    prior_state = brain.get("current_state") or {}

    # Live "where am I" — advance current_state on both navigation AND answers.
    # A resolvable sub-item marks a real screen/question object. STICKY question:
    # a Kata `initialized` re-emits the screen (sub_item, question=None) mid-task,
    # which used to CLEAR question_id and make the support/screen key oscillate
    # (`…|q1` ↔ `…|`). It also erased the q1↔q2 distinction when TWO sub-questions
    # (e.g. סעיף א/ב) live on ONE screen — so moving q1→q2 produced no screen
    # change and no reaction. Rule: adopt the event's question only on a NEW
    # screen (item changed) or when a specific question (non-None) arrives;
    # otherwise keep the sticky question so a bare re-emit is a no-op.
    # Component-level objects (enter/completed at the root) have no sub-item and
    # must NOT overwrite item_id with a bare URL (would strand the coach a screen
    # behind, grounding hints on the wrong question).
    # "Where the learner is" must follow the order things HAPPENED, not the order
    # Kata's relay delivered them. Observed in one real batch, all received in the
    # same second: initialized -003 (12:24:23), initialized -005 (12:24:38),
    # initialized -004 (12:24:26), initialized -003 again — out of order and
    # duplicated. Folding by arrival left the pointer on whatever landed last, so
    # the coach commented on a question the learner had already left, and an idle
    # nudge opened a thread on a question they were not looking at.
    #
    # Rule: the pointer only moves FORWARD IN TIME. A genuinely newer event that
    # names an earlier screen still moves it — that is the learner paging back,
    # which must keep working — but a stale or replayed statement can never
    # rewind them. Events with no usable timestamp fall through unguarded rather
    # than being dropped.
    from app.services.learning_timing import parse_timestamp

    event_at = parse_timestamp(event.get("occurred_at") or event.get("stored_at"))
    pointer_at = parse_timestamp(prior_state.get("at"))
    # The clock is only meaningful WITHIN one component's timeline. Across a
    # different lesson (or a relaunch, which clears it) there is nothing to
    # compare, and comparing anyway would freeze the learner out of the new one.
    same_component = (
        not prior_state.get("component_id")
        or not event.get("launch")
        or prior_state.get("component_id") == event.get("launch")
    )
    pointer_is_stale = bool(
        same_component and event_at and pointer_at and event_at < pointer_at
    )

    if event.get("sub_item_id") and pointer_is_stale:
        pass   # older than where we already are — position is not touched
    elif event.get("sub_item_id"):
        new_item = event["sub_item_id"]
        set_updates["current_state.item_id"] = new_item
        if event_at:
            set_updates["current_state.at"] = event.get("occurred_at") or event.get("stored_at")
        incoming_question = event.get("question_id")
        if new_item != prior_state.get("item_id"):
            # Arrival. Kata's `initialized` names the screen but no question, so
            # taking it verbatim left question_id None until the first `answered`
            # — re-keying the SAME question mid-way and splitting its chat thread
            # (observed: `…|001|` with 13 messages AND `…|001|q1` with 13 more).
            # Resolve the screen's only question up front; ambiguous screens
            # (two sub-questions) still wait for the event to say which.
            if incoming_question is None:
                from app.services import kata_catalog

                incoming_question = kata_catalog.default_question_id(
                    event.get("launch"), new_item
                )
            set_updates["current_state.question_id"] = incoming_question
            # The representation they picked belongs to the screen that offered
            # it. Leaving it set made the coach talk about "the clip you chose"
            # two questions later. (The `selected` branch below re-sets it in the
            # same update when the arrival IS the choice.)
            set_updates["current_state.learning_choice"] = None
        elif incoming_question is not None:
            set_updates["current_state.question_id"] = incoming_question
        # else: same screen, no question (bare re-emit) — keep sticky question_id.
    elif event.get("question_id") and not pointer_is_stale:
        set_updates["current_state.question_id"] = event["question_id"]
    elif (
        event.get("verb") in _MEDIA_VERBS or is_learning_type_choice(event)
    ) and not pointer_is_stale:
        # The learner has stepped onto a media screen — but Kata reports both
        # `played`/`paused` and the learning-type `selected` against the
        # COMPONENT, with no screen, and its `initialized` for the video screen
        # arrives late or not at all. Observed 29/07: `completed` for screen -002
        # at 08:12:17, then eleven `played`/`paused` over the next 90s and NO
        # `initialized` for -003 — and again at 12:04:33, a `selected` "listening"
        # followed by FIVE MINUTES of the learner working through the -003
        # playlist with the pointer, the chat's marked thread and the coach's
        # grounding all still on the question they had just finished.
        #
        # Both are attributed only when they cannot mean anything else: the
        # screen they are on has no media of its own, and the very NEXT screen is
        # the one that plays. Anything looser would guess.
        from app.services import kata_catalog

        watching = kata_catalog.next_item_if_watchable(
            event.get("launch"), prior_state.get("item_id")
        )
        if watching:
            set_updates["current_state.item_id"] = watching
            set_updates["current_state.question_id"] = kata_catalog.default_question_id(
                event.get("launch"), watching
            )
            if event_at:
                set_updates["current_state.at"] = (
                    event.get("occurred_at") or event.get("stored_at")
                )
    # Which representation the learner chose for a teaching screen ("listening"
    # = watch the clip, "cards" = flip the info cards). The screens themselves
    # are identical to us either way, so this is the only way the coach can talk
    # about what the learner is actually looking at.
    if event.get("verb") == "selected" and event.get("selection_category") == "learning-type":
        chosen = (event.get("result") or {}).get("response")
        if chosen:
            set_updates["current_state.learning_choice"] = str(chosen)[:40]
    if event.get("launch"):
        set_updates["current_state.component_id"] = event["launch"]
    if event.get("unit_id"):
        set_updates["current_state.unit_id"] = event["unit_id"]
    if event.get("resume_token") is not None:
        set_updates["current_state.resume_token"] = event["resume_token"]
    if is_component_completion(event):
        try:
            pace = await _compute_pace(event)
        except Exception:
            pace = None
        if pace:
            set_updates["current_state.pace"] = pace
        if (event.get("result") or {}).get("success"):
            set_updates["current_state.hint_ladder"] = {}   # fresh ladder next task
        # A completed pin is spent (#249). Cleared here — the one place
        # completion is adjudicated — so the hero and the route both stop
        # steering to it in the same moment, with no second judge to drift.
        # `launch` is the id `is_component_completion` matched on. Cleared on a
        # failed completion too: done-is-done, and the after-fail routing owns
        # what comes next — a pin that survived failure would loop the child.
        pinned_component = (brain.get("pinned_next") or {}).get("component_id")
        if pinned_component and str(pinned_component) == str(event.get("launch") or ""):
            set_updates["pinned_next"] = None

    if objective_id and verb in SCORING_VERBS and not _already_credited(event, prior_state):
        now = event.get("occurred_at") or _now()
        # Every scoring verb marks its screen, so the `completed` that follows an
        # answer finds the screen already accounted for.
        credited = list((prior_state or {}).get("scored_screens") or [])
        credit_key = _completion_credit_key(event)
        if credit_key not in credited:
            credited.append(credit_key)
            set_updates["current_state.scored_screens"] = credited[-_CREDIT_MEMORY_LIMIT:]
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

    # Effective "where am I now" after this fold — the caller builds the
    # screen_change key from this (sticky question included), so q1→q2 on one
    # screen registers as a real question change.
    return {
        "component_id": event.get("launch") or prior_state.get("component_id"),
        "item_id": set_updates.get("current_state.item_id", prior_state.get("item_id")),
        "question_id": set_updates.get("current_state.question_id", prior_state.get("question_id")),
    }


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
