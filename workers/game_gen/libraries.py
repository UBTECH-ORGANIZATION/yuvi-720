"""Curated CDN libraries for generated games.

Ported from vibe-coding-kids ``src/backend/agent/libraries.py``.  Phaser 4.2.1
sits next to Phaser 3.90.0, and Three.js (module build) is allowed for games
that want a 3D feel; ``_fix_threejs_non_module`` (also from vibe) rescues the
common mistake of loading it as a classic script and using a global ``THREE``.
``normalize_cdn_urls`` rewrites hallucinated versions to the verified URLs,
picking the Phaser entry whose major version matches the URL the model wrote.
"""
from __future__ import annotations

import asyncio
import logging
import re
from typing import Optional

log = logging.getLogger("game_gen.libraries")

AVAILABLE_LIBRARIES: dict[str, dict] = {
    "phaser": {
        "name": "Phaser 3",
        "cdn": "https://cdn.jsdelivr.net/npm/phaser@3.90.0/dist/phaser.min.js",
        "fallback": "https://unpkg.com/phaser@3.90.0/dist/phaser.min.js",
        "npm_packages": ["phaser"],
        "major": 3,
        "use": "Full 2D game engine (platformers, shooters, RPGs)",
    },
    "phaser4": {
        "name": "Phaser 4",
        "cdn": "https://cdn.jsdelivr.net/npm/phaser@4.2.1/dist/phaser.min.js",
        "fallback": "https://unpkg.com/phaser@4.2.1/dist/phaser.min.js",
        "npm_packages": ["phaser"],
        "major": 4,
        "use": "Phaser 4 (same API family as Phaser 3, newer renderer)",
    },
    "three": {
        "name": "Three.js",
        "cdn": "https://cdn.jsdelivr.net/npm/three@0.183.2/build/three.module.min.js",
        "fallback": "https://unpkg.com/three@0.183.2/build/three.module.min.js",
        "npm_packages": ["three"],
        "script_attrs": 'type="module"',
        "use": "3D worlds and games (ES module: `import * as THREE from '<url>'` inside <script type=\"module\">)",
    },
    "kaplay": {
        "name": "Kaplay",
        "cdn": "https://cdn.jsdelivr.net/npm/kaplay@3001.0.19/dist/kaplay.js",
        "fallback": "https://unpkg.com/kaplay@3001.0.19/dist/kaplay.js",
        "npm_packages": ["kaplay"],
        "use": "Simple game engine for beginners",
    },
    "pixi": {
        "name": "PixiJS",
        "cdn": "https://cdn.jsdelivr.net/npm/pixi.js@8.17.1/dist/pixi.min.js",
        "fallback": "https://unpkg.com/pixi.js@8.17.1/dist/pixi.min.js",
        "npm_packages": ["pixi.js", "pixi"],
        "use": "High-performance 2D WebGL rendering",
    },
    "p5": {
        "name": "p5.js",
        "cdn": "https://cdn.jsdelivr.net/npm/p5@2.2.2/lib/p5.min.js",
        "fallback": "https://unpkg.com/p5@2.2.2/lib/p5.min.js",
        "npm_packages": ["p5"],
        "use": "Creative art & simple interactive games",
    },
    "matter": {
        "name": "Matter.js",
        "cdn": "https://cdn.jsdelivr.net/npm/matter-js@0.20.0/build/matter.min.js",
        "fallback": "https://unpkg.com/matter-js@0.20.0/build/matter.min.js",
        "npm_packages": ["matter-js"],
        "use": "2D physics (gravity, collisions)",
    },
    "howler": {
        "name": "Howler.js",
        "cdn": "https://cdnjs.cloudflare.com/ajax/libs/howler/2.2.4/howler.min.js",
        "npm_packages": ["howler"],
        "use": "Sound effects and music",
    },
    "gsap": {
        "name": "GSAP",
        "cdn": "https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js",
        "fallback": "https://unpkg.com/gsap@3.14.2/dist/gsap.min.js",
        "npm_packages": ["gsap"],
        "use": "Professional animations",
    },
    "confetti": {
        "name": "canvas-confetti",
        "cdn": "https://cdn.jsdelivr.net/npm/canvas-confetti@1/dist/confetti.browser.min.js",
        "fallback": "https://unpkg.com/canvas-confetti@1/dist/confetti.browser.min.js",
        "npm_packages": ["canvas-confetti"],
        "use": "Celebration effects",
    },
    "nipple": {
        "name": "Nipple.js",
        "cdn": "https://cdn.jsdelivr.net/npm/nipplejs@0.10.2/dist/nipplejs.min.js",
        "npm_packages": ["nipplejs"],
        "use": "Virtual joystick for mobile",
    },
    "tone": {
        "name": "Tone.js",
        "cdn": "https://cdn.jsdelivr.net/npm/tone@15.1.22/build/Tone.js",
        "npm_packages": ["tone"],
        "use": "Music creation",
    },
    "anime": {
        "name": "Anime.js",
        "cdn": "https://cdnjs.cloudflare.com/ajax/libs/animejs/3.2.2/anime.min.js",
        "npm_packages": ["animejs", "anime"],
        "use": "Advanced CSS/SVG animations",
    },
    "konva": {
        "name": "Konva.js",
        "cdn": "https://cdn.jsdelivr.net/npm/konva@10.2.3/konva.min.js",
        "npm_packages": ["konva"],
        "use": "Interactive Canvas drawing, drag & drop",
    },
    "canvas": {
        "name": "Canvas 2D API",
        "cdn": None,
        "npm_packages": [],
        "use": "Built-in browser drawing (no library needed)",
    },
}

# npm package name -> library keys (Phaser maps to two entries, disambiguated by major)
_NPM_TO_LIB_KEYS: dict[str, list[str]] = {}
for _key, _info in AVAILABLE_LIBRARIES.items():
    for _pkg in _info.get("npm_packages", []):
        _NPM_TO_LIB_KEYS.setdefault(_pkg.lower(), []).append(_key)


def get_library_cdn(lib_key: str) -> Optional[str]:
    """Verified CDN URL for a library key, or None."""
    lib = AVAILABLE_LIBRARIES.get(lib_key)
    return lib["cdn"] if lib else None


def get_library_fallback(lib_key: str) -> Optional[str]:
    """Fallback CDN URL for a library key, or None."""
    lib = AVAILABLE_LIBRARIES.get(lib_key)
    return lib.get("fallback") if lib else None


def get_cdn_reference_table() -> str:
    """One ``<script>`` tag per library — the vibe prompt table."""
    lines = []
    for info in AVAILABLE_LIBRARIES.values():
        cdn = info.get("cdn")
        if not cdn:
            continue
        attrs = info.get("script_attrs", "")
        tag = f'<script {attrs} src="{cdn}"></script>' if attrs else f'<script src="{cdn}"></script>'
        lines.append(f"  {info['name']}: {tag}")
    return "\n".join(lines)


def library_prompt_block() -> str:
    """Compact allow-list of libraries + URLs for a system prompt."""
    lines = [
        "ALLOWED LIBRARIES (copy the URL exactly — any other library or version is unavailable):",
    ]
    for key, info in AVAILABLE_LIBRARIES.items():
        cdn = info.get("cdn")
        if cdn:
            lines.append(f"- {info['name']} — {info['use']}\n  <script src=\"{cdn}\"></script>")
        else:
            lines.append(f"- {info['name']} — {info['use']}")
    return "\n".join(lines)


def _resolve_lib_key(pkg: str, url: str) -> Optional[str]:
    """Map an npm/cdnjs package name (+ URL, for the version) to a library key."""
    keys = _NPM_TO_LIB_KEYS.get(pkg.lower())
    if not keys:
        return None
    if len(keys) == 1:
        return keys[0]
    m = re.search(re.escape(pkg) + r"[@/]v?(\d+)", url, re.IGNORECASE)
    if m:
        major = int(m.group(1))
        for k in keys:
            if AVAILABLE_LIBRARIES[k].get("major") == major:
                return k
    return keys[0]


_NPM_URL_RE = re.compile(r"(?:jsdelivr\.net/npm|unpkg\.com)/((?:@[\w.-]+/)?[\w.-]+?)@")
_CDNJS_URL_RE = re.compile(r"cdnjs\.cloudflare\.com/ajax/libs/([\w.-]+?)/")
_SCRIPT_SRC_RE = re.compile(r"""<script\b[^>]*\bsrc=["']([^"'>]+)["']""")
_IMPORT_RE = re.compile(r"""(?:import\s.*?from\s+|import\s*\()['"]([^'"]+)['"]""")


def _verified_url_for(url: str) -> Optional[str]:
    """Return the verified URL when ``url`` points at a known library with a different path."""
    m = _NPM_URL_RE.search(url) or _CDNJS_URL_RE.search(url)
    if not m:
        return None
    lib_key = _resolve_lib_key(m.group(1), url)
    if not lib_key:
        return None
    verified = AVAILABLE_LIBRARIES[lib_key]["cdn"]
    if verified and url != verified:
        return verified
    return None


def normalize_cdn_urls(code: str) -> str:
    """Replace hallucinated CDN versions with verified URLs from AVAILABLE_LIBRARIES.

    Covers ``<script src>`` tags (jsdelivr / unpkg / cdnjs) and ``import ... from``
    URLs inside module scripts.
    """
    if not code:
        return code

    def _replace_script_src(match: re.Match[str]) -> str:
        full, url = match.group(0), match.group(1)
        verified = _verified_url_for(url)
        if verified:
            log.info("CDN fix: %s -> %s", url, verified)
            return full.replace(url, verified)
        return full

    code = _SCRIPT_SRC_RE.sub(_replace_script_src, code)

    def _replace_import_url(match: re.Match[str]) -> str:
        full, url = match.group(0), match.group(1)
        verified = _verified_url_for(url)
        if verified:
            log.info("CDN fix (import): %s -> %s", url, verified)
            return full.replace(url, verified)
        return full

    code = _IMPORT_RE.sub(_replace_import_url, code)
    return _fix_threejs_non_module(code)


def _fix_threejs_non_module(code: str) -> str:
    """Rescue Three.js loaded as a classic ``<script src>`` with a global ``THREE``.

    Three.js r150+ ships ES modules only: a plain ``<script src=three.min.js>``
    exposes no global, and after the URL rewrite above it would be a deferred
    module the classic game script cannot see. The tag is removed and the
    import merged into the first inline script that uses ``THREE``, which
    becomes a module; without such a script a standalone module sets
    ``window.THREE`` before ``</head>``.
    """
    three_cdn = AVAILABLE_LIBRARIES["three"]["cdn"]
    three_src_re = re.compile(
        r"""<script\b(?![^>]*type\s*=\s*["']module["'])[^>]*\bsrc\s*=\s*["']"""
        r"""([^"']*(?:three|THREE)[^"']*\.js[^"']*)["'][^>]*>\s*</script>""",
        re.IGNORECASE,
    )
    m = three_src_re.search(code)
    if not m:
        return code
    code = code[: m.start()] + code[m.end():]
    inline_re = re.compile(
        r"""(<script\b(?![^>]*\bsrc\s*=)(?![^>]*type\s*=\s*["']module["'])[^>]*>)(.*?)(</script>)""",
        re.IGNORECASE | re.DOTALL,
    )
    converted = False

    def _to_module(match: re.Match[str]) -> str:
        nonlocal converted
        if converted or not re.search(r"\bTHREE\b", match.group(2)):
            return match.group(0)
        converted = True
        log.info("Three.js fix: merged the CDN import into the game script as an ES module")
        return f"<script type=\"module\">\nimport * as THREE from '{three_cdn}';\n{match.group(2)}{match.group(3)}"

    code = inline_re.sub(_to_module, code)
    if not converted:
        fallback = (f"<script type=\"module\">\nimport * as THREE from '{three_cdn}';\n"
                    "window.THREE = THREE;\n</script>\n")
        pos = code.find("</head>")
        code = code[:pos] + fallback + code[pos:] if pos >= 0 else fallback + code
        log.info("Three.js fix: added a standalone module import")
    return code


def _head(url: str, timeout: float) -> int:
    import ssl
    import urllib.request

    try:
        import certifi
        ssl_ctx = ssl.create_default_context()
        ssl_ctx.load_verify_locations(certifi.where())
    except ImportError:  # pragma: no cover
        ssl_ctx = ssl._create_unverified_context()
    req = urllib.request.Request(url, method="HEAD")
    with urllib.request.urlopen(req, timeout=timeout, context=ssl_ctx) as resp:
        return resp.status


async def validate_cdn_urls_async(timeout: float = 8.0) -> list[str]:
    """Verify every CDN URL returns HTTP 200 (call at worker startup).

    Returns a list of warning strings for broken URLs (empty = all OK).
    """
    warnings: list[str] = []

    async def _check(key: str, cdn: str) -> None:
        try:
            status = await asyncio.to_thread(_head, cdn, timeout)
        except Exception as e:  # noqa: BLE001 — any network failure is a warning
            msg = f"CDN {key}: {cdn} FAILED ({e})"
            warnings.append(msg)
            log.warning(msg)
            return
        if status != 200:
            msg = f"CDN {key}: {cdn} returned {status}"
            warnings.append(msg)
            log.warning(msg)

    await asyncio.gather(*(
        _check(key, info["cdn"]) for key, info in AVAILABLE_LIBRARIES.items() if info.get("cdn")
    ))
    if not warnings:
        log.info("All CDN URLs verified OK")
    return warnings


__all__ = [
    "AVAILABLE_LIBRARIES",
    "get_library_cdn",
    "get_library_fallback",
    "get_cdn_reference_table",
    "library_prompt_block",
    "normalize_cdn_urls",
    "validate_cdn_urls_async",
]
