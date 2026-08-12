"""Names for catalogue material in all three languages the product speaks.

## What the vendor actually ships

Measured against the live Kata catalogue (11/08/26), `titleTranslations`
coverage is partial and inconsistent *within the same payload*:

    curriculum level        he · ar · en      ✅
    subject area / topic /
      sub-topic level       he only
    learning unit           CET rows he·ar·en; methodica rows: `{}`
    component ("learning")  the field is `null` on every row
    objective description   he only

So a Hebrew-only name is the normal case, not an error, and there is no version
of "read harder" that fixes it — for most rows the other two languages have
never been written down.

Two separate problems were behind "Writing coordinates of a point" appearing as
a lesson name in a Hebrew UI, and only one of them was missing data:

1. **A mapping bug** (fixed in `kata_client.title_translations`): Kata keys the
   field by locale code and we looked the keys up in the language-LABEL map, so
   a unit that *did* ship Hebrew came back with an empty map and fell through to
   its flat English machine label.
2. **Genuinely absent translations**, which is what this module is for.

## The ladder, and why the model never runs at read time

    vendor translation  →  a stored, reviewed translation  →  the source string

Reading a title is synchronous and happens hundreds of times per screen render;
it must never await, never cost, and never invent. So the fill pass is a
**script** (`scripts/translate_catalog.py`) that writes rows into
`catalog_translations`, and this module only ever reads them.

A stored row carries the `source_text` it was translated FROM. When the vendor
renames a lesson the stored translation stops matching and is ignored — a
renamed lesson showing its old name in Arabic is worse than showing its new one
in Hebrew, because the second is visibly untranslated and the first is wrong.
"""

from __future__ import annotations

from datetime import datetime, timezone
import re
from typing import Any, Iterable, Optional

from app.brain.repository import _get_collection_named

COLLECTION = "catalog_translations"

#: The three the product speaks. Not derived from the catalogue: a locale we
#: have no UI for is not a locale we should be paying to translate into.
LOCALES = ("he", "ar", "en")

#: What can be named. `objective` is the sub-topic display title — the string
#: `kata_catalog.objective_title` returns — not the pedagogical description.
KINDS = ("unit", "component", "objective")

#: locale-keyed titles per "{kind}:{id}", primed alongside the catalogue.
_STORED: dict[str, dict[str, Any]] = {}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def key_for(kind: str, catalog_id: str) -> str:
    return f"{kind}:{catalog_id}"


#: Hebrew and Arabic blocks. Enough to tell which language a NAME is in —
#: these are titles, not prose, and a Hebrew title contains Hebrew letters.
_HEBREW = re.compile(r"[֐-׿]")
_ARABIC = re.compile(r"[؀-ۿݐ-ݿ]")


def source_locale_of(text: str) -> str:
    """Which of our three languages this name is already written in.

    The vendor does not declare it, and it is not always Hebrew: the CET rows
    carry English machine labels while the methodica rows carry Hebrew. Getting
    this wrong costs a model call to translate Hebrew into Hebrew and stores
    the result as though it were a translation.
    """
    if _HEBREW.search(text or ""):
        return "he"
    if _ARABIC.search(text or ""):
        return "ar"
    return "en"


def _normalize(text: Any) -> str:
    """Compare source strings the way a human would, not byte for byte —
    the vendor re-exports with different trailing whitespace routinely, and a
    re-export is not a rename."""
    return " ".join(str(text or "").split())


# ── read (sync, snapshot-backed) ─────────────────────────────────────────────

def title(
    kind: str,
    catalog_id: Optional[str],
    locale: str,
    *,
    vendor: Optional[dict[str, str]] = None,
    fallback: Optional[str] = None,
) -> Optional[str]:
    """The best name for this row in this locale, or ``None``.

    The vendor always wins: their Arabic name for a lesson is the one the
    ministry published, and a generated one that disagrees with it is a second
    name for the same thing.
    """
    vendor_title = (vendor or {}).get(locale)
    if vendor_title and str(vendor_title).strip():
        return str(vendor_title).strip()

    if catalog_id:
        row = _STORED.get(key_for(kind, catalog_id))
        if row and (not fallback or _normalize(row.get("source_text")) == _normalize(fallback)):
            stored = (row.get("titles") or {}).get(locale)
            if stored and str(stored).strip():
                return str(stored).strip()

    return str(fallback).strip() if fallback and str(fallback).strip() else None


def is_translated(kind: str, catalog_id: str, locale: str, *, source_text: str) -> bool:
    """Whether this row has a locale-specific name — vendor or stored.

    Used by the fill script to decide what to spend on, and by the report to
    say how much of the catalogue is actually multilingual.
    """
    row = _STORED.get(key_for(kind, catalog_id))
    if not row or _normalize(row.get("source_text")) != _normalize(source_text):
        return False
    return bool(str((row.get("titles") or {}).get(locale) or "").strip())


def loaded_count() -> int:
    return len(_STORED)


# ── load / write ─────────────────────────────────────────────────────────────

async def load() -> None:
    """Prime the read snapshot. Called from `kata_catalog.ensure_loaded`.

    A failure here is never fatal: without stored translations every name falls
    back to the vendor's own string, which is exactly the behaviour before this
    module existed.
    """
    collection = _get_collection_named(COLLECTION)
    if collection is None:
        return
    try:
        rows = [row async for row in collection.find({})]
    except Exception as exc:
        print(f"⚠️ catalog translations unavailable: {type(exc).__name__}")
        return
    _STORED.clear()
    for row in rows:
        row_id = str(row.get("_id") or "")
        if row_id:
            _STORED[row_id] = row


async def put(
    kind: str,
    catalog_id: str,
    *,
    source_text: str,
    titles: dict[str, str],
    model: str = "",
) -> dict[str, Any]:
    """Store (or replace) one row's translations. The fill script's only write.

    Merges rather than replaces: a run that fills Arabic must not drop an
    English name a previous run wrote, and a partial model response must not
    erase what is already good.
    """
    if kind not in KINDS:
        raise ValueError(f"unknown kind: {kind!r}")
    row_id = key_for(kind, catalog_id)
    existing = _STORED.get(row_id) or {}
    keep = (existing.get("titles") or {}) \
        if _normalize(existing.get("source_text")) == _normalize(source_text) else {}

    clean = {
        locale: str(value).strip()
        for locale, value in (titles or {}).items()
        if locale in LOCALES and str(value or "").strip()
    }
    document = {
        "_id": row_id,
        "kind": kind,
        "catalog_id": catalog_id,
        "source_text": str(source_text or "").strip(),
        "titles": {**keep, **clean},
        "model": model,
        "translated_at": _now(),
    }
    collection = _get_collection_named(COLLECTION)
    if collection is not None:
        try:
            await collection.replace_one({"_id": row_id}, document, upsert=True)
        except Exception as exc:
            print(f"⚠️ could not store translation {row_id}: {type(exc).__name__}")
    _STORED[row_id] = document
    return document


# ── coverage ─────────────────────────────────────────────────────────────────

def gaps(rows: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    """Which of these catalogue rows still has no name in which locale.

    `rows` are `{kind, id, source_text, vendor}` — the shape both the fill
    script and the coverage report build from the live snapshot, so the two can
    never disagree about what counts as missing.
    """
    out: list[dict[str, Any]] = []
    for row in rows:
        kind, catalog_id = str(row.get("kind") or ""), str(row.get("id") or "")
        source = str(row.get("source_text") or "").strip()
        if not kind or not catalog_id or not source:
            continue
        vendor = row.get("vendor") or {}
        native = source_locale_of(source)
        missing = [
            locale for locale in LOCALES
            # The language the name is already written in is not missing. The
            # fallback leg of the ladder serves it verbatim.
            if locale != native
            and not str(vendor.get(locale) or "").strip()
            and not is_translated(kind, catalog_id, locale, source_text=source)
        ]
        if missing:
            out.append({**row, "source_locale": native, "missing": missing})
    return out
