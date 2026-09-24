"""Which lomdot the nightly browses, in what order — and what it remembers.

Pure: no network, no browser, no clock (``today`` is passed in), so the queue
discipline is unit-tested (tests/test_content_pipeline.py). The pipeline
(content_pipeline.py) calls ``plan_browse`` once per run and
``record_attempt`` once per browse, and writes ``browse_state`` into
``content/context/index.json`` next to the old flat ``backlog``.

Why this exists. The old queue was ``backlog + new + changed + recapture``
cut at ``--max-browse``. When every launch failed (2026-09-17 → 09-24, a Kata
id change), the same ten failures were re-queued to the FRONT every night and
101 of 143 lomdot were never browsed at all. Here:

- classes run in priority order — forced, new, changed, queued (left over
  from an earlier night), recapture, retry, coverage (never browsed), stale
  (oldest capture first);
- a failure backs off exponentially (1, 2, 4, 8, 16 nights; capped at
  ``MAX_BACKOFF_DAYS``), so a lomda that keeps failing stops spending the
  budget of the ones that would succeed;
- the retry and recapture classes are capped, so they can never fill a night;
- within a class providers take turns (round-robin), so one vendor's outage
  cannot starve the others;
- ``ProviderBreaker`` stops launching a provider after consecutive launch
  failures in ONE run — the rest of its queue waits without penalty.
"""

from __future__ import annotations

from collections import OrderedDict
from datetime import date, timedelta
from typing import Any, Iterable, Optional

#: Verdicts that mean "the browse itself failed" — the lomda backs off.
FAILURE_VERDICTS = frozenset({
    "driver_error", "timeout", "frame_blocked", "launch_rejected",
    "launch_unavailable", "launch_404",
})
#: Failures that say the provider (not this lomda) is down — they trip the
#: per-run breaker.
PROVIDER_FAILURES = frozenset({"launch_unavailable", "launch_rejected", "launch_404"})
MAX_BACKOFF_DAYS = 16
#: A capture older than this is worth refreshing when nothing else is queued.
STALE_AFTER_DAYS = 30

CLASS_ORDER = ("forced", "new", "changed", "queued", "recapture", "retry", "coverage", "stale")
#: Classes whose leftovers are carried as backlog. The others re-derive every
#: night (from browse_state or the shards), so carrying them would only let a
#: capped class jump the queue as "queued".
CARRIED = frozenset({"forced", "new", "changed", "queued"})


def _day(value: Any) -> Optional[date]:
    try:
        return date.fromisoformat(str(value or "")[:10])
    except ValueError:
        return None


def backoff_days(attempts: int) -> int:
    """1, 2, 4, 8, 16, 16… nights after the 1st, 2nd, 3rd… failure in a row."""
    return min(MAX_BACKOFF_DAYS, 2 ** max(0, attempts - 1))


def record_attempt(
    state: dict[str, dict[str, Any]], cid: str, verdict: str, today: date,
) -> None:
    """Fold one browse outcome into ``state`` (mutated in place).

    Only day-granular fields are stored: the state is committed with the
    shards, and a timestamp that moves every night would be a diff every
    night. A success clears the failure streak."""
    entry = dict(state.get(cid) or {})
    entry["verdict"] = verdict
    entry["last_attempt"] = today.isoformat()
    if verdict in FAILURE_VERDICTS:
        entry["failures"] = int(entry.get("failures") or 0) + 1
        entry["next_after"] = (today + timedelta(days=backoff_days(entry["failures"]))).isoformat()
    else:
        entry.pop("failures", None)
        entry.pop("next_after", None)
    state[cid] = entry


def prune_state(state: dict[str, dict[str, Any]], live: Iterable[str]) -> dict[str, dict[str, Any]]:
    """Drop entries for lomdot that left the catalog; sorted for a stable file."""
    live = set(live)
    return {cid: state[cid] for cid in sorted(state) if cid in live}


def _due(entry: Optional[dict[str, Any]], today: date) -> bool:
    after = _day((entry or {}).get("next_after"))
    return after is None or after <= today


def _round_robin(cids: list[str], provider_of: dict[str, str]) -> list[str]:
    """Interleave providers, each keeping its own order."""
    lanes: "OrderedDict[str, list[str]]" = OrderedDict()
    for cid in cids:
        lanes.setdefault(provider_of.get(cid) or "", []).append(cid)
    out: list[str] = []
    while any(lanes.values()):
        for lane in lanes.values():
            if lane:
                out.append(lane.pop(0))
    return out


def plan_browse(
    *,
    live: dict[str, dict[str, Any]],
    committed: dict[str, dict[str, Any]],
    diff: dict[str, list[str]],
    recapture: Iterable[str],
    state: dict[str, dict[str, Any]],
    today: date,
    budget: int,
    scope: Optional[set[str]] = None,
    forced: Iterable[str] = (),
    queued: Iterable[str] = (),
) -> dict[str, Any]:
    """Tonight's browse list and the reason each lomda is on it.

    ``live``: component id → {"provider": …} for the whole catalog.
    ``committed``: component id → committed lomda (for its extraction record).
    ``queued``: the index's ``backlog.browse`` — work an earlier night could
    not fit (a new lomda already written as not_attempted is no longer "new").

    Returns {"browse": [cid…], "reasons": {cid: class}, "waiting": [cid…],
    "backed_off": [cid…]}. ``waiting`` is everything eligible that did not fit;
    it becomes the index's ``backlog.browse`` (what the PR summary counts).
    """
    scope = set(live) if scope is None else set(scope) & set(live)
    provider_of = {cid: str((row or {}).get("provider") or "") for cid, row in live.items()}
    forced = [cid for cid in forced if cid in live]
    classes: dict[str, list[str]] = {name: [] for name in CLASS_ORDER}
    classes["forced"] = forced
    classes["new"] = sorted(c for c in diff.get("new") or [] if c in scope)
    classes["changed"] = sorted(c for c in diff.get("changed") or [] if c in scope)
    classes["queued"] = [c for c in dict.fromkeys(queued) if c in scope]
    classes["recapture"] = sorted(c for c in recapture if c in scope)

    retry = {cid for cid, entry in state.items()
             if entry.get("verdict") in FAILURE_VERDICTS}
    # Oldest attempt first, so a long-waiting failure is not stuck behind a
    # fresh one forever.
    classes["retry"] = sorted(
        (c for c in retry if c in scope),
        key=lambda c: ((state.get(c) or {}).get("last_attempt") or "", c))

    def _extraction(cid: str) -> dict[str, Any]:
        return (committed.get(cid) or {}).get("extraction") or {}

    never = [c for c in sorted(scope)
             if not _extraction(c).get("probed_at") and c not in state]
    classes["coverage"] = never
    stale_before = (today - timedelta(days=STALE_AFTER_DAYS)).isoformat()
    classes["stale"] = sorted(
        (c for c in scope
         if _extraction(c).get("probed_at")
         and str(_extraction(c)["probed_at"])[:10] < stale_before),
        key=lambda c: (str(_extraction(c)["probed_at"]), c))

    caps = {"retry": max(2, budget // 4), "recapture": max(2, budget // 2)}
    chosen: list[str] = []
    reasons: dict[str, str] = {}
    backed_off: list[str] = []
    waiting: list[str] = []
    for name in CLASS_ORDER:
        taken = 0
        for cid in _round_robin(classes[name], provider_of):
            if cid in reasons or cid in waiting or cid in backed_off:
                continue
            if name != "forced" and not _due(state.get(cid), today):
                backed_off.append(cid)
                continue
            if len(chosen) >= budget or (name in caps and taken >= caps[name]):
                if name in CARRIED:
                    waiting.append(cid)
                continue
            chosen.append(cid)
            reasons[cid] = name
            taken += 1
    return {"browse": chosen, "reasons": reasons,
            "waiting": sorted(set(waiting)), "backed_off": sorted(set(backed_off))}


class ProviderBreaker:
    """Per-run: after ``threshold`` provider-level failures in a row from one
    provider, stop launching its lomdot. They are skipped WITHOUT a recorded
    attempt, so tomorrow they are due again at their old place."""

    def __init__(self, threshold: int = 3) -> None:
        self.threshold = threshold
        self._streak: dict[str, int] = {}

    def open(self, provider: str) -> bool:
        return self._streak.get(provider, 0) >= self.threshold

    def record(self, provider: str, verdict: str) -> None:
        if verdict in PROVIDER_FAILURES:
            self._streak[provider] = self._streak.get(provider, 0) + 1
        else:
            self._streak[provider] = 0
