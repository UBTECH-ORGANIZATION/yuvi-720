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

from app.agents.teacher_tools.registry import TeacherTool, TeacherToolContext, register

# The routes the teacher app actually has (A8). `navigate` validates against
# this rather than accepting a model-authored path.
ROUTES: dict[str, str] = {
    "home": "/teacher",
    "students": "/teacher/students",
    "student": "/teacher/student/{learner_id}",
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

    route = template
    if "{learner_id}" in template:
        learner_id = str(args.get("learner_id") or "")
        if not learner_id:
            return {"data": None, "reason": "learner_id_required_for_this_screen"}
        # Scope-checked by the registry via `learner_args` before we get here.
        route = template.replace("{learner_id}", learner_id)

    # A suggestion the client renders as a button. Not a redirect.
    return {"data": {"screen": screen, "route": route, "action": "offer_button"}}


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
        }, "required": ["screen"]},
        handler=_navigate, learner_args=("learner_id",),
    ))
