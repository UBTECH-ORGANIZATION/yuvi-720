"""YuviWorld3D materials plugin — procedural textures + shader presets, driven
through the real validator.

The fixture builds a world, generates EVERY texture in the contract (recording
sizes and timings), scatters props through the core's ``texture:`` path, defines
a prop kind with per-part ``t:``, makes every material preset and puts each on a
sphere in front of the camera, applies a hologram to a character, outlines a toon
box, re-textures the ground (slope blend, then triplanar) and animates a
dissolve. A shader that fails to compile lands as a console.error, which the
validator reports — so ``res.errors == []`` is the GLSL check. Skips without
Chromium or the CDN.
"""
import shutil
import subprocess

import pytest

from game_gen.harness import HARNESS_DIR, build_harness
from game_gen.libraries import AVAILABLE_LIBRARIES, _head
from game_gen.validator import chromium_available, validate_html_sync

W3D_PATH = HARNESS_DIR / "yuvi_world3d.js"
MAT_PATH = HARNESS_DIR / "yuvi_world3d_materials.js"
THREE_URL = AVAILABLE_LIBRARIES["three"]["cdn"]
LEARN_DATA = {"component": {"id": "c1", "title": "מסה"}, "objective": {"id": "o1", "title": "נטו וברוטו"}, "language": "he"}

#: The texture-name contract other plugins (props, atmo, fps) rely on. Spelled exactly.
CONTRACT = [
    "metal", "metalDark", "metalBrushed", "rust", "concrete", "concreteDark", "brick", "brickRed", "wood", "woodDark", "plank",
    "sand", "grass", "dirt", "gravel", "asphalt", "tile", "plaster", "camo", "camoDesert", "panel", "panelLit", "hazard", "grid",
    "fabric", "leather", "bark", "leaves", "snow", "lava", "water", "scales", "canvas",
]
PRESETS = ["metal", "rust", "concrete", "wood", "brick", "glass", "hologram", "forcefield", "lava", "neon", "toon", "dissolve", "crystal", "water", "chrome"]

MAT_GAME = """<!DOCTYPE html>
<html lang="he"><head><meta charset="UTF-8"><title>materials game</title>
<style>body{background:#1e1e2e}</style></head>
<body>
<script type="module">
import * as THREE from '%(three)s';
const CONTRACT = %(contract)s, PRESETS = %(presets)s;
const probe = (window.__yuvi.mat = { hasApi: false, missingRegistry: [], missingNames: [], bad: [], sizes: {}, genMs: 0, gen512Ms: 0, factoryOk: false, bumpNames: [], emissiveNames: [],
  deterministic: false, scatterMap: false, defineMap: false, presetCount: 0, presetFail: [], presetsExtra: [], uniformsOk: false, applied: false, outline: 0, ground: false, groundTri: false,
  badInputOk: false, frames: 0, time: 0, hitOk: false, stats: null, sw: null, aniso: null });
let CTX = null;
YuviWorld3D.use((W, T, ctx) => { CTX = ctx; });
const W = YuviWorld3D.world(THREE, { preset: 'city', seed: 5, size: 100 });
probe.hasApi = !!(W.textures && W.materials && typeof W.textures.get === 'function' && typeof W.materials.make === 'function');
probe.missingRegistry = CONTRACT.filter(n => typeof CTX.textures[n] !== 'function');
probe.missingNames = CONTRACT.filter(n => W.textures.names.indexOf(n) < 0);
probe.presetsExtra = PRESETS.filter(p => W.materials.presets.indexOf(p) < 0);
// every contract name generates a real canvas texture; sizes + total time recorded
const t0 = performance.now();
for (const n of CONTRACT) { const m = W.textures.maps(n); if (!m || !m.map || !m.map.isTexture || !m.map.image || !m.map.image.width) probe.bad.push(n); else probe.sizes[n] = m.map.image.width; }
probe.genMs = Math.round(performance.now() - t0);
probe.factoryOk = CONTRACT.every(n => { const r = CTX.textures[n](THREE, CTX); return !!(r && r.map && r.map.isTexture && r.map.wrapS === THREE.RepeatWrapping && r.map.colorSpace === THREE.SRGBColorSpace); });
probe.bumpNames = CONTRACT.filter(n => W.textures.maps(n).bumpMap);
probe.emissiveNames = CONTRACT.filter(n => W.textures.maps(n).emissiveMap);
const t1 = performance.now(); W.textures.maps('brick', { size: 512 }); W.textures.maps('concrete', { size: 512 }); W.textures.maps('panelLit', { size: 512 }); probe.gen512Ms = Math.round(performance.now() - t1);
probe.aniso = W.textures.get('metal').anisotropy;
// deterministic in seed: a registered alias with the same recipe + seed paints the same pixels; another seed differs
const px = (n, o) => Array.from(W.textures.get(n, o).image.getContext('2d').getImageData(0, 0, 8, 8).data).join(',');
W.textures.set('rustA', { recipe: 'rust', seed: 1, size: 128 }); W.textures.set('rustB', { recipe: 'rust', seed: 2, size: 128 });
probe.deterministic = px('rust', { seed: 1, size: 128 }) === px('rustA') && px('rustA') !== px('rustB');
// the core's texture path: scatter({texture}) and props.define parts with t:
const crates = W.props.scatter('crate', 12, { area: 30, texture: 'rust', seed: 2 });
probe.scatterMap = crates.meshes.length > 0 && crates.meshes.some(m => m.material.map && m.material.map.isTexture);
W.props.define('bunker', { r: 1.2, jit: [1, 1], parts: [{ g: 'box', a: [2, 1.2, 2], p: [0, .6, 0], c: 1, t: 'concrete' }, { g: 'box', a: [1.2, .3, 1.2], p: [0, 1.35, 0], c: 5, t: 'hazard' }] });
const bunker = W.props.make('bunker', { pos: [4, 0, -3] });
probe.defineMap = bunker.children.length === 2 && bunker.children.every(m => m.material.map && m.material.map.isTexture);
// every preset on a sphere in front of the camera
const geo = new THREE.SphereGeometry(.7, 16, 12), ps = W.materials.presets; probe.presetCount = ps.length;
ps.forEach((p, i) => { const m = W.materials.make(p); if (!m || !m.isMaterial) probe.presetFail.push(p); const mesh = new THREE.Mesh(geo, m); mesh.position.set((i - ps.length / 2) * 1.7, 1.3, -1); W.add(mesh); });
const ff = W.materials.make('forcefield'); ff.userData.hit([1, 1, 1]); probe.hitOk = ff.userData.uniforms.hit.value[0].w === W.materials.time;
probe.uniformsOk = ['hologram', 'forcefield', 'dissolve', 'lava', 'glass', 'water', 'chrome', 'crystal', 'neon'].every(p => { const m = W.materials.make(p); return !!(m.userData.uniforms && m.userData.uniforms.time && m.userData.preset === p); });
const hero = W.props.character({ role: 'guard', seed: 3, pos: [0, 0, 3] }); W.materials.apply(hero, 'hologram');
{ let hm = null; hero.parts.head.traverse(n => { if (!hm && n.isMesh) hm = n; }); probe.applied = !!(hm && hm.material.userData.preset === 'hologram'); }
const toonBox = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), W.materials.make('toon', { color: '#ff8844' })); toonBox.position.set(-3, .5, 2); W.add(toonBox);
const ol = W.materials.outline(toonBox, { thickness: .04 }); probe.outline = ol.meshes.length && ol.meshes[0].parent === toonBox ? 1 : 0;
const olc = W.materials.outline(crates.meshes[0]); probe.outline += olc.meshes.length && olc.meshes[0].isInstancedMesh ? 1 : 0;
const gm = W.materials.ground({ texture: 'grass', blend: ['dirt', 'slope'] }); probe.ground = !!(gm && W.ground.material === gm && gm.map && gm.userData.preset === 'ground-slope');
const gt = W.materials.ground({ texture: 'sand', triplanar: true, repeat: 20 }); probe.groundTri = !!(gt && gt.userData.preset === 'ground-tri');
// bad input never throws
try { W.textures.get('nope'); W.materials.make('nope'); W.materials.make(); W.materials.apply(null, 'metal'); W.materials.ground('nope'); W.materials.outline(); W.textures.set(); probe.badInputOk = true; } catch (e) { probe.badInputOk = String(e); }
const dis = W.materials.make('dissolve', { color: '#44aaff' }); const dm = new THREE.Mesh(geo, dis); dm.position.set(3, 1, 2); W.add(dm);
const lavaSlab = new THREE.Mesh(new THREE.BoxGeometry(6, .2, 3), W.materials.make('lava')); lavaSlab.position.set(0, .2, 4); W.add(lavaSlab);
try { const gl = W.renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info'); probe.sw = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'n/a'; } catch (e) { probe.sw = 'err'; }
YuviKit.init({
  title: 'חומרים', subtitle: 'עיר', palette: ['#1e1e2e', '#89dceb'],
  hud: [{ id: 'score', label: 'ניקוד', value: 0 }],
  onStart: () => {}
});
W.run();
YuviKit.loop(() => { probe.frames++; probe.time = W.materials.time; dis.userData.uniforms.progress.value = Math.min(.6, probe.frames / 120); probe.stats = W.stats; });
</script>
</body></html>""" % {"three": THREE_URL, "contract": CONTRACT, "presets": PRESETS}


def _cdn_reachable() -> bool:
    try:
        return _head(THREE_URL, 5.0) == 200
    except Exception:  # noqa: BLE001
        return False


def _harness_with_materials(nonce: str) -> str:
    core = W3D_PATH.read_text(encoding="utf-8")
    mat = MAT_PATH.read_text(encoding="utf-8")
    return build_harness(LEARN_DATA, nonce=nonce) + "".join("\n<script>\n" + src.replace("</script", "<\\/script") + "\n</script>" for src in (core, mat))


def test_materials_stays_small_and_parses():
    src = MAT_PATH.read_text(encoding="utf-8")
    assert len(src.splitlines()) <= 950, "yuvi_world3d_materials.js has a hard cap of 950 lines"
    assert src.startswith("/*") and src.rstrip().endswith("})();")
    assert "</script" not in src and "import " not in src.split("*/", 1)[1]
    assert "YuviWorld3D.use(" in src
    for name in CONTRACT:
        assert ("R.%s = " % name) in src, "contract texture %s missing from the recipes" % name
    node = shutil.which("node")
    if not node:
        pytest.skip("node not installed")
    subprocess.run([node, "--check", str(MAT_PATH)], check=True, timeout=30)


def test_materials_skill_fragment_exists():
    doc = (HARNESS_DIR.parent / "skills" / "world3d_materials.md").read_text(encoding="utf-8")
    assert doc.lstrip().startswith("## "), "a fragment appended under world3d.md: H2 headings only"
    assert "W.materials.make" in doc and "W.textures.get" in doc and "W.materials.ground" in doc
    for name in ("panelLit", "hazard", "hologram", "dissolve", "forcefield"):
        assert name in doc


@pytest.mark.slow
def test_materials_game_passes_validation():
    if not chromium_available():
        pytest.skip("Playwright Chromium not installed")
    if not _cdn_reachable():
        pytest.skip("Three.js CDN unreachable")
    res = validate_html_sync(MAT_GAME, preinject_html=_harness_with_materials("w3dm"), settle_ms=1500, interaction_settle_ms=1200)
    assert res.validator_error is None
    assert res.errors == [], res.errors          # a GLSL compile failure is a console.error from three
    assert res.ok
    assert res.clicked_start
    assert res.heartbeat > 0
    assert res.canvas_blank is False
    assert res.phases.get("first_frame_blank") is False
    probe = res.yuvi_state["mat"]
    print("materials probe:", {k: probe[k] for k in ("genMs", "gen512Ms", "sizes", "sw", "aniso", "stats")})
    assert probe["hasApi"] is True
    assert probe["missingRegistry"] == [], probe["missingRegistry"]
    assert probe["missingNames"] == [], probe["missingNames"]
    assert probe["presetsExtra"] == [], probe["presetsExtra"]
    assert probe["bad"] == [], probe["bad"]
    assert probe["factoryOk"] is True
    assert set(probe["sizes"].values()) <= {256, 512}
    assert probe["genMs"] < 2500, "all %d textures generated in %d ms" % (len(CONTRACT), probe["genMs"])
    assert len(probe["bumpNames"]) >= 20 and "lava" in probe["emissiveNames"] and "panelLit" in probe["emissiveNames"]
    assert probe["deterministic"] is True
    assert probe["scatterMap"] is True, "props.scatter({texture:'rust'}) must reach matFor through texOf"
    assert probe["defineMap"] is True, "props.define parts with t: must be textured"
    assert probe["presetCount"] >= len(PRESETS) and probe["presetFail"] == [], probe["presetFail"]
    assert probe["uniformsOk"] is True and probe["hitOk"] is True
    assert probe["applied"] is True
    assert probe["outline"] == 2
    assert probe["ground"] is True and probe["groundTri"] is True
    assert probe["badInputOk"] is True, probe["badInputOk"]
    assert probe["frames"] > 0 and probe["time"] > 0, "W.update must advance the shared time uniform"
    assert probe["stats"]["drawCalls"] > 0
