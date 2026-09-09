"""Question blueprints: generated once per learning component, validated by
code, judged for answerability, cached for every learner.

Why: the catalog ships each question as a caption for a picture inside the
CET player ("what are the coordinates of the fountain?" with no map, "now
that you saw the chess board, can you…"). Those texts are not reusable. What
IS reusable is what they tell us about the learning: the subject, the skill
the component teaches, what its questions are about, and their level.

So a blueprint is written from that **skill profile**, not from a question:
the model gets the objective, unit and component titles, the grade, the
teaching notes (common mistakes), and the catalog's question texts only as
evidence of scope and level — with an explicit rule never to reuse, quote
or reference them. It writes a small set of original generators
(``blueprint_dsl``) that cover the skill at that level, each carrying its
own context (figure), so every run of a game asks fresh, answerable
questions about what the kid actually learned.

Nothing here names a subject. The validator and the judge decide what plays.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import re
from datetime import datetime, timezone
from typing import Any, Optional

from app.brain.repository import _get_collection_named
from app.services.ai_usage import UsageContext
from app.services.games import blueprint_dsl as dsl
from app.services.games import figures
from app.services.llm import call_llm

log = logging.getLogger(__name__)

COLLECTION = "game_question_blueprints"
PROMPT_VERSION = 2
STATUS_OK = "ok"
STATUS_REVIEW = "needs_review"
STATUS_UNUSABLE = "unusable"
MAX_QUESTIONS_PER_CALL = 8
FEATURE = "feature_7_learning_games"
#: How many instances a run asks: each usable skill twice, within bounds.
RUN_MIN, RUN_MAX = 6, 12
SAMPLES_PER_BLUEPRINT = 2

_SYSTEM = """You write QUESTION BLUEPRINTS for a learning game: small JSON generators that the game instantiates with random values every time it is played. You are given a LEARNING PROFILE: the subject, what the component teaches (objective, unit, component titles), the grade, the teacher's notes with common mistakes, and — as EVIDENCE ONLY — the texts of the questions the original lesson asked. Those texts referred to pictures and screens the game does not have; NEVER reuse, quote, paraphrase or reference them (no "as you saw", no "the marked points", no "the chess board"). Use them only to understand WHAT the skill is, what its questions are about, and how hard they are. Then write ORIGINAL questions that stand on their own: each instance carries everything the student needs, as a figure when the skill is visual.

Write 6 to 8 blueprints that together cover the skill at that level: the core question type several ways, one easier warm-up, one that targets each common mistake from the notes, one slightly harder. Keep to the level: same numbers range, same vocabulary, no new concepts.

The DSL (JSON only, never code):
{
 "skill": "<one line, what the student practises>", "topic": "<2-4 words>", "level": "easy" | "core" | "stretch",
 "interaction": "choice" | "text" | "hotspot",
 "params": { "x": {"int": [1, 9]}, "v": {"float": [0.5, 4, 0.5]}, "w": {"pick": ["…", "…"]}, "obj": {"theme": "object", "default": "<a noun that fits the subject>"} },
 "derived": { "x2": "x + 3" },              // expressions on params: + - * / % min max abs round len
 "constraints": ["x != y"],                 // seeds that fail are redrawn
 "stem": "…{x}… {obj} …",                   // the question, in the students' language, slots are expressions
 "answer": "({x},{y})",                     // the accepted answer (format string)
 "accept": ["({x}, {y})"],                  // optional alternative spellings
 "distractors": ["({y},{x})", "…", "…"],    // choice only: at least 3, the common mistakes, formatted exactly like the answer, never equal to it
 "figure": <figure or null>,
 "variants": [ { "stem": "…", "answer": "…", "distractors": [...], "figure": … }, … ]   // optional: for facts that cannot be computed; each variant must be TRUE and grounded in the profile
}
Figures (all positions are expressions on params):
 - graphic: {"frame": {"axes": {"x": [0,10], "y": [0,10]}} | {"axis": {"x": [0,20]}} | {"box": [10,8]}, "labels": {"x":"…","y":"…"},
             "items": [ {"kind":"point","at":["x","y"],"label":"A","target":"A"}, {"kind":"icon","at":["x","y"],"icon":"obj"},
                        {"kind":"label","at":[x,y],"text":"…"}, {"kind":"segment"|"arrow","from":[..],"to":[..],"label":"…","style":"dashed"},
                        {"kind":"polygon","points":[[..],[..],[..]],"label":"…"}, {"kind":"rect","at":[x,y],"w":..,"h":..,"label":"…"},
                        {"kind":"ellipse","at":[x,y],"rx":..,"ry":..}, {"kind":"bar","at":[x,0],"value":"v","label":"…"} ] }
 - text:    {"text": "sentence with {w}", "spans": [{"text": "{w}", "mark": "highlight"|"underline"|"blank", "target": "t1"}]}
 - table:   {"table": {"rows": [["header","…"],["{a}","{b}"]], "header": true}}
 "target" ids make an element clickable for "hotspot"; then "answer" is the target id of the correct element.
 "icon": "obj" draws the theme icon of param obj (a theme param is a noun the game may re-skin: fountain → asteroid).

Rules:
 1. Every instance must be answerable from stem + figure alone. When the skill is about something visual (positions, shapes, graphs, a sentence, a table), DRAW it in the figure.
 2. Prefer parametric randomness (numbers, positions, words from a bank) over variants. Use variants only for facts; never invent facts, dates or definitions that are not in the profile.
 3. Ranges must keep every figure position inside its frame. Integers unless the level clearly uses decimals.
 4. PHRASING: every stem is ONE short, plain question with ONE answer — at most one "?", no fill-in templates ("x=?", "___", lists of items to complete), no "mark two", no "in the picture" unless there is a figure. A 12-year-old reads it once and knows exactly what to answer. Every number the answer needs is in the stem or drawn in the figure. Never a yes/no self-check ("can you now…").
 5. Stems ≤ 140 characters, in the students' language, friendly, no answer leak in the stem.
Reply with JSON only: {"blueprints": [ … ]}"""

_JUDGE = """You check whether a quiz question is answerable, unambiguous and cleanly phrased from what a student sees. You get the question text, a description of the figure shown (if any) and the options (if any). First solve it yourself as a student would; then you are told the expected answer. Reply JSON only: {"answer": "<your answer>", "answerable": true|false, "clean": true|false, "reason": "<one short sentence>"}. "answerable" is false when the question refers to things that are not shown, needs numbers that are not given, has several defensible answers, or the expected answer contradicts what is shown. "clean" is false when the wording is not ONE plain question with ONE answer (several blanks, "x=?" templates, lists to complete, "mark two", clumsy or ambiguous phrasing a 12-year-old would have to re-read)."""


# ── ids and rows ─────────────────────────────────────────────────────────────

def profile_fingerprint(component: dict[str, Any]) -> str:
    """What the blueprints were written from: the question texts and notes
    of the component. A catalog re-import that changes them regenerates."""
    rows = [str(row.get("questionText") or "") for _, row in _question_rows(component)]
    raw = json.dumps({"t": component.get("title"), "q": rows, "n": str(component.get("information_to_bot") or "")[:2000]},
                     ensure_ascii=False, sort_keys=True)
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:12]


def blueprint_id(component_id: str, fingerprint: str, index: int) -> str:
    return f"bp:{component_id}|{fingerprint}|v{dsl.DSL_VERSION}.{PROMPT_VERSION}|{index}"


def _question_rows(component: dict[str, Any]) -> list[tuple[str, dict[str, Any]]]:
    out = []
    for item_id, rows in (component.get("questions_by_item") or {}).items():
        for row in rows or []:
            if isinstance(row, dict) and row.get("questionId") and str(row.get("questionText") or "").strip():
                out.append((str(item_id), row))
    return out


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── cache ────────────────────────────────────────────────────────────────────

async def _load(ids: list[str]) -> dict[str, dict[str, Any]]:
    handle = _get_collection_named(COLLECTION)
    if handle is None or not ids:
        return {}
    try:
        return {doc["_id"]: doc async for doc in handle.find({"_id": {"$in": ids}})}
    except Exception as exc:  # pragma: no cover
        log.warning("blueprint cache read failed: %s", type(exc).__name__)
        return {}


async def _save(doc: dict[str, Any]) -> None:
    handle = _get_collection_named(COLLECTION)
    if handle is None:
        return
    try:
        await handle.replace_one({"_id": doc["_id"]}, doc, upsert=True)
    except Exception as exc:  # pragma: no cover
        log.warning("blueprint cache write failed: %s", type(exc).__name__)


async def cached_for_component(component_id: str, fingerprint: Optional[str] = None) -> list[dict[str, Any]]:
    """Every stored blueprint doc of a component (any status), for the
    current DSL/prompt version and, when given, the current profile."""
    handle = _get_collection_named(COLLECTION)
    if handle is None:
        return []
    query: dict[str, Any] = {"component_id": component_id, "dsl_version": dsl.DSL_VERSION, "prompt_version": PROMPT_VERSION}
    if fingerprint:
        query["fingerprint"] = fingerprint
    try:
        return sorted([doc async for doc in handle.find(query)], key=lambda d: int(d.get("index") or 0))
    except Exception as exc:  # pragma: no cover
        log.warning("blueprint cache read failed: %s", type(exc).__name__)
        return []


# ── generation ───────────────────────────────────────────────────────────────

def _usage(actor_id: str, operation: str) -> UsageContext:
    return UsageContext(
        actor_id=actor_id, actor_type="learner", endpoint="internal:game_blueprints",
        feature=FEATURE, operation=operation, source="games.blueprints",
    )


def _profile(component: dict[str, Any], unit: dict[str, Any], objective: dict[str, Any], language: str) -> dict[str, Any]:
    notes = re.sub(r"\s+", " ", str(component.get("information_to_bot") or "")).strip()[:2400]
    evidence = [{
        "type": str(row.get("questionType") or ""),
        "text": str(row.get("questionText") or "")[:300],
        "answer_shape": [str(a)[:60] for a in (row.get("correctAnswers") or [])][:3],
    } for _, row in _question_rows(component)][:16]
    return {
        "subject": str(unit.get("subject") or objective.get("subject") or component.get("subject") or ""),
        "grade": str(unit.get("grade") or objective.get("grade") or ""),
        "objective": str(objective.get("title") or ""),
        "unit": str(unit.get("title") or ""),
        "component": str(component.get("title") or ""),
        "purpose": str(component.get("purpose") or ""),
        "student_language": language,
        "teacher_notes": notes,
        "evidence_of_scope_and_level": evidence,
    }


async def _generate(profile: dict[str, Any], *, actor_id: str,
                    repair: Optional[list[dict[str, Any]]] = None) -> list[dict[str, Any]]:
    """One model call → the component's blueprints (a repair call gets the
    failed ones back with the validator's messages)."""
    user = f"LEARNING PROFILE:\n{json.dumps(profile, ensure_ascii=False)}"
    if repair:
        user += ("\n\nThese blueprints failed validation; return corrected versions of THESE ONLY, same skills:\n"
                 + json.dumps(repair, ensure_ascii=False))
    reply = await call_llm(
        [{"role": "system", "content": _SYSTEM}, {"role": "user", "content": user}],
        usage_context=_usage(actor_id, "game.blueprints"),
        max_tokens=7000, json_mode=True, model_tier="strong", timeout=180,
    )
    try:
        data = json.loads(reply or "{}")
    except (TypeError, ValueError):
        return []
    items = (data.get("blueprints") if isinstance(data, dict) else None) or []
    return [bp for bp in items if isinstance(bp, dict)][:10]


async def _judge(blueprint: dict[str, Any], *, actor_id: str) -> dict[str, Any]:
    """Solve one instance without the key, then confirm answerability."""
    inst = dsl.instantiate(blueprint, "judge-0")
    shown = {
        "question": inst["text"],
        "figure": inst["alt"] or None,
        "options": inst["options"] or None,
        "interaction": inst["interaction"],
        "targets": figures.targets(inst["figure"]) if inst["figure"] and inst["interaction"] == "hotspot" else None,
    }
    user = (f"WHAT THE STUDENT SEES:\n{json.dumps(shown, ensure_ascii=False)}\n\n"
            f"EXPECTED ANSWER: {inst['answer']}")
    reply = await call_llm(
        [{"role": "system", "content": _JUDGE}, {"role": "user", "content": user}],
        usage_context=_usage(actor_id, "game.blueprint_judge"),
        max_tokens=300, json_mode=True, model_tier="mini", timeout=40,
    )
    try:
        data = json.loads(reply or "{}")
    except (TypeError, ValueError):
        data = {}
    answer = str((data or {}).get("answer") or "").strip()
    answerable = bool((data or {}).get("answerable"))
    clean = (data or {}).get("clean", True) is not False
    agrees = _same(answer, inst["accept"])
    return {"answer": answer, "answerable": answerable, "clean": clean, "agrees": agrees,
            "reason": str((data or {}).get("reason") or "")[:300]}


def _same(answer: str, accept: list[str]) -> bool:
    from app.services.games import instances  # local import: instances imports this module
    return any(instances.normalize(answer) == instances.normalize(a) for a in accept)


def _doc(component_id: str, fingerprint: str, index: int, blueprint: dict[str, Any],
         errors: list[str], judge: Optional[dict[str, Any]]) -> dict[str, Any]:
    if errors:
        status = STATUS_UNUSABLE
    elif judge is None or (judge.get("answerable") and judge.get("agrees") and judge.get("clean", True)):
        status = STATUS_OK
    else:
        status = STATUS_REVIEW
    return {
        "_id": blueprint_id(component_id, fingerprint, index),
        "component_id": component_id, "fingerprint": fingerprint, "index": index,
        "skill": str(blueprint.get("skill") or ""), "topic": str(blueprint.get("topic") or ""),
        "level": str(blueprint.get("level") or "core"),
        "dsl_version": dsl.DSL_VERSION, "prompt_version": PROMPT_VERSION,
        "blueprint": blueprint, "status": status, "errors": errors[:6], "judge": judge,
        "created_at": _now(),
    }


#: One generation per component at a time in this process: the studio warms
#: a component on pick and the create asks again seconds later.
_inflight: dict[str, "asyncio.Task[list[dict[str, Any]]]"] = {}


async def ensure_blueprints(component: dict[str, Any], unit: Optional[dict[str, Any]] = None,
                            objective: Optional[dict[str, Any]] = None, *, actor_id: str = "system",
                            language: str = "he") -> list[dict[str, Any]]:
    """The component's blueprint docs: cached when the profile is unchanged,
    otherwise generated from the learning profile, validated (one repair
    round) and judged. Returns all docs; ``usable`` filters what plays."""
    component_id = str(component.get("id") or "")
    fingerprint = profile_fingerprint(component)
    docs = await cached_for_component(component_id, fingerprint)
    if docs:
        return docs
    key = f"{component_id}|{fingerprint}"
    task = _inflight.get(key)
    if task is None:
        task = asyncio.create_task(_generate_all(component, unit, objective, actor_id=actor_id, language=language,
                                                 component_id=component_id, fingerprint=fingerprint))
        _inflight[key] = task
        task.add_done_callback(lambda _t: _inflight.pop(key, None))
    return await asyncio.shield(task)


async def _generate_all(component: dict[str, Any], unit: Optional[dict[str, Any]], objective: Optional[dict[str, Any]],
                        *, actor_id: str, language: str, component_id: str, fingerprint: str) -> list[dict[str, Any]]:

    profile = _profile(component, unit or {}, objective or {}, language)
    try:
        generated = await _generate(profile, actor_id=actor_id)
    except Exception as exc:
        log.warning("blueprint generation failed: %s", type(exc).__name__)
        generated = []
    errors = [dsl.validate_blueprint(bp) for bp in generated]
    broken = [{"blueprint": bp, "errors": errs} for bp, errs in zip(generated, errors) if errs]
    if broken:
        try:
            repaired = await _generate(profile, actor_id=actor_id, repair=broken)
        except Exception as exc:
            log.warning("blueprint repair failed: %s", type(exc).__name__)
            repaired = []
        by_skill = {str(bp.get("skill") or ""): bp for bp in repaired}
        for i, (bp, errs) in enumerate(zip(generated, errors)):
            fixed = by_skill.get(str(bp.get("skill") or "")) if errs else None
            if fixed is not None:
                fixed_errors = dsl.validate_blueprint(fixed)
                if not fixed_errors:
                    generated[i], errors[i] = fixed, []
                else:
                    errors[i] = fixed_errors

    async def judge_or_none(bp: dict[str, Any], errs: list[str]) -> Optional[dict[str, Any]]:
        if errs:
            return None
        try:
            return await _judge(bp, actor_id=actor_id)
        except Exception as exc:
            log.warning("blueprint judge failed: %s", type(exc).__name__)
            return None

    # Judges are independent: one round trip for all of them, not one each.
    judges = await asyncio.gather(*(judge_or_none(bp, errs) for bp, errs in zip(generated, errors)))
    docs = []
    for index, (bp, errs, judge) in enumerate(zip(generated, errors, judges)):
        doc = _doc(component_id, fingerprint, index, bp, errs, judge)
        await _save(doc)
        docs.append(doc)
    return docs


def usable(docs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [d for d in docs if d.get("status") == STATUS_OK and isinstance(d.get("blueprint"), dict)]


def run_total(usable_count: int) -> int:
    if usable_count <= 0:
        return 0
    return min(RUN_MAX, max(RUN_MIN, usable_count * 2))


# ── what the builder and the validator get ───────────────────────────────────

def public_instance(inst: dict[str, Any], instance_id: str, index: int, total: int) -> dict[str, Any]:
    """The instance without its key: what the game receives from ``next()``."""
    rendered = figures.render(inst["figure"]) if inst.get("figure") else None
    return {
        "id": instance_id, "text": inst["text"], "type": inst["interaction"],
        "answers": list(inst["options"] or []),
        "figure": rendered["html"] if rendered else None,
        "alt": rendered["alt"] if rendered else "",
        "targets": figures.targets(inst["figure"]) if inst.get("figure") and inst["interaction"] == "hotspot" else [],
        "index": index, "total": total,
    }


def summaries(docs: list[dict[str, Any]], theme_vocab: Optional[dict[str, Any]] = None) -> list[dict[str, Any]]:
    """Per blueprint: the skill line and two sample instances, for the prompt."""
    out = []
    for doc in usable(docs):
        bp = doc["blueprint"]
        samples = []
        for n in range(SAMPLES_PER_BLUEPRINT):
            try:
                inst = dsl.instantiate(bp, f"sample-{n}", theme_vocab)
            except dsl.DslError:
                continue
            samples.append({"text": inst["text"], "options": inst["options"], "figure": inst["alt"] or None})
        out.append({"skill": str(bp.get("skill") or ""), "topic": doc.get("topic"), "level": doc.get("level"),
                    "interaction": bp.get("interaction"), "samples": samples})
    return out


def fixtures(docs: list[dict[str, Any]], total: int, theme_vocab: Optional[dict[str, Any]] = None,
             seed: str = "fixture") -> tuple[list[dict[str, Any]], dict[str, list[str]]]:
    """Pre-instantiated questions (+ key) for the headless validator, which
    runs with no server to ask. Same shape as ``next()`` returns."""
    usable_docs = usable(docs)
    questions, key = [], {}
    if not usable_docs or total <= 0:
        return questions, key
    for index in range(total):
        doc = usable_docs[index % len(usable_docs)]
        try:
            inst = dsl.instantiate(doc["blueprint"], f"{seed}-{index}", theme_vocab)
        except dsl.DslError:
            continue
        instance_id = f"fx-{index}-{hashlib.sha1(doc['_id'].encode()).hexdigest()[:6]}"
        questions.append(public_instance(inst, instance_id, index, total))
        key[instance_id] = list(inst["accept"])
    for i, q in enumerate(questions):
        q["index"], q["total"] = i, len(questions)
    return questions, key
