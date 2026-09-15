"""YuviWorld3D prop library plugin (``yuvi_world3d_props.js``).

A node-level data check (every kind is well-formed, ≥ 40 new kinds with ≥ 2
variants, textures within the materials contract, the interior set's kinds and
variants) plus three Chromium runs through the real validator: one world that
scatters a few of every new kind and builds every kind + variant with ``make``
(no console warnings), one that lays an industrial compound out with
``W.props.layout`` and collides an FPS rig with it, and one that builds the two
room plans (a giant house, a classroom). Skips without node / Chromium / the CDN.
"""
import json
import shutil
import subprocess

import pytest

from game_gen.harness import HARNESS_DIR, build_harness
from game_gen.libraries import AVAILABLE_LIBRARIES, _head
from game_gen.validator import chromium_available, validate_html_sync

W3D_PATH = HARNESS_DIR / "yuvi_world3d.js"
PROPS_PATH = HARNESS_DIR / "yuvi_world3d_props.js"
THREE_URL = AVAILABLE_LIBRARIES["three"]["cdn"]
LEARN_DATA = {"component": {"id": "c1", "title": "מסה"}, "objective": {"id": "o1", "title": "נטו וברוטו"}, "language": "he"}
SETS = ("industrial", "urban", "nature", "scifi", "medieval", "interior")
LAYOUTS = ("industrialNight", "harbour", "village", "scifiBase", "ruins", "city", "house", "classroom")
INTERIOR = {
    "table": {"dining", "coffee", "desk", "round"}, "chair": {"wood", "office", "stool", "armchair"}, "sofa": {"red", "blue", "leather", "corner"}, "bookshelf": {"full", "half", "empty", "tall"},
    "book": {"red", "blue", "green", "stack"}, "lampInterior": {"floor", "desk", "ceiling", "neon"}, "bed": {"single", "double", "bunk", "crib"}, "plant": {"pot", "fern", "cactus", "tall"},
    "cup": {"mug", "glass", "teapot", "bottle"}, "rug": {"round", "rect", "runner", "patterned"}, "tv": {"flat", "old", "monitor", "arcade"}, "fridge": {"white", "steel", "retro", "open"},
    "cabinet": {"kitchen", "wardrobe", "drawer", "safe"}, "toy": {"ball", "blocks", "car", "teddy"}, "pillow": {"square", "round", "long", "heart"}, "pictureFrame": {"landscape", "portrait", "mirror", "clock"},
    "staircase": {"wood", "stone", "spiral", "short"}, "wallInterior": {"plain", "wallpaper", "brick", "tiles"}, "doorway": {"open", "closed", "arch", "glass"}, "window": {"square", "wide", "round", "curtain"},
}
TEXTURES = {"metal", "metalDark", "metalBrushed", "rust", "concrete", "concreteDark", "brick", "brickRed", "wood", "woodDark", "plank", "sand", "grass", "dirt", "gravel",
            "asphalt", "tile", "plaster", "camo", "camoDesert", "panel", "panelLit", "hazard", "grid", "fabric", "leather", "bark", "leaves", "snow", "lava", "water", "scales", "canvas"}
GEOS = {"box": 3, "cyl": 4, "cone": 3, "sphere": 3, "dodeca": 2, "octa": 2}

# Loads the plugin with a stand-in YuviWorld3D and a minimal ctx, then dumps the registered kinds + layouts.
NODE_DUMP = r"""
const fs = require('fs');
const src = fs.readFileSync(process.argv[process.argv.length - 1], 'utf8');
const plugins = [];
global.window = { YuviWorld3D: { use: fn => plugins.push(fn) } };
global.console = console;
new Function(src)();
const core = k => ({ r: .6, jit: [1, 1], parts: [{ g: 'box', a: [1, 1, 1], p: [0, .5, 0], c: 5 }] });
const KINDS = { crate: core(), barrel: core(), building: core(), fence: core(), lamp: core(), column: core(), tree: core(), bush: core(), grass: core(), flower: core(), rock: core(), crystal: core(), boat: core(), streetlight: core(), path: core() };
const ctx = { KINDS, warn: m => { throw new Error(m); }, clamp: (v, a, b) => Math.max(a, Math.min(b, v)), half: 60, K: 1, textures: {}, water: null, groundY: () => 0, rand: Math.random, mulberry32: () => Math.random, seedNum: s => s, scene: { remove() {} } };
const W = { props: { scatter: () => ({ positions: [] }), place: () => ({ positions: [] }), make: () => ({ rotation: {} }) } };
plugins.forEach(p => p(W, null, ctx));
const out = { kinds: {}, sets: {}, layouts: W.props.layouts, textures: Object.keys(ctx.textures) };
for (const s of ['industrial', 'urban', 'nature', 'scifi', 'medieval', 'interior']) out.sets[s] = W.props.set(s);
for (const k in KINDS) out.kinds[k] = { r: KINDS[k].r, jit: KINDS[k].jit, parts: KINDS[k].parts, variants: KINDS[k].variants || {}, light: KINDS[k].light || null, soft: !!KINDS[k].soft, float: !!KINDS[k].float, len: KINDS[k].len || null, fresh: !!KINDS[k].__props };
process.stdout.write(JSON.stringify(out));
"""


def _dump() -> dict:
    node = shutil.which("node")
    if not node:
        pytest.skip("node not installed")
    res = subprocess.run([node, "-e", NODE_DUMP, str(PROPS_PATH)], capture_output=True, text=True, timeout=60, check=True)
    return json.loads(res.stdout)


def _check_parts(where: str, parts: list) -> None:
    assert isinstance(parts, list) and 1 <= len(parts) <= 14, f"{where}: {len(parts) if isinstance(parts, list) else parts} parts"
    for p in parts:
        assert p["g"] in GEOS, f"{where}: geometry {p.get('g')}"
        assert len(p["a"]) == GEOS[p["g"]] and all(isinstance(v, (int, float)) for v in p["a"]), f"{where}: args {p['a']}"
        assert all(v > 0 for v in p["a"][: {"box": 3, "cyl": 3, "cone": 2}.get(p["g"], 1)]), f"{where}: non-positive size {p['a']}"
        assert len(p["p"]) == 3, f"{where}: centre {p['p']}"
        c = p["c"]
        assert (isinstance(c, int) and 0 <= c <= 5) or (isinstance(c, str) and c.startswith("#") and len(c) == 7), f"{where}: colour {c!r}"
        assert p.get("t") is None or p["t"] in TEXTURES, f"{where}: texture {p.get('t')!r} outside the materials contract"
        assert p.get("e") in (None, True, "dark"), f"{where}: e={p.get('e')!r}"
        if "s" in p and p["s"] is not None:
            assert len(p["s"]) == 3 and all(v > 0 for v in p["s"]), f"{where}: scale {p['s']}"


def test_props_plugin_parses_and_stays_small():
    src = PROPS_PATH.read_text(encoding="utf-8")
    assert len(src.splitlines()) <= 1000, "yuvi_world3d_props.js has a hard cap of ~1000 lines"
    assert src.startswith("/*") and src.rstrip().endswith("})();")
    assert "</script" not in src and "import " not in src.split("*/", 1)[1] and "Math.random" not in src.split("*/", 1)[1]
    node = shutil.which("node")
    if not node:
        pytest.skip("node not installed")
    subprocess.run([node, "--check", str(PROPS_PATH)], check=True, timeout=30)


def test_props_library_data_is_well_formed():
    d = _dump()
    fresh = {k: v for k, v in d["kinds"].items() if v["fresh"]}
    assert len(fresh) >= 40, f"only {len(fresh)} new kinds"
    for k, v in fresh.items():
        assert v["r"] > 0 and len(v["jit"]) == 2 and 0 < v["jit"][0] <= v["jit"][1], f"{k}: r/jit"
        assert len(v["variants"]) >= 2, f"{k}: needs ≥ 2 named variants, has {list(v['variants'])}"
        _check_parts(k, v["parts"])
        for name, parts in v["variants"].items():
            _check_parts(f"{k}:{name}", parts)
        if v["light"]:
            assert set(v["light"]) >= {"c", "i", "d", "y"}, f"{k}: light spec"
    # every set lists only registered new kinds, every new kind is in exactly one set
    listed = [k for s in SETS for k in d["sets"][s]]
    assert set(listed) == set(fresh) and len(listed) == len(set(listed)), (set(listed) ^ set(fresh))
    assert all(len(d["sets"][s]) >= 8 for s in SETS), {s: len(d["sets"][s]) for s in SETS}
    # the core kinds gained variants without losing their default parts
    for k, want in (("crate", {"wood", "metal", "military", "glow"}), ("barrel", {"rusty", "blue", "toxic"}), ("building", {"office", "warehouse", "apartment", "shop"} - {"warehouse"})):
        assert want <= set(d["kinds"][k]["variants"]), (k, list(d["kinds"][k]["variants"]))
        assert d["kinds"][k]["parts"] == [{"g": "box", "a": [1, 1, 1], "p": [0, .5, 0], "c": 5}], f"{k}: default parts must stay untouched"
        for name, parts in d["kinds"][k]["variants"].items():
            _check_parts(f"{k}:{name}", parts)
    assert "warehouse" in fresh and fresh["warehouse"]["r"] >= 5
    assert set(LAYOUTS) <= set(d["layouts"])
    assert TEXTURES <= set(d["textures"]), "contract textures must resolve (flat colour) when the materials plugin is absent"


def test_interior_set_has_every_kind_and_variant():
    d = _dump()
    assert set(d["sets"]["interior"]) == set(INTERIOR), set(d["sets"]["interior"]) ^ set(INTERIOR)
    for k, want in INTERIOR.items():
        assert set(d["kinds"][k]["variants"]) == want, (k, list(d["kinds"][k]["variants"]))
    # wall-hung and flat kinds never block the player; wall pieces are 4 m segments like wallSegment; the lamp lights up
    assert all(d["kinds"][k]["soft"] for k in ("rug", "pillow", "pictureFrame", "window"))
    assert not any(d["kinds"][k]["soft"] for k in ("table", "sofa", "bookshelf", "book", "bed", "fridge", "wallInterior", "doorway", "staircase"))
    assert d["kinds"]["wallInterior"]["len"] == 4 and d["kinds"]["doorway"]["len"] == 4
    assert d["kinds"]["lampInterior"]["light"] and d["kinds"]["tv"]["light"] is None
    assert any(p.get("e") is True for p in d["kinds"]["tv"]["parts"]) and any(p.get("e") is True for p in d["kinds"]["window"]["parts"]), "screens and windows glow"


LIBRARY_GAME = """<!DOCTYPE html>
<html lang="he"><head><meta charset="UTF-8"><title>props library</title>
<style>body{background:#1e1e2e}</style></head>
<body>
<script type="module">
import * as THREE from '%(three)s';
const probe = (window.__yuvi.w3dp = { warns: [], built: false, frames: 0, setSizes: [], kinds: 0, scattered: 0, emptyScatter: [], placed: 0, madeKinds: 0, madeVariants: 0, emptyMake: [], upgrades: {}, stats: null, moved: false, lights: 0 });
const origWarn = console.warn; console.warn = function () { probe.warns.push(Array.prototype.join.call(arguments, ' ')); return origWarn.apply(console, arguments); };
const W = YuviWorld3D.world(THREE, { preset: 'night', seed: 5, size: 120 });
probe.built = !!(W.scene && W.renderer && typeof W.props.layout === 'function' && typeof W.props.set === 'function');
const sets = ['industrial', 'urban', 'nature', 'scifi', 'medieval', 'interior'];
probe.setSizes = sets.map(s => W.props.set(s).length);
const kinds = [].concat.apply([], sets.map(s => W.props.set(s)));
probe.kinds = kinds.length;
const handles = [];
kinds.forEach((k, i) => {
  const cx = (i %% 11 - 5) * 10, cz = Math.floor(i / 11) * 11 - 50;
  const h = W.props.scatter(k, 2, { area: [cx, cz, 4.5, 4.5], seed: 100 + i, lights: 1 });
  handles.push(h); probe.scattered += h.positions.length; if (!h.positions.length) probe.emptyScatter.push(k);
});
probe.placed += W.props.place('container', [[14, -30], { x: 22, z: -30, rot: Math.PI / 2, s: 1 }], { variant: 'open' }).positions.length;
probe.placed += W.props.place('wallSegment', [[-20, 30], [-16, 30], [-12, 30]], { variant: 'chainlink' }).positions.length;
probe.placed += W.props.place('crate', [[6, 8], [7.2, 8], [6.6, 9.1]], { variant: 'glow' }).positions.length;
const V = W.props.variants;
['crate', 'barrel', 'building'].forEach(k => { probe.upgrades[k] = V[k] || []; });
kinds.concat(['crate', 'barrel', 'building']).forEach(k => {
  const g = W.props.make(k, { add: false }); probe.madeKinds++; if (!g.children.length) probe.emptyMake.push(k);
  (V[k] || []).forEach(v => { const g2 = W.props.make(k, { variant: v, add: false }); probe.madeVariants++; if (!g2.children.length) probe.emptyMake.push(k + ':' + v); });
});
const ctrl = W.player.fps({ speed: 6, pos: [0, 0, 5] });
handles.forEach(h => ctrl.collide(h));
let start = null;
YuviKit.init({
  title: 'ספריית אביזרים', subtitle: 'לילה', palette: ['#1e1e2e', '#89dceb'],
  hud: [{ id: 'score', label: 'ניקוד', value: 0 }],
  onStart: () => { ctrl.requestLook(); start = [ctrl.pos.x, ctrl.pos.z]; }
});
W.run();
YuviKit.loop(() => { probe.frames++; if (start) probe.moved = probe.moved || Math.abs(ctrl.pos.x - start[0]) > 0.5; probe.stats = W.stats; probe.lights = W.lights.length; });
</script>
</body></html>""" % {"three": THREE_URL}


LAYOUT_GAME = """<!DOCTYPE html>
<html lang="he"><head><meta charset="UTF-8"><title>industrial compound</title>
<style>body{background:#1e1e2e}</style></head>
<body>
<script type="module">
import * as THREE from '%(three)s';
const probe = (window.__yuvi.w3dl = { warns: [], built: false, frames: 0, layouts: [], sets: 0, positions: 0, boxes: 0, landmark: null, path: 0, walls: 0, gate: 0, buildings: 0, unknown: 0, lights: 0, stats: null, moved: false, collided: false, others: {} });
const origWarn = console.warn; console.warn = function () { probe.warns.push(Array.prototype.join.call(arguments, ' ')); return origWarn.apply(console, arguments); };
const W = YuviWorld3D.world(THREE, { preset: 'night', seed: 11, size: 120 });
probe.built = !!(W.scene && W.renderer);
probe.layouts = W.props.layouts.slice();
const dec = W.props.layout('industrialNight', { seed: 4 });
probe.sets = dec.sets.length; probe.positions = dec.positions.length; probe.boxes = dec.positions.filter(p => p.hw != null).length;
probe.landmark = dec.landmark ? dec.landmark.name : null; probe.path = dec.path.length;
const byKind = k => dec.sets.filter(h => h.kind === k).reduce((n, h) => n + h.positions.length, 0);
probe.walls = byKind('wallSegment'); probe.gate = byKind('door'); probe.buildings = byKind('warehouse') + byKind('tank') + byKind('generator');
probe.unknown = W.props.layout('atlantis', {}).sets.length;
// the other recipes build and tear down cleanly on the same world
W.props.layouts.filter(n => n !== 'industrialNight').forEach(n => { const d = W.props.layout(n, { seed: 2, radius: 30 }); probe.others[n] = [d.sets.length, d.positions.length, !!d.landmark]; d.remove(); });
const ctrl = W.player.fps({ speed: 6, pos: [0, 0, 5] }).collide(dec);
probe.collided = ctrl.obstacles.length >= dec.positions.length;
let start = null;
YuviKit.init({
  title: 'מתחם תעשייתי', subtitle: 'לילה', palette: ['#1e1e2e', '#fab387'],
  hud: [{ id: 'score', label: 'ניקוד', value: 0 }],
  onStart: () => { ctrl.requestLook(); start = [ctrl.pos.x, ctrl.pos.z]; }
});
W.run();
YuviKit.loop(() => { probe.frames++; if (start) probe.moved = probe.moved || Math.abs(ctrl.pos.x - start[0]) > 0.5; probe.stats = W.stats; probe.lights = W.lights.length; });
</script>
</body></html>""" % {"three": THREE_URL}


ROOM_GAME = """<!DOCTYPE html>
<html lang="he"><head><meta charset="UTF-8"><title>giant house</title>
<style>body{background:#1e1e2e}</style></head>
<body>
<script type="module">
import * as THREE from '%(three)s';
const probe = (window.__yuvi.w3dr = { warns: [], built: false, frames: 0, house: null, tiny: null, cls: null, stats: null, moved: false, collided: false, lights: 0 });
const origWarn = console.warn; console.warn = function () { probe.warns.push(Array.prototype.join.call(arguments, ' ')); return origWarn.apply(console, arguments); };
const W = YuviWorld3D.world(THREE, { preset: 'night', seed: 8, size: 120 });
probe.built = !!(W.scene && W.renderer);
const sum = (d, k) => d.sets.filter(h => h.kind === k).reduce((n, h) => n + h.positions.length, 0);
const info = d => ({ sets: d.sets.length, positions: d.positions.length, boxes: d.positions.filter(p => p.hw != null).length, landmark: d.landmark ? d.landmark.name : null, scale: d.sets[0].positions[0].s,
  walls: sum(d, 'wallInterior'), doors: sum(d, 'doorway'), windows: sum(d, 'window'), rugs: sum(d, 'rug'), books: sum(d, 'book'), desks: sum(d, 'table'), chairs: sum(d, 'chair'), sofas: sum(d, 'sofa'), beds: sum(d, 'bed'), shelves: sum(d, 'bookshelf'),
  kinds: d.sets.map(h => h.kind).filter((k, i, a) => a.indexOf(k) === i).length, maxX: Math.max.apply(null, d.positions.map(p => Math.abs(p.x))), path: d.path.length });
const house = W.props.layout('house', { giant: true, seed: 3 });
probe.house = info(house);
const tiny = W.props.layout('house', { rooms: ['living'], giant: 10 }); probe.tiny = info(tiny); tiny.remove();
const cls = W.props.layout('classroom', { seed: 5, radius: 30 }); probe.cls = info(cls); cls.remove();
const ctrl = W.player.fps({ speed: 6, pos: [0, 0, 5] }).collide(house);
probe.collided = ctrl.obstacles.length >= house.positions.length;
let start = null;
YuviKit.init({
  title: 'בית ענק', subtitle: 'רובוט קטן', palette: ['#1e1e2e', '#f9e2af'],
  hud: [{ id: 'score', label: 'ניקוד', value: 0 }],
  onStart: () => { ctrl.requestLook(); start = [ctrl.pos.x, ctrl.pos.z]; }
});
W.run();
YuviKit.loop(() => { probe.frames++; if (start) probe.moved = probe.moved || Math.abs(ctrl.pos.x - start[0]) > 0.5; probe.stats = W.stats; probe.lights = W.lights.length; });
</script>
</body></html>""" % {"three": THREE_URL}


def _cdn_reachable() -> bool:
    try:
        return _head(THREE_URL, 5.0) == 200
    except Exception:  # noqa: BLE001
        return False


def _harness(nonce: str) -> str:
    """Core world3d + the props plugin (the materials plugin is deliberately left out: contract textures fall back to flat colour)."""
    scripts = "".join("\n<script>\n" + p.read_text(encoding="utf-8").replace("</script", "<\\/script") + "\n</script>" for p in (W3D_PATH, PROPS_PATH))
    return build_harness(LEARN_DATA, nonce=nonce) + scripts


def _run(html: str, nonce: str):
    if not chromium_available():
        pytest.skip("Playwright Chromium not installed")
    if not _cdn_reachable():
        pytest.skip("Three.js CDN unreachable")
    res = validate_html_sync(html, preinject_html=_harness(nonce), settle_ms=1500, interaction_settle_ms=1500)
    assert res.validator_error is None
    assert res.errors == [], res.errors
    assert res.ok
    assert res.clicked_start
    assert res.heartbeat > 0
    assert res.canvas_blank is False
    assert res.phases.get("first_frame_blank") is False
    return res


@pytest.mark.slow
def test_every_prop_kind_scatters_and_every_variant_builds():
    res = _run(LIBRARY_GAME, "w3dp")
    probe = res.yuvi_state["w3dp"]
    assert probe["built"] is True
    assert [w for w in probe["warns"] if "YuviWorld3D" in w] == [], probe["warns"]
    assert probe["kinds"] >= 40 and all(n >= 8 for n in probe["setSizes"]), probe["setSizes"]
    assert probe["scattered"] >= probe["kinds"] * 1.5, (probe["scattered"], probe["emptyScatter"])
    assert len(probe["emptyScatter"]) <= 3, probe["emptyScatter"]
    assert probe["placed"] == 8
    assert probe["madeKinds"] == probe["kinds"] + 3 and probe["madeVariants"] >= probe["kinds"] * 2
    assert probe["emptyMake"] == [], probe["emptyMake"]
    assert {"wood", "metal", "military", "glow"} <= set(probe["upgrades"]["crate"])
    assert {"rusty", "blue", "toxic"} <= set(probe["upgrades"]["barrel"])
    assert {"office", "apartment", "shop"} <= set(probe["upgrades"]["building"])
    assert probe["frames"] > 0
    assert probe["stats"]["props"] >= probe["scattered"] and probe["stats"]["drawCalls"] > 0
    assert probe["lights"] <= 10


@pytest.mark.slow
def test_industrial_layout_builds_a_compound_the_player_collides_with():
    res = _run(LAYOUT_GAME, "w3dl")
    probe = res.yuvi_state["w3dl"]
    assert probe["built"] is True
    assert [w for w in probe["warns"] if "YuviWorld3D" in w and "atlantis" not in w] == [], probe["warns"]
    assert any("atlantis" in w for w in probe["warns"]), "an unknown layout must warn and return an empty handle"
    assert probe["unknown"] == 0
    assert set(LAYOUTS) <= set(probe["layouts"])
    assert probe["sets"] >= 12, probe["sets"]
    assert probe["walls"] >= 40 and probe["boxes"] == probe["walls"], (probe["walls"], probe["boxes"])
    assert probe["gate"] == 1
    assert probe["buildings"] >= 5, probe["buildings"]
    assert probe["landmark"] == "landmark"
    assert probe["path"] >= 60, probe["path"]
    assert probe["positions"] > probe["walls"] + probe["buildings"]
    assert probe["collided"] is True
    for name, (n_sets, n_pos, has_land) in probe["others"].items():
        assert n_sets >= 8 and n_pos > 10 and has_land, (name, n_sets, n_pos, has_land)
    assert probe["frames"] > 0
    assert probe["moved"] is True, "ArrowRight / KeyD held by the validator must move the FPS rig"
    assert probe["lights"] <= 10
    assert probe["stats"]["drawCalls"] > 0


@pytest.mark.slow
def test_room_layouts_build_a_giant_house_and_a_classroom():
    res = _run(ROOM_GAME, "w3dr")
    probe = res.yuvi_state["w3dr"]
    assert probe["built"] is True
    assert [w for w in probe["warns"] if "YuviWorld3D" in w] == [], probe["warns"]
    h = probe["house"]
    assert h["scale"] == pytest.approx(6.5), h["scale"]                      # giant: true → ×8, capped so the 16 m plan fits a 120 world
    assert h["walls"] == 15 and h["doors"] == 1 and h["boxes"] == 17, h       # 4 × 4 slots, one is the doorway (two jambs collide)
    assert h["windows"] >= 4 and h["rugs"] >= 16 + 3 and h["books"] >= 4 and h["sofas"] == 1 and h["beds"] == 1 and h["shelves"] == 3, h
    assert h["sets"] >= 8 and h["kinds"] >= 15 and h["positions"] > 40, h
    assert h["landmark"] == "landmark" and h["path"] == 0
    assert 6.5 * 8 <= h["maxX"] <= 6.5 * 8 + 1, h["maxX"]                     # the ring sits on the plan's edge
    t = probe["tiny"]
    assert t["scale"] == 10 and t["walls"] == 7 and t["beds"] == 0 and t["sofas"] == 1, t   # one 8 m room at ×10
    c = probe["cls"]
    assert c["scale"] == 1 and c["walls"] == 13 and c["doors"] == 1 and c["boxes"] == 14, c   # 16 × 12 m ring, a closed door (solid slot)
    assert c["desks"] == 13 and c["chairs"] == 13 and c["books"] == 13 and c["windows"] == 3 and c["rugs"] == 0, c   # 4 × 3 pupils + the teacher
    assert c["sets"] >= 8 and c["positions"] > 10 and c["landmark"] == "landmark"
    assert probe["collided"] is True
    assert probe["frames"] > 0 and probe["moved"] is True
    assert probe["lights"] <= 10
    assert probe["stats"]["drawCalls"] > 0
