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
    return objectives


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
    for unit in units:
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


async def main() -> int:
    objectives = await coverage()
    structure_ok = await structure(objectives)
    player_ok = await player()
    passed = structure_ok and player_ok
    print(f"\n{'ALL CHECKS PASSED' if passed else 'SOME CHECKS FAILED'}\n")
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
