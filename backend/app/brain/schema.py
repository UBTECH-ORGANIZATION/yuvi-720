"""Brain document shape, defaults, and dotted-path helpers.

The brain is stored as a plain dict (consistent with `backend/learner_state.py`)
so that field-scoped `$set` writes and scoped projections over dotted paths stay
simple. Pydantic models here guard only the API boundary (request/response), not
the internal nested storage — the nested learner model evolves too fast to pin.

Reference: architecture doc §4.2 (the `learners` document) and §5.8 (agent scopes).
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

try:  # Pydantic ships with FastAPI; guarded so tooling without it still imports.
    from pydantic import BaseModel, Field
except ImportError:  # pragma: no cover
    BaseModel = object  # type: ignore
    def Field(*_args, **_kwargs):  # type: ignore
        return None


# ── Supported product languages (720: he/ar required, en supported) ──────────
SUPPORTED_LOCALES = ("he", "ar", "en")
DEFAULT_LOCALE = "he"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def empty_brain(learner_id: str, locale: str = DEFAULT_LOCALE) -> dict[str, Any]:
    """A fresh, honest brain document — no invented numbers, empty projections.

    Mirrors architecture doc §4.2. Arrays are capped projections (last N), never
    logs; the raw evidence lives in the `learning_events` / `reflections`
    collections (R2 keeps the brain compact).
    """
    now = _now()
    locale = locale if locale in SUPPORTED_LOCALES else DEFAULT_LOCALE
    return {
        "_id": learner_id,
        "learner_id": learner_id,
        "identity": {           # UI-only; NEVER sent to an AI prompt (§4.1)
            "display_name": None,
            "grade": None,
            "locale": locale,
        },
        "profile": {            # F2 Onboarding output
            "activeness": {},   # the 6 MoE פעלנות components (0-100 internal, never shown)
            "mapping_scores": None,
            "learning_style": None,
            "interests": [],
            "characteristics": [],      # soft self-described traits (mapping reflection)
            "mapping_clarifications": [],  # student clarifications on their answers (provenance; raw scores untouched)
            "preferences": [],
            "environment": None,
            "source": None,
            "updated_at": None,
        },
        "memory": {             # evidence-backed, revisable soft learner model
            "version": 1,
            "themes": [],
            "open_questions": [],
            "legacy_profile_refs": [],
            "updated_at": None,
        },
        "strengths": [],
        "challenges": [],
        "mastery": {},          # per-objective, from real events only (never invented)
        "progress": {},         # per-subject rollup of `mastery`
        "next_recommendations": None,   # planner cache (§5.6)
        "goals": [],            # F5 learner-visible goals mirror
        "teacher_directives": [],       # F6 teacher guidance (decisions only, §5.7)
        "reflections_recent": [],       # last N; full log in `reflections`
        "current_state": {      # live "where am I" for resume + coach context
            "unit_id": None,
            "component_id": None,
            "item_id": None,
            "resume_token": None,
            "pace": None,       # on_track | ahead | behind
        },
        "strategies": [],       # procedural memory (§4.5)
        "behavior_signals": [],  # A-3 detector flags (neutral behavior + evidence ids, capped)
        "student_description": {  # how the system sees the learner — bounded labeled
            "blocks": {           # blocks with provenance; injected into coach prompts
                "learning_preferences": [],
                "motivational_patterns": [],
                "what_frustrates": [],
                "how_to_reach": [],
            },
            "text": None,         # rendered ≤4 Hebrew sentences (internal-only)
            "stale": False,
            "events_since_generation": 0,
            "last_generated_at": None,
            "updated_at": None,
        },
        "wellbeing_flags": [],  # teacher-facing distress signals (Safety agent); raw evidence, not profile
        "enrollments": [],      # F8 scoping
        "version": 1,           # optimistic concurrency (R3)
        "created_at": now,
        "updated_at": now,
    }


# ── Dotted-path projection / write helpers ───────────────────────────────────
def get_path(doc: dict[str, Any], path: str) -> Any:
    """Read a dotted path (e.g. "profile.interests") from a nested dict."""
    node: Any = doc
    for part in path.split("."):
        if not isinstance(node, dict) or part not in node:
            return None
        node = node[part]
    return node


def project(doc: dict[str, Any], paths: list[str]) -> dict[str, Any]:
    """Return only the given dotted paths, rebuilt as a nested dict.

    This is how the Context Engine hands an agent *only* its scoped slice (§5.8),
    so a jailbroken prompt cannot read outside its view.
    """
    out: dict[str, Any] = {}
    for path in paths:
        value = get_path(doc, path)
        if value is None:
            continue
        parts = path.split(".")
        node = out
        for part in parts[:-1]:
            node = node.setdefault(part, {})
        node[parts[-1]] = value
    return out


def flatten_updates(updates: dict[str, Any], prefix: str = "") -> dict[str, Any]:
    """Flatten nested updates into dotted `$set` keys.

    Accepts either already-dotted keys ({"profile.interests": [...]}) or nested
    dicts ({"profile": {"interests": [...]}}) and normalizes to dotted form.

    Recursion **stops at opaque leaves** so whole objects are replaced, not
    deep-merged through a possibly-null parent (which would break Mongo `$set`
    and the fallback writer). Opaque = a stored blob we set as a unit:
    - keys named `resume_token` / `mapping_scores` / `next_recommendations`;
    - any value directly under `mastery` / `progress` (a per-key entry).
    """
    flat: dict[str, Any] = {}
    for key, value in updates.items():
        dotted = f"{prefix}.{key}" if prefix else key
        if isinstance(value, dict) and value and not _is_opaque_path(dotted):
            flat.update(flatten_updates(value, dotted))
        else:
            flat[dotted] = value
    return flat


_OPAQUE_LEAF_KEYS = {"resume_token", "mapping_scores", "next_recommendations"}
_OPAQUE_PARENT_KEYS = {"mastery", "progress"}


def _is_opaque_path(path: str) -> bool:
    """A dotted path whose value should be stored as a whole object, not merged."""
    segments = path.split(".")
    if segments[-1] in _OPAQUE_LEAF_KEYS:
        return True
    return len(segments) >= 2 and segments[-2] in _OPAQUE_PARENT_KEYS


def path_allowed(path: str, allow_list: list[str]) -> bool:
    """A write path is allowed if it equals or is nested under an allowed field."""
    return any(path == allowed or path.startswith(allowed + ".") for allowed in allow_list)
