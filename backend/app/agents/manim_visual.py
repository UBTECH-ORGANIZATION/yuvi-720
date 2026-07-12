"""Safe Manim visualization tool for the Learning Coach (F3).

The model may request a drawing by returning a small, validated scene spec.  The
spec is rendered in an isolated worker process; model-authored Python is never
executed.  If Manim is unavailable, the same spec becomes a deterministic SVG
so the companion remains demoable offline.
"""

from __future__ import annotations

import asyncio
import base64
from html import escape
import json
import math
import os
from pathlib import Path
import re
import sys
import tempfile
from typing import Callable, Optional
from uuid import uuid4

from app.services.ai_usage import UsageContext
from app.services.llm import call_llm


MAX_ELEMENTS = 24
MAX_LABEL_LENGTH = 48
MAX_POLYLINE_POINTS = 80
X_LIMIT = 6.6
Y_LIMIT = 3.4
# Manim's first isolated worker can spend most of its time importing and
# initializing native rendering dependencies. Keep the timeout bounded while
# allowing that cold start; warm renders ordinarily complete in a few seconds.
RENDER_TIMEOUT_SECONDS = 45

COLORS = {
    "primary": "#6f5bff",
    "secondary": "#33b8cf",
    "accent": "#f2a91b",
    "success": "#21a67a",
    "warning": "#df704d",
    "ink": "#302b4a",
    "muted": "#77718f",
    "white": "#ffffff",
}

VISUAL_TOOL_PROMPTS = {
    "he": (
        "את/ה כלי תכנון שרטוטים לימודיים עבור יובי. החלט/י אם שרטוט יעזור ממש להבנת "
        "הפנייה והתשובה. אין לחכות לבקשה מפורשת לציור: כבר בפנייה הראשונה יש לבחור בהמחשה "
        "כאשר צורה, מיקום, קשר כמותי, שינוי, חלקים, השוואה או רצף נעשים ברורים יותר במבט. "
        "אם הלומד/ת ביקש/ה במפורש גרף, שרטוט או המחשה, חובה לבחור בהמחשה. "
        "אין להוסיף המחשה קישוטית לשיחה חברתית או לתשובה עובדתית פשוטה. "
        "החזר/י JSON בלבד. אם לא: {\"use_visual\":false}. אם כן: "
        "{\"use_visual\":true,\"title\":\"...\",\"alt\":\"...\",\"caption\":\"...\","
        "\"elements\":[...]}. שמור/י על למידה פעילה: הצג/י את הנתונים, לא את פתרון התרגיל הסופי."
    ),
    "ar": (
        "أنت أداة تخطيط رسومات تعليمية ليوفي. قرّر إن كان الرسم يساعد فعلًا على فهم الطلب والرد. "
        "لا تنتظر طلبًا صريحًا للرسم: اختر توضيحًا من الرسالة الأولى عندما تصبح الهيئة أو الموضع "
        "أو العلاقة الكمية أو التغيّر أو الأجزاء أو المقارنة أو التسلسل أوضح بالنظر. "
        "إذا طلب المتعلم صراحة رسمًا أو مخططًا أو تمثيلًا بيانيًا، فيجب اختيار الرسم. "
        "لا تضف رسمًا زخرفيًا لمحادثة اجتماعية أو لإجابة واقعية بسيطة. "
        "أعد JSON فقط. إن لم يلزم: {\"use_visual\":false}. وإن لزم: "
        "{\"use_visual\":true,\"title\":\"...\",\"alt\":\"...\",\"caption\":\"...\","
        "\"elements\":[...]}. حافظ على التعلم النشط: اعرض المعطيات لا الحل النهائي."
    ),
    "en": (
        "You are Yuvi's educational drawing-planning tool. Decide whether a drawing materially helps "
        "the learner understand the request and response. Do not wait for an explicit drawing request: "
        "on the first turn choose a visual when shape, position, quantitative relationship, change, parts, "
        "comparison, or sequence becomes clearer at a glance. Do not add a decorative visual to social "
        "conversation or a simple factual answer. If the learner explicitly requests a graph, "
        "diagram, drawing, plot, or visualization, you must select a visual. Return JSON only. If not: "
        "{\"use_visual\":false}. If yes: {\"use_visual\":true,\"title\":\"...\","
        "\"alt\":\"...\",\"caption\":\"...\",\"elements\":[...]}. Preserve active learning: "
        "show the givens, not the exercise's final solution."
    ),
}

SCENE_CONTRACT = """
Canvas coordinates: x=-6.6..6.6, y=-3.4..3.4. Use at most 24 elements.
Allowed elements:
- {"type":"polygon","points":[[x,y],...],"labels":["A",...],"side_labels":["3","יתר","4"],"color":"primary","fill_opacity":0.08}
- {"type":"polyline","points":[[x,y],...],"label":"optional","color":"primary","dashed":false}
- {"type":"line"|"arrow","points":[[x1,y1],[x2,y2]],"label":"optional","color":"ink","dashed":false}
- {"type":"point","points":[[x,y]],"label":"A","color":"primary"}
- {"type":"circle","center":[x,y],"radius":1.2,"label":"optional","color":"primary"}
- {"type":"rectangle","center":[x,y],"width":2.0,"height":1.2,"label":"optional","color":"primary","fill_opacity":0.08}
- {"type":"arc","center":[x,y],"radius":1.2,"start_angle":0.0,"angle":1.57,"label":"optional","color":"primary"}
- {"type":"angle","points":[[ray1x,ray1y],[vertexx,vertexy],[ray2x,ray2y]],"label":"α","color":"accent"}
- {"type":"right_angle","points":[[ray1x,ray1y],[vertexx,vertexy],[ray2x,ray2y]],"color":"accent"}
- {"type":"axes","position":[x,y],"x_range":[-5,5,1],"y_range":[-3,3,1],"x_label":"x","y_label":"y","color":"ink"}
- {"type":"text","position":[x,y],"label":"short text","color":"ink"}
Colors: primary, secondary, accent, success, warning, ink, muted, white.
IMPORTANT: When an axes element is present, coordinates in every other element are mathematical
DATA coordinates from the axes ranges, not canvas positions. For example, point [4,4] is placed with
axes.c2p(4,4). Do not manually offset or rescale graph points. Set x_range and y_range so every
point, curve, shape, and label fits inside the axes with some margin. Include each factual point exactly once.
Coordinates are always ordered [x,y]. Rewrite equations that define a function into y=f(x) before
sampling. In particular, x=y and y=x are the same identity line: plot ordered points [x,x] and label it y=x.
For curves and function graphs, sample the curve into one polyline (up to 80 points). Compose any
other mathematical diagram from these primitives. Keep labels short. Never include personal data.
For polygon side_labels, index i labels the edge from points[i] to points[(i+1) mod n]; use an
empty string for an unlabeled edge. Put semantic side names such as יתר on the actual side, never
as a free-standing text element. Use right_angle instead of a floating "90°" text label.
Use only the selected language plus conventional mathematical notation.
"""

_FENCED_BLOCK = re.compile(r"```[^\n]*\n?[\s\S]*?```", re.MULTILINE)
_FORMULA_TEXT = re.compile(
    r"(?:=|\\frac|\\sqrt|\b(?:sin|cos|tan|log)\s*\(|[A-Za-zα-ωΑ-Ωθ]\s*[\^/])",
    re.IGNORECASE,
)

_EXPLICIT_VISUAL_REQUEST = {
    "he": re.compile(r"(?:צייר|שרטט|שרטוט|גרף|המחשה|הדגמה חזותית)"),
    "ar": re.compile(r"(?:ارسم|رسم|مخطط|بيان|تمثيل بصري|تصوّر)"),
    "en": re.compile(r"\b(?:draw|drawing|diagram|graph|plot|visuali[sz](?:e|ation))\b", re.IGNORECASE),
}

# Structural signals, rather than a list of school subjects. They identify a
# relationship that is often easier to inspect than to hold entirely in text.
_IMPLICIT_VISUAL_BENEFIT = {
    "he": re.compile(r"(?:[=<>≤≥]|\([^()]{0,16},[^()]{0,16}\)|\b(?:שלב(?:ים)?|תהליך|רצף|מיקום|בין|מול|ליד|משתנה|עולה|יורד|יחס|השוואה|חלקים|מבנה|ציר|נקוד(?:ה|ות)|זווית)\b)"),
    "ar": re.compile(r"(?:[=<>≤≥]|\([^()]{0,16},[^()]{0,16}\)|(?:خطوات|عملية|تسلسل|موضع|بين|مقابل|بجوار|يتغير|يزداد|ينخفض|نسبة|مقارنة|أجزاء|بنية|محور|نقطة|زاوية))"),
    "en": re.compile(r"(?:[=<>≤≥]|\([^()]{0,16},[^()]{0,16}\)|\b(?:steps?|process|sequence|position|between|opposite|beside|changes?|increases?|decreases?|ratio|comparison|parts?|structure|axis|points?|angle)\b)", re.IGNORECASE),
}

_VISUAL_RETRY_PROMPT = {
    "he": "בחן/י שוב את הערך הפדגוגי, גם אם לא נכתב 'צייר'. הקשר כאן מתאים להבנה חזותית; החזר/י סצנה תקינה עם use_visual=true.",
    "ar": "أعد تقييم الفائدة التعليمية حتى دون كلمة «ارسم». العلاقة هنا مناسبة للفهم البصري؛ أعد مشهدًا صالحًا مع use_visual=true.",
    "en": "Re-evaluate the pedagogical value even without the word 'draw'. This relationship benefits from being seen; return a valid use_visual=true scene.",
}

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


def split_visual_response(text: str) -> tuple[str, str]:
    """Remove a duplicate fenced diagram and place the visual at that point.

    If the Coach followed its instruction and emitted no duplicate block, the
    visual is placed after the first paragraph. This is content-agnostic and
    works for every mathematical topic supported by the scene primitives.
    """
    response = (text or "").strip()
    fenced = _FENCED_BLOCK.search(response)
    if fenced:
        before = response[:fenced.start()].rstrip()
        after = response[fenced.end():].lstrip()
        return before, after

    paragraph_break = re.search(r"\n\s*\n", response)
    if paragraph_break:
        return response[:paragraph_break.start()].rstrip(), response[paragraph_break.end():].lstrip()
    return response, ""


def _number(value: object, limit: float) -> Optional[float]:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    number = float(value)
    if not math.isfinite(number):
        return None
    return max(-limit, min(limit, number))


def _point(value: object) -> Optional[list[float]]:
    if not isinstance(value, list) or len(value) != 2:
        return None
    x = _number(value[0], X_LIMIT)
    y = _number(value[1], Y_LIMIT)
    return [x, y] if x is not None and y is not None else None


def _data_point(value: object) -> Optional[list[float]]:
    """Validate mathematical coordinates without applying canvas bounds."""
    if not isinstance(value, list) or len(value) != 2:
        return None
    x = _number(value[0], 100.0)
    y = _number(value[1], 100.0)
    return [x, y] if x is not None and y is not None else None


def _range(value: object) -> Optional[list[float]]:
    if not isinstance(value, list) or len(value) != 3:
        return None
    start = _number(value[0], 100.0)
    end = _number(value[1], 100.0)
    step = _number(value[2], 100.0)
    if (
        start is None or end is None or step is None
        or start >= end or step <= 0
        or (end - start) / step > 24
    ):
        return None
    return [start, end, step]


def _short_text(
    value: object,
    text_filter: Optional[Callable[[str], str]] = None,
    max_length: int = MAX_LABEL_LENGTH,
) -> str:
    text = re.sub(r"[\x00-\x1f]+", " ", str(value or "")).strip()[:max_length]
    return text_filter(text) if text and text_filter else text


def _visual_benefit_signal(text: str, language: str) -> bool:
    """Return whether text contains a language-independent visual relation cue."""
    lang = language if language in _IMPLICIT_VISUAL_BENEFIT else "he"
    return bool(_IMPLICIT_VISUAL_BENEFIT[lang].search(text or ""))


def _dedupe_scene_text(elements: list[dict], title: str) -> None:
    """Remove planner-authored duplicate headings and repeated text overlays.

    The product card owns the scene metadata. A model occasionally repeats the
    same title as one or more positioned text elements, which makes headings
    overlap in the rendered picture. Mathematical labels remain untouched.
    """
    normalized_title = re.sub(r"[^\w\u0590-\u06ff]+", "", title).casefold()
    seen: set[str] = set()
    retained: list[dict] = []
    for element in elements:
        if element["type"] != "text":
            retained.append(element)
            continue
        normalized = re.sub(r"[^\w\u0590-\u06ff]+", "", element.get("label", "")).casefold()
        if not normalized or normalized == normalized_title or normalized in seen:
            continue
        seen.add(normalized)
        retained.append(element)
    elements[:] = retained


def _fit_axes_to_elements(elements: list[dict]) -> None:
    """Expand graph ranges when model-produced data would otherwise be clipped.

    The planner is intentionally flexible and sometimes chooses a range that is
    one tick too small (for example, x=±2π with axes ending at ±6). Correcting
    that deterministically is safer than rendering a mathematically incomplete
    graph or asking another model call to repair coordinates.
    """
    axes = next((element for element in elements if element["type"] == "axes"), None)
    if axes is None:
        return

    x_values: list[float] = []
    y_values: list[float] = []
    for element in elements:
        kind = element["type"]
        if kind == "axes":
            continue
        for point in element.get("points", []):
            x_values.append(point[0])
            y_values.append(point[1])
        position = element.get("position")
        if position:
            x_values.append(position[0])
            y_values.append(position[1])
        center = element.get("center")
        if center:
            if kind in {"circle", "arc"}:
                radius = element["radius"]
                x_values.extend((center[0] - radius, center[0] + radius))
                y_values.extend((center[1] - radius, center[1] + radius))
            elif kind == "rectangle":
                x_values.extend((center[0] - element["width"] / 2, center[0] + element["width"] / 2))
                y_values.extend((center[1] - element["height"] / 2, center[1] + element["height"] / 2))
            else:
                x_values.append(center[0])
                y_values.append(center[1])

    def fitted(axis_range: list[float], values: list[float]) -> list[float]:
        if not values:
            return axis_range
        start, end, step = axis_range
        low, high = min(values), max(values)
        if low < start:
            start = math.floor(low / step) * step
            if start >= low - 1e-9:
                start -= step
        if high > end:
            end = math.ceil(high / step) * step
            if end <= high + 1e-9:
                end += step
        span = end - start
        if span / step > 24:
            step *= math.ceil(span / (24 * step))
        return [start, end, step]

    axes["x_range"] = fitted(axes["x_range"], x_values)
    axes["y_range"] = fitted(axes["y_range"], y_values)


_HYPOTENUSE_LABEL = re.compile(r"^(?:יתר|היתר|الوتر|وتر|hypotenuse)(?:\s*[=:–—-]?\s*\d+(?:\.\d+)?)?$", re.IGNORECASE)
_SIDE_ROLE_LABEL = re.compile(
    r"^(?:מול|ליד|צלע\s+מול|צלע\s+ליד|المقابل|المجاور|ضلع\s+مقابل|ضلع\s+مجاور|opposite|adjacent)"
    r"(?:\s*[=:–—-]?\s*\d+(?:\.\d+)?)?$",
    re.IGNORECASE,
)
_SIDE_NUMBER = re.compile(r"(?<![\w.])-?\d+(?:\.\d+)?")
_RIGHT_ANGLE_LABEL = re.compile(r"^(?:90\s*(?:°|º|degrees?)?|זווית\s+ישרה|زاوية\s+قائمة|right\s+angle)$", re.IGNORECASE)


def _edge_lengths(triangle: dict) -> list[float]:
    return [
        math.dist(triangle["points"][index], triangle["points"][(index + 1) % 3])
        for index in range(3)
    ]


def _side_number(label: str) -> Optional[float]:
    match = _SIDE_NUMBER.search(label)
    return float(match.group()) if match else None


def _align_triangle_side_measures(elements: list[dict]) -> None:
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


def _bind_semantic_geometry_labels(elements: list[dict]) -> None:
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


def _ensure_requested_hypotenuse(scene: dict, request: str, language: str) -> None:
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


def _normalize_identity_line(scene: dict, request: str) -> None:
    """Deterministically render explicit ``x=y`` / ``y=x`` identity graphs.

    This is intentionally request-specific. Arbitrary polylines may be circles,
    inverse-function branches, or parametric paths, so globally sorting or
    rewriting their points would corrupt valid mathematical diagrams.
    """
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


def _normalize_safe_function_graph(scene: dict, request: str, language: str = "he") -> None:
    """Resample a small allow-list of requested functions without executing code.

    The scene planner sometimes describes the right concept while returning a
    polyline for a different equation. These canonical functions are detected
    from the learner request and evaluated by trusted Python functions only;
    arbitrary model-authored expressions are never parsed or executed.
    """
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


def _ensure_parallel_angle_markers(scene: dict, request: str, language: str) -> None:
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


def _canonical_function_scene(request: str, language: str) -> Optional[dict]:
    """Build a trusted fallback for recognized elementary graph requests.

    This is intentionally limited to an allow-list. It guarantees that a
    strong visual cue such as ``x=y`` receives a useful first-turn picture
    even when the model planner declines the tool or returns invalid JSON.
    """
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


def _canonical_midpoint_scene(request: str, language: str) -> Optional[dict]:
    """Return the trusted midpoint diagram for the explicit demo contract."""
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


def _canonical_similar_triangles_scene(request: str, language: str) -> Optional[dict]:
    """Return a trusted scale-factor diagram for an explicit similarity request."""
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


def sanitize_scene(
    raw: object,
    text_filter: Optional[Callable[[str], str]] = None,
) -> Optional[dict]:
    """Validate and bound an untrusted model-produced scene specification."""
    if not isinstance(raw, dict) or raw.get("use_visual") is not True:
        return None

    raw_elements = raw.get("elements")
    if not isinstance(raw_elements, list):
        return None

    has_axes = any(
        isinstance(candidate, dict) and candidate.get("type") == "axes"
        for candidate in raw_elements[:MAX_ELEMENTS]
    )
    diagram_point = _data_point if has_axes else _point

    elements: list[dict] = []
    for candidate in raw_elements[:MAX_ELEMENTS]:
        if not isinstance(candidate, dict):
            continue
        kind = candidate.get("type")
        if kind not in {
            "polygon", "polyline", "line", "arrow", "point", "circle",
            "rectangle", "arc", "angle", "right_angle", "axes", "text",
        }:
            continue
        color = candidate.get("color") if candidate.get("color") in COLORS else "primary"
        clean: dict = {"type": kind, "color": color}

        if kind in {"polygon", "polyline", "line", "arrow", "point", "angle", "right_angle"}:
            raw_points = candidate.get("points")
            if not isinstance(raw_points, list):
                continue
            points = [p for p in (diagram_point(item) for item in raw_points) if p]
            required = {
                "polygon": 3, "polyline": 2, "line": 2,
                "arrow": 2, "point": 1, "angle": 3, "right_angle": 3,
            }[kind]
            if len(points) < required:
                continue
            if kind == "polygon":
                clean["points"] = points[:12]
            elif kind == "polyline":
                clean["points"] = points[:MAX_POLYLINE_POINTS]
            else:
                clean["points"] = points[:required]
        elif kind == "circle":
            center = diagram_point(candidate.get("center"))
            radius = _number(candidate.get("radius"), 100.0 if has_axes else 3.0)
            if center is None or radius is None or radius < 0.12:
                continue
            clean.update({"center": center, "radius": radius})
        elif kind == "rectangle":
            center = diagram_point(candidate.get("center"))
            width = _number(candidate.get("width"), 100.0 if has_axes else X_LIMIT * 2)
            height = _number(candidate.get("height"), 100.0 if has_axes else Y_LIMIT * 2)
            if center is None or width is None or height is None or width < 0.12 or height < 0.12:
                continue
            clean.update({"center": center, "width": width, "height": height})
        elif kind == "arc":
            center = diagram_point(candidate.get("center"))
            radius = _number(candidate.get("radius"), 100.0 if has_axes else 3.0)
            start_angle = _number(candidate.get("start_angle", 0.0), math.tau * 2)
            angle = _number(candidate.get("angle"), math.tau * 2)
            if center is None or radius is None or radius < 0.12 or start_angle is None or angle is None or abs(angle) < 0.02:
                continue
            clean.update({"center": center, "radius": radius, "start_angle": start_angle, "angle": angle})
        elif kind == "axes":
            position = _point(candidate.get("position", [0, 0]))
            x_range = _range(candidate.get("x_range"))
            y_range = _range(candidate.get("y_range"))
            if position is None or x_range is None or y_range is None:
                continue
            clean.update({"position": position, "x_range": x_range, "y_range": y_range})
            x_label = _short_text(candidate.get("x_label"), text_filter)
            y_label = _short_text(candidate.get("y_label"), text_filter)
            if x_label:
                clean["x_label"] = x_label
            if y_label:
                clean["y_label"] = y_label
        elif kind == "text":
            position = diagram_point(candidate.get("position"))
            if position is None:
                continue
            clean["position"] = position

        label = _short_text(candidate.get("label"), text_filter)
        if label:
            clean["label"] = label
        if kind == "angle" and _RIGHT_ANGLE_LABEL.fullmatch(label):
            clean["type"] = "right_angle"
            clean.pop("label", None)
        if kind == "polygon":
            raw_labels = candidate.get("labels")
            labels = [
                _short_text(item, text_filter)
                for item in (raw_labels if isinstance(raw_labels, list) else [])
            ]
            clean["labels"] = labels[: len(clean["points"])]
            raw_side_labels = candidate.get("side_labels")
            side_labels = [
                _short_text(item, text_filter)
                for item in (raw_side_labels if isinstance(raw_side_labels, list) else [])
            ]
            clean["side_labels"] = side_labels[: len(clean["points"])]
            opacity = _number(candidate.get("fill_opacity", 0.08), 0.22)
            clean["fill_opacity"] = max(0.0, opacity if opacity is not None else 0.08)
        if kind in {"polyline", "line", "arrow"}:
            clean["dashed"] = bool(candidate.get("dashed", False))
        if kind == "rectangle":
            opacity = _number(candidate.get("fill_opacity", 0.08), 0.22)
            clean["fill_opacity"] = max(0.0, opacity if opacity is not None else 0.08)
        elements.append(clean)

    if not elements:
        return None
    title = _short_text(raw.get("title"), text_filter, 90)
    _dedupe_scene_text(elements, title)
    _align_triangle_side_measures(elements)
    _bind_semantic_geometry_labels(elements)
    _fit_axes_to_elements(elements)
    return {
        "use_visual": True,
        "title": title,
        "alt": _short_text(raw.get("alt"), text_filter, 240),
        "caption": _short_text(raw.get("caption"), text_filter, 180),
        "elements": elements,
    }


async def plan_manim_visual(
    user_message: str,
    assistant_response: str,
    language: str,
    usage_context: UsageContext,
    text_filter: Optional[Callable[[str], str]] = None,
) -> Optional[dict]:
    """Let the Coach choose the visual tool and return a constrained scene."""
    lang = language if language in VISUAL_TOOL_PROMPTS else "he"

    messages = [
        {"role": "system", "content": f"{VISUAL_TOOL_PROMPTS[lang]}\n{SCENE_CONTRACT}"},
        {"role": "user", "content": f"<learner_request>{user_message}</learner_request>\n<coach_reply>{assistant_response}</coach_reply>"},
    ]
    explicit_request = bool(_EXPLICIT_VISUAL_REQUEST[lang].search(user_message))
    semantic_visual = _visual_benefit_signal(f"{user_message}\n{assistant_response}", lang)
    attempts = 2 if explicit_request or semantic_visual else 1
    for attempt in range(attempts):
        request_messages = messages
        if attempt:
            request_messages = [
                messages[0],
                {
                    "role": "user",
                    "content": (
                        f"{messages[1]['content']}\n"
                        f"{_VISUAL_RETRY_PROMPT[lang]}"
                    ),
                },
            ]
        try:
            response = await call_llm(
                request_messages,
                usage_context=usage_context,
                max_tokens=1800,
                json_mode=True,
                model_tier="strong",
            )
        except Exception:
            # The planner is optional. Recognized, trusted geometry below must
            # remain available when APIM/model planning is temporarily down.
            print("⚠️ Manim scene planner was unavailable")
            break
        if response:
            try:
                planned = sanitize_scene(json.loads(response), text_filter)
                if planned:
                    visual_context = "\n".join(
                        filter(None, (user_message, assistant_response, planned.get("alt"), planned.get("caption")))
                    )
                    _normalize_identity_line(planned, user_message)
                    _normalize_safe_function_graph(planned, user_message, language)
                    _ensure_parallel_angle_markers(planned, user_message, lang)
                    _ensure_requested_hypotenuse(planned, visual_context, lang)
                    return planned
            except (json.JSONDecodeError, TypeError, ValueError):
                print("⚠️ Manim tool returned an invalid scene")
    if explicit_request or semantic_visual:
        return (
            _canonical_function_scene(user_message, lang)
            or _canonical_midpoint_scene(user_message, lang)
            or _canonical_similar_triangles_scene(user_message, lang)
        )
    return None


def _svg_point(point: list[float]) -> tuple[float, float]:
    return ((point[0] + 7.0) / 14.0 * 960.0, (4.0 - point[1]) / 8.0 * 540.0)


def _svg_fallback(scene: dict) -> bytes:
    """Render the safe primitive set as SVG when Manim is unavailable."""
    shapes: list[str] = []
    labels: list[str] = []
    axis_element = next(
        (element for element in scene["elements"] if element["type"] == "axes"),
        None,
    )
    geometry_points = [
        point
        for element in scene["elements"]
        if element["type"] in {"polygon", "polyline", "line", "arrow", "point", "angle", "right_angle"}
        for point in element.get("points", [])
    ]
    geometry_points.extend(
        element["center"]
        for element in scene["elements"]
        if element["type"] in {"circle", "rectangle", "arc"}
    )
    has_formula_annotation = any(
        element["type"] == "text" and _FORMULA_TEXT.search(element.get("label", ""))
        for element in scene["elements"]
    )
    half_width, half_height = 320.0, 190.0
    if axis_element and any(element["type"] == "circle" for element in scene["elements"]):
        x_span = axis_element["x_range"][1] - axis_element["x_range"][0]
        y_span = axis_element["y_range"][1] - axis_element["y_range"][0]
        unit_scale = min((half_width * 2) / x_span, (half_height * 2) / y_span)
        half_width = x_span * unit_scale / 2
        half_height = y_span * unit_scale / 2
    drawing_scale = 960.0 / 14.0
    drawing_center = (480.0, 270.0)
    source_center = (0.0, 0.0)
    if geometry_points and not axis_element:
        xs = [point[0] for point in geometry_points]
        ys = [point[1] for point in geometry_points]
        source_width = max(max(xs) - min(xs), 0.1)
        source_height = max(max(ys) - min(ys), 0.1)
        target_left, target_right = (80.0, 520.0) if has_formula_annotation else (75.0, 885.0)
        target_top, target_bottom = 70.0, 470.0
        drawing_scale = min(
            (target_right - target_left) / source_width,
            (target_bottom - target_top) / source_height,
            115.0,
        )
        drawing_center = ((target_left + target_right) / 2, (target_top + target_bottom) / 2)
        source_center = ((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2)

    def svg_point(point: list[float]) -> tuple[float, float]:
        if not axis_element:
            return (
                drawing_center[0] + (point[0] - source_center[0]) * drawing_scale,
                drawing_center[1] - (point[1] - source_center[1]) * drawing_scale,
            )
        ox, oy = _svg_point(axis_element["position"])
        left, right, _ = axis_element["x_range"]
        bottom, top, _ = axis_element["y_range"]
        return (
            ox - half_width + (point[0] - left) / (right - left) * half_width * 2,
            oy + half_height - (point[1] - bottom) / (top - bottom) * half_height * 2,
        )

    def svg_scales() -> tuple[float, float]:
        if not axis_element:
            return drawing_scale, drawing_scale
        left, right, _ = axis_element["x_range"]
        bottom, top, _ = axis_element["y_range"]
        return half_width * 2 / (right - left), half_height * 2 / (top - bottom)

    for element in scene["elements"]:
        kind = element["type"]
        color = COLORS[element["color"]]
        if kind == "polygon":
            points = [svg_point(point) for point in element["points"]]
            joined = " ".join(f"{x:.1f},{y:.1f}" for x, y in points)
            opacity = element.get("fill_opacity", 0.08)
            shapes.append(f'<polygon points="{joined}" fill="{color}" fill-opacity="{opacity}" stroke="{color}" stroke-width="4" stroke-linejoin="round"/>')
            cx = sum(x for x, _ in points) / len(points)
            cy = sum(y for _, y in points) / len(points)
            for index, label in enumerate(element.get("labels", [])):
                if not label:
                    continue
                x, y = points[index]
                dx, dy = x - cx, y - cy
                length = math.hypot(dx, dy) or 1
                labels.append(f'<text x="{x + dx / length * 20:.1f}" y="{y + dy / length * 20 + 7:.1f}" class="label">{escape(label)}</text>')
            for index, label in enumerate(element.get("side_labels", [])):
                if not label:
                    continue
                start_x, start_y = points[index]
                end_x, end_y = points[(index + 1) % len(points)]
                midpoint_x, midpoint_y = (start_x + end_x) / 2, (start_y + end_y) / 2
                tangent_x, tangent_y = end_x - start_x, end_y - start_y
                normal_x, normal_y = -tangent_y, tangent_x
                if normal_x * (midpoint_x - cx) + normal_y * (midpoint_y - cy) < 0:
                    normal_x, normal_y = -normal_x, -normal_y
                length = math.hypot(normal_x, normal_y) or 1.0
                label_x = midpoint_x + normal_x / length * 30
                label_y = midpoint_y + normal_y / length * 30 + 7
                labels.append(
                    f'<text x="{label_x:.1f}" y="{label_y:.1f}" class="side-label backed-label" '
                    f'direction="auto" unicode-bidi="plaintext" data-edge-index="{index}">{escape(label)}</text>'
                )
        elif kind == "polyline":
            points = [svg_point(point) for point in element["points"]]
            joined = " ".join(f"{x:.1f},{y:.1f}" for x, y in points)
            dash = ' stroke-dasharray="10 8"' if element.get("dashed") else ""
            shapes.append(f'<polyline points="{joined}" fill="none" stroke="{color}" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"{dash}/>')
            if element.get("label"):
                label_index = min(max(1, len(points) * 2 // 3), len(points) - 1)
                prior_x, prior_y = points[label_index - 1]
                x, y = points[label_index]
                dx, dy = x - prior_x, y - prior_y
                length = math.hypot(dx, dy) or 1.0
                labels.append(f'<text x="{x + dy / length * 28:.1f}" y="{y - dx / length * 28:.1f}" class="label">{escape(element["label"])}</text>')
        elif kind in {"line", "arrow"}:
            (x1, y1), (x2, y2) = [svg_point(point) for point in element["points"]]
            dash = ' stroke-dasharray="10 8"' if element.get("dashed") else ""
            marker = ' marker-end="url(#arrow)"' if kind == "arrow" else ""
            shapes.append(f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" stroke="{color}" stroke-width="4"{dash}{marker}/>')
            if element.get("label"):
                dx, dy = x2 - x1, y2 - y1
                normal_x, normal_y = dy, -dx
                if normal_y > 0:
                    normal_x, normal_y = -normal_x, -normal_y
                length = math.hypot(normal_x, normal_y) or 1.0
                labels.append(f'<text x="{(x1 + x2) / 2 + normal_x / length * 22:.1f}" y="{(y1 + y2) / 2 + normal_y / length * 22 + 7:.1f}" class="side-label">{escape(element["label"])}</text>')
        elif kind == "point":
            x, y = svg_point(element["points"][0])
            shapes.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="7" fill="{color}"/>')
            if element.get("label"):
                labels.append(f'<text x="{x + 15:.1f}" y="{y - 12:.1f}" class="label">{escape(element["label"])}</text>')
        elif kind == "circle":
            x, y = svg_point(element["center"])
            x_scale, y_scale = svg_scales()
            radius_x = element["radius"] * x_scale
            radius_y = element["radius"] * y_scale
            shapes.append(f'<ellipse cx="{x:.1f}" cy="{y:.1f}" rx="{radius_x:.1f}" ry="{radius_y:.1f}" fill="{color}" fill-opacity=".06" stroke="{color}" stroke-width="4"/>')
            if element.get("label"):
                labels.append(f'<text x="{x:.1f}" y="{y - radius_y - 14:.1f}" class="label">{escape(element["label"])}</text>')
        elif kind == "rectangle":
            x, y = svg_point(element["center"])
            x_scale, y_scale = svg_scales()
            width = element["width"] * x_scale
            height = element["height"] * y_scale
            opacity = element.get("fill_opacity", 0.08)
            shapes.append(f'<rect x="{x - width / 2:.1f}" y="{y - height / 2:.1f}" width="{width:.1f}" height="{height:.1f}" rx="6" fill="{color}" fill-opacity="{opacity}" stroke="{color}" stroke-width="4"/>')
            if element.get("label"):
                labels.append(f'<text x="{x:.1f}" y="{y + 8:.1f}" class="label">{escape(element["label"])}</text>')
        elif kind == "arc":
            x, y = svg_point(element["center"])
            x_scale, y_scale = svg_scales()
            radius_x = element["radius"] * x_scale
            radius_y = element["radius"] * y_scale
            start_angle = element["start_angle"]
            angle = element["angle"]
            end_angle = start_angle + angle
            start = (x + radius_x * math.cos(start_angle), y - radius_y * math.sin(start_angle))
            end = (x + radius_x * math.cos(end_angle), y - radius_y * math.sin(end_angle))
            large = 1 if abs(angle) > math.pi else 0
            sweep = 0 if angle > 0 else 1
            shapes.append(f'<path d="M {start[0]:.1f} {start[1]:.1f} A {radius_x:.1f} {radius_y:.1f} 0 {large} {sweep} {end[0]:.1f} {end[1]:.1f}" fill="none" stroke="{color}" stroke-width="4"/>')
            if element.get("label"):
                middle = start_angle + angle / 2
                labels.append(f'<text x="{x + (radius_x + 25) * math.cos(middle):.1f}" y="{y - (radius_y + 25) * math.sin(middle):.1f}" class="label">{escape(element["label"])}</text>')
        elif kind == "axes":
            ox, oy = _svg_point(element["position"])
            left, right, x_step = element["x_range"]
            bottom, top, y_step = element["y_range"]
            axis_origin_x, axis_origin_y = svg_point([0, 0])
            shapes.append(f'<line x1="{ox - half_width:.1f}" y1="{axis_origin_y:.1f}" x2="{ox + half_width:.1f}" y2="{axis_origin_y:.1f}" stroke="{color}" stroke-width="3" marker-end="url(#arrow)"/>')
            shapes.append(f'<line x1="{axis_origin_x:.1f}" y1="{oy + half_height:.1f}" x2="{axis_origin_x:.1f}" y2="{oy - half_height:.1f}" stroke="{color}" stroke-width="3" marker-end="url(#arrow)"/>')
            x_value = math.ceil(left / x_step) * x_step
            while x_value <= right + 1e-9:
                px, _ = svg_point([x_value, 0])
                shapes.append(f'<line x1="{px:.1f}" y1="{axis_origin_y - 6:.1f}" x2="{px:.1f}" y2="{axis_origin_y + 6:.1f}" stroke="{color}" stroke-width="2"/>')
                if abs(x_value) > 1e-9:
                    labels.append(f'<text x="{px:.1f}" y="{axis_origin_y + 26:.1f}" class="tick">{x_value:g}</text>')
                x_value += x_step
            y_value = math.ceil(bottom / y_step) * y_step
            while y_value <= top + 1e-9:
                _, py = svg_point([0, y_value])
                shapes.append(f'<line x1="{axis_origin_x - 6:.1f}" y1="{py:.1f}" x2="{axis_origin_x + 6:.1f}" y2="{py:.1f}" stroke="{color}" stroke-width="2"/>')
                if abs(y_value) > 1e-9:
                    labels.append(f'<text x="{axis_origin_x - 22:.1f}" y="{py + 7:.1f}" class="tick">{y_value:g}</text>')
                y_value += y_step
            if element.get("x_label"):
                labels.append(f'<text x="{ox + half_width + 22:.1f}" y="{axis_origin_y - 10:.1f}" class="label">{escape(element["x_label"])}</text>')
            if element.get("y_label"):
                labels.append(f'<text x="{axis_origin_x + 20:.1f}" y="{oy - half_height - 12:.1f}" class="label">{escape(element["y_label"])}</text>')
        elif kind == "text":
            text = element.get("label", "")
            if not axis_element and _FORMULA_TEXT.search(text):
                x, y = 735.0, 270.0
                width = max(280.0, min(350.0, len(text) * 17.0 + 50.0))
                shapes.append(
                    f'<rect x="{x - width / 2:.1f}" y="{y - 42:.1f}" width="{width:.1f}" height="84" '
                    f'rx="18" fill="#ffffff" fill-opacity=".97" stroke="{COLORS["primary"]}" stroke-width="3"/>'
                )
                labels.append(
                    f'<text x="{x:.1f}" y="{y + 10:.1f}" class="formula-label" fill="{color}" '
                    f'direction="ltr" unicode-bidi="plaintext">{escape(text)}</text>'
                )
            else:
                x, y = svg_point(element["position"])
                labels.append(
                    f'<text x="{x:.1f}" y="{y:.1f}" class="label backed-label" fill="{color}" '
                    f'direction="auto" unicode-bidi="plaintext">{escape(text)}</text>'
                )
        elif kind == "angle":
            p1, vertex, p2 = element["points"]
            p1x, p1y = svg_point(p1)
            vx, vy = svg_point(vertex)
            p2x, p2y = svg_point(p2)
            a1 = math.atan2(p1y - vy, p1x - vx)
            a2 = math.atan2(p2y - vy, p2x - vx)
            delta = (a2 - a1 + math.pi) % (2 * math.pi) - math.pi
            radius = 34
            start = (vx + radius * math.cos(a1), vy + radius * math.sin(a1))
            end = (vx + radius * math.cos(a1 + delta), vy + radius * math.sin(a1 + delta))
            sweep = 1 if delta > 0 else 0
            shapes.append(f'<path d="M {start[0]:.1f} {start[1]:.1f} A {radius} {radius} 0 0 {sweep} {end[0]:.1f} {end[1]:.1f}" fill="none" stroke="{color}" stroke-width="4"/>')
            if element.get("label"):
                mid = a1 + delta / 2
                labels.append(f'<text x="{vx + 62 * math.cos(mid):.1f}" y="{vy + 62 * math.sin(mid):.1f}" class="angle-label backed-label" fill="{color}">{escape(element["label"])}</text>')
        elif kind == "right_angle":
            p1, vertex, p2 = element["points"]
            p1x, p1y = svg_point(p1)
            vx, vy = svg_point(vertex)
            p2x, p2y = svg_point(p2)
            first_x, first_y = p1x - vx, p1y - vy
            second_x, second_y = p2x - vx, p2y - vy
            first_length = math.hypot(first_x, first_y) or 1.0
            second_length = math.hypot(second_x, second_y) or 1.0
            size = 24
            a = (vx + first_x / first_length * size, vy + first_y / first_length * size)
            c = (vx + second_x / second_length * size, vy + second_y / second_length * size)
            b = (a[0] + second_x / second_length * size, a[1] + second_y / second_length * size)
            shapes.append(f'<path d="M {a[0]:.1f} {a[1]:.1f} L {b[0]:.1f} {b[1]:.1f} L {c[0]:.1f} {c[1]:.1f}" fill="none" stroke="{color}" stroke-width="4"/>')

    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540" role="img">
<defs><marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto"><path d="M0,0 L0,6 L9,3 z" fill="#302b4a"/></marker></defs>
<rect width="960" height="540" rx="30" fill="#fbfaff"/>
<g>{''.join(shapes)}</g><g font-family="Arial, sans-serif" font-size="25" font-weight="700" text-anchor="middle"><style>.label,.side-label{{fill:#302b4a}}.side-label{{font-size:23px}}.angle-label{{font-size:24px;font-weight:800}}.formula-label{{font-size:31px;font-weight:600}}.backed-label{{paint-order:stroke;stroke:#fbfaff;stroke-width:10px;stroke-linejoin:round}}.tick{{fill:#77718f;font-size:17px;font-weight:500}}</style>{''.join(labels)}</g>
</svg>'''
    return svg.encode("utf-8")


async def render_manim_visual(scene: dict) -> dict:
    """Render a validated scene in an isolated Manim process, with SVG fallback."""
    image_bytes: bytes
    mime_type = "image/png"
    renderer = "manim"

    with tempfile.TemporaryDirectory(prefix="yuvi-manim-") as temp_dir:
        root = Path(temp_dir)
        spec_path = root / "scene.json"
        output_path = root / "scene.png"
        spec_path.write_text(json.dumps(scene, ensure_ascii=False), encoding="utf-8")
        try:
            process = await asyncio.create_subprocess_exec(
                sys.executable,
                "-m",
                "app.agents.manim_worker",
                str(spec_path),
                str(output_path),
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.PIPE,
                env={**os.environ, "MANIM_DISABLE_CACHING": "1"},
            )
            _, stderr = await asyncio.wait_for(process.communicate(), timeout=RENDER_TIMEOUT_SECONDS)
            if process.returncode != 0 or not output_path.exists():
                detail = stderr.decode("utf-8", errors="replace")[-300:]
                raise RuntimeError(detail or "Manim worker did not produce an image")
            image_bytes = output_path.read_bytes()
        except (FileNotFoundError, RuntimeError, asyncio.TimeoutError) as exc:
            if "process" in locals() and process.returncode is None:
                process.kill()
                await process.communicate()
            print(f"ℹ️ Manim renderer unavailable; using SVG fallback: {exc}")
            image_bytes = _svg_fallback(scene)
            mime_type = "image/svg+xml"
            renderer = "svg-fallback"

    encoded = base64.b64encode(image_bytes).decode("ascii")
    return {
        "id": f"visual-{uuid4().hex}",
        "type": "image",
        "mime_type": mime_type,
        "data_url": f"data:{mime_type};base64,{encoded}",
        "title": scene.get("title") or "",
        "alt": scene.get("alt") or scene.get("title") or "",
        "caption": scene.get("caption") or "",
        "renderer": renderer,
        "scene": scene,
    }
