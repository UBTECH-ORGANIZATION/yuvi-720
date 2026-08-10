"""End-to-end check of the spoken-practice surface (נספח 1 §2.4).

Drives the real HTTP routes against a running backend: the lomda's launch-token
path, the companion's session path, and a full pronunciation round trip using
audio synthesised by the same Speech resource the learner's browser would use.

    .venv/bin/python scripts/check_speaking.py [base_url]
"""

from __future__ import annotations

import asyncio


import os
import sys
import urllib.parse
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import server  # noqa: F401,E402  (loads .env)
from app.services import native_content, realtime_voice  # noqa: E402
from app.services.events import mint_launch  # noqa: E402

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8722"
LEARNER = "en-demo-check"
COMPONENT = "ENG.G7.FAMILY.SPEAK-01"
SENTENCE = "My brother is sixteen and he plays football."

_passed = True


def ok(label: str, passed: bool, detail: str = "") -> None:
    global _passed
    _passed = _passed and passed
    print(f"  {'PASS' if passed else 'FAIL'}  {label}{f' — {detail}' if detail else ''}")


async def _launch_auth() -> str:
    unit, component = await native_content.resolve_component(COMPONENT)
    launch = mint_launch(
        LEARNER, objective_id=unit["objective_id"], component_id=component["id"],
        unit_id=unit["id"], subject="english", source=native_content.SOURCE,
    )
    return launch["slxapi"]["auth"]


async def _learner_utterance(key: str, region: str) -> bytes:
    """Stand in for the microphone with speech from the same service."""
    ssml = (
        f"<speak version='1.0' xml:lang='en-US'>"
        f"<voice name='en-US-JennyNeural'>{SENTENCE}</voice></speak>"
    )
    async with httpx.AsyncClient(timeout=40) as client:
        response = await client.post(
            f"https://{region}.tts.speech.microsoft.com/cognitiveservices/v1",
            headers={
                "Ocp-Apim-Subscription-Key": key,
                "Content-Type": "application/ssml+xml",
                "X-Microsoft-OutputFormat": "riff-16khz-16bit-mono-pcm",
            },
            content=ssml.encode(),
        )
    return response.content


async def _assess(token: str, region: str, wav: bytes) -> dict:
    """Score the utterance exactly as the browser SDK does.

    The REST surface returns phonemes but null scores, so this uses the Speech
    SDK — the same component the player loads in the page — which is what makes
    this check a real stand-in for a learner speaking.
    """
    import tempfile

    import azure.cognitiveservices.speech as sdk

    path = tempfile.mktemp(suffix=".wav")
    Path(path).write_bytes(wav)
    try:
        config = sdk.SpeechConfig(auth_token=token, region=region)
        assessment = sdk.PronunciationAssessmentConfig(
            reference_text=SENTENCE,
            grading_system=sdk.PronunciationAssessmentGradingSystem.HundredMark,
            granularity=sdk.PronunciationAssessmentGranularity.Phoneme,
            enable_miscue=True,
        )
        assessment.enable_prosody_assessment()
        recognizer = sdk.SpeechRecognizer(
            speech_config=config, language="en-US",
            audio_config=sdk.audio.AudioConfig(filename=path),
        )
        assessment.apply_to(recognizer)
        outcome = recognizer.recognize_once()
        if outcome.reason != sdk.ResultReason.RecognizedSpeech:
            return {"words": []}
        scores = sdk.PronunciationAssessmentResult(outcome)
        return {
            "accuracyScore": scores.accuracy_score,
            "fluencyScore": scores.fluency_score,
            "completenessScore": scores.completeness_score,
            "prosodyScore": scores.prosody_score,
            "pronunciationScore": scores.pronunciation_score,
            "durationSeconds": (outcome.duration or 0) / 10_000_000 or None,
            "words": [
                {"word": w.word, "accuracyScore": w.accuracy_score, "errorType": w.error_type}
                for w in scores.words
            ],
        }
    finally:
        Path(path).unlink(missing_ok=True)


async def main() -> int:
    print("\nSpoken practice\n")
    auth = await _launch_auth()

    async with httpx.AsyncClient(timeout=60, base_url=BASE) as client:
        # 1. the lomda authenticates with its launch token, not a cookie
        unauth = await client.post(f"/content/player/{COMPONENT}/speech-token")
        ok("player speech token is refused without a launch", unauth.status_code == 401)

        response = await client.post(
            f"/content/player/{COMPONENT}/speech-token", headers={"Authorization": auth}
        )
        ok("player mints a Speech token", response.status_code == 200,
           f"region={response.json().get('region')}, token {len(response.json().get('token',''))} chars")
        if response.status_code != 200:
            return 1
        speech = response.json()

        # 2. a real utterance, scored the way the browser scores it
        wav = await _learner_utterance(os.environ["AZURE_SPEECH_KEY"], speech["region"])
        ok("learner utterance captured", len(wav) > 10_000, f"{len(wav)} bytes of audio")
        assessment = await _assess(speech["token"], speech["region"], wav)
        ok("Azure returned per-word pronunciation", bool(assessment["words"]),
           ", ".join(f"{w['word']}:{w['accuracyScore']}" for w in assessment["words"][:4]))

        # 3. the route turns scores into words
        graded = await client.post(
            f"/content/player/{COMPONENT}/pronunciation",
            headers={"Authorization": auth},
            json={
                "assessment": assessment, "language": "he", "referenceText": SENTENCE,
                "itemId": f"{COMPONENT}-02", "questionId": "speaking",
            },
        )
        ok("pronunciation is graded", graded.status_code == 200, graded.text[:80])
        if graded.status_code != 200:
            return 1
        feedback = graded.json()["feedback"]
        spoken = feedback["headline"] + " ".join(feedback["notes"]) + feedback["nextStep"]
        ok("feedback reaches the learner as words", len(spoken) > 20, feedback["headline"])
        ok("no number is ever shown to the learner", not any(ch.isdigit() for ch in spoken))
        ok("the ladder moved", bool(graded.json().get("stage")), graded.json().get("stage"))

        # 4. companion surfaces are session-only
        for path in ("/api/speech/token", "/api/agent/voice/session",
                     "/api/agent/voice/usage", "/api/agent/voice/turn"):
            status = (await client.post(path, json={})).status_code
            ok(f"{path} requires a signed-in learner", status == 401, f"got {status}")

    # 5. realtime is briefed with the learner's rung, not a generic prompt
    ok("realtime is configured", realtime_voice.is_configured())
    brief = realtime_voice.build_instructions(
        {"interests": ["football"], "objective_title": "Listening: Meet the families"},
        language="he", stage="l1_mediated",
    )
    ok("brief carries the L1 rung", "בעברית" in brief and "football" in brief, f"{len(brief)} chars")
    english = realtime_voice.build_instructions({}, language="he", stage="english_only")
    ok("brief changes with the rung", "רק אנגלית" in english)

    print(f"\n{'ALL CHECKS PASSED' if _passed else 'SOME CHECKS FAILED'}\n")
    return 0 if _passed else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
