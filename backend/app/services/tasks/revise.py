"""Changing generated content before it goes out — by hand, or by asking again.

The status ladder already had the gate: `ready` means "the content exists and
no child has it", and `activate()` freezes a per-learner snapshot, so a task can
be rewritten any number of times before launch and never afterwards changes the
paper under a child mid-attempt. What was missing was anything to *do* in that
state except send it.

Three ways to change a component, in increasing order of how much is thrown
away:

    edit        the teacher rewrote it themselves
    ai_edit     regenerate, given the current content and an instruction
    regenerate  regenerate from the spec, ignoring what is there

## Everything goes back through the vocabulary

The reference implementation this borrows the mechanic from stores whatever the
client PUTs, unvalidated. That is the exact drift `spec.py` was written to
prevent: a hand-edited `correct_index` beside a generated `answer.index` scores
as wrong at grading time and looks entirely correct in the JSON. So a teacher's
edit is normalized by the same functions the model's output is, and content
that cannot be repaired into the vocabulary is refused rather than stored.

## Instructions are not the spec

"Make question 3 easier" describes one regeneration, not the task the teacher
asked for. It is threaded into the prompt for that pass and never written back
to the stored spec — otherwise every later regeneration inherits every earlier
correction, and the spec stops describing the task.
"""

from __future__ import annotations

from typing import Any, Optional

from app.services.tasks import generate, spec as spec_module, store

#: Editing is allowed while nobody has the task. `live`/`closed` are refused
#: here rather than merged, because a half-changed paper is worse than either.
EDITABLE = ("draft", "generating", "ready")

MAX_INSTRUCTIONS = 600


class ReviseError(Exception):
    """A refusal the caller may see. The message is a stable code."""


def _normalized(component: str, content: Any) -> dict[str, Any]:
    """Force any content — model's or teacher's — into the one vocabulary."""
    if not isinstance(content, dict):
        raise ReviseError("bad_content")
    if component == "presentation":
        slides = spec_module.normalize_slides(content)
        if not slides:
            raise ReviseError("bad_content")
        return {**content, "slides": slides}
    if component == "interactive":
        blocks = spec_module.normalize_blocks(content)
        if not blocks:
            raise ReviseError("bad_content")
        return {**content, "blocks": blocks}
    questions = spec_module.normalize_questions(content)
    if not questions:
        raise ReviseError("bad_content")
    return {**content, "questions": questions}


async def _editable(task_id: str) -> dict[str, Any]:
    task = await store.get_task(task_id)
    if task is None:
        raise ReviseError("not_found")
    if task.get("status") not in EDITABLE:
        # Not a permission problem: the teacher owns the task. It is that the
        # children already have their copies.
        raise ReviseError("already_sent")
    return task


async def save_edit(task_id: str, component: str, content: Any) -> dict[str, Any]:
    """Store a teacher's own rewrite of one component."""
    if component not in store.COMPONENTS:
        raise ReviseError("bad_component")
    await _editable(task_id)
    normalized = _normalized(component, content)
    await store.put_content(task_id, component, normalized, source="teacher")
    return normalized


def _revision_spec(
    task_spec: dict[str, Any],
    instructions: Optional[str],
) -> dict[str, Any]:
    """The spec for ONE pass, with the instruction appended to the notes.

    A copy: the stored spec is what the teacher asked for and stays that way.
    """
    text = " ".join(str(instructions or "").split())[:MAX_INSTRUCTIONS]
    if not text:
        return task_spec
    notes = str(task_spec.get("notes") or "").strip()
    joined = f"{notes}\n\n{text}" if notes else text
    return {**task_spec, "notes": joined.strip()}


async def regenerate(
    task_id: str,
    component: str,
    *,
    instructions: Optional[str] = None,
    keep_existing: bool = False,
    slide_index: Optional[int] = None,
    question_index: Optional[int] = None,
) -> dict[str, Any]:
    """Generate this component again.

    `keep_existing` is the difference between "try again" and "change this":
    with it, the current content and the item being pointed at are put in front
    of the model, and it is asked to return the whole component with that one
    thing changed. Without it, the pass is exactly the original generation.

    Returns the new content. The old content is replaced, not versioned — the
    thing that must never be lost is a LAUNCHED paper, and that is a frozen
    activation, not this row.
    """
    if component not in store.COMPONENTS:
        raise ReviseError("bad_component")
    task = await _editable(task_id)
    task_spec = task.get("spec") or {}
    if component not in (task_spec.get("components") or []):
        raise ReviseError("bad_component")

    pass_spec = _revision_spec(task_spec, instructions)
    existing = None
    if keep_existing:
        row = await store.get_content(task_id, component)
        existing = (row or {}).get("content")
        if not existing:
            # Nothing to edit — fall back to a plain regeneration rather than
            # sending the model an empty "here is the current content" block.
            keep_existing = False

    outline: list[str] = []
    if component != "presentation":
        deck = await store.get_content(task_id, "presentation")
        if deck:
            outline = generate.outline_of((deck or {}).get("content") or {})

    content = await generate.generate_component(
        task_id, component, pass_spec, outline=outline,
        existing=existing if keep_existing else None,
        focus={"slide_index": slide_index, "question_index": question_index}
        if keep_existing else None,
    )
    # The failure chip reads the LATEST generation entry per component, so a
    # successful redo must be logged or a component that failed once and was
    # then regenerated keeps reporting itself as missing.
    await store.record_generation(task_id, component=component, ok=True)
    return content
