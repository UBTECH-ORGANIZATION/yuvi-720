"""Shared fixtures for the Learning Game Lab tests.

A fake `kata_catalog` snapshot with one science objective, one unit and two
components — one with gradeable questions (`COMP-A`) and one without
(`COMP-EMPTY`), so the picker's filter and the create route's refusal both
have something to bite on. Question ids repeat across items (`q1` on both
screens) exactly as the live catalog does, so a test that grades `item-2#q1`
proves the item-scoped rule and not just the happy path.
"""

from __future__ import annotations

import os
import tempfile
from contextlib import ExitStack
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, patch

from fastapi import FastAPI

from app.auth.dependencies import current_user, require_learner
from app.services import kata_catalog, notifications, realtime
from app.services.games import html_store, store

LEARNER = "kid-a"
OTHER = "kid-b"
TEACHER = "teacher-t"

OBJECTIVE = "MOE.SCI.G7.MASS.MEASURE"
UNIT = "unit-mass"
COMP = "COMP-A"
COMP_EMPTY = "COMP-EMPTY"


def _component(cid: str, *, questions: bool) -> dict[str, Any]:
    by_item = {}
    if questions:
        by_item = {
            "item-1": [{
                "questionId": "q1", "questionType": "choice",
                "questionText": "מה יחידת המידה של מסה?",
                "answers": ["קילוגרם", "מטר", "שנייה"],
                "correctAnswers": ["קילוגרם"],
            }],
            "item-2": [
                {
                    "questionId": "q1", "questionType": "choice",
                    "questionText": "Which tool measures mass?",
                    "answers": ["Ruler", "Balance scale", "Clock"],
                    "correctAnswers": ["Balance  Scale"],
                },
                {
                    "questionId": "q2", "questionType": "open",
                    "questionText": "No options here",
                    "answers": [],
                    "correctAnswers": ["whatever"],
                },
            ],
        }
    return {
        "id": cid, "unit_id": UNIT, "objective_id": OBJECTIVE, "subject": "science",
        "title": f"Title of {cid}", "titles": {}, "purpose": "practice",
        "relative_difficulty": 2, "is_assessment": False,
        "information_to_bot": "Mass is measured with a balance.",
        "questions_by_item": by_item,
    }


def snapshot() -> dict[str, Any]:
    components = {COMP: _component(COMP, questions=True),
                  COMP_EMPTY: _component(COMP_EMPTY, questions=False)}
    unit = {"id": UNIT, "objective_id": OBJECTIVE, "subject": "science", "title": "מסה",
            "titles": {}, "sub_topic": "MOE.SCI.G7.MASS", "grade": "7",
            "components": list(components.values())}
    objective = {"id": OBJECTIVE, "subject": "science", "title": "מדידת מסה", "titles": {},
                 "topic_title": "חומר", "prerequisites": [], "unit_ids": [UNIT]}
    return {
        "loaded_at": 1.0,
        "objectives": {OBJECTIVE: objective},
        "by_subject": {"science": [OBJECTIVE], "english": []},
        "components": components,
        "components_by_obj": {OBJECTIVE: [COMP, COMP_EMPTY]},
        "units": {UNIT: unit},
    }


class GamesHarness(ExitStack):
    """Everything a games test needs, entered as one context.

    No database (the collection handle is None → JSON fallback in a temp dir),
    a primed catalog snapshot, local HTML storage in the same temp dir, the
    mongo job mode, and a fresh notifications/realtime state.
    """

    def __enter__(self) -> "GamesHarness":
        super().__enter__()
        self.tmp = Path(self.enter_context(tempfile.TemporaryDirectory()))
        self.enter_context(patch("app.brain.repository._get_collection_named", return_value=None))
        self.enter_context(patch.object(store, "_FALLBACK_FILE", self.tmp / "games.json"))
        self.enter_context(patch.object(html_store, "_LOCAL_ROOT", self.tmp))
        self.enter_context(patch.dict(os.environ, {
            "GAMES_STORAGE": "local", "GAME_JOBS_MODE": "mongo",
            "GAMES_DAILY_CREATE_CAP": "3", "GAMES_DAILY_EDIT_CAP": "10",
        }))
        self.enter_context(patch.dict(kata_catalog._SNAPSHOT, snapshot(), clear=True))
        self.enter_context(patch.object(kata_catalog, "ensure_loaded", AsyncMock()))
        self.enter_context(patch("app.services.events.get_recent_events",
                                 AsyncMock(return_value=[{"objective_id": OBJECTIVE, "launch": COMP}])))
        notifications.reset_for_tests()
        realtime.reset_for_tests()
        return self


def app_for(learner_id: str = LEARNER, roles: tuple[str, ...] = ("learner",)) -> FastAPI:
    """A test app whose session is `learner_id` with `roles`."""
    from app.routes import games as routes

    app = FastAPI()
    app.include_router(routes.router)
    session = {"sub": learner_id, "roles": list(roles)}
    app.dependency_overrides[current_user] = lambda: session
    if "learner" in roles:
        app.dependency_overrides[require_learner] = lambda: learner_id
    return app


CREATE_BODY = {
    "objective_id": OBJECTIVE, "unit_id": UNIT, "component_id": COMP,
    "genre": "runner", "vibe": "space cats", "device": "touch", "language": "he",
}
