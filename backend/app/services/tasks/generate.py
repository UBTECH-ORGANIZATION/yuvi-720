"""Generating a task, one component at a time.

The ladder is `question_explainer`'s, because it is the one that works here:
prompt → `call_llm(json_mode=True, model_tier="strong")` → lenient parse →
normalize → validate → safety screen → optional visual → store → the client
polls. An in-flight task registry means a teacher who reloads the builder does
not start a second generation of the same task.

## Sequential, and why that is not a limitation

The presentation is generated first and returns an **outline** — the key points
its slides actually make — which grounds the practice and test questions. That
is what makes a task coherent rather than four artefacts about the same topic.

The reference implementation needed the same handoff and reached for
`sleep(5)` polling between two independent jobs, because its components were
generated in parallel and the outline had to appear in a database before the
questions could start. Generating in one process makes the outline a return
value. There is nothing to poll for and nothing to time out.

## Every text field is segments

Not prose. The prompt says so at length and `spec.normalize_*` enforces it,
because Hebrew and math in one string is the failure this whole feature was
warned about — see `spec.py` and `frontend/src/features/tasks/mathSegments.ts`.
"""

from __future__ import annotations

import asyncio
import re
from typing import Any, Optional

from app.services.ai_usage import UsageContext
from app.services.tasks import spec as spec_module
from app.services.tasks import store

#: In-flight generations keyed by task id, so a reloaded builder, a double
#: click and a retry all join the run already going rather than starting one.
_tasks: dict[str, "asyncio.Task[Any]"] = {}

#: A deck may carry at most this many rendered visuals.
#:
#: Was 3, set when the deck could not display one at all — the renderer read
#: four field names the payload does not have, so every diagram was dropped on
#: arrival and the budget was never felt. A ten-slide deck wants a picture on
#: most slides that teach a relation. The non-animated path is pure Python (no
#: subprocess, `build_scene_visual`), and they render concurrently, so the cost
#: of eight is roughly the cost of the slowest one.
MAX_VISUALS = 8

_FRAMING = {
    "he": "אתה יובי, בונה משימת לימוד עבור מורה, לתלמידים בחטיבת ביניים.",
    "ar": "أنت يوفي، تبني مهمة تعليمية لمعلّم، لطلاب المرحلة الإعدادية.",
    "en": "You are Yuvi, building a learning task for a teacher, for middle-schoolers.",
}

#: The contract that cannot be re-derived. Stated in full on every pass because
#: a model that gets it wrong produces content that renders backwards in Hebrew
#: and looks, in the JSON, entirely correct.
_MATH_RULES = """
EVERY text field is an ARRAY OF SEGMENTS, never a sentence:
  [{"type":"text","text":"האות "},{"type":"math","value":"b = -4","punctuation":"."}]

Rules, all of which matter:
- Hebrew/Arabic words belong in "text" segments. Maths belongs in "math" segments.
- NEVER glue words and maths into one string. This is the single most important rule.
- Keep the readable spaces inside the text segments around a formula.
- If a sentence containing a formula ends in punctuation, that punctuation goes in
  the math segment's "punctuation" field, NOT inside "value".
- NO LaTeX. No "$", no \\frac, no \\sqrt, no ^{}. Write 3/4, √9, x², × and ÷ directly.
"""

#: What the level on the build form actually changes.
#:
#: It used to be the word itself — `Difficulty: hard` on a line between the
#: topic and the teacher's notes — and a one-word label in a list of ten fields
#: moves the output very little: three tasks built at three levels came back
#: near enough the same questions. A level a teacher sets and cannot feel is
#: worse than no control at all, because they stop trusting the rest of the form
#: too.
#:
#: So each level names the things that actually make a question harder, and they
#: are the same things the tooltip on that field promises a teacher: how many
#: steps an answer takes, whether the numbers are friendly, whether the prompt
#: names the method, what the wrong options are made of, and how much is
#: transfer rather than repetition.
_DIFFICULTY = {
    "easy": """
LEVEL: easy. Concretely, for THIS task:
- One step per question. Nothing needs a result from an earlier question.
- Choose numbers so the arithmetic is never the difficulty: whole, small, exact.
- The prompt names the method or the formula it wants used.
- Wrong options are the careless slips (a sign, a swapped pair), not traps.
- Stay inside what the lesson worked through. No transfer to a new situation.
- Hints spell out the first step in words.
- Most questions carry "difficulty":"easy"; at most one is "medium".
""",
    "medium": """
LEVEL: medium. Concretely, for THIS task:
- Most questions take two steps.
- Ordinary numbers, including the fractions, decimals or negatives the topic uses.
- The prompt states the situation and does NOT name the method.
- Every wrong option encodes a real misconception, not a random number.
- About a quarter of the questions apply the idea to a situation the lesson did
  not show, using only what it taught.
- Hints point at which idea is needed, without walking through it.
- A spread of "difficulty" values, weighted to "medium".
""",
    "hard": """
LEVEL: hard. Concretely, for THIS task:
- Most questions take three or more steps, or combine two ideas from the lesson.
- Awkward but fair numbers, and the edge cases: zero, negatives, units that must
  be converted, a quantity that does not divide evenly.
- No scaffolding in the prompt. Some questions carry information that is not
  needed, so choosing what matters is part of the work.
- Every wrong option is a misconception a real student holds, and at least one
  is the answer to the question a careless reader thinks was asked.
- At least a third are transfer: a new situation, or "explain why", or a claim
  to judge as true or false with a reason.
- Hints are one nudge, never a method.
- Most questions carry "difficulty":"hard"; none is "easy".
""",
}

#: How much goes on one slide. The stage is fixed at 1280×720 and shrinks its
#: own type to fit, so "full" is a real option rather than a way to overflow —
#: but a slide that has been shrunk to 0.72 is a slide nobody reads from the
#: back of a room, and the model is told the size it is writing into.
_DENSITY = {
    "airy": "\nDENSITY: airy. One idea per slide and few words on it — a heading, "
            "a sentence, and at most three short bullets. This deck is meant to be "
            "read from across a classroom.\n",
    "balanced": "\nDENSITY: balanced. One idea per slide, said properly: a heading, "
                "two or three sentences or up to five bullets.\n",
    "full": "\nDENSITY: full. A slide may carry a complete explanation — the idea, "
            "why it works, and a worked case. Still one idea per slide; more about "
            "it, not more of them.\n",
}

#: Asked for, or explicitly not. "Not" is the cheaper answer in every sense: no
#: planner call, no render, and a deck of words for a topic that has no picture
#: worth drawing.
_DIAGRAMS_OFF = ("\nDIAGRAMS: none. Do NOT write `visual_hint` on any slide. This "
                 "topic is taught in words.\n")

_SELF_CHECK_OFF = "\nDo NOT include a `reveal` slide in this deck.\n"

_NOTES_OFF = "\nDo NOT write `notes` on any slide.\n"

_EXAMPLES_OFF = ("\nNo worked examples: teach the idea and leave the practice to "
                 "the questions.\n")

_KEY_CONCEPTS = ("\nMUST COVER. The deck has to teach these, by name, and a slide "
                 "that does not serve one of them is a slide to cut:\n  {concepts}\n")


#: The same dial for a deck, which has no questions to make harder.
_DIFFICULTY_SLIDES = {
    "easy": "\nLEVEL: easy. Spend the deck on the basics: one idea per slide, a "
            "worked example on each, and the vocabulary said in full.\n",
    "medium": "\nLEVEL: medium. Establish the basics quickly, then spend most of "
              "the deck on using them, with one worked example per idea.\n",
    "hard": "\nLEVEL: hard. Assume the basics and say them once. Spend the deck "
            "on the harder cases, on why the method works, and on where it "
            "breaks — including a case that looks like the others and is not.\n",
}

_COMPONENT_RULES = {
    "presentation": """
Write a {slide_count}-slide deck teaching this topic. Each slide:
  {{"id":"s1","layout":"...","title":[segments],"body":[segments],
    "bullets":[[segments],...],"key_points":["one plain sentence",...],
    "notes":"what the teacher says while this slide is up",
    "visual_hint":"what a diagram should show, or omit"}}

LAYOUTS, and what each is for:
  title      — opens the deck. One heading, one line under it.
  text       — one idea, said in a paragraph.
  bullets    — 3-5 short points that belong to one idea.
  fact_grid  — 3-6 SEPARATE small ideas, each a tile:
               "cards":[{{"emoji":"🌡","front":[segments],"back":[segments]}},...]
               Use this instead of bullets when the points do not build on each other.
  compare    — "sides": exactly two {{"label":[segments],"items":[[segments],...]}}
  timeline   — "steps": [{{"label":[segments],"body":[segments]}}] — an order, a
               process, a sequence of causes.
  big_number — one figure that matters. "value":"206". For two or three related
               figures use "values":[{{"value":"3","caption":[segments]}},...].
  reveal     — the child clicks to check themselves. "cards" of front/back:
               a term and its meaning, a question and its answer. 2-6 cards.
               At most ONE reveal slide per deck.
  quote      — one sentence at full size. A definition, a law, a rule worth
               remembering exactly. "body" only.
  fact       — an aside: a surprising detail, a warning, a common mistake.
  text_image — a paragraph beside a picture. Do NOT set image_url yourself.
  summary    — the LAST slide, always.

RULES:
- Never use the same layout twice in a row.
- A deck of only `text` and `bullets` is the failure to avoid. Reach for
  fact_grid, compare, timeline and big_number when the content fits them.
- The LAST slide MUST have layout "summary".

"key_points" are plain strings (no segments) — they ground the questions later, so
write what the slide actually taught, not what it was about.

"notes" is written TO THE TEACHER and the child never sees it. One or two
sentences: what to say here, what to ask the class, or what students usually get
wrong. Write it for the slides where you actually have something to say; omit it
where you would only be restating the slide.

"visual_hint" asks for a DIAGRAM to be drawn — shapes, a number line, axes, a
labelled figure, a comparison of quantities. Add one wherever seeing the thing
teaches it better than reading it: a shape being described, a relation between
quantities, a process with parts, a before-and-after. Say what it should show and
what is labelled, e.g. "a right triangle with legs 3 and 4 labelled, hypotenuse
unlabelled". Do NOT ask for a photograph, a person, a scene or decoration — it is
drawn as line art, not fetched.

Return {{"slides":[...]}}.
""",
    "practice": """
Write {question_count} practice questions. Tone is encouraging: every question
carries a "hint" that nudges without giving the answer, and an "explanation" that
teaches after the answer is seen.

Then write up to {study_count} STUDY blocks — not questions, and not scored:
  {{"widget":"flashcards|click_reveal","prompt":[segments],
    "cards":[{{"front":[segments],"back":[segments]}}]}}
A study block is for a definition, a unit, a formula or a term worth rehearsing:
front is the thing, back is what it means. Omit them entirely ({{"study":[]}}) if
this topic has nothing worth rehearsing that way — padding is worse than none.
""",
    "test": """
Write {question_count} assessment questions. No hints — this is a test. Every
question still carries an "explanation", shown after submission.
""",
    "interactive": """
Write {block_count} interactive blocks. Each is:
  {{"widget":"match_pairs|sort_items|fill_blank_drag|flashcards|click_reveal",
    "prompt":[segments], ...the fields that widget needs}}
- match_pairs: "options" (left, array of segment arrays), "right_items" (right),
  and "answer":{{"pairs":[[0,2],[1,0]]}}
- sort_items: "options" (the items, in SCRAMBLED order) and
  "answer":{{"order":[2,0,1]}} giving the correct positions
- fill_blank_drag: "prompt" with the gap written as ___ and
  "answer":{{"blanks":[{{"accept":["12"]}}]}}
- flashcards / click_reveal: "cards":[{{"front":[segments],"back":[segments]}}]
Return {{"blocks":[...]}}.
""",
}

_QUESTION_RULES = """
Each question is:
  {{"id":"q1","type":"...","prompt":[segments],"options":[[segments],...],
    "answer":{{...}},"explanation":[segments],"hint":[segments],
    "difficulty":"easy|medium|hard"}}

type and its answer shape — use EXACTLY these keys:
  mcq               "options" (2-4) + "answer":{{"index":2}}
  true_false        "answer":{{"value":true}}
  multiple_correct  "options" + "answer":{{"indices":[0,3]}}
  fill_blank        "answer":{{"blanks":[{{"accept":["12","12.0"]}}]}}
                    A blank that IS something named — a coordinate, a numerator,
                    a unit — carries a short "label" and the box is drawn as
                    `x = [ ]`: {{"blanks":[{{"accept":["5"],"label":"x"}},
                                          {{"accept":["7"],"label":"y"}}]}}
                    One or two words, never a sentence, and omitted entirely
                    when the blank is just a gap in a sentence. Two unlabelled
                    boxes for the coordinates of a point are two boxes a child
                    can fill in the wrong order without ever being told which
                    was which.
  matching          "options" (left) + "right_items" + "answer":{{"pairs":[[0,2]]}}
  ordering          "options" (scrambled) + "answer":{{"order":[2,0,1]}}
  open_ended        "answer":{{"rubric":[{{"criterion":"what a good answer shows","weight":1}}]}}

"index", "indices" and "order" are POSITIONS in "options", counting from 0 — never
the text of an option. A question whose answer does not point at a real option is
discarded, so check each one.
Vary the types. At most one open_ended question in {question_count}.
"""

#: The return shape, stated LAST so it is the final instruction the model reads.
#: It used to live inside `_QUESTION_RULES`, which is appended AFTER the
#: component rules — so practice's own "return questions and study" was
#: overridden two paragraphs later by a bare "return questions", and the study
#: blocks would have come back empty every time with nothing to show why.
_RETURN = {
    "practice": '\nReturn {"questions":[...],"study":[...]}.',
    "test": '\nReturn {"questions":[...]}.',
}


def _usage(task_id: str, component: str) -> UsageContext:
    return UsageContext(
        actor_id="system", actor_type="system",
        endpoint="internal:task_generate", feature="feature_5_teacher_tasks",
        operation=f"task.generate.{component}", source="task_generate",
    )


#: How many of a lesson's screens to quote into the prompt. The catalogue's
#: `informationToBot` runs a paragraph per screen, and a lesson has up to ten —
#: past this the grounding stops being grounding and becomes the bulk of the
#: prompt, at which point the model starts summarising it instead of using it.
MAX_SOURCE_SCREENS = 8


def source_grounding(task_spec: dict[str, Any], language: str = "he") -> str:
    """What the catalogue lesson this task is built on actually teaches.

    The content vendor writes an `informationToBot` for every screen — a
    description, in their words, of what that screen is for. It is the same
    text the coach is grounded on and the same text the student profile shows
    a teacher, and it is by far the best thing to hand a question generator:
    "write questions about THIS lesson" instead of "about this topic".

    Nothing here is generated or inferred. Where the catalogue is silent this
    returns "", and the prompt is exactly what it was before a lesson was
    picked — the feature degrades to the old behaviour rather than to a worse
    one.
    """
    source = task_spec.get("source")
    if not isinstance(source, dict):
        return ""
    from app.services import kata_catalog

    component_id = source.get("component_id")
    objective_id = source.get("objective_id")

    lesson = kata_catalog.component_title(component_id, language) if component_id else None
    objective = kata_catalog.objective_title(objective_id, language) if objective_id else None

    screens: list[str] = []
    for profile in kata_catalog.item_profiles(component_id)[:MAX_SOURCE_SCREENS]:
        information = kata_catalog.information_for_item(component_id, profile.get("id"))
        title = str(profile.get("title") or "").strip()
        text = " ".join(str(information or "").split())[:400]
        if text:
            screens.append(f"  - {title + ': ' if title else ''}{text}")
        elif title:
            screens.append(f"  - {title}")

    if not (lesson or objective or screens):
        return ""

    lines = ["\nThis task accompanies a lesson the class has in the curriculum."]
    if objective:
        lines.append(f"Learning objective: {objective}")
    if lesson:
        lines.append(f"Lesson: {lesson}")
    if screens:
        lines.append("What that lesson actually covers, screen by screen "
                     "(the content author's own words):")
        lines.extend(screens)
    lines.append(
        "Write for THIS lesson: the same vocabulary, the same conventions, the "
        "same level. Do not introduce a method the lesson does not use, and do "
        "not assume anything it does not cover.\n")
    return "\n".join(lines)


def _deck_settings(settings: dict[str, Any]) -> str:
    """The deck options a teacher set, as instructions.

    Only the ones that DIFFER from the default say anything: a prompt that
    restates every default is a prompt where the one line that matters is
    buried among six that do not.
    """
    lines = _DENSITY.get(str(settings.get("density") or "balanced"), "")

    concepts = str(settings.get("key_concepts") or "").strip()
    if concepts:
        # Comma or newline separated, whichever the teacher typed.
        terms = [term.strip() for term in re.split(r"[,\n;]+", concepts) if term.strip()]
        if terms:
            lines += _KEY_CONCEPTS.format(concepts="\n  ".join(f"- {term}" for term in terms[:12]))

    if not settings.get("examples", True):
        lines += _EXAMPLES_OFF
    if not settings.get("diagrams", True):
        lines += _DIAGRAMS_OFF
    if not settings.get("self_check", True):
        lines += _SELF_CHECK_OFF
    if not settings.get("teacher_notes", True):
        lines += _NOTES_OFF
    return lines


def _instruction(component: str, task_spec: dict[str, Any], outline: list[str],
                 audience_block: str = "") -> str:
    language = task_spec.get("language", "he")
    settings = task_spec.get(component) or {}
    rules = _COMPONENT_RULES[component].format(**{
        key: settings.get(key, "") for key in
        ("slide_count", "question_count", "block_count", "study_count")
    })
    # The level, as instructions rather than as an adjective, and among the
    # rules the model is meant to follow rather than among the facts it is meant
    # to use. Before `_RETURN`, which is deliberately the last thing it reads.
    # A test has no hints, so that line is dropped rather than contradicting the
    # component's own "no hints — this is a test".
    level = str(task_spec.get("difficulty") or "medium").lower()
    if level not in _DIFFICULTY:
        level = "medium"

    if component == "presentation":
        rules += _DIFFICULTY_SLIDES[level]
        rules += _deck_settings(settings)
    elif component in ("practice", "test"):
        block = _DIFFICULTY[level]
        if component == "test":
            block = "\n".join(line for line in block.splitlines()
                               if not line.startswith("- Hints"))
        rules += block
        rules += _QUESTION_RULES.format(question_count=settings.get("question_count", 8))
        rules += _RETURN[component]

    grounding = ""
    if outline:
        grounding = (
            "\nThe presentation in this same task taught exactly these points. Write "
            "questions about THESE, not about the topic in general:\n"
            + "\n".join(f"  - {point}" for point in outline[:20]) + "\n"
        )

    return f"""{_FRAMING.get(language, _FRAMING['he'])}

Task: {task_spec.get('title')}
Topic: {task_spec.get('topic')}
Subject: {task_spec.get('subject') or 'unspecified'}
Year group: {task_spec.get('grade') or 'middle school'}
Teacher's notes: {task_spec.get('notes') or 'none'}
{audience_block}{source_grounding(task_spec, language)}{grounding}{_MATH_RULES}{rules}
Write all content in {language}. Return JSON only."""


# ── safety ───────────────────────────────────────────────────────────────────

def _screen_segments(segments: Any, language: str) -> Any:
    """PII out of generated prose, without mangling the maths.

    Text segments go through the full screen. Math segments deliberately do
    NOT: `strip_pii` redacts any run of seven or more digits, which is a phone
    number in a sentence and a perfectly ordinary quantity in a place-value
    lesson. A math value containing an address or a link is not maths at all,
    so that segment is dropped rather than redacted.
    """
    from app.agents import safety

    if not isinstance(segments, list):
        return segments
    out = []
    for segment in segments:
        if not isinstance(segment, dict):
            continue
        if segment.get("type") == "math":
            value = str(segment.get("value") or "")
            if "@" in value or "://" in value:
                continue
            out.append(segment)
            continue
        text = safety.screen_output(str(segment.get("text") or ""), language).text
        if text:
            out.append({"type": "text", "text": text})
    return out


def _screen_deep(value: Any, language: str) -> Any:
    """Walk generated content, screening every segment array it contains.

    Segment arrays ONLY. Bare strings are left alone deliberately: in this
    vocabulary every learner-visible sentence is a segment array, so the
    remaining scalars are ids, layout names, image urls, a `big_number` value
    and the `accept` list of a fill-in answer. Screening those would redact any
    run of seven digits — turning the answer key of a place-value question, and
    the one number a `big_number` slide exists to show, into `[הוסר]`.
    """
    if isinstance(value, list):
        if value and all(isinstance(item, dict) and item.get("type") in ("text", "math")
                         for item in value):
            return _screen_segments(value, language)
        return [_screen_deep(item, language) for item in value]
    if isinstance(value, dict):
        return {key: _screen_deep(item, language) for key, item in value.items()}
    return value


# ── one component ────────────────────────────────────────────────────────────

#: How the teacher's revision request is put to the model. Deliberately says
#: "return the WHOLE component": a diff would have to be applied by us, and a
#: partial payload that looks like a whole one is how a ten-question set
#: silently becomes a one-question set.
_REVISE_RULES = """
You are REVISING content that already exists, not writing it from scratch.

Here is the current content, in the exact vocabulary you must return:
{existing}

{focus}
Rules for a revision:
- Return the COMPLETE component, in the same shape and the same JSON schema.
- Change ONLY what the teacher's instruction asks for. Everything else comes
  back byte-for-byte as it is above — same ids, same order, same wording.
- Keep the same number of items unless the instruction asks for a different
  number.
- The teacher's instruction is the last line of the notes above.
"""


def _focus_line(focus: Optional[dict[str, Any]]) -> str:
    """Point at one item, when the teacher is fixing one thing.

    Numbered from 1 in the sentence the model reads, because that is how the
    teacher was looking at it on screen when they clicked.
    """
    if not focus:
        return ""
    slide = focus.get("slide_index")
    question = focus.get("question_index")
    if isinstance(slide, int) and slide >= 0:
        return (f"The instruction is about SLIDE {slide + 1} only. Every other "
                f"slide comes back unchanged.\n")
    if isinstance(question, int) and question >= 0:
        return (f"The instruction is about QUESTION {question + 1} only. Every "
                f"other question comes back unchanged.\n")
    return ""


async def _call(component: str, task_id: str, task_spec: dict[str, Any],
                outline: list[str], *,
                existing: Optional[dict[str, Any]] = None,
                focus: Optional[dict[str, Any]] = None,
                audience_block: str = "") -> Any:
    import json

    from app.services.llm import call_llm

    instruction = _instruction(component, task_spec, outline, audience_block)
    if existing:
        instruction += _REVISE_RULES.format(
            existing=json.dumps(existing, ensure_ascii=False)[:12000],
            focus=_focus_line(focus),
        )
    raw = await call_llm(
        [{"role": "user", "content": instruction}],
        usage_context=_usage(task_id, component),
        max_tokens=4000, json_mode=True, model_tier="strong",
        # A 4000-token strong-tier completion routinely outlives the client's
        # 30s default; the old default is why components died as
        # "unparseable_response" (really a ReadTimeout) — #tsk-d6585dd6eec7.
        timeout=180,
    )
    return spec_module.loads_model_json(raw)


async def _add_visuals(slides: list[dict[str, Any]], language: str,
                       usage: UsageContext) -> None:
    """Render up to `MAX_VISUALS` diagrams, in place. Failure is never fatal.

    Routed through `render_visual`, not the Manim renderer directly, so a
    planner that decides a still image is right still gets the in-browser path
    instead of a forced video — the same reason the explainer does it this way.

    Concurrent, because they are independent: planning is a model call per
    slide, and eight of them in a row is eight round trips a teacher waits
    through in series for no reason. A slide that already carries a rendered
    visual is skipped — that is the edit path, where the picture survives and
    only the words changed.
    """
    pending = [slide for slide in slides
               if slide.get("visual_hint") and not slide.get("visual")][:MAX_VISUALS]
    if not pending:
        return  # nothing to plan, and the Manim module is expensive to import

    from app.agents.manim_visual import plan_manim_visual, render_visual
    from app.agents import safety

    async def draw(slide: dict[str, Any]) -> None:
        hint = slide.pop("visual_hint", "")
        try:
            scene = await plan_manim_visual(
                hint, spec_module.segments_to_text(slide.get("body")), language, usage,
                text_filter=lambda text: safety.screen_output(text, language).text,
            )
            if scene:
                slide["visual"] = await render_visual(scene)
        except Exception as exc:  # a missing diagram must not cost the deck
            print(f"⚠️ task visual render failed: {type(exc).__name__}: {exc}")

    await asyncio.gather(*(draw(slide) for slide in pending))

    # Anything over the budget keeps its words and loses its hint, so a later
    # edit does not quietly re-open the same bill.
    for slide in slides:
        slide.pop("visual_hint", None)


async def _add_topic_art(slides: list[dict[str, Any]], task_spec: dict[str, Any]) -> None:
    """The opening slide gets the topic's illustration, if we have drawn one.

    From the hand-authored library — the same assets the dashboard hero uses,
    served inert and same-origin from `/api/learning/illustrations`. Not a stock
    photograph and not a generated image: a photograph of a laboratory teaches
    nothing about THIS lesson, and a generated one is a cost, a moderation
    surface and a picture that does not look like this product.

    Chosen by keyword from the objective and the subject — `find_for_lesson`
    never returns None, so `default` is filtered out here rather than opening a
    deck about triangles with a generic mascot.
    """
    if not slides or slides[0].get("layout") != "title" or slides[0].get("image_url"):
        return
    try:
        from app.services import lesson_illustrations

        objective = str(task_spec.get("objective_id") or task_spec.get("title") or "")
        subject = str(task_spec.get("subject") or "")
        asset = await lesson_illustrations.find_for_lesson(objective, subject)
        if asset and asset.get("_id") and asset["_id"] != "lib-default":
            slides[0]["image_url"] = f"/api/learning/illustrations/{asset['_id']}.svg"
    except Exception as exc:  # art is never worth failing a deck over
        print(f"⚠️ topic art not attached: {type(exc).__name__}: {exc}")


async def audience_block_for(task_id: str, task_spec: dict[str, Any]) -> str:
    """The prompt's "who this is for" section, or "" when nobody was named.

    Failure is swallowed on purpose. This is context that makes a task sharper;
    it is not the task. A brain that will not load must not cost a teacher the
    worksheet they asked for — they get the generic one, which is exactly what
    they got before this existed.
    """
    learner_ids = ((task_spec.get("audience") or {}).get("learner_ids") or [])
    if not learner_ids:
        return ""
    try:
        from app.services import kata_catalog
        from app.services.tasks import audience as audience_module

        task = await store.get_task(task_id) or {}
        source = task_spec.get("source") or {}
        objective_id = source.get("objective_id")
        brief = await audience_module.audience_brief(
            list(learner_ids),
            group_id=task.get("group_id"),
            objective_id=objective_id,
            component_id=source.get("component_id"),
            language=task_spec.get("language", "he"),
        )
        return audience_module.render(
            brief, kata_catalog.objective_title(objective_id,
                                                task_spec.get("language", "he")))
    except Exception as exc:
        print(f"⚠️ audience block failed for {task_id}: {type(exc).__name__}: {exc}")
        return ""


async def generate_component(
    task_id: str, component: str, task_spec: dict[str, Any],
    *, outline: Optional[list[str]] = None,
    existing: Optional[dict[str, Any]] = None,
    focus: Optional[dict[str, Any]] = None,
    audience_block: Optional[str] = None,
) -> dict[str, Any]:
    """Generate and store one component. Raises on a payload nothing survives.

    With `existing`, this is a REVISION: the current content goes into the
    prompt and the model is asked to return the whole component with the
    teacher's one change applied. `focus` narrows that to a single slide or
    question. Both are `None` on a first generation, which is byte-identical to
    what it was before revision existed.
    """
    language = task_spec.get("language", "he")
    # Computed once per RUN by `generate_task` and handed down, because it fans
    # out over the audience's brains and three components would otherwise pay
    # for it three times. A revision calls this directly and gets its own.
    if audience_block is None:
        audience_block = await audience_block_for(task_id, task_spec)
    payload = await _call(component, task_id, task_spec, outline or [],
                          existing=existing, focus=focus,
                          audience_block=audience_block)
    if payload is None:
        # One more try before giving up: a null payload here is almost always
        # transient (gateway hiccup, timeout), and the alternative is a task
        # that ships missing a whole component with no retry in the UI.
        payload = await _call(component, task_id, task_spec, outline or [],
                              existing=existing, focus=focus,
                              audience_block=audience_block)
    if payload is None:
        raise spec_module.SpecError("unparseable_response")

    if component == "presentation":
        slides = spec_module.normalize_slides(payload)
        if len(slides) < spec_module.MIN_SLIDES:
            raise spec_module.SpecError("too_few_slides")
        slides = _screen_deep(slides, language)
        settings = task_spec.get("presentation") or {}
        if settings.get("diagrams", True):
            await _add_visuals(slides, language, _usage(task_id, component))
        else:
            # Asked for none. A model that writes a hint anyway does not get a
            # render, and the hint does not linger to be picked up by an edit.
            for slide in slides:
                slide.pop("visual_hint", None)
        if not settings.get("teacher_notes", True):
            for slide in slides:
                slide.pop("notes", None)
        await _add_topic_art(slides, task_spec)
        content: dict[str, Any] = {"slides": slides}

    elif component == "interactive":
        blocks = _screen_deep(spec_module.normalize_blocks(payload), language)
        if not blocks:
            raise spec_module.SpecError("no_usable_blocks")
        content = {"blocks": blocks}

    else:
        questions = spec_module.normalize_questions(payload)
        if not questions:
            raise spec_module.SpecError("no_usable_questions")
        content = {"questions": _screen_deep(questions, language)}
        if component == "practice":
            # The one thing the old `interactive` part had that practice did
            # not. Its scored widgets were practice questions wearing a widget
            # name, so they came home rather than being kept in a fourth part a
            # teacher had to choose between.
            study = spec_module.normalize_study(payload)
            if study:
                content["study"] = _screen_deep(study, language)
        if component == "test":
            settings = task_spec.get("test") or {}
            content["time_limit_minutes"] = settings.get("time_limit_minutes")
            content["passing_grade"] = settings.get("passing_grade")
            content["show_answers_after"] = settings.get("show_answers_after")
            content["retries"] = settings.get("retries")

    await store.put_content(task_id, component, content)
    return content


def outline_of(content: dict[str, Any]) -> list[str]:
    """The points a deck actually made, for grounding the questions."""
    points: list[str] = []
    for slide in content.get("slides") or []:
        points.extend(str(point) for point in (slide.get("key_points") or []))
    return points


# ── the whole task ───────────────────────────────────────────────────────────

#: Presentation first: its outline grounds everything after it.
_ORDER = ("presentation", "practice", "test", "interactive")


async def generate_task(task_id: str) -> dict[str, Any]:
    """Every component the spec asks for, in order, logging each pass.

    A component that fails is recorded and skipped rather than aborting the
    run: a task with a working practice set and no deck is still a task a
    teacher can send, and the generation log says what is missing and why.
    """
    task = await store.get_task(task_id)
    if task is None:
        raise store.TaskStoreError("not_found")

    task_spec = task.get("spec") or {}
    await store.update_task(task_id, status="generating")

    # Once per run, before the loop: every component is written for the same
    # children.
    audience_block = await audience_block_for(task_id, task_spec)

    outline: list[str] = []
    produced = 0
    for component in _ORDER:
        if component not in (task_spec.get("components") or []):
            continue
        try:
            content = await generate_component(
                task_id, component, task_spec, outline=outline,
                audience_block=audience_block,
            )
            if component == "presentation":
                outline = outline_of(content)
            produced += 1
            await store.record_generation(task_id, component=component, ok=True)
        except Exception as exc:
            print(f"⚠️ task {task_id} component {component} failed: {type(exc).__name__}: {exc}")
            await store.record_generation(
                task_id, component=component, ok=False,
                detail=f"{type(exc).__name__}: {exc}",
            )

    status = "ready" if produced else "draft"
    updated = await store.update_task(task_id, status=status)

    # Measured before a human looks at it, and never gating the result.
    # Everything above this line asks whether the content is renderable; this
    # asks whether it is the task the teacher described, which is the question
    # the review screen exists to answer and had nothing to answer it with.
    if produced:
        from app.services.tasks import quality
        try:
            await quality.review(task_id)
            updated = await store.get_task(task_id) or updated
        except Exception as exc:  # a check must never cost the content
            print(f"⚠️ quality review failed for {task_id}: {type(exc).__name__}: {exc}")

    return updated or {}


async def get_or_start(task_id: str) -> dict[str, Any]:
    """The task's state, starting generation if it has not run.

    The client polls this. A task already generating returns `generating`
    without starting a second run — the in-flight registry is what makes a
    reloaded builder page harmless.
    """
    task = await store.get_task(task_id)
    if task is None:
        return {"status": "not_found"}

    running = _tasks.get(task_id)
    if running and not running.done():
        return {"status": "generating", "task": task}
    if task.get("status") in ("ready", "live", "closed"):
        return {"status": task["status"], "task": task,
                "content": await store.all_content(task_id)}

    async def _run() -> None:
        try:
            await generate_task(task_id)
        except Exception as exc:
            print(f"⚠️ task generation failed: {type(exc).__name__}: {exc}")
            await store.update_task(task_id, status="draft")
        finally:
            _tasks.pop(task_id, None)

    _tasks[task_id] = asyncio.create_task(_run())
    return {"status": "generating", "task": task}
