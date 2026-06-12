"""
720 Demo Backend Server
Serves static files and provides API for the learner mapping questionnaire.
"""

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pathlib import Path
import uvicorn
import os
import httpx

from mock_data import (
    QUESTIONNAIRE,
    DIMENSIONS,
    MOCK_STUDENTS,
    calculate_scores,
    generate_insights,
    generate_recommendations,
)

app = FastAPI(title="720 Demo - YuviLab", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Paths
BASE_DIR = Path(__file__).parent.parent
LEARNER_MAPPING_DIR = BASE_DIR / "learner-mapping"
STUDENT_DASHBOARD_DIR = BASE_DIR / "student-dashboard"
LEARNING_AGENT_DIR = BASE_DIR / "learning-agent"
SHARED_DIR = BASE_DIR / "shared"


# --- API Routes ---

@app.get("/api/questionnaire")
async def get_questionnaire():
    """Return the full questionnaire structure."""
    return JSONResponse(content=QUESTIONNAIRE)


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

    # Build a text representation of answers
    qa_text = "\n".join([f"- {qa['question']}: {qa['answer']}" for qa in qa_pairs])

    prompt = f"""אתה יובי, סוכן AI חינוכי חביב שמלווה ילדים בגילאי 10-14.
הילד סיים לענות על חלק "{part_title}" בשאלון מיפוי.

הנה התשובות שלו:
{qa_text}

כתוב סיכום קצר (2-3 משפטים) בגוף שני, בעברית ידידותית ומעודדת, שמתאר מה למדנו עליו מהתשובות. 
אל תחזור על השאלות עצמן - תן תובנה קצרה ומעניינת.
בסוף, שאל אם יש משהו נוסף שהילד רוצה להוסיף שכדאי שנכיר עליו.
אל תשתמש ביותר מ-4 משפטים סה"כ."""

    # Try to call Azure OpenAI
    endpoint = os.environ.get("AZURE_AI_PROJECT_ENDPOINT", "")
    deployment = os.environ.get("AZURE_AI_MODEL_DEPLOYMENT_NAME", "gpt-4o")
    api_key = os.environ.get("AZURE_OPENAI_API_KEY", "")

    if endpoint and api_key:
        try:
            # Use Azure OpenAI REST API
            url = f"{endpoint.rstrip('/')}/openai/deployments/{deployment}/chat/completions?api-version=2024-12-01-preview"
            headers = {"api-key": api_key, "Content-Type": "application/json"}
            body = {
                "messages": [{"role": "user", "content": prompt}],
                "max_tokens": 200,
                "temperature": 0.7,
            }
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.post(url, json=body, headers=headers)
                if resp.status_code == 200:
                    result = resp.json()
                    summary_text = result["choices"][0]["message"]["content"]
                    return JSONResponse(content={"summary": summary_text})
        except Exception as e:
            print(f"⚠️ LLM call failed: {e}")

    # Fallback: generate a simple summary without LLM
    fallback = generate_fallback_summary(part_title, qa_pairs)
    return JSONResponse(content={"summary": fallback})


def generate_fallback_summary(part_title: str, qa_pairs: list) -> str:
    """Generate a simple summary when LLM is unavailable."""
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

    endpoint = os.environ.get("AZURE_AI_PROJECT_ENDPOINT", "")
    deployment = os.environ.get("AZURE_AI_MODEL_DEPLOYMENT_NAME", "gpt-4o")
    api_key = os.environ.get("AZURE_OPENAI_API_KEY", "")

    if endpoint and api_key:
        try:
            url = f"{endpoint.rstrip('/')}/openai/deployments/{deployment}/chat/completions?api-version=2024-12-01-preview"
            headers = {"api-key": api_key, "Content-Type": "application/json"}
            body = {
                "messages": messages,
                "max_tokens": 200,
                "temperature": 0.7,
                "response_format": {"type": "json_object"},
            }
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.post(url, json=body, headers=headers)
                if resp.status_code == 200:
                    result = resp.json()
                    content = result["choices"][0]["message"]["content"]
                    import json
                    parsed = json.loads(content)
                    return JSONResponse(content={
                        "reply": parsed.get("reply", content),
                        "score_updates": parsed.get("score_updates")
                    })
        except Exception as e:
            print(f"⚠️ Results chat LLM error: {e}")

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


# --- Static File Serving ---

# Serve shared assets
app.mount("/shared", StaticFiles(directory=str(SHARED_DIR)), name="shared")

# Serve learner-mapping
app.mount("/learner-mapping", StaticFiles(directory=str(LEARNER_MAPPING_DIR), html=True), name="learner-mapping")

# Serve student-dashboard
app.mount("/student-dashboard", StaticFiles(directory=str(STUDENT_DASHBOARD_DIR), html=True), name="student-dashboard")

# Serve learning-agent
app.mount("/learning", StaticFiles(directory=str(LEARNING_AGENT_DIR), html=True), name="learning-agent")


@app.get("/")
async def root():
    """Redirect to learner mapping questionnaire."""
    return FileResponse(str(LEARNER_MAPPING_DIR / "index.html"))


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8720)
