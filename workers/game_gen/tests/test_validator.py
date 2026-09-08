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
<canvas id="c" width="400" height="300"></canvas>
<script>
const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
let t = 0, running = false;
function loop() {
  t++;
  ctx.fillStyle = '#123456'; ctx.fillRect(0, 0, 400, 300);
  ctx.fillStyle = '#ffcc00'; ctx.beginPath(); ctx.arc(200 + Math.sin(t / 10) * 50, 150, 40, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.fillRect(t % 400, 20, 30, 30);
  requestAnimationFrame(loop);
}
loop();
document.getElementById('start-button').addEventListener('click', () => {
  running = true;
  window.__yuvi.learn.asked += 1;      // the game asks its first question
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
    res = ValidationResult(ok=False, errors=[{"source": "post-interaction", "message": "x is not defined"}],
                           contract_ok=False, contract_reason="learn.asked stayed 0 for 20s")
    text = format_errors_for_fix_prompt(res)
    assert "[post-interaction/scope]" in text
    assert "Start button" in text
    assert "[contract]" in text
    assert format_errors_for_fix_prompt(ValidationResult(ok=True, contract_ok=True)) == ""


@pytest.mark.slow
def test_validator_smoke_with_harness():
    if not chromium_available():
        pytest.skip("Playwright Chromium not installed")
    res = validate_html_sync(
        TINY_GAME,
        preinject_html=_harness_tags(),
        settle_ms=1000,
        interaction_settle_ms=1000,
        contract_timeout_s=5,
    )
    assert res.validator_error is None
    assert res.errors == [], res.errors
    assert res.ok
    assert res.clicked_start
    assert res.contract_ok, res.contract_reason
    assert res.heartbeat >= 30
    assert res.canvas_blank is False
    assert res.screenshot_png and res.screenshot_png[:8] == b"\x89PNG\r\n\x1a\n"
    assert res.yuvi_state["learn"]["asked"] == 1


@pytest.mark.slow
def test_validator_catches_runtime_error_and_missing_contract():
    if not chromium_available():
        pytest.skip("Playwright Chromium not installed")
    broken = TINY_GAME.replace("window.__yuvi.learn.asked += 1;", "undefinedThing.go();")
    res = validate_html_sync(broken, preinject_html=_harness_tags(),
                             settle_ms=500, interaction_settle_ms=500, contract_timeout_s=1)
    assert not res.ok
    assert any("undefinedThing" in e["message"] for e in res.errors)
    assert any(e["source"] == "post-interaction" for e in res.errors)
    assert not res.contract_ok
