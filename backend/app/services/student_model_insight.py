"""A teacher's insight entering the student model (#454).

"איך המערכת רואה את התלמיד/ה" is built entirely from behaviour. This module
adds the voice of the adult who has sat with the child — not as a note filed to
one side, but into the two structures Yuvi actually acts on: a `brain.memory`
theme (source `teacher`, high-but-not-absolute confidence) and a
`student_description` entry carrying `stated_by_teacher:{teacher_id}` evidence.

The contract with the teacher has two halves, and both live here:

* **Before the insight overrides Yuvi** — a deterministic drastic-change check
  (`preview`). Drastic = the insight touches `how_to_reach` (it changes how
  Yuvi speaks to the child), disagrees with a currently active belief, or would
  displace a portrait sentence backed by strong behavioural evidence. The route
  refuses to save a drastic insight the teacher has not confirmed.
* **When the evidence later overrides the insight** — `notify_teacher_overridden`
  rings the author's bell. Silent reversal in either direction is the failure
  mode this PBI names.

Everything is bi-temporal: disagreement contradicts or invalidates, never
deletes, so the previous state stays inspectable and the weighting question
(Reut's open question for Yuval) stays answerable later.
"""

from __future__ import annotations

import json
import time
from hashlib import sha256
from typing import Any, Optional

from app.brain import context_engine
from datetime import datetime, timezone

from app.brain.description import (
    BLOCK_KEYS,
    MAX_ACTIVE_PER_BLOCK,
    active_entries,
    apply_ops,
    description_defaults,
    render_text,
)
from app.brain.memory import (
    contradict_theme_by_value,
    ensure_memory_state,
    normalize_memory_value,
    upsert_theme,
)
from app.brain.repository import get_brain

# The teacher's read of a child enters comfortably above the 0.55 active
# threshold but below certainty — proposed in the PBI, awaiting Yuval's ruling
# on weight; changing this number is a display/ranking choice, not a migration.
TEACHER_CONFIDENCE = 0.8
# Displacing a portrait sentence with this many evidence keys counts as
# overriding strong behavioural backing.
STRONG_EVIDENCE_KEYS = 2
MAX_INSIGHT_CHARS = 300
EVIDENCE_PREFIX = "stated_by_teacher"

BLOCK_TO_KIND = {
    "learning_preferences": "preference",
    "motivational_patterns": "motivation_pattern",
    "what_frustrates": "challenge",
    "how_to_reach": "strategy",
}


# Disagreement is CLASSIFIED, not declared: the teacher just writes the
# insight, and a mini-LLM judges whether it contradicts a sentence the model
# currently holds. The judged diff is cached briefly so the confirmed re-post
# saves exactly the change the teacher was warned about — never a re-roll.
_PENDING_TTL_SECONDS = 10 * 60
_pending: dict[tuple[str, str, str, str], tuple[float, dict[str, Any]]] = {}

_DETECT_PROMPT = (
    "מורה מוסיף/ה קביעה חדשה על תלמיד/ה למודל פנימי של מערכת למידה. "
    "לפניך המשפטים שהמערכת מאמינה בהם כרגע באותו תחום, ממוספרים מ-0. "
    "קבע/י אם הקביעה החדשה סותרת אחד מהם במהות — טוענת את ההפך, לא רק מוסיפה או מנסחת אחרת. "
    "החזר JSON בלבד: {\"contradicts\": <מספר המשפט הנסתר, או -1 אם אין סתירה>}."
)


class InsightError(ValueError):
    """Invalid input; `code` is a locale key the client renders."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


class DrasticChange(Exception):
    """The insight needs the teacher's explicit confirmation first."""

    def __init__(self, diff: dict[str, Any]) -> None:
        super().__init__("drastic change requires confirmation")
        self.diff = diff


def _scrub(text: object) -> str:
    from app.agents.safety import strip_pii

    cleaned, _ = strip_pii(str(text or ""))
    return " ".join(cleaned.split()).strip()[:MAX_INSIGHT_CHARS]


def _entry_summary(entry: dict[str, Any]) -> dict[str, Any]:
    return {
        "text": str(entry.get("text") or ""),
        "evidence_count": len(entry.get("evidence") or []),
        "by_teacher": any(
            str(item).startswith(EVIDENCE_PREFIX) for item in entry.get("evidence") or []
        ),
    }


def preview(
    brain: dict[str, Any],
    block: str,
    text: str,
    disagrees_with: Optional[str] = None,
) -> dict[str, Any]:
    """The deterministic diff shown before committing: what Yuvi currently
    believes, the evidence behind it, and what the insight would change."""
    description = {**description_defaults(), **(brain.get("student_description") or {})}
    entries = active_entries((description.get("blocks") or {}).get(block))
    target = (disagrees_with or "").strip()

    reasons: list[str] = []
    contradicted: Optional[dict[str, Any]] = None
    displaced: Optional[dict[str, Any]] = None

    if block == "how_to_reach":
        # Always warn: this block changes how Yuvi actually speaks to the
        # child, and a teacher should never alter a child's experience of Yuvi
        # without being told that is what they are doing.
        reasons.append("how_to_reach")

    match = next(
        (entry for entry in entries if str(entry.get("text") or "").strip() == target),
        None,
    ) if target else None
    if match is not None:
        contradicted = _entry_summary(match)
        reasons.append("contradicts")
        if len(match.get("evidence") or []) >= STRONG_EVIDENCE_KEYS:
            reasons.append("strong_evidence")
    elif len(entries) >= MAX_ACTIVE_PER_BLOCK:
        # The per-block cap means adding silently invalidates the oldest active
        # sentence — surfaced, because "quietly pushed something out" is
        # exactly the kind of change the teacher must see coming.
        oldest = entries[0]
        displaced = _entry_summary(oldest)
        if len(oldest.get("evidence") or []) >= STRONG_EVIDENCE_KEYS:
            reasons.append("strong_evidence")
        reasons.append("displaces")

    return {
        "drastic": bool(reasons),
        "reasons": reasons,
        "block": block,
        "current": [_entry_summary(entry) for entry in entries],
        "contradicted": contradicted,
        "displaced": displaced,
    }


async def _detect_disagreement(
    teacher_id: str, block: str, text: str, entries: list[dict[str, Any]]
) -> Optional[str]:
    """Which active sentence (if any) the new insight substantively contradicts.

    Judged by the mini tier — the teacher only writes the insight, never labels
    the disagreement. Any failure means "no contradiction detected": the save
    still happens, and the next regeneration reconciles."""
    from app.services.ai_usage import UsageContext
    from app.services.llm import call_llm

    texts = [str(entry.get("text") or "").strip() for entry in entries]
    texts = [item for item in texts if item]
    if not texts:
        return None
    try:
        raw = await call_llm(
            [
                {"role": "system", "content": _DETECT_PROMPT},
                {"role": "user", "content": json.dumps(
                    {"new_assertion": text, "current_sentences": texts},
                    ensure_ascii=False,
                )},
            ],
            usage_context=UsageContext(
                actor_id=teacher_id,
                actor_type="teacher",
                endpoint="/api/teacher/students/model-insight",
                feature="feature_6_teacher_insights",
                operation="brain.insight_disagreement",
                source="student_model_insight",
            ),
            max_tokens=60,
            json_mode=True,
            model_tier="mini",
        )
        payload = json.loads(raw or "{}")
        index = int(payload.get("contradicts", -1))
    except Exception:
        return None
    return texts[index] if 0 <= index < len(texts) else None


def _pending_key(learner_id: str, teacher_id: str, block: str, text: str) -> tuple[str, str, str, str]:
    return (learner_id, teacher_id, block, text)


async def add_insight(
    learner_id: str,
    teacher_id: str,
    *,
    block: str,
    text: str,
    confirmed: bool = False,
) -> dict[str, Any]:
    """Validate, classify disagreement, warn (unconfirmed drastic raises
    `DrasticChange`), then write the insight into memory + student_description
    through the scope gate."""
    if block not in BLOCK_KEYS:
        raise InsightError("tch.insight.err.block")
    scrubbed = _scrub(text)
    if len(scrubbed) < 3:
        raise InsightError("tch.insight.err.text")

    brain = await get_brain(learner_id)
    key = _pending_key(learner_id, teacher_id, block, scrubbed)
    cached = _pending.get(key)
    if confirmed and cached and time.monotonic() - cached[0] < _PENDING_TTL_SECONDS:
        # The confirmed re-post applies the exact diff the teacher read.
        diff = cached[1]
    else:
        entries = active_entries(
            ({**description_defaults(), **(brain.get("student_description") or {})}
             .get("blocks") or {}).get(block)
        )
        detected = await _detect_disagreement(teacher_id, block, scrubbed, entries)
        diff = preview(brain, block, scrubbed, detected)
    if diff["drastic"] and not confirmed:
        now = time.monotonic()
        for stale_key in [k for k, (at, _d) in _pending.items() if now - at >= _PENDING_TTL_SECONDS]:
            _pending.pop(stale_key, None)
        _pending[key] = (now, diff)
        raise DrasticChange(diff)
    _pending.pop(key, None)

    now_ref = f"teacher_insight:{teacher_id}"
    kind = BLOCK_TO_KIND[block]
    document, _ = ensure_memory_state(brain)
    memory = document.get("memory") or {}

    if diff["contradicted"]:
        # Bi-temporal: the disagreeing belief is superseded with an audit
        # trail, never deleted — the weighting question stays answerable.
        memory, _ids = contradict_theme_by_value(
            memory,
            kind,
            diff["contradicted"]["text"],
            reference=now_ref,
            source="teacher",
        )
    memory, theme, _changed = upsert_theme(
        memory,
        kind=kind,
        value=scrubbed,
        source="teacher",
        reference=now_ref,
        confidence=TEACHER_CONFIDENCE,
    )

    evidence_key = f"{EVIDENCE_PREFIX}:{teacher_id}"
    description = {**description_defaults(), **(brain.get("student_description") or {})}
    op = {"block": block, "action": "add", "text": scrubbed, "evidence": [evidence_key]}
    if diff["contradicted"]:
        op = {**op, "action": "update", "replaces": diff["contradicted"]["text"]}
    updated = apply_ops(description, [op])
    # The insight is live in the coach prompt from the next bundle; `stale`
    # additionally makes the next regeneration reconcile it against the full
    # evidence instead of waiting out the debounce.
    updated["stale"] = True

    await context_engine.apply_writes(
        "teacher_voice",
        learner_id,
        {"memory": memory, "student_description": updated},
    )
    return {
        "saved": True,
        "block": block,
        "text": scrubbed,
        "theme_id": (theme or {}).get("id"),
        "contradicted": diff["contradicted"],
        "warned": diff["drastic"],
    }


async def withdraw_insight(
    learner_id: str, teacher_id: str, *, block: str, text: str
) -> dict[str, Any]:
    """The teacher's regret path: withdraw an asserted sentence and return to
    what Yuvi believed beforehand.

    Bi-temporal both ways — the withdrawn sentence is invalidated (kept, with
    its `invalid_at`), and whatever the SAME save had invalidated (a replaced
    sentence, a displaced oldest sentence — recognizable because apply_ops
    stamped them with the insight's own `valid_at`) is re-added as a fresh
    active entry. Matching memory themes are marked forgotten, and a theme the
    insight had contradicted is set active again."""
    if block not in BLOCK_KEYS:
        raise InsightError("tch.insight.err.block")
    target = _scrub(text)
    now = datetime.now(timezone.utc).isoformat()

    brain = await get_brain(learner_id)
    description = {**description_defaults(), **(brain.get("student_description") or {})}
    blocks = {
        key: [dict(entry) for entry in (description.get("blocks") or {}).get(key) or []]
        for key in BLOCK_KEYS
    }
    entries = blocks[block]
    match = next(
        (
            entry for entry in entries
            if not entry.get("invalid_at")
            and str(entry.get("text") or "").strip() == target
            and any(str(item).startswith(EVIDENCE_PREFIX) for item in entry.get("evidence") or [])
        ),
        None,
    )
    if match is None:
        raise InsightError("tch.insight.err.notFound")
    stamp = match.get("valid_at")
    match["invalid_at"] = now
    restored = 0
    for entry in list(entries):
        if entry is not match and entry.get("invalid_at") == stamp:
            entries.append({
                "text": entry.get("text"),
                "evidence": list(entry.get("evidence") or []),
                "valid_at": now,
                "invalid_at": None,
            })
            restored += 1
    description["blocks"] = blocks
    description["text"] = render_text(description)
    description["updated_at"] = now
    description["stale"] = True

    document, _ = ensure_memory_state(brain)
    memory = document.get("memory") or {}
    kind = BLOCK_TO_KIND[block]
    target_norm = normalize_memory_value(target).casefold()
    insight_ref = f"teacher_insight:{teacher_id}"
    themes = []
    for theme in memory.get("themes") or []:
        if not isinstance(theme, dict):
            themes.append(theme)
            continue
        value_norm = normalize_memory_value(theme.get("value")).casefold()
        if (
            value_norm == target_norm
            and "teacher" in (theme.get("source_types") or [])
            and theme.get("status") not in {"forgotten", "expired"}
        ):
            theme = {**theme, "status": "forgotten", "forgotten_at": now, "last_seen": now}
        elif (
            theme.get("kind") == kind
            and theme.get("status") == "contradicted"
            and any(
                isinstance(ref, dict)
                and ref.get("source") == "teacher"
                and ref.get("ref") == insight_ref
                for ref in theme.get("evidence_refs") or []
            )
        ):
            theme = {key: value for key, value in theme.items() if key != "contradicted_at"}
            theme.update({"status": "active", "last_seen": now})
        themes.append(theme)
    memory = {**memory, "themes": themes, "updated_at": now}

    await context_engine.apply_writes(
        "teacher_voice",
        learner_id,
        {"memory": memory, "student_description": description},
    )
    return {"withdrawn": True, "restored": restored}


def _teacher_ids_from_evidence(evidence: Any) -> list[str]:
    ids = []
    for item in evidence or []:
        raw = str(item)
        if raw.startswith(f"{EVIDENCE_PREFIX}:"):
            ids.append(raw.split(":", 1)[1])
    return [item for item in dict.fromkeys(ids) if item]


async def notify_teacher_overridden(
    learner_id: str, text: str, evidence: Any
) -> None:
    """Ring the authoring teacher's bell when the evidence overrode their
    insight — the symmetric half of the drastic-change warning."""
    from app.services import notifications

    digest = sha256(f"{learner_id}:{text}".encode("utf-8")).hexdigest()[:12]
    for teacher_id in _teacher_ids_from_evidence(evidence):
        await notifications.notify(
            teacher_id,
            notifications.KIND_MODEL_OVERRIDE,
            notification_id=f"model_override:{digest}",
            title_key="notif.modelOverride",
            params={"text": text[:140]},
            actions=[{
                "label_key": "notif.action.openStudent",
                "route": f"/teacher/student/{learner_id}",
            }],
            recipient_role=notifications.ROLE_TEACHER,
            actor_id=learner_id,
        )


async def notify_theme_overridden(learner_id: str, theme: dict[str, Any]) -> None:
    """Same bell for a contradicted `teacher`-sourced memory theme."""
    refs = [
        f"{EVIDENCE_PREFIX}:{str(item.get('ref') or '').split(':', 1)[1]}"
        for item in theme.get("evidence_refs") or []
        if isinstance(item, dict)
        and item.get("source") == "teacher"
        and str(item.get("ref") or "").startswith("teacher_insight:")
    ]
    await notify_teacher_overridden(learner_id, str(theme.get("value") or ""), refs)
