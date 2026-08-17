"""Throwaway A/B: transcription models vs Azure Speech continuous LID on code-switched audio."""

from __future__ import annotations

import asyncio
import io
import json
import os
import sys
import threading
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import httpx
from dotenv import dotenv_values

CFG = dotenv_values(Path(__file__).resolve().parents[1] / ".env")
for k, v in CFG.items():
    if v is not None:
        os.environ.setdefault(k, v)

OUT = Path(__file__).resolve().parents[1] / "artifacts" / "codeswitch"
OUT.mkdir(parents=True, exist_ok=True)

DEPLOYMENTS = ("gpt-4o-mini-transcribe", "transcribe-full")

CASES = [
    ("mixed_lesson", "he-IL-HilaNeural", "he-IL", "איך אומרים נכון I play או I plays?"),
    ("mixed_word", "he-IL-HilaNeural", "he-IL", "אני אוהב את המילה beautiful, היא נשמעת יפה."),
    ("pure_he", "he-IL-HilaNeural", "he-IL", "בוקר טוב, מה נלמד היום בשיעור?"),
    ("pure_en", "en-US-JennyNeural", "en-US", "Good morning, what are we learning today?"),
    ("en_in_he_tail", "he-IL-HilaNeural", "he-IL", "תרגמי בבקשה את המשפט My family is big."),
]


def synth(name: str, voice: str, locale: str, text: str) -> Path:
    path = OUT / f"{name}.wav"
    if path.exists():
        return path
    key = os.environ["AZURE_SPEECH_KEY"]
    region = os.environ["AZURE_SPEECH_REGION"]
    ssml = (
        f"<speak version='1.0' xml:lang='{locale}'>"
        f"<voice name='{voice}'>{text}</voice></speak>"
    )
    r = httpx.post(
        f"https://{region}.tts.speech.microsoft.com/cognitiveservices/v1",
        headers={
            "Ocp-Apim-Subscription-Key": key,
            "Content-Type": "application/ssml+xml",
            "X-Microsoft-OutputFormat": "riff-16khz-16bit-mono-pcm",
        },
        content=ssml.encode("utf-8"),
        timeout=60,
    )
    r.raise_for_status()
    path.write_bytes(r.content)
    return path


PROMPT = (
    "The speaker is an Israeli student in an English lesson. They mix Hebrew and "
    "English in one sentence. Write Hebrew words in Hebrew script and English words "
    "in Latin script. Never transliterate English words into Hebrew letters."
)


def transcribe(
    deployment: str, path: Path, prompt: str | None = None
) -> tuple[str, float]:
    endpoint = os.environ["AZURE_OPENAI_REALTIME_ENDPOINT"].rstrip("/")
    key = os.environ["AZURE_OPENAI_REALTIME_KEY"]
    url = f"{endpoint}/openai/deployments/{deployment}/audio/transcriptions?api-version=2025-03-01-preview"
    data = {"response_format": "json"}
    if prompt:
        data["prompt"] = prompt
    started = time.perf_counter()
    r = httpx.post(
        url,
        headers={"api-key": key},
        files={"file": (path.name, path.read_bytes(), "audio/wav")},
        data=data,
        timeout=120,
    )
    elapsed = time.perf_counter() - started
    if r.status_code != 200:
        return f"HTTP {r.status_code}: {r.text[:160]}", elapsed
    return r.json().get("text", ""), elapsed


def wait_ready(deployments: tuple[str, ...], probe: Path, budget: int = 240) -> None:
    """New deployments 404 until they propagate; gate once instead of retrying per call."""
    deadline = time.time() + budget
    pending = list(deployments)
    while pending and time.time() < deadline:
        for dep in list(pending):
            out, _el = transcribe(dep, probe)
            if not out.startswith("HTTP 404"):
                print(f"  ready: {dep}", flush=True)
                pending.remove(dep)
        if pending:
            print(f"  waiting for {', '.join(pending)} ...", flush=True)
            time.sleep(15)
    for dep in pending:
        print(f"  STILL 404 after {budget}s: {dep}", flush=True)


def speech_lid(path: Path) -> tuple[str, str, float]:
    import azure.cognitiveservices.speech as sdk

    cfg = sdk.SpeechConfig(
        subscription=os.environ["AZURE_SPEECH_KEY"],
        region=os.environ["AZURE_SPEECH_REGION"],
    )
    cfg.set_property(sdk.PropertyId.SpeechServiceConnection_LanguageIdMode, "Continuous")
    auto = sdk.AutoDetectSourceLanguageConfig(languages=["he-IL", "en-US"])
    audio = sdk.audio.AudioConfig(filename=str(path))
    rec = sdk.SpeechRecognizer(
        speech_config=cfg, auto_detect_source_language_config=auto, audio_config=audio
    )

    # Continuous LID is rejected in the single-shot "Interactive" scenario.
    parts: list[tuple[str, str]] = []
    done = threading.Event()

    def on_recognized(evt) -> None:
        if evt.result.reason == sdk.ResultReason.RecognizedSpeech and evt.result.text:
            lang = sdk.AutoDetectSourceLanguageResult(evt.result).language or "?"
            parts.append((lang, evt.result.text))

    rec.recognized.connect(on_recognized)
    rec.session_stopped.connect(lambda _evt: done.set())
    rec.canceled.connect(lambda _evt: done.set())

    started = time.perf_counter()
    rec.start_continuous_recognition()
    done.wait(timeout=15)
    rec.stop_continuous_recognition()
    elapsed = time.perf_counter() - started

    text = " ".join(t for _lang, t in parts)
    detected = "+".join(dict.fromkeys(lang for lang, _t in parts)) or "?"
    return text, detected, elapsed


def main() -> None:
    rows = []
    cases = list(CASES)
    clips = {name: synth(name, voice, locale, text) for name, voice, locale, text in cases}

    # A real recording, if one was dropped in, is the only fixture that settles short fragments.
    real = OUT / "real_mixed.wav"
    if real.exists():
        cases.append(("real_mixed", "-", "-", "איך אומרים נכון I play או I plays?"))
        clips["real_mixed"] = real
        print("using real recording: real_mixed.wav", flush=True)

    print("checking deployment readiness", flush=True)
    wait_ready(DEPLOYMENTS, clips["pure_he"])

    for name, _voice, _locale, text in cases:
        path = clips[name]
        print(f"\n=== {name}\n  said     : {text}", flush=True)
        st, sl, se = speech_lid(path)
        print(f"  speech-lid [{sl}] {se:5.2f}s : {st}", flush=True)
        row = {"case": name, "reference": text, "speech_lid": st, "detected": sl}
        for dep in DEPLOYMENTS:
            for label, prompt in (("bare", None), ("prompted", PROMPT)):
                out, el = transcribe(dep, path, prompt)
                print(f"  {dep:24s} {label:9s} {el:5.2f}s : {out}", flush=True)
                row[f"{dep}/{label}"] = out
        rows.append(row)
    (OUT / "results.json").write_text(
        json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8"
    )


if __name__ == "__main__":
    main()
