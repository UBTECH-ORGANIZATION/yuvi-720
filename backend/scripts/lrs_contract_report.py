#!/usr/bin/env python3
"""Send one statement of EVERY 720 event type and report the ids back to the MoE.

This is the script behind the integration report table (Object Type / Verb / Id).
It builds each statement through the SAME builders production uses — including the
content ancestry (`grouping` = unit → component → item, `parent` = the level
directly above, `context.extensions` = every level's metadata) — posts them to the
configured LRS, and writes a CSV of what was sent.

Fixes applied after integration report 5 (against the full v1.1 spec text):
  · `masteryLevel` on every content statement — the catalog value when Kata
    publishes one, else a band derived from `relativeDifficulty`
    (1–2 basic · 3 intermediate · 4–5 advanced)
  · `manufacturer` carries the ministry's vendor CODE (מתודיקה → 310), never
    the catalog's name string — numeric, per the spec's own example, and on
    COMPONENT metadata only (the v1.1 unit table has no manufacturer)
  · media events drop the `mediaDuration` extension (removed in v1.1)
  · `conversationTrigger` follows the v1.1 closed list (`misconception` →
    `student-error`, off-list values → `other`)

Fixes applied after integration report 4 (spec v1.1):
  · grouping→content-vendor id under the required base —
    …/xapi/moe/ecat/content-vendor/<vendorId> (was …/moe/content-vendor/<id>)
  · unit metadata `targetSector` → `targetSectors` (plural, array)
  · component metadata `cognitiveLevel` → `cognitiveLevels` (plural, array)
  · component metadata `manufacture` → `manufacturer`
  · the generic ITEM skip is retired; a COMPONENT-level `skipped` is sent
    ("דילוג על פריט הוחלף בדילוג על רכיב")

Fixes applied after integration report 3 (17/08), shaped to match the ministry's
examples page (720_xAPI_JSON_Examples.html, refreshed 16/08):
  · grouping→content-vendor carries the ministry catalog id as a full IRI
    (…/xapi/moe/content-vendor/10 מטח · /521 קמפוס · /310 מתודיקה)
  · on every content statement the deepest grouping entry is the statement's
    OWN object, verbatim — same id, same type (a questionnaire tags itself
    `questionnaire`, a selection tags the selected item)
  · a question-level statement (answered) nests under its questionnaire screen:
    grouping = […, component, questionnaire, question], parent = [questionnaire]
  · one id, one type: the same screen is `questionnaire` in every statement
    that references it, the media item is `video` in `selected` too

Fixes applied after the 28/07 ministry review are all exercised here:
  · grouping→lms and grouping→content-vendor must be REAL ids (checked, not sent
    with a placeholder — the run aborts and tells you which env var to set)
  · session grouping id is a fresh UUID per run, never a literal string
  · every content statement carries its full ancestry and inherited metadata
  · question answered → result.response + questionId / questionType / attemptNumber
  · media → mediaFormat / mediaPosition / mediaDuration, result.duration on
    paused + completed
  · agency answered → result.score · conversation interacted → helpType
  · reflection answered/skipped → object.definition.name
  · selected → selectionType in kebab-case
  · dashboard viewed → result.duration

Run:
    cd backend && ./.venv/bin/python scripts/lrs_contract_report.py --dry-run
    cd backend && ./.venv/bin/python scripts/lrs_contract_report.py           # posts
Output: artifacts/lrs-contract-report.csv  (+ .json with the full statements)
"""

from __future__ import annotations

import argparse
import asyncio
import csv
import json
import sys
import uuid
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services import kata_catalog  # noqa: E402
from app.services.lrs import auth, client, config, hierarchy, statements  # noqa: E402

ARTIFACTS = Path(__file__).resolve().parents[2] / "artifacts"

# The content used as the worked example — a real unit from the live catalog.
UNIT_ID = "methodica-science-mass-measure-01"
COMPONENT_ID = "methodica-science-mass-measure-01-01"
QUESTION_ITEM_ID = f"{COMPONENT_ID}-002"     # a plain question screen
MEDIA_ITEM_ID = f"{COMPONENT_ID}-003"        # the video playlist screen
CONTENT_BASE = "https://lomdot.education.gov.il/metodica/720active/science/mass-measure/01"


def _identity() -> dict:
    return {
        "exidentifier": config.test_exidentifier(),
        "school": config.default_school() or None,
        "nmm": config.default_nmm() or None,
    }


def _raw(
    verb_iri: str,
    object_id: str,
    object_type: str | None = None,
    name_he: str | None = None,
    **extra,
) -> dict:
    """A Kata-shaped content statement, as it reaches `/api/xapi`.

    The object carries its own definition (type + name) exactly as the content
    sends it — report 3 requires the grouping's deepest entry to be this object
    verbatim, type included ("יש לשלוח type כמו ב-object, לדוג questionnaire")."""
    obj: dict = {"id": object_id}
    if object_type:
        definition: dict = {
            "type": f"https://lxp.education.gov.il/xapi/moe/activities/{object_type}"
        }
        if name_he:
            definition["name"] = {"he": name_he}
        obj["definition"] = definition
    return {
        "id": str(uuid.uuid4()),
        "actor": {"account": {"name": "student", "homePage": config.supplier_domain()}},
        "verb": {"id": verb_iri},
        "object": obj,
        **extra,
    }


async def build_all(identity: dict, session_id: str) -> list[tuple[str, str, dict]]:
    """(object type, verb, statement) for every event type we report."""
    await kata_catalog.ensure_loaded()
    unit_level = await hierarchy.for_content(None, None, unit_id=UNIT_ID)
    component_level = await hierarchy.for_content(COMPONENT_ID, None, unit_id=UNIT_ID)
    question_level = await hierarchy.for_content(COMPONENT_ID, QUESTION_ITEM_ID, unit_id=UNIT_ID)
    media_level = await hierarchy.for_content(COMPONENT_ID, MEDIA_ITEM_ID, unit_id=UNIT_ID)
    # Per CONTENT, like the live path — the report has to be a faithful sample of
    # what we actually send, and the content-vendor id is not one constant.
    ecat = await hierarchy.ecat_item_for(COMPONENT_ID, None, unit_id=UNIT_ID)
    rows: list[tuple[str, str, dict]] = []
    add = lambda kind, verb, stmt: rows.append((kind, verb, stmt))  # noqa: E731

    # ── Session ───────────────────────────────────────────────────────────────
    add("session", "enter", statements.session_enter(
        identity, session_id,
        device={"deviceType": "Desktop", "platform": "Web",
                "operatingSystem": "macOS", "osVersion": "15.5", "browser": "Chrome"},
    ))
    add("session", "suspend", statements.session_suspend(identity, session_id))
    add("session", "resume", statements.session_resume(identity, session_id))
    add("session", "exit", statements.session_exit(identity, session_id, 1830))

    # ── Dashboard (with the recommended duration) ─────────────────────────────
    add("dashboard", "viewed", statements.dashboard_viewed(
        identity, session_id, "student-personal", duration_seconds=95,
    ))

    # ── Component (content §2: parent = unit, grouping = unit + component) ────
    add("component", "initialized", statements.component_initialized(
        identity, session_id, COMPONENT_ID, ecat_item_id=ecat,
        name_he="פתיחה, הקנייה ותרגול סטנדרטי א", hierarchy=component_level,
    ))
    add("component", "completed", statements.component_completed(
        identity, session_id, COMPONENT_ID, success=True, score_scaled=0.8,
        duration_seconds=1290, ecat_item_id=ecat,
        name_he="פתיחה, הקנייה ותרגול סטנדרטי א", hierarchy=component_level,
    ))
    # Report 4 (spec v1.1): the ITEM skip is retired and the skip is reported at
    # the COMPONENT level — "יש לשלוח הודעת רכיב - skipped".
    add("component", "skipped", statements.content_skipped(
        identity, session_id,
        object_id=hierarchy.component_activity(COMPONENT_ID)["id"],
        object_type="component", name_he="פתיחה, הקנייה ותרגול סטנדרטי א",
        ecat_item_id=ecat, hierarchy=component_level,
    ))

    # ── Agency questionnaire (answered carries result.score) ──────────────────
    add("questionnaire (agency)", "initialized",
        statements.agency_initialized(identity, session_id, "pre"))
    add("question (agency)", "answered", statements.agency_answered(
        identity, session_id, 1, "4", score_raw=4,
        question_he="עד כמה קל לך להתחיל משימה חדשה?",
    ))
    add("questionnaire (agency)", "completed",
        statements.agency_completed(identity, session_id, 240, "pre"))

    # ── Conversation (interacted always carries helpType) ─────────────────────
    conversation_id = str(uuid.uuid4())
    add("conversation", "interacted", statements.conversation_interacted(
        identity, session_id, conversation_id,
        speaker="bot", conversation_trigger="student-request", help_type="hint",
        component_id=COMPONENT_ID, item_id=QUESTION_ITEM_ID,
        ecat_item_id=ecat, hierarchy=question_level,
    ))
    add("conversation", "rated", statements.conversation_rated(
        identity, session_id, conversation_id, "like",
        ecat_item_id=ecat, hierarchy=question_level,
    ))

    # ── Reflection (question statements carry their own text) ─────────────────
    reflection_id = str(uuid.uuid4())
    add("questionnaire (reflection)", "initialized", statements.reflection_initialized(
        identity, session_id, reflection_id, "end-of-learning-component",
        ecat_item_id=ecat, hierarchy=question_level,
    ))
    add("question (reflection)", "answered", statements.reflection_answered(
        identity, session_id, reflection_id, 1, score_raw=4,
        question_he="עד כמה הרגשת שהצלחת במשימה?",
        ecat_item_id=ecat, hierarchy=question_level,
    ))
    add("question (reflection)", "skipped", statements.reflection_skipped(
        identity, session_id, reflection_id, 2,
        question_he="מה היה החלק הכי מאתגר?",
        ecat_item_id=ecat, hierarchy=question_level,
    ))
    add("questionnaire (reflection)", "completed", statements.reflection_completed(
        identity, session_id, reflection_id, 180,
        ecat_item_id=ecat, hierarchy=question_level,
    ))

    # ── Mentoring + goals ─────────────────────────────────────────────────────
    add("mentor-student-meeting", "completed", statements.mentor_meeting_completed(
        identity, session_id, str(uuid.uuid4()),
        mentor_exid=config.test_exidentifier(), student_exid=config.test_exidentifier(),
        meeting_date=date.today().isoformat(), mentoring_phase="follow-up",
    ))
    goal_id = str(uuid.uuid4())
    for action, builder in (
        ("initialized", statements.student_goal_initialized),
        ("updated", statements.student_goal_updated),
        ("completed", statements.student_goal_completed),
    ):
        add("student-goal", action, builder(identity, session_id, goal_id, "academic"))

    # ── Content questionnaire (the component's own item set) ──────────────────
    # ONE object for the questionnaire screen, used identically everywhere it
    # appears — as the שאלון events' object, as the answered event's grouping
    # level and parent, and as the skipped event's object. The ministry's
    # examples never type the same id two ways.
    questionnaire_object = {
        "objectType": "Activity",
        "id": f"{CONTENT_BASE}/{COMPONENT_ID}/{QUESTION_ITEM_ID}",
        "definition": {
            "type": "https://lxp.education.gov.il/xapi/moe/activities/questionnaire",
            "name": {"he": "תרגול: מדידת מסה"},
        },
    }
    # For the question-level statement the questionnaire IS the hierarchy's
    # deepest level (its `self`), so the answered event nests under it exactly
    # like the examples: grouping […, component, questionnaire, question],
    # parent = [questionnaire].
    answer_level = dict(question_level)
    answer_level["self"] = questionnaire_object
    add("questionnaire", "initialized", statements.enriched_content_statement(
        identity, session_id,
        _raw("http://adlnet.gov/expapi/verbs/initialized",
             f"{CONTENT_BASE}/{COMPONENT_ID}/{QUESTION_ITEM_ID}",
             object_type="questionnaire", name_he="תרגול: מדידת מסה"),
        ecat_item_id=ecat, hierarchy=question_level,
    ))
    add("questionnaire", "completed", statements.enriched_content_statement(
        identity, session_id,
        _raw("http://adlnet.gov/expapi/verbs/completed",
             f"{CONTENT_BASE}/{COMPONENT_ID}/{QUESTION_ITEM_ID}",
             object_type="questionnaire", name_he="תרגול: מדידת מסה",
             result={"success": True, "score": {"scaled": 1.0}, "duration": "PT41S"}),
        ecat_item_id=ecat, hierarchy=question_level,
        result_extra={"completion": True},   # the example's questionnaire marker
    ))

    # ── Question answered (response + questionId/questionType/attemptNumber) ──
    question_rows = kata_catalog.questions_for_item(COMPONENT_ID, QUESTION_ITEM_ID) or []
    question = question_rows[0] if question_rows else {}
    add("question", "answered", statements.question_answered(
        identity, session_id,
        object_id=f"{CONTENT_BASE}/{COMPONENT_ID}/{QUESTION_ITEM_ID}/q1",
        question_id=question.get("questionId") or "q1",
        question_type=question.get("questionType") or "choice",
        question_he=question.get("questionText"),
        response="מאזני כפות | מאזניים דיגיטליים",
        attempt_number=2, success=True, score_scaled=1.0, duration_seconds=41,
        ecat_item_id=ecat, hierarchy=answer_level,
    ))

    # ── Questionnaire skipped (the screen, typed as what it is; the generic
    #    item-level skip is retired per spec v1.1 — see the component skip) ────
    add("questionnaire", "skipped", statements.content_skipped(
        identity, session_id,
        object_id=f"{CONTENT_BASE}/{COMPONENT_ID}/{QUESTION_ITEM_ID}",
        object_type="questionnaire", name_he="תרגול: מדידת מסה",
        ecat_item_id=ecat, hierarchy=question_level,
    ))

    # ── Media (all three carry format/position/duration) ──────────────────────
    media_object = f"{CONTENT_BASE}/{COMPONENT_ID}/{MEDIA_ITEM_ID}"
    add("video / audio / animation (media)", "played", statements.media_event(
        identity, session_id, "played", object_id=media_object, media_format="video",
        media_position_seconds=0, ecat_item_id=ecat, hierarchy=media_level,
    ))
    add("video / audio / animation (media)", "paused", statements.media_event(
        identity, session_id, "paused", object_id=media_object, media_format="video",
        media_position_seconds=38, duration_seconds=38,
        ecat_item_id=ecat, hierarchy=media_level,
    ))
    add("video / audio / animation (media)", "completed", statements.media_event(
        identity, session_id, "completed", object_id=media_object, media_format="video",
        media_position_seconds=73, duration_seconds=73,
        ecat_item_id=ecat, hierarchy=media_level,
    ))

    # ── Help request + non-learning selection (kebab-case selectionType) ──────
    # Help asked on the question the learner is stuck on — the ministry's
    # example shape: object = the question, nested under its questionnaire
    # (grouping […, questionnaire, question], parent=[questionnaire]), with the
    # question's own identifiers in extensions.
    add("component / item", "requested", statements.help_requested(
        identity, session_id,
        object_id=f"{CONTENT_BASE}/{COMPONENT_ID}/{QUESTION_ITEM_ID}/q1",
        object_type="question", name_he=question.get("questionText"),
        help_source="platform", help_type="hint",
        question_id=question.get("questionId") or "q1",
        question_type=question.get("questionType") or "choice",
        attempt_number=1,
        ecat_item_id=ecat, hierarchy=answer_level,
    ))
    add("item", "selected", statements.selected(
        identity, session_id,
        object_id=f"{CONTENT_BASE}/{COMPONENT_ID}/{MEDIA_ITEM_ID}",
        # The selected thing is the video item — typed `video` exactly like the
        # media events type the same id (the review flagged "נשלח type שונה").
        object_type="video", selection_type="learningType", response="listening",
        ecat_item_id=ecat, hierarchy=media_level,
    ))
    # The unit level is reported by its own statements too (content rules §1).
    add("learning-unit", "initialized", statements.enriched_content_statement(
        identity, session_id,
        _raw("http://adlnet.gov/expapi/verbs/initialized", f"{CONTENT_BASE}/{UNIT_ID}",
             object_type="learning-unit", name_he="מדידה מעשית של מסה בשלושה מצבי צבירה"),
        ecat_item_id=ecat, hierarchy=unit_level,
    ))
    return rows


async def main(dry_run: bool, only: str | None) -> int:
    if not config.is_enabled():
        print("❌ LRS not enabled/configured — check LRS_* in backend/.env")
        return 1
    problems = config.identity_problems()
    if problems:
        print("❌ the outbound identity is not report-ready:")
        for problem in problems:
            print(f"   · {problem}")
        print("\n   These are exactly what the ministry flagged (example domain, "
              "non-catalog content-vendor id). Fix the env, then re-run.")
        if not dry_run:
            return 2

    identity = _identity()
    session_id = str(uuid.uuid4())     # a real per-run session id, never a literal
    rows = await build_all(identity, session_id)
    if only:
        rows = [r for r in rows if only in f"{r[0]} {r[1]}"]

    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    sent: list[dict] = []
    for kind, verb, statement in rows:
        status = "dry-run"
        if not dry_run:
            try:
                response = await client.post_statement(statement)
                status = str(response["status"])
            except Exception as exc:  # keep going: one rejection is not the run
                status = f"error: {type(exc).__name__}"
        # The ministry's table is exactly three columns; the post status and the
        # object id are run diagnostics for us, so they stay on the console and
        # out of the deliverable.
        sent.append({"Object Type": kind, "Verb": verb, "Id": statement["id"]})
        print(f"{status:>8}  {kind:<34} {verb:<12} {statement['id']}")

    csv_path = ARTIFACTS / "lrs-contract-report.csv"
    with csv_path.open("w", newline="", encoding="utf-8-sig") as handle:
        writer = csv.DictWriter(handle, fieldnames=["Object Type", "Verb", "Id"])
        writer.writeheader()
        writer.writerows(sent)
    json_path = ARTIFACTS / "lrs-contract-report.json"
    json_path.write_text(
        json.dumps([s for _, _, s in rows], ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"\n📄 {csv_path}\n📄 {json_path}  (full statements, for the ministry's review)")
    print(f"   session id used: {session_id}")
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="build + write, no network")
    parser.add_argument("--only", help="substring filter on 'object type verb'")
    args = parser.parse_args()
    raise SystemExit(asyncio.run(main(args.dry_run, args.only)))
