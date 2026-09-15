"""Spike runner: build sample learning games end to end on the laptop and report.

    cd workers && game_gen/.venv/bin/python -m game_gen.spike --genre shooter --component 0
    cd workers && game_gen/.venv/bin/python -m game_gen.spike --matrix   # 5 runs across genres/components

Writes one folder per run under workers/game_gen/runs/<stamp>-<genre>-<idx>/ with
game.html (validated, without harness), served.html (with harness — open it in a
browser), thumb.png, result.json and events.log, and appends a row to runs/report.md.

Fixture rows (`fixtures/sample_components.json`, written by scripts/dump_fixture.py)
are ContextPack dicts; the old {component, unit, objective} shape is converted.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import time
import uuid
from dataclasses import fields
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .context_pack import ContextPack, build_context_pack
from .harness import build_harness, inject_harness
from .pipeline import JobResult, JobSpec, run_job

ROOT = Path(__file__).parent
FIXTURE = ROOT / "fixtures" / "sample_components.json"
RUNS = ROOT / "runs"

MATRIX = [
    ("shooter", 0, "משחק יריות בחלל, מהיר וצבעוני"),
    ("runner", 2, "רץ אינסופי עם קפיצות"),
    ("platformer", 1, "פלטפורמר עם דלתות נעולות"),
    ("boss", 0, "קרב בוס אפי"),
    ("puzzle", 2, "פאזל התאמה רגוע"),
]

_PACK_FIELDS = {f.name for f in fields(ContextPack)}


def pack_from_row(row: dict[str, Any], *, language: str = "he", device: str = "keyboard") -> ContextPack:
    """A fixture row is a ContextPack dict; a legacy {component, unit, objective} row is converted."""
    if "component_id" in row:
        pack = ContextPack(**{k: v for k, v in row.items() if k in _PACK_FIELDS})
        pack.language, pack.device = language, device
        return pack
    return build_context_pack(row, language=language, device=device)


def load_fixture_pack(path: str | Path = FIXTURE, index: int = 0, **kwargs: Any) -> ContextPack:
    with open(path, encoding="utf-8") as fh:
        rows = json.load(fh)
    return pack_from_row(rows[index], **kwargs)


def _event_line(t0: float, ev: dict[str, Any]) -> str:
    slim = {k: (str(v)[:120] if k in ("text", "html") else v) for k, v in ev.items()}
    return json.dumps({"t": round(time.perf_counter() - t0, 1), **slim}, ensure_ascii=False)


async def run_one(genre: str, component_idx: int, vibe: str, *, model: str, effort: str, judge: bool,
                  credits: float | None, plan: bool = True, inspirations: list[str] | None = None,
                  pack: ContextPack | None = None, tag: str = "") -> tuple[dict[str, Any], JobResult, ContextPack]:
    pack = pack or load_fixture_pack(FIXTURE, component_idx, language="he", device="keyboard")
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    out = RUNS / f"{stamp}-{tag + '-' if tag else ''}{genre}-c{component_idx}"
    out.mkdir(parents=True, exist_ok=True)
    events = (out / "events.log").open("w", encoding="utf-8")
    t0 = time.perf_counter()

    def progress(ev: dict[str, Any]) -> None:
        line = _event_line(t0, ev)
        events.write(line + "\n")
        events.flush()
        if ev.get("type") in {"build", "validate", "validated", "judge", "plan", "revise", "error", "usage"}:
            print(f"  [{round(time.perf_counter() - t0):4d}s] {line[:160]}")

    spec = JobSpec(
        job_id=f"spike-{uuid.uuid4().hex[:8]}",
        game_id=f"spike-game-{component_idx}",
        learner_id="spike",
        kind="create",
        pack=pack,
        genre=genre,
        vibe=vibe,
        inspirations=list(inspirations or []),
        model=model,
        reasoning_effort=effort,
        judge=judge,
        plan=plan,
        max_ai_credits=credits,
    )
    print(f"▶ {genre} on '{pack.component_title}' [{model}/{effort}{'' if plan else ', no plan'}] → {out.name}")
    result = await run_job(spec, progress)
    events.close()

    if result.html:
        (out / "game.html").write_text(result.html, encoding="utf-8")
        served = inject_harness(result.html, build_harness(pack.to_learn_data(), nonce="preview"))
        (out / "served.html").write_text(served, encoding="utf-8")
    if result.screenshot_png:
        (out / "thumb.png").write_bytes(result.screenshot_png)

    scores = (result.judge or {}).get("scores") or {}
    row = {
        "run": out.name,
        "genre": genre,
        "component": pack.component_title,
        "model": result.model,
        "effort": effort,
        "plan": plan,
        "ok": result.ok,
        "error": result.error,
        "title": result.title,
        "attempts": [a.as_detail() for a in result.attempts],
        "usage": result.usage.as_dict(),
        "judge": result.judge,
        "timings": result.timings,
        "elapsed_s": round(result.elapsed_s, 1),
        "html_bytes": len(result.html or ""),
    }
    (out / "result.json").write_text(json.dumps(row, ensure_ascii=False, indent=1), encoding="utf-8")
    u = row["usage"]
    judge_cell = "/".join(str(int(scores[k])) for k in ("learning_through_play", "fun", "polish", "age_fit") if k in scores) or "-"
    if (result.judge or {}).get("revised"):
        judge_cell += "*"
    line = (f"| {out.name} | {genre} | {model}/{effort} | {'✅' if result.ok else '❌ ' + str(result.error)[:40]} | {len(result.attempts)} | "
            f"{u['input_tokens']:,} | {u['output_tokens']:,} | {u['cache_read_tokens']:,} | ${u['cost_usd']:.3f} | {row['elapsed_s']}s | "
            f"{judge_cell} |")
    report = RUNS / "report.md"
    if not report.exists():
        report.write_text("| run | genre | model | ok | attempts | in | out | cache | cost | time | judge L/F/P/A |\n|---|---|---|---|---|---|---|---|---|---|---|\n", encoding="utf-8")
    report.open("a", encoding="utf-8").write(line + "\n")
    print(line)
    return row, result, pack


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--genre", default="shooter")
    ap.add_argument("--component", type=int, default=0)
    ap.add_argument("--vibe", default="")
    ap.add_argument("--n", type=int, default=1)
    ap.add_argument("--matrix", action="store_true")
    ap.add_argument("--model", default="claude-opus-5")
    ap.add_argument("--effort", default="low")
    ap.add_argument("--no-judge", action="store_true")
    ap.add_argument("--no-plan", action="store_true")
    ap.add_argument("--credits", type=float, default=None, help="max AI credits per build session")
    ap.add_argument("-v", action="store_true")
    args = ap.parse_args()
    logging.basicConfig(level=logging.DEBUG if args.v else logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    RUNS.mkdir(exist_ok=True)
    plan = MATRIX if args.matrix else [(args.genre, args.component, args.vibe)] * args.n
    for genre, idx, vibe in plan:
        await run_one(genre, idx, vibe, model=args.model, effort=args.effort, judge=not args.no_judge,
                      credits=args.credits, plan=not args.no_plan)


if __name__ == "__main__":
    asyncio.run(main())
