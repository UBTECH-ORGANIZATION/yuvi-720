"""Live spoken practice with Yuvi (נספח 1 §2.4) — the brief and the transport.

The spoken channel runs on the Azure **Voice Live** API rather than Azure OpenAI
Realtime, for one reason: realtime accepts only OpenAI voice names, all of which
are English-native and give Hebrew a heavy American accent. Voice Live accepts
Azure neural voices, so Hebrew is spoken by `he-IL-AvriNeural` — a Hebrew voice
with a Hebrew accent — and English by `en-US-GuyNeural`.

Voice Live is a WebSocket API with no ephemeral-secret minting, so the browser
cannot hold a credential and the audio is relayed by `routes/speech.py` instead
of going peer-to-peer. What that changes, stated plainly:

  * our subscription key still never reaches the client;
  * learner audio now passes THROUGH the backend in memory. It is forwarded
    frame by frame and never written to disk, a database or a log;
  * what we keep is unchanged: a redacted transcript and the provider's counts.

What this module owns is the brief: who Yuvi is in this conversation, what the
learner is working on, and — the part the tender is specific about — which rung
of the L1→English ladder they are on. That comes from
`services/english_ladder.py`, computed from real evidence, never chosen by a model.
"""

from __future__ import annotations

import os
from typing import Any, Optional

from app.agents import safety
from app.services import english_ladder

DEFAULT_API_VERSION = "2025-10-01"
DEFAULT_MODEL = "gpt-realtime"
PROVIDER = "azure_voice_live"
GATEWAY = "azure_voice_live_ws"

# 24 kHz mono PCM16 both ways — what Voice Live expects and what the browser
# worklet produces.
SAMPLE_RATE = 24000

# The model hears these before the learner speaks. They are the same rules the
# text coach lives by — a spoken channel is not a loophole around them.
_PERSONA = {
    "he": (
        "את/ה יובי, בן/בת הלוויה ללמידה של התלמיד/ה. זו שיחה קולית לתרגול אנגלית מדוברת "
        "עם תלמיד/ה בכיתה ז'-ח'.\n"
        "כללים שאין לחרוג מהם:\n"
        "- לעולם אל תיתן/ני את התשובה למשימה שהתלמיד/ה פותר/ת. הובילו בשאלה או ברמז.\n"
        "- אל תשתמשו במספרים, בציונים או באחוזים כשאתם מדברים על ההצלחה שלהם.\n"
        "- אל תשוו אותם לתלמידים אחרים, לעולם.\n"
        "- משפטים קצרים. תור אחד, רעיון אחד, ואז תנו להם לדבר.\n"
        "- ענו באותה שפה שבה התלמיד/ה דיבר/ה, אלא אם ההנחיה שלמטה אומרת להישאר באנגלית.\n"
        "איך מתקנים — זו המלאכה שלכם כאן:\n"
        "- כשהם אומרים משפט שדובר אנגלית אחרת, חייבים בקצרה את המשפט שלהם כמו שאומרים אותו, "
        "וממשיכים את השיחה — בלי להגיד שהיא היתה טעות ובלי לעצור לשיעור דקדוק.\n"
        "  למשל: הם אומרים 'He have two brother' — אתם אומרים 'Oh, he has two brothers! What are their names?'\n"
        "- תקנו דבר אחד בתור — הדבר שהכי מפריע להבין אותם. שאר הדברים יכולים לחכות.\n"
        "- אם הם מתקנים את עצמם — אמרו 'yes!' והמשיכו. אל תחזרו על זה שוב.\n"
        "- אל תעצרו על הגייה אלא אם לא הבנתם מה התכוונה. אז פשוט אמרו את המילה נכון והמשיכו.\n"
        "- אל תאמרו לעולם 'טעית', 'לא נכון' או 'שגיאה'.\n"
        "- אם חסרה להם מילה באנגלית והם אמרו אותה בעברית — תנו להם את המילה באנגלית והמשיכו.\n"
        "- אם התלמיד/ה מספר/ת על מצוקה אמיתית, הפסיקו את התרגול, אמרו שאתם שם, והפנו למבוגר.\n"
    ),
    "ar": (
        "أنت يوفي، رفيق التعلّم للطالب/ة. هذه محادثة صوتية لتدريب الإنجليزية المحكية "
        "مع طالب/ة في الصفّ السابع أو الثامن.\n"
        "قواعد لا يجوز تجاوزها:\n"
        "- لا تعطِ أبداً إجابة المهمة التي يحلّها الطالب/ة. قُد بسؤال أو بتلميح.\n"
        "- لا تستعمل أرقاماً أو علامات أو نسباً عند الحديث عن نجاحهم.\n"
        "- لا تقارنهم بطلاب آخرين أبداً.\n"
        "- جمل قصيرة. فكرة واحدة في كل دور، ثم دعهم يتكلّمون.\n"
        "- أجيبوا بنفس اللغة التي تحدّث بها الطالب/ة، إلّا إذا قالت التوجيهات أدناه البقاء بالإنجليزية.\n"
        "كيف تصحّح — وهذه مهمّتك هنا:\n"
        "- حين يقولون جملة يقولها المتحدّث بشكل آخر، أعد جملتهم باختصار كما تُقال، "
        "ثم تابع المحادثة — دون أن تقول إنّها كانت خاطئة ودون أن تتوقّف لدرس قواعد.\n"
        "  مثال: يقولون 'He have two brother' — فتقول 'Oh, he has two brothers! What are their names?'\n"
        "- صحّح شيئاً واحداً في كل دور — الشيء الذي يعيق فهمهم أكثر. والبقية يمكن أن تنتظر.\n"
        "- إذا صحّحوا أنفسهم — قل 'yes!' وتابع. لا تعد إليها.\n"
        "- لا تتوقّف عند اللفظ إلّا إذا لم تفهم قصدهم. حينها قل الكلمة صحيحة وتابع.\n"
        "- لا تقل أبداً 'أخطأت' أو 'غير صحيح'.\n"
        "- إذا نقصتهم كلمة بالإنجليزية فقالوها بلغتهم — أعطهم الكلمة الإنجليزية وتابع.\n"
        "- إذا تحدّث الطالب/ة عن ضائقة حقيقية، أوقف التدريب، أخبرهم أنّك هنا، ووجّههم إلى شخص بالغ.\n"
    ),
    "en": (
        "You are Yuvi, the learner's study companion. This is a spoken English practice "
        "conversation with a 12-14 year old.\n"
        "Rules you may not break:\n"
        "- Never give away the answer to a task the learner is solving. Lead with a question or a hint.\n"
        "- Never use numbers, grades or percentages when talking about how they are doing.\n"
        "- Never compare them to another learner.\n"
        "- Short sentences. One idea per turn, then let them speak.\n"
        "- Answer in the same language the learner just spoke, unless the guidance below "
        "tells you to stay in English.\n"
        "How you correct — this is your job here:\n"
        "- When they say something a speaker would say differently, say their sentence back the "
        "natural way, briefly, and carry straight on with the conversation. Do not announce that "
        "it was a mistake and do not stop for a grammar lesson.\n"
        "  Example: they say 'He have two brother' — you say 'Oh, he has two brothers! What are their names?'\n"
        "- Correct ONE thing per turn — the one that most gets in the way of being understood. The rest can wait.\n"
        "- If they correct themselves, say 'yes!' and move on. Do not go back over it.\n"
        "- Do not stop for pronunciation unless you could not tell what they meant. Then just say the word "
        "correctly and continue.\n"
        "- Never say 'wrong', 'no' or 'mistake'.\n"
        "- If they were missing an English word and used their own language, give them the English word and carry on.\n"
        "- If the learner describes real distress, stop the practice, tell them you are there, "
        "and point them to a trusted adult.\n"
    ),
}

_TOPIC_LEAD = {
    "he": "הנושא שהתלמיד/ה עובד/ת עליו עכשיו: ",
    "ar": "الموضوع الذي يعمل عليه الطالب/ة الآن: ",
    "en": "What the learner is working on right now: ",
}

_INTEREST_LEAD = {
    "he": "דברים שמעניינים אותם, לשימוש כדוגמאות: ",
    "ar": "أمور تهمّهم، استعملها كأمثلة: ",
    "en": "Things they care about, to use as examples: ",
}


class RealtimeUnavailable(RuntimeError):
    """Realtime is not configured or refused the session."""


def is_configured() -> bool:
    return bool(_endpoint() and _key())


def _endpoint() -> str:
    return os.getenv("AZURE_OPENAI_REALTIME_ENDPOINT", "").strip().rstrip("/")


def _key() -> str:
    return os.getenv("AZURE_OPENAI_REALTIME_KEY", "").strip()


def _deployment() -> str:
    """Voice Live is fully managed, so this is a model name, not a deployment."""
    return os.getenv("AZURE_VOICE_LIVE_MODEL", DEFAULT_MODEL).strip()


def _api_version() -> str:
    return os.getenv("AZURE_VOICE_LIVE_API_VERSION", DEFAULT_API_VERSION).strip()


def socket_url() -> str:
    host = _endpoint().replace("https://", "").replace("wss://", "")
    return (
        f"wss://{host}/voice-live/realtime"
        f"?api-version={_api_version()}&model={_deployment()}"
    )


def socket_headers() -> dict[str, str]:
    return {"api-key": _key()}


def build_instructions(
    bundle: Optional[dict[str, Any]],
    *,
    language: str = "he",
    stage: Optional[str] = None,
    reference_text: Optional[str] = None,
) -> str:
    """The brief for one spoken session.

    Assembled from the SAME non-identifying Context bundle the text coach uses —
    no name, no school, no id — plus the ladder rung. Every free-text value is
    re-screened here because it is about to leave the building.
    """
    lang = language if language in _PERSONA else "he"
    parts = [_PERSONA[lang], english_ladder.policy_for(stage, lang)]

    bundle = bundle or {}
    topic = bundle.get("objective_title") or bundle.get("unit_title") or bundle.get("topic")
    if topic:
        parts.append(_TOPIC_LEAD[lang] + safety.strip_pii(str(topic))[0][:200])

    interests = [
        safety.strip_pii(str(value))[0][:40]
        for value in (bundle.get("interests") or [])[:4]
        if str(value or "").strip()
    ]
    if interests:
        parts.append(_INTEREST_LEAD[lang] + ", ".join(interests))

    if reference_text:
        parts.append(
            f"The learner is practising this sentence: \"{safety.strip_pii(reference_text)[0][:200]}\". "
            "Invite them to say it, listen, and then continue the conversation from it."
        )
    return "\n\n".join(part.strip() for part in parts if part and part.strip())


# Yuvi speaks with the female voices in the live call. Deliberately separate from
# the avatar-driven table the read-aloud button uses, which follows whichever
# robot the learner built for themselves.
SPOKEN_VARIANT = "girl"


def call_language(stage: Optional[str], language: str) -> str:
    """The one language a call is set up for — recognition and voice alike.

    It has to be one language, not a per-turn decision. Azure can only identify
    a spoken language from a candidate list using its multilingual VAD, and that
    VAD rejects `he-IL` outright; left to detect freely it hears Hebrew as
    German or Japanese. So the locale is pinned, and the ladder decides it: the
    top rung is an English-only conversation, every other rung is the learner's
    own language.
    """
    if stage == english_ladder.STAGE_ENGLISH:
        return "en"
    return language if language in ("he", "ar", "en") else "he"


def voice_for_call(language: str) -> tuple[str, str]:
    """The (locale, voice) a call runs on, from the table read-aloud shares."""
    from app.services.speech import voice_for

    return voice_for(language, SPOKEN_VARIANT)


def session_payload(instructions: str, locale: str, voice: str) -> dict[str, Any]:
    """The `session.update` that opens a call."""
    return {
        "modalities": ["text", "audio"],
        "instructions": instructions,
        "voice": {"type": "azure-standard", "name": voice},
        "input_audio_format": "pcm16",
        "output_audio_format": "pcm16",
        "input_audio_sampling_rate": SAMPLE_RATE,
        # Pinned, never auto-detected. Transcribing the learner's own audio is
        # also what lets us screen it for safety and keep a readable record
        # without ever storing the voice.
        "input_audio_transcription": {"model": "azure-speech", "language": locale},
        "input_audio_noise_reduction": {"type": "azure_deep_noise_suppression"},
        "input_audio_echo_cancellation": {"type": "server_echo_cancellation"},
        # Azure's own transcriber is only accepted alongside a semantic VAD.
        # The silence window is longer than a chat app would use: a 12-year-old
        # reaching for a word in a second language pauses, and being cut off
        # mid-sentence is the fastest way to make them stop trying.
        "turn_detection": {
            "type": "azure_semantic_vad",
            "threshold": 0.5,
            "prefix_padding_ms": 400,
            "silence_duration_ms": 900,
            "interrupt_response": True,
            "create_response": True,
        },
    }


def usage_from_response(payload: Any) -> Optional[dict[str, int]]:
    """Provider-reported realtime usage, keeping audio and text apart.

    Realtime prices audio tokens differently from text tokens, so collapsing
    them would make the cost unreconstructable. Missing fields stay missing —
    nothing here is derived.
    """
    if not isinstance(payload, dict):
        return None
    output_details = payload.get("output_token_details") or {}
    input_details = payload.get("input_token_details") or {}
    cached = (input_details.get("cached_tokens_details") or {}) if isinstance(input_details, dict) else {}

    def _int(value: Any) -> Optional[int]:
        return value if isinstance(value, int) and not isinstance(value, bool) else None

    usage = {
        "input_tokens": _int(payload.get("input_tokens")),
        "output_tokens": _int(payload.get("output_tokens")),
        "total_tokens": _int(payload.get("total_tokens")),
        "cached_input_tokens": _int(input_details.get("cached_tokens")) if isinstance(input_details, dict) else None,
        "audio_input_tokens": _int(input_details.get("audio_tokens")) if isinstance(input_details, dict) else None,
        "audio_output_tokens": _int(output_details.get("audio_tokens")) if isinstance(output_details, dict) else None,
    }
    if cached:
        usage["cached_input_tokens"] = usage["cached_input_tokens"] or _int(cached.get("audio_tokens"))
    return usage if any(value is not None for value in usage.values()) else None
