"""The generation pipeline: one job in, one validated game (or a failure) out.

Create:  build session (claude-opus-5, custom tools) → model calls `submit_game`
         → post-process → harness-inject → headless validate (learning contract)
         → success ends the turn (is_terminal) / errors go back to the model
         (≤ MAX_SUBMISSIONS) → learning judge (mini model) → JobResult.
Edit/Fix: same session shape with `patch_game` (line-numbered patch DSL) plus
         `submit_game` for rewrites.

Everything the model can call is a `copilot.define_tool`; the tool handler is
where the deterministic post-processing and Playwright validation happen, so
the model sees structured errors with the game still in its own context —
no re-sending of the HTML between repair rounds.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Optional

from pydantic import BaseModel, Field

from copilot import ToolInvocation, ToolResult, define_tool

from . import prompts
from .code_utils import validate_and_fix_code
from .context_pack import AnswerKey, ContextPack
from .copilot_session import HeadlessCopilotSession, TurnUsage
from .harness import build_harness, inject_harness
from .patch_engine import (
    FULL_REWRITE_LINE_THRESHOLD, apply_line_patches, apply_patches, apply_search_replace_patches,
    extract_line_patches, extract_search_replace_patches, number_lines,
)
from .html_utils import extract_html
from .usage import UsageTotals, estimate_cost_usd, record_to_ledger
from .validator import ValidationResult, validate_html


async def _ledger(spec: "JobSpec", operation: str, timer: Any, model: str, usage: Any, error: Optional[str]) -> None:
    """One `ai_usage_events` row per provider turn (no-op standalone)."""
    if spec.usage_context is None:
        return
    try:
        await record_to_ledger(
            context=spec.usage_context.for_operation(operation),
            timer=timer,
            model=model,
            usage=usage,
            status="failed" if error else "completed",
            error=RuntimeError(error) if error else None,
        )
    except Exception:  # metering must never break a build
        log.exception("ledger write failed")


def _timer() -> Any:
    try:
        from app.services.ai_usage import UsageTimer  # type: ignore
        return UsageTimer.start()
    except Exception:
        return None

log = logging.getLogger("game_gen.pipeline")

MAX_SUBMISSIONS = 3
#: A turn that produced this much output and no tool call hit the model's
#: per-turn output cap (32k on claude-opus-5 via Copilot) — the game did not fit.
OUTPUT_CAP_HINT_TOKENS = 30_000
DEFAULT_MODEL = "claude-opus-5"
JUDGE_MODEL = "gpt-5.4-mini"
JUDGE_MIN_SCORE = 3
ProgressFn = Callable[[dict[str, Any]], None]


@dataclass
class JobSpec:
    job_id: str
    game_id: str
    learner_id: str
    kind: str  # create | edit | fix
    pack: ContextPack
    answer_key: AnswerKey
    genre: str = "surprise"
    vibe: str = ""
    clarifications: dict[str, str] = field(default_factory=dict)
    inspirations: list[str] = field(default_factory=list)  # flavour chips, context only
    learner_title: str = ""  # the kid's own name for the game; kept as-is
    instruction: str = ""            # edit / fix
    current_html: str = ""           # edit / fix
    runtime_errors: list[dict[str, Any]] = field(default_factory=list)  # fix
    history: list[str] = field(default_factory=list)
    model: str = DEFAULT_MODEL
    reasoning_effort: str = "high"
    max_ai_credits: Optional[float] = None
    judge: bool = True
    run_judge_model: str = JUDGE_MODEL
    # Yuvi UsageContext (or None when running standalone); one ledger row per turn.
    usage_context: Optional[Any] = None


@dataclass
class Attempt:
    index: int
    tool: str
    ok: bool
    errors: list[dict[str, Any]]
    contract_ok: bool
    contract_reason: str
    elapsed_s: float


@dataclass
class JobResult:
    ok: bool
    html: Optional[str]
    title: str
    summary: str
    attempts: list[Attempt]
    usage: UsageTotals
    judge: Optional[dict[str, Any]]
    screenshot_png: Optional[bytes]
    elapsed_s: float
    error: Optional[str] = None
    model: str = DEFAULT_MODEL
    design_brief: str = ""


class SubmitParams(BaseModel):
    html: str = Field(description="The COMPLETE HTML document of the game, <!DOCTYPE html> to </html>.")
    title: str = Field(description="Short game title in the kid's language (max 40 chars).")
    learning_summary: str = Field(description="One sentence: how the questions gate progress in this game.")
    design_brief: str = Field(default="", description="3-5 lines in the kid's language: the concept, the world, the core loop, how it grows. Shown to the kid.")


class PatchParams(BaseModel):
    patches: str = Field(description="Patch DSL text: REPLACE_LINES a-b … END_REPLACE / INSERT_AFTER n … END_INSERT / DELETE_LINES a-b.")
    summary: str = Field(description="One sentence describing the change.")


class _State:
    """Mutable per-job state shared between the tool handlers and the runner."""

    def __init__(self, spec: JobSpec) -> None:
        self.spec = spec
        self.attempts: list[Attempt] = []
        self.accepted_html: Optional[str] = None
        self.accepted_title: str = ""
        self.accepted_summary: str = ""
        self.accepted_brief: str = ""
        self.screenshot: Optional[bytes] = None
        self.current_html: str = spec.current_html
        self.nonce = "validate"


def _format_result_for_llm(result: ValidationResult, attempts_left: int) -> str:
    lines: list[str] = []
    if result.ok and result.contract_ok:
        return "OK — the game loads, runs without errors, and asks a question in time. Great job; reply with one friendly sentence."
    if result.errors:
        lines.append(f"{len(result.errors)} runtime problem(s):")
        for err in result.errors[:12]:
            where = f" (line {err.get('line')})" if err.get("line") else ""
            phase = f" [{err.get('phase')}]" if err.get("phase") else ""
            hint = f" → {err.get('hint')}" if err.get("hint") else ""
            lines.append(f"- {err.get('category', 'error')}{phase}: {err.get('message', '')[:300]}{where}{hint}")
    if not result.contract_ok:
        lines.append(f"LEARNING CONTRACT NOT MET: {result.contract_reason}")
        lines.append("Remember: call `await YuviLearn.next()` within ~15 s of pressing Start and show the question overlay.")
    if getattr(result, "canvas_blank", False):
        lines.append("The screen stayed blank after Start — nothing rendered. Check the game loop and canvas sizing.")
    lines.append(f"Fix these and call the tool again with the FULL corrected HTML. Attempts left: {attempts_left}.")
    return "\n".join(lines)


async def _validate_candidate(state: _State, html: str) -> ValidationResult:
    spec = state.spec
    fixed = validate_and_fix_code(html)
    harness = build_harness(spec.pack.to_learn_data(), answer_key=spec.answer_key.correct, nonce=state.nonce)
    injected = inject_harness(fixed, harness)
    result = await validate_html(injected, contract_timeout_s=20)
    return result


async def _submit(state: _State, progress: ProgressFn, html: str, title: str, summary: str,
                  tool_name: str, brief: str = "") -> ToolResult:
    """Validate one candidate game and record the attempt. Shared by the
    tool handlers (edits) and the text-delivery loop (creates)."""
    started = time.perf_counter()
    idx = len(state.attempts) + 1
    if idx > MAX_SUBMISSIONS:
        return ToolResult(text_result_for_llm="No submissions left. Stop.", result_type="failure", error="max_submissions")
    progress({"type": "validate", "attempt": idx, "tool": tool_name})
    try:
        result = await _validate_candidate(state, html)
    except Exception as exc:  # validator crash must not kill the job silently
        log.exception("validator crashed")
        state.attempts.append(Attempt(idx, tool_name, False, [{"message": str(exc)}], False, "validator_error", time.perf_counter() - started))
        return ToolResult(text_result_for_llm=f"The validator could not run the game: {exc}. Check the HTML is complete and try again.", result_type="failure", error="validator_error")
    ok = bool(result.ok and result.contract_ok)
    state.attempts.append(Attempt(idx, tool_name, ok, list(result.errors), bool(result.contract_ok), str(result.contract_reason or ""), time.perf_counter() - started))
    progress({"type": "validated", "attempt": idx, "ok": ok, "errors": len(result.errors), "contract_ok": result.contract_ok})
    if ok:
        state.accepted_html = validate_and_fix_code(html)
        state.accepted_title = title.strip()[:60]
        state.accepted_summary = summary.strip()[:300]
        if brief.strip():
            state.accepted_brief = brief.strip()[:600]
        state.screenshot = result.screenshot_png
        return ToolResult(text_result_for_llm=_format_result_for_llm(result, 0), result_type="success")
    return ToolResult(
        text_result_for_llm=_format_result_for_llm(result, MAX_SUBMISSIONS - idx),
        result_type="failure",
        error="validation_failed",
    )


_META_LINE = re.compile(r"^\s*(TITLE|BRIEF|SUMMARY)\s*:\s*(.+?)\s*$", re.I | re.M)


def parse_text_delivery(text: str) -> dict[str, str]:
    """The create reply: `TITLE:` / `BRIEF:` / `SUMMARY:` lines (before the
    fence, in the kid's language) and one ```html block. Only the prose before
    the first fence is scanned for the lines, so code never leaks into them."""
    head = text.split("```", 1)[0]
    meta = {key.lower(): value for key, value in _META_LINE.findall(head)}
    html = extract_html(text) or ""
    return {"title": meta.get("title", ""), "brief": meta.get("brief", ""),
            "summary": meta.get("summary", ""), "html": html}


_SUMMARY_LINE = re.compile(r"^\s*SUMMARY:\s*(.+?)\s*$", re.MULTILINE)


def parse_edit_delivery(text: str, current_html: str) -> dict[str, Any]:
    """An edit reply: `SUMMARY:` plus line patches, SEARCH/REPLACE hunks, or
    a full ```html block — tried in that order, like vibe-coding-kids.
    Returns ``{html, summary, mode, error, ops}``; ``html`` is None when
    nothing usable arrived (``error`` says why, ``mode`` what was tried)."""
    head = text.split("```", 1)[0]
    m = _SUMMARY_LINE.search(head)
    summary = m.group(1) if m else ""
    ops = extract_line_patches(text or "")
    if ops:
        patched, err = apply_line_patches(current_html, ops)
        if not err:
            return {"html": patched, "summary": summary, "mode": "patch", "error": None, "ops": ops}
        html = extract_html(text) or ""
        if html and "<script" in html.lower():
            return {"html": html, "summary": summary, "mode": "rewrite", "error": None, "ops": []}
        return {"html": None, "summary": summary, "mode": "patch", "error": err, "ops": ops}
    hunks = extract_search_replace_patches(text or "")
    if hunks:
        patched, err = apply_search_replace_patches(current_html, hunks)
        if not err:
            return {"html": patched, "summary": summary, "mode": "search", "error": None, "ops": []}
        return {"html": None, "summary": summary, "mode": "search", "error": err, "ops": []}
    html = extract_html(text) or ""
    if html and "<script" in html.lower():
        return {"html": html, "summary": summary, "mode": "rewrite", "error": None, "ops": []}
    return {"html": None, "summary": summary, "mode": "none", "error": "no patches and no ```html block in the reply", "ops": []}


async def _run_text_edit(session: Any, state: _State, progress: ProgressFn, prompt: str,
                         totals: UsageTotals, spec: "JobSpec", operation: str) -> Optional[str]:
    """Edits and fixes: patches (or a full game) as reply text, so the change
    streams to the kid and the SDK can continue a cut-off block. A patch
    that does not apply is answered with one request for the full game; a
    patch that applies but fails validation is answered with the findings
    and the renumbered file, up to MAX_SUBMISSIONS."""
    next_prompt = prompt
    asked_full = False
    for _ in range(MAX_SUBMISSIONS):
        timer = _timer()
        turn = await session.send(next_prompt)
        totals.add(operation, turn.usage, estimate_cost_usd(turn.usage, getattr(session, "model_billing", None)))
        await _ledger(spec, operation, timer, spec.model, turn.usage, turn.error)
        if turn.error:
            return str(turn.error)
        parsed = parse_edit_delivery(turn.text or "", state.current_html)
        if parsed["html"] is None:
            state.attempts.append(Attempt(len(state.attempts) + 1, "text-edit", False,
                                          [{"message": parsed["error"] or "no delivery"}], False, parsed["mode"], 0.0))
            progress({"type": "patch", "status": "rejected", "mode": parsed["mode"], "error": parsed["error"]})
            if asked_full:
                break
            asked_full = True
            next_prompt = (f"Your patches could not be applied ({parsed['error']}). Reply with `SUMMARY: …` and then the "
                           "COMPLETE updated game in ONE ```html block, <!DOCTYPE html> to </html>, with the change "
                           "the kid asked for. No patches this time.")
            continue
        progress({"type": "patch", "status": "applied", "mode": parsed["mode"], "ops": len(parsed["ops"])})
        outcome = await _submit(state, progress, parsed["html"], state.accepted_title or "", parsed["summary"], "text-edit")
        if outcome.result_type == "success":
            return None
        if outcome.error == "max_submissions":
            break
        # The next patch must target the file as it is now.
        state.current_html = parsed["html"]
        numbered = number_lines(parsed["html"])
        findings = outcome.text_result_for_llm.replace(
            "call the tool again with the FULL corrected HTML",
            "reply with `SUMMARY: …` and then PATCHES against the numbering below, or the FULL corrected game in ONE ```html block",
        )
        next_prompt = f"{findings}\n\nCURRENT GAME (line-numbered, after your change):\n{numbered}"
    return None


async def _run_text_delivery(session: Any, state: _State, progress: ProgressFn, prompt: str,
                             totals: UsageTotals, spec: "JobSpec", operation: str) -> Optional[str]:
    """Creates: the game is a ```html block in the reply. It streams to the
    kid as text (tool-call input does not), and the SDK can auto-continue a
    block cut by the output cap, which it cannot do for a tool call. Each
    failed validation is answered in the same session with the findings and
    a request for the full corrected block, up to MAX_SUBMISSIONS."""
    next_prompt = prompt
    for _ in range(MAX_SUBMISSIONS):
        timer = _timer()
        turn = await session.send(next_prompt)
        totals.add(operation, turn.usage, estimate_cost_usd(turn.usage, getattr(session, "model_billing", None)))
        await _ledger(spec, operation, timer, spec.model, turn.usage, turn.error)
        if turn.error:
            return str(turn.error)
        parsed = parse_text_delivery(turn.text or "")
        html = parsed["html"]
        if not html or "<script" not in html.lower():
            state.attempts.append(Attempt(len(state.attempts) + 1, "text", False, [{"message": "incomplete html"}], False, "incomplete", 0.0))
            if turn.usage.output_tokens >= OUTPUT_CAP_HINT_TOKENS:
                # The budget went on reasoning and the block never closed: ask
                # for a smaller game rather than the same one again.
                progress({"type": "build", "status": "shrink", "output_tokens": turn.usage.output_tokens})
                next_prompt = prompts.SHRINK_PROMPT
            else:
                next_prompt = ("I did not receive a complete game. Reply with the TITLE/BRIEF/SUMMARY lines and then the "
                               "COMPLETE game in ONE ```html block, <!DOCTYPE html> to </html>.")
            continue
        outcome = await _submit(state, progress, html, parsed["title"], parsed["summary"], "text", parsed["brief"])
        if outcome.result_type == "success":
            return None
        if outcome.error == "max_submissions":
            break
        next_prompt = outcome.text_result_for_llm.replace(
            "call the tool again with the FULL corrected HTML",
            "reply with the FULL corrected game in ONE ```html block (TITLE/BRIEF/SUMMARY lines first)",
        )
    return None


def _make_tools(state: _State, progress: ProgressFn) -> list[Any]:
    async def _handle(html: str, title: str, summary: str, tool_name: str, brief: str = "") -> ToolResult:
        return await _submit(state, progress, html, title, summary, tool_name, brief)

    async def submit_game(params: SubmitParams, _inv: ToolInvocation) -> ToolResult:
        html = params.html or ""
        if "</html>" not in html.lower() or "<script" not in html.lower():
            state.attempts.append(Attempt(len(state.attempts) + 1, "submit_game", False, [{"message": "incomplete html"}], False, "incomplete", 0.0))
            return ToolResult(text_result_for_llm="The HTML is incomplete (needs <!DOCTYPE html> … <script> … </html>). Send the FULL file.", result_type="failure", error="incomplete_html")
        return await _handle(html, params.title, params.learning_summary, "submit_game", params.design_brief)

    async def patch_game(params: PatchParams, _inv: ToolInvocation) -> ToolResult:
        if not state.current_html:
            return ToolResult(text_result_for_llm="There is no current game to patch; use submit_game.", result_type="failure", error="no_current")
        outcome = apply_patches(state.current_html, params.patches or "")
        if outcome.html is None:
            state.attempts.append(Attempt(len(state.attempts) + 1, "patch_game", False, [{"message": outcome.error or "patch failed"}], False, "patch_failed", 0.0))
            return ToolResult(text_result_for_llm=f"Patch rejected: {outcome.error}. Line numbers refer to the ORIGINAL file. Try again or use submit_game for a rewrite.", result_type="failure", error="patch_failed")
        res = await _handle(outcome.html, state.accepted_title or "", params.summary, "patch_game")
        return res

    submit_tool = define_tool(
        "submit_game",
        description="Deliver the complete game HTML. Runs it headlessly and checks the learning contract; returns errors to fix or OK.",
        handler=submit_game,
        params_type=SubmitParams,
        skip_permission=True,
        is_terminal=True,
        defer="never",
    )
    patch_tool = define_tool(
        "patch_game",
        description="Apply a line-numbered patch (REPLACE_LINES/INSERT_AFTER/DELETE_LINES) to the current game and validate it.",
        handler=patch_game,
        params_type=PatchParams,
        skip_permission=True,
        is_terminal=True,
        defer="never",
    )
    return [submit_tool, patch_tool] if state.current_html else [submit_tool]


def _errors_block(errors: list[dict[str, Any]]) -> str:
    out = []
    for err in errors[:10]:
        out.append(f"- {err.get('message', '')[:300]}" + (f" (line {err.get('line')})" if err.get("line") else ""))
    return "\n".join(out)


async def _run_judge(spec: JobSpec, html: str, totals: UsageTotals, progress: ProgressFn) -> Optional[dict[str, Any]]:
    session = HeadlessCopilotSession(
        model=spec.run_judge_model,
        reasoning_effort=None,
        system_message=prompts.JUDGE_SYSTEM,
        session_id=f"{spec.job_id}-judge",
        system_mode="replace",
        timeout_s=180,
    )
    try:
        await session.start()
        progress({"type": "judge", "status": "start"})
        timer = _timer()
        turn = await session.send(prompts.judge_prompt(spec.pack, html))
        totals.add("game.judge", turn.usage, estimate_cost_usd(turn.usage, getattr(session, "model_billing", None)))
        await _ledger(spec, "game.judge", timer, spec.run_judge_model, turn.usage, turn.error)
        m = re.search(r"\{.*\}", turn.text or "", re.DOTALL)
        if not m:
            return {"error": "no_json", "raw": (turn.text or "")[:300]}
        try:
            verdict = json.loads(m.group(0))
        except json.JSONDecodeError:
            return {"error": "bad_json", "raw": m.group(0)[:300]}
        progress({"type": "judge", "status": "done", "verdict": verdict})
        return verdict
    except Exception as exc:
        log.warning("judge failed: %s", exc)
        return {"error": str(exc)[:200]}
    finally:
        await session.close()


async def run_job(spec: JobSpec, progress: Optional[ProgressFn] = None) -> JobResult:
    progress = progress or (lambda _e: None)
    started = time.perf_counter()
    state = _State(spec)
    totals = UsageTotals()
    language = spec.pack.language

    if spec.kind == "create":
        system = prompts.builder_system_message(language, delivery="text")
        prompt = prompts.create_prompt(spec.pack, genre=spec.genre, vibe=spec.vibe, clarifications=spec.clarifications,
                                       inspirations=spec.inspirations, learner_title=spec.learner_title)
    else:
        system = prompts.editor_system_message(language, delivery="text")
        full_rewrite = len(spec.current_html.splitlines()) > FULL_REWRITE_LINE_THRESHOLD
        numbered = spec.current_html if full_rewrite else number_lines(spec.current_html)
        prompt = prompts.edit_prompt(
            spec.instruction or "fix the errors",
            numbered,
            errors_block=_errors_block(spec.runtime_errors) if spec.runtime_errors else "",
            history=spec.history,
            language=language,
            delivery="text",
            full_rewrite=full_rewrite,
        )

    # Everything is delivered as reply text (see _run_text_delivery /
    # _run_text_edit): tool-call input neither streams nor continues.
    text_delivery = True
    tools: list[Any] = []
    session = HeadlessCopilotSession(
        model=spec.model,
        reasoning_effort=spec.reasoning_effort,
        system_message=system,
        session_id=spec.job_id,
        on_progress=progress,
        tools=tools,
        max_ai_credits=spec.max_ai_credits,
        timeout_s=1800,
    )
    error: Optional[str] = None
    try:
        await session.start()
        progress({"type": "build", "status": "start", "model": spec.model})
        operation = {"create": "game.build", "edit": "game.patch", "fix": "game.fix"}.get(spec.kind, "game.build")
        if spec.kind == "create":
            error = await _run_text_delivery(session, state, progress, prompt, totals, spec, operation)
            turn = None
        elif text_delivery:
            error = await _run_text_edit(session, state, progress, prompt, totals, spec, operation)
            turn = None
        else:
            timer = _timer()
            turn = await session.send(prompt)
            totals.add(operation, turn.usage, estimate_cost_usd(turn.usage, getattr(session, "model_billing", None)))
            await _ledger(spec, operation, timer, spec.model, turn.usage, turn.error)
        if turn is None:
            pass
        elif turn.error:
            error = turn.error
        elif not state.attempts and turn.usage.output_tokens >= OUTPUT_CAP_HINT_TOKENS:
            # No tool call landed and the turn burned the output budget: the
            # game was too long to fit one call. One more try, smaller.
            progress({"type": "build", "status": "shrink", "output_tokens": turn.usage.output_tokens})
            log.warning("no submission after %d output tokens — asking for a smaller game", turn.usage.output_tokens)
            timer = _timer()
            turn = await session.send(prompts.SHRINK_PROMPT)
            totals.add(operation, turn.usage, estimate_cost_usd(turn.usage, getattr(session, "model_billing", None)))
            await _ledger(spec, operation, timer, spec.model, turn.usage, turn.error)
            if turn.error:
                error = turn.error
    except Exception as exc:
        log.exception("build session failed")
        error = f"session_error: {exc}"[:300]
    finally:
        await session.close()

    judge: Optional[dict[str, Any]] = None
    if state.accepted_html and spec.judge:
        judge = await _run_judge(spec, state.accepted_html, totals, progress)
        score = judge.get("learning_integral") if isinstance(judge, dict) else None
        if isinstance(score, (int, float)) and score < JUDGE_MIN_SCORE:
            error = f"judge_rejected: learning_integral={score}"

    ok = state.accepted_html is not None and error is None
    if not ok and error is None:
        error = "no_valid_submission"
    return JobResult(
        ok=ok,
        html=state.accepted_html,
        title=state.accepted_title,
        summary=state.accepted_summary,
        design_brief=state.accepted_brief,
        attempts=state.attempts,
        usage=totals,
        judge=judge,
        screenshot_png=state.screenshot,
        elapsed_s=time.perf_counter() - started,
        error=error,
        model=spec.model,
    )
