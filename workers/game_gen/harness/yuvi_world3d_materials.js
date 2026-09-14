/*
 * yuvi_world3d_materials.js — procedural MATERIALS plugin for YuviWorld3D.
 * Injected right after yuvi_world3d.js; registers through `YuviWorld3D.use`.
 *
 *   ctx.textures[name]                       the core's texture contract: (THREE, ctx) => {map, bumpMap?, bumpScale?, emissiveMap?, emissive?}
 *   W.textures.get(name, o) → THREE.Texture  o = {seed, size, colors:[hex…], repeat:[x,y], bump}
 *   W.textures.maps(name, o) → {map, bumpMap, bumpScale, emissiveMap, emissive}
 *   W.textures.set(name, factory | Texture | {map…} | {recipe, seed, colors, repeat, size}) / W.textures.names
 *   W.materials.make(preset, o) → Material    metal rust concrete wood brick glass hologram forcefield lava neon toon dissolve crystal water chrome (or any texture name)
 *   W.materials.apply(obj, preset|material, {recursive}) / W.materials.outline(mesh, {color, thickness}) → {meshes, remove}
 *   W.materials.ground(name | {texture, repeat, tint, blend:[name2, 'height'|'slope'], triplanar}) / W.materials.update(dt) / W.materials.time
 *
 * Every texture is a 2D canvas painted from seeded value-noise / fBm / Worley (no libraries, no
 * files), tileable, cached per world by (name, seed, size, colors) and generated lazily on first
 * use: hero surfaces 512², the rest 256²; everything 256² under a software renderer. Bump maps come
 * from the same height field. Shader presets are onBeforeCompile patches on Lambert / Phong /
 * Basic, so lights, fog, instancing and tone mapping keep working; `mat.userData.uniforms.time` is
 * shared and advanced by `W.update` (registered into ctx.animated). Nothing here throws: bad input
 * warns and falls back to a flat colour.
 */
(function () {
  if (!window.YuviWorld3D || typeof window.YuviWorld3D.use !== 'function') return;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rgb = h => { const s = String(h || '#ffffff').replace('#', ''), n = parseInt(s.length === 3 ? s.replace(/./g, c => c + c) : s, 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };
  const hashI = (x, y, s) => { let n = Math.imul(x, 374761393) + Math.imul(y, 668265263) + (s | 0); n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
  const wrap = (i, n) => ((i % n) + n) % n;
  const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  // tileable value noise: u, v in tile units [0,1), cx / cy integer cells across the tile (cells repeat, so every frequency tiles)
  function noise(u, v, cx, cy, s) {
    const x = u * cx, y = v * cy, xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const X0 = wrap(xi, cx), Y0 = wrap(yi, cy), X1 = (X0 + 1) % cx, Y1 = (Y0 + 1) % cy, a = xf * xf * (3 - 2 * xf), b = yf * yf * (3 - 2 * yf);
    const n00 = hashI(X0, Y0, s), n10 = hashI(X1, Y0, s), n01 = hashI(X0, Y1, s), n11 = hashI(X1, Y1, s);
    return (n00 + (n10 - n00) * a) * (1 - b) + (n01 + (n11 - n01) * a) * b;
  }

  // ── painter: one RGBA buffer + a height field + an optional emissive buffer, filled per pixel ──
  function painter(sz, s, mulberry32) {
    const n = sz * sz, col = new Uint8ClampedArray(n * 4), hgt = new Float32Array(n);
    for (let i = 3; i < col.length; i += 4) col[i] = 255;
    const P = { sz: sz, n: n, col: col, hgt: hgt, emi: null, post: null, r: mulberry32(s), s: s, f2: 0, cid: 0 };
    P.noise = (u, v, cx, cy, k) => noise(u, v, cx, cy, s + (k | 0) * 977);
    P.fbm = (u, v, cx, cy, oct, k) => { let sum = 0, amp = .5, tot = 0; const q = s + (k | 0) * 977; for (let o = 0; o < oct; o++) { sum += noise(u, v, cx, cy, q + o * 131) * amp; tot += amp; amp *= .5; cx *= 2; cy *= 2; } return sum / tot; };
    P.worley = (u, v, cx, cy, k) => {                 // f1 returned; P.f2 = second distance, P.cid = a per-cell random (cell units)
      const x = u * cx, y = v * cy, xi = Math.floor(x), yi = Math.floor(y), q = s + (k | 0) * 977; let f1 = 9, f2 = 9, id = 0;
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
        const gx = xi + i, gy = yi + j, wx = wrap(gx, cx), wy = wrap(gy, cy), dx = gx + hashI(wx, wy, q) - x, dy = gy + hashI(wx, wy, q + 77) - y, d = Math.sqrt(dx * dx + dy * dy);
        if (d < f1) { f2 = f1; f1 = d; id = hashI(wx, wy, q + 5); } else if (d < f2) f2 = d;
      }
      P.f2 = f2; P.cid = id; return f1;
    };
    P.each = fn => { for (let y = 0, i = 0; y < sz; y++) for (let x = 0; x < sz; x++, i++) fn(x / sz, y / sz, i, x, y); };
    P.set = (i, c, k) => { const j = i * 4; k = (k == null ? 1 : k) * 255; col[j] = c[0] * k; col[j + 1] = c[1] * k; col[j + 2] = c[2] * k; };
    P.lerp = (i, a, b, t, k) => { const j = i * 4; k = (k == null ? 1 : k) * 255; t = clamp(t, 0, 1); col[j] = (a[0] + (b[0] - a[0]) * t) * k; col[j + 1] = (a[1] + (b[1] - a[1]) * t) * k; col[j + 2] = (a[2] + (b[2] - a[2]) * t) * k; };
    P.emit = (i, c, k) => { if (!P.emi) { P.emi = new Uint8ClampedArray(n * 4); for (let q = 3; q < P.emi.length; q += 4) P.emi[q] = 255; } const j = i * 4; k = (k == null ? 1 : k) * 255; P.emi[j] = c[0] * k; P.emi[j + 1] = c[1] * k; P.emi[j + 2] = c[2] * k; };
    // tileable strokes on the finished canvas: each line is repeated across the edges it crosses. o = {len:[a,b], w, alpha, color, angle, spread}
    P.lines = (g, cnt, o) => {
      g.save(); g.lineWidth = o.w || 1; g.strokeStyle = o.color || '#fff'; g.globalAlpha = o.alpha == null ? .3 : o.alpha; g.lineCap = 'round'; g.beginPath();
      for (let k = 0; k < cnt; k++) {
        const x = P.r() * sz, y = P.r() * sz, L = o.len[0] + P.r() * (o.len[1] - o.len[0]), a = (o.angle || 0) + (P.r() - .5) * (o.spread || 0), dx = Math.cos(a) * L, dy = Math.sin(a) * L;
        const xs = [0], ys = [0]; if (Math.min(x, x + dx) < 0) xs.push(sz); if (Math.max(x, x + dx) > sz) xs.push(-sz); if (Math.min(y, y + dy) < 0) ys.push(sz); if (Math.max(y, y + dy) > sz) ys.push(-sz);
        for (let a1 = 0; a1 < xs.length; a1++) for (let b1 = 0; b1 < ys.length; b1++) { g.moveTo(x + xs[a1], y + ys[b1]); g.lineTo(x + xs[a1] + dx, y + ys[b1] + dy); }
      }
      g.stroke(); g.restore();
    };
    return P;
  }

  // ── recipes: {sz, bump, colors, paint(P, c, o)}. c = colours as [r,g,b] (overridable positionally with o.colors) ──
  const R = {};
  const speck = (P, i, amt) => (P.r() < .06 ? (P.r() - .5) * amt : 0);
  R.metal = { sz: 512, bump: .015, colors: ['#9aa3ad', '#ffffff'], paint(P, c) {
    P.each((u, v, i) => { const n = P.fbm(u, v, 4, 4, 4), val = .5 + .2 * (n - .5) + speck(P, i, .08); P.hgt[i] = val; P.set(i, c[0], val * 2); });
    P.post = g => { P.lines(g, 50, { len: [P.sz * .08, P.sz * .35], color: '#000', alpha: .25, angle: .3, spread: .7 }); P.lines(g, 50, { len: [P.sz * .08, P.sz * .35], color: '#fff', alpha: .35, angle: .3, spread: .7 }); }; } };
  R.metalDark = Object.assign({}, R.metal, { sz: 256, colors: ['#4b525b', '#ffffff'] });
  R.metalBrushed = { sz: 512, bump: 0, colors: ['#a9b2bb', '#ffffff'], paint(P, c) {
    P.each((u, v, i) => { const n = P.noise(u, v, 2, 200), val = .55 + .3 * (n - .5); P.hgt[i] = val; P.set(i, c[0], val * 1.8); });
    P.post = g => P.lines(g, 400, { len: [P.sz * .08, P.sz * .4], color: '#fff', alpha: .06, angle: 0, spread: .02 }); } };
  R.rust = { sz: 512, bump: .02, colors: ['#6b6f75', '#6b3a1e', '#a3542a'], paint(P, c) {
    const rc = [0, 0, 0];
    P.each((u, v, i) => { const n = P.fbm(u, v, 3, 3, 6), f1 = P.worley(u, v, 5, 5), m = sstep(.37, .58, n * (1 - f1 * .45)), drip = sstep(.55, .85, P.noise(u, v, 24, 2, 3)) * m;
      const base = .5 + .16 * (P.fbm(u, v, 6, 6, 3, 1) - .5) + speck(P, i, .1); P.hgt[i] = base - m * .3;
      if (m < .02) { P.set(i, c[0], base * 2); return; }
      const t = clamp(m + drip * .4 + (P.r() < .02 ? -.5 : 0), 0, 1), k = .7 + .6 * n;   // rust colour, then feathered into the metal at the mask edge
      rc[0] = (c[1][0] + (c[2][0] - c[1][0]) * t) * k; rc[1] = (c[1][1] + (c[2][1] - c[1][1]) * t) * k; rc[2] = (c[1][2] + (c[2][2] - c[1][2]) * t) * k;
      P.lerp(i, [c[0][0] * base * 2, c[0][1] * base * 2, c[0][2] * base * 2], rc, sstep(.02, .3, m), 1); }); } };
  R.concrete = { sz: 512, bump: .03, colors: ['#8d8b86'], paint(P, c) {
    P.each((u, v, i) => { const f1 = P.worley(u, v, 6, 6), crack = P.f2 - f1 < .02 && P.noise(u, v, 3, 3, 4) > .5 ? .07 : 0, pit = f1 < .03 ? .12 : 0, val = .5 + .12 * (P.fbm(u, v, 10, 10, 5) - .5) + speck(P, i, .08) - crack - pit; P.hgt[i] = val; P.set(i, c[0], val * 2); }); } };
  R.concreteDark = Object.assign({}, R.concrete, { sz: 256, colors: ['#5d5b58'] });
  const brick = (P, c, rows, cols) => P.each((u, v, i) => {
    const y = v * rows, row = Math.floor(y), fy = y - row, x = u * cols + (row & 1 ? .5 : 0), cI = Math.floor(x), fx = x - cI, mu = .045, mv = .09, grime = 1 - .1 * P.fbm(u, v, 3, 3, 3);
    if (fy < mv || fx < mu) { P.hgt[i] = 0; P.set(i, c[2], grime * (.9 + .1 * P.noise(u, v, 40, 40, 2))); return; }
    const j = hashI(wrap(cI, cols), row, P.s), e = sstep(0, .06, Math.min(fx - mu, 1 - fx, fy - mv, 1 - fy)), k = (.92 + .16 * j) * (.7 + .3 * e) * grime + speck(P, i, .06);
    P.hgt[i] = .6 + .4 * e; P.lerp(i, c[0], c[1], hashI(wrap(cI, cols), row, P.s + 9), k); });
  R.brick = { sz: 512, bump: .04, colors: ['#b0714f', '#9b5a3c', '#b7b1a5'], paint(P, c) { brick(P, c, 8, 4); } };
  R.brickRed = { sz: 512, bump: .04, colors: ['#8b2e22', '#a13a2c', '#c9c2b6'], paint(P, c) { brick(P, c, 8, 4); } };
  const wood = (P, c, i, u, v, off, k) => { const t = u * 6 + off + .5 * P.fbm(u, v, 2, 4, 3), g = Math.pow(.5 + .5 * Math.sin(t * 6.2832), 3), st = P.noise(u, v, 6, 80, 9); const val = clamp(.55 - .45 * g + .25 * (st - .5), 0, 1); P.hgt[i] = val; P.lerp(i, c[1], c[0], val, k); };
  R.wood = { sz: 512, bump: .02, colors: ['#8a5a2b', '#5a3819'], paint(P, c) { P.each((u, v, i) => wood(P, c, i, u, v, 0, 1)); } };
  R.woodDark = Object.assign({}, R.wood, { sz: 256, colors: ['#5c3a1c', '#2e1a0c'] });
  R.plank = { sz: 512, bump: .03, colors: ['#8a5a2b', '#5a3819', '#2a1a0c'], paint(P, c) {
    P.each((u, v, i) => { const pk = Math.floor(u * 4), fu = u * 4 - pk, j = hashI(pk, 0, P.s), end = hashI(pk, 1, P.s + 3);
      if (fu < .025 || Math.abs(v - end) < .008) { P.hgt[i] = 0; P.set(i, c[2], .9); return; } wood(P, c, i, u, v, j * 5, .8 + .35 * j); }); } };
  R.sand = { sz: 256, bump: .01, colors: ['#d9c48f', '#c2a86d'], paint(P, c) {
    P.each((u, v, i) => { const n = P.fbm(u, v, 24, 24, 3), rip = .5 + .5 * Math.sin(v * 62.83 + 2 * P.fbm(u, v, 4, 4, 2, 1)), t = .5 + (n - .5) * .8; P.hgt[i] = t * .7 + rip * .3; P.lerp(i, c[1], c[0], t * .75 + rip * .25, .93 + .07 * rip + speck(P, i, .06)); }); } };
  R.grass = { sz: 256, bump: 0, colors: ['#4f7d2c', '#6ea03a', '#8c8a3a'], paint(P, c, o) {
    P.each((u, v, i) => { const n = P.fbm(u, v, 5, 5, 3); P.hgt[i] = n; P.lerp(i, c[0], c[1], n, .9 + speck(P, i, .1)); });
    const cnt = Math.round(P.sz * P.sz / 22), hex = (o.colors || []).map(String);
    P.post = g => [0, 1, 2].forEach(k => P.lines(g, cnt / 3, { len: [P.sz * .006, P.sz * .016], color: hex[k] || ['#4f7d2c', '#6ea03a', '#8c8a3a'][k], alpha: .75, angle: -1.5708, spread: .5 })); } };
  R.dirt = { sz: 256, bump: .02, colors: ['#6b4e33', '#8a6a48', '#9a9080'], paint(P, c) {
    P.each((u, v, i) => { const n = P.fbm(u, v, 6, 6, 4), f1 = P.worley(u, v, 16, 16), peb = P.cid < .45 ? sstep(.17, .09, f1) : 0; P.hgt[i] = n * .6 + peb * .4;
      const k = .9 + speck(P, i, .12); P.lerp(i, c[0], c[1], n, k); if (peb > 0) { const j = i * 4, q = (.5 + .45 * P.cid) * 255; P.col[j] += (c[2][0] * q - P.col[j]) * peb; P.col[j + 1] += (c[2][1] * q - P.col[j + 1]) * peb; P.col[j + 2] += (c[2][2] * q - P.col[j + 2]) * peb; } }); } };
  R.gravel = { sz: 256, bump: .04, colors: ['#8e8a82', '#3d3a36'], paint(P, c) {
    P.each((u, v, i) => { const f1 = P.worley(u, v, 14, 14), st = clamp(1 - f1 * 1.6, 0, 1), t = sstep(.1, .35, st); P.hgt[i] = st; P.lerp(i, c[1], c[0], t, (.55 + .45 * P.cid) * (.7 + .3 * st) + speck(P, i, .08)); }); } };
  R.asphalt = { sz: 256, bump: .02, colors: ['#3a3b3e'], paint(P, c) {
    P.each((u, v, i) => { const f1 = P.worley(u, v, 4, 4), crack = P.f2 - f1 < .015 ? .1 : 0, val = .5 + .12 * (P.fbm(u, v, 12, 12, 3) - .5) + (P.r() < .15 ? .15 : 0) - crack; P.hgt[i] = val; P.set(i, c[0], val * 2); }); } };
  R.tile = { sz: 512, bump: .03, colors: ['#cfd3d6', '#2b2f36'], paint(P, c) {
    P.each((u, v, i) => { const x = u * 4, y = v * 4, cx = Math.floor(x), cy = Math.floor(y), fx = x - cx, fy = y - cy, gr = .03;
      if (fx < gr || fy < gr) { P.hgt[i] = 0; P.set(i, c[1], .9 + .2 * P.noise(u, v, 32, 32)); return; }
      const j = hashI(cx, cy, P.s), dirt = P.fbm(u, v, 8, 8, 3) * .12 * (1 - sstep(0, .25, Math.min(fx - gr, fy - gr, 1 - fx, 1 - fy))), hi = fx < .07 || fy < .07 ? .06 : 0;
      P.hgt[i] = 1; P.set(i, c[0], .94 + .12 * j - dirt + hi + speck(P, i, .04)); }); } };
  R.plaster = { sz: 256, bump: .015, colors: ['#e6dfd0'], paint(P, c) { P.each((u, v, i) => { const val = .82 + .1 * (P.fbm(u, v, 8, 8, 5) - .5) + speck(P, i, .05); P.hgt[i] = val; P.set(i, c[0], val * 1.15); }); } };
  const camo = (P, c) => P.each((u, v, i) => { const n = P.fbm(u, v, 5, 5, 4); P.hgt[i] = .5; P.set(i, n < .44 ? c[0] : n < .52 ? c[1] : n < .6 ? c[2] : c[3], .95 + speck(P, i, .06)); });
  R.camo = { sz: 256, bump: 0, colors: ['#4b5d3a', '#7a7048', '#2f3a2a', '#a49a76'], paint: camo };
  R.camoDesert = { sz: 256, bump: 0, colors: ['#c2a878', '#a08a5c', '#7d6a4a', '#d9c9a3'], paint: camo };
  // sci-fi panels: recursive rect subdivision, dark seams with a light rim, bolts, vent stripes; panelLit adds emissive strips along some edges
  function panels(P, c, lit) {
    const sz = P.sz, min = sz / 4, rects = [], stack = [[0, 0, sz, sz, 0]], sw = Math.max(1, Math.round(sz / 170));
    while (stack.length) {
      const q = stack.pop(), x = q[0], y = q[1], w = q[2], h = q[3], d = q[4];
      if ((w <= min && h <= min) || d >= 5 || (d >= 2 && P.r() < .3)) { rects.push(q); continue; }
      if (w >= h) { const s = Math.round(w * (.35 + P.r() * .3)); stack.push([x, y, s, h, d + 1], [x + s, y, w - s, h, d + 1]); } else { const s = Math.round(h * (.35 + P.r() * .3)); stack.push([x, y, w, s, d + 1], [x, y + s, w, h - s, d + 1]); }
    }
    P.each((u, v, i) => { P.hgt[i] = 1; P.set(i, c[0], .95 + .1 * (P.fbm(u, v, 6, 6, 3) - .5)); });
    rects.forEach(q => {
      const x = q[0], y = q[1], w = q[2], h = q[3], k = .92 + P.r() * .16, vent = P.r() < .15, bolt = [P.r() < .35, P.r() < .35, P.r() < .35, P.r() < .35], strip = lit && P.r() < .3 ? (P.r() < .5 ? c[2] : c[3]) : null;
      for (let py = y; py < y + h; py++) for (let px = x; px < x + w; px++) {
        const i = py * sz + px, e = Math.min(px - x, x + w - 1 - px, py - y, y + h - 1 - py); let kk = k;
        if (e < sw) { P.hgt[i] = 0; P.set(i, c[1], 1); continue; }
        if (e < sw * 2) { kk = k * 1.12; P.hgt[i] = .85; }
        const bx = px - x < w / 2 ? px - x : x + w - 1 - px, by = py - y < h / 2 ? py - y : y + h - 1 - py, corner = (px - x < w / 2 ? 0 : 1) + (py - y < h / 2 ? 0 : 2);
        if (bolt[corner] && Math.hypot(bx - sw * 3, by - sw * 3) < sw * 1.3) { kk = k * .6; P.hgt[i] = .5; }
        if (vent && by > h * .3 && by < h * .5 && bx > w * .25 && bx < w * .75 && (((py - y) / (sw * 2)) | 0) % 2) { kk = k * .55; P.hgt[i] = .4; }
        const j = i * 4; P.col[j] *= kk; P.col[j + 1] *= kk; P.col[j + 2] *= kk;
        if (strip && by >= sw * 3 && by < sw * 5 && bx > w * .2 && bx < w * .8 && py - y < h / 2) { P.emit(i, strip, 1); P.set(i, strip, .9); }
      }
    });
  }
  R.panel = { sz: 512, bump: .04, colors: ['#6d7480', '#20242a', '#22d3ee', '#fbbf24'], paint(P, c) { panels(P, c, false); } };
  R.panelLit = { sz: 512, bump: .04, colors: ['#6d7480', '#20242a', '#22d3ee', '#fbbf24'], paint(P, c) { panels(P, c, true); } };
  R.hazard = { sz: 512, bump: .02, colors: ['#f5c400', '#1a1a1a', '#8a8a8a'], paint(P, c) {
    P.each((u, v, i) => { const s = (u + v) * 4 % 1 < .5, wear = .8 + .2 * P.fbm(u, v, 6, 6, 3), chip = P.worley(u, v, 10, 10) < .07; P.hgt[i] = chip ? .6 : 1; P.set(i, chip ? c[2] : s ? c[0] : c[1], chip ? .9 : wear + speck(P, i, .06)); }); } };
  R.grid = { sz: 256, bump: 0, colors: ['#3d4350', '#8a93a6', '#c9d1e0'], paint(P, c) {
    const cell = P.sz / 8, big = P.sz / 2;
    P.each((u, v, i, x, y) => { const lx = x % cell, ly = y % cell, major = x % big < 3 || y % big < 3; P.hgt[i] = .5; P.set(i, major ? c[2] : lx < 2 || ly < 2 ? c[1] : c[0], .95 + .1 * (P.fbm(u, v, 4, 4, 2) - .5)); }); } };
  R.fabric = { sz: 256, bump: .01, colors: ['#5b6b8c'], paint(P, c) { P.each((u, v, i) => { const w = Math.sin(u * 301.6) * Math.sin(v * 301.6), val = .8 + .15 * w + .1 * (P.fbm(u, v, 6, 6, 3) - .5); P.hgt[i] = .5 + .5 * w; P.set(i, c[0], val * 1.2); }); } };
  R.leather = { sz: 256, bump: .02, colors: ['#6b3f2a', '#8a5638'], paint(P, c) { P.each((u, v, i) => { const f1 = P.worley(u, v, 20, 20), crease = 1 - sstep(.02, .09, P.f2 - f1), n = P.fbm(u, v, 6, 6, 3); P.hgt[i] = 1 - crease; P.lerp(i, c[0], c[1], n, (1 - crease * .4) * (.9 + .3 * (n - .5))); }); } };
  R.bark = { sz: 256, bump: .05, colors: ['#5a4030', '#8a6a4a'], paint(P, c) { P.each((u, v, i) => { const n = Math.pow(P.fbm(u, v, 3, 20, 4), 1.4), f1 = P.worley(u, v, 10, 2), crack = 1 - sstep(.03, .12, P.f2 - f1); P.hgt[i] = n * (1 - crack); P.lerp(i, c[0], c[1], n, (1 - crack * .5) * (.9 + speck(P, i, .1))); }); } };
  R.leaves = { sz: 256, bump: .02, colors: ['#4a7a2a', '#7fb040', '#2f4f1f'], paint(P, c) { P.each((u, v, i) => { const f1 = P.worley(u, v, 8, 8), id = P.cid, blob = sstep(.6, .35, f1), vein = P.f2 - f1 < .05 ? .25 : 0; P.hgt[i] = blob; P.lerp(i, c[2], id < .5 ? c[0] : c[1], blob * (1 - vein), .9 + .2 * (P.fbm(u, v, 6, 6, 2) - .5)); }); } };
  R.snow = { sz: 256, bump: .01, colors: ['#f4f8ff', '#c9d8ee'], paint(P, c) { P.each((u, v, i) => { const n = P.fbm(u, v, 6, 6, 4), sp = P.r() < .01; P.hgt[i] = n; P.lerp(i, c[1], c[0], sp ? 1 : .3 + .7 * n, sp ? 1.1 : 1); }); } };
  R.lava = { sz: 256, bump: .04, colors: ['#1a0805', '#3a1a10', '#ff6a1a', '#fff0a0'], paint(P, c) {
    P.each((u, v, i) => { const f1 = P.worley(u, v, 6, 6), cr = 1 - sstep(.02, .1, P.f2 - f1), heat = P.fbm(u, v, 4, 4, 3); P.hgt[i] = 1 - cr; const g = cr * (.6 + .4 * heat);
      if (g > .05) { P.lerp(i, c[2], c[3], sstep(.6, .95, g), g); P.emit(i, c[2], g); if (g > .75) P.emit(i, c[3], 1); } else P.lerp(i, c[0], c[1], heat, 1 + speck(P, i, .1)); }); } };
  R.water = { sz: 256, bump: 0, colors: ['#2a6fa8', '#8fd4ff'], paint(P, c) { P.each((u, v, i) => { const n = P.fbm(u, v, 4, 4, 3), f1 = P.worley(u, v, 8, 8), ca = 1 - sstep(0, .1, P.f2 - f1); P.hgt[i] = n; P.lerp(i, c[0], c[1], n * .5 + ca * .7, 1); }); } };
  R.scales = { sz: 256, bump: .03, colors: ['#3f8f6a', '#163f2e'], paint(P, c) {
    P.each((u, v, i) => { const yv = v * 8, row = Math.floor(yv), fy = yv - row, xu = u * 8 + (row & 1 ? .5 : 0), fx = xu - Math.floor(xu), d = Math.sqrt((fx - .5) * (fx - .5) + fy * fy), sh = clamp(1.15 - 1.5 * d, 0, 1);
      P.hgt[i] = sh; P.lerp(i, c[1], c[0], sh, .85 + .3 * (P.fbm(u, v, 4, 4, 2) - .5)); }); } };
  R.canvas = { sz: 256, bump: .01, colors: ['#c9bfa5', '#8a7f68'], paint(P, c) { P.each((u, v, i) => { const w = Math.sin(u * 150.8) * Math.sin(v * 150.8), st = P.fbm(u, v, 3, 3, 3), seam = u * 2 % 1 < .012 ? .8 : 1; P.hgt[i] = .5 + .5 * w; P.lerp(i, c[1], c[0], .6 + .4 * st, (.86 + .12 * w) * seam); }); } };
  const CONTRACT = Object.keys(R);

  // ── GLSL shared by the shader presets (onBeforeCompile on Lambert / Phong / Basic keeps lights, fog, instancing, tone mapping) ──
  const VARY = 'varying vec3 vYwPos; varying vec3 vYwNrm; varying vec3 vYwLoc; varying float vYwMask;\n';
  const V_BODY = 'vYwLoc = transformed; vec4 ywP = vec4(transformed, 1.0); vec3 ywN = objectNormal;\n#ifdef USE_INSTANCING\nywP = instanceMatrix * ywP; ywN = mat3(instanceMatrix) * ywN;\n#endif\nvYwPos = (modelMatrix * ywP).xyz; vYwNrm = normalize(mat3(modelMatrix) * ywN);\n';
  const V_BODY_NN = 'vYwLoc = transformed; vec4 ywP = vec4(transformed, 1.0);\n#ifdef USE_INSTANCING\nywP = instanceMatrix * ywP;\n#endif\nvYwPos = (modelMatrix * ywP).xyz; vYwNrm = vec3(0.0, 1.0, 0.0);\n';
  const NOISE = 'float ywHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\n' +
    'float ywNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(ywHash(i), ywHash(i + vec2(1.0, 0.0)), f.x), mix(ywHash(i + vec2(0.0, 1.0)), ywHash(i + vec2(1.0, 1.0)), f.x), f.y); }\n' +
    'float ywFbm(vec2 p) { return (ywNoise(p) * 0.5 + ywNoise(p * 2.03 + 7.1) * 0.25 + ywNoise(p * 4.07 + 3.3) * 0.125) / 0.875; }\n';
  const FRES = 'vec3 ywV = normalize(cameraPosition - vYwPos); vec3 ywN = normalize(vYwNrm); if (!gl_FrontFacing) ywN = -ywN; float ywNdV = clamp(dot(ywN, ywV), 0.0, 1.0);\n';
  const FOG_MUL = '#ifdef USE_FOG\n#ifdef FOG_EXP2\nfloat fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );\n#else\nfloat fogFactor = smoothstep( fogNear, fogFar, vFogDepth );\n#endif\ngl_FragColor.rgb *= 1.0 - fogFactor;\n#endif\n';
  const TRI = 'vec4 ywTri(sampler2D t, float s) { vec3 b = abs(normalize(vYwNrm)); b = pow(b, vec3(4.0)); b /= (b.x + b.y + b.z); return texture2D(t, vYwPos.yz * s) * b.x + texture2D(t, vYwPos.xz * s) * b.y + texture2D(t, vYwPos.xy * s) * b.z; }\n';
  const glslType = v => v && v.isColor ? 'vec3' : v && v.isVector4 ? 'vec4' : v && v.isVector3 ? 'vec3' : v && v.isVector2 ? 'vec2' : v && v.isTexture ? 'sampler2D' : 'float';
  const uName = k => 'u' + k[0].toUpperCase() + k.slice(1);

  YuviWorld3D.use(function materials(W, THREE, ctx) {
    const warn = ctx.warn, renderer = ctx.renderer, size = ctx.size, mulberry32 = ctx.mulberry32, seedNum = ctx.seedNum, worldSeed = ctx.opts.seed == null ? 7 : ctx.opts.seed;
    let sw = false, aniso = 1;
    try { const gl = renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info'); sw = /swiftshader|llvmpipe|softpipe|software/i.test(ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : ''); aniso = sw ? 1 : renderer.capabilities.getMaxAnisotropy(); } catch (e) {}
    const TIME = { value: 0 };
    ctx.animated.push({ update(dt) { TIME.value += +dt || 0; } });

    // ── textures: lazy, cached per (name, seed, size, colors); textures per (+repeat) ──
    const canvases = {}, mapsCache = {}, alias = {}, custom = {}, stats = { generated: 0, ms: 0 };
    const mkCanvas = sz => { const c = document.createElement('canvas'); c.width = c.height = sz; return c; };
    const toCanvas = (buf, sz) => { const c = mkCanvas(sz), g = c.getContext('2d', { willReadFrequently: true }), img = g.createImageData(sz, sz); img.data.set(buf); g.putImageData(img, 0, 0); return { c: c, g: g }; };
    const tex = (canvas, srgb, rep) => { const t = new THREE.CanvasTexture(canvas); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = aniso; t.repeat.set(rep[0], rep[1]); return t; };
    const repOf = o => { const r = o && o.repeat; return Array.isArray(r) ? [+r[0] || 1, +r[1] || +r[0] || 1] : r > 0 ? [+r, +r] : [1, 1]; };
    const sizeOf = (rc, o) => { const s = o && +o.size; return s === 128 || s === 256 || s === 512 || s === 1024 ? s : sw ? 256 : rc.sz; };
    function paint(name, o) {                            // → {c: colour canvas, b: bump canvas|null, e: emissive canvas|null, bump}
      const rc = R[name], sz = sizeOf(rc, o), t0 = performance.now(), P = painter(sz, seedNum((o.seed == null ? worldSeed : o.seed) + ':' + name), mulberry32);
      const c = rc.colors.map((h, i) => rgb((o.colors && o.colors[i]) || h));
      rc.paint(P, c, o);
      const out = { c: null, b: null, e: null, bump: o.bump != null ? +o.bump : rc.bump, sz: sz }, cv = toCanvas(P.col, sz); out.c = cv.c; if (P.post) P.post(cv.g);
      if (out.bump > 0) { const d = new Uint8ClampedArray(P.n * 4); for (let i = 0, j = 0; i < P.n; i++, j += 4) { d[j] = d[j + 1] = d[j + 2] = P.hgt[i] * 255; d[j + 3] = 255; } out.b = toCanvas(d, sz).c; }
      if (P.emi) out.e = toCanvas(P.emi, sz).c;
      stats.generated++; stats.ms += performance.now() - t0; return out;
    }
    function maps(name, o) {
      o = o || {};
      if (custom[name]) return custom[name];
      if (alias[name]) return maps(alias[name].recipe, Object.assign({}, alias[name], o));
      if (!R[name]) { warn('textures: unknown texture "' + name + '" — names: ' + names().join(', ')); return null; }
      const k1 = name + '|' + (o.seed == null ? worldSeed : o.seed) + '|' + sizeOf(R[name], o) + '|' + (o.colors || []).join(',') + '|' + (o.bump == null ? '' : o.bump), rep = repOf(o), k2 = k1 + '|' + rep.join('x');
      if (mapsCache[k2]) return mapsCache[k2];
      const cv = canvases[k1] || (canvases[k1] = paint(name, o));
      const m = { map: tex(cv.c, true, rep) };
      if (cv.b) { m.bumpMap = tex(cv.b, false, rep); m.bumpScale = cv.bump; }
      if (cv.e) { m.emissiveMap = tex(cv.e, true, rep); m.emissive = '#ffffff'; }
      return (mapsCache[k2] = m);
    }
    const names = () => CONTRACT.concat(Object.keys(alias), Object.keys(custom));
    function set(name, src) {
      if (!name || !src) { warn('textures.set(name, factory | Texture | {map} | {recipe, seed, colors, repeat})'); return; }
      delete custom[name]; delete alias[name];
      if (typeof src === 'function') ctx.textures[name] = src;
      else if (src.isTexture) { custom[name] = { map: src }; ctx.textures[name] = () => custom[name]; }
      else if (src.map) { custom[name] = src; ctx.textures[name] = () => src; }
      else if (src.recipe && R[src.recipe]) { alias[name] = src; ctx.textures[name] = () => maps(name); }
      else warn('textures.set("' + name + '"): pass a factory, a Texture, {map…} or {recipe: "' + CONTRACT[0] + '"…}');
    }
    CONTRACT.forEach(n => { ctx.textures[n] = () => maps(n); });   // the core's texFor / matFor / texOf path (props.scatter({texture}), parts with t:)
    W.textures = { get: (name, o) => { const m = maps(name, o); return m ? m.map : null; }, maps: maps, set: set, get names() { return names(); }, stats: stats, recipes: CONTRACT };

    // ── shader patching: uniforms {name: {value}} become uName; snippets land after <project_vertex>, <map_fragment>, <opaque_fragment> ──
    function patch(mat, key, spec) {
      const U = spec.uniforms || {}; U.time = TIME;
      const decl = Object.keys(U).map(k => 'uniform ' + (Array.isArray(U[k].value) ? glslType(U[k].value[0]) + ' ' + uName(k) + '[' + U[k].value.length + ']' : glslType(U[k].value) + ' ' + uName(k)) + ';').join(' ') + '\n';
      mat.onBeforeCompile = sh => {
        for (const k in U) sh.uniforms[uName(k)] = U[k];
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + VARY + decl)
          .replace('#include <project_vertex>', (spec.vpre || '') + '\n#include <project_vertex>\n' + (spec.normals === false ? V_BODY_NN : V_BODY));
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + VARY + decl + NOISE + (spec.fhead || ''))
          .replace('#include <map_fragment>', spec.mapReplace ? spec.mapReplace : '#include <map_fragment>\n' + (spec.map || ''))
          .replace('#include <opaque_fragment>', '#include <opaque_fragment>\n' + (spec.frag || ''));
        if (spec.additive) sh.fragmentShader = sh.fragmentShader.replace('#include <fog_fragment>', FOG_MUL);
      };
      mat.customProgramCacheKey = () => 'yw-' + key;
      mat.userData.uniforms = U; mat.userData.preset = key; mat.needsUpdate = true;
      return mat;
    }
    const col = (h, d) => new THREE.Color(h || d);
    const sideOf = o => o.side === 'double' || o.side === THREE.DoubleSide ? THREE.DoubleSide : o.side === 'back' || o.side === THREE.BackSide ? THREE.BackSide : THREE.FrontSide;
    const texOpts = o => ({ seed: o.seed, size: o.size, colors: o.colors, repeat: o.repeat, bump: o.bump });
    const mapsOf = (name, o) => {                         // o.texture: name | Texture | false; name: the preset's default
      const t = o.texture === false ? null : (o.texture || name); if (!t) return {};
      if (t.isTexture) return { map: t };
      const m = maps(t, texOpts(o)); if (!m) return {};
      const r = { map: m.map }; if (m.bumpMap) { r.bumpMap = m.bumpMap; r.bumpScale = m.bumpScale; } if (m.emissiveMap) { r.emissiveMap = m.emissiveMap; r.emissive = new THREE.Color(m.emissive); } return r;
    };
    const common = o => { const r = { side: sideOf(o) }; if (o.opacity != null && +o.opacity < 1) { r.transparent = true; r.opacity = +o.opacity; } if (o.flat) r.flatShading = true; if (o.emissive) r.emissive = new THREE.Color(o.emissive); return r; };
    const lambert = (o, hex, texName) => new THREE.MeshLambertMaterial(Object.assign({ color: col(o.color, hex) }, mapsOf(texName, o), common(o)));
    const phong = (o, hex, texName, x) => new THREE.MeshPhongMaterial(Object.assign({ color: col(o.color, hex) }, x, mapsOf(texName, o), common(o)));
    const ramps = {};
    const ramp = n => { n = clamp(n | 0 || 3, 2, 6); if (ramps[n]) return ramps[n]; const d = new Uint8Array(n); for (let i = 0; i < n; i++) d[i] = Math.round(70 + 185 * i / (n - 1)); const t = new THREE.DataTexture(d, n, 1, THREE.RedFormat); t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true; return (ramps[n] = t); };
    const P = ctx.P;
    const PRESETS = {
      metal: o => phong(o, '#b9c1c9', 'metal', { specular: col(o.specular, '#8c96a0'), shininess: o.shininess != null ? +o.shininess : 60 }),
      rust: o => lambert(o, '#ffffff', 'rust'),
      concrete: o => lambert(o, '#ffffff', 'concrete'),
      wood: o => lambert(o, '#ffffff', 'wood'),
      brick: o => lambert(o, '#ffffff', 'brick'),
      glass: o => { const m = phong(Object.assign({ opacity: .3 }, o), '#bfe3ff', null, { specular: col(null, '#ffffff'), shininess: 90, depthWrite: false }); m.transparent = true;
        return patch(m, 'glass', { uniforms: { opacity: { value: o.opacity != null ? +o.opacity : .3 }, rim: { value: col(o.rim, '#ffffff') } },
          frag: FRES + 'float ywF = pow(1.0 - ywNdV, 3.0); gl_FragColor.a = clamp(uOpacity + ywF * 0.7, 0.0, 1.0); gl_FragColor.rgb += uRim * ywF * 0.6;' }); },
      hologram: o => patch(new THREE.MeshLambertMaterial({ color: '#000000', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }), 'hologram', {
        uniforms: { color: { value: col(o.color, '#22d3ee') }, intensity: { value: o.intensity != null ? +o.intensity : 1 }, lines: { value: +o.lines || 20 } }, additive: true,
        vpre: 'float ywG = sin(uTime * 3.45 + transformed.y * 4.0) * sin(uTime * 8.76 + transformed.y * 2.0); if (ywG > 0.92) transformed.x += 0.03 * sin(uTime * 40.0 + transformed.y * 30.0);',
        frag: FRES + 'float ywF = pow(1.0 - ywNdV, 2.0); float ywS = pow(fract((vYwPos.y - uTime * 0.15) * uLines), 3.0); float ywA = (ywS * 0.35 + ywF) * smoothstep(0.8, 0.0, ywF) + 0.1; gl_FragColor = vec4(uColor * ywA * uIntensity, ywA);' }),
      forcefield: o => { const hit = [0, 1, 2, 3].map(() => new THREE.Vector4(0, 0, 0, -1e4)); let slot = 0;
        const m = patch(new THREE.MeshLambertMaterial({ color: '#000000', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }), 'forcefield', {
          uniforms: { color: { value: col(o.color, '#4fc3ff') }, intensity: { value: o.intensity != null ? +o.intensity : 1 }, scale: { value: +o.scale || 12 }, hit: { value: hit } }, additive: true,
          frag: FRES + 'float ywF = pow(1.0 - ywNdV, 3.0); float ywHex = step(0.92, max(abs(sin(vYwPos.x * uScale)), abs(sin(vYwPos.z * uScale + vYwPos.y * uScale * 0.5)))); float ywR = 0.0;' +
            'for (int i = 0; i < 4; i++) { float t = uTime - uHit[i].w; float d = distance(vYwPos, uHit[i].xyz); ywR += (1.0 - smoothstep(0.0, 0.8, abs(d - t * 4.0))) * exp(-t * 3.0) * step(0.0, t); }' +
            'float ywA = (0.12 * ywF + 0.25 * ywHex * ywF + 0.05 * ywHex + ywR * 0.8) * (0.85 + 0.15 * sin(uTime * 2.5)); gl_FragColor = vec4(uColor * ywA * uIntensity, ywA);' });
        m.userData.hit = p => { const v = ctx.toV3(p, ctx.V); hit[slot++ % 4].set(v.x, v.y, v.z, TIME.value); }; return m; },
      lava: o => patch(new THREE.MeshLambertMaterial({ color: col(o.color, '#1a0805'), side: sideOf(o) }), 'lava', {
        uniforms: { glow: { value: col(o.glow, '#ff5a10') }, hot: { value: col(o.hot, '#fff0a0') }, intensity: { value: o.intensity != null ? +o.intensity : 1 }, scale: { value: +o.scale || 1.5 }, speed: { value: o.speed != null ? +o.speed : .15 } },
        frag: 'vec2 ywFl = vec2(sin(vYwPos.z * 0.7), cos(vYwPos.x * 0.5)) * 0.3; float ywT1 = fract(uTime * uSpeed), ywT2 = fract(uTime * uSpeed + 0.5); vec2 ywQ = vYwPos.xz * uScale + vYwPos.y * 0.5;' +
          'float ywNv = mix(ywFbm(ywQ + ywFl * ywT1), ywFbm(ywQ + ywFl * ywT2), abs(ywT1 * 2.0 - 1.0)); gl_FragColor.rgb += (mix(vec3(0.0), uGlow, smoothstep(0.35, 0.7, ywNv)) + uHot * smoothstep(0.72, 0.85, ywNv) * 2.0) * uIntensity;' }),
      neon: o => patch(new THREE.MeshBasicMaterial({ color: col(o.color, '#ff4fd8').multiplyScalar(o.intensity != null ? +o.intensity : 1.6), toneMapped: false, side: sideOf(o) }), 'neon', {
        normals: false, uniforms: { pulse: { value: o.pulse != null ? +o.pulse : .3 }, rate: { value: +o.rate || 3 } }, frag: 'gl_FragColor.rgb *= 1.0 + uPulse * 0.5 * (1.0 + sin(uTime * uRate));' }),
      toon: o => new THREE.MeshToonMaterial(Object.assign({ color: col(o.color, '#ff8844'), gradientMap: ramp(o.steps) }, o.texture ? mapsOf(null, o) : {}, common(o))),
      dissolve: o => patch(new THREE.MeshLambertMaterial(Object.assign({ color: col(o.color, '#9aa3ad'), side: THREE.DoubleSide }, o.texture ? mapsOf(null, o) : {})), 'dissolve', {
        uniforms: { progress: { value: clamp(+o.progress || 0, 0, 1) }, edge: { value: col(o.edge, '#ffb347') }, width: { value: +o.width || .08 }, scale: { value: +o.scale || 3 } },
        map: 'float ywDe = ywFbm(vYwLoc.xz * uScale + vYwLoc.y * uScale * 0.7) - uProgress; if (ywDe < 0.0) discard;',
        frag: 'gl_FragColor.rgb += uEdge * (1.0 - smoothstep(0.0, uWidth, ywDe)) * 3.0 * step(0.001, uProgress);' }),
      crystal: o => patch(phong(Object.assign({ opacity: .85, flat: true }, o), '#8be9fd', null, { specular: col(null, '#ffffff'), shininess: 80 }), 'crystal', {
        uniforms: { color: { value: col(o.glow || o.color, '#8be9fd') }, intensity: { value: o.intensity != null ? +o.intensity : 1 } },
        frag: FRES + 'float ywF = pow(1.0 - ywNdV, 2.0); gl_FragColor.rgb += uColor * (ywF * 0.9 + 0.12 * (0.5 + 0.5 * sin(uTime * 2.0 + vYwPos.y * 3.0))) * uIntensity;' }),
      water: o => patch(phong(Object.assign({ opacity: .78 }, o), '#2a6fa8', null, { specular: col(null, '#ffffff'), shininess: 70, depthWrite: false }), 'water', {
        uniforms: { color: { value: col(o.highlight, '#8fd4ff') }, speed: { value: o.speed != null ? +o.speed : 1 }, scale: { value: +o.scale || .35 } },
        frag: FRES + 'float ywF = pow(1.0 - ywNdV, 3.0); vec2 ywQ = vYwPos.xz * uScale; float ywNv = ywFbm(ywQ + vec2(uTime * 0.06, uTime * 0.04) * uSpeed) * ywFbm(ywQ * 1.4 - vec2(uTime * 0.05, uTime * 0.03) * uSpeed);' +
          'gl_FragColor.rgb += uColor * (smoothstep(0.16, 0.3, ywNv) * 0.55 + ywF * 0.35); gl_FragColor.a = clamp(gl_FragColor.a + ywF * 0.2, 0.0, 1.0);' }),
      chrome: o => patch(phong(o, '#e0e5ea', null, { specular: col(null, '#ffffff'), shininess: 120 }), 'chrome', {
        uniforms: { sky: { value: col(o.sky, P.sky[1]) }, ground: { value: col(o.ground, P.ground[0]) }, mix: { value: o.mix != null ? +o.mix : .6 } },
        frag: FRES + 'vec3 ywR = reflect(-ywV, ywN); vec3 ywEnv = mix(uGround, uSky, smoothstep(-0.25, 0.55, ywR.y)) + vec3(1.0) * pow(max(ywR.y, 0.0), 6.0) * 0.35; gl_FragColor.rgb = mix(gl_FragColor.rgb, ywEnv * (0.7 + 0.5 * pow(1.0 - ywNdV, 2.0)), uMix);' })
    };
    function make(preset, o) {
      o = o || {};
      if (typeof preset !== 'string') { warn('materials.make(preset, o): presets ' + Object.keys(PRESETS).join(' ') + ' or a texture name'); return new THREE.MeshLambertMaterial({ color: col(o.color, '#ff00ff') }); }
      try {
        if (PRESETS[preset]) return PRESETS[preset](o);
        if (R[preset] || alias[preset] || custom[preset]) return lambert(o, '#ffffff', preset);
      } catch (e) { warn('materials.make("' + preset + '"): ' + (e && e.message)); return new THREE.MeshLambertMaterial({ color: col(o.color, '#ff00ff') }); }
      warn('materials.make: unknown preset "' + preset + '" — presets: ' + Object.keys(PRESETS).join(', ') + '; textures: ' + names().join(', '));
      return new THREE.MeshLambertMaterial(Object.assign({ color: col(o.color, '#ff00ff') }, common(o)));
    }
    function apply(obj, m, o) {
      o = o || {};
      if (!obj || !obj.isObject3D) { warn('materials.apply(object3d, preset | material, {recursive})'); return null; }
      const mat = typeof m === 'string' ? make(m, o) : (m && m.isMaterial ? m : null);
      if (!mat) { warn('materials.apply: pass a preset name or a THREE.Material'); return null; }
      const one = n => { if ((n.isMesh || n.isInstancedMesh) && !n.userData.ywOutline) n.material = mat; };
      if (o.recursive === false) one(obj); else obj.traverse(one);
      return mat;
    }
    // ── outline: inverted hull (BackSide, pushed along the normal) as a child of every mesh ──
    const outlineMats = {};
    function outline(mesh, o) {
      o = o || {};
      if (!mesh || !mesh.isObject3D) { warn('materials.outline(mesh | group, {color, thickness})'); return { meshes: [], remove: () => {} }; }
      const th = +o.thickness || .025, hex = String(o.color || '#0b0d12'), k = hex + '|' + th;
      const mat = outlineMats[k] || (outlineMats[k] = (() => { const m = new THREE.MeshBasicMaterial({ color: hex, side: THREE.BackSide, fog: !!o.fog });
        m.onBeforeCompile = sh => { sh.uniforms.uThick = { value: th }; sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uThick;').replace('#include <begin_vertex>', 'vec3 transformed = position + normal * uThick;'); };
        m.customProgramCacheKey = () => 'yw-outline'; return m; })());
      const made = [];
      const one = m => { if (!m.geometry || m.userData.ywOutline) return; let h;
        if (m.isInstancedMesh) { h = new THREE.InstancedMesh(m.geometry, mat, m.count); h.instanceMatrix = m.instanceMatrix; h.count = m.count; h.frustumCulled = m.frustumCulled; } else h = new THREE.Mesh(m.geometry, mat);
        h.userData.ywOutline = true; h.userData.noRay = true; h.renderOrder = -1; h.name = 'outline'; m.add(h); made.push(h); };
      if (o.recursive === false) one(mesh); else mesh.traverse(n => { if (n.isMesh) one(n); });
      return { meshes: made, remove() { made.forEach(h => { if (h.parent) h.parent.remove(h); }); made.length = 0; } };
    }
    // ── ground: re-texture the terrain; optional second texture by height / slope (vertex mask) and triplanar sampling for steep slopes ──
    function ground(spec) {
      const g = W.ground; if (!g || !g.material) { warn('materials.ground: no terrain in this world'); return null; }
      const o = typeof spec === 'string' ? { texture: spec } : (spec || {}), name = o.texture || o.name;
      const rep = o.repeat != null ? repOf(o) : [size / 4, size / 4], T = name ? maps(name, { repeat: rep, seed: o.seed, colors: o.colors, size: o.size }) : null;
      if (!T) { if (name) warn('materials.ground: unknown texture "' + name + '"'); else warn('materials.ground(name | {texture, repeat, tint, blend, triplanar})'); return null; }
      const mat = new THREE.MeshLambertMaterial({ color: o.tint || '#ffffff', map: T.map, bumpMap: T.bumpMap || null, bumpScale: T.bumpScale || 0, vertexColors: !!o.vertexColors });
      const b = o.blend ? (Array.isArray(o.blend) ? { texture: o.blend[0], mask: o.blend[1] } : o.blend) : null, T2 = b && b.texture ? maps(b.texture, { repeat: rep, seed: o.seed }) : null;
      if (b && !T2) warn('materials.ground: blend texture "' + b.texture + '" unknown — single texture used');
      const tri = !!o.triplanar, U = {}, A = ctx.W.terrain || {}, amp = Math.max(.5, (A.amp || 3) * (A.hills || .3) * 2);
      let key = 'ground', vpre = 'vYwMask = 0.0;', sample = (t, s) => tri ? 'ywTri(' + t + ', uTri * ' + s + ')' : 'texture2D(' + t + ', vMapUv * ' + s + ')';
      if (tri) { key += '-tri'; U.tri = { value: rep[0] / size }; }
      if (T2) {
        const slope = b.mask !== 'height'; key += slope ? '-slope' : '-height';
        U.map2 = { value: T2.map }; U.rep2 = { value: (+b.repeat || rep[0]) / rep[0] }; U.lo = { value: b.lo != null ? +b.lo : slope ? .8 : amp * .15 }; U.hi = { value: b.hi != null ? +b.hi : slope ? .95 : amp * .7 };
        vpre = slope ? 'vYwMask = 1.0 - smoothstep(uLo, uHi, objectNormal.y);' : 'vYwMask = smoothstep(uLo, uHi, transformed.y);';
      }
      patch(mat, key, { uniforms: U, vpre: vpre, fhead: tri ? TRI : '', mapReplace: '#ifdef USE_MAP\nvec4 ywA = ' + sample('map', '1.0') + ';\n' + (T2 ? 'vec4 ywB = ' + sample('uMap2', 'uRep2') + '; ywA = mix(ywA, ywB, vYwMask);\n' : '') + 'diffuseColor *= ywA;\n#endif\n' });
      if (g.material.dispose && g.material !== mat) g.material.dispose();
      g.material = mat; return mat;
    }
    W.materials = { make: make, apply: apply, outline: outline, ground: ground, update(dt) { TIME.value += +dt || 0; }, get time() { return TIME.value; }, presets: Object.keys(PRESETS), patch: patch };
  });
})();
