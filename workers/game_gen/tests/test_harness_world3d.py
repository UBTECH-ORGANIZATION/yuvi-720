"""YuviWorld3D — the opt-in 3D runtime, driven through the real validator.

The fixture game imports Three.js from the allow-listed CDN, builds the world
BEFORE Start (so the first frame after the click is not blank), scatters
instanced props, adds a patrolling enemy, fires one projectile at it and
records probes on ``window.__yuvi.w3d``. The second fixture is the designed
path: an ocean biome with terrain + water, ``decorate()``, a character hero on
the avatar controller, character enemies and a dog, probed on ``w3d2``.
Skips without Chromium or the CDN.
"""
import shutil
import subprocess

import pytest

from game_gen.harness import HARNESS_DIR, build_harness
from game_gen.libraries import AVAILABLE_LIBRARIES, _head
from game_gen.validator import chromium_available, validate_html_sync

W3D_PATH = HARNESS_DIR / "yuvi_world3d.js"
THREE_URL = AVAILABLE_LIBRARIES["three"]["cdn"]
LEARN_DATA = {"component": {"id": "c1", "title": "מסה"}, "objective": {"id": "o1", "title": "נטו וברוטו"}, "language": "he"}

WORLD_GAME = """<!DOCTYPE html>
<html lang="he"><head><meta charset="UTF-8"><title>world game</title>
<style>body{background:#1e1e2e}</style></head>
<body>
<script type="module">
import * as THREE from '%(three)s';
const probe = (window.__yuvi.w3d = { built: false, frames: 0, propCount: 0, enemyState: null, enemyMoved: false, projectileHits: 0,
  fpsStart: null, fpsPos: null, moved: false, rayHit: false, stats: null, stubOk: false, kinds: 0 });
// Robustness: every entry point survives missing args.
const stub = YuviWorld3D.world(undefined);
stub.props.scatter('tree', 3); stub.player.fps(); stub.enemy(); stub.projectiles().fire(); stub.update(0.016); stub.render();
probe.stubOk = stub.scene === null;

const W = YuviWorld3D.world(THREE, { preset: 'forest', seed: 3, size: 100 });
probe.built = !!(W.scene && W.renderer && document.querySelector('canvas[data-yuvi-world3d]'));
probe.kinds = W.props.kinds.length;
const trees = W.props.scatter('tree', 60, { seed: 1 });
const rocks = W.props.scatter('rock', 20, { area: 40 });
const lamps = W.props.scatter('lamp', 6, { area: [0, 0, 20, 20] });
const bad = W.props.scatter('dragon', 5);
probe.propCount = trees.positions.length + rocks.positions.length + lamps.positions.length + bad.positions.length;

const ctrl = W.player.fps({ speed: 6, pos: [0, 0, 5] });
ctrl.collide(trees).collide(rocks.positions);
const bot = W.props.make('actor', { color: '#ff5555', pos: [0, 0, -6] });
const en = W.enemy(bot, { waypoints: [[-4, 0, -6], [4, 0, -6]], speed: 2, onSee: () => { probe.seen = true; } });
const guns = W.projectiles({ speed: 30, gravity: 4, targets: () => [en], onHit: (t, p) => { probe.projectileHits++; W.fx.hit(p, { color: '#ffcc00', count: 20 }); W.fx.flashLight(80); } });
W.minimap(null, { markers: () => [{ pos: bot.position, color: '#f00' }] });
W.objective('מצאו את הרובוט');
const hit = W.raycast(new THREE.Vector3(3, 5, 3), new THREE.Vector3(0, -1, 0), 20);
probe.rayHit = !!(hit && hit.object === W.ground);
const botStart = bot.position.x;

YuviKit.init({
  title: 'עולם', subtitle: 'יער', palette: ['#1e1e2e', '#cba6f7'],
  hud: [{ id: 'score', label: 'ניקוד', value: 0 }],
  onStart: () => {
    ctrl.requestLook();
    probe.fpsStart = [ctrl.pos.x, ctrl.pos.z];
    guns.fire(new THREE.Vector3(0, 1.2, 0), new THREE.Vector3(0, 0, -1));
  }
});
W.run();
YuviKit.loop(() => {
  probe.frames++;
  probe.enemyState = en.state;
  probe.enemyMoved = probe.enemyMoved || Math.abs(bot.position.x - botStart) > 0.2;
  probe.fpsPos = [ctrl.pos.x, ctrl.pos.z];
  probe.moved = probe.moved || Math.abs(ctrl.pos.x - probe.fpsStart[0]) > 0.5;
  probe.stats = W.stats;
});
</script>
</body></html>""" % {"three": THREE_URL}


BIOME_GAME = """<!DOCTYPE html>
<html lang="he"><head><meta charset="UTF-8"><title>biome game</title>
<style>body{background:#1e1e2e}</style></head>
<body>
<script type="module">
import * as THREE from '%(three)s';
const probe = (window.__yuvi.w3d2 = { built: false, frames: 0, water: false, groundSpread: 0, decor: 0, landmark: false, heroStart: null, heroPos: null, moved: false,
  limbChanged: false, heights: [], meshCounts: [], enemyStates: [], enemyMoved: false, dogParts: 0, camMode: null, stats: null, biomes: 0 });
const W = YuviWorld3D.world(THREE, { preset: 'ocean', seed: 11, size: 100, terrain: { hills: .4 }, water: { level: -1.2, waves: .25 } });
probe.built = !!(W.scene && W.renderer && document.querySelector('canvas[data-yuvi-world3d]'));
probe.biomes = YuviWorld3D.biomes.length;
probe.water = !!W.water && W.water.isMesh;
let lo = Infinity, hi = -Infinity;
for (let i = 0; i < 40; i++) { const a = i / 40 * 6.2832, r = 8 + (i %% 5) * 9; const y = W.groundY(Math.cos(a) * r, Math.sin(a) * r); lo = Math.min(lo, y); hi = Math.max(hi, y); }
probe.groundSpread = hi - lo;
const dec = W.decorate({ density: .8, seed: 2 });
probe.decor = dec.sets.length; probe.landmark = !!dec.landmark;
const hero = W.props.character({ role: 'kid', seed: 3, pos: [0, 0, 4] });
const guards = [W.props.character({ role: 'guard', seed: 11, pos: [-6, 0, -8] }), W.props.character({ role: 'guard', seed: 12, pos: [7, 0, -9] })];
const dog = W.props.character({ animal: 'dog', seed: 5, pos: [3, 0, 2] });
const countMeshes = g => { let n = 0; g.traverse(o => { if (o.isMesh) n++; }); return n; };
[hero].concat(guards).forEach(ch => { probe.heights.push(+ch.userData.height.toFixed(3)); probe.meshCounts.push(countMeshes(ch)); });
probe.dogParts = countMeshes(dog);
const ctrl = W.player.avatar(hero, { camera: 'follow', speed: 7 }).collide(dec);
probe.camMode = ctrl.mode;
const enemies = guards.map((g, i) => W.enemy(g, { waypoints: [[g.position.x - 5, 0, g.position.z], [g.position.x + 5, 0, g.position.z]], speed: 2.5, sightRange: 4 }));
const guardStart = guards.map(g => g.position.x);
W.enemy(dog, { waypoints: [[3, 0, 2], [-3, 0, 3]], speed: 2, sightRange: 1 });
const guns = W.projectiles({ speed: 30, gravity: 4, targets: () => enemies, onHit: (t, p) => { W.fx.hit(p, { color: '#ffcc00' }); } });
W.minimap(null, {}); W.objective('הגיעו למגדלור');
let prevLeg = null;
YuviKit.init({
  title: 'האי', subtitle: 'חוף', palette: ['#1e1e2e', '#89dceb'],
  hud: [{ id: 'score', label: 'ניקוד', value: 0 }],
  onStart: () => { probe.heroStart = [hero.position.x, hero.position.z]; hero.anim.wave(); guns.fire(); }
});
W.run();
YuviKit.loop(() => {
  probe.frames++;
  probe.heroPos = [hero.position.x, hero.position.z];
  probe.moved = probe.moved || Math.abs(hero.position.x - probe.heroStart[0]) > 0.5 || Math.abs(hero.position.z - probe.heroStart[1]) > 0.5;
  const leg = hero.parts.legL.rotation.x;
  if (prevLeg != null && Math.abs(leg - prevLeg) > 0.01) probe.limbChanged = true;
  prevLeg = leg;
  probe.enemyStates = enemies.map(e => e.state);
  probe.enemyMoved = probe.enemyMoved || guards.some((g, i) => Math.abs(g.position.x - guardStart[i]) > 0.2);
  probe.stats = W.stats;
});
</script>
</body></html>""" % {"three": THREE_URL}


def _cdn_reachable() -> bool:
    try:
        return _head(THREE_URL, 5.0) == 200
    except Exception:  # noqa: BLE001
        return False


def _harness_with_world3d(nonce: str) -> str:
    src = W3D_PATH.read_text(encoding="utf-8")
    return build_harness(LEARN_DATA, nonce=nonce) + "\n<script>\n" + src.replace("</script", "<\\/script") + "\n</script>"


def test_world3d_stays_small_and_parses():
    src = W3D_PATH.read_text(encoding="utf-8")
    assert len(src.splitlines()) <= 1000, "yuvi_world3d.js has a hard cap of 1000 lines (plugins carry everything else)"
    assert src.startswith("/*") and src.rstrip().endswith("})();")
    assert "</script" not in src and "import " not in src.split("*/", 1)[1].replace("import * as THREE", "")
    node = shutil.which("node")
    if not node:
        pytest.skip("node not installed")
    subprocess.run([node, "--check", str(W3D_PATH)], check=True, timeout=30)


@pytest.mark.slow
def test_world3d_game_passes_validation():
    if not chromium_available():
        pytest.skip("Playwright Chromium not installed")
    if not _cdn_reachable():
        pytest.skip("Three.js CDN unreachable")
    res = validate_html_sync(WORLD_GAME, preinject_html=_harness_with_world3d("w3d1"), settle_ms=1200, interaction_settle_ms=1200)
    assert res.validator_error is None
    assert res.errors == [], res.errors
    assert res.ok
    assert res.clicked_start, "the validator must find the kit's Start button"
    assert res.heartbeat > 0
    assert res.canvas_blank is False
    assert res.phases.get("first_frame_blank") is False, "the world is built before Start, so the first frame after the click must not be flat"
    probe = res.yuvi_state["w3d"]
    assert probe["stubOk"] is True
    assert probe["built"] is True
    assert probe["kinds"] >= 7
    assert probe["frames"] > 0
    assert probe["propCount"] >= 60, probe["propCount"]
    assert probe["rayHit"] is True
    assert probe["enemyState"] in ("patrol", "detect", "chase", "cover", "search")
    assert probe["enemyMoved"] is True
    assert probe["projectileHits"] >= 1
    assert probe["moved"] is True, "ArrowRight / KeyD held by the validator must move the FPS rig"
    assert probe["stats"]["props"] >= 60 and probe["stats"]["drawCalls"] > 0


@pytest.mark.slow
def test_world3d_biome_avatar_characters():
    """The designed path: biome + terrain + water + decorate(), a character hero
    on the avatar controller, animated character enemies and an animal."""
    if not chromium_available():
        pytest.skip("Playwright Chromium not installed")
    if not _cdn_reachable():
        pytest.skip("Three.js CDN unreachable")
    res = validate_html_sync(BIOME_GAME, preinject_html=_harness_with_world3d("w3d2"), settle_ms=1200, interaction_settle_ms=1200)
    assert res.validator_error is None
    assert res.errors == [], res.errors
    assert res.ok
    assert res.clicked_start
    assert res.heartbeat > 0
    assert res.canvas_blank is False
    assert res.phases.get("first_frame_blank") is False
    probe = res.yuvi_state["w3d2"]
    assert probe["built"] is True
    assert probe["biomes"] == 12
    assert probe["water"] is True
    assert probe["groundSpread"] > 0.5, "terrain hills must vary groundY across the map"
    assert probe["decor"] >= 4 and probe["landmark"] is True
    assert probe["frames"] > 0
    assert probe["camMode"] == "follow"
    assert probe["moved"] is True, "ArrowRight / KeyD held by the validator must move the avatar"
    assert probe["limbChanged"] is True, "the hero's legs must swing (walk animation)"
    assert len(set(probe["heights"])) >= 2 or len(set(probe["meshCounts"])) >= 2, (probe["heights"], probe["meshCounts"])
    assert probe["dogParts"] >= 8
    assert all(st in ("patrol", "detect", "chase", "cover", "search") for st in probe["enemyStates"])
    assert probe["enemyMoved"] is True
    assert probe["stats"]["props"] >= 80 and probe["stats"]["drawCalls"] > 0
