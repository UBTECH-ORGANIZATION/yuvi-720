## Lighting, weather & atmosphere

`W.lighting`, `W.weather`, `W.atmo` retune the biome for a mood and dress it with weather. Rule one: **the kid must see where
to go** — a night scene keeps a cool moon key, a blue fill, warm lamps and a fog floor. Apply the preset right after `world()`,
before `decorate()`; call `W.lighting.readability()` at the end of setup and act on its `hint`.

| Call | Args | Returns |
|---|---|---|
| `W.lighting.apply(preset, o)` | `noon goldenHour overcast dusk night nightIndustrial (moon + cool fill + sodium floods, one sweeping) moonlitRain (+rain) neonCity (cyan/magenta lamps) alarm (pulsing red) cinematicFog (+fog bank + god rays) underground (torches) space`; `o = {intensity=1, fill?, exposure?, fog?:false, fogNear?, fogFar?, sky?:false, lights?:false, weather?:false}` — retunes hemi/sun/fill/exposure/fog/sky/disc/stars, adds the preset's lights | `{name, lights, remove()}`; applying another preset removes the previous one (lights and weather) |
| `W.lighting.timeOfDay(t)` | hours 0..24: night → dawn 6.5 → noon → golden 17 → dusk 19 → night; per frame for a day cycle | handle |
| `W.lighting.flood(pos, o)` | `o = {target:[x,0,z] (default: toward the centre), color='#ffb36b', intensity=60, angle=.45, penumbra, distance, cone=true (fake volumetric), pool=true (light disc on the ground), sweep?: rad/s}` | `{light (SpotLight, null past the cap), cone, remove()}` |
| `W.lighting.lamp(pos, o)` | `o = {color='#ffd48a', intensity=14, distance=16, flicker?: true\|speed, bulb=true, pool=true}` | `{light (PointLight, null past the cap), glow, remove()}` — past the 10-light cap it is still a bulb + glow + floor pool |
| `W.lighting.emissive(mesh, color, intensity=1)` | a `parts.head`, a sign, a crystal — clones the material, sets `emissive` | the mesh |
| `W.lighting.godRays(dir?, {count=5, length, width, color, opacity=.16})` | additive planes from the sun direction | `{group, remove()}` |
| `W.lighting.readability({min=.1})` | samples the frame at 32×18 | `{ok, meanLum 0..1, spread, hint}` |
| `W.weather.set(kind, o)` | `rain {count, wind:[x,0,z], splash} · storm {interval=6, thunder:'explode'} · snow · fog (ground planes + denser fog) · dust · embers · fireflies · ash · sandstorm · none`; `o.fog:false` leaves the scene fog alone | `{kind, remove(), strike() (storm)}` — one at a time; counts halve on the software checker |
| `W.atmo.puddles(n, {area, size, color})` | dark glossy shapes that catch the lamps and the moon | `{meshes, remove()}` |
| `W.atmo.wind({strength=.18, dir:[x,0,z]})` | vertex sway on scattered `tree bush grass flower cactus` (later scatters too) | `{strength, remove()}` |
| `W.atmo.smoke(pos, o)` / `steam(pos, o)` / `sparks(pos, o)` | `o = {count, life, size, color, rate}` | `{points, remove()}` |
| `W.atmo.lightShaft(pos, dir, {length=10, angle=.3, color})` | a beam without a light (window, hatch, crack) | `{cone, remove()}` |
| `W.atmo.skyline({perBuilding=12, density=.55})` · `W.atmo.vignette(strength=.55)` | lit windows on a `backdrop:'skyline'` ring · DOM overlay under the HUD (`0` hides) | `{count, remove()}` · `{el, remove()}` |
| `W.lighting.current / presets / sw` · `W.weather.current / kinds` | — | state; `sw` is true on the software renderer |

### Canonical usage — a rainy night industrial yard that is still readable

```js
const W = YuviWorld3D.world(THREE, { preset: 'night', seed: 12, size: 110, backdrop: 'skyline', ambient: false });
W.lighting.apply('nightIndustrial');                       // moon key + blue fill + 3 sodium floods + 2 lamps
const dec = W.decorate({ density: .9, seed: 4 });
W.weather.set('storm', { interval: 8 });                    // rain streaks, splashes, lightning + thunder
W.atmo.puddles(10, { area: 26 }); W.atmo.wind({ strength: .2 }); W.atmo.skyline(); W.atmo.vignette(.45);
W.atmo.smoke([dec.landmark.position.x + 3, 6, dec.landmark.position.z]);
W.lighting.lamp([0, 3.2, -12], { color: '#ffb36b', flicker: true });               // the goal is the brightest spot
const hero = W.props.character({ role: 'hero', seed: 3, pos: [0, 0, 5] });
W.lighting.emissive(hero.parts.head, '#22d3ee', 1.2);                              // silhouettes read against dark walls
const ctrl = W.player.fps({ pos: [0, 0, 6] }).collide(dec);
if (!W.lighting.readability().ok) W.lighting.apply('nightIndustrial', { fill: .95, exposure: 1.6 });
YuviKit.init({ /* … */ onStart: () => ctrl.requestLook() }); W.run();
```

### WRONG → RIGHT

| Wrong | Right |
|---|---|
| `scene.background = new THREE.Color(0)`, `fill: 0`, `exposure: .6` for "night mood" | `W.lighting.apply('night')` — mood is colour contrast (cool moon vs warm lamps), never darkness; fill ≥ .5, exposure ≥ 1.3, fog colour ≥ `#101828` |
| a night scene lit by point lights only | moon key + fill + lamps — the preset does all three; lamps alone leave the ground black between them |
| `fog: {near: 3, far: 25}` on a 120-unit world | near ≥ 12 %, far ≥ 55 % of `size` (the core floors them); weather tightens fog itself (rain ×.78, storm ×.7, sandstorm ×.5) |
| 20 `new THREE.PointLight()` in a ring | `W.lighting.lamp(...)` — 10 real lights per world (shared with props), the rest are bulbs + glow + pools |
| `new THREE.SpotLight()` with no visible beam | `W.lighting.flood(pos, {target})` — light + volumetric cone + ground pool; `sweep` for a searchlight |
| `weather.set('rain')` then `weather.set('snow')` | one weather at a time; `storm` includes rain; `none` clears |
| black enemies at night | `W.lighting.emissive(enemy.parts.head, '#ff5555', 1.2)` — every character gets a rim of colour |
| bloom / `EffectComposer` for glow | emissive materials + `godRays` + lamps' glow sprites; no post-processing in the checker |
