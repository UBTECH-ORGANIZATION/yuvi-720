/*
 * yuvi_world3d_props.js — the PROP LIBRARY plugin for YuviWorld3D: ~100 themed
 * prop kinds (industrial, urban, nature, sci-fi, medieval, interior) with named variants,
 * built from the core's primitive-part format so every kind instances for free
 * through W.props.scatter / place / make, plus themed compound layouts.
 *
 *   W.props.set('industrial')                    → the kinds of a set
 *   W.props.library                              → {set: [kinds]}
 *   W.props.layouts                              → ['industrialNight', 'harbour', 'village', 'scifiBase', 'ruins', 'city', 'house', 'classroom']
 *   W.props.layout('industrialNight', {seed, radius, density, edge, landmark})
 *       → {sets, positions, landmark, path, remove()} — same shape as W.decorate(); use it INSTEAD of decorate for a themed compound
 *   W.props.layout('house', {rooms, giant})           → an interior: walls, doorway, windows, furniture; giant ×6–×10 for a tiny hero (a 'classroom' too)
 *
 * Classic script injected after yuvi_world3d_materials.js. Deterministic (the
 * world's seeded rand or `o.seed`), no assets, no imports. Part textures name
 * the materials plugin's contract; a missing name falls back to flat colour.
 */
(function () {
  if (!window.YuviWorld3D || typeof window.YuviWorld3D.use !== 'function') { try { console.warn('[YuviWorld3D:props] YuviWorld3D missing — props plugin not registered'); } catch (e) {} return; }
  const R90 = Math.PI / 2, R45 = Math.PI / 4;
  // ── intrinsic material colours (palette roles 0 ground · 1 stone · 2 foliage/accent · 3 light · 4 dark/wood · 5 highlight are used where the biome should tint) ──
  const RUST = '#8a4a2a', MET = '#8d949c', METD = '#4a5058', METB = '#a9b1b8', INK = '#22262c', BLK = '#15171b', CONC = '#8d8b86', CONCD = '#6f6d68', GLASS = '#9fd3e8', GLASSD = '#1f2933',
    HAZ = '#f5c400', WHITE = '#e8e8e8', RED = '#c0392b', BLUE = '#2a5fa8', GREEN = '#3d7a4a', ORANGE = '#ff6a1a', YEL = '#e8b400', WOOD = '#8a5a2b', WOODD = '#5a3819', CYAN = '#57e0ff', MAG = '#ff4fd8',
    AMB = '#fbbf24', CANV = '#b9a66b', BRICK = '#9b4f3a', PLASTER = '#e8e0d0', TOX = '#7dff4a', FIRE = '#ff8c2a', FIRE2 = '#ffe27a', LEAF = '#6ea03a', LEAF2 = '#9ad25a', TYRE = '#1c1e22', NAVY = '#1f3a6b', CAMO = '#5a6b45', TAN = '#d4b04a';
  // Texture names this file may reference (the materials plugin's contract). Names it did not register resolve to flat colour without a warning.
  const TEX = ['metal', 'metalDark', 'metalBrushed', 'rust', 'concrete', 'concreteDark', 'brick', 'brickRed', 'wood', 'woodDark', 'plank', 'sand', 'grass', 'dirt', 'gravel', 'asphalt', 'tile', 'plaster', 'camo', 'camoDesert', 'panel', 'panelLit', 'hazard', 'grid', 'fabric', 'leather', 'bark', 'leaves', 'snow', 'lava', 'water', 'scales', 'canvas'];

  // ── part helpers: bx(w,h,d, x,y,z, c, extra) · cy(rTop,rBot,h,segs, x,y,z, c, extra) · cn(r,h,segs, …) · sp(r, …) · dd(r, …); extra = {t, e, rz, rx, s} ──
  const bx = (w, h, d, x, y, z, c, o) => Object.assign({ g: 'box', a: [w, h, d], p: [x, y, z], c: c }, o);
  const cy = (r1, r2, h, n, x, y, z, c, o) => Object.assign({ g: 'cyl', a: [r1, r2, h, n], p: [x, y, z], c: c }, o);
  const cn = (r, h, n, x, y, z, c, o) => Object.assign({ g: 'cone', a: [r, h, n], p: [x, y, z], c: c }, o);
  const sp = (r, x, y, z, c, o) => Object.assign({ g: 'sphere', a: [r, 7, 5], p: [x, y, z], c: c }, o);
  const dd = (r, x, y, z, c, o) => Object.assign({ g: 'dodeca', a: [r, 0], p: [x, y, z], c: c }, o);
  const cat = function () { return [].concat.apply([], arguments); };
  const mv = (parts, dx, dy, dz) => parts.map(p => Object.assign({}, p, { p: [p.p[0] + dx, p.p[1] + (dy || 0), p.p[2] + (dz || 0)] }));
  const re = (parts, map, tex) => parts.map(p => { const q = Object.assign({}, p); if (Object.prototype.hasOwnProperty.call(map, q.c)) q.c = map[q.c]; if (tex && !q.e) q.t = tex; return q; });
  const DIMS = { box: 3, cyl: 3, cone: 2, sphere: 1, dodeca: 1, octa: 1 };
  const sc = (parts, k) => parts.map(p => Object.assign({}, p, { a: p.a.map((v, i) => i < DIMS[p.g] ? v * k : v), p: p.p.map(v => v * k) }));
  // never give an unlit part (e) a texture: the core copies a texture's bumpMap onto MeshBasicMaterial, which THREE warns about
  const lit = (parts, on) => parts.map(p => p.e === 'dark' ? Object.assign({}, p, { e: on ? true : 'dark' }) : p);

  // ═══ INDUSTRIAL ═══ (metres; man-made props face +z, long axis along x)
  const IND = {};
  {
    const shell = c => [bx(6, 2.6, 2.44, 0, 1.3, 0, c, { t: 'metal' }), bx(6.1, .14, 2.5, 0, 2.55, 0, INK), bx(6.1, .14, 2.5, 0, .07, 0, INK), bx(.08, 2.4, 2.3, 3.02, 1.3, 0, c, { t: 'metalDark' }), bx(.05, 1.8, .06, 3.08, 1.3, .35, INK), bx(.05, 1.8, .06, 3.08, 1.3, -.35, INK)];
    const open = c => shell(c).slice(0, 3).concat([bx(.1, 2.3, 2.2, 2.9, 1.3, 0, BLK), bx(1.2, 2.4, .08, 3.6, 1.3, 1.22, c, { t: 'metalDark' }), bx(1.2, 2.4, .08, 3.6, 1.3, -1.22, c, { t: 'metalDark' })]);
    IND.container = { r: 3.2, jit: [.95, 1.05], len: 6, parts: shell(5), variants: { red: shell(RED), blue: shell(BLUE), green: shell(GREEN), open: open(RED) } };
  }
  {
    const gen = (c, t) => [bx(2.3, .16, 1.1, 0, .08, 0, INK), bx(2.2, 1.1, 1, 0, .71, 0, c, { t: t }), cy(.08, .08, .8, 6, -.7, 1.6, .2, METD), bx(.06, .6, .6, 1.12, .7, 0, INK, { t: 'grid' }), bx(.5, .3, .04, .3, .9, .52, INK), sp(.05, .6, .95, .53, TOX, { e: 'dark' })];
    IND.generator = { r: 1.3, jit: [.9, 1.1], parts: gen(5, 'metal'), variants: { yellow: gen(YEL, 'metal'), military: gen(CAMO, 'camo'), rusty: gen(RUST, 'rust') } };
  }
  {
    const ladder = (x, h, y0) => [bx(.06, h, .06, x, y0 + h / 2, .22, METD), bx(.06, h, .06, x, y0 + h / 2, -.22, METD), bx(.06, .05, .5, x, y0 + h * .25, 0, METD), bx(.06, .05, .5, x, y0 + h * .5, 0, METD), bx(.06, .05, .5, x, y0 + h * .75, 0, METD)];
    const tank = (c, t) => cat([cy(1.8, 1.8, 4.4, 12, 0, 2.3, 0, c, { t: t }), cy(1.85, 1.85, .2, 12, 0, .1, 0, INK), cy(1.85, 1.85, .2, 12, 0, 4.4, 0, INK), cy(1.4, 1.8, .5, 12, 0, 4.75, 0, c, { t: t })], ladder(1.9, 4.6, .1));
    IND.tank = { r: 2, jit: [.9, 1.15], parts: tank(5, 'metal'), variants: { water: tank(BLUE, 'metal'), fuel: cat(tank(RUST, 'rust').slice(0, 4), [cy(1.86, 1.86, .5, 12, 0, 3.4, 0, HAZ, { t: 'hazard' })], ladder(1.9, 4.6, .1)),
      tower: cat([cy(.12, .16, 5, 6, 1.3, 2.5, 1.3, METD), cy(.12, .16, 5, 6, -1.3, 2.5, 1.3, METD), cy(.12, .16, 5, 6, 1.3, 2.5, -1.3, METD), cy(.12, .16, 5, 6, -1.3, 2.5, -1.3, METD), cy(1.7, 1.7, 3, 12, 0, 6.5, 0, 5, { t: 'metal' }), cn(1.8, 1, 12, 0, 8.5, 0, INK)], ladder(1.75, 6.2, .1)) } };
  }
  {
    const rails = (len, y, z) => [bx(len, .05, .05, 0, y + 1, z, MET), bx(len, .05, .05, 0, y + .5, z, MET), bx(.05, 1, .05, -len / 2 + .1, y + .5, z, MET), bx(.05, 1, .05, len / 2 - .1, y + .5, z, MET)];
    const seg = cat([bx(4, .1, 1.2, 0, 3, 0, INK, { t: 'grid' }), cy(.08, .1, 3, 6, -1.8, 1.5, 0, METD), cy(.08, .1, 3, 6, 1.8, 1.5, 0, METD)], rails(4, 3, .58), rails(4, 3, -.58));
    IND.catwalk = { r: 2, jit: [1, 1], len: 4, parts: seg, variants: { segment: seg,
      stairs: [bx(5, .1, 1.2, 0, 1.5, 0, INK, { t: 'grid', rz: .64 }), bx(5, .05, .05, 0, 2.55, .58, MET, { rz: .64 }), bx(5, .05, .05, 0, 2.55, -.58, MET, { rz: .64 }), bx(.05, 1, .05, 2, 3.3, .58, MET), bx(.05, 1, .05, 2, 3.3, -.58, MET), bx(.05, 1, .05, -2, .8, .58, MET), bx(.05, 1, .05, -2, .8, -.58, MET)],
      platform: cat([bx(2.4, .1, 2.4, 0, 3, 0, INK, { t: 'grid' }), cy(.08, .1, 3, 6, -1, 1.5, -1, METD), cy(.08, .1, 3, 6, 1, 1.5, -1, METD), cy(.08, .1, 3, 6, -1, 1.5, 1, METD), cy(.08, .1, 3, 6, 1, 1.5, 1, METD)], rails(2.4, 3, 1.18), rails(2.4, 3, -1.18)) } };
  }
  {
    const lad = (h, c) => [bx(.06, h, .06, -.22, h / 2, 0, c), bx(.06, h, .06, .22, h / 2, 0, c), bx(.5, .05, .05, 0, h * .18, 0, c), bx(.5, .05, .05, 0, h * .36, 0, c), bx(.5, .05, .05, 0, h * .54, 0, c), bx(.5, .05, .05, 0, h * .72, 0, c), bx(.5, .05, .05, 0, h * .9, 0, c)];
    IND.ladder = { r: .3, jit: [1, 1], parts: lad(3, MET), variants: { metal: lad(3, MET), wood: lad(3, 4).map(p => Object.assign(p, { t: 'wood' })), tall: lad(4.5, MET), rusty: lad(3, RUST).map(p => Object.assign(p, { t: 'rust' })) } };
  }
  {
    const posts = [cy(.06, .06, 2.6, 5, -1.95, 1.3, 0, METD), cy(.06, .06, 2.6, 5, 1.95, 1.3, 0, METD)];
    IND.wallSegment = { r: 2, jit: [1, 1], len: 4, parts: [bx(4, 2.5, .3, 0, 1.25, 0, 1, { t: 'concrete' }), bx(4.05, .2, .4, 0, 2.55, 0, CONCD)], variants: {
      concrete: [bx(4, 2.5, .3, 0, 1.25, 0, 1, { t: 'concrete' }), bx(4.05, .2, .4, 0, 2.55, 0, CONCD)],
      metal: cat([bx(4, 2.4, .12, 0, 1.25, 0, 5, { t: 'metalBrushed' }), bx(4, .1, .16, 0, 2.5, 0, INK)], posts),
      chainlink: cat([bx(4, 2.2, .04, 0, 1.2, 0, METB, { t: 'grid' }), bx(4, .05, .05, 0, 2.35, 0, METD)], posts),
      brick: [bx(4, 2.5, .35, 0, 1.25, 0, BRICK, { t: 'brick' }), bx(4.05, .18, .45, 0, 2.55, 0, CONCD)] } };
  }
  {
    const frame = [bx(3.4, 3.5, .3, 0, 1.75, 0, 4, { t: 'concreteDark' })];
    IND.door = { r: 1.7, jit: [1, 1], parts: cat(frame, [bx(2.8, 3, .1, 0, 1.5, .12, 5, { t: 'metalBrushed' })]), variants: {
      rolling: cat(frame, [bx(2.8, 3, .1, 0, 1.5, .12, 5, { t: 'metalBrushed' })]),
      steel: [bx(1.5, 2.5, .3, 0, 1.25, 0, 4, { t: 'concreteDark' }), bx(1.1, 2.2, .1, 0, 1.1, .12, METD, { t: 'metal' }), bx(.06, .3, .06, .4, 1.05, .2, INK), bx(1.1, .15, .1, 0, 1.6, .13, HAZ, { t: 'hazard' })],
      open: cat(frame, [bx(2.8, 1.9, .04, 0, .95, .1, BLK), bx(2.8, 1.1, .12, 0, 2.45, .12, 5, { t: 'metalBrushed' })]) } };
  }
  IND.vent = { r: .7, jit: [.8, 1.2], parts: [bx(1.2, .8, 1.2, 0, .4, 0, 5, { t: 'metal' }), cy(.45, .45, .1, 10, 0, .85, 0, INK), bx(1, .6, .04, 0, .4, .61, INK, { t: 'grid' })], variants: {
    ac: [bx(1.2, .8, 1.2, 0, .4, 0, 5, { t: 'metal' }), cy(.45, .45, .1, 10, 0, .85, 0, INK), bx(1, .6, .04, 0, .4, .61, INK, { t: 'grid' })],
    pipe: [cy(.3, .3, 1.2, 8, 0, .6, 0, MET, { t: 'metal' }), cy(.5, .5, .2, 8, 0, 1.3, 0, INK), cy(.42, .42, .06, 8, 0, 1.42, 0, MET)],
    duct: [cy(.35, .35, 3, 8, 0, .9, 0, MET, { t: 'metal', rz: R90 }), bx(.12, .7, .8, -1.1, .35, 0, METD), bx(.12, .7, .8, 1.1, .35, 0, METD), cy(.42, .42, .3, 8, 0, .9, 0, INK, { rz: R90 })] } };
  {
    const mast = [bx(.8, .3, .8, 0, .15, 0, 1, { t: 'concrete' }), cy(.05, .08, 6, 5, 0, 3.3, 0, MET), bx(1.2, .04, .04, 0, 3.5, 0, MET), bx(1, .04, .04, 0, 4.6, 0, MET), sp(.1, 0, 6.35, 0, '#ff3030', { e: true })];
    IND.antenna = { r: .5, jit: [.9, 1.2], light: { c: '#ff3030', i: .35, d: 5, y: 6.3 }, parts: mast, variants: { mast: mast, dish: mast.slice(0, 2).concat([cy(.8, .15, .4, 10, .4, 4.5, .1, WHITE, { t: 'metalBrushed', rx: -1.2 }), bx(.9, .5, .08, 0, 5.6, 0, INK, { t: 'panel' })]),
      radar: mast.slice(0, 2).concat([bx(1.8, .7, .1, 0, 5.9, 0, METD, { t: 'grid' }), bx(.3, .3, .3, 0, 5.4, 0, INK)]) } };
  }
  {
    const bin = (c, lidRz) => [bx(1.8, 1.3, 1.1, 0, .75, 0, c, { t: 'metalDark' }), bx(1.85, .1, 1.15, 0, 1.4, lidRz ? -.35 : 0, c, { rz: 0, rx: lidRz || 0 }), cy(.12, .12, .16, 6, -.7, .12, .6, INK, { rz: R90 }), cy(.12, .12, .16, 6, .7, .12, .6, INK, { rz: R90 }), bx(1.6, .08, .06, 0, 1, .57, INK)];
    IND.dumpster = { r: 1.1, jit: [.95, 1.05], parts: bin(2), variants: { green: bin('#2f6b3a'), blue: bin(BLUE), open: bin('#2f6b3a', -.7), rusty: re(bin(RUST), {}, 'rust') } };
  }
  {
    const row = (len, y, z, c) => bx(len, .32, .5, 0, y, z, c, { t: 'canvas' });
    const wall = c => [row(2.2, .16, 0, c), row(2.2, .46, .04, c), row(1.6, .76, -.02, c), sp(.28, -.5, 1, 0, c, { s: [1, .55, .8], t: 'canvas' }), sp(.28, .45, 1, .05, c, { s: [1, .55, .8], t: 'canvas' })];
    IND.sandbag = { r: 1.2, jit: [.9, 1.1], parts: wall(CANV), variants: { wall: wall(CANV), desert: wall('#c8b07a'), corner: cat(wall(CANV), [bx(.5, .32, 1.6, -1.35, .16, -.8, CANV, { t: 'canvas' }), bx(.5, .32, 1.6, -1.32, .46, -.78, CANV, { t: 'canvas' })]),
      ring: [bx(2.6, .62, .5, 0, .31, 1.2, CANV, { t: 'canvas' }), bx(2.6, .62, .5, 0, .31, -1.2, CANV, { t: 'canvas' }), bx(.5, .62, 2, -1.2, .31, 0, CANV, { t: 'canvas' }), bx(.5, .62, 2, 1.2, .31, 0, CANV, { t: 'canvas' }), bx(2.6, .3, .5, 0, .75, 1.22, '#a8955d', { t: 'canvas' })] } };
  }
  {
    const tyre = (x, y, z, rz) => [cy(.5, .5, .26, 12, x, y, z, TYRE, { rz: rz || 0 }), cy(.3, .3, .28, 10, x, y, z, '#3a3d42', { rz: rz || 0 })];
    IND.tire = { r: .6, jit: [.9, 1.15], parts: cat(tyre(0, .13, 0), tyre(.05, .39, .04), tyre(-.04, .65, -.03)), variants: { stack: cat(tyre(0, .13, 0), tyre(.05, .39, .04), tyre(-.04, .65, -.03)), single: tyre(0, .5, 0, R90),
      pile: cat(tyre(0, .13, 0), tyre(.6, .13, .5), tyre(.3, .45, .25, .9)), tall: cat(tyre(0, .13, 0), tyre(.05, .39, .04), tyre(-.04, .65, -.03), tyre(.03, .91, .02), tyre(-.02, 1.17, .05)) } };
  }
  {
    const base = [bx(1.2, .14, 1, 0, .07, 0, 4, { t: 'plank' }), bx(1.2, .06, .1, 0, .17, .4, 4, { t: 'plank' }), bx(1.2, .06, .1, 0, .17, -.4, 4, { t: 'plank' })];
    IND.pallet = { r: .8, jit: [.95, 1.1], parts: cat(base, [bx(.55, .55, .55, -.3, .48, -.2, 5, { t: 'wood' }), bx(.5, .5, .5, .3, .45, .2, 5, { t: 'wood' }), bx(.45, .45, .45, -.25, 1, -.15, 5, { t: 'wood' })]), variants: {
      crates: cat(base, [bx(.55, .55, .55, -.3, .48, -.2, 5, { t: 'wood' }), bx(.5, .5, .5, .3, .45, .2, 5, { t: 'wood' }), bx(.45, .45, .45, -.25, 1, -.15, 5, { t: 'wood' })]), empty: base,
      stack: cat(base, mv(base, 0, .2), mv(base, .05, .4, .03), mv(base, -.03, .6, 0)),
      sacks: cat(base, [sp(.32, -.3, .42, 0, CANV, { s: [1, .7, 1.3], t: 'canvas' }), sp(.32, .3, .42, .05, CANV, { s: [1, .7, 1.3], t: 'canvas' }), sp(.3, 0, .8, 0, '#a8955d', { s: [1, .7, 1.3], t: 'canvas' })]) } };
  }
  IND.spool = { r: 1, jit: [.8, 1.2], parts: [cy(.9, .9, .12, 12, -.55, .9, 0, 4, { t: 'plank', rz: R90 }), cy(.9, .9, .12, 12, .55, .9, 0, 4, { t: 'plank', rz: R90 }), cy(.55, .55, 1, 10, 0, .9, 0, INK, { rz: R90 })], variants: {
    standing: [cy(.9, .9, .12, 12, -.55, .9, 0, 4, { t: 'plank', rz: R90 }), cy(.9, .9, .12, 12, .55, .9, 0, 4, { t: 'plank', rz: R90 }), cy(.55, .55, 1, 10, 0, .9, 0, INK, { rz: R90 })],
    flat: [cy(.9, .9, .12, 12, 0, .06, 0, 4, { t: 'plank' }), cy(.9, .9, .12, 12, 0, 1.06, 0, 4, { t: 'plank' }), cy(.55, .55, .9, 10, 0, .56, 0, RUST, { t: 'rust' })],
    small: [cy(.5, .5, .08, 10, -.3, .5, 0, 4, { t: 'plank', rz: R90 }), cy(.5, .5, .08, 10, .3, .5, 0, 4, { t: 'plank', rz: R90 }), cy(.3, .3, .55, 8, 0, .5, 0, INK, { rz: R90 })] } };
  {
    const lift = c => [bx(1.1, .9, 1.8, 0, .75, -.2, c, { t: 'metal' }), cy(.3, .3, 1.3, 8, 0, .3, .6, TYRE, { rz: R90 }), cy(.28, .28, 1.3, 8, 0, .28, -.7, TYRE, { rz: R90 }), bx(.08, 2.4, .08, -.4, 1.4, 1, METD), bx(.08, 2.4, .08, .4, 1.4, 1, METD),
      bx(.14, .05, 1.1, -.3, .12, 1.55, MET), bx(.14, .05, 1.1, .3, .12, 1.55, MET), bx(.08, 1.2, .08, -.5, 1.6, -.9, INK), bx(.08, 1.2, .08, .5, 1.6, -.9, INK), bx(1.1, .06, 1.3, 0, 2.2, -.3, INK), bx(.5, .5, .4, 0, 1.4, -.4, INK, { t: 'leather' })];
    IND.forklift = { r: 1.3, jit: [1, 1], parts: lift(YEL), variants: { yellow: lift(YEL), orange: lift(ORANGE), green: lift('#4a8a3a') } };
  }
  {
    const cab = c => [bx(2.3, .4, 7.4, 0, .7, 0, INK), bx(2.2, 2.1, 2.2, 0, 1.85, 2.6, c, { t: 'metal' }), bx(2.1, .8, .06, 0, 2.4, 3.72, GLASSD), bx(.5, .2, .06, -.75, 1.25, 3.72, '#fff3c0', { e: 'dark' }), bx(.5, .2, .06, .75, 1.25, 3.72, '#fff3c0', { e: 'dark' }),
      cy(.5, .5, 2.5, 10, 0, .5, 2.7, TYRE, { rz: R90 }), cy(.5, .5, 2.5, 10, 0, .5, -.7, TYRE, { rz: R90 }), cy(.5, .5, 2.5, 10, 0, .5, -2, TYRE, { rz: R90 })];
    IND.truck = { r: 3.5, jit: [1, 1], parts: cat(cab(5), [bx(2.4, 2.4, 5, 0, 2.1, -1.2, 1, { t: 'canvas' })]), variants: { box: cat(cab(5), [bx(2.4, 2.4, 5, 0, 2.1, -1.2, 1, { t: 'canvas' })]),
      tanker: cat(cab(RED), [cy(1.15, 1.15, 5, 12, 0, 2.05, -1.2, METB, { t: 'metalBrushed', rx: R90 }), bx(.6, .15, 3, 0, 3.2, -1.2, METD)]),
      flatbed: cat(cab(BLUE), [bx(2.4, .3, 5, 0, 1, -1.2, 4, { t: 'plank' }), bx(1, 1, 1, -.5, 1.65, -1.5, 5, { t: 'wood' }), bx(.9, .9, .9, .6, 1.6, -.4, 5, { t: 'wood' })]),
      military: cat(re(cab(CAMO), {}, 'camo').slice(0, 2).concat(cab(CAMO).slice(2)), [bx(2.4, 2.2, 5, 0, 2, -1.2, CAMO, { t: 'canvas' })]) } };
  }
  {
    const tower = [bx(3, .5, 3, 0, .25, 0, 1, { t: 'concrete' }), bx(.9,14, .9, 0, 7.4, 0, YEL, { t: 'grid' }), bx(16, .6, .8, 5, 14.6, 0, YEL, { t: 'grid' }), bx(4, .5, .7, -3, 14.5, 0, YEL), bx(1.6, .8, 1.2, -4, 15.2, 0, INK), bx(1.2, 1.3, 1.2, 0, 14.4, 1, METD, { t: 'panel' }), cy(.02, .02, 6, 3, 10, 11, 0, INK), bx(.5, .5, .5, 10, 8, 0, METD), sp(.15, 0, 15.3, 0, '#ff3030', { e: true })];
    IND.crane = { r: 2.5, jit: [.9, 1.1], light: { c: '#ff3030', i: .3, d: 6, y: 15.3 }, parts: tower, variants: { tower: tower,
      mobile: [bx(2.4, .4, 6, 0, .7, 0, INK), cy(.5, .5, 2.6, 10, 0, .5, 2, TYRE, { rz: R90 }), cy(.5, .5, 2.6, 10, 0, .5, -2, TYRE, { rz: R90 }), bx(2.2,1.6, 5, 0, 1.7, -.3, YEL, { t: 'metal' }), bx(1.4, 1.3, 1.6, 0, 3.1, 1.2, METD, { t: 'panel' }), bx(.7, .7, 9, 0, 5.5, -2, YEL, { rx: -.8 }), cy(.02, .02, 3, 3, 0, 6.5, -6.5, INK), bx(.4, .4, .4, 0, 5, -6.5, METD)],
      gantry: [bx(1.2, 12, 1.2, -6, 6, 0, YEL, { t: 'grid' }), bx(1.2, 12, 1.2, 6, 6, 0, YEL, { t: 'grid' }), bx(14, 1, 1.4, 0, 12.5, 0, YEL, { t: 'grid' }), bx(1.6, .8, 1.6, 1, 11.6, 0, INK), cy(.02, .02, 7, 3, 1, 7.6, 0, INK), bx(2, .4, 1, 1, 4, 0, METD), bx(2, 1, 1.2, -6, .5, 0, INK), bx(2, 1, 1.2, 6, .5, 0, INK)] } };
  }
  {
    const stack = (c, t) => [cy(1.1, 1.5, 14, 10, 0, 7, 0, c, { t: t }), cy(1.65, 1.65, .3, 10, 0, 4.5, 0, INK), cy(1.5, 1.5, .3, 10, 0, 9, 0, INK), cy(1.3, 1.15, .6, 10, 0, 14.2, 0, METD), sp(1, .2, 15.4, 0, '#8a8f96', { s: [1, .6, 1] }), sp(.7, .9, 16.2, .3, '#9aa0a6', { s: [1, .6, 1] })];
    IND.chimney = { r: 1.8, jit: [.9, 1.1], parts: stack(BRICK, 'brick'), variants: { brick: stack(BRICK, 'brick'), metal: stack(MET, 'metal').slice(0, 4).concat([cy(1.2, 1.2, .8, 10, 0, 12.5, 0, HAZ, { t: 'hazard' })]), twin: cat(stack(BRICK, 'brick'), mv(stack(BRICK, 'brick').slice(0, 4), 3.6, -3)) } };
  }
  {
    const pylon = [bx(.28, 16, .28, -1.2, 8, 0, MET, { t: 'grid', rz: .07 }), bx(.28, 16, .28, 1.2, 8, 0, MET, { t: 'grid', rz: -.07 }), bx(.28, 16, .28, 0, 8, -1.1, MET, { t: 'grid', rx: -.07 }), bx(.28, 16, .28, 0, 8, 1.1, MET, { t: 'grid', rx: .07 }), bx(6, .25, .25, 0, 10, 0, MET), bx(5, .25, .25, 0, 12.5, 0, MET), bx(3, .25, .25, 0, 15, 0, MET), bx(1.6, .8, 1.6, 0, 16.2, 0, MET, { t: 'grid' })];
    IND.powerLine = { r: 1.5, jit: [.9, 1.1], parts: pylon, variants: { pylon: pylon, pole: [cy(.16, .2, 9, 6, 0, 4.5, 0, 4, { t: 'wood' }), bx(2, .15, .15, 0, 8.4, 0, 4, { t: 'wood' }), cy(.06, .06, .3, 5, -.7, 8.6, 0, WHITE), cy(.06, .06, .3, 5, .7, 8.6, 0, WHITE), bx(.4, .6, .4, .3, 7.4, 0, METD)],
      transformer: [cy(.16, .2, 9, 6, 0, 4.5, 0, 4, { t: 'wood' }), bx(2, .15, .15, 0, 8.4, 0, 4, { t: 'wood' }), cy(.45, .45, 1.2, 8, .6, 6.5, 0, METD, { t: 'metalDark' }), cy(.45, .45, 1.2, 8, -.6, 6.5, 0, METD, { t: 'metalDark' }), bx(1.6, .1, .3, 0, 5.8, 0, METD)] } };
  }
  {
    const drum = (c, t, band) => [cy(.35, .35, .9, 10, 0, .45, 0, c, { t: t }), cy(.37, .37, .08, 10, 0, .3, 0, INK), cy(.37, .37, .08, 10, 0, .62, 0, INK), cy(.3, .3, .05, 10, 0, .92, 0, INK)].concat(band ? [cy(.36, .36, .14, 10, 0, .46, 0, band, { e: 'dark' })] : []);
    IND.hazardBarrel = { r: .45, jit: [.95, 1.05], parts: drum(HAZ, 'hazard'), variants: { yellow: drum(HAZ, 'hazard'), toxic: drum('#5fbf3a', 'metal', TOX), red: drum(RED, 'metal', WHITE), leaking: drum('#5fbf3a', 'rust', TOX).concat([cy(.6, .6, .03, 8, .3, .015, .2, TOX, { e: 'dark' })]) } };
  }
  {
    const desk = [bx(1.6, .9, .6, 0, .45, 0, METD, { t: 'panel' }), bx(1.5, .5, .7, 0, 1.03, .05, INK, { rx: -.5 }), bx(1.2, .32, .04, 0, 1.15, .3, CYAN, { e: 'dark', rx: -.5 }), bx(.12, .05, .05, -.5, .98, .55, '#ff3030', { e: 'dark', rx: -.5 }), bx(.12, .05, .05, -.3, .98, .55, TOX, { e: 'dark', rx: -.5 }), bx(.4, .05, .05, .3, .98, .55, AMB, { e: 'dark', rx: -.5 })];
    IND.console = { r: .9, jit: [.95, 1.05], light: { c: CYAN, i: .45, d: 4, y: 1.2 }, parts: desk, variants: { dark: desk, lit: lit(desk, true), bank: cat(lit(desk, true), mv(lit(desk, true).slice(0, 3), -1.7, 0, 0), mv(lit(desk, true).slice(0, 3), 1.7, 0, 0)), broken: desk.slice(0, 2).concat([bx(1.2, .32, .04, 0, 1.15, .3, BLK, { rx: -.5 }), bx(.5, .3, .3, .5, 1.1, .2, INK, { rx: -.5 })]) } };
  }
  {
    const pole = [bx(1, .3, 1, 0, .15, 0, 1, { t: 'concrete' }), cy(.1, .18, 7, 6, 0, 3.6, 0, METD), bx(1.6, .1, .1, 0, 7.1, 0, METD)];
    const head = (x, y, z) => bx(.6, .4, .3, x, y, z, '#fff3c0', { e: true, rx: -.4 });
    IND.floodlightTower = { r: .6, jit: [1, 1], light: { c: '#fff0d0', i: 2.2, d: 22, y: 6.8 }, parts: pole.concat([head(-.5, 7.2, .15), head(.5, 7.2, .15)]), variants: { single: pole.concat([head(-.5, 7.2, .15), head(.5, 7.2, .15)]),
      quad: pole.concat([head(-.5, 7.2, .15), head(.5, 7.2, .15), head(-.5, 6.7, .15), head(.5, 6.7, .15)]),
      trailer: pole.concat([head(-.5, 7.2, .15), head(.5, 7.2, .15), bx(1.6, .8, 1, 0, .7, -.6, YEL, { t: 'metal' }), cy(.3, .3, 1.7, 8, 0, .3, -.6, TYRE, { rz: R90 })]),
      off: pole.concat([bx(.6, .4, .3, -.5, 7.2, .15, INK, { rx: -.4 }), bx(.6, .4, .3, .5, 7.2, .15, INK, { rx: -.4 })]) } };
  }
  {
    const posts = h => [cy(.05, .05, h, 5, -1.5, h / 2, -.6, MET), cy(.05, .05, h, 5, 1.5, h / 2, -.6, MET), cy(.05, .05, h, 5, -1.5, h / 2, .6, MET), cy(.05, .05, h, 5, 1.5, h / 2, .6, MET)];
    const deck = y => [bx(3, .08, 1.2, 0, y, 0, 4, { t: 'plank' }), bx(3, .05, .05, 0, y + 1, -.6, MET), bx(3.2, .05, .05, 0, y + .5, .62, MET, { rz: .55 })];
    IND.scaffold = { r: 1.7, jit: [1, 1], parts: cat(posts(6), deck(2), deck(4)), variants: { two: cat(posts(6), deck(2), deck(4)), tall: cat(posts(9), deck(2.5), deck(5.5), deck(8)), tarp: cat(posts(6), deck(2), deck(4), [bx(3.1, 4.6, .05, 0, 2.5, .68, '#3f7a3a', { t: 'canvas' })]), one: cat(posts(3), deck(2)) } };
  }
  {
    const belt = [bx(5, .3, 1.1, 0, .7, 0, MET, { t: 'metal' }), bx(5, .1, 1, 0, .9, 0, INK), bx(.1, .7, 1, -2.2, .35, 0, METD), bx(.1, .7, 1, 2.2, .35, 0, METD), cy(.15, .15, 1, 8, -2.5, .9, 0, METD, { rz: R90 }), cy(.15, .15, 1, 8, 2.5, .9, 0, METD, { rz: R90 })];
    IND.conveyor = { r: 2.6, jit: [1, 1], len: 5, parts: belt.concat([bx(.5, .4, .5, .6, 1.15, 0, 5, { t: 'wood' })]), variants: { flat: belt.concat([bx(.5, .4, .5, .6, 1.15, 0, 5, { t: 'wood' })]), empty: belt,
      loaded: belt.concat([bx(.5, .4, .5, -1.5, 1.15, 0, 5, { t: 'wood' }), bx(.45, .35, .45, 0, 1.13, .1, 5, { t: 'wood' }), bx(.5, .4, .5, 1.6, 1.15, -.1, 5, { t: 'wood' })]),
      incline: [bx(5, .3, 1.1, 0, 1.4, 0, MET, { t: 'metal', rz: .3 }), bx(5, .1, 1, 0, 1.6, 0, INK, { rz: .3 }), bx(.1, .7, 1, -2.2, .35, 0, METD), bx(.1, 2.1, 1, 2.2, 1.05, 0, METD), cy(.15, .15, 1, 8, -2.4, .85, 0, METD, { rz: R90 }), cy(.15, .15, 1, 8, 2.4, 2.3, 0, METD, { rz: R90 })] } };
  }
  {
    const valve = c => [cy(.25, .25, 1, 8, 0, .5, 0, MET, { t: 'metal' }), cy(.32, .32, .12, 8, 0, .98, 0, INK), cy(.04, .04, .35, 5, 0, 1.15, 0, METD), cy(.35, .35, .06, 12, 0, 1.3, 0, c), cy(.3, .3, .08, 8, 0, .06, 0, INK)];
    IND.valve = { r: .4, jit: [.9, 1.1], parts: valve(RED), variants: { red: valve(RED), blue: valve(BLUE), rusty: re(valve(RUST), { [MET]: RUST }, 'rust'), stand: valve(RED).concat([cy(.25, .25, 1.4, 8, .7, .45, 0, MET, { t: 'metal', rz: R90 }), cy(.32, .32, .1, 8, 1.35, .45, 0, INK, { rz: R90 })]) } };
  }
  {
    const pj = (c, t) => [cy(.4, .4, 4, 8, 0, .5, 0, c, { t: t, rz: R90 }), cy(.4, .4, 4, 8, 0, .5, 0, c, { t: t, rx: R90 }), cy(.4, .4, 2, 8, 0, 1.4, 0, c, { t: t }), cy(.5, .5, .25, 8, -1.85, .5, 0, INK, { rz: R90 }), cy(.5, .5, .25, 8, 1.85, .5, 0, INK, { rz: R90 }), cy(.5, .5, .25, 8, 0, 2.3, 0, INK), cy(.55, .55, .5, 8, 0, .5, 0, INK)];
    IND.pipeJunction = { r: 1.2, jit: [.9, 1.2], parts: pj(MET, 'metal'), variants: { cross: pj(MET, 'metal'), rusty: pj(RUST, 'rust'), elbow: [cy(.4, .4, 4, 8, 0, .5, 0, MET, { t: 'metal', rz: R90 }), cy(.4, .4, 2, 8, 2, 1.4, 0, MET, { t: 'metal' }), sp(.42, 2, .5, 0, MET), cy(.5, .5, .25, 8, -1.85, .5, 0, INK, { rz: R90 }), cy(.5, .5, .25, 8, 2, 2.3, 0, INK)],
      gauge: pj(MET, 'metal').concat([cy(.25, .25, .1, 10, 0, 1.9, .4, WHITE, { rx: R90 }), cy(.04, .04, .3, 5, 0, 1.75, .3, METD, { rx: R90 })]) } };
  }
  {
    const tile = (c, t) => [bx(2, .06, 2, 0, .03, 0, c, { t: t })];
    IND.road = { r: 1, jit: [1, 1], soft: true, parts: tile('#2b2d31', 'asphalt'), variants: { asphalt: tile('#2b2d31', 'asphalt'), line: tile('#2b2d31', 'asphalt').concat([bx(.12, .07, 1, 0, .035, 0, '#e8e0c0')]), crossing: tile('#2b2d31', 'asphalt').concat([bx(.35, .07, 1.8, -.6, .035, 0, WHITE), bx(.35, .07, 1.8, 0, .035, 0, WHITE), bx(.35, .07, 1.8, .6, .035, 0, WHITE)]),
      dirt: tile('#8a6a45', 'dirt'), gravel: tile('#9a948a', 'gravel'), stone: tile('#7d7a74', 'concrete'), panel: tile(METD, 'panel').concat([bx(2, .07, .08, 0, .035, .96, CYAN, { e: 'dark' })]) } };
  }
  {
    const wh = (c, t) => [bx(10, 5, 14, 0, 2.5, 0, c, { t: t }), bx(7.4, 7.4, 13.8, 0, 5, 0, INK, { rz: R45, s: [1, .45, 1] }), bx(4, 3.6, .2, 0, 1.8, 7.05, INK, { t: 'metalBrushed' }), bx(4.2, .2, .25, 0, 3.7, 7.1, HAZ, { t: 'hazard' }), bx(1.2, .8, 1.2, 3, 7.2, 3, MET, { t: 'metal' }), bx(1.2, .8, 1.2, -3, 7.2, -3, MET, { t: 'metal' }), bx(1.4, .6, .08, 3.5, 3.5, 7.06, 3, { e: 'dark' }), bx(1.4, .6, .08, -3.5, 3.5, 7.06, 3, { e: 'dark' })];
    IND.warehouse = { r: 6.5, jit: [.9, 1.1], parts: wh(5, 'metal'), variants: { steel: wh(5, 'metal'), brick: wh(BRICK, 'brick'), concrete: wh(CONC, 'concrete'), open: wh(5, 'metal').slice(0, 2).concat([bx(4, 3.4, .1, 0, 1.7, 6.97, BLK), bx(4, .6, .2, 0, 3.7, 7.05, INK, { t: 'metalBrushed' })], wh(5, 'metal').slice(4)) } };
  }

  // ═══ URBAN ═══
  const URB = {};
  {
    const sedan = c => [bx(1.8, .55, 4.3, 0, .6, 0, c, { t: 'metalBrushed' }), bx(1.62, .5, 2.3, 0, 1.1, -.1, GLASSD), bx(1.5, .06, 2, 0, 1.36, -.1, c, { t: 'metalBrushed' }), cy(.33, .33, 1.9, 10, 0, .33, 1.4, TYRE, { rz: R90 }), cy(.33, .33, 1.9, 10, 0, .33, -1.4, TYRE, { rz: R90 }),
      bx(.36, .16, .06, -.6, .7, 2.16, '#fff3c0', { e: 'dark' }), bx(.36, .16, .06, .6, .7, 2.16, '#fff3c0', { e: 'dark' }), bx(.3, .14, .06, -.6, .7, -2.16, '#ff3030', { e: 'dark' }), bx(.3, .14, .06, .6, .7, -2.16, '#ff3030', { e: 'dark' })];
    const van = c => [bx(1.9, 1.7, 4.9, 0, 1.15, 0, c, { t: 'metalBrushed' }), bx(1.7, .7, .06, 0, 1.55, 2.46, GLASSD), bx(.06, .5, 1.2, .96, 1.5, 1.4, GLASSD), bx(.06, .5, 1.2, -.96, 1.5, 1.4, GLASSD), cy(.36, .36, 2, 10, 0, .36, 1.6, TYRE, { rz: R90 }), cy(.36, .36, 2, 10, 0, .36, -1.5, TYRE, { rz: R90 }), bx(.36, .16, .06, -.6, .8, 2.46, '#fff3c0', { e: 'dark' }), bx(.36, .16, .06, .6, .8, 2.46, '#fff3c0', { e: 'dark' })];
    const pickup = c => [bx(1.9, .6, 5, 0, .65, 0, c, { t: 'metalBrushed' }), bx(1.8, .9, 1.8, 0, 1.4, .9, c, { t: 'metalBrushed' }), bx(1.7, .6, .06, 0, 1.5, 1.82, GLASSD), bx(1.7, .5, 2.2, 0, 1.15, -1.3, INK), cy(.38, .38, 2, 10, 0, .38, 1.6, TYRE, { rz: R90 }), cy(.38, .38, 2, 10, 0, .38, -1.6, TYRE, { rz: R90 }), bx(.36, .16, .06, -.6, .8, 2.51, '#fff3c0', { e: 'dark' }), bx(.36, .16, .06, .6, .8, 2.51, '#fff3c0', { e: 'dark' })];
    URB.car = { r: 2.2, jit: [1, 1], parts: sedan(5), variants: { sedan: sedan(5), van: van(5), pickup: pickup(5), red: sedan(RED), blue: sedan(BLUE), white: sedan(WHITE), yellow: sedan(YEL), black: sedan(INK), police: sedan(WHITE).concat([bx(1, .2, .3, 0, 1.48, -.1, BLUE, { e: 'dark' }), bx(.4, .18, .28, -.3, 1.5, -.1, '#ff3030', { e: true })]) } };
  }
  {
    const wood = [bx(1.8, .08, .5, 0, .45, 0, 4, { t: 'plank' }), bx(1.8, .4, .06, 0, .78, -.22, 4, { t: 'plank', rx: -.15 }), bx(.08, .45, .5, -.8, .22, 0, METD), bx(.08, .45, .5, .8, .22, 0, METD), bx(.08, .5, .06, -.8, .78, -.22, METD, { rx: -.15 }), bx(.08, .5, .06, .8, .78, -.22, METD, { rx: -.15 })];
    URB.bench = { r: .9, jit: [1, 1], parts: wood, variants: { wood: wood, metal: re(wood, { 4: METB }, 'metal'), stone: [bx(1.8, .4, .55, 0, .3, 0, 1, { t: 'concrete' }), bx(.4, .1, .55, -.6, .05, 0, CONCD), bx(.4, .1, .55, .6, .05, 0, CONCD)], park: wood.concat([bx(.14, .9, .14, -1.2, .45, .1, 4, { t: 'wood' }), bx(.14, .9, .14, 1.2, .45, .1, 4, { t: 'wood' })]) } };
  }
  {
    const can = c => [cy(.3, .28, .9, 10, 0, .45, 0, c, { t: 'metalDark' }), cy(.33, .33, .08, 10, 0, .94, 0, INK), cy(.31, .31, .06, 10, 0, .3, 0, INK), cy(.31, .31, .06, 10, 0, .6, 0, INK)];
    URB.trashcan = { r: .35, jit: [.95, 1.05], parts: can(METD), variants: { metal: can(METD), green: can('#2f6b3a'), blue: can(BLUE), overflowing: can(METD).slice(0, 1).concat(can(METD).slice(2), [sp(.2, 0, .95, 0, CANV, { s: [1, .7, 1] }), sp(.14, .25, .9, .1, WHITE), bx(.25, .25, .25, -.2, .98, -.1, 5, { t: 'wood' })]) } };
  }
  {
    const usbox = c => [bx(.1, .9, .1, 0, .45, 0, METD), bx(.5, .5, .4, 0, 1.1, 0, c, { t: 'metal' }), sp(.25, 0, 1.35, 0, c, { s: [1, .4, 1.6] }), bx(.3, .06, .05, 0, 1.2, .21, INK)];
    URB.mailbox = { r: .3, jit: [1, 1], parts: usbox(BLUE), variants: { blue: usbox(BLUE), green: usbox('#2f6b3a'), pillar: [cy(.25, .25, 1.4, 10, 0, .7, 0, RED, { t: 'metal' }), cy(.3, .3, .1, 10, 0, 1.4, 0, INK), sp(.26, 0, 1.45, 0, RED, { s: [1, .5, 1] }), bx(.22, .06, .05, 0, 1.1, .26, INK)], post: usbox(RED) } };
  }
  {
    const hyd = c => [cy(.15, .15, .8, 8, 0, .4, 0, c, { t: 'metal' }), sp(.17, 0, .84, 0, c), cy(.07, .07, .5, 6, 0, .5, 0, c, { rz: R90 }), cy(.09, .09, .12, 6, 0, .5, .15, INK, { rx: R90 }), cy(.2, .2, .08, 8, 0, .04, 0, INK)];
    URB.hydrant = { r: .25, jit: [.95, 1.05], parts: hyd(RED), variants: { red: hyd(RED), yellow: hyd(YEL), blue: hyd(BLUE), silver: hyd(METB) } };
  }
  {
    const stop = [cy(.05, .05, 2.6, 5, -1.4, 1.3, -.6, METD), cy(.05, .05, 2.6, 5, 1.4, 1.3, -.6, METD), bx(3.2, .1, 1.6, 0, 2.65, 0, 5, { t: 'metal' }), bx(3, 2, .06, 0, 1.3, -.7, GLASS), bx(2.4, .08, .4, 0, .5, -.4, 4, { t: 'plank' }), bx(.6, .9, .06, 1.6, 2, .5, YEL, { e: 'dark' }), cy(.04, .04, 2.6, 5, 1.6, 1.3, .5, METD)];
    URB.busStop = { r: 1.7, jit: [1, 1], light: { c: '#fff3c0', i: .6, d: 6, y: 2.5 }, parts: stop, variants: { glass: stop, metal: re(stop, { [GLASS]: METB }, 'metal'), lit: stop.concat([bx(2.6, .06, .3, 0, 2.58, .2, '#fff3c0', { e: true })]), simple: [cy(.05, .05, 2.6, 5, 0, 1.3, 0, METD), bx(.6, .9, .06, 0, 2.2, .05, YEL, { e: 'dark' }), bx(1.6, .08, .4, 0, .5, -.6, 4, { t: 'plank' })] } };
  }
  {
    const kiosk = c => [bx(2.4, 2.4, 2, 0, 1.2, 0, 5, { t: 'plaster' }), bx(2.8, .2, 2.4, 0, 2.5, 0, 4), bx(2.4, .9, .3, 0, .45, 1.1, 4, { t: 'wood' }), bx(2.6, .08, 1, 0, 2.3, 1.55, c, { t: 'fabric', rx: .3 }), bx(2, .4, .06, 0, 2.75, .9, 3, { e: 'dark' }), bx(2.2, 1.1, .04, 0, 1.5, 1.01, GLASSD)];
    URB.kiosk = { r: 1.6, jit: [1, 1], parts: kiosk(RED), variants: { red: kiosk(RED), blue: kiosk(BLUE), green: kiosk(GREEN), news: kiosk(RED).concat([bx(1.6, .3, .3, 0, 1.05, 1.15, WHITE), bx(1.4, .25, .3, .1, 1.3, 1.15, '#d0d0d0')]) } };
  }
  {
    const bb = [cy(.15, .18, 6, 6, -2, 3, 0, METD), cy(.15, .18, 6, 6, 2, 3, 0, METD), bx(7, 3.2, .15, 0, 6.3, 0, WHITE, { t: 'panel' }), bx(6.8, 3, .04, 0, 6.3, .09, 2, { e: 'dark' }), bx(7.2, .1, .5, 0, 8, .3, METD)];
    URB.billboard = { r: 2.2, jit: [1, 1], light: { c: '#fff3c0', i: .8, d: 8, y: 6.5 }, parts: bb, variants: { single: bb, lit: lit(bb, true).concat([bx(.4, .2, .3, -2, 7.95, .4, '#fff3c0', { e: true }), bx(.4, .2, .3, 2, 7.95, .4, '#fff3c0', { e: true })]), double: bb.concat([bx(6.8, 3, .04, 0, 6.3, -.09, 3, { e: 'dark' })]), small: [cy(.1, .12, 3, 6, 0, 1.5, 0, METD), bx(3.4, 1.8, .12, 0, 3.6, 0, WHITE, { t: 'panel' }), bx(3.2, 1.6, .04, 0, 3.6, .08, 2, { e: 'dark' })] } };
  }
  {
    const cone = [bx(.45, .05, .45, 0, .025, 0, ORANGE), cn(.22, .7, 8, 0, .38, 0, ORANGE), cy(.17, .19, .12, 8, 0, .45, 0, WHITE)];
    URB.trafficCone = { r: .25, jit: [.95, 1.1], soft: true, parts: cone, variants: { orange: cone, striped: cone.concat([cy(.12, .14, .1, 8, 0, .62, 0, WHITE)]), drum: [cy(.25, .28, .9, 10, 0, .45, 0, ORANGE, { t: 'hazard' }), cy(.3, .3, .08, 10, 0, .04, 0, INK), cy(.26, .26, .06, 10, 0, .92, 0, INK)], lime: re(cone, { [ORANGE]: '#c8f000' }) } };
  }
  {
    const fc = (h, extra) => [bx(3, h, .04, 0, h / 2 + .1, 0, METB, { t: 'grid' }), cy(.04, .04, h + .3, 5, -1.5, (h + .3) / 2, 0, METD), cy(.04, .04, h + .3, 5, 1.5, (h + .3) / 2, 0, METD), bx(3, .04, .04, 0, h + .15, 0, METD)].concat(extra || []);
    URB.fenceChain = { r: 1.5, jit: [1, 1], len: 3, parts: fc(1.8), variants: { plain: fc(1.8), barbed: fc(2.2, [bx(3, .03, .03, 0, 2.6, .15, INK, { rx: .5 }), bx(3, .03, .03, 0, 2.7, .25, INK, { rx: .5 })]), gate: fc(1.8, [bx(.08, 2, .08, 0, 1.1, 0, METD), bx(1.5, .08, .08, .75, 1.6, 0, METD), bx(1.5, .08, .08, -.75, .4, 0, METD)]), low: fc(1.1) } };
  }
  {
    const post = [cy(.04, .05, 2.6, 5, 0, 1.3, 0, METD)];
    URB.streetSign = { r: .15, jit: [1, 1], soft: true, parts: post.concat([bx(.6, .6, .04, 0, 2.3, 0, BLUE), bx(.4, .08, .05, 0, 2.3, .01, WHITE)]), variants: { blue: post.concat([bx(.6, .6, .04, 0, 2.3, 0, BLUE), bx(.4, .08, .05, 0, 2.3, .01, WHITE)]), stop: post.concat([cy(.4, .4, .04, 8, 0, 2.3, 0, RED, { rx: R90 }), bx(.5, .1, .05, 0, 2.3, .01, WHITE)]),
      arrow: post.concat([bx(.9, .3, .04, .2, 2.4, 0, '#2f6b3a'), bx(.3, .2, .05, .4, 2.4, .01, WHITE)]), warning: post.concat([cy(.42, .42, .04, 3, 0, 2.4, 0, YEL, { rx: R90 }), cy(.3, .3, .04, 3, 0, 2.4, .02, INK, { rx: R90 })]) } };
  }
  {
    const br = [bx(6, .5, 4, 0, 2.5, 0, 1, { t: 'concrete' }), bx(.8, 2.5, 3.6, -2.5, 1.25, 0, 1, { t: 'concreteDark' }), bx(.8, 2.5, 3.6, 2.5, 1.25, 0, 1, { t: 'concreteDark' }), bx(6, .6, .1, 0, 3.05, 2, MET), bx(6, .6, .1, 0, 3.05, -2, MET)];
    URB.bridge = { r: 3, jit: [1, 1], len: 6, parts: br, variants: { concrete: br, wood: [bx(6, .25, 3, 0, 2.2, 0, 4, { t: 'plank' }), cy(.2, .25, 2.2, 6, -2.4, 1.1, 1.2, 4, { t: 'wood' }), cy(.2, .25, 2.2, 6, -2.4, 1.1, -1.2, 4, { t: 'wood' }), cy(.2, .25, 2.2, 6, 2.4, 1.1, 1.2, 4, { t: 'wood' }), cy(.2, .25, 2.2, 6, 2.4, 1.1, -1.2, 4, { t: 'wood' }), bx(6, .08, .08, 0, 3.1, 1.5, 4, { t: 'wood' }), bx(6, .08, .08, 0, 3.1, -1.5, 4, { t: 'wood' })],
      stone: [bx(6, .8, 4, 0, 2.6, 0, 1, { t: 'brick' }), cy(1.6, 1.6, 4.2, 12, 0, 1.2, 0, 1, { t: 'brick', rx: R90, s: [1, 1, 1] }), bx(6, .5, .3, 0, 3.25, 1.9, 1, { t: 'brick' }), bx(6, .5, .3, 0, 3.25, -1.9, 1, { t: 'brick' })], steel: re(br, { 1: METD }, 'metal').concat([bx(6, .1, .1, 0, 4.5, 2.1, MET), bx(6, .1, .1, 0, 4.5, -2.1, MET), bx(.1, 1.5, .1, 0, 3.8, 2.1, MET), bx(.1, 1.5, .1, 0, 3.8, -2.1, MET)]) } };
  }
  {
    const booth = c => [bx(1, 2.3, 1, 0, 1.15, 0, c, { t: 'metal' }), bx(.86, 1.5, 1.02, 0, 1.35, 0, GLASS), bx(1.1, .15, 1.1, 0, 2.38, 0, c), bx(.9, .2, .04, 0, 2.15, .51, WHITE, { e: 'dark' }), bx(.25, .4, .1, .2, 1.1, .3, INK)];
    URB.phoneBooth = { r: .6, jit: [1, 1], parts: booth(RED), variants: { red: booth(RED), blue: booth(BLUE), modern: [bx(1, 2.4, .5, 0, 1.2, 0, METD, { t: 'panel' }), bx(.9, 1.2, .06, 0, 1.5, .26, GLASSD), bx(.2, .4, .1, .25, 1.1, .3, INK), bx(.9, .2, .06, 0, 2.2, .26, CYAN, { e: 'dark' })], green: booth('#2f6b3a') } };
  }
  {
    const vend = c => [bx(1, 1.9, .8, 0, .95, 0, c, { t: 'metal' }), bx(.7, 1.2, .04, -.1, 1.15, .41, CYAN, { e: 'dark' }), bx(.15, .6, .03, .38, 1.3, .41, INK), bx(.6, .25, .03, -.1, .3, .41, INK), bx(1, .05, .8, 0, .02, 0, INK)];
    URB.vending = { r: .6, jit: [1, 1], light: { c: CYAN, i: .5, d: 4, y: 1.2 }, parts: vend(RED), variants: { red: vend(RED), blue: vend(BLUE), lit: lit(vend(RED), true), dark: vend(METD) } };
  }

  // ═══ NATURE / RURAL ═══
  const NAT = {};
  {
    const log = (x, y, z, len) => [cy(.22, .22, len, 7, x, y, z, 4, { t: 'bark', rz: R90 }), cy(.17, .17, len + .02, 7, x, y, z, '#c9a15a', { rz: R90 })];
    NAT.logPile = { r: 1.2, jit: [.9, 1.2], parts: cat(log(0, .22, .25, 2.2), log(0, .22, -.25, 2.2), log(.1, .62, 0, 2)), variants: { three: cat(log(0, .22, .25, 2.2), log(0, .22, -.25, 2.2), log(.1, .62, 0, 2)),
      stack: cat(log(0, .22, .5, 2.4), log(0, .22, 0, 2.4), log(0, .22, -.5, 2.4), log(.05, .62, .25, 2.2), log(.05, .62, -.25, 2.2), log(0, 1.02, 0, 2)),
      cut: [cy(.22, .22, .5, 7, -.4, .25, .3, 4, { t: 'bark' }), cy(.2, .2, .5, 7, .3, .25, -.2, 4, { t: 'bark' }), cy(.24, .24, .5, 7, .2, .25, .5, 4, { t: 'bark' }), cy(.19, .19, .5, 7, -.1, .75, .15, 4, { t: 'bark' }), cy(.19, .19, .06, 7, -.1, 1.02, .15, '#c9a15a')], single: log(0, .22, 0, 2.6) } };
  }
  {
    const st = [cy(.45, .6, .5, 8, 0, .25, 0, 4, { t: 'bark' }), cy(.43, .43, .04, 8, 0, .52, 0, '#c9a15a', { t: 'wood' }), bx(.5, .2, .25, .5, .1, .2, 4, { t: 'bark', rz: .2 }), bx(.4, .18, .22, -.45, .09, -.25, 4, { t: 'bark', rz: -.25 })];
    NAT.stump = { r: .6, jit: [.8, 1.3], parts: st, variants: { plain: st, axe: st.concat([bx(.06, .7, .06, .15, .85, 0, 4, { t: 'wood', rz: .5 }), bx(.22, .16, .05, -.02, 1.1, 0, MET, { t: 'metal' })]), mossy: st.concat([sp(.4, 0, .5, 0, 2, { s: [1, .18, 1], t: 'grass' })]), hollow: st.slice(0, 1).concat([cy(.3, .3, .06, 8, 0, .52, 0, BLK)], st.slice(2)) } };
  }
  {
    const mush = (c, e) => [cy(.12, .16, .5, 6, 0, .25, 0, PLASTER), sp(.4, 0, .5, 0, c, { s: [1, .55, 1], e: e }), sp(.07, .15, .68, .12, WHITE), sp(.06, -.14, .66, -.1, WHITE)];
    NAT.mushroom = { r: .3, jit: [.6, 1.4], soft: true, parts: mush(RED), variants: { red: mush(RED), brown: mush(WOOD).slice(0, 2), glow: mush(CYAN, true), cluster: cat(mush(RED), mv(mush(RED).slice(0, 2), .5, -.15, .3).map(p => Object.assign(p, { s: p.s ? [.7, .4, .7] : undefined })), mv(mush(RED).slice(0, 2), -.4, -.2, .2)) } };
  }
  {
    const bo = [dd(1.2, 0, .8, 0, 1, { s: [1.2, .75, 1] }), sp(.9, 0, 1.15, 0, 2, { s: [1.1, .35, 1], t: 'grass' }), dd(.5, 1.3, .3, .5, 1)];
    NAT.boulderMossy = { r: 1.3, jit: [.7, 1.5], parts: bo, variants: { mossy: bo, bare: [bo[0], bo[2]], cracked: [dd(1.1, -.5, .7, 0, 1, { s: [1, .75, 1] }), dd(.9, .8, .6, .2, 1, { s: [1, .7, 1.1] }), dd(.4, .1, .3, 1, 1)], pile: [dd(.9, 0, .6, 0, 1, { s: [1.2, .7, 1] }), dd(.7, 1.1, .5, .4, 1), dd(.6, -.9, .45, .5, 1), dd(.55, .2, 1.3, -.1, 1), sp(.6, .2, 1.5, 0, 2, { s: [1.1, .35, 1], t: 'grass' })] } };
  }
  {
    const ring = [cy(.9, .95, 1, 10, 0, .5, 0, 1, { t: 'brick' }), cy(.7, .7, .05, 10, 0, 1, 0, BLK), cy(.6, .6, .04, 10, 0, .95, 0, '#2a6a8a', { e: 'dark' })];
    const roof = [bx(.12, 1.8, .12, -.9, 1.9, 0, 4, { t: 'wood' }), bx(.12, 1.8, .12, .9, 1.9, 0, 4, { t: 'wood' }), cy(.05, .05, 2, 5, 0, 2.7, 0, 4, { rz: R90 }), bx(1.4, .08, 2.2, -.55, 3.1, 0, 4, { t: 'plank', rz: .6 }), bx(1.4, .08, 2.2, .55, 3.1, 0, 4, { t: 'plank', rz: -.6 }), cy(.15, .12, .25, 6, 0, 2.3, 0, METD)];
    NAT.well = { r: 1.1, jit: [.95, 1.1], parts: cat(ring, roof), variants: { stone: cat(ring, roof), wood: cat(re(ring.slice(0, 1), { 1: 4 }, 'plank'), ring.slice(1), roof), ruined: ring.concat([bx(.12, 1.2, .12, -.9, .6, 0, 4, { t: 'wood', rz: .2 }), dd(.35, 1.2, .2, .5, 1)]), dry: ring.slice(0, 2).concat(roof) } };
  }
  {
    const mill = (c, t) => [cy(2, 2.8, 8, 8, 0, 4, 0, c, { t: t }), cn(2.3, 1.8, 8, 0, 8.9, 0, 4, { t: 'plank' }), sp(.3, 0, 7.5, 2.5, 4), bx(7, .5, .08, 0, 7.5, 2.7, 4, { t: 'plank' }), bx(.5, 7, .08, 0, 7.5, 2.7, 4, { t: 'plank' }), bx(1, 1.8, .3, 0, .9, 2.7, 4, { t: 'plank' }), bx(.6, .6, .3, 0, 5, 2.6, 3, { e: 'dark' })];
    NAT.windmill = { r: 3, jit: [.9, 1.1], parts: mill(PLASTER, 'plaster'), variants: { stone: mill(1, 'brick'), wood: mill(4, 'plank'), white: mill(PLASTER, 'plaster'), dutch: mill(BRICK, 'brick').concat([bx(3.6, .5, .5, 0, 4.2, 3.2, 4, { t: 'plank' }), bx(3.6, .5, .5, 0, 4.2, -3.2, 4, { t: 'plank' })]) } };
  }
  NAT.haystack = { r: 1.3, jit: [.8, 1.3], parts: [sp(1.2, 0, .85, 0, TAN, { s: [1, .8, 1], t: 'canvas' }), sp(.6, .3, 1.6, .2, TAN, { s: [1, .7, 1], t: 'canvas' })], variants: {
    round: [sp(1.2, 0, .85, 0, TAN, { s: [1, .8, 1], t: 'canvas' }), sp(.6, .3, 1.6, .2, TAN, { s: [1, .7, 1], t: 'canvas' })], bale: [cy(.8, .8, 1.4, 10, 0, .8, 0, TAN, { t: 'canvas', rz: R90 })],
    stack: [cy(.75, .75, 1.4, 10, 0, .75, .8, TAN, { t: 'canvas', rz: R90 }), cy(.75, .75, 1.4, 10, 0, .75, -.8, TAN, { t: 'canvas', rz: R90 }), cy(.75, .75, 1.4, 10, 0, 2.1, 0, TAN, { t: 'canvas', rz: R90 })], square: [bx(1.2, .8, .9, 0, .4, 0, TAN, { t: 'canvas' }), bx(1.2, .8, .9, .1, 1.2, .05, '#c9a545', { t: 'canvas' })] } };
  {
    const sc = [bx(.1, 2.2, .1, 0, 1.1, 0, 4, { t: 'wood' }), bx(1.4, .08, .08, 0, 1.6, 0, 4, { t: 'wood' }), bx(.5, .7, .3, 0, 1.45, 0, '#7a5230', { t: 'fabric' }), sp(.2, 0, 2.05, 0, TAN, { t: 'canvas' }), bx(.1, .8, .16, .5, 1.05, 0, '#3b4a6b', { t: 'fabric' }), bx(.1, .8, .16, -.5, 1.05, 0, '#3b4a6b', { t: 'fabric' })];
    NAT.scarecrow = { r: .4, jit: [.9, 1.1], parts: sc.concat([cn(.32, .3, 7, 0, 2.32, 0, 4)]), variants: { plain: sc, hat: sc.concat([cn(.32, .3, 7, 0, 2.32, 0, 4)]), crow: sc.concat([cn(.32, .3, 7, 0, 2.32, 0, 4), sp(.1, .6, 1.72, 0, BLK, { s: [1, .8, 1.6] }), cn(.04, .1, 4, .6, 1.72, .18, YEL, { rx: R90 })]), field: sc.concat([cn(.32, .3, 7, 0, 2.32, 0, 4), cn(.22, .7, 4, .5, .35, .4, '#8c8a3a'), cn(.2, .6, 4, -.5, .3, -.3, '#8c8a3a')]) } };
  }
  {
    const barn = (c, t) => [bx(6.6, 4, 10, 0, 2, 0, c, { t: t }), bx(4.9, 4.9, 9.9, 0, 4, 0, 4, { t: 'plank', rz: R45 }), bx(2.4, 3, .1, 0, 1.5, 5.05, 4, { t: 'plank' }), bx(.1, 3, .1, 0, 1.5, 5.12, WHITE), bx(1, .8, .1, 0, 5.2, 4.98, 3, { e: 'dark' }), bx(.6, .6, .1, -2.2, 2.6, 5.02, 3, { e: 'dark' }), bx(.6, .6, .1, 2.2, 2.6, 5.02, 3, { e: 'dark' })];
    NAT.barn = { r: 5, jit: [.9, 1.1], parts: barn('#b03a2e', 'plank'), variants: { red: barn('#b03a2e', 'plank'), wood: barn(4, 'plank'), grey: barn(1, 'brick'), stable: barn('#b03a2e', 'plank').slice(0, 2).concat([bx(2.4, 1.6, .1, 0, .8, 5.05, 4, { t: 'plank' }), bx(2.4, 1.3, .06, 0, 2.25, 5.03, BLK), bx(.6, .6, .1, -2.2, 2.6, 5.02, 3, { e: 'dark' })]) } };
  }
  {
    const cart = [bx(1.2, .5, 2, 0, .75, 0, 4, { t: 'plank' }), cy(.5, .5, .1, 10, -.65, .5, -.3, 4, { t: 'wood', rz: R90 }), cy(.5, .5, .1, 10, .65, .5, -.3, 4, { t: 'wood', rz: R90 }), cy(.05, .05, 1.4, 5, 0, .5, -.3, INK, { rz: R90 }), bx(.08, .08, 1.6, -.4, .55, 1.6, 4, { t: 'wood', rx: .15 }), bx(.08, .08, 1.6, .4, .55, 1.6, 4, { t: 'wood', rx: .15 })];
    NAT.cart = { r: 1.1, jit: [.95, 1.1], parts: cart, variants: { empty: cart, hay: cart.concat([sp(.6, 0, 1.2, 0, TAN, { s: [1, .7, 1.5], t: 'canvas' })]), crates: cart.concat([bx(.5, .5, .5, -.25, 1.25, .3, 5, { t: 'wood' }), bx(.45, .45, .45, .25, 1.22, -.4, 5, { t: 'wood' })]), barrels: cart.concat([cy(.3, .3, .8, 8, -.25, 1.4, 0, 4, { t: 'wood' }), cy(.3, .3, .8, 8, .3, 1.4, .1, 4, { t: 'wood' })]) } };
  }
  {
    const dead = [cy(.25, .4, 3.5, 6, 0, 1.75, 0, 4, { t: 'bark' }), cy(.06, .12, 1.8, 5, .6, 3.9, 0, 4, { t: 'bark', rz: -.9 }), cy(.06, .12, 1.6, 5, -.5, 3.7, .2, 4, { t: 'bark', rz: .9 }), cy(.05, .1, 1.4, 5, .1, 4.1, -.5, 4, { t: 'bark', rx: .8 })];
    NAT.treeDead = { r: .5, jit: [.8, 1.4], parts: dead, variants: { bare: dead, broken: [cy(.25, .4, 2, 6, 0, 1, 0, 4, { t: 'bark' }), cn(.25, .6, 6, 0, 2.3, 0, 4, { t: 'bark', rz: .3 }), cy(.05, .1, 1, 5, .3, 1.8, 0, 4, { t: 'bark', rz: -1 })], burnt: re(dead, { 4: '#2a2622' }), fallen: [cy(.25, .35, 4, 6, 0, .3, 0, 4, { t: 'bark', rz: R90 }), cy(.4, .4, .3, 7, -2, .4, 0, 4, { t: 'bark', rz: R90 }), cy(.06, .1, 1.2, 5, .8, .9, .3, 4, { t: 'bark', rz: .3 })] } };
  }
  {
    const birch = c => [cy(.12, .18, 4, 6, 0, 2, 0, WHITE, { t: 'bark' }), bx(.3, .12, .3, .05, 1.2, 0, INK), bx(.32, .1, .32, -.03, 2.6, 0, INK), sp(1, .1, 4.3, 0, c, { s: [1, 1.3, 1], t: 'leaves' }), sp(.7, .6, 3.6, .3, c, { t: 'leaves' })];
    NAT.treeBirch = { r: .5, jit: [.8, 1.4], parts: birch(LEAF2), variants: { green: birch(LEAF2), autumn: birch(YEL), bare: birch(LEAF2).slice(0, 3).concat([cy(.05, .08, 1.5, 5, .4, 4.4, 0, WHITE, { rz: -.5 }), cy(.05, .08, 1.3, 5, -.4, 4.3, .1, WHITE, { rz: .6 })]), snowy: birch(LEAF2).slice(0, 3).concat([sp(1, .1, 4.3, 0, '#e6f0f5', { s: [1, 1.3, 1], t: 'snow' })]) } };
  }
  {
    const bao = [cy(1.2, 1.8, 5, 8, 0, 2.5, 0, 4, { t: 'bark' }), cy(.2, .5, 2.6, 5, 1, 6, 0, 4, { t: 'bark', rz: -.6 }), cy(.2, .5, 2.6, 5, -1, 6, .3, 4, { t: 'bark', rz: .6 }), cy(.18, .4, 2.2, 5, 0, 6, -1, 4, { t: 'bark', rx: -.6 }), sp(2.8, 0, 7.6, 0, 2, { s: [1, .35, 1], t: 'leaves' })];
    NAT.treeBaobab = { r: 2, jit: [.8, 1.3], parts: bao, variants: { leafy: bao, bare: bao.slice(0, 4), young: sc(bao, .6), twin: bao.concat(mv(bao.slice(0, 4), 2.6, 0, 1)) } };
  }
  {
    const stalk = (x, z, h, c) => [cy(.06, .07, h, 6, x, h / 2, z, c), cy(.075, .075, .06, 6, x, h * .33, z, WOODD), cy(.075, .075, .06, 6, x, h * .66, z, WOODD)];
    const bam = (c, lc) => cat(stalk(-.3, .1, 5, c), stalk(.15, -.25, 5.6, c), stalk(.4, .3, 4.6, c), [bx(.5, .03, .12, .1, 4.5, .3, lc, { rz: .4 }), bx(.5, .03, .12, -.4, 3.8, -.1, lc, { rz: -.5 }), bx(.45, .03, .12, .6, 4.2, .1, lc, { rz: .3 })]);
    NAT.bamboo = { r: .4, jit: [.8, 1.3], parts: bam('#7fb04a', 2), variants: { green: bam('#7fb04a', 2), dry: bam('#c9b15a', '#b9a66b'), dense: cat(bam('#7fb04a', 2), [stalk(-.6, -.3, 4.2, '#7fb04a')[0], stalk(.7, -.1, 5.2, '#7fb04a')[0]]), young: sc(bam('#9ad25a', LEAF2), .6) } };
  }
  NAT.lilypad = { r: .5, jit: [.6, 1.3], soft: true, float: true, parts: [cy(.5, .5, .04, 9, 0, .12, 0, 2, { t: 'leaves' })], variants: { plain: [cy(.5, .5, .04, 9, 0, .12, 0, 2, { t: 'leaves' })], flower: [cy(.5, .5, .04, 9, 0, .12, 0, 2, { t: 'leaves' }), cn(.14, .22, 6, .15, .24, .05, '#ff8ac8'), sp(.06, .15, .32, .05, YEL)], large: [cy(.9, .9, .05, 10, 0, .12, 0, 2, { t: 'leaves' }), cy(.5, .5, .05, 9, .9, .12, .5, 2, { t: 'leaves' })], pair: [cy(.5, .5, .04, 9, 0, .12, 0, 2, { t: 'leaves' }), cy(.38, .38, .04, 9, .7, .12, .4, 2, { t: 'leaves' })] } };
  {
    const reed = (heads, h, c) => { const o = [cy(.02, .025, h, 4, -.12, h / 2, .05, c), cy(.02, .025, h * .9, 4, .1, h * .45, -.08, c), cy(.02, .025, h * 1.1, 4, .04, h * .55, .12, c), cy(.02, .025, h * .8, 4, -.05, h * .4, -.14, c)]; return heads ? o.concat([cy(.05, .05, .25, 5, -.12, h + .1, .05, 4), cy(.05, .05, .25, 5, .04, h * 1.1 + .1, .12, 4)]) : o; };
    NAT.reed = { r: .2, jit: [.7, 1.4], soft: true, parts: reed(true, 1.6, '#6f8f3a'), variants: { cattail: reed(true, 1.6, '#6f8f3a'), grass: reed(false, 1.4, '#7fb04a'), tall: reed(true, 2.3, '#6f8f3a'), dry: reed(true, 1.5, '#b9a66b') } };
  }

  // ═══ SCI-FI ═══
  const SCI = {};
  {
    const pod = c => [cy(1.2, 1.4, .4, 12, 0, .2, 0, METD, { t: 'panel' }), cy(1.3, 1.3, .08, 12, 0, .42, 0, c, { e: true }), cy(1.1, 1.1, .06, 12, 0, .45, 0, MET, { t: 'panelLit' })];
    SCI.podium = { r: 1.4, jit: [.9, 1.1], light: { c: CYAN, i: .5, d: 5, y: .6 }, parts: pod(CYAN), variants: { cyan: pod(CYAN), magenta: pod(MAG), amber: pod(AMB), tall: cat(pod(CYAN), mv(sc(pod(CYAN), .8), 0, .45), mv(sc(pod(CYAN), .6), 0, .9)) } };
  }
  {
    const base = c => [cy(.8, .85, .2, 12, 0, .1, 0, INK, { t: 'panel' }), cy(.7, .75, .06, 12, 0, .22, 0, c, { e: true })];
    SCI.hologramPad = { r: .8, jit: [.9, 1.1], light: { c: CYAN, i: .6, d: 5, y: 1 }, parts: base(CYAN).concat([sp(.5, 0, 1.3, 0, CYAN, { e: true })]), variants: { globe: base(CYAN).concat([sp(.5, 0, 1.3, 0, CYAN, { e: true })]), pyramid: base(MAG).concat([{ g: 'octa', a: [.5, 0], p: [0, 1.4, 0], s: [1, 1.6, 1], c: MAG, e: true }]),
      figure: base(CYAN).concat([cy(.25, .3, 1.1, 8, 0, .8, 0, CYAN, { e: true }), sp(.22, 0, 1.6, 0, CYAN, { e: true })]), off: base(INK) } };
  }
  {
    const cap = (c, glass) => [cy(.7, .75, .2, 10, 0, .1, 0, METD, { t: 'panel' }), cy(.6, .6, 2.2, 10, 0, 1.3, 0, c, { t: 'metalBrushed' }), sp(.6, 0, 2.4, 0, c, { s: [1, .5, 1], t: 'metalBrushed' }), bx(.7, 1.4, .5, 0, 1.35, .35, glass), bx(.3, .1, .04, 0, .55, .62, CYAN, { e: 'dark' })];
    SCI.capsule = { r: .8, jit: [.95, 1.05], parts: cap(MET, GLASS), variants: { standing: cap(MET, GLASS), dark: cap(METD, GLASSD), lying: [bx(1.4, .4, 2.6, 0, .2, 0, METD, { t: 'panel' }), cy(.6, .6, 2.2, 10, 0, .9, 0, MET, { t: 'metalBrushed', rx: R90 }), bx(.9, .5, 1.4, 0, 1.25, 0, GLASS), bx(.3, .1, .04, .5, .45, 1.31, CYAN, { e: 'dark' })],
      open: cap(MET, GLASS).slice(0, 3).concat([bx(.7, 1.4, .06, -.7, 1.35, .3, GLASS), bx(.5, 1.2, .3, 0, 1.35, .2, BLK)]) } };
  }
  {
    const rx = (c, on) => [cy(1.8, 1.9, 1.2, 10, 0, .6, 0, METD, { t: 'panel' }), cy(1.8, 1.8, 1.2, 10, 0, 2.5, 0, METD, { t: 'panel' }), cy(1.6, 1.6, 3.2, 10, 0, 1.6, 0, c, { e: on ? true : 'dark' }), cn(1.2, .7, 10, 0, 3.45, 0, INK), cy(.15, .15, 1.6, 6, 2.2, 1.6, 0, MET, { t: 'metal', rz: R90 }), cy(.15, .15, 1.6, 6, -2.2, 1.6, 0, MET, { t: 'metal', rz: R90 }), bx(.6, .5, .06, 0, .7, 1.86, c, { e: on ? true : 'dark' })];
    SCI.reactor = { r: 2, jit: [.95, 1.05], light: { c: CYAN, i: 2, d: 14, y: 1.6 }, parts: rx(CYAN, true), variants: { cyan: rx(CYAN, true), orange: rx('#ff7a2a', true), green: rx(TOX, true), offline: rx('#3a4a52', false) } };
  }
  {
    const pad = [bx(2.4, .3, 2.4, 0, .15, 0, METD, { t: 'panel' }), bx(.2, .06, .2, -1, .33, -1, TOX, { e: true }), bx(.2, .06, .2, 1, .33, -1, TOX, { e: true }), bx(.2, .06, .2, -1, .33, 1, TOX, { e: true }), bx(.2, .06, .2, 1, .33, 1, TOX, { e: true })];
    const drone = [sp(.3, 0, .8, 0, MET, { s: [1.4, .5, 1.4], t: 'metalBrushed' }), cy(.25, .25, .03, 8, -.5, .88, -.5, INK), cy(.25, .25, .03, 8, .5, .88, -.5, INK), cy(.25, .25, .03, 8, -.5, .88, .5, INK), cy(.25, .25, .03, 8, .5, .88, .5, INK), sp(.06, 0, .8, .4, '#ff3030', { e: true })];
    SCI.droneDock = { r: 1.3, jit: [1, 1], light: { c: TOX, i: .4, d: 4, y: .5 }, parts: cat(pad, drone), variants: { withDrone: cat(pad, drone), empty: pad, charging: cat(pad, drone, [bx(.3, 1.2, .3, -1.05, .9, -1.05, METD, { t: 'panel' }), cy(.03, .03, 1, 4, -.5, .8, -.5, INK, { rz: R90 })]), hover: cat(pad, mv(drone, 0, 1.4)) } };
  }
  {
    const rack = on => [bx(.8, 2.2, 1, 0, 1.1, 0, INK, { t: 'panel' }), bx(.7, 2, .04, 0, 1.1, .5, BLK), bx(.6, .05, .02, 0, .5, .52, TOX, { e: on ? true : 'dark' }), bx(.6, .05, .02, 0, 1, .52, CYAN, { e: on ? true : 'dark' }), bx(.6, .05, .02, 0, 1.5, .52, TOX, { e: on ? true : 'dark' }), bx(.6, .05, .02, 0, 1.9, .52, CYAN, { e: on ? true : 'dark' })];
    SCI.serverRack = { r: .7, jit: [1, 1], light: { c: CYAN, i: .4, d: 4, y: 1.5 }, parts: rack(true), variants: { lit: rack(true), dark: rack(false), row: cat(rack(true), mv(rack(true).slice(0, 4), -.85), mv(rack(true).slice(0, 4), .85)), damaged: rack(false).slice(0, 2).concat([bx(.6, .05, .02, 0, 1, .52, '#ff3030', { e: true }), bx(.5, .4, .2, .1, 1.5, .5, INK, { rz: .3 })]) } };
  }
  {
    const tp = c => [cy(1.4, 1.5, .3, 12, 0, .15, 0, METD, { t: 'panel' }), cy(1.2, 1.2, .35, 12, 0, .18, 0, c, { e: true }), bx(.4, 3, .4, -1.4, 1.5, 0, MET, { t: 'metal' }), bx(.4, 3, .4, 1.4, 1.5, 0, MET, { t: 'metal' }), bx(3.2, .4, .4, 0, 3.2, 0, MET, { t: 'metal' }), cy(1.1, 1.1, .05, 12, 0, 1.2, 0, c, { e: true }), cy(1, 1, .05, 12, 0, 2.2, 0, c, { e: true })];
    SCI.teleporter = { r: 1.6, jit: [1, 1], light: { c: CYAN, i: 1.2, d: 8, y: 1.2 }, parts: tp(CYAN), variants: { arch: tp(CYAN), magenta: tp(MAG), ring: tp(CYAN).slice(0, 2).concat([cy(1.1, 1.1, .05, 12, 0, 1, 0, CYAN, { e: true }), cy(1.05, 1.05, .05, 12, 0, 1.8, 0, CYAN, { e: true }), cy(1, 1, .05, 12, 0, 2.6, 0, CYAN, { e: true })]), offline: tp('#3a4a52').slice(0, 5) } };
  }
  {
    const panel = (x, z) => [bx(.15, 1, .15, x, .5, z, METD), bx(2.4, .08, 1.6, x, 1.2, z, NAVY, { t: 'grid', rx: -.5 }), bx(2.5, .04, 1.7, x, 1.17, z, MET, { rx: -.5 })];
    SCI.solarPanel = { r: 1.3, jit: [1, 1], parts: panel(0, 0), variants: { single: panel(0, 0), row: cat(panel(-2.6, 0), panel(0, 0), panel(2.6, 0)), flat: [bx(.15, .5, .15, 0, .25, 0, METD), bx(2.4, .08, 1.6, 0, .55, 0, NAVY, { t: 'grid' })], tall: [cy(.12, .16, 3, 6, 0, 1.5, 0, METD), bx(2.6, .08, 1.8, 0, 3.2, 0, NAVY, { t: 'grid', rx: -.6 })] } };
  }
  {
    const dome = (c, t) => [sp(3, 0, .2, 0, c, { s: [1, .75, 1], t: t }), cy(3.1, 3.2, .3, 16, 0, .15, 0, METD, { t: 'panel' }), bx(1.2, 2, .5, 0, 1, 2.75, METD, { t: 'panel' }), bx(1, 1.7, .1, 0, .95, 3.02, GLASSD), bx(.5, .1, .06, 0, 1.95, 3.03, CYAN, { e: 'dark' })];
    SCI.dome = { r: 3.2, jit: [.9, 1.2], parts: dome('#c9d8e0', 'panel'), variants: { metal: dome('#c9d8e0', 'panel'), glass: dome(GLASS, 'panel'), habitat: dome('#c9d8e0', 'panel').concat([cy(1, 1, 3, 8, -3.6, 1, 0, MET, { t: 'metal', rz: R90 }), cy(1.2, 1.2, .3, 8, -5, 1, 0, METD, { rz: R90 })]), dark: dome(METD, 'panel') } };
  }
  {
    const dish = (r, c) => [bx(1, .4, 1, 0, .2, 0, METD, { t: 'panel' }), cy(.1, .1, 1.6, 6, 0, 1.2, 0, METD), cy(r, r * .25, .5, 12, 0, 2.2, -.4, c, { t: 'metalBrushed', rx: -.9 }), cy(.03, .03, r, 4, 0, 2.7, .2, METD, { rx: -.9 }), sp(.08, 0, 3.1, .5, '#ff3030', { e: 'dark' })];
    SCI.satelliteDish = { r: 1.2, jit: [.9, 1.2], parts: dish(1.4, WHITE), variants: { white: dish(1.4, WHITE), dark: dish(1.4, METD), large: dish(2.4, WHITE), rusty: re(dish(1.4, RUST), {}, 'rust') } };
  }

  // ═══ MEDIEVAL / RUINS ═══
  const MED = {};
  {
    const low = [bx(4, 2.2, .8, 0, 1.1, 0, 1, { t: 'brick' }), bx(1.5, 1, .8, -1, 2.7, 0, 1, { t: 'brick' }), bx(1, .6, .8, 1.2, 2.5, 0, 1, { t: 'brick' }), dd(.4, 1.8, .3, .9, 1), dd(.3, -1.2, .2, -.8, 1)];
    MED.wallRuin = { r: 2.1, jit: [.9, 1.1], len: 4, parts: low, variants: { low: low, tall: [bx(4, 3.5, .8, 0, 1.75, 0, 1, { t: 'brick' }), bx(1.2, 1.2, .8, -1.4, 4, 0, 1, { t: 'brick' }), bx(.8, .6, .8, .8, 3.7, 0, 1, { t: 'brick' }), bx(.6, .9, .82, 1.2, 1.5, 0, BLK), dd(.4, 2.2, .3, .9, 1)],
      corner: low.concat([bx(.8, 2, 3, -1.6, 1, -1.9, 1, { t: 'brick' }), bx(.8, .8, 1, -1.6, 2.4, -1, 1, { t: 'brick' })]), mossy: low.concat([sp(.9, -.8, 3.1, 0, 2, { s: [1, .25, 1], t: 'grass' }), sp(.6, 1.2, 2.75, .2, 2, { s: [1, .25, 1], t: 'grass' })]) } };
  }
  {
    const arch = [bx(1, 4, 1, -1.8, 2, 0, 1, { t: 'brick' }), bx(1, 4, 1, 1.8, 2, 0, 1, { t: 'brick' }), bx(4.6, 1, 1, 0, 4.5, 0, 1, { t: 'brick' }), bx(.8, 1.2, 1.05, 0, 4.6, 0, CONCD, { t: 'concrete' }), bx(1.3, .3, 1.3, -1.8, .15, 0, 1, { t: 'concrete' }), bx(1.3, .3, 1.3, 1.8, .15, 0, 1, { t: 'concrete' })];
    MED.arch = { r: 2.4, jit: [.9, 1.2], parts: arch, variants: { stone: arch, ruined: [arch[0], arch[4], arch[5], bx(1, 1.6, 1, 1.8, .8, 0, 1, { t: 'brick' }), bx(1.2, .8, 1, .4, 4.4, 0, 1, { t: 'brick', rz: .2 }), dd(.5, 1.6, .4, 1, 1)], double: cat(arch, mv(arch, 3.6)), tall: [bx(1, 6, 1, -1.8, 3, 0, 1, { t: 'brick' }), bx(1, 6, 1, 1.8, 3, 0, 1, { t: 'brick' }), bx(4.6, 1, 1, 0, 6.5, 0, 1, { t: 'brick' }), bx(.8, 1.2, 1.05, 0, 6.6, 0, CONCD, { t: 'concrete' }), arch[4], arch[5]] } };
  }
  {
    const st = (c, t) => [bx(1.2, 1, 1.2, 0, .5, 0, 1, { t: 'concrete' }), cy(.3, .38, 1.4, 8, 0, 1.7, 0, c, { t: t }), sp(.25, 0, 2.6, 0, c, { t: t }), bx(.18, .8, .18, .4, 2.4, .1, c, { t: t, rz: -.6 }), bx(.18, .7, .18, -.35, 1.9, .1, c, { t: t, rz: .3 })];
    MED.statue = { r: .8, jit: [.9, 1.2], parts: st(1, 'concrete'), variants: { stone: st(1, 'concrete'), bronze: st('#7a5a2a', 'metal'), broken: st(1, 'concrete').slice(0, 2).concat([bx(.18, .7, .18, -.35, 1.9, .1, 1, { t: 'concrete', rz: .3 }), dd(.25, .5, .15, .5, 1)]), knight: st(1, 'concrete').concat([bx(.06, 1.6, .06, .55, 2.4, .2, MET), bx(.6, .7, .1, -.5, 1.7, .2, 1, { t: 'concrete' })]) } };
  }
  {
    const bz = (c, t) => [cy(.5, .3, .5, 8, 0, 1.05, 0, c, { t: t }), cy(.08, .08, .8, 6, 0, .4, 0, c), cy(.35, .4, .1, 8, 0, .05, 0, c), cn(.3, .7, 6, 0, 1.55, 0, FIRE, { e: true }), cn(.16, .5, 5, 0, 1.75, 0, FIRE2, { e: true })];
    MED.brazier = { r: .6, jit: [.95, 1.1], light: { c: '#ff9a3c', i: 1.6, d: 9, y: 1.5 }, parts: bz(METD, 'metalDark'), variants: { iron: bz(METD, 'metalDark'), stone: bz(1, 'concrete'), tall: [cy(.5, .3, .5, 8, 0, 1.75, 0, METD, { t: 'metalDark' }), cy(.08, .08, 1.5, 6, 0, .75, 0, METD), cy(.35, .4, .1, 8, 0, .05, 0, METD), cn(.3, .7, 6, 0, 2.25, 0, FIRE, { e: true }), cn(.16, .5, 5, 0, 2.45, 0, FIRE2, { e: true })], unlit: bz(METD, 'metalDark').slice(0, 3).concat([sp(.2, 0, 1.15, 0, INK, { s: [1, .5, 1] })]) } };
  }
  {
    const tw = [bx(1.4, 4.5, 1.4, -2.3, 2.25, 0, 1, { t: 'brick' }), bx(1.4, 4.5, 1.4, 2.3, 2.25, 0, 1, { t: 'brick' }), bx(6, .8, 1.4, 0, 4.6, 0, 1, { t: 'brick' }), bx(.5, .5, 1.4, -2.3, 4.85, 0, 1, { t: 'brick' }), bx(.5, .5, 1.4, 2.3, 4.85, 0, 1, { t: 'brick' })];
    MED.gate = { r: 3.2, jit: [1, 1], len: 6, parts: tw.concat([bx(3.2, 3.4, .3, 0, 1.7, 0, 4, { t: 'plank' }), bx(3.2, .15, .35, 0, 2.4, 0, INK)]), variants: { closed: tw.concat([bx(3.2, 3.4, .3, 0, 1.7, 0, 4, { t: 'plank' }), bx(3.2, .15, .35, 0, 2.4, 0, INK)]),
      open: tw.concat([bx(.3, 3.4, 1.5, -1.5, 1.7, .9, 4, { t: 'plank' }), bx(.3, 3.4, 1.5, 1.5, 1.7, .9, 4, { t: 'plank' })]), iron: tw.concat([bx(3.2, 3.6, .1, 0, 1.8, 0, INK, { t: 'grid' })]),
      ruined: [tw[0], bx(1.4, 2, 1.4, 2.3, 1, 0, 1, { t: 'brick' }), bx(2, .8, 1.4, -1, 4.6, 0, 1, { t: 'brick', rz: -.2 }), dd(.6, 1.6, .4, .8, 1), dd(.4, 2.6, .3, -.9, 1)] } };
  }
  {
    const tent = (c, t) => [cn(2, 2.6, 8, 0, 1.3, 0, c, { t: t }), cy(.05, .05, 2.7, 4, 0, 1.35, 0, 4), cn(.5, 1.2, 3, 0, .6, 1.75, BLK, { rx: R90 })];
    MED.tent = { r: 2, jit: [.9, 1.2], parts: tent(CANV, 'canvas'), variants: { canvas: tent(CANV, 'canvas'), red: tent('#b03a2e', 'fabric'), large: [bx(4.6, 3, 4.6, 0, 1.4, 0, CANV, { t: 'canvas', rz: R45, s: [1, .55, 1] }), bx(.12, 3, .12, -1.4, 1.5, 0, 4), bx(.12, 3, .12, 1.4, 1.5, 0, 4), bx(1.2, 1.4, .1, 0, .7, 2.3, BLK)],
      striped: tent('#e6dcc0', 'fabric').concat([cy(2.05, 1.8, .5, 8, 0, .25, 0, RED, { t: 'fabric' })]) } };
  }
  {
    const flag = c => [cy(.05, .06, 3.5, 5, 0, 1.75, 0, 4, { t: 'wood' }), bx(.9, .05, .05, .4, 3.4, 0, 4), bx(.8, 1.8, .04, .45, 2.45, 0, c, { t: 'fabric' }), sp(.08, 0, 3.55, 0, YEL)];
    MED.banner = { r: .2, jit: [.95, 1.1], parts: flag(5), variants: { red: flag('#b03a2e'), blue: flag(BLUE), gold: flag(YEL), tattered: flag('#7a5a4a').slice(0, 2).concat([bx(.8, 1, .04, .45, 2.85, 0, '#7a5a4a', { t: 'fabric' }), bx(.3, .6, .04, .2, 2.05, 0, '#7a5a4a', { t: 'fabric' })]) } };
  }
  {
    const anvil = [cy(.35, .4, .45, 8, 0, .22, 0, 4, { t: 'bark' }), bx(.5, .3, .4, 0, .6, 0, METD, { t: 'metalDark' }), bx(.9, .28, .35, 0, .9, 0, METD, { t: 'metalDark' }), cn(.12, .5, 6, .65, .92, 0, METD, { rz: -R90 })];
    MED.anvil = { r: .4, jit: [.95, 1.1], parts: anvil, variants: { onStump: anvil, iron: anvil.slice(1).map(p => Object.assign({}, p, { p: [p.p[0], p.p[1] - .35, p.p[2]] })).concat([bx(.6, .12, .5, 0, .06, 0, METD)]), withHammer: anvil.concat([bx(.06, .5, .06, -.1, 1.15, .1, 4, { t: 'wood', rz: .9 }), bx(.16, .1, .1, .12, 1.06, .1, MET)]), hot: anvil.concat([bx(.3, .04, .08, .1, 1.06, 0, '#ff7a2a', { e: true })]) } };
  }
  {
    const brl = (x, y, z, rz) => [cy(.4, .4, 1, 9, x, y, z, 4, { t: 'wood', rz: rz }), cy(.42, .42, .08, 9, x, y, z, INK, { rz: rz }), cy(.41, .41, .08, 9, x + (rz ? .3 : 0), y + (rz ? 0 : .3), z, INK, { rz: rz })];
    MED.barrelStack = { r: 1, jit: [.9, 1.1], parts: cat(brl(0, .4, .45, R90), brl(0, .4, -.45, R90), brl(0, 1.15, 0, R90)), variants: { pyramid: cat(brl(0, .4, .45, R90), brl(0, .4, -.45, R90), brl(0, 1.15, 0, R90)), row: cat(brl(-.9, .5, 0, 0), brl(0, .5, .1, 0), brl(.9, .5, -.05, 0)),
      big: cat(brl(0, .4, .9, R90), brl(0, .4, 0, R90), brl(0, .4, -.9, R90).slice(0, 2), brl(0, 1.15, .45, R90).slice(0, 2), brl(0, 1.15, -.45, R90).slice(0, 2), brl(0, 1.9, 0, R90).slice(0, 2)), single: brl(0, .5, 0, 0) } };
  }
  {
    const wag = [bx(1.6, .7, 3, 0, 1.05, 0, 4, { t: 'plank' }), cy(.55, .55, .12, 10, -.85, .55, 1, 4, { t: 'wood', rz: R90 }), cy(.55, .55, .12, 10, .85, .55, 1, 4, { t: 'wood', rz: R90 }), cy(.55, .55, .12, 10, -.85, .55, -1, 4, { t: 'wood', rz: R90 }), cy(.55, .55, .12, 10, .85, .55, -1, 4, { t: 'wood', rz: R90 }), bx(.08, .08, 2, -.5, .8, 2.3, 4, { t: 'wood', rx: .2 }), bx(.08, .08, 2, .5, .8, 2.3, 4, { t: 'wood', rx: .2 })];
    MED.wagon = { r: 1.8, jit: [.95, 1.1], parts: wag.concat([cy(1, 1, 2.6, 10, 0, 1.8, 0, PLASTER, { t: 'canvas', rx: R90, s: [1, .8, 1] })]), variants: { covered: wag.concat([cy(1, 1, 2.6, 10, 0, 1.8, 0, PLASTER, { t: 'canvas', rx: R90, s: [1, .8, 1] })]), open: wag, hay: wag.concat([sp(.9, 0, 1.7, 0, TAN, { s: [1, .7, 1.5], t: 'canvas' })]), cargo: wag.concat([bx(.7, .7, .7, -.35, 1.75, .5, 5, { t: 'wood' }), cy(.35, .35, .9, 8, .4, 1.85, -.6, 4, { t: 'wood' }), bx(.6, .5, .6, .4, 1.65, .6, 5, { t: 'wood' })]) } };
  }

  // ═══ INTERIOR ═══ (metres, furniture faces +z with its back at −z; wall-hung kinds — window, pictureFrame — are soft and take a `y` in place(); rug/pillow soft too)
  const INT = {};
  const CREAM = '#f3ead8', SKY = '#d6ecff', TEAL = '#4fb3a0', BROWN = '#6b4a2e', PAGE = '#efe6cf', SCREEN = '#9fdcff', BULB = '#fff3c0', WINE = '#8b3a5a', OAK = '#a4713f';
  const legs = (w, d, h, c) => [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(q => bx(.06, h, .06, q[0] * (w / 2 - .06), h / 2, q[1] * (d / 2 - .06), c));
  {
    const top = (w, d, y) => bx(w, .05, d, 0, y, 0, 4, { t: 'wood' });
    INT.table = { r: .9, jit: [1, 1], parts: cat([top(1.8, .9, .73)], legs(1.8, .9, .7, WOODD)), variants: { dining: cat([top(1.8, .9, .73)], legs(1.8, .9, .7, WOODD)), coffee: cat([top(1.1, .6, .38)], legs(1.1, .6, .36, WOODD)),
      desk: [top(1.4, .7, .73), bx(.05, .7, .68, -.67, .35, 0, 4, { t: 'wood' }), bx(.05, .7, .68, .67, .35, 0, 4, { t: 'wood' }), bx(1.3, .5, .04, 0, .5, -.32, 4, { t: 'wood' }), bx(.5, .12, .03, .4, .64, .34, WOODD), sp(.02, .4, .64, .36, METB)],
      round: [cy(.6, .6, .04, 14, 0, .73, 0, 4, { t: 'wood' }), cy(.06, .06, .7, 6, 0, .36, 0, WOODD), cy(.3, .35, .04, 10, 0, .02, 0, WOODD)] } };
  }
  {
    const wood = cat([bx(.45, .04, .45, 0, .45, 0, 4, { t: 'wood' }), bx(.45, .5, .04, 0, .72, -.21, 4, { t: 'wood' })], legs(.45, .45, .43, WOODD));
    INT.chair = { r: .35, jit: [1, 1], parts: wood, variants: { wood: wood, office: [bx(.5, .08, .5, 0, .47, 0, INK, { t: 'leather' }), bx(.48, .55, .08, 0, .8, -.23, INK, { t: 'leather' }), cy(.03, .03, .4, 6, 0, .23, 0, MET), cy(.3, .3, .04, 10, 0, .03, 0, METD)],
      stool: [cy(.18, .18, .04, 10, 0, .62, 0, 4, { t: 'wood' }), cy(.02, .02, .6, 5, .14, .3, 0, WOODD), cy(.02, .02, .6, 5, -.07, .3, .12, WOODD), cy(.02, .02, .6, 5, -.07, .3, -.12, WOODD)],
      armchair: [bx(.9, .4, .85, 0, .2, 0, '#8b3a3a', { t: 'fabric' }), bx(.6, .12, .6, 0, .46, .05, '#a04848', { t: 'fabric' }), bx(.15, .6, .85, -.375, .3, 0, '#8b3a3a', { t: 'fabric' }), bx(.15, .6, .85, .375, .3, 0, '#8b3a3a', { t: 'fabric' }), bx(.9, .5, .15, 0, .65, -.35, '#8b3a3a', { t: 'fabric' })] } };
  }
  {
    const sofa = (c, c2, t) => [bx(2, .35, .9, 0, .3, 0, c, { t: t }), bx(.9, .12, .6, -.48, .42, .1, c2, { t: t }), bx(.9, .12, .6, .48, .42, .1, c2, { t: t }), bx(2, .5, .18, 0, .65, -.36, c, { t: t }), bx(.18, .55, .9, -.91, .4, 0, c, { t: t }), bx(.18, .55, .9, .91, .4, 0, c, { t: t })];
    INT.sofa = { r: 1.1, jit: [1, 1], parts: sofa('#a8353a', '#b84a4f', 'fabric'), variants: { red: sofa('#a8353a', '#b84a4f', 'fabric'), blue: sofa('#2f4f8a', '#3d5f9c', 'fabric'), leather: sofa(BROWN, '#7a5a3a', 'leather'),
      corner: sofa('#a8353a', '#b84a4f', 'fabric').concat([bx(.9, .35, 1.4, .55, .3, 1.15, '#a8353a', { t: 'fabric' }), bx(.6, .12, 1.2, .5, .42, 1.15, '#b84a4f', { t: 'fabric' }), bx(.18, .5, 1.4, .96, .65, 1.15, '#a8353a', { t: 'fabric' })]) } };
  }
  {
    const frame = h => [bx(.04, h, .35, -.48, h / 2, 0, 4, { t: 'wood' }), bx(.04, h, .35, .48, h / 2, 0, 4, { t: 'wood' }), bx(1, h, .03, 0, h / 2, -.16, WOODD), bx(1, .04, .35, 0, h - .02, 0, 4, { t: 'wood' }), bx(1, .04, .35, 0, .02, 0, 4, { t: 'wood' })];
    const BK = [RED, BLUE, GREEN, YEL, TEAL];
    const shelves = (h, n, books) => { const o = []; for (let i = 0; i < n; i++) { const y = .04 + (h - .08) * i / n; if (i) o.push(bx(.92, .03, .33, 0, y, 0, 4, { t: 'wood' })); if (books) o.push(bx(.84, .26, .2, 0, y + .15, 0, BK[i % 5])); } return o; };
    INT.bookshelf = { r: .55, jit: [1, 1], parts: cat(frame(2), shelves(2, 4, true)), variants: { full: cat(frame(2), shelves(2, 4, true)), half: cat(frame(1), shelves(1, 2, true)), empty: cat(frame(2), shelves(2, 4, false)), tall: cat(frame(2.6), shelves(2.6, 4, true)) } };
  }
  {
    const book = (c, x, y, z) => [bx(.2, .03, .28, x, y + .015, z, c), bx(.19, .024, .27, x + .012, y + .015, z, PAGE)];
    INT.book = { r: .15, jit: [.9, 1.15], parts: book(RED, 0, 0, 0), variants: { red: book(RED, 0, 0, 0), blue: book(BLUE, 0, 0, 0), green: book(GREEN, 0, 0, 0), stack: cat(book(RED, 0, 0, 0), book(BLUE, .02, .03, -.02), book(GREEN, -.015, .06, .015), book(YEL, .01, .09, .03)) } };
  }
  {
    const floor = [cy(.15, .18, .03, 10, 0, .015, 0, METD), cy(.02, .02, 1.45, 6, 0, .75, 0, MET), cy(.15, .22, .3, 10, 0, 1.55, 0, CREAM), sp(.06, 0, 1.45, 0, BULB, { e: true })];
    INT.lampInterior = { r: .25, jit: [1, 1], light: { c: '#ffe4b0', i: .9, d: 6, y: 1.2 }, parts: floor, variants: { floor: floor, desk: [cy(.08, .1, .02, 8, 0, .01, 0, METD), cy(.012, .012, .4, 5, .08, .2, 0, MET, { rz: -.4 }), cy(.05, .1, .12, 8, .2, .42, 0, '#2f6b3a'), sp(.03, .2, .38, 0, BULB, { e: true })],
      ceiling: [cy(.01, .01, .5, 4, 0, 2.55, 0, INK), cy(.12, .28, .2, 10, 0, 2.2, 0, CREAM), sp(.06, 0, 2.12, 0, BULB, { e: true })], neon: [bx(.6, .25, .03, 0, 1.6, 0, INK), bx(.5, .05, .04, 0, 1.6, .03, MAG, { e: true }), bx(.05, .15, .04, -.2, 1.6, .03, MAG, { e: true })] } };
  }
  {
    const bed = (w, c) => [bx(w, .25, 2, 0, .25, 0, 4, { t: 'wood' }), bx(w - .1, .2, 1.9, 0, .47, 0, WHITE, { t: 'fabric' }), bx(w - .1, .06, 1.2, 0, .6, .3, c, { t: 'fabric' }), bx(w * .6, .1, .4, 0, .62, -.7, CREAM), bx(w, .8, .06, 0, .6, -1, 4, { t: 'wood' })];
    INT.bed = { r: 1, jit: [1, 1], parts: bed(1, BLUE), variants: { single: bed(1, BLUE), double: bed(1.8, WINE),
      bunk: bed(1, BLUE).concat([bx(.08, 1.8, .08, -.46, .9, .96, 4), bx(.08, 1.8, .08, .46, .9, .96, 4), bx(.08, 1.8, .08, -.46, .9, -.96, 4), bx(.08, 1.8, .08, .46, .9, -.96, 4), bx(1, .15, 2, 0, 1.5, 0, 4, { t: 'wood' }), bx(.9, .18, 1.9, 0, 1.66, 0, WHITE, { t: 'fabric' }), bx(.9, .06, 1.2, 0, 1.78, .3, RED, { t: 'fabric' }), bx(.6, .1, .4, 0, 1.8, -.7, CREAM)]),
      crib: [bx(.8, .15, 1.3, 0, .4, 0, 4, { t: 'wood' }), bx(.72, .12, 1.22, 0, .53, 0, WHITE, { t: 'fabric' }), bx(.05, .9, .05, -.4, .45, .65, 4), bx(.05, .9, .05, .4, .45, .65, 4), bx(.05, .9, .05, -.4, .45, -.65, 4), bx(.05, .9, .05, .4, .45, -.65, 4), bx(.8, .04, .03, 0, .85, .65, 4), bx(.8, .04, .03, 0, .85, -.65, 4), bx(.03, .04, 1.3, -.4, .85, 0, 4), bx(.03, .04, 1.3, .4, .85, 0, 4)] } };
  }
  {
    const pot = [cy(.16, .12, .3, 8, 0, .15, 0, '#b9613a'), cy(.14, .14, .02, 8, 0, .31, 0, BROWN)];
    INT.plant = { r: .35, jit: [.8, 1.2], parts: pot.concat([sp(.32, 0, .62, 0, 2, { t: 'leaves' })]), variants: { pot: pot.concat([sp(.32, 0, .62, 0, 2, { t: 'leaves' })]), fern: pot.concat([cn(.12, .5, 4, 0, .55, 0, LEAF), cn(.12, .5, 4, .12, .5, .05, LEAF, { rz: -.5 }), cn(.12, .5, 4, -.12, .5, -.05, LEAF, { rz: .5 })]),
      cactus: pot.concat([cy(.09, .1, .7, 7, 0, .65, 0, '#4f8a3a'), cy(.05, .05, .25, 6, .18, .75, 0, '#4f8a3a', { rz: R90 }), cy(.05, .05, .2, 6, .28, .9, 0, '#4f8a3a')]),
      tall: [cy(.25, .2, .5, 8, 0, .25, 0, '#8a6a4a'), cy(.04, .05, 1.1, 5, 0, 1, 0, 4, { t: 'bark' }), sp(.4, 0, 1.55, 0, 2, { t: 'leaves' }), sp(.3, .2, 1.8, .1, 2, { t: 'leaves' })] } };
  }
  INT.cup = { r: .06, jit: [.9, 1.1], parts: [cy(.04, .035, .09, 8, 0, .045, 0, 5), bx(.03, .05, .012, .05, .045, 0, 5)], variants: { mug: [cy(.04, .035, .09, 8, 0, .045, 0, 5), bx(.03, .05, .012, .05, .045, 0, 5)], glass: [cy(.035, .03, .1, 8, 0, .05, 0, GLASS)],
    teapot: [sp(.09, 0, .09, 0, 5), cn(.02, .1, 5, .1, .12, 0, 5, { rz: -1 }), sp(.03, 0, .17, 0, 5), bx(.03, .08, .015, -.1, .1, 0, 5)], bottle: [cy(.035, .035, .2, 8, 0, .1, 0, '#2f7a4a'), cy(.015, .03, .06, 6, 0, .23, 0, '#2f7a4a'), cy(.017, .017, .02, 6, 0, .27, 0, METB)] } };
  INT.rug = { r: .5, jit: [1, 1], soft: true, parts: [cy(1.5, 1.5, .04, 16, 0, .02, 0, WINE, { t: 'fabric' }), cy(1, 1, .045, 16, 0, .02, 0, '#c9a06a', { t: 'fabric' })], variants: { round: [cy(1.5, 1.5, .04, 16, 0, .02, 0, WINE, { t: 'fabric' }), cy(1, 1, .045, 16, 0, .02, 0, '#c9a06a', { t: 'fabric' })],
    rect: [bx(4, .04, 3, 0, .02, 0, '#3b4a6b', { t: 'fabric' }), bx(3.4, .045, 2.4, 0, .02, 0, '#5a6b8f', { t: 'fabric' })], runner: [bx(1, .04, 4, 0, .02, 0, WINE, { t: 'fabric' }), bx(.6, .045, 3.6, 0, .02, 0, '#c9a06a', { t: 'fabric' })],
    patterned: [bx(4, .04, 4, 0, .02, 0, '#b89a78', { t: 'fabric' }), bx(3.2, .045, 3.2, 0, .02, 0, '#c9b48a', { t: 'fabric' }), bx(1.6, .05, 1.6, 0, .02, 0, WINE, { t: 'fabric' })] } };
  {
    const flat = [cy(.25, .3, .03, 10, 0, .015, 0, INK), bx(.06, .3, .04, 0, .17, 0, INK), bx(1.3, .75, .05, 0, .7, 0, BLK), bx(1.22, .67, .02, 0, .7, .03, SCREEN, { e: true })];
    INT.tv = { r: .7, jit: [1, 1], parts: flat, variants: { flat: flat, old: [bx(.7, .55, .55, 0, .5, 0, '#6b5a4a', { t: 'wood' }), bx(.5, .38, .03, -.05, .52, .28, '#b8d8e8', { e: true }), cy(.03, .03, .02, 6, .28, .45, .28, INK, { rx: R90 }), cy(.006, .006, .5, 4, -.1, 1, 0, MET, { rz: .4 }), cy(.006, .006, .5, 4, .1, 1, 0, MET, { rz: -.4 }), bx(.7, .22, .55, 0, .11, 0, INK)],
      monitor: [cy(.12, .14, .02, 8, 0, .01, 0, INK), bx(.04, .15, .03, 0, .1, 0, INK), bx(.55, .35, .03, 0, .34, 0, BLK), bx(.5, .3, .015, 0, .34, .02, SCREEN, { e: true })],
      arcade: [bx(.7, 1.6, .7, 0, .8, 0, '#2a3a8a', { t: 'panel' }), bx(.7, .3, .5, 0, 1.75, -.05, '#2a3a8a'), bx(.6, .2, .03, 0, 1.75, .21, YEL, { e: true }), bx(.55, .4, .03, 0, 1.25, .36, MAG, { e: true }), bx(.7, .15, .3, 0, .95, .45, INK), sp(.03, .15, 1.06, .45, RED), cy(.025, .025, .02, 8, -.1, 1.03, .45, RED), cy(.025, .025, .02, 8, -.2, 1.03, .45, BLUE)] } };
  }
  {
    const fr = (c, t) => [bx(.8, 1.8, .7, 0, .9, 0, c, { t: t }), bx(.82, .02, .72, 0, 1.3, 0, INK), bx(.03, .4, .03, .3, 1.55, .37, METB), bx(.03, .6, .03, .3, .85, .37, METB), bx(.78, .05, .68, 0, .025, 0, INK)];
    INT.fridge = { r: .55, jit: [1, 1], parts: fr(WHITE), variants: { white: fr(WHITE), steel: fr(METB, 'metalBrushed'), retro: fr(TEAL).concat([bx(.82, .06, .72, 0, 1.3, 0, METB, { t: 'metalBrushed' }), bx(.82, .06, .72, 0, .3, 0, METB, { t: 'metalBrushed' })]),
      open: fr(WHITE).slice(0, 2).concat([bx(.03, 1.76, .7, .41, .9, .36, WHITE), bx(.72, 1.72, .05, 0, .9, .33, '#bcd2dd'), bx(.68, .02, .3, 0, .6, .2, WHITE), bx(.68, .02, .3, 0, 1.05, .2, WHITE), bx(.6, .05, .02, 0, 1.7, .34, '#fff8e0', { e: true }), fr(WHITE)[4]]) } };
  }
  {
    const kitchen = [bx(1.5, .85, .6, 0, .43, 0, CREAM), bx(1.56, .05, .66, 0, .88, 0, '#3a3f45', { t: 'concrete' }), bx(.02, .7, .01, 0, .4, .31, INK), bx(.15, .02, .02, -.3, .6, .31, METB), bx(.15, .02, .02, .3, .6, .31, METB), cy(.2, .2, .06, 10, .4, .9, 0, METB, { t: 'metalBrushed' }), cy(.015, .015, .2, 5, .4, 1, -.1, METB)];
    INT.cabinet = { r: .85, jit: [1, 1], parts: kitchen, variants: { kitchen: kitchen, wardrobe: [bx(1.2, 2, .6, 0, 1, 0, 4, { t: 'wood' }), bx(.02, 1.9, .01, 0, 1, .31, WOODD), bx(.03, .25, .03, -.06, 1, .32, METB), bx(.03, .25, .03, .06, 1, .32, METB), bx(1.24, .05, .64, 0, 2.02, 0, WOODD)],
      drawer: [bx(.9, 1, .5, 0, .5, 0, 4, { t: 'wood' }), bx(.8, .24, .02, 0, .2, .26, WOODD), bx(.8, .24, .02, 0, .5, .26, WOODD), bx(.8, .24, .02, 0, .8, .26, WOODD), sp(.02, 0, .2, .28, METB), sp(.02, 0, .5, .28, METB), sp(.02, 0, .8, .28, METB)],
      safe: [bx(.7, .9, .7, 0, .45, 0, METD, { t: 'metalDark' }), bx(.6, .8, .02, 0, .45, .36, MET, { t: 'metal' }), cy(.06, .06, .03, 10, .15, .5, .38, METB, { rx: R90 }), bx(.12, .03, .03, -.12, .45, .38, METB)] } };
  }
  INT.toy = { r: .2, jit: [.9, 1.2], parts: [sp(.15, 0, .15, 0, RED), cy(.152, .152, .05, 10, 0, .15, 0, WHITE)], variants: { ball: [sp(.15, 0, .15, 0, RED), cy(.152, .152, .05, 10, 0, .15, 0, WHITE)], blocks: [bx(.14, .14, .14, 0, .07, 0, RED), bx(.14, .14, .14, .1, .07, .12, BLUE), bx(.14, .14, .14, .04, .21, .05, YEL)],
    car: [bx(.3, .08, .16, 0, .1, 0, RED), bx(.16, .07, .14, -.02, .17, 0, SKY), cy(.04, .04, .18, 8, -.1, .04, 0, TYRE, { rx: R90 }), cy(.04, .04, .18, 8, .1, .04, 0, TYRE, { rx: R90 })],
    teddy: [sp(.12, 0, .14, 0, OAK, { s: [1, 1.15, .9] }), sp(.09, 0, .32, 0, OAK), sp(.035, -.07, .39, 0, OAK), sp(.035, .07, .39, 0, OAK), sp(.05, -.13, .17, .02, OAK), sp(.05, .13, .17, .02, OAK), sp(.04, 0, .3, .07, '#d9b585')] } };
  INT.pillow = { r: .3, jit: [.9, 1.15], soft: true, parts: [bx(.5, .14, .5, 0, .07, 0, 5, { t: 'fabric' }), sp(.02, 0, .14, 0, INK)], variants: { square: [bx(.5, .14, .5, 0, .07, 0, 5, { t: 'fabric' }), sp(.02, 0, .14, 0, INK)], round: [sp(.28, 0, .1, 0, 5, { s: [1, .36, 1], t: 'fabric' })], long: [bx(1, .14, .4, 0, .07, 0, 5, { t: 'fabric' })],
    heart: [sp(.13, -.1, .07, .1, '#e2506e', { s: [1, .5, 1] }), sp(.13, .1, .07, .1, '#e2506e', { s: [1, .5, 1] }), cn(.2, .3, 4, 0, .07, 0, '#e2506e', { rx: -R90, s: [1, .45, 1] })] } };
  {
    const frame = (w, h) => [bx(w, h, .05, 0, .5, 0, 4, { t: 'wood' }), bx(w - .1, h - .1, .02, 0, .5, .03, 5)];
    INT.pictureFrame = { r: .5, jit: [1, 1], soft: true, parts: frame(1, .7), variants: { landscape: frame(1, .7), portrait: frame(.7, 1).concat([sp(.14, 0, .6, .045, TAN)]), mirror: [bx(.8, 1.1, .05, 0, .55, 0, METB, { t: 'metalBrushed' }), bx(.7, 1, .02, 0, .55, .03, GLASS)],
      clock: [cy(.25, .25, .05, 16, 0, .45, 0, 4, { rx: R90, t: 'wood' }), cy(.22, .22, .02, 16, 0, .45, .03, WHITE, { rx: R90 }), bx(.02, .16, .01, 0, .52, .045, INK), bx(.12, .02, .01, .05, .45, .045, INK)] } };
  }
  {
    const steps = (n, rise, c, t) => { const o = []; for (let i = 0; i < n; i++) o.push(bx(1.2, rise * (i + 1), .3, 0, rise * (i + 1) / 2, (n / 2 - i - .5) * .3, c, { t: t })); const L = Math.hypot(n * .3, n * rise), a = Math.atan2(rise, .3); return o.concat([bx(.05, .05, L, -.62, n * rise / 2 + .9, 0, WOODD, { rx: a }), bx(.05, .05, L, .62, n * rise / 2 + .9, 0, WOODD, { rx: a })]); };
    const spiral = [cy(.12, .12, 2.6, 8, 0, 1.3, 0, METD)]; for (let i = 0; i < 8; i++) spiral.push(bx(.8, .05, .5, Math.cos(i * R45) * .55, .3 * (i + 1), Math.sin(i * R45) * .55, 4, { t: 'wood' }));
    INT.staircase = { r: 1.3, jit: [1, 1], parts: steps(8, .3, 4, 'plank'), variants: { wood: steps(8, .3, 4, 'plank'), stone: steps(8, .3, CONC, 'concrete'), spiral: spiral, short: steps(4, .3, 4, 'plank') } };
  }
  {
    const skirt = [bx(4, .12, .24, 0, .06, 0, WOODD)];
    INT.wallInterior = { r: 2, jit: [1, 1], len: 4, parts: [bx(4, 2.8, .2, 0, 1.4, 0, PLASTER, { t: 'plaster' }), bx(4, .06, .24, 0, 2.77, 0, WHITE)].concat(skirt), variants: {
      plain: [bx(4, 2.8, .2, 0, 1.4, 0, PLASTER, { t: 'plaster' }), bx(4, .06, .24, 0, 2.77, 0, WHITE)].concat(skirt),
      wallpaper: [bx(4, 2.8, .2, 0, 1.4, 0, '#d8c8b0', { t: 'fabric' }), bx(.3, 2.5, .22, -1.5, 1.45, 0, '#b89a78'), bx(.3, 2.5, .22, -.5, 1.45, 0, '#b89a78'), bx(.3, 2.5, .22, .5, 1.45, 0, '#b89a78'), bx(.3, 2.5, .22, 1.5, 1.45, 0, '#b89a78')].concat(skirt),
      brick: [bx(4, 2.8, .2, 0, 1.4, 0, BRICK, { t: 'brick' })].concat(skirt), tiles: [bx(4, 2.8, .2, 0, 1.4, 0, WHITE, { t: 'tile' }), bx(4.02, .15, .22, 0, 1.2, 0, TEAL)].concat(skirt) } };
  }
  {
    const open = [bx(1.4, 2.8, .2, -1.3, 1.4, 0, PLASTER, { t: 'plaster' }), bx(1.4, 2.8, .2, 1.3, 1.4, 0, PLASTER, { t: 'plaster' }), bx(1.2, .6, .2, 0, 2.5, 0, PLASTER, { t: 'plaster' }), bx(.08, 2.2, .26, -.62, 1.1, 0, 4, { t: 'wood' }), bx(.08, 2.2, .26, .62, 1.1, 0, 4, { t: 'wood' }), bx(1.32, .08, .26, 0, 2.24, 0, 4, { t: 'wood' }), bx(1.4, .12, .24, -1.3, .06, 0, WOODD), bx(1.4, .12, .24, 1.3, .06, 0, WOODD)];
    INT.doorway = { r: 2, jit: [1, 1], len: 4, parts: open, variants: { open: open, closed: open.concat([bx(1.16, 2.16, .05, 0, 1.08, 0, WOOD, { t: 'wood' }), sp(.03, .45, 1.05, .05, METB)]),
      arch: open.slice(0, 3).concat([cy(.35, .35, .22, 10, -.6, 2.2, 0, PLASTER, { rx: R90, t: 'plaster' }), cy(.35, .35, .22, 10, .6, 2.2, 0, PLASTER, { rx: R90, t: 'plaster' })], open.slice(6)), glass: open.concat([bx(1.16, 2.16, .03, 0, 1.08, 0, GLASS), bx(.03, .25, .03, .45, 1.05, .04, METB)]) } };
  }
  {
    const win = w => [bx(w, .06, .1, 0, 1.32, 0, WHITE), bx(w, .06, .1, 0, .18, 0, WHITE), bx(.06, 1.2, .1, -w / 2 + .03, .75, 0, WHITE), bx(.06, 1.2, .1, w / 2 - .03, .75, 0, WHITE), bx(w - .1, 1.1, .04, 0, .75, 0, SKY, { e: true }), bx(.04, 1.1, .06, 0, .75, .03, WHITE), bx(w - .1, .04, .06, 0, .75, .03, WHITE)];
    INT.window = { r: .6, jit: [1, 1], soft: true, parts: win(1.2), variants: { square: win(1.2), wide: win(2.4), round: [cy(.6, .6, .1, 16, 0, .75, 0, WHITE, { rx: R90 }), cy(.54, .54, .04, 16, 0, .75, .04, SKY, { e: true, rx: R90 })],
      curtain: win(1.2).concat([bx(.4, 1.4, .12, -.7, .75, .06, WINE, { t: 'fabric' }), bx(.4, 1.4, .12, .7, .75, .06, WINE, { t: 'fabric' }), cy(.02, .02, 2, 6, 0, 1.5, .06, METB, { rz: R90 })]) } };
  }

  // ═══ upgrades of the core kinds: variants only, the default parts stay ═══
  const UPGRADES = {
    crate: { wood: [bx(1, 1, 1, 0, .5, 0, WOOD, { t: 'wood' }), bx(1.06, .1, 1.06, 0, .5, 0, WOODD), bx(.1, 1.02, 1.06, 0, .5, 0, WOODD), bx(1.06, 1.02, .1, 0, .5, 0, WOODD)],
      metal: [bx(1, 1, 1, 0, .5, 0, '#5a6068', { t: 'metal' }), bx(1.06, .12, 1.06, 0, .12, 0, INK), bx(1.06, .12, 1.06, 0, .88, 0, INK), bx(.5, .5, .04, 0, .5, .52, HAZ, { t: 'hazard' })],
      military: [bx(1.2, .8, .8, 0, .4, 0, CAMO, { t: 'camo' }), bx(1.24, .1, .84, 0, .78, 0, INK), bx(.12, .82, .84, -.45, .4, 0, INK), bx(.12, .82, .84, .45, .4, 0, INK), bx(.4, .2, .04, .1, .4, .41, WHITE)],
      glow: [bx(1, 1, 1, 0, .5, 0, INK, { t: 'panel' }), bx(1.04, .06, 1.04, 0, .3, 0, CYAN, { e: true }), bx(1.04, .06, 1.04, 0, .7, 0, CYAN, { e: true }), bx(.06, 1.04, 1.04, 0, .5, 0, CYAN, { e: true })] },
    barrel: { rusty: [cy(.45, .45, 1.1, 10, 0, .55, 0, RUST, { t: 'rust' }), cy(.48, .48, .1, 10, 0, .3, 0, INK), cy(.48, .48, .1, 10, 0, .8, 0, INK)],
      blue: [cy(.45, .45, 1.1, 10, 0, .55, 0, BLUE, { t: 'metal' }), cy(.48, .48, .1, 10, 0, .3, 0, INK), cy(.48, .48, .1, 10, 0, .8, 0, INK), cy(.4, .4, .04, 10, 0, 1.11, 0, INK)],
      toxic: [cy(.45, .45, 1.1, 10, 0, .55, 0, '#5fbf3a', { t: 'metal' }), cy(.47, .47, .14, 10, 0, .55, 0, TOX, { e: 'dark' }), cy(.48, .48, .08, 10, 0, .2, 0, INK), cy(.48, .48, .08, 10, 0, .9, 0, INK)],
      wood: [cy(.42, .38, 1, 10, 0, .5, 0, 4, { t: 'wood' }), cy(.45, .45, .08, 10, 0, .25, 0, INK), cy(.45, .45, .08, 10, 0, .75, 0, INK)] },
    building: { office: [bx(5, 12, 5, 0, 6, 0, 1, { t: 'concrete' }), bx(5.1, .7, 5.1, 0, 1.8, 0, 3, { e: 'dark' }), bx(5.1, .7, 5.1, 0, 4, 0, 3, { e: 'dark' }), bx(5.1, .7, 5.1, 0, 6.2, 0, 3, { e: 'dark' }), bx(5.1, .7, 5.1, 0, 8.4, 0, 3, { e: 'dark' }), bx(5.1, .7, 5.1, 0, 10.6, 0, 3, { e: 'dark' }), bx(4, .6, 4, 0, 12.3, 0, 4), bx(1.6, 2.2, .3, 0, 1.1, 2.55, GLASSD)],
      apartment: [bx(5.2, 9, 5.2, 0, 4.5, 0, '#c9b8a0', { t: 'plaster' }), bx(1.2, .9, 5.3, -1.4, 2, 0, 3, { e: 'dark' }), bx(1.2, .9, 5.3, 1.4, 2, 0, 3, { e: 'dark' }), bx(1.2, .9, 5.3, -1.4, 4.6, 0, 3, { e: 'dark' }), bx(1.2, .9, 5.3, 1.4, 4.6, 0, 3, { e: 'dark' }), bx(1.2, .9, 5.3, -1.4, 7.2, 0, 3, { e: 'dark' }), bx(1.2, .9, 5.3, 1.4, 7.2, 0, 3, { e: 'dark' }), bx(5.5, .4, 5.5, 0, 9.2, 0, 4), bx(1.2, 2, .3, 0, 1, 2.65, 4, { t: 'wood' })],
      shop: [bx(5, 4, 5, 0, 2, 0, 5, { t: 'plaster' }), bx(5.2, .3, 5.2, 0, 4.1, 0, 4), bx(3.6, 2, .1, 0, 1.3, 2.55, GLASSD), bx(5.2, .08, 1.4, 0, 2.85, 3.2, RED, { t: 'fabric', rx: .35 }), bx(4, .7, .12, 0, 3.5, 2.55, 3, { e: 'dark' }), bx(.9, 2, .1, 1.9, 1, 2.56, 4, { t: 'wood' })],
      house: [bx(5, 3.2, 5, 0, 1.6, 0, PLASTER, { t: 'plaster' }), bx(3.8, 3.8, 5.4, 0, 3.2, 0, 4, { t: 'plank', rz: R45, s: [1, .6, 1] }), bx(1, 2, .2, 0, 1, 2.55, 4, { t: 'wood' }), bx(.9, .9, .2, -1.6, 1.8, 2.55, 3, { e: 'dark' }), bx(.9, .9, .2, 1.6, 1.8, 2.55, 3, { e: 'dark' }), cy(.3, .3, 1.4, 6, 1.5, 4.6, -1, BRICK, { t: 'brick' })] } };

  const SETS = { industrial: Object.keys(IND), urban: Object.keys(URB), nature: Object.keys(NAT), scifi: Object.keys(SCI), medieval: Object.keys(MED), interior: Object.keys(INT) };
  const ALL = Object.assign({}, IND, URB, NAT, SCI, MED, INT);

  // ═══ themed compound layouts — a perimeter + gate, a straight avenue + cross street, a landmark, axis-aligned buildings, lamps, cover clusters, dressing ═══
  //    wall [kind, opts] (kind.len = segment length) · gate [kind, opts] · road [variant, lanes] · land [kind, scale, opts] · lamp [kind, step, opts]
  //    buildings [[kind, n, opts]] on a jittered grid, rotated by 90° steps · cluster [[kind, clusters, each, opts]] · scatter [[kind, n, opts]] (n per 120-unit world)
  //    room: an interior plan built by ROOM[name] instead (house · classroom)
  const LAYOUTS = {
    industrialNight: { wall: ['wallSegment', { variant: 'concrete' }], gate: ['door', { variant: 'open', scale: 1.5 }], road: ['line', 3], land: ['chimney', 1.2], lamp: ['floodlightTower', 16, { lights: 4 }],
      buildings: [['warehouse', 3, { variant: 'steel' }], ['tank', 2, { variant: 'fuel' }], ['generator', 3, { lights: 0 }]], cluster: [['crate', 2, 4, { variant: 'metal' }], ['barrel', 2, 5, { variant: 'rusty' }]],
      scatter: [['container', 7, { variant: 'blue' }], ['container', 5, { variant: 'red' }], ['pallet', 8], ['tire', 6], ['spool', 4], ['sandbag', 5], ['dumpster', 3], ['hazardBarrel', 6], ['trafficCone', 10], ['pipeJunction', 4], ['forklift', 2, { variant: 'orange' }]] },
    harbour: { road: ['asphalt', 2], land: ['crane', 1, { variant: 'gantry' }], lamp: ['streetlight', 12], buildings: [['warehouse', 2, { variant: 'brick' }], ['kiosk', 1], ['tank', 1, { variant: 'water' }]], cluster: [['container', 2, 4, { variant: 'green' }], ['crate', 2, 4, { variant: 'wood' }]],
      scatter: [['container', 6, { variant: 'red' }], ['container', 4, { variant: 'blue' }], ['spool', 4], ['pallet', 6], ['tire', 5], ['truck', 2, { variant: 'flatbed' }], ['boat', 4], ['fenceChain', 6], ['trafficCone', 6], ['barrel', 6, { variant: 'blue' }], ['bench', 2]] },
    village: { wall: ['fence'], gate: ['arch', { variant: 'stone' }], road: ['dirt', 2], land: ['windmill', 1], lamp: ['lamp', 14, { lights: 3 }], buildings: [['building', 4, { variant: 'house' }], ['building', 2, { variant: 'shop' }], ['barn', 1], ['well', 1]],
      cluster: [['haystack', 2, 3], ['barrelStack', 2, 2]], scatter: [['cart', 3], ['logPile', 4], ['stump', 5], ['scarecrow', 2], ['tree', 14, { variant: 'round' }], ['bush', 12], ['flower', 30], ['bench', 3, { variant: 'wood' }], ['banner', 4, { variant: 'red' }], ['fence', 8]] },
    scifiBase: { wall: ['wallSegment', { variant: 'metal' }], gate: ['door', { variant: 'steel', scale: 2 }], road: ['panel', 3], land: ['reactor', 1.3], lamp: ['floodlightTower', 18, { variant: 'quad', lights: 3 }],
      buildings: [['dome', 2], ['building', 2, { variant: 'office' }], ['satelliteDish', 1, { variant: 'large' }]], cluster: [['serverRack', 2, 3, { variant: 'row', lights: 0 }], ['capsule', 1, 3]],
      scatter: [['hologramPad', 3, { lights: 2 }], ['solarPanel', 6, { variant: 'row' }], ['droneDock', 2, { lights: 0 }], ['crate', 8, { variant: 'glow' }], ['console', 4, { variant: 'lit', lights: 0 }], ['antenna', 3, { lights: 0 }], ['crystal', 6], ['podium', 2, { variant: 'magenta', lights: 0 }], ['teleporter', 1, { lights: 1 }]] },
    ruins: { wall: ['wallRuin', { variant: 'low' }], gate: ['gate', { variant: 'ruined' }], road: ['stone', 2], land: ['arch', 1.4, { variant: 'double' }], lamp: ['brazier', 10, { lights: 4 }],
      buildings: [['column', 8], ['statue', 3, { variant: 'broken' }], ['wallRuin', 6, { variant: 'tall' }]], cluster: [['boulderMossy', 3, 3], ['barrelStack', 1, 2]],
      scatter: [['treeDead', 6], ['bush', 14], ['grass', 60], ['mushroom', 10], ['tent', 2], ['banner', 3, { variant: 'tattered' }], ['rock', 12], ['anvil', 1], ['wallRuin', 4, { variant: 'mossy' }]] },
    city: { road: ['line', 3], land: ['billboard', 1.3, { variant: 'lit' }], lamp: ['streetlight', 10], buildings: [['building', 5, { variant: 'office' }], ['building', 5, { variant: 'apartment' }], ['building', 4, { variant: 'shop' }]],
      cluster: [['car', 2, 3, { variant: 'sedan' }], ['trashcan', 2, 2]], scatter: [['car', 4, { variant: 'van' }], ['car', 4, { variant: 'red' }], ['car', 3, { variant: 'white' }], ['bench', 5], ['hydrant', 4], ['mailbox', 3], ['busStop', 2, { lights: 0 }], ['kiosk', 2], ['vending', 3, { variant: 'lit', lights: 1 }], ['trafficCone', 8], ['tree', 10, { variant: 'round' }], ['phoneBooth', 2]] },
    house: { room: 'house' }, classroom: { room: 'classroom' }
  };

  window.YuviWorld3D.use(function props(W, THREE, ctx) {
    const KINDS = ctx.KINDS, warn = ctx.warn, clamp = ctx.clamp, half = ctx.half, K = ctx.K, water = ctx.water, groundY = ctx.groundY;
    const scatter = W.props.scatter, place = W.props.place, make = W.props.make;
    // 1. register every kind (idempotent: KINDS is module state shared by every world)
    for (const name in ALL) if (!KINDS[name] || KINDS[name].__props) KINDS[name] = Object.assign({ __props: true }, ALL[name]);
    for (const k in UPGRADES) if (KINDS[k]) KINDS[k].variants = Object.assign(KINDS[k].variants || {}, UPGRADES[k]);
    // 2. contract textures the materials plugin did not (or does not yet) provide resolve to flat colour silently; a typo in a game still warns
    TEX.forEach(n => { if (!(n in ctx.textures)) ctx.textures[n] = () => null; });
    const dry = (x, z) => !water || groundY(x, z) > water.level + .15;

    function layout(name, o) {
      o = o || {}; const L = LAYOUTS[name];
      const sets = [], dec = { name: name, sets: sets, positions: [], landmark: null, path: [], remove() { sets.slice().forEach(h => h.remove()); if (dec.landmark) ctx.scene.remove(dec.landmark); } };
      if (!L) { warn('props.layout: unknown layout "' + name + '" — layouts: ' + Object.keys(LAYOUTS).join(', ')); return dec; }
      const rnd = o.seed == null ? ctx.rand : ctx.mulberry32(ctx.seedNum(o.seed)), dens = clamp(+o.density || 1, .3, 2.5);
      const R = clamp(+o.radius || half - 6, 16, half - 3), area = (R / 54) * (R / 54), avoid = [{ x: 0, z: 0, r: 8 }];
      const add = h => { if (h && h.positions) { sets.push(h); if (!h.soft && !KINDS[h.kind].float) h.positions.forEach(p => { dec.positions.push(p); avoid.push({ x: p.x, z: p.z, r: p.r }); }); } return h; };
      const free = (x, z, r) => !avoid.some(a => Math.hypot(a.x - x, a.z - z) < a.r + r);
      if (L.room) { ROOM[L.room]({ dec: dec, add: add, R: R, s: 1 }, o); return dec; }
      // roads first so everything else keeps off them: an avenue along z (spawn → gate at -R) and a cross street
      const lanes = L.road ? L.road[1] || 1 : 0, rv = L.road && L.road[0];
      if (lanes) {
        const pts = [], mid = [], zc = -R * .35; const tile = (x, z, m) => (m ? mid : pts).push({ x: x, z: z, s: 1, rot: 0 });
        for (let z = R - 3; z >= -R + 3; z -= 2) for (let l = 0; l < lanes; l++) tile((l - (lanes - 1) / 2) * 2, z, lanes > 2 && l === (lanes - 1) / 2);
        for (let x = lanes + 1; x <= R - 3; x += 2) for (let l = 0; l < lanes; l++) { tile(x, zc + (l - (lanes - 1) / 2) * 2, false); tile(-x, zc + (l - (lanes - 1) / 2) * 2, false); }
        add(place('road', pts, { variant: rv === 'line' || rv === 'crossing' ? 'asphalt' : rv }));
        if (mid.length) add(place('road', mid, { variant: rv }));
        for (let z = R - 3; z >= -R + 3; z -= 4) avoid.push({ x: 0, z: z, r: lanes + 1.2 }); for (let x = -R + 3; x <= R - 3; x += 4) avoid.push({ x: x, z: zc, r: lanes + 1.2 });
        dec.path = pts.concat(mid);
      }
      // perimeter wall with a gap for the gate on the -z side
      if (L.wall && o.edge !== false) {
        const Kw = KINDS[L.wall[0]], Kg = L.gate && KINDS[L.gate[0]];
        if (!Kw || (L.gate && !Kg)) warn('layout ' + name + ': wall/gate kind missing');
        else {
          const wo = L.wall[1] || {}, s = +wo.scale || 1, len = (Kw.len || Kw.r * 2) * s, gs = +(L.gate[1] && L.gate[1].scale) || 1, gap = Kg ? (Kg.len || Kg.r * 2) * gs / 2 + .5 : 0, pts = [];
          for (let x = -R + len / 2; x <= R - len / 2 + .01; x += len) { pts.push({ x: x, z: R, rot: 0, s: s }); if (!Kg) pts.push({ x: x, z: -R, rot: 0, s: s }); }
          if (Kg) for (let x = gap + len / 2; x <= R - len / 2 + .01; x += len) { pts.push({ x: x, z: -R, rot: 0, s: s }); pts.push({ x: -x, z: -R, rot: 0, s: s }); }
          for (let z = -R + len / 2; z <= R - len / 2 + .01; z += len) { pts.push({ x: -R, z: z, rot: R90, s: s }); pts.push({ x: R, z: z, rot: R90, s: s }); }
          const h = place(L.wall[0], pts.filter(p => dry(p.x, p.z)), wo); sets.push(h);
          h.positions.forEach(p => { const b = p.rot ? { x: p.x, z: p.z, hw: .6, hd: len / 2 } : { x: p.x, z: p.z, hw: len / 2, hd: .6 }; dec.positions.push(b); avoid.push({ x: p.x, z: p.z, r: len / 2 }); });
          if (Kg) add(place(L.gate[0], [{ x: 0, z: -R, rot: 0, s: gs }], L.gate[1]));
        }
      }
      // landmark beside the far end of the avenue, facing the centre
      if (L.land && o.landmark !== false) {
        const Kl = KINDS[L.land[0]], s = L.land[1] || 1, side = rnd() < .5 ? -1 : 1;
        let lx = side * R * .45, lz = -R * .55;
        for (let t = 0; t < 12 && (!dry(lx, lz) || !free(lx, lz, Kl.r * s)); t++) { lx = side * R * (.3 + rnd() * .35); lz = -R * (.2 + rnd() * .5); }
        const lm = make(L.land[0], Object.assign({ scale: s, pos: [lx, 0, lz] }, L.land[2] || {})); lm.rotation.y = Math.atan2(-lx, -lz); lm.name = 'landmark';
        dec.landmark = lm; avoid.push({ x: lx, z: lz, r: Kl.r * s + 2 }); dec.positions.push({ x: lx, z: lz, r: Kl.r * s });
      }
      // buildings: axis-aligned on a jittered grid, never on the roads, the centre or each other
      (L.buildings || []).forEach(b => {
        const Kb = KINDS[b[0]]; if (!Kb) { warn('layout ' + name + ': unknown kind ' + b[0]); return; }
        const bo = b[2] || {}, base = +bo.scale || 1, n = Math.max(1, Math.round(b[1] * dens * Math.max(.5, area))), cell = Math.max(6, Kb.r * 2.6 * base), pts = [];
        for (let tries = n * 40; pts.length < n && tries > 0; tries--) {
          const gx = Math.round(((rnd() * 2 - 1) * (R - cell)) / cell) * cell + (rnd() - .5) * 2, gz = Math.round(((rnd() * 2 - 1) * (R - cell)) / cell) * cell + (rnd() - .5) * 2;
          const s = base * (Kb.jit[0] + rnd() * (Kb.jit[1] - Kb.jit[0])), r = Kb.r * s;
          if (Math.abs(gx) > R - r - 1 || Math.abs(gz) > R - r - 1 || !dry(gx, gz) || !free(gx, gz, r) || pts.some(p => Math.hypot(p.x - gx, p.z - gz) < p.r + r)) continue;
          pts.push({ x: gx, z: gz, r: r, s: s, rot: R90 * Math.floor(rnd() * 4) + (rnd() - .5) * .08, tint: .9 + rnd() * .2 });
        }
        add(place(b[0], pts, bo));
      });
      // lamps along the avenue, alternating sides, arms over the road
      if (L.lamp && lanes) {
        const step = L.lamp[1] || 12, pts = []; let i = 0;
        for (let z = R - 6; z > -R + 6; z -= step, i++) { const x = (i % 2 ? 1 : -1) * (lanes + 1.6); if (dry(x, z)) pts.push({ x: x, z: z, rot: x < 0 ? 0 : Math.PI, s: 1 }); }
        add(place(L.lamp[0], pts, Object.assign({ lights: 3 }, L.lamp[2] || {})));
      }
      // cover clusters, then dressing
      (L.cluster || []).forEach(cl => { for (let c = 0; c < cl[1]; c++) { let cx = 0, cz = 0; for (let t = 0; t < 30; t++) { const a = rnd() * 6.2832, d = 12 + rnd() * (R - 16); cx = Math.cos(a) * d; cz = Math.sin(a) * d; if (free(cx, cz, 3)) break; } add(scatter(cl[0], Math.round(cl[2] * dens), Object.assign({ area: [cx, cz, 4, 4], avoid: avoid, seed: rnd() * 1e9 }, cl[3] || {}))); } });
      (L.scatter || []).forEach(sc => add(scatter(sc[0], Math.max(1, Math.round(sc[1] * dens * area)), Object.assign({ area: R - 3, avoid: avoid, seed: rnd() * 1e9 }, sc[2] || {}))));
      return dec;
    }

    // ═══ room plans (house · classroom): a ring of `wallInterior` with a `doorway` in one slot, a tiled rug floor, furniture per zone; `giant` (true → ×8, a number → ×6–×10) for a tiny hero, capped so the plan fits the radius ═══
    //    items [kind, variant, x, z, rot, y (sits it on furniture), opts, scale]; a zone is a canonical 8×8 room whose outer walls are at local +x/+z, mirrored into its quadrant
    const giantScale = (o, R, H) => Math.min(o.giant ? clamp(o.giant === true ? 8 : +o.giant || 8, 6, 10) : 1, (R - 2) / H);
    function roomPlan(E, P) {
      const s = E.s, HX = P.HX * s, HZ = P.HZ * s, len = 4 * s, dec = E.dec, add = E.add, pts = [], door = [];
      const slot = (side, i, x, z, rot) => (P.door[0] === side && P.door[1] === i ? door : pts).push({ x: x, z: z, rot: rot, s: s });
      for (let i = 0, n = Math.round(2 * HX / len); i < n; i++) { const x = -HX + len / 2 + i * len; slot('+z', i, x, HZ, 0); slot('-z', i, x, -HZ, 0); }
      for (let i = 0, n = Math.round(2 * HZ / len); i < n; i++) { const z = -HZ + len / 2 + i * len; slot('-x', i, -HX, z, R90); slot('+x', i, HX, z, R90); }
      const walls = place('wallInterior', pts, { variant: P.wall }); dec.sets.push(walls);
      walls.positions.forEach(p => dec.positions.push(p.rot ? { x: p.x, z: p.z, hw: .2 * s, hd: len / 2 } : { x: p.x, z: p.z, hw: len / 2, hd: .2 * s }));
      const dw = place('doorway', door, { variant: P.doorVariant }); dec.sets.push(dw);   // open/arch: collide with the two jambs, walk through; closed/glass: the whole slot
      const solid = P.doorVariant === 'closed' || P.doorVariant === 'glass';
      dw.positions.forEach(p => (solid ? [0] : [-1.3, 1.3]).forEach(k => dec.positions.push(p.rot ? { x: p.x, z: p.z + k * s, hw: .2 * s, hd: (solid ? 2 : .7) * s } : { x: p.x + k * s, z: p.z, hw: (solid ? 2 : .7) * s, hd: .2 * s })));
      if (P.floor) { const f = []; for (let x = -HX + len / 2; x < HX; x += len) for (let z = -HZ + len / 2; z < HZ; z += len) f.push({ x: x, z: z, y: groundY(x, z) + .03 - .04 * s, s: s }); add(place('rug', f, { variant: P.floor })); }   // sunk: top 3 cm above the ground
      const groups = {}, order = [];
      P.items.forEach(it => { const k = it[0] + '|' + it[1] + '|' + JSON.stringify(it[6] || 0); if (!groups[k]) order.push(groups[k] = { kind: it[0], o: Object.assign({ variant: it[1] }, it[6] || {}), pts: [] }); groups[k].pts.push({ x: it[2] * s, z: it[3] * s, rot: it[4] || 0, y: it[5] ? groundY(it[2] * s, it[3] * s) + it[5] * s : 0, s: s * (it[7] || 1) }); });
      order.forEach(g => add(place(g.kind, g.pts, g.o)));
      const l = P.land, ls = s * (l[5] || 1), lm = make(l[0], { variant: l[1], scale: ls, pos: [l[2] * s, 0, l[3] * s] }); lm.rotation.y = l[4] || 0; lm.name = 'landmark';
      dec.landmark = lm; dec.positions.push({ x: l[2] * s, z: l[3] * s, r: KINDS[l[0]].r * ls });
    }
    const ZONES = {
      living: [['rug', 'round', 1, 0, 0], ['sofa', 'red', -1.2, 0, R90], ['pillow', 'square', -1.2, .5, R90, .45], ['table', 'coffee', 1, 0, R90], ['book', 'stack', 1.1, .35, .4, .4], ['cup', 'mug', .8, -.3, 0, .4], ['tv', 'flat', 3.3, 0, -R90],
        ['lampInterior', 'floor', 3, 3.1, 0], ['plant', 'tall', 3.2, -3, 0], ['toy', 'ball', -1.6, 2.3, 0], ['toy', 'teddy', 2.3, -2.5, .6], ['pictureFrame', 'landscape', .8, 3.85, Math.PI, 1.1], ['window', 'wide', 2.6, 3.85, Math.PI, .8]],
      kitchen: [['cabinet', 'kitchen', .8, 3.5, Math.PI], ['cabinet', 'kitchen', 2.3, 3.5, Math.PI], ['fridge', 'white', 3.5, 3.5, Math.PI], ['plant', 'cactus', 2.6, 3.5, 0, .9], ['window', 'wide', 1.6, 3.85, Math.PI, .8], ['table', 'round', -.4, -.4, 0],
        ['chair', 'wood', -.4, -1.5, 0], ['chair', 'wood', -.4, .7, Math.PI], ['chair', 'wood', .7, -.4, -R90], ['chair', 'wood', -1.5, -.4, R90], ['cup', 'teapot', -.4, -.4, 0, .75], ['cup', 'mug', 0, -.7, 0, .75], ['cup', 'glass', -.8, -.1, 0, .75],
        ['lampInterior', 'ceiling', -.4, -.4, 0, 0, { lights: 1 }], ['rug', 'runner', 2, 1.5, R90]],
      bedroom: [['bed', 'double', 1.4, 2.6, Math.PI], ['pillow', 'heart', 1.6, 2.1, .3, .55], ['cabinet', 'drawer', 3.2, 3.5, Math.PI], ['lampInterior', 'desk', 3.2, 3.5, 0, 1], ['cabinet', 'wardrobe', 3.5, -1.5, -R90], ['window', 'square', 3.85, 1.2, -R90, .8],
        ['pictureFrame', 'clock', 1.4, 3.85, Math.PI, 1.9], ['rug', 'round', -.6, .2, 0], ['toy', 'teddy', -1.6, -2.4, 2.5], ['toy', 'car', -2.4, 1.4, 1.2], ['book', 'blue', -1.2, 1.9, .5]],
      library: [['bookshelf', 'full', .5, 3.6, Math.PI], ['bookshelf', 'tall', 1.6, 3.6, Math.PI], ['bookshelf', 'full', 2.7, 3.6, Math.PI], ['table', 'desk', 3.4, .5, -R90], ['chair', 'office', 2.5, .5, R90], ['tv', 'monitor', 3.5, .5, -R90, .75],
        ['lampInterior', 'desk', 3.4, 1.1, 0, .75], ['cup', 'mug', 3.3, -.1, 0, .75], ['window', 'square', 3.85, 2.4, -R90, .8], ['chair', 'armchair', -1.8, 1.5, R45], ['lampInterior', 'floor', -2.9, 3.2, 0], ['book', 'stack', -.8, -.5, .3], ['book', 'red', .4, -2, 1],
        ['book', 'green', -2.4, -1.2, 2], ['rug', 'rect', .5, .2, 0], ['plant', 'fern', -3.2, -3.2, 0]] };
    const ROOM = {
      // o.rooms ⊆ living kitchen bedroom library (default all four: quadrants SE NE NW SW; 1 → one 8×8 room, 2 → side by side); the doorway is on the −z wall, the staircase (landmark) beside it
      house(E, o) {
        const names = Object.keys(ZONES), rooms = (Array.isArray(o.rooms) ? o.rooms : names).filter(n => ZONES[n]);
        if (!rooms.length) { warn('layout house: rooms must be some of ' + names.join(', ')); rooms.push.apply(rooms, names); }
        const n = rooms.length, HX = n > 1 ? 8 : 4, HZ = n > 2 ? 8 : 4, slots = n === 1 ? [[0, 0]] : n === 2 ? [[-4, 0], [4, 0]] : [[4, 4], [4, -4], [-4, -4], [-4, 4]], items = [];
        E.s = giantScale(o, E.R, Math.max(HX, HZ));
        rooms.forEach((nm, i) => { const c = slots[i], sx = c[0] < 0 ? -1 : 1, sz = c[1] < 0 ? -1 : 1; ZONES[nm].forEach(it => items.push([it[0], it[1], c[0] + sx * it[2], c[1] + sz * it[3], Math.atan2(sx * Math.sin(it[4] || 0), sz * Math.cos(it[4] || 0)), it[5], it[6]])); });
        roomPlan(E, { HX: HX, HZ: HZ, wall: o.wall || 'wallpaper', door: ['-z', Math.round(HX / 4) - 1], doorVariant: 'open', floor: 'patterned', items: items, land: ['staircase', 'wood', 2, -HZ + .8, R90] });
      },
      // o.cols (≤ 5) × o.rows (≤ 3) desks facing a green board (pictureFrame) and a smart board (tv, the landmark) on the −z wall; windows on −x, the door on +x
      classroom(E, o) {
        const HX = 8, HZ = 6, cols = clamp(o.cols | 0 || 4, 1, 5), rows = clamp(o.rows | 0 || 3, 1, 3), BOOK = ['red', 'blue', 'green'], items = [];
        E.s = giantScale(o, E.R, HX);
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { const x = (c - (cols - 1) / 2) * 3, z = -1 + r * 2.5; items.push(['table', 'desk', x, z, 0], ['chair', 'wood', x, z + .75, Math.PI], ['book', BOOK[(r + c) % 3], x + .3, z, 0, .75]); }
        items.push(['table', 'desk', 0, -3.8, Math.PI], ['chair', 'office', 0, -4.6, 0], ['cup', 'mug', .5, -3.7, 0, .75], ['book', 'stack', -.4, -3.9, 0, .75], ['pictureFrame', 'landscape', -2, -5.85, 0, 1.1, { colors: { 4: '#4a4a4a', 5: '#2d5a3c' } }, 3],
          ['pictureFrame', 'clock', 0, -5.85, 0, 2.4], ['window', 'wide', -7.85, -3, R90, .8], ['window', 'wide', -7.85, 0, R90, .8], ['window', 'wide', -7.85, 3, R90, .8], ['bookshelf', 'half', -5, 5.6, Math.PI], ['bookshelf', 'half', -3.8, 5.6, Math.PI],
          ['cabinet', 'wardrobe', -6.5, 5.6, Math.PI], ['plant', 'fern', 7.3, -5.3, 0], ['plant', 'pot', -7.3, -5.3, 0], ['toy', 'blocks', 6.6, 5.3, 0],
          ['lampInterior', 'ceiling', -3.5, -2.5, 0, 0, { lights: 2 }], ['lampInterior', 'ceiling', 3.5, -2.5, 0, 0, { lights: 2 }], ['lampInterior', 'ceiling', -3.5, 2.5, 0, 0, { lights: 2 }], ['lampInterior', 'ceiling', 3.5, 2.5, 0, 0, { lights: 2 }]);
        roomPlan(E, { HX: HX, HZ: HZ, wall: o.wall || 'plain', door: ['+x', 2], doorVariant: 'closed', floor: null, items: items, land: ['tv', 'flat', 3.2, -5.5, 0, 2] });
      } };

    W.props.set = name => (SETS[name] || (warn('props.set: unknown set "' + name + '" — sets: ' + Object.keys(SETS).join(', ')), [])).slice();
    W.props.library = SETS;
    W.props.layouts = Object.keys(LAYOUTS);
    W.props.layout = layout;
    ctx.LAYOUTS = LAYOUTS; ctx.PROP_SETS = SETS;
  });
})();
