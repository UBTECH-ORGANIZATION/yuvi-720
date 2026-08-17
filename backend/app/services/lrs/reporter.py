"""Public façade for outbound MoE-LRS reporting — the ONLY module routes and
services should import from this package.

Contract: every `report_*` function is report-and-forget — it never raises
into the caller (a reporting failure must never break a feature), and it is a
fast no-op when `LRS_ENABLED` is off. Each call: resolve identity → build the
statement → enqueue (which persists + sends Near-Real-Time).
"""

from __future__ import annotations

from typing import Any, Optional

from app.services.lrs import config, identity as identity_mod, outbox, statements

# Remember which identity we already complained about, so a misconfigured
# deployment logs once per value instead of once per statement.
_warned_identities: set[str] = set()


def _identity_is_reportable() -> bool:
    """Refuse to send statements stamped with placeholder identifiers.

    The ministry's first finding was that `grouping→lms` arrived as
    `https://720.example.co.il` and `content-vendor` as `ECAT-720-contract` —
    values that validate perfectly and identify nobody. `identity_problems()`
    was written to catch exactly that but was only ever consulted by the
    contract-report script, so nothing stopped the live path from sending the
    same placeholders again. Silence is the right failure here: statements are
    permanent and de-duplicated by id at the LRS, so a wrong one cannot be
    withdrawn, whereas an unsent one is simply sent once the env is filled in.
    """
    problems = config.identity_problems()
    if not problems:
        return True
    fingerprint = "|".join(problems)
    if fingerprint not in _warned_identities:
        _warned_identities.add(fingerprint)
        for problem in problems:
            print(f"⚠️ LRS reporting disabled — {problem}")
    return False


async def _content_context(
    learner_id: str,
    component_id: Optional[str] = None,
    item_id: Optional[str] = None,
    *,
    unit_id: Optional[str] = None,
) -> dict[str, Any]:
    """Ancestry + supplier id for a PLATFORM event that happened inside content.

    The ministry's content rules apply to our own events too — a reflection, a
    coach turn and a help request all sit under an item, which sits under a
    component, which sits under a learning unit — but the callers don't carry
    those ids around. They don't have to: the learner's position is already in
    the Brain (`current_state`), which is precisely where the event happened.

    Returns `{}` when the position is unknown, so a statement is never decorated
    with ancestry that might belong to a different lesson.
    """
    if not component_id and not unit_id:
        try:
            from app.brain.repository import get_brain

            state = (await get_brain(learner_id)).get("current_state") or {}
            component_id = component_id or state.get("component_id")
            item_id = item_id or state.get("item_id")
            unit_id = unit_id or state.get("unit_id")
        except Exception:
            return {}
    if not component_id and not unit_id:
        return {}
    try:
        from app.services.lrs import hierarchy as hierarchy_mod

        return {
            "hierarchy": await hierarchy_mod.for_content(
                component_id, item_id, unit_id=unit_id
            ),
            "ecat_item_id": await hierarchy_mod.ecat_item_for(
                component_id, item_id, unit_id=unit_id
            ),
        }
    except Exception:
        return {}


async def _report(build, learner_id: str, *args, source: str = "platform", **kwargs) -> None:
    if not config.is_enabled() or not _identity_is_reportable():
        return
    try:
        identity = await identity_mod.resolve_reporting_identity(learner_id)
        if identity is None:
            return  # no reporting identity configured — skip, never guess
        statement = build(identity, *args, **kwargs)
        await outbox.enqueue(statement, learner_id=learner_id, source=source)
    except Exception as exc:  # report-and-forget: log class name only
        print(f"⚠️ LRS report skipped ({type(exc).__name__})")


# ── Session ──────────────────────────────────────────────────────────────────
async def report_session_enter(
    learner_id: str, session_id: str, device: Optional[dict[str, Any]] = None
) -> None:
    await _report(statements.session_enter, learner_id, session_id, device=device)


async def report_session_suspend(learner_id: str, session_id: str) -> None:
    await _report(statements.session_suspend, learner_id, session_id)


async def report_session_resume(learner_id: str, session_id: str) -> None:
    await _report(statements.session_resume, learner_id, session_id)


async def report_session_exit(
    learner_id: str, session_id: str, duration_seconds: float
) -> None:
    await _report(statements.session_exit, learner_id, session_id, duration_seconds)


# ── Dashboard ────────────────────────────────────────────────────────────────
async def report_dashboard_viewed(
    learner_id: str,
    session_id: str,
    dashboard_type: str,
    dashboard_id: str,
    duration_seconds: Optional[float] = None,
) -> None:
    await _report(
        statements.dashboard_viewed,
        learner_id,
        session_id,
        dashboard_type,
        dashboard_id,
        duration_seconds=duration_seconds,
    )


# ── Agency questionnaire (onboarding) ────────────────────────────────────────
async def report_agency_initialized(
    learner_id: str, session_id: str, phase: str = "pre"
) -> None:
    await _report(statements.agency_initialized, learner_id, session_id, phase)


async def report_agency_answered(
    learner_id: str,
    session_id: str,
    question_number: int | str,
    response: str,
    score_raw: Optional[float] = None,
    phase: str = "pre",
    *,
    question_id: Optional[str] = None,
    answer_id: Optional[str] = None,
) -> None:
    await _report(
        statements.agency_answered,
        learner_id,
        session_id,
        question_number,
        response,
        score_raw=score_raw,
        phase=phase,
        question_id=question_id,
        answer_id=answer_id,
    )


async def report_agency_completed(
    learner_id: str, session_id: str, duration_seconds: float, phase: str = "pre"
) -> None:
    await _report(
        statements.agency_completed, learner_id, session_id, duration_seconds, phase
    )


# ── Conversation ─────────────────────────────────────────────────────────────
async def report_conversation_interacted(
    learner_id: str,
    session_id: str,
    conversation_id: str,
    speaker: str,
    conversation_trigger: str,
    help_type: Optional[str] = None,
    component_id: Optional[str] = None,
    item_id: Optional[str] = None,
) -> None:
    await _report(
        statements.conversation_interacted,
        learner_id,
        session_id,
        conversation_id,
        speaker=speaker,
        conversation_trigger=conversation_trigger,
        help_type=help_type,
        component_id=component_id,
        item_id=item_id,
        **await _content_context(learner_id, component_id, item_id),
    )


async def report_conversation_rated(
    learner_id: str, session_id: str, conversation_id: str, rating: str
) -> None:
    await _report(
        statements.conversation_rated, learner_id, session_id, conversation_id, rating,
        **await _content_context(learner_id),
    )


# ── Reflection ───────────────────────────────────────────────────────────────
async def report_reflection_initialized(
    learner_id: str, session_id: str, questionnaire_id: str, trigger: str
) -> None:
    await _report(
        statements.reflection_initialized,
        learner_id,
        session_id,
        questionnaire_id,
        trigger,
        **await _content_context(learner_id),
    )


async def report_reflection_answered(
    learner_id: str,
    session_id: str,
    questionnaire_id: str,
    question_number: int | str,
    response: Optional[str] = None,
    score_raw: Optional[float] = None,
    question_he: Optional[str] = None,
) -> None:
    await _report(
        statements.reflection_answered,
        learner_id,
        session_id,
        questionnaire_id,
        question_number,
        response=response,
        score_raw=score_raw,
        question_he=question_he,
        **await _content_context(learner_id),
    )


async def report_reflection_skipped(
    learner_id: str,
    session_id: str,
    questionnaire_id: str,
    question_number: int | str,
    question_he: Optional[str] = None,
) -> None:
    await _report(
        statements.reflection_skipped,
        learner_id,
        session_id,
        questionnaire_id,
        question_number,
        question_he=question_he,
        **await _content_context(learner_id),
    )


async def report_reflection_completed(
    learner_id: str, session_id: str, questionnaire_id: str, duration_seconds: float
) -> None:
    await _report(
        statements.reflection_completed,
        learner_id,
        session_id,
        questionnaire_id,
        duration_seconds,
        **await _content_context(learner_id),
    )


# ── Mentoring + goals ────────────────────────────────────────────────────────
async def report_mentor_meeting_completed(
    learner_id: str,
    session_id: str,
    meeting_id: str,
    mentor_exid: str,
    student_exid: str,
    meeting_date: str,
    mentoring_phase: Optional[str] = None,
) -> None:
    await _report(
        statements.mentor_meeting_completed,
        learner_id,
        session_id,
        meeting_id,
        mentor_exid=mentor_exid,
        student_exid=student_exid,
        meeting_date=meeting_date,
        mentoring_phase=mentoring_phase,
    )


async def report_student_goal(
    learner_id: str,
    session_id: str,
    action: str,  # initialized | updated | completed
    goal_id: str,
    goal_type: str,
    instructor_exid: Optional[str] = None,
) -> None:
    builder = {
        "initialized": statements.student_goal_initialized,
        "updated": statements.student_goal_updated,
        "completed": statements.student_goal_completed,
    }.get(action)
    if builder is None:
        return
    await _report(
        builder, learner_id, session_id, goal_id, goal_type,
        instructor_exid=instructor_exid,
    )


# ── Help + selection ─────────────────────────────────────────────────────────
async def report_help_requested(
    learner_id: str,
    session_id: str,
    object_id: str,
    object_type: str,
    help_source: str,
    help_type: str,
    *,
    component_id: Optional[str] = None,
    item_id: Optional[str] = None,
) -> None:
    # `component_id`/`item_id` pin the ancestry to the SAME level as `object`.
    # Left unset, `_content_context` falls back to the brain's full current
    # position, which can be a level DEEPER than the object (e.g. a
    # component-level help request while the learner is already on a specific
    # item) — the review read that stray, unrelated item in `grouping` as the
    # object being wrong, when the real bug was including an ancestor the
    # object never had.
    await _report(
        statements.help_requested,
        learner_id,
        session_id,
        object_id=object_id,
        object_type=object_type,
        help_source=help_source,
        help_type=help_type,
        **await _content_context(learner_id, component_id, item_id),
    )


async def report_selected(
    learner_id: str,
    session_id: str,
    object_id: str,
    object_type: str,
    selection_type: str,
    response: str,
    *,
    component_id: Optional[str] = None,
    item_id: Optional[str] = None,
) -> None:
    await _report(
        statements.selected,
        learner_id,
        session_id,
        object_id=object_id,
        object_type=object_type,
        selection_type=selection_type,
        response=response,
        **await _content_context(learner_id, component_id, item_id),
    )


# ── Content (component + relayed statements) ─────────────────────────────────
async def report_component_initialized(
    learner_id: str, session_id: str, component_id: str, **kwargs: Any
) -> None:
    await _report(
        statements.component_initialized, learner_id, session_id, component_id,
        source="kata", **kwargs,
    )


async def report_component_completed(
    learner_id: str, session_id: str, component_id: str, **kwargs: Any
) -> None:
    await _report(
        statements.component_completed, learner_id, session_id, component_id,
        source="kata", **kwargs,
    )


async def report_content_statement(
    learner_id: str,
    session_id: str,
    raw_statement: dict[str, Any],
    ecat_item_id: Optional[str] = None,
    *,
    hierarchy: Optional[dict[str, Any]] = None,
    context_extensions: Optional[dict[str, Any]] = None,
    result_extra: Optional[dict[str, Any]] = None,
) -> None:
    """Forward a content-origin statement (relayed by Kata into /api/xapi):
    enrich with the 720 envelope and enqueue. Hooked after first-sight ingest
    in events.ingest_statement(). `hierarchy` carries the unit/component
    ancestry the ministry requires above the item."""
    await _report(
        statements.enriched_content_statement,
        learner_id,
        session_id,
        raw_statement,
        ecat_item_id=ecat_item_id,
        hierarchy=hierarchy,
        context_extensions=context_extensions,
        result_extra=result_extra,
        source="kata",
    )
