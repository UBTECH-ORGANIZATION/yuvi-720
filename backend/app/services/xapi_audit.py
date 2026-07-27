"""Raw xAPI audit capture (Phase 0).

Records every statement Kata's relay POSTs to our LRS endpoint EXACTLY as
received — BEFORE scope/verb filtering — so we can:
  * verify a live lesson end-to-end (what verbs/objects actually arrive),
  * discover verbs outside the MoE closed list to extend the ADL bridge,
  * check whether content emits a §12.3 prolonged-inactivity signal we could
    consume directly instead of inferring idle from event-absence.

Append-only JSONL; best-effort; NEVER blocks or fails ingest. Enabled by
default (dev); turn off with XAPI_AUDIT_ENABLED=false. Path override via
XAPI_AUDIT_PATH (default backend/.runtime/xapi_raw.jsonl, gitignored).
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

_DEFAULT_PATH = Path(__file__).resolve().parents[2] / ".runtime" / "xapi_raw.jsonl"


def audit_path() -> Path:
    override = os.environ.get("XAPI_AUDIT_PATH")
    return Path(override) if override else _DEFAULT_PATH


def is_enabled() -> bool:
    return os.environ.get("XAPI_AUDIT_ENABLED", "true").strip().lower() not in (
        "0",
        "false",
        "no",
        "off",
    )


def capture(statement: dict[str, Any], launch: dict[str, Any]) -> None:
    """Append one raw statement + launch context. Best-effort; never raises."""
    if not is_enabled():
        return
    try:
        verb = None
        object_id = None
        if isinstance(statement, dict):
            verb = (statement.get("verb") or {}).get("id")
            obj = statement.get("object")
            if isinstance(obj, dict):
                object_id = obj.get("id")
        record = {
            "received_at": datetime.now(timezone.utc).isoformat(),
            "learner_id": launch.get("lid"),
            "component_id": launch.get("cmp"),
            "objective_id": launch.get("obj"),
            "unit_id": launch.get("unit"),
            "session_id": launch.get("sid"),
            "verb": verb,
            "object_id": object_id,
            "statement": statement,
        }
        path = audit_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(record, ensure_ascii=False) + "\n")
    except Exception:
        # Auditing must never affect ingest — swallow everything.
        pass
