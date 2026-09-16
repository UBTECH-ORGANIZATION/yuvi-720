"""Post-processing fixes for generated HTML.

Ported from vibe-coding-kids ``src/backend/agent/code_utils.py``
(``_validate_and_fix_code``, ``_ensure_module_type_on_imports``).  The
kid-friendly error mapping and the favicon injection were not ported.
"""
from __future__ import annotations

import logging
import re

from game_gen.libraries import normalize_cdn_urls

log = logging.getLogger("game_gen.code_utils")

_ARC_RADIUS_RE = re.compile(r"\.arc\(([^,]+),\s*([^,]+),\s*(?!Math\.max\(0)([\w.]+)\s*,")
_INLINE_SCRIPT_RE = re.compile(r"(<script(?![^>]*\bsrc=)[^>]*>)(.*?)</script>", re.DOTALL)
_MODULE_SRC_RE = re.compile(r"""<script(?![^>]*type=)([^>]*src=["'][^"']*\.module\.[^"']*["'][^>]*)>""")


def validate_and_fix_code(html: str) -> str:
    """Apply the proven post-processing fixes to a generated HTML document.

    * ensure ``<!DOCTYPE html>``, ``lang`` on ``<html>``, charset + viewport metas
    * guard ``ctx.arc`` radius with ``Math.max(0, r)`` (negative radius throws)
    * ``webkitAudioContext`` fallback
    * cheap JS syntax cleanups (``;;``, ``{;``, ``,;``, ``}  ;``)
    * normalise CDN URLs to the verified list
    * add ``type="module"`` to scripts that use ``import``
    """
    if not html:
        return html
    code = html

    if "<!DOCTYPE" not in code and "<html" in code:
        code = "<!DOCTYPE html>\n" + code

    # Only lang, never dir="rtl": RTL flips layout and breaks arrow keys / coordinates.
    if "<html" in code and "lang=" not in code.split("</head>")[0]:
        code = code.replace("<html", '<html lang="he"', 1)

    if "<head>" in code and "charset" not in code:
        code = code.replace("<head>", '<head>\n  <meta charset="UTF-8">', 1)

    if "<head>" in code and "viewport" not in code:
        code = code.replace(
            "<head>",
            '<head>\n  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
            1,
        )

    code = _ARC_RADIUS_RE.sub(r".arc(\1, \2, Math.max(0, \3),", code)

    if "AudioContext" in code and "webkitAudioContext" not in code:
        code = code.replace(
            "new AudioContext()",
            "new (window.AudioContext || window.webkitAudioContext)()",
        )

    # ── Common syntax slips that cause SyntaxError ──
    code = re.sub(r";;+", ";", code)          # ";;" -> ";"
    code = re.sub(r"\{\s*;", "{", code)       # "{;" -> "{"
    code = re.sub(r",\s*;", ";", code)        # ",;" -> ";"
    code = re.sub(r"\}\s{2,};", "}", code)    # "}  ;" -> "}" (but "};" stays)

    code = normalize_cdn_urls(code)
    code = ensure_module_type_on_imports(code)
    return code


def ensure_module_type_on_imports(code: str) -> str:
    """Give ``type="module"`` to scripts that use ES ``import`` syntax.

    A plain ``<script>`` with ``import ... from`` throws
    "Cannot use import statement outside a module".
    """

    def _fix_script_tag(m: re.Match[str]) -> str:
        tag, body = m.group(0), m.group(2)
        if 'type="module"' in tag or "type='module'" in tag:
            return tag
        if re.search(r"\bimport\s+", body):
            log.info('Auto-fix: added type="module" to <script> with import statements')
            return tag.replace("<script", '<script type="module"', 1)
        return tag

    code = _INLINE_SCRIPT_RE.sub(_fix_script_tag, code)
    code = _MODULE_SRC_RE.sub(r'<script type="module"\1>', code)
    return code


__all__ = ["validate_and_fix_code", "ensure_module_type_on_imports"]
