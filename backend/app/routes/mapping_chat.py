"""Learner mapping AI chat and section summary routes."""

import json

from fastapi import APIRouter
from fastapi.responses import JSONResponse, StreamingResponse

from app.core.localization import localized_fallback, normalize_language, output_language_instruction
from app.services.llm import call_llm, call_llm_stream


router = APIRouter(prefix="/api", tags=["mapping-chat"])


@router.post("/section-summary")
async def get_section_summary(data: dict):
    """Generate an LLM summary of a completed questionnaire section."""
    part_title = data.get("part_title", "")
    qa_pairs = data.get("questions_and_answers", [])
    student_name = data.get("student_name", "")
    language = normalize_language(data.get("language"))

    print(f"📝 section-summary called: part_title='{part_title}', qa_pairs={len(qa_pairs)}, name='{student_name}'")
    for qa in qa_pairs[:3]:
        print(f"   Q: {qa.get('question','')[:40]} → A: {qa.get('answer','')[:30]}")

    qa_text = "\n".join([f"- {qa['question']}: {qa['answer']}" for qa in qa_pairs])
    prompt = section_summary_prompt(part_title, qa_text, student_name, language)

    summary_text = await call_llm([{"role": "user", "content": prompt}], max_tokens=600)
    if summary_text:
        print(f"✅ LLM returned summary: {summary_text[:60]}...")
        return JSONResponse(content={"summary": summary_text})

    print(f"⚠️ LLM returned None, using fallback for: '{part_title}'")
    fallback = generate_fallback_summary(part_title, qa_pairs, language)
    return JSONResponse(content={"summary": fallback})


@router.post("/section-summary-stream")
async def get_section_summary_stream(data: dict):
    """Stream an LLM summary of a completed questionnaire section via SSE."""
    part_title = data.get("part_title", "")
    qa_pairs = data.get("questions_and_answers", [])
    student_name = data.get("student_name", "")
    language = normalize_language(data.get("language"))

    qa_text = "\n".join([f"- {qa['question']}: {qa['answer']}" for qa in qa_pairs])
    prompt = section_summary_prompt(part_title, qa_text, student_name, language)

    async def event_generator():
        has_content = False
        async for chunk in call_llm_stream([{"role": "user", "content": prompt}]):
            has_content = True
            yield f"data: {json.dumps({'text': chunk}, ensure_ascii=False)}\n\n"
        if not has_content:
            fallback = generate_fallback_summary(part_title, qa_pairs, language)
            yield f"data: {json.dumps({'text': fallback}, ensure_ascii=False)}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@router.post("/mapping-chat-stream")
async def mapping_chat_stream(data: dict):
    """Stream the mapping chat response via SSE."""
    message = (data.get("message") or "").strip()
    student_name = data.get("student_name", "")
    context = data.get("context", "")
    history = data.get("history", [])
    language = normalize_language(data.get("language"))

    if not message:
        async def empty():
            yield f"data: {json.dumps({'text': localized_fallback('empty_chat', language)}, ensure_ascii=False)}\n\n"
            yield "data: [DONE]\n\n"
        return StreamingResponse(empty(), media_type="text/event-stream")

    messages = build_mapping_chat_messages(message, student_name, context, history, language)

    async def event_generator():
        has_content = False
        async for chunk in call_llm_stream(messages):
            has_content = True
            yield f"data: {json.dumps({'text': chunk}, ensure_ascii=False)}\n\n"
        if not has_content:
            fallback = localized_fallback("chat_saved", language)
            yield f"data: {json.dumps({'text': fallback}, ensure_ascii=False)}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@router.post("/mapping-chat")
async def mapping_chat(data: dict):
    """Free-form conversation with Yubi during the mapping process."""
    message = (data.get("message") or "").strip()
    student_name = data.get("student_name", "")
    context = data.get("context", "")
    history = data.get("history", [])
    language = normalize_language(data.get("language"))

    if not message:
        return JSONResponse(content={"reply": localized_fallback("empty_chat", language)})

    messages = build_mapping_chat_messages(message, student_name, context, history, language)
    reply = await call_llm(messages, max_tokens=800)
    if not reply:
        reply = localized_fallback("chat_saved", language)
    return JSONResponse(content={"reply": reply})


def section_summary_prompt(part_title: str, qa_text: str, student_name: str, language: str) -> str:
    """Build the localized section summary prompt."""
    return f"""אתה יובי, סוכן AI חינוכי חביב שמלווה ילדים בגילאי 10-14.
הילד ששמו {student_name or 'לא ידוע'} סיים לענות על חלק "{part_title}" בשאלון מיפוי.

הנה התשובות שלו:
{qa_text}

הנחיות:
1. {output_language_instruction(language)}
2. כתוב 2-3 משפטים קצרים בגוף שני, בטון חם ואינטימי.
3. פנה לילד בשמו הפרטי ({student_name.split()[0] if student_name else 'חבר'}) לפחות פעם אחת — זה חשוב ליצירת קשר.
4. התייחס לתשובות הספציפיות — אבל אל תצטט את הבחירות מילה במילה (אל תכתוב 'ככה-ככה', 'ממש מתאים לי', 'לא כל כך' וכו'). תרגם את המשמעות לשפה טבעית וזורמת. למשל, במקום "בחרת 'ככה-ככה' בהתמדה" כתוב "עדיין בונים את שריר ההתמדה".
5. אם ענה שלא אוהב מקצוע מסוים, אל תשפוט — התמקד בדברים שכן מעניינים.
6. אל תהיה שלילי או ביקורתי. מצא תמיד זווית חיובית או מעודדת.
7. סיים בשאלה ממוקדת שנותנת לילד מקום להוסיף משהו משלו דווקא על החלק הזה ("{part_title}") — אם יש משהו שחשוב לו שאדע, או משהו שלא בא לידי ביטוי בתשובות שבחר. אל תפתח שיחה כללית ואל תשאל מה יש לו היום בתוכנית או מה הכי מעניין אותו בשיעורים — רק תן לו הזדמנות להוסיף נקודה אחת משלו אם ירצה.
8. לא יותר מ-4 משפטים בסה"כ. אל תכתוב רשימות."""


def build_mapping_chat_messages(message: str, student_name: str, context: str, history: list, language: str) -> list[dict]:
    """Build LLM messages for learner mapping chat."""
    system_prompt = f"""אתה יובי, רובוט AI חינוכי חם וחכם שמלווה תלמיד/ה בשם {student_name} (כיתות ז'-ט', גילאי 12-15) בתהליך היכרות ומיפוי של דרך הלמידה שלו/שלה.
{('הקשר מהשאלון עד כה: ' + context) if context else ''}

הנחיות חשובות:
- {output_language_instruction(language)} Use simple, friendly, respectful language for a teenager; not too childish.
- פנה בשם הפרטי ({student_name.split()[0] if student_name else 'חבר/ה'}).
- תשובות קצרות וטבעיות: 1-3 משפטים בלבד.
- הקשב/י באמת: שקף/י שהבנת מה שנאמר, ושאל/י שאלת המשך עדינה כשזה מתאים.
- אל תיתן/י הרצאות או רשימות ארוכות. שמור/י על שיחה זורמת אחד-על-אחד.
- מותר אימוג'י אחד מדי פעם, במידה.
- אל תמציא/י עובדות על התלמיד/ה — התבסס/י רק על מה שנאמר."""

    messages = [{"role": "system", "content": system_prompt}]
    for item in history[-10:]:
        role = item.get("role", "user")
        if role not in ("user", "assistant"):
            role = "user"
        text = (item.get("content") or "").strip()
        if text:
            messages.append({"role": role, "content": text})
    messages.append({"role": "user", "content": message})
    return messages


def generate_fallback_summary(part_title: str, qa_pairs: list, language: str = "he") -> str:
    """Generate a simple summary when LLM is unavailable."""
    if language == "en":
        return "Thanks for your answers! I learned a little more about how you learn. Is there one more thing you would like me to know about this part?"
    if language == "ar":
        return "شكرًا على إجاباتك! تعرفت أكثر قليلًا على طريقة تعلمك. هل هناك شيء آخر تريد أن أعرفه عن هذا القسم؟"
    if "למידה" in part_title or "מעניין" in part_title:
        return "נראה שיש לך תחומים שמעניינים אותך יותר ואחרים פחות - וזה לגמרי טבעי! אני שמח להכיר את העדפות הלמידה שלך. יש משהו נוסף שתרצה לספר לי על איך אתה לומד?"
    if "מתמודד" in part_title or "אתגרים" in part_title:
        return "אני רואה שיש לך דרך מיוחדת להתמודד עם אתגרים - מגניב! הכרנו קצת את החוזקות שלך ואיפה אפשר לצמוח. יש משהו נוסף שחשוב לך שאדע?"
    return "תודה שסיפרת לי על הסביבה שלך! עכשיו אני מכיר טוב יותר את מה שעובד בשבילך. רוצה להוסיף משהו שלא שאלתי?"