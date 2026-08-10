"""The teacher assistant's tool registry — and its authorization boundary.

MCP-shaped on purpose: every tool is `name + description + JSON Schema + async
handler`, so lifting this into a real MCP server later is mechanical rather than
a rewrite. It is *not* an MCP server today, because that would mean a second
authentication path into the org model (see A3/A9 for why that was rejected).

`dispatch()` is the security core. Read it as five gates in order:

  1. **Known tool.** An unknown name returns an error frame; it never raises
     into the stream, because a model that hallucinates a tool name would
     otherwise take down the teacher's whole answer.
  2. **Valid arguments.** Validated against the tool's own schema.
  3. **Scope, from the server, not the model.** Every `learner_id` and
     `group_id` in the arguments is re-checked against the sets resolved once,
     server-side, *before* the loop began. The model's argument is treated as a
     claim to verify, never as an authorization.
  4. **Belt and braces.** A second `org.teacher_can_access_learner` DB check, so
     a stale in-memory set cannot outlive a revoked link.
  5. **Audited.** Every call writes a `teacher_tool_calls` row with argument
     **keys only** — never values, since values are learner ids.

The refusal is deliberately indistinguishable from "no such student": a teacher
probing for another teacher's roster learns nothing from the difference.

No tool in this registry writes. The assistant drafts; the teacher clicks a real
dependency-guarded endpoint. A jailbroken prompt must not be able to write a
directive into a child's brain or approve a goal for sparks.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Optional

from app.services.ai_usage import UsageContext

# ── budget ───────────────────────────────────────────────────────────────────
# The `strong` tier with multi-round tool calling is an order of magnitude
# costlier per turn than the coach, so the loop is bounded in three independent
# ways (risk 6 in the plan).
MAX_TOOL_CALLS = 8
MAX_ROUNDS = 4
MAX_SECONDS = 30.0

AUDIT_COLLECTION = "teacher_tool_calls"


class ToolError(Exception):
    """A tool failed in a way the model should see as a result, not a crash."""


@dataclass
class TeacherToolContext:
    """Everything a tool may rely on — all of it resolved server-side.

    `allowed_group_ids` / `allowed_learner_ids` are computed ONCE per turn,
    before the model runs. Recomputing them per call would be slower and no
    safer; taking them from the model would be the vulnerability this whole
    module exists to prevent.
    """

    teacher_id: str
    language: str
    allowed_group_ids: frozenset[str]
    allowed_learner_ids: frozenset[str]
    is_admin: bool
    usage_context: UsageContext
    screen: dict[str, Any] = field(default_factory=dict)

    # Budget accounting for this turn.
    calls_made: int = 0
    started_at: float = field(default_factory=time.monotonic)

    def budget_exhausted(self) -> Optional[str]:
        if self.calls_made >= MAX_TOOL_CALLS:
            return "tool_budget_exhausted"
        if time.monotonic() - self.started_at > MAX_SECONDS:
            return "time_budget_exhausted"
        return None


@dataclass(frozen=True)
class TeacherTool:
    name: str
    description: str
    parameters: dict[str, Any]
    handler: Callable[[TeacherToolContext, dict[str, Any]], Awaitable[Any]]
    #: Argument names carrying a learner id — each is scope-checked before the
    #: handler runs. Declared per tool rather than sniffed by name, so a new
    #: tool cannot accidentally opt out of the check by renaming a field.
    learner_args: tuple[str, ...] = ()
    group_args: tuple[str, ...] = ()

    def as_openai_schema(self) -> dict[str, Any]:
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.parameters,
            },
        }


_REGISTRY: dict[str, TeacherTool] = {}


def register(tool: TeacherTool) -> TeacherTool:
    if tool.name in _REGISTRY:
        raise ValueError(f"duplicate teacher tool: {tool.name}")
    _REGISTRY[tool.name] = tool
    return tool


def get(name: str) -> Optional[TeacherTool]:
    return _REGISTRY.get(name)


def all_tools() -> list[TeacherTool]:
    return list(_REGISTRY.values())


def schemas() -> list[dict[str, Any]]:
    """The `tools=` payload for the provider."""
    return [tool.as_openai_schema() for tool in _REGISTRY.values()]


def manifest() -> list[dict[str, str]]:
    """What the assistant could fetch — derived from the registry itself.

    Powers `list_available_data`, so the assistant can honestly offer what it
    has rather than guessing, and the offer cannot drift from the code.
    """
    return [{"name": tool.name, "description": tool.description} for tool in _REGISTRY.values()]


def reset_for_tests() -> None:
    _REGISTRY.clear()


# ── argument validation ──────────────────────────────────────────────────────

def _validate(tool: TeacherTool, args: dict[str, Any]) -> Optional[str]:
    """A deliberately small JSON-Schema subset: types, required, enum.

    Full schema validation is not the job here — the security properties come
    from the scope checks below, not from the schema. This exists to turn a
    malformed model argument into a clean error frame instead of a TypeError.
    """
    schema = tool.parameters or {}
    properties = schema.get("properties") or {}
    for name in (schema.get("required") or []):
        if args.get(name) in (None, ""):
            return f"missing_required_argument:{name}"

    types = {
        "string": str, "integer": int, "number": (int, float),
        "boolean": bool, "array": list, "object": dict,
    }
    for name, value in args.items():
        spec = properties.get(name)
        if not spec or value is None:
            continue
        expected = types.get(spec.get("type"))
        # bool is an int subclass; an integer field must not accept True.
        if expected and (not isinstance(value, expected)
                         or (spec.get("type") in {"integer", "number"} and isinstance(value, bool))):
            return f"invalid_argument_type:{name}"
        if spec.get("enum") and value not in spec["enum"]:
            return f"invalid_argument_value:{name}"
    return None


# ── the scope gate ───────────────────────────────────────────────────────────

async def _authorize(
    tool: TeacherTool, context: TeacherToolContext, args: dict[str, Any]
) -> Optional[str]:
    """Return a refusal code, or None when every referenced id is in scope."""
    from app.brain import org

    for name in tool.learner_args:
        raw = args.get(name)
        if raw in (None, ""):
            continue
        learner_id = str(raw)
        # Gate 3 — the server's set, never the model's claim.
        if not context.is_admin and learner_id not in context.allowed_learner_ids:
            return "not_authorized"
        # Gate 4 — the live DB, so a link revoked mid-conversation lands now.
        if not await org.teacher_can_access_learner(context.teacher_id, learner_id):
            return "not_authorized"

    for name in tool.group_args:
        raw = args.get(name)
        if raw in (None, ""):
            continue
        group_id = str(raw)
        if not context.is_admin and group_id not in context.allowed_group_ids:
            return "not_authorized"
        if not await org.teacher_can_access_group(context.teacher_id, group_id):
            return "not_authorized"

    return None


# ── audit ────────────────────────────────────────────────────────────────────

async def _audit(
    context: TeacherToolContext, name: str, args: dict[str, Any],
    *, authorized: bool, status: str, duration_ms: int,
) -> None:
    """Append-only record of what the assistant was asked to do.

    Argument **keys** only. The values are learner ids, and an audit log that
    accumulates them becomes its own privacy problem.
    """
    document = {
        "teacher_id": context.teacher_id,
        "tool": name,
        "argument_keys": sorted(args.keys()),
        "authorized": authorized,
        "status": status,
        "duration_ms": duration_ms,
        "at": _now_iso(),
    }
    try:
        from app.brain.repository import _get_collection_named

        collection = _get_collection_named(AUDIT_COLLECTION)
        if collection is not None:
            await collection.insert_one(document)
    except Exception as exc:      # pragma: no cover — auditing never breaks a turn
        print(f"⚠️ teacher tool audit skipped: {type(exc).__name__}")


def _now_iso() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


# ── dispatch ─────────────────────────────────────────────────────────────────

async def dispatch(
    name: str, args: dict[str, Any], context: TeacherToolContext
) -> dict[str, Any]:
    """Run one tool call. Always returns a dict — never raises into the stream."""
    started = time.monotonic()
    args = dict(args or {})

    exhausted = context.budget_exhausted()
    if exhausted:
        return {"error": exhausted}

    tool = _REGISTRY.get(name)
    if tool is None:
        # Gate 1. Audited too: a model inventing tool names is worth seeing.
        await _audit(context, name, args, authorized=False,
                     status="unknown_tool", duration_ms=0)
        return {"error": "unknown_tool", "available": sorted(_REGISTRY)}

    context.calls_made += 1

    invalid = _validate(tool, args)
    if invalid:
        await _audit(context, name, args, authorized=True,
                     status=invalid, duration_ms=0)
        return {"error": invalid}

    refusal = await _authorize(tool, context, args)
    if refusal:
        await _audit(context, name, args, authorized=False,
                     status=refusal, duration_ms=int((time.monotonic() - started) * 1000))
        # Same wording whether the learner is out of scope or does not exist —
        # the difference would itself leak roster membership.
        return {"error": refusal,
                "detail": "this student is not in one of your groups"}

    try:
        result = await tool.handler(context, args)
        status = "ok"
    except ToolError as exc:
        result, status = {"error": "tool_failed", "detail": str(exc)}, "tool_failed"
    except Exception as exc:      # pragma: no cover — defensive
        print(f"⚠️ teacher tool {name} failed: {type(exc).__name__}")
        result, status = {"error": "tool_failed"}, type(exc).__name__

    await _audit(context, name, args, authorized=True, status=status,
                 duration_ms=int((time.monotonic() - started) * 1000))

    return result if isinstance(result, dict) else {"data": result}


async def ensure_indexes() -> None:
    """Indexes for the audit trail.

    This is the one collection here that grows without bound — every tool call
    the assistant makes appends a row, forever. The index on `(teacher_id, at)`
    is what makes "what did this teacher's assistant do, and was any of it
    refused" answerable at all; the one on `authorized` is what makes the
    refusal query (the interesting one for a data-protection review) cheap.

    Deliberately no TTL: this is the record of what an AI was asked to do with
    minors' data. Expiring it silently would defeat its purpose — pruning is a
    decision for whoever owns retention, not a default.
    """
    from app.brain.repository import _get_collection_named

    handle = _get_collection_named(AUDIT_COLLECTION)
    if handle is None:
        return
    for keys in ([("teacher_id", 1), ("at", -1)], [("authorized", 1)]):
        try:
            await handle.create_index(keys)
        except Exception as exc:      # pragma: no cover - best effort
            print(f"⚠️ teacher_tool_calls index {keys} failed: {type(exc).__name__}")
