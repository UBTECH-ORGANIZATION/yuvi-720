"""Registry and dispatch boundary for learner Coach tools.

The model can choose only registered, read-only learner tools permitted for its
current Coach mode. The authenticated server derives learner identity; tool
arguments never carry identities, URLs, endpoint names, or database selectors.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

from app.agents.coach_modes import CoachMode


MAX_TOOL_CALLS = 4
MAX_SECONDS = 10.0


class ToolError(Exception):
    """An expected tool failure that is safe to return to the model."""


@dataclass
class CoachToolContext:
    """Server-derived per-turn context available to registered tools only."""

    learner_id: str
    mode: CoachMode
    language: str
    session_id: str
    exchange_id: str | None
    bundle: dict[str, Any]
    action_offers: list[dict[str, Any]] = field(default_factory=list)
    visual_requests: list[dict[str, str]] = field(default_factory=list)
    calls_made: int = 0
    started_at: float = field(default_factory=time.monotonic)

    def budget_exhausted(self) -> str | None:
        if self.calls_made >= MAX_TOOL_CALLS:
            return "tool_budget_exhausted"
        if time.monotonic() - self.started_at > MAX_SECONDS:
            return "time_budget_exhausted"
        return None


@dataclass(frozen=True)
class CoachTool:
    name: str
    description: str
    parameters: dict[str, Any]
    handler: Callable[[CoachToolContext, dict[str, Any]], Awaitable[dict[str, Any]]]
    allowed_modes: frozenset[CoachMode]

    def as_openai_schema(self) -> dict[str, Any]:
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.parameters,
            },
        }


_REGISTRY: dict[str, CoachTool] = {}


def register(tool: CoachTool) -> CoachTool:
    if tool.name in _REGISTRY:
        raise ValueError(f"duplicate coach tool: {tool.name}")
    _REGISTRY[tool.name] = tool
    return tool


def schemas(mode: CoachMode) -> list[dict[str, Any]]:
    """Return only provider schemas the active Coach mode may select."""
    return [
        tool.as_openai_schema()
        for tool in _REGISTRY.values()
        if mode in tool.allowed_modes
    ]


def is_registered_name(name: str) -> bool:
    """Whether a diagnostic step is the name of a registered Coach tool."""
    return name in _REGISTRY


def _validate_arguments(tool: CoachTool, args: dict[str, Any]) -> str | None:
    schema = tool.parameters or {}
    properties = schema.get("properties") or {}
    for name in schema.get("required") or []:
        if args.get(name) in (None, ""):
            return f"missing_required_argument:{name}"
    if any(name not in properties for name in args):
        return "unknown_argument"
    for name, value in args.items():
        spec = properties[name]
        if "enum" in spec and value not in spec["enum"]:
            return f"invalid_argument_value:{name}"
        expected = spec.get("type")
        if expected == "string" and not isinstance(value, str):
            return f"invalid_argument_type:{name}"
        if expected == "integer" and (not isinstance(value, int) or isinstance(value, bool)):
            return f"invalid_argument_type:{name}"
    return None


async def dispatch(
    name: str, args: dict[str, Any], context: CoachToolContext
) -> dict[str, Any]:
    """Execute one mode-authorized tool without raising into the chat stream."""
    exhausted = context.budget_exhausted()
    if exhausted:
        return {"error": exhausted}
    tool = _REGISTRY.get(name)
    if tool is None:
        return {"error": "unknown_tool"}
    if context.mode not in tool.allowed_modes:
        return {"error": "tool_not_allowed_for_mode"}
    arguments = dict(args or {})
    invalid = _validate_arguments(tool, arguments)
    if invalid:
        return {"error": invalid}

    context.calls_made += 1
    try:
        result = await tool.handler(context, arguments)
    except ToolError:
        return {"error": "tool_unavailable"}
    except Exception as exc:  # pragma: no cover - defensive stream boundary
        print(f"Coach tool {name} failed: {type(exc).__name__}")
        return {"error": "tool_failed"}
    return result if isinstance(result, dict) else {"data": result}


def reset_for_tests() -> None:
    _REGISTRY.clear()