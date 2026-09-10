"""Pipeline tests with a fake Copilot session: the 'model' replies from a
script, routed by system message (builder / plan / judge). The real
validator runs (Chromium) for the happy paths; the judge and revision tests
stub the validator so they run anywhere."""
from __future__ import annotations

import asyncio
import json

import pytest

from game_gen import pipeline, prompts
from game_gen.context_pack import build_context_pack
from game_gen.copilot_session import TurnResult, TurnUsage
from game_gen.validator import ValidationResult, chromium_available

pytestmark = pytest.mark.slow

TINY_GAME = """<!DOCTYPE html><html lang="he"><head><meta charset="utf-8"><title>t</title>
<style>html,body{margin:0;height:100%}canvas{width:100vw;height:100vh;display:block}#q{position:fixed;inset:0;display:none;background:#fff}</style></head>
<body><button id="start-button">התחל</button><canvas id="c"></canvas><div id="q"></div>
<script>
const c=document.getElementById('c'),x=c.getContext('2d');let t=0,run=false;
function loop(){t++;c.width=innerWidth;c.height=innerHeight;x.fillStyle='#123';x.fillRect(0,0,c.width,c.height);x.fillStyle='#f80';x.fillRect((t*3)%c.width,50,60,60);requestAnimationFrame(loop);}loop();
document.getElementById('start-button').onclick=async()=>{run=true;const d=document.getElementById('q');d.style.display='block';const r=await YuviLearn.mount({text:'מהי מסה?',answers:['כמות חומר','נפח'],correct:0},d);d.style.display='none';await YuviLearn.progress({score:r.correct?10:0});};
</script></body></html>"""

BROKEN_GAME = TINY_GAME.replace("YuviLearn.mount(", "YuviLearn.nope(")

GOOD_VERDICT = {"learning_through_play": 5, "fun": 4, "polish": 4, "age_fit": 5, "notes": "טוב", "top_fix": "כלום"}
LOW_VERDICT = {"learning_through_play": 1, "fun": 2, "polish": 2, "age_fit": 4, "notes": "חידון", "top_fix": "שים את המסה על הארגזים"}


def _spec(kind="create", **kw):
    context = {
        "component": {"id": "c1", "title": "מסה", "purpose": "both"},
        "unit": {"id": "u1", "title": "יחידה", "subject": "science"},
        "objective": {"id": "o1", "title": "מסה", "curriculum_title": "כיתה ח"},
        "learning_description": "הילד לומד שמסה כוללת = מסת האריזה + מסת התכולה.",
    }
    pack = build_context_pack(context, language="he")
    kw.setdefault("judge", False)
    kw.setdefault("plan", False)
    return pipeline.JobSpec(job_id="j1", game_id="g1", learner_id="l1", kind=kind, pack=pack, genre="shooter", vibe="x", **kw)


def _turn(text: str, out: int = 500) -> TurnResult:
    return TurnResult(text=text, usage=TurnUsage(input_tokens=1000, output_tokens=out, model="fake"),
                      model="fake", elapsed_s=0.1, stop_reason="idle")


class FakeSession:
    """Stands in for HeadlessCopilotSession. `script` is the builder's replies
    (a list of ("submit_game", params) for compatibility; the name is ignored),
    `judge_replies` the judge's JSON replies in order, `plan_reply` the pitch,
    `revision_reply` the answer to the judge's revision request."""
    script = []
    judge_replies = []
    plan_reply = ""
    revision_reply = ""
    instances = []
    prompts = []
    judge_prompts = []
    plan_prompts = []

    def __init__(self, **kw):
        self.kw = kw
        self.model_billing = None
        FakeSession.instances.append(self)

    async def start(self):
        pass

    async def send(self, prompt):
        system = self.kw.get("system_message")
        if system == prompts.JUDGE_SYSTEM:
            FakeSession.judge_prompts.append(prompt)
            reply = FakeSession.judge_replies.pop(0) if FakeSession.judge_replies else json.dumps(GOOD_VERDICT)
            return _turn(reply, 50)
        if system == prompts.PLAN_SYSTEM:
            FakeSession.plan_prompts.append(prompt)
            return _turn(FakeSession.plan_reply, 200)
        FakeSession.prompts.append(prompt)
        if "A reviewer played your game" in prompt:
            return _turn(FakeSession.revision_reply)
        name, params = FakeSession.script[min(len(FakeSession.prompts) - 1, len(FakeSession.script) - 1)]
        body = params.get("html", "")
        text = (f"TITLE: {params.get('title', '')}\nBRIEF: {params.get('design_brief', 'עולם')}\n"
                f"SUMMARY: {params.get('learning_summary', '')}\n```html\n{body}\n```\n")
        return _turn(text)

    async def close(self):
        pass


@pytest.fixture(autouse=True)
def fake_session(monkeypatch):
    FakeSession.instances = []
    FakeSession.prompts = []
    FakeSession.judge_prompts = []
    FakeSession.plan_prompts = []
    FakeSession.judge_replies = []
    FakeSession.plan_reply = ""
    FakeSession.revision_reply = ""
    monkeypatch.setattr(pipeline, "HeadlessCopilotSession", FakeSession)
    yield


@pytest.fixture
def stub_validator(monkeypatch):
    """A validator that passes unless the page mentions `undefinedThing`."""
    async def fake_validate(html, **kw):
        if "undefinedThing" in html:
            return ValidationResult(ok=False, errors=[{"source": "pageerror", "message": "undefinedThing is not defined"}],
                                    heartbeat=60, play_score={"frames": 30, "input_reacts": True, "dom_text": True})
        return ValidationResult(ok=True, heartbeat=90, screenshot_png=b"png",
                                play_score={"frames": 40, "input_reacts": True, "dom_text": True})

    monkeypatch.setattr(pipeline, "validate_html", fake_validate)


@pytest.mark.skipif(not chromium_available(), reason="Chromium not installed")
def test_create_accepts_valid_game_on_first_submission():
    FakeSession.script = [("submit_game", {"html": TINY_GAME, "title": "משחק", "learning_summary": "המסה היא המכניקה"})]
    result = asyncio.run(pipeline.run_job(_spec()))
    assert result.ok, result.error
    assert result.html and "__YUVI_LEARN_DATA" not in result.html  # harness is NOT baked into stored html
    a = result.attempts[0]
    assert len(result.attempts) == 1 and a.ok and a.reason == "ok"
    assert set(a.play_score) == {"frames", "input_reacts", "dom_text"} and a.html_lines > 3
    assert a.model_s == 0.1 and a.output_tokens == 500 and a.error_classes == []
    assert result.screenshot_png
    assert result.usage.output_tokens == 500 and "game.build" in result.usage.by_operation
    assert FakeSession.instances[0].kw["tools"] == []  # text delivery: no tools
    assert result.timings["model_s"] == [0.1] and len(result.timings["validate_s"]) == 1
    assert result.timings["plan_s"] == 0.0 and result.timings["total_s"] > 0
    assert result.judge is None


@pytest.mark.skipif(not chromium_available(), reason="Chromium not installed")
def test_create_rejects_broken_then_accepts_fixed():
    FakeSession.script = [
        ("submit_game", {"html": BROKEN_GAME, "title": "x", "learning_summary": "x"}),
        ("submit_game", {"html": TINY_GAME, "title": "x", "learning_summary": "x"}),
    ]
    result = asyncio.run(pipeline.run_job(_spec()))
    assert result.ok
    assert [a.ok for a in result.attempts] == [False, True]
    assert result.attempts[0].error_classes and "nope" in result.attempts[0].reason
    assert "runtime problem" in FakeSession.prompts[1]


def test_incomplete_html_is_rejected_without_validator():
    FakeSession.script = [("submit_game", {"html": "<div>hi</div>", "title": "x", "learning_summary": "x"})]
    result = asyncio.run(pipeline.run_job(_spec()))
    assert not result.ok and result.error == "no_valid_submission"
    assert result.attempts[0].reason == "incomplete" and result.attempts[0].error_classes == ["incomplete"]
    assert result.attempts[0].as_detail()["n"] == 1


@pytest.mark.skipif(not chromium_available(), reason="Chromium not installed")
def test_edit_applies_a_text_patch():
    class TextSession(FakeSession):
        async def send(self, prompt):
            FakeSession.prompts.append(prompt)
            return _turn("SUMMARY: שיניתי כותרת\nREPLACE_LINES 1-1\n<!DOCTYPE html><html lang=\"he\"><head><meta charset=\"utf-8\"><title>edited</title>\nEND_REPLACE\n")

    pipeline.HeadlessCopilotSession = TextSession  # type: ignore[attr-defined]
    result = asyncio.run(pipeline.run_job(_spec(kind="edit", instruction="שנה כותרת", current_html=TINY_GAME)))
    assert result.ok, result.error
    assert "<title>edited</title>" in result.html
    assert result.summary == "שיניתי כותרת"
    assert TextSession.instances[0].kw["tools"] == []
    assert "CURRENT GAME (line-numbered)" in FakeSession.prompts[0]


@pytest.mark.skipif(not chromium_available(), reason="Chromium not installed")
def test_output_cap_without_a_submission_gets_one_shrink_retry(monkeypatch):
    """A turn that burns the output budget with no game means the game did
    not fit one reply: the pipeline asks once for a smaller game."""
    class CappedSession(FakeSession):
        prompts_seen = []

        async def send(self, prompt):
            CappedSession.prompts_seen.append(prompt)
            if len(CappedSession.prompts_seen) == 1:
                return _turn("", 32000)
            return await super().send(prompt)

    monkeypatch.setattr(pipeline, "HeadlessCopilotSession", CappedSession)
    FakeSession.script = [("submit_game", {"html": TINY_GAME, "title": "משחק", "learning_summary": "x"})]
    result = asyncio.run(pipeline.run_job(_spec()))
    assert result.ok, result.error
    assert len(CappedSession.prompts_seen) == 2
    assert CappedSession.prompts_seen[1] == pipeline.prompts.SHRINK_PROMPT
    assert result.usage.output_tokens == 32500


@pytest.mark.skipif(not chromium_available(), reason="Chromium not installed")
def test_text_delivery_parses_meta_lines_and_retries_an_incomplete_reply():
    FakeSession.script = [
        ("submit_game", {"html": "<p>not a game</p>", "title": "x", "learning_summary": "y"}),
        ("submit_game", {"html": TINY_GAME, "title": "משחק", "learning_summary": "המסה היא המכניקה", "design_brief": "עולם חלל"}),
    ]
    result = asyncio.run(pipeline.run_job(_spec()))
    assert result.ok, result.error
    assert result.title == "משחק" and result.design_brief == "עולם חלל" and result.summary == "המסה היא המכניקה"
    assert len(FakeSession.prompts) == 2 and "COMPLETE game in ONE ```html block" in FakeSession.prompts[1]
    assert [a.ok for a in result.attempts] == [False, True] and result.attempts[0].reason == "incomplete"


def test_parse_text_delivery_reads_only_the_prose_before_the_fence():
    parsed = pipeline.parse_text_delivery(
        "TITLE: חלל\nBRIEF: עולם\nSUMMARY: שער\n```html\n<!DOCTYPE html><html><body>TITLE: no<script>1</script></body></html>\n```"
    )
    assert parsed["title"] == "חלל" and parsed["brief"] == "עולם" and parsed["summary"] == "שער"
    assert parsed["html"].startswith("<!DOCTYPE html>")


# ── Plan pass and judge v2 (validator stubbed: no Chromium needed) ──

def test_plan_pass_feeds_design_doc(stub_validator):
    FakeSession.plan_reply = "HOOK: ספינת מטען שחייבת לזרוק אריזה, לא מטען.\nWORLD & LOOK: חלל כחול."
    FakeSession.script = [("submit_game", {"html": TINY_GAME, "title": "משחק", "learning_summary": "x"})]
    events = []
    result = asyncio.run(pipeline.run_job(_spec(plan=True), events.append))
    assert result.ok, result.error
    assert len(FakeSession.plan_prompts) == 1 and "LEARNING — make this the mechanic" in FakeSession.plan_prompts[0]
    plan_session = next(s for s in FakeSession.instances if s.kw.get("system_message") == prompts.PLAN_SYSTEM)
    assert plan_session.kw["model"] == pipeline.PLAN_MODEL and plan_session.kw["system_mode"] == "replace"
    build_prompt = FakeSession.prompts[0]
    assert "PITCH (a strong starting point" in build_prompt and "ספינת מטען" in build_prompt
    plan_events = [e for e in events if e["type"] == "plan"]
    assert [e["status"] for e in plan_events] == ["start", "done"] and plan_events[1]["text"].startswith("HOOK")
    assert "game.plan" in result.usage.by_operation and result.timings["plan_s"] >= 0


def test_plan_failure_leaves_the_builder_without_a_pitch(stub_validator):
    class NoPlan(FakeSession):
        async def send(self, prompt):
            if self.kw.get("system_message") == prompts.PLAN_SYSTEM:
                raise RuntimeError("mini model down")
            return await super().send(prompt)

    pipeline.HeadlessCopilotSession = NoPlan  # type: ignore[attr-defined]
    FakeSession.script = [("submit_game", {"html": TINY_GAME, "title": "משחק", "learning_summary": "x"})]
    result = asyncio.run(pipeline.run_job(_spec(plan=True)))
    assert result.ok and "PITCH" not in FakeSession.prompts[0]


def test_judge_verdict_lands_on_result(stub_validator):
    FakeSession.judge_replies = ["Here you go:\n" + json.dumps(GOOD_VERDICT)]
    FakeSession.script = [("submit_game", {"html": TINY_GAME, "title": "משחק", "learning_summary": "x", "design_brief": "עולם"})]
    events = []
    result = asyncio.run(pipeline.run_job(_spec(judge=True), events.append))
    assert result.ok, result.error
    assert result.judge == {
        "scores": {"learning_through_play": 5.0, "fun": 4.0, "polish": 4.0, "age_fit": 5.0},
        "notes": "טוב", "top_fix": "כלום", "revised": False, "before": None, "model": pipeline.JUDGE_MODEL,
    }
    assert len(FakeSession.prompts) == 1  # no revision for a good verdict
    facts = FakeSession.judge_prompts[0]
    # The judge runs alongside the validator (it starts the moment a
    # candidate arrives), so it sees the title and brief but not the play
    # score, which only exists once Playwright is done.
    assert "CHECKER FACTS" in facts and "TITLE: משחק" in facts and "BRIEF: עולם" in facts
    assert result.timings["judge_s"] >= 0 and result.timings["revise_s"] == 0.0
    assert [e["status"] for e in events if e["type"] == "judge"] == ["start", "done"]


def test_low_judge_triggers_one_revision_and_keeps_original_on_failure(stub_validator):
    FakeSession.judge_replies = [json.dumps(LOW_VERDICT)]
    FakeSession.revision_reply = "SUMMARY: ניסיתי\nINSERT_AFTER 4\nundefinedThing.go();\nEND_INSERT\n"
    FakeSession.script = [("submit_game", {"html": TINY_GAME, "title": "משחק", "learning_summary": "x"})]
    events = []
    result = asyncio.run(pipeline.run_job(_spec(judge=True), events.append))
    assert result.ok, result.error
    assert "undefinedThing" not in result.html            # the original stands
    assert result.title == "משחק" and result.summary == "x"
    assert len(FakeSession.prompts) == 2 and "שים את המסה על הארגזים" in FakeSession.prompts[1]
    assert "CURRENT GAME (line-numbered)" in FakeSession.prompts[1]
    assert [a.ok for a in result.attempts] == [True, False]
    assert result.judge["scores"]["learning_through_play"] == 1.0 and result.judge["revised"] is False
    assert len(FakeSession.judge_prompts) == 1          # no re-judge without a validated revision
    assert result.timings["revise_s"] >= 0 and result.timings["rejudge_s"] == 0.0
    revise = [e for e in events if e["type"] == "revise"]
    assert revise[0]["status"] == "start" and revise[0]["html"] and revise[-1] == {"type": "revise", "status": "done", "revised": False}


def test_low_judge_revision_that_validates_is_rejudged(stub_validator):
    FakeSession.judge_replies = [json.dumps(LOW_VERDICT), json.dumps(GOOD_VERDICT)]
    FakeSession.revision_reply = "SUMMARY: הוספתי\nREPLACE_LINES 1-1\n<!DOCTYPE html><html lang=\"he\"><head><meta charset=\"utf-8\"><title>revised</title>\nEND_REPLACE\n"
    FakeSession.script = [("submit_game", {"html": TINY_GAME, "title": "משחק", "learning_summary": "x"})]
    result = asyncio.run(pipeline.run_job(_spec(judge=True)))
    assert result.ok and "<title>revised</title>" in result.html
    assert result.summary == "x"                          # the create's summary, not the patch's
    assert result.judge["revised"] is True and result.judge["scores"]["fun"] == 4.0
    assert result.judge["before"]["scores"]["learning_through_play"] == 1.0 and result.judge["before"]["top_fix"] == LOW_VERDICT["top_fix"]
    assert len(FakeSession.judge_prompts) == 2 and result.timings["rejudge_s"] >= 0
    assert "game.revise" in result.usage.by_operation


def test_edits_are_judged_for_the_record_only(stub_validator):
    class TextSession(FakeSession):
        async def send(self, prompt):
            if self.kw.get("system_message") == prompts.JUDGE_SYSTEM:
                return await super().send(prompt)
            FakeSession.prompts.append(prompt)
            return _turn("SUMMARY: x\nREPLACE_LINES 1-1\n<!DOCTYPE html><html><head><title>e</title>\nEND_REPLACE\n")

    pipeline.HeadlessCopilotSession = TextSession  # type: ignore[attr-defined]
    FakeSession.judge_replies = [json.dumps(LOW_VERDICT)]
    result = asyncio.run(pipeline.run_job(_spec(kind="edit", instruction="x", current_html=TINY_GAME, judge=True)))
    assert result.ok and result.judge["scores"]["fun"] == 2.0 and result.judge["revised"] is False
    assert len(FakeSession.prompts) == 1


def test_needs_revision_thresholds():
    assert pipeline.needs_revision({"learning_through_play": 2, "fun": 5, "polish": 5})
    assert pipeline.needs_revision({"learning_through_play": 4, "fun": 2, "polish": 2})
    assert not pipeline.needs_revision({"learning_through_play": 3, "fun": 2, "polish": 3})
    assert not pipeline.needs_revision({})
    rec = pipeline.judge_record({"error": "no_json"}, "m")
    assert rec["scores"] == {} and rec["error"] == "no_json" and not pipeline.needs_revision(rec["scores"])


# ── Edits as reply text: patches, then SEARCH/REPLACE, then a full game ──

NUMBERED_SRC = "<!DOCTYPE html><html><head><title>a</title></head>\n<body>\n<script>\nlet x = 1;\nfunction f() { return x; }\n</script>\n</body></html>"


def test_parse_edit_delivery_applies_line_patches_and_reads_the_summary():
    reply = "SUMMARY: שיניתי את הכותרת\nREPLACE_LINES 1-1\n<!DOCTYPE html><html><head><title>b</title></head>\nEND_REPLACE\nINSERT_AFTER 4\nlet y = 2;\nEND_INSERT"
    parsed = pipeline.parse_edit_delivery(reply, NUMBERED_SRC)
    assert parsed["mode"] == "patch" and parsed["error"] is None
    assert parsed["summary"] == "שיניתי את הכותרת"
    assert "<title>b</title>" in parsed["html"] and "let y = 2;" in parsed["html"]
    assert len(parsed["ops"]) == 2


def test_parse_edit_delivery_falls_back_to_a_full_block_and_reports_bad_patches():
    full = "SUMMARY: rewrite\n```html\n<!DOCTYPE html><html><body><script>let z=1;</script></body></html>\n```"
    parsed = pipeline.parse_edit_delivery(full, NUMBERED_SRC)
    assert parsed["mode"] == "rewrite" and "let z=1" in parsed["html"]
    bad = "SUMMARY: x\nREPLACE_LINES 90-95\nnope\nEND_REPLACE"
    parsed = pipeline.parse_edit_delivery(bad, NUMBERED_SRC)
    assert parsed["html"] is None and parsed["mode"] == "patch" and "total lines" in parsed["error"]
    nothing = pipeline.parse_edit_delivery("I think the game is fine.", NUMBERED_SRC)
    assert nothing["html"] is None and nothing["mode"] == "none"


def test_edit_asks_once_for_the_full_game_when_patches_do_not_apply():
    """A patch that cannot be applied gets exactly one 'send the whole game'
    request; a second failure ends the job instead of looping."""
    class TextSession(FakeSession):
        replies = ["SUMMARY: x\nREPLACE_LINES 900-901\nnope\nEND_REPLACE", "SUMMARY: y\nstill nothing"]
        prompts_seen = []

        async def send(self, prompt):
            TextSession.prompts_seen.append(prompt)
            text = TextSession.replies[min(len(TextSession.prompts_seen) - 1, len(TextSession.replies) - 1)]
            return _turn(text, 10)

    pipeline.HeadlessCopilotSession = TextSession  # type: ignore[attr-defined]
    try:
        result = asyncio.run(pipeline.run_job(_spec(kind="edit", instruction="שנה", current_html=TINY_GAME)))
    finally:
        pipeline.HeadlessCopilotSession = FakeSession  # type: ignore[attr-defined]
    assert not result.ok
    assert len(TextSession.prompts_seen) == 2
    assert "COMPLETE updated game" in TextSession.prompts_seen[1]
    assert TextSession.instances[-1].kw["tools"] == []
    assert result.attempts[0].reason == "patch" and result.attempts[0].error_classes == ["no_delivery"]
