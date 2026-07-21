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
            "teacher_directives", "memory", "mastery", "student_description",
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
    "safety": {
        "read": ["identity.locale"],
        "write": ["wellbeing_flags"],
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
) -> dict[str, Any]:
    """Assemble the non-identifying Coach Context bundle (§4.4).

    Contains no name/PII. `informationToBot` (from the current component's
    metadata) lets the Coach give item-specific help; `recent_events` let it
    detect struggle. Content/event lookups are imported lazily to avoid cycles.
    """
    from app.brain.curriculum import get_component, localized_objective_title
    from app.brain.memory import (
        active_themes,
        build_learner_portrait,
        classify_query_intent,
        memory_defaults,
    )
    from app.services.content_catalog import information_to_bot
    from app.services import content_provider
    from app.services.events import get_recent_events

    brain = await view_for("coach", learner_id)
    goals = get_path(brain, "goals") or []
    component_id = get_path(brain, "current_state.component_id")
    unit_id = get_path(brain, "current_state.unit_id")
    item_id = get_path(brain, "current_state.item_id")
    resume_token = get_path(brain, "current_state.resume_token")
    pace = get_path(brain, "current_state.pace")
    component = get_component(component_id) if component_id else None
    provider_unit: Optional[dict[str, Any]] = None
    provider_component: Optional[dict[str, Any]] = None
    if component_id and component is None:
        try:
            provider_unit, provider_component = await content_provider.resolve_component(
                component_id, unit_id
            )
        except content_provider.ContentProviderError:
            pass
    objective_id = (component or {}).get("objective_id") or (provider_unit or {}).get("objective_id")
    locale = get_path(brain, "identity.locale") or "he"
    intent = query_intent or classify_query_intent(user_message or "", locale)
    screen = (surface_context or {}).get("screen")
    if screen not in COACH_SCREEN_AREAS:
        screen = "unknown"

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
    recent_view = [
        {
            "verb": safe_text(e.get("verb"), 60),
            "success": (e.get("result") or {}).get("success"),
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

    return {
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
                (provider_component or {}).get("information_to_bot")
                or information_to_bot(component_id),
                900,
            ),
            "hint_ladder": get_path(brain, "current_state.hint_ladder") or {},
            "recent_events": recent_view,
        },
        "query_intent": intent,
        "portrait": (
            build_learner_portrait(brain, locale)
            if intent in {"profile_question", "memory_correct", "memory_forget"}
            else {}
        ),
        "locale": locale,
    }
