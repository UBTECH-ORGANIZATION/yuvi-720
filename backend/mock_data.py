"""
Mock data for the 720-demo learner mapping questionnaire.
3 parts: Academic, Psycho-Pedagogical, Environmental.
"""

# Questionnaire structure - 3 parts, 18 questions
QUESTIONNAIRE = {
    "title": "בוא נכיר איך נוח לך ללמוד",
    "intro": {
        "greeting": "היי! 👋",
        "description": "איך הכי נכון לעזור לך ללמוד?",
        "duration": "5 דקות בלבד",
    },
    "parts": [
        {
            "id": "part_academic",
            "title": "🎯 מה מעניין אותי",
            "subtitle": "על הדברים שאתה אוהב ללמוד ומה חשוב לך",
            "dimension": "academic",
            "questions": [
                {
                    "id": 1,
                    "text": "כשאני לומד מתמטיקה, זה בדרך כלל מעניין אותי",
                    "type": "emoji_scale",
                    "options": ["😍 מאוד", "🙂 די כן", "😐 ככה־ככה", "😕 לא כל כך", "😴 בכלל לא"]
                },
                {
                    "id": 2,
                    "text": "כשאני לומד מדעים, זה בדרך כלל מעניין אותי",
                    "type": "emoji_scale",
                    "options": ["😍 מאוד", "🙂 די כן", "😐 ככה־ככה", "😕 לא כל כך", "😴 בכלל לא"]
                },
                {
                    "id": 3,
                    "text": "כשאני לומד אנגלית, זה בדרך כלל מעניין אותי",
                    "type": "emoji_scale",
                    "options": ["😍 מאוד", "🙂 די כן", "😐 ככה־ככה", "😕 לא כל כך", "😴 בכלל לא"]
                },
                {
                    "id": 4,
                    "text": "אני מרגיש שמה שאני לומד קשור לחיים שלי",
                    "type": "emoji_scale",
                    "options": ["😍 מאוד", "🙂 די כן", "😐 ככה־ככה", "😕 לא כל כך", "😴 בכלל לא"]
                },
                {
                    "id": 5,
                    "text": "עד כמה חשוב לך להצליח בלימודים?",
                    "type": "emoji_scale",
                    "options": ["🔥 מאוד חשוב", "💪 חשוב", "🤷 ככה־ככה", "😶 לא כל כך", "❌ לא חשוב"]
                },
                {
                    "id": 6,
                    "text": "אני יודע מה עוזר לי בלמידה",
                    "type": "emoji_scale",
                    "options": ["😎 תמיד יודע", "🙂 בדרך כלל", "😐 לפעמים", "😕 לא כל כך", "😴 לא יודע"]
                }
            ]
        },
        {
            "id": "part_psycho",
            "title": "💪 איך אני מרגיש כשאני לומד",
            "subtitle": "על האומץ, הנחישות והדרך שלך להתמודד",
            "dimension": "psycho_pedagogical",
            "questions": [
                {
                    "id": 7,
                    "text": "אני מאמין שאם אשקיע - אשתפר",
                    "type": "emoji_scale",
                    "options": ["😍 מאוד", "🙂 די כן", "😐 ככה־ככה", "😕 לא כל כך", "😴 בכלל לא"]
                },
                {
                    "id": 8,
                    "text": "כשמשהו קשה לי, אני ממשיך לנסות",
                    "type": "emoji_scale",
                    "options": ["💪 מאוד", "🙂 די כן", "😐 ככה־ככה", "😕 לא כל כך", "😴 בכלל לא"]
                },
                {
                    "id": 9,
                    "text": "אני אוהב לקבל משימות שמאתגרות אותי",
                    "type": "emoji_scale",
                    "options": ["😍 מאוד", "🙂 די כן", "😐 ככה־ככה", "😕 לא כל כך", "😴 בכלל לא"]
                },
                {
                    "id": 10,
                    "text": "אני לומד מטעויות שלי",
                    "type": "emoji_scale",
                    "options": ["😍 מאוד", "🙂 די כן", "😐 ככה־ככה", "😕 לא כל כך", "😴 בכלל לא"]
                },
                {
                    "id": 11,
                    "text": "כשאני מתוסכל, אני יודע איך להירגע",
                    "type": "emoji_scale",
                    "options": ["😎 מאוד", "🙂 די כן", "😐 ככה־ככה", "😕 לא כל כך", "😢 בכלל לא"]
                },
                {
                    "id": 12,
                    "text": "אני מציב לעצמי מטרות ומשתדל להגיע אליהן",
                    "type": "emoji_scale",
                    "options": ["🎯 מאוד", "🙂 די כן", "😐 ככה־ככה", "😕 לא כל כך", "😴 בכלל לא"]
                },
                {
                    "id": 13,
                    "text": "כשיש בעיה - אני קודם מנסה לבד",
                    "type": "emoji_scale",
                    "options": ["💪 מאוד", "🙂 די כן", "😐 ככה־ככה", "😕 לא כל כך", "😴 בכלל לא"]
                }
            ]
        },
        {
            "id": "part_environment",
            "title": "🏠 איך נוח לי ללמוד",
            "subtitle": "על הכיתה, העזרה שסביבך והטכנולוגיה",
            "dimension": "environmental",
            "questions": [
                {
                    "id": 14,
                    "text": "אני מרגיש שהמורה שלי מבין אותי ועוזר לי",
                    "type": "emoji_scale",
                    "options": ["😍 מאוד", "🙂 די כן", "😐 ככה־ככה", "😕 לא כל כך", "😴 בכלל לא"]
                },
                {
                    "id": 15,
                    "text": "כשקשה לי, אני יודע למי לפנות",
                    "type": "single_choice",
                    "options": ["👨‍👩‍👦 חבר או משפחה", "👩‍🏫 המורה שלי", "🤖 AI או אינטרנט", "📚 מורה פרטי", "🤷 לא יודע"]
                },
                {
                    "id": 16,
                    "text": "אני מנוסה ונוח עם למידה במחשב",
                    "type": "emoji_scale",
                    "options": ["💻 מאוד", "🙂 די כן", "😐 ככה־ככה", "😕 לא כל כך", "📖 בכלל לא"]
                },
                {
                    "id": 17,
                    "text": "קל לי להתרכז בשיעורים",
                    "type": "emoji_scale",
                    "options": ["🎯 מאוד", "🙂 די כן", "😐 ככה־ככה", "😕 לא כל כך", "😴 בכלל לא"]
                },
                {
                    "id": 18,
                    "text": "אני עובד טוב בקבוצה עם חברים",
                    "type": "emoji_scale",
                    "options": ["😍 מאוד", "🙂 די כן", "😐 ככה־ככה", "😕 לא כל כך", "😴 בכלל לא"]
                }
            ]
        }
    ]
}

# Dimension descriptions for results display
DIMENSIONS = {
    "academic": {
        "name": "מה מעניין אותי",
        "icon": "📚",
        "description": "על הדברים שאתה אוהב ללמוד ומה חשוב לך",
        "sub_dimensions": {
            "interest": "עניין ומעורבות",
            "relevance": "רלוונטיות לחיים",
            "investment": "השקעה ומוטיבציה"
        }
    },
    "psycho_pedagogical": {
        "name": "איך אני מרגיש כשאני לומד",
        "icon": "🧠",
        "description": "על האומץ, הנחישות והדרך שלך להתמודד",
        "sub_dimensions": {
            "motivation": "מוטיבציה וחוסן",
            "autonomy": "עצמאות ויוזמה",
            "cognitive": "מיומנויות קוגניטיביות",
            "self_awareness": "מודעות עצמית"
        }
    },
    "environmental": {
        "name": "איך נוח לי ללמוד",
        "icon": "🏫",
        "description": "על הכיתה, העזרה שסביבך והטכנולוגיה",
        "sub_dimensions": {
            "school_climate": "אקלים בית ספרי",
            "tech_comfort": "נוחות טכנולוגית",
            "focus": "ריכוז ומיקוד"
        }
    }
}

# 6 Mock student profiles with pre-filled results
MOCK_STUDENTS = [
    {
        "id": "student_001",
        "name": "יובל כהן",
        "age": 13,
        "grade": "ז'",
        "class": "ז'2",
        "school": "בית ספר רבין, נתניה",
        "avatar": "🧑‍💻",
        "completed_at": "2026-06-01T10:30:00",
        "answers": {1: 0, 2: 1, 3: 2, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0, 10: 1, 11: 1, 12: 0, 13: 1, 14: 1, 15: 1, 16: 2, 17: 0, 18: 1},
        "scores": {
            "academic": {"overall": 78, "interest": 80, "relevance": 82, "investment": 85},
            "psycho_pedagogical": {"overall": 82, "motivation": 90, "autonomy": 78, "cognitive": 75, "self_awareness": 85},
            "environmental": {"overall": 85, "school_climate": 75, "tech_comfort": 95, "focus": 80}
        },
        "insights": [
            "מוטיבציה גבוהה מאוד ללמידה עצמאית",
            "מעדיף אתגרים ולא מפחד מטעויות",
            "נוח מאוד עם טכנולוגיה ולמידה דיגיטלית",
            "מתעניין במיוחד במתמטיקה ובמדעים"
        ],
        "recommendations": [
            "להציע משימות מאתגרות ופרויקטים עצמאיים",
            "לתת אחריות בקבוצה - מנהיגות טבעית",
            "לנצל את הנוחות הטכנולוגית ללמידה מתקדמת"
        ]
    },
    {
        "id": "student_002",
        "name": "נועה לוי",
        "age": 12,
        "grade": "ז'",
        "class": "ז'2",
        "school": "בית ספר רבין, נתניה",
        "avatar": "👩‍🎨",
        "completed_at": "2026-06-01T11:15:00",
        "answers": {1: 2, 2: 0, 3: 1, 4: 1, 5: 0, 6: 0, 7: 1, 8: 1, 9: 0, 10: 0, 11: 0, 12: 1, 13: 0, 14: 0, 15: 0, 16: 1, 17: 1, 18: 1},
        "scores": {
            "academic": {"overall": 72, "interest": 70, "relevance": 78, "investment": 80},
            "psycho_pedagogical": {"overall": 88, "motivation": 85, "autonomy": 92, "cognitive": 90, "self_awareness": 88},
            "environmental": {"overall": 78, "school_climate": 85, "tech_comfort": 72, "focus": 75}
        },
        "insights": [
            "עצמאות גבוהה מאוד בלמידה",
            "מודעות עצמית מפותחת",
            "מתעניינת במיוחד במדעים",
            "יכולת תכנון וארגון מצוינת"
        ],
        "recommendations": [
            "לעודד פרויקטים מחקריים עצמאיים במדעים",
            "להציע תפקיד חונכת לעמיתים",
            "לחזק ביטחון במתמטיקה דרך משימות מותאמות"
        ]
    },
    {
        "id": "student_003",
        "name": "אדם ברק",
        "age": 13,
        "grade": "ז'",
        "class": "ז'2",
        "school": "בית ספר רבין, נתניה",
        "avatar": "🎮",
        "completed_at": "2026-06-02T09:45:00",
        "answers": {1: 1, 2: 2, 3: 3, 4: 2, 5: 1, 6: 1, 7: 2, 8: 2, 9: 2, 10: 2, 11: 2, 12: 2, 13: 3, 14: 2, 15: 2, 16: 0, 17: 1, 18: 2},
        "scores": {
            "academic": {"overall": 58, "interest": 55, "relevance": 60, "investment": 62},
            "psycho_pedagogical": {"overall": 52, "motivation": 58, "autonomy": 48, "cognitive": 45, "self_awareness": 55},
            "environmental": {"overall": 62, "school_climate": 55, "tech_comfort": 72, "focus": 58}
        },
        "insights": [
            "מוטיבציה בינונית - צריך חיזוק",
            "מתקשה בתכנון ובארגון עצמי",
            "מתעניין במתמטיקה אבל מתקשה",
            "נעזר בחברים - עבודת צוות מתאימה"
        ],
        "recommendations": [
            "לפרק משימות גדולות לצעדים קטנים",
            "לשלב למידה שיתופית - עובד טוב בקבוצה",
            "לחבר את המתמטיקה לתחום העניין (משחקים)",
            "תמיכה בפיתוח הרגלי למידה עצמאית"
        ]
    },
    {
        "id": "student_004",
        "name": "מיכל דוד",
        "age": 12,
        "grade": "ז'",
        "class": "ז'2",
        "school": "בית ספר רבין, נתניה",
        "avatar": "📖",
        "completed_at": "2026-06-02T10:00:00",
        "answers": {1: 3, 2: 2, 3: 0, 4: 1, 5: 0, 6: 1, 7: 1, 8: 2, 9: 1, 10: 2, 11: 1, 12: 1, 13: 2, 14: 1, 15: 1, 16: 1, 17: 3, 18: 2},
        "scores": {
            "academic": {"overall": 65, "interest": 62, "relevance": 72, "investment": 75},
            "psycho_pedagogical": {"overall": 70, "motivation": 72, "autonomy": 68, "cognitive": 65, "self_awareness": 72},
            "environmental": {"overall": 60, "school_climate": 65, "tech_comfort": 50, "focus": 62}
        },
        "insights": [
            "חזקה מאוד באנגלית, מתקשה במתמטיקה",
            "מעדיפה למידה מסורתית (ספרים ומחברות)",
            "מוטיבציה טובה אך זקוקה לתמיכה בריכוז",
            "מודעות עצמית טובה - יודעת לזהות קשיים"
        ],
        "recommendations": [
            "תמיכה ממוקדת במתמטיקה - התחלה מהבסיס",
            "לנצל חוזק באנגלית לחיזוק ביטחון",
            "הכנסה הדרגתית של כלים דיגיטליים",
            "לעודד שיתוף בידע עם חברים"
        ]
    },
    {
        "id": "student_005",
        "name": "עומר שלום",
        "age": 13,
        "grade": "ז'",
        "class": "ז'2",
        "school": "בית ספר רבין, נתניה",
        "avatar": "⚽",
        "completed_at": "2026-06-03T08:30:00",
        "answers": {1: 3, 2: 3, 3: 3, 4: 3, 5: 2, 6: 2, 7: 3, 8: 3, 9: 3, 10: 3, 11: 3, 12: 3, 13: 3, 14: 3, 15: 3, 16: 4, 17: 2, 18: 3},
        "scores": {
            "academic": {"overall": 42, "interest": 38, "relevance": 42, "investment": 45},
            "psycho_pedagogical": {"overall": 38, "motivation": 42, "autonomy": 32, "cognitive": 35, "self_awareness": 40},
            "environmental": {"overall": 45, "school_climate": 40, "tech_comfort": 48, "focus": 42}
        },
        "insights": [
            "מתקשה ברוב המקצועות - צריך תמיכה כוללת",
            "מוטיבציה נמוכה ללמידה פורמלית",
            "משתעמם בשיעורים - צריך גיוון",
            "לא יודע למי לפנות כשמתקשה"
        ],
        "recommendations": [
            "חיבור הלמידה לספורט ולתחומי עניין",
            "בניית מערכת תמיכה - חונך אישי",
            "משימות קצרות ומגוונות עם הצלחות מהירות",
            "שילוב למידה חווייתית ופעילה"
        ]
    },
    {
        "id": "student_006",
        "name": "שירה אבירם",
        "age": 12,
        "grade": "ז'",
        "class": "ז'2",
        "school": "בית ספר רבין, נתניה",
        "avatar": "🎵",
        "completed_at": "2026-06-03T09:15:00",
        "answers": {1: 1, 2: 0, 3: 1, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0, 10: 1, 11: 0, 12: 0, 13: 1, 14: 0, 15: 0, 16: 1, 17: 0, 18: 0},
        "scores": {
            "academic": {"overall": 85, "interest": 88, "relevance": 90, "investment": 88},
            "psycho_pedagogical": {"overall": 92, "motivation": 95, "autonomy": 90, "cognitive": 88, "self_awareness": 92},
            "environmental": {"overall": 90, "school_climate": 88, "tech_comfort": 92, "focus": 90}
        },
        "insights": [
            "לומדת מצוינת בכל הפרמטרים",
            "מוטיבציה פנימית גבוהה מאוד",
            "עצמאית, יוזמת ומאורגנת",
            "מחוברת לטכנולוגיה ונהנית מלמידה"
        ],
        "recommendations": [
            "להציע העשרה ואתגרים מתקדמים",
            "לתת הזדמנויות למנהיגות וחונכות",
            "לעודד פרויקטים בין-תחומיים",
            "לשמור על מוטיבציה עם אתגרים חדשים"
        ]
    }
]


def calculate_scores(answers: dict) -> dict:
    """
    Calculate dimension scores from raw answers (shortened 18-question version).
    answers: dict of question_id -> option_index (0-based, 0=best)
    Returns scores dict with overall and sub-dimension percentages.
    """
    # Map question IDs to sub-dimensions
    question_mapping = {
        # Academic (Q1-5)
        "interest": [1, 2, 3],
        "relevance": [4],
        "investment": [5],
        # Psycho-pedagogical (Q6-14)
        "motivation": [6, 7, 8, 9],
        "autonomy": [11, 12],
        "cognitive": [13],
        "self_awareness": [10, 14],
        # Environmental (Q15-18)
        "school_climate": [15],
        "tech_comfort": [17],
        "focus": [18]
    }

    def score_answer(option_idx):
        """Convert option index (0=best) to percentage score."""
        if option_idx is None:
            return 60  # neutral
        # 0=100, 1=80, 2=60, 3=40, 4=20
        return max(20, 100 - (option_idx * 20))

    sub_scores = {}
    for sub_dim, q_ids in question_mapping.items():
        scores_list = []
        for q_id in q_ids:
            key = q_id if q_id in answers else str(q_id)
            if key in answers:
                scores_list.append(score_answer(answers[key]))
        if scores_list:
            sub_scores[sub_dim] = round(sum(scores_list) / len(scores_list))
        else:
            sub_scores[sub_dim] = 60

    # Calculate dimension overalls
    academic_dims = ["interest", "relevance", "investment"]
    psycho_dims = ["motivation", "autonomy", "cognitive", "self_awareness"]
    env_dims = ["school_climate", "tech_comfort", "focus"]

    academic_overall = round(sum(sub_scores[d] for d in academic_dims) / len(academic_dims))
    psycho_overall = round(sum(sub_scores[d] for d in psycho_dims) / len(psycho_dims))
    env_overall = round(sum(sub_scores[d] for d in env_dims) / len(env_dims))

    return {
        "academic": {
            "overall": academic_overall,
            **{d: sub_scores[d] for d in academic_dims}
        },
        "psycho_pedagogical": {
            "overall": psycho_overall,
            **{d: sub_scores[d] for d in psycho_dims}
        },
        "environmental": {
            "overall": env_overall,
            **{d: sub_scores[d] for d in env_dims}
        }
    }


def generate_insights(scores: dict) -> list:
    """Generate Hebrew insights based on scores."""
    insights = []

    if scores["academic"]["interest"] >= 75:
        insights.append("מגלה עניין רב בלימודים")
    elif scores["academic"]["interest"] <= 45:
        insights.append("צריך עידוד ומציאת תחומי עניין")

    if scores["academic"]["investment"] >= 75:
        insights.append("משקיע מאמץ רב בלימודים")

    if scores["psycho_pedagogical"]["motivation"] >= 80:
        insights.append("מוטיבציה גבוהה מאוד")
    elif scores["psycho_pedagogical"]["motivation"] <= 45:
        insights.append("מוטיבציה נמוכה - דורש תשומת לב")

    if scores["psycho_pedagogical"]["autonomy"] >= 75:
        insights.append("עצמאי בלמידה")
    elif scores["psycho_pedagogical"]["autonomy"] <= 45:
        insights.append("זקוק לליווי וגיבוי בלמידה")

    if scores["psycho_pedagogical"]["self_awareness"] >= 75:
        insights.append("מודעות עצמית מפותחת")

    if scores["environmental"]["tech_comfort"] >= 80:
        insights.append("נוח מאוד עם טכנולוגיה")
    elif scores["environmental"]["tech_comfort"] <= 45:
        insights.append("זקוק לתמיכה טכנולוגית")

    if scores["environmental"]["focus"] <= 45:
        insights.append("מתקשה בריכוז - צריך התאמות")

    return insights[:5]


def generate_recommendations(scores: dict) -> list:
    """Generate Hebrew recommendations based on scores."""
    recs = []

    if scores["academic"]["overall"] <= 50:
        recs.append("תמיכה לימודית כוללת עם דגש על חוויות הצלחה")
    if scores["psycho_pedagogical"]["motivation"] <= 50:
        recs.append("חיבור הלמידה לתחומי עניין אישיים")
    if scores["psycho_pedagogical"]["autonomy"] <= 50:
        recs.append("בניית הדרגתית של כישורי למידה עצמאית")
    if scores["psycho_pedagogical"]["cognitive"] <= 50:
        recs.append("הקניית אסטרטגיות למידה ותכנון")
    if scores["environmental"]["tech_comfort"] <= 50:
        recs.append("הכנסה הדרגתית של כלים דיגיטליים עם ליווי")
    if scores["environmental"]["focus"] <= 50:
        recs.append("משימות קצרות ומגוונות לשיפור ריכוז")

    if scores["academic"]["overall"] >= 75:
        recs.append("להציע אתגרים מתקדמים והעשרה")
    if scores["psycho_pedagogical"]["overall"] >= 80:
        recs.append("לתת הזדמנויות למנהיגות וחונכות עמיתים")

    return recs[:4]
