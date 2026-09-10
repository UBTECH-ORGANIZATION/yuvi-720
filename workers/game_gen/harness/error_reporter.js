/*
 * error_reporter.js — in-frame error capture + liveness heartbeat.
 *
 * Ported from the errorReporter script in injectFitToFrame(),
 * vibe-coding-kids src/frontend/src/views/EditorView.vue.  Extended with
 * the window.__yuvi state object the validator reads (learn contract,
 * heartbeat, errors) and console.error capture.
 *
 * Runs first (inject into <head>), so it cannot be shadowed by game code and
 * catches errors that fire before the parent's iframe.onload.
 *
 * Messages to the parent:
 *   {source:'yuvi-game', type:'error', nonce, message, stack, filename, line}
 */
(function () {
  if (window.__yuviErrorReporter) return;
  window.__yuviErrorReporter = true;

  var state = window.__yuvi = window.__yuvi || {
    learn: { asked: 0, answered: 0, correct: 0, done: false },
    heartbeat: 0,
    errors: []
  };
  if (!state.learn) state.learn = { asked: 0, answered: 0, correct: 0, done: false };
  if (typeof state.heartbeat !== 'number') state.heartbeat = 0;
  if (!Array.isArray(state.errors)) state.errors = [];

  var reported = {};
  var MAX_ERRORS = 50;

  function report(kind, message, stack, filename, line) {
    var msg = String(message == null ? 'Unknown error' : message).substring(0, 500);
    var key = kind + '|' + msg + '|' + (filename || '') + ':' + (line || '');
    if (reported[key]) return;
    reported[key] = true;
    var entry = {
      kind: kind,
      message: msg,
      stack: stack ? String(stack).substring(0, 2000) : null,
      filename: filename || null,
      line: line || null,
      at: state.heartbeat
    };
    if (state.errors.length < MAX_ERRORS) state.errors.push(entry);
    try {
      window.parent.postMessage({
        source: 'yuvi-game',
        type: 'error',
        nonce: window.__YUVI_NONCE,
        message: msg,
        stack: entry.stack,
        filename: entry.filename,
        line: entry.line
      }, '*');
    } catch (e) {}
  }

  window.addEventListener('error', function (e) {
    var err = e && e.error;
    report('error',
      (e && e.message) || (err && err.message) || String(err),
      err && err.stack,
      e && e.filename,
      e && e.lineno);
  });

  window.addEventListener('unhandledrejection', function (e) {
    var r = e && e.reason;
    report('unhandledrejection',
      r && r.message ? r.message : String(r),
      r && r.stack,
      null,
      null);
  });

  // console.error capture (keeps the original so DevTools still sees it)
  try {
    var origError = console.error;
    console.error = function () {
      var parts = [];
      for (var i = 0; i < arguments.length; i++) {
        var a = arguments[i];
        if (a && a.stack && a.message) { parts.push(a.message); continue; }
        try { parts.push(typeof a === 'string' ? a : JSON.stringify(a)); }
        catch (e) { parts.push(String(a)); }
      }
      report('console.error', parts.join(' '), null, null, null);
      try { return origError.apply(console, arguments); } catch (e) {}
    };
  } catch (e) {}

  // Heartbeat: one tick per animation frame; a frozen main thread stops it.
  function beat() {
    state.heartbeat += 1;
    requestAnimationFrame(beat);
  }
  requestAnimationFrame(beat);

  // Keep hash/anchor clicks from navigating the parent frame.
  document.addEventListener('click', function (e) {
    var a = e.target;
    while (a && a.tagName !== 'A') a = a.parentElement;
    if (!a) return;
    var href = a.getAttribute('href');
    if (href && href.charAt(0) === '#' && href.length > 1) {
      e.preventDefault();
      var id = href.slice(1);
      var target = document.getElementById(id) || document.getElementById('page-' + id);
      if (target) target.scrollIntoView({ behavior: 'smooth' });
    }
  }, true);
})();
