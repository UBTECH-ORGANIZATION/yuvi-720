"""The rubric grader — the one part of a score a model is allowed to decide.

`evaluate.py` scores every objective type in code. This handles `open_ended`,
where there is no key to compare against, and it is deliberately the *only*
place a model touches a grade.

The reference implementation left this as a stub: its questions carried a
`rubric` field documented as "criteria for AI grading", and its scoring path
read a pre-computed `answer["score"]` that nothing ever wrote. Every open
question therefore scored zero, silently, and the composite grade a teacher saw
was wrong by however much the open questions were worth.

## Three things make a model-assigned grade defensible

**Calibration anchors.** "Score 1 to 10" without saying what a 4 looks like
produces a grader that gives everyone a 7. The anchors below are stated in the
prompt and are the difference between a scale and a mood.

**Deterministic guards on top.** The model's number is clamped, and an answer
too thin to have earned a high mark has its score capped in code regardless of
what the model said. A grader that can be talked up by a confident-sounding
two-word answer is not a grader.

**An honest fallback.** With no provider there is no grading, and the heuristic
below says so: it never awards full marks and always sets `needs_review`. A
teacher reading a 100% that a keyword count produced would trust it, which is
worse than a blank.

The one-sentence rationale is child-facing and is stored on the attempt, so the
teacher sees **the exact feedback the student saw** beside the score.
"""

from __future__ import annotations

import json
import re
from typing import Any, Optional

from app.services.tasks.spec import segments_to_text

#: The model's scale. 1 is the floor, not zero — so `(score - 1) / 9` maps a
#: bottom mark to 0.0 rather than to 0.1.
SCALE_MIN, SCALE_MAX = 1, 10

#: Below this many words an answer cannot have demonstrated reasoning, whatever
#: the model thought of it. The cap is generous — it only catches the case the
#: guard exists for, which is a two-word answer scored 9.
THIN_ANSWER_WORDS = 8
THIN_ANSWER_CAP = 0.6

_ANCHORS = {
    "he": (
        "1 = אין תוכן רלוונטי, או תשובה ריקה. "
        "4 = נוגע ברעיון אבל חלקי או שגוי בחלקו. "
        "7 = נכון ומלא, אך ההסבר דל. "
        "10 = נכון, מלא, ומסביר למה."
    ),
    "ar": (
        "1 = لا يوجد محتوى ذو صلة، أو إجابة فارغة. "
        "4 = يلامس الفكرة لكنه ناقص أو خاطئ جزئيًا. "
        "7 = صحيح وكامل، لكن التفسير ضعيف. "
        "10 = صحيح وكامل ويشرح السبب."
    ),
    "en": (
        "1 = no relevant content, or an empty answer. "
        "4 = touches the idea but is partial or partly wrong. "
        "7 = correct and complete, but thin on reasoning. "
        "10 = correct, complete, and explains why."
    ),
}

_SYSTEM = {
    "he": (
        "את/ה בודק/ת תשובה פתוחה של תלמיד/ה בחטיבת ביניים, לפי מחוון שנקבע על ידי המורה. "
        "תן/י ציון 1–10 לכל קריטריון במחוון, לפי העוגנים הבאים: {anchors} "
        "אל תיתן/י ניקוד על אורך, על ניסוח יפה או על ביטחון עצמי — רק על התוכן מול הקריטריון. "
        "אם התשובה ריקה או לא קשורה, תן/י 1. "
        "כתוב/כתבי גם משפט אחד קצר וחם שפונה ישירות לתלמיד/ה ומסביר מה היה טוב ומה חסר — "
        "בלי לחשוף תשובה מלאה, ובלי לפנות בשם. "
        'החזר/י JSON בלבד: {{"scores":[{{"criterion":"...","score":7,"note":"..."}}],'
        '"feedback":"..."}}'
    ),
    "ar": (
        "أنت تصحّح إجابة مفتوحة لطالب/ة في المرحلة الإعدادية وفق معيار وضعه المعلّم. "
        "أعطِ درجة 1–10 لكل معيار وفق المرتكزات التالية: {anchors} "
        "لا تمنح درجات على الطول أو جمال الصياغة أو الثقة — فقط على المحتوى مقابل المعيار. "
        "إذا كانت الإجابة فارغة أو غير متعلقة، أعطِ 1. "
        "اكتب أيضًا جملة قصيرة ودافئة موجّهة للطالب/ة تشرح ما كان جيدًا وما ينقص — "
        "دون كشف الإجابة الكاملة ودون مناداة بالاسم. "
        'أعِد JSON فقط: {{"scores":[{{"criterion":"...","score":7,"note":"..."}}],'
        '"feedback":"..."}}'
    ),
    "en": (
        "You are marking a middle-schooler's open answer against a rubric the teacher set. "
        "Give each rubric criterion a score of 1-10 using these anchors: {anchors} "
        "Award nothing for length, elegant phrasing or confidence — only for content "
        "against the criterion. If the answer is empty or unrelated, give 1. "
        "Also write one short warm sentence addressed to the student explaining what was "
        "good and what is missing — without revealing the full answer and without using "
        "their name. "
        'Return JSON ONLY: {{"scores":[{{"criterion":"...","score":7,"note":"..."}}],'
        '"feedback":"..."}}'
    ),
}

_FALLBACK_FEEDBACK = {
    "he": "התשובה נשמרה. המורה יעבור/תעבור עליה ויכתוב/תכתוב לך משוב.",
    "ar": "تم حفظ إجابتك. سيطّلع عليها المعلّم ويكتب لك ملاحظاته.",
    "en": "Your answer was saved. Your teacher will read it and write back.",
}

_EMPTY_FEEDBACK = {
    "he": "לא נכתבה כאן תשובה. אפשר לנסות שוב — גם משפט אחד הוא התחלה.",
    "ar": "لم تُكتب إجابة هنا. جرّب مرة أخرى — حتى جملة واحدة بداية.",
    "en": "Nothing was written here. Try again — even one sentence is a start.",
}


def _language(locale: Optional[str]) -> str:
    return locale if locale in _SYSTEM else "he"


def _words(text: str) -> list[str]:
    return [word for word in re.split(r"[\s,.;:!?،؛]+", str(text or "")) if word]


def _to_correctness(scores: list[float]) -> float:
    """Rubric marks (1–10) to a 0–1 correctness, weighted by nothing but count.

    Per-criterion weights are applied by the caller from the spec; here every
    criterion the model returned counts once, because a model that invents a
    criterion must not also get to decide how much it is worth.
    """
    if not scores:
        return 0.0
    average = sum(scores) / len(scores)
    return max(0.0, min(1.0, (average - SCALE_MIN) / (SCALE_MAX - SCALE_MIN)))


def _heuristic(question: dict[str, Any], answer: str, language: str) -> dict[str, Any]:
    """No provider, no grading — an honest placeholder, not a fake grade.

    It reports term overlap with the rubric so the number is not arbitrary, caps
    well below full marks, and flags itself for review. The alternative — a
    keyword count rendered as a percentage — reads to a teacher exactly like a
    real grade.
    """
    rubric = question.get("answer", {}).get("rubric") or []
    words = _words(answer)
    if not words:
        return {"correctness": 0.0, "criteria": [], "feedback": _EMPTY_FEEDBACK[language],
                "source": "heuristic", "needs_review": True}

    given = {word.casefold() for word in words}
    hits = 0
    criteria = []
    for item in rubric:
        terms = {word.casefold() for word in _words(item.get("criterion")) if len(word) > 3}
        overlap = len(terms & given) / len(terms) if terms else 0.0
        hits += 1 if overlap >= 0.34 else 0
        criteria.append({"criterion": item.get("criterion"), "score": None,
                         "note": None, "overlap": round(overlap, 2)})

    share = hits / len(rubric) if rubric else 0.0
    return {
        # Half marks at most: this is a signal that the child wrote something
        # relevant, not a judgement that they were right.
        "correctness": round(min(0.5, share * 0.5), 3),
        "criteria": criteria,
        "feedback": _FALLBACK_FEEDBACK[language],
        "source": "heuristic",
        "needs_review": True,
    }


async def grade_open_ended(
    question: dict[str, Any], answer: Any, *,
    language: str = "he", usage: Any = None,
) -> dict[str, Any]:
    """One open answer against its rubric.

    Returns `{correctness, criteria, feedback, source, needs_review}`. Never
    raises — a grading failure falls back to the heuristic, because a task that
    cannot be submitted because the grader was down is a worse failure than a
    grade that says "a teacher should look at this".
    """
    from app.agents import safety

    lang = _language(language)
    text = str(answer or "").strip()
    rubric = (question.get("answer") or {}).get("rubric") or []

    if not text:
        return {"correctness": 0.0, "criteria": [], "feedback": _EMPTY_FEEDBACK[lang],
                "source": "empty", "needs_review": False}
    if not rubric:
        # No criteria means nothing to grade against. Say so rather than
        # inventing a standard the teacher never set.
        return {"correctness": None, "criteria": [], "feedback": _FALLBACK_FEEDBACK[lang],
                "source": "no_rubric", "needs_review": True}

    try:
        from app.services.llm import call_llm
        from app.services.ai_usage import UsageContext

        context = usage or UsageContext(
            actor_id="system", actor_type="system", endpoint="internal:task_grader",
            feature="feature_5_teacher_tasks", operation="task.grade",
            source="task_grader",
        )
        prompt = {
            "question": segments_to_text(question.get("prompt")),
            "rubric": [item.get("criterion") for item in rubric],
            "student_answer": text[:2000],
        }
        raw = await call_llm(
            [{"role": "system", "content": _SYSTEM[lang].format(anchors=_ANCHORS[lang])},
             {"role": "user", "content": json.dumps(prompt, ensure_ascii=False)}],
            usage_context=context, max_tokens=700, json_mode=True, model_tier="strong",
        )
        parsed = json.loads(raw or "{}")
    except Exception as exc:
        print(f"⚠️ rubric grading failed, using heuristic: {type(exc).__name__}")
        return _heuristic(question, text, lang)

    scored = parsed.get("scores") if isinstance(parsed, dict) else None
    if not isinstance(scored, list) or not scored:
        return _heuristic(question, text, lang)

    criteria: list[dict[str, Any]] = []
    marks: list[float] = []
    for index, entry in enumerate(scored[:len(rubric)]):
        if not isinstance(entry, dict):
            continue
        try:
            mark = float(entry.get("score"))
        except (TypeError, ValueError):
            continue
        mark = max(SCALE_MIN, min(SCALE_MAX, mark))
        marks.append(mark)
        criteria.append({
            # The criterion is the teacher's, not whatever the model echoed back.
            "criterion": rubric[index].get("criterion") if index < len(rubric) else None,
            "score": mark,
            "note": safety.screen_output(str(entry.get("note") or ""), lang).text or None,
        })

    if not marks:
        return _heuristic(question, text, lang)

    correctness = _to_correctness(marks)

    # The guard. A model can be talked into a 9 by a confident two-word answer;
    # length is not evidence of reasoning, but its *absence* is evidence against.
    capped = False
    if len(_words(text)) < THIN_ANSWER_WORDS and correctness > THIN_ANSWER_CAP:
        correctness = THIN_ANSWER_CAP
        capped = True

    feedback = safety.screen_output(str(parsed.get("feedback") or ""), lang).text.strip()
    return {
        "correctness": round(correctness, 3),
        "criteria": criteria,
        "feedback": feedback or _FALLBACK_FEEDBACK[lang],
        "source": "llm",
        # A capped score is exactly the case a teacher should glance at.
        "needs_review": capped,
        "capped": capped,
    }


async def grade_attempt(
    questions: list[dict[str, Any]], answers: dict[str, Any], *,
    language: str = "he", usage: Any = None,
) -> dict[str, Any]:
    """A whole component: deterministic scoring, then the rubric grader.

    `score_questions` deliberately excludes open questions from the total rather
    than counting them as zero. This runs the grader over exactly those, folds
    the results in, and re-totals — so the score a teacher sees is only ever a
    score of everything.
    """
    from app.services.tasks.evaluate import score_questions

    result = score_questions(questions, answers)
    by_id = {str(question.get("id")): question for question in questions}
    open_feedback: dict[str, Any] = {}

    for question_id, verdict in result["questions"].items():
        if verdict.get("correctness") is not None:
            continue
        question = by_id.get(question_id)
        if question is None:
            continue
        graded = await grade_open_ended(
            question, answers.get(question_id), language=language, usage=usage,
        )
        verdict["correctness"] = graded["correctness"]
        verdict["correct"] = (graded["correctness"] or 0) >= 1.0
        verdict["detail"] = {"criteria": graded["criteria"], "source": graded["source"],
                             "needs_review": graded["needs_review"]}
        # Stored so the teacher sees the exact sentence the child was shown.
        open_feedback[question_id] = graded["feedback"]

    earned = possible = 0.0
    for question in questions:
        verdict = result["questions"].get(str(question.get("id")))
        if not verdict or verdict.get("correctness") is None:
            continue
        try:
            weight = float(question.get("weight", 1) or 1)
        except (TypeError, ValueError):
            weight = 1.0
        earned += verdict["correctness"] * weight
        possible += weight

    result["earned"] = round(earned, 3)
    result["possible"] = round(possible, 3)
    result["score"] = round(100 * earned / possible) if possible else None
    result["awaiting_grading"] = sum(
        1 for verdict in result["questions"].values() if verdict.get("correctness") is None
    )
    result["open_feedback"] = open_feedback
    return result
