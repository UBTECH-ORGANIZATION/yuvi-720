#!/usr/bin/env python3
"""Maintain the committed content-intelligence config from the live catalog.

    python scripts/content_pipeline.py --report          # what drifted, no writes
    python scripts/content_pipeline.py --dry-run         # full pass, no writes
    python scripts/content_pipeline.py                   # write content/context/
    python scripts/content_pipeline.py --verify          # prove a second pass is a no-op

The nightly GitHub Action runs this. It walks the live Kata catalog, diffs it
against the repo-committed shards (``content/context/<subject>/<objective>.json``),
drives changed lomdot in a real browser to read what the learner actually sees,
regenerates the pre-written Hebrew coach texts whose authored source changed,
and rewrites the shards deterministically — an unchanged catalog writes
byte-identical files, so a quiet night is a quiet commit log.

## The rules that keep it honest

- **The fingerprint decides, not the clock.** Kata only stamps ``updatedAt`` on
  components; every finer regeneration decision hashes the authored content
  itself through the shared functions in ``app.services.content_intelligence``
  — the same functions the coach uses at serve time, so pipeline and runtime
  cannot disagree about freshness.
- **One bad lomda never kills the run.** Browser extraction records a verdict
  (``launch_404``, ``timeout``, ...) and moves on; generation rejects bad rows
  silently and leaves the slot absent — an absent text means "generate live",
  which is exactly today's behavior.
- **Correct answers never reach the repo.** They ground hint/explanation
  generation in memory and are discarded; the serializer refuses to write them.
- **Budgeted.** ``--max-browse`` lomdot get a browser and ``--max-llm-calls``
  batches get a model per night; the overflow lands in the index backlog and
  the fingerprint mismatch persists, so the next night picks it up unprompted.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import re
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.env import ensure_env_loaded  # noqa: E402

ensure_env_loaded()

from app.services import content_intelligence as ci  # noqa: E402
from app.services.ai_usage import UsageContext  # noqa: E402

from app.agents import answer_guard  # noqa: E402

try:  # imported as `scripts.content_pipeline` (tests) or run as a script
    from scripts import content_browse as browse_lib  # noqa: E402
    from scripts import content_objects as objects_lib  # noqa: E402
except ImportError:  # pragma: no cover - direct script execution
    import content_browse as browse_lib  # noqa: E402
    import content_objects as objects_lib  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OUT_DIR = REPO_ROOT / "content" / "context"
DEFAULT_DUMP_DIR = REPO_ROOT / "backend" / "artifacts" / "content-pipeline"
DRIVER = REPO_ROOT / "frontend" / "scripts" / "content-extract.mjs"

BATCH = 12                      # translate_catalog's batch discipline
DRIVER_TIMEOUT_SECONDS = 420  # the anchor sweep re-measures 12 sizes/screen
_HEBREW = re.compile("[\u0590-\u05FF]")

_KIND_TO_ROLE = {"watch": "video", "read": "teaching", "step": "teaching",
                 "question": "question"}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace(
        "+00:00", "Z")


# ── Stage A: the live catalog as a model ─────────────────────────────────────

async def fetch_catalog_model() -> dict[str, dict[str, Any]]:
    """component_id → everything the shards are built from.

    ``correct`` per question stays IN THIS MODEL ONLY — generation grounding,
    never serialized (dump_shard enforces the ban a second time).
    """
    from app.services import kata_catalog as kc

    await kc.ensure_loaded()
    model: dict[str, dict[str, Any]] = {}
    for subject in kc.subjects():
        for objective in kc.objectives_for(subject):
            objective_id = str(objective.get("id") or "")
            objective_title = kc.localized_objective_title(objective_id, "he")
            for component in kc.components_for(objective_id):
                component_id = str(component.get("id") or "")
                if not component_id:
                    continue
                slides = []
                for position, profile in enumerate(kc.item_profiles(component_id), 1):
                    item_id = str(profile.get("id") or "")
                    if not item_id:
                        continue
                    questions = kc.questions_for_item(component_id, item_id)
                    q_texts = [str(q.get("questionText") or "").strip()
                               for q in questions]
                    kind = kc.kind_for_row(profile)
                    role = _KIND_TO_ROLE.get(kind, "teaching")
                    if kind == "watch" and profile.get("question_count"):
                        role = "mixed"
                    info = kc.information_for_item(component_id, item_id) or ""
                    slides.append({
                        "item_id": item_id,
                        "title": str(profile.get("title") or ""),
                        "content_type": str(profile.get("content_type") or ""),
                        "media_format": str(profile.get("media_format") or ""),
                        "role": role,
                        "position": position,
                        "information_to_bot": info,
                        "fingerprint": ci.compute_fingerprint_item(
                            profile.get("title") or "",
                            profile.get("content_type") or "",
                            profile.get("media_format") or "",
                            info, q_texts),
                        "questions": [{
                            "question_id": str(q.get("questionId") or ""),
                            "question_type": str(q.get("questionType") or ""),
                            "question_text": q_texts[index],
                            "answers": [str(a) for a in (q.get("answers") or [])],
                            "correct": [str(a) for a in (q.get("correctAnswers") or [])],
                            "fingerprint": ci.compute_fingerprint_question(
                                q_texts[index],
                                profile.get("title") or "",
                                [t for j, t in enumerate(q_texts)
                                 if j != index and t],
                                info),
                        } for index, q in enumerate(questions)
                            if q.get("questionId") and q_texts[index]],
                    })
                model[component_id] = {
                    # Kata's own id — what its launcher expects since the
                    # 09/2026 URL ids (`component_id` is the slug Yuvi keys
                    # everything by). In memory only: never written.
                    "launch_id": str(component.get("launch_id") or component_id),
                    "subject": subject,
                    "objective_id": objective_id,
                    "objective_title_he": objective_title,
                    "title": str(component.get("title") or ""),
                    "cognitive_level": str(component.get("cognitive_level") or ""),
                    "provider": str(component.get("manufacture") or ""),
                    "kata_updated_at": str(component.get("updated_at") or ""),
                    "component_fingerprint": ci.compute_fingerprint_component(
                        objective_title,
                        component.get("title") or "",
                        [s["fingerprint"] for s in slides]),
                    "slides": slides,
                }
    return model


# ── Stage B: what the committed config says ──────────────────────────────────

def load_committed(out_dir: Path) -> dict[str, dict[str, Any]]:
    """component_id → its committed lomda dict (from whichever shard holds it)."""
    committed: dict[str, dict[str, Any]] = {}
    for path in ci.shard_paths(out_dir):
        try:
            shard = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            print(f"⚠️ committed shard unreadable ({path.name}: {exc}) — "
                  "its lomdot will be treated as new")
            continue
        if ci.validate_shard(shard):
            print(f"⚠️ committed shard invalid ({path.name}) — treated as new")
            continue
        for lomda in shard.get("lomdot") or []:
            cid = str(lomda.get("component_id") or "")
            if cid:
                committed[cid] = lomda
    return committed


def load_index(out_dir: Path) -> dict[str, Any]:
    index_path = out_dir / "index.json"
    if not index_path.exists():
        return {}
    try:
        return json.loads(index_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def load_backlog(out_dir: Path) -> list[str]:
    return [str(c) for c in (load_index(out_dir).get("backlog") or {}).get("browse") or []]


def _newest_stamp(lomda: dict[str, Any]) -> str:
    """The latest thing the pipeline did to a lomda (browse or generation)."""
    stamps = [str((lomda.get("extraction") or {}).get("probed_at") or "")]

    def _collect(texts: Any) -> None:
        for block in (texts or {}).values():
            if isinstance(block, dict):
                stamps.append(str(block.get("generated_at") or ""))

    _collect(lomda.get("texts"))
    for slide in lomda.get("slides") or []:
        _collect(slide.get("texts"))
        for q in slide.get("questions") or []:
            _collect(q.get("texts"))
    return max(stamps)


def _fill_texts(into: dict[str, Any], other: dict[str, Any]) -> None:
    for kind, block in (other.get("texts") or {}).items():
        into.setdefault("texts", {}).setdefault(kind, block)


def merge_carried(
    main: dict[str, dict[str, Any]], carried: dict[str, dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    """The committed state to build tonight on: main, plus the work of every
    earlier night whose pull request is still open.

    The nightly branch is rebuilt from main each night; without this, an
    unmerged PR's generated texts and captures were thrown away and paid for
    again (≈380 texts a night for 8 nights). Per lomda the side the pipeline
    touched last wins; texts and captures the winner lacks are filled from
    the other side. Nothing here is trusted blindly: build_shards still keeps
    a text only when its fingerprint and prompt version are current, and a
    capture only when it re-verifies."""
    merged = {cid: json.loads(json.dumps(lomda)) for cid, lomda in main.items()}
    for cid, lomda in carried.items():
        base = merged.get(cid)
        if base is None:
            merged[cid] = json.loads(json.dumps(lomda))
            continue
        winner, other = (json.loads(json.dumps(lomda)), base) \
            if _newest_stamp(lomda) >= _newest_stamp(base) else (base, lomda)
        _fill_texts(winner, other)
        other_slides = {s.get("item_id"): s for s in other.get("slides") or []}
        for slide in winner.get("slides") or []:
            twin = other_slides.get(slide.get("item_id"))
            if not twin:
                continue
            _fill_texts(slide, twin)
            if not slide.get("enrichment") and twin.get("enrichment") \
                    and twin.get("fingerprint") == slide.get("fingerprint"):
                slide["enrichment"] = twin["enrichment"]
            twin_questions = {q.get("question_id"): q for q in twin.get("questions") or []}
            for q in slide.get("questions") or []:
                if q.get("question_id") in twin_questions:
                    _fill_texts(q, twin_questions[q["question_id"]])
        merged[cid] = winner
    return merged


class UsageLedger:
    """Every model call of this run, from llm.py's observer hook, priced with
    the same table the usage report uses. Written to usage.json and read by
    ``--max-usd`` before each batch."""

    def __init__(self) -> None:
        self.events: list[dict[str, Any]] = []

    def __call__(self, event: dict[str, Any]) -> None:
        usage = event.get("usage") or {}
        self.events.append({
            "operation": event.get("operation"),
            "deployment": event.get("deployment"),
            "model_tier": event.get("model_tier"),
            "status": event.get("status"),
            "input_tokens": usage.get("input_tokens"),
            "cached_input_tokens": usage.get("cached_input_tokens"),
            "output_tokens": usage.get("output_tokens"),
            "reasoning_tokens": usage.get("reasoning_tokens"),
            "latency_ms": event.get("latency_ms"),
            "finish_reason": event.get("finish_reason"),
        })

    @property
    def total_usd(self) -> float:
        from app.services.ai_usage_rollup import event_cost
        return sum(event_cost(e)[0] for e in self.events)

    def summary(self) -> dict[str, Any]:
        from app.services.ai_usage_rollup import event_cost
        by_op: dict[str, dict[str, Any]] = {}
        for e in self.events:
            row = by_op.setdefault(str(e["operation"] or "—"), {
                "calls": 0, "input": 0, "cached": 0, "output": 0, "usd": 0.0})
            row["calls"] += 1
            row["input"] += int(e["input_tokens"] or 0)
            row["cached"] += int(e["cached_input_tokens"] or 0)
            row["output"] += int(e["output_tokens"] or 0)
            row["usd"] += event_cost(e)[0]
        for row in by_op.values():
            row["usd"] = round(row["usd"], 4)
        return {"calls": len(self.events), "usd": round(self.total_usd, 4),
                "by_operation": dict(sorted(by_op.items()))}


# ── Stage C: read what the learner actually sees ─────────────────────────────

async def _launch_url(component_id: str, launch_id: str = "") -> str:
    """A sink-LRS launch of the lomda. Kata's launcher wants ITS id (a URL
    since 09/2026), not the slug the catalog is keyed by — sending the slug
    is what turned every browse into a launch failure from 2026-09-17."""
    from app.services import kata_client

    context = await kata_client.create_launch_context(
        component_id=launch_id or component_id,
        # Unique per mint: the player resumes per (student, component), so a
        # reused id would drop a retry into the middle of last night's walk.
        student_id=f"pipeline-{uuid4().hex[:12]}",
        platform_url="https://pipeline.invalid",
        # A sink, like teacher previews: Kata's forward simply fails, so the
        # probe pollutes no LRS and no learner history.
        lrs_endpoint="https://pipeline.invalid/xapi/",
        lrs_auth="Basic cGlwZWxpbmU=",
    )
    return context["launch_url"]


def launch_failure_verdict(exc: Exception) -> str:
    """Kata said no (4xx) vs Kata could not answer (5xx / network). The first
    is about the id and waits for the catalog to change; the second is
    weather and retries tomorrow — one bucket for both hid a week-long id
    regression behind "404"."""
    upstream = getattr(exc, "upstream_status", None)
    if isinstance(upstream, int) and 400 <= upstream < 500:
        return "launch_rejected"
    if getattr(exc, "status_code", None) == 404:
        return "launch_rejected"
    return "launch_unavailable"


#: Verdicts worth another try on a later night even when the content did not
#: change. A rejected launch is included: the rejection may be ours (the id
#: regression of 2026-09-17), and the browse planner backs it off anyway.
RETRY_VERDICTS = frozenset({
    "driver_error", "timeout", "frame_blocked", "launch_rejected",
    "launch_unavailable", "launch_404",
})


def _run_driver(launch_url: str, dump_path: Path,
                audit_dir: Optional[Path] = None) -> tuple[str, Optional[dict]]:
    """(verdict, dump) from one browser pass over one lomda. ``audit_dir``
    (content_audit.py only, never CI) also saves per-screen screenshots."""
    if not DRIVER.exists():
        return "driver_error", None
    command = ["node", str(DRIVER), "--url", launch_url,
               "--out", str(dump_path), "--max-screens", "40"]
    if audit_dir is not None:
        command += ["--audit-dir", str(audit_dir)]
    try:
        completed = subprocess.run(
            command, cwd=REPO_ROOT / "frontend", capture_output=True,
            text=True, timeout=DRIVER_TIMEOUT_SECONDS)
    except subprocess.TimeoutExpired:
        return "timeout", None
    if completed.returncode != 0:
        tail = (completed.stderr or completed.stdout or "").strip()[-300:]
        print(f"  driver exit {completed.returncode}: {tail}")
        return "driver_error", None
    try:
        dump = json.loads(dump_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return "driver_error", None
    if dump.get("frame_blocked"):
        return "frame_blocked", dump
    if not dump.get("screens"):
        return "driver_error", dump
    return "ok", dump


def _title_score(a: str, b: str) -> int:
    a, b = " ".join(a.split()), " ".join(b.split())
    if not a or not b:
        return 0
    if a == b:
        return 3
    return 2 if (a in b or b in a) else 0


def components_needing_recapture(
    model: dict[str, dict[str, Any]], committed: dict[str, dict[str, Any]],
) -> list[str]:
    """Browsed lomdot whose stored capture predates the current format.

    A capture-format bump (CAPTURE_VERSION) re-queues them even though their
    CONTENT is unchanged: carry-over keeps the old capture (its text still
    grounds generation), but the runtime refuses old-format geometry, so the
    new fields only exist after a re-browse.
    """
    return sorted(
        cid for cid, comp in committed.items()
        if cid in model and any(
            isinstance(s.get("enrichment"), dict)
            and s["enrichment"].get("capture_version") != ci.CAPTURE_VERSION
            for s in comp.get("slides") or [])
    )


def _screen_page_id(screen: dict[str, Any], not_page_ids: set[str]) -> str:
    """The page-shaped id among a screen's announced object ids (see
    browse_component) — last announced wins, own/catalog ids excluded."""
    return next(
        (str(t) for t in reversed(screen.get("vendor_page_ids") or [])
         if str(t) not in not_page_ids), "")


def collapse_stuck_screens(
    screens: list[dict[str, Any]], not_page_ids: set[str],
) -> list[dict[str, Any]]:
    """Drop re-captures of a physical page the walk never actually left.

    Measured 2026-09-01 on `COMPL-00001`: its first page gates navigation
    behind a drag task the walk cannot perform, so every 'advance' click
    re-captured page one — with enough answer-state noise to defeat the
    visible-text hash. The positional mapper then spread FOUR captures of one
    page across four catalog slides: wrong geometry, wrong vendor page id,
    and a vendor map that would move a live learner's position to the wrong
    item. Two same-page signals catch it: the page id the player announces
    (a stuck page re-announces itself, never a new id) and byte-identical
    measured geometry (for players that announce nothing)."""
    kept: list[dict[str, Any]] = []
    seen_page_ids: set[str] = set()
    seen_geometry: set[str] = set()
    for screen in screens:
        page_id = _screen_page_id(screen, not_page_ids)
        breakpoints = screen.get("anchor_breakpoints") or []
        geometry = json.dumps(breakpoints, sort_keys=True, ensure_ascii=False)
        if page_id and page_id in seen_page_ids:
            continue
        if breakpoints and geometry in seen_geometry:
            continue
        if page_id:
            seen_page_ids.add(page_id)
        if breakpoints:
            seen_geometry.add(geometry)
        kept.append(screen)
    return kept


def _variant_signature(slide: dict[str, Any]) -> tuple:
    """Same notion as kata_catalog._variant_signature, over shard-model
    slides: the ordered question texts; empty texts never match."""
    texts = tuple(
        " ".join(str((q or {}).get("question_text") or "").split())
        for q in slide.get("questions") or [])
    return texts if any(texts) else ()


def blank_ambiguous_page_ids(slides: list[dict[str, Any]]) -> None:
    """A page id claimed by slides that are NOT variants of one another names
    at most one of them — mapping any is a coin flip that would move a live
    learner's position pointer to the wrong item. Blank all such claims
    (variant siblings genuinely share their physical page and keep theirs)."""
    claims: dict[str, list[dict[str, Any]]] = {}
    for slide in slides:
        enrichment = slide.get("enrichment")
        if isinstance(enrichment, dict) and enrichment.get("vendor_page_id"):
            claims.setdefault(str(enrichment["vendor_page_id"]), []).append(slide)
    for claimants in claims.values():
        signatures = {_variant_signature(s) for s in claimants}
        if len(claimants) > 1 and (len(signatures) != 1 or () in signatures):
            for slide in claimants:
                slide["enrichment"]["vendor_page_id"] = ""


def map_screens_to_slides(
    screens: list[dict[str, Any]], slides: list[dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    """item_id → captured screen, aligned by order with the player's
    leading-cover offset (≤2, same tolerance as resolve_catalog_item_id).

    The decisive signal is the slide's OWN question text appearing in the
    aligned screen's visible text — measured 2026-09-01 on
    `mass-measure-01-02`: the player opens with a cover the catalog does not
    list, the titles carried no signal, and the old more-screens-aligned bias
    then locked in offset 0 — every enrichment (anchors, vision descriptions,
    pregen keying) landed one slide LATE, so the coach read the cover video
    where the learner saw the photo question."""
    def _question_tokens(slide: dict[str, Any]) -> list[str]:
        questions = slide.get("questions") or []
        text = str((questions[0] or {}).get("question_text") or "") if questions else ""
        return [t for t in text.split() if len(t) >= 3][:10]

    best: tuple[float, int] = (-1.0, 0)   # (score, offset)
    for offset in range(0, 3):
        score = 0.0
        for i, slide in enumerate(slides):
            if i + offset >= len(screens):
                continue
            screen = screens[i + offset]
            score += _title_score(str(screen.get("title") or ""), slide["title"])
            score += 0.5  # slight preference for covering more slides
            # Token overlap, not exact substring — the RENDERED wording drifts
            # from the catalog's question metadata ("ביצעו בשיעור מדעים סדרת"
            # vs "ביצעו סדרת"), and an exact probe silently never fires.
            tokens = _question_tokens(slide)
            visible = " ".join(str(screen.get("visible_text") or "").split())
            if len(tokens) >= 4 and visible:
                hits = sum(1 for token in tokens if token in visible)
                if hits / len(tokens) >= 0.6:
                    score += 5
        if score > best[0]:
            best = (score, offset)
    offset = best[1]
    return {
        slide["item_id"]: screens[i + offset]
        for i, slide in enumerate(slides) if i + offset < len(screens)
    }


def _dedupe_visible_text(visible: str, information: str) -> str:
    """The authored note already reaches the coach; keep only what is new."""
    visible = " ".join(str(visible or "").split())
    for chunk in str(information or "").split("."):
        chunk = chunk.strip()
        if len(chunk) >= 12:
            visible = visible.replace(chunk, " ")
    return " ".join(visible.split())[:4000]


async def browse_component(
    component_id: str, model: dict[str, Any], dump_dir: Path,
    committed_component: Optional[dict[str, Any]] = None,
    audit_dir: Optional[Path] = None,
) -> dict[str, Any]:
    """Attach enrichment to the model's slides; return the extraction record.

    ``committed_component`` is the previously written shard row (if any) — a
    recapture reuses its vision descriptions for graphics whose bytes did not
    change (matched by src digest) instead of re-describing them.
    """
    from app.services.kata_client import KataError

    probed_at = _now_iso()
    try:
        launch_url = await _launch_url(component_id, model.get("launch_id") or "")
    except KataError as exc:
        verdict = launch_failure_verdict(exc)
        return {"verdict": verdict, "probed_at": probed_at,
                "player_host": "", "screens_seen": 0, "screens_mapped": 0}
    except Exception:
        return {"verdict": "driver_error", "probed_at": probed_at,
                "player_host": "", "screens_seen": 0, "screens_mapped": 0}

    host = re.sub(r"^https?://([^/]+).*$", r"\1", launch_url)
    dump_dir.mkdir(parents=True, exist_ok=True)
    verdict, dump = await asyncio.to_thread(
        _run_driver, launch_url, dump_dir / f"{component_id}.json", audit_dir)
    if verdict != "ok":
        return {"verdict": verdict, "probed_at": probed_at, "player_host": host,
                "screens_seen": len((dump or {}).get("screens") or []),
                "screens_mapped": 0}

    # Ids that are NOT a page's own: the component itself and its question
    # ids. Slide item ids are NOT excluded any more: since 09/2026 a CET item
    # id IS the player's page id, and excluding it blanked the one signal
    # that maps a CET screen to its slide exactly.
    not_page_ids = {component_id}
    for slide in model["slides"]:
        for q in slide.get("questions") or []:
            not_page_ids.add(str(q.get("question_id") or ""))
    screens = collapse_stuck_screens(dump["screens"], not_page_ids)
    if any(screen.get("atoms") is not None for screen in screens):
        return _enrich_v8(component_id, model, screens, not_page_ids,
                          committed_component, probed_at, host)
    mapped = map_screens_to_slides(screens, model["slides"])
    # A format-bump recapture replaces the enrichment wholesale, but the
    # vision descriptions in the committed shard are still true for any
    # graphic whose bytes (src digest) did not change — carry them over
    # instead of burning vision calls to re-learn what a picture the pipeline
    # already described shows. A changed digest means changed content:
    # re-vision.
    committed_media = {
        old.get("item_id"): (old.get("enrichment") or {}).get("media") or []
        for old in (committed_component or {}).get("slides") or []
    }
    for slide in model["slides"]:
        screen = mapped.get(slide["item_id"])
        if not screen:
            continue
        prior_descriptions = {
            m.get("src_digest"): m.get("description")
            for m in committed_media.get(slide["item_id"]) or []
            if isinstance(m, dict) and m.get("src_digest") and m.get("description")
        }
        slide["enrichment"] = {
            "visible_text": _dedupe_visible_text(
                screen.get("visible_text") or "", slide["information_to_bot"]),
            "media": [m for m in (screen.get("media") or [])
                      if isinstance(m, dict)][:12],
            "question_rendering": screen.get("question_rendering"),
            "anchors": [a for a in (screen.get("anchors") or [])
                        if isinstance(a, dict)
                        and a.get("region") in ci.ANCHOR_REGIONS],
            # Geometry per capture SIZE (v6: a width × height grid): the
            # runtime bilinear-interpolates its live box between the four
            # surrounding samples — the only mapping that survives a
            # transform-scaling player, a reflowing one, AND a viewport-
            # fitting one, with no vendor detection.
            "anchor_breakpoints": [
                {"w": bp.get("w"), "h": bp.get("h"),
                 "content_w": bp.get("content_w"),
                 "content_h": bp.get("content_h"),
                 "anchors": [a for a in (bp.get("anchors") or [])
                             if isinstance(a, dict)
                             and a.get("region") in ci.ANCHOR_REGIONS]}
                for bp in (screen.get("anchor_breakpoints") or [])
                if isinstance(bp, dict)
            ],
            "capture_viewport": screen.get("capture_viewport") or {},
            "no_internal_scroll": bool(screen.get("no_internal_scroll")),
            # The player's own id for this page (from its xAPI narration
            # during the walk) — lets the runtime move the position pointer
            # when a live learner navigates or resumes to it.
            "vendor_page_id": _screen_page_id(screen, not_page_ids),
            # A walker without the object census yields the v7 format.
            "capture_version": 7,
            "captured_at": probed_at,
        }
        for m in slide["enrichment"]["media"]:
            carried = prior_descriptions.get(m.get("src_digest"))
            if carried and not m.get("description"):
                m["description"] = carried
    blank_ambiguous_page_ids(model["slides"])
    return {
        "verdict": "extracted" if len(mapped) == len(model["slides"]) else "partial",
        "probed_at": probed_at,
        "player_host": host,
        "screens_seen": len(screens),
        "screens_mapped": len(mapped),
    }


def _strictly_visible_text(screen: dict[str, Any]) -> str:
    """What the learner can actually read: the census's visible, unoccluded
    text in reading order. `innerText` also returned flip-card backs and
    collapsed feedback panels (a leak vector: "לא נכון…")."""
    atoms = [a for a in screen.get("atoms") or []
             if a.get("kind") in ("text", "option", "table_row") and a.get("text")]
    atoms.sort(key=lambda a: a.get("order", 0))
    seen: list[str] = []
    for atom in atoms:
        text = " ".join(str(atom["text"]).split())
        if any(text in other for other in seen):
            continue
        seen = [other for other in seen if other not in text] + [text]
    return " ".join(seen)[:4000] if seen else " ".join(
        str(screen.get("visible_text") or "").split())[:4000]


def _enrich_v8(
    component_id: str, model: dict[str, Any], screens: list[dict[str, Any]],
    not_page_ids: set[str], committed_component: Optional[dict[str, Any]],
    probed_at: str, host: str,
) -> dict[str, Any]:
    """Capture v8: verified screen→slide assignment, then the object catalog."""
    assigned = objects_lib.assign_screens(
        screens, model["slides"], lambda screen: _screen_page_id(screen, not_page_ids))
    decorative = objects_lib.decorative_image_digests(screens)
    committed_media = {
        old.get("item_id"): (old.get("enrichment") or {}).get("media") or []
        for old in (committed_component or {}).get("slides") or []
    }
    methods: dict[str, int] = {}
    for slide in model["slides"]:
        match = assigned.get(slide["item_id"])
        if not match:
            continue
        screen, method = match["screen"], match["method"]
        methods[method] = methods.get(method, 0) + 1
        objects, rejections = objects_lib.build_objects(
            screen, slide, decorative_digests=decorative)
        prior_descriptions = {
            m.get("src_digest"): m.get("description")
            for m in committed_media.get(slide["item_id"]) or []
            if isinstance(m, dict) and m.get("src_digest") and m.get("description")
        }
        media = [m for m in (screen.get("media") or []) if isinstance(m, dict)
                 and m.get("src_digest") not in decorative][:12]
        for entry in media:
            carried = prior_descriptions.get(entry.get("src_digest"))
            if carried and not entry.get("description"):
                entry["description"] = carried
        slide["enrichment"] = {
            "visible_text": _dedupe_visible_text(
                _strictly_visible_text(screen), slide["information_to_bot"]),
            "media": media,
            "question_rendering": screen.get("question_rendering"),
            "mapping": {"method": method, "screen": int(screen.get("index") or 0)},
            "layout": screen.get("layout") or {"kind": "height_dependent",
                                               "natural_h": None, "tall": []},
            "grid": screen.get("grid") or [],
            "objects": objects,
            "vendor_page_id": _screen_page_id(screen, not_page_ids),
            "capture_version": ci.CAPTURE_VERSION,
            "captured_at": probed_at,
        }
        slide["_rejections"] = rejections  # run log only; never written
    blank_ambiguous_page_ids(model["slides"])
    mapped = sum(1 for s in model["slides"] if s.get("enrichment"))
    return {
        "verdict": "extracted" if mapped == len(model["slides"]) else "partial",
        "probed_at": probed_at,
        "player_host": host,
        "screens_seen": len(screens),
        "screens_mapped": mapped,
        "mapping": dict(sorted(methods.items())),
        "walker_version": 8,
    }


# ── Stage C2: describe the graphics the walk photographed ────────────────────

_VISION_PROMPT = (
    "אלה צילומים של אלמנטים גרפיים ממסך לימוד בשם \"{title}\". לכל תמונה, "
    "באותו סדר, כתוב בעברית:\n"
    "- label: שם קצר לדבר עצמו, 2–5 מילים, כמו שמורה היה מצביע עליו "
    "(\"המאזניים עם שתי התיבות\", \"מערכת הצירים\", \"טבלת המסות\"). בלי "
    "שיפוט (נכון/שגוי) ובלי לרמוז לתשובה.\n"
    "- description: תיאור קצר (עד 25 מילים) של מה שרואים בפועל — אנשים, "
    "חפצים, תרשימים, צירים, נקודות, טקסט מסומן. אל תמציא דבר שלא נראה.\n"
    "- decor: true רק אם זה קישוט שאינו חלק מהתוכן (דמות מלווה, לוגו, אייקון).\n"
    "החזר JSON בלבד: {{\"items\": [{{\"label\": \"...\", \"description\": "
    "\"...\", \"decor\": false}}]}} — פריט אחד לכל תמונה, באותו סדר."
)


async def describe_graphics(
    model: dict[str, dict[str, Any]], browsed: list[str], max_calls: int,
) -> int:
    """Vision pass over freshly captured crops → Hebrew media descriptions.

    One call per screen (all its crops as image parts). A miss leaves the
    entry description-less — the context line falls back to alt/title, and
    the next browse retries. Returns the number of calls spent.
    """
    from app.services.llm import call_llm

    usage = UsageContext(
        actor_id="content-pipeline", actor_type="system",
        endpoint="script:content_pipeline", feature="content_pipeline",
        operation="content.vision_descriptions", source="content_pipeline",
    )
    calls = 0
    for cid in browsed:
        for slide in model.get(cid, {}).get("slides") or []:
            enrichment = slide.get("enrichment") or {}
            entries = [m for m in enrichment.get("media") or []
                       if isinstance(m, dict) and m.get("shot_b64")]
            if not entries or calls >= max_calls:
                continue
            content: list[dict[str, Any]] = [{
                "type": "text",
                "text": _VISION_PROMPT.format(title=slide.get("title") or ""),
            }]
            for entry in entries:
                content.append({"type": "image_url", "image_url": {
                    "url": f"data:image/jpeg;base64,{entry['shot_b64']}"}})
            calls += 1
            raw = await call_llm(
                [{"role": "user", "content": content}],
                usage_context=usage.for_operation("content.vision_descriptions"),
                max_tokens=500, json_mode=True, model_tier="mini",
            )
            try:
                payload = json.loads(raw or "{}")
            except (TypeError, ValueError):
                payload = {}
            rows = payload.get("items") or [
                {"description": d} for d in payload.get("descriptions") or []]
            # A reply with a different count cannot be paired back by order —
            # zip would shift every later description onto the wrong picture.
            if len(rows) != len(entries):
                continue
            for entry, row in zip(entries, rows):
                row = row if isinstance(row, dict) else {"description": row}
                text = str(row.get("description") or "").strip()[:200]
                if text and _HEBREW.search(text):
                    entry["description"] = text
                label = " ".join(str(row.get("label") or "").split())[:40]
                if label and _HEBREW.search(label):
                    entry["label"] = label
                if row.get("decor") is True:
                    entry["decor"] = True
    return calls


def apply_graphic_labels(model: dict[str, dict[str, Any]], browsed: list[str]) -> None:
    """Carry the vision pass onto the v8 objects: an image object takes its
    picture's vetted label; a picture the model called decoration stops
    being pointable. Labels pass the same checks as every public label."""
    for cid in browsed:
        # The walker crops a picture once, on the first screen it appears on,
        # so the vision verdict lands there. The same picture on a later
        # screen (the lesson mascot on every question) must get it too.
        verdicts: dict[str, dict[str, Any]] = {}
        for slide in model.get(cid, {}).get("slides") or []:
            for m in (slide.get("enrichment") or {}).get("media") or []:
                if isinstance(m, dict) and m.get("src_digest") and (m.get("label") or m.get("decor")):
                    verdicts.setdefault(str(m["src_digest"]), m)
        for slide in model.get(cid, {}).get("slides") or []:
            for m in (slide.get("enrichment") or {}).get("media") or []:
                seen = verdicts.get(str(m.get("src_digest") or "")) if isinstance(m, dict) else None
                if seen and seen is not m:
                    for key in ("label", "decor", "description"):
                        if seen.get(key) and not m.get(key):
                            m[key] = seen[key]
        for slide in model.get(cid, {}).get("slides") or []:
            enrichment = slide.get("enrichment") or {}
            if enrichment.get("capture_version") != 8:
                continue
            questions = slide.get("questions") or []
            guards = [objects_lib.answer_guard.AnswerGuard(
                q.get("correct") or [], q.get("answers") or []) for q in questions]
            correct = [str(c) for q in questions for c in q.get("correct") or []]
            by_digest = {str(m.get("src_digest") or "").replace("sha1:", "")[:8]: m
                         for m in enrichment.get("media") or []
                         if isinstance(m, dict) and m.get("src_digest")}
            kept = []
            for obj in enrichment.get("objects") or []:
                if obj.get("kind") == "image":
                    digest = obj["id"].split(":", 1)[1].split(".", 1)[0]
                    media = by_digest.get(digest) or {}
                    if media.get("decor"):
                        continue
                    label = str(media.get("label") or "")
                    if label and objects_lib._label_ok(label, guards, correct):
                        obj["label_he"] = label
                kept.append(obj)
            enrichment["objects"] = kept
            enrichment["media"] = [m for m in enrichment.get("media") or []
                                   if not (isinstance(m, dict) and m.get("decor"))]


def strip_capture_bytes(model: dict[str, dict[str, Any]]) -> None:
    """Image bytes never reach a shard — described or not, they go here."""
    for comp in model.values():
        for slide in comp.get("slides") or []:
            for entry in (slide.get("enrichment") or {}).get("media") or []:
                if isinstance(entry, dict):
                    entry.pop("shot_b64", None)


# ── Stage D: regenerate what went stale ──────────────────────────────────────

_KIND_RULES = {
    "lesson_welcome": (
        "פסקת פתיחה קצרה לשיעור — מה לומדים בו ולמה זה מעניין. בלי שם הלומד/ת, "
        "בלי ברכת שלום (היא נוספת בנפרד), בלי אימוג'י, ניסוח נטול מגדר."),
    "lesson_step_intro": (
        "פתיח קצר וקליל למסך — משפט אחד שמסמן על מה המסך ומזמין להיכנס אליו. "
        "פתיח, לא תקציר: אסור לסכם או לחזור על התוכן שמופיע במסך עצמו, אסור "
        "לחשוף תשובות. בלי אימוג'י, ניסוח נטול מגדר."),
    "video_summary": (
        "סיכום קצר של מה שמלמד הסרטון או המדיה שבמסך, מבוסס אך ורק על הטקסט "
        "שסופק. בלי להמציא פרטים שלא נכתבו."),
    "question_intro": (
        "פתיח קצר לשאלה — משפט אחד-שניים שאומרים באיזה נושא השאלה עוסקת ואיזה "
        "סוג חשיבה היא מבקשת (השערה, חישוב, השוואה…), ומזמינים לנסות. פתיח, "
        "לא ניסוח מחדש: אסור לחזור על תוכן השאלה או לנסח אותה מחדש במילים "
        "אחרות — היא כבר כתובה על המסך. אסור לרמוז לתשובה או לכיוון פתרון. "
        "ניסוח נטול מגדר."),
    "hint_l1": (
        "רמז ראשון ועדין: לאן להסתכל או איך לגשת — צעד חשיבה אחד, לא התשובה "
        "ולא חלק ממנה. אסור שהתשובה הנכונה תופיע בטקסט."),
    "explanation": (
        "הסבר קצר של הרעיון שהשאלה בודקת, מבוסס רק על החומר שסופק. אסור לחשוף "
        "במפורש איזו תשובה נכונה."),
}

_GENERATION_PROMPT = """אתה כותב טקסטים קצרים בעברית עבור יובי, מלווה למידה לתלמידי חטיבת ביניים.
כל שורה למטה היא בקשה אחת: סוג טקסט + ההקשר המלא שלו. כתוב אך ורק מתוך ההקשר
שסופק — אסור להמציא עובדות, מספרים או דוגמאות שאינם בו. אם ההקשר דל מכדי לכתוב
טקסט מבוסס, דלג על השורה (אל תחזיר אותה).
מותר עיצוב מרקדאון קל: **הדגשה** למונח מפתח אחד או שניים בהודעה, כשזה מוסיף
בהירות. בלי כותרות, בלי רשימות, בלי קישורים.

{rows}

החזר JSON בלבד:
{{"rows": [{{"id": "המזהה שסופק, מועתק במדויק", "text": "..."}}]}}
"""


_SENTENCES = re.compile(r"(?<=[.!?…])\s+|\n+")


def _singles_out(question: dict[str, Any]) -> bool:
    """Can naming an option give this question away? Not when there is no
    distractor to tell it from (one option, or most options correct), and
    not for matching/drag answers stored as structured pairs — there the
    option words are the lesson's own vocabulary (ברוטו/נטו/טרה), and a
    text that names them teaches, it does not answer. Measured on the
    committed texts 2026-09-24: these three shapes were 3 of the 4 hits."""
    correct = [str(c) for c in question.get("correct") or []]
    options = [str(a) for a in question.get("answers") or []]
    if not correct or any(c.lstrip()[:1] in "{[" for c in correct):
        return False
    distractors = [o for o in options if o not in correct]
    return len(distractors) >= len(correct)


def leaks_an_answer(text: str, questions: list[dict[str, Any]]) -> bool:
    """The runtime's own answer guard, sentence by sentence, against every
    question the text could be about — plus "the answer is…" in any form.
    One check for generation, the carried texts and graphic descriptions:
    the weaker substring test it replaces let "**12.1**" and a reworded
    correct option through."""
    if answer_guard.asserts_an_answer(text):
        return True
    guards = [answer_guard.AnswerGuard(
        [str(c) for c in q.get("correct") or []],
        [str(a) for a in q.get("answers") or []]) for q in questions if _singles_out(q)]
    guards = [g for g in guards if g.active]
    return any(g.reveals(sentence)
               for sentence in _SENTENCES.split(str(text or "")) if sentence.strip()
               for g in guards)


#: Sections of a vendor's authored note that describe the ANSWER, not the
#: content: "סימני שליטה" (what a learner who got it does/answers) and graded
#: hint ladders. An opener written from them foreshadows the answer.
_ANSWER_SECTIONS = re.compile(
    r"(?:סימני\s+שליטה|רמזים\s+מדורגים|התשובה\s+הנכונה)[^\n]*(?:\n(?!\s*\n)[^\n]*)*",
)


def _authored_note(info: str) -> str:
    """The authored note without its answer-describing sections."""
    return _ANSWER_SECTIONS.sub(" ", str(info or ""))


def collect_generation_targets(
    model: dict[str, dict[str, Any]], committed: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    """Every text slot whose authored source drifted from its stored block."""

    def _stale(existing: Optional[dict], fingerprint: str, kind: str) -> bool:
        return not (
            isinstance(existing, dict)
            and existing.get("prompt_version") == ci.prompt_version_for(kind)
            and existing.get("source_fingerprint") == fingerprint
            and str(existing.get("he") or "").strip())

    targets: list[dict[str, Any]] = []
    for cid, comp in model.items():
        old = committed.get(cid) or {}
        # Renamed items keep their texts (fingerprints never included the id):
        # on 09-24 a Kata rename threw away 444 still-valid question texts.
        prior = objects_lib.match_prior_slides(comp["slides"], old.get("slides") or [])
        old_slides = {iid: match[0] for iid, match in prior.items()}
        if _stale((old.get("texts") or {}).get("lesson_welcome"),
                  comp["component_fingerprint"], "lesson_welcome"):
            targets.append({
                "id": f"{cid}|||lesson_welcome", "kind": "lesson_welcome",
                "fingerprint": comp["component_fingerprint"], "correct": [],
                # A welcome speaks about the whole lesson: only "the answer
                # is…" is checked — its vocabulary IS the options' vocabulary.
                "questions": [],
                "context": {
                    "objective": comp["objective_title_he"],
                    "lesson_title": comp["title"],
                    "screens": [s["title"] for s in comp["slides"] if s["title"]][:12],
                },
            })
        for slide in comp["slides"]:
            old_slide = old_slides.get(slide["item_id"]) or {}
            old_texts = old_slide.get("texts") or {}
            enrichment = slide.get("enrichment") or old_slide.get("enrichment") or {}
            base_context = {
                "lesson_title": comp["title"],
                "screen_title": slide["title"],
                "screen_role": slide["role"],
                "authored_note": _authored_note(slide["information_to_bot"])[:1200],
                "visible_on_screen": str(enrichment.get("visible_text") or "")[:1200],
            }
            wanted_kinds = []
            # Video screens too: the client asks for a step intro on every
            # non-question screen, so a pure video screen always missed.
            if slide["role"] in ("teaching", "mixed", "video"):
                wanted_kinds.append("lesson_step_intro")
            if slide["role"] in ("video", "mixed") and (
                    slide["information_to_bot"] or enrichment.get("visible_text")):
                wanted_kinds.append("video_summary")
            for kind in wanted_kinds:
                if _stale(old_texts.get(kind), slide["fingerprint"], kind):
                    targets.append({
                        "id": f"{cid}|{slide['item_id']}||{kind}", "kind": kind,
                        "fingerprint": slide["fingerprint"], "correct": [],
                        "questions": slide["questions"],
                        "context": base_context,
                    })
            old_questions = {q.get("question_id"): q
                            for q in old_slide.get("questions") or []}
            for question in slide["questions"]:
                old_q_texts = (old_questions.get(question["question_id"]) or {}) \
                    .get("texts") or {}
                for kind in ci.QUESTION_TEXT_KINDS:
                    if _stale(old_q_texts.get(kind), question["fingerprint"], kind):
                        targets.append({
                            "id": (f"{cid}|{slide['item_id']}|"
                                   f"{question['question_id']}|{kind}"),
                            "kind": kind,
                            "fingerprint": question["fingerprint"],
                            "correct": question["correct"],
                            "questions": [question],
                            "context": {
                                **base_context,
                                "question_text": question["question_text"],
                                "options": question["answers"][:12],
                                "part_siblings": [
                                    q["question_text"] for q in slide["questions"]
                                    if q["question_id"] != question["question_id"]][:3],
                            },
                        })
    return targets


#: When the budget cannot cover every stale row, the ones a learner meets
#: first go first: an arrival text saves a live model call on EVERY visit.
GENERATION_PRIORITY = ("question_intro", "lesson_step_intro", "lesson_welcome",
                       "video_summary", "hint_l1", "explanation")


def order_targets(targets: list[dict[str, Any]], rotation: int) -> list[dict[str, Any]]:
    """Priority by kind, then a nightly rotation inside each kind — a row the
    model keeps rejecting cannot hold the head of the queue night after
    night and starve the rows behind it."""
    by_kind: dict[str, list[dict[str, Any]]] = {}
    for target in sorted(targets, key=lambda t: t["id"]):
        by_kind.setdefault(target["kind"], []).append(target)
    ordered: list[dict[str, Any]] = []
    for kind in sorted(by_kind, key=lambda k: (
            GENERATION_PRIORITY.index(k) if k in GENERATION_PRIORITY else 99, k)):
        rows = by_kind[kind]
        shift = rotation % len(rows)
        ordered.extend(rows[shift:] + rows[:shift])
    return ordered


def vet_generated(text: str, target: dict[str, Any]) -> Optional[str]:
    """None when the text may be stored, else the rejection reason."""
    if not text:
        return "empty"
    if len(text) > ci.TEXT_LENGTH_CAPS[target["kind"]]:
        return "too_long"
    if not _HEBREW.search(text):
        return "not_hebrew"
    if leaks_an_answer(text, target.get("questions") or []):
        return "answer_guard"   # a hint that says the answer is not a hint
    return None


async def generate_texts(
    targets: list[dict[str, Any]], max_calls: int,
    rejections: Optional[dict[str, int]] = None,
    should_stop: Any = None,
) -> dict[str, dict[str, Any]]:
    """target id → generation block, for every row that survived validation.

    ``rejections`` (mutated) counts why rows were refused — the PR body shows
    it, so a prompt that stopped working is a number, not a mystery.
    ``should_stop()`` is asked before every call (the run's spend cap)."""
    from app.services.llm import call_llm

    rejections = rejections if rejections is not None else {}

    def _reject(reason: str, count: int = 1) -> None:
        rejections[reason] = rejections.get(reason, 0) + count

    generated: dict[str, dict[str, Any]] = {}
    calls = 0
    generated_at = _now_iso()
    usage = UsageContext(
        actor_id="content-pipeline", actor_type="system",
        endpoint="script:content_pipeline", feature="content_pipeline",
        operation="content.pregen_texts", source="content_pipeline",
    )
    for start in range(0, len(targets), BATCH):
        if calls >= max_calls or (should_stop and should_stop()):
            break
        batch = targets[start:start + BATCH]
        rows = "\n\n".join(
            f"- id: {t['id']}\n"
            f"  סוג: {t['kind']} — {_KIND_RULES[t['kind']]}\n"
            f"  הקשר: {json.dumps(t['context'], ensure_ascii=False)[:2400]}"
            + (f"\n  התשובות הנכונות (לביסוס בלבד, אסור לחשוף או לצטט): "
               f"{json.dumps(t['correct'], ensure_ascii=False)}"
               if t["correct"] and t["kind"] in ("hint_l1", "explanation") else "")
            for t in batch)
        calls += 1
        raw = await call_llm(
            [{"role": "user",
              "content": _GENERATION_PROMPT.format(rows=rows)}],
            usage_context=usage.for_operation("content.pregen_texts.batch"),
            max_tokens=1800, json_mode=True, model_tier="mini",
        )
        try:
            payload = json.loads(raw or "{}")
        except (TypeError, ValueError):
            print("  ⚠️ unparseable generation batch, rows stay pending")
            _reject("unparseable_batch", len(batch))
            continue
        wanted = {t["id"]: t for t in batch}
        answered: set[str] = set()
        for entry in payload.get("rows") or []:
            if not isinstance(entry, dict):
                continue
            target = wanted.get(str(entry.get("id") or ""))
            if target is None:
                continue  # a renamed row cannot be matched back — drop it
            answered.add(target["id"])
            text = str(entry.get("text") or "").strip()
            reason = vet_generated(text, target)
            if reason:
                _reject(reason)
                continue
            generated[target["id"]] = {
                "he": text,
                "prompt_version": ci.prompt_version_for(target["kind"]),
                "source_fingerprint": target["fingerprint"],
                "generated_at": generated_at,
                "model": "mini",
            }
        if len(answered) < len(batch):
            _reject("missing_row", len(batch) - len(answered))
    return generated


def scan_leaks(
    model: dict[str, dict[str, Any]], shards: dict[Path, dict[str, Any]],
    decisions: list[dict[str, Any]],
) -> int:
    """Remove every committed text and graphic description that gives an
    answer away, whenever it was written. The catalog's correct answers are
    in memory here and nowhere else; each removal is recorded (reason code
    only) so the guard can tell it from a silent loss. Returns the count."""
    removed = 0
    for shard in shards.values():
        for lomda in shard.get("lomdot") or []:
            cid = lomda["component_id"]
            live = {s["item_id"]: s for s in (model.get(cid) or {}).get("slides") or []}
            for kind in list((lomda.get("texts") or {})):
                if leaks_an_answer(str(lomda["texts"][kind].get("he") or ""), []):
                    del lomda["texts"][kind]
                    decisions.append({"cid": cid, "iid": "", "what": f"text::{kind}",
                                      "action": "removed", "reason": "answer_guard"})
                    removed += 1
            for slide in lomda.get("slides") or []:
                iid = slide["item_id"]
                questions = (live.get(iid) or {}).get("questions") or []
                for kind in list(slide.get("texts") or {}):
                    if leaks_an_answer(str(slide["texts"][kind].get("he") or ""), questions):
                        del slide["texts"][kind]
                        decisions.append({"cid": cid, "iid": iid, "what": f"text::{kind}",
                                          "action": "removed", "reason": "answer_guard"})
                        removed += 1
                by_id = {q["question_id"]: q for q in questions}
                for question in slide.get("questions") or []:
                    qid = question["question_id"]
                    mine = [by_id[qid]] if qid in by_id else questions
                    for kind in list(question.get("texts") or {}):
                        if leaks_an_answer(str(question["texts"][kind].get("he") or ""), mine):
                            del question["texts"][kind]
                            decisions.append({"cid": cid, "iid": iid,
                                              "what": f"text:{qid}:{kind}",
                                              "action": "removed", "reason": "answer_guard"})
                            removed += 1
                for media in (slide.get("enrichment") or {}).get("media") or []:
                    if isinstance(media, dict) and media.get("description") and \
                            leaks_an_answer(str(media["description"]), questions):
                        media.pop("description", None)
                        decisions.append({"cid": cid, "iid": iid, "what": "media",
                                          "action": "removed", "reason": "answer_guard"})
                        removed += 1
    return removed


# ── Stage E: write the shards ────────────────────────────────────────────────

def build_shards(
    model: dict[str, dict[str, Any]],
    committed: dict[str, dict[str, Any]],
    extractions: dict[str, dict[str, Any]],
    generated: dict[str, dict[str, Any]],
    decisions: Optional[list[dict[str, Any]]] = None,
) -> dict[Path, dict[str, Any]]:
    """Relative shard path → shard document, answers stripped by construction."""

    def _keep(existing: Optional[dict], fingerprint: str, kind: str) -> Optional[dict]:
        if (isinstance(existing, dict)
                and existing.get("prompt_version") == ci.prompt_version_for(kind)
                and existing.get("source_fingerprint") == fingerprint
                and str(existing.get("he") or "").strip()):
            return existing
        return None

    def _texts(target_prefix: str, kinds: tuple, existing: dict,
               fingerprint: str) -> dict[str, Any]:
        out = {}
        for kind in kinds:
            block = generated.get(f"{target_prefix}|{kind}") \
                or _keep(existing.get(kind), fingerprint, kind)
            if block:
                out[kind] = block
        return out

    shards: dict[Path, dict[str, Any]] = {}
    for cid, comp in sorted(model.items()):
        path = Path(comp["subject"]) / f"{comp['objective_id'] or 'no-objective'}.json"
        shard = shards.setdefault(path, {
            "schema_version": ci.SCHEMA_VERSION,
            "subject": comp["subject"],
            "objective_id": comp["objective_id"],
            "objective_title_he": comp["objective_title_he"],
            "lomdot": [],
        })
        old = committed.get(cid) or {}
        prior = objects_lib.match_prior_slides(comp["slides"], old.get("slides") or [])
        slides_out = []
        for slide in comp["slides"]:
            old_slide, capture_may_carry = prior.get(slide["item_id"], ({}, False))
            enrichment = slide.get("enrichment")
            if enrichment is None and capture_may_carry and old_slide.get("enrichment") \
                    and old_slide.get("fingerprint") == slide["fingerprint"]:
                carried = old_slide["enrichment"]
                ok, reason = objects_lib.reverify_capture(slide, carried)
                if carried.get("capture_version") in ci.CAPTURE_COMPAT and ok:
                    enrichment = carried  # unchanged slide (maybe renamed): keep capture
                elif decisions is not None:
                    decisions.append({"cid": cid, "iid": slide["item_id"],
                                      "what": "enrichment", "action": "dropped",
                                      "reason": reason if not ok else "old capture format"})
            questions_out = []
            old_questions = {q.get("question_id"): q
                            for q in old_slide.get("questions") or []}
            for question in slide["questions"]:
                qid = question["question_id"]
                questions_out.append({
                    "question_id": qid,
                    "question_type": question["question_type"],
                    "question_text": question["question_text"],
                    "answers": question["answers"],
                    "fingerprint": question["fingerprint"],
                    "texts": _texts(
                        f"{cid}|{slide['item_id']}|{qid}",
                        ci.QUESTION_TEXT_KINDS,
                        (old_questions.get(qid) or {}).get("texts") or {},
                        question["fingerprint"]),
                })
            row: dict[str, Any] = {
                "item_id": slide["item_id"],
                "title": slide["title"],
                "content_type": slide["content_type"],
                "media_format": slide["media_format"],
                "role": slide["role"],
                "position": slide["position"],
                "fingerprint": slide["fingerprint"],
                # information_to_bot is NOT written: it carries answers
                # ("סימני שליטה") and the runtime reads it live from Kata.
                "texts": _texts(f"{cid}|{slide['item_id']}|",
                                ci.ITEM_TEXT_KINDS,
                                old_slide.get("texts") or {},
                                slide["fingerprint"]),
                "questions": questions_out,
            }
            if enrichment:
                row["enrichment"] = enrichment
            slides_out.append(row)
        extraction = dict(extractions.get(cid) or old.get("extraction") or {
            "verdict": "not_attempted", "probed_at": "", "player_host": "",
            "screens_seen": 0, "screens_mapped": 0,
        })
        # Honest record: "extracted 2/2" with zero captures on disk is how a
        # regression hid for a week. Count what is actually written.
        extraction["screens_mapped"] = sum(1 for row in slides_out if row.get("enrichment"))
        shard["lomdot"].append({
            "component_id": cid,
            "title": comp["title"],
            "cognitive_level": comp["cognitive_level"],
            "provider": comp["provider"],
            "kata_updated_at": comp["kata_updated_at"],
            "component_fingerprint": comp["component_fingerprint"],
            "extraction": extraction,
            "texts": _texts(f"{cid}||", ci.COMPONENT_TEXT_KINDS,
                            old.get("texts") or {},
                            comp["component_fingerprint"]),
            "slides": slides_out,
        })
    return shards


# Fields that say WHEN, not WHAT. A re-browse that measures a lomda and finds
# it exactly as before still stamps a fresh probed_at/captured_at; the vendor
# re-saves a lomda without touching it and kata_updated_at moves. Left alone,
# each of those rewrites a shard and the nightly opens a pull request whose
# whole diff is dates. The writer compares without them and keeps the old
# file — old stamps included — when nothing else moved.
STAMP_KEYS = frozenset({"generated_at", "probed_at", "captured_at",
                        "kata_updated_at"})


def _without_stamps(value: Any) -> Any:
    if isinstance(value, dict):
        return {k: _without_stamps(v) for k, v in value.items()
                if k not in STAMP_KEYS}
    if isinstance(value, list):
        return [_without_stamps(v) for v in value]
    return value


def _materially_equal(existing: str, payload: str) -> bool:
    """True when the two JSON documents differ in stamps only."""
    try:
        return _without_stamps(json.loads(existing)) == \
            _without_stamps(json.loads(payload))
    except json.JSONDecodeError:
        return False


def write_output(
    out_dir: Path, shards: dict[Path, dict[str, Any]],
    backlog_browse: list[str], stats: dict[str, Any],
    browse_state: Optional[dict[str, dict[str, Any]]] = None,
) -> bool:
    """Write shards + index; prune shards for objectives that vanished.
    Returns True when anything other than a timestamp changed — a file whose
    only news is a date is left exactly as it was."""
    changed = False
    wanted_paths = set()
    for rel_path, shard in shards.items():
        target = out_dir / rel_path
        wanted_paths.add(target)
        target.parent.mkdir(parents=True, exist_ok=True)
        payload = ci.dump_shard(shard)
        if not target.exists() or not _materially_equal(
                target.read_text(encoding="utf-8"), payload):
            target.write_text(payload, encoding="utf-8")
            changed = True
    for stale in set(ci.shard_paths(out_dir)) - wanted_paths:
        stale.unlink()
        changed = True
    index = {
        "schema_version": ci.SCHEMA_VERSION,
        "prompt_version": ci.PROMPT_VERSION,
        "generated_at": _now_iso(),
        "shards": [{
            "subject": shard["subject"],
            "objective_id": shard["objective_id"],
            "path": str(rel_path),
            "lomdot": len(shard["lomdot"]),
        } for rel_path, shard in sorted(shards.items())],
        "backlog": {"browse": sorted(set(backlog_browse))},
        # Day-granular browse outcomes (content_browse.record_attempt): the
        # backoff that stops one failing lomda from heading every night.
        "browse_state": browse_state or {},
        "stats": stats,
    }
    index_path = out_dir / "index.json"
    # `stats` is this run's tally (how many texts it generated, how many it
    # left pending) — a run log, not content; it rides along with a real
    # change and never justifies one on its own.
    volatile = STAMP_KEYS | {"stats"}
    stable = {k: v for k, v in index.items() if k not in volatile}
    previous: dict[str, Any] = {}
    if index_path.exists():
        try:
            previous = json.loads(index_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            previous = {}
    if {k: v for k, v in previous.items() if k not in volatile} != stable:
        index_path.write_text(
            json.dumps(index, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8")
        changed = True
    return changed


# ── migrations over the committed shards (no network) ───────────────────────

def _strip_banned(value: Any) -> Any:
    """Drop every key the contract bans (answers, answer-bearing notes)."""
    if isinstance(value, dict):
        return {k: _strip_banned(v) for k, v in value.items()
                if k not in ci.FORBIDDEN_KEYS}
    if isinstance(value, list):
        return [_strip_banned(v) for v in value]
    return value


def _honest_captures(shard: dict[str, Any]) -> None:
    """Captures the runtime cannot read, or that fail re-verification (the
    screen they show is not their slide), go; every extraction record then
    counts what is really written. Needs no catalog: a shard slide carries
    its title and question texts."""
    for lomda in shard.get("lomdot") or []:
        slides = lomda.get("slides") or []
        for slide in slides:
            enrichment = slide.get("enrichment")
            if not isinstance(enrichment, dict):
                continue
            if enrichment.get("capture_version") not in ci.CAPTURE_COMPAT \
                    or not objects_lib.reverify_capture(slide, enrichment)[0]:
                del slide["enrichment"]
        extraction = lomda.get("extraction")
        if isinstance(extraction, dict):
            extraction["screens_mapped"] = sum(
                1 for s in slides if isinstance(s.get("enrichment"), dict))


def migrate_committed_shards(out_dir: Path) -> int:
    """Rewrite the committed shards through today's contract without touching
    the catalog: banned keys go, unverifiable captures go, extraction records
    turn honest, the serializer re-orders. Returns the number of files
    rewritten. Idempotent — a second run rewrites nothing."""
    rewritten = 0
    for path in ci.shard_paths(out_dir):
        original = path.read_text(encoding="utf-8")
        shard = _strip_banned(json.loads(original))
        _honest_captures(shard)
        payload = ci.dump_shard(shard)
        if payload != original:
            path.write_text(payload, encoding="utf-8")
            rewritten += 1
    return rewritten


# ── orchestration ────────────────────────────────────────────────────────────

async def run(args: argparse.Namespace) -> int:
    out_dir = Path(args.out_dir)
    dump_dir = Path(args.browser_dump_dir)

    print("→ fetching the live catalog…")
    model = await fetch_catalog_model()
    if not model:
        print("no components returned — is KATA_API_KEY set?")
        return 2
    # --component / --limit narrow what gets BROWSED and GENERATED — never what
    # gets written. The written shards always mirror the whole catalog, or a
    # filtered run would prune everything outside its scope as "removed".
    scope = set(model)
    if args.component:
        scope = {args.component} & scope
    if args.limit:
        scope = set(sorted(scope)[:args.limit])

    committed = load_committed(out_dir)
    index = load_index(out_dir)
    carry_dir = Path(args.carry_dir) if args.carry_dir else None
    if carry_dir and carry_dir.is_dir():
        carried = load_committed(carry_dir)
        committed = merge_carried(committed, carried)
        # The open PR's index knows tonight's queue and backoff better.
        index = load_index(carry_dir) or index
        print(f"  carrying forward {len(carried)} lomdot from {carry_dir}")
    diff = ci.diff_components(
        {cid: c["component_fingerprint"] for cid, c in model.items()},
        {cid: str(l.get("component_fingerprint") or "")
         for cid, l in committed.items()},
    )
    print(f"  {len(model)} lomdot live · new {len(diff['new'])} · "
          f"changed {len(diff['changed'])} · removed {len(diff['removed'])}"
          + (f" · scoped to {len(scope)}" if len(scope) != len(model) else ""))

    if args.report:
        targets = collect_generation_targets(model, committed)
        print(f"  stale texts: {len(targets)}")
        for verdict_only in diff["removed"]:
            print(f"  removed from catalog: {verdict_only}")
        return 0

    from app.services.llm import register_observer

    ledger = UsageLedger()
    unregister = register_observer(ledger)
    try:
        return await _run_stages(args, out_dir, dump_dir, model, scope,
                                 committed, index, diff, ledger)
    finally:
        unregister()


async def _run_stages(
    args: argparse.Namespace, out_dir: Path, dump_dir: Path,
    model: dict[str, dict[str, Any]], scope: set[str],
    committed: dict[str, dict[str, Any]], index: dict[str, Any],
    diff: dict[str, list[str]], ledger: UsageLedger,
) -> int:
    today = datetime.now(timezone.utc).date()
    decisions: list[dict[str, Any]] = []

    def _over_budget() -> bool:
        return bool(args.max_usd) and ledger.total_usd >= args.max_usd

    # ── plan the browse ──
    extractions: dict[str, dict[str, Any]] = {}
    backlog = [str(c) for c in (index.get("backlog") or {}).get("browse") or []
               if str(c) in model]
    browse_state = {cid: dict(entry) for cid, entry in
                    (index.get("browse_state") or {}).items() if isinstance(entry, dict)}
    # A component named on the command line is browsed whether or not the
    # queue wanted it — that is what a person debugging one lomda means.
    forced = [args.component] if args.component in model else []
    plan = browse_lib.plan_browse(
        live={cid: {"provider": c.get("provider")} for cid, c in model.items()},
        committed=committed, diff=diff,
        recapture=components_needing_recapture(model, committed),
        state=browse_state, today=today,
        budget=0 if args.skip_browser else args.max_browse,
        scope=scope, forced=forced, queued=backlog)
    backlog_left = list(plan["waiting"]) \
        + [c for c in backlog if c not in scope]   # out-of-scope stays queued
    if plan["browse"] or plan["backed_off"]:
        by_class: dict[str, int] = {}
        for reason in plan["reasons"].values():
            by_class[reason] = by_class.get(reason, 0) + 1
        print(f"→ browse plan: {len(plan['browse'])} "
              f"({', '.join(f'{k} {v}' for k, v in by_class.items())}) · "
              f"waiting {len(plan['waiting'])} · backed off {len(plan['backed_off'])}")

    # ── browse (bounded concurrency, a per-provider breaker, a time budget) ──
    breaker = browse_lib.ProviderBreaker()
    deadline = time.monotonic() + args.time_budget_min * 60
    gate = asyncio.Semaphore(max(1, args.browse_concurrency))
    skipped: list[str] = []

    async def _browse_one(cid: str) -> None:
        async with gate:
            provider = str(model[cid].get("provider") or "")
            if time.monotonic() > deadline or breaker.open(provider):
                skipped.append(cid)   # no attempt recorded: due again tomorrow
                return
            print(f"→ browsing {cid} ({plan['reasons'].get(cid)})…")
            extraction = await browse_component(
                cid, model[cid], dump_dir, committed.get(cid))
            breaker.record(provider, extraction["verdict"])
            browse_lib.record_attempt(browse_state, cid, extraction["verdict"], today)
            print(f"  {cid}: {extraction['verdict']} "
                  f"({extraction['screens_mapped']}/{len(model[cid]['slides'])} mapped)")
            extractions[cid] = extraction

    await asyncio.gather(*(_browse_one(cid) for cid in plan["browse"]))
    browsed = [cid for cid in plan["browse"] if cid in extractions]
    if skipped:
        print(f"  ⚠️ {len(skipped)} browse(s) skipped (time budget or provider breaker)")
        backlog_left.extend(skipped)

    # ── describe the captured graphics, then drop the bytes ──
    if browsed and not args.skip_llm and not _over_budget():
        vision_calls = await describe_graphics(
            model, browsed, args.max_vision_calls)
        if vision_calls:
            print(f"→ described graphics in {vision_calls} vision calls")
    apply_graphic_labels(model, browsed)
    # A crop that never met the vision model (budget cut, --skip-llm, a
    # rejected row) would otherwise be stamped current and stay blind forever
    # — the bytes are about to be stripped. Re-queue its component: the next
    # browse re-crops and retries.
    for cid in browsed:
        if any(m.get("shot_b64") and not m.get("description")
               for slide in model.get(cid, {}).get("slides") or []
               for m in (slide.get("enrichment") or {}).get("media") or []
               if isinstance(m, dict)):
            backlog_left.append(cid)
            print(f"  ⚠️ {cid}: undescribed graphics — re-queued for browsing")
    strip_capture_bytes(model)

    # ── generate ──
    generated: dict[str, dict[str, Any]] = {}
    rejections: dict[str, int] = {}
    targets = order_targets(
        [t for t in collect_generation_targets(model, committed)
         if t["id"].split("|", 1)[0] in scope],
        rotation=today.toordinal())
    if targets and not args.skip_llm:
        print(f"→ generating {len(targets)} stale texts "
              f"(≤{args.max_llm_calls} calls"
              + (f", ≤${args.max_usd:g}" if args.max_usd else "") + ")…")
        generated = await generate_texts(targets, args.max_llm_calls,
                                         rejections, should_stop=_over_budget)
        print(f"  {len(generated)}/{len(targets)} accepted"
              + (f" · rejected {json.dumps(rejections)}" if rejections else ""))
    elif targets:
        print(f"  {len(targets)} stale texts left pending (--skip-llm)")

    # ── build, then take out anything that gives an answer away ──
    shards = build_shards(model, committed, extractions, generated, decisions)
    leaks = scan_leaks(model, shards, decisions)
    if leaks:
        print(f"  ⚠️ removed {leaks} text(s)/description(s) that gave an answer away")
    stats = {
        "lomdot": len(model),
        "slides": sum(len(c["slides"]) for c in model.values()),
        "questions": sum(len(s["questions"])
                         for c in model.values() for s in c["slides"]),
        "texts_generated": len(generated),
        "texts_pending": len(targets) - len(generated),
        "removed": diff["removed"],
    }
    usage = ledger.summary()
    report_dir = Path(args.report_dir)
    report_dir.mkdir(parents=True, exist_ok=True)
    # Reports hold counts, ids and reason codes — never vendor text or an
    # answer: CI uploads them from a public repo.
    (report_dir / "decisions.json").write_text(
        json.dumps(decisions, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (report_dir / "usage.json").write_text(
        json.dumps(usage, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (report_dir / "report.md").write_text(
        "# Content pipeline run\n\n"
        f"- generated_at: {_now_iso()}\n"
        + "".join(f"- {k}: {json.dumps(v, ensure_ascii=False)}\n"
                  for k, v in {**stats, **diff}.items())
        + f"- rejections: {json.dumps(rejections)}\n"
        + f"- leaks_removed: {leaks}\n"
        + f"- usage: {usage['calls']} calls, ${usage['usd']}\n"
        + "".join(f"- browse {cid} ({plan['reasons'].get(cid)}): {e['verdict']}\n"
                  for cid, e in extractions.items())
        + (f"- skipped: {len(skipped)}\n" if skipped else "")
        + f"- backed_off: {len(plan['backed_off'])}\n",
        encoding="utf-8")
    if args.dry_run:
        print(f"→ dry run: would write {len(shards)} shards; "
              f"stats {json.dumps(stats, ensure_ascii=False)} · "
              f"${usage['usd']} over {usage['calls']} calls")
        return 0
    changed = write_output(out_dir, shards, backlog_left, stats,
                           browse_lib.prune_state(browse_state, model))
    print(f"→ {'wrote changes' if changed else 'nothing changed'} in {out_dir} "
          f"· ${usage['usd']} over {usage['calls']} calls")

    from app.services import ai_usage
    await ai_usage.flush_pending()
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--verify", action="store_true",
                        help="run twice; fail unless the second pass is a no-op")
    parser.add_argument("--rewrite-only", action="store_true",
                        help="migrate the committed shards to the current "
                             "contract (no catalog, no browser, no model)")
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--component")
    parser.add_argument("--skip-browser", action="store_true")
    parser.add_argument("--skip-llm", action="store_true")
    parser.add_argument("--max-browse", type=int, default=10)
    parser.add_argument("--max-llm-calls", type=int, default=40)
    parser.add_argument("--max-vision-calls", type=int, default=30)
    parser.add_argument("--browse-concurrency", type=int, default=3)
    parser.add_argument("--time-budget-min", type=float, default=60,
                        help="stop starting browses after this many minutes")
    parser.add_argument("--max-usd", type=float, default=15,
                        help="stop model calls once the run has spent this (0 = no cap)")
    parser.add_argument("--carry-dir",
                        help="an earlier night's unmerged shards (the open PR's "
                             "content/context) to build on instead of redoing")
    parser.add_argument("--out-dir", default=str(DEFAULT_OUT_DIR))
    # Walker dumps hold vendor text and base64 crops — CI points this OUTSIDE
    # the uploaded artifact folder (a public repo's artifacts are public).
    parser.add_argument("--browser-dump-dir", default=str(DEFAULT_DUMP_DIR))
    parser.add_argument("--report-dir", default=str(DEFAULT_DUMP_DIR),
                        help="where the run's own reports go (uploaded by CI)")
    args = parser.parse_args()

    if args.rewrite_only:
        count = migrate_committed_shards(Path(args.out_dir))
        print(f"→ rewrote {count} shard(s) in {args.out_dir}")
        return 0
    if args.verify:
        code = asyncio.run(run(args))
        if code:
            return code
        before = {p: p.read_text(encoding="utf-8")
                  for p in ci.shard_paths(Path(args.out_dir))}
        code = asyncio.run(run(args))
        if code:
            return code
        after = {p: p.read_text(encoding="utf-8")
                 for p in ci.shard_paths(Path(args.out_dir))}
        if before != after:
            print("✗ second pass changed the output — the pipeline is not "
                  "idempotent against the live catalog")
            return 1
        print("✓ second pass wrote nothing — idempotent")
        return 0
    return asyncio.run(run(args))


if __name__ == "__main__":
    raise SystemExit(main())
