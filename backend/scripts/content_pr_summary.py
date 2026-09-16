"""Write the nightly content PR's description from what actually changed.

The nightly pipeline rewrites `content/context/*.json` shards. A shard is
thousands of lines, so the PR's "Files changed" tab says nothing a person can
act on. This script reads both sides of each changed shard, works out what
happened *structurally* — lomdot added or removed, catalog updates, texts
regenerated, graphics described, extraction verdicts — and asks the model to
say it in plain English, one section per file, with the reason next to each
change. The structured diff is the only thing the model sees, so it cannot
invent a change, and answers to questions never leave the shard.

If the model is unavailable the same structured diff is rendered directly,
so the PR is never left with the old boilerplate.

    python backend/scripts/content_pr_summary.py --staged --out body.md
    python backend/scripts/content_pr_summary.py --base origin/main --head origin/content/nightly
"""

from __future__ import annotations

import argparse
import asyncio
import json
import subprocess
import sys
from pathlib import Path
from typing import Any, Optional

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.env import ensure_env_loaded  # noqa: E402

ensure_env_loaded()

REPO_ROOT = Path(__file__).resolve().parents[2]
CONTEXT_DIR = "content/context"
REPORT_PATH = REPO_ROOT / "backend" / "artifacts" / "content-pipeline" / "report.md"

# ── reading both sides ───────────────────────────────────────────────────────


def _git(*args: str) -> str:
    return subprocess.run(
        ["git", *args], cwd=REPO_ROOT, check=True, capture_output=True, text=True,
    ).stdout


def changed_paths(base: Optional[str], head: Optional[str], staged: bool) -> list[tuple[str, str]]:
    """[(status, path)] for every shard that differs. `M`, `A`, `D`."""
    if staged:
        out = _git("diff", "--cached", "--name-status", "--", CONTEXT_DIR)
    else:
        out = _git("diff", "--name-status", base or "HEAD", head or "HEAD", "--", CONTEXT_DIR)
    rows: list[tuple[str, str]] = []
    for line in out.splitlines():
        parts = line.split("\t")
        if len(parts) >= 2 and parts[-1].endswith(".json"):
            rows.append((parts[0][0], parts[-1]))
    return rows


def read_side(ref: Optional[str], path: str, *, staged_side: Optional[str] = None) -> Optional[dict[str, Any]]:
    """The shard at `ref`, or on the index (`staged_side='index'`) / HEAD."""
    try:
        if staged_side == "index":
            raw = _git("show", f":{path}")
        else:
            raw = _git("show", f"{ref or 'HEAD'}:{path}")
    except subprocess.CalledProcessError:
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return None


# ── the structural diff ──────────────────────────────────────────────────────


def _by_id(items: Optional[list[dict[str, Any]]], key: str) -> dict[str, dict[str, Any]]:
    return {str(item.get(key) or ""): item for item in (items or []) if isinstance(item, dict)}


def _texts_regenerated(old: Optional[dict[str, Any]], new: Optional[dict[str, Any]]) -> list[str]:
    """Text kinds whose generated_at moved, or that appeared."""
    old = old or {}
    new = new or {}
    kinds: list[str] = []
    for kind, block in new.items():
        if not isinstance(block, dict):
            continue
        before = old.get(kind) if isinstance(old.get(kind), dict) else None
        if before is None or before.get("generated_at") != block.get("generated_at"):
            kinds.append(kind)
    return kinds


def _described_media(slides: Optional[list[dict[str, Any]]]) -> int:
    n = 0
    for slide in slides or []:
        for m in ((slide.get("enrichment") or {}).get("media") or []):
            if isinstance(m, dict) and m.get("description"):
                n += 1
    return n


def _questions(slides: Optional[list[dict[str, Any]]]) -> int:
    return sum(len(s.get("questions") or []) for s in (slides or []))


def diff_lomda(old: dict[str, Any], new: dict[str, Any]) -> dict[str, Any]:
    """What changed inside one lomda. Only reasons a reader can check."""
    out: dict[str, Any] = {"title": new.get("title") or old.get("title") or ""}
    if old.get("kata_updated_at") != new.get("kata_updated_at"):
        out["catalog_updated"] = {"from": old.get("kata_updated_at"), "to": new.get("kata_updated_at")}
    if old.get("component_fingerprint") != new.get("component_fingerprint"):
        out["content_fingerprint_changed"] = True
    old_x = old.get("extraction") or {}
    new_x = new.get("extraction") or {}
    if old_x.get("verdict") != new_x.get("verdict") or old_x.get("screens_mapped") != new_x.get("screens_mapped"):
        out["extraction"] = {
            "from": f"{old_x.get('verdict')} ({old_x.get('screens_mapped')}/{old_x.get('screens_seen')} screens)",
            "to": f"{new_x.get('verdict')} ({new_x.get('screens_mapped')}/{new_x.get('screens_seen')} screens)",
        }
    old_slides = _by_id(old.get("slides"), "item_id")
    new_slides = _by_id(new.get("slides"), "item_id")
    if len(old_slides) != len(new_slides):
        out["slides"] = {"from": len(old_slides), "to": len(new_slides)}
    oq, nq = _questions(old.get("slides")), _questions(new.get("slides"))
    if oq != nq:
        out["questions"] = {"from": oq, "to": nq}
    om, nm = _described_media(old.get("slides")), _described_media(new.get("slides"))
    if om != nm:
        out["graphics_described"] = {"from": om, "to": nm}
    regen = list(_texts_regenerated(old.get("texts"), new.get("texts")))
    slide_regen = 0
    question_regen = 0
    for item_id, slide in new_slides.items():
        before = old_slides.get(item_id) or {}
        slide_regen += len(_texts_regenerated(before.get("texts"), slide.get("texts")))
        before_q = _by_id(before.get("questions"), "question_id")
        for qid, q in _by_id(slide.get("questions"), "question_id").items():
            question_regen += len(_texts_regenerated((before_q.get(qid) or {}).get("texts"), q.get("texts")))
    if regen:
        out["lomda_texts_regenerated"] = regen
    if slide_regen:
        out["slide_texts_regenerated"] = slide_regen
    if question_regen:
        out["question_texts_regenerated"] = question_regen
    return out


def diff_shard(old: Optional[dict[str, Any]], new: Optional[dict[str, Any]]) -> dict[str, Any]:
    """One shard, both sides. Missing side = added / removed file."""
    if new is None and old is None:
        return {}
    ref = new or old or {}
    out: dict[str, Any] = {
        "subject": ref.get("subject"),
        "objective_id": ref.get("objective_id"),
        "objective_title_he": ref.get("objective_title_he"),
    }
    if old is None:
        out["file"] = "added"
        out["lomdot_added"] = [l.get("title") or l.get("component_id") for l in (new or {}).get("lomdot") or []]
        return out
    if new is None:
        out["file"] = "removed"
        out["lomdot_removed"] = [l.get("title") or l.get("component_id") for l in old.get("lomdot") or []]
        return out
    old_l = _by_id(old.get("lomdot"), "component_id")
    new_l = _by_id(new.get("lomdot"), "component_id")
    added_ids = [c for c in new_l if c not in old_l]
    removed_ids = [c for c in old_l if c not in new_l]
    # A lomda that left under one id and came back under another with the
    # same title is the catalogue renaming it, not a removal plus an addition.
    # Pair those up so the diff says "id changed" and still compares the two.
    renamed: list[dict[str, Any]] = []
    by_title = {(old_l[c].get("title") or ""): c for c in removed_ids}
    for cid in list(added_ids):
        title = new_l[cid].get("title") or ""
        prev = by_title.pop(title, None)
        if prev is None:
            continue
        added_ids.remove(cid)
        removed_ids.remove(prev)
        entry: dict[str, Any] = {"title": title, "from": prev, "to": cid}
        inner = diff_lomda(old_l[prev], new_l[cid])
        entry.update({k: v for k, v in inner.items() if k != "title"})
        renamed.append(entry)
    added = [new_l[c].get("title") or c for c in added_ids]
    removed = [old_l[c].get("title") or c for c in removed_ids]
    changed: dict[str, dict[str, Any]] = {}
    for cid in new_l:
        if cid in old_l:
            d = diff_lomda(old_l[cid], new_l[cid])
            if len(d) > 1:                       # more than the title
                changed[cid] = d
    if old.get("objective_title_he") != new.get("objective_title_he"):
        out["objective_title_changed"] = {"from": old.get("objective_title_he"), "to": new.get("objective_title_he")}
    if added:
        out["lomdot_added"] = added
    if removed:
        out["lomdot_removed"] = removed
    if renamed:
        out["lomdot_id_changed"] = renamed
    if changed:
        out["lomdot_changed"] = changed
    if len(out) == 3:
        out["note"] = "only serialisation or ordering changed; no content difference found"
    return out


def diff_index(old: Optional[dict[str, Any]], new: Optional[dict[str, Any]]) -> dict[str, Any]:
    old = old or {}
    new = new or {}
    out: dict[str, Any] = {}
    for key in ("schema_version", "prompt_version"):
        if old.get(key) != new.get(key):
            out[key] = {"from": old.get(key), "to": new.get(key)}
    # The backlog is a mapping (component → why it is queued) today; older
    # indexes had a list. Both read as "ids still waiting for a browser pass".
    ob, nb = old.get("backlog") or {}, new.get("backlog") or {}
    if ob != nb:
        queued = [cid for ids in nb.values() for cid in (ids or [])] if isinstance(nb, dict) else list(nb)
        out["backlog"] = {"from": len(ob), "to": len(nb), "still_queued": queued[:8]}
    if new.get("generated_at"):
        out["generated_at"] = new["generated_at"]
    return out


def build_summary(base: Optional[str], head: Optional[str], staged: bool) -> dict[str, Any]:
    files: dict[str, Any] = {}
    index: dict[str, Any] = {}
    for status, path in changed_paths(base, head, staged):
        if staged:
            old = read_side("HEAD", path)
            new = read_side(None, path, staged_side="index") if status != "D" else None
        else:
            old = read_side(base, path) if status != "A" else None
            new = read_side(head, path) if status != "D" else None
        if path.endswith("/index.json"):
            index = diff_index(old, new)
            continue
        files[path[len(CONTEXT_DIR) + 1:]] = diff_shard(old, new)
    report = REPORT_PATH.read_text(encoding="utf-8") if REPORT_PATH.exists() else ""
    return {"files": files, "index": index, "run_report": report[:4000]}


# ── rendering ────────────────────────────────────────────────────────────────


def _fmt_change(label: str, value: Any) -> str:
    if isinstance(value, dict) and "from" in value and "to" in value:
        return f"{label}: {value['from']} → {value['to']}"
    if isinstance(value, list):
        return f"{label}: {', '.join(str(v) for v in value)}"
    return f"{label}: {value}"


def render_fallback(summary: dict[str, Any]) -> str:
    """The structured diff as Markdown — what the PR shows when no model answered."""
    lines = ["Automated refresh of `content/context/` from the live Kata catalog by the content-nightly pipeline.", ""]
    index = summary.get("index") or {}
    if index:
        lines.append("**Run:** " + "; ".join(_fmt_change(k, v) for k, v in index.items() if k != "generated_at"))
        lines.append("")
    for path, d in (summary.get("files") or {}).items():
        title = d.get("objective_title_he") or d.get("objective_id") or path
        lines.append(f"### `{path}` — {title}")
        if d.get("file") == "added":
            lines.append(f"- New objective shard with {len(d.get('lomdot_added') or [])} lomdot.")
        elif d.get("file") == "removed":
            lines.append("- Objective removed from the catalog; shard deleted.")
        for t in d.get("lomdot_added") or []:
            lines.append(f"- Added lomda «{t}» — new in the catalog.")
        for t in d.get("lomdot_removed") or []:
            lines.append(f"- Removed lomda «{t}» — no longer in the catalog.")
        for r in d.get("lomdot_id_changed") or []:
            extra = [_fmt_change(k.replace("_", " "), v) for k, v in r.items() if k not in ("title", "from", "to")]
            lines.append(f"- «{r.get('title')}» now has component id `{r.get('to')}` (was `{r.get('from')}`) — the catalogue re-identified it"
                         + ("; " + "; ".join(extra) if extra else "") + ".")
        for cid, c in (d.get("lomdot_changed") or {}).items():
            bits = [_fmt_change(k.replace("_", " "), v) for k, v in c.items() if k != "title"]
            lines.append(f"- «{c.get('title') or cid}»: " + "; ".join(bits))
        if d.get("note"):
            lines.append(f"- {d['note']}")
        lines.append("")
    lines.append("Merging ships it to the dev slot through the normal push→main deploy. Nothing reaches production without the manual promote.")
    lines.append("")
    lines.append("If this PR sits unmerged, the next nightly run updates it in place rather than opening another.")
    return "\n".join(lines) + "\n"


SYSTEM_PROMPT = """You write the description of an automated pull request for a learning-content pipeline.
The pipeline mirrors a catalogue of Hebrew learning units ("lomdot") into JSON shards, one per learning objective, and pre-generates Yuvi's coaching texts for them.
You receive a STRUCTURED DIFF computed from the files (never the raw JSON). Describe exactly what it says, nothing more.

Write GitHub Markdown, in English, keeping Hebrew titles verbatim inside «»:
1. One short paragraph: what this refresh did overall and why (catalog updates, new/removed units, regenerated texts, graphics described, extraction changes).
2. One `###` section per changed file, headed by the file path in backticks and the objective's Hebrew title. Under it, 2–5 bullets, each "what changed — why". Reasons come from the diff: a newer `kata_updated_at` means the catalogue updated the unit; a changed fingerprint means its content changed; regenerated texts follow a content or prompt-version change; described graphics come from the browser pass; extraction verdicts come from probing the player; `lomdot_id_changed` means the catalogue re-identified the same unit under a new component id (say that, not "added and removed").
3. If a file's only change is serialisation/ordering, say so in one bullet.
4. End with the two fixed lines given to you verbatim.
Do not invent numbers, do not mention answers to questions, do not add headings beyond the ones described."""

FIXED_TAIL = (
    "Merging ships it to the dev slot through the normal push→main deploy. Nothing reaches production without the manual promote.\n\n"
    "If this PR sits unmerged, the next nightly run updates it in place rather than opening another."
)


async def render_with_model(summary: dict[str, Any]) -> Optional[str]:
    from app.services.ai_usage import UsageContext
    from app.services.llm import call_llm

    usage = UsageContext(
        actor_id="content-pipeline", actor_type="system",
        endpoint="script:content_pr_summary", feature="content_pipeline",
        operation="content.pr_summary", source="content_pipeline",
    )
    payload = json.dumps(summary, ensure_ascii=False)
    if len(payload) > 60_000:                    # keep the prompt bounded on a big night
        trimmed = {**summary, "run_report": ""}
        payload = json.dumps(trimmed, ensure_ascii=False)[:60_000]
    text = await call_llm(
        [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": f"STRUCTURED DIFF:\n{payload}\n\nFIXED TAIL (copy verbatim at the end):\n{FIXED_TAIL}"},
        ],
        usage_context=usage, max_tokens=1800, model_tier="mini", timeout=90,
    )
    if not isinstance(text, str) or len(text.strip()) < 80:
        return None
    body = text.strip()
    if "manual promote" not in body:              # the model dropped the tail; restore it
        body += "\n\n" + FIXED_TAIL
    return body + "\n"


async def main_async(args: argparse.Namespace) -> int:
    summary = build_summary(args.base, args.head, args.staged)
    if not summary["files"] and not summary["index"]:
        body = "Automated refresh of `content/context/` — no content difference found.\n\n" + FIXED_TAIL + "\n"
    else:
        body = None if args.no_llm else await render_with_model(summary)
        if body is None:
            body = render_fallback(summary)
    if args.summary_out:
        Path(args.summary_out).write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    if args.out:
        Path(args.out).write_text(body, encoding="utf-8")
    else:
        sys.stdout.write(body)
    try:
        from app.services import ai_usage
        await ai_usage.flush_pending()
    except Exception:
        pass
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--staged", action="store_true", help="compare HEAD with the index (after `git add content/context`)")
    parser.add_argument("--base", help="git ref for the old side (default HEAD)")
    parser.add_argument("--head", help="git ref for the new side (default HEAD / working tree)")
    parser.add_argument("--out", help="write the Markdown body here instead of stdout")
    parser.add_argument("--summary-out", help="also write the structured diff as JSON")
    parser.add_argument("--no-llm", action="store_true", help="render the structured diff directly")
    args = parser.parse_args()
    return asyncio.run(main_async(args))


if __name__ == "__main__":
    raise SystemExit(main())
