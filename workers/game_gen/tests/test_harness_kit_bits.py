"""Kit bits added 2026-09-14: in-world labels, ask({givens}), fps.reset() without callbacks."""
import pytest

from game_gen.harness import build_harness
from game_gen.libraries import AVAILABLE_LIBRARIES
from game_gen.validator import chromium_available, validate_html_sync

THREE_URL = AVAILABLE_LIBRARIES["three"]["cdn"]
LEARN = {"component": {"id": "c1", "title": "מסה"}, "objective": {"id": "o1", "title": "ברוטו נטו טרה"}, "language": "he"}

GAME = """<!DOCTYPE html>
<html lang="he"><head><meta charset="UTF-8"><title>bits</title></head><body>
<script type="module">
import * as THREE from '%(three)s';
const probe = (window.__yuvi.bits = { label: 0, given: 0, downFired: 0, soldiersAfterReset: -1, labelText: '' });
const W = YuviWorld3D.world(THREE, { preset: 'night', seed: 3, size: 80 });
W.lighting.apply('nightIndustrial');
const sign = W.label('ברוטו 1400 g\\nטרה 400 g', [3, 0, -6], { glow: '#ffb347' });
const console1 = W.props.make('console', { variant: 'lit', pos: [-3, 0, -6], text: 'קוד: נטו' });
probe.label = (sign.mesh.material.map ? 1 : 0) + (console1.label && console1.label.mesh.material.map ? 1 : 0);
sign.set('ברוטו 1500 g'); probe.labelText = sign.text;
const ctrl = W.player.fps({ pos: [0, 0, 6] });
const rig = W.fps.arms(ctrl, { weapons: ['blaster'] });
const hero = W.fps.player(ctrl, { hp: 100 });
let resetting = false;
const squad = W.fps.squad(3, { arch: 'grunt', area: [0, -10, 6], seed: 5, onDown: () => { if (resetting) probe.downFired++; } });
YuviKit.init({ title: 'bits', hud: [{ id: 'hp', label: 'חיים', value: 100 }, { id: 'ammo', label: 'תחמושת', value: '' }],
  onStart: async () => {
    resetting = true; W.fps.reset(); resetting = false;
    probe.soldiersAfterReset = W.fps.soldiers.length;
    const p = YuviUI.ask({ parts: ['מה הנטו?'], kind: 'number', correct: 1000, givens: [['ברוטו ', { ltr: '1400 g' }], ['טרה ', { ltr: '400 g' }]], hint: 'נטו = ברוטו − טרה' });
    probe.given = document.querySelectorAll('#yu-root .yu-given').length;
    const inp = document.querySelector('#yu-root input'); inp.value = '1000'; document.querySelector('#yu-root .yu-btn').click();
    await p; YuviKit.hud.set({ hp: 100 });
  } });
W.run();
</script></body></html>""" % {"three": THREE_URL}


def _harness(nonce: str) -> str:
    return build_harness(LEARN, nonce=nonce, modules=["world3d", "ui", "fps"])


@pytest.mark.slow
def test_labels_givens_and_reset_work_together():
    if not chromium_available():
        pytest.skip("Playwright Chromium not installed")
    res = validate_html_sync(GAME, preinject_html=_harness("bits1"), settle_ms=1500, interaction_settle_ms=2500, screenshot=False)
    assert res.validator_error is None
    assert res.errors == [], res.errors
    bits = (res.yuvi_state or {}).get("bits") or {}
    assert bits.get("label") == 2, bits            # W.label and make({text}) both drew a texture
    assert bits.get("labelText") == "ברוטו 1500 g"
    assert bits.get("given") == 2, bits            # the givens rows are in the panel
    assert bits.get("downFired") == 0, bits        # reset() never fires onDown
    assert bits.get("soldiersAfterReset") == 0, bits


# ── bake-off 2026-09-14: one clock for every loop, stacked docks, spawn facing ──────────────────────
LOOPS_GAME = """<!DOCTYPE html>
<html lang="he"><head><meta charset="UTF-8"><title>loops</title></head><body>
<script type="module">
import * as THREE from '%(three)s';
const probe = (window.__yuvi.loops = { dtA: [], dtB: [], overlap: null, mapDocked: false, facing: null, safeTop: 0 });
const W = YuviWorld3D.world(THREE, { preset: 'lab', seed: 1, size: 60 });
const hero = W.props.character({ kind: 'robot', pos: [0, 0, 8] });
const ctrl = W.player.avatar(hero, { camera: 'follow' });
probe.facing = +ctrl.forward().z.toFixed(2);
W.minimap();
const strip = document.createElement('div'); strip.textContent = 'מטרה: רוצו לשער הנכון — x אופקי, y אנכי'; strip.style.cssText = 'padding:12px 40px;background:#000;color:#fff;font-size:20px';
YuviKit.dock(strip, 'bottom');
const panel = document.createElement('div'); panel.textContent = 'מיקום הרחפן: (0 , 0) | גובה: 24 | רוח: דוחפת למטה'; panel.style.cssText = 'padding:12px;background:#222;color:#fff;font-size:18px';
YuviKit.dock(panel, 'bottom-left');
YuviKit.init({ title: 'loops', hud: [{ id: 'score', label: 'ניקוד', value: 0 }], onStart: () => {
  YuviKit.loop(dt => { if (probe.dtA.length < 30) probe.dtA.push(dt); });
  setTimeout(() => {
    const a = strip.getBoundingClientRect(), b = panel.getBoundingClientRect(), m = document.querySelector('#yk-root canvas').getBoundingClientRect();
    const hit = (p, q) => Math.min(p.right, q.right) > Math.max(p.left, q.left) && Math.min(p.bottom, q.bottom) > Math.max(p.top, q.top);
    probe.overlap = hit(a, b) || hit(a, m) || hit(b, m);
    probe.mapDocked = !!document.querySelector('#yk-root .yk-dock canvas');
    probe.safeTop = YuviKit.safe().top;
  }, 600);
} });
W.run();                                   // a second loop, like the games do next to their own YuviKit.loop
YuviKit.loop(dt => { if (probe.dtB.length < 30) probe.dtB.push(dt); });
</script></body></html>""" % {"three": THREE_URL}


@pytest.mark.slow
def test_loops_share_one_clock_and_docks_stack():
    if not chromium_available():
        pytest.skip("Playwright Chromium not installed")
    res = validate_html_sync(LOOPS_GAME, preinject_html=build_harness(LEARN, nonce="loops1", modules=["world3d", "ui"]), settle_ms=1500, interaction_settle_ms=2500, screenshot=False)
    assert res.validator_error is None
    assert res.errors == [], res.errors
    p = (res.yuvi_state or {}).get("loops") or {}
    a, b = p.get("dtA") or [], p.get("dtB") or []
    assert len(a) >= 10 and len(b) >= 10, p
    assert sum(a[2:]) / len(a[2:]) > 0.005 and sum(b[2:]) / len(b[2:]) > 0.005, (a[:5], b[:5])   # both loops see real frame time, not ~0
    assert p.get("overlap") is False, p        # bottom strip, bottom-left panel and the minimap never overlap
    assert p.get("mapDocked") is True, p
    assert p.get("facing") == -1, p            # avatar spawns facing -z, so a level at z < spawn is in view
    assert p.get("safeTop", 0) > 0, p


HELP_GAME = """<!DOCTYPE html>
<html lang="he"><head><meta charset="UTF-8"><title>help</title></head><body style="margin:0">
<canvas id="c" width="400" height="300"></canvas>
<script>
const cx = document.getElementById('c').getContext('2d');
const probe = (window.__yuvi.help = { btn: false, shownPaused: null, rows: 0, resumed: null, titleRows: 0 });
YuviKit.init({ title: 'help', controls: [{ keys: 'WASD', does: 'תנועה' }, { keys: 'רווח', does: 'קפיצה' }], hud: [{ id: 'score', label: 'ניקוד', value: 0 }], onStart: () => {
  setTimeout(() => {
    const b = Array.from(document.querySelectorAll('#yk-hud .yk-ib')).find(x => x.textContent === '❔'); probe.btn = !!b;
    b.click(); probe.shownPaused = YuviKit.paused; probe.rows = document.querySelectorAll('#yk-help .yk-ctl').length;
    document.querySelector('#yk-help .yk-btn').click(); probe.resumed = !YuviKit.paused && !document.querySelector('#yk-help');
  }, 300);
} });
probe.titleRows = document.querySelectorAll('#yk-start .yk-ctl').length;
let t = 0; YuviKit.loop(dt => { t += dt; cx.fillStyle = '#123'; cx.fillRect(0, 0, 400, 300); cx.fillStyle = '#fc0'; cx.fillRect(100 + Math.sin(t) * 50, 120, 60, 60); });
</script></body></html>"""


@pytest.mark.slow
def test_hud_help_button_shows_the_controls_and_pauses():
    if not chromium_available():
        pytest.skip("Playwright Chromium not installed")
    res = validate_html_sync(HELP_GAME, preinject_html=build_harness(LEARN, nonce="help1", modules=[]), settle_ms=1000, interaction_settle_ms=1500, screenshot=False)
    assert res.validator_error is None
    assert res.errors == [], res.errors
    p = (res.yuvi_state or {}).get("help") or {}
    assert p.get("btn") is True, p
    assert p.get("titleRows") == 2, p
    assert p.get("shownPaused") is True and p.get("rows") == 2, p
    assert p.get("resumed") is True, p
