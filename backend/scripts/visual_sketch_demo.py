"""The parts vocabulary drawing the objects freeform got wrong.

Sun, cloud, house, tree and mountain are the objects that came out worst when
the planner authored bezier paths blind. Each is rebuilt here out of parametric
parts, which is the same amount of planner effort — a handful of named shapes
with positions — but cannot come out malformed.

    python scripts/visual_sketch_demo.py
"""

from __future__ import annotations

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

from app.agents.manim_visual import _svg_fallback, sanitize_scene  # noqa: E402

OUT = Path(__file__).resolve().parents[1] / "artifacts" / "sketch"

OBJECTS: dict[str, list[dict]] = {
    "שמש": [
        {"shape": "disc", "at": [50, 50], "r": 20, "color": "accent", "fill_opacity": 0.30},
        {"shape": "rays", "at": [50, 50], "r": 20, "count": 12, "h": 13, "color": "accent"},
    ],
    "ענן": [
        {"shape": "puff", "at": [50, 50], "w": 78, "h": 34, "lobes": 5, "seed": 4,
         "color": "secondary", "fill_opacity": 0.18},
    ],
    "בית": [
        {"shape": "slab", "at": [50, 26], "w": 54, "h": 38, "fill_opacity": 0.08},
        {"shape": "roof", "at": [50, 45], "w": 54, "h": 22, "color": "warning",
         "fill_opacity": 0.22},
        {"shape": "stalk", "at": [68, 43], "w": 7, "h": 15, "taper": 0.9,
         "fill_opacity": 0.10},
        {"shape": "slab", "at": [50, 15], "w": 13, "h": 16, "color": "warning",
         "fill_opacity": 0.30},
        {"shape": "slab", "at": [33, 32], "w": 11, "h": 11, "color": "secondary",
         "fill_opacity": 0.30, "repeat": 1, "step": [34, 0]},
    ],
    "עץ": [
        {"shape": "stalk", "at": [50, 8], "w": 13, "h": 34, "taper": 0.55,
         "color": "warning", "fill_opacity": 0.22},
        {"shape": "blob", "at": [50, 60], "w": 56, "h": 46, "lobes": 6, "jagged": 0.22,
         "seed": 9, "color": "success", "fill_opacity": 0.22},
    ],
    "הר": [
        {"shape": "ridge", "at": [50, 20], "w": 92, "h": 46, "peaks": 3, "jagged": 0.5,
         "seed": 2, "fill_opacity": 0.12},
    ],
    "גשם": [
        {"shape": "puff", "at": [50, 66], "w": 70, "h": 26, "lobes": 5, "seed": 6,
         "color": "muted", "fill_opacity": 0.18},
        {"shape": "droplet", "at": [26, 26], "r": 6, "color": "secondary",
         "fill_opacity": 0.35, "repeat": 4, "step": [12, 0]},
    ],
    "ים": [
        {"shape": "wave", "at": [50, 56], "w": 92, "amp": 6, "cycles": 4,
         "color": "secondary"},
        {"shape": "wave", "at": [50, 42], "w": 92, "amp": 5, "cycles": 3,
         "color": "secondary"},
        {"shape": "wave", "at": [50, 28], "w": 92, "amp": 4, "cycles": 5,
         "color": "secondary"},
    ],
    "אדם": [
        {"shape": "person", "at": [50, 20], "h": 60, "fill_opacity": 0.10},
    ],
}


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    elements = []
    columns = 4
    for index, (name, parts) in enumerate(OBJECTS.items()):
        column, row = index % columns, index // columns
        elements.append({
            "type": "drawing", "object": name, "label": name,
            "center": [-4.5 + column * 3.0, 1.4 - row * 3.0],
            "size": 2.3, "parts": parts,
        })
    scene = sanitize_scene({
        "use_visual": True, "title": "אוצר צורות", "alt": "אוסף עצמים מורכבים מחלקים.",
        "caption": "כל עצם מורכב מכמה חלקים פרמטריים.", "elements": elements,
    })
    if scene is None:
        raise SystemExit("the sanitizer refused the sheet")
    (OUT / "sheet.svg").write_bytes(_svg_fallback(scene))
    print(f"✓ sheet: {len(scene['elements'])} objects → {OUT / 'sheet.svg'}")

    for name, parts in OBJECTS.items():
        one = sanitize_scene({
            "use_visual": True, "title": name, "alt": name, "caption": "",
            "elements": [{"type": "drawing", "object": name, "center": [0, 0],
                          "size": 4.0, "parts": parts}],
        })
        if one is None:
            print(f"✗ {name}: refused")
            continue
        (OUT / f"{name}.svg").write_bytes(_svg_fallback(one))
    print(f"{OUT}")


if __name__ == "__main__":
    main()
