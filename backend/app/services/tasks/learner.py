"""Learner-safe projection of assigned teacher tasks.

The activation is the authorization boundary: callers provide the learner id
from an authenticated session, and only that learner's frozen papers are read.
"""

from __future__ import annotations

from typing import Any

from app.services.tasks import store


def _answered(value: Any) -> bool:
    """The player's own definition of "answered", mirrored: an empty string or
    an empty list is a question still waiting, not one done."""
    if value is None or value == "":
        return False
    if isinstance(value, list) and not value:
        return False
    return True


async def _progress(task_id: str, components: list[str],
                    answers: dict[str, Any]) -> dict[str, Any]:
    """How far along each part is: `{"practice": {"answered": 3, "total": 8}}`.

    The presentation carries no per-question state, so it is simply absent —
    the card renders it as a part with no counter. Counts only scored
    questions, so study cards do not make a finished part look unfinished.
    """
    progress: dict[str, Any] = {}
    for component in components:
        if component == "presentation":
            continue
        row = await store.get_content(task_id, component)
        questions = [
            question for question in
            (((row or {}).get("content") or {}).get("questions") or [])
            if question.get("scored") is not False
        ]
        if not questions:
            continue
        progress[component] = {
            "answered": sum(1 for question in questions
                            if _answered(answers.get(str(question.get("id"))))),
            "total": len(questions),
        }
    return progress


async def list_for_learner(learner_id: str) -> list[dict[str, Any]]:
    """Return one learner-safe row per task opening, newest first."""
    rows = {
        str(row.get("_id")): row
        for row in await store.list_attempts_for_learner(learner_id)
    }

    tasks: list[dict[str, Any]] = []
    seen_task: dict[str, int] = {}
    for activation in reversed(await store.list_activations_for_learner(learner_id)):
        launch_id = str(activation.get("launch_id") or "")
        task_id = str(activation.get("task_id"))
        task = await store.get_task(task_id)
        if task is None or task.get("status") == "draft":
            continue
        launch = await store.get_launch(launch_id) if launch_id else None
        attempt = rows.get(store.activation_id(launch_id, learner_id)) or {}
        seen_task[task_id] = seen_task.get(task_id, 0) + 1
        tasks.append({
            "task_id": task_id,
            "launch_id": launch_id,
            "repeat": seen_task[task_id],
            "title": (task.get("spec") or {}).get("title"),
            "subject": (task.get("spec") or {}).get("subject"),
            "components": (task.get("spec") or {}).get("components") or [],
            "assigned_at": activation.get("assigned_at"),
            "due_at": activation.get("due_at"),
            "status": attempt.get("status") or "not_started",
            "completed_at": attempt.get("completed_at"),
            "closed": bool(launch and launch.get("status") != "active"),
            "feedback": attempt.get("feedback"),
            "progress": await _progress(
                task_id, (task.get("spec") or {}).get("components") or [],
                attempt.get("answers") or {}),
        })
    tasks.reverse()
    return tasks