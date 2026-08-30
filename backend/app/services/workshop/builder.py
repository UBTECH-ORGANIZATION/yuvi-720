"""The build loop behind Yuvi Workshop.

A child does not arrive with a specification. They arrive with "אני רוצה משחק
חלל", and the job of this module is to turn that into something they can play in
under a minute — while making the learning visible.

One turn is therefore up to four moves:

1. understand  — if the request is too thin, ask ONE question with tappable
                 options instead of building the wrong thing. Never asks HOW
                 (that is a technical question a child cannot answer), only WHAT.
2. plan        — 2 to 5 steps phrased as what the CHILD achieved, no jargon.
3. build       — a single self-contained HTML document, streamed so the code is
                 visibly written rather than appearing all at once.
4. cards       — one thing they learned, and one challenge to improve it.

Model access is a seam. Today every move goes through the house APIM gateway via
`call_llm`/`call_llm_stream`, which is what makes the tokens meterable. When the
GitHub Copilot SDK worker is configured it takes over move 3 only — the agentic
loop is better at long code, and nothing else about the experience changes.
"""

from __future__ import annotations

import json
import os
import re
from typing import Any, AsyncIterator, Optional

from app.core.localization import normalize_language
from app.services.ai_usage import UsageContext
from app.services.llm import call_llm, call_llm_stream

FEATURE = "feature_1_creation_workshop"
MAX_TURN_MESSAGES = 12

_LANGUAGE_NAMES = {"he": "Hebrew", "ar": "Arabic", "en": "English"}
_DIRECTIONS = {"he": "rtl", "ar": "rtl", "en": "ltr"}

_HTML_FENCE = re.compile(r"```(?:html)?\s*(.*?)```", re.DOTALL | re.IGNORECASE)


def _language_rule(language: str) -> str:
    name = _LANGUAGE_NAMES.get(language, "Hebrew")
    return (
        f"Every word the child reads — in your replies AND inside the page you build — "
        f"must be in {name}. The document must set dir=\"{_DIRECTIONS.get(language, 'rtl')}\"."
    )


UNDERSTAND_SYSTEM = """You are Yuvi, helping a child aged 10-15 build something on the web.

Decide ONE thing: do you know enough to start building?

Ask a question ONLY when the answer would change what you build. If the child said
"a space game", you already know enough — invent the rest and build it. Boredom is a
worse failure than a wrong guess, and the child can always ask you to change it.

Never ask about technology, libraries, frameworks, colours-as-hex, or file layout.
A child cannot answer those and being asked makes them feel stupid. Ask only about
the IDEA: what happens in it, who is in it, how you win.

Ask at most one question, and always offer 3-4 tappable options plus the freedom to
type their own.

Reply with JSON only:
{"ready": true|false,
 "question": "one short question, empty when ready",
 "options": ["short option", "short option", "short option"],
 "title": "2-4 word name for the project",
 "kind": "game"|"site"|"lomda"}"""


PLAN_SYSTEM = """You are Yuvi, about to build something for a child aged 10-15.

Write the plan the child will watch you work through. 2 to 5 steps.

Each step has a short title and one sentence describing what the CHILD will have
once it is done — written as their achievement, not yours.

Absolutely no technical vocabulary: no canvas, DOM, CSS, function, variable, array,
event, div, framework, or library. If a step cannot be said without one of those
words, it is the wrong step.

Reply with JSON only:
{"steps": [{"title": "...", "achieved": "..."}]}"""


BUILD_SYSTEM = """You build single-file web projects for children aged 10-15.

Output ONE complete HTML5 document and nothing else. Start at <!DOCTYPE html>, end
at </html>. No prose, no explanation, no markdown fences.

Hard rules — a document that breaks any of these is rejected and the child sees
nothing:
- Everything inline: CSS in <style>, JavaScript in <script>. No external files.
- No fetch, XMLHttpRequest, WebSocket, or sendBeacon. The page has no network.
- No localStorage, sessionStorage, cookies, or indexedDB. They throw here; keep
  state in ordinary variables.
- No iframe, no form that posts anywhere, no external links.
- No images or fonts from the internet. Draw with CSS, SVG, emoji, or canvas.

Craft rules:
- It must WORK the first time. A child who sees a blank page stops.
- It must be playable within five seconds of loading: no menus to read first.
- Immediate visible feedback for every action.
- Readable code with short, meaningful names — the child will look at it.
- Keep it under about 400 lines. One good idea beats five broken ones."""


CARDS_SYSTEM = """You are Yuvi, talking to a child who just finished building something.

Give exactly two short things, warm and specific to what they built:
- "know": one real idea their project demonstrates, in one or two sentences a
  10-year-old understands. Tie it to their project, not to programming in general.
- "challenge": one concrete improvement they could ask you for next. One sentence,
  phrased as an invitation.

Never mention scores, levels, percentages, or how well they did.

Reply with JSON only: {"know": "...", "challenge": "..."}"""


def _usage(learner_id: str, operation: str, session_id: Optional[str] = None) -> UsageContext:
    return UsageContext(
        actor_id=learner_id,
        actor_type="learner",
        endpoint="/api/workshop/projects/{id}/build",
        feature=FEATURE,
        operation=operation,
        source="workshop_builder",
        session_id=session_id,
    )


def _parse_json(raw: str) -> dict[str, Any]:
    text = (raw or "").strip()
    fenced = re.search(r"```(?:json)?\s*(.*?)```", text, re.DOTALL)
    if fenced:
        text = fenced.group(1).strip()
    try:
        value = json.loads(text)
    except (json.JSONDecodeError, TypeError):
        return {}
    return value if isinstance(value, dict) else {}


def extract_document(raw: str) -> str:
    """Pull the HTML document out of a model reply that may still be fenced."""
    text = (raw or "").strip()
    fenced = _HTML_FENCE.search(text)
    if fenced:
        text = fenced.group(1).strip()
    start = text.lower().find("<!doctype html")
    if start == -1:
        start = text.lower().find("<html")
    if start > 0:
        text = text[start:]
    end = text.lower().rfind("</html>")
    if end != -1:
        text = text[: end + len("</html>")]
    return text.strip()


def _history_messages(history: list[dict[str, Any]]) -> list[dict[str, str]]:
    """The last few turns, as plain chat messages."""
    messages: list[dict[str, str]] = []
    for entry in history[-MAX_TURN_MESSAGES:]:
        role = "assistant" if entry.get("role") == "assistant" else "user"
        content = (entry.get("content") or "").strip()
        if content:
            messages.append({"role": role, "content": content[:1200]})
    return messages


async def understand(
    learner_id: str,
    *,
    message: str,
    language: str,
    history: list[dict[str, Any]],
    has_existing_version: bool,
) -> dict[str, Any]:
    """Decide whether to ask one clarifying question or start building."""
    # An edit to something that already exists is never ambiguous enough to
    # interrogate — the child is looking at the thing they want changed.
    if has_existing_version:
        return {"ready": True, "question": "", "options": [], "title": "", "kind": "game"}

    reply = await call_llm(
        [
            {"role": "system", "content": f"{UNDERSTAND_SYSTEM}\n\n{_language_rule(language)}"},
            *_history_messages(history),
            {"role": "user", "content": message},
        ],
        usage_context=_usage(learner_id, "workshop.understand"),
        max_tokens=400,
        json_mode=True,
    )
    parsed = _parse_json(reply)
    options = [str(item)[:60] for item in (parsed.get("options") or [])][:4]
    ready = bool(parsed.get("ready")) or not str(parsed.get("question") or "").strip()
    return {
        "ready": ready,
        "question": str(parsed.get("question") or "")[:200],
        "options": options,
        "title": str(parsed.get("title") or "")[:60],
        "kind": parsed.get("kind") if parsed.get("kind") in ("game", "site", "lomda") else "game",
    }


async def plan(
    learner_id: str,
    *,
    message: str,
    language: str,
    objective_title: Optional[str],
) -> list[dict[str, str]]:
    """The steps the child watches Yuvi work through."""
    context = message
    if objective_title:
        context = f"{message}\n\nThe child is learning: {objective_title}. Weave it in."

    reply = await call_llm(
        [
            {"role": "system", "content": f"{PLAN_SYSTEM}\n\n{_language_rule(language)}"},
            {"role": "user", "content": context},
        ],
        usage_context=_usage(learner_id, "workshop.plan"),
        max_tokens=600,
        json_mode=True,
    )
    steps = []
    for step in (_parse_json(reply).get("steps") or [])[:5]:
        if not isinstance(step, dict):
            continue
        title = str(step.get("title") or "").strip()[:80]
        if title:
            steps.append({"title": title, "achieved": str(step.get("achieved") or "").strip()[:200]})
    return steps


async def cards(
    learner_id: str,
    *,
    message: str,
    language: str,
    objective_title: Optional[str],
) -> dict[str, str]:
    """One thing learned and one invitation to go further."""
    context = message
    if objective_title:
        context = f"{message}\n\nThey are learning: {objective_title}."

    try:
        reply = await call_llm(
            [
                {"role": "system", "content": f"{CARDS_SYSTEM}\n\n{_language_rule(language)}"},
                {"role": "user", "content": context},
            ],
            usage_context=_usage(learner_id, "workshop.cards"),
            max_tokens=350,
            json_mode=True,
        )
    except Exception:
        return {}
    parsed = _parse_json(reply)
    return {
        "know": str(parsed.get("know") or "").strip()[:300],
        "challenge": str(parsed.get("challenge") or "").strip()[:200],
    }


def worker_url() -> str:
    return (os.environ.get("WORKSHOP_WORKER_URL") or "").strip().rstrip("/")


async def build(
    learner_id: str,
    *,
    message: str,
    language: str,
    history: list[dict[str, Any]],
    previous_html: Optional[str],
    objective_title: Optional[str],
    plan_steps: list[dict[str, str]],
) -> AsyncIterator[str]:
    """Stream the artifact source as it is written."""
    language = normalize_language(language)
    instructions = [f"{BUILD_SYSTEM}\n\n{_language_rule(language)}"]
    if plan_steps:
        outline = "\n".join(f"- {step['title']}" for step in plan_steps)
        instructions.append(f"The plan the child was shown:\n{outline}")
    if objective_title:
        instructions.append(
            f"The child is learning: {objective_title}. The project should make that "
            f"idea something they DO, not something they read."
        )

    user_parts = [message]
    if previous_html:
        # Editing beats regenerating: a child who asks for a green ship expects
        # everything else to survive.
        user_parts.append(
            "This is the current version. Change only what was asked, keep the rest:\n\n"
            + previous_html[:60000]
        )

    async for chunk in call_llm_stream(
        [
            {"role": "system", "content": "\n\n".join(instructions)},
            *_history_messages(history),
            {"role": "user", "content": "\n\n".join(user_parts)},
        ],
        usage_context=_usage(learner_id, "workshop.build"),
        max_tokens=8000,
        model_tier="strong",
    ):
        yield chunk
