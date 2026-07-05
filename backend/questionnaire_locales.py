"""Localized learner mapping questionnaires for the 720 program."""

SUPPORTED_LANGUAGES = {"he", "en", "ar"}

HE_AGREE = ["מסכים מאוד", "מסכים", "לא בטוח", "לא מסכים", "בכלל לא מסכים"]
HE_EXTENT = ["במידה רבה מאוד", "במידה רבה", "במידה בינונית", "במידה מועטה", "כלל לא"]
HE_FREQUENCY = ["לעיתים קרובות מאוד", "לעיתים קרובות", "לפעמים", "כמעט אף פעם", "אף פעם"]

EN_AGREE = ["Strongly agree", "Agree", "Not sure", "Disagree", "Strongly disagree"]
EN_EXTENT = ["Very much", "Much", "Somewhat", "A little", "Not at all"]
EN_FREQUENCY = ["Very often", "Often", "Sometimes", "Almost never", "Never"]

AR_AGREE = ["أوافق بشدة", "أوافق", "لست متأكدًا", "لا أوافق", "لا أوافق إطلاقًا"]
AR_EXTENT = ["إلى حد كبير جدًا", "إلى حد كبير", "إلى حد متوسط", "إلى حد قليل", "أبدًا"]
AR_FREQUENCY = ["كثيرًا جدًا", "كثيرًا", "أحيانًا", "نادرًا جدًا", "أبدًا"]


QUESTIONNAIRES = {
    "he": {
        "title": "שאלון פעלנות לומדים",
        "intro": {
            "greeting": "שלום! 👋",
            "description": "השאלון הזה עוזר להבין איך אתה לומד, מה מעניין אותך ואיך אפשר לתמוך בך טוב יותר.",
            "duration": "כ-10 דקות",
        },
        "parts": [
            {
                "id": "part_academic",
                "title": "חלק א׳ · עניין ולמידה",
                "subtitle": "מקצועות, קושי, רלוונטיות והשקעה",
                "dimension": "academic",
                "questions": [
                    {"id": 1, "text": "שיעורי מתמטיקה באופן כללי מעניינים אותי", "type": "emoji_scale", "options": HE_AGREE},
                    {"id": 2, "text": "שיעורי מדעים באופן כללי מעניינים אותי", "type": "emoji_scale", "options": HE_AGREE},
                    {"id": 3, "text": "שיעורי אנגלית באופן כללי מעניינים אותי", "type": "emoji_scale", "options": HE_AGREE},
                    {"id": 4, "text": "אני מתקשה בחומר הלימוד במתמטיקה", "type": "emoji_scale", "options": HE_AGREE},
                    {"id": 5, "text": "אני מתקשה בחומר הלימוד במדעים", "type": "emoji_scale", "options": HE_AGREE},
                    {"id": 6, "text": "אני מתקשה בחומר הלימוד באנגלית", "type": "emoji_scale", "options": HE_AGREE},
                    {"id": 7, "text": "קיים קשר בין מה שאני לומד לחיי היום יום שלי", "type": "emoji_scale", "options": HE_AGREE},
                    {"id": 8, "text": "אני מרוצה מהדרך שבה אני לומד בכיתה", "type": "emoji_scale", "options": HE_AGREE},
                    {"id": 9, "text": "אם תהיה לי אפשרות בחירה, אעדיף משימות שאצליח בהן בוודאות", "type": "emoji_scale", "options": HE_AGREE},
                    {"id": 10, "text": "יש נושא מסוים שלמדנו לאחרונה שהיה מעניין עבורי", "type": "single_choice", "options": ["כן, כל הנושאים מעניינים אותי", "כן, היו כמה נושאים מעניינים", "כן, היה נושא אחד מעניין", "לא היה נושא אחד מעניין, אבל היו כמה דברים מעניינים בנושאים השונים", "לא, שום נושא לא היה מעניין"]},
                    {"id": 11, "text": "עד כמה חשוב לך להצליח בלימודים?", "type": "emoji_scale", "options": HE_EXTENT},
                    {"id": 12, "text": "עד כמה אתה משקיע בלימודים?", "type": "emoji_scale", "options": HE_EXTENT},
                ],
            },
            {
                "id": "part_growth",
                "title": "חלק ב׳ · תודעת צמיחה",
                "subtitle": "מאמץ, אתגרים, טעויות והתמדה",
                "dimension": "psycho_pedagogical",
                "questions": [
                    {"id": 13, "text": "אני מאמין שאם אשקיע מאמץ, אוכל להשתפר בכל נושא", "type": "emoji_scale", "options": HE_AGREE},
                    {"id": 14, "text": "אני לא אוהב לקבל משימות חדשות שמאתגרות אותי", "type": "emoji_scale", "options": HE_AGREE},
                    {"id": 15, "text": "אני לומד מטעויות", "type": "emoji_scale", "options": HE_AGREE},
                    {"id": 16, "text": "כשיש לי קושי במשימה, אני ממשיך לנסות", "type": "emoji_scale", "options": ["תמיד ממשיך לנסות", "לרוב ממשיך לנסות", "לפעמים ממשיך לנסות", "לעיתים רחוקות ממשיך לנסות", "כמעט תמיד מוותר"]},
                ],
            },
            {
                "id": "part_responsibility",
                "title": "חלק ג׳ · יוזמה ואחריות",
                "subtitle": "מטרות, עצמאות ולקיחת אחריות",
                "dimension": "psycho_pedagogical",
                "questions": [
                    {"id": 17, "text": "אני מציב לעצמי מטרות בנושאים שאני לומד, ומשתדל להשיג אותן", "type": "emoji_scale", "options": HE_AGREE},
                    {"id": 18, "text": "כשיש לי בעיה בלמידה, אני קודם מנסה לפתור בעצמי, ואם צריך אני מבקש עזרה", "type": "emoji_scale", "options": HE_AGREE},
                    {"id": 19, "text": "אני מרגיש שאני האחראי המרכזי ללמידה שלי", "type": "emoji_scale", "options": HE_AGREE},
                    {"id": 20, "text": "אני עומד בזמני התכנון ללמידה שקבעתי לעצמי", "type": "emoji_scale", "options": ["לעיתים קרובות מאוד", "לעיתים קרובות", "לפעמים עומד בזמנים", "כמעט אף פעם לא עומד בזמנים", "אף פעם"]},
                    {"id": 21, "text": "כמה פעמים מתחילת השנה הצעת יוזמה בתחום הלימודי או החברתי?", "type": "emoji_scale", "options": ["הרבה מאוד פעמים", "כמה פעמים", "2-3 פעמים", "פעם אחת", "אף פעם"]},
                ],
            },
            {
                "id": "part_regulation",
                "title": "חלק ד׳ · ויסות עצמי",
                "subtitle": "תכנון, בדיקה עצמית והתמודדות עם תסכול",
                "dimension": "psycho_pedagogical",
                "questions": [
                    {"id": 22, "text": "במהלך הלמידה אני עוצר ובודק אם הבנתי את החומר", "type": "emoji_scale", "options": HE_FREQUENCY},
                    {"id": 23, "text": "אני מתכנן איך אבצע משימות לפני שאני מתחיל", "type": "emoji_scale", "options": HE_FREQUENCY},
                    {"id": 24, "text": "כשאני מתוסכל, אני יודע איך להרגיע את עצמי", "type": "emoji_scale", "options": HE_AGREE},
                    {"id": 25, "text": "אני לומד חומר לימודי נוסף גם בלי שהמורה אומר לנו", "type": "emoji_scale", "options": HE_AGREE},
                ],
            },
            {
                "id": "part_self_awareness",
                "title": "חלק ה׳ · מודעות עצמית",
                "subtitle": "מה עוזר לי, מה קשה לי ומה למדתי מהדרך",
                "dimension": "psycho_pedagogical",
                "questions": [
                    {"id": 26, "text": "אני יודע מה עוזר לי בלמידה", "type": "emoji_scale", "options": ["כן, אני תמיד יודע מה עוזר לי", "כן, אני בדרך כלל יודע מה עוזר לי", "לפעמים אני יודע מה עוזר לי", "לעיתים רחוקות אני יודע מה עוזר לי", "אני אף פעם לא יודע מה עוזר לי"]},
                    {"id": 27, "text": "אני יודע לזהות אילו נושאים קשים לי בלימודים", "type": "emoji_scale", "options": ["תמיד", "בדרך כלל", "לפעמים", "לעיתים רחוקות", "אף פעם לא"]},
                    {"id": 28, "text": "אני חושב על הצלחות וכישלונות בלמידה, ולומד מהם כדי להשתפר בפעם הבאה", "type": "emoji_scale", "options": HE_AGREE},
                ],
            },
            {
                "id": "part_environment",
                "title": "חלק ו׳ · סביבה וטכנולוגיה",
                "subtitle": "תמיכה, אקלים כיתתי, מחשב וריכוז",
                "dimension": "environmental",
                "questions": [
                    {"id": 29, "text": "במהלך השבוע אני מרגיש משועמם בשיעורים", "type": "emoji_scale", "options": HE_EXTENT},
                    {"id": 30, "text": "אם אתקשה בלימודים אני מרגיש שהמורה שלי יעזור לי", "type": "emoji_scale", "options": HE_AGREE},
                    {"id": 31, "text": "המורה שלי מבין אותי ויודע מה מעניין אותי", "type": "emoji_scale", "options": HE_AGREE},
                    {"id": 32, "text": "כשאני מתקשה בחומר הלימוד אני נעזר ב...", "type": "single_choice", "options": ["חבר/בן משפחה", "המורה שלי", "מורה פרטי", "בינה מלאכותית / הסברים או סרטונים באינטרנט", "לא יודע למי לפנות"]},
                    {"id": 33, "text": "אני מנוסה בלמידה באמצעות מחשב, כולל ביצוע משימות וקריאת חומרי לימוד", "type": "emoji_scale", "options": ["נכון מאוד", "נכון", "ככה ככה", "לא נכון", "בכלל לא נכון"]},
                    {"id": 34, "text": "למדתי בעבר בכיתה שבה משתמשים בעיקר במחשב", "type": "single_choice", "options": ["לא", "כן - מחשב אישי שהבאתי", "כן - מחשב נייד של בית הספר", "כן - מחשב נייח בכיתה/מעבדה"]},
                    {"id": 35, "text": "אני מעדיף מחשב על פני מחברות וספרים", "type": "emoji_scale", "options": HE_AGREE},
                    {"id": 36, "text": "קשה לי לעבוד עם מחשב ואני צריך עזרה כדי להשתמש בו", "type": "emoji_scale", "options": HE_AGREE},
                    {"id": 37, "text": "קשה לי להתרכז בשיעורים בבית הספר", "type": "emoji_scale", "options": HE_AGREE},
                    {"id": 38, "text": "יותר קשה לי להתרכז כשאנחנו לומדים עם מחשב מאשר בלי מחשב", "type": "emoji_scale", "options": HE_AGREE},
                ],
            },
        ],
    },
    "en": {},
    "ar": {},
}


def _copy_with_language(source: dict, language: str) -> dict:
    data = json_safe_clone(source)
    data["language"] = language
    return data


def json_safe_clone(value):
    if isinstance(value, dict):
        return {key: json_safe_clone(item) for key, item in value.items()}
    if isinstance(value, list):
        return [json_safe_clone(item) for item in value]
    return value


def get_questionnaire_for_language(language: str) -> dict:
    normalized = (language or "he").lower()
    if normalized not in SUPPORTED_LANGUAGES:
        normalized = "he"
    if normalized == "he":
        return _copy_with_language(QUESTIONNAIRES["he"], "he")
    translated = _translated_questionnaire(normalized)
    return _copy_with_language(translated, normalized)


def _translated_questionnaire(language: str) -> dict:
    if language == "en":
        question_texts = EN_QUESTIONS
        part_titles = EN_PART_TITLES
        option_sets = EN_OPTION_SETS
        title = "Learner Agency Questionnaire"
        intro = {
            "greeting": "Hello! 👋",
            "description": "This questionnaire helps us understand how you learn, what interests you, and how we can support you better.",
            "duration": "About 10 minutes",
        }
    else:
        question_texts = AR_QUESTIONS
        part_titles = AR_PART_TITLES
        option_sets = AR_OPTION_SETS
        title = "استبيان فاعلية المتعلم"
        intro = {
            "greeting": "مرحبًا! 👋",
            "description": "يساعدنا هذا الاستبيان على فهم طريقة تعلمك وما يهمك وكيف يمكننا دعمك بشكل أفضل.",
            "duration": "حوالي 10 دقائق",
        }

    translated = json_safe_clone(QUESTIONNAIRES["he"])
    translated["title"] = title
    translated["intro"] = intro
    for part in translated["parts"]:
        part["title"] = part_titles[part["id"]][0]
        part["subtitle"] = part_titles[part["id"]][1]
        for question in part["questions"]:
            question["text"] = question_texts[question["id"]]
            if question["id"] in option_sets:
                question["options"] = option_sets[question["id"]]
    return translated


EN_PART_TITLES = {
    "part_academic": ("Part A · Interest and Learning", "Subjects, difficulty, relevance, and effort"),
    "part_growth": ("Part B · Growth Mindset", "Effort, challenges, mistakes, and persistence"),
    "part_responsibility": ("Part C · Initiative and Responsibility", "Goals, independence, and ownership"),
    "part_regulation": ("Part D · Self-Regulation", "Planning, self-checking, and frustration"),
    "part_self_awareness": ("Part E · Self-Awareness", "What helps me, what is hard, and what I learn from the process"),
    "part_environment": ("Part F · Environment and Technology", "Support, classroom climate, computer use, and focus"),
}

AR_PART_TITLES = {
    "part_academic": ("القسم أ · الاهتمام والتعلم", "المواد، الصعوبة، الصلة بالحياة، والجهد"),
    "part_growth": ("القسم ب · عقلية النمو", "الجهد، التحديات، الأخطاء، والمثابرة"),
    "part_responsibility": ("القسم ج · المبادرة والمسؤولية", "الأهداف، الاستقلالية، وتحمل المسؤولية"),
    "part_regulation": ("القسم د · التنظيم الذاتي", "التخطيط، الفحص الذاتي، والتعامل مع الإحباط"),
    "part_self_awareness": ("القسم هـ · الوعي الذاتي", "ما يساعدني، ما يصعب علي، وما أتعلمه من التجربة"),
    "part_environment": ("القسم و · البيئة والتكنولوجيا", "الدعم، مناخ الصف، الحاسوب، والتركيز"),
}

EN_QUESTIONS = {
    1: "Math lessons generally interest me", 2: "Science lessons generally interest me", 3: "English lessons generally interest me",
    4: "I struggle with the learning material in math", 5: "I struggle with the learning material in science", 6: "I struggle with the learning material in English",
    7: "There is a connection between what I learn and my everyday life", 8: "I am satisfied with the way I learn in class", 9: "If I can choose, I prefer tasks I know I will succeed in",
    10: "There was a topic we learned recently that interested me", 11: "How important is it to you to succeed in your studies?", 12: "How much effort do you invest in your studies?",
    13: "I believe that if I invest effort, I can improve in any topic", 14: "I do not like getting new tasks that challenge me", 15: "I learn from mistakes", 16: "When I have difficulty with a task, I keep trying",
    17: "I set goals for topics I learn and try to achieve them", 18: "When I have a learning problem, I first try to solve it myself, and if needed I ask for help", 19: "I feel I am the main person responsible for my learning", 20: "I keep to the learning schedule I set for myself", 21: "How many times since the beginning of the year have you suggested an academic or social initiative?",
    22: "During learning, I stop and check whether I understood the material", 23: "I plan how I will do tasks before I start", 24: "When I am frustrated, I know how to calm myself", 25: "I study extra learning material even when the teacher does not tell us to",
    26: "I know what helps me learn", 27: "I know how to identify which topics are hard for me in my studies", 28: "I think about successes and failures in learning and learn from them to improve next time",
    29: "During the week I feel bored in lessons", 30: "If I struggle in my studies, I feel my teacher will help me", 31: "My teacher understands me and knows what interests me", 32: "When I struggle with the learning material, I get help from...", 33: "I am experienced in learning with a computer, including doing tasks and reading learning materials", 34: "I have previously learned in a class that mostly uses computers", 35: "I prefer a computer over notebooks and books", 36: "It is hard for me to work with a computer and I need help using it", 37: "It is hard for me to concentrate in school lessons", 38: "It is harder for me to concentrate when we learn with a computer than without one",
}

AR_QUESTIONS = {
    1: "دروس الرياضيات تهمني بشكل عام", 2: "دروس العلوم تهمني بشكل عام", 3: "دروس الإنجليزية تهمني بشكل عام",
    4: "أواجه صعوبة في مادة الرياضيات", 5: "أواجه صعوبة في مادة العلوم", 6: "أواجه صعوبة في مادة الإنجليزية",
    7: "يوجد ارتباط بين ما أتعلمه وحياتي اليومية", 8: "أنا راضٍ عن الطريقة التي أتعلم بها في الصف", 9: "إذا كان لدي خيار، أفضل المهام التي أعرف أنني سأنجح فيها بالتأكيد",
    10: "كان هناك موضوع تعلمناه مؤخرًا وكان مثيرًا للاهتمام بالنسبة لي", 11: "ما مدى أهمية النجاح في الدراسة بالنسبة لك؟", 12: "ما مقدار الجهد الذي تبذله في الدراسة؟",
    13: "أؤمن أنني إذا بذلت جهدًا يمكنني التحسن في أي موضوع", 14: "لا أحب الحصول على مهام جديدة تتحداني", 15: "أتعلم من الأخطاء", 16: "عندما أواجه صعوبة في مهمة، أواصل المحاولة",
    17: "أضع لنفسي أهدافًا في المواضيع التي أتعلمها وأحاول تحقيقها", 18: "عندما أواجه مشكلة في التعلم، أحاول أولًا حلها بنفسي، وإذا احتجت أطلب المساعدة", 19: "أشعر أنني المسؤول الرئيسي عن تعلمي", 20: "ألتزم بأوقات التعلم التي خططت لها لنفسي", 21: "كم مرة منذ بداية السنة اقترحت مبادرة تعليمية أو اجتماعية؟",
    22: "أثناء التعلم أتوقف وأفحص هل فهمت المادة", 23: "أخطط كيف سأنفذ المهام قبل أن أبدأ", 24: "عندما أشعر بالإحباط أعرف كيف أهدئ نفسي", 25: "أتعلم مادة إضافية حتى دون أن يطلب منا المعلم ذلك",
    26: "أعرف ما الذي يساعدني في التعلم", 27: "أعرف كيف أحدد المواضيع الصعبة علي في الدراسة", 28: "أفكر في النجاحات والإخفاقات في التعلم وأتعلم منها لأتحسن في المرة القادمة",
    29: "خلال الأسبوع أشعر بالملل في الدروس", 30: "إذا واجهت صعوبة في الدراسة أشعر أن معلمي سيساعدني", 31: "معلمي يفهمني ويعرف ما يهمني", 32: "عندما أواجه صعوبة في المادة أستعين بـ...", 33: "لدي خبرة في التعلم بواسطة الحاسوب، بما في ذلك تنفيذ المهام وقراءة مواد تعليمية", 34: "تعلمت سابقًا في صف يستخدم الحاسوب بشكل أساسي", 35: "أفضل الحاسوب على الدفاتر والكتب", 36: "يصعب علي العمل بالحاسوب وأحتاج إلى مساعدة لاستخدامه", 37: "يصعب علي التركيز في الدروس في المدرسة", 38: "يصعب علي التركيز أكثر عندما نتعلم بالحاسوب مقارنة بالتعلم بدونه",
}

EN_OPTION_SETS = {
    1: EN_AGREE, 2: EN_AGREE, 3: EN_AGREE, 4: EN_AGREE, 5: EN_AGREE, 6: EN_AGREE, 7: EN_AGREE, 8: EN_AGREE, 9: EN_AGREE,
    10: ["Yes, all topics interest me", "Yes, several topics were interesting", "Yes, one topic was interesting", "No single topic was interesting, but some parts were", "No, no topic was interesting"],
    11: EN_EXTENT, 12: EN_EXTENT, 13: EN_AGREE, 14: EN_AGREE, 15: EN_AGREE,
    16: ["I always keep trying", "I usually keep trying", "I sometimes keep trying", "I rarely keep trying", "I almost always give up"],
    17: EN_AGREE, 18: EN_AGREE, 19: EN_AGREE,
    20: ["Very often", "Often", "Sometimes I keep to the schedule", "Almost never", "Never"],
    21: ["Many times", "Several times", "2-3 times", "Once", "Never"],
    22: EN_FREQUENCY, 23: EN_FREQUENCY, 24: EN_AGREE, 25: EN_AGREE,
    26: ["Yes, I always know what helps me", "Yes, I usually know what helps me", "Sometimes I know what helps me", "I rarely know what helps me", "I never know what helps me"],
    27: ["Always", "Usually", "Sometimes", "Rarely", "Never"], 28: EN_AGREE, 29: EN_EXTENT, 30: EN_AGREE, 31: EN_AGREE,
    32: ["A friend/family member", "My teacher", "A private tutor", "AI / online explanations or videos", "I do not know who to ask"],
    33: ["Very true", "True", "So-so", "Not true", "Not true at all"],
    34: ["No", "Yes - a personal computer I brought", "Yes - a school laptop", "Yes - a classroom/lab desktop"],
    35: EN_AGREE, 36: EN_AGREE, 37: EN_AGREE, 38: EN_AGREE,
}

AR_OPTION_SETS = {
    **{i: AR_AGREE for i in [1, 2, 3, 4, 5, 6, 7, 8, 9, 13, 14, 15, 17, 18, 19, 24, 25, 28, 30, 31, 35, 36, 37, 38]},
    10: ["نعم، كل المواضيع تهمني", "نعم، كانت هناك عدة مواضيع مهمة", "نعم، كان هناك موضوع واحد مهم", "لم يكن هناك موضوع واحد مهم، لكن كانت هناك أشياء مهمة في مواضيع مختلفة", "لا، لم يكن أي موضوع مهمًا"],
    11: AR_EXTENT, 12: AR_EXTENT,
    16: ["أواصل المحاولة دائمًا", "غالبًا أواصل المحاولة", "أحيانًا أواصل المحاولة", "نادرًا ما أواصل المحاولة", "غالبًا أستسلم"],
    20: ["كثيرًا جدًا", "كثيرًا", "أحيانًا ألتزم بالوقت", "نادرًا جدًا", "أبدًا"],
    21: ["مرات كثيرة جدًا", "عدة مرات", "2-3 مرات", "مرة واحدة", "أبدًا"],
    22: AR_FREQUENCY, 23: AR_FREQUENCY,
    26: ["نعم، أعرف دائمًا ما يساعدني", "نعم، غالبًا أعرف ما يساعدني", "أحيانًا أعرف ما يساعدني", "نادرًا ما أعرف ما يساعدني", "لا أعرف أبدًا ما يساعدني"],
    27: ["دائمًا", "غالبًا", "أحيانًا", "نادرًا", "أبدًا"], 29: AR_EXTENT,
    32: ["صديق/فرد من العائلة", "معلمي", "معلم خصوصي", "ذكاء اصطناعي / شروحات أو فيديوهات على الإنترنت", "لا أعرف إلى من أتوجه"],
    33: ["صحيح جدًا", "صحيح", "متوسط", "غير صحيح", "غير صحيح إطلاقًا"],
    34: ["لا", "نعم - حاسوب شخصي أحضرته", "نعم - حاسوب محمول من المدرسة", "نعم - حاسوب مكتبي في الصف/المختبر"],
}