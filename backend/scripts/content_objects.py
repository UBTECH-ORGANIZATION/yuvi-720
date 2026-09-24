"""From a walked screen to the slide's object catalog (capture v8), and the
checks that decide which screen belongs to which slide.

The walker (frontend/scripts/content-extract.mjs) records ATOMS — everything
on the screen a coach could mean, with its text (dump only) and its rect at
every grid size. This module turns them into OBJECTS for the public shard:
kind, role, a template or validated Hebrew label, and rects — never the
vendor's text. Classification is deterministic and uses the catalog:

- the question text is the tightest block covering the question's words;
- each answer row is matched to the catalog's option list by its text, so
  ``option_index`` means the same option wherever the player draws it (and is
  left out when the match is not certain — a wrong index would mark the wrong
  answer);
- containers, controls ("בדיקה", "הבא"), repeated decoration and anything the
  learner cannot actually see are dropped.

Nothing here decides what the coach marks — that is the runtime resolver.
Nothing here writes a correct answer: labels are templates or pass the same
AnswerGuard the coach's replies do.
"""

from __future__ import annotations

import re
from collections import Counter
from typing import Any, Optional

from app.agents import answer_guard

OBJECT_CAP = 40

#: Buttons and chrome — words a screen shows that are not content.
CONTROL_TEXTS = frozenset({
    "בדיקה", "בדוק", "המשך", "הבא", "הקודם", "חזרה", "שליחה", "התחל", "נתחיל",
    "צדקתי?", "אפשר רמז?", "מצאתם בעיה?", "קדימה", "בחרתי", "סיום",
})
#: Words a model/derived label may never carry: they grade, or they point at
#: the answer. Template labels are exempt (safe by construction).
FORBIDDEN_LABEL_WORDS = ("נכון", "נכונה", "שגוי", "שגויה", "טעות", "פתרון",
                         "correct", "wrong", "answer")
_HEBREW = re.compile("[֐-׿]")


# ── text similarity (the answer guard's own reduction) ──────────────────────

def stems(text: str) -> set[str]:
    return answer_guard.stems(text or "")


def coverage(needle: str, haystack_stems: set[str]) -> float:
    """Share of ``needle``'s stems present in ``haystack_stems``."""
    wanted = stems(needle)
    if not wanted:
        return 0.0
    return len(wanted & haystack_stems) / len(wanted)


def _norm(text: str) -> str:
    return answer_guard.normalize(text or "")


# ── geometry per grid row ────────────────────────────────────────────────────

def _grid_rects(atom_n: int, screen: dict[str, Any]) -> list[Optional[list[float]]]:
    """The atom's rect at each grid row, as [x, y, w, h] (or None)."""
    samples = {(s["w"], s["h"]): s for s in screen.get("object_samples") or []}
    out: list[Optional[list[float]]] = []
    for w, h, _, _ in screen.get("grid") or []:
        rect = ((samples.get((w, h)) or {}).get("rects") or {}).get(str(atom_n))
        out.append([round(rect["x"]), round(rect["y"]), round(rect["w"]), round(rect["h"])]
                   if isinstance(rect, dict) else None)
    return out


def _union(rect_lists: list[list[Optional[list[float]]]]) -> list[Optional[list[float]]]:
    rows = len(rect_lists[0]) if rect_lists else 0
    out: list[Optional[list[float]]] = []
    for index in range(rows):
        rects = [r[index] for r in rect_lists if r[index] is not None]
        if not rects:
            out.append(None)
            continue
        left = min(r[0] for r in rects)
        top = min(r[1] for r in rects)
        right = max(r[0] + r[2] for r in rects)
        bottom = max(r[1] + r[3] for r in rects)
        out.append([left, top, right - left, bottom - top])
    return out


def _present_share(rects: list[Optional[list[float]]]) -> float:
    return sum(1 for r in rects if r is not None) / len(rects) if rects else 0.0


def _area(rect: Optional[list[float]]) -> float:
    return rect[2] * rect[3] if rect else 0.0


# ── classification ───────────────────────────────────────────────────────────

def _is_control(atom: dict[str, Any]) -> bool:
    text = " ".join(str(atom.get("text") or "").split())
    return atom.get("kind") == "text" and (text in CONTROL_TEXTS or len(text) < 3)


def _descendants(atoms: list[dict[str, Any]]) -> dict[int, set[int]]:
    parent = {a["n"]: a.get("parent") for a in atoms}
    out: dict[int, set[int]] = {a["n"]: set() for a in atoms}
    for atom in atoms:
        seen: set[int] = set()
        node = parent.get(atom["n"])
        while node and node not in seen:
            seen.add(node)
            out.setdefault(node, set()).add(atom["n"])
            node = parent.get(node)
    return out


def _display_order(rects: list[Optional[list[float]]], grid_index: int) -> tuple:
    """Reading order in a right-to-left lesson: rows top-down, right first."""
    rect = rects[grid_index] if grid_index < len(rects) else None
    if not rect:
        return (1e9, 0)
    return (round(rect[1] / 8), -(rect[0] + rect[2]))


def _label_ok(label: str, guards: list[answer_guard.AnswerGuard],
              correct_texts: list[str]) -> bool:
    """A derived (non-template) label may reach the public shard only if it
    grades nothing and names no correct answer."""
    if not label or len(label) > 40 or "\n" in label or not _HEBREW.search(label):
        return False
    lowered = label.lower()
    if any(word in lowered for word in FORBIDDEN_LABEL_WORDS):
        return False
    if any(guard.reveals(label) for guard in guards):
        return False
    numbers = set(re.findall(r"\d+(?:[.,]\d+)?", label))
    for answer in correct_texts:
        if numbers & set(re.findall(r"\d+(?:[.,]\d+)?", answer)):
            return False
    return True


def build_objects(
    screen: dict[str, Any],
    slide: dict[str, Any],
    *,
    decorative_digests: frozenset[str] = frozenset(),
    graphic_labels: Optional[dict[str, str]] = None,
) -> tuple[list[dict[str, Any]], list[dict[str, str]]]:
    """(objects, rejections) for one slide from its verified screen.

    ``decorative_digests``: image sources that repeat across the lomda (the
    mascot) — never pointable. ``graphic_labels``: src digest → short Hebrew
    label from the vision pass. Correct answers are read from the in-memory
    model only to VET labels; they never reach an object.
    """
    grid = screen.get("grid") or []
    atoms = [a for a in screen.get("atoms") or [] if isinstance(a, dict)]
    if not grid or not atoms:
        return [], []
    primary = next((i for i, row in enumerate(grid) if row[0] == 1280 and row[1] == 860),
                   len(grid) - 1)
    questions = [q for q in slide.get("questions") or [] if q.get("question_id")]
    guards = [answer_guard.AnswerGuard(q.get("correct") or [], q.get("answers") or [])
              for q in questions]
    correct_texts = [str(c) for q in questions for c in (q.get("correct") or [])]
    rejections: list[dict[str, str]] = []
    rects = {a["n"]: _grid_rects(a["n"], screen) for a in atoms}
    by_n = {a["n"]: a for a in atoms}
    descendants = _descendants(atoms)

    def reject(atom: dict[str, Any], reason: str) -> None:
        rejections.append({"atom": str(atom["n"]), "kind": str(atom.get("kind")),
                           "reason": reason})

    usable: dict[int, dict[str, Any]] = {}
    for atom in atoms:
        n = atom["n"]
        kind = atom.get("kind")
        if _present_share(rects[n]) < 0.6:
            reject(atom, "not measurable at most sizes")
            continue
        if _is_control(atom):
            reject(atom, "control or chrome")
            continue
        if kind == "image" and atom.get("src_digest") in decorative_digests:
            reject(atom, "decorative (repeats across the lesson)")
            continue
        if kind == "text":
            inner = [by_n[d] for d in descendants.get(n, set()) if d in by_n]
            if len(inner) >= 2:
                reject(atom, "container")
                continue
            same = [d for d in inner if _norm(d.get("text")) == _norm(atom.get("text"))]
            if same:
                reject(atom, "duplicate of an inner block")
                continue
        usable[n] = atom

    objects: list[dict[str, Any]] = []
    taken: set[int] = set()

    def emit(obj: dict[str, Any], members: list[int]) -> None:
        if len(objects) >= OBJECT_CAP:
            return
        objects.append(obj)
        taken.update(members)

    # ── question text, one per question ──
    text_atoms = [a for a in usable.values() if a.get("kind") == "text"]
    multi = len(questions) > 1
    for index, question in enumerate(questions, 1):
        qtext = str(question.get("question_text") or "")
        best: Optional[tuple[float, float, dict[str, Any]]] = None
        for atom in text_atoms:
            if atom["n"] in taken:
                continue
            score = coverage(qtext, stems(atom.get("text") or ""))
            if score < 0.6:
                continue
            area = _area(rects[atom["n"]][primary])
            if best is None or (score, -area) > (best[0], -best[1]):
                best = (score, area, atom)
        if best:
            atom = best[2]
            emit({"id": f"stem:{question['question_id']}", "kind": "stem",
                  "role": "stem", "q": [question["question_id"]],
                  "label_he": f"סעיף {index}" if multi else "השאלה",
                  "r": rects[atom["n"]]}, [atom["n"]])

    # ── answer options, matched to the catalog ──
    option_atoms = [a for a in usable.values() if a.get("kind") == "option"]
    by_question: dict[str, list[dict[str, Any]]] = {}
    for atom in option_atoms:
        text = _norm(atom.get("text"))
        owner = None
        for question in questions:
            if any(text and text == _norm(ans) for ans in question.get("answers") or []):
                owner = question
                break
        if owner is None and len(questions) == 1:
            owner = questions[0]
        if owner is None:
            reject(atom, "option of no known question")
            continue
        by_question.setdefault(owner["question_id"], []).append(atom)
    for question in questions:
        members = by_question.get(question["question_id"]) or []
        if not members:
            continue
        qid = question["question_id"]
        group_id = f"opts:{qid}"
        emit({"id": group_id, "kind": "options", "role": "answer_area", "q": [qid],
              "label_he": "התשובות", "r": _union([rects[a["n"]] for a in members])},
             [a["n"] for a in members])
        answers = [_norm(a) for a in question.get("answers") or []]
        ordered = sorted(members, key=lambda a: _display_order(rects[a["n"]], primary))
        for ordinal, atom in enumerate(ordered, 1):
            text = _norm(atom.get("text"))
            matches = [i for i, ans in enumerate(answers) if ans and ans == text]
            index = matches[0] if len(matches) == 1 else None
            emit({"id": f"opt:{qid}:{index}" if index is not None else f"opt:{qid}:d{ordinal}",
                  "kind": "option", "role": "answer_area", "q": [qid],
                  "parent": group_id, "option_index": index,
                  "label_he": f"אפשרות {ordinal}", "r": rects[atom["n"]]},
                 [atom["n"]])

    # ── inputs ──
    inputs = [a for a in usable.values() if a.get("kind") == "input"]
    inputs.sort(key=lambda a: _display_order(rects[a["n"]], primary))
    for ordinal, atom in enumerate(inputs, 1):
        owner = next((o for o in objects if o["kind"] == "stem"
                      and by_n.get(atom.get("parent") or 0) is not None
                      and rects[atom.get("parent")] == o["r"]), None)
        q = owner["q"] if owner else ([questions[0]["question_id"]] if len(questions) == 1 else [])
        emit({"id": f"inp:{ordinal}", "kind": "input", "role": "answer_area", "q": q,
              "label_he": "המקום לתשובה" if len(inputs) == 1 else f"המקום לתשובה {ordinal}",
              "r": rects[atom["n"]]}, [atom["n"]])

    # ── graphics, video, tables, formulas ──
    is_question_screen = slide.get("role") in ("question", "mixed") and bool(questions)
    seen_ids: Counter = Counter()

    def unique(base: str) -> str:
        seen_ids[base] += 1
        return base if seen_ids[base] == 1 else f"{base}.{seen_ids[base]}"

    counters: Counter = Counter()
    for atom in sorted(usable.values(), key=lambda a: a.get("order", 0)):
        n = atom["n"]
        kind = atom.get("kind")
        if n in taken:
            continue
        if kind == "image":
            digest = str(atom.get("src_digest") or "").replace("sha1:", "")[:8] or str(n)
            label = (graphic_labels or {}).get(str(atom.get("src_digest") or ""), "")
            emit({"id": unique(f"img:{digest}"), "kind": "image",
                  "role": "data" if is_question_screen else "teaching",
                  "label_he": label if _label_ok(label, guards, correct_texts) else "התמונה",
                  "r": rects[n]}, [n])
        elif kind == "video":
            counters["vid"] += 1
            emit({"id": f"vid:{counters['vid']}", "kind": "video", "role": "teaching",
                  "label_he": "הסרטון", "r": rects[n]}, [n])
        elif kind == "diagram":
            counters["dia"] += 1
            dia_id = f"dia:{counters['dia']}"
            emit({"id": dia_id, "kind": "diagram",
                  "role": "data" if is_question_screen else "teaching",
                  "label_he": "התרשים", "r": rects[n]}, [n])
            parts = [a for a in usable.values()
                     if a.get("kind") == "svg_part" and a.get("parent") == n]
            for j, part in enumerate(parts[:12], 1):
                text = " ".join(str(part.get("text") or "").split())
                label = f"הסימון {text}" if 0 < len(text) <= 6 else "חלק בתרשים"
                if not _label_ok(label, guards, correct_texts):
                    label = "חלק בתרשים"
                emit({"id": f"{dia_id}.p{j}", "kind": "diagram_part",
                      "role": "answer_area" if part.get("interactive") else "data",
                      "parent": dia_id, "label_he": label, "r": rects[part["n"]]},
                     [part["n"]])
        elif kind == "table":
            counters["tbl"] += 1
            tbl_id = f"tbl:{counters['tbl']}"
            emit({"id": tbl_id, "kind": "table", "role": "data",
                  "label_he": "הטבלה", "r": rects[n]}, [n])
            rows = [a for a in usable.values() if a.get("kind") == "table_row"
                    and a.get("parent") == n]
            for j, row in enumerate(rows[:12], 1):
                emit({"id": f"{tbl_id}.r{j}", "kind": "table_row", "role": "data",
                      "parent": tbl_id, "label_he": f"שורה {j} בטבלה",
                      "r": rects[row["n"]]}, [row["n"]])
            cols = [a for a in usable.values() if a.get("kind") == "table_col"
                    and by_n.get(a.get("parent") or 0, {}).get("parent") == n]
            for j, col in enumerate(cols[:8], 1):
                members = [col["n"]] + [m for m in col.get("members") or [] if m in rects]
                header = " ".join(str(col.get("text") or "").split())
                label = f"עמודה: {header}" if 0 < len(header) <= 28 else f"עמודה {j} בטבלה"
                if not _label_ok(label, guards, correct_texts):
                    label = f"עמודה {j} בטבלה"
                emit({"id": f"{tbl_id}.c{j}", "kind": "table_col", "role": "data",
                      "parent": tbl_id, "label_he": label,
                      "r": _union([rects[m] for m in members])}, members)
        elif kind == "formula":
            counters["fx"] += 1
            emit({"id": f"fx:{counters['fx']}", "kind": "formula", "role": "data",
                  "label_he": "הנוסחה", "r": rects[n]}, [n])

    # ── remaining text blocks: instructions / teaching text (≤6) ──
    remaining = [a for a in text_atoms if a["n"] not in taken
                 and not any(a["n"] in descendants.get(t, set()) for t in taken)]
    for ordinal, atom in enumerate(
            sorted(remaining, key=lambda a: _display_order(rects[a["n"]], primary))[:6], 1):
        heading = str(atom.get("tag") or "") in {"h1", "h2", "h3", "h4"}
        emit({"id": f"txt:{ordinal}", "kind": "text",
              "role": "instruction" if is_question_screen else "teaching",
              "label_he": "הכותרת" if heading
              else "ההוראות" if is_question_screen else "הטקסט",
              "r": rects[atom["n"]]}, [atom["n"]])

    # Rects that fail the runtime's own sanity rules are blanked here, so the
    # shard never carries geometry the runtime would refuse.
    from app.services import content_intelligence as ci
    for obj in objects:
        obj["r"] = [None if rect is None or ci._rect_problem(rect, row) else rect
                    for rect, row in zip(obj["r"], grid)]
        # compact keys, stable order
        for key in ("parent", "option_index"):
            if obj.get(key) is None:
                obj.pop(key, None)
    return objects, rejections


def decorative_image_digests(screens: list[dict[str, Any]]) -> frozenset[str]:
    """Small images on at least half the lesson's DISTINCT screens (and ≥3)
    are its furniture — the companion mascot, a logo — not content.

    Distinct: a question captured clean and then in two feedback states is
    one screen, or its own photo would count three times and be thrown out
    (measured on mass-measure-02-01). Small: under 6% of the viewport — a
    content photo repeated across a lesson is still content."""
    distinct: list[dict[str, Any]] = []
    seen: list[set[str]] = []
    for screen in screens:
        words = _screen_stems(screen)
        if any(_jaccard(words, other) >= 0.9 for other in seen):
            continue
        seen.append(words)
        distinct.append(screen)
    counts: Counter = Counter()
    for screen in distinct:
        viewport = 1280 * 860
        digests = {a.get("src_digest") for a in screen.get("atoms") or []
                   if a.get("kind") == "image" and a.get("src_digest")
                   and (a.get("rect") or {}).get("w", 0) * (a.get("rect") or {}).get("h", 0)
                   < 0.06 * viewport}
        counts.update(digests)
    floor = max(3, (len(distinct) + 1) // 2)
    return frozenset(d for d, c in counts.items() if c >= floor)


# ── which screen is which slide ─────────────────────────────────────────────

def _screen_stems(screen: dict[str, Any]) -> set[str]:
    return stems(screen.get("visible_text") or "")


def _jaccard(a: set[str], b: set[str]) -> float:
    return len(a & b) / len(a | b) if (a or b) else 0.0


def _slide_matches(slide: dict[str, Any], screen_stems: set[str],
                   title: str) -> bool:
    """The screen shows THIS slide: its own question words (≥4 stems, ≥60%
    found) or, for slides without questions, its title (≥2 stems, ≥75%)."""
    for question in slide.get("questions") or []:
        words = stems(question.get("question_text") or "")
        if len(words) >= 4:
            return len(words & screen_stems) / len(words) >= 0.6
    title_words = stems(slide.get("title") or "")
    if len(title_words) >= 2:
        found = len(title_words & (screen_stems | stems(title))) / len(title_words)
        return found >= 0.75
    return False


def assign_screens(
    screens: list[dict[str, Any]], slides: list[dict[str, Any]],
    page_id_of,
) -> dict[str, dict[str, Any]]:
    """item_id → {"screen", "method"}: every assignment is VERIFIED.

    1. page_id — the player announced the slide's own id (CET item ids ARE its
       page ids since 09/2026);
    2. text — the slide's own question (or title) words are on the screen;
    3. sandwich — a slide without questions between two verified neighbours
       takes the single screen between theirs, if the media kind agrees.
    A screen that nearly duplicates one already given to another slide (a
    walk stuck on a gated page, a post-answer feedback state) is refused.
    """
    assigned: dict[str, dict[str, Any]] = {}
    used: set[int] = set()
    screen_stems = [_screen_stems(s) for s in screens]

    def duplicate(index: int) -> bool:
        return any(_jaccard(screen_stems[index], screen_stems[j]) >= 0.9 for j in used)

    by_id = {str(s.get("item_id")): s for s in slides}
    for index, screen in enumerate(screens):
        page_id = page_id_of(screen)
        if page_id and page_id in by_id and page_id not in assigned:
            assigned[page_id] = {"screen": screen, "method": "page_id"}
            used.add(index)
    for slide in slides:
        iid = str(slide.get("item_id"))
        if iid in assigned:
            continue
        for index, screen in enumerate(screens):
            if index in used or duplicate(index):
                continue
            if _slide_matches(slide, screen_stems[index], str(screen.get("title") or "")):
                assigned[iid] = {"screen": screen, "method": "text"}
                used.add(index)
                break
    positions = {str(s.get("item_id")): i for i, s in enumerate(slides)}
    screen_index = {id(s): i for i, s in enumerate(screens)}
    for i, slide in enumerate(slides):
        iid = str(slide.get("item_id"))
        if iid in assigned or slide.get("questions"):
            continue
        before = next((assigned[str(slides[k]["item_id"])] for k in range(i - 1, -1, -1)
                       if str(slides[k]["item_id"]) in assigned), None)
        after = next((assigned[str(slides[k]["item_id"])] for k in range(i + 1, len(slides))
                      if str(slides[k]["item_id"]) in assigned), None)
        if not before or not after:
            continue
        lo, hi = screen_index[id(before["screen"])], screen_index[id(after["screen"])]
        between = [k for k in range(lo + 1, hi) if k not in used and not duplicate(k)]
        if len(between) != 1:
            continue
        candidate = screens[between[0]]
        has_video = any(m.get("kind") == "video" for m in candidate.get("media") or [])
        if (slide.get("role") == "video") != has_video:
            continue
        assigned[iid] = {"screen": candidate, "method": "sandwich"}
        used.add(between[0])
    del positions
    return assigned


def reverify_capture(slide: dict[str, Any], enrichment: dict[str, Any]) -> tuple[bool, str]:
    """Does a committed capture still show its slide? (v7 captures were
    mapped by position and ~7 of 16 sat on the wrong slide.)"""
    method = (enrichment.get("mapping") or {}).get("method")
    if method == "page_id":
        return True, "page_id"
    visible = stems(enrichment.get("visible_text") or "")
    if _slide_matches(slide, visible, ""):
        return True, "text"
    if not slide.get("questions") and method == "sandwich":
        return True, "sandwich"
    return False, "the captured screen does not show this slide"


# ── carrying work across Kata's renames ─────────────────────────────────────

def match_prior_slides(
    new_slides: list[dict[str, Any]], old_slides: list[dict[str, Any]],
) -> dict[str, tuple[dict[str, Any], bool]]:
    """new item_id → (old slide, capture_may_carry).

    Same id first. Otherwise an old slide whose id vanished, with the same
    fingerprint (which never included the id) — unique, or unique at the same
    position. Strictly one-to-one. The capture carries only when the old
    capture does not name a DIFFERENT page (CET item ids are its page ids now:
    an old capture whose page id is not the new id was the wrong screen).
    """
    out: dict[str, tuple[dict[str, Any], bool]] = {}
    new_ids = {str(s.get("item_id")) for s in new_slides}
    old_by_id = {str(s.get("item_id")): s for s in old_slides}
    used_old: set[str] = set()
    for slide in new_slides:
        iid = str(slide.get("item_id"))
        if iid in old_by_id:
            out[iid] = (old_by_id[iid], True)
            used_old.add(iid)
    orphans = [s for s in old_slides if str(s.get("item_id")) not in new_ids]
    for slide in new_slides:
        iid = str(slide.get("item_id"))
        if iid in out:
            continue
        same = [o for o in orphans if str(o.get("item_id")) not in used_old
                and o.get("fingerprint") == slide.get("fingerprint")]
        if len(same) > 1:
            same = [o for o in same if o.get("position") == slide.get("position")]
        if len(same) != 1:
            continue
        old = same[0]
        used_old.add(str(old.get("item_id")))
        page_id = str((old.get("enrichment") or {}).get("vendor_page_id") or "")
        out[iid] = (old, not page_id or page_id == iid)
    return out
