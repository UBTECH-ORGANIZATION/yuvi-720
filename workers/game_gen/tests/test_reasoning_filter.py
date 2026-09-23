"""Claude Opus 5.5's content filter blocks any instruction about how the model
reasons. On Dev (2026-09-23) every build turn of a legitimate coordinates game
came back "blocked by content filtering" with 0 output tokens, until both the
identity's "the kid watches your reasoning" line and the "think in Hebrew"
line were gone. These pin: the lines stay for models that accept them, go for
Opus 5.5, a filtered reply is an error (not an incomplete game), and a
filtered build is rebuilt once on the fallback model."""
from __future__ import annotations

import asyncio
from types import SimpleNamespace

from game_gen import copilot_session, pipeline, prompts
from game_gen.context_pack import ContextPack

PACK = ContextPack(component_id="c1", unit_id="u1", learning_description="קואורדינטות", language="he")
THINK_HE = "הילד/ה רואה את המחשבות שלך"


def test_models_that_accept_reasoning_steering_keep_both_lines():
    assert prompts.steers_reasoning("claude-opus-5") and prompts.steers_reasoning("claude-sonnet-5")
    assert prompts.REASONING_LINE in prompts.builder_system_message("he", model="claude-opus-5")
    assert THINK_HE in prompts.create_prompt(PACK, vibe="אוצר", model="claude-opus-5")
    assert THINK_HE in prompts.create_prompt(PACK, vibe="אוצר")  # no model named: unchanged


def test_opus_5_5_gets_neither_line_anywhere():
    model = "claude-opus-5.5"
    assert not prompts.steers_reasoning(model)
    for system in (prompts.builder_system_message("he", model=model), prompts.editor_system_message("he", model=model)):
        assert prompts.REASONING_LINE not in system and prompts.IDENTITY_CORE in system
    assert THINK_HE not in prompts.create_prompt(PACK, vibe="אוצר", model=model)
    assert THINK_HE not in prompts.edit_prompt("יותר צבע", "1| <html>", model=model)
    assert THINK_HE not in prompts.plan_prompt(PACK, "אוצר", model=model)


def test_a_filtered_reply_is_recognised_and_a_game_is_not():
    notice = "The model returned no content because the response was blocked by content filtering."
    assert copilot_session._is_content_filtered(notice, 0)
    assert not copilot_session._is_content_filtered(notice, 120)       # it wrote something
    assert not copilot_session._is_content_filtered("```html\n<html>…", 0)


def test_a_filtered_build_is_rebuilt_once_on_the_fallback_model(monkeypatch):
    seen: list[str] = []

    class FakeSession:
        def __init__(self, *, model, **_):
            self.model = model
        async def start(self): pass
        async def close(self): pass

    async def fake_delivery(session, state, progress, prompt, totals, spec, operation):
        seen.append(session.model)
        if session.model == "claude-opus-5.5":
            return copilot_session.CONTENT_FILTERED_ERROR
        state.accepted_html = "<html><script></script></html>"
        return None

    monkeypatch.setattr(pipeline, "HeadlessCopilotSession", FakeSession)
    monkeypatch.setattr(pipeline, "_run_text_delivery", fake_delivery)
    spec = pipeline.JobSpec(job_id="j", game_id="g", learner_id="l", kind="create", pack=PACK,
                            model="claude-opus-5.5", judge=False, plan=False)
    result = asyncio.run(pipeline.run_job(spec))
    assert seen == ["claude-opus-5.5", pipeline.CONTENT_FILTER_FALLBACK_MODEL]
    assert result.ok and result.model == pipeline.CONTENT_FILTER_FALLBACK_MODEL
    assert result.timings["filtered_model"] == "claude-opus-5.5"


def test_the_fallback_model_is_not_retried_on_itself(monkeypatch):
    calls: list[str] = []

    class FakeSession:
        def __init__(self, *, model, **_):
            self.model = model
        async def start(self): pass
        async def close(self): pass

    async def always_filtered(session, *a, **k):
        calls.append(session.model)
        return copilot_session.CONTENT_FILTERED_ERROR

    monkeypatch.setattr(pipeline, "HeadlessCopilotSession", FakeSession)
    monkeypatch.setattr(pipeline, "_run_text_delivery", always_filtered)
    spec = pipeline.JobSpec(job_id="j", game_id="g", learner_id="l", kind="create", pack=PACK,
                            model="claude-opus-5.5", judge=False, plan=False)
    result = asyncio.run(pipeline.run_job(spec))
    assert calls == ["claude-opus-5.5", pipeline.CONTENT_FILTER_FALLBACK_MODEL]
    assert not result.ok and result.error == copilot_session.CONTENT_FILTERED_ERROR
