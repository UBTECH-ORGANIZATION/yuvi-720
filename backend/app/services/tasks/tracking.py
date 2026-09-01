"""What the teacher sees after a task goes out.

Deterministic throughout: counts, buckets and per-question breakdowns, computed
in code. Nothing here is inferred, and no learner is chosen by a model — the
same discipline the daily brief runs on, for the same reason. The prose layer
sits above this and consumes it.

Two things it is careful about.

**Learner ids, not names.** The portal already has one roster provider that
names every learner on every screen; a second naming path here would be a
second place for a wrong name to come from, which is a bug this codebase has
had before.

**Snapshot drift is reported, not hidden.** Each child answered the paper they
were given, and a teacher who edited the task mid-flight has a class where the
question numbered 3 is not the same question for everyone. The per-question
view is built from the current content, so it says how many children hold an
older paper rather than quietly mixing them.
"""

from __future__ import annotations

import json
from typing import Any, Optional

from app.services.tasks import attempts as attempts_service
from app.services.tasks import store
from app.services.tasks.spec import segments_to_text

#: The four states a teacher acts on differently. `skipped` is deliberately not
#: `wrong`: "did not reach it" and "tried and failed" need different responses.
BUCKETS = ("correct", "partial", "wrong", "skipped")


def _bucket(verdict: dict[str, Any]) -> str:
    if verdict.get("skipped"):
        return "skipped"
    correctness = verdict.get("correctness")
    if correctness is None:
        return "skipped"
    if correctness >= 1.0:
        return "correct"
    return "partial" if correctness > 0 else "wrong"


def _fingerprint(content: Any) -> str:
    return json.dumps(content, sort_keys=True, ensure_ascii=False, default=str)


async def task_summary(task: dict[str, Any]) -> dict[str, Any]:
    """One row for the task list: where it is and how far the class has got.

    Counts span **every** opening, because the list answers "what happened with
    this material" — the per-opening split is the tracking screen's job, and a
    list row that showed only the newest opening would report a task sent to
    three classes as though two of them had not happened.
    """
    task_id = str(task.get("_id"))
    launches = await store.list_launches(task_id)
    activations = await store.list_activations_for_task(task_id) if launches else []
    rows = await store.list_attempts_for_task(task_id) if activations else []
    done = [row for row in rows if row.get("status") in ("submitted", "graded")]
    scores = [row["score"] for row in done if isinstance(row.get("score"), (int, float))]

    return {
        "id": task_id,
        "title": (task.get("spec") or {}).get("title"),
        "status": store.derived_status(task, launches),
        "subject": (task.get("spec") or {}).get("subject"),
        "target": task.get("target"),
        "group_id": task.get("group_id"),
        "components": (task.get("spec") or {}).get("components") or [],
        "deadline": task.get("deadline"),
        "created_at": task.get("created_at"),
        "assigned": len(activations),
        "started": len([row for row in rows if row.get("status") == "in_progress"]),
        "completed": len(done),
        "average_score": round(sum(scores) / len(scores)) if scores else None,
        "launch_count": len(launches),
        "open_launches": len([row for row in launches if row.get("status") == "active"]),
        # Judged per component by its LATEST pass: a component that failed once
        # and then generated fine is not missing, and saying it is teaches
        # teachers to ignore the warning.
        "generation_failures": [
            entry for entry in {
                e.get("component"): e for e in task.get("generation") or []
            }.values() if not entry.get("ok")
        ],
    }


async def launch_rows(task_id: str) -> list[dict[str, Any]]:
    """Every opening with its headline numbers, for the switcher.

    Cheap on purpose — the switcher is rendered before a teacher has chosen an
    opening, so it must not cost a full per-question breakdown per row.
    """
    rows = []
    for launch in await store.list_launches(task_id):
        launch_id = str(launch["_id"])
        attempts = await store.list_attempts(launch_id)
        done = [row for row in attempts if row.get("status") in ("submitted", "graded")]
        scores = [row["score"] for row in done
                  if isinstance(row.get("score"), (int, float))]
        rows.append({
            "id": launch_id,
            "seq": launch.get("seq"),
            "status": launch.get("status"),
            "targets": launch.get("targets") or [],
            "learner_ids": launch.get("learner_ids") or [],
            "assigned": len(launch.get("learner_ids") or []),
            "completed": len(done),
            "average_score": round(sum(scores) / len(scores)) if scores else None,
            "opened_at": launch.get("opened_at"),
            "closed_at": launch.get("closed_at"),
            "due_at": launch.get("due_at"),
        })
    return rows


async def for_launch(task: dict[str, Any], launch_id: str) -> dict[str, Any]:
    """One opening: per learner, and per question.

    Per-question buckets carry learner ids so a teacher can go straight from
    "six got this wrong" to those six — which is the action the screen exists
    for, and the reason a bare histogram would not do.
    """
    task_id = str(task.get("_id"))
    content = await store.all_content(task_id)
    activations = await store.list_activations(launch_id)
    rows = {str(row.get("learner_id")): row for row in await store.list_attempts(launch_id)}

    questions: list[dict[str, Any]] = []
    for component, items in attempts_service.scored_questions(content).items():
        for question in items:
            questions.append({
                "id": str(question.get("id")),
                "component": component,
                "type": question.get("type"),
                "prompt": question.get("prompt"),
                "prompt_text": segments_to_text(question.get("prompt")),
                **{bucket: [] for bucket in BUCKETS},
            })
    by_id = {question["id"]: question for question in questions}

    learners: list[dict[str, Any]] = []
    drifted = 0
    current = _fingerprint(content)
    for activation in activations:
        learner_id = str(activation.get("learner_id"))
        if _fingerprint(activation.get("content_snapshot") or {}) != current:
            drifted += 1
        attempt = rows.get(learner_id)
        verdicts: dict[str, Any] = {}
        for result in (attempt or {}).get("questions", {}).values():
            verdicts.update(result.get("questions") or {})

        for question_id, verdict in verdicts.items():
            question = by_id.get(question_id)
            if question is not None:
                question[_bucket(verdict)].append(learner_id)

        learners.append({
            "learner_id": learner_id,
            "status": (attempt or {}).get("status") or "not_started",
            "score": (attempt or {}).get("score"),
            "completed_at": (attempt or {}).get("completed_at"),
            "time_spent": (attempt or {}).get("time_spent") or 0,
            "answered": sum(1 for verdict in verdicts.values() if not verdict.get("skipped")),
            "total": len(questions),
            # Flagged for the teacher's eye: a capped or ungraded open answer.
            "needs_review": any(
                (verdict.get("detail") or {}).get("needs_review")
                for verdict in verdicts.values() if isinstance(verdict.get("detail"), dict)
            ),
        })

    learners.sort(key=lambda row: str(row["learner_id"]))
    launch = await store.get_launch(launch_id)
    return {
        "task_id": task_id,
        "launch_id": launch_id,
        "seq": (launch or {}).get("seq"),
        "launch_status": (launch or {}).get("status"),
        "title": (task.get("spec") or {}).get("title"),
        "status": task.get("status"),
        "learners": learners,
        "questions": questions,
        # Not a warning to bury: a per-question breakdown across two different
        # papers is a breakdown of nothing.
        "stale_snapshots": drifted,
    }


async def for_task(task: dict[str, Any],
                   launch_id: Optional[str] = None) -> dict[str, Any]:
    """One opening's view — the newest by default.

    The default matters: a teacher opening a task they sent this morning wants
    this morning's class, not the one from last term. Callers that care pass
    the opening they mean.
    """
    task_id = str(task.get("_id"))
    if not launch_id:
        launches = await store.list_launches(task_id)
        if not launches:
            # Never launched: the shape must still be answerable, because the
            # tracking screen is reachable from a `ready` task.
            return await for_launch(task, store.launch_id(task_id, 1))
        launch_id = str(launches[-1]["_id"])
    return await for_launch(task, launch_id)


async def for_learner(
    task: dict[str, Any], learner_id: str, launch_id: Optional[str] = None,
) -> Optional[dict[str, Any]]:
    """One child's paper in one opening — with the exact feedback they saw.

    The plan asks for this explicitly and it is what makes the rest auditable:
    a teacher looking at a mark can see the sentence the child read, rather
    than having to trust that it was reasonable.

    With retakes, "this child's paper" is ambiguous without an opening — a
    child may have sat the same task twice with different results. No opening
    given means their most recent one.
    """
    task_id = str(task.get("_id"))
    if not launch_id:
        for row in reversed(await store.list_launches(task_id)):
            if learner_id in (row.get("learner_ids") or []):
                launch_id = str(row["_id"])
                break
    if not launch_id:
        return None
    activation = await store.get_activation(launch_id, learner_id)
    if activation is None:
        return None
    attempt = await store.get_attempt(launch_id, learner_id)

    snapshot = activation.get("content_snapshot") or {}
    answers = (attempt or {}).get("answers") or {}
    verdicts: dict[str, Any] = {}
    open_feedback: dict[str, Any] = {}
    for result in (attempt or {}).get("questions", {}).values():
        verdicts.update(result.get("questions") or {})
        open_feedback.update(result.get("open_feedback") or {})

    rendered = []
    for component, items in attempts_service.scored_questions(snapshot).items():
        for question in items:
            question_id = str(question.get("id"))
            verdict = verdicts.get(question_id) or {}
            rendered.append({
                "id": question_id,
                "component": component,
                "type": question.get("type"),
                "prompt": question.get("prompt"),
                # The teacher's own material, so the key is not withheld here.
                "answer_key": question.get("answer"),
                "options": question.get("options"),
                "given": answers.get(question_id),
                "correctness": verdict.get("correctness"),
                "bucket": _bucket(verdict) if verdict else "skipped",
                "detail": verdict.get("detail"),
                # What the child read about this specific question.
                "feedback": open_feedback.get(question_id),
            })

    return {
        "task_id": task_id,
        "launch_id": launch_id,
        "learner_id": learner_id,
        "status": (attempt or {}).get("status") or "not_started",
        "score": (attempt or {}).get("score"),
        "time_spent": (attempt or {}).get("time_spent") or 0,
        "completed_at": (attempt or {}).get("completed_at"),
        # The overall sentence the child saw on finishing, beside the score.
        "learner_feedback": (attempt or {}).get("feedback"),
        "questions": rendered,
        "assigned_at": activation.get("assigned_at"),
        "due_at": activation.get("due_at"),
    }


async def for_group(task: dict[str, Any], learner_ids: list[str],
                    launch_id: Optional[str] = None) -> dict[str, Any]:
    """A sub-group slice of one opening — the same numbers, fewer children."""
    whole = await for_task(task, launch_id)
    wanted = set(learner_ids)
    questions = []
    for question in whole["questions"]:
        questions.append({**question, **{
            bucket: [learner for learner in question[bucket] if learner in wanted]
            for bucket in BUCKETS
        }})
    return {
        **whole,
        "learners": [row for row in whole["learners"] if row["learner_id"] in wanted],
        "questions": questions,
    }
