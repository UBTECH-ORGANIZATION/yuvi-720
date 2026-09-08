"""Patch engine — line-based ops with a legacy SEARCH/REPLACE fallback.

Ported from vibe-coding-kids ``src/backend/agent/patch_engine.py``.

Formats understood (from the model's response text):

1. LINE-BASED (preferred; the model sees ``number_lines(html)``)::

     REPLACE_LINES 10-15
     new code
     END_REPLACE

     INSERT_AFTER 20
     new code
     END_INSERT

     DELETE_LINES 5-8

2. SEARCH/REPLACE (legacy)::

     <<<<<<< SEARCH
     exact code to find
     =======
     replacement
     >>>>>>> REPLACE

All-or-nothing: if any hunk fails, nothing is applied and the caller should
fall back to a full rewrite.  Every accepted patch also passes
``_check_js_structural_integrity`` (brace balance, lost functions, script tags).
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import Optional

log = logging.getLogger("game_gen.patch_engine")

# 99% of games are 600-3000 lines; line patches work well up to ~5000.
FULL_REWRITE_LINE_THRESHOLD = 5000

_LINE_REPLACE_PATTERN = re.compile(r"REPLACE_LINES\s+(\d+)\s*-\s*(\d+)\s*\n(.*?)\nEND_REPLACE", re.DOTALL)
_LINE_INSERT_PATTERN = re.compile(r"INSERT_AFTER\s+(\d+)\s*\n(.*?)\nEND_INSERT", re.DOTALL)
_LINE_DELETE_PATTERN = re.compile(r"DELETE_LINES\s+(\d+)\s*-\s*(\d+)")
_SEARCH_REPLACE_PATTERN = re.compile(r"<<<<<<< SEARCH\n(.*?)\n=======\n(.*?)\n>>>>>>> REPLACE", re.DOTALL)


@dataclass
class PatchResult:
    """Outcome of ``apply_patches``: ``html`` is None when nothing was applied."""

    html: Optional[str]
    applied: int
    error: Optional[str]

    @property
    def ok(self) -> bool:
        return self.html is not None and self.error is None


def number_lines(html: str) -> str:
    """Prefix every line with its 1-based number: ``'  42| line'``."""
    lines = html.split("\n")
    width = len(str(len(lines)))
    return "\n".join(f"{i:>{width}}| {line}" for i, line in enumerate(lines, 1))


def is_large_file(html: str) -> bool:
    """True when the document exceeds ``FULL_REWRITE_LINE_THRESHOLD`` lines."""
    return html.count("\n") + 1 > FULL_REWRITE_LINE_THRESHOLD


# ── Structural integrity ─────────────────────────────────────────────────────

def _check_js_structural_integrity(original: str, patched: str) -> list[str]:
    """Return issue descriptions when patching broke JS structure (empty = OK).

    1. Brace balance inside each ``<script>`` block (string literals stripped)
    2. Function declarations that existed before and vanished
    3. ``<script`` / ``</script>`` count mismatch
    """
    issues: list[str] = []

    patched_blocks = re.findall(r"<script[^>]*>(.*?)</script>", patched, re.DOTALL | re.IGNORECASE)
    for i, block in enumerate(patched_blocks):
        cleaned = re.sub(r'"[^"]*"|' + r"'[^']*'" + r"|`[^`]*`", "", block)
        opens, closes = cleaned.count("{"), cleaned.count("}")
        if opens != closes:
            issues.append(
                f"Brace mismatch in <script> block {i + 1}: "
                f"{opens} '{{' vs {closes} '}}' (delta {opens - closes:+d})"
            )

    orig_funcs = set(re.findall(r"function\s+(\w+)\s*\(", original))
    patched_funcs = set(re.findall(r"function\s+(\w+)\s*\(", patched))
    lost = orig_funcs - patched_funcs
    if lost:
        issues.append(f"Lost function declarations: {', '.join(sorted(lost))}")

    opens = len(re.findall(r"<script", patched, re.IGNORECASE))
    closes = len(re.findall(r"</script>", patched, re.IGNORECASE))
    if opens != closes:
        issues.append(f"Script tag mismatch: {opens} <script> vs {closes} </script>")

    return issues


def _post_checks(original: str, result: str) -> Optional[str]:
    """Shared HTML-shape + structural checks; returns an error string or None."""
    if "<!DOCTYPE" not in result and "<html" not in result:
        return "patched code lost HTML structure"
    issues = _check_js_structural_integrity(original, result)
    if issues:
        return "structural issues: " + "; ".join(issues)
    return None


# ── Line-based patches ───────────────────────────────────────────────────────

def extract_line_patches(text: str) -> list[dict]:
    """Parse REPLACE_LINES / INSERT_AFTER / DELETE_LINES ops in response order.

    Each op: ``{"type": "replace"|"insert"|"delete", "start": int, "end": int, "code": str}``.
    """
    ops: list[dict] = []
    replace_spans = [(m.start(), m.end()) for m in _LINE_REPLACE_PATTERN.finditer(text)]

    for m in _LINE_REPLACE_PATTERN.finditer(text):
        ops.append({"type": "replace", "start": int(m.group(1)), "end": int(m.group(2)),
                    "code": m.group(3), "_pos": m.start()})
    for m in _LINE_INSERT_PATTERN.finditer(text):
        ops.append({"type": "insert", "start": int(m.group(1)), "end": int(m.group(1)),
                    "code": m.group(2), "_pos": m.start()})
    for m in _LINE_DELETE_PATTERN.finditer(text):
        # A DELETE_LINES inside a REPLACE block's payload is content, not an op.
        if any(s < m.start() < e for s, e in replace_spans):
            continue
        ops.append({"type": "delete", "start": int(m.group(1)), "end": int(m.group(2)),
                    "code": "", "_pos": m.start()})

    ops.sort(key=lambda o: o["_pos"])
    for op in ops:
        op.pop("_pos", None)
    return ops


def apply_line_patches(code: str, ops: list[dict]) -> tuple[str, Optional[str]]:
    """Apply line ops all-or-nothing. Returns ``(patched, None)`` or ``(original, error)``."""
    if not ops:
        return code, "no line patches"

    lines = code.split("\n")
    total = len(lines)

    for i, op in enumerate(ops):
        start, end = op["start"], op["end"]
        label = f"line patch {i + 1} ({op['type']} {start}-{end})"
        if start < 1 or end < 1:
            return code, f"{label}: invalid line numbers"
        if op["type"] in ("replace", "delete") and start > end:
            return code, f"{label}: start > end"
        if op["type"] in ("replace", "delete") and end > total:
            return code, f"{label}: end > total lines ({total})"
        if op["type"] == "insert" and start > total:
            return code, f"{label}: insert after line {start} > total lines ({total})"

    # Boundary guard: aggregate brace-depth change across all hunks must be zero.
    aggregate_delta = 0
    for i, op in enumerate(ops):
        if op["type"] not in ("replace", "delete"):
            continue
        removed = "\n".join(lines[op["start"] - 1: op["end"]])
        new = op.get("code", "")
        delta = (new.count("{") - new.count("}")) - (removed.count("{") - removed.count("}"))
        if delta:
            log.debug("line patch %d (%s %d-%d): brace depth change %+d",
                      i + 1, op["type"], op["start"], op["end"], delta)
        aggregate_delta += delta
    if aggregate_delta != 0:
        return code, f"aggregate brace depth change {aggregate_delta:+d}"

    # Apply bottom-up so earlier line numbers stay valid.
    for op in sorted(ops, key=lambda o: o["start"], reverse=True):
        start_idx, end_idx = op["start"] - 1, op["end"]
        if op["type"] == "replace":
            new_lines = op["code"].split("\n") if op["code"] else []
            lines[start_idx:end_idx] = new_lines
            log.debug("REPLACE lines %d-%d (%d -> %d lines)", op["start"], op["end"],
                      end_idx - start_idx, len(new_lines))
        elif op["type"] == "insert":
            new_lines = op["code"].split("\n") if op["code"] else []
            lines[end_idx:end_idx] = new_lines
            log.debug("INSERT %d lines after line %d", len(new_lines), op["start"])
        elif op["type"] == "delete":
            lines[start_idx:end_idx] = []
            log.debug("DELETE lines %d-%d", op["start"], op["end"])

    result = "\n".join(lines)
    err = _post_checks(code, result)
    if err:
        return code, err
    log.info("Applied %d line-based patch(es)", len(ops))
    return result, None


# ── Legacy SEARCH/REPLACE ────────────────────────────────────────────────────

def extract_search_replace_patches(text: str) -> list[dict[str, str]]:
    """Parse ``<<<<<<< SEARCH ... ======= ... >>>>>>> REPLACE`` blocks."""
    patches: list[dict[str, str]] = []
    for m in _SEARCH_REPLACE_PATTERN.finditer(text):
        if not m.group(1).strip():
            continue  # empty search would match everything
        patches.append({"search": m.group(1), "replace": m.group(2)})
    return patches


def _normalize_whitespace(s: str) -> str:
    return "\n".join(re.sub(r"[ \t]+", " ", line).strip() for line in s.split("\n"))


def _find_fuzzy_line_match(result_lines: list[str], search_lines: list[str]) -> int:
    """Best starting index where >=90% of (trimmed) search lines match, else -1."""
    norm_search = [re.sub(r"[ \t]+", " ", l).strip() for l in search_lines]
    norm_result = [re.sub(r"[ \t]+", " ", l).strip() for l in result_lines]

    first = 0
    while first < len(norm_search) and not norm_search[first]:
        first += 1
    last = len(norm_search) - 1
    while last >= 0 and not norm_search[last]:
        last -= 1
    if first > last:
        return -1

    trimmed = norm_search[first:last + 1]
    n = len(trimmed)
    best_idx, best_score = -1, 0
    for start in range(len(norm_result) - n + 1):
        score = sum(1 for j, s in enumerate(trimmed) if norm_result[start + j] == s)
        if score > best_score and score >= max(1, int(n * 0.9)):
            best_score, best_idx = score, start - first
    return best_idx


def apply_search_replace_patches(code: str, patches: list[dict[str, str]]) -> tuple[str, Optional[str]]:
    """Apply SEARCH/REPLACE hunks all-or-nothing (exact, whitespace-normalised, then fuzzy)."""
    if not patches:
        return code, "no patches"

    result = code
    failed: list[str] = []

    for i, patch in enumerate(patches):
        search, replace = patch["search"], patch["replace"]

        if search in result:
            result = result.replace(search, replace, 1)
            continue

        norm_result = _normalize_whitespace(result)
        norm_search = _normalize_whitespace(search)
        if norm_search in norm_result:
            idx = norm_result.index(norm_search)
            orig_lines = result.split("\n")
            norm_lines = norm_result.split("\n")
            search_lines = norm_search.split("\n")
            start_line = norm_result[:idx].count("\n")
            end_line = start_line + len(search_lines)
            if end_line <= len(orig_lines) and all(
                start_line + j < len(norm_lines) and norm_lines[start_line + j] == s
                for j, s in enumerate(search_lines)
            ):
                before = "\n".join(orig_lines[:start_line])
                after = "\n".join(orig_lines[end_line:])
                result = "\n".join(p for p in (before, replace, after) if p)
                continue

        result_lines = result.split("\n")
        search_lines_raw = search.split("\n")
        match_start = _find_fuzzy_line_match(result_lines, search_lines_raw)
        if match_start >= 0:
            end_line = match_start + len(search_lines_raw)
            if end_line <= len(result_lines):
                before = "\n".join(result_lines[:match_start])
                after = "\n".join(result_lines[end_line:])
                result = "\n".join(p for p in (before, replace, after) if p)
                log.debug("patch %d: fuzzy line match at L%d", i + 1, match_start + 1)
                continue

        failed.append(f"patch {i + 1}/{len(patches)} ({len(search)} chars) {search[:80]!r}")

    if failed:
        log.info("ALL-OR-NOTHING: %d/%d SEARCH/REPLACE patches failed", len(failed), len(patches))
        return code, "unmatched hunks: " + "; ".join(failed)

    err = _post_checks(code, result)
    if err:
        return code, err
    log.info("Applied %d SEARCH/REPLACE patch(es)", len(patches))
    return result, None


# ── Public entry point ───────────────────────────────────────────────────────

def apply_patches(current_html: str, response_text: str) -> PatchResult:
    """Apply the patches found in ``response_text`` to ``current_html``.

    Line-based ops win when present; otherwise the legacy SEARCH/REPLACE
    format is tried.  All-or-nothing: on any failure ``html`` is None and
    ``error`` says why so the caller can fall back to a full rewrite.
    """
    line_ops = extract_line_patches(response_text or "")
    if line_ops:
        patched, err = apply_line_patches(current_html, line_ops)
        if err:
            log.warning("line patches rejected: %s", err)
            return PatchResult(html=None, applied=0, error=err)
        return PatchResult(html=patched, applied=len(line_ops), error=None)

    sr = extract_search_replace_patches(response_text or "")
    if sr:
        patched, err = apply_search_replace_patches(current_html, sr)
        if err:
            log.warning("SEARCH/REPLACE patches rejected: %s", err)
            return PatchResult(html=None, applied=0, error=err)
        return PatchResult(html=patched, applied=len(sr), error=None)

    return PatchResult(html=None, applied=0, error="no patches found in response")


__all__ = [
    "FULL_REWRITE_LINE_THRESHOLD",
    "PatchResult",
    "apply_patches",
    "number_lines",
    "is_large_file",
    "extract_line_patches",
    "apply_line_patches",
    "extract_search_replace_patches",
    "apply_search_replace_patches",
    "_check_js_structural_integrity",
]
