"""The weak-spot finder: one table per (model, effort) from the job rows.

    cd workers && PYTHONPATH=.:../backend game_gen/.venv/bin/python -m game_gen.scripts.games_report --since-hours 168
    … --model claude-sonnet-5 --effort low --kind create --csv > report.csv
    … --md > report.md

Reads ``learner_game_jobs`` through the backend store (``list_all_jobs``) and
prints, per cell: n, pass rate, p50/p95 of every timings stage, cost mean/p95,
judge score means, revision rate, shrink rate, top error classes.
"""
from __future__ import annotations

import argparse
import asyncio
import csv
import statistics
import sys
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable, Optional

HERE = Path(__file__).resolve()
sys.path.insert(0, str(HERE.parents[2]))            # workers/
sys.path.insert(0, str(HERE.parents[3] / "backend"))  # backend/

STAGES = ("queued_s", "wake_s", "session_start_s", "plan_s", "model_s", "validate_s",
          "judge_s", "revise_s", "rejudge_s", "persist_s", "total_s")
SCORES = ("learning_through_play", "fun", "polish", "age_fit")
SHRINK_TOKENS = 30_000


def _parse_ts(value: Any) -> Optional[float]:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    try:
        text = str(value)
        if text.endswith("Z"):
            text = text[:-1] + "+00:00"
        return datetime.fromisoformat(text).timestamp()
    except ValueError:
        return None


def percentile(values: Iterable[float], q: float) -> Optional[float]:
    xs = sorted(v for v in values if v is not None)
    if not xs:
        return None
    k = (len(xs) - 1) * q
    lo, hi = int(k), min(int(k) + 1, len(xs) - 1)
    return xs[lo] + (xs[hi] - xs[lo]) * (k - lo)


def _stage_value(timings: dict[str, Any], stage: str) -> Optional[float]:
    v = (timings or {}).get(stage)
    if isinstance(v, list):
        return float(sum(float(x or 0) for x in v)) if v else None
    return float(v) if isinstance(v, (int, float)) else None


def _is_shrink(job: dict[str, Any]) -> bool:
    for a in job.get("attempts_detail") or []:
        if a.get("reason") == "incomplete" and int(a.get("output_tokens") or 0) >= SHRINK_TOKENS:
            return True
    return False


async def load_jobs(since_hours: float, limit: int = 10000) -> list[dict[str, Any]]:
    from app.services.games import store  # type: ignore

    cutoff = (datetime.now(timezone.utc) - timedelta(hours=since_hours)).timestamp()
    rows = await store.list_all_jobs(limit=limit)
    out = []
    for job in rows:
        ts = _parse_ts(job.get("created_at"))
        if ts is None or ts >= cutoff:
            out.append(job)
    return out


def summarise(jobs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    cells: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for job in jobs:
        if job.get("status") not in ("done", "failed"):
            continue
        model = str(job.get("model") or (job.get("payload") or {}).get("model") or "?")
        effort = str(job.get("reasoning_effort") or (job.get("payload") or {}).get("reasoning_effort") or "?")
        cells[(model, effort)].append(job)
    rows = []
    for (model, effort), items in sorted(cells.items()):
        n = len(items)
        done = [j for j in items if j.get("status") == "done"]
        row: dict[str, Any] = {"model": model, "effort": effort, "n": n, "pass_rate": round(len(done) / n, 3) if n else None}
        for stage in STAGES:
            vals = [_stage_value(j.get("timings") or {}, stage) for j in items]
            vals = [v for v in vals if v is not None]
            row[f"{stage}_p50"] = round(percentile(vals, 0.5), 1) if vals else None
            row[f"{stage}_p95"] = round(percentile(vals, 0.95), 1) if vals else None
        costs = [float((j.get("usage_summary") or {}).get("cost_usd") or 0) for j in items if j.get("usage_summary")]
        row["cost_mean"] = round(statistics.fmean(costs), 4) if costs else None
        row["cost_p95"] = round(percentile(costs, 0.95), 4) if costs else None
        judged = [j.get("judge") for j in items if isinstance(j.get("judge"), dict) and (j["judge"].get("scores") or {})]
        for key in SCORES:
            vals = [float(j["scores"][key]) for j in judged if isinstance(j["scores"].get(key), (int, float))]
            row[f"judge_{key}"] = round(statistics.fmean(vals), 2) if vals else None
        row["revision_rate"] = round(sum(1 for j in judged if j.get("revised")) / len(judged), 3) if judged else None
        row["shrink_rate"] = round(sum(1 for j in items if _is_shrink(j)) / n, 3) if n else None
        classes: Counter[str] = Counter()
        for j in items:
            if j.get("status") == "failed" and j.get("error_class"):
                classes[str(j["error_class"])] += 1
            for a in j.get("attempts_detail") or []:
                for c in a.get("error_classes") or []:
                    classes[str(c)] += 1
        row["top_errors"] = ", ".join(f"{k}×{v}" for k, v in classes.most_common(3)) or "-"
        rows.append(row)
    return rows


def _fmt(v: Any) -> str:
    return "-" if v is None else str(v)


def to_markdown(rows: list[dict[str, Any]]) -> str:
    if not rows:
        return "_no jobs_"
    cols = ["model", "effort", "n", "pass_rate", "total_s_p50", "total_s_p95", "queued_s_p95", "wake_s_p95",
            "plan_s_p50", "model_s_p50", "validate_s_p50", "judge_s_p50", "revise_s_p50", "persist_s_p50",
            "cost_mean", "cost_p95", *[f"judge_{k}" for k in SCORES], "revision_rate", "shrink_rate", "top_errors"]
    head = "| " + " | ".join(cols) + " |\n|" + "---|" * len(cols) + "\n"
    body = "".join("| " + " | ".join(_fmt(r.get(c)) for c in cols) + " |\n" for r in rows)
    return head + body


def to_csv(rows: list[dict[str, Any]]) -> str:
    if not rows:
        return ""
    import io
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=list(rows[0].keys()))
    writer.writeheader()
    writer.writerows(rows)
    return buf.getvalue()


async def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--since-hours", type=float, default=168)
    ap.add_argument("--model", default=None)
    ap.add_argument("--effort", default=None)
    ap.add_argument("--kind", default=None, choices=[None, "create", "edit", "fix"])
    ap.add_argument("--csv", action="store_true")
    ap.add_argument("--md", action="store_true")
    ap.add_argument("--limit", type=int, default=10000)
    args = ap.parse_args()

    jobs = await load_jobs(args.since_hours, args.limit)
    if args.model:
        jobs = [j for j in jobs if str(j.get("model") or (j.get("payload") or {}).get("model") or "") == args.model]
    if args.effort:
        jobs = [j for j in jobs if str(j.get("reasoning_effort") or (j.get("payload") or {}).get("reasoning_effort") or "") == args.effort]
    if args.kind:
        jobs = [j for j in jobs if j.get("kind") == args.kind]
    rows = summarise(jobs)
    if args.csv:
        sys.stdout.write(to_csv(rows))
    else:
        print(f"{len(jobs)} job(s) in the last {args.since_hours:g} h\n")
        print(to_markdown(rows))


if __name__ == "__main__":
    asyncio.run(main())
