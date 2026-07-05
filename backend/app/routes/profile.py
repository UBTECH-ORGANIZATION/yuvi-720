"""Learner profile analysis and profile chat API routes."""

import json

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from app.core.localization import normalize_language, output_language_instruction
from app.services.llm import call_llm


router = APIRouter(prefix="/api", tags=["profile"])


@router.post("/analyze-profile")
async def analyze_profile(data: dict):
    """Generate a personalized learner profile from mapping scores."""
    student_name = data.get("student_name", "תלמיד/ה")
    scores = data.get("scores", {})
    language = normalize_language(data.get("language"))

    first_name = student_name.split()[0] if student_name else "חבר"

    scores_text = f"""
ציוני המיפוי (0-100):
- סקרנות ועניין: {scores.get('academic', {}).get('interest', 50)}
- רצון להצליח: {scores.get('academic', {}).get('investment', 50)}
- אומץ והתמדה: {scores.get('psycho_pedagogical', {}).get('motivation', 50)}
- עצמאות: {scores.get('psycho_pedagogical', {}).get('autonomy', 50)}
- חשיבה וארגון: {scores.get('psycho_pedagogical', {}).get('cognitive', 50)}
- הכרת עצמי: {scores.get('psycho_pedagogical', {}).get('self_awareness', 50)}
- הרגשה בכיתה: {scores.get('environmental', {}).get('school_climate', 50)}
- שליטה בטכנולוגיה: {scores.get('environmental', {}).get('tech_comfort', 50)}
- ריכוז: {scores.get('environmental', {}).get('focus', 50)}"""

    prompt = f"""אתה יובי, סוכן AI חינוכי שמנתח פרופיל למידה של תלמיד.
שם התלמיד: {student_name}

{scores_text}

צור ניתוח פרופיל למידה אישי בפורמט JSON הבא בדיוק:
{{
  "hero_message": "משפט אחד אישי ומעודד שמסכם את הדבר המרכזי שגילינו על {first_name} (פנה בשם). משהו כמו: גילינו שאתה לומד הכי טוב כש...",
  "strengths": [
    {{ "icon": "אימוג'י מתאים", "label": "שם התכונה", "desc": "משפט אישי קצר שמסביר למה זו חוזקה, פנה ב-אתה" }},
    {{ "icon": "...", "label": "...", "desc": "..." }},
    {{ "icon": "...", "label": "...", "desc": "..." }}
  ],
  "improve": [
    {{ "icon": "אימוג'י", "label": "שם התחום", "tip": "טיפ קצר ואישי שמנוסח כהזדמנות לצמיחה" }},
    {{ "icon": "...", "label": "...", "tip": "..." }}
  ],
  "tips": [
    "טיפ אישי ומותאם 1 שמחובר לחוזקה או חולשה ספציפית",
    "טיפ אישי 2",
    "טיפ אישי 3"
  ]
}}

הנחיות:
1. {output_language_instruction(language)}
2. strengths — 3 החוזקות הגבוהות ביותר. כל desc צריך להיות אישי, חם ומעודד.
3. improve — 2 התחומים שהכי כדאי לחזק. ה-tip צריך להיות מעשי, מעודד ומנוסח כהזדמנות.
4. tips — 3 טיפים מותאמים שמחברים בין החוזקות לחולשות. למשל: "בגלל שאתה עצמאי, נסה..." 
5. הטון חם, מעודד, אישי — פנה בשם {first_name}.
6. אל תהיה שלילי. אל תשתמש במילים כמו "חלש" או "נמוך".
7. 🚫 קריטי: אסור בהחלט להזכיר מספרים, ציונים, אחוזים או ערכים מספריים כלשהם בטקסט שהילד יקרא (לא "100", לא "65", לא "ציון גבוה", לא "אחוז"). הילד לעולם לא רואה מספרים — רק תיאור מילולי חם. הציונים משמשים אותך רק כדי לבחור על מה לכתוב, אבל אסור לכתוב אותם או להתייחס אליהם.
8. החזר JSON תקין בלבד, בלי טקסט נוסף."""

    result = await call_llm(
        [{"role": "user", "content": prompt}],
        max_tokens=4000,
        json_mode=True,
    )

    if result:
        try:
            parsed = json.loads(result)
            return JSONResponse(content=parsed)
        except json.JSONDecodeError:
            print("⚠️ analyze-profile: invalid JSON from LLM")

    return JSONResponse(content=generate_fallback_profile(scores, student_name, language))


FALLBACK_TRAIT_LABELS = {
    "interest": {"he": "סקרנות", "en": "Curiosity", "ar": "الفضول"},
    "investment": {"he": "רצון להצליח", "en": "Drive to succeed", "ar": "الرغبة في النجاح"},
    "motivation": {"he": "התמדה", "en": "Persistence", "ar": "المثابرة"},
    "autonomy": {"he": "עצמאות", "en": "Independence", "ar": "الاستقلالية"},
    "cognitive": {"he": "חשיבה וארגון", "en": "Thinking & organization", "ar": "التفكير والتنظيم"},
    "self_awareness": {"he": "הכרת עצמי", "en": "Self-awareness", "ar": "الوعي الذاتي"},
    "school_climate": {"he": "הרגשה בכיתה", "en": "Classroom feeling", "ar": "الشعور في الصف"},
    "tech_comfort": {"he": "טכנולוגיה", "en": "Technology", "ar": "التكنولوجيا"},
    "focus": {"he": "ריכוז", "en": "Focus", "ar": "التركيز"},
}

FALLBACK_PROFILE_TEXT = {
    "hero_message": {
        "he": "{first}, גילינו דברים מגניבים על איך שאתה לומד!",
        "en": "{first}, we discovered some cool things about how you learn!",
        "ar": "{first}، اكتشفنا أشياء رائعة عن طريقة تعلمك!",
    },
    "strength_desc": {
        "he": "ה{trait} היא אחת החוזקות הבולטות שלך — כל הכבוד!",
        "en": "{trait} is one of your standout strengths — great job!",
        "ar": "{trait} من أبرز نقاط قوتك — أحسنت!",
    },
    "improve_tip": {
        "he": "אפשר לחזק את ה{trait} שלך בהדרגה, צעד אחר צעד",
        "en": "You can grow your {trait} gradually, one step at a time",
        "ar": "يمكنك تعزيز {trait} تدريجيًا، خطوة بخطوة",
    },
    "tips": {
        "he": [
            "כשמשהו מרגיש קשה — תמיד אפשר לבקש עזרה 🙂",
            "נסה ללמוד במנות קצרות עם הפסקות",
            "חבר את הלמידה לדברים שמעניינים אותך",
        ],
        "en": [
            "When something feels hard, it's always okay to ask for help 🙂",
            "Try learning in short chunks with breaks in between",
            "Connect what you're learning to things you enjoy",
        ],
        "ar": [
            "عندما يبدو شيء ما صعبًا، من الجيد دائمًا طلب المساعدة 🙂",
            "جرب التعلم في فترات قصيرة مع فواصل بينها",
            "اربط ما تتعلمه بأشياء تحبها",
        ],
    },
}


def generate_fallback_profile(scores: dict, name: str, language: str = "he") -> dict:
    """Generate a basic, language-aware profile when LLM is unavailable."""
    first = name.split()[0] if name else "חבר"
    trait_map = [
        ("interest", "🔍", scores.get("academic", {}).get("interest", 50)),
        ("investment", "🎯", scores.get("academic", {}).get("investment", 50)),
        ("motivation", "🔥", scores.get("psycho_pedagogical", {}).get("motivation", 50)),
        ("autonomy", "🚀", scores.get("psycho_pedagogical", {}).get("autonomy", 50)),
        ("cognitive", "🧩", scores.get("psycho_pedagogical", {}).get("cognitive", 50)),
        ("self_awareness", "🪞", scores.get("psycho_pedagogical", {}).get("self_awareness", 50)),
        ("school_climate", "🏫", scores.get("environmental", {}).get("school_climate", 50)),
        ("tech_comfort", "💻", scores.get("environmental", {}).get("tech_comfort", 50)),
        ("focus", "🎧", scores.get("environmental", {}).get("focus", 50)),
    ]
    sorted_traits = sorted(trait_map, key=lambda x: x[2], reverse=True)
    top3 = sorted_traits[:3]
    bottom2 = sorted_traits[-2:]

    def label(key: str) -> str:
        return FALLBACK_TRAIT_LABELS[key][language]

    return {
        "hero_message": FALLBACK_PROFILE_TEXT["hero_message"][language].format(first=first),
        "strengths": [
            {"icon": trait[1], "label": label(trait[0]), "desc": FALLBACK_PROFILE_TEXT["strength_desc"][language].format(trait=label(trait[0]))}
            for trait in top3
        ],
        "improve": [
            {"icon": trait[1], "label": label(trait[0]), "tip": FALLBACK_PROFILE_TEXT["improve_tip"][language].format(trait=label(trait[0]))}
            for trait in bottom2
        ],
        "tips": FALLBACK_PROFILE_TEXT["tips"][language],
    }


@router.post("/results-chat")
async def results_chat(data: dict):
    """Chat with Yubi about the student's profile."""
    message = data.get("message", "")
    student_name = data.get("student_name", "")
    scores = data.get("scores", {})
    history = data.get("history", [])
    language = normalize_language(data.get("language"))

    scores_text = f"""
פרופיל {student_name}:
- סקרנות ועניין: {scores.get('academic', {}).get('interest', 50)}
- רצון להצליח: {scores.get('academic', {}).get('investment', 50)}
- אומץ ונחישות: {scores.get('psycho_pedagogical', {}).get('motivation', 50)}
- עצמאות: {scores.get('psycho_pedagogical', {}).get('autonomy', 50)}
- חשיבה וארגון: {scores.get('psycho_pedagogical', {}).get('cognitive', 50)}
- הכרת עצמי: {scores.get('psycho_pedagogical', {}).get('self_awareness', 50)}
- הרגשה בכיתה: {scores.get('environmental', {}).get('school_climate', 50)}
- שליטה בטכנולוגיה: {scores.get('environmental', {}).get('tech_comfort', 50)}
- ריכוז: {scores.get('environmental', {}).get('focus', 50)}"""

    system_prompt = f"""אתה יובי, סוכן AI חינוכי חביב שמלווה ילדים בגילאי 10-14.
סיימת תהליך היכרות/מיפוי עם הילד ועכשיו אתה משוחח איתו על התוצאות.

{scores_text}

הנחיות:
- {output_language_instruction(language)} דבר בפשטות, בחום ובעידוד.
- אם הילד אומר שמשהו לא מדויק (למשל "אני דווקא כן אוהב מתמטיקה") - החזר JSON של עדכון בשדה score_updates
- הראה שאתה באמת מכיר אותו לפי הנתונים
- תשובות קצרות: 1-3 משפטים
- אל תשתמש במונחים טכניים

אם צריך לעדכן ציון, החזר JSON בפורמט:
{{"reply": "תשובה", "score_updates": {{"academic.interest": 85}}}}

אחרת החזר:
{{"reply": "תשובה", "score_updates": null}}

חשוב: החזר תמיד JSON תקין בלבד."""

    messages = [{"role": "system", "content": system_prompt}]
    for item in history[-8:]:
        messages.append({"role": item.get("role", "user"), "content": item.get("content", "")})
    messages.append({"role": "user", "content": message})

    content = await call_llm(messages, max_tokens=800, json_mode=True)
    if content:
        try:
            parsed = json.loads(content)
            return JSONResponse(content={
                "reply": parsed.get("reply", content),
                "score_updates": parsed.get("score_updates"),
            })
        except Exception as exc:
            print(f"⚠️ Results chat JSON parse error: {exc}")
            return JSONResponse(content={"reply": content, "score_updates": None})

    reply = generate_chat_fallback(message, student_name, language)
    return JSONResponse(content={"reply": reply, "score_updates": None})


def generate_chat_fallback(message: str, name: str, language: str = "he") -> str:
    """Simple, language-aware fallback responses for the results chat."""
    msg = message.lower()
    if language == "en":
        if "question" in msg or "?" in msg:
            return f"Good question! Feel free to ask me anything. I'm here for you, {name}."
        if "wrong" in msg or "not right" in msg or "mistake" in msg:
            return "Thanks for correcting me! It's important your profile really reflects you. What should change?"
        return f"Interesting! Thanks for sharing, {name}. I'm noting that down to get to know you better. Anything else?"
    if language == "ar":
        if "سؤال" in msg or "?" in msg or "؟" in msg:
            return f"سؤال جيد! لا تتردد في سؤالي أي شيء. أنا هنا من أجلك، {name}."
        if "خطأ" in msg or "غير صحيح" in msg:
            return "شكرًا لتصحيحك لي! من المهم أن يعكس ملفك الشخصي حقيقتك. برأيك ما الذي يجب تغييره؟"
        return f"مثير للاهتمام! شكرًا لمشاركتك، {name}. سأدوّن ذلك لأتعرف عليك أكثر. هل هناك شيء آخر؟"
    if "מתמטיקה" in msg or "מתמט" in msg:
        return "כן, ראיתי את מה שענית על מתמטיקה! אם אתה מרגיש אחרת עכשיו זה לגמרי בסדר - תמיד אפשר לעדכן."
    if "מורה" in msg or "כיתה" in msg:
        return "הקשר עם המורה והכיתה זה דבר חשוב. אם יש משהו שתרצה שהסוכן שלך ידע על זה - ספר לי!"
    if "לא נכון" in msg or "טעות" in msg or "לא מדויק" in msg:
        return "תודה שאתה מתקן אותי! חשוב שהפרופיל ישקף אותך באמת. מה לדעתך צריך לשנות?"
    if "שאלה" in msg or "?" in msg:
        return f"שאלה טובה! תרגיש חופשי לשאול כל דבר. אני כאן בשבילך, {name}."
    return f"מעניין! תודה ששיתפת, {name}. אני רושם את זה כדי להכיר אותך טוב יותר. יש עוד משהו?"