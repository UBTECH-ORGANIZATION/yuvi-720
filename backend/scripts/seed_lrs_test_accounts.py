"""Create the two dedicated accounts used for the MANUAL MoE-LRS test script.

The ministry asked for statements produced by a human working the product, not
by a simulator. To make that run auditable we give the tester one student and
one teacher account with their OWN exidentifiers, so every statement they
produce can be isolated in the `lrs_outbox` ledger by actor alone:

    statement.actor.account.name == LRS_TEST_STUDENT_EXID / _TEACHER_EXID

This script only creates accounts, org links and the exidentifier overrides —
it never emits an xAPI statement. Every event in the report comes from the UI.

Idempotent. Run:
    cd backend && ./.venv/bin/python scripts/seed_lrs_test_accounts.py
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.env import ensure_env_loaded  # noqa: E402

ensure_env_loaded()

from app.auth.passwords import hash_password  # noqa: E402
from app.auth.repository import DEFAULT_PREFERENCES, upsert_user  # noqa: E402
from app.brain.repository import apply_brain_updates, get_brain  # noqa: E402
from app.services import org_repository  # noqa: E402

DEFAULT_PASSWORD = "Bodek720!"

STUDENT_ID = "lrs-student"
TEACHER_ID = "lrs-teacher"
GROUP_ID = "group-lrs-test"
SCHOOL_ID = "school-lrs-test"

STUDENT_EXID = "1020000001"
TEACHER_EXID = "1020000002"
SCHOOL_SYMBOL = "123456"
NMM_ID = "90635956"

ACCOUNTS = [
    {
        "_id": STUDENT_ID,
        "username": STUDENT_ID,
        "display_name": "תלמיד בדיקה 720",
        "roles": ["learner"],
        "exidentifier": STUDENT_EXID,
    },
    {
        "_id": TEACHER_ID,
        "username": TEACHER_ID,
        "display_name": "מורה בדיקה 720",
        "roles": ["teacher"],
        "exidentifier": TEACHER_EXID,
    },
]


async def seed(password: str) -> None:
    for account in ACCOUNTS:
        await upsert_user({
            **account,
            "password": hash_password(password),
            "school_symbol": SCHOOL_SYMBOL,
            "nmm_id": NMM_ID,
            "preferences": {**DEFAULT_PREFERENCES, "theme": "system", "language": "he"},
        })
        await get_brain(account["_id"])
        await apply_brain_updates(account["_id"], {
            "identity.display_name": account["display_name"],
            "identity.locale": "he",
        })
        print(f"✅ user {account['_id']} · exidentifier {account['exidentifier']}")

    await org_repository.ensure_indexes()
    await org_repository.upsert_school(SCHOOL_ID, name="בית ספר בדיקות 720", city="נתניה")
    await org_repository.upsert_group(
        GROUP_ID, school_id=SCHOOL_ID, name="כיתת בדיקות LRS", subject="math", grade="ז",
        # The class's ministry id — what a group dashboard names as dashboardId.
        nmm_id=NMM_ID,
    )
    await org_repository.link_teacher(
        TEACHER_ID, GROUP_ID, school_id=SCHOOL_ID, link_role="homeroom"
    )
    await org_repository.enroll_learner(STUDENT_ID, GROUP_ID, school_id=SCHOOL_ID)
    print(f"✅ org: {TEACHER_ID} teaches {GROUP_ID}, {STUDENT_ID} enrolled")


async def fresh() -> None:
    """A clean run of the ministry's script: the learner starts at onboarding
    again (brain, events, threads, reflections, goals wiped — the account and
    the permanent `lrs_outbox` ledger stay), and both accounts forget their
    MoE session and agency start so the next login opens a new session and
    the questionnaire is timed from its first screen."""
    from app.auth.repository import set_agency_started_at, set_current_moe_session
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import reset_learner  # noqa: E402

    await reset_learner.purge_mongo([STUDENT_ID], apply=True)
    reset_learner.purge_fallbacks([STUDENT_ID], apply=True)
    for account in ACCOUNTS:
        await set_current_moe_session(account["_id"], None)
        await set_agency_started_at(account["_id"], None)
    try:
        from app.services.lrs import session_registry

        for account in ACCOUNTS:
            await session_registry.close_open_for_user(account["_id"], reason="relogin")
    except Exception as exc:  # the registry is bookkeeping, never a gate
        print(f"⚠️ open sessions not closed: {type(exc).__name__}")
    print(f"✅ fresh: {STUDENT_ID} reset to onboarding; sessions and agency starts cleared")


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed the LRS manual-test accounts")
    parser.add_argument("--password", default=DEFAULT_PASSWORD)
    parser.add_argument("--fresh", action="store_true", help="also reset the learner and both accounts' sessions")

    async def run(args) -> None:
        await seed(args.password)
        if args.fresh:
            await fresh()

    asyncio.run(run(parser.parse_args()))


if __name__ == "__main__":
    main()
