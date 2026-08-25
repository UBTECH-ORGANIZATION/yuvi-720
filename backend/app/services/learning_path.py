"""The adaptive within-unit learning path (720 §2, §3.1–§3.3).

One engine, one answer. Before this module the platform had two disagreeing
notions of "what next": ``learning_progress.project_unit_roadmap`` walked
``order`` linearly and drove every learner surface, while
``content_catalog.select_component`` was genuinely adaptive but only fed the
dashboard hero. They could — and did — contradict each other on screen.

This module is the single source. It is **pure, synchronous and deterministic**:
a function of (unit catalog, brain, unit events). No I/O, no LLM, and nothing is
persisted — the path is recomputed on every read from the append-only event log
plus the brain, so it can never drift away from the evidence that produced it.

What the spec assigns to us (§3.2, modular units): *"התהלוך בין הרכיבים מתבצע
על ידי המערכת, בהתאם להגדרות הספק ולנתוני הלומד (ביצועים, העדפות, היסטוריה)"*.
What it assigns to the provider: the meaning of success (§3.3, "לפי הגדרת ספק
התוכן") and the component metadata. So a provider ``success: false`` makes a
component *eligible* for repair; whether we actually route the learner back is
our decision, taken here on our own evidence.

Two rules the learner never sees (§2): mastery levels stay internal, and no
numeric score reaches the UI. Every node therefore carries a `reason.code` for
display and its `reason.evidence` only for teacher-authenticated explain views.
"""

from __future__ import annotations

from typing import Any, Iterable, Optional

from app.brain.mastery import entry_for, is_due_for_review
from app.services.events import is_component_completion

# ── Bands and thresholds (tunable; mirror the constants style in mastery.py) ──
_MASTERY_RANK = {"basic": 0, "intermediate": 1, "advanced": 2}
_STRUGGLE_SCORE = 0.4
_CONFIDENT_SCORE = 0.75
_CONFIDENT_CONF = 0.5
_CONFIDENT_STREAK = 3
_ASSESS_READY_STREAK = 2
_ASSESS_READY_SCORE = 0.7
_ASSESS_READY_CONF = 0.4
# Below this the provider's `success: false` is corroborated by the score itself.
_REMEDIATION_SCORE = 0.7
# One repair round per failing component. A provider that re-reports `success:
# false` must not be able to grow the path without bound.
MAX_VISITS = 2

# Node states. `skipped` is new: an optional stage the learner has outgrown, or
# a stage cut short by a passed assessment (§3.3). It is never `locked` — off-path
# work stays launchable, or deep-linking an extra practice would 409.
STATE_COMPLETED = "completed"
STATE_CURRENT = "current"
STATE_AVAILABLE = "available"
STATE_LOCKED = "locked"
STATE_SKIPPED = "skipped"

# Legacy `progress_evidence.kind` vocabulary, kept for one release so existing
# consumers and contract tests read unchanged.
_LEGACY_KIND = {
    "xapi_completed": "xapi_completed",
    "xapi_failed": "xapi_completed",
    "provider_order": "provider_order",
    "equivalent_chosen": "provider_order",
    "equivalent_alternative": "provider_alternative",
    "optional_skipped": "provider_alternative",
    "optional_kept": "provider_order",
    "recovery_after_fail": "provider_recovery",
    "review_revisit": "provider_recovery",
    "assessment_gated": "awaiting_prior_completion",
    "unit_completed_by_assessment": "provider_alternative",
    "awaiting_prior_completion": "awaiting_prior_completion",
    "brain_current_state": "brain_current_state",
    "linear_fallback": "provider_order",
}


# ── Promoted helpers (were private in content_catalog; aliased back there) ────
def band_for(entry: dict[str, Any], signals: Optional[dict[str, Any]] = None) -> str:
    """Map mastery + behaviour to a difficulty band: struggling/on_track/confident."""
    entry = entry or {}
    score = entry.get("score_ewma")
    conf = float(entry.get("confidence") or 0)
    streak = int(entry.get("consecutive_successes") or 0)
    failures = int(entry.get("failures") or 0)
    level = entry.get("level") or "basic"
    sig = signals or {}
    # `rapid_answer_cycling` is the type the detector actually stores
    # (detectors.detect_answer_cycling → brain.behavior_signals); the two
    # aliases before it never matched a stored row, so the cycling signal was
    # silently dead here until #450.
    struggling_signal = bool(sig.get("wheel_spinning") or sig.get("rapid_guessing")
                             or sig.get("rapid_answer_cycling")
                             or sig.get("answer_cycling") or sig.get("answer-cycling"))
    if (struggling_signal
            or (score is not None and score < _STRUGGLE_SCORE)
            or (failures >= 2 and streak == 0)):
        return "struggling"
    if ((score is not None and score >= _CONFIDENT_SCORE and conf >= _CONFIDENT_CONF)
            or level in ("intermediate", "advanced")
            or streak >= _CONFIDENT_STREAK):
        return "confident"
    return "on_track"


def assessment_ready(entry: dict[str, Any]) -> bool:
    """Enough practice success to face the objective's assessment (720 §3.3)."""
    entry = entry or {}
    score = entry.get("score_ewma")
    conf = float(entry.get("confidence") or 0)
    streak = int(entry.get("consecutive_successes") or 0)
    level = entry.get("level") or "basic"
    return (streak >= _ASSESS_READY_STREAK
            or (score is not None and score >= _ASSESS_READY_SCORE and conf >= _ASSESS_READY_CONF)
            or level in ("intermediate", "advanced"))


def difficulty_of(component: dict[str, Any]) -> float:
    value = component.get("relative_difficulty")
    return float(value) if isinstance(value, (int, float)) else 3.0


def pick_equivalent(pool: list[dict[str, Any]], band: str) -> dict[str, Any]:
    """Choose among same-`order` pedagogically-equivalent components by learner fit
    (720 §3.1 — 'ערך שקול ללומד'). Struggling→easiest, confident→hardest.

    `masteryLevel` is optional in תשפ"ז, so when the provider omits it every
    component ranks 0 and the choice falls through to `relativeDifficulty` alone.
    """
    def key(component: dict[str, Any]) -> tuple[int, float]:
        return (_MASTERY_RANK.get(component.get("mastery_level") or "basic", 0),
                difficulty_of(component))
    if band == "struggling":
        return min(pool, key=key)
    if band == "confident":
        return max(pool, key=key)
    ordered = sorted(pool, key=key)
    return ordered[len(ordered) // 2]  # on_track → the middle rung


# ── Evidence ─────────────────────────────────────────────────────────────────
def unit_evidence(events: Iterable[dict[str, Any]]) -> dict[str, Any]:
    """Fold one unit's events into per-component outcomes + learner self-reports.

    Only a COMPONENT-level `completed` counts as an outcome (`is_component_completion`)
    — a per-screen `completed` is item progress and must never inject a repair
    round. Outcomes are kept as an ordered list per component so a repeat visit
    can be settled by the *next* completion rather than by the first one.
    """
    outcomes: dict[str, list[dict[str, Any]]] = {}
    touched: set[str] = set()
    # 720 selection dictionary — the learner's own reports about the learning.
    # `practiceDecision` and `isRepeat` are agency (§1 פעלנות); `isUnderstood`
    # is a self-assessment. All three outrank our profile when they disagree.
    self_reports: dict[str, Any] = {
        "is_understood": None, "wants_repeat": False, "wants_practice": False,
    }

    for event in events or []:
        component_id = str(event.get("launch") or "")
        if component_id:
            touched.add(component_id)
        verb = event.get("verb")
        if verb == "selected":
            category = str(event.get("selection_category") or "")
            response = event.get("response")
            if response is None:
                response = (event.get("result") or {}).get("response")
            truthy = str(response).strip().lower() in ("true", "1", "yes")
            if category in ("is-understood", "isUnderstood"):
                self_reports["is_understood"] = truthy
            elif category in ("is-repeat", "isRepeat") and truthy:
                self_reports["wants_repeat"] = True
            elif category in ("practice-decision", "practiceDecision") and truthy:
                self_reports["wants_practice"] = True
            continue
        # Our own affordance ("אני רוצה עוד תרגול" in the completion dialog) —
        # the same signal as the provider's practiceDecision, raised by us.
        if verb == "path_choice" and str(event.get("response") or "") == "more_practice":
            self_reports["wants_practice"] = True
            continue
        if not is_component_completion(event) or not component_id:
            continue
        result = event.get("result") or {}
        scaled = result.get("score_scaled")
        outcomes.setdefault(component_id, []).append({
            "event_id": str(event.get("_id") or ""),
            "passed": result.get("success") is not False,
            "scaled": float(scaled) if isinstance(scaled, (int, float)) else None,
        })

    return {
        "outcomes": outcomes,
        "touched": touched,
        "self_reports": self_reports,
        "any_failure": any(
            not row["passed"] for rows in outcomes.values() for row in rows
        ),
    }


def _outcome_for(evidence: dict[str, Any], component_id: str, visit: int) -> Optional[dict[str, Any]]:
    """The outcome settling a component's Nth visit, if it has happened yet."""
    rows = (evidence.get("outcomes") or {}).get(component_id) or []
    return rows[visit - 1] if len(rows) >= visit else None


# ── Rules ────────────────────────────────────────────────────────────────────
def _stages(components: list[dict[str, Any]]) -> list[list[dict[str, Any]]]:
    """Group components into ordered stages. Same `order` == pedagogically
    equivalent (§3.1). Components without an `order` become trailing single
    stages in id order, so a partially-tagged unit still walks deterministically.
    """
    ordered = [c for c in components if isinstance(c.get("order"), (int, float))]
    loose = [c for c in components if not isinstance(c.get("order"), (int, float))]
    grouped: dict[float, list[dict[str, Any]]] = {}
    for component in ordered:
        grouped.setdefault(float(component["order"]), []).append(component)
    stages = [
        sorted(grouped[key], key=lambda c: str(c.get("id") or ""))
        for key in sorted(grouped)
    ]
    stages.extend([[component] for component in sorted(loose, key=lambda c: str(c.get("id") or ""))])
    return stages


def _may_skip_optional(
    entry: dict[str, Any],
    signals: Optional[dict[str, Any]],
    evidence: dict[str, Any],
) -> bool:
    """Whether a wholly-optional stage may be dropped for THIS learner.

    Deliberately stricter than `band_for` alone: `mastery.level` is never demoted
    (mastery.py), so a learner who once reached `intermediate` would latch to the
    `confident` band forever and skip optional work for the rest of their life.
    Current evidence has to agree — and the learner's own word outranks all of it.
    """
    reports = evidence.get("self_reports") or {}
    if reports.get("is_understood") is False or reports.get("wants_repeat"):
        return False
    if reports.get("wants_practice"):
        return False
    if band_for(entry, signals) != "confident":
        return False
    if float(entry.get("score_ewma") or 0) < _CONFIDENT_SCORE:
        return False
    if entry.get("needs_review") or is_due_for_review(entry):
        return False
    return not evidence.get("any_failure")


def subject_prior(brain: dict[str, Any], subject: Optional[str], objective_id: Optional[str]) -> dict[str, Any]:
    """A stand-in profile for a goal the learner has no evidence in yet.

    `mastery` is keyed per goal, so on the first component of a NEW goal the
    entry is empty and every learner reads as `on_track`. Detector signals are
    global, so a struggling learner still differentiates immediately — but an
    excellent one would walk the middle route until they built a streak inside
    the goal. This rolls up their record across the same subject instead.

    Deliberately weak: it needs a genuinely strong track record, it is dropped
    the moment the goal has evidence of its own, and it is never consulted for
    assessment readiness — a reputation may shape optional work and difficulty,
    never stand in for demonstrating the new goal.
    """
    if not subject:
        return {}
    from app.brain.mastery import mastery_key
    current = mastery_key(objective_id) if objective_id else None
    rows = [
        row for key, row in (brain.get("mastery") or {}).items()
        if isinstance(row, dict) and row.get("subject") == subject and key != current
        and row.get("achieved")
    ]
    if not rows:
        return {}
    scores = [float(row.get("score_ewma") or 0) for row in rows]
    confidences = [float(row.get("confidence") or 0) for row in rows]
    mean_score = sum(scores) / len(scores)
    if mean_score < _CONFIDENT_SCORE:
        return {}
    if any(row.get("needs_review") for row in rows):
        return {}
    return {
        "score_ewma": mean_score,
        "confidence": sum(confidences) / len(confidences),
        "consecutive_successes": 0,
        "failures": 0,
        "level": "basic",          # never inherited — levels are earned per goal
        "_prior": True,
    }


def _remediation_warranted(
    outcome: dict[str, Any],
    entry: dict[str, Any],
    signals: Optional[dict[str, Any]],
) -> bool:
    """The provider flags failure; we decide whether to act on it.

    `success` is the provider's call (§3.3) and this unit's content reports
    `success: false` at a scaled score as high as 0.8. Routing a confident
    learner back through an easier component on that basis would punish a good
    result, so we require our own evidence to agree: a genuinely low score, or a
    learner the profile already shows struggling.
    """
    scaled = outcome.get("scaled")
    if scaled is not None and scaled < _REMEDIATION_SCORE:
        return True
    return band_for(entry, signals) == "struggling"


# ── The plan ─────────────────────────────────────────────────────────────────
def _node(
    component: dict[str, Any],
    *,
    visit: int,
    on_path: bool,
    state: str,
    code: str,
    evidence: Optional[dict[str, Any]] = None,
    stage_index: Optional[int] = None,
    outcome: Optional[str] = None,
) -> dict[str, Any]:
    component_id = str(component.get("id") or "")
    return {
        **component,
        # Stable identity that survives a repeat visit — React keys, the active
        # comparison and every `find()` site key on this, not on `id`.
        "path_node_id": f"{component_id}#{visit}",
        "component_id": component_id,
        "visit": visit,
        "on_path": on_path,
        "path_index": None,
        "stage_index": stage_index,
        "progress_state": state,
        "outcome": outcome,
        "progress_reason": {"code": code, "evidence": evidence or {}},
        # Legacy shape, one release of overlap.
        "progress_evidence": {
            "kind": _LEGACY_KIND.get(code, code),
            **({"event_id": evidence["event_id"]} if evidence and evidence.get("event_id") else {}),
        },
    }


def plan_unit_path(
    unit: dict[str, Any],
    brain: dict[str, Any],
    events: Iterable[dict[str, Any]],
    *,
    locale: str = "he",
) -> dict[str, Any]:
    """Build this learner's path through one unit. Pure; raises nothing by design."""
    components = list(unit.get("components") or [])
    objective_id = unit.get("objective_id")
    brain = brain or {}
    entry = entry_for(brain.get("mastery"), objective_id) if objective_id else {}
    signals = _signals(brain)
    evidence = unit_evidence(events)
    # No evidence in this goal yet → fall back to the learner's record across the
    # subject, for difficulty and optional work only. `ready` stays on the real
    # entry: the assessment must be earned inside the goal it assesses.
    profile = entry or subject_prior(brain, unit.get("subject"), objective_id)
    band = band_for(profile, signals)
    ready = assessment_ready(entry)
    by_id = {str(c.get("id") or ""): c for c in components}

    stages = _stages(components)
    # A stage is "reached" once anything in it has evidence. Everything at or
    # before the last reached stage is history and must never be re-planned —
    # improving mastery cannot retro-skip work the learner already did.
    last_reached = -1
    for index, stage in enumerate(stages):
        if any(str(c.get("id") or "") in evidence["touched"] for c in stage):
            last_reached = index

    nodes: list[dict[str, Any]] = []
    unit_ended = False

    for stage_index, stage in enumerate(stages):
        pool = [
            c for c in stage
            if not c.get("languages") or locale in (c.get("languages") or [])
        ]
        if not pool:
            continue

        if unit_ended:
            # §3.3 — a passed assessment completes the goal; the rest of the unit
            # is not work the learner still owes.
            for component in pool:
                nodes.append(_node(component, visit=1, on_path=False, state=STATE_SKIPPED,
                                   code="unit_completed_by_assessment", stage_index=stage_index))
            continue

        required = [c for c in pool if c.get("is_required")]
        # "A stage where nothing is required is skippable." `isRequired` is scoped
        # to the equivalents sharing an `order` (720 metadata table), so the unit
        # of the decision is the stage, not the component.
        optional_stage = not required
        untouched = all(str(c.get("id") or "") not in evidence["touched"] for c in pool)
        if (optional_stage and untouched and stage_index > last_reached
                and _may_skip_optional(profile, signals, evidence)):
            for component in pool:
                nodes.append(_node(component, visit=1, on_path=False, state=STATE_SKIPPED,
                                   code="optional_skipped", stage_index=stage_index,
                                   evidence=_explain(profile, band)))
            continue
        # Optional and still here: either the learner is not clear of it yet, or
        # they asked for it, or they have already been in it — all of which are
        # "kept", which is what the what-now card has to explain.
        code = "optional_kept" if optional_stage else "provider_order"

        chosen = pick_equivalent(required or pool, band) if len(pool) > 1 else pool[0]
        for component in pool:
            if component is chosen:
                continue
            # A non-chosen equivalent is real, approved content — available, never
            # locked, so a learner (or a teacher) can still open it.
            nodes.append(_node(component, visit=1, on_path=False, state=STATE_AVAILABLE,
                               code="equivalent_alternative", stage_index=stage_index))

        if len(pool) > 1 and code == "provider_order":
            code = "equivalent_chosen"
        chosen_id = str(chosen.get("id") or "")
        outcome = _outcome_for(evidence, chosen_id, 1)
        gated = bool(chosen.get("is_assessment")) and not ready and outcome is None
        nodes.append(_node(
            chosen, visit=1, on_path=True,
            state=STATE_LOCKED if gated else STATE_AVAILABLE,
            code="assessment_gated" if gated else code,
            stage_index=stage_index,
            evidence=_explain(entry, band, outcome),
        ))

        if outcome and outcome["passed"] and chosen.get("is_assessment"):
            unit_ended = True
            continue

        if outcome and not outcome["passed"] and _remediation_warranted(outcome, entry, signals):
            for target_id in chosen.get("recommended_after_fail") or []:
                target = by_id.get(str(target_id))
                if not target:
                    continue
                visit = sum(1 for node in nodes if node["component_id"] == str(target_id)) + 1
                if visit > MAX_VISITS:
                    continue
                nodes.append(_node(target, visit=visit, on_path=True, state=STATE_AVAILABLE,
                                   code="recovery_after_fail", stage_index=stage_index,
                                   evidence={"after": chosen_id, **_explain(entry, band, outcome)}))

    # A provider may mark nothing in a unit as required (`isRequired` is optional
    # metadata). For a strong learner every stage would then be skippable and the
    # unit would vanish — no route, nothing to open. "Optional" means "you may not
    # need all of this", never "this unit is not for you", so the first stage is
    # always put back.
    if nodes and not any(node["on_path"] for node in nodes):
        first = nodes[0]
        first["on_path"] = True
        first["progress_state"] = STATE_AVAILABLE
        first["progress_reason"] = {"code": "optional_kept", "evidence": {}}
        first["progress_evidence"] = {"kind": _LEGACY_KIND["optional_kept"]}

    if unit_ended:
        # §3.3 — "מעבר בהצלחה של אחד מהם יסיים את המסלול ביחידת התוכן". The
        # assessment can be passed out of order (a confident learner jumping
        # ahead), so anything still unsettled anywhere in the unit is cut, not
        # just the stages that happened to come later in the walk.
        for node in nodes:
            if node["on_path"] and _outcome_for(evidence, node["component_id"], node["visit"]) is None:
                node["on_path"] = False
                node["progress_state"] = STATE_SKIPPED
                node["progress_reason"] = {"code": "unit_completed_by_assessment", "evidence": {}}
                node["progress_evidence"] = {"kind": _LEGACY_KIND["unit_completed_by_assessment"]}

    _insert_review_revisit(nodes, entry, evidence, band)
    return _finalize(unit, nodes, brain, entry, evidence, band, ready, locale)


def _signals(brain: dict[str, Any]) -> dict[str, Any]:
    signals: dict[str, Any] = {"pace": (brain.get("current_state") or {}).get("pace")}
    for row in brain.get("behavior_signals") or []:
        kind = row.get("type") if isinstance(row, dict) else row
        if kind:
            signals[str(kind)] = True
    return signals


def _explain(
    entry: dict[str, Any],
    band: str,
    outcome: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    """Real values only — never shown to the learner, only under ?explain=1."""
    out: dict[str, Any] = {
        "band": band,
        "score_ewma": entry.get("score_ewma"),
        "confidence": entry.get("confidence"),
        "consecutive_successes": entry.get("consecutive_successes"),
        "failures": entry.get("failures"),
    }
    if outcome:
        out["event_id"] = outcome.get("event_id")
        out["scaled"] = outcome.get("scaled")
    return out


def _insert_review_revisit(
    nodes: list[dict[str, Any]],
    entry: dict[str, Any],
    evidence: dict[str, Any],
    band: str,
) -> None:
    """A lapsed skill re-enters the path — but only once there is nothing new left.

    Content-independent (unlike `recommendedAfterFail` it needs no provider
    metadata), so it differentiates on any unit in the catalog.

    Two rules learned from live data. A learner mid-unit had `achieved: true`
    (earned by streak) and `needs_review: true` (set by a later failure), which
    is not "come back in a month and refresh" — it is "you just missed one", and
    the failure lever already answers that. Firing a revisit anyway rewound them
    to the start of a unit they were part-way through. So:

      1. Never revisit while there is unsettled work ahead. Spaced review is for
         a learner with nothing new left in the unit; otherwise they go forward.
      2. Revisit the LAST station they settled, not the first. Sending someone
         back to station 1 of a unit they have walked most of reads as losing
         their progress, not as a refresher.
    """
    if not is_due_for_review(entry):
        return
    if any(n["on_path"] and not _settled(n, evidence) for n in nodes):
        return
    settled = [n for n in nodes if n["on_path"] and _settled(n, evidence)]
    if not settled:
        return
    target = settled[-1]
    visit = sum(1 for n in nodes if n["component_id"] == target["component_id"]) + 1
    if visit > MAX_VISITS:
        return
    revisit = _node(
        {k: v for k, v in target.items() if not k.startswith(("path_", "progress_"))
         and k not in ("on_path", "visit", "outcome", "stage_index", "component_id")},
        visit=visit, on_path=True, state=STATE_AVAILABLE, code="review_revisit",
        stage_index=target.get("stage_index"), evidence=_explain(entry, band),
    )
    insert_at = next(
        (i for i, n in enumerate(nodes) if n["on_path"] and not _settled(n, evidence)),
        len(nodes),
    )
    nodes.insert(insert_at, revisit)


def _settled(node: dict[str, Any], evidence: dict[str, Any]) -> bool:
    return _outcome_for(evidence, node["component_id"], node["visit"]) is not None


def _finalize(
    unit: dict[str, Any],
    nodes: list[dict[str, Any]],
    brain: dict[str, Any],
    entry: dict[str, Any],
    evidence: dict[str, Any],
    band: str,
    ready: bool,
    locale: str,
) -> dict[str, Any]:
    """Resolve states + ordinals, and pick the one node that is `current`."""
    on_path = [node for node in nodes if node["on_path"]]
    for index, node in enumerate(on_path):
        node["path_index"] = index

    # Settle every node against its own visit's outcome.
    for node in on_path:
        outcome = _outcome_for(evidence, node["component_id"], node["visit"])
        if not outcome:
            continue
        node["outcome"] = "passed" if outcome["passed"] else "failed"
        # A failed component is NOT complete — it stays open and re-doable. But
        # it is settled, so it is never the "current" step either: its repair is.
        node["progress_state"] = STATE_COMPLETED if outcome["passed"] else STATE_AVAILABLE
        node["progress_reason"] = {
            "code": "xapi_completed" if outcome["passed"] else "xapi_failed",
            "evidence": {"event_id": outcome.get("event_id"), "scaled": outcome.get("scaled")},
        }
        node["progress_evidence"] = {
            "kind": "xapi_completed",
            **({"event_id": outcome["event_id"]} if outcome.get("event_id") else {}),
        }

    pending = [node for node in on_path if node["outcome"] is None]
    # A gated assessment is not somewhere the learner can go — unless it is the
    # only thing left, in which case withholding it forever would strand them
    # with nothing to do, so the gate opens.
    ungated = [n for n in pending if n["progress_reason"]["code"] != "assessment_gated"]
    current = ungated[0] if ungated else (pending[0] if pending else None)
    if current is not None and not ungated:
        current["progress_reason"] = {"code": "provider_order", "evidence": {}}

    # Nothing pending, but something on the path was FAILED and never repaired —
    # a failed assessment at the end of the unit is the live case. The learner has
    # not finished: they are standing on the thing they did not pass, and pointing
    # them back at it is the only honest answer. Without this the unit reported
    # itself complete on a failure.
    if current is None:
        failed = [n for n in on_path if n["outcome"] == "failed"]
        if failed:
            current = failed[-1]
            # The outcome stays `failed` — that happened and the record keeps it.
            # What changes is where the learner is standing: on the thing they
            # did not pass, with it open to try again.
            current["progress_state"] = STATE_CURRENT

    # The brain pointer is a hint, not the plan. It is honoured only when it
    # lands on an on-path, unsettled node at or before the plan's own next step;
    # otherwise the plan wins and the pointer is recorded as ignored. This is
    # what stops `pedagogical` and the roadmap from contradicting each other.
    state = brain.get("current_state") or {}
    pointer = state.get("component_id") if state.get("unit_id") == unit.get("id") else None
    pointer_used = False
    if pointer and current:
        candidate = next(
            (n for n in pending if n["component_id"] == str(pointer)), None
        )
        if candidate and candidate["path_index"] <= current["path_index"]:
            current = candidate
            pointer_used = True

    for node in on_path:
        if node["outcome"] is not None:
            continue
        if current is not None and node["path_node_id"] == current["path_node_id"]:
            node["progress_state"] = STATE_CURRENT
            if pointer_used:
                node["progress_evidence"] = {"kind": "brain_current_state"}
        elif current is not None and node["path_index"] > current["path_index"]:
            if node["progress_reason"]["code"] != "assessment_gated":
                node["progress_state"] = STATE_LOCKED
                node["progress_reason"] = {"code": "awaiting_prior_completion", "evidence": {}}
                node["progress_evidence"] = {"kind": "awaiting_prior_completion"}

    settled_count = sum(1 for node in on_path if node["outcome"] is not None)
    total = len(on_path)
    unit_state = (
        "completed" if current is None and total
        else "in_progress" if settled_count
        else "not_started"
    )
    # Nothing left that could still change the tail: no optional stage was
    # dropped, nothing is gated, and no failure is outstanding. Rare today — the
    # flag exists so a genuinely deterministic unit is not fogged for no reason.
    tail_certain = not any(
        node["progress_reason"]["code"] in ("optional_skipped", "optional_kept", "assessment_gated")
        for node in nodes
    ) and not evidence.get("any_failure")

    projected = {
        **unit,
        "components": nodes,
        "current_component_id": current["component_id"] if current else None,
        "next_component_id": current["component_id"] if current else None,
        "next_path_node_id": current["path_node_id"] if current else None,
        "steps_completed": settled_count,
        "steps_total": total,
        "progress_ratio": round(settled_count / total, 4) if total else 0.0,
        "unit_state": unit_state,
        "tail_certain": tail_certain,
        "path_strategy": "adaptive",
        # Internal only — stripped before the learner payload (§2).
        "_band": band,
        "_assessment_ready": ready,
    }
    return projected


# ── Fallback ─────────────────────────────────────────────────────────────────
def _legacy_projection(
    unit: dict[str, Any],
    brain: dict[str, Any],
    events: Iterable[dict[str, Any]],
) -> dict[str, Any]:
    """The pre-engine linear walk, kept verbatim as the safety net.

    Used when the unit carries no `order` at all (nothing to sequence), when it
    is a single-component 'closed' unit (§3.2 — the provider navigates its own
    items and we must not interfere), or when the planner raises. A learner is
    never blocked by a planning bug.
    """
    components = sorted(
        list(unit.get("components") or []),
        key=lambda row: (
            row.get("order") is None,
            row.get("order") if row.get("order") is not None else 0,
            row.get("id") or "",
        ),
    )
    current = (brain or {}).get("current_state") or {}
    completed: dict[str, str] = {}
    recovery_ids: set[str] = set()
    for event in events or []:
        if not is_component_completion(event):
            continue
        component_id = str(event.get("launch") or "")
        result = event.get("result") or {}
        component = next((row for row in components if row.get("id") == component_id), None)
        if component and component.get("is_assessment") and result.get("success") is False:
            recovery_ids.update(component.get("recommended_after_fail") or [])
            continue
        completed[component_id] = str(event.get("_id") or "")

    ordered_stages = sorted({
        row.get("order") for row in components if isinstance(row.get("order"), (int, float))
    })
    completed_stages = {row.get("order") for row in components if row.get("id") in completed}
    next_stage = next((s for s in ordered_stages if s not in completed_stages), None)
    first_incomplete_id = next(
        (row.get("id") for row in components
         if row.get("id") not in completed and row.get("order") == next_stage),
        None,
    )
    current_component_id = (
        current.get("component_id") if current.get("unit_id") == unit.get("id") else None
    )

    nodes = []
    for index, component in enumerate(components):
        component_id = component.get("id")
        if component_id in completed:
            state, kind = "completed", "xapi_completed"
        elif component_id == current_component_id:
            state, kind = "current", "brain_current_state"
        elif (component.get("order") == next_stage
              or component.get("order") in completed_stages
              or component_id in recovery_ids):
            state = "available"
            kind = ("provider_order" if component.get("order") == next_stage
                    else "provider_alternative" if component.get("order") in completed_stages
                    else "provider_recovery")
        else:
            state, kind = "locked", "awaiting_prior_completion"
        node = {
            **component,
            "path_node_id": f"{component_id}#1",
            "component_id": component_id,
            "visit": 1,
            "on_path": True,
            "path_index": index,
            "stage_index": index,
            "progress_state": state,
            "outcome": "passed" if component_id in completed else None,
            "progress_reason": {"code": "linear_fallback", "evidence": {}},
            "progress_evidence": (
                {"kind": kind, "event_id": completed[component_id]}
                if component_id in completed else {"kind": kind}
            ),
        }
        nodes.append(node)

    total = len(nodes)
    done = len(completed)
    return {
        **unit,
        "components": nodes,
        "current_component_id": current_component_id,
        "next_component_id": first_incomplete_id,
        "next_path_node_id": f"{first_incomplete_id}#1" if first_incomplete_id else None,
        "steps_completed": done,
        "steps_total": total,
        "progress_ratio": round(done / total, 4) if total else 0.0,
        "unit_state": "completed" if first_incomplete_id is None and total else (
            "in_progress" if done else "not_started"),
        "tail_certain": True,
        "path_strategy": "linear_fallback",
    }


def project(
    unit: dict[str, Any],
    brain: dict[str, Any],
    events: Iterable[dict[str, Any]],
    *,
    locale: str = "he",
) -> dict[str, Any]:
    """Plan the unit, falling back to the linear walk rather than ever failing."""
    components = list(unit.get("components") or [])
    if len(components) <= 1:
        return _legacy_projection(unit, brain, events)
    if not any(isinstance(c.get("order"), (int, float)) for c in components):
        return _legacy_projection(unit, brain, events)
    try:
        return plan_unit_path(unit, brain, events, locale=locale)
    except Exception as exc:  # a planning bug must never block a learner
        print(f"⚠️ learning path planning failed for {unit.get('id')}: {exc}")
        return _legacy_projection(unit, brain, events)
