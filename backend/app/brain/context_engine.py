"""Context Engine — scoped views, write allow-lists, and the Context bundle.

This is the privacy + least-context boundary (architecture doc §4.4, §5.8). Agents
never see the whole brain: each role gets only its projected slice, and write-back
is validated against a per-agent allow-list — enforced in **code**, so even a
jailbroken prompt cannot read or write outside its scope. PII (name/grade/etc.)
lives under `identity` and is *never* placed in a bundle sent to an AI.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from app.brain.repository import get_brain, apply_brain_updates
from app.brain.schema import project, flatten_updates, path_allowed, get_path


def _today_school_date() -> str:
    """Lazy proxy — `school_calendar` imports services this module must not
    load at import time."""
    from app.services.school_calendar import today_school_date

    return today_school_date()


def today_valid_feeling(daily_feeling: Any) -> Optional[dict[str, Any]]:
    """The check-in feeling, only while its school day lasts (#452).

    Expiry is READ-SIDE and lives here alone: a feeling stamped with an
    earlier date simply stops being returned at the Israeli midnight — no
    cron, no writer, no second place to keep in sync.
    """
    if isinstance(daily_feeling, dict) and daily_feeling.get("date") == _today_school_date():
        return daily_feeling
    return None


class AgentScopeError(PermissionError):
    """Raised when an agent attempts a write outside its allow-list (§5.8)."""


COACH_SCREEN_AREAS: dict[str, list[str]] = {
    "results": ["learning_profile", "strengths", "challenges", "preferences"],
    "student_dashboard": [
        "current_or_next_learning", "subject_progress", "goals",
        "strengths", "challenges", "learning_profile",
    ],
    "mentoring": ["learner_visible_goals", "next_steps", "shared_mentoring_notes"],
    "learning_portal": ["recommended_learning", "subjects", "learning_status"],
    "learning_world": ["recommended_learning", "subjects", "learning_status"],
    "learning_lesson": ["current_learning_item", "instructions", "activity", "feedback"],
    "learning_create": ["creation_brief", "generated_learning_activity", "preview"],
    "unknown": [],
}


# Per-agent read/write scopes — the single source of truth for least-context.
# `read` = dotted paths projected into the agent's view; `write` = dotted paths
# the agent may `$set`. Durable learner facts (profile.*, strategies, challenges)
# are written only via the consolidator (§5.7), not directly by conversational
# agents — reflected here by keeping them out of the coach/reflection write lists.
AGENT_VIEWS: dict[str, dict[str, list[str]]] = {
    "onboarding": {
        "read": ["identity.locale", "profile.mapping_scores"],
        "write": [
            "profile.activeness", "profile.interests", "profile.preferences",
            "profile.learning_style", "profile.environment", "profile.source",
            "profile.updated_at", "strengths", "challenges",
        ],
    },
    "pedagogical": {
        "read": ["mastery", "current_state", "next_recommendations", "enrollments"],
        "write": ["current_state", "next_recommendations", "mastery"],
    },
    "coach": {
        "read": [
            "identity.locale", "profile.interests",
            "profile.characteristics", "profile.learning_style",
            "profile.preferences", "profile.environment", "profile.activeness",
            "profile.mapping_clarifications", "strengths",
            "challenges", "strategies", "goals", "current_state",
            "teacher_directives", "memory", "mastery", "student_description", "reflections_recent",
        ],
        "write": [],   # coach's durable writes go through the memory consolidator (§5.7)
    },
    "reflection": {
        "read": ["mastery", "reflections_recent"],
        "write": ["reflections_recent"],
    },
    "teacher_insights": {
        "read": ["progress", "mastery", "strengths", "challenges", "enrollments", "wellbeing_flags"],
        "write": [],                # never writes the learner brain (read-only)
    },
    "teacher_assistant": {
        # F6. The teacher's AI reads a wider slice than `teacher_insights` because it
        # answers open questions ("how is this student doing?"), but three exclusions
        # are deliberate and load-bearing:
        #   `identity.*`            — PII never reaches an LLM prompt (§4.1). The
        #                             assistant refers to learners by pseudonymous id
        #                             and the client substitutes the name at render.
        #   `profile.mapping_scores` — raw onboarding instrument scores are not a
        #                             teacher-facing artifact; `student_description`
        #                             is the curated, provenance-carrying projection.
        #   `memory`                — the learner's private soft model. The companion
        #                             only stays trustworthy to the child if it is not
        #                             a surveillance channel (A10).
        "read": [
            "progress", "mastery", "strengths", "challenges", "enrollments",
            "wellbeing_flags", "goals", "teacher_directives", "reflections_recent",
            "student_description", "current_state",
        ],
        "write": [],                # read-only: no AI write into a child's brain
    },
    "teacher_voice": {
        # #454: a HUMAN teacher's insight entering the student model — not an AI
        # agent. The "no AI write into a child's brain" rule above is about
        # model-generated text; this lane carries a judgement a person typed,
        # PII-scrubbed and warned-about before it gets here
        # (services/student_model_insight.py). It writes exactly the two
        # structures the PBI names and nothing else.
        "read": ["memory", "student_description"],
        "write": ["memory", "student_description"],
    },
    "safety": {
        "read": ["identity.locale"],
        "write": ["wellbeing_flags"],
    },
    "checkin": {
        # The daily feelings check-in (#452): it reads just enough to phrase
        # its optional callback (locale + what was hard last time) and may
        # write exactly one thing — today's feeling. Skips are data, but they
        # live in the check-in doc and the reflection, not in the brain.
        "read": ["identity.locale", "reflections_recent"],
        "write": ["current_state.daily_feeling"],
    },
}


def scopes_for(agent: str) -> dict[str, list[str]]:
    scope = AGENT_VIEWS.get(agent)
    if scope is None:
        raise AgentScopeError(f"unknown agent scope: {agent!r}")
    return scope


async def view_for(agent: str, learner_id: Optional[str]) -> dict[str, Any]:
    """Return ONLY the agent's readable slice of the brain (§5.8)."""
    scope = scopes_for(agent)
    brain = await get_brain(learner_id)
    return project(brain, scope["read"])


async def apply_writes(
    agent: str, learner_id: Optional[str], updates: dict[str, Any]
) -> dict[str, Any]:
    """Validate updates against the agent's write allow-list, then persist.

    Rejects any out-of-scope path before touching the database (fail closed).
    """
    scope = scopes_for(agent)
    flat = flatten_updates(updates)
    for path in flat:
        if not path_allowed(path, scope["write"]):
            raise AgentScopeError(
                f"agent {agent!r} may not write {path!r} (allowed: {scope['write']})"
            )
    return await apply_brain_updates(learner_id, flat)


# Deterministic mapping from the six activeness components to phrasing guidance
# (B-4). The 0-100 scores stay internal; only the verbal hint enters a prompt.
_ACTIVENESS_HINTS = {
    "self_regulation": {
        "he": "העדף צעדים קטנים והגדר במפורש את הצעד הבא",
        "ar": "فضّل خطوات صغيرة وحدّد الخطوة التالية صراحة",
        "en": "Prefer small steps and name the next action explicitly",
    },
    "motivation_relevance": {
        "he": "חבר את הלמידה לתחומי העניין לפני התוכן עצמו",
        "ar": "اربط التعلم بالاهتمامات قبل المحتوى نفسه",
        "en": "Tie learning to the learner's interests before the content itself",
    },
    "growth_mindset": {
        "he": "הדגש שהיכולת גדלה עם תרגול; שבח מאמץ ותהליך, לא תוצאה",
        "ar": "أكّد أن القدرة تنمو بالتمرّن؛ امدح الجهد والعملية لا النتيجة",
        "en": "Stress that ability grows with practice; praise effort and process, not outcome",
    },
    "initiative_responsibility": {
        "he": "הצע בחירה קטנה בין שתי דרכים כדי לתת תחושת שליטה",
        "ar": "اعرض خيارًا صغيرًا بين طريقتين لمنح شعور بالتحكم",
        "en": "Offer a small choice between two paths to give a sense of control",
    },
    "self_awareness": {
        "he": "עזור לנסח מה היה קשה ומה עזר, בשאלות רפלקציה קצרות",
        "ar": "ساعد في صياغة ما كان صعبًا وما ساعد، بأسئلة تأمل قصيرة",
        "en": "Help articulate what was hard and what helped, with short reflection questions",
    },
    "support_emotional": {
        "he": "הקפד על טון מרגיע ומנרמל טעויות",
        "ar": "حافظ على نبرة مطمئنة وطبّع الأخطاء",
        "en": "Keep a reassuring tone and normalize mistakes",
    },
}


# When a component is a clear STRENGTH (high), lean INTO it rather than
# remediate — a high-motivation-relevance learner should still get "tie to
# interests" as a lever, not silence. Deficits (low) still take priority.
_ACTIVENESS_STRENGTH_HINTS = {
    "motivation_relevance": {
        "he": "התלמיד/ה מונע/ת מעניין — עגן/י כל נושא בעולם התוכן שלו/ה",
        "ar": "الطالب/ة مدفوع/ة بالاهتمام — اربط/ي كل موضوع بعالمه/ا",
        "en": "This learner is interest-driven — anchor every topic in their world",
    },
    "initiative_responsibility": {
        "he": "התלמיד/ה עצמאי/ת — תן/י לנסות לבד קודם, רמז רק כשמבקש/ת",
        "ar": "الطالب/ة مستقل/ة — دعه/ا يحاول أولًا، ولمّح فقط عند الطلب",
        "en": "This learner is autonomous — let them try first, hint only when asked",
    },
    "growth_mindset": {
        "he": "התלמיד/ה מוכן/ה לאתגר — אפשר להעלות רמה כשמצליח/ה",
        "ar": "الطالب/ة مستعد/ة للتحدي — يمكن رفع المستوى عند النجاح",
        "en": "This learner welcomes challenge — raise the level on success",
    },
}


def _activeness_hints(activeness: dict[str, Any], locale: str) -> list[str]:
    """Verbal coaching hints: address the lowest components first (deficits), and
    if room remains, lean into a standout strength. The 0-100 scores never leave
    the server — only the verbal hint does."""
    lang = locale if locale in {"he", "ar", "en"} else "he"
    entries = [
        (value, key) for key, value in (activeness or {}).items()
        if isinstance(value, (int, float))
    ]
    hints: list[str] = []
    for value, key in sorted(entries):                 # lowest first (deficits)
        if value < 40 and key in _ACTIVENESS_HINTS:
            hints.append(_ACTIVENESS_HINTS[key][lang])
        if len(hints) >= 2:
            return hints
    for value, key in sorted(entries, reverse=True):   # highest (strengths)
        if value >= 75 and key in _ACTIVENESS_STRENGTH_HINTS:
            hint = _ACTIVENESS_STRENGTH_HINTS[key][lang]
            if hint not in hints:
                hints.append(hint)
        if len(hints) >= 2:
            break
    return hints[:2]


# What the brain does NOT yet know that would make coaching more personal.
# Surfaced as verbal hints so the coach can close a gap with ONE natural
# question at the right moment (e.g. an explanation isn't landing and no
# interest is known to reframe it through) — the goal is to know the learner,
# and empty memory is a to-do, not a silence.
_PERSONALIZATION_GAP_HINTS = {
    "interests": {
        "he": "עוד לא ידוע אף תחום עניין. אם התלמיד/ה אומר/ת שההסבר לא עוזר או לא מתחבר — זה הרגע: שאל/י \"ספר/י לי על משהו שאתה אוהב או מתחבר אליו, ואסביר דרכו\", והסבר/הסבירי בפעם הבאה דרך מה שיענה",
        "ar": "لا تُعرف أي اهتمامات بعد. إذا قال الطالب/ة إن الشرح لا يساعد أو لا يصل — فهذه هي اللحظة: اسأل \"حدّثني عن شيء تحبه أو ترتبط به وسأشرح من خلاله\"، ثم اشرح عبر ما يجيب به",
        "en": "No interests are known yet. If the learner says an explanation isn't helping or isn't landing — that is the moment: ask \"tell me about something you love or relate to, and I'll explain through it\", then explain through whatever they answer",
    },
    "preferences": {
        "he": "עוד לא ידוע איך הכי נוח לתלמיד/ה ללמוד. כשמתאים, שאל/י שאלה קצרה אחת (למשל: הסבר בשלבים או דוגמה קודם?) וזכור/זכרי את התשובה",
        "ar": "لا يُعرف بعد كيف يفضّل الطالب/ة أن يتعلم. عند الملاءمة اسأل سؤالًا قصيرًا واحدًا (مثلًا: شرح بخطوات أم مثال أولًا؟)",
        "en": "It is not yet known how this learner prefers to learn. When fitting, ask one short question (e.g., steps first or an example first?) and remember the answer",
    },
    "strategies": {
        "he": "עוד לא ידועה אסטרטגיה שעובדת לתלמיד/ה. אחרי הצלחה, שאל/י בקצרה מה עזר הפעם — כדי להשתמש בזה שוב",
        "ar": "لا تُعرف بعد استراتيجية ناجحة لهذا الطالب/ة. بعد نجاح، اسأل باختصار ما الذي ساعد هذه المرة — لاستخدامه لاحقًا",
        "en": "No working strategy is known for this learner yet. After a success, briefly ask what helped this time — so it can be used again",
    },
}


def _personalization_gaps(
    interests: list[str],
    preferences: list[str],
    learning_style: str,
    strategies: list[str],
    locale: str,
) -> list[str]:
    """Verbal 'what we don't know yet' hints, most valuable first, max 2."""
    lang = locale if locale in {"he", "ar", "en"} else "he"
    gaps: list[str] = []
    if not interests:
        gaps.append(_PERSONALIZATION_GAP_HINTS["interests"][lang])
    if not preferences and not learning_style:
        gaps.append(_PERSONALIZATION_GAP_HINTS["preferences"][lang])
    if not strategies:
        gaps.append(_PERSONALIZATION_GAP_HINTS["strategies"][lang])
    return gaps[:2]


async def build_coach_bundle(
    learner_id: Optional[str],
    surface_context: Optional[dict[str, Any]] = None,
    user_message: Optional[str] = None,
    query_intent: Optional[str] = None,
    pinned_question_key: Optional[str] = None,
) -> dict[str, Any]:
    """Assemble the non-identifying Coach Context bundle (§4.4).

    Contains no name/PII. `informationToBot` (from the current component's
    metadata) lets the Coach give item-specific help; `recent_events` let it
    detect struggle. Content/event lookups are imported lazily to avoid cycles.

    `pinned_question_key` grounds the bundle on a SPECIFIC question instead of
    wherever the learner is standing right now. A nudge about an answer is
    composed asynchronously, and Kata advances the screen the instant the answer
    lands — measured 29/07 on `…-01-02`, the praise for סעיף ב of שאלה 1 was
    written about שאלה 2's content, because by composition time the pointer had
    already moved. Every AI claim must be traceable to what the learner actually
    did, so the trigger's own question wins here.
    """
    from app.brain.memory import (
        active_themes,
        build_learner_portrait,
        classify_query_intent,
        memory_defaults,
    )
    from app.services import content_intelligence, kata_catalog, kata_client
    from app.services.kata_catalog import get_component, localized_objective_title
    from app.services.events import get_recent_events

    await kata_catalog.ensure_loaded()
    brain = await view_for("coach", learner_id)
    goals = get_path(brain, "goals") or []
    component_id = get_path(brain, "current_state.component_id")
    unit_id = get_path(brain, "current_state.unit_id")
    item_id = get_path(brain, "current_state.item_id")
    question_id = get_path(brain, "current_state.question_id")
    if pinned_question_key:
        # `component|item|question`, the shape `tutor_decision.support_question_key`
        # publishes. Only override the parts the key actually names, so a partial
        # key still falls back to the live pointer rather than blanking the screen.
        parts = str(pinned_question_key).split("|")
        parts += [""] * (3 - len(parts))
        component_id = parts[0] or component_id
        item_id = parts[1] or item_id
        question_id = parts[2] or question_id
    resume_token = get_path(brain, "current_state.resume_token")
    pace = get_path(brain, "current_state.pace")
    component = get_component(component_id) if component_id else None
    provider_unit: Optional[dict[str, Any]] = None
    provider_component: Optional[dict[str, Any]] = None
    if component_id and component is None:
        # Fall back to a live Kata fetch for a component outside the cached spine.
        try:
            provider_unit, provider_component = await kata_client.resolve_component(
                component_id, unit_id
            )
        except kata_client.KataError:
            pass
    objective_id = (
        (component or {}).get("objective_id")
        or (provider_unit or {}).get("objective_id")
    )
    locale = get_path(brain, "identity.locale") or "he"
    intent = query_intent or classify_query_intent(user_message or "", locale)
    screen = (surface_context or {}).get("screen")
    if screen not in COACH_SCREEN_AREAS:
        screen = "unknown"
    # `current_state` is the learner's LAST lesson pointer and survives leaving the
    # lesson, so on the dashboard the coach was handed a live question that was no
    # longer on screen — and answered every off-topic ask by pointing back at it.
    # A pinned key means a nudge composed about a specific question, which stays
    # authoritative regardless of where the learner has since navigated.
    on_lesson_screen = screen == "learning_lesson" or bool(pinned_question_key)

    # Every free-text value is bounded and deterministically PII-redacted before
    # entering the model prompt. Internal scores and identity fields are absent
    # from the Coach scope entirely.
    from app.agents.safety import strip_pii

    def safe_text(value: Any, limit: int = 180) -> str:
        text, _ = strip_pii(str(value or ""))
        return text.replace("<", "‹").replace(">", "›").strip()[:limit]

    def labels(values: Any, limit: int = 3) -> list[str]:
        result: list[str] = []
        for value in values if isinstance(values, list) else []:
            if isinstance(value, dict) and value.get("learner_feedback") == "inaccurate":
                continue
            raw = value.get("label") or value.get("text") if isinstance(value, dict) else value
            text = safe_text(raw)
            if text:
                result.append(text)
            if len(result) >= limit:
                break
        return result

    memory = get_path(brain, "memory") or memory_defaults()
    memory_interests = [
        safe_text(theme.get("value"))
        for theme in active_themes(memory, {"interest"}, limit=6)
    ]
    memory_characteristics = [
        safe_text(theme.get("value"))
        for theme in active_themes(memory, {"characteristic", "self_belief"}, limit=3)
    ]
    memory_preferences = [
        safe_text(theme.get("value"))
        for theme in active_themes(memory, {"preference"}, limit=5)
    ]

    strategies: list[str] = []
    for strategy in get_path(brain, "strategies") or []:
        if not isinstance(strategy, dict):
            continue
        confidence = strategy.get("confidence")
        if isinstance(confidence, (int, float)) and confidence < 0.65:
            continue
        note = safe_text(strategy.get("note") or strategy.get("text"))
        if note:
            strategies.append(note)
        if len(strategies) >= 3:
            break

    current_ids = {value for value in (unit_id, component_id, item_id, objective_id) if value}
    now = datetime.now(timezone.utc)
    teacher_guidance: list[str] = []
    for directive in reversed(get_path(brain, "teacher_directives") or []):
        if not isinstance(directive, dict):
            continue
        expires_at = directive.get("expires_at")
        if expires_at:
            try:
                expires = datetime.fromisoformat(str(expires_at).replace("Z", "+00:00"))
                if expires.tzinfo is None:
                    expires = expires.replace(tzinfo=timezone.utc)
                if expires <= now:
                    continue
            except ValueError:
                continue
        scope = safe_text(directive.get("scope"), 100)
        if scope and scope not in {"all", "global"}:
            scoped_id = scope.split(":", 1)[-1]
            if scoped_id not in current_ids:
                continue
        text = safe_text(directive.get("text"))
        if text:
            teacher_guidance.append(text)
        if len(teacher_guidance) >= 3:
            break
    teacher_guidance.reverse()

    # B-4: mastery stance + activeness coaching hints + the student description.
    # All verbal, evidence-traceable; internal scores never leave the server.
    from app.brain.mastery import stance_for
    from app.brain import description as description_model

    mastery_map = get_path(brain, "mastery") or {}
    objective_title = (
        localized_objective_title(objective_id, locale) if objective_id else ""
    ) or (provider_unit or {}).get("title") or ""
    mastery_stance = [
        safe_text(line, 220)
        for line in stance_for(mastery_map, objective_id, objective_title, locale)
    ]
    coaching_hints = _activeness_hints(get_path(brain, "profile.activeness") or {}, locale)
    description_text = safe_text(
        get_path(brain, "student_description.text"), 600
    )
    # Lazy freshness: stale description regenerates in the background for the
    # NEXT turn; this one uses what exists (never blocks the conversation).
    if learner_id:
        try:
            description_model.maybe_schedule_regeneration(
                learner_id, {"student_description": get_path(brain, "student_description") or {}}
            )
        except Exception:
            pass

    clarifications = labels(get_path(brain, "profile.mapping_clarifications") or [], limit=3)

    recent = await get_recent_events(learner_id or "", objective_id=objective_id, limit=5)

    # Reconcile a Kata PLAYER screen id lingering in current_state to the CATALOG
    # sub-content id (ingest fixes this going forward; this covers a value stored
    # before the fix or mid-navigation). Without it the coach grounds hints on the
    # NEXT item (player `-002` == catalog `-001`). Anchored by the current
    # question id + recent runtime ids; a no-op once current_state holds a catalog id.
    if component_id and item_id:
        reconciled = kata_catalog.resolve_catalog_item_id(
            component_id,
            item_id,
            question_id=question_id,
            seen_item_ids=[
                e.get("runtime_item_id") for e in recent if e.get("runtime_item_id")
            ],
        )
        if reconciled and reconciled != item_id:
            item_id = reconciled

    recent_view = [
        {
            "verb": safe_text(e.get("verb"), 60),
            "success": (e.get("result") or {}).get("success"),
            "response": safe_text((e.get("result") or {}).get("response"), 200),
            "answer_diagnostic": (e.get("result") or {}).get("answer_diagnostic"),
            "effortful": e.get("effortful"),
            "misconception": safe_text(e.get("misconception"), 120),
            "question_id": safe_text(e.get("question_id"), 100),
            "object_id": safe_text(e.get("object_id"), 180),
            "component_id": safe_text(e.get("launch"), 160),
            "elapsed_seconds": (e.get("timing") or {}).get("elapsed_since_previous_seconds"),
            "timing_quality": safe_text((e.get("timing") or {}).get("quality"), 40),
        }
        for e in recent
    ]

    # Exact current question (text/options/correct answer) for the sub-item the
    # learner is on — server-only ground truth so the coach guides accurately
    # without revealing the answer. Prefer the current question_id, else the
    # item's first question.
    current_questions = (
        (provider_component or {}).get("questions_by_item", {}).get(item_id)
        if provider_component
        else kata_catalog.questions_for_item(component_id, item_id)
    ) or []
    current_question: dict[str, Any] = {}
    if current_questions:
        # Where the learner is, if we can actually find them. `located` stays
        # None when the pointer names a question this screen does not list (or
        # names none at all) — the TEXT still falls back to the first question so
        # the coach has something to work with, but the POSITION must not: saying
        # "now for the first part" when we could not locate them is asserting a
        # fact we do not have, and the learner may well be on part 3.
        located = next(
            (index for index, q in enumerate(current_questions, start=1)
             if q.get("questionId") == question_id),
            None,
        )
        chosen = current_questions[located - 1] if located else current_questions[0]
        current_question = {
            "text": safe_text(chosen.get("questionText"), 600),
            "type": safe_text(chosen.get("questionType"), 40),
            "options": [safe_text(a, 200) for a in (chosen.get("answers") or []) if a][:12],
            "correct": [safe_text(a, 200) for a in (chosen.get("correctAnswers") or []) if a][:12],
        }
        # WHICH סעיף of the screen this is. A screen can hold several parts of one
        # question (`…-01-02-001` holds two, the assessment holds four), and
        # without this the arrival intro opened every one of them by describing
        # the WHOLE screen again — so a learner already on part 3 was told "this
        # question is about accuracy and reliability through 4 targets", as if
        # they had just walked in. Position comes from the catalog's own ORDER,
        # never from parsing the id, so `q1..qN`, `a/b/c` and `Q_07` all work.
        # Only set when the screen really is shared: announcing "part 1 of 1"
        # would invent structure the learner cannot see.
        if located and len(current_questions) > 1:
            current_question["part"] = located
            current_question["part_total"] = len(current_questions)
            # The OTHER parts sharing this screen, as plain text. A multi-part
            # screen usually states its data ONCE, in the first part: `…-02-001`
            # סעיף א lists the measurements, and סעיף ב is only "should they
            # measure again?". Handed nothing but the current part, the coach was
            # structurally blind to the numbers the learner is looking at, and
            # its arrival intro degenerated into filler that fit any question at
            # all — "let's find what this question asks, starting from the
            # central datum", naming no datum because it had none.
            #
            # Text only, deliberately: options and correct answers of the OTHER
            # parts stay out, so widening what the coach can SEE never widens
            # what it could give away.
            current_question["screen_parts"] = [
                {
                    "part": index,
                    "text": safe_text(q.get("questionText"), 400),
                    "current": index == located,
                }
                for index, q in enumerate(current_questions, start=1)
                if safe_text(q.get("questionText"), 400)
            ]

    # The screen's own identity (title / contentType / mediaFormat / kind), so a
    # video or teaching screen is recognizable as such and not read as "a
    # question whose text we failed to load".
    provider_rows = (provider_component or {}).get("items") or []
    item_profile = next(
        (
            {**row, "kind": kata_catalog.kind_for_row(row)}
            for row in provider_rows if row.get("id") == item_id
        ),
        None,
    ) if provider_rows else kata_catalog.item_profile(component_id, item_id)
    item_profile = item_profile or {}
    current_item = {
        # Which path the learner picked on a screen that offers two (720
        # §Selected / learning-type: "listening" = the clip, "cards" = the info
        # cards). Same screen either way as far as the events go, so without this
        # the coach cannot tell what is in front of them.
        "chosen_path": safe_text(get_path(brain, "current_state.learning_choice"), 40),
        "kind": safe_text(item_profile.get("kind"), 20) or ("question" if current_question else ""),
        "title": safe_text(item_profile.get("title"), 200),
        "content_type": safe_text(item_profile.get("content_type"), 60),
        "media_format": safe_text(item_profile.get("media_format"), 60),
    } if item_profile else {}

    # WHERE IN THE SCREEN the learner is, read from their own xAPI evidence.
    #
    # Knowing the screen is not enough. `…-01-01-003` is a video playlist that
    # ALSO carries a comprehension question part-way through, and the bundle
    # handed the coach that question in full while the learner was still on the
    # clip. Asked "מה מופיע פה?" mid-video, Yuvi described the question about
    # writing units — content the learner had not reached yet.
    #
    # The rule is deliberately content-agnostic, so it holds for any component
    # Kata ships: a question counts as REACHED only once there is evidence the
    # learner engaged with it. Until then, whatever medium the screen carries is
    # what is in front of them.
    _MEDIA_VERBS = {"played", "paused", "play", "watched", "listened"}
    _ANSWER_VERBS = {"answered", "attempted", "scored", "completed"}
    engaged_question = any(
        e.get("verb") in _ANSWER_VERBS and e.get("sub_item_id") == item_id
        for e in recent
    ) if item_id else False
    # Kata reports media against the COMPONENT with no screen id, so media
    # evidence can only be matched at component scope — that is all the provider
    # gives us (see the defect report, finding 8).
    consuming_media = any(
        e.get("verb") in _MEDIA_VERBS and e.get("launch") == component_id
        for e in recent
    ) if component_id else False
    plays_media = bool(current_item) and current_item.get("kind") in {"watch", "read"}

    if engaged_question:
        screen_stage = "working_on_question"
    elif plays_media and consuming_media:
        screen_stage = "consuming_media"
    elif plays_media:
        screen_stage = "arrived_at_media"
    elif current_question:
        screen_stage = "working_on_question"
    else:
        screen_stage = "on_step"
    if current_item:
        current_item["stage"] = screen_stage
    # A question the learner has not got to yet must not be described as "what is
    # on screen". It stays in the bundle so a hint still lands correctly the
    # moment they do reach it — only its STATUS changes.
    question_reached = screen_stage == "working_on_question"
    if current_question:
        current_question["reached"] = question_reached

    interests_view = memory_interests or labels(
        get_path(brain, "profile.interests") or [], limit=6
    )
    preferences_view = memory_preferences or labels(
        get_path(brain, "profile.preferences") or [], limit=5
    )
    learning_style_view = safe_text(get_path(brain, "profile.learning_style"))
    personalization_gaps = _personalization_gaps(
        interests_view, preferences_view, learning_style_view, strategies, locale
    )

    daily_feeling = today_valid_feeling(get_path(brain, "current_state.daily_feeling"))

    return {
        "daily_feeling": (
            {"valence": safe_text(daily_feeling.get("valence"), 20),
             "feeling": safe_text(daily_feeling.get("feeling"), 40)}
            if daily_feeling else None
        ),
        "profile": {
            "interests": interests_view,
            "characteristics": memory_characteristics
            or labels(get_path(brain, "profile.characteristics") or []),
            "learning_style": learning_style_view,
            "preferences": preferences_view,
            "environment": safe_text(get_path(brain, "profile.environment")),
        },
        "strengths": labels(get_path(brain, "strengths") or []),
        "challenges": labels([
            c for c in (get_path(brain, "challenges") or [])
            if not (isinstance(c, dict) and c.get("status") == "resolved")
        ]),
        "strategies": strategies,
        "student_description": description_text,
        "mastery_stance": mastery_stance,
        "coaching_hints": coaching_hints,
        "personalization_gaps": personalization_gaps,
        "mapping_clarifications": clarifications,
        "reflection_summary": {
            "has_recent_reflection": bool(brain.get("reflections_recent")),
            "recent_count": min(len(brain.get("reflections_recent") or []), 8),
            "most_recent_prompt_id": safe_text(
                ((brain.get("reflections_recent") or [{}])[-1] or {}).get("prompt_id"), 80
            ) if isinstance((brain.get("reflections_recent") or [{}])[-1], dict) else "",
            "most_recent_at": safe_text(
                ((brain.get("reflections_recent") or [{}])[-1] or {}).get("at"), 40
            ) if isinstance((brain.get("reflections_recent") or [{}])[-1], dict) else "",
        },
        "goals": [
            {
                "text": safe_text(g.get("text")),
                "deadline": safe_text(g.get("deadline"), 40),
                "status": safe_text(g.get("status") or "open", 24),
            }
            for g in goals
            if isinstance(g, dict) and g.get("visible_to_learner", True)
        ][:5],
        "teacher_guidance": teacher_guidance,
        "surface": {
            "screen": screen,
            "visible_areas": COACH_SCREEN_AREAS[screen],
        },
        "current": {
            # Whether everything below describes the screen in front of the
            # learner, or where they left off last time.
            "on_lesson_screen": on_lesson_screen,
            "objective_id": objective_id,
            "objective_title": (
                safe_text((provider_unit or {}).get("title"), 160)
                if provider_unit else (
                    safe_text(localized_objective_title(objective_id, locale), 160)
                    if objective_id else ""
                )
            ),
            "task_status": (
                "resume_available" if component_id and resume_token else "no_open_task"
            ),
            "pace": safe_text(pace, 30),
            "informationToBot": safe_text(
                (
                    # Prefer the exact sub-content item the learner is on (Kata
                    # keeps per-item mistake/strategy notes) → sharper hints.
                    (provider_component or {}).get("information_by_item", {}).get(item_id)
                    or (provider_component or {}).get("information_to_bot")
                    if provider_component else
                    kata_catalog.information_for_item(component_id, item_id)
                ),
                900,
            ),
            "question": current_question,
            # WHAT KIND of screen this is. A component is a sequence of פריטים,
            # and only some of them ask something — a video, a reading or a
            # simulation is a learning step. Without this the coach treated every
            # screen as a question and had nothing to say on the others.
            "item": current_item,
            # What the slide LOOKS like to the learner — text and media the
            # nightly browser pass read off the real screen. Served only while
            # provably fresh (content_intelligence fingerprint gate); the
            # authored note above stays the primary grounding. Screen text is
            # vendor/browser content — neutralized like every other context line.
            "screen_enrichment": (
                {
                    "visible_text": safe_text(screen_enrichment.get("visible_text"), 700),
                    "media": [safe_text(m, 90) for m in screen_enrichment.get("media") or []],
                }
                if (screen_enrichment := (
                    content_intelligence.enrichment(component_id, item_id)
                    if component_id and item_id else None
                )) else None
            ),
            "hint_ladder": get_path(brain, "current_state.hint_ladder") or {},
            "recent_events": recent_view,
            # Ids for the per-question message key (chat scoping), so a stored
            # turn is tagged with the same question the support buttons gate on.
            "component_id": component_id,
            "item_id": item_id,
            "question_id": question_id,
        },
        "query_intent": intent,
        "portrait": (
            build_learner_portrait(brain, locale)
            if intent in {"profile_question", "memory_correct", "memory_forget"}
            else {}
        ),
        "locale": locale,
    }
