"""Draw one real question several different ways, for a human to rank.

The question is `methodica-science-mass-measure-01-02-001` סעיף א — the outlier
reading. It is the most common shape in the live catalogue (a series of
measurements) and it is the case the old pipeline got wrong: it drew a number
line and invented 12.9 for a reading that is actually 18.7.

Each variant is a different decision about WHAT the picture should carry:
position, magnitude, the instrument, or the comparison. They also differ in how
much they give away, which matters because the answer is one of the readings —
a picture that highlights the outlier has answered the question.

    python scripts/visual_variants.py
"""

from __future__ import annotations

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

from app.agents.manim_visual import _svg_fallback, sanitize_scene  # noqa: E402

OUT = Path(__file__).resolve().parents[1] / "artifacts" / "variants"

QUESTION = (
    "סעיף א: עדן, פלג ושחר ביצעו סדרת מדידות של מסת מוצק. "
    "שחר: 12.1 גרם, פלג: 12.0 גרם, עדן: 18.7 גרם. האם ישנה תוצאה חריגה בעיניכם?"
)
READINGS = [("שחר", 12.1), ("פלג", 12.0), ("עדן", 18.7)]

# A simple digital balance, authored in its own 0..100 space and fitted for us.
SCALE_STROKES = [
    {"d": "M 10 60 L 90 60 L 84 90 L 16 90 Z", "fill_opacity": 0.10},
    {"d": "M 18 48 L 82 48 L 82 58 L 18 58 Z", "fill_opacity": 0.18},
    {"d": "M 46 20 L 54 20 L 54 48 L 46 48 Z", "fill_opacity": 0.12},
    {"d": "M 24 66 L 66 66 L 66 82 L 24 82 Z", "color": "white", "fill_opacity": 0.85},
]


def variants() -> dict[str, dict]:
    cases: dict[str, dict] = {}

    cases["A_number_line_neutral"] = {
        "title": "שלוש המדידות על קו אחד",
        "alt": "קו מספרים בגרמים ועליו שלוש המדידות שנמדדו.",
        "caption": "כל מדידה מסומנת על קו הגרמים. שימו לב למרחקים ביניהן.",
        "elements": [
            {"type": "number_line", "position": [0, 0], "range": [11.5, 19.5, 1],
             "marks": [value for _, value in READINGS], "color": "ink"},
        ],
    }

    cases["B_number_line_named"] = {
        "title": "מי מדד מה",
        "alt": "קו מספרים בגרמים ועליו שלוש המדידות, כל אחת עם שם המודד.",
        "caption": "אותו קו, והפעם עם השמות: אפשר לראות מי קרוב למי.",
        "elements": [
            {"type": "number_line", "position": [0, 0], "range": [11.5, 19.5, 1],
             "marks": [value for _, value in READINGS], "color": "ink"},
            *(
                {"type": "text", "position": [value, 0.9], "label": name, "color": "ink"}
                for name, value in READINGS
            ),
        ],
    }

    cases["C_number_line_cluster_brace"] = {
        "title": "מה קרוב למה",
        "alt": "קו מספרים ועליו סוגר המסמן את שתי המדידות הקרובות זו לזו.",
        "caption": "הסוגר מסמן את שתי המדידות שכמעט חופפות. כמה רחוקה מהן השלישית?",
        "elements": [
            {"type": "number_line", "position": [0, 0], "range": [11.5, 19.5, 1],
             "marks": [value for _, value in READINGS], "color": "ink"},
            {"type": "brace", "points": [[12.0, 0.35], [12.1, 0.35]], "label": "כמעט זהות",
             "color": "secondary"},
        ],
    }

    cases["D_bars_neutral"] = {
        "title": "גובה כל מדידה",
        "alt": "שלושה עמודים שגובהם הוא ערך המדידה בגרמים.",
        "caption": "גובה כל עמוד הוא המסה שנמדדה. ההפרש בגובה הוא ההפרש במסה.",
        "elements": [
            {"type": "prop", "prop": "bar_comparison", "center": [0, -1.4], "height": 2.6,
             "bar_width": 0.75,
             "items": [{"value": value, "label": name} for name, value in READINGS],
             "labels": {
                 "top:0": "12.1", "top:1": "12.0", "top:2": "18.7",
                 "foot:0": "שחר", "foot:1": "פלג", "foot:2": "עדן",
             }},
        ],
    }

    cases["E_scatter_by_attempt"] = {
        "title": "המדידות לפי סדר הביצוע",
        "alt": "מערכת צירים: מספר המדידה מול המסה בגרמים.",
        "caption": "כל נקודה היא מדידה אחת. שתי נקודות באותו גובה כמעט, ואחת גבוהה בהרבה.",
        "elements": [
            {"type": "axes", "position": [0, 0], "x_range": [0, 4, 1], "y_range": [11, 20, 1],
             "x_label": "מדידה", "y_label": "גרם", "color": "ink"},
            *(
                {"type": "point", "points": [[index + 1, value]], "label": f"{value:g}",
                 "color": "primary"}
                for index, (_, value) in enumerate(READINGS)
            ),
        ],
    }

    cases["F_three_scales"] = {
        "title": "מה הראו המאזניים",
        "alt": "שלושה מאזניים דיגיטליים, כל אחד עם התוצאה שהוצגה עליו.",
        "caption": "כל מאזניים מציגים את התוצאה שהתקבלה באותה מדידה.",
        "elements": [
            *(
                {"type": "drawing", "center": [x, 0.35], "size": 2.5, "strokes": SCALE_STROKES,
                 "labels": {"bottom": name}, "color": "ink"}
                for (name, _), x in zip(READINGS, (-4.2, 0.0, 4.2))
            ),
            *(
                {"type": "text", "position": [x, 0.05], "label": f"{value:g}", "color": "primary"}
                for (_, value), x in zip(READINGS, (-4.2, 0.0, 4.2))
            ),
        ],
    }

    cases["G_two_containers"] = {
        "title": "אותה כמות, מדידות שונות",
        "alt": "שני כלים מדורגים זה לצד זה, אחד מלא הרבה יותר מהשני.",
        "caption": "אם מדדנו את אותו גוף, האם הגיוני שכלי אחד יראה כל כך יותר?",
        "elements": [
            {"type": "prop", "prop": "container", "center": [-2.2, -0.2], "width": 1.7,
             "height": 2.6, "fill_level": 0.62, "graduations": 6,
             "labels": {"top": "12.1 ו-12.0"}},
            {"type": "prop", "prop": "container", "center": [2.2, -0.2], "width": 1.7,
             "height": 2.6, "fill_level": 0.96, "graduations": 6,
             "labels": {"top": "18.7"}},
        ],
    }

    cases["H_number_line_answer_shown"] = {
        "title": "התוצאה החריגה",
        "alt": "קו מספרים ועליו שלוש המדידות, כשהחריגה מסומנת בנפרד.",
        "caption": "שתי מדידות נופלות באותו אזור, והשלישית רחוקה מהן.",
        "elements": [
            {"type": "number_line", "position": [0, 0], "range": [11.5, 19.5, 1],
             "marks": [12.0, 12.1], "color": "ink"},
            {"type": "point", "points": [[18.7, 0]], "color": "warning", "label": "18.7"},
            {"type": "text", "position": [18.7, 0.95], "label": "עדן", "color": "warning"},
            {"type": "brace", "points": [[12.0, -0.55], [18.7, -0.55]], "label": "6.6 גרם",
             "color": "muted"},
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
