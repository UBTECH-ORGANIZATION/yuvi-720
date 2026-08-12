"""Did the generated task actually do what it was asked to do?

Everything upstream of this file makes a task *renderable*: `spec.normalize_*`
rejects a shape the player cannot draw, `_screen_deep` takes PII out, and
`generate_task` logs which components came back. None of that asks the only
question a teacher cares about — **is this a task about the thing I asked for,
pitched at the lesson my class is actually doing?** A deck of ten beautifully
formatted slides about the wrong topic passes every existing check.

So the brief and the catalogue lesson stop being prompt text that is written and
forgotten, and become something the output is measured against.

## Two halves, and the deterministic one is not the smaller one

**Checks in code.** Counts, coverage, duplicates, whether the questions touch
what the deck taught, whether the maths stayed out of the text segments. These
are cheap, they run on every generation, they cannot hallucinate, and they catch
the failures that actually recur. They are computed first and they stand on
their own — a run with no model provider still gets them.

**One judge call.** Three dimensions, each with calibration anchors, over the
brief + the lesson's own words + the content. This is the half that can read
"the lesson teaches area by counting squares" and notice that question 4 uses
the formula. It is one call for the whole task, not one per component: the
question is about coherence, and a per-component judge cannot see incoherence.

`grader.py` established the rules a model-assigned number has to follow here and
they apply unchanged: anchors rather than a bare 1–10, deterministic guards on
top, and a fallback that says it is a fallback rather than inventing a score.

## What a score is for

It is **advisory, and it is shown to the teacher** — it never blocks a launch.
The teacher is the reviewer; this is a reviewer's checklist filled in before
they open the page, pointing at the three things most worth looking at. A gate
that refused to let a task out on a model's say-so would be the same mistake as
a grade a teacher cannot reproduce.
"""

from __future__ import annotations

import json
import re
from typing import Any, Optional

from app.services.ai_usage import UsageContext
from app.services.tasks import store
from app.services.tasks.spec import segments_to_text

#: The judge's scale, matching `grader.py` so the two read the same way.
SCALE_MIN, SCALE_MAX = 1, 10

#: Named so a caller cannot misspell one into silence.
DIMENSIONS = ("follows_brief", "matches_lesson", "sound")

#: Below this, the review screen says so rather than leaving the teacher to
#: notice a low number. Chosen at the anchor for "partly off": a 5 means the
#: judge found something real.
CONCERN_BELOW = 6.0

#: Hebrew/Arabic/Latin word characters. `\w` in Python is already Unicode-aware;
#: this exists to drop punctuation and the vendor's dotted ids.
_WORD = re.compile(r"[^\W\d_]{3,}", re.UNICODE)

#: Words that carry no topic. Deliberately short — a long stop list starts
#: removing the domain words ("area", "number") that ARE the signal.
_STOP = {
    "את", "של", "עם", "על", "אל", "כמו", "יותר", "פחות", "הוא", "היא", "הם",
    "זה", "זאת", "אנחנו", "אתם", "כדי", "אבל", "גם", "רק", "כל", "יש", "אין",
    "the", "and", "for", "with", "that", "this", "from", "are", "was", "were",
    "you", "your", "not", "但", "من", "على", "في", "هذا", "هذه", "التي",
}


#: Hebrew's one-letter prefixes (the, and, in, to, as, from, that). Written into
#: the comparison because without it the check is close to useless here: a
#: teacher who types "מכנה משותף" gets content saying "המכנה המשותף", and exact
#: matching scores that as two words missed out of three.
_HE_PREFIX = "הובלכמש"
_MIN_STEM = 3


def _variants(word: str) -> set[str]:
    """A word and its prefix-stripped form — never one replacing the other.

    Stripping in place was the first attempt and it is wrong: "משותף" (shared)
    and "מכנה" (denominator) begin with a letter that is *also* a prefix, so
    stripping mangled real words into "שותף" and "כנה" and could match them
    against unrelated ones. Keeping both forms costs nothing and cannot invent
    a word that was not there.
    """
    if len(word) > _MIN_STEM and word[0] in _HE_PREFIX:
        return {word, word[1:]}
    return {word}


def words(text: str) -> set[str]:
    """Content words, lowercased. The unit both coverage checks count in."""
    return {
        word.lower() for word in _WORD.findall(text or "")
        if word.lower() not in _STOP
    }


def covered(wanted: set[str], present: set[str]) -> set[str]:
    """Which of `wanted` the text actually uses, allowing for a prefix letter.

    Returns the words as they were WRITTEN in the brief, because the list is
    shown to the teacher who wrote them.
    """
    index: set[str] = set()
    for word in present:
        index |= _variants(word)
    return {word for word in wanted if _variants(word) & index}


def content_text(content: dict[str, Any]) -> str:
    """Everything a child would read in one component, as plain text.

    Walks the whole structure rather than naming fields: a component's shape
    differs per type and a field list here would silently stop covering a shape
    the moment `spec.py` gained one.
    """
    parts: list[str] = []

    def walk(value: Any) -> None:
        if isinstance(value, list):
            if value and all(isinstance(item, dict) and item.get("type") in ("text", "math")
                             for item in value):
                parts.append(segments_to_text(value))
                return
            for item in value:
                walk(item)
        elif isinstance(value, dict):
            for key, item in value.items():
                # `id` and `layout` are machinery, and `accept` is an answer key
                # whose words are not the lesson's vocabulary.
                if key in ("id", "layout", "type", "image_url", "visual"):
                    continue
                walk(item)
        elif isinstance(value, str):
            parts.append(value)

    walk(content)
    return " ".join(parts)


def question_rows(content: dict[str, Any]) -> list[dict[str, Any]]:
    """Every scored question in one component, whatever the component is."""
    if "questions" in content:
        return [row for row in content.get("questions") or [] if isinstance(row, dict)]
    return [
        row for row in content.get("blocks") or []
        if isinstance(row, dict) and row.get("scored") is not False
    ]


# ── the checks that need no model ────────────────────────────────────────────

def _asked_count(task_spec: dict[str, Any], component: str) -> Optional[int]:
    settings = task_spec.get(component) or {}
    for key in ("question_count", "slide_count", "block_count"):
        value = settings.get(key)
        if isinstance(value, int) and value > 0:
            return value
    return None


def _produced_count(component: str, content: dict[str, Any]) -> int:
    if component == "presentation":
        return len(content.get("slides") or [])
    if component == "interactive":
        return len(content.get("blocks") or [])
    return len(content.get("questions") or [])


def brief_text(task_spec: dict[str, Any]) -> str:
    """What the teacher actually typed. The thing the task is measured against."""
    return " ".join(str(task_spec.get(field) or "") for field in
                    ("title", "topic", "notes"))


def deterministic_checks(
    task_spec: dict[str, Any],
    content_by_component: dict[str, dict[str, Any]],
    *,
    lesson_text: str = "",
) -> dict[str, Any]:
    """Everything measurable without asking anybody's opinion.

    Returns a dict of named checks, each `{ok, detail, …}`. A check that cannot
    be evaluated (no lesson picked, no deck generated) reports `ok: None` — the
    difference between "we looked and it was fine" and "there was nothing to
    look at" is exactly what a teacher needs from a checklist.
    """
    checks: dict[str, Any] = {}
    asked = list(task_spec.get("components") or [])

    # 1. Everything the teacher ticked came back.
    missing = [component for component in asked if component not in content_by_component]
    checks["components_present"] = {
        "ok": not missing, "missing": missing, "asked": asked,
    }

    # 2. …at roughly the size they asked for. Under-delivery is the failure that
    #    matters: a teacher who asked for ten questions and reviews six has been
    #    quietly given a different task.
    sizes = []
    for component, content in content_by_component.items():
        want = _asked_count(task_spec, component)
        got = _produced_count(component, content)
        sizes.append({"component": component, "asked": want, "got": got,
                      "ok": want is None or got >= want})
    checks["counts"] = {"ok": all(row["ok"] for row in sizes), "components": sizes}

    # 3. Does the content use the words of the brief at all? Lexical, and framed
    #    as a floor rather than a score: a task that shares two content words
    #    with the thing it was asked about is not about it.
    brief_words = words(brief_text(task_spec))
    all_text = " ".join(content_text(content) for content in content_by_component.values())
    generated_words = words(all_text)
    hit = covered(brief_words, generated_words)
    checks["brief_vocabulary"] = {
        "ok": (len(hit) / len(brief_words) >= 0.34) if brief_words else None,
        "matched": sorted(hit)[:12],
        # Against `hit`, not against the raw word set: a word matched through a
        # prefix would otherwise appear in both lists at once.
        "missed": sorted(brief_words - hit)[:12],
        "share": round(len(hit) / len(brief_words), 2) if brief_words else None,
    }

    # 4. Same question against the catalogue lesson, when one was picked.
    lesson_words = words(lesson_text)
    if lesson_words:
        lesson_hit = covered(lesson_words, generated_words)
        checks["lesson_vocabulary"] = {
            "ok": len(lesson_hit) / len(lesson_words) >= 0.15,
            "share": round(len(lesson_hit) / len(lesson_words), 2),
            "matched": sorted(lesson_hit)[:12],
        }
    else:
        checks["lesson_vocabulary"] = {"ok": None, "reason": "no_lesson"}

    # 5. Do the questions ask about what the deck taught? This is the promise
    #    `generate_task` makes by generating the presentation first and feeding
    #    its outline forward, and nothing checked that it was kept.
    deck = content_by_component.get("presentation")
    scored_components = {
        key: value for key, value in content_by_component.items()
        if key in ("practice", "test", "interactive")
    }
    if deck and scored_components:
        points = [str(point) for slide in deck.get("slides") or []
                  for point in (slide.get("key_points") or [])]
        point_words = [words(point) for point in points]
        grounded = 0
        total = 0
        for content in scored_components.values():
            for question in question_rows(content):
                total += 1
                question_words = words(segments_to_text(question.get("prompt")))
                if any(len(covered(point, question_words)) >= 2 for point in point_words):
                    grounded += 1
        checks["questions_follow_deck"] = {
            "ok": total == 0 or grounded / total >= 0.5,
            "grounded": grounded, "total": total,
        }
    else:
        checks["questions_follow_deck"] = {"ok": None, "reason": "no_deck_or_no_questions"}

    # 6. Two questions that are the same question. Cheap to make by accident
    #    when a model is asked for twelve on one narrow topic.
    prompts: list[str] = []
    for content in scored_components.values():
        prompts.extend(
            segments_to_text(question.get("prompt")).strip().lower()
            for question in question_rows(content)
        )
    duplicates = sorted({prompt for prompt in prompts if prompt and prompts.count(prompt) > 1})
    checks["no_duplicate_questions"] = {
        "ok": not duplicates, "duplicates": duplicates[:5],
    }

    # 7. The rule the generator prompt states three times: maths lives in math
    #    segments. A formula glued into a text segment renders backwards in
    #    Hebrew and looks perfectly correct in the JSON.
    leaks = _segment_leaks(content_by_component)
    checks["math_segments_clean"] = {"ok": not leaks, "examples": leaks[:5]}

    return checks


#: LaTeX the prompt forbids, plus a bare equation inside a prose segment.
_LATEX = re.compile(r"\\frac|\\sqrt|\\[a-z]{2,}|\$\$?|\^\{")
_EQUATION_IN_PROSE = re.compile(r"[֐-׿؀-ۿ].*?\d\s*[+\-×÷*/=]\s*\d")


def _segment_leaks(content_by_component: dict[str, dict[str, Any]]) -> list[str]:
    """Text segments carrying what should have been a math segment."""
    found: list[str] = []

    def walk(value: Any) -> None:
        if isinstance(value, list):
            for item in value:
                if isinstance(item, dict) and item.get("type") == "text":
                    text = str(item.get("text") or "")
                    if _LATEX.search(text) or _EQUATION_IN_PROSE.search(text):
                        found.append(text[:120])
                else:
                    walk(item)
        elif isinstance(value, dict):
            for item in value.values():
                walk(item)

    walk(content_by_component)
    return found


# ── the judge ────────────────────────────────────────────────────────────────

_ANCHORS = """
1  = about a different topic, or unusable as written.
4  = recognisably about the topic, but drifts from what was asked, or pitches it
     at the wrong level, or teaches a method the lesson does not use.
7  = does what was asked, at the right level; one or two items are weak.
10 = exactly the task described, in the lesson's own vocabulary and conventions,
     with nothing introduced that the lesson does not cover.
"""

_JUDGE = """You are reviewing a learning task that was generated for a teacher.
You are NOT rewriting it. You are answering one question: did it do what it was
asked to do?

THE TEACHER ASKED FOR THIS:
{brief}
{lesson}
THIS IS WHAT WAS GENERATED:
{content}

Score three things from {low} to {high}. The scale, for all three:
{anchors}

  follows_brief  — is this the task the teacher described, at the level, the
                   difficulty and the size they asked for?
  matches_lesson — does it use the SAME vocabulary, conventions and methods as
                   the curriculum lesson quoted above, and introduce nothing that
                   lesson does not teach? If no lesson was quoted, score this on
                   whether the task is internally consistent about its own method,
                   and say so in the rationale.
  sound          — is every question answerable from what the task itself
                   presents, is every answer key correct, and is everything it
                   asserts true?

Then list up to 5 concrete findings. A finding names ONE item and says what is
wrong with it — "question 4 asks for the area of a circle, which the lesson does
not cover" — never a general remark. If nothing is wrong, return an empty list.

Return JSON only:
{{"follows_brief": {{"score": 7, "why": "one sentence"}},
  "matches_lesson": {{"score": 7, "why": "one sentence"}},
  "sound": {{"score": 7, "why": "one sentence"}},
  "findings": [{{"component": "practice", "item": 4, "problem": "one sentence"}}]}}
Write "why" and "problem" in {language}."""

#: How much of the content the judge is shown.
MAX_JUDGE_CHARS = 14000


def _key_text(question: dict[str, Any]) -> str:
    """The answer key as a phrase, resolved against the question's own options.

    Rendered rather than dumped, and this is not cosmetic. The first version
    printed `json.dumps(answer)[:160]`, and the judge duly reported that three
    questions had "a truncated answer key" and were unusable — a finding about
    the SUMMARY, blamed on the content. A checker that manufactures its own
    findings is worse than no checker, so nothing here truncates and nothing
    here shows an index the judge cannot resolve to a word.
    """
    key = question.get("answer") or {}
    options = question.get("options") or []
    targets = question.get("targets") or []

    def option(index: Any) -> str:
        if isinstance(index, int) and 0 <= index < len(options):
            return segments_to_text(options[index])
        return f"#{index}"

    def target(index: Any) -> str:
        if isinstance(index, int) and 0 <= index < len(targets):
            return segments_to_text(targets[index])
        return f"#{index}"

    kind = question.get("type")
    if kind in ("mcq", "image_mcq"):
        return option(key.get("index"))
    if kind == "true_false":
        return "true" if key.get("value") else "false"
    if kind == "multiple_correct":
        return " + ".join(option(index) for index in key.get("indices") or [])
    if kind == "ordering":
        return " → ".join(option(index) for index in key.get("order") or [])
    if kind == "matching":
        return " ; ".join(
            f"{option(left)} → {target(right)}" for left, right in key.get("pairs") or [])
    if kind == "fill_blank":
        return " | ".join(
            "/".join(str(value) for value in (blank.get("accept") or []))
            for blank in key.get("blanks") or [])
    if kind == "open_ended":
        return " ; ".join(
            str(entry.get("criterion") or "") for entry in key.get("rubric") or [])
    return json.dumps(key, ensure_ascii=False)


def _compact(content_by_component: dict[str, dict[str, Any]]) -> str:
    """The content as the judge reads it: plain text, labelled, complete.

    "Complete" is the load-bearing word. Anything this drops, the judge reads as
    missing from the task — a matching question shown without its right-hand
    column looks exactly like a matching question that has no right-hand column,
    and it was reported as one.
    """
    lines: list[str] = []
    for component, content in content_by_component.items():
        lines.append(f"\n## {component}")
        if component == "presentation":
            for index, slide in enumerate(content.get("slides") or [], start=1):
                lines.append(
                    f"  slide {index}: {segments_to_text(slide.get('title'))} — "
                    f"{segments_to_text(slide.get('body'))[:300]}")
                for bullet in (slide.get("bullets") or [])[:6]:
                    lines.append(f"    - {segments_to_text(bullet)}")
                for point in (slide.get("key_points") or [])[:4]:
                    lines.append(f"    · {point}")
            continue
        for index, question in enumerate(question_rows(content), start=1):
            lines.append(
                f"  {index}. [{question.get('type')}] {segments_to_text(question.get('prompt'))}")
            options = question.get("options") or []
            if options:
                lines.append("     options: " + " | ".join(
                    segments_to_text(option) for option in options))
            # The other half of a matching question. Its absence was being read
            # as the question's own defect.
            targets = question.get("targets") or []
            if targets:
                lines.append("     match against: " + " | ".join(
                    segments_to_text(target) for target in targets))
            lines.append(f"     key: {_key_text(question)}")

    body = "\n".join(lines)
    if len(body) > MAX_JUDGE_CHARS:
        # Said out loud, so a task cut off here is not reported as a task that
        # ends mid-sentence.
        return (body[:MAX_JUDGE_CHARS]
                + "\n\n[This summary was cut off here for length. Do not treat "
                  "anything after this point as missing from the task.]")
    return body


def _usage(task_id: str) -> UsageContext:
    return UsageContext(
        actor_id="system", actor_type="system",
        endpoint="internal:task_quality", feature="feature_5_teacher_tasks",
        operation="task.quality.judge", source="task_quality",
        request_id=task_id,
    )


def _clamp(value: Any) -> Optional[float]:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return float(max(SCALE_MIN, min(SCALE_MAX, number)))


async def judge(
    task_id: str,
    task_spec: dict[str, Any],
    content_by_component: dict[str, dict[str, Any]],
    *,
    lesson_text: str = "",
) -> Optional[dict[str, Any]]:
    """One model pass over the whole task. `None` when there is no provider.

    `None` rather than a neutral score, deliberately: a 7 that means "nobody
    looked" is worse than a blank, because a teacher cannot tell the two apart.
    """
    from app.services.llm import call_llm

    language = task_spec.get("language", "he")
    prompt = _JUDGE.format(
        brief=brief_text(task_spec).strip() or "(the teacher wrote nothing)",
        lesson=f"\nTHE CURRICULUM LESSON THIS ACCOMPANIES:\n{lesson_text}\n"
               if lesson_text else "\n(no curriculum lesson was chosen)\n",
        content=_compact(content_by_component),
        anchors=_ANCHORS,
        low=SCALE_MIN, high=SCALE_MAX, language=language,
    )
    raw = await call_llm(
        [{"role": "user", "content": prompt}],
        usage_context=_usage(task_id),
        max_tokens=1200, json_mode=True, model_tier="strong",
    )
    if not raw:
        return None

    from app.services.tasks.spec import loads_model_json

    payload = loads_model_json(raw)
    if not isinstance(payload, dict):
        return None

    scores: dict[str, Any] = {}
    for dimension in DIMENSIONS:
        entry = payload.get(dimension)
        entry = entry if isinstance(entry, dict) else {"score": entry}
        score = _clamp(entry.get("score"))
        if score is None:
            continue
        scores[dimension] = {"score": score, "why": str(entry.get("why") or "")[:400]}
    if not scores:
        return None

    findings = []
    for finding in (payload.get("findings") or [])[:5]:
        if not isinstance(finding, dict):
            continue
        problem = str(finding.get("problem") or "").strip()
        if not problem:
            continue
        findings.append({
            "component": str(finding.get("component") or "")[:24],
            "item": finding.get("item"),
            "problem": problem[:300],
        })

    return {"scores": scores, "findings": findings}


# ── the whole report ─────────────────────────────────────────────────────────

def overall(report: dict[str, Any]) -> Optional[float]:
    """One number, and only when the judge produced one.

    The mean of the three dimensions rather than a weighted blend: a weighting
    would encode a claim about which failure is worse, and the three are worse
    in different ways depending on the task.
    """
    scores = [entry["score"] for entry in (report.get("scores") or {}).values()]
    return round(sum(scores) / len(scores), 1) if scores else None


def concerns(report: dict[str, Any]) -> list[str]:
    """The named things worth a teacher's eye, worst first.

    Checks that could not be evaluated (`ok is None`) are NOT concerns. A task
    built without a catalogue lesson has nothing to be off-lesson about, and
    listing that as a problem would train teachers to ignore the list.
    """
    named: list[tuple[float, str]] = []
    for dimension, entry in (report.get("scores") or {}).items():
        if entry["score"] < CONCERN_BELOW:
            named.append((entry["score"], dimension))
    for name, check in (report.get("checks") or {}).items():
        if isinstance(check, dict) and check.get("ok") is False:
            named.append((0.0, name))
    named.sort(key=lambda row: row[0])
    return [name for _, name in named]


async def review(task_id: str) -> dict[str, Any]:
    """Measure one generated task and store the result on it.

    Never raises: a quality report that breaks generation would be a check that
    costs more than it finds. A failure is recorded as `judge: null`, which the
    review screen renders as "not measured" rather than as a pass.
    """
    from app.services.tasks.generate import source_grounding

    task = await store.get_task(task_id)
    if task is None:
        raise store.TaskStoreError("not_found")
    task_spec = task.get("spec") or {}
    language = task_spec.get("language", "he")

    content_by_component = {
        component: content
        for component, content in (await store.all_content(task_id)).items()
        if isinstance(content, dict) and content
    }

    lesson_text = ""
    try:
        lesson_text = source_grounding(task_spec, language)
    except Exception as exc:  # a catalogue hiccup must not cost the checks
        print(f"⚠️ quality grounding unavailable: {type(exc).__name__}: {exc}")

    report: dict[str, Any] = {
        "checks": deterministic_checks(
            task_spec, content_by_component, lesson_text=lesson_text),
        "scores": {},
        "findings": [],
        "judged": False,
    }

    try:
        verdict = await judge(task_id, task_spec, content_by_component,
                              lesson_text=lesson_text)
    except Exception as exc:
        print(f"⚠️ quality judge failed for {task_id}: {type(exc).__name__}: {exc}")
        verdict = None

    if verdict:
        report.update(verdict)
        report["judged"] = True

    report["overall"] = overall(report)
    report["concerns"] = concerns(report)
    await store.update_task(task_id, quality=report)
    return report
