"""The L1 → English ladder for spoken practice (אנגלית לכולם, נספח 1 §2.4).

The tender asks the agent to start by mediating in the learner's own language,
then move to English "with the identification of progress", and finally to
challenge the learner to answer in English only. That progression must be earned
from evidence, not decided by a model: an LLM asked "is this learner ready for
English only?" will answer differently on two identical days, and the answer
drives what the child is asked to do.

So the stage is computed here, deterministically, from three things the learner
actually did — how intelligibly they spoke, how much English they chose to
speak, and how much of the unit's language they have mastered. The agent is
*told* the stage; it never picks one.
"""

from __future__ import annotations

from typing import Any, Optional

# Stage names are internal. The learner never sees them, and neither does the
# teacher view — they only change how Yuvi talks.
STAGE_L1 = "l1_mediated"
STAGE_MIXED = "mixed"
STAGE_ENGLISH = "english_only"

STAGES = (STAGE_L1, STAGE_MIXED, STAGE_ENGLISH)

# Promotion needs BOTH enough evidence and a good-enough result, so one lucky
# sentence cannot push a struggling learner into an English-only conversation.
_MIN_ATTEMPTS_FOR_MIXED = 3
_MIN_ATTEMPTS_FOR_ENGLISH = 8

_MIXED_ACCURACY = 62.0
_ENGLISH_ACCURACY = 78.0

# Share of turns the learner chose to speak in English (they are never forced).
_MIXED_ENGLISH_SHARE = 0.35
_ENGLISH_ENGLISH_SHARE = 0.7

# A stage never drops on one bad day; it drops when the recent average says the
# learner is genuinely out of their depth, because leaving them there is worse.
_DEMOTION_ACCURACY = 50.0
_DEMOTION_ATTEMPTS = 3

# Hysteresis. Climbing a rung takes the full threshold; holding it only takes
# the threshold minus this margin. Without it a single rough utterance moves the
# average enough to change how the child is spoken to mid-conversation, which
# reads as the system losing faith in them over one sentence.
_HOLD_MARGIN = 12.0

_EMPTY: dict[str, Any] = {
    "stage": STAGE_L1,
    "attempts": 0,
    "accuracy_ewma": None,
    "fluency_ewma": None,
    "english_turns": 0,
    "total_turns": 0,
    "updated_at": None,
}

# Recent evidence should count more than a first attempt weeks ago, without
# letting a single utterance rewrite the picture.
_EWMA_ALPHA = 0.22


def empty_state() -> dict[str, Any]:
    return dict(_EMPTY)


def _ewma(previous: Optional[float], value: Optional[float]) -> Optional[float]:
    if value is None:
        return previous
    if previous is None:
        return round(float(value), 2)
    return round(previous * (1 - _EWMA_ALPHA) + float(value) * _EWMA_ALPHA, 2)


def stage_for(
    state: Optional[dict[str, Any]],
    mastery_ratio: float = 0.0,
    current: Optional[str] = None,
) -> str:
    """The stage this evidence supports. Pure — same input, same answer.

    `current` is the rung the learner is already on; it only ever makes the
    thresholds easier to HOLD, never easier to climb.
    """
    state = state or {}
    attempts = int(state.get("attempts") or 0)
    accuracy = state.get("accuracy_ewma")
    total = int(state.get("total_turns") or 0)
    english_share = (int(state.get("english_turns") or 0) / total) if total else 0.0

    if accuracy is None or attempts < _MIN_ATTEMPTS_FOR_MIXED:
        return STAGE_L1

    if attempts >= _DEMOTION_ATTEMPTS and accuracy < _DEMOTION_ACCURACY:
        return STAGE_L1

    def _bar(threshold: float, stage: str) -> float:
        return threshold - _HOLD_MARGIN if current == stage else threshold

    ready_for_english = (
        attempts >= _MIN_ATTEMPTS_FOR_ENGLISH
        and accuracy >= _bar(_ENGLISH_ACCURACY, STAGE_ENGLISH)
        and english_share >= _ENGLISH_ENGLISH_SHARE
        # Vocabulary and grammar carry the conversation once the scaffolding is
        # gone, so an English-only chat needs the unit's language behind it.
        and mastery_ratio >= 0.5
    )
    if ready_for_english:
        return STAGE_ENGLISH

    if accuracy >= _bar(_MIXED_ACCURACY, STAGE_MIXED) and english_share >= _MIXED_ENGLISH_SHARE:
        return STAGE_MIXED

    return STAGE_L1


def apply_attempt(
    state: Optional[dict[str, Any]],
    *,
    accuracy: Optional[float] = None,
    fluency: Optional[float] = None,
    spoke_english: bool = False,
    scored: bool = True,
    mastery_ratio: float = 0.0,
    now: Optional[str] = None,
) -> dict[str, Any]:
    """Fold one spoken turn into the ladder and return the new state.

    `scored` separates a graded pronunciation attempt from an ordinary
    conversational turn: both count towards how much English the learner is
    choosing to speak, only the graded one moves the accuracy average.
    """
    next_state = {**empty_state(), **(state or {})}
    previous_stage = next_state.get("stage")
    next_state["total_turns"] = int(next_state.get("total_turns") or 0) + 1
    if spoke_english:
        next_state["english_turns"] = int(next_state.get("english_turns") or 0) + 1
    if scored and accuracy is not None:
        next_state["attempts"] = int(next_state.get("attempts") or 0) + 1
        next_state["accuracy_ewma"] = _ewma(next_state.get("accuracy_ewma"), accuracy)
        next_state["fluency_ewma"] = _ewma(next_state.get("fluency_ewma"), fluency)
    next_state["stage"] = stage_for(next_state, mastery_ratio, current=previous_stage)
    next_state["updated_at"] = now
    return next_state


def mastery_ratio(mastery: Optional[dict[str, Any]]) -> float:
    """How much of the English spine the learner has actually achieved."""
    entries = [
        entry for key, entry in (mastery or {}).items()
        if isinstance(entry, dict) and "ENG" in str(key).upper()
    ]
    if not entries:
        return 0.0
    achieved = sum(1 for entry in entries if entry.get("achieved"))
    return achieved / len(entries)


# How Yuvi should speak at each stage. Given to the model as an instruction, in
# the learner's own language, so the ladder is visible in behaviour and not just
# in a database field.
SPEAKING_POLICY = {
    STAGE_L1: {
        "he": (
            "הלומד/ת בתחילת הדרך בדיבור. פתחו כל משימה בהסבר קצר בעברית, ואז אמרו את "
            "המשפט באנגלית לאט וברור. מותר לגמרי לענות לכם בעברית — אל תדרשו אנגלית. "
            "בקשו לחזור על משפט קצר אחד בכל פעם, ושבחו כל ניסיון להשמיע קול."
        ),
        "ar": (
            "المتعلّم/ة في بداية طريقه في المحادثة. ابدأوا كل مهمة بشرح قصير بالعربية، "
            "ثم قولوا الجملة بالإنجليزية ببطء ووضوح. من الطبيعي تماماً أن يجيبوكم بالعربية — "
            "لا تطالبوا بالإنجليزية. اطلبوا تكرار جملة قصيرة واحدة في كل مرة، وامدحوا كل محاولة."
        ),
        "en": (
            "This learner is at the very start of speaking. Open each task with a short "
            "explanation in their own language, then say the English sentence slowly and "
            "clearly. Answering you in their own language is completely fine — never demand "
            "English. Ask for one short sentence at a time, and praise every attempt to speak."
        ),
    },
    STAGE_MIXED: {
        "he": (
            "הלומד/ת כבר מדבר/ת קצת אנגלית. נהלו את השיחה באנגלית פשוטה, ועברו לעברית רק "
            "כשרואים תקיעה אמיתית — משפט אחד של תיווך ואז חזרה לאנגלית. עודדו משפטים ארוכים "
            "קצת יותר, ושאלו שאלת המשך אחת בכל תור."
        ),
        "ar": (
            "المتعلّم/ة يتحدّث بعض الإنجليزية. أديروا الحديث بإنجليزية بسيطة، وانتقلوا إلى "
            "العربية فقط عند التعثّر الحقيقي — جملة وساطة واحدة ثم العودة إلى الإنجليزية. "
            "شجّعوا جملاً أطول قليلاً، واطرحوا سؤال متابعة واحداً في كل دور."
        ),
        "en": (
            "This learner already speaks some English. Run the conversation in simple "
            "English and switch to their own language only at a real breakdown — one "
            "mediating sentence, then back to English. Encourage slightly longer sentences "
            "and ask one follow-up question per turn."
        ),
    },
    STAGE_ENGLISH: {
        "he": (
            "הלומד/ת מוכן/ה לשיחה באנגלית בלבד. דברו רק אנגלית, גם כשמבקשים מכם עברית — "
            "במקום לתרגם, נסחו מחדש במילים פשוטות יותר. אתגרו במשפטים ארוכים, בשאלות פתוחות "
            "ובאוצר מילים חדש, ובקשו לענות באנגלית בלבד."
        ),
        "ar": (
            "المتعلّم/ة جاهز/ة لمحادثة بالإنجليزية فقط. تحدّثوا بالإنجليزية فقط، حتى عند "
            "طلب العربية — بدل الترجمة، أعيدوا الصياغة بكلمات أبسط. تحدّوهم بجمل أطول "
            "وأسئلة مفتوحة ومفردات جديدة، واطلبوا الإجابة بالإنجليزية فقط."
        ),
        "en": (
            "This learner is ready for an English-only conversation. Speak only English, "
            "even when asked for their own language — rephrase in simpler words instead of "
            "translating. Challenge them with longer sentences, open questions and new "
            "vocabulary, and ask them to answer in English only."
        ),
    },
}


def policy_for(stage: Optional[str], language: str = "he") -> str:
    table = SPEAKING_POLICY.get(stage or STAGE_L1) or SPEAKING_POLICY[STAGE_L1]
    return table.get(language) or table["he"]
