#!/usr/bin/env python3
"""Fill the ministry's xAPI test script from one run's ledger evidence.

    cd backend && ./.venv/bin/python scripts/lrs_test_script_report.py \
        --evidence artifacts/lrs-run-2026-09-18-local/ledger.json \
        --manifest artifacts/lrs-run-2026-09-18-local/manifest.json \
        --out-dir artifacts/lrs-run-2026-09-18-local --date 2026-09-18 --env local

Inputs: the ledger dump `scripts/lrs_ledger.py --json` wrote for the run's
window (every statement the platform filed, with its delivery status), and
the driver's `manifest.json` (the session ids it closed by tab-close and by
kill, the run window, per-phase notes). Outputs, in `--out-dir`:

- `test-script-xapi-results-<date>-<env>.csv` — the ministry's own columns,
  results filled (עבר / לא עבר / לא נבדק / לא רלוונטי), the deliverable;
- `tc-map.json` — TC → statement ids, timestamps, delivery, notes;
- `lrs-contract-report-<date>-<env>.csv` — the three-column contract index
  with a real statement id per (object type, verb);
- `summary.md`.

Every row is classified from evidence only. Nothing is simulated; a row
without evidence is "לא נבדק" with the reason, never "עבר".
"""

from __future__ import annotations

import argparse
import csv
import json
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Callable, Optional

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "docs" / "LRS" / "test script xAPI.csv"
CONTRACT_TEMPLATE = ROOT / "docs" / "LRS" / "lrs-contract-report.csv"

PASSED, FAILED, NOT_TESTED, NOT_APPLICABLE = "עבר", "לא עבר", "לא נבדק", "לא רלוונטי"
RESULT_COLUMN = "תוצאות הבדיקה (עבר/לא עבר)"
DETAIL_COLUMN = "פירוט תוצאות אם לא עבר"

MEDIA_TYPES = {"video", "audio", "animation"}
DEVICE = {"deviceType", "platform", "operatingSystem", "osVersion", "browser", "browserVersion", "applicationVersion"}
COMPONENT_META = {"skills", "componentPurpose", "isAssessment", "manufacturer", "isRequired", "relativeDifficulty",
                  "masteryLevel", "order", "depthLevel", "cognitiveLevels", "languages", "estimatedTimeInMinutes"}
ITEM_META = {"informationToBot", "contentType", "questions", "componentId"}


# ── Evidence access ──────────────────────────────────────────────────────────
def short(value: Any) -> str:
    return str(value or "").rstrip("/").rsplit("/", 1)[-1]


def stmt(entry: dict) -> dict:
    return entry.get("statement") or {}


def verb_of(entry: dict) -> str:
    return short((stmt(entry).get("verb") or {}).get("id"))


def object_id(entry: dict) -> str:
    return str((stmt(entry).get("object") or {}).get("id") or "")


def object_type(entry: dict) -> str:
    return short(((stmt(entry).get("object") or {}).get("definition") or {}).get("type"))


def result_of(entry: dict) -> dict:
    return stmt(entry).get("result") or {}


def ext_of(entry: dict) -> dict:
    payload = stmt(entry)
    merged = dict(((payload.get("object") or {}).get("definition") or {}).get("extensions") or {})
    merged.update((payload.get("context") or {}).get("extensions") or {})
    return {short(key): value for key, value in merged.items()}


def has_parent(entry: dict) -> bool:
    parents = ((stmt(entry).get("context") or {}).get("contextActivities") or {}).get("parent") or []
    if isinstance(parents, dict):
        parents = [parents]
    return bool(parents and parents[0].get("id"))


def session_of(entry: dict) -> str:
    return str(entry.get("session_id") or "")


def when(entry: dict) -> str:
    return str(stmt(entry).get("timestamp") or entry.get("created_at") or "")


def missing(entry: dict, required: set[str]) -> list[str]:
    values = ext_of(entry)
    return sorted(key for key in required if key not in values or values[key] in (None, "", []))


def session_of(entry: dict) -> str:
    grouping = ((stmt(entry).get("context") or {}).get("contextActivities") or {}).get("grouping") or []
    for activity in grouping:
        activity_id = str(activity.get("id") or "")
        if "/session/" in activity_id:
            return activity_id.rsplit("/", 1)[-1]
    return ""


class Evidence:
    def __init__(self, entries: list[dict], *, student: str, teacher: str, nmm: str, manifest: dict):
        # Scoped to the sessions the driver opened (`manifest.sessions.all`):
        # the test accounts are shared between localhost and dev, and a
        # colleague's lesson on the same account must not pass or fail a row.
        # Sessions the auth layer reopened after an idle exit carry the
        # driver's session as predecessor and are listed by the driver too.
        own = set(manifest.get("all") or [])
        if own:
            entries = [entry for entry in entries if session_of(entry) in own]
        self.entries = sorted(entries, key=when)
        self.student, self.teacher, self.nmm, self.manifest = student, teacher, nmm, manifest

    def find(
        self,
        *,
        actor: Optional[str] = None,
        activity: Optional[str] = None,
        verb: Optional[str] = None,
        suffix: Optional[str] = None,
        where: Optional[Callable[[dict], bool]] = None,
    ) -> list[dict]:
        out = []
        for entry in self.entries:
            if actor and entry.get("exidentifier") != actor:
                continue
            if activity and object_type(entry) != activity:
                continue
            if verb and verb_of(entry) != verb:
                continue
            if suffix and not object_id(entry).endswith(suffix):
                continue
            if where and not where(entry):
                continue
            out.append(entry)
        return out


Outcome = tuple[str, str, list[dict]]


def ok(detail: str, found: list[dict]) -> Outcome:
    return PASSED, detail, found


def fail(detail: str, found: Optional[list[dict]] = None) -> Outcome:
    return FAILED, detail, found or []


def untested(detail: str) -> Outcome:
    return NOT_TESTED, detail, []


def na(detail: str) -> Outcome:
    return NOT_APPLICABLE, detail, []


# ── Per-case rules ───────────────────────────────────────────────────────────
def classify(row: dict, ev: Evidence, row_number: int) -> Outcome:
    tc = row.get("מזהה בדיקה", "").strip()
    name = row.get("שם האירוע", "").strip()
    role = row.get("תפקיד", "").strip()
    verb_column = row.get("Verb (פועל)", "").strip()
    if not tc:
        return sequence(row_number, ev)
    actor = ev.teacher if role.startswith("מורה") else ev.student
    content = ev.student  # the learner's own exidentifier is on every relayed content statement

    # Session
    session_verb = {"TC-SES-01": "enter", "TC-SES-02": "suspend", "TC-SES-03": "resume", "TC-SES-04": "exit",
                    "TC-SES-07": "enter", "TC-SES-08": "exit"}.get(tc)
    if session_verb:
        found = ev.find(actor=actor, activity="session", verb=session_verb)
        if tc == "TC-SES-08":
            sid = ev.manifest.get("relogin_previous_session")
            found = [e for e in found if not sid or session_of(e) == sid]
            if not found:
                return fail("לא נמצא exit לסשן הקודם לאחר התחברות מחדש.")
        if not found:
            return fail("לא נמצא statement מתאים.")
        pick = found[-1:]
        if session_verb == "enter" and (gap := missing(pick[0], DEVICE)):
            return fail(f"enter נשלח אך חסרות הרחבות חובה: {', '.join(gap)}.", pick)
        if session_verb == "exit" and not result_of(pick[0]).get("duration"):
            return fail("exit נשלח ללא result.duration.", pick)
        return ok("ה-statement נשלח עם כל השדות הנדרשים.", pick)
    if tc in {"TC-SES-05", "TC-SES-06"}:
        key = "tab_closed_session" if tc == "TC-SES-05" else "killed_session"
        sid = ev.manifest.get(key)
        if not sid:
            return untested("התרחיש לא הורץ בריצה זו (אין מזהה סשן במניפסט).")
        found = ev.find(activity="session", verb="exit", where=lambda e: session_of(e) == sid)
        if not found:
            return fail(f"לא נמצא exit לסשן {sid} שנסגר ב{'סגירת טאב' if tc == 'TC-SES-05' else 'ניתוק ללא פעילות'}.")
        if not result_of(found[-1]).get("duration"):
            return fail("exit נשלח ללא result.duration.", found[-1:])
        return ok("exit נשלח לסשן שנסגר ללא התנתקות יזומה, עם משך ברוטו.", found[-1:])

    # Dashboards
    dash = {"TC-DSH-01": "student-personal", "TC-DSH-02": "learning-group",
            "TC-DSH-03": "realtime-dashboard", "TC-DSH-04": "student-view"}.get(tc)
    if dash:
        found = ev.find(actor=actor, activity="dashboard", verb="viewed", suffix=dash)
        if not found:
            return fail("לא נמצא dashboard/viewed מתאים.")
        pick = found[-1:]
        expected = ev.student if tc in {"TC-DSH-01", "TC-DSH-04"} else ev.nmm
        actual = ext_of(pick[0]).get("dashboardId")
        if actual != expected:
            return fail(f"dashboardId צריך להיות {expected}; התקבל {actual!r}.", pick)
        if not result_of(pick[0]).get("duration"):
            return fail("viewed נשלח ללא result.duration (משך הצפייה).", pick)
        return ok(f"viewed נשלח עם dashboardId={actual} ומשך צפייה.", pick)

    # Agency questionnaire
    if tc == "TC-QST-01":
        found = ev.find(actor=ev.student, activity="questionnaire", verb="initialized",
                        where=lambda e: object_id(e).lower().endswith("/agency/pre"))
        return ok("שאלון הפעלנות אותחל.", found[:1]) if found else fail("לא נמצא initialized לשאלון הפעלנות.")
    if tc == "TC-QST-02":
        found = ev.find(actor=ev.student, activity="question", verb="answered", where=lambda e: "/agency/" in object_id(e))
        valid = [e for e in found if all(k in (result_of(e).get("score") or {}) for k in ("min", "max", "raw"))
                 and result_of(e).get("response") is not None and has_parent(e)]
        stamps = Counter(when(e) for e in valid)
        shared = sum(n for n in stamps.values() if n > 1)
        if len(valid) < 31:
            return fail(f"נמצאו {len(valid)}/31 תשובות תקינות (parent, response, score min/max/raw).", valid)
        if shared:
            return fail(f"31 תשובות תקינות, אך {shared} מהן חולקות חותמת זמן.", valid)
        return ok("31 תשובות עם parent, response ו-score, כל אחת בחותמת זמן משלה.", valid)
    if tc == "TC-QST-03":
        found = ev.find(actor=ev.student, activity="questionnaire", verb="completed",
                        where=lambda e: object_id(e).lower().endswith("/agency/pre"))
        valid = [e for e in found if result_of(e).get("completion") is True and result_of(e).get("duration")]
        return ok("completion=true ו-duration נשלחו.", valid[-1:]) if valid else fail("חסר completion או duration בסיום השאלון.", found[-1:])

    # Mentoring
    if tc == "TC-MNT-01":
        found = ev.find(actor=ev.student, activity="mentor-student-meeting", verb="completed")
        if not found:
            return fail("לא נמצא completed לפגישת מנטור-תלמיד.")
        pick = found[-1:]
        values = ext_of(pick[0])
        defects = []
        if gap := missing(pick[0], {"mentor", "student", "meetingDate", "mentoringPhase"}):
            defects.append(f"חסר {', '.join(gap)}")
        if values.get("mentor") != ev.teacher or values.get("student") != ev.student:
            defects.append(f"מזהים: mentor={values.get('mentor')}, student={values.get('student')}")
        return fail("; ".join(defects) + ".", pick) if defects else ok("meetingDate, mentoringPhase, mentor ו-student תקינים.", pick)

    # Goals
    goal_verb = {"TC-GOL-01": "initialized", "TC-GOL-02": "initialized", "TC-GOL-03": "updated",
                 "TC-GOL-04": "updated", "TC-GOL-05": "completed", "TC-GOL-06": "completed"}.get(tc)
    if goal_verb:
        teacher_side = role.startswith("מורה")
        found = ev.find(actor=ev.student, activity="student-goal", verb=goal_verb,
                        where=lambda e: bool((stmt(e).get("context") or {}).get("instructor")) == teacher_side)
        if not found:
            if tc == "TC-GOL-04":
                return na("אין במערכת פעולת עדכון יעד על ידי המורה (המורה מאשר יעד — TC-GOL-06).")
            return fail("לא נמצא student-goal מתאים." + (" (עם instructor)" if teacher_side else ""))
        pick = found[-1:]
        return fail("goalType חסר.", pick) if missing(pick[0], {"goalType"}) else ok("אירוע היעד נשלח עם goalType" + (" ו-instructor." if teacher_side else "."), pick)

    # Content — component
    if tc == "TC-CMP-01":
        found = ev.find(actor=content, activity="component", verb="initialized")
        valid = [e for e in found if not missing(e, COMPONENT_META) and has_parent(e)]
        return ok("רכיב אותחל עם מטא-נתונים מלאים ו-parent של יחידת הלימוד.", valid[:1]) if valid else fail("initialized לרכיב חסר מטא-נתונים או parent.", found[:1])
    if tc == "TC-CMP-02":
        found = ev.find(actor=content, activity="component", verb="completed")
        valid = [e for e in found if isinstance(result_of(e).get("success"), bool)
                 and "scaled" in (result_of(e).get("score") or {}) and result_of(e).get("duration")]
        if not found:
            return fail("לא נמצא completed לרכיב.")
        return ok("סיום רכיב עם success, score.scaled ו-duration.", valid[-1:]) if valid else fail("סיום רכיב ללא success/score.scaled/duration.", found[-1:])
    # Content — items
    if tc == "TC-ITM-01":
        found = ev.find(actor=content, activity="questionnaire", verb="initialized", where=lambda e: "/reflection/" not in object_id(e) and "/agency/" not in object_id(e).lower())
        valid = [e for e in found if not missing(e, ITEM_META) and has_parent(e)]
        return ok("שאלון פנימי אותחל עם מטא-נתוני פריט ו-parent של הרכיב.", valid[:1]) if valid else fail("שאלון פנימי אותחל אך חסרים מטא-נתוני פריט.", found[:1])
    if tc == "TC-ITM-02":
        found = ev.find(actor=content, activity="question", verb="answered", where=lambda e: "/reflection/" not in object_id(e) and "/agency/" not in object_id(e).lower())
        valid = [e for e in found if result_of(e).get("response") is not None and isinstance(result_of(e).get("success"), bool)
                 and "scaled" in (result_of(e).get("score") or {}) and not missing(e, {"questionId", "questionType", "attemptNumber"}) and has_parent(e)]
        outcomes = {result_of(e).get("success") for e in valid}
        if outcomes == {True, False}:
            return ok("תשובות עם response, success (נכון ושגוי), score.scaled, questionId/questionType/attemptNumber ו-parent.", valid)
        return fail(f"נמצאו תשובות תקינות עם success={sorted(outcomes)} בלבד." if valid else "לא נמצאה תשובה תקינה לשאלה בתוכן.", valid or found[:1])
    if tc == "TC-ITM-03":
        found = ev.find(actor=content, activity="questionnaire", verb="completed", where=lambda e: "/reflection/" not in object_id(e) and "/agency/" not in object_id(e).lower())
        valid = [e for e in found if "scaled" in (result_of(e).get("score") or {}) and result_of(e).get("duration")]
        return ok("שאלון פנימי הושלם עם score ו-duration.", valid[-1:]) if valid else fail("שאלון פנימי הושלם ללא score/duration.", found[-1:])
    if tc == "TC-ITM-04":
        return na("ב-1.1 הדילוג הוא ברמת הרכיב (TC-ITM-12); אין דילוג ברמת פריט.")
    if tc == "TC-ITM-12":
        return na("לא נתמך: באפליקציה אין דילוג על רכיב (\"אני כבר יודע/ת\"), ולכן האירוע skipped ברמת רכיב אינו נשלח.")
    if tc in {"TC-ITM-05", "TC-ITM-06", "TC-ITM-07"}:
        wanted = {"TC-ITM-05": "played", "TC-ITM-06": "paused", "TC-ITM-07": "completed"}[tc]
        found = ev.find(actor=content, verb=wanted, where=lambda e: object_type(e) in MEDIA_TYPES or ext_of(e).get("mediaFormat") in MEDIA_TYPES)
        if not found:
            return fail(f"לא נמצא {wanted} על פריט מדיה.")
        needs_duration = tc != "TC-ITM-05"
        valid = [e for e in found if object_type(e) in MEDIA_TYPES and ext_of(e).get("mediaFormat") in MEDIA_TYPES
                 and (not needs_duration or result_of(e).get("duration"))]
        if not valid:
            return fail(f"{wanted} נשלח אך ה-object אינו מסוג מדיה או חסר mediaFormat/duration.", found[-1:])
        return ok(f"{wanted} על אובייקט {object_type(valid[-1])} עם mediaFormat" + (" ו-duration." if needs_duration else "."), valid[-1:])
    if tc == "TC-ITM-08":
        found = ev.find(actor=content, verb="requested", where=lambda e: ext_of(e).get("helpSource") == "content")
        valid = [e for e in found if ext_of(e).get("helpType") in {"hint", "explanation"}]
        return ok("בקשת עזרה מהתוכן עם helpSource=content ו-helpType.", valid[-1:]) if valid else (fail("requested מהתוכן ללא helpType תקין.", found[-1:]) if found else untested("בריצה זו לא נלחץ כפתור העזרה שבתוך הלומדה."))
    if tc == "TC-ITM-09" and verb_column == "requested":
        found = ev.find(actor=content, verb="requested", where=lambda e: ext_of(e).get("helpSource") == "platform")
        valid = [e for e in found if ext_of(e).get("helpType") in {"hint", "explanation"}]
        return ok("בקשת עזרה מהפלטפורמה עם helpSource=platform ו-helpType.", valid[-1:]) if valid else fail("לא נמצאה בקשת עזרה תקינה מהפלטפורמה.", found[-1:])
    if tc == "TC-ITM-09" and verb_column == "selected":
        found = ev.find(actor=content, verb="selected")
        valid = [e for e in found if ext_of(e).get("selectionType") in {"learning-type", "practice-decision", "is-understood", "is-repeat", "external-learning"}
                 and result_of(e).get("response") is not None]
        return ok(f"selected עם selectionType={ext_of(valid[-1]).get('selectionType')} ו-response.", valid[-1:]) if valid else fail("לא נמצא selected עם selectionType מהרשימה.", found[-1:])
    if tc in {"TC-ITM-10", "TC-ITM-11"}:
        expected = tc == "TC-ITM-10"
        found = ev.find(actor=content, activity="component", verb="completed",
                        where=lambda e: result_of(e).get("success") is expected and ext_of(e).get("isAssessment") is True)
        valid = [e for e in found if "scaled" in (result_of(e).get("score") or {}) and result_of(e).get("duration")]
        if valid:
            return ok(f"סיום רכיב הערכה עם success={str(expected).lower()}, score.scaled ו-duration.", valid[-1:])
        return fail(f"סיום רכיב הערכה עם success={str(expected).lower()} נמצא ללא score/duration.", found[-1:]) if found else untested(f"בריצה זו לא הושלם רכיב הערכה עם success={str(expected).lower()}.")

    # Conversation
    if tc == "TC-CNV-01":
        found = ev.find(actor=ev.student, activity="conversation", verb="interacted",
                        where=lambda e: ext_of(e).get("speaker") == "student" and ext_of(e).get("conversationTrigger") == "student-request")
        valid = [e for e in found if not missing(e, {"helpType", "componentId", "itemId"})]
        return ok("פניית תלמיד עם speaker, conversationTrigger, helpType, componentId ו-itemId, ללא תוכן השיחה.", valid[-1:]) if valid else fail("פניית תלמיד חסרה שדות חובה.", found[-1:])
    if tc == "TC-CNV-02" and verb_column == "rated":
        found = ev.find(actor=ev.student, activity="conversation", verb="rated")
        valid = [e for e in found if result_of(e).get("response") in {"like", "dislike"} and ext_of(e).get("conversationType")]
        return ok("דירוג תשובת הבוט עם like/dislike ו-conversationType.", valid[-1:]) if valid else fail("דירוג ללא response/conversationType.", found[-1:])
    if tc == "TC-CNV-02":
        expected = {"student-error"} if "כשלון" in name else {"idle-time"} if "זמן רב" in name else {"success-effort", "other"}
        found = ev.find(actor=ev.student, activity="conversation", verb="interacted",
                        where=lambda e: ext_of(e).get("speaker") == "bot" and ext_of(e).get("conversationTrigger") in expected)
        valid = [e for e in found if not missing(e, {"helpType", "componentId", "itemId"})]
        if valid:
            return ok(f"פנייה יזומה של הבוט עם conversationTrigger={ext_of(valid[-1]).get('conversationTrigger')} וכל השדות.", valid[-1:])
        return fail(f"פנייה יזומה של הבוט עם {sorted(expected)} נמצאה ללא כל השדות.", found[-1:]) if found else untested(f"בריצה זו לא התרחשה פנייה יזומה מסוג {sorted(expected)}.")
    if tc == "TC-CNV-03":
        found = ev.find(actor=ev.student, activity="conversation", verb="interacted",
                        where=lambda e: ext_of(e).get("speaker") == "student" and ext_of(e).get("conversationTrigger") in {"success-effort", "idle-time", "student-error", "other"})
        return ok("תגובת התלמיד לפנייה יזומה שמרה על ה-conversationTrigger של הבוט.", found[-1:]) if found else untested("בריצה זו התלמיד לא הגיב לפנייה יזומה.")
    if tc == "TC-CNV-04":
        found = ev.find(actor=ev.student, activity="conversation", verb="interacted",
                        where=lambda e: ext_of(e).get("speaker") == "bot" and ext_of(e).get("conversationTrigger") == "student-request")
        return ok("תשובת הבוט לפניית תלמיד עם conversationTrigger=student-request.", found[-1:]) if found else fail("לא נמצאה תשובת בוט לפניית תלמיד.")

    # Reflection
    if tc.startswith("TC-REF-"):
        verb = {"TC-REF-01": "initialized", "TC-REF-02": "answered", "TC-REF-03": "skipped", "TC-REF-04": "completed"}[tc]
        activity = "questionnaire" if tc in {"TC-REF-01", "TC-REF-04"} else "question"
        found = ev.find(actor=ev.student, activity=activity, verb=verb, where=lambda e: "/reflection/" in object_id(e))
        if tc == "TC-REF-01":
            valid = [e for e in found if ext_of(e).get("reflectionTrigger") in {"end-of-learning-objective", "end-of-learning-component", "difficult-task", "other"}]
        elif tc == "TC-REF-02":
            valid = [e for e in found if (result_of(e).get("response") not in (None, "")) != bool(result_of(e).get("score")) and has_parent(e)]
        elif tc == "TC-REF-03":
            valid = [e for e in found if has_parent(e)]
        else:
            valid = [e for e in found if "completion" in result_of(e) and result_of(e).get("duration")]
        return ok(f"רפלקציה: {verb} עם מזהי reflection והשדות הנדרשים.", valid[-1:]) if valid else fail(f"רפלקציה: {verb} חסר שדות.", found[-1:])

    return untested("אין כלל סיווג לשורה זו.")


def sequence(row_number: int, ev: Evidence) -> Outcome:
    """The un-numbered sequence rows at the end of the script (55–62)."""
    content = ev.student
    by_object: dict[str, list[dict]] = defaultdict(list)
    for entry in ev.entries:
        if entry.get("exidentifier") == content and object_type(entry) in {"component", "questionnaire", "item", *MEDIA_TYPES}:
            by_object[object_id(entry)].append(entry)
    if row_number == 55:
        for events in by_object.values():
            started = [e for e in events if verb_of(e) == "initialized"]
            if started and not any(verb_of(e) == "completed" for e in events):
                return ok("אובייקט תוכן אותחל ולא הושלם (נטישה).", started[:1])
        return untested("לא נמצא אובייקט תוכן שאותחל ולא הושלם.")
    if row_number == 56:
        for events in by_object.values():
            started = [e for e in events if verb_of(e) == "initialized"]
            if len(started) >= 2:
                return ok("אותו אובייקט תוכן אותחל שוב לאחר הפסקה.", started[:2])
        return untested("לא נמצא אתחול חוזר של אותו אובייקט.")
    if row_number in {57, 58}:
        wanted = [False, True] if row_number == 57 else [False, False]
        for events in by_object.values():
            pass
        answers = [e for e in ev.entries if e.get("exidentifier") == content and verb_of(e) == "answered" and "/reflection/" not in object_id(e) and "/agency/" not in object_id(e).lower()]
        by_question: dict[str, list[dict]] = defaultdict(list)
        for e in answers:
            by_question[object_id(e)].append(e)
        for tries in by_question.values():
            successes = [result_of(e).get("success") for e in tries]
            for i in range(len(successes) - 1):
                if successes[i:i + 2] == wanted:
                    return ok("ניסיון שגוי ואחריו " + ("הצלחה." if wanted[-1] else "שגיאה נוספת."), tries[i:i + 2])
        return untested("לא נמצא רצף ניסיונות מתאים על אותה שאלה.")
    if row_number == 59:
        ordered = ev.entries
        exits = [i for i, e in enumerate(ordered) if verb_of(e) == "exit" and e.get("exidentifier") == content]
        enters = [i for i, e in enumerate(ordered) if verb_of(e) == "enter" and e.get("exidentifier") == content]
        for events in by_object.values():
            starts = [ordered.index(e) for e in events if verb_of(e) == "initialized"]
            for first in starts:
                for exit_index in exits:
                    later_enters = [i for i in enters if i > exit_index]
                    later_starts = [i for i in starts if i > exit_index]
                    if first < exit_index and later_enters and later_starts and later_enters[0] < later_starts[0]:
                        return ok("אותו אובייקט נפתח מחדש לאחר exit ו-enter של סשן חדש.", [ordered[first], ordered[exit_index], ordered[later_enters[0]], ordered[later_starts[0]]])
        return untested("לא נמצא רצף חזרה בין סשנים לאותו אובייקט.")
    if row_number == 60:
        per_actor: dict[str, Counter] = defaultdict(Counter)
        for e in ev.entries:
            per_actor[str(e.get("exidentifier"))][when(e)] += 1
        shared = sum(n for c in per_actor.values() for n in c.values() if n > 1)
        return ok("כל האירועים של כל משתמש בחותמות זמן שונות ובסדר ביצוע.", []) if not shared else fail(f"{shared} אירועים חולקים חותמת זמן עם אירוע אחר של אותו משתמש.", [])
    if row_number == 61:
        requested = ev.find(actor=content, verb="requested", where=lambda e: ext_of(e).get("helpSource") == "platform")
        return ok("רצף תוכן עם אתחול, בקשת עזרה מהפלטפורמה, תשובות וסיום.", requested[-1:]) if requested else untested("לא נמצאה בקשת עזרה במהלך משימה.")
    if row_number == 62:
        return na("שאלון הפעלנות דורש 31 תשובות; הגשה חלקית אינה אפשרית במוצר.")
    return na("שורת כותרת/הפרדה במסמך המקור; נשמרה כפי שהיא.")


# ── Contract index ───────────────────────────────────────────────────────────
def contract_evidence(ev: Evidence, kind: str, verb: str) -> list[dict]:
    s, t = ev.student, ev.teacher
    rules: dict[str, Callable[[], list[dict]]] = {
        "questionnaire (agency)": lambda: ev.find(actor=s, activity="questionnaire", verb=verb, where=lambda e: "/agency/" in object_id(e).lower()),
        "question (agency)": lambda: ev.find(actor=s, activity="question", verb=verb, where=lambda e: "/agency/" in object_id(e).lower()),
        "questionnaire (reflection)": lambda: ev.find(actor=s, activity="questionnaire", verb=verb, where=lambda e: "/reflection/" in object_id(e)),
        "question (reflection)": lambda: ev.find(actor=s, activity="question", verb=verb, where=lambda e: "/reflection/" in object_id(e)),
        "video / audio / animation (media)": lambda: ev.find(actor=s, verb=verb, where=lambda e: object_type(e) in MEDIA_TYPES),
        "component / item": lambda: ev.find(actor=s, verb=verb, where=lambda e: object_type(e) in {"component", "item"}),
        "questionnaire": lambda: ev.find(actor=s, activity="questionnaire", verb=verb, where=lambda e: "/reflection/" not in object_id(e) and "/agency/" not in object_id(e).lower()),
        "question": lambda: ev.find(actor=s, activity="question", verb=verb, where=lambda e: "/reflection/" not in object_id(e) and "/agency/" not in object_id(e).lower()),
        "dashboard": lambda: ev.find(activity="dashboard", verb=verb),
        "session": lambda: ev.find(activity="session", verb=verb),
        "mentor-student-meeting": lambda: ev.find(activity="mentor-student-meeting", verb=verb),
        "student-goal": lambda: ev.find(activity="student-goal", verb=verb),
        "conversation": lambda: ev.find(activity="conversation", verb=verb),
    }
    rule = rules.get(kind)
    if rule:
        return rule()
    return ev.find(actor=s if kind in {"component", "item", "learning-unit"} else None, activity=kind, verb=verb)


# ── Main ─────────────────────────────────────────────────────────────────────
def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--evidence", required=True, help="ledger JSON from scripts/lrs_ledger.py --json")
    parser.add_argument("--manifest", default=None, help="driver manifest.json (session ids per scenario)")
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--date", required=True)
    parser.add_argument("--env", default="local")
    parser.add_argument("--student", default="1020000001")
    parser.add_argument("--teacher", default="1020000002")
    parser.add_argument("--nmm", default="90635956")
    args = parser.parse_args()

    entries = json.loads(Path(args.evidence).read_text(encoding="utf-8"))
    manifest = json.loads(Path(args.manifest).read_text(encoding="utf-8")) if args.manifest else {}
    ev = Evidence(entries, student=args.student, teacher=args.teacher, nmm=args.nmm, manifest=manifest.get("sessions") or manifest)
    out = Path(args.out_dir)
    out.mkdir(parents=True, exist_ok=True)

    with SOURCE.open(encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        fields = reader.fieldnames or []
        rows = list(reader)

    counts: Counter[str] = Counter()
    tc_map: dict[str, Any] = {}
    for number, row in enumerate(rows, start=1):
        status, detail, found = classify(row, ev, number)
        counts[status] += 1
        row[RESULT_COLUMN] = status
        row[DETAIL_COLUMN] = "" if status == PASSED else detail
        key = row.get("מזהה בדיקה", "").strip() or f"row-{number}"
        tc_map.setdefault(key, []).append({
            "row": number, "verb": row.get("Verb (פועל)", "").strip(), "status": status, "detail": detail,
            "statement_ids": [e.get("id") for e in found],
            "timestamps": [when(e) for e in found],
            "delivery": sorted({str(e.get("status")) for e in found}),
        })

    results_csv = out / f"test-script-xapi-results-{args.date}-{args.env}.csv"
    with results_csv.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows({field: row.get(field, "") for field in fields} for row in rows)
    (out / "tc-map.json").write_text(json.dumps(tc_map, ensure_ascii=False, indent=2), encoding="utf-8")

    missing_contract: list[str] = []
    contract_csv = out / f"lrs-contract-report-{args.date}-{args.env}.csv"
    with CONTRACT_TEMPLATE.open(encoding="utf-8-sig", newline="") as handle:
        template = list(csv.DictReader(handle))
    with contract_csv.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=["Object Type", "Verb", "Id"])
        writer.writeheader()
        for row in template:
            found = contract_evidence(ev, row["Object Type"], row["Verb"])
            if not found:
                missing_contract.append(f"{row['Object Type']}:{row['Verb']}")
            writer.writerow({"Object Type": row["Object Type"], "Verb": row["Verb"], "Id": found[-1]["id"] if found else ""})

    sent = sum(e.get("status") == "sent" for e in entries)
    not_sent = [e for e in entries if e.get("status") != "sent"]
    summary = "\n".join([
        f"# דוח תסריט הבדיקות xAPI — {args.date} · {args.env}",
        "",
        f"- הצהרות בחלון הריצה: **{len(entries)}**, נשלחו בהצלחה: **{sent}**" + (f", לא נשלחו: **{len(not_sent)}**" if not_sent else ""),
        f"- שורות: עבר **{counts[PASSED]}**, לא עבר **{counts[FAILED]}**, לא נבדק **{counts[NOT_TESTED]}**, לא רלוונטי **{counts[NOT_APPLICABLE]}**",
        f"- חשבונות: תלמיד `{args.student}`, מורה `{args.teacher}`, NMM `{args.nmm}`",
        f"- חלון: {manifest.get('started_at', '?')} → {manifest.get('finished_at', '?')}",
        "",
        "## שורות שלא עברו / לא נבדקו",
        *[f"- {key} ({item['verb']}): {item['status']} — {item['detail']}"
          for key, items in tc_map.items() for item in items if item["status"] in (FAILED, NOT_TESTED)],
        "",
        "## אינדקס החוזה ללא ראיה" if missing_contract else "## אינדקס החוזה: לכל שורה יש statement",
        *[f"- {row}" for row in missing_contract],
        "",
        "## הצהרות שלא נשלחו" if not_sent else "",
        *[f"- {e.get('id')} {verb_of(e)} {object_type(e)}: {e.get('status')} {e.get('last_error') or ''}" for e in not_sent[:50]],
    ])
    (out / "summary.md").write_text(summary.strip() + "\n", encoding="utf-8")
    print(summary)
    print(f"\n📄 {results_csv}\n📄 {contract_csv}\n📄 {out / 'tc-map.json'}\n📄 {out / 'summary.md'}")
    return 0 if not counts[FAILED] else 1


if __name__ == "__main__":
    raise SystemExit(main())
