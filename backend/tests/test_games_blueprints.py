"""Question blueprints: the DSL is data we evaluate safely, figures render
and describe themselves, instances are drawn per run and graded on the
server, and the routes hand the page a question without its answer."""

from __future__ import annotations

import asyncio
import json
import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.games import blueprint_dsl as dsl  # noqa: E402
from app.services.games import blueprints, figures, instances, store  # noqa: E402
from tests.games_support import (  # noqa: E402
    BLUEPRINT, COMP, CREATE_BODY, LEARNER, GamesHarness, app_for, blueprint_docs,
)


def run(coro):
    return asyncio.run(coro)


COORDS = {
    "skill": "coordinates of a point", "interaction": "choice",
    "params": {"x": {"int": [1, 9]}, "y": {"int": [1, 9]}, "obj": {"theme": "object", "default": "מזרקה"}},
    "constraints": ["x != y"],
    "stem": "מהם שיעורי ה{obj}?", "answer": "({x},{y})", "accept": ["({x}, {y})"],
    "distractors": ["({y},{x})", "({x},{y+1})", "({x+1},{y})"],
    "figure": {"frame": {"axes": {"x": [0, 10], "y": [0, 10]}},
               "items": [{"kind": "icon", "at": ["x", "y"], "icon": "obj"},
                         {"kind": "point", "at": [1, 1], "label": "A", "target": "A"},
                         {"kind": "point", "at": [8, 2], "label": "B", "target": "B"}]},
}


class DslTests(unittest.TestCase):
    def test_expressions_are_arithmetic_only(self):
        env = {"x": 4, "y": 3}
        self.assertEqual(dsl.safe_eval("x + y * 2", env), 10)
        self.assertEqual(dsl.fill("({x},{y+1})", env), "(4,4)")
        for bad in ("__import__('os')", "x.__class__", "open('f')", "(lambda: 1)()", "[1][0]"):
            with self.assertRaises(dsl.DslError, msg=bad):
                dsl.safe_eval(bad, env)
        with self.assertRaises(dsl.DslError):
            dsl.safe_eval("z + 1", env)  # unknown names never resolve

    def test_instances_are_seeded_and_vary(self):
        a, b, c = (dsl.instantiate(COORDS, seed) for seed in ("s1", "s1", "s2"))
        self.assertEqual(a["text"], b["text"])
        self.assertEqual(a["answer"], b["answer"])
        self.assertNotEqual(a["params"]["x"], a["params"]["y"])
        self.assertIn(a["answer"], a["options"])
        self.assertEqual(len(a["options"]), 4)
        self.assertEqual(len(set(a["options"])), 4)
        self.assertIn("מזרקה", a["text"])
        self.assertTrue(a["alt"].startswith("Coordinate grid"))
        self.assertTrue(any(inst["answer"] != a["answer"] for inst in (c, dsl.instantiate(COORDS, "s3"))))

    def test_theme_vocab_reskins_slots_and_icons(self):
        inst = dsl.instantiate(COORDS, "s1", {"object": {"noun": "אסטרואיד", "icon": "☄️"}})
        self.assertIn("אסטרואיד", inst["text"])
        self.assertEqual(inst["figure"]["items"][0]["icon"], "☄️")

    def test_validation_catches_what_would_break_a_game(self):
        self.assertEqual(dsl.validate_blueprint(COORDS), [])
        few = dict(COORDS, distractors=["({y},{x})"])
        self.assertTrue(any("distractors" in e for e in dsl.validate_blueprint(few)))
        off = dict(COORDS, params={**COORDS["params"], "x": {"int": [1, 30]}})
        self.assertTrue(any("outside the frame" in e for e in dsl.validate_blueprint(off)))
        fixed = dict(COORDS, params={"obj": {"theme": "object"}}, stem="קבוע", answer="1", accept=[], distractors=["2", "3", "4"],
                     constraints=[], figure=None)
        self.assertTrue(any("never change" in e for e in dsl.validate_blueprint(fixed)))
        hotspot = dict(COORDS, interaction="hotspot", answer="A", distractors=[])
        self.assertEqual([e for e in dsl.validate_blueprint(hotspot) if "hotspot" in e], [])
        bad_target = dict(hotspot, answer="Z")
        self.assertTrue(any("not a target" in e for e in dsl.validate_blueprint(bad_target)))


class PhrasingTests(unittest.TestCase):
    def test_messy_stems_are_rejected_by_code(self):
        cases = {
            "השלימו לפי נטו + טרה = ברוטו: צנצנת ברוטו=?, בקבוק טרה=?, מזוודה נטו=?": "fill-in",
            "מהי טרה? סמנו את שני הפריטים שהם טרה בלבד.": "several",
            "מה רואים בתמונה?": "picture",
            "מהו הנטו? ומהו הברוטו?": "more than one question",
        }
        for stem, expected in cases.items():
            problems = dsl.stem_problems(stem, has_figure=False)
            self.assertTrue(any(expected in p for p in problems), (stem, problems))
        self.assertEqual(dsl.stem_problems("מהם שיעורי הנקודה A?", has_figure=True), [])
        self.assertEqual(dsl.stem_problems("בתמונה רואים צנצנת. מהי הטרה?", has_figure=True), [])

    def test_numeric_text_answers_need_numbers_on_screen(self):
        guess = {"interaction": "text", "params": {"a": {"int": [1, 9]}}, "stem": "מהו הברוטו?", "answer": "{a}", "figure": None}
        self.assertTrue(any("no numbers" in e for e in dsl.validate_blueprint(guess)))
        shown = dict(guess, stem="הטרה {a} ק\"ג והנטו 2 ק\"ג. מהו הברוטו?", answer="{a+2}")
        self.assertEqual(dsl.validate_blueprint(shown), [])


class FigureTests(unittest.TestCase):
    def test_graphic_renders_svg_with_targets_and_alt(self):
        inst = dsl.instantiate(COORDS, "s1")
        out = figures.render(inst["figure"])
        self.assertEqual(out["kind"], "svg")
        self.assertIn('data-yuvi-figure="1"', out["html"])
        self.assertIn('data-target="A"', out["html"])
        self.assertIn("point A at (1,1) [target A]", out["alt"])
        self.assertEqual(figures.targets(inst["figure"]), ["A", "B"])

    def test_text_and_table_figures_are_html_and_escaped(self):
        text = figures.render({"text": "הילד <b>רץ</b> בגן", "spans": [{"text": "רץ", "mark": "highlight", "target": "t1"}]})
        self.assertEqual(text["kind"], "html")
        self.assertNotIn("<b>", text["html"])
        self.assertIn('data-target="t1"', text["html"])
        table = figures.render({"table": {"rows": [["a", "b"], ["1", "2"]], "header": True}})
        self.assertIn("<th", table["html"])
        self.assertIn("Table: a, b / 1, 2", table["alt"])


class InstanceTests(unittest.TestCase):
    def test_normaliser_treats_equivalent_answers_alike(self):
        self.assertEqual(instances.normalize("(4, 3)"), instances.normalize("(4,3)"))
        self.assertEqual(instances.normalize("4.0"), instances.normalize("4"))
        self.assertEqual(instances.normalize("٤"), instances.normalize("4"))
        self.assertEqual(instances.normalize("שָׁלוֹם"), instances.normalize("שלום"))
        self.assertNotEqual(instances.normalize("(3,4)"), instances.normalize("(4,3)"))
        self.assertTrue(instances.matches("5 ק\"ג", ["5 ק\"ג", "5"]))


class RouteTests(unittest.TestCase):
    def setUp(self):
        self.harness = GamesHarness().__enter__()
        from fastapi.testclient import TestClient
        self.client = TestClient(app_for())

    def tearDown(self):
        self.harness.__exit__(None, None, None)

    def _create(self):
        response = self.client.post("/api/games", json=CREATE_BODY)
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    def test_create_sizes_the_run_and_the_job_carries_fixtures_not_kata_rows(self):
        created = self._create()
        game = run(store.get_game(created["game_id"]))
        self.assertEqual(game["question_mode"], "blueprints")
        self.assertEqual(game["question_total"], blueprints.run_total(2))
        job = run(store.latest_job(created["game_id"]))
        bundle = job["payload"]["blueprints"]
        self.assertEqual(len(bundle["fixtures"]), game["question_total"])
        self.assertEqual({s["skill"] for s in bundle["summaries"]}, {"read the mass off a balance", "write a mass"})
        fixture = bundle["fixtures"][0]
        self.assertNotIn("answer", fixture)
        self.assertIn(fixture["id"], bundle["key"])
        self.assertTrue(all(len(v) >= 1 for v in bundle["key"].values()))

    def test_next_draws_a_question_without_its_answer_and_check_grades_it(self):
        gid = self._create()["game_id"]
        first = self.client.post(f"/api/games/{gid}/next", json={"run_id": "run-a", "index": 0}).json()["question"]
        again = self.client.post(f"/api/games/{gid}/next", json={"run_id": "run-a", "index": 0}).json()["question"]
        other = self.client.post(f"/api/games/{gid}/next", json={"run_id": "run-b", "index": 0}).json()["question"]
        self.assertTrue(first["id"].startswith("qi-"))
        self.assertEqual(first["text"], again["text"], "same run + index → same draw")
        self.assertNotIn("answer", first)
        self.assertNotIn("accept", first)
        self.assertEqual(first["total"], blueprints.run_total(2))
        self.assertIsNotNone(other)
        past_end = self.client.post(f"/api/games/{gid}/next", json={"run_id": "run-a", "index": 99}).json()
        self.assertIsNone(past_end["question"])

        row = store._memory_instances[first["id"]]
        right = self.client.post(f"/api/games/{gid}/check", json={"question_id": first["id"], "answer": row["answer"]}).json()
        self.assertTrue(right["correct"])
        wrong = self.client.post(f"/api/games/{gid}/check", json={"question_id": first["id"], "answer": "nope"}).json()
        self.assertFalse(wrong["correct"])
        self.assertEqual(wrong["correct_answer"], row["answer"])
        answers = run(store.list_answers(gid, LEARNER))
        self.assertEqual([a["correct"] for a in answers], [True, False])
        self.assertEqual(answers[0]["blueprint_id"], row["blueprint_id"])
        self.assertEqual(answers[0]["instance_id"], first["id"])

    def test_next_refuses_a_legacy_game_and_a_foreign_instance(self):
        gid = self._create()["game_id"]
        run(store.update_game(gid, question_mode="legacy"))
        self.assertEqual(self.client.post(f"/api/games/{gid}/next", json={"run_id": "r", "index": 0}).status_code, 409)
        self.assertEqual(self.client.post(f"/api/games/{gid}/check", json={"question_id": "qi-nope", "answer": "x"}).status_code, 404)

    def test_prepare_answers_with_the_cache_and_generation_runs_behind(self):
        response = self.client.post("/api/games/prepare", json={"component_id": COMP})
        self.assertEqual(response.status_code, 202)
        self.assertEqual(response.json(), {"ready": True, "usable": 2})
        self.assertEqual(self.client.post("/api/games/prepare", json={"component_id": "nope"}).status_code, 404)


class GenerationTests(unittest.TestCase):
    """The model is mocked; what is tested is the validate → repair → judge
    ladder and the statuses it produces."""

    def test_generation_validates_repairs_and_judges(self):
        good = dict(BLUEPRINT)
        broken = dict(BLUEPRINT, skill="broken one", distractors=["{m} ק\"ג"])  # no distinct distractors
        first = json.dumps({"blueprints": [good, broken]})
        repaired = json.dumps({"blueprints": [dict(broken, distractors=["{m+2}", "{m+3}", "{m+4}"])]})
        judge = json.dumps({"answer": "5 ק\"ג", "answerable": True, "reason": "clear"})
        replies = [first, repaired, judge, judge]

        async def fake_llm(messages, **kwargs):
            return replies.pop(0)

        with patch("app.brain.repository._get_collection_named", return_value=None), \
             patch.object(blueprints, "call_llm", AsyncMock(side_effect=fake_llm)), \
             patch.object(blueprints, "_judge", AsyncMock(return_value={"answerable": True, "agrees": True, "answer": "", "reason": ""})):
            docs = run(blueprints.ensure_blueprints({"id": COMP, "title": "מסה", "questions_by_item": {
                "i": [{"questionId": "q1", "questionType": "choice", "questionText": "כמה?", "answers": ["5"], "correctAnswers": ["5"]}]}}))
        self.assertEqual([d["status"] for d in docs], ["ok", "ok"])
        self.assertEqual(docs[1]["blueprint"]["distractors"], ["{m+2}", "{m+3}", "{m+4}"])
        self.assertTrue(docs[0]["_id"].startswith(f"bp:{COMP}|"))

    def test_fixtures_and_summaries_come_from_usable_docs_only(self):
        docs = blueprint_docs() + [{"_id": "bad", "status": "unusable", "blueprint": None}]
        questions, key = blueprints.fixtures(docs, 4)
        self.assertEqual(len(questions), 4)
        self.assertEqual(set(key), {q["id"] for q in questions})
        self.assertEqual(len(blueprints.summaries(docs)), 2)
        self.assertEqual(blueprints.run_total(0), 0)
        self.assertEqual(blueprints.run_total(1), 6)
        self.assertEqual(blueprints.run_total(9), 12)


if __name__ == "__main__":
    unittest.main()
