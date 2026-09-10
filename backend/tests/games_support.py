"""Shared fixtures for the Learning Game Lab tests.

A fake `kata_catalog` snapshot with one science objective, one unit and two
components — one with authored questions (`COMP-A`) and one without
(`COMP-EMPTY`). Both are playable now: the game is built around the lesson's
learning description, and the questions are only evidence for that paragraph.
The questioned component keeps its `correctAnswers` so the tests can prove
they never reach a job, a response, or a prompt.
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
from app.services.games import html_store, learning_descriptions, store

LEARNER = "kid-a"
OTHER = "kid-b"
TEACHER = "teacher-t"

OBJECTIVE = "MOE.SCI.G7.MASS.MEASURE"
UNIT = "unit-mass"
COMP = "COMP-A"
COMP_EMPTY = "COMP-EMPTY"

#: What the (patched) description service hands every job.
DESCRIPTION = (
    "בשיעור הזה לומדים למדוד מסה במאזניים: מסה נמדדת בקילוגרמים ובגרמים, "
    "1 ק\"ג = 1000 גרם, ומאזניים משווים בין שני צדדים. טעויות נפוצות: בלבול בין מסה למשקל."
)


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
                 "topic_title": "חומר", "prerequisites": [], "unit_ids": [UNIT],
                 "curriculum_title": "Science for 7th Grade",
                 "description": "Students measure mass with a balance and tell mass from weight."}
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
    mongo job mode, a fresh notifications/realtime state, and the learning
    description service answered from a constant — no model call.
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
        os.environ.pop("GAME_MODEL_DEFAULT", None)
        self.enter_context(patch.dict(kata_catalog._SNAPSHOT, snapshot(), clear=True))
        self.enter_context(patch.object(kata_catalog, "ensure_loaded", AsyncMock()))
        self.enter_context(patch("app.services.events.get_recent_events",
                                 AsyncMock(return_value=[{"objective_id": OBJECTIVE, "launch": COMP}])))
        # The create prepares inline so the job exists when the response
        # comes back; the description is a constant rather than a model call.
        from app.routes import games as routes
        self.enter_context(patch.object(routes, "INLINE_BACKGROUND", True))
        self.enter_context(patch.object(learning_descriptions, "ensure_description",
                                        AsyncMock(return_value=DESCRIPTION)))
        self.enter_context(patch.object(learning_descriptions, "cached",
                                        AsyncMock(return_value=DESCRIPTION)))
        learning_descriptions.reset_for_tests()
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
