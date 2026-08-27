"""What a teacher's pin means, decided in exactly one place (#244).

The pin is honoured at four independent read sites — the dashboard hero, the
pedagogical route, the class-wide focus fan-out and the single-learner pin
read. #249 shipped the same three-line judgement inlined at each of them, and
adding expiry and a second pin kind would have made four copies of a rule that
already drifted once (the spent-pin gate was written twice with two different
casts). These helpers are that rule, once.

Expiry is READ-SIDE, like every date in the brain (`teacher_directives`'
`expires_at`, the check-in's `daily_feeling.date`): no cron, no sweeper, no
second place to keep in sync. A pin past its date simply stops steering; the
record itself is only replaced when a teacher acts again, and `spent_record`
is what they replace it with — so "the pin ended, and this is how" survives
the pin itself.

Pure and synchronous on purpose: `dashboard._hero` is sync, and nothing here
needs a database — callers hand in the brain they already read.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Iterable, Optional

KIND_COMPONENT = "component"
KIND_TASK = "task"

#: The pin's ending, as `pinned_last.outcome`.
OUTCOME_COMPLETED = "completed"
OUTCOME_EXPIRED = "expired"
OUTCOME_UNPINNED = "unpinned"


def pin_kind(pin: dict[str, Any]) -> str:
    """`task` when the pin says so; everything else is a component pin.

    Pins written by #249 carry no `kind` at all — they are component pins, and
    reading them as such is what keeps a live pin from before this change
    steering exactly as it did.
    """
    return KIND_TASK if pin.get("kind") == KIND_TASK else KIND_COMPONENT


def target_id(pin: dict[str, Any]) -> str:
    """The id the pin steers to: a component id, or a task launch id."""
    if pin_kind(pin) == KIND_TASK:
        return str(pin.get("launch_id") or "")
    return str(pin.get("component_id") or "")


def is_expired(pin: dict[str, Any], now: Optional[datetime] = None) -> bool:
    """Past its date — or dated in a way we cannot read.

    No date means no expiry: the pin holds until done or unpinned (the
    decision on #244). An unparseable date fails CLOSED — a pin we cannot
    date must not steer a child forever on the strength of a typo.
    """
    stamp = pin.get("expires_at")
    if not stamp:
        return False
    try:
        expires = datetime.fromisoformat(str(stamp).replace("Z", "+00:00"))
    except ValueError:
        return True
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    return expires <= (now or datetime.now(timezone.utc))


def active_pin(
    brain: dict[str, Any],
    *,
    completed_ids: Iterable[str] = frozenset(),
    now: Optional[datetime] = None,
) -> Optional[dict[str, Any]]:
    """The pin that currently steers this learner, or None.

    None when there is no pin, the pin names nothing, it is past its date, or
    (component pins only) its component is already completed — the spent-pin
    gate. Task pins never consult `completed_ids`: a task writes no learning
    events, so its completion clears the pin at submission instead
    (`tasks/attempts`), and a spent task pin cannot reach this check at all.

    Read-only: never mutates the brain, never writes `pinned_last`. The lazy
    sweep of an expired record belongs to the pin/unpin routes, where a
    teacher is acting anyway.
    """
    pin = brain.get("pinned_next") or {}
    if not target_id(pin):
        return None
    if is_expired(pin, now):
        return None
    if pin_kind(pin) == KIND_COMPONENT and str(pin["component_id"]) in set(completed_ids):
        return None
    return pin


def spent_record(
    pin: dict[str, Any], outcome: str, now: Optional[datetime] = None
) -> dict[str, Any]:
    """The `pinned_last` row: the pin as it stood, plus how and when it ended."""
    return {
        **pin,
        "outcome": outcome,
        "ended_at": (now or datetime.now(timezone.utc)).isoformat(),
    }
