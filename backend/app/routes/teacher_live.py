"""The teacher's live lane: presence snapshot, alert stream, acknowledge/resolve.

One SSE connection per teacher carries both alert frames and presence frames.
The stream opens with a `snapshot` frame so a fresh tab renders a complete
picture immediately instead of an empty screen that fills in as things happen —
"nothing on the board" and "nothing has happened since you connected" look
identical otherwise, and only one of them is true.

Reconnection uses `?since=<seq>`. Alert ids are deterministic and `seq` is
monotonic per teacher, so a replay after a dropped connection returns exactly
the missed rows: no gaps, no duplicates.

Scoping is enforced where the data is produced, not here: `teacher_alerts`
resolves recipients from the live roster at publish time, so this route only has
to know who is asking.
"""

from __future__ import annotations

import json
from typing import Any, Optional

from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse, StreamingResponse

from app.auth.dependencies import require_teacher
from app.brain import org
from app.services import presence, realtime, teacher_alerts

router = APIRouter(prefix="/api/teacher", tags=["teacher-live"])

_NO_STORE = {"Cache-Control": "private, no-store"}
# Proxies buffer streamed responses by default, which turns a live alert into a
# five-minute-late one. Same headers the coach stream already sets.
_STREAM_HEADERS = {
    "Cache-Control": "no-cache, no-transform",
    "X-Accel-Buffering": "no",
    "Connection": "keep-alive",
}


async def _snapshot(teacher_id: str, group_id: Optional[str]) -> dict[str, Any]:
    """Everything a freshly connected teacher screen needs to render itself."""
    groups = await org.groups_for_teacher(teacher_id)
    group_ids = [group["id"] for group in groups]
    selected = group_id if group_id in group_ids else (group_ids[0] if group_ids else None)

    # Everything not resolved: an acknowledged alert is still the teacher's to
    # deal with, so it has to survive a reload.
    alerts = await teacher_alerts.list_alerts(teacher_id, status=teacher_alerts.LIVE)
    live = await presence.snapshot_for_group(selected) if selected else []
    return {
        "type": "snapshot",
        "group_id": selected,
        "alerts": alerts,
        "presence": live,
        # The replay cursor the client sends back on reconnect.
        "cursor": await teacher_alerts.latest_seq(teacher_id),
    }


@router.get("/live")
async def read_live(
    group_id: Optional[str] = Query(None),
    teacher_id: str = Depends(require_teacher),
):
    """The same snapshot as plain JSON.

    Exists so the live strip can degrade to polling if SSE is unavailable — and
    so the cheapest possible smoke test of this lane needs no stream client.
    """
    return JSONResponse(content=await _snapshot(teacher_id, group_id), headers=_NO_STORE)


@router.get("/stream")
async def teacher_stream(
    since: Optional[int] = Query(None, ge=0),
    group_id: Optional[str] = Query(None),
    teacher_id: str = Depends(require_teacher),
):
    """SSE: snapshot first, then alert and presence frames as they happen."""

    async def event_generator():
        opening = await _snapshot(teacher_id, group_id)
        yield f"data: {json.dumps(opening, ensure_ascii=False)}\n\n"

        # Anything raised while this teacher was disconnected. Sent after the
        # snapshot and before live frames, so ordering by `seq` still holds.
        if since is not None:
            for missed in await teacher_alerts.list_alerts(teacher_id, since=since):
                frame = {"type": "alert", "alert": missed, "replayed": True}
                yield f"data: {json.dumps(frame, ensure_ascii=False)}\n\n"

        async for event in realtime.subscribe(f"teacher:{teacher_id}"):
            yield f"data: {json.dumps(event, ensure_ascii=False, default=str)}\n\n"

    return StreamingResponse(
        event_generator(), media_type="text/event-stream", headers=_STREAM_HEADERS,
    )


@router.post("/alerts/{alert_id:path}/ack")
async def acknowledge_alert(alert_id: str, teacher_id: str = Depends(require_teacher)):
    """"I have seen this." Does not close the condition — `resolve` does."""
    updated = await teacher_alerts.acknowledge(teacher_id, alert_id)
    if updated is None:
        return JSONResponse(content={"error": "not_found"}, status_code=404, headers=_NO_STORE)
    return JSONResponse(content=updated, headers=_NO_STORE)


@router.post("/alerts/{alert_id:path}/resolve")
async def resolve_alert(alert_id: str, teacher_id: str = Depends(require_teacher)):
    """"I have dealt with this." The same condition may open a fresh alert later."""
    updated = await teacher_alerts.resolve(teacher_id, alert_id)
    if updated is None:
        return JSONResponse(content={"error": "not_found"}, status_code=404, headers=_NO_STORE)
    return JSONResponse(content=updated, headers=_NO_STORE)
