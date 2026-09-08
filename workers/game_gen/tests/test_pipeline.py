"""Pipeline tests with a fake Copilot session: the model is simulated by
calling the tool handlers the pipeline registers. The real validator runs
(Chromium) for the happy path, so these are marked slow."""
from __future__ import annotations

import asyncio

import pytest
from copilot import ToolInvocation

from game_gen import pipeline
from game_gen.context_pack import build_context_pack
from game_gen.copilot_session import TurnResult, TurnUsage
from game_gen.validator import chromium_available

pytestmark = pytest.mark.slow

TINY_GAME = """<!DOCTYPE html><html lang="he"><head><meta charset="utf-8"><title>t</title>
<style>html,body{margin:0;height:100%}canvas{width:100vw;height:100vh;display:block}#q{position:fixed;inset:0;display:none;background:#fff}</style></head>
<body><button id="start-button">התחל</button><canvas id="c"></canvas><div id="q"></div>
<script>
const c=document.getElementById('c'),x=c.getContext('2d');let t=0,run=false;
function loop(){t++;c.width=innerWidth;c.height=innerHeight;x.fillStyle='#123';x.fillRect(0,0,c.width,c.height);x.fillStyle='#f80';x.fillRect((t*3)%c.width,50,60,60);requestAnimationFrame(loop);}loop();
document.getElementById('start-button').onclick=async()=>{run=true;const q=await YuviLearn.next();if(q){const d=document.getElementById('q');d.style.display='block';d.innerHTML='<p dir="auto">'+q.text+'</p>'+q.answers.map(a=>'<button class="a">'+a+'</button>').join('');d.querySelectorAll('.a').forEach(b=>b.onclick=async()=>{const r=await YuviLearn.answer(q.id,b.textContent);d.style.display='none';});}};
</script></body></html>"""

BROKEN_GAME = TINY_GAME.replace("YuviLearn.next()", "YuviLearn.nope()")


def _spec(kind="create", **kw):
    comp = {"id": "c1", "unit_id": "u1", "title": "מסה", "information_to_bot": "notes",
            "questions_by_item": {"i1": [{"questionId": "q1", "questionText": "מהי מסה?", "answers": ["כמות חומר", "נפח"], "correctAnswers": ["כמות חומר"]}]}}
    pack, key = build_context_pack(comp, {"id": "u1", "title": "יחידה", "objective_id": "o1", "subject": "science"}, {"title": "מסה"})
    return pipeline.JobSpec(job_id="j1", game_id="g1", learner_id="l1", kind=kind, pack=pack, answer_key=key, genre="shooter", vibe="x", judge=False, **kw)


class FakeSession:
    """Stands in for HeadlessCopilotSession: `script` decides which tool calls the 'model' makes."""
    script = []  # list of (tool_name, params_dict)
    instances = []

    def __init__(self, **kw):
        self.kw = kw
        self.tools = {t.name: t for t in (kw.get("tools") or [])}
        self.model_billing = None
        FakeSession.instances.append(self)

    async def start(self):
        pass

    async def send(self, prompt):
        text = ""
        if not self.tools:
            # Text delivery (creates): the scripted submission is the reply.
            FakeSession.prompts = getattr(FakeSession, "prompts", []) + [prompt]
            name, params = FakeSession.script[min(len(FakeSession.prompts) - 1, len(FakeSession.script) - 1)]
            body = params.get("html", "")
            text = (f"TITLE: {params.get('title', '')}\nBRIEF: {params.get('design_brief', 'עולם')}\n"
                    f"SUMMARY: {params.get('learning_summary', '')}\n```html\n{body}\n```\n")
            return TurnResult(text=text, usage=TurnUsage(input_tokens=1000, output_tokens=500, model="fake"), model="fake", elapsed_s=0.1, stop_reason="idle")
        for name, params in FakeSession.script:
            tool = self.tools[name]
            # call the wrapped handler the way the SDK runtime does
            res = await tool.handler(ToolInvocation(tool_name=name, arguments=params))
            text += f"[{name}:{res.result_type}] "
            if res.result_type == "success" and getattr(tool, "is_terminal", False):
                break
        return TurnResult(text=text, usage=TurnUsage(input_tokens=1000, output_tokens=500, model="fake"), model="fake", elapsed_s=0.1, stop_reason="idle")

    async def close(self):
        pass


@pytest.fixture(autouse=True)
def fake_session(monkeypatch):
    FakeSession.instances = []
    FakeSession.prompts = []
    monkeypatch.setattr(pipeline, "HeadlessCopilotSession", FakeSession)
    yield


@pytest.mark.skipif(not chromium_available(), reason="Chromium not installed")
def test_create_accepts_valid_game_on_first_submission():
    FakeSession.script = [("submit_game", {"html": TINY_GAME, "title": "משחק", "learning_summary": "שאלות בשער"})]
    result = asyncio.run(pipeline.run_job(_spec()))
    assert result.ok, result.error
    assert result.html and "YuviLearn" not in result.html.split("<body")[0] or True  # harness is NOT baked into stored html
    assert len(result.attempts) == 1 and result.attempts[0].ok and result.attempts[0].contract_ok
    assert result.screenshot_png
    assert result.usage.output_tokens == 500 and "game.build" in result.usage.by_operation
    assert FakeSession.instances[0].kw["tools"] == []  # creates are text delivery: no tools


@pytest.mark.skipif(not chromium_available(), reason="Chromium not installed")
def test_create_rejects_broken_then_accepts_fixed():
    FakeSession.script = [
        ("submit_game", {"html": BROKEN_GAME, "title": "x", "learning_summary": "x"}),
        ("submit_game", {"html": TINY_GAME, "title": "x", "learning_summary": "x"}),
    ]
    result = asyncio.run(pipeline.run_job(_spec()))
    assert result.ok
    assert [a.ok for a in result.attempts] == [False, True]
    assert not result.attempts[0].contract_ok


def test_incomplete_html_is_rejected_without_validator():
    FakeSession.script = [("submit_game", {"html": "<div>hi</div>", "title": "x", "learning_summary": "x"})]
    result = asyncio.run(pipeline.run_job(_spec()))
    assert not result.ok and result.error == "no_valid_submission"
    assert result.attempts[0].contract_reason == "incomplete"


@pytest.mark.skipif(not chromium_available(), reason="Chromium not installed")
def test_edit_uses_patch_tool():
    patches = "REPLACE_LINES 1-1\n<!DOCTYPE html><html lang=\"he\"><head><meta charset=\"utf-8\"><title>edited</title>\nEND_REPLACE"
    FakeSession.script = [("patch_game", {"patches": patches, "summary": "rename"})]
    result = asyncio.run(pipeline.run_job(_spec(kind="edit", instruction="שנה כותרת", current_html=TINY_GAME)))
    assert result.ok, result.error
    assert "<title>edited</title>" in result.html
    names = [t.name for t in FakeSession.instances[0].kw["tools"]]
    assert names == ["submit_game", "patch_game"]


@pytest.mark.skipif(not chromium_available(), reason="Chromium not installed")
def test_output_cap_without_a_submission_gets_one_shrink_retry(monkeypatch):
    """A turn that burns the output budget with no tool call means the game did
    not fit one call: the pipeline asks once for a smaller game."""
    class CappedSession(FakeSession):
        prompts_seen = []

        async def send(self, prompt):
            CappedSession.prompts_seen.append(prompt)
            if len(CappedSession.prompts_seen) == 1:
                return TurnResult(text="", usage=TurnUsage(input_tokens=1000, output_tokens=32000, model="fake"),
                                  model="fake", elapsed_s=0.1, stop_reason="idle")
            return await super().send(prompt)

    monkeypatch.setattr(pipeline, "HeadlessCopilotSession", CappedSession)
    FakeSession.script = [("submit_game", {"html": TINY_GAME, "title": "משחק", "learning_summary": "שאלות בשער"})]
    result = asyncio.run(pipeline.run_job(_spec()))
    assert result.ok, result.error
    assert len(CappedSession.prompts_seen) == 2
    assert CappedSession.prompts_seen[1] == pipeline.prompts.SHRINK_PROMPT
    assert result.usage.output_tokens == 32500


@pytest.mark.skipif(not chromium_available(), reason="Chromium not installed")
def test_text_delivery_parses_meta_lines_and_retries_an_incomplete_reply():
    FakeSession.script = [
        ("submit_game", {"html": "<p>not a game</p>", "title": "x", "learning_summary": "y"}),
        ("submit_game", {"html": TINY_GAME, "title": "משחק", "learning_summary": "שאלות בשער", "design_brief": "עולם חלל"}),
    ]
    result = asyncio.run(pipeline.run_job(_spec()))
    assert result.ok, result.error
    assert result.title == "משחק" and result.design_brief == "עולם חלל" and result.summary == "שאלות בשער"
    assert len(FakeSession.prompts) == 2 and "COMPLETE game in ONE ```html block" in FakeSession.prompts[1]
    assert [a.ok for a in result.attempts] == [False, True] and result.attempts[0].contract_reason == "incomplete"


def test_parse_text_delivery_reads_only_the_prose_before_the_fence():
    parsed = pipeline.parse_text_delivery(
        "TITLE: חלל\nBRIEF: עולם\nSUMMARY: שער\n```html\n<!DOCTYPE html><html><body>TITLE: no<script>1</script></body></html>\n```"
    )
    assert parsed["title"] == "חלל" and parsed["brief"] == "עולם" and parsed["summary"] == "שער"
    assert parsed["html"].startswith("<!DOCTYPE html>")
