"""The opt-in YuviUI runtime: RTL-safe questions, dialogue, timers, combos, banners."""
import shutil
import subprocess

import pytest

from game_gen.harness import HARNESS_DIR, build_harness, inject_harness
from game_gen.validator import chromium_available, validate_html_sync

UI_PATH = HARNESS_DIR / "yuvi_ui.js"
LEARN_DATA = {"component": {"id": "c1", "title": "יחסים"}, "objective": {"id": "o1", "title": "צמצום יחס"}, "language": "he"}

# A Canvas game that, on Start, runs one UI round entirely from script: banner →
# ask (ratio, filled + submitted by the page itself) → combo → timer, and
# records what it saw at window.__yuvi.ui for the validator to hand back.
UI_GAME = """<!DOCTYPE html>
<html lang="he"><head><meta charset="UTF-8"><title>ui game</title>
<style>body{background:#1e1e2e}canvas{display:block}</style></head>
<body>
<canvas id="c"></canvas>
<script>
const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
canvas.width = innerWidth; canvas.height = innerHeight;
const ui = (window.__yuvi.ui = { rendered: false, bdiCount: 0, inputDir: null, result: null, learnAsked: 0,
  bannerShown: false, comboMult: 0, timerLeft: 0, timerHud: null, keyLeaked: false, mathHtml: '', dialogueDone: false, wrong: null });
let t = 0;
YuviKit.init({
  title: 'מפעל היחסים', subtitle: 'צמצמו יחסים', palette: ['#1e1e2e', '#f9e2af', '#89dceb'],
  hud: [{ id: 'score', label: 'ניקוד', value: 0 }, { id: 'time', label: 'זמן', value: 0 }],
  onStart: async () => {
    const frag = YuviUI.math('היחס 2:4 שווה ל-1:2');
    const tmp = document.createElement('div'); tmp.appendChild(frag); ui.mathHtml = tmp.innerHTML;
    YuviUI.banner(['שלב ', { ltr: '1' }, ' — יחסים'], 500);
    ui.bannerShown = !!document.querySelector('#yu-root .yu-banner');
    YuviKit.input.on('ArrowRight', () => { if (YuviUI.panel) ui.keyLeaked = true; });   // the validator holds ArrowRight later, with no panel open
    const p = YuviUI.ask({ parts: ['היחס הוא ', { ltr: '2:4' }, ' — כמה זה מצומצם?'], kind: 'ratio', correct: '1:2', reduce: true, hint: 'חלקו את שני המספרים' });
    const panel = YuviUI.panel;
    ui.rendered = !!panel && panel.isConnected;
    ui.bdiCount = panel ? panel.querySelectorAll('bdi[dir="ltr"]').length : 0;
    const inputs = panel ? panel.querySelectorAll('input') : [];
    ui.inputDir = inputs[0] ? inputs[0].getAttribute('dir') : null;
    ui.inputMode = inputs[0] ? inputs[0].getAttribute('inputmode') : null;
    ui.inputCount = inputs.length;
    // A key pressed while the panel is open (real keys target the focused element and bubble
    // through document to the kit's window listener) must not reach the kit's action handlers.
    document.body.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowRight', key: 'ArrowRight', bubbles: true }));
    inputs[0].value = '2'; inputs[1].value = '4';          // 2:4 reduces to 1:2 → accepted with reduce:true
    panel.querySelector('.yu-btn').click();
    ui.result = await p;
    ui.learnAsked = window.__yuvi.learn.asked;
    ui.learnCorrect = window.__yuvi.learn.correct;
    ui.panelClosed = !YuviUI.panel;
    const c = YuviUI.combo();
    c.hit(); c.hit(); ui.comboMult = c.hit({ x: 100, y: 100 });
    c.miss(); ui.comboAfterMiss = c.mult;
    const tm = YuviUI.timer({ seconds: 30, hudId: 'time' }).start();
    ui.timerLeft = tm.left; ui.timerHud = String(YuviKit.hud.get('time'));
    await YuviUI.dialogue([{ speaker: 'יובי', parts: ['כל הכבוד! ', { ltr: '1:2' }] }], { ms: 150 });
    ui.dialogueDone = true;
    const w = YuviUI.ask({ text: 'כמה זה 3 × 4?', kind: 'number', correct: 12, explain: ['זה ', { ltr: '3 × 4 = 12' }] });
    YuviUI.panel.querySelector('input').value = '7';
    YuviUI.panel.querySelector('.yu-btn').click();
    ui.wrong = await w;
  }
});
YuviKit.loop((dt) => {
  t += dt;
  ctx.fillStyle = '#123456'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = YuviKit.palette[1]; ctx.beginPath(); ctx.arc(200 + Math.sin(t * 3) * 40, 200, 40, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.fillRect((t * 120) % canvas.width, 300, 30, 30);
});
</script>
</body></html>"""


def _harness(nonce: str) -> str:
    frag = build_harness(LEARN_DATA, nonce=nonce)
    ui_js = UI_PATH.read_text(encoding="utf-8").replace("</script", "<\\/script")
    if "window.YuviUI" in frag:
        return frag                                  # the registry already ships it
    return frag + "\n<script>\n" + ui_js + "\n</script>"


def test_ui_stays_small_and_parses():
    src = UI_PATH.read_text(encoding="utf-8")
    assert len(src.splitlines()) <= 350, "YuviUI is meant to be small — trim before growing it"
    assert src.startswith("/*") and src.rstrip().endswith("})();")
    assert "</script" not in src
    for s in ("אישור", "موافق", "'OK'", "נכון!", "صحيح!", "Correct!", "לא בדיוק", "ليس تمامًا", "Not quite"):
        assert s in src, s
    node = shutil.which("node")
    if not node:
        pytest.skip("node not installed")
    subprocess.run([node, "--check", str(UI_PATH)], check=True, timeout=30)


def test_ui_is_injected_after_the_kit():
    html = inject_harness("<!DOCTYPE html><html><head><title>x</title></head><body></body></html>", _harness("n0"))
    assert html.index("window.YuviKit = {") < html.index("window.YuviUI = {")


@pytest.mark.slow
def test_ui_round_passes_validation():
    if not chromium_available():
        pytest.skip("Playwright Chromium not installed")
    res = validate_html_sync(UI_GAME, preinject_html=_harness("n5"), settle_ms=600, interaction_settle_ms=4500, screenshot=False)
    assert res.validator_error is None
    assert res.errors == [], res.errors
    assert res.ok and res.clicked_start
    assert res.heartbeat > 0
    ui = res.yuvi_state["ui"]
    assert ui["rendered"] is True
    assert ui["bdiCount"] >= 1, "the {ltr:'2:4'} part must render as <bdi dir=ltr>"
    assert ui["inputDir"] == "ltr" and ui["inputMode"] == "decimal" and ui["inputCount"] == 2
    assert ui["result"]["correct"] is True and ui["result"]["answer"] == "2:4"
    assert ui["result"]["elapsed"] >= 0
    assert ui["bannerShown"] is True
    assert ui["keyLeaked"] is False, "keys must not reach YuviKit.input while a panel is open"
    assert ui["panelClosed"] is True
    assert ui["comboMult"] == 2 and ui["comboAfterMiss"] == 1
    assert ui["timerLeft"] == 30 and "0:30" in ui["timerHud"]
    assert ui["dialogueDone"] is True
    assert ui["wrong"]["correct"] is False and ui["wrong"]["answer"] == "7"
    learn = res.yuvi_state["learn"]
    assert ui["learnAsked"] == 1, "YuviLearn.mount must count the question exactly once"
    assert ui["learnCorrect"] == 1
    assert learn["asked"] == 2 and learn["answered"] == 2 and learn["correct"] == 1
    assert "<bdi dir=\"ltr\">2:4</bdi>" in ui["mathHtml"] and "<bdi dir=\"ltr\">1:2</bdi>" in ui["mathHtml"]
