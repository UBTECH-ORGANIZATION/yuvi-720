"""How well can we draw the actual object the question is about?

The part-whole question is about a CUP. Every variant so far drew the numbers
that came out of the cup — bars, lines, points — and none of them drew a cup.
This asks what it would cost to put the object itself on the canvas, and what
that buys, by rendering the same question three ways:

1. `container` — the prop we already have. Parametric (fill level moves), but
   its silhouette is a rectangle, so it reads as a box rather than a beaker.
2. `drawing` — a hand-authored beaker. Recognisable, but the shape is frozen:
   the liquid level cannot follow the data because a path is a constant.
3. a composed scene — the beaker standing on a balance whose display carries the
   reading. This is the one that is actually about the question: the object, the
   instrument, and the value in one picture.

The point of the comparison is where the line falls. An object whose STATE
carries meaning (a level, a tilt, a reading) has to be parametric, so it belongs
in the prop catalogue. An object that only needs to be recognised can be a
frozen drawing. Getting that backwards produces either a box that should have
been a beaker, or a beautiful picture that cannot show the data.

    python scripts/visual_objects_demo.py
"""

from __future__ import annotations

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

from app.agents.manim_visual import _svg_fallback, sanitize_scene  # noqa: E402

OUT = Path(__file__).resolve().parents[1] / "artifacts" / "objects"

# A laboratory beaker, authored in its own 0..100 space (y down) and fitted for
# us. Body first — the recognisable silhouette has to be the first stroke.
BEAKER_EMPTY = [
    {"d": "M 20 14 L 25 86 Q 26 93 34 93 L 66 93 Q 74 93 75 86 L 80 14", "fill_opacity": 0.04},
    {"d": "M 14 14 L 86 14", "stroke_width": 5},
    {"d": "M 80 14 Q 90 17 87 25", "stroke_width": 4},
    {"d": "M 62 34 L 76 34 M 64 50 L 78 50 M 66 66 L 79 66", "stroke_width": 3},
]
# The same beaker with liquid in it — a SECOND authored path, because a frozen
# drawing cannot move its own level. This is the cost of the drawing tier.
BEAKER_FILLED = BEAKER_EMPTY + [
    {"d": "M 23 44 L 25 86 Q 26 93 34 93 L 66 93 Q 74 93 75 86 L 77 44 Z",
     "color": "secondary", "fill_opacity": 0.45},
]
# A digital balance with a display panel, used as the stand for the beaker.
BALANCE = [
    {"d": "M 8 62 L 92 62 L 86 92 L 14 92 Z", "fill_opacity": 0.10},
    {"d": "M 16 50 L 84 50 L 84 60 L 16 60 Z", "fill_opacity": 0.20},
    {"d": "M 22 68 L 62 68 L 62 84 L 22 84 Z", "color": "white", "fill_opacity": 0.9},
]


def variants() -> dict[str, dict]:
    return {
        "O1_prop_container": {
            "title": "הכלי כפי שהוא מצויר היום",
            "alt": "שני כלים מלבניים, אחד ריק ואחד מלא.",
            "caption": "הפרופ הקיים: המפלס נכון, אבל הצורה היא מלבן ולא כוס.",
            "elements": [
                {"type": "prop", "prop": "container", "center": [-2.4, 0], "width": 1.8,
                 "height": 2.6, "fill_level": 0.0, "graduations": 5,
                 "labels": {"top": "כוס ריקה"}},
                {"type": "prop", "prop": "container", "center": [2.4, 0], "width": 1.8,
                 "height": 2.6, "fill_level": 0.65, "graduations": 5,
                 "labels": {"top": "כוס עם נוזל"}},
            ],
        },
        "O2_drawing_beaker": {
            "title": "כוס מדידה מצוירת",
            "alt": "שתי כוסות מדידה, אחת ריקה ואחת מלאה בנוזל.",
            "caption": "אותה שאלה, עם הכלי שהיא באמת מדברת עליו.",
            "elements": [
                {"type": "drawing", "center": [-2.4, 0.1], "size": 3.0,
                 "strokes": BEAKER_EMPTY, "labels": {"bottom": "כוס ריקה"}, "color": "ink"},
                {"type": "drawing", "center": [2.4, 0.1], "size": 3.0,
                 "strokes": BEAKER_FILLED, "labels": {"bottom": "כוס עם נוזל"}, "color": "ink"},
            ],
        },
        "O3_object_on_instrument": {
            "title": "הכוס על המאזניים",
            "alt": "כוס מדידה עומדת על מאזניים דיגיטליים שמציגים את התוצאה.",
            "caption": "הכלי, המכשיר והתוצאה באותה תמונה.",
            "elements": [
                {"type": "drawing", "center": [-3.0, 1.15], "size": 2.0,
                 "strokes": BEAKER_EMPTY, "color": "ink"},
                {"type": "drawing", "center": [-3.0, -1.15], "size": 2.3,
                 "strokes": BALANCE, "color": "ink"},
                {"type": "text", "position": [-3.35, -1.5], "label": "40", "color": "primary"},
                {"type": "drawing", "center": [3.0, 1.15], "size": 2.0,
                 "strokes": BEAKER_FILLED, "color": "ink"},
                {"type": "drawing", "center": [3.0, -1.15], "size": 2.3,
                 "strokes": BALANCE, "color": "ink"},
                {"type": "text", "position": [2.65, -1.5], "label": "115", "color": "primary"},
            ],
        },
    }


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for name, raw in variants().items():
        scene = sanitize_scene({"use_visual": True, **raw})
        if scene is None:
            print(f"✗ {name}: refused by the sanitizer")
            continue
        (OUT / f"{name}.svg").write_bytes(_svg_fallback(scene))
        print(f"✓ {name:26} render={scene['render']:8} elements={len(scene['elements'])}")
    print(f"\n{OUT}")


if __name__ == "__main__":
    main()
