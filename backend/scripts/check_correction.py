"""Does Yuvi correct a child's spoken English the way a teacher would?

Runs real utterances through the live correction path and checks the OUTPUT is
safe for a 12-14 year old: one recast, their sentence, no scores, no blame.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.env import ensure_env_loaded  # noqa: E402

ensure_env_loaded()

from app.services import english_correction  # noqa: E402
from app.services.ai_usage import UsageContext  # noqa: E402

LEARNER = "en-correct-check"

CTX = UsageContext(
    actor_id=LEARNER,
    actor_type="learner",
    endpoint="/api/agent/voice/turn",
    feature="feature_3_learning_companion",
    operation="english.correction",
    source="check_correction",
)

# (utterance, must a correction come back?)
NEEDS_FIX = [
    ("He have two brother.", "subject-verb + plural"),
    ("Yesterday I go to my grandmother house.", "past tense"),
    ("I am living here since three years.", "tense with since"),
    ("My sister she is more older than me.", "double comparative"),
]

ALREADY_FINE = [
    "I have two brothers and one sister.",
    "My mum works at a hospital in Haifa.",
    "We usually eat dinner together on Friday.",
]

TOO_SHORT = ["Hi", "Yes", "ok thanks", "שלום"]

BANNED = ["wrong", "mistake", "error", "incorrect", "bad",
          "טעות", "שגיאה", "לא נכון", "خطأ"]

out: list[str] = []


def ok(label: str, passed: bool, detail: str = "") -> bool:
    out.append(f"{'PASS' if passed else 'FAIL'}  {label}{f' — {detail}' if detail else ''}")
    return passed


async def main() -> None:
    print("Sentences that need a recast\n")
    fixes = []
    for sentence, what in NEEDS_FIX:
        result = await english_correction.suggest(sentence, "he", usage_context=CTX)
        if not ok(f"{what}: corrected", result is not None, sentence):
            continue
        fixes.append(result)
        say, note = result["say"], result["note"]
        ok(f"{what}: recast is a sentence, not an answer", len(say.split()) <= len(sentence.split()) + 4, say)
        ok(f"{what}: recast actually differs", say.strip().lower() != sentence.strip().lower())
        ok(f"{what}: note is in Hebrew", any("\u0590" <= c <= "\u05ff" for c in note), note[:60])
        ok(f"{what}: no blaming words", not any(b in (say + note).lower() for b in BANNED))
        ok(f"{what}: no numbers", not any(c.isdigit() for c in note), note[:40])

    print("\nSentences that are already fine\n")
    for sentence in ALREADY_FINE:
        result = await english_correction.suggest(sentence, "he", usage_context=CTX)
        ok("stays quiet when the sentence works", result is None,
           sentence if result is None else f"corrected anyway: {result['say']}")

    print("\nTurns that are not an attempt at a sentence\n")
    for sentence in TOO_SHORT:
        result = await english_correction.suggest(sentence, "he", usage_context=CTX)
        ok("no model call for a one-word turn", result is None, repr(sentence))

    print("\nClosing line\n")
    line = english_correction.summarize(fixes, "he")
    ok("summary carries something forward", bool(line), line[:90])
    ok("summary has no numbers", not any(c.isdigit() for c in line))
    ok("summary is in Hebrew", any("\u0590" <= c <= "\u05ff" for c in line))
    empty = english_correction.summarize([], "he")
    ok("summary with nothing to fix is still warm", bool(empty) and "לא" not in empty[:6], empty[:60])

    print("\n".join(out))
    print("\nSOME CHECKS FAILED" if any(line.startswith("FAIL") for line in out) else "\nALL CHECKS PASSED")


asyncio.run(main())
