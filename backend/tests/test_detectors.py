"""A-3 behavior detectors — rule boundaries against synthetic events."""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.brain.detectors import (  # noqa: E402
    count_recent_rapid_guesses,
    detect_answer_cycling,
    is_probable_slip,
    is_rapid_guess,
    learner_median_rt,
    parse_iso_duration_seconds,
    rapid_guess_threshold,
    response_seconds,
    wheel_spinning_state,
)


def _event(success=False, seconds=None, verb="answered", response=None, **kwargs):
    event = {"verb": verb, "result": {"success": success}, **kwargs}
    if response is not None:
        event["result"]["response"] = response
    if seconds is not None:
        event["result"]["duration"] = f"PT{seconds}S"
    return event


def test_iso_duration_parsing():
    assert parse_iso_duration_seconds("PT12S") == 12
    assert parse_iso_duration_seconds("PT1M30S") == 90
    assert parse_iso_duration_seconds("PT1H") == 3600
    assert parse_iso_duration_seconds("garbage") is None
    assert parse_iso_duration_seconds(None) is None


def test_response_seconds_prefers_reported_duration():
    event = _event(seconds=8)
    event["timing"] = {"elapsed_since_previous_seconds": 99}
    assert response_seconds(event) == 8
    only_elapsed = {"verb": "answered", "result": {}, "timing": {"elapsed_since_previous_seconds": 14}}
    assert response_seconds(only_elapsed) == 14


def test_rapid_guess_threshold_cold_start_and_warm():
    assert rapid_guess_threshold(None) == 3.0            # cold start: 3s floor
    assert rapid_guess_threshold(50.0, n=5) == 3.0       # < 30 observations: still cold
    assert rapid_guess_threshold(50.0, n=40) == 5.0      # 10% of mean
    assert rapid_guess_threshold(200.0, n=40) == 10.0    # capped at 10s
    assert rapid_guess_threshold(10.0, n=40) == 2.0      # floored at 2s


def test_rapid_guess_gate():
    assert is_rapid_guess(_event(seconds=1))                     # 1s < 3s cold floor
    assert not is_rapid_guess(_event(seconds=20))
    assert not is_rapid_guess(_event(seconds=1, verb="completed"))  # only answers gated
    assert not is_rapid_guess({"verb": "answered", "result": {}})   # no RT → no claim


def test_probable_slip_needs_streak_and_fast_rt():
    entry = {"consecutive_successes": 3}
    fast_wrong = _event(success=False, seconds=4)
    assert not is_probable_slip(entry, fast_wrong, None)   # no own history → no claim
    assert is_probable_slip(entry, fast_wrong, 10.0)      # 4 < 0.5×10
    assert not is_probable_slip(entry, fast_wrong, 6.0)   # 4 >= 3
    assert not is_probable_slip({"consecutive_successes": 2}, fast_wrong, 10.0)
    assert not is_probable_slip(entry, _event(success=True, seconds=4), 10.0)


def test_learner_median_rt():
    events = [_event(seconds=4), _event(seconds=10), _event(seconds=6)]
    assert learner_median_rt(events) == 6
    assert learner_median_rt([]) is None


def test_wheel_spinning_flags_at_10_without_streak():
    losses = [_event(success=False) for _ in range(10)]
    state = wheel_spinning_state(losses)
    assert state["spinning"] and not state["mastered"]
    assert state["opportunities"] == 10

    mastered = [_event(success=False)] * 7 + [_event(success=True)] * 3
    state = wheel_spinning_state(mastered)
    assert state["mastered"] and not state["spinning"]


def test_wheel_spinning_early_warning_needs_massed_attempts():
    massed = []
    for _ in range(5):
        e = _event(success=False)
        e["timing"] = {"elapsed_since_previous_seconds": 20}
        massed.append(e)
    state = wheel_spinning_state(massed)
    assert state["early_warning"] and not state["spinning"]

    spaced = []
    for _ in range(5):
        e = _event(success=False)
        e["timing"] = {"elapsed_since_previous_seconds": 300}
        spaced.append(e)
    assert not wheel_spinning_state(spaced)["early_warning"]


def test_answer_cycling_on_fast_wrong_run():
    window = [_event(success=False, seconds=3, question_id=f"q{i}") for i in range(5)]
    signal = detect_answer_cycling(window)
    assert signal and signal["type"] == "rapid_answer_cycling"
    assert len(signal["evidence_event_ids"]) == 5


def test_answer_cycling_on_repeated_response_across_questions():
    window = [
        _event(success=False, seconds=30, response="42", question_id=f"q{i}")
        for i in range(3)
    ]
    assert detect_answer_cycling(window)


def test_no_cycling_on_correct_answers_with_same_response():
    window = [
        _event(success=True, seconds=30, response="ok", question_id=f"q{i}")
        for i in range(5)
    ]
    assert detect_answer_cycling(window) is None


def test_no_cycling_on_slow_honest_work():
    window = [
        _event(success=False, seconds=45, response=str(i), question_id=f"q{i}")
        for i in range(5)
    ]
    assert detect_answer_cycling(window) is None


def test_count_recent_rapid_guesses_uses_stored_flag():
    events = [{"effortful": False}, {"effortful": True}, {"effortful": False}, {}, {"effortful": False}]
    assert count_recent_rapid_guesses(events, window=5) == 3
