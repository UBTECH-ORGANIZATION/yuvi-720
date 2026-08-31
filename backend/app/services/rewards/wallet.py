"""Spark wallet + append-only reward ledger.

Design constraints (see `docs/design/rewards-sparks.md`):
- **Server-authoritative.** Amounts and prices come from constants here / the
  catalog module, never from the client.
- **Idempotent.** Every grant carries a deterministic key that becomes the
  ledger `_id`, so a replayed request, a page reload or a stage re-save can
  never double-grant.
- **Effort only.** Sparks are granted for acting on a goal, never for a correct
  answer or a mastery level, so the balance is not a hidden grade.
- Wallet state is neither a belief about the learner (so: not in the brain) nor
  client-writable (so: not in `learner_state`).
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from app.brain.repository import _get_collection_named
from app.services.rewards.catalog import price_of
from app.services.rewards.pricing import (
    GOAL_VALUE_DEFAULT,
    GOAL_VALUE_MAX,
    GOAL_VALUE_MIN,
    STAGE_SHARE,
    clamp_goal_value,
    stage_amount,
)
from learner_state import (  # type: ignore
    get_learner_state,
    grant_avatar_unlock,
    normalize_learner_id,
)

_FALLBACK = Path(__file__).resolve().parents[3] / ".runtime" / "rewards.json"
_indexes_ready = False

# Asking for help is a self-regulation win, not a failure — it is rewarded once,
# at a flat rate, because its worth does not depend on the goal.
HELP_REWARD = 5

# A safety net against farming, not a budget: one goal priced at the top of the
# band still pays out in full on the day it is finished.
DAILY_SPARK_CAP = 150
DAILY_GOAL_CAP = 4

# What a teacher may attach to a good word (#467). Fixed rather than free-entry
# so the amounts keep a shared meaning across teachers and a child learns what
# each one means. The server owns this set exactly as `clamp_goal_value` owns
# the goal band — a client never names its own figure.
#
# The ceiling is 40 deliberately: it equals the final stage of a top-priced goal
# and a tier-1 cosmetic, so the largest gift a teacher can give is generous
# without out-paying anything the system awards for real work.
TEACHER_SPARK_AMOUNTS = (10, 20, 40)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _today() -> str:
    return datetime.now(timezone.utc).date().isoformat()


def _empty_wallet(lid: str) -> dict[str, Any]:
    return {
        "_id": lid,
        "learner_id": lid,
        "balance": 0,
        "lifetime_earned": 0,
        "lifetime_spent": 0,
        "daily": {"date": _today(), "earned": 0, "goal_ids": []},
        "updated_at": _now(),
    }


def _public(wallet: dict[str, Any]) -> dict[str, Any]:
    daily = wallet.get("daily") or {}
    fresh = daily.get("date") == _today()
    return {
        "balance": int(wallet.get("balance") or 0),
        "lifetimeEarned": int(wallet.get("lifetime_earned") or 0),
        "lifetimeSpent": int(wallet.get("lifetime_spent") or 0),
        "dailyEarned": int(daily.get("earned") or 0) if fresh else 0,
        "dailyCap": DAILY_SPARK_CAP,
        "dailyGoals": len(daily.get("goal_ids") or []) if fresh else 0,
        "dailyGoalCap": DAILY_GOAL_CAP,
        # Shipped with every wallet so the learner can always see, up front,
        # what each action is worth — the price list is never guessed client-side.
        "rules": earn_rules(),
    }


def earn_rules() -> dict[str, Any]:
    """How earning works, so the UI can state it without hardcoding numbers.

    Goal payouts are per-goal (Yuvi prices each one), so what is fixed — and
    therefore publishable — is the split across stages and the help reward.
    """
    return {
        "stageShares": dict(STAGE_SHARE),
        "help": HELP_REWARD,
        "goalValueRange": [GOAL_VALUE_MIN, GOAL_VALUE_MAX],
    }


# ── fallback store ────────────────────────────────────────────────────────────

def _read_fallback() -> dict[str, Any]:
    try:
        if _FALLBACK.exists():
            return json.loads(_FALLBACK.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"⚠️ rewards fallback read failed: {exc}")
    return {"wallets": {}, "ledger": {}}


def _write_fallback(data: dict[str, Any]) -> None:
    try:
        _FALLBACK.parent.mkdir(parents=True, exist_ok=True)
        _FALLBACK.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    except OSError as exc:
        print(f"⚠️ rewards fallback write failed: {exc}")


# ── raw wallet access ─────────────────────────────────────────────────────────

async def _load_wallet(lid: str) -> dict[str, Any]:
    collection = _get_collection_named("learner_wallet")
    if collection is not None:
        try:
            return await collection.find_one({"_id": lid}) or _empty_wallet(lid)
        except Exception as exc:
            print(f"⚠️ wallet read failed, using fallback: {exc}")
    return (_read_fallback().get("wallets") or {}).get(lid) or _empty_wallet(lid)


async def _store_wallet(lid: str, wallet: dict[str, Any]) -> None:
    wallet["updated_at"] = _now()
    collection = _get_collection_named("learner_wallet")
    if collection is not None:
        try:
            await collection.update_one({"_id": lid}, {"$set": wallet}, upsert=True)
            return
        except Exception as exc:
            print(f"⚠️ wallet write failed, using fallback: {exc}")
    data = _read_fallback()
    data.setdefault("wallets", {})[lid] = wallet
    _write_fallback(data)


async def _ledger_claim(entry: dict[str, Any]) -> bool:
    """Reserve an idempotency key. ``False`` means it was already used."""
    collection = _get_collection_named("reward_ledger")
    if collection is not None:
        try:
            existing = await collection.find_one({"_id": entry["_id"]})
            if existing:
                return False
            await collection.insert_one(dict(entry))
            return True
        except Exception as exc:
            print(f"⚠️ ledger write failed, using fallback: {exc}")
    data = _read_fallback()
    ledger = data.setdefault("ledger", {})
    if entry["_id"] in ledger:
        return False
    ledger[entry["_id"]] = dict(entry)
    _write_fallback(data)
    return True


async def _ledger_release(key: str) -> None:
    """Undo a claim when the balance move behind it could not be completed."""
    collection = _get_collection_named("reward_ledger")
    if collection is not None:
        try:
            await collection.delete_one({"_id": key})
            return
        except Exception as exc:
            print(f"⚠️ ledger rollback failed, using fallback: {exc}")
    data = _read_fallback()
    (data.get("ledger") or {}).pop(key, None)
    _write_fallback(data)


# ── public API ────────────────────────────────────────────────────────────────

async def ensure_indexes() -> None:
    """The Sparks ledger is append-only, and read newest-first per learner.

    The wallet itself is keyed by `_id`, which is already unique — only the
    ledger's `{learner_id} sort at desc` needs an index of its own.
    """
    global _indexes_ready
    if _indexes_ready:
        return
    collection = _get_collection_named("reward_ledger")
    if collection is None:
        return
    try:
        await collection.create_index([("learner_id", 1), ("at", -1)], name="learner_at")
        _indexes_ready = True
    except Exception as exc:  # Cosmos may manage indexes outside the Mongo API.
        print(f"⚠️ reward_ledger index setup skipped: {type(exc).__name__}")


async def get_wallet(learner_id: Optional[str]) -> dict[str, Any]:
    lid = normalize_learner_id(learner_id)
    return _public(await _load_wallet(lid))


async def list_ledger(learner_id: Optional[str], limit: int = 20) -> list[dict[str, Any]]:
    lid = normalize_learner_id(learner_id)
    rows: list[dict[str, Any]] = []
    collection = _get_collection_named("reward_ledger")
    if collection is not None:
        try:
            cursor = collection.find({"learner_id": lid}).sort("at", -1).limit(max(1, min(limit, 100)))
            rows = [r async for r in cursor]
        except Exception as exc:
            print(f"⚠️ ledger read failed, using fallback: {exc}")
    if not rows:
        all_rows = list((_read_fallback().get("ledger") or {}).values())
        rows = sorted(
            [r for r in all_rows if r.get("learner_id") == lid],
            key=lambda r: r.get("at") or "",
            reverse=True,
        )[:limit]
    return [
        {
            "kind": r.get("kind"),
            "amount": int(r.get("amount") or 0),
            "reason": r.get("reason"),
            "at": r.get("at"),
            # Present only when a person chose to give these (#467). The child's
            # history should not read as if the system awarded a teacher's gift.
            **({"granted_by": r["granted_by"]} if r.get("granted_by") else {}),
        }
        for r in rows
    ]


async def _grant(
    learner_id: str,
    key: str,
    amount: int,
    reason: str,
    ref: dict[str, Any],
    goal_id: Optional[str] = None,
    count_daily: bool = True,
    granted_by: Optional[str] = None,
) -> dict[str, Any]:
    """Add sparks once per ``key``. Returns the grant outcome + fresh wallet.

    ``count_daily=False`` is for sparks a PERSON chose to give (#467), not ones
    the learner earned. The daily caps above exist to stop a child farming their
    own rewards; a teacher's gift is not farming, and silently paying 0 of a
    gift the teacher believes they sent is the worst outcome available — the
    teacher is told they gave 40, the child receives nothing, and nobody finds
    out. So a gift neither consumes the child's daily allowance nor is blocked
    by it.

    ``granted_by`` records WHO caused the grant. Without it a teacher's gift and
    a learner's own milestone write identical ledger rows, and the child cannot
    be told the sparks came from a person.
    """
    lid = normalize_learner_id(learner_id)
    amount = max(0, int(amount))
    wallet = await _load_wallet(lid)
    daily = wallet.get("daily") or {}
    if daily.get("date") != _today():
        daily = {"date": _today(), "earned": 0, "goal_ids": []}

    goal_ids: list[str] = list(daily.get("goal_ids") or [])
    if count_daily:
        capped = False
        if int(daily.get("earned") or 0) >= DAILY_SPARK_CAP:
            capped = True
        elif goal_id and goal_id not in goal_ids and len(goal_ids) >= DAILY_GOAL_CAP:
            capped = True
        if capped:
            return {"granted": 0, "capped": True, "wallet": _public(wallet)}

        payable = min(amount, DAILY_SPARK_CAP - int(daily.get("earned") or 0))
        if payable <= 0:
            return {"granted": 0, "capped": True, "wallet": _public(wallet)}
    else:
        payable = amount
        if payable <= 0:
            return {"granted": 0, "wallet": _public(wallet)}

    entry = {
        "_id": key,
        "learner_id": lid,
        "kind": "earn",
        "amount": payable,
        "reason": reason,
        "ref": ref,
        "balance_after": int(wallet.get("balance") or 0) + payable,
        "at": _now(),
    }
    if granted_by:
        entry["granted_by"] = granted_by
    claimed = await _ledger_claim(entry)
    if not claimed:
        # Already granted for this exact milestone — a replay, not a new reward.
        return {"granted": 0, "duplicate": True, "wallet": _public(wallet)}

    if goal_id and goal_id not in goal_ids:
        goal_ids.append(goal_id)
    wallet["balance"] = int(wallet.get("balance") or 0) + payable
    wallet["lifetime_earned"] = int(wallet.get("lifetime_earned") or 0) + payable
    wallet["daily"] = {
        "date": _today(),
        # A gift is left out of the day's tally entirely: it was not earned, so
        # it must not eat into what the child can still earn today.
        "earned": int(daily.get("earned") or 0) + (payable if count_daily else 0),
        "goal_ids": goal_ids,
    }
    wallet["learner_id"] = lid
    wallet["_id"] = lid
    await _store_wallet(lid, wallet)
    return {"granted": payable, "reason": reason, "wallet": _public(wallet)}


async def _goal_stages_paid(lid: str, goal_id: str) -> int:
    """Sparks already paid for reaching stages on this goal.

    Help requests are excluded: they are a flat, separate reward for asking, not
    an instalment of the goal's price.
    """
    def _stage_rows(rows: Any) -> int:
        total = 0
        for row in rows:
            if (row.get("ref") or {}).get("stage") in STAGE_SHARE:
                total += int(row.get("amount") or 0)
        return total

    collection = _get_collection_named("reward_ledger")
    if collection is not None:
        try:
            cursor = collection.find({"learner_id": lid, "ref.goal_id": goal_id})
            return _stage_rows([row async for row in cursor])
        except Exception as exc:
            print(f"⚠️ goal payout read failed, using fallback: {exc}")
    return _stage_rows([
        row for row in (_read_fallback().get("ledger") or {}).values()
        if row.get("learner_id") == lid and (row.get("ref") or {}).get("goal_id") == goal_id
    ])


async def grant_goal_stage(
    learner_id: str, goal_id: str, stage: str, goal_value: Optional[int] = None
) -> dict[str, Any]:
    """Reward advancing one mentoring goal to ``stage`` (once per goal+stage).

    ``goal_value`` is the price Yuvi put on that specific goal; the share paid
    for this stage is computed server-side, never sent by the client.

    Finishing settles the balance rather than paying a fixed share. The learner
    is shown one figure — what the goal is worth — so that figure has to be what
    they end up with, and the route they took through the stages must not change
    it. `progressed` is currently unreachable from the goal card, so a flat 50%
    on `summarized` would quietly pay a quarter less than the goal advertised.
    """
    lid = normalize_learner_id(learner_id)
    if stage == "summarized":
        value = clamp_goal_value(goal_value if goal_value else GOAL_VALUE_DEFAULT)
        amount = max(0, value - await _goal_stages_paid(lid, goal_id))
    else:
        amount = stage_amount(goal_value, stage)
    if not amount:
        # `chosen` is the creation state and pays nothing, so opening goals
        # cannot be farmed.
        return {"granted": 0, "wallet": await get_wallet(learner_id)}
    return await _grant(
        lid,
        f"earn:{lid}:goal:{goal_id}:{stage}",
        amount,
        f"goal.{stage}",
        {"goal_id": goal_id, "stage": stage},
        goal_id=goal_id,
    )


def is_teacher_spark_amount(raw: Any) -> bool:
    """Whether ``raw`` is one of the amounts a teacher may attach to a good word."""
    try:
        return int(raw) in TEACHER_SPARK_AMOUNTS
    except (TypeError, ValueError):
        return False


async def grant_teacher_kudos(
    learner_id: str, *, draft_id: str, amount: int, teacher_id: str,
) -> dict[str, Any]:
    """Sparks a TEACHER chose to give, riding a good word (#467).

    Keyed on the composer's ``draft_id`` rather than the kudos id: a retried
    send mints a new kudos row, so a kudos-keyed grant would pay twice on a
    double-click. The draft id is stable across those retries — the same
    reasoning as `mentoring`'s composer key.

    Outside the daily caps (see `_grant`), and stamped with the teacher so the
    child can be told a person did this.
    """
    if not is_teacher_spark_amount(amount):
        # Not clamped into range like a goal value: a teacher picks from three
        # buttons, so anything else is a malformed request, not a near miss.
        return {"granted": 0, "invalid_amount": True,
                "wallet": await get_wallet(learner_id)}
    lid = normalize_learner_id(learner_id)
    return await _grant(
        lid,
        f"earn:{lid}:kudos:{draft_id}",
        int(amount),
        "kudos.teacher",
        {"draft_id": draft_id, "teacher_id": teacher_id},
        count_daily=False,
        granted_by=teacher_id,
    )


async def grant_help_request(learner_id: str, goal_id: str) -> dict[str, Any]:
    """Reward asking for help on a goal (once per goal). Never a penalty."""
    lid = normalize_learner_id(learner_id)
    return await _grant(
        lid,
        f"earn:{lid}:goal:{goal_id}:help",
        HELP_REWARD,
        "goal.help",
        {"goal_id": goal_id, "stage": "help"},
        goal_id=goal_id,
    )


async def grant_unlock(learner_id: str, asset_id: str, key: str) -> dict[str, Any]:
    """Grant a cosmetic directly (milestone reward), bypassing the wallet."""
    lid = normalize_learner_id(learner_id)
    claimed = await _ledger_claim({
        "_id": f"unlock:{lid}:{key}",
        "learner_id": lid,
        "kind": "unlock",
        "amount": 0,
        "reason": key,
        "ref": {"asset_id": asset_id},
        "balance_after": int((await _load_wallet(lid)).get("balance") or 0),
        "at": _now(),
    })
    if not claimed:
        return {"granted": False, "duplicate": True, "assetId": asset_id}
    await grant_avatar_unlock(lid, asset_id)
    return {"granted": True, "assetId": asset_id}


async def purchase_asset(learner_id: str, asset_id: str) -> dict[str, Any]:
    """Spend sparks on a Yuvi Studio cosmetic. Price is resolved server-side."""
    lid = normalize_learner_id(learner_id)
    price = price_of(asset_id)
    if price is None:
        return {"ok": False, "reason": "not_for_sale"}

    state = await get_learner_state(lid)
    owned = state.get("avatar_unlocks") or []
    if asset_id in owned:
        return {"ok": False, "reason": "owned", "wallet": await get_wallet(lid)}

    wallet = await _load_wallet(lid)
    balance = int(wallet.get("balance") or 0)
    if balance < price:
        return {
            "ok": False,
            "reason": "insufficient",
            "missing": price - balance,
            "wallet": _public(wallet),
        }

    key = f"spend:{lid}:{asset_id}"
    claimed = await _ledger_claim({
        "_id": key,
        "learner_id": lid,
        "kind": "spend",
        "amount": price,
        "reason": "shop.purchase",
        "ref": {"asset_id": asset_id},
        "balance_after": balance - price,
        "at": _now(),
    })
    if not claimed:
        return {"ok": False, "reason": "owned", "wallet": _public(wallet)}

    try:
        await grant_avatar_unlock(lid, asset_id)
    except Exception as exc:  # keep the wallet honest if the unlock never landed
        print(f"⚠️ unlock write failed, rolling back purchase: {exc}")
        await _ledger_release(key)
        return {"ok": False, "reason": "unlock_failed", "wallet": _public(wallet)}

    wallet["balance"] = balance - price
    wallet["lifetime_spent"] = int(wallet.get("lifetime_spent") or 0) + price
    wallet["learner_id"] = lid
    wallet["_id"] = lid
    await _store_wallet(lid, wallet)
    return {"ok": True, "assetId": asset_id, "price": price, "wallet": _public(wallet)}
