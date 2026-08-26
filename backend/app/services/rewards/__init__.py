"""Sparks reward economy (ניצוצות).

The learner earns sparks for *effort and action* on mentoring goals (F5) and
spends them on Yuvi Studio avatar cosmetics. Sparks are never granted for
correctness or mastery, so they are motivation feedback and not a grade
(720 F4: "avoid numeric grades").

Yuvi prices each goal individually (`pricing`), the wallet pays that price out
across the goal's progress stages (`wallet`), and the catalog holds what the
sparks can buy (`catalog`).
"""

from app.services.rewards.catalog import CATALOG, catalog_for_client, price_of
from app.services.rewards.pricing import (
    GOAL_VALUE_DEFAULT,
    GOAL_VALUE_MAX,
    GOAL_VALUE_MIN,
    STAGE_SHARE,
    clamp_goal_value,
    price_goal,
    stage_amount,
)
from app.services.rewards.wallet import (
    HELP_REWARD,
    TEACHER_SPARK_AMOUNTS,
    earn_rules,
    get_wallet,
    grant_goal_stage,
    grant_help_request,
    grant_teacher_kudos,
    grant_unlock,
    is_teacher_spark_amount,
    list_ledger,
    purchase_asset,
)

__all__ = [
    "CATALOG",
    "GOAL_VALUE_DEFAULT",
    "GOAL_VALUE_MAX",
    "GOAL_VALUE_MIN",
    "HELP_REWARD",
    "STAGE_SHARE",
    "TEACHER_SPARK_AMOUNTS",
    "catalog_for_client",
    "clamp_goal_value",
    "earn_rules",
    "get_wallet",
    "grant_goal_stage",
    "grant_help_request",
    "grant_teacher_kudos",
    "grant_unlock",
    "is_teacher_spark_amount",
    "list_ledger",
    "price_goal",
    "price_of",
    "purchase_asset",
    "stage_amount",
]
