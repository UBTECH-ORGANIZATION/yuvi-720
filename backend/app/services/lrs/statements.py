"""Pure statement builders — one per 720 event, derived from the official
MoE integration document at `docs/LRS/מסמך התממשקות LRS.md`.

Every builder returns a complete xAPI statement dict with a server-generated
`id` (uuid4). That id is generated ONCE and persisted by the outbox; retries
resend the SAME id, which is the spec's de-dup mechanism (a duplicate id is
rejected by the LRS — by design).

Builders are pure: no I/O, no globals beyond config-derived IRIs. `identity`
is the resolved `ReportingIdentity`; `session_id` is the MoE sessionId minted
at login and shared by every statement of that visit.
"""

from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

# An absolute IRI carries a scheme prefix (RFC 3986 scheme = ALPHA *(…)":").
_ABSOLUTE_IRI = re.compile(r"^[A-Za-z][A-Za-z0-9+.\-]*:")

from app.services.lrs import config
from app.services.lrs.context import (
    ACTIVITY,
    EXT,
    MEDIA_ACTIVITY_TYPES,
    activity,
    build_actor,
    build_grouping,
    build_team,
    extensions,
    session_activity,
    verb,
)
from app.services.lrs.identity import ReportingIdentity


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def iso_duration(seconds: float) -> str:
    """Seconds → ISO-8601 duration (PT#H#M#S), as the spec's examples use."""
    total = max(0, int(round(seconds)))
    hours, rem = divmod(total, 3600)
    minutes, secs = divmod(rem, 60)
    out = "PT"
    if hours:
        out += f"{hours}H"
    if minutes or hours:
        out += f"{minutes}M"
    out += f"{secs}S"
    return out


def _domain() -> str:
    return config.supplier_domain()


def _base(
    identity: ReportingIdentity,
    verb_slug: str,
    obj: dict[str, Any],
    session_id: Optional[str],
    *,
    ecat_item_id: Optional[str] = None,
    context_extra: Optional[dict[str, Any]] = None,
    result: Optional[dict[str, Any]] = None,
    parent: Optional[list[dict[str, Any]]] = None,
    timestamp: Optional[str] = None,
    hierarchy: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    """Assemble the mandatory 720 envelope around one event.

    `hierarchy` (from `lrs.hierarchy.build`) carries the content ancestry the MoE
    requires on every content statement: the levels above the object in
    `grouping`, the direct level in `parent`, and every level's metadata in
    `context.extensions`. It never overrides an explicit `parent`/extension the
    caller passed — it fills in what is missing.
    """
    hierarchy = hierarchy or {}
    context: dict[str, Any] = {
        "contextActivities": {
            "grouping": build_grouping(
                session_id,
                ecat_item_id=ecat_item_id,
                extra=list(hierarchy.get("grouping") or []) or None,
            )
        }
    }
    if hierarchy.get("parent") and not parent:
        parent = list(hierarchy["parent"])
    if hierarchy.get("extensions"):
        merged = dict(extensions(hierarchy["extensions"]))
        supplied = ((context_extra or {}).get("extensions")) or {}
        merged.update(supplied)                 # the caller's own values win
        context_extra = {**(context_extra or {}), "extensions": merged}
    team = build_team(identity["school"], identity["nmm"])
    if team:
        context["team"] = team
    if parent:
        context["contextActivities"]["parent"] = parent
    if context_extra:
        for key, value in context_extra.items():
            if value:
                context.setdefault(key, {}).update(value) if isinstance(
                    value, dict
                ) else context.__setitem__(key, value)

    statement: dict[str, Any] = {
        "id": str(uuid.uuid4()),
        "actor": build_actor(identity["exidentifier"]),
        "verb": verb(verb_slug),
        "object": obj,
        "context": context,
        "timestamp": timestamp or _now(),
    }
    if result:
        statement["result"] = result
    return statement


# ── Session (התחברות) ────────────────────────────────────────────────────────
def session_enter(
    identity: ReportingIdentity,
    session_id: str,
    *,
    device: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    """`device` short keys: deviceType, platform, operatingSystem, osVersion,
    browser, browserVersion, applicationVersion."""
    return _base(
        identity,
        "enter",
        session_activity(session_id),
        session_id,
        context_extra={"extensions": extensions(device or {})} if device else None,
    )


def session_suspend(identity: ReportingIdentity, session_id: str) -> dict[str, Any]:
    return _base(identity, "suspend", session_activity(session_id), session_id)


def session_resume(identity: ReportingIdentity, session_id: str) -> dict[str, Any]:
    return _base(identity, "resume", session_activity(session_id), session_id)


def session_exit(
    identity: ReportingIdentity, session_id: str, duration_seconds: float
) -> dict[str, Any]:
    return _base(
        identity,
        "exit",
        session_activity(session_id),
        session_id,
        result={"duration": iso_duration(duration_seconds)},
    )


# ── Dashboard ────────────────────────────────────────────────────────────────
DASHBOARD_TYPES = {"student-personal", "student-view", "learning-group", "realtime-dashboard"}


def dashboard_viewed(
    identity: ReportingIdentity,
    session_id: str,
    dashboard_type: str,
    dashboard_id: Optional[str] = None,
    *,
    duration_seconds: Optional[float] = None,
    name_he: Optional[str] = None,
) -> dict[str, Any]:
    # dashboardId filter per the spec's split: student dashboards → the ת"ז
    # (exidentifier), group dashboards → the NMM id. Default from identity so
    # callers never handle the exidentifier themselves (PII boundary).
    if dashboard_id is None:
        if dashboard_type in {"learning-group", "realtime-dashboard"}:
            dashboard_id = identity["nmm"] or identity["school"] or ""
        else:
            dashboard_id = identity["exidentifier"]
    obj = activity(
        f"{_domain()}/dashboard/{dashboard_type}", "dashboard", name_he or "דשבורד"
    )
    return _base(
        identity,
        "viewed",
        obj,
        session_id,
        context_extra={"extensions": extensions({"dashboardId": dashboard_id})},
        result=(
            {"duration": iso_duration(duration_seconds)}
            if duration_seconds is not None
            else None
        ),
    )


# ── Agency questionnaire (שאלון פעלנות — onboarding) ─────────────────────────
def _agency_object(phase: str) -> dict[str, Any]:
    label = "לפני הלמידה" if phase.lower() == "pre" else "אחרי הלמידה"
    return activity(
        f"{_domain()}/agency/{phase.upper()}",
        "questionnaire",
        f"שאלון פעלנות - {label}",
    )


def agency_initialized(
    identity: ReportingIdentity, session_id: str, phase: str = "pre"
) -> dict[str, Any]:
    return _base(identity, "initialized", _agency_object(phase), session_id)


def agency_answered(
    identity: ReportingIdentity,
    session_id: str,
    question_number: int | str,
    response: str,
    *,
    score_raw: Optional[float] = None,
    score_min: float = 1,
    score_max: float = 5,
    phase: str = "pre",
    question_he: Optional[str] = None,
    question_id: Optional[str] = None,
    answer_id: Optional[str] = None,
) -> dict[str, Any]:
    # Prefer the official MoE question/answer URL ids so the statement is scored
    # against the ministry catalog; fall back to the local activity id.
    object_id = question_id or f"{_domain()}/agency/question/{question_number}"
    obj = activity(object_id, "question", question_he or f"שאלה {question_number}")
    # The official answer id (URL) is the canonical response; keep the numeric
    # value (1–5) as the scaled score.
    result: dict[str, Any] = {"response": answer_id or response}
    if score_raw is not None:
        result["score"] = {"min": score_min, "max": score_max, "raw": score_raw}
    return _base(
        identity,
        "answered",
        obj,
        session_id,
        result=result,
        parent=[{"objectType": "Activity", "id": f"{_domain()}/agency/{phase.upper()}"}],
    )


def agency_completed(
    identity: ReportingIdentity,
    session_id: str,
    duration_seconds: float,
    phase: str = "pre",
) -> dict[str, Any]:
    return _base(
        identity,
        "completed",
        _agency_object(phase),
        session_id,
        result={"completion": True, "duration": iso_duration(duration_seconds)},
    )


# ── Conversation (bot) — one `interacted` per chat turn ──────────────────────
def conversation_interacted(
    identity: ReportingIdentity,
    session_id: str,
    conversation_id: str,
    *,
    speaker: str,  # student | bot
    conversation_trigger: str,  # student-request | success-effort | misconception | idle-time
    help_type: Optional[str] = None,  # hint | explanation | alternative-content | other | bot-help-offer | motivation
    component_id: Optional[str] = None,
    item_id: Optional[str] = None,
    ecat_item_id: Optional[str] = None,
    hierarchy: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    obj = activity(f"{_domain()}/conversation/{conversation_id}", "conversation")
    ext = extensions(
        {
            "speaker": speaker,
            "conversationTrigger": conversation_trigger,
            # Required by the review, which found it missing. A turn that is not
            # a specific kind of help is still a kind: "other". Never absent.
            "helpType": help_type or "other",
            "componentId": component_id,
            "itemId": item_id,
        }
    )
    return _base(
        identity, "interacted", obj, session_id, context_extra={"extensions": ext},
        ecat_item_id=ecat_item_id, hierarchy=hierarchy,
    )


def conversation_rated(
    identity: ReportingIdentity,
    session_id: str,
    conversation_id: str,
    rating: str,  # like | dislike
    *,
    ecat_item_id: Optional[str] = None,
    hierarchy: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    obj = activity(f"{_domain()}/conversation/{conversation_id}", "conversation")
    return _base(
        identity,
        "rated",
        obj,
        session_id,
        result={"response": rating},
        context_extra={"extensions": extensions({"conversationType": "bot"})},
        ecat_item_id=ecat_item_id,
        hierarchy=hierarchy,
    )


# ── Reflection questionnaire ─────────────────────────────────────────────────
def _reflection_object(questionnaire_id: str) -> dict[str, Any]:
    return activity(
        f"{_domain()}/reflection/{questionnaire_id}", "questionnaire", "שאלון רפלקציה"
    )


def reflection_initialized(
    identity: ReportingIdentity,
    session_id: str,
    questionnaire_id: str,
    trigger: str,  # end-of-learning-objective | end-of-learning-component | difficult-task | other
    *,
    ecat_item_id: Optional[str] = None,
    hierarchy: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    return _base(
        identity,
        "initialized",
        _reflection_object(questionnaire_id),
        session_id,
        context_extra={"extensions": extensions({"reflactionTrigger": trigger})},
        ecat_item_id=ecat_item_id,
        hierarchy=hierarchy,
    )


def reflection_answered(
    identity: ReportingIdentity,
    session_id: str,
    questionnaire_id: str,
    question_number: int | str,
    *,
    response: Optional[str] = None,          # open answers
    score_raw: Optional[float] = None,        # rating answers
    score_min: float = 1,
    score_max: float = 5,
    question_he: Optional[str] = None,
    ecat_item_id: Optional[str] = None,
    hierarchy: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    """Exactly one of response / score_raw, per the spec."""
    obj = activity(
        f"{_domain()}/reflection/question/{question_number}",
        "question",
        # `object.definition.name` (the question's own text) was missing — the
        # review asked for it on both answered and skipped. Fall back to a
        # readable label so the field is never absent, but prefer the real text.
        question_he or f"שאלת רפלקציה {question_number}",
    )
    result: dict[str, Any]
    if response is not None:
        result = {"response": response}
    else:
        result = {"score": {"raw": score_raw, "min": score_min, "max": score_max}}
    return _base(
        identity,
        "answered",
        obj,
        session_id,
        result=result,
        parent=[
            {"objectType": "Activity", "id": f"{_domain()}/reflection/{questionnaire_id}"}
        ],
        ecat_item_id=ecat_item_id,
        hierarchy=hierarchy,
    )


def reflection_skipped(
    identity: ReportingIdentity,
    session_id: str,
    questionnaire_id: str,
    question_number: int | str,
    *,
    question_he: Optional[str] = None,
    ecat_item_id: Optional[str] = None,
    hierarchy: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    obj = activity(
        f"{_domain()}/reflection/question/{question_number}",
        "question",
        question_he or f"שאלת רפלקציה {question_number}",
    )
    return _base(
        identity,
        "skipped",
        obj,
        session_id,
        parent=[
            {"objectType": "Activity", "id": f"{_domain()}/reflection/{questionnaire_id}"}
        ],
        ecat_item_id=ecat_item_id,
        hierarchy=hierarchy,
    )


def reflection_completed(
    identity: ReportingIdentity,
    session_id: str,
    questionnaire_id: str,
    duration_seconds: float,
    *,
    ecat_item_id: Optional[str] = None,
    hierarchy: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    return _base(
        identity,
        "completed",
        _reflection_object(questionnaire_id),
        session_id,
        result={"completion": True, "duration": iso_duration(duration_seconds)},
        ecat_item_id=ecat_item_id,
        hierarchy=hierarchy,
    )


# ── Mentor-student meeting ───────────────────────────────────────────────────
def mentor_meeting_completed(
    identity: ReportingIdentity,
    session_id: str,
    meeting_id: str,
    *,
    mentor_exid: str,
    student_exid: str,
    meeting_date: str,  # YYYY-MM-DD
    mentoring_phase: Optional[str] = None,
) -> dict[str, Any]:
    obj = activity(
        f"{_domain()}/mentor-student-meeting/{meeting_id}", "mentor-student-meeting"
    )
    ext = extensions(
        {
            "mentor": mentor_exid,
            "student": student_exid,
            "meetingDate": meeting_date,
            "mentoringPhase": mentoring_phase,
        }
    )
    return _base(
        identity, "completed", obj, session_id, context_extra={"extensions": ext}
    )


# ── Student goal ─────────────────────────────────────────────────────────────
GOAL_TYPES = {"academic", "personal", "social-emotional", "motivational", "behavioral", "other"}


def _goal_object(goal_id: str, goal_type: str) -> dict[str, Any]:
    obj = activity(f"{_domain()}/student-goal/{goal_id}", "student-goal")
    obj["definition"]["extensions"] = extensions({"goalType": goal_type})
    return obj


def _with_instructor(
    statement: dict[str, Any], instructor_exid: Optional[str]
) -> dict[str, Any]:
    if instructor_exid:
        statement["context"]["instructor"] = build_actor(instructor_exid)
    return statement


def student_goal_initialized(
    identity: ReportingIdentity,
    session_id: str,
    goal_id: str,
    goal_type: str,
    *,
    instructor_exid: Optional[str] = None,
) -> dict[str, Any]:
    stmt = _base(identity, "initialized", _goal_object(goal_id, goal_type), session_id)
    return _with_instructor(stmt, instructor_exid)


def student_goal_updated(
    identity: ReportingIdentity,
    session_id: str,
    goal_id: str,
    goal_type: str,
    *,
    instructor_exid: Optional[str] = None,
) -> dict[str, Any]:
    stmt = _base(identity, "updated", _goal_object(goal_id, goal_type), session_id)
    return _with_instructor(stmt, instructor_exid)


def student_goal_completed(
    identity: ReportingIdentity,
    session_id: str,
    goal_id: str,
    goal_type: str,
    *,
    instructor_exid: Optional[str] = None,
) -> dict[str, Any]:
    stmt = _base(identity, "completed", _goal_object(goal_id, goal_type), session_id)
    return _with_instructor(stmt, instructor_exid)


# ── Content: component ───────────────────────────────────────────────────────
def component_initialized(
    identity: ReportingIdentity,
    session_id: str,
    component_id: str,
    *,
    ecat_item_id: Optional[str] = None,
    name_he: Optional[str] = None,
    metadata_ext: Optional[dict[str, Any]] = None,   # unit+component metadata (short keys)
    unit_grouping: Optional[dict[str, Any]] = None,   # learning-unit activity for grouping
    parent: Optional[list[dict[str, Any]]] = None,
    hierarchy: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    obj = activity(f"{_domain()}/component/{component_id}", "component", name_he)
    stmt = _base(
        identity,
        "initialized",
        obj,
        session_id,
        ecat_item_id=ecat_item_id,
        context_extra=(
            {"extensions": extensions(metadata_ext)} if metadata_ext else None
        ),
        parent=parent,
        hierarchy=hierarchy,
    )
    if unit_grouping:
        stmt["context"]["contextActivities"]["grouping"].append(unit_grouping)
    return stmt


def component_completed(
    identity: ReportingIdentity,
    session_id: str,
    component_id: str,
    *,
    success: Optional[bool] = None,
    score_scaled: Optional[float] = None,
    duration_seconds: Optional[float] = None,
    ecat_item_id: Optional[str] = None,
    name_he: Optional[str] = None,
    metadata_ext: Optional[dict[str, Any]] = None,
    unit_grouping: Optional[dict[str, Any]] = None,
    hierarchy: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    obj = activity(f"{_domain()}/component/{component_id}", "component", name_he)
    result: dict[str, Any] = {}
    if success is not None:
        result["success"] = success
    if score_scaled is not None:
        result["score"] = {"scaled": score_scaled}
    if duration_seconds is not None:
        result["duration"] = iso_duration(duration_seconds)
    stmt = _base(
        identity,
        "completed",
        obj,
        session_id,
        ecat_item_id=ecat_item_id,
        result=result or None,
        context_extra=(
            {"extensions": extensions(metadata_ext)} if metadata_ext else None
        ),
        hierarchy=hierarchy,
    )
    if unit_grouping:
        stmt["context"]["contextActivities"]["grouping"].append(unit_grouping)
    return stmt


# ── Content: generic forwarded statement (Kata relay → enrich → MoE) ─────────
def question_answered(
    identity: ReportingIdentity,
    session_id: str,
    *,
    object_id: str,
    question_id: str,
    response: str,
    question_type: Optional[str] = None,
    attempt_number: int = 1,
    success: Optional[bool] = None,
    score_scaled: Optional[float] = None,
    duration_seconds: Optional[float] = None,
    question_he: Optional[str] = None,
    hierarchy: Optional[dict[str, Any]] = None,
    ecat_item_id: Optional[str] = None,
) -> dict[str, Any]:
    """A learner's answer to a content question (MoE §"מענה על שאלה").

    The review found three extensions missing or misnamed and `result.response`
    absent: what the learner actually chose is the whole point of the event, and
    `questionId` (not `question_id`), `questionType` and `attemptNumber` are what
    let the ministry group attempts of the same question together.
    """
    obj = activity(object_id, "question", question_he)
    result: dict[str, Any] = {"response": response}
    if success is not None:
        result["success"] = success
    if score_scaled is not None:
        result["score"] = {"scaled": score_scaled}
    if duration_seconds is not None:
        result["duration"] = iso_duration(duration_seconds)
    return _base(
        identity,
        "answered",
        obj,
        session_id,
        result=result,
        context_extra={
            "extensions": extensions({
                "questionId": question_id,
                "questionType": question_type,
                "attemptNumber": attempt_number,
            })
        },
        hierarchy=hierarchy,
        ecat_item_id=ecat_item_id,
    )


# The media dictionary lives in `context` now — the item ACTIVITY in a content
# hierarchy has to type itself the same way, and one table cannot live in two
# modules and stay one table.
_MEDIA_ACTIVITY_TYPES = MEDIA_ACTIVITY_TYPES


def _seconds(value: Optional[float]) -> Optional[float]:
    """mediaPosition / mediaDuration are PLAIN SECONDS, not ISO-8601.

    The spec is explicit ("המיקום במדיה, בשניות") and its examples are bare
    numbers — `"mediaPosition": 105`, `"mediaDuration": 120`. Only
    `result.duration` is an ISO-8601 duration. We were sending `PT1M45S` for
    both, which is the right instant expressed in a type the field does not
    take. Whole values stay ints so the JSON reads `120`, not `120.0`.
    """
    if value is None:
        return None
    number = round(float(value), 3)
    return int(number) if number == int(number) else number


def media_event(
    identity: ReportingIdentity,
    session_id: str,
    verb_slug: str,                      # played | paused | completed
    *,
    object_id: str,
    media_format: str,                   # video | audio | animation
    media_position_seconds: Optional[float] = None,
    media_duration_seconds: Optional[float] = None,
    duration_seconds: Optional[float] = None,   # result.duration (watched so far)
    name_he: Optional[str] = None,
    hierarchy: Optional[dict[str, Any]] = None,
    ecat_item_id: Optional[str] = None,
) -> dict[str, Any]:
    """`played` / `paused` / `completed` on a video, audio or animation.

    The review: all three were missing `mediaFormat`, `mediaPosition` and
    `mediaDuration`, and `paused`/`completed` were missing `result.duration`.
    Position/duration are only ever what the content told us — an unknown one is
    omitted, never guessed.
    """
    obj = activity(
        object_id, _MEDIA_ACTIVITY_TYPES.get(str(media_format or "").lower(), "item"), name_he
    )
    result = (
        {"duration": iso_duration(duration_seconds)}
        if duration_seconds is not None
        else None
    )
    return _base(
        identity,
        verb_slug,
        obj,
        session_id,
        result=result,
        context_extra={
            "extensions": extensions({
                "mediaFormat": media_format,
                "mediaPosition": _seconds(media_position_seconds),
                "mediaDuration": _seconds(media_duration_seconds),
            })
        },
        hierarchy=hierarchy,
        ecat_item_id=ecat_item_id,
    )


def item_skipped(
    identity: ReportingIdentity,
    session_id: str,
    *,
    object_id: str,
    name_he: Optional[str] = None,
    hierarchy: Optional[dict[str, Any]] = None,
    ecat_item_id: Optional[str] = None,
) -> dict[str, Any]:
    return _base(
        identity, "skipped", activity(object_id, "item", name_he), session_id,
        hierarchy=hierarchy,
        ecat_item_id=ecat_item_id,
    )


def _infer_object_type(hierarchy: dict[str, Any]) -> str:
    """Default `object.definition.type` for a relayed content statement whose
    own object arrived with none (real Kata statements for a learning-unit or
    a component's own item set carry a bare `{"id": ...}` — no `definition` at
    all; the review flagged both as "Object נשלח לא תקין").

    Read off the SAME hierarchy already resolved for `grouping`: its deepest
    entry is the level this statement's object sits at — `learning-unit`,
    `component`, or `item` (already typed by its media format, if any). An item
    that itself carries a `questions` digest (the component's own quiz screen)
    is reported as `questionnaire` per the spec's item-as-content section,
    not as a plain `item`.
    """
    grouping = hierarchy.get("grouping") or []
    if not grouping:
        return "item"
    leaf_type = ((grouping[-1].get("definition") or {}).get("type") or "").rsplit("/", 1)[-1]
    if leaf_type == "item" and (hierarchy.get("extensions") or {}).get("questions"):
        return "questionnaire"
    return leaf_type or "item"


def enriched_content_statement(
    identity: ReportingIdentity,
    session_id: str,
    raw_statement: dict[str, Any],
    *,
    ecat_item_id: Optional[str] = None,
    hierarchy: Optional[dict[str, Any]] = None,
    result_extra: Optional[dict[str, Any]] = None,
    context_extensions: Optional[dict[str, Any]] = None,
    default_object_type: Optional[str] = None,
    name_he: Optional[str] = None,
) -> dict[str, Any]:
    """Wrap a content-origin statement (question/media/item events relayed via
    Kata) in the mandatory 720 envelope: replace the actor with the
    exidentifier agent, and merge lms/session/program/content-vendor into
    grouping while preserving the content's own verb/object/result/parent
    and metadata extensions. A NEW outbound id is generated (our report ≠
    the content's internal statement id)."""
    hierarchy = hierarchy or {}
    ctx = dict(raw_statement.get("context") or {})
    context_activities = dict(ctx.get("contextActivities") or {})
    grouping = list(context_activities.get("grouping") or [])
    # The ancestry the ministry requires: the unit and component this item lives
    # in, in `grouping`, and the component in `parent`. The content sends neither
    # (it only knows its own object), so we supply them from the catalog.
    grouping.extend(hierarchy.get("grouping") or [])
    grouping = build_grouping(session_id, ecat_item_id=ecat_item_id, extra=grouping)
    context_activities["grouping"] = grouping
    if hierarchy.get("parent") and not context_activities.get("parent"):
        context_activities["parent"] = list(hierarchy["parent"])
    ctx["contextActivities"] = context_activities
    merged_extensions = dict(hierarchy.get("extensions") or {})
    merged_extensions.update(context_extensions or {})
    if merged_extensions or ctx.get("extensions"):
        combined = {**(ctx.get("extensions") or {}), **merged_extensions}
        ctx["extensions"] = _iri_safe_extensions(combined)
        if not ctx["extensions"]:
            ctx.pop("extensions")
    team = build_team(identity["school"], identity["nmm"])
    if team:
        ctx["team"] = team

    # Object definition extensions are content-controlled too — bare keys there
    # produce the same MoE 400 rejection, so sanitize them as well.
    obj = raw_statement.get("object")
    if isinstance(obj, dict):
        obj = dict(obj)
        # Learning-unit statements: the review also asked that `object` be the
        # SAME activity as its `grouping` entry. There is exactly one level with
        # nothing beneath it to confuse — the unit itself — so the canonical
        # unit activity `hierarchy` already put in `grouping` is authoritative;
        # Kata's own (bare, type-less) object for this event is replaced with it
        # rather than patched, unlike every deeper level where the content's own
        # object is the one thing we must not invent.
        unit_grouping = hierarchy.get("grouping") or []
        if len(unit_grouping) == 1 and (unit_grouping[0].get("definition") or {}).get(
            "type", ""
        ).endswith("/learning-unit"):
            obj = dict(unit_grouping[0])
        obj.setdefault("objectType", "Activity")
        definition = dict(obj.get("definition") or {})
        # The review's recurring "Object נשלח לא תקין" — no `definition.type` at
        # all — happens on statements Kata never had a native shape for
        # (learning-unit init, a component's own item-quiz). Never invented when
        # the content already declared one.
        if not definition.get("type"):
            definition["type"] = f"{ACTIVITY}/{default_object_type or _infer_object_type(hierarchy)}"
        if name_he and not definition.get("name"):
            definition["name"] = {"he": name_he}
        if definition:
            obj["definition"] = definition
        if isinstance(obj.get("definition"), dict) and obj["definition"].get("extensions"):
            obj["definition"]["extensions"] = _iri_safe_extensions(obj["definition"]["extensions"])
            if not obj["definition"]["extensions"]:
                obj["definition"].pop("extensions")

    statement = {
        "id": str(uuid.uuid4()),
        "actor": build_actor(identity["exidentifier"]),
        "verb": raw_statement.get("verb"),
        "object": obj,
        "context": ctx,
        "timestamp": raw_statement.get("timestamp") or _now(),
    }
    result = dict(raw_statement.get("result") or {})
    # `result_extra` fills the fields the review found missing on relayed events
    # (a `duration` on paused/completed media, a `response` the content omitted).
    # It never overwrites something the content did report.
    for key, value in (result_extra or {}).items():
        if value is not None and result.get(key) in (None, ""):
            result[key] = value
    if result:
        if result.get("extensions"):
            result["extensions"] = _iri_safe_extensions(result["extensions"])
            if not result["extensions"]:
                result.pop("extensions")
        statement["result"] = result
    return statement


def _iri_safe_extensions(values: dict[str, Any]) -> dict[str, Any]:
    """xAPI requires extension keys to be IRIs; the MoE LRS rejects bare keys
    (live 400: `NoAdditionalPropertiesAllowed: #/context.extensions.question_id`).
    Content relayed through our inbound convention may carry bare keys — map
    them onto the extension namespace instead of dropping the data."""
    safe: dict[str, Any] = {}
    for key, value in (values or {}).items():
        if value is None:
            continue
        # An absolute IRI already has a scheme (http:, https:, urn:, tag:, …).
        # Only bare short names get mapped onto the MoE extension namespace; a
        # real IRI is passed through so its identity is never rewritten.
        if isinstance(key, str) and _ABSOLUTE_IRI.match(key):
            safe[key] = value
        else:
            safe[f"{EXT}/{key}"] = value
    return safe


# ── Help request ─────────────────────────────────────────────────────────────
def help_requested(
    identity: ReportingIdentity,
    session_id: str,
    *,
    object_id: str,                 # full IRI of the component/item help was asked from
    object_type: str,               # component | item | question ...
    help_source: str,               # content | platform
    help_type: str,                 # hint | explanation
    parent: Optional[list[dict[str, Any]]] = None,
    ecat_item_id: Optional[str] = None,
    hierarchy: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    obj = activity(object_id, object_type)
    return _base(
        identity,
        "requested",
        obj,
        session_id,
        context_extra={
            "extensions": extensions({"helpSource": help_source, "helpType": help_type})
        },
        parent=parent,
        ecat_item_id=ecat_item_id,
        hierarchy=hierarchy,
    )


# ── Non-learning selection ───────────────────────────────────────────────────
SELECTION_TYPES = {"learning-type", "practice-decision", "is-understood", "is-repeat", "external-learning"}

_CAMEL_BOUNDARY = re.compile(r"(?<=[a-z0-9])(?=[A-Z])")


def kebab(value: str) -> str:
    """`practiceDecision` → `practice-decision`.

    The MoE review rejected the camelCase value we sent for `selectionType`; the
    720 selection dictionary is kebab-case. Callers may pass either spelling —
    the wire format is decided here, once.
    """
    text = str(value or "").strip()
    if not text:
        return text
    return _CAMEL_BOUNDARY.sub("-", text).replace("_", "-").replace(" ", "-").lower()


def selected(
    identity: ReportingIdentity,
    session_id: str,
    *,
    object_id: str,
    object_type: str,
    selection_type: str,
    response: str,
    hierarchy: Optional[dict[str, Any]] = None,
    ecat_item_id: Optional[str] = None,
) -> dict[str, Any]:
    obj = activity(object_id, object_type)
    return _base(
        identity,
        "selected",
        obj,
        session_id,
        result={"response": response},
        context_extra={"extensions": extensions({"selectionType": kebab(selection_type)})},
        hierarchy=hierarchy,
        ecat_item_id=ecat_item_id,
    )
