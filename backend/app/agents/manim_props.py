"""Composite scene props — the domain vocabulary behind the `prop` element.

The planner used to have only abstract geometry: polygon, circle, line, brace,
number_line. Asked to illustrate "two balloons are the same material — why is
the inflated one heavier?", the best it could do was float the words בלון מנופח
and בלון ריק above a number line, because the vocabulary contained no balloon
and no balance. The picture was words next to a ruler, and the ruler measured
vocabulary rather than grams.

A prop is a parametric `VGroup` assembled from the primitives Manim already has
— an `Ellipse` body, a `Polygon` neck, a beam that rotates about its pivot while
the pans stay level. The planner names one and sets its parameters; it never
writes code, so the safety boundary is exactly where it was: the model emits
JSON, the worker builds mobjects.

Two rules hold for every factory here:

- **Text belongs to the caller.** A prop returns shapes plus named anchor points
  and the worker attaches labels through its own RTL-safe `label_for`. Hebrew
  bidi is solved once, in one place, rather than re-solved per prop.
- **Randomness is seeded.** Particle positions come from a per-prop seed so the
  same spec renders the same frames — required for a cache that stores renders
  by spec hash, and for golden-frame tests to mean anything.

Imported only from inside the render worker, which owns the Manim import.
"""

from __future__ import annotations

import math
import random
from typing import Any, Callable, Optional

# A prop returns its shapes plus the points a caller may hang a label on.
PropResult = tuple[list, dict[str, Any]]

# How far the beam of a balance may swing, in radians. Deliberately small: a
# real beam balance barely moves, and an exaggerated tilt reads as a see-saw.
_MAX_TILT = 0.22


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _as_float(value: Any, default: float) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    return number if math.isfinite(number) else default


def build_prop(
    spec: dict,
    *,
    manim: Any,
    color_for: Callable[[str], str],
    to_scene: Callable[[list], Any],
    unit: float,
) -> Optional[PropResult]:
    """Build one prop, or None when the kind is unknown.

    `to_scene` maps canvas coordinates to scene coordinates and `unit` is the
    length of one canvas unit there, so props stay correct inside an `axes`
    scene as well as on a bare canvas.
    """
    kind = str(spec.get("prop") or "").strip().lower()
    factory = _PROPS.get(kind)
    if factory is None:
        return None
    return factory(spec, manim, color_for, to_scene, unit)


# ── balance scale ────────────────────────────────────────────────────────────
def _balance_scale(spec, manim, color_for, to_scene, unit) -> PropResult:
    """Two-pan beam balance — "which is heavier", and equations as balance.

    `tilt` is signed and means what gravity means: POSITIVE dips the RIGHT pan,
    because a positive difference is the right side being heavier. Getting this
    sign backwards is not a cosmetic bug — it draws the heavier object rising,
    which is the exact misconception the picture exists to correct.

    When masses are given the tilt is derived from their difference and
    saturates, so 3g vs 4g and 3g vs 40g both read as "the right is heavier"
    without the beam going vertical.

    The pans hang from the beam ends but stay LEVEL — a pan that rotates with
    the beam is the commonest way this drawing goes wrong, and it makes the
    contents look like they are sliding off.
    """
    Line, Polygon, Dot = manim.Line, manim.Polygon, manim.Dot
    center = spec.get("center") or [0.0, 0.0]
    size = _clamp(_as_float(spec.get("size"), 1.0), 0.4, 2.2)
    ink = color_for(spec.get("color") or "ink")
    accent = color_for("accent")

    left_mass = spec.get("left_mass")
    right_mass = spec.get("right_mass")
    if left_mass is not None and right_mass is not None:
        left_value = _as_float(left_mass, 0.0)
        right_value = _as_float(right_mass, 0.0)
        total = abs(left_value) + abs(right_value)
        # Normalised difference, so the tilt shows WHICH side is heavier
        # without pretending to be a proportional readout of by how much.
        tilt = 0.0 if total <= 0 else _clamp((right_value - left_value) / total * 2.2, -1.0, 1.0)
    else:
        tilt = _clamp(_as_float(spec.get("tilt"), 0.0), -1.0, 1.0)

    beam_half = 1.55 * size
    pillar_height = 1.15 * size
    angle = tilt * _MAX_TILT

    pivot = [center[0], center[1] + pillar_height]
    # Heavier side DOWN: a positive tilt lowers the right end.
    left_end = [
        pivot[0] - beam_half * math.cos(angle),
        pivot[1] + beam_half * math.sin(angle),
    ]
    right_end = [
        pivot[0] + beam_half * math.cos(angle),
        pivot[1] - beam_half * math.sin(angle),
    ]

    parts: list = []
    base_half = 0.62 * size
    parts.append(Polygon(
        to_scene([center[0] - base_half, center[1] - 0.12 * size]),
        to_scene([center[0] + base_half, center[1] - 0.12 * size]),
        to_scene([center[0] + base_half * 0.42, center[1] + 0.1 * size]),
        to_scene([center[0] - base_half * 0.42, center[1] + 0.1 * size]),
        color=ink, stroke_width=4, fill_color=ink, fill_opacity=0.16,
    ))
    parts.append(Line(to_scene(center), to_scene(pivot), color=ink, stroke_width=5))
    parts.append(Line(to_scene(left_end), to_scene(right_end), color=ink, stroke_width=6))
    parts.append(Dot(to_scene(pivot), radius=0.075, color=accent))

    anchors: dict[str, Any] = {"pivot": pivot}
    for side, end in (("left", left_end), ("right", right_end)):
        pan_y = end[1] - 0.52 * size
        pan_half = 0.46 * size
        # The hanger is vertical whatever the beam does — that is what keeps the
        # pan level and the load looking supported rather than tipped.
        parts.append(Line(to_scene(end), to_scene([end[0], pan_y]), color=ink, stroke_width=3))
        parts.append(Polygon(
            to_scene([end[0] - pan_half, pan_y]),
            to_scene([end[0] + pan_half, pan_y]),
            to_scene([end[0] + pan_half * 0.66, pan_y - 0.24 * size]),
            to_scene([end[0] - pan_half * 0.66, pan_y - 0.24 * size]),
            color=ink, stroke_width=4,
            fill_color=color_for(spec.get("pan_color") or "muted"), fill_opacity=0.22,
        ))
        anchors[f"{side}_pan"] = [end[0], pan_y - 0.42 * size]
        anchors[f"{side}_load"] = [end[0], pan_y + 0.44 * size]

        # What is BEING weighed, built straight onto the pan. Asking the planner
        # to guess where a pan ended up after the beam tilted is asking it to
        # redo this trigonometry from outside — it lands the object next to the
        # scale instead of on it. Sizes are capped to the pan so a load cannot
        # swallow the instrument holding it.
        load = spec.get(f"{side}_load")
        if isinstance(load, dict) and load.get("prop") in _PROPS:
            nested = dict(load)
            nested["size"] = min(_as_float(nested.get("size"), 0.55), 0.62 * size)
            nested["center"] = [end[0], pan_y]
            built = _PROPS[nested["prop"]](nested, manim, color_for, to_scene, unit)
            if built:
                shapes, load_anchors = built
                # Sit it ON the pan by MEASURING the assembled shapes rather
                # than predicting their extent. A balloon's lowest point is its
                # neck, a container's is its base, and a prop built later will
                # have its own — estimating per prop is how loads end up
                # hovering half a unit above the pan they are supposed to rest
                # in.
                group = manim.VGroup(*[s for s in shapes if hasattr(s, "get_bottom")])
                if len(group):
                    lift = to_scene([end[0], pan_y])[1] - group.get_bottom()[1]
                    for shape in shapes:
                        shape.shift(manim.UP * lift)
                parts.extend(shapes)
                for name, point in load_anchors.items():
                    anchors[f"{side}_load.{name}"] = point
    return parts, anchors


# ── balloon ──────────────────────────────────────────────────────────────────
def _balloon(spec, manim, color_for, to_scene, unit) -> PropResult:
    """An inflatable balloon: body, neck, knot, optional string and gas inside.

    `inflation` (0..1) drives the body size, so "empty" and "inflated" are the
    same prop at two settings rather than two unrelated drawings — the learner
    sees one object changing, which is the whole point of the question.
    """
    VGroup, Ellipse, Polygon, Line = manim.VGroup, manim.Ellipse, manim.Polygon, manim.Line
    center = spec.get("center") or [0.0, 0.0]
    size = _clamp(_as_float(spec.get("size"), 1.0), 0.35, 2.0)
    inflation = _clamp(_as_float(spec.get("inflation"), 1.0), 0.0, 1.0)
    color = color_for(spec.get("color") or "warning")

    # Never collapses to nothing: a deflated balloon is still a balloon, and a
    # zero-radius ellipse would render as a dot the learner cannot identify.
    radius_x = size * (0.34 + 0.5 * inflation)
    radius_y = size * (0.4 + 0.58 * inflation)

    parts: list = []
    body = Ellipse(
        width=2 * radius_x * unit, height=2 * radius_y * unit,
        color=color, stroke_width=5, fill_color=color, fill_opacity=0.2,
    ).move_to(to_scene(center))
    parts.append(body)

    neck_half = 0.12 * size * (0.6 + 0.4 * inflation)
    neck_top = center[1] - radius_y
    neck_bottom = neck_top - 0.2 * size
    parts.append(Polygon(
        to_scene([center[0] - neck_half, neck_top]),
        to_scene([center[0] + neck_half, neck_top]),
        to_scene([center[0] + neck_half * 0.5, neck_bottom]),
        to_scene([center[0] - neck_half * 0.5, neck_bottom]),
        color=color, stroke_width=4, fill_color=color, fill_opacity=0.32,
    ))
    if spec.get("string"):
        parts.append(Line(
            to_scene([center[0], neck_bottom]),
            to_scene([center[0] + 0.16 * size, neck_bottom - 0.85 * size]),
            color=color_for("muted"), stroke_width=3,
        ))
    if spec.get("particles"):
        parts.extend(_scatter_dots(
            manim, to_scene, unit,
            center=center, radius_x=radius_x * 0.72, radius_y=radius_y * 0.72,
            count=int(_clamp(_as_float(spec.get("particles"), 0), 0, 40)),
            color=color_for(spec.get("particle_color") or "secondary"),
            seed=int(_as_float(spec.get("seed"), 7)),
        ))
    return parts, {
        "top": [center[0], center[1] + radius_y + 0.22],
        "center": list(center),
        "bottom": [center[0], neck_bottom - 0.25],
    }


# ── particle box ─────────────────────────────────────────────────────────────
def _particle_box(spec, manim, color_for, to_scene, unit) -> PropResult:
    """Particles in a container — states of matter, gas, density, diffusion.

    `state` chooses the arrangement: a solid packs to a lattice, a liquid sits
    loose in the lower half, a gas fills the volume. Deterministic given `seed`.
    """
    Rectangle, Ellipse = manim.Rectangle, manim.Ellipse
    center = spec.get("center") or [0.0, 0.0]
    width = _clamp(_as_float(spec.get("width"), 2.2), 0.6, 6.0)
    height = _clamp(_as_float(spec.get("height"), 1.8), 0.6, 5.0)
    state = str(spec.get("state") or "gas").strip().lower()
    count = int(_clamp(_as_float(spec.get("count"), 14), 1, 48))
    ink = color_for(spec.get("color") or "ink")
    particle_color = color_for(spec.get("particle_color") or "secondary")
    shape = str(spec.get("shape") or "box").strip().lower()

    parts: list = []
    if shape == "circle":
        parts.append(Ellipse(
            width=width * unit, height=height * unit,
            color=ink, stroke_width=5, fill_opacity=0.0,
        ).move_to(to_scene(center)))
    else:
        parts.append(Rectangle(
            width=width * unit, height=height * unit,
            color=ink, stroke_width=5, fill_opacity=0.0,
        ).move_to(to_scene(center)))

    radius = 0.5 * unit * _clamp(_as_float(spec.get("particle_size"), 0.14), 0.05, 0.3)
    rng = random.Random(int(_as_float(spec.get("seed"), 11)))
    Dot = manim.Dot
    if state == "solid":
        # A lattice, not a scatter: the regularity IS the fact being taught.
        columns = max(1, int(round(math.sqrt(count * width / max(height, 0.1)))))
        rows = max(1, math.ceil(count / columns))
        for index in range(count):
            col, row = index % columns, index // columns
            x = center[0] + width * ((col + 0.5) / columns - 0.5) * 0.78
            y = center[1] + height * ((row + 0.5) / rows - 0.5) * 0.78
            parts.append(Dot(to_scene([x, y]), radius=radius, color=particle_color))
    else:
        span_y = 0.42 if state == "liquid" else 0.82
        offset_y = -height * 0.22 if state == "liquid" else 0.0
        for _ in range(count):
            x = center[0] + rng.uniform(-0.4, 0.4) * width
            y = center[1] + offset_y + rng.uniform(-0.5, 0.5) * span_y * height
            parts.append(Dot(to_scene([x, y]), radius=radius, color=particle_color))
    return parts, {
        "top": [center[0], center[1] + height / 2 + 0.24],
        "center": list(center),
        "bottom": [center[0], center[1] - height / 2 - 0.24],
    }


# ── container ────────────────────────────────────────────────────────────────
def _container(spec, manim, color_for, to_scene, unit) -> PropResult:
    """A vessel with a liquid level — beaker, cylinder, test tube, jar."""
    Polygon, Rectangle, Line = manim.Polygon, manim.Rectangle, manim.Line
    center = spec.get("center") or [0.0, 0.0]
    width = _clamp(_as_float(spec.get("width"), 1.4), 0.4, 4.0)
    height = _clamp(_as_float(spec.get("height"), 1.8), 0.5, 4.5)
    fill_level = _clamp(_as_float(spec.get("fill_level"), 0.5), 0.0, 1.0)
    ink = color_for(spec.get("color") or "ink")
    liquid = color_for(spec.get("liquid_color") or "secondary")

    left, right = center[0] - width / 2, center[0] + width / 2
    bottom, top = center[1] - height / 2, center[1] + height / 2
    parts: list = [Polygon(
        to_scene([left, top]), to_scene([left, bottom]),
        to_scene([right, bottom]), to_scene([right, top]),
        color=ink, stroke_width=5, fill_opacity=0.0,
    )]
    if fill_level > 0:
        surface = bottom + height * fill_level
        parts.append(Rectangle(
            width=width * unit, height=height * fill_level * unit,
            color=liquid, stroke_width=0, fill_color=liquid, fill_opacity=0.3,
        ).move_to(to_scene([center[0], (bottom + surface) / 2])))
        parts.append(Line(to_scene([left, surface]), to_scene([right, surface]),
                          color=liquid, stroke_width=4))
    if spec.get("graduations"):
        steps = int(_clamp(_as_float(spec.get("graduations"), 4), 1, 10))
        for index in range(1, steps):
            y = bottom + height * index / steps
            parts.append(Line(to_scene([right - width * 0.22, y]), to_scene([right, y]),
                              color=ink, stroke_width=2))
    return parts, {
        "top": [center[0], top + 0.24],
        "center": list(center),
        "surface": [center[0], bottom + height * fill_level],
    }


# ── bar comparison ───────────────────────────────────────────────────────────
def _bar_comparison(spec, manim, color_for, to_scene, unit) -> PropResult:
    """Side-by-side magnitude bars — the honest form of "A weighs more than B".

    This is the prop that should have drawn the balloon question: two labelled
    bars whose HEIGHTS carry the comparison, instead of two words parked above
    a number line where the position meant nothing.
    """
    Rectangle = manim.Rectangle
    center = spec.get("center") or [0.0, 0.0]
    items = [item for item in (spec.get("items") or []) if isinstance(item, dict)][:5]
    if not items:
        return [], {}
    values = [abs(_as_float(item.get("value"), 0.0)) for item in items]
    peak = max(values) or 1.0
    max_height = _clamp(_as_float(spec.get("height"), 2.0), 0.5, 3.2)
    bar_width = _clamp(_as_float(spec.get("bar_width"), 0.62), 0.2, 1.4)
    gap = bar_width * 1.85
    baseline = center[1]
    start_x = center[0] - gap * (len(items) - 1) / 2

    parts: list = []
    anchors: dict[str, Any] = {"baseline": [center[0], baseline]}
    for index, (item, value) in enumerate(zip(items, values)):
        bar_height = max(0.08, max_height * value / peak)
        x = start_x + gap * index
        color = color_for(item.get("color") or ("primary" if index == 0 else "secondary"))
        parts.append(Rectangle(
            width=bar_width * unit, height=bar_height * unit,
            color=color, stroke_width=4, fill_color=color, fill_opacity=0.28,
        ).move_to(to_scene([x, baseline + bar_height / 2])))
        anchors[f"top:{index}"] = [x, baseline + bar_height + 0.26]
        anchors[f"foot:{index}"] = [x, baseline - 0.3]
    return parts, anchors


def _scatter_dots(manim, to_scene, unit, *, center, radius_x, radius_y, count, color, seed) -> list:
    """Dots scattered inside an ellipse, deterministically."""
    if count <= 0:
        return []
    rng = random.Random(seed)
    Dot = manim.Dot
    dots = []
    for _ in range(count):
        # Rejection-free polar placement, square-rooted so the dots spread
        # evenly over the AREA instead of clustering at the centre.
        angle = rng.uniform(0, 2 * math.pi)
        reach = math.sqrt(rng.random())
        dots.append(Dot(
            to_scene([center[0] + radius_x * reach * math.cos(angle),
                      center[1] + radius_y * reach * math.sin(angle)]),
            radius=0.055 * unit, color=color,
        ))
    return dots


_PROPS: dict[str, Callable] = {
    "balance_scale": _balance_scale,
    "balloon": _balloon,
    "particle_box": _particle_box,
    "container": _container,
    "bar_comparison": _bar_comparison,
}

PROP_KINDS = frozenset(_PROPS)
