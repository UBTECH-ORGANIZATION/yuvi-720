/*
 * yuvi_world3d.js — YuviWorld3D, the opt-in 3D runtime for games that need a
 * real place: a designed low-poly biome (sky + sun/moon, fog, terrain, water,
 * backdrop, clouds, weather, birds), a scene layout from `decorate()`, instanced
 * props, real characters (humans / robots / animals with limb animation), an
 * avatar controller with follow cameras, an FPS rig, patrol-chase enemies,
 * pooled projectiles, hit bursts, a minimap and an objective strip.
 *
 *   const W = YuviWorld3D.world(THREE, {preset, seed, size, palette, fog, shadows, terrain, water, backdrop, clouds, ambient, birds, fish, el})
 *   W.decorate({density, seed}) / W.groundY(x, z)
 *   W.props.scatter(kind, count, o) / W.props.place(kind, positions, o) / W.props.make(kind, o)
 *   W.props.character({kind, role, animal, seed, ...}) → Group + .parts + .anim / W.props.actor(o)
 *   W.player.avatar(char, {camera, ...}) / W.player.fps({...}) / W.player.thirdPerson(mesh, {...})
 *   W.enemy(mesh, {...}) / W.projectiles({...}) / W.fx.hit(point, {...}) / W.fx.flashLight(ms)
 *   W.minimap(el, {scale, markers}) / W.objective(text) / W.raycast(from, dir, maxDist)
 *   W.update(dt) / W.render() / W.run() / W.resize() / W.dispose() / W.rand() / W.stats
 *
 * Classic script, injected right after yuvi_kit.js. The game imports Three.js
 * (module build, allow-listed URL) and passes the module in: this file never
 * imports, fetches or loads assets. Every call is safe once and never throws
 * on missing arguments (console.warn + a stub). Everything is built
 * synchronously, materials are Lambert, props are InstancedMesh, one shadow
 * light at most, no post-processing: the checker renders WebGL in software.
 */
(function () {
  if (window.YuviWorld3D) return;
  const warn = m => { try { console.warn('[YuviWorld3D] ' + m); } catch (e) {} };
  const kit = () => window.YuviKit || null;
  const noop = () => {};
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerpAngle = (a, b, t) => { let d = (b - a) % 6.2832; if (d > 3.1416) d -= 6.2832; if (d < -3.1416) d += 6.2832; return a + d * t; };

  // ── deterministic PRNG (mulberry32) ─────────────────────────────────────
  function seedNum(s) {
    if (typeof s === 'number' && isFinite(s)) return s >>> 0;
    const str = String(s == null ? 'yuvi' : s); let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
    return h >>> 0;
  }
  function mulberry32(a) {
    return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  // ── biomes (data). sky [bottom, top], fog [color, nearFrac, farFrac], hemi [sky, ground, intensity],
  //    sun [color, intensity, position], ground [colorA, colorB], palette roles 0 ground · 1 stone/wall ·
  //    2 foliage/accent · 3 light · 4 dark/wood · 5 highlight; disc sun|moon, terrain [hills, amplitude, island],
  //    water {level,color,waves}, backdrop mountain|skyline|dunes|rock, clouds n, ambient, birds, fish,
  //    layout {land [kind, scale], edge [kind, opts], path stone|plank|plate|road, scatter [[kind, n, opts]…], cluster [[kind, clusters, each, opts]…]} ──
  const B = (sky, fog, hemi, sun, ground, palette, x) => Object.assign({ sky: sky, fog: fog, hemi: hemi, sun: sun, ground: ground, palette: palette, disc: 'sun', terrain: [.3, 3], clouds: 6, birds: 0, fish: 0 }, x);
  const PRESETS = {
    desert: B(['#f4d4a0', '#5fb0e8'], ['#f1d3a4', .3, 1.1], ['#ffe8c0', '#b0824a', 1.7], ['#fff1d6', 2.6, [60, 80, 30]], ['#dcb56d', '#c79a52'], ['#dcb56d', '#c79a52', '#6f9a4a', '#f7ead0', '#5a3d22', '#ff7a45'],
      { terrain: [.5, 4], backdrop: 'dunes', clouds: 3, ambient: 'dust', birds: 3, layout: { land: ['tower', 1.1], edge: ['rock'], path: 'stone', scatter: [['cactus', 45], ['rock', 25], ['grass', 30, { colors: { 2: '#b9a66b' } }], ['barrel', 5], ['crate', 6], ['sign', 3]], cluster: [['tree', 2, 4, { variant: 'palm' }]] } }),
    forest: B(['#c5e6ff', '#3f8fd6'], ['#bcd9c8', .22, .95], ['#dff3ff', '#3f6b2a', 1.6], ['#fff6df', 2.4, [40, 70, 40]], ['#4f8f3b', '#3b7230'], ['#4f8f3b', '#8b8f82', '#2f7a34', '#e9f3d8', '#4a3220', '#ffb347'],
      { terrain: [.35, 3], backdrop: 'mountain', clouds: 8, ambient: 'dust', birds: 4, layout: { land: ['tower', 1], edge: ['tree', { variant: 'pine', scale: 1.3 }], path: 'stone', scatter: [['tree', 60, { variant: 'pine' }], ['tree', 25, { variant: 'round' }], ['bush', 35], ['grass', 120], ['flower', 40], ['rock', 15], ['campfire', 1]], cluster: [['tree', 4, 5, { variant: 'round' }]] } }),
    space: B(['#0d1230', '#05060f'], ['#0b0e20', .3, 1.2], ['#8a98ff', '#1a1030', 1.4], ['#dfe6ff', 2.2, [-50, 60, -30]], ['#3b3f52', '#2a2d3e'], ['#3b3f52', '#5a607a', '#7ff2ff', '#e8ecff', '#151726', '#ff5ea8'],
      { stars: true, dark: true, disc: 'moon', terrain: [.35, 3], backdrop: 'rock', clouds: 0, ambient: 'dust', layout: { land: ['tower', 1.2], edge: ['crystal', { scale: 1.6 }], path: 'plate', scatter: [['crystal', 40], ['rock', 50], ['pipe', 10], ['barrel', 8], ['crate', 10]], cluster: [['crystal', 4, 5]] } }),
    lab: B(['#e6eef5', '#9fb8cc'], ['#dbe6ee', .25, 1], ['#ffffff', '#8fa3b3', 1.9], ['#ffffff', 2.2, [30, 80, 50]], ['#c9d3dc', '#b4c0cb'], ['#c9d3dc', '#8fa1b0', '#31c9a8', '#ffffff', '#2f3a48', '#ff6b6b'],
      { grid: true, disc: null, terrain: [0, 0], backdrop: 'skyline', clouds: 0, layout: { land: ['building', 1.2], edge: ['barrier'], path: 'plate', scatter: [['pipe', 14], ['crate', 16], ['barrel', 10], ['lamp', 8], ['barrier', 10], ['crystal', 6]], cluster: [['crate', 3, 4]] } }),
    ocean: B(['#bfefff', '#2b8fd8'], ['#a9def2', .35, 1.3], ['#e8fbff', '#8a7a4a', 1.7], ['#fff8e6', 2.5, [50, 70, -40]], ['#e8d9a6', '#cdb877'], ['#e8d9a6', '#8f8a7a', '#4bc27d', '#ffffff', '#5a4a30', '#ff8c5a'],
      { terrain: [.4, 4, true], water: { level: -1.2, color: '#2a9ac8', waves: .25 }, clouds: 10, birds: 5, fish: 8, layout: { land: ['tower', 1.3], path: 'plank', scatter: [['tree', 36, { variant: 'palm' }], ['bush', 15], ['grass', 50], ['rock', 20], ['boat', 6], ['crate', 6], ['barrel', 4], ['sign', 3], ['flower', 20]], cluster: [['tree', 3, 4, { variant: 'palm' }]] } }),
    city: B(['#dfe7ee', '#6fa2d6'], ['#cfd8e0', .25, 1], ['#f0f4ff', '#6c6f75', 1.6], ['#fff3e0', 2.3, [-40, 70, 50]], ['#6d7278', '#5f6469'], ['#6d7278', '#a8adb5', '#4aa3ff', '#f2f4f7', '#2b2f36', '#ffd23f'],
      { grid: true, terrain: [0, 0], backdrop: 'skyline', clouds: 6, birds: 3, layout: { land: ['building', 2.2], edge: ['building', { scale: 1.3 }], path: 'road', scatter: [['building', 26, { scale: 1.1 }], ['streetlight', 14], ['barrier', 10], ['crate', 8], ['tree', 12, { variant: 'round' }], ['bush', 10], ['sign', 4], ['stall', 2]], cluster: [['building', 3, 4]] } }),
    night: B(['#182452', '#0b1030'], ['#0f1738', .2, .9], ['#6a7cff', '#0d1226', 1.5], ['#c8d4ff', 1.7, [-40, 60, 20]], ['#26304a', '#1d2538'], ['#26304a', '#3a4666', '#7cf0c8', '#dfe6ff', '#0c0f1c', '#ffd166'],
      { stars: true, dark: true, disc: 'moon', backdrop: 'mountain', clouds: 0, ambient: 'fireflies', layout: { land: ['tower', 1], edge: ['tree', { variant: 'pine', scale: 1.3 }], path: 'stone', scatter: [['tree', 55, { variant: 'pine' }], ['bush', 30], ['grass', 80], ['rock', 15], ['lamp', 8], ['campfire', 2]], cluster: [['tree', 3, 5, { variant: 'round' }]] } }),
    snow: B(['#eaf3fb', '#8fb8dc'], ['#e2ecf4', .2, .9], ['#ffffff', '#9fb4c8', 1.8], ['#fff6e8', 2.2, [30, 60, 40]], ['#f2f6fa', '#d7e2ec'], ['#f2f6fa', '#9fb0bf', '#2f5f4a', '#ffffff', '#4a3220', '#ff6b6b'],
      { terrain: [.5, 4], backdrop: 'mountain', clouds: 8, ambient: 'snow', layout: { land: ['building', .7], edge: ['tree', { variant: 'pine', scale: 1.3 }], path: 'stone', scatter: [['tree', 55, { variant: 'pine' }], ['rock', 20], ['crate', 6], ['fence', 8], ['campfire', 2], ['sign', 3]], cluster: [['tree', 3, 5, { variant: 'pine' }]] } }),
    jungle: B(['#d6f5d0', '#3a9c6a'], ['#b6dfbf', .18, .85], ['#e6ffe8', '#2a5a20', 1.6], ['#fff9dc', 2.3, [40, 70, 30]], ['#3f8a35', '#2f6b2a'], ['#3f8a35', '#7f8a72', '#25803a', '#eaffd6', '#4a3220', '#ff4f8b'],
      { terrain: [.45, 4], backdrop: 'mountain', clouds: 6, ambient: 'dust', birds: 6, layout: { land: ['tower', 1.1], edge: ['tree', { variant: 'round', scale: 1.5 }], path: 'stone', scatter: [['tree', 40, { variant: 'palm' }], ['tree', 40, { variant: 'round' }], ['bush', 50], ['grass', 120], ['flower', 50], ['rock', 15], ['column', 6]], cluster: [['tree', 4, 5, { variant: 'palm' }]] } }),
    volcano: B(['#6b2a1a', '#1e0f10'], ['#4a2018', .25, 1], ['#ff9a60', '#2a1210', 1.5], ['#ffb080', 2.1, [-50, 60, 30]], ['#4a3a38', '#2f2626'], ['#4a3a38', '#5a4c4a', '#ff7a2a', '#ffd0a0', '#1c1414', '#ff5a1a'],
      { dark: true, disc: null, terrain: [.6, 5], water: { level: -1.6, color: '#ff4d1a', waves: .12 }, backdrop: 'rock', clouds: 3, ambient: 'embers', layout: { land: ['tower', 1.1], edge: ['rock', { scale: 1.6 }], path: 'stone', scatter: [['rock', 60], ['crystal', 20], ['tree', 12, { variant: 'pine', colors: { 2: '#3a2a26' } }], ['barrel', 5]], cluster: [['crystal', 3, 5]] } }),
    ruins: B(['#e9dcc2', '#6c9ad6'], ['#dccfb6', .25, 1], ['#fff4e0', '#7a6a4a', 1.6], ['#fff1d6', 2.4, [50, 70, 30]], ['#8a9a5a', '#6f7f48'], ['#8a9a5a', '#c9bfa6', '#4d8a3a', '#f4ead8', '#5a4a3a', '#ffb347'],
      { backdrop: 'mountain', clouds: 8, ambient: 'dust', birds: 3, layout: { land: ['tower', 1.2], edge: ['column'], path: 'stone', scatter: [['column', 24], ['rock', 30], ['bush', 25], ['grass', 80], ['tree', 20, { variant: 'round' }], ['crate', 4], ['sign', 3]], cluster: [['column', 4, 4]] } }),
    farm: B(['#d9f0ff', '#5aa8e8'], ['#cfe3d8', .25, 1], ['#f0fbff', '#5a7a2a', 1.7], ['#fff6df', 2.5, [40, 70, 40]], ['#7fb64a', '#6aa03d'], ['#7fb64a', '#a08a6a', '#3f8a35', '#fff8e0', '#5a3d22', '#d9362a'],
      { terrain: [.2, 2], backdrop: 'mountain', clouds: 10, ambient: 'dust', birds: 4, layout: { land: ['building', .9, { colors: { 1: '#d9362a', 4: '#5a3d22' } }], edge: ['fence'], path: 'stone', scatter: [['fence', 24], ['tree', 25, { variant: 'round' }], ['bush', 15], ['grass', 100], ['flower', 50], ['crate', 10], ['barrel', 8], ['stall', 3], ['sign', 4]], cluster: [['crate', 3, 4]] } })
  };

  // ── prop kinds (data): parts of primitives; g geometry, a args, p centre, s scale, rz/rx roll,
  //    c palette role (or a hex), e unlit ('dark': glows only in dark biomes); r collision radius;
  //    jit per-instance scale range; variants named part sets; light a PointLight spec; soft: no collision; float: sits on water ──
  const R90 = Math.PI / 2;
  const PINE = [{ g: 'cyl', a: [.16, .24, 1.4, 6], p: [0, .7, 0], c: 4 }, { g: 'cone', a: [1.1, 2.4, 7], p: [0, 2.4, 0], c: 2 }, { g: 'cone', a: [.8, 1.8, 7], p: [0, 3.6, 0], c: 2 }];
  const ROUND = [{ g: 'cyl', a: [.18, .28, 1.6, 6], p: [0, .8, 0], c: 4 }, { g: 'sphere', a: [1.3, 7, 6], s: [1, .85, 1], p: [0, 2.5, 0], c: 2 }, { g: 'sphere', a: [.8, 6, 5], p: [.7, 3, .3], c: 2 }];
  const PALM = [{ g: 'cyl', a: [.14, .26, 3.2, 6], p: [0, 1.6, 0], c: 4 }, { g: 'box', a: [3, .12, .7], p: [0, 3.3, 0], c: 2 }, { g: 'box', a: [.7, .12, 3], p: [0, 3.3, 0], c: 2 }, { g: 'box', a: [2.2, .12, .6], rz: .6, p: [.8, 3, .8], c: 2 }, { g: 'box', a: [2.2, .12, .6], rz: -.6, p: [-.8, 3, -.8], c: 2 }];
  const KINDS = {
    tree:     { r: .7, jit: [.8, 1.4], parts: PINE, variants: { pine: PINE, round: ROUND, palm: PALM } },
    bush:     { r: .7, jit: [.7, 1.3], parts: [{ g: 'sphere', a: [.8, 6, 5], s: [1, .65, 1], p: [0, .45, 0], c: 2 }, { g: 'sphere', a: [.5, 5, 4], p: [.5, .5, .3], c: 2 }] },
    grass:    { r: .2, jit: [.7, 1.4], soft: true, parts: [{ g: 'cone', a: [.22, .6, 4], p: [0, .3, 0], c: 2 }, { g: 'cone', a: [.18, .5, 4], rz: .5, p: [.2, .22, 0], c: 2 }, { g: 'cone', a: [.18, .5, 4], rz: -.5, p: [-.2, .22, .1], c: 2 }] },
    flower:   { r: .2, jit: [.7, 1.3], soft: true, parts: [{ g: 'cyl', a: [.03, .03, .5, 4], p: [0, .25, 0], c: 2 }, { g: 'sphere', a: [.13, 6, 4], s: [1, .5, 1], p: [0, .52, 0], c: 5 }] },
    rock:     { r: .8, jit: [.5, 1.6], parts: [{ g: 'dodeca', a: [.8, 0], s: [1.1, .65, 1], p: [0, .4, 0], c: 1 }] },
    crate:    { r: .7, jit: [.8, 1.2], parts: [{ g: 'box', a: [1, 1, 1], p: [0, .5, 0], c: 5 }, { g: 'box', a: [1.06, .1, 1.06], p: [0, .5, 0], c: 4 }] },
    barrel:   { r: .5, jit: [.9, 1.1], parts: [{ g: 'cyl', a: [.45, .45, 1.1, 10], p: [0, .55, 0], c: 5 }, { g: 'cyl', a: [.48, .48, .12, 10], p: [0, .55, 0], c: 4 }] },
    building: { r: 2.7, jit: [.7, 1.8], parts: [{ g: 'box', a: [4, 8, 4], p: [0, 4, 0], c: 1 }, { g: 'box', a: [3, 1, 3], p: [0, 8.5, 0], c: 4 }, { g: 'box', a: [4.1, .5, 4.1], p: [0, 2.2, 0], c: 3, e: 'dark' }, { g: 'box', a: [4.1, .5, 4.1], p: [0, 4.4, 0], c: 3, e: 'dark' }, { g: 'box', a: [4.1, .5, 4.1], p: [0, 6.6, 0], c: 3, e: 'dark' }, { g: 'box', a: [1.2, 2, .3], p: [0, 1, 2.05], c: 4 }] },
    tower:    { r: 2, jit: [.9, 1.2], parts: [{ g: 'cyl', a: [1.5, 2, 9, 8], p: [0, 4.5, 0], c: 1 }, { g: 'cyl', a: [2.2, 2.2, .6, 8], p: [0, 9.2, 0], c: 4 }, { g: 'cone', a: [2, 2.2, 8], p: [0, 10.6, 0], c: 5 }, { g: 'cyl', a: [.5, .5, 1, 6], p: [0, 9.9, 0], c: 3, e: 'dark' }, { g: 'box', a: [1, 1.8, .3], p: [0, .9, 1.9], c: 4 }] },
    column:   { r: .6, jit: [.7, 1.3], parts: [{ g: 'box', a: [1.2, .3, 1.2], p: [0, .15, 0], c: 1 }, { g: 'cyl', a: [.35, .4, 2.6, 8], p: [0, 1.6, 0], c: 1 }, { g: 'box', a: [1, .3, 1], p: [0, 3, 0], c: 1 }] },
    stall:    { r: 1.4, jit: [1, 1], parts: [{ g: 'box', a: [2.6, .9, 1.2], p: [0, .45, 0], c: 4 }, { g: 'box', a: [.12, 2.4, .12], p: [-1.2, 1.2, -.5], c: 4 }, { g: 'box', a: [.12, 2.4, .12], p: [1.2, 1.2, -.5], c: 4 }, { g: 'box', a: [3, .12, 1.8], rz: 0, p: [0, 2.4, 0], c: 5 }, { g: 'box', a: [.8, .3, .6], p: [-.7, 1.05, .1], c: 2 }, { g: 'box', a: [.8, .3, .6], p: [.7, 1.05, .1], c: 3 }] },
    boat:     { r: 1.5, jit: [.9, 1.2], float: true, parts: [{ g: 'box', a: [1.4, .6, 3.2], p: [0, .3, 0], c: 4 }, { g: 'box', a: [1, .2, 2.6], p: [0, .65, 0], c: 5 }, { g: 'cyl', a: [.05, .06, 2.6, 5], p: [0, 1.8, 0], c: 4 }, { g: 'box', a: [1.4, 1.6, .06], p: [.7, 2, 0], c: 3 }] },
    sign:     { r: .3, jit: [1, 1], parts: [{ g: 'cyl', a: [.06, .08, 1.8, 5], p: [0, .9, 0], c: 4 }, { g: 'box', a: [1.1, .45, .08], p: [.3, 1.5, 0], c: 5 }] },
    campfire: { r: .8, jit: [1, 1], light: { c: '#ff9a3c', i: 1.8, d: 10, y: .9 }, parts: [{ g: 'cyl', a: [.1, .1, .9, 5], rz: R90, p: [0, .12, 0], c: 4 }, { g: 'cyl', a: [.1, .1, .9, 5], rz: R90, s: [1, 1, 1], p: [0, .12, .3], c: 4 }, { g: 'cone', a: [.3, .8, 6], p: [0, .5, 0], c: '#ff8c2a', e: true }, { g: 'cone', a: [.16, .5, 5], p: [0, .85, 0], c: '#ffe27a', e: true }, { g: 'cyl', a: [.7, .7, .18, 8], p: [0, .05, 0], c: 1 }] },
    streetlight: { r: .3, jit: [1, 1], light: { c: '#ffe9a8', i: 1.2, d: 12, y: 4.2 }, parts: [{ g: 'cyl', a: [.08, .12, 4.4, 5], p: [0, 2.2, 0], c: 4 }, { g: 'box', a: [1.4, .1, .1], p: [.6, 4.4, 0], c: 4 }, { g: 'box', a: [.5, .2, .3], p: [1.2, 4.3, 0], c: 3, e: true }] },
    cactus:   { r: .4, jit: [.8, 1.4], parts: [{ g: 'cyl', a: [.22, .28, 2.2, 6], p: [0, 1.1, 0], c: 2 }, { g: 'cyl', a: [.13, .13, .8, 5], rz: R90, p: [.5, 1.3, 0], c: 2 }, { g: 'cyl', a: [.13, .13, .8, 5], p: [.85, 1.7, 0], c: 2 }] },
    pipe:     { r: .6, jit: [.8, 1.2], parts: [{ g: 'cyl', a: [.4, .4, 4, 8], rz: R90, p: [0, .4, 0], c: 3 }, { g: 'cyl', a: [.5, .5, .3, 8], rz: R90, p: [1.6, .4, 0], c: 4 }] },
    barrier:  { r: .8, jit: [1, 1], parts: [{ g: 'box', a: [1.6, .9, .5], p: [0, .45, 0], c: 5 }, { g: 'box', a: [1.6, .12, .52], p: [0, .7, 0], c: 3 }] },
    lamp:     { r: .25, jit: [1, 1], light: { c: '#fff3c0', i: .9, d: 9, y: 3.3 }, parts: [{ g: 'cyl', a: [.07, .1, 3.2, 5], p: [0, 1.6, 0], c: 4 }, { g: 'sphere', a: [.28, 6, 5], p: [0, 3.3, 0], c: 3, e: true }] },
    fence:    { r: 1.2, jit: [1, 1], parts: [{ g: 'box', a: [2.4, .12, .1], p: [0, .5, 0], c: 4 }, { g: 'box', a: [2.4, .12, .1], p: [0, .9, 0], c: 4 }, { g: 'box', a: [.14, 1.1, .14], p: [-1.1, .55, 0], c: 4 }, { g: 'box', a: [.14, 1.1, .14], p: [1.1, .55, 0], c: 4 }] },
    crystal:  { r: .5, jit: [.6, 1.5], parts: [{ g: 'octa', a: [.6, 0], s: [1, 1.9, 1], p: [0, 1, 0], c: 5, e: true }, { g: 'octa', a: [.3, 0], s: [1, 1.6, 1], p: [.5, .5, .2], c: 5, e: true }] },
    path:     { r: .4, jit: [.8, 1.1], soft: true, parts: [{ g: 'box', a: [1, .1, 1], p: [0, .04, 0], c: 1 }] },
    actor:    { r: .5, jit: [1, 1], parts: [{ g: 'cyl', a: [.35, .45, 1.2, 8], p: [0, .6, 0], c: 5 }, { g: 'sphere', a: [.32, 8, 6], p: [0, 1.5, 0], c: 3 }] }
  };

  // ── character data: skins, hair, eyes; roles (clothes / hat / gear defaults, textures, age); animal bodies ──
  const SKIN = ['#f6d6c1', '#e8b898', '#d29b76', '#b97d58', '#8d5a3c', '#5c3a26', '#3e2a1e'], HAIRC = ['#2b1b0e', '#5a3d22', '#c9a15a', '#e8e0d0', '#b23a2f', '#1a1a1a', '#8a6a4a', '#d8b06a'], EYEC = ['#3b2a1a', '#5a3d22', '#2f6b3a', '#3a6fb0', '#6b7f8a', '#1a1a1a']; const HAIRS = ['short', 'buzz', 'curly', 'long', 'ponytail', 'bun', 'mohawk', 'bob', 'afro', 'braids', 'bald'], TOPS = ['tshirt', 'shirt', 'hoodie', 'jacket', 'vest', 'coat', 'dress', 'armor', 'labcoat', 'uniform'], BOTTOMS = ['jeans', 'shorts', 'skirt', 'cargo', 'suit'];
  const GEAR = ['helmet', 'goggles', 'headset', 'backpack', 'belt', 'holster', 'kneepads', 'cape', 'badge', 'tie', 'scarf', 'watch', 'glasses'], HATS = ['none', 'cap', 'helmet', 'hat', 'crown', 'hardhat', 'beret', 'chefhat', 'wizard', 'bandana', 'hood'], AGES = ['kid', 'teen', 'adult', 'elder'], BUILDS = ['slim', 'average', 'heavy', 'athletic'], BOTS = ['biped', 'wheel', 'tread', 'drone', 'mech', 'humanoid'];
  //    top/bottom: colour pools · tops/bottoms: clothing kinds · gear: always · pool: seeded subset · tex: texture names (used only when the materials plugin registers them) · accent: trim colour
  const ROLES = {
    hero: { top: ['#ff7a45', '#4aa3ff', '#7cf0c8'], tops: ['tshirt', 'jacket', 'hoodie'], bottom: ['#2f3a48', '#3b4a6b'], bottoms: ['jeans', 'cargo'], acc: 'backpack', pool: ['belt', 'watch', 'badge'] }, villager: { top: ['#b9a66b', '#7a8f5a', '#a86a4a', '#6f8fb0'], tops: ['shirt', 'tshirt', 'vest', 'dress'], bottom: ['#5a3d22', '#6b5a48'], bottoms: ['jeans', 'skirt', 'shorts'], hat: 'hat', pool: ['scarf', 'belt'] },
    guard: { top: ['#3b4a6b'], tops: ['uniform', 'armor'], bottom: '#2b2f36', bottoms: ['jeans'], hat: 'helmet', shoes: '#1a1a1a', hatC: '#8fa1b0', gear: ['belt'], pool: ['badge', 'kneepads', 'holster'] }, scientist: { top: ['#ffffff'], tops: ['labcoat'], bottom: ['#4a5568', '#2b2f36'], bottoms: ['jeans', 'suit'], acc: 'glasses', pool: ['badge', 'tie', 'watch'] },
    pirate: { top: ['#b8262b', '#3b2a1a'], tops: ['vest', 'shirt', 'coat'], bottom: '#2b2f36', bottoms: ['jeans'], hat: 'hat', acc: 'scarf', patch: true, hatC: '#1a1a1a', pool: ['belt', 'holster'] }, astronaut: { top: ['#f2f4f7'], tops: ['uniform'], bottom: '#f2f4f7', bottoms: ['jeans'], hat: 'helmet', acc: 'backpack', visor: true, hatC: '#ffffff', gear: ['belt'], pool: ['badge'] },
    farmer: { top: ['#4aa3ff', '#d9362a', '#7a8f5a'], tops: ['shirt', 'vest'], bottom: ['#3b6fd6', '#5a3d22'], bottoms: ['jeans', 'cargo'], hat: 'hat', hatC: '#e2c46a', pool: ['belt', 'scarf'] }, kid: { top: ['#ffd23f', '#ff5ea8', '#7cf0c8', '#4aa3ff'], tops: ['tshirt', 'hoodie', 'dress'], bottom: ['#4aa3ff', '#ff7a45', '#2f3a48'], bottoms: ['shorts', 'jeans', 'skirt'], hat: 'cap', acc: 'backpack', size: .72, kid: true, age: 'kid', pool: ['watch', 'badge'] },
    soldier: { top: ['#4b5d3a', '#5a5a48'], tops: ['vest'], bottom: ['#4b5d3a', '#7a7048'], bottoms: ['cargo'], hat: 'helmet', hatC: '#3f4a30', shoes: '#2b2620', gear: ['kneepads', 'belt'], pool: ['goggles', 'backpack', 'holster', 'headset'], tex: { top: 'camo', bottom: 'camo' }, age: 'adult' }, officer: { top: ['#1f2d4a', '#2b2f36'], tops: ['uniform', 'jacket'], bottom: ['#1f2d4a'], bottoms: ['suit'], hat: 'cap', hatC: '#1f2d4a', shoes: '#111111', gear: ['badge', 'belt'], pool: ['tie', 'headset', 'holster'] },
    engineer: { top: ['#ffb000', '#ff7a00'], tops: ['vest', 'jacket'], bottom: ['#3b4a6b', '#2f3a48'], bottoms: ['cargo', 'jeans'], hat: 'hardhat', hatC: '#ffd23f', gear: ['belt'], pool: ['goggles', 'kneepads', 'backpack', 'watch'] }, medic: { top: ['#ffffff', '#e8f4ff'], tops: ['labcoat', 'uniform'], bottom: ['#2b6fb0', '#4a5568'], bottoms: ['jeans', 'suit'], acc: 'glasses', gear: ['badge'], pool: ['headset', 'backpack', 'watch'], accent: '#e23a3a' },
    worker: { top: ['#3b6fd6', '#6b5a48', '#8a8a8a'], tops: ['shirt', 'vest', 'jacket'], bottom: ['#3b4a6b', '#5a3d22'], bottoms: ['cargo', 'jeans'], hat: 'cap', gear: ['belt'], pool: ['goggles', 'kneepads', 'headset'] }, chef: { top: ['#ffffff'], tops: ['jacket'], bottom: ['#2b2f36', '#4a5568'], bottoms: ['jeans'], hat: 'chefhat', hatC: '#ffffff', pool: ['scarf', 'watch'] },
    teacher: { top: ['#6f8fb0', '#a86a4a', '#7a8f5a', '#b23a2f'], tops: ['shirt', 'jacket', 'dress', 'coat'], bottom: ['#2f3a48', '#5a3d22'], bottoms: ['suit', 'jeans', 'skirt'], acc: 'glasses', pool: ['tie', 'badge', 'scarf', 'watch'] }, athlete: { top: ['#ff5ea8', '#4aa3ff', '#7cf0c8', '#ffd23f'], tops: ['tshirt'], bottom: ['#2f3a48', '#ffffff'], bottoms: ['shorts'], shoes: '#ffffff', gear: ['headset'], pool: ['watch', 'kneepads'], age: 'teen', build: 'athletic' },
    ninja: { top: ['#1a1a1a', '#2b2f36'], tops: ['uniform'], bottom: '#1a1a1a', bottoms: ['jeans'], hat: 'hood', hatC: '#1a1a1a', shoes: '#111111', gear: ['belt', 'scarf'], pool: ['kneepads'], accent: '#d9362a' }, explorer: { top: ['#b9a66b', '#8a7a4a'], tops: ['vest', 'shirt'], bottom: ['#8a7a4a', '#5a3d22'], bottoms: ['cargo', 'shorts'], hat: 'hat', hatC: '#8a7a4a', gear: ['backpack', 'belt'], pool: ['goggles', 'watch', 'scarf'] },
    royalty: { top: ['#7b2fbf', '#b8262b', '#1f4aa8'], tops: ['coat', 'dress'], bottom: ['#2b2f36', '#ffffff'], bottoms: ['suit', 'skirt'], hat: 'crown', gear: ['cape'], pool: ['badge', 'belt'], accent: '#ffd23f' }, wizard: { top: ['#2b1b6b', '#1f4aa8', '#5a2a8a'], tops: ['coat', 'dress'], bottom: '#2b2f36', bottoms: ['suit'], hat: 'wizard', hatC: '#2b1b6b', gear: ['cape', 'belt'], beard: true, age: 'elder', accent: '#ffd23f' },
    alien: { top: ['#7cf0c8', '#b48cff'], tops: ['uniform', 'armor'], bottom: ['#2f3a48'], bottoms: ['jeans'], skin: ['#7cf0c8', '#9ad46a', '#b48cff', '#6fd0ff'], eye: ['#111111'], hair: 'bald', bigEyes: true, antenna: true, pool: ['badge', 'belt'] }, ghostFriendly: { top: ['#f2f4f7', '#e6ecff'], tops: ['dress'], bottom: '#f2f4f7', bottoms: ['skirt'], skin: ['#f2f4f7', '#e6ecff'], eye: ['#2f3a48'], hair: 'bald', float: true, alpha: .8, expr: 'happy', shoes: '#f2f4f7' }
  };
  //    body [w, h, l], legs [count, length, radius], head [w, h, l] at headAt [x, y, z] (from the body's front-top), ears point|floppy|flat|round|tall, tail [length, tilt], colors, extras
  const ANIMALS = { dog: { body: [.32, .3, .62], legs: [4, .3, .06], head: [.26, .24, .3], headAt: [0, .1, .42], ears: 'floppy', tail: [.28, .8], colors: ['#b8743c', '#4a3220', '#e8e0d0'], snout: .12 },
    cat: { body: [.24, .24, .55], legs: [4, .26, .045], head: [.22, .2, .22], headAt: [0, .1, .36], ears: 'point', tail: [.4, .2], colors: ['#8a8a8a', '#e0a050', '#222222', '#f0f0f0'], snout: .06 }, horse: { body: [.5, .55, 1.3], legs: [4, .8, .07], head: [.28, .3, .5], headAt: [0, .55, .75], ears: 'point', tail: [.5, -.6], colors: ['#6b4a2a', '#2b1b0e', '#d9c9a8'], neck: [.24, .7], snout: .1 },
    sheep: { body: [.5, .48, .75], legs: [4, .3, .05], head: [.22, .24, .26], headAt: [0, .1, .48], ears: 'flat', tail: [.1, .5], colors: ['#f2f2f2', '#e8e0d0'], fluffy: true, dark: '#2b2f36' }, bird: { body: [.18, .18, .3], legs: [2, .12, .02], head: [.15, .15, .15], headAt: [0, .12, .18], wings: true, tail: [.14, -.2], colors: ['#4aa3ff', '#ff7a45', '#ffd23f', '#e8e0d0'], beak: true },
    crab: { body: [.6, .2, .4], legs: [6, .2, .035], colors: ['#ff5a3c', '#ff8c5a'], claws: true }, fish: { body: [.22, .3, .6], legs: [0], colors: ['#ff8c5a', '#4aa3ff', '#ffd23f', '#7cf0c8'], fins: true }, wolf: { body: [.34, .32, .7], legs: [4, .34, .06], head: [.27, .25, .34], headAt: [0, .12, .46], ears: 'point', tail: [.34, .5], colors: ['#7a7f86', '#4a4e55', '#b9bcc0'], snout: .13, dark: '#3a3d42', bushy: true },
    bear: { body: [.62, .6, .95], legs: [4, .34, .1], head: [.4, .36, .38], headAt: [0, .2, .55], ears: 'round', tail: [.08, .8], colors: ['#5a3d22', '#3a2a1a', '#8a6a4a'], snout: .12 }, rabbit: { body: [.22, .22, .34], legs: [4, .14, .035], head: [.2, .2, .2], headAt: [0, .14, .22], ears: 'tall', tail: [.06, 1.2], colors: ['#e8e0d0', '#b9a68a', '#8a8a8a'], snout: .04, hop: true },
    deer: { body: [.4, .45, 1], legs: [4, .7, .05], head: [.22, .24, .4], headAt: [0, .5, .6], ears: 'point', tail: [.12, .8], colors: ['#a86a4a', '#c9a15a', '#8a5a3c'], neck: [.16, .55], antlers: true, snout: .08 }, fox: { body: [.26, .26, .58], legs: [4, .26, .045], head: [.22, .2, .3], headAt: [0, .1, .38], ears: 'point', tail: [.42, .3], colors: ['#e07a2a', '#d96a1a'], snout: .1, dark: '#f2ede6', bushy: true },
    duck: { body: [.24, .22, .38], legs: [2, .1, .025], head: [.16, .16, .16], headAt: [0, .18, .2], wings: true, tail: [.12, .6], colors: ['#f2f2f2', '#ffd23f', '#5a8a3a'], beak: true, dark: '#ff8c2a' }, turtle: { body: [.44, .18, .56], legs: [4, .12, .05], head: [.16, .14, .2], headAt: [0, -.02, .36], tail: [.1, .9], colors: ['#5a8a3a', '#7a9a4a'], shell: '#3a5a2a', dark: '#4a7a3a' },
    dragon: { body: [.4, .4, .8], legs: [4, .3, .07], head: [.3, .28, .42], headAt: [0, .3, .55], ears: 'point', tail: [.6, .3], colors: ['#4bc27d', '#b48cff', '#ff8c5a'], neck: [.18, .4], wings: true, horns: true, snout: .14, dark: '#ffd23f' } };

  // ── stub: what every entry point returns when it cannot work ────────────
  function stub() {
    const h = { positions: [], meshes: [], remove: noop };
    const c = { object: null, camera: null, pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, yaw: 0, obstacles: [], onGround: true, update: noop, lookAt: noop, enable: noop, requestLook: noop, collide: noop, teleport: noop };
    const ch = () => ({ position: { x: 0, y: 0, z: 0, set: noop, copy: noop }, rotation: { x: 0, y: 0, z: 0 }, parts: {}, sockets: {}, face: { expression: 'neutral', set: noop }, anim: { walk: noop, run: noop, idle: noop, wave: noop, jump: noop, hit: noop, die: noop, talk: noop, update: noop, aim: noop, crouch: noop, sit: noop, carry: noop, celebrate: noop, point: noop, lookAt: noop } });
    return { scene: null, camera: null, renderer: null, ground: null, water: null, palette: [], size: 0, stats: {}, groundY: () => 0,
      add: noop, remove: noop, update: noop, render: noop, run: noop, resize: noop, dispose: noop, raycast: () => null, rand: Math.random, decorate: () => ({ sets: [], positions: [], landmark: null, remove: noop }),
      props: { scatter: () => h, place: () => h, make: () => null, character: ch, actor: ch, kinds: Object.keys(KINDS), sets: [] }, player: { fps: () => c, thirdPerson: () => c, avatar: () => c, current: null },
      enemy: () => ({ state: 'dead', update: noop, kill: noop, pos: { x: 0, y: 0, z: 0 } }), enemies: [],
      projectiles: () => ({ fire: noop, update: noop, count: 0 }), fx: { hit: noop, flashLight: noop },
      minimap: () => ({ update: noop, remove: noop }), objective: noop };
  }

  function world(THREE, opts) {
    THREE = THREE || window.THREE; opts = opts || {};
    if (!THREE || !THREE.Scene || !THREE.WebGLRenderer) { warn('world(THREE, opts): pass the Three.js module (import * as THREE from the allow-listed URL)'); return stub(); }
    const P = PRESETS[opts.preset] || (opts.preset && warn('unknown preset "' + opts.preset + '" — using forest'), PRESETS.forest);
    const size = +opts.size > 0 ? +opts.size : 120, half = size / 2, K = size / 120;
    const rand = mulberry32(seedNum(opts.seed == null ? 7 : opts.seed));
    const palette = (Array.isArray(opts.palette) && opts.palette.length >= 3 ? opts.palette : P.palette).map(String);
    const shadows = !!opts.shadows, dark = !!P.dark;
    const V = new THREE.Vector3(), V2 = new THREE.Vector3(), M = new THREE.Matrix4(), Q = new THREE.Quaternion(), C = new THREE.Color(), C2 = new THREE.Color(), UP = new THREE.Vector3(0, 1, 0);
    const toV3 = (v, out) => { out = out || new THREE.Vector3(); if (!v) return out.set(0, 0, 0); if (Array.isArray(v)) return out.set(+v[0] || 0, +v[1] || 0, +v[2] || 0); if (v.isVector3) return out.copy(v); if (v.position) return out.copy(v.position); return out.set(+v.x || 0, +v.y || 0, +v.z || 0); };
    const animated = [];                                  // {update(dt)} of world pieces (water, clouds, ambient, flocks)
    const ctx = {};                                       // filled for plugins once W exists (see the end of world())

    // ── renderer ──
    let renderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' }); }
    catch (e) { warn('WebGL unavailable: ' + (e && e.message)); return stub(); }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(window.innerWidth || 640, window.innerHeight || 360, false);
    if (THREE.ACESFilmicToneMapping != null) renderer.toneMapping = THREE.ACESFilmicToneMapping;
    if (THREE.SRGBColorSpace && 'outputColorSpace' in renderer) renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = shadows;
    const canvas = renderer.domElement;
    canvas.setAttribute('data-yuvi-world3d', '');
    Object.assign(canvas.style, { position: 'absolute', left: '0', top: '0', width: '100%', height: '100%', display: 'block' });
    const host = opts.el && opts.el.appendChild ? opts.el : (document.body || document.documentElement);
    host.appendChild(canvas);

    // ── scene, fog, camera, lights ──
    const scene = new THREE.Scene();
    const fogColor = new THREE.Color(P.fog[0]);
    scene.background = fogColor;
    // Fog is clamped to a readable floor: a game that asked for near 5 / far 60 on a 130-unit world was grey mush two steps
    // from the player. `fog: {near, far, force: true}` bypasses the floor for a deliberate whiteout.
    if (opts.fog !== false) {
      const fo = opts.fog || {}, force = !!fo.force;
      let near = fo.near != null ? +fo.near : size * P.fog[1], far = fo.far != null ? +fo.far : size * P.fog[2];
      if (!force) { near = Math.max(near, size * .12); far = Math.max(far, size * .55, near + size * .3); }
      scene.fog = new THREE.Fog(fogColor, near, far);
    }
    const camera = new THREE.PerspectiveCamera(70, (window.innerWidth || 640) / (window.innerHeight || 360), .1, Math.max(400, size * 2.8));
    camera.position.set(0, 2.2, half * .35); camera.lookAt(0, 1, 0);
    const hemi = new THREE.HemisphereLight(P.hemi[0], P.hemi[1], P.hemi[2]); scene.add(hemi);
    const sun = new THREE.DirectionalLight(P.sun[0], P.sun[1]); sun.position.set(P.sun[2][0], P.sun[2][1], P.sun[2][2]); scene.add(sun);
    // Never black on black: dark biomes get a cool ambient fill and a little more exposure so the ground, props and
    // enemies read at a glance; the lamps and windows still carry the mood. `fill: 0` / `exposure: 1` opt out.
    const fill = new THREE.AmbientLight(opts.fillColor || (dark ? '#4a5a8a' : '#ffffff'), opts.fill != null ? +opts.fill : (dark ? .55 : .15)); scene.add(fill);
    if ('toneMappingExposure' in renderer) renderer.toneMappingExposure = opts.exposure != null ? +opts.exposure : (dark ? 1.25 : 1.05);
    if (shadows) {
      sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024);
      const sc = sun.shadow.camera; sc.left = sc.bottom = -half; sc.right = sc.top = half; sc.near = 1; sc.far = size * 3;
    }
    const lights = [];                                    // point lights from props (campfire, streetlight, lamp); capped
    const LIGHT_CAP = 10;

    // ── sky: inverted vertex-coloured sphere that follows the camera (+ sun/moon disc, stars) ──
    const skyR = size * 1.9, skyGeo = new THREE.SphereGeometry(skyR, 16, 10), sp = skyGeo.attributes.position;
    const skyCol = new Float32Array(sp.count * 3), cBot = new THREE.Color(P.sky[0]), cTop = new THREE.Color(P.sky[1]);
    for (let i = 0; i < sp.count; i++) { C.copy(cBot).lerp(cTop, Math.pow(clamp(sp.getY(i) / skyR, 0, 1), .55)); C.toArray(skyCol, i * 3); }
    skyGeo.setAttribute('color', new THREE.BufferAttribute(skyCol, 3));
    const sky = new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
    sky.name = 'sky'; sky.frustumCulled = false; sky.userData.noRay = true; scene.add(sky);
    if (P.disc) {
      const disc = new THREE.Mesh(new THREE.CircleGeometry(skyR * (P.disc === 'moon' ? .045 : .06), 18), new THREE.MeshBasicMaterial({ color: P.disc === 'moon' ? '#eef2ff' : '#fff7d6', fog: false, depthWrite: false }));
      disc.position.copy(sun.position).normalize().multiplyScalar(skyR * .92); disc.lookAt(0, 0, 0); disc.name = P.disc; disc.userData.noRay = true; sky.add(disc);
      const halo = new THREE.Mesh(new THREE.CircleGeometry(skyR * .11, 18), new THREE.MeshBasicMaterial({ color: P.disc === 'moon' ? '#aab4ff' : '#ffe9b0', transparent: true, opacity: .28, fog: false, depthWrite: false }));
      halo.position.copy(disc.position).multiplyScalar(1.02); halo.lookAt(0, 0, 0); halo.userData.noRay = true; sky.add(halo);
    }
    if (P.stars) {
      const n = 500, arr = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { const a = rand() * 6.2832, e = .08 + rand() * 1.4, r = skyR * .95; arr[i * 3] = Math.cos(a) * Math.cos(e) * r; arr[i * 3 + 1] = Math.sin(e) * r; arr[i * 3 + 2] = Math.sin(a) * Math.cos(e) * r; }
      const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(arr, 3));
      const stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: '#ffffff', size: 2, sizeAttenuation: false, fog: false }));
      stars.name = 'stars'; stars.frustumCulled = false; stars.userData.noRay = true; sky.add(stars);
    }

    // ── terrain: value-noise heightmap, flat clearing at the centre, optional island fall-off; groundY(x, z) is the same function ──
    const t0 = opts.terrain || {}, T = { hills: clamp(t0.hills != null ? +t0.hills : P.terrain[0], 0, 1), amp: +t0.amplitude || P.terrain[1] || 0, island: t0.island != null ? !!t0.island : !!P.terrain[2] };
    const NS = seedNum(opts.seed == null ? 7 : opts.seed) ^ 0x9e3779b9, ox = rand() * 100, oz = rand() * 100;
    const hash2 = (x, z) => { let n = Math.imul(x, 374761393) + Math.imul(z, 668265263) + NS; n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
    function vnoise(x, z) {
      const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi, u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
      return hash2(xi, zi) * (1 - u) * (1 - v) + hash2(xi + 1, zi) * u * (1 - v) + hash2(xi, zi + 1) * (1 - u) * v + hash2(xi + 1, zi + 1) * u * v;
    }
    function groundY(x, z) {
      const d = Math.hypot(x, z); let h = 0;
      if (T.amp && T.hills) h = (vnoise(x * .045 + ox, z * .045 + oz) * .65 + vnoise(x * .14 + ox, z * .14 + oz) * .35 - .5) * 2 * T.amp * T.hills * clamp((d - 7) / 10, 0, 1);
      if (T.island) h -= Math.pow(Math.max(0, d - half * .45) / (half * .5), 2) * Math.max(T.amp, 2) * 3;
      return h;
    }
    const seg = 48, gg = new THREE.PlaneGeometry(size, size, seg, seg); gg.rotateX(-Math.PI / 2);
    const gp = gg.attributes.position, gc = new Float32Array(gp.count * 3), gA = new THREE.Color(P.ground[0]), gB = new THREE.Color(P.ground[1]);
    for (let i = 0; i < gp.count; i++) {
      const x = gp.getX(i), z = gp.getZ(i), h = groundY(x, z); gp.setY(i, h);
      C.copy(gA).lerp(gB, clamp(.5 + h / Math.max(1, T.amp * 2) + vnoise(x * .3 + oz, z * .3 + ox) * .5 - .25, 0, 1)); C.toArray(gc, i * 3);
    }
    gg.setAttribute('color', new THREE.BufferAttribute(gc, 3)); gg.computeVertexNormals();
    const ground = new THREE.Mesh(gg, new THREE.MeshLambertMaterial({ vertexColors: true }));
    ground.name = 'ground'; ground.receiveShadow = shadows; scene.add(ground);
    if (P.grid) { const grid = new THREE.GridHelper(size, Math.round(size / 4), palette[1], palette[1]); grid.position.y = .03; grid.material.transparent = true; grid.material.opacity = .35; grid.userData.noRay = true; scene.add(grid); }

    // ── water: a wide animated plane (vertex ripple + recomputed normals) ──
    let water = null;
    const w0 = opts.water === true ? {} : opts.water;
    if (w0 || (P.water && opts.water !== false)) {
      const ws = Object.assign({ level: -1, color: palette[2], waves: .2 }, P.water || {}, w0 || {});
      const wg = new THREE.PlaneGeometry(size * 2.6, size * 2.6, 26, 26); wg.rotateX(-Math.PI / 2);
      water = new THREE.Mesh(wg, new THREE.MeshLambertMaterial({ color: ws.color, transparent: true, opacity: .78 }));
      water.position.y = ws.level; water.name = 'water'; water.userData.noRay = true; water.level = ws.level; scene.add(water);
      const wp = wg.attributes.position, wn = wp.count; let wt = rand() * 10;
      animated.push({ update(dt) { wt += dt; const A = +ws.waves || 0; if (!A) return; for (let i = 0; i < wn; i++) { const x = wp.getX(i), z = wp.getZ(i); wp.setY(i, Math.sin(x * .35 + wt * 1.3) * Math.cos(z * .28 + wt * .9) * A); } wp.needsUpdate = true; wg.computeVertexNormals(); } });
    }

    // ── backdrop: a ring of silhouettes past the ground edge (mountain cones, skyline boxes, dune domes, jagged rocks) ──
    const bd = opts.backdrop === false ? null : (typeof opts.backdrop === 'string' ? opts.backdrop : P.backdrop);
    if (bd) {
      const geo = bd === 'skyline' ? new THREE.BoxGeometry(1, 1, 1) : bd === 'dunes' ? new THREE.SphereGeometry(1, 8, 5) : new THREE.ConeGeometry(1, 1, bd === 'rock' ? 4 : 5);
      geo.translate(0, .5, 0); const n = bd === 'skyline' ? 48 : 34;
      const bm = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: C.set(palette[bd === 'skyline' ? 4 : 1]).lerp(fogColor, bd === 'dunes' ? .5 : .3).getHex(), flatShading: true }), n);
      for (let i = 0; i < n; i++) {
        const a = i / n * 6.2832 + rand() * .12, r = size * (.64 + rand() * .22), h = size * (bd === 'skyline' ? .08 + rand() * .28 : bd === 'dunes' ? .06 + rand() * .06 : .14 + rand() * .26), w = size * (bd === 'skyline' ? .05 + rand() * .06 : .12 + rand() * .14);
        M.compose(V.set(Math.cos(a) * r, -T.amp * 2 - 2, Math.sin(a) * r), Q.setFromAxisAngle(UP, rand() * 6.2832), V2.set(w, h, w)); bm.setMatrixAt(i, M);
      }
      bm.instanceMatrix.needsUpdate = true; bm.name = 'backdrop'; bm.userData.noRay = true; bm.frustumCulled = false; scene.add(bm);
    }

    // ── clouds: instanced soft puffs drifting with the wind ──
    const nClouds = opts.clouds === false ? 0 : (opts.clouds != null ? +opts.clouds : P.clouds) | 0;
    if (nClouds > 0) {
      const puffs = [], per = 3, cm = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 7, 5), new THREE.MeshLambertMaterial({ color: dark ? palette[1] : '#ffffff', transparent: true, opacity: dark ? .6 : .9 }), nClouds * per);
      for (let i = 0; i < nClouds; i++) { const cx = (rand() * 2 - 1) * size * .9, cz = (rand() * 2 - 1) * size * .9, cy = (22 + rand() * 12) * K, s = (3 + rand() * 4) * K; for (let j = 0; j < per; j++) puffs.push({ x: cx + (j - 1) * s * .9, y: cy + rand() * s * .3, z: cz + (rand() - .5) * s * .6, s: s * (.6 + rand() * .5) }); }
      const wind = (.6 + rand() * .8) * K;
      const draw = dt => { for (let i = 0; i < puffs.length; i++) { const p = puffs[i]; p.x += wind * dt; if (p.x > size * 1.1) p.x -= size * 2.2; M.compose(V.set(p.x, p.y, p.z), Q.identity(), V2.set(p.s * 1.6, p.s * .55, p.s)); cm.setMatrixAt(i, M); } cm.instanceMatrix.needsUpdate = true; };
      draw(0); cm.name = 'clouds'; cm.userData.noRay = true; cm.frustumCulled = false; scene.add(cm); animated.push({ update: draw });
    }

    // ── ambient particles: dust | snow | rain | fireflies | embers — Points wrapped around the camera ──
    const AMB = { dust: ['#e8dcc0', 2.5, 120, .5, .15], snow: ['#ffffff', 3.5, 260, 1.2, -1.4], rain: ['#bcd8ff', 2, 320, 0, -18], fireflies: ['#d8ff6a', 5, 90, .6, 0], embers: ['#ff9a3c', 3.5, 140, .5, 1.6] };   // color, size, count, drift, fall (+up)
    const amb = opts.ambient === false ? null : (opts.ambient || P.ambient);
    if (amb && AMB[amb]) {
      const [col, psz, n, drift, fall] = AMB[amb], pos = new Float32Array(n * 3), cols = new Float32Array(n * 3), vel = new Float32Array(n * 3), box = 34, hgt = 16;
      const base = new THREE.Color(col);
      for (let i = 0; i < n; i++) { pos[i * 3] = (rand() - .5) * box * 2; pos[i * 3 + 1] = rand() * hgt; pos[i * 3 + 2] = (rand() - .5) * box * 2; vel[i * 3] = (rand() - .5) * drift; vel[i * 3 + 1] = fall * (.7 + rand() * .6); vel[i * 3 + 2] = (rand() - .5) * drift; base.toArray(cols, i * 3); }
      const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); pg.setAttribute('color', new THREE.BufferAttribute(cols, 3));
      const pts = new THREE.Points(pg, new THREE.PointsMaterial({ size: psz, vertexColors: true, sizeAttenuation: false, transparent: true, opacity: amb === 'rain' ? .55 : .9 }));
      pts.name = 'ambient:' + amb; pts.userData.noRay = true; pts.frustumCulled = false; scene.add(pts);
      let at = 0;
      animated.push({ update(dt) {
        at += dt; camera.getWorldPosition(V);
        for (let i = 0; i < n; i++) {
          const j = i * 3; let x = pos[j] + vel[j] * dt, y = pos[j + 1] + vel[j + 1] * dt, z = pos[j + 2] + vel[j + 2] * dt;
          if (amb === 'fireflies' || amb === 'dust') y += Math.sin(at * 1.7 + i) * dt * .6;
          if (amb === 'snow') x += Math.sin(at + i) * dt * .8;
          if (x < V.x - box) x += box * 2; else if (x > V.x + box) x -= box * 2;
          if (z < V.z - box) z += box * 2; else if (z > V.z + box) z -= box * 2;
          if (y < V.y - 2) y += hgt; else if (y > V.y + hgt) y -= hgt;
          pos[j] = x; pos[j + 1] = y; pos[j + 2] = z;
          if (amb === 'fireflies' || amb === 'embers') { const k = .35 + .65 * Math.abs(Math.sin(at * 3 + i * 1.3)); cols[j] = base.r * k; cols[j + 1] = base.g * k; cols[j + 2] = base.b * k; }
        }
        pg.attributes.position.needsUpdate = true; if (amb === 'fireflies' || amb === 'embers') pg.attributes.color.needsUpdate = true;
      } });
    }

    // ── flocks: birds circling in the sky / fish under the water (instanced wedges, flapping) ──
    function flock(kind, n) {
      n = clamp(n | 0, 0, 24); if (!n || (kind === 'fish' && !water)) return;
      const geo = new THREE.ConeGeometry(.5, 1.4, 3); geo.rotateX(R90); geo.scale(kind === 'fish' ? 1 : 2.2, .35, 1);
      const fm = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: kind === 'fish' ? palette[5] : (dark ? palette[1] : palette[4]) }), n), items = [];
      for (let i = 0; i < n; i++) items.push({ cx: (rand() - .5) * size * .8, cz: (rand() - .5) * size * .8, r: 6 + rand() * 14, a: rand() * 6.2832, w: (.25 + rand() * .3) * (rand() < .5 ? 1 : -1), y: kind === 'fish' ? water.level - .6 - rand() * 1.2 : (14 + rand() * 12) * K, ph: rand() * 6 });
      let ft = 0;
      animated.push({ update(dt) {
        ft += dt;
        for (let i = 0; i < n; i++) { const b = items[i]; b.a += b.w * dt; const flap = kind === 'fish' ? 1 : .55 + .45 * Math.abs(Math.sin(ft * 9 + b.ph));
          M.compose(V.set(b.cx + Math.cos(b.a) * b.r, b.y + Math.sin(ft * 1.3 + b.ph) * .4, b.cz + Math.sin(b.a) * b.r), Q.setFromAxisAngle(UP, -b.a - (b.w > 0 ? 0 : 3.1416)), V2.set(flap, 1, 1)); fm.setMatrixAt(i, M); }
        fm.instanceMatrix.needsUpdate = true;
      } });
      fm.name = kind; fm.userData.noRay = true; fm.frustumCulled = false; scene.add(fm); animated[animated.length - 1].update(0);
    }
    flock('birds', opts.birds != null ? opts.birds : P.birds); flock('fish', opts.fish != null ? opts.fish : P.fish);

    // ── materials + part geometry ──
    const mats = {}, textures = {}, texCache = {};
    // A texture name resolves through the plugin registry (`ctx.textures[name] = (THREE, ctx) => Texture | {map, bumpMap, bumpScale, emissiveMap}`); unknown names fall back to flat colour.
    const texFor = name => { if (!name) return null; if (texCache[name] !== undefined) return texCache[name]; const f = textures[name]; let t = null; try { t = f ? f(THREE, ctx) : null; } catch (e) { warn('texture "' + name + '": ' + (e && e.message)); } if (!t && f === undefined) warn('unknown texture "' + name + '" — flat colour used'); return (texCache[name] = t && t.isTexture ? { map: t } : (t || null)); };
    const matFor = (hex, unlit, alpha, tex) => {
      const k = (unlit ? 'u' : 'l') + hex + (alpha || '') + (tex ? '#' + tex : '');
      if (mats[k]) return mats[k];
      const T = tex ? texFor(tex) : null, base = { color: hex, transparent: !!alpha, opacity: alpha || 1 };
      if (T) { base.map = T.map || null; if (T.bumpMap && !unlit) { base.bumpMap = T.bumpMap; base.bumpScale = T.bumpScale || .02; } if (T.emissiveMap && !unlit) { base.emissiveMap = T.emissiveMap; base.emissive = new THREE.Color(T.emissive || '#ffffff'); } }
      return (mats[k] = unlit ? new THREE.MeshBasicMaterial(base) : new THREE.MeshLambertMaterial(Object.assign({ flatShading: !T }, base)));
    };
    const texOf = (p, o) => (o && o.textures && o.textures[p.c]) || (o && o.texture && !unlitFor(p) ? o.texture : null) || p.t || null;
    const GEO = { box: a => new THREE.BoxGeometry(a[0], a[1], a[2]), cyl: a => new THREE.CylinderGeometry(a[0], a[1], a[2], a[3]), cone: a => new THREE.ConeGeometry(a[0], a[1], a[2]),
      sphere: a => new THREE.SphereGeometry(a[0], a[1], a[2]), dodeca: a => new THREE.DodecahedronGeometry(a[0], a[1]), octa: a => new THREE.OctahedronGeometry(a[0], a[1]) };
    function partGeo(p) { const g = GEO[p.g](p.a); if (p.rz) g.rotateZ(p.rz); if (p.rx) g.rotateX(p.rx); if (p.s) g.scale(p.s[0], p.s[1], p.s[2]); g.translate(p.p[0], p.p[1], p.p[2]); return g; }
    const roleHex = c => typeof c === 'string' ? c : (palette[c] || palette[0]);
    const partColor = (p, o) => (o && o.colors && o.colors[p.c]) || (o && o.color && p.c === 5 ? o.color : null) || roleHex(p.c);
    const unlitFor = p => p.e === true || (p.e === 'dark' && dark);
    const partsOf = (Kd, o) => (Kd.variants && o && o.variant && Kd.variants[o.variant]) || Kd.parts;

    // ── props: instanced scatter / place (explicit positions) + single make ──
    const propSets = [];
    const areaOf = a => {
      if (typeof a === 'number') return { x: 0, z: 0, hw: a, hd: a };
      if (Array.isArray(a)) return { x: +a[0] || 0, z: +a[1] || 0, hw: +a[2] || half - 2, hd: +a[3] || +a[2] || half - 2 };
      if (a && typeof a === 'object') return { x: +a.x || 0, z: +a.z || 0, hw: +(a.hw != null ? a.hw : a.w / 2) || half - 2, hd: +(a.hd != null ? a.hd : (a.d || a.h) / 2) || +(a.hw != null ? a.hw : a.w / 2) || half - 2 };
      return { x: 0, z: 0, hw: half - 2, hd: half - 2 };
    };
    const avoidList = o => [{ x: 0, z: 0, r: 5 }].concat((o.avoid || []).map(a => ({ x: +(a.x != null ? a.x : a[0]) || 0, z: +(a.z != null ? a.z : (a.length > 2 ? a[2] : a[1])) || 0, r: +a.r || (a.length > 3 ? +a[3] : 0) || 3 })));
    const wetOk = (Kd, x, z) => !water || (Kd.float ? groundY(x, z) < water.level - .4 : groundY(x, z) > water.level + .15);
    function scatter(kind, count, o) {
      const Kd = KINDS[kind]; o = o || {};
      if (!Kd) { warn('props.scatter: unknown kind "' + kind + '" — kinds: ' + Object.keys(KINDS).join(', ')); return { kind: kind, positions: [], meshes: [], remove: noop }; }
      count = count == null ? 30 : clamp(count | 0, 0, 600);
      const rnd = o.seed == null ? rand : mulberry32(seedNum(o.seed)), area = areaOf(o.area), base = +o.scale || 1, avoid = avoidList(o), positions = [];
      for (let tries = count * 12; positions.length < count && tries > 0; tries--) {
        const x = area.x + (rnd() * 2 - 1) * area.hw, z = area.z + (rnd() * 2 - 1) * area.hd;
        const s = base * (Kd.jit[0] + rnd() * (Kd.jit[1] - Kd.jit[0])), r = Kd.r * s;
        if (!wetOk(Kd, x, z) || avoid.some(a => Math.hypot(a.x - x, a.z - z) < a.r + r)) continue;
        if (!Kd.soft && positions.some(p => Math.hypot(p.x - x, p.z - z) < (p.r + r) * .9)) continue;
        positions.push({ x: x, y: 0, z: z, r: r, s: s, rot: rnd() * 6.2832, tint: .85 + rnd() * .3 });
      }
      return place(kind, positions, o);
    }
    function place(kind, positions, o) {
      const Kd = KINDS[kind]; o = o || {};
      if (!Kd) { warn('props.place: unknown kind "' + kind + '"'); return { kind: kind, positions: [], meshes: [], remove: noop }; }
      positions = (positions || []).map(q => { const p = Array.isArray(q) ? { x: +q[0] || 0, z: +(q.length > 2 ? q[2] : q[1]) || 0 } : Object.assign({}, q); p.s = +p.s || +o.scale || 1; p.r = +p.r || Kd.r * p.s; p.rot = +p.rot || 0; p.tint = +p.tint || 1;
        p.y = Kd.float && water ? water.level - .1 : (p.y || groundY(p.x, p.z)); return p; });
      const parts = partsOf(Kd, o);
      const meshes = parts.map(p => {
        // Instanced: the tint rides on instanceColor, so a textured part gets a white material (colour × instanceColor × map, once, not twice).
        const tex = texOf(p, o), m = new THREE.InstancedMesh(partGeo(p), matFor(tex ? '#ffffff' : partColor(p, o), unlitFor(p), 0, tex), Math.max(1, positions.length));
        positions.forEach((q, i) => {
          M.compose(V.set(q.x, q.y, q.z), Q.setFromAxisAngle(UP, q.rot), V2.set(q.s, q.s, q.s)); m.setMatrixAt(i, M);
          C.set(partColor(p, o)).multiplyScalar(q.tint); m.setColorAt(i, C);
        });
        m.count = positions.length; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true;
        m.castShadow = shadows && !p.e; m.receiveShadow = shadows; m.name = 'prop:' + kind; if (Kd.soft) m.userData.noRay = true; scene.add(m); return m;
      });
      const own = [];
      if (Kd.light && o.lights !== false) positions.slice(0, o.lights == null ? 3 : o.lights | 0).forEach(q => {
        if (lights.length >= LIGHT_CAP) return;
        const pl = new THREE.PointLight(Kd.light.c, Kd.light.i * (dark ? 1.3 : .6), Kd.light.d * q.s, 1.6); pl.position.set(q.x, q.y + Kd.light.y * q.s, q.z); scene.add(pl); lights.push(pl); own.push(pl);
      });
      const h = { kind: kind, positions: positions, meshes: meshes, soft: !!Kd.soft, color: partColor(parts[parts.length - 1], o),
        remove() { meshes.forEach(m => { scene.remove(m); m.geometry.dispose(); m.dispose(); }); own.forEach(l => { scene.remove(l); const j = lights.indexOf(l); if (j >= 0) lights.splice(j, 1); }); const i = propSets.indexOf(h); if (i >= 0) propSets.splice(i, 1); } };
      propSets.push(h); return h;
    }
    function make(kind, o) {
      const Kd = KINDS[kind]; o = o || {};
      if (!Kd) { warn('props.make: unknown kind "' + kind + '"'); return new THREE.Group(); }
      const g = new THREE.Group(); g.name = kind;
      partsOf(Kd, o).forEach(p => { const m = new THREE.Mesh(partGeo(p), matFor(partColor(p, o), unlitFor(p), 0, texOf(p, o))); m.castShadow = shadows && !p.e; g.add(m); });
      const s = +o.scale || 1; g.scale.set(s, s, s); g.userData.radius = Kd.r * s;
      if (Kd.light && o.light !== false && lights.length < LIGHT_CAP) { const pl = new THREE.PointLight(Kd.light.c, Kd.light.i * (dark ? 1.3 : .6), Kd.light.d * s, 1.6); pl.position.set(0, Kd.light.y, 0); g.add(pl); lights.push(pl); }
      if (o.pos) { toV3(o.pos, g.position); if (o.snap !== false) g.position.y += Kd.float && water ? water.level - .1 : groundY(g.position.x, g.position.z); }
      if (o.add !== false) scene.add(g);
      return g;
    }

    // ── decorate: the biome's layout recipe (W is assigned at the end of world(); decorate runs only after that) — clearing at the centre, a landmark, a path to it, clusters, scatter, an edge wall ──
    function decorate(o) {
      // A themed compound (`{layout:'industrialNight'}`) is the props plugin's job; the biome recipe is the default.
      if (o && o.layout && W && W.props && W.props.layout) return W.props.layout(o.layout, o);
      o = o || {};
      const L = P.layout || {}, dens = clamp(+o.density || 1, .2, 2.5), rnd = o.seed == null ? rand : mulberry32(seedNum(o.seed)), area = K * K;
      const avoid = [{ x: 0, z: 0, r: 9 }], sets = [], dec = { sets: sets, positions: [], landmark: null, path: [], remove() { sets.slice().forEach(h => h.remove()); if (dec.landmark) scene.remove(dec.landmark); } };
      const add = h => { if (h && h.positions) { sets.push(h); if (!h.soft && !KINDS[h.kind].float) h.positions.forEach(p => dec.positions.push(p)); } return h; };
      const free = (x, z, r) => !avoid.some(a => Math.hypot(a.x - x, a.z - z) < a.r + r);
      let lx = 0, lz = 0;
      if (L.land && o.landmark !== false) {
        const Kl = KINDS[L.land[0]], s = L.land[1] || 1, a = rnd() * 6.2832, d = half * .58;
        lx = Math.cos(a) * d; lz = Math.sin(a) * d;
        for (let t = 0; t < 20 && water && groundY(lx, lz) < water.level + .5; t++) { const b = rnd() * 6.2832, e = half * (.3 + rnd() * .3); lx = Math.cos(b) * e; lz = Math.sin(b) * e; }
        const lm = make(L.land[0], Object.assign({ scale: s, pos: [lx, 0, lz] }, L.land[2] || {})); lm.rotation.y = Math.atan2(-lx, -lz); lm.name = 'landmark';
        dec.landmark = lm; avoid.push({ x: lx, z: lz, r: Kl.r * s + 3 }); dec.positions.push({ x: lx, z: lz, r: Kl.r * s });
      }
      if (L.path && dec.landmark) {
        const sx = 0, sz = 6, dx = lx - sx, dz = lz - sz, len = Math.hypot(dx, dz), n = Math.max(4, Math.round(len / 1.5)), pts = [];
        for (let i = 0; i <= n; i++) { const t = i / n, w = Math.sin(t * 6.5 + 1) * len * .06, x = sx + dx * t - dz / len * w + (rnd() - .5) * .5, z = sz + dz * t + dx / len * w + (rnd() - .5) * .5; pts.push({ x: x, z: z, s: .6 + rnd() * .35, rot: rnd() * 6.2832, tint: .9 + rnd() * .2 }); if (i % 2 === 0) avoid.push({ x: x, z: z, r: 2.2 }); }
        dec.path = pts; add(place('path', pts, { colors: { 1: '#' + C.set(L.path === 'stone' ? palette[1] : L.path === 'plate' ? palette[3] : palette[4]).lerp(C2.set(palette[3]), L.path === 'road' ? .25 : .45).getHexString() } }));
      }
      (L.cluster || []).forEach(cl => { for (let c = 0; c < cl[1]; c++) { let cx = 0, cz = 0; for (let t = 0; t < 30; t++) { const a = rnd() * 6.2832, d = 14 + rnd() * (half - 22); cx = Math.cos(a) * d; cz = Math.sin(a) * d; if (free(cx, cz, 4)) break; } add(scatter(cl[0], Math.round(cl[2] * dens), Object.assign({ area: [cx, cz, 4.5, 4.5], avoid: avoid, seed: rnd() * 1e9 }, cl[3] || {}))); } });
      (L.scatter || []).forEach(sc => add(scatter(sc[0], Math.round(sc[1] * dens * area), Object.assign({ area: half - 4, avoid: avoid, seed: rnd() * 1e9 }, sc[2] || {}))));
      if (L.edge && o.edge !== false) {
        const kind = L.edge[0], eo = L.edge[1] || {}, Ke = KINDS[kind], s = +eo.scale || 1, step = Math.max(1.6, Ke.r * 2.3 * s), e = half - 2.5, pts = [];
        const pt = (x, z) => pts.push({ x: x + (rnd() - .5) * .8, z: z + (rnd() - .5) * .8, s: s * (.9 + rnd() * .25), rot: rnd() * 6.2832, tint: .85 + rnd() * .3 });
        for (let x = -e; x <= e; x += step) { pt(x, -e); pt(x, e); } for (let z = -e + step; z < e; z += step) { pt(-e, z); pt(e, z); }
        add(place(kind, pts.filter(p => wetOk(Ke, p.x, p.z)), eo));
      }
      return dec;
    }

    // ── characters: humans / robots / animals from primitives. A real joint hierarchy (hips → chest → neck → head; shoulder → elbow → hand;
    //    hip → knee → foot), faces with eyes/brows/mouth that change expression, hair styles, clothing layers, gear, sockets for held items.
    //    Every primitive of one colour under one joint merges into a single mesh, so a dressed human is ~20-28 draw calls. Deterministic in `seed`. ──
    function character(o) {
      o = o || {}; const rnd = mulberry32(seedNum(o.seed == null ? rand() * 1e9 : o.seed)), pick = a => Array.isArray(a) ? a[Math.floor(rnd() * a.length)] : a, chance = p => rnd() < p, PI = 3.1416; const animal = o.animal && ANIMALS[o.animal] ? o.animal : (o.kind === 'animal' ? 'dog' : null), kind = animal ? 'animal' : (o.kind === 'robot' ? 'robot' : 'human'), role = ROLES[o.role] ? o.role : 'villager', R = ROLES[role];
      const style = kind === 'robot' ? (BOTS.indexOf(o.style) >= 0 ? o.style : pick(BOTS)) : null, bot = style === 'humanoid', A = animal ? ANIMALS[animal] : null; const g = new THREE.Group(); g.name = 'character:' + (animal || kind + ':' + (style || role)); const body = new THREE.Group(); body.name = 'body'; g.add(body);
      const parts = g.parts = { body: body }, J = [], sockets = g.sockets = {}, alpha = +o.alpha || R.alpha || 0, cfg = { human: kind === 'human' || bot, lean: .04, hover: style === 'drone' || !!R.float, hop: !!(A && A.hop), thL: .4, shL: .35, hipY: .8 }; const col = (key, fb) => (o.colors && o.colors[key]) || (typeof o[key] === 'string' && o[key][0] === '#' ? o[key] : null) || fb, tx = n => n && textures[n] ? n : null, tint = (hex, to, k) => '#' + C.set(hex).lerp(C2.set(to), k).getHexString();
      const batches = {}, list = [], add = (parent, geo, hex, tag, unlit, tex) => { const k = parent.id + '|' + (tag || 'p') + '|' + hex + (unlit ? 'u' : '') + (tex || ''); let b = batches[k]; if (!b) { b = batches[k] = { parent: parent, tag: tag || 'p', hex: hex, unlit: unlit, tex: tex, geos: [] }; list.push(b); } b.geos.push(geo); }; const solo = (parent, geo, hex, unlit, a) => { const m = new THREE.Mesh(geo, matFor(hex, unlit, a || alpha)); m.castShadow = shadows; parent.add(m); return m; };
      const merge = geos => { if (geos.length === 1) return geos[0]; const P = [], N = [], U = []; let n = 0; geos.forEach(q => { const d = q.index ? q.toNonIndexed() : q; P.push(d.attributes.position.array); N.push(d.attributes.normal.array); if (d.attributes.uv) U.push(d.attributes.uv.array); n += d.attributes.position.count; });
        const cat = (arrs, w) => { const out = new Float32Array(n * w); let at = 0; arrs.forEach(a => { out.set(a, at); at += a.length; }); return out; }, q = new THREE.BufferGeometry(); q.setAttribute('position', new THREE.BufferAttribute(cat(P, 3), 3)); q.setAttribute('normal', new THREE.BufferAttribute(cat(N, 3), 3)); if (U.length === geos.length) q.setAttribute('uv', new THREE.BufferAttribute(cat(U, 2), 2)); return q; };
      const flush = () => list.forEach(b => { const m = new THREE.Mesh(merge(b.geos), matFor(b.hex, b.unlit, alpha, b.tex)); m.castShadow = shadows; m.name = b.tag; b.parent.add(m); if (b.tag !== 'p' && parts[b.tag] === undefined) parts[b.tag] = m; });
      const jt = (name, parent, x, y, z, ph, amp, ax, base) => { const p = new THREE.Group(); p.name = name; p.position.set(x, y, z); parent.add(p); parts[name] = p; const j = { p: p, name: name, ph: ph || 0, amp: amp || 0, ax: ax || 'x', base: base || 0, x: 0, y: 0, z: 0 }; if (base) { j[j.ax] = base; p.rotation[j.ax] = base; } J.push(j); return p; };
      const sock = (name, parent, x, y, z, rx) => { const s = new THREE.Object3D(); s.name = 'socket:' + name; s.position.set(x, y, z); if (rx) s.rotation.x = rx; parent.add(s); sockets[name] = s; return s; };
      const box = (w, h, d) => new THREE.BoxGeometry(w, h, d), cyl = (r1, r2, h, n) => new THREE.CylinderGeometry(r1, r2, h, n || 7), sph = (r, s) => { const q = new THREE.SphereGeometry(r, 8, 6); if (s) q.scale(s[0], s[1], s[2]); return q; }, cone = (r, h, n) => new THREE.ConeGeometry(r, h, n || 6), tor = (r, t, arc) => new THREE.TorusGeometry(r, t, 4, 10, arc || 6.2832); const size = (+o.size || 1) * (R.size || 1), dk = '#2b2f36'; let H = 1.7; if (cfg.human) {
        // proportions in head units by age (kid 5 heads … adult 7) and build; hh = head height, hr = head radius
        const age = bot ? 'adult' : AGES.indexOf(o.age) >= 0 ? o.age : (R.age || pick(['adult', 'adult', 'adult', 'teen', 'elder'])), build = BUILDS.indexOf(o.build) >= 0 ? o.build : (R.build || pick(['slim', 'average', 'average', 'heavy', 'athletic'])); H = { kid: 1.3, teen: 1.5, adult: 1.65, elder: 1.58 }[age] + rnd() * (age === 'kid' ? .15 : .22); const hh = H / { kid: 5, teen: 6, adult: 7, elder: 6.5 }[age], hr = hh * .5; cfg.lean = age === 'elder' ? .12 : .04;
        const tw = hh * { slim: 1.55, average: 1.8, heavy: 2.35, athletic: 2.15 }[build], td = tw * (build === 'heavy' ? .62 : .5), ar = hh * { slim: .15, average: .18, heavy: .24, athletic: .21 }[build], lr = hh * (build === 'heavy' ? .32 : .24); const hipY = H * { kid: .43, teen: .46, adult: .47, elder: .46 }[age], thL = hipY * .5, shL = hipY * .42, torsoH = H * .29, uaL = torsoH * .55, faL = torsoH * .5; cfg.thL = thL; cfg.shL = shL; cfg.hipY = hipY;
        const bc = bot ? col('top', pick([palette[3], '#8fa1b0', '#c9d3dc', '#f2f4f7'])) : null, acc = R.accent || (bot ? col('bottom', palette[2]) : palette[5]); const skin = bot ? bc : col('skin', pick(R.skin || SKIN)), hair = col('hair', pick(HAIRC)), eyeC = col('eye', pick(R.eye || EYEC)), top = bot ? bc : col('top', pick(R.top)), bottom = bot ? col('bottom', dk) : col('bottom', pick(R.bottom)), shoes = col('shoes', R.shoes || pick(['#3a2a20', '#1a1a1a', '#5a3d22', '#ffffff']));
        const topK = bot ? 'armor' : TOPS.indexOf(o.top) >= 0 ? o.top : pick(R.tops || ['tshirt', 'shirt']), botK = bot ? 'jeans' : BOTTOMS.indexOf(o.bottom) >= 0 ? o.bottom : pick(R.bottoms || ['jeans']), sl = { tshirt: 1, shirt: 2, hoodie: 2, jacket: 2, vest: 0, coat: 2, dress: 1, armor: 0, labcoat: 2, uniform: 2 }[topK];
        const tT = tx(o.texture || (R.tex && R.tex.top) || (bot || topK === 'armor' ? 'metal' : topK === 'jacket' ? 'leather' : 'fabric')), bT = tx(bot ? 'metal' : (R.tex && R.tex.bottom) || 'fabric'), sT = bot ? tx('metal') : null; const gear = {}; (Array.isArray(o.gear) ? o.gear : bot ? [] : (R.gear || []).concat((R.pool || []).filter(() => chance(.4)))).forEach(n => { if (GEAR.indexOf(n) >= 0) gear[n] = 1; });
        const accN = o.accessory || R.acc || 'none'; if (GEAR.indexOf(accN) >= 0) gear[accN] = 1; if (o.glasses) gear.glasses = 1; if (o.belt) gear.belt = 1; const hat = HATS.indexOf(o.hat) >= 0 ? o.hat : (R.hat || (gear.helmet ? 'helmet' : bot ? 'none' : chance(.12) ? pick(['cap', 'beret', 'bandana']) : 'none')), covered = hat === 'helmet' || hat === 'hood' || hat === 'chefhat' || hat === 'wizard';
        const hst = bot ? 'bald' : HAIRS.indexOf(o.hairStyle) >= 0 ? o.hairStyle : (R.hair || pick(age === 'elder' ? ['short', 'bald', 'bald', 'bun', 'buzz'] : HAIRS.slice(0, 10)));
        // hips + legs (thigh → shin → foot)
        const hips = jt('hips', body, 0, hipY, 0); add(hips, box(tw * .9, torsoH * .3, td * .95).translate(0, torsoH * .12, 0), bottom, 'hips', 0, bT); ['L', 'R'].forEach((s, i) => { const sg = i ? 1 : -1, th = jt('leg' + s, hips, sg * tw * .26, 0, 0), legC = botK === 'shorts' || botK === 'skirt' ? skin : bottom, shC = botK === 'jeans' || botK === 'cargo' || botK === 'suit' ? bottom : skin;
          add(th, cyl(lr, lr * .85, thL).translate(0, -thL * .5, 0), legC, 'thigh', 0, legC === bottom ? bT : sT); if (botK === 'cargo') add(th, box(lr * .9, thL * .3, lr * .5).translate(sg * lr * .7, -thL * .55, lr * .4), bottom, 'thigh', 0, bT); const sh = jt('shin' + s, th, 0, -thL, 0); add(sh, sph(lr * .9).translate(0, 0, 0), shC, 'shin', 0, shC === bottom ? bT : sT); add(sh, cyl(lr * .85, lr * .7, shL).translate(0, -shL * .5, 0), shC, 'shin', 0, shC === bottom ? bT : sT);
          const ft = jt('foot' + s, sh, 0, -shL, 0); add(ft, box(lr * 2, hipY * .08, lr * 3.2).translate(0, -hipY * .04, lr * .8), shoes, 'foot'); });
        // chest: torso + clothing layer silhouettes (sleeves, collar, hood, pockets, plates, coat/skirt)
        const chest = jt('chest', hips, 0, torsoH * .3, 0), tf = topK === 'vest' || topK === 'armor' ? 1.08 : 1, trim = topK === 'uniform' || topK === 'armor' ? acc : topK === 'labcoat' ? '#dfe6ee' : dk; add(chest, box(tw * tf, torsoH * .74, td * tf).translate(0, torsoH * .36, 0), top, 'torso', 0, tT); if (build === 'heavy') add(chest, sph(tw * .36, [1, .75, .8]).translate(0, torsoH * .2, td * .15), top, 'torso', 0, tT);
        if (topK === 'hoodie') { add(chest, sph(hr * 1.1, [1, .8, 1]).translate(0, torsoH * .78, -hr * .5), top, 'torso', 0, tT); add(chest, box(tw * .5, torsoH * .2, .03).translate(0, torsoH * .2, td * .52), top, 'torso', 0, tT); } if (sl === 2 && topK !== 'shirt') { add(chest, box(tw * .12, torsoH * .74, .02).translate(0, torsoH * .36, td * .51), trim, 'trim'); add(chest, box(tw * .5, torsoH * .12, td * 1.05).translate(0, torsoH * .7, 0), trim, 'trim'); }
        if (topK === 'shirt' || topK === 'uniform') add(chest, box(tw * .34, hr * .3, .03).translate(0, torsoH * .68, td * .52), trim, 'trim'); if (topK === 'vest') [-1, 1].forEach(sg => add(chest, box(tw * .3, torsoH * .2, .03).translate(sg * tw * .25, torsoH * .2, td * .55), dk, 'trim')); if (topK === 'armor') { [-1, 1].forEach(sg => add(chest, sph(ar * 1.7, [1, .7, 1]).translate(sg * tw * .55, torsoH * .68, 0), top, 'torso', 0, tT)); add(chest, box(tw * .5, torsoH * .3, .03).translate(0, torsoH * .4, td * .55), acc, 'trim', bot); }
        if (topK === 'coat' || topK === 'labcoat') add(hips, box(tw * 1.02, hipY * .45, td * 1.05).translate(0, -hipY * .1, 0), top, 'coat', 0, tT); if (topK === 'dress') add(hips, cyl(tw * .5, tw * .95, hipY * .55, 10).translate(0, -hipY * .2, 0), top, 'skirt', 0, tT); else if (botK === 'skirt') add(hips, cyl(tw * .5, tw * .8, hipY * .35, 10).translate(0, -hipY * .12, 0), bottom, 'skirt', 0, bT);
        // arms (shoulder → elbow → hand) with the hand sockets: +z along the fingers, so a held item points forward when the arm aims
        ['L', 'R'].forEach((s, i) => { const sg = i ? 1 : -1, ua = jt('arm' + s, chest, sg * (tw * .5 + ar * .9), torsoH * .62, 0), uc = sl ? top : skin, fc = sl === 2 ? top : skin;
          add(ua, sph(ar * 1.15), uc, 'arm', 0, sl ? tT : sT); add(ua, cyl(ar, ar * .9, uaL).translate(0, -uaL * .5, 0), uc, 'arm', 0, sl ? tT : sT); const fa = jt('fore' + s, ua, 0, -uaL, 0); add(fa, sph(ar * .95), fc, 'fore', 0, sl === 2 ? tT : sT); add(fa, cyl(ar * .9, ar * .75, faL).translate(0, -faL * .5, 0), fc, 'fore', 0, sl === 2 ? tT : sT); const hd = jt('hand' + s, fa, 0, -faL, 0); add(hd, sph(ar * .95, [1, 1.25, .7]).translate(0, -ar * .8, 0), bot ? dk : skin, 'hand'); sock('hand' + s, hd, 0, -ar * 1.1, ar * .3, R90); });
        // neck + head: skin, ears, nose, cheeks, eyes (white / iris / pupil / highlight), one brow mesh + one mouth mesh that swap geometry per expression
        const neck = jt('neck', chest, 0, torsoH * .72, 0); add(neck, cyl(hr * .35, hr * .4, hh * .3).translate(0, hh * .08, 0), skin, 'neck', 0, sT); const head = jt('head', neck, 0, hh * .2, 0), hy = hr * 1.02, hs = pick([[1, 1, 1], [.95, 1.1, .95], [1.06, .94, 1.06], [1, 1, 1], [.92, 1.04, 1]]), HD = (geo, hex, tag, unlit) => add(head, geo, hex, tag, unlit);
        HD(bot ? box(hr * 1.9, hr * 1.9, hr * 1.8).translate(0, hy, 0) : sph(hr, hs).translate(0, hy, 0), skin, 'head', 0); if (!bot) { HD(sph(hr * .12, [1, 1.1, 1.3]).translate(0, hy - hr * .1, hr * .95), skin, 'head'); [-1, 1].forEach(sg => HD(sph(hr * .22, [.5, 1, 1]).translate(sg * hr * .95, hy, 0), skin, 'head')); } if (!bot && (age === 'kid' || chance(.3))) [-1, 1].forEach(sg => HD(sph(hr * .13, [1, .6, .35]).translate(sg * hr * .48, hy - hr * .24, hr * .8), tint(skin, '#ff4a5a', .14), 'cheeks'));
        const eyeY = hy + hr * .08, eyeZ = hr * .82, ex = hr * .36, er = hr * (R.bigEyes ? .28 : .2), eyes = new THREE.Group(); eyes.name = 'eyes'; eyes.position.set(0, eyeY, eyeZ); head.add(eyes); if (bot) parts.face = { eyes: [solo(eyes, box(hr * 1.1, hr * .28, hr * .12), acc, true)], brows: [], mouth: solo(head, box(hr * .5, hr * .06, hr * .05).translate(0, hy - hr * .38, hr * .95), dk), eyesGroup: eyes };
        else { [-1, 1].forEach(sg => { add(eyes, sph(er, [1, 1, .55]).translate(sg * ex, 0, 0), '#ffffff', 'eyeW'); add(eyes, sph(er * .55, [1, 1, .5]).translate(sg * ex, 0, er * .38), eyeC, 'iris'); add(eyes, sph(er * .28, [1, 1, .5]).translate(sg * ex, 0, er * .55), '#111111', 'pupil'); add(eyes, sph(er * .09).translate(sg * ex + er * .18, er * .2, er * .68), '#ffffff', 'eyeW'); });
          const browG = t => merge([-1, 1].map(sg => box(hr * .34, hr * .07, hr * .06).rotateZ(sg * t).translate(sg * ex, 0, 0))), brows = solo(head, browG(0), hair); brows.position.set(0, eyeY + hr * .3, hr * .88); brows.userData.g = { neutral: brows.geometry, angry: browG(.45), sad: browG(-.4) }; brows.userData.y = brows.position.y; brows.userData.hr = hr;
          const mouth = solo(head, box(hr * .34, hr * .06, hr * .05), '#a04a3a'); mouth.position.set(0, hy - hr * .38, hr * .93); mouth.userData.g = { neutral: mouth.geometry, smile: tor(hr * .2, hr * .035, PI).rotateZ(PI).translate(0, hr * .1, 0), frown: tor(hr * .2, hr * .035, PI).translate(0, -hr * .1, 0), open: sph(hr * .13, [1, .9, .4]) }; parts.face = { eyes: [eyes], brows: [brows], mouth: mouth, eyesGroup: eyes };
          const beard = o.beard != null ? !!o.beard : (R.beard || (age === 'adult' || age === 'elder') && chance(.22)), mous = o.moustache != null ? !!o.moustache : (age === 'adult' || age === 'elder') && chance(.15); if (beard) HD(sph(hr * .72, [1, .55, .85]).translate(0, hy - hr * .6, hr * .3), hair, 'hair'); if (mous) HD(box(hr * .5, hr * .08, hr * .08).translate(0, hy - hr * .26, hr * .9), hair, 'hair');
          if (o.freckles != null ? o.freckles : chance(.25)) for (let i = 0; i < 6; i++) HD(sph(hr * .035).translate((rnd() - .5) * hr * .9, hy - hr * .14 + (rnd() - .5) * hr * .12, hr * .9), tint(skin, '#3e2a1e', .5), 'freckles'); if (R.patch) HD(box(hr * .34, hr * .3, hr * .08).translate(hr * .36, eyeY, hr * .9), '#111111', 'accessory'); }
        if (R.antenna || bot) [-1, 1].forEach(sg => { HD(cyl(.012, .012, hr * .7, 4).translate(sg * hr * .4, hy + hr * 1.2, 0), bot ? dk : skin, 'p'); HD(sph(hr * .1).translate(sg * hr * .4, hy + hr * 1.55, 0), acc, 'p', true); });
        // hair (11 styles; hats sit over it, helmets and hoods hide the cap)
        const hv = covered && ['long', 'ponytail', 'braids'].indexOf(hst) < 0 ? 'bald' : hst, hh2 = geo => HD(geo, hair, 'hair'); if (hv !== 'bald' && !covered) hh2(sph(hr * 1.04, hv === 'buzz' ? [1, .58, 1] : hv === 'afro' ? [1.4, 1.3, 1.15] : [1, .64, 1]).translate(0, hy + hr * (hv === 'afro' ? .15 : .42), -hr * (hv === 'afro' ? .55 : .05))); if (hv === 'curly') for (let i = 0; i < 7; i++) { const a = i / 7 * 6.2832; hh2(sph(hr * .32).translate(Math.cos(a) * hr * .8, hy + hr * .55 + Math.sin(a * 2) * hr * .1, Math.sin(a) * hr * .7)); }
        if (hv === 'long') { hh2(box(hr * 1.5, hr * 1.7, hr * .5).translate(0, hy - hr * .35, -hr * .8)); [-1, 1].forEach(sg => hh2(box(hr * .3, hr * 1.2, hr * .9).translate(sg * hr * .95, hy - hr * .1, -hr * .1))); } if (hv === 'ponytail') hh2(sph(hr * .28, [1, 2.4, 1]).translate(0, hy - hr * .1, -hr * 1.05)); if (hv === 'bun') hh2(sph(hr * .42).translate(0, hy + hr * .55, -hr * .6)); if (hv === 'mohawk') hh2(box(hr * .28, hr * .7, hr * 1.4).translate(0, hy + hr * .9, -hr * .1));
        if (hv === 'bob') hh2(new THREE.CylinderGeometry(hr * 1.12, hr * 1.18, hr * 1.2, 10, 1, false, .9, 4.48).translate(0, hy + hr * .05, -hr * .05)); if (hv === 'braids') [-1, 1].forEach(sg => hh2(cyl(hr * .14, hr * .1, hr * 1.5, 5).translate(sg * hr * .85, hy - hr * .6, -hr * .3)));
        // hats
        const hc = col('hatColor', R.hatC || top), HT = (geo, hex, u) => HD(geo, hex || hc, 'hat', u); if (hat === 'cap') { HT(cyl(hr * 1.05, hr * 1.05, hr * .5, 10).translate(0, hy + hr * .8, 0)); HT(box(hr * 1.1, hr * .08, hr * .9).translate(0, hy + hr * .62, hr * .95)); }
        else if (hat === 'helmet') { if (R.visor) parts.hat = solo(head, sph(hr * 1.2).translate(0, hy, 0), hc, false, .45); else { HT(sph(hr * 1.18, [1, .85, 1]).translate(0, hy + hr * .25, 0)); HT(box(hr * 2.5, hr * .12, hr * 1.6).translate(0, hy + hr * .05, hr * .3)); } } else if (hat === 'hat') { HT(cyl(hr * 1.9, hr * 1.9, hr * .1, 12).translate(0, hy + hr * .75, 0)); HT(cyl(hr * .95, hr * 1.05, hr * .9, 10).translate(0, hy + hr * 1.2, 0)); }
        else if (hat === 'crown') { HT(cyl(hr * 1.05, hr * .95, hr * .55, 6).translate(0, hy + hr * 1.1, 0), '#ffd23f', true); for (let i = 0; i < 6; i++) HT(sph(hr * .12).translate(Math.cos(i * 1.047) * hr, hy + hr * 1.4, Math.sin(i * 1.047) * hr), palette[5], true); } else if (hat === 'hardhat') { HT(sph(hr * 1.15, [1, .8, 1]).translate(0, hy + hr * .3, 0)); HT(cyl(hr * 1.45, hr * 1.45, hr * .1, 12).translate(0, hy + hr * .35, 0)); }
        else if (hat === 'beret') HT(sph(hr * 1.15, [1, .35, 1]).translate(hr * .25, hy + hr * .85, -hr * .1)); else if (hat === 'bandana') { HT(sph(hr * 1.06, [1, .5, 1]).translate(0, hy + hr * .5, 0)); HT(box(hr * .3, hr * .8, hr * .12).translate(hr * .3, hy - hr * .1, -hr * 1)); } else if (hat === 'chefhat') { HT(cyl(hr * .9, hr * .95, hr * 1.1, 10).translate(0, hy + hr * 1.1, 0)); HT(sph(hr * 1.05, [1, .7, 1]).translate(0, hy + hr * 1.7, 0)); }
        else if (hat === 'wizard') { HT(cyl(hr * 1.7, hr * 1.7, hr * .1, 12).translate(0, hy + hr * .7, 0)); HT(cone(hr * 1, hr * 2.6, 8).translate(0, hy + hr * 2, 0)); } else if (hat === 'hood') HT(sph(hr * 1.12).translate(0, hy + hr * .08, -hr * .35));
        // gear
        const ac = col('accessoryColor', '#5a3d22'), GA = (parent, geo, hex, u) => add(parent, geo, hex, 'accessory', u); if (gear.backpack) { GA(chest, box(tw * .8, torsoH * .7, td * .7).translate(0, torsoH * .35, -td * .8), ac); [-1, 1].forEach(sg => GA(chest, box(ar * .6, torsoH * .7, .03).translate(sg * tw * .3, torsoH * .4, td * .52), ac)); }
        if (gear.glasses) { [-1, 1].forEach(sg => GA(head, tor(hr * .21, hr * .03).translate(sg * ex, eyeY, eyeZ + er * .6), dk)); GA(head, box(hr * .3, hr * .05, hr * .05).translate(0, eyeY + hr * .02, eyeZ + er * .6), dk); [-1, 1].forEach(sg => GA(head, box(hr * .05, hr * .05, hr * .9).translate(sg * hr * .92, eyeY + hr * .05, hr * .4), dk)); }
        if (gear.goggles) { [-1, 1].forEach(sg => GA(head, cyl(hr * .2, hr * .2, hr * .14, 8).rotateX(R90).translate(sg * ex, hy + hr * .55, hr * .9), dk)); GA(head, cyl(hr * 1.06, hr * 1.06, hr * .12, 12).translate(0, hy + hr * .55, 0), dk); }
        if (gear.headset) { GA(head, tor(hr * 1.06, hr * .05).rotateY(R90).translate(0, hy + hr * .1, 0), dk); [-1, 1].forEach(sg => GA(head, cyl(hr * .22, hr * .22, hr * .14, 8).rotateZ(R90).translate(sg * hr * 1.02, hy, 0), dk)); GA(head, box(hr * .06, hr * .06, hr * .6).translate(hr * .7, hy - hr * .35, hr * .5), dk); } if (gear.belt) { add(hips, box(tw * .94, torsoH * .08, td * .98).translate(0, torsoH * .26, 0), dk, 'belt'); add(hips, box(tw * .16, torsoH * .1, .03).translate(0, torsoH * .26, td * .5), '#c9a34a', 'belt'); }
        if (gear.holster) GA(parts.legR, box(lr * .9, thL * .4, lr * .6).translate(lr * .9, -thL * .35, 0), '#3a2a20'); if (gear.kneepads) ['L', 'R'].forEach(s => GA(parts['shin' + s], sph(lr * .95, [1, 1.1, 1]).translate(0, 0, lr * .25), dk)); if (gear.cape) { const cl = torsoH * .95 + hipY * .5; add(chest, box(tw * 1.1, cl, .04).translate(0, torsoH * .7 - cl * .5, -td * .56), col('capeColor', R.accent || palette[5]), 'cape'); }
        if (gear.badge) add(chest, cyl(hr * .12, hr * .12, .03, 6).rotateX(R90).translate(-tw * .25, torsoH * .5, td * .52), '#ffd23f', 'trim', true); if (gear.tie) add(chest, box(hr * .16, torsoH * .5, .03).translate(0, torsoH * .42, td * .52), acc, 'tie'); if (gear.scarf) add(chest, cyl(hr * .85, hr * .95, hr * .4, 8).translate(0, torsoH * .74, 0), col('accessoryColor', role === 'pirate' ? '#d9362a' : acc), 'accessory'); if (gear.watch) GA(parts.foreL, box(ar * 2, ar * .5, ar * 2).translate(0, -faL * .85, 0), dk);
        sock('head', head, 0, hy + hr, 0); sock('back', chest, 0, torsoH * .4, -td * .5); sock('chest', chest, 0, torsoH * .45, td * .5); sock('hip', hips, tw * .45, torsoH * .15, 0);
      } else if (kind === 'robot') {
        const bc = col('top', pick([palette[3], '#8fa1b0', '#c9d3dc', palette[5], '#f2f4f7'])), ac = col('bottom', pick([palette[2], '#7cf0c8', '#ffd23f', '#ff5ea8'])), mT = tx('metal'), pT = tx('panel'), mech = style === 'mech', tw = (.5 + rnd() * .16) * (mech ? 1.5 : 1); H = (1.5 + rnd() * .4) * (mech ? 1.4 : 1); const legL = style === 'biped' || mech ? H * .35 : style === 'drone' ? H * .45 : H * .22, torsoH = H * .42, shY = legL + torsoH - .05;
        if (style === 'biped' || mech) ['L', 'R'].forEach((s, i) => { const sg = i ? 1 : -1, th = jt('leg' + s, body, sg * tw * .3, legL, 0, i ? PI : 0, .7); add(th, box(tw * .3, legL * .55, tw * .3).translate(0, -legL * .27, 0), dk, 'p', 0, mT); const sh = jt('shin' + s, th, 0, -legL * .52, 0); add(sh, box(tw * .34, legL * .5, tw * .34).translate(0, -legL * .24, 0), bc, 'p', 0, mT); add(sh, box(tw * .42, .12, tw * .55).translate(0, -legL * .48 + .06, .06), dk, 'p'); });
        else if (style === 'wheel') { const w = jt('wheel', body, 0, legL * .55, 0); add(w, cyl(legL * .55, legL * .55, tw * .5, 12).rotateZ(R90), dk, 'p'); J[J.length - 1].spin = 'x'; } else if (style === 'tread') { add(body, box(tw * 1.3, legL, tw * .95).translate(0, legL * .5, 0), dk, 'p'); add(body, box(tw * 1.36, legL * .35, tw).translate(0, legL * .5, 0), ac, 'p'); }
        else for (let i = 0; i < 4; i++) { const a = i * 1.5708 + .785; add(body, box(tw * .9, .05, tw * .12).rotateY(-a).translate(Math.cos(a) * tw * .45, legL + torsoH * .1, Math.sin(a) * tw * .45), dk, 'p'); const rt = jt('rotor' + i, body, Math.cos(a) * tw * .9, legL + torsoH * .14, Math.sin(a) * tw * .9); add(rt, cyl(tw * .32, tw * .32, .02, 8), ac, 'p', true); J[J.length - 1].spin = 'y'; }
        add(body, box(tw, torsoH, tw * .7).translate(0, legL + torsoH * .5, 0), bc, 'torso', 0, pT || mT); add(body, box(tw * .5, torsoH * .3, .06).translate(0, legL + torsoH * .6, tw * .36), ac, 'panel', true); [-1, 1].forEach(sg => add(body, box(tw * .18, torsoH * .5, .04).translate(sg * tw * .32, legL + torsoH * .35, tw * .36), dk, 'p'));
        ['L', 'R'].forEach((s, i) => { const sg = i ? 1 : -1, ua = jt('arm' + s, body, sg * tw * .66, shY, 0, i ? 0 : PI, .6); add(ua, sph(tw * .16), ac, 'p'); add(ua, box(tw * .22, torsoH * .5, tw * .22).translate(0, -torsoH * .25, 0), dk, 'p', 0, mT);
          const fa = jt('fore' + s, ua, 0, -torsoH * .5, 0); add(fa, box(tw * .2, torsoH * .45, tw * .2).translate(0, -torsoH * .22, 0), bc, 'p', 0, mT); const hd = jt('hand' + s, fa, 0, -torsoH * .45, 0); add(hd, sph(tw * .16).translate(0, -tw * .08, 0), ac, 'p'); sock('hand' + s, hd, 0, -tw * .15, tw * .1, R90); });
        const neck = jt('neck', body, 0, legL + torsoH, 0), hw = tw * .72, hh = tw * .55, head = jt('head', neck, 0, 0, 0); add(head, box(hw, hh, tw * .62).translate(0, hh * .55 + .04, 0), bc, 'head', 0, mT); add(neck, cyl(tw * .06, tw * .06, .08, 6).translate(0, .04, 0), dk, 'p'); parts.face = { eyes: [solo(head, box(hw * .8, hh * .3, .05).translate(0, hh * .6, tw * .32), ac, true)], brows: [], mouth: solo(head, box(hw * .4, hh * .08, .04).translate(0, hh * .22, tw * .33), dk) };
        add(head, cyl(.03, .03, hh * .8, 4).translate(0, hh * 1.4, 0), dk, 'p'); add(head, sph(.07).translate(0, hh * 1.85, 0), palette[5], 'p', true); [-1, 1].forEach(sg => add(head, cyl(hh * .25, hh * .25, .1, 8).rotateZ(R90).translate(sg * hw * .55, hh * .55, 0), ac, 'p')); if (mech) [-1, 1].forEach(sg => { add(body, box(tw * .34, tw * .2, tw * .5).translate(sg * tw * .62, shY + tw * .12, 0), ac, 'p'); add(body, sph(tw * .06).translate(sg * tw * .62, shY + tw * .24, tw * .2), palette[5], 'p', true); });
        if ((o.accessory || 'none') === 'backpack') add(body, cyl(tw * .18, tw * .18, torsoH * .8, 8).translate(0, legL + torsoH * .55, -tw * .45), dk, 'accessory'); sock('head', head, 0, hh * 1.1, 0); sock('back', body, 0, legL + torsoH * .6, -tw * .36); sock('chest', body, 0, legL + torsoH * .6, tw * .36); sock('hip', body, tw * .5, legL + .05, 0);
      } else {
        const [bw, bh, bl] = A.body, legN = A.legs[0], legL = A.legs[1] || 0, legR = A.legs[2] || .04, c0 = col('skin', pick(A.colors)), c1 = A.dark || (A.colors[1] && A.colors[1] !== c0 ? A.colors[1] : '#3a2a20'); const by = animal === 'fish' ? (water ? .4 : .5) : legL + bh * .45, tail = A.tail; H = by + bh * .5 + (A.headAt ? A.headAt[1] : 0) + (A.neck ? A.neck[1] * .5 : 0); add(body, A.fluffy || animal === 'fish' ? sph(1, [bw * .55, bh * .55, bl * .5]).translate(0, by, 0) : box(bw, bh, bl).translate(0, by, 0), c0, 'torso');
        if (A.fluffy) for (let i = 0; i < 4; i++) add(body, sph(bh * .32).translate((rnd() - .5) * bw * .8, by + bh * .25, (rnd() - .5) * bl * .8), c0, 'torso'); if (A.shell) { add(body, sph(1, [bw * .62, bh * 1.3, bl * .56]).translate(0, by + bh * .1, 0), A.shell, 'shell'); add(body, box(bw * .3, bh * .5, bl * .3).translate(0, by + bh * 1.2, 0), c1, 'shell'); } for (let i = 0; i < legN; i++) {
          const side = i % 2 ? 1 : -1, row = Math.floor(i / 2), n = legN === 2 ? 1 : (legN / 2), zz = legN === 2 ? 0 : (bl * .38 - row * (bl * .76 / (n - 1))); const p = jt('leg' + i, body, side * bw * (animal === 'crab' ? .55 : .35), by - bh * .4, zz, (i % 3 === 0 || (legN === 4 && (i === 0 || i === 3))) ? 0 : PI, animal === 'crab' ? .45 : .6, animal === 'crab' ? 'z' : 'x', animal === 'crab' ? side * .6 : 0);
          add(p, animal === 'crab' ? box(legL, legR * 2, legR * 2).translate(side * legL * .5, 0, 0) : cyl(legR, legR * .85, legL).translate(0, -legL * .5, 0), c1, 'p'); if (i < 2) sock(i ? 'handR' : 'handL', p, 0, -legL, legR);
        } if (A.headAt) {
          const [hw, hh, hl] = A.head, hx = A.headAt[0], hy = by + bh * .5 + A.headAt[1], hz = A.headAt[2]; if (A.neck) add(body, cyl(A.neck[0], A.neck[0] * 1.2, A.neck[1]).rotateX(-.7).translate(0, by + bh * .3 + A.neck[1] * .35, bl * .35 + A.neck[1] * .3), c0, 'torso'); const nk = jt('neck', body, hx, hy, hz, 1.5, .12), hd = jt('head', nk, 0, 0, 0); add(hd, box(hw, hh, hl).translate(0, 0, hl * .3), c0, 'head');
          if (A.snout) add(hd, box(hw * .55, hh * .5, A.snout * 2).translate(0, -hh * .15, hl * .8 + A.snout), c1, 'p'); if (A.beak) add(hd, cone(hw * .3, hw * .6, 4).rotateX(R90).translate(0, 0, hl * .8), '#ffb347', 'p'); [-1, 1].forEach(s => { add(hd, sph(hw * .15).translate(s * hw * .34, hh * .15, hl * .68), '#ffffff', 'eyeW'); add(hd, sph(hw * .09).translate(s * hw * .34, hh * .15, hl * .78), '#111111', 'pupil'); }); parts.face = { eyes: [hd], brows: [], mouth: null };
          const ear = A.ears; if (ear) [-1, 1].forEach(s => add(hd, ear === 'point' ? cone(hw * .2, hh * .6, 4).translate(s * hw * .3, hh * .7, -hl * .1) : ear === 'round' ? sph(hw * .22).translate(s * hw * .42, hh * .6, -hl * .1) : ear === 'tall' ? box(hw * .2, hh * 1.5, hw * .1).translate(s * hw * .25, hh * 1.1, -hl * .15) : box(hw * .28, hh * .6, hw * .12).translate(s * hw * (ear === 'flat' ? .62 : .5), ear === 'flat' ? hh * .15 : -hh * .05, -hl * .05), ear === 'floppy' ? c1 : c0, 'p'));
          if (A.antlers) [-1, 1].forEach(s => { add(hd, cyl(.015, .02, hh * 1.2, 4).rotateZ(-s * .4).translate(s * hw * .3, hh * 1, -hl * .1), '#8a6a4a', 'p'); add(hd, cyl(.012, .015, hh * .6, 4).rotateZ(-s * 1.2).translate(s * hw * .5, hh * 1.3, -hl * .1), '#8a6a4a', 'p'); }); if (A.horns) [-1, 1].forEach(s => add(hd, cone(hw * .12, hh * .7, 5).rotateX(-.6).translate(s * hw * .3, hh * .6, -hl * .25), c1, 'p')); sock('head', hd, 0, hh * .5, 0);
        } else parts.face = { eyes: [], brows: [], mouth: null }; if (tail) { const tp = jt('tail', body, 0, by + bh * .3, -bl * .5, 0, .35, 'y'); add(tp, cyl(legR * (A.bushy ? 2.4 : 1.2), legR * .5, tail[0]).rotateX(-R90 + tail[1]).translate(0, tail[0] * .3 * Math.sin(tail[1]), -tail[0] * .5 * Math.cos(tail[1])), c1, 'p'); }
        if (A.wings) [-1, 1].forEach(s => { const w = jt(s < 0 ? 'wingL' : 'wingR', body, s * bw * .45, by + bh * .3, 0, 0, .9, 'z', -s * .3); add(w, box(bw * 1.6, .03, bl * .5).translate(s * bw * .8, 0, 0), c1, 'p'); }); if (A.claws) [-1, 1].forEach(s => { const cw = jt(s < 0 ? 'clawL' : 'clawR', body, s * bw * .4, by, bl * .5, s > 0 ? 0 : PI, .3, 'y'); add(cw, sph(bw * .18, [1, .7, 1.3]).translate(s * bw * .1, 0, bw * .25), c0, 'p'); add(body, sph(.035).translate(s * bw * .18, by + bh * .6, bl * .4), '#111111', 'pupil'); });
        if (A.fins) { const tf = jt('tail', body, 0, by, -bl * .45, 0, .6, 'y'); add(tf, box(.03, bh * .9, bl * .35).translate(0, 0, -bl * .2), c0, 'p'); [-1, 1].forEach(s => { add(body, box(bw * .8, .03, bl * .3).rotateZ(s * .5).translate(s * bw * .5, by - bh * .1, bl * .05), c0, 'torso'); add(body, sph(bw * .15).translate(s * bw * .38, by + bh * .1, bl * .32), '#111111', 'pupil'); }); add(body, box(.03, bh * .5, bl * .4).translate(0, by + bh * .45, -bl * .05), c0, 'torso'); }
        sock('back', body, 0, by + bh * .5, 0); sock('chest', body, 0, by, bl * .5); sock('hip', body, 0, by, -bl * .4); if (!sockets.handR) { sock('handL', body, -bw * .4, by, bl * .4); sock('handR', body, bw * .4, by, bl * .4); }
      } flush(); g.scale.setScalar(size); g.userData.radius = (A ? Math.max(A.body[0], A.body[2]) * .5 : .5) * size; g.userData.height = H * size; g.userData.kind = kind; g.userData.role = animal || style || role; if (o.pos) { toV3(o.pos, g.position); if (o.snap !== false) g.position.y += groundY(g.position.x, g.position.z); } if (o.add !== false) scene.add(g); g.anim = makeAnim(g, body, J, parts, kind, cfg);
      const FACES = { happy: [.1, 'neutral', 'smile'], neutral: [0, 'neutral', 'neutral'], angry: [-.15, 'angry', 'frown'], surprised: [.25, 'neutral', 'open'], sad: [.08, 'sad', 'frown'] };
      g.face = { expression: 'neutral', set(e) { const f = FACES[e] || FACES.neutral, fc = parts.face; g.face.expression = FACES[e] ? e : 'neutral'; if (!fc) return g; const b = fc.brows[0], m = fc.mouth; if (b && b.userData.g) { b.geometry = b.userData.g[f[1]]; b.position.y = b.userData.y + f[0] * b.userData.hr; } if (m && m.userData.g) m.geometry = m.userData.g[f[2]]; return g; } }; g.face.set(o.expression || R.expr || 'neutral'); return g;
    }
    // ── animation: every joint has a target rotation; states write targets, update(dt) blends toward them (no snapping, no allocations) ──
    function makeAnim(g, body, J, parts, kind, cfg) {
      const st = { t: 0, one: null, ot: 0, dead: false, talk: false, base: body.position.y, aim: false, crouch: false, sit: false, carry: false, by: 0, bx: 0, blink: 3, bt: 0, lt: 0, lx: 0, ly: 0, wander: 0, wx: 0, wy: 0, px: 0, pz: 0 }; const rate = kind === 'animal' ? 11 : 8, human = cfg.human, PI = 3.1416, jn = {}, tmp = new THREE.Vector3(); J.forEach(j => { jn[j.name] = j; });
      const T = (n, x, y, z) => { const j = jn[n]; if (j) { j.x = x || 0; j.y = y || 0; j.z = z || 0; } }, eyes = parts.face && parts.face.eyesGroup, mouth = parts.face && parts.face.mouth, arms = () => !st.aim && !st.carry; const gait = (t, A, run) => { const sL = Math.sin(t), sR = -sL;
        if (st.sit) return; if (st.crouch) { T('legL', -.9 + sL * .3); T('legR', -.9 + sR * .3); T('shinL', 1.3); T('shinR', 1.3); T('footL', -.4); T('footR', -.4); } else { T('legL', sL * A); T('legR', sR * A); T('shinL', Math.max(0, -Math.cos(t)) * A * 1.3 + .1); T('shinR', Math.max(0, Math.cos(t)) * A * 1.3 + .1); T('footL', -Math.max(0, sL) * .3); T('footR', -Math.max(0, sR) * .3); }
        if (arms()) { T('armL', sR * A * .7 + .1, 0, -.12); T('armR', sL * A * .7 + .1, 0, .12); T('foreL', -.3 - Math.max(0, sR) * .5); T('foreR', -.3 - Math.max(0, sL) * .5); } T('hips', 0, sL * .06, 0); T('chest', cfg.lean + (st.crouch ? .35 : run ? .16 : .04), -sL * .1, 0); if (st.lt <= 0) T('head', -.03, sL * .05, 0); };
      const rest = () => { if (st.crouch) { T('legL', -.9); T('legR', -.9); T('shinL', 1.3); T('shinR', 1.3); T('footL', -.4); T('footR', -.4); } else if (!st.sit) { T('legL'); T('legR'); T('shinL', .05); T('shinR', .05); T('footL'); T('footR'); } if (arms()) { T('armL', Math.sin(st.t) * .04, 0, -.14); T('armR', -Math.sin(st.t) * .04, 0, .14); T('foreL', -.25); T('foreR', -.25); } };
      const end = () => { st.one = null; if (!human) { T('armL'); T('armR'); T('foreL'); T('foreR'); } };   // sin-driven rigs never rewrite y/z, so a one-shot must hand them back
      const A = {
        update(dt) {
          const k = 1 - Math.exp(-dt * 12), q = (st.ot += dt); if (st.dead) { const f = Math.min(1, st.ot / .5); body.rotation.x = -R90 * f; body.position.y = st.base + .25 * f; for (let i = 0; i < J.length; i++) J[i].x = J[i].y = J[i].z = 0; } else {
            if (st.one === 'wave') { T('armR', 0, 0, 2.6); T('foreR', 0, 0, Math.sin(q * 14) * .5); if (q > 1.2) end(); } else if (st.one === 'jump') { if (human) { T('legL', -.6); T('legR', -.6); T('shinL', 1); T('shinR', 1); T('armL', -.5, 0, -.5); T('armR', -.5, 0, .5); } else for (let i = 0; i < J.length; i++) { const j = J[i]; if (j.amp && j.ax === 'x') j.x = j.base - .55 * j.amp; } if (q > .45) end(); }
            else if (st.one === 'hit') { const s = 1 + .18 * Math.sin(Math.min(1, q / .25) * PI); body.scale.set(s, 1 / s, s); if (human) T('chest', -.3, 0, 0); else st.bx = -.3 * (1 - Math.min(1, q / .3)); if (q > .3) { body.scale.set(1, 1, 1); end(); } } else if (st.one === 'celebrate') { const w = Math.sin(q * 10) * .25; T('armL', -2.9 + w, 0, -.35); T('armR', -2.9 - w, 0, .35); T('foreL', -.3); T('foreR', -.3); st.by = Math.abs(Math.sin(q * 8)) * .08; if (q > 1.4) end(); }
            else if (st.one === 'point') { T('armR', st.px, 0, st.pz); T('foreR', 0); if (q > 1.6) end(); } if (st.aim) { T('armR', -R90 + .1, 0, .15); T('foreR', -.15); T('armL', -1.35, 0, .4); T('foreL', -.6); } else if (st.carry) { T('armL', -1.2, 0, .25); T('armR', -1.2, 0, -.25); T('foreL', -.5); T('foreR', -.5); } if (st.sit) { T('legL', -R90 + .1); T('legR', -R90 + .1); T('shinL', R90 - .1); T('shinR', R90 - .1); T('footL'); T('footR'); } if (st.lt > 0) { st.lt -= dt; T('head', st.lx, st.ly, 0); }
            if (eyes) { st.blink -= dt; if (st.blink <= 0) { st.blink = 3 + Math.random() * 3; st.bt = .12; } st.bt -= dt; eyes.scale.y = st.bt > 0 ? .12 : 1; } if (st.talk && mouth) mouth.scale.y = 1 + Math.abs(Math.sin(performance.now() / 90)) * 2.2; body.rotation.x += (st.bx - body.rotation.x) * k;
          } for (let i = 0; i < J.length; i++) { const j = J[i], r = j.p.rotation; if (j.spin) continue; r.x += (j.x - r.x) * k; r.y += (j.y - r.y) * k; r.z += (j.z - r.z) * k; } body.position.y += (st.base + st.by - body.position.y) * k;
        }, walk(dt, speed, run) {
          if (st.dead) return; const mul = run ? 1.45 : 1; st.t += dt * rate * mul * clamp(speed == null ? 1 : +speed, .3, 2.2) * (st.crouch ? .7 : 1); st.sit = false; const t = st.t; if (human) gait(t, run ? .9 : .55, run); else for (let i = 0; i < J.length; i++) { const j = J[i]; if (j.spin) j.p.rotation[j.spin] -= dt * 6 * mul; else if (j.amp) j[j.ax] = j.base + Math.sin(t + j.ph) * j.amp * mul; }
          st.by = Math.abs(Math.sin(t)) * (cfg.hop ? .12 : run ? .07 : .035) - (st.crouch ? cfg.thL * .45 : 0) + (cfg.hover ? .15 + Math.sin(t * .4) * .06 : 0); st.bx = human ? 0 : (run ? .18 : .04); A.update(dt);
        }, run(dt, speed) { A.walk(dt, speed == null ? 1.6 : speed, true); }, idle(dt) {
          if (st.dead) return; st.t += dt * 2; const t = st.t; if (human) { rest(); T('hips', 0, 0, Math.sin(t * .4) * .03); T('chest', cfg.lean + (st.crouch ? .35 : 0), 0, -Math.sin(t * .4) * .02); if (parts.torso) parts.torso.scale.y = 1 + .015 * Math.sin(t * .8);
            st.wander -= dt; if (st.wander <= 0) { st.wander = 2 + Math.random() * 4; st.wy = (Math.random() - .5) * 1.2; st.wx = (Math.random() - .5) * .3; } if (st.lt <= 0) T('head', st.wx, st.wy, 0); }
          else for (let i = 0; i < J.length; i++) { const j = J[i]; if (j.spin) { if (j.spin === 'y') j.p.rotation.y -= dt * 4; } else if (j.amp) j[j.ax] = j.base + Math.sin(t + j.ph) * j.amp * .06; if (j.name === 'head' && st.lt <= 0) j.y = Math.sin(t * .5) * .15; } st.by = Math.sin(t) * .012 - (st.crouch ? cfg.thL * .45 : st.sit ? cfg.hipY - cfg.shL * .95 : 0) + (cfg.hover ? .15 + Math.sin(t * .8) * .06 : 0); st.bx = 0; A.update(dt);
        }, wave() { st.one = 'wave'; st.ot = 0; }, jump() { st.one = 'jump'; st.ot = 0; }, hit() { st.one = 'hit'; st.ot = 0; }, celebrate() { st.one = 'celebrate'; st.ot = 0; }, die() { st.dead = true; st.ot = 0; }, aim(on) { st.aim = on !== false; }, crouch(on) { st.crouch = on !== false; if (st.crouch) st.sit = false; }, sit(on) { st.sit = on !== false; if (st.sit) st.crouch = false; }, carry(on) { st.carry = on !== false; },
        point(v) { toV3(v, tmp); g.worldToLocal(tmp); tmp.y -= cfg.hipY + cfg.thL; const l = tmp.length() || 1; st.pz = Math.asin(clamp(tmp.x / l, -1, 1)); st.px = Math.atan2(-tmp.z, -tmp.y); st.one = 'point'; st.ot = 0; }, lookAt(v) { toV3(v, tmp); g.worldToLocal(tmp); tmp.y -= (g.userData.height || 1.6) / (g.scale.y || 1) * .9; st.ly = clamp(Math.atan2(tmp.x, tmp.z), -1.2, 1.2); st.lx = clamp(-Math.atan2(tmp.y, Math.hypot(tmp.x, tmp.z)), -.6, .6); st.lt = 2; },
        talk(on) { st.talk = on !== false; if (!st.talk && mouth) mouth.scale.y = 1; }, get dead() { return st.dead; }, state: st
      }; return A;
    }

    // ── collisions: circles {x,z,r} (scatter positions) or boxes {x,z,hw,hd} ──
    function collide(p, pr, list) {
      for (let i = 0; i < list.length; i++) {
        const ob = list[i]; if (!ob) continue;
        const dx = p.x - ob.x, dz = p.z - ob.z;
        if (ob.hw != null) {
          const ox = ob.hw + pr - Math.abs(dx), oz = (ob.hd != null ? ob.hd : ob.hw) + pr - Math.abs(dz);
          if (ox <= 0 || oz <= 0) continue;
          if (ox < oz) p.x += ox * (dx < 0 ? -1 : 1); else p.z += oz * (dz < 0 ? -1 : 1);
        } else {
          const d = Math.hypot(dx, dz), min = (+ob.r || .5) + pr;
          if (d < min && d > 1e-4) { p.x += dx / d * (min - d); p.z += dz / d * (min - d); }
        }
      }
    }
    const boundsOf = b => typeof b === 'number' ? { minX: -b, maxX: b, minZ: -b, maxZ: b } : Object.assign({ minX: -half + 1, maxX: half - 1, minZ: -half + 1, maxZ: half - 1 }, b || {});
    const addObstacles = (list, src) => { if (src && src.soft) return list; (Array.isArray(src) ? src : (src && src.positions) || []).forEach(p => { if (p) list.push(p); }); return list; };
    const detachCamera = () => { if (camera.parent) camera.parent.remove(camera); camera.rotation.set(0, 0, 0); };

    // ── player: first-person rig / third-person camera (you move the mesh) / avatar controller (moves + animates a character) ──
    const player = { current: null, fps: fps, thirdPerson: thirdPerson, avatar: avatar };
    function fps(o) {
      o = o || {};
      if (player.current && player.current.kind === 'fps') { warn('player.fps already created — returning it'); return player.current; }
      const rig = new THREE.Group(), speed = +o.speed || 6, jumpV = +o.jump || 7, h = +o.height || 1.7, grav = +o.gravity || 22;
      const sprintMul = o.sprint === false ? 1 : (typeof o.sprint === 'number' ? o.sprint : 1.6), bobA = o.bob === false ? 0 : (typeof o.bob === 'number' ? o.bob : .05);
      detachCamera(); camera.position.set(0, h, 0); rig.add(camera); scene.add(rig);
      toV3(o.pos || [0, 0, 6], rig.position); rig.position.y = groundY(rig.position.x, rig.position.z);
      const bounds = boundsOf(o.bounds);
      const c = { kind: 'fps', object: rig, camera: camera, pos: rig.position, vel: new THREE.Vector3(), yaw: 0, pitch: 0, onGround: true, enabled: true, radius: .45, obstacles: addObstacles([], o.obstacles), t: 0, crouching: false };
      c.update = dt => {
        if (!c.enabled) return;
        const k = kit(), a = k ? k.input.axis() : { x: 0, y: 0 }, look = k ? k.input.look : { dx: 0, dy: 0 }, sens = (+o.sensitivity || 1) * .0022;
        c.yaw -= look.dx * sens; c.pitch = clamp(c.pitch - look.dy * sens, -1.45, 1.45);
        rig.rotation.y = c.yaw; camera.rotation.x = c.pitch;
        const sprint = !!k && sprintMul !== 1 && (k.input.pressed('ShiftLeft') || k.input.pressed('ShiftRight'));
        c.crouching = !!k && o.crouch !== false && (k.input.pressed('KeyC') || k.input.pressed('ControlLeft'));
        const sp = speed * (sprint ? sprintMul : 1) * (c.crouching ? .5 : 1), len = Math.hypot(a.x, a.y) || 1, ax = a.x / Math.max(1, len), ay = a.y / Math.max(1, len);
        const sin = Math.sin(c.yaw), cos = Math.cos(c.yaw);
        c.vel.x = (ax * cos + ay * sin) * sp; c.vel.z = (-ax * sin + ay * cos) * sp;
        if (c.onGround && k && o.jump !== false && k.input.pressed('Space')) { c.vel.y = jumpV; c.onGround = false; }
        c.vel.y -= grav * dt;
        rig.position.x += c.vel.x * dt; rig.position.z += c.vel.z * dt; rig.position.y += c.vel.y * dt;
        rig.position.x = clamp(rig.position.x, bounds.minX, bounds.maxX); rig.position.z = clamp(rig.position.z, bounds.minZ, bounds.maxZ);
        collide(rig.position, c.radius, c.obstacles);
        const gy = groundY(rig.position.x, rig.position.z);
        if (rig.position.y <= gy + (c.onGround && c.vel.y <= 0 ? .35 : 0)) { rig.position.y = gy; c.vel.y = 0; c.onGround = true; }
        const moving = c.onGround && (ax || ay), lerp = Math.min(1, dt * 12);
        c.t += moving ? dt * (sprint ? 14 : 10) : 0;
        const th = (c.crouching ? h * .55 : h) + (moving ? Math.sin(c.t) * bobA : 0);
        camera.position.y += (th - camera.position.y) * lerp;
        camera.position.x += ((moving ? Math.cos(c.t * .5) * bobA * .6 : 0) - camera.position.x) * lerp;
        camera.rotation.z += ((o.sway === false ? 0 : -ax * .025) - camera.rotation.z) * lerp;
      };
      c.lookAt = v => { const t = toV3(v, V), dx = t.x - rig.position.x, dz = t.z - rig.position.z; c.yaw = Math.atan2(-dx, -dz); c.pitch = clamp(Math.atan2(t.y - (rig.position.y + h), Math.hypot(dx, dz)), -1.45, 1.45); rig.rotation.y = c.yaw; camera.rotation.x = c.pitch; };
      c.enable = b => { c.enabled = b !== false; };
      c.requestLook = () => { const k = kit(); if (k && k.input.pointerLock) k.input.pointerLock(canvas); };
      c.collide = src => { addObstacles(c.obstacles, src); return c; };
      c.teleport = v => { toV3(v, rig.position); rig.position.y = groundY(rig.position.x, rig.position.z); c.vel.set(0, 0, 0); return c; };
      c.forward = out => (out || new THREE.Vector3()).set(-Math.sin(c.yaw) * Math.cos(c.pitch), Math.sin(c.pitch), -Math.cos(c.yaw) * Math.cos(c.pitch));
      c.eye = out => camera.getWorldPosition(out || new THREE.Vector3());
      player.current = c; return c;
    }
    function thirdPerson(target, o) {
      o = o || {};
      if (!target || !target.position) { warn('player.thirdPerson(mesh, opts): mesh required'); return stub().player.thirdPerson(); }
      detachCamera(); scene.add(camera);
      const dist = +o.distance || 7, height = +o.height || 3.5, lag = +o.lag || .12, look = new THREE.Vector3();
      const c = { kind: 'third', object: camera, camera: camera, target: target, pos: target.position, vel: new THREE.Vector3(), onGround: true, enabled: true, obstacles: [], update: noop, lookAt: noop, requestLook: noop, teleport: noop, collide: src => { addObstacles(c.obstacles, src); return c; } };
      let first = true;
      c.update = dt => {
        if (!c.enabled) return;
        V.set(-Math.sin(target.rotation.y) * -dist, height, -Math.cos(target.rotation.y) * -dist).add(target.position); V.y = Math.max(V.y, groundY(V.x, V.z) + .7);
        if (first) { camera.position.copy(V); first = false; } else camera.position.lerp(V, 1 - Math.exp(-dt / lag));
        look.copy(target.position); look.y += height * .35; camera.lookAt(look);
      };
      c.enable = b => { c.enabled = b !== false; };
      player.current = c; return c;
    }
    function avatar(char, o) {
      o = o || {};
      if (!char || !char.position) { warn('player.avatar(char, opts): a character (props.character) is required'); return stub().player.avatar(); }
      if (!char.parent) scene.add(char);
      detachCamera(); scene.add(camera);
      const mode = ['follow', 'shoulder', 'iso', 'top'].indexOf(o.camera) >= 0 ? o.camera : 'follow', flat = mode === 'iso' || mode === 'top';
      const speed = +o.speed || 6, runMul = o.run === false ? 1 : (+o.run || 1.6), jumpV = o.jump === false ? 0 : (+o.jump || 7), grav = +o.gravity || 22, turn = +o.turn || 10;
      const dist = +o.distance || { follow: 8, shoulder: 4, iso: 16, top: 18 }[mode], height = +o.height || { follow: dist * .5, shoulder: dist * .55, iso: dist * .85, top: dist * 1.3 }[mode], lag = +o.lag || .12;
      const bounds = boundsOf(o.bounds), look = new THREE.Vector3(), hh = (char.userData.height || 1.7);
      if (o.pos) toV3(o.pos, char.position); char.position.y = groundY(char.position.x, char.position.z);
      const c = { kind: 'avatar', object: char, target: char, camera: camera, pos: char.position, vel: new THREE.Vector3(), yaw: char.rotation.y, camYaw: mode === 'iso' ? -.785 : mode === 'top' ? 0 : char.rotation.y + 3.1416, onGround: true, enabled: true, radius: char.userData.radius || .5, obstacles: addObstacles([], o.obstacles), moving: false, running: false, mode: mode };
      let first = true;
      c.update = dt => {
        if (!c.enabled) return;
        const k = kit(), a = k ? k.input.axis() : { x: 0, y: 0 }, lk = k && !flat && document.pointerLockElement ? k.input.look : null;
        if (lk) c.camYaw -= lk.dx * .0022 * (+o.sensitivity || 1);
        const run = !!k && runMul !== 1 && (k.input.pressed('ShiftLeft') || k.input.pressed('ShiftRight')), sp = speed * (run ? runMul : 1);
        const len = Math.max(1, Math.hypot(a.x, a.y)), ax = a.x / len, ay = a.y / len, sin = Math.sin(c.camYaw), cos = Math.cos(c.camYaw);
        c.vel.x = (ax * cos + ay * sin) * sp; c.vel.z = (-ax * sin + ay * cos) * sp;
        c.moving = !!(ax || ay); c.running = c.moving && run;
        if (c.onGround && jumpV && k && k.input.pressed('Space')) { c.vel.y = jumpV; c.onGround = false; if (char.anim) char.anim.jump(); }
        c.vel.y -= grav * dt;
        const p = char.position; p.x += c.vel.x * dt; p.z += c.vel.z * dt; p.y += c.vel.y * dt;
        p.x = clamp(p.x, bounds.minX, bounds.maxX); p.z = clamp(p.z, bounds.minZ, bounds.maxZ);
        collide(p, c.radius, c.obstacles);
        const gy = groundY(p.x, p.z);
        if (p.y <= gy + (c.onGround && c.vel.y <= 0 ? .35 : 0)) { p.y = gy; c.vel.y = 0; c.onGround = true; }
        if (c.moving) c.yaw = lerpAngle(c.yaw, Math.atan2(c.vel.x, c.vel.z), Math.min(1, dt * turn));
        char.rotation.y = c.yaw;
        if (char.anim) { if (!c.onGround) char.anim.update(dt); else if (c.moving) { if (run) char.anim.run(dt); else char.anim.walk(dt, 1); } else char.anim.idle(dt); }
        const behind = c.yaw + 3.1416, off = Math.abs(((behind - c.camYaw) % 6.2832 + 9.4248) % 6.2832 - 3.1416);
        if (mode === 'follow' && c.moving && !lk && o.turn !== false && off < 1.75) c.camYaw = lerpAngle(c.camYaw, behind, Math.min(1, dt * 1.6));
        if (mode === 'top') V.set(p.x, p.y + height, p.z + dist * .25);
        else { V.set(p.x + sin * dist, p.y + height, p.z + cos * dist); if (mode === 'shoulder') { V.x += cos * .9; V.z -= sin * .9; } }
        V.y = Math.max(V.y, groundY(V.x, V.z) + .7);
        if (first) { camera.position.copy(V); first = false; } else camera.position.lerp(V, 1 - Math.exp(-dt / lag));
        look.set(p.x, p.y + hh * (mode === 'shoulder' ? .85 : .55), p.z); if (mode === 'shoulder') { look.x += cos * .9; look.z -= sin * .9; } camera.lookAt(look);
      };
      c.enable = b => { c.enabled = b !== false; };
      c.requestLook = () => { const k = kit(); if (k && k.input.pointerLock && !flat) k.input.pointerLock(canvas); };
      c.collide = src => { addObstacles(c.obstacles, src); return c; };
      c.teleport = v => { toV3(v, char.position); char.position.y = groundY(char.position.x, char.position.z); c.vel.set(0, 0, 0); first = true; return c; };
      c.lookAt = v => { const t = toV3(v, V); c.yaw = Math.atan2(t.x - char.position.x, t.z - char.position.z); char.rotation.y = c.yaw; };
      c.forward = out => (out || new THREE.Vector3()).set(Math.sin(c.yaw), 0, Math.cos(c.yaw));
      c.eye = out => (out || new THREE.Vector3()).set(char.position.x, char.position.y + hh * .8, char.position.z);
      c.update(0); player.current = c; return c;
    }

    // ── enemies: patrol → detect → chase → cover / search FSM on the terrain; characters animate as they move ──
    const enemies = [];
    function enemy(mesh, o) {
      o = o || {};
      if (!mesh || !mesh.position) { warn('enemy(mesh, opts): mesh required'); return stub().enemy(); }
      if (!mesh.parent) scene.add(mesh);
      const wps = (o.waypoints || []).map(w => toV3(w)), speed = +o.speed || 3, sight = +o.sightRange || 14, fov = (+o.fov || 120) * Math.PI / 180, fly = !!o.fly;
      const cover = (o.cover || []).map(w => toV3(w));
      const e = { mesh: mesh, pos: mesh.position, state: 'patrol', alive: true, wp: 0, lost: 0, timer: 0, wait: 0, last: new THREE.Vector3(), sees: false, moved: false };
      const cb = fn => { if (typeof fn === 'function') { try { fn(e); } catch (x) { console.error(x); } } };
      const targetPos = () => { if (o.target) { const t = o.target(); return t ? (t.position || t.pos || t) : null; } return player.current ? player.current.pos : null; };
      const canSee = tp => {
        if (!tp) return false;
        const dx = tp.x - e.pos.x, dz = tp.z - e.pos.z, d = Math.hypot(dx, dz);
        if (d > sight) return false; if (d < 2) return true;
        return (dx * Math.sin(mesh.rotation.y) + dz * Math.cos(mesh.rotation.y)) / d >= Math.cos(fov / 2);
      };
      const moveTo = (tx, tz, dt, sp) => {
        const dx = tx - e.pos.x, dz = tz - e.pos.z, d = Math.hypot(dx, dz); if (d < .1) return true;
        const st = Math.min(d, sp * dt); e.pos.x += dx / d * st; e.pos.z += dz / d * st; mesh.rotation.y = Math.atan2(dx, dz); e.moved = true; return d - st < .3;
      };
      const set = s => { if (e.state !== s) { e.state = s; e.timer = 0; e.wait = 0; } };
      const nearestCover = () => { let best = null, bd = Infinity; cover.forEach(cv => { const d = Math.hypot(cv.x - e.pos.x, cv.z - e.pos.z); if (d < bd) { bd = d; best = cv; } }); return best; };
      e.update = dt => {
        if (!e.alive) return;
        e.timer += dt; e.moved = false;
        const tp = targetPos(), sees = e.sees = canSee(tp);
        if (sees) { e.last.set(tp.x, 0, tp.z); e.lost = 0; } else e.lost += dt;
        switch (e.state) {
          case 'patrol':
            if (sees) { set('detect'); cb(o.onSee); break; }
            if (wps.length) { if (moveTo(wps[e.wp].x, wps[e.wp].z, dt, speed * .6)) e.wp = (e.wp + 1) % wps.length; } else mesh.rotation.y += dt * .6;
            break;
          case 'detect': if (e.timer > (o.detectDelay == null ? .4 : +o.detectDelay)) set('chase'); break;
          case 'chase':
            if (!sees && e.lost > (+o.loseTime || 1.5)) { set('search'); cb(o.onLose); break; }
            if (tp && Math.hypot(tp.x - e.pos.x, tp.z - e.pos.z) < (+o.reach || 1.3)) {
              if (e.wait <= 0) { e.wait = +o.reachEvery || 1; cb(o.onReach); if (cover.length) set('cover'); }
              else e.wait -= dt;
              break;
            }
            moveTo(e.last.x, e.last.z, dt, speed); break;
          case 'cover': { const cv = nearestCover(); if (!cv || moveTo(cv.x, cv.z, dt, speed)) { e.wait += dt; if (e.wait > (+o.coverTime || 2)) set(sees ? 'chase' : 'search'); } break; }
          case 'search':
            if (sees) { set('chase'); cb(o.onSee); break; }
            if (moveTo(e.last.x, e.last.z, dt, speed * .8)) { mesh.rotation.y += dt * 1.5; e.wait += dt; if (e.wait > (+o.searchTime || 2.5)) set('patrol'); }
            break;
        }
        if (!fly) e.pos.y = groundY(e.pos.x, e.pos.z) + (+o.hover || 0);
        if (mesh.anim) { if (e.moved) mesh.anim.walk(dt, e.state === 'chase' ? 1.5 : .9, e.state === 'chase'); else mesh.anim.idle(dt); }
      };
      e.setState = set;
      e.takeCover = () => { if (cover.length) set('cover'); };
      e.kill = () => { if (!e.alive) return; e.alive = false; e.state = 'dead'; const i = enemies.indexOf(e); if (i >= 0) enemies.splice(i, 1);
        if (mesh.anim && o.fade !== false) { mesh.anim.die(); const d0 = performance.now(), fall = () => { mesh.anim.update(.016); if (performance.now() - d0 < 900) requestAnimationFrame(fall); else scene.remove(mesh); }; fall(); } else scene.remove(mesh); };
      enemies.push(e); return e;
    }

    // ── projectiles: pooled spheres with gravity, sphere-vs-bounding-sphere hits ──
    const systems = [];
    function projectiles(o) {
      o = o || {};
      const n = clamp(o.pool | 0 || 24, 1, 96), radius = +o.radius || .15, grav = o.gravity == null ? 9.8 : +o.gravity, life = +o.life || 3;
      const geo = new THREE.SphereGeometry(radius, 6, 4), base = matFor(o.color || palette[5], true), pool = [];
      for (let i = 0; i < n; i++) { const m = new THREE.Mesh(geo, base); m.visible = false; m.userData.noRay = true; scene.add(m); pool.push({ m: m, v: new THREE.Vector3(), t: 0, on: false, data: null }); }
      const hitInfo = tm => tm.userData.__hit || (tm.userData.__hit = (() => { const b = new THREE.Box3().setFromObject(tm); if (b.isEmpty()) return { r: .8, cy: .8 }; b.getSize(V); return { r: Math.max(.3, V.length() / 2 * .9), cy: (b.min.y + b.max.y) / 2 - tm.position.y }; })());
      const sys = { count: 0, pool: pool,
        fire(from, dir, fo) {
          fo = fo || {};
          const pc = player.current, f = from ? toV3(from, V) : (pc && pc.eye ? pc.eye(V) : V.set(0, 1.5, 0));
          const d = dir ? toV3(dir, V2) : (pc && pc.forward ? pc.forward(V2) : V2.set(0, 0, -1));
          if (d.lengthSq() < 1e-6) d.set(0, 0, -1);
          let p = pool.find(q => !q.on) || pool.reduce((a, b) => (a.t > b.t ? a : b));
          if (p.on) sys.count--;
          p.m.position.copy(f); p.v.copy(d).normalize().multiplyScalar(+fo.speed || +o.speed || 30); p.t = 0; p.on = true; p.data = fo.data || null;
          p.m.material = fo.color ? matFor(fo.color, true) : base; p.m.visible = true; sys.count++;
          return p.m;
        },
        update(dt) {
          if (!sys.count) return;
          const targets = (typeof o.targets === 'function' ? o.targets() : o.targets) || [];
          for (let i = 0; i < pool.length; i++) {
            const p = pool[i]; if (!p.on) continue;
            const pos = p.m.position, steps = clamp(Math.ceil(p.v.length() * dt / .7), 1, 12), sdt = dt / steps;   // sub-steps: no tunnelling through a target on a slow frame
            for (let k = 0; k < steps && p.on; k++) {
              p.v.y -= grav * sdt; pos.addScaledVector(p.v, sdt); p.t += sdt;
              const floor = pos.y < groundY(pos.x, pos.z);
              if (p.t > life || floor || Math.abs(pos.x) > size || Math.abs(pos.z) > size) { p.on = false; p.m.visible = false; sys.count--; if (floor && typeof o.onMiss === 'function') { try { o.onMiss(pos.clone(), p.data); } catch (x) { console.error(x); } } break; }
              for (let j = 0; j < targets.length; j++) {
                const t = targets[j], tm = t && (t.mesh || t); if (!tm || !tm.position || tm.visible === false || (t.alive === false)) continue;
                const hi = hitInfo(tm), s = tm.scale ? Math.max(tm.scale.x, tm.scale.y, tm.scale.z) : 1;
                if (Math.hypot(pos.x - tm.position.x, pos.y - (tm.position.y + hi.cy), pos.z - tm.position.z) < hi.r * s + radius) {
                  p.on = false; p.m.visible = false; sys.count--;
                  if (typeof o.onHit === 'function') { try { o.onHit(t, pos.clone(), p.data); } catch (x) { console.error(x); } }
                  break;
                }
              }
            }
          }
        },
        dispose() { pool.forEach(p => scene.remove(p.m)); geo.dispose(); const i = systems.indexOf(sys); if (i >= 0) systems.splice(i, 1); } };
      systems.push(sys); return sys;
    }

    // ── fx: instanced 3D burst + light flash ──
    const FX = { mesh: null, slots: [], active: 0, cap: 240 };
    function fxHit(point, o) {
      o = o || {};
      if (!FX.mesh) {
        FX.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: '#ffffff' }), FX.cap);
        FX.mesh.frustumCulled = false; FX.mesh.userData.noRay = true; FX.mesh.name = 'fx';
        M.makeScale(0, 0, 0); for (let i = 0; i < FX.cap; i++) { FX.mesh.setMatrixAt(i, M); FX.slots.push({ on: false, p: new THREE.Vector3(), v: new THREE.Vector3(), t: 0, life: 1, s: .1, c: new THREE.Color() }); }
        FX.mesh.instanceMatrix.needsUpdate = true; scene.add(FX.mesh);
      }
      const at = toV3(point, V), n = clamp(o.count == null ? 14 : o.count | 0, 1, 60), col = new THREE.Color(o.color || palette[5]), spread = +o.spread || 5;
      for (let k = 0, i = 0; k < n && i < FX.cap; i++) {
        const s = FX.slots[i]; if (s.on) continue;
        const a = rand() * 6.2832, e = rand() * 1.2, sp = spread * (.4 + rand() * .8);
        s.on = true; s.p.copy(at); s.v.set(Math.cos(a) * Math.cos(e) * sp, Math.sin(e) * sp + 1, Math.sin(a) * Math.cos(e) * sp);
        s.t = 0; s.life = (+o.life || .55) * (.7 + rand() * .6); s.s = (+o.size || .14) * (.6 + rand() * .8); s.c.copy(col).multiplyScalar(.8 + rand() * .4);
        FX.mesh.setColorAt(i, s.c); FX.active++; k++;
      }
      if (FX.mesh.instanceColor) FX.mesh.instanceColor.needsUpdate = true;
    }
    function fxUpdate(dt) {
      if (!FX.mesh || !FX.active) return;
      const g = 14;
      for (let i = 0; i < FX.cap; i++) {
        const s = FX.slots[i]; if (!s.on) continue;
        s.t += dt; s.v.y -= g * dt; s.p.addScaledVector(s.v, dt);
        const k = 1 - s.t / s.life;
        if (k <= 0 || s.p.y < groundY(s.p.x, s.p.z)) { s.on = false; FX.active--; M.makeScale(0, 0, 0); }
        else M.compose(s.p, Q.setFromAxisAngle(UP, s.t * 6), V2.set(s.s * k, s.s * k, s.s * k));
        FX.mesh.setMatrixAt(i, M);
      }
      FX.mesh.instanceMatrix.needsUpdate = true;
    }
    let flashTimer = 0;
    function flashLight(ms, mul) { hemi.intensity = P.hemi[2] * (+mul || 3); clearTimeout(flashTimer); flashTimer = setTimeout(() => { hemi.intensity = P.hemi[2]; }, +ms || 120); }

    // ── minimap: a 2D canvas of the whole world (props, enemies, markers, player) ──
    const uiRoot = () => document.getElementById('yk-root') || document.body || document.documentElement;
    function minimap(el, o) {
      o = o || {};
      const cv = el && el.tagName === 'CANVAS' ? el : document.createElement('canvas');
      if (cv !== el) {
        cv.width = cv.height = +o.px || 120;
        Object.assign(cv.style, { position: 'absolute', bottom: '2vh', width: '20vmin', height: '20vmin', borderRadius: '1rem', border: '2px solid rgba(255,255,255,.4)', zIndex: 2 });
        cv.style[o.side === 'left' || (!o.side && kit() && kit().rtl) ? 'left' : 'right'] = '2vw';
        (el && el.appendChild ? el : uiRoot()).appendChild(cv);
      }
      const ctx = cv.getContext('2d'), scale = +o.scale || cv.width / size, cx = cv.width / 2, cy = cv.height / 2;
      let frame = 0;
      const dot = (x, z, r, col) => { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(cx + x * scale, cy + z * scale, r, 0, 6.2832); ctx.fill(); };
      const mm = { el: cv, update() {
        if (!ctx || (frame++ & 1)) return;
        ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(0, 0, cv.width, cv.height);
        propSets.forEach(h => { if (h.soft) return; ctx.fillStyle = h.color; h.positions.forEach(p => ctx.fillRect(cx + p.x * scale - 1, cy + p.z * scale - 1, 2, 2)); });
        enemies.forEach(e => dot(e.pos.x, e.pos.z, 3, o.enemyColor || '#ff4d4d'));
        ((typeof o.markers === 'function' ? o.markers() : o.markers) || []).forEach(mk => { if (!mk) return; const p = mk.pos || mk; dot(+p.x || 0, +p.z || 0, +mk.r || 3, mk.color || '#ffd23f'); });
        const pc = player.current; if (!pc) return;
        const yaw = pc.kind === 'fps' ? pc.yaw : (pc.kind === 'avatar' ? pc.yaw : pc.target ? pc.target.rotation.y : 0) + Math.PI, px = cx + pc.pos.x * scale, pz = cy + pc.pos.z * scale;
        ctx.fillStyle = o.playerColor || '#ffffff'; ctx.beginPath();
        ctx.moveTo(px - Math.sin(yaw) * 6, pz - Math.cos(yaw) * 6); ctx.lineTo(px - Math.sin(yaw + 2.5) * 4, pz - Math.cos(yaw + 2.5) * 4); ctx.lineTo(px - Math.sin(yaw - 2.5) * 4, pz - Math.cos(yaw - 2.5) * 4); ctx.fill();
      }, remove() { cv.remove(); const i = minimaps.indexOf(mm); if (i >= 0) minimaps.splice(i, 1); } };
      minimaps.push(mm); return mm;
    }
    const minimaps = [];

    // ── objective strip (kid language: the game passes the text; direction from the kit) ──
    let objEl = null;
    function objective(text) {
      if (!objEl) {
        objEl = document.createElement('div'); objEl.id = 'yw-objective';
        Object.assign(objEl.style, { position: 'absolute', left: '50%', bottom: '4vh', transform: 'translateX(-50%)', background: 'rgba(0,0,0,.55)', color: '#fff', padding: '.7vh 2.4vw', borderRadius: '.9rem', font: '700 clamp(.9rem,2.4vw,1.3rem) system-ui,sans-serif', whiteSpace: 'nowrap', zIndex: 2, textShadow: '0 1px 3px #000', pointerEvents: 'none' });
        objEl.setAttribute('dir', kit() ? kit().dir : 'auto'); uiRoot().appendChild(objEl);
      }
      objEl.textContent = text == null ? '' : String(text); objEl.style.display = text ? '' : 'none';
      return objEl;
    }

    // ── raycast, update, render, resize, dispose ──
    const caster = new THREE.Raycaster();
    function raycast(from, dir, maxDist) {
      const f = from ? toV3(from, V) : (player.current && player.current.eye ? player.current.eye(V) : camera.getWorldPosition(V));
      const d = dir ? toV3(dir, V2) : (player.current && player.current.forward ? player.current.forward(V2) : camera.getWorldDirection(V2));
      if (d.lengthSq() < 1e-6) return null;
      caster.set(f, d.normalize()); caster.far = +maxDist || 200;
      const hits = caster.intersectObjects(scene.children.filter(o => !o.userData.noRay && o.visible), true);
      for (let i = 0; i < hits.length; i++) if (hits[i].object.visible && !hits[i].object.userData.noRay) { const h = hits[i]; return { point: h.point, distance: h.distance, object: h.object, instanceId: h.instanceId, normal: h.face ? h.face.normal : null }; }
      return null;
    }
    let started = false, disposed = false;
    function update(dt) {
      if (disposed) return;
      dt = clamp(+dt || 0, 0, .1); started = true;
      camera.getWorldPosition(V); sky.position.copy(V);
      if (player.current) player.current.update(dt);
      for (let i = enemies.length - 1; i >= 0; i--) enemies[i].update(dt);
      for (let i = 0; i < systems.length; i++) systems[i].update(dt);
      for (let i = 0; i < animated.length; i++) animated[i].update(dt);
      fxUpdate(dt);
      for (let i = 0; i < minimaps.length; i++) minimaps[i].update(dt);
    }
    function render() { if (!disposed) renderer.render(scene, camera); }
    function resize() {
      if (disposed) return;
      const w = window.innerWidth || 640, h = window.innerHeight || 360;
      renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
      if (!started) render();                       // the title screen shows the world behind it
    }
    function run() { const k = kit(); if (!k || !k.loop) { warn('run(): YuviKit missing — call YuviKit.init first'); return; } k.loop(dt => { update(dt); render(); }); }
    function dispose() {
      if (disposed) return; disposed = true;
      window.removeEventListener('resize', resize);
      scene.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material && !o.material.__shared) [].concat(o.material).forEach(m => m.dispose && m.dispose()); });
      renderer.dispose(); canvas.remove(); if (objEl) objEl.remove(); minimaps.slice().forEach(m => m.remove());
      player.current = null; enemies.length = 0; systems.length = 0; propSets.length = 0; animated.length = 0; lights.length = 0;
    }
    window.addEventListener('resize', resize);
    requestAnimationFrame(() => { if (!started) { for (let i = 0; i < animated.length; i++) animated[i].update(0); render(); } });   // first frame after the game's synchronous setup

    const W = {
      scene: scene, camera: camera, renderer: renderer, ground: ground, water: water, sky: sky, sun: sun, hemi: hemi, fill: fill, lights: lights, palette: palette, size: size, preset: P, biome: P, terrain: T,
      add: o => { if (o && o.isObject3D) scene.add(o); else warn('add(obj): not an Object3D'); return o; },
      remove: o => { if (o && o.isObject3D) scene.remove(o); return o; },
      update: update, render: render, run: run, resize: resize, dispose: dispose, raycast: raycast, rand: rand, groundY: groundY, decorate: decorate,
      props: { scatter: scatter, place: place, make: make, character: character, actor: o => character(Object.assign({ kind: 'human', role: 'villager' }, o || {})), get kinds() { return Object.keys(KINDS); }, get variants() { const v = {}; for (const k in KINDS) if (KINDS[k].variants) v[k] = Object.keys(KINDS[k].variants); return v; }, roles: Object.keys(ROLES), animals: Object.keys(ANIMALS), sets: propSets,
        define: (name, def) => { if (!name || !def || !Array.isArray(def.parts)) { warn('props.define(name, {r, jit, parts[, variants, light, soft, float]}) — parts required'); return; } KINDS[name] = Object.assign({ r: .6, jit: [1, 1] }, def); } },
      player: player, enemy: enemy, enemies: enemies, projectiles: projectiles,
      fx: { hit: fxHit, flashLight: flashLight }, minimap: minimap, objective: objective,
      get stats() { const r = renderer.info.render; return { objects: scene.children.length, drawCalls: r.calls, triangles: r.triangles, enemies: enemies.length, props: propSets.reduce((n, h) => n + h.positions.length, 0), fx: FX.active, lights: lights.length }; }
    };
    // ── plugins: the other world3d files (materials, props, atmosphere) and the fps module extend W here ──
    Object.assign(ctx, { W: W, THREE: THREE, scene: scene, camera: camera, renderer: renderer, opts: opts, P: P, dark: dark, size: size, half: half, K: K, palette: palette, rand: rand, seedNum: seedNum, mulberry32: mulberry32,
      KINDS: KINDS, ROLES: ROLES, SKIN: SKIN, HAIRC: HAIRC, ANIMALS: ANIMALS, PRESETS: PRESETS, GEO: GEO, partGeo: partGeo, matFor: matFor, textures: textures, roleHex: roleHex, partColor: partColor, unlitFor: unlitFor,
      hemi: hemi, sun: sun, fill: fill, lights: lights, LIGHT_CAP: LIGHT_CAP, animated: animated, propSets: propSets, enemies: enemies, player: player, groundY: groundY, collide: collide, toV3: toV3, clamp: clamp, kit: kit, warn: warn, shadows: shadows, water: water, fogColor: fogColor, V: V, V2: V2, M: M, Q: Q, C: C, UP: UP });
    for (let i = 0; i < PLUGINS.length; i++) { try { PLUGINS[i](W, THREE, ctx); } catch (e) { warn('plugin ' + (PLUGINS[i].name || i) + ' failed: ' + (e && e.message)); console.error(e); } }
    return W;
  }

  const PLUGINS = [];
  window.YuviWorld3D = { world: world, presets: Object.keys(PRESETS), biomes: Object.keys(PRESETS), get kinds() { return Object.keys(KINDS); }, roles: Object.keys(ROLES), animals: Object.keys(ANIMALS), seed: s => mulberry32(seedNum(s)),
    // `YuviWorld3D.use((W, THREE, ctx) => { … })` — called for every world created after registration; ctx exposes the internals (KINDS, matFor, textures, lights, …).
    use: fn => { if (typeof fn === 'function') PLUGINS.push(fn); }, plugins: PLUGINS };
})();
