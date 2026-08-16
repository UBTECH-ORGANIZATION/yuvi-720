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

from app.agents.molecule import validate_molecule
from app.agents.visual_layout import BRACE_BAR, BRACE_REACH, solve_scene_layout
from app.agents.visuals import maths, registry
from app.services.ai_usage import UsageContext
from app.services.llm import call_llm


# Element types the core pipeline validates itself. Domains add to this through
# `visuals.registry`; nothing else may introduce a type.
_CORE_ELEMENTS = frozenset({
    "polygon", "polyline", "line", "arrow", "point", "circle",
    "rectangle", "arc", "angle", "right_angle", "axes", "text",
    "brace", "number_line", "molecule", "prop", "drawing",
})


MAX_ELEMENTS = 24
MAX_LABEL_LENGTH = 48
MAX_POLYLINE_POINTS = 80
MAX_ANIMATION_STEPS = 5
ANIMATION_KINDS = {"draw", "fade", "grow", "pulse", "slide", "none"}
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
        "תנאי חוסם שגובר על כל הנאמר לעיל: שרטוט מוצדק רק כשהמיקום, הגודל, הצורה, הכיוון "
        "או הסדר הגודל של מה שמצויר נושאים חלק מהמשמעות. אם התמונה תהיה מילים בתוך מלבנים — "
        "סרב/י: הגדרה, הנגדה מילולית (\"א זה כך, ב זה אחרת\"), הבחנה בין קטגוריות או כלל שנאמר במילים "
        "אינם מתבהרים מציור — המשפט כבר אומר את זה, ומסגור המילים בקופסאות מוסיף קישוט בלבד. "
        "שני מקרים עוברים את התנאי הזה תמיד: (1) אובייקט אמיתי שיש לו צורה מוכרת — מבנה גוף, "
        "כלי מעבדה, איבר, מכשיר, יצור — אותו מציירים, ולא מסתפקים בשמו במילים. (2) תהליך או רצף שבו הסדר "
        "או הכיוון הם התוכן — מחזור המים, שרשרת מזון, מערכת העיכול, שלבי ניסוי: לצייר את השלבים ואת החיצים "
        "ביניהם מראה מה שמשפט לא מראה. "
        "עדיף לא לצייר: העדר שרטוט לא עולה דבר, ושרטוט חלש מבזבז את תשומת הלב של הלומד/ת. "
        "במקרה של ספק — החזר/י use_visual:false. "
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
        "شرط حاسم يسبق ما سبق: الرسم مبرر فقط إذا كان الموضع أو الحجم أو الشكل أو الاتجاه أو المقدار "
        "يحمل جزءًا من المعنى. إذا كانت الصورة ستكون مجرد كلمات داخل مربعات — ارفض: التعريف، "
        "والتقابل اللفظي، والتمييز بين فئتين، والقاعدة المصوغة بالكلمات — لا تزداد وضوحًا بالرسم، والجملة تكفي. "
        "حالتان تجتازان هذا الشرط دائمًا: (١) جسم حقيقي له شكل مميّز — عضو، أداة مختبر، جهاز، كائن حي، "
        "آلية — ارسمه بدل أن تسمّيه. (٢) عملية أو تسلسل يكون الترتيب أو الاتجاه فيه هو المضمون — دورة الماء، "
        "السلسلة الغذائية، الهضم، مراحل التجربة: رسم المراحل والأسهم بينها يُظهر ما لا تُظهره الجملة. "
        "فضّل عدم الرسم: غيابه لا يكلف شيئًا، ورسم ضعيف يضيّع انتباه المتعلّم. عند الشك أعد use_visual:false. "
        "أعد JSON فقط. إن لم يلزم: {\"use_visual\":false}. وإن لزم: "
        "{\"use_visual\":true,\"title\":\"...\",\"alt\":\"...\",\"caption\":\"...\","
        "\"elements\":[...]}. حافظ على التعلم النشط: اعرض المعطيات لا الحل النهائي."
    ),
    "en": (
        "You are Yuvi's educational drawing-planning tool. Decide whether a drawing materially helps "
        "the learner understand the request and response. Do not wait for an explicit drawing request: "
        "on the first turn choose a visual when shape, position, quantitative relationship, change, parts, "
        "comparison, or sequence becomes clearer at a glance. Do not add a decorative visual to social "
        "conversation or a simple factual answer. "
        "HARD BAR — apply before anything above: a drawing is warranted ONLY when the POSITION, SIZE, "
        "SHAPE, DIRECTION or MAGNITUDE of what is drawn carries part of the meaning. If the picture "
        "would be words inside boxes, refuse: a definition, a verbal contrast (\"A means this, B means "
        "that\"), a category distinction, a rule stated in words, or a term being named is NOT clearer "
        "as a diagram — the sentence already says it and drawing it adds nothing but decoration. "
        "TWO CASES ALWAYS CLEAR THIS BAR. (1) A real object with a recognisable shape — an organ, a "
        "piece of lab apparatus, an instrument, an organism, a mechanism: draw the thing rather than "
        "name it. (2) A process or sequence where the ORDER or DIRECTION is the content — the water "
        "cycle, a food chain, digestion, the stages of an experiment: drawing the stages and the "
        "arrows between them shows what a sentence cannot. "
        "Prefer no visual: a missing drawing costs nothing, a weak one wastes the learner's attention "
        "and makes the whole companion look less careful. When in doubt return use_visual:false. "
        "If the learner explicitly requests a graph, "
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
- {"type":"brace","points":[[x1,y1],[x2,y2]],"label":"3","color":"ink"}  (curly measuring brace along the segment; label on its outer side)
- {"type":"number_line","position":[x,y],"range":[0,10,1],"marks":[2,7],"label":"optional","color":"ink"}  (horizontal number line centered at position; marks are highlighted values. When a number_line is present, the x of EVERY other element is a VALUE on that line's range — e.g. text near the mark 12.1 uses position [12.1, 0.6], never canvas coordinates. Do not add text that repeats a mark's number; marks are labeled automatically. A caption ABOUT a
particular mark must use that mark's exact value as its x — a caption about the mark at 8 sits at
[8, 0.9], not at 6.5, or it will point at empty line. Keep captions ABOVE the line (positive y
relative to it): the row below carries the tick numbers. A brace must span from one mark to
another — its endpoints are mark values, not approximations.)
CHEMISTRY — for molecules use, INSTEAD of the geometry primitives above:- {"type":"molecule","smiles":"CC(=O)Oc1ccccc1C(=O)O","label":"אספירין","view":"2d","highlight":"C(=O)O"}
Emit ONLY the SMILES string; never coordinates, never a formula, never a molecular mass —
those are computed for you and shown to the learner, so anything you assert would be
overwritten or would make the visual be rejected. An invalid SMILES produces NO visual at
all, so write only structures you are certain of. "highlight" is an optional SMARTS or
SMILES substructure (a functional group) that will be emphasised — use it to point at the
part under discussion. "view":"3d" only when molecular SHAPE is the lesson (VSEPR, bond
angles, isomers); otherwise "2d". Do not mix molecule elements with geometry elements.
Colors: primary, secondary, accent, success, warning, ink, muted, white.
PROPS — real objects, drawn for you. Reach for these BEFORE the primitives above
whenever the subject is a physical thing or a comparison of quantities. Each is
one element: {"type":"prop","prop":"<name>","center":[x,y], ...params,
"labels":{"<anchor>":"טקסט"}}. Labels are placed at named anchors — never park a
separate text element next to a prop and hope it lands right.
- "balance_scale" — two-pan beam balance. center, size, and EITHER tilt (-1..1,
  POSITIVE dips the RIGHT pan) OR left_mass + right_mass (the tilt is derived,
  and the heavier side goes DOWN).
  Anchors: left_pan, right_pan, left_load, right_load, pivot.
  Put what is being weighed IN the scale, not beside it: "left_load" and
  "right_load" each take another prop — {"prop":"balloon","inflation":0.1} —
  and it is built onto the pan wherever the tilt left it. Do not try to position
  a separate prop on a pan yourself; you cannot know where the pan ended up.
- "balloon" — center, size, inflation (0..1 — the SAME prop at two settings is
  how you show empty vs inflated), color, string (bool), particles (how many
  gas dots inside), seed. Anchors: top, center, bottom.
- "particle_box" — center, width, height, shape ("box"|"circle"), state
  ("solid" lattice | "liquid" lower half | "gas" fills it), count, particle_size,
  seed. Anchors: top, center, bottom. Use for states of matter, gas, density,
  diffusion, concentration.
- "container" — a vessel: center, width, height, fill_level (0..1),
  liquid_color, graduations (tick count), style ("beaker" | "cup" | "jar" |
  "box"). fill_level is LIVE — the same vessel at two levels is how you show
  before/after, and the surface always meets the walls correctly.
  Anchors: top, center, surface, base.
- "balance" — a digital balance: center, size, pan_color, and "load" — another
  prop that STANDS ON its platform, seated for you ({"prop":"container",
  "fill_level":0.6}). Put the reading on the instrument with
  labels:{"display":"115"}; that is where a learner reads a mass, and a number
  parked beside the picture is not a reading of anything.
  Anchors: pan, display, top, center, bottom.
- "balance_scale" — two-pan beam balance, for comparing two masses rather than
  reading one. See above.
- "bar_comparison" — items:[{"value":3.5,"label":"מנופח","color":"primary"},...],
  center, height, bar_width. Anchors: top:0, top:1, foot:0, foot:1.
  THIS is how you compare magnitudes. Two words above a number line compare
  nothing; two bars whose heights differ compare everything.
CHOOSING: if the question is about an object, draw the object. "Why is the
inflated balloon heavier?" is a balance_scale carrying two balloon props at
different inflation, or a bar_comparison of the two masses — never the words
"balloon" and "inflated balloon" floating over a number line. A number_line
measures VALUES; if the thing you are placing on it is a word, you have chosen
the wrong element.
DRAWING ANYTHING ELSE — when the object you need is not in the prop list (a
house, a tree, a cloud, the sun, a mountain, rain, a person, a leaf), BUILD IT
FROM PARTS. Do not attempt SVG curves; assemble named shapes instead:
- {"type":"drawing","object":"בית","center":[x,y],"size":2.4,"parts":[
    {"shape":"slab","at":[50,26],"w":54,"h":38,"fill_opacity":0.08},
    {"shape":"roof","at":[50,45],"w":54,"h":22,"color":"warning","fill_opacity":0.22},
    {"shape":"slab","at":[33,32],"w":11,"h":11,"color":"secondary","repeat":1,"step":[34,0]}]}
Parts are authored in a local 0..100 box with y pointing UP, and the whole
object is scaled to "size" and centred on "center" for you — shape is yours,
placement is ours. Always set "object" to the noun being drawn.
Available shapes and their parameters:
- "disc" — at, r, inner (0..1 for a ring). A sun, a wheel, a cell, a ball.
- "rays" — at, r, count, h. Spokes around a centre; use WITH a disc for a sun.
- "puff" — at, w, h, lobes, seed. A cloud. One puff IS a whole cloud; never
  place three discs and call it a cloud.
- "blob" — at, w, h, lobes, jagged, seed. An organic mass: a treetop, a stone,
  an organ, a puddle.
- "ridge" — at, w, h, peaks, jagged, seed. Mountains or hills, one silhouette.
- "stalk" — at, w, h, taper (0..1), bend. A trunk, a stem, a limb, a chimney.
- "slab" — at, w, h. A wall, a shelf, a brick, a door, a window, a box.
- "roof" — at, w, h. A gable.
- "leaf" — at, w, h, angle. A leaf, a petal, a hull.
- "droplet" — at, r. A drop of rain or liquid.
- "wave" — at, w, amp, cycles. Water, a signal.
- "person" — at, h. A figure.
Every part also takes "color" and "fill_opacity" (0..0.85), and any part takes
"repeat" (how many extra copies) with "step":[dx,dy] — use it for windows,
raindrops, leaves or shelves instead of listing them one by one. Parts are drawn
in order, so put the body first and the details after it.
ESCAPE HATCH — only if no combination of parts can express the object, you may
send raw SVG path strokes instead:
  "strokes":[{"d":"M 10 40 L 10 10 L 30 10 L 30 40 Z","color":"ink","fill_opacity":0.1}]
Each stroke is one SVG path `d` (M/L/C/Q/A/Z). Prefer parts: a hand-written path
usually comes out as an unrecognisable shape, and parts never do.
A drawing is for a REAL OBJECT with a recognisable shape. It is not a way to
draw boxes around words, and it is not for anything the primitives above already
express exactly (a circle is "circle", a graph is "axes").
DATA, NOT DECORATION — a number_line and an axes are measuring instruments, never
layout devices for words. Every mark and every coordinate must be an actual value of
the thing under discussion: a measurement, a reading, a unit's magnitude, a quantity
from the problem. If you cannot say what the numbers ARE ("these are four weighings
in grams"), you may not use a number line or axes at all — a 0..10 scale with ticks at
2, 5 and 8 carrying the words "fine" / "bigger" is a picture of nothing, and the
learner sees a ruler measuring vocabulary. Set the range from the data (readings around
24 g give a range like 23.5..28), never a generic 0..10.
Likewise a "text" element holds a value, a name or a short formula — it is NEVER a
phrase lifted from the explanation ("compare", "what changed?", "close together",
"two sides"). If the only thing you can put on the canvas is the vocabulary of the
sentence, you have reached for the wrong element, not the wrong idea: draw the THING
the sentence is about — a prop for an object or a quantity comparison, a drawing for
anything else with a recognisable shape, a staged sequence for a procedure. A question
about matter, a body, an instrument, an organism, a device or a process is drawable
even when it contains no number at all. Reserve use_visual:false for a reply that has
neither a quantity nor a thing in it — a greeting, an encouragement, a rule about
conduct — and never as an escape from a subject that simply is not geometry.
ANIMATION — prefer it whenever the idea unfolds over time (construction, change, motion,
comparison, sweep, accumulation). Set scene-level "animated": true, then stage the reveal:
- per-element "step": 0..5 — elements sharing a step appear together; steps play in order.
- per-element "animate": "draw" (stroke is drawn), "fade", "grow", "pulse" (appears then flashes
  to draw attention), "slide" (glides from "from":[x,y] to its place — use for motion/change),
  or "none" (already on screen at its step).
Stage the scene like a teacher at a board: givens first, construction next, the insight last.
INTERACTIVITY — decide this yourself, do not wait to be asked. Add
"interactive":{"handles":[{"element":<index>,"vertex":<i>}]} when the scene teaches a
RELATIONSHIP that should survive being changed — a theorem, a dependency, an invariant,
a classification. Dragging turns "this triangle is right-angled" into "right-angledness is
a property I can destroy and restore", which a picture cannot do.
Do NOT add handles when the scene states a single fixed fact (one labelled diagram, one
plotted point, a specific worked value) — moving it would make the labels lie.
A handle may only reference a "point" element, or a "polygon" vertex by index. At most 4.
Handles are additive: the same scene must still read correctly as a still image, so never
rely on dragging to communicate the idea.
Choose the MOST EXPLANATORY scene you can express with these primitives, not the simplest —
an animated step-by-step construction beats a static picture whenever a process is involved.
A static scene (animated:false or omitted) is still right for a single unchanging fact.
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
REAL OBJECTS — when the subject is a thing rather than a figure (a leaf, a cell, a
vessel, a lamp, a body), draw it so a learner recognises it at a glance: give it its
characteristic outline, and attach each part to the body it belongs to (a stem meets
the base of its leaf) instead of leaving parts floating alongside. Draw one object per
thing — never a shape plus a second shape standing in for the same thing.
ARROWS — an arrow means "this goes here". Start it in open space and end it just
OUTSIDE the outline of the shape it points at, with a clear gap; never bury a head or
a tail inside a filled shape, and never let an arrow cross the object it is about.
A name for something INSIDE an object (a product, an organ, a content) goes inside
that object's outline, clear of its edge; a name for something arriving or leaving
goes beside its arrow, on the outer side.
LAYOUT — clarity over decoration. Labels must never overlap: leave clear empty
space around each, and never place two labels or text elements at the same spot.
A "text" label is SHORT — a value, a name, or a short formula — never a sentence
and never a directional phrase like "above:"/"below:"/"note:". Put any explanatory
sentence in "caption", not on the canvas. Do NOT put a centered label on a shape
that contains other shapes or labels (e.g. a whole bar divided into parts): label
the individual parts and name the whole in the caption. Use few labels, not many.
Use only the selected language plus conventional mathematical notation.
"""

_FENCED_BLOCK = re.compile(r"```[^\n]*\n?[\s\S]*?```", re.MULTILINE)
_FORMULA_TEXT = re.compile(
    r"(?:=|\\frac|\\sqrt|\b(?:sin|cos|tan|log)\s*\(|[A-Za-zα-ωΑ-Ωθ]\s*[\^/])",
    re.IGNORECASE,
)

_EXPLICIT_VISUAL_REQUEST = {
    "he": re.compile(r"(?:צייר|ציור|שרטט|שרטוט|סרטוט|גרף|המחשה|להמחיש|הדמיה|הדמייה|איור|תרשים|דיאגרמה|הדגמה חזותית)"),
    "ar": re.compile(r"(?:ارسم|رسم|مخطط|بيان|رسمة|توضيح بصري|تمثيل بصري|تصوّر|محاكاة)"),
    "en": re.compile(r"\b(?:draw|drawing|sketch|diagram|illustrat(?:e|ion)|graph|plot|visuali[sz](?:e|ation))\b", re.IGNORECASE),
}


def is_explicit_visual_request(message: str, language: str) -> bool:
    """Did the learner ask, in so many words, to SEE something?"""
    pattern = _EXPLICIT_VISUAL_REQUEST.get(language) or _EXPLICIT_VISUAL_REQUEST["he"]
    return bool(pattern.search(message or ""))

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


_VISUAL_OFFER_PROMPTS = {
    "he": (
        "החלט/י אם הצעת המחשה (תמונה או אנימציה קצרה) באמת תעזור לתלמיד/ת חטיבה "
        "להבין את התשובה הזו. החזר/י JSON בלבד. {\"offer_visual\":true} רק כאשר "
        "התשובה מסבירה מושג, תהליך, מבנה, כמות, צורה, יחס או רעיון שלב-אחר-שלב "
        "שברור יותר כשמציירים אותו. {\"offer_visual\":false} עבור ברכות, שיחת חולין, "
        "אישורים, עידוד, רגשות, שיחה אישית/חברתית, הפניות בטיחות או מחוץ לנושא, "
        "או תשובה שכבר ברורה לגמרי במילים."
    ),
    "ar": (
        "قرّر إن كان اقتراح توضيح (صورة أو رسم متحرك قصير) سيساعد فعلًا طالب/ة "
        "المرحلة الإعدادية على فهم هذا الرد. أعد JSON فقط. {\"offer_visual\":true} فقط "
        "عندما يشرح الرد مفهومًا أو عملية أو بنية أو كمية أو شكلًا أو علاقة أو فكرة "
        "خطوة بخطوة تكون أوضح عند رسمها. {\"offer_visual\":false} للتحيّات والدردشة "
        "والتأكيدات والتشجيع والمشاعر والحديث الشخصي/الاجتماعي وإعادة التوجيه أو خارج "
        "الموضوع، أو ردّ واضح تمامًا بالكلمات."
    ),
    "en": (
        "Decide whether offering a visual (an image or short animation) would "
        "genuinely help a middle-school student understand THIS reply. Return JSON "
        "only. {\"offer_visual\":true} only when the reply explains a concept, "
        "process, structure, quantity, shape, relationship, or step-by-step idea "
        "that is clearer when drawn. {\"offer_visual\":false} for greetings, small "
        "talk, acknowledgments, encouragement, feelings, personal/social chat, "
        "safety or off-topic redirects, or an answer already fully clear in words."
    ),
}


async def should_offer_visual(
    user_message: str,
    assistant_response: str,
    language: str,
    usage_context: UsageContext,
) -> bool:
    """LLM decision (mini tier): is this reply an explanation where a visual would
    genuinely help? Used to gate the on-demand "show me a video / image" buttons
    so they never appear on greetings, social chat, or safety redirects."""
    lang = language if language in _VISUAL_OFFER_PROMPTS else "he"
    messages = [
        {"role": "system", "content": _VISUAL_OFFER_PROMPTS[lang]},
        {
            "role": "user",
            "content": f"<learner_message>{user_message}</learner_message>\n"
            f"<reply>{assistant_response}</reply>",
        },
    ]
    try:
        response = await call_llm(
            messages,
            usage_context=usage_context,
            max_tokens=20,
            json_mode=True,
            model_tier="mini",
        )
    except Exception:
        return False
    try:
        return json.loads(response).get("offer_visual") is True
    except (json.JSONDecodeError, TypeError, ValueError, AttributeError):
        return False


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


def _decimals(value: float) -> int:
    """Decimal places a reading really carries, so 40 stays 40 and 12.0 stays 12.0."""
    number = float(value)
    if number.is_integer():
        return 0
    text = f"{number:.3f}".rstrip("0")
    return len(text.split(".")[1])


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


_NARRATION_LABEL = re.compile(
    r"^\s*(?:למעלה|למטה|מימין|משמאל|כאן|שים\s*לב|הערה|above|below|left|right|note|here|"
    r"أعلى|أسفل|يمين|يسار|هنا|ملاحظة)\s*[:：]",
    re.IGNORECASE,
)


def _prune_text_annotations(elements: list[dict]) -> None:
    """Drop narration and over-long free ``text`` overlays that cause the
    overlapping clutter seen in busy scenes. The canvas carries short labels
    only (values, names, short formulas); sentences belong in the caption. Caps
    the number of free text elements so scenes stay readable."""
    kept: list[dict] = []
    text_count = 0
    for element in elements:
        if element["type"] != "text":
            kept.append(element)
            continue
        label = element.get("label", "")
        if not label or _NARRATION_LABEL.match(label) or len(label) > 28 or text_count >= 3:
            continue
        text_count += 1
        kept.append(element)
    elements[:] = kept


def _drop_container_rect_labels(elements: list[dict]) -> None:
    """A rectangle that spatially contains other shapes/labels (a "whole" split
    into parts) must not carry a centered label — it collides with the inner
    content. Drop that label; the whole is named in the caption. Labels on empty
    rectangles are kept."""
    for rect in [e for e in elements if e["type"] == "rectangle" and e.get("label")]:
        cx, cy = rect["center"]
        half_w, half_h = rect["width"] / 2, rect["height"] / 2
        left, right, bottom, top = cx - half_w, cx + half_w, cy - half_h, cy + half_h
        for other in elements:
            if other is rect or other["type"] == "axes":
                continue
            points: list[list[float]] = []
            if other.get("center"):
                points.append(other["center"])
            if other.get("position"):
                points.append(other["position"])
            points.extend(other.get("points", []))
            if any(
                left + 0.1 < px < right - 0.1 and bottom + 0.1 < py < top - 0.1
                for px, py in points
            ):
                rect.pop("label", None)
                break


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


# How far an arrow stops short of the thing it points at, in scene units.
_ARROW_CLEARANCE = 0.14
# Below this an arrow is a dot with a head; trimming that far is a worse picture
# than the overlap it was fixing, so the trim is abandoned instead.
_MIN_ARROW_LENGTH = 0.3


def _solid_regions(elements: list[dict]) -> list[Callable[[list[float]], bool]]:
    """An `is this point inside me?` test per filled shape in the scene."""
    tests: list[Callable[[list[float]], bool]] = []
    for element in elements:
        kind = element.get("type")
        if kind == "circle":
            cx, cy = element["center"]
            radius = float(element.get("radius") or 0)
            if radius > 0:
                tests.append(
                    lambda p, cx=cx, cy=cy, r=radius: (p[0] - cx) ** 2 + (p[1] - cy) ** 2 <= r * r
                )
        elif kind == "rectangle":
            cx, cy = element["center"]
            half_w = float(element.get("width") or 0) / 2
            half_h = float(element.get("height") or 0) / 2
            if half_w > 0 and half_h > 0:
                tests.append(
                    lambda p, cx=cx, cy=cy, w=half_w, h=half_h:
                    abs(p[0] - cx) <= w and abs(p[1] - cy) <= h
                )
        elif kind == "polygon" and len(element.get("points") or []) >= 3:
            tests.append(lambda p, poly=element["points"]: _inside_polygon(p, poly))
    return tests


def _inside_polygon(point: list[float], polygon: list[list[float]]) -> bool:
    """Even-odd ray casting."""
    x, y = point[0], point[1]
    inside = False
    previous = polygon[-1]
    for current in polygon:
        (x1, y1), (x2, y2) = previous, current
        if (y1 > y) != (y2 > y):
            crossing_x = x1 + (y - y1) / (y2 - y1) * (x2 - x1)
            if x < crossing_x:
                inside = not inside
        previous = current
    return inside


def _edge_between(
    inner: list[float], outer: list[float], is_inside: Callable[[list[float]], bool]
) -> list[float]:
    """Where the segment crosses the region's boundary, by bisection.

    Bisection rather than per-shape algebra because it works unchanged for a
    circle, a rectangle and an arbitrary polygon — one inside-test is all any
    new shape has to provide.
    """
    low, high = 0.0, 1.0   # low is inside, high is outside
    for _ in range(24):
        mid = (low + high) / 2
        probe = [inner[0] + (outer[0] - inner[0]) * mid, inner[1] + (outer[1] - inner[1]) * mid]
        if is_inside(probe):
            low = mid
        else:
            high = mid
    return [inner[0] + (outer[0] - inner[0]) * high, inner[1] + (outer[1] - inner[1]) * high]


def _snap_arrows_to_shapes(elements: list[dict]) -> None:
    """Pull arrow endpoints out of the shapes they touch.

    A planner writing "CO₂ enters the leaf" puts the arrowhead at the leaf's
    centre, and the arrow is then drawn buried in the fill — measured on a
    photosynthesis diagram where the light arrow ended inside the stem and the
    oxygen arrow started inside the leaf. Semantically the arrow points AT the
    shape, so it should stop just outside its edge.
    """
    regions = _solid_regions(elements)
    if not regions:
        return
    for element in elements:
        if element.get("type") != "arrow":
            continue
        points = element.get("points") or []
        if len(points) != 2:
            continue
        tail, head = list(points[0]), list(points[1])
        for is_inside in regions:
            inside_tail, inside_head = is_inside(tail), is_inside(head)
            # Both ends in (an arrow drawn inside an object) or both out
            # (it merely passes over) is the planner's intent, not a slip.
            if inside_tail == inside_head:
                continue
            if inside_head:
                moved = _retracted(head, tail, is_inside)
                if moved is not None:
                    head = moved
            else:
                moved = _retracted(tail, head, is_inside)
                if moved is not None:
                    tail = moved
        element["points"] = [tail, head]


def _retracted(
    inner: list[float], outer: list[float], is_inside: Callable[[list[float]], bool]
) -> Optional[list[float]]:
    """`inner` moved out to the boundary plus clearance, or None if too short."""
    edge = _edge_between(inner, outer, is_inside)
    dx, dy = outer[0] - inner[0], outer[1] - inner[1]
    length = math.hypot(dx, dy)
    if not length:
        return None
    snapped = [
        edge[0] + dx / length * _ARROW_CLEARANCE,
        edge[1] + dy / length * _ARROW_CLEARANCE,
    ]
    if math.hypot(outer[0] - snapped[0], outer[1] - snapped[1]) < _MIN_ARROW_LENGTH:
        return None
    return [round(snapped[0], 3), round(snapped[1], 3)]


_RIGHT_ANGLE_LABEL = re.compile(r"^(?:90\s*(?:°|º|degrees?)?|זווית\s+ישרה|زاوية\s+قائمة|right\s+angle)$", re.IGNORECASE)

_DIGIT = re.compile(r"\d")
# Anything that plots something. If one of these is present the frame is doing
# real work — a sine curve on axes needs no digit label to be about data, and a
# balance or a drawn object is a subject even when nothing on it is a number.
_DATA_BEARING = {
    "polyline", "polygon", "point", "circle", "arc", "rectangle",
    "line", "arrow", "angle", "right_angle", "brace", "molecule",
    "prop", "drawing",
}


def _is_decorative_scale(elements: list[dict]) -> bool:
    """True when a number_line/axes is being used to arrange WORDS, not data.

    The observed failure: a four-rule lab protocol became a 0..10 number line
    with ticks at 2/5/8 labelled "עדין מאוד" / "גדול יותר" / "סימון א׳". A scale is
    a measuring instrument, so the learner reads those ticks as quantities — but
    they measure nothing; the words are the explanation pasted onto a convenient
    shape.

    Four conditions, because each alone has honest uses and the bias must be
    toward keeping (a wrongly dropped visual is invisible, a wrongly kept one
    teaches something false):
      * a text element carries a WORD — a bare line marking -7, 0, 4 is fine,
      * nothing else is plotted — a curve, a shape or a brace means the frame
        has a subject,
      * no label anywhere holds a digit — nothing on the canvas is a quantity,
      * every mark sits exactly on a tick — real readings land off the grid
        (marks 3, 3.4, 8 are three measurements; marks 2, 5, 8 are furniture).
    """
    frames = [e for e in elements if e["type"] in {"number_line", "axes"}]
    if not frames:
        return False
    if any(e["type"] in _DATA_BEARING for e in elements):
        return False
    words = False
    for element in elements:
        for value in (
            element.get("label"),
            element.get("x_label"),
            element.get("y_label"),
            *(element.get("labels") or []),
            *(element.get("side_labels") or []),
        ):
            if not value:
                continue
            if _DIGIT.search(str(value)):
                return False
            if element["type"] == "text":
                words = True
    if not words:
        return False
    for frame in frames:
        span = frame.get("range")
        marks = frame.get("marks") or []
        if not span or not marks:
            continue
        start, _end, step = span
        if not step:
            continue
        for mark in marks:
            offset = (mark - start) / step
            if abs(offset - round(offset)) > 1e-6:
                return False  # off-grid: a real measurement, not a tick
    return True


def _normalize_number_line_scene(elements: list[dict]) -> None:
    """Force ONE coherent coordinate space on a number-line scene.

    The planner routinely mixes spaces: the line's ticks live in DATA coords
    (range e.g. 11..13) while it drops annotations at generic scene coords near
    the origin. The shared fit then dumps those annotations in a heap far from
    the line, squeezes the line into a corner, and stacks text on text
    (observed live). Deterministic repair, applied when the scene has exactly
    one number line and no axes:
      - numeric text matching a highlighted mark duplicates the tick label → drop;
        other in-range numeric text snaps to its value above the line
      - out-of-span captions move to ordered caption rows above the line center
      - arrows re-anchor to point down at the marks (or keep an in-span tip x)
      - points snap onto the line; stray decorations far from the span drop
    Everything then lives near the line's span, so the fit gives the line the
    full frame width and tick labels breathe.
    """
    lines = [e for e in elements if e["type"] == "number_line"]
    if len(lines) != 1 or any(e["type"] == "axes" for e in elements):
        return
    line = lines[0]
    start, end, step = line["range"]
    height = line["position"][1]
    lo, hi = start - step, end + step
    center_x = (start + end) / 2
    marks = line.get("marks") or []
    anchor_x = sum(marks) / len(marks) if marks else center_x

    def in_span(x: float) -> bool:
        return lo <= x <= hi

    caption_rows = 0
    kept: list[dict] = []
    for element in elements:
        kind = element["type"]
        if element is line:
            kept.append(element)
            continue
        if kind == "text":
            label = str(element.get("label") or "")
            try:
                value: Optional[float] = float(label.replace("−", "-"))
            except ValueError:
                value = None
            if value is not None and in_span(value):
                if any(abs(value - m) <= step / 2 + 1e-9 for m in marks):
                    continue   # the tick/mark label already says this number
                element["position"] = [value, height + 0.55]
            elif in_span(element["position"][0]):
                element["position"][1] = min(
                    max(element["position"][1], height - 1.4), height + 1.8
                )
            else:
                element["position"] = [center_x, height + 1.15 + 0.62 * caption_rows]
                caption_rows += 1
            kept.append(element)
            continue
        if kind == "arrow":
            tip = element["points"][-1]
            tip_x = tip[0] if in_span(tip[0]) else anchor_x
            element["points"] = [[tip_x, height + 0.8], [tip_x, height + 0.16]]
            kept.append(element)
            continue
        if kind == "point":
            x = element["points"][0][0]
            if in_span(x):
                element["points"] = [[x, height]]
                kept.append(element)
            continue   # a dot far from the line decorates nothing — drop
        if kind == "brace":
            if all(in_span(p[0]) for p in element["points"]):
                kept.append(element)
            continue
        points = element.get("points") or (
            [element["center"]] if "center" in element else []
        )
        if points and not any(in_span(p[0]) for p in points):
            continue
        kept.append(element)
    elements[:] = kept


# Only shapes a learner can meaningfully grab. A handle on a sampled curve or
# an axis would move a point with no semantics behind it.
_DRAGGABLE_KINDS = {"point", "polygon"}
MAX_HANDLES = 4


def _sanitize_interactive(
    raw: object,
    elements: list[dict],
    index_map: dict[int, int],
) -> Optional[dict]:
    """Validate planner-requested drag handles against the surviving elements.

    Interactivity is additive and must never be load-bearing: a renderer that
    ignores ``interactive`` still draws a correct static picture, which is why
    handles carry no geometry of their own — only a reference to a vertex that
    already exists.
    """
    if not isinstance(raw, dict):
        return None

    handles: list[dict] = []
    for candidate in (raw.get("handles") or [])[:MAX_HANDLES]:
        if not isinstance(candidate, dict):
            continue
        target = index_map.get(candidate.get("element"))
        if target is None:
            continue                                  # pointed at a dropped element
        element = elements[target]
        if element.get("type") not in _DRAGGABLE_KINDS:
            continue
        handle: dict = {"element": target}
        if element["type"] == "polygon":
            vertex = candidate.get("vertex")
            if not isinstance(vertex, int) or not 0 <= vertex < len(element["points"]):
                continue
            handle["vertex"] = vertex
        if handle not in handles:
            handles.append(handle)

    if not handles:
        return None
    return {"handles": handles}


def sanitize_scene(
    raw: object,
    text_filter: Optional[Callable[[str], str]] = None,
    subject: Optional[str] = None,
) -> Optional[dict]:
    """Validate and bound an untrusted model-produced scene specification.

    ``subject`` selects which registered domains may contribute element types,
    so a chemistry vocabulary is not accepted in a geometry lesson.
    """
    if not isinstance(raw, dict) or raw.get("use_visual") is not True:
        return None

    raw_elements = raw.get("elements")
    if not isinstance(raw_elements, list):
        return None

    has_axes = any(
        isinstance(candidate, dict) and candidate.get("type") == "axes"
        for candidate in raw_elements[:MAX_ELEMENTS]
    )
    # A number line defines a data space exactly as axes do: its range is the
    # meaning of x, so an annotation at the value 8 of a 0..10 line is valid
    # even though 8 is outside the canvas. Clamping those to canvas bounds
    # silently dragged every annotation past 6.6 back to 6.6 — a caption about
    # the mark at 8 pointed at 6.6, and a brace spanning to 8 stopped short
    # (both visible in a live render, and neither was the planner's fault).
    has_number_line = any(
        isinstance(candidate, dict) and candidate.get("type") == "number_line"
        for candidate in raw_elements[:MAX_ELEMENTS]
    )
    diagram_point = _data_point if (has_axes or has_number_line) else _point

    elements: list[dict] = []
    # Anchors reference elements by the planner's own index, but invalid
    # elements are dropped below — so record where each surviving element
    # landed and remap anchors once the list is final.
    index_map: dict[int, int] = {}
    for source_index, candidate in enumerate(raw_elements[:MAX_ELEMENTS]):
        if not isinstance(candidate, dict):
            continue
        kind = candidate.get("type")
        if kind not in _CORE_ELEMENTS and kind not in registry.element_types(subject):
            continue
        color = candidate.get("color") if candidate.get("color") in COLORS else "primary"
        clean: dict = {"type": kind, "color": color}

        if kind in {"polygon", "polyline", "line", "arrow", "point", "angle", "right_angle", "brace"}:
            raw_points = candidate.get("points")
            if not isinstance(raw_points, list):
                continue
            points = [p for p in (diagram_point(item) for item in raw_points) if p]
            required = {
                "polygon": 3, "polyline": 2, "line": 2, "arrow": 2,
                "point": 1, "angle": 3, "right_angle": 3, "brace": 2,
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
            # A label may name a piece of geometry instead of guessing a
            # coordinate; the placement solver turns that into a position.
            anchor = candidate.get("anchor")
            if isinstance(anchor, dict) and isinstance(anchor.get("element"), int):
                at = anchor.get("at")
                clean["anchor"] = {
                    "element": anchor["element"],
                    "at": at if isinstance(at, str) and len(at) <= 24 else "center",
                }
        elif kind == "prop":
            # A composite object named from a fixed catalogue. Unknown names are
            # dropped rather than approximated: a prop the renderer cannot build
            # would leave a hole in the picture with the labels still floating
            # where its parts should have been.
            from app.agents.visuals.shapes import PROP_KINDS

            name = str(candidate.get("prop") or "").strip().lower()
            if name not in PROP_KINDS:
                continue
            center = diagram_point(candidate.get("center", [0, 0]))
            if center is None:
                continue
            clean.update({"prop": name, "center": center})
            for key in (
                "size", "tilt", "left_mass", "right_mass", "inflation", "width",
                "height", "fill_level", "count", "particles", "particle_size",
                "graduations", "seed", "bar_width",
            ):
                number = _number(candidate.get(key), 1000.0)
                if number is not None:
                    clean[key] = number
            # A prop's `size` multiplies its footprint, and a balance at size
            # 4.8 spans wider than the whole canvas. The planner reaches for big
            # numbers because they read as "make it prominent"; the cap turns
            # that into the largest size that still fits rather than a shape
            # running off both edges.
            if "size" in clean:
                clean["size"] = max(0.3, min(float(clean["size"]), 1.8))
            for key in ("state", "shape", "style", "liquid_color", "particle_color", "pan_color"):
                value = candidate.get(key)
                if isinstance(value, str) and len(value) <= 24:
                    clean[key] = value
            if candidate.get("string"):
                clean["string"] = True
            # What sits ON a balance pan, built by the scale itself so it lands
            # on the pan after the beam has tilted. One level only: a load
            # carrying its own load is not a picture of anything.
            for slot in ("left_load", "right_load", "load"):
                load = candidate.get(slot)
                if not isinstance(load, dict) or str(load.get("prop") or "") not in PROP_KINDS:
                    continue
                nested: dict = {"prop": str(load["prop"])}
                for key in ("size", "inflation", "count", "particles", "fill_level", "seed", "width", "height", "graduations"):
                    number = _number(load.get(key), 1000.0)
                    if number is not None:
                        nested[key] = number
                for key in ("state", "shape", "style", "color", "particle_color", "liquid_color"):
                    value = load.get(key)
                    if isinstance(value, str) and len(value) <= 24:
                        nested[key] = value
                clean[slot] = nested
            labels = candidate.get("labels")
            if isinstance(labels, dict):
                clean["labels"] = {
                    str(slot)[:24]: text
                    for slot, raw in list(labels.items())[:6]
                    if (text := _short_text(raw, text_filter))
                }
            items = candidate.get("items")
            if isinstance(items, list):
                clean["items"] = [
                    {
                        "value": _number(item.get("value"), 1e6) or 0.0,
                        "label": _short_text(item.get("label"), text_filter),
                        "color": item.get("color") if item.get("color") in COLORS else None,
                    }
                    for item in items[:5]
                    if isinstance(item, dict) and _number(item.get("value"), 1e6) is not None
                ]
                if not clean["items"]:
                    continue
                # A prop's text is drawn from `labels` at named anchors, so an
                # item's own `label` — the obvious place for a planner to put a
                # bar's name, and where it does put it — was accepted and then
                # silently never drawn. Observed live: three correctly
                # proportioned bars with nothing written on any of them, which
                # on a question about which reading differs is a picture of
                # nothing. Promote name and value onto the anchors the renderer
                # actually reads, without overriding a label already given.
                promoted = dict(clean.get("labels") or {})
                # One shared precision, taken from the most precise reading.
                # `%g` drops trailing zeros, so 12.0 printed as "12" beside
                # "12.1" — on a question about which readings are nearly
                # identical, that is the comparison being erased. Whole numbers
                # stay whole: 40 g is not "40.0 g".
                decimals = max(_decimals(item["value"]) for item in clean["items"])
                for position, item in enumerate(clean["items"]):
                    if item.get("label"):
                        promoted.setdefault(f"foot:{position}", item["label"])
                    promoted.setdefault(f"top:{position}", f"{item['value']:.{decimals}f}")
                clean["labels"] = promoted

        elif kind == "drawing":
            # Any shape the catalogue does not have. Authored in the planner's
            # own coordinates and fitted here, so it cannot be off-canvas or
            # the wrong scale — the planner supplies shape, never layout.
            from app.agents.visuals.drawing import clean_drawing

            center = diagram_point(candidate.get("center", [0, 0]))
            drawing = clean_drawing(
                candidate, colors=COLORS, short_text=_short_text, text_filter=text_filter
            )
            if center is None or drawing is None:
                continue
            clean.update(drawing)
            clean["center"] = center
            clean["size"] = max(0.2, min(_number(candidate.get("size"), 1000.0) or 1.5, 5.0))
            labels = candidate.get("labels")
            if isinstance(labels, dict):
                clean["labels"] = {
                    str(slot)[:16]: text
                    for slot, raw in list(labels.items())[:5]
                    if (text := _short_text(raw, text_filter))
                }

        elif kind == "molecule":
            # RDKit decides whether this is a molecule at all. An unparseable
            # string is dropped here and never reaches a renderer.
            verified = validate_molecule(candidate.get("smiles"), candidate.get("highlight"))
            if verified is None:
                continue
            clean.update(verified)
            clean["view"] = "3d" if candidate.get("view") == "3d" else "2d"
        elif kind == "number_line":
            position = diagram_point(candidate.get("position", [0, 0]))
            value_range = _range(candidate.get("range"))
            if position is None or value_range is None:
                continue
            raw_marks = candidate.get("marks")
            marks = [
                mark for mark in (
                    _number(item, 1000.0)
                    for item in (raw_marks if isinstance(raw_marks, list) else [])[:12]
                )
                if mark is not None and value_range[0] <= mark <= value_range[1]
            ]
            clean.update({"position": position, "range": value_range, "marks": marks})
        else:
            # A type contributed by a registered domain. It validates itself, and
            # anything it will not vouch for is dropped rather than approximated.
            validate = registry.validator_for(kind, subject)
            validated = validate(
                candidate,
                point=diagram_point,
                number=_number,
                text=lambda value: _short_text(value, text_filter),
            ) if validate else None
            if not validated:
                continue
            clean.update(validated)

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

        # Staged-animation metadata (bounded; ignored on static renders).
        step = candidate.get("step")
        if isinstance(step, (int, float)) and not isinstance(step, bool):
            clean["step"] = max(0, min(MAX_ANIMATION_STEPS, int(step)))
        animate = candidate.get("animate")
        if animate in ANIMATION_KINDS:
            clean["animate"] = animate
        slide_from = diagram_point(candidate.get("from"))
        if slide_from is not None:
            clean["from"] = slide_from
        # The same prop twice in the same place is always a planner slip — it
        # happens when the model reissues an element to add a label — and it
        # renders as one shape at double stroke weight with two label sets
        # printed over each other.
        if kind == "prop" and any(
            existing.get("type") == "prop"
            and existing.get("prop") == clean["prop"]
            and abs(existing["center"][0] - clean["center"][0]) < 0.25
            and abs(existing["center"][1] - clean["center"][1]) < 0.25
            for existing in elements
        ):
            continue
        index_map[source_index] = len(elements)
        elements.append(clean)

    if not elements:
        return None

    # Anchors were written against the planner's indices; drop any that pointed
    # at an element we rejected rather than letting them alias a different one.
    for element in elements:
        anchor = element.get("anchor")
        if not isinstance(anchor, dict):
            continue
        remapped = index_map.get(anchor.get("element"))
        if remapped is None:
            element.pop("anchor", None)
        else:
            anchor["element"] = remapped

    interactive = _sanitize_interactive(raw.get("interactive"), elements, index_map)

    title = _short_text(raw.get("title"), text_filter, 90)
    _dedupe_scene_text(elements, title)
    _prune_text_annotations(elements)
    _drop_container_rect_labels(elements)
    maths.align_triangle_side_measures(elements)
    maths.bind_semantic_geometry_labels(elements)
    for repair in registry.normalizers(subject):
        repair(elements)
    _normalize_number_line_scene(elements)
    _snap_arrows_to_shapes(elements)
    _fit_axes_to_elements(elements)
    has_molecule = any(item["type"] == "molecule" for item in elements)
    if has_molecule:
        # The contract forbids mixing molecules with geometry, and the chemistry
        # renderer only draws molecules — so a stray geometry element would be
        # dropped on the client anyway, silently and after the layout solver had
        # already been skipped for it. Drop it here instead, where it is visible
        # in the scene the rest of the pipeline reasons about.
        dropped = [item["type"] for item in elements if item["type"] != "molecule"]
        if dropped:
            print(f"ℹ️ Molecule scene: dropped non-molecule elements {dropped}")
        elements = [item for item in elements if item["type"] == "molecule"]
    if _is_decorative_scale(elements):
        # A ruler measuring vocabulary. Better to show the learner nothing than
        # a scale whose numbers mean nothing; the planner gets one retry.
        print("ℹ️ Dropped scene: numeric frame carried no data (decorative scale)")
        return None
    has_composite = any(item["type"] in {"prop", "drawing"} for item in elements)
    scene = {
        "use_visual": True,
        # Derived from what survived validation, not from what the planner
        # claimed: a scene whose only molecule was rejected is not a molecule
        # scene, and must not be routed to the chemistry renderer. "diagram"
        # means a composite object is present — a balance, a vessel, a freehand
        # shape — which the in-browser geometry renderer cannot draw, so the
        # still is served from the server SVG instead of silently losing it.
        "render": "molecule" if has_molecule else ("diagram" if has_composite else "geometry"),
        "animated": raw.get("animated") is True,
        **({"interactive": interactive} if interactive else {}),
        "title": title,
        "alt": _short_text(raw.get("alt"), text_filter, 240),
        "caption": _short_text(raw.get("caption"), text_filter, 180),
        "elements": elements,
    }
    # Molecules carry no coordinates — the chemistry toolkit does their layout —
    # so the geometry solver has nothing to place.
    if has_molecule:
        return scene
    # Solve label placement last: every normalizer above can move geometry, and
    # the solver must see the final coordinates. Renderers that ignore `layout`
    # keep working from the original fields, so this stays additive.
    return solve_scene_layout(scene)


# The learner pressed "show me a visual", so refusing is not on the table. But a
# bare "you must draw" collides with the HARD BAR above, and the planner resolves
# that conflict the wrong way: it keeps the words and borrows a shape to hang them
# on. Observed output for a four-rule lab protocol was a 0..10 number line with
# ticks at 2/5/8 labelled "עדין מאוד" / "גדול יותר" — a measuring instrument used
# as a layout device, its numbers referring to nothing. So this directive does not
# ask for A picture; it says WHICH picture: the one measurable claim, drawn as data.
_ON_DEMAND_DIRECTIVE = {
    "he": (
        "\nהלומד/ת ביקש/ה במפורש לראות המחשה של ההסבר הזה — חובה להחזיר "
        "use_visual=true. לכן אסור לצייר את המילים של ההסבר. אתר/י בתוך ההסבר את הטענה "
        "האחת שיש לה תוכן מדיד, מרחבי או כמותי, וצייר/י אותה בלבד — עם מספרים ממשיים. "
        "אם ההסבר הוא אוסף כללים או נוהל עבודה, בחר/י את הכלל היחיד שעוסק בכמות, במיקום "
        "או בסדר גודל, והמחיש/י אותו בדוגמה מספרית סבירה שתמציא/י — למשל שלוש מדידות "
        "קרובות זו לזו ואחת רחוקה מהן, כך שהחריגה נראית כמרחק ולא נקראת כתווית. "
        "שאר הכללים, אלה שלא ניתנים לציור, נשארים בטקסט ולא מגיעים לקנבס."
    ),
    "ar": (
        "\nطلب المتعلّم صراحةً رؤية توضيح لهذا الشرح — يجب إعادة use_visual=true. "
        "لذلك لا ترسم كلمات الشرح. ابحث داخل الشرح عن الادّعاء الوحيد ذي المحتوى القابل "
        "للقياس أو المكاني أو الكمّي، وارسمه وحده — بأرقام حقيقية. إذا كان الشرح مجموعة "
        "قواعد أو إجراءً، فاختر القاعدة الوحيدة المتعلّقة بالكمية أو الموضع أو المقدار، "
        "ووضّحها بمثال رقمي معقول تخترعه — مثلاً ثلاث قياسات متقاربة وواحدة بعيدة عنها، "
        "فيظهر الشاذّ كمسافة لا كعنوان. أمّا القواعد غير القابلة للرسم فتبقى نصًّا لا على اللوحة."
    ),
    "en": (
        "\nThe learner explicitly asked to SEE a visual of this explanation — you "
        "MUST return use_visual=true. Therefore do NOT draw the explanation's words. "
        "Find the ONE claim inside the explanation that has measurable, spatial or "
        "quantitative content and draw only that — with real numbers. If the explanation "
        "is a set of rules or a procedure, pick the single rule that is about quantity, "
        "position or magnitude and illustrate it with a plausible numeric example you "
        "invent — e.g. three readings close together and one far from them, so the "
        "outlier is SEEN as distance rather than read as a label. The remaining rules, "
        "the ones that cannot be drawn, stay in the text and never reach the canvas."
    ),
}
_PREFER_ANIMATION_DIRECTIVE = {
    "he": (
        "\nבחר/י סצנה מונפשת: קבע/י animated=true והצג/י את הרעיון שלב-אחר-שלב עם "
        "step (0..5) ו-animate לכל אלמנט — תנועה או בנייה מדורגת עדיפה על תמונה."
    ),
    "ar": (
        "\nاختر مشهدًا متحركًا: اضبط animated=true واعرض الفكرة خطوة بخطوة باستخدام "
        "step (0..5) و-animate لكل عنصر — الحركة أو البناء المتدرّج أفضل من صورة ثابتة."
    ),
    "en": (
        "\nChoose an ANIMATED scene: set animated=true and reveal the idea "
        "step-by-step with per-element step (0..5) and animate — motion or staged "
        "construction beats a still picture."
    ),
}
_PREFER_STILL_DIRECTIVE = {
    "he": "\nהחזר/י תמונה סטטית אחת וברורה: animated=false, בלי שלבים.",
    "ar": "\nأعد صورة ثابتة واحدة وواضحة: animated=false، دون خطوات.",
    "en": "\nReturn one clear STILL image: animated=false, no steps.",
}

# A hint is written to withhold: it names no value and no option, so planning
# from the reply alone leaves nothing to draw. The question carries the data,
# and putting the GIVENS on the canvas is the most useful thing a hint can do —
# it is what the learner is looking at, not the step that solves it.
_QUESTION_CONTEXT_DIRECTIVE = {
    "he": (
        "\n<current_question> הוא מה שהתלמיד/ה רואה על המסך עכשיו. המספרים, השמות והכמויות "
        "שבו הם הנתונים האמיתיים — צייר/י אותם בדיוק כפי שהם, ואל תמציא/י ערך שלא מופיע שם. "
        "גם כשתשובת המלווה נמנעת במכוון ממספרים (רמז), מותר ונכון לצייר את הנתונים של השאלה. "
        "אסור לצייר את הפתרון: הצג/י את הנתונים, לא את ההכרעה בין האפשרויות."
    ),
    "ar": (
        "\n<current_question> هو ما يراه الطالب/ة على الشاشة الآن. الأرقام والأسماء والكميات "
        "فيه هي المعطيات الحقيقية — ارسمها كما هي تمامًا ولا تخترع قيمة لا ترد فيه. وحتى حين "
        "يتجنّب ردّ المرافق الأرقام عمدًا (تلميح)، يجوز بل يُستحسن رسم معطيات السؤال. "
        "لا ترسم الحلّ: اعرض المعطيات لا الحسم بين الخيارات."
    ),
    "en": (
        "\n<current_question> is what the learner is looking at right now. Its numbers, names "
        "and quantities are the real data — draw them exactly as given, and never invent a value "
        "that is not there. Even when the coach's reply deliberately avoids numbers (a hint), "
        "drawing the question's data is allowed and is usually the most useful thing to do. "
        "Never draw the solution: show the givens, not the choice between the options."
    ),
}


async def plan_manim_visual(
    user_message: str,
    assistant_response: str,
    language: str,
    usage_context: UsageContext,
    text_filter: Optional[Callable[[str], str]] = None,
    *,
    prefer_animation: Optional[bool] = None,
    force_visual: bool = False,
    subject: Optional[str] = None,
    question_context: Optional[str] = None,
) -> Optional[dict]:
    """Let the Coach choose the visual tool and return a constrained scene.

    ``force_visual`` (on-demand "show me a visual" button) tells the planner it
    must produce a scene; ``prefer_animation`` steers video vs. still. The final
    ``animated`` flag is still re-asserted by the caller to match the request.
    ``subject`` selects which domain vocabularies are offered and accepted.

    ``question_context`` is the question the learner is actually looking at. A
    hint is written to withhold — no values, no options — so planning from the
    reply alone leaves nothing concrete to draw and the planner rightly
    declines. The question is where the data lives, and drawing the GIVENS is
    the one thing a hint most wants.
    """
    lang = language if language in VISUAL_TOOL_PROMPTS else "he"

    system_content = f"{VISUAL_TOOL_PROMPTS[lang]}\n{SCENE_CONTRACT}"
    for fragment in registry.contract_fragments(subject):
        system_content += f"\n{fragment}"
    if question_context:
        system_content += _QUESTION_CONTEXT_DIRECTIVE[lang]
    if force_visual:
        system_content += _ON_DEMAND_DIRECTIVE[lang]
    if prefer_animation is True:
        system_content += _PREFER_ANIMATION_DIRECTIVE[lang]
    elif prefer_animation is False:
        system_content += _PREFER_STILL_DIRECTIVE[lang]

    question_block = (
        f"<current_question>{question_context}</current_question>\n" if question_context else ""
    )
    messages = [
        {"role": "system", "content": system_content},
        {"role": "user", "content": f"{question_block}<learner_request>{user_message}</learner_request>\n<coach_reply>{assistant_response}</coach_reply>"},
    ]
    explicit_request = force_visual or bool(_EXPLICIT_VISUAL_REQUEST[lang].search(user_message))
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
                planned = sanitize_scene(json.loads(response), text_filter, subject)
                if planned:
                    visual_context = "\n".join(
                        filter(None, (user_message, assistant_response, planned.get("alt"), planned.get("caption")))
                    )
                    maths.normalize_identity_line(planned, user_message)
                    maths.normalize_safe_function_graph(planned, user_message, language)
                    maths.ensure_parallel_angle_markers(planned, user_message, lang)
                    maths.ensure_requested_hypotenuse(planned, visual_context, lang)
                    return planned
            except (json.JSONDecodeError, TypeError, ValueError):
                print("⚠️ Manim tool returned an invalid scene")
    if explicit_request or semantic_visual:
        return (
            maths.canonical_function_scene(user_message, lang)
            or maths.canonical_midpoint_scene(user_message, lang)
            or maths.canonical_similar_triangles_scene(user_message, lang)
        )
    return None


def _svg_point(point: list[float]) -> tuple[float, float]:
    return ((point[0] + 7.0) / 14.0 * 960.0, (4.0 - point[1]) / 8.0 * 540.0)


_SVG_LABEL_XY = re.compile(r'^(<text x=")(-?[\d.]+)(" y=")(-?[\d.]+)("[^>]*>)(.*?)(</text>)$')
# Rough per-class glyph metrics (px) for collision estimates — the fallback has
# no text shaper, so labels that would stack ("50.00" over "50", a duplicated
# caption) are detected by box overlap and nudged apart vertically instead.
_SVG_LABEL_METRICS = {"tick": (10.0, 17.0), "side-label": (13.5, 23.0)}


def _spread_svg_labels(label_rows: list[str]) -> list[str]:
    """Nudge overlapping SVG text labels apart (greedy, top of file order wins)."""
    parsed: list[Optional[tuple[list[str], float, float, float, float]]] = []
    for row in label_rows:
        match = _SVG_LABEL_XY.match(row)
        if not match:
            parsed.append(None)
            continue
        parts = list(match.groups())
        char_w, line_h = 14.0, 25.0   # .label / default 25px font
        for cls, (cw, lh) in _SVG_LABEL_METRICS.items():
            if cls in parts[4]:
                char_w, line_h = cw, lh
        visible = re.sub(r"<[^>]+>", "", parts[5])
        parsed.append((parts, float(parts[1]), float(parts[3]), max(len(visible), 1) * char_w, line_h))

    placed: list[tuple[float, float, float, float]] = []
    out: list[str] = []
    for row, item in zip(label_rows, parsed):
        if item is None:
            out.append(row)
            continue
        parts, x, y, width, height = item
        for _ in range(8):   # bounded: push below the collider until clear
            hit = next(
                (p for p in placed
                 if abs(x - p[0]) < (width + p[2]) / 2 + 4
                 and abs(y - p[1]) < (height + p[3]) / 2 + 2),
                None,
            )
            if hit is None:
                break
            y = hit[1] + (hit[3] + height) / 2 + 3
        placed.append((x, y, width, height))
        parts[3] = f"{y:.1f}"
        out.append("".join(parts))
    return out


def _svg_fallback(scene: dict) -> bytes:
    """Render the safe primitive set as SVG when Manim is unavailable."""
    from app.agents.visuals import svg_shapes
    from app.agents.visuals.shapes import bounds as shape_bounds
    from app.agents.visuals.shapes import build_drawing, build_prop

    shapes: list[str] = []
    labels: list[str] = []
    # Composite objects are assembled BEFORE the fit so their extent can bound
    # it. A prop that is not measured here is a prop the scene is scaled without
    # — the balance ends up half off the frame that was fitted to the text.
    composites: dict[int, tuple[list[dict], dict]] = {}
    for index, element in enumerate(scene["elements"]):
        if element["type"] == "prop":
            built = build_prop(
                element,
                color_for=lambda name: COLORS.get(name or "primary", COLORS["primary"]),
            )
        elif element["type"] == "drawing":
            built = build_drawing(
                element,
                color_for=lambda name: COLORS.get(name or "ink", COLORS["ink"]),
            )
        else:
            continue
        if built and built[0]:
            composites[index] = built

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
    # Extents, not centres: a rectangle counted as its centre point makes the
    # fit believe the scene is smaller than it is, and the shape is then scaled
    # up until it runs off the frame it was supposed to be fitted into.
    for element in scene["elements"]:
        if element["type"] not in {"circle", "rectangle", "arc"}:
            continue
        cx, cy = element["center"]
        spread_x = max(element.get("radius", 0.0), element.get("width", 0.0) / 2)
        spread_y = max(element.get("radius", 0.0), element.get("height", 0.0) / 2)
        geometry_points.extend((
            [cx - spread_x, cy - spread_y], [cx + spread_x, cy + spread_y],
        ))
    # A number line's ticks live at data [value, height]; feeding its endpoints
    # into the fit keeps svg_point consistent for it AND for the texts/arrows the
    # planner placed relative to those values (otherwise they drift apart).
    has_number_line = any(
        element["type"] == "number_line" for element in scene["elements"]
    )
    # Composite extents are canvas units, so they may only bound the fit on a
    # bare canvas. In a number-line or axes scene the fit is in DATA units — a
    # balance spanning ±1.5 canvas would there read as ±1.5 grams and stretch a
    # 12..19 line back to zero.
    if not has_number_line and not axis_element:
        for built_shapes, _ in composites.values():
            box = shape_bounds(built_shapes)
            if box:
                geometry_points.extend(([box[0], box[1]], [box[2], box[3]]))
    geometry_points.extend(
        point
        for element in scene["elements"]
        if element["type"] == "number_line"
        for point in (
            [element["range"][0], element["position"][1]],
            [element["range"][1], element["position"][1]],
        )
    )
    # Number-line scenes were normalized into one data space; caption rows are
    # real layout and must bound the fit (else a generous scale ejects them).
    if has_number_line:
        geometry_points.extend(
            element["position"]
            for element in scene["elements"]
            if element["type"] == "text"
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
            # A number line's span is the story — allow it most of the width.
            260.0 if has_number_line else 115.0,
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

    # `visual_layout` already chose a spot for every label, avoiding the strokes
    # and the other labels. The still used to ignore that and re-derive its own
    # offsets, which is why a caption could land on the object it names here and
    # nowhere else. Solved positions are canvas units, so they come back through
    # the published transform and then through this renderer's own fit.
    canvas = scene.get("canvas") or {}
    canvas_scale_x = float(canvas.get("scale_x") or 1.0) or 1.0
    canvas_scale_y = float(canvas.get("scale_y") or 1.0) or 1.0
    canvas_offset_x = float(canvas.get("offset_x") or 0.0)
    canvas_offset_y = float(canvas.get("offset_y") or 0.0)

    def solved(element: dict, slot: str) -> Optional[tuple[float, float]]:
        position = (element.get("layout") or {}).get(slot)
        if not isinstance(position, (list, tuple)) or len(position) < 2:
            return None
        return svg_point([
            (float(position[0]) - canvas_offset_x) / canvas_scale_x,
            (float(position[1]) - canvas_offset_y) / canvas_scale_y,
        ])

    def placed(element: dict, slot: str, fallback: tuple[float, float]) -> tuple[float, float]:
        return solved(element, slot) or fallback

    for index, element in enumerate(scene["elements"]):
        kind = element["type"]
        color = COLORS[element["color"]]
        if kind in {"prop", "drawing"}:
            built = composites.get(index)
            if not built:
                continue
            built_shapes, anchors = built
            shapes.extend(svg_shapes.to_svg(built_shapes, svg_point))
            for slot, text in (element.get("labels") or {}).items():
                anchor = anchors.get(str(slot))
                if not text or not isinstance(anchor, list):
                    continue
                x, y = placed(element, f"labels:{slot}", svg_point(anchor))
                labels.append(
                    f'<text x="{x:.1f}" y="{y:.1f}" class="label backed-label" fill="{color}" '
                    f'direction="auto" unicode-bidi="plaintext">{escape(str(text))}</text>'
                )
            if element.get("label") and isinstance(anchors.get("bottom"), list):
                x, y = placed(element, "label", svg_point(anchors["bottom"]))
                labels.append(
                    f'<text x="{x:.1f}" y="{y:.1f}" class="label backed-label" fill="{color}" '
                    f'direction="auto" unicode-bidi="plaintext">{escape(element["label"])}</text>'
                )
        elif kind == "polygon":
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
                x, y = placed(element, "position", svg_point(element["position"]))
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
        elif kind == "brace":
            (x1, y1), (x2, y2) = [svg_point(point) for point in element["points"]]
            dx, dy = x2 - x1, y2 - y1
            length = math.hypot(dx, dy) or 1.0
            # Outward normal (below a horizontal span in screen space).
            nx, ny = dy / length, -dx / length
            if abs(ny) < 1e-6:
                # A vertical span has no "below" to fall back on, so the sign was
                # whatever the point order happened to give — which put the label
                # on top of the thing the brace was measuring. Curl away from the
                # middle of the frame instead.
                nx, ny = (1.0 if (x1 + x2) / 2 >= 480.0 else -1.0), 0.0
            elif ny < 0:
                nx, ny = -nx, -ny
            # A brace's depth is constant, not a fraction of what it spans —
            # that is how Manim draws it and what `visual_layout` models when it
            # places the label. The old fixed 16px flattened long braces into a
            # wavy line and buried short ones, because the same number meant a
            # different thing at every fit scale.
            scale_x, scale_y = svg_scales()
            reach = min(max(BRACE_REACH * min(scale_x, scale_y), 18.0), 64.0)
            depth = reach * (BRACE_BAR / BRACE_REACH)
            mid = ((x1 + x2) / 2 + nx * reach, (y1 + y2) / 2 + ny * reach)
            a = (x1 + nx * depth, y1 + ny * depth)
            b = (x2 + nx * depth, y2 + ny * depth)
            shapes.append(
                f'<path d="M {x1:.1f} {y1:.1f} Q {a[0]:.1f} {a[1]:.1f} {(x1 + mid[0]) / 2:.1f} {(y1 + mid[1]) / 2:.1f} '
                f'T {mid[0]:.1f} {mid[1]:.1f} '
                f'M {x2:.1f} {y2:.1f} Q {b[0]:.1f} {b[1]:.1f} {(x2 + mid[0]) / 2:.1f} {(y2 + mid[1]) / 2:.1f} '
                f'T {mid[0]:.1f} {mid[1]:.1f}" fill="none" stroke="{color}" stroke-width="3.5"/>'
            )
            if element.get("label"):
                labels.append(
                    f'<text x="{mid[0] + nx * 26:.1f}" y="{mid[1] + ny * 26 + 7:.1f}" class="side-label backed-label" '
                    f'direction="auto" unicode-bidi="plaintext">{escape(element["label"])}</text>'
                )
        elif kind == "number_line":
            start, end, step = element["range"]
            height = element["position"][1]
            # Ticks live at data [value, height] and go through the SAME
            # svg_point mapping as every other element — the old private
            # centered mapping put planner-placed texts/arrows far from the
            # tick they pointed at (the fit above includes the line's span).
            x_start, oy = svg_point([start, height])
            x_end, _ = svg_point([end, height])
            def nl_x(value: float) -> float:
                return x_start + (value - start) / (end - start) * (x_end - x_start)
            shapes.append(f'<line x1="{x_start - 14:.1f}" y1="{oy:.1f}" x2="{x_end + 14:.1f}" y2="{oy:.1f}" stroke="{color}" stroke-width="3" marker-end="url(#arrow)"/>')
            tick_values: list[float] = []
            value = start
            while value <= end + 1e-9:
                tick_values.append(value)
                value += step
            # WIDTH-aware label selection (mirrors the Manim worker): marks are
            # always labeled; endpoints and strided ticks appear only where the
            # widest label clears the actual per-tick pixel spacing.
            mark_values = [float(m) for m in element.get("marks", [])]
            last_index = len(tick_values) - 1
            per_tick = abs(x_end - x_start) / max(last_index, 1)
            widest_px = max(len(f"{v:g}") for v in tick_values) * 10.0 + 8.0
            min_gap = max(1, math.ceil(widest_px / max(per_tick, 1.0)))
            selected = [
                i for i, v in enumerate(tick_values)
                if any(abs(v - m) < 1e-6 for m in mark_values)
            ]
            for candidate in (0, last_index):
                if all(abs(candidate - s) >= min_gap for s in selected):
                    selected.append(candidate)
            for candidate in range(0, len(tick_values), min_gap):
                if all(abs(candidate - s) >= min_gap for s in selected):
                    selected.append(candidate)
            labelled = set(selected)
            for tick_index, tick_value in enumerate(tick_values):
                px = nl_x(tick_value)
                shapes.append(f'<line x1="{px:.1f}" y1="{oy - 7:.1f}" x2="{px:.1f}" y2="{oy + 7:.1f}" stroke="{color}" stroke-width="2"/>')
                if tick_index in labelled:
                    labels.append(f'<text x="{px:.1f}" y="{oy + 28:.1f}" class="tick">{tick_value:g}</text>')
            for mark in element.get("marks", []):
                shapes.append(f'<circle cx="{nl_x(mark):.1f}" cy="{oy:.1f}" r="8" fill="{COLORS["accent"]}"/>')
            if element.get("label"):
                # Above the start end — the center is where arrows/marks land.
                labels.append(f'<text x="{x_start + (x_end - x_start) * 0.1:.1f}" y="{oy - 26:.1f}" class="label backed-label" direction="auto" unicode-bidi="plaintext">{escape(element["label"])}</text>')

    labels = _spread_svg_labels(labels)

    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540" role="img">
<defs><marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto"><path d="M0,0 L0,6 L9,3 z" fill="#302b4a"/></marker></defs>
<rect width="960" height="540" rx="30" fill="#fbfaff"/>
<g>{''.join(shapes)}</g><g font-family="Arial, 'Noto Sans Hebrew', 'Noto Sans Arabic', 'Segoe UI', sans-serif" font-size="25" font-weight="700" text-anchor="middle"><style>.label,.side-label,.angle-label{{unicode-bidi:plaintext}}.label,.side-label{{fill:#302b4a}}.side-label{{font-size:23px}}.angle-label{{font-size:24px;font-weight:800}}.formula-label{{font-size:31px;font-weight:600}}.backed-label{{paint-order:stroke;stroke:#fbfaff;stroke-width:10px;stroke-linejoin:round}}.tick{{fill:#77718f;font-size:17px;font-weight:500}}</style>{''.join(labels)}</g>
</svg>'''
    return svg.encode("utf-8")


# Animated renders run several manim animations and an ffmpeg encode.
ANIMATED_RENDER_TIMEOUT_SECONDS = 90
# A chat payload guard: beyond this the still frame ships instead of the movie.
MAX_VIDEO_BYTES = 3_500_000

# Which client renderer draws each scene kind. "diagram" has no client renderer
# on purpose: composite objects are drawn once, server-side, rather than a
# second time in TypeScript where the two would drift.
_RENDERERS = {"geometry": "mafs", "molecule": "molecule", "diagram": "svg-diagram"}


def build_scene_visual(scene: dict) -> dict:
    """Package a scene for in-browser rendering — no subprocess, no Manim.

    The still-image path used to cost a Manim cold start (up to 45s) and shipped
    a base64 PNG in the chat payload, even though the sanitized scene was
    already being sent alongside it. The browser can draw the scene directly, so
    for anything not animated we send the scene and skip the render entirely.

    ``data_url`` still carries the deterministic SVG fallback. It is pure Python
    and costs a few KB, and it means a renderer that throws — an element type
    the client does not know, a bad bundle — degrades to a correct picture
    instead of a blank bubble. Cheap insurance for the whole client-render path.
    """
    payload = _svg_fallback(scene)
    encoded = base64.b64encode(payload).decode("ascii")
    return {
        "id": f"visual-{uuid4().hex}",
        "type": "scene",
        "mime_type": "image/svg+xml",
        "data_url": f"data:image/svg+xml;base64,{encoded}",
        "title": scene.get("title") or "",
        "alt": scene.get("alt") or scene.get("title") or "",
        "caption": scene.get("caption") or "",
        "renderer": _RENDERERS.get(scene.get("render", "geometry"), "mafs"),
        "scene": scene,
    }


async def render_visual(scene: dict) -> dict:
    """Route a scene to the renderer that suits its output type.

    Animated scenes are video and stay with Manim. Everything else is drawn in
    the browser from the scene spec. Both paths carry the same solved ``layout``
    from ``visual_layout``, so a still and its animated twin place labels
    identically.
    """
    if scene.get("animated") is True:
        return await render_manim_visual(scene)
    return build_scene_visual(scene)


async def render_manim_visual(scene: dict) -> dict:
    """Render a validated scene in an isolated Manim process, with SVG fallback.

    Static scenes render a PNG still. Animated scenes (``scene["animated"]``)
    render an MP4 built from the staged steps plus a final-frame PNG; the still
    is the safety net when the movie is missing or too large for a chat payload.
    """
    payload_bytes: bytes
    mime_type = "image/png"
    visual_type = "image"
    renderer = "manim"
    animated = bool(scene.get("animated"))

    with tempfile.TemporaryDirectory(prefix="yuvi-manim-") as temp_dir:
        root = Path(temp_dir)
        spec_path = root / "scene.json"
        output_path = root / "scene.png"
        movie_path = root / "scene.mp4"
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
            _, stderr = await asyncio.wait_for(
                process.communicate(),
                timeout=ANIMATED_RENDER_TIMEOUT_SECONDS if animated else RENDER_TIMEOUT_SECONDS,
            )
            if process.returncode != 0 or not output_path.exists():
                detail = stderr.decode("utf-8", errors="replace")[-300:]
                raise RuntimeError(detail or "Manim worker did not produce an image")
            payload_bytes = output_path.read_bytes()
            if animated and movie_path.exists():
                movie_bytes = movie_path.read_bytes()
                if 0 < len(movie_bytes) <= MAX_VIDEO_BYTES:
                    payload_bytes = movie_bytes
                    mime_type = "video/mp4"
                    visual_type = "video"
                else:
                    print(
                        f"ℹ️ Manim movie skipped ({len(movie_bytes)} bytes); shipping the still frame"
                    )
        except (FileNotFoundError, RuntimeError, asyncio.TimeoutError) as exc:
            if "process" in locals() and process.returncode is None:
                process.kill()
                await process.communicate()
            print(f"ℹ️ Manim renderer unavailable; using SVG fallback: {exc}")
            payload_bytes = _svg_fallback(scene)
            mime_type = "image/svg+xml"
            renderer = "svg-fallback"

    encoded = base64.b64encode(payload_bytes).decode("ascii")
    return {
        "id": f"visual-{uuid4().hex}",
        "type": visual_type,
        "mime_type": mime_type,
        "data_url": f"data:{mime_type};base64,{encoded}",
        "title": scene.get("title") or "",
        "alt": scene.get("alt") or scene.get("title") or "",
        "caption": scene.get("caption") or "",
        "renderer": renderer,
        "scene": scene,
    }
