"""The class calendar (F6) — thin: authorize, aggregate, report.

Every date in here is owned by another store. This lane reads them together and
adds only what nothing else owns: free events. Two rules it keeps:

* **Access before data.** `_guard_group` refuses first; no store is read for a
  class the teacher does not teach, and targets are resolved through
  `assign.resolve_targets` so a client can never schedule for a child it
  cannot reach.
* **Nothing dated is copied.** Task launches, goals and meetings are read where
  they live. Moving a task's due date changes this screen with no second edit.
"""

from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import JSONResponse

from app.auth.dependencies import require_teacher_session
from app.brain import org
from app.services import school_calendar, subgroups
from app.services.tasks import assign

router = APIRouter(prefix="/api/teacher", tags=["teacher"])

_NO_STORE = {"Cache-Control": "private, no-store"}


def _ok(content: Any) -> JSONResponse:
    return JSONResponse(content=content, headers=_NO_STORE)


def _denied() -> JSONResponse:
    return JSONResponse(content={"error": "forbidden"}, status_code=403, headers=_NO_STORE)


def _bad(code: str) -> JSONResponse:
    return JSONResponse(content={"error": code}, status_code=400, headers=_NO_STORE)


async def _guard_group(session: dict, group_id: str) -> bool:
    return await org.teacher_can_access_group(session["sub"], group_id)


async def _scope_learners(teacher_id: str, group_id: str,
                          subgroup: Optional[str],
                          learner: Optional[str]) -> Optional[set[str]]:
    """Which learners the view is narrowed to, or None for the whole class.

    Resolved server-side through the same helpers that guard assignment, so a
    subgroup id from another class cannot be used to read across the wall.
    """
    if learner:
        if not await org.teacher_can_access_learner(teacher_id, learner):
            raise PermissionError("forbidden")
        return {learner}
    if subgroup:
        members = await subgroups.members_of(teacher_id, subgroup)
        return set(members)
    return None


@router.get("/groups/{group_id}/calendar")
async def group_calendar(
    group_id: str,
    request: Request,
    from_day: Optional[str] = Query(None, alias="from"),
    to_day: Optional[str] = Query(None, alias="to"),
    subgroup: Optional[str] = Query(None),
    learner: Optional[str] = Query(None),
    session=Depends(require_teacher_session),
):
    """Everything with a date in one class, for one window."""
    if not await _guard_group(session, group_id):
        return _denied()

    teacher_id = session["sub"]
    start, end = school_calendar.normalize_range(from_day, to_day)

    try:
        scope = await _scope_learners(teacher_id, group_id, subgroup, learner)
    except PermissionError:
        return _denied()
    except Exception:
        return _denied()

    # The fold itself lives in the service: the teaching assistant reads this
    # same timeline through its own tool, and two implementations of "what is
    # on this class's calendar" would eventually answer differently.
    items = await school_calendar.collect(group_id, start, end, scope)
    return _ok({
        "from": start,
        "to": end,
        "timezone": school_calendar.SCHOOL_TIMEZONE,
        "items": items,
    })


@router.post("/groups/{group_id}/calendar/events")
async def create_event(group_id: str, request: Request,
                       session=Depends(require_teacher_session)):
    """Create a free event — a lesson, a reminder, a test, a class event."""
    if not await _guard_group(session, group_id):
        return _denied()
    teacher_id = session["sub"]
    body = await request.json()
    if not isinstance(body, dict):
        return _bad("bad_body")

    try:
        event = school_calendar.build_event(body, group_id=group_id, teacher_id=teacher_id)
    except school_calendar.CalendarError as exc:
        return _bad(str(exc))

    # The targeting vocabulary is the tasks lane's, and so is its access check:
    # one refusal for a target this teacher cannot reach, before anything is
    # stored. `resolve_targets` refuses the whole list if any id is bad.
    try:
        reaches = await assign.resolve_targets(teacher_id, event["targets"])
    except assign.AssignError as exc:
        code = str(exc)
        return _denied() if code == "not_authorized" else _bad(code)

    await school_calendar.save_event(event)
    return _ok({"event": event, "reaches": len(reaches)})


@router.patch("/calendar/events/{event_id}")
async def update_event(event_id: str, request: Request,
                       session=Depends(require_teacher_session)):
    if (event := await school_calendar.get_event(event_id)) is None:
        return _bad("not_found")
    if not await _guard_group(session, str(event.get("group_id") or "")):
        return _denied()
    teacher_id = session["sub"]
    body = await request.json()
    if not isinstance(body, dict):
        return _bad("bad_body")

    # Rebuilt rather than patched field-by-field, so an edit passes exactly the
    # same validation a creation does — including the all-day day-shape rule.
    merged = {**event, **body}
    try:
        rebuilt = school_calendar.build_event(
            merged, group_id=str(event["group_id"]), teacher_id=str(event["teacher_id"]))
    except school_calendar.CalendarError as exc:
        return _bad(str(exc))
    try:
        await assign.resolve_targets(teacher_id, rebuilt["targets"])
    except assign.AssignError as exc:
        code = str(exc)
        return _denied() if code == "not_authorized" else _bad(code)

    rebuilt["_id"] = event["_id"]
    rebuilt["created_at"] = event.get("created_at") or rebuilt["created_at"]
    await school_calendar.save_event(rebuilt)
    return _ok({"event": rebuilt})


@router.delete("/calendar/events/{event_id}")
async def remove_event(event_id: str, session=Depends(require_teacher_session)):
    if (event := await school_calendar.get_event(event_id)) is None:
        return _bad("not_found")
    if not await _guard_group(session, str(event.get("group_id") or "")):
        return _denied()
    await school_calendar.delete_event(event_id)
    return _ok({"deleted": True})
