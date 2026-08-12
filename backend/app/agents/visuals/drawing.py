"""Freehand drawings — the escape hatch that removes the vocabulary ceiling.

Props (`visuals.shapes`) are correct-by-construction but finite: a balance, a
balloon, a vessel. The moment a lesson needs a bicycle pump, a microscope, a
leaf or a pulley, a fixed catalogue has nothing to offer and the planner falls
back to words in boxes — the exact failure props were built to end, one topic
further out.

A `drawing` is a list of SVG path strokes. That is enough to express any shape,
and it is still DATA: the planner never emits code, so the safety boundary is
where it has always been. Two properties make it usable rather than merely
possible:

**The planner draws in its own coordinates and we place the result.** Strokes
are authored in any convenient local space and fitted to `size` / `center` by
`visuals.shapes.build_drawing`. A drawing therefore cannot land off-canvas,
cannot be the wrong scale, and cannot drift relative to its own parts — the
three ways free coordinates go wrong. The planner is asked for shape, which
models are good at, and never for layout, which they are not.

**Every stroke is validated before it reaches a renderer.** This module is that
gate: the `d` grammar is checked against a strict allow-list, parsed, and
bounded by segment count. A string that is not a path produces no drawing rather
than a broken one.
"""

from __future__ import annotations

import math
import re
from typing import Any, Optional

# SVG path data: command letters plus numbers. Anything else — a url(), an
# entity, a semicolon, a letter outside the command set — means this is not a
# path, and we do not try to salvage it.
_PATH_GRAMMAR = re.compile(r"^[MmLlHhVvCcSsQqTtAaZz0-9eE+\-.,\s]+$")
_COMMAND = re.compile(r"[MmLlHhVvCcSsQqTtAaZz]")

MAX_STROKES = 12
MAX_PATH_CHARS = 1400
MAX_COMMANDS = 160


def clean_path(value: object) -> Optional[str]:
    """A path string that is safe to parse, or None.

    Rejects rather than repairs. A half-understood path renders as a shape the
    planner did not intend, which is worse than no drawing at all: the learner
    cannot tell a wrong picture from a right one.
    """
    if not isinstance(value, str):
        return None
    text = value.strip()
    if not (1 < len(text) <= MAX_PATH_CHARS):
        return None
    if not _PATH_GRAMMAR.match(text):
        return None
    # Must start with an absolute or relative moveto; a path that starts mid-way
    # has an undefined origin and svgelements will interpret it unpredictably.
    if text[0] not in "Mm":
        return None
    commands = _COMMAND.findall(text)
    if not (1 <= len(commands) <= MAX_COMMANDS):
        return None
    return text


def clean_drawing(candidate: dict, *, colors, short_text, text_filter) -> Optional[dict]:
    """Validate one `drawing` element, or None if nothing usable survives.

    Two authoring forms are accepted. `parts` is the preferred one — named
    parametric shapes that cannot come out malformed — and `strokes` is the raw
    path escape hatch for objects the vocabulary has no part for. A drawing may
    use either; parts win when both are present, because they are the form we
    can make guarantees about.
    """
    clean: dict[str, Any] = {}
    parts = _clean_parts(candidate.get("parts"), colors)
    if parts:
        clean["parts"] = parts
    else:
        strokes = _clean_strokes(candidate.get("strokes"), colors)
        if not strokes:
            return None
        clean["strokes"] = strokes

    label = short_text(candidate.get("label"), text_filter)
    if label:
        clean["label"] = label
    # The noun this object depicts. It is what makes a drawing cacheable, and
    # what a review pass needs in order to promote a good one into the prop
    # catalogue rather than redrawing it forever.
    name = short_text(candidate.get("object"), text_filter)
    if name:
        clean["object"] = name
    return clean


def _clean_parts(raw: object, colors) -> list[dict]:
    """Keep the parts the sketch vocabulary knows, with bounded numbers."""
    from app.agents.visuals.sketch import MAX_PARTS, SHAPE_KINDS

    if not isinstance(raw, list):
        return []
    parts: list[dict] = []
    for item in raw[:MAX_PARTS]:
        if not isinstance(item, dict):
            continue
        shape = str(item.get("shape") or "").strip().lower()
        if shape not in SHAPE_KINDS:
            continue
        part: dict[str, Any] = {"shape": shape}
        at = item.get("at")
        if isinstance(at, list) and len(at) >= 2:
            point = [_finite(at[0]), _finite(at[1])]
            if None not in point:
                part["at"] = point
        for key in ("w", "h", "r", "lobes", "peaks", "count", "cycles", "amp",
                    "bend", "taper", "angle", "seed", "jagged", "inner",
                    "fill_opacity", "repeat"):
            value = _finite(item.get(key))
            if value is not None:
                part[key] = value
        step = item.get("step")
        if isinstance(step, list) and len(step) >= 2:
            offset = [_finite(step[0]), _finite(step[1])]
            if None not in offset:
                part["step"] = offset
        if item.get("color") in colors:
            part["color"] = item["color"]
        parts.append(part)
    return parts


def _finite(value: object) -> Optional[float]:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    number = float(value)
    return number if math.isfinite(number) else None


def _clean_strokes(raw: object, colors) -> list[dict]:
    if not isinstance(raw, list):
        return []
    strokes: list[dict] = []
    for item in raw[:MAX_STROKES]:
        if not isinstance(item, dict):
            continue
        path = clean_path(item.get("d"))
        if path is None:
            continue
        stroke: dict[str, Any] = {"d": path}
        color = item.get("color")
        if color in colors:
            stroke["color"] = color
        fill = item.get("fill_opacity")
        if isinstance(fill, (int, float)) and not isinstance(fill, bool):
            stroke["fill_opacity"] = max(0.0, min(0.85, float(fill)))
        width = item.get("stroke_width")
        if isinstance(width, (int, float)) and not isinstance(width, bool):
            stroke["stroke_width"] = max(0.0, min(10.0, float(width)))
        strokes.append(stroke)
    return strokes
