"""The workshop API: who may see an artifact, and under which headers.

The artifact route serves HTML a child's prompt produced, from our own origin.
The response headers are the entire security boundary, so they are asserted here
rather than left to review.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

from fastapi import FastAPI
import httpx

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.auth.dependencies import require_learner  # noqa: E402
from app.routes import workshop as workshop_routes  # noqa: E402
from app.services.workshop import builder, repository, storage  # noqa: E402

OWNER = "learner-owner"
STRANGER = "learner-stranger"

GAME = (
    "<!DOCTYPE html><html dir=\"rtl\"><head><meta charset=\"utf-8\"></head>"
    "<body><canvas id=\"sky\"></canvas><script>let score = 0;</script></body></html>"
)


async def _fake_build(*args, **kwargs):
    for chunk in (GAME[:40], GAME[40:]):
        yield chunk


async def _collect(client: httpx.AsyncClient, url: str, body: dict) -> list[dict]:
    events: list[dict] = []
    async with client.stream("POST", url, json=body) as response:
        assert response.status_code == 200, response.status_code
        async for line in response.aiter_lines():
            if not line.startswith("data: "):
                continue
            payload = line[6:]
            if payload == "[DONE]":
                break
            events.append(json.loads(payload))
    return events


class WorkshopApiTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)

        self.app = FastAPI()
        self.app.include_router(workshop_routes.router)
        self.learner = OWNER
        self.app.dependency_overrides[require_learner] = lambda: self.learner

        self.patches = [
            patch.object(storage, "_FALLBACK_ROOT", root / "blobs"),
            patch.object(repository, "_FALLBACK_FILE", root / "workshop.json"),
            patch.object(repository, "_get_collection_named", return_value=None),
            patch.object(storage, "is_configured", return_value=False),
            patch.object(builder, "build", _fake_build),
        ]
        for item in self.patches:
            item.start()

        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=self.app), base_url="http://test"
        )

    async def asyncTearDown(self):
        await self.client.aclose()
        for item in self.patches:
            item.stop()
        self.temp.cleanup()

    async def _project(self) -> str:
        response = await self.client.post(
            "/api/workshop/projects", json={"title": "משחק חלל", "kind": "game"}
        )
        self.assertEqual(response.status_code, 200)
        return response.json()["project"]["id"]

    async def _build(self, project_id: str) -> list[dict]:
        with patch.object(builder, "understand", return_value={
            "ready": True, "question": "", "options": [], "title": "משחק חלל", "kind": "game",
        }), patch.object(builder, "plan", return_value=[
            {"title": "בונים חללית", "achieved": "יש לך חללית שזזה"},
        ]), patch.object(builder, "cards", return_value={"know": "", "challenge": ""}):
            return await _collect(
                self.client,
                f"/api/workshop/projects/{project_id}/build",
                {"message": "בנה לי משחק חלל"},
            )

    async def test_a_build_produces_a_version_the_learner_can_open(self):
        project_id = await self._project()
        events = await self._build(project_id)

        ready = next(event["ready"] for event in events if "ready" in event)
        self.assertEqual(ready["version"], 1)
        self.assertTrue(ready["publishable"])

        artifact = await self.client.get(ready["url"])
        self.assertEqual(artifact.status_code, 200)
        self.assertIn("<canvas", artifact.text)

    async def test_the_artifact_is_served_with_an_opaque_origin_and_no_network(self):
        project_id = await self._project()
        await self._build(project_id)

        artifact = await self.client.get(f"/api/workshop/projects/{project_id}/artifact")
        policy = artifact.headers["content-security-policy"]
        self.assertIn("sandbox allow-scripts", policy)
        self.assertNotIn("allow-same-origin", policy)
        self.assertIn("connect-src 'none'", policy)
        self.assertEqual(artifact.headers["x-content-type-options"], "nosniff")

    async def test_another_learners_project_does_not_exist(self):
        project_id = await self._project()
        await self._build(project_id)

        self.learner = STRANGER
        for url in (
            f"/api/workshop/projects/{project_id}",
            f"/api/workshop/projects/{project_id}/artifact",
            f"/api/workshop/projects/{project_id}/versions/1/artifact",
        ):
            response = await self.client.get(url)
            self.assertEqual(response.status_code, 404, url)

    async def test_the_project_list_is_scoped_to_the_owner(self):
        await self._project()
        self.learner = STRANGER
        response = await self.client.get("/api/workshop/projects")
        self.assertEqual(response.json()["projects"], [])

    async def test_a_vague_request_asks_one_question_instead_of_guessing(self):
        project_id = await self._project()
        with patch.object(builder, "understand", return_value={
            "ready": False,
            "question": "מה קורה במשחק?",
            "options": ["מרוץ", "קפיצות"],
            "title": "",
            "kind": "game",
        }):
            events = await _collect(
                self.client,
                f"/api/workshop/projects/{project_id}/build",
                {"message": "משהו כיף"},
            )

        question = next(event for event in events if "question" in event)
        self.assertEqual(question["options"], ["מרוץ", "קפיצות"])
        self.assertFalse(any("ready" in event for event in events))

    async def test_restoring_an_old_version_appends_rather_than_rewrites(self):
        project_id = await self._project()
        await self._build(project_id)
        await self._build(project_id)

        response = await self.client.post(
            f"/api/workshop/projects/{project_id}/versions/1/restore"
        )
        self.assertEqual(response.json()["version"], 3)

        detail = await self.client.get(f"/api/workshop/projects/{project_id}")
        self.assertEqual(
            [version["version"] for version in detail.json()["versions"]], [3, 2, 1]
        )

    async def test_the_daily_build_cap_stops_a_runaway_loop(self):
        project_id = await self._project()
        with patch.object(workshop_routes, "MAX_DAILY_BUILDS", 1):
            await self._build(project_id)
            events = await self._build(project_id)
        self.assertIn({"error": "daily_build_limit"}, events)

    async def test_an_artifact_path_cannot_escape_the_container(self):
        with self.assertRaises(storage.StorageError):
            storage.build_path(OWNER, "../../etc", 1)
        with self.assertRaises(storage.StorageError):
            storage.build_path(OWNER, "p1", 0)

    async def test_a_blob_path_carries_no_learner_identifier(self):
        path = storage.build_path(OWNER, "p1", 1)
        self.assertNotIn(OWNER, path)
        self.assertTrue(path.endswith("/p1/v1/index.html"))

    async def test_a_blob_path_is_never_returned_to_the_learner(self):
        project_id = await self._project()
        await self._build(project_id)
        detail = await self.client.get(f"/api/workshop/projects/{project_id}")
        self.assertNotIn("blob", json.dumps(detail.json()))


if __name__ == "__main__":
    unittest.main()
