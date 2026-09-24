#!/usr/bin/env python3
"""Which lesson players qualify for the tall-frame experiment?

    python scripts/tall_frame_report.py [--out-dir content/context] [--json]

Reads the committed shards only (no network). The nightly walker probes every
v8 screen at its natural content height (content-extract.mjs "tall probes":
does a frame as tall as the content show the SAME geometry, with no inner
scroll?). Per player host this reports how its captured screens behave and
whether the host qualifies:

- at least ``--min-screens`` v8 screens captured;
- at least 95% of them height-independent;
- every tall probe of those screens: same geometry, no inner scroll.

A qualifying host is a CANDIDATE for ``LESSON_TALL_FRAME_HOSTS`` — it is
added after a person has reviewed the content_audit.py gallery for it.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services import content_intelligence as ci  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]
SHARE = 0.95


def host_report(shards: list[dict[str, Any]], min_screens: int) -> dict[str, Any]:
    hosts: dict[str, dict[str, Any]] = defaultdict(lambda: {
        "screens": 0, "kinds": defaultdict(int), "tall_probes": 0, "tall_failures": 0})
    for shard in shards:
        for lomda in shard.get("lomdot") or []:
            host = str((lomda.get("extraction") or {}).get("player_host") or "?")
            for slide in lomda.get("slides") or []:
                enrichment = slide.get("enrichment") or {}
                if enrichment.get("capture_version") != 8:
                    continue
                layout = enrichment.get("layout") or {}
                row = hosts[host]
                row["screens"] += 1
                row["kinds"][layout.get("kind") or "unknown"] += 1
                if layout.get("kind") == "height_independent":
                    for probe in layout.get("tall") or []:
                        row["tall_probes"] += 1
                        if not probe.get("same_geometry") or probe.get("inner_scroll"):
                            row["tall_failures"] += 1
    out = {}
    for host, row in sorted(hosts.items()):
        independent = row["kinds"].get("height_independent", 0)
        share = independent / row["screens"] if row["screens"] else 0.0
        qualifies = (row["screens"] >= min_screens and share >= SHARE
                     and row["tall_probes"] > 0 and row["tall_failures"] == 0)
        out[host] = {"screens": row["screens"], "kinds": dict(row["kinds"]),
                     "height_independent_share": round(share, 3),
                     "tall_probes": row["tall_probes"], "tall_failures": row["tall_failures"],
                     "qualifies": qualifies}
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out-dir", default=str(REPO_ROOT / "content" / "context"))
    parser.add_argument("--min-screens", type=int, default=10)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    shards = [json.loads(p.read_text(encoding="utf-8")) for p in ci.shard_paths(Path(args.out_dir))]
    report = host_report(shards, args.min_screens)
    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 0
    for host, row in report.items():
        flag = "✅ candidate" if row["qualifies"] else "—"
        print(f"{host:40} v8 screens {row['screens']:>4} · height-independent "
              f"{row['height_independent_share']:.0%} · tall probes {row['tall_probes']} "
              f"({row['tall_failures']} failed) · {flag}")
    candidates = [h for h, r in report.items() if r["qualifies"]]
    print(f"\nLESSON_TALL_FRAME_HOSTS candidates (after a gallery review): {','.join(candidates) or '—'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
