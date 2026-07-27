#!/usr/bin/env python
"""Quality report for the Coach visual pipeline.

The test suite answers "is anything broken?". This answers "how good is the
output?" — which is a different question, and the one you actually look at
before calling a render pipeline finished.

Every case in tests/visual_corpus is pushed through the real sanitizer and
scored on measurable properties of its layout: how close the tightest pair of
labels sits, how near a label comes to the geometry it is not naming, how far a
label drifts from what it does name. Each case is rendered inline as SVG (the
deterministic fallback — no Manim, no browser) so the numbers sit next to the
picture that produced them.

Cases are ordered WORST FIRST. A report you have to scroll to find problems in
is a report nobody reads.

    python scripts/visual_report.py [--out artifacts/visual-report.html]
"""

from __future__ import annotations

import argparse
import base64
from dataclasses import dataclass
from html import escape
import math
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.agents.manim_visual import _svg_fallback, sanitize_scene           # noqa: E402
from app.agents.visual_layout import (                                       # noqa: E402
    Box, build_transform, check_layout, collect_label_requests, collect_obstacles,
    _segment_box_hit,
)
from tests.visual_corpus import CORPUS                                       # noqa: E402


@dataclass
class Report:
    case_id: str
    tags: list[str]
    accepted: bool
    render: str
    label_count: int
    min_label_gap: float | None      # tightest pair of labels, canvas units
    min_geometry_gap: float | None   # nearest approach to a stroke it does not name
    max_anchor_distance: float | None
    violations: list[str]
    svg: str | None

    @property
    def score(self) -> int:
        """0-100. Deliberately blunt: it ranks cases, it does not grade them."""
        if not self.accepted:
            return 100                       # a correct refusal is a good outcome
        score = 100
        score -= 25 * len(self.violations)
        if self.min_label_gap is not None and self.min_label_gap < 0.12:
            score -= int((0.12 - self.min_label_gap) * 160)
        if self.min_geometry_gap is not None and self.min_geometry_gap < 0.10:
            score -= int((0.10 - self.min_geometry_gap) * 180)
        if self.max_anchor_distance is not None and self.max_anchor_distance > 1.4:
            score -= int((self.max_anchor_distance - 1.4) * 22)
        return max(0, min(100, score))


def measure(case) -> Report:
    scene = sanitize_scene(case.raw)
    tags = sorted(case.tags)
    if scene is None:
        return Report(case.id, tags, False, "-", 0, None, None, None, [], None)

    transform = build_transform(scene["elements"])
    obstacles = collect_obstacles(scene["elements"], transform)
    requests = collect_label_requests(scene["elements"], transform)

    boxes: list[tuple[Box, object]] = []
    anchor_distances: list[float] = []
    for request in requests:
        position = (scene["elements"][request.element_index].get("layout") or {}).get(request.slot)
        if position is None:
            continue
        width, height = request.extent()
        box = Box(position[0], position[1], width, height)
        boxes.append((box, request))
        anchor_distances.append(math.dist((box.cx, box.cy), request.anchor))

    # Tightest pair of labels: how much air the crowded-est two have between them.
    min_gap = None
    for i, (a, _) in enumerate(boxes):
        for b, _ in boxes[i + 1:]:
            gap = max(
                max(a.left, b.left) - min(a.right, b.right),
                max(a.bottom, b.bottom) - min(a.top, b.top),
            )
            min_gap = gap if min_gap is None else min(min_gap, gap)

    # Nearest approach to a stroke: grow the label's box outward until it first
    # touches something. That pad IS the clearance. A box already touching at
    # pad 0 reports a NEGATIVE value — the label is sitting on the geometry.
    PROBES = (0.02, 0.05, 0.09, 0.14, 0.20, 0.30, 0.45)
    min_geometry = None
    for box, _ in boxes:
        if any(_segment_box_hit(segment, box) for segment in obstacles.segments):
            value = -1.0                       # overlapping, not merely close
        else:
            value = PROBES[-1]                 # clear beyond the furthest probe
            for pad in PROBES:
                grown = Box(box.cx, box.cy, box.w + pad * 2, box.h + pad * 2)
                if any(_segment_box_hit(segment, grown) for segment in obstacles.segments):
                    value = pad
                    break
        min_geometry = value if min_geometry is None else min(min_geometry, value)

    try:
        svg = _svg_fallback(scene).decode("utf-8")
    except Exception as exc:                       # a broken preview must not kill the report
        svg = f"<!-- svg fallback failed: {exc} -->"

    return Report(
        case_id=case.id,
        tags=tags,
        accepted=True,
        render=scene["render"],
        label_count=len(boxes),
        min_label_gap=min_gap,
        min_geometry_gap=min_geometry,
        max_anchor_distance=max(anchor_distances) if anchor_distances else None,
        violations=[f"{v.kind}: {v.detail}" for v in check_layout(scene)],
        svg=svg,
    )


def number(value: float | None, digits: int = 2) -> str:
    return "—" if value is None else f"{value:.{digits}f}"


def render_html(reports: list[Report]) -> str:
    accepted = [r for r in reports if r.accepted]
    mean = sum(r.score for r in reports) / max(len(reports), 1)
    perfect = sum(1 for r in reports if r.score == 100)
    flagged = [r for r in reports if r.score < 100]

    cards = []
    for report in reports:
        preview = (
            f'<div class="preview">{report.svg}</div>' if report.svg
            else '<div class="preview refused">refused — no visual</div>'
        )
        violations = "".join(
            f'<li>{escape(v)}</li>' for v in report.violations
        ) or "<li class='ok'>no violations</li>"
        cards.append(f"""
<article class="card" data-score="{report.score}">
  <header>
    <span class="id">{escape(report.case_id)}</span>
    <span class="score s{min(report.score // 25, 3)}">{report.score}</span>
  </header>
  {preview}
  <dl class="metrics">
    <div><dt>labels</dt><dd>{report.label_count}</dd></div>
    <div><dt>tightest label gap</dt><dd>{number(report.min_label_gap)}</dd></div>
    <div><dt>nearest geometry</dt><dd>{number(report.min_geometry_gap)}</dd></div>
    <div><dt>max anchor dist</dt><dd>{number(report.max_anchor_distance)}</dd></div>
    <div><dt>render</dt><dd>{escape(report.render)}</dd></div>
  </dl>
  <ul class="violations">{violations}</ul>
</article>""")

    return f"""<!doctype html><html><head><meta charset="utf-8">
<title>Yuvi visual quality report</title><style>
:root{{color-scheme:light dark;--bg:#f4f3f9;--panel:#fff;--edge:#d7d4e6;--ink:#241f3c;--ink2:#514a70;--ink3:#837ca0;--good:#17803d;--warn:#b47708;--bad:#b91c1c}}
@media(prefers-color-scheme:dark){{:root{{--bg:#0d0c16;--panel:#161423;--edge:#2e2947;--ink:#ece9f7;--ink2:#a9a2c8;--ink3:#736c92;--good:#3fd39a;--warn:#f2b93b;--bad:#ff7b6b}}}}
*{{box-sizing:border-box}}body{{margin:0;padding:24px;background:var(--bg);color:var(--ink);font:14px/1.6 system-ui,sans-serif}}
h1{{font:600 26px ui-monospace,monospace;letter-spacing:-.03em;margin:0 0 4px}}
.lede{{color:var(--ink2);max-width:70ch;margin:0 0 18px}}
.summary{{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:22px}}
.stat{{border:1px solid var(--edge);background:var(--panel);border-radius:3px;padding:10px 14px;min-width:132px}}
.stat b{{display:block;font:600 24px ui-monospace,monospace;font-variant-numeric:tabular-nums}}
.stat span{{font:11px ui-monospace,monospace;letter-spacing:.12em;text-transform:uppercase;color:var(--ink3)}}
.grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:14px}}
.card{{border:1px solid var(--edge);background:var(--panel);border-radius:3px;overflow:hidden;display:flex;flex-direction:column}}
.card header{{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:8px 11px;border-bottom:1px solid var(--edge)}}
.id{{font:12px ui-monospace,monospace;color:var(--ink2);word-break:break-all}}
.score{{font:600 13px ui-monospace,monospace;padding:2px 7px;border-radius:2px;flex:0 0 auto}}
.s3{{color:var(--good);border:1px solid var(--good)}}.s2{{color:var(--warn);border:1px solid var(--warn)}}
.s1,.s0{{color:var(--bad);border:1px solid var(--bad)}}
.preview{{background:#fbfaff;display:flex;justify-content:center}}.preview svg{{width:100%;height:auto;display:block}}
.preview.refused{{padding:40px;color:var(--ink3);font:12px ui-monospace,monospace;background:transparent}}
.metrics{{margin:0;padding:9px 11px;display:grid;grid-template-columns:1fr 1fr;gap:2px 10px;border-top:1px solid var(--edge)}}
.metrics div{{display:flex;justify-content:space-between;gap:8px}}
.metrics dt{{font:10px ui-monospace,monospace;letter-spacing:.08em;text-transform:uppercase;color:var(--ink3)}}
.metrics dd{{margin:0;font:12px ui-monospace,monospace;font-variant-numeric:tabular-nums}}
.violations{{margin:0;padding:8px 11px 10px 26px;font:11px ui-monospace,monospace;color:var(--bad)}}
.violations .ok{{color:var(--ink3);list-style:none;margin-left:-14px}}
</style></head><body>
<h1>Visual quality report</h1>
<p class="lede">Every case in the corpus through the real sanitizer, scored on measurable
layout properties and previewed as its deterministic SVG. <strong>Worst first.</strong>
Distances are canvas units (the frame is 14.2 &times; 8).</p>
<div class="summary">
  <div class="stat"><b>{len(reports)}</b><span>cases</span></div>
  <div class="stat"><b>{len(accepted)}</b><span>accepted</span></div>
  <div class="stat"><b>{len(reports) - len(accepted)}</b><span>refused</span></div>
  <div class="stat"><b>{mean:.1f}</b><span>mean score</span></div>
  <div class="stat"><b>{perfect}</b><span>perfect</span></div>
  <div class="stat"><b>{len(flagged)}</b><span>flagged</span></div>
</div>
<div class="grid">{''.join(cards)}</div>
</body></html>"""


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="artifacts/visual-report.html")
    parser.add_argument("--fail-under", type=int, default=0,
                        help="exit non-zero if any case scores below this")
    args = parser.parse_args()

    reports = sorted((measure(case) for case in CORPUS), key=lambda r: (r.score, r.case_id))

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(render_html(reports), encoding="utf-8")

    worst = [r for r in reports if r.score < 100][:10]
    print(f"{len(reports)} cases · mean score "
          f"{sum(r.score for r in reports) / len(reports):.1f} · report → {out}")
    if worst:
        print("\nlowest scoring:")
        for r in worst:
            print(f"  {r.score:>3}  {r.case_id:<40} "
                  f"gap={number(r.min_label_gap)} geom={number(r.min_geometry_gap)} "
                  f"{'; '.join(r.violations) if r.violations else ''}")
    else:
        print("every case scored 100")

    below = [r for r in reports if r.score < args.fail_under]
    if below:
        print(f"\n{len(below)} case(s) below --fail-under={args.fail_under}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
