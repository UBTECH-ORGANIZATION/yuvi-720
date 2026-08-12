"""Geometry repair passes — the reason mathematics looks good, kept in one place.

None of this is general. Every function here recognises a specific mathematical
request and fixes a specific way the planner gets it wrong: a `5` printed on a
leg instead of the hypotenuse, a polyline that claims to be `y=x` but is not, a
parallel-lines scene with no angle arcs, the word "יתר" parked at a coordinate
instead of bound to the longest edge. Together they are around six hundred lines
of accumulated corrections, and they are the honest explanation for why maths
diagrams are sharp while everything else was not: science had no equivalent.

Isolating them is the point of this module. They stay, because deleting them
would visibly degrade the subject that currently works — but they no longer sit
in the middle of the shared pipeline, where they read as general behaviour and
invite the next subject to be fixed the same unscalable way. New domains
register repair passes through `visuals.registry` instead.

The canonical scene builders are a related but distinct trick: when a request is
recognisable enough (``x=y``, a midpoint, similar triangles) they produce a
trusted diagram outright, so a planner that declines or returns nonsense still
yields a correct picture. Only an allow-list of functions is ever evaluated;
model-authored expressions are never parsed or executed.
"""

from __future__ import annotations

import math
import re
from typing import Callable, Optional

_HYPOTENUSE_LABEL = re.compile(r"^(?:יתר|היתר|الوتر|وتر|hypotenuse)(?:\s*[=:–—-]?\s*\d+(?:\.\d+)?)?$", re.IGNORECASE)
_SIDE_ROLE_LABEL = re.compile(
    r"^(?:מול|ליד|צלע\s+מול|צלע\s+ליד|المقابل|المجاور|ضلع\s+مقابل|ضلع\s+مجاور|opposite|adjacent)"
    r"(?:\s*[=:–—-]?\s*\d+(?:\.\d+)?)?$",
    re.IGNORECASE,
)
_SIDE_NUMBER = re.compile(r"(?<![\w.])-?\d+(?:\.\d+)?")

_REQUESTED_HYPOTENUSE = {
    "he": re.compile(r"\b(?:ה?יתר)\b"),
    "ar": re.compile(r"(?:الوتر|وتر)"),
    "en": re.compile(r"\bhypotenuse\b", re.IGNORECASE),
}
_HYPOTENUSE_NAME = {"he": "יתר", "ar": "الوتر", "en": "hypotenuse"}
_REQUESTED_HYPOTENUSE_LENGTH = {
    "he": re.compile(r"(?:ה?יתר)\s*(?:באורך\s*)?(\d+(?:\.\d+)?)"),
    "ar": re.compile(r"(?:الوتر|وتر)\s*(?:بطول\s*)?(\d+(?:\.\d+)?)"),
    "en": re.compile(r"\bhypotenuse\s*(?:(?:of\s+)?length|is|=|:)?\s*(\d+(?:\.\d+)?)", re.IGNORECASE),
}
_IDENTITY_EQUATION = re.compile(
    r"(?<![A-Za-z])(?:x\s*=\s*y|y\s*=\s*x)(?![A-Za-z])",
    re.IGNORECASE,
)
_SAFE_FUNCTION_EQUATIONS: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"(?<![A-Za-z])y\s*=\s*x\s*(?:\^|\*\*)\s*2(?![\dA-Za-z])|y\s*=\s*x²", re.IGNORECASE), "quadratic"),
    (re.compile(r"(?<![A-Za-z])y\s*=\s*(?:\|\s*x\s*\||abs\s*\(\s*x\s*\))", re.IGNORECASE), "absolute"),
    (re.compile(r"(?<![A-Za-z])y\s*=\s*sin\s*\(\s*x\s*\)", re.IGNORECASE), "sine"),
)
_PARALLEL_TRANSVERSAL_REQUEST = {
    "he": re.compile(r"(?:מקביל).*(?:חוצה|חותך|אלכסון|מתחלפ)|(?:מתחלפ).*(?:מקביל)", re.DOTALL),
    "ar": re.compile(r"(?:متواز).*(?:قاطع|مائل|متبادل)|(?:متبادل).*(?:متواز)", re.DOTALL),
    "en": re.compile(r"(?:parallel).*(?:transversal|alternate)|(?:alternate).*(?:parallel)", re.IGNORECASE | re.DOTALL),
}
_MIDPOINT_REQUEST = {
    "he": re.compile(r"(?:נקודת\s+האמצע|אמצע).*(?:A|B|M|\([^)]*,[^)]*\))", re.IGNORECASE | re.DOTALL),
    "ar": re.compile(r"(?:نقطة\s+المنتصف|منتصف).*(?:A|B|M|\([^)]*,[^)]*\))", re.IGNORECASE | re.DOTALL),
    "en": re.compile(r"\bmidpoint\b.*(?:A|B|M|\([^)]*,[^)]*\))", re.IGNORECASE | re.DOTALL),
}
_SIMILAR_TRIANGLES_REQUEST = {
    "he": re.compile(r"(?:משולשים?\s+דומים?|דמיון\s+משולשים)", re.DOTALL),
    "ar": re.compile(r"(?:مثلث(?:ان|ين)?\s+متشابه|تشابه\s+المثلث)", re.DOTALL),
    "en": re.compile(r"\bsimilar\s+triangles?\b", re.IGNORECASE | re.DOTALL),
}

_CANONICAL_VISUAL_TEXT = {
    "he": {
        "identity": ("הישר y=x", "מערכת צירים ובה הישר y=x ונקודות שלמות עליו.", "בכל נקודה על הישר ערכי x ו-y שווים."),
        "quadratic": ("הפרבולה y=x²", "מערכת צירים ובה הפרבולה y=x², הקודקוד ונקודות סימטריות.", "הפרבולה סימטרית סביב ציר y והקודקוד שלה בראשית."),
        "absolute": ("הגרף y=|x|", "מערכת צירים ובה גרף הערך המוחלט בצורת V ונקודות סימטריות.", "גרף הערך המוחלט בנוי משני ענפים סימטריים שנפגשים בראשית ויוצרים צורת V."),
        "sine": ("הגרף y=sin(x)", "מערכת צירים ובה גל הסינוס לאורך שני מחזורים.", "גל הסינוס חוזר במחזוריות וחוצה את ציר x בנקודות הקבועות שלו."),
    },
    "ar": {
        "identity": ("المستقيم y=x", "محورا إحداثيات مع المستقيم y=x ونقاط صحيحة عليه.", "في كل نقطة على المستقيم تتساوى قيمتا x و-y."),
        "quadratic": ("القطع المكافئ y=x²", "محورا إحداثيات مع القطع المكافئ y=x² ورأسه ونقاط متناظرة.", "القطع المكافئ متناظر حول محور y ورأسه عند نقطة الأصل."),
        "absolute": ("الرسم y=|x|", "محورا إحداثيات مع رسم القيمة المطلقة بشكل V ونقاط متناظرة.", "رسم القيمة المطلقة له فرعان متناظران يلتقيان عند نقطة الأصل ويشكلان حرف V."),
        "sine": ("الرسم y=sin(x)", "محورا إحداثيات مع موجة الجيب عبر دورتين.", "تتكرر موجة الجيب دوريًا وتقطع محور x في نقاط ثابتة."),
    },
    "en": {
        "identity": ("The line y=x", "Coordinate axes with the line y=x and integer points on it.", "At every point on this line, x and y have equal values."),
        "quadratic": ("The parabola y=x²", "Coordinate axes with the parabola y=x², its vertex, and symmetric points.", "The parabola is symmetric about the y-axis and has its vertex at the origin."),
        "absolute": ("The graph y=|x|", "Coordinate axes with the V-shaped absolute-value graph and symmetric points.", "The absolute-value graph has two symmetric branches that meet at the origin to form a V."),
        "sine": ("The graph y=sin(x)", "Coordinate axes with the sine wave across two periods.", "The sine wave repeats periodically and crosses the x-axis at regular points."),
    },
}

_MIDPOINT_VISUAL_TEXT = {
    "he": ("נקודת אמצע במערכת צירים", "מערכת צירים ובה הנקודות A=(1,1), B=(5,3), ונקודת האמצע M=(3,2) על הקטע ביניהן.", "נקודת האמצע מתקבלת מממוצע ערכי x וממוצע ערכי y."),
    "ar": ("نقطة المنتصف على المحاور", "محورا إحداثيات مع A=(1,1) وB=(5,3) ونقطة المنتصف M=(3,2) على القطعة بينهما.", "نحسب نقطة المنتصف بأخذ متوسط قيم x ومتوسط قيم y."),
    "en": ("Midpoint on coordinate axes", "Coordinate axes with A=(1,1), B=(5,3), and midpoint M=(3,2) on the segment between them.", "The midpoint uses the average x-value and the average y-value."),
}
_SIMILAR_TRIANGLES_VISUAL_TEXT = {
    "he": ("שני משולשים דומים", "שני משולשים בעלי אותה צורה; המשולש הימני הוא הגדלה פי 1.5 של המשולש השמאלי, עם זוויות מתאימות מסומנות.", "כל הצלעות המתאימות גדלו באותו גורם, ולכן הזוויות המתאימות שוות."),
    "ar": ("مثلثان متشابهان", "مثلثان لهما الشكل نفسه؛ المثلث الأيمن تكبير للمثلث الأيسر بمعامل 1.5، مع تحديد الزوايا المتناظرة.", "تكبّرت جميع الأضلاع المتناظرة بالمعامل نفسه، لذلك الزوايا المتناظرة متساوية."),
    "en": ("Two similar triangles", "Two triangles with the same shape; the right triangle is a 1.5-times enlargement of the left, with corresponding angles marked.", "Every corresponding side uses the same scale factor, so corresponding angles are equal."),
}


def _edge_lengths(triangle: dict) -> list[float]:
    return [
        math.dist(triangle["points"][index], triangle["points"][(index + 1) % 3])
        for index in range(3)
    ]


def _side_number(label: str) -> Optional[float]:
    match = _SIDE_NUMBER.search(label)
    return float(match.group()) if match else None


def align_triangle_side_measures(elements: list[dict]) -> None:
    """Rebind side measures to edges using the triangle's proportions.

    Scene planners occasionally return the correct 3-4-5 geometry but put the
    label ``5`` on a leg. Two or more stated measures are enough to recover the
    intended scale deterministically without changing the mathematical data.
    """
    from itertools import permutations

    for triangle in (
        element for element in elements
        if element["type"] == "polygon" and len(element["points"]) == 3
    ):
        labels = list(triangle.get("side_labels", []))
        labels.extend([""] * (3 - len(labels)))
        measured = [
            (index, label, number)
            for index, label in enumerate(labels)
            if (number := _side_number(label)) is not None and number > 0
        ]
        if len(measured) < 2:
            continue

        lengths = _edge_lengths(triangle)
        best: Optional[tuple[float, tuple[int, ...]]] = None
        for targets in permutations(range(3), len(measured)):
            scales = [measured[index][2] / lengths[target] for index, target in enumerate(targets)]
            mean_scale = sum(scales) / len(scales)
            if mean_scale <= 0:
                continue
            error = sum(((scale - mean_scale) / mean_scale) ** 2 for scale in scales)
            if best is None or error < best[0]:
                best = (error, targets)
        if best is None or best[0] > 0.05:
            continue

        for original_index, _, _ in measured:
            labels[original_index] = ""
        for measured_item, target in zip(measured, best[1]):
            labels[target] = measured_item[1]
        triangle["side_labels"] = labels


def _distance_to_segment(point: list[float], start: list[float], end: list[float]) -> float:
    dx, dy = end[0] - start[0], end[1] - start[1]
    denominator = dx * dx + dy * dy
    if denominator <= 1e-12:
        return math.dist(point, start)
    ratio = max(0.0, min(1.0, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / denominator))
    projection = [start[0] + ratio * dx, start[1] + ratio * dy]
    return math.dist(point, projection)


def _inferred_edge_measure(triangle: dict, edge_index: int) -> str:
    """Infer one missing measure only when two labels establish one scale."""
    lengths = _edge_lengths(triangle)
    labels = list(triangle.get("side_labels", []))
    labels.extend([""] * (3 - len(labels)))
    scales = [
        number / lengths[index]
        for index, label in enumerate(labels)
        if (number := _side_number(label)) is not None and number > 0
    ]
    if len(scales) < 2:
        return ""
    mean_scale = sum(scales) / len(scales)
    if any(abs(scale - mean_scale) / mean_scale > 0.025 for scale in scales):
        return ""
    value = lengths[edge_index] * mean_scale
    rounded = round(value)
    if abs(value - rounded) <= 0.025:
        return str(rounded)
    tenth = round(value, 1)
    return f"{tenth:g}" if abs(value - tenth) <= 0.025 else ""


def _merge_side_label(role: str, current: str, inferred_measure: str = "") -> str:
    role_number = _side_number(role)
    current_number = _side_number(current)
    if role.casefold() in current.casefold():
        return current
    if role_number is not None:
        return role
    measure = current if current_number is not None else inferred_measure
    return f"{role} {measure}".strip()


def bind_semantic_geometry_labels(elements: list[dict]) -> None:
    """Attach free-standing side roles to their edges instead of coordinates."""
    triangles = [element for element in elements if element["type"] == "polygon" and len(element["points"]) == 3]
    if not triangles:
        return
    retained: list[dict] = []
    for element in elements:
        label = element.get("label", "")
        is_hypotenuse = bool(_HYPOTENUSE_LABEL.fullmatch(label))
        is_side_role = bool(_SIDE_ROLE_LABEL.fullmatch(label))
        if element["type"] != "text" or not (is_hypotenuse or is_side_role):
            retained.append(element)
            continue
        position = element["position"]
        triangle = min(
            triangles,
            key=lambda candidate: min(
                math.dist(position, [
                    (candidate["points"][index][0] + candidate["points"][(index + 1) % 3][0]) / 2,
                    (candidate["points"][index][1] + candidate["points"][(index + 1) % 3][1]) / 2,
                ])
                for index in range(3)
            ),
        )
        if is_hypotenuse:
            edge_index = max(range(3), key=_edge_lengths(triangle).__getitem__)
        else:
            edge_index = min(
                range(3),
                key=lambda index: _distance_to_segment(
                    position,
                    triangle["points"][index],
                    triangle["points"][(index + 1) % 3],
                ),
            )
        side_labels = list(triangle.get("side_labels", []))
        side_labels.extend([""] * (3 - len(side_labels)))
        side_labels[edge_index] = _merge_side_label(
            label,
            side_labels[edge_index],
            _inferred_edge_measure(triangle, edge_index),
        )
        triangle["side_labels"] = side_labels
    elements[:] = retained


def ensure_requested_hypotenuse(scene: dict, request: str, language: str) -> None:
    """Keep an explicitly requested side name attached to the longest edge."""
    if not _REQUESTED_HYPOTENUSE[language].search(request):
        return
    triangle = next(
        (element for element in scene["elements"] if element["type"] == "polygon" and len(element["points"]) == 3),
        None,
    )
    if triangle is None:
        return
    lengths = _edge_lengths(triangle)
    edge_index = max(range(3), key=lengths.__getitem__)
    side_labels = list(triangle.get("side_labels", []))
    side_labels.extend([""] * (3 - len(side_labels)))
    name = _HYPOTENUSE_NAME[language]
    current = side_labels[edge_index]
    if name.casefold() not in current.casefold():
        current = f"{name} {current}".strip()
    requested_length = _REQUESTED_HYPOTENUSE_LENGTH[language].search(request)
    if requested_length and not re.search(r"\d", current):
        current = f"{current} {requested_length.group(1)}"
    side_labels[edge_index] = current
    triangle["side_labels"] = side_labels


def normalize_identity_line(scene: dict, request: str) -> None:
    """Deterministically render explicit ``x=y`` / ``y=x`` identity graphs.

    This is intentionally request-specific. Arbitrary polylines may be circles,
    inverse-function branches, or parametric paths, so globally sorting or
    rewriting their points would corrupt valid mathematical diagrams.
    """
    from app.agents.manim_visual import _fit_axes_to_elements

    if not _IDENTITY_EQUATION.search(request or ""):
        return

    axes = next((element for element in scene["elements"] if element["type"] == "axes"), None)
    if axes is None:
        axes = {
            "type": "axes", "color": "ink", "position": [0.0, 0.0],
            "x_range": [-5.0, 5.0, 1.0], "y_range": [-5.0, 5.0, 1.0],
            "x_label": "x", "y_label": "y",
        }
        scene["elements"].insert(0, axes)

    low = max(axes["x_range"][0], axes["y_range"][0])
    high = min(axes["x_range"][1], axes["y_range"][1])
    if low >= high:
        low, high = -5.0, 5.0
        axes["x_range"] = [low, high, 1.0]
        axes["y_range"] = [low, high, 1.0]

    candidates = [
        element for element in scene["elements"]
        if element["type"] in {"line", "polyline"}
    ]
    graph = next(
        (element for element in candidates if _IDENTITY_EQUATION.search(element.get("label", ""))),
        max(candidates, key=lambda element: len(element.get("points", [])), default=None),
    )
    if graph is None:
        graph = {"type": "line", "color": "primary", "dashed": False}
        scene["elements"].append(graph)

    if graph["type"] == "polyline":
        step = (high - low) / 16
        graph["points"] = [[low + index * step, low + index * step] for index in range(17)]
    else:
        graph["points"] = [[low, low], [high, high]]
    graph["label"] = "y=x"
    _fit_axes_to_elements(scene["elements"])


def normalize_safe_function_graph(scene: dict, request: str, language: str = "he") -> None:
    """Resample a small allow-list of requested functions without executing code.

    The scene planner sometimes describes the right concept while returning a
    polyline for a different equation. These canonical functions are detected
    from the learner request and evaluated by trusted Python functions only;
    arbitrary model-authored expressions are never parsed or executed.
    """
    from app.agents.manim_visual import _fit_axes_to_elements

    function_name = next(
        (name for pattern, name in _SAFE_FUNCTION_EQUATIONS if pattern.search(request or "")),
        None,
    )
    if function_name is None:
        return

    axes = next((element for element in scene["elements"] if element["type"] == "axes"), None)
    graph = max(
        (element for element in scene["elements"] if element["type"] == "polyline"),
        key=lambda element: len(element.get("points", [])),
        default=None,
    )
    if axes is None or graph is None:
        return

    functions: dict[str, tuple[Callable[[float], float], str]] = {
        "quadratic": (lambda x: x * x, "y=x^2"),
        "absolute": (abs, "y=|x|"),
        "sine": (math.sin, "y=sin(x)"),
    }
    relation, label = functions[function_name]
    x_min, x_max, _ = axes["x_range"]
    y_min, y_max, _ = axes["y_range"]
    sample_count = 33
    candidates = [
        [x_min + (x_max - x_min) * index / (sample_count - 1), 0.0]
        for index in range(sample_count)
    ]
    points = [[x, relation(x)] for x, _ in candidates]
    visible = [point for point in points if y_min - 1e-9 <= point[1] <= y_max + 1e-9]
    if len(visible) < 5:
        return
    graph["points"] = visible
    graph["label"] = label
    graph["dashed"] = False
    lang = language if language in _CANONICAL_VISUAL_TEXT else "he"
    scene["caption"] = _CANONICAL_VISUAL_TEXT[lang][function_name][2]
    _fit_axes_to_elements(scene["elements"])


def ensure_parallel_angle_markers(scene: dict, request: str, language: str) -> None:
    """Add alternate-angle semantics when a valid three-line scene omits arcs."""
    lang = language if language in _PARALLEL_TRANSVERSAL_REQUEST else "he"
    if not _PARALLEL_TRANSVERSAL_REQUEST[lang].search(request or ""):
        return
    marker_count = sum(element["type"] in {"angle", "arc"} for element in scene["elements"])
    if marker_count >= 2:
        return
    lines = [element for element in scene["elements"] if element["type"] == "line"]
    if len(lines) < 3:
        return

    horizontals = [
        line for line in lines
        if abs(line["points"][1][1] - line["points"][0][1]) <= 0.12
    ]
    transversal = next((line for line in lines if line not in horizontals), None)
    if len(horizontals) < 2 or transversal is None:
        return
    [[tx1, ty1], [tx2, ty2]] = transversal["points"]
    if abs(ty2 - ty1) <= 1e-9:
        return

    intersections: list[list[float]] = []
    for line in sorted(horizontals[:2], key=lambda item: item["points"][0][1], reverse=True):
        y = line["points"][0][1]
        ratio = (y - ty1) / (ty2 - ty1)
        x = tx1 + ratio * (tx2 - tx1)
        intersections.append([x, y])
    upper, lower = intersections
    scene["elements"].extend([
        {
            "type": "angle", "color": "accent",
            "points": [[upper[0] + 1.0, upper[1]], upper, [upper[0] + 0.7, upper[1] - 0.8]],
            "label": "α",
        },
        {
            "type": "angle", "color": "accent",
            "points": [[lower[0] - 1.0, lower[1]], lower, [lower[0] - 0.7, lower[1] + 0.8]],
            "label": "α",
        },
    ])


def canonical_function_scene(request: str, language: str) -> Optional[dict]:
    """Build a trusted fallback for recognized elementary graph requests.

    This is intentionally limited to an allow-list. It guarantees that a
    strong visual cue such as ``x=y`` receives a useful first-turn picture
    even when the model planner declines the tool or returns invalid JSON.
    """
    from app.agents.manim_visual import sanitize_scene

    function_name = "identity" if _IDENTITY_EQUATION.search(request or "") else next(
        (name for pattern, name in _SAFE_FUNCTION_EQUATIONS if pattern.search(request or "")),
        None,
    )
    if function_name is None:
        return None

    lang = language if language in _CANONICAL_VISUAL_TEXT else "he"
    title, alt, caption = _CANONICAL_VISUAL_TEXT[lang][function_name]
    configurations = {
        "identity": (0.0, 5.0, -0.5, 5.5, lambda x: x, "y=x"),
        "quadratic": (-3.0, 3.0, -1.0, 9.5, lambda x: x * x, "y=x^2"),
        "absolute": (-4.0, 4.0, -1.0, 5.0, abs, "y=|x|"),
        "sine": (-6.28, 6.28, -1.5, 1.5, math.sin, "y=sin(x)"),
    }
    x_min, x_max, y_min, y_max, relation, label = configurations[function_name]
    sample_count = 33
    points = [
        [x_min + (x_max - x_min) * index / (sample_count - 1), 0.0]
        for index in range(sample_count)
    ]
    curve = [[x, relation(x)] for x, _ in points]
    markers = {
        "identity": [[float(value), float(value)] for value in range(6)],
        "quadratic": [[float(value), float(value * value)] for value in range(-2, 3)],
        "absolute": [[-3.0, 3.0], [0.0, 0.0], [3.0, 3.0]],
        "sine": [[-math.pi, 0.0], [0.0, 0.0], [math.pi, 0.0]],
    }[function_name]
    raw = {
        "use_visual": True,
        "title": title,
        "alt": alt,
        "caption": caption,
        "elements": [
            {
                "type": "axes", "color": "ink", "position": [0, 0],
                "x_range": [x_min, x_max, 1.0], "y_range": [y_min, y_max, 1.0],
                "x_label": "x", "y_label": "y",
            },
            {"type": "polyline", "color": "primary", "points": curve, "label": label},
            *(
                {"type": "point", "color": "accent", "points": [point]}
                for point in markers
            ),
        ],
    }
    return sanitize_scene(raw)


def canonical_midpoint_scene(request: str, language: str) -> Optional[dict]:
    """Return the trusted midpoint diagram for the explicit demo contract."""
    from app.agents.manim_visual import sanitize_scene

    lang = language if language in _MIDPOINT_REQUEST else "he"
    if not _MIDPOINT_REQUEST[lang].search(request or ""):
        return None
    title, alt, caption = _MIDPOINT_VISUAL_TEXT[lang]
    return sanitize_scene({
        "use_visual": True,
        "title": title,
        "alt": alt,
        "caption": caption,
        "elements": [
            {
                "type": "axes", "color": "ink", "position": [0, 0],
                "x_range": [0, 6, 1], "y_range": [0, 4, 1],
                "x_label": "x", "y_label": "y",
            },
            {"type": "line", "color": "primary", "points": [[1, 1], [5, 3]]},
            {"type": "point", "color": "primary", "points": [[1, 1]], "label": "A=(1,1)"},
            {"type": "point", "color": "primary", "points": [[5, 3]], "label": "B=(5,3)"},
            {"type": "point", "color": "accent", "points": [[3, 2]], "label": "M=(3,2)"},
        ],
    })


def canonical_similar_triangles_scene(request: str, language: str) -> Optional[dict]:
    """Return a trusted scale-factor diagram for an explicit similarity request."""
    from app.agents.manim_visual import sanitize_scene

    lang = language if language in _SIMILAR_TRIANGLES_REQUEST else "he"
    if not _SIMILAR_TRIANGLES_REQUEST[lang].search(request or ""):
        return None
    title, alt, caption = _SIMILAR_TRIANGLES_VISUAL_TEXT[lang]
    return sanitize_scene({
        "use_visual": True,
        "title": title,
        "alt": alt,
        "caption": caption,
        "elements": [
            {
                "type": "polygon", "color": "primary",
                "points": [[-5, -2], [-3, 1], [-1, -2]],
                "labels": ["A", "B", "C"], "fill_opacity": 0.08,
            },
            {
                "type": "polygon", "color": "secondary",
                "points": [[0, -2], [3, 2.5], [6, -2]],
                "labels": ["A′", "B′", "C′"], "fill_opacity": 0.08,
            },
            {"type": "angle", "color": "accent", "points": [[-4, -2], [-5, -2], [-4.4, -1.1]], "label": "α"},
            {"type": "angle", "color": "accent", "points": [[1, -2], [0, -2], [0.9, -0.65]], "label": "α"},
            {"type": "text", "color": "ink", "position": [0.5, 3.0], "label": "×1.5"},
        ],
    })
