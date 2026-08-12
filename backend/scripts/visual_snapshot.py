"""Prove a refactor of the visual pipeline changed nothing.

`sanitize_scene` and the SVG renderer are being split out of one 2,000-line
module into a package. That is a pure move, so the only acceptable outcome is
byte-identical output on every case the corpus knows about — and "I ran the
tests" does not show that, because the tests assert properties rather than
exact bytes.

    python scripts/visual_snapshot.py --write artifacts/visual-snapshot.json
    python scripts/visual_snapshot.py --check artifacts/visual-snapshot.json
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def _digest(value: object) -> str:
    return hashlib.sha256(
        json.dumps(value, ensure_ascii=False, sort_keys=True, default=str).encode("utf-8")
    ).hexdigest()


def snapshot() -> dict[str, dict[str, str]]:
    from app.agents.manim_visual import _svg_fallback, sanitize_scene
    from tests.visual_corpus import CORPUS

    rows: dict[str, dict[str, str]] = {}
    for case in CORPUS:
        scene = sanitize_scene(case.raw)
        entry = {"scene": _digest(scene)}
        if scene is not None:
            entry["svg"] = hashlib.sha256(_svg_fallback(scene)).hexdigest()
        rows[case.id] = entry
    return rows


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", type=Path)
    parser.add_argument("--check", type=Path)
    args = parser.parse_args()

    current = snapshot()
    if args.write:
        args.write.parent.mkdir(parents=True, exist_ok=True)
        args.write.write_text(json.dumps(current, indent=1, sort_keys=True), encoding="utf-8")
        print(f"✓ {len(current)} cases → {args.write}")
        return

    if not args.check:
        raise SystemExit("pass --write or --check")
    baseline = json.loads(args.check.read_text(encoding="utf-8"))
    drifted = sorted(
        case for case in set(baseline) | set(current)
        if baseline.get(case) != current.get(case)
    )
    for case in drifted:
        print(f"✗ {case}\n    was {baseline.get(case)}\n    now {current.get(case)}")
    print(f"{len(current) - len(drifted)}/{len(current)} identical")
    raise SystemExit(1 if drifted else 0)


if __name__ == "__main__":
    main()
