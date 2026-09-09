import json

from game_gen.context_pack import build_context_pack, split_question_id


def _component():
    return {
        "id": "c1",
        "unit_id": "u1",
        "title": "  Mass   and volume ",
        "purpose": "practice",
        "information_to_bot": "x" * 5000,
        "questions_by_item": {
            "item-a": [
                {"questionId": "q1", "questionType": "choice", "questionText": "What is mass?", "answers": ["A", "B"], "correctAnswers": ["A"]},
                {"questionId": "q2", "questionType": "open", "questionText": "Explain", "answers": [], "correctAnswers": ["anything"]},
            ],
            "item-b": [
                {"questionId": "q1", "questionType": "choice", "questionText": "Pick", "answers": ["C", "D"], "correctAnswers": ["D"]},
                {"questionId": "q3", "questionType": "choice", "questionText": "No key", "answers": ["E"], "correctAnswers": []},
            ],
        },
    }


def test_ids_are_item_scoped_and_key_matches():
    pack, key = build_context_pack(_component(), {"id": "u1", "title": "Unit", "objective_id": "o1", "subject": "science"}, {"title": "Obj"})
    ids = [q.id for q in pack.questions]
    assert ids == ["item-a#q1", "item-a#q2", "item-b#q1"]  # keyless dropped; a keyed open question is typed
    assert set(key.correct) == set(ids)
    assert key.correct["item-b#q1"] == ["D"]
    assert split_question_id("item-b#q1") == ("item-b", "q1")


def test_prompt_json_has_no_answer_key_and_is_bounded():
    pack, key = build_context_pack(_component())
    blob = pack.to_prompt_json()
    data = json.loads(blob)
    assert "correct" not in blob.lower()
    assert len(data["teaching_notes"]) == 1800
    assert data["component"]["title"] == "Mass and volume"
    learn = pack.to_learn_data()
    assert [q["id"] for q in learn["questions"]] == ["item-a#q1", "item-a#q2", "item-b#q1"]
    assert [q["type"] for q in learn["questions"]] == ["choice", "text", "choice"]
    assert "correct" not in json.dumps(learn).lower()


def test_max_questions_cap():
    comp = _component()
    comp["questions_by_item"] = {f"i{n}": [{"questionId": "q1", "questionText": f"Q{n}", "answers": ["a", "b"], "correctAnswers": ["a"]}] for n in range(20)}
    pack, key = build_context_pack(comp, max_questions=5)
    assert len(pack.questions) == 5 and len(key.correct) == 5


def test_question_kinds_choice_needs_a_wrong_option_and_typed_needs_only_a_key():
    from game_gen.context_pack import build_context_pack
    component = {"id": "c", "questions_by_item": {"i": [
        {"questionId": "bare", "questionType": "choice", "questionText": "בודד", "answers": ["(2,3)"], "correctAnswers": ["(2,3)"]},
        {"questionId": "opts", "questionType": "choice", "questionText": "עם אפשרויות", "answers": ["AB", "CD"], "correctAnswers": ["AB"]},
        {"questionId": "drag", "questionType": "matching", "questionText": "גררו", "answers": ["{'source': ['A']}"], "correctAnswers": ["{'source': 'A'}"]},
        {"questionId": "num", "questionType": "numeric", "questionText": "כמה", "answers": [], "correctAnswers": ["5"]},
        {"questionId": "fill", "questionType": "fill-in", "questionText": "השלימו", "answers": ["4,4"], "correctAnswers": ["4,4"]},
        {"questionId": "nokey", "questionType": "other", "questionText": "פתוח", "answers": ["x"], "correctAnswers": []},
    ]}}
    pack, key = build_context_pack(component)
    kinds = {q.id.split("#")[1]: (q.type, q.answers) for q in pack.questions}
    assert kinds == {"opts": ("choice", ["AB", "CD"]), "num": ("text", []), "fill": ("text", [])}
    assert key.correct == {"i#opts": ["AB"], "i#num": ["5"], "i#fill": ["4,4"]}
