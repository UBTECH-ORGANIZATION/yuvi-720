#!/usr/bin/env python3
"""What does the coach mark on each screen? — a local screenshot gallery.

    python scripts/content_audit.py --component methodica-science-mass-measure-02-01 \\
        --component CET.MATH.G7.NUM.COORD-SYS-A.POS-NUM.PLOT-00001

Browses each lesson the way the nightly does (sink-LRS launch, a fresh
``pipeline-<uuid>`` student — no learner, LRS or database is touched), with
the walker's audit screenshots on, builds the v8 object catalog exactly as the
pipeline would, and renders ``backend/artifacts/content-audit/<stamp>/
index.html`` (gitignored — vendor screenshots never leave this machine):

- every mapped screen's screenshot, with every object drawn where the
  capture says it is (colored by role, labeled with its id and Hebrew label);
- the committed v7 regions for the same slide, dashed, for comparison;
- the resolver's mark for each turn type (question intro, hint, idle, a
  mistake, "what's in the picture?") — the thing the learner will actually
  be shown;
- how the screen was matched to its slide (page id / text / sandwich);
- a census of object kinds per provider.

Nothing is written to content/context.
"""

from __future__ import annotations

import argparse
import asyncio
import html
import json
import shutil
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import os  # noqa: E402

# A browse needs Kata and nothing else: no database, no cache.
for _key in ("MONGODB_CONNECTION_STRING", "REDIS_CONNECTION_STRING"):
    os.environ[_key] = ""
os.environ.setdefault("SPARK_STORAGE", "json")
os.environ.setdefault("SPARK_CACHE", "off")

import content_pipeline as pipeline  # noqa: E402
from app.agents import coach_focus  # noqa: E402
from app.services import content_intelligence as ci  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]
ROLE_COLOR = {"stem": "#2f6fed", "answer_area": "#e0452f", "data": "#1a9e5b",
              "teaching": "#8e44ad", "instruction": "#b8860b"}
TURNS = (
    ("question intro", {"trigger": "question_intro"}),
    ("hint", {"support_mode": "hint"}),
    ("idle nudge", {"trigger": "idle"}),
    ("mistake (chose a wrong option)", {"trigger": "mistake", "evidence": True}),
    ("“מה רואים בתמונה?”", {"message": "מה רואים בתמונה?", "query_intent": "learning_help"}),
    ("“לא הבנתי את השאלה”", {"message": "לא הבנתי את השאלה", "query_intent": "learning_help"}),
)


def _current(cid: str, slide: dict[str, Any], evidence: bool) -> dict[str, Any]:
    question = (slide.get("questions") or [{}])[0]
    options = list(question.get("answers") or [])
    correct = list(question.get("correct") or [])
    events = []
    if evidence:
        wrong = next((o for o in options if o not in correct), None)
        if wrong:
            events = [{"question_id": question.get("question_id"), "item_id": slide["item_id"],
                       "success": False, "response": wrong}]
    return {
        "on_lesson_screen": True, "component_id": cid, "item_id": slide["item_id"],
        "question_id": question.get("question_id") or "",
        "question": {"text": question.get("question_text") or "", "options": options,
                     "correct": correct, "reached": True},
        "item": {"title": slide.get("title"), "media_format": slide.get("media_format"),
                 "kind": "watch" if slide.get("role") == "video" else ""},
        "recent_events": events,
    }


def _catalog(enrichment: dict[str, Any]) -> dict[str, Any]:
    grid = enrichment.get("grid") or []
    return {"objects": [{
        "id": o["id"], "kind": o["kind"], "role": o["role"], "q": o.get("q") or [],
        "parent": o.get("parent"), "option_index": o.get("option_index"),
        "label": o.get("label_he") or "", "geometry": ci._object_geometry(o, grid),
    } for o in enrichment.get("objects") or []], "layout": enrichment.get("layout") or {}}


def resolver_picks(cid: str, slide: dict[str, Any]) -> list[tuple[str, str]]:
    enrichment = slide.get("enrichment") or {}
    catalog = _catalog(enrichment) if enrichment.get("capture_version") == 8 else None
    picks = []
    with mock.patch.object(ci, "screen_objects", lambda *a: catalog), \
         mock.patch.object(ci, "screen_anchors", lambda *a: None):
        for label, turn in TURNS:
            turn = dict(turn)
            evidence = turn.pop("evidence", False)
            frame, decision = coach_focus.resolve(_current(cid, slide, evidence), client_version=2, **turn)
            target = (f"{frame['object_id']} · {frame.get('label', '')} · {frame['precision']}"
                      if frame else "— no mark")
            if decision.lifted:
                target += f"  (lifted: {decision.lifted})"
            picks.append((label, target, frame["object_id"] if frame else ""))
    return picks


def _rect_at(obj: dict[str, Any], grid: list, width: int, height: int):
    for rect, row in zip(obj.get("r") or [], grid):
        if rect and int(row[0]) == width and int(row[1]) == height:
            return rect
    return None


def render_slide(cid: str, slide: dict[str, Any], screen: dict[str, Any], shot_rel: str,
                 legacy: dict[str, Any]) -> str:
    enrichment = slide.get("enrichment") or {}
    audit = screen.get("audit") or {}
    offset = audit.get("offset") or {"x": 0, "y": 0}
    scroll = audit.get("scroll") or {"x": 0, "y": 0}
    grid = enrichment.get("grid") or []
    picks = resolver_picks(cid, slide)
    picked = {p[2] for p in picks if p[2]}
    boxes = []
    for obj in enrichment.get("objects") or []:
        rect = _rect_at(obj, grid, 1280, 860)
        if not rect:
            continue
        x, y = offset["x"] + rect[0] - scroll["x"], offset["y"] + rect[1] - scroll["y"]
        color = ROLE_COLOR.get(obj["role"], "#555")
        width = 4 if obj["id"] in picked else 2
        boxes.append(
            f'<div class="box" style="left:{x}px;top:{y}px;width:{rect[2]}px;height:{rect[3]}px;'
            f'border:{width}px solid {color}"><span style="background:{color}">'
            f'{html.escape(obj["id"])} · {html.escape(obj.get("label_he") or "")}</span></div>')
    for region, entries in ((legacy.get("regions") or {}).items() if legacy else []):
        for entry in entries:
            if entry.get("w") == 1280 and entry.get("h") == 860:
                r = entry["rect"]
                boxes.append(
                    f'<div class="box legacy" style="left:{offset["x"] + r["x"]}px;'
                    f'top:{offset["y"] + r["y"]}px;width:{r["w"]}px;height:{r["h"]}px">'
                    f'<span>v7 {html.escape(region)}</span></div>')
    mapping = enrichment.get("mapping") or {}
    rows = "".join(f"<tr><td>{html.escape(label)}</td><td>{html.escape(target)}</td></tr>"
                   for label, target, _ in picks)
    return f"""
<section>
  <h2>{html.escape(slide.get('title') or slide['item_id'])}</h2>
  <p class="meta">{html.escape(cid)} · {html.escape(slide['item_id'])} · role {slide.get('role')} ·
     matched by <b>{html.escape(str(mapping.get('method') or '—'))}</b> (screen {mapping.get('screen')}) ·
     layout {html.escape(str((enrichment.get('layout') or {}).get('kind') or '—'))}</p>
  <div class="shot"><img src="{html.escape(shot_rel)}" width="1280" height="860">{''.join(boxes)}</div>
  <table><tr><th>turn</th><th>the mark the learner gets</th></tr>{rows}</table>
</section>"""


PAGE = """<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Content audit</title>
<style>
:root {{ color-scheme: light dark; --bg:#fafafa; --ink:#1d1d1f; --muted:#666; }}
@media (prefers-color-scheme: dark) {{ :root {{ --bg:#16161a; --ink:#eee; --muted:#aaa; }} }}
body {{ font: 14px/1.4 system-ui, sans-serif; background: var(--bg); color: var(--ink); margin: 16px; }}
section {{ margin: 32px 0 48px; }}
.meta {{ color: var(--muted); }}
.shot {{ position: relative; width: 1280px; height: 860px; overflow: hidden; border: 1px solid #8884; }}
.box {{ position: absolute; box-sizing: border-box; pointer-events: none; }}
.box span {{ position: absolute; top: -1px; left: -1px; color: #fff; font: 600 11px/15px sans-serif;
             padding: 0 4px; white-space: nowrap; direction: rtl; }}
.legacy {{ border: 2px dashed #999; }} .legacy span {{ background: #777; top: auto; bottom: -1px; }}
table {{ border-collapse: collapse; margin-top: 8px; }} td, th {{ border: 1px solid #8884; padding: 4px 8px; text-align: start; }}
td:last-child {{ direction: rtl; unicode-bidi: plaintext; }}
</style></head><body>
<h1>Content audit {stamp}</h1>
<p>Boxes: <b style="color:#2f6fed">question</b> · <b style="color:#e0452f">answers</b> ·
<b style="color:#1a9e5b">data</b> · <b style="color:#8e44ad">teaching</b> · <b style="color:#b8860b">instructions</b>;
thick = picked by the resolver for some turn; dashed gray = today's committed v7 region.</p>
<h2>Census</h2><pre>{census}</pre>
{sections}
</body></html>"""


async def main_async(args) -> int:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out = Path(args.out or REPO_ROOT / "backend" / "artifacts" / "content-audit" / stamp)
    out.mkdir(parents=True, exist_ok=True)
    print("→ fetching the catalog…")
    model = await pipeline.fetch_catalog_model()
    committed = pipeline.load_committed(pipeline.DEFAULT_OUT_DIR)
    sections: list[str] = []
    census: Counter = Counter()
    for cid in args.component:
        if cid not in model:
            print(f"  ✗ {cid}: not in the catalog")
            continue
        audit_dir = out / "shots" / cid.replace("/", "_")
        dump_dir = out / "dumps"
        print(f"→ browsing {cid}…")
        extraction = await pipeline.browse_component(
            cid, model[cid], dump_dir, committed.get(cid), audit_dir=audit_dir)
        print(f"  {extraction['verdict']} ({extraction['screens_mapped']}/{len(model[cid]['slides'])} mapped)")
        if not args.no_vision:
            # The nightly's own vision pass: labels the graphics and drops the
            # decorative ones (a mascot is not "the picture" a hint means).
            calls = await pipeline.describe_graphics(model, [cid], args.max_vision_calls)
            pipeline.apply_graphic_labels(model, [cid])
            print(f"  vision: {calls} call(s)")
        try:
            dump = json.loads((dump_dir / f"{cid}.json").read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        screens = {int(s.get("index") or 0): s for s in dump.get("screens") or []}
        provider = model[cid].get("provider") or "?"
        legacy_slides = {s["item_id"]: s for s in (committed.get(cid) or {}).get("slides") or []}
        for slide in model[cid]["slides"]:
            enrichment = slide.get("enrichment") or {}
            for obj in enrichment.get("objects") or []:
                census[(provider, obj["kind"])] += 1
            mapping = enrichment.get("mapping") or {}
            screen = screens.get(int(mapping.get("screen") or -1)) if mapping else None
            shot = ((screen or {}).get("audit") or {}).get("clean")
            if not shot or not Path(shot).exists():
                continue
            legacy = None
            old = (legacy_slides.get(slide["item_id"]) or {}).get("enrichment") or {}
            if old.get("capture_version") == 7:
                with mock.patch.object(ci, "_fresh_capture", lambda *a: old):
                    legacy = ci.screen_anchors(cid, slide["item_id"])
            sections.append(render_slide(cid, slide, screen, str(Path(shot).relative_to(out)), legacy))
    census_text = "\n".join(f"{provider:12} {kind:14} {count}"
                            for (provider, kind), count in sorted(census.items()))
    (out / "index.html").write_text(PAGE.format(
        stamp=stamp, census=html.escape(census_text) or "—", sections="".join(sections)),
        encoding="utf-8")
    if not args.keep_dumps:
        shutil.rmtree(out / "dumps", ignore_errors=True)   # vendor text: not kept
    print(f"→ {out / 'index.html'} ({len(sections)} screens)")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--component", action="append", required=True)
    parser.add_argument("--out")
    parser.add_argument("--no-vision", action="store_true",
                        help="skip the graphics pass (decorative images stay pointable)")
    parser.add_argument("--max-vision-calls", type=int, default=12)
    parser.add_argument("--keep-dumps", action="store_true",
                        help="keep the walker dumps (local debugging only)")
    return asyncio.run(main_async(parser.parse_args()))


if __name__ == "__main__":
    raise SystemExit(main())
