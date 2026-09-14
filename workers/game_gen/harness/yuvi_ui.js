/*
 * yuvi_ui.js — YuviUI, the OPT-IN text/question layer for generated games.
 *
 * Hebrew/Arabic games garble math ("2:4" shows as "4:2", "3 × 4 = 12" flips)
 * and hand-built prompts leak the answer. This module renders questions,
 * dialogue, timers, combos and banners RTL-correct, in the kid's language,
 * with bidi-safe math, so the model never builds these panels by hand.
 *
 *   YuviUI.math(parts) → DocumentFragment      parts: string | [string | {ltr:'2:4'} | {text:'…'} | Node]
 *   YuviUI.setText(el, parts)                   textContent replacement with bidi-safe runs
 *   YuviUI.ask({text|parts, kind:'number'|'text'|'choice'|'ratio'|'pair', answers?, correct, labels?,
 *               placeholder?, hint?, submitLabel?, el?, timeout?, explain?, reduce?, shuffle?})
 *            → Promise<{correct, answer, elapsed}>   (grading + counters via YuviLearn.mount)
 *   YuviUI.dialogue(lines, {speaker?, ms?, el?}) → Promise     lines: parts | {speaker?, text|parts}
 *   YuviUI.timer({seconds, onEnd?, onTick?, hudId?}) → {start(), stop(), left, add(s)}
 *   YuviUI.combo({step?, max?}) → {hit(at?) → mult, miss(), value, mult}
 *   YuviUI.banner(parts, ms?) → Promise;  YuviUI.hide();  YuviUI.panel (the open panel or null)
 *
 * Loads after yuvi_kit.js (direction = YuviKit.dir, palette = --yk-1/--yk-2).
 * Every call is a safe no-op without the kit. DOM lives outside <body> like the
 * kit's, so fit_to_frame never measures it. While a panel is open, keydown /
 * keyup are stopped at document capture: nothing reaches the game or the kit.
 */
(function () {
  if (window.YuviUI) return;
  const STR = {
    he: { submit: 'אישור', ok: 'נכון!', bad: 'לא בדיוק', cont: 'המשך', timeUp: 'נגמר הזמן' },
    ar: { submit: 'موافق', ok: 'صحيح!', bad: 'ليس تمامًا', cont: 'متابعة', timeUp: 'انتهى الوقت' },
    en: { submit: 'OK', ok: 'Correct!', bad: 'Not quite', cont: 'Continue', timeUp: "Time's up" }
  };
  const K = () => window.YuviKit || null;
  function lang() { const k = K(); const l = String((k && k.lang) || document.documentElement.lang || 'he').slice(0, 2).toLowerCase(); return STR[l] ? l : 'en'; }
  function dir() { const k = K(); return (k && k.dir) || (lang() === 'en' ? 'ltr' : 'rtl'); }
  const T = () => STR[lang()];
  const CSS = `
#yu-root{position:fixed;inset:0;pointer-events:none;z-index:2147479999;font-family:system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:#fff;--yu-bg:var(--yk-1,#1e1e2e);--yu-accent:var(--yk-2,#cba6f7);--yu-ok:#a6e3a1;--yu-bad:#f38ba8}
#yu-root *,.yu-panel *{box-sizing:border-box;margin:0}
.yu-panel{pointer-events:auto;position:absolute;left:50%;bottom:6vh;transform:translateX(-50%);width:min(92vw,560px);max-height:88vh;overflow:auto;display:flex;flex-direction:column;gap:1.2vh;padding:2vh 3vw;border-radius:1.2rem;border:2px solid var(--yu-accent);background:rgba(0,0,0,.8);box-shadow:0 1vh 3vh rgba(0,0,0,.5);text-align:start;font-size:clamp(1rem,2.6vw,1.3rem);line-height:1.4;outline:0;animation:yu-pop .25s ease-out;font-family:system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:#fff}
.yu-panel.yu-inline{position:static;transform:none;width:100%;max-width:640px;margin:0 auto}
.yu-panel bdi{unicode-bidi:isolate;font-variant-numeric:tabular-nums}
.yu-q{font-weight:800;font-size:1.15em}
.yu-hint,.yu-next{opacity:.8;font-size:.9em}
.yu-next{text-align:end}
.yu-spk{color:var(--yu-accent);font-weight:800}
.yu-row{display:flex;gap:1.5vw;align-items:center;justify-content:center;direction:ltr;flex-wrap:wrap}
.yu-row label{display:flex;flex-direction:column;align-items:center;gap:.3vh;font-size:.85em}
.yu-in{font:inherit;font-size:1.2em;font-weight:700;width:6ch;text-align:center;padding:.6vh .5em;border-radius:.7rem;border:2px solid rgba(255,255,255,.4);background:rgba(255,255,255,.1);color:#fff}
.yu-in.yu-wide{width:100%}
.yu-in:focus{border-color:var(--yu-accent);outline:0}
.yu-btn{font:inherit;font-weight:800;padding:1vh 2em;border-radius:999px;border:0;background:var(--yu-accent);color:#111;cursor:pointer;box-shadow:0 .4vh 0 rgba(0,0,0,.4);align-self:center}
.yu-btn:active{transform:translateY(.2vh);box-shadow:0 .1vh 0 rgba(0,0,0,.4)}
.yu-choices{display:grid;grid-template-columns:repeat(auto-fit,minmax(9em,1fr));gap:1vh 1vw}
.yu-ch{font:inherit;font-weight:700;padding:1.2vh .8em;border-radius:.8rem;border:2px solid rgba(255,255,255,.4);background:rgba(255,255,255,.1);color:#fff;cursor:pointer;min-height:2.6em}
.yu-ch:hover{border-color:var(--yu-accent)}
.yu-fb{font-weight:800;min-height:1.4em}
.yu-fb.ok{color:var(--yu-ok)}.yu-fb.bad{color:var(--yu-bad)}
.yu-shake{animation:yu-shake .4s}
.yu-banner{position:absolute;left:50%;top:36%;transform:translateX(-50%);padding:1.6vh 4vw;border-radius:1.2rem;border:2px solid var(--yu-accent);background:rgba(0,0,0,.75);font-size:clamp(1.3rem,4vw,2.2rem);font-weight:900;text-align:center;white-space:nowrap;animation:yu-pop .3s ease-out;text-shadow:0 .3vh 1vh rgba(0,0,0,.6)}
.yu-chip{position:absolute;left:50%;top:1vh;transform:translateX(-50%);padding:.4vh 1em;border-radius:.6rem;background:rgba(0,0,0,.5);font-weight:800;font-size:clamp(.9rem,2.4vw,1.3rem);font-variant-numeric:tabular-nums;direction:ltr;text-shadow:0 1px 3px #000}
.yu-chip.yu-low{color:var(--yu-bad)}
@keyframes yu-pop{from{opacity:0;scale:.9}to{opacity:1;scale:1}}
@keyframes yu-shake{0%,100%{translate:0}20%,60%{translate:-.6em 0}40%,80%{translate:.6em 0}}`;

  // ── root + helpers ────────────────────────────────────────────────────────
  let root = null, cur = null;   // cur: the modal panel (ask / dialogue bubble) currently open
  function mountRoot() {
    if (!root) { root = document.createElement('div'); root.id = 'yu-root'; const st = document.createElement('style'); st.textContent = CSS; root.appendChild(st); }
    if (!root.isConnected) { try { document.documentElement.appendChild(root); } catch (e) {} }
    return root;
  }
  function mk(tag, cls, parent) { const n = document.createElement(tag); if (cls) n.className = cls; if (parent) parent.appendChild(n); return n; }
  const txt = s => document.createTextNode(s);
  const norm = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().toLowerCase();
  const num = s => { const t = String(s == null ? '' : s).trim().replace(',', '.'); return /^[-+]?(\d+\.?\d*|\.\d+)$/.test(t) ? parseFloat(t) : NaN; };
  const ratioOf = s => { const m = /^\s*([-+]?[\d.,]+)\s*[:\/]\s*([-+]?[\d.,]+)\s*$/.exec(String(s == null ? '' : s)); return m ? [num(m[1]), num(m[2])] : null; };
  const pairOf = s => { const p = String(s == null ? '' : s).split(/[,;]/); return p.length === 2 ? [num(p[0]), num(p[1])] : null; };
  const LTRI = s => '\u2066' + s + '\u2069';   // explicit LTR isolate for strings handed to the kit (float, hud)

  // ── math: bidi-safe runs ──────────────────────────────────────────────────
  // a run starts on a digit/Latin letter (or "(" before one; a leading "-" only after space/start, so Hebrew "ל-5" keeps its prefix)
  const RUN = /(?:(?<![^\s(])-)?(?:[0-9A-Za-z]|\((?=[-0-9A-Za-z]))(?:[0-9A-Za-z:+\-×÷*\/=<>().,% ]*[0-9A-Za-z)%])?/g;
  function ltr(s) { const b = document.createElement('bdi'); b.setAttribute('dir', 'ltr'); b.textContent = s; return b; }
  function math(parts) {
    const f = document.createDocumentFragment();
    [].concat(parts == null ? [] : parts).forEach(p => {
      if (p == null) return;
      if (typeof p === 'object') {
        if (p.nodeType) f.appendChild(p);
        else if (p.ltr != null) f.appendChild(ltr(String(p.ltr)));
        else if (p.text != null) f.appendChild(txt(String(p.text)));
        return;
      }
      const s = String(p); let i = 0, m; RUN.lastIndex = 0;
      while ((m = RUN.exec(s))) { if (m.index > i) f.appendChild(txt(s.slice(i, m.index))); f.appendChild(ltr(m[0])); i = m.index + m[0].length; }
      if (i < s.length) f.appendChild(txt(s.slice(i)));
    });
    return f;
  }
  function partsText(parts) { return [].concat(parts == null ? [] : parts).map(p => p == null ? '' : typeof p === 'object' ? (p.nodeType ? p.textContent : (p.ltr != null ? p.ltr : p.text)) : p).join(''); }
  function setText(el, parts) {
    if (!el) return;
    el.textContent = ''; el.appendChild(math(parts));
    if (!el.getAttribute('dir')) el.setAttribute('dir', dir());
    return el;
  }

  // ── panels: one modal at a time; keys never leak to the game while open ───
  function openPanel(host, cls) {
    closeCur();
    const p = mk('div', 'yu-panel ' + cls, host || mountRoot());
    p.setAttribute('dir', dir()); p.tabIndex = -1;
    if (host) p.classList.add('yu-inline');
    return (cur = p);
  }
  function closePanel(p) {
    if (!p) return;
    p.remove(); if (cur === p) cur = null;
    try { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); } catch (e) {}
    try { const k = K(); if (k && k.input && k.input.keys) k.input.keys.clear(); } catch (e) {}   // a key held before open never got its keyup
  }
  function closeCur() { if (cur) { const c = cur; cur = null; if (c.__cancel) c.__cancel(); else closePanel(c); } }
  document.addEventListener('keydown', e => { if (!cur || !cur.isConnected) return; e.stopPropagation(); if (cur.__onKey) cur.__onKey(e); }, true);
  document.addEventListener('keyup', e => { if (cur && cur.isConnected) e.stopPropagation(); }, true);
  const focusIn = p => setTimeout(() => { try { (p.querySelector('input') || p).focus({ preventScroll: true }); } catch (e) {} }, 30);
  const sfx = name => { try { const k = K(); if (k && k.audio) k.audio.play(name); } catch (e) {} };

  // ── ask ───────────────────────────────────────────────────────────────────
  function accepted(o) {
    const c = o.correct;
    if (typeof c === 'number' && Array.isArray(o.answers)) return [String(o.answers[c])];
    if (Array.isArray(c)) return o.kind === 'pair' && c.length === 2 && !c.some(x => /[,;]/.test(String(x))) ? [c.join(',')] : c.map(String);
    return c == null ? [] : [String(c)];
  }
  function same(val, acc, o) {
    if (norm(val) === norm(acc)) return true;
    const rv = ratioOf(val), ra = ratioOf(acc);
    if (rv && ra) return o.reduce ? rv[0] * ra[1] === rv[1] * ra[0] && rv[1] !== 0 : rv[0] === ra[0] && rv[1] === ra[1];
    if (o.kind === 'pair') { const pv = pairOf(val), pa = pairOf(acc); return !!(pv && pa) && pv[0] === pa[0] && pv[1] === pa[1]; }
    const nv = num(val), na = num(acc);
    return !isNaN(nv) && !isNaN(na) && Math.abs(nv - na) < 1e-9;
  }
  function learnMount(q) {   // YuviLearn owns the counters + parent messages; we own the rendering (its DOM stays detached)
    const L = window.YuviLearn, box = document.createElement('div'); let input = null, btn = null;
    try { if (L && L.mount) { L.mount(q, box); input = box.querySelector('input'); btn = box.querySelector('button'); } } catch (e) {}
    return v => { if (input && btn) { input.value = v; btn.click(); } };
  }
  function shuffled(arr, seed) {
    const a = arr.slice(); let s = 0; for (const ch of String(seed)) s = (s * 31 + ch.charCodeAt(0)) >>> 0;
    for (let i = a.length - 1; i > 0; i--) { s = (s * 1103515245 + 12345) >>> 0; const j = (s >>> 8) % (i + 1); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  function ask(o) {
    o = o || {};
    const t0 = performance.now(), S = T(), kind = o.kind || (Array.isArray(o.answers) ? 'choice' : 'number');
    const parts = o.parts != null ? o.parts : (o.text || ''), acc = accepted(o);
    const submitLearn = learnMount({ text: partsText(parts), type: 'text', correct: acc.length ? acc : [' '] });
    return new Promise(res => {
      const p = openPanel(o.el, 'yu-ask'); p.id = 'yu-ask';
      mk('div', 'yu-q', p).appendChild(math(parts));
      if (o.hint) mk('div', 'yu-hint', p).appendChild(math(o.hint));
      let inputs = [], done = false, tm = 0;
      function finish(val, extra) {
        if (done) return; done = true; clearTimeout(tm);
        const answer = val == null ? '' : String(val), ok = acc.some(a => same(answer, a, Object.assign({ kind: kind }, o)));
        submitLearn(ok ? acc[0] : answer);
        const fb = mk('div', 'yu-fb ' + (ok ? 'ok' : 'bad'), p);
        fb.appendChild(math(extra && extra.timedOut ? S.timeUp : ok ? S.ok : S.bad));
        if (!ok && o.explain) { fb.appendChild(txt(' — ')); fb.appendChild(math(o.explain)); }
        p.querySelectorAll('input,button').forEach(n => { n.disabled = true; });
        sfx(ok ? 'pickup' : 'hurt');
        if (!ok) p.classList.add('yu-shake');
        const r = Object.assign({ correct: ok, answer: answer, elapsed: Math.round(performance.now() - t0) }, extra || {});
        setTimeout(() => { closePanel(p); res(r); }, ok ? 650 : (o.explain ? 2000 : 800));
      }
      p.__cancel = () => finish(null, { cancelled: true });
      if (kind === 'choice') {
        const box = mk('div', 'yu-choices', p), list = (o.answers || []).map(String);
        (o.shuffle ? shuffled(list, partsText(parts)) : list).forEach(a => {
          const b = mk('button', 'yu-ch', box); b.type = 'button'; b.setAttribute('dir', dir()); b.appendChild(math(a));
          b.addEventListener('click', () => finish(a));
        });
      } else {
        const row = mk('div', 'yu-row', p), n = kind === 'ratio' || kind === 'pair' ? 2 : 1, labels = o.labels || [];
        for (let i = 0; i < n; i++) {
          if (i) row.appendChild(txt(kind === 'ratio' ? ':' : ' '));
          const host = kind === 'pair' ? mk('label', null, row) : row;
          if (kind === 'pair') host.appendChild(txt(labels[i] || String.fromCharCode(97 + i)));
          const inp = mk('input', 'yu-in' + (n === 1 ? ' yu-wide' : ''), host);
          inp.type = 'text'; inp.autocomplete = 'off';
          inp.setAttribute('dir', kind === 'text' ? 'auto' : 'ltr');
          if (kind !== 'text') inp.setAttribute('inputmode', 'decimal');
          if (o.placeholder && n === 1) inp.placeholder = o.placeholder;
          inputs.push(inp);
        }
        const b = mk('button', 'yu-btn', p); b.type = 'button'; b.textContent = o.submitLabel || S.submit;
        const get = () => inputs.map(i => i.value.trim()).join(kind === 'ratio' ? ':' : ',');
        b.addEventListener('click', () => finish(get()));
        p.__onKey = e => { if (e.key === 'Enter') { e.preventDefault(); finish(get()); } };
      }
      if (o.timeout > 0) tm = setTimeout(() => finish(null, { timedOut: true }), o.timeout * 1000);
      focusIn(p);
    });
  }

  // ── dialogue ──────────────────────────────────────────────────────────────
  function bubble(ln, o) {
    return new Promise(res => {
      const isObj = ln && typeof ln === 'object' && !Array.isArray(ln) && !ln.nodeType && (ln.text != null || ln.parts != null || ln.speaker);
      const spk = (isObj && ln.speaker) || o.speaker, parts = isObj ? (ln.parts != null ? ln.parts : ln.text) : ln;
      const p = openPanel(o.el, 'yu-bubble');
      if (spk) mk('div', 'yu-spk', p).textContent = spk;
      mk('div', 'yu-q', p).appendChild(math(parts));
      mk('div', 'yu-next', p).textContent = T().cont + ' ▸';
      let done = false, tm = 0;
      const fin = () => { if (done) return; done = true; clearTimeout(tm); closePanel(p); res(); };
      p.__cancel = fin;
      p.__onKey = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fin(); } };
      p.addEventListener('click', fin);
      if (o.ms > 0) tm = setTimeout(fin, o.ms);
      focusIn(p);
    });
  }
  function dialogue(lines, o) { o = o || {}; return [].concat(lines == null ? [] : lines).reduce((pr, ln) => pr.then(() => bubble(ln, o)), Promise.resolve()); }

  // ── timer, combo, banner, hide ────────────────────────────────────────────
  const mmss = s => Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  function timer(o) {
    o = o || {};
    let leftMs = (+o.seconds || 30) * 1000, id = 0, last = 0, chip = null, shown = -1;
    function show() {
      const s = Math.max(0, Math.ceil(leftMs / 1000)); if (s === shown) return; shown = s;
      const k = K();
      if (o.hudId && k && k.hud) k.hud.set(o.hudId, LTRI(mmss(s)));
      else { if (!chip) chip = mk('div', 'yu-chip', mountRoot()); chip.textContent = mmss(s); chip.classList.toggle('yu-low', s <= 5); }
      try { if (o.onTick) o.onTick(s); } catch (e) { console.error(e); }
    }
    function step() {
      const now = performance.now(), k = K();
      if (!(k && k.paused)) leftMs -= now - last;
      last = now;
      if (leftMs > 0) return show();
      leftMs = 0; show(); api.stop();
      try { if (o.onEnd) o.onEnd(); } catch (e) { console.error(e); }
    }
    const api = {
      start() { if (!id) { last = performance.now(); id = setInterval(step, 200); show(); } return api; },
      stop() { clearInterval(id); id = 0; return api; },
      add(s) { leftMs = Math.max(0, leftMs + (+s || 0) * 1000); show(); return api; },
      remove() { api.stop(); if (chip) chip.remove(); chip = null; return api; },
      get left() { return Math.max(0, Math.ceil(leftMs / 1000)); },
      get running() { return !!id; }
    };
    return api;
  }
  function combo(o) {
    o = o || {};
    const step = o.step || 3, max = o.max || 5;
    const c = {
      value: 0,
      get mult() { return Math.min(max, 1 + Math.floor(c.value / step)); },
      hit(at) {
        c.value++;
        const m = c.mult;
        if (m > 1) { try { const k = K(); if (k && k.fx) k.fx.float(LTRI('×' + m), Object.assign({ x: innerWidth / 2, y: innerHeight * .3 }, at || {})); } catch (e) {} }
        return m;
      },
      miss() { c.value = 0; return 1; }
    };
    return c;
  }
  let bannerEl = null, bannerTm = 0;
  function banner(parts, ms) {
    return new Promise(res => {
      if (bannerEl) bannerEl.remove();
      bannerEl = mk('div', 'yu-banner', mountRoot()); bannerEl.setAttribute('dir', dir()); bannerEl.appendChild(math(parts));
      clearTimeout(bannerTm);
      bannerTm = setTimeout(() => { if (bannerEl) bannerEl.remove(); bannerEl = null; res(); }, ms == null ? 1800 : ms);
    });
  }
  function hide() {
    closeCur();
    if (bannerEl) { bannerEl.remove(); bannerEl = null; clearTimeout(bannerTm); }
    if (root) root.querySelectorAll('.yu-chip').forEach(n => n.remove());
  }
  document.addEventListener('DOMContentLoaded', () => { if (root) mountRoot(); });

  window.YuviUI = {
    math: math, setText: setText, ask: ask, dialogue: dialogue, timer: timer, combo: combo, banner: banner, hide: hide,
    get lang() { return lang(); }, get dir() { return dir(); }, get t() { return T(); }, get panel() { return cur; }
  };
})();
