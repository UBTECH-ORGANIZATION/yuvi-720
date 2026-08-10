"""Live spoken practice with Yuvi (נספח 1 §2.4) — session minting only.

The audio path is deliberately NOT through us. This service asks Azure for a
short-lived client secret and hands it to the browser, which then opens a WebRTC
connection straight to Azure. Consequences that matter for the tender:

  * our subscription key never reaches the client;
  * the learner's voice never touches a Yuvilab server and is never stored;
  * what we keep is a redacted transcript and the provider's token counts.

What this module DOES own is the brief: who Yuvi is in this conversation, what
the learner is working on, and — the part the tender is specific about — which
rung of the L1→English ladder they are on. That comes from
`services/english_ladder.py`, computed from real evidence, never chosen by a model.
"""

from __future__ import annotations

import os
from typing import Any, Optional

import httpx

from app.agents import safety
from app.services import english_ladder

DEFAULT_API_VERSION = "2025-04-01-preview"
DEFAULT_VOICE = "alloy"
PROVIDER = "azure_openai"
GATEWAY = "azure_openai_realtime"

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
    return bool(_endpoint() and _key() and _deployment())


def _endpoint() -> str:
    return os.getenv("AZURE_OPENAI_REALTIME_ENDPOINT", "").strip().rstrip("/")


def _key() -> str:
    return os.getenv("AZURE_OPENAI_REALTIME_KEY", "").strip()


def _deployment() -> str:
    return os.getenv("AZURE_OPENAI_REALTIME_DEPLOYMENT", "").strip()


def _api_version() -> str:
    return os.getenv("AZURE_OPENAI_REALTIME_API_VERSION", DEFAULT_API_VERSION).strip()


def _webrtc_url() -> str:
    return os.getenv("AZURE_OPENAI_REALTIME_WEBRTC_URL", "").strip()


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


async def create_session(
    *,
    instructions: str,
    voice: str = DEFAULT_VOICE,
    language: str = "he",
) -> dict[str, Any]:
    """Mint an ephemeral realtime session. Returns nothing secret of ours."""
    if not is_configured():
        raise RealtimeUnavailable("realtime_not_configured")

    body: dict[str, Any] = {
        "model": _deployment(),
        "voice": voice,
        "instructions": instructions,
        "modalities": ["text", "audio"],
        # Transcribing the learner's own audio is what lets us screen it for
        # safety and keep a readable record without ever storing the voice.
        "input_audio_transcription": {"model": "whisper-1"},
        # The learner leads. Server-side turn detection keeps the conversation
        # feeling like a conversation instead of a walkie-talkie.
        "turn_detection": {"type": "server_vad", "threshold": 0.5, "silence_duration_ms": 620},
    }
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.post(
                f"{_endpoint()}/openai/realtimeapi/sessions",
                params={"api-version": _api_version()},
                headers={"api-key": _key(), "Content-Type": "application/json"},
                json=body,
            )
        if response.status_code >= 400:
            # Never surface the provider's body; it can echo the request.
            raise RealtimeUnavailable("realtime_session_rejected")
        payload = response.json()
    except httpx.HTTPError as exc:
        raise RealtimeUnavailable("realtime_unavailable") from exc

    secret = (payload.get("client_secret") or {}).get("value")
    if not secret:
        raise RealtimeUnavailable("realtime_session_rejected")

    return {
        "clientSecret": secret,
        "expiresAt": (payload.get("client_secret") or {}).get("expires_at") or payload.get("expires_at"),
        "sessionId": payload.get("id"),
        "model": _deployment(),
        "webrtcUrl": _webrtc_url(),
        "language": language,
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
