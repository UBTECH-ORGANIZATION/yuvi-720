"""Deterministic section-reflection engine (F2) — no LLM.

After a questionnaire phase, we rank the learner's answers by how *extreme* they
are (distance from the neutral option, with reverse-phrased items flipped), pick
the top signals, and map each to a prebuilt clarification question. If those
signals collapse to one repeated theme, a section-specific actionable follow-up
provides a coherent second turn. All learner-facing
text lives in the locale files (``reflect.*`` keys); this module only decides
*which* keys + signals to serve. That keeps the flow cheap, instant, offline, and
privacy-safe (no learner text leaves the app), and every question is traceable to
a real answer — consistent with "prefer a deterministic engine, avoid over-agenting".

Response shape (keys resolved on the client):
    {
      "opener_key": "reflect.opener.deep.<profile>",
      "opener_params": {"strength"?: {"key", "subject"?}, "difficulty"?: {"key", "subject"?}},
      "questions": [
        {"code": str, "prompt_key": str, "params": {"subject": "reflect.subject.math"}?,
         "options": [{"key": str, "signal": str}, ...]}
      ]
    }
"""

from __future__ import annotations

from questionnaire_locales import get_questionnaire_for_language

# Items where an agree/high answer is a DIFFICULTY (negatively-phrased). Mirrors
# mapping_chat._REVERSE_PHRASED_QIDS.
_REVERSE_PHRASED_QIDS = {4, 5, 6, 9, 14, 29, 36, 37, 38}
_NON_POLAR_QIDS = {32, 34}
_SUBJECT_BY_QID = {1: "math", 2: "science", 3: "english", 4: "math", 5: "science", 6: "english"}

# How many options each clarifier code has (labels + signals live in locales as
# reflect.q.<code>.opt.<n>; signal = "<code>.<n>").
_CLARIFIER_OPTIONS = {
    "subj_hard": 4, "subj_interest": 4, "subj_like": 3,
    "acad_class": 4, "acad_diff": 4, "acad_str": 3, "acad_action": 4,
    "growth_diff": 4, "growth_str": 3, "growth_action": 4,
    "resp_diff": 4, "resp_action": 4,
    "reg_diff": 4, "reg_action": 4,
    "aware_diff": 4, "aware_action": 4,
    "env_bored": 4, "env_support": 4, "env_focus": 4, "env_computer": 3,
    "env_diff": 4, "env_action": 4,
}

# Codes whose prompt needs a {subject} slot (resolved client-side from the key).
_SUBJECT_CODES = {"subj_hard", "subj_interest", "subj_like"}

# qid -> clarifier code for a DIFFICULTY-direction answer.
_QID_DIFFICULTY = {
    1: "subj_interest", 2: "subj_interest", 3: "subj_interest",
    4: "subj_hard", 5: "subj_hard", 6: "subj_hard",
    8: "acad_class", 12: "acad_diff",
    13: "growth_diff", 14: "growth_diff", 15: "growth_diff", 16: "growth_diff",
    17: "resp_diff", 18: "resp_diff", 19: "resp_diff", 20: "resp_diff", 21: "resp_diff",
    22: "reg_diff", 23: "reg_diff", 24: "reg_diff", 25: "reg_diff",
    26: "aware_diff", 27: "aware_diff", 28: "aware_diff",
    29: "env_bored", 30: "env_support", 31: "env_support",
    36: "env_focus", 37: "env_focus", 38: "env_focus",
}
# qid -> clarifier code for a STRENGTH-direction answer.
_QID_STRENGTH = {
    1: "subj_like", 2: "subj_like", 3: "subj_like",
    13: "growth_str", 15: "growth_str", 16: "growth_str",
    35: "env_computer",
}
# Per-phase fallback clarifier when a specific item has no mapping.
_PHASE_FALLBACK = {
    ("part_academic", "difficulty"): "acad_diff",
    ("part_academic", "strength"): "acad_str",
    ("part_growth", "difficulty"): "growth_diff",
    ("part_growth", "strength"): "growth_str",
    ("part_responsibility", "difficulty"): "resp_diff",
    ("part_regulation", "difficulty"): "reg_diff",
    ("part_self_awareness", "difficulty"): "aware_diff",
    ("part_environment", "difficulty"): "env_diff",
    ("part_environment", "strength"): "env_computer",
}

# A single question can occur when several extreme answers map to the same
# clarifier code (for example, all responsibility items map to ``resp_diff``).
# Rather than repeating that question or inventing another diagnosis, ask one
# phase-specific, action-oriented follow-up grounded in the same learning area.
_PHASE_ACTION_FOLLOWUP = {
    "part_academic": "acad_action",
    "part_growth": "growth_action",
    "part_responsibility": "resp_action",
    "part_regulation": "reg_action",
    "part_self_awareness": "aware_action",
    "part_environment": "env_action",
}


def _score_item(qid: int, answer: str, options: list[str]) -> tuple[str, int] | None:
    """Return (direction, extremeness 1..2) for an answer, or None if neutral."""
    if qid in _NON_POLAR_QIDS or not answer or answer not in options or len(options) < 3:
        return None
    index = options.index(answer)
    middle = len(options) // 2
    if index == middle:
        return None
    distance = abs(index - middle)
    is_strength = index < middle
    if qid in _REVERSE_PHRASED_QIDS:
        is_strength = not is_strength
    return ("strength" if is_strength else "difficulty", distance)


def _rank_answers(part_id: str, qa_pairs: list, language: str) -> list[dict]:
    """Rank a phase's answers by extremeness (difficulty outranks strength)."""
    parts = get_questionnaire_for_language(language).get("parts", [])
    lookup: dict[str, tuple] = {}
    for part in parts:
        for q in part.get("questions", []):
            lookup[q.get("text", "")] = (q.get("id"), q.get("options", []))

    scored: list[dict] = []
    for qa in qa_pairs:
        qid, options = lookup.get(qa.get("question", ""), (None, []))
        if qid is None:
            continue
        result = _score_item(qid, qa.get("answer", ""), options)
        if not result:
            continue
        direction, extremeness = result
        scored.append({"qid": qid, "direction": direction, "extremeness": extremeness})

    # difficulty first (weight), then more extreme, then stable by qid.
    scored.sort(key=lambda s: (s["direction"] != "difficulty", -s["extremeness"], s["qid"]))
    return scored


def _clarifier_for(part_id: str, qid: int, direction: str) -> str | None:
    table = _QID_DIFFICULTY if direction == "difficulty" else _QID_STRENGTH
    return table.get(qid) or _PHASE_FALLBACK.get((part_id, direction))


def _build_question(code: str, qid: int) -> dict:
    count = _CLARIFIER_OPTIONS.get(code, 0)
    question: dict = {
        "code": code,
        "prompt_key": f"reflect.q.{code}.prompt",
        "options": [
            {"key": f"reflect.q.{code}.opt.{n}", "signal": f"{code}.{n}"}
            for n in range(count)
        ],
    }
    if code in _SUBJECT_CODES and qid in _SUBJECT_BY_QID:
        question["params"] = {"subject": f"reflect.subject.{_SUBJECT_BY_QID[qid]}"}
    return question


def build_reflection(part_id: str, qa_pairs: list, language: str) -> dict:
    """Build 0 or 2-3 grounded clarification questions for a phase.

    Neutral answers need no interrogation. Once a phase does need clarification,
    however, one isolated question feels accidental and gives too little context,
    so a meaningful action-oriented second question is guaranteed.
    """
    ranked = _rank_answers(part_id, qa_pairs, language)

    questions: list[dict] = []
    used_codes: set[str] = set()
    for item in ranked:
        if len(questions) >= 3:
            break
        code = _clarifier_for(part_id, item["qid"], item["direction"])
        if not code or code in used_codes or code not in _CLARIFIER_OPTIONS:
            continue
        questions.append(_build_question(code, item["qid"]))
        used_codes.add(code)

    if len(questions) == 1:
        followup_code = _PHASE_ACTION_FOLLOWUP.get(part_id)
        if followup_code and followup_code not in used_codes:
            questions.append(_build_question(followup_code, ranked[0]["qid"]))

    # Deep opener: name the learner's top strength + top difficulty *themes*
    # (not a generic per-phase line), so the first message reads like a real,
    # grounded profile. Themes come from the clarifier code of the top-ranked
    # answer in each direction; text stays in the locales (reflect.theme.*).
    top_diff = next((r for r in ranked if r["direction"] == "difficulty"), None)
    top_str = next((r for r in ranked if r["direction"] == "strength"), None)
    diff_ref = _theme_ref(part_id, top_diff) if top_diff else None
    str_ref = _theme_ref(part_id, top_str) if top_str else None

    if diff_ref and str_ref:
        profile = "mixed"
    elif str_ref and not diff_ref:
        profile = "strength"
    elif diff_ref:
        profile = "difficulty"
    else:
        profile = "neutral"

    opener_params: dict[str, dict] = {}
    if str_ref:
        opener_params["strength"] = str_ref
    if diff_ref:
        opener_params["difficulty"] = diff_ref

    return {
        "opener_key": f"reflect.opener.deep.{profile}",
        "opener_params": opener_params,
        "profile": profile,
        "questions": questions,
    }


def _theme_ref(part_id: str, item: dict) -> dict | None:
    """A locale-key ref (+ optional subject) describing an answer's theme."""
    code = _clarifier_for(part_id, item["qid"], item["direction"])
    if not code:
        return None
    ref: dict = {"key": f"reflect.theme.{code}"}
    if code in _SUBJECT_CODES and item["qid"] in _SUBJECT_BY_QID:
        ref["subject"] = f"reflect.subject.{_SUBJECT_BY_QID[item['qid']]}"
    return ref

