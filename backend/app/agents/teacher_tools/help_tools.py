"""Meta tools — product help, metric definitions, screen context, navigation.

These exist so that "how do I filter by subject?" and "what counts as inactive?"
are *tool-backed* answers rather than model improvisation. That matters more
than it looks: the anti-hallucination contract blocks any factual claim with no
tool result behind it, so without this lane the assistant would have to refuse
every product question. Here the meta lane is grounded too.

`navigate` deliberately returns a *button*, not a redirect. A model that could
move the teacher's screen at will is a model that can be prompt-injected into
moving it somewhere confusing; the teacher clicks, or nothing happens.
"""

from __future__ import annotations

from typing import Any

# Roster filters that are real: `students` accepts one of these as a deep link,
# so "show me who has not been here in a week" lands on the filtered table
# rather than on the whole class for the teacher to filter by hand.
#
# Imported, not restated. These are the same four words `list_students` resolves
# into ids, and a second copy would let the two drift into a state where the
# model can *find* a set it cannot *link to* — or link to a filter the roster
# silently ignores, which is exactly what `inactive` did before this round.
from app.agents.teacher_tools.data_tools import ROSTER_FILTERS
from app.agents.teacher_tools.registry import TeacherTool, TeacherToolContext, register

# The routes the teacher app actually has (A8). `navigate` validates against
# this rather than accepting a model-authored path.
ROUTES: dict[str, str] = {
    "home": "/teacher",
    "students": "/teacher/students",
    "student": "/teacher/student/{learner_id}",
    "goals": "/teacher/goals",
    "learnings": "/teacher/learnings",
    "messages": "/teacher/messages",
    "admin": "/admin",
}

async def _how_to(context: TeacherToolContext, args: dict) -> dict:
    from app.services import teacher_help_kb
    return teacher_help_kb.how_to(str(args.get("topic") or ""))


async def _explain_metric(context: TeacherToolContext, args: dict) -> dict:
    from app.services import teacher_help_kb
    return teacher_help_kb.explain_metric(str(args.get("metric") or ""))


async def _get_screen_context(context: TeacherToolContext, args: dict) -> dict:
    """What the teacher is looking at, verbatim as the client reported it."""
    if not context.screen:
        return {"data": None, "reason": "no_screen_context_reported"}
    return {"data": context.screen}


async def _list_available_data(context: TeacherToolContext, args: dict) -> dict:
    """Derived from the registry, so the offer can never drift from the code."""
    from app.agents.teacher_tools import registry
    return {"data": registry.manifest()}


async def _navigate(context: TeacherToolContext, args: dict) -> dict:
    screen = str(args.get("screen") or "")
    template = ROUTES.get(screen)
    if template is None:
        return {"data": None, "reason": "unknown_screen", "available": sorted(ROUTES)}

    learner_id = ""
    route = template
    if "{learner_id}" in template:
        learner_id = str(args.get("learner_id") or "")
        if not learner_id:
            return {"data": None, "reason": "learner_id_required_for_this_screen"}
        # Scope-checked by the registry via `learner_args` before we get here.
        route = template.replace("{learner_id}", learner_id)

    # A filter is only ever appended to a route that has one, and only from the
    # closed set — the model must not be able to mint an arbitrary query string.
    roster_filter = str(args.get("filter") or "")
    if screen == "students" and roster_filter in ROSTER_FILTERS:
        route = f"{route}?filter={roster_filter}"
    else:
        roster_filter = ""

    # A suggestion the client renders as a button. Not a redirect.
    return {
        "data": {"screen": screen, "route": route, "action": "offer_button"},
        "offer": {
            "kind": "navigate",
            "label_key": f"tch.assistant.action.open.{screen}",
            "route": route,
            "params": {"learner_id": learner_id} if learner_id else {},
            "icon": "student" if learner_id else "arrow",
        },
    }


def register_all() -> None:
    from app.services import teacher_help_kb

    register(TeacherTool(
        name="how_to",
        description=(
            "How to do something in the teacher app. Use for product questions "
            f"rather than guessing. Topics: {', '.join(teacher_help_kb.topics())}."
        ),
        parameters={"type": "object", "properties": {
            "topic": {"type": "string", "enum": teacher_help_kb.topics()},
        }, "required": ["topic"]},
        handler=_how_to,
    ))
    register(TeacherTool(
        name="explain_metric",
        description=(
            "The exact definition and threshold of a metric, read from the live "
            f"system constants. Metrics: {', '.join(teacher_help_kb.metrics())}."
        ),
        parameters={"type": "object", "properties": {
            "metric": {"type": "string", "enum": teacher_help_kb.metrics()},
        }, "required": ["metric"]},
        handler=_explain_metric,
    ))
    register(TeacherTool(
        name="get_screen_context",
        description="What the teacher is currently looking at, if the client reported it.",
        parameters={"type": "object", "properties": {}},
        handler=_get_screen_context,
    ))
    register(TeacherTool(
        name="list_available_data",
        description=(
            "Everything you could fetch. Use when you cannot answer, so you can "
            "name what IS available instead of guessing."
        ),
        parameters={"type": "object", "properties": {}},
        handler=_list_available_data,
    ))
    register(TeacherTool(
        name="navigate",
        description=(
            "Offer the teacher a button to a screen. This does NOT move them; "
            "they choose to click."
        ),
        parameters={"type": "object", "properties": {
            "screen": {"type": "string", "enum": sorted(ROUTES)},
            "learner_id": {"type": "string", "description": "Required for the `student` screen."},
            "filter": {
                "type": "string", "enum": sorted(ROSTER_FILTERS),
                "description": "Optional, `students` only — opens the roster already filtered.",
            },
        }, "required": ["screen"]},
        handler=_navigate, learner_args=("learner_id",),
    ))
