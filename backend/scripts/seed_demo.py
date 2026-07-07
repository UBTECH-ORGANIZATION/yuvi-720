"""Seed a runnable end-to-end 720 demo dataset.

Populates a small, realistic cohort so the WHOLE flow is demoable *now* — mapping,
dashboards, the floating companion, adaptive routing, teacher insights, mentoring
goals — without any external MoE catalog / xAPI-MCP provider yet.

Design law (architecture §9, §5.7): **numbers are never invented**. This script
does NOT hand-write mastery/progress. It drives the *real* pipelines:
  - Onboarding agent derives profile/activeness/strengths/challenges from mapping.
  - Real xAPI statements are ingested through the LRS (`ingest_statement`) so
    mastery / progress / misconceptions / attention flags come from actual events.
  - Mentoring goals mirror into the brain; reflections and a teacher directive are
    added through their real services.

Idempotent: it wipes the three demo learners' docs first, then reseeds. Safe to
re-run. Run:  cd backend && ./.venv/bin/python scripts/seed_demo.py
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from typing import Any, Optional

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.env import ensure_env_loaded  # noqa: E402  (loads .env for scripts)

ensure_env_loaded()

from app.agents import reflection, teacher_insights  # noqa: E402
from app.agents.onboarding import run_onboarding  # noqa: E402
from app.brain import org  # noqa: E402
from app.brain.repository import _get_collection_named, apply_brain_updates, get_brain  # noqa: E402
from app.services import mentoring  # noqa: E402
from app.services.events import ACTIVITY_IRI_BASE, VERB_IRI_BASE, ingest_statement  # noqa: E402

GROUP = "group-7a-math"


# ── xAPI helpers (statements go through the real LRS ingest) ─────────────────
def _launch(lid: str, objective_id: str, subject: str, component_id: str) -> dict[str, Any]:
    return {"lid": lid, "obj": objective_id, "subj": subject, "cmp": component_id}


def _stmt(
    lid: str, sid: str, verb: str, *, object_id: str, object_type: str,
    subject: str, objective_id: str, success: Optional[bool] = None,
    scaled: Optional[float] = None, misconception: Optional[str] = None,
    is_assessment: bool = False, resume: Optional[dict] = None,
) -> dict[str, Any]:
    ext: dict[str, Any] = {"objective_id": objective_id, "subject": subject}
    if misconception:
        ext["misconception"] = misconception
    if is_assessment:
        ext["is_assessment"] = True
    if resume is not None:
        ext["resume_token"] = resume
    statement: dict[str, Any] = {
        "id": sid,
        "actor": {"account": {"name": lid, "homePage": "https://yuvilab.spark"}},
        "verb": {"id": VERB_IRI_BASE + verb},
        "object": {"id": object_id, "definition": {"type": ACTIVITY_IRI_BASE + object_type}},
        "context": {"extensions": ext},
    }
    result: dict[str, Any] = {}
    if success is not None:
        result["success"] = success
    if scaled is not None:
        result["score"] = {"scaled": scaled}
    if result:
        statement["result"] = result
    return statement


async def _emit(lid: str, sid: str, verb: str, **kw) -> None:
    await ingest_statement(_stmt(lid, sid, verb, **kw), _launch(lid, kw["objective_id"], kw["subject"], kw["object_id"].rsplit("-q", 1)[0]))


async def master_objective(lid: str, objective_id: str, subject: str, component_id: str, qcount: int = 2) -> None:
    """Emit answered(correct) × N then a passing `completed` assessment → mastered."""
    for i in range(1, qcount + 1):
        await _emit(lid, f"seed-{lid}-{component_id}-q{i}", "answered",
                    object_id=f"{component_id}-q{i}", object_type="question",
                    subject=subject, objective_id=objective_id, success=True, scaled=1.0,
                    resume={"slide": i})
    await _emit(lid, f"seed-{lid}-{component_id}-done", "completed",
                object_id=component_id, object_type="assignment",
                subject=subject, objective_id=objective_id, success=True, scaled=0.9,
                is_assessment=True, resume={"slide": qcount})


async def working_objective(lid: str, objective_id: str, subject: str, component_id: str) -> None:
    """A dip then a recovery (ends on success → NOT an attention flag)."""
    await _emit(lid, f"seed-{lid}-{component_id}-q1", "answered",
                object_id=f"{component_id}-q1", object_type="question",
                subject=subject, objective_id=objective_id, success=False, scaled=0.0)
    await _emit(lid, f"seed-{lid}-{component_id}-q2", "answered",
                object_id=f"{component_id}-q2", object_type="question",
                subject=subject, objective_id=objective_id, success=True, scaled=1.0,
                resume={"slide": 2})


async def struggle_objective(lid: str, objective_id: str, subject: str, component_id: str, misconception: str) -> None:
    """3 consecutive fails on the current objective → low-success attention flag."""
    for i in range(1, 4):
        await _emit(lid, f"seed-{lid}-{component_id}-q{i}", "answered",
                    object_id=f"{component_id}-q{i}", object_type="question",
                    subject=subject, objective_id=objective_id, success=False, scaled=0.0,
                    misconception=misconception, resume={"slide": i})


# ── Cleanup (idempotency) ────────────────────────────────────────────────────
async def _wipe(lids: list[str]) -> None:
    plans = [
        ("learners", "_id"), ("learner_state", "_id"),
        ("learning_events", "learner_id"), ("agent_sessions", "learner_id"),
        ("reflections", "learner_id"), ("mentoring_conversations", "learner_id"),
        ("feedback_reports", "learner_id"),
    ]
    for name, field in plans:
        col = _get_collection_named(name)
        if col is None:
            continue
        for lid in lids:
            try:
                if field == "_id":
                    await col.delete_one({"_id": lid})
                    await col.delete_many({"learner_id": lid})
                else:
                    await col.delete_many({field: lid})
            except Exception:
                pass


# ── Personas ─────────────────────────────────────────────────────────────────
PERSONAS = [
    {
        "lid": "demo-learner", "name": "יובל כהן",
        "free_text": "אני ממש אוהב כדורסל ומחשבים",
        "scores": {
            "academic": {"interest": 85, "relevance": 80, "investment": 88},
            "psycho_pedagogical": {"motivation": 82, "autonomy": 86, "cognitive": 78, "self_awareness": 80},
            "environmental": {"school_climate": 75, "tech_comfort": 90, "focus": 80},
        },
    },
    {
        "lid": "demo-learner-noa", "name": "נועה לוי",
        "free_text": "אני אוהבת ציור ומוזיקה",
        "scores": {
            "academic": {"interest": 55, "relevance": 52, "investment": 58},
            "psycho_pedagogical": {"motivation": 50, "autonomy": 48, "cognitive": 55, "self_awareness": 60},
            "environmental": {"school_climate": 62, "tech_comfort": 70, "focus": 45},
        },
    },
    {
        "lid": "demo-learner-adam", "name": "אדם ברק",
        "free_text": "אני סקרן לגבי חלל ורובוטיקה",
        "scores": {
            "academic": {"interest": 72, "relevance": 68, "investment": 70},
            "psycho_pedagogical": {"motivation": 68, "autonomy": 65, "cognitive": 66, "self_awareness": 64},
            "environmental": {"school_climate": 70, "tech_comfort": 75, "focus": 62},
        },
    },
]


async def seed_persona(p: dict[str, Any]) -> None:
    lid, name, scores = p["lid"], p["name"], p["scores"]
    # F2 Onboarding — mirror the /api/submit route (system lane + agent).
    await apply_brain_updates(lid, {
        "profile.mapping_scores": scores,
        "identity.display_name": name,
        "identity.locale": "he",
    })
    await run_onboarding(lid, scores, "he", free_text=p["free_text"])


async def main() -> None:
    lids = [p["lid"] for p in PERSONAS]
    await _wipe(lids)

    # Mapping + profile for everyone.
    for p in PERSONAS:
        await seed_persona(p)

    # ── F1 learning events → real mastery/progress (never invented) ──────────
    # יובל — strong: masters angles + a science unit, mid-way through vertical.
    await master_objective("demo-learner", "math-angles", "math", "YuviDori-math-angles-0001-lesson")
    await working_objective("demo-learner", "math-angles-vertical", "math", "YuviDori-math-vertical-0002-practice")
    await master_objective("demo-learner", "sci-matter-states", "science", "Yuvi-sci-matter-0001")

    # נועה — struggling in angles: 3 consecutive fails → attention flag + misconception.
    await struggle_objective("demo-learner-noa", "math-angles", "math",
                             "YuviDori-math-angles-0001-lesson", "angle_type_confusion")

    # אדם — science-leaning, mid: masters matter states, working on circuits.
    await master_objective("demo-learner-adam", "sci-matter-states", "science", "Yuvi-sci-matter-0001")
    await working_objective("demo-learner-adam", "sci-circuit-basic", "science", "Yuvi-sci-circuit-0003")

    # ── F5 mentoring goals (mirror into brain.goals for the dashboard) ───────
    await mentoring.create_conversation({
        "learner_id": "demo-learner", "teacher_name": "רותם לוי", "learner_name": "יובל כהן",
        "meeting_stage": "הצבת יעדים", "notes": "יובל מוטיבציוני וחזק בגאומטריה. סיכמנו לשמר קצב ולהוסיף אתגר.",
        "next_steps": "לתרגל זוויות 10 דקות ביום ולנסות אתגר מתקדם", "deadline": "2026-07-20",
        "visibility": "shared",
    })
    await mentoring.create_conversation({
        "learner_id": "demo-learner-noa", "teacher_name": "רותם לוי", "learner_name": "נועה לוי",
        "meeting_stage": "תמיכה וליווי", "notes": "נועה מתקשה בזיהוי סוגי זוויות ומתוסכלת מעט.",
        "next_steps": "לצפות בסרטון קצר על זוויות ולתרגל 3 שאלות מודרכות", "deadline": "2026-07-15",
        "visibility": "shared", "teacher_only_note": "רגישה לתסכול — לעודד בעדינות ולפרק לצעדים.",
    })

    # ── Reflections (F4 self-awareness: self vs system estimate) ─────────────
    await reflection.store_reflection("demo-learner", "hard_task",
                                      "היה מאתגר בהתחלה אבל הבנתי את סוגי הזוויות בסוף",
                                      self_rating=4, system_estimate=0.85)
    await reflection.store_reflection("demo-learner-adam", "interval",
                                      "גיליתי שאני לומד הכי טוב עם סימולציות ולא רק טקסט",
                                      self_rating=3, system_estimate=0.6)

    # ── F6 teacher directive (portal write lane; steers decisions, not numbers) ─
    try:
        await teacher_insights.add_directive(
            "teacher-demo", "demo-learner",
            "להציע אתגר מתקדם בזוויות ולשלב דוגמאות מהעולם של כדורסל", priority="normal")
    except Exception as exc:
        print(f"⚠️ directive seed skipped: {exc}")

    # ── Summary ──────────────────────────────────────────────────────────────
    print("\n" + "=" * 60)
    print("DEMO SEED COMPLETE — cohort in", GROUP)
    for lid in lids:
        brain = await get_brain(lid)
        prof = brain.get("profile") or {}
        mastered = sum(1 for m in (brain.get("mastery") or {}).values()
                       if isinstance(m, dict) and m.get("achieved"))
        print(f"  · {lid:<18} {brain.get('identity', {}).get('display_name', '?'):<10} "
              f"mastered={mastered} goals={len(brain.get('goals') or [])} "
              f"interests={prof.get('interests') or []}")
    print("=" * 60)
    print("Teacher demo:  teacher-demo · admin-demo   Group: group-7a-math")
    print("Open the app, then visit /student-dashboard and /teacher-view.")


if __name__ == "__main__":
    asyncio.run(main())
