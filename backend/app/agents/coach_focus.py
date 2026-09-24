"""What the learner should look at right now: one mark per on-task reply.

The coach's replies are about something ON the lesson screen — the question,
a picture, the table, one option. Until 09/2026 the only way to show it was a
planning call that let the model choose `point_at_screen`; ~97% of those
calls chose nothing, pregen/proactive/support turns never pointed, and the
few marks that were drawn were mostly a whole-frame glow.

This module decides the mark deterministically, with zero tokens, before the
first word streams:

- **Sources**, best first: the v8 object catalog (``screen_objects``: stable
  ids, labels, per-object geometry) → the v7 region map (``screen_anchors``,
  regions only) → the catalog itself (question / options / video, no
  geometry: a *semantic* mark the chat can still name).
- **Rules** (first match wins) map the turn — arrival, hint, explanation,
  mistake, partial, a nudge, or what a typed message names — to an object.
- **Leak policy** (``finalize``, the only place it runs): a single OPTION is
  marked only when the learner chose it or the question is already solved.
  Anything else lifts to its group ("the answers"). Not even an option the
  learner NAMED: marking named wrong options and lifting the right one would
  make the mark an oracle ("and option 2?" → the group lights up → 2 it is).
- **Honesty**: an assumed position (the player has not reported where the
  learner is) marks semantically only — no geometry for a screen we may not
  be on; a screen with look-alike variants marks whole regions only.

The frame (``to_frame``) extends the v1 pointer wire shape (``region``,
``breakpoints``, ``question_key``) so an old client keeps working; a v2
client also gets the object's id, kind, label and precision. Why a mark was
lifted or refused never leaves the server.
"""

from __future__ import annotations

import os
import re
import unicodedata
from dataclasses import dataclass, field
from typing import Any, Optional

#: Which catalog kinds a legacy (v7) region stands for.
_REGION_KIND = {
    "question": "stem", "options": "options", "input": "input", "image": "image",
    "video": "video", "diagram": "diagram", "table": "table", "instruction": "text",
}
_KIND_REGION = {kind: region for region, kind in _REGION_KIND.items()}
_KIND_REGION.update({"option": "options", "diagram_part": "diagram",
                     "table_row": "table", "table_col": "table", "formula": "diagram"})
#: Generic Hebrew labels (the shards' own labels win when present).
_KIND_LABEL_HE = {
    "stem": "השאלה", "options": "התשובות", "option": "האפשרות", "input": "משבצת התשובה",
    "image": "התמונה", "video": "הסרטון", "diagram": "התרשים", "diagram_part": "התרשים",
    "table": "הטבלה", "table_row": "שורה בטבלה", "table_col": "עמודה בטבלה",
    "text": "ההוראות", "formula": "הנוסחה",
}
#: A teaching screen's medium, most specific first.
_TEACHING_ORDER = ("video", "diagram", "table", "image", "formula", "text")
#: What a hint or explanation points at before the question itself.
_DATA_ORDER = ("diagram", "table", "image", "formula")

#: A typed message naming something visible. Small on purpose: a word here
#: must mean a screen THING in a learner's mouth, in any of the three
#: languages the chat speaks.
_NAMED_KINDS: tuple[tuple[str, re.Pattern[str]], ...] = tuple(
    (kind, re.compile(pattern, re.IGNORECASE)) for kind, pattern in (
        ("table", r"טבל|جدول|\btable"),
        ("diagram", r"גרף|תרשים|שרטוט|צירים|ציר ה|נקוד[הת]|رسم|مخطط|بياني|محور|\b(graph|diagram|chart|axis|axes|point)"),
        ("video", r"סרטון|וידאו|הסרט\b|فيديو|\bvideo"),
        ("image", r"תמונ|ציור|צילום|صور|\b(image|picture|photo)"),
        ("input", r"משבצת|תיבת|שדה|להקליד|خانة|\b(box|field|blank)"),
        ("options", r"תשובות|אפשרויות|خيارات|إجابات|\b(options|answers|choices)\b"),
        ("stem", r"השאלה|שאלה הזו|السؤال|\bthe question"),
        ("text", r"הוראות|ההסבר שכתוב|تعليمات|\binstructions"),
    ))
#: "my answer", "what I chose" — the learner's own last choice.
_MY_ANSWER = re.compile(
    r"(התשובה|הבחירה) שלי|מה שבחרתי|למה טעיתי|اجابتي|إجابتي|اخترت|\bmy (answer|choice)|what i (chose|picked)|why (was i|am i) wrong",
    re.IGNORECASE)
_SOCIAL = re.compile(
    r"^\s*(היי|הי|שלום|תודה( רבה)?|אוקיי?|סבבה|בסדר|יופי|מגניב|ביי|לילה טוב|"
    r"مرحبا|شكرا|تمام|باي|hi|hey|hello|thanks|thank you|ok(ay)?|cool|bye)"
    r"[\s!.,?🙂😊👍❤️]*$",
    re.IGNORECASE)

#: Typed intents that are about the lesson screen; the rest (profile,
#: capabilities, calendar, memory, goals) carry no mark.
_ON_TASK_INTENTS = frozenset({"learning_help", "encouragement"})
#: Nudges that re-orient the learner on the current task.
_NUDGES = frozenset({"idle", "slow_progress", "wheel_spinning", "rapid_guessing"})


def mode() -> str:
    """``COACH_FOCUS_MARKS_ENABLED``: off | shadow (decide + record, send
    nothing) | on. ``COACH_POINTING_ENABLED=0`` stays the kill switch."""
    from app.agents.coach_tools.pointing_tools import pointing_enabled

    if not pointing_enabled():
        return "off"
    value = (os.environ.get("COACH_FOCUS_MARKS_ENABLED") or "on").strip().lower()
    return value if value in {"off", "shadow", "on"} else "on"


@dataclass
class FocusObject:
    id: str
    kind: str
    role: str
    label: str
    q: list[str] = field(default_factory=list)
    parent: Optional[str] = None
    option_index: Optional[int] = None
    geometry: list[dict[str, Any]] = field(default_factory=list)
    source: str = "catalog"          # v8 | v7 | catalog


@dataclass
class FocusDecision:
    """The chosen mark (or None) and the private audit of how it was chosen."""
    target: Optional[FocusObject]
    rule: str
    lifted: Optional[str] = None     # why a finer target was lifted (server-only)
    precision: str = "semantic"
    objects: list[FocusObject] = field(default_factory=list)


def _norm(text: Any) -> str:
    folded = unicodedata.normalize("NFKC", str(text or "")).casefold()
    return " ".join(re.sub(r"[^\w\s]", " ", folded).split())


# ── the screen's objects ─────────────────────────────────────────────────────

def _catalog_objects(current: dict[str, Any]) -> list[FocusObject]:
    """What the catalog alone says the screen holds — no geometry."""
    question = current.get("question") or {}
    qid = str(current.get("question_id") or "")
    out: list[FocusObject] = []
    if str(question.get("text") or "").strip():
        out.append(FocusObject(id=f"stem:{qid or 'q'}", kind="stem", role="stem",
                               label=_KIND_LABEL_HE["stem"], q=[qid] if qid else []))
        if question.get("options"):
            group = f"opts:{qid or 'q'}"
            out.append(FocusObject(id=group, kind="options", role="answer_area",
                                   label=_KIND_LABEL_HE["options"], q=[qid] if qid else []))
            for index, _ in enumerate(question.get("options") or []):
                out.append(FocusObject(
                    id=f"opt:{qid or 'q'}:{index}", kind="option", role="answer_area",
                    label=f"אפשרות {index + 1}", q=[qid] if qid else [], parent=group,
                    option_index=index))
    item = current.get("item") or {}
    if str(item.get("media_format") or "") == "video" or item.get("kind") == "watch":
        out.append(FocusObject(id="vid:1", kind="video", role="teaching",
                               label=_KIND_LABEL_HE["video"]))
    return out


def _captured_objects(current: dict[str, Any]) -> list[FocusObject]:
    from app.services import content_intelligence as ci

    component_id = str(current.get("component_id") or "")
    item_id = str(current.get("item_id") or "")
    if not (component_id and item_id):
        return []
    catalog = ci.screen_objects(component_id, item_id)
    if catalog and catalog.get("objects"):
        return [FocusObject(
            id=o["id"], kind=o["kind"], role=o["role"], label=o.get("label") or "",
            q=list(o.get("q") or []), parent=o.get("parent"),
            option_index=o.get("option_index"), geometry=o.get("geometry") or [],
            source="v8") for o in catalog["objects"]]
    regions = (ci.screen_anchors(component_id, item_id) or {}).get("regions") or {}
    qid = str(current.get("question_id") or "")
    out = []
    for region, entries in sorted(regions.items()):
        kind = _REGION_KIND.get(region)
        if not kind:
            continue
        out.append(FocusObject(
            id=f"{region}:v7", kind=kind,
            role={"stem": "stem", "options": "answer_area", "input": "answer_area",
                  "video": "teaching", "text": "instruction"}.get(kind, "data"),
            label=_KIND_LABEL_HE[kind],
            q=[qid] if kind in ("stem", "options", "input") and qid else [],
            # v7 parts follow SCREEN order, not option order — only the whole
            # region is trustworthy.
            geometry=[{k: e[k] for k in ("w", "h", "content_w", "content_h", "rect")}
                      for e in entries],
            source="v7"))
    return out


def screen_catalog(current: dict[str, Any]) -> list[FocusObject]:
    """Every object the coach could mark on the learner's current screen:
    the capture's (v8, else v7), plus what the catalog knows and the
    capture lacks — a question the walker never reached is still nameable."""
    captured = _captured_objects(current)
    kinds = {o.kind for o in captured}
    ids = {o.id for o in captured}
    return captured + [o for o in _catalog_objects(current)
                       if o.kind not in kinds and o.id not in ids
                       and not (o.kind == "option" and "options" in kinds)]


# ── the learner's own evidence ───────────────────────────────────────────────

def _question_events(current: dict[str, Any]) -> list[dict[str, Any]]:
    """The learner's recent events on THIS question of THIS screen. Question
    ids repeat across screens (every screen has a `q1`), so an event naming
    another screen never counts; one with no screen id is trusted only when
    the question id matches."""
    qid = str(current.get("question_id") or "")
    iid = str(current.get("item_id") or "")
    if not qid:
        return []
    return [e for e in current.get("recent_events") or []
            if isinstance(e, dict) and str(e.get("question_id") or "") == qid
            and (not e.get("item_id") or not iid or str(e["item_id"]) == iid)]


def solved(current: dict[str, Any]) -> bool:
    return any(e.get("success") is True for e in _question_events(current))


def chosen_option(current: dict[str, Any]) -> Optional[int]:
    """0-based index of the option the learner last answered, if it is one."""
    options = [_norm(o) for o in (current.get("question") or {}).get("options") or []]
    for event in _question_events(current):   # newest first
        response = _norm(event.get("response"))
        if response and response in options:
            return options.index(response)
    return None


# ── the rules ────────────────────────────────────────────────────────────────

def _for_question(objects: list[FocusObject], qid: str) -> list[FocusObject]:
    return [o for o in objects if not o.q or not qid or qid in o.q]


def _first(objects: list[FocusObject], kinds: tuple[str, ...], qid: str = "") -> Optional[FocusObject]:
    pool = _for_question(objects, qid)
    for kind in kinds:
        hit = next((o for o in pool if o.kind == kind), None)
        if hit:
            return hit
    return None


def _stem(objects: list[FocusObject], qid: str) -> Optional[FocusObject]:
    return _first(objects, ("stem",), qid)


def _teaching(objects: list[FocusObject]) -> Optional[FocusObject]:
    return _first(objects, _TEACHING_ORDER)


def _option(objects: list[FocusObject], qid: str, index: int) -> Optional[FocusObject]:
    return next((o for o in _for_question(objects, qid)
                 if o.kind == "option" and o.option_index == index), None)


def _named_kind(message: str) -> Optional[str]:
    for kind, pattern in _NAMED_KINDS:
        if pattern.search(message or ""):
            return kind
    return None


def _default_focus(objects: list[FocusObject], current: dict[str, Any], qid: str) -> tuple[Optional[FocusObject], str]:
    """The screen's natural focus: its question once reached, else its medium."""
    question = current.get("question") or {}
    if str(question.get("text") or "").strip() and question.get("reached", True):
        hit = _stem(objects, qid)
        if hit:
            return hit, "current:stem"
    hit = _teaching(objects)
    if hit:
        return hit, "current:teaching"
    return _stem(objects, qid), "current:stem"


def decide(
    current: dict[str, Any],
    *,
    trigger: Optional[str] = None,
    support_mode: Optional[str] = None,
    message: Optional[str] = None,
    query_intent: Optional[str] = None,
    referenced_option: Optional[int] = None,
) -> FocusDecision:
    """The raw target for this turn (before the leak policy)."""
    if not current.get("on_lesson_screen", True):
        return FocusDecision(None, "off_screen")
    objects = screen_catalog(current)
    if not objects:
        return FocusDecision(None, "no_objects")
    qid = str(current.get("question_id") or "")

    def done(target: Optional[FocusObject], rule: str) -> FocusDecision:
        return FocusDecision(target, rule if target else f"{rule}:none", objects=objects)

    if trigger in ("lesson_welcome", "success"):
        return done(None, trigger)          # no screen thing to look at
    if trigger == "question_intro":
        return done(_stem(objects, qid), "question_intro")
    if trigger == "lesson_step_intro":
        return done(_teaching(objects) or _stem(objects, qid), "lesson_step_intro")
    if support_mode == "video_summary":
        return done(_first(objects, ("video",)), "video_summary")
    if support_mode in ("hint", "explanation"):
        return done(_first(objects, _DATA_ORDER, qid) or _stem(objects, qid), support_mode)
    if trigger in ("mistake", "misconception"):
        chosen = chosen_option(current)
        if chosen is not None and _option(objects, qid, chosen):
            return done(_option(objects, qid, chosen), f"{trigger}:chosen")
        return done(_first(objects, _DATA_ORDER, qid) or _stem(objects, qid), trigger)
    if trigger == "partial":
        return done(_first(objects, ("input",), qid) or _stem(objects, qid), "partial")
    if trigger in _NUDGES:
        target, rule = _default_focus(objects, current, qid)
        return done(target, f"{trigger}:{rule}")
    if message is not None:
        if query_intent and query_intent not in _ON_TASK_INTENTS:
            return done(None, "off_task")
        if _SOCIAL.match(message):
            return done(None, "social")
        if referenced_option is not None:
            return done(_option(objects, qid, referenced_option)
                        or _first(objects, ("options",), qid), "typed:option")
        if _MY_ANSWER.search(message):
            chosen = chosen_option(current)
            if chosen is not None:
                return done(_option(objects, qid, chosen)
                            or _first(objects, ("options",), qid), "typed:my_answer")
        named = _named_kind(message)
        if named:
            target = _first(objects, (named,), qid)
            if target is None and named == "diagram":
                target = _first(objects, ("image",), qid)   # a "graph" drawn as a picture
            if target is not None:
                return done(target, f"typed:named:{named}")
        target, rule = _default_focus(objects, current, qid)
        return done(target, f"typed:{rule}")
    target, rule = _default_focus(objects, current, qid)
    return done(target, rule)


def finalize(decision: FocusDecision, current: dict[str, Any]) -> FocusDecision:
    """The leak policy and the honesty caps. The ONLY place either runs."""
    target = decision.target
    if target is None:
        return decision
    by_id = {o.id: o for o in decision.objects}

    def lift(reason: str) -> None:
        nonlocal target
        parent = by_id.get(target.parent or "") if target else None
        decision.lifted = reason
        target = parent or next((o for o in decision.objects if o.kind == "options"
                                 and (not target.q or set(o.q) & set(target.q))), None)

    if target.kind == "option":
        index = target.option_index
        allowed = solved(current) or (index is not None and index == chosen_option(current))
        if not allowed:
            lift("option_not_allowed")
    variants = bool(current.get("screen_has_variants"))
    if target is not None and variants and target.parent:
        lift("variants")
    decision.target = target
    if target is None:
        decision.rule += ":lifted_to_none"
        return decision
    if current.get("position_assumed") or not target.geometry:
        decision.precision = "semantic"
    elif target.source == "v8" and not variants and decision.lifted is None:
        decision.precision = "exact"
    else:
        decision.precision = "approx"
    return decision


def to_frame(
    decision: FocusDecision, current: dict[str, Any], *, client_version: int = 1,
) -> Optional[dict[str, Any]]:
    """The pointer frame for the wire, or None when there is nothing to send
    (no target; or a v1 client, which would render a semantic mark as the
    whole-frame glow this replaces)."""
    target = decision.target
    if target is None:
        return None
    semantic = decision.precision == "semantic"
    if client_version < 2 and semantic:
        return None
    question_key = "|".join((str(current.get("component_id") or ""),
                             str(current.get("item_id") or ""),
                             str(current.get("question_id") or "")))
    frame: dict[str, Any] = {
        "region": _KIND_REGION.get(target.kind),
        "breakpoints": [] if semantic else target.geometry,
        "question_key": question_key,
    }
    if client_version >= 2:
        frame.update({
            "v": 2,
            "object_id": target.id,
            "kind": target.kind,
            "label": target.label or _KIND_LABEL_HE.get(target.kind, ""),
            "precision": decision.precision,
            "source": "resolver",
        })
        if target.kind == "option" and target.option_index is not None:
            frame["ordinal"] = target.option_index + 1
    return frame


def resolve(
    current: dict[str, Any],
    *,
    trigger: Optional[str] = None,
    support_mode: Optional[str] = None,
    message: Optional[str] = None,
    query_intent: Optional[str] = None,
    referenced_option: Optional[int] = None,
    client_version: int = 1,
) -> tuple[Optional[dict[str, Any]], FocusDecision]:
    """(frame or None, decision) for one turn. ``referenced_option`` is the
    0-based option the learner's own words named (coach._referenced_option)."""
    decision = decide(current, trigger=trigger, support_mode=support_mode,
                      message=message, query_intent=query_intent,
                      referenced_option=referenced_option)
    decision = finalize(decision, current)
    return to_frame(decision, current, client_version=client_version), decision
