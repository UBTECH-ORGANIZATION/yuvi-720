/*
 * yuvi_world3d_atmo.js — lighting, weather & atmosphere plugin for YuviWorld3D.
 *
 *   W.lighting.apply(preset, o) → {name, lights, remove()}   presets: noon goldenHour overcast dusk night nightIndustrial
 *                                                              moonlitRain neonCity alarm cinematicFog underground space
 *   W.lighting.timeOfDay(t 0..24) / .flood(pos, o) / .lamp(pos, o) / .emissive(mesh, color, intensity) / .godRays(dir, o)
 *   W.lighting.readability() → {ok, meanLum, spread, hint}
 *   W.weather.set(kind, o) → {kind, update, remove}          kinds: rain storm snow fog dust embers fireflies ash sandstorm none
 *   W.atmo.puddles(n, o) / .wind(o) / .smoke(pos, o) / .steam(pos, o) / .sparks(pos, o) / .lightShaft(pos, dir, o) / .skyline(o) / .vignette(strength)
 *
 * Classic script injected after the props plugin. Everything is procedural (no assets), deterministic through ctx.rand,
 * registers its animation in ctx.animated, respects ctx.LIGHT_CAP (fakes a light with emissive/additive meshes when the
 * cap is hit) and never throws: bad arguments warn and return a stub. The rule it exists for: never black on black —
 * a night scene keeps a cool moon key, a blue fill, warm lamps and a fog floor so the kid can see where to go.
 */
(function () {
  if (!window.YuviWorld3D || typeof window.YuviWorld3D.use !== 'function') { try { console.warn('[YuviWorld3D:atmo] core missing — plugin skipped'); } catch (e) {} return; }
  window.YuviWorld3D.use(function atmo(W, THREE, ctx) {
    const scene = ctx.scene, camera = ctx.camera, renderer = ctx.renderer, hemi = ctx.hemi, sun = ctx.sun, fill = ctx.fill, lights = ctx.lights, CAP = ctx.LIGHT_CAP || 10;
    const animated = ctx.animated, propSets = ctx.propSets, rand = ctx.rand, warn = m => ctx.warn('atmo: ' + m), size = ctx.size, half = ctx.half, K = ctx.K || 1, clamp = ctx.clamp, toV3 = ctx.toV3, groundY = ctx.groundY, sky = W.sky;
    const V = new THREE.Vector3(), V2 = new THREE.Vector3(), C = new THREE.Color(), C2 = new THREE.Color(), M = new THREE.Matrix4(), Q = new THREE.Quaternion(), DOWN = new THREE.Vector3(0, -1, 0);
    const noop = () => {};
    const rnd = (a, b) => a + rand() * (b - a);

    // ── software GL → half the particle counts, no shadow from floods ──
    let SW = false;
    try { const gl = renderer.getContext(), dbg = gl.getExtension('WEBGL_debug_renderer_info'); const r = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); SW = /swiftshader|llvmpipe|software|mesa offscreen/i.test(String(r || '')); } catch (e) {}
    const QF = SW ? .5 : 1;

    // ── shared clock + textures ──
    const uTime = { value: 0 };
    animated.push({ update(dt) { uTime.value += dt; } });
    const texCache = {};
    const softTex = (name, draw) => {
      if (texCache[name]) return texCache[name];
      const cv = document.createElement('canvas'); cv.width = cv.height = 64; const g = cv.getContext('2d'); draw(g, 64);
      const t = new THREE.CanvasTexture(cv); if (THREE.SRGBColorSpace) t.colorSpace = THREE.SRGBColorSpace; return (texCache[name] = t);
    };
    const radial = (stops) => (g, s) => { const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2); stops.forEach(st => gr.addColorStop(st[0], st[1])); g.fillStyle = gr; g.fillRect(0, 0, s, s); };
    const TEX = {
      glow: () => softTex('glow', radial([[0, 'rgba(255,255,255,1)'], [.35, 'rgba(255,255,255,.5)'], [1, 'rgba(255,255,255,0)']])),
      puff: () => softTex('puff', radial([[0, 'rgba(255,255,255,.9)'], [.5, 'rgba(255,255,255,.35)'], [1, 'rgba(255,255,255,0)']])),
      flake: () => softTex('flake', radial([[0, 'rgba(255,255,255,1)'], [.6, 'rgba(255,255,255,.8)'], [1, 'rgba(255,255,255,0)']])),
      streak: () => softTex('streak', (g, s) => { const gr = g.createLinearGradient(0, 0, s, 0); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(.5, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, s, s); const gv = g.createLinearGradient(0, 0, 0, s); gv.addColorStop(0, 'rgba(0,0,0,0)'); gv.addColorStop(.15, 'rgba(0,0,0,1)'); gv.addColorStop(1, 'rgba(0,0,0,1)'); g.globalCompositeOperation = 'destination-in'; g.fillStyle = gv; g.fillRect(0, 0, s, s); })
    };
    const fogUniforms = () => THREE.UniformsUtils.clone(THREE.UniformsLib.fog);
    const mark = o => { o.userData.noRay = true; o.frustumCulled = false; return o; };
    const dispose = o => { if (!o) return; scene.remove(o); o.traverse && o.traverse(x => { if (x.geometry) x.geometry.dispose(); if (x.material && !x.material.__shared) [].concat(x.material).forEach(m => m.dispose && m.dispose()); }); };
    const unanimate = a => { const i = animated.indexOf(a); if (i >= 0) animated.splice(i, 1); };
    const unlight = l => { scene.remove(l); if (l.target) scene.remove(l.target); const i = lights.indexOf(l); if (i >= 0) lights.splice(i, 1); };

    // ── the lighting truth: what the scene is tuned to right now (weather derives from it, flashes restore to it) ──
    const base = { hemi: hemi.intensity, fill: fill.intensity, sun: sun.intensity, fogNear: scene.fog ? scene.fog.near : size * .2, fogFar: scene.fog ? scene.fog.far : size, fogHex: scene.background && scene.background.isColor ? scene.background.getHex() : 0x101828 };
    const setFog = (hex, near, far, force) => {
      base.fogHex = hex; if (!force) { near = Math.max(near, size * .12); far = Math.max(far, size * .55, near + size * .3); }
      base.fogNear = near; base.fogFar = far; reapplyFog();
    };
    let weatherFog = null;                                   // {k: fog-distance factor, tint: hex, mix} set by the current weather
    function reapplyFog() {
      let hex = base.fogHex, near = base.fogNear, far = base.fogFar;
      if (weatherFog) { if (weatherFog.tint != null) hex = C.set(hex).lerp(C2.set(weatherFog.tint), weatherFog.mix || .5).getHex(); near = Math.max(near * weatherFog.k, size * .08); far = Math.max(far * weatherFog.k, near + size * .2); }
      if (scene.background && scene.background.isColor) scene.background.set(hex); else scene.background = new THREE.Color(hex);
      if (scene.fog) { scene.fog.color.set(hex); if (scene.fog.isFog) { scene.fog.near = near; scene.fog.far = far; } }
    }
    // W.fx.flashLight from the core resets the hemisphere to the biome's value; this one returns to the current preset.
    let flashTimer = 0;
    W.fx.flashLight = function (ms, mul) { hemi.intensity = base.hemi * (+mul || 3); clearTimeout(flashTimer); flashTimer = setTimeout(() => { hemi.intensity = base.hemi; }, +ms || 120); };

    // ── sky recolour (the core's inverted vertex-coloured sphere) ──
    function tintSky(bot, top) {
      if (!sky || !sky.geometry || !sky.geometry.attributes.color) return;
      const pos = sky.geometry.attributes.position, col = sky.geometry.attributes.color, R = sky.geometry.parameters.radius || size * 1.9;
      C.set(bot); C2.set(top);
      for (let i = 0; i < pos.count; i++) { const k = Math.pow(clamp(pos.getY(i) / R, 0, 1), .55); col.setXYZ(i, C.r + (C2.r - C.r) * k, C.g + (C2.g - C.g) * k, C.b + (C2.b - C.b) * k); }
      col.needsUpdate = true;
    }
    function setDisc(kind) {
      if (!sky) return; let disc = null, halo = null, stars = null;
      sky.children.forEach(ch => { if (ch.name === 'sun' || ch.name === 'moon' || ch.name === 'atmoDisc') disc = ch; else if (ch.name === 'stars') stars = ch; else if (ch.geometry && ch.geometry.type === 'CircleGeometry') halo = ch; });
      const R = sky.geometry.parameters.radius || size * 1.9;
      if (kind && !disc) {
        disc = new THREE.Mesh(new THREE.CircleGeometry(R * .05, 18), new THREE.MeshBasicMaterial({ fog: false, depthWrite: false })); disc.name = 'atmoDisc'; mark(disc); sky.add(disc);
        halo = new THREE.Mesh(new THREE.CircleGeometry(R * .11, 18), new THREE.MeshBasicMaterial({ transparent: true, opacity: .28, fog: false, depthWrite: false })); mark(halo); sky.add(halo);
      }
      if (disc) { disc.visible = !!kind; if (kind) { disc.material.color.set(kind === 'moon' ? '#eef2ff' : '#fff7d6'); disc.position.copy(sun.position).normalize().multiplyScalar(R * .92); disc.lookAt(0, 0, 0); } }
      if (halo) { halo.visible = !!kind; if (kind) { halo.material.color.set(kind === 'moon' ? '#aab4ff' : '#ffe9b0'); halo.position.copy(sun.position).normalize().multiplyScalar(R * .94); halo.lookAt(0, 0, 0); } }
      if (stars) stars.visible = kind === 'moon' || kind === 'stars';
      return stars;
    }
    let atmoStars = null;
    function wantStars(on) {
      const has = sky && sky.children.some(ch => ch.name === 'stars');
      if (has || !sky) { sky && sky.children.forEach(ch => { if (ch.name === 'stars') ch.visible = on; }); return; }
      if (!on) { if (atmoStars) atmoStars.visible = false; return; }
      if (atmoStars) { atmoStars.visible = true; return; }
      const n = 400, R = (sky.geometry.parameters.radius || size * 1.9) * .95, arr = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { const a = rand() * 6.2832, e = .08 + rand() * 1.4; arr[i * 3] = Math.cos(a) * Math.cos(e) * R; arr[i * 3 + 1] = Math.sin(e) * R; arr[i * 3 + 2] = Math.sin(a) * Math.cos(e) * R; }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
      atmoStars = mark(new THREE.Points(g, new THREE.PointsMaterial({ color: '#ffffff', size: 2, sizeAttenuation: false, fog: false }))); atmoStars.name = 'atmoStars'; sky.add(atmoStars);
    }

    // ── fake volumetric cone (additive, fresnel-faded, fogged) ──
    const CONE_VS = '#include <common>\n#include <fog_pars_vertex>\nvarying vec2 vUv; varying vec3 vN; varying vec3 vW;\nvoid main(){ vUv = uv; vN = normalize(normalMatrix * normal); vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); vW = -mvPosition.xyz; gl_Position = projectionMatrix * mvPosition;\n#include <fog_vertex>\n}';
    const CONE_FS = '#include <common>\n#include <fog_pars_fragment>\nuniform vec3 uColor; uniform float uAlpha; uniform float uPower; uniform float uTime; varying vec2 vUv; varying vec3 vN; varying vec3 vW;\nvoid main(){ float along = 1.0 - vUv.y; float fres = abs(dot(normalize(vN), normalize(vW))); float a = pow(fres, uPower) * pow(1.0 - along, 1.3) * uAlpha; a *= 0.88 + 0.12 * sin(along * 26.0 - uTime * 2.2 + vUv.x * 12.0); gl_FragColor = vec4(uColor, a);\n#include <fog_fragment>\n}';
    function cone(pos, dir, o) {
      o = o || {}; const len = +o.length || 14, r = +o.radius || Math.tan(+o.angle || .5) * len;
      const g = new THREE.CylinderGeometry(0, r, len, 20, 1, true); g.translate(0, -len / 2, 0);
      const mat = new THREE.ShaderMaterial({ uniforms: Object.assign(fogUniforms(), { uColor: { value: new THREE.Color(o.color || '#ffe9b0') }, uAlpha: { value: o.alpha != null ? +o.alpha : .32 }, uPower: { value: +o.power || 1.6 }, uTime: uTime }),
        vertexShader: CONE_VS, fragmentShader: CONE_FS, fog: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
      const m = mark(new THREE.Mesh(g, mat)); m.name = 'atmo:cone'; m.position.copy(pos); m.quaternion.setFromUnitVectors(DOWN, V2.copy(dir).normalize()); scene.add(m); return m;
    }
    // additive light pool on the ground: the cheap "this lamp lights the floor" cue that also works past the light cap
    function pool(x, z, r, color, opacity) {
      const m = mark(new THREE.Mesh(new THREE.CircleGeometry(r, 18), new THREE.MeshBasicMaterial({ color: color, map: TEX.glow(), transparent: true, opacity: opacity == null ? .28 : opacity, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -2 })));
      m.rotation.x = -Math.PI / 2; m.position.set(x, groundY(x, z) + .04, z); m.name = 'atmo:pool'; scene.add(m); return m;
    }
    function glowSprite(pos, color, s, opacity) {
      const sp = mark(new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.glow(), color: color, transparent: true, opacity: opacity == null ? .5 : opacity, depthWrite: false, blending: THREE.AdditiveBlending })));
      sp.position.copy(pos); sp.scale.set(s, s, 1); sp.name = 'atmo:glow'; scene.add(sp); return sp;
    }

    // ── lights ──
    function flood(pos, o) {
      o = o || {}; const p = toV3(pos, new THREE.Vector3()), tgt = o.target != null ? toV3(o.target, new THREE.Vector3()) : new THREE.Vector3(p.x * .4, groundY(p.x * .4, p.z * .4), p.z * .4);
      const dir = V2.copy(tgt).sub(p); const dist = dir.length() || 1; dir.normalize();
      const col = o.color || '#ffb36b', angle = clamp(+o.angle || .45, .1, 1.2), parts = [], own = [];
      let light = null;
      if (lights.length < CAP && o.light !== false) {
        light = new THREE.SpotLight(col, o.intensity != null ? +o.intensity : 60, (+o.distance || dist * 2.2), angle, o.penumbra != null ? +o.penumbra : .45, +o.decay || 1.4);
        light.position.copy(p); light.target.position.copy(tgt); scene.add(light); scene.add(light.target); lights.push(light); own.push(light);
        if (o.shadow && ctx.shadows && !SW) { light.castShadow = true; light.shadow.mapSize.set(1024, 1024); }
      } else if (o.light !== false) warn('flood: light cap (' + CAP + ') reached — cone + pool only');
      if (o.cone !== false) parts.push(cone(p, dir, { color: col, length: Math.min(dist * 1.05, size), angle: angle, alpha: o.coneAlpha != null ? +o.coneAlpha : (light ? .3 : .42) }));
      if (o.pool !== false) parts.push(pool(tgt.x, tgt.z, Math.tan(angle) * dist * 1.1, col, light ? .22 : .4));
      const head = mark(new THREE.Mesh(new THREE.SphereGeometry(.25, 8, 6), new THREE.MeshBasicMaterial({ color: col }))); head.position.copy(p); scene.add(head); parts.push(head);
      parts.push(glowSprite(p, col, 2.2, .55));
      let anim = null;
      if (o.sweep) { let t = rand() * 6, bx = tgt.x, bz = tgt.z; anim = { update(dt) { t += dt * (+o.sweep || .4); const nx = bx + Math.cos(t) * dist * .35, nz = bz + Math.sin(t * .7) * dist * .35; if (light) light.target.position.set(nx, tgt.y, nz); V.set(nx, tgt.y, nz).sub(p).normalize(); parts[0] && parts[0].isMesh && parts[0].name === 'atmo:cone' && parts[0].quaternion.setFromUnitVectors(DOWN, V); } }; animated.push(anim); }
      return { kind: 'flood', light: light, cone: parts[0] && parts[0].name === 'atmo:cone' ? parts[0] : null, position: p, remove() { parts.forEach(dispose); own.forEach(unlight); if (anim) unanimate(anim); } };
    }
    function lamp(pos, o) {
      o = o || {}; const p = toV3(pos, new THREE.Vector3()), col = o.color || '#ffd48a', I = o.intensity != null ? +o.intensity : 14, D = +o.distance || 16, parts = [], own = [];
      let light = null;
      if (lights.length < CAP && o.light !== false) { light = new THREE.PointLight(col, I, D, +o.decay || 1.6); light.position.copy(p); scene.add(light); lights.push(light); own.push(light); }
      if (o.bulb !== false) { const b = mark(new THREE.Mesh(new THREE.SphereGeometry(+o.bulbSize || .18, 8, 6), new THREE.MeshBasicMaterial({ color: col }))); b.position.copy(p); scene.add(b); parts.push(b); }
      const glow = glowSprite(p, col, +o.glow || (light ? 1.6 : 2.4), light ? .5 : .75); parts.push(glow);
      if (o.pool !== false) parts.push(pool(p.x, p.z, D * .32, col, light ? .18 : .34));
      let anim = null;
      if (o.flicker) { const ph = rand() * 9, sp = +o.flicker === true ? 1 : +o.flicker || 1, g0 = glow.material.opacity; anim = { update() { const t = uTime.value * 9 * sp; const k = .78 + .22 * (Math.sin(t + ph) * .5 + Math.sin(t * 2.7 + ph * 1.3) * .5) * (Math.sin(t * .37 + ph) > -.6 ? 1 : .3); if (light) light.intensity = I * k; glow.material.opacity = g0 * k; } }; animated.push(anim); }
      return { kind: 'lamp', light: light, glow: glow, position: p, remove() { parts.forEach(dispose); own.forEach(unlight); if (anim) unanimate(anim); } };
    }
    function emissive(mesh, color, intensity) {
      if (!mesh || !mesh.traverse) { warn('emissive(mesh, color, intensity): mesh required'); return mesh; }
      const I = intensity == null ? 1 : +intensity;
      mesh.traverse(m => {
        if (!m.isMesh || !m.material) return;
        if (!m.material.__atmoEmissive) { m.material = m.material.clone(); m.material.__atmoEmissive = true; }
        const mt = m.material; if (mt.emissive) { mt.emissive.set(color || mt.color); mt.emissiveIntensity = I; } else if (mt.color) mt.color.set(color || mt.color);
      });
      return mesh;
    }
    function godRays(dir, o) {
      o = o || {}; const d = dir != null ? toV3(dir, new THREE.Vector3()) : V2.copy(sun.position); d.normalize();
      const n = clamp(o.count | 0 || 5, 1, 12), len = +o.length || size * .45, w = +o.width || len * .12, col = o.color || '#ffe9b0', g = new THREE.Group(); g.name = 'atmo:godRays';
      const geo = new THREE.PlaneGeometry(w, len); geo.translate(0, -len / 2, 0);
      const mat = new THREE.MeshBasicMaterial({ color: col, map: TEX.streak(), transparent: true, opacity: o.opacity != null ? +o.opacity : .16, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
      const origin = o.pos != null ? toV3(o.pos, new THREE.Vector3()) : d.clone().multiplyScalar(size * .5).setY(Math.max(18 * K, d.y * size * .5)), planes = [];
      for (let i = 0; i < n; i++) { const m = mark(new THREE.Mesh(geo, mat)); m.position.copy(origin).add(V.set((rand() - .5) * len * .5, 0, (rand() - .5) * len * .5)); m.quaternion.setFromUnitVectors(DOWN, V.copy(d).negate().normalize()); m.rotateY(rand() * 6.2832); m.userData.ph = rand() * 6; g.add(m); planes.push(m); }
      mark(g); scene.add(g);
      const anim = { update() { for (let i = 0; i < planes.length; i++) { const k = .7 + .3 * Math.sin(uTime.value * .6 + planes[i].userData.ph); planes[i].scale.x = k; } mat.opacity = (o.opacity != null ? +o.opacity : .16) * (.85 + .15 * Math.sin(uTime.value * .4)); } };
      animated.push(anim);
      return { kind: 'godRays', group: g, remove() { unanimate(anim); dispose(g); } };
    }

    // ── presets (data): hemi [sky, ground, i] · sun [color, i, pos] · fill [color, i] · exposure · fog [hex, nearFrac, farFrac] · sky [bottom, top] · disc · stars · lights(W) ──
    const ring = (n, r, y, fn) => { const out = []; for (let i = 0; i < n; i++) { const a = i / n * 6.2832 + .5; out.push(fn(Math.cos(a) * r, y, Math.sin(a) * r, i)); } return out; };
    const LP = {
      noon:            { hemi: ['#e8f4ff', '#6a7a5a', 1.7], sun: ['#fff6e0', 2.8, [40, 90, 30]], fill: ['#ffffff', .15], exposure: 1.05, fog: ['#c9dcea', .25, 1.1], sky: ['#cfe9ff', '#3f8fd6'], disc: 'sun' },
      goldenHour:      { hemi: ['#ffd9a8', '#5a4a3a', 1.35], sun: ['#ffb060', 2.7, [80, 26, 40]], fill: ['#ffb080', .22], exposure: 1.1, fog: ['#f0c48e', .2, 1], sky: ['#ffb870', '#4a6fb0'], disc: 'sun' },
      overcast:        { hemi: ['#d2dae2', '#7a7f86', 1.9], sun: ['#dfe6ee', 1.3, [20, 80, 30]], fill: ['#dfe6ee', .3], exposure: 1.0, fog: ['#c4ccd4', .18, .8], sky: ['#c8d0d8', '#8a96a4'], disc: null },
      dusk:            { hemi: ['#8a7ab8', '#3a2a3a', 1.25], sun: ['#ff8a66', 1.5, [-70, 16, 30]], fill: ['#6a5a9a', .4], exposure: 1.15, fog: ['#4a3a66', .18, .9], sky: ['#ff9a6a', '#2a2a5a'], disc: 'sun' },
      night:           { hemi: ['#6a7cff', '#0d1226', 1.9], sun: ['#9fb4ff', 2.2, [-40, 60, 20]], fill: ['#4a5a8a', .85], exposure: 1.45, fog: ['#121b40', .2, .9], sky: ['#1c2a5c', '#0b1030'], disc: 'moon', stars: true },
      nightIndustrial: { hemi: ['#5a6cd0', '#1a140c', 1.6], sun: ['#9fb4ff', 1.8, [-30, 50, -20]], fill: ['#4a5a8a', .75], exposure: 1.45, fog: ['#101a30', .18, .85], sky: ['#182244', '#080c1c'], disc: 'moon', stars: true,
        lights: W => ring(3, half * .55, 7.5 * K, (x, y, z, i) => flood([x, y, z], { target: [x * .25, 0, z * .25], color: i === 1 ? '#ffe2a8' : '#ffb36b', intensity: 60, angle: .5, sweep: i === 0 ? .3 : 0 })).concat(ring(2, half * .3, 3.4, (x, y, z) => lamp([x, y, z], { color: '#ffd48a', flicker: true }))) },
      moonlitRain:     { hemi: ['#5a6ce0', '#0c1020', 1.8], sun: ['#aab8ff', 2.0, [-30, 60, 10]], fill: ['#4a5a8a', .85], exposure: 1.45, fog: ['#141e38', .15, .7], sky: ['#141e38', '#070a18'], disc: 'moon', stars: false, weather: 'rain',
        lights: W => ring(2, half * .32, 3.4, (x, y, z) => lamp([x, y, z], { color: '#ffd48a' })) },
      neonCity:        { hemi: ['#8a6aff', '#1a1030', 2.1], sun: ['#8aa0ff', 1.8, [-30, 60, 40]], fill: ['#6a5aaa', 1.0], exposure: 1.45, fog: ['#1c1640', .18, .85], sky: ['#33206a', '#08061a'], disc: null, stars: true,
        lights: W => ring(4, half * .35, 3.2, (x, y, z, i) => lamp([x, y, z], { color: i % 2 ? '#ff3fa4' : '#22d3ee', intensity: 22, distance: 20 })) },
      alarm:           { hemi: ['#ff7a5a', '#2a0c0c', 1.6], sun: ['#ff9a80', 1.4, [-30, 60, 20]], fill: ['#ff5a4a', .8], exposure: 1.4, fog: ['#361016', .2, .9], sky: ['#5a1616', '#100404'], disc: null, pulse: 1.4,
        lights: W => ring(2, half * .3, 4, (x, y, z) => lamp([x, y, z], { color: '#ff2a2a', intensity: 22, distance: 22 })) },
      cinematicFog:    { hemi: ['#b8c4d8', '#5a5f6a', 1.4], sun: ['#e8eefc', 2.1, [-40, 28, 40]], fill: ['#c0c8d8', .3], exposure: 1.05, fog: ['#aab4c4', .12, .55], sky: ['#b8c2d2', '#7a86a0'], disc: 'sun', weather: 'fog',
        lights: W => [godRays(null, { count: 6 })] },
      underground:     { hemi: ['#7a7a98', '#3a2c1c', 2.2], sun: ['#8a8aa0', 1.0, [0, 60, 0]], fill: ['#9a8a78', 1.45], exposure: 1.65, fog: ['#2a2638', .14, .6], sky: ['#2a2638', '#08070c'], disc: null,
        lights: W => ring(3, half * .3, 2.6, (x, y, z) => lamp([x, y, z], { color: '#ff9a3c', flicker: 1.4, intensity: 20, distance: 20 })) },
      space:           { hemi: ['#8a98ff', '#1a1030', 1.9], sun: ['#ffffff', 3.0, [-50, 60, -30]], fill: ['#4a5a8a', .85], exposure: 1.4, fog: ['#0e1228', .3, 1.2], sky: ['#0d1230', '#05060f'], disc: 'moon', stars: true }
    };
    let current = null;
    function applyData(D, o) {
      o = o || {}; const mul = o.intensity != null ? +o.intensity : 1;
      hemi.color.set(D.hemi[0]); hemi.groundColor.set(D.hemi[1]); hemi.intensity = D.hemi[2] * mul;
      sun.color.set(D.sun[0]); sun.intensity = D.sun[1] * mul; sun.position.set(D.sun[2][0], D.sun[2][1], D.sun[2][2]);
      fill.color.set(D.fill[0]); fill.intensity = o.fill != null ? +o.fill : D.fill[1] * mul;
      base.hemi = hemi.intensity; base.fill = fill.intensity; base.sun = sun.intensity;
      if ('toneMappingExposure' in renderer) renderer.toneMappingExposure = o.exposure != null ? +o.exposure : D.exposure;
      if (o.fog !== false) { const f = D.fog; setFog(f[0], (o.fogNear != null ? +o.fogNear : size * f[1]), (o.fogFar != null ? +o.fogFar : size * f[2]), !!o.force); }
      if (o.sky !== false) { tintSky(D.sky[0], D.sky[1]); setDisc(D.disc); wantStars(!!D.stars); }
    }
    function apply(name, o) {
      o = o || {}; const D = LP[name];
      if (!D) { warn('lighting.apply: unknown preset "' + name + '" — presets: ' + Object.keys(LP).join(', ')); return current || { name: null, lights: [], remove: noop }; }
      if (current) current.remove();
      applyData(D, o);
      const own = []; let anim = null, weatherH = null;
      if (D.lights && o.lights !== false) { try { D.lights(W).forEach(h => h && own.push(h)); } catch (e) { warn('preset lights: ' + (e && e.message)); } }
      if (D.weather && o.weather !== false) weatherH = W.weather.set(D.weather, o.weatherOpts);
      if (D.pulse) { const f0 = fill.intensity, h0 = hemi.intensity; anim = { update() { const k = .55 + .45 * Math.max(0, Math.sin(uTime.value * D.pulse * 6.2832)); fill.intensity = f0 * (.6 + k * .8); hemi.intensity = h0 * (.7 + k * .5); own.forEach(h => { if (h.light) h.light.intensity = 18 * (.3 + k); if (h.glow) h.glow.material.opacity = .25 + .5 * k; }); } }; animated.push(anim); }
      const h = { name: name, lights: own, remove() { if (current !== h) return; own.forEach(x => x.remove && x.remove()); if (anim) unanimate(anim); if (weatherH && W.weather.current === weatherH) weatherH.remove(); current = null; } };
      current = h; return h;
    }
    // t in hours: 0 night · 6 dawn (goldenHour) · 12 noon · 17 goldenHour · 19 dusk · 21 night
    const TOD = [[0, 'night'], [4.5, 'night'], [6.5, 'goldenHour'], [12, 'noon'], [17, 'goldenHour'], [19, 'dusk'], [21, 'night'], [24, 'night']];
    const TD = { hemi: ['#000', '#000', 0], sun: ['#000', 0, [0, 0, 0]], fill: ['#000', 0], exposure: 1, fog: ['#000', 0, 0], sky: ['#000', '#000'], disc: null, stars: false };
    const lerpHex = (a, b, k) => '#' + C.set(a).lerp(C2.set(b), k).getHexString();
    function timeOfDay(t, o) {
      t = ((+t || 0) % 24 + 24) % 24; let i = 0; while (i < TOD.length - 2 && TOD[i + 1][0] <= t) i++;
      const A = LP[TOD[i][1]], B = LP[TOD[i + 1][1]], k = clamp((t - TOD[i][0]) / (TOD[i + 1][0] - TOD[i][0]), 0, 1), e = k * k * (3 - 2 * k);
      TD.hemi = [lerpHex(A.hemi[0], B.hemi[0], e), lerpHex(A.hemi[1], B.hemi[1], e), A.hemi[2] + (B.hemi[2] - A.hemi[2]) * e];
      TD.sun = [lerpHex(A.sun[0], B.sun[0], e), A.sun[1] + (B.sun[1] - A.sun[1]) * e, [0, 1, 2].map(j => A.sun[2][j] + (B.sun[2][j] - A.sun[2][j]) * e)];
      TD.fill = [lerpHex(A.fill[0], B.fill[0], e), A.fill[1] + (B.fill[1] - A.fill[1]) * e]; TD.exposure = A.exposure + (B.exposure - A.exposure) * e;
      TD.fog = [lerpHex(A.fog[0], B.fog[0], e), A.fog[1] + (B.fog[1] - A.fog[1]) * e, A.fog[2] + (B.fog[2] - A.fog[2]) * e]; TD.sky = [lerpHex(A.sky[0], B.sky[0], e), lerpHex(A.sky[1], B.sky[1], e)];
      TD.disc = e < .5 ? A.disc : B.disc; TD.stars = e < .5 ? !!A.stars : !!B.stars;
      if (current && current.name !== 'timeOfDay') { current.remove(); }
      applyData(TD, o);
      if (!current) current = { name: 'timeOfDay', lights: [], remove() { current = null; } };
      return current;
    }
    // self-check: draw the canvas into 32×18, mean luminance 0..1 (matches what the checker samples)
    function readability(o) {
      o = o || {}; const out = { ok: false, meanLum: 0, spread: 0, hint: '' };
      try {
        if (o.render !== false) W.render();
        const w = 32, h = 18, cv = readability.cv || (readability.cv = document.createElement('canvas')); cv.width = w; cv.height = h;
        const g = cv.getContext('2d', { willReadFrequently: true }); g.drawImage(renderer.domElement, 0, 0, w, h);
        const d = g.getImageData(0, 0, w, h).data; let sum = 0, mn = 255, mx = 0;
        for (let i = 0; i < d.length; i += 4) { const l = (d[i] * 3 + d[i + 1] * 6 + d[i + 2]) / 10; sum += l; if (l < mn) mn = l; if (l > mx) mx = l; }
        out.meanLum = +(sum / (d.length / 4) / 255).toFixed(3); out.spread = +((mx - mn) / 255).toFixed(3);
        const min = o.min != null ? +o.min : .1;
        if (out.meanLum < min) out.hint = 'too dark (' + out.meanLum + ' < ' + min + '): raise fill/exposure, add W.lighting.lamp/flood, lighten the fog colour';
        else if (out.spread < .12) out.hint = 'flat: add contrast — a warm lamp against the cool moon, fog not too close';
        else if (out.meanLum > .88) out.hint = 'washed out: lower exposure or the fog fraction';
        out.ok = !out.hint;
      } catch (e) { out.hint = 'sample failed: ' + (e && e.message); }
      return out;
    }

    // ── weather: camera-relative wrapping volumes ──
    const BOX = 18, HGT = 14;
    let weather = null;
    function wrapPos(pos, i, y0) {                              // keep particle i inside the camera box; y0 = lower bound offset
      const j = i * 3; let x = pos[j], y = pos[j + 1], z = pos[j + 2];
      if (x < V.x - BOX) x += BOX * 2; else if (x > V.x + BOX) x -= BOX * 2;
      if (z < V.z - BOX) z += BOX * 2; else if (z > V.z + BOX) z -= BOX * 2;
      if (y < V.y + y0) y += HGT; else if (y > V.y + y0 + HGT) y -= HGT;
      pos[j] = x; pos[j + 1] = y; pos[j + 2] = z;
    }
    function points(n, o) {                                     // a Points cloud of n particles with a per-particle velocity
      const pos = new Float32Array(n * 3), vel = new Float32Array(n * 3), col = new Float32Array(n * 3), base = new THREE.Color(o.color);
      for (let i = 0; i < n; i++) { pos[i * 3] = (rand() - .5) * BOX * 2; pos[i * 3 + 1] = rand() * HGT - 2; pos[i * 3 + 2] = (rand() - .5) * BOX * 2; vel[i * 3] = o.wind[0] + (rand() - .5) * o.drift; vel[i * 3 + 1] = o.fall * (.7 + rand() * .6); vel[i * 3 + 2] = o.wind[2] + (rand() - .5) * o.drift; C.copy(base).multiplyScalar(.75 + rand() * .35).toArray(col, i * 3); }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      const mat = new THREE.PointsMaterial({ size: o.size, map: o.map || null, vertexColors: true, sizeAttenuation: true, transparent: true, opacity: o.opacity, depthWrite: false, blending: o.additive ? THREE.AdditiveBlending : THREE.NormalBlending });
      const p = mark(new THREE.Points(g, mat)); p.name = 'atmo:' + o.name; scene.add(p);
      return { obj: p, pos: pos, vel: vel, col: col, n: n, base: base, geo: g };
    }
    const WX = {
      rain(o) {
        const n = Math.round((+o.count || 1400) * QF), pos = new Float32Array(n * 6), vel = new Float32Array(n * 3), wind = o.wind || [1.5, 0, .5], len = +o.length || .32;
        for (let i = 0; i < n; i++) { const j = i * 3; pos[i * 6] = (rand() - .5) * BOX * 2; pos[i * 6 + 1] = rand() * HGT - 2; pos[i * 6 + 2] = (rand() - .5) * BOX * 2; vel[j] = wind[0]; vel[j + 1] = -(9 + rand() * 4); vel[j + 2] = wind[2]; }
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        const ls = mark(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: o.color || '#9fb8d8', transparent: true, opacity: o.opacity != null ? +o.opacity : .38, depthWrite: false, blending: THREE.AdditiveBlending }))); ls.name = 'atmo:rain'; scene.add(ls);
        let splash = null, sN = 0, sT = null, sPos = null;
        if (o.splash !== false && !SW) { sN = 36; splash = mark(new THREE.InstancedMesh(new THREE.RingGeometry(.08, .12, 10), new THREE.MeshBasicMaterial({ color: '#c8d8f0', transparent: true, opacity: .45, depthWrite: false }), sN)); splash.name = 'atmo:splash'; splash.geometry.rotateX(-Math.PI / 2); sT = new Float32Array(sN).fill(9); sPos = new Float32Array(sN * 2); scene.add(splash); }
        const tmp = new THREE.Vector3();
        return { objs: [ls, splash], fog: { k: .78, tint: '#8a94a8', mix: .25 }, update(dt) {
          camera.getWorldPosition(V);
          for (let i = 0; i < n; i++) { const j = i * 3, k = i * 6; pos[k] += vel[j] * dt; pos[k + 1] += vel[j + 1] * dt; pos[k + 2] += vel[j + 2] * dt;
            if (pos[k] < V.x - BOX) pos[k] += BOX * 2; else if (pos[k] > V.x + BOX) pos[k] -= BOX * 2; if (pos[k + 2] < V.z - BOX) pos[k + 2] += BOX * 2; else if (pos[k + 2] > V.z + BOX) pos[k + 2] -= BOX * 2; if (pos[k + 1] < V.y - 3) pos[k + 1] += HGT;
            pos[k + 3] = pos[k] - vel[j] * len * .06; pos[k + 4] = pos[k + 1] - vel[j + 1] * len * .06; pos[k + 5] = pos[k + 2] - vel[j + 2] * len * .06; }
          g.attributes.position.needsUpdate = true;
          if (splash) { for (let i = 0; i < sN; i++) { sT[i] += dt * 4; if (sT[i] > 1) { if (rand() < .35) { sT[i] = 0; sPos[i * 2] = V.x + (rand() - .5) * 12; sPos[i * 2 + 1] = V.z + (rand() - .5) * 12; } else { M.makeScale(0, 0, 0); splash.setMatrixAt(i, M); continue; } } const s = .4 + sT[i] * 2; tmp.set(sPos[i * 2], groundY(sPos[i * 2], sPos[i * 2 + 1]) + .03, sPos[i * 2 + 1]); M.compose(tmp, Q.identity(), V2.set(s, 1, s)); splash.setMatrixAt(i, M); } splash.instanceMatrix.needsUpdate = true; }
        } };
      },
      storm(o) {
        const r = WX.rain(Object.assign({ count: 1700, opacity: .42 }, o)), bolt = mark(new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: '#dfe8ff', transparent: true, opacity: .95, fog: false }))); bolt.visible = false; bolt.name = 'atmo:bolt'; scene.add(bolt);
        let next = 2 + rand() * 4, flashT = 0, sunI = 0, kick = 0;
        const strike = () => {
          const x = V.x + (rand() - .5) * 60, z = V.z - 20 - rand() * 40, pts = []; let px = x, py = 45, pz = z;
          for (let i = 0; i < 7; i++) { const nx = px + (rand() - .5) * 6, ny = py - 6.5, nz = pz + (rand() - .5) * 6; pts.push(px, py, pz, nx, ny, nz); if (i === 2) pts.push(nx, ny, nz, nx + (rand() - .5) * 12, ny - 8, nz + (rand() - .5) * 8); px = nx; py = ny; pz = nz; }
          bolt.geometry.dispose(); bolt.geometry = new THREE.BufferGeometry(); bolt.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); bolt.visible = true; flashT = .09 + rand() * .05;
          W.fx.flashLight(90 + rand() * 40, 3.5); sunI = sun.intensity; sun.intensity = sunI * 3; kick = 1; scene.background && scene.background.isColor && scene.background.set('#334466');
          const delay = 300 + rand() * 1800; setTimeout(() => { try { const k = ctx.kit(); k && k.audio && k.audio.play(o.thunder || 'explode'); } catch (e) {} }, delay);
        };
        return { objs: r.objs.concat([bolt]), fog: { k: .7, tint: '#6a7488', mix: .35 }, strike: strike, update(dt) {
          r.update(dt); next -= dt; if (next <= 0 && o.lightning !== false) { strike(); next = (+o.interval || 6) * (.5 + rand()); }
          if (flashT > 0) { flashT -= dt; if (flashT <= 0) { bolt.visible = false; sun.intensity = sunI; reapplyFog(); kick = 0; } }
        } };
      },
      snow(o) { const p = points(Math.round((+o.count || 650) * QF), { name: 'snow', color: o.color || '#ffffff', size: +o.size || .18, map: TEX.flake(), opacity: .9, fall: -1.1, drift: .4, wind: o.wind || [.3, 0, .1] }); return { objs: [p.obj], fog: { k: .9, tint: '#d8e2ee', mix: .35 }, update(dt) { camera.getWorldPosition(V); const t = uTime.value; for (let i = 0; i < p.n; i++) { const j = i * 3; p.pos[j] += (p.vel[j] + Math.sin(t + i) * .5) * dt; p.pos[j + 1] += p.vel[j + 1] * dt; p.pos[j + 2] += (p.vel[j + 2] + Math.cos(t * .8 + i) * .3) * dt; wrapPos(p.pos, i, -2); } p.geo.attributes.position.needsUpdate = true; } }; },
      fog(o) {
        const n = SW ? 5 : 9, g = new THREE.Group(), geo = new THREE.PlaneGeometry(1, 1), planes = [], col = o.color || base.fogHex;
        const mat = new THREE.MeshBasicMaterial({ color: col, alphaMap: TEX.puff(), transparent: true, opacity: o.opacity != null ? +o.opacity : .22, depthWrite: false, side: THREE.DoubleSide });
        for (let i = 0; i < n; i++) { const m = mark(new THREE.Mesh(geo, mat)); const s = 14 + rand() * 14; m.scale.set(s, s * .7, 1); m.rotation.x = -Math.PI / 2; m.userData.o = [(rand() - .5) * 36, .5 + rand() * 1.4, (rand() - .5) * 36, rand() * 6]; g.add(m); planes.push(m); }
        mark(g); g.name = 'atmo:fogbank'; scene.add(g);
        return { objs: [g], fog: { k: o.dense === false ? 1 : .72, tint: col, mix: .3 }, update() { camera.getWorldPosition(V); const t = uTime.value; for (let i = 0; i < n; i++) { const d = planes[i].userData.o, x = V.x + d[0] + Math.sin(t * .1 + d[3]) * 3, z = V.z + d[2] + Math.cos(t * .08 + d[3]) * 3; planes[i].position.set(x, groundY(x, z) + d[1] + Math.sin(t * .3 + d[3]) * .15, z); } } };
      },
      dust(o) { const p = points(Math.round((+o.count || 300) * QF), { name: 'dust', color: o.color || '#e8dcc0', size: +o.size || .09, map: TEX.glow(), opacity: .4, additive: true, fall: .05, drift: .3, wind: o.wind || [.2, 0, 0] }); return { objs: [p.obj], update(dt) { camera.getWorldPosition(V); const t = uTime.value; for (let i = 0; i < p.n; i++) { const j = i * 3; p.pos[j] += p.vel[j] * dt; p.pos[j + 1] += (p.vel[j + 1] + Math.sin(t * 1.3 + i) * .12) * dt; p.pos[j + 2] += p.vel[j + 2] * dt; wrapPos(p.pos, i, -1); } p.geo.attributes.position.needsUpdate = true; } }; },
      embers(o) { const p = points(Math.round((+o.count || 200) * QF), { name: 'embers', color: o.color || '#ff8a2a', size: +o.size || .14, map: TEX.glow(), opacity: .9, additive: true, fall: 1.2, drift: .5, wind: o.wind || [.4, 0, .2] }); const c2 = new THREE.Color('#ffd080'); return { objs: [p.obj], update(dt) { camera.getWorldPosition(V); const t = uTime.value; for (let i = 0; i < p.n; i++) { const j = i * 3; p.pos[j] += (p.vel[j] + Math.sin(t * 2 + i) * .4) * dt; p.pos[j + 1] += p.vel[j + 1] * dt; p.pos[j + 2] += p.vel[j + 2] * dt; wrapPos(p.pos, i, -1); const k = .4 + .6 * Math.abs(Math.sin(t * 5 + i * 1.3)); C.copy(p.base).lerp(c2, k * .6).multiplyScalar(k).toArray(p.col, j); } p.geo.attributes.position.needsUpdate = true; p.geo.attributes.color.needsUpdate = true; } }; },
      fireflies(o) { const p = points(Math.round((+o.count || 90) * QF), { name: 'fireflies', color: o.color || '#d8ff6a', size: +o.size || .16, map: TEX.glow(), opacity: .95, additive: true, fall: 0, drift: .6, wind: [0, 0, 0] }); return { objs: [p.obj], update(dt) { camera.getWorldPosition(V); const t = uTime.value; for (let i = 0; i < p.n; i++) { const j = i * 3; p.pos[j] += (p.vel[j] + Math.sin(t * .9 + i) * .4) * dt; p.pos[j + 1] += Math.sin(t * 1.7 + i * .7) * .5 * dt; p.pos[j + 2] += (p.vel[j + 2] + Math.cos(t * .7 + i) * .4) * dt; wrapPos(p.pos, i, -1.5); const k = Math.max(0, Math.sin(t * 2.2 + i * 2.1)); C.copy(p.base).multiplyScalar(.15 + .85 * k).toArray(p.col, j); } p.geo.attributes.position.needsUpdate = true; p.geo.attributes.color.needsUpdate = true; } }; },
      ash(o) { const p = points(Math.round((+o.count || 320) * QF), { name: 'ash', color: o.color || '#a8a49c', size: +o.size || .13, map: TEX.flake(), opacity: .75, fall: -.55, drift: .5, wind: o.wind || [.5, 0, .2] }); return { objs: [p.obj], fog: { k: .85, tint: '#3a3634', mix: .3 }, update(dt) { camera.getWorldPosition(V); const t = uTime.value; for (let i = 0; i < p.n; i++) { const j = i * 3; p.pos[j] += (p.vel[j] + Math.sin(t * .8 + i) * .6) * dt; p.pos[j + 1] += p.vel[j + 1] * dt; p.pos[j + 2] += (p.vel[j + 2] + Math.cos(t * .6 + i) * .4) * dt; wrapPos(p.pos, i, -2); } p.geo.attributes.position.needsUpdate = true; } }; },
      sandstorm(o) { const p = points(Math.round((+o.count || 900) * QF), { name: 'sandstorm', color: o.color || '#d9b979', size: +o.size || .22, map: TEX.puff(), opacity: .5, fall: -.3, drift: 2, wind: o.wind || [11, 0, 3] }); return { objs: [p.obj], fog: { k: .5, tint: '#c9a86a', mix: .7 }, update(dt) { camera.getWorldPosition(V); const t = uTime.value; for (let i = 0; i < p.n; i++) { const j = i * 3; p.pos[j] += p.vel[j] * dt; p.pos[j + 1] += (p.vel[j + 1] + Math.sin(t * 3 + i) * 1.5) * dt; p.pos[j + 2] += (p.vel[j + 2] + Math.cos(t * 2 + i) * 1.2) * dt; wrapPos(p.pos, i, -2); } p.geo.attributes.position.needsUpdate = true; } }; }
    };
    function setWeather(kind, o) {
      o = o || {};
      if (weather) { weather.remove(); }
      if (!kind || kind === 'none') return { kind: 'none', update: noop, remove: noop };
      const mk = WX[kind];
      if (!mk) { warn('weather.set: unknown kind "' + kind + '" — kinds: ' + Object.keys(WX).join(', ') + ', none'); return { kind: 'none', update: noop, remove: noop }; }
      let inner; try { inner = mk(o); } catch (e) { warn('weather ' + kind + ': ' + (e && e.message)); return { kind: 'none', update: noop, remove: noop }; }
      weatherFog = o.fog === false ? null : (inner.fog || null); reapplyFog();
      const anim = { update(dt) { try { inner.update(dt); } catch (e) { warn('weather update: ' + (e && e.message)); unanimate(anim); } } };
      animated.push(anim);
      const h = { kind: kind, strike: inner.strike || noop, update: dt => inner.update(dt), remove() { if (weather !== h) return; unanimate(anim); inner.objs.forEach(dispose); weather = null; weatherFog = null; reapplyFog(); } };
      weather = h; return h;
    }

    // ── atmosphere props ──
    function puddles(n, o) {
      o = o || {}; n = clamp(n | 0 || 8, 1, 40); const g = new THREE.Group(); g.name = 'atmo:puddles'; const A = +o.area || half * .6, ms = [];
      const mat = new THREE.MeshPhongMaterial({ color: o.color || '#0b0f18', specular: '#9fb4d8', shininess: 160, transparent: true, opacity: o.opacity != null ? +o.opacity : .82, polygonOffset: true, polygonOffsetFactor: -1, depthWrite: false });
      for (let i = 0; i < n; i++) {
        const r = (+o.size || 1.6) * (.6 + rand() * .9), pts = []; for (let k = 0; k < 10; k++) { const a = k / 10 * 6.2832, rr = r * (.7 + rand() * .45); pts.push(new THREE.Vector2(Math.cos(a) * rr, Math.sin(a) * rr)); }
        const m = mark(new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape(pts)), mat)); m.rotation.x = -Math.PI / 2;
        const x = (rand() - .5) * A * 2, z = (rand() - .5) * A * 2; if (Math.hypot(x, z) < 2.5) { i--; continue; }
        m.position.set(x, groundY(x, z) + .02, z); g.add(m); ms.push(m);
      }
      mark(g); scene.add(g); let anim = null;
      if (o.ripple !== false) { anim = { update() { const t = uTime.value; for (let i = 0; i < ms.length; i++) ms[i].position.y = groundY(ms[i].position.x, ms[i].position.z) + .02 + Math.sin(t * 2 + i) * .004; } }; animated.push(anim); }
      return { group: g, meshes: ms, remove() { if (anim) unanimate(anim); dispose(g); } };
    }
    const SWAY = { tree: 4.5, bush: 1.2, grass: .6, flower: .55, cactus: 2 };
    const WIND_VS = '#include <begin_vertex>\n#ifdef USE_INSTANCING\nvec4 aWp = modelMatrix * instanceMatrix * vec4(position, 1.0);\n#else\nvec4 aWp = modelMatrix * vec4(position, 1.0);\n#endif\nfloat aH = clamp(position.y / uSwayH, 0.0, 1.0); float aB = aH * aH; float aPh = aWp.x * 0.3 + aWp.z * 0.2;\nfloat aW = sin(uTime * 1.1 + aPh) * 0.6 + sin(uTime * 2.3 + aPh * 1.7) * 0.3;\ntransformed.xz += uWindDir * aW * aB * uWindK; transformed.y -= aB * abs(aW) * uWindK * 0.25;';
    function wind(o) {
      o = o || {}; const dir = new THREE.Vector2(o.dir ? +o.dir[0] || 0 : 1, o.dir ? (+o.dir[2] != null ? +o.dir[2] : +o.dir[1]) || 0 : .4).normalize(), K0 = { value: o.strength != null ? +o.strength : .18 }, kinds = o.kinds || Object.keys(SWAY), done = new Set();
      const attach = () => { propSets.forEach(h => { if (!h || kinds.indexOf(h.kind) < 0 || done.has(h)) return; done.add(h); (h.meshes || []).forEach(m => { if (!m.material || m.material.__atmoWind) return;
        const mt = m.material.clone(); mt.__atmoWind = true; const H = SWAY[h.kind] || 1;
        mt.onBeforeCompile = s => { s.uniforms.uTime = uTime; s.uniforms.uWindDir = { value: dir }; s.uniforms.uWindK = K0; s.uniforms.uSwayH = { value: H }; s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime; uniform vec2 uWindDir; uniform float uWindK; uniform float uSwayH;').replace('#include <begin_vertex>', WIND_VS); };
        mt.customProgramCacheKey = () => 'atmo-wind-' + H; m.material = mt; }); }); };
      attach(); let acc = 0; const anim = { update(dt) { acc += dt; if (acc > 1) { acc = 0; attach(); } } }; animated.push(anim);
      return { kind: 'wind', set strength(v) { K0.value = +v || 0; }, get strength() { return K0.value; }, dir: dir, remove() { unanimate(anim); K0.value = 0; } };
    }
    // puffs: a Points cloud with per-particle size/alpha (smoke, steam, sparks)
    const PUFF_VS = '#include <common>\n#include <fog_pars_vertex>\nattribute float aSize; attribute float aAlpha; varying float vA; uniform float uScale;\nvoid main(){ vA = aAlpha; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition; gl_PointSize = aSize * uScale / max(0.2, -mvPosition.z);\n#include <fog_vertex>\n}';
    const PUFF_FS = '#include <common>\n#include <fog_pars_fragment>\nuniform sampler2D uTex; uniform vec3 uColor; varying float vA;\nvoid main(){ float a = texture2D(uTex, gl_PointCoord).a * vA; if (a < 0.01) discard; gl_FragColor = vec4(uColor, a);\n#include <fog_fragment>\n}';
    function puffs(pos, o, spec) {
      o = o || {}; const p = toV3(pos, new THREE.Vector3()), n = Math.round((+o.count || spec.count) * (spec.sw === false ? 1 : QF)) || 1, P = new Float32Array(n * 3), S = new Float32Array(n), A = new Float32Array(n), life = new Float32Array(n), vel = new Float32Array(n * 3), L = +o.life || spec.life;
      const seed = i => { const j = i * 3; P[j] = p.x + (rand() - .5) * spec.r; P[j + 1] = p.y; P[j + 2] = p.z + (rand() - .5) * spec.r; vel[j] = (rand() - .5) * spec.spread + spec.wind[0]; vel[j + 1] = spec.up * (.7 + rand() * .6); vel[j + 2] = (rand() - .5) * spec.spread + spec.wind[1]; life[i] = 0; };
      for (let i = 0; i < n; i++) { seed(i); life[i] = rand() * L; }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('aSize', new THREE.BufferAttribute(S, 1)); g.setAttribute('aAlpha', new THREE.BufferAttribute(A, 1));
      const mat = new THREE.ShaderMaterial({ uniforms: Object.assign(fogUniforms(), { uTex: { value: TEX.puff() }, uColor: { value: new THREE.Color(o.color || spec.color) }, uScale: { value: 180 } }), vertexShader: PUFF_VS, fragmentShader: PUFF_FS, fog: true, transparent: true, depthWrite: false, blending: spec.additive ? THREE.AdditiveBlending : THREE.NormalBlending });
      const pts = mark(new THREE.Points(g, mat)); pts.name = 'atmo:' + spec.name; scene.add(pts);
      const size0 = +o.size || spec.size, grav = spec.gravity || 0, rate = o.rate != null ? +o.rate : 1;
      const anim = { update(dt) { mat.uniforms.uScale.value = (renderer.domElement.height || 360) * .5; for (let i = 0; i < n; i++) { const j = i * 3; life[i] += dt * rate; if (life[i] > L) { seed(i); if (spec.burst && rand() < .6) life[i] = -rand() * L * 2; } const k = clamp(life[i] / L, 0, 1); vel[j + 1] -= grav * dt; P[j] += vel[j] * dt; P[j + 1] += vel[j + 1] * dt; P[j + 2] += vel[j + 2] * dt; S[i] = size0 * (spec.grow ? .3 + k * 1.7 : 1) * (life[i] < 0 ? 0 : 1); A[i] = spec.additive ? (1 - k) : Math.sin(k * 3.1416) * spec.alpha; } g.attributes.position.needsUpdate = true; g.attributes.aSize.needsUpdate = true; g.attributes.aAlpha.needsUpdate = true; } };
      animated.push(anim);
      return { kind: spec.name, points: pts, position: p, remove() { unanimate(anim); dispose(pts); } };
    }
    const smoke = (pos, o) => puffs(pos, o, { name: 'smoke', count: 36, life: 3.2, size: 1.3, color: '#6a6e78', alpha: .42, r: .5, spread: .5, up: 1.1, wind: [.35, .1], grow: true });
    const steam = (pos, o) => puffs(pos, o, { name: 'steam', count: 24, life: 1.5, size: .8, color: '#e8eef8', alpha: .5, r: .3, spread: .6, up: 1.8, wind: [.2, 0], grow: true });
    const sparks = (pos, o) => puffs(pos, o, { name: 'sparks', count: 40, life: .6, size: .12, color: '#ffb347', alpha: 1, r: .1, spread: 4.5, up: 3.5, wind: [0, 0], gravity: 9.8, additive: true, burst: true, sw: false });
    const lightShaft = (pos, dir, o) => { const p = toV3(pos, new THREE.Vector3()), d = dir != null ? toV3(dir, new THREE.Vector3()) : new THREE.Vector3(0, -1, 0); o = o || {}; const m = cone(p, d, { color: o.color || '#ffe9b0', length: +o.length || 10, angle: +o.angle || .3, alpha: o.alpha != null ? +o.alpha : .22 }); const pl = o.pool !== false ? pool(p.x + d.x * (+o.length || 10), p.z + d.z * (+o.length || 10), Math.tan(+o.angle || .3) * (+o.length || 10) * 1.2, o.color || '#ffe9b0', .2) : null; return { kind: 'lightShaft', cone: m, remove() { dispose(m); dispose(pl); } }; };
    function skyline(o) {
      o = o || {}; const bd = scene.getObjectByName('backdrop');
      if (!bd || !bd.isInstancedMesh || !(bd.geometry && bd.geometry.type === 'BoxGeometry')) { warn('skyline: no skyline backdrop in this world (backdrop: "skyline")'); return { count: 0, remove: noop }; }
      const per = clamp(o.perBuilding | 0 || 12, 1, 60), pts = [], P3 = new THREE.Vector3(), S3 = new THREE.Vector3(), Q3 = new THREE.Quaternion();
      for (let i = 0; i < bd.count; i++) { bd.getMatrixAt(i, M); M.decompose(P3, Q3, S3); for (let k = 0; k < per; k++) { if (rand() > (o.density != null ? +o.density : .55)) continue; const face = rand() < .5 ? [.5 + .01, (rand() - .5) * .8] : [(rand() - .5) * .8, .5 + .01]; if (rand() < .5) { face[0] = -face[0]; face[1] = -face[1]; } V.set(face[0], .08 + rand() * .88, face[1]).applyMatrix4(M); pts.push(V.x, V.y, V.z); } }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      const w = mark(new THREE.Points(g, new THREE.PointsMaterial({ color: o.color || '#ffe9a8', size: (+o.size || 1.3) * K, sizeAttenuation: true, transparent: true, opacity: .9, depthWrite: false, fog: false }))); w.name = 'atmo:windows'; scene.add(w);
      return { count: pts.length / 3, points: w, remove() { dispose(w); } };
    }
    let vig = null;
    function vignette(strength, o) {
      o = o || {}; const s = clamp(strength == null ? .55 : +strength, 0, 1);
      if (!vig) { vig = document.createElement('div'); vig.id = 'yw-vignette'; Object.assign(vig.style, { position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: 1 }); (document.body || document.documentElement).appendChild(vig); }
      const col = o.color || '0,0,0'; vig.style.background = s <= 0 ? 'none' : 'radial-gradient(ellipse at center, rgba(' + col + ',0) ' + Math.round(70 - s * 30) + '%, rgba(' + col + ',' + (s * .85).toFixed(2) + ') 100%)';
      vig.style.display = s <= 0 ? 'none' : 'block';
      return { el: vig, strength: s, remove() { vig.style.display = 'none'; } };
    }

    // ── ambient occlusion of the API: everything lands on W ──
    W.lighting = { apply: apply, timeOfDay: timeOfDay, flood: flood, lamp: lamp, emissive: emissive, godRays: godRays, readability: readability, get current() { return current; }, presets: Object.keys(LP), data: LP, base: base, sw: SW };
    W.weather = { set: setWeather, get current() { return weather; }, kinds: Object.keys(WX).concat(['none']) };
    W.atmo = { puddles: puddles, wind: wind, smoke: smoke, steam: steam, sparks: sparks, lightShaft: lightShaft, skyline: skyline, vignette: vignette, cone: cone, pool: pool, glow: glowSprite, uTime: uTime };
  });
})();
