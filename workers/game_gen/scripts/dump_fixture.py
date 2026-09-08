"""Regenerate fixtures/sample_components.json from the LIVE Kata catalog.

    cd backend && .venv/bin/python ../workers/game_gen/scripts/dump_fixture.py

The file holds correct answers and is gitignored on purpose (content-intelligence
rule: correctAnswers never enter the repo). It exists only so the spike can run
without the backend; production builds the context pack at enqueue time from the
same catalog snapshot (``build_context_pack``), so nothing here needs a nightly.
"""
from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "fixtures" / "sample_components.json"


async def main(limit: int = 3) -> None:
    from dotenv import load_dotenv
    load_dotenv(".env")
    from app.services import kata_catalog

    await kata_catalog.ensure_loaded(force=True)
    comps = [c for c in kata_catalog._SNAPSHOT["components"].values() if c.get("questions_by_item")]
    comps.sort(key=lambda c: (bool(c.get("information_to_bot")), min(sum(len(v) for v in c["questions_by_item"].values()), 12)), reverse=True)
    rows = []
    for c in comps[:limit]:
        unit = kata_catalog.get_unit(c.get("unit_id") or "") or {}
        obj = kata_catalog.get_objective(unit.get("objective_id") or "") or {}
        rows.append({"component": c, "unit": unit, "objective": obj})
        print(c["id"], "|", c.get("title"), "| q:", sum(len(v) for v in c["questions_by_item"].values()))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8")
    print("wrote", OUT)


if __name__ == "__main__":
    asyncio.run(main(int(sys.argv[1]) if len(sys.argv) > 1 else 3))
