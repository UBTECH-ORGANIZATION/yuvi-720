/*
 * YuviLearn — a thin, OPTIONAL helper injected into every generated game.
 *
 * The game owns its questions. This bridge only renders one (an overlay body
 * the game styles), grades it LOCALLY against `q.correct`, keeps counters the
 * validator reads at window.__yuvi.learn, and tells the parent page what
 * happened. No key, no server call, no message listener.
 *
 *   YuviLearn.language, YuviLearn.componentTitle   // from window.__YUVI_LEARN_DATA
 *   YuviLearn.mount(q, container) -> Promise<{correct:boolean, answer:string}>
 *       q = {text, answers?: string[], correct: number|string|string[], type?: 'choice'|'text', figure?: string(html)}
 *       `correct` is an index into `answers`, an answer text, or an array of accepted texts.
 *   YuviLearn.progress(patch?) -> Promise<state>   // with patch: merge absolute values and post learn.progress
 *   YuviLearn.done(summary?)   -> Promise<void>    // posts learn.done {summary, progress}
 *   legacy no-ops (old games never throw): next() -> null, answer() -> {correct:false, feedback:'legacy'}, reset(), total
 *
 * Posts to the parent: {source:'yuvi-game', nonce, type, ...} for
 * ready {mode:'free'}, learn.asked, learn.answered, learn.progress, learn.done.
 */
(function () {
  if (window.YuviLearn) return;
  var data = window.__YUVI_LEARN_DATA || { language: 'he', component: {}, objective: {} };
  var nonce = window.__YUVI_NONCE || '';
  var state = (window.__yuvi = window.__yuvi || {});
  state.learn = state.learn || { asked: 0, answered: 0, correct: 0, done: false };
  state.heartbeat = state.heartbeat || 0;
  state.errors = state.errors || [];
  var progress = {};   // free-form values the game reports (score, level, …)

  function norm(s) {
    return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().toLowerCase();
  }
  function post(type, payload) {
    try { window.parent.postMessage(Object.assign({ source: 'yuvi-game', type: type, nonce: nonce }, payload), '*'); } catch (e) {}
  }
  function snapshot() {
    return Object.assign({ asked: state.learn.asked, answered: state.learn.answered, correct: state.learn.correct, done: state.learn.done }, progress);
  }
  function grade(q, value) {
    var text = norm(value);
    var accepted = [];
    var c = q.correct;
    if (typeof c === 'number' && q.answers && q.answers[c] != null) accepted = [q.answers[c]];
    else if (Array.isArray(c)) accepted = c;
    else if (c != null) accepted = [c];
    for (var i = 0; i < accepted.length; i++) if (norm(accepted[i]) === text) return true;
    return false;
  }

  // ── the standard overlay body ──────────────────────────────────────────
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    for (var k in (attrs || {})) {
      if (k === 'style') node.style.cssText = attrs[k];
      else if (k === 'text') node.textContent = attrs[k];
      else node.setAttribute(k, attrs[k]);
    }
    (children || []).forEach(function (c) { if (c) node.appendChild(c); });
    return node;
  }
  var rtl = (data.language === 'he' || data.language === 'ar');
  var BTN = 'display:block;width:100%;min-height:48px;margin:8px 0;padding:10px 16px;font:inherit;font-size:1.1rem;font-weight:600;' +
            'border-radius:12px;border:2px solid currentColor;background:rgba(255,255,255,.08);color:inherit;cursor:pointer;';
  function mount(q, container) {
    if (!q || !container) return Promise.resolve({ correct: false, answer: '' });
    container.innerHTML = '';
    var box = el('div', { style: 'display:flex;flex-direction:column;gap:10px;max-width:640px;margin:0 auto;font-size:1.1rem;' + (rtl ? 'direction:rtl;text-align:right' : 'direction:ltr;text-align:left') });
    if (q.figure) {
      var fig = el('div', { 'data-yuvi-figure': '1', style: 'direction:ltr;min-height:120px;display:flex;align-items:center;justify-content:center' });
      fig.innerHTML = q.figure;
      box.appendChild(fig);
    }
    box.appendChild(el('div', { text: q.text || '', style: 'font-size:1.25rem;font-weight:700;line-height:1.4' }));
    container.appendChild(box);
    state.learn.asked += 1;
    post('learn.asked', { index: state.learn.asked });
    return new Promise(function (resolve) {
      var settled = false;
      function submit(value) {
        if (settled) return;
        settled = true;
        var ok = grade(q, value);
        state.learn.answered += 1;
        if (ok) state.learn.correct += 1;
        var note = el('div', { style: 'font-weight:700;margin-top:6px', text: ok ? '✓' : '✗' });
        box.appendChild(note);
        post('learn.answered', { correct: ok, index: state.learn.answered });
        resolve({ correct: ok, answer: String(value == null ? '' : value) });
      }
      if (q.type === 'text' || !(q.answers && q.answers.length)) {
        var input = el('input', { type: 'text', autocomplete: 'off', dir: 'ltr', style: 'font:inherit;font-size:1.2rem;padding:10px 14px;border-radius:12px;border:2px solid currentColor;background:rgba(255,255,255,.1);color:inherit;width:100%;box-sizing:border-box' });
        var send = el('button', { type: 'button', text: '➜', style: BTN });
        send.addEventListener('click', function () { submit(input.value); });
        input.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') submit(input.value); });
        box.appendChild(input); box.appendChild(send);
        setTimeout(function () { try { input.focus(); } catch (e) {} }, 50);
      } else {
        q.answers.forEach(function (a) {
          var b = el('button', { type: 'button', text: a, style: BTN + (/^[\d\s(),.\-+]+$/.test(a) ? 'direction:ltr' : '') });
          b.addEventListener('click', function () { submit(a); });
          box.appendChild(b);
        });
      }
    });
  }

  window.YuviLearn = {
    get language() { return data.language || 'he'; },
    get componentTitle() { return (data.component && data.component.title) || ''; },
    get total() { return undefined; },
    mount: mount,
    progress: function (patch) {
      if (patch && typeof patch === 'object') {
        for (var k in patch) if (Object.prototype.hasOwnProperty.call(patch, k)) progress[k] = patch[k];
        post('learn.progress', { progress: snapshot() });
      }
      return Promise.resolve(snapshot());
    },
    done: function (summary) {
      state.learn.done = true;
      post('learn.done', { summary: summary || null, progress: snapshot() });
      return Promise.resolve();
    },
    // Legacy names from the question-driven bridge: harmless for old games.
    next: function () { return Promise.resolve(null); },
    answer: function () { return Promise.resolve({ correct: false, feedback: 'legacy' }); },
    reset: function () { return Promise.resolve(undefined); }
  };
  post('ready', { mode: 'free' });
})();
