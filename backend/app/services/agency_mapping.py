"""Official Israeli MoE 720 learner-agency questionnaire — the source of truth.

Loads the two official MoE files (``docs/720/agency_mapping_*.json``) and exposes
the questionnaire and its scoring. The official **31-question / 7-measure** model
is authoritative:

* Hebrew (``he-IL``) and Arabic (``ar-IL``) text is used **verbatim** from the
  official files, resolved by gender (male/female) then language.
* English is **auto-translated for internal display only** and is never reported
  to the MoE LRS.
* Question→measure assignment happens here in the backend and is **not** exposed
  to the learner (`§ שיוך למדדים נעשה ב־Backend ואינו מוצג ללומד`).

Scoring uses each answer's official ``value`` (1–5). A measure's level is the
average of the ``value`` of its questions, mapped onto the five MoE levels. A
compatibility adapter projects the seven measures onto the legacy
``academic/psycho_pedagogical/environmental`` structure so the dashboard, brain,
and activeness map keep working without change.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

_BACKEND_DIR = Path(__file__).resolve().parents[2]
_REPO_ROOT = _BACKEND_DIR.parent
# Primary source of truth (delivered originals). A build-time copy under the
# backend keeps the loader working when docs/ is not shipped with the image.
_DOCS_DIR = _REPO_ROOT / "docs" / "720"
_BUILD_DIR = _BACKEND_DIR / "data" / "720"
_MEASURES_FILE = "agency_mapping_measures.json"
_QUESTIONS_FILE = "agency_mapping_questions.json"

SUPPORTED_LANGUAGES = {"he", "ar", "en"}
SUPPORTED_GENDERS = {"male", "female"}


# ── Official identifier ↔ locale-code helpers ─────────────────────────────────
def _tail_int(url: str) -> int:
    return int(url.rstrip("/").rsplit("/", 1)[-1])


def _locale_code(language: str) -> str:
    """Map a product language code to the official locale key (he→he-IL …).

    English is not in the official files; it falls back to Hebrew content, which
    the English display map then overrides.
    """
    return {"he": "he-IL", "ar": "ar-IL"}.get(language, "he-IL")


# ── File loading (cached) ─────────────────────────────────────────────────────
def _resolve_dir() -> Path:
    """Locate the official files, preferring the delivered docs/ originals.

    Reads from ``docs/720`` when present (source of truth). Otherwise falls back
    to a build-time copy under ``backend/data/720`` — a packaging step may copy
    the files there for images that do not ship docs/. Raises loudly if neither
    is available rather than serving an empty questionnaire.
    """
    if (_DOCS_DIR / _QUESTIONS_FILE).exists():
        return _DOCS_DIR
    if (_BUILD_DIR / _QUESTIONS_FILE).exists():
        return _BUILD_DIR
    raise FileNotFoundError(
        f"Official agency-mapping files not found in {_DOCS_DIR} or {_BUILD_DIR}"
    )


@lru_cache(maxsize=1)
def _raw_measures() -> list[dict[str, Any]]:
    path = _resolve_dir() / _MEASURES_FILE
    return json.loads(path.read_text(encoding="utf-8"))


@lru_cache(maxsize=1)
def _raw_questions() -> list[dict[str, Any]]:
    path = _resolve_dir() / _QUESTIONS_FILE
    return json.loads(path.read_text(encoding="utf-8"))


@lru_cache(maxsize=1)
def _questions_by_num() -> dict[int, dict[str, Any]]:
    return {_tail_int(q["id"]): q for q in _raw_questions()}


@lru_cache(maxsize=1)
def _measure_of_question() -> dict[int, int]:
    return {_tail_int(q["id"]): _tail_int(q["measure_id"]) for q in _raw_questions()}


@lru_cache(maxsize=1)
def _measure_names() -> dict[int, dict[str, str]]:
    """measure number → {he, ar, en} display name."""
    out: dict[int, dict[str, str]] = {}
    for m in _raw_measures():
        num = _tail_int(m["id"])
        name = m.get("name", {})
        out[num] = {
            "he": name.get("he-IL", ""),
            "ar": name.get("ar-IL", ""),
            "en": _MEASURE_EN.get(num, name.get("he-IL", "")),
        }
    return out


# ── English internal-only translations (never sent to the MoE LRS) ────────────
_MEASURE_EN = {
    1: "Motivation and relevance",
    2: "Growth mindset",
    3: "Initiative and responsibility",
    4: "Self-regulation",
    5: "Self-awareness",
    6: "Support and emotional experiences",
    7: "Attitude toward learning with a computer",
}

_QUESTION_EN = {
    1: "School learning usually interests me",
    2: "There is a connection between what I learn and my everyday life",
    3: "I am satisfied with the way I learn in class",
    4: "There was a specific topic we learned recently that was interesting to me",
    5: "How important is it to you to succeed in your studies?",
    6: "How often do you study extra learning material, even when the teacher didn't ask?",
    7: "I believe that if I invest effort, I can improve in any subject",
    8: "I learn from mistakes",
    9: "When I have difficulty with a task, I keep trying",
    10: "I know that if I invest effort, I can improve even in things that are hard for me now",
    11: "Even when a task is very hard for me, I believe I can do it if I try",
    12: "I believe mistakes help me improve, even if they are sometimes frustrating",
    13: "I set goals for the topics I learn and try to achieve them",
    14: "When I have a learning problem, I first try to solve it myself, and ask for help if needed",
    15: "I feel I am the main person responsible for my learning",
    16: "I keep to the learning schedule I set for myself",
    17: "How much do you invest in your studies?",
    18: "During learning, I stop and check whether I understood the material",
    19: "I plan how I will do tasks before I start",
    20: "When I'm frustrated while dealing with a learning difficulty, I know how to calm myself and try again",
    21: "I know what helps me learn",
    22: "I think about successes and failures in learning, and learn from them to improve next time",
    23: "When I can't answer a question, I know exactly what is unclear to me",
    24: "At the end of a challenging task, I can tell myself exactly what was hard for me",
    25: "During the lesson, I try to add my own ideas or ask about things that interest me",
    26: "If I struggle in my studies, I feel my teacher will help me",
    27: "My teacher understands me and knows what interests me",
    28: "When I struggle, I turn to classmates for help",
    29: "I prefer a computer over notebooks and books",
    30: "It is hard for me to work with a computer and I need help using it",
    31: "It is harder for me to concentrate when we learn with a computer than without one",
}

# English answer labels keyed by the official Hebrew display string (covers both
# masculine and feminine spellings). Used only for internal English display.
_ANSWER_EN = {
    "מסכים מאוד": "Strongly agree",
    "מסכימה מאוד": "Strongly agree",
    "מסכים": "Agree",
    "מסכימה": "Agree",
    "לא בטוח": "Not sure",
    "לא בטוחה": "Not sure",
    "לא מסכים": "Disagree",
    "לא מסכימה": "Disagree",
    "בכלל לא מסכים": "Strongly disagree",
    "בכלל לא מסכימה": "Strongly disagree",
    "במידה רבה מאוד": "To a very great extent",
    "במידה רבה": "To a great extent",
    "במידה בינונית": "To a moderate extent",
    "במידה מועטה": "To a small extent",
    "כלל לא": "Not at all",
    "לעיתים קרובות מאוד": "Very often",
    "לעיתים קרובות": "Often",
    "לעיתים": "Sometimes",
    "לפעמים": "Sometimes",
    "לעיתים רחוקות": "Rarely",
    "אף פעם": "Never",
}


# ── Levels ────────────────────────────────────────────────────────────────────
# Official bands on the mean value X (1–5). Note the intentional (0.0-width) gap
# the MoE spec leaves between level 3 (…≤4) and level 4 (4<…): a mean of exactly
# 4 is level 3, anything above 4 up to 4.5 is level 4.
LEVEL_KEYS = {
    1: "beginning",   # בתחילת הדרך        1 ≤ X < 2
    2: "developing",  # מתפתח/ת            2 ≤ X < 3
    3: "advancing",   # מתקדם/ת            3 ≤ X ≤ 4
    4: "skilled",     # מיומן/ת            4 < X < 4.5
    5: "leading",     # לומד/ת מוביל/ה      4.5 ≤ X ≤ 5
}


def level_for(average: float) -> int:
    """Map a measure mean (1–5) to the official 1–5 level, per the MoE bands."""
    x = average
    if x < 2:
        return 1
    if x < 3:
        return 2
    if x <= 4:
        return 3
    if x < 4.5:
        return 4
    return 5


# ── Question→legacy sub-dimension adapter ─────────────────────────────────────
# Projects the 7 official measures onto the existing internal structure so the
# dashboard, brain (profile.mapping_scores), and activeness map keep working.
# Each legacy sub-dimension draws from the closest official measure(s).
_MEASURE_TO_SUBDIMS = {
    1: ["interest", "relevance", "motivation"],   # motivation & relevance
    2: ["investment"],                            # growth mindset
    3: ["autonomy"],                              # initiative & responsibility
    4: ["cognitive", "focus"],                    # self-regulation
    5: ["self_awareness"],                        # self-awareness
    6: ["school_climate"],                        # support & emotional
    7: ["tech_comfort"],                          # attitude to computer learning
}
_ACADEMIC_SUBDIMS = ["interest", "relevance", "investment"]
_PSYCHO_SUBDIMS = ["motivation", "autonomy", "cognitive", "self_awareness"]
_ENV_SUBDIMS = ["school_climate", "tech_comfort", "focus"]


def _value_to_pct(average: float) -> int:
    """Convert a 1–5 measure mean to a 0–100 legacy percentage."""
    return round(max(0.0, min(1.0, (average - 1) / 4)) * 100)


# ── Public API ────────────────────────────────────────────────────────────────
def get_questionnaire(language: str = "he", gender: str = "male") -> dict[str, Any]:
    """Build the learner-facing questionnaire for a language + gender.

    Returns the 31 official questions in fixed order, grouped into 7 sections by
    official measure (the right-side progress rail shows these as stages),
    resolved for the requested gender then language.
    """
    language = language if language in SUPPORTED_LANGUAGES else "he"
    gender = gender if gender in SUPPORTED_GENDERS else "male"
    loc = _locale_code(language)

    def q_text(q: dict[str, Any]) -> str:
        num = _tail_int(q["id"])
        if language == "en":
            return _QUESTION_EN.get(num, q["text"][gender].get("he-IL", ""))
        return q["text"][gender].get(loc, q["text"][gender].get("he-IL", ""))

    def opt_label(answer: dict[str, Any]) -> str:
        he = answer["display_text"][gender].get("he-IL", "")
        if language == "en":
            return _ANSWER_EN.get(he, he)
        return answer["display_text"][gender].get(loc, he)

    # Group the 31 questions into 7 sections by official measure, in fixed order,
    # so the right-side progress rail shows the seven agency "stages" (restores
    # the sense of stages & progress). Section titles are the official measure
    # names (he/ar verbatim; en internal). Question order stays exactly as in the
    # source file — measures are contiguous, so grouping preserves it.
    measure_of = _measure_of_question()
    names = _measure_names()
    sections: dict[int, list[dict[str, Any]]] = {}
    for q in _raw_questions():
        num = _tail_int(q["id"])
        sections.setdefault(measure_of[num], []).append({
            "id": num,
            "text": q_text(q),
            "type": "single_choice",
            "options": [opt_label(a) for a in q["answers"]],
        })

    strings = _UI_STRINGS[language]
    parts = []
    for m in sorted(sections):
        name = names.get(m, {})
        parts.append({
            "id": f"measure_{m}",
            "title": name.get(language) or name.get("he", ""),
            "subtitle": "",
            "dimension": f"measure_{m}",
            "questions": sections[m],
        })

    return {
        "title": strings["title"],
        "language": language,
        "gender": gender,
        "intro": {
            "greeting": strings["greeting"],
            "description": strings["intro"][gender],
            "duration": strings["duration"],
        },
        "parts": parts,
    }


def score_submission(answers: dict[int, int]) -> dict[str, Any]:
    """Score an answer set with the official value-based model + legacy adapter.

    ``answers`` maps a question number (1–31) to the **index** of the chosen
    option within that question's official ``answers`` array.

    Returns a dict with the official ``measure_results`` (name + mean + level),
    the raw ``official_answers`` (question/answer URL ids + value) for LRS
    reporting, and legacy ``scores`` (academic/psycho/environmental 0–100) so
    downstream consumers are unaffected.
    """
    by_num = _questions_by_num()
    measure_of = _measure_of_question()

    # Collect official value per answered question + resolve official ids.
    values_by_measure: dict[int, list[int]] = {m: [] for m in range(1, 8)}
    official_answers: list[dict[str, Any]] = []

    for qnum, opt_idx in answers.items():
        try:
            qnum = int(qnum)
        except (TypeError, ValueError):
            continue
        question = by_num.get(qnum)
        if question is None or opt_idx is None:
            continue
        options = question["answers"]
        if not isinstance(opt_idx, int) or opt_idx < 0 or opt_idx >= len(options):
            continue
        chosen = options[opt_idx]
        value = int(chosen["value"])
        values_by_measure[measure_of[qnum]].append(value)
        official_answers.append({
            "question_id": question["id"],
            "answer_id": chosen["id"],
            "value": value,
            "question_number": qnum,
        })

    # Per-measure mean + level.
    names = _measure_names()
    measure_results = []
    subdim_pct: dict[str, list[int]] = {}
    for m in range(1, 8):
        vals = values_by_measure[m]
        if vals:
            avg = sum(vals) / len(vals)
            level = level_for(avg)
        else:
            avg = 0.0
            level = 0
        measure_results.append({
            "measure": m,
            "id": f"https://moe.gov.il/720-agency-mapping/measures/{m}",
            "name": names.get(m, {}),
            "average": round(avg, 2),
            "level": level,
            "level_key": LEVEL_KEYS.get(level),
        })
        # Feed the legacy adapter (0–100) from the measure mean.
        pct = _value_to_pct(avg) if vals else 60
        for sub in _MEASURE_TO_SUBDIMS[m]:
            subdim_pct.setdefault(sub, []).append(pct)

    def sub(name: str) -> int:
        vals = subdim_pct.get(name)
        return round(sum(vals) / len(vals)) if vals else 60

    academic = {"overall": 0, **{d: sub(d) for d in _ACADEMIC_SUBDIMS}}
    psycho = {"overall": 0, **{d: sub(d) for d in _PSYCHO_SUBDIMS}}
    env = {"overall": 0, **{d: sub(d) for d in _ENV_SUBDIMS}}
    academic["overall"] = round(sum(academic[d] for d in _ACADEMIC_SUBDIMS) / len(_ACADEMIC_SUBDIMS))
    psycho["overall"] = round(sum(psycho[d] for d in _PSYCHO_SUBDIMS) / len(_PSYCHO_SUBDIMS))
    env["overall"] = round(sum(env[d] for d in _ENV_SUBDIMS) / len(_ENV_SUBDIMS))

    return {
        "measure_results": measure_results,
        "official_answers": official_answers,
        "scores": {
            "academic": academic,
            "psycho_pedagogical": psycho,
            "environmental": env,
        },
    }


def total_questions() -> int:
    return len(_raw_questions())


def required_question_numbers() -> list[int]:
    return sorted(_questions_by_num().keys())


# ── UI strings (intro / titles) — official Hebrew/Arabic, English internal ─────
_UI_STRINGS = {
    "he": {
        "title": "שאלון פעלנות לומדים",
        "greeting": "שלום,",
        "duration": "כ-10 דקות",
        "body_title": "שאלון פעלנות לומדים",
        "body_subtitle": "אין תשובות נכונות או שגויות — ענו בכנות",
        "intro": {
            "male": (
                "השאלון הזה בודק איך אתה מתמודד עם הלמידה, מה מעניין אותך, ואיך אתה מתמודד עם אתגרים. "
                "המידע שתספק יעזור לנו להבין טוב יותר את הצרכים שלך ולשפר את חוויית הלמידה בבית הספר. "
                "אין תשובות נכונות או שגויות — אנחנו רוצים לשמוע בדיוק מה אתה חושב ומרגיש. "
                "תענה בכנות — זה יעזור לנו לעזור לך! תודה על השתתפותך!"
            ),
            "female": (
                "השאלון הזה בודק איך את מתמודדת עם הלמידה, מה מעניין אותך, ואיך את מתמודדת עם אתגרים. "
                "המידע שתספקי יעזור לנו להבין טוב יותר את הצרכים שלך ולשפר את חוויית הלמידה בבית הספר. "
                "אין תשובות נכונות או שגויות — אנחנו רוצים לשמוע בדיוק מה את חושבת ומרגישה. "
                "תעני בכנות — זה יעזור לנו לעזור לך! תודה על השתתפותך!"
            ),
        },
    },
    "ar": {
        "title": "استبيان فاعلية المتعلّم",
        "greeting": "مَرْحَبًا،",
        "duration": "حوالي 10 دقائق",
        "body_title": "استبيان فاعلية المتعلّم",
        "body_subtitle": "لا توجد إجابات صحيحة أو خاطئة — أجب بصراحة",
        "intro": {
            "male": (
                "هذا الاِسْتِبْيان يَفْحَصُ كَيْفَ تَتَعامَلُ مَعَ التَّعَلُّم، ما الَّذي يُهِمُّكَ، وَكَيْفَ تُواجِهُ التَّحَدِّيات. "
                "المَعْلومات الَّتي سَتُقَدِّمُها تُساعِدُنا عَلَى فَهْمِ اِحْتِياجاتِكَ بِشَكْلٍ أَفْضَل، وَتَحْسينِ تَجْرِبَةِ التَّعَلُّم فِي المَدْرَسَة. "
                "لا توجَدُ إِجاباتٌ صَحيحَة أَو خاطئة — نُرِيدُ أَنْ نَعْرِف بِالضَّبْط ما تُفَكِّرُ وَتَشْعُرُ بِهِ. "
                "أجِبْ بِصِراحَة — فَهٰذا يُساعِدُنا عَلَى مُساعَدَتِكَ! شُكْرًا لِمُشارَكَتِكَ!"
            ),
            "female": (
                "هذا الاِسْتِبْيان يَفْحَصُ كَيْفَ تَتَعامَلينَ مَعَ التَّعَلُّم، ما الَّذي يُهِمُّكِ، وَكَيْفَ تُواجِهِينَ التَّحَدِّيات. "
                "المَعْلومات الَّتي سَتُقَدِّمينَها تُساعِدُنا عَلَى فَهْمِ اِحْتِياجاتِكِ بِشَكْلٍ أَفْضَل، وَتَحْسينِ تَجْرِبَةِ التَّعَلُّم فِي المَدْرَسَة. "
                "لا توجَدُ إجاباتٌ صَحيحَة أَو خاطئة — نُرِيدُ أَنْ نَعْرِفَ بِالضَّبْط ما تُفَكِّرينَ وَتَشْعُرينَ بِهِ. "
                "أجيبي بِصِراحَة — فَهٰذا يُساعِدُنا عَلَى مُساعَدَتِكِ! شُكْرًا لِمُشارَكَتِكِ!"
            ),
        },
    },
    "en": {
        "title": "Learner Agency Questionnaire",
        "greeting": "Hello,",
        "duration": "About 10 minutes",
        "body_title": "Learner Agency Questionnaire",
        "body_subtitle": "There are no right or wrong answers — answer honestly",
        "intro": {
            "male": (
                "This questionnaire looks at how you cope with learning, what interests you, and how you handle "
                "challenges. What you share helps us understand your needs and improve your learning experience at "
                "school. There are no right or wrong answers — we want to hear exactly what you think and feel. "
                "Answer honestly — it helps us help you! Thank you for taking part!"
            ),
            "female": (
                "This questionnaire looks at how you cope with learning, what interests you, and how you handle "
                "challenges. What you share helps us understand your needs and improve your learning experience at "
                "school. There are no right or wrong answers — we want to hear exactly what you think and feel. "
                "Answer honestly — it helps us help you! Thank you for taking part!"
            ),
        },
    },
}
