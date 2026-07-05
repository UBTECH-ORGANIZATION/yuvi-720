"""
720 Demo Backend Server
Serves static files and provides API for the learner mapping questionnaire.
"""

from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pathlib import Path
import uvicorn
import os
import re
import json
import httpx
from typing import AsyncGenerator, Optional

from mock_data import (
    QUESTIONNAIRE,
    DIMENSIONS,
    MOCK_STUDENTS,
    calculate_scores,
    generate_insights,
    generate_recommendations,
)
from questionnaire_locales import get_questionnaire_for_language

# ============================================================
# LLM configuration. The app works without these credentials by falling
# back to canned/mock responses, but a local backend/.env enables the
# learner-mapping chat and AI-generated summaries/dashboard content.
# ============================================================
_APP_ROOT = Path(__file__).resolve().parent.parent
_ENV_PATHS = [
    Path(__file__).resolve().parent / ".env",
    _APP_ROOT / ".env",
    _APP_ROOT.parent / "src" / "backend" / ".env",
]


def _load_env_file(path: Path) -> bool:
    """Lightweight .env loader (no external deps). Does not override existing vars."""
    try:
        if not path.exists():
            return False
        for raw in path.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            key = key.strip()
            val = val.strip().strip('"').strip("'")
            if re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", key) and key not in os.environ:
                os.environ[key] = val
        print(f"✅ Loaded LLM env from {path}")
        return True
    except Exception as e:
        print(f"⚠️ Failed to load .env: {e}")
        return False


if not any(_load_env_file(_env_path) for _env_path in _ENV_PATHS):
    print("ℹ️ No LLM .env found; AI features will use fallback responses.")


async def call_llm(messages: list, max_tokens: int = 1200, json_mode: bool = False):
    """Call the shared Azure OpenAI model through the APIM gateway (gpt-5-mini).

    Returns the text content as a string, or None on failure so callers can
    gracefully fall back to canned responses.
    """
    apim_base = os.environ.get("APIM_BASE_URL", "").rstrip("/")
    apim_key = os.environ.get("APIM_SUBSCRIPTION_KEY", "")
    deployment = (
        os.environ.get("MODEL_DEPLOYMENT_NAME")
        or os.environ.get("COPILOT_MODEL")
        or "gpt-5-mini"
    )
    api_version = os.environ.get("APIM_API_VERSION", "2024-10-21")

    endpoint, key = apim_base, apim_key
    if not endpoint or not key:
        # Fallback: Azure AI Foundry direct endpoint
        foundry = os.environ.get("AZURE_AI_FOUNDRY_ENDPOINT", "")
        foundry_key = os.environ.get("AZURE_AI_FOUNDRY_API_KEY", "")
        if foundry and foundry_key:
            endpoint = re.sub(r"/api/projects/.*", "", foundry.rstrip("/")) + "/openai"
            key = foundry_key
    if not endpoint or not key:
        print("⚠️ No LLM endpoint configured (APIM/Foundry)")
        return None

    url = f"{endpoint}/deployments/{deployment}/chat/completions?api-version={api_version}"
    headers = {
        "Ocp-Apim-Subscription-Key": key,
        "api-key": key,
        "Content-Type": "application/json",
    }
    body = {"messages": messages, "max_completion_tokens": max(max_tokens, 4000)}
    if json_mode:
        body["response_format"] = {"type": "json_object"}

    try:
        async with httpx.AsyncClient(timeout=45) as client:
            resp = await client.post(url, json=body, headers=headers)
            if resp.status_code == 200:
                data = resp.json()
                content = (data.get("choices") or [{}])[0].get("message", {}).get("content")
                if content and content.strip():
                    return content.strip()
                print(f"⚠️ LLM returned empty content: {str(data)[:300]}")
                return None
            print(f"⚠️ LLM HTTP {resp.status_code}: {resp.text[:300]}")
            return None
    except Exception as e:
        print(f"⚠️ LLM request failed: {e}")
        return None


async def call_llm_stream(messages: list, max_tokens: int = 4000) -> AsyncGenerator[str, None]:
    """Stream tokens from the Azure OpenAI model. Yields text chunks."""
    apim_base = os.environ.get("APIM_BASE_URL", "").rstrip("/")
    apim_key = os.environ.get("APIM_SUBSCRIPTION_KEY", "")
    deployment = (
        os.environ.get("MODEL_DEPLOYMENT_NAME")
        or os.environ.get("COPILOT_MODEL")
        or "gpt-5-mini"
    )
    api_version = os.environ.get("APIM_API_VERSION", "2024-10-21")

    endpoint, key = apim_base, apim_key
    if not endpoint or not key:
        foundry = os.environ.get("AZURE_AI_FOUNDRY_ENDPOINT", "")
        foundry_key = os.environ.get("AZURE_AI_FOUNDRY_API_KEY", "")
        if foundry and foundry_key:
            endpoint = re.sub(r"/api/projects/.*", "", foundry.rstrip("/")) + "/openai"
            key = foundry_key
    if not endpoint or not key:
        return

    url = f"{endpoint}/deployments/{deployment}/chat/completions?api-version={api_version}"
    headers = {
        "Ocp-Apim-Subscription-Key": key,
        "api-key": key,
        "Content-Type": "application/json",
    }
    body = {
        "messages": messages,
        "max_completion_tokens": max(max_tokens, 4000),
        "stream": True,
    }

    try:
        async with httpx.AsyncClient(timeout=60) as client:
            async with client.stream("POST", url, json=body, headers=headers) as resp:
                if resp.status_code != 200:
                    print(f"⚠️ LLM stream HTTP {resp.status_code}")
                    return
                async for line in resp.aiter_lines():
                    if not line.startswith("data: "):
                        continue
                    data_str = line[6:]
                    if data_str == "[DONE]":
                        break
                    try:
                        chunk = json.loads(data_str)
                        delta = (chunk.get("choices") or [{}])[0].get("delta", {})
                        content = delta.get("content")
                        if content:
                            yield content
                    except (json.JSONDecodeError, IndexError, KeyError):
                        continue
    except Exception as e:
        print(f"⚠️ LLM stream error: {e}")


app = FastAPI(title="720 Demo - YuviLab", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

SUPPORTED_LANGUAGES = {"he", "en", "ar"}
LANGUAGE_NAMES = {
    "he": "Hebrew",
    "en": "English",
    "ar": "Arabic",
}


def normalize_language(language: Optional[str]) -> str:
    """Return a supported 2-letter language code."""
    normalized = (language or "he").lower()[:2]
    return normalized if normalized in SUPPORTED_LANGUAGES else "he"


def output_language_instruction(language: str) -> str:
    """Instruction for learner-facing AI output language."""
    return f"Write only in {LANGUAGE_NAMES.get(language, 'Hebrew')}."


LOCALIZED_FALLBACKS = {
    "empty_chat": {
        "he": "לא הבנתי, אפשר לכתוב שוב? 😊",
        "en": "I did not understand. Can you write that again? 😊",
        "ar": "لم أفهم، هل يمكنك أن تكتب ذلك مرة أخرى؟ 😊",
    },
    "chat_saved": {
        "he": "תודה ששיתפת! רשמתי את זה. יש עוד משהו שתרצה לספר לי?",
        "en": "Thanks for sharing! I wrote that down. Is there anything else you want to tell me?",
        "ar": "شكرًا لمشاركتك! سجلت ذلك. هل هناك شيء آخر تريد إخباري به؟",
    },
}


def localized_fallback(key: str, language: str) -> str:
    return LOCALIZED_FALLBACKS.get(key, {}).get(language) or LOCALIZED_FALLBACKS[key]["he"]

# Paths
BASE_DIR = Path(__file__).parent.parent
LEARNING_AGENT_DIR = BASE_DIR / "learning-agent"
SHARED_DIR = BASE_DIR / "shared"
LOCALES_DIR = BASE_DIR / "locales"
REACT_APP_DIR = BASE_DIR / "static" / "react"
REACT_ASSETS_DIR = REACT_APP_DIR / "assets"


# --- API Routes ---

@app.get("/api/questionnaire")
async def get_questionnaire(request: Request):
    """Return the full questionnaire structure."""
    language = request.query_params.get("lang") or request.query_params.get("language") or "he"
    return JSONResponse(content=get_questionnaire_for_language(language))


@app.get("/api/dimensions")
async def get_dimensions():
    """Return dimension descriptions."""
    return JSONResponse(content=DIMENSIONS)


@app.post("/api/submit")
async def submit_questionnaire(data: dict):
    """
    Submit questionnaire answers and return computed profile.
    Expects: { "student_name": str, "answers": { question_id: option_index } }
    """
    answers = data.get("answers", {})
    student_name = data.get("student_name", "תלמיד/ה")

    # Convert string keys to int for scoring
    int_answers = {}
    for k, v in answers.items():
        try:
            int_answers[int(k)] = v
        except (ValueError, TypeError):
            int_answers[k] = v

    scores = calculate_scores(int_answers)
    insights = generate_insights(scores)
    recommendations = generate_recommendations(scores)

    result = {
        "student_name": student_name,
        "scores": scores,
        "dimensions": DIMENSIONS,
        "insights": insights,
        "recommendations": recommendations,
    }

    return JSONResponse(content=result)


@app.post("/api/analyze-profile")
async def analyze_profile(data: dict):
    """
    Use AI to generate a full personalized learning profile analysis.
    Expects: { student_name, scores }
    Returns SSE stream with JSON profile: { hero_message, strengths[], improve[], tips[] }
    """
    student_name = data.get("student_name", "תלמיד/ה")
    scores = data.get("scores", {})

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
1. עברית בלבד.
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
            print(f"⚠️ analyze-profile: invalid JSON from LLM")

    # Fallback — return basic structure from scores
    return JSONResponse(content=generate_fallback_profile(scores, student_name))


def generate_fallback_profile(scores: dict, name: str) -> dict:
    """Generate a basic profile when LLM is unavailable."""
    first = name.split()[0] if name else "חבר"
    trait_map = [
        ("interest", "סקרנות", "🔍", scores.get("academic", {}).get("interest", 50)),
        ("investment", "רצון להצליח", "🎯", scores.get("academic", {}).get("investment", 50)),
        ("motivation", "התמדה", "🔥", scores.get("psycho_pedagogical", {}).get("motivation", 50)),
        ("autonomy", "עצמאות", "🚀", scores.get("psycho_pedagogical", {}).get("autonomy", 50)),
        ("cognitive", "חשיבה וארגון", "🧩", scores.get("psycho_pedagogical", {}).get("cognitive", 50)),
        ("self_awareness", "הכרת עצמי", "🪞", scores.get("psycho_pedagogical", {}).get("self_awareness", 50)),
        ("school_climate", "הרגשה בכיתה", "🏫", scores.get("environmental", {}).get("school_climate", 50)),
        ("tech_comfort", "טכנולוגיה", "💻", scores.get("environmental", {}).get("tech_comfort", 50)),
        ("focus", "ריכוז", "🎧", scores.get("environmental", {}).get("focus", 50)),
    ]
    sorted_traits = sorted(trait_map, key=lambda x: x[3], reverse=True)
    top3 = sorted_traits[:3]
    bottom2 = sorted_traits[-2:]

    return {
        "hero_message": f"{first}, גילינו דברים מגניבים על איך שאתה לומד!",
        "strengths": [
            {"icon": t[2], "label": t[1], "desc": f"ה{t[1]} היא אחת החוזקות הבולטות שלך — כל הכבוד!"} for t in top3
        ],
        "improve": [
            {"icon": t[2], "label": t[1], "tip": f"אפשר לחזק את ה{t[1]} שלך בהדרגה, צעד אחר צעד"} for t in bottom2
        ],
        "tips": [
            "כשמשהו מרגיש קשה — תמיד אפשר לבקש עזרה 🙂",
            "נסה ללמוד במנות קצרות עם הפסקות",
            "חבר את הלמידה לדברים שמעניינים אותך",
        ],
    }


@app.post("/api/generate-dashboard")
async def generate_dashboard(data: dict):
    """
    Generate personalized student dashboard data based on mapping scores.
    Uses AI to create subjects, difficulties, goals, competencies from the learner profile.
    """
    student_name = data.get("student_name", "תלמיד/ה")
    scores = data.get("scores", {})

    first_name = student_name.split()[0] if student_name else "חבר"

    scores_text = f"""ציוני המיפוי (0-100):
- סקרנות ועניין: {scores.get('academic', {}).get('interest', 50)}
- רצון להצליח/השקעה: {scores.get('academic', {}).get('investment', 50)}
- אומץ והתמדה: {scores.get('psycho_pedagogical', {}).get('motivation', 50)}
- עצמאות: {scores.get('psycho_pedagogical', {}).get('autonomy', 50)}
- חשיבה וארגון: {scores.get('psycho_pedagogical', {}).get('cognitive', 50)}
- הכרת עצמי: {scores.get('psycho_pedagogical', {}).get('self_awareness', 50)}
- הרגשה בכיתה: {scores.get('environmental', {}).get('school_climate', 50)}
- שליטה בטכנולוגיה: {scores.get('environmental', {}).get('tech_comfort', 50)}
- ריכוז: {scores.get('environmental', {}).get('focus', 50)}"""

    prompt = f"""אתה יובי, סוכן AI חינוכי. בהתבסס על מיפוי למידה של תלמיד, צור נתוני דשבורד אישי.

שם התלמיד: {student_name}
{scores_text}

צור JSON עם המבנה הבא:
{{
  "subjects": [
    {{
      "name": "שם מקצוע",
      "icon": "אימוג'י",
      "progress": מספר 0-100,
      "level": "מצוין/מתקדם יפה/בהתפתחות",
      "description": "משפט קצר על מצב הלמידה",
      "curriculum": [
        {{ "topic": "שם נושא בתוכנית הלימודים", "status": "הושלם/לומדים עכשיו/בהמשך" }}
      ]
    }}
  ],
  "difficulties": [
    {{
      "subject": "שם מקצוע",
      "text": "תיאור הקושי הספציפי",
      "status": "עובד על זה/חדש/משתפר"
    }}
  ],
  "goals": [
    {{
      "text": "יעד מותאם אישית",
      "meta": "הקשר - מתי נקבע",
      "source": "שיחת מנטורינג/מהמיפוי",
      "done": false
    }}
  ],
  "mapping": {{
    "interests": ["תחום עניין 1", "תחום 2", "תחום 3"],
    "learningStyle": "סגנון הלמידה המועדף",
    "preferences": ["העדפה 1", "העדפה 2"],
    "environment": "סביבת למידה מיטבית",
    "strengths": ["חוזקה 1", "חוזקה 2", "חוזקה 3"]
  }},
  "competencies": [
    {{
      "icon": "אימוג'י",
      "label": "שם כשירות",
      "value": מספר 0-100,
      "descriptor": "משפט תיאור קצר"
    }}
  ]
}}

הנחיות:
1. עברית בלבד.
2. subjects — 4 מקצועות. הציונים מבוססים על המיפוי: ריכוז+חשיבה → מתמטיקה, סקרנות → מדעים, הכרת עצמי+מוטיבציה → עברית, טכנולוגיה → מחשבים. לכל מקצוע 4-5 נושאים ב-curriculum המייצגים את תוכנית הלימודים — חלקם "הושלם", אחד "לומדים עכשיו", והשאר "בהמשך" (כמות ההושלמו תואמת ל-progress).
3. difficulties — 2-3 קשיים ספציפיים ומציאותיים שמתאימים לציונים הנמוכים.
4. goals — 3-4 יעדים מותאמים לציונים הנמוכים והגבוהים. לפחות 2 מהם source="שיחת מנטורינג" והשאר source="מהמיפוי".
5. mapping — סגנון למידה, העדפות, חוזקות — הכל מבוסס על הציונים.
6. competencies — 6 כשירויות (יוזמה, שיתוף פעולה, חשיבה ביקורתית, גמישות, תקשורת, הכוונה עצמית). הציון מבוסס על הממדים הרלוונטיים.
7. הכל חיובי ומעודד, מותאם לילד בגיל 10-14.
8. החזר JSON תקין בלבד."""

    result = await call_llm(
        [{"role": "user", "content": prompt}],
        max_tokens=4000,
        json_mode=True,
    )

    if result:
        try:
            parsed = json.loads(result)
            # Add computed fields for frontend styling
            for s in parsed.get("subjects", []):
                s.setdefault("iconBg", "rgba(124,92,255,0.1)")
                progress = s.get("progress", 50)
                s.setdefault("levelClass", "level-great" if progress >= 80 else "level-good" if progress >= 60 else "level-building")
                s.setdefault("gradient", "linear-gradient(135deg, #7c5cff, #9f7afe)")
                for c in s.get("curriculum", []):
                    cstatus = c.get("status", "")
                    c.setdefault("statusClass", "curr-done" if "הושלם" in cstatus else "curr-current" if "עכשיו" in cstatus else "curr-upcoming")
            for d in parsed.get("difficulties", []):
                status = d.get("status", "")
                d.setdefault("statusClass", "status-working" if "עובד" in status else "status-new" if "חדש" in status else "status-improving")
            return JSONResponse(content={"name": student_name, "avatar": student_name[0] if student_name else "ת", **parsed})
        except json.JSONDecodeError:
            print(f"⚠️ generate-dashboard: invalid JSON from LLM")

    # Fallback
    return JSONResponse(content=generate_fallback_dashboard(scores, student_name))


def generate_fallback_dashboard(scores: dict, name: str) -> dict:
    """Basic dashboard data when LLM is unavailable."""
    focus = scores.get("environmental", {}).get("focus", 50)
    cognitive = scores.get("psycho_pedagogical", {}).get("cognitive", 50)
    interest = scores.get("academic", {}).get("interest", 50)
    tech = scores.get("environmental", {}).get("tech_comfort", 50)
    motivation = scores.get("psycho_pedagogical", {}).get("motivation", 50)
    autonomy = scores.get("psycho_pedagogical", {}).get("autonomy", 50)

    return {
        "name": name,
        "avatar": name[0] if name else "ת",
        "subjects": [
            {"name": "מתמטיקה", "icon": "🔢", "iconBg": "rgba(124,92,255,0.1)", "progress": int((focus + cognitive) / 2), "level": "מתקדם", "levelClass": "level-good", "gradient": "linear-gradient(135deg, #7c5cff, #9f7afe)", "description": "בהתבסס על ריכוז וחשיבה", "curriculum": [{"topic": "חיבור וחיסור", "status": "הושלם", "statusClass": "curr-done"}, {"topic": "לוח הכפל", "status": "הושלם", "statusClass": "curr-done"}, {"topic": "שברים פשוטים", "status": "לומדים עכשיו", "statusClass": "curr-current"}, {"topic": "גאומטריה בסיסית", "status": "בהמשך", "statusClass": "curr-upcoming"}]},
            {"name": "מדעים", "icon": "🔬", "iconBg": "rgba(99,179,237,0.1)", "progress": int((interest + cognitive) / 2), "level": "בהתפתחות", "levelClass": "level-building", "gradient": "linear-gradient(135deg, #63b3ed, #4299e1)", "description": "בהתבסס על סקרנות וחשיבה", "curriculum": [{"topic": "עולם הצומח", "status": "הושלם", "statusClass": "curr-done"}, {"topic": "מצבי החומר", "status": "לומדים עכשיו", "statusClass": "curr-current"}, {"topic": "מערכת השמש", "status": "בהמשך", "statusClass": "curr-upcoming"}, {"topic": "גוף האדם", "status": "בהמשך", "statusClass": "curr-upcoming"}]},
            {"name": "עברית", "icon": "📖", "iconBg": "rgba(72,187,120,0.1)", "progress": int((motivation + focus) / 2), "level": "מתקדם", "levelClass": "level-good", "gradient": "linear-gradient(135deg, #48bb78, #38a169)", "description": "בהתבסס על התמדה וריכוז", "curriculum": [{"topic": "קריאה שוטפת", "status": "הושלם", "statusClass": "curr-done"}, {"topic": "הבנת הנקרא", "status": "לומדים עכשיו", "statusClass": "curr-current"}, {"topic": "כתיבה יצירתית", "status": "בהמשך", "statusClass": "curr-upcoming"}]},
            {"name": "מחשבים", "icon": "💻", "iconBg": "rgba(246,173,85,0.1)", "progress": tech, "level": "מצוין" if tech >= 70 else "מתקדם", "levelClass": "level-great" if tech >= 70 else "level-good", "gradient": "linear-gradient(135deg, #f6ad55, #ed8936)", "description": "בהתבסס על שליטה בטכנולוגיה", "curriculum": [{"topic": "שימוש בטוח במחשב", "status": "הושלם", "statusClass": "curr-done"}, {"topic": "חשיבה מחשבתית", "status": "לומדים עכשיו", "statusClass": "curr-current"}, {"topic": "בניית משחק ראשון", "status": "בהמשך", "statusClass": "curr-upcoming"}]},
        ],
        "difficulties": [
            {"subject": "למידה", "text": "ריכוז לאורך זמן", "status": "עובד על זה", "statusClass": "status-working"},
            {"subject": "למידה", "text": "ארגון מידע ותכנון", "status": "חדש", "statusClass": "status-new"},
        ],
        "goals": [
            {"text": "לשפר ריכוז ב-10 דקות כל יום", "meta": "נקבע השבוע", "source": "שיחת מנטורינג", "done": False},
            {"text": "לנסות ללמוד בדרך חדשה השבוע", "meta": "נקבע השבוע", "source": "שיחת מנטורינג", "done": False},
            {"text": "לחזק נקודת חולשה אחת בהדרגה", "meta": "מהמיפוי - היום", "source": "מהמיפוי", "done": False},
        ],
        "mapping": {
            "interests": ["טכנולוגיה", "גילוי דברים חדשים", "אתגרים"],
            "learningStyle": "בהתאם למיפוי",
            "preferences": ["למידה עצמאית", "משוב מיידי"],
            "environment": "סביבה שקטה",
            "strengths": ["סקרנות", "שליטה בטכנולוגיה", "רצון להצליח"],
        },
        "competencies": [
            {"icon": "🎯", "label": "יוזמה ואחריות", "value": int(autonomy * 0.9), "descriptor": "לוקח אחריות"},
            {"icon": "🤝", "label": "שיתוף פעולה", "value": 60, "descriptor": "עובד עם אחרים"},
            {"icon": "💡", "label": "חשיבה ביקורתית", "value": cognitive, "descriptor": "חושב לעומק"},
            {"icon": "🔄", "label": "גמישות", "value": 65, "descriptor": "מתמודד עם שינויים"},
            {"icon": "🗣️", "label": "תקשורת", "value": 60, "descriptor": "מביע דעה"},
            {"icon": "🧭", "label": "הכוונה עצמית", "value": int((autonomy + motivation) / 2), "descriptor": "מנהל את עצמו"},
        ],
    }


@app.get("/api/results/{student_id}")
async def get_student_results(student_id: str):
    """Get mock results for a specific student."""
    for student in MOCK_STUDENTS:
        if student["id"] == student_id:
            return JSONResponse(content={
                "student": student,
                "dimensions": DIMENSIONS,
            })
    return JSONResponse(content={"error": "Student not found"}, status_code=404)


@app.get("/api/students")
async def get_all_students():
    """Get all mock students (for teacher dashboard later)."""
    summary = []
    for s in MOCK_STUDENTS:
        summary.append({
            "id": s["id"],
            "name": s["name"],
            "age": s["age"],
            "grade": s["grade"],
            "class": s["class"],
            "avatar": s["avatar"],
            "completed_at": s["completed_at"],
            "scores": s["scores"],
            "insights": s["insights"],
        })
    return JSONResponse(content=summary)


@app.post("/api/section-summary")
async def get_section_summary(data: dict):
    """
    Generate an LLM summary of a completed section.
    Expects: { "part_title": str, "questions_and_answers": [{question, answer}] }
    Returns: { "summary": str }
    """
    part_title = data.get("part_title", "")
    qa_pairs = data.get("questions_and_answers", [])
    student_name = data.get("student_name", "")
    language = normalize_language(data.get("language"))

    print(f"📝 section-summary called: part_title='{part_title}', qa_pairs={len(qa_pairs)}, name='{student_name}'")
    for qa in qa_pairs[:3]:
        print(f"   Q: {qa.get('question','')[:40]} → A: {qa.get('answer','')[:30]}")

    # Build a text representation of answers
    qa_text = "\n".join([f"- {qa['question']}: {qa['answer']}" for qa in qa_pairs])

    prompt = f"""אתה יובי, סוכן AI חינוכי חביב שמלווה ילדים בגילאי 10-14.
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
8. לא יותר מ-4 משפטים בסה\"כ. אל תכתוב רשימות."""

    # Call the shared LLM (gpt-5-mini via APIM)
    summary_text = await call_llm([{"role": "user", "content": prompt}], max_tokens=600)
    if summary_text:
        print(f"✅ LLM returned summary: {summary_text[:60]}...")
        return JSONResponse(content={"summary": summary_text})

    # Fallback: generate a simple summary without LLM
    print(f"⚠️ LLM returned None, using fallback for: '{part_title}'")
    fallback = generate_fallback_summary(part_title, qa_pairs, language)
    return JSONResponse(content={"summary": fallback})


@app.post("/api/section-summary-stream")
async def get_section_summary_stream(data: dict):
    """
    Stream an LLM summary of a completed section via SSE.
    Same input as /api/section-summary but returns text/event-stream.
    """
    part_title = data.get("part_title", "")
    qa_pairs = data.get("questions_and_answers", [])
    student_name = data.get("student_name", "")
    language = normalize_language(data.get("language"))

    qa_text = "\n".join([f"- {qa['question']}: {qa['answer']}" for qa in qa_pairs])

    prompt = f"""אתה יובי, סוכן AI חינוכי חביב שמלווה ילדים בגילאי 10-14.
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
8. לא יותר מ-4 משפטים בסה\"כ. אל תכתוב רשימות."""

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


@app.post("/api/mapping-chat-stream")
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
    for h in history[-10:]:
        role = h.get("role", "user")
        if role not in ("user", "assistant"):
            role = "user"
        text = (h.get("content") or "").strip()
        if text:
            messages.append({"role": role, "content": text})
    messages.append({"role": "user", "content": message})

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


def generate_fallback_summary(part_title: str, qa_pairs: list, language: str = "he") -> str:
    """Generate a simple summary when LLM is unavailable."""
    if language == "en":
        return "Thanks for your answers! I learned a little more about how you learn. Is there one more thing you would like me to know about this part?"
    if language == "ar":
        return "شكرًا على إجاباتك! تعرفت أكثر قليلًا على طريقة تعلمك. هل هناك شيء آخر تريد أن أعرفه عن هذا القسم؟"
    if "למידה" in part_title or "מעניין" in part_title:
        return "נראה שיש לך תחומים שמעניינים אותך יותר ואחרים פחות - וזה לגמרי טבעי! אני שמח להכיר את העדפות הלמידה שלך. יש משהו נוסף שתרצה לספר לי על איך אתה לומד?"
    elif "מתמודד" in part_title or "אתגרים" in part_title:
        return "אני רואה שיש לך דרך מיוחדת להתמודד עם אתגרים - מגניב! הכרנו קצת את החוזקות שלך ואיפה אפשר לצמוח. יש משהו נוסף שחשוב לך שאדע?"
    else:
        return "תודה שסיפרת לי על הסביבה שלך! עכשיו אני מכיר טוב יותר את מה שעובד בשבילך. רוצה להוסיף משהו שלא שאלתי?"


@app.post("/api/results-chat")
async def results_chat(data: dict):
    """
    Chat with Yubi about the student's profile.
    Can update scores if the student corrects something.
    Expects: { "message": str, "student_name": str, "scores": dict, "history": list }
    Returns: { "reply": str, "score_updates": dict|null }
    """
    message = data.get("message", "")
    student_name = data.get("student_name", "")
    scores = data.get("scores", {})
    history = data.get("history", [])

    # Build scores summary for context
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
- דבר בעברית פשוטה, חמה ומעודדת
- אם הילד אומר שמשהו לא מדויק (למשל "אני דווקא כן אוהב מתמטיקה") - החזר JSON של עדכון בשדה score_updates
- הראה שאתה באמת מכיר אותו לפי הנתונים
- תשובות קצרות: 1-3 משפטים
- אל תשתמש במונחים טכניים

אם צריך לעדכן ציון, החזר JSON בפורמט:
{{"reply": "תשובה", "score_updates": {{"academic.interest": 85}}}}

אחרת החזר:
{{"reply": "תשובה", "score_updates": null}}

חשוב: החזר תמיד JSON תקין בלבד."""

    # Build messages
    messages = [{"role": "system", "content": system_prompt}]
    for h in history[-8:]:
        messages.append({"role": h.get("role", "user"), "content": h.get("content", "")})
    messages.append({"role": "user", "content": message})

    content = await call_llm(messages, max_tokens=800, json_mode=True)
    if content:
        try:
            parsed = json.loads(content)
            return JSONResponse(content={
                "reply": parsed.get("reply", content),
                "score_updates": parsed.get("score_updates"),
            })
        except Exception as e:
            print(f"⚠️ Results chat JSON parse error: {e}")
            return JSONResponse(content={"reply": content, "score_updates": None})

    # Fallback without LLM
    reply = generate_chat_fallback(message, student_name, scores)
    return JSONResponse(content={"reply": reply, "score_updates": None})


def generate_chat_fallback(message: str, name: str, scores: dict) -> str:
    """Simple fallback responses for the results chat."""
    msg = message.lower()
    if "מתמטיקה" in msg or "מתמט" in msg:
        return f"כן, ראיתי את מה שענית על מתמטיקה! אם אתה מרגיש אחרת עכשיו זה לגמרי בסדר - תמיד אפשר לעדכן."
    elif "מורה" in msg or "כיתה" in msg:
        return "הקשר עם המורה והכיתה זה דבר חשוב. אם יש משהו שתרצה שהסוכן שלך ידע על זה - ספר לי!"
    elif "לא נכון" in msg or "טעות" in msg or "לא מדויק" in msg:
        return "תודה שאתה מתקן אותי! חשוב שהפרופיל ישקף אותך באמת. מה לדעתך צריך לשנות?"
    elif "שאלה" in msg or "?" in msg:
        return f"שאלה טובה! תרגיש חופשי לשאול כל דבר. אני כאן בשבילך, {name}."
    else:
        return f"מעניין! תודה ששיתפת, {name}. אני רושם את זה כדי להכיר אותך טוב יותר. יש עוד משהו?"


@app.post("/api/mapping-chat")
async def mapping_chat(data: dict):
    """Free-form conversation with Yubi during the mapping process.
    Lets the student actually talk to the AI in their own words.
    Expects: { message, student_name, context, history: [{role, content}] }
    Returns: { reply }
    """
    message = (data.get("message") or "").strip()
    student_name = data.get("student_name", "")
    context = data.get("context", "")
    history = data.get("history", [])
    language = normalize_language(data.get("language"))

    if not message:
        return JSONResponse(content={"reply": localized_fallback("empty_chat", language)})

    system_prompt = f"""אתה יובי, רובוט AI חינוכי חם וחכם שמלווה תלמיד/ה בשם {student_name} (כיתות ז'-ט', גילאי 12-15) בתהליך היכרות ומיפוי של דרך הלמידה שלו/שלה.
{('הקשר מהשאלון עד כה: ' + context) if context else ''}

הנחיות חשובות:
- {output_language_instruction(language)} Use simple, friendly, respectful language for a teenager; not too childish.
- תשובות קצרות וטבעיות: 1-3 משפטים בלבד.
- הקשב/י באמת: שקף/י שהבנת מה שנאמר, ושאל/י שאלת המשך עדינה כשזה מתאים.
- אל תיתן/י הרצאות או רשימות ארוכות. שמור/י על שיחה זורמת אחד-על-אחד.
- מותר אימוג'י אחד מדי פעם, במידה.
- אל תמציא/י עובדות על התלמיד/ה — התבסס/י רק על מה שנאמר."""

    messages = [{"role": "system", "content": system_prompt}]
    for h in history[-10:]:
        role = h.get("role", "user")
        if role not in ("user", "assistant"):
            role = "user"
        text = (h.get("content") or "").strip()
        if text:
            messages.append({"role": role, "content": text})
    messages.append({"role": "user", "content": message})

    reply = await call_llm(messages, max_tokens=800)
    if not reply:
        reply = localized_fallback("chat_saved", language)
    return JSONResponse(content={"reply": reply})


# ============================================================
#  CREATE-A-LOMDA  (kid builds a learning mini-game by describing it)
#  Streams the generated, self-contained HTML so the UI can show the
#  "code being written" and then render it in an iframe.
# ============================================================
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


@app.post("/api/create-lomda-stream")
async def create_lomda_stream(data: dict):
    """Stream a complete self-contained HTML learning mini-game built from the
    child's description. Constrained to the curriculum topic. SSE: {code} chunks."""
    message = (data.get("message") or "").strip()
    topic_id = (data.get("topic") or "electronics").strip()
    student_name = (data.get("student_name") or "").strip()
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
            async for chunk in call_llm_stream(messages, max_tokens=6000):
                has_content = True
                yield f"data: {json.dumps({'code': chunk}, ensure_ascii=False)}\n\n"
        except Exception as e:
            print(f"⚠️ create-lomda stream error: {e}")
        if not has_content:
            yield f"data: {json.dumps({'error': 'no_content'}, ensure_ascii=False)}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


# --- Static File Serving ---

# Serve shared assets
app.mount("/shared", StaticFiles(directory=str(SHARED_DIR)), name="shared")

# Serve locale files
app.mount("/locales", StaticFiles(directory=str(LOCALES_DIR)), name="locales")

# Serve the migrated React app build. Vite dev serves this during local React work;
# FastAPI serves the built files from / for integrated demos and deployment.
if REACT_ASSETS_DIR.exists():
    app.mount("/assets", StaticFiles(directory=str(REACT_ASSETS_DIR)), name="react-assets")

# Serve the interactive game + generated lomda content as self-contained iframe
# documents (720 content standard). The learning portal/lesson/create chrome is
# served by the React app; only the game file remains a standalone document.
LEARNING_GAME_FILE = LEARNING_AGENT_DIR / "game.html"


def _serve_react_app():
    """Serve the built React SPA shell, or a clear error if it is missing."""
    index_file = REACT_APP_DIR / "index.html"
    if index_file.exists():
        return FileResponse(index_file)
    return JSONResponse(
        content={"error": "React build missing. Run `npm run build` in frontend/."},
        status_code=503,
    )


@app.get("/")
async def root():
    """Serve the React app shell at the site root (learner mapping)."""
    return _serve_react_app()


@app.get("/results")
@app.get("/results/{path:path}")
async def results_route(path: str = ""):
    """Serve the React app shell for the migrated results route."""
    return _serve_react_app()


@app.get("/student-dashboard")
@app.get("/student-dashboard/{path:path}")
async def student_dashboard_route(path: str = ""):
    """Serve the React app shell for the migrated student dashboard route."""
    return _serve_react_app()


@app.get("/teacher-view")
@app.get("/teacher-view/{path:path}")
async def teacher_view_route(path: str = ""):
    """Serve the React app shell for the migrated teacher view route."""
    return _serve_react_app()


@app.get("/mentoring")
@app.get("/mentoring/{path:path}")
async def mentoring_route(path: str = ""):
    """Serve the React app shell for the migrated mentoring route."""
    return _serve_react_app()


@app.get("/learning/game.html")
async def learning_game():
    """Serve the self-contained interactive game as a standalone iframe document."""
    if LEARNING_GAME_FILE.exists():
        return FileResponse(LEARNING_GAME_FILE)
    return JSONResponse(content={"error": "game not found"}, status_code=404)


@app.get("/learning")
@app.get("/learning/{path:path}")
async def learning_route(path: str = ""):
    """Serve the React app shell for the migrated learning portal/lesson/create routes."""
    return _serve_react_app()


@app.get("/app")
@app.get("/app/{path:path}")
async def old_react_app_path(path: str = ""):
    """Redirect the temporary migration URL to the root app."""
    return RedirectResponse(url="/")


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "8720")))
