"""Regenerate fixtures/sample_components.json from the LIVE Kata catalog.

    cd backend && .venv/bin/python ../workers/game_gen/scripts/dump_fixture.py [limit]

Each row is a ``ContextPack`` dict (titles, subject, grade, purpose and the
one-paragraph ``learning_description`` from ``jobs.build_context`` — which
caches the description in Mongo). No answers, no question rows. The file is
gitignored anyway; it exists so the spike and the bake-off run without the
backend on the path.
"""
from __future__ import annotations

import asyncio
import json
import sys
from dataclasses import asdict
from pathlib import Path

HERE = Path(__file__).resolve()
OUT = HERE.parents[1] / "fixtures" / "sample_components.json"
sys.path.insert(0, str(HERE.parents[2]))  # workers/ → `game_gen` importable


async def main(limit: int = 3) -> None:
    from dotenv import load_dotenv
    load_dotenv(".env")
    from app.services import kata_catalog
    from app.services.games import jobs
    from game_gen.context_pack import build_context_pack

    await kata_catalog.ensure_loaded(force=True)
    comps = list(kata_catalog._SNAPSHOT["components"].values())
    # Prefer components with teacher notes: their descriptions are the richest.
    comps.sort(key=lambda c: (bool(c.get("information_to_bot")), len(c.get("questions_by_item") or {})), reverse=True)
    rows = []
    for c in comps[:limit]:
        unit = kata_catalog.get_unit(c.get("unit_id") or "") or {}
        context = await jobs.build_context(str(c["id"]), c.get("unit_id"), unit.get("objective_id"))
        if not context:
            continue
        pack = build_context_pack(context, language="he", device="keyboard")
        rows.append(asdict(pack))
        print(pack.component_id, "|", pack.component_title, "|", len(pack.learning_description), "chars")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8")
    print("wrote", OUT)


if __name__ == "__main__":
    asyncio.run(main(int(sys.argv[1]) if len(sys.argv) > 1 else 3))
