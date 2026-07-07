"""Learning content generation API routes."""

import json

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from app.services.llm import call_llm_stream


router = APIRouter(prefix="/api", tags=["learning-content"])


CURRICULUM_TOPICS = {
    "electronics": {
        "label": "אלקטרוניקה ומעגלים חשמליים",
        "focus": "מעגל חשמלי: סוללה, חוטים, נגד, מתג ונורה. הילד מחבר רכיבים כדי לסגור מעגל ולהדליק נורה, ולומד מה קורה כשמוסיפים נגד או פותחים את המתג.",
    },
    "math": {
        "label": "מתמטיקה",
        "focus": "תרגול חשבון/גאומטריה בצורה משחקית עם משוב מיידי.",
    },
    "science": {
        "label": "מדעים",
        "focus": "ניסוי או חקר קצר ואינטראקטיבי בתופעת טבע.",
    },
}


@router.post("/create-lomda-stream")
async def create_lomda_stream(data: dict):
    """Stream a complete self-contained HTML learning mini-game."""
    message = (data.get("message") or "").strip()
    topic_id = (data.get("topic") or "electronics").strip()
    topic = CURRICULUM_TOPICS.get(topic_id, CURRICULUM_TOPICS["electronics"])

    system_prompt = f"""אתה "יובי", סוכן AI שבונה לומדות-משחק אינטראקטיביות לילדים (כיתות ז'-ט') בעברית.
התלמיד/ה מתאר/ת מה הוא/היא רוצה ללמוד, ואתה בונה לומדה-משחק קטנה שמלמדת דרך עשייה.

🎯 הנושא הנלמד (חובה להישאר בתוכו!): {topic['label']}.
מיקוד: {topic['focus']}
אם הבקשה לא קשורה לנושא הנלמד — בנה בכל זאת לומדה בנושא הנלמד שהכי קרובה לבקשה.

דרישות פלט קריטיות:
1. החזר מסמך HTML5 שלם ויחיד בלבד — מתחיל ב-<!DOCTYPE html> ומסתיים ב-</html>.
2. אל תכתוב שום טקסט הסבר, שום הערה ושום ```. רק קוד HTML טהור.
3. הכול עצמאי: CSS ו-JavaScript בתוך הקובץ (inline). בלי ספריות חיצוניות, בלי קישורים חיצוניים, בלי תמונות חיצוניות.
4. עברית, dir="rtl", פונט מערכת. צבעוני, ידידותי וברור לילדים.
5. אינטראקטיבי באמת: הילד לוחץ/גורר/מחבר רכיבים ומקבל משוב מיידי. למשל באלקטרוניקה — חיבור סוללה→נגד/מתג→נורה שסוגר מעגל ומדליק נורה, עם הודעת הצלחה.
6. כלול הסבר קצר אחד למה זה עבד (משפט-שניים) כשהילד מצליח — כדי שילמד.
7. שמור על קוד נקי וקריא (הוא יוצג לילד), אבל עובד. עד ~250 שורות.
8. בלי טקסט מחוץ ל-HTML."""

    user_prompt = message or f"בנה לי לומדה-משחק קצרה בנושא {topic['label']}."
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt},
    ]

    async def event_generator():
        has_content = False
        try:
            async for chunk in call_llm_stream(messages, max_tokens=6000, model_tier="strong"):
                has_content = True
                yield f"data: {json.dumps({'code': chunk}, ensure_ascii=False)}\n\n"
        except Exception as exc:
            print(f"⚠️ create-lomda stream error: {exc}")
        if not has_content:
            yield f"data: {json.dumps({'error': 'no_content'}, ensure_ascii=False)}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")