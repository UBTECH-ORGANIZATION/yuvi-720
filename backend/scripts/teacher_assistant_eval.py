"""Does the teaching assistant sound like a colleague? Ask it, then read it.

The grounding tests prove the assistant does not lie. Nothing proved it was
worth reading — and it was not: it used to answer "what can you tell me about
Tal?" with sixteen bullets, a UTC timestamp, a gendered slash on every verb, an
inventory of everything it had failed to fetch, and three raw English identifiers
(`learner_has_no_goals`) that mean nothing to a teacher between lessons.

Tone is a judgement call, so this script's job is to put the real answers in
front of a human. The lint below only catches the tells that are objectively
wrong no matter the phrasing — an internal identifier, a raw timestamp, a
gendered slash, a wall of text. A clean run is a starting point for reading, not
a passing grade.

Run:  cd backend && python scripts/teacher_assistant_eval.py
      python scripts/teacher_assistant_eval.py --teacher demo-teacher-1
      python scripts/teacher_assistant_eval.py --ask "מי צריך תשומת לב?"

Needs a seeded class (`python scripts/seed_demo_class.py`) and a live model.
"""

from __future__ import annotations

import argparse
import asyncio
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.agents import teacher_assistant, teacher_tools  # noqa: E402

DEFAULT_TEACHER = "demo-teacher-1"

# The questions a teacher actually asks, plus the two edges: pure chit-chat must
# not be dragged through a tool round, and an out-of-scope ask must be refused
# without speculation.
QUESTIONS = [
    "מה אתה יכול להגיד לי על טל?",
    "כמה תלמידים פעילים כרגע?",
    "מי צריך תשומת לב השבוע?",
    "מה כדאי לעשות עם טל מחר בבוקר?",
    "איפה הכיתה הכי מתקשה במתמטיקה?",
    "יש מישהו שלא נכנס הרבה זמן?",
    "תודה!",
    "מה מזג האוויר מחר?",
]

# ── the lint ───────────────────────────────────────────────────────────────
# Every rule here is a thing the VOICE section of the system prompt forbids
# outright, so a hit is a prompt regression, not a matter of taste.

SNAKE_CASE = re.compile(r"\b[a-z]{2,}(?:_[a-z]{2,}){1,}\b")
TOOL_NAME = re.compile(r"\b(?:get|list|explain|how)_[a-z_]+\b")
TIMESTAMP = re.compile(r"\bUTC\b|\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}")
GENDER_SLASH = re.compile(r"[֐-׿]+/[֐-׿]{1,3}\b")
NUMBERED_MENU = re.compile(r"^\s*\d+[.)]\s", re.MULTILINE)

MAX_WORDS = 150
MAX_BULLETS = 4


def lint(text: str) -> list[str]:
    problems: list[str] = []
    for label, pattern in (
        ("tool name in the prose", TOOL_NAME),
        ("internal identifier", SNAKE_CASE),
        ("raw timestamp", TIMESTAMP),
        ("gendered slash", GENDER_SLASH),
        ("numbered menu", NUMBERED_MENU),
    ):
        hits = sorted(set(pattern.findall(text)))
        if hits:
            problems.append(f"{label}: {', '.join(str(h) for h in hits[:4])}")

    words = len(text.split())
    if words > MAX_WORDS:
        problems.append(f"too long: {words} words (max {MAX_WORDS})")

    bullets = len([line for line in text.splitlines() if line.lstrip().startswith(("-", "•"))])
    if bullets > MAX_BULLETS:
        problems.append(f"too many bullets: {bullets} (max {MAX_BULLETS})")

    if re.search(r"^\s*#{1,6}\s", text, re.MULTILINE):
        problems.append("markdown heading (does not render)")

    return problems


async def ask(teacher_id: str, question: str, language: str) -> dict:
    return await teacher_assistant.run_assistant(teacher_id, question, language=language)


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--teacher", default=DEFAULT_TEACHER)
    parser.add_argument("--language", default="he")
    parser.add_argument("--ask", action="append", help="ask this instead of the set")
    args = parser.parse_args()

    teacher_tools.install()
    questions = args.ask or QUESTIONS

    print(f"\n🧑‍🏫 teacher={args.teacher}  language={args.language}  "
          f"questions={len(questions)}\n" + "─" * 72)

    failures = 0
    for question in questions:
        print(f"\n❓ {question}")
        try:
            result = await ask(args.teacher, question, args.language)
        except Exception as exc:
            print(f"   💥 {type(exc).__name__}: {exc}")
            failures += 1
            continue

        text = result.get("text")
        if not text:
            # A refusal is a legitimate answer; the client renders the key.
            print(f"   ⛔ {result.get('text_key')}")
            continue

        for line in text.splitlines():
            print(f"   {line}")

        trace = result.get("tools") or []
        print(f"   ── {len(text.split())} words · {len(trace)} tool calls "
              f"({', '.join(t['name'] for t in trace) or 'none'})"
              f"{'' if result.get('grounded') else ' · UNGROUNDED'}")

        problems = lint(text)
        for problem in problems:
            print(f"   ⚠️  {problem}")
        failures += bool(problems)

    print("\n" + "─" * 72)
    if failures:
        print(f"❌ {failures}/{len(questions)} answers tripped the lint — "
              f"fix the VOICE section in agents/teacher_assistant.py")
    else:
        print("✅ nothing tripped the lint. Now read the answers above and decide "
              "whether you would want them from a colleague.")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
