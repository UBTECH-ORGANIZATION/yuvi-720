"""Render the 720 tender documents to Hebrew RTL PDFs.

Two stages: Markdown → styled RTL HTML here, then HTML → PDF via Playwright
(`scripts/html_to_pdf.mjs`), because the repo already ships Chromium and no
other PDF engine is installed.

The page style deliberately follows the MoE usability guidance the documents
themselves cite — sans-serif face, body text at 12pt, live text rather than
images, and a real heading hierarchy — so the submission does not contradict
its own accessibility declaration.

Usage:
    ./backend/.venv/bin/python scripts/build_tender_pdfs.py
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import markdown

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs" / "720" / "tender-english"
STAGE = ROOT / ".tender-build"

CSS = """
@page { size: A4; margin: 20mm 18mm; }
html { direction: rtl; }
body {
  font-family: Arial, "Helvetica Neue", Helvetica, sans-serif;
  font-size: 12pt;
  line-height: 1.65;
  color: #111;
  margin: 0;
}
h1 { font-size: 20pt; margin: 0 0 4pt; color: #0f2f5f; }
h2 { font-size: 15pt; margin: 20pt 0 6pt; color: #0f2f5f;
     border-bottom: 1px solid #c9d6e8; padding-bottom: 3pt; }
h3 { font-size: 13pt; margin: 14pt 0 4pt; color: #123; }
h2, h3, table, tr { break-inside: avoid; }
h1, h2, h3 { break-after: avoid; }
p, li { font-size: 12pt; }
ul, ol { padding-inline-start: 20pt; }
table { border-collapse: collapse; width: 100%; margin: 8pt 0; font-size: 11pt; }
th, td { border: 1px solid #b9c6d8; padding: 5pt 7pt; text-align: start;
         vertical-align: top; }
th { background: #eef3fa; font-weight: bold; }
tr:nth-child(even) td { background: #fafbfd; }
hr { border: 0; border-top: 1px solid #d8e0ec; margin: 16pt 0; }
code { font-family: "SF Mono", Menlo, Consolas, monospace; font-size: 11pt;
       background: #f2f4f8; padding: 1pt 3pt; border-radius: 3px;
       direction: ltr; display: inline-block; }
blockquote { border-inline-start: 3px solid #c9d6e8; margin: 8pt 0;
             padding: 4pt 12pt; color: #333; background: #f7f9fc; }
a { color: #14508c; word-break: break-all; }
strong { font-weight: bold; }
"""

TEMPLATE = """<!DOCTYPE html>
<html lang="he" dir="rtl">
<head><meta charset="utf-8"><title>{title}</title><style>{css}</style></head>
<body>{body}</body>
</html>
"""


def main() -> int:
    sources = sorted(DOCS.glob("*.md"))
    if not sources:
        print("no markdown sources found", file=sys.stderr)
        return 1

    STAGE.mkdir(exist_ok=True)
    for stale in STAGE.glob("*.html"):
        stale.unlink()

    for source in sources:
        html_body = markdown.markdown(
            source.read_text(encoding="utf-8"),
            extensions=["tables", "sane_lists", "attr_list"],
        )
        target = STAGE / f"{source.stem}.html"
        target.write_text(
            TEMPLATE.format(title=source.stem, css=CSS, body=html_body),
            encoding="utf-8",
        )
        print(f"  html  {target.name}")

    # Lives under frontend/ because node resolves `playwright` relative to the
    # script's own path, and that is the only node_modules in the repo.
    result = subprocess.run(
        ["node", str(ROOT / "frontend" / "scripts" / "html_to_pdf.mjs"), str(STAGE), str(DOCS)],
        cwd=ROOT / "frontend",
    )
    return result.returncode


if __name__ == "__main__":
    raise SystemExit(main())
