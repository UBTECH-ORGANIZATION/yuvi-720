"""Is tonight's content safe to merge on its own? — the nightly's merge gate.

    python backend/scripts/content_guard.py --base-ref origin/main \\
        --decisions backend/artifacts/content-pipeline/decisions.json \\
        --out backend/artifacts/content-pipeline/guard.json

Compares the shards on disk (tonight) with the shards on ``--base-ref``
(what learners get today) and fails — exit 1 — when merging would make the
coach worse or unsafe:

- **invariants**: every shard validates, no banned key (answers, authored
  notes), every capture is a format the runtime reads, v8 object catalogs
  validate, the extraction record counts what is really written, no text or
  description asserts an answer ("התשובה היא…"), total size under the cap;
- **regression**: every text or capture main has and tonight lacks must be
  EXPLAINED — its lomda/slide/question left the catalog, its content changed
  (fingerprint), its prompt version was bumped, or the pipeline recorded why
  it dropped it (``decisions.json``). One unexplained loss fails the gate: a
  week of silent geometry loss (87 → 16 slides) is what this replaces.

Coverage numbers ride along for the PR body. The guard reads shards only —
never the catalog, so it never sees a correct answer — and writes counts and
reason codes, nothing a public artifact must not carry.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from collections import Counter
from pathlib import Path
from typing import Any, Iterable, Optional

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.agents import answer_guard  # noqa: E402
from app.services import content_intelligence as ci  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parent))
import content_objects as objects_lib  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]
CONTEXT_DIR = "content/context"
#: The whole committed catalog, all shards. Today ~1.5 MB; v8 object catalogs
#: add ~1 KB per captured slide. The runtime loads every shard per process.
SIZE_LIMIT_BYTES = 4_000_000

Shards = dict[str, dict[str, Any]]   # relative path → shard document


# ── reading ──────────────────────────────────────────────────────────────────

def load_dir(out_dir: Path) -> Shards:
    return {str(p.relative_to(out_dir)): json.loads(p.read_text(encoding="utf-8"))
            for p in ci.shard_paths(out_dir)}


def load_ref(ref: str) -> Shards:
    """The shards as committed at ``ref`` (empty when the ref is unknown —
    the first night on a fresh repo has nothing to regress from)."""
    def _git(*args: str) -> str:
        return subprocess.run(["git", *args], cwd=REPO_ROOT, check=True,
                              capture_output=True, text=True).stdout
    try:
        names = _git("ls-tree", "-r", "--name-only", ref, "--", CONTEXT_DIR).split()
    except subprocess.CalledProcessError:
        return {}
    out: Shards = {}
    for name in names:
        if not name.endswith(".json") or name.endswith("/index.json"):
            continue
        try:
            out[name[len(CONTEXT_DIR) + 1:]] = json.loads(_git("show", f"{ref}:{name}"))
        except (subprocess.CalledProcessError, json.JSONDecodeError):
            continue
    return out


def _size(shards: Shards) -> int:
    # Plain JSON, not ci.dump_shard: the writer refuses a banned key, and the
    # base (main) may still carry one the guard must be able to measure.
    return sum(len(json.dumps(s, ensure_ascii=False, indent=2).encode("utf-8"))
               for s in shards.values())


# ── walking ──────────────────────────────────────────────────────────────────

def _lomdot(shards: Shards) -> dict[str, dict[str, Any]]:
    return {str(l.get("component_id")): l
            for shard in shards.values() for l in shard.get("lomdot") or []}


def _texts(shards: Shards) -> Iterable[tuple[tuple[str, str, str, str], dict, dict]]:
    """((cid, iid, qid, kind), block, owner) for every stored text block;
    owner is the dict whose fingerprint the block was written from."""
    for cid, lomda in _lomdot(shards).items():
        for kind, block in (lomda.get("texts") or {}).items():
            yield (cid, "", "", kind), block, lomda
        for slide in lomda.get("slides") or []:
            iid = str(slide.get("item_id"))
            for kind, block in (slide.get("texts") or {}).items():
                yield (cid, iid, "", kind), block, slide
            for q in slide.get("questions") or []:
                for kind, block in (q.get("texts") or {}).items():
                    yield (cid, iid, str(q.get("question_id")), kind), block, q


def coverage(shards: Shards) -> dict[str, Any]:
    lomdot = _lomdot(shards)
    slides = [s for l in lomdot.values() for s in l.get("slides") or []]
    enriched = [s for s in slides if isinstance(s.get("enrichment"), dict)]
    texts = Counter(key[3] for key, block, _ in _texts(shards)
                    if str((block or {}).get("he") or "").strip())
    objects = [o for s in enriched for o in (s["enrichment"].get("objects") or [])]
    return {
        "lomdot": len(lomdot),
        "lomdot_browsed": sum(1 for l in lomdot.values()
                              if (l.get("extraction") or {}).get("probed_at")),
        "verdicts": dict(sorted(Counter(
            str((l.get("extraction") or {}).get("verdict") or "none")
            for l in lomdot.values()).items())),
        "slides": len(slides),
        "questions": sum(len(s.get("questions") or []) for s in slides),
        "slides_enriched": len(enriched),
        "slides_v8": sum(1 for s in enriched if s["enrichment"].get("capture_version") == 8),
        "objects": len(objects),
        "objects_with_geometry": sum(1 for o in objects if o.get("r")),
        "texts": dict(sorted(texts.items())),
        "size_bytes": _size(shards),
    }


# ── invariants ───────────────────────────────────────────────────────────────

def invariants(shards: Shards) -> list[str]:
    problems: list[str] = []
    for path, shard in sorted(shards.items()):
        for problem in ci.validate_shard(shard):
            problems.append(f"{path}: {problem}")
        banned = ci.find_forbidden_key(shard)
        if banned:
            problems.append(f"{path}: banned key at {banned}")
    for cid, lomda in _lomdot(shards).items():
        slides = lomda.get("slides") or []
        written = sum(1 for s in slides if isinstance(s.get("enrichment"), dict))
        claimed = (lomda.get("extraction") or {}).get("screens_mapped")
        if isinstance(claimed, int) and claimed != written:
            problems.append(f"{cid}: extraction claims {claimed} mapped, {written} written")
        for slide in slides:
            enrichment = slide.get("enrichment")
            if not isinstance(enrichment, dict):
                continue
            where = f"{cid}/{slide.get('item_id')}"
            version = enrichment.get("capture_version")
            if version not in ci.CAPTURE_COMPAT:
                problems.append(f"{where}: capture_version {version!r} unreadable at runtime")
            if version == 8:
                problems.extend(f"{where}: {p}" for p in ci.validate_objects(enrichment))
            for media in enrichment.get("media") or []:
                if isinstance(media, dict) and answer_guard.asserts_an_answer(
                        str(media.get("description") or "")):
                    problems.append(f"{where}: a graphic description asserts an answer")
    for key, block, _ in _texts(shards):
        if answer_guard.asserts_an_answer(str((block or {}).get("he") or "")):
            problems.append(f"{'/'.join(k for k in key if k)}: text asserts an answer")
    size = _size(shards)
    if size > SIZE_LIMIT_BYTES:
        problems.append(f"shards total {size} bytes > {SIZE_LIMIT_BYTES}")
    return problems


# ── regression vs the base ───────────────────────────────────────────────────

def _decided(decisions: list[dict[str, Any]]) -> dict[tuple[str, str, str], str]:
    out: dict[tuple[str, str, str], str] = {}
    for d in decisions or []:
        if isinstance(d, dict):
            out[(str(d.get("cid") or ""), str(d.get("iid") or ""), str(d.get("what") or ""))] = \
                str(d.get("reason") or d.get("action") or "decided")
    return out


def regression(base: Shards, new: Shards, decisions: list[dict[str, Any]]) -> dict[str, Any]:
    """Every text block and capture ``base`` has that ``new`` lacks, with the
    reason it went — or ``unexplained``."""
    decided = _decided(decisions)
    new_lomdot = _lomdot(new)
    base_lomdot = _lomdot(base)
    new_texts = {key: block for key, block, _ in _texts(new)
                 if str((block or {}).get("he") or "").strip()}
    # A slide renamed by Kata keeps its fingerprint; what it carries under the
    # new id is not a loss.
    carried_by_fp: set[tuple[str, str, str]] = set()
    for key, block, owner in _texts(new):
        if str((block or {}).get("he") or "").strip():
            carried_by_fp.add((key[0], str(owner.get("fingerprint") or ""), key[3]))
    new_slides: dict[tuple[str, str], dict] = {}
    enriched_fp: set[tuple[str, str]] = set()
    for cid, lomda in new_lomdot.items():
        for s in lomda.get("slides") or []:
            new_slides[(cid, str(s.get("item_id")))] = s
            if isinstance(s.get("enrichment"), dict):
                enriched_fp.add((cid, str(s.get("fingerprint") or "")))

    def _owner(key: tuple[str, str, str, str]) -> Optional[dict]:
        cid, iid, qid, _ = key
        lomda = new_lomdot.get(cid)
        if lomda is None:
            return None
        if not iid:
            return lomda
        slide = new_slides.get((cid, iid))
        if slide is None or not qid:
            return slide
        return next((q for q in slide.get("questions") or []
                     if str(q.get("question_id")) == qid), None)

    losses: list[dict[str, str]] = []
    for key, block, base_owner in _texts(base):
        if not str((block or {}).get("he") or "").strip() or key in new_texts:
            continue
        cid, iid, qid, kind = key
        if (cid, str(base_owner.get("fingerprint") or ""), kind) in carried_by_fp:
            continue
        owner = _owner(key)
        if owner is None:
            reason = "removed"
        elif (owner.get("fingerprint") or owner.get("component_fingerprint")) != \
                (base_owner.get("fingerprint") or base_owner.get("component_fingerprint")):
            reason = "content_changed"
        elif (block or {}).get("prompt_version") != ci.prompt_version_for(kind):
            reason = "prompt_bump"
        else:
            reason = decided.get((cid, iid, f"text:{qid}:{kind}")) or "unexplained"
        losses.append({"what": "text", "kind": kind, "cid": cid, "iid": iid,
                       "qid": qid, "reason": reason})
    for cid, lomda in base_lomdot.items():
        for s in lomda.get("slides") or []:
            if not isinstance(s.get("enrichment"), dict):
                continue
            iid = str(s.get("item_id"))
            now = new_slides.get((cid, iid))
            if now is not None and isinstance(now.get("enrichment"), dict):
                continue
            if (cid, str(s.get("fingerprint") or "")) in enriched_fp:
                continue
            if now is None:
                reason = "removed"
            elif now.get("fingerprint") != s.get("fingerprint"):
                reason = "content_changed"
            elif s["enrichment"].get("capture_version") not in ci.CAPTURE_COMPAT:
                reason = "old_format"
            elif not objects_lib.reverify_capture(s, s["enrichment"])[0]:
                # Re-derived, not remembered: on a carried-forward branch the
                # night that dropped it is long gone, the reason is not.
                reason = "failed_reverify"
            else:
                reason = decided.get((cid, iid, "enrichment")) or "unexplained"
            losses.append({"what": "enrichment", "cid": cid, "iid": iid, "reason": reason})
    return {
        "losses": len(losses),
        "by_reason": dict(sorted(Counter(l["reason"] for l in losses).items())),
        "unexplained": [l for l in losses if l["reason"] == "unexplained"][:40],
    }


def evaluate(base: Shards, new: Shards, decisions: list[dict[str, Any]]) -> dict[str, Any]:
    problems = invariants(new)
    regress = regression(base, new, decisions)
    unexplained = regress["by_reason"].get("unexplained", 0)
    return {
        "ok": not problems and not unexplained,
        "invariant_failures": problems[:60],
        "invariant_failure_count": len(problems),
        "regression": regress,
        "coverage": {"base": coverage(base), "new": coverage(new)},
    }


def render_markdown(guard: dict[str, Any]) -> str:
    """The PR body's Guard section — counts and reason codes only."""
    base, new = guard["coverage"]["base"], guard["coverage"]["new"]
    rows = [("lomdot browsed", "lomdot_browsed"), ("slides with a capture", "slides_enriched"),
            ("slides on capture v8", "slides_v8"), ("screen objects", "objects"),
            ("objects with geometry", "objects_with_geometry")]
    lines = [f"### Guard: {'✅ passed' if guard['ok'] else '❌ failed'}", "",
             "| | main | tonight |", "|---|---:|---:|"]
    lines += [f"| {label} | {base.get(key, 0)} | {new.get(key, 0)} |" for label, key in rows]
    for kind in sorted(set(base.get("texts") or {}) | set(new.get("texts") or {})):
        lines.append(f"| texts · {kind} | {(base.get('texts') or {}).get(kind, 0)} "
                     f"| {(new.get('texts') or {}).get(kind, 0)} |")
    lines.append(f"| size (KB) | {base.get('size_bytes', 0) // 1024} | {new.get('size_bytes', 0) // 1024} |")
    by_reason = guard["regression"]["by_reason"]
    if by_reason:
        lines += ["", "Losses vs main, by reason: "
                  + ", ".join(f"{reason} {count}" for reason, count in by_reason.items())]
    for problem in guard["invariant_failures"][:10]:
        lines.append(f"- ❌ {problem}")
    for loss in guard["regression"]["unexplained"][:10]:
        lines.append(f"- ❌ unexplained loss: {loss['what']} {loss.get('kind', '')} "
                     f"{loss['cid']}/{loss['iid']}")
    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out-dir", default=str(REPO_ROOT / CONTEXT_DIR))
    parser.add_argument("--base-ref", default="origin/main")
    parser.add_argument("--base-dir", help="read the base from a directory instead of git")
    parser.add_argument("--decisions", help="the pipeline's decisions.json")
    parser.add_argument("--out", help="write guard.json here")
    parser.add_argument("--markdown-out", help="write the PR body's Guard section here")
    args = parser.parse_args()

    base = load_dir(Path(args.base_dir)) if args.base_dir else load_ref(args.base_ref)
    decisions: list[dict[str, Any]] = []
    if args.decisions and Path(args.decisions).exists():
        decisions = json.loads(Path(args.decisions).read_text(encoding="utf-8"))
    guard = evaluate(base, load_dir(Path(args.out_dir)), decisions)
    payload = json.dumps(guard, ensure_ascii=False, indent=2) + "\n"
    if args.out:
        Path(args.out).parent.mkdir(parents=True, exist_ok=True)
        Path(args.out).write_text(payload, encoding="utf-8")
    if args.markdown_out:
        Path(args.markdown_out).write_text(render_markdown(guard), encoding="utf-8")
    print(render_markdown(guard))
    return 0 if guard["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
