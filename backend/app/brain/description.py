"""`student_description` — how the system sees the learner, in a few sentences.

Bounded labeled blocks (A-5, Letta-style): `learning_preferences`,
`motivational_patterns`, `what_frustrates`, `how_to_reach`. Each entry carries
its evidence keys and `valid_at`/`invalid_at` (Graphiti-style bi-temporal
provenance) — superseded beliefs are invalidated, never deleted, so every
sentence stays traceable. The LLM proposes ADD/UPDATE/DELETE ops (mem0-style
reconcile); a deterministic applier enforces caps and provenance.

Freshness is lazy (no scheduler): meaningful evidence marks the description
`stale` (events pipeline / reflection store); the next coach-bundle build
regenerates in the background once past a debounce window. The prompt receives
ONLY brain-derived aggregates — never raw chat text, never PII, never the
exidentifier.
"""

from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone
from typing import Any, Optional

BLOCK_KEYS = ("learning_preferences", "motivational_patterns", "what_frustrates", "how_to_reach")
MAX_ACTIVE_PER_BLOCK = 3
MAX_SENTENCES = 5
REGEN_DEBOUNCE_SECONDS = 30 * 60
REGEN_MIN_EVENTS = 5

_regenerating: set[str] = set()
_regen_tasks: set = set()   # hold task refs so the loop can't GC them mid-run


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def description_defaults() -> dict[str, Any]:
    return {
        "blocks": {key: [] for key in BLOCK_KEYS},
        "text": None,
        "stale": False,
        "events_since_generation": 0,
        "last_generated_at": None,
        "updated_at": None,
    }


def active_entries(block: Any) -> list[dict[str, Any]]:
    return [
        entry for entry in (block if isinstance(block, list) else [])
        if isinstance(entry, dict) and not entry.get("invalid_at")
    ]


def render_text(description: dict[str, Any]) -> str:
    """Join active block entries into the compact prompt-ready description."""
    sentences: list[str] = []
    blocks = description.get("blocks") or {}
    for key in ("how_to_reach", "what_frustrates", "learning_preferences", "motivational_patterns"):
        for entry in active_entries(blocks.get(key)):
            text = str(entry.get("text") or "").strip().rstrip(".")
            if text:
                sentences.append(text + ".")
            if len(sentences) >= MAX_SENTENCES:
                return " ".join(sentences)
    return " ".join(sentences)


def apply_ops(
    description: dict[str, Any], ops: list[dict[str, Any]], now: Optional[str] = None
) -> dict[str, Any]:
    """Apply ADD/UPDATE/DELETE ops deterministically — auditable diffs, never a
    regenerated blob. DELETE/UPDATE invalidate (set `invalid_at`), never erase."""
    now = now or _now()
    state = {**description_defaults(), **(description or {})}
    blocks = {key: list((state.get("blocks") or {}).get(key) or []) for key in BLOCK_KEYS}

    for op in ops or []:
        if not isinstance(op, dict):
            continue
        block_key = str(op.get("block") or "")
        action = str(op.get("action") or "").lower()
        text = str(op.get("text") or "").strip()[:200]
        replaces = str(op.get("replaces") or "").strip()
        evidence = [str(e)[:120] for e in op.get("evidence") or [] if e][:6]
        if block_key not in BLOCK_KEYS or action not in {"add", "update", "delete"}:
            continue
        entries = blocks[block_key]

        if action in {"update", "delete"} and replaces:
            for entry in entries:
                if not entry.get("invalid_at") and str(entry.get("text") or "").strip() == replaces:
                    entry["invalid_at"] = now
        if action in {"add", "update"} and text:
            already = any(
                str(e.get("text") or "").strip() == text for e in active_entries(entries)
            )
            if not already:
                entries.append({
                    "text": text,
                    "evidence": evidence,
                    "valid_at": now,
                    "invalid_at": None,
                })
        # Cap: keep the newest MAX_ACTIVE entries active, invalidate the oldest.
        active = active_entries(entries)
        for stale_entry in active[:-MAX_ACTIVE_PER_BLOCK]:
            stale_entry["invalid_at"] = now
        blocks[block_key] = entries[-12:]   # bounded history per block

    state["blocks"] = blocks
    rendered = render_text(state)
    any_active = any(active_entries(blocks.get(key)) for key in BLOCK_KEYS)
    # If every block was invalidated, the description is genuinely empty — don't
    # keep a stale blob that no active evidence backs.
    state["text"] = rendered if rendered or not any_active else state.get("text")
    state["updated_at"] = now
    return state


# ── Evidence gathering (aggregates only — no chat text, no PII) ──────────────
_ACTIVENESS_NAMES = {
    "motivation_relevance": "מוטיבציה ורלוונטיות",
    "growth_mindset": "תפיסת צמיחה",
    "initiative_responsibility": "יוזמה ואחריות",
    "self_regulation": "ויסות עצמי",
    "self_awareness": "מודעות עצמית",
    "support_emotional": "תחושת תמיכה",
}


def gather_evidence(brain: dict[str, Any]) -> dict[str, Any]:
    """A bounded, evidence-keyed summary of what the system actually observed."""
    from app.brain.memory import active_themes, memory_defaults
    from app.brain.mastery import unresolved_misconceptions

    evidence: dict[str, Any] = {}

    activeness = (brain.get("profile") or {}).get("activeness") or {}
    levels = {}
    for key, value in activeness.items():
        if isinstance(value, (int, float)):
            band = "low" if value < 40 else "high" if value >= 75 else "mid"
            levels[f"activeness.{key}"] = f"{_ACTIVENESS_NAMES.get(key, key)}: {band}"
    if levels:
        evidence["activeness"] = levels

    mastery = brain.get("mastery") or {}
    struggles, strengths, open_tags = [], [], []
    for key, entry in mastery.items():
        if not isinstance(entry, dict):
            continue
        oid = entry.get("objective_id") or key
        for m in unresolved_misconceptions(entry):
            open_tags.append(f"mastery.{oid}: תפיסה שגויה פתוחה '{m.get('tag')}' ×{m.get('count')}")
        ewma = entry.get("score_ewma")
        if isinstance(ewma, (int, float)):
            if ewma < 0.5 and int(entry.get("failures") or 0) >= 2:
                struggles.append(f"mastery.{oid}: מתקשה לאחרונה")
            elif ewma >= 0.8 and entry.get("achieved"):
                strengths.append(f"mastery.{oid}: שולט/ת")
    if struggles:
        evidence["struggles"] = struggles[:4]
    if strengths:
        evidence["strengths"] = strengths[:4]
    if open_tags:
        evidence["misconceptions"] = open_tags[:4]

    reflections = [
        f"reflection[{item.get('at', '')[:10]}]: self_rating={item.get('self_rating')}"
        for item in (brain.get("reflections_recent") or [])[-3:]
        if isinstance(item, dict) and item.get("self_rating") is not None
    ]
    if reflections:
        evidence["reflections"] = reflections

    signals = [
        f"behavior[{s.get('at', '')[:10]}]: {s.get('type')}"
        for s in (brain.get("behavior_signals") or [])[-3:]
        if isinstance(s, dict)
    ]
    if signals:
        evidence["behavior_signals"] = signals

    memory = brain.get("memory") if isinstance(brain.get("memory"), dict) else memory_defaults()
    themes = [
        f"memory.{theme.get('kind')}: {theme.get('value')}"
        for theme in active_themes(memory, limit=6)
    ]
    if themes:
        evidence["stated_by_learner"] = themes
    # Beliefs the learner explicitly took back. Without this the regen cannot
    # tell "no counter-evidence" from "evidence withdrawn", and a sentence like
    # "connects through football" would survive as a stable trait after the
    # learner said they no longer like football.
    withdrawn = [
        f"memory.{theme.get('kind')}: {theme.get('value')}"
        for theme in (memory.get("themes") or [])
        if isinstance(theme, dict) and theme.get("status") in {"forgotten", "contradicted"}
    ]
    if withdrawn:
        evidence["withdrawn_by_learner"] = withdrawn[-4:]

    pace = (brain.get("current_state") or {}).get("pace")
    if pace:
        evidence["pace"] = f"current_state.pace: {pace}"
    return evidence


# ── Regeneration (mini LLM, lazy, never blocking) ────────────────────────────
_REGEN_PROMPT = (
    "את/ה מעדכן/ת תיאור פנימי קצר של תלמיד/ה עבור מערכת ליווי למידה. "
    "לפניך הבלוקים הנוכחיים והראיות שנצפו בפועל. הצע עדכונים רק כשהראיות תומכות בהם. "
    "כל משפט: עברית, קצר, מעשי (איך ללמד/לנסח/להגיע אל התלמיד/ה), בלי ציונים, בלי תיוג שלילי, בלי פרטים מזהים. "
    "בלוקים: learning_preferences (איך נוח לו/לה ללמוד), motivational_patterns (מה מניע), "
    "what_frustrates (מה מתסכל ואיך לזהות), how_to_reach (איך לנסח ולגשת). "
    "החזר JSON בלבד: {\"ops\":[{\"block\":\"...\",\"action\":\"add|update|delete\","
    "\"text\":\"משפט קצר\",\"replaces\":\"טקסט קיים אם מעדכנים/מוחקים\",\"evidence\":[\"מפתח ראיה\"]}]}. "
    "תכונה יציבה שאין ראיה נגדה — אל תיגע בה. "
    "אם משפט קיים נשען על פריט שמופיע ב-withdrawn_by_learner (התלמיד/ה חזר/ה בו/בה) — מחק או עדכן אותו. "
    "אם אין עדכון מוצדק החזר ops ריק."
)


def _should_regenerate(description: dict[str, Any]) -> bool:
    if not description.get("stale"):
        return False
    events = int(description.get("events_since_generation") or 0)
    last = description.get("last_generated_at")
    if last is None:
        return True
    try:
        last_at = datetime.fromisoformat(str(last).replace("Z", "+00:00"))
        age = (datetime.now(timezone.utc) - last_at).total_seconds()
    except ValueError:
        return True
    return age >= REGEN_DEBOUNCE_SECONDS or events >= REGEN_MIN_EVENTS


def maybe_schedule_regeneration(learner_id: str, brain: dict[str, Any]) -> None:
    """Fire-and-forget: the current turn uses the old text; the next gets fresh."""
    description = brain.get("student_description") or {}
    if learner_id in _regenerating or not _should_regenerate(description):
        return
    _regenerating.add(learner_id)

    async def _run() -> None:
        try:
            await regenerate(learner_id)
        except Exception as exc:  # never break anything for a description
            print(f"⚠️ student_description regeneration failed: {type(exc).__name__}")
        finally:
            _regenerating.discard(learner_id)

    try:
        task = asyncio.create_task(_run())
        _regen_tasks.add(task)
        task.add_done_callback(_regen_tasks.discard)
    except RuntimeError:
        _regenerating.discard(learner_id)


async def regenerate(learner_id: str) -> None:
    """One mini-LLM reconcile pass: evidence + current blocks → ops → apply."""
    from app.brain.repository import apply_brain_updates, get_brain
    from app.services.ai_usage import UsageContext
    from app.services.llm import call_llm

    brain = await get_brain(learner_id)
    description = {**description_defaults(), **(brain.get("student_description") or {})}
    evidence = gather_evidence(brain)
    current_blocks = {
        key: [entry.get("text") for entry in active_entries((description.get("blocks") or {}).get(key))]
        for key in BLOCK_KEYS
    }

    ops: list[dict[str, Any]] = []
    if evidence:
        raw = await call_llm(
            [
                {"role": "system", "content": _REGEN_PROMPT},
                {"role": "user", "content": json.dumps(
                    {"current_blocks": current_blocks, "evidence": evidence},
                    ensure_ascii=False,
                )},
            ],
            usage_context=UsageContext(
                actor_id=learner_id,
                actor_type="learner",
                endpoint="internal:student-description",
                feature="feature_3_learning_companion",
                operation="brain.student_description",
                source="description_consolidator",
            ),
            max_tokens=500,
            json_mode=True,
            model_tier="mini",
        )
        try:
            payload = json.loads(raw or "{}")
            rows = payload.get("ops") if isinstance(payload, dict) else []
            ops = [row for row in rows if isinstance(row, dict)] if isinstance(rows, list) else []
        except (TypeError, ValueError, json.JSONDecodeError):
            ops = []

    now = _now()
    updated = apply_ops(description, ops, now=now)
    updated["stale"] = False
    updated["events_since_generation"] = 0
    updated["last_generated_at"] = now
    await apply_brain_updates(learner_id, {"student_description": updated})


async def seed_from_onboarding(learner_id: str) -> None:
    """Deterministic seed at onboarding completion — the first portrait comes
    straight from the mapping profile (no LLM, fully traceable); the first
    regeneration then refines it against real learning evidence."""
    from app.brain.repository import apply_brain_updates, get_brain

    brain = await get_brain(learner_id)
    description = {**description_defaults(), **(brain.get("student_description") or {})}
    if any(active_entries((description.get("blocks") or {}).get(key)) for key in BLOCK_KEYS):
        return  # already seeded — evidence-driven updates own it from here

    profile = brain.get("profile") or {}
    activeness = profile.get("activeness") or {}
    ops: list[dict[str, Any]] = []

    def low(key: str) -> bool:
        value = activeness.get(key)
        return isinstance(value, (int, float)) and value < 40

    def high(key: str) -> bool:
        value = activeness.get(key)
        return isinstance(value, (int, float)) and value >= 75

    interests = [
        str(item.get("label") or item.get("text") or item) if isinstance(item, dict) else str(item)
        for item in (profile.get("interests") or [])[:2]
    ]
    if interests:
        ops.append({
            "block": "motivational_patterns", "action": "add",
            "text": f"מתחבר/ת ללמידה דרך {', '.join(i for i in interests if i)}",
            "evidence": ["profile.interests"],
        })
    if profile.get("learning_style"):
        ops.append({
            "block": "learning_preferences", "action": "add",
            "text": f"סגנון למידה מועדף: {profile['learning_style']}",
            "evidence": ["profile.learning_style"],
        })
    if low("self_regulation"):
        ops.append({
            "block": "how_to_reach", "action": "add",
            "text": "צריך/ה צעדים קטנים והגדרה מפורשת של הצעד הבא",
            "evidence": ["activeness.self_regulation"],
        })
    if low("motivation_relevance"):
        ops.append({
            "block": "how_to_reach", "action": "add",
            "text": "כדאי לחבר כל נושא לעולם שלו/ה לפני התוכן עצמו",
            "evidence": ["activeness.motivation_relevance"],
        })
    if low("growth_mindset"):
        ops.append({
            "block": "what_frustrates", "action": "add",
            "text": "טעויות עלולות להתפרש כהוכחה לחוסר יכולת — לשבח מאמץ ותהליך",
            "evidence": ["activeness.growth_mindset"],
        })
    if low("support_emotional"):
        ops.append({
            "block": "how_to_reach", "action": "add",
            "text": "זקוק/ה לטון מרגיע ומנרמל — הקושי אינו כישלון",
            "evidence": ["activeness.support_emotional"],
        })
    if high("initiative_responsibility"):
        ops.append({
            "block": "motivational_patterns", "action": "add",
            "text": "עצמאי/ת — לתת בחירה ושליטה בקצב",
            "evidence": ["activeness.initiative_responsibility"],
        })

    if not ops:
        return
    now = _now()
    updated = apply_ops(description, ops, now=now)
    updated["stale"] = False
    updated["events_since_generation"] = 0
    updated["last_generated_at"] = now
    await apply_brain_updates(learner_id, {"student_description": updated})
