"""The learner's side of a teacher-authored task: list it, open it, submit it.

Every handler is scoped by the session's own learner id and never by an id in
the request. A task is only reachable through an **activation**, which exists
for exactly one learner in exactly one opening — so "can this child open this"
is the same question as "does this activation exist", and there is no second
permission model to keep in step.

## The path id is an opening, not a task

`/api/tasks/{launch_id}`. A teacher may open the same task to the same child
twice — a retake — and those are two blank papers with two sets of answers and
two marks. A task id could not say which one was meant, and defaulting to
"the newest" would silently move a child off the paper they were writing.

What comes back is deliberately not what the teacher sees. The answer key, the
rubric and the score are all one field away from the prompt in the same
document, and `attempts` is the projection that keeps them out of the browser.
"""

from typing import Any, Optional

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from app.auth.dependencies import require_learner_session
from app.services.tasks import attempts, store
from app.services.tasks.attempts import AttemptError

router = APIRouter(prefix="/api/tasks", tags=["tasks"])

_NO_STORE = {"Cache-Control": "private, no-store"}

#: `not_assigned` is a 404, not a 403: a learner should not be able to learn
#: that a task exists by being refused it.
_NOT_FOUND = {"not_assigned", "no_attempt"}


def _ok(content: Any) -> JSONResponse:
    return JSONResponse(content=content, headers=_NO_STORE)


def _failed(error: AttemptError) -> JSONResponse:
    code = str(error)
    status = 404 if code in _NOT_FOUND else 409
    return JSONResponse(content={"error": "not_found" if status == 404 else code},
                        status_code=status, headers=_NO_STORE)


class SaveRequest(BaseModel):
    answers: dict[str, Any] = Field(default_factory=dict)
    time_spent: int = 0


class SubmitRequest(BaseModel):
    answers: dict[str, Any] = Field(default_factory=dict)
    time_spent: int = 0
    language: Optional[str] = None


@router.get("")
async def my_tasks(session=Depends(require_learner_session)):
    """Everything assigned to this learner, newest first, with where they are.

    One row per **opening**. A child who has been given the same task twice
    sees it twice, because they are two papers — and `repeat` says which sitting
    this is, so a list with two identical titles is not a mystery.
    """
    learner_id = session["sub"]
    rows = {str(row.get("_id")): row
            for row in await store.list_attempts_for_learner(learner_id)}

    tasks = []
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
            # 1 for the first sitting, 2 for a retake — the client shows the
            # chip only when it is greater than 1.
            "repeat": seen_task[task_id],
            "title": (task.get("spec") or {}).get("title"),
            "subject": (task.get("spec") or {}).get("subject"),
            "components": (task.get("spec") or {}).get("components") or [],
            "assigned_at": activation.get("assigned_at"),
            "due_at": activation.get("due_at"),
            "status": attempt.get("status") or "not_started",
            "completed_at": attempt.get("completed_at"),
            "closed": bool(launch and launch.get("status") != "active"),
            # Words, never a mark — the score is the teacher's view.
            "feedback": attempt.get("feedback"),
        })
    tasks.reverse()
    return _ok({"tasks": tasks})


@router.get("/{launch_id}")
async def open_task(launch_id: str, session=Depends(require_learner_session)):
    """The paper this learner was given, with the keys stripped."""
    try:
        return _ok(await attempts.open_task(launch_id, session["sub"]))
    except AttemptError as error:
        return _failed(error)


@router.post("/{launch_id}/answers")
async def save_answers(launch_id: str, payload: SaveRequest,
                       session=Depends(require_learner_session)):
    """Progress, so closing the tab does not lose twenty minutes of work."""
    try:
        return _ok(await attempts.save_answers(
            launch_id, session["sub"], payload.answers, time_spent=payload.time_spent))
    except AttemptError as error:
        return _failed(error)


@router.post("/{launch_id}/submit")
async def submit(launch_id: str, payload: SubmitRequest,
                 session=Depends(require_learner_session)):
    """Grade it, record the activity, and answer with words and sparks."""
    language = payload.language or session.get("locale") or "he"
    try:
        return _ok(await attempts.submit(
            launch_id, session["sub"], answers=payload.answers,
            time_spent=payload.time_spent, language=language))
    except AttemptError as error:
        return _failed(error)


@router.get("/{launch_id}/result")
async def result(launch_id: str, session=Depends(require_learner_session)):
    """A finished task, re-opened: their words back, not a mark."""
    try:
        return _ok(await attempts.learner_view(launch_id, session["sub"]))
    except AttemptError as error:
        return _failed(error)
