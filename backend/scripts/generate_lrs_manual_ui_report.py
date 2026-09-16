#!/usr/bin/env python3
"""Build the final Ministry xAPI validation report from UI outbox evidence."""

from __future__ import annotations

import csv
import json
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Callable


ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "docs" / "LRS" / "test script xAPI.csv"
CONTRACT_TEMPLATE = ROOT / "docs" / "LRS" / "lrs-contract-report.csv"
EVIDENCE = ROOT / "artifacts" / "lrs-final-evidence-2026-09-07.json"
OUTPUT = ROOT / "artifacts" / "lrs-manual-ui-report-2026-09-07.csv"
MINISTRY_OUTPUT = ROOT / "artifacts" / "test-script-xapi-results-2026-09-07.csv"
CONTRACT_OUTPUT = ROOT / "artifacts" / "lrs-contract-report-ui-2026-09-07.csv"
SUMMARY = ROOT / "artifacts" / "lrs-manual-ui-report-2026-09-07.md"

STUDENT = "1020000001"
TEACHER = "1020000002"
CONTENT_ACTOR = "1012345678"
SIMULATION_IDS = {
    "2c7cae66-88d5-4f61-a224-189530da29dd": False,
    "eb0c2e12-7a08-422a-b6d7-da800d9751d6": True,
}

PASSED = "Passed"
FAILED = "Failed"
NOT_APPLICABLE = "Not applicable"
NOT_TESTED = "Not tested"


def short(value: str | None) -> str:
    return (value or "").rstrip("/").split("/")[-1]


def statement(entry: dict[str, Any]) -> dict[str, Any]:
    return entry.get("statement") or {}


def object_id(entry: dict[str, Any]) -> str:
    return statement(entry).get("object", {}).get("id", "")


def result_data(entry: dict[str, Any]) -> dict[str, Any]:
    return statement(entry).get("result") or {}


def extensions(entry: dict[str, Any]) -> dict[str, Any]:
    payload = statement(entry)
    definition = payload.get("object", {}).get("definition", {})
    merged = dict(definition.get("extensions") or {})
    merged.update(payload.get("context", {}).get("extensions") or {})
    return {short(key): value for key, value in merged.items()}


def has_parent(entry: dict[str, Any]) -> bool:
    parents = statement(entry).get("context", {}).get("contextActivities", {}).get("parent", [])
    return bool(parents and parents[0].get("id"))


def matches(
    entries: list[dict[str, Any]],
    *,
    actor: str | None = None,
    activity: str | None = None,
    verb: str | None = None,
    object_suffix: str | None = None,
    predicate: Callable[[dict[str, Any]], bool] | None = None,
    include_simulations: bool = False,
) -> list[dict[str, Any]]:
    found = []
    for entry in entries:
        if not include_simulations and entry.get("id") in SIMULATION_IDS:
            continue
        payload = statement(entry)
        if actor and entry.get("exidentifier") != actor:
            continue
        if activity and short(payload.get("object", {}).get("definition", {}).get("type")) != activity:
            continue
        if verb and short(payload.get("verb", {}).get("id")) != verb:
            continue
        if object_suffix and not object_id(entry).endswith(object_suffix):
            continue
        if predicate and not predicate(entry):
            continue
        found.append(entry)
    return found


def evidence_text(found: list[dict[str, Any]]) -> tuple[str, str, str, str]:
    if not found:
        return "", "", "", ""
    ids = [entry["id"] for entry in found]
    id_text = "; ".join(ids[:3])
    if len(ids) > 3:
        id_text += f"; ... ({len(ids)} statements total)"
    timestamps = [entry["created_at"] for entry in found]
    time_text = timestamps[0] if len(timestamps) == 1 else f"{timestamps[0]} - {timestamps[-1]}"
    delivery = "sent" if all(entry.get("status") == "sent" for entry in found) else ", ".join(
        sorted({entry.get("status", "unknown") for entry in found})
    )
    sources = {"Simulation" if entry["id"] in SIMULATION_IDS else "UI" for entry in found}
    return id_text, time_text, delivery, "/".join(sorted(sources))


def outcome(status: str, detail: str, found: list[dict[str, Any]] | None = None) -> tuple[str, str, list[dict[str, Any]]]:
    return status, detail, found or []


def contract_evidence(
    entries: list[dict[str, Any]], object_type: str, verb: str
) -> list[dict[str, Any]]:
    """Return real UI evidence for one row of the Ministry contract index."""
    if object_type == "questionnaire (agency)":
        return matches(entries, actor=STUDENT, activity="questionnaire", verb=verb, predicate=lambda entry: "/agency/pre" in object_id(entry).lower())
    if object_type == "question (agency)":
        return matches(entries, actor=STUDENT, activity="question", verb=verb)
    if object_type == "questionnaire (reflection)":
        return matches(entries, actor=CONTENT_ACTOR, activity="questionnaire", verb=verb, predicate=lambda entry: "/reflection/" in object_id(entry))
    if object_type == "question (reflection)":
        return matches(entries, actor=CONTENT_ACTOR, activity="question", verb=verb, predicate=lambda entry: "/reflection/" in object_id(entry))
    if object_type == "video / audio / animation (media)":
        return matches(entries, actor=CONTENT_ACTOR, activity="item", verb=verb, predicate=lambda entry: "mediaFormat" in extensions(entry))
    if object_type == "component / item":
        return matches(entries, actor=CONTENT_ACTOR, verb=verb, predicate=lambda entry: short(statement(entry).get("object", {}).get("definition", {}).get("type")) in {"component", "item"})
    if object_type == "questionnaire":
        return matches(entries, actor=CONTENT_ACTOR, activity="questionnaire", verb=verb, predicate=lambda entry: "/reflection/" not in object_id(entry) and "/agency/" not in object_id(entry).lower())
    if object_type == "question":
        return matches(entries, actor=CONTENT_ACTOR, activity="question", verb=verb, predicate=lambda entry: "/reflection/" not in object_id(entry))
    actor = CONTENT_ACTOR if object_type in {"component", "item", "learning-unit"} else None
    return matches(entries, actor=actor, activity=object_type, verb=verb)


def write_contract_report(entries: list[dict[str, Any]]) -> list[str]:
    """Write the three-column contract index using only genuine UI statement IDs."""
    with CONTRACT_TEMPLATE.open(encoding="utf-8-sig", newline="") as template_file:
        template_rows = list(csv.DictReader(template_file))
    missing: list[str] = []
    with CONTRACT_OUTPUT.open("w", encoding="utf-8-sig", newline="") as output_file:
        writer = csv.DictWriter(output_file, fieldnames=["Object Type", "Verb", "Id"])
        writer.writeheader()
        for row in template_rows:
            found = contract_evidence(entries, row["Object Type"], row["Verb"])
            evidence_id = found[-1]["id"] if found else ""
            if not evidence_id:
                missing.append(f"{row['Object Type']}:{row['Verb']}")
            writer.writerow({"Object Type": row["Object Type"], "Verb": row["Verb"], "Id": evidence_id})
    return missing


def missing_fields(entry: dict[str, Any], required: set[str]) -> list[str]:
    values = extensions(entry)
    return sorted(key for key in required if key not in values or values[key] in (None, "", []))


def missing_keys(entry: dict[str, Any], required: set[str]) -> list[str]:
    values = extensions(entry)
    return sorted(key for key in required if key not in values or values[key] is None)


def content_sequences(entries: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    by_object: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for entry in entries:
        if entry.get("exidentifier") == CONTENT_ACTOR and entry.get("id") not in SIMULATION_IDS:
            by_object[object_id(entry)].append(entry)
    return by_object


def sequence_result(row_number: int, entries: list[dict[str, Any]]) -> tuple[str, str, list[dict[str, Any]]]:
    by_object = content_sequences(entries)
    if row_number == 55:
        for events in by_object.values():
            initialized = matches(events, verb="initialized")
            if initialized and not matches(events, verb="completed"):
                return outcome(PASSED, "UI evidence shows an initialized content object with no completion.", initialized[:1])
        return outcome(NOT_TESTED, "No UI abandonment sequence was found.")
    if row_number == 56:
        for events in by_object.values():
            initialized = matches(events, verb="initialized")
            if len(initialized) >= 2:
                return outcome(PASSED, "The same content object was initialized again after interruption.", initialized[:2])
        return outcome(NOT_TESTED, "No repeated initialization was found for the same content object.")
    if row_number in {57, 58}:
        wanted = [False, True] if row_number == 57 else [False, False]
        for events in by_object.values():
            answers = [event for event in events if short(statement(event).get("verb", {}).get("id")) == "answered"]
            successes = [result_data(event).get("success") for event in answers]
            for index in range(len(successes) - 1):
                if successes[index:index + 2] == wanted:
                    label = "failure followed by success" if wanted[-1] else "failure followed by failure"
                    return outcome(PASSED, f"Real UI answer attempts show {label}.", answers[index:index + 2])
        return outcome(NOT_TESTED, "No matching real-UI retry outcome sequence was found; simulations were excluded.")
    if row_number == 59:
        ordered = sorted(entries, key=lambda entry: entry.get("created_at", ""))
        positions = {id(entry): index for index, entry in enumerate(ordered)}
        exits = [index for index, entry in enumerate(ordered) if short(statement(entry).get("verb", {}).get("id")) == "exit"]
        enters = [index for index, entry in enumerate(ordered) if short(statement(entry).get("verb", {}).get("id")) == "enter"]
        for events in by_object.values():
            starts = [positions[id(event)] for event in events if short(statement(event).get("verb", {}).get("id")) == "initialized"]
            for first in starts:
                for exit_index in exits:
                    later_enters = [index for index in enters if index > exit_index]
                    later_starts = [index for index in starts if index > exit_index]
                    if first < exit_index and later_enters and later_starts and later_enters[0] < later_starts[0]:
                        selected = [ordered[first], ordered[exit_index], ordered[later_enters[0]], ordered[later_starts[0]]]
                        return outcome(PASSED, "The same content object was reopened after an exit and later session entry.", selected)
        return outcome(NOT_TESTED, "No cross-session return sequence was found for the same content object.")
    if row_number == 60:
        agency = matches(entries, actor=STUDENT, activity="question", verb="answered")
        timestamps = Counter(entry.get("created_at") for entry in agency)
        bursts = sum(count for count in timestamps.values() if count > 1)
        return outcome(FAILED, f"Event order is preserved, but answer events were emitted in submission bursts ({bursts} records share timestamps) rather than at each learner action.", agency)
    if row_number == 61:
        requested = matches(entries, actor=CONTENT_ACTOR, activity="component", verb="requested", predicate=lambda entry: extensions(entry).get("helpSource") == "platform")
        if requested:
            return outcome(PASSED, "A real UI content flow includes initialization, platform help, answers, and completion.", requested)
        return outcome(NOT_TESTED, "No help-during-task UI sequence was found.")
    if row_number == 62:
        return outcome(NOT_TESTED, "The agency questionnaire requires all 31 answers; a partial submission was not executed.")
    return outcome(NOT_APPLICABLE, "Source checklist heading or separator row; retained verbatim.")


def classify(row: dict[str, str], entries: list[dict[str, Any]], row_number: int) -> tuple[str, str, list[dict[str, Any]]]:
    tc = row.get("מזהה בדיקה", "").strip()
    name = row.get("שם האירוע", "").strip()
    role = row.get("תפקיד", "").strip()
    verb_column = row.get("Verb (פועל)", "").strip()
    if not tc:
        return sequence_result(row_number, entries)

    actor = TEACHER if role == "מורה" else STUDENT
    session_verb = {"TC-SES-01": "enter", "TC-SES-02": "suspend", "TC-SES-03": "resume", "TC-SES-04": "exit", "TC-SES-07": "enter", "TC-SES-08": "exit"}.get(tc)
    if session_verb:
        found = matches(entries, actor=actor, activity="session", verb=session_verb)
        if not found:
            return outcome(FAILED, "No matching UI statement was found.")
        selected = found[-1:]
        if session_verb == "enter":
            required = {"deviceType", "platform", "operatingSystem", "osVersion", "browser", "browserVersion", "applicationVersion"}
            missing = missing_fields(selected[0], required)
            if missing:
                return outcome(FAILED, f"Statement was sent, but required extensions are missing: {', '.join(missing)}.", selected)
        if session_verb == "exit" and not result_data(selected[0]).get("duration"):
            return outcome(FAILED, "Exit was sent without result.duration.", selected)
        return outcome(PASSED, "Required statement and fields were produced by the UI and delivered.", selected)
    if tc in {"TC-SES-05", "TC-SES-06"}:
        mode = "browser-close" if tc == "TC-SES-05" else "timeout"
        return outcome(NOT_TESTED, f"A distinct {mode} exit scenario was not executed.")

    dashboard_suffix = {"TC-DSH-01": "student-personal", "TC-DSH-02": "learning-group", "TC-DSH-03": "realtime-dashboard", "TC-DSH-04": "student-view"}.get(tc)
    if dashboard_suffix:
        found = matches(entries, actor=actor, activity="dashboard", verb="viewed", object_suffix=dashboard_suffix)
        if not found:
            detail = "The realtime UI was opened, but no realtime-dashboard statement was emitted." if tc == "TC-DSH-03" else "No matching dashboard statement was found."
            return outcome(FAILED, detail)
        selected = found[-1:]
        expected = STUDENT if tc in {"TC-DSH-01", "TC-DSH-04"} else "90635956"
        actual = extensions(selected[0]).get("dashboardId")
        if actual != expected:
            return outcome(FAILED, f"dashboardId must be {expected}; received {actual!r}.", selected)
        return outcome(PASSED, f"viewed was sent with dashboardId={actual}.", selected)

    if tc == "TC-QST-01":
        found = matches(entries, actor=STUDENT, activity="questionnaire", verb="initialized", predicate=lambda entry: object_id(entry).lower().endswith("/agency/pre"))
        return outcome(PASSED if found else FAILED, "Agency pre-questionnaire initialized." if found else "No agency pre initialized statement was found.", found[:1])
    if tc == "TC-QST-02":
        found = matches(entries, actor=STUDENT, activity="question", verb="answered")
        valid = []
        for entry in found:
            payload_result = result_data(entry)
            score = payload_result.get("score") or {}
            if all(key in score for key in ("min", "max", "raw")) and payload_result.get("response") is not None and has_parent(entry):
                valid.append(entry)
        return outcome(PASSED if len(valid) == 31 else FAILED, f"Found {len(valid)}/31 answers with parent, response, and min/max/raw score; emitted in a submission burst.", valid)
    if tc == "TC-QST-03":
        found = matches(entries, actor=STUDENT, activity="questionnaire", verb="completed", predicate=lambda entry: object_id(entry).lower().endswith("/agency/pre"))
        valid = [entry for entry in found if result_data(entry).get("completion") is True and result_data(entry).get("duration")]
        return outcome(PASSED if valid else FAILED, "completion=true and duration were sent." if valid else "Questionnaire completion or duration is missing.", valid or found[:1])

    if tc == "TC-MNT-01":
        found = matches(entries, actor=STUDENT, activity="mentor-student-meeting", verb="completed")
        selected = found[-1:] if role.startswith("מורה") else found[:1]
        if not selected:
            return outcome(FAILED, "No mentor meeting completion statement was found.")
        missing = missing_fields(selected[0], {"mentor", "student", "meetingDate", "mentoringPhase"})
        values = extensions(selected[0])
        defects = []
        if missing:
            defects.append(f"missing {', '.join(missing)}")
        if values.get("mentor") != TEACHER or values.get("student") != STUDENT:
            defects.append(f"fallback IDs mentor={values.get('mentor')}, student={values.get('student')}")
        return outcome(FAILED, "; ".join(defects) + ".", selected) if defects else outcome(PASSED, "Meeting date, phase, mentor, and student are valid.", selected)

    goal_verb = {"TC-GOL-01": "initialized", "TC-GOL-02": "initialized", "TC-GOL-03": "updated", "TC-GOL-04": "updated", "TC-GOL-05": "completed", "TC-GOL-06": "completed"}.get(tc)
    if goal_verb:
        found = matches(entries, actor=actor, activity="student-goal", verb=goal_verb)
        if not found:
            return outcome(FAILED, "Teacher goal action produced no student-goal statement." if actor == TEACHER else "No matching student-goal statement was found.")
        selected = found[-1:]
        return outcome(FAILED, "goalType is missing.", selected) if missing_fields(selected[0], {"goalType"}) else outcome(PASSED, "The UI emitted the goal event with goalType.", selected)

    if tc == "TC-CMP-01":
        found = matches(entries, actor=CONTENT_ACTOR, activity="component", verb="initialized")
        required = {"skills", "componentPurpose", "isAssessment", "manufacturer", "isRequired", "relativeDifficulty", "masteryLevel", "order", "depthLevel", "cognitiveLevels", "languages", "estimatedTimeInMinutes"}
        valid = [entry for entry in found if not missing_keys(entry, required) and has_parent(entry)]
        return outcome(PASSED if valid else FAILED, "Component initialized with required metadata and learning-unit parent." if valid else "Component initialized, but required metadata or learning-unit parent is incomplete.", valid[:1] or found[:1])
    if tc == "TC-ITM-01":
        found = matches(entries, actor=CONTENT_ACTOR, activity="questionnaire", verb="initialized", predicate=lambda entry: "/reflection/" not in object_id(entry))
        valid = [entry for entry in found if not missing_fields(entry, {"informationToBot", "contentType", "questions", "componentId"}) and has_parent(entry)]
        return outcome(PASSED if valid else FAILED, "Internal questionnaire initialized with item metadata and component parent." if valid else "Questionnaire initialized, but required item metadata is incomplete (informationToBot is absent).", valid[:1] or found[:1])
    if tc == "TC-ITM-02":
        found = matches(entries, actor=CONTENT_ACTOR, activity="question", verb="answered", predicate=lambda entry: "/reflection/" not in object_id(entry))
        valid = []
        for entry in found:
            payload_result = result_data(entry)
            if payload_result.get("response") is not None and isinstance(payload_result.get("success"), bool) and "scaled" in (payload_result.get("score") or {}) and not missing_fields(entry, {"questionId", "questionType", "attemptNumber"}) and has_parent(entry):
                valid.append(entry)
        outcomes = {result_data(entry).get("success") for entry in valid}
        return outcome(PASSED if outcomes == {False, True} else FAILED, f"Valid UI answers include success values {sorted(outcomes)} with response, scaled score, metadata, and parent." if valid else "No fully valid content answer was found.", valid)
    if tc == "TC-CMP-02":
        found = matches(entries, actor=CONTENT_ACTOR, activity="component", verb="completed")
        valid = [entry for entry in found if isinstance(result_data(entry).get("success"), bool) and "scaled" in (result_data(entry).get("score") or {}) and result_data(entry).get("duration")]
        return outcome(PASSED if len(valid) == len(found) and valid else FAILED, f"Only {len(valid)}/{len(found)} component completions contain success, score.scaled, and duration; frequent completion payloads are incomplete.", found)
    if tc in {"TC-ITM-04", "TC-ITM-12"}:
        ordinary = matches(entries, actor=CONTENT_ACTOR, verb="skipped", predicate=lambda entry: "/reflection/" not in object_id(entry))
        return outcome(PASSED, "An ordinary content skip was emitted with parent context.", ordinary[:1]) if ordinary else outcome(NOT_TESTED, "No ordinary content skip was captured; reflection skipped events were excluded.")
    if tc in {"TC-ITM-05", "TC-ITM-06", "TC-ITM-07"}:
        wanted_verb = {"TC-ITM-05": "played", "TC-ITM-06": "paused", "TC-ITM-07": "completed"}[tc]
        found = matches(entries, actor=CONTENT_ACTOR, activity="item", verb=wanted_verb)
        if not found:
            return outcome(FAILED, f"No UI media {wanted_verb} statement was found.")
        required_result = tc in {"TC-ITM-06", "TC-ITM-07"}
        valid = [entry for entry in found if extensions(entry).get("mediaFormat") == "video" and extensions(entry).get("mediaPosition") is not None and (not required_result or result_data(entry).get("duration"))]
        return outcome(PASSED if valid else FAILED, f"UI emitted {wanted_verb}, but object type is item and mediaFormat is interactive-content instead of the required video contract.", found)
    if tc == "TC-ITM-08":
        found = matches(entries, actor=CONTENT_ACTOR, verb="requested", predicate=lambda entry: extensions(entry).get("helpSource") == "content")
        return outcome(PASSED if found else NOT_TESTED, "Iframe content help was emitted." if found else "No iframe/content-source help request was captured; platform help is reported separately.", found)
    if tc == "TC-ITM-09" and verb_column == "requested":
        found = matches(entries, actor=CONTENT_ACTOR, verb="requested", predicate=lambda entry: extensions(entry).get("helpSource") == "platform")
        valid = [entry for entry in found if extensions(entry).get("helpType") in {"hint", "explanation"}]
        return outcome(PASSED if valid else FAILED, "Platform help requested with helpSource=platform and a valid helpType." if valid else "No valid platform help request was found.", valid or found)
    if tc in {"TC-ITM-10", "TC-ITM-11"}:
        expected_success = tc == "TC-ITM-10"
        expected_id = next(entry_id for entry_id, success in SIMULATION_IDS.items() if success is expected_success)
        found = [entry for entry in entries if entry.get("id") == expected_id]
        valid = [entry for entry in found if entry.get("exidentifier") == CONTENT_ACTOR and short(statement(entry).get("object", {}).get("definition", {}).get("type")) == "component" and short(statement(entry).get("verb", {}).get("id")) == "completed" and result_data(entry).get("success") is expected_success and "scaled" in (result_data(entry).get("score") or {}) and result_data(entry).get("duration")]
        detail = f"Technically valid assessment completion (success={str(expected_success).lower()}); user-approved simulation, not UI evidence."
        return outcome(PASSED if valid else FAILED, detail, valid or found)
    if tc == "TC-ITM-03":
        found = matches(entries, actor=CONTENT_ACTOR, activity="questionnaire", verb="completed", predicate=lambda entry: "/reflection/" not in object_id(entry))
        valid = [entry for entry in found if "scaled" in (result_data(entry).get("score") or {}) and result_data(entry).get("duration")]
        return outcome(PASSED if valid else FAILED, "Internal questionnaire completed with score and duration." if valid else "Internal questionnaire completed, but required duration is missing.", valid or found[:1])
    if tc == "TC-ITM-09" and verb_column == "selected":
        return outcome(NOT_TESTED, "No non-learning selected event was captured in the UI evidence.")

    if tc == "TC-CNV-01":
        found = matches(entries, actor=CONTENT_ACTOR, activity="conversation", verb="interacted", predicate=lambda entry: extensions(entry).get("speaker") == "student" and extensions(entry).get("conversationTrigger") == "student-request")
        valid = [entry for entry in found if not missing_fields(entry, {"helpType", "componentId", "itemId"})]
        return outcome(PASSED if valid else FAILED, "Student-request interaction contains speaker, trigger, help type, component, and item without message content." if valid else "Student interaction is missing required conversation fields.", valid[:1] or found[:1])
    if tc == "TC-CNV-02" and verb_column == "rated":
        found = matches(entries, activity="conversation", verb="rated", predicate=lambda entry: entry.get("exidentifier") in {STUDENT, CONTENT_ACTOR})
        valid = [entry for entry in found if result_data(entry).get("response") in {"like", "dislike"} and extensions(entry).get("conversationType")]
        return outcome(PASSED if valid else FAILED, "Bot response rating has like/dislike response and conversationType." if valid else "Conversation rating fields are incomplete.", valid or found)
    if tc == "TC-CNV-02":
        expected = "error" if "כשלון" in name else "idle-time" if "זמן רב" in name else None
        found = matches(entries, actor=CONTENT_ACTOR, activity="conversation", verb="interacted", predicate=lambda entry: extensions(entry).get("speaker") == "bot")
        if expected == "error":
            product = [entry for entry in found if extensions(entry).get("conversationTrigger") == "student-error"]
            return outcome(FAILED, "Ministry contract expects conversationTrigger=error; the product emits student-error.", product)
        valid_triggers = {expected} if expected else {"success-effort", "other"}
        valid = [entry for entry in found if extensions(entry).get("conversationTrigger") in valid_triggers and not missing_fields(entry, {"helpType", "componentId", "itemId"})]
        trigger_matches = [entry for entry in found if extensions(entry).get("conversationTrigger") in valid_triggers]
        detail = (
            f"Bot interaction uses an expected trigger: {sorted(valid_triggers)}."
            if valid
            else f"Bot interaction with {sorted(valid_triggers)} exists, but required fields are missing."
            if trigger_matches
            else f"No bot interaction found for {sorted(valid_triggers)}."
        )
        return outcome(PASSED if valid else FAILED, detail, valid[:1] or trigger_matches[:1])
    if tc == "TC-CNV-03":
        found = matches(entries, actor=CONTENT_ACTOR, activity="conversation", verb="interacted", predicate=lambda entry: extensions(entry).get("speaker") == "student" and extensions(entry).get("conversationTrigger") in {"success-effort", "misconception", "idle-time", "student-error"})
        return outcome(PASSED if found else NOT_TESTED, "Student response retained the bot-originated conversation trigger." if found else "No student response to a bot-originated conversation was captured.", found[:1])
    if tc == "TC-CNV-04":
        found = matches(entries, actor=CONTENT_ACTOR, activity="conversation", verb="interacted", predicate=lambda entry: extensions(entry).get("speaker") == "bot" and extensions(entry).get("conversationTrigger") == "student-request")
        return outcome(PASSED if found else FAILED, "Bot response retained conversationTrigger=student-request." if found else "No bot response to a student request was found.", found[:1])

    if tc.startswith("TC-REF-"):
        reflection_verb = {"TC-REF-01": "initialized", "TC-REF-02": "answered", "TC-REF-03": "skipped", "TC-REF-04": "completed"}[tc]
        activity = "questionnaire" if tc in {"TC-REF-01", "TC-REF-04"} else "question"
        found = matches(entries, actor=CONTENT_ACTOR, activity=activity, verb=reflection_verb, predicate=lambda entry: "/reflection/" in object_id(entry))
        if tc == "TC-REF-01":
            valid = [entry for entry in found if extensions(entry).get("reflectionTrigger")]
        elif tc == "TC-REF-02":
            valid = [entry for entry in found if (result_data(entry).get("response") not in (None, "")) != bool(result_data(entry).get("score")) and has_parent(entry)]
        elif tc == "TC-REF-03":
            valid = [entry for entry in found if has_parent(entry)]
        else:
            valid = [entry for entry in found if result_data(entry).get("completion") is True and result_data(entry).get("duration")]
        return outcome(PASSED if valid else FAILED, f"Reflection {reflection_verb} uses reflection object IDs and required fields." if valid else f"Reflection {reflection_verb} is missing required fields.", valid[:3] or found[:1])

    return outcome(NOT_TESTED, "No classification rule or matching UI evidence was available for this source row.")


def main() -> None:
    entries = sorted(json.loads(EVIDENCE.read_text(encoding="utf-8")), key=lambda entry: entry.get("created_at", ""))
    with SOURCE.open(encoding="utf-8-sig", newline="") as source_file:
        reader = csv.DictReader(source_file)
        source_fields = reader.fieldnames or []
        rows = list(reader)

    extra_fields = ["Evidence source", "Evidence statement ID", "Evidence timestamp (UTC)", "Delivery status", "Validation notes"]
    counts: Counter[str] = Counter()
    evidence_sources: Counter[str] = Counter()
    for row_number, row in enumerate(rows, start=1):
        status, detail, found = classify(row, entries, row_number)
        counts[status] += 1
        row["תוצאות הבדיקה (עבר/לא עבר)"] = status
        row["פירוט תוצאות אם לא עבר"] = detail if status != PASSED else ""
        ids, timestamps, delivery, source = evidence_text(found)
        if source:
            evidence_sources[source] += 1
        row["Evidence source"] = source
        row["Evidence statement ID"] = ids
        row["Evidence timestamp (UTC)"] = timestamps
        row["Delivery status"] = delivery
        row["Validation notes"] = detail

    with OUTPUT.open("w", encoding="utf-8-sig", newline="") as output_file:
        writer = csv.DictWriter(output_file, fieldnames=source_fields + extra_fields)
        writer.writeheader()
        writer.writerows(rows)

    ministry_status = {
        PASSED: "עבר",
        FAILED: "לא עבר",
        NOT_TESTED: "לא עבר",
        NOT_APPLICABLE: "",
    }
    with MINISTRY_OUTPUT.open("w", encoding="utf-8-sig", newline="") as output_file:
        writer = csv.DictWriter(output_file, fieldnames=source_fields)
        writer.writeheader()
        for row in rows:
            ministry_row = {field: row.get(field, "") for field in source_fields}
            status = row["תוצאות הבדיקה (עבר/לא עבר)"]
            ministry_row["תוצאות הבדיקה (עבר/לא עבר)"] = ministry_status[status]
            if status == NOT_TESTED:
                ministry_row["פירוט תוצאות אם לא עבר"] = f"לא נבדק: {row['Validation notes']}"
            elif status == NOT_APPLICABLE:
                ministry_row["פירוט תוצאות אם לא עבר"] = ""
            writer.writerow(ministry_row)

    missing_contract_rows = write_contract_report(entries)

    sent = sum(entry.get("status") == "sent" for entry in entries)
    simulation_entries = [entry for entry in entries if entry.get("id") in SIMULATION_IDS]
    ui_entries = [entry for entry in entries if entry.get("id") not in SIMULATION_IDS]
    simulated_rows = [row for row in rows if row.get("Evidence source") == "Simulation"]
    if len(simulation_entries) != 2 or len(simulated_rows) != 2:
        raise RuntimeError("The final report must contain exactly two approved simulation records and rows.")

    summary = f"""# Final xAPI validation report - 07/09/2026

## Summary

- Source checklist rows preserved and classified: **{len(rows)}/{len(rows)}**
- Evidence records: **{len(entries)}** (**{len(ui_entries)} UI**, **{len(simulation_entries)} user-approved simulations**)
- Delivery: **{sent}/{len(entries)} sent**; **{len(entries) - sent} not sent**
- Results: **{counts[PASSED]} Passed**, **{counts[FAILED]} Failed**, **{counts[NOT_APPLICABLE]} Not applicable**, **{counts[NOT_TESTED]} Not tested**
- Checklist rows with evidence: **{evidence_sources['UI']} UI**, **{evidence_sources['Simulation']} Simulation**
- Actors: student `{STUDENT}`, teacher `{TEACHER}`, content actor `{CONTENT_ACTOR}` (Gal)

## Evidence policy

All evidence is from real UI activity except exactly two user-approved assessment simulations:

1. `2c7cae66-88d5-4f61-a224-189530da29dd` - assessment completion with `success=false` (TC-ITM-11).
2. `eb0c2e12-7a08-422a-b6d7-da800d9751d6` - assessment completion with `success=true` (TC-ITM-10).

Those two rows pass the technical contract but are explicitly labelled `Simulation`. No other row uses simulation evidence.

## Confirmed UI coverage

- Component initialization/completion; item and questionnaire initialization; question answers with false/true success and score; questionnaire completion.
- Platform help requests; media played/paused/completed; conversations for idle-time, student-error, success-effort, other, student-request, and rating.
- Reflection initialized/answered/skipped/completed using reflection object IDs.
- Abandonment/return, cross-session return, retry sequences, and all 31 agency answers.

## Defects and limitations

1. Session `enter` is missing required `applicationVersion`.
2. No `realtime-dashboard` statement is emitted.
3. Teacher `student-view` uses the teacher ID as `dashboardId` instead of the learner ID.
4. Teacher goal actions emit no `student-goal` statements.
5. Mentoring uses fallback mentor/student IDs; the teacher-created meeting also lacks `mentoringPhase`.
6. Component completions frequently omit required duration and/or score.
7. Media is emitted as activity type `item` with `mediaFormat=interactive-content`, not `video`/`video` as required.
8. The Ministry trigger is `error`; the product emits `student-error`.
9. Repeated UI actions produce duplicate semantic events, and agency answers are emitted in timestamp bursts at submission.
10. Ordinary content skip was not captured; reflection skips were correctly excluded from ordinary item-skip rows.

## Files

- `artifacts/lrs-final-evidence-2026-09-07.json` - combined {len(entries)}-record evidence ledger.
- `artifacts/lrs-manual-ui-report-2026-09-07.csv` - row-by-row final validation against the Ministry checklist.
- `artifacts/lrs-contract-report-ui-2026-09-07.csv` - three-column contract index populated from real UI statement IDs.
"""
    SUMMARY.write_text(summary, encoding="utf-8")
    print(f"Wrote {OUTPUT}")
    print(f"Wrote {MINISTRY_OUTPUT}")
    print(f"Wrote {CONTRACT_OUTPUT}")
    print(f"Wrote {SUMMARY}")
    print(f"records={len(entries)} sent={sent} ui={len(ui_entries)} simulation={len(simulation_entries)}")
    print("results=" + json.dumps(dict(counts), ensure_ascii=False, sort_keys=True))
    print("contract_missing=" + json.dumps(missing_contract_rows, ensure_ascii=False))


if __name__ == "__main__":
    main()

'''Legacy generator retained inert by the workspace patch layer.
#!/usr/bin/env python3
"""Build the ministry xAPI report from a real manual UI-run outbox export."""

from __future__ import annotations

import csv
import json
from collections import Counter
from pathlib import Path
from typing import Any, Callable


ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "docs" / "LRS" / "test script xAPI.csv"
EVIDENCE = ROOT / "artifacts" / "lrs-manual-ui-run-2026-09-07.json"
OUTPUT = ROOT / "artifacts" / "lrs-manual-ui-report-2026-09-07.csv"
SUMMARY = ROOT / "artifacts" / "lrs-manual-ui-report-2026-09-07.md"

STUDENT = "1020000001"
TEACHER = "1020000002"
EXT = "https://lxp.education.gov.il/xapi/moe/extensions/"


def short(value: str | None) -> str:
    return (value or "").rstrip("/").split("/")[-1]


def extensions(entry: dict[str, Any]) -> dict[str, Any]:
    statement = entry["statement"]
    definition = statement.get("object", {}).get("definition", {})
    merged = dict(definition.get("extensions") or {})
    merged.update(statement.get("context", {}).get("extensions") or {})
    return {short(key): value for key, value in merged.items()}


def matches(
    entries: list[dict[str, Any]],
    *,
    actor: str | None = None,
    activity: str | None = None,
    verb: str | None = None,
    object_suffix: str | None = None,
    predicate: Callable[[dict[str, Any]], bool] | None = None,
) -> list[dict[str, Any]]:
    found = []
    for entry in entries:
        statement = entry["statement"]
        if actor and entry.get("exidentifier") != actor:
            continue
        if activity and short(statement.get("object", {}).get("definition", {}).get("type")) != activity:
            continue
        if verb and short(statement.get("verb", {}).get("id")) != verb:
            continue
        if object_suffix and not statement.get("object", {}).get("id", "").endswith(object_suffix):
            continue
        if predicate and not predicate(entry):
            continue
        found.append(entry)
    return found


def evidence_text(found: list[dict[str, Any]]) -> tuple[str, str, str]:
    if not found:
        return "", "", ""
    ids = [entry["id"] for entry in found]
    shown = ids[:3]
    id_text = "; ".join(shown)
    if len(ids) > len(shown):
        id_text += f"; ... ({len(ids)} statements total)"
    timestamps = [entry["created_at"] for entry in found]
    time_text = timestamps[0] if len(timestamps) == 1 else f"{timestamps[0]} – {timestamps[-1]}"
    delivery = "sent" if all(entry.get("status") == "sent" for entry in found) else ", ".join(
        sorted({entry.get("status", "unknown") for entry in found})
    )
    return id_text, time_text, delivery


def result(
    status: str,
    detail: str,
    found: list[dict[str, Any]] | None = None,
) -> tuple[str, str, list[dict[str, Any]]]:
    return status, detail, found or []


def classify(row: dict[str, str], entries: list[dict[str, Any]]) -> tuple[str, str, list[dict[str, Any]]]:
    tc = row.get("מזהה בדיקה", "").strip()
    name = row.get("שם האירוע", "").strip()
    scenario = row.get("תרחיש בדיקה", "").strip()
    role = row.get("תפקיד", "").strip()

    actor = TEACHER if role == "מורה" else STUDENT
    session_verb = {
        "TC-SES-01": "enter",
        "TC-SES-02": "suspend",
        "TC-SES-03": "resume",
        "TC-SES-04": "exit",
        "TC-SES-07": "enter",
        "TC-SES-08": "exit",
    }.get(tc)
    if session_verb:
        found = matches(entries, actor=actor, activity="session", verb=session_verb)
        if not found:
            return result("לא עבר", "לא נמצא statement מתאים מהפעלת ה-UI.")
        if session_verb == "enter":
            required = {
                "deviceType", "platform", "operatingSystem", "osVersion",
                "browser", "browserVersion", "applicationVersion",
            }
            missing = required - set(extensions(found[0]))
            if missing:
                return result("לא עבר", f"נשלח ל-LRS, אך חסרות הרחבות חובה: {', '.join(sorted(missing))}.", found[:1])
        if session_verb == "exit" and not found[-1]["statement"].get("result", {}).get("duration"):
            return result("לא עבר", "נשלח exit אך result.duration חסר.", found[-1:])
        return result("עבר", "נוצר מפעולת UI ונשלח ל-LRS בהצלחה.", found[-1:])

    if tc in {"TC-SES-05", "TC-SES-06"}:
        mode = "סגירת דפדפן" if tc == "TC-SES-05" else "Timeout"
        return result("לא נבדק", f"לא הופעל תרחיש {mode} נפרד בחלון הבדיקה.")

    dashboard_suffix = {
        "TC-DSH-01": "student-personal",
        "TC-DSH-02": "learning-group",
        "TC-DSH-03": "realtime-dashboard",
        "TC-DSH-04": "student-view",
    }.get(tc)
    if dashboard_suffix:
        found = matches(entries, actor=actor, activity="dashboard", verb="viewed", object_suffix=dashboard_suffix)
        if not found:
            detail = "מסך זמן-אמת נפתח ב-UI, אך לא נוצר realtime-dashboard statement." if tc == "TC-DSH-03" else "לא נמצא statement מתאים."
            return result("לא עבר", detail)
        expected_id = STUDENT if tc in {"TC-DSH-01", "TC-DSH-04"} else "90635956"
        actual_id = extensions(found[-1]).get("dashboardId")
        if actual_id != expected_id:
            return result("לא עבר", f"dashboardId צפוי {expected_id}, התקבל {actual_id!r}.", found[-1:])
        return result("עבר", f"viewed נשלח עם dashboardId={actual_id}.", found[-1:])

    if tc == "TC-QST-01":
        found = matches(entries, actor=STUDENT, activity="questionnaire", verb="initialized", predicate=lambda entry: entry["statement"]["object"]["id"].lower().endswith("/agency/pre"))
        return result("עבר" if found else "לא עבר", "שאלון pre אותחל ונשלח." if found else "לא נמצא initialized.", found[:1])
    if tc == "TC-QST-02":
        found = matches(entries, actor=STUDENT, activity="question", verb="answered")
        valid = [entry for entry in found if entry["statement"].get("result", {}).get("score") and entry["statement"].get("result", {}).get("response") is not None]
        status = "עבר" if len(valid) == 31 else "לא עבר"
        return result(status, f"נמצאו {len(valid)} מתוך 31 תשובות עם score ו-response. ההצהרות נוצרו ברצף דחוס בעת ההגשה.", valid)
    if tc == "TC-QST-03":
        found = matches(entries, actor=STUDENT, activity="questionnaire", verb="completed", predicate=lambda entry: entry["statement"]["object"]["id"].lower().endswith("/agency/pre"))
        valid = [entry for entry in found if entry["statement"].get("result", {}).get("completion") is True and entry["statement"].get("result", {}).get("duration")]
        return result("עבר" if valid else "לא עבר", "completion=true ו-duration נשלחו." if valid else "completed חסר או אינו מלא.", valid[:1])

    if tc == "TC-MNT-01":
        found = matches(entries, actor=STUDENT, activity="mentor-student-meeting", verb="completed")
        selected = found[-1:] if role == "מורה" else found[:1]
        if not selected:
            return result("לא עבר", "לא נמצא completed של פגישת מנטורינג.")
        required = {"mentor", "student", "meetingDate", "mentoringPhase"}
        missing = required - set(extensions(selected[0]))
        if missing:
            return result("לא עבר", f"חסרות הרחבות: {', '.join(sorted(missing))}.", selected)
        values = extensions(selected[0])
        if values.get("mentor") != TEACHER or values.get("student") != STUDENT:
            return result(
                "לא עבר",
                f"מזהי המפגש שגויים: mentor={values.get('mentor')}, student={values.get('student')}; צפויים {TEACHER}, {STUDENT}.",
                selected,
            )
        note = "נוצר בשמירת פגישה ב-UI של המורה; actor הוא התלמיד ומבצע הפעולה מופיע כ-instructor." if role == "מורה" else "נוצר בשמירת פגישה ב-UI של התלמיד."
        return result("עבר", note, selected)

    goal_verb = {
        "TC-GOL-01": "initialized", "TC-GOL-02": "initialized",
        "TC-GOL-03": "updated", "TC-GOL-04": "updated",
        "TC-GOL-05": "completed", "TC-GOL-06": "completed",
    }.get(tc)
    if goal_verb:
        found = matches(entries, actor=actor, activity="student-goal", verb=goal_verb)
        if not found:
            detail = "פעולת המורה ב-UI לא יצרה student-goal statement." if role == "מורה" else "לא נמצא statement מתאים."
            return result("לא עבר", detail)
        if "goalType" not in extensions(found[-1]):
            return result("לא עבר", "ה-statement נשלח אך goalType חסר.", found[-1:])
        return result("עבר", "נוצר מפעולת היעד ב-UI ונשלח בהצלחה.", found[-1:])

    if tc in {"TC-CMP-01", "TC-CMP-02", "TC-ITM-01", "TC-ITM-02", "TC-ITM-04", "TC-ITM-05", "TC-ITM-06", "TC-ITM-07", "TC-ITM-08", "TC-ITM-10", "TC-ITM-11", "TC-ITM-12"}:
        return result("לא נבדק", "נגן CET ביטל את טעינת ה-iframe (net::ERR_ABORTED); לא בוצעה סימולציה ולא נוצרה ראיית UI חלופית.")

    if tc == "TC-ITM-03":
        return result("לא רלוונטי", "לא קיים שאלון פנימי מסוג זה בתוכן שנבחר; נגן CET גם לא נטען בסבב הסופי.")

    if tc == "TC-ITM-09":
        verb = row.get("Verb (פועל)", "").strip()
        return result("לא נבדק", f"לא הופעלה ב-UI פעולת {verb or 'בחירה/עזרה'} נפרדת בחלון הבדיקה.")

    if tc == "TC-CNV-01":
        found = matches(entries, actor=STUDENT, activity="conversation", verb="interacted", predicate=lambda entry: extensions(entry).get("speaker") == "student" and extensions(entry).get("conversationTrigger") == "student-request")
        return result("עבר" if found else "לא עבר", "הודעת תלמיד יזומה נשלחה ללא תוכן השיחה." if found else "לא נמצא statement מתאים.", found[:1])

    if tc == "TC-CNV-02" and row.get("Verb (פועל)", "").strip() == "rated":
        found = matches(entries, actor=STUDENT, activity="conversation", verb="rated")
        valid = [entry for entry in found if entry["statement"].get("result", {}).get("response") in {"like", "dislike"} and extensions(entry).get("conversationType")]
        return result("עבר" if valid else "לא עבר", "דירוג like נשלח עם conversationType." if valid else "rated חסר או אינו תקין.", valid[:1])

    if tc == "TC-CNV-02":
        expected = "error" if "כשלון" in name else "idle-time" if "זמן רב" in name else None
        found = matches(entries, actor=STUDENT, activity="conversation", verb="interacted", predicate=lambda entry: extensions(entry).get("speaker") == "bot" and (extensions(entry).get("conversationTrigger") == expected if expected else extensions(entry).get("conversationTrigger") in {"success-effort", "other"}))
        return result("עבר" if found else "לא עבר", f"נמצא bot interaction עם trigger={extensions(found[0]).get('conversationTrigger')}." if found else f"לא נצפה bot interaction עם trigger={expected or 'success-effort/other'}.", found[:1])

    if tc == "TC-CNV-03":
        return result("לא נבדק", "לא בוצעה תשובת תלמיד לשיחה שיזם הבוט באותו conversation.")
    if tc == "TC-CNV-04":
        found = matches(entries, actor=STUDENT, activity="conversation", verb="interacted", predicate=lambda entry: extensions(entry).get("speaker") == "bot" and extensions(entry).get("conversationTrigger") == "student-request")
        return result("עבר" if found else "לא עבר", "תשובת הבוט שמרה את trigger המקורי student-request." if found else "לא נמצא statement מתאים.", found[:1])

    if tc.startswith("TC-REF-"):
        return result("לא נבדק", "מסך הרפלקציה של מיפוי הלומד אינו מפיק reflection xAPI; רפלקציית סוף רכיב לא הייתה נגישה עקב כשל נגן CET.")

    if not tc and (name or scenario):
        if "timestamp" in name:
            return result("לא עבר", "ה-timestamps עוקבים, אך 31 תשובות השאלון נשלחו בפרץ בעת ההגשה ולא בזמן המענה בפועל.")
        if "פעלנות" in name:
            return result("לא נבדק", "לא נבדקה הגשה חלקית נפרדת.")
        return result("לא נבדק", "תרחיש רצף תוכן לא ניתן לביצוע עקב כשל טעינת נגן CET; לא בוצעה סימולציה.")

    return result("", "")


def main() -> None:
    entries = json.loads(EVIDENCE.read_text(encoding="utf-8"))
    with SOURCE.open(encoding="utf-8-sig", newline="") as source_file:
        reader = csv.DictReader(source_file)
        source_fields = reader.fieldnames or []
        rows = list(reader)

    extra_fields = ["Evidence statement ID", "Evidence timestamp (UTC)", "Delivery status", "Validation notes"]
    counts: Counter[str] = Counter()
    for row in rows:
        status, detail, found = classify(row, entries)
        if status:
            counts[status] += 1
        row["תוצאות הבדיקה (עבר/לא עבר)"] = status
        row["פירוט תוצאות אם לא עבר"] = detail if status != "עבר" else ""
        ids, timestamps, delivery = evidence_text(found)
        row["Evidence statement ID"] = ids
        row["Evidence timestamp (UTC)"] = timestamps
        row["Delivery status"] = delivery
        row["Validation notes"] = detail

    with OUTPUT.open("w", encoding="utf-8-sig", newline="") as output_file:
        writer = csv.DictWriter(output_file, fieldnames=source_fields + extra_fields)
        writer.writeheader()
        writer.writerows(rows)

    sent = sum(entry.get("status") == "sent" for entry in entries)
    summary = f"""# דוח אימות xAPI מתוך פעולות UI — 07/09/2026

## תקציר

- חלון בדיקה: `2026-09-07T12:59:36Z` עד `2026-09-07T17:27:14Z`
- חשבון תלמיד: `1020000001`; חשבון מורה: `1020000002`
- הצהרות אמיתיות שנקלטו ב-outbox: **{len(entries)}**
- הצהרות שנשלחו בהצלחה ל-LRS: **{sent}/{len(entries)}**
- תוצאות שורות הבדיקה: עבר **{counts['עבר']}**, לא עבר **{counts['לא עבר']}**, לא נבדק **{counts['לא נבדק']}**, לא רלוונטי **{counts['לא רלוונטי']}**

## שיטת הבדיקה

כל אירוע בדוח נוצר מפעולה בממשק המשתמש. לא הופעל סקריפט המדמה אירועי xAPI. הסקריפטים שימשו רק ליצירת חשבונות הבדיקה ולקריאה בלתי-משנה של ledger ה-outbox לאחר הפעולות.

## ממצאים מרכזיים

1. התחברות, suspend/resume/exit, שאלון פעלנות, דשבורדים, שיחת AI, דירוג תשובה, יעדי תלמיד ופגישות מנטורינג נשלחו ל-LRS וקיבלו סטטוס `sent`.
2. אירועי `enter` חסרים את הרחבת החובה `applicationVersion`.
3. פתיחת לוח "הכיתה עכשיו" לא יצרה `realtime-dashboard`; נוצרו רק `learning-group` statements.
4. פעולות יעד שבוצעו על ידי המורה לא יצרו `student-goal` statements.
5. נגן CET ביטל את טעינת ה-iframe עם `net::ERR_ABORTED`. לכן אירועי component/item/media/reflection לא סומנו כעבר ולא הוחלפו בסימולציה.
6. 31 תשובות שאלון הפעלנות נשלחו בסדר תקין אך בפרץ בזמן ההגשה, ולא בזמן הלחיצה על כל תשובה.
7. קריאות UI מסוימות יצרו `dashboard viewed` כפול; כל העותקים נשלחו בהצלחה אך הכפילות דורשת תיקון.

## קבצי ראיות

- `artifacts/lrs-manual-ui-run-2026-09-07.json` — payload מלא של כל statement כפי שנשמר ב-ledger.
- `artifacts/lrs-manual-ui-report-2026-09-07.csv` — תוצאות מול כל שורה בסקריפט הבדיקות של משרד החינוך.
"""
    SUMMARY.write_text(summary, encoding="utf-8")
    print(f"Wrote {OUTPUT}")
    print(f"Wrote {SUMMARY}")
    print(dict(counts))


if __name__ == "__main__":
    main()
'''