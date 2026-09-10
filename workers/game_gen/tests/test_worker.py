"""Worker consumer tests: backend services are faked, the pipeline is stubbed."""
from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest

from game_gen import worker
from game_gen.pipeline import Attempt, JobResult
from game_gen.usage import UsageTotals

CONTEXT = {
    "component": {"id": "c1", "title": "מסה", "purpose": "both", "relative_difficulty": 3},
    "unit": {"id": "u1", "title": "יחידה", "subject": "science"},
    "objective": {"id": "o1", "title": "מסה", "description": "…", "curriculum_title": "8th Grade Science"},
    "learning_description": "הילד לומד שמסה כוללת = אריזה + תכולה.",
}
JUDGE = {"scores": {"learning_through_play": 4, "fun": 4, "polish": 3, "age_fit": 5}, "notes": "n", "top_fix": "t",
         "revised": False, "before": None, "model": "gpt-5.4-mini"}


class FakeStore:
    JOBS = "learner_game_jobs"

    def __init__(self):
        self.games = {"g1": {"_id": "g1", "learner_id": "l1", "unit_id": "u1", "component_id": "c1", "title": "מסה",
                             "status": "queued", "current_version": 0, "versions": [], "sparks_spent": 0}}
        self.jobs = {"j1": {"_id": "j1", "game_id": "g1", "learner_id": "l1", "kind": "create", "status": "queued", "attempts": 0,
                            "created_at": "2026-09-10T08:00:00+00:00",
                            "payload": {"kind": "create", "genre": "shooter", "vibe": "חלל", "language": "he", "device": "keyboard",
                                        "model": "claude-sonnet-5", "reasoning_effort": "medium", "judge": True, "plan": True,
                                        "context": CONTEXT}}}
        self.status_log = []
        self.version_kwargs = []

    async def get_game(self, gid): return self.games.get(gid)
    async def get_job(self, jid): return self.jobs.get(jid)
    async def update_job(self, jid, **f): self.jobs[jid].update(f); return self.jobs[jid]
    async def update_game(self, gid, **f): self.games[gid].update(f); return self.games[gid]
    async def update_status(self, gid, status, errors_last=None):
        self.games[gid]["status"] = status; self.status_log.append(status)
        if errors_last is not None: self.games[gid]["errors_last"] = errors_last
        return self.games[gid]
    def version_entry(self, game, v=None):
        return next((e for e in game["versions"] if e["v"] == (v or game["current_version"])), None)
    async def add_version(self, gid, *, blob_path, sha256, source, summary="", title=None, thumb_blob_path=None, sparks=0,
                          design_brief=None, **kwargs):
        g = self.games[gid]; v = len(g["versions"]) + 1
        entry = {"v": v, "blob_path": blob_path, "sha256": sha256, "source": source, "summary": summary, **kwargs}
        g["versions"].append(entry); g["current_version"] = v; g["status"] = "ready"; g["sparks_spent"] += sparks
        if title: g["title"] = title
        if thumb_blob_path: g["thumb_blob_path"] = thumb_blob_path
        self.version_kwargs.append(kwargs)
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
    def __init__(self): self.bells = []; self.frames = []; self.extras = []
    async def notify_game(self, kind, game, v): self.bells.append((kind, game["_id"], v)); return {"kind": kind}
    def publish_progress(self, learner_id, game_id, event, **extra): self.frames.append(event); self.extras.append((event, extra)); return 1


@pytest.fixture
def fakes(monkeypatch):
    store, html, notify = FakeStore(), FakeHtmlStore(), FakeNotify()
    monkeypatch.setattr(worker, "_backend", lambda: (store, html, notify))
    worker._FIRST_JOB["pending"] = True
    return SimpleNamespace(store=store, html=html, notify=notify)


def _result(ok=True):
    usage = UsageTotals(); usage.cost_usd = 0.25; usage.output_tokens = 5000
    attempts = [Attempt(1, "text", ok, [] if ok else [{"message": "x is not defined"}], "ok" if ok else "1 error(s): x is not defined",
                        20.0, model_s=30.0, output_tokens=5000, html_lines=300, error_classes=[] if ok else ["scope"],
                        play_score={"frames": 50, "input_reacts": True, "dom_text": True})]
    return JobResult(ok=ok, html="<!DOCTYPE html><html><head></head><body><script>1</script></body></html>" if ok else None,
                     title="קרב המסה", summary="המסה היא המכניקה", attempts=attempts, usage=usage, judge=JUDGE if ok else None,
                     screenshot_png=b"png" if ok else None, elapsed_s=90.0, error=None if ok else "no_valid_submission",
                     timings={"session_start_s": 1.5, "plan_s": 6.0, "model_s": [30.0], "validate_s": [20.0], "judge_s": 4.0,
                              "revise_s": 0.0, "rejudge_s": 0.0, "total_s": 61.5})


def test_success_path_stores_version_and_rings_bell(fakes, monkeypatch):
    captured = {}

    async def fake_run_job(spec, progress):
        captured["spec"] = spec
        progress({"type": "build", "status": "start", "model": spec.model})
        progress({"type": "validate", "attempt": 1, "tool": "text"})
        return _result(True)

    monkeypatch.setattr(worker, "run_job", fake_run_job)
    result = asyncio.run(worker.handle_job(dict(fakes.store.jobs["j1"])))
    assert result.ok
    spec = captured["spec"]
    assert spec.kind == "create" and spec.genre == "shooter"
    assert spec.pack.learning_description == CONTEXT["learning_description"] and spec.pack.grade == "8"
    assert spec.pack.component_title == "מסה" and spec.pack.subject == "science"
    assert spec.model == "claude-sonnet-5" and spec.reasoning_effort == "medium" and spec.judge and spec.plan
    game = fakes.store.games["g1"]
    assert game["status"] == "ready" and game["current_version"] == 1 and game["title"] == "קרב המסה"
    assert game["sparks_spent"] == 25 and game["thumb_blob_path"].endswith("v1/thumb.png")
    assert "games/l1/g1/v1/index.html" in fakes.html.blobs
    job = fakes.store.jobs["j1"]
    assert job["status"] == "done" and job["usage_summary"]["cost_usd"] == 0.25
    assert job["model"] == "claude-sonnet-5" and job["reasoning_effort"] == "medium"
    assert job["judge"] == JUDGE and fakes.store.version_kwargs == [{"judge": JUDGE}]
    assert job["attempts_detail"][0]["n"] == 1 and job["attempts_detail"][0]["play_score"]["frames"] == 50
    t = job["timings"]
    assert t["model_s"] == [30.0] and t["plan_s"] == 6.0 and t["judge_s"] == 4.0
    assert t["queued_s"] > 0 and t["wake_s"] >= 0 and t["persist_s"] >= 0 and t["total_s"] >= 0
    assert fakes.notify.bells == [("game_ready", "g1", 1)]
    assert "build" in fakes.notify.frames and "validate" in fakes.notify.frames
    assert fakes.store.status_log[0] == "building" and fakes.store.games["g1"]["status"] == "ready"


def test_spec_defaults_when_the_payload_is_sparse(monkeypatch):
    monkeypatch.delenv("COPILOT_MODEL", raising=False)
    spec = worker.spec_from_job({"_id": "j", "game_id": "g", "learner_id": "l", "payload": {"context": {}}})
    assert spec.model == "claude-sonnet-5" and spec.reasoning_effort == "low" and spec.judge and spec.plan
    assert spec.pack.component_id == "" and spec.pack.language == "he"


def test_created_at_parsing():
    assert worker._parse_ts("2026-09-10T08:00:00+00:00") == worker._parse_ts("2026-09-10T08:00:00Z")
    assert worker._parse_ts(12.5) == 12.5
    assert worker._parse_ts(None) is None and worker._parse_ts("yesterday") is None


def test_failure_path_marks_failed_and_notifies(fakes, monkeypatch):
    async def fake_run_job(spec, progress):
        return _result(False)

    monkeypatch.setattr(worker, "run_job", fake_run_job)
    asyncio.run(worker.handle_job(dict(fakes.store.jobs["j1"])))
    assert fakes.store.games["g1"]["status"] == "failed"
    job = fakes.store.jobs["j1"]
    assert job["status"] == "failed" and job["error_class"] == "no_valid_submission"
    assert job["timings"]["total_s"] >= 0 and job["attempts_detail"][0]["error_classes"] == ["scope"]
    assert job["judge"] is None and job["model"] == "claude-sonnet-5"
    assert fakes.store.games["g1"]["errors_last"][0]["message"].startswith("1 error(s)")
    assert fakes.notify.bells == [("game_failed", "g1", 0)]


def test_failed_edit_keeps_the_game_ready(fakes, monkeypatch):
    async def fake_run_job(spec, progress):
        return _result(False)

    fakes.store.games["g1"]["current_version"] = 1
    fakes.store.games["g1"]["status"] = "ready"
    fakes.store.jobs["j1"]["kind"] = "edit"
    monkeypatch.setattr(worker, "run_job", fake_run_job)
    asyncio.run(worker.handle_job(dict(fakes.store.jobs["j1"])))
    assert fakes.store.games["g1"]["status"] == "ready"
    assert fakes.store.jobs["j1"]["status"] == "failed"
    assert fakes.notify.bells == [("game_failed", "g1", 1)]


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


def test_plan_frame_is_published_and_the_pitch_written(fakes, monkeypatch):
    pitch = "HOOK: ספינת מטען שחייבת לזרוק אריזה, לא מטען.\n" + ("WORLD & LOOK: חלל. " * 60)

    async def fake_run_job(spec, progress):
        progress({"type": "plan", "status": "start", "model": "gpt-5.4-mini"})
        progress({"type": "plan", "status": "done", "text": pitch})
        progress({"type": "build", "status": "start", "model": spec.model})
        await asyncio.sleep(0)
        return _result(True)

    monkeypatch.setattr(worker, "run_job", fake_run_job)
    asyncio.run(worker.handle_job(dict(fakes.store.jobs["j1"])))
    plan = [extra for event, extra in fakes.notify.extras if event == "plan"]
    assert len(plan) == 1 and plan[0]["detail"] == pitch[:600] and len(plan[0]["detail"]) == 600
    assert fakes.store.games["g1"]["pitch"] == pitch[:600]
    assert "description" not in fakes.store.games["g1"] or fakes.store.games["g1"]["description"] != pitch[:600]


def test_plan_frame_tolerates_a_store_without_update_game(fakes, monkeypatch):
    del FakeStore.update_game
    try:
        async def fake_run_job(spec, progress):
            progress({"type": "plan", "status": "done", "text": "HOOK"})
            return _result(True)

        monkeypatch.setattr(worker, "run_job", fake_run_job)
        asyncio.run(worker.handle_job(dict(fakes.store.jobs["j1"])))
        assert "plan" in fakes.notify.frames and "description" not in fakes.store.games["g1"]
    finally:
        async def update_game(self, gid, **f): self.games[gid].update(f); return self.games[gid]
        FakeStore.update_game = update_game


def test_judge_revision_streams_like_an_edit(fakes, monkeypatch):
    """A revision of a create starts from the accepted game: the kid sees the
    file at once, then the changed lines light up as each operation lands."""
    original = "<html>\nb\nc\n</html>"

    async def fake_run_job(spec, progress):
        progress({"type": "build", "status": "start", "model": spec.model})
        progress({"type": "text_delta", "text": "TITLE: x\n```html\n<html>\nb\n"})
        progress({"type": "revise", "status": "start", "html": original, "top_fix": "more mass"})
        progress({"type": "text_delta", "text": "SUMMARY: הרקע כחול\nREPLACE_LINES 2-2\nB\nEND_REPLACE\n"})
        progress({"type": "revise", "status": "done", "revised": True})
        return _result(True)

    monkeypatch.setattr(worker, "run_job", fake_run_job)
    asyncio.run(worker.handle_job(dict(fakes.store.jobs["j1"])))
    code = [extra for event, extra in fakes.notify.extras if event == "code"]
    reset = [c for c in code if c.get("reset") and c.get("instant")]
    assert reset[0]["chunk"] == original
    patched = [c for c in code if c.get("changed")]
    assert patched and patched[-1]["chunk"] == "<html>\nB\nc\n</html>" and patched[-1]["changed"] == [(2, 2)]
    summary = next(extra for event, extra in fakes.notify.extras if event == "summary")
    assert summary["detail"] == "הרקע כחול"


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


def test_reasoning_streams_as_thinking_frames_and_a_tail(fakes, monkeypatch):
    async def fake_run_job(spec, progress):
        progress({"type": "build", "status": "start", "model": spec.model})
        progress({"type": "reasoning_delta", "text": "First, the world: a space station. "})
        progress({"type": "reasoning_delta", "text": "Then the loop."})
        # The snapshot is throttled; a phase event forces it, as the clock does in production.
        progress({"type": "validate", "attempt": 1, "tool": "text"})
        await asyncio.sleep(0)
        return _result(True)

    monkeypatch.setattr(worker, "run_job", fake_run_job)
    asyncio.run(worker.handle_job(dict(fakes.store.jobs["j1"])))
    thinking = [extra for event, extra in fakes.notify.extras if event == "thinking"]
    assert thinking and thinking[0]["chunk"].startswith("First, the world")
    assert thinking[0]["thinking_chars"] == len("First, the world: a space station. ")
    live = fakes.store.jobs["j1"]["live"]
    assert live["thinking_tail"].endswith("Then the loop.")
    assert live["thinking_chars"] == len("First, the world: a space station. Then the loop.")


def test_tool_input_decoder_finds_the_key_and_undoes_escapes_across_chunks():
    d = worker._ToolInputDecoder()
    assert d.feed('{"title": "x", "design_brief": "a \\"quoted\\" brief", ') == ""
    assert d.feed('"html":"<!DOCTYPE html>\\n<p>שלום<\\/p>\\') == "<!DOCTYPE html>\n<p>שלום</p>"
    assert d.feed('u05d0 end"}') == "א end\"}"
    d.reset()
    assert d.feed('{"patches": "REPLACE_LINES 1-1\\n') == "REPLACE_LINES 1-1\n"


def test_hand_in_replaces_partial_stream_with_the_whole_code(fakes, monkeypatch):
    html = "<!DOCTYPE html><html><body>" + ("x" * 9000) + "</body></html>"

    async def fake_run_job(spec, progress):
        progress({"type": "build", "status": "start", "model": spec.model})
        progress({"type": "tool_delta", "name": "submit_game", "text": '{"title":"t","html":"<!DOCTYPE'})
        progress({"type": "tool", "name": "submit_game", "status": "start", "call_id": "c1",
                  "arguments": {"title": "t", "html": html}})
        progress({"type": "validate", "attempt": 1, "tool": "submit_game"})
        return _result(True)

    monkeypatch.setattr(worker, "run_job", fake_run_job)
    asyncio.run(worker.handle_job(dict(fakes.store.jobs["j1"])))
    code = [extra for event, extra in fakes.notify.extras if event == "code"]
    bursts = [c for c in code if c.get("reset") is not None]
    assert bursts[0]["reset"] is True and bursts[1]["reset"] is False
    assert "".join(c["chunk"] for c in bursts) == html
    assert fakes.store.jobs["j1"]["live"]["code_len"] == len(html)
    assert fakes.store.jobs["j1"]["live"]["code_tail"].endswith("</body></html>")


def test_fence_decoder_streams_the_html_block_and_restarts_on_a_new_fence():
    d = worker._FenceDecoder()
    assert d.feed("TITLE: x\nBRIEF: y\n``") == ("", False)
    assert d.feed("`html\n<!DOCTYPE html>\n<p>") == ("<!DOCTYPE html>\n<p>", False)
    assert d.feed("hi</p>`") == ("hi</p>", False)
    assert d.feed("``\nDone.") == ("", False)
    # a cut-off, then the model starts the file again
    assert d.feed("\n```html\n<!DOCTYPE html>\n<b>") == ("<!DOCTYPE html>\n<b>", True)


def test_mongo_loop_survives_a_claim_error(monkeypatch):
    calls = {"n": 0}

    async def flaky_claim():
        calls["n"] += 1
        if calls["n"] == 1:
            raise TimeoutError("cosmos read timed out")
        return None

    monkeypatch.setattr(worker, "_claim_next_mongo", flaky_claim)
    monkeypatch.setattr(worker, "POLL_SECONDS", 0.01)
    handled = asyncio.run(worker.run_mongo_loop(once=True))
    assert handled == 0 and calls["n"] == 2


def test_patch_streamer_shows_the_patched_file_as_each_operation_lands():
    """An edit streams as patch text; the kid sees the file with the change
    applied and the changed lines marked, once per completed operation."""
    original = "<html>\nb\nc\nd\n</html>"
    s = worker._PatchStreamer(original)
    assert s.feed("SUMMARY: x\nREPLACE_LINES 2-2\nB1\nB2\n") is None  # operation still open
    frame = s.feed("END_REPLACE\n")
    assert frame["html"] == "<html>\nB1\nB2\nc\nd\n</html>"
    assert frame["changed"] == [(2, 3)] and frame["focus_line"] == 2
    assert s.feed("some words") is None
    frame = s.feed("INSERT_AFTER 5\nF\nEND_INSERT\n")
    assert frame["html"] == "<html>\nB1\nB2\nc\nd\n</html>\nF"
    assert frame["changed"] == [(2, 3), (7, 7)] and frame["focus_line"] == 7
    assert s.feed("```html\n<!DOCTYPE html>") is None and s.rewrite
    s.rebase("<html>\nz\n</html>")
    assert not s.rewrite and s.feed("REPLACE_LINES 2-2\nZ\nEND_REPLACE\n")["html"] == "<html>\nZ\n</html>"


def test_changed_ranges_follow_the_patched_numbering():
    from game_gen.patch_engine import changed_ranges
    ops = [
        {"type": "delete", "start": 1, "end": 2},
        {"type": "replace", "start": 5, "end": 5, "code": "x\ny\nz"},
        {"type": "insert", "start": 8, "end": 8, "code": "w"},
    ]
    assert changed_ranges(ops) == [(3, 5), (9, 9)]


def test_edit_streams_the_summary_and_patching_progress_before_the_first_operation(fakes, monkeypatch):
    """The kid never waits on a blank page: Yuvi's SUMMARY line goes out the
    moment it is complete, and while the patch text is still streaming the
    page hears how far it has come; the patched file follows once an
    operation lands."""
    fakes.store.games["g1"]["versions"] = [{"v": 1, "blob_path": "games/l1/g1/v1/index.html"}]
    fakes.store.games["g1"]["current_version"] = 1
    fakes.html.blobs["games/l1/g1/v1/index.html"] = "<html>\nb\nc\n</html>"
    fakes.store.jobs["j1"].update(kind="edit", version=1, payload={**fakes.store.jobs["j1"]["payload"], "instruction": "כחול"})

    async def fake_run_job(spec, progress):
        progress({"type": "text_delta", "text": "SUMMARY: הרקע "})
        progress({"type": "text_delta", "text": "כחול עכשיו\nREPLACE_LINES 2-2\n"})
        progress({"type": "text_delta", "text": "B\n"})
        progress({"type": "text_delta", "text": "END_REPLACE\n"})
        return _result(True)

    monkeypatch.setattr(worker, "run_job", fake_run_job)
    asyncio.run(worker.handle_job(dict(fakes.store.jobs["j1"])))
    kinds = [event for event, _ in fakes.notify.extras]
    summary = next(extra for event, extra in fakes.notify.extras if event == "summary")
    assert summary["detail"] == "הרקע כחול עכשיו"
    assert "patching" in kinds  # progress even before the summary line is complete
    patched = [extra for event, extra in fakes.notify.extras if event == "code" and extra.get("changed")]
    assert patched and patched[-1]["chunk"] == "<html>\nB\nc\n</html>" and patched[-1]["changed"] == [(2, 2)]


def test_a_running_job_with_a_fresh_row_is_a_live_duplicate():
    now = 1_000_000.0
    assert worker._job_is_live({"status": "running", "updated_at": now - 10}, now)
    assert not worker._job_is_live({"status": "running", "updated_at": now - 600}, now), "a stale row is a dead run"
    assert not worker._job_is_live({"status": "queued", "updated_at": now - 1}, now)
    assert not worker._job_is_live({"status": "running"}, now)
