#!/usr/bin/env python3
"""Fill in catalogue names the content vendor ships in one language only.

    python scripts/translate_catalog.py --report        # what is missing
    python scripts/translate_catalog.py --dry-run       # what it would write
    python scripts/translate_catalog.py                 # write them

## Why this is a script and not a request-time call

`catalog_i18n.title()` is called on every row of every teacher screen. It is
synchronous by design and must never await, never cost, and never invent. So
translation is a **deliberate act with an operator behind it**, run when the
catalogue changes, and its output is reviewable in one collection.

## What it will not do

- It never touches a row the vendor already translated. Their Arabic name is
  the published one; a second, generated name for the same lesson is worse than
  no name.
- It never translates a title that IS an id (`CET.MATH.G7…`). That is not a
  name, and a translated identifier is an identifier nobody can search for.
- It never invents subject matter. The prompt is given the source string and
  the unit it belongs to, and is told to transliterate rather than guess when a
  term has no accepted translation.

Mini tier: these are lesson names, not pedagogy, and a 14-row catalogue costs
about one cent to translate completely.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import server  # noqa: F401  — loads .env before anything reads it

from app.services import catalog_i18n, kata_catalog
from app.services.ai_usage import UsageContext
from app.services.llm import call_llm

#: Small enough that one bad row cannot spoil a whole run, large enough that a
#: full catalogue is a handful of calls.
BATCH = 12

LOCALE_NAMES = {"he": "Hebrew", "ar": "Arabic", "en": "English"}

PROMPT = """You translate the NAMES of school learning materials for an Israeli
Ministry of Education platform. Middle-school maths and science.

Rules:
- Translate the NAME only. Do not explain it, expand it, or add a subtitle.
- Keep it the length of a title. These render in a list, not in a paragraph.
- Keep numbering and lettering exactly as it is ("תרגול בסיסי 2" -> "... 2").
- Keep mathematical notation as notation. Do not spell formulas out in words.
- Use the accepted curriculum term in the target language. If a term has no
  accepted translation, transliterate rather than invent one.
- Never translate an identifier (anything that looks like CET.MATH.G7...). If a
  name is an identifier, return it unchanged.

Return JSON only:
{"rows": [{"id": "<the id given>", "titles": {"<locale>": "<name>"}}]}
Include only the locales asked for on each row."""


def _ask(rows: list[dict]) -> str:
    lines = []
    for row in rows:
        wanted = ", ".join(f"{code} ({LOCALE_NAMES[code]})" for code in row["missing"])
        context = f"  (part of: {row['context']})" if row.get("context") else ""
        lines.append(
            f'- id: {row["id"]}\n'
            f'  kind: {row["kind"]}\n'
            f'  name: {row["source_text"]}{context}\n'
            f"  translate into: {wanted}"
        )
    return "Translate these names.\n\n" + "\n".join(lines)


async def _translate(rows: list[dict], *, actor: str) -> dict[str, dict[str, str]]:
    raw = await call_llm(
        [{"role": "system", "content": PROMPT},
         {"role": "user", "content": _ask(rows)}],
        usage_context=UsageContext(
            actor_id=actor, actor_type="system",
            endpoint="script:translate_catalog", feature="feature_6_teacher_view",
            operation="catalog.translate_titles", source="translate_catalog",
        ),
        max_tokens=1200, json_mode=True, model_tier="mini",
    )
    try:
        payload = json.loads(raw or "{}")
    except (TypeError, ValueError):
        print("  ⚠️ unparseable response, skipping this batch")
        return {}

    wanted = {row["id"]: set(row["missing"]) for row in rows}
    out: dict[str, dict[str, str]] = {}
    for entry in (payload.get("rows") or []):
        if not isinstance(entry, dict):
            continue
        row_id = str(entry.get("id") or "")
        if row_id not in wanted:
            # A model that renames the row it was given cannot be matched back
            # to a catalogue id, and guessing which row it meant is how a
            # lesson ends up with another lesson's name.
            continue
        titles = {
            locale: str(text).strip()
            for locale, text in (entry.get("titles") or {}).items()
            if locale in wanted[row_id] and str(text or "").strip()
        }
        if titles:
            out[row_id] = titles
    return out


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report", action="store_true", help="print coverage and exit")
    parser.add_argument("--dry-run", action="store_true", help="translate but do not store")
    parser.add_argument("--kind", choices=catalog_i18n.KINDS, help="only this kind")
    parser.add_argument("--actor", default="system", help="who to bill the calls to")
    args = parser.parse_args()

    await kata_catalog.ensure_loaded(force=True)
    rows = kata_catalog.translatable_rows()
    if args.kind:
        rows = [row for row in rows if row["kind"] == args.kind]

    total = len(rows) * len(catalog_i18n.LOCALES)
    missing = catalog_i18n.gaps(rows)
    gap_count = sum(len(row["missing"]) for row in missing)

    print(f"catalogue rows: {len(rows)}  ·  names needed: {total}  "
          f"·  missing: {gap_count}  ·  stored already: {catalog_i18n.loaded_count()}")
    by_kind: dict[str, int] = {}
    for row in missing:
        by_kind[row["kind"]] = by_kind.get(row["kind"], 0) + len(row["missing"])
    for kind, count in sorted(by_kind.items()):
        print(f"  {kind}: {count} missing")

    if args.report:
        for row in missing:
            print(f"  · [{row['kind']}] {row['source_text']}  →  {', '.join(row['missing'])}")
        return 0
    if not missing:
        print("nothing to do")
        return 0

    written = 0
    for start in range(0, len(missing), BATCH):
        batch = missing[start:start + BATCH]
        print(f"\ntranslating {start + 1}–{start + len(batch)} of {len(missing)}…")
        translated = await _translate(batch, actor=args.actor)
        for row in batch:
            titles = translated.get(row["id"])
            if not titles:
                print(f"  ✘ no translation returned: {row['source_text']}")
                continue
            print(f"  ✔ {row['source_text']}")
            for locale, text in titles.items():
                print(f"      {locale}: {text}")
            if not args.dry_run:
                await catalog_i18n.put(
                    row["kind"], row["id"], source_text=row["source_text"],
                    titles=titles, model="mini",
                )
                written += 1

    print(f"\n{'would write' if args.dry_run else 'wrote'} {written} rows")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
