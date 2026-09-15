import json

from game_gen.context_pack import ContextPack, MAX_DESCRIPTION_CHARS, build_context_pack, grade_from_curriculum_title


def _context():
    return {
        "component": {"id": "c1", "title": "  Mass   and volume ", "purpose": "both", "relative_difficulty": 3},
        "unit": {"id": "u1", "title": "Measuring mass", "subject": "science"},
        "objective": {"id": "o1", "title": "Gross, tare, net", "description": "…", "curriculum_title": "8th Grade Science"},
        "learning_description": "The kid learns that gross = tare + net. " * 60,
    }


def test_grade_parsing():
    assert grade_from_curriculum_title("8th Grade Science") == "8"
    assert grade_from_curriculum_title("Mathematics 11TH grade") == "11"
    assert grade_from_curriculum_title("מדעים כיתה ח") == "ח"
    assert grade_from_curriculum_title("מתמטיקה לכיתה יב - חלק א") == "יב"
    assert grade_from_curriculum_title("Physics for everyone") == "Physics for everyone"
    assert grade_from_curriculum_title("x" * 80) == "x" * 40
    assert grade_from_curriculum_title(None) == ""


def test_pack_from_payload_context():
    pack = build_context_pack(_context(), language="he", device="touch")
    assert pack.component_title == "Mass and volume" and pack.unit_title == "Measuring mass"
    assert pack.objective_id == "o1" and pack.subject == "science" and pack.grade == "8"
    assert pack.purpose == "both" and pack.device == "touch"
    assert len(pack.learning_description) == MAX_DESCRIPTION_CHARS

    prompt = json.loads(pack.to_prompt_json())
    assert set(prompt) == {"component", "language", "device", "learning_description"}
    assert set(prompt["component"]) == {"id", "title", "purpose", "unit", "objective", "subject", "grade"}
    assert prompt["component"]["grade"] == "8"

    learn = pack.to_learn_data()
    assert learn == {"component": {"id": "c1", "title": "Mass and volume"},
                     "objective": {"id": "o1", "title": "Gross, tare, net"}, "language": "he"}
    for blob in (pack.to_prompt_json(), json.dumps(learn)):
        assert "questions" not in blob and "correct" not in blob.lower()


def test_missing_keys_are_tolerated():
    assert build_context_pack({}) == ContextPack()
    assert build_context_pack(None).language == "he"
    pack = build_context_pack({"component": {"id": "c", "unit_id": "u9"}, "unit": {"objective_id": "o9"}})
    assert pack.unit_id == "u9" and pack.objective_id == "o9" and pack.learning_description == ""
