"""Extract a page range from a source book PDF into per-page PNG + raw text.

Dev-only tool for building the internal book knowledge base under
docs/720/en-books/. Requires pymupdf, which is deliberately NOT a runtime
dependency - install it in a throwaway venv:

    python3 -m venv /tmp/pdfenv && /tmp/pdfenv/bin/pip install pymupdf
    /tmp/pdfenv/bin/python backend/scripts/extract_book_pages.py \
        --pdf "docs/720-en-books/Up We Go SB.pdf" \
        --out docs/720/en-books/up-we-go-sb \
        --first 10 --last 24
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path


def printed_page_number(page) -> int | None:
    """Read the printed folio from the page footer, if present."""
    height = page.rect.height
    for block in page.get_text("blocks"):
        y0, text = block[1], block[4].strip()
        if y0 > height * 0.88 and re.fullmatch(r"\d{1,3}", text):
            return int(text)
    return None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pdf", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--first", required=True, type=int, help="First printed page number.")
    parser.add_argument("--last", required=True, type=int, help="Last printed page number.")
    parser.add_argument("--offset", type=int, default=0, help="printed page = pdf page index + 1 + offset")
    parser.add_argument("--dpi", type=int, default=160)
    args = parser.parse_args()

    try:
        import pymupdf
    except ImportError:
        print("pymupdf is not installed. See the module docstring.", file=sys.stderr)
        return 2

    doc = pymupdf.open(args.pdf)
    assets = args.out / "assets"
    raw = args.out / "raw-text"
    assets.mkdir(parents=True, exist_ok=True)
    raw.mkdir(parents=True, exist_ok=True)

    mismatches: list[str] = []
    for printed in range(args.first, args.last + 1):
        index = printed - 1 - args.offset
        if not 0 <= index < doc.page_count:
            print(f"page {printed} maps outside the document", file=sys.stderr)
            return 1
        page = doc[index]

        found = printed_page_number(page)
        if found is not None and found != printed:
            mismatches.append(f"pdf#{index + 1}: expected folio {printed}, found {found}")

        stem = f"p{printed:03d}"
        page.get_pixmap(dpi=args.dpi).save(assets / f"{stem}.png")
        (raw / f"{stem}.txt").write_text(page.get_text(), encoding="utf-8")
        print(f"{stem}  <- pdf#{index + 1}")

    if mismatches:
        print("\nfolio mismatches (check --offset):", file=sys.stderr)
        for line in mismatches:
            print(f"  {line}", file=sys.stderr)
        return 1

    print(f"\nwrote {args.last - args.first + 1} pages to {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
