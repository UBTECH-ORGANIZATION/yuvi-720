"""One question vocabulary, and the layer that forces model output into it.

The reference implementation this borrows from ended up with **two** divergent
vocabularies for the same eight question types — `correct_index` beside
`correct_answer`, `matching` beside `match_pairs`, `left_items` beside
`side_a_items` — plus a client-side normalizer documenting fifteen field-name
variants the model produced anyway. Every one of those is a place where a
question scores as wrong because the scorer looked for a key the generator did
not write.

So: one vocabulary, defined here, and the normalizer written on day one rather
than after the drift. Nothing downstream ever reads a raw model payload.

## The vocabulary

    {
      "id": "q1",
      "type": "mcq",
      "prompt":  [segment, ...],          # ALWAYS segments, never a sentence
      "options": [[segment, ...], ...],   # choice-shaped types only
      "answer":  {...},                   # one shape per type, below
      "explanation": [segment, ...],
      "hint":    [segment, ...],
      "difficulty": "easy" | "medium" | "hard",
      "weight":  1.0
    }

`answer` by type — one key each, no aliases:

    mcq · image_mcq   {"index": 2}
    true_false        {"value": true}
    multiple_correct  {"indices": [0, 3]}
    fill_blank        {"blanks": [{"accept": ["12", "12.0"], "format": {...}}]}
    matching          {"pairs": [[0, 2], [1, 0]]}
    ordering          {"order": [2, 0, 1]}
    open_ended        {"rubric": [{"criterion": "...", "weight": 1}]}

## Why every text field is a segment array

You cannot put Hebrew and math in the same string — see `mathSegments.tsx` for
the rendering half. The contract starts here: a field that can contain math is
a list of `{"type": "text"}` and `{"type": "math"}` parts, so the renderer never
has to guess where a formula begins inside a Hebrew sentence.

A model will still hand back a plain string sometimes. `_segments` accepts one
and wraps it, rather than rejecting the question — a sentence that renders with
heuristics beats a missing question.
"""

from __future__ import annotations

import json
import re
from typing import Any, Optional

QUESTION_TYPES = (
    "mcq", "true_false", "fill_blank", "matching",
    "ordering", "open_ended", "image_mcq", "multiple_correct",
)

DIFFICULTIES = ("easy", "medium", "hard")

#: Types whose answer indexes into `options`.
CHOICE_TYPES = ("mcq", "image_mcq", "multiple_correct")

MAX_OPTIONS = 8
MAX_QUESTIONS = 30
MAX_TEXT = 600


class SpecError(Exception):
    """A payload that could not be repaired into the vocabulary."""


# ── lenient JSON ─────────────────────────────────────────────────────────────
# `json_mode=True` asks for JSON; it does not guarantee it. Every repair below
# corresponds to a real way a model breaks the contract, and each one costs a
# whole generation pass — several seconds and a paid call — if it is not made.

_FENCE = re.compile(r"```(?:json)?\s*(.+?)\s*```", re.S)


def loads_model_json(raw: Any) -> Any:
    """Parse model output that is *almost* JSON.

    Strict parse first, so a well-formed payload never goes near the repairs.
    Then, in order: unwrap a ``` fence, take the outermost brace-or-bracket
    span (models prepend "Here is the JSON:"), drop trailing commas, and escape
    the raw newlines that appear inside a long Hebrew explanation string.

    Returns `None` when nothing survives — the caller decides whether a failed
    parse is fatal, because for a batch of questions it usually is not.
    """
    if raw is None:
        return None
    if isinstance(raw, (dict, list)):
        return raw
    text = str(raw).strip()
    if not text:
        return None

    try:
        return json.loads(text)
    except (ValueError, TypeError):
        pass

    fenced = _FENCE.search(text)
    if fenced:
        text = fenced.group(1).strip()

    start = min((position for position in (text.find("{"), text.find("[")) if position >= 0),
                default=-1)
    end = max(text.rfind("}"), text.rfind("]"))
    if 0 <= start < end:
        text = text[start:end + 1]

    for repair in (lambda value: value,
                   _strip_trailing_commas,
                   lambda value: _escape_raw_newlines(_strip_trailing_commas(value))):
        try:
            return json.loads(repair(text))
        except (ValueError, TypeError):
            continue
    return None


def _strip_trailing_commas(text: str) -> str:
    return re.sub(r",(\s*[}\]])", r"\1", text)


def _escape_raw_newlines(text: str) -> str:
    """Escape newlines that fall *inside* a string literal, leaving structure.

    A blanket replace would flatten the whole document onto one line, which
    parses but also destroys the indentation-based repairs above it. So this
    tracks whether it is inside a quote, honouring backslash escapes.
    """
    out: list[str] = []
    in_string = False
    escaped = False
    for char in text:
        if escaped:
            out.append(char)
            escaped = False
            continue
        if char == "\\":
            out.append(char)
            escaped = True
            continue
        if char == '"':
            in_string = not in_string
            out.append(char)
            continue
        if in_string and char in "\n\r\t":
            out.append({"\n": "\\n", "\r": "\\r", "\t": "\\t"}[char])
            continue
        out.append(char)
    return "".join(out)


# ── the math sanitizer ───────────────────────────────────────────────────────
# Defence in depth. The prompt forbids LaTeX outright, and this runs anyway,
# because "the model was told not to" has never been a guarantee. Everything
# becomes plain text with Unicode operators, which is what the renderer expects
# and what keeps a formula legible inside an RTL paragraph.

_SUPERSCRIPT = {"0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴",
                "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹"}

_COMMANDS = "frac|dfrac|tfrac|sqrt|times|div|cdot|pm|mp|pi|text|left|right"


def sanitize_math(text: str) -> str:
    r"""LaTeX in, plain text out.

    `\frac{a}{b}` → `a/b`, `\sqrt[n]{x}` → `ⁿ√x`, `x^{2}` → `x²`, and the
    `$…$` delimiters go. Double-escaped backslashes are handled first: a
    payload that survives a JSON round trip arrives as `\\frac`, and treating
    that as an unknown command would silently delete the fraction.
    """
    if not isinstance(text, str) or not text:
        return text if isinstance(text, str) else ""

    value = re.sub(r"\\\\(" + _COMMANDS + r")", r"\\\1", text)
    value = value.replace(r"\$", "$")

    def _fraction(match: re.Match) -> str:
        whole, numerator, denominator = match.group(1), match.group(2), match.group(3)
        # A mixed number: "2\frac{1}{4}" is two and a quarter, not 2 × (1/4).
        if whole and whole.strip():
            return f"{whole.strip()} {numerator}/{denominator}"
        return f"{numerator}/{denominator}"

    value = re.sub(r"(\d*)\s*\\(?:d?frac|tfrac)\s*\{([^}]*)\}\s*\{([^}]*)\}", _fraction, value)
    value = re.sub(r"\\sqrt\[(\d+)\]\{([^}]*)\}", r"\1√\2", value)
    value = re.sub(r"\\sqrt\{([^}]*)\}", r"√\1", value)

    for command, symbol in (("times", "×"), ("div", "÷"), ("cdot", "·"),
                            ("pm", "±"), ("mp", "∓"), ("pi", "π")):
        value = value.replace(f"\\{command}", symbol)

    def _superscript(match: re.Match) -> str:
        base, exponent = match.group(1), match.group(2)
        return base + "".join(_SUPERSCRIPT.get(char, char) for char in exponent)

    value = re.sub(r"(\w)\^\{(\d+)\}", _superscript, value)
    value = re.sub(r"(\w)\^(\d)", _superscript, value)

    value = re.sub(r"\\text\{([^}]*)\}", r"\1", value)
    value = value.replace("\\left", "").replace("\\right", "")
    value = re.sub(r"\$\$(.+?)\$\$", r"\1", value, flags=re.S)
    value = re.sub(r"\$(.+?)\$", r"\1", value)
    # Anything still commanding is a command we do not implement; dropping the
    # backslash leaves the word, which reads better than a stray control.
    value = re.sub(r"\\([a-zA-Z]+)", r"\1", value)
    value = value.replace("{", "").replace("}", "")
    return re.sub(r"[ \t]+", " ", value).strip()


# ── segments ─────────────────────────────────────────────────────────────────

def _segment(raw: Any) -> Optional[dict[str, Any]]:
    if isinstance(raw, str):
        cleaned = sanitize_math(raw)
        return {"type": "text", "text": cleaned[:MAX_TEXT]} if cleaned else None
    if not isinstance(raw, dict):
        return None

    kind = str(raw.get("type") or "text")
    if kind == "math":
        value = sanitize_math(str(raw.get("value") or raw.get("text") or ""))
        if not value:
            return None
        punctuation = str(raw.get("punctuation") or "")[:4]
        return {"type": "math", "value": value[:MAX_TEXT], "punctuation": punctuation}

    text = sanitize_math(str(raw.get("text") or raw.get("value") or ""))
    return {"type": "text", "text": text[:MAX_TEXT]} if text else None


def _segments(raw: Any) -> list[dict[str, Any]]:
    """Anything the model wrote for a text field, as segments.

    A bare string is wrapped rather than rejected: the renderer's heuristics
    handle a mixed sentence acceptably, and a dropped question is worse than an
    imperfectly-split one.
    """
    if raw is None:
        return []
    if isinstance(raw, str):
        segment = _segment(raw)
        return [segment] if segment else []
    if isinstance(raw, dict):
        # `{"text": [...]}` and `{"segments": [...]}` both appear in the wild.
        for key in ("segments", "parts", "content", "text"):
            if isinstance(raw.get(key), list):
                return _segments(raw[key])
        segment = _segment(raw)
        return [segment] if segment else []
    if isinstance(raw, list):
        return [segment for segment in (_segment(item) for item in raw) if segment]
    return []


def segments_to_text(segments: Any) -> str:
    """A plain-text rendering, for search, logs and the teacher's export."""
    parts = []
    for segment in _segments(segments):
        if segment["type"] == "math":
            parts.append(segment["value"] + segment.get("punctuation", ""))
        else:
            parts.append(segment["text"])
    return " ".join(part for part in parts if part).strip()


# ── the normalizer ───────────────────────────────────────────────────────────
# Every alias below was observed in the reference implementation's own data or
# its client-side repair layer. They are handled here, once, so that no scorer
# and no renderer anywhere has to know that `choices` and `options` are the same
# thing.

_PROMPT_KEYS = ("prompt", "question", "question_text", "text", "stem", "title")
_OPTION_KEYS = ("options", "choices", "answers", "left_items", "side_a_items")
_EXPLANATION_KEYS = ("explanation", "rationale", "why", "feedback")
_HINT_KEYS = ("hint", "tip", "clue")

_TYPE_ALIASES = {
    "match_pairs": "matching", "match": "matching", "pairs": "matching",
    "order": "ordering", "sort": "ordering", "sequence": "ordering",
    "multi_select": "multiple_correct", "multiple_choice_multi": "multiple_correct",
    "multiselect": "multiple_correct", "checkbox": "multiple_correct",
    "single_choice": "mcq", "multiple_choice": "mcq", "choice": "mcq",
    "boolean": "true_false", "truefalse": "true_false", "yes_no": "true_false",
    "cloze": "fill_blank", "blank": "fill_blank", "fill_in_the_blank": "fill_blank",
    "free_text": "open_ended", "essay": "open_ended", "long_answer": "open_ended",
    "image_choice": "image_mcq", "picture_mcq": "image_mcq",
}


def _first(source: dict[str, Any], keys: tuple[str, ...]) -> Any:
    for key in keys:
        if source.get(key) not in (None, "", []):
            return source[key]
    return None


def _int_list(raw: Any) -> list[int]:
    values = raw if isinstance(raw, list) else [raw]
    out = []
    for value in values:
        try:
            out.append(int(value))
        except (TypeError, ValueError):
            continue
    return out


def _as_bool(raw: Any) -> Optional[bool]:
    if isinstance(raw, bool):
        return raw
    if isinstance(raw, str):
        lowered = raw.strip().lower()
        if lowered in ("true", "yes", "נכון", "صحيح"):
            return True
        if lowered in ("false", "no", "לא נכון", "خطأ"):
            return False
    return None


#: A blank's name is a label, not a sentence. Long enough for "מכנה" or
#: "units", short enough that it cannot become the question.
MAX_BLANK_LABEL = 24


def _blank_label(value: Any) -> Optional[str]:
    """The short name of one blank — ``x``, ``y``, ``מונה`` — or None.

    Trimmed to a word or two on purpose: a model given a free field here will
    happily return "the x coordinate of the point", which then renders in
    front of the box and repeats the question a second time.
    """
    text = " ".join(str(value or "").split())
    if not text or len(text) > MAX_BLANK_LABEL:
        return None
    return sanitize_math(text)


def _answer_for(kind: str, raw: dict[str, Any], options: list) -> dict[str, Any]:
    """The one answer shape for this type, from whichever key the model used."""
    given = raw.get("answer") if isinstance(raw.get("answer"), dict) else {}

    if kind in ("mcq", "image_mcq"):
        index = given.get("index")
        if index is None:
            # `correct_answer` appears here too, holding the option's *text*
            # rather than its position — resolved against the options below.
            index = _first(raw, ("correct_index", "correct_option", "correct",
                                 "answer_index", "correct_answer"))
        # Some payloads name the option instead of indexing it.
        if isinstance(index, str) and options:
            texts = [segments_to_text(option) for option in options]
            match = sanitize_math(index)
            index = texts.index(match) if match in texts else None
        try:
            return {"index": int(index)}
        except (TypeError, ValueError):
            return {"index": None}

    if kind == "true_false":
        value = given.get("value")
        if value is None:
            value = _first(raw, ("correct_answer", "correct", "answer_value", "is_true"))
        return {"value": _as_bool(value)}

    if kind == "multiple_correct":
        indices = given.get("indices")
        if indices is None:
            indices = _first(raw, ("correct_indices", "correct_options", "correct_answers"))
        return {"indices": sorted(set(_int_list(indices)))}

    if kind == "ordering":
        order = given.get("order")
        if order is None:
            order = _first(raw, ("correct_order", "order", "sequence"))
        return {"order": _int_list(order)}

    if kind == "matching":
        pairs = given.get("pairs")
        if pairs is None:
            pairs = _first(raw, ("correct_pairs", "pairs", "matches"))
        cleaned = []
        for pair in pairs if isinstance(pairs, list) else []:
            values = _int_list(pair if isinstance(pair, list) else
                               [pair.get("left"), pair.get("right")]
                               if isinstance(pair, dict) else [])
            if len(values) == 2:
                cleaned.append(values)
        return {"pairs": cleaned}

    if kind == "fill_blank":
        blanks = given.get("blanks")
        if not isinstance(blanks, list) or not blanks:
            accepted = _first(raw, ("correct_answers", "correct_answer", "answers", "accept"))
            values = accepted if isinstance(accepted, list) else [accepted]
            extra = raw.get("accept") if isinstance(raw.get("accept"), list) else []
            blanks = [{"accept": [str(value) for value in values if value not in (None, "")]
                                 + [str(value) for value in extra]}]
        normalized = []
        for blank in blanks:
            if isinstance(blank, str):
                blank = {"accept": [blank]}
            if not isinstance(blank, dict):
                continue
            accept = blank.get("accept")
            accept = accept if isinstance(accept, list) else [accept]
            normalized.append({
                "accept": [sanitize_math(str(value)) for value in accept
                           if value not in (None, "")],
                # Fraction-aware matching, so a child typing "2 5/12" is right
                # whatever notation the generator chose.
                "format": blank.get("format") if isinstance(blank.get("format"), dict) else None,
                # What this blank IS, when it has a name — "x", "y", "מונה",
                # "יחידות". Rendered as `x =` in front of the box. Two bare
                # boxes for the coordinates of a point are two boxes a child
                # can fill in the wrong order without ever being told which
                # was which. Optional: most blanks are just a gap in a sentence.
                "label": _blank_label(blank.get("label")),
            })
        return {"blanks": [blank for blank in normalized if blank["accept"]]}

    # open_ended
    rubric = given.get("rubric")
    if not isinstance(rubric, list) or not rubric:
        rubric = raw.get("rubric") if isinstance(raw.get("rubric"), list) else []
    cleaned = []
    for item in rubric:
        if isinstance(item, str):
            item = {"criterion": item}
        if not isinstance(item, dict):
            continue
        criterion = sanitize_math(str(item.get("criterion") or item.get("text") or ""))
        if criterion:
            try:
                weight = float(item.get("weight", 1))
            except (TypeError, ValueError):
                weight = 1.0
            cleaned.append({"criterion": criterion[:MAX_TEXT], "weight": max(0.0, weight)})
    return {"rubric": cleaned}


def normalize_question(raw: Any, index: int) -> Optional[dict[str, Any]]:
    """One model-authored question, in the vocabulary — or None if unusable."""
    if not isinstance(raw, dict):
        return None

    kind = str(raw.get("type") or raw.get("question_type") or "mcq").strip().lower()
    kind = _TYPE_ALIASES.get(kind, kind)
    if kind not in QUESTION_TYPES:
        return None

    prompt = _segments(_first(raw, _PROMPT_KEYS)
                       or raw.get("prompt_content") or raw.get("question_content"))
    if not prompt:
        return None

    options: list[list[dict[str, Any]]] = []
    if kind in CHOICE_TYPES or kind in ("matching", "ordering"):
        source = _first(raw, _OPTION_KEYS) or []
        options = [_segments(option) for option in
                   (source if isinstance(source, list) else [])][:MAX_OPTIONS]
        options = [option for option in options if option]

    question: dict[str, Any] = {
        "id": str(raw.get("id") or f"q{index + 1}"),
        "type": kind,
        "prompt": prompt,
        "answer": _answer_for(kind, raw, options),
        "explanation": _segments(_first(raw, _EXPLANATION_KEYS)),
        "hint": _segments(_first(raw, _HINT_KEYS)),
        "difficulty": (str(raw.get("difficulty") or "medium").lower()
                       if str(raw.get("difficulty") or "medium").lower() in DIFFICULTIES
                       else "medium"),
    }
    if options:
        question["options"] = options

    # `matching` needs a right-hand column as well as a left one.
    if kind == "matching":
        right = _first(raw, ("right_items", "side_b_items", "targets", "matches_options"))
        question["targets"] = [_segments(item) for item in (right if isinstance(right, list) else [])]
        question["targets"] = [item for item in question["targets"] if item]

    if kind == "image_mcq":
        question["image_url"] = str(raw.get("image_url") or raw.get("image") or "")[:500]

    try:
        weight = float(raw.get("weight", 1))
    except (TypeError, ValueError):
        weight = 1.0
    question["weight"] = weight if weight > 0 else 1.0

    return question if _is_answerable(question) else None


def _is_answerable(question: dict[str, Any]) -> bool:
    """A question nobody can get right is worse than no question at all.

    This is the gate that stops a half-generated payload reaching a child: an
    mcq whose `index` is null renders four options of which none is correct, and
    the learner is marked wrong whatever they press.
    """
    kind, answer = question["type"], question["answer"]
    options = question.get("options") or []

    if kind in ("mcq", "image_mcq"):
        index = answer.get("index")
        return isinstance(index, int) and 0 <= index < len(options) and len(options) >= 2
    if kind == "true_false":
        return isinstance(answer.get("value"), bool)
    if kind == "multiple_correct":
        indices = answer.get("indices") or []
        return bool(indices) and all(0 <= i < len(options) for i in indices) and len(options) >= 2
    if kind == "ordering":
        order = answer.get("order") or []
        return len(order) >= 2 and sorted(order) == list(range(len(options))) and bool(options)
    if kind == "matching":
        pairs = answer.get("pairs") or []
        targets = question.get("targets") or []
        return bool(pairs) and bool(options) and bool(targets) and all(
            0 <= left < len(options) and 0 <= right < len(targets) for left, right in pairs
        )
    if kind == "fill_blank":
        return bool(answer.get("blanks"))
    return bool(answer.get("rubric"))


def normalize_questions(raw: Any) -> list[dict[str, Any]]:
    """A model's question list, cleaned. Unusable entries are dropped, not raised.

    Partial output is the common failure, and eight good questions beat a
    rejected batch of ten.
    """
    source = raw
    if isinstance(raw, dict):
        for key in ("questions", "items", "data"):
            if isinstance(raw.get(key), list):
                source = raw[key]
                break
    if not isinstance(source, list):
        return []

    questions = []
    seen: set[str] = set()
    for index, item in enumerate(source[:MAX_QUESTIONS]):
        question = normalize_question(item, index)
        if question is None:
            continue
        # Ids collide when a model numbers every batch from one; the player keys
        # answers by id, so a duplicate would overwrite a real answer.
        if question["id"] in seen:
            question["id"] = f"{question['id']}-{index + 1}"
        seen.add(question["id"])
        questions.append(question)
    return questions


# ── slides ───────────────────────────────────────────────────────────────────
# A *core* set of layouts, not the reference's twenty-one. Each one has to earn
# a React component, a responsive rule and an RTL check; nine that are always
# right beat twenty-one where the long tail renders badly and nobody notices.

SLIDE_LAYOUTS = (
    "title", "text", "text_image", "bullets", "big_number",
    "compare", "timeline", "fact", "summary",
    # Three that earned their place after the first round shipped:
    #   reveal    — the deck's only "do something" moment, without being a quiz
    #   fact_grid — what `bullets` kept trying to be when it had four short ideas
    #   quote     — one sentence at the size it deserves
    "reveal", "fact_grid", "quote",
)

_LAYOUT_ALIASES = {
    "text-image": "text_image", "image_text": "text_image", "image": "text_image",
    "big-number": "big_number", "number": "big_number", "stat": "big_number",
    "list": "bullets", "points": "bullets", "bullet": "bullets",
    "comparison": "compare", "vs": "compare",
    "sequence": "timeline", "steps": "timeline", "process": "timeline",
    "definition": "fact", "note": "fact", "callout": "fact",
    "recap": "summary", "conclusion": "summary", "wrap_up": "summary",
    "intro": "title", "cover": "title",
    "click_reveal": "reveal", "click-reveal": "reveal", "flip": "reveal",
    "flashcards": "reveal", "cards": "reveal",
    "fact-grid": "fact_grid", "grid": "fact_grid", "tiles": "fact_grid",
    "quotation": "quote", "saying": "quote",
}

MAX_SLIDES = 15
MIN_SLIDES = 3
MAX_BULLETS = 6


def normalize_slide(raw: Any, index: int) -> Optional[dict[str, Any]]:
    """One slide, in the vocabulary — or None if it would render blank."""
    if not isinstance(raw, dict):
        return None

    layout = str(raw.get("layout") or raw.get("type") or "text").strip().lower()
    layout = _LAYOUT_ALIASES.get(layout, layout)
    if layout not in SLIDE_LAYOUTS:
        # An unknown layout is a rendering choice, not a content failure. Fall
        # back to `text` rather than dropping a slide that has real content.
        layout = "text"

    slide: dict[str, Any] = {
        "id": str(raw.get("id") or f"s{index + 1}"),
        "layout": layout,
        "title": _segments(_first(raw, ("title", "heading", "header"))),
        "body": _segments(_first(raw, ("body", "text", "content", "description"))),
    }

    bullets_raw = _first(raw, ("bullets", "points", "items", "list"))
    bullets = [_segments(item) for item in (bullets_raw if isinstance(bullets_raw, list) else [])]
    bullets = [bullet for bullet in bullets if bullet][:MAX_BULLETS]
    if bullets:
        slide["bullets"] = bullets

    if layout == "big_number":
        slide["value"] = sanitize_math(str(_first(raw, ("value", "number", "figure")) or ""))[:40]
        # Up to three figures side by side. "3 מתוך 4" is two numbers, and one
        # number per slide is what made a deck of statistics repeat itself.
        values = raw.get("values") if isinstance(raw.get("values"), list) else []
        figures = []
        for entry in values[:3]:
            if not isinstance(entry, dict):
                continue
            figure = sanitize_math(str(_first(entry, ("value", "number")) or ""))[:40]
            if figure:
                figures.append({"value": figure,
                                "caption": _segments(_first(entry, ("caption", "label")))})
        if figures:
            slide["values"] = figures
            slide["value"] = slide["value"] or figures[0]["value"]
    # Any layout may carry topic art; only the library may supply it. Checked on
    # every normalization rather than only where it is set, because this field
    # survives edits and a model that learns to write it must still be refused.
    art = _safe_illustration_url(raw.get("image_url") or raw.get("image"))
    if art:
        slide["image_url"] = art
    if layout in ("reveal", "fact_grid"):
        slide["cards"] = _slide_cards(raw)
    if layout == "compare":
        slide["sides"] = [
            {"label": _segments(side.get("label") or side.get("title")),
             "items": [item for item in
                       (_segments(entry) for entry in (side.get("items") or []))
                       if item][:MAX_BULLETS]}
            for side in (raw.get("sides") or [])[:2] if isinstance(side, dict)
        ]
    if layout == "timeline":
        slide["steps"] = [
            {"label": _segments(step.get("label") or step.get("title")),
             "body": _segments(step.get("body") or step.get("text"))}
            for step in (raw.get("steps") or raw.get("stages") or [])[:6]
            if isinstance(step, dict)
        ]

    # The lines a later component is grounded in, so questions come from what
    # the slides actually taught rather than from the topic in general.
    points = raw.get("key_points") if isinstance(raw.get("key_points"), list) else []
    slide["key_points"] = [sanitize_math(str(point))[:MAX_TEXT]
                           for point in points if str(point).strip()][:4]

    # What the teacher says while this slide is up. Never reaches a learner:
    # `attempts.learner_view` strips it, and the player only renders it in the
    # teacher's own preview.
    notes = str(raw.get("notes") or raw.get("speaker_notes") or "").strip()
    if notes:
        slide["notes"] = sanitize_math(notes)[:MAX_TEXT]

    visual = raw.get("visual") if isinstance(raw.get("visual"), dict) else {}
    hint = str(raw.get("visual_hint") or visual.get("hint") or "").strip()
    if hint:
        slide["visual_hint"] = hint[:300]

    # An ALREADY RENDERED diagram survives the round trip.
    #
    # It did not, and that was invisible: normalization reads a slide back off
    # the model on every save and every AI edit, and it kept only `visual.hint`
    # — so a teacher fixing a typo silently threw away every diagram in the
    # deck, and `_add_visuals` only re-drew the ones whose `visual_hint` the
    # model happened to write again. Rendering is the expensive half; a payload
    # that is already here is kept.
    if _is_rendered_visual(visual):
        slide["visual"] = visual
        slide.pop("visual_hint", None)      # it is drawn; do not draw it twice

    if not _slide_renders(slide):
        return None
    return slide


#: What `manim_visual.render_visual` returns, minimally identified. Checked
#: rather than trusted: `visual` also arrives as `{"hint": …}` from the model.
def _is_rendered_visual(visual: Any) -> bool:
    return (isinstance(visual, dict)
            and isinstance(visual.get("data_url"), str)
            and visual["data_url"].startswith("data:")
            and visual.get("type") in ("scene", "image", "video"))


MAX_CARDS = 6


def _slide_cards(raw: Any) -> list[dict[str, Any]]:
    """Tiles for `fact_grid`, flip cards for `reveal`.

    One shape for both: a front, a back, and an optional emoji. A grid tile
    simply shows both halves at once, which is why it is not two vocabularies.
    """
    source = raw.get("cards") or raw.get("tiles") or raw.get("items")
    cards: list[dict[str, Any]] = []
    for entry in (source if isinstance(source, list) else [])[:MAX_CARDS]:
        if not isinstance(entry, dict):
            continue
        front = _segments(_first(entry, ("front", "title", "term", "label", "heading")))
        back = _segments(_first(entry, ("back", "text", "definition", "body", "answer")))
        if not front and not back:
            continue
        card: dict[str, Any] = {"front": front, "back": back}
        # One character, and only if it IS one: a model asked for an emoji
        # sometimes writes a sentence, and a sentence in a 40px slot is a mess.
        emoji = str(entry.get("emoji") or "").strip()
        if emoji and len(emoji) <= 4:
            card["emoji"] = emoji
        cards.append(card)
    return cards


#: The only images a slide may carry: our own authored illustration library,
#: served same-origin, inert and CSP-locked from `/api/learning/illustrations`.
#: A model-supplied URL is a request from a child's browser to a third party —
#: it is not a rendering choice, and it is not the model's to make.
_ILLUSTRATION_PATH = re.compile(r"^/api/learning/illustrations/[A-Za-z0-9_-]+\.svg(\?motion=reduce)?$")


def _safe_illustration_url(value: Any) -> str:
    url = str(value or "").strip()[:200]
    return url if _ILLUSTRATION_PATH.match(url) else ""


def _slide_renders(slide: dict[str, Any]) -> bool:
    """A slide with a heading and nothing else is a blank screen with a hat on."""
    if slide["layout"] == "compare":
        return bool(slide.get("sides")) and len(slide["sides"]) == 2
    if slide["layout"] == "timeline":
        return bool(slide.get("steps"))
    if slide["layout"] == "big_number":
        return bool(slide.get("value"))
    if slide["layout"] in ("reveal", "fact_grid"):
        return len(slide.get("cards") or []) >= 2
    if slide["layout"] == "quote":
        return bool(slide.get("body"))
    return bool(slide.get("body") or slide.get("bullets"))


def normalize_slides(raw: Any) -> list[dict[str, Any]]:
    """A deck, cleaned, with a summary guaranteed as its last slide.

    The reference's prompt mandates a closing summary and its server
    re-synthesises one when the model forgets — which it does often enough that
    the re-synthesis is not a nicety. Both halves are kept here: the deck ends
    on a summary whether or not the model wrote one.
    """
    source = raw
    if isinstance(raw, dict):
        for key in ("slides", "deck", "presentation", "items"):
            if isinstance(raw.get(key), list):
                source = raw[key]
                break
    if not isinstance(source, list):
        return []

    slides: list[dict[str, Any]] = []
    seen: set[str] = set()
    for index, item in enumerate(source[:MAX_SLIDES]):
        slide = normalize_slide(item, index)
        if slide is None:
            continue
        if slide["id"] in seen:
            slide["id"] = f"{slide['id']}-{index + 1}"
        seen.add(slide["id"])
        slides.append(slide)

    if not slides:
        return []
    if slides[-1]["layout"] != "summary":
        slides.append(_synthesized_summary(slides))
    return slides


def _synthesized_summary(slides: list[dict[str, Any]]) -> dict[str, Any]:
    """A closing slide built from the deck's own key points — never new content.

    Nothing here is written, only selected: a summary that introduced an idea
    the lesson did not teach would be the one slide a child remembers.
    """
    bullets: list[list[dict[str, Any]]] = []
    for slide in slides:
        for point in slide.get("key_points") or []:
            segment = _segment(point)
            if segment and len(bullets) < MAX_BULLETS:
                bullets.append([segment])
    if not bullets:
        for slide in slides:
            if slide.get("title") and len(bullets) < MAX_BULLETS:
                bullets.append(slide["title"])
    return {
        "id": "s-summary",
        "layout": "summary",
        "title": [],
        "body": [],
        "bullets": bullets,
        "key_points": [],
        # Marked, so a teacher previewing the deck can see this slide was
        # assembled rather than written, and the player can label it.
        "synthesized": True,
    }


# ── interactive blocks ───────────────────────────────────────────────────────
# The spec-driven replacement for the reference's generated HTML5 games.
#
# The decision that makes them worth having: a block with a right answer is
# normalized into the **question vocabulary** and carries a `widget` naming the
# component that renders it. So `sort_items` IS an `ordering` question shown as
# drag-and-drop, and it scores through `evaluate.py` like everything else.
#
# That is precisely what the reference's games could not do — its `game_score`
# postMessage arrived at an empty `if` block and was dropped, while games
# carried 25–40% of the composite grade.

#: widget → the question type it is, or None for a study aid that is not scored.
INTERACTIVE_WIDGETS = {
    "match_pairs": "matching",
    "sort_items": "ordering",
    "fill_blank_drag": "fill_blank",
    "hotspots": "image_mcq",
    "flashcards": None,
    "click_reveal": None,
}

MAX_BLOCKS = 8
MAX_CARDS = 12


def _block_id(raw: Any, index: int) -> str:
    """A block id that cannot be a question id.

    Answers live in one flat map per attempt, keyed by question id across every
    component, so two items sharing an id share an answer. `b`-prefixed here
    rather than trusting whatever the model called it.
    """
    given = str((raw or {}).get("id") or "").strip()
    return given if given.startswith("b") else f"b{index + 1}"


def normalize_block(raw: Any, index: int) -> Optional[dict[str, Any]]:
    """One interactive block: a scored question in a widget, or a study aid."""
    if not isinstance(raw, dict):
        return None
    widget = str(raw.get("widget") or raw.get("type") or "").strip().lower()
    if widget not in INTERACTIVE_WIDGETS:
        return None

    question_type = INTERACTIVE_WIDGETS[widget]
    if question_type:
        question = normalize_question({**raw, "type": question_type}, index)
        if question is None:
            return None
        # Its OWN id namespace, and this is not cosmetic. An attempt's answers
        # are one flat map keyed by question id across the whole task, so a
        # block that came back as "q1" shared its answer — and its verdict —
        # with the practice question also called "q1". The model names both
        # `q1` by default, so the collision was the normal case.
        return {**question, "id": _block_id(raw, index), "widget": widget, "scored": True}

    cards = []
    for item in (raw.get("cards") or raw.get("items") or [])[:MAX_CARDS]:
        if not isinstance(item, dict):
            continue
        front = _segments(_first(item, ("front", "term", "label", "question")))
        back = _segments(_first(item, ("back", "definition", "reveal", "answer")))
        if front and back:
            cards.append({"front": front, "back": back})
    if not cards:
        return None
    return {
        "id": _block_id(raw, index),
        "widget": widget,
        # Study aids report engagement, not correctness. Saying so in the data
        # stops a "0%" appearing beside a block nobody could get wrong.
        "scored": False,
        "prompt": _segments(_first(raw, _PROMPT_KEYS)),
        "cards": cards,
    }


#: The widgets that are NOT a question in disguise. Everything else in
#: `INTERACTIVE_WIDGETS` maps onto a question type this vocabulary already has,
#: which is why "activity" stopped being a part of its own: a `match_pairs`
#: block and a `matching` question were the same object under two names, and a
#: teacher was being asked to choose between them.
STUDY_WIDGETS = tuple(
    widget for widget, question_type in INTERACTIVE_WIDGETS.items() if question_type is None
)

MAX_STUDY = 4


def normalize_study(raw: Any) -> list[dict[str, Any]]:
    """Flashcards and click-to-reveal, and nothing that could be scored.

    These are the one thing the old `interactive` component had that `practice`
    did not, so they moved here rather than being lost with it. A scored widget
    offered in this list is dropped: it belongs in `questions`, where it goes
    through the same normalizer, the same evaluator and the same answer key.
    """
    source = raw
    if isinstance(raw, dict):
        for key in ("study", "cards", "blocks"):
            if isinstance(raw.get(key), list):
                source = raw[key]
                break
    if not isinstance(source, list):
        return []

    blocks: list[dict[str, Any]] = []
    seen: set[str] = set()
    for index, item in enumerate(source[:MAX_STUDY]):
        if not isinstance(item, dict):
            continue
        widget = str(item.get("widget") or item.get("type") or "").strip().lower()
        if widget not in STUDY_WIDGETS:
            continue
        block = normalize_block(item, index)
        if block is None or block.get("scored"):
            continue
        if block["id"] in seen:
            block["id"] = f"{block['id']}-{index + 1}"
        seen.add(block["id"])
        blocks.append(block)
    return blocks


def normalize_blocks(raw: Any) -> list[dict[str, Any]]:
    source = raw
    if isinstance(raw, dict):
        for key in ("blocks", "interactive", "activities", "items"):
            if isinstance(raw.get(key), list):
                source = raw[key]
                break
    if not isinstance(source, list):
        return []
    blocks = []
    seen: set[str] = set()
    for index, item in enumerate(source[:MAX_BLOCKS]):
        block = normalize_block(item, index)
        if block is None:
            continue
        if block["id"] in seen:
            block["id"] = f"{block['id']}-{index + 1}"
        seen.add(block["id"])
        blocks.append(block)
    return blocks


# ── the task spec ────────────────────────────────────────────────────────────

#: What a deck may be asked for. Every one of these changes the OUTPUT — the
#: prompt, the render, or what is spent on generating it. A setting a teacher
#: can move without being able to see what it did is worse than no setting,
#: because it teaches them not to trust the rest of the form either.
PRESENTATION_THEMES = ("auto", "math", "science", "history", "nature", "language", "plain")
PRESENTATION_DENSITIES = ("airy", "balanced", "full")

SPEC_DEFAULTS = {
    "practice": {"question_count": 8, "study_count": 2},
    "test": {"question_count": 10, "time_limit_minutes": 20,
             "passing_grade": 60, "show_answers_after": True, "retries": 1},
    "presentation": {
        "slide_count": 7,
        # The ground the deck is drawn on. `auto` derives it from the subject,
        # which is right almost always; the override is for the lesson that
        # sits in one subject and looks like another.
        "theme": "auto",
        # How much goes on one slide.
        "density": "balanced",
        "examples": True,       # a worked example where one helps
        "diagrams": True,       # ask for figures at all — off skips the render
        "self_check": True,     # one click-to-reveal slide
        "teacher_notes": True,  # what to say, for the teacher only
        # Terms the deck must actually cover. The single highest-value field
        # here: it is the difference between a deck about the topic and a deck
        # about what this teacher is teaching this week.
        "key_concepts": "",
    },
    "interactive": {"block_count": 3},
}

#: Which string settings are closed vocabularies, and what they fall back to.
_SPEC_CHOICES = {
    "theme": PRESENTATION_THEMES,
    "density": PRESENTATION_DENSITIES,
}

#: Per-setting bounds. One shared range would be wrong for most of them — a
#: 60% pass mark clamped to a question-count ceiling becomes a 30% pass mark,
#: which is a silently-lowered standard rather than a rejected value.
_SPEC_BOUNDS = {
    "question_count": (1, MAX_QUESTIONS),
    "slide_count": (MIN_SLIDES, MAX_SLIDES),
    "block_count": (1, MAX_BLOCKS),
    "study_count": (0, MAX_STUDY),
    "time_limit_minutes": (1, 180),
    "passing_grade": (0, 100),
    "retries": (0, 5),
}


def normalize_spec(raw: Any) -> dict[str, Any]:
    """What the teacher asked for, as the generator's input contract.

    Written by the chat interview, so every field arrives from a model and is
    bounded here. An empty component list defaults to practice: a task with no
    components would generate nothing and sit at `ready` forever.
    """
    if not isinstance(raw, dict):
        raise SpecError("spec_not_an_object")

    from app.services.tasks.store import COMPONENTS

    title = sanitize_math(str(raw.get("title") or ""))[:120].strip()
    if not title:
        raise SpecError("title_required")

    requested = raw.get("components")
    components = [str(name).strip().lower() for name in
                  (requested if isinstance(requested, list) else [])]
    components = [name for name in dict.fromkeys(components) if name in COMPONENTS]
    if not components:
        components = ["practice"]

    language = str(raw.get("language") or "he")
    spec: dict[str, Any] = {
        "title": title,
        "topic": sanitize_math(str(raw.get("topic") or title))[:200].strip(),
        "subject": str(raw.get("subject") or "")[:60],
        "grade": str(raw.get("grade") or raw.get("level") or "")[:30],
        "language": language if language in ("he", "en", "ar") else "he",
        "components": components,
        "difficulty": (str(raw.get("difficulty") or "medium").lower()
                       if str(raw.get("difficulty") or "medium").lower() in DIFFICULTIES
                       else "medium"),
        "notes": sanitize_math(str(raw.get("notes") or ""))[:600].strip(),
    }

    # Who the task is FOR, when it was built from a finding about particular
    # children. Ids only, and they never reach a model: at generation they are
    # resolved into an anonymous shared brief (`tasks/audience.py`). Stored on
    # the spec rather than passed at generation time so a regenerate a week
    # later is aimed at the same children as the first pass — otherwise the
    # second attempt is the generic worksheet the first one avoided.
    audience = raw.get("audience")
    if isinstance(audience, dict):
        learner_ids = [
            str(entry).strip()[:120] for entry in (audience.get("learner_ids") or [])
            if str(entry or "").strip()
        ]
        if learner_ids:
            # Capped: a task "for" the whole school is a task for nobody, and
            # an unbounded list is an unbounded fan-out at generation.
            spec["audience"] = {"learner_ids": list(dict.fromkeys(learner_ids))[:60]}

    # Which catalogue lesson this task is built on, if the teacher picked one.
    # Ids only: the titles and the per-screen `informationToBot` are read from
    # the live catalogue at generation time, so a stored spec cannot go stale
    # against a re-imported unit — and a teacher cannot smuggle prose into the
    # generator's grounding block by editing a title field.
    source = raw.get("source")
    if isinstance(source, dict):
        component_id = str(source.get("component_id") or "").strip()[:160]
        objective_id = str(source.get("objective_id") or "").strip()[:160]
        if component_id or objective_id:
            spec["source"] = {
                "component_id": component_id or None,
                "objective_id": objective_id or None,
            }

    for component in components:
        settings = dict(SPEC_DEFAULTS.get(component) or {})
        given = raw.get(component) if isinstance(raw.get(component), dict) else {}
        for key, default in settings.items():
            value = given.get(key, default)
            # `bool` first: it is a subclass of `int`, so the int branch would
            # claim every checkbox and clamp True to 1 — which happens to work
            # and would silently stop being a boolean.
            if isinstance(default, bool):
                settings[key] = bool(value)
            elif isinstance(default, int):
                low, high = _SPEC_BOUNDS.get(key, (0, 100))
                try:
                    settings[key] = max(low, min(int(value), high))
                except (TypeError, ValueError):
                    settings[key] = default
            elif isinstance(default, str):
                text = str(value or "").strip()
                choices = _SPEC_CHOICES.get(key)
                if choices is not None:
                    settings[key] = text.lower() if text.lower() in choices else default
                else:
                    # Free text a teacher wrote, on its way into a prompt.
                    settings[key] = sanitize_math(text)[:MAX_TEXT]
        spec[component] = settings
    return spec
