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
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.env import ensure_env_loaded  # noqa: E402

ensure_env_loaded()

from app.services import content_intelligence as ci  # noqa: E402
from app.services.ai_usage import UsageContext  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OUT_DIR = REPO_ROOT / "content" / "context"
DEFAULT_DUMP_DIR = REPO_ROOT / "backend" / "artifacts" / "content-pipeline"
DRIVER = REPO_ROOT / "frontend" / "scripts" / "content-extract.mjs"

BATCH = 12                      # translate_catalog's batch discipline
DRIVER_TIMEOUT_SECONDS = 180
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


def load_backlog(out_dir: Path) -> list[str]:
    index_path = out_dir / "index.json"
    if not index_path.exists():
        return []
    try:
        index = json.loads(index_path.read_text(encoding="utf-8"))
        return [str(c) for c in (index.get("backlog") or {}).get("browse") or []]
    except (OSError, json.JSONDecodeError):
        return []


# ── Stage C: read what the learner actually sees ─────────────────────────────

async def _launch_url(component_id: str) -> str:
    from app.services import kata_client

    context = await kata_client.create_launch_context(
        component_id=component_id,
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


def _run_driver(launch_url: str, dump_path: Path) -> tuple[str, Optional[dict]]:
    """(verdict, dump) from one browser pass over one lomda."""
    if not DRIVER.exists():
        return "driver_error", None
    command = ["node", str(DRIVER), "--url", launch_url,
               "--out", str(dump_path), "--max-screens", "40"]
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


def map_screens_to_slides(
    screens: list[dict[str, Any]], slides: list[dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    """item_id → captured screen, aligned by order with the player's
    leading-cover offset (≤2, same tolerance as resolve_catalog_item_id)."""
    best: tuple[int, int] = (-1, 0)   # (score, offset)
    for offset in range(0, 3):
        score = sum(
            _title_score(str(screens[i + offset].get("title") or ""), s["title"])
            for i, s in enumerate(slides) if i + offset < len(screens))
        aligned = sum(1 for i in range(len(slides)) if i + offset < len(screens))
        if score + aligned > best[0]:
            best = (score + aligned, offset)
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
) -> dict[str, Any]:
    """Attach enrichment to the model's slides; return the extraction record."""
    from app.services.kata_client import KataError

    probed_at = _now_iso()
    try:
        launch_url = await _launch_url(component_id)
    except KataError as exc:
        verdict = "launch_404" if exc.status_code in (404, 502) else "driver_error"
        return {"verdict": verdict, "probed_at": probed_at,
                "player_host": "", "screens_seen": 0, "screens_mapped": 0}
    except Exception:
        return {"verdict": "driver_error", "probed_at": probed_at,
                "player_host": "", "screens_seen": 0, "screens_mapped": 0}

    host = re.sub(r"^https?://([^/]+).*$", r"\1", launch_url)
    dump_dir.mkdir(parents=True, exist_ok=True)
    verdict, dump = await asyncio.to_thread(
        _run_driver, launch_url, dump_dir / f"{component_id}.json")
    if verdict != "ok":
        return {"verdict": verdict, "probed_at": probed_at, "player_host": host,
                "screens_seen": len((dump or {}).get("screens") or []),
                "screens_mapped": 0}

    screens = dump["screens"]
    mapped = map_screens_to_slides(screens, model["slides"])
    for slide in model["slides"]:
        screen = mapped.get(slide["item_id"])
        if not screen:
            continue
        slide["enrichment"] = {
            "visible_text": _dedupe_visible_text(
                screen.get("visible_text") or "", slide["information_to_bot"]),
            "media": [m for m in (screen.get("media") or [])
                      if isinstance(m, dict)][:12],
            "question_rendering": screen.get("question_rendering"),
            "captured_at": probed_at,
        }
    return {
        "verdict": "extracted" if len(mapped) == len(model["slides"]) else "partial",
        "probed_at": probed_at,
        "player_host": host,
        "screens_seen": len(screens),
        "screens_mapped": len(mapped),
    }


# ── Stage D: regenerate what went stale ──────────────────────────────────────

_KIND_RULES = {
    "lesson_welcome": (
        "פסקת פתיחה קצרה לשיעור — מה לומדים בו ולמה זה מעניין. בלי שם הלומד/ת, "
        "בלי ברכת שלום (היא נוספת בנפרד), בלי אימוג'י, ניסוח נטול מגדר."),
    "lesson_step_intro": (
        "משפט–שניים שמציגים את המסך: מה עומדים לראות או לקרוא ומה כדאי לשים לב "
        "אליו. בלי לחשוף תשובות, ניסוח נטול מגדר."),
    "video_summary": (
        "סיכום קצר של מה שמלמד הסרטון או המדיה שבמסך, מבוסס אך ורק על הטקסט "
        "שסופק. בלי להמציא פרטים שלא נכתבו."),
    "question_intro": (
        "משפט–שניים שמציגים את השאלה שמופיעה על המסך ומזמינים לנסות — בלי לרמוז "
        "לתשובה, בלי לצטט את השאלה מילה במילה, ניסוח נטול מגדר."),
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

{rows}

החזר JSON בלבד:
{{"rows": [{{"id": "המזהה שסופק, מועתק במדויק", "text": "..."}}]}}
"""


def _normalized(text: str) -> str:
    return " ".join(str(text or "").split()).strip().lower()


def _echoes_an_answer(text: str, correct: list[str]) -> bool:
    normalized = _normalized(text)
    return any(
        len(_normalized(answer)) >= 2 and _normalized(answer) in normalized
        for answer in correct)


def collect_generation_targets(
    model: dict[str, dict[str, Any]], committed: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    """Every text slot whose authored source drifted from its stored block."""

    def _stale(existing: Optional[dict], fingerprint: str) -> bool:
        return not (
            isinstance(existing, dict)
            and existing.get("prompt_version") == ci.PROMPT_VERSION
            and existing.get("source_fingerprint") == fingerprint
            and str(existing.get("he") or "").strip())

    targets: list[dict[str, Any]] = []
    for cid, comp in model.items():
        old = committed.get(cid) or {}
        old_slides = {s.get("item_id"): s for s in old.get("slides") or []}
        if _stale((old.get("texts") or {}).get("lesson_welcome"),
                  comp["component_fingerprint"]):
            targets.append({
                "id": f"{cid}|||lesson_welcome", "kind": "lesson_welcome",
                "fingerprint": comp["component_fingerprint"], "correct": [],
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
                "authored_note": slide["information_to_bot"][:1200],
                "visible_on_screen": str(enrichment.get("visible_text") or "")[:1200],
            }
            wanted_kinds = []
            if slide["role"] in ("teaching", "mixed"):
                wanted_kinds.append("lesson_step_intro")
            if slide["role"] in ("video", "mixed") and (
                    slide["information_to_bot"] or enrichment.get("visible_text")):
                wanted_kinds.append("video_summary")
            for kind in wanted_kinds:
                if _stale(old_texts.get(kind), slide["fingerprint"]):
                    targets.append({
                        "id": f"{cid}|{slide['item_id']}||{kind}", "kind": kind,
                        "fingerprint": slide["fingerprint"], "correct": [],
                        "context": base_context,
                    })
            old_questions = {q.get("question_id"): q
                            for q in old_slide.get("questions") or []}
            for question in slide["questions"]:
                old_q_texts = (old_questions.get(question["question_id"]) or {}) \
                    .get("texts") or {}
                for kind in ci.QUESTION_TEXT_KINDS:
                    if _stale(old_q_texts.get(kind), question["fingerprint"]):
                        targets.append({
                            "id": (f"{cid}|{slide['item_id']}|"
                                   f"{question['question_id']}|{kind}"),
                            "kind": kind,
                            "fingerprint": question["fingerprint"],
                            "correct": question["correct"],
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


async def generate_texts(
    targets: list[dict[str, Any]], max_calls: int,
) -> dict[str, dict[str, Any]]:
    """target id → generation block, for every row that survived validation."""
    from app.services.llm import call_llm

    generated: dict[str, dict[str, Any]] = {}
    calls = 0
    generated_at = _now_iso()
    usage = UsageContext(
        actor_id="content-pipeline", actor_type="system",
        endpoint="script:content_pipeline", feature="content_pipeline",
        operation="content.pregen_texts", source="content_pipeline",
    )
    for start in range(0, len(targets), BATCH):
        if calls >= max_calls:
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
            continue
        wanted = {t["id"]: t for t in batch}
        for entry in payload.get("rows") or []:
            if not isinstance(entry, dict):
                continue
            target = wanted.get(str(entry.get("id") or ""))
            if target is None:
                continue  # a renamed row cannot be matched back — drop it
            text = str(entry.get("text") or "").strip()
            cap = ci.TEXT_LENGTH_CAPS[target["kind"]]
            if not text or len(text) > cap or not _HEBREW.search(text):
                continue
            if _echoes_an_answer(text, target["correct"]):
                continue  # a hint that says the answer is not a hint
            generated[target["id"]] = {
                "he": text,
                "prompt_version": ci.PROMPT_VERSION,
                "source_fingerprint": target["fingerprint"],
                "generated_at": generated_at,
                "model": "mini",
            }
    return generated


# ── Stage E: write the shards ────────────────────────────────────────────────

def build_shards(
    model: dict[str, dict[str, Any]],
    committed: dict[str, dict[str, Any]],
    extractions: dict[str, dict[str, Any]],
    generated: dict[str, dict[str, Any]],
) -> dict[Path, dict[str, Any]]:
    """Relative shard path → shard document, answers stripped by construction."""

    def _keep(existing: Optional[dict], fingerprint: str) -> Optional[dict]:
        if (isinstance(existing, dict)
                and existing.get("prompt_version") == ci.PROMPT_VERSION
                and existing.get("source_fingerprint") == fingerprint
                and str(existing.get("he") or "").strip()):
            return existing
        return None

    def _texts(target_prefix: str, kinds: tuple, existing: dict,
               fingerprint: str) -> dict[str, Any]:
        out = {}
        for kind in kinds:
            block = generated.get(f"{target_prefix}|{kind}") \
                or _keep(existing.get(kind), fingerprint)
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
        old_slides = {s.get("item_id"): s for s in old.get("slides") or []}
        slides_out = []
        for slide in comp["slides"]:
            old_slide = old_slides.get(slide["item_id"]) or {}
            enrichment = slide.get("enrichment")
            if enrichment is None and old_slide.get("enrichment") \
                    and old_slide.get("fingerprint") == slide["fingerprint"]:
                enrichment = old_slide["enrichment"]  # unchanged slide, keep capture
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
                "information_to_bot": slide["information_to_bot"],
                "texts": _texts(f"{cid}|{slide['item_id']}|",
                                ci.ITEM_TEXT_KINDS,
                                old_slide.get("texts") or {},
                                slide["fingerprint"]),
                "questions": questions_out,
            }
            if enrichment:
                row["enrichment"] = enrichment
            slides_out.append(row)
        shard["lomdot"].append({
            "component_id": cid,
            "title": comp["title"],
            "cognitive_level": comp["cognitive_level"],
            "provider": comp["provider"],
            "kata_updated_at": comp["kata_updated_at"],
            "component_fingerprint": comp["component_fingerprint"],
            "extraction": extractions.get(cid) or old.get("extraction") or {
                "verdict": "not_attempted", "probed_at": "", "player_host": "",
                "screens_seen": 0, "screens_mapped": 0,
            },
            "texts": _texts(f"{cid}||", ci.COMPONENT_TEXT_KINDS,
                            old.get("texts") or {},
                            comp["component_fingerprint"]),
            "slides": slides_out,
        })
    return shards


def write_output(
    out_dir: Path, shards: dict[Path, dict[str, Any]],
    backlog_browse: list[str], stats: dict[str, Any],
) -> bool:
    """Write shards + index; prune shards for objectives that vanished.
    Returns True when any byte changed."""
    changed = False
    wanted_paths = set()
    for rel_path, shard in shards.items():
        target = out_dir / rel_path
        wanted_paths.add(target)
        target.parent.mkdir(parents=True, exist_ok=True)
        payload = ci.dump_shard(shard)
        if not target.exists() or target.read_text(encoding="utf-8") != payload:
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
        "stats": stats,
    }
    index_path = out_dir / "index.json"
    stable = {k: v for k, v in index.items() if k != "generated_at"}
    previous: dict[str, Any] = {}
    if index_path.exists():
        try:
            previous = json.loads(index_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            previous = {}
    if {k: v for k, v in previous.items() if k != "generated_at"} != stable:
        index_path.write_text(
            json.dumps(index, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8")
        changed = True
    return changed


# ── orchestration ────────────────────────────────────────────────────────────

async def run(args: argparse.Namespace) -> int:
    out_dir = Path(args.out_dir)
    dump_dir = Path(args.browser_dump_dir)

    print("→ fetching the live catalog…")
    model = await fetch_catalog_model()
    if not model:
        print("no components returned — is KATA_API_KEY set?")
        return 2
    if args.component:
        model = {cid: c for cid, c in model.items() if cid == args.component}
    if args.limit:
        model = dict(sorted(model.items())[:args.limit])

    committed = load_committed(out_dir)
    diff = ci.diff_components(
        {cid: c["component_fingerprint"] for cid, c in model.items()},
        {cid: str(l.get("component_fingerprint") or "")
         for cid, l in committed.items()
         if not args.component or cid == args.component},
    )
    print(f"  {len(model)} lomdot live · new {len(diff['new'])} · "
          f"changed {len(diff['changed'])} · removed {len(diff['removed'])}")

    if args.report:
        targets = collect_generation_targets(model, committed)
        print(f"  stale texts: {len(targets)}")
        for verdict_only in diff["removed"]:
            print(f"  removed from catalog: {verdict_only}")
        return 0

    # ── browse ──
    extractions: dict[str, dict[str, Any]] = {}
    backlog = [c for c in load_backlog(out_dir) if c in model]
    queue = list(dict.fromkeys(backlog + diff["new"] + diff["changed"]))
    to_browse = [] if args.skip_browser else queue[:args.max_browse]
    backlog_left = [c for c in queue if c not in to_browse]
    for cid in to_browse:
        print(f"→ browsing {cid}…")
        extraction = await browse_component(cid, model[cid], dump_dir)
        print(f"  verdict: {extraction['verdict']} "
              f"({extraction['screens_mapped']}/{len(model[cid]['slides'])} mapped)")
        extractions[cid] = extraction
        if extraction["verdict"] in ("driver_error", "timeout", "frame_blocked"):
            backlog_left.append(cid)   # transient — try again next night

    # ── generate ──
    generated: dict[str, dict[str, Any]] = {}
    targets = collect_generation_targets(model, committed)
    if targets and not args.skip_llm:
        print(f"→ generating {len(targets)} stale texts "
              f"(≤{args.max_llm_calls} calls)…")
        generated = await generate_texts(targets, args.max_llm_calls)
        print(f"  {len(generated)}/{len(targets)} accepted")
    elif targets:
        print(f"  {len(targets)} stale texts left pending (--skip-llm)")

    # ── write ──
    shards = build_shards(model, committed, extractions, generated)
    stats = {
        "lomdot": len(model),
        "slides": sum(len(c["slides"]) for c in model.values()),
        "questions": sum(len(s["questions"])
                         for c in model.values() for s in c["slides"]),
        "texts_generated": len(generated),
        "texts_pending": len(targets) - len(generated),
        "removed": diff["removed"],
    }
    if args.dry_run:
        print(f"→ dry run: would write {len(shards)} shards; "
              f"stats {json.dumps(stats, ensure_ascii=False)}")
        return 0
    changed = write_output(out_dir, shards, backlog_left, stats)
    dump_dir.mkdir(parents=True, exist_ok=True)
    (dump_dir / "report.md").write_text(
        "# Content pipeline run\n\n"
        f"- generated_at: {_now_iso()}\n"
        + "".join(f"- {k}: {json.dumps(v, ensure_ascii=False)}\n"
                  for k, v in {**stats, **diff}.items())
        + "".join(f"- extraction {cid}: {e['verdict']}\n"
                  for cid, e in extractions.items()),
        encoding="utf-8")
    print(f"→ {'wrote changes' if changed else 'nothing changed'} in {out_dir}")

    from app.services import ai_usage
    await ai_usage.flush_pending()
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--verify", action="store_true",
                        help="run twice; fail unless the second pass is a no-op")
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--component")
    parser.add_argument("--skip-browser", action="store_true")
    parser.add_argument("--skip-llm", action="store_true")
    parser.add_argument("--max-browse", type=int, default=10)
    parser.add_argument("--max-llm-calls", type=int, default=40)
    parser.add_argument("--out-dir", default=str(DEFAULT_OUT_DIR))
    parser.add_argument("--browser-dump-dir", default=str(DEFAULT_DUMP_DIR))
    args = parser.parse_args()

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
