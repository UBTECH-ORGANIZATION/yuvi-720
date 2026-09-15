"""YuviFPS — the first-person-shooter module, driven through the real validator.

The fixture game builds a night world with cover, an FPS rig with three
weapons (one with a short reload), a player state, a target guard straight
ahead, a mixed squad that shoots back, pickups and objectives — all BEFORE
Start. After the Start click it looks at the target, dispatches a simulated
pointerdown/up (the pulse rifle is automatic, so the held button fires every
frame), asks for a reload and records probes on ``window.__yuvi.fps``:
the target loses hp and powers down, an enemy bolt reduces the player's hp,
the magazine refills, no console errors. Skips without Chromium or the CDN.
"""
import shutil
import subprocess

import pytest

from game_gen.harness import HARNESS_DIR, build_harness
from game_gen.libraries import AVAILABLE_LIBRARIES, _head
from game_gen.validator import chromium_available, validate_html_sync

W3D_PATH = HARNESS_DIR / "yuvi_world3d.js"
FPS_PATH = HARNESS_DIR / "yuvi_fps.js"
THREE_URL = AVAILABLE_LIBRARIES["three"]["cdn"]
LEARN_DATA = {"component": {"id": "c1", "title": "מסה"}, "objective": {"id": "o1", "title": "נטו וברוטו"}, "language": "he"}

FPS_GAME = """<!DOCTYPE html>
<html lang="he"><head><meta charset="UTF-8"><title>fps game</title>
<style>body{background:#0b1030}</style></head>
<body>
<script type="module">
import * as THREE from '%(three)s';
const probe = (window.__yuvi.fps = { attached: false, kinds: 0, weaponParts: 0, sockets: 0, frames: 0, shots: 0, targetHp0: 0, targetHp: 0, targetState: null, targetDown: false,
  downs: 0, playerHp: 100, playerHit: false, reloadOk: false, magAfterFire: 30, enemyShots: 0, states: [], pickups: 0, objective: '', stubOk: false, crosshair: false, drawCalls: 0 });
// robustness: the module survives a missing world
probe.stubOk = YuviFPS.attach(null, THREE) === null;
const W = YuviWorld3D.world(THREE, { preset: 'night', seed: 5, size: 90, clouds: 0, birds: 0 });
probe.attached = !!(W.fps && W.fps.weapon && W.fps.soldier);
probe.kinds = W.fps.kinds.length;
const crates = W.props.scatter('crate', 10, { area: [0, -14, 9, 4], seed: 3 });
const ctrl = W.player.fps({ speed: 6, pos: [0, 0, 8] }).collide(crates);
const rifle = W.fps.weapon('pulseRifle', { seed: 2, skin: 'neon', accent: '#7cf0ff', reloadS: .4, recoil: [.03, 2, .3] });
let parts = 0; rifle.group.traverse(o => { if (o.isMesh) parts++; }); probe.weaponParts = parts; probe.sockets = Object.keys(rifle.sockets).length;
const rig = W.fps.arms(ctrl, { weapons: [rifle, 'blaster', 'scatterGun'] });
const hero = W.fps.player(ctrl, { hp: 100, armor: 20, onDead: () => { probe.dead = true; } });
const target = W.fps.soldier({ arch: 'grunt', pos: [0, 0, -6], seed: 4, hp: 30, speed: 0, range: [0, 30], cover: false, retreat: false, reaction: .05, accuracy: 4, drop: true, onDown: () => { probe.targetDown = true; probe.downs++; W.fps.objectives.progress('guards'); } });
probe.targetHp0 = target.hp;
const turret = W.fps.soldier({ arch: 'turret', pos: [3.5, 0, 4], seed: 8, reaction: .05, accuracy: 8, cover: false });   // point-blank: a bolt lands during the still poster window
const squad = W.fps.squad(5, { arch: ['grunt', 'heavy', 'drone', 'sniper', 'turret'], area: [0, -22, 9], seed: 9, reaction: .3, onDown: () => { probe.downs++; W.fps.objectives.progress('guards'); } });
W.fps.pickups.spawn('health', [2, 0, 6]); W.fps.pickups.spawn('weapon', [-3, 0, 5], { weapon: 'railGun' });
W.fps.objectives.add('הפילו את השומרים', { id: 'guards', count: 6 });
probe.objective = W.fps.objectives.text();
probe.crosshair = !!document.getElementById('yf-cross');
const fire = down => { const c = W.renderer.domElement; c.dispatchEvent(new PointerEvent(down ? 'pointerdown' : 'pointerup', { button: 0, bubbles: true, pointerType: 'mouse' })); };
YuviKit.init({
  title: 'מתחם הלילה', subtitle: 'בדיקה', palette: ['#0b1030', '#7cf0ff'],
  hud: [{ id: 'hp', label: 'חיים', value: 100 }, { id: 'armor', label: 'מגן', value: 20 }, { id: 'ammo', label: 'תחמושת', value: '' }],
  onStart: () => {
    ctrl.requestLook(); ctrl.lookAt([target.pos.x, target.pos.y + 1.1, target.pos.z]);
    setTimeout(() => fire(true), 300);
    setTimeout(() => { fire(false); probe.magAfterFire = rifle.mag; }, 2000);
    setTimeout(() => { probe.reloadCalled = rig.reload(); }, 2200);
    setTimeout(() => { probe.reloadOk = rifle.mag === rifle.config.mag && rifle.state !== 'reloading'; }, 3200);
  }
});
YuviKit.loop(dt => {                                   // one loop: W.update + W.render + probes (two kit loops would halve dt)
  W.update(dt); W.render(); probe.frames++;
  probe.shots = rig.stats.shots;
  probe.targetHp = target.hp; probe.targetState = target.state;
  probe.playerHp = hero.hp; probe.playerHit = probe.playerHit || hero.hp + hero.armor < 120;
  probe.states = squad.map(s => s.state);
  probe.pickups = W.fps.pickups.list.length;
  probe.drawCalls = W.stats.drawCalls;
  probe.enemyShots = squad.reduce((n, s) => n + (s.shots || 0), 0);
});
</script>
</body></html>""" % {"three": THREE_URL}


def _cdn_reachable() -> bool:
    try:
        return _head(THREE_URL, 5.0) == 200
    except Exception:  # noqa: BLE001
        return False


def _harness_with_fps(nonce: str) -> str:
    tags = build_harness(LEARN_DATA, nonce=nonce)
    for path in (W3D_PATH, FPS_PATH):
        tags += "\n<script>\n" + path.read_text(encoding="utf-8").replace("</script", "<\\/script") + "\n</script>"
    return tags


def test_fps_stays_small_and_parses():
    src = FPS_PATH.read_text(encoding="utf-8")
    assert len(src.splitlines()) <= 1400, "yuvi_fps.js has a hard cap of 1400 lines"
    assert src.startswith("/*") and src.rstrip().endswith("})();")
    assert "</script" not in src and "import " not in src.split("*/", 1)[1]
    assert "window.YuviFPS = {" in src and "YuviWorld3D.use(" in src
    node = shutil.which("node")
    if not node:
        pytest.skip("node not installed")
    subprocess.run([node, "--check", str(FPS_PATH)], check=True, timeout=30)


@pytest.mark.slow
def test_fps_game_shoots_and_is_shot():
    if not chromium_available():
        pytest.skip("Playwright Chromium not installed")
    if not _cdn_reachable():
        pytest.skip("Three.js CDN unreachable")
    res = validate_html_sync(FPS_GAME, preinject_html=_harness_with_fps("fps1"), settle_ms=1200, interaction_settle_ms=3000)
    assert res.validator_error is None
    assert res.errors == [], res.errors
    assert res.ok
    assert res.clicked_start, "the validator must find the kit's Start button"
    assert res.heartbeat > 0
    assert res.canvas_blank is False
    assert res.phases.get("first_frame_blank") is False, "the world and the gun are built before Start"
    probe = res.yuvi_state["fps"]
    assert probe["stubOk"] is True and probe["attached"] is True
    assert probe["kinds"] == 7
    assert probe["weaponParts"] >= 12 and probe["sockets"] >= 4
    assert probe["crosshair"] is True
    assert probe["frames"] > 0
    assert probe["shots"] >= 3, probe
    assert probe["magAfterFire"] < 30, "held pointerdown must fire the automatic pulse rifle"
    assert probe["targetHp"] < probe["targetHp0"], "hitscan shots must damage the guard straight ahead"
    assert probe["targetDown"] is True and probe["targetState"] == "down", probe
    assert probe["playerHit"] is True, "an enemy bolt must reduce the player's hp / armor"
    assert probe["reloadCalled"] is True and probe["reloadOk"] is True, probe
    assert probe["downs"] >= 1 and probe["objective"].endswith("0/6")
    assert all(st in ("patrol", "alert", "engage", "cover", "search", "retreat", "down") for st in probe["states"]), probe["states"]
    assert probe["enemyShots"] + (1 if probe["playerHit"] else 0) >= 1
    assert probe["drawCalls"] > 0
