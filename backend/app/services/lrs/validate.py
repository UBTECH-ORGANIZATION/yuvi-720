"""Offline check of one outbound statement against the 720 spec v1.1.

The staging LRS answers 400 with a reason for anything malformed, but only
after the statement was sent — and a statement is permanent. This is the
same contract checked BEFORE the send: the envelope every statement needs,
then what each verb family needs on top. It returns problems, never raises,
so the contract report can print them and a test can pin a builder to them.

It checks shape and closed lists, not truth: it cannot know whether the
learner really pressed the button. What it can catch is the class of defect
the reviews have actually raised — a bare extension key, a missing
`applicationVersion`, an off-list `selectionType`, a group dashboard with an
empty `dashboardId`, a content statement without its vendor or with a
grouping that does not end in its own object.
"""

from __future__ import annotations

import re
from typing import Any

from app.services.lrs import statements
from app.services.lrs.context import (
    ACTIVITY,
    CONTENT_VENDOR_BASE,
    EXIDENTIFIER_HOMEPAGE,
    EXT,
    NMM_HOMEPAGE,
    SCHOOL_HOMEPAGE,
    VERB,
)

_UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", re.I)
_DURATION = re.compile(r"^PT(?:\d+H)?(?:\d+M)?(?:\d+(?:\.\d+)?S)?$")
_TIMESTAMP = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$")
_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_IRI = re.compile(r"^https?://\S+$")

VERBS = frozenset(statements._MOE_VERB_SLUGS)
DEVICE_EXTENSIONS = (
    "deviceType", "platform", "operatingSystem", "osVersion", "browser",
    "browserVersion", "applicationVersion",
)
MEETING_EXTENSIONS = ("mentor", "student", "meetingDate", "mentoringPhase")
CONTENT_TYPES = frozenset({
    "learning-unit", "learningunit", "component", "item", "questionnaire",
    "question", "video", "audio", "animation",
})
_SESSION_VERBS = frozenset({"enter", "suspend", "resume", "exit"})


def _type_of(activity: dict[str, Any]) -> str:
    return str(((activity or {}).get("definition") or {}).get("type") or "").rsplit("/", 1)[-1]


def _short(extensions: dict[str, Any] | None) -> dict[str, Any]:
    return {str(k).rsplit("/", 1)[-1]: v for k, v in (extensions or {}).items()}


def _grouping(statement: dict[str, Any]) -> list[dict[str, Any]]:
    return list((((statement.get("context") or {}).get("contextActivities") or {}).get("grouping")) or [])


def _parent(statement: dict[str, Any]) -> list[dict[str, Any]]:
    parent = ((statement.get("context") or {}).get("contextActivities") or {}).get("parent")
    if isinstance(parent, dict):
        return [parent]
    return list(parent or [])


def validate_statement(statement: dict[str, Any]) -> list[str]:
    """Every way this statement departs from spec v1.1 — empty when it does not."""
    problems: list[str] = []
    if not isinstance(statement, dict):
        return ["statement is not an object"]

    # ── Envelope ────────────────────────────────────────────────────────────
    if not _UUID.match(str(statement.get("id") or "")):
        problems.append("id is not a UUID")
    actor = statement.get("actor") or {}
    account = actor.get("account") or {}
    if actor.get("objectType") != "Agent" or account.get("homePage") != EXIDENTIFIER_HOMEPAGE:
        problems.append("actor must be an Agent with the exidentifier account homePage")
    if not str(account.get("name") or "").strip():
        problems.append("actor.account.name (exidentifier) is empty")
    verb_id = str((statement.get("verb") or {}).get("id") or "")
    slug = verb_id.rsplit("/", 1)[-1]
    if not verb_id.startswith(f"{VERB}/") or slug not in VERBS:
        problems.append(f"verb {verb_id or '(missing)'} is not on the ministry's list")
    obj = statement.get("object") or {}
    if obj.get("objectType") != "Activity" or not _IRI.match(str(obj.get("id") or "")):
        problems.append("object must be an Activity with an IRI id")
    obj_type = _type_of(obj)
    if not str(((obj.get("definition") or {}).get("type")) or "").startswith(f"{ACTIVITY}/"):
        problems.append("object.definition.type is not a ministry activity type")
    if not _TIMESTAMP.match(str(statement.get("timestamp") or "")):
        problems.append("timestamp is not ISO-8601")

    grouping = _grouping(statement)
    types = [_type_of(entry) for entry in grouping]
    for required in ("lms", "session", "program"):
        if types.count(required) != 1:
            problems.append(f"grouping needs exactly one {required} entry (found {types.count(required)})")
    for entry in grouping:
        if not _IRI.match(str(entry.get("id") or "")):
            problems.append(f"grouping entry without an IRI id: {entry.get('id')!r}")
    team = (statement.get("context") or {}).get("team")
    if team is not None:
        homepage = (team.get("account") or {}).get("homePage")
        if team.get("objectType") != "Group" or homepage not in (NMM_HOMEPAGE, SCHOOL_HOMEPAGE):
            problems.append("context.team must be the NMM group or the school")
    ctx_ext = (statement.get("context") or {}).get("extensions") or {}
    for key in list(ctx_ext) + list(((obj.get("definition") or {}).get("extensions")) or {}):
        if not str(key).startswith(f"{EXT}/"):
            problems.append(f"extension key is not a ministry IRI: {key}")
    ext = _short(ctx_ext)
    result = statement.get("result") or {}
    if "duration" in result and not _DURATION.match(str(result["duration"])):
        problems.append(f"result.duration is not an ISO-8601 duration: {result['duration']!r}")

    # ── Per family ──────────────────────────────────────────────────────────
    if slug in _SESSION_VERBS:
        if obj_type != "session" or "/session/" not in str(obj.get("id")):
            problems.append("session verbs need a session object")
        if slug == "enter":
            for name in DEVICE_EXTENSIONS:
                if not str(ext.get(name) or "").strip():
                    problems.append(f"enter is missing the {name} extension")
        if slug == "exit" and "duration" not in result:
            problems.append("exit needs result.duration")

    if slug == "viewed":
        if obj_type != "dashboard":
            problems.append("viewed needs a dashboard object")
        kind = str(obj.get("id") or "").rsplit("/", 1)[-1]
        if kind not in statements.DASHBOARD_TYPES:
            problems.append(f"dashboard type {kind!r} is not on the list")
        if not str(ext.get("dashboardId") or "").strip():
            problems.append("viewed needs a non-empty dashboardId")
        if "duration" not in result:
            problems.append("viewed needs result.duration (filed when the viewing ends)")

    if obj_type == "conversation":
        if slug == "interacted":
            if ext.get("speaker") not in ("student", "bot"):
                problems.append("interacted needs speaker student|bot")
            if ext.get("conversationTrigger") not in statements.CONVERSATION_TRIGGERS:
                problems.append(f"conversationTrigger {ext.get('conversationTrigger')!r} is off the list")
            if ext.get("helpType") not in statements.HELP_TYPES:
                problems.append(f"helpType {ext.get('helpType')!r} is off the list")
            for name in ("componentId", "itemId"):
                if name in ext and not _IRI.match(str(ext[name])):
                    problems.append(f"{name} must be an IRI")
        elif slug == "rated":
            if result.get("response") not in ("like", "dislike"):
                problems.append("rated needs result.response like|dislike")
        else:
            problems.append(f"{slug} is not a conversation verb")

    if "/reflection/" in str(obj.get("id")) and obj_type in ("questionnaire", "question"):
        if slug == "initialized" and ext.get("reflectionTrigger") not in statements.REFLECTION_TRIGGERS:
            problems.append(f"reflectionTrigger {ext.get('reflectionTrigger')!r} is off the list")
        if slug == "answered" and (("response" in result) == ("score" in result)):
            problems.append("reflection answered needs response XOR score")
        if slug == "completed" and ("completion" not in result or "duration" not in result):
            problems.append("reflection completed needs result.completion and result.duration")

    if "/agency/" in str(obj.get("id")):
        if slug == "answered" and ("response" not in result or "score" not in result):
            problems.append("agency answered needs result.response and result.score")
        if slug == "completed" and ("completion" not in result or "duration" not in result):
            problems.append("agency completed needs result.completion and result.duration")

    if obj_type == "mentor-student-meeting":
        for name in MEETING_EXTENSIONS:
            if not str(ext.get(name) or "").strip():
                problems.append(f"meeting is missing the {name} extension")
        if not _DATE.match(str(ext.get("meetingDate") or "")):
            problems.append("meetingDate must be YYYY-MM-DD")
        if ext.get("mentoringPhase") not in statements.MENTORING_PHASES:
            problems.append(f"mentoringPhase {ext.get('mentoringPhase')!r} is off the ladder")

    if obj_type == "student-goal":
        goal_type = _short(((obj.get("definition") or {}).get("extensions")) or {}).get("goalType")
        if goal_type not in statements.GOAL_TYPES:
            problems.append(f"goalType {goal_type!r} is off the list")
        if slug not in ("initialized", "updated", "completed"):
            problems.append(f"{slug} is not a student-goal verb")
        instructor = (statement.get("context") or {}).get("instructor")
        if instructor is not None and (instructor.get("account") or {}).get("homePage") != EXIDENTIFIER_HOMEPAGE:
            problems.append("context.instructor must be an exidentifier agent")

    # ── Content ─────────────────────────────────────────────────────────────
    # Agency and reflection questionnaires are the platform's own — typed like
    # content (questionnaire/question) but outside any vendor's catalog.
    platform_questionnaire = any(marker in str(obj.get("id")) for marker in ("/agency/", "/reflection/"))
    content = (
        obj_type in CONTENT_TYPES or slug in ("played", "paused", "requested", "selected")
    ) and not platform_questionnaire
    if content:
        if not any(str(entry.get("id") or "").startswith(f"{CONTENT_VENDOR_BASE}/") for entry in grouping):
            problems.append("content statement without a content-vendor grouping")
        if grouping and grouping[-1].get("id") != obj.get("id"):
            problems.append("the deepest grouping entry must be the statement's own object")
        if obj_type != "learning-unit" and not _parent(statement):
            problems.append("content statement needs context.contextActivities.parent")
        if slug == "answered" and "questionId" not in ext:
            problems.append("answered needs the questionId extension")
        if slug in ("played", "paused") and "mediaFormat" not in ext:
            problems.append(f"{slug} needs the mediaFormat extension")
        if slug == "paused" and "duration" not in result:
            problems.append("paused needs result.duration")
        if slug == "requested":
            if ext.get("helpSource") not in statements.HELP_SOURCES:
                problems.append(f"helpSource {ext.get('helpSource')!r} is off the list")
            if ext.get("helpType") not in statements.REQUESTED_HELP_TYPES:
                problems.append(f"requested helpType {ext.get('helpType')!r} is off the list")
        if slug == "selected":
            if ext.get("selectionType") not in statements.SELECTION_TYPES:
                problems.append(f"selectionType {ext.get('selectionType')!r} is off the list")
            if "response" not in result:
                problems.append("selected needs result.response")
        if "mediaDuration" in ext:
            problems.append("mediaDuration was removed in v1.1")
    return problems
