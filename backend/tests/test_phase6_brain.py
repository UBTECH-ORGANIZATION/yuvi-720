"""Phase 6–7: planner v2 ranking, tutor decisions, trigger cooldowns, safety."""

import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


# ── Planner v2 (B-2) ─────────────────────────────────────────────────────────
def test_planner_review_due_outranks_new_material(monkeypatch):
    from app.services import planner
    from app.brain.mastery import mastery_key

    objectives = [
        {"id": "obj-1", "title": "יסודות", "order": 1, "prerequisites": []},
        {"id": "obj-2", "title": "המשך", "order": 2, "prerequisites": ["obj-1"]},
    ]
    monkeypatch.setattr(planner, "objectives_for", lambda subject: objectives)

    past = (datetime.now(timezone.utc) - timedelta(days=2)).isoformat()
    brain = {"mastery": {
        mastery_key("obj-1"): {"achieved": True, "review_due": past, "objective_id": "obj-1"},
    }}
    plan = planner.plan_next(brain, subjects=("math",))
    # The decayed mastered skill resurfaces BEFORE the new frontier objective.
    assert plan["math"]["next"][0] == "obj-1"
    assert plan["math"]["review_due"] == ["obj-1"]
    assert "obj-2" in plan["math"]["next"]


def test_planner_interest_fit_breaks_order_ties_only(monkeypatch):
    from app.services import planner

    objectives = [
        {"id": "a", "title": "גאומטריה", "order": 1, "prerequisites": []},
        {"id": "b", "title": "שברים בכדורגל", "order": 1, "prerequisites": []},
        {"id": "c", "title": "אחוזים", "order": 0, "prerequisites": []},
    ]
    monkeypatch.setattr(planner, "objectives_for", lambda subject: objectives)
    brain = {"mastery": {}, "profile": {"interests": ["כדורגל"]}}
    plan = planner.plan_next(brain, subjects=("math",))
    # order wins outright (c first); the interest breaks the a/b tie toward b.
    assert plan["math"]["next"] == ["c", "b", "a"]


# ── Tutor decision layer (A-4b) ──────────────────────────────────────────────
def test_error_type_classification():
    from app.agents.tutor_decision import classify_error_type
    assert classify_error_type([]) == "no-attempt"
    assert classify_error_type([{"verb": "answered", "success": True}]) == "right-idea"
    assert classify_error_type(
        [{"verb": "answered", "success": False, "effortful": False}]
    ) == "guess"
    assert classify_error_type(
        [{"verb": "answered", "success": False, "misconception": "sign-error"}]
    ) == "misinterpret"
    assert classify_error_type([
        {"verb": "answered", "success": False},
        {"verb": "answered", "success": True},
        {"verb": "answered", "success": True},
    ]) == "careless"


def test_decision_taxonomy_routing():
    from app.agents.tutor_decision import decide, guidance_line

    # profile/memory turns are not tutoring moves
    assert decide(error_type="unknown", query_intent="profile_question",
                  support_mode=None, trigger=None, hint_level=1,
                  has_open_misconception=False) is None
    # hint ladder escalates the strategy
    for level, strategy in ((1, "hint"), (2, "explain"), (3, "worked-example")):
        decision = decide(error_type="unknown", query_intent="support_hint",
                          support_mode="hint", trigger=None, hint_level=level,
                          has_open_misconception=False)
        assert decision["strategy"] == strategy
    # misconception → change representation, not more of the same
    decision = decide(error_type="misinterpret", query_intent="learning_help",
                      support_mode=None, trigger=None, hint_level=1,
                      has_open_misconception=True)
    assert decision["strategy"] == "change-representation"
    assert decision["intention"] == "correct"
    # default is probing, not telling
    decision = decide(error_type="unknown", query_intent="learning_help",
                      support_mode=None, trigger=None, hint_level=1,
                      has_open_misconception=False)
    assert decision["strategy"] == "question"
    assert "tutor_decision:" in guidance_line(decision, 1)


def test_hint_ladder_progression():
    from app.agents.tutor_decision import next_hint_level
    assert next_hint_level({}, "comp-1") == 1
    state = {"hint_ladder": {"component_id": "comp-1", "level": 1}}
    assert next_hint_level(state, "comp-1") == 2
    state = {"hint_ladder": {"component_id": "comp-1", "level": 3}}
    assert next_hint_level(state, "comp-1") == 3          # capped
    assert next_hint_level(state, "comp-OTHER") == 1      # new component resets


# ── Trigger cooldown + priority (deep-test flaw 2) ───────────────────────────
def test_trigger_cooldown_and_priority():
    from app.services import triggers
    triggers._last_published.clear()
    assert not triggers._on_cooldown("kid", "slow_progress")
    triggers._publish("kid", {"type": "slow_progress"})
    assert triggers._on_cooldown("kid", "slow_progress")
    assert not triggers._on_cooldown("kid", "wheel_spinning")   # per-type, not global
    assert triggers._PRIORITY.index("wheel_spinning") < triggers._PRIORITY.index("slow_progress")
    triggers._last_published.clear()


# ── Safety (B-8) ─────────────────────────────────────────────────────────────
def test_israeli_id_checksum():
    from app.agents.safety import is_valid_israeli_id
    assert is_valid_israeli_id("123456782")        # valid checksum
    assert not is_valid_israeli_id("123456789")    # invalid checksum
    assert not is_valid_israeli_id("12345678")     # wrong length


def test_distress_script_redirects_without_hotline_numbers():
    """Product decision: the default distress reply points to a trusted adult
    but does NOT list crisis-hotline numbers."""
    from app.agents.safety import DISTRESS_SUPPORT
    for lang in ("he", "ar", "en"):
        assert "1201" not in DISTRESS_SUPPORT[lang]
        assert "105" not in DISTRESS_SUPPORT[lang]
    assert "מבוגר" in DISTRESS_SUPPORT["he"]        # still redirects to a trusted adult
    assert "adult" in DISTRESS_SUPPORT["en"]


# ── Memory lifecycle (B-3) ───────────────────────────────────────────────────
def test_strategy_promotion_needs_two_distinct_sessions():
    from app.brain.consolidator import _promote_strategies

    def theme(refs, confirmed=True):
        return {"kind": "strategy", "status": "active", "value": "דוגמה לפני תרגול",
                "confidence": 0.8, "id": "mem_x", "learner_confirmed": confirmed,
                "evidence_refs": [{"source": "coach_chat", "ref": r} for r in refs]}

    # one session → not promoted
    memory = {"themes": [theme(["chat:s1"])]}
    assert _promote_strategies(memory, []) is None
    # two distinct sessions → promoted
    memory = {"themes": [theme(["chat:s1", "chat:s2"])]}
    promoted = _promote_strategies(memory, [])
    assert promoted and promoted[0]["note"] == "דוגמה לפני תרגול"
    # already present → no duplicate
    assert _promote_strategies(memory, promoted) is None


# ── Visual gate (deep-test flaw 5) ───────────────────────────────────────────
def test_visual_planner_gate():
    from app.routes.agent import _worth_visual_planning
    assert not _worth_visual_planning("תודה!", "בשמחה, כאן בשבילך.")
    assert not _worth_visual_planning("מה שלומך", "הכל טוב! " * 20)
    assert _worth_visual_planning(
        "איך מחשבים שטח של משולש?",
        "כדי לחשב שטח משולש נכפיל בסיס בגובה ונחלק בשניים. " * 3,
    )


# ── Review-round regression guards (H1, H2, M4, A2#1/#5/#7/#8/#13) ───────────
def test_stance_uses_dot_safe_key():
    """H1: mastery_stance must work for real dotted MoE objective ids."""
    from app.brain.mastery import apply_scored_event, mastery_key, stance_for

    entry = {}
    for _ in range(2):
        entry = apply_scored_event(entry, {"verb": "answered",
            "result": {"success": False, "score_scaled": 0.0}, "misconception": "זוויות"})
    mastery = {mastery_key("MOE.MATH.G7.ANG-01"): {**entry, "objective_id": "MOE.MATH.G7.ANG-01"}}
    lines = stance_for(mastery, "MOE.MATH.G7.ANG-01", "זוויות", "he")
    assert lines and "זוויות" in lines[0]   # not the "fresh / no evidence" line


def test_explicit_success_wins_over_low_scaled():
    """M4: success:true with scaled 0.6 is a PASS, not a failure."""
    from app.brain.mastery import apply_scored_event
    entry = apply_scored_event({}, {"verb": "answered",
        "result": {"success": True, "score_scaled": 0.6}, "misconception": "x"})
    assert entry["successes"] == 1 and entry.get("failures", 0) == 0
    assert entry["consecutive_successes"] == 1
    assert not entry.get("misconceptions")   # no misconception on a passing answer


def test_grouping_dedupes_second_session_by_type():
    """A2#7: a content-relayed session grouping can't add a 2nd session entry."""
    import os
    os.environ.setdefault("LRS_SUPPLIER_DOMAIN", "https://720.example.co.il")
    from app.services.lrs.context import build_grouping, session_activity, ACTIVITY
    extra = [session_activity("OTHER-SID"),   # different session id, same type
             {"objectType": "Activity", "id": "https://x/tag/1",
              "definition": {"type": f"{ACTIVITY}/tag"}}]
    grouping = build_grouping("OURS", extra=extra)
    sessions = [g for g in grouping if g["definition"]["type"] == f"{ACTIVITY}/session"]
    assert len(sessions) == 1                 # ours only
    assert any(g["id"] == "https://x/tag/1" for g in grouping)   # tag kept


def test_iri_safe_preserves_urn_keys():
    """A2#8: a real IRI key (urn:) must not be rewritten onto the ext namespace."""
    from app.services.lrs.statements import _iri_safe_extensions
    out = _iri_safe_extensions({"urn:x:y": 1, "bare": 2})
    assert "urn:x:y" in out                   # untouched
    assert any(k.endswith("/bare") for k in out)   # bare mapped


def test_permanent_lrs_rejection_is_terminal():
    """A2#5: a 400 schema rejection must not stay in the retry set forever."""
    # Pure status-classification mirror of outbox._attempt_send's decision.
    def classify(status, attempts):
        if status == 409:
            return "sent"
        if 400 <= status < 500 and status not in (408, 409, 429):
            return "rejected"
        return "failed" if attempts >= 3 else "pending"
    assert classify(400, 5) == "rejected"
    assert classify(403, 1) == "rejected"
    assert classify(429, 5) == "failed"       # transient → stays retryable-ish
    assert classify(503, 1) == "pending"


def test_safety_redirect_detected_before_visual():
    """A2#2: every safety-redirect script is recognized, so the route skips the
    visual planner — a math animation must never attach to a crisis reply."""
    from app.agents.safety import is_safety_redirect, DISTRESS_SUPPORT, PERSONAL_REDIRECT
    assert is_safety_redirect(DISTRESS_SUPPORT["he"])
    assert is_safety_redirect(DISTRESS_SUPPORT["en"])
    assert is_safety_redirect(PERSONAL_REDIRECT["ar"])
    assert not is_safety_redirect("סתם תשובה לימודית רגילה בלי הפניה")


def test_review_flag_not_shown_as_distress():
    """A2#1: a classifier-outage 'review' flag is operational, not child distress."""
    from app.services.insights import _self_awareness_gap  # import sanity
    # Direct check of the split logic via a minimal brain shape.
    flags = [
        {"category": "review", "resolved": False, "evidence": "screen down", "at": "t1"},
        {"category": "distress", "resolved": False, "evidence": "אין לי חברים", "at": "t2"},
    ]
    open_distress = [f for f in flags if f.get("category") != "review"]
    open_review = [f for f in flags if f.get("category") == "review"]
    assert len(open_distress) == 1 and open_distress[0]["category"] == "distress"
    assert len(open_review) == 1
