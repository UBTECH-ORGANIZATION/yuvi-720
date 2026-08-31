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
MOVEMENT_DAYS = 7     # the card compares against ~a week ago; drivers must match it
MOVED_POINTS = 0.75   # contribution points a signal must shift to count as moved
GUESS_SECS = 3.5      # a scored answer faster than this reads as a guess
# Oldest evidence this engine can still read: the prior window's far edge. Callers
# must fetch at least this far back or the week-over-week comparison is measured
# against a gap in the fetch rather than a gap in the learning.
EVIDENCE_SPAN_DAYS = WINDOW_DAYS + MOVEMENT_DAYS


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
def _metrics(
    brain: dict, events: list[dict], decisions: list[dict],
    as_of: Optional[datetime] = None,
) -> dict[str, Any]:
    """Roll the signals up over the window ending at `as_of` (default: now).

    Re-running this a week back is how "why did it go down?" gets answered: the
    current numbers describe where the learner stands, never what moved.
    """
    now = as_of or datetime.now(timezone.utc)
    cutoff = now - timedelta(days=WINDOW_DAYS)

    def in_window(item: dict, field: str) -> bool:
        t = _parse(item.get(field))
        return t is None or cutoff <= t <= now  # undated → assume recent, don't drop

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

    # Per-objective detail, so a driver can name the lesson it actually came
    # from instead of describing the week in the abstract.
    per_obj: dict[str, dict[str, Any]] = {}
    for e in scored:
        oid = e.get("objective_id")
        if not oid:
            continue
        slot = per_obj.setdefault(str(oid), {
            "answered": 0, "completed": 0, "failures": 0, "fast": 0,
            "recovered": False, "last_at": None,
        })
        slot["answered"] += 1
        if e.get("verb") == "completed":
            slot["completed"] += 1
        res = e.get("result") or {}
        sc = event_score(res)
        if sc is not None and not event_success(res, sc):
            slot["failures"] += 1
        dur = _dur_seconds(res.get("duration"))
        if dur is not None and dur < GUESS_SECS:
            slot["fast"] += 1
        at = e.get("occurred_at")
        if at and (slot["last_at"] is None or str(at) > str(slot["last_at"])):
            slot["last_at"] = at

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
            if str(oid) in per_obj:
                per_obj[str(oid)]["recovered"] = recovered

    # Mastery rollup (per-objective durable stance).
    mastery = [m for m in (brain.get("mastery") or {}).values() if isinstance(m, dict)]
    needs_review = sum(1 for m in mastery if m.get("needs_review"))
    review_ratio = (needs_review / len(mastery)) if mastery else 0.0
    avg_streak = _mean([float(m.get("consecutive_successes") or 0) for m in mastery])

    # Reflections (self-awareness), strictly windowed. No all-time fallback: it
    # would report reflections the learner did not make in this window, and
    # `in_window` already keeps undated entries, so an empty window means zero.
    refl = [r for r in (brain.get("reflections_recent") or []) if isinstance(r, dict)]
    reflections = len([r for r in refl if in_window(r, "at")])

    # Hint / help usage (best-effort; neutral when absent). Windowed like every
    # other signal: an unwindowed count is identical at both ends of the
    # comparison, so hint-shaped causes could never register a change at all.
    hint_events = [
        d for d in decisions
        if ((d.get("strategy") in HINT_STRATEGIES) or d.get("hint_level"))
        and in_window(d, "at")
    ]
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
        "guesses": guesses,
        "failed_objs": failed_objs,
        "recovered_objs": recovered_objs,
        "recovery_rate": (recovered_objs / failed_objs) if failed_objs else None,
        "review_ratio": review_ratio,
        "avg_streak": avg_streak,
        "reflections": reflections,
        "n_hint": n_hint,
        "hint_rate": (n_hint / n) if n else None,
        "max_hint": max_hint,
        "per_obj": per_obj,
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


# Internal, non-numeric descriptor for every cause tag `_cause_tags` can emit.
# Never shown verbatim: whatever surface explains a move to a learner phrases it
# warmly in their own language, and these ground that phrasing in the behaviour
# actually measured rather than letting a model invent a reason.
#
# Kept beside the tags themselves so the two cannot drift — a tag with no hint
# is a cause nothing can verbalize, which `test_activeness` fails on.
# The learner-facing name of each domain. Lived in `competency_coach` until that
# module was retired; kept here beside the keys and the cause hints so the three
# cannot drift apart.
COMPETENCY_NAMES = {
    "motivation_relevance": {"he": "מוטיבציה ורלוונטיות", "en": "Motivation & relevance", "ar": "الدافعية والصلة"},
    "growth_mindset": {"he": "תפיסת צמיחה", "en": "Growth mindset", "ar": "عقلية النمو"},
    "initiative_responsibility": {"he": "יוזמה ואחריות", "en": "Initiative & responsibility", "ar": "المبادرة والمسؤولية"},
    "self_regulation": {"he": "ויסות עצמי", "en": "Self-regulation", "ar": "التنظيم الذاتي"},
    "self_awareness": {"he": "מודעות עצמית", "en": "Self-awareness", "ar": "الوعي الذاتي"},
    "support_emotional": {"he": "תמיכה וחוויה רגשית", "en": "Support & emotional experience", "ar": "الدعم والتجربة العاطفية"},
}


CAUSE_HINTS = {
    "inconsistent": {
        "he": "הופעה לא סדירה — פערים בין ימי הלמידה",
        "ar": "حضور غير منتظم — فجوات بين أيام التعلّم",
        "en": "irregular attendance — gaps between learning days",
    },
    "quits_on_fail": {
        "he": "אחרי טעות נוטה לעצור במקום לנסות שוב",
        "ar": "بعد الخطأ يميل إلى التوقّف بدل المحاولة مجددًا",
        "en": "after a mistake tends to stop instead of trying again",
    },
    "guessing": {
        "he": "תשובות מהירות מדי — סימן לניחוש במקום עצירה לחשוב",
        "ar": "إجابات سريعة جدًا — إشارة إلى التخمين بدل التوقّف للتفكير",
        "en": "very fast answers — a sign of guessing rather than pausing to think",
    },
    "hint_reliance": {
        "he": "פנייה מהירה לרמזים לפני ניסיון עצמאי",
        "ar": "اللجوء السريع إلى التلميحات قبل محاولة مستقلة",
        "en": "reaching for hints before an independent attempt",
    },
    "low_engagement": {
        "he": "מעט פעילות והשלמות בתקופה האחרונה",
        "ar": "نشاط وإنجازات قليلة في الفترة الأخيرة",
        "en": "little activity and few completions recently",
    },
    "low_reflection": {
        "he": "כמעט בלי רפלקציה או עצירה לחשוב אחרי שיעורים",
        "ar": "شبه غياب للتأمّل بعد الدروس",
        "en": "almost no reflection after lessons",
    },
    "isolation": {
        "he": "התמודדות עם קושי בלי לבקש עזרה",
        "ar": "مواجهة الصعوبة دون طلب المساعدة",
        "en": "facing difficulty without asking for help",
    },
    "keep": {
        "he": "המשך יציב וטוב — כדאי לשמור על הקצב",
        "ar": "تقدّم ثابت وجيد — يُستحسن الحفاظ على الوتيرة",
        "en": "steady, good progress — worth keeping the pace",
    },
    "stretch": {
        "he": "ביצוע חזק — אפשר לקחת אתגר גדול יותר",
        "ar": "أداء قوي — يمكن خوض تحدٍّ أكبر",
        "en": "strong performance — ready for a bigger challenge",
    },
}


def _attribute(tag: str, direction: str, per_obj: dict[str, dict[str, Any]]) -> Optional[str]:
    """The objective a driver most plausibly came from, or ``None``.

    Only some signals are lesson-shaped. Showing up regularly, or stopping to
    reflect, is about the week rather than about one lesson — naming one there
    would be a guess dressed up as evidence.
    """
    items = list(per_obj.items())
    if not items:
        return None

    def top(keep, rank) -> Optional[str]:
        pool = [(oid, s) for oid, s in items if keep(s)]
        return max(pool, key=lambda x: rank(x[1]))[0] if pool else None

    if tag == "low_engagement":
        if direction == "down":                       # started it, never finished
            return top(lambda s: s["answered"] and not s["completed"], lambda s: s["answered"])
        return top(lambda s: s["completed"], lambda s: str(s["last_at"] or ""))
    if tag == "quits_on_fail":
        if direction == "down":                       # missed it and moved on
            return top(lambda s: s["failures"] and not s["recovered"], lambda s: s["failures"])
        return top(lambda s: s["recovered"], lambda s: str(s["last_at"] or ""))
    if tag == "guessing" and direction == "down":
        return top(lambda s: s["fast"], lambda s: s["fast"])
    return None


# The raw counts behind each cause, so the card and the coach can say what
# actually happened this week instead of repeating one canned sentence per tag.
_TAG_FACTS: dict[str, tuple[str, ...]] = {
    "inconsistent": ("active_days",),
    "low_engagement": ("completions", "objectives"),
    "quits_on_fail": ("failed_objs", "recovered_objs"),
    "hint_reliance": ("n_hint",),
    "guessing": ("guesses",),
    "low_reflection": ("reflections",),
    "isolation": ("n_hint", "failures"),
}


def _facts(tag: str, m: dict, prior: dict) -> dict[str, int]:
    """This week's counts for a cause, paired with the same counts a week ago.

    Both ends travel together: "two days" means nothing to a learner until it
    sits next to the five they managed last week.
    """
    out: dict[str, int] = {}
    for field in _TAG_FACTS.get(tag, ()):
        now, then = m.get(field), prior.get(field)
        if isinstance(now, (int, float)) and not isinstance(now, bool):
            out[field] = int(now)
        if isinstance(then, (int, float)) and not isinstance(then, bool):
            out[f"{field}_prior"] = int(then)
    return out


def _drivers(
    contribs: list[tuple[str, float]],
    prior_contribs: list[tuple[str, float]],
    conf: float,
    m: dict,
    prior: dict,
) -> list[dict[str, Any]]:
    """What CHANGED in this domain since last week, strongest first.

    Deliberately not the current state. A domain can dip while every signal is
    still positive — today's numbers then hold no explanation for the dip, and a
    coach reading them can only recite the good news. The answer is which signal
    weakened, which exists only by running the same maths at two points in time.
    """
    if conf < MIN_CAUSE_CONF:
        return []

    def aggregate(rows: list[tuple[str, float]]) -> dict[str, float]:
        out: dict[str, float] = {}
        for tag, pts in rows:
            out[tag] = out.get(tag, 0.0) + pts
        return out

    now_agg, then_agg = aggregate(contribs), aggregate(prior_contribs)
    moved = {
        tag: now_agg.get(tag, 0.0) - then_agg.get(tag, 0.0)
        for tag in set(now_agg) | set(then_agg)
    }
    per_obj = m.get("per_obj") or {}
    out: list[dict[str, Any]] = []
    # Attendance leads when it moved. It is upstream of the rest — activities go
    # unfinished and mistakes go unrevisited largely because nobody was there —
    # so telling a learner who barely showed up that they left work unfinished
    # answers a smaller question than the one they asked. It only ever appears
    # here when it genuinely shifted, so promoting it invents nothing.
    def rank(item: tuple[str, float]) -> tuple[int, float]:
        tag, delta = item
        return (0 if tag == "inconsistent" else 1, -abs(delta))

    for tag, delta in sorted(moved.items(), key=rank):
        if abs(delta) < MOVED_POINTS:
            continue
        direction = "up" if delta > 0 else "down"
        entry: dict[str, Any] = {"tag": tag, "dir": direction}
        objective_id = _attribute(tag, direction, per_obj)
        if objective_id:
            entry["objective_id"] = objective_id
        facts = _facts(tag, m, prior)
        if facts:
            entry["facts"] = facts
        out.append(entry)
    return out
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
    # The same rollup a week back, so `drivers` can say what MOVED rather than
    # what merely is. Mastery-derived signals (review ratio, streaks) are current
    # either way — they have no per-day history to rewind.
    now = datetime.now(timezone.utc)
    prior = _metrics(brain, events or [], decisions or [], as_of=now - timedelta(days=MOVEMENT_DAYS))

    # An empty prior window means either "they had not started yet" or "we were
    # not recording" — identical in the events, opposite in meaning. Activity
    # from BEFORE that window separates them: a beginner has none, a learner
    # whose relay went dark does. Without this, ingest coming back online reads
    # as the learner improving.
    prior_start = now - timedelta(days=MOVEMENT_DAYS + WINDOW_DAYS)
    silent_gap = any(
        (t := _parse(e.get("occurred_at"))) is not None and t < prior_start
        for e in (events or [])
    )

    out: dict[str, dict[str, Any]] = {}
    for key in COMPETENCY_KEYS:
        base = float(base_map.get(key, 60) or 60)
        contribs = _contribs(key, m)
        raw_delta = sum(p for _, p in contribs)
        conf = _clamp(_evidence(key, m) / EVIDENCE_FULL, 0, 1)
        delta = _clamp(conf * GAIN * raw_delta, -MAX_DRIFT, MAX_DRIFT)
        value = int(round(_clamp(base + delta, 0, 100)))
        # The same score as of a week ago, so the arrow the learner sees and the
        # reason behind it come from ONE calculation. Deriving the arrow from a
        # stored snapshot instead let a domain show a dip that the event data
        # could not explain — the card asked "why?" where there was no answer.
        prior_contribs = _contribs(key, prior)
        prior_conf = _clamp(_evidence(key, prior) / EVIDENCE_FULL, 0, 1)
        prior_value = int(round(_clamp(
            base + _clamp(prior_conf * GAIN * sum(p for _, p in prior_contribs),
                          -MAX_DRIFT, MAX_DRIFT), 0, 100)))
        # Confidence that the CHANGE is real, which is not the same as confidence
        # in today's score. A learner who stopped coming has no current evidence,
        # and that absence IS the finding — the week they did show up is evidence
        # enough to say what changed. Only ever for a decline: a rise has to be
        # earned by something observed, never by the absence of it, or a learner
        # who drifts back toward base by doing nothing gets congratulated.
        change_conf = max(conf, prior_conf) if value <= prior_value else conf
        # Claim no movement at all rather than movement we cannot vouch for.
        blind = silent_gap and prior_conf < MIN_CAUSE_CONF
        drivers = [] if blind else _drivers(contribs, prior_contribs, change_conf, m, prior)
        # Borrowing last week's confidence is only justified if it buys an
        # explanation. Scores drift as evidence thins, so without this a domain
        # can slide purely because confidence fell — an arrow with no reason,
        # which is the "why?" with no answer this card exists to avoid.
        if not drivers:
            change_conf = conf
        shown_prior = value if blind else prior_value
        # An arrow nothing explains is the defect this card exists to remove.
        # `value` is confidence-scaled while drivers compare raw contributions,
        # so a domain can slide while the behaviour behind it improved: more
        # evidence of a still-negative signal drags the score down even as the
        # signal gets better. The card then points down while the coach, reading
        # the same drivers, says up — and the learner is told both.
        if shown_prior != value:
            moved = "up" if value > shown_prior else "down"
            if not any(d["dir"] == moved for d in drivers):
                shown_prior = value
        out[key] = {
            "base": int(round(base)),
            "value": value,
            "delta": round(delta, 1),
            "confidence": round(conf, 2),
            "change_confidence": round(change_conf, 2),
            "causes": _cause_tags(key, contribs, value, conf),
            "drivers": drivers,
            "prior_value": shown_prior,
        }
    return out
