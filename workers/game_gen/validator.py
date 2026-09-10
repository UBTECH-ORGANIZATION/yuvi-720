"""Headless runtime validator (Playwright / Chromium).

Ported from vibe-coding-kids ``src/backend/html_validator.py``: console /
pageerror / requestfailed hooks, a settle wait, multilingual Start-button
click heuristics, a post-interaction wait, empty-page detection and error
categorisation for the fix prompt.

Extended for the yuvi worker with a harness phase that reads ``window.__yuvi``
(maintained by ``harness/error_reporter.js`` and the bridge):
``{learn:{asked,answered,correct,done}, heartbeat, errors}``. After Start the
validator plays for ~2 s (the *play score*: frames rendered, whether input
changes the picture, whether there is DOM text), checks the rAF heartbeat,
samples canvases for a non-blank frame, and takes an 800x600 PNG. The game
owns its questions; nothing is required of it beyond running well.

Usage::

    result = await validate_html(html, preinject_html=harness_tags)
    if not result.ok: ...
"""
from __future__ import annotations

import asyncio
import logging
import os
import re
import tempfile
from dataclasses import asdict, dataclass, field
from typing import Any, Optional

log = logging.getLogger("game_gen.validator")

try:
    from playwright.async_api import async_playwright  # noqa: F401
    HAS_PLAYWRIGHT = True
except ImportError:  # pragma: no cover
    HAS_PLAYWRIGHT = False

# ── Configuration ────────────────────────────────────────────────────────────
SETTLE_TIMEOUT_MS = 4000          # wait after load for first-tick errors
INTERACTION_SETTLE_MS = 3500      # wait after clicking Start
PAGE_LOAD_TIMEOUT_MS = 15000
POSTER_STEP_MS = 1500             # thumbnail: sample play every 1.5 s while no question is open
POSTER_WINDOW_MS = 6000           # …for this long after Start
PLAY_INPUT_MS = 700               # play score: hold the pointer / keys this long
PLAY_SAMPLE_MS = 600              # play score: idle frames counted over this long
MIN_HEARTBEAT = 30                # rAF ticks the harness must have counted
CHROMIUM_ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"]

IGNORED_ERROR_PATTERNS = [
    "ResizeObserver",
    "Script error.",            # cross-origin noise
    "runtime.lastError",        # Chrome extension noise
    "Extension context",
    "favicon.ico",
    "net::ERR_FILE_NOT_FOUND",  # local file:// refs that don't matter
]
IGNORED_WARNING_PATTERNS = ["DevTools", "Autofill", "third-party cookie", "download the React DevTools"]

# Start-button heuristics, most specific first (he / en / ru / ar)
_START_TEXT_PATTERNS = [
    "התחל", "התחל משחק", "שחק", "start", "play", "begin", "לחץ להתחלה",
    "Начать", "Играть", "Старт", "Запуск", "Начни", "Давай",
    "ابدأ", "العب", "بداية", "انطلق", "هيا",
]
_START_ID_SELECTORS = ["#start-button", "#startButton", "#start-btn", "#start", "#play-button", "#playButton"]


@dataclass
class ValidationResult:
    """Verdict of one headless run.

    ``ok`` is the runtime verdict (no JS errors, page rendered, main thread
    alive, canvas not blank). ``play_score`` is informational:
    ``{frames, input_reacts, dom_text}`` measured over ~2 s after Start.
    """

    ok: bool
    errors: list[dict] = field(default_factory=list)
    play_score: Optional[dict] = None
    heartbeat: int = 0
    canvas_blank: bool = False
    screenshot_png: Optional[bytes] = None
    warnings: list[str] = field(default_factory=list)
    failed_requests: list[dict] = field(default_factory=list)
    clicked_start: bool = False
    yuvi_state: Optional[dict] = None
    validator_error: Optional[str] = None

    def to_dict(self, *, include_screenshot: bool = False) -> dict[str, Any]:
        d = asdict(self)
        if not include_screenshot:
            d["screenshot_png"] = None if self.screenshot_png is None else f"<{len(self.screenshot_png)} bytes>"
        return d


def _is_ignored(message: str, patterns: list[str]) -> bool:
    return any(p.lower() in message.lower() for p in patterns)


def inject_into_head(html: str, snippet: str) -> str:
    """Put ``snippet`` at the very start of ``<head>`` (creating one if needed)."""
    if not snippet:
        return html
    m = re.search(r"<head[^>]*>", html, re.IGNORECASE)
    if m:
        return html[: m.end()] + snippet + html[m.end():]
    m = re.search(r"<html[^>]*>", html, re.IGNORECASE)
    if m:
        return html[: m.end()] + "<head>" + snippet + "</head>" + html[m.end():]
    return snippet + html


def chromium_available() -> bool:
    """True when Playwright is importable and its Chromium build is installed.

    Uses the async driver (the sync one leaves a pending-task warning on
    teardown); when called from inside a running event loop the probe runs
    on a helper thread.
    """
    if not HAS_PLAYWRIGHT:
        return False

    async def _probe() -> bool:
        from playwright.async_api import async_playwright

        async with async_playwright() as p:
            return os.path.exists(p.chromium.executable_path)

    try:
        try:
            asyncio.get_running_loop()
        except RuntimeError:
            return asyncio.run(_probe())
        import concurrent.futures

        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as ex:
            return ex.submit(lambda: asyncio.run(_probe())).result()
    except Exception:  # noqa: BLE001
        return False


async def _click_start_buttons(page) -> bool:  # noqa: ANN001 – Playwright Page
    """Click the most likely Start button; True if something was clicked."""
    for text in _START_TEXT_PATTERNS:
        try:
            locator = page.locator(f"button:has-text('{text}')").first
            if await locator.count() > 0 and await locator.is_visible():
                await locator.click(timeout=2000)
                log.info("clicked start button with text %r", text)
                return True
        except Exception:  # noqa: BLE001
            continue

    for sel in _START_ID_SELECTORS:
        try:
            locator = page.locator(sel).first
            if await locator.count() > 0 and await locator.is_visible():
                await locator.click(timeout=2000)
                log.info("clicked start button %s", sel)
                return True
        except Exception:  # noqa: BLE001
            continue

    try:
        buttons = page.locator("button:visible")
        if await buttons.count() == 1:
            await buttons.first.click(timeout=2000)
            log.info("clicked the only visible button")
            return True
    except Exception:  # noqa: BLE001
        pass

    for text in _START_TEXT_PATTERNS[:4]:
        try:
            locator = page.locator(f"[onclick]:has-text('{text}'), .start-btn, .play-btn").first
            if await locator.count() > 0 and await locator.is_visible():
                await locator.click(timeout=2000)
                log.info("clicked start element with text %r", text)
                return True
        except Exception:  # noqa: BLE001
            continue

    log.info("no start button found; skipping interaction phase")
    return False


_EMPTY_PAGE_JS = """() => {
    const scripts = document.querySelectorAll('script');
    if (scripts.length === 0) return false;
    const body = document.body;
    if (!body) return true;
    const children = body.children;
    if (children.length === 0) return true;
    for (const el of children) {
        const style = window.getComputedStyle(el);
        if (style.display !== 'none' && style.visibility !== 'hidden'
            && el.offsetWidth > 0 && el.offsetHeight > 0) return false;
    }
    return true;
}"""

_YUVI_STATE_JS = """() => {
    const y = window.__yuvi;
    if (!y || typeof y !== 'object') return null;
    try { return JSON.parse(JSON.stringify(y)); } catch (e) { return { heartbeat: y.heartbeat, learn: y.learn }; }
}"""

# Samples every visible canvas across a few animation frames (so WebGL canvases
# without preserveDrawingBuffer are read while their frame is still live) and
# counts distinct quantised colours + luminance spread.
_CANVAS_SAMPLE_JS = """async () => {
    const canvases = Array.from(document.querySelectorAll('canvas'))
        .filter(c => c.width > 0 && c.height > 0 && c.offsetWidth > 0 && c.offsetHeight > 0);
    if (!canvases.length) return { has_canvas: false, blank: false, unique: 0, spread: 0 };
    const W = 48, H = 36;
    const scratch = document.createElement('canvas');
    scratch.width = W; scratch.height = H;
    const ctx = scratch.getContext('2d', { willReadFrequently: true });
    if (!ctx) return { has_canvas: true, blank: false, unique: 0, spread: 0, detail: 'no 2d ctx' };
    let bestUnique = 0, bestSpread = 0, tainted = false;
    const sample = () => {
        for (const c of canvases) {
            try {
                ctx.clearRect(0, 0, W, H);
                ctx.drawImage(c, 0, 0, W, H);
                const d = ctx.getImageData(0, 0, W, H).data;
                const seen = new Set();
                let min = 255, max = 0;
                for (let i = 0; i < d.length; i += 4) {
                    const r = d[i] >> 4, g = d[i + 1] >> 4, b = d[i + 2] >> 4;
                    seen.add((r << 8) | (g << 4) | b);
                    const lum = (d[i] * 3 + d[i + 1] * 6 + d[i + 2]) / 10;
                    if (lum < min) min = lum;
                    if (lum > max) max = lum;
                }
                if (seen.size > bestUnique) bestUnique = seen.size;
                if (max - min > bestSpread) bestSpread = max - min;
            } catch (e) { tainted = true; }
        }
    };
    for (let i = 0; i < 4; i++) {
        await new Promise(r => requestAnimationFrame(() => { sample(); r(); }));
    }
    if (tainted && bestUnique === 0) return { has_canvas: true, blank: false, unique: 0, spread: 0, detail: 'tainted' };
    return { has_canvas: true, blank: bestUnique <= 2 && bestSpread < 8, unique: bestUnique, spread: bestSpread };
}"""


# A cheap fingerprint of what is on screen: the first visible canvas drawn
# into 32x32 and hashed, plus whether the DOM shows any text. WebGL canvases
# without preserveDrawingBuffer read back black; the caller falls back to a
# screenshot hash when the canvas hash is empty.
_FRAME_HASH_JS = """() => {
    const c = Array.from(document.querySelectorAll('canvas'))
        .find(x => x.width > 0 && x.height > 0 && x.offsetWidth > 0 && x.offsetHeight > 0);
    const textNodes = document.body ? document.body.innerText : '';
    const domText = !!(textNodes && textNodes.replace(/\\s+/g, '').length >= 3);
    if (!c) return { hash: null, dom_text: domText };
    try {
        const s = document.createElement('canvas');
        s.width = 32; s.height = 32;
        const ctx = s.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(c, 0, 0, 32, 32);
        const d = ctx.getImageData(0, 0, 32, 32).data;
        let h = 2166136261, sum = 0;
        for (let i = 0; i < d.length; i += 4) {
            const v = (d[i] >> 3) * 1024 + (d[i + 1] >> 3) * 32 + (d[i + 2] >> 3);
            h = ((h ^ v) * 16777619) >>> 0;
            sum += d[i] + d[i + 1] + d[i + 2];
        }
        return { hash: sum === 0 ? null : String(h), dom_text: domText };
    } catch (e) {
        return { hash: null, dom_text: domText, tainted: true };
    }
}"""


async def _frame_hash(page) -> tuple[Optional[str], bool]:  # noqa: ANN001
    """(fingerprint, dom_text) — canvas pixel hash, or a small screenshot's hash."""
    dom_text = False
    try:
        sample = await page.evaluate(_FRAME_HASH_JS) or {}
        dom_text = bool(sample.get("dom_text"))
        if sample.get("hash"):
            return str(sample["hash"]), dom_text
    except Exception:  # noqa: BLE001
        pass
    try:
        import hashlib
        png = await page.screenshot(type="png", clip={"x": 0, "y": 0, "width": 320, "height": 240})
        return hashlib.sha1(png).hexdigest(), dom_text
    except Exception:  # noqa: BLE001
        return None, dom_text


async def _play_score(page) -> dict[str, Any]:  # noqa: ANN001
    """~2 s of play after Start: frames rendered while idle, and whether the
    picture changes when the kid presses the usual keys and taps the canvas."""
    score: dict[str, Any] = {"frames": 0, "input_reacts": False, "dom_text": False}
    try:
        before = await page.evaluate(_YUVI_STATE_JS) or {}
        hash_before, dom_text = await _frame_hash(page)
        await page.wait_for_timeout(PLAY_SAMPLE_MS)
        mid = await page.evaluate(_YUVI_STATE_JS) or {}
        score["frames"] = max(0, int(mid.get("heartbeat") or 0) - int(before.get("heartbeat") or 0))
        hash_idle, _ = await _frame_hash(page)
        # Input: arrow / D / Space held, plus a pointer down-up at the canvas centre.
        vp = page.viewport_size or {"width": 800, "height": 600}
        box = None
        try:
            box = await page.locator("canvas").first.bounding_box(timeout=500)
        except Exception:  # noqa: BLE001
            box = None
        cx = (box["x"] + box["width"] / 2) if box else vp["width"] / 2
        cy = (box["y"] + box["height"] / 2) if box else vp["height"] / 2
        for key in ("ArrowRight", "KeyD", "Space"):
            try:
                await page.keyboard.down(key)
            except Exception:  # noqa: BLE001
                pass
        try:
            await page.mouse.move(cx, cy)
            await page.mouse.down()
        except Exception:  # noqa: BLE001
            pass
        await page.wait_for_timeout(PLAY_INPUT_MS)
        try:
            await page.mouse.up()
        except Exception:  # noqa: BLE001
            pass
        for key in ("ArrowRight", "KeyD", "Space"):
            try:
                await page.keyboard.up(key)
            except Exception:  # noqa: BLE001
                pass
        hash_after, dom_text_after = await _frame_hash(page)
        # A frame that changed on its own (animation) already proves life; a
        # frame that only changes with input proves the controls are wired.
        score["input_reacts"] = bool(hash_after and hash_after != hash_idle) or bool(hash_idle and hash_before and hash_idle != hash_before)
        score["dom_text"] = bool(dom_text or dom_text_after)
    except Exception as exc:  # noqa: BLE001
        log.warning("play score failed: %s", exc)
    return score


async def validate_html(
    html: str,
    *,
    preinject_html: Optional[str] = None,
    settle_ms: int = SETTLE_TIMEOUT_MS,
    interaction_settle_ms: int = INTERACTION_SETTLE_MS,
    min_heartbeat: int = MIN_HEARTBEAT,
    viewport_width: int = 800,
    viewport_height: int = 600,
    screenshot: bool = True,
) -> ValidationResult:
    """Run ``html`` in headless Chromium and report errors + a play score.

    ``preinject_html`` (harness ``<script>`` tags) is prepended into ``<head>``
    so it runs before any game code.  Never raises for game problems; an
    infrastructure failure is reported in ``validator_error`` with ``ok=True``
    (fail-open, like vibe).
    """
    if not HAS_PLAYWRIGHT:
        log.warning("playwright not installed; skipping runtime validation")
        return ValidationResult(ok=True, validator_error="playwright not installed")

    doc = inject_into_head(html, preinject_html) if preinject_html else html

    errors: list[dict] = []
    warnings: list[str] = []
    failed_requests: list[dict] = []
    clicked = False
    yuvi_state: Optional[dict] = None
    heartbeat = 0
    canvas_blank = False
    play_score: Optional[dict] = None
    png: Optional[bytes] = None

    tmp_path: Optional[str] = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", suffix=".html", delete=False, encoding="utf-8") as f:
            f.write(doc)
            tmp_path = f.name
        file_url = f"file://{tmp_path}"

        from playwright.async_api import async_playwright

        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True, args=CHROMIUM_ARGS)
            try:
                page = await browser.new_page(viewport={"width": viewport_width, "height": viewport_height})

                def _on_console(msg) -> None:  # noqa: ANN001
                    text = msg.text
                    if msg.type == "error":
                        if not _is_ignored(text, IGNORED_ERROR_PATTERNS):
                            errors.append({"source": "console.error", "message": text})
                    elif msg.type == "warning":
                        if not _is_ignored(text, IGNORED_WARNING_PATTERNS):
                            warnings.append(text)

                def _on_page_error(error) -> None:  # noqa: ANN001
                    msg = str(error)
                    if not _is_ignored(msg, IGNORED_ERROR_PATTERNS):
                        errors.append({"source": "pageerror", "message": msg})

                def _on_request_failed(request) -> None:  # noqa: ANN001
                    url = request.url
                    if url.startswith(("data:", "blob:")) or "favicon" in url:
                        return
                    failed_requests.append({"url": url, "failure": request.failure or "unknown"})

                page.on("console", _on_console)
                page.on("pageerror", _on_page_error)
                page.on("requestfailed", _on_request_failed)

                # ── Phase 1: load + settle ──
                try:
                    await page.goto(file_url, wait_until="load", timeout=PAGE_LOAD_TIMEOUT_MS)
                except Exception as e:  # noqa: BLE001
                    errors.append({"source": "navigation", "message": f"Page failed to load: {e}"})
                    return ValidationResult(ok=False, errors=errors, warnings=warnings,
                                            failed_requests=failed_requests)
                await page.wait_for_timeout(settle_ms)

                # ── Phase 2: interaction (Start button) ──
                before = len(errors)
                title_png: Optional[bytes] = None
                if screenshot:
                    try:
                        title_png = await page.screenshot(type="png", full_page=False)
                    except Exception as e:  # noqa: BLE001
                        log.warning("title screenshot failed: %s", e)
                clicked = await _click_start_buttons(page)
                # The thumbnail is the game itself, never a question overlay.
                # The bridge counts questions asked and answered, so "a
                # question is open" is exact: capture play frames only while
                # asked == answered, keep the latest non-empty (the most play
                # on screen), and fall back to the title screen taken before
                # Start when the game asks at once.
                early_png: Optional[bytes] = title_png
                if screenshot:
                    window_ms = max(interaction_settle_ms, POSTER_WINDOW_MS)
                    waited = 0
                    while waited < window_ms:
                        step = min(POSTER_STEP_MS, window_ms - waited)
                        await page.wait_for_timeout(step)
                        waited += step
                        try:
                            learn = (await page.evaluate(_YUVI_STATE_JS) or {}).get("learn") or {}
                            if int(learn.get("asked") or 0) > int(learn.get("answered") or 0):
                                continue  # a question is open — not a poster
                            shot = await page.screenshot(type="png", full_page=False)
                            if shot:
                                early_png = shot
                        except Exception as e:  # noqa: BLE001
                            log.warning("poster capture failed: %s", e)
                else:
                    await page.wait_for_timeout(interaction_settle_ms)
                for err in errors[before:]:
                    err["source"] = "post-interaction"

                # ── Phase 3: empty page (SyntaxError leaves no pageerror) ──
                if not errors:
                    try:
                        if await page.evaluate(_EMPTY_PAGE_JS):
                            errors.append({
                                "source": "structural",
                                "message": "Page has <script> tags but rendered no visible content"
                                           " — possible SyntaxError in JavaScript",
                            })
                            log.info("empty page detected — likely SyntaxError")
                    except Exception:  # noqa: BLE001
                        pass

                # ── Phase 4: harness state via window.__yuvi ──
                try:
                    yuvi_state = await page.evaluate(_YUVI_STATE_JS)
                except Exception:  # noqa: BLE001
                    yuvi_state = None

                if yuvi_state is None:
                    errors.append({
                        "source": "harness",
                        "message": "window.__yuvi missing (harness not injected or page crashed)",
                    })
                else:
                    # ── Phase 4b: play score (~2 s of play) ──
                    play_score = await _play_score(page)
                    try:
                        yuvi_state = await page.evaluate(_YUVI_STATE_JS) or yuvi_state
                    except Exception:  # noqa: BLE001
                        pass
                    heartbeat = int((yuvi_state or {}).get("heartbeat") or 0)
                    if heartbeat < min_heartbeat:
                        errors.append({
                            "source": "liveness",
                            "message": f"requestAnimationFrame heartbeat only {heartbeat} ticks "
                                       f"(< {min_heartbeat}) — main thread stalled or page frozen",
                        })
                    for harness_err in (yuvi_state or {}).get("errors") or []:
                        msg = str((harness_err or {}).get("message") or "")
                        if msg and not _is_ignored(msg, IGNORED_ERROR_PATTERNS) \
                                and not any(msg in e["message"] for e in errors):
                            errors.append({"source": f"harness/{harness_err.get('kind', 'error')}",
                                           "message": msg})

                # ── Phase 5: canvas non-blank ──
                try:
                    sample = await page.evaluate(_CANVAS_SAMPLE_JS)
                    canvas_blank = bool(sample and sample.get("has_canvas") and sample.get("blank"))
                    if canvas_blank:
                        errors.append({
                            "source": "render",
                            "message": f"Canvas is blank (a single flat colour after {settle_ms + interaction_settle_ms} ms"
                                       f" — unique colours={sample.get('unique')}); nothing is drawn",
                        })
                except Exception:  # noqa: BLE001
                    canvas_blank = False

                # ── Phase 6: screenshot (thumbnail) ──
                if screenshot:
                    try:
                        png = await page.screenshot(type="png", full_page=False)
                        if early_png and not await page.evaluate(_EMPTY_PAGE_JS):
                            png = early_png
                    except Exception as e:  # noqa: BLE001
                        log.warning("screenshot failed: %s", e)
                        png = None
            finally:
                await browser.close()

    except Exception as e:  # noqa: BLE001
        log.error("runtime validation failed unexpectedly: %s", e)
        return ValidationResult(ok=True, validator_error=f"validator crashed: {e}")
    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.unlink(tmp_path)
            except OSError:
                pass

    ok = len(errors) == 0
    if ok:
        log.info("runtime validation passed (0 errors, %d warnings); play=%s", len(warnings), play_score)
    else:
        log.info("runtime validation found %d error(s): %s", len(errors),
                 "; ".join(e["message"][:80] for e in errors[:3]))

    return ValidationResult(
        ok=ok, errors=errors, play_score=play_score, heartbeat=heartbeat, canvas_blank=canvas_blank, screenshot_png=png,
        warnings=warnings, failed_requests=failed_requests, clicked_start=clicked,
        yuvi_state=yuvi_state,
    )


def validate_html_sync(html: str, **kwargs: Any) -> ValidationResult:
    """Blocking wrapper around ``validate_html`` (must not be called inside a running loop)."""
    return asyncio.run(validate_html(html, **kwargs))


# ── Error categorisation for the fix prompt ──────────────────────────────────

def categorize_error(message: str) -> tuple[str, str]:
    """Return ``(category, hint)`` for a JS runtime error message."""
    m = message.lower()
    if "is not defined" in m:
        return "scope", "A variable is used before it is defined. Define every variable before use."
    if "null" in m and ("property" in m or "cannot read" in m):
        return "dom-timing", "A DOM element is not ready. Wrap in DOMContentLoaded or place the script after the HTML it touches."
    if "negative" in m or "nan" in m:
        return "math", "Negative or NaN value. Guard with Math.max(0, ...) and isNaN()."
    if "syntaxerror" in m or "unexpected token" in m or "rendered no visible content" in m:
        return "syntax", "Syntax error. Check brackets, commas and semicolons."
    if "failed to load" in m or "net::" in m:
        return "network", "A CDN script did not load. Use only the allowed library URLs, exactly as given."
    if "createlineargradient" in m or "bindtexture" in m or "bindframebuffer" in m:
        return "canvas-api", "Canvas/WebGL API error. Make sure parameters are valid (not NaN, not null)."
    if "heartbeat" in m or "frozen" in m:
        return "liveness", "The page froze. Look for infinite loops or synchronous work that never yields."
    if "canvas is blank" in m:
        return "render", "Nothing is drawn. Make sure the game loop starts and draws to the canvas on load."
    return "general", ""


def format_errors_for_fix_prompt(result: ValidationResult | dict) -> str:
    """Categorised, hinted error list for a fix prompt (empty string when clean)."""
    data = result if isinstance(result, dict) else result.to_dict()
    parts: list[str] = []
    hints_seen: set[str] = set()
    post_interaction = False

    for err in (data.get("errors") or [])[:5]:
        source = err.get("source", "unknown")
        msg = err.get("message", "")
        category, hint = categorize_error(msg)
        if source == "post-interaction":
            post_interaction = True
        parts.append(f"- [{source}/{category}] {msg}")
        if hint and hint not in hints_seen:
            parts.append(f"  Hint: {hint}")
            hints_seen.add(hint)

    if post_interaction:
        hint = ("The errors above happen only after the Start button is clicked. Make sure every "
                "variable, DOM element and event listener used by the start handler is initialised "
                "there, not only in DOMContentLoaded.")
        parts.append(f"  Hint: {hint}")

    for req in (data.get("failed_requests") or [])[:3]:
        parts.append(f"- [network] Failed to load {req.get('url', '')}: {req.get('failure', 'unknown')}")
        hint = "Use only the allowed CDN URLs, copied exactly."
        if hint not in hints_seen:
            parts.append(f"  Hint: {hint}")
            hints_seen.add(hint)

    if not parts:
        return ""
    return (
        "Runtime errors found by automatic validation:\n"
        + "\n".join(parts)
        + "\n\nFix them with targeted patches that touch only the broken lines."
    )


__all__ = [
    "ValidationResult",
    "validate_html",
    "validate_html_sync",
    "inject_into_head",
    "chromium_available",
    "categorize_error",
    "format_errors_for_fix_prompt",
    "HAS_PLAYWRIGHT",
    "CHROMIUM_ARGS",
]
