"""The merged object tier: props that look like the thing and still carry data.

`visual_objects_demo` showed the trade-off — the prop had a live fill level and
the silhouette of a box; the hand-drawn beaker looked right and could not move.
This renders the merged version: the vessel is built parametrically, so it has a
tapered wall, a rim and a spout AND a level that follows the number.

The last panel is the one that matters for the mass unit: a beaker standing on a
balance whose display carries the reading. Nothing floats, because the balance
seats its own load by measuring it.

    python scripts/visual_objects_live.py
"""

from __future__ import annotations

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

from app.agents.manim_visual import _svg_fallback, sanitize_scene  # noqa: E402

OUT = Path(__file__).resolve().parents[1] / "artifacts" / "objects-live"


def variants() -> dict[str, dict]:
    return {
        "L1_vessel_styles": {
            "title": "אותו כלי, שלושה מראות",
            "alt": "כוס מדידה, ספל וקופסה, כולם עם אותה כמות נוזל.",
            "caption": "אותו מפלס בדיוק בשלושת הכלים — הצורה השתנתה, הנתון לא.",
            "elements": [
                {"type": "prop", "prop": "container", "center": [-4.0, 0], "width": 1.8,
                 "height": 2.4, "fill_level": 0.55, "graduations": 5, "style": "beaker",
                 "labels": {"top": "כוס מדידה"}},
                {"type": "prop", "prop": "container", "center": [0.0, 0], "width": 1.8,
                 "height": 2.4, "fill_level": 0.55, "style": "cup",
                 "labels": {"top": "ספל"}},
                {"type": "prop", "prop": "container", "center": [4.0, 0], "width": 1.8,
                 "height": 2.4, "fill_level": 0.55, "style": "box",
                 "labels": {"top": "מיכל"}},
            ],
        },
        "L2_level_follows_data": {
            "title": "המפלס עוקב אחרי הנתון",
            "alt": "שלוש כוסות מדידה עם מפלסים שונים.",
            "caption": "אותה כוס בשלושה מצבים. את המפלס קובע הנתון, לא הציור.",
            "elements": [
                {"type": "prop", "prop": "container", "center": [-4.0, 0], "width": 1.9,
                 "height": 2.6, "fill_level": 0.0, "graduations": 5,
                 "labels": {"top": "ריקה"}},
                {"type": "prop", "prop": "container", "center": [0.0, 0], "width": 1.9,
                 "height": 2.6, "fill_level": 0.35, "graduations": 5,
                 "labels": {"top": "35%"}},
                {"type": "prop", "prop": "container", "center": [4.0, 0], "width": 1.9,
                 "height": 2.6, "fill_level": 0.85, "graduations": 5,
                 "labels": {"top": "85%"}},
            ],
        },
        "L3_beaker_on_balance": {
            "title": "הכוס על המאזניים",
            "alt": "שני מאזניים: על אחד כוס ריקה ועל השני אותה כוס עם נוזל.",
            "caption": "הכלי עומד על המשטח, והתוצאה מופיעה על הצג — כמו במעבדה.",
            "elements": [
                {"type": "prop", "prop": "balance", "center": [-3.3, -1.0], "size": 1.15,
                 "load": {"prop": "container", "width": 1.5, "height": 1.6,
                          "fill_level": 0.0, "graduations": 4},
                 "labels": {"display": "40", "bottom": "כוס ריקה"}},
                {"type": "prop", "prop": "balance", "center": [3.3, -1.0], "size": 1.15,
                 "load": {"prop": "container", "width": 1.5, "height": 1.6,
                          "fill_level": 0.75, "graduations": 4},
                 "labels": {"display": "115", "bottom": "כוס עם נוזל"}},
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
        print(f"✓ {name:24} render={scene['render']:8} elements={len(scene['elements'])}")
    print(f"\n{OUT}")


if __name__ == "__main__":
    main()
