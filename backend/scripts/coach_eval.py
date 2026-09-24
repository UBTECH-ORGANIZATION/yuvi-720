#!/usr/bin/env python3
"""Coach eval: real coach, real screens, natural questions — baseline vs candidate.

    python scripts/coach_eval.py --quick                      # ~1 USD
    python scripts/coach_eval.py --variants baseline,candidate,candidate_tag --judge
    python scripts/coach_eval.py --config-dir /path/to/shards  # e.g. v8 captures

Runs every scenario of evals/coach/scenarios.json on every matching screen of
evals/coach/screens.json, once per flag variant (evals/coach/harness.VARIANTS),
through the real ``run_coach_stream`` in a sandbox: synthetic learners, no
database, no LRS, no persistence (harness.sandbox). Reports, per variant:

- **hard gates** (must be 0): crashes, empty replies, visible tags, wrong
  language, the correct answer in a reply, a single option marked when it
  must not be;
- **marks**: coverage, accuracy against the scenario's expectation, the mark
  committed before the first word;
- **cost**: model calls, planning calls, tokens and USD per operation;
  latency to the first word (p50/p95);
- with ``--judge``: a pairwise preference (strong model, both orders — a
  verdict counts only when the two orders agree).

Writes ``backend/artifacts/coach-eval/<stamp>/`` (gitignored): results.json
(reply text only with ``--include-text``) and report.md. Exit 1 when a
candidate variant fails a hard gate.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import statistics
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from evals.coach import harness  # noqa: E402  (no app import at module level)

harness.sandbox_env()

from app.core.env import ensure_env_loaded  # noqa: E402

ensure_env_loaded()


def _persona_for(scenario: dict, index: int, quick: bool) -> str:
    lang = scenario.get("lang")
    if lang in ("ar", "en"):
        return lang
    return "he_f" if quick else ("he_f", "he_m", "he_x")[index % 3]


def plan_turns(screens, scenarios, *, quick: bool, only_screens: set[str]) -> list[tuple]:
    turns = []
    for s_index, scenario in enumerate(scenarios):
        if quick and not scenario.get("quick"):
            continue
        matching = [sc for sc in screens
                    if set(sc["tags"]) & set(scenario["on"])
                    and (not only_screens or sc["id"] in only_screens)]
        if quick:
            matching = matching[:2]
        for sc_index, screen in enumerate(matching):
            turns.append((screen, scenario, _persona_for(scenario, s_index + sc_index, quick)))
    return turns


async def run_variant(variant: str, turns, facts, concurrency: int,
                      turn_timeout: float = 120.0) -> list[dict]:
    for key, value in harness.VARIANTS[variant].items():
        os.environ[key] = value
    gate = asyncio.Semaphore(concurrency)

    async def one(screen, scenario, persona):
        async with gate:
            try:
                turn = await asyncio.wait_for(
                    harness.run_turn(screen, facts[screen["id"]], scenario, persona, variant),
                    timeout=turn_timeout)
            except asyncio.TimeoutError:
                # A hung stream is a finding (it counts as a crash), never a
                # stalled run: the other turns and the report still land.
                turn = {"screen": screen["id"], "scenario": scenario["id"], "persona": persona,
                        "variant": variant, "lang": scenario.get("lang") or harness.PERSONAS[persona]["lang"],
                        "kind": scenario["kind"], "text": "", "mark": None, "mark_before_text": False,
                        "teacher": False, "flags": [], "diagnostics": {}, "trace": [], "calls": [],
                        "first_text_ms": None, "total_ms": int(turn_timeout * 1000),
                        "error": f"timeout after {turn_timeout:.0f}s"}
            turn["check"] = harness.check_turn(turn, scenario, facts[screen["id"]], variant)
            turn["cost_usd"] = harness.turn_cost(turn)
            status = "✗ " + ",".join(turn["check"]["hard"]) if turn["check"]["hard"] else "✓"
            mark = (turn["mark"] or {}).get("kind", "—")
            print(f"  [{variant}] {scenario['id']:28} {screen['id']:24} {persona:5} "
                  f"mark={mark:8} {turn['first_text_ms'] or 0:>6}ms {status}")
            return turn

    with harness.sandbox():
        return list(await asyncio.gather(*(one(*t) for t in turns)))


def _pct(values: list[int], share: float):
    if not values:
        return None
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, round(share * (len(ordered) - 1)))]


def summarize(turns: list[dict]) -> dict[str, Any]:
    hard = Counter(h for t in turns for h in t["check"]["hard"])
    marked = [t for t in turns if "mark_ok" in t["check"]["soft"]]
    by_op: dict[str, dict[str, float]] = defaultdict(lambda: {"calls": 0, "input": 0, "cached": 0, "output": 0})
    for t in turns:
        for c in t["calls"]:
            op = str(c["operation"] or "—")
            row = by_op[op]
            row["calls"] += 1
            row["input"] += int(c["input_tokens"] or 0)
            row["cached"] += int(c["cached_input_tokens"] or 0)
            row["output"] += int(c["output_tokens"] or 0)
    first = [t["first_text_ms"] for t in turns if t["first_text_ms"] is not None]
    return {
        "turns": len(turns),
        "hard_failures": dict(hard),
        "hard_total": sum(hard.values()),
        "mark_turns": len(marked),
        "mark_accuracy": round(sum(1 for t in marked if t["check"]["soft"]["mark_ok"]) / len(marked), 3) if marked else None,
        "marked_share": round(sum(1 for t in turns if t["mark"]) / len(turns), 3) if turns else 0,
        "mark_before_text": round(sum(1 for t in marked if t["check"]["soft"].get("mark_before_text")) / len(marked), 3) if marked else None,
        "model_calls": sum(len(t["calls"]) for t in turns),
        "planning_calls": sum(t["check"]["soft"]["planning_calls"] for t in turns),
        "input_tokens": sum(int(c["input_tokens"] or 0) for t in turns for c in t["calls"]),
        "output_tokens": sum(int(c["output_tokens"] or 0) for t in turns for c in t["calls"]),
        "usd": round(sum(t["cost_usd"] for t in turns), 4),
        "first_text_p50_ms": _pct(first, 0.5),
        "first_text_p95_ms": _pct(first, 0.95),
        "by_operation": dict(sorted(by_op.items())),
        "teacher_unlocks": sum(1 for t in turns if t["teacher"]),
        # The model's hidden tag (candidate_tag): ok / none / absent / unknown / malformed.
        "tag_outcomes": dict(Counter(t["diagnostics"]["focus_tag"] for t in turns
                                     if "focus_tag" in t["diagnostics"])),
    }


_JUDGE = """You compare two replies of "Yuvi", an AI learning companion for middle-school students, to the same learner turn on the same lesson screen.
Better = more helpful for learning right now, correct, warm and concise, in the learner's language, and NEVER giving away the answer to the question.

Screen question: {question}
Learner turn: {turn}

Reply A:
{a}

Reply B:
{b}

Answer with exactly one word: A, B, or TIE."""


async def judge(pairs: list[tuple[dict, dict, dict]]) -> dict[str, int]:
    from app.services.ai_usage import UsageContext
    from app.services.llm import call_llm

    usage = UsageContext(actor_id="coach-eval", actor_type="system", endpoint="script:coach_eval",
                         feature="platform_operations", operation="eval.judge", source="coach_eval")
    tally = Counter()

    async def verdict(question, turn, a, b):
        raw = await call_llm([{"role": "user", "content": _JUDGE.format(
            question=question or "—", turn=turn, a=a or "(empty)", b=b or "(empty)")}],
            usage_context=usage, max_tokens=8, model_tier="strong")
        return str(raw or "").strip().upper()[:3]

    gate = asyncio.Semaphore(6)

    async def one(base, cand, facts):
        async with gate:
            turn = base["scenario"]
            first = await verdict(facts.get("question_text"), turn, base["text"], cand["text"])
            second = await verdict(facts.get("question_text"), turn, cand["text"], base["text"])
        if first.startswith("B") and second.startswith("A"):
            tally["candidate"] += 1
        elif first.startswith("A") and second.startswith("B"):
            tally["baseline"] += 1
        else:
            tally["tie_or_disagree"] += 1

    await asyncio.gather(*(one(*pair) for pair in pairs))
    return dict(tally)


def render(summaries: dict[str, dict], judged: dict[str, dict], stamp: str) -> str:
    rows = [("turns", "turns"), ("hard failures", "hard_total"), ("marked share", "marked_share"),
            ("mark accuracy", "mark_accuracy"), ("mark before text", "mark_before_text"),
            ("model calls", "model_calls"), ("planning calls", "planning_calls"),
            ("input tokens", "input_tokens"), ("output tokens", "output_tokens"), ("USD", "usd"),
            ("first text p50 ms", "first_text_p50_ms"), ("first text p95 ms", "first_text_p95_ms"),
            ("teacher unlocks", "teacher_unlocks"), ("tag outcomes", "tag_outcomes")]
    names = list(summaries)
    lines = [f"# Coach eval {stamp}", "", "| | " + " | ".join(names) + " |",
             "|---|" + "---:|" * len(names)]
    for label, key in rows:
        lines.append(f"| {label} | " + " | ".join(str(summaries[n].get(key)) for n in names) + " |")
    for name in names:
        if summaries[name]["hard_failures"]:
            lines.append(f"\n**{name} hard failures:** {summaries[name]['hard_failures']}")
    for name, tally in judged.items():
        lines.append(f"\n**Judge baseline vs {name}:** {tally}")
    for name in names:
        lines += ["", f"## {name} — tokens by operation", "", "| operation | calls | input | cached | output |",
                  "|---|---:|---:|---:|---:|"]
        for op, r in summaries[name]["by_operation"].items():
            lines.append(f"| {op} | {r['calls']} | {r['input']} | {r['cached']} | {r['output']} |")
    return "\n".join(lines) + "\n"


async def main_async(args) -> int:
    if args.config_dir:
        os.environ["CONTENT_INTEL_CONFIG_PATH"] = args.config_dir
    screens, scenarios = harness.load_fixtures()
    only = set(filter(None, (args.screens or "").split(",")))
    facts = {}
    for screen in screens:
        facts[screen["id"]] = await harness.screen_facts(screen)
        from app.services import kata_catalog
        rows = kata_catalog.questions_for_item(screen["component_id"], screen["item_id"]) or []
        facts[screen["id"]]["question_text"] = str((rows[0] if rows else {}).get("questionText") or "")[:400]
    turns = plan_turns(screens, scenarios, quick=args.quick, only_screens=only)
    variants = [v.strip() for v in args.variants.split(",") if v.strip()]
    print(f"→ {len(turns)} turns × {len(variants)} variants")
    results: dict[str, list[dict]] = {}
    out = Path(args.out or ROOT / "artifacts" / "coach-eval"
               / datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ"))
    out.mkdir(parents=True, exist_ok=True)
    for variant in variants:
        results[variant] = await run_variant(variant, turns, facts, args.concurrency, args.turn_timeout)
        # Saved as each variant lands: a later failure never loses the earlier ones.
        (out / f"partial-{variant}.json").write_text(
            json.dumps(results[variant], ensure_ascii=False, default=str), encoding="utf-8")
    summaries = {v: summarize(r) for v, r in results.items()}
    judged: dict[str, dict] = {}
    if args.judge and "baseline" in results:
        base = {(t["screen"], t["scenario"], t["persona"]): t for t in results["baseline"]}
        screen_by_id = {s["id"]: s for s in screens}
        for variant in variants:
            if variant == "baseline":
                continue
            pairs = [(base[k], t, facts[t["screen"]]) for t in results[variant]
                     if (k := (t["screen"], t["scenario"], t["persona"])) in base]
            scen = {s["id"]: s for s in scenarios}
            for b, c, _ in pairs:
                s = scen[b["scenario"]]
                b["scenario"] = s.get("message") or s.get("trigger") or s.get("support")
            judged[variant] = await judge(pairs)
            for b, _, _ in pairs:
                b["scenario"] = next(k[1] for k in base if base[k] is b)
    stamp = out.name
    if not args.include_text:
        for turns_ in results.values():
            for t in turns_:
                t["text"] = f"<{len(t['text'])} chars>"
    (out / "results.json").write_text(json.dumps(
        {"summaries": summaries, "judge": judged, "turns": results},
        ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    report = render(summaries, judged, stamp)
    (out / "report.md").write_text(report, encoding="utf-8")
    print("\n" + report)
    print(f"→ {out}")
    failed = any(summaries[v]["hard_total"] for v in variants if v != "baseline")
    return 1 if failed else 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--variants", default="baseline,candidate")
    parser.add_argument("--quick", action="store_true")
    parser.add_argument("--judge", action="store_true")
    parser.add_argument("--screens", help="comma-separated screen ids to restrict to")
    parser.add_argument("--concurrency", type=int, default=4)
    parser.add_argument("--turn-timeout", type=float, default=120.0,
                        help="seconds before a hung turn is recorded as a crash")
    parser.add_argument("--config-dir", help="content shards to serve instead of content/context")
    parser.add_argument("--include-text", action="store_true",
                        help="keep reply texts in results.json (local review only)")
    parser.add_argument("--out")
    return asyncio.run(main_async(parser.parse_args()))


if __name__ == "__main__":
    raise SystemExit(main())
