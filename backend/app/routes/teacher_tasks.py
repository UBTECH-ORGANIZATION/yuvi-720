"""Teacher-authored task routes — author, generate, send, track.

Thin by design, like the sub-group routes: authorization is the task's own
`teacher_id` plus the org scope its target resolves through, and every handler
delegates to `app.services.tasks`.

Two refusals are deliberately indistinguishable from each other: a task that
belongs to another teacher and a task that does not exist. Which one it was is
not information this teacher is entitled to.

Nothing here grades anything. Grading happens when a child submits, so that the
score a teacher opens is already the score the child was given feedback on —
a second, later grading pass could disagree with what the learner was told.
"""

from typing import Any, Optional

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from app.auth.dependencies import require_teacher_session
from app.brain import org
from app.core.localization import normalize_language
from app.services.tasks import assign, generate, spec, store, summary, tracking
from app.services.tasks.assign import AssignError
from app.services.tasks.store import TaskStoreError

router = APIRouter(prefix="/api/teacher", tags=["teacher"])

_NO_STORE = {"Cache-Control": "private, no-store"}

#: Refusals that are the caller's mistake rather than a permission problem.
_BAD_REQUEST = {"bad_target", "not_ready", "no_learners", "bad_component",
                "bad_status", "no_content"}


def _ok(content: Any) -> JSONResponse:
    return JSONResponse(content=content, headers=_NO_STORE)


def _failed(error: Exception) -> JSONResponse:
    code = str(error)
    status = 400 if code in _BAD_REQUEST else 403
    return JSONResponse(
        content={"error": code if status == 400 else "forbidden"},
        status_code=status, headers=_NO_STORE,
    )


async def _owned(teacher_id: str, task_id: str) -> dict[str, Any]:
    task = await store.get_task(task_id)
    if task is None or task.get("teacher_id") != teacher_id:
        raise AssignError("not_authorized")
    return task


def _scoped_launch(task_id: str, launch_id: Optional[str]) -> Optional[str]:
    """A launch id is only usable on the task it belongs to.

    Ownership is checked on the *task*; without this a teacher could hand a
    route their own task's id and someone else's launch id, and read a class
    they have no claim to. The launch id composes from the task id, so the
    check is a prefix comparison rather than a second lookup — and an id that
    does not belong is dropped to "newest opening" rather than refused, because
    it is a URL a teacher can reach by editing the address bar.
    """
    if not launch_id:
        return None
    return launch_id if store.task_of_launch(launch_id) == task_id else None


class CreateTaskRequest(BaseModel):
    """A task, and optionally a default audience.

    `target_*` are optional because who receives a task is decided when it is
    opened, not when it is written — the same material goes to different
    children in different weeks. They are kept for the chat builder, which does
    name an audience up front.
    """
    group_id: str
    target_kind: Optional[str] = Field(default=None, pattern="^(learner|subgroup|group)$")
    target_id: Optional[str] = None
    spec: dict[str, Any]
    deadline: Optional[str] = None


class LaunchRequest(BaseModel):
    """Who this opening goes to, and by when.

    `targets` is a list because one opening may name three sub-groups and two
    individual children. Empty falls back to the task's own default target,
    which is what keeps the chat-built path working.
    """
    targets: list[dict[str, Any]] = Field(default_factory=list)
    due_at: Optional[str] = None


class LaunchActionRequest(BaseModel):
    """Close or reopen. No `launch_id` closes every opening of the task."""
    launch_id: Optional[str] = None


class SuggestNotesRequest(BaseModel):
    """The half-filled builder form. Everything optional — the point of the
    endpoint is to say what is still missing."""
    title: Optional[str] = None
    topic: Optional[str] = None
    difficulty: Optional[str] = None
    components: list[str] = Field(default_factory=list)
    notes: Optional[str] = None
    source: Optional[dict[str, Any]] = None
    learner_count: Optional[int] = None
    language: str = "he"


class EditContentRequest(BaseModel):
    """A teacher's own edit of generated content. Re-normalized server-side."""
    content: dict[str, Any]


class RegenerateRequest(BaseModel):
    """Regenerate a component, optionally with extra direction.

    `instructions` is *added to the spec's notes for this pass only* — it is
    never written back into the stored spec, because "make the third question
    easier" is an instruction about one generation and not a description of the
    task a teacher asked for.
    """
    instructions: Optional[str] = None
    #: Narrow the edit to one slide / question, when the teacher is fixing one
    #: thing rather than asking for a different deck.
    slide_index: Optional[int] = None
    question_index: Optional[int] = None


class ArchiveRequest(BaseModel):
    """One flag both ways: `true` files the task away, `false` restores it."""
    archived: bool


@router.get("/catalog/learnings")
async def catalog_learnings(language: str = "he",
                            session=Depends(require_teacher_session)):
    """Every learning in the catalogue, for the task builder's lesson picker.

    Deliberately not `/groups/{id}/learnings`: that one folds a whole class's
    activity over the spine, which is several stores of work to answer a
    question the builder is not asking. Here the catalogue IS the answer.
    """
    from app.services import kata_catalog

    locale = normalize_language(language)
    await kata_catalog.ensure_loaded()

    rows = []
    for component in kata_catalog.all_components():
        component_id = component.get("id")
        if not component_id:
            continue
        questions = component.get("questions_by_item") or {}
        unit_id = component.get("unit_id")
        rows.append({
            "component_id": component_id,
            "title": kata_catalog.component_title(component_id, locale),
            "unit_id": unit_id,
            "unit_title": kata_catalog.unit_title(unit_id, locale),
            "objective_id": component.get("objective_id"),
            "objective_title": kata_catalog.objective_title(
                component.get("objective_id"), locale),
            "subject": component.get("subject"),
            "order": component.get("order"),
            "estimated_minutes": component.get("estimated_minutes"),
            "is_assessment": bool(component.get("is_assessment")),
            "screens_total": len(kata_catalog.item_profiles(component_id)),
            "questions_total": sum(len(items or []) for items in questions.values()),
        })
    rows.sort(key=lambda row: (row["subject"] or "", row["unit_title"] or "",
                               row["order"] if row["order"] is not None else 999))
    return _ok({"learnings": rows})


@router.post("/tasks/suggest-notes")
async def suggest_notes(payload: SuggestNotesRequest,
                        session=Depends(require_teacher_session)):
    """Draft the "notes to Yuvi" field from the rest of the form.

    Returns `{"notes": null, "missing": [...]}` rather than an error when the
    form is too empty to work from — the client renders that list as the reason
    its button is disabled, and it has to change as the teacher types.
    """
    from app.services.tasks import assist

    result = await assist.suggest_notes(
        payload.model_dump(),
        language=normalize_language(payload.language),
        teacher_id=session["sub"],
    )
    return _ok(result)


@router.get("/tasks")
async def list_tasks(group_id: Optional[str] = None,
                     session=Depends(require_teacher_session)):
    """This teacher's tasks, newest first, each with how far it has got."""
    tasks = await store.list_tasks(teacher_id=session["sub"], group_id=group_id)
    return _ok({"tasks": [await tracking.task_summary(task) for task in tasks]})


@router.post("/tasks")
async def create_task(payload: CreateTaskRequest,
                      session=Depends(require_teacher_session)):
    """Record what the teacher asked for. Generation is a separate call.

    The spec is normalized here rather than at generation time so a malformed
    one fails while the teacher is still looking at the builder, not several
    seconds into a job they are watching a spinner for.
    """
    try:
        normalized = spec.normalize_spec(payload.spec)
    except spec.SpecError as error:
        return JSONResponse(content={"error": str(error)}, status_code=400,
                            headers=_NO_STORE)
    # Who receives it is decided at launch, so a task may be written with no
    # target at all. When one IS given it is still validated here.
    target = ({"kind": payload.target_kind, "id": payload.target_id}
              if payload.target_kind and payload.target_id else None)
    try:
        task = await store.create_task(
            teacher_id=session["sub"], group_id=payload.group_id,
            target=target, spec=normalized, deadline=payload.deadline,
        )
    except TaskStoreError as error:
        return _failed(error)

    # Refused before anything is generated: a target nobody can receive is not
    # a target, and finding that out after a paid generation pass is the wrong
    # order. The teacher's own class is checked either way, because a task must
    # at least belong somewhere it can later be sent from.
    try:
        if target:
            await assign.resolve_target(session["sub"], task)
        elif not await org.teacher_can_access_group(session["sub"], payload.group_id):
            raise AssignError("not_authorized")
    except AssignError as error:
        return _failed(error)
    return _ok({"task": task})


@router.post("/tasks/{task_id}/generate")
async def start_generation(task_id: str, session=Depends(require_teacher_session)):
    """Start (or join) generation. The client polls `GET /tasks/{id}`."""
    try:
        await _owned(session["sub"], task_id)
    except AssignError as error:
        return _failed(error)
    return _ok(await generate.get_or_start(task_id))


@router.get("/tasks/{task_id}")
async def get_task(task_id: str, session=Depends(require_teacher_session)):
    """The task, its generated content, and its generation log.

    The teacher sees the answer keys — it is their material. Only the learner
    projection strips them (`attempts._without_answers`).
    """
    try:
        task = await _owned(session["sub"], task_id)
    except AssignError as error:
        return _failed(error)
    # A run in flight outranks whatever status the document carries: the
    # review screen's first read can beat the run's own "generating" write.
    status = "generating" if generate.is_running(task_id) else task.get("status")
    return _ok({"task": task, "content": await store.all_content(task_id),
                "status": status})


@router.post("/tasks/{task_id}/quality")
async def recheck_quality(task_id: str, session=Depends(require_teacher_session)):
    """Measure the task against the brief and the lesson again.

    Runs automatically once at the end of generation. This is the manual repeat,
    for after a regeneration or an AI edit — those change the content and leave
    the report describing what used to be there. Not re-run automatically on
    every edit: it is a strong-tier call, and a teacher fixing the wording of one
    question does not need the whole task re-judged for each keystroke.
    """
    from app.services.tasks import quality

    try:
        await _owned(session["sub"], task_id)
    except AssignError as error:
        return _failed(error)
    return _ok({"quality": await quality.review(task_id)})


@router.put("/tasks/{task_id}/content/{component}")
async def edit_task_content(task_id: str, component: str, payload: EditContentRequest,
                            session=Depends(require_teacher_session)):
    """The teacher's own rewrite of one component.

    Re-normalized through the same functions the generator's output goes
    through. The reference implementation stores whatever the client sends,
    which is how a hand-edited answer key ends up in a shape the grader does
    not read — scoring every child wrong, and looking correct in the JSON.
    """
    from app.services.tasks import revise

    try:
        await _owned(session["sub"], task_id)
        content = await revise.save_edit(task_id, component, payload.content)
    except AssignError as error:
        return _failed(error)
    except revise.ReviseError as error:
        return JSONResponse(content={"error": str(error)}, status_code=400,
                            headers=_NO_STORE)
    return _ok({"content": content})


@router.post("/tasks/{task_id}/content/{component}/regenerate")
async def regenerate_task_content(task_id: str, component: str,
                                  payload: RegenerateRequest,
                                  session=Depends(require_teacher_session)):
    """Generate this component again from the spec, discarding what is there."""
    from app.services.tasks import revise

    try:
        await _owned(session["sub"], task_id)
        content = await revise.regenerate(
            task_id, component, instructions=payload.instructions,
        )
    except AssignError as error:
        return _failed(error)
    except (revise.ReviseError, spec.SpecError) as error:
        return JSONResponse(content={"error": str(error)}, status_code=400,
                            headers=_NO_STORE)
    return _ok({"content": content})


@router.post("/tasks/{task_id}/content/{component}/ai-edit")
async def ai_edit_task_content(task_id: str, component: str,
                               payload: RegenerateRequest,
                               session=Depends(require_teacher_session)):
    """Change one thing, keeping the rest.

    Awaited rather than polled: this is one component and the teacher is
    looking at the thing they asked to change. A whole-task generation is
    several passes and is still the polled path.
    """
    from app.services.tasks import revise

    try:
        await _owned(session["sub"], task_id)
        content = await revise.regenerate(
            task_id, component, instructions=payload.instructions,
            keep_existing=True, slide_index=payload.slide_index,
            question_index=payload.question_index,
        )
    except AssignError as error:
        return _failed(error)
    except (revise.ReviseError, spec.SpecError) as error:
        return JSONResponse(content={"error": str(error)}, status_code=400,
                            headers=_NO_STORE)
    return _ok({"content": content})


@router.post("/tasks/{task_id}/launch")
async def launch_task(task_id: str, payload: LaunchRequest,
                      session=Depends(require_teacher_session)):
    """Open it to these targets. Each call is a new opening — see `assign.launch`."""
    try:
        return _ok(await assign.launch(
            session["sub"], task_id, targets=payload.targets, due_at=payload.due_at))
    except (AssignError, TaskStoreError) as error:
        return _failed(error)


@router.get("/tasks/{task_id}/launches")
async def task_launches(task_id: str, session=Depends(require_teacher_session)):
    """Every opening of this task, with its headline numbers."""
    try:
        await _owned(session["sub"], task_id)
    except AssignError as error:
        return _failed(error)
    return _ok({"launches": await tracking.launch_rows(task_id)})


@router.post("/tasks/{task_id}/close")
async def close_task(task_id: str, payload: Optional[LaunchActionRequest] = None,
                     session=Depends(require_teacher_session)):
    """Stop accepting work — on one opening, or on all of them."""
    try:
        return _ok(await assign.close(
            session["sub"], task_id, launch_id=(payload.launch_id if payload else None)))
    except AssignError as error:
        return _failed(error)


@router.post("/tasks/{task_id}/archive")
async def archive_task(task_id: str, payload: ArchiveRequest,
                       session=Depends(require_teacher_session)):
    """Put a task away (or bring it back) without touching its history.

    A flag, not a delete: an archived task keeps its openings and the
    children's work, it just stops taking up a row a teacher reads past
    every day. The list endpoint still returns it — hiding is the client's
    choice, so the archive view costs no second query.
    """
    try:
        await _owned(session["sub"], task_id)
    except AssignError as error:
        return _failed(error)
    await store.update_task(task_id, archived=bool(payload.archived))
    return _ok({"archived": bool(payload.archived)})


@router.delete("/tasks/{task_id}")
async def delete_task(task_id: str, session=Depends(require_teacher_session)):
    """Delete a task and every trace of it. Irreversible, and it takes history.

    A DELETE rather than a soft archive flag, because that is what was asked
    for and what "delete all the history" means: the openings, the children's
    activations and their submitted attempts go with it. Nothing here is a
    child's own record — an attempt at a teacher's task belongs to the task —
    but it IS work a child did, so the confirmation on the client states the
    counts before this is called, and this route is the point of no return.

    Ownership is checked the same way every other write on this router checks
    it: the task must belong to the teacher asking. A teacher who has been
    handed someone else's task id gets `not_authorized`, not a 404 that
    confirms it exists.
    """
    try:
        await _owned(session["sub"], task_id)
    except AssignError as error:
        return _failed(error)
    removed = await store.delete_task(task_id)
    return _ok({"deleted": True, "removed": removed})


@router.get("/tasks/{task_id}/impact")
async def task_impact(task_id: str, session=Depends(require_teacher_session)):
    """What deleting this task would take with it.

    Read before the confirmation is shown, so the dialog can name real numbers
    instead of a generic warning. A teacher deleting a draft nobody ever saw
    and a teacher deleting a test forty children sat are making very different
    decisions, and only one of them should give pause.
    """
    try:
        await _owned(session["sub"], task_id)
    except AssignError as error:
        return _failed(error)
    launches = await store.list_launches(task_id)
    attempts = await store.list_attempts_for_task(task_id)
    return _ok({
        "launches": len(launches),
        "attempts": len(attempts),
        "learners": len({str(row.get("learner_id")) for row in attempts if row.get("learner_id")}),
    })


@router.post("/tasks/{task_id}/reopen")
async def reopen_task(task_id: str, payload: LaunchActionRequest,
                      session=Depends(require_teacher_session)):
    """Take an opening off the shelf so it accepts work again."""
    if not payload.launch_id:
        return JSONResponse(content={"error": "bad_request"}, status_code=400,
                            headers=_NO_STORE)
    try:
        return _ok(await assign.reopen(session["sub"], task_id, payload.launch_id))
    except AssignError as error:
        return _failed(error)


@router.get("/tasks/{task_id}/tracking")
async def task_tracking(task_id: str, launch_id: Optional[str] = None,
                        session=Depends(require_teacher_session)):
    """Who did what in one opening, with the exact feedback each child saw."""
    try:
        task = await _owned(session["sub"], task_id)
    except AssignError as error:
        return _failed(error)
    return _ok(await tracking.for_task(task, _scoped_launch(task_id, launch_id)))


@router.get("/tasks/{task_id}/summary")
async def task_summary_prose(task_id: str, subgroup_id: Optional[str] = None,
                             launch_id: Optional[str] = None,
                             language: str = "he",
                             session=Depends(require_teacher_session)):
    """A grounded paragraph over the results, plus action items.

    `subgroup_id` narrows it to that slice — the same numbers, fewer children —
    and resolves through the sub-group's own gate rather than trusting the id.
    """
    try:
        task = await _owned(session["sub"], task_id)
    except AssignError as error:
        return _failed(error)

    scoped = _scoped_launch(task_id, launch_id)
    if subgroup_id:
        from app.services import subgroups as subgroup_service
        try:
            members = await subgroup_service.members_of(session["sub"], subgroup_id)
        except subgroup_service.SubgroupError:
            return JSONResponse(content={"error": "forbidden"}, status_code=403,
                                headers=_NO_STORE)
        data = await tracking.for_group(task, members, scoped)
    else:
        data = await tracking.for_task(task, scoped)

    return _ok(await summary.summarize(data, language=language))


@router.get("/tasks/{task_id}/students/{learner_id}")
async def student_attempt(task_id: str, learner_id: str,
                          launch_id: Optional[str] = None,
                          session=Depends(require_teacher_session)):
    """One child's paper: their answers, their marks, and what they were told."""
    try:
        task = await _owned(session["sub"], task_id)
    except AssignError as error:
        return _failed(error)
    detail = await tracking.for_learner(
        task, learner_id, _scoped_launch(task_id, launch_id))
    if detail is None:
        return JSONResponse(content={"error": "not_found"}, status_code=404,
                            headers=_NO_STORE)
    return _ok(detail)
