"""The serve-time harness and the YuviKit runtime it injects last."""
import shutil
import subprocess
from pathlib import Path

import pytest

from game_gen.harness import HARNESS_DIR, build_harness, inject_harness
from game_gen.validator import chromium_available, validate_html_sync

KIT_PATH = HARNESS_DIR / "yuvi_kit.js"
LEARN_DATA = {"component": {"id": "c1", "title": "מסה"}, "objective": {"id": "o1", "title": "נטו וברוטו"}, "language": "he"}

# A game that uses only the kit for its boilerplate; the validator clicks the
# kit's Start button and plays for ~2 s.
KIT_GAME = """<!DOCTYPE html>
<html lang="he"><head><meta charset="UTF-8"><title>kit game</title>
<style>body{background:#1e1e2e}canvas{display:block}</style></head>
<body>
<canvas id="c"></canvas>
<script>
const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
canvas.width = innerWidth; canvas.height = innerHeight;
const probe = (window.__yuvi.kitProbe = { started: false, frames: 0, keys: 0, axisMax: 0, tweened: 0, hud: null, best: null, lang: null });
let x = 100, t = 0;
const box = { x: 0 };
YuviKit.init({
  title: 'משאית המסה', subtitle: 'הורידו טרה, לא מטען',
  controls: [{ keys: 'WASD / חיצים', does: 'תנועה' }, { keys: 'רווח', does: 'ירי' }],
  palette: ['#1e1e2e', '#cba6f7', '#89dceb'],
  hud: [{ id: 'score', label: 'ניקוד', value: 0 }, { id: 'lives', label: 'חיים', value: 3 }, { id: 'net', label: 'נטו', value: 12.5 }],
  sounds: { hit: 'blip', boom: { type: 'noise', ms: 200 } },
  music: { bpm: 140, notes: ['C4', 'E4', 0, 'G4'] },
  touch: { always: true, joystick: true, buttons: [{ id: 'fire', label: '🔥', key: 'Space' }] },
  storage: { best: 'kit-test-best' },
  onStart: () => {
    probe.started = true;
    probe.lang = YuviKit.lang;
    YuviKit.hud.set({ score: 120, lives: 2 });
    YuviKit.hud.add('score', 5);
    YuviKit.audio.play('hit'); YuviKit.audio.play('boom'); YuviKit.audio.play('coin'); YuviKit.audio.play('nope');
    YuviKit.fx.particles({ x: 200, y: 150, color: ['#f38ba8', '#fab387'], count: 30 });
    YuviKit.fx.particles({ x: 50, y: 50, el: canvas });
    YuviKit.fx.shake(6, 200); YuviKit.fx.flash('#fff'); YuviKit.fx.float('+10', { x: 200, y: 150 });
    YuviKit.screens.message('שלב 1', 800);
    YuviKit.tween(box, { x: 100 }, 200).then(() => { probe.tweened = box.x; });
    probe.best = YuviKit.best.set(42);
    probe.hud = { score: YuviKit.hud.get('score'), lives: YuviKit.hud.get('lives') };
    YuviKit.input.pointerLock(canvas);   // may or may not be granted headlessly; must never throw or leave the game paused
  },
  onPause: (p) => { probe.paused = p; },
  onRetry: () => { probe.retried = true; }
});
YuviKit.input.on('fire', () => { probe.fired = (probe.fired || 0) + 1; });
YuviKit.loop((dt) => {
  probe.frames++;
  const a = YuviKit.input.axis();
  probe.axisMax = Math.max(probe.axisMax, a.x);
  probe.keys = YuviKit.input.keys.size;
  const look = YuviKit.input.look; probe.look = typeof look.dx === 'number' && typeof look.dy === 'number';
  x += a.x * 200 * dt; t += dt;
  ctx.fillStyle = '#123456'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = YuviKit.palette[1]; ctx.beginPath(); ctx.arc(x + Math.sin(t * 4) * 30, 200, 40, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.fillRect((t * 120) % canvas.width, 300, 30, 30);
});
</script>
</body></html>"""


def test_build_harness_injects_the_kit_last():
    frag = build_harness(LEARN_DATA, nonce="n1")
    order = ["__YUVI_NONCE", "__yuviStorageReady", "__yuvilabGameFit", "__yuviErrorReporter", "__YUVI_LEARN_DATA",
             "window.YuviLearn = {", "window.YuviKit = {"]
    positions = [frag.index(m) for m in order]
    assert positions == sorted(positions), "harness scripts must keep their order (kit last)"
    assert "</script" not in KIT_PATH.read_text(encoding="utf-8")
    assert frag.count("<script>") == 7  # nonce, storage, fit, errors, learn data, YuviLearn, YuviKit


def test_inject_harness_positions():
    frag = build_harness(LEARN_DATA, nonce="n2")
    html = inject_harness("<!DOCTYPE html><html><head><title>x</title></head><body></body></html>", frag)
    assert html.index(frag) < html.index("<title>x</title>")
    assert "window.YuviKit" in html


def test_kit_stays_small_and_parses():
    src = KIT_PATH.read_text(encoding="utf-8")
    assert len(src.splitlines()) <= 500, "the kit is meant to be small — trim before growing it"
    assert src.startswith("/*") and src.rstrip().endswith("})();")
    node = shutil.which("node")
    if not node:
        pytest.skip("node not installed (Chromium test parses the file instead)")
    subprocess.run([node, "--check", str(KIT_PATH)], check=True, timeout=30)


@pytest.mark.slow
def test_kit_game_passes_validation():
    if not chromium_available():
        pytest.skip("Playwright Chromium not installed")
    res = validate_html_sync(KIT_GAME, preinject_html=build_harness(LEARN_DATA, nonce="n3"), settle_ms=800, interaction_settle_ms=800)
    assert res.validator_error is None
    assert res.errors == [], res.errors
    assert res.ok
    assert res.clicked_start, "the validator must find the kit's Start button"
    assert res.heartbeat > 0
    assert res.canvas_blank is False
    probe = res.yuvi_state["kitProbe"]
    assert probe["started"] is True and probe["lang"] == "he"
    assert probe["frames"] > 0
    assert probe["hud"] == {"score": 125, "lives": 2}
    assert probe["best"] == 42
    assert probe["tweened"] == 100
    assert probe["axisMax"] == 1, "ArrowRight / KeyD held by the validator must reach input.axis()"
    assert probe.get("fired", 0) >= 1, "Space held by the validator must fire the 'fire' action"
    assert probe["look"] is True


@pytest.mark.slow
def test_kit_start_button_text_follows_language():
    if not chromium_available():
        pytest.skip("Playwright Chromium not installed")
    en = dict(LEARN_DATA, language="en")
    res = validate_html_sync(KIT_GAME, preinject_html=build_harness(en, nonce="n4"), settle_ms=500, interaction_settle_ms=500, screenshot=False)
    assert res.errors == [], res.errors
    assert res.clicked_start and res.yuvi_state["kitProbe"]["lang"] == "en"
