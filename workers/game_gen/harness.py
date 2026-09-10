"""Serve-time harness injection.

The model never writes storage, scaling, error-reporting or learning-bridge
code: those four scripts live here and are prepended to every game, both when
the Yuvi app serves it and when the headless validator runs it.

Order matters: storage shim → fit-to-frame → error reporter → learning data →
YuviLearn bridge. Everything is inlined (the sandboxed iframe has no
same-origin access and a strict CSP). No answer key exists anywhere: the
bridge grades the game's own questions locally against ``q.correct``.
"""
from __future__ import annotations

import json
import re
import secrets
from pathlib import Path
from typing import Any

HARNESS_DIR = Path(__file__).parent / "harness"
_HEAD_RE = re.compile(r"<head[^>]*>", re.IGNORECASE)
_HTML_RE = re.compile(r"<html[^>]*>", re.IGNORECASE)


def _read(name: str) -> str:
    return (HARNESS_DIR / name).read_text(encoding="utf-8")


def _script(js: str) -> str:
    return "<script>\n" + js.replace("</script", "<\\/script") + "\n</script>"


def _json_script(var: str, payload: Any) -> str:
    blob = json.dumps(payload, ensure_ascii=False).replace("</", "<\\/")
    return f"<script>window.{var} = {blob};</script>"


def build_harness(learn_data: dict[str, Any], *, nonce: str | None = None) -> str:
    """Return the HTML fragment to place at the top of ``<head>``.

    ``learn_data`` is ``ContextPack.to_learn_data()``:
    ``{component: {id, title}, objective: {id, title}, language}``.
    """
    parts = [
        _json_script("__YUVI_NONCE", nonce or secrets.token_hex(8)),
        _script(_read("storage_shim.js")),
        _script(_read("fit_to_frame.js")),
        _script(_read("error_reporter.js")),
        _json_script("__YUVI_LEARN_DATA", learn_data),
        _script(_read("yuvi_learn.js")),
    ]
    return "\n".join(parts)


def inject_harness(html: str, harness_fragment: str) -> str:
    """Prepend the harness inside <head> (creating one if the model forgot)."""
    m = _HEAD_RE.search(html)
    if m:
        return html[: m.end()] + "\n" + harness_fragment + "\n" + html[m.end():]
    m = _HTML_RE.search(html)
    if m:
        return html[: m.end()] + "\n<head>" + harness_fragment + "</head>\n" + html[m.end():]
    return "<!DOCTYPE html><html><head>" + harness_fragment + "</head><body>" + html + "</body></html>"
