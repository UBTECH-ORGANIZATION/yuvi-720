"""Tests for the official MoE 720 agency-mapping questionnaire + scoring."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.services import agency_mapping as am


def test_official_dataset_shape():
    assert am.total_questions() == 31
    assert am.required_question_numbers() == list(range(1, 32))


def test_gender_and_language_resolution():
    he_m = am.get_questionnaire("he", "male")
    he_f = am.get_questionnaire("he", "female")
    # 7 sections (one per official measure) so the rail shows the agency stages;
    # the per-question measure is not exposed on the question objects.
    assert len(he_m["parts"]) == 7
    assert [p["title"] for p in he_m["parts"]][0] == "מוטיבציה ורלוונטיות"
    assert sum(len(p["questions"]) for p in he_m["parts"]) == 31
    q1_m = he_m["parts"][0]["questions"][0]
    q1_f = he_f["parts"][0]["questions"][0]
    assert "measure" not in q1_m and "measure_id" not in q1_m
    # Feminine agree option differs from masculine ("מסכימה" vs "מסכים").
    assert q1_m["options"][0] == "מסכים מאוד"
    assert q1_f["options"][0] == "מסכימה מאוד"
    # Arabic resolves to official ar-IL text.
    ar = am.get_questionnaire("ar", "male")
    assert ar["parts"][0]["questions"][0]["text"].strip() != ""
    # English is internal-only, generated.
    en = am.get_questionnaire("en", "male")
    assert en["parts"][0]["questions"][0]["options"][0] == "Strongly agree"


def test_level_bands():
    # 1≤X<2 → 1, 2≤X<3 → 2, 3≤X≤4 → 3, 4<X<4.5 → 4, 4.5≤X≤5 → 5
    assert am.level_for(1.0) == 1
    assert am.level_for(1.99) == 1
    assert am.level_for(2.0) == 2
    assert am.level_for(3.0) == 3
    assert am.level_for(4.0) == 3          # boundary belongs to level 3
    assert am.level_for(4.01) == 4
    assert am.level_for(4.49) == 4
    assert am.level_for(4.5) == 5
    assert am.level_for(5.0) == 5


def test_reverse_scored_items_use_official_value():
    # Selecting option index 0 ("strongly agree") everywhere: normal items score
    # 5 (high agency); the two reverse-phrased computer items (q30, q31) score 1.
    answers = {n: 0 for n in range(1, 32)}
    scored = am.score_submission(answers)
    by_measure = {m["measure"]: m for m in scored["measure_results"]}
    # Measures 1–6 are all normal → mean 5 → leading.
    for m in range(1, 7):
        assert by_measure[m]["average"] == 5.0
        assert by_measure[m]["level"] == 5
    # Measure 7 = q29 (value 5) + q30,q31 (reverse → value 1) → mean 2.33 → dev.
    assert by_measure[7]["average"] == 2.33
    assert by_measure[7]["level"] == 2


def test_official_answer_ids_captured():
    answers = {n: 0 for n in range(1, 32)}
    scored = am.score_submission(answers)
    assert len(scored["official_answers"]) == 31
    first = next(a for a in scored["official_answers"] if a["question_number"] == 1)
    assert first["question_id"].endswith("/questions/1")
    assert first["answer_id"].endswith("/answers/agree_5")
    assert first["value"] == 5
    rev = next(a for a in scored["official_answers"] if a["question_number"] == 30)
    assert rev["answer_id"].endswith("/answers/agree_rev_1")
    assert rev["value"] == 1


def test_legacy_adapter_shape_preserved():
    answers = {n: 0 for n in range(1, 32)}
    scored = am.score_submission(answers)
    scores = scored["scores"]
    # Same structure the dashboard/brain/onboarding consume.
    for dim in ("academic", "psycho_pedagogical", "environmental"):
        assert "overall" in scores[dim]
    assert set(scores["academic"]) >= {"overall", "interest", "relevance", "investment"}
    # High agency on measures 1–6 → strong legacy percentages.
    assert scores["academic"]["overall"] == 100
    # Measure 7 (tech) low → tech_comfort reduced.
    assert scores["environmental"]["tech_comfort"] < 60
