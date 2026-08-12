"""One child's run at a task: open it, save answers, submit, be told how it went.

Everything here reads the **activation snapshot**, never the live content. A
teacher who edits a task after sending it does not change the paper under a
child who is halfway through — and a class where half answered version 1 and
half answered version 2 is a class whose per-question breakdown means nothing.

Two things this module owns that are easy to get wrong:

**The child is never shown a number.** Feedback on completion is verbal plus
sparks. The score is computed and stored because the *teacher* needs it, and
:func:`learner_view` is the projection that keeps it away from the learner —
along with every answer key, which is in the same document.

**Completion is recorded as activity.** The task store is deliberately separate
from `learning_events`, so without this the roster would report a child as
"10 ימים ללא פעילות" while they finished three of your tasks this week.
"""

from __future__ import annotations

from typing import Any, Optional

from app.services.tasks import store

#: How much each component contributes to the composite grade. Renormalized
#: over whichever components a task actually has, so a practice-only task is
#: scored out of practice rather than out of a third of itself.
COMPONENT_WEIGHTS = {"practice": 0.3, "test": 0.5, "interactive": 0.2}

#: Sparks per finished task, scaled by how much was answered rather than by how
#: much was right — effort is what this rewards, and a child who did the work
#: and found it hard must not be paid less than one who found it easy.
SPARKS_FOR_COMPLETION = 10

_PRAISE = {
    "he": {
        "strong": "סיימת את כל המשימה, ורוב התשובות היו מדויקות. עבודה יפה.",
        "mixed": "סיימת את המשימה. חלק מהתשובות היו מדויקות וחלק פחות — זה בדיוק מה שעוזר ללמוד.",
        "effort": "סיימת את המשימה עד הסוף. זה החלק הקשה, וזה מה שמזיז קדימה.",
        "partial": "נשארו שאלות בלי תשובה. אפשר לחזור אליהן מתי שנוח.",
    },
    "ar": {
        "strong": "أنهيت المهمة كلها، ومعظم إجاباتك كانت دقيقة. عمل جميل.",
        "mixed": "أنهيت المهمة. بعض الإجابات كانت دقيقة وبعضها أقل — وهذا بالضبط ما يساعد على التعلّم.",
        "effort": "أنهيت المهمة حتى النهاية. هذا هو الجزء الصعب، وهو ما يدفعك للأمام.",
        "partial": "بقيت أسئلة بلا إجابة. يمكنك العودة إليها متى شئت.",
    },
    "en": {
        "strong": "You finished the whole task, and most of your answers were spot on. Lovely work.",
        "mixed": "You finished the task. Some answers landed and some didn't — that's exactly what learning looks like.",
        "effort": "You saw the task all the way through. That's the hard part, and it's the part that moves you forward.",
        "partial": "Some questions are still unanswered. You can come back to them whenever suits.",
    },
}


class AttemptError(Exception):
    """A refusal the client may see. The message is a stable code."""


def _language(locale: Optional[str]) -> str:
    return locale if locale in _PRAISE else "he"


def scored_questions(snapshot: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    """Every answerable question in the snapshot, grouped by component.

    Interactive blocks appear here too, because a scored block IS a question in
    the one vocabulary — `sort_items` is an `ordering` question in a drag-and-
    drop widget. That is what lets it score through the same path, which is
    exactly what the reference implementation's generated games could not do.
    """
    grouped: dict[str, list[dict[str, Any]]] = {}
    for component in ("practice", "test"):
        questions = (snapshot.get(component) or {}).get("questions") or []
        if questions:
            grouped[component] = questions
    blocks = [block for block in ((snapshot.get("interactive") or {}).get("blocks") or [])
              if block.get("scored")]
    if blocks:
        grouped["interactive"] = blocks
    return grouped


async def _open_launch(launch: str) -> dict[str, Any]:
    """The opening, refused if it is shut.

    Reading a closed opening is fine — a child may look back at what they did.
    Writing to one is not, and that is checked here rather than at each write,
    so a new write path cannot forget to ask.
    """
    row = await store.get_launch(launch)
    if row is None:
        raise AttemptError("not_assigned")
    if row.get("status") != "active":
        raise AttemptError("closed")
    return row


async def open_task(launch: str, learner_id: str) -> dict[str, Any]:
    """What the player renders, plus the attempt so far. Answer keys stripped."""
    activation = await store.get_activation(launch, learner_id)
    if activation is None:
        raise AttemptError("not_assigned")

    task_id = store.task_of_launch(launch)
    attempt = await store.start_attempt(launch, learner_id)
    task = await store.get_task(task_id)
    spec = (task or {}).get("spec") or {}
    return {
        "task_id": task_id,
        "launch_id": launch,
        "title": spec.get("title"),
        "language": spec.get("language", "he"),
        # How the deck is DRAWN. Without these the child's slides fell back to
        # the default violet while the teacher's preview showed the subject's
        # ground — and "the preview is what the child sees" is the whole reason
        # the slide is a fixed stage.
        "subject": spec.get("subject") or "",
        "theme": ((spec.get("presentation") or {}).get("theme") or "auto"),
        "due_at": activation.get("due_at"),
        "content": _without_answers(activation.get("content_snapshot") or {}),
        "answers": attempt.get("answers") or {},
        "status": attempt.get("status"),
    }


def blank_shape(question: dict[str, Any]) -> Optional[list[dict[str, Any]]]:
    """How many boxes a fill-in question needs, and what each one is called.

    The shape of the answer is not the answer. A child must be shown two boxes
    for the coordinates of a point, labelled `x` and `y` — and the *number* of
    boxes lives only in the answer key, which is the one thing they may not
    have. So the count and the labels are lifted out and the accepted values
    are left behind.

    This was a real bug rather than a missing nicety: the player sized the
    field list from the child's own saved answers, so before they typed
    anything there was exactly one box no matter how many blanks the question
    had — and the second value could never be entered at all.
    """
    if question.get("type") != "fill_blank":
        return None
    blanks = (question.get("answer") or {}).get("blanks")
    if not isinstance(blanks, list) or not blanks:
        return None
    return [{"label": blank.get("label")} if isinstance(blank, dict) else {"label": None}
            for blank in blanks]


def _without_answers(snapshot: dict[str, Any]) -> dict[str, Any]:
    """The snapshot as a child may see it.

    The answer key and the rubric live on the question, one field away from the
    prompt. Anything that reaches the browser must have them removed here —
    there is no second chance further down, because the player receives the
    whole content document in one response.

    Slide `notes` are stripped by the same rule and for a sharper reason: they
    are written TO the teacher, ABOUT the class. "Most students say the heavier
    object falls faster — let them say it before you correct it" is a sentence
    that must not be sitting in a child's page source.
    """
    stripped: dict[str, Any] = {}
    for component, content in (snapshot or {}).items():
        if not isinstance(content, dict):
            continue
        clean = dict(content)
        if isinstance(clean.get("slides"), list):
            clean["slides"] = [
                {field: value for field, value in slide.items() if field != "notes"}
                for slide in clean["slides"] if isinstance(slide, dict)
            ]
        # `study` joined `questions`/`blocks` when the fourth part was folded
        # into practice. A study card carries no key, but the loop is what
        # guarantees that — listing the field is cheaper than trusting it.
        for key in ("questions", "blocks", "study"):
            if isinstance(clean.get(key), list):
                clean[key] = [
                    {**{field: value for field, value in item.items()
                        # `explanation` stays out until submission too: shown up
                        # front it is simply the answer in a longer sentence.
                        if field not in ("answer", "explanation")},
                     **({"blanks": shape} if (shape := blank_shape(item)) else {})}
                    for item in clean[key] if isinstance(item, dict)
                ]
        stripped[component] = clean
    return stripped


async def save_answers(
    launch: str, learner_id: str, answers: dict[str, Any], *, time_spent: int = 0,
) -> dict[str, Any]:
    """Progress, saved. Refuses once submitted so a grade cannot be edited."""
    if await store.get_activation(launch, learner_id) is None:
        raise AttemptError("not_assigned")
    await _open_launch(launch)
    attempt = await store.start_attempt(launch, learner_id)
    if attempt.get("status") != "in_progress":
        raise AttemptError("already_submitted")

    merged = {**(attempt.get("answers") or {}), **(answers or {})}
    saved = await store.save_attempt(
        launch, learner_id, answers=merged,
        time_spent=max(int(attempt.get("time_spent") or 0), int(time_spent or 0)),
    )
    return {"saved": True, "answered": len(saved.get("answers") or {})}


async def submit(
    launch: str, learner_id: str, *, answers: Optional[dict[str, Any]] = None,
    time_spent: int = 0, language: str = "he",
) -> dict[str, Any]:
    """Grade the attempt, record the activity, and tell the child how it went.

    The composite is weighted per component and renormalized over the ones this
    task has. A component with nothing scorable is excluded rather than counted
    as zero — a task whose deck is its whole content is not a task the child
    failed.
    """
    from app.services.tasks.grader import grade_attempt

    activation = await store.get_activation(launch, learner_id)
    if activation is None:
        raise AttemptError("not_assigned")
    await _open_launch(launch)
    attempt = await store.start_attempt(launch, learner_id)
    if attempt.get("status") != "in_progress":
        raise AttemptError("already_submitted")

    merged = {**(attempt.get("answers") or {}), **(answers or {})}
    snapshot = activation.get("content_snapshot") or {}
    lang = _language(language)

    per_component: dict[str, Any] = {}
    weighted = weight_total = 0.0
    for component, questions in scored_questions(snapshot).items():
        result = await grade_attempt(questions, merged, language=lang)
        per_component[component] = result
        if result.get("score") is None:
            continue
        weight = COMPONENT_WEIGHTS.get(component, 0.0)
        weighted += result["score"] * weight
        weight_total += weight

    score = round(weighted / weight_total) if weight_total else None
    questions_seen = sum(len(items) for items in scored_questions(snapshot).values())
    answered = sum(
        1 for result in per_component.values()
        for verdict in result["questions"].values() if not verdict["skipped"]
    )
    feedback = _feedback(score, answered, questions_seen, lang)

    await store.save_attempt(
        launch, learner_id, status="submitted",
        answers=merged, questions=per_component, score=score,
        feedback=feedback["message"],
        time_spent=max(int(attempt.get("time_spent") or 0), int(time_spent or 0)),
    )
    await _record_completion(store.task_of_launch(launch), learner_id, score)
    return {"status": "submitted", **feedback,
            "content": _with_explanations(snapshot, per_component)}


def _feedback(
    score: Optional[int], answered: int, total: int, language: str,
) -> dict[str, Any]:
    """Words and sparks. Never a percentage — that is the teacher's view.

    A number here would become the whole message: a child who reads 62% stops
    reading the sentence that says what to do next.
    """
    voice = _PRAISE[language]
    if total and answered < total:
        key = "partial"
    elif score is None:
        key = "effort"
    elif score >= 80:
        key = "strong"
    elif score >= 50:
        key = "mixed"
    else:
        key = "effort"
    share = (answered / total) if total else 1.0
    return {
        "message": voice[key],
        "sparks": max(1, round(SPARKS_FOR_COMPLETION * share)),
        "answered": answered,
        "total": total,
    }


def _with_explanations(
    snapshot: dict[str, Any], per_component: dict[str, Any],
) -> dict[str, Any]:
    """After submission the child may see why — explanation, and their verdict.

    The answer key still does not travel: a per-question `correctness` and the
    generator's explanation are what teach; the key itself only matters to a
    child who intends to run the task again.
    """
    verdicts: dict[str, Any] = {}
    for result in per_component.values():
        verdicts.update(result.get("questions") or {})
        for question_id, sentence in (result.get("open_feedback") or {}).items():
            if question_id in verdicts:
                verdicts[question_id] = {**verdicts[question_id], "feedback": sentence}

    shown: dict[str, Any] = {}
    for component, content in (snapshot or {}).items():
        if not isinstance(content, dict):
            continue
        clean = dict(content)
        for key in ("questions", "blocks"):
            if isinstance(clean.get(key), list):
                clean[key] = [
                    {**{field: value for field, value in item.items() if field != "answer"},
                     "verdict": verdicts.get(str(item.get("id")))}
                    for item in clean[key] if isinstance(item, dict)
                ]
        shown[component] = clean
    return shown


async def _record_completion(task_id: str, learner_id: str, score: Optional[int]) -> None:
    """The durable "this child did something" row. Best-effort, never blocking.

    `days_inactive` reads `learning_events`, which a teacher task deliberately
    never writes to; `insights._days_inactive` consults the task store directly
    for that. This row is the per-learner activity record itself, which is what
    the teacher's analytics read.
    """
    try:
        from app.services import learner_activity

        await learner_activity.record(
            learner_id, "task", meta={"task_id": task_id, "score": score},
        )
    except Exception as exc:
        print(f"⚠️ task completion activity write failed: {type(exc).__name__}")


async def learner_view(launch: str, learner_id: str) -> dict[str, Any]:
    """A finished task as the child may re-open it: their words, not a mark."""
    attempt = await store.get_attempt(launch, learner_id)
    if attempt is None:
        raise AttemptError("no_attempt")
    return {
        "task_id": store.task_of_launch(launch),
        "launch_id": launch,
        "status": attempt.get("status"),
        "feedback": attempt.get("feedback"),
        "completed_at": attempt.get("completed_at"),
        "answers": attempt.get("answers") or {},
    }
