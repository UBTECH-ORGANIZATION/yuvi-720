/*
 * yuvi_fps.js — YuviFPS, the first-person-shooter module on top of YuviWorld3D:
 * stylised weapons (blaster, pulse rifle, scatter gun, smg, rail gun, launcher,
 * beam) built from primitives with sockets and 2–3 skins, a viewmodel rig
 * (FOV separation, sway, figure-8 bob, spring recoil, reload keyframes, ADS,
 * weapon switching, crosshair with live spread, hit markers, damage direction,
 * low-health vignette), muzzle flash / shells / tracers / paint splats, enemies
 * that shoot back (patrol → alert → engage / cover-peek → search / retreat FSM,
 * archetypes grunt · heavy · sniper · drone · turret · boss), squads, player
 * hp/armor wired to the kit HUD, spinning pickups and an objectives helper.
 *
 *   W.fps.weapon(kind, {seed, accent, skin})                       → weapon (viewmodel + config + fire/reload)
 *   W.fps.arms(ctrl, {weapons: [...], fireKey, adsKey})            → rig (input, sway, ADS, switch, crosshair)
 *   W.fps.player(ctrl, {hp, armor, regen, onDead})                 → {hp, armor, damage(), heal(), pickup()}
 *   W.fps.soldier({arch, pos, waypoints, weapon, accent, seed})    → soldier (AI + character + gun)
 *   W.fps.squad(n, {arch, area, waypoints})                        → soldier[]
 *   W.fps.pickups.spawn(kind, pos) / W.fps.objectives.add(text, {count}) / W.fps.update(dt)
 *
 * Classic script, injected after yuvi_world3d.js; every world gets `W.fps`
 * through `YuviWorld3D.use`, and `YuviFPS.attach(W, THREE)` works without it.
 * `W.fps.update(dt)` is registered into the world's animated list, so `W.update`
 * (and `W.run()`) already steps it. Kid-safe: bolts of light and paint, enemies
 * power down and dissolve, no blood. Everything is pooled and deterministic in `seed`.
 */
(function () {
  if (window.YuviFPS) return;
  const warn = m => { try { console.warn('[YuviFPS] ' + m); } catch (e) {} };
  const noop = () => {};
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
  const lerpAngle = (a, b, t) => { let d = (b - a) % 6.2832; if (d > 3.1416) d -= 6.2832; if (d < -3.1416) d += 6.2832; return a + d * t; };
  const D2R = Math.PI / 180, R90 = Math.PI / 2;
  function seedNum(s) { if (typeof s === 'number' && isFinite(s)) return s >>> 0; const str = String(s == null ? 'fps' : s); let h = 1779033703 ^ str.length; for (let i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); } return h >>> 0; }
  function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const kitOf = () => window.YuviKit || null;
  const playing = () => { const k = kitOf(); return !!k && k.started && !k.paused && !k.over; };
  const play = n => { const k = kitOf(); if (k && k.audio) k.audio.play(n); };

  // ── weapon data: class proportions + gameplay config. rate shots/s, spread deg (hip), ads deg, recoil [gun kick m, gun tilt deg, cam pitch deg],
  //    speed 0 = hitscan else bolt m/s, pellets per shot, splash radius, charge s (rail), beam = continuous, reloadS, rest/ads poses [x, y, z] in view space ──
  const WEAPONS = {
    blaster:    { cls: 'pistol',  damage: 14, rate: 4.5, spread: .7, ads: .2, recoil: [.05, 5, 2.2], mag: 12, reserve: 60, reloadS: 1.3, range: 60, speed: 55, auto: false, len: .24, rest: [.16, -.15, -.32], adsPos: [0, -.09, -.26], sound: 'shoot' },
    pulseRifle: { cls: 'rifle',   damage: 9, rate: 9, spread: .5, ads: .08, recoil: [.035, 2.5, 1.1], mag: 30, reserve: 150, reloadS: 1.8, range: 90, speed: 0, auto: true, len: .72, rest: [.19, -.17, -.38], adsPos: [0, -.1, -.3], sound: 'shoot' },
    scatterGun: { cls: 'shotgun', damage: 6, pellets: 8, rate: 1.2, spread: 4.5, ads: 3, recoil: [.09, 7, 4.5], mag: 6, reserve: 36, reloadS: 2.2, range: 26, speed: 0, auto: false, len: .8, rest: [.19, -.17, -.36], adsPos: [0, -.1, -.3], sound: 'explode' },
    smg:        { cls: 'smg',     damage: 5, rate: 13, spread: 1.1, ads: .4, recoil: [.025, 1.8, .7], mag: 35, reserve: 175, reloadS: 1.5, range: 50, speed: 0, auto: true, len: .42, rest: [.17, -.16, -.34], adsPos: [0, -.1, -.28], sound: 'shoot' },
    railGun:    { cls: 'sniper',  damage: 70, rate: .9, spread: 3, ads: 0, recoil: [.12, 6, 5], mag: 5, reserve: 25, reloadS: 2.6, range: 160, speed: 0, auto: false, charge: .55, len: 1.05, rest: [.2, -.18, -.42], adsPos: [0, -.11, -.34], adsFov: 28, sound: 'pew' },
    launcher:   { cls: 'launcher', damage: 45, rate: .7, spread: .6, ads: .3, recoil: [.14, 6, 4], mag: 1, reserve: 9, reloadS: 2.8, range: 80, speed: 24, gravity: 6, splash: 3.2, auto: false, len: .75, rest: [.22, -.2, -.4], adsPos: [.05, -.14, -.34], sound: 'explode' },
    beam:       { cls: 'beam',    damage: 3, rate: 15, spread: .15, ads: .05, recoil: [.004, .3, .05], mag: 120, reserve: 240, reloadS: 2, range: 28, speed: 0, auto: true, beam: true, len: .62, rest: [.18, -.16, -.36], adsPos: [0, -.1, -.3], sound: 'blip' }
  };
  // skins: [body dark, body mid, grip, detail] hexes; camo uses the material factory texture when the materials plugin registered one
  const SKINS = { matte: ['#2f333a', '#4a5058', '#1f2226', '#6a717a'], camo: ['#3a4a32', '#5c6a48', '#2a2f26', '#8a8a6a'], chrome: ['#8c949c', '#c2c8ce', '#2a2d31', '#e6eaee'], neon: ['#1b1d24', '#2a2e3a', '#141519', '#3d4252'] };
  const SKIN_TEX = { matte: 'metalDark', camo: 'camo', chrome: 'metalBrushed', neon: 'panel' };
  // enemy archetypes: burst [min,max] shots, gap s between shots, pause [min,max] s between bursts, err deg (far/close), dmg per bolt, range [min,max] m,
  //    hp, speed m/s, bolt m/s, weapon kind, fov deg, sight m, character overrides
  const ARCH = {
    grunt:  { burst: [3, 5], gap: .1, pause: [.8, 1.4], err: [4.5, 2], dmg: 6, range: [6, 18], hp: 60, speed: 3.2, bolt: 34, weapon: 'pulseRifle', fov: 110, sight: 26, char: { role: 'guard' } },
    heavy:  { burst: [8, 12], gap: .07, pause: [1.5, 2.2], err: [7, 4], dmg: 3, range: [5, 15], hp: 170, speed: 2, bolt: 30, weapon: 'smg', fov: 100, sight: 22, windup: .6, char: { role: 'guard', size: 1.15 } },
    sniper: { burst: [1, 1], gap: 0, pause: [2.2, 3.2], err: [1.2, 1.2], dmg: 22, range: [14, 45], hp: 50, speed: 2.6, bolt: 70, weapon: 'railGun', fov: 90, sight: 48, warn: .8, char: { role: 'guard', hat: 'cap' } },
    drone:  { burst: [2, 2], gap: .15, pause: [1, 1.6], err: [6, 3], dmg: 4, range: [4, 14], hp: 35, speed: 4.5, bolt: 28, weapon: 'blaster', fov: 360, sight: 28, fly: true, hover: 2.6 },
    turret: { burst: [4, 6], gap: .12, pause: [1.2, 2], err: [4, 2.5], dmg: 5, range: [0, 24], hp: 90, speed: 0, bolt: 36, weapon: 'smg', fov: 360, sight: 24, fixed: true },
    boss:   { burst: [6, 9], gap: .09, pause: [1, 1.6], err: [5, 3], dmg: 7, range: [6, 20], hp: 600, speed: 2.4, bolt: 34, weapon: 'pulseRifle', fov: 140, sight: 34, boss: true, char: { kind: 'robot', style: 'biped', size: 1.7 } }
  };

  // ── DOM overlay: crosshair, hit marker, damage wedge, vignette — inside the kit root, under its screens, never over its top bar ──
  const CSS = `
#yf-hud{position:absolute;inset:0;pointer-events:none;z-index:1;--yf-gap:8px;--yf-acc:#7cf0ff}
#yf-cross{position:absolute;left:50%;top:50%;width:0;height:0}
#yf-cross i{position:absolute;background:#fff;box-shadow:0 0 2px #000;opacity:.9}
#yf-cross .n{left:-1px;top:calc(-8px - var(--yf-gap));width:2px;height:8px}#yf-cross .s{left:-1px;top:var(--yf-gap);width:2px;height:8px}
#yf-cross .w{top:-1px;left:calc(-8px - var(--yf-gap));width:8px;height:2px}#yf-cross .e{top:-1px;left:var(--yf-gap);width:8px;height:2px}
#yf-cross .c{left:-1.5px;top:-1.5px;width:3px;height:3px;border-radius:50%}
#yf-cross.ads i{opacity:.35}#yf-cross.charge i{background:var(--yf-acc)}
#yf-hit{position:absolute;left:50%;top:50%;width:0;height:0;opacity:0;transition:opacity .08s}
#yf-hit i{position:absolute;width:2px;height:9px;background:#fff;box-shadow:0 0 2px #000;left:-1px;top:-14px;transform-origin:1px 14px}
#yf-hit.on{opacity:1}#yf-hit.ko i{background:#ff5a5a;height:13px}
#yf-dmg{position:absolute;left:50%;top:50%;width:44vmin;height:44vmin;margin:-22vmin 0 0 -22vmin;border-radius:50%;opacity:0;transition:opacity .5s;background:conic-gradient(from -25deg,rgba(255,80,60,.75) 0 50deg,transparent 50deg)}
#yf-dmg{-webkit-mask:radial-gradient(circle,transparent 62%,#000 66%);mask:radial-gradient(circle,transparent 62%,#000 66%)}
#yf-vig{position:absolute;inset:0;opacity:0;transition:opacity .4s;background:radial-gradient(circle,transparent 50%,rgba(220,40,40,.6) 100%)}
#yf-vig.low{animation:yf-pulse 1s ease-in-out infinite}
@keyframes yf-pulse{0%,100%{opacity:.25}50%{opacity:.55}}
#yf-flash{position:absolute;inset:0;opacity:0;background:#fff;transition:opacity .12s}`;
  let overlay = null;
  function domOverlay() {
    if (overlay && overlay.root.isConnected) return overlay;
    const host = document.getElementById('yk-root') || document.body || document.documentElement;
    const root = document.createElement('div'); root.id = 'yf-hud';
    const st = document.createElement('style'); st.textContent = CSS; root.appendChild(st);
    const mk = (id, inner) => { const d = document.createElement('div'); d.id = id; if (inner) d.innerHTML = inner; root.appendChild(d); return d; };
    const vig = mk('yf-vig'), dmg = mk('yf-dmg'), cross = mk('yf-cross', '<i class="n"></i><i class="s"></i><i class="w"></i><i class="e"></i><i class="c"></i>');
    const hit = mk('yf-hit', '<i style="transform:rotate(45deg)"></i><i style="transform:rotate(135deg)"></i><i style="transform:rotate(225deg)"></i><i style="transform:rotate(315deg)"></i>');
    const flash = mk('yf-flash');
    host.appendChild(root);
    let hitT = 0, dmgT = 0, flashT = 0;
    overlay = { root: root, cross: cross,
      spread(px) { root.style.setProperty('--yf-gap', Math.round(clamp(px, 3, 60)) + 'px'); },
      mode(ads, charge) { cross.className = (ads ? 'ads ' : '') + (charge ? 'charge' : ''); },
      hit(ko) { hit.className = 'on' + (ko ? ' ko' : ''); hitT = ko ? .16 : .1; },
      damage(angle) { dmg.style.transform = 'rotate(' + Math.round(angle / D2R) + 'deg)'; dmg.style.transition = 'none'; dmg.style.opacity = '1'; dmgT = .8; },
      vignette(hpFrac, punch) { vig.classList.toggle('low', hpFrac < .3); if (!(hpFrac < .3)) vig.style.opacity = String(clamp(punch, 0, 1)); },
      flash(a) { flash.style.transition = 'none'; flash.style.opacity = String(clamp(a, 0, .8)); flashT = .06; },
      update(dt) {
        if (hitT > 0 && (hitT -= dt) <= 0) hit.className = '';
        if (dmgT > 0 && (dmgT -= dt) <= 0) { dmg.style.transition = ''; dmg.style.opacity = '0'; }
        if (flashT > 0 && (flashT -= dt) <= 0) { flash.style.transition = ''; flash.style.opacity = '0'; }
      },
      remove() { root.remove(); overlay = null; } };
    return overlay;
  }

  // ── attach: builds W.fps for one world. ctx is the core's plugin context; without it (YuviFPS.attach) a light one is derived from W ──
  function attach(W, THREE, ctx) {
    if (!W || !W.scene || !THREE || !THREE.Group) { warn('attach(W, THREE): a built world and the Three module are required'); return null; }
    if (W.fps) return W.fps;
    const scene = W.scene, camera = W.camera, renderer = W.renderer, canvas = renderer.domElement;
    ctx = ctx || {};
    const rand = ctx.rand || W.rand || Math.random, groundY = ctx.groundY || W.groundY || (() => 0), size = ctx.size || W.size || 120;
    const dark = ctx.dark != null ? !!ctx.dark : !!(W.biome && W.biome.dark), palette = ctx.palette || W.palette || ['#3b3f46', '#5a6068', '#7cf0ff', '#ffffff', '#1f2226', '#ffb347'];
    const lights = ctx.lights || W.lights || [], LIGHT_CAP = ctx.LIGHT_CAP || 10, playerRef = ctx.player || W.player, enemyList = ctx.enemies || W.enemies || null;
    const collide = ctx.collide || ((p, pr, list) => { for (let i = 0; i < list.length; i++) { const ob = list[i]; if (!ob) continue; const dx = p.x - ob.x, dz = p.z - ob.z; if (ob.hw != null) { const ox = ob.hw + pr - Math.abs(dx), oz = (ob.hd != null ? ob.hd : ob.hw) + pr - Math.abs(dz); if (ox <= 0 || oz <= 0) continue; if (ox < oz) p.x += ox * (dx < 0 ? -1 : 1); else p.z += oz * (dz < 0 ? -1 : 1); } else { const d = Math.hypot(dx, dz), min = (+ob.r || .5) + pr; if (d < min && d > 1e-4) { p.x += dx / d * (min - d); p.z += dz / d * (min - d); } } } });
    const toV3 = ctx.toV3 || ((v, out) => { out = out || new THREE.Vector3(); if (!v) return out.set(0, 0, 0); if (Array.isArray(v)) return out.set(+v[0] || 0, +v[1] || 0, +v[2] || 0); if (v.isVector3) return out.copy(v); if (v.position) return out.copy(v.position); return out.set(+v.x || 0, +v.y || 0, +v.z || 0); });
    const V = new THREE.Vector3(), V2 = new THREE.Vector3(), V3 = new THREE.Vector3(), V4 = new THREE.Vector3(), M = new THREE.Matrix4(), Q = new THREE.Quaternion(), Q2 = new THREE.Quaternion(), C = new THREE.Color(), UP = new THREE.Vector3(0, 1, 0), FWD = new THREE.Vector3(0, 0, -1);
    const matCache = {};
    const noRay = obj => { obj.traverse ? obj.traverse(q => { q.userData.noRay = true; q.raycast = noop; }) : (obj.userData.noRay = true, obj.raycast = noop); return obj; };   // shots and enemy sight pass through fx, guns and pickups
    // materials: the core factory when present (shared, textured); a local Lambert/Basic cache otherwise
    const mat = (hex, unlit, tex, alpha) => {
      if (ctx.matFor) { try { return ctx.matFor(hex, !!unlit, alpha || 0, tex && ctx.textures && ctx.textures[tex] ? tex : null); } catch (e) {} }
      const k = (unlit ? 'u' : 'l') + hex + (alpha || '');
      return matCache[k] || (matCache[k] = unlit ? new THREE.MeshBasicMaterial({ color: hex, transparent: !!alpha, opacity: alpha || 1 }) : new THREE.MeshLambertMaterial({ color: hex, flatShading: true, transparent: !!alpha, opacity: alpha || 1 }));
    };
    const fps = { weapons: [], soldiers: [], rig: null, hero: null, difficulty: 1, difficultyPlayer: 1, difficultyPause: 1, hits: 0, shots: 0 };
    const wrand = mulberry32(seedNum('fps' + size));

    // ── weapon models: primitives at research proportions, -z forward, grip at the origin; sockets muzzle / eject / scope / grip; moving parts named ──
    const box = (w, h, d) => new THREE.BoxGeometry(w, h, d), cylZ = (r1, r2, h, n) => new THREE.CylinderGeometry(r1, r2, h, n || 8).rotateX(R90), coneZ = (r, h, n) => new THREE.ConeGeometry(r, h, n || 8).rotateX(-R90);
    const ringZ = (r, t, arc) => new THREE.TorusGeometry(r, t, 5, 10, arc || 6.2832);
    function buildWeapon(kind, o) {
      o = o || {};
      const cfg = WEAPONS[kind] || WEAPONS.blaster, rnd = mulberry32(seedNum(o.seed == null ? kind : o.seed)), low = o.lod === 'low';
      const skinName = SKINS[o.skin] ? o.skin : ['matte', 'camo', 'chrome', 'neon'][Math.floor(rnd() * (dark ? 4 : 3))], S = SKINS[skinName], accent = o.accent || (skinName === 'neon' ? ['#7cf0ff', '#ff5ea8', '#ffb347'][Math.floor(rnd() * 3)] : palette[2]);
      const v = Math.floor(rnd() * 3), tex = low ? null : SKIN_TEX[skinName];
      const mDark = mat(S[0], false, tex), mMid = mat(S[1], false, tex), mGrip = mat(S[2]), mDet = mat(S[3]), mAcc = mat(accent, true), mGlow = mat(accent, true, null, .55);
      const g = new THREE.Group(); g.name = 'weapon:' + kind; const parts = { glow: [] }, sockets = {};
      const add = (geo, m, x, y, z, rx, ry, rz, parent) => { const q = new THREE.Mesh(geo, m); q.position.set(x, y, z); if (rx) q.rotation.x = rx; if (ry) q.rotation.y = ry; if (rz) q.rotation.z = rz; q.userData.noRay = true; (parent || g).add(q); return q; };
      const glow = (geo, x, y, z, rx) => { const q = add(geo, mAcc, x, y, z, rx); parts.glow.push(q); return q; };
      const sock = (n, x, y, z) => { const s = new THREE.Object3D(); s.name = n; s.position.set(x, y, z); g.add(s); sockets[n] = s; return s; };
      const grip = (x, y, z, h) => add(box(.03, h || .1, .042), mGrip, x, y, z, .28);
      const guard = (z) => { if (!low) { add(ringZ(.02, .004, 3.1416), mDark, 0, -.005, z, 0, 0, 3.1416); add(box(.006, .018, .004), mDet, 0, -.008, z); } };
      const rail = (z0, n, y) => { if (!low) for (let i = 0; i < n; i++) add(box(.02, .008, .012), mDet, 0, y, z0 - i * .03); };
      if (cfg.cls === 'pistol') {
        add(box(.036, .034, .16), mMid, 0, .03, -.05); parts.slide = add(box(.038, .03, .17), mDark, 0, .064, -.065);
        add(cylZ(.008, .008, .03), mDark, 0, .064, -.165); add(coneZ(.016, .03, 8), mMid, 0, .064, -.185); glow(ringZ(.012, .003), 0, .064, -.17);
        parts.cell = glow(box(.022, .016, .05), .02, .04, -.04); if (!low) { add(box(.02, .012, .01), mDet, 0, .085, .0); glow(box(.004, .004, .12), 0, .081, -.07); }
        grip(0, -.04, .012, .1); guard(-.03); if (v === 1) add(box(.04, .012, .05), mDet, 0, -.095, .02);
        sock('muzzle', 0, .064, -.2); sock('eject', .022, .078, -.05); sock('scope', 0, .09, -.05);
      } else if (cfg.cls === 'rifle') {
        add(box(.05, .07, .32), mDark, 0, .06, -.1); add(box(.046, .056, .22 + v * .02), mMid, 0, .06, -.37); rail(-.3, 4, .094);
        add(cylZ(.012, .012, .18), mDark, 0, .066, -.57); add(cylZ(.016, .016, .05), mMid, 0, .066, -.68); glow(ringZ(.014, .003), 0, .066, -.64);
        parts.mag = add(box(.03, .13, .06), mDark, 0, -.03, -.16, .2); add(box(.032, .04, .062), mDet, 0, -.08, 0, 0, 0, 0, parts.mag);
        add(box(.05, .06, .25), v === 2 ? mMid : mDark, 0, .045, .18); if (v === 2) add(box(.02, .02, .2), mDet, 0, .08, .18);
        if (!low) { if (v === 0) { add(box(.02, .03, .1), mDet, 0, .11, -.05); add(box(.03, .01, .12), mDark, 0, .125, -.05); } else { add(cylZ(.016, .016, .06), mDet, 0, .115, -.08); glow(cylZ(.008, .008, .062), 0, .115, -.08); } add(box(.03, .006, .1), mDet, .026, .07, -.05); }
        parts.cell = glow(box(.052, .006, .16), 0, .095, -.14); parts.bolt = add(box(.015, .012, .03), mDet, .033, .075, -.02);
        grip(0, -.03, .02, .1); guard(-.02);
        sock('muzzle', 0, .066, -.71); sock('eject', .03, .08, -.06); sock('scope', 0, .11, -.1);
      } else if (cfg.cls === 'shotgun') {
        add(box(.045, .06, .22), mDark, 0, .06, -.08); add(cylZ(.014, .014, .46), mMid, 0, .075, -.42); add(cylZ(.011, .011, .42), mDark, 0, .044, -.39);
        parts.pump = add(box(.052, .046, .12), v === 1 ? mDet : mGrip, 0, .058, -.34); glow(ringZ(.017, .003), 0, .075, -.62); glow(ringZ(.017, .003), 0, .075, -.58);
        add(box(.045, .055, .24), mDark, 0, .04, .18); if (!low) { add(box(.02, .04, .05), mGrip, 0, .085, .12); add(box(.006, .008, .006), mAcc, 0, .086, -.64); }
        parts.cell = glow(box(.046, .008, .12), 0, .092, -.05); grip(0, -.02, .04, .09); guard(0);
        sock('muzzle', 0, .075, -.66); sock('eject', .026, .075, -.06); sock('scope', 0, .1, -.08);
      } else if (cfg.cls === 'smg') {
        add(box(.05, .06, .28), mDark, 0, .06, -.1); add(cylZ(.011, .011, .07), mMid, 0, .065, -.27); add(cylZ(.018, .018, .05), mDark, 0, .065, -.25); glow(ringZ(.013, .003), 0, .065, -.3);
        parts.mag = add(box(.03, .15, .022), mDark, 0, -.02, -.13); add(box(.03, .05, .04), mGrip, 0, -.03, -.2, .2);
        if (!low) { add(cylZ(.006, .006, .16), mDet, .02, .08, .18); add(cylZ(.006, .006, .16), mDet, -.02, .08, .18); add(box(.05, .04, .01), mDet, 0, .08, .26); add(box(.02, .008, .015), mDet, 0, .095, -.03); add(box(.02, .008, .015), mDet, 0, .095, -.22); }
        parts.bolt = add(box(.02, .01, .025), mDet, .033, .07, -.04); parts.cell = glow(box(.02, .02, .1), .03, .05, -.08); rail(-.14, 3, .092);
        grip(0, -.03, .03, .1); guard(-.01);
        sock('muzzle', 0, .065, -.31); sock('eject', .03, .075, -.07); sock('scope', 0, .1, -.1);
      } else if (cfg.cls === 'sniper') {
        add(box(.045, .065, .3), mDark, 0, .06, -.12); add(cylZ(.013, .013, .56), mMid, 0, .07, -.55); for (let i = 0; i < 3; i++) glow(ringZ(.022, .004), 0, .07, -.4 - i * .12);
        add(cylZ(.02, .02, .06), mDark, 0, .07, -.82); glow(coneZ(.01, .03), 0, .07, -.85);
        parts.scope = add(cylZ(.025, .025, .22), mDark, 0, .13, -.12); if (!low) { add(box(.02, .03, .03), mDet, 0, .1, -.05); add(box(.02, .03, .03), mDet, 0, .1, -.19); add(cylZ(.02, .02, .01), mGlow, 0, .13, -.235); add(cylZ(.018, .018, .01), mGlow, 0, .13, -.005); }
        add(box(.045, .06, .28), mDark, 0, .045, .2); add(box(.03, .03, .16), mGrip, 0, .09, .22); if (!low) { add(cylZ(.005, .005, .2), mDet, -.03, .0, -.5, R90 * .9); add(cylZ(.005, .005, .2), mDet, .03, .0, -.5, R90 * .9); }
        parts.bolt = new THREE.Group(); parts.bolt.position.set(.024, .075, .0); g.add(parts.bolt); add(cylZ(.006, .006, .05), mDet, .025, 0, 0, 0, 0, R90, parts.bolt); add(new THREE.SphereGeometry(.011, 6, 5), mDet, .05, 0, 0, 0, 0, 0, parts.bolt);
        parts.mag = add(box(.03, .07, .08), mDark, 0, -.01, -.1); parts.cell = glow(box(.046, .006, .2), 0, .094, -.15);
        grip(0, -.03, .04, .1); guard(-.02);
        sock('muzzle', 0, .07, -.86); sock('eject', .028, .08, -.02); sock('scope', 0, .13, -.12);
      } else if (cfg.cls === 'launcher') {
        add(cylZ(.045, .045, .7), mMid, 0, .08, -.22); add(cylZ(.05, .05, .06), mDark, 0, .08, -.55); add(cylZ(.05, .05, .06), mDark, 0, .08, .1); glow(ringZ(.048, .004), 0, .08, -.45); glow(ringZ(.048, .004), 0, .08, -.2);
        parts.rocket = add(coneZ(.04, .1, 10), mAcc, 0, .08, -.6); parts.glow.push(parts.rocket);
        add(box(.03, .09, .04), mGrip, 0, -.02, -.3, .25); if (!low) { add(box(.02, .04, .008), mDet, 0, .14, -.3); add(box(.02, .04, .008), mDet, 0, .14, .02); add(box(.06, .08, .05), mGrip, 0, .07, .16); }
        parts.cell = glow(box(.03, .014, .12), .046, .09, -.1); grip(0, -.03, .02, .1); guard(-.02);
        sock('muzzle', 0, .08, -.6); sock('eject', .04, .1, .0); sock('scope', 0, .14, -.15);
      } else {
        add(box(.05, .07, .3), mDark, 0, .06, -.1); add(box(.044, .05, .16), mMid, 0, .06, -.32); for (let i = 0; i < 3; i++) glow(ringZ(.03 - i * .006, .004), 0, .065, -.44 - i * .06);
        glow(cylZ(.008, .008, .2), 0, .065, -.5); parts.cell = glow(new THREE.CylinderGeometry(.02, .02, .09, 8), .0, .11, -.06);
        if (!low) { for (let i = 0; i < 4; i++) add(box(.052, .004, .012), mGrip, 0, .07, -.14 - i * .03); add(box(.02, .02, .02), mDet, 0, .1, .0); } add(box(.05, .06, .2), mDark, 0, .05, .15);
        grip(0, -.03, .02, .1); guard(-.02);
        sock('muzzle', 0, .065, -.6); sock('eject', .03, .08, -.08); sock('scope', 0, .12, -.1);
      }
      sock('grip', 0, -.05, .02);
      g.traverse(q => { if (q.isMesh) q.castShadow = false; }); noRay(g);
      return { group: g, parts: parts, sockets: sockets, accent: accent, skin: skinName, variant: v, len: cfg.len };
    }

    // ── weapon object: config + ammo + state machine (idle / firing / charging / reloading / empty) + reload keyframes on the model's parts ──
    function weapon(kind, o) {
      o = o || {};
      if (!WEAPONS[kind]) { warn('weapon: unknown kind "' + kind + '" — kinds: ' + Object.keys(WEAPONS).join(', ') + '; using blaster'); kind = 'blaster'; }
      const base = WEAPONS[kind], model = buildWeapon(kind, o), cfg = {};
      ['damage', 'rate', 'spread', 'ads', 'mag', 'reserve', 'reloadS', 'range', 'speed', 'splash', 'pellets', 'charge', 'gravity', 'adsFov'].forEach(k => { cfg[k] = o[k] != null ? +o[k] : (base[k] == null ? 0 : base[k]); });
      cfg.recoil = o.recoil || base.recoil; cfg.auto = o.auto != null ? !!o.auto : !!base.auto; cfg.beam = !!base.beam; cfg.sound = o.sound || base.sound; cfg.pellets = cfg.pellets || 1;
      const w = { kind: kind, cls: base.cls, name: o.name || kind, group: model.group, model: model, config: cfg, sockets: model.sockets, parts: model.parts, accent: model.accent,
        mag: cfg.mag, ammo: cfg.reserve, state: 'idle', t: 0, cool: 0, charge: 0, heat: 0, rest: o.rest || base.rest, adsPos: o.adsPos || base.adsPos, onFire: null, onReloaded: null };
      const P = model.parts, homeY = {}; for (const k in P) if (P[k] && P[k].position) homeY[k] = P[k].position.clone();
      w.canFire = () => w.mag > 0 && w.cool <= 0 && w.state !== 'reloading' && w.state !== 'switching';
      w.fire = () => {
        if (w.state === 'reloading' || w.state === 'switching' || w.cool > 0) return false;
        if (w.mag <= 0) { w.state = 'empty'; if (w.ammo > 0) w.reload(); else play('click'); return false; }
        w.mag--; w.cool = 1 / cfg.rate; w.state = 'firing'; w.t = 0; w.heat = Math.min(6, w.heat + 1); w.charge = 0;
        if (w.onFire) w.onFire(w);
        if (w.mag <= 0 && w.ammo > 0 && !cfg.beam) setTimeout(() => { if (w.mag <= 0 && w.state !== 'reloading') w.reload(); }, 220);
        return true;
      };
      w.reload = () => { if (w.state === 'reloading' || w.ammo <= 0 || w.mag >= cfg.mag) return false; w.state = 'reloading'; w.t = 0; w.charge = 0; play('click'); return true; };
      w.refill = n => { w.ammo = Math.min(cfg.reserve * 3, w.ammo + (n == null ? cfg.mag * 2 : n)); return w.ammo; };
      w.update = dt => {
        if (w.cool > 0) w.cool -= dt; w.t += dt;
        if (w.state === 'firing' && w.t > .12) w.state = w.mag > 0 ? 'idle' : 'empty';
        if (w.state !== 'firing') w.heat = Math.max(0, w.heat - dt * 5);
        if (w.state === 'reloading') {
          const p = clamp(w.t / cfg.reloadS, 0, 1), k = (a, b) => clamp((p - a) / (b - a), 0, 1);
          if (P.mag && homeY.mag) { const drop = k(.15, .35) - k(.55, .78); const e = drop >= .999 ? 1 : drop; P.mag.position.y = homeY.mag.y - e * .22; P.mag.rotation.x = (homeY.mag.x || 0) - e * .7; P.mag.visible = !(p > .35 && p < .55); }
          if (P.bolt && homeY.bolt) { const b = base.cls === 'sniper' ? Math.sin(k(.1, .3) * 3.1416) * .04 + Math.sin(k(.8, 1) * 3.1416) * .04 : Math.sin(k(.84, .96) * 3.1416) * .05; P.bolt.position.z = homeY.bolt.z + b; if (base.cls === 'sniper') P.bolt.rotation.z = Math.sin(k(.05, .35) * 3.1416) * -1.2 + Math.sin(k(.75, 1) * 3.1416) * -1.2; }
          if (P.slide && homeY.slide) P.slide.position.z = homeY.slide.z + (p < .85 ? .03 : .03 * (1 - k(.85, .95)));
          if (P.pump && homeY.pump) P.pump.position.z = homeY.pump.z + Math.abs(Math.sin(p * 3.1416 * 2.5)) * .08;
          if (P.rocket) { P.rocket.visible = p > .7; P.rocket.position.z = (homeY.rocket ? homeY.rocket.z : -.6) - (1 - k(.7, .95)) * .3; }
          if (p >= 1) { const need = cfg.mag - w.mag, take = Math.min(need, w.ammo); w.mag += take; w.ammo -= take; w.state = w.mag > 0 ? 'idle' : 'empty'; w.heat = 0; if (w.onReloaded) w.onReloaded(w); }
        } else if (P.slide && homeY.slide) P.slide.position.z = w.state === 'empty' ? homeY.slide.z + .03 : (w.state === 'firing' && w.t < .08 ? homeY.slide.z + .025 : homeY.slide.z);
        if (P.pump && homeY.pump && w.state !== 'reloading') P.pump.position.z = homeY.pump.z + (w.cool > 0 && w.cool < .45 ? Math.sin(clamp((0.45 - w.cool) / .45, 0, 1) * 3.1416) * .08 : 0);
        if (P.rocket && w.state !== 'reloading') P.rocket.visible = w.mag > 0;
        const glowK = cfg.charge ? .5 + w.charge / cfg.charge : (w.state === 'firing' ? 1.6 : 1); if (P.cell && P.cell.material.color) { /* shared material: scale the part instead */ P.cell.scale.setScalar(.9 + .12 * glowK); }
      };
      fps.weapons.push(w); return w;
    }

    // ── fx: muzzle flash (sprite + one shared PointLight), pooled shells, tracers, paint-splat decals, sparks via W.fx.hit, splash damage ──
    function canvasTex(px, draw) { const c = document.createElement('canvas'); c.width = c.height = px; const x = c.getContext('2d'); draw(x, px); const t = new THREE.CanvasTexture(c); if (THREE.SRGBColorSpace) t.colorSpace = THREE.SRGBColorSpace; return t; }
    const flashTex = canvasTex(64, (x, n) => { const g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(.25, 'rgba(255,240,200,.9)'); g.addColorStop(1, 'rgba(255,200,120,0)'); x.fillStyle = g; x.fillRect(0, 0, n, n);
      x.fillStyle = 'rgba(255,255,255,.85)'; for (let i = 0; i < 6; i++) { x.save(); x.translate(32, 32); x.rotate(i * 1.047); x.beginPath(); x.moveTo(-2, 0); x.lineTo(0, -31); x.lineTo(2, 0); x.fill(); x.restore(); } });
    const splatTex = canvasTex(64, (x, n) => { x.fillStyle = '#fff'; x.beginPath(); x.arc(32, 32, 16, 0, 6.2832); x.fill(); const r = mulberry32(5); for (let i = 0; i < 9; i++) { const a = r() * 6.2832, d = 12 + r() * 14; x.beginPath(); x.arc(32 + Math.cos(a) * d, 32 + Math.sin(a) * d, 2 + r() * 6, 0, 6.2832); x.fill(); } });
    const flashMat = new THREE.SpriteMaterial({ map: flashTex, color: '#ffffff', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    function makeFlash(parent, sz, noDepth) { const s = new THREE.Sprite(noDepth ? new THREE.SpriteMaterial({ map: flashTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, fog: false }) : flashMat); s.scale.setScalar(sz); s.visible = false; noRay(s); s.renderOrder = 5; if (parent) parent.add(s); return { s: s, t: 0, sz: sz }; }
    const flashes = [];
    function flashOn(f, color) { f.t = .06; f.n = 0; f.s.visible = true; f.s.material.rotation = rand() * 6.2832; f.s.scale.setScalar(f.sz * (.8 + rand() * .5)); if (color && f.s.material !== flashMat) f.s.material.color.set(color); if (flashes.indexOf(f) < 0) flashes.push(f); }
    let flashLight = null, flashLightT = 0;
    if (lights.length < LIGHT_CAP) { flashLight = new THREE.PointLight('#ffc070', 0, 7, 2); flashLight.visible = false; scene.add(flashLight); lights.push(flashLight); }
    const lightAt = (p, col, i) => { if (!flashLight) return; flashLight.position.copy(p); if (col) flashLight.color.set(col); flashLight.intensity = i || 6; flashLight.visible = true; flashLightT = .07; };
    const shells = { mesh: new THREE.InstancedMesh(new THREE.CylinderGeometry(.006, .006, .018, 6), mat('#e0b85a'), 32), n: 32, items: [], next: 0 };
    shells.mesh.frustumCulled = false; noRay(shells.mesh); shells.mesh.count = 0; scene.add(shells.mesh);
    for (let i = 0; i < 32; i++) shells.items.push({ on: false, p: new THREE.Vector3(), v: new THREE.Vector3(), t: 0, spin: 0, bounced: false });
    function ejectShell(at, right, color) {
      const s = shells.items[shells.next = (shells.next + 1) % shells.n]; s.on = true; s.p.copy(at); s.t = 0; s.bounced = false; s.spin = rand() * 6.28;
      s.v.copy(right).multiplyScalar(1.5 + rand()).addScaledVector(UP, 1 + rand() * .6); C.set(color || '#e0b85a'); shells.mesh.setColorAt(shells.next, C); if (shells.mesh.instanceColor) shells.mesh.instanceColor.needsUpdate = true;
      shells.mesh.count = shells.n;
    }
    const tracers = { mesh: new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: .85, fog: false }), 24), n: 24, items: [], next: 0 };
    tracers.mesh.frustumCulled = false; noRay(tracers.mesh); tracers.mesh.count = 0; scene.add(tracers.mesh);
    for (let i = 0; i < 24; i++) tracers.items.push({ on: false, t: 0, life: .07, a: new THREE.Vector3(), b: new THREE.Vector3(), w: .02, n: 0 });
    function tracer(a, b, color, life, width) {
      const i = tracers.next = (tracers.next + 1) % tracers.n, t = tracers.items[i]; t.on = true; t.t = 0; t.n = 0; t.life = life || .07; t.a.copy(a); t.b.copy(b); t.w = width || .02;
      C.set(color || '#7cf0ff'); tracers.mesh.setColorAt(i, C); if (tracers.mesh.instanceColor) tracers.mesh.instanceColor.needsUpdate = true; tracers.mesh.count = tracers.n;
    }
    const decals = { items: [], n: 48, next: 0, mats: {} };
    const decalMat = hex => decals.mats[hex] || (decals.mats[hex] = new THREE.MeshBasicMaterial({ map: splatTex, color: hex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, side: THREE.DoubleSide }));
    const decalGeo = new THREE.PlaneGeometry(1, 1);
    function splat(point, normal, color, sz) {
      let d = decals.items[decals.next]; if (!d) { d = new THREE.Mesh(decalGeo, decalMat(color || '#7cf0ff')); noRay(d); d.renderOrder = 2; scene.add(d); decals.items[decals.next] = d; }
      decals.next = (decals.next + 1) % decals.n; d.material = decalMat(color || '#7cf0ff'); d.visible = true;
      V3.copy(normal && normal.lengthSq() > 0 ? normal : UP); d.position.copy(point).addScaledVector(V3, .01); V4.copy(d.position).add(V3); d.lookAt(V4); d.rotateZ(rand() * 6.28); d.scale.setScalar((sz || .16) * (.7 + rand() * .7));
    }
    function sparks(point, color, n) { if (W.fx && W.fx.hit) W.fx.hit(point, { color: color || '#7cf0ff', count: n || 10, spread: 4, size: .06, life: .35 }); }
    function splash(point, radius, dmg, color, from) {
      sparks(point, color, 40); if (W.fx && W.fx.flashLight) W.fx.flashLight(90, 2); lightAt(point, color, 14); play('explode');
      for (let i = 0; i < fps.soldiers.length; i++) { const s = fps.soldiers[i]; if (!s.alive) continue; const d = Math.hypot(s.pos.x - point.x, s.pos.y + .9 - point.y, s.pos.z - point.z); if (d < radius) s.takeDamage(dmg * (1 - d / radius * .6), point, from); }
      const pc = playerRef && playerRef.current; if (pc && fps.hero && from !== 'player') { const d = Math.hypot(pc.pos.x - point.x, pc.pos.y + 1 - point.y, pc.pos.z - point.z); if (d < radius) fps.hero.damage(dmg * .5 * (1 - d / radius), point); }
      else if (pc) { const k = kitOf(); if (k && Math.hypot(pc.pos.x - point.x, pc.pos.z - point.z) < radius * 3) k.fx.shake(6, 180); }
    }
    function fxUpdate(dt) {
      for (let i = flashes.length - 1; i >= 0; i--) { const f = flashes[i]; f.n = (f.n || 0) + 1; if ((f.t -= dt) <= 0 && f.n > 2) { f.s.visible = false; flashes.splice(i, 1); } }
      if (flashLight && flashLight.visible && (flashLightT -= dt) <= 0) { flashLight.visible = false; flashLight.intensity = 0; }
      if (shells.mesh.count) { let any = false; for (let i = 0; i < shells.n; i++) { const s = shells.items[i]; if (!s.on) { M.makeScale(0, 0, 0); shells.mesh.setMatrixAt(i, M); continue; } any = true;
          s.t += dt; s.v.y -= 9.8 * dt; s.p.addScaledVector(s.v, dt); s.spin += dt * 20; const gy = groundY(s.p.x, s.p.z);
          if (s.p.y < gy + .01) { s.p.y = gy + .01; if (!s.bounced) { s.v.y *= -.3; s.v.x *= .5; s.v.z *= .5; s.bounced = true; } else s.v.set(0, 0, 0); }
          if (s.t > 1.4) s.on = false; M.compose(s.p, Q.setFromAxisAngle(V.set(1, 0, .4).normalize(), s.spin), V2.set(1, 1, 1)); shells.mesh.setMatrixAt(i, M); }
        shells.mesh.instanceMatrix.needsUpdate = true; if (!any) shells.mesh.count = 0; }
      if (tracers.mesh.count) { let any = false; for (let i = 0; i < tracers.n; i++) { const t = tracers.items[i]; if (!t.on) { M.makeScale(0, 0, 0); tracers.mesh.setMatrixAt(i, M); continue; } any = true;
          t.t += dt; t.n++; if (t.t > t.life && t.n > 2) { t.on = false; M.makeScale(0, 0, 0); tracers.mesh.setMatrixAt(i, M); continue; }
          const len = t.a.distanceTo(t.b), k = Math.max(.3, 1 - t.t / t.life); V.copy(t.a).lerp(t.b, .5); V2.copy(t.b).sub(t.a).normalize(); Q.setFromUnitVectors(FWD, V2);
          M.compose(V, Q, V3.set(t.w * (.5 + k), t.w * (.5 + k), len)); tracers.mesh.setMatrixAt(i, M); }
        tracers.mesh.instanceMatrix.needsUpdate = true; if (!any) tracers.mesh.count = 0; }
    }

    // ── arms: the viewmodel rig. A second scene in camera space rendered after the world with a narrower FOV (renderer.render is wrapped,
    //    depth cleared in between, so the gun never clips walls). Sway from the look delta, figure-8 bob, spring recoil, ADS, reload/switch poses ──
    const soldierOf = obj => { let p = obj; while (p) { if (p.userData && p.userData.fpsSoldier) return p.userData.fpsSoldier; p = p.parent; } return null; };
    const hitNormal = (hit, out) => { if (!hit.normal) return out.set(0, 1, 0); out.copy(hit.normal); if (hit.object.isInstancedMesh && hit.instanceId != null) { hit.object.getMatrixAt(hit.instanceId, M); M.premultiply(hit.object.matrixWorld); return out.transformDirection(M); } return out.transformDirection(hit.object.matrixWorld); };
    function arms(ctrl, o) {
      o = o || {};
      if (!ctrl || !ctrl.camera) { warn('arms(ctrl, opts): the fps controller (W.player.fps()) is required'); return { weapons: [], current: null, update: noop, fire: noop, reload: noop, equip: noop, next: noop, ads: noop, add: noop, spread: 0, visible: false }; }
      if (fps.rig) return fps.rig;
      const ui = domOverlay(), hemi = ctx.hemi || W.hemi, sun = ctx.sun || W.sun, baseFov = camera.fov;
      const vmScene = new THREE.Scene(), vmCam = new THREE.PerspectiveCamera(+o.fov || 55, camera.aspect, .01, 8), vmFov = vmCam.fov;
      const vHemi = new THREE.HemisphereLight(hemi ? hemi.color : '#ffffff', hemi ? hemi.groundColor : '#444444', (hemi ? hemi.intensity : 1) * 1.1), vSun = new THREE.DirectionalLight(sun ? sun.color : '#ffffff', (sun ? sun.intensity : 2) * .9), vFill = new THREE.AmbientLight('#ffffff', dark ? .5 : .2);
      vmScene.add(vHemi, vSun, vFill);
      const hand = new THREE.Group(); hand.name = 'hand'; vmScene.add(hand);
      const flash = makeFlash(null, .18, true);
      const rig = { scene: vmScene, camera: vmCam, hand: hand, weapons: [], current: null, index: -1, visible: true, adsK: 0, spread: 0, sprinting: false, mouseDown: false, kick: 0, overlay: ui, stats: { shots: 0, hits: 0 } };
      const S = { sway: new THREE.Vector2(), swayT: new THREE.Vector2(), bobT: 0, bob: new THREE.Vector2(), idleT: 0, kz: 0, kzv: 0, krx: 0, krxv: 0, kry: 0, camPitch: 0, camYaw: 0, adsWant: false, rp: 0, sp: 0, cp: 0, sw: null, last: 0, prevYaw: ctrl.yaw, prevPitch: ctrl.pitch, held: false, charging: false };
      const fireKey = o.fireKey || 'KeyJ', adsKey = o.adsKey || 'KeyF';
      const uiTarget = t => !!(t && t.closest && t.closest('#yk-root button, #yk-joy, #yk-tbs, .yk-screen, #yuvi-ui, .yu-panel'));
      rig.add = w => { if (typeof w === 'string') w = weapon(w, Object.assign({ seed: (o.seed || 0) + rig.weapons.length * 17 }, o.style || {})); if (!w || !w.group) return null; rig.weapons.push(w); w.group.visible = false; hand.add(w.group); w.group.rotation.set(0, -3 * D2R, 2 * D2R); w.owner = rig; if (rig.index < 0) rig.equip(0); return w; };
      rig.equip = i => {
        if (typeof i === 'string') i = rig.weapons.findIndex(w => w.kind === i || w.name === i);
        if (i < 0 || i >= rig.weapons.length || (i === rig.index && !S.sw)) return rig.current;
        if (rig.index < 0) { rig.index = i; rig.current = rig.weapons[i]; rig.current.group.visible = true; if (rig.current.sockets.muzzle) rig.current.sockets.muzzle.add(flash.s); updateHud(); return rig.current; }
        S.sw = { to: i, t: 0, from: rig.index }; if (rig.current) rig.current.state = 'switching'; return rig.weapons[i];
      };
      rig.next = d => { if (rig.weapons.length > 1) rig.equip((rig.index + (d || 1) + rig.weapons.length) % rig.weapons.length); };
      rig.last = () => { if (S.sw) return; rig.equip(S.last); };
      rig.ads = on => { S.adsWant = !!on; };
      rig.reload = () => { const w = rig.current; return !!(w && w.reload()); };
      rig.hitMarker = ko => { ui.hit(ko); rig.stats.hits++; fps.hits++; play(ko ? 'buzz' : 'hit'); };
      const cone = (dir, deg, out) => { out.copy(dir); if (deg <= 0) return out; V4.set(rand() - .5, rand() - .5, rand() - .5).cross(dir); if (V4.lengthSq() < 1e-6) V4.set(1, 0, 0); return out.applyAxisAngle(V4.normalize(), deg * D2R * Math.sqrt(rand())); };
      let hudStr = '';   // the rig is usually built before YuviKit.init, so the HUD is refreshed lazily whenever the ammo text changes
      function updateHud() { const k = kitOf(), w = rig.current; if (!k || !w) return; const str = w.mag + ' / ' + w.ammo; if (str === hudStr) return; if (k.hud.get('ammo') !== undefined) { k.hud.set('ammo', str); hudStr = str; } if (k.hud.get('weapon') !== undefined) k.hud.set('weapon', w.name); }
      function sysFor(w) {
        if (w.sys) return w.sys; const cfg = w.config, col = w.accent;
        w.sys = W.projectiles({ speed: cfg.speed, gravity: cfg.gravity || 0, radius: .12, pool: cfg.splash ? 8 : 24, life: 4, color: col, targets: () => fps.soldiers,
          onHit: (t, p, d) => { if (d && d.splash) splash(p, d.splash, d.dmg, col, 'player'); else { t.takeDamage(d ? d.dmg : cfg.damage, p, 'player'); rig.hitMarker(!t.alive); } },
          onMiss: (p, d) => { if (d && d.splash) splash(p, d.splash, d.dmg, col, 'player'); else { splat(p, UP, col); sparks(p, col, 6); } } });
        return w.sys;
      }
      function shoot() {
        const w = rig.current; if (!w || !w.fire()) return false;
        const cfg = w.config; rig.stats.shots++; fps.shots++;
        hand.updateMatrixWorld(true); w.sockets.muzzle.getWorldPosition(V); camera.localToWorld(V); const muzzle = V3.copy(V);
        camera.getWorldPosition(V); camera.getWorldDirection(V2);
        const eye = S.eye || (S.eye = new THREE.Vector3()), fwd = S.fwd || (S.fwd = new THREE.Vector3()), dir = S.dir || (S.dir = new THREE.Vector3()), end = S.end || (S.end = new THREE.Vector3()), nrm = S.nrm || (S.nrm = new THREE.Vector3());
        eye.copy(V); fwd.copy(V2);
        for (let p = 0; p < cfg.pellets; p++) {
          cone(fwd, rig.spread, dir);
          const hit = W.raycast(eye, dir, cfg.range);
          if (cfg.speed > 0) { end.copy(hit ? hit.point : eye).addScaledVector(dir, hit ? 0 : cfg.range); dir.copy(end).sub(muzzle).normalize(); const m = sysFor(w).fire(muzzle, dir, { speed: cfg.speed, color: w.accent, data: { dmg: cfg.damage * fps.difficultyPlayer, splash: cfg.splash } }); if (m && m.scale) { m.scale.set(1, 1, 2.6); m.quaternion.setFromUnitVectors(FWD, dir); } }
          else {
            if (hit) { end.copy(hit.point); const s = soldierOf(hit.object); if (s && s.alive) { s.takeDamage(cfg.damage * fps.difficultyPlayer, hit.point, 'player'); rig.hitMarker(!s.alive); } else { hitNormal(hit, nrm); splat(hit.point, nrm, w.accent, cfg.beam ? .1 : .16); sparks(hit.point, w.accent, cfg.beam ? 3 : 8); } }
            else end.copy(eye).addScaledVector(dir, cfg.range);
            tracer(muzzle, end, w.accent, cfg.beam ? .1 : (cfg.cls === 'sniper' ? .25 : .06), cfg.cls === 'sniper' ? .04 : .02);
          }
        }
        flashOn(flash, w.accent); lightAt(muzzle, w.accent, cfg.cls === 'beam' ? 3 : 7);
        if (!cfg.beam && cfg.cls !== 'launcher') { w.sockets.eject.getWorldPosition(V); camera.localToWorld(V); V2.set(1, 0, 0).applyQuaternion(camera.getWorldQuaternion(Q)); ejectShell(V, V2, cfg.cls === 'pistol' || cfg.cls === 'smg' ? '#e0b85a' : w.accent); }
        const R = cfg.recoil, adsK = 1 - rig.adsK * .5; S.kz += R[0] * adsK; S.krx += R[1] * D2R * adsK; S.kry = (rand() - .5) * R[1] * .3 * D2R;
        const cp = (R[2] * (.8 + rand() * .4)) * D2R * adsK, cy = (rand() - .5) * R[2] * .35 * D2R; ctrl.pitch += cp; ctrl.yaw += cy; S.camPitch += cp; S.camYaw += cy;
        play(cfg.sound); if (fps.noise) fps.noise(eye, cfg.beam ? 10 : 24); updateHud();
        if (!cfg.beam) { const k = kitOf(); if (k) k.fx.shake(cfg.cls === 'launcher' || cfg.cls === 'shotgun' ? 4 : 1.5, 70); }
        return true;
      }
      rig.fire = () => { if (!playing() || !rig.current) return false; const w = rig.current; if (w.config.charge) { if (w.canFire()) { S.charging = true; w.state = 'charging'; w.charge = 0; } return true; } return shoot(); };
      const trigger = () => rig.fire();
      const onDown = e => { if (uiTarget(e.target)) return; if (e.button === 2) { S.adsWant = true; return; } if (e.button !== 0 && e.pointerType !== 'touch') return; rig.mouseDown = true; if (playing()) trigger(); };
      const onUp = e => { if (e.button === 2) S.adsWant = false; else rig.mouseDown = false; };
      window.addEventListener('pointerdown', onDown, true); window.addEventListener('pointerup', onUp, true); window.addEventListener('pointercancel', onUp, true);
      window.addEventListener('blur', () => { rig.mouseDown = false; S.adsWant = false; });
      canvas.addEventListener('contextmenu', e => e.preventDefault());
      window.addEventListener('keydown', e => { if (!playing() || e.repeat) return; const c = e.code;
        if (c === 'KeyR') rig.reload(); else if (c === 'KeyQ') rig.last(); else if (c === adsKey) S.adsWant = !S.adsWant; else if (/^Digit[1-9]$/.test(c)) rig.equip(+c[5] - 1); });
      window.addEventListener('wheel', e => { if (playing() && Math.abs(e.deltaY) > 2) rig.next(e.deltaY > 0 ? 1 : -1); }, { passive: true });
      const k0 = kitOf(); if (k0) { k0.input.on('fire', trigger); k0.input.on('reload', rig.reload); k0.input.on('ads', () => { S.adsWant = !S.adsWant; }); k0.input.on('switch', () => rig.next(1)); }
      // renderer.render wrapper: world first, depth cleared, then the viewmodel with its own camera (the core's run loop keeps calling render)
      const orig = renderer.render.bind(renderer); let inVm = false;
      renderer.render = (s, c) => { if (inVm || s !== scene || !rig.visible || !rig.current) { orig(s, c); return; }
        renderer.info.autoReset = false; renderer.info.reset(); orig(s, c); inVm = true;
        try { const ac = renderer.autoClear; renderer.autoClear = false; renderer.clearDepth(); syncVm(); orig(vmScene, vmCam); renderer.autoClear = ac; } finally { inVm = false; } };
      function syncVm() {
        const a = (canvas.width || 640) / (canvas.height || 360); if (Math.abs(vmCam.aspect - a) > 1e-3) { vmCam.aspect = a; vmCam.updateProjectionMatrix(); }
        camera.getWorldQuaternion(Q).invert(); if (sun) vSun.position.copy(sun.position).normalize().applyQuaternion(Q).multiplyScalar(5); vHemi.position.copy(UP).applyQuaternion(Q);
      }
      rig.update = dt => {
        const w = rig.current; ui.update(dt); if (!w) return; updateHud();
        const k = kitOf(), inp = k ? k.input : null, moving = ctrl.onGround && Math.hypot(ctrl.vel.x, ctrl.vel.z) > .6, speed = Math.hypot(ctrl.vel.x, ctrl.vel.z);
        rig.sprinting = moving && !!inp && (inp.pressed('ShiftLeft') || inp.pressed('ShiftRight')) && speed > 7;
        const cfg = w.config;
        // held fire / charge
        S.held = rig.mouseDown || (!!inp && inp.pressed(fireKey));
        if (playing()) {
          if (cfg.charge) { if (S.charging) { if (!S.held && w.charge < cfg.charge) { S.charging = false; w.charge = 0; w.state = 'idle'; } else { w.charge += dt; if (w.charge >= cfg.charge) { S.charging = false; w.state = 'idle'; shoot(); } } } }
          else if (S.held && cfg.auto) shoot();
        } else { rig.mouseDown = false; }
        for (let i = 0; i < rig.weapons.length; i++) rig.weapons[i].update(dt);
        // recoil springs (k 250, c 32) and camera recovery
        for (let n = Math.ceil(dt * 120), h = dt / (n || 1); n > 0; n--) { S.kzv += (-250 * S.kz - 32 * S.kzv) * h; S.kz += S.kzv * h; S.krxv += (-220 * S.krx - 30 * S.krxv) * h; S.krx += S.krxv * h; }   // substepped: stable on slow frames
        S.kry = damp(S.kry, 0, 14, dt);
        const rp = S.camPitch * (1 - Math.exp(-dt * 9)), ry = S.camYaw * (1 - Math.exp(-dt * 9)); ctrl.pitch -= rp; ctrl.yaw -= ry; S.camPitch -= rp; S.camYaw -= ry;
        // sway from the look delta (ctrl already consumed YuviKit.input.look, so the yaw/pitch change is the delta)
        const dy = lerpAngle(S.prevYaw, ctrl.yaw, 1) - S.prevYaw + ry, dp = ctrl.pitch - S.prevPitch + rp; S.prevYaw = ctrl.yaw; S.prevPitch = ctrl.pitch;
        const adsK = rig.adsK = damp(rig.adsK, S.adsWant && !S.sw && w.state !== 'reloading' && !rig.sprinting ? 1 : 0, cfg.cls === 'sniper' || cfg.cls === 'launcher' ? 7 : 12, dt);
        S.swayT.set(clamp(dy * 1.1, -.06, .06), clamp(dp * 1.1, -.06, .06)); S.sway.lerp(S.swayT, 1 - Math.exp(-dt * 12));
        S.bobT += dt * (moving ? speed * 1.4 : 0); S.idleT += dt; const amp = (moving ? (rig.sprinting ? .02 : .012) : .003) * (1 - adsK * .7);
        S.bob.set(Math.sin(S.bobT) * amp, Math.abs(Math.cos(S.bobT)) * amp * 1.3 + Math.sin(S.idleT * 1.6) * .003);
        S.rp = damp(S.rp, w.state === 'reloading' ? 1 : 0, 10, dt); S.sp = damp(S.sp, rig.sprinting ? 1 : 0, 8, dt); S.cp = damp(S.cp, ctrl.crouching ? 1 : 0, 8, dt);
        let swK = 0; if (S.sw) { S.sw.t += dt; swK = S.sw.t < .18 ? S.sw.t / .18 : 1 - clamp((S.sw.t - .18) / .22, 0, 1);
          if (S.sw.t >= .18 && rig.index !== S.sw.to) { w.group.visible = false; if (w.state === 'switching') w.state = w.mag > 0 ? 'idle' : 'empty'; S.last = rig.index; rig.index = S.sw.to; rig.current = rig.weapons[rig.index]; rig.current.group.visible = true; rig.current.state = 'switching'; if (rig.current.sockets.muzzle) rig.current.sockets.muzzle.add(flash.s); updateHud(); play('click'); }
          if (S.sw.t >= .4) { S.sw = null; if (rig.current.state === 'switching') rig.current.state = rig.current.mag > 0 ? 'idle' : 'empty'; } }
        const cw = rig.current, rest = cw.rest, ads = cw.adsPos, sK = 1 - adsK * .7;
        hand.position.set(lerp(rest[0], ads[0], adsK) + S.sway.x * sK + S.bob.x * sK, lerp(rest[1], ads[1], adsK) + S.sway.y * sK + S.bob.y * sK - S.rp * .06 - swK * .3 - S.sp * .05 - S.cp * .015, lerp(rest[2], ads[2], adsK) + S.kz + S.cp * .02);
        hand.rotation.set(S.sway.y * 1.5 * sK + S.krx - S.rp * .45 - swK * .6 - S.sp * .28, -S.sway.x * .8 * sK + S.kry + S.sp * .38, -S.sway.x * 2 * sK - S.sp * .12);
        camera.fov = lerp(baseFov, cfg.adsFov || baseFov * .68, adsK); camera.updateProjectionMatrix(); vmCam.fov = lerp(vmFov, vmFov * .82, adsK); vmCam.updateProjectionMatrix();
        // crosshair spread: base lerps hip → ads, grows with movement, air, heat; decays with the weapon's heat
        const base = lerp(cfg.spread, cfg.ads, adsK); rig.spread = base * (ctrl.crouching ? .75 : 1) + speed * .12 * (1 - adsK * .6) + (ctrl.onGround ? 0 : 2) + cw.heat * base * .18;
        ui.spread(4 + rig.spread * 20 * (cfg.pellets > 1 ? .5 : 1)); ui.mode(adsK > .6, S.charging);
        if (cw.state === 'charging') ui.cross.style.setProperty('--yf-acc', cw.accent);
      };
      rig.remove = () => { rig.visible = false; renderer.render = orig; };
      (o.weapons || ['blaster', 'pulseRifle', 'scatterGun']).forEach(w => rig.add(w));
      const curW = rig.current; if (curW) curW.onReloaded = updateHud;
      rig.weapons.forEach(w => { w.onReloaded = updateHud; });
      fps.rig = rig; return rig;
    }

    // ── player state: hp / armor / regen, damage feedback (shake, vignette, direction wedge, sound), pickups, kit HUD ids hp / armor / ammo ──
    function player(ctrl, o) {
      o = o || {};
      if (!ctrl || !ctrl.pos) { warn('player(ctrl, opts): the fps controller is required'); return { hp: 0, armor: 0, dead: true, damage: noop, heal: noop, pickup: noop, update: noop, respawn: noop }; }
      if (fps.hero) return fps.hero;
      const ui = domOverlay(), maxHp = +o.hp || 100, maxArmor = +o.maxArmor || 100;
      const p = { hp: maxHp, maxHp: maxHp, armor: +o.armor || 0, maxArmor: maxArmor, regen: +o.regen || 0, dead: false, ctrl: ctrl, sinceHit: 9, invuln: 0, kills: 0,
        proxy: { position: ctrl.pos, userData: { __hit: { r: .55, cy: .95 } }, alive: true }, vigT: 0, hudHp: -1, hudAr: -1 };
      const hud = () => { const k = kitOf(); if (!k) return; const hp = Math.max(0, Math.round(p.hp)), ar = Math.round(p.armor);
        if (hp !== p.hudHp && k.hud.get('hp') !== undefined) k.hud.set('hp', hp); if (ar !== p.hudAr && k.hud.get('armor') !== undefined) k.hud.set('armor', ar); p.hudHp = hp; p.hudAr = ar; };
      p.damage = (n, from) => {
        if (p.dead || p.invuln > 0 || !(n > 0)) return false; n *= fps.difficulty;
        const a = Math.min(p.armor, n * .66); p.armor -= a; n -= a; p.hp = Math.max(0, p.hp - n); p.sinceHit = 0; p.vigT = .35;
        const k = kitOf(); if (k) k.fx.shake(Math.min(10, 3 + n * .3), 140); play('hurt'); ui.vignette(p.hp / maxHp, .4 + n / 40);
        if (from) { const f = toV3(from, V), tx = f.x - ctrl.pos.x, tz = f.z - ctrl.pos.z, fx = -Math.sin(ctrl.yaw), fz = -Math.cos(ctrl.yaw); ui.damage(Math.atan2(-(fz * tx - fx * tz), fx * tx + fz * tz)); ctrl.pitch += (rand() - .5) * .014; ctrl.yaw += (rand() - .5) * .014; }
        if (typeof o.onDamage === 'function') { try { o.onDamage(n, p); } catch (e) { console.error(e); } }
        if (p.hp <= 0) { p.dead = true; p.proxy.alive = false; ui.vignette(0, 1); play('lose'); if (typeof o.onDead === 'function') { try { o.onDead(p); } catch (e) { console.error(e); } } else { const k2 = kitOf(); if (k2) setTimeout(() => k2.screens.gameOver({ reason: o.deadText || '' }), 600); } }
        hud(); return true;
      };
      p.heal = n => { p.hp = Math.min(maxHp, p.hp + (+n || 25)); ui.vignette(p.hp / maxHp, 0); hud(); return p.hp; };
      p.addArmor = n => { p.armor = Math.min(maxArmor, p.armor + (+n || 25)); hud(); return p.armor; };
      p.pickup = (kind, amount, extra) => {
        const rig = fps.rig; let ok = true;
        if (kind === 'health') { if (p.hp >= maxHp) ok = false; else p.heal(amount); }
        else if (kind === 'armor') { if (p.armor >= maxArmor) ok = false; else p.addArmor(amount); }
        else if (kind === 'ammo') { if (rig && rig.weapons.length) rig.weapons.forEach(w => w.refill(amount == null ? null : amount * w.config.mag)); }
        else if (kind === 'weapon') { if (rig) { const have = rig.weapons.find(w => w.kind === extra); if (have) have.refill(); else rig.add(extra || 'pulseRifle'); const w = rig.weapons.find(x => x.kind === extra); if (w) rig.equip(rig.weapons.indexOf(w)); } }
        if (ok) { play('pickup'); const k = kitOf(); if (k) k.fx.flash(kind === 'health' ? 'rgba(120,255,160,.25)' : kind === 'armor' ? 'rgba(120,180,255,.25)' : 'rgba(255,255,255,.18)', 140); }
        if (fps.rig && kind !== 'health' && kind !== 'armor') { const k = kitOf(), w = fps.rig.current; if (k && w && k.hud.get('ammo') !== undefined) k.hud.set('ammo', w.mag + ' / ' + w.ammo); }
        return ok;
      };
      p.respawn = pos => { p.hp = maxHp; p.armor = +o.armor || 0; p.dead = false; p.proxy.alive = true; p.invuln = 1.5; if (pos) ctrl.teleport(pos); ui.vignette(1, 0); hud(); };
      p.update = dt => {
        if (p.invuln > 0) p.invuln -= dt; p.sinceHit += dt;
        if (p.vigT > 0 && (p.vigT -= dt) <= 0) ui.vignette(p.hp / maxHp, 0);
        if (!p.dead && p.regen > 0 && p.sinceHit > 5 && p.hp < maxHp) { p.hp = Math.min(maxHp, p.hp + p.regen * dt); if ((p.hp | 0) !== p.hudHp) hud(); }
      };
      hud(); fps.hero = p; return p;
    }

    // ── enemies: character (or drone / turret body) + low-LOD gun in the hand socket + a richer FSM: patrol → alert → engage (bursts with aim error,
    //    range keeping, strafe) → cover-peek (scored cover points from the player's obstacles) → search → retreat; power-down dissolve on 0 hp ──
    const downed = [];
    let enemyShots = null;
    const enemySys = () => enemyShots || (enemyShots = W.projectiles({ speed: 34, gravity: 0, radius: .12, pool: 40, life: 3, color: '#ff5a5a', targets: () => (fps.hero && !fps.hero.dead ? [fps.hero.proxy] : []),
      onHit: (t, p, d) => { if (fps.hero) fps.hero.damage(d ? d.dmg : 5, d && d.from ? d.from.pos : p); sparks(p, d && d.from ? d.from.accent : '#ff5a5a', 6); },
      onMiss: (p, d) => { splat(p, UP, d && d.from ? d.from.accent : '#ff5a5a', .2); } }));
    function droneBody(rnd, accent) {
      const g = new THREE.Group(), dk = mat('#2a2e36'), md = mat('#8a94a0'); g.name = 'drone';
      const core = new THREE.Mesh(new THREE.SphereGeometry(.28, 8, 6), dk); core.position.y = .5; g.add(core);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(.42, .05, 5, 12), md); ring.rotation.x = R90; ring.position.y = .5; g.add(ring);
      const rotors = []; for (let i = 0; i < 4; i++) { const a = i * R90 + R90 / 2, arm = new THREE.Mesh(new THREE.BoxGeometry(.5, .03, .05), md); arm.position.set(Math.cos(a) * .3, .55, Math.sin(a) * .3); arm.rotation.y = -a; g.add(arm);
        const r = new THREE.Mesh(new THREE.CylinderGeometry(.17, .17, .015, 8), mat('#3a3f48', false, null, .6)); r.position.set(Math.cos(a) * .52, .6, Math.sin(a) * .52); g.add(r); rotors.push(r); }
      const eye = new THREE.Mesh(new THREE.SphereGeometry(.09, 6, 5), mat(accent, true)); eye.position.set(0, .5, .26); g.add(eye);
      const gun = new THREE.Object3D(); gun.position.set(0, .3, .15); gun.rotation.y = Math.PI; g.add(gun);
      g.userData.rotors = rotors; g.userData.gun = gun; g.userData.height = .7; g.userData.radius = .5; g.userData.eyeY = .5; g.parts = { body: g, head: core, glow: eye }; return g;
    }
    function turretBody(rnd, accent) {
      const g = new THREE.Group(), dk = mat('#2a2e36'), md = mat('#6d7480', false, 'metal'); g.name = 'turret';
      const base = new THREE.Mesh(new THREE.CylinderGeometry(.55, .65, .3, 10), md); base.position.y = .15; g.add(base);
      const col = new THREE.Mesh(new THREE.CylinderGeometry(.18, .22, .6, 8), dk); col.position.y = .6; g.add(col);
      const head = new THREE.Group(); head.position.y = 1.05; g.add(head);
      const hb = new THREE.Mesh(new THREE.BoxGeometry(.55, .36, .55), md); head.add(hb); const visor = new THREE.Mesh(new THREE.BoxGeometry(.4, .06, .02), mat(accent, true)); visor.position.set(0, .06, .28); head.add(visor);
      const gun = new THREE.Object3D(); gun.position.set(.16, -.05, .3); gun.rotation.y = Math.PI; head.add(gun);
      g.userData.gun = gun; g.userData.height = 1.4; g.userData.radius = .6; g.userData.eyeY = 1.1; g.parts = { body: g, head: head, glow: visor }; return g;
    }
    const gearBox = (parent, src, sx, sy, sz, ox, oy, oz, m) => { const bb = src.geometry.boundingBox || (src.geometry.computeBoundingBox(), src.geometry.boundingBox); const w = bb.max.x - bb.min.x, h = bb.max.y - bb.min.y, d = bb.max.z - bb.min.z;
      const q = new THREE.Mesh(new THREE.BoxGeometry(w * sx, h * sy, Math.max(.02, d * sz)), m); q.position.set((bb.min.x + bb.max.x) / 2 + w * ox, (bb.min.y + bb.max.y) / 2 + h * oy, bb.max.z + d * oz); noRay(q); parent.add(q); return q; };
    const obstaclesOf = () => (playerRef && playerRef.current && playerRef.current.obstacles) || [];
    function soldier(o) {
      o = o || {};
      const name = ARCH[o.arch] ? o.arch : (o.arch && warn('soldier: unknown archetype "' + o.arch + '" — grunt used'), 'grunt'), A = ARCH[name];
      const rnd = mulberry32(seedNum(o.seed == null ? rand() * 1e9 : o.seed)), accent = o.accent || (name === 'boss' ? '#ff5ea8' : name === 'sniper' ? '#ffb347' : name === 'drone' ? '#ffd23f' : '#ff5a5a');
      let mesh = null;
      if (A.fly) mesh = droneBody(rnd, accent); else if (A.fixed) mesh = turretBody(rnd, accent);
      else {
        const co = Object.assign({ kind: 'human', role: 'guard', seed: o.seed == null ? rnd() * 1e9 : o.seed }, A.char || {}, o.character || {}); if (o.role) co.role = o.role; if (co.role === 'soldier') co.role = 'guard'; co.add = false;
        mesh = W.props.character(co);
        if (!mesh || !mesh.parts || !mesh.parts.body) { warn('soldier: props.character unavailable — a plain actor is used'); mesh = W.props.make('actor', { color: accent, add: false }); mesh.parts = { body: mesh }; }
        else { const P = mesh.parts; if (P.torso && P.torso.geometry) { gearBox(P.body, P.torso, 1.06, .55, .3, 0, .08, .05, mat('#3a3f48', false, 'metalDark')); gearBox(P.body, P.torso, .5, .06, .3, 0, .22, .3, mat(accent, true)); }
          if (P.head && P.head.geometry) gearBox(P.head, P.head, .9, .14, .12, 0, .05, -.02, mat(accent, true)); }
      }
      const P = mesh.parts || {}, ud = mesh.userData;
      const s = { kind: 'soldier', arch: name, mesh: mesh, pos: mesh.position, state: 'patrol', alive: true, hp: (+o.hp || A.hp), maxHp: (+o.hp || A.hp), awareness: 0, sees: false, last: new THREE.Vector3(), timer: 0, wait: 0, wp: 0, accent: accent, fly: !!A.fly, fixed: !!A.fixed,
        hover: +o.hover || A.hover || 0, burst: 0, shots: 0, shotT: 0, pauseT: .6, hurtT: 9, cover: null, peek: 0, cycles: 0, phase: 1, orbit: rnd() * 6.28, percT: rnd() * .1, sinceEngage: 0, moved: false, strafeT: rnd() * 4, engaged: false, scale: mesh.scale.x || 1,
        speed: o.speed != null ? +o.speed : A.speed, sight: +o.sight || A.sight, fov: (+o.fov || A.fov) * D2R, reaction: o.reaction != null ? +o.reaction : .5, hunt: o.hunt === false ? 0 : (o.hunt != null ? +o.hunt : 6), huntT: 0, accuracy: +o.accuracy || 1, dmg: o.damage != null ? +o.damage : A.dmg, range: o.range || A.range, onSee: o.onSee, onShoot: o.onShoot, onDown: o.onDown, onHurt: o.onHurt, id: fps.soldiers.length };
      mesh.userData.fpsSoldier = s; if (!mesh.parent) scene.add(mesh);
      if (o.pos) { toV3(o.pos, mesh.position); mesh.position.y = groundY(mesh.position.x, mesh.position.z) + (s.fly ? s.hover : 0); }
      const wps = (o.waypoints || []).map(w => toV3(w)); if (wps.length && !o.pos) { mesh.position.copy(wps[0]); mesh.position.y = groundY(wps[0].x, wps[0].z) + (s.fly ? s.hover : 0); }
      // gun in the hand: char.sockets.handR (core sockets point +z along the fingers, so the -z weapon turns 180°); older cores: the armR pivot's palm,
      // where the weapon points along the limb (-y), rolled so its top faces up once the arm aims forward
      const wm = buildWeapon(o.weapon || A.weapon, { lod: 'low', accent: accent, seed: rnd() * 1e9, skin: o.skin || 'matte' }); s.weapon = wm; s.gun = wm.group;
      const handG = new THREE.Group(); handG.add(wm.group);
      if (ud.gun) ud.gun.add(wm.group);
      else if (mesh.sockets && mesh.sockets.handR) { handG.rotation.y = Math.PI; wm.group.position.set(0, -.02, -.06); mesh.sockets.handR.add(handG); }
      else { let armLen = .55; if (P.armR && P.armR.children[0] && P.armR.children[0].geometry) { const bb = P.armR.children[0].geometry.boundingBox || (P.armR.children[0].geometry.computeBoundingBox(), P.armR.children[0].geometry.boundingBox); armLen = -bb.min.y; }
        handG.quaternion.setFromUnitVectors(FWD, V.set(0, -1, 0)); handG.rotateZ(Math.PI); wm.group.position.set(0, .01, .04);
        if (P.armR) { handG.position.set(0, -armLen + .02, 0); P.armR.add(handG); } else mesh.add(handG); }
      s.flash = makeFlash(wm.sockets.muzzle, .32, false);
      const eyeY = ud.eyeY != null ? ud.eyeY : (ud.height || 1.7) * .9, halfFov = Math.cos(s.fov / 2), rangeMin = s.range[0], rangeMax = s.range[1];
      const tgt = () => (playerRef && playerRef.current) ? playerRef.current : null;
      const cb = (fn, a) => { if (typeof fn === 'function') { try { fn(s, a); } catch (e) { console.error(e); } } };
      const set = st => { if (s.state !== st) { s.state = st; s.timer = 0; s.wait = 0; if (st === 'engage') { s.sinceEngage = 0; s.pauseT = Math.max(s.pauseT, s.reaction); } } };
      const faceTo = (x, z, dt, rate) => { mesh.rotation.y = lerpAngle(mesh.rotation.y, Math.atan2(x - s.pos.x, z - s.pos.z), Math.min(1, dt * (rate || (s.fly ? 8 : 5)))); };
      const moveTo = (x, z, dt, sp, face) => {
        let dx = x - s.pos.x, dz = z - s.pos.z; const d = Math.hypot(dx, dz); if (d < .35) return true;
        for (let i = 0; i < fps.soldiers.length; i++) { const q = fps.soldiers[i]; if (q === s || !q.alive || q.fly !== s.fly) continue; const ox = s.pos.x - q.pos.x, oz = s.pos.z - q.pos.z, od = Math.hypot(ox, oz); if (od < 1.3 && od > 1e-3) { dx += ox / od * (1.3 - od) * 2; dz += oz / od * (1.3 - od) * 2; } }
        const l = Math.hypot(dx, dz) || 1, st = Math.min(d, sp * dt); s.pos.x += dx / l * st; s.pos.z += dz / l * st; if (!s.fly) collide(s.pos, .45, obstaclesOf()); s.moved = true;
        if (face !== false) mesh.rotation.y = lerpAngle(mesh.rotation.y, Math.atan2(dx, dz), Math.min(1, dt * 8)); return d - st < .4;
      };
      const seesPoint = (from, to, maxD) => { V.copy(to).sub(from); const d = V.length(); if (d < .01) return true; V.divideScalar(d); V2.copy(from).addScaledVector(V, .7); const h = W.raycast(V2, V, Math.min(d - .9, maxD || 200)); return !h || h.distance > d - 1.2; };
      function perceive(dt, T) {
        s.percT += dt; if (s.percT < .1) return; const tick = s.percT; s.percT = 0;
        if (!T || (fps.hero && fps.hero.dead)) { s.sees = false; s.awareness = Math.max(0, s.awareness - tick * .5); return; }
        V3.set(T.pos.x, T.pos.y + 1.5, T.pos.z); V4.set(s.pos.x, s.pos.y + eyeY, s.pos.z); const dx = V3.x - V4.x, dz = V3.z - V4.z, d = Math.hypot(dx, dz);
        const inCone = s.fov >= 6.28 || d < 2.5 || (dx * Math.sin(mesh.rotation.y) + dz * Math.cos(mesh.rotation.y)) / (d || 1) >= halfFov;
        let vis = false; if (d < s.sight && inCone) vis = seesPoint(V4, V3, s.sight);
        s.sees = vis;
        if (vis) { s.last.copy(T.pos); s.awareness = Math.min(1, s.awareness + tick * (d < 8 ? 4 : 1.2) / Math.max(.2, s.reaction * 2)); } else s.awareness = Math.max(0, s.awareness - tick * .4);
      }
      function fireBolt(T, first) {
        s.gun.updateMatrixWorld(true); wm.sockets.muzzle.getWorldPosition(V); V3.set(T.pos.x, T.pos.y + 1.25, T.pos.z);
        const d = Math.hypot(V3.x - V.x, V3.z - V.z), moving = Math.hypot(T.vel.x, T.vel.z) > 1;
        const err = lerp(A.err[1], A.err[0], clamp(d / rangeMax, 0, 1)) * (moving ? 1.4 : 1) * (first ? 1.6 : 1) * fps.difficulty / s.accuracy;
        V2.copy(V3).sub(V).normalize(); V4.set(rand() - .5, rand() - .5, rand() - .5).cross(V2); if (V4.lengthSq() < 1e-6) V4.set(1, 0, 0); V2.applyAxisAngle(V4.normalize(), err * D2R * rand());
        const m = enemySys().fire(V, V2, { speed: A.bolt, color: accent, data: { dmg: s.dmg * (name === 'boss' && s.phase > 1 ? 1.3 : 1), from: s } }); if (m && m.scale) { m.scale.set(1, 1, 2.6); m.quaternion.setFromUnitVectors(FWD, V2); }
        flashOn(s.flash, accent); lightAt(V, accent, 4); play('pew'); s.shots++; cb(s.onShoot);
      }
      const attack = (dt, T, canFire) => {
        // burst model: pause → n shots at `gap` → pause; never in the first `reaction` seconds after engaging; only with line of sight
        if (s.pauseT > 0) { s.pauseT -= dt; return; }
        if (s.burst <= 0) { if (!canFire || !s.sees) { s.pauseT = .25; return; } s.burst = A.burst[0] + Math.floor(rand() * (A.burst[1] - A.burst[0] + 1)); s.shotT = A.windup || 0; s.firstShot = true; if (A.warn) { V.set(s.pos.x, s.pos.y + eyeY, s.pos.z); V2.set(T.pos.x, T.pos.y + 1.2, T.pos.z).sub(V).multiplyScalar(.8).add(V); tracer(V, V2, accent, A.warn, .012); } }   // sniper telegraph: a thin beam that stops short of the player
        s.shotT -= dt; if (s.shotT > 0) return;
        fireBolt(T, s.firstShot); s.firstShot = false; s.burst--; s.shotT = A.gap;
        if (s.burst <= 0) s.pauseT = (A.pause[0] + rand() * (A.pause[1] - A.pause[0])) * fps.difficultyPause;
      };
      function findCover(T) {
        const obs = obstaclesOf(), sets = ctx.propSets || (W.props && W.props.sets) || []; let best = null, bs = -1e9;
        const consider = (x, z, r) => { const dx = x - T.pos.x, dz = z - T.pos.z, d = Math.hypot(dx, dz) || 1, cx = x + dx / d * (r + .7), cz = z + dz / d * (r + .7);
          const dSelf = Math.hypot(cx - s.pos.x, cz - s.pos.z), dTgt = Math.hypot(cx - T.pos.x, cz - T.pos.z); if (dSelf > 16 || dTgt < 4 || dTgt > s.sight) return;
          for (let i = 0; i < fps.soldiers.length; i++) { const q = fps.soldiers[i]; if (q !== s && q.cover && Math.hypot(q.cover.x - cx, q.cover.z - cz) < 1.5) return; }
          const sc = -dSelf / 16 - 2 * Math.abs((dTgt - (rangeMin + rangeMax) / 2) / rangeMax) + (r > .9 ? 1.5 : 0); if (sc > bs) { bs = sc; best = { x: cx, z: cz, ox: x, oz: z }; } };
        for (let i = 0; i < obs.length && i < 400; i++) { const ob = obs[i]; if (!ob) continue; consider(ob.x, ob.z, ob.hw != null ? Math.max(ob.hw, ob.hd || ob.hw) : (+ob.r || .5)); }
        if (!best) for (let k = 0; k < sets.length; k++) { const h = sets[k]; if (h.soft) continue; for (let i = 0; i < h.positions.length && i < 200; i++) { const q = h.positions[i]; consider(q.x, q.z, q.r || .6); } }
        return best;
      }
      s.update = dt => {
        if (!s.alive) return;
        s.timer += dt; s.hurtT += dt; s.moved = false; const T = tgt(); perceive(dt, T);
        const d = T ? Math.hypot(T.pos.x - s.pos.x, T.pos.z - s.pos.z) : 1e9, hpF = s.hp / s.maxHp;
        if (T && s.sees) s.last.copy(T.pos);
        if (name === 'boss') { const ph = hpF < .3 ? 3 : hpF < .6 ? 2 : 1; if (ph !== s.phase) { s.phase = ph; s.speed = A.speed * (1 + (ph - 1) * .35); if (W.fx && W.fx.flashLight) W.fx.flashLight(200, 2.5); play('powerup'); cb(o.onPhase, ph); } }
        switch (s.state) {
          case 'patrol':
            if (s.awareness >= 1) { set('engage'); s.engaged = true; cb(s.onSee); break; } if (s.awareness >= .4) { set('alert'); break; }
            if (s.fixed) { mesh.parts.head.rotation.y += dt * .5; break; }
            // hunt: a patrol that has not seen the player for `hunt` seconds walks toward where the player is (never shoots until it sees) — enemies come to the kid even when spawned far away
            if (s.hunt && T && !(fps.hero && fps.hero.dead) && (s.huntT += dt) > s.hunt && d < s.sight * 3.5) { s.huntT = 0; s.last.copy(T.pos); s.hunting = true; set('alert'); break; }
            if (wps.length) { if (moveTo(wps[s.wp].x, wps[s.wp].z, dt, s.speed * .55)) { s.wait += dt; if (s.wait > 1) { s.wp = (s.wp + 1) % wps.length; s.wait = 0; } } } else mesh.rotation.y += dt * .4;
            break;
          case 'alert':
            if (s.awareness >= 1) { s.hunting = false; set('engage'); cb(s.onSee); break; } if (s.awareness <= 0 && s.timer > (s.hunting ? 16 : 2.5)) { s.hunting = false; set('patrol'); break; }
            if (s.fixed) faceTo(s.last.x, s.last.z, dt, 3); else if (!s.fly) { faceTo(s.last.x, s.last.z, dt); if (s.timer > .6 && moveTo(s.last.x, s.last.z, dt, s.speed * (s.hunting ? .8 : .5)) && s.hunting) { s.hunting = false; set('patrol'); } }
            else if (s.hunting) moveTo(s.last.x, s.last.z, dt, s.speed * .8, false);
            break;
          case 'engage': {
            if (!T) { set('patrol'); break; } s.sinceEngage += dt;
            if (!s.sees && s.awareness <= 0) { set('search'); break; }
            if (s.fixed) { faceTo(T.pos.x, T.pos.z, dt, 4); mesh.parts.head.rotation.y = 0; attack(dt, T, d < rangeMax); break; }
            if (s.fly) { s.orbit += dt * .45; const ox = T.pos.x + Math.cos(s.orbit) * 8, oz = T.pos.z + Math.sin(s.orbit) * 8; moveTo(ox, oz, dt, s.speed, false); faceTo(T.pos.x, T.pos.z, dt, 8); attack(dt, T, d < rangeMax); break; }
            if (!A.boss && o.cover !== false && hpF < .5 && s.hurtT < 1.2 && s.timer > 1 && !s.cover) { const c = findCover(T); if (c) { s.cover = c; s.cycles = 0; set('cover'); break; } }
            if (!A.boss && o.retreat !== false && name !== 'heavy' && hpF < .22 && s.timer > 1) { set('retreat'); break; }
            faceTo(T.pos.x, T.pos.z, dt, 6);
            if (d > rangeMax * .95) moveTo(T.pos.x, T.pos.z, dt, s.speed, false);
            else if (d < rangeMin) { V.set(s.pos.x - T.pos.x, 0, s.pos.z - T.pos.z).normalize(); moveTo(s.pos.x + V.x * 3, s.pos.z + V.z * 3, dt, s.speed * .7, false); }
            else if (!s.sees) moveTo(s.last.x, s.last.z, dt, s.speed * .8, false);
            else { s.strafeT += dt; const sd = Math.sin(s.strafeT * .8); if (Math.abs(sd) > .5) { V.set(T.pos.z - s.pos.z, 0, -(T.pos.x - s.pos.x)).normalize(); moveTo(s.pos.x + V.x * Math.sign(sd) * 2, s.pos.z + V.z * Math.sign(sd) * 2, dt, s.speed * .5, false); } }
            attack(dt, T, d < rangeMax * 1.1 && s.sinceEngage > s.reaction);
            break; }
          case 'cover': {
            if (!T || !s.cover) { set('engage'); break; }
            if (d < 4 || s.cycles >= 3) { s.cover = null; set('engage'); break; }
            const there = moveTo(s.cover.x, s.cover.z, dt, s.speed * 1.1);
            if (!there) break;
            // hide 1–2.5 s, then peek (lean toward the target) and fire a burst, then duck; a hit while peeking ducks at once
            if (s.peek <= 0) { faceTo(T.pos.x, T.pos.z, dt, 4); s.wait += dt; if (s.wait > 1 + rand() * 1.5) { s.peek = 1.4; s.wait = 0; s.cycles++; s.pauseT = 0; } }
            else { s.peek -= dt; V.set(T.pos.z - s.pos.z, 0, -(T.pos.x - s.pos.x)).normalize(); moveTo(s.cover.x + V.x * .7, s.cover.z + V.z * .7, dt, s.speed, false); faceTo(T.pos.x, T.pos.z, dt, 8); attack(dt, T, true); }
            break; }
          case 'search':
            if (s.awareness >= 1 || s.sees) { set('engage'); cb(s.onSee); break; }
            if (s.fixed) { mesh.parts.head.rotation.y += dt * .8; if (s.timer > 3) set('patrol'); break; }
            if (s.fly || moveTo(s.last.x, s.last.z, dt, s.speed * .8)) { mesh.rotation.y += dt * 1.5; s.wait += dt; if (s.wait > 2.5) set('patrol'); }
            break;
          case 'retreat': {
            if (!T) { set('patrol'); break; }
            if (s.timer < 3.2 && d < 14) { V.set(s.pos.x - T.pos.x, 0, s.pos.z - T.pos.z).normalize(); moveTo(s.pos.x + V.x * 4, s.pos.z + V.z * 4, dt, s.speed * 1.2); }
            else if (s.timer > 4 || d < 6) { const c = findCover(T); if (c) { s.cover = c; s.cycles = 0; set('cover'); } else set('engage'); }
            break; }
        }
        // ground / hover, gaze and pose: the core's walk/idle animation, then the aim pose on top (char.anim.aim / lookAt / crouch when the core has them)
        if (s.fly) { const gy = groundY(s.pos.x, s.pos.z) + s.hover + Math.sin(s.timer * 2 + s.orbit) * .2; s.pos.y = damp(s.pos.y, gy, 3, dt); mesh.rotation.z = damp(mesh.rotation.z, s.moved ? -.18 : 0, 6, dt); if (ud.rotors) for (let i = 0; i < ud.rotors.length; i++) ud.rotors[i].rotation.y += dt * 40; }
        else if (!s.fixed) s.pos.y = groundY(s.pos.x, s.pos.z);
        const aiming = s.state === 'engage' || s.state === 'cover' || s.state === 'alert', anim = mesh.anim;
        if (anim) { if (s.moved) anim.walk(dt, s.state === 'engage' || s.state === 'retreat' ? 1.5 : .9, s.state === 'retreat'); else anim.idle(dt);
          if (anim.aim) anim.aim(aiming); else if (aiming) { if (P.armR) { P.armR.rotation.x = -R90 + .05; P.armR.rotation.z = 0; } if (P.armL) { P.armL.rotation.x = -R90 + .25; P.armL.rotation.z = .35; } }
          if (T && aiming) { if (anim.lookAt) anim.lookAt(V.set(T.pos.x, T.pos.y + 1.5, T.pos.z)); else if (P.neck) P.neck.rotation.y = clamp(lerpAngle(mesh.rotation.y, Math.atan2(T.pos.x - s.pos.x, T.pos.z - s.pos.z), 1) - mesh.rotation.y, -.9, .9); }
          else if (P.neck && !anim.lookAt) P.neck.rotation.y = damp(P.neck.rotation.y, 0, 6, dt);
          const duck = s.state === 'cover' && s.peek <= 0; if (anim.crouch) anim.crouch(duck); else mesh.scale.y = damp(mesh.scale.y, s.scale * (duck ? .78 : 1), 8, dt); }
      };
      s.takeDamage = (n, point, from) => {
        if (!s.alive) return false; s.hp -= n; s.hurtT = 0; if (from === 'player' && playerRef.current) { s.last.copy(playerRef.current.pos); s.awareness = 1; if (s.state === 'patrol' || s.state === 'search') { set('engage'); cb(s.onSee); } }
        if (point) sparks(point, accent, 8); if (mesh.anim && mesh.anim.hit) mesh.anim.hit(); if (s.state === 'cover' && s.peek > 0) s.peek = 0; cb(s.onHurt, n);
        if (s.hp <= 0) s.powerDown(); return true;
      };
      s.powerDown = () => {
        if (!s.alive) return; s.alive = false; s.state = 'down'; s.downT = 0; s.sees = false; s.flash.s.visible = false;
        const i = fps.soldiers.indexOf(s); if (i >= 0) fps.soldiers.splice(i, 1); if (enemyList) { const j = enemyList.indexOf(s); if (j >= 0) enemyList.splice(j, 1); }
        if (mesh.anim && mesh.anim.die) mesh.anim.die(); wm.parts.glow.forEach(g => { g.visible = false; }); if (P.glow) P.glow.visible = false;
        V.set(s.pos.x, s.pos.y + (ud.height || 1.6) * .6, s.pos.z); sparks(V, accent, 16); sparks(V, '#7cf0ff', 10); play('down'); if (fps.hero) fps.hero.kills++;
        downed.push(s); cb(s.onDown);
        if (o.drop !== false && fps.pickups && rand() < (o.drop === true ? 1 : .35)) fps.pickups.spawn(rand() < .6 ? 'ammo' : 'health', [s.pos.x + (rand() - .5), 0, s.pos.z + (rand() - .5)]);
      };
      s.kill = s.powerDown; s.setState = set;
      s.dissolve = dt => {   // after power-down: the fall animation, then the body shrinks into the ground and goes away
        s.downT += dt; if (mesh.anim && mesh.anim.update && s.downT < .9) mesh.anim.update(dt);
        if (s.fly) { s.pos.y = Math.max(groundY(s.pos.x, s.pos.z) + .2, s.pos.y - dt * 4); mesh.rotation.y += dt * 6; mesh.rotation.z += dt * 2; }
        if (s.downT > .9) { const k = clamp((s.downT - .9) / .6, 0, 1); mesh.scale.set(s.scale * (1 - k * .9), s.scale * (1 - k), s.scale * (1 - k * .9)); }
        if (s.downT > 1.55) { scene.remove(mesh); const i = downed.indexOf(s); if (i >= 0) downed.splice(i, 1); }
      };
      fps.soldiers.push(s); if (enemyList) enemyList.push(s);
      return s;
    }
    function squad(n, o) {
      o = o || {}; n = clamp(n | 0 || 4, 1, 24); const rnd = mulberry32(seedNum(o.seed == null ? rand() * 1e9 : o.seed)), out = [];
      const a = o.area, cx = Array.isArray(a) ? +a[0] || 0 : (a && a.x) || 0, cz = Array.isArray(a) ? +a[1] || 0 : (a && a.z) || 0, r = Array.isArray(a) ? +a[2] || 12 : (typeof a === 'number' ? a : (a && a.r) || 12);
      const archs = Array.isArray(o.arch) ? o.arch : [o.arch || 'grunt'], wps = o.waypoints ? o.waypoints.map(w => toV3(w)) : [];
      if (!wps.length) { const m = 3 + Math.floor(rnd() * 2); for (let i = 0; i < m; i++) { const t = i / m * 6.2832 + rnd() * .5, rr = r * (.5 + rnd() * .5); wps.push(new THREE.Vector3(cx + Math.cos(t) * rr, 0, cz + Math.sin(t) * rr)); } }
      for (let i = 0; i < n; i++) {
        const t = i / n * 6.2832 + rnd(), rr = r * (.3 + rnd() * .7), start = (i * 2) % wps.length, route = wps.slice(start).concat(wps.slice(0, start));
        out.push(soldier(Object.assign({}, o, { arch: archs[i % archs.length], seed: (o.seed == null ? rnd() * 1e9 : seedNum(o.seed) + i * 101), pos: [cx + Math.cos(t) * rr, 0, cz + Math.sin(t) * rr], waypoints: route.map(w => [w.x + (rnd() - .5) * 2, 0, w.z + (rnd() - .5) * 2]) })));
      }
      return out;
    }
    fps.noise = (pos, r) => { const p = toV3(pos, V3); for (let i = 0; i < fps.soldiers.length; i++) { const s = fps.soldiers[i]; if (!s.alive) continue; if (Math.hypot(s.pos.x - p.x, s.pos.z - p.z) < (r || 20)) { s.awareness = Math.max(s.awareness, .7); s.last.copy(p); } } };

    // ── pickups: spinning glowing items with magnet pull; objectives: a small list rendered through W.objective ──
    const pickups = { list: [],
      spawn(kind, pos, po) {
        po = po || {}; kind = ['ammo', 'health', 'armor', 'weapon'].indexOf(kind) >= 0 ? kind : 'ammo';
        const g = new THREE.Group(), col = kind === 'health' ? '#7cf0a0' : kind === 'armor' ? '#7cb8ff' : kind === 'weapon' ? '#ffb347' : '#7cf0ff', glow = mat(col, true);
        if (kind === 'ammo') { g.add(new THREE.Mesh(new THREE.BoxGeometry(.34, .22, .22), mat('#3a3f48', false, 'metalDark'))); const st = new THREE.Mesh(new THREE.BoxGeometry(.36, .05, .06), glow); st.position.y = .08; g.add(st); }
        else if (kind === 'health') { const a = new THREE.Mesh(new THREE.BoxGeometry(.3, .1, .1), glow), b = new THREE.Mesh(new THREE.BoxGeometry(.1, .3, .1), glow); g.add(a, b); const bs = new THREE.Mesh(new THREE.BoxGeometry(.34, .34, .06), mat('#ffffff')); bs.position.z = -.06; g.add(bs); }
        else if (kind === 'armor') { const sh = new THREE.Mesh(new THREE.OctahedronGeometry(.22, 0), glow); sh.scale.set(1, 1.3, .5); g.add(sh); const rim = new THREE.Mesh(new THREE.OctahedronGeometry(.26, 0), mat('#dfe6ff')); rim.scale.set(1, 1.3, .3); rim.position.z = -.06; g.add(rim); }
        else { const wm = buildWeapon(po.weapon || 'pulseRifle', { lod: 'low', accent: col }); wm.group.scale.setScalar(1.25); wm.group.position.z = .3; g.add(wm.group); }
        const ring = new THREE.Mesh(new THREE.TorusGeometry(.42, .03, 4, 14), glow); ring.rotation.x = R90; ring.position.y = -.35; g.add(ring);
        noRay(g); toV3(pos, g.position); g.position.y = groundY(g.position.x, g.position.z) + .6; scene.add(g);
        const it = { kind: kind, mesh: g, t: rand() * 6, amount: po.amount, weapon: po.weapon, on: true, remove() { it.on = false; scene.remove(g); const i = pickups.list.indexOf(it); if (i >= 0) pickups.list.splice(i, 1); } };
        pickups.list.push(it); return it;
      },
      update(dt) {
        const pc = playerRef && playerRef.current, hero = fps.hero;
        for (let i = pickups.list.length - 1; i >= 0; i--) { const it = pickups.list[i], g = it.mesh; it.t += dt; g.rotation.y += dt * 2; const gy = groundY(g.position.x, g.position.z) + .6 + Math.sin(it.t * 2) * .08;
          if (pc && !(hero && hero.dead)) { const dx = pc.pos.x - g.position.x, dz = pc.pos.z - g.position.z, d = Math.hypot(dx, dz);
            if (d < 1) { if (!hero || hero.pickup(it.kind, it.amount, it.weapon) !== false) { sparks(g.position, '#ffffff', 10); it.remove(); continue; } }
            else if (d < 2.8) { g.position.x += dx / d * dt * 6; g.position.z += dz / d * dt * 6; } }
          g.position.y = damp(g.position.y, gy, 6, dt); }
      },
      clear() { pickups.list.slice().forEach(it => it.remove()); } };
    const objectives = { list: [], onAll: null,
      add(text, oo) { oo = oo || {}; const ob = { id: oo.id || 'obj' + objectives.list.length, text: String(text || ''), count: +oo.count || 0, n: 0, done: false, onDone: oo.onDone }; objectives.list.push(ob); objectives.render(); return ob; },
      progress(id, n) { const ob = objectives.find(id); if (!ob || ob.done) return ob; ob.n += n == null ? 1 : +n; if (ob.count && ob.n >= ob.count) return objectives.complete(id); objectives.render(); return ob; },
      complete(id) { const ob = objectives.find(id); if (!ob || ob.done) return ob; ob.done = true; ob.n = ob.count || ob.n; play('coin'); const k = kitOf(); if (k) k.screens.message('✓ ' + ob.text, 1400); if (typeof ob.onDone === 'function') { try { ob.onDone(ob); } catch (e) { console.error(e); } }
        objectives.render(); if (objectives.list.every(x => x.done) && typeof objectives.onAll === 'function') { try { objectives.onAll(); } catch (e) { console.error(e); } } return ob; },
      find(id) { return typeof id === 'object' ? id : objectives.list.find(x => x.id === id) || null; },
      get current() { return objectives.list.find(x => !x.done) || null; },
      text() { const ob = objectives.current; return ob ? ob.text + (ob.count ? ' ' + ob.n + '/' + ob.count : '') : ''; },
      render() { if (W.objective) W.objective(objectives.text()); },
      clear() { objectives.list.length = 0; objectives.render(); } };

    // ── update: registered into the world's animated list (W.update runs it); soldiers step through W.enemies like core enemies ──
    fps.update = dt => {
      dt = clamp(+dt || 0, 0, .1);
      if (!enemyList) for (let i = fps.soldiers.length - 1; i >= 0; i--) fps.soldiers[i].update(dt);
      for (let i = downed.length - 1; i >= 0; i--) downed[i].dissolve(dt);
      if (fps.rig) fps.rig.update(dt); else if (overlay) overlay.update(dt);
      if (fps.hero) fps.hero.update(dt);
      pickups.update(dt); fxUpdate(dt);
    };
    if (ctx.animated) ctx.animated.push({ update: fps.update, name: 'fps' });
    else { const u = W.update; W.update = dt => { u(dt); fps.update(dt); }; }
    fps.difficultyPlayer = 1; fps.difficultyPause = 1;
    fps.setDifficulty = level => { const e = level === 'easy', h = level === 'hard'; fps.difficulty = e ? .5 : h ? 1.4 : 1; fps.difficultyPause = e ? 1.5 : h ? .8 : 1; fps.difficultyPlayer = e ? 1.4 : h ? .85 : 1; return fps; };
    Object.assign(fps, { weapon: weapon, arms: arms, player: player, soldier: soldier, squad: squad, pickups: pickups, objectives: objectives, fx: { flash: flashOn, tracer: tracer, splat: splat, sparks: sparks, splash: splash, shell: ejectShell }, overlay: domOverlay,
      kinds: Object.keys(WEAPONS), archetypes: Object.keys(ARCH), skins: Object.keys(SKINS), model: buildWeapon, downed: downed });
    W.fps = fps; window.YuviFPS.last = fps; return fps;
  }

  window.YuviFPS = { attach: attach, weapons: Object.keys(WEAPONS), archetypes: Object.keys(ARCH), skins: Object.keys(SKINS), WEAPONS: WEAPONS, ARCH: ARCH, version: 1 };
  if (window.YuviWorld3D && typeof window.YuviWorld3D.use === 'function') window.YuviWorld3D.use(function fps(W, THREE, ctx) { attach(W, THREE, ctx); });
})();
