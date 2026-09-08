"""Telling the learner about their game — the bell and the live frame.

Two channels for one event, because they serve different moments. The
**notification** is durable: a kid who left for dinner while Opus was building
finds "המשחק «חלל» מוכן!" in the bell tomorrow. The **realtime frame** on
``user:{learner_id}`` is for the kid still on the page: the studio prop flashes,
the build card advances, the chime plays — none of which should wait for a poll.

Ids are deterministic per (kind, game, version), so a worker retry that
re-finishes the same version rings once. Build-step progress goes ONLY on the
live channel: a bell full of "planning… building… validating…" is noise, and
the card recomputes its state from the game document on reload anyway.
"""

from __future__ import annotations

import logging
from typing import Any, Optional

from app.services import notifications, realtime

log = logging.getLogger(__name__)

#: What each notification kind means, for the caller choosing one.
#:   game_ready       the first version of a new game landed
#:   game_failed      a job gave up (any kind); the game is `failed`
#:   game_edit_ready  an edit job produced a new version
#:   game_fix_ready   a fix job produced a new version
GAME_KINDS = (
    notifications.KIND_GAME_READY, notifications.KIND_GAME_FAILED,
    notifications.KIND_GAME_EDIT_READY, notifications.KIND_GAME_FIX_READY,
)


def player_route(game: dict[str, Any]) -> str:
    """The deep link: the lesson page with the player open on this game."""
    return (f"/learning/lesson?unit={game.get('unit_id') or ''}"
            f"&component={game.get('component_id') or ''}&game={game.get('_id') or ''}")


def frame(game: dict[str, Any], *, event: Optional[str] = None, v: Optional[int] = None,
          **extra: Any) -> dict[str, Any]:
    """The realtime payload. `status` is the game's; `event` is the finer
    build step when there is one (``plan``, ``build``, ``validate``…)."""
    payload: dict[str, Any] = {
        "type": "game",
        "game_id": str(game.get("_id") or ""),
        "status": str(game.get("status") or ""),
        "v": int(v if v is not None else game.get("current_version") or 0),
    }
    if event:
        payload["event"] = event
    payload.update(extra)
    return payload


async def notify_game(kind: str, game: dict[str, Any], version: int) -> Optional[dict[str, Any]]:
    """Ring the bell and push the frame. Returns the notification row, or None
    when this (kind, game, version) had already been announced."""
    if kind not in GAME_KINDS:
        raise ValueError(f"not a game notification kind: {kind}")
    learner_id = str(game.get("learner_id") or "")
    game_id = str(game.get("_id") or "")
    row = await notifications.notify(
        learner_id, kind,
        title_key=f"notif.{kind}",
        notification_id=f"{kind}:{game_id}:{int(version)}",
        params={"title": str(game.get("title") or "")},
        actions=[{"label_key": "notif.action.openGame", "route": player_route(game)}],
        recipient_role=notifications.ROLE_LEARNER,
    )
    realtime.publish(f"user:{learner_id}", frame(game, v=version, kind=kind))
    return row


def publish_progress(learner_id: str, game_id: str, event: str, **extra: Any) -> int:
    """A build step for whoever is watching. Never stored, never a bell."""
    payload = frame({"_id": game_id, "status": extra.pop("status", ""),
                     "current_version": extra.pop("v", 0)}, event=event, **extra)
    return realtime.publish(f"user:{learner_id}", payload)
