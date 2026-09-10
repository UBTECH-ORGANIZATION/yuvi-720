"""The /api/games routes: scoping, caps, the picker, the model policy, and —
above all — that no response and no job ever carries a correct answer.

The catalog snapshot still holds `correctAnswers`; these tests create real
jobs through the route and then assert that the job, the game read, the list,
and the picker are clean, and that the served HTML has the harness with
titles and the language only.
"""

from __future__ import annotations

import json
import os
import unittest
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from app.services.games import html_store, store
from tests.games_support import (
    COMP, COMP_EMPTY, CREATE_BODY, DESCRIPTION, GamesHarness, LEARNER, OBJECTIVE, OTHER, TEACHER, UNIT,
    app_for,
)


def _has_answers(payload) -> bool:
    text = json.dumps(payload, ensure_ascii=False)
    return "correctAnswers" in text or "correct_answers" in text or '"context"' in text


class GamesRoutesTest(unittest.TestCase):
    def setUp(self):
        self.harness = GamesHarness().__enter__()
        self.client = TestClient(app_for())

    def tearDown(self):
        self.harness.__exit__(None, None, None)

    def _create(self, **overrides) -> dict:
        response = self.client.post("/api/games", json={**CREATE_BODY, **overrides})
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    async def _ready(self, game_id: str, html: str = "<!DOCTYPE html><html><head><title>g</title></head><body>hi</body></html>") -> dict:
        """Play the worker: store HTML and land a version."""
        game = await store.get_game(game_id)
        v = len(game["versions"]) + 1
        stored = await html_store.put_html(LEARNER, game_id, v, html)
        await store.add_version(game_id, blob_path=stored["blob_path"], sha256=stored["sha256"],
                               source="create" if v == 1 else "edit", summary=f"v{v}")
        return await store.get_game(game_id)

    def _run(self, coro):
        import asyncio
        return asyncio.run(coro)

    # ── create ───────────────────────────────────────────────────────────────

    def test_create_writes_game_and_a_complete_job(self):
        created = self._create()
        self.assertEqual(created["status"], "queued")
        job = self._run(store.get_job(created["job_id"]))
        payload = job["payload"]
        self.assertEqual(job["kind"], "create")
        self.assertEqual(job["status"], "queued")
        self.assertEqual(payload["genre"], "runner")
        self.assertEqual(payload["vibe"], "space cats")
        self.assertEqual(payload["device"], "touch")
        self.assertEqual(payload["language"], "he")
        self.assertEqual(payload["reasoning_effort"], "low")
        self.assertIsNone(payload["model"], "no GAME_MODEL_DEFAULT → the worker's default")
        self.assertTrue(payload["judge"])
        self.assertTrue(payload["plan"], "creates run the pitch pre-pass")
        self.assertEqual(payload["feature"], "feature_7_learning_games")
        for key in ("clarifications", "instruction", "runtime_errors", "history"):
            self.assertIn(key, payload)
        context = payload["context"]
        self.assertEqual(context["component"], {
            "id": COMP, "title": f"Title of {COMP}", "purpose": "practice", "relative_difficulty": 2,
        })
        self.assertEqual(context["unit"], {"id": UNIT, "title": "מסה", "subject": "science"})
        self.assertEqual(context["objective"], {
            "id": OBJECTIVE, "title": "מדידת מסה",
            "description": "Students measure mass with a balance and tell mass from weight.",
            "curriculum_title": "Science for 7th Grade",
        })
        self.assertEqual(context["learning_description"], DESCRIPTION)
        # The job mirrors the model/effort for the admin report.
        self.assertIsNone(job["model"])
        self.assertEqual(job["reasoning_effort"], "low")
        self.assertIsNone(job["timings"])
        self.assertIsNone(job["judge"])
        # No question rows, no answers, no teacher notes — anywhere in the job.
        text = json.dumps(job, ensure_ascii=False)
        for forbidden in ("correctAnswers", "questions_by_item", "information_to_bot",
                          "Balance", "קילוגרם", "Which tool measures mass"):
            self.assertNotIn(forbidden, text)

    def test_create_refuses_unknown_components_but_not_questionless_ones(self):
        self.assertEqual(self.client.post("/api/games", json={**CREATE_BODY, "component_id": "nope"}).status_code, 404)
        self.assertEqual(self.client.post("/api/games", json={**CREATE_BODY, "genre": "gambling"}).status_code, 422)
        self.assertEqual(self.client.post("/api/games", json={**CREATE_BODY, "unit_id": "other-unit"}).status_code, 422)
        # A lesson without authored questions is still a lesson.
        created = self._create(component_id=COMP_EMPTY)
        job = self._run(store.get_job(created["job_id"]))
        self.assertEqual(job["payload"]["context"]["component"]["id"], COMP_EMPTY)
        self.assertEqual(job["payload"]["context"]["learning_description"], DESCRIPTION)

    def test_daily_create_cap(self):
        for _ in range(3):
            self._create()
        response = self.client.post("/api/games", json=CREATE_BODY)
        self.assertEqual(response.status_code, 429)
        self.assertEqual(response.json()["detail"], "daily_create_cap")

    def test_deep_thinking_raises_reasoning_effort(self):
        created = self._create(deep_thinking=True)
        job = self._run(store.get_job(created["job_id"]))
        self.assertEqual(job["payload"]["reasoning_effort"], "medium")
        # …and switches to the premium model (the bake-off's only cell that scored higher).
        self.assertEqual(job["payload"]["model"], "claude-opus-4.8")
        self.assertEqual(self._run(store.get_game(created["game_id"]))["model"], "claude-opus-4.8")
        self.assertEqual(job["reasoning_effort"], "medium")
        self.assertEqual(self._run(store.get_game(created["game_id"]))["reasoning_effort"], "medium")
        self.assertEqual(self.client.get(f"/api/games/{created['game_id']}").json()["reasoning_effort"], "medium")

    # ── model policy ─────────────────────────────────────────────────────────

    def test_learner_cannot_pick_a_model_but_an_admin_can(self):
        with patch.dict(os.environ, {"GAME_MODEL_DEFAULT": "claude-opus-5"}):
            created = self._create(model="gpt-5.6-sol")
            game = self._run(store.get_game(created["game_id"]))
            self.assertEqual(game["model"], "claude-opus-5", "a learner's pick is ignored, not refused")
            self.assertEqual(self._run(store.get_job(created["job_id"]))["payload"]["model"], "claude-opus-5")

            admin = TestClient(app_for(LEARNER, roles=("learner", "admin")))
            picked = admin.post("/api/games", json={**CREATE_BODY, "model": "gpt-5.6-sol"})
            self.assertEqual(picked.status_code, 201, picked.text)
            game = self._run(store.get_game(picked.json()["game_id"]))
            self.assertEqual(game["model"], "gpt-5.6-sol")
            job = self._run(store.get_job(picked.json()["job_id"]))
            self.assertEqual(job["payload"]["model"], "gpt-5.6-sol")
            self.assertEqual(job["model"], "gpt-5.6-sol")
            # An admin without a pick gets the default like everyone else.
            plain = admin.post("/api/games", json=CREATE_BODY).json()
            self.assertEqual(self._run(store.get_game(plain["game_id"]))["model"], "claude-opus-5")

    def test_edits_reuse_the_create_model_and_effort(self):
        admin = TestClient(app_for(LEARNER, roles=("learner", "admin")))
        created = admin.post("/api/games", json={**CREATE_BODY, "model": "claude-sonnet-5", "deep_thinking": True})
        self.assertEqual(created.status_code, 201, created.text)
        gid = created.json()["game_id"]
        self._run(self._ready(gid))
        with patch.dict(os.environ, {"GAME_MODEL_DEFAULT": "claude-opus-5"}):
            edited = self.client.post(f"/api/games/{gid}/edit", json={"instruction": "more cats"})
        self.assertEqual(edited.status_code, 200, edited.text)
        job = self._run(store.get_job(edited.json()["job_id"]))
        self.assertEqual(job["payload"]["model"], "claude-sonnet-5", "the default moved; the game did not")
        self.assertEqual(job["payload"]["reasoning_effort"], "medium")
        self.assertFalse(job["payload"]["plan"], "only creates run the pitch pre-pass")
        self.assertTrue(job["payload"]["judge"])
        self._run(store.update_status(gid, "ready"))
        fixed = self.client.post(f"/api/games/{gid}/report-bug", json={"errors": [{"message": "TypeError"}]})
        self.assertEqual(fixed.status_code, 200, fixed.text)
        fix = self._run(store.get_job(fixed.json()["job_id"]))
        self.assertEqual((fix["payload"]["model"], fix["payload"]["reasoning_effort"]), ("claude-sonnet-5", "medium"))

    def test_job_instrumentation_is_shown_to_admins_only(self):
        created = self._create()
        gid, job_id = created["game_id"], created["job_id"]
        self._run(store.update_job(job_id, timings={"total_s": 91.2}, attempts_detail=[{"n": 1, "ok": True}],
                                   judge={"scores": {"fun": 4}, "revised": False}, model="claude-opus-5"))
        learner_view = self.client.get(f"/api/games/{gid}").json()
        self.assertEqual(learner_view["model"], None)
        for key in ("timings", "judge", "model", "reasoning_effort", "attempts_detail"):
            self.assertNotIn(key, learner_view["last_job"])
        admin = TestClient(app_for(LEARNER, roles=("learner", "admin")))
        admin_view = admin.get(f"/api/games/{gid}").json()
        self.assertEqual(admin_view["last_job"]["timings"], {"total_s": 91.2})
        self.assertEqual(admin_view["last_job"]["judge"]["scores"]["fun"], 4)
        self.assertEqual(admin_view["last_job"]["model"], "claude-opus-5")
        self.assertEqual(admin_view["last_job"]["reasoning_effort"], "low")
        self.assertNotIn("payload", admin_view["last_job"])

    # ── prepare ──────────────────────────────────────────────────────────────

    def test_prepare_reports_cached_and_spawns_generation(self):
        from app.routes import games as routes
        from app.services.games import learning_descriptions

        spawned: list = []

        def fake_spawn(coro):
            spawned.append(coro)
            coro.close()

        with patch.object(routes, "_spawn", fake_spawn), \
             patch.object(learning_descriptions, "cached", AsyncMock(return_value=None)) as cached:
            cold = self.client.post("/api/games/prepare", json={"component_id": COMP, "language": "he"})
        self.assertEqual(cold.status_code, 202)
        self.assertEqual(cold.json(), {"ready": False})
        self.assertEqual(len(spawned), 1, "a miss starts the generation behind the response")
        self.assertTrue(cached.await_args.kwargs.get("fingerprint"), "the cache is fingerprint-gated")
        learning_descriptions.ensure_description.assert_called_once()
        self.assertEqual(learning_descriptions.ensure_description.call_args.kwargs["actor_id"], LEARNER)

        with patch.object(routes, "_spawn", fake_spawn):
            warm = self.client.post("/api/games/prepare", json={"component_id": COMP})
        self.assertEqual(warm.json(), {"ready": True})
        self.assertEqual(len(spawned), 1, "a hit spawns nothing")
        self.assertEqual(self.client.post("/api/games/prepare", json={"component_id": "nope"}).status_code, 404)

    # ── reads never leak ─────────────────────────────────────────────────────

    def test_game_read_and_list_carry_no_answers_and_no_context(self):
        created = self._create()
        one = self.client.get(f"/api/games/{created['game_id']}")
        self.assertEqual(one.status_code, 200)
        body = one.json()
        self.assertFalse(_has_answers(body), body)
        self.assertEqual(body["game_id"], created["game_id"])
        self.assertEqual(body["component_title"], f"Title of {COMP}")
        self.assertEqual(body["last_job"]["kind"], "create")
        self.assertNotIn("payload", body["last_job"])
        self.assertEqual(one.headers["cache-control"], "private, no-store")

        many = self.client.get("/api/games")
        self.assertEqual(many.status_code, 200)
        self.assertFalse(_has_answers(many.json()))
        self.assertEqual([row["game_id"] for row in many.json()["games"]], [created["game_id"]])

    def test_picker_lists_every_component_without_answers(self):
        response = self.client.get("/api/games/objectives")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertFalse(_has_answers(body))
        self.assertEqual([row["subject"] for row in body["subjects"]], ["science"])
        objective = body["subjects"][0]["objectives"][0]
        self.assertEqual(objective["id"], OBJECTIVE)
        self.assertTrue(objective["visited"])
        components = objective["components"]
        self.assertEqual([row["id"] for row in components], [COMP, COMP_EMPTY], "visited first, questionless included")
        self.assertNotIn("question_count", components[0])
        self.assertTrue(components[0]["visited"])
        self.assertFalse(components[1]["visited"])
        self.assertNotIn("questions_by_item", json.dumps(body))
        self.assertNotIn("information_to_bot", json.dumps(body))

    def test_list_filters_and_pages(self):
        ids = [self._create()["game_id"] for _ in range(3)]
        page = self.client.get("/api/games", params={"limit": 2}).json()
        self.assertEqual([row["game_id"] for row in page["games"]], [ids[2], ids[1]])
        rest = self.client.get("/api/games", params={"limit": 2, "cursor": page["next_cursor"]}).json()
        self.assertEqual([row["game_id"] for row in rest["games"]], [ids[0]])
        self.assertIsNone(rest["next_cursor"])
        none = self.client.get("/api/games", params={"component": "COMP-Z"}).json()
        self.assertEqual(none["games"], [])

    # ── scoping ──────────────────────────────────────────────────────────────

    def test_another_learner_sees_nothing(self):
        created = self._create()
        other = TestClient(app_for(OTHER))
        self.assertEqual(other.get(f"/api/games/{created['game_id']}").status_code, 404)
        self.assertEqual(other.get("/api/games").json()["games"], [])
        self.assertEqual(other.delete(f"/api/games/{created['game_id']}").status_code, 404)
        self.assertEqual(other.post(f"/api/games/{created['game_id']}/edit", json={"instruction": "x"}).status_code, 404)

    def test_a_teacher_reads_through_learner_scoping(self):
        created = self._create()
        teacher = TestClient(app_for(TEACHER, roles=("teacher",)))
        with patch("app.routes.games.assert_can_read_learner", AsyncMock()) as gate:
            response = teacher.get(f"/api/games/{created['game_id']}", params={"learner": LEARNER})
        self.assertEqual(response.status_code, 200)
        gate.assert_awaited_once()
        # Without the learner parameter a teacher has no games of their own.
        self.assertEqual(teacher.get("/api/games").status_code, 403)
        # And a teacher cannot spend the child's cap.
        self.assertEqual(teacher.post("/api/games", json=CREATE_BODY).status_code, 401)

    # ── html ─────────────────────────────────────────────────────────────────

    def test_html_is_served_with_the_harness_and_without_the_key(self):
        created = self._create()
        gid = created["game_id"]
        self.assertEqual(self.client.get(f"/api/games/{gid}/html").status_code, 404, "no version yet")
        self._run(self._ready(gid))
        response = self.client.get(f"/api/games/{gid}/html")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(response.headers["content-type"].startswith("text/html"))
        self.assertIn("connect-src 'none'", response.headers["content-security-policy"])
        self.assertIn("script-src 'unsafe-inline' https://cdn.jsdelivr.net", response.headers["content-security-policy"])
        html = response.text
        self.assertIn("window.__YUVI_LEARN_DATA", html)
        self.assertIn("YuviLearn", html)
        # The page carries titles and the language — no questions, no key.
        self.assertNotIn("item-2#q1", html)
        self.assertNotIn("Balance", html)
        self.assertNotIn("window.__YUVI_LEARN_KEY = ", html)
        self.assertNotIn("correctAnswers", html)
        self.assertIn("<body>hi</body>", html)
        learn = html.split("window.__YUVI_LEARN_DATA = ")[1].split(";</script>")[0]
        data = json.loads(learn)
        self.assertEqual(set(data), {"component", "objective", "language"})
        self.assertEqual(data["component"], {"id": COMP, "title": f"Title of {COMP}"})
        self.assertEqual(data["objective"], {"id": OBJECTIVE, "title": "מדידת מסה"})
        self.assertEqual(data["language"], "he")
        self.assertNotIn("correct", json.dumps(data))

    def test_html_version_parameter_selects_a_version(self):
        gid = self._create()["game_id"]
        self._run(self._ready(gid, html="<html><head></head><body>one</body></html>"))
        self._run(self._ready(gid, html="<html><head></head><body>two</body></html>"))
        self.assertIn("two", self.client.get(f"/api/games/{gid}/html").text)
        self.assertIn("one", self.client.get(f"/api/games/{gid}/html", params={"v": 1}).text)
        self.assertEqual(self.client.get(f"/api/games/{gid}/html", params={"v": 9}).status_code, 404)

    def test_check_and_next_are_gone(self):
        gid = self._create()["game_id"]
        self.assertEqual(self.client.post(f"/api/games/{gid}/check", json={"question_id": "item-1#q1", "answer": 0}).status_code, 404)
        self.assertEqual(self.client.post(f"/api/games/{gid}/next", json={"run_id": "r", "index": 0}).status_code, 404)

    # ── edit / fix / revert / delete ─────────────────────────────────────────

    def test_edit_needs_a_ready_game_and_respects_the_cap(self):
        gid = self._create()["game_id"]
        busy = self.client.post(f"/api/games/{gid}/edit", json={"instruction": "more cats"})
        self.assertEqual(busy.status_code, 409)
        self._run(self._ready(gid))
        with patch.dict("os.environ", {"GAMES_DAILY_EDIT_CAP": "1"}):
            ok = self.client.post(f"/api/games/{gid}/edit", json={"instruction": "more cats"})
            self.assertEqual(ok.status_code, 200, ok.text)
            job = self._run(store.get_job(ok.json()["job_id"]))
            self.assertEqual(job["kind"], "edit")
            self.assertEqual(job["version"], 1)
            self.assertEqual(job["payload"]["instruction"], "more cats")
            self.assertEqual(job["payload"]["history"], ["v1"])
            self.assertEqual(self._run(store.get_game(gid))["status"], "queued")
            # Queued again → busy; make it ready to test the cap itself.
            self._run(store.update_status(gid, "ready"))
            capped = self.client.post(f"/api/games/{gid}/edit", json={"instruction": "even more"})
            self.assertEqual(capped.status_code, 429)
            self.assertEqual(capped.json()["detail"], "daily_edit_cap")

    def test_edit_refuses_flagged_text(self):
        gid = self._create()["game_id"]
        self._run(self._ready(gid))
        with patch("app.routes.games.content_filter.check_content") as check:
            check.return_value.flagged = True
            response = self.client.post(f"/api/games/{gid}/edit", json={"instruction": "…"})
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["detail"], "content_blocked")

    def test_bug_reports_become_fix_jobs_capped_per_version(self):
        gid = self._create()["game_id"]
        self._run(self._ready(gid))
        errors = [{"message": "TypeError: x is undefined", "line": 12}]
        for _ in range(2):
            response = self.client.post(f"/api/games/{gid}/report-bug", json={"errors": errors, "note": ""})
            self.assertEqual(response.status_code, 200, response.text)
            job = self._run(store.get_job(response.json()["job_id"]))
            self.assertEqual(job["kind"], "fix")
            self.assertEqual(job["version"], 1)
            self.assertEqual(job["payload"]["runtime_errors"], errors)
            self._run(store.update_status(gid, "ready"))
        third = self.client.post(f"/api/games/{gid}/report-bug", json={"errors": errors})
        self.assertEqual(third.status_code, 429)
        self.assertEqual(third.json()["detail"], "fix_cap_reached")
        game = self._run(store.get_game(gid))
        self.assertEqual(game["errors_last"], errors, "the errors are kept even when no job runs")
        self.assertEqual(game["status"], "ready")
        # A new version resets the count.
        self._run(self._ready(gid))
        fourth = self.client.post(f"/api/games/{gid}/report-bug", json={"errors": errors})
        self.assertEqual(fourth.status_code, 200)

    def test_revert_and_delete(self):
        gid = self._create()["game_id"]
        self._run(self._ready(gid))
        self._run(self._ready(gid))
        reverted = self.client.post(f"/api/games/{gid}/revert", json={"v": 1})
        self.assertEqual(reverted.status_code, 200, reverted.text)
        self.assertEqual(reverted.json()["current_version"], 1)
        self.assertEqual(self.client.post(f"/api/games/{gid}/revert", json={"v": 5}).status_code, 404)
        self.assertEqual(self.client.delete(f"/api/games/{gid}").json(), {"ok": True})
        self.assertEqual(self.client.get(f"/api/games/{gid}").status_code, 404)
        self.assertEqual(self.client.get("/api/games").json()["games"], [])
        # Deleting does not refund the daily cap.
        self.assertEqual(self._run(store.count_created_today(LEARNER)), 1)

    # ── queue modes ──────────────────────────────────────────────────────────

    def test_service_bus_failure_marks_the_job_and_game_failed(self):
        with patch.dict("os.environ", {"GAME_JOBS_MODE": "servicebus"}), \
             patch("app.services.games.jobs._send_to_service_bus",
                   AsyncMock(side_effect=RuntimeError("down"))):
            response = self.client.post("/api/games", json=CREATE_BODY)
        # The card is answered before the queue send (the description is
        # prepared behind it), so the failure lands on the game and the job,
        # not on the response.
        self.assertEqual(response.status_code, 201)
        self.assertIsNone(response.json()["job_id"])
        games, _ = self._run(store.list_games(LEARNER))
        self.assertEqual(games[0]["status"], "failed")
        job = self._run(store.latest_job(games[0]["_id"]))
        self.assertEqual(job["status"], "failed")
        self.assertEqual(job["error_class"], "EnqueueFailed")

    def test_service_bus_send_carries_a_pointer_with_the_game_as_session(self):
        sent: list = []

        class _Sender:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *args):
                return False

            async def send_messages(self, message):
                sent.append(message)

        class _Client:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *args):
                return False

            def get_queue_sender(self, queue_name):
                sent.append(queue_name)
                return _Sender()

        import sys
        import types

        fake_sb = types.ModuleType("azure.servicebus")
        fake_sb_aio = types.ModuleType("azure.servicebus.aio")

        class ServiceBusMessage:
            def __init__(self, body, session_id=None, content_type=None):
                self.body, self.session_id, self.content_type = body, session_id, content_type

        fake_sb.ServiceBusMessage = ServiceBusMessage
        fake_sb_aio.ServiceBusClient = types.SimpleNamespace(from_connection_string=lambda _c: _Client())
        with patch.dict("os.environ", {"GAME_JOBS_MODE": "servicebus", "GAME_JOBS_QUEUE": "game-jobs",
                                       "GAME_JOBS_SERVICEBUS_CONNECTION_STRING": "Endpoint=sb://x"}), \
             patch.dict(sys.modules, {"azure.servicebus": fake_sb, "azure.servicebus.aio": fake_sb_aio}):
            created = self._create()
        self.assertEqual(sent[0], "game-jobs")
        message = sent[1]
        self.assertEqual(message.session_id, created["game_id"])
        body = json.loads(message.body)
        self.assertEqual(set(body), {"job_id", "game_id", "learner_id", "kind"})
        self.assertEqual(body["job_id"], created["job_id"])
        self.assertNotIn("context", message.body)


if __name__ == "__main__":
    unittest.main()
