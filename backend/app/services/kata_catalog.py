"""Kata-backed curriculum spine — the live replacement for ``brain/curriculum.py``.

The planner, pedagogical agent, dashboard and coach all need a synchronous view
of the objective spine (objective → prerequisites → components) and localized
titles. Kata is an async HTTP catalog, so this module keeps a small in-memory
**snapshot** refreshed on a TTL, and exposes sync accessors with the SAME names
the old hardcoded ``curriculum`` module did (``objectives_for`` / ``get_objective``
/ ``components_for`` / ``get_component`` / ``localized_objective_title``).

Async callers prime the snapshot with ``await ensure_loaded()`` before reading;
the app also refreshes it at startup. The catalog is small, so a full fetch is
cheap. One namespace end-to-end: objective ids are Kata's dotted ``MOE.…`` keys.
"""

from __future__ import annotations

import time
from typing import Any, Optional

from app.services import catalog_i18n, kata_client

# Time source is injected so tests / offline runs stay deterministic; falls back
# to wall clock. (No Date.now-style hidden state in the accessors themselves.)
_TTL_SECONDS = 300.0

_SNAPSHOT: dict[str, Any] = {
    "loaded_at": 0.0,
    "objectives": {},        # objective_id -> objective spine entry
    "by_subject": {},        # subject -> [objective_id, …] in planner order
    "components": {},         # component_id -> normalized component
    "components_by_obj": {},  # objective_id -> [component_id, …]
    "units": {},              # unit_id -> normalized unit
}


def _now() -> float:
    return time.time()


def _order_objectives(objectives: dict[str, dict[str, Any]], subject: str) -> list[str]:
    """Order a subject's goals the way the ministry orders them.

    The authority is the registry (``GET /catalog/objectives``): a goal carries an
    ``order`` scoped **within its sub-topic**, which is precisely the spec's
    "יעדי הלמידה בתוך תת נושא מסודרים עפ״י סדר מובנה" — the linearity of §3 is
    per sub-topic, not global. Sub-topics themselves have no declared order, so
    they are walked by key for determinism.

    Prerequisite depth survives only as a tie-break *inside* a sub-topic, for a
    catalog whose registry rows have not landed yet. Before the registry was
    wired this depth walk WAS the order — an invention that could not agree with
    the ministry's the moment a subject had more than one goal.
    """
    ids = [oid for oid, o in objectives.items() if o["subject"] == subject]
    depth: dict[str, int] = {}

    def _depth(oid: str, seen: frozenset[str]) -> int:
        if oid in depth:
            return depth[oid]
        obj = objectives.get(oid)
        if not obj or oid in seen:
            return 0
        prereqs = [p for p in obj.get("prerequisites", []) if p in objectives]
        d = 0 if not prereqs else 1 + max(_depth(p, seen | {oid}) for p in prereqs)
        depth[oid] = d
        return d

    for oid in ids:
        _depth(oid, frozenset())

    def sort_key(oid: str) -> tuple[str, float, int, str]:
        obj = objectives.get(oid) or {}
        registry_order = obj.get("registry_order")
        return (
            str(obj.get("sub_topic") or ""),
            float(registry_order) if registry_order is not None else float("inf"),
            depth.get(oid, 0),
            oid,
        )

    return sorted(ids, key=sort_key)


def _build_snapshot(
    units: list[dict[str, Any]],
    registry: Optional[list[dict[str, Any]]] = None,
) -> dict[str, Any]:
    objectives: dict[str, dict[str, Any]] = {}
    components: dict[str, dict[str, Any]] = {}
    components_by_obj: dict[str, list[str]] = {}
    units_by_id: dict[str, dict[str, Any]] = {}
    by_goal = {row["id"]: row for row in (registry or []) if row.get("id")}

    for unit in units:
        units_by_id[unit["id"]] = unit
        objective_id = unit.get("objective_id")
        # A sub-topic summary (§3.4) carries no goal. It stays in the catalog as a
        # launchable review resource but never enters the spine — it has nothing
        # to master, so the planner would offer it forever.
        if not objective_id:
            for component in unit["components"]:
                components[component["id"]] = {
                    **component, "objective_id": None, "subject": unit["subject"],
                    "is_summary": True,
                }
            continue
        entry = objectives.get(objective_id)
        if entry is None:
            goal = by_goal.get(objective_id) or {}
            hierarchy = goal.get("sub_topic") or {}
            entry = {
                "id": objective_id,
                "subject": unit["subject"],
                "topic": unit["sub_topic"],       # dotted sub-topic key (label resolved in UI)
                "sub_topic": hierarchy.get("id") or unit["sub_topic"],
                "prerequisites": [],
                # The unit title is the fallback only; the registry holds the real
                # goal, its translations and the hierarchy the dashboard labels with.
                "title": hierarchy.get("title") or unit["title"],
                "titles": dict(hierarchy.get("titles") or unit.get("titles") or {}),
                "description": goal.get("description") or "",
                "descriptions": dict(goal.get("descriptions") or {}),
                "registry_order": goal.get("order"),
                "topic_title": (goal.get("topic") or {}).get("title") or "",
                "curriculum_title": (goal.get("curriculum") or {}).get("title") or "",
                "unit_ids": [],
            }
            objectives[objective_id] = entry
        # Merge across units that share an objective.
        entry["unit_ids"].append(unit["id"])
        for prereq in unit.get("prerequisites", []):
            if prereq not in entry["prerequisites"]:
                entry["prerequisites"].append(prereq)
        for component in unit["components"]:
            # Stamp objective onto the component so downstream reads are uniform.
            component = {**component, "objective_id": objective_id, "subject": unit["subject"]}
            components[component["id"]] = component
            components_by_obj.setdefault(objective_id, []).append(component["id"])

    by_subject: dict[str, list[str]] = {}
    subjects = {o["subject"] for o in objectives.values()}
    for subject in subjects:
        by_subject[subject] = _order_objectives(objectives, subject)
    # Assign a stable integer order per objective (planner reads o["order"]).
    for subject, ordered in by_subject.items():
        for index, oid in enumerate(ordered):
            objectives[oid]["order"] = index + 1

    return {
        "loaded_at": _now(),
        "objectives": objectives,
        "by_subject": by_subject,
        "components": components,
        "components_by_obj": components_by_obj,
        "units": units_by_id,
    }


async def ensure_loaded(force: bool = False) -> None:
    """Refresh the snapshot if stale/empty. Safe to call on every async entry."""
    fresh = (_now() - _SNAPSHOT["loaded_at"]) < _TTL_SECONDS and _SNAPSHOT["objectives"]
    if fresh and not force:
        return
    try:
        units = await kata_client.list_units()
    except kata_client.KataError:
        # Keep serving the last good snapshot on a transient Kata outage; only a
        # cold cache surfaces empty (callers already tolerate an empty spine).
        if _SNAPSHOT["objectives"]:
            return
        raise
    try:
        registry = await kata_client.list_objectives()
    except Exception as exc:
        # The goal registry is metadata: without it we still have every unit, so
        # fall back to unit titles + prerequisite depth rather than serving nothing.
        print(f"⚠️ learning-goal registry unavailable, using unit metadata: {exc}")
        registry = []
    _SNAPSHOT.update(_build_snapshot(units, registry))
    # Names for the rows the vendor ships in one language only. Read-side is
    # sync and never awaits, so the map is primed here with the catalogue it
    # describes. A failure leaves every name at its vendor string.
    await catalog_i18n.load()


async def refresh() -> None:
    await ensure_loaded(force=True)


# ── Sync accessors (read the primed snapshot) ─────────────────────────────────
def subjects() -> list[str]:
    return sorted(_SNAPSHOT["by_subject"].keys())


def objectives_for(subject: str) -> list[dict[str, Any]]:
    """Ordered objective spine for a subject (prerequisite depth, then key)."""
    ordered_ids = _SNAPSHOT["by_subject"].get(subject) or []
    return [_SNAPSHOT["objectives"][oid] for oid in ordered_ids]


def get_objective(objective_id: str) -> Optional[dict[str, Any]]:
    return _SNAPSHOT["objectives"].get(objective_id)


def subject_of(objective_id: Optional[str]) -> Optional[str]:
    """Which subject an objective belongs to, or ``None`` if unknown.

    The catalogue is the single place that knows this. Callers that need to
    narrow by subject resolve through here rather than copying a `subject` onto
    their own rows, so a re-import can never leave two answers in the system.
    """
    if not objective_id:
        return None
    return (get_objective(objective_id) or {}).get("subject")


def get_component(component_id: str) -> Optional[dict[str, Any]]:
    return _SNAPSHOT["components"].get(component_id)


def components_for(objective_id: str) -> list[dict[str, Any]]:
    ids = _SNAPSHOT["components_by_obj"].get(objective_id) or []
    return [_SNAPSHOT["components"][cid] for cid in ids]


def get_unit(unit_id: str) -> Optional[dict[str, Any]]:
    return _SNAPSHOT["units"].get(unit_id)


def all_units() -> list[dict[str, Any]]:
    """Every unit in the snapshot. For catalogue-wide teacher views, which have
    to show material nobody has opened yet — absence of activity is exactly the
    thing those screens report."""
    return list(_SNAPSHOT["units"].values())


def all_components() -> list[dict[str, Any]]:
    """Every component (a "learning"), including summary units' components."""
    return list(_SNAPSHOT["components"].values())


def unit_type(unit_id: str) -> str:
    """Infer the 720 unit structure (720 §3.2): 'closed' | 'modular'.

    No explicit metadata field exists, so we infer from structure — a single
    component is a closed unit (the content navigates its own items; the platform
    does not sequence sub-components), multiple ordered components are modular
    (the platform navigates between them). 'hybrid' can't be distinguished from
    metadata today, so multi-component units are treated as modular.
    """
    unit = _SNAPSHOT["units"].get(unit_id) or {}
    return "closed" if len(unit.get("components") or []) <= 1 else "modular"


def localized_objective_title(objective_id: str, locale: str = "he") -> str:
    """Localized unit title for an objective; falls back to Hebrew then the key.

    The key fallback is right for a log line, a prompt and a sort key, and wrong
    for anything a person reads — `MOE.ENG.G7.PEOPLE.FAMILY.WRITE` reached a
    teacher's moments feed as the name of what a child had just achieved. Use
    `objective_title` where the string is going on a screen.
    """
    obj = _SNAPSHOT["objectives"].get(objective_id) or {}
    titles = obj.get("titles") or {}
    return titles.get(locale) or obj.get("title") or objective_id


def objective_title(objective_id: Optional[str], locale: str = "he") -> Optional[str]:
    """The objective's title, or ``None`` — never the dotted key.

    The screen-facing half of the pair above. A null is something a client can
    label ("this learning", "a goal"); an id is something it can only print.
    """
    if not objective_id:
        return None
    obj = get_objective(objective_id) or {}
    return catalog_i18n.title(
        "objective", objective_id, locale,
        vendor=obj.get("titles") or {}, fallback=obj.get("title"),
    )


def unit_title(unit_id: Optional[str], locale: str = "he") -> Optional[str]:
    """A unit's name in this locale, or ``None``.

    Never the id: a unit with no title has no name, and `unit_id` travels in
    its own field for the caller that wants it.
    """
    if not unit_id:
        return None
    # Through the accessor, not the raw snapshot: every other reader goes
    # through `get_unit`, and a second read path is a second thing to patch.
    unit = get_unit(unit_id) or {}
    return catalog_i18n.title(
        "unit", unit_id, locale,
        vendor=unit.get("titles") or {}, fallback=unit.get("title"),
    )


def component_title(component_id: Optional[str], locale: str = "he") -> Optional[str]:
    """A learning's name in this locale, or ``None``.

    Kata ships `titleTranslations: null` on every component, so the vendor leg
    of the ladder is always empty here and this is the accessor that most needs
    the stored translations.
    """
    if not component_id:
        return None
    component = get_component(component_id) or {}
    raw = component.get("title")
    # `_catalog_spine` used to write `title or component_id`, so an untitled
    # component arrived carrying its own id as a name. A name that IS the id is
    # not a name, and translating it would be translating an identifier.
    if not raw or str(raw).strip() == str(component_id).strip():
        return None
    return catalog_i18n.title(
        "component", component_id, locale,
        vendor=component.get("titles") or {}, fallback=raw,
    )


def translatable_rows(locale_source: str = "he") -> list[dict[str, Any]]:
    """Every catalogue name that can be translated, in the shape
    `catalog_i18n.gaps` and the fill script both read.

    One place builds this list, so "what is missing" and "what gets filled" can
    never drift apart.
    """
    rows: list[dict[str, Any]] = []
    for unit in _SNAPSHOT["units"].values():
        if unit.get("title"):
            rows.append({"kind": "unit", "id": unit["id"], "source_text": unit["title"],
                         "vendor": unit.get("titles") or {},
                         "context": unit.get("subject") or ""})
    for component in _SNAPSHOT["components"].values():
        raw = component.get("title")
        if raw and str(raw).strip() != str(component.get("id") or "").strip():
            unit = _SNAPSHOT["units"].get(component.get("unit_id") or "") or {}
            rows.append({"kind": "component", "id": component["id"], "source_text": raw,
                         "vendor": component.get("titles") or {},
                         "context": unit.get("title") or component.get("subject") or ""})
    for objective_id, obj in _SNAPSHOT["objectives"].items():
        if obj.get("title"):
            rows.append({"kind": "objective", "id": objective_id, "source_text": obj["title"],
                         "vendor": obj.get("titles") or {},
                         "context": obj.get("subject") or ""})
    return rows


def information_for_item(component_id: Optional[str], item_id: Optional[str]) -> Optional[str]:
    """The ``informationToBot`` for the exact sub-content item/question, if known,
    else the component-level aggregate. Powers mistake-aware hints (plan §8)."""
    component = get_component(component_id) if component_id else None
    if not component:
        return None
    by_item = component.get("information_by_item") or {}
    if item_id and item_id in by_item:
        return by_item[item_id]
    return component.get("information_to_bot")


def questions_for_item(
    component_id: Optional[str], item_id: Optional[str]
) -> list[dict]:
    """Server-only question snapshots (text/options/correct answer) for the exact
    sub-content item the learner is on — the coach's current-question context."""
    component = get_component(component_id) if component_id else None
    if not component or not item_id:
        return []
    return (component.get("questions_by_item") or {}).get(item_id) or []


def default_question_id(
    component_id: Optional[str], item_id: Optional[str]
) -> Optional[str]:
    """The question a learner is on when the event names a screen but no question.

    Kata's `initialized` carries the screen only, so `current_state.question_id`
    stayed None until the first `answered` — which re-keyed the SAME question
    mid-way (`…|item|` → `…|item|q1`) and split its chat thread in two. When the
    screen holds exactly one question there is no ambiguity, so we resolve it
    here and the key is stable from arrival. With two sub-questions on one screen
    (סעיף א/ב) it stays None: guessing which one would be worse than waiting.
    """
    questions = questions_for_item(component_id, item_id)
    if len(questions) != 1:
        return None
    return questions[0].get("questionId") or None


def question_item_ordinals(component_id: Optional[str]) -> dict[str, int]:
    """Map each QUESTION to the question number the LEARNER sees on screen.

    The content numbers by SCREEN, not by sub-question. Measured 29/07 on
    `…-01-02`: item `-001` is titled "בסיסי 1: זיהוי תוצאה חריגה (2 סעיפים)" and
    the player's own nav shows three tabs — שאלה 1 / שאלה 2 / שאלה 3 — one per
    item. Numbering every sub-question consecutively made the chat caption the
    second סעיף of שאלה 1 as "שאלה 2", and then item `-002` (the content's שאלה
    2) as "שאלה 3": from the learner's seat the companion was one question ahead
    of the screen for the rest of the component. Same drift on `…-01-05`, where
    the content says "שאלת השיא… יש בה ארבעה סעיפים" — ONE question — and we
    labelled the parts "שאלה 1" through "שאלה 4".

    So an item is one question number, and the parts inside it are סעיפים
    (see :func:`question_part_indexes`). Keyed by ``item|question`` as well as by
    bare ``item``, because a message can be stored before the question resolves.

    VARIANT screens share one number. Some components carry several catalog
    items with the SAME question texts (`COMPL-00001` items 1/2 both ask "האם
    הנקודות נמצאות על ישר המקביל לציר?" over mirrored data) and the player shows
    the learner ONE of them — its screens_seen is smaller than the catalog's
    item count. Numbering variants consecutively captioned a learner's very
    first screen "שאלה 2" whenever the player dealt them the second variant.
    """
    component = get_component(component_id) if component_id else None
    if not component:
        return {}
    by_item = component.get("questions_by_item") or {}
    ordinals: dict[str, int] = {}
    position = 0
    seen_signatures: dict[tuple, int] = {}
    for item_id, questions in by_item.items():
        if not questions:
            continue
        signature = _variant_signature(questions)
        if signature and signature in seen_signatures:
            ordinal = seen_signatures[signature]
        else:
            position += 1
            ordinal = position
            if signature:
                seen_signatures[signature] = ordinal
        ordinals[item_id] = ordinal
        for question in questions:
            question_id = question.get("questionId")
            if question_id:
                ordinals[f"{item_id}|{question_id}"] = ordinal
    return ordinals


def _variant_signature(questions: list[dict]) -> tuple:
    """What makes two catalog items the SAME learner-visible exercise: the
    ordered question texts. Variants differ in data/answers but ask with the
    same words; empty texts yield an empty signature, which never matches."""
    texts = tuple(
        " ".join(str(q.get("questionText") or "").split())
        for q in questions
    )
    return texts if any(texts) else ()


def question_part_indexes(component_id: Optional[str]) -> dict[str, int]:
    """1-based סעיף index for questions that SHARE a screen.

    Only populated where a screen really does hold several parts — a
    single-question screen has no part to name, and captioning it "סעיף א" would
    invent a structure the learner cannot see.
    """
    component = get_component(component_id) if component_id else None
    if not component:
        return {}
    parts: dict[str, int] = {}
    for item_id, questions in (component.get("questions_by_item") or {}).items():
        questions = questions or []
        if len(questions) < 2:
            continue
        for index, question in enumerate(questions, start=1):
            question_id = question.get("questionId")
            if question_id:
                parts[f"{item_id}|{question_id}"] = index
    return parts


def non_question_items(component_id: Optional[str]) -> list[str]:
    """Screens the component teaches on but never asks a question about.

    Kata reports these as ordinary items (`…-01-04-006` carries teaching notes
    and no question), and the chat must not caption a thread about one of them
    with a question number it does not have. Read from the item spine when the
    snapshot carries one (authoritative — it lists EVERY screen, including a
    video with neither questions nor bot notes); the `information_by_item` scan
    stays as the fallback for older snapshots.
    """
    component = get_component(component_id) if component_id else None
    if not component:
        return []
    by_item = component.get("questions_by_item") or {}
    items = component.get("items") or []
    if items:
        return [row["id"] for row in items if not row.get("question_count")]
    prefix = f"{component.get('id') or component_id}-"
    return [
        key for key in (component.get("information_by_item") or {})
        if key not in by_item and str(key).startswith(prefix)
    ]


# What KIND of screen a learner is standing on. `question` screens ask something
# (and are numbered "שאלה N"); the rest teach, and the chat/coach must treat them
# as a learning step — Yuvi introduces the step instead of introducing a question
# that does not exist. Media buckets follow the 720 `mediaFormat` list.
_WATCH_MEDIA = {"video", "audio", "animation"}
_READ_MEDIA = {"text", "image", "presentation"}


def item_profiles(component_id: Optional[str]) -> list[dict[str, Any]]:
    """Ordered per-screen spine: id, title, content/media type, question count.

    Falls back to synthesizing rows from `questions_by_item` /
    `information_by_item` when the snapshot predates the item spine, so callers
    never have to branch on snapshot age.
    """
    component = get_component(component_id) if component_id else None
    if not component:
        return []
    rows = component.get("items") or []
    if rows:
        return [dict(row) for row in rows]
    by_item = component.get("questions_by_item") or {}
    prefix = f"{component.get('id') or component_id}-"
    ids = sorted(
        {key for key in by_item}
        | {
            key for key in (component.get("information_by_item") or {})
            if str(key).startswith(prefix)
        }
    )
    return [
        {
            "id": item_id,
            "title": "",
            "content_type": "",
            "media_format": "",
            "question_count": len(by_item.get(item_id) or []),
        }
        for item_id in ids
    ]


def plays_media(row: dict[str, Any]) -> bool:
    """True when this screen carries something the learner watches or listens to
    — regardless of whether it also asks a question."""
    return str(row.get("media_format") or "") in _WATCH_MEDIA


def kind_for_row(row: dict[str, Any]) -> str:
    """What the screen IS: `watch` | `read` | `question` | `step`.

    MEDIA WINS over "it also asks". `…-01-01-003` is a video playlist with a
    comprehension question inside it — the learner spends that screen watching,
    and calling it "שאלה 3" while the clip is playing describes something they
    are not doing yet. Whether a screen ASKS is a separate fact (`question_count`),
    and that is what gates the hint/explanation buttons and the numbering.
    """
    media = str(row.get("media_format") or "")
    if media in _WATCH_MEDIA:
        return "watch"
    if media in _READ_MEDIA:
        return "read"
    if row.get("question_count"):
        return "question"
    return "step"


def item_kind(component_id: Optional[str], item_id: Optional[str]) -> str:
    """`question` | `watch` | `read` | `step` — empty when the screen is unknown."""
    if not item_id:
        return ""
    for row in item_profiles(component_id):
        if row.get("id") == item_id:
            return kind_for_row(row)
    return ""


def next_item_if_watchable(
    component_id: Optional[str], current_item_id: Optional[str]
) -> Optional[str]:
    """The next screen, but only when it is the one that plays media.

    Kata reports `played`/`paused` against the component with no screen id, and
    its `initialized` for the video screen can arrive long after the video starts
    (or not at all). This is the narrowest safe reading of that signal: playback
    while standing on a screen that has no media of its own, with the very next
    screen being a video/audio/animation, means the learner has moved onto it.
    Returns None whenever anything about that is uncertain — including when the
    current screen itself plays, where the playback needs no explanation.
    """
    if not component_id or not current_item_id:
        return None
    rows = item_profiles(component_id)
    for index, row in enumerate(rows):
        if row.get("id") != current_item_id:
            continue
        # Media, not kind: `…-01-01-003` plays a clip AND asks about it, so it is
        # a question screen that nonetheless is the one playing.
        if plays_media(row):
            return None                      # this screen's own media is playing
        following = rows[index + 1] if index + 1 < len(rows) else None
        if following and plays_media(following):
            return following.get("id")
        return None
    return None


def item_profile(component_id: Optional[str], item_id: Optional[str]) -> dict[str, Any]:
    """One screen's profile plus its resolved `kind` (empty dict when unknown)."""
    if not item_id:
        return {}
    for row in item_profiles(component_id):
        if row.get("id") == item_id:
            return {**row, "kind": item_kind(component_id, item_id)}
    return {}


# ── Player-screen → catalog-item reconciliation ──────────────────────────────
# Kata's PLAYER numbers the screens it reports over xAPI with a leading-cover
# offset: the first interactive screen is object `…-002`, not `…-001`. Kata's
# CATALOG numbers `subContent` items from `…-001`. So the raw runtime screen id
# is one (or more) items AHEAD of the catalog id for the SAME question — storing
# it verbatim made the coach ground every hint on the NEXT item (observed: a
# "50.00g / precision" hint while the learner was on a "12.1g outlier" question).
# We reconcile the two id spaces here, self-anchored from data (no magic offset):
#   1. If the answered question id is unique to one catalog item, it pins the
#      exact item (e.g. only `-001` carries a `q2`).
#   2. Else align by ordinal — the run of visited player screens maps in order
#      onto the catalog `subContent`; the earliest visited player screen is the
#      earliest catalog item, giving a constant offset K.
# Assumes the interleaved screens are a leading cover (constant offset), which
# holds for the linear 720 practice components. Returns the runtime id unchanged
# when the catalog is unknown or it cannot reconcile (best-effort, never raises).
import re as _re

_ITEM_SUFFIX_RE = _re.compile(r"-(\d+)$")
# How many leading cover frames the ordinal anchor is allowed to assume.
_MAX_COVER_OFFSET = 2


def _item_suffix(item_id: Optional[str]) -> Optional[int]:
    match = _ITEM_SUFFIX_RE.search(item_id or "")
    return int(match.group(1)) if match else None


def resolve_catalog_item_id(
    component_id: Optional[str],
    runtime_item_id: Optional[str],
    question_id: Optional[str] = None,
    seen_item_ids: Optional[list[str]] = None,
) -> Optional[str]:
    """Map a Kata player screen id to the catalog ``subContent`` id (see above)."""
    component = get_component(component_id) if component_id else None
    if not component or not runtime_item_id:
        return runtime_item_id
    qbi = component.get("questions_by_item") or {}
    if not qbi:
        return runtime_item_id
    catalog_ids = list(qbi.keys())
    catalog_suffix = {cid: _item_suffix(cid) for cid in catalog_ids}

    # 1. EXACT anchor: a question id owned by exactly one catalog item. Real
    #    evidence about WHICH question was answered outranks the id itself.
    if question_id:
        q = question_id.lower()
        owners = [
            cid for cid in catalog_ids
            if any((row.get("questionId") or "").lower() == q for row in (qbi.get(cid) or []))
        ]
        if len(owners) == 1:
            return owners[0]

    # 2. The id IS a screen of this component — take it at face value.
    #
    # Measured on a real session (28/07, learner on `…-01-01`): every event the
    # player sent carried a screen id that exists in the catalog (`-001`…`-005`,
    # runtime == catalog), so this component has NO cover offset. The ordinal
    # anchor below still fired whenever a SESSION happened to start on `-002`
    # (min seen 2, min catalog 1 → offset 1) and rewrote four of that session's
    # events one screen back — which is what put Yuvi's reply on the previous
    # question's thread and produced two threads captioned "שאלה 3". Guessing
    # against an id the catalog recognizes is how that happened; the ordinal
    # anchor below is for ids the catalog does NOT know.
    known_ids = {row.get("id") for row in (component.get("items") or [])} or set(catalog_ids)
    if runtime_item_id in known_ids:
        return runtime_item_id

    # 3. Ordinal anchor: earliest visited player screen == earliest catalog item.
    runtime_suffix = _item_suffix(runtime_item_id)
    valid_catalog = {c: s for c, s in catalog_suffix.items() if s is not None}
    if runtime_suffix is not None and valid_catalog:
        seen = [s for s in (_item_suffix(x) for x in (seen_item_ids or [])) if s is not None]
        seen.append(runtime_suffix)
        offset = min(seen) - min(valid_catalog.values())
        # "Earliest seen == earliest catalog item" only holds while the learner
        # actually started at the beginning. It does NOT hold when they resume
        # mid-component (the spec REQUIRES resuming where they left off) or land
        # on a late screen — there the rule silently rewound them by however far
        # in they were (observed: arriving at the video `…-01-04-006` stored
        # `…-001`, five screens back). A leading cover is one frame, maybe two;
        # anything larger is not a cover, so the id is taken at face value.
        if 0 <= offset <= _MAX_COVER_OFFSET:
            target = runtime_suffix - offset
            for cid, s in valid_catalog.items():
                if s == target:
                    return cid

    # 4. Give up gracefully — keep the runtime id (identity may already be right
    #    for a 0-offset component; a wrong-but-present id is no worse than before).
    return runtime_item_id


def resolve_object_item(
    component_id: Optional[str], object_id: Any
) -> tuple[Optional[str], Optional[str]]:
    """Recognise a statement object id as one of the component's OWN items.

    CET screens identify themselves by their catalog ``subContent`` id verbatim
    — a full metadata URL (``…/metadata/{activity}/{screen}``), which the
    ``{component}-NNN`` tail parser in ``events.resolve_item_question`` can
    never see. Without this, every CET event stores ``sub_item_id: null``, the
    coach never learns which screen the learner is on, and the teacher's
    per-question analytics see nothing (measured on a framed run, 2026-08-23).

    Returns ``(item_id, question_id)``: exact id match first, then tail match
    (some catalog rows carry a composite ``{component}-item-{url}`` id whose
    tail is still the screen id), then the tail as one of the component's OWN
    question ids (resolved to its owning item — only when exactly one owns it).
    Anything else, including the component-level object, is ``(None, None)``.
    """
    component = get_component(component_id) if component_id else None
    if not component or not isinstance(object_id, str) or not object_id:
        return None, None
    tail = object_id.rstrip("/").rsplit("/", 1)[-1]
    if not tail or tail == component_id:
        return None, None
    items = component.get("items") or []
    for row in items:
        item_id = str(row.get("id") or "")
        if item_id and (item_id == object_id or item_id.rstrip("/").rsplit("/", 1)[-1] == tail):
            return item_id, None
    qbi = component.get("questions_by_item") or {}
    owners = [
        cid for cid, rows in qbi.items()
        if any(str(row.get("questionId") or "") == tail for row in (rows or []))
    ]
    if len(owners) == 1:
        return owners[0], tail
    return None, None
