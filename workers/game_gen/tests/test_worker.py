"""Worker consumer tests: backend services are faked, the pipeline is stubbed."""
from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest

from game_gen import worker
from game_gen.pipeline import JobResult
from game_gen.usage import UsageTotals

COMPONENT = {
    "id": "c1", "unit_id": "u1", "title": "מסה", "information_to_bot": "notes",
    "questions_by_item": {"i1": [{"questionId": "q1", "questionText": "מהי מסה?", "answers": ["כמות חומר", "נפח"], "correctAnswers": ["כמות חומר"]}]},
}


class FakeStore:
    JOBS = "learner_game_jobs"

    def __init__(self):
        self.games = {"g1": {"_id": "g1", "learner_id": "l1", "unit_id": "u1", "component_id": "c1", "title": "מסה",
                             "status": "queued", "current_version": 0, "versions": [], "sparks_spent": 0}}
        self.jobs = {"j1": {"_id": "j1", "game_id": "g1", "learner_id": "l1", "kind": "create", "status": "queued", "attempts": 0,
                            "payload": {"genre": "shooter", "vibe": "חלל", "language": "he", "device": "keyboard",
                                        "context": {"component": COMPONENT, "unit": {"id": "u1", "title": "יחידה", "objective_id": "o1", "subject": "science"}, "objective": {"title": "מסה"}}}}}
        self.status_log = []

    async def get_game(self, gid): return self.games.get(gid)
    async def get_job(self, jid): return self.jobs.get(jid)
    async def update_job(self, jid, **f): self.jobs[jid].update(f); return self.jobs[jid]
    async def update_status(self, gid, status, errors_last=None):
        self.games[gid]["status"] = status; self.status_log.append(status)
        if errors_last is not None: self.games[gid]["errors_last"] = errors_last
        return self.games[gid]
    def version_entry(self, game, v=None):
        return next((e for e in game["versions"] if e["v"] == (v or game["current_version"])), None)
    async def add_version(self, gid, *, blob_path, sha256, source, summary="", title=None, thumb_blob_path=None, sparks=0):
        g = self.games[gid]; v = len(g["versions"]) + 1
        entry = {"v": v, "blob_path": blob_path, "sha256": sha256, "source": source, "summary": summary}
        g["versions"].append(entry); g["current_version"] = v; g["status"] = "ready"; g["sparks_spent"] += sparks
        if title: g["title"] = title
        if thumb_blob_path: g["thumb_blob_path"] = thumb_blob_path
        return entry
    async def _find(self, coll, query, sort=None, limit=None):
        return [j for j in self.jobs.values() if j["status"] == query.get("status")][: (limit or 99)]


class FakeHtmlStore:
    def __init__(self): self.blobs = {}
    async def put_html(self, learner_id, game_id, v, html):
        key = f"games/{learner_id}/{game_id}/v{v}/index.html"; self.blobs[key] = html
        return {"blob_path": key, "sha256": "abc", "bytes": len(html)}
    async def put_bytes(self, learner_id, game_id, v, name, data, content_type="application/octet-stream"):
        key = f"games/{learner_id}/{game_id}/v{v}/{name}"; self.blobs[key] = data; return key
    async def get_html(self, key): return self.blobs.get(key)


class FakeNotify:
    def __init__(self): self.bells = []; self.frames = []
    async def notify_game(self, kind, game, v): self.bells.append((kind, game["_id"], v)); return {"kind": kind}
    def publish_progress(self, learner_id, game_id, event, **extra): self.frames.append(event); return 1


@pytest.fixture
def fakes(monkeypatch):
    store, html, notify = FakeStore(), FakeHtmlStore(), FakeNotify()
    monkeypatch.setattr(worker, "_backend", lambda: (store, html, notify))
    return SimpleNamespace(store=store, html=html, notify=notify)


def _result(ok=True):
    usage = UsageTotals(); usage.cost_usd = 0.25; usage.output_tokens = 5000
    return JobResult(ok=ok, html="<!DOCTYPE html><html><head></head><body><script>1</script></body></html>" if ok else None,
                     title="קרב המסה", summary="שאלות בין גלים", attempts=[], usage=usage, judge={"learning_integral": 4},
                     screenshot_png=b"png" if ok else None, elapsed_s=90.0, error=None if ok else "judge_rejected: 2")


def test_success_path_stores_version_and_rings_bell(fakes, monkeypatch):
    captured = {}

    async def fake_run_job(spec, progress):
        captured["spec"] = spec
        progress({"type": "build", "status": "start", "model": spec.model})
        progress({"type": "validate", "attempt": 1, "tool": "submit_game"})
        return _result(True)

    monkeypatch.setattr(worker, "run_job", fake_run_job)
    result = asyncio.run(worker.handle_job(dict(fakes.store.jobs["j1"])))
    assert result.ok
    spec = captured["spec"]
    assert spec.kind == "create" and spec.genre == "shooter" and spec.pack.questions[0].id == "i1#q1"
    assert spec.answer_key.correct == {"i1#q1": ["כמות חומר"]}
    game = fakes.store.games["g1"]
    assert game["status"] == "ready" and game["current_version"] == 1 and game["title"] == "קרב המסה"
    assert game["sparks_spent"] == 25 and game["thumb_blob_path"].endswith("v1/thumb.png")
    assert "games/l1/g1/v1/index.html" in fakes.html.blobs
    assert fakes.store.jobs["j1"]["status"] == "done" and fakes.store.jobs["j1"]["usage_summary"]["cost_usd"] == 0.25
    assert fakes.notify.bells == [("game_ready", "g1", 1)]
    assert "build" in fakes.notify.frames and "validate" in fakes.notify.frames
    assert fakes.store.status_log[0] == "building" and fakes.store.games["g1"]["status"] == "ready"


def test_failure_path_marks_failed_and_notifies(fakes, monkeypatch):
    async def fake_run_job(spec, progress):
        return _result(False)

    monkeypatch.setattr(worker, "run_job", fake_run_job)
    asyncio.run(worker.handle_job(dict(fakes.store.jobs["j1"])))
    assert fakes.store.games["g1"]["status"] == "failed"
    assert fakes.store.jobs["j1"]["status"] == "failed" and fakes.store.jobs["j1"]["error_class"] == "judge_rejected"
    assert fakes.notify.bells == [("game_failed", "g1", 0)]


def test_edit_job_loads_current_html(fakes, monkeypatch):
    fakes.store.games["g1"]["versions"] = [{"v": 1, "blob_path": "games/l1/g1/v1/index.html"}]
    fakes.store.games["g1"]["current_version"] = 1
    fakes.html.blobs["games/l1/g1/v1/index.html"] = "<html>old</html>"
    fakes.store.jobs["j1"].update(kind="edit", version=1, payload={**fakes.store.jobs["j1"]["payload"], "instruction": "יותר צבעוני"})
    seen = {}

    async def fake_run_job(spec, progress):
        seen["html"] = spec.current_html; seen["instruction"] = spec.instruction
        return _result(True)

    monkeypatch.setattr(worker, "run_job", fake_run_job)
    asyncio.run(worker.handle_job(dict(fakes.store.jobs["j1"])))
    assert seen == {"html": "<html>old</html>", "instruction": "יותר צבעוני"}
    assert fakes.notify.bells == [("game_edit_ready", "g1", 2)]


def test_mongo_loop_once_drains_queue(fakes, monkeypatch):
    async def fake_run_job(spec, progress):
        return _result(True)

    monkeypatch.setattr(worker, "run_job", fake_run_job)
    # JSON-fallback claim path (no Mongo collection available)
    import types
    fake_repo = types.SimpleNamespace(_get_collection_named=lambda name: None)
    monkeypatch.setitem(__import__("sys").modules, "app.brain.repository", fake_repo)
    handled = asyncio.run(worker.run_mongo_loop(once=True))
    assert handled == 1 and fakes.store.jobs["j1"]["status"] == "done"
