"""In-memory stand-ins for the motor collections the console touches.

The console code paths are exercised for real; only the driver is faked. The
fake implements the subset of the Mongo query language the console uses
(equality with array membership, ``$in``, ``$gte``/``$gt``/``$lt``/``$lte``,
``$ne``, ``$exists``), ``$set``/``$setOnInsert`` upserts, sort/limit cursors
and ``delete_one``/``count_documents``.
"""

from __future__ import annotations

import copy
from typing import Any, Dict, Iterable, List, Optional

from backend.console.games_budget import GamesBudget, GamesStore
from backend.console.org_repository import OrgRepository
from backend.console.org_service import OrgService
from backend.console.users import UserRepository, hash_password


def _lookup(row: Dict[str, Any], path: str) -> Any:
    actual: Any = row
    for part in path.split("."):
        actual = actual.get(part) if isinstance(actual, dict) else None
    return actual


def _matches(row: Dict[str, Any], query: Dict[str, Any]) -> bool:
    for field, expected in query.items():
        actual = _lookup(row, field)
        if isinstance(expected, dict) and any(str(key).startswith("$") for key in expected):
            if "$in" in expected and actual not in expected["$in"]:
                return False
            if "$nin" in expected and actual in expected["$nin"]:
                return False
            if "$ne" in expected and actual == expected["$ne"]:
                return False
            if "$exists" in expected and (actual is not None) != bool(expected["$exists"]):
                return False
            for op in ("$gte", "$gt", "$lt", "$lte"):
                if op in expected:
                    if actual is None:
                        return False
                    bound = expected[op]
                    ok = {
                        "$gte": actual >= bound, "$gt": actual > bound,
                        "$lt": actual < bound, "$lte": actual <= bound,
                    }[op]
                    if not ok:
                        return False
            continue
        if isinstance(actual, list) and not isinstance(expected, list):
            if expected not in actual:
                return False
        elif actual != expected:
            return False
    return True


class _Result:
    def __init__(self, **fields: Any) -> None:
        for key, value in fields.items():
            setattr(self, key, value)


class FakeCursor:
    def __init__(self, rows: List[Dict[str, Any]]) -> None:
        self._rows = rows

    def sort(self, key: Any, direction: Optional[int] = None) -> "FakeCursor":
        specs = key if isinstance(key, list) else [(key, direction or 1)]
        for field, order in reversed(specs):
            self._rows.sort(key=lambda row: str(_lookup(row, field) or ""), reverse=order < 0)
        return self

    def limit(self, count: int) -> "FakeCursor":
        if count:
            self._rows = self._rows[:count]
        return self

    async def to_list(self, length: Optional[int] = None) -> List[Dict[str, Any]]:
        rows = self._rows if length is None else self._rows[:length]
        return [copy.deepcopy(row) for row in rows]

    def __aiter__(self):
        return self._iterate()

    async def _iterate(self):
        for row in self._rows:
            yield copy.deepcopy(row)


class FakeCollection:
    def __init__(self, name: str) -> None:
        self.name = name
        self.rows: List[Dict[str, Any]] = []

    # reads
    def find(self, query: Optional[Dict[str, Any]] = None, projection: Any = None) -> FakeCursor:
        return FakeCursor([row for row in self.rows if _matches(row, query or {})])

    async def find_one(self, query: Optional[Dict[str, Any]] = None, projection: Any = None):
        for row in self.rows:
            if _matches(row, query or {}):
                return copy.deepcopy(row)
        return None

    async def count_documents(self, query: Optional[Dict[str, Any]] = None) -> int:
        return len([row for row in self.rows if _matches(row, query or {})])

    # writes
    async def insert_one(self, document: Dict[str, Any]) -> _Result:
        self.rows.append(copy.deepcopy(document))
        return _Result(inserted_id=document.get("_id"))

    async def update_one(
        self, query: Dict[str, Any], update: Dict[str, Any], upsert: bool = False
    ) -> _Result:
        for row in self.rows:
            if _matches(row, query):
                row.update(copy.deepcopy(update.get("$set") or {}))
                for key in update.get("$unset") or {}:
                    row.pop(key, None)
                return _Result(matched_count=1, modified_count=1, upserted_id=None)
        if not upsert:
            return _Result(matched_count=0, modified_count=0, upserted_id=None)
        row = {key: value for key, value in query.items() if not str(key).startswith("$")}
        row.update(copy.deepcopy(update.get("$setOnInsert") or {}))
        row.update(copy.deepcopy(update.get("$set") or {}))
        self.rows.append(row)
        return _Result(matched_count=0, modified_count=0, upserted_id=row.get("_id"))

    async def delete_one(self, query: Dict[str, Any]) -> _Result:
        for index, row in enumerate(self.rows):
            if _matches(row, query):
                del self.rows[index]
                return _Result(deleted_count=1)
        return _Result(deleted_count=0)

    async def create_index(self, *args: Any, **kwargs: Any) -> str:
        return "ok"


class FakeConsoleDatabase:
    """Same surface as ``backend.console.ConsoleDatabase``."""

    def __init__(self) -> None:
        self.collections: Dict[str, FakeCollection] = {}

    def collection(self, name: str) -> FakeCollection:
        if name not in self.collections:
            self.collections[name] = FakeCollection(name)
        return self.collections[name]

    def rows(self, name: str) -> List[Dict[str, Any]]:
        return self.collection(name).rows

    def close(self) -> None:
        return None


class ConsoleHarness:
    """The console services wired over one fake database."""

    def __init__(self, db: Optional[FakeConsoleDatabase] = None) -> None:
        self.db = db or FakeConsoleDatabase()
        self.org = OrgRepository(self.db)
        self.users = UserRepository(self.db)
        self.service = OrgService(self.org, self.users)
        self.store = GamesStore(self.db)
        self.budget = GamesBudget(self.store, self.users, self.org)


async def seed_users(harness: ConsoleHarness, accounts: Iterable[tuple]) -> None:
    for user_id, roles in accounts:
        await harness.users.upsert_user({
            "_id": user_id, "username": user_id, "display_name": user_id.title(),
            "roles": list(roles), "password": hash_password("Aa12345"),
        })


async def seed_org(harness: ConsoleHarness, actor: str = "root") -> None:
    """Spark's admin_org fixture: one school, one group, alice teaches kid1."""
    await seed_users(harness, (
        ("root", ["teacher", "admin"]), ("alice", ["teacher"]),
        ("bob", ["teacher"]), ("kid1", ["learner"]), ("kid2", ["learner"]),
    ))
    await harness.org.grant_admin("root", scope="system")
    await harness.service.save_school(actor, {"id": "s1", "name": "School One"})
    await harness.service.save_group(actor, {"id": "g1", "school_id": "s1", "name": "Group One"})
    await harness.service.link_teacher(actor, "alice", "g1")
    await harness.service.enroll_learner(actor, "kid1", "g1")
