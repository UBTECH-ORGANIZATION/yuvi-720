/*
 * storage_shim.js — sandbox-safe storage + dialog no-ops.
 *
 * Ported from SANDBOX_POLYFILL in vibe-coding-kids src/backend/main.py
 * (in-memory localStorage/sessionStorage fallback, alert/confirm/prompt
 * no-ops) and the YuviStorage bridge in injectFitToFrame(),
 * src/frontend/src/views/EditorView.vue — here backed by memory instead of a
 * parent postMessage round-trip, with the same promise API
 * (get/set/delete/getAll), so games that call YuviStorage run headlessly.
 */
(function () {
  if (window.__yuviStorageReady) return;
  window.__yuviStorageReady = true;

  function makeMemoryStorage() {
    var memStore = {};
    return {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(memStore, k) ? memStore[k] : null; },
      setItem: function (k, v) { memStore[k] = String(v); },
      removeItem: function (k) { delete memStore[k]; },
      clear: function () { memStore = {}; },
      get length() { return Object.keys(memStore).length; },
      key: function (i) { return Object.keys(memStore)[i] || null; }
    };
  }

  // Sandboxed iframes throw on storage access; swap in a memory store.
  try { window.localStorage.getItem('_'); } catch (e) {
    try { Object.defineProperty(window, 'localStorage', { value: makeMemoryStorage(), writable: false }); } catch (e2) {}
  }
  try { window.sessionStorage.getItem('_'); } catch (e) {
    try { Object.defineProperty(window, 'sessionStorage', { value: makeMemoryStorage(), writable: false }); } catch (e2) {}
  }

  // Dialogs block the page (and headless validation); make them inert.
  window.alert = function () {};
  window.confirm = function () { return true; };
  window.prompt = function () { return null; };

  // YuviStorage: promise API, non-overridable, in-memory.
  var store = {};
  function clone(v) {
    try { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); } catch (e) { return v; }
  }
  var api = {
    get: function (key) { return Promise.resolve(clone(store[key])); },
    set: function (key, value) { store[key] = clone(value); return Promise.resolve(true); },
    delete: function (key) { delete store[key]; return Promise.resolve(true); },
    getAll: function () { return Promise.resolve(clone(store)); }
  };
  try {
    Object.defineProperty(window, 'YuviStorage', { value: api, writable: false, configurable: false });
  } catch (e) {
    window.YuviStorage = api;
  }
})();
