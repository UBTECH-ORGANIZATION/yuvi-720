/*
 * yuvi_kit.js — YuviKit, the runtime every generated game CONFIGURES instead
 * of re-implementing: start screen, HUD, pause, game-over / win, a WebAudio
 * synth + music loop with a mute button, particles / shake / floating text /
 * flash, keyboard + touch input, tweens, the best score (via YuviStorage).
 *
 *   YuviKit.init({title, subtitle, controls, palette, hud, sounds, music, touch,
 *                 storage, onStart, onPause, onRetry})        — one JSON spec
 *   YuviKit.hud.set({score: 10}) / .add('score', 1) / .get('score')
 *   YuviKit.audio.play('hit') / .mute(bool) / .toggle()
 *   YuviKit.fx.particles({x, y, color, count, el}) / .shake() / .float(text, {x, y}) / .flash()
 *   YuviKit.input.keys / .axis() / .pressed('Space') / .on('fire', fn) / .pointerLock(el) / .look
 *   YuviKit.screens.gameOver({score, reason}) / .win({score}) / .message(text, ms) / .hide()
 *   YuviKit.tween(obj, {x: 100}, 300, 'easeOut') → Promise;  YuviKit.best.get() / .set(n)
 *   YuviKit.loop(dt => …)  /  YuviKit.tick()  /  YuviKit.time.dt  /  YuviKit.paused
 *
 * Runs after yuvi_learn.js (language = YuviLearn.language). Everything is a
 * safe no-op before init. Kit DOM lives OUTSIDE <body> (appended to <html>):
 * fit_to_frame's body transform, measurement and MutationObserver never see
 * it, and screen coordinates map 1:1 onto the fx canvas. Shake uses body's
 * `translate` property, which composes with fit_to_frame's `transform`.
 * The WebAudio context is created on the Start click, never before.
 */
(function () {
  if (window.YuviKit) return;
  const STR = {
    he: { start: 'התחל', again: 'שוב', resume: 'המשך', paused: 'הפסקה', score: 'ניקוד', best: 'שיא', over: 'המשחק נגמר', win: 'ניצחת!', esc: 'Escape = הפסקה', aim: 'לחצו כדי לכוון' },
    en: { start: 'Start', again: 'Again', resume: 'Resume', paused: 'Paused', score: 'Score', best: 'Best', over: 'Game over', win: 'You win!', esc: 'Escape = pause', aim: 'Click to aim' },
    ar: { start: 'ابدأ', again: 'مرة أخرى', resume: 'متابعة', paused: 'توقف مؤقت', score: 'النقاط', best: 'الأفضل', over: 'انتهت اللعبة', win: 'فزت!', esc: 'Escape = إيقاف مؤقت', aim: 'انقر للتصويب' }
  };
  const rawLang = (window.YuviLearn && window.YuviLearn.language) || (window.__YUVI_LEARN_DATA || {}).language || 'he';
  const LANG = STR[rawLang] ? rawLang : 'en';
  const T = STR[LANG], RTL = LANG !== 'en', DIR = RTL ? 'rtl' : 'ltr';
  const Z = 2147480000;
  const CSS = `
#yk-root{position:fixed;inset:0;pointer-events:none;z-index:${Z};font-family:system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:#fff;--yk-bg:#1e1e2e;--yk-accent:#cba6f7}
#yk-root *{box-sizing:border-box;margin:0}
#yk-root .yk-screen{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1.2vh;padding:4vh 4vw;background:rgba(0,0,0,.72);pointer-events:auto;text-align:center;z-index:9}
#yk-root .yk-title{font-size:clamp(1.8rem,6vw,3.6rem);font-weight:900;color:var(--yk-accent);text-shadow:0 .4vh 1.2vh rgba(0,0,0,.6);line-height:1.15}
#yk-root .yk-sub{font-size:clamp(1rem,2.6vw,1.4rem);opacity:.9;max-width:60ch}
#yk-root .yk-ctls{display:flex;flex-direction:column;gap:.8vh;margin:1.5vh 0;font-size:clamp(.9rem,2.2vw,1.2rem)}
#yk-root .yk-ctl{display:flex;gap:1.2vw;align-items:center;justify-content:center}
#yk-root kbd{font:inherit;font-weight:700;background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.35);border-radius:.5rem;padding:.2rem .7rem;direction:ltr}
#yk-root .yk-btn{pointer-events:auto;font:inherit;font-size:clamp(1.1rem,3vw,1.6rem);font-weight:800;padding:1.4vh 6vw;border-radius:999px;border:0;background:var(--yk-accent);color:#111;cursor:pointer;box-shadow:0 .5vh 0 rgba(0,0,0,.4);margin-top:2vh}
#yk-root .yk-btn:active{transform:translateY(.3vh);box-shadow:0 .2vh 0 rgba(0,0,0,.4)}
#yk-root .yk-big{font-size:clamp(1.4rem,4vw,2.4rem);font-weight:800}
#yk-hud{position:absolute;top:0;left:0;right:0;display:flex;flex-wrap:wrap;align-items:center;gap:1vw;padding:1vh 1.2vw;font-size:clamp(.85rem,2.2vw,1.25rem);font-weight:700;text-shadow:0 1px 3px #000;z-index:2}
#yk-hud .yk-hi{background:rgba(0,0,0,.45);border-radius:.6rem;padding:.3rem .7rem;white-space:nowrap}
#yk-hud .yk-hi b{color:var(--yk-accent);margin-inline-start:.3rem}
#yk-hud .yk-ib{pointer-events:auto;font:inherit;font-size:1.2em;background:rgba(0,0,0,.45);border:0;border-radius:.6rem;color:#fff;padding:.2rem .5rem;cursor:pointer}
#yk-hud .yk-ib:first-of-type{margin-inline-start:auto}
#yk-fx{position:absolute;inset:0;width:100%;height:100%;display:none;z-index:1}
#yk-root .yk-float{position:absolute;font-weight:900;font-size:clamp(1rem,3vw,1.6rem);text-shadow:0 2px 4px #000;white-space:nowrap;animation:yk-float .9s ease-out forwards;z-index:3}
@keyframes yk-float{from{transform:translate(-50%,0);opacity:1}to{transform:translate(-50%,-10vh);opacity:0}}
#yk-root .yk-flash{position:absolute;inset:0;opacity:.7;transition:opacity .15s;z-index:3}
#yk-root .yk-toast{position:absolute;left:50%;top:22%;transform:translateX(-50%);background:rgba(0,0,0,.7);border:2px solid var(--yk-accent);border-radius:1rem;padding:1.2vh 3vw;font-size:clamp(1rem,3vw,1.6rem);font-weight:800;z-index:4;white-space:nowrap}
#yk-joy{position:absolute;left:4vw;bottom:4vh;width:24vmin;height:24vmin;border-radius:50%;background:rgba(255,255,255,.12);border:2px solid rgba(255,255,255,.35);pointer-events:auto;touch-action:none;z-index:5}
#yk-knob{position:absolute;left:50%;top:50%;width:42%;height:42%;border-radius:50%;background:var(--yk-accent);transform:translate(-50%,-50%);opacity:.9}
#yk-tbs{position:absolute;right:4vw;bottom:4vh;display:flex;gap:3vmin;pointer-events:auto;z-index:5}
#yk-tbs .yk-tb{width:16vmin;height:16vmin;border-radius:50%;border:2px solid rgba(255,255,255,.35);background:rgba(255,255,255,.14);font-size:6vmin;display:flex;align-items:center;justify-content:center;touch-action:none;user-select:none;-webkit-user-select:none}
#yk-tbs .yk-tb:active{background:var(--yk-accent)}`;

  // ── state ────────────────────────────────────────────────────────────────
  const S = { inited: false, started: false, paused: false, over: false, cfg: {}, palette: [], screen: null };
  const H = { bar: null, items: {} };
  const A = { ctx: null, gain: null, muted: false, music: null, next: 0, timer: 0, noise: null };
  const I = { keys: new Set(), joy: { x: 0, y: 0 }, handlers: {}, keymap: {} };   // keymap: key code → touch-button id
  const F = { c: null, ctx: null, p: [], shake: 0, shakeEnd: 0, raf: 0, last: 0 };
  const B = { v: 0, key: 'best-score' };
  const TM = { dt: 0, now: 0, elapsed: 0, last: 0 };
  let root = null;

  function el(tag, cls, text, parent) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) { n.textContent = text; n.setAttribute('dir', DIR); }
    if (parent) parent.appendChild(n);
    return n;
  }
  function mount() {
    if (!root) {
      root = document.createElement('div'); root.id = 'yk-root';
      const st = document.createElement('style'); st.textContent = CSS; root.appendChild(st);
    }
    try { document.documentElement.appendChild(root); } catch (e) {}   // (re)append: always after <body>
    return root;
  }
  const playing = () => S.started && !S.paused && !S.over;

  // ── HUD ──────────────────────────────────────────────────────────────────
  function fmt(v) { return typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(1)) : String(v == null ? '' : v); }
  function hudItem(spec) {
    const it = el('div', 'yk-hi', null, null); it.setAttribute('dir', DIR);
    el('span', null, (spec.icon ? spec.icon + ' ' : '') + (spec.label || spec.id) + ':', it).removeAttribute('dir');
    const b = el('b', null, null, it); b.setAttribute('dir', 'auto');
    const txt = document.createTextNode(''); b.appendChild(txt);
    H.bar.insertBefore(it, H.bar.querySelector('.yk-ib'));
    H.items[spec.id] = { v: spec.value, txt: txt };
    txt.data = fmt(spec.value);
    return H.items[spec.id];
  }
  function hudSet(a, b) {
    const patch = typeof a === 'string' ? { [a]: b } : (a || {});
    for (const id in patch) {
      const it = H.items[id] || (H.bar ? hudItem({ id: id, value: patch[id] }) : null);
      if (!it) continue;
      it.v = patch[id];
      const s = fmt(it.v);
      if (it.txt.data !== s) it.txt.data = s;        // Text.data: no childList mutation, no fit re-measure
    }
  }
  const hudGet = id => (H.items[id] ? H.items[id].v : undefined);
  function buildHud(items) {
    H.bar = el('div', null, null, root); H.bar.id = 'yk-hud'; H.bar.setAttribute('dir', DIR);
    const pause = el('button', 'yk-ib', '⏸', H.bar); pause.type = 'button'; pause.removeAttribute('dir');
    pause.addEventListener('click', () => { if (S.started && !S.over) setPause(!S.paused); });
    A.btn = el('button', 'yk-ib', '🔊', H.bar); A.btn.type = 'button'; A.btn.removeAttribute('dir');
    A.btn.addEventListener('click', () => setMute(!A.muted));
    (items || []).forEach(hudItem);
  }

  // ── audio: presets, one-shot synth, music loop ───────────────────────────
  const PRESETS = {
    blip: { type: 'square', freq: 880, ms: 60 }, click: { type: 'sine', freq: 1200, ms: 30 },
    coin: { type: 'square', notes: [988, 1319], ms: 70 }, powerup: { type: 'triangle', notes: [440, 554, 659, 880], ms: 70 },
    buzz: { type: 'sawtooth', freq: 160, to: 70, ms: 220 }, pew: { type: 'sawtooth', freq: 900, to: 200, ms: 120 },
    jump: { type: 'square', freq: 300, to: 700, ms: 120 }, explode: { type: 'noise', ms: 350, vol: .35 },
    fanfare: { type: 'triangle', notes: [523, 659, 784, 1047], ms: 130 }, down: { type: 'sawtooth', notes: [392, 330, 262, 196], ms: 160 }
  };
  const DEFAULT_SOUNDS = { hit: 'blip', pickup: 'coin', hurt: 'buzz', win: 'fanfare', lose: 'down', shoot: 'pew', jump: 'jump', explode: 'explode' };
  const DEFAULT_MUSIC = { bpm: 112, type: 'triangle', vol: .06, notes: ['C4', 'E4', 'G4', 'E4', 'A3', 'C4', 'E4', 'C4', 'F3', 'A3', 'C4', 'A3', 'G3', 'B3', 'D4', 'B3'] };
  const NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  function freqOf(n) {
    if (typeof n === 'number') return n > 0 ? n : 0;
    const m = /^([A-Ga-g])(#|b)?(\d)$/.exec(String(n || ''));
    if (!m) return 0;
    const semi = NOTE[m[1].toUpperCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12 * (+m[3] + 1);
    return 440 * Math.pow(2, (semi - 69) / 12);
  }
  function noiseBuf() {
    if (A.noise) return A.noise;
    const buf = A.ctx.createBuffer(1, A.ctx.sampleRate, A.ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return (A.noise = buf);
  }
  function synth(r) {
    if (!A.ctx || A.muted || !r) return;
    const ms = r.ms || 100, vol = r.vol == null ? .22 : r.vol, notes = r.notes || [r.freq || 440];
    notes.forEach((f, i) => {
      const t = A.ctx.currentTime + i * ms / 1000, end = t + ms / 1000;
      const g = A.ctx.createGain(); g.connect(A.gain);
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.001, end);
      let src;
      if (r.type === 'noise') { src = A.ctx.createBufferSource(); src.buffer = noiseBuf(); }
      else {
        src = A.ctx.createOscillator(); src.type = r.type || 'square'; src.frequency.setValueAtTime(f, t);
        if (r.to) src.frequency.exponentialRampToValueAtTime(r.to, end);
      }
      src.connect(g); src.start(t); src.stop(end + .02);
    });
  }
  function play(name) {
    try {
      const map = S.cfg.sounds || DEFAULT_SOUNDS, s = map[name] != null ? map[name] : (DEFAULT_SOUNDS[name] || name);
      synth(typeof s === 'string' ? PRESETS[s] : s);
    } catch (e) {}
  }
  function scheduleBar() {
    const m = A.music, ctx = A.ctx; if (!m || !ctx || !m.notes || !m.notes.length) return;
    const step = 60 / (m.bpm || 120) / 2;                 // one entry = an eighth note
    if (A.next < ctx.currentTime) A.next = ctx.currentTime + .05;
    m.notes.forEach((n, i) => {
      const f = freqOf(n); if (!f) return;
      const t = A.next + i * step, g = ctx.createGain(), o = ctx.createOscillator();
      g.connect(A.gain); g.gain.setValueAtTime(m.vol || .06, t); g.gain.exponentialRampToValueAtTime(.001, t + step * .9);
      o.type = m.type || 'triangle'; o.frequency.value = f; o.connect(g); o.start(t); o.stop(t + step);
    });
    A.next += m.notes.length * step;
    A.timer = setTimeout(scheduleBar, Math.max(50, (A.next - ctx.currentTime) * 1000 - 150));
  }
  function bootAudio() {                                  // first user gesture = the Start click
    if (A.ctx) { try { A.ctx.resume(); } catch (e) {} return; }
    try {
      const C = window.AudioContext || window.webkitAudioContext; if (!C) return;
      A.ctx = new C(); A.gain = A.ctx.createGain(); A.gain.connect(A.ctx.destination);
      A.gain.gain.value = A.muted ? 0 : 1;
      const mu = S.cfg.music;
      A.music = mu === 'none' || mu === false ? null : (mu && typeof mu === 'object' ? mu : DEFAULT_MUSIC);
      scheduleBar();
    } catch (e) { A.ctx = null; }
  }
  function setMute(m) {
    A.muted = !!m;
    if (A.gain) A.gain.gain.value = A.muted ? 0 : 1;
    if (A.btn) A.btn.textContent = A.muted ? '🔇' : '🔊';
    try { window.YuviStorage.set('yk-muted', A.muted); } catch (e) {}
  }

  // ── input: keyboard state, named actions, touch ──────────────────────────
  const AX = { KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0], KeyW: [0, -1], ArrowUp: [0, -1], KeyS: [0, 1], ArrowDown: [0, 1] };
  const typing = e => /^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || '');
  function fire(name) { if (playing()) (I.handlers[name] || []).forEach(fn => { try { fn(); } catch (e) { console.error(e); } }); }
  window.addEventListener('keydown', e => {
    if (typing(e)) return;
    if (e.code === 'Escape') { if (S.started && !S.over) setPause(!S.paused); return; }
    if (AX[e.code] || e.code === 'Space') e.preventDefault();
    I.keys.add(e.code);
    if (!e.repeat) { fire(e.code); if (I.keymap[e.code]) fire(I.keymap[e.code]); }
  });
  window.addEventListener('keyup', e => I.keys.delete(e.code));
  window.addEventListener('blur', () => I.keys.clear());
  window.addEventListener('pointerdown', () => { if (A.ctx && A.ctx.state === 'suspended' && !S.paused) A.ctx.resume().catch(() => {}); }, true);
  function axis() {
    let x = I.joy.x, y = I.joy.y;
    for (const k in AX) if (I.keys.has(k)) { x += AX[k][0]; y += AX[k][1]; }
    return { x: Math.max(-1, Math.min(1, x)), y: Math.max(-1, Math.min(1, y)) };
  }
  const coarse = () => { try { return window.matchMedia('(pointer: coarse)').matches; } catch (e) { return false; } };
  function buildTouch(t) {
    if (t === false) return;
    ((t && t.buttons) || []).forEach(b => { if (b.key && b.id) I.keymap[b.key] = b.id; });   // on('fire') also fires from its key
    if (!coarse() && !(t && t.always)) return;
    t = t && typeof t === 'object' ? t : {};
    if (t.joystick !== false) {
      const j = el('div', null, null, root), k = el('div', null, null, j); j.id = 'yk-joy'; k.id = 'yk-knob';
      let pid = null;
      const move = e => {
        const r = j.getBoundingClientRect(), R = r.width / 2;
        let dx = (e.clientX - r.left - R) / R, dy = (e.clientY - r.top - R) / R, m = Math.hypot(dx, dy);
        if (m > 1) { dx /= m; dy /= m; }
        I.joy.x = Math.abs(dx) < .15 ? 0 : dx; I.joy.y = Math.abs(dy) < .15 ? 0 : dy;
        k.style.transform = `translate(calc(-50% + ${dx * R * .55}px), calc(-50% + ${dy * R * .55}px))`;
      };
      const end = () => { pid = null; I.joy.x = I.joy.y = 0; k.style.transform = ''; };
      j.addEventListener('pointerdown', e => { pid = e.pointerId; try { j.setPointerCapture(pid); } catch (x) {} move(e); });
      j.addEventListener('pointermove', e => { if (e.pointerId === pid) move(e); });
      j.addEventListener('pointerup', end); j.addEventListener('pointercancel', end);
    }
    if (t.buttons && t.buttons.length) {
      const box = el('div', null, null, root); box.id = 'yk-tbs';
      t.buttons.forEach(b => {
        const n = el('div', 'yk-tb', b.label || b.id, box); n.removeAttribute('dir');
        const down = e => { e.preventDefault(); if (b.key) I.keys.add(b.key); fire(b.id); if (b.key && b.key !== b.id) fire(b.key); };
        const up = () => { if (b.key) I.keys.delete(b.key); };
        n.addEventListener('pointerdown', down);
        ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => n.addEventListener(ev, up));
      });
    }
  }

  // ── pointer lock (mouse-look): request only from a click; a lost lock pauses behind "click to aim" ──
  const L = { el: null, want: false, dx: 0, dy: 0, fails: 0 };
  const wantLock = () => L.want && !document.pointerLockElement;
  function requestLock() { try { const r = L.el.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (e) {} }
  function pointerLock(target) {
    if (!target || !target.requestPointerLock || coarse()) return;   // no-op on touch
    L.el = target; L.want = true; L.fails = 0; requestLock();
  }
  function aimOverlay() {
    const sc = screen('aim'); sc.style.cursor = 'pointer'; el('div', 'yk-big', T.aim, sc);
    sc.addEventListener('click', () => { hideScreen(); requestLock(); setPause(false); });
  }
  document.addEventListener('mousemove', e => { if (L.el && document.pointerLockElement === L.el) { L.dx += e.movementX || 0; L.dy += e.movementY || 0; } });
  document.addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement) { if (S.paused && S.screen && S.screen.id === 'yk-aim') setPause(false); }
    else if (L.want && playing()) setPause(true);      // Escape / tab switch dropped the lock: pause, overlay says "click to aim"
  });
  document.addEventListener('pointerlockerror', () => { if (++L.fails >= 2) L.want = false; });   // no permission (sandbox): give up quietly
  document.addEventListener('click', () => { if (wantLock() && playing()) requestLock(); }, true);

  // ── fx: overlay canvas (only alive while something moves), shake, float, flash ──
  function fxCanvas() {
    if (!F.c) { F.c = el('canvas', null, null, root); F.c.id = 'yk-fx'; F.ctx = F.c.getContext('2d'); }
    return F.c;
  }
  function toScreen(o) {
    if (!o || !o.el || !o.el.getBoundingClientRect) return { x: +(o && o.x) || 0, y: +(o && o.y) || 0 };
    const r = o.el.getBoundingClientRect();
    return { x: r.left + (+o.x || 0) * r.width / (o.el.width || r.width || 1), y: r.top + (+o.y || 0) * r.height / (o.el.height || r.height || 1) };
  }
  function fxLoop(now) {
    F.raf = 0;
    const c = fxCanvas(), ctx = F.ctx, W = window.innerWidth, H2 = window.innerHeight;
    const dt = Math.min(.05, (now - F.last) / 1000 || .016); F.last = now;
    if (c.width !== W || c.height !== H2) { c.width = W; c.height = H2; }
    c.style.display = 'block';
    ctx.clearRect(0, 0, W, H2);
    F.p = F.p.filter(p => (p.t += dt) < p.life);
    for (const p of F.p) {
      p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt;
      const k = 1 - p.t / p.life;
      ctx.globalAlpha = k; ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(0.1, p.r * (.4 + .6 * k)), 0, 6.2832); ctx.fill();
    }
    ctx.globalAlpha = 1;
    const shaking = now < F.shakeEnd, body = document.body;
    if (body) body.style.translate = shaking ? `${(Math.random() * 2 - 1) * F.shake}px ${(Math.random() * 2 - 1) * F.shake}px` : '';
    if (F.p.length || shaking) F.raf = requestAnimationFrame(fxLoop);
    else { c.width = c.height = 0; c.style.display = 'none'; }   // idle: invisible to the validator's canvas checks
  }
  function wake() { if (!root) mount(); if (!F.raf) { F.last = performance.now(); F.raf = requestAnimationFrame(fxLoop); } }
  function particles(o) {
    o = o || {};
    const at = toScreen(o), n = o.count == null ? 14 : o.count, spread = o.spread == null ? 220 : o.spread;
    const colors = [].concat(o.color || S.palette[1] || '#cba6f7');
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.2832, sp = spread * (.3 + Math.random() * .7);
      F.p.push({ x: at.x, y: at.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: o.gravity == null ? 320 : o.gravity,
        r: (o.size || 4) * (.6 + Math.random() * .8), life: (o.life || .6) * (.7 + Math.random() * .6), t: 0,
        color: colors[(Math.random() * colors.length) | 0] });
    }
    wake();
  }
  function shake(strength, ms) { F.shake = strength == null ? 8 : strength; F.shakeEnd = performance.now() + (ms == null ? 250 : ms); wake(); }
  function float(text, o) {
    if (!root) mount();
    const at = toScreen(o), n = el('div', 'yk-float', String(text), root);
    n.style.left = at.x + 'px'; n.style.top = at.y + 'px'; if (o && o.color) n.style.color = o.color;
    setTimeout(() => n.remove(), 950);
  }
  function flash(color, ms) {
    if (!root) mount();
    const n = el('div', 'yk-flash', null, root); n.style.background = color || '#fff';
    requestAnimationFrame(() => { n.style.opacity = '0'; });
    setTimeout(() => n.remove(), ms == null ? 160 : ms);
  }

  // ── screens: start, pause, game over, win, toast ─────────────────────────
  function hideScreen() { if (S.screen) { S.screen.remove(); S.screen = null; } }
  function screen(kind) { hideScreen(); S.screen = el('div', 'yk-screen', null, root); S.screen.id = 'yk-' + kind; S.screen.setAttribute('dir', DIR); return S.screen; }
  function button(parent, text, fn) { const b = el('button', 'yk-btn', text, parent); b.type = 'button'; b.addEventListener('click', fn); return b; }
  function buildStart(cfg) {
    const sc = screen('start');
    el('h1', 'yk-title', cfg.title || document.title || 'Yuvi', sc);
    if (cfg.subtitle) el('p', 'yk-sub', cfg.subtitle, sc);
    if (cfg.controls && cfg.controls.length) {
      const list = el('div', 'yk-ctls', null, sc);
      cfg.controls.forEach(c => { const row = el('div', 'yk-ctl', null, list); el('kbd', null, c.keys || '', row); el('span', null, c.does || '', row); });
    }
    button(sc, T.start, doStart);
  }
  function doStart() {
    if (S.started) return;
    S.started = true; S.over = false; S.paused = false;
    hideScreen(); bootAudio(); TM.last = 0;
    try { if (S.cfg.onStart) S.cfg.onStart(); } catch (e) { console.error(e); }
  }
  function setPause(p) {
    p = !!p;
    if (!S.started || S.over || p === S.paused) return;
    S.paused = p;
    if (!p) hideScreen();
    else if (wantLock()) aimOverlay();
    else { const sc = screen('pause'); el('div', 'yk-title', T.paused, sc); el('div', 'yk-sub', T.esc, sc); button(sc, T.resume, () => setPause(false)); }
    try { if (A.ctx) (p ? A.ctx.suspend() : A.ctx.resume()).catch(() => {}); } catch (e) {}
    try { if (S.cfg.onPause) S.cfg.onPause(p); } catch (e) { console.error(e); }
  }
  function doRetry() {
    S.over = false; S.paused = false; hideScreen(); bootAudio(); TM.last = 0;
    try { (S.cfg.onRetry || S.cfg.onStart || function () {})(); } catch (e) { console.error(e); }
  }
  function endScreen(kind, o) {
    o = o || {};
    S.over = true; S.paused = false;
    const score = o.score != null ? o.score : hudGet('score');
    const best = o.best != null ? o.best : (typeof score === 'number' ? bestSet(score) : B.v);
    const sc = screen(kind);
    el('div', 'yk-title', kind === 'win' ? T.win : T.over, sc);
    if (o.reason) el('p', 'yk-sub', o.reason, sc);
    if (score != null) el('div', 'yk-big', T.score + ': ' + fmt(score), sc);
    if (best) el('div', 'yk-sub', T.best + ': ' + fmt(best), sc);
    button(sc, T.again, doRetry);
    try { if (window.YuviLearn && YuviLearn.progress) YuviLearn.progress(Object.assign({ outcome: kind }, score != null ? { score: score } : {})); } catch (e) {}
  }
  let toast = null, toastTimer = 0;
  function message(text, ms) {
    if (!root) mount();
    if (!toast) toast = el('div', 'yk-toast', '', root);
    toast.textContent = String(text); toast.style.display = '';
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { toast.style.display = 'none'; }, ms == null ? 1500 : ms);
  }

  // ── tween, time, best ────────────────────────────────────────────────────
  const EASE = { linear: t => t, easeIn: t => t * t, easeOut: t => 1 - (1 - t) * (1 - t),
    easeInOut: t => (t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
    bounce: t => (t < .5 ? 8 * t * t : 1 - 8 * (1 - t) * (1 - t)) };
  function tween(obj, props, ms, easing) {
    return new Promise(res => {
      if (!obj || !props) return res(obj);
      const from = {}, dur = ms == null ? 300 : ms, ease = typeof easing === 'function' ? easing : (EASE[easing] || EASE.easeOut);
      for (const k in props) from[k] = +obj[k] || 0;
      const t0 = performance.now();
      (function step(now) {
        const t = dur > 0 ? Math.min(1, (now - t0) / dur) : 1, e = ease(t);
        for (const k in props) obj[k] = from[k] + (props[k] - from[k]) * e;
        if (t < 1) requestAnimationFrame(step); else res(obj);
      })(t0);
    });
  }
  function tick() {
    const n = performance.now();
    TM.dt = TM.last ? Math.min(.1, (n - TM.last) / 1000) : 0; TM.last = n; TM.now = n / 1000;
    if (playing()) TM.elapsed += TM.dt;
    return TM.dt;
  }
  function loop(fn) {
    (function frame() { requestAnimationFrame(frame); const dt = tick(); if (playing()) { try { fn(dt); } catch (e) { console.error(e); } } })();
  }
  function bestSet(n) {
    n = +n || 0;
    if (n > B.v) { B.v = n; try { window.YuviStorage.set(B.key, n); } catch (e) {} }
    return B.v;
  }

  // ── init ─────────────────────────────────────────────────────────────────
  function init(cfg) {
    if (S.inited) return YuviKit;
    S.inited = true; S.cfg = cfg = cfg || {};
    mount();
    S.palette = Array.isArray(cfg.palette) ? cfg.palette.slice() : [];
    S.palette.forEach((c, i) => { try { document.documentElement.style.setProperty('--yk-' + (i + 1), c); } catch (e) {} });
    if (S.palette[0]) root.style.setProperty('--yk-bg', S.palette[0]);
    if (S.palette[1]) root.style.setProperty('--yk-accent', S.palette[1]);
    B.key = (cfg.storage && cfg.storage.best) || 'best-score';
    try { window.YuviStorage.get(B.key).then(v => { if (+v > B.v) B.v = +v; }); } catch (e) {}
    try { window.YuviStorage.get('yk-muted').then(v => { if (v) setMute(true); }); } catch (e) {}
    buildHud(cfg.hud);
    buildTouch(cfg.touch);
    buildStart(cfg);
    return YuviKit;
  }
  document.addEventListener('DOMContentLoaded', () => { if (root) mount(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && playing()) setPause(true); });

  const YuviKit = window.YuviKit = {
    init: init, lang: LANG, dir: DIR, rtl: RTL, t: T,
    get paused() { return S.paused; }, get started() { return S.started; }, get over() { return S.over; },
    get palette() { return S.palette; },
    start: doStart, pause: setPause, retry: doRetry,
    hud: { set: hudSet, get: hudGet, add: (id, n) => hudSet(id, (+hudGet(id) || 0) + (+n || 0)) },
    audio: { play: play, mute: setMute, toggle: () => setMute(!A.muted), get muted() { return A.muted; } },
    fx: { particles: particles, shake: shake, float: float, flash: flash },
    input: { keys: I.keys, axis: axis, pressed: c => I.keys.has(c), on: (name, fn) => { (I.handlers[name] = I.handlers[name] || []).push(fn); },
      pointerLock: pointerLock, get look() { const r = { dx: L.dx, dy: L.dy }; L.dx = L.dy = 0; return r; } },
    screens: { gameOver: o => endScreen('over', o), win: o => endScreen('win', o), message: message, hide: hideScreen },
    tween: tween, time: TM, tick: tick, loop: loop,
    best: { get: () => B.v, set: bestSet }
  };
})();
