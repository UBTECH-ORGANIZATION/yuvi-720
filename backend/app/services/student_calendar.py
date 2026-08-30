"""Read-only calendar projection for one authenticated learner."""

from __future__ import annotations

import asyncio
from datetime import date, datetime, time, timedelta, timezone
from typing import Literal
from zoneinfo import ZoneInfo

from pydantic import BaseModel, Field

from app.brain.repository import get_brain
from app.services import calendar_events, mentoring, timetable
from app.services.tasks import learner as learner_tasks


ISRAEL_TIMEZONE = ZoneInfo("Asia/Jerusalem")
ItemKind = Literal["task", "goal", "meeting", "event", "lesson"]
ItemStatus = Literal["upcoming", "overdue", "completed", "closed", "cancelled"]
Proximity = Literal["overdue", "today", "tomorrow", "this_week"]
CalendarPeriodName = Literal["today", "tomorrow", "this_week", "next_week"]


class CalendarItem(BaseModel):
    id: str
    kind: ItemKind
    title: str = ""
    subject: str | None = None
    teacher_name: str | None = None
    start_at: str
    end_at: str | None = None
    all_day: bool = False
    status: ItemStatus
    proximity: Proximity | None = None
    action_route: str | None = None


class CalendarWeek(BaseModel):
    contract_version: int = 1
    timezone: str = "Asia/Jerusalem"
    week_start: date
    week_end: date
    items: list[CalendarItem] = Field(default_factory=list)


class CalendarUpcoming(BaseModel):
    contract_version: int = 1
    timezone: str = "Asia/Jerusalem"
    items: list[CalendarItem] = Field(default_factory=list)
    has_more: bool = False


class CalendarPeriod(BaseModel):
    contract_version: int = 1
    timezone: str = "Asia/Jerusalem"
    period: CalendarPeriodName
    start_date: date
    end_date: date
    items: list[CalendarItem] = Field(default_factory=list)


def _local_now(now: datetime | None = None) -> datetime:
    value = now or datetime.now(timezone.utc)
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(ISRAEL_TIMEZONE)


def week_bounds(anchor: date) -> tuple[date, date]:
    """Return the Israeli Sunday-through-Saturday week containing ``anchor``."""
    days_since_sunday = (anchor.weekday() + 1) % 7
    start = anchor - timedelta(days=days_since_sunday)
    return start, start + timedelta(days=6)


def _parse_local(value: object) -> tuple[datetime, bool] | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    try:
        if len(raw) == 10:
            parsed_date = date.fromisoformat(raw)
            return datetime.combine(parsed_date, time.min, ISRAEL_TIMEZONE), True
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=ISRAEL_TIMEZONE)
        return parsed.astimezone(ISRAEL_TIMEZONE), False
    except ValueError:
        return None


def _is_past(moment: datetime, all_day: bool, now: datetime) -> bool:
    return moment.date() < now.date() if all_day else moment < now


def _proximity(moment: datetime, all_day: bool, now: datetime) -> Proximity | None:
    local_date = moment.date()
    if _is_past(moment, all_day, now):
        return "overdue"
    if local_date == now.date():
        return "today"
    if local_date == now.date() + timedelta(days=1):
        return "tomorrow"
    _, week_end = week_bounds(now.date())
    if local_date <= week_end:
        return "this_week"
    return None


def _task_item(row: dict, now: datetime) -> CalendarItem | None:
    parsed = _parse_local(row.get("due_at"))
    if parsed is None:
        return None
    moment, all_day = parsed
    completed = row.get("status") in {"submitted", "graded"}
    status: ItemStatus = (
        "completed" if completed
        else "closed" if row.get("closed")
        else "overdue" if _is_past(moment, all_day, now)
        else "upcoming"
    )
    return CalendarItem(
        id=f"task:{row.get('launch_id')}",
        kind="task",
        title=str(row.get("title") or ""),
        subject=str(row.get("subject")) if row.get("subject") else None,
        start_at=str(row.get("due_at")),
        all_day=all_day,
        status=status,
        proximity=_proximity(moment, all_day, now) if status in {"upcoming", "overdue"} else None,
        action_route=f"/tasks/{row.get('launch_id')}",
    )


def _goal_item(goal: dict, now: datetime) -> CalendarItem | None:
    if not goal.get("visible_to_learner", True):
        return None
    parsed = _parse_local(goal.get("deadline"))
    if parsed is None:
        return None
    moment, all_day = parsed
    completed = goal.get("status") in {"done", "completed"} or bool(goal.get("done"))
    status: ItemStatus = (
        "completed" if completed
        else "overdue" if _is_past(moment, all_day, now)
        else "upcoming"
    )
    goal_id = str(goal.get("id") or "")
    return CalendarItem(
        id=f"goal:{goal_id}",
        kind="goal",
        title=str(goal.get("text") or goal.get("title") or ""),
        start_at=str(goal.get("deadline")),
        all_day=all_day,
        status=status,
        proximity=_proximity(moment, all_day, now) if status in {"upcoming", "overdue"} else None,
        action_route="/mentoring",
    )


def _meeting_item(row: dict) -> CalendarItem | None:
    parsed = _parse_local(row.get("date"))
    if parsed is None:
        return None
    _, all_day = parsed
    meeting_id = str(row.get("id") or row.get("_id") or "")
    return CalendarItem(
        id=f"meeting:{meeting_id}",
        kind="meeting",
        title=str(row.get("meeting_stage") or ""),
        teacher_name=str(row.get("teacher_name")) if row.get("teacher_name") else None,
        start_at=str(row.get("date")),
        all_day=all_day,
        status="completed",
        action_route="/mentoring",
    )


def _source_item(row: dict, now: datetime) -> CalendarItem | None:
    kind = str(row.get("kind") or "")
    if kind not in {"event", "lesson"}:
        return None
    parsed = _parse_local(row.get("start_at"))
    if parsed is None:
        return None
    moment, all_day = parsed
    raw_status = str(row.get("status") or "upcoming")
    status: ItemStatus = (
        "cancelled" if raw_status == "cancelled"
        else "completed" if _is_past(moment, all_day, now)
        else "upcoming"
    )
    return CalendarItem(
        id=f"{kind}:{row.get('id')}",
        kind=kind,  # type: ignore[arg-type]
        title=str(row.get("title") or ""),
        subject=str(row.get("subject")) if row.get("subject") else None,
        teacher_name=(
            str(row.get("teacher_name")) if row.get("teacher_name") else None
        ),
        start_at=str(row.get("start_at")),
        end_at=str(row.get("end_at")) if row.get("end_at") else None,
        all_day=all_day,
        status=status,
        proximity=_proximity(moment, all_day, now) if status == "upcoming" else None,
    )


def _sort_key(item: CalendarItem) -> tuple[datetime, str, str]:
    parsed = _parse_local(item.start_at)
    moment = parsed[0] if parsed else datetime.max.replace(tzinfo=timezone.utc)
    return moment, item.kind, item.id


def _holiday_item(row: dict, now: datetime) -> CalendarItem:
    """A day off as an all-day row (#242): the week says ראש השנה, not an
    unexplained empty Monday. Rides as kind `event` — no new vocabulary."""
    day = str(row.get("date") or "")
    moment = datetime.combine(date.fromisoformat(day), time.min, ISRAEL_TIMEZONE)
    past = _is_past(moment, True, now)
    return CalendarItem(
        id=f"holiday:{day}",
        kind="event",
        title=str(row.get("label") or ""),
        start_at=day,
        all_day=True,
        status="completed" if past else "upcoming",
        proximity=None if past else _proximity(moment, True, now),
    )


async def _all_items(
    learner_id: str, start: date, end: date, *, now: datetime | None = None,
) -> tuple[list[CalendarItem], datetime]:
    local_now = _local_now(now)
    task_rows, brain, conversations, events, lessons, days_off = await asyncio.gather(
        learner_tasks.list_for_learner(learner_id),
        get_brain(learner_id),
        mentoring.list_conversations(learner_id, "learner"),
        calendar_events.list_for_learner(learner_id, start, end),
        timetable.list_for_learner(learner_id, start, end),
        timetable.holidays_for_learner(learner_id, start, end),
    )
    items = [item for item in (
        *(_task_item(row, local_now) for row in task_rows),
        *(_goal_item(goal, local_now) for goal in (brain.get("goals") or [])),
        *(_meeting_item(row) for row in conversations),
        *(_source_item(row, local_now) for row in events),
        *(_source_item(row, local_now) for row in lessons),
        *(_holiday_item(row, local_now) for row in days_off),
    ) if item is not None]
    items.sort(key=_sort_key)
    return items, local_now


async def get_week(
    learner_id: str, anchor: date | None = None, *, now: datetime | None = None,
) -> CalendarWeek:
    local_now = _local_now(now)
    start, end = week_bounds(anchor or local_now.date())
    items, _ = await _all_items(learner_id, start, end, now=local_now)
    in_week = [
        item for item in items
        if (parsed := _parse_local(item.start_at)) is not None
        and start <= parsed[0].date() <= end
    ]
    return CalendarWeek(week_start=start, week_end=end, items=in_week)


async def get_period(
    learner_id: str,
    period: CalendarPeriodName,
    *,
    now: datetime | None = None,
) -> CalendarPeriod:
    """Return one bounded learner-calendar period in Israel local time."""
    local_now = _local_now(now)
    today = local_now.date()
    week_start, week_end = week_bounds(today)
    if period == "today":
        start = end = today
    elif period == "tomorrow":
        start = end = today + timedelta(days=1)
    elif period == "this_week":
        start, end = week_start, week_end
    else:
        start = week_start + timedelta(days=7)
        end = week_end + timedelta(days=7)

    items, _ = await _all_items(learner_id, start, end, now=local_now)
    visible = [
        item for item in items
        if (parsed := _parse_local(item.start_at)) is not None
        and start <= parsed[0].date() <= end
    ]
    return CalendarPeriod(
        period=period,
        start_date=start,
        end_date=end,
        items=visible,
    )


async def get_upcoming(
    learner_id: str, limit: int = 3, *, now: datetime | None = None,
) -> CalendarUpcoming:
    local_now = _local_now(now)
    start, end = week_bounds(local_now.date())
    items, _ = await _all_items(learner_id, start, end, now=local_now)
    limit = max(1, min(limit, 30))
    today = [
        item for item in items
        if item.status in {"upcoming", "overdue"}
        and (parsed := _parse_local(item.start_at)) is not None
        and parsed[0].date() == local_now.date()
    ]
    visible = today[:limit]
    return CalendarUpcoming(
        items=visible,
        has_more=len(today) > len(visible),
    )


async def reconcile_due_reminders(
    learner_id: str, *, now: datetime | None = None,
) -> int:
    """Create at most one in-app reminder per item and local due date."""
    from app.services import notifications

    local_now = _local_now(now)
    task_rows, brain = await asyncio.gather(
        learner_tasks.list_for_learner(learner_id),
        get_brain(learner_id),
    )
    items = [item for item in (
        *(_task_item(row, local_now) for row in task_rows),
        *(_goal_item(goal, local_now) for goal in (brain.get("goals") or [])),
    ) if item is not None]
    tomorrow = local_now.date() + timedelta(days=1)
    created = 0
    for item in items:
        if item.kind not in {"task", "goal"} or item.status not in {"upcoming", "overdue"}:
            continue
        parsed = _parse_local(item.start_at)
        if parsed is None or parsed[0].date() not in {local_now.date(), tomorrow}:
            continue
        due_date = parsed[0].date().isoformat()
        row = await notifications.notify(
            learner_id,
            notifications.KIND_DEADLINE_REMINDER,
            notification_id=f"deadline_reminder:{item.id}:{due_date}",
            title_key=(
                "notif.deadline.today" if parsed[0].date() == local_now.date()
                else "notif.deadline.tomorrow"
            ),
            params={"title": item.title},
            actions=[{
                "label_key": "notif.action.openCalendarItem",
                "route": item.action_route or "/student-dashboard/calendar",
            }],
            recipient_role=notifications.ROLE_LEARNER,
        )
        if row is not None:
            created += 1
    return created