"""What the system already knows about the children a task is being built for.

A task started from a finding — "15 of 34 who tried it are stuck on positive
numbers on the number line" — used to reach the generator knowing only its own
title. The children were carried alongside it (`taskSeed.learnerIds`), used to
pre-tick the send dialog, and never once consulted about what to WRITE. So the
system found a specific weakness and then asked for a generic worksheet.

This module turns a list of learner ids into a short brief the generator can
act on. Three rules shape it, and each one is load-bearing:

**No identities, ever.** No name and no id appears in the output. A generation
prompt is not a place a child's record belongs, and the model does not need to
know who Noa is to write a better question about unit confusion — it needs to
know that seven of them keep making the same mistake. This is the same
discipline `agents/safety.screen_output` applies on the way out and the teacher
assistant's tool registry applies on the way in.

**The common denominator, not the census.** The brief is ranked by how many of
the SELECTED children share a difficulty, and hard-capped. A list of every
topic anyone struggled with is not focus, it is noise with a high token count —
and a prompt that names nine things gets a task that addresses none of them
well. Three questions and three misconceptions is the whole budget.

**Authored text travels; answers never.** Question text is quoted so the
generator can write questions *near* the ones that went wrong rather than
guessing at the topic. `answers` and `correctAnswers` are not read here at all
— the same line `learning_analytics.question_texts` already draws, for the same
reason: a generated task that leaked the source lesson's answer key would be
worse than a generic one.
"""

from __future__ import annotations

from typing import Any, Optional

#: How much of the shared picture reaches the prompt. Small on purpose — see
#: "the common denominator, not the census" above.
MAX_QUESTIONS = 3
MAX_MISCONCEPTIONS = 3
#: One question stem, truncated. Enough to recognise what was asked; not enough
#: to reproduce the lesson inside the prompt.
MAX_QUESTION_CHARS = 160
#: Below this, "shared" is a word doing no work: one child missing a question
#: is that child's afternoon, not the group's difficulty. Applies only when
#: there is a group to speak of.
MIN_SHARED = 2


#: The learner's own description (`student_description.blocks`) reaches the
#: prompt only when the task is for a few children. Across a class the lines
#: describe nobody in particular, and a prompt that says "she prefers a worked
#: example first" about thirty learners is a prompt that is wrong about most.
MAX_PROFILED_LEARNERS = 3
MAX_PROFILE_LINES = 3
#: Which blocks say something a task can act on. Motivation patterns are the
#: coach's business — a worksheet cannot be "encouraged by streaks".
PROFILE_BLOCKS = ("learning_preferences", "how_to_reach", "what_frustrates")


def _profile_lines(brain: Any) -> list[str]:
    """Current entries of the acting-relevant blocks, PII-stripped, no ids."""
    from app.agents.safety import strip_pii
    from app.brain.description import active_entries

    blocks = ((brain or {}).get("student_description") or {}).get("blocks") or {}
    lines: list[str] = []
    for key in PROFILE_BLOCKS:
        for entry in active_entries(blocks.get(key)):
            text = " ".join(str(entry.get("text") or "").split())
            if not text:
                continue
            clean, _ = strip_pii(text)
            lines.append(clean[:MAX_PROFILE_CHARS])
    return lines


MAX_PROFILE_CHARS = 200


def _mastery_band(scores: list[float]) -> Optional[str]:
    """The spread, as a range rather than an average.

    An average hides the shape a teacher is building for: 0.2 and 0.8 average
    to the same 0.5 as 0.5 and 0.5, and only one of those is a class that needs
    two different questions.
    """
    if not scores:
        return None
    low, high = min(scores), max(scores)
    return f"{low:.1f}" if abs(high - low) < 0.05 else f"{low:.1f}–{high:.1f}"


async def audience_brief(
    learner_ids: list[str],
    *,
    group_id: Optional[str] = None,
    objective_id: Optional[str] = None,
    component_id: Optional[str] = None,
    language: str = "he",
) -> dict[str, Any]:
    """The shared picture across `learner_ids`, with nobody named.

    Returns an empty-ish brief rather than raising when there is nothing to
    say: a task for children the system knows little about is still a task, and
    it should generate from the teacher's own words instead of failing.
    """
    from app.brain.mastery import entry_for
    from app.brain.repository import get_brain

    ids = [str(entry) for entry in learner_ids if entry]
    brief: dict[str, Any] = {
        "learner_count": len(ids),
        "objective_id": objective_id,
        "questions": [],
        "misconceptions": [],
        "mastery": None,
        "profile": [],
    }
    if not ids:
        return brief

    # ── what the brain knows: mastery spread and repeated misconceptions ──
    scores: list[float] = []
    tally: dict[str, int] = {}
    profile: list[str] = []
    for learner_id in ids:
        try:
            brain = await get_brain(learner_id)
        except Exception:
            continue                      # one unreadable record is not the brief's problem
        if len(ids) <= MAX_PROFILED_LEARNERS:
            profile.extend(_profile_lines(brain))
        entry = entry_for((brain or {}).get("mastery"), objective_id) if objective_id else {}
        if not entry:
            continue
        score = entry.get("score_ewma")
        if isinstance(score, (int, float)):
            scores.append(float(score))
        for misconception in (entry.get("misconceptions") or []):
            if not isinstance(misconception, dict) or misconception.get("resolved"):
                continue
            tag = str(misconception.get("tag") or "").strip()
            if tag:
                tally[tag] = tally.get(tag, 0) + 1

    brief["mastery"] = _mastery_band(scores)
    seen: set[str] = set()
    brief["profile"] = [
        line for line in profile
        if not (line in seen or seen.add(line))
    ][:MAX_PROFILE_LINES]
    floor = MIN_SHARED if len(ids) > 1 else 1
    brief["misconceptions"] = [
        {"tag": tag, "shared_by": count}
        for tag, count in sorted(tally.items(), key=lambda row: -row[1])
        if count >= floor
    ][:MAX_MISCONCEPTIONS]

    # ── what the lesson knows: which questions THESE children got wrong ──
    if component_id and group_id:
        try:
            from app.services import learning_analytics

            detail = await learning_analytics.learning_detail(
                group_id, component_id, language=language)
            chosen = set(ids)
            ranked = []
            for row in (detail.get("difficulties") or []):
                missed = [lid for lid in (row.get("learner_ids") or []) if lid in chosen]
                if len(missed) < floor:
                    continue
                # `question_text` is the authored stem, present only on teacher
                # detail paths (`_question_label`). The generated `topic` is the
                # fallback — a phrase describing the question, which is still
                # more use to the generator than an ordinal.
                text = str(row.get("question_text") or row.get("topic") or "").strip()
                if not text:
                    continue
                ranked.append({
                    "text": text[:MAX_QUESTION_CHARS],
                    "missed_by": len(missed),
                })
            ranked.sort(key=lambda row: -row["missed_by"])
            brief["questions"] = ranked[:MAX_QUESTIONS]
        except Exception as exc:      # the lesson is optional context, never a blocker
            print(f"⚠️ audience brief: question pass failed: {type(exc).__name__}: {exc}")

    return brief


def render(brief: dict[str, Any], objective_title: Optional[str] = None) -> str:
    """The brief as prompt text, or "" when it would say nothing.

    Returned empty rather than as a header with nothing under it: a prompt
    section titled "who this is for" followed by silence reads to the model as
    an instruction it has failed to satisfy, and it starts inventing an
    audience to fill the gap.
    """
    count = int(brief.get("learner_count") or 0)
    if not count:
        return ""
    questions = brief.get("questions") or []
    misconceptions = brief.get("misconceptions") or []
    profile = brief.get("profile") or []
    if not questions and not misconceptions and not brief.get("mastery") and not profile:
        # Only a head-count. True, and not worth a section — the task is for a
        # group of a known size and nothing more is known about them.
        return ""

    lines = [
        "\nWHO THIS IS FOR — this is the point of the task. Weight it above the",
        "general topic: these children have already been taught this and it did",
        "not land, so aim the questions at what actually went wrong.",
        f"  - {count} learner(s)"
        + (f", current mastery {brief['mastery']}" if brief.get("mastery") else ""),
    ]
    if objective_title:
        lines.append(f"  - Objective: {objective_title}")
    if profile:
        # The learner's own record of how they learn, in the words Yuvi keeps
        # it in. This is what made the difference between "a task about the
        # topic" and "a task for this child" — the profile said short steps,
        # one worked example, then graded practice, and the task ignored it
        # because the generator was never told (#488).
        lines.append("  - How they learn best (from what they told Yuvi and how they "
                     "work). Shape the deck's pacing and the questions' scaffolding "
                     "to this:")
        for row in profile:
            lines.append(f"      · {row}")
    if misconceptions:
        lines.append("  - Mistakes they keep repeating (fix THESE):")
        for row in misconceptions:
            lines.append(f"      · {row['tag']} — {row['shared_by']} of them")
    if questions:
        lines.append("  - Questions they actually got wrong. Write NEW questions "
                     "that attack the same idea; do not copy these:")
        for row in questions:
            lines.append(f"      · \"{row['text']}\" — missed by {row['missed_by']}")
    return "\n".join(lines) + "\n"
