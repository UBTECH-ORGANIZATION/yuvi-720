"""End-to-end visual evaluation: real questions in, rendered frames out.

`visual_report.py` measures layout on a frozen corpus of hand-written specs.
This script exercises the other half — the part no fixture can stand in for:
the planner deciding, unprompted, whether a picture helps and which of the three
tiers to reach for (primitives, props, freehand drawings).

Cases come from two places, and the mix is the point:

- **Every question in the live Kata catalogue.** These are the real thing —
  Hebrew, middle-school science, written by someone who was not thinking about
  our element vocabulary. A system that only works on examples we invented is
  a system tuned to its own test.
- **A novel-topic set**, deliberately chosen so that NO prop exists for any of
  it: the water cycle, a food chain, a pulley, a plant cell, a circuit. This is
  where a finite catalogue used to fail silently, and it is the reason the
  freehand tier exists.

Output is a contact sheet, because the failure modes that matter here — a shape
that is not recognisable, an object off the edge, two drawings overlapping — are
visible in a second and invisible to an assertion.

    python scripts/visual_eval.py --out artifacts/visual-eval/index.html
    python scripts/visual_eval.py --only novel --limit 6
"""

from __future__ import annotations

import argparse
import asyncio
from dataclasses import dataclass, field
from html import escape
import json
from pathlib import Path
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

from app.agents.manim_visual import plan_manim_visual  # noqa: E402
from app.agents.manim_worker import render  # noqa: E402
from app.services.ai_usage import UsageContext  # noqa: E402


# Topics with no prop of their own — the freehand tier is the only way to draw
# any of them, so a blank result here means the ceiling is still in place.
NOVEL_CASES: list[tuple[str, str, str]] = [
    ("water-cycle", "איך עובד מחזור המים בטבע?",
     "השמש מחממת את המים, הם מתאדים, מתעבים לעננים ויורדים כגשם."),
    ("food-chain", "מה זו שרשרת מזון? תן דוגמה עם עשב, ארנב ונשר.",
     "האנרגיה עוברת מהצמח לאוכל העשב ומשם לטורף."),
    ("pulley", "איך גלגלת עוזרת להרים משקל כבד?",
     "הגלגלת משנה את כיוון הכוח ומחלקת אותו."),
    ("plant-cell", "מה ההבדל בין תא צמח לתא בעל חיים?",
     "לתא צמח יש דופן, כלורופלסטים וחלולית גדולה."),
    ("circuit", "מה ההבדל בין חיבור בטור לחיבור במקביל?",
     "בטור הזרם עובר בנתיב אחד, במקביל יש כמה נתיבים."),
    ("lever", "איך מנוף עוזר לנו להרים חפצים?",
     "ככל שהמרחק מנקודת המשען גדול יותר, נדרש פחות כוח."),
    ("volcano", "איך נוצרת התפרצות של הר געש?",
     "לחץ של מאגמה מתחת לקרום דוחף אותה החוצה דרך הלוע."),
    ("digestion", "מה עובר האוכל בגוף שלנו?",
     "מהפה לוושט, לקיבה, למעי הדק ולמעי הגס."),
    ("phases", "מה קורה לחלקיקים כשקרח נמס והופך לאדים?",
     "במוצק החלקיקים מסודרים, בנוזל צפופים וחופשיים, בגז רחוקים ומהירים."),
    ("eclipse", "למה יש ליקוי חמה?",
     "הירח עובר בין השמש לכדור הארץ ומטיל צל."),
    ("density-float", "למה ספינת ברזל צפה ואבן קטנה שוקעת?",
     "מה שקובע הוא הצפיפות הממוצעת, לא המשקל."),
    ("thermometer", "איך קוראים טמפרטורה במדחום?",
     "עמוד הנוזל עולה עם החום; קוראים בגובה העמוד."),
]


@dataclass
class Case:
    case_id: str
    source: str            # "kata" | "novel"
    request: str
    answer: str


@dataclass
class Result:
    case: Case
    accepted: bool
    seconds: float
    title: str = ""
    elements: list[str] = field(default_factory=list)
    props: list[str] = field(default_factory=list)
    drawings: int = 0
    strokes: int = 0
    image: Path | None = None
    error: str = ""

    @property
    def tiers(self) -> str:
        """Which of the three vocabulary tiers this plan actually used."""
        used = []
        if self.props:
            used.append("prop")
        if self.drawings:
            used.append("draw")
        if any(e not in {"prop", "drawing"} for e in self.elements):
            used.append("prim")
        return "+".join(used) or "—"


async def kata_cases(limit: int | None) -> list[Case]:
    """Every question the live catalogue actually ships."""
    from app.services import kata_catalog as kc

    await kc.ensure_loaded()
    cases: list[Case] = []
    for subject in kc.subjects():
        for objective in kc.objectives_for(subject):
            for component in kc.components_for(objective.get("id")):
                component_id = component.get("id")
                for row in kc.item_profiles(component_id):
                    if not row.get("question_count"):
                        continue
                    for question in kc.questions_for_item(component_id, row["id"]):
                        text = (question.get("questionText") or "").strip()
                        if not text:
                            continue
                        cases.append(Case(
                            case_id=f"{row['id'].rsplit('-', 2)[-2]}-{row['id'].rsplit('-', 1)[-1]}"
                                    f"-{question.get('questionId')}",
                            source="kata",
                            request=text,
                            answer=(kc.information_for_item(component_id, row["id"]) or "")[:400],
                        ))
    return cases[:limit] if limit else cases


def novel_cases(limit: int | None) -> list[Case]:
    cases = [Case(case_id=cid, source="novel", request=req, answer=ans)
             for cid, req, ans in NOVEL_CASES]
    return cases[:limit] if limit else cases


async def plan_case(case: Case, out_dir: Path, semaphore: asyncio.Semaphore) -> Result:
    """Plan one case. Rendering happens later, on one thread — see `main`."""
    started = time.monotonic()
    async with semaphore:
        try:
            scene = await plan_manim_visual(
                case.request, case.answer, "he",
                usage_context=UsageContext(
                    actor_id="visual-eval", actor_type="system",
                    endpoint="internal:visual-eval",
                    feature="feature_3_learning_companion",
                    operation="visual.eval", source="coach_agent",
                ),
            )
        except Exception as exc:
            return Result(case, False, time.monotonic() - started,
                          error=f"plan failed: {type(exc).__name__}: {exc}"[:200])
    elapsed = time.monotonic() - started
    if not scene:
        # A refusal is a legitimate outcome, not a failure: most questions do
        # not need a picture, and a weak drawing costs more than none.
        return Result(case, False, elapsed)

    elements = [str(e.get("type")) for e in scene.get("elements", [])]
    result = Result(
        case, True, elapsed,
        title=str(scene.get("title") or ""),
        elements=elements,
        props=[str(e.get("prop")) for e in scene.get("elements", []) if e.get("type") == "prop"],
        drawings=sum(1 for e in elements if e == "drawing"),
        strokes=sum(len(e.get("strokes") or []) for e in scene.get("elements", [])),
    )
    result.image = out_dir / f"{case.source}-{case.case_id}.png"
    result.image.with_suffix(".json").write_text(
        json.dumps(scene, ensure_ascii=False), encoding="utf-8"
    )
    return result


def render_all(results: list[Result]) -> None:
    """Render one at a time.

    Manim keeps its configuration in module-level global state, so two renders
    in parallel threads corrupt each other — which showed up here as a bare
    `IndexError` from inside the renderer on a scene that renders perfectly on
    its own. Production never hits this (each render gets its own worker
    process); the harness invented the problem by using a thread pool, so the
    harness gives it back.
    """
    for result in results:
        if result.image is None:
            continue
        try:
            render(result.image.with_suffix(".json"), result.image)
            if not result.image.exists():
                result.error = "render produced no file"
                result.image = None
        except Exception as exc:
            result.error = f"render failed: {type(exc).__name__}: {exc}"[:200]
            result.image = None


def render_html(results: list[Result], out: Path) -> str:
    accepted = [r for r in results if r.accepted]
    broken = [r for r in results if r.error]
    cards = []
    for result in sorted(results, key=lambda r: (r.case.source, r.case.case_id)):
        if result.image is not None:
            art = f'<img src="{escape(result.image.name)}" alt="">'
        elif result.accepted:
            art = f'<div class="none err">{escape(result.error or "no image")}</div>'
        else:
            art = '<div class="none">ללא המחשה — declined</div>'
        badge = "err" if result.error else ("ok" if result.accepted else "skip")
        cards.append(f"""<figure class="card {badge}">
  {art}
  <figcaption>
    <div class="id">{escape(result.case.source)} · {escape(result.case.case_id)}
      <span class="tier">{escape(result.tiers)}</span></div>
    <div class="req">{escape(result.case.request[:190])}</div>
    <div class="meta">{escape(', '.join(result.elements[:10]) or '—')}</div>
    {f'<div class="meta props">props: {escape(", ".join(result.props))}</div>' if result.props else ''}
    <div class="meta">{result.seconds:.1f}s</div>
  </figcaption>
</figure>""")

    counts: dict[str, int] = {}
    for result in accepted:
        counts[result.tiers] = counts.get(result.tiers, 0) + 1
    summary = " · ".join(f"{k}: {v}" for k, v in sorted(counts.items())) or "—"

    return f"""<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8">
<title>Visual eval</title><style>
 body{{font-family:system-ui,'Segoe UI',sans-serif;background:#14121f;color:#eae7f5;margin:0;padding:24px}}
 h1{{font-size:20px;margin:0 0 4px}} .sub{{color:#a49dc4;font-size:13px;margin-bottom:18px}}
 .grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:14px}}
 .card{{margin:0;background:#1e1b2e;border:1px solid #2f2b45;border-radius:12px;overflow:hidden}}
 .card.err{{border-color:#c4553d}} .card.skip{{opacity:.62}}
 .card img{{width:100%;display:block;background:#fff}}
 .none{{padding:34px 12px;text-align:center;color:#8d86ad;font-size:13px;background:#181528}}
 .none.err{{color:#ef9077}}
 figcaption{{padding:9px 11px}} .id{{font-size:11px;color:#8d86ad;letter-spacing:.3px}}
 .tier{{float:left;color:#c9a7ff}}
 .req{{font-size:13px;margin:5px 0;line-height:1.45}}
 .meta{{font-size:11px;color:#7d76a0}} .props{{color:#7fd0a8}}
</style></head><body>
<h1>Visual eval — {len(results)} cases</h1>
<div class="sub">{len(accepted)} illustrated · {len(results) - len(accepted)} declined ·
 {len(broken)} broken &nbsp;|&nbsp; tiers used — {escape(summary)}</div>
<div class="grid">{''.join(cards)}</div>
</body></html>"""


async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="artifacts/visual-eval/index.html")
    parser.add_argument("--only", choices=["kata", "novel"], default=None)
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--concurrency", type=int, default=4)
    args = parser.parse_args()

    cases: list[Case] = []
    if args.only != "novel":
        cases += await kata_cases(args.limit)
    if args.only != "kata":
        cases += novel_cases(args.limit)

    out = Path(args.out).resolve()
    out.parent.mkdir(parents=True, exist_ok=True)
    print(f"▶ {len(cases)} cases → {out.parent}")

    semaphore = asyncio.Semaphore(args.concurrency)
    results = list(await asyncio.gather(
        *(plan_case(c, out.parent, semaphore) for c in cases)
    ))
    print("▶ planning done — rendering")
    await asyncio.to_thread(render_all, results)

    out.write_text(render_html(list(results), out), encoding="utf-8")

    illustrated = [r for r in results if r.accepted]
    broken = [r for r in results if r.error]
    print(f"\n{'case':28s} {'tier':12s} {'elements':38s} sec")
    for result in sorted(results, key=lambda r: (r.case.source, r.case.case_id)):
        mark = "✗" if result.error else (" " if result.accepted else "·")
        print(f"{mark} {result.case.source[:4]}-{result.case.case_id:22s} "
              f"{result.tiers:12s} {', '.join(result.elements[:5])[:38]:38s} {result.seconds:4.1f}")
    print(f"\nillustrated {len(illustrated)}/{len(results)} · broken {len(broken)}")
    for result in broken:
        print(f"  ✗ {result.case.case_id}: {result.error}")
    print(f"\n→ {out}")
    return 1 if broken else 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
