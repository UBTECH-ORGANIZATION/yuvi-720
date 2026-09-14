/*
 * yuvi_world3d.js — YuviWorld3D, the opt-in 3D runtime for games that need a
 * real place: a lit low-poly world from a preset, instanced props, an FPS /
 * third-person controller wired to YuviKit.input, patrol-chase enemies, pooled
 * ballistic projectiles, 3D hit bursts, a minimap and an objective strip.
 *
 *   const W = YuviWorld3D.world(THREE, {preset, seed, size, palette, fog, shadows, el})
 *   W.props.scatter(kind, count, {area, seed, scale, avoid}) / W.props.make(kind, {scale, color})
 *   W.player.fps({...}) / W.player.thirdPerson(mesh, {distance, height, lag})
 *   W.enemy(mesh, {...}) / W.projectiles({...}) / W.fx.hit(point, {...}) / W.fx.flashLight(ms)
 *   W.minimap(el, {scale, markers}) / W.objective(text) / W.raycast(from, dir, maxDist)
 *   W.update(dt) / W.render() / W.run() / W.resize() / W.dispose() / W.rand() / W.stats
 *
 * Classic script, injected right after yuvi_kit.js. The game imports Three.js
 * (module build, allow-listed URL) and passes the module in: this file never
 * imports, fetches or loads assets. Every call is safe once and never throws
 * on missing arguments (console.warn + a stub). Materials are Lambert, props
 * are InstancedMesh, there is one directional light and no post-processing:
 * the checker renders WebGL in software at 640×360.
 */
(function () {
  if (window.YuviWorld3D) return;
  const warn = m => { try { console.warn('[YuviWorld3D] ' + m); } catch (e) {} };
  const kit = () => window.YuviKit || null;
  const noop = () => {};
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

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

  // ── presets (data): sky [bottom, top], fog [color, nearFrac, farFrac], hemi [sky, ground, intensity],
  //    sun [color, intensity, position], ground [colorA, colorB, bump], palette roles:
  //    0 ground · 1 stone/wall · 2 foliage/accent · 3 light · 4 dark/wood · 5 highlight ──
  const PRESETS = {
    desert: { sky: ['#f4d4a0', '#5fb0e8'], fog: ['#f1d3a4', .3, 1.1], hemi: ['#ffe8c0', '#b0824a', 1.7], sun: ['#fff1d6', 2.6, [60, 80, 30]], ground: ['#dcb56d', '#c79a52', .25], palette: ['#dcb56d', '#c79a52', '#6f9a4a', '#f7ead0', '#5a3d22', '#ff7a45'] },
    forest: { sky: ['#c5e6ff', '#3f8fd6'], fog: ['#bcd9c8', .22, .95], hemi: ['#dff3ff', '#3f6b2a', 1.6], sun: ['#fff6df', 2.4, [40, 70, 40]], ground: ['#4f8f3b', '#3b7230', .35], palette: ['#4f8f3b', '#8b8f82', '#2f7a34', '#e9f3d8', '#4a3220', '#ffb347'] },
    space:  { sky: ['#0d1230', '#05060f'], fog: ['#0b0e20', .3, 1.2], hemi: ['#8a98ff', '#1a1030', 1.4], sun: ['#dfe6ff', 2.2, [-50, 60, -30]], ground: ['#3b3f52', '#2a2d3e', .5], palette: ['#3b3f52', '#5a607a', '#7ff2ff', '#e8ecff', '#151726', '#ff5ea8'], stars: true },
    lab:    { sky: ['#e6eef5', '#9fb8cc'], fog: ['#dbe6ee', .25, 1], hemi: ['#ffffff', '#8fa3b3', 1.9], sun: ['#ffffff', 2.2, [30, 80, 50]], ground: ['#c9d3dc', '#b4c0cb', .05], palette: ['#c9d3dc', '#8fa1b0', '#31c9a8', '#ffffff', '#2f3a48', '#ff6b6b'], grid: true },
    ocean:  { sky: ['#bfefff', '#2b8fd8'], fog: ['#a9def2', .3, 1.1], hemi: ['#e8fbff', '#1d6f8a', 1.7], sun: ['#fff8e6', 2.5, [50, 70, -40]], ground: ['#2a9ac8', '#1f7fae', .45], palette: ['#2a9ac8', '#f2dfa8', '#4bc27d', '#ffffff', '#12405a', '#ff8c5a'] },
    city:   { sky: ['#dfe7ee', '#6fa2d6'], fog: ['#cfd8e0', .25, 1], hemi: ['#f0f4ff', '#6c6f75', 1.6], sun: ['#fff3e0', 2.3, [-40, 70, 50]], ground: ['#6d7278', '#5f6469', .05], palette: ['#6d7278', '#a8adb5', '#4aa3ff', '#f2f4f7', '#2b2f36', '#ffd23f'], grid: true },
    night:  { sky: ['#182452', '#0b1030'], fog: ['#0f1738', .2, .9], hemi: ['#6a7cff', '#0d1226', 1.5], sun: ['#c8d4ff', 1.7, [-40, 60, 20]], ground: ['#26304a', '#1d2538', .35], palette: ['#26304a', '#3a4666', '#7cf0c8', '#dfe6ff', '#0c0f1c', '#ffd166'], stars: true }
  };

  // ── prop kinds (data): parts of primitives; g geometry, a args, p centre, s scale, rz roll,
  //    c palette role, e unlit (glows); r collision radius; jit per-instance scale range ──
  const R90 = Math.PI / 2;
  const KINDS = {
    tree:     { r: .7, jit: [.8, 1.4], parts: [{ g: 'cyl', a: [.16, .24, 1.4, 6], p: [0, .7, 0], c: 4 }, { g: 'cone', a: [1.1, 2.4, 7], p: [0, 2.4, 0], c: 2 }] },
    bush:     { r: .7, jit: [.7, 1.3], parts: [{ g: 'sphere', a: [.8, 6, 5], s: [1, .65, 1], p: [0, .45, 0], c: 2 }] },
    rock:     { r: .8, jit: [.5, 1.6], parts: [{ g: 'dodeca', a: [.8, 0], s: [1.1, .65, 1], p: [0, .4, 0], c: 1 }] },
    crate:    { r: .7, jit: [.8, 1.2], parts: [{ g: 'box', a: [1, 1, 1], p: [0, .5, 0], c: 5 }] },
    barrel:   { r: .5, jit: [.9, 1.1], parts: [{ g: 'cyl', a: [.45, .45, 1.1, 10], p: [0, .55, 0], c: 5 }, { g: 'cyl', a: [.48, .48, .12, 10], p: [0, .55, 0], c: 4 }] },
    building: { r: 2.7, jit: [.7, 1.8], parts: [{ g: 'box', a: [4, 8, 4], p: [0, 4, 0], c: 1 }, { g: 'box', a: [3, 1, 3], p: [0, 8.5, 0], c: 4 }] },
    cactus:   { r: .4, jit: [.8, 1.4], parts: [{ g: 'cyl', a: [.22, .28, 2.2, 6], p: [0, 1.1, 0], c: 2 }, { g: 'cyl', a: [.13, .13, .8, 5], rz: R90, p: [.5, 1.3, 0], c: 2 }, { g: 'cyl', a: [.13, .13, .8, 5], p: [.85, 1.7, 0], c: 2 }] },
    pipe:     { r: .6, jit: [.8, 1.2], parts: [{ g: 'cyl', a: [.4, .4, 4, 8], rz: R90, p: [0, .4, 0], c: 3 }, { g: 'cyl', a: [.5, .5, .3, 8], rz: R90, p: [1.6, .4, 0], c: 4 }] },
    barrier:  { r: .8, jit: [1, 1], parts: [{ g: 'box', a: [1.6, .9, .5], p: [0, .45, 0], c: 5 }] },
    lamp:     { r: .25, jit: [1, 1], parts: [{ g: 'cyl', a: [.07, .1, 3.2, 5], p: [0, 1.6, 0], c: 4 }, { g: 'sphere', a: [.28, 6, 5], p: [0, 3.3, 0], c: 3, e: true }] },
    fence:    { r: 1.2, jit: [1, 1], parts: [{ g: 'box', a: [2.4, .12, .1], p: [0, .5, 0], c: 4 }, { g: 'box', a: [2.4, .12, .1], p: [0, .9, 0], c: 4 }, { g: 'box', a: [.14, 1.1, .14], p: [-1.1, .55, 0], c: 4 }, { g: 'box', a: [.14, 1.1, .14], p: [1.1, .55, 0], c: 4 }] },
    crystal:  { r: .5, jit: [.6, 1.5], parts: [{ g: 'octa', a: [.6, 0], s: [1, 1.9, 1], p: [0, 1, 0], c: 5, e: true }] },
    actor:    { r: .5, jit: [1, 1], parts: [{ g: 'cyl', a: [.35, .45, 1.2, 8], p: [0, .6, 0], c: 5 }, { g: 'sphere', a: [.32, 8, 6], p: [0, 1.5, 0], c: 3 }] }
  };

  // ── stub: what every entry point returns when it cannot work ────────────
  function stub() {
    const h = { positions: [], meshes: [], remove: noop };
    const c = { object: null, camera: null, pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, obstacles: [], onGround: true, update: noop, lookAt: noop, enable: noop, requestLook: noop, collide: noop };
    return { scene: null, camera: null, renderer: null, ground: null, palette: [], size: 0, stats: {},
      add: noop, remove: noop, update: noop, render: noop, run: noop, resize: noop, dispose: noop, raycast: () => null, rand: Math.random,
      props: { scatter: () => h, make: () => null, kinds: Object.keys(KINDS), sets: [] }, player: { fps: () => c, thirdPerson: () => c, current: null },
      enemy: () => ({ state: 'dead', update: noop, kill: noop, pos: { x: 0, y: 0, z: 0 } }), enemies: [],
      projectiles: () => ({ fire: noop, update: noop, count: 0 }), fx: { hit: noop, flashLight: noop },
      minimap: () => ({ update: noop, remove: noop }), objective: noop };
  }

  function world(THREE, opts) {
    THREE = THREE || window.THREE; opts = opts || {};
    if (!THREE || !THREE.Scene || !THREE.WebGLRenderer) { warn('world(THREE, opts): pass the Three.js module (import * as THREE from the allow-listed URL)'); return stub(); }
    const P = PRESETS[opts.preset] || (opts.preset && warn('unknown preset "' + opts.preset + '" — using forest'), PRESETS.forest);
    const size = +opts.size > 0 ? +opts.size : 120, half = size / 2;
    const rand = mulberry32(seedNum(opts.seed == null ? 7 : opts.seed));
    const palette = (Array.isArray(opts.palette) && opts.palette.length >= 3 ? opts.palette : P.palette).map(String);
    const shadows = !!opts.shadows;
    const V = new THREE.Vector3(), V2 = new THREE.Vector3(), M = new THREE.Matrix4(), Q = new THREE.Quaternion(), C = new THREE.Color(), UP = new THREE.Vector3(0, 1, 0);
    const toV3 = (v, out) => { out = out || new THREE.Vector3(); if (!v) return out.set(0, 0, 0); if (Array.isArray(v)) return out.set(+v[0] || 0, +v[1] || 0, +v[2] || 0); if (v.isVector3) return out.copy(v); if (v.position) return out.copy(v.position); return out.set(+v.x || 0, +v.y || 0, +v.z || 0); };

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
    if (opts.fog !== false) scene.fog = new THREE.Fog(fogColor, size * (opts.fog && opts.fog.near != null ? opts.fog.near / size : P.fog[1]), size * (opts.fog && opts.fog.far != null ? opts.fog.far / size : P.fog[2]));
    const camera = new THREE.PerspectiveCamera(70, (window.innerWidth || 640) / (window.innerHeight || 360), .1, Math.max(400, size * 2.4));
    camera.position.set(0, 2.2, half * .35); camera.lookAt(0, 1, 0);
    const hemi = new THREE.HemisphereLight(P.hemi[0], P.hemi[1], P.hemi[2]); scene.add(hemi);
    const sun = new THREE.DirectionalLight(P.sun[0], P.sun[1]); sun.position.set(P.sun[2][0], P.sun[2][1], P.sun[2][2]); scene.add(sun);
    if (shadows) {
      sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024);
      const sc = sun.shadow.camera; sc.left = sc.bottom = -half; sc.right = sc.top = half; sc.near = 1; sc.far = size * 3;
    }

    // ── sky: inverted vertex-coloured sphere that follows the camera (+ stars) ──
    const skyR = size * 1.7, skyGeo = new THREE.SphereGeometry(skyR, 16, 10), sp = skyGeo.attributes.position;
    const skyCol = new Float32Array(sp.count * 3), cBot = new THREE.Color(P.sky[0]), cTop = new THREE.Color(P.sky[1]);
    for (let i = 0; i < sp.count; i++) { C.copy(cBot).lerp(cTop, Math.pow(clamp(sp.getY(i) / skyR, 0, 1), .55)); C.toArray(skyCol, i * 3); }
    skyGeo.setAttribute('color', new THREE.BufferAttribute(skyCol, 3));
    const sky = new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
    sky.name = 'sky'; sky.frustumCulled = false; sky.userData.noRay = true; scene.add(sky);
    if (P.stars) {
      const n = 500, arr = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { const a = rand() * 6.2832, e = .08 + rand() * 1.4, r = skyR * .95; arr[i * 3] = Math.cos(a) * Math.cos(e) * r; arr[i * 3 + 1] = Math.sin(e) * r; arr[i * 3 + 2] = Math.sin(a) * Math.cos(e) * r; }
      const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(arr, 3));
      const stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: '#ffffff', size: 2, sizeAttenuation: false, fog: false }));
      stars.name = 'stars'; stars.frustumCulled = false; stars.userData.noRay = true; sky.add(stars);
    }

    // ── ground: gently rolling, flat around the spawn, two-tone vertex colours ──
    const seg = 40, gg = new THREE.PlaneGeometry(size, size, seg, seg); gg.rotateX(-Math.PI / 2);
    const gp = gg.attributes.position, gc = new Float32Array(gp.count * 3), gA = new THREE.Color(P.ground[0]), gB = new THREE.Color(P.ground[1]);
    const bump = P.ground[2], s1 = rand() * 6, s2 = rand() * 6;
    for (let i = 0; i < gp.count; i++) {
      const x = gp.getX(i), z = gp.getZ(i), d = Math.hypot(x, z), flat = clamp((d - 6) / 10, 0, 1);
      const h = Math.sin(x * .21 + s1) * Math.cos(z * .17 + s2);
      gp.setY(i, h * bump * flat * (1 - (rand() * .3)));
      C.copy(gA).lerp(gB, clamp((h + 1) / 2 * .8 + rand() * .3, 0, 1)); C.toArray(gc, i * 3);
    }
    gg.setAttribute('color', new THREE.BufferAttribute(gc, 3)); gg.computeVertexNormals();
    const ground = new THREE.Mesh(gg, new THREE.MeshLambertMaterial({ vertexColors: true }));
    ground.name = 'ground'; ground.receiveShadow = shadows; scene.add(ground);
    if (P.grid) { const grid = new THREE.GridHelper(size, Math.round(size / 4), palette[1], palette[1]); grid.position.y = .03; grid.material.transparent = true; grid.material.opacity = .35; grid.userData.noRay = true; scene.add(grid); }

    // ── materials + part geometry ──
    const mats = {};
    const matFor = (hex, unlit) => { const k = (unlit ? 'u' : 'l') + hex; return mats[k] || (mats[k] = unlit ? new THREE.MeshBasicMaterial({ color: hex }) : new THREE.MeshLambertMaterial({ color: hex, flatShading: true })); };
    const GEO = { box: a => new THREE.BoxGeometry(a[0], a[1], a[2]), cyl: a => new THREE.CylinderGeometry(a[0], a[1], a[2], a[3]), cone: a => new THREE.ConeGeometry(a[0], a[1], a[2]),
      sphere: a => new THREE.SphereGeometry(a[0], a[1], a[2]), dodeca: a => new THREE.DodecahedronGeometry(a[0], a[1]), octa: a => new THREE.OctahedronGeometry(a[0], a[1]) };
    function partGeo(p) { const g = GEO[p.g](p.a); if (p.rz) g.rotateZ(p.rz); if (p.s) g.scale(p.s[0], p.s[1], p.s[2]); g.translate(p.p[0], p.p[1], p.p[2]); return g; }
    const partColor = (p, o) => (o && o.colors && o.colors[p.c]) || (o && o.color && p.c === 5 ? o.color : null) || palette[p.c] || palette[0];

    // ── props: instanced scatter + single make ──
    const propSets = [];
    const areaOf = a => {
      if (typeof a === 'number') return { x: 0, z: 0, hw: a, hd: a };
      if (Array.isArray(a)) return { x: +a[0] || 0, z: +a[1] || 0, hw: +a[2] || half - 2, hd: +a[3] || +a[2] || half - 2 };
      if (a && typeof a === 'object') return { x: +a.x || 0, z: +a.z || 0, hw: +(a.hw != null ? a.hw : a.w / 2) || half - 2, hd: +(a.hd != null ? a.hd : (a.d || a.h) / 2) || +(a.hw != null ? a.hw : a.w / 2) || half - 2 };
      return { x: 0, z: 0, hw: half - 2, hd: half - 2 };
    };
    function scatter(kind, count, o) {
      const K = KINDS[kind]; o = o || {};
      if (!K) { warn('props.scatter: unknown kind "' + kind + '" — kinds: ' + Object.keys(KINDS).join(', ')); return { kind: kind, positions: [], meshes: [], remove: noop }; }
      count = count == null ? 30 : clamp(count | 0, 0, 600);
      const rnd = o.seed == null ? rand : mulberry32(seedNum(o.seed)), area = areaOf(o.area), base = +o.scale || 1;
      const avoid = [{ x: 0, z: 0, r: 5 }].concat((o.avoid || []).map(a => ({ x: +(a.x != null ? a.x : a[0]) || 0, z: +(a.z != null ? a.z : (a.length > 2 ? a[2] : a[1])) || 0, r: +a.r || (a.length > 3 ? +a[3] : 0) || 3 })));
      const positions = [];
      for (let tries = count * 10; positions.length < count && tries > 0; tries--) {
        const x = area.x + (rnd() * 2 - 1) * area.hw, z = area.z + (rnd() * 2 - 1) * area.hd;
        const s = base * (K.jit[0] + rnd() * (K.jit[1] - K.jit[0])), r = K.r * s;
        if (avoid.some(a => Math.hypot(a.x - x, a.z - z) < a.r + r)) continue;
        if (positions.some(p => Math.hypot(p.x - x, p.z - z) < (p.r + r) * .9)) continue;
        positions.push({ x: x, y: 0, z: z, r: r, s: s, rot: rnd() * 6.2832, tint: .85 + rnd() * .3 });
      }
      const meshes = K.parts.map(p => {
        const m = new THREE.InstancedMesh(partGeo(p), matFor(partColor(p, o), p.e), positions.length);
        positions.forEach((q, i) => {
          M.compose(V.set(q.x, 0, q.z), Q.setFromAxisAngle(UP, q.rot), V2.set(q.s, q.s, q.s)); m.setMatrixAt(i, M);
          C.set(partColor(p, o)).multiplyScalar(q.tint); m.setColorAt(i, C);
        });
        m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true;
        m.castShadow = shadows && !p.e; m.receiveShadow = shadows; m.name = 'prop:' + kind; scene.add(m); return m;
      });
      const h = { kind: kind, positions: positions, meshes: meshes, color: partColor(K.parts[K.parts.length - 1], o),
        remove() { meshes.forEach(m => { scene.remove(m); m.geometry.dispose(); m.dispose(); }); const i = propSets.indexOf(h); if (i >= 0) propSets.splice(i, 1); } };
      propSets.push(h); return h;
    }
    function make(kind, o) {
      const K = KINDS[kind]; o = o || {};
      if (!K) { warn('props.make: unknown kind "' + kind + '"'); return new THREE.Group(); }
      const g = new THREE.Group(); g.name = kind;
      K.parts.forEach(p => { const m = new THREE.Mesh(partGeo(p), matFor(partColor(p, o), p.e)); m.castShadow = shadows && !p.e; g.add(m); });
      const s = +o.scale || 1; g.scale.set(s, s, s); g.userData.radius = K.r * s;
      if (o.pos) toV3(o.pos, g.position);
      if (o.add !== false) scene.add(g);
      return g;
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
    const addObstacles = (list, src) => { (Array.isArray(src) ? src : (src && src.positions) || []).forEach(p => list.push(p)); return list; };

    // ── player: first-person controller on the camera rig ──
    const player = { current: null, fps: fps, thirdPerson: thirdPerson };
    function fps(o) {
      o = o || {};
      if (player.current && player.current.kind === 'fps') { warn('player.fps already created — returning it'); return player.current; }
      const rig = new THREE.Group(), speed = +o.speed || 6, jumpV = +o.jump || 7, h = +o.height || 1.7, grav = +o.gravity || 22;
      const sprintMul = o.sprint === false ? 1 : (typeof o.sprint === 'number' ? o.sprint : 1.6), bobA = o.bob === false ? 0 : (typeof o.bob === 'number' ? o.bob : .05);
      if (camera.parent) camera.parent.remove(camera);
      camera.position.set(0, h, 0); camera.rotation.set(0, 0, 0); rig.add(camera); scene.add(rig);
      toV3(o.pos || [0, 0, 6], rig.position); rig.position.y = 0;
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
        if (rig.position.y <= 0) { rig.position.y = 0; c.vel.y = 0; c.onGround = true; }
        rig.position.x = clamp(rig.position.x, bounds.minX, bounds.maxX); rig.position.z = clamp(rig.position.z, bounds.minZ, bounds.maxZ);
        collide(rig.position, c.radius, c.obstacles);
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
      c.forward = out => (out || new THREE.Vector3()).set(-Math.sin(c.yaw) * Math.cos(c.pitch), Math.sin(c.pitch), -Math.cos(c.yaw) * Math.cos(c.pitch));
      c.eye = out => camera.getWorldPosition(out || new THREE.Vector3());
      player.current = c; return c;
    }
    function thirdPerson(target, o) {
      o = o || {};
      if (!target || !target.position) { warn('player.thirdPerson(mesh, opts): mesh required'); return stub().player.thirdPerson(); }
      if (camera.parent) camera.parent.remove(camera);
      camera.rotation.set(0, 0, 0); scene.add(camera);
      const dist = +o.distance || 7, height = +o.height || 3.5, lag = +o.lag || .12, look = new THREE.Vector3();
      const c = { kind: 'third', object: camera, camera: camera, target: target, pos: target.position, vel: new THREE.Vector3(), onGround: true, enabled: true, obstacles: [], update: noop, lookAt: noop, requestLook: noop, collide: src => { addObstacles(c.obstacles, src); return c; } };
      let first = true;
      c.update = dt => {
        if (!c.enabled) return;
        V.set(-Math.sin(target.rotation.y) * -dist, height, -Math.cos(target.rotation.y) * -dist).add(target.position);
        if (first) { camera.position.copy(V); first = false; } else camera.position.lerp(V, 1 - Math.exp(-dt / lag));
        look.copy(target.position); look.y += height * .35; camera.lookAt(look);
      };
      c.enable = b => { c.enabled = b !== false; };
      player.current = c; return c;
    }

    // ── enemies: patrol → detect → chase → cover / search FSM on the ground plane ──
    const enemies = [];
    function enemy(mesh, o) {
      o = o || {};
      if (!mesh || !mesh.position) { warn('enemy(mesh, opts): mesh required'); return stub().enemy(); }
      if (!mesh.parent) scene.add(mesh);
      const wps = (o.waypoints || []).map(w => toV3(w)), speed = +o.speed || 3, sight = +o.sightRange || 14, fov = (+o.fov || 120) * Math.PI / 180;
      const cover = (o.cover || []).map(w => toV3(w));
      const e = { mesh: mesh, pos: mesh.position, state: 'patrol', alive: true, wp: 0, lost: 0, timer: 0, wait: 0, last: new THREE.Vector3(), sees: false };
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
        const st = Math.min(d, sp * dt); e.pos.x += dx / d * st; e.pos.z += dz / d * st; mesh.rotation.y = Math.atan2(dx, dz); return d - st < .3;
      };
      const set = s => { if (e.state !== s) { e.state = s; e.timer = 0; e.wait = 0; } };
      const nearestCover = () => { let best = null, bd = Infinity; cover.forEach(cv => { const d = Math.hypot(cv.x - e.pos.x, cv.z - e.pos.z); if (d < bd) { bd = d; best = cv; } }); return best; };
      e.update = dt => {
        if (!e.alive) return;
        e.timer += dt;
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
      };
      e.setState = set;
      e.takeCover = () => { if (cover.length) set('cover'); };
      e.kill = () => { if (!e.alive) return; e.alive = false; e.state = 'dead'; scene.remove(mesh); const i = enemies.indexOf(e); if (i >= 0) enemies.splice(i, 1); };
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
            p.v.y -= grav * dt; p.m.position.addScaledVector(p.v, dt); p.t += dt;
            const pos = p.m.position;
            if (p.t > life || pos.y < 0 || Math.abs(pos.x) > size || Math.abs(pos.z) > size) { p.on = false; p.m.visible = false; sys.count--; if (pos.y < 0 && typeof o.onMiss === 'function') { try { o.onMiss(pos.clone(), p.data); } catch (x) { console.error(x); } } continue; }
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
        if (k <= 0 || s.p.y < 0) { s.on = false; FX.active--; M.makeScale(0, 0, 0); }
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
        propSets.forEach(h => { ctx.fillStyle = h.color; h.positions.forEach(p => ctx.fillRect(cx + p.x * scale - 1, cy + p.z * scale - 1, 2, 2)); });
        enemies.forEach(e => dot(e.pos.x, e.pos.z, 3, o.enemyColor || '#ff4d4d'));
        ((typeof o.markers === 'function' ? o.markers() : o.markers) || []).forEach(mk => { if (!mk) return; const p = mk.pos || mk; dot(+p.x || 0, +p.z || 0, +mk.r || 3, mk.color || '#ffd23f'); });
        const pc = player.current; if (!pc) return;
        const yaw = pc.kind === 'fps' ? pc.yaw : (pc.target ? pc.target.rotation.y + Math.PI : 0), px = cx + pc.pos.x * scale, pz = cy + pc.pos.z * scale;
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
      player.current = null; enemies.length = 0; systems.length = 0; propSets.length = 0;
    }
    window.addEventListener('resize', resize);
    requestAnimationFrame(() => { if (!started) render(); });   // first frame after the game's synchronous setup

    const W = {
      scene: scene, camera: camera, renderer: renderer, ground: ground, sky: sky, sun: sun, hemi: hemi, palette: palette, size: size, preset: P,
      add: o => { if (o && o.isObject3D) scene.add(o); else warn('add(obj): not an Object3D'); return o; },
      remove: o => { if (o && o.isObject3D) scene.remove(o); return o; },
      update: update, render: render, run: run, resize: resize, dispose: dispose, raycast: raycast, rand: rand,
      props: { scatter: scatter, make: make, kinds: Object.keys(KINDS), sets: propSets },
      player: player, enemy: enemy, enemies: enemies, projectiles: projectiles,
      fx: { hit: fxHit, flashLight: flashLight }, minimap: minimap, objective: objective,
      get stats() { const r = renderer.info.render; return { objects: scene.children.length, drawCalls: r.calls, triangles: r.triangles, enemies: enemies.length, props: propSets.reduce((n, h) => n + h.positions.length, 0), fx: FX.active }; }
    };
    return W;
  }

  window.YuviWorld3D = { world: world, presets: Object.keys(PRESETS), kinds: Object.keys(KINDS), seed: s => mulberry32(seedNum(s)) };
})();
