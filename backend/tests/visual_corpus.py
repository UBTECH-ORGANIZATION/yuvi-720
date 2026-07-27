"""The Coach visual case matrix — shared by the fast suite and the report.

Hand-written cases only cover the failures somebody already thought of, so the
corpus is generated across four axes rather than listed one by one:

    topic     x  language (he / ar / en)  x  mode (still / animated)  x  adversarial

The topic templates are the shapes the planner actually produces — function
graphs, Euclidean constructions, number lines, chemistry — and the adversarial
block is the stuff that has broken this pipeline before: labels that collide,
text far from its geometry, degenerate coordinates, mixed scripts, and scenes
built entirely from elements that must be rejected.

Every case here is a RAW scene: the untrusted shape a planner would emit. What
the pipeline does with it (drop it, repair it, lay it out) is what the tests and
the report measure.
"""

from __future__ import annotations

from dataclasses import dataclass, field
import math
from typing import Callable


@dataclass(frozen=True)
class Case:
    id: str
    raw: dict
    tags: frozenset[str] = field(default_factory=frozenset)
    #: False when the pipeline is EXPECTED to refuse the scene entirely.
    expect_visual: bool = True


# --- localised label sets ----------------------------------------------------
# Same geometry, three scripts. RTL is a real failure mode: it has produced tofu
# in production and it changes label widths, so it must be in the matrix, not a
# spot check.

WORDS = {
    "he": {"hyp": "יתר", "mid": "אמצע", "angle": "זווית", "radius": "רדיוס",
           "vertex": "קודקוד", "line": "ישר", "area": "שטח", "between": "בין 12 ל-13",
           "measurements": "מדידות", "pattern": "דפוס", "outlier": "חריגה?",
           "close": "קרובות", "gap": "פער גדול"},
    "ar": {"hyp": "الوتر", "mid": "منتصف", "angle": "زاوية", "radius": "نصف القطر",
           "vertex": "رأس", "line": "مستقيم", "area": "مساحة", "between": "بين ١٢ و١٣",
           "measurements": "قياسات", "pattern": "نمط", "outlier": "شاذة؟",
           "close": "متقاربة", "gap": "فجوة كبيرة"},
    "en": {"hyp": "hyp", "mid": "midpoint", "angle": "angle", "radius": "radius",
           "vertex": "vertex", "line": "line", "area": "area", "between": "12 to 13",
           "measurements": "measurements", "pattern": "pattern", "outlier": "outlier?",
           "close": "close", "gap": "big gap"},
}


def _sample(fn: Callable[[float], float], x0: float, x1: float, n: int = 33) -> list[list[float]]:
    return [[x0 + (x1 - x0) * i / (n - 1), fn(x0 + (x1 - x0) * i / (n - 1))] for i in range(n)]


# --- topic templates ---------------------------------------------------------
# Each takes the localised word map and returns a raw scene's elements.

def _right_triangle(w):
    return [
        {"type": "polygon", "color": "primary", "points": [[-2, -1.5], [2, -1.5], [2, 1.5]],
         "labels": ["A", "B", "C"], "side_labels": ["4", "3", w["hyp"]], "fill_opacity": 0.08},
        {"type": "right_angle", "color": "accent", "points": [[-2, -1.5], [2, -1.5], [2, 1.5]]},
    ]


def _similar_triangles(w):
    return [
        {"type": "polygon", "color": "primary", "points": [[-5, -2], [-3, 1], [-1, -2]],
         "labels": ["A", "B", "C"], "side_labels": ["3", "5", "4"], "fill_opacity": 0.08},
        {"type": "polygon", "color": "secondary", "points": [[0, -2], [3, 2.5], [6, -2]],
         "labels": ["A'", "B'", "C'"], "side_labels": ["4.5", "7.5", "6"], "fill_opacity": 0.08},
        {"type": "text", "color": "ink", "position": [0.5, 3.0], "label": "×1.5"},
    ]


def _parabola(w):
    return [
        {"type": "axes", "color": "ink", "position": [0, 0], "x_range": [-3, 3, 1],
         "y_range": [-1, 9.5, 1], "x_label": "x", "y_label": "y"},
        {"type": "polyline", "color": "primary", "points": _sample(lambda x: x * x, -3, 3), "label": "y=x²"},
        {"type": "point", "color": "accent", "points": [[2, 4]], "label": "(2,4)"},
        {"type": "point", "color": "accent", "points": [[-2, 4]], "label": "(-2,4)"},
        {"type": "point", "color": "accent", "points": [[0, 0]], "label": w["vertex"]},
    ]


def _sine(w):
    return [
        {"type": "axes", "color": "ink", "position": [0, 0], "x_range": [-6.28, 6.28, 1.57],
         "y_range": [-1.5, 1.5, 0.5], "x_label": "x", "y_label": "y"},
        {"type": "polyline", "color": "primary", "points": _sample(math.sin, -6.28, 6.28, 51),
         "label": "y=sin(x)"},
        {"type": "point", "color": "accent", "points": [[3.14, 0]], "label": "π"},
        {"type": "point", "color": "accent", "points": [[-3.14, 0]], "label": "−π"},
    ]


def _absolute(w):
    return [
        {"type": "axes", "color": "ink", "position": [0, 0], "x_range": [-4, 4, 1],
         "y_range": [-1, 5, 1], "x_label": "x", "y_label": "y"},
        {"type": "polyline", "color": "primary", "points": _sample(abs, -4, 4), "label": "y=|x|"},
        {"type": "point", "color": "accent", "points": [[0, 0]], "label": w["vertex"]},
    ]


def _midpoint(w):
    return [
        {"type": "axes", "color": "ink", "position": [0, 0], "x_range": [0, 6, 1],
         "y_range": [0, 4, 1], "x_label": "x", "y_label": "y"},
        {"type": "line", "color": "primary", "points": [[1, 1], [5, 3]], "label": w["line"]},
        {"type": "point", "color": "primary", "points": [[1, 1]], "label": "A=(1,1)"},
        {"type": "point", "color": "primary", "points": [[5, 3]], "label": "B=(5,3)"},
        {"type": "point", "color": "accent", "points": [[3, 2]], "label": "M=(3,2)"},
    ]


def _circle(w):
    return [
        {"type": "circle", "color": "primary", "center": [0, 0], "radius": 2.2, "label": "r=2.2"},
        {"type": "arc", "color": "accent", "center": [0, 0], "radius": 1.0,
         "start_angle": 0.0, "angle": 1.2, "label": w["angle"]},
        {"type": "point", "color": "accent", "points": [[0, 0]], "label": "O"},
        {"type": "line", "color": "secondary", "points": [[0, 0], [2.2, 0]], "label": w["radius"]},
    ]


def _circle_on_axes(w):
    return [
        {"type": "axes", "color": "ink", "position": [0, 0], "x_range": [-4, 4, 1],
         "y_range": [-4, 4, 1], "x_label": "x", "y_label": "y"},
        {"type": "circle", "color": "primary", "center": [0, 0], "radius": 3, "label": "x²+y²=9"},
        {"type": "point", "color": "accent", "points": [[3, 0]], "label": "(3,0)"},
        {"type": "point", "color": "accent", "points": [[0, 3]], "label": "(0,3)"},
    ]


def _parallel(w):
    return [
        {"type": "line", "color": "primary", "points": [[-4, 1], [4, 1]], "label": "m"},
        {"type": "line", "color": "primary", "points": [[-4, -1.5], [4, -1.5]], "label": "n"},
        {"type": "line", "color": "secondary", "points": [[-3, -2.5], [3, 2.5]], "label": w["line"]},
        {"type": "angle", "color": "accent", "points": [[4, 1], [-0.6, 1], [3, 2.5]], "label": "α"},
        {"type": "angle", "color": "accent", "points": [[-4, -1.5], [0.6, -1.5], [-3, -2.5]], "label": "α"},
    ]


def _rectangle(w):
    return [
        {"type": "rectangle", "color": "primary", "center": [0, 0], "width": 6, "height": 3,
         "label": w["area"], "fill_opacity": 0.08},
        {"type": "line", "color": "accent", "points": [[-3, -1.5], [3, 1.5]], "label": "d"},
        {"type": "brace", "color": "ink", "points": [[-3, -1.5], [3, -1.5]], "label": "6"},
        {"type": "brace", "color": "ink", "points": [[3, -1.5], [3, 1.5]], "label": "3"},
    ]


def _number_line(w):
    return [
        {"type": "number_line", "color": "ink", "position": [0, 0], "range": [12, 13, 0.1],
         "marks": [12.1, 12.7], "label": w["between"]},
    ]


def _number_line_wide(w):
    return [
        {"type": "number_line", "color": "ink", "position": [0, 0], "range": [-10, 10, 1],
         "marks": [-7, 0, 4], "label": w["line"]},
    ]


def _number_line_annotated(w):
    """A number line carrying captions on BOTH sides, from a live render.

    The row under the line is not empty — it holds the tick numbers — and two
    of the marks are close enough to share one. This is the case where a
    caption was placed on top of the tick "3".
    """
    return [
        {"type": "number_line", "color": "ink", "position": [0, 0], "range": [0, 10, 1],
         "marks": [3, 3.4, 8], "label": w["measurements"]},
        {"type": "text", "color": "success", "position": [3.2, 0.9], "label": w["pattern"]},
        {"type": "text", "color": "success", "position": [3.2, -0.4], "label": w["close"]},
        {"type": "text", "color": "warning", "position": [8.0, 0.9], "label": w["outlier"]},
        {"type": "brace", "color": "warning", "points": [[3.4, -0.9], [8, -0.9]],
         "label": w["gap"]},
    ]


def _brace_angles(w):
    return [
        {"type": "polygon", "color": "primary", "points": [[-3, -1.5], [3, -1.5], [1, 2]],
         "labels": ["A", "B", "C"], "fill_opacity": 0.08},
        {"type": "brace", "color": "ink", "points": [[-3, -1.5], [3, -1.5]], "label": "6"},
        {"type": "angle", "color": "accent", "points": [[3, -1.5], [-3, -1.5], [1, 2]], "label": "α"},
        {"type": "angle", "color": "accent", "points": [[-3, -1.5], [3, -1.5], [1, 2]], "label": "β"},
    ]


def _inverse(w):
    return [
        {"type": "axes", "color": "ink", "position": [0, 0], "x_range": [-5, 5, 1],
         "y_range": [-5, 5, 1], "x_label": "x", "y_label": "y"},
        {"type": "polyline", "color": "primary", "points": _sample(lambda x: 1 / x, 0.25, 5),
         "label": "y=1/x"},
        {"type": "polyline", "color": "primary", "points": _sample(lambda x: 1 / x, -5, -0.25)},
    ]


def _dense(w):
    """Many labelled points at once — the crowding case."""
    return [
        {"type": "axes", "color": "ink", "position": [0, 0], "x_range": [0, 10, 1],
         "y_range": [0, 10, 1], "x_label": "x", "y_label": "y"},
        *[
            {"type": "point", "color": "accent", "points": [[i, (i * 7) % 10]],
             "label": f"P{i}"}
            for i in range(1, 10)
        ],
    ]


TOPICS: dict[str, Callable[[dict], list]] = {
    "right_triangle": _right_triangle,
    "similar_triangles": _similar_triangles,
    "parabola": _parabola,
    "sine": _sine,
    "absolute": _absolute,
    "midpoint": _midpoint,
    "circle": _circle,
    "circle_on_axes": _circle_on_axes,
    "parallel": _parallel,
    "rectangle": _rectangle,
    "number_line": _number_line,
    "number_line_wide": _number_line_wide,
    "number_line_annotated": _number_line_annotated,
    "brace_angles": _brace_angles,
    "inverse": _inverse,
    "dense_points": _dense,
}


# --- adversarial -------------------------------------------------------------
# Everything in this block has either broken the pipeline before or is one step
# away from something that did.

ADVERSARIAL: list[tuple[str, dict, bool]] = [
    ("label_on_the_line", {"elements": [
        {"type": "line", "color": "primary", "points": [[-4, 0], [4, 0]]},
        {"type": "text", "color": "ink", "position": [0, 0], "label": "הבסיס"},
    ]}, True),
    ("coincident_labels", {"elements": [
        {"type": "text", "color": "ink", "position": [0, 0], "label": "first"},
        {"type": "text", "color": "ink", "position": [0, 0], "label": "second"},
        {"type": "text", "color": "ink", "position": [0, 0], "label": "third"},
    ]}, True),
    ("caption_far_from_geometry", {"elements": [
        {"type": "polygon", "color": "primary", "points": [[0, 0], [0.4, 0], [0.4, 0.4]]},
        {"type": "text", "color": "ink", "position": [40, 40], "label": "רחוק"},
    ]}, True),
    ("very_long_labels", {"elements": [
        {"type": "polygon", "color": "primary", "points": [[-2, -1], [2, -1], [0, 2]],
         "labels": ["A" * 40, "B" * 40, "C" * 40],
         "side_labels": ["ד" * 40, "ه" * 40, "e" * 40]},
    ]}, True),
    ("mixed_scripts_one_label", {"elements": [
        {"type": "point", "color": "primary", "points": [[0, 0]], "label": "x=٣ ערך 5"},
    ]}, True),
    ("degenerate_triangle", {"elements": [
        {"type": "polygon", "color": "primary", "points": [[0, 0], [1, 0], [2, 0]],
         "labels": ["A", "B", "C"], "side_labels": ["1", "1", "2"]},
    ]}, True),
    ("tiny_geometry", {"elements": [
        {"type": "polygon", "color": "primary", "points": [[0, 0], [0.01, 0], [0, 0.01]],
         "labels": ["A", "B", "C"]},
    ]}, True),
    ("huge_coordinates", {"elements": [
        {"type": "line", "color": "primary", "points": [[-9999, -9999], [9999, 9999]], "label": "big"},
    ]}, True),
    ("max_elements", {"elements": [
        {"type": "point", "color": "primary", "points": [[(i % 11) - 5, (i // 11) - 1]],
         "label": f"p{i}"} for i in range(40)
    ]}, True),
    ("all_elements_invalid", {"elements": [
        {"type": "polygon", "color": "primary", "points": [[0, 0]]},
        {"type": "circle", "color": "primary", "center": [0, 0], "radius": 0.0},
        {"type": "nonsense", "color": "primary"},
    ]}, False),
    ("empty_elements", {"elements": []}, False),
    ("bad_molecule_only", {"render": "molecule", "elements": [
        {"type": "molecule", "color": "primary", "smiles": "C1CC"},
    ]}, False),
    ("molecule_aspirin", {"elements": [
        {"type": "molecule", "color": "primary", "smiles": "CC(=O)Oc1ccccc1C(=O)O",
         "label": "אספירין", "highlight": "C(=O)O"},
    ]}, True),
    ("molecule_water_3d", {"elements": [
        {"type": "molecule", "color": "primary", "smiles": "O", "label": "מים", "view": "3d"},
    ]}, True),
    ("molecule_plus_geometry", {"elements": [
        {"type": "molecule", "color": "primary", "smiles": "CCO", "label": "אתנול"},
        {"type": "point", "color": "primary", "points": [[0, 0]], "label": "P"},
    ]}, True),
    ("interactive_triangle", {"elements": [
        {"type": "polygon", "color": "primary", "points": [[-2, -1.5], [2, -1.5], [2, 1.5]],
         "labels": ["A", "B", "C"], "side_labels": ["4", "3", "5"]},
    ], "interactive": {"handles": [{"element": 0, "vertex": 2}]}}, True),
    ("interactive_bad_handle", {"elements": [
        {"type": "polygon", "color": "primary", "points": [[-2, -1.5], [2, -1.5], [2, 1.5]],
         "labels": ["A", "B", "C"]},
    ], "interactive": {"handles": [{"element": 9, "vertex": 99}]}}, True),
]


def build_corpus() -> list[Case]:
    """topic x language x mode, plus the adversarial block."""
    cases: list[Case] = []
    for topic, build in TOPICS.items():
        for lang, words in WORDS.items():
            for animated in (False, True):
                mode = "video" if animated else "still"
                cases.append(Case(
                    id=f"{topic}.{lang}.{mode}",
                    raw={
                        "use_visual": True,
                        "title": f"{topic} ({lang})",
                        "alt": topic,
                        "caption": words["line"],
                        "animated": animated,
                        "elements": build(words),
                    },
                    tags=frozenset({topic, lang, mode, "topic"}),
                ))

    for name, body, expect in ADVERSARIAL:
        cases.append(Case(
            id=f"adversarial.{name}",
            raw={"use_visual": True, "title": name, "alt": name, "caption": "", **body},
            tags=frozenset({"adversarial", name}),
            expect_visual=expect,
        ))
    return cases


CORPUS = build_corpus()
