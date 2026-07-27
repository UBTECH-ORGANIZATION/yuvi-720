"""Deterministic label placement for Coach scenes (Phase 1).

The planner is good at deciding *what* a diagram contains and bad at deciding
*where the words go*: it has to guess a 2D coordinate for every label in one
shot, with no feedback, and a guess that reads fine in its head lands on top of
a triangle edge on screen.  Historically the renderer papered over that with a
greedy "push the label straight down until it stops overlapping" pass, which
fixes stacking but cannot choose a *better side*.

This module moves the decision out of the model and out of the renderer.  It
resolves each label to the thing it names (``anchor``), projects the scene into
the same canvas the renderer draws in, and searches candidate positions with a
cost function that knows about geometry, other labels, and the frame edges.
The solved coordinates are attached to the scene, so **Manim video and the
in-browser renderer inherit identical placement** — layout stops being a
per-renderer concern.

Everything here is pure Python: no Manim, no browser, no subprocess.  That is
deliberate — it makes label quality a millisecond unit test (see
``tests/test_visual_layout.py``) instead of something you can only eyeball in a
rendered MP4.

Canvas space is Manim scene units (roughly x -7.1..7.1, y -4..4).  Both of the
renderer's coordinate mappings are reproduced exactly in :class:`CanvasTransform`.
"""

from __future__ import annotations

from dataclasses import dataclass, field
import math
import re
from typing import Iterable, Optional, Sequence


# --- frame -------------------------------------------------------------------

# Manim's default 16:9 frame.  Labels are kept inside a slightly inset box so a
# glyph's bounding box never touches the literal edge of the video.
FRAME_X = 7.1
FRAME_Y = 4.0
SAFE_MARGIN = 0.14

# Mirrors manim_worker's non-axes fit block.  Kept in sync by
# ``test_visual_layout.CanvasTransformTests``.
_FIT_TARGET_X = (-5.35, 5.35)
_FIT_TARGET_X_WITH_FORMULA = (-5.45, 0.35)
_FIT_TARGET_Y = (-2.45, 2.45)
_MAX_FIT_SCALE = 1.7
# A number line's value span is the whole point, so it should stretch to the
# target width. The previous 3.2 cap left a 12..13 line occupying 3.2 of the
# 10.7 available units — legible but pointlessly small. The target-rectangle
# fit is already self-bounding, so the cap only needs to stop absurd
# magnification of a degenerate range.
_MAX_FIT_SCALE_NUMBER_LINE = 12.0

# Mirrors manim_worker's Axes construction.
_AXES_X_LENGTH = 9.5
_AXES_Y_LENGTH = 5.4

# Must stay byte-identical to manim_worker's formula_pattern: it selects both
# the narrowed fit target AND the fixed formula card, so any divergence makes
# the solver reason about a canvas the renderer is not drawing.
_FORMULA_PATTERN = re.compile(
    r"(?:=|\\frac|\\sqrt|\b(?:sin|cos|tan|log)\s*\(|[A-Za-zα-ωΑ-Ωθ]\s*[\^/])",
    re.IGNORECASE,
)
_RTL = re.compile(r"[֐-ࣿ]")

# The renderer parks a formula in a fixed card on the right instead of at its
# planner coordinate (manim_worker, kind == "text" branch). The solver must not
# try to place that label, but every other label must avoid the card.
_FORMULA_CARD_CENTER = (3.35, 0.25)
_FORMULA_CARD_MIN = (3.5, 1.05)


def _is_card_formula(element: dict, has_axes: bool) -> bool:
    return (
        not has_axes
        and element.get("type") == "text"
        and bool(_FORMULA_PATTERN.search(element.get("label", "") or ""))
    )


# --- text metrics ------------------------------------------------------------

# Calibrated against real Manim mobjects rather than guessed. Measured
# ``Text(s, font_size=n).width/.height`` over Latin, digit, Hebrew and Arabic
# samples at sizes 24/26/28:
#
#   height/size  0.0096 plain · 0.0124 with descenders, superscripts or Arabic
#   width/char   0.88×h for a lone capital · 0.50–0.67×h multi-char Latin
#                0.66–0.82×h Hebrew
#
# A first pass used 0.58×h flat and underestimated short labels by ~60%, so two
# adjacent single-letter vertex labels ("C" and "A'") were scored as clear when
# they visibly collided. The floor term is what fixes that: short strings do not
# get to be proportionally narrow. Values sit at the generous end of each range
# on purpose — the solver should err toward whitespace.
#
# Pinned by ``TextExtentTests``; re-measure if the renderer's fonts change.
_UNITS_PER_POINT = 0.0100
_ADVANCE_LATIN = 0.70
_ADVANCE_RTL = 0.80
_MIN_ADVANCE_UNITS = 0.9          # a one-glyph label is never narrower than this
_TALL_MULTIPLIER = 1.28           # descenders / superscripts / Arabic
_TALL = re.compile(r"[gjpqy,()\[\]{}²³⁴₀-₉]|[؀-ۿ]")
DEFAULT_FONT_SIZE = 28


def text_extent(text: str, font_size: float = DEFAULT_FONT_SIZE) -> tuple[float, float]:
    """Estimate a rendered label's (width, height) in canvas units."""
    value = text or ""
    height = max(font_size, 1.0) * _UNITS_PER_POINT
    if _TALL.search(value):
        height *= _TALL_MULTIPLIER
    advance = _ADVANCE_RTL if _RTL.search(value) else _ADVANCE_LATIN
    width = max(len(value) * advance, _MIN_ADVANCE_UNITS) * height
    return width, height


# --- geometry primitives -----------------------------------------------------


@dataclass(frozen=True)
class Box:
    """An axis-aligned box in canvas units, addressed by its centre."""

    cx: float
    cy: float
    w: float
    h: float

    @property
    def left(self) -> float:
        return self.cx - self.w / 2

    @property
    def right(self) -> float:
        return self.cx + self.w / 2

    @property
    def bottom(self) -> float:
        return self.cy - self.h / 2

    @property
    def top(self) -> float:
        return self.cy + self.h / 2

    def overlap(self, other: "Box", pad: float = 0.0) -> float:
        """Area of intersection once both boxes are grown by ``pad``."""
        dx = min(self.right + pad, other.right + pad) - max(self.left - pad, other.left - pad)
        dy = min(self.top + pad, other.top + pad) - max(self.bottom - pad, other.bottom - pad)
        if dx <= 0 or dy <= 0:
            return 0.0
        return dx * dy

    def outside_frame(self) -> float:
        """How far the box pokes out of the safe frame, in units (0 when inside)."""
        limit_x = FRAME_X - SAFE_MARGIN
        limit_y = FRAME_Y - SAFE_MARGIN
        return (
            max(0.0, -(self.left + limit_x))
            + max(0.0, self.right - limit_x)
            + max(0.0, -(self.bottom + limit_y))
            + max(0.0, self.top - limit_y)
        )


Point = tuple[float, float]
Segment = tuple[Point, Point]


def _segment_box_hit(segment: Segment, box: Box, pad: float = 0.0) -> bool:
    """Cheap conservative test: does a segment enter a padded box?

    Samples along the segment rather than doing exact clipping.  The sampling
    density is tied to the box size so a short segment crossing a small label
    still registers.
    """
    (x1, y1), (x2, y2) = segment
    length = math.hypot(x2 - x1, y2 - y1)
    steps = max(2, int(length / max(0.06, min(box.w, box.h) / 2)) + 1)
    for index in range(steps + 1):
        t = index / steps
        px = x1 + (x2 - x1) * t
        py = y1 + (y2 - y1) * t
        if (
            box.left - pad <= px <= box.right + pad
            and box.bottom - pad <= py <= box.top + pad
        ):
            return True
    return False


# --- canvas transform --------------------------------------------------------


@dataclass(frozen=True)
class CanvasTransform:
    """Maps a scene's element coordinates onto renderer canvas units.

    Reproduces both mappings used by ``manim_worker``:

    * **axes scenes** — element coordinates are DATA coordinates and the worker
      draws them through ``Axes.c2p``; the axes box is centred on the axes
      element's ``position``.
    * **plain scenes** — the worker fits the geometry's bounding box into a
      target rectangle with a uniform scale and offset.

    Both are affine, so the transform is a scale plus a translation per axis.
    """

    scale_x: float = 1.0
    scale_y: float = 1.0
    offset_x: float = 0.0
    offset_y: float = 0.0

    def apply(self, point: Sequence[float]) -> Point:
        return (
            point[0] * self.scale_x + self.offset_x,
            point[1] * self.scale_y + self.offset_y,
        )

    def invert(self, point: Sequence[float]) -> Point:
        return (
            (point[0] - self.offset_x) / (self.scale_x or 1.0),
            (point[1] - self.offset_y) / (self.scale_y or 1.0),
        )


_POINT_KINDS = {"polygon", "polyline", "line", "arrow", "point", "angle", "right_angle", "brace"}
_CENTER_KINDS = {"circle", "rectangle", "arc"}


def _geometry_points(elements: Sequence[dict]) -> list[list[float]]:
    """Exactly the coordinates manim_worker feeds into its fit.

    This must mirror the worker's ``geometry_points`` block element-for-element.
    An earlier version also folded in every ``text`` position, which inflated
    the source bounding box, shrank the scale, and put the solver's canvas out
    of step with the renderer's — labels then landed on the geometry they were
    supposed to clear. Pinned by ``CanvasTransformTests``.
    """
    has_number_line = any(item.get("type") == "number_line" for item in elements)
    points: list[list[float]] = []
    for item in elements:
        kind = item.get("type")
        if kind in _POINT_KINDS:
            points.extend(item.get("points", []) or [])
        elif kind in _CENTER_KINDS:
            # Extent, not just the centre. Using the centre alone let a circle
            # of radius 2.2 be "fitted" as a single point: the drawn shape then
            # hung off one side of the frame with dead space on the other.
            cx, cy = float(item["center"][0]), float(item["center"][1])
            if kind == "circle" or kind == "arc":
                r = float(item.get("radius") or 0.0)
                half_w = half_h = r
            else:
                half_w = float(item.get("width") or 0.0) / 2
                half_h = float(item.get("height") or 0.0) / 2
            points.extend([[cx - half_w, cy - half_h], [cx + half_w, cy + half_h]])
        elif kind == "number_line":
            points.append([item["range"][0], item["position"][1]])
            points.append([item["range"][1], item["position"][1]])
        elif kind == "text" and has_number_line:
            # Number-line scenes are normalized into one data space, so caption
            # rows above the line are real layout and belong in the fit.
            points.append(item["position"])
    return points


def build_transform(elements: Sequence[dict]) -> CanvasTransform:
    """Derive the canvas transform the renderer will use for this scene."""
    axes = next((item for item in elements if item.get("type") == "axes"), None)
    if axes is not None:
        x0, x1 = float(axes["x_range"][0]), float(axes["x_range"][1])
        y0, y1 = float(axes["y_range"][0]), float(axes["y_range"][1])
        x_span = max(x1 - x0, 1e-6)
        y_span = max(y1 - y0, 1e-6)
        x_length, y_length = _AXES_X_LENGTH, _AXES_Y_LENGTH
        # The worker equalises the unit scale when a circle is present so the
        # circle stays round; mirror that or labels drift on those scenes.
        if any(item.get("type") == "circle" for item in elements):
            unit = min(x_length / x_span, y_length / y_span)
            x_length, y_length = x_span * unit, y_span * unit
        position = axes.get("position") or [0.0, 0.0]
        scale_x = x_length / x_span
        scale_y = y_length / y_span
        # Axes.move_to centres the axes' bounding box (the data box) on position.
        return CanvasTransform(
            scale_x=scale_x,
            scale_y=scale_y,
            offset_x=float(position[0]) - (x0 + x1) / 2 * scale_x,
            offset_y=float(position[1]) - (y0 + y1) / 2 * scale_y,
        )

    points = _geometry_points(elements)
    if not points:
        return CanvasTransform()

    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    source_w = max(max(xs) - min(xs), 0.1)
    source_h = max(max(ys) - min(ys), 0.1)
    has_formula = any(
        item.get("type") == "text" and _FORMULA_PATTERN.search(item.get("label", "") or "")
        for item in elements
    )
    has_number_line = any(item.get("type") == "number_line" for item in elements)
    left, right = _FIT_TARGET_X_WITH_FORMULA if has_formula else _FIT_TARGET_X
    bottom, top = _FIT_TARGET_Y
    scale = min(
        (right - left) / source_w,
        (top - bottom) / source_h,
        _MAX_FIT_SCALE_NUMBER_LINE if has_number_line else _MAX_FIT_SCALE,
    )
    source_cx = (min(xs) + max(xs)) / 2
    source_cy = (min(ys) + max(ys)) / 2
    return CanvasTransform(
        scale_x=scale,
        scale_y=scale,
        offset_x=(left + right) / 2 - source_cx * scale,
        offset_y=(bottom + top) / 2 - source_cy * scale,
    )


# --- obstacles ---------------------------------------------------------------


@dataclass
class Obstacles:
    """Everything a label should avoid sitting on top of, in canvas units."""

    segments: list[Segment] = field(default_factory=list)
    boxes: list[Box] = field(default_factory=list)

    def collides(self, box: Box, pad: float = 0.0) -> float:
        """A crude collision score: segment hits plus overlapping box area."""
        score = 0.0
        for segment in self.segments:
            if _segment_box_hit(segment, box, pad):
                score += 1.0
        for other in self.boxes:
            area = box.overlap(other, pad)
            if area > 0:
                score += 1.0 + area
        return score


_TICK_FONT_SIZE = 17
_AXIS_NAME_FONT_SIZE = 23
_ARROW_TIP = 0.32          # Axes(tips=True) overshoots the range by about this

# A NumberLine's own decorations, as manim_worker draws them: tick numbers one
# font size larger than an Axes' and dropped further below the line, plus a dot
# on every mark.
_NUMBER_LINE_TICK_FONT_SIZE = 18
_NUMBER_LINE_TICK_DROP = 0.42
_MARK_DOT_RADIUS = 0.11

# A brace is not its span: Manim's Brace occupies a band this far outward from
# the line it measures, the same at any length (measured from the real mobject,
# pinned by BraceGeometryTests). Modelling only the span put the brace's own
# label inside its curl.
BRACE_GAP = 0.2        # nearest the brace comes to the span it measures
BRACE_REACH = 0.473    # furthest, i.e. the tip of the centre prong
BRACE_BAR = 0.34       # the long body between the two


def _axis_decoration_boxes(
    item: dict,
    transform: CanvasTransform,
    x_range: tuple[float, float, float],
    y_range: tuple[float, float, float],
    axis_x: float,
    axis_y: float,
) -> list[Box]:
    """Tick numbers, axis names and arrow tips, as the worker draws them.

    Offsets mirror manim_worker's axes block: x ticks at ``c2p(x,0)+(0,-0.28)``,
    y ticks at ``c2p(0,y)+(-0.3,0)``, axis names just past each arrow.
    """
    boxes: list[Box] = []
    x0, x1, x_step = x_range
    y0, y1, y_step = y_range

    def ticks(start: float, end: float, step: float):
        if step <= 0:
            return
        # Same ceil-to-step walk the worker uses, and it skips zero.
        value = math.ceil(start / step) * step
        guard = 0
        while value <= end + 1e-9 and guard < 400:
            if abs(value) > 1e-9:
                yield value
            value += step
            guard += 1

    for value in ticks(x0, x1, x_step):
        cx, cy = transform.apply([value, axis_y])
        width, height = text_extent(f"{value:g}", _TICK_FONT_SIZE)
        boxes.append(Box(cx, cy - 0.28, width, height))
    for value in ticks(y0, y1, y_step):
        cx, cy = transform.apply([axis_x, value])
        width, height = text_extent(f"{value:g}", _TICK_FONT_SIZE)
        boxes.append(Box(cx - 0.3, cy, width, height))

    x_end = transform.apply([x1, axis_y])
    y_end = transform.apply([axis_x, y1])
    boxes.append(Box(x_end[0] + _ARROW_TIP / 2, x_end[1], _ARROW_TIP, 0.26))
    boxes.append(Box(y_end[0], y_end[1] + _ARROW_TIP / 2, 0.26, _ARROW_TIP))
    if item.get("x_label"):
        width, height = text_extent(item["x_label"], _AXIS_NAME_FONT_SIZE)
        boxes.append(Box(x_end[0] + 0.25, x_end[1] + 0.2, width, height))
    if item.get("y_label"):
        width, height = text_extent(item["y_label"], _AXIS_NAME_FONT_SIZE)
        boxes.append(Box(y_end[0] + 0.2, y_end[1] + 0.2, width, height))
    return boxes


def brace_outward(a: Point, b: Point) -> Point:
    """The side a brace curls toward — manim_worker's normal, same convention."""
    tangent = (b[0] - a[0], b[1] - a[1])
    normal = (tangent[1], -tangent[0])
    if normal[1] > 0 and abs(normal[1]) > 1e-6:
        normal = (-normal[0], -normal[1])
    return _normalize(normal)


def _brace_body(a: Point, b: Point) -> list[Segment]:
    """The brace's own strokes, so its label is pushed past them, not into them."""
    nx, ny = brace_outward(a, b)

    def offset(point: Point, distance: float) -> Point:
        return (point[0] + nx * distance, point[1] + ny * distance)

    middle = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
    return [
        (offset(a, BRACE_GAP), offset(a, BRACE_BAR)),
        (offset(a, BRACE_BAR), offset(b, BRACE_BAR)),
        (offset(b, BRACE_BAR), offset(b, BRACE_GAP)),
        (offset(middle, BRACE_BAR), offset(middle, BRACE_REACH)),
    ]


def _number_line_tick_labels(item: dict, transform: CanvasTransform) -> list[tuple[float, str]]:
    """Which ticks the worker actually prints, and what they read.

    Transcribed from manim_worker's number_line block, including its order of
    operations: `selected` grows while it is being tested against, so marks
    claim their slots first and endpoints only fill in where they clear the
    stride. Approximating this is not good enough — a tick the worker prints
    but the solver does not model is invisible free space, which is exactly how
    a caption ends up sitting on a tick number.
    """
    start, end, step = (float(v) for v in item["range"][:3])
    if step <= 0 or end < start:
        return []
    height = float((item.get("position") or [0, 0])[1])

    tick_values: list[float] = []
    cursor = start
    while cursor <= end + 1e-9 and len(tick_values) < 4000:
        tick_values.append(cursor)
        cursor += step
    if not tick_values:
        return []

    marks = [float(m) for m in (item.get("marks") or [])]
    last_index = len(tick_values) - 1
    line_length = math.dist(transform.apply([start, height]), transform.apply([end, height]))
    per_tick = max(line_length / max(last_index, 1), 1e-6)
    widest_chars = max(len(f"{value:g}") for value in tick_values)
    min_gap = max(1, int(math.ceil((widest_chars * 0.12 + 0.16) / per_tick)))

    selected = [
        index for index, value in enumerate(tick_values)
        if any(abs(value - mark) < 1e-6 for mark in marks)
    ]
    for candidate in (0, last_index):
        if all(abs(candidate - chosen) >= min_gap for chosen in selected):
            selected.append(candidate)
    for candidate in range(0, len(tick_values), min_gap):
        if all(abs(candidate - chosen) >= min_gap for chosen in selected):
            selected.append(candidate)

    return [(tick_values[i], f"{tick_values[i]:g}") for i in sorted(set(selected))]


def _number_line_decoration_boxes(item: dict, transform: CanvasTransform) -> list[Box]:
    """Tick numbers and mark dots, as the worker draws them.

    These are drawn by the number_line element itself rather than requested
    through the label solver, so without this they were invisible to it. The
    whole row under the line read as free space and captions landed on the
    digits (a live render put a caption straight over the tick "3").
    """
    height = float((item.get("position") or [0, 0])[1])
    boxes: list[Box] = []
    for value, text in _number_line_tick_labels(item, transform):
        cx, cy = transform.apply([value, height])
        width, box_height = text_extent(text, _NUMBER_LINE_TICK_FONT_SIZE)
        boxes.append(Box(cx, cy - _NUMBER_LINE_TICK_DROP, width, box_height))
    for mark in (item.get("marks") or []):
        cx, cy = transform.apply([float(mark), height])
        boxes.append(Box(cx, cy, _MARK_DOT_RADIUS * 2, _MARK_DOT_RADIUS * 2))
    return boxes


def _arc_segments(center: Point, radius: float, start: float, sweep: float, steps: int = 14) -> list[Segment]:
    points = [
        (
            center[0] + radius * math.cos(start + sweep * i / steps),
            center[1] + radius * math.sin(start + sweep * i / steps),
        )
        for i in range(steps + 1)
    ]
    return list(zip(points[:-1], points[1:]))


def collect_obstacles(elements: Sequence[dict], transform: CanvasTransform) -> Obstacles:
    """Project every drawn stroke into canvas space as segments/boxes."""
    obstacles = Obstacles()
    has_axes = any(item.get("type") == "axes" for item in elements)

    def to_canvas(point: Sequence[float]) -> Point:
        return transform.apply(point)

    for item in elements:
        if _is_card_formula(item, has_axes):
            width, height = text_extent(item.get("label", ""), 31)
            obstacles.boxes.append(Box(
                _FORMULA_CARD_CENTER[0], _FORMULA_CARD_CENTER[1],
                max(_FORMULA_CARD_MIN[0], width + 0.7),
                max(_FORMULA_CARD_MIN[1], height + 0.48),
            ))
            continue

        kind = item.get("type")
        points = [to_canvas(p) for p in (item.get("points") or [])]

        if kind == "polygon" and len(points) >= 3:
            ring = points + [points[0]]
            obstacles.segments.extend(zip(ring[:-1], ring[1:]))
        elif kind in {"polyline", "line", "arrow"} and len(points) >= 2:
            obstacles.segments.extend(zip(points[:-1], points[1:]))
        elif kind in {"angle", "right_angle"} and len(points) >= 3:
            obstacles.segments.extend([(points[1], points[0]), (points[1], points[2])])
        elif kind == "brace" and len(points) >= 2:
            obstacles.segments.append((points[0], points[1]))
            obstacles.segments.extend(_brace_body(points[0], points[1]))
        elif kind == "point" and points:
            obstacles.boxes.append(Box(points[0][0], points[0][1], 0.18, 0.18))
        elif kind == "circle":
            center = to_canvas(item["center"])
            rx = float(item["radius"]) * transform.scale_x
            ry = float(item["radius"]) * transform.scale_y
            steps = 24
            ring = [
                (center[0] + rx * math.cos(math.tau * i / steps), center[1] + ry * math.sin(math.tau * i / steps))
                for i in range(steps + 1)
            ]
            obstacles.segments.extend(zip(ring[:-1], ring[1:]))
        elif kind == "rectangle":
            center = to_canvas(item["center"])
            hw = float(item["width"]) * transform.scale_x / 2
            hh = float(item["height"]) * transform.scale_y / 2
            corners = [
                (center[0] - hw, center[1] - hh), (center[0] + hw, center[1] - hh),
                (center[0] + hw, center[1] + hh), (center[0] - hw, center[1] + hh),
            ]
            ring = corners + [corners[0]]
            obstacles.segments.extend(zip(ring[:-1], ring[1:]))
        elif kind == "arc":
            center = to_canvas(item["center"])
            radius = float(item["radius"]) * transform.scale_x
            obstacles.segments.extend(
                _arc_segments(center, radius, float(item["start_angle"]), float(item["angle"]))
            )
        elif kind == "axes":
            x0, x1, x_step = (float(v) for v in item["x_range"][:3])
            y0, y1, y_step = (float(v) for v in item["y_range"][:3])
            # The drawn axis lines sit at the clamped origin: a range that does
            # not straddle zero draws its axis along the nearest edge instead.
            axis_y = min(max(0.0, y0), y1)
            axis_x = min(max(0.0, x0), x1)
            obstacles.segments.append((to_canvas([x0, axis_y]), to_canvas([x1, axis_y])))
            obstacles.segments.append((to_canvas([axis_x, y0]), to_canvas([axis_x, y1])))

            # The worker adds tick numbers, axis names and arrow tips straight
            # to the Scene rather than through build(), so they never reached
            # the solver. A curve label anchored at the end of its data then
            # landed on the x-axis arrow and the final tick ("y=sin(x)" over
            # "6.28"). Reproduce them here so they are avoided like any stroke.
            obstacles.boxes.extend(_axis_decoration_boxes(
                item, transform, (x0, x1, x_step), (y0, y1, y_step), axis_x, axis_y
            ))
        elif kind == "number_line":
            start, end = float(item["range"][0]), float(item["range"][1])
            height = (item.get("position") or [0, 0])[1]
            obstacles.segments.append((to_canvas([start, height]), to_canvas([end, height])))
            # The line is not just a stroke: it carries a row of tick numbers
            # and a dot per mark, all drawn by the element rather than solved.
            obstacles.boxes.extend(_number_line_decoration_boxes(item, transform))

    return obstacles


# --- anchors -----------------------------------------------------------------


@dataclass
class LabelRequest:
    """One label the solver must position."""

    text: str
    font_size: float
    anchor: Point                  # canvas point the label belongs to
    outward: Point                 # preferred unit direction away from the geometry
    element_index: int
    slot: str                      # where to write the answer back
    hint: Optional[Point] = None   # planner-supplied position, honoured when it works
    padding: float = 0.0           # background-rect buff for backed_label sites

    def extent(self) -> tuple[float, float]:
        width, height = text_extent(self.text, self.font_size)
        return width + 2 * self.padding, height + 2 * self.padding


def _centroid(points: Sequence[Point]) -> Point:
    return (
        sum(p[0] for p in points) / len(points),
        sum(p[1] for p in points) / len(points),
    )


def _normalize(vector: Point) -> Point:
    length = math.hypot(*vector)
    if length < 1e-9:
        return (0.0, 1.0)
    return (vector[0] / length, vector[1] / length)


def _edge_outward(a: Point, b: Point, interior: Point) -> Point:
    """Unit normal of edge a→b pointing away from ``interior``."""
    mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
    normal = _normalize((-(b[1] - a[1]), b[0] - a[0]))
    away = (mid[0] - interior[0], mid[1] - interior[1])
    if normal[0] * away[0] + normal[1] * away[1] < 0:
        return (-normal[0], -normal[1])
    return normal


def collect_label_requests(
    elements: Sequence[dict],
    transform: CanvasTransform,
) -> list[LabelRequest]:
    """Derive an anchor for every label in the scene.

    Anchors are *inferred* from element geometry rather than required from the
    planner.  That is what lets an ordinary scene — one the model wrote before
    this module existed — get correct placement without the planner opting in.
    An explicit ``anchor`` on a text element overrides the inference.
    """
    requests: list[LabelRequest] = []
    has_axes = any(item.get("type") == "axes" for item in elements)

    for index, item in enumerate(elements):
        if _is_card_formula(item, has_axes):
            continue   # the renderer owns this one — it goes in the fixed card
        kind = item.get("type")
        points = [transform.apply(p) for p in (item.get("points") or [])]

        if kind == "polygon" and len(points) >= 3:
            interior = _centroid(points)
            for vertex_index, label in enumerate(item.get("labels") or []):
                if not label or vertex_index >= len(points):
                    continue
                vertex = points[vertex_index]
                requests.append(LabelRequest(
                    text=label, font_size=26, anchor=vertex,
                    outward=_normalize((vertex[0] - interior[0], vertex[1] - interior[1])),
                    element_index=index, slot=f"labels:{vertex_index}",
                ))
            for edge_index, label in enumerate(item.get("side_labels") or []):
                if not label or edge_index >= len(points):
                    continue
                a = points[edge_index]
                b = points[(edge_index + 1) % len(points)]
                requests.append(LabelRequest(
                    text=label, font_size=24,
                    anchor=((a[0] + b[0]) / 2, (a[1] + b[1]) / 2),
                    outward=_edge_outward(a, b, interior),
                    element_index=index, slot=f"side_labels:{edge_index}",
                    padding=BACKED_PAD,
                ))
            continue

        label = item.get("label")
        if not label:
            continue

        if kind == "point" and points:
            requests.append(LabelRequest(
                text=label, font_size=26, anchor=points[0], outward=(0.6, 0.8),
                element_index=index, slot="label",
            ))
        elif kind in {"line", "arrow", "brace"} and len(points) >= 2:
            a, b = points[0], points[1]
            # A measuring brace is labelled at its midpoint — that is the whole
            # convention. A plain line is not: the middle of a line is usually
            # where the rest of the diagram crosses it (a transversal, an
            # intersection), so anchor nearer the end where there is room.
            t = 0.5 if kind == "brace" else _LINE_LABEL_T
            anchor = (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
            normal = _normalize((-(b[1] - a[1]), b[0] - a[0]))
            requests.append(LabelRequest(
                text=label, font_size=24, anchor=anchor, outward=normal,
                element_index=index, slot="label",
                padding=BACKED_PAD if kind == "brace" else 0.0,
            ))
        elif kind == "polyline" and len(points) >= 2:
            # Near the end, where a graph has most free space — but NOT at the
            # very last sample, which for a function plot coincides with the
            # axis arrow and the final tick number.
            head_index = max(1, min(len(points) - 1, round((len(points) - 1) * _CURVE_LABEL_T)))
            head = points[head_index]
            tail = points[head_index - 1]
            requests.append(LabelRequest(
                text=label, font_size=24, anchor=head,
                outward=_normalize((-(head[1] - tail[1]), head[0] - tail[0])),
                element_index=index, slot="label",
            ))
        elif kind == "circle":
            # On the rim, not at the centre: a centred label reads as naming the
            # centre point (which is often separately labelled "O") rather than
            # the circle. The renderer's own offset put it a full radius above,
            # which pushed it off-frame for any large circle.
            center = transform.apply(item["center"])
            rim = center[1] + float(item["radius"]) * transform.scale_y
            requests.append(LabelRequest(
                text=label, font_size=24, anchor=(center[0], rim), outward=(0.0, 1.0),
                element_index=index, slot="label",
            ))
        elif kind == "rectangle":
            center = transform.apply(item["center"])
            requests.append(LabelRequest(
                text=label, font_size=24, anchor=center, outward=(0.0, 1.0),
                element_index=index, slot="label",
            ))
        elif kind in {"angle", "arc"} and (points or kind == "arc"):
            if kind == "arc":
                center = transform.apply(item["center"])
                mid_angle = float(item["start_angle"]) + float(item["angle"]) / 2
                radius = float(item["radius"]) * transform.scale_x
                anchor = (center[0] + radius * math.cos(mid_angle), center[1] + radius * math.sin(mid_angle))
                outward = _normalize((anchor[0] - center[0], anchor[1] - center[1]))
            else:
                vertex = points[1]
                ray_a = _normalize((points[0][0] - vertex[0], points[0][1] - vertex[1]))
                ray_b = _normalize((points[2][0] - vertex[0], points[2][1] - vertex[1]))
                bisector = _normalize((ray_a[0] + ray_b[0], ray_a[1] + ray_b[1]))
                anchor = (vertex[0] + bisector[0] * 0.55, vertex[1] + bisector[1] * 0.55)
                outward = bisector
            requests.append(LabelRequest(
                text=label, font_size=24, anchor=anchor, outward=outward,
                element_index=index, slot="label",
            ))
        elif kind == "text":
            position = transform.apply(item["position"])
            anchor_spec = item.get("anchor")
            resolved = _resolve_explicit_anchor(anchor_spec, elements, transform)
            if resolved is not None:
                anchor, outward = resolved
                hint = None
            else:
                # No anchor: the planner's coordinate is a *hint*, not a
                # command.  It is kept when it works and minimally moved when
                # it does not, so deliberate captions stay where intended.
                anchor, outward, hint = position, (0.0, 1.0), position
            requests.append(LabelRequest(
                text=label, font_size=DEFAULT_FONT_SIZE, anchor=anchor, outward=outward,
                element_index=index, slot="position", hint=hint, padding=BACKED_PAD,
            ))
        elif kind == "number_line":
            start, end = float(item["range"][0]), float(item["range"][1])
            height = (item.get("position") or [0, 0])[1]
            anchor = transform.apply([start + (end - start) * 0.1, height])
            requests.append(LabelRequest(
                text=label, font_size=25, anchor=anchor, outward=(0.0, 1.0),
                element_index=index, slot="label", padding=BACKED_PAD,
            ))

    return requests


def _resolve_explicit_anchor(
    spec: object,
    elements: Sequence[dict],
    transform: CanvasTransform,
) -> Optional[tuple[Point, Point]]:
    """Resolve ``{"element": i, "at": "vertex:2"}`` to (anchor, outward)."""
    if not isinstance(spec, dict):
        return None
    index = spec.get("element")
    if not isinstance(index, int) or not 0 <= index < len(elements):
        return None
    target = elements[index]
    points = [transform.apply(p) for p in (target.get("points") or [])]
    at = str(spec.get("at") or "center")

    if at.startswith("vertex:") and points:
        vertex_index = int(at.split(":", 1)[1] or 0) % len(points)
        interior = _centroid(points) if len(points) >= 3 else points[0]
        vertex = points[vertex_index]
        return vertex, _normalize((vertex[0] - interior[0], vertex[1] - interior[1]))
    if at.startswith("edge:") and len(points) >= 2:
        edge_index = int(at.split(":", 1)[1] or 0) % len(points)
        a = points[edge_index]
        b = points[(edge_index + 1) % len(points)]
        interior = _centroid(points) if len(points) >= 3 else ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - 1)
        return ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2), _edge_outward(a, b, interior)
    if at in {"start", "end"} and points:
        point = points[0] if at == "start" else points[-1]
        return point, (0.0, 1.0)
    if at == "midpoint" and len(points) >= 2:
        a, b = points[0], points[-1]
        return ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2), _normalize((-(b[1] - a[1]), b[0] - a[0]))
    if target.get("center") is not None:
        return transform.apply(target["center"]), (0.0, 1.0)
    if points:
        return points[0], (0.0, 1.0)
    if target.get("position") is not None:
        return transform.apply(target["position"]), (0.0, 1.0)
    return None


# --- the solver --------------------------------------------------------------

# Candidate rings around the anchor.  The first radius is a tight "touching the
# thing" offset; later radii let a crowded label escape further out.
_RADII = (0.34, 0.52, 0.78, 1.08)
_DIRECTIONS = 12
_FALLBACK_COLUMNS = 13
_FALLBACK_ROWS = 9

# How far a label may sit from its anchor before it reads as unattached.
FAR_LABEL_LIMIT = 2.0

# Minimum whitespace demanded between two labels. Non-overlap alone is not
# enough: adjacent vertex labels from two different shapes ("C" and "A'") were
# technically clear but read as one word. Half a glyph of air fixes that.
LABEL_BREATHING_ROOM = 0.11

# Where along a plain line its label is anchored (0 = start, 1 = end). Braces
# keep 0.5; see collect_label_requests for why lines do not.
_LINE_LABEL_T = 0.78

# Where along a sampled curve its label is anchored. Deliberately short of 1.0:
# the last sample of a function plot sits under the axis arrow and last tick.
_CURVE_LABEL_T = 0.82

_W_COLLISION = 14.0
_W_FRAME = 40.0
_W_DISTANCE = 1.1
_W_DIRECTION = 2.4
_W_HINT = 3.0

# manim_worker.backed_label draws a background rect with this buff.
BACKED_PAD = 0.1


def _candidate_positions(request: LabelRequest, grid: bool = False) -> Iterable[tuple[Point, float]]:
    """Yield (position, direction_penalty) candidates, best-intentioned first."""
    if grid:
        yield from _grid_positions()
        return
    if request.hint is not None:
        yield request.hint, 0.0
    ax, ay = request.anchor
    for radius in _RADII:
        for step in range(_DIRECTIONS):
            angle = math.tau * step / _DIRECTIONS
            direction = (math.cos(angle), math.sin(angle))
            dot = direction[0] * request.outward[0] + direction[1] * request.outward[1]
            # 0 when perfectly outward, 1 when pointing straight back inside.
            penalty = (1.0 - dot) / 2.0
            yield (ax + direction[0] * radius, ay + direction[1] * radius), penalty


def _grid_positions() -> Iterable[tuple[Point, float]]:
    """A frame-wide sweep, used only when nothing near the anchor is usable.

    Reached when the anchor is off-frame (every ring candidate clamps to the
    same edge) or the scene is so crowded that all nearby slots collide. Running
    it unconditionally roughly tripled solve time for no benefit, so it is a
    second pass rather than an extra tail on the first.
    """
    for row in range(_FALLBACK_ROWS):
        for column in range(_FALLBACK_COLUMNS):
            yield (
                -FRAME_X + 0.6 + column * (2 * FRAME_X - 1.2) / (_FALLBACK_COLUMNS - 1),
                -FRAME_Y + 0.5 + row * (2 * FRAME_Y - 1.0) / (_FALLBACK_ROWS - 1),
            ), 1.0


def solve_labels(
    requests: Sequence[LabelRequest],
    obstacles: Obstacles,
) -> list[tuple[LabelRequest, Point]]:
    """Place every label, cheapest-cost-first, avoiding already-placed labels.

    Greedy rather than global: labels are placed in scene order and each one
    sees the ones before it as obstacles.  A global optimiser would place a
    handful of pathological scenes better, but greedy is deterministic, fast,
    and easy to reason about when a placement looks wrong.
    """
    placed: list[Box] = []
    results: list[tuple[LabelRequest, Point]] = []

    for request in requests:
        width, height = request.extent()

        def score_candidates(grid: bool) -> tuple[float, Point]:
            best: Optional[tuple[float, Point]] = None
            for raw_position, direction_penalty in _candidate_positions(request, grid=grid):
                # Clamp before scoring, not after: a candidate pushed back inside
                # the frame afterwards would be scored at a position it never
                # occupies, and could land on a label it thought it had avoided.
                position = _clamp_to_frame(
                    (round(raw_position[0], 4), round(raw_position[1], 4)), width, height
                )
                box = Box(position[0], position[1], width, height)
                cost = 0.0
                cost += _W_COLLISION * obstacles.collides(box, pad=0.03)
                cost += _W_FRAME * box.outside_frame()
                cost += _W_DISTANCE * math.dist(position, request.anchor)
                cost += _W_DIRECTION * direction_penalty
                for other in placed:
                    area = box.overlap(other, pad=LABEL_BREATHING_ROOM)
                    if area > 0:
                        cost += _W_COLLISION * (1.0 + area)
                if request.hint is not None and raw_position == request.hint:
                    # Honouring a deliberate caption position is worth a discount,
                    # but not worth sitting on top of a triangle.
                    cost -= _W_HINT
                if best is None or cost < best[0]:
                    best = (cost, position)
                if cost <= 0.0:
                    break
            assert best is not None  # both candidate sets always yield
            return best

        best_cost, position = score_candidates(grid=False)
        if best_cost >= _W_COLLISION:
            # Every nearby slot collides with geometry or another label; sweep
            # the frame and keep whichever pass scored better.
            grid_cost, grid_position = score_candidates(grid=True)
            if grid_cost < best_cost:
                best_cost, position = grid_cost, grid_position
        placed.append(Box(position[0], position[1], width, height))
        results.append((request, position))

    return results


def _clamp_to_frame(position: Point, width: float, height: float) -> Point:
    limit_x = max(0.0, FRAME_X - SAFE_MARGIN - width / 2)
    limit_y = max(0.0, FRAME_Y - SAFE_MARGIN - height / 2)
    return (
        min(max(position[0], -limit_x), limit_x),
        min(max(position[1], -limit_y), limit_y),
    )


def solve_scene_layout(scene: dict) -> dict:
    """Attach solved canvas positions to every label in ``scene``.

    Mutates and returns the scene.  Each positioned label gets an entry under
    the element's ``layout`` dict, keyed by slot::

        {"layout": {"label": [cx, cy], "side_labels:1": [cx, cy]}}

    Coordinates are CANVAS units, already through the transform — a renderer
    uses them directly and must not re-project them.  Renderers that do not
    understand ``layout`` keep working from the original fields, so this is
    purely additive.
    """
    elements = scene.get("elements")
    if not isinstance(elements, list) or not elements:
        return scene

    transform = build_transform(elements)
    obstacles = collect_obstacles(elements, transform)
    requests = collect_label_requests(elements, transform)
    # A scene with no labels still has a transform and a content region, and
    # both are consumed by the renderers — returning early here left a
    # label-free scene re-deriving its own fit and showing the whole frame.
    solved = solve_labels(requests, obstacles) if requests else []
    for request, position in solved:
        element = elements[request.element_index]
        layout = element.setdefault("layout", {})
        layout[request.slot] = [position[0], position[1]]

    # Publish the transform. The renderers used to each re-implement this fit,
    # and every divergence put labels somewhere the shapes were not (it caused
    # two separate bugs during Phase 1/2). One producer, many consumers.
    scene["canvas"] = {
        "scale_x": round(transform.scale_x, 6),
        "scale_y": round(transform.scale_y, 6),
        "offset_x": round(transform.offset_x, 6),
        "offset_y": round(transform.offset_y, 6),
        "space": "data" if any(e.get("type") == "axes" for e in elements) else "canvas",
    }
    content = content_bounds(obstacles, solved)
    if content is not None:
        scene["content"] = [round(value, 4) for value in content]
    scene["layout_version"] = 1
    return scene


def content_bounds(
    obstacles: Obstacles,
    solved: Sequence[tuple[LabelRequest, Point]],
) -> Optional[tuple[float, float, float, float]]:
    """The region a scene actually occupies, as ``(x0, y0, x1, y1)`` canvas units.

    The frame is 14.2x8, but almost nothing fills it — a number line uses about
    a third of the height. A renderer that always shows the whole frame spends
    most of a chat-sized preview on empty space and shrinks the drawing until it
    has to be opened to be read. Published here because this is the only place
    that knows both the geometry AND every solved label box; estimating it in a
    renderer would mean a second copy of ``text_extent``.
    """
    xs: list[float] = []
    ys: list[float] = []
    for (ax, ay), (bx, by) in obstacles.segments:
        xs.extend((ax, bx))
        ys.extend((ay, by))
    for box in obstacles.boxes:
        xs.extend((box.left, box.right))
        ys.extend((box.bottom, box.top))
    for request, (cx, cy) in solved:
        width, height = request.extent()
        xs.extend((cx - width / 2, cx + width / 2))
        ys.extend((cy - height / 2, cy + height / 2))
    if not xs or not ys:
        return None

    pad = 0.25
    return (
        max(min(xs) - pad, -FRAME_X),
        max(min(ys) - pad, -FRAME_Y),
        min(max(xs) + pad, FRAME_X),
        min(max(ys) + pad, FRAME_Y),
    )


# --- invariants (shared by the test suite and any future quality report) ------


@dataclass
class LayoutViolation:
    kind: str
    detail: str


def check_layout(scene: dict) -> list[LayoutViolation]:
    """Assert the properties a well-laid-out scene must have.

    Used by the test suite and the fuzzer.  Returns an empty list for a good
    scene; each violation names what went wrong so a failure is diagnosable
    without opening a render.
    """
    violations: list[LayoutViolation] = []
    elements = scene.get("elements") or []
    if not elements:
        return violations

    transform = build_transform(elements)
    obstacles = collect_obstacles(elements, transform)
    requests = collect_label_requests(elements, transform)

    boxes: list[tuple[str, Box]] = []
    for request in requests:
        layout = (elements[request.element_index].get("layout") or {})
        position = layout.get(request.slot)
        if position is None:
            violations.append(LayoutViolation("unplaced", f"{request.text!r} has no solved position"))
            continue
        width, height = request.extent()
        box = Box(position[0], position[1], width, height)

        # Is the thing being named visible? Test the anchor POINT, not a
        # label-sized box around it — a rim anchor on a circle that fills the
        # frame is perfectly visible even though a box centred there overflows.
        anchor_placeable = Box(request.anchor[0], request.anchor[1], 0.0, 0.0).outside_frame() <= 0.0

        if box.outside_frame() > 1e-6:
            violations.append(LayoutViolation("off_canvas", f"{request.text!r} leaves the safe frame"))
        if not anchor_placeable:
            # Nothing the solver can do — the thing being named is itself off
            # screen. Reported so it stays visible, but it is not a layout bug.
            violations.append(
                LayoutViolation("anchor_off_canvas", f"{request.text!r} names something outside the frame")
            )
        else:
            # Beyond this a reader can no longer tell what the label names, and
            # the honest fix is a leader line from label back to anchor (not yet
            # drawn — see FAR_LABEL_LIMIT users). The bound allows for a grid
            # fallback slot, which crowded scenes legitimately need.
            distance = math.dist((box.cx, box.cy), request.anchor)
            if distance > FAR_LABEL_LIMIT + max(width, height):
                violations.append(
                    LayoutViolation("far_from_anchor", f"{request.text!r} sits {distance:.2f}u from what it names")
                )
        for name, other in boxes:
            if box.overlap(other, pad=0.02) > 0:
                violations.append(LayoutViolation("label_overlap", f"{request.text!r} overlaps {name!r}"))
        boxes.append((request.text, box))

    return violations
