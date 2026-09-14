from __future__ import annotations

import unittest
from unittest.mock import AsyncMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.auth.dependencies import require_learner
from app.routes import progression as routes

LEARNER = "route-learner"


def _app() -> FastAPI:
    app = FastAPI()
    app.include_router(routes.router)
    app.dependency_overrides[require_learner] = lambda: LEARNER
    return app


class ProgressionRouteTests(unittest.TestCase):
    def test_status_uses_authenticated_learner(self) -> None:
        payload = {"level": 3, "totalXp": 250}
        with patch.object(
            routes.progression, "get_status", AsyncMock(return_value=payload)
        ) as get_status:
            response = TestClient(_app()).get(
                "/api/progression/status?learner_id=someone-else"
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), payload)
        get_status.assert_awaited_once_with(LEARNER)

    def test_ledger_limit_is_validated_and_delegated(self) -> None:
        status = {"level": 1, "totalXp": 0}
        with patch.object(
            routes.progression, "list_ledger", AsyncMock(return_value=[])
        ) as list_ledger, patch.object(
            routes.progression, "get_status", AsyncMock(return_value=status)
        ):
            response = TestClient(_app()).get("/api/progression/ledger?limit=12")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"entries": [], "progression": status})
        list_ledger.assert_awaited_once_with(LEARNER, 12)

        invalid = TestClient(_app()).get("/api/progression/ledger?limit=101")
        self.assertEqual(invalid.status_code, 422)

    def test_no_public_grant_route_exists(self) -> None:
        response = TestClient(_app()).post("/api/progression/grant", json={"amount": 9999})
        self.assertEqual(response.status_code, 404)

    def test_hint_token_requires_the_active_exhausted_question(self) -> None:
        brain = {
            "current_state": {
                "component_id": "component-1",
                "item_id": "item-1",
                "question_id": "question-1",
                "support_used": {
                    "question_key": "component-1|item-1|question-1",
                    "hint": True,
                    "hint_level": 1,
                },
            }
        }
        with patch("app.brain.repository.get_brain", AsyncMock(return_value=brain)), \
                patch(
                    "app.services.progression.ledger.consume_entitlement",
                    AsyncMock(return_value={"consumed": True, "remaining": 0}),
                ) as consume, \
                patch(
                    "app.brain.repository.apply_brain_operators", AsyncMock()
                ) as update_brain:
            response = TestClient(_app()).post(
                "/api/progression/hint-token/use",
                json={"componentId": "component-1", "questionId": "question-1"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["remaining"], 0)
        consume.assert_awaited_once_with(LEARNER, field="extra_hint_tokens")
        update = update_brain.await_args.args[1]["current_state.support_used"]
        self.assertFalse(update["hint"])
        self.assertEqual(update["hint_level"], 0)

    def test_hint_token_rejects_stale_question_without_spending(self) -> None:
        brain = {"current_state": {
            "component_id": "component-2", "question_id": "question-2"
        }}
        with patch("app.brain.repository.get_brain", AsyncMock(return_value=brain)), \
                patch(
                    "app.services.progression.ledger.consume_entitlement", AsyncMock()
                ) as consume:
            response = TestClient(_app()).post(
                "/api/progression/hint-token/use",
                json={"componentId": "component-1", "questionId": "question-1"},
            )

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["code"], "question_changed")
        consume.assert_not_awaited()


if __name__ == "__main__":
    unittest.main()