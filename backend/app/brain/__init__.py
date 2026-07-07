"""The Learner Brain (Context Engine) — the single source of truth for a learner.

See `docs/architecture/shared-learning-brain.md` §4 (brain document), §5.8 (agent
access scopes), and §18 Phase 0. Everything the system knows about a learner lives
in one MongoDB document in the `learners` collection, keyed by a non-identifying
`learner_id`. Agents are stateless specialists that read/write scoped views of it.
"""

from app.brain.repository import (
    get_brain,
    apply_brain_updates,
    migrate_learner_state,
)
from app.brain.context_engine import (
    view_for,
    apply_writes,
    build_coach_bundle,
    AgentScopeError,
)

__all__ = [
    "get_brain",
    "apply_brain_updates",
    "migrate_learner_state",
    "view_for",
    "apply_writes",
    "build_coach_bundle",
    "AgentScopeError",
]
