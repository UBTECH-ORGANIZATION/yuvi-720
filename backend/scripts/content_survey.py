"""Inventory every question the live catalogue ships, and what it needs drawn.

The visual system was built for mathematics and then asked to serve science, so
the vocabulary grew from guesses about what science questions look like. This
script replaces the guessing: it walks the real Kata catalogue, dumps every
question, and classifies each one by the KIND of picture it needs — a measured
quantity, a procedure, a before/after, a labelled structure.

The classification is deliberately deterministic (keyword + numeric shape, no
LLM). It has to give the same answer twice so the counts can be compared across
runs, and it costs nothing to run on the whole catalogue.

Output feeds two things: which archetypes to build first, and the acceptance
corpus for the visual tests.

    python scripts/content_survey.py
    python scripts/content_survey.py --json artifacts/content-survey.json
"""

from __future__ import annotations

import argparse
import asyncio
from collections import Counter
import json
from pathlib import Path
import re
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(Path(__file__).resolve().parents[1] / ".env")


# A number carrying a unit is the strongest signal in the catalogue: it means the
# question is about a QUANTITY, and the picture must show that exact quantity.
_UNITS = r"גרם|ג'|ק\"?ג|קילוגרם|מ\"?ל|מיליליטר|ליטר|סמ\"?ק|ס\"?מ|מ\"?מ|מטר|מעלות|°|שניות|דקות"
_MEASURED_VALUE = re.compile(rf"(\d+(?:[.,]\d+)?)\s*(?:{_UNITS})")
_BARE_NUMBER = re.compile(r"\d+(?:[.,]\d+)?")

# Each archetype is described by the question shapes that need it. Ordered:
# the first match wins, so the more specific shapes are listed first. A word like
# "מוצק" appears in half the measurement questions, so state-of-matter is checked
# late and only on language that is actually ABOUT the state.
_ARCHETYPE_SIGNALS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("flow", re.compile(r"סדרו|לפי הסדר|סדר הנכון|שלבי|שלבים|סדר הפעולות|תהליך")),
    ("target_board", re.compile(r"מטר(?:ה|ות) קליעה|חיצים|מדויק.*מהימן|מהימן.*מדויק")),
    ("readout", re.compile(r"מאזני|משקל|שקילה|מדחום|סרגל|כפתור האיפוס|הצג|מחוון|תצוגה|אפס")),
    ("matching", re.compile(r"גררו|התאימו|חברו בין")),
    ("particle_state", re.compile(r"מצב(?:י)? צבירה|חלקיק|אדים|התאדות|התכה|קיפאון|המסה של גז")),
    ("comparison", re.compile(r"השווא|לעומת|מי מ|איזה מהם|יותר|פחות|הבדל|שונה|חריג|זהה|שווה")),
    ("callout", re.compile(r"חלקי|מבנה|רכיב|איבר|תא\b|שם החלק|היכן נמצא|סמן על")),
    ("cycle", re.compile(r"מחזור|חוזר על עצמו|מעגל(?: החיים)?")),
    ("hierarchy", re.compile(r"מיין|סווג|שייך|קבוצ|סוג(?:י)?\b|משפח")),
    ("geometry", re.compile(r"משולש|זווית|מעגל|מרובע|שטח|היקף|גרף|פונקצי|ציר|קוטר|רדיוס")),
    ("timeline", re.compile(r"ציר זמן|שנה|תקופ|היסטורי")),
)

# Archetypes that a series of readings should override: the picture has to show
# the VALUES, whatever vocabulary the sentence happened to use around them.
_VALUE_DOMINATED = {"comparison", "hierarchy", "matching", "particle_state", "none"}


def _classify(text: str) -> tuple[str, list[str]]:
    """Return (archetype, measured values) for one question's text."""
    values = [match.group(0) for match in _MEASURED_VALUE.finditer(text)]
    series = len(_BARE_NUMBER.findall(text)) >= 3 and bool(values)
    for name, pattern in _ARCHETYPE_SIGNALS:
        if pattern.search(text):
            if series and name in _VALUE_DOMINATED:
                return "measurement_series", values
            return name, values
    return ("measurement_series" if series else "none"), values


async def collect() -> list[dict]:
    from app.services import kata_catalog as kc

    await kc.ensure_loaded()
    rows: list[dict] = []
    for subject in kc.subjects():
        for objective in kc.objectives_for(subject):
            objective_id = objective.get("id")
            for component in kc.components_for(objective_id):
                component_id = component.get("id")
                for item in kc.item_profiles(component_id):
                    if not item.get("question_count"):
                        continue
                    for question in kc.questions_for_item(component_id, item["id"]):
                        text = (question.get("questionText") or "").strip()
                        if not text:
                            continue
                        archetype, values = _classify(text)
                        rows.append({
                            "subject": subject,
                            "objective_id": objective_id,
                            "objective": kc.localized_objective_title(objective_id, "he"),
                            "component_id": component_id,
                            "component": component.get("title") or "",
                            "cognitive_level": component.get("cognitive_level") or "",
                            "item_id": item["id"],
                            "item_title": item.get("title") or "",
                            "content_type": item.get("content_type") or "",
                            "media_format": item.get("media_format") or "",
                            "question_id": question.get("questionId") or "",
                            "question": text,
                            "answers": question.get("answers") or [],
                            "correct": question.get("correctAnswers") or [],
                            "archetype": archetype,
                            "measured_values": values,
                            "has_bare_numbers": bool(_BARE_NUMBER.search(text)),
                        })
    return rows


def report(rows: list[dict]) -> str:
    lines = [f"# Content survey — {len(rows)} questions", ""]

    by_subject = Counter(row["subject"] for row in rows)
    lines += ["## Subjects", ""]
    lines += [f"- `{name}` — {count}" for name, count in by_subject.most_common()]

    by_archetype = Counter(row["archetype"] for row in rows)
    lines += ["", "## Visual archetype needed", ""]
    lines += [f"- `{name}` — {count}" for name, count in by_archetype.most_common()]

    grounded = [row for row in rows if row["measured_values"]]
    lines += [
        "",
        "## Grounding",
        "",
        f"- {len(grounded)} questions carry an explicit measured value; any visual for "
        "these must reproduce those exact values.",
        f"- {sum(1 for r in rows if r['has_bare_numbers'])} carry some number.",
    ]

    lines += ["", "## Questions", ""]
    for subject in sorted({row["subject"] for row in rows}):
        lines += [f"### {subject}", ""]
        for row in [r for r in rows if r["subject"] == subject]:
            values = f" · values: {', '.join(row['measured_values'])}" if row["measured_values"] else ""
            lines += [
                f"- **[{row['archetype']}]** {row['question']}",
                f"  - `{row['component_id']}` / `{row['item_id']}` / `{row['question_id']}`{values}",
            ]
            if row["answers"]:
                lines += [f"  - options: {' | '.join(str(a) for a in row['answers'])}"]
        lines += [""]
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--json", type=Path, help="also write the raw rows here")
    parser.add_argument("--out", type=Path, help="write the markdown report here")
    args = parser.parse_args()

    rows = asyncio.run(collect())
    if not rows:
        raise SystemExit("no questions returned — is KATA_API_KEY set in backend/.env?")

    text = report(rows)
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(text, encoding="utf-8")
        print(f"✓ report → {args.out}")
    else:
        print(text)
    if args.json:
        args.json.parent.mkdir(parents=True, exist_ok=True)
        args.json.write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"✓ rows → {args.json}")


if __name__ == "__main__":
    main()
