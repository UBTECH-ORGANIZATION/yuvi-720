"""Dynamic activeness — the questionnaire base, nudged by real usage.

The six פעלנות scores are seeded once by Onboarding (`derive_activeness`). That
base is a *stable anchor*: it always keeps weight. On top of it we layer a
bounded, evidence-gated **live delta** computed from the learner's recent
activity — how they solve, whether they bounce back from mistakes, how
consistently they show up, whether they pace themselves or guess, whether they
reflect, and whether they ask for help in a healthy way.

    effective = clamp( base + clamp(confidence · GAIN · delta, ±MAX_DRIFT), 0..100 )

`confidence` scales with how much relevant evidence exists, so with little or no
activity the score stays at the base (never yanked toward an "average"). The
live layer is recomputed on read from a rolling window, so the map's weekly
history naturally captures the trajectory.

Design choices (confirmed): anchored blend (base always weighted), windowed
recompute on read, help-seeking is healthy (only over-reliance mildly dents
self-regulation/initiative), and each domain reports the dominant *cause* behind
its live delta so the UI can show state-aware "how to improve" tips.

Numbers here are internal only — the learner sees a band + verbal tips, never a
score. Distress/wellbeing signals are deliberately NOT folded in (sensitive,
teacher-facing).
"""

from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from app.brain.mastery import event_score, event_success

COMPETENCY_KEYS = (
    "motivation_relevance",
    "growth_mindset",
    "initiative_responsibility",
    "self_regulation",
    "self_awareness",
    "support_emotional",
)

SCORING_VERBS = {"answered", "attempted", "scored", "completed"}
HINT_STRATEGIES = {"hint", "explain", "worked-example"}

WINDOW_DAYS = 21      # rolling window the live signals are read from
MAX_DRIFT = 28        # hard cap on |effective - base|
GAIN = 0.45           # live weight at full confidence (base keeps ≥ 0.55)
EVIDENCE_FULL = 12    # relevant events for a domain to reach full confidence
MIN_CAUSE_CONF = 0.3  # below this we don't assert a behavioural cause (too little data)
GUESS_SECS = 3.5      # a scored answer faster than this reads as a guess


def _parse(ts: Any) -> Optional[datetime]:
    if not ts:
        return None
    try:
        return datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
    except Exception:
        return None


def _clamp(v: float, lo: float, hi: float) -> float:
    return lo if v < lo else hi if v > hi else v


def _dur_seconds(d: Any) -> Optional[float]:
    if isinstance(d, (int, float)):
        return float(d)
    if isinstance(d, str) and d.startswith("PT"):
        m = re.match(r"PT(?:(\d+)M)?(?:([\d.]+)S)?$", d)
        if m:
            return int(m.group(1) or 0) * 60 + float(m.group(2) or 0)
    return None


def _mean(xs: list[float], default: float = 0.0) -> float:
    return sum(xs) / len(xs) if xs else default


# ── Windowed signal rollup ────────────────────────────────────────────────────
def _metrics(brain: dict, events: list[dict], decisions: list[dict]) -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(days=WINDOW_DAYS)

    def in_window(item: dict, field: str) -> bool:
        t = _parse(item.get(field))
        return t is None or t >= cutoff  # undated → assume recent, don't drop

    win = [e for e in events if in_window(e, "occurred_at")]
    scored = [e for e in win if e.get("verb") in SCORING_VERBS]
    n = len(scored)
    active_days = len({(_parse(e.get("occurred_at")) or now).date().isoformat() for e in win}) if win else 0
    completions = sum(1 for e in scored if e.get("verb") == "completed")
    objectives = {e.get("objective_id") for e in scored if e.get("objective_id")}

    scores: list[float] = []
    successes = failures = 0
    guesses = timed = 0
    for e in scored:
        res = e.get("result") or {}
        sc = event_score(res)
        if sc is not None:
            scores.append(sc)
            if event_success(res, sc):
                successes += 1
            else:
                failures += 1
        dur = _dur_seconds(res.get("duration"))
        if dur is not None:
            timed += 1
            if dur < GUESS_SECS:
                guesses += 1

    # Recovery: objectives where a failure was later followed by a success.
    by_obj: dict[Any, list[dict]] = {}
    for e in scored:
        oid = e.get("objective_id")
        if oid:
            by_obj.setdefault(oid, []).append(e)
    failed_objs = recovered_objs = 0
    for oid, evs in by_obj.items():
        evs = sorted(evs, key=lambda x: _parse(x.get("occurred_at")) or now)
        seen_fail = recovered = False
        for e in evs:
            res = e.get("result") or {}
            sc = event_score(res)
            if sc is None:
                continue
            ok = event_success(res, sc)
            if seen_fail and ok:
                recovered = True
            if not ok:
                seen_fail = True
        if seen_fail:
            failed_objs += 1
            if recovered:
                recovered_objs += 1

    # Mastery rollup (per-objective durable stance).
    mastery = [m for m in (brain.get("mastery") or {}).values() if isinstance(m, dict)]
    needs_review = sum(1 for m in mastery if m.get("needs_review"))
    review_ratio = (needs_review / len(mastery)) if mastery else 0.0
    avg_streak = _mean([float(m.get("consecutive_successes") or 0) for m in mastery])

    # Reflections (self-awareness). Prefer windowed, else recent count.
    refl = [r for r in (brain.get("reflections_recent") or []) if isinstance(r, dict)]
    refl_win = [r for r in refl if in_window(r, "at")]
    reflections = len(refl_win) if refl_win else len(refl)

    # Hint / help usage (best-effort; neutral when absent).
    hint_events = [d for d in decisions if (d.get("strategy") in HINT_STRATEGIES) or d.get("hint_level")]
    n_hint = len(hint_events)
    max_hint = max([int(d.get("hint_level") or 1) for d in hint_events], default=0)

    return {
        "n": n,
        "active_days": active_days,
        "completions": completions,
        "objectives": len(objectives),
        "avg_score": _mean(scores, 0.5),
        "successes": successes,
        "failures": failures,
        "success_rate": (successes / (successes + failures)) if (successes + failures) else None,
        "guess_rate": (guesses / timed) if timed else None,
        "failed_objs": failed_objs,
        "recovery_rate": (recovered_objs / failed_objs) if failed_objs else None,
        "review_ratio": review_ratio,
        "avg_streak": avg_streak,
        "reflections": reflections,
        "n_hint": n_hint,
        "hint_rate": (n_hint / n) if n else None,
        "max_hint": max_hint,
    }


# ── Per-domain live delta + cause ─────────────────────────────────────────────
# Each contribution is (cause_tag, points). Positive lifts the score, negative
# drags it. The dominant negative cause(s) drive the "how to improve" tips.
def _contribs(key: str, m: dict) -> list[tuple[str, float]]:
    n = m["n"]
    c: list[tuple[str, float]] = []

    # Shared helpers (None-safe: a missing signal contributes nothing).
    regularity = _clamp(m["active_days"] / (WINDOW_DAYS * 0.4), 0, 1)  # ~8/21 days = full
    completion_rate = _clamp(m["completions"] / max(1, m["objectives"]), 0, 1)

    if key == "motivation_relevance":       # showing up, curiosity, finishing
        c.append(("inconsistent", (regularity - 0.5) * 40))
        c.append(("low_engagement", (completion_rate - 0.5) * 22))
        if n:
            c.append(("low_engagement", _clamp((n - 4) / 8, -0.5, 0.5) * 12))
    elif key == "growth_mindset":           # bouncing back, effort after a miss
        if m["recovery_rate"] is not None:
            c.append(("quits_on_fail", (m["recovery_rate"] - 0.5) * 44))
        if m["success_rate"] is not None:
            c.append(("quits_on_fail", (m["success_rate"] - 0.55) * 16))
        c.append(("low_engagement", (_clamp(m["avg_streak"] / 3, 0, 1) - 0.4) * 14))
    elif key == "initiative_responsibility":  # self-drive, attempt-first, finishing
        c.append(("low_engagement", (completion_rate - 0.5) * 30))
        if m["hint_rate"] is not None:        # leaning on hints before trying → less initiative
            c.append(("hint_reliance", -_clamp(m["hint_rate"] - 0.4, 0, 0.6) * 26))
        if n:
            c.append(("low_engagement", _clamp((m["active_days"] - 3) / 6, -0.4, 0.4) * 12))
    elif key == "self_regulation":          # pacing, focus, review adherence
        if m["guess_rate"] is not None:
            c.append(("guessing", (0.5 - m["guess_rate"]) * 40))
        c.append(("guessing", (0.4 - m["review_ratio"]) * 20))
        if m["hint_rate"] is not None:        # over-reliance mildly dents self-reg
            c.append(("hint_reliance", -_clamp(m["hint_rate"] - 0.6, 0, 0.4) * 24))
    elif key == "self_awareness":           # reflecting, noticing what helps
        refl_rate = _clamp(m["reflections"] / max(1, m["completions"] or m["objectives"]), 0, 1)
        c.append(("low_reflection", (refl_rate - 0.4) * 44))
        if m["reflections"] == 0 and (m["completions"] or 0) >= 2:
            c.append(("low_reflection", -10))
    elif key == "support_emotional":        # healthy help-seeking, connectedness
        if m["hint_rate"] is not None:        # asking for help is GOOD here
            c.append(("isolation", _clamp(m["hint_rate"], 0, 0.5) * 34))
        # Stuck (real failures) but never reaches out → isolation drag.
        if (m["failures"] or 0) >= 2 and m["n_hint"] == 0:
            c.append(("isolation", -16))
        if n:
            c.append(("isolation", _clamp((m["active_days"] - 2) / 6, -0.3, 0.3) * 10))
    return c


def _evidence(key: str, m: dict) -> int:
    """Relevant evidence count for this domain → confidence."""
    base = m["n"]
    if key == "growth_mindset":
        base = m["failed_objs"] * 3 + m["n"]
    elif key == "self_awareness":
        base = m["reflections"] * 3 + m["completions"]
    elif key == "support_emotional":
        base = m["n_hint"] * 3 + m["n"]
    return base


def _cause_tags(key: str, contribs: list[tuple[str, float]], value: float, conf: float) -> list[str]:
    # Without enough evidence we assert no behavioural cause — the UI then falls
    # back to the static per-domain tips rather than blaming a kid with no data.
    if conf < MIN_CAUSE_CONF:
        return []
    # Aggregate points per cause, then surface the biggest drags.
    agg: dict[str, float] = {}
    for tag, pts in contribs:
        agg[tag] = agg.get(tag, 0.0) + pts
    drags = sorted([(t, p) for t, p in agg.items() if p < -1.5], key=lambda x: x[1])
    tags = [t for t, _ in drags][:2]
    if not tags:
        # No meaningful drag — celebrate/stretch or keep steady.
        tags = ["stretch"] if value >= 70 else ["keep"]
    return tags


def effective_activeness(
    brain: dict,
    events: Optional[list[dict]] = None,
    decisions: Optional[list[dict]] = None,
) -> dict[str, dict[str, Any]]:
    """Return {key: {base, value, delta, confidence, causes}} for all six domains.

    `value` is the effective 0–100 score (base anchored + bounded live delta).
    Falls back cleanly to the base when there is no activity evidence.
    """
    base_map = (brain.get("profile") or {}).get("activeness") or {}
    m = _metrics(brain, events or [], decisions or [])

    out: dict[str, dict[str, Any]] = {}
    for key in COMPETENCY_KEYS:
        base = float(base_map.get(key, 60) or 60)
        contribs = _contribs(key, m)
        raw_delta = sum(p for _, p in contribs)
        conf = _clamp(_evidence(key, m) / EVIDENCE_FULL, 0, 1)
        delta = _clamp(conf * GAIN * raw_delta, -MAX_DRIFT, MAX_DRIFT)
        value = int(round(_clamp(base + delta, 0, 100)))
        out[key] = {
            "base": int(round(base)),
            "value": value,
            "delta": round(delta, 1),
            "confidence": round(conf, 2),
            "causes": _cause_tags(key, contribs, value, conf),
        }
    return out
