"""The generation pipeline: one job in, one validated game (or a failure) out.

Create:  plan pass (mini model → a one-page pitch, streamed to the kid)
         → build session (the model's own design, text delivery: TITLE /
         BRIEF / SUMMARY lines + one ```html block) → post-process →
         harness-inject → headless validate (errors, liveness, canvas, play
         score) → findings go back to the model (≤ MAX_SUBMISSIONS)
         → judge v2 (mini model, four 0-5 scores + a top fix) → when weak,
         ONE revision turn in the same session (patches), re-judged
         → JobResult with timings.
Edit/Fix: same session shape with line patches (or a full game) as reply
         text; judged for the record only.

Everything is delivered as reply text so it streams to the kid and the SDK
can continue a block cut by the output cap. The judge never fails a job.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Optional

from . import prompts
from .code_utils import validate_and_fix_code
from .context_pack import ContextPack
from .copilot_session import HeadlessCopilotSession
from .harness import build_harness, inject_harness
from .patch_engine import (
    FULL_REWRITE_LINE_THRESHOLD, apply_line_patches, apply_search_replace_patches,
    extract_line_patches, extract_search_replace_patches, number_lines,
)
from .html_utils import extract_html
from .usage import UsageTotals, estimate_cost_usd, record_to_ledger
from .validator import ValidationResult, categorize_error, validate_html


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
#: A turn that produced this much output and no game hit the model's
#: per-turn output cap (32k on claude-opus-5 via Copilot) — the game did not fit.
OUTPUT_CAP_HINT_TOKENS = 30_000
DEFAULT_MODEL = "claude-sonnet-5"  # bake-off 2026-09-10: 48 games, see docs/design/learning-game-lab.md
JUDGE_MODEL = os.environ.get("JUDGE_MODEL") or "gpt-5.4-mini"
PLAN_MODEL = os.environ.get("PLAN_MODEL") or "gpt-5.4-mini"
PLAN_TIMEOUT_S = 45.0  # the pitch took 18-19 s at 20 s; a timeout means no pitch for the kid, so give it room
#: A create is revised once when learning_through_play < 3 or fun + polish < 5.
JUDGE_REVISE_IF = {"learning_through_play_below": 3, "fun_plus_polish_below": 5}
JUDGE_SCORE_KEYS = ("learning_through_play", "fun", "polish", "age_fit")
ProgressFn = Callable[[dict[str, Any]], None]


@dataclass
class JobSpec:
    job_id: str
    game_id: str
    learner_id: str
    kind: str  # create | edit | fix
    pack: ContextPack
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
    reasoning_effort: str = "low"
    max_ai_credits: Optional[float] = None
    judge: bool = True
    run_judge_model: str = JUDGE_MODEL
    plan: bool = True                # create only: the mini pitch pre-pass
    plan_model: str = PLAN_MODEL
    design_doc: str = ""             # a pitch given by the caller skips the plan pass
    # Yuvi UsageContext (or None when running standalone); one ledger row per turn.
    usage_context: Optional[Any] = None


@dataclass
class Attempt:
    index: int
    tool: str
    ok: bool
    errors: list[dict[str, Any]]
    reason: str
    elapsed_s: float                 # validate_s
    model_s: float = 0.0
    output_tokens: int = 0
    html_lines: int = 0
    error_classes: list[str] = field(default_factory=list)
    play_score: Optional[dict[str, Any]] = None
    phases: Optional[dict[str, float]] = None   # validator seconds per phase

    def as_detail(self) -> dict[str, Any]:
        """The `attempts_detail` row the worker writes on the job."""
        return {
            "n": self.index, "ok": self.ok, "reason": self.reason,
            "validate_s": round(self.elapsed_s, 3), "model_s": round(self.model_s, 3),
            "output_tokens": self.output_tokens, "html_lines": self.html_lines,
            "error_classes": list(self.error_classes), "play_score": self.play_score, "phases": self.phases,
        }


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
    timings: dict[str, Any] = field(default_factory=dict)


def _new_timings() -> dict[str, Any]:
    return {"session_start_s": 0.0, "plan_s": 0.0, "model_s": [], "validate_s": [],
            "judge_s": 0.0, "revise_s": 0.0, "rejudge_s": 0.0, "total_s": 0.0}


class _State:
    """Mutable per-job state shared between the delivery loops and the runner."""

    def __init__(self, spec: JobSpec) -> None:
        self.spec = spec
        self.attempts: list[Attempt] = []
        self.attempt_cap = MAX_SUBMISSIONS
        self.accepted_html: Optional[str] = None
        self.accepted_title: str = ""
        self.accepted_summary: str = ""
        self.accepted_brief: str = ""
        self.accepted_facts: dict[str, Any] = {}
        self.screenshot: Optional[bytes] = None
        self.current_html: str = spec.current_html
        self.nonce = "validate"
        self.timings = _new_timings()
        self.last_model_s = 0.0
        self.last_output_tokens = 0
        # The judge reads the same HTML the validator runs, so it starts the
        # moment a candidate arrives and runs alongside Playwright instead of
        # after it: ~15 s less "checking" for the kid. A failed validation
        # cancels it; the next candidate starts a fresh one.
        self.totals: Optional[UsageTotals] = None
        self.judge_task: Optional["asyncio.Task[Optional[dict[str, Any]]]"] = None

    def note_turn(self, turn: Any) -> None:
        self.last_model_s = float(getattr(turn, "elapsed_s", 0.0) or 0.0)
        self.last_output_tokens = int(getattr(getattr(turn, "usage", None), "output_tokens", 0) or 0)
        self.timings["model_s"].append(round(self.last_model_s, 3))


def _format_result_for_llm(result: ValidationResult, attempts_left: int) -> str:
    lines: list[str] = []
    if result.ok:
        return "OK — the game loads and runs without errors. Great job; reply with one friendly sentence."
    if result.errors:
        lines.append(f"{len(result.errors)} runtime problem(s):")
        for err in result.errors[:12]:
            where = f" (line {err.get('line')})" if err.get("line") else ""
            phase = f" [{err.get('phase')}]" if err.get("phase") else ""
            hint = f" → {err.get('hint')}" if err.get("hint") else ""
            lines.append(f"- {err.get('category', 'error')}{phase}: {err.get('message', '')[:300]}{where}{hint}")
    if getattr(result, "canvas_blank", False):
        lines.append("The screen stayed blank after Start — nothing rendered. Check the game loop and canvas sizing.")
    lines.append(f"Fix these and call the tool again with the FULL corrected HTML. Attempts left: {attempts_left}.")
    return "\n".join(lines)


def _facts_from(result: ValidationResult, html: str) -> dict[str, Any]:
    return {
        "heartbeat": result.heartbeat, "canvas_blank": result.canvas_blank, "errors": len(result.errors),
        "clicked_start": result.clicked_start, "play_score": result.play_score,
        "html_lines": html.count("\n") + 1,
    }


def _cancel_judge(state: _State) -> None:
    task = state.judge_task
    state.judge_task = None
    if task is not None and not task.done():
        task.cancel()


async def _await_judge(state: _State, spec: JobSpec, totals: UsageTotals, progress: ProgressFn,
                       facts: dict[str, Any]) -> Optional[dict[str, Any]]:
    """The verdict for the accepted HTML: the task that ran alongside the
    validator when there is one, else a fresh judge."""
    task = state.judge_task
    state.judge_task = None
    if task is not None:
        try:
            return await task
        except asyncio.CancelledError:
            pass
        except Exception as exc:  # noqa: BLE001
            log.warning("concurrent judge failed: %s", exc)
    return await _run_judge(spec, state.accepted_html or "", totals, progress, facts)


async def _validate_candidate(state: _State, html: str) -> ValidationResult:
    fixed = validate_and_fix_code(html)
    harness = build_harness(state.spec.pack.to_learn_data(), nonce=state.nonce)
    return await validate_html(inject_harness(fixed, harness))


@dataclass
class _Outcome:
    """What one delivery came to: `ok`, the text for the model, and a short error code."""
    ok: bool
    text: str
    error: Optional[str] = None


async def _submit(state: _State, progress: ProgressFn, html: str, title: str, summary: str,
                  tool_name: str, brief: str = "") -> _Outcome:
    """Validate one candidate game and record the attempt."""
    started = time.perf_counter()
    idx = len(state.attempts) + 1
    if idx > state.attempt_cap:
        return _Outcome(False, "No submissions left. Stop.", "max_submissions")
    progress({"type": "validate", "attempt": idx, "tool": tool_name})
    html_lines = html.count("\n") + 1
    _cancel_judge(state)
    if state.spec.judge and state.totals is not None:
        state.judge_task = asyncio.create_task(_run_judge(
            state.spec, html, state.totals, progress, {"title": title, "brief": brief}))
    try:
        result = await _validate_candidate(state, html)
    except Exception as exc:  # validator crash must not kill the job silently
        log.exception("validator crashed")
        _cancel_judge(state)
        elapsed = time.perf_counter() - started
        state.timings["validate_s"].append(round(elapsed, 3))
        state.attempts.append(Attempt(idx, tool_name, False, [{"message": str(exc)}], "validator_error", elapsed,
                                      model_s=state.last_model_s, output_tokens=state.last_output_tokens,
                                      html_lines=html_lines, error_classes=["validator_error"]))
        return _Outcome(False, f"The validator could not run the game: {exc}. Check the HTML is complete and try again.",
                        "validator_error")
    elapsed = time.perf_counter() - started
    state.timings["validate_s"].append(round(elapsed, 3))
    ok = bool(result.ok)
    if not ok:
        _cancel_judge(state)
    classes = sorted({categorize_error(str(e.get("message") or ""))[0] for e in result.errors})
    if ok:
        reason = "ok"
    elif result.errors:
        reason = f"{len(result.errors)} error(s): " + str(result.errors[0].get("message") or "")[:160]
    else:
        reason = "validation_failed"
    state.attempts.append(Attempt(idx, tool_name, ok, list(result.errors), reason, elapsed,
                                  model_s=state.last_model_s, output_tokens=state.last_output_tokens,
                                  html_lines=html_lines, error_classes=classes, play_score=result.play_score,
                                  phases=result.phases))
    progress({"type": "validated", "attempt": idx, "ok": ok, "errors": len(result.errors), "play_score": result.play_score})
    if ok:
        state.accepted_html = validate_and_fix_code(html)
        if title.strip():
            state.accepted_title = title.strip()[:60]
        if summary.strip():
            state.accepted_summary = summary.strip()[:300]
        if brief.strip():
            state.accepted_brief = brief.strip()[:600]
        state.accepted_facts = _facts_from(result, state.accepted_html)
        state.screenshot = result.screenshot_png
        return _Outcome(True, _format_result_for_llm(result, 0))
    return _Outcome(False, _format_result_for_llm(result, state.attempt_cap - idx), "validation_failed")


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
                         totals: UsageTotals, spec: "JobSpec", operation: str,
                         max_deliveries: int = MAX_SUBMISSIONS) -> Optional[str]:
    """Edits and fixes: patches (or a full game) as reply text, so the change
    streams to the kid and the SDK can continue a cut-off block. A patch
    that does not apply is answered with one request for the full game; a
    patch that applies but fails validation is answered with the findings
    and the renumbered file, up to `max_deliveries`."""
    next_prompt = prompt
    asked_full = False
    for _ in range(max_deliveries):
        timer = _timer()
        turn = await session.send(next_prompt)
        totals.add(operation, turn.usage, estimate_cost_usd(turn.usage, getattr(session, "model_billing", None)))
        await _ledger(spec, operation, timer, spec.model, turn.usage, turn.error)
        state.note_turn(turn)
        if turn.error:
            return str(turn.error)
        parsed = parse_edit_delivery(turn.text or "", state.current_html)
        if parsed["html"] is None:
            state.attempts.append(Attempt(len(state.attempts) + 1, "text-edit", False,
                                          [{"message": parsed["error"] or "no delivery"}], parsed["mode"], 0.0,
                                          model_s=state.last_model_s, output_tokens=state.last_output_tokens,
                                          error_classes=["no_delivery"]))
            progress({"type": "patch", "status": "rejected", "mode": parsed["mode"], "error": parsed["error"]})
            if asked_full or max_deliveries <= 1:
                break
            asked_full = True
            next_prompt = (f"Your patches could not be applied ({parsed['error']}). Reply with `SUMMARY: …` and then the "
                           "COMPLETE updated game in ONE ```html block, <!DOCTYPE html> to </html>, with the change "
                           "the kid asked for. No patches this time.")
            continue
        progress({"type": "patch", "status": "applied", "mode": parsed["mode"], "ops": len(parsed["ops"])})
        outcome = await _submit(state, progress, parsed["html"], state.accepted_title or "", parsed["summary"], "text-edit")
        if outcome.ok:
            return None
        if outcome.error == "max_submissions":
            break
        # The next patch must target the file as it is now.
        state.current_html = parsed["html"]
        numbered = number_lines(parsed["html"])
        findings = outcome.text.replace(
            "call the tool again with the FULL corrected HTML",
            "reply with `SUMMARY: …` and then PATCHES against the numbering below, or the FULL corrected game in ONE ```html block",
        )
        next_prompt = f"{findings}\n\nCURRENT GAME (line-numbered, after your change):\n{numbered}"
    return None


async def _run_text_delivery(session: Any, state: _State, progress: ProgressFn, prompt: str,
                             totals: UsageTotals, spec: "JobSpec", operation: str) -> Optional[str]:
    """Creates: the game is a ```html block in the reply. It streams to the
    kid as text, and the SDK can auto-continue a block cut by the output cap.
    Each failed validation is answered in the same session with the findings
    and a request for the full corrected block, up to MAX_SUBMISSIONS."""
    next_prompt = prompt
    for _ in range(MAX_SUBMISSIONS):
        timer = _timer()
        turn = await session.send(next_prompt)
        totals.add(operation, turn.usage, estimate_cost_usd(turn.usage, getattr(session, "model_billing", None)))
        await _ledger(spec, operation, timer, spec.model, turn.usage, turn.error)
        state.note_turn(turn)
        if turn.error:
            return str(turn.error)
        parsed = parse_text_delivery(turn.text or "")
        html = parsed["html"]
        if not html or "<script" not in html.lower():
            state.attempts.append(Attempt(len(state.attempts) + 1, "text", False, [{"message": "incomplete html"}],
                                          "incomplete", 0.0, model_s=state.last_model_s,
                                          output_tokens=state.last_output_tokens, error_classes=["incomplete"]))
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
        if outcome.ok:
            return None
        if outcome.error == "max_submissions":
            break
        next_prompt = outcome.text.replace(
            "call the tool again with the FULL corrected HTML",
            "reply with the FULL corrected game in ONE ```html block (TITLE/BRIEF/SUMMARY lines first)",
        )
    return None


def _errors_block(errors: list[dict[str, Any]]) -> str:
    out = []
    for err in errors[:10]:
        out.append(f"- {err.get('message', '')[:300]}" + (f" (line {err.get('line')})" if err.get("line") else ""))
    return "\n".join(out)


# ── Plan pass ────────────────────────────────────────────────────────────────

async def _run_plan(spec: JobSpec, totals: UsageTotals, progress: ProgressFn) -> str:
    """A producer's pitch from the mini model. Empty string on any failure:
    the builder then designs from the brief alone."""
    session = HeadlessCopilotSession(
        model=spec.plan_model,
        reasoning_effort=None,
        system_message=prompts.PLAN_SYSTEM,
        session_id=f"{spec.job_id}-plan",
        system_mode="replace",
        timeout_s=PLAN_TIMEOUT_S,
    )
    try:
        await session.start()
        progress({"type": "plan", "status": "start", "model": spec.plan_model})
        timer = _timer()
        turn = await session.send(prompts.plan_prompt(spec.pack, spec.vibe, spec.inspirations))
        totals.add("game.plan", turn.usage, estimate_cost_usd(turn.usage, getattr(session, "model_billing", None)))
        await _ledger(spec, "game.plan", timer, spec.plan_model, turn.usage, turn.error)
        if turn.error:
            log.warning("plan pass failed: %s", turn.error)
            return ""
        text = (turn.text or "").strip()
        if text:
            progress({"type": "plan", "status": "done", "text": text})
        return text
    except Exception as exc:
        log.warning("plan pass failed: %s", exc)
        return ""
    finally:
        try:
            await session.close()
        except Exception:
            pass


# ── Judge v2 ─────────────────────────────────────────────────────────────────

async def _run_judge(spec: JobSpec, html: str, totals: UsageTotals, progress: ProgressFn,
                     facts: Optional[dict[str, Any]] = None) -> Optional[dict[str, Any]]:
    """The raw verdict JSON (or ``{"error": …}``)."""
    session = HeadlessCopilotSession(
        model=spec.run_judge_model,
        reasoning_effort=None,
        system_message=prompts.JUDGE_SYSTEM,
        session_id=f"{spec.job_id}-judge-{len(html) % 9973}",
        system_mode="replace",
        timeout_s=180,
    )
    try:
        await session.start()
        progress({"type": "judge", "status": "start"})
        timer = _timer()
        turn = await session.send(prompts.judge_prompt(spec.pack, html, facts or {}))
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
        try:
            await session.close()
        except Exception:
            pass


def _score(value: Any) -> Optional[float]:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def judge_record(verdict: Optional[dict[str, Any]], model: str) -> dict[str, Any]:
    """Normalise a raw verdict into the contract's `judge` shape."""
    verdict = verdict if isinstance(verdict, dict) else {}
    scores = {k: _score(verdict.get(k)) for k in JUDGE_SCORE_KEYS}
    record: dict[str, Any] = {
        "scores": {k: v for k, v in scores.items() if v is not None},
        "notes": str(verdict.get("notes") or "")[:600],
        "top_fix": str(verdict.get("top_fix") or "")[:600],
        "revised": False,
        "before": None,
        "model": model,
    }
    if verdict.get("error"):
        record["error"] = str(verdict["error"])[:200]
    return record


def needs_revision(scores: dict[str, Any]) -> bool:
    ltp = _score(scores.get("learning_through_play"))
    fun = _score(scores.get("fun"))
    polish = _score(scores.get("polish"))
    if ltp is not None and ltp < JUDGE_REVISE_IF["learning_through_play_below"]:
        return True
    if fun is not None and polish is not None and fun + polish < JUDGE_REVISE_IF["fun_plus_polish_below"]:
        return True
    return False


async def _run_revision(session: Any, state: _State, progress: ProgressFn, totals: UsageTotals,
                        spec: JobSpec, judge: dict[str, Any]) -> bool:
    """One revision turn against the accepted game. True when a validated
    revision replaced it; the original stands otherwise."""
    original = state.accepted_html or ""
    keep = (state.accepted_title, state.accepted_summary, state.accepted_brief)
    state.current_html = original
    state.attempt_cap = len(state.attempts) + 1
    progress({"type": "revise", "status": "start", "html": original, "top_fix": judge.get("top_fix", "")})
    prompt = prompts.revision_prompt(judge, number_lines(original))
    try:
        await _run_text_edit(session, state, progress, prompt, totals, spec, "game.revise", max_deliveries=1)
    except Exception as exc:
        log.warning("revision turn failed: %s", exc)
    revised = state.accepted_html is not None and state.accepted_html != original
    if not revised:
        state.accepted_html = original
    state.accepted_title, state.accepted_summary, state.accepted_brief = keep
    progress({"type": "revise", "status": "done", "revised": revised})
    return revised


async def run_job(spec: JobSpec, progress: Optional[ProgressFn] = None) -> JobResult:
    progress = progress or (lambda _e: None)
    started = time.perf_counter()
    state = _State(spec)
    timings = state.timings
    totals = UsageTotals()
    state.totals = totals
    language = spec.pack.language

    design_doc = spec.design_doc
    if spec.kind == "create" and spec.plan and not design_doc.strip():
        t0 = time.perf_counter()
        design_doc = await _run_plan(spec, totals, progress)
        timings["plan_s"] = round(time.perf_counter() - t0, 3)

    if spec.kind == "create":
        system = prompts.builder_system_message(language)
        prompt = prompts.create_prompt(spec.pack, vibe=spec.vibe, inspirations=spec.inspirations,
                                       learner_title=spec.learner_title, design_doc=design_doc,
                                       genre=spec.genre, clarifications=spec.clarifications)
    else:
        system = prompts.editor_system_message(language)
        full_rewrite = len(spec.current_html.splitlines()) > FULL_REWRITE_LINE_THRESHOLD
        numbered = spec.current_html if full_rewrite else number_lines(spec.current_html)
        prompt = prompts.edit_prompt(
            spec.instruction or "fix the errors",
            numbered,
            errors_block=_errors_block(spec.runtime_errors) if spec.runtime_errors else "",
            history=spec.history,
            language=language,
            full_rewrite=full_rewrite,
        )

    # Everything is delivered as reply text (see _run_text_delivery /
    # _run_text_edit): tool-call input neither streams nor continues.
    session = HeadlessCopilotSession(
        model=spec.model,
        reasoning_effort=spec.reasoning_effort,
        system_message=system,
        session_id=spec.job_id,
        on_progress=progress,
        tools=[],
        max_ai_credits=spec.max_ai_credits,
        timeout_s=1800,
    )
    error: Optional[str] = None
    judge: Optional[dict[str, Any]] = None
    try:
        t0 = time.perf_counter()
        await session.start()
        timings["session_start_s"] = round(time.perf_counter() - t0, 3)
        progress({"type": "build", "status": "start", "model": spec.model})
        operation = {"create": "game.build", "edit": "game.patch", "fix": "game.fix"}.get(spec.kind, "game.build")
        if spec.kind == "create":
            error = await _run_text_delivery(session, state, progress, prompt, totals, spec, operation)
        else:
            error = await _run_text_edit(session, state, progress, prompt, totals, spec, operation)

        # The judge runs inside the session so a weak verdict can be answered
        # with one revision turn that still has the game in context. It never
        # fails a job.
        if state.accepted_html and spec.judge and error is None:
            t0 = time.perf_counter()
            facts = {**state.accepted_facts, "title": state.accepted_title, "brief": state.accepted_brief}
            verdict = await _await_judge(state, spec, totals, progress, facts)
            timings["judge_s"] = round(time.perf_counter() - t0, 3)  # the wait left after validation
            judge = judge_record(verdict, spec.run_judge_model)
            if spec.kind == "create" and needs_revision(judge["scores"]):
                t0 = time.perf_counter()
                revised = await _run_revision(session, state, progress, totals, spec, judge)
                timings["revise_s"] = round(time.perf_counter() - t0, 3)
                if revised:
                    t0 = time.perf_counter()
                    facts = {**state.accepted_facts, "title": state.accepted_title, "brief": state.accepted_brief}
                    verdict2 = await _await_judge(state, spec, totals, progress, facts)
                    timings["rejudge_s"] = round(time.perf_counter() - t0, 3)
                    before = {k: judge[k] for k in ("scores", "notes", "top_fix")}
                    judge = {**judge_record(verdict2, spec.run_judge_model), "revised": True, "before": before}
    except Exception as exc:
        log.exception("build session failed")
        error = f"session_error: {exc}"[:300]
    finally:
        await session.close()

    ok = state.accepted_html is not None and error is None
    if not ok and error is None:
        error = "no_valid_submission"
    timings["total_s"] = round(time.perf_counter() - started, 3)
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
        timings=timings,
    )
