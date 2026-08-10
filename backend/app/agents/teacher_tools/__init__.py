"""The teacher assistant's tool registry (A3).

Import this package to get a populated registry. Registration is idempotent so
repeated imports (and test resets) stay safe.
"""

from __future__ import annotations

from app.agents.teacher_tools import registry
from app.agents.teacher_tools.registry import (
    MAX_ROUNDS,
    MAX_SECONDS,
    MAX_TOOL_CALLS,
    TeacherTool,
    TeacherToolContext,
    ToolError,
    dispatch,
    manifest,
    schemas,
)


def install() -> None:
    """Register every tool. Safe to call repeatedly."""
    if registry.all_tools():
        return
    from app.agents.teacher_tools import data_tools, help_tools

    data_tools.register_all()
    help_tools.register_all()


install()

__all__ = [
    "MAX_ROUNDS", "MAX_SECONDS", "MAX_TOOL_CALLS",
    "TeacherTool", "TeacherToolContext", "ToolError",
    "dispatch", "install", "manifest", "registry", "schemas",
]
