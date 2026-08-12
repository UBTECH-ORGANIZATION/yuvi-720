"""Real lesson questions, hinted, through the real planner.

This is the situation the companion is actually in: a learner is stuck on a
question, the coach has answered with a hint that deliberately withholds the
answer, and the visual has to support that hint without giving the answer away.

The planner is called exactly as `_stream_visual_tail` calls it — NOT forced —
so a refusal is a real outcome and worth seeing. Six questions are covered, one
per shape the catalogue actually contains: a measurement series, a part-whole
difference, an instrument procedure, a coordinate reading, a classification and
a conservation argument.

    python scripts/visual_hint_probe.py
"""

from __future__ import annotations

import asyncio
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

from app.agents.manim_visual import _svg_fallback, plan_manim_visual, render_visual  # noqa: E402
from app.services.ai_usage import UsageContext  # noqa: E402

OUT = Path(__file__).resolve().parents[1] / "artifacts" / "hints"

# (id, subject, the question on screen, the hint the coach gave)
CASES: list[tuple[str, str, str, str]] = [
    ("outlier", "science",
     "עדן, פלג ושחר ביצעו סדרת מדידות של מסת מוצק. שחר: 12.1 גרם, פלג: 12.0 גרם, "
     "עדן: 18.7 גרם. האם ישנה תוצאה חריגה בעיניכם?",
     "בשאלה הזו משווים שלוש מדידות של אותו גוף. שווה לשים לב אילו מדידות נופלות "
     "כמעט באותו מקום, ואיזו מהן נמצאת באזור אחר לגמרי. המרחק בין המספרים הוא מה "
     "שמספר לנו אם משהו חריג."),
    ("part-whole", "science",
     "כוס ריקה שוקלת 40 גרם. אחרי מילוי הכוס בנוזל, המאזניים מראים 115 גרם. "
     "מהי המסה האמיתית של הנוזל לבדו?",
     "המאזניים שקלו את הכוס ואת הנוזל יחד, לא את הנוזל בלבד. תחשבו מה מרכיב את "
     "115 הגרם שעל הצג: איזה חלק מזה היה שם עוד לפני שמזגנו משהו?"),
    ("tare", "science",
     "דר' דסלין הניח כוס ריקה על המאזניים, לחץ על כפתור האיפוס כך שהצג הראה 0.00, "
     "ומזג את הנוזל. מה מציגים המאזניים כעת?",
     "לחיצה על כפתור האיפוס אומרת למאזניים להתייחס למה שעליהם עכשיו כאל אפס. "
     "שאלו את עצמכם מה בדיוק היה על הכף באותו רגע, ומה נוסף רק אחר כך."),
    ("conservation", "science",
     "כל המערכת (בקבוק + מיכל איסוף) הייתה על המאזניים. לפני פתיחת הבקבוק: "
     "682.4 גרם. אחרי מעבר הגז למיכל: 682.4 גרם. יפתח אמר 'כנראה שכמעט לא היה גז'. "
     "האם יפתח צודק?",
     "שימו לב מה בדיוק עמד על המאזניים כאן. אם הגז עבר ממקום אחד למקום אחר אבל "
     "שניהם נשקלו יחד, האם המסה הכוללת אמורה להשתנות בכלל?"),
    ("accuracy", "science",
     "לפניכם 4 מטרות קליעה. גררו לכל מטרה את התיאור המתאים ביותר: מדויק אך לא "
     "מהימן, מהימן אך לא מדויק, גם וגם, לא וגם לא.",
     "שתי תכונות שונות נבדקות כאן. אחת שואלת כמה החיצים קרובים זה לזה, והשנייה "
     "שואלת כמה הם קרובים למרכז. אפשר שיהיה אחד בלי השני."),
    ("coordinates", "math",
     "לפניכם מערכת צירים. כתבו את שיעורי הנקודות B ו־C.",
     "כל נקודה נכתבת כזוג מספרים בסדר קבוע: קודם כמה יחידות זזים על ציר ה־x, "
     "ורק אחר כך כמה יחידות עולים על ציר ה־y. ספרו משבצות מהראשית."),
]


async def probe(case_id: str, subject: str, question: str, hint: str):
    scene = await plan_manim_visual(
        f"{question}\nאפשר רמז?", hint, "he",
        usage_context=UsageContext(
            actor_id="hint-probe", actor_type="system",
            endpoint="internal:hint-probe",
            feature="feature_3_learning_companion",
            operation="visual.hint_probe", source="coach_agent",
        ),
        subject=subject,
    )
    return case_id, scene


async def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    results = await asyncio.gather(*(probe(*case) for case in CASES))
    for case_id, scene in results:
        if scene is None:
            print(f"— {case_id:13} planner declined to draw")
            continue
        (OUT / f"{case_id}.svg").write_bytes(_svg_fallback(scene))
        kinds = sorted({element["type"] for element in scene["elements"]})
        print(f"✓ {case_id:13} {len(scene['elements']):2} elements  {scene['render']:8} [{', '.join(kinds)}]")
        print(f"                title:   {scene.get('title')}")
        print(f"                caption: {scene.get('caption')}")
    print(f"\n{OUT}")


if __name__ == "__main__":
    asyncio.run(main())
