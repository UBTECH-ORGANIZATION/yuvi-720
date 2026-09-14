"""YuviWorld3D atmosphere plugin (lighting presets, weather, atmo props), driven through the real validator.

The fixture builds a night world, applies every lighting preset synchronously
(render + a 32x18 luminance sample after each, the same way the checker
samples a canvas), then cycles every weather kind inside the game loop and
records probes on ``window.__yuvi.atmo``. The readability floor asserted for
``nightIndustrial`` is the user's complaint made executable: a night FPS must
not be near-black. Skips without Chromium or the CDN.
"""
import shutil
import subprocess

import pytest

from game_gen.harness import HARNESS_DIR, build_harness
from game_gen.libraries import AVAILABLE_LIBRARIES, _head
from game_gen.validator import chromium_available, validate_html_sync

W3D_PATH = HARNESS_DIR / "yuvi_world3d.js"
ATMO_PATH = HARNESS_DIR / "yuvi_world3d_atmo.js"
THREE_URL = AVAILABLE_LIBRARIES["three"]["cdn"]
LEARN_DATA = {"component": {"id": "c1", "title": "מסה"}, "objective": {"id": "o1", "title": "נטו וברוטו"}, "language": "he"}

PRESETS = ["noon", "goldenHour", "overcast", "dusk", "night", "nightIndustrial", "moonlitRain", "neonCity", "alarm", "cinematicFog", "underground", "space"]
WEATHERS = ["rain", "storm", "snow", "fog", "dust", "embers", "fireflies", "ash", "sandstorm", "none"]
#: mean luminance (0..1) a dark preset must reach on the validator's software renderer — calibrated on the fixture below
DARK_FLOOR = 0.10

ATMO_GAME = """<!DOCTYPE html>
<html lang="he"><head><meta charset="UTF-8"><title>atmo game</title>
<style>body{background:#1e1e2e}</style></head>
<body>
<script type="module">
import * as THREE from '%(three)s';
const probe = (window.__yuvi.atmo = { hasApi: false, lum: {}, read: {}, handles: {}, lightsAfter: {}, weatherOk: {}, weatherErrors: [], frames: 0, stats: null, tod: null, extras: {}, stubOk: false, sw: null });
const W = YuviWorld3D.world(THREE, { preset: 'night', seed: 5, size: 100, backdrop: 'skyline' });
probe.hasApi = !!(W.lighting && W.weather && W.atmo && typeof W.lighting.apply === 'function' && typeof W.weather.set === 'function');
probe.sw = W.lighting.sw;
W.decorate({ density: .8, seed: 2 });
const hero = W.props.character({ role: 'hero', seed: 3, pos: [0, 0, 4] });
const ctrl = W.player.fps({ speed: 6, pos: [0, 0, 6] });
// robustness: bad args warn, never throw
try { W.lighting.apply('nope'); W.weather.set('lava'); W.lighting.emissive(null); W.atmo.lightShaft(); W.atmo.skyline(); probe.stubOk = true; } catch (e) { probe.stubOk = String(e); }
// every lighting preset: apply, render one frame, sample the canvas (what the checker sees)
const sample = () => {
  const cv = document.createElement('canvas'); cv.width = 32; cv.height = 18; const g = cv.getContext('2d', { willReadFrequently: true });
  g.drawImage(W.renderer.domElement, 0, 0, 32, 18); const d = g.getImageData(0, 0, 32, 18).data; let s = 0;
  for (let i = 0; i < d.length; i += 4) s += (d[i] * 3 + d[i + 1] * 6 + d[i + 2]) / 10;
  return +(s / (d.length / 4) / 255).toFixed(3);
};
const PRESETS = %(presets)s;
for (const name of PRESETS) {
  const h = W.lighting.apply(name);
  probe.handles[name] = { name: h.name, lights: h.lights.length, weather: W.weather.current ? W.weather.current.kind : null };
  W.update(0.016); W.render();
  probe.lum[name] = sample();
  probe.read[name] = W.lighting.readability({ render: false });
  probe.lightsAfter[name] = W.lights.length;
}
W.lighting.timeOfDay(7.5); probe.tod = { name: W.lighting.current.name, sunY: +W.sun.position.y.toFixed(1), lights: W.lights.length };
const H = W.lighting.apply('nightIndustrial');
probe.lightsAfter.final = W.lights.length;
// atmo props on top of the final preset
const puddles = W.atmo.puddles(8, { area: 20 });
const wind = W.atmo.wind({ strength: .2 });
const smoke = W.atmo.smoke([4, 1, -6]); const steam = W.atmo.steam([-4, .5, -5]); const sparks = W.atmo.sparks([2, 1.2, -8]);
const shaft = W.atmo.lightShaft([-6, 8, -4], [0, -1, 0]);
const sky = W.atmo.skyline({ perBuilding: 10 });
const vig = W.atmo.vignette(.5);
const lampCapped = []; for (let i = 0; i < 12; i++) lampCapped.push(W.lighting.lamp([10 + i, 3, 10], { color: '#ffaa00' }));
W.lighting.emissive(hero.parts.head, '#22d3ee', 1.5);
probe.extras = { puddles: puddles.meshes.length, windKind: wind.kind, smoke: !!smoke.points, shaft: !!shaft.cone, windows: sky.count, vignette: !!document.getElementById('yw-vignette'), lightsCapped: W.lights.length, cappedLampsWithoutLight: lampCapped.filter(l => !l.light).length, godRays: !!W.lighting.godRays(null, { count: 3 }).group };
W.update(0.016); W.render(); probe.lum.finalDressed = sample();
const WEATHERS = %(weathers)s;
let wi = 0, frameInWeather = 0, storm = null;
YuviKit.init({
  title: 'לילה תעשייתי', subtitle: 'גשם', palette: ['#1e1e2e', '#89dceb'],
  hud: [{ id: 'score', label: 'ניקוד', value: 0 }],
  onStart: () => { ctrl.requestLook(); }
});
W.run();
YuviKit.loop(dt => {
  probe.frames++; frameInWeather++;
  if (frameInWeather === 1 && wi < WEATHERS.length) {
    try { const h = W.weather.set(WEATHERS[wi]); probe.weatherOk[WEATHERS[wi]] = h.kind === WEATHERS[wi] || (WEATHERS[wi] === 'none' && h.kind === 'none'); if (WEATHERS[wi] === 'storm') { storm = h; h.strike(); } } catch (e) { probe.weatherErrors.push(WEATHERS[wi] + ': ' + e.message); }
  }
  if (frameInWeather >= 4) { frameInWeather = 0; wi++; }
  probe.stats = W.stats;
});
</script>
</body></html>""" % {"three": THREE_URL, "presets": PRESETS, "weathers": WEATHERS}


def _cdn_reachable() -> bool:
    try:
        return _head(THREE_URL, 5.0) == 200
    except Exception:  # noqa: BLE001
        return False


def _harness_with_atmo(nonce: str) -> str:
    parts = [W3D_PATH.read_text(encoding="utf-8"), ATMO_PATH.read_text(encoding="utf-8")]
    return build_harness(LEARN_DATA, nonce=nonce) + "".join("\n<script>\n" + p.replace("</script", "<\\/script") + "\n</script>" for p in parts)


def test_atmo_plugin_stays_small_and_parses():
    src = ATMO_PATH.read_text(encoding="utf-8")
    assert len(src.splitlines()) <= 900, "yuvi_world3d_atmo.js has a hard cap of 900 lines"
    assert src.startswith("/*") and src.rstrip().endswith("})();")
    assert "</script" not in src and "import " not in src.split("*/", 1)[1]
    assert "YuviWorld3D.use(" in src and "window.YuviWorld3D" in src, "a plugin registers through YuviWorld3D.use and guards the missing core"
    node = shutil.which("node")
    if not node:
        pytest.skip("node not installed")
    subprocess.run([node, "--check", str(ATMO_PATH)], check=True, timeout=30)


def test_atmo_plugin_survives_missing_core():
    """Injected before/without the core it must only warn (the guard), never throw."""
    node = shutil.which("node")
    if not node:
        pytest.skip("node not installed")
    script = "globalThis.window = {}; globalThis.console = { warn: () => {}, error: () => {} };\n" + ATMO_PATH.read_text(encoding="utf-8") + "\nprocess.stdout.write('ok');"
    out = subprocess.run([node, "-e", script], check=True, timeout=30, capture_output=True, text=True)
    assert out.stdout.strip() == "ok"


@pytest.mark.slow
def test_atmo_presets_weather_and_readability():
    if not chromium_available():
        pytest.skip("Playwright Chromium not installed")
    if not _cdn_reachable():
        pytest.skip("Three.js CDN unreachable")
    res = validate_html_sync(ATMO_GAME, preinject_html=_harness_with_atmo("atmo1"), settle_ms=1500, interaction_settle_ms=1500)
    assert res.validator_error is None
    assert res.errors == [], res.errors
    assert res.ok
    assert res.clicked_start
    assert res.heartbeat > 0
    assert res.canvas_blank is False
    assert res.phases.get("first_frame_blank") is False
    probe = res.yuvi_state["atmo"]
    assert probe["hasApi"] is True
    assert probe["stubOk"] is True, probe["stubOk"]
    # every preset applied, returned a handle with its name, and the previous preset's lights were removed
    for name in PRESETS:
        assert probe["handles"][name]["name"] == name
        assert probe["lightsAfter"][name] <= 10, (name, probe["lightsAfter"][name])
    assert probe["handles"]["nightIndustrial"]["lights"] >= 3, "moon + floodlights + lamps"
    assert probe["handles"]["moonlitRain"]["weather"] == "rain" and probe["handles"]["cinematicFog"]["weather"] == "fog"
    assert probe["handles"]["noon"]["weather"] is None
    # readability: no preset is near-black, the dark ones clear the floor, day is brighter than night
    lum = probe["lum"]
    for name in PRESETS:
        assert lum[name] >= 0.06, f"{name} renders near-black: {lum[name]}"
    assert lum["nightIndustrial"] >= DARK_FLOOR, f"nightIndustrial mean luminance {lum['nightIndustrial']} below {DARK_FLOOR} — the scene is unreadable"
    assert lum["night"] >= DARK_FLOOR and lum["moonlitRain"] >= DARK_FLOOR
    assert lum["noon"] > lum["night"]
    assert lum["finalDressed"] >= DARK_FLOOR
    for name in PRESETS:
        r = probe["read"][name]
        assert abs(r["meanLum"] - lum[name]) < 0.05, (name, r, lum[name])
    assert probe["read"]["nightIndustrial"]["ok"] is True, probe["read"]["nightIndustrial"]
    # timeOfDay lerps: dawn puts the sun low, leaves no preset lights behind
    assert probe["tod"]["name"] == "timeOfDay" and probe["tod"]["sunY"] < 60
    # atmo props + light cap
    ex = probe["extras"]
    assert ex["puddles"] == 8 and ex["windKind"] == "wind" and ex["smoke"] and ex["shaft"] and ex["vignette"] and ex["godRays"]
    assert ex["windows"] > 0, "skyline backdrop → lit windows"
    assert ex["lightsCapped"] <= 10 and ex["cappedLampsWithoutLight"] >= 1, "lamps past the cap fall back to emissive + glow"
    # weather: every kind set from the loop without an error, the loop kept running
    assert probe["weatherErrors"] == [], probe["weatherErrors"]
    assert probe["frames"] > 0
    assert all(probe["weatherOk"].get(k) for k in WEATHERS if k in probe["weatherOk"]), probe["weatherOk"]
    assert len(probe["weatherOk"]) >= 6, probe["weatherOk"]
    assert probe["stats"]["drawCalls"] > 0
