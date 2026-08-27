"""Seed PBI-451 habit-score data for the students in Gal's class.

    cd backend && ./.venv/bin/python scripts/seed_score_signals.py [--dry-run] [--reset]

Five students, five deliberately different combinations, so together they
exercise every sub-score and every dialog state:

  tamar — the independent asker: self-diagnostic questions, tries before
          asking, recovers, works in long stretches. High on both, trending up.
  moti  — the answer-seeker: asks for the answer before trying, deep hint use,
          one give-up. Low independence, trending down.
  itay  — the distracted guesser: rapid answers, idle stretches, off-topic
          chat, no sustained streaks. Low concentration.
  dvir  — the silent struggler: never opens the chat, gives up quietly, wheel-
          spins on one objective. The "never asks ≠ independent" case.
  noam  — almost no evidence: both dials must say "not enough evidence yet".

Every seeded document carries ``seed_451: True`` (and signal dedupe keys are
prefixed ``seed:``), so ``--reset`` removes exactly what this script created
and re-running is safe. gal is deliberately NOT seeded.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server  # noqa: F401  — loads .env before any collection handle

from app.brain.repository import _get_collection_named

NOW = datetime.now(timezone.utc)
SUBJECT = "math"
UNIT = "seed-unit-451"

MARK = {"seed_451": True}


def at(days_ago: float) -> str:
    return (NOW - timedelta(days=days_ago)).isoformat()


class Builder:
    """Accumulates the four collections' rows for one learner."""

    def __init__(self, learner: str):
        self.learner = learner
        self.events: list[dict] = []
        self.activity: list[dict] = []
        self.decisions: list[dict] = []
        self.signals: list[dict] = []
        self._n = 0

    def _id(self) -> str:
        self._n += 1
        return f"seed451-{self.learner}-{self._n:03d}"

    def answer(self, days_ago: float, *, ok: bool, comp: str, item: str, q: str,
               objective: str, session: str, effortful: bool = True,
               gap: float = 90.0) -> None:
        self.events.append({
            "_id": self._id(), "learner_id": self.learner, "verb": "answered",
            "object_id": f"{comp}#{q}", "sub_item_id": item, "question_id": q,
            "objective_id": objective, "subject": SUBJECT, "launch": comp,
            "unit_id": UNIT, "session_id": session,
            "result": {"success": ok}, "effortful": effortful,
            "timing": {"elapsed_since_previous_seconds": gap, "quality": "measured"},
            "occurred_at": at(days_ago), "stored_at": at(days_ago), **MARK,
        })

    def walk_away(self, days_ago: float, *, verb: str, comp: str, session: str) -> None:
        self.events.append({
            "_id": self._id(), "learner_id": self.learner, "verb": verb,
            "object_id": comp, "sub_item_id": None, "question_id": None,
            "objective_id": None, "subject": SUBJECT, "launch": comp,
            "unit_id": UNIT, "session_id": session, "result": {},
            "occurred_at": at(days_ago), "stored_at": at(days_ago), **MARK,
        })

    def support(self, days_ago: float, *, kind: str, comp: str, item: str,
                q: str, objective: str) -> None:
        self.activity.append({
            "learner_id": self.learner, "kind": kind, "component_id": comp,
            "item_id": item, "question_id": q, "objective_id": objective,
            "subject": SUBJECT, "at": at(days_ago), **MARK,
        })

    def hint_decision(self, days_ago: float, *, level: int = 1) -> None:
        self.decisions.append({
            "learner_id": self.learner, "strategy": "hint", "intention": "diagnose",
            "hint_level": level, "at": at(days_ago), **MARK,
        })

    def signal(self, days_ago: float, *, kind: str, dedupe: str,
               session: str | None = None, objective: str | None = None,
               meta: dict | None = None) -> None:
        self.signals.append({
            "learner_id": self.learner, "kind": kind, "at": at(days_ago),
            "objective_id": objective, "session_id": session,
            "dedupe_key": f"seed:{dedupe}", **({"meta": meta} if meta else {}), **MARK,
        })

    def label(self, days_ago: float, *, label: str, n: int) -> None:
        self.signal(days_ago, kind="question_quality",
                    dedupe=f"qq:{self.learner}:{label}:{n}",
                    meta={"label": label, "confidence": 0.9, "question_key": None})

    def idle(self, days_ago: float, *, n: int) -> None:
        self._n += 1
        self.signal(days_ago, kind="idle",
                    dedupe=f"idle:{self.learner}:{n}:{self._n}",
                    meta={"idle_seconds": 150, "lesson_open": True})


def seed_tamar() -> Builder:
    b = Builder("tamar")
    for window, base, fail_extra in (("cur", 1.0, 0), ("pri", 8.0, 1)):
        comp = f"seed-comp-{window}-t"
        for s in range(2):
            session = f"seed-s-tamar-{window}-{s}"
            for i in range(7):
                ok = not (i == 3 or (fail_extra and i == 5))
                b.answer(base + s * 2 + i * 0.01, ok=ok, comp=comp, item=f"i{s}",
                         q=f"q{i}", objective="MATH-COORD-1", session=session, gap=110)
            b.signal(base + s * 2, kind="sustained_effort",
                     dedupe=f"sus:tamar:{window}:{s}", session=session)
        # A struggle run that ends in a fresh success → one recovery.
        session = f"seed-s-tamar-{window}-r"
        b.answer(base + 4.2, ok=False, comp=comp, item="ir", q="qr",
                 objective="MATH-FRAC-1", session=session)
        b.answer(base + 4.1, ok=False, comp=comp, item="ir", q="qr",
                 objective="MATH-FRAC-1", session=session)
        b.answer(base + 4.0, ok=True, comp=comp, item="ir", q="qr",
                 objective="MATH-FRAC-1", session=session)
        b.signal(base + 4.0, kind="recovery", dedupe=f"rec:tamar:{window}",
                 objective="MATH-FRAC-1", session=session)
        # Help arrives AFTER her own attempt on that same question.
        b.support(base + 4.05, kind="hint", comp=comp, item="ir", q="qr",
                  objective="MATH-FRAC-1")
        b.support(base + 4.04, kind="explanation", comp=comp, item="ir", q="qr",
                  objective="MATH-FRAC-1")
        b.hint_decision(base + 4.05)
        b.idle(base + 2.0, n=1 if window == "cur" else 2)
    # Asking well, current window stronger than prior (trend up).
    for n in range(3):
        b.label(1.2 + n * 0.1, label="self_diagnostic", n=n)
    for n in range(2):
        b.label(1.6 + n * 0.1, label="conceptual", n=n)
    b.label(2.0, label="verification", n=0)
    b.label(8.2, label="verification", n=1)
    b.label(8.4, label="procedural", n=0)
    b.label(8.6, label="self_diagnostic", n=9)
    return b


def seed_moti() -> Builder:
    b = Builder("moti")
    for window, base, asks_first in (("cur", 1.0, True), ("pri", 8.0, False)):
        comp = f"seed-comp-{window}-m"
        session = f"seed-s-moti-{window}-0"
        for i in range(8):
            b.answer(base + i * 0.02, ok=i % 2 == 0, comp=comp, item="i0",
                     q=f"q{i}", objective="MATH-COORD-1", session=session, gap=100)
        # Help BEFORE trying (current window) vs after (prior) — the trend
        # the tried-before-asking sub-score should show going down.
        for i in range(5):
            offset = 0.03 if asks_first else -0.03   # relative to the attempt
            b.support(base + i * 0.02 + offset, kind="hint", comp=comp,
                      item="i0", q=f"q{i}", objective="MATH-COORD-1")
            b.hint_decision(base + i * 0.02)
        # One give-up: two effortful misses, then the lesson is skipped.
        b.answer(base + 3.02, ok=False, comp=comp, item="ig", q="qg",
                 objective="MATH-FRAC-1", session=f"seed-s-moti-{window}-g")
        b.answer(base + 3.01, ok=False, comp=comp, item="ig", q="qg",
                 objective="MATH-FRAC-1", session=f"seed-s-moti-{window}-g")
        b.walk_away(base + 3.0, verb="skipped", comp=comp,
                    session=f"seed-s-moti-{window}-g")
        b.idle(base + 2.0, n=1 if window == "cur" else 2)
        b.signal(base + 0.1, kind="sustained_effort",
                 dedupe=f"sus:moti:{window}", session=session)
    for n in range(4):
        b.label(1.3 + n * 0.1, label="answer_seeking", n=n)
    b.label(1.8, label="procedural", n=0)
    b.label(1.9, label="procedural", n=1)
    b.label(8.3, label="verification", n=0)
    b.label(8.5, label="conceptual", n=0)
    b.label(8.7, label="answer_seeking", n=9)
    return b


def seed_itay() -> Builder:
    b = Builder("itay")
    for window, base in (("cur", 1.0), ("pri", 8.0)):
        comp = f"seed-comp-{window}-i"
        for s in range(3):
            session = f"seed-s-itay-{window}-{s}"
            for i in range(5):
                rapid = i % 2 == 0   # half the answers are blind clicks
                b.answer(base + s * 1.5 + i * 0.01, ok=i == 1, comp=comp,
                         item=f"i{s}", q=f"q{i}", objective="MATH-COORD-1",
                         session=session, effortful=not rapid, gap=45)
        for n in range(4):
            b.idle(base + 0.5 + n * 0.3, n=n)
        # No sustained_effort signals at all — three sessions, zero streaks.
    b.support(1.4, kind="explanation", comp="seed-comp-cur-i", item="i0", q="q3",
              objective="MATH-COORD-1")
    for n in range(3):
        b.label(1.5 + n * 0.1, label="off_topic", n=n)
    b.label(1.9, label="conceptual", n=0)
    b.label(8.4, label="off_topic", n=9)
    b.label(8.6, label="procedural", n=0)
    return b


def seed_dvir() -> Builder:
    b = Builder("dvir")
    comp = "seed-comp-cur-d"
    # Three quiet give-ups: a couple of real tries, no success, then exit.
    for n in range(3):
        session = f"seed-s-dvir-{n}"
        b.answer(1.0 + n + 0.02, ok=False, comp=comp, item=f"i{n}", q=f"q{n}",
                 objective="MATH-COORD-1", session=session)
        b.answer(1.0 + n + 0.01, ok=False, comp=comp, item=f"i{n}", q=f"q{n}",
                 objective="MATH-COORD-1", session=session)
        b.walk_away(1.0 + n, verb="exit", comp=comp, session=session)
    # One objective he wheel-spins on — five tries, no progress. Walking away
    # from THIS one must not count as giving up.
    session = "seed-s-dvir-w"
    for i in range(5):
        b.answer(4.2 - i * 0.02, ok=False, comp=comp, item="iw", q="qw",
                 objective="MATH-FRAC-1", session=session)
    b.walk_away(4.0, verb="skipped", comp=comp, session=session)
    # One lonely success, unassisted — real, but thin.
    b.answer(2.5, ok=True, comp=comp, item="is", q="qs",
             objective="MATH-COORD-1", session="seed-s-dvir-s")
    b.idle(1.5, n=0)
    b.idle(2.8, n=1)
    # No chat at all: no labels, no support rows, no tutor decisions.
    return b


def seed_noam() -> Builder:
    # One answer is all noam has: BOTH dials must say "not enough evidence
    # yet" rather than print a confident number off a single event.
    b = Builder("noam")
    b.answer(2.0, ok=True, comp="seed-comp-cur-n", item="i0", q="q0",
             objective="MATH-COORD-1", session="seed-s-noam-0")
    return b


COLLECTIONS = ("learning_events", "learner_activity", "tutor_decisions", "learner_signals")


async def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--reset", action="store_true",
                        help="remove previously seeded rows and exit")
    args = parser.parse_args()

    handles = {name: _get_collection_named(name) for name in COLLECTIONS}
    if any(handle is None for handle in handles.values()):
        raise SystemExit("no database configured — refusing to seed JSON fallbacks")

    if args.reset:
        for name, handle in handles.items():
            if args.dry_run:
                count = await handle.count_documents({"seed_451": True})
                print(f"would remove {count} from {name}")
            else:
                result = await handle.delete_many({"seed_451": True})
                print(f"removed {result.deleted_count} from {name}")
        return

    builders = [seed_tamar(), seed_moti(), seed_itay(), seed_dvir(), seed_noam()]
    for b in builders:
        rows = {
            "learning_events": b.events,
            "learner_activity": b.activity,
            "tutor_decisions": b.decisions,
            "learner_signals": b.signals,
        }
        summary = ", ".join(f"{len(v)} {k.split('_')[-1]}" for k, v in rows.items())
        print(f"{b.learner}: {summary}")
        if args.dry_run:
            continue
        # Idempotent: clear this learner's previous seed, then insert fresh.
        for name, docs in rows.items():
            await handles[name].delete_many({"seed_451": True, "learner_id": b.learner})
            if docs:
                await handles[name].insert_many(docs)
    print("dry run — nothing written" if args.dry_run else "seeded")


if __name__ == "__main__":
    asyncio.run(main())
