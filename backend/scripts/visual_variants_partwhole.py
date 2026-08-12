"""Variants for the part-whole question, to test where the H/E preference ends.

`methodica-science-mass-measure-01-04-001` — an empty cup weighs 40 g, the cup
with liquid reads 115 g, what is the liquid alone? The answer (75 g) is a
DIFFERENCE, not one of the printed numbers, which makes it a different drawing
problem from the outlier question: there the picture had to show distance
between readings, here it has to show that one reading is contained in the
other.

The ranked winners from the outlier question are both represented — a value line
with the span braced (H), and a two-point plot across stages (E) — so the same
shapes can be judged on a question they were not chosen for.

    python scripts/visual_variants_partwhole.py
"""

from __future__ import annotations

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

from app.agents.manim_visual import _svg_fallback, sanitize_scene  # noqa: E402

OUT = Path(__file__).resolve().parents[1] / "artifacts" / "variants-partwhole"

CUP, TOTAL = 40.0, 115.0
LIQUID = TOTAL - CUP

# The same digital balance used in the outlier variants, authored 0..100.
SCALE = [
    {"d": "M 10 60 L 90 60 L 84 90 L 16 90 Z", "fill_opacity": 0.10},
    {"d": "M 18 48 L 82 48 L 82 58 L 18 58 Z", "fill_opacity": 0.18},
    {"d": "M 46 20 L 54 20 L 54 48 L 46 48 Z", "fill_opacity": 0.12},
    {"d": "M 24 66 L 66 66 L 66 82 L 24 82 Z", "color": "white", "fill_opacity": 0.85},
]

# Grams to canvas units for the stacked-bar variants. `bar_comparison` clamps its
# own height to 3.2, so anything placed beside it has to use the same number or
# it will not line up — the prop's scaling is invisible from outside.
BAR_HEIGHT = 3.2
UNIT = BAR_HEIGHT / TOTAL
FLOOR = -1.7


def variants() -> dict[str, dict]:
    cases: dict[str, dict] = {}

    cases["P1_two_readouts"] = {
        "title": "מה הראו המאזניים בכל שלב",
        "alt": "שני מאזניים: אחד עם כוס ריקה ואחד עם הכוס אחרי המילוי.",
        "caption": "אותה כוס, שתי שקילות. מה נוסף בין השקילה הראשונה לשנייה?",
        "elements": [
            {"type": "drawing", "center": [-3.2, 0.4], "size": 2.9, "strokes": SCALE,
             "labels": {"bottom": "כוס ריקה"}, "color": "ink"},
            {"type": "drawing", "center": [3.2, 0.4], "size": 2.9, "strokes": SCALE,
             "labels": {"bottom": "כוס עם נוזל"}, "color": "ink"},
            {"type": "text", "position": [-3.2, 0.05], "label": "40", "color": "primary"},
            {"type": "text", "position": [3.2, 0.05], "label": "115", "color": "primary"},
        ],
    }

    cases["P2_value_line_span_open"] = {
        "title": "שתי השקילות על אותו קו",
        "alt": "קו גרמים ועליו 40 ו-115, עם סוגר המסמן את המרחק ביניהן.",
        "caption": "הסוגר מסמן בדיוק את מה שנוסף לכוס. כמה גדול המרחק הזה?",
        "elements": [
            {"type": "number_line", "position": [0, 0], "range": [0, 130, 10],
             "marks": [CUP, TOTAL], "color": "ink"},
            {"type": "text", "position": [CUP, 0.95], "label": "40", "color": "ink"},
            {"type": "text", "position": [TOTAL, 0.95], "label": "115", "color": "ink"},
            {"type": "brace", "points": [[CUP, -0.5], [TOTAL, -0.5]], "label": "?",
             "color": "accent"},
        ],
    }

    cases["P3_value_line_span_answered"] = {
        "title": "מסת הנוזל היא ההפרש",
        "alt": "קו גרמים ועליו 40 ו-115, והמרחק ביניהן מסומן כ-75 גרם.",
        "caption": "המרחק בין שתי השקילות הוא מסת הנוזל עצמו.",
        "elements": [
            {"type": "number_line", "position": [0, 0], "range": [0, 130, 10],
             "marks": [CUP, TOTAL], "color": "ink"},
            {"type": "text", "position": [CUP, 0.95], "label": "40", "color": "ink"},
            {"type": "text", "position": [TOTAL, 0.95], "label": "115", "color": "ink"},
            {"type": "brace", "points": [[CUP, -0.5], [TOTAL, -0.5]], "label": "75 גרם",
             "color": "accent"},
        ],
    }

    cases["P4_stacked_bar"] = {
        "title": "מה מרכיב את 115 הגרם",
        "alt": "עמוד המחולק לשני חלקים: החלק התחתון הוא הכוס והחלק העליון הוא הנוזל.",
        "caption": "העמוד כולו הוא מה שהמאזניים שקלו. החלק התחתון הוא הכוס בלבד.",
        "elements": [
            {"type": "rectangle", "center": [0, FLOOR + CUP * UNIT / 2],
             "width": 1.9, "height": CUP * UNIT, "color": "muted", "fill_opacity": 0.30},
            {"type": "rectangle", "center": [0, FLOOR + CUP * UNIT + LIQUID * UNIT / 2],
             "width": 1.9, "height": LIQUID * UNIT, "color": "secondary", "fill_opacity": 0.22},
            {"type": "text", "position": [0, FLOOR + CUP * UNIT / 2], "label": "כוס 40",
             "color": "ink"},
            {"type": "text", "position": [0, FLOOR + CUP * UNIT + LIQUID * UNIT / 2],
             "label": "נוזל ?", "color": "ink"},
            {"type": "brace", "points": [[1.25, FLOOR], [1.25, FLOOR + TOTAL * UNIT]],
             "label": "115", "color": "ink"},
        ],
    }

    cases["P5_stages_plot"] = {
        "title": "המסה בכל שלב",
        "alt": "מערכת צירים: שלב השקילה מול המסה בגרמים.",
        "caption": "שתי נקודות, שתי שקילות. ההפרש בגובה הוא מה שנוסף.",
        "elements": [
            {"type": "axes", "position": [0, 0], "x_range": [0, 3, 1], "y_range": [0, 130, 20],
             "x_label": "שלב", "y_label": "גרם", "color": "ink"},
            {"type": "point", "points": [[1, CUP]], "label": "40", "color": "primary"},
            {"type": "point", "points": [[2, TOTAL]], "label": "115", "color": "primary"},
            {"type": "line", "points": [[1, CUP], [2, TOTAL]], "color": "muted", "dashed": True},
        ],
    }

    cases["P6_two_bars_with_gap"] = {
        "title": "לפני ואחרי המילוי",
        "alt": "שני עמודים: הכוס הריקה והכוס אחרי המילוי, עם ההפרש ביניהם מסומן.",
        "caption": "ההפרש בין שני העמודים הוא מה שהתווסף לכוס.",
        "elements": [
            {"type": "prop", "prop": "bar_comparison", "center": [-0.6, FLOOR], "height": BAR_HEIGHT,
             "bar_width": 1.0,
             "items": [{"value": CUP, "label": "ריקה", "color": "muted"},
                       {"value": TOTAL, "label": "מלאה", "color": "secondary"}],
             "labels": {"top:0": "40", "top:1": "115", "foot:0": "כוס ריקה", "foot:1": "כוס עם נוזל"}},
            {"type": "brace",
             "points": [[1.35, FLOOR + CUP * UNIT], [1.35, FLOOR + TOTAL * UNIT]],
             "label": "?", "color": "accent"},
        ],
    }
    return cases


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for name, raw in variants().items():
        scene = sanitize_scene({"use_visual": True, **raw})
        if scene is None:
            print(f"✗ {name}: refused by the sanitizer")
            continue
        (OUT / f"{name}.svg").write_bytes(_svg_fallback(scene))
        kinds = ", ".join(sorted({element["type"] for element in scene["elements"]}))
        print(f"✓ {name:28} render={scene['render']:8} elements={len(scene['elements'])} [{kinds}]")
    print(f"\n{OUT}")


if __name__ == "__main__":
    main()
