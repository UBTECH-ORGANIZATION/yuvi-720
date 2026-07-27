"""Sparks reward economy (ניצוצות).

The learner earns sparks for *effort and action* on mentoring goals (F5) and
spends them on Yuvi Studio avatar cosmetics. Sparks are never granted for
correctness or mastery, so they are motivation feedback and not a grade
(720 F4: "avoid numeric grades").
"""

from app.services.rewards.catalog import CATALOG, catalog_for_client, price_of
from app.services.rewards.wallet import (
    EARN_RULES,
    get_wallet,
    grant_goal_stage,
    grant_help_request,
    grant_unlock,
    list_ledger,
    purchase_asset,
)

__all__ = [
    "CATALOG",
    "EARN_RULES",
    "catalog_for_client",
    "get_wallet",
    "grant_goal_stage",
    "grant_help_request",
    "grant_unlock",
    "list_ledger",
    "price_of",
    "purchase_asset",
]
