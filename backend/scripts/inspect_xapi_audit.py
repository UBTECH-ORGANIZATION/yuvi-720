"""Summarize the raw xAPI audit capture (backend/.runtime/xapi_raw.jsonl).

Answers the live-lesson check questions:
  * did statements actually arrive through the tunnel? (pipe works)
  * what verbs arrived — any OUTSIDE the MoE map (verb-map candidates) or any
    that look like a §12.3 inactivity/idle signal we could consume directly?
  * do object ids carry a resolvable sub-item id? (question identity)
  * per-session timeline.

Usage:
  python scripts/inspect_xapi_audit.py                # summarize whole capture
  python scripts/inspect_xapi_audit.py --tail 20      # last 20 raw records
  XAPI_AUDIT_PATH=/path/to.jsonl python scripts/inspect_xapi_audit.py
"""

import json
import os
import sys
from collections import Counter, defaultdict

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services import xapi_audit  # noqa: E402
from app.services.events import (  # noqa: E402
    ADL_PROVIDER_VERB_MAP,
    MOE_VERBS,
    PROVIDER_INTERACTION_VERBS,
    VERB_IRI_BASE,
    split_item_question,
)

_IDLE_HINTS = ("idle", "inactiv", "suspend", "terminated", "abandoned")


def _known(verb_iri: str) -> bool:
    if not isinstance(verb_iri, str):
        return False
    if verb_iri in ADL_PROVIDER_VERB_MAP:
        return True
    slug = verb_iri.rsplit("/", 1)[-1].lower()
    if verb_iri.startswith(VERB_IRI_BASE):
        slug = verb_iri[len(VERB_IRI_BASE):].strip("/").lower()
    return slug in MOE_VERBS | PROVIDER_INTERACTION_VERBS


def main() -> int:
    path = xapi_audit.audit_path()
    if not path.exists():
        print(f"✗ no capture yet at {path}")
        print("  Play a live Kata lesson through the tunnel, then re-run.")
        return 1

    records = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            records.append(json.loads(line))
        except Exception:
            pass

    if "--tail" in sys.argv:
        n = int(sys.argv[sys.argv.index("--tail") + 1])
        for r in records[-n:]:
            print(f"{r.get('received_at')}  {r.get('verb')}  -> {r.get('object_id')}")
        return 0

    print(f"file: {path}")
    print(f"statements captured: {len(records)}")
    sessions = {r.get("session_id") for r in records}
    learners = {r.get("learner_id") for r in records}
    components = {r.get("component_id") for r in records}
    print(f"sessions: {len(sessions)}  learners: {len(learners)}  components: {len(components)}")

    verbs = Counter(r.get("verb") for r in records)
    print("\n── verbs (✓ mapped / ⚠ UNMAPPED = verb-map candidate) ──")
    for verb_iri, count in verbs.most_common():
        mark = "✓" if _known(verb_iri) else "⚠"
        idle = "  ⏱ possible INACTIVITY signal" if isinstance(verb_iri, str) and any(
            h in verb_iri.lower() for h in _IDLE_HINTS
        ) else ""
        print(f"  {mark} {count:4d}  {verb_iri}{idle}")

    unmapped = [v for v in verbs if not _known(v)]
    idle_signals = [v for v in verbs if isinstance(v, str) and any(h in v.lower() for h in _IDLE_HINTS)]
    print("\n── question identity (object tail → component/sub-item) ──")
    tails = Counter()
    for r in records:
        oid = r.get("object_id")
        if not isinstance(oid, str):
            continue
        _comp, sub = split_item_question(oid)
        tails[sub or "(component-level, no sub-item)"] += 1
    for sub, count in tails.most_common(15):
        print(f"  {count:4d}  {sub}")

    print("\n── per-session timeline ──")
    by_session = defaultdict(list)
    for r in records:
        by_session[r.get("session_id")].append(r)
    for sid, rows in by_session.items():
        rows.sort(key=lambda r: r.get("received_at") or "")
        print(f"  session {sid} — {len(rows)} statements  ({rows[0].get('received_at')} → {rows[-1].get('received_at')})")

    print("\n── verdict ──")
    print(f"  pipe alive:            {'YES' if records else 'NO'}")
    print(f"  verb-map candidates:   {unmapped or 'none — all verbs already mapped'}")
    print(f"  inactivity signal:     {idle_signals or 'none seen — idle must stay inferred'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
