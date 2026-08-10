"""Teacher alerts — durable, deduped, replayable.

Distinct from presence (too chatty to persist) and from notifications (Phase 5,
discrete addressed messages with read/unread). An alert is a **stateful
condition**: it opens, it may recur, a teacher acknowledges it, and it resolves.
Forcing that into an unread flag would mean "reading" it marks the condition
handled, which is not the same thing at all.

Three properties earn their complexity:

**Evidence is mandatory.** `raise_alert` refuses to store an alert without it.
That is the MoE explainability rule — "כשהמערכת מסמנת תלמיד כ'דורש תשומת לב',
היא חייבת להציג את הנתון הגולמי שהוביל למסקנה" — expressed as a schema
constraint rather than a convention someone remembers.

**Deterministic `_id`.** `{teacher_id}:{learner_id}:{kind}:{bucket}` where the
bucket is the day for `inactive`, the objective for `struggling`, the goal for
`goal_*`. A recurrence bumps `occurrences` instead of ringing the bell twice, and
an SSE replay after a reload cannot produce duplicates.

**Monotonic `seq` per teacher.** The replay cursor. A client that reconnects
passes `?since=<seq>` and gets exactly what it missed — no gaps, no repeats.

Recipients are resolved from the live roster **at publish time**, which is where
group scoping is enforced for realtime: a teacher can never be handed an alert
for a learner outside their groups, whatever the caller passed.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from app.services import realtime

COLLECTION = "teacher_alerts"

KINDS = (
    "help_requested", "safety_flag", "struggling", "inactive",
    "low_success_streak", "goal_submitted", "goal_help_requested", "coach_handoff",
)

SEVERITY_INFO = "info"
SEVERITY_ATTENTION = "attention"
SEVERITY_URGENT = "urgent"
SEVERITIES = (SEVERITY_INFO, SEVERITY_ATTENTION, SEVERITY_URGENT)

STATUS_OPEN = "open"
STATUS_ACKNOWLEDGED = "acknowledged"
STATUS_RESOLVED = "resolved"

# Pseudo-status meaning "anything a teacher still has to look at".
LIVE = "live"

# Severity per kind. A child in distress and a child who has not logged in for a
# week are not the same interrupt, and the UI sorts on this.
_SEVERITY = {
    "safety_flag": SEVERITY_URGENT,
    "help_requested": SEVERITY_URGENT,
    "coach_handoff": SEVERITY_ATTENTION,
    "struggling": SEVERITY_ATTENTION,
    "low_success_streak": SEVERITY_ATTENTION,
    "inactive": SEVERITY_ATTENTION,
    "goal_help_requested": SEVERITY_ATTENTION,
    "goal_submitted": SEVERITY_INFO,
}

# In-memory sequence per teacher, seeded from storage on first use. The counter
# is per teacher rather than global so one busy class cannot make another
# teacher's cursor jump by thousands.
_seq: dict[str, int] = {}
# Fallback store when there is no database (dev box, tests).
_memory: dict[str, dict[str, Any]] = {}


class AlertError(ValueError):
    """An alert was malformed. Raised rather than silently stored."""


def _collection():
    """Resolve the handle through a lazy import, deliberately.

    `from app.brain.repository import _get_collection_named` at module level
    binds the function into this namespace, where no test patch can reach it —
    which is how an earlier run of this module's own tests wrote rows into the
    production database. Resolving per call keeps the seam patchable.
    """
    from app.brain.repository import _get_collection_named
    return _get_collection_named(COLLECTION)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def alert_id(teacher_id: str, learner_id: str, kind: str, bucket: str) -> str:
    return f"{teacher_id}:{learner_id}:{kind}:{bucket}"


def default_bucket(kind: str, *, objective_id: Optional[str] = None,
                   goal_id: Optional[str] = None, flag_id: Optional[str] = None,
                   at: Optional[str] = None) -> str:
    """What counts as "the same alert again".

    Chosen per kind so a recurrence is deduped but a genuinely new occurrence is
    not swallowed: a second struggling objective is news, the same one an hour
    later is not.
    """
    if kind in {"goal_submitted", "goal_help_requested"} and goal_id:
        return goal_id
    if kind == "safety_flag" and flag_id:
        return flag_id
    if kind in {"struggling", "low_success_streak"} and objective_id:
        return objective_id
    # Daily bucket: "still inactive" is one alert per day, not one per check.
    return (at or _now())[:10]


async def latest_seq(teacher_id: str) -> int:
    """The highest `seq` this teacher has ever been issued.

    The snapshot cursor must come from here, not from the alerts it happens to
    be returning: a teacher who has resolved everything would otherwise get a
    cursor of 0 and have their whole alert history replayed on the next
    reconnect.
    """
    await _seed_seq(teacher_id)
    return _seq[teacher_id]


async def _seed_seq(teacher_id: str) -> None:
    if teacher_id not in _seq:
        highest = 0
        handle = _collection()
        if handle is not None:
            try:
                cursor = handle.find({"teacher_id": teacher_id}).sort("seq", -1).limit(1)
                async for row in cursor:
                    highest = int(row.get("seq") or 0)
            except Exception:  # pragma: no cover
                highest = 0
        else:
            highest = max(
                (int(row.get("seq") or 0) for row in _memory.values()
                 if row.get("teacher_id") == teacher_id),
                default=0,
            )
        _seq[teacher_id] = highest


async def _next_seq(teacher_id: str) -> int:
    """The next sequence number for this teacher. Monotonic, never reused."""
    await _seed_seq(teacher_id)
    _seq[teacher_id] += 1
    return _seq[teacher_id]


async def _store(document: dict[str, Any]) -> dict[str, Any]:
    handle = _collection()
    if handle is None:
        _memory[document["_id"]] = document
        return document
    try:
        await handle.update_one({"_id": document["_id"]}, {"$set": document}, upsert=True)
    except Exception as exc:  # pragma: no cover
        print(f"⚠️ alert store failed: {type(exc).__name__}: {exc}")
        _memory[document["_id"]] = document
    return document


async def _load(alert_key: str) -> Optional[dict[str, Any]]:
    handle = _collection()
    if handle is None:
        return _memory.get(alert_key)
    try:
        return await handle.find_one({"_id": alert_key})
    except Exception:  # pragma: no cover
        return _memory.get(alert_key)


async def raise_alert(
    learner_id: str,
    kind: str,
    *,
    evidence: dict[str, Any],
    title_key: str,
    params: Optional[dict[str, Any]] = None,
    group_id: Optional[str] = None,
    bucket: Optional[str] = None,
    severity: Optional[str] = None,
) -> list[dict[str, Any]]:
    """Raise `kind` for `learner_id` to every teacher who may see them.

    Returns the stored alerts (one per teacher), or `[]` when nobody teaches this
    learner — which is not an error, it is the orphan case the admin console
    surfaces.
    """
    if kind not in KINDS:
        raise AlertError(f"unknown alert kind: {kind}")
    # The explainability contract, enforced rather than documented. An alert a
    # teacher cannot interrogate is worse than no alert: it asks them to act on
    # something they cannot check.
    if not evidence or not evidence.get("raw"):
        raise AlertError(f"{kind} alert has no raw evidence")

    from app.brain import org
    teacher_ids = await org.teachers_for_learner(learner_id)
    if not teacher_ids:
        return []

    at = _now()
    resolved_bucket = bucket or default_bucket(kind, at=at)
    resolved_severity = severity or _SEVERITY.get(kind, SEVERITY_ATTENTION)
    stored: list[dict[str, Any]] = []

    for teacher_id in teacher_ids:
        key = alert_id(teacher_id, learner_id, kind, resolved_bucket)
        existing = await _load(key)
        if existing and existing.get("status") != STATUS_RESOLVED:
            # Same condition, still live: count it and refresh the evidence.
            document = {
                **existing,
                "occurrences": int(existing.get("occurrences") or 1) + 1,
                "evidence": evidence,
                "updated_at": at,
            }
            await _store(document)
            # Published, but WITHOUT a new `seq` and without changing `status`.
            # The client upserts by `_id`, so an acknowledged row stays dimmed
            # and simply shows the new count — it does not re-alarm. Publishing
            # nothing at all was worse: the teacher's screen kept showing "×1"
            # while the condition kept recurring underneath it.
            realtime.publish(
                f"teacher:{teacher_id}",
                {"type": "alert", "alert": document, "recurrence": True},
            )
            stored.append(document)
            continue

        document = {
            "_id": key,
            "seq": await _next_seq(teacher_id),
            "teacher_id": teacher_id,
            "learner_id": learner_id,
            "group_id": group_id,
            "kind": kind,
            "severity": resolved_severity,
            "title_key": title_key,
            # Stored as key + params, never rendered text: a teacher may switch
            # language at any time and a frozen Hebrew string would not follow.
            "params": params or {},
            "evidence": evidence,
            "status": STATUS_OPEN,
            "occurrences": 1,
            "acknowledged_by": None,
            "acknowledged_at": None,
            "resolved_at": None,
            "created_at": at,
            "updated_at": at,
        }
        await _store(document)
        realtime.publish(f"teacher:{teacher_id}", {"type": "alert", "alert": document})
        # The bridge to the bell (A5). An alert is a *condition* — it dedupes and
        # resolves — while a notification is a thing that happened once, so they
        # stay separate models. But an URGENT condition must survive the teacher
        # not having the dashboard open, and the bell is what does that. Only
        # urgent: routing every attention-level alert here would make the bell
        # the same firehose the inbox already is.
        if resolved_severity == SEVERITY_URGENT:
            from app.services import notifications

            await notifications.notify(
                teacher_id,
                notifications.KIND_ALERT,
                notification_id=f"alert:{key}",
                title_key=title_key,
                params=params or {},
                actions=[{
                    "label_key": "notif.action.openStudent",
                    "route": f"/teacher/student/{learner_id}",
                }],
                recipient_role=notifications.ROLE_TEACHER,
                actor_id=learner_id,
            )
        stored.append(document)

    return stored


# ── escalation from the coach's own detectors ────────────────────────────────

# Which nudges are also a teacher's business. Deliberately short: `mistake`,
# `slow_progress` and `idle` are things the coach handles in the moment, and
# forwarding them would turn the teacher's inbox into a firehose nobody reads.
# These three mean the coach has tried and the learner is still stuck.
_ESCALATES = {
    "misconception": ("struggling", "tch.alert.struggling.misconception"),
    "wheel_spinning": ("struggling", "tch.alert.struggling.wheelSpinning"),
    "rapid_guessing": ("struggling", "tch.alert.struggling.rapidGuessing"),
}

# Detector kinds that mark a learner as struggling on the live strip, whether or
# not they escalate to an alert.
STRUGGLE_KINDS = {"misconception", "wheel_spinning", "rapid_guessing", "idle"}


async def escalate_trigger(learner_id: str, trigger: dict[str, Any]) -> None:
    """Mirror a published coach nudge into presence and, if it matters, an alert.

    Called from `triggers.evaluate` after the nudge wins its priority round, so a
    trigger the coach suppressed never reaches a teacher either — the two views
    stay consistent about what actually happened.

    The evidence carried here is the detector's own payload, which is what makes
    the teacher's card able to say "Yuvi saw three consecutive failures on this
    objective" rather than a bare "struggling".
    """
    from app.services import presence

    kind = str(trigger.get("type") or "")
    if kind == "success":
        presence.clear_struggle(learner_id)
        return
    if kind not in STRUGGLE_KINDS:
        return

    raw = {key: value for key, value in trigger.items() if not key.startswith("_")}
    presence.note_struggle(learner_id, kind, evidence=raw)

    escalation = _ESCALATES.get(kind)
    if escalation is None:
        return
    alert_kind, title_key = escalation
    objective_id = trigger.get("objective_id")
    await raise_alert(
        learner_id,
        alert_kind,
        title_key=title_key,
        params={"objective_id": objective_id},
        evidence={
            "label_key": f"tch.evidence.detector.{kind}",
            "value": kind,
            "raw": raw,
        },
        bucket=default_bucket(alert_kind, objective_id=objective_id),
    )


async def list_alerts(
    teacher_id: str,
    *,
    since: Optional[int] = None,
    status: Optional[str] = None,
    limit: int = 200,
) -> list[dict[str, Any]]:
    """Alerts for one teacher, oldest first so `seq` order is replay order."""
    query: dict[str, Any] = {"teacher_id": teacher_id}
    if since is not None:
        query["seq"] = {"$gt": int(since)}
    if status == LIVE:
        # "Not resolved" — open plus acknowledged. Acknowledging means "I have
        # seen this", not "this is over", so an acknowledged row must survive a
        # reload; filtering on `open` alone made them vanish on refresh while the
        # UI was built to keep showing them dimmed.
        query["status"] = {"$ne": STATUS_RESOLVED}
    elif status:
        query["status"] = status

    handle = _collection()
    if handle is None:
        def matches(row: dict[str, Any]) -> bool:
            if status == LIVE:
                return row.get("status") != STATUS_RESOLVED
            return status is None or row.get("status") == status

        rows = [
            row for row in _memory.values()
            if row.get("teacher_id") == teacher_id
            and (since is None or int(row.get("seq") or 0) > int(since))
            and matches(row)
        ]
        return sorted(rows, key=lambda row: int(row.get("seq") or 0))[:limit]
    try:
        cursor = handle.find(query).sort("seq", 1).limit(limit)
        return [row async for row in cursor]
    except Exception:  # pragma: no cover
        return []


async def _set_status(teacher_id: str, alert_key: str, status: str) -> Optional[dict[str, Any]]:
    existing = await _load(alert_key)
    # Ownership is part of the id, so a teacher cannot touch another's alert even
    # by guessing the key.
    if existing is None or existing.get("teacher_id") != teacher_id:
        return None
    at = _now()
    document = {**existing, "status": status, "updated_at": at}
    if status == STATUS_ACKNOWLEDGED:
        document["acknowledged_by"] = teacher_id
        document["acknowledged_at"] = at
    if status == STATUS_RESOLVED:
        document["resolved_at"] = at
        # The live tile's "asked for help" badge is raised by these two kinds and
        # had nothing to lower it — a request stayed amber on the strip forever,
        # long after the teacher had walked over and dealt with it.
        if existing.get("kind") in {"coach_handoff", "safety_flag", "help_requested"}:
            from app.services import presence
            presence.clear_help_requested(existing["learner_id"])
    await _store(document)
    realtime.publish(f"teacher:{teacher_id}", {"type": "alert", "alert": document})
    return document


async def acknowledge(teacher_id: str, alert_key: str) -> Optional[dict[str, Any]]:
    return await _set_status(teacher_id, alert_key, STATUS_ACKNOWLEDGED)


async def resolve(teacher_id: str, alert_key: str) -> Optional[dict[str, Any]]:
    return await _set_status(teacher_id, alert_key, STATUS_RESOLVED)


async def ensure_indexes() -> None:
    handle = _collection()
    if handle is None:
        return
    for keys in ([("teacher_id", 1), ("seq", 1)], [("learner_id", 1)], [("status", 1)]):
        try:
            await handle.create_index(keys)
        except Exception:  # pragma: no cover - best effort
            print(f"⚠️ alert index {keys} failed")


def reset_for_tests() -> None:
    _seq.clear()
    _memory.clear()
