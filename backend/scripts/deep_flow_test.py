"""Deep end-to-end flow test — the whole system with the new brain integrated.

Drives TWO synthetic learner profiles (a struggling, low-activeness learner and
a confident, high-activeness one) through the REAL running server + REAL LLM:

  mapping questionnaire (different answers) → onboarding completion (description
  seed) → learning events (misconceptions / rapid guesses / streaks) → coach
  chats (memory statement, help request, "what do you know about me") → hint
  button → proactive nudges (idle / misconception / wheel_spinning /
  rapid_guessing) → trigger SSE subscription → personalized reflection →
  student_description regeneration → MoE-LRS ledger verification.

Everything the script creates is tagged by the learner ids below; `--cleanup`
deletes it all (users, brains, events, threads, reflections, ledger rows,
usage rows). `--keep` runs without cleanup for manual inspection.

Run:  cd backend && ./.venv/bin/python scripts/deep_flow_test.py --base http://127.0.0.1:8124
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
from pathlib import Path
from typing import Any, Optional

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.env import ensure_env_loaded  # noqa: E402

ensure_env_loaded()

import httpx  # noqa: E402

from app.auth.passwords import hash_password  # noqa: E402
from app.auth.repository import DEFAULT_PREFERENCES, upsert_user  # noqa: E402
from app.brain.repository import _get_collection_named, get_brain  # noqa: E402
from app.services.events import mint_launch  # noqa: E402

PASSWORD = "DeepTest1!"
VERB = "https://lxp.education.gov.il/xapi/moe/verbs"
QTYPE = "https://lxp.education.gov.il/xapi/moe/activities/question"

REPORT: dict[str, Any] = {"profiles": {}, "checks": [], "started_at": time.strftime("%H:%M:%S")}


def check(name: str, ok: bool, detail: str = "") -> None:
    REPORT["checks"].append({"name": name, "ok": bool(ok), "detail": detail[:300]})
    print(f"  {'✅' if ok else '❌'} {name}" + (f" — {detail[:160]}" if detail else ""))


def note(profile: str, key: str, value: Any) -> None:
    REPORT["profiles"].setdefault(profile, {})[key] = value


# ── Profile definitions ──────────────────────────────────────────────────────
REVERSE = {4, 5, 6, 9, 14, 29, 36, 37, 38}

def mapping_answers(kind: str) -> dict[str, int]:
    """kind='low' → struggling profile; kind='high' → confident profile."""
    answers = {}
    for qid in range(1, 39):
        if kind == "low":
            answers[str(qid)] = 0 if qid in REVERSE else 4   # agree with negatives
        else:
            answers[str(qid)] = 4 if qid in REVERSE else 0   # disagree with negatives
    return answers


PROFILES = [
    {
        "id": "dtest-noa",
        "name": "נועה",
        "kind": "low",
        "free_text": "אני אוהבת כדורגל וריקוד. קשה לי להתרכז כשמשעמם לי ואני מוותרת מהר.",
        "memory_line": "תדע שאני לומדת הכי טוב עם דוגמאות מכדורגל, וקשה לי מאוד עם שברים",
        "objective": "MOE.MATH.G7.FRAC-01",
        "learning": "struggle",   # misconception fails + rapid guesses + eventual success
    },
    {
        "id": "dtest-adam",
        "name": "אדם",
        "kind": "high",
        "free_text": "אני אוהב חלל, רובוטיקה ומשחקי מחשב. אני אוהב אתגרים קשים.",
        "memory_line": "תדע שאני אוהב אתגרים קשים בחלל ורובוטיקה ומשעמם לי בתרגילים קלים",
        "objective": "MOE.SCI.G7.SPACE-01",
        "learning": "excel",      # steady fast-but-effortful successes
    },
]


# ── HTTP helpers ─────────────────────────────────────────────────────────────
async def sse_collect(client: httpx.AsyncClient, url: str, payload: dict, timeout: float = 120) -> dict[str, Any]:
    """POST an SSE endpoint, return {'text': full_reply, 'events': [...]}."""
    text_parts: list[str] = []
    events: list[dict] = []
    try:
        async with client.stream("POST", url, json=payload, timeout=timeout) as response:
            if response.status_code != 200:
                return {"text": "", "events": [], "status": response.status_code}
            async for line in response.aiter_lines():
                if not line.startswith("data: "):
                    continue
                data = line[6:]
                if data == "[DONE]":
                    break
                try:
                    event = json.loads(data)
                except json.JSONDecodeError:
                    continue
                events.append(event)
                if isinstance(event.get("text"), str):
                    text_parts.append(event["text"])
    except Exception as exc:
        return {"text": "".join(text_parts), "events": events, "error": type(exc).__name__}
    return {"text": "".join(text_parts), "events": events, "status": 200}


async def post_statement(client: httpx.AsyncClient, base: str, token: str, statement: dict) -> bool:
    response = await client.post(
        f"{base}/api/xapi/{token}/statements",
        headers={"Authorization": f"Basic {token}"},
        json=statement,
        timeout=30,
    )
    return response.status_code == 200 and (response.json().get("results") or [{}])[0].get("stored")


def make_statement(sid: str, objective: str, n: int, *, success: bool, seconds: int,
                   misconception: Optional[str] = None, response_text: str = "x") -> dict:
    return {
        "id": f"deeptest-{sid}-{n:03d}",
        "verb": {"id": f"{VERB}/answered"},
        "object": {"id": f"https://yuvi.test/{objective}/q{n}", "definition": {"type": QTYPE}},
        "result": {"success": success, "score": {"scaled": 1.0 if success else 0.0},
                   "duration": f"PT{seconds}S", "response": response_text},
        "context": {"extensions": {"question_id": f"q{n}",
                    **({"misconception": misconception} if misconception else {})}},
        "timestamp": f"2026-07-20T1{1 + n // 60}:{n % 60:02d}:00Z",
    }


# ── Per-profile scenario ─────────────────────────────────────────────────────
async def run_profile(base: str, profile: dict) -> None:
    pid = profile["id"]
    print(f"\n━━━ PROFILE {pid} ({profile['kind']}) ━━━")

    # 0. Seed the account (direct DB — the only non-HTTP setup step).
    await upsert_user({
        "_id": pid, "username": pid, "display_name": profile["name"],
        "roles": ["learner"], "password": hash_password(PASSWORD),
        "preferences": {**DEFAULT_PREFERENCES, "language": "he"},
        "deep_test": True,
    })

    client = httpx.AsyncClient(base_url=base, timeout=60)
    try:
        # 1. Login → MoE session enter.
        r = await client.post("/api/auth/login", json={"username": pid, "password": PASSWORD})
        check(f"{pid}: login", r.status_code == 200)
        me = (await client.get("/api/auth/me")).json()
        moe_sid = me.get("session_id")
        check(f"{pid}: MoE session minted", bool(moe_sid))

        # 2. Mapping questionnaire → agency initialized + answered×38.
        r = await client.get("/api/questionnaire?lang=he")
        check(f"{pid}: questionnaire loaded", r.status_code == 200)
        r = await client.post("/api/submit", json={
            "answers": mapping_answers(profile["kind"]),
            "student_name": profile["name"],
            "language": "he",
            "free_text": profile["free_text"],
        }, timeout=120)
        check(f"{pid}: mapping submitted", r.status_code == 200)
        scores = (r.json() or {}).get("scores") or {}
        note(pid, "mapping_overall", {k: v.get("overall") for k, v in scores.items() if isinstance(v, dict)})

        # 3. Onboarding completes (results approved) → agency completed + description seed.
        r = await client.patch("/api/learner-state", json={"profile_summary_progress": {"completed": True}})
        check(f"{pid}: onboarding completed", r.status_code == 200)
        brain = await get_brain(pid)
        activeness = (brain.get("profile") or {}).get("activeness") or {}
        note(pid, "activeness", activeness)
        desc = brain.get("student_description") or {}
        seeded = [e.get("text") for b in (desc.get("blocks") or {}).values()
                  for e in b if isinstance(e, dict) and not e.get("invalid_at")]
        check(f"{pid}: description seeded", bool(seeded), " | ".join(seeded)[:200])
        note(pid, "description_seed", seeded)

        # 4. Chat 1 — explicit memory statement.
        reply = await sse_collect(client, "/api/agent/coach/stream", {
            "conversation_id": f"{pid}-chat", "message": profile["memory_line"],
            "language": "he", "surface": {"screen": "learning_lesson"},
        })
        note(pid, "chat_memory_reply", reply["text"])
        check(f"{pid}: chat memory reply", bool(reply["text"].strip()), reply["text"][:120])

        # 5. Learning events on a launch (dot-carrying objective).
        launch = mint_launch(pid, objective_id=profile["objective"],
                             component_id=f"{pid}-comp", unit_id=f"{pid}-unit",
                             subject="math" if "MATH" in profile["objective"] else "science")
        token, launch_sid = launch["launch"], launch["session_id"]
        stored = 0
        if profile["learning"] == "struggle":
            plan = [
                dict(success=False, seconds=40, misconception="common-denominator", response_text="1/2"),
                dict(success=False, seconds=35, misconception="common-denominator", response_text="2/6"),
                dict(success=False, seconds=1, misconception="fake-rapid-tag", response_text="9"),   # rapid guess
                dict(success=False, seconds=1, response_text="8"),                                    # rapid guess
                dict(success=False, seconds=2, response_text="7"),                                    # rapid guess
                dict(success=False, seconds=50, misconception="common-denominator", response_text="3/8"),
                dict(success=True, seconds=70, response_text="5/6"),
            ]
        else:
            plan = [dict(success=True, seconds=18 + i * 3, response_text=f"ans{i}") for i in range(6)]
        for n, spec in enumerate(plan, 1):
            if await post_statement(client, base, token, make_statement(pid, profile["objective"], n, **spec)):
                stored += 1
        check(f"{pid}: learning events stored", stored == len(plan), f"{stored}/{len(plan)}")

        entry = {}
        brain = await get_brain(pid)
        from app.brain.mastery import entry_for
        entry = entry_for(brain.get("mastery"), profile["objective"])
        note(pid, "mastery_entry", {k: entry.get(k) for k in
             ("score_ewma", "confidence", "attempts", "successes", "failures",
              "consecutive_successes", "achieved", "level", "needs_review")})
        note(pid, "misconceptions", entry.get("misconceptions"))
        if profile["learning"] == "struggle":
            tags = {m.get("tag") for m in entry.get("misconceptions") or []}
            check(f"{pid}: rapid-guess tag excluded", "fake-rapid-tag" not in tags, str(tags))
            check(f"{pid}: misconception counted", "common-denominator" in tags)
        else:
            check(f"{pid}: achieved by streak", bool(entry.get("achieved")),
                  f"level={entry.get('level')}")

        # 6. Trigger SSE — drive 3 slow fails and watch for a proactive trigger.
        trigger_seen: dict[str, Any] = {}

        async def watch_triggers() -> None:
            try:
                async with client.stream("GET", "/api/agent/triggers/subscribe", timeout=30) as resp:
                    async for line in resp.aiter_lines():
                        if line.startswith("data: "):
                            event = json.loads(line[6:])
                            if event.get("type") not in (None, "_heartbeat"):
                                trigger_seen.update(event)
                                return
            except Exception:
                pass

        watcher = asyncio.create_task(watch_triggers())
        await asyncio.sleep(0.5)
        for n in range(20, 23):
            await post_statement(client, base, token, make_statement(
                pid, profile["objective"], n, success=False, seconds=45,
                misconception="common-denominator", response_text=f"w{n}"))
        try:
            await asyncio.wait_for(watcher, timeout=10)
        except asyncio.TimeoutError:
            watcher.cancel()
        check(f"{pid}: proactive trigger published", bool(trigger_seen), str(trigger_seen)[:160])
        note(pid, "trigger_seen", trigger_seen)

        # 7. Chat 2 — help question (should now be personalized by evidence).
        reply = await sse_collect(client, "/api/agent/coach/stream", {
            "conversation_id": f"{pid}-chat", "message": "קשה לי עם השאלה הזאת, אני לא מבין איך להתחיל",
            "language": "he", "surface": {"screen": "learning_lesson", "component_id": f"{pid}-comp"},
        })
        note(pid, "chat_help_reply", reply["text"])
        check(f"{pid}: help reply", bool(reply["text"].strip()), reply["text"][:120])

        # 8. Chat 3 — "what do you know about me" (memory recall).
        reply = await sse_collect(client, "/api/agent/coach/stream", {
            "conversation_id": f"{pid}-chat", "message": "מה אתה יודע עליי ועל איך שאני לומד?",
            "language": "he", "surface": {"screen": "student_dashboard"},
        })
        note(pid, "chat_recall_reply", reply["text"])
        check(f"{pid}: recall reply", bool(reply["text"].strip()), reply["text"][:160])

        # 9. Hint button → help_requested statement + grounded hint.
        reply = await sse_collect(client, "/api/agent/coach/support", {
            "conversation_id": f"{pid}-chat", "support": "hint",
            "language": "he", "surface": {"screen": "learning_lesson", "component_id": f"{pid}-comp"},
        })
        note(pid, "hint_reply", reply["text"])
        check(f"{pid}: hint reply", bool(reply["text"].strip()), reply["text"][:120])

        # 10. Proactive nudges — all four trigger kinds.
        for trig in ("idle", "misconception", "wheel_spinning", "rapid_guessing"):
            reply = await sse_collect(client, "/api/agent/coach/proactive", {
                "conversation_id": f"{pid}-chat", "trigger": trig,
                "language": "he", "surface": {"screen": "learning_lesson", "component_id": f"{pid}-comp"},
            })
            note(pid, f"proactive_{trig}", reply["text"])
            check(f"{pid}: proactive {trig}", bool(reply["text"].strip()), reply["text"][:100])

        # 11. Personalized reflection.
        r = await client.post("/api/agent/reflection/start", json={
            "component_id": f"{pid}-comp", "session_id": launch_sid, "language": "he",
        }, timeout=60)
        flow = r.json() if r.status_code == 200 else {}
        questions = flow.get("questions") or []
        note(pid, "reflection_questions", [q.get("text") for q in questions])
        check(f"{pid}: reflection started", len(questions) == 3)
        rid = flow.get("reflection_id")
        if rid:
            await client.post(f"/api/agent/reflection/{rid}/answer",
                              json={"question_number": 1, "rating": 2 if profile["kind"] == "low" else 5})
            await client.post(f"/api/agent/reflection/{rid}/answer",
                              json={"question_number": 2,
                                    "answer": "היה לי קשה עם המכנה המשותף" if profile["kind"] == "low"
                                    else "היה קל, הבנתי הכל מהר"})
            await client.post(f"/api/agent/reflection/{rid}/skip", json={"question_number": 3})
            r = await client.post(f"/api/agent/reflection/{rid}/complete", json={})
            done = r.json() if r.status_code == 200 else {}
            note(pid, "reflection_result", done)
            check(f"{pid}: reflection completed", bool(done.get("ok")),
                  f"self={done.get('self_rating')} system={done.get('system_estimate')}")

        # 12. Wait for description regeneration, then read the final portrait.
        await asyncio.sleep(2)
        await sse_collect(client, "/api/agent/coach/stream", {   # bundle build schedules regen
            "conversation_id": f"{pid}-chat", "message": "תודה!",
            "language": "he", "surface": {"screen": "student_dashboard"},
        })
        await asyncio.sleep(25)
        brain = await get_brain(pid)
        desc = brain.get("student_description") or {}
        note(pid, "description_final", desc.get("text"))
        note(pid, "description_blocks", {
            key: [e.get("text") for e in entries if isinstance(e, dict) and not e.get("invalid_at")]
            for key, entries in (desc.get("blocks") or {}).items()
        })
        check(f"{pid}: description regenerated", bool(desc.get("last_generated_at")),
              str(desc.get("text"))[:200])

        # 13. Logout → session exit.
        r = await client.post("/api/auth/logout", json={})
        check(f"{pid}: logout", r.status_code in (200, 204))
    finally:
        await client.aclose()


async def verify_ledger(ids: list[str]) -> None:
    print("\n━━━ MoE-LRS LEDGER ━━━")
    outbox = _get_collection_named("lrs_outbox")
    if outbox is None:
        check("ledger reachable", False, "no mongo")
        return
    for pid in ids:
        by_verb: dict[str, int] = {}
        unsent = 0
        async for row in outbox.find({"learner_id": pid}):
            by_verb[row.get("verb")] = by_verb.get(row.get("verb"), 0) + 1
            if row.get("status") != "sent":
                unsent += 1
        total = sum(by_verb.values())
        check(f"{pid}: ledger — all statements sent", total > 0 and unsent == 0,
              f"{total} rows, verbs={by_verb}, unsent={unsent}")
        note(pid, "ledger", {"total": total, "by_verb": by_verb, "unsent": unsent})


async def cleanup(ids: list[str]) -> None:
    print("\n━━━ CLEANUP ━━━")
    collections = [
        ("users", "_id"), ("learners", "_id"), ("learner_state", "_id"),
        ("learning_events", "learner_id"), ("agent_sessions", "learner_id"),
        ("agent_conversations", "learner_id"), ("agent_messages", "learner_id"),
        ("reflections", "learner_id"), ("reflection_flows", "learner_id"),
        ("mentoring_conversations", "learner_id"), ("lrs_outbox", "learner_id"),
        ("ai_usage_events", "actor_id"),
    ]
    deleted_total = 0
    for name, field in collections:
        collection = _get_collection_named(name)
        if collection is None:
            continue
        query = {"$or": [{"_id": {"$in": ids}}, {"learner_id": {"$in": ids}}]} \
            if field == "_id" else {field: {"$in": ids}}
        try:
            result = await collection.delete_many(query)
            if result.deleted_count:
                print(f"  deleted {result.deleted_count:>4} × {name}")
                deleted_total += result.deleted_count
        except Exception as exc:
            print(f"  ⚠️ {name}: {exc}")
    # item RT norms created by the test items
    stats = _get_collection_named("item_stats")
    if stats is not None:
        try:
            result = await stats.delete_many({"_id": {"$regex": "^https://yuvi\\.test/MOE\\."}})
            if result.deleted_count:
                print(f"  deleted {result.deleted_count:>4} × item_stats")
                deleted_total += result.deleted_count
        except Exception as exc:
            print(f"  ⚠️ item_stats: {exc}")
    print(f"  total deleted: {deleted_total}")


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://127.0.0.1:8124")
    parser.add_argument("--keep", action="store_true", help="skip cleanup")
    parser.add_argument("--cleanup-only", action="store_true")
    args = parser.parse_args()

    ids = [p["id"] for p in PROFILES]
    if args.cleanup_only:
        await cleanup(ids)
        return

    for profile in PROFILES:
        await run_profile(args.base, profile)
    await verify_ledger(ids)

    if not args.keep:
        await cleanup(ids)

    failures = [c for c in REPORT["checks"] if not c["ok"]]
    print(f"\n━━━ SUMMARY: {len(REPORT['checks']) - len(failures)}/{len(REPORT['checks'])} checks passed ━━━")
    for c in failures:
        print(f"  ❌ {c['name']} — {c['detail']}")
    out = Path("/private/tmp/deep_flow_report.json")
    out.write_text(json.dumps(REPORT, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"report: {out}")


if __name__ == "__main__":
    asyncio.run(main())
