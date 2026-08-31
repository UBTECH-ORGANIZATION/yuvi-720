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
    WINDOW_DAYS,
    _TAG_FACTS,
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


def test_reflections_outside_the_window_are_not_credited_to_it():
    """Having reflected months ago is not reflecting now.

    The count used to fall back to the all-time list whenever the window came up
    empty, which credits a learner who has stopped reflecting with reflections
    they did not make.
    """
    events = [_ev(verb="completed", obj=f"o{i}", days_ago=i) for i in range(4)]
    stale = [
        {"at": (NOW - timedelta(days=WINDOW_DAYS + 10 + i)).isoformat()}
        for i in range(4)
    ]
    d = _dom(_brain(reflections=stale), "self_awareness", events)
    never = _dom(_brain(), "self_awareness", events)
    assert d["value"] == never["value"]
    assert d["causes"][0] == "low_reflection"


def test_undated_reflections_still_count():
    """Dropping the all-time fallback must not start discarding undated entries."""
    events = [_ev(verb="completed", obj=f"o{i}", days_ago=i) for i in range(4)]
    d = _dom(_brain(reflections=[{}, {}, {}, {}]), "self_awareness", events)
    assert d["value"] > BASE["self_awareness"]


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


# ── Drivers — what the learner actually did, signed ──────────────────────────
def test_drivers_name_what_went_well_not_only_drags():
    """`causes` answers "what should I work on" and so only reports drags. A
    domain that ROSE still has to be able to say why, which is what drivers add.
    """
    events = [_ev(verb="completed", obj=f"o{d}", days_ago=d) for d in range(9)]
    events += [_ev(obj=f"o{i}", days_ago=i) for i in range(5)]
    d = _dom(_brain(), "motivation_relevance", events)
    assert d["value"] > BASE["motivation_relevance"]
    assert not _is_drag(d["causes"])                       # nothing to work on
    assert d["drivers"], "a rise with no driver has no reason to show"
    assert all(x["dir"] == "up" for x in d["drivers"])


def test_drivers_carry_the_drag_direction_when_things_slipped():
    """The case the whole thing exists for: a learner who was showing up and
    then went quiet. The current window still holds activity, so nothing in
    today's numbers reads as a problem — only the comparison does."""
    events = [_ev(obj=f"o{d}", days_ago=d) for d in range(22, 28) for _ in range(2)]
    events += [_ev(obj="recent", days_ago=0) for _ in range(5)]
    d = _dom(_brain(), "motivation_relevance", events)
    down = [x["tag"] for x in d["drivers"] if x["dir"] == "down"]
    assert "inconsistent" in down


def test_a_dip_is_explained_even_when_every_current_signal_is_positive():
    """Drivers describe the CHANGE, not the state. Reading the state instead
    left a dipped domain with nothing but good news to report, and a coach
    asked "why did this go down?" answered with generic hypotheses."""
    # Strong, regular week three weeks back; a thinner week now.
    events = [_ev(verb="completed", obj=f"o{d}", days_ago=d) for d in range(22, 28)]
    events += [_ev(obj=f"o{d}", days_ago=d) for d in range(22, 28)]
    events += [_ev(verb="completed", obj="now", days_ago=1) for _ in range(4)]
    d = _dom(_brain(), "motivation_relevance", events)
    assert d["drivers"], "a movement with no driver leaves the coach guessing"
    assert any(x["dir"] == "down" for x in d["drivers"])


def test_drivers_stay_silent_without_enough_evidence():
    # Same rule as `causes`: no blame, and no praise, on one event.
    d = _dom(_brain(), "self_regulation", [_ev(success=False, score=0.0, dur=2.0)])
    assert d["confidence"] < MIN_CAUSE_CONF
    assert d["drivers"] == []


def test_every_driver_the_model_emits_has_a_localized_reason():
    """The learner UI renders `actmap.why.<tag>.<dir>`, and `t()` falls back to
    the raw key — so a tag with no string puts `actmap.why.guessing.up` in front
    of a child. Same guarantee the cause hints already get.
    """
    import json
    import pathlib

    locales = pathlib.Path(__file__).resolve().parents[2] / "locales"
    bundles = {
        lang: json.loads((locales / f"{lang}.json").read_text(encoding="utf8"))
        for lang in ("he", "en", "ar")
    }

    emitted = set()
    for _label, brain, events, decisions in _all_scenarios():
        out = effective_activeness(brain, events, decisions)
        for key in COMPETENCY_KEYS:
            for driver in out[key]["drivers"]:
                emitted.add((driver["tag"], driver["dir"]))
    assert emitted, "scenarios produced no drivers — coverage check is vacuous"

    for tag, direction in sorted(emitted):
        key = f"actmap.why.{tag}.{direction}"
        for lang, bundle in bundles.items():
            assert key in bundle, f"{key} missing from {lang}.json"
            assert bundle[key].strip(), f"{key} is blank in {lang}.json"


# ── The learner who stops coming ─────────────────────────────────────────────
def test_a_learner_who_stops_coming_is_told_why():
    """The movement that most needs explaining used to be the one silenced.

    Confidence came from the current window, which is empty precisely BECAUSE
    they stopped — so the drop showed no arrow, no reason, and the coach had
    nothing to answer with. The absence is the finding, and the week they did
    show up is evidence enough to say what changed.
    """
    events = [
        _ev(verb="completed", obj=f"p{d}", days_ago=d)
        for d in range(22, 28)
    ] + [_ev(obj=f"p{d}", days_ago=d) for d in range(22, 28)]
    d = _dom(_brain(), "motivation_relevance", events)
    assert d["value"] < d["prior_value"], "a week away has to read as a decline"
    assert d["change_confidence"] >= MIN_CAUSE_CONF, "the arrow would stay hidden"
    down = [x for x in d["drivers"] if x["dir"] == "down"]
    assert down, "a drop with no driver leaves the coach with nothing to say"
    assert down[0]["tag"] == "inconsistent"
    assert down[0]["facts"]["active_days"] == 0
    assert down[0]["facts"]["active_days_prior"] > 0


def test_doing_nothing_is_never_reported_as_improvement():
    """The mirror of the fix, and the reason it is limited to declines.

    Scores drift back toward the questionnaire base as evidence runs out, so a
    struggling learner who simply stops would drift UPWARD. Relaxing the gate in
    both directions would congratulate a child for the week they skipped.
    """
    events = [
        _ev(success=False, score=0.0, obj=f"p{d}", days_ago=d)
        for d in range(22, 28) for _ in range(3)
    ]
    for key in COMPETENCY_KEYS:
        d = _dom(_brain(base={key: 20}), key, events)
        if d["value"] > d["prior_value"]:
            assert d["change_confidence"] == d["confidence"], (
                f"{key}: a rise is being vouched for by an empty week"
            )


def test_a_present_learner_is_unaffected_by_the_absence_rule():
    """Someone who is here keeps being judged on what they did while here."""
    events = [_ev(verb="completed", obj=f"o{d}", days_ago=d) for d in range(0, 6)]
    events += [_ev(obj=f"o{d}", days_ago=d) for d in range(0, 6)]
    d = _dom(_brain(), "motivation_relevance", events)
    assert d["change_confidence"] == d["confidence"]


def test_the_absence_rule_never_buys_an_arrow_it_cannot_explain():
    """Scores drift toward base as evidence thins, so a domain can slide with no
    signal behind it. Vouching for that slide would put an arrow on the card and
    nothing in the tooltip — the "why?" with no answer, which is the whole
    defect this card was built to remove."""
    events = [
        _ev(verb="completed", obj=f"p{d}", days_ago=d)
        for d in range(22, 28)
    ] + [_ev(obj=f"p{d}", days_ago=d) for d in range(22, 28)]
    for key in COMPETENCY_KEYS:
        d = _dom(_brain(), key, events)
        if not d["drivers"]:
            assert d["change_confidence"] == d["confidence"], (
                f"{key}: vouching for a move with nothing to say about it"
            )


def test_hint_use_is_windowed_so_leaning_on_help_can_register_as_a_change():
    """An unwindowed count is the same number at both ends of the comparison, so
    hint-shaped causes could never move. Two of the seven were inert."""
    events = [_ev(obj=f"p{d}", days_ago=d) for d in range(22, 28) for _ in range(3)]
    events += [_ev(obj=f"n{d}", days_ago=d) for d in range(0, 6) for _ in range(3)]
    decisions = [
        {"strategy": "hint", "hint_level": 1, "at": (NOW - timedelta(days=d)).isoformat()}
        for d in range(0, 6) for _ in range(6)
    ] + [{"strategy": "hint", "hint_level": 1, "at": (NOW - timedelta(days=25)).isoformat()}]

    d = _dom(_brain(), "initiative_responsibility", events, decisions)
    row = next((x for x in d["drivers"] if x["tag"] == "hint_reliance"), None)
    assert row, "leaning on hints far more than last week has to be sayable"
    assert row["dir"] == "down"
    assert row["facts"]["n_hint"] > row["facts"]["n_hint_prior"]


def test_no_arrow_the_drivers_contradict():
    """The card and the chat must never describe the same week differently.

    `value` is confidence-scaled while drivers compare raw contributions, so a
    domain can slide while the behaviour behind it improved — more evidence of a
    still-negative signal drags the score down even as the signal gets better.
    A real learner saw a declining self-awareness emblem and was told in chat,
    the same minute, that it was improving. Neither was lying; they were reading
    different halves of one calculation.
    """
    for _label, brain, events, decisions in _all_scenarios():
        out = effective_activeness(brain, events, decisions)
        for key in COMPETENCY_KEYS:
            row = out[key]
            moved = row["value"] - row["prior_value"]
            if not moved:
                continue
            want = "up" if moved > 0 else "down"
            assert any(d["dir"] == want for d in row["drivers"]), (
                f"{key}: arrow says {want} with nothing pointing that way "
                f"({row['prior_value']}->{row['value']}, "
                f"drivers={[(d['tag'], d['dir']) for d in row['drivers']]})"
            )


def test_prior_value_is_the_same_score_one_week_back():
    """The card draws its arrow from `value` vs `prior_value`. Both must come
    from this engine — deriving the arrow from a separately stored snapshot let
    a domain show a dip the event data could not explain, so the card asked
    "why?" in the one place there was no answer."""
    # Nothing until this week, then a solid week of finishing work.
    events = [_ev(verb="completed", obj=f"o{d}", days_ago=d) for d in range(0, 6)]
    events += [_ev(obj=f"o{d}", days_ago=d) for d in range(0, 6)]
    d = _dom(_brain(), "motivation_relevance", events)
    assert d["prior_value"] < d["value"], "a week of new work has to read as a rise"
    assert any(x["dir"] == "up" for x in d["drivers"])


def test_a_gap_in_the_record_is_not_reported_as_movement():
    """A learner who was active, then vanishes from the record, then reappears.

    That shape is what a dead xAPI relay leaves behind, and the empty stretch
    reads as inactivity — so ingest merely coming back online would be reported
    to the learner as improvement. Silence beats a rise nobody earned.
    """
    events = [_ev(verb="completed", obj=f"o{d}", days_ago=d) for d in range(40, 48)]
    events += [_ev(verb="completed", obj=f"n{d}", days_ago=d) for d in range(0, 6)]
    events += [_ev(obj=f"n{d}", days_ago=d) for d in range(0, 6)]
    d = _dom(_brain(), "motivation_relevance", events)
    assert d["drivers"] == []
    assert d["prior_value"] == d["value"], "no vouched-for prior, so claim no move"


def test_a_beginner_is_not_mistaken_for_a_gap():
    """Same empty prior window, opposite meaning: nothing came before it, so the
    learner is simply new and their first week is a real rise, not an artefact.
    """
    events = [_ev(verb="completed", obj=f"o{d}", days_ago=d) for d in range(0, 6)]
    events += [_ev(obj=f"o{d}", days_ago=d) for d in range(0, 6)]
    d = _dom(_brain(), "motivation_relevance", events)
    assert d["prior_value"] < d["value"]
    assert any(x["dir"] == "up" for x in d["drivers"])


# ── Driver facts — the counts that make an explanation specific ──────────────
def test_a_driver_carries_the_counts_behind_it():
    """A tag alone can only ever produce one sentence per cause. The counts are
    what let the card and the coach describe THIS learner's week."""
    events = [_ev(verb="completed", obj=f"o{d}", days_ago=d) for d in range(22, 28)]
    events += [_ev(obj=f"o{d}", days_ago=d) for d in range(22, 28)]
    events += [_ev(verb="completed", obj="now", days_ago=1) for _ in range(4)]
    d = _dom(_brain(), "motivation_relevance", events)
    facts = next((x.get("facts") for x in d["drivers"] if x["tag"] == "inconsistent"), None)
    assert facts, "a driver with no counts leaves every learner the same sentence"
    assert "active_days" in facts and "active_days_prior" in facts
    assert facts["active_days"] != facts["active_days_prior"], "a diff that shows no diff"


def test_two_learners_with_the_same_tag_get_different_counts():
    """The whole point: same cause, different week, different explanation."""
    quiet = [_ev(obj="o1", days_ago=d) for d in range(22, 28)]
    quiet += [_ev(obj="o1", days_ago=1)]
    busy = [_ev(obj="o1", days_ago=d) for d in range(22, 28)]
    busy += [_ev(obj=f"o{d}", days_ago=d) for d in range(0, 5) for _ in range(3)]

    def days(events):
        drivers = _dom(_brain(), "motivation_relevance", events)["drivers"]
        row = next((x for x in drivers if x["tag"] == "inconsistent"), None)
        return (row or {}).get("facts", {}).get("active_days")

    assert days(quiet) != days(busy)


def test_facts_never_leak_a_field_the_cause_does_not_use():
    """Facts are prompt material for the coach, so each cause carries only the
    counts it is actually about — not a dump of every metric."""
    events = [_ev(verb="completed", obj=f"o{i}", days_ago=i) for i in range(6)]
    for key in COMPETENCY_KEYS:
        for driver in _dom(_brain(), key, events)["drivers"]:
            allowed = set(_TAG_FACTS.get(driver["tag"], ()))
            allowed |= {f"{f}_prior" for f in allowed}
            assert set(driver.get("facts", {})) <= allowed


def test_prior_value_exists_even_with_no_activity_at_all():
    out = effective_activeness(_brain(), [], [])
    for key in COMPETENCY_KEYS:
        assert out[key]["prior_value"] == BASE[key], key
