/*
 * fit_to_frame.js — iframe reset + fit-down/up scaler for generated games.
 *
 * Ported from vibe-coding-kids src/frontend/src/utils/gameFrame.ts
 * (GAME_FIT_SNIPPET) plus the CSS fit reset from injectFitToFrame() in
 * src/frontend/src/views/EditorView.vue (#game-container 100%).
 *
 * Generated games are not always responsive: fixed-size panels, absolutely
 * positioned overlays, canvases larger than the frame.  This script measures
 * the real rendered bounds and scales <body> so the whole game stays visible.
 * Plain JS IIFE: inject into <head> before the game code.
 */
(function () {
  if (window.__yuvilabGameFit) return;
  window.__yuvilabGameFit = true;

  // ── CSS reset (gameFrame.ts <style data-yuvilab-game-fit> + EditorView fit snippet) ──
  var css = [
    '*, *::before, *::after { box-sizing: border-box; }',
    'html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; }',
    'html { background: transparent; }',
    'body { min-width: 100%; min-height: 100%; transform-origin: top left; }',
    '#game-container { width: 100%; height: 100%; }',
    'html.yuvilab-game-measuring, html.yuvilab-game-measuring body,',
    'html.yuvilab-game-measuring body * { overflow: visible !important; }'
  ].join('\n');
  try {
    var styleEl = document.createElement('style');
    styleEl.setAttribute('data-yuvilab-game-fit', '');
    styleEl.appendChild(document.createTextNode(css));
    (document.head || document.documentElement).appendChild(styleEl);
  } catch (e) {}

  var raf = 0;
  var measuring = false;
  var originalBodyStyle = null;

  function viewport() {
    var de = document.documentElement;
    return {
      w: Math.max(1, window.innerWidth || de.clientWidth || 1),
      h: Math.max(1, window.innerHeight || de.clientHeight || 1)
    };
  }

  function captureOriginalBodyStyle() {
    var b = document.body;
    if (!b || originalBodyStyle) return;
    originalBodyStyle = {
      transform: b.style.transform,
      width: b.style.width,
      height: b.style.height,
      minWidth: b.style.minWidth,
      minHeight: b.style.minHeight
    };
  }

  function restoreOriginalBodyStyle() {
    var b = document.body;
    if (!b || !originalBodyStyle) return;
    b.style.transform = originalBodyStyle.transform;
    b.style.width = originalBodyStyle.width;
    b.style.height = originalBodyStyle.height;
    b.style.minWidth = originalBodyStyle.minWidth;
    b.style.minHeight = originalBodyStyle.minHeight;
  }

  function isMeasurableElement(el) {
    if (!(el instanceof HTMLElement)) return false;
    var tag = el.tagName;
    if (/^(SCRIPT|STYLE|META|LINK|TITLE|NOSCRIPT)$/i.test(tag)) return false;
    var style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    // Fixed elements report viewport coordinates, which would floor the
    // natural extent at the frame size and prevent scale-up.
    if (style.position === 'fixed') return false;
    return true;
  }

  function naturalBounds() {
    var b = document.body;
    var de = document.documentElement;
    if (!b || !de) return { x: 0, y: 0, w: 0, h: 0 };
    measuring = true;
    var prevBodyTransform = b.style.transform;
    var prevBodyWidth = b.style.width;
    var prevBodyHeight = b.style.height;
    var prevBodyMinWidth = b.style.minWidth;
    var prevBodyMinHeight = b.style.minHeight;
    var prevHtmlOverflow = de.style.overflow;
    var prevBodyOverflow = b.style.overflow;
    try {
      b.style.setProperty('transform', 'none', 'important');
      b.style.setProperty('width', 'auto', 'important');
      b.style.setProperty('height', 'auto', 'important');
      b.style.setProperty('min-width', '0', 'important');
      b.style.setProperty('min-height', '0', 'important');
      de.style.overflow = 'visible';
      b.style.overflow = 'visible';
      de.classList.add('yuvilab-game-measuring');
      void b.offsetWidth; // reflow after removing the previous scale

      // Seed from infinity so children determine the actual extent (body's own
      // scrollWidth/Height is ignored: many games set min-height:100vh which
      // would floor the bounds at the viewport and block scale-up).
      var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      var elements = Array.prototype.slice.call(b.querySelectorAll('*'));
      for (var i = 0; i < elements.length; i++) {
        var el = elements[i];
        if (!isMeasurableElement(el)) continue;
        var rect = el.getBoundingClientRect();
        if (!isFinite(rect.left) || !isFinite(rect.top) || rect.width <= 0 || rect.height <= 0) continue;
        minX = Math.min(minX, rect.left);
        minY = Math.min(minY, rect.top);
        maxX = Math.max(maxX, rect.right);
        maxY = Math.max(maxY, rect.bottom);
      }
      if (!isFinite(minX) || !isFinite(maxX)) {
        minX = 0; minY = 0;
        maxX = Math.max(b.scrollWidth, b.offsetWidth, 1);
        maxY = Math.max(b.scrollHeight, b.offsetHeight, 1);
      }
      return {
        x: minX,
        y: minY,
        w: Math.max(1, Math.ceil(maxX - minX)),
        h: Math.max(1, Math.ceil(maxY - minY))
      };
    } finally {
      de.classList.remove('yuvilab-game-measuring');
      de.style.overflow = prevHtmlOverflow;
      b.style.overflow = prevBodyOverflow;
      b.style.transform = prevBodyTransform;
      b.style.width = prevBodyWidth;
      b.style.height = prevBodyHeight;
      b.style.minWidth = prevBodyMinWidth;
      b.style.minHeight = prevBodyMinHeight;
      measuring = false;
    }
  }

  function fit() {
    raf = 0;
    if (!document.body) return;
    captureOriginalBodyStyle();
    var vp = viewport();
    var nat = naturalBounds();
    if (nat.w <= 0 || nat.h <= 0) return;
    var scale = Math.min(vp.w / nat.w, vp.h / nat.h);
    if (!isFinite(scale) || scale <= 0) scale = 1;
    if (scale > 4) scale = 4; // cap upscale to avoid extreme blur
    scale = Math.floor(scale * 1000) / 1000;
    if (scale < 0.999 || scale > 1.001) {
      var fittedW = nat.w * scale;
      var fittedH = nat.h * scale;
      var tx = Math.max(0, (vp.w - fittedW) / 2) - (nat.x * scale);
      var ty = Math.max(0, (vp.h - fittedH) / 2) - (nat.y * scale);
      document.body.style.setProperty('width', Math.ceil(nat.w) + 'px', 'important');
      document.body.style.setProperty('height', Math.ceil(nat.h) + 'px', 'important');
      document.body.style.setProperty('min-width', Math.ceil(nat.w) + 'px', 'important');
      document.body.style.setProperty('min-height', Math.ceil(nat.h) + 'px', 'important');
      document.body.style.setProperty('transform',
        'matrix(' + scale + ', 0, 0, ' + scale + ', ' + Math.round(tx) + ', ' + Math.round(ty) + ')',
        'important');
    } else {
      restoreOriginalBodyStyle();
    }
  }

  function schedule() {
    if (measuring) return;
    if (raf) return;
    raf = requestAnimationFrame(fit);
  }

  window.addEventListener('resize', schedule);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', schedule);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', schedule, { once: true });
  } else {
    schedule();
  }
  window.addEventListener('load', schedule);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(schedule).catch(function () {});

  function watchMedia() {
    var media = Array.prototype.slice.call(document.querySelectorAll('img, video'));
    for (var i = 0; i < media.length; i++) {
      if (media[i].__yuvilabFitWatch) continue;
      media[i].__yuvilabFitWatch = true;
      media[i].addEventListener('load', schedule);
      media[i].addEventListener('loadedmetadata', schedule);
      media[i].addEventListener('error', schedule);
    }
  }
  if (window.MutationObserver) {
    var mo = new MutationObserver(function () {
      if (measuring) return;
      watchMedia();
      schedule();
    });
    if (document.body) mo.observe(document.body, { childList: true, subtree: true });
    else document.addEventListener('DOMContentLoaded', function () {
      if (document.body) mo.observe(document.body, { childList: true, subtree: true });
    }, { once: true });
  }
  watchMedia();
  setTimeout(schedule, 80);
  setTimeout(schedule, 300);
  setTimeout(schedule, 800);
})();

/*
 * Late resize kicks. Some generated games size their canvas once at start,
 * before the iframe has its final box (the host lays the panel out with a
 * transition), and only re-measure on `resize` — which never fires unless
 * the window changes, so the game sat blank until something (dev tools)
 * resized it. The frame now gets a `resize` a few times after load and
 * whenever its own box changes.
 */
(function () {
  if (window.__yuvilabResizeKick) return;
  window.__yuvilabResizeKick = true;
  var kick = function () {
    try { window.dispatchEvent(new Event('resize')); } catch (e) {}
  };
  var delays = [120, 400, 1000, 2000];
  for (var i = 0; i < delays.length; i++) setTimeout(kick, delays[i]);
  window.addEventListener('load', function () { setTimeout(kick, 60); });
  if (window.ResizeObserver) {
    var pending = 0;
    var ro = new ResizeObserver(function () {
      if (pending) return;
      pending = requestAnimationFrame(function () { pending = 0; kick(); });
    });
    var start = function () { if (document.documentElement) ro.observe(document.documentElement); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
  }
})();
