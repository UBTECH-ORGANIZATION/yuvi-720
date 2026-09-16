"""Bake-off: the same components and briefs across models and efforts.

    cd workers && PYTHONPATH=.:../backend game_gen/.venv/bin/python -m game_gen.scripts.bakeoff \\
        --models claude-sonnet-5,gpt-5.6-sol,claude-opus-4.8,claude-opus-5 --efforts low,medium \\
        --components 0,1,2 --briefs shooter,open --mode queue --learner <learner_id> --dry-run

`queue` mode (preferred): one game row per cell (`store.create_game(..., model, reasoning_effort)`,
title "[bakeoff model/effort] …") enqueued through `jobs.enqueue`, so the cloud worker builds
them and the timings land on the job rows — then `games_report.py --since-hours 24`.
`local` mode: `pipeline.run_job` on the laptop like the spike, results uploaded to the
learner's studio (create_game + put_html + add_version) when --learner is given.
Components are indexes into fixtures/sample_components.json or explicit Kata component ids.
"""
from __future__ import annotations

import argparse
import asyncio
import itertools
import json
import logging
import sys
from pathlib import Path
from typing import Any, Optional

HERE = Path(__file__).resolve()
sys.path.insert(0, str(HERE.parents[2]))            # workers/
sys.path.insert(0, str(HERE.parents[3] / "backend"))  # backend/

from game_gen.context_pack import ContextPack, build_context_pack  # noqa: E402

log = logging.getLogger("game_gen.bakeoff")

FIXTURE = HERE.parents[1] / "fixtures" / "sample_components.json"
BRIEFS = {
    "shooter": ("משחק יריות בחלל, מהיר וצבעוני", ["shooter"]),
    "open": ("תפתיע אותי — הכי מרשים שאפשר", ["surprise"]),
}
#: Models that are not on this account's Copilot catalog and their stand-ins.
SUBSTITUTES = {"claude-opus-4.6": "claude-opus-4.8"}


def _load_rows() -> list[dict[str, Any]]:
    if not FIXTURE.exists():
        return []
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


def _pack_of(row: dict[str, Any]) -> ContextPack:
    from game_gen.spike import pack_from_row
    return pack_from_row(row)


async def resolve_components(specs: list[str]) -> list[ContextPack]:
    """Indexes into the fixture, or Kata component ids resolved through the backend."""
    rows = _load_rows()
    out: list[ContextPack] = []
    for item in specs:
        item = item.strip()
        if item.isdigit():
            out.append(_pack_of(rows[int(item)]))
            continue
        match = next((r for r in rows if r.get("component_id") == item or (r.get("component") or {}).get("id") == item), None)
        if match:
            out.append(_pack_of(match))
            continue
        from app.services import kata_catalog  # type: ignore
        from app.services.games import jobs  # type: ignore
        await kata_catalog.ensure_loaded()
        comp = kata_catalog.get_component(item)
        if not comp:
            raise SystemExit(f"unknown component {item!r} (not in the fixture, not in the catalog)")
        unit = kata_catalog.get_unit(comp.get("unit_id") or "") or {}
        context = await jobs.build_context(item, comp.get("unit_id"), unit.get("objective_id"))
        out.append(build_context_pack(context or {}, language="he", device="keyboard"))
    return out


async def check_models(requested: list[str]) -> list[str]:
    """Verify against the Copilot catalog; substitute known stand-ins with a log line."""
    from game_gen.copilot_session import list_model_ids
    try:
        available = {m["id"] for m in await list_model_ids()}
    except Exception as exc:  # noqa: BLE001
        log.warning("could not list models (%s); trusting the request", exc)
        return requested
    out = []
    for model in requested:
        if model in available:
            out.append(model)
        elif model in SUBSTITUTES and SUBSTITUTES[model] in available:
            log.warning("%s is not on this account's catalog — substituting %s", model, SUBSTITUTES[model])
            out.append(SUBSTITUTES[model])
        else:
            raise SystemExit(f"model {model!r} is not on the Copilot catalog; available: {sorted(available)}")
    return out


def matrix(models: list[str], efforts: list[str], packs: list[ContextPack], briefs: list[str]) -> list[dict[str, Any]]:
    cells = []
    for model, effort, (ci, pack), brief in itertools.product(models, efforts, enumerate(packs), briefs):
        vibe, inspirations = BRIEFS.get(brief, (brief, []))
        cells.append({"model": model, "effort": effort, "component": ci, "pack": pack, "brief": brief,
                      "vibe": vibe, "inspirations": inspirations,
                      "title": f"[bakeoff {model}/{effort}] {pack.component_title[:40]} · {brief}"})
    return cells


async def run_queue(cells: list[dict[str, Any]], learner_id: str, plan: bool) -> None:
    from app.services.games import jobs, store  # type: ignore
    for cell in cells:
        pack: ContextPack = cell["pack"]
        game = await store.create_game(
            learner_id=learner_id, objective_id=pack.objective_id, unit_id=pack.unit_id,
            component_id=pack.component_id, title=cell["title"], genre=cell["inspirations"][0] if cell["inspirations"] else "surprise",
            prompt=cell["vibe"], language=pack.language, device=pack.device, title_by_learner=True,
            model=cell["model"], reasoning_effort=cell["effort"],
        )
        job = await jobs.enqueue(game, "create", vibe=cell["vibe"], inspirations=cell["inspirations"],
                                 learner_title=cell["title"][:40])
        if not plan:
            await store.update_job(job["_id"], payload={**job["payload"], "plan": False})
        print(f"queued {job['_id']} → game {game['_id']}  {cell['title']}")


async def run_local(cells: list[dict[str, Any]], learner_id: Optional[str], plan: bool, concurrency: int) -> None:
    from game_gen.spike import run_one
    sem = asyncio.Semaphore(max(1, concurrency))

    async def one(cell: dict[str, Any]) -> None:
        async with sem:
            row, result, pack = await run_one(
                cell["brief"], cell["component"], cell["vibe"], model=cell["model"], effort=cell["effort"],
                judge=True, credits=None, plan=plan, inspirations=cell["inspirations"], pack=cell["pack"],
                tag=f"{cell['model']}-{cell['effort']}",
            )
            if learner_id and result.ok and result.html:
                await upload(learner_id, cell, result, pack)

    await asyncio.gather(*(one(c) for c in cells))


async def upload(learner_id: str, cell: dict[str, Any], result: Any, pack: ContextPack) -> None:
    from app.services.games import html_store, store  # type: ignore
    game = await store.create_game(
        learner_id=learner_id, objective_id=pack.objective_id, unit_id=pack.unit_id,
        component_id=pack.component_id, title=cell["title"], genre="surprise", prompt=cell["vibe"],
        language=pack.language, device=pack.device, title_by_learner=True,
        model=cell["model"], reasoning_effort=cell["effort"],
    )
    stored = await html_store.put_html(learner_id, game["_id"], 1, result.html)
    thumb = None
    if result.screenshot_png:
        thumb = await html_store.put_bytes(learner_id, game["_id"], 1, "thumb.png", result.screenshot_png, "image/png")
    await store.add_version(game["_id"], blob_path=stored["blob_path"], sha256=stored["sha256"], source="create",
                            summary=result.summary, thumb_blob_path=thumb, design_brief=result.design_brief or None,
                            judge=result.judge)
    print(f"uploaded → game {game['_id']}  {cell['title']}")


async def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--models", default="claude-sonnet-5,gpt-5.6-sol,claude-opus-4.8,claude-opus-5")
    ap.add_argument("--efforts", default="low,medium")
    ap.add_argument("--components", default="0,1,2")
    ap.add_argument("--briefs", default="shooter,open")
    ap.add_argument("--mode", choices=["local", "queue"], default="queue")
    ap.add_argument("--learner", default=None, help="learner id that owns the bake-off games")
    ap.add_argument("--concurrency", type=int, default=3)
    ap.add_argument("--no-plan", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")

    models = [m.strip() for m in args.models.split(",") if m.strip()]
    efforts = [e.strip() for e in args.efforts.split(",") if e.strip()]
    briefs = [b.strip() for b in args.briefs.split(",") if b.strip()]
    packs = await resolve_components([c for c in args.components.split(",") if c.strip()])
    if not args.dry_run:
        models = await check_models(models)
    cells = matrix(models, efforts, packs, briefs)

    print(f"{len(cells)} run(s): {len(models)} model(s) × {len(efforts)} effort(s) × {len(packs)} component(s) × {len(briefs)} brief(s)"
          f"  mode={args.mode} plan={not args.no_plan}")
    for cell in cells:
        print(f"  {cell['model']:<18} {cell['effort']:<7} c{cell['component']} {cell['brief']:<8} {cell['pack'].component_title[:40]}")
    if args.dry_run:
        return
    if args.mode == "queue":
        if not args.learner:
            raise SystemExit("--learner is required in queue mode")
        await run_queue(cells, args.learner, plan=not args.no_plan)
    else:
        await run_local(cells, args.learner, plan=not args.no_plan, concurrency=args.concurrency)


if __name__ == "__main__":
    asyncio.run(main())
