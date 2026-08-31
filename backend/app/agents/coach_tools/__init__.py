"""Safe, learner-scoped tools for Yuvi Coach modes."""

# Import registers the built-in read-only tools. Future tool modules follow the
# same pattern so provider schemas are derived from one authoritative registry.
from app.agents.coach_tools import read_tools as _read_tools  # noqa: F401
from app.agents.coach_tools import action_tools as _action_tools  # noqa: F401
from app.agents.coach_tools import visual_tools as _visual_tools  # noqa: F401
from app.agents.coach_tools import pointing_tools as _pointing_tools  # noqa: F401