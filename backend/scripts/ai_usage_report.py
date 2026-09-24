#!/usr/bin/env python3
"""Read-only AI token/cost report — where the money goes, and before vs after.

    # the last 14 days on the dev cluster, by operation
    python scripts/ai_usage_report.py --since 14d

    # did a change pay off? two windows, normalized per day
    python scripts/ai_usage_report.py --before 2026-09-10..2026-09-24 \\
        --after 2026-09-25..2026-10-02 --exclude-actor gal,moti

    # an eval sandbox's usage file (see scripts/coach_eval.py)
    python scripts/ai_usage_report.py --source json:artifacts/coach-eval/<run>/ai_usage_events.json

Mongo is read with a projection of metering fields only — the events carry no
prompts or replies, and this script asks for nothing else. The arithmetic
lives in ``app.services.ai_usage_rollup`` (tested).
"""

from __future__ import annotations

import argparse
import asyncio
import json
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.env import ensure_env_loaded  # noqa: E402

ensure_env_loaded()

from app.services import ai_usage_rollup as rollup  # noqa: E402

_FIELDS = {
    "_id": 0, "started_at": 1, "actor_id": 1, "endpoint": 1, "feature": 1,
    "operation": 1, "source": 1, "deployment": 1, "meter": 1, "status": 1,
    "input_tokens": 1, "cached_input_tokens": 1, "output_tokens": 1,
    "reasoning_tokens": 1, "cost_usd": 1, "latency_ms": 1, "finish_reason": 1,
    "exchange_id": 1, "session_id": 1,
}


def _when(text: str) -> datetime:
    """`14d` (days ago), `36h`, or an ISO date/datetime (UTC)."""
    match = re.fullmatch(r"(\d+)([dh])", text.strip())
    if match:
        amount = int(match.group(1))
        delta = timedelta(days=amount) if match.group(2) == "d" else timedelta(hours=amount)
        return datetime.now(timezone.utc) - delta
    parsed = datetime.fromisoformat(text.strip())
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _window(text: str) -> tuple[datetime, datetime]:
    start, _, end = text.partition("..")
    return _when(start), (_when(end) if end else datetime.now(timezone.utc))


async def _mongo_events(start: datetime, end: datetime, prefix: str) -> list[dict[str, Any]]:
    import os

    from motor.motor_asyncio import AsyncIOMotorClient

    uri = os.environ.get("MONGODB_CONNECTION_STRING") or ""
    if not uri:
        raise SystemExit("MONGODB_CONNECTION_STRING is not set")
    database = AsyncIOMotorClient(uri, serverSelectionTimeoutMS=20000)[
        os.environ.get("MONGODB_DATABASE") or "yuvi720"]
    query: dict[str, Any] = {"started_at": {"$gte": start.replace(tzinfo=None),
                                            "$lt": end.replace(tzinfo=None)}}
    if prefix:
        query["operation"] = {"$regex": f"^{re.escape(prefix)}"}
    return await database.ai_usage_events.find(query, _FIELDS).to_list(None)


def _json_events(path: str, start: Optional[datetime], end: Optional[datetime],
                 prefix: str) -> list[dict[str, Any]]:
    rows = json.loads(Path(path).read_text(encoding="utf-8"))
    rows = rows.get("events", rows) if isinstance(rows, dict) else rows
    out = []
    for row in rows:
        if prefix and not str(row.get("operation") or "").startswith(prefix):
            continue
        stamp = row.get("started_at")
        if stamp and (start or end):
            moment = _when(str(stamp)) if isinstance(stamp, str) else stamp
            if (start and moment < start) or (end and moment >= end):
                continue
        out.append(row)
    return out


async def _load(args, window: tuple[datetime, datetime]) -> list[dict[str, Any]]:
    if args.source.startswith("json:"):
        events = _json_events(args.source[5:], *window, args.operation_prefix)
    else:
        events = await _mongo_events(*window, args.operation_prefix)
    excluded = {a.strip() for a in (args.exclude_actor or "").split(",") if a.strip()}
    return [e for e in events if str(e.get("actor_id") or "") not in excluded
            and (not args.exchange_prefix
                 or str(e.get("exchange_id") or "").startswith(args.exchange_prefix))]


def _print_rollup(rows: list[dict[str, Any]], limit: int) -> None:
    print(f"{'group':52} {'calls':>6} {'avg_in':>7} {'cache%':>6} {'avg_out':>7} "
          f"{'reason':>6} {'p50ms':>6} {'cost$':>9} {'share':>6}")
    for row in rows[:limit]:
        print(f"{row['key'][:52]:52} {row['calls']:>6} {row['avg_input']:>7} "
              f"{100 * row['cached_share']:>5.0f}% {row['avg_output']:>7} "
              f"{row['reasoning']:>6} {str(row['p50_ms'] or '—'):>6} "
              f"{row['cost']:>9.4f} {100 * row['share']:>5.1f}%"
              + ("  ~" if row["estimated"] else ""))
    total = sum(r["cost"] for r in rows)
    print(f"{'TOTAL':52} {sum(r['calls'] for r in rows):>6} {'':>7} {'':>6} {'':>7} "
          f"{'':>6} {'':>6} {total:>9.4f}   (~ = priced from the static table)")


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--source", default="mongo", help="mongo | json:<path>")
    parser.add_argument("--since", default="30d")
    parser.add_argument("--until", default="")
    parser.add_argument("--before", help="START..END — compare mode")
    parser.add_argument("--after", help="START..END — compare mode")
    parser.add_argument("--group-by", default="operation",
                        help="comma list of event fields, e.g. operation,deployment")
    parser.add_argument("--operation-prefix", default="")
    parser.add_argument("--exchange-prefix", default="")
    parser.add_argument("--exclude-actor", default="")
    parser.add_argument("--limit", type=int, default=40)
    parser.add_argument("--exchanges", action="store_true",
                        help="per-turn view: calls and planning rounds per exchange")
    parser.add_argument("--json", action="store_true", help="machine-readable output")
    args = parser.parse_args()
    group_by = tuple(f.strip() for f in args.group_by.split(",") if f.strip())

    if args.before and args.after:
        before_window, after_window = _window(args.before), _window(args.after)
        before = rollup.rollup(await _load(args, before_window), group_by)
        after = rollup.rollup(await _load(args, after_window), group_by)
        days = lambda w: max((w[1] - w[0]).total_seconds() / 86400, 1e-9)  # noqa: E731
        rows = rollup.compare(before, after, before_days=days(before_window),
                              after_days=days(after_window))
        if args.json:
            print(json.dumps(rows, ensure_ascii=False, indent=2, default=str))
            return 0
        print(f"{'group':52} {'calls/day':>17} {'avg_in':>13} {'$/day':>21} {'Δ$/day':>10}")
        for row in rows[:args.limit]:
            print(f"{row['key'][:52]:52} {str(row['calls_per_day']):>17} "
                  f"{str(row['avg_input']):>13} {str(row['cost_per_day']):>21} "
                  f"{row['delta_cost_per_day']:>10.4f}")
        print(f"TOTAL Δ$/day {sum(r['delta_cost_per_day'] for r in rows):.4f}")
        return 0

    window = (_when(args.since), _when(args.until) if args.until else datetime.now(timezone.utc))
    events = await _load(args, window)
    if args.exchanges:
        turns = rollup.per_exchange(events)
        planning = sum(t["planning_calls"] for t in turns.values())
        print(f"{len(turns)} turns · {sum(t['calls'] for t in turns.values())} calls · "
              f"{planning} planning rounds · "
              f"${sum(t['cost'] for t in turns.values()):.4f}")
        return 0
    rows = rollup.rollup(events, group_by)
    if args.json:
        print(json.dumps(rows, ensure_ascii=False, indent=2, default=str))
    else:
        _print_rollup(rows, args.limit)
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
