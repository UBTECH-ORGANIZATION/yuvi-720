"""A parts vocabulary, so the planner assembles objects instead of drawing them.

Freeform drawing asks a model to emit bezier path data blind: it never sees the
result and it gets one attempt. Measured on the live planner, that produces a
mountain drawn as a bare triangle, a cloud drawn as three overlapping circles
and organs drawn as blobs — while the same model composes a circuit or a lever
perfectly well out of primitives.

The difference is not effort, it is the level of the vocabulary. Part
decomposition ("a tapered trunk and a lobed canopy") is something models are
good at; cubic beziers are not. So this module supplies the parts, each one a
parametric generator that cannot come out malformed, and the planner only
chooses which parts go where.

Everything is authored in a local 0..100 space with **y pointing up**, then
fitted to the element's `size` and `center` by `shapes.build_drawing` — the
planner supplies structure, never layout. Randomness is seeded, so the same
spec draws the same object every time and a cache can key on it.
"""

from __future__ import annotations

import math
import random
from typing import Callable

from app.agents.visuals import shapes as S

MAX_PARTS = 14
MAX_REPEAT = 11

# Every numeric input is clamped, so a part is well-formed for any value the
# planner sends. These are the outer bounds of "still a drawing".
_LIMITS: dict[str, tuple[float, float]] = {
    "w": (1.0, 200.0), "h": (1.0, 200.0), "r": (0.5, 100.0),
    "lobes": (2, 9), "peaks": (1, 7), "count": (2, 24), "cycles": (1, 12),
    "amp": (0.5, 40.0), "bend": (-40.0, 40.0), "taper": (0.05, 1.0),
    "angle": (-180.0, 180.0), "seed": (0, 9999), "jagged": (0.0, 1.0),
    "inner": (0.0, 0.95), "repeat": (0, MAX_REPEAT), "fill_opacity": (0.0, 0.85),
}


def _num(spec: dict, key: str, default: float) -> float:
    low, high = _LIMITS.get(key, (-1000.0, 1000.0))
    try:
        value = float(spec.get(key, default))
    except (TypeError, ValueError):
        value = default
    if not math.isfinite(value):
        value = default
    return max(low, min(high, value))


def _at(spec: dict) -> tuple[float, float]:
    point = spec.get("at")
    if isinstance(point, (list, tuple)) and len(point) >= 2:
        try:
            return float(point[0]), float(point[1])
        except (TypeError, ValueError):
            pass
    return 50.0, 50.0


# ── organic mass ─────────────────────────────────────────────────────────────
def _puff(spec, ink, opacity) -> list[dict]:
    """A cloud: the OUTLINE of overlapping lobes, never the lobes themselves.

    Drawing the circles is exactly what makes a model-authored cloud read as
    three circles — every internal arc stays visible. Tracing the union instead
    gives one bumpy contour with a flat underside, which is what a cloud is.
    """
    cx, cy = _at(spec)
    width, height = _num(spec, "w", 60.0), _num(spec, "h", 30.0)
    lobes = int(_num(spec, "lobes", 5))
    rng = random.Random(int(_num(spec, "seed", 7)))

    circles: list[tuple[float, float, float]] = []
    for index in range(lobes):
        t = index / max(lobes - 1, 1)
        lift = math.sin(math.pi * t)  # tall in the middle, low at the ends
        circles.append((
            -width / 2 + width * t,
            height * 0.08 * lift,
            height * (0.34 + 0.42 * lift) * rng.uniform(0.86, 1.14),
        ))

    points: list[list[float]] = []
    samples = 96
    for index in range(samples):
        theta = math.tau * index / samples
        ux, uy = math.cos(theta), math.sin(theta)
        reach = 0.0
        for dx, dy, radius in circles:
            along = dx * ux + dy * uy
            perpendicular = (dx * dx + dy * dy) - along * along
            if perpendicular > radius * radius:
                continue
            reach = max(reach, along + math.sqrt(radius * radius - perpendicular))
        if reach <= 0:
            continue
        points.append([cx + ux * reach, cy + max(uy * reach, -height * 0.30)])
    return [S.polygon(points, stroke=ink, width=4, fill=ink, fill_opacity=opacity)]


def _blob(spec, ink, opacity) -> list[dict]:
    """An irregular rounded mass — an organ, a stone, a canopy, a puddle.

    The wobble is a sum of low harmonics rather than random noise: noise gives a
    saw blade, harmonics give a contour that reads as something grown.
    """
    cx, cy = _at(spec)
    width, height = _num(spec, "w", 40.0), _num(spec, "h", 34.0)
    jagged = _num(spec, "jagged", 0.18)
    lobes = int(_num(spec, "lobes", 5))
    rng = random.Random(int(_num(spec, "seed", 3)))

    phases = [rng.uniform(0, math.tau) for _ in range(lobes)]
    points: list[list[float]] = []
    for index in range(72):
        theta = math.tau * index / 72
        wobble = sum(math.sin((n + 2) * theta + phases[n]) for n in range(lobes)) / lobes
        radius = 1.0 + jagged * wobble
        points.append([cx + width / 2 * radius * math.cos(theta),
                       cy + height / 2 * radius * math.sin(theta)])
    return [S.polygon(points, stroke=ink, width=4, fill=ink, fill_opacity=opacity)]


def _ridge(spec, ink, opacity) -> list[dict]:
    """A mountain range — ONE silhouette, not a row of triangles.

    The valleys between peaks stop well above the baseline. Dropping them all
    the way down separates the shape into triangles standing side by side,
    which is precisely the drawing this generator exists to replace.
    """
    cx, cy = _at(spec)
    width, height = _num(spec, "w", 80.0), _num(spec, "h", 34.0)
    peaks = int(_num(spec, "peaks", 2))
    jagged = _num(spec, "jagged", 0.35)
    rng = random.Random(int(_num(spec, "seed", 5)))

    left, right = cx - width / 2, cx + width / 2
    span = width / peaks
    points: list[list[float]] = [[left, cy]]
    for index in range(peaks):
        base = left + span * index
        summit_height = height * rng.uniform(0.66, 1.0)
        summit = base + span * rng.uniform(0.42, 0.58)
        # A shoulder on the long flank, so the profile is not two straight lines.
        shoulder = summit_height * (0.42 + jagged * rng.uniform(-0.12, 0.12))
        points.append([base + (summit - base) * 0.45, cy + shoulder])
        points.append([summit, cy + summit_height])
        if index < peaks - 1:
            # High valley floors are what makes this read as one range. Drop
            # them toward the baseline and it separates into standalone
            # triangles again, however many points the polygon has.
            points.append([base + span, cy + height * rng.uniform(0.38, 0.56)])
    points.append([right, cy])
    return [S.polygon(points, stroke=ink, width=4, fill=ink, fill_opacity=opacity)]


# ── structure ────────────────────────────────────────────────────────────────
def _stalk(spec, ink, opacity) -> list[dict]:
    """A tapered, optionally bent column — a trunk, a limb, a chimney, a stem."""
    cx, cy = _at(spec)
    width, height = _num(spec, "w", 10.0), _num(spec, "h", 34.0)
    taper = _num(spec, "taper", 0.7)
    bend = _num(spec, "bend", 0.0)

    steps = 12
    left: list[list[float]] = []
    right: list[list[float]] = []
    for index in range(steps + 1):
        t = index / steps
        half = width / 2 * (1.0 - (1.0 - taper) * t)
        offset = bend * t * t
        left.append([cx - half + offset, cy + height * t])
        right.append([cx + half + offset, cy + height * t])
    return [S.polygon(left + list(reversed(right)), stroke=ink, width=4,
                      fill=ink, fill_opacity=opacity)]


def _slab(spec, ink, opacity) -> list[dict]:
    """A rectangular body — a wall, a shelf, a brick, a door, a window."""
    cx, cy = _at(spec)
    return [S.rectangle([cx, cy], _num(spec, "w", 40.0), _num(spec, "h", 30.0),
                        stroke=ink, width=4, fill=ink, fill_opacity=opacity)]


def _roof(spec, ink, opacity) -> list[dict]:
    """A gable — the part that turns a box into a house."""
    cx, cy = _at(spec)
    width, height = _num(spec, "w", 52.0), _num(spec, "h", 20.0)
    overhang = width * 0.06
    return [S.polygon(
        [[cx - width / 2 - overhang, cy], [cx, cy + height], [cx + width / 2 + overhang, cy]],
        stroke=ink, width=4, fill=ink, fill_opacity=opacity,
    )]


def _leaf(spec, ink, opacity) -> list[dict]:
    """A pointed oval — a leaf, a petal, a fish, a boat hull."""
    cx, cy = _at(spec)
    width, height = _num(spec, "w", 26.0), _num(spec, "h", 14.0)
    angle = math.radians(_num(spec, "angle", 0.0))

    points: list[list[float]] = []
    for index in range(48):
        theta = math.pi * (2 * index / 47 - 1)
        # Pointed at both ends: a sharpened sine envelope, not an ellipse.
        x = width / 2 * math.cos(theta)
        y = height / 2 * math.sin(theta) * abs(math.sin(theta)) ** 0.35
        points.append([cx + x * math.cos(angle) - y * math.sin(angle),
                       cy + x * math.sin(angle) + y * math.cos(angle)])
    return [S.polygon(points, stroke=ink, width=3.5, fill=ink, fill_opacity=opacity)]


def _droplet(spec, ink, opacity) -> list[dict]:
    """A falling drop — round at the bottom, drawn to a point at the top.

    Built from the bowl circle plus the two tangent lines meeting at the apex,
    so the sides join the bowl smoothly instead of creasing into a comma.
    """
    cx, cy = _at(spec)
    radius = _num(spec, "r", 8.0)
    apex = radius * 2.6
    alpha = math.acos(max(-1.0, min(1.0, radius / apex)))

    start = math.pi / 2 + alpha
    sweep = math.tau - 2 * alpha
    points = [
        [cx + radius * math.cos(start + sweep * index / 40),
         cy + radius * math.sin(start + sweep * index / 40)]
        for index in range(41)
    ]
    points.append([cx, cy + apex])
    return [S.polygon(points, stroke=ink, width=3, fill=ink, fill_opacity=opacity)]


# ── radial ───────────────────────────────────────────────────────────────────
def _disc(spec, ink, opacity) -> list[dict]:
    cx, cy = _at(spec)
    radius = _num(spec, "r", 16.0)
    inner = _num(spec, "inner", 0.0)
    built = [S.ellipse([cx, cy], radius, radius, stroke=ink, width=4,
                       fill=ink, fill_opacity=opacity)]
    if inner > 0:
        built.append(S.ellipse([cx, cy], radius * inner, radius * inner, stroke=ink, width=3))
    return built


def _rays(spec, ink, opacity) -> list[dict]:
    """Spokes around a centre — sunlight, cilia, spokes of a wheel.

    Eight rays placed by hand come out at uneven angles and lengths; that is
    most of why a model-drawn sun looks amateur. Here it is one part.
    """
    cx, cy = _at(spec)
    radius = _num(spec, "r", 16.0)
    count = int(_num(spec, "count", 8))
    length = _num(spec, "h", radius * 0.55)
    built: list[dict] = []
    for index in range(count):
        theta = math.tau * index / count
        ux, uy = math.cos(theta), math.sin(theta)
        start = radius * 1.18
        built.append(S.line([cx + ux * start, cy + uy * start],
                            [cx + ux * (start + length), cy + uy * (start + length)],
                            stroke=ink, width=4))
    return built


# ── fluid and figures ────────────────────────────────────────────────────────
def _wave(spec, ink, opacity) -> list[dict]:
    """A rippled surface — water, a signal, a flag."""
    cx, cy = _at(spec)
    width = _num(spec, "w", 70.0)
    amp = _num(spec, "amp", 5.0)
    cycles = _num(spec, "cycles", 3)
    return [S.polyline([
        [cx - width / 2 + width * index / 60,
         cy + amp * math.sin(math.tau * cycles * index / 60)]
        for index in range(61)
    ], stroke=ink, width=4)]


def _person(spec, ink, opacity) -> list[dict]:
    """A simple figure — the park and warehouse questions are about people."""
    cx, cy = _at(spec)
    height = _num(spec, "h", 40.0)
    head = height * 0.17
    shoulder = cy + height * 0.62
    return [
        S.ellipse([cx, cy + height - head], head, head, stroke=ink, width=4,
                  fill=ink, fill_opacity=opacity),
        S.line([cx, shoulder], [cx, cy + height * 0.30], stroke=ink, width=4),
        S.line([cx - height * 0.20, shoulder - height * 0.10],
               [cx + height * 0.20, shoulder - height * 0.10], stroke=ink, width=4),
        S.line([cx, cy + height * 0.30], [cx - height * 0.16, cy], stroke=ink, width=4),
        S.line([cx, cy + height * 0.30], [cx + height * 0.16, cy], stroke=ink, width=4),
    ]


_SHAPES: dict[str, Callable[..., list[dict]]] = {
    "puff": _puff, "blob": _blob, "ridge": _ridge, "stalk": _stalk,
    "slab": _slab, "roof": _roof, "leaf": _leaf, "droplet": _droplet,
    "disc": _disc, "rays": _rays, "wave": _wave, "person": _person,
}

SHAPE_KINDS = frozenset(_SHAPES)


def build_parts(parts: list[dict], color_for: Callable[[str], str]) -> list[dict]:
    """Assemble parts into shapes, in the local 0..100 authoring space."""
    built: list[dict] = []
    for part in parts[:MAX_PARTS]:
        factory = _SHAPES.get(str(part.get("shape") or "").strip().lower())
        if factory is None:
            continue
        ink = color_for(part.get("color") or "ink")
        opacity = _num(part, "fill_opacity", 0.0)
        for placement in (part, *_repeats(part)):
            built.extend(factory(placement, ink, opacity))
    return built


def _repeats(part: dict) -> list[dict]:
    """Evenly spaced copies — windows, leaves, raindrops, shelves.

    A planner asked for eight separate parts spends its attention on arithmetic
    instead of on the object, and the spacing comes out uneven.
    """
    count = int(_num(part, "repeat", 0))
    if count < 1:
        return []
    step = part.get("step")
    dx, dy = 0.0, 0.0
    if isinstance(step, (list, tuple)) and len(step) >= 2:
        try:
            dx, dy = float(step[0]), float(step[1])
        except (TypeError, ValueError):
            dx, dy = 0.0, 0.0
    x, y = _at(part)
    return [
        {**part, "at": [x + dx * (index + 1), y + dy * (index + 1)],
         "repeat": 0, "seed": _num(part, "seed", 3) + index + 1}
        for index in range(min(count, MAX_REPEAT))
    ]
