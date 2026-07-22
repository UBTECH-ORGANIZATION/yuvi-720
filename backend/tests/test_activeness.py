"""Dynamic activeness — the questionnaire base nudged by real interactions.

Every test drives a synthetic interaction pattern through `effective_activeness`
and asserts BOTH the direction (value up/down vs the onboarding base) AND the
behavioural *cause* the model surfaces. The cause is the contract that lets the
UI tell a kid exactly *why* a domain moved, so a wrong-direction or wrong-cause
result here is a real defect — the model would be explaining a move it didn't
make.

Invariants proven throughout: no evidence → base unchanged (never yanked toward
an average); |value - base| ≤ MAX_DRIFT; value ∈ [0, 100]; confidence grows with
relevant evidence; and a cause is only asserted when there's enough evidence to
name it (thin data → no blame, UI falls back to static tips).
"""

from datetime import datetime, timedelta, timezone

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.brain.activeness import (  # noqa: E402
    COMPETENCY_KEYS,
    MAX_DRIFT,
    MIN_CAUSE_CONF,
    effective_activeness,
)

NOW = datetime.now(timezone.utc)

# A spread base so an "up" move can't be confused with a clamp at 100 and a
# "down" move can't bottom out at 0.
BASE = {
    "motivation_relevance": 50,
    "growth_mindset": 60,
    "initiative_responsibility": 60,
    "self_regulation": 45,
    "self_awareness": 55,
    "support_emotional": 47,
}


# ── Builders ──────────────────────────────────────────────────────────────────
def _ev(verb="answered", success=True, score=None, dur=None, obj="o1", days_ago=0):
    result = {}
    if success is not None:
        result["success"] = success
    if score is not None:
        result["score_scaled"] = score
    if dur is not None:
        result["duration"] = dur
    return {
        "verb": verb,
        "result": result,
        "objective_id": obj,
        "occurred_at": (NOW - timedelta(days=days_ago)).isoformat(),
    }


def _brain(base=None, mastery=None, reflections=None):
    return {
        "profile": {"activeness": {**BASE, **(base or {})}},
        "mastery": mastery or {},
        "reflections_recent": reflections or [],
    }


def _hints(n, level=1):
    return [{"strategy": "hint", "hint_level": level} for _ in range(n)]


def _dom(brain, key, events=None, decisions=None):
    return effective_activeness(brain, events or [], decisions or [])[key]


# ── Baseline: no activity → the base is the score, untouched ─────────────────
def test_no_activity_keeps_base_exactly():
    out = effective_activeness(_brain(), [], [])
    for key in COMPETENCY_KEYS:
        assert out[key]["value"] == BASE[key], key
        assert out[key]["delta"] == 0.0, key
        assert out[key]["confidence"] == 0.0, key
        assert out[key]["causes"] == [], key


def test_thin_evidence_asserts_no_cause():
    # A single fast-guess is a drag signal, but one event is not enough to blame
    # a kid — the model must stay quiet (UI then uses static tips).
    d = _dom(_brain(), "self_regulation", [_ev(success=False, score=0.0, dur=2.0)])
    assert d["confidence"] < MIN_CAUSE_CONF
    assert d["causes"] == []
    assert abs(d["value"] - BASE["self_regulation"]) <= 1  # barely moves


# ── motivation_relevance — showing up, finishing ─────────────────────────────
def test_motivation_down_when_sparse_and_unfinished():
    # Five answers, all on one day, nothing completed → inconsistent + disengaged.
    events = [_ev(obj=f"o{i%2}", days_ago=0) for i in range(5)]
    d = _dom(_brain(), "motivation_relevance", events)
    assert d["value"] < BASE["motivation_relevance"]
    assert "inconsistent" in d["causes"]


def test_motivation_up_when_regular_and_finishing():
    events = []
    for day in range(9):                       # spread across 9 distinct days
        events.append(_ev(verb="completed", obj=f"o{day}", days_ago=day))
    events += [_ev(obj=f"o{i}", days_ago=i) for i in range(5)]
    d = _dom(_brain(), "motivation_relevance", events)
    assert d["value"] > BASE["motivation_relevance"]
    assert not _is_drag(d["causes"])           # doing well → keep/stretch, no blame


# ── growth_mindset — bouncing back after a miss ──────────────────────────────
def test_growth_down_when_quits_on_failure():
    # Four objectives, each failed and never recovered.
    events = []
    for i in range(4):
        events.append(_ev(success=False, score=0.0, obj=f"o{i}", days_ago=3))
    d = _dom(_brain(), "growth_mindset", events)
    assert d["value"] < BASE["growth_mindset"]
    assert d["causes"][0] == "quits_on_fail"


def test_growth_up_when_recovers_after_failure():
    # Each objective: a failure, then a later success on the same objective.
    events = []
    for i in range(4):
        events.append(_ev(success=False, score=0.0, obj=f"o{i}", days_ago=5))
        events.append(_ev(success=True, score=1.0, obj=f"o{i}", days_ago=4))
    mastery = {f"o{i}": {"consecutive_successes": 3} for i in range(3)}
    d = _dom(_brain(mastery=mastery), "growth_mindset", events)
    assert d["value"] > BASE["growth_mindset"]
    assert not _is_drag(d["causes"])


# ── initiative_responsibility — attempt-first, not hint-first ────────────────
def test_initiative_down_when_hint_reliant():
    # Neutral completion, but leans on hints on nearly every item.
    events = [_ev(verb="completed", obj="o0", days_ago=1),
              _ev(verb="completed", obj="o1", days_ago=2)]
    events += [_ev(obj=f"o{i}", days_ago=3) for i in range(2, 4)]  # objectives 2,3
    d = _dom(_brain(), "initiative_responsibility", events, _hints(5))
    assert d["value"] < BASE["initiative_responsibility"]
    assert "hint_reliance" in d["causes"]


# ── self_regulation — pacing, not fast-guessing ──────────────────────────────
def test_self_regulation_down_when_guessing():
    events = [_ev(success=(i % 2 == 0), score=(1.0 if i % 2 == 0 else 0.0),
                  dur=2.0, obj=f"o{i}", days_ago=i % 3) for i in range(8)]
    d = _dom(_brain(), "self_regulation", events)
    assert d["value"] < BASE["self_regulation"]
    assert d["causes"][0] == "guessing"


def test_self_regulation_flags_hint_reliance_even_while_up():
    # Well-paced (no guessing) but hint-heavy: the score can still rise, yet the
    # improve tip must surface the over-reliance — "why to improve while ahead".
    events = [_ev(success=True, score=1.0, dur=25.0, obj=f"o{i}", days_ago=i % 4)
              for i in range(8)]
    d = _dom(_brain(), "self_regulation", events, _hints(7))
    assert "hint_reliance" in d["causes"]


# ── self_awareness — reflecting on what helps ────────────────────────────────
def test_self_awareness_down_when_never_reflecting():
    events = [_ev(verb="completed", obj=f"o{i}", days_ago=i) for i in range(4)]
    d = _dom(_brain(), "self_awareness", events)          # reflections_recent = []
    assert d["value"] < BASE["self_awareness"]
    assert d["causes"][0] == "low_reflection"


def test_self_awareness_up_when_reflecting():
    events = [_ev(verb="completed", obj=f"o{i}", days_ago=i) for i in range(4)]
    reflections = [{"at": (NOW - timedelta(days=i)).isoformat()} for i in range(4)]
    d = _dom(_brain(reflections=reflections), "self_awareness", events)
    assert d["value"] > BASE["self_awareness"]
    assert not _is_drag(d["causes"])


# ── support_emotional — healthy help-seeking is GOOD; isolation is the drag ───
def test_support_up_when_help_seeking_is_healthy():
    events = [_ev(success=(i > 0), score=(1.0 if i > 0 else 0.0),
                  obj=f"o{i}", days_ago=i % 5) for i in range(6)]
    d = _dom(_brain(), "support_emotional", events, _hints(3))
    assert d["value"] > BASE["support_emotional"]
    assert not _is_drag(d["causes"])


def test_support_down_when_stuck_and_never_asks():
    # Real failures, zero help requests, barely present → isolation.
    events = [_ev(success=False, score=0.0, obj=f"o{i}", days_ago=0) for i in range(4)]
    d = _dom(_brain(), "support_emotional", events, [])   # no decisions = no help
    assert d["value"] < BASE["support_emotional"]
    assert d["causes"][0] == "isolation"


# ── Cross-cutting invariants (architecture correctness) ──────────────────────
def _is_drag(causes):
    """A cause list that blames a behaviour (not a keep/stretch encouragement)."""
    return bool(causes) and causes[0] not in ("keep", "stretch")


def _all_scenarios():
    """(label, brain, events, decisions) covering both directions per domain."""
    reflections = [{"at": (NOW - timedelta(days=i)).isoformat()} for i in range(4)]
    scen = []
    scen.append(("motivation_down", _brain(),
                 [_ev(obj=f"o{i%2}", days_ago=0) for i in range(5)], []))
    scen.append(("growth_down", _brain(),
                 [_ev(success=False, score=0.0, obj=f"o{i}", days_ago=3) for i in range(4)], []))
    scen.append(("selfreg_guess", _brain(),
                 [_ev(success=False, score=0.0, dur=2.0, obj=f"o{i}", days_ago=i % 3)
                  for i in range(8)], []))
    scen.append(("selfaware_none", _brain(),
                 [_ev(verb="completed", obj=f"o{i}", days_ago=i) for i in range(4)], []))
    scen.append(("support_isolated", _brain(),
                 [_ev(success=False, score=0.0, obj=f"o{i}", days_ago=0) for i in range(4)], []))
    scen.append(("support_healthy", _brain(),
                 [_ev(success=(i > 0), score=(1.0 if i > 0 else 0.0), obj=f"o{i}", days_ago=i % 5)
                  for i in range(6)], _hints(3)))
    scen.append(("selfaware_up", _brain(reflections=reflections),
                 [_ev(verb="completed", obj=f"o{i}", days_ago=i) for i in range(4)], []))
    return scen


def test_effective_stays_within_drift_and_range():
    for label, brain, events, decisions in _all_scenarios():
        out = effective_activeness(brain, events, decisions)
        for key in COMPETENCY_KEYS:
            v = out[key]["value"]
            assert 0 <= v <= 100, f"{label}/{key} out of range: {v}"
            assert abs(v - out[key]["base"]) <= MAX_DRIFT, f"{label}/{key} over drift"


def test_direction_and_cause_are_coherent():
    # The explainability contract: a domain that dropped (with enough evidence)
    # must name a behavioural drag; a domain that rose must NOT blame the kid.
    for label, brain, events, decisions in _all_scenarios():
        out = effective_activeness(brain, events, decisions)
        for key in COMPETENCY_KEYS:
            d = out[key]
            if d["confidence"] < MIN_CAUSE_CONF:
                assert d["causes"] == [], f"{label}/{key} blamed on thin data"
                continue
            if d["delta"] <= -1:                     # a real drop
                assert _is_drag(d["causes"]), f"{label}/{key} dropped without a cause"
            elif d["delta"] >= 1:                    # a real rise
                assert not _is_drag(d["causes"]), f"{label}/{key} rose but was blamed"


def test_evidence_gate_matches_groundable_cause():
    # The map shows a change arrow only when `confidence >= MIN_CAUSE_CONF`
    # (surfaced as evidenceBacked), and the "why" blurb is groundable only when
    # causes is non-empty. These MUST be the same condition, or the arrow could
    # render a change the blurb can't explain (the exact desync we're closing).
    scenarios = _all_scenarios() + [("no_activity", _brain(), [], [])]
    for label, brain, events, decisions in scenarios:
        out = effective_activeness(brain, events, decisions)
        for key in COMPETENCY_KEYS:
            backed = out[key]["confidence"] >= MIN_CAUSE_CONF
            groundable = len(out[key]["causes"]) > 0
            assert backed == groundable, f"{label}/{key}: gate {backed} != cause {groundable}"


def test_confidence_grows_with_evidence():
    # self_regulation weights evidence as the raw scored count, so the ramp from
    # thin → full is visible (domains that weight rare signals — recovery, help —
    # saturate faster by design, which is why we pick this one here).
    def conf(n):
        events = [_ev(success=True, score=1.0, dur=20.0, obj=f"o{i}", days_ago=i % 3)
                  for i in range(n)]
        return _dom(_brain(), "self_regulation", events)["confidence"]
    assert conf(2) < conf(5) < conf(9)
    assert conf(20) == 1.0                            # saturates, never exceeds 1


def test_every_emitted_cause_is_grounded_in_the_coach():
    # The change-explanation blurb is grounded by mapping each cause tag to an
    # internal phrase. If the model can emit a tag the coach can't verbalize, the
    # kid would get an ungrounded ("LLM guess") reason — so every cause the model
    # produces across all scenarios must have a hint.
    from app.agents.competency_coach import _CAUSE_HINTS

    emitted = set()
    for _label, brain, events, decisions in _all_scenarios():
        out = effective_activeness(brain, events, decisions)
        for key in COMPETENCY_KEYS:
            emitted.update(out[key]["causes"])
    assert emitted, "scenarios produced no causes — coverage check is vacuous"
    missing = emitted - set(_CAUSE_HINTS)
    assert not missing, f"causes with no grounding phrase: {missing}"
    for tag in emitted:
        assert set(_CAUSE_HINTS[tag]) >= {"he", "ar", "en"}, f"{tag} missing a locale"


def test_value_clamps_at_ceiling_and_floor():
    up = [_ev(verb="completed", obj=f"o{d}", days_ago=d) for d in range(9)]
    up += [_ev(obj=f"o{i}", days_ago=i) for i in range(5)]
    hi = _dom(_brain(base={"motivation_relevance": 95}), "motivation_relevance", up)
    assert hi["value"] <= 100

    down = [_ev(success=False, score=0.0, obj=f"o{i}", days_ago=3) for i in range(6)]
    lo = _dom(_brain(base={"growth_mindset": 5}), "growth_mindset", down)
    assert lo["value"] >= 0
