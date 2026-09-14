"""Server-owned XP award values and deterministic source adapters."""

from __future__ import annotations

from typing import Any, Optional

from app.services.progression import ledger as progression_ledger
from app.services.progression.ledger import award_xp, get_status
from app.services.progression.rewards import settle_through_level
from learner_state import normalize_learner_id  # type: ignore

MODULE_COMPLETED_XP = 15
LEARNING_GOAL_COMPLETED_XP = 50
TEACHER_QUEST_COMPLETED_XP = 20
FIRST_OBJECTIVE_XP = {"started": 20, "progressed": 30, "completed": 50}
LATER_OBJECTIVE_COMPLETED_XP = 50
HELP_MILESTONE_XP = 15
HELP_MILESTONES = frozenset({30, 60, 90})
PERSONAL_PATH_STARTED_XP = 20


async def _award_with_settlement(
    learner_id: str, *, key: str, amount: int, reason: str, source: dict[str, Any]
) -> dict[str, Any]:
    result = await award_xp(
        learner_id, key=key, amount=amount, reason=reason, source=source
    )
    result["levelRewards"] = await settle_through_level(
        learner_id, result["progression"]["level"]
    )
    result["progression"] = await get_status(learner_id)
    return result


async def award_module_completed(
    learner_id: Optional[str], module_id: str, learning_goal_id: Optional[str] = None
) -> dict[str, Any]:
    lid = normalize_learner_id(learner_id)
    source = {"type": "learning_event", "module_id": module_id}
    if learning_goal_id:
        source["learning_goal_id"] = learning_goal_id
    return await _award_with_settlement(
        lid,
        key=f"xp:{lid}:module:{module_id}",
        amount=MODULE_COMPLETED_XP,
        reason="learning_module.completed",
        source=source,
    )


async def award_personal_path_started(learner_id: Optional[str]) -> dict[str, Any]:
    """Reward the one-time opening of a completed learner's personal path."""
    lid = normalize_learner_id(learner_id)
    return await _award_with_settlement(
        lid,
        key=f"xp:{lid}:onboarding:personal_path_started",
        amount=PERSONAL_PATH_STARTED_XP,
        reason="onboarding.personal_path_started",
        source={"type": "onboarding", "event": "personal_path_started"},
    )


async def award_learning_goal_completed(
    learner_id: Optional[str], learning_goal_id: str
) -> dict[str, Any]:
    lid = normalize_learner_id(learner_id)
    return await _award_with_settlement(
        lid,
        key=f"xp:{lid}:learning_goal:{learning_goal_id}",
        amount=LEARNING_GOAL_COMPLETED_XP,
        reason="learning_goal.completed",
        source={"type": "learning_event", "learning_goal_id": learning_goal_id},
    )


async def award_teacher_quest_completed(
    learner_id: Optional[str], quest_id: str
) -> dict[str, Any]:
    lid = normalize_learner_id(learner_id)
    return await _award_with_settlement(
        lid,
        key=f"xp:{lid}:teacher_quest:{quest_id}",
        amount=TEACHER_QUEST_COMPLETED_XP,
        reason="teacher_quest.completed",
        source={"type": "teacher_quest", "id": quest_id},
    )


async def award_objective_stage(
    learner_id: Optional[str], objective_id: str, stage: str, *, is_first: bool
) -> dict[str, Any]:
    normalized_stage = "completed" if stage == "summarized" else stage
    amount = (
        FIRST_OBJECTIVE_XP.get(normalized_stage, 0)
        if is_first
        else LATER_OBJECTIVE_COMPLETED_XP if normalized_stage == "completed" else 0
    )
    if not amount:
        return {"awarded": 0, "duplicate": False, "progression": await get_status(learner_id)}
    lid = normalize_learner_id(learner_id)
    return await _award_with_settlement(
        lid,
        key=f"xp:{lid}:objective:{objective_id}:stage:{normalized_stage}",
        amount=amount,
        reason=f"personal_objective.{normalized_stage}",
        source={"type": "personal_objective", "id": objective_id, "stage": normalized_stage},
    )


async def award_help_milestone(
    learner_id: Optional[str], milestone: int
) -> dict[str, Any]:
    if int(milestone) not in HELP_MILESTONES:
        return {"awarded": 0, "duplicate": False, "progression": await get_status(learner_id)}
    lid = normalize_learner_id(learner_id)
    return await _award_with_settlement(
        lid,
        key=f"xp:{lid}:help:milestone:{int(milestone)}",
        amount=HELP_MILESTONE_XP,
        reason="learning_help.milestone",
        source={"type": "learning_help", "milestone": int(milestone)},
    )


async def record_qualifying_help(
    learner_id: Optional[str], request_id: str
) -> dict[str, Any]:
    counted = await progression_ledger.record_help_request(learner_id, request_id)
    if not counted["counted"] or counted["count"] not in HELP_MILESTONES:
        return {
            "awarded": 0,
            "duplicate": not counted["counted"],
            "helpRequestCount": counted["count"],
            "progression": await get_status(learner_id),
            "levelRewards": [],
        }
    result = await award_help_milestone(learner_id, counted["count"])
    result["helpRequestCount"] = counted["count"]
    return result