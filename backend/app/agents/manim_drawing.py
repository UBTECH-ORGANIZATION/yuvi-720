"""Freehand drawings — the escape hatch that removes the vocabulary ceiling.

Props (`manim_props`) are correct-by-construction but finite: a balance, a
balloon, a vessel. The moment a lesson needs a bicycle pump, a microscope, a
leaf or a pulley, a fixed catalogue has nothing to offer and the planner falls
back to words in boxes — the exact failure props were built to end, one topic
further out.

A `drawing` is a list of SVG path strokes. That is enough to express any shape,
and it is still DATA: the planner never emits code, so the safety boundary is
where it has always been. Two properties make it usable rather than merely
possible:

**The planner draws in its own coordinates and we place the result.** Strokes
are authored in any convenient local space; the union of their bounding boxes is
then fitted to `size` and centred on `center`. A drawing therefore cannot land
off-canvas, cannot be the wrong scale, and cannot drift relative to its own
parts — the three ways free coordinates go wrong. The planner is asked for
shape, which models are good at, and never for layout, which they are not.

**Every stroke is validated before it reaches a renderer.** The `d` grammar is
checked against a strict allow-list, parsed, and bounded by segment count. A
string that is not a path produces no drawing rather than a broken one.
"""

from __future__ import annotations

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
    """Validate one `drawing` element, or None if nothing usable survives."""
    raw_strokes = candidate.get("strokes")
    if not isinstance(raw_strokes, list):
        return None
    strokes: list[dict] = []
    for raw in raw_strokes[:MAX_STROKES]:
        if not isinstance(raw, dict):
            continue
        path = clean_path(raw.get("d"))
        if path is None:
            continue
        stroke: dict[str, Any] = {"d": path}
        color = raw.get("color")
        if color in colors:
            stroke["color"] = color
        fill = raw.get("fill_opacity")
        if isinstance(fill, (int, float)) and not isinstance(fill, bool):
            stroke["fill_opacity"] = max(0.0, min(0.85, float(fill)))
        width = raw.get("stroke_width")
        if isinstance(width, (int, float)) and not isinstance(width, bool):
            stroke["stroke_width"] = max(0.0, min(10.0, float(width)))
        strokes.append(stroke)
    if not strokes:
        return None

    clean: dict[str, Any] = {"strokes": strokes}
    label = short_text(candidate.get("label"), text_filter)
    if label:
        clean["label"] = label
    return clean


def build_drawing(
    spec: dict,
    *,
    manim: Any,
    color_for,
    to_scene,
    unit: float,
) -> tuple[list, dict[str, Any]]:
    """Assemble the strokes, fit them to `size`, and centre them on `center`.

    Fitting is what makes freehand drawing safe to hand to a planner. The
    strokes arrive in whatever coordinate space the model found convenient —
    0..100, -1..1, pixel-ish hundreds — and all of them come out the same size
    in the same place.
    """
    import svgelements

    center = spec.get("center") or [0.0, 0.0]
    size = max(0.2, min(float(spec.get("size") or 1.5), 5.0))

    shapes: list = []
    for stroke in spec.get("strokes") or []:
        try:
            parsed = svgelements.Path(stroke["d"])
            mobject = manim.VMobjectFromSVGPath(parsed)
        except Exception:
            # One unparseable stroke must not lose the whole drawing: the rest
            # of the object is still a truthful picture of itself.
            continue
        if not mobject.has_points():
            continue
        color = color_for(stroke.get("color") or "ink")
        mobject.set_stroke(color=color, width=stroke.get("stroke_width", 4.5))
        mobject.set_fill(color=color, opacity=stroke.get("fill_opacity", 0.0))
        shapes.append(mobject)
    if not shapes:
        return [], {}

    group = manim.VGroup(*shapes)
    # SVG's y axis points down; Manim's points up. Without the flip every
    # drawing arrives upside down — and a planner that "fixes" it by negating
    # its own y values produces a path that is wrong everywhere else.
    group.flip(manim.RIGHT)
    height = group.height or 1.0
    width = group.width or 1.0
    group.scale(size * unit / max(width, height))
    group.move_to(to_scene(center))
    _keep_on_canvas(group, manim)

    # The GROUP is returned alongside the anchor directions so the caller can
    # place labels with `next_to`. A point anchor is not enough: Hebrew is
    # right-to-left, so a label centred on the right-hand anchor grows leftward
    # back across the object it is naming — which is how "כלורופלסטים" ended
    # up printed over the cell. `next_to` aligns by EDGE and is direction-safe.
    return list(shapes), {
        "group": group,
        "directions": {
            "top": manim.UP, "bottom": manim.DOWN,
            "left": manim.LEFT, "right": manim.RIGHT,
        },
    }


# Manim's default frame is 14.22 x 8 units. Leave a margin so a drawing does not
# graze the edge, which reads as clipped even when it technically is not.
_HALF_WIDTH = 6.6
_HALF_HEIGHT = 3.5


def _keep_on_canvas(group: Any, manim: Any) -> None:
    """Shrink and nudge a drawing until it is fully visible.

    The planner picks `center` and `size` blind — it has no bounding box for a
    shape it has just invented, so it cannot know that a sun at [-6, 3] with
    size 2.4 hangs off the corner. Half a sun is not a sun; it reads as a bug in
    the player. Clamping here is deterministic and costs nothing, and it means
    the planner is never punished for concentrating on shape rather than layout.
    """
    width, height = group.width, group.height
    if width <= 0 or height <= 0:
        return
    # Too large for the frame at all: scale down first, or no amount of nudging
    # will fit it.
    shrink = min(1.0, (2 * _HALF_WIDTH) / width, (2 * _HALF_HEIGHT) / height)
    if shrink < 1.0:
        group.scale(shrink)

    left, right = group.get_left()[0], group.get_right()[0]
    bottom, top = group.get_bottom()[1], group.get_top()[1]
    dx = max(0.0, -_HALF_WIDTH - left) - max(0.0, right - _HALF_WIDTH)
    dy = max(0.0, -_HALF_HEIGHT - bottom) - max(0.0, top - _HALF_HEIGHT)
    if dx or dy:
        group.shift(manim.RIGHT * dx + manim.UP * dy)
