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


def calculate_scores(answers: dict) -> dict:
    """
    Calculate dimension scores from raw answers.
    answers: dict of question_id -> option_index (0-based, 0=best)
    Returns scores dict with overall and sub-dimension percentages.
    """
    # Map question IDs to sub-dimensions. The live questionnaire follows the
    # 38-item MoE sample; missing answers remain neutral for legacy mock data.
    question_mapping = {
        "interest": [1, 2, 3, 10],
        "relevance": [7, 8],
        "investment": [11, 12],
        "motivation": [9, 13, 14, 15, 16],
        "autonomy": [17, 18, 19, 20, 21, 25],
        "cognitive": [22, 23],
        "self_awareness": [24, 26, 27, 28],
        "school_climate": [30, 31, 32],
        "tech_comfort": [33, 34, 35, 36, 38],
        "focus": [29, 37]
    }

    reverse_scored = {4, 5, 6, 9, 14, 29, 36, 37, 38}

    def score_answer(option_idx, question_id):
        """Convert option index (0=best) to percentage score."""
        if option_idx is None:
            return 60  # neutral
        if question_id == 34:
            return 45 if option_idx == 0 else 80
        if question_id in reverse_scored:
            return min(100, 20 + (option_idx * 20))
        return max(20, 100 - (option_idx * 20))

    sub_scores = {}
    for sub_dim, q_ids in question_mapping.items():
        scores_list = []
        for q_id in q_ids:
            key = q_id if q_id in answers else str(q_id)
            if key in answers:
                scores_list.append(score_answer(answers[key], q_id))
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
