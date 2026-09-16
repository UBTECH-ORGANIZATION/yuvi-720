from pathlib import Path

import pytest

from game_gen.validator import (
    ValidationResult,
    categorize_error,
    chromium_available,
    format_errors_for_fix_prompt,
    inject_into_head,
    validate_html_sync,
)

HARNESS_DIR = Path(__file__).resolve().parent.parent / "harness"

TINY_GAME = """<!DOCTYPE html>
<html lang="he"><head><meta charset="UTF-8"><title>tiny</title></head>
<body>
<button id="start-button">התחל</button>
<div id="hud">ניקוד: <span id="s">0</span></div>
<canvas id="c" width="400" height="300"></canvas>
<script>
const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
let t = 0, running = false, x = 200;
addEventListener('keydown', e => { if (e.code === 'ArrowRight') x += 40; });
function loop() {
  t++;
  ctx.fillStyle = '#123456'; ctx.fillRect(0, 0, 400, 300);
  ctx.fillStyle = '#ffcc00'; ctx.beginPath(); ctx.arc(x + Math.sin(t / 10) * 50, 150, 40, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.fillRect(t % 400, 20, 30, 30);
  requestAnimationFrame(loop);
}
loop();
document.getElementById('start-button').addEventListener('click', () => {
  running = true;
  localStorage.setItem('k', 'v');       // storage shim must not throw
  YuviStorage.set('score', 1);
});
</script>
</body></html>"""


def _harness_tags() -> str:
    return "".join(
        f"<script data-yuvi-harness=\"{name}\">{(HARNESS_DIR / name).read_text(encoding='utf-8')}</script>"
        for name in ("storage_shim.js", "error_reporter.js", "fit_to_frame.js")
    )


def test_inject_into_head_positions():
    assert inject_into_head("<html><head><title>x</title></head></html>", "<s>") \
        == "<html><head><s><title>x</title></head></html>"
    assert inject_into_head("<html><body></body></html>", "<s>") == "<html><head><s></head><body></body></html>"
    assert inject_into_head("<p>bare</p>", "<s>") == "<s><p>bare</p>"


def test_categorize_and_format():
    assert categorize_error("ReferenceError: foo is not defined")[0] == "scope"
    assert categorize_error("Cannot read properties of null (reading 'x')")[0] == "dom-timing"
    res = ValidationResult(ok=False, errors=[{"source": "post-interaction", "message": "x is not defined"}])
    text = format_errors_for_fix_prompt(res)
    assert "[post-interaction/scope]" in text
    assert "Start button" in text
    assert "contract" not in text.lower()
    assert format_errors_for_fix_prompt(ValidationResult(ok=True)) == ""
    assert ValidationResult(ok=True).play_score is None


@pytest.mark.slow
def test_validator_smoke_with_harness():
    if not chromium_available():
        pytest.skip("Playwright Chromium not installed")
    res = validate_html_sync(
        TINY_GAME,
        preinject_html=_harness_tags(),
        settle_ms=1000,
        interaction_settle_ms=1000,
    )
    assert res.validator_error is None
    assert res.errors == [], res.errors
    assert res.ok
    assert res.clicked_start
    assert res.heartbeat >= 30
    assert res.canvas_blank is False
    assert res.screenshot_png and res.screenshot_png[:8] == b"\x89PNG\r\n\x1a\n"
    assert set(res.play_score) == {"frames", "input_reacts", "dom_text"}
    assert res.play_score["frames"] > 0 and res.play_score["dom_text"] is True
    assert res.yuvi_state["learn"]["asked"] == 0


@pytest.mark.slow
def test_validator_catches_runtime_error_after_start():
    if not chromium_available():
        pytest.skip("Playwright Chromium not installed")
    broken = TINY_GAME.replace("running = true;", "undefinedThing.go();")
    res = validate_html_sync(broken, preinject_html=_harness_tags(), settle_ms=500, interaction_settle_ms=500)
    assert not res.ok
    assert any("undefinedThing" in e["message"] for e in res.errors)
    assert any(e["source"] == "post-interaction" for e in res.errors)


@pytest.mark.slow
def test_validator_flags_a_missing_harness():
    if not chromium_available():
        pytest.skip("Playwright Chromium not installed")
    bare = "<!DOCTYPE html><html><body><p>hi</p><script>document.body.style.color='red';</script></body></html>"
    res = validate_html_sync(bare, settle_ms=300, interaction_settle_ms=300, screenshot=False)
    assert not res.ok
    assert any(e["source"] == "harness" and "__yuvi" in e["message"] for e in res.errors)
