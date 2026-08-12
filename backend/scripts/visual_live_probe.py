"""What the planner actually produces for topics with no prop of their own.

The beaker and the balance look good because a developer authored them once and
the planner only names them. That says nothing about the topics nobody has
authored anything for — the water cycle, a plant cell, a lever, a circuit — where
the planner has to reach for the freehand tier and invent the shape itself.

This runs the REAL planner (an LLM call per case) and renders whatever comes
back, so the gap between "a prop exists" and "no prop exists" is visible rather
than argued about. The mass-unit cases at the end are the control: those DO have
props, so they show the ceiling the other topics are being measured against.

    python scripts/visual_live_probe.py
    python scripts/visual_live_probe.py --only water-cycle,lever
"""

from __future__ import annotations

import argparse
import asyncio
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

from app.agents.manim_visual import _svg_fallback, plan_manim_visual  # noqa: E402
from app.services.ai_usage import UsageContext  # noqa: E402

OUT = Path(__file__).resolve().parents[1] / "artifacts" / "live-probe"

# (id, has a prop for this?, learner question, coach reply)
CASES: list[tuple[str, bool, str, str]] = [
    ("water-cycle", False,
     "איך עובד מחזור המים בטבע?",
     "השמש מחממת את המים בים, הם מתאדים ועולים כאדים, מתעבים לעננים ויורדים כגשם, "
     "והמים זורמים בנחלים בחזרה לים."),
    ("plant-cell", False,
     "מה ההבדל בין תא צמח לתא בעל חיים?",
     "לתא הצמח יש דופן תא קשיחה מסביב לקרום, כלורופלסטים שבהם מתרחשת הפוטוסינתזה, "
     "וחלולית מרכזית גדולה. לתא בעל חיים אין דופן ואין כלורופלסטים."),
    ("lever", False,
     "איך מנוף עוזר להרים משקל כבד?",
     "המנוף נשען על נקודת משען. ככל שנפעיל את הכוח רחוק יותר מנקודת המשען, "
     "כך נדרש פחות כוח כדי להרים את אותו משקל."),
    ("circuit", False,
     "מה ההבדל בין חיבור נורות בטור לחיבור במקביל?",
     "בחיבור בטור הזרם עובר בנתיב אחד דרך כל הנורות, ואם אחת נשרפת הכול נכבה. "
     "בחיבור במקביל לכל נורה יש נתיב משלה."),
    ("digestion", False,
     "מה עובר האוכל בגוף שלנו?",
     "האוכל עובר מהפה לוושט, משם לקיבה, למעי הדק שבו נספגים רוב חומרי המזון, "
     "ולבסוף למעי הגס."),
    # Control: the mass unit, where props exist.
    ("mass-tare", True,
     "הנחתי כוס ריקה על המאזניים ולחצתי איפוס. מה יראו המאזניים אחרי שאמזוג נוזל?",
     "לחיצה על האיפוס מגדירה את המצב הנוכחי כאפס, ולכן מה שהמאזניים יראו אחר כך "
     "הוא רק מה שהוספנו — מסת הנוזל בלבד."),
    ("mass-states", True,
     "מה ההבדל בין החלקיקים במוצק, בנוזל ובגז?",
     "במוצק החלקיקים מסודרים וצפופים וכמעט לא זזים, בנוזל הם צפופים אך חופשיים "
     "לנוע זה על פני זה, ובגז הם רחוקים מאוד זה מזה ונעים במהירות."),
]


async def probe(case_id: str, question: str, reply: str) -> tuple[str, dict | None]:
    scene = await plan_manim_visual(
        question, reply, "he",
        usage_context=UsageContext(
            actor_id="visual-probe", actor_type="system",
            endpoint="internal:visual-probe",
            feature="feature_3_learning_companion",
            operation="visual.probe", source="coach_agent",
        ),
        force_visual=True,
    )
    return case_id, scene


async def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--only", help="comma-separated case ids")
    args = parser.parse_args()
    wanted = set(args.only.split(",")) if args.only else None

    OUT.mkdir(parents=True, exist_ok=True)
    cases = [c for c in CASES if wanted is None or c[0] in wanted]
    results = await asyncio.gather(*(probe(cid, q, a) for cid, _, q, a in cases))

    has_prop = {cid: flag for cid, flag, _, _ in CASES}
    for case_id, scene in results:
        tier = "prop" if has_prop[case_id] else "no prop"
        if scene is None:
            print(f"✗ {case_id:14} [{tier:7}] planner refused")
            continue
        kinds = [element["type"] for element in scene["elements"]]
        props = [e.get("prop") for e in scene["elements"] if e["type"] == "prop"]
        drawings = sum(1 for k in kinds if k == "drawing")
        (OUT / f"{case_id}.svg").write_bytes(_svg_fallback(scene))
        print(
            f"✓ {case_id:14} [{tier:7}] {len(kinds):2} elements  "
            f"props={props or '—'}  drawings={drawings}  render={scene['render']}"
        )
        print(f"                 title: {scene.get('title')}")
    print(f"\n{OUT}")


if __name__ == "__main__":
    asyncio.run(main())
