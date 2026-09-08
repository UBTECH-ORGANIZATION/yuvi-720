"""HTML extraction and ```meta``` block handling.

Ported from vibe-coding-kids ``src/backend/agent/html_utils.py``
(``_extract_code``, ``_strip_meta_blocks``, ``_is_only_meta_block``).
The four extraction strategies, the "large unclosed block beats a small
complete one by 3x" rule and the auto-appended ``</html>`` are kept verbatim.
"""
from __future__ import annotations

import json
import logging
import re
from typing import Any, Optional

log = logging.getLogger("game_gen.html_utils")

_HTML_FENCE_SPLIT = re.compile(r"```html\s*\n?", re.IGNORECASE)
_DOCTYPE_RE = re.compile(r"<!DOCTYPE\s+html", re.IGNORECASE)
_GENERIC_FENCE_RE = re.compile(r"```\s*([\s\S]*?)\s*```")
_META_BLOCK_RE = re.compile(r"```meta\s*([\s\S]*?)```", re.IGNORECASE)


def _looks_like_html(code: str) -> bool:
    return "<!DOCTYPE" in code or "<html" in code


def extract_html(response_text: str) -> Optional[str]:
    """Extract an HTML document from a model response.

    When the model auto-continues after a token limit the response may hold
    several ```html blocks — the first truncated, the second complete.  We
    prefer the *longest complete* block (one that contains ``</html>``).

    Strategy:
      1. Split on ```html fences; prefer the longest closed block, unless an
         unclosed block is more than 3x larger (a small closed block is then a
         continuation stub) — in that case take the big one and append </html>.
      2. Raw ``<!DOCTYPE html>`` documents outside any fence.
      3. Any generic ``` fence that contains an html document.
      4. Last resort: first ``<!DOCTYPE`` to last ``</html>``.

    Returns ``None`` when nothing HTML-like is found.
    """
    text = response_text or ""

    # ── Strategy 1: ```html fences ──
    parts = _HTML_FENCE_SPLIT.split(text)
    candidates: list[str] = []
    for part in parts[1:]:  # text before the first fence is prose
        end_marker = part.find("```")
        code = part[:end_marker].strip() if end_marker > 0 else part.strip()
        if code and _looks_like_html(code):
            candidates.append(code)

    if candidates:
        complete = [c for c in candidates if "</html>" in c.lower()]
        incomplete = [c for c in candidates if "</html>" not in c.lower()]

        if complete and incomplete:
            best_complete = max(complete, key=len)
            best_incomplete = max(incomplete, key=len)
            if len(best_incomplete) > len(best_complete) * 3:
                log.info(
                    "extract_html: picked large unclosed block (%d chars) over small "
                    "complete one (%d chars); auto-closed </html>",
                    len(best_incomplete), len(best_complete),
                )
                return best_incomplete.rstrip() + "\n</html>"

        if complete:
            chosen = max(complete, key=len)
            log.debug("extract_html: picked complete block (%d chars) from %d candidate(s)",
                      len(chosen), len(candidates))
            return chosen

        chosen = max(candidates, key=len)
        log.warning("extract_html: no complete block, using longest partial (%d chars)", len(chosen))
        return chosen

    # ── Strategy 2: raw <!DOCTYPE html> documents in the text ──
    doc_starts = [m.start() for m in _DOCTYPE_RE.finditer(text)]
    if doc_starts:
        complete_docs: list[str] = []
        partial_docs: list[str] = []
        for i, start in enumerate(doc_starts):
            boundary = doc_starts[i + 1] if i + 1 < len(doc_starts) else len(text)
            segment = text[start:boundary]
            end_pos = segment.lower().rfind("</html>")
            if end_pos >= 0:
                complete_docs.append(segment[: end_pos + len("</html>")].strip())
            else:
                partial_docs.append(segment.strip())
        if complete_docs:
            chosen = max(complete_docs, key=len)
            log.debug("extract_html: %d raw complete doc(s), picked longest (%d chars)",
                      len(complete_docs), len(chosen))
            return chosen
        if partial_docs:
            chosen = max(partial_docs, key=len)
            log.warning("extract_html: no complete raw doc, using longest partial (%d chars)", len(chosen))
            return chosen

    # ── Strategy 3: generic code fence ──
    match = _GENERIC_FENCE_RE.search(text)
    if match:
        code = match.group(1).strip()
        if _looks_like_html(code):
            return code

    # ── Strategy 4: first <!DOCTYPE to last </html> ──
    if "<!DOCTYPE" in text and "</html>" in text:
        start = text.index("<!DOCTYPE")
        end = text.rindex("</html>") + len("</html>")
        return text[start:end].strip()

    return None


def strip_meta_block(text: str) -> tuple[str, Optional[dict[str, Any]]]:
    """Remove ```meta ... ``` blocks and parse the (JSON) body of the last one.

    The model appends a ```meta``` block such as
    ``{"added": [...], "suggestions": [...]}`` after the HTML.  It must never
    leak to users, so it is cut out of the text; the parsed dict (or ``None``
    when absent / unparsable) is returned alongside the cleaned text.
    """
    meta: Optional[dict[str, Any]] = None

    def _consume(m: re.Match[str]) -> str:
        nonlocal meta
        body = m.group(1).strip()
        if body:
            try:
                parsed = json.loads(body)
            except ValueError:
                log.warning("strip_meta_block: unparsable meta body (%d chars)", len(body))
            else:
                if isinstance(parsed, dict):
                    meta = parsed  # last block wins
        return ""

    clean = _META_BLOCK_RE.sub(_consume, text or "").strip()
    return clean, meta


def is_only_meta_block(text: str) -> bool:
    """True when the response is exclusively a ```meta``` block with no real content."""
    clean, _ = strip_meta_block(text)
    return len(clean) < 10


__all__ = ["extract_html", "strip_meta_block", "is_only_meta_block"]
