"""Offline check of the Yuvilab-authored English catalog + lomda player.

Runs without a browser, without Kata and without a live session: it primes the
merged catalog, prints the coverage table the tender asks about, and drives the
player's own endpoints (scope, key stripping, grading).

    .venv/bin/python scripts/check_english_content.py
"""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.routes import content_player  # noqa: E402
from app.services import content_catalog, kata_catalog, native_content  # noqa: E402
from app.services.events import mint_launch  # noqa: E402

CONTENT_DIR = Path(__file__).resolve().parents[1] / "content" / "english"

AREA_TITLES = {
    "VOCAB": "Vocabulary range and control",
    "LISTEN": "Spoken reception",
    "READ": "Written reception",
    "GRAMMAR": "Grammar",
    "PHON": "Phonology, prosody and orthography",
    "SPEAK": "Spoken production",
    "WRITE": "Written production",
    "INTERACT": "Written interaction",
    "PRAGMA": "Pragmatics",
    "MEDIATE": "Mediating a text",
}


class _Request:
    def __init__(self, auth: str | None) -> None:
        self.headers = {"authorization": auth} if auth else {}


def _body(response) -> dict:
    return json.loads(bytes(response.body).decode())


def _ok(label: str, passed: bool, detail: str = "") -> bool:
    print(f"  {'PASS' if passed else 'FAIL'}  {label}{f' — {detail}' if detail else ''}")
    return passed


async def coverage() -> list[dict]:
    await kata_catalog.ensure_loaded(force=True)
    objectives = kata_catalog.objectives_for("english")
    print(f"\nEnglish spine — {len(objectives)} learning goals\n")
    print(f"  {'#':>2}  {'area':<10} {'goal':<44} {'components':>10}  {'levels':<28} assess")
    for objective in objectives:
        components = kata_catalog.components_for(objective["id"])
        area = objective["id"].rsplit(".", 1)[-1]
        levels = ",".join(sorted({str(c.get("mastery_level")) for c in components}))
        assess = sum(1 for c in components if c.get("is_assessment"))
        print(
            f"  {objective['order']:>2}. {area:<10} {objective['title'][:44]:<44}"
            f" {len(components):>10}  {levels:<28} {assess}"
        )
    cefr_matrix(objectives)
    return objectives


def cefr_matrix(objectives: list[dict]) -> None:
    """The pedagogical slide, generated from the content instead of asserted.

    One row per learning goal: the CEFR level and mode it was written against,
    the rungs its components actually span, the national-curriculum band/domain,
    and the international-exam task it rehearses.
    """
    print("\nCEFR coverage and curriculum alignment\n")
    header = (
        f"  {'area':<10} {'CEFR':<6} {'mode':<12} {'rungs':<12} "
        f"{'band':<11} {'domain':<22} exam task"
    )
    print(header)
    print("  " + "-" * (len(header) - 2))
    for objective in objectives:
        area = objective["id"].rsplit(".", 1)[-1]
        cefr = objective.get("cefr") or {}
        align = (objective.get("alignment") or {}).get("moe") or {}
        exams = (objective.get("alignment") or {}).get("exams") or []
        rungs = sorted(
            {str(c.get("cefr_level")) for c in kata_catalog.components_for(objective["id"])}
            - {"None"}
        )
        exam = f"{exams[0]['name']} — {exams[0].get('task', '')}" if exams else "—"
        print(
            f"  {area:<10} {str(cefr.get('level') or '—'):<6} {str(cefr.get('mode') or '—'):<12} "
            f"{'/'.join(rungs) or '—':<12} {str(align.get('band') or '—'):<11} "
            f"{str(align.get('domain') or '—'):<22} {exam}"
        )
    untagged = [o["id"] for o in objectives if not (o.get("cefr") or {}).get("level")]
    _ok("every English goal carries a CEFR level", not untagged, ", ".join(untagged))
    modes = {(o.get("cefr") or {}).get("mode") for o in objectives}
    _ok(
        "all four CEFR CV 2020 modes are represented",
        {"reception", "production", "interaction", "mediation"} <= modes,
        f"present: {', '.join(sorted(m for m in modes if m))}",
    )


async def structure(objectives: list[dict]) -> bool:
    print("\nStructure\n")
    passed = True
    covered = {o["id"].rsplit(".", 1)[-1] for o in objectives}
    missing = sorted(set(AREA_TITLES) - covered)
    passed &= _ok(
        f"all 10 נספח 2 areas covered ({len(covered & set(AREA_TITLES))}/10)",
        not missing,
        f"missing: {', '.join(missing)}" if missing else "",
    )

    units = [u for u in kata_catalog.all_units() if u.get("subject") == "english"]
    passed &= _ok("no English content fell through to subject='other'", bool(units))
    for unit in sorted(units, key=lambda u: u["id"]):
        if unit.get("is_summary"):
            # 720 §3.4 — the sub-topic summary unit is a review resource: no goal,
            # no practice, no assessment. Judging it by the goal-unit rules would
            # demand exactly what the spec forbids.
            _ok(f"{unit['id']}: sub-topic summary unit, exempt by §3.4", True)
            continue
        stages: dict[float, list[dict]] = {}
        for component in unit["components"]:
            stages.setdefault(float(component.get("order") or 0), []).append(component)
        equivalents = [c for group in stages.values() if len(group) > 1 for c in group]
        alt = None
        for component in unit["components"]:
            if component.get("recommended_after_fail"):
                alt = content_catalog.alternate_representation(
                    component["id"], component.get("objective_id")
                )
                if alt and alt.get("media_format") != component.get("media_format"):
                    break
                alt = None
        passed &= _ok(
            f"{unit['id']}: equivalent alternatives at one route position",
            bool(equivalents),
            f"{len(equivalents)} components share an order",
        )
        passed &= _ok(
            f"{unit['id']}: after-fail routes to a DIFFERENT representation",
            bool(alt),
            f"→ {alt['component_id']} ({alt['media_format']})" if alt else "none found",
        )
        passed &= _ok(
            f"{unit['id']}: has an assessment component",
            any(c.get("is_assessment") for c in unit["components"]),
        )
    return await framing() and passed


_CHOICE_TYPES = {"single-choice", "true-false", "fill-in"}


def _key_problem(question: dict) -> str:
    """Why this question's key cannot grade it, or "" if it can.

    The rule used to be "exactly one key, and it appears in the options", which
    is right for a question you pick an answer to and wrong for the two that you
    do not: matching carries one key per pair, and free typing carries every
    spelling worth accepting and no options at all.
    """
    keys = list(question.get("correctAnswers") or [])
    answers = list(question.get("answers") or [])
    kind = str(question.get("questionType") or "")

    if kind in _CHOICE_TYPES:
        if len(keys) != 1:
            return f"{kind} needs exactly one key, has {len(keys)}"
        if keys[0] not in answers:
            return f"key {keys[0]!r} is not one of the options"
        return ""

    if kind == "match":
        prompts = [str(p.get("id")) for p in question.get("prompts") or [] if p.get("id")]
        pairs = dict(
            (part.strip(), answer)
            for key in keys
            for part, _, answer in [str(key).partition("=")]
        )
        if len(pairs) != len(keys):
            return "two keys pair the same prompt"
        if sorted(pairs) != sorted(prompts):
            return f"keys cover {sorted(pairs)}, prompts are {sorted(prompts)}"
        stray = [a for a in pairs.values() if a not in answers]
        if stray:
            # A pair whose answer is not on offer can never be built, so the
            # question would be unanswerable rather than hard.
            return f"paired answers not among the options: {stray}"
        return ""

    if kind == "text-entry":
        if not keys:
            return "free typing needs at least one accepted spelling"
        if answers:
            return "free typing must not offer options"
        graded = {content_player._normalize_typed(k) for k in keys}
        if len(graded) != len(keys):
            return "two accepted spellings are the same answer once normalized"
        return ""

    return f"unknown questionType {kind!r}"


def schema() -> bool:
    """Validate every authored unit against the authoring contract.

    This is the only check that runs before anything is loaded, because a unit
    that breaks the schema is a unit whose failure downstream would show up as
    something else entirely — a blank screen, a silently skipped self-check.
    """
    print("\nAuthoring schema\n")
    from jsonschema import Draft202012Validator

    schema_path = CONTENT_DIR / "schema" / "unit.schema.json"
    document = json.loads(schema_path.read_text(encoding="utf-8"))
    Draft202012Validator.check_schema(document)
    validator = Draft202012Validator(document)

    passed = True
    for unit in sorted((CONTENT_DIR / "units").glob("*.json")):
        errors = sorted(validator.iter_errors(json.loads(unit.read_text(encoding="utf-8"))),
                        key=lambda e: list(e.absolute_path))
        passed &= _ok(
            f"{unit.name} matches unit.schema.json",
            not errors,
            "; ".join(
                f"{'/'.join(str(p) for p in e.absolute_path)}: {e.message[:90]}"
                for e in errors[:3]
            ),
        )
    return passed


def media() -> bool:
    """Every referenced image exists on disk, and every picture option is real.

    An image referenced but not committed is invisible in review — the alt text
    renders and the screen still looks deliberate — and then ships as a broken
    box to a learner who may have no other route into the question.
    """
    print("\nImagery\n")
    passed = True
    assets = CONTENT_DIR / "assets"
    illustrated = 0
    for unit_path in sorted((CONTENT_DIR / "units").glob("*.json")):
        unit = json.loads(unit_path.read_text(encoding="utf-8"))
        missing: list[str] = []
        orphan: list[str] = []
        count = 0
        for component in unit.get("components") or []:
            for item in component.get("subContent") or []:
                nodes = [(item.get("presentation") or {}).get("image")]
                for question in item.get("questions") or []:
                    nodes.append(question.get("image"))
                    answers = question.get("answers") or []
                    for answer, node in (question.get("answerMedia") or {}).items():
                        nodes.append(node)
                        if answer not in answers:
                            orphan.append(f"{item['id']}/{question.get('questionId')}: {answer!r}")
                for node in nodes:
                    if not isinstance(node, dict):
                        continue
                    if not node.get("src"):
                        # Declared but never drawn. Skipping these quietly is how
                        # ten generated files once sat in the tree with nothing
                        # pointing at them and every screen still blank.
                        if node.get("prompt"):
                            count += 1
                            missing.append(f"{item['id']}: declared, not generated")
                        continue
                    count += 1
                    if not (assets / str(node["src"])).is_file():
                        missing.append(f"{item['id']}: {node['src']}")
        if not count and not orphan:
            continue
        illustrated += 1
        passed &= _ok(f"{unit_path.name}: {count} image(s) present on disk", not missing,
                      "; ".join(missing[:3]))
        passed &= _ok(f"{unit_path.name}: every picture option names a real answer",
                      not orphan, "; ".join(orphan[:3]))
    if not illustrated:
        # Said out loud, because a section that prints nothing reads as a
        # section that passed rather than one that had nothing to look at.
        print("  ----  no unit references an image yet")
    return passed


async def framing() -> bool:
    """720 §1.4 — a learner must be told what is starting and what just ended."""
    print("\nOpening and closing messages (נספח 1 §1.4)\n")
    passed = True
    for unit in sorted(
        (u for u in kata_catalog.all_units() if u.get("subject") == "english"),
        key=lambda u: u["id"],
    ):
        raw = await native_content.get_raw_unit(unit["id"])
        for component in raw["components"]:
            items = component.get("subContent") or []
            kinds = [(i.get("presentation") or {}).get("kind") for i in items]
            passed &= _ok(
                f"{component['id']}: opens with an opening card",
                kinds[:1] == ["intro"],
                f"opens on {kinds[0]!r}" if kinds[:1] != ["intro"] else "",
            )
            if component.get("isAssessment"):
                passed &= _ok(
                    f"{component['id']}: closes with a closing card",
                    kinds[-1:] == ["summary"],
                    f"closes on {kinds[-1]!r}" if kinds[-1:] != ["summary"] else "",
                )
            broken = [
                f"{i['id']}/{q.get('questionId')}: {why}"
                for i in items for q in i.get("questions") or []
                if (why := _key_problem(q))
            ]
            passed &= _ok(
                f"{component['id']}: every question's key fits its question type",
                not broken,
                "; ".join(broken[:3]),
            )
            passed &= _ok(
                f"{component['id']}: every item carries bot context",
                all(str(i.get("informationToBot") or "").strip() for i in items),
            )
    return passed


async def player() -> bool:
    print("\nPlayer\n")
    passed = True
    units = [u for u in kata_catalog.all_units() if u.get("subject") == "english"]
    component = next(
        c for u in units for c in u["components"]
        if not c.get("is_assessment") and c.get("question_ids")
    )
    unit = next(u for u in units if any(c["id"] == component["id"] for c in u["components"]))

    launch = mint_launch(
        "content-check", objective_id=unit["objective_id"], component_id=component["id"],
        unit_id=unit["id"], subject="english", source=native_content.SOURCE,
    )
    auth = launch["slxapi"]["auth"]
    cid = component["id"]

    passed &= _ok("payload without a token is rejected",
                  (await content_player.player_payload(cid, _Request(None))).status_code == 401)
    other = next(c["id"] for u in units for c in u["components"] if c["id"] != cid)
    passed &= _ok("a token for another component is rejected",
                  (await content_player.player_payload(other, _Request(auth))).status_code == 401)

    response = await content_player.player_payload(cid, _Request(auth), lang="he")
    payload = _body(response)
    passed &= _ok("payload served", response.status_code == 200)
    passed &= _ok("response is embeddable",
                  "frame-ancestors" in (response.headers.get("content-security-policy") or ""),
                  response.headers.get("content-security-policy"))

    raw = json.dumps(payload, ensure_ascii=False)
    passed &= _ok("answer key never reaches the browser", "correctAnswers" not in raw)
    passed &= _ok("per-answer feedback copy never reaches the browser", '"feedback"' not in raw)
    passed &= _ok("bot notes never reach the browser", "informationToBot" not in raw)

    item = next(i for i in payload["items"] if i["questions"])
    question = item["questions"][0]
    resolved = await native_content.get_raw_component(cid, unit["id"])
    key = next(
        q["correctAnswers"][0]
        for i in resolved[1]["subContent"] if i["id"] == item["id"]
        for q in i["questions"] if q["questionId"] == question["questionId"]
    )
    wrong = next(a for a in question["answers"] if a != key)

    for answer, expected in ((key, True), (wrong, False)):
        verdict = _body(await content_player.player_answer(
            cid,
            content_player.AnswerRequest(
                itemId=item["id"], questionId=question["questionId"], response=answer
            ),
            _Request(auth),
        ))
        passed &= _ok(
            f"grading {'correct' if expected else 'wrong'} answer",
            verdict["correct"] is expected,
            (verdict["feedback"].get("he") or "")[:70],
        )
    return passed


def grading() -> bool:
    """The two new answer shapes, graded directly against the marker.

    These run on constructed questions rather than authored ones so the rules
    are pinned before any content depends on them — and so the cases that matter
    (a right pairing built in a different order, a phone's curly apostrophe) are
    covered whether or not a unit happens to contain one.
    """
    print("\nGrading rules\n")
    passed = True
    grade = content_player._grade

    match = {
        "questionType": "match",
        "prompts": [{"id": "p1", "text": "mother"}, {"id": "p2", "text": "father"}],
        "answers": ["אמא", "אבא"],
        "correctAnswers": ["p1=אמא", "p2=אבא"],
    }
    for label, response, expected in (
        ("all pairs right", "p1=אמא|p2=אבא", True),
        ("same pairs, built in the other order", "p2=אבא|p1=אמא", True),
        ("one pair swapped", "p1=אבא|p2=אמא", False),
        ("a pair left unbuilt", "p1=אמא", False),
    ):
        verdict, detail = grade(match, response)
        passed &= _ok(f"match — {label}", verdict is expected, f"detail={detail}")
    _verdict, detail = grade(match, "p1=אמא|p2=אמא")
    passed &= _ok(
        "match — the verdict says WHICH pair was wrong",
        detail == {"p1": True, "p2": False}, str(detail),
    )

    typed = {
        "questionType": "text-entry",
        "answers": [],
        "correctAnswers": ["my father's mother", "my grandmother"],
    }
    for label, response, expected in (
        ("exact", "my father's mother", True),
        ("a phone's curly apostrophe", "my father’s mother", True),
        ("shouting, and a full stop", "  MY FATHER'S MOTHER.  ", True),
        ("the second accepted spelling", "My Grandmother", True),
        ("a different word", "my mother", False),
        ("a misspelling is still wrong", "my grandmothr", False),
    ):
        verdict, _detail = grade(typed, response)
        passed &= _ok(f"text-entry — {label}", verdict is expected, repr(response))

    passed &= _ok(
        "an unanswerable question grades as neither right nor wrong",
        grade({"questionType": "single-choice", "correctAnswers": []}, "x")[0] is None,
    )
    return passed


async def main() -> int:
    schema_ok = schema()
    media_ok = media()
    objectives = await coverage()
    structure_ok = await structure(objectives)
    player_ok = await player() and grading()
    passed = schema_ok and media_ok and structure_ok and player_ok
    print(f"\n{'ALL CHECKS PASSED' if passed else 'SOME CHECKS FAILED'}\n")
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
