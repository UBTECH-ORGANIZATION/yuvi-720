"""Student dashboard and mock results API routes."""

import json

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from app.core.localization import normalize_language, output_language_instruction
from app.services.llm import call_llm
from mock_data import DIMENSIONS, MOCK_STUDENTS


router = APIRouter(prefix="/api", tags=["dashboard"])


@router.post("/generate-dashboard")
async def generate_dashboard(data: dict):
    """Generate personalized student dashboard data based on mapping scores."""
    student_name = data.get("student_name", "תלמיד/ה")
    scores = data.get("scores", {})
    language = normalize_language(data.get("language"))

    if data.get("prefer_fallback"):
        return JSONResponse(content=generate_fallback_dashboard(scores, student_name, language))

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
1. {output_language_instruction(language)}
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
            for subject in parsed.get("subjects", []):
                subject.setdefault("iconBg", "rgba(124,92,255,0.1)")
                progress = subject.get("progress", 50)
                subject.setdefault(
                    "levelClass",
                    "level-great" if progress >= 80 else "level-good" if progress >= 60 else "level-building",
                )
                subject.setdefault("gradient", "linear-gradient(135deg, #7c5cff, #9f7afe)")
                for item in subject.get("curriculum", []):
                    status = item.get("status", "").lower()
                    item.setdefault(
                        "statusClass",
                        "curr-done" if any(token in status for token in ["הושלם", "done", "completed", "تم"])
                        else "curr-current" if any(token in status for token in ["עכשיו", "now", "current", "قيد"])
                        else "curr-upcoming",
                    )
            for difficulty in parsed.get("difficulties", []):
                status = difficulty.get("status", "").lower()
                difficulty.setdefault(
                    "statusClass",
                    "status-working" if any(token in status for token in ["עובד", "working", "يعمل"])
                    else "status-new" if any(token in status for token in ["חדש", "new", "جديد"])
                    else "status-improving",
                )
            return JSONResponse(content={"name": student_name, "avatar": student_name[0] if student_name else "ת", **parsed})
        except json.JSONDecodeError:
            print("⚠️ generate-dashboard: invalid JSON from LLM")

    return JSONResponse(content=generate_fallback_dashboard(scores, student_name, language))


FALLBACK_DASHBOARD_TEXT = {
    "subjects": {
        "he": [
            {"name": "מתמטיקה", "icon": "🔢", "level": "מתקדם", "description": "בהתבסס על ריכוז וחשיבה", "curriculum": ["חיבור וחיסור", "לוח הכפל", "שברים פשוטים", "גאומטריה בסיסית"]},
            {"name": "מדעים", "icon": "🔬", "level": "בהתפתחות", "description": "בהתבסס על סקרנות וחשיבה", "curriculum": ["עולם הצומח", "מצבי החומר", "מערכת השמש", "גוף האדם"]},
            {"name": "עברית", "icon": "📖", "level": "מתקדם", "description": "בהתבסס על התמדה וריכוז", "curriculum": ["קריאה שוטפת", "הבנת הנקרא", "כתיבה יצירתית"]},
            {"name": "מחשבים", "icon": "💻", "level": "מצוין", "description": "בהתבסס על שליטה בטכנולוגיה", "curriculum": ["שימוש בטוח במחשב", "חשיבה מחשבתית", "בניית משחק ראשון"]},
        ],
        "en": [
            {"name": "Math", "icon": "🔢", "level": "Advancing", "description": "Based on focus and thinking", "curriculum": ["Addition and subtraction", "Multiplication table", "Simple fractions", "Basic geometry"]},
            {"name": "Science", "icon": "🔬", "level": "Growing", "description": "Based on curiosity and thinking", "curriculum": ["Plant world", "States of matter", "Solar system", "The human body"]},
            {"name": "Language Arts", "icon": "📖", "level": "Advancing", "description": "Based on persistence and focus", "curriculum": ["Fluent reading", "Reading comprehension", "Creative writing"]},
            {"name": "Computers", "icon": "💻", "level": "Excellent", "description": "Based on comfort with technology", "curriculum": ["Safe computer use", "Computational thinking", "Building a first game"]},
        ],
        "ar": [
            {"name": "الرياضيات", "icon": "🔢", "level": "متقدم", "description": "بناءً على التركيز والتفكير", "curriculum": ["الجمع والطرح", "جدول الضرب", "كسور بسيطة", "هندسة أساسية"]},
            {"name": "العلوم", "icon": "🔬", "level": "في تطور", "description": "بناءً على الفضول والتفكير", "curriculum": ["عالم النبات", "حالات المادة", "المجموعة الشمسية", "جسم الإنسان"]},
            {"name": "اللغة", "icon": "📖", "level": "متقدم", "description": "بناءً على المثابرة والتركيز", "curriculum": ["القراءة الطليقة", "فهم المقروء", "الكتابة الإبداعية"]},
            {"name": "الحاسوب", "icon": "💻", "level": "ممتاز", "description": "بناءً على الراحة مع التكنولوجيا", "curriculum": ["الاستخدام الآمن للحاسوب", "التفكير الحاسوبي", "بناء أول لعبة"]},
        ],
    },
    "curriculum_status": {
        "he": {"done": "הושלם", "current": "לומדים עכשיו", "upcoming": "בהמשך"},
        "en": {"done": "Done", "current": "Learning now", "upcoming": "Coming up"},
        "ar": {"done": "تم الإنجاز", "current": "قيد التعلم الآن", "upcoming": "لاحقًا"},
    },
    "difficulties": {
        "he": [
            {"subject": "למידה", "text": "ריכוז לאורך זמן", "status": "עובד על זה"},
            {"subject": "למידה", "text": "ארגון מידע ותכנון", "status": "חדש"},
        ],
        "en": [
            {"subject": "Learning", "text": "Staying focused over time", "status": "Working on it"},
            {"subject": "Learning", "text": "Organizing information and planning", "status": "New"},
        ],
        "ar": [
            {"subject": "التعلم", "text": "الحفاظ على التركيز لفترة طويلة", "status": "يعمل على ذلك"},
            {"subject": "التعلم", "text": "تنظيم المعلومات والتخطيط", "status": "جديد"},
        ],
    },
    "goals": {
        "he": [
            {"text": "לשפר ריכוז ב-10 דקות כל יום", "meta": "נקבע השבוע", "source": "שיחת מנטורינג"},
            {"text": "לנסות ללמוד בדרך חדשה השבוע", "meta": "נקבע השבוע", "source": "שיחת מנטורינג"},
            {"text": "לחזק נקודת חולשה אחת בהדרגה", "meta": "מהמיפוי - היום", "source": "מהמיפוי"},
        ],
        "en": [
            {"text": "Improve focus for 10 minutes every day", "meta": "Set this week", "source": "Mentoring conversation"},
            {"text": "Try learning in a new way this week", "meta": "Set this week", "source": "Mentoring conversation"},
            {"text": "Gradually strengthen one growth area", "meta": "From the mapping - today", "source": "From the mapping"},
        ],
        "ar": [
            {"text": "تحسين التركيز لمدة 10 دقائق كل يوم", "meta": "تم تحديده هذا الأسبوع", "source": "محادثة الإرشاد"},
            {"text": "تجربة التعلم بطريقة جديدة هذا الأسبوع", "meta": "تم تحديده هذا الأسبوع", "source": "محادثة الإرشاد"},
            {"text": "تعزيز نقطة ضعف واحدة تدريجيًا", "meta": "من نتائج التقييم - اليوم", "source": "من نتائج التقييم"},
        ],
    },
    "mapping": {
        "he": {
            "interests": ["טכנולוגיה", "גילוי דברים חדשים", "אתגרים"],
            "learningStyle": "בהתאם למיפוי",
            "preferences": ["למידה עצמאית", "משוב מיידי"],
            "environment": "סביבה שקטה",
            "strengths": ["סקרנות", "שליטה בטכנולוגיה", "רצון להצליח"],
        },
        "en": {
            "interests": ["Technology", "Discovering new things", "Challenges"],
            "learningStyle": "Based on the mapping",
            "preferences": ["Independent learning", "Immediate feedback"],
            "environment": "A quiet environment",
            "strengths": ["Curiosity", "Comfort with technology", "Drive to succeed"],
        },
        "ar": {
            "interests": ["التكنولوجيا", "اكتشاف أشياء جديدة", "التحديات"],
            "learningStyle": "بناءً على نتائج التقييم",
            "preferences": ["التعلم المستقل", "التغذية الراجعة الفورية"],
            "environment": "بيئة هادئة",
            "strengths": ["الفضول", "الراحة مع التكنولوجيا", "الرغبة في النجاح"],
        },
    },
    "competencies": {
        "he": [
            {"icon": "🎯", "label": "יוזמה ואחריות", "descriptor": "לוקח אחריות"},
            {"icon": "🤝", "label": "שיתוף פעולה", "descriptor": "עובד עם אחרים"},
            {"icon": "💡", "label": "חשיבה ביקורתית", "descriptor": "חושב לעומק"},
            {"icon": "🔄", "label": "גמישות", "descriptor": "מתמודד עם שינויים"},
            {"icon": "🗣️", "label": "תקשורת", "descriptor": "מביע דעה"},
            {"icon": "🧭", "label": "הכוונה עצמית", "descriptor": "מנהל את עצמו"},
        ],
        "en": [
            {"icon": "🎯", "label": "Initiative & responsibility", "descriptor": "Takes ownership"},
            {"icon": "🤝", "label": "Collaboration", "descriptor": "Works well with others"},
            {"icon": "💡", "label": "Critical thinking", "descriptor": "Thinks deeply"},
            {"icon": "🔄", "label": "Flexibility", "descriptor": "Handles change well"},
            {"icon": "🗣️", "label": "Communication", "descriptor": "Expresses ideas clearly"},
            {"icon": "🧭", "label": "Self-direction", "descriptor": "Manages themselves"},
        ],
        "ar": [
            {"icon": "🎯", "label": "المبادرة والمسؤولية", "descriptor": "يتحمل المسؤولية"},
            {"icon": "🤝", "label": "التعاون", "descriptor": "يعمل جيدًا مع الآخرين"},
            {"icon": "💡", "label": "التفكير النقدي", "descriptor": "يفكر بعمق"},
            {"icon": "🔄", "label": "المرونة", "descriptor": "يتعامل جيدًا مع التغيير"},
            {"icon": "🗣️", "label": "التواصل", "descriptor": "يعبر عن أفكاره بوضوح"},
            {"icon": "🧭", "label": "التوجيه الذاتي", "descriptor": "يدير نفسه"},
        ],
    },
}


def generate_fallback_dashboard(scores: dict, name: str, language: str = "he") -> dict:
    """Basic, language-aware dashboard data when LLM is unavailable."""
    focus = scores.get("environmental", {}).get("focus", 50)
    cognitive = scores.get("psycho_pedagogical", {}).get("cognitive", 50)
    interest = scores.get("academic", {}).get("interest", 50)
    tech = scores.get("environmental", {}).get("tech_comfort", 50)
    motivation = scores.get("psycho_pedagogical", {}).get("motivation", 50)
    autonomy = scores.get("psycho_pedagogical", {}).get("autonomy", 50)

    progresses = [
        int((focus + cognitive) / 2),
        int((interest + cognitive) / 2),
        int((motivation + focus) / 2),
        tech,
    ]
    gradients = [
        "linear-gradient(135deg, #7c5cff, #9f7afe)",
        "linear-gradient(135deg, #63b3ed, #4299e1)",
        "linear-gradient(135deg, #48bb78, #38a169)",
        "linear-gradient(135deg, #f6ad55, #ed8936)",
    ]
    icon_bgs = ["rgba(124,92,255,0.1)", "rgba(99,179,237,0.1)", "rgba(72,187,120,0.1)", "rgba(246,173,85,0.1)"]
    status_labels = FALLBACK_DASHBOARD_TEXT["curriculum_status"][language]

    subjects = []
    for index, subject in enumerate(FALLBACK_DASHBOARD_TEXT["subjects"][language]):
        progress = progresses[index]
        topics = subject["curriculum"]
        done_count = max(1, round(progress / 100 * len(topics)))
        curriculum = []
        for topic_index, topic in enumerate(topics):
            if topic_index < done_count - 1:
                status_key = "done"
            elif topic_index == done_count - 1:
                status_key = "current"
            else:
                status_key = "upcoming"
            curriculum.append({
                "topic": topic,
                "status": status_labels[status_key],
                "statusClass": f"curr-{status_key}" if status_key != "done" else "curr-done",
            })
        subjects.append({
            "name": subject["name"],
            "icon": subject["icon"],
            "iconBg": icon_bgs[index],
            "progress": progress,
            "level": subject["level"],
            "levelClass": "level-great" if progress >= 80 else "level-good" if progress >= 60 else "level-building",
            "gradient": gradients[index],
            "description": subject["description"],
            "curriculum": curriculum,
        })

    difficulties = [
        {**item, "statusClass": "status-working" if index == 0 else "status-new"}
        for index, item in enumerate(FALLBACK_DASHBOARD_TEXT["difficulties"][language])
    ]
    goals = [{**item, "done": False} for item in FALLBACK_DASHBOARD_TEXT["goals"][language]]

    competencies_text = FALLBACK_DASHBOARD_TEXT["competencies"][language]
    competency_values = [int(autonomy * 0.9), 60, cognitive, 65, 60, int((autonomy + motivation) / 2)]
    competencies = [
        {**item, "value": competency_values[index]}
        for index, item in enumerate(competencies_text)
    ]

    return {
        "name": name,
        "avatar": name[0] if name else "ת",
        "subjects": subjects,
        "difficulties": difficulties,
        "goals": goals,
        "mapping": FALLBACK_DASHBOARD_TEXT["mapping"][language],
        "competencies": competencies,
    }


@router.get("/results/{student_id}")
async def get_student_results(student_id: str):
    """Get mock results for a specific student."""
    for student in MOCK_STUDENTS:
        if student["id"] == student_id:
            return JSONResponse(content={"student": student, "dimensions": DIMENSIONS})
    return JSONResponse(content={"error": "Student not found"}, status_code=404)


@router.get("/students")
async def get_all_students():
    """Get all mock students for teacher dashboard demos."""
    return JSONResponse(content=[
        {
            "id": student["id"],
            "name": student["name"],
            "age": student["age"],
            "grade": student["grade"],
            "class": student["class"],
            "avatar": student["avatar"],
            "completed_at": student["completed_at"],
            "scores": student["scores"],
            "insights": student["insights"],
        }
        for student in MOCK_STUDENTS
    ])