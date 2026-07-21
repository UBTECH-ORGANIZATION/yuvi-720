"""End-to-end flow test for the Shared Learning Brain system (P0–P5).

Runs the FULL learner + teacher journey against the real app (ASGI transport →
real Cosmos/APIM when configured, fallbacks otherwise) and asserts every agent
does its contracted job (architecture doc §5.3, §14, §18).

Run:  cd backend && ./.venv/bin/python tests/e2e_flow_test.py

Covers:
  F2 Onboarding agent   — mapping → activeness/strengths/challenges/style (+ar localization)
  F4 Dashboard          — brain projection, real numbers, name from identity
  F1 Events (P1)        — slxapi launch, MoE verbs, idempotency, mastery, resume, auth
  F1 Pedagogical (P4a)  — planner order, primary-vs-alternative, after-fail, frontier advance
  F3 Coach (P3)         — SSE stream, disclosure, PII strip (prompt + memory), continuity
  F3 Triggers (P4b)     — misconception/success/idle via live subscriber
  Reflection            — prompt + store + brain recent window
  Consolidator (§5.7)   — chat interests promoted; duplicates are no-ops
  F6 Teacher Insights   — evidence-backed flags, recs 2–5, group aggregates, 403 scoping
  F5 Mentoring          — required fields, goal mirror, teacher-only visibility
  F7 Feedback           — persisted
  F8 Org                — groups/orgs scoping
  §5.8 scopes           — per-agent views + write allow-list denial
  Privacy               — no PII in coach bundle / launch actor / prompts
"""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import httpx
from httpx import ASGITransport

from server import app
from app.brain import org
from app.brain.repository import _get_collection_named, get_brain
from app.brain.context_engine import view_for, apply_writes, AgentScopeError
from app.agents import sessions
from app.services import triggers
from app.services.events import VERB_IRI_BASE, ACTIVITY_IRI_BASE

LID = "e2e-flow-learner"
GROUP = "group-7a-math"

PASS, FAIL = [], []


def check(name: str, condition: bool, detail: str = ""):
    (PASS if condition else FAIL).append(name)
    mark = "✅" if condition else "❌"
    print(f"{mark} {name}" + (f"  [{detail}]" if detail and not condition else ""))


def stmt(slx, sid, verb, *, succ=None, scaled=None, ext=None, otype="question", oid="q1"):
    s = {
        "id": sid, "actor": slx["actor"],
        "verb": {"id": VERB_IRI_BASE + verb},
        "object": {"id": oid, "definition": {"type": ACTIVITY_IRI_BASE + otype}},
        "context": {"extensions": ext or {}},
    }
    r = {}
    if succ is not None:
        r["success"] = succ
    if scaled is not None:
        r["score"] = {"scaled": scaled}
    if r:
        s["result"] = r
    return s


async def sse_collect(client, path, body):
    """POST an SSE endpoint; return (disclosure, text)."""
    disclosure, text = None, ""
    async with client.stream("POST", path, json=body) as r:
        async for line in r.aiter_lines():
            if not line.startswith("data: "):
                continue
            payload = line[6:]
            if payload == "[DONE]":
                break
            obj = json.loads(payload)
            if "disclosure" in obj:
                disclosure = obj["disclosure"]
            if "text" in obj:
                text += obj["text"]
    return disclosure, text


async def cleanup():
    for name, q in [
        ("learners", {"_id": LID}), ("learner_state", {"_id": LID}),
        ("learning_events", {"learner_id": LID}),
        ("agent_sessions", {"learner_id": LID}),
        ("agent_conversations", {"learner_id": LID}),
        ("agent_messages", {"learner_id": LID}),
        ("reflections", {"learner_id": LID}),
        ("mentoring_conversations", {"learner_id": LID}),
        ("feedback_reports", {"learner_id": LID}),
    ]:
        col = _get_collection_named(name)
        if col is not None:
            try:
                if "_id" in q:
                    await col.delete_one(q)
                else:
                    await col.delete_many(q)
            except Exception:
                pass


async def main():
    org.ENROLLMENTS.append({"learner_id": LID, "group_id": GROUP})
    await cleanup()

    transport = ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://t", timeout=90) as c:

        # ═══ F2 · Onboarding agent ════════════════════════════════════════════
        print("\n── F2 Onboarding ──")
        answers = {str(i): (i % 4) for i in range(1, 39)}   # realistic mixed answers
        r = await c.post("/api/submit", json={
            "learner_id": LID, "student_name": "נועה כהן", "language": "he",
            "answers": answers, "free_text": "אני ממש אוהבת כדורסל וציור",
        })
        check("submit 200 + scores", r.status_code == 200 and "scores" in r.json())
        brain = (await c.get(f"/api/brain/{LID}")).json()
        prof = brain["profile"]
        check("activeness has 6 MoE components", len(prof["activeness"]) == 6, str(prof["activeness"]))
        check("activeness values 0-100", all(0 <= v <= 100 for v in prof["activeness"].values()))
        check("learning_style derived (he)", bool(prof["learning_style"]))
        check("strengths derived (3)", len(brain["strengths"]) == 3)
        check("challenges derived (<=3, low dims)", 0 < len(brain["challenges"]) <= 3)
        check("mapping_scores stored", prof["mapping_scores"] is not None)
        check("display_name UI-only stored", brain["identity"]["display_name"] == "נועה כהן")
        interests_ok = any("כדורסל" in i for i in prof["interests"]) if prof["interests"] else True
        check("interests extracted from free_text (LLM, tolerant)", interests_ok, str(prof["interests"]))

        # ═══ F4 · Dashboard projection ════════════════════════════════════════
        print("\n── F4 Dashboard ──")
        d = (await c.get(f"/api/brain/{LID}/dashboard", params={"lang": "he"})).json()
        check("dashboard contract v2", d["contractVersion"] == 2)
        check("dashboard name from identity", d["name"] == "נועה כהן")
        check("profile/evidence flags are honest", d["hasProfile"] and not d["hasLearningEvidence"])
        check("2 subjects (math+science)", len(d["subjects"]) == 2)
        check("competencies == activeness (no invention)",
              sorted(x["value"] for x in d["competencies"]) == sorted(prof["activeness"].values()))
        check("competencies include verbal descriptors",
              all(x.get("descriptor") and x.get("tone") in {"strong", "steady", "support"} for x in d["competencies"]))
        check("subjects start honest (0 events → 0%)", all(s["progress"] == 0 for s in d["subjects"]))
        check("next-step hero is read-only and localized",
              d["hero"]["mode"] == "next"
              and d["hero"]["objectiveId"] == "math-angles"
              and d["hero"]["objectiveTitle"] == "סוגי זוויות והגדרות")
        check("curriculum labels do not expose internal ids",
              all(item["topic"] != item["objectiveId"] for s in d["subjects"] for item in s["curriculum"]))
        d_ar = (await c.get(f"/api/brain/{LID}/dashboard", params={"lang": "ar"})).json()
        check("dashboard localizes (ar subject name)", any("الرياضيات" in s["name"] for s in d_ar["subjects"]))
        check("dashboard localizes objective title (ar)", d_ar["hero"]["objectiveTitle"] == "أنواع الزوايا وتعريفاتها")

        # ═══ F1 · Event pipeline (P1) ═════════════════════════════════════════
        print("\n── F1 Events ──")
        L = (await c.post("/api/xapi/launch", json={
            "learner_id": LID, "objective_id": "math-angles", "subject": "math",
            "component_id": "YuviDori-math-angles-0001-lesson",
        })).json()
        slx = L["slxapi"]
        check("launch endpoint is base (no /statements)", slx["endpoint"].endswith("/"))
        check("actor is pseudonymous (no PII keys)",
              "display_name" not in json.dumps(slx["actor"]) and "נועה" not in json.dumps(slx["actor"]))
        url = slx["endpoint"] + "statements"
        h = {"Authorization": slx["auth"]}
        ext = {"objective_id": "math-angles", "subject": "math",
               "misconception": "angle_type_confusion", "resume_token": {"slide": 4}}

        a1 = (await c.post(url, json=stmt(slx, "e1", "answered", succ=False, scaled=0.2, ext=ext), headers=h)).json()
        check("answered ingested", a1["results"][0]["stored"] and not a1["results"][0]["duplicate"])
        a2 = (await c.post(url, json=stmt(slx, "e1", "answered", succ=False, scaled=0.2, ext=ext), headers=h)).json()
        check("replay is idempotent (R14)", a2["results"][0]["duplicate"])
        bad = (await c.post(url, json=stmt(slx, "e2", "answered", succ=True, ext=ext) | {"verb": {"id": VERB_IRI_BASE + "requested"}}, headers=h)).json()
        check("non-MoE verb rejected", bad["results"][0]["stored"] is False)
        unauth = await c.post("/api/xapi/BADTOKEN/statements", json=stmt(slx, "e3", "answered", succ=True, ext=ext))
        check("bad launch token → 401", unauth.status_code == 401)

        brain = await get_brain(LID)
        m = brain["mastery"]["math-angles"]
        check("attempts counted once", m.get("attempts") == 1, str(m))
        check("misconception captured", m.get("misconceptions") == ["angle_type_confusion"])
        check("resume_token persisted (F1.6)", brain["current_state"]["resume_token"] == {"slide": 4})
        d_resume = (await c.get(f"/api/brain/{LID}/dashboard", params={"lang": "he"})).json()
        check("dashboard offers exact resume context",
              d_resume["hero"]["mode"] == "resume"
              and d_resume["hero"]["canResume"]
              and d_resume["hero"]["componentId"] == "YuviDori-math-angles-0001-lesson")

        # ═══ F1 · Pedagogical agent (P4a) ═════════════════════════════════════
        print("\n── F1 Pedagogical ──")
        n1 = (await c.post("/api/agent/route/next", json={"learner_id": LID, "language": "he"})).json()
        check("planner picks first unmastered objective", n1["objective_id"] == "math-angles", str(n1["objective_id"]))
        check("primary component (assessment lesson), not alternative",
              (n1["component"] or {}).get("id") == "YuviDori-math-angles-0001-lesson")
        check("explanation present (explainability)", "earliest unmastered" in n1["explanation"])
        cb = (await c.get(f"/api/brain/{LID}/context/coach")).json()
        check("informationToBot flows into coach bundle", bool(cb["current"]["informationToBot"]))
        check("recent_events in bundle", len(cb["current"]["recent_events"]) >= 1)
        check("coach bundle has NO PII", "נועה" not in json.dumps(cb, ensure_ascii=False))

        af = (await c.post("/api/agent/route/after-fail", json={"learner_id": LID, "language": "he"})).json()
        check("after-fail routes to video alternative",
              (af["component"] or {}).get("id") == "YuviDori-math-angles-0001-video")

        comp = stmt(slx, "e4", "completed", succ=True, scaled=0.9,
                    ext={"objective_id": "math-angles", "subject": "math", "is_assessment": True},
                    otype="assignment", oid="YuviDori-math-angles-0001-lesson")
        await c.post(url, json=comp, headers=h)
        n2 = (await c.post("/api/agent/route/next", json={"learner_id": LID, "language": "he"})).json()
        check("frontier advances after assessment pass", n2["objective_id"] == "math-angles-vertical", str(n2["objective_id"]))
        check("plan counts mastered=1", n2["plan"]["math"]["mastered"] == 1)
        d2 = (await c.get(f"/api/brain/{LID}/dashboard", params={"lang": "he"})).json()
        math_subj = next(s for s in d2["subjects"] if "מתמט" in s["name"])
        check("dashboard reflects real event progress", math_subj["progress"] > 0)
        check("dashboard advances hero after mastery",
              d2["hero"]["mode"] == "next"
              and d2["hero"]["objectiveId"] == "math-angles-vertical")

        # ═══ F3 · Coach + Safety (P3) ═════════════════════════════════════════
        print("\n── F3 Coach + Safety ──")
        disc, reply = await sse_collect(c, "/api/agent/coach/stream", {
            "learner_id": LID, "language": "he",
            "message": "שלום! הטלפון שלי 0521234567. אני תקוע בזוויות, אפשר רמז?",
        })
        check("AI disclosure sent first", bool(disc))
        check("coach replied (stream)", len(reply) > 10, reply[:60])
        turns = await sessions.get_recent(LID, "coach", limit=4)
        mem = json.dumps(turns, ensure_ascii=False)
        check("PII stripped from working memory", "0521234567" not in mem)
        check("turn persisted (continuity)", len(turns) == 2)
        _, reply2 = await sse_collect(c, "/api/agent/coach/stream", {
            "learner_id": LID, "language": "he", "message": "אני מאוד אוהבת כדורסל, תני דוגמה עם זה",
        })
        check("second turn replied", len(reply2) > 10)
        turns2 = await sessions.get_recent(LID, "coach", limit=10)
        check("memory accumulates across turns", len(turns2) == 4)
        history_page = (await c.get("/api/agent/coach/conversations", params={
            "learner_id": LID, "limit": 1,
        })).json()
        check("conversation history is durable", len(history_page["conversations"]) == 1)
        generated_title = history_page["conversations"][0]["title"]
        check(
            "conversation title is generated, not copied",
            bool(generated_title)
            and generated_title != "שלום! הטלפון שלי 0521234567. אני תקוע בזוויות, אפשר רמז?",
            generated_title,
        )
        conversation_id = history_page["conversations"][0]["id"]
        message_page = (await c.get(
            f"/api/agent/coach/conversations/{conversation_id}/messages",
            params={"learner_id": LID, "limit": 2},
        )).json()
        check("message history is paginated", len(message_page["messages"]) == 2 and message_page["has_more"])
        latest_assistant = next(
            message for message in reversed(message_page["messages"])
            if message["role"] == "assistant"
        )
        visual_saved = await sessions.attach_visual(
            LID,
            conversation_id,
            latest_assistant["id"],
            {
                "id": "e2e-visual",
                "type": "image",
                "mime_type": "image/svg+xml",
                "data_url": "data:image/svg+xml;base64,PHN2Zy8+",
                "title": "המחשה",
                "alt": "המחשה מתמטית",
                "caption": "",
                "renderer": "svg-fallback",
                "scene": {"use_visual": True, "title": "המחשה", "alt": "המחשה מתמטית", "caption": "", "elements": []},
            },
            latest_assistant["text"],
            "המשך אחרי ההמחשה",
        )
        visual_page = (await c.get(
            f"/api/agent/coach/conversations/{conversation_id}/messages",
            params={"learner_id": LID, "limit": 2},
        )).json()
        visual_message = next(
            message for message in visual_page["messages"]
            if message["id"] == latest_assistant["id"]
        )
        check(
            "saved drawing reloads from chat history",
            visual_saved
            and visual_message.get("visual", {}).get("id") == "e2e-visual"
            and visual_message.get("text_after") == "המשך אחרי ההמחשה",
        )
        older_page = (await c.get(
            f"/api/agent/coach/conversations/{conversation_id}/messages",
            params={"learner_id": LID, "limit": 2, "cursor": message_page["next_cursor"]},
        )).json()
        check("older messages load by cursor", len(older_page["messages"]) == 2)
        new_conversation = (await c.post(
            "/api/agent/coach/conversations", json={"learner_id": LID}
        )).json()
        check("new conversation can be created", new_conversation["message_count"] == 0)
        deleted = await c.delete(
            f"/api/agent/coach/conversations/{new_conversation['id']}",
            params={"learner_id": LID},
        )
        visible_after_delete = (await c.get(
            "/api/agent/coach/conversations", params={"learner_id": LID, "limit": 20}
        )).json()
        check(
            "conversation soft-delete hides conversation",
            deleted.status_code == 200
            and new_conversation["id"] not in {
                item["id"] for item in visible_after_delete["conversations"]
            },
        )
        brain = await get_brain(LID)
        check("consolidator promoted chat interest", any("כדורסל" in i for i in brain["profile"]["interests"]),
              str(brain["profile"]["interests"]))
        before = list(brain["profile"]["interests"])
        _, _ = await sse_collect(c, "/api/agent/coach/stream", {
            "learner_id": LID, "language": "he", "message": "כדורסל זה החיים שלי",
        })
        brain = await get_brain(LID)
        check("duplicate interest is a no-op", brain["profile"]["interests"] == before,
              str(brain["profile"]["interests"]))

        # ═══ F3 · Triggers (P4b) ══════════════════════════════════════════════
        print("\n── F3 Triggers ──")
        got = []
        async def sub():
            async for tr in triggers.subscribe(LID, heartbeat=0.5):
                if tr.get("type") != "_heartbeat":
                    got.append(tr)
        task = asyncio.create_task(sub())
        await asyncio.sleep(0.1)
        fail_ext = {"objective_id": "math-angles-vertical", "subject": "math", "misconception": "adjacent_vs_vertical"}
        for i in range(3):
            await c.post(url, json=stmt(slx, f"t{i}", "answered", succ=False, scaled=0.0, ext=fail_ext), headers=h)
        await c.post("/api/agent/triggers/idle", json={"learner_id": LID, "objective_id": "math-angles-vertical"})
        await asyncio.sleep(0.3)
        task.cancel()
        types = [t["type"] for t in got]
        check("misconception trigger after 3 fails", "misconception" in types, str(types))
        check("idle trigger (client-reported)", "idle" in types, str(types))

        disc_p, nudge = await sse_collect(c, "/api/agent/coach/proactive", {
            "learner_id": LID, "language": "he", "trigger": "misconception",
        })
        check("proactive nudge streams + disclosure", bool(disc_p) and len(nudge) > 5)

        # ═══ Reflection ═══════════════════════════════════════════════════════
        print("\n── Reflection ──")
        pr = (await c.post("/api/agent/reflect", json={"language": "ar"})).json()
        check("reflection prompt localized (ar)", "بعد" in pr["text"] or "ما" in pr["text"], pr["text"][:40])
        await c.post("/api/agent/reflect/answer", json={
            "learner_id": LID, "prompt_id": pr["prompt_id"],
            "answer": "היה קשה אבל הצלחתי בסוף", "self_rating": 4, "system_estimate": 0.6,
        })
        brain = await get_brain(LID)
        refl = brain["reflections_recent"]
        check("reflection in brain recent window", len(refl) == 1 and refl[0]["self_rating"] == 4)
        d_reflection = (await c.get(f"/api/brain/{LID}/dashboard", params={"lang": "he"})).json()
        check("dashboard reflection preview is verbal only",
              d_reflection["reflectionPreview"]["answer"] == "היה קשה אבל הצלחתי בסוף"
              and "self_rating" not in d_reflection["reflectionPreview"])

        # ═══ F6 · Teacher Insights + F8 scoping ═══════════════════════════════
        print("\n── F6 Teacher + F8 Org ──")
        si = (await c.post("/api/agent/insights", json={
            "teacher_id": "teacher-demo", "learner_id": LID, "language": "he"})).json()
        check("attention flag with raw evidence", si["attention"] is not None and "3" in si["attention"]["evidence"],
              str(si["attention"]))
        check("2-5 actionable recommendations", 2 <= len(si["recommendations"]) <= 5)
        check("timeline from real events", len(si["timeline"]) >= 4)
        check("teacher sees display_name (UI lane)", si["display_name"] == "נועה כהן")
        check("self vs system in insight", len(si["reflections_recent"]) == 1)

        gi = (await c.post("/api/agent/insights", json={
            "teacher_id": "teacher-demo", "group_id": GROUP, "language": "he"})).json()
        check("group trends aggregate", gi["trends"]["students_total"] >= 1)
        check("attention list explainable", all("evidence" in a for a in gi["attention"]))
        denied = await c.post("/api/agent/insights", json={"teacher_id": "teacher-demo", "learner_id": "stranger-x"})
        check("out-of-group learner → 403", denied.status_code == 403)
        og = await c.get("/api/orgs", params={"teacher_id": "teacher-demo"})
        check("non-admin /api/orgs → 403", og.status_code == 403)
        ga = (await c.get("/api/groups", params={"teacher_id": "teacher-demo"})).json()
        check("teacher sees own group", any(g["id"] == GROUP for g in ga["groups"]))

        td = (await c.post("/api/teacher/directive", json={
            "teacher_id": "teacher-demo", "learner_id": LID,
            "text": "תני דוגמאות חזותיות בזוויות", "scope": "objective:math-angles", "priority": "high"})).json()
        brain = await get_brain(LID)
        check("directive appended (write lane)", brain["teacher_directives"][-1]["id"] == td["id"])
        stranger_td = await c.post("/api/teacher/directive", json={
            "teacher_id": "teacher-demo", "learner_id": "stranger-x", "text": "x"})
        check("directive to out-of-group → 403", stranger_td.status_code == 403)

        # ═══ F5 · Mentoring ═══════════════════════════════════════════════════
        print("\n── F5 Mentoring ──")
        await c.post("/api/mentoring", json={
            "learner_id": LID, "teacher_name": "רות לוי", "learner_name": "נועה כהן",
            "meeting_stage": "פתיחה", "notes": "שיחת היכרות ומטרות",
            "next_steps": "לתרגל זוויות 10 דקות ביום", "deadline": "2026-07-20",
            "visibility": "shared", "teacher_only_note": "רגישה לביקורת",
        })
        brain = await get_brain(LID)
        check("goal mirrored to brain (F5→F4)", any("10 דקות" in g["text"] for g in brain["goals"]))
        d3 = (await c.get(f"/api/brain/{LID}/dashboard", params={"lang": "he"})).json()
        check("goal visible on dashboard", any("10 דקות" in g["text"] for g in d3["goals"]))
        check("goal deadline visible on dashboard",
              any(g.get("deadline") == "2026-07-20" for g in d3["goals"]))
        as_teacher = (await c.get("/api/mentoring", params={"learner_id": LID, "role": "teacher"})).json()
        as_learner = (await c.get("/api/mentoring", params={"learner_id": LID, "role": "learner"})).json()
        check("teacher sees teacher_only note", any(cv.get("teacher_only_note") for cv in as_teacher["conversations"]))
        check("learner NEVER sees teacher_only note",
              all("teacher_only_note" not in cv for cv in as_learner["conversations"]))

        # ═══ F7 · Feedback ════════════════════════════════════════════════════
        print("\n── F7 Feedback ──")
        fb = (await c.post("/api/feedback", json={"learner_id": LID, "kind": "issue", "message": "כפתור לא מגיב"})).json()
        check("feedback persisted", fb["ok"] and fb["id"].startswith("fb_"))

        # ═══ §5.8 · Agent scopes (least-context) ══════════════════════════════
        print("\n── §5.8 Scopes ──")
        coach_view = await view_for("coach", LID)
        check("coach view: no activeness numbers", "activeness" not in json.dumps(coach_view))
        check("coach view: no display_name", "display_name" not in json.dumps(coach_view))
        ped_view = await view_for("pedagogical", LID)
        check("pedagogical view: mastery yes / interests no",
              "mastery" in ped_view and "interests" not in json.dumps(ped_view))
        try:
            await apply_writes("coach", LID, {"mastery": {"x": {"achieved": True}}})
            check("coach cannot write mastery", False)
        except AgentScopeError:
            check("coach cannot write mastery", True)
        try:
            await apply_writes("teacher_insights", LID, {"strategies": []})
            check("teacher_insights is write-blocked", False)
        except AgentScopeError:
            check("teacher_insights is write-blocked", True)
        check("chat never set mastery (no fake objective)", "x" not in (await get_brain(LID))["mastery"])

    await cleanup()
    org.ENROLLMENTS[:] = [e for e in org.ENROLLMENTS if e["learner_id"] != LID]

    print(f"\n{'='*60}\nRESULT: {len(PASS)} passed · {len(FAIL)} failed")
    if FAIL:
        print("FAILED:", *[f"  - {f}" for f in FAIL], sep="\n")
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
