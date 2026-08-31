"""Drive synthetic learner weeks through the real activeness engine.

Emits JSON for the node half, which resolves each message with the production
`variantFor` and the real locale bundle — simulating with a re-implementation
would only prove my copy agrees with itself.

Window shapes that matter: days 0-6 fall in the current window only, days 22-27
in the prior window only. Those two ranges are what create a change; anything
between sits in both windows and largely cancels out.
"""
import json
import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.brain.activeness import MIN_CAUSE_CONF, effective_activeness  # noqa: E402

NOW = datetime.now(timezone.utc)
CHANGE_THRESHOLD = 4  # mirrors the card's gate; reporting only

BASE = {
    "motivation_relevance": 55,
    "growth_mindset": 55,
    "initiative_responsibility": 55,
    "self_regulation": 55,
    "self_awareness": 55,
    "support_emotional": 55,
}


def ev(verb="answered", ok=True, score=None, dur=None, obj="o1", days_ago=0):
    result = {}
    if ok is not None:
        result["success"] = ok
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


def brain(reflections=()):
    return {
        "profile": {"activeness": dict(BASE)},
        "mastery": {},
        "reflections_recent": [
            {"at": (NOW - timedelta(days=d)).isoformat()} for d in reflections
        ],
    }


def hints(n, level=1):
    return [{"strategy": "hint", "hint_level": level} for _ in range(n)]


def steady_prior():
    """A solid week a month ago, so 'this week' has something to differ from."""
    out = []
    for d in range(22, 28):
        out.append(ev(verb="completed", obj=f"p{d}", days_ago=d))
        out.append(ev(obj=f"p{d}", days_ago=d))
    return out


SCENARIOS = []


def scenario(name, events, decisions=(), reflections=()):
    SCENARIOS.append((name, events, list(decisions), reflections))


scenario("כמעט לא נכנסה השבוע", steady_prior() + [ev(obj="n1", days_ago=1)])

scenario("לא נכנסה בכלל השבוע", steady_prior())

scenario(
    "מתחילה ולא מסיימת",
    steady_prior() + [ev(obj=f"n{d}", days_ago=d) for d in range(0, 6) for _ in range(3)],
)

scenario(
    "מסיימת את מה שהתחילה",
    steady_prior()
    + [ev(verb="completed", obj=f"n{d}", days_ago=d) for d in range(0, 6)]
    + [ev(obj=f"n{d}", days_ago=d) for d in range(0, 6)],
)

scenario(
    "נשברת אחרי טעות",
    steady_prior()
    + [ev(ok=False, score=0.0, obj=f"n{d}", days_ago=d) for d in range(0, 6) for _ in range(2)],
)

scenario(
    "חוזרת אחרי טעות",
    steady_prior()
    + [x for d in range(0, 6) for x in (
        ev(ok=False, score=0.0, obj=f"n{d}", days_ago=d),
        ev(ok=True, score=1.0, obj=f"n{d}", days_ago=d),
    )],
)

scenario(
    "עונה מהר מדי",
    steady_prior()
    + [ev(obj=f"n{d}", days_ago=d, dur=1.5, score=0.4, ok=False)
       for d in range(0, 6) for _ in range(3)],
)

scenario(
    "הפסיקה לכתוב רפלקציות",
    steady_prior() + [ev(verb="completed", obj=f"n{d}", days_ago=d) for d in range(0, 6)],
    reflections=(23, 24, 25, 26),
)

scenario(
    "התחילה לכתוב רפלקציות",
    steady_prior() + [ev(verb="completed", obj=f"n{d}", days_ago=d) for d in range(0, 6)],
    reflections=(0, 1, 2, 3, 4),
)

scenario(
    "נתקעת ולא מבקשת עזרה",
    steady_prior()
    + [ev(ok=False, score=0.0, obj=f"n{d}", days_ago=d) for d in range(0, 6) for _ in range(2)],
)

scenario(
    "נתקעת ומבקשת עזרה",
    steady_prior()
    + [ev(ok=False, score=0.0, obj=f"n{d}", days_ago=d) for d in range(0, 6) for _ in range(2)],
    decisions=hints(8),
)

scenario(
    "תלמידה חדשה (שבוע ראשון)",
    [ev(verb="completed", obj=f"n{d}", days_ago=d) for d in range(0, 6)]
    + [ev(obj=f"n{d}", days_ago=d) for d in range(0, 6)],
)

scenario(
    "חזרה אחרי היעדרות ארוכה",
    [ev(verb="completed", obj=f"o{d}", days_ago=d) for d in range(40, 48)]
    + [ev(verb="completed", obj=f"n{d}", days_ago=d) for d in range(0, 6)]
    + [ev(obj=f"n{d}", days_ago=d) for d in range(0, 6)],
)

out = []
for name, events, decisions, reflections in SCENARIOS:
    eff = effective_activeness(brain(reflections), events, decisions)
    domains = []
    for key, row in eff.items():
        delta = row["value"] - row["prior_value"]
        domains.append({
            "key": key,
            "value": row["value"],
            "prior": row["prior_value"],
            "delta": delta,
            # The card's own gate: a big enough move AND enough evidence to
            # stand behind it (dashboard.py sets evidenceBacked the same way).
            "shown": (
                abs(delta) >= CHANGE_THRESHOLD
                and row["change_confidence"] >= MIN_CAUSE_CONF
            ),
            "conf": row["confidence"],
            "change_conf": row["change_confidence"],
            "drivers": [
                {
                    "tag": d["tag"],
                    "dir": d["dir"],
                    "facts": d.get("facts") or {},
                    "lesson": bool(d.get("objective_id")),
                }
                for d in (row.get("drivers") or [])
            ],
        })
    out.append({"scenario": name, "domains": domains})

print(json.dumps(out, ensure_ascii=False))
