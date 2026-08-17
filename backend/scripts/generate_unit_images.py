"""Draw the pictures a unit asks for, once, and commit them beside the content.

    .venv/bin/python scripts/generate_unit_images.py ENG.G7.FAMILY.VOCAB [--force]
    .venv/bin/python scripts/generate_unit_images.py --all --dry-run

An author writes a ``media`` node as a ``prompt`` and an ``alt``; this fills in
``src``/``srcset``/``width``/``height``. The generated files are committed with
the unit that references them, because this content is FIXED — eleven units that
change rarely and are reviewed by a ministry. Generating at runtime would mean
paying for, and waiting on, a model call to redraw the same grandmother for
every learner, and it would mean two learners could see different pictures of
the same question.

The filename carries a hash of the prompt, so a rerun is free unless the prompt
actually changed, and a changed prompt lands on a new URL — which is what makes
it safe to serve these `immutable` for a year.
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import hashlib
import io
import json
import os
import re
import sys
from pathlib import Path
from typing import Any, Iterator, Optional

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.env import ensure_env_loaded  # noqa: E402

ensure_env_loaded()

CONTENT_DIR = Path(__file__).resolve().parents[1] / "content" / "english"
ASSETS_DIR = CONTENT_DIR / "assets"

#: Rendered widths. 960 is the largest a picture is ever painted at (a full-width
#: card on a laptop); 1440 covers a 2× phone, 480 a 1× one. Anything bigger is
#: bytes a learner on a school connection waits for and never sees.
WIDTHS = (480, 960, 1440)

MODEL = os.environ.get("APIM_IMAGE_MODEL", "gpt-image-1.5")
SIZE = "1024x1024"
QUALITY = "medium"

#: The house style, applied to every prompt. It is here rather than in the
#: content because it is a decision about the product, not about the picture:
#: eleven units have to look like one product, and an author writing the twelfth
#: should not have to remember the wording. The audience is grades 7-9, so the
#: look is a mature editorial illustration — a rounded-cartoon style reads as a
#: primary-school book to a thirteen-year-old.
STYLE = (
    "Contemporary editorial illustration for teenagers, semi-realistic, "
    "natural human proportions and believable anatomy, soft natural lighting, "
    "muted modern palette with indigo and teal accents, subtle texture, "
    "clean uncluttered composition, calm and grounded mood — NOT a children's "
    "cartoon, no oversized heads, no thick outlines. "
    "If people appear, draw ordinary teenagers and adults of varied skin tones in plain "
    "modern everyday clothes — t-shirts, jumpers, trousers, simple dresses. "
    "NO religious clothing of any kind, NO head coverings, NO head scarves, NO skullcaps, "
    "NO religious symbols or jewellery, NO national or cultural markers. "
    "Draw ONLY what the description asks for and add no one who is not in it. "
    "NO text, NO letters, NO numbers, NO speech bubbles, NO labels anywhere in the image. "
    "NO multiple panels, NO grid, NO collage, NO answer options — a single scene only."
)


def _client():
    from openai import AsyncAzureOpenAI

    # Images are a SEPARATE APIM API from chat: `/images`, not `/openai`. Falling
    # back to APIM_BASE_URL looks like it works and then 404s on every call, so
    # it is not offered as a fallback at all.
    endpoint = os.environ.get("APIM_IMAGE_ENDPOINT") or ""
    key = os.environ.get("APIM_IMAGE_API_KEY") or os.environ.get("APIM_SUBSCRIPTION_KEY") or ""
    if not endpoint or not key:
        raise SystemExit("✗ set APIM_IMAGE_ENDPOINT and APIM_IMAGE_API_KEY in backend/.env")
    return AsyncAzureOpenAI(
        azure_endpoint=endpoint.rstrip("/"),
        api_key=key,
        # Images need the preview surface; the chat version does not serve them.
        api_version=os.environ.get("APIM_IMAGE_API_VERSION", "2025-04-01-preview"),
    )


def media_nodes(unit: dict[str, Any]) -> Iterator[tuple[str, dict[str, Any]]]:
    """Every image a unit declares, with a label for the console."""
    for component in unit.get("components") or []:
        for item in component.get("subContent") or []:
            presentation = item.get("presentation") or {}
            if isinstance(presentation.get("image"), dict):
                yield f"{item['id']} · screen", presentation["image"]
            for question in item.get("questions") or []:
                qid = question.get("questionId")
                if isinstance(question.get("image"), dict):
                    yield f"{item['id']}/{qid} · question", question["image"]
                for answer, node in (question.get("answerMedia") or {}).items():
                    if isinstance(node, dict):
                        yield f"{item['id']}/{qid} · option {answer!r}", node
                for prompt in question.get("prompts") or []:
                    if isinstance(prompt, dict) and isinstance(prompt.get("media"), dict):
                        yield f"{item['id']}/{qid} · prompt {prompt.get('id')}", prompt["media"]


def _slug(label: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", label.lower()).strip("-")[:48] or "image"


def _stamp(prompt: str) -> str:
    """Identity of a picture IS its prompt. Same words, same file, no redraw."""
    return hashlib.sha1(f"{STYLE}\n{prompt}".encode()).hexdigest()[:8]


def _write_variants(png: bytes, out_dir: Path, base: str) -> tuple[str, str, int, int]:
    """One PNG in, a WebP ladder plus a JPEG fallback out.

    Returns ``(src, srcset, width, height)`` — `src` is the JPEG, so a browser
    that has never heard of WebP still shows the picture rather than a gap.
    """
    from PIL import Image

    out_dir.mkdir(parents=True, exist_ok=True)
    source = Image.open(io.BytesIO(png)).convert("RGB")
    entries: list[str] = []
    for width in WIDTHS:
        if width > source.width:
            continue
        height = round(source.height * width / source.width)
        resized = source.resize((width, height), Image.LANCZOS)
        name = f"{base}-{width}.webp"
        resized.save(out_dir / name, "WEBP", quality=82, method=6)
        entries.append(f"{out_dir.name}/{name} {width}w")

    fallback = f"{base}.jpg"
    widest = min(max(WIDTHS), source.width)
    height = round(source.height * widest / source.width)
    source.resize((widest, height), Image.LANCZOS).save(
        out_dir / fallback, "JPEG", quality=82, optimize=True, progressive=True)
    return f"{out_dir.name}/{fallback}", ", ".join(entries), widest, height


def _relink(unit_id: str, unit: dict[str, Any], path: Path) -> int:
    """Point the content at pictures that are already on disk.

    A drawn file whose unit never got patched is an orphan: bytes in git that
    nothing references, and a screen with no picture. Rather than pay to redraw
    what already exists, match each prompt to the file its own hash names.
    """
    out_dir = ASSETS_DIR / unit_id
    linked = 0
    for _label, node in media_nodes(unit):
        if not node.get("prompt") or node.get("src"):
            continue
        stamp = _stamp(node["prompt"])
        jpeg = next((f for f in sorted(out_dir.glob(f"*-{stamp}.jpg"))), None)
        if jpeg is None:
            continue
        from PIL import Image

        with Image.open(jpeg) as image:
            node["width"], node["height"] = image.width, image.height
        node["src"] = f"{out_dir.name}/{jpeg.name}"
        node["srcset"] = ", ".join(
            f"{out_dir.name}/{f.name} {f.stem.rsplit('-', 1)[-1]}w"
            for f in sorted(out_dir.glob(f"*-{stamp}-*.webp"),
                            key=lambda f: int(f.stem.rsplit("-", 1)[-1]))
        )
        linked += 1
    if linked:
        _patch(path, unit)
    print(f"  relinked {linked} existing picture(s)")
    return 0


async def generate(unit_id: str, *, force: bool, dry_run: bool, relink: bool = False) -> int:
    path = next(
        (p for p in sorted((CONTENT_DIR / "units").glob("*.json"))
         if json.loads(p.read_text(encoding="utf-8")).get("id") == unit_id),
        None,
    )
    if path is None:
        print(f"✗ no unit with id {unit_id}")
        return 1

    unit = json.loads(path.read_text(encoding="utf-8"))
    if relink:
        print(f"\n{unit_id}:")
        return _relink(unit_id, unit, path)
    todo = [
        (label, node) for label, node in media_nodes(unit)
        if node.get("prompt") and (force or not node.get("src")
                                   or _stamp(node["prompt"]) not in str(node.get("src")))
    ]
    total = sum(1 for _ in media_nodes(unit))
    print(f"\n{unit_id}: {total} image(s) declared, {len(todo)} to draw")
    if dry_run:
        for label, node in todo:
            print(f"  would draw  {label}\n              {node['prompt'][:96]}")
        return 0
    if not todo:
        print("  nothing to do — every prompt already has its picture")
        return 0

    client = _client()
    out_dir = ASSETS_DIR / unit_id
    for label, node in todo:
        base = f"{_slug(label.split(' · ')[0].rsplit('.', 1)[-1] + '-' + label.split(' · ')[-1])}-{_stamp(node['prompt'])}"
        print(f"  drawing  {label}")
        try:
            response = await client.images.generate(
                model=MODEL, prompt=f"{node['prompt']}\n\n{STYLE}",
                size=SIZE, quality=QUALITY, n=1,
            )
            png = base64.b64decode(response.data[0].b64_json)
        except Exception as exc:  # noqa: BLE001 - one refusal must not lose the rest
            print(f"    ✗ {type(exc).__name__}: {str(exc)[:160]}")
            continue
        src, srcset, width, height = _write_variants(png, out_dir, base)
        node["src"], node["srcset"] = src, srcset
        node["width"], node["height"] = width, height
        print(f"    ✓ {src}  ({width}×{height})")

    _patch(path, unit)
    return 0


GENERATED_KEYS = ("src", "srcset", "width", "height")


def _patch(path: Path, unit: dict[str, Any]) -> None:
    """Write the generated fields back without reflowing the file.

    These units are hand-formatted and reviewed by people, so a round-trip
    through `json.dumps` would turn four new keys into a diff nobody can read.
    Each media node is edited in place instead, anchored on its prompt line —
    the one field that was already there and is unique to the picture.

    Line-level rather than a regex over the whole file: the first version of this
    matched `"prompt": …` followed by `}`, which is never true because `alt`
    comes after it. It replaced nothing, reported success, and left ten
    generated files with nothing referring to them.
    """
    lines = path.read_text(encoding="utf-8").splitlines(keepends=True)
    written = 0
    for _label, node in media_nodes(unit):
        if not node.get("src"):
            continue
        anchor = f'"prompt": {json.dumps(node["prompt"], ensure_ascii=False)}'
        at = next((n for n, line in enumerate(lines) if anchor in line), None)
        if at is None:
            raise AssertionError(f"could not find the prompt line for {node['src']}")
        indent = lines[at][:len(lines[at]) - len(lines[at].lstrip())]
        # Drop what a previous run put here, so a rerun replaces rather than doubles.
        end = at + 1
        while end < len(lines) and lines[end].lstrip().startswith(tuple(f'"{k}"' for k in GENERATED_KEYS)):
            end += 1
        fresh = [
            f'{indent}"{key}": {json.dumps(node[key], ensure_ascii=False)},\n'
            for key in GENERATED_KEYS if node.get(key) is not None
        ]
        if not lines[at].rstrip().endswith(","):
            lines[at] = lines[at].rstrip("\n") + ",\n"
        # The last generated key must not carry a trailing comma if it is the
        # final entry — but `alt` always follows, so it always may.
        lines = lines[:at + 1] + fresh + lines[end:]
        written += 1

    text = "".join(lines)
    json.loads(text)   # a broken edit must never reach disk
    path.write_text(text, encoding="utf-8")
    print(f"  ✓ patched {path.name} — {written} media node(s)")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("unit_ids", nargs="*", help="unit ids, e.g. ENG.G7.FAMILY.VOCAB")
    parser.add_argument("--all", action="store_true", help="every unit that declares an image")
    parser.add_argument("--force", action="store_true", help="redraw even if the file exists")
    parser.add_argument("--dry-run", action="store_true", help="say what would be drawn")
    parser.add_argument("--relink", action="store_true",
                        help="point the content at pictures already on disk, without drawing")
    args = parser.parse_args()

    ids = list(args.unit_ids)
    if args.all:
        ids = []
        for path in sorted((CONTENT_DIR / "units").glob("*.json")):
            unit = json.loads(path.read_text(encoding="utf-8"))
            if any(True for _ in media_nodes(unit)):
                ids.append(unit["id"])
    if not ids:
        parser.error("name at least one unit, or pass --all")

    status = 0
    for unit_id in ids:
        status |= asyncio.run(generate(unit_id, force=args.force, dry_run=args.dry_run,
                                       relink=args.relink))
    return status


if __name__ == "__main__":
    raise SystemExit(main())
