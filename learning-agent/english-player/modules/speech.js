/* Speech: read-aloud for any text on screen, and Azure pronunciation assessment
   for speaking practice. The SDK is vendored rather than loaded from a CDN — an
   embedding platform may block external scripts.

   Read-aloud goes through Azure neural voices — a language model speaking, not
   the robot the OS ships — with the voice picked to match the language of the
   text: English lines get an English voice, the Hebrew chrome a Hebrew one. The
   browser's own speechSynthesis stays as the fallback for a dropped token or a
   blocked socket, so the button always does SOMETHING. */

import { componentId, launch } from './context.js';

const synth = window.speechSynthesis;

/* One neural voice per language the content speaks. Arabic is Levantine — the
   dialect region of the learners this ships to — not Gulf or Egyptian. */
const VOICES = {
  en: 'en-US-JennyNeural',
  he: 'he-IL-HilaNeural',
  ar: 'ar-JO-SanaNeural',
};
const voiceFor = (locale) => VOICES[String(locale || 'en').slice(0, 2).toLowerCase()] || VOICES.en;

/* Synthesized clips, keyed by voice+rate+text. A learner replays the same line
   many times on purpose — that is the pedagogy — and it should neither wait for
   the network again nor bill again. Small and bounded: these are sentences. */
const clipCache = new Map();
const CLIP_CACHE_MAX = 48;

let player = null;       // the <audio> currently playing a neural clip
let request = 0;         // stale-synthesis guard: only the newest speak() plays

const escapeXml = (text) => String(text)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

async function synthesize(text, locale, rate) {
  const voice = voiceFor(locale);
  const key = `${voice}|${rate}|${text}`;
  if (clipCache.has(key)) return clipCache.get(key);
  const [SDK, { token, region }] = await Promise.all([loadSpeechSdk(), speechToken()]);
  const config = SDK.SpeechConfig.fromAuthorizationToken(token, region);
  config.speechSynthesisOutputFormat = SDK.SpeechSynthesisOutputFormat.Audio24Khz48KBitRateMonoMp3;
  // `null` audio config: the SDK hands the bytes back instead of playing them.
  // Playback through our own <audio> is what makes stop instant, replays free,
  // and the "which line is speaking" state honest.
  const synthesizer = new SDK.SpeechSynthesizer(config, null);
  const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${voice.slice(0, 5)}">`
    + `<voice name="${voice}"><prosody rate="${Math.round((rate - 1) * 100)}%">${escapeXml(text)}</prosody></voice></speak>`;
  const audio = await new Promise((resolve, reject) => {
    synthesizer.speakSsmlAsync(
      ssml,
      (result) => {
        synthesizer.close();
        if (result?.audioData?.byteLength) resolve(result.audioData);
        else reject(new Error(result?.errorDetails || 'no_audio'));
      },
      (error) => { synthesizer.close(); reject(new Error(String(error))); },
    );
  });
  const url = URL.createObjectURL(new Blob([audio], { type: 'audio/mpeg' }));
  clipCache.set(key, url);
  if (clipCache.size > CLIP_CACHE_MAX) {
    const oldest = clipCache.keys().next().value;
    URL.revokeObjectURL(clipCache.get(oldest));
    clipCache.delete(oldest);
  }
  return url;
}

function browserSpeak(text, { locale, rate, onEnd }) {
  if (!synth) { onEnd?.(); return; }
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = locale;
  utterance.rate = rate;
  utterance.onend = () => onEnd?.();
  utterance.onerror = () => onEnd?.();
  synth.speak(utterance);
}

export function speak(text, { locale = 'en-US', rate = 1, onEnd } = {}) {
  stopSpeaking();
  if (!text) { onEnd?.(); return; }
  const mine = ++request;
  synthesize(text, locale, rate).then((url) => {
    if (mine !== request) return;        // a newer line took over while this cooked
    player = new Audio(url);
    player.onended = () => { if (mine === request) player = null; onEnd?.(); };
    player.onerror = () => { if (mine === request) player = null; onEnd?.(); };
    return player.play().catch(() => { onEnd?.(); });
  }).catch(() => {
    // No token, no socket, or a blocked autoplay — the OS voice still reads.
    if (mine !== request) return;
    browserSpeak(text, { locale, rate, onEnd });
  });
}

export function stopSpeaking() {
  request += 1;
  if (player) { player.pause(); player = null; }
  if (synth?.speaking || synth?.pending) synth.cancel();
}

/* ── speaking (mic + pronunciation assessment) ──────────────────────────── */
let sdkPromise = null;

/** The Azure Speech browser SDK is vendored, not fetched from a CDN — this page
 *  is meant to run inside someone else's platform, where an external script may
 *  simply be blocked. Loaded on demand so a reading item never pays for it. */
function loadSpeechSdk() {
  if (window.SpeechSDK) return Promise.resolve(window.SpeechSDK);
  if (!sdkPromise) {
    sdkPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = '/content/player-assets/vendor/speech-sdk.js';
      script.onload = () => (window.SpeechSDK ? resolve(window.SpeechSDK) : reject(new Error('sdk')));
      script.onerror = () => reject(new Error('sdk'));
      document.head.append(script);
    }).catch((error) => { sdkPromise = null; throw error; });
  }
  return sdkPromise;
}

/* Azure tokens live ten minutes; minting one per spoken line would put a
   backend round-trip in front of every click. Cached just under the lifetime,
   shared by read-aloud and the pronunciation assessment alike. */
let tokenCache = { value: null, at: 0 };

async function speechToken() {
  if (tokenCache.value && Date.now() - tokenCache.at < 8 * 60_000) return tokenCache.value;
  const response = await fetch(`/content/player/${encodeURIComponent(componentId)}/speech-token`, {
    method: 'POST',
    headers: { Authorization: launch.auth },
  });
  if (!response.ok) throw new Error(String(response.status));
  tokenCache = { value: await response.json(), at: Date.now() };
  return tokenCache.value;
}

/** Record one utterance and score it against the reference sentence.
 *  The audio goes from this page straight to Azure — it never reaches our
 *  servers and is never stored. Only the score sheet comes back. */
export async function assessSpeech(referenceText) {
  const [SDK, { token, region }] = await Promise.all([loadSpeechSdk(), speechToken()]);
  const speechConfig = SDK.SpeechConfig.fromAuthorizationToken(token, region);
  speechConfig.speechRecognitionLanguage = 'en-US';
  const pa = new SDK.PronunciationAssessmentConfig(
    referenceText,
    SDK.PronunciationAssessmentGradingSystem.HundredMark,
    SDK.PronunciationAssessmentGranularity.Phoneme,
    true,
  );
  if (pa.enableProsodyAssessment) pa.enableProsodyAssessment = true;

  const recognizer = new SDK.SpeechRecognizer(speechConfig, SDK.AudioConfig.fromDefaultMicrophoneInput());
  pa.applyTo(recognizer);
  try {
    const result = await new Promise((resolve, reject) =>
      recognizer.recognizeOnceAsync(resolve, reject));
    if (result.reason !== SDK.ResultReason.RecognizedSpeech) throw new Error('no_speech');
    const scores = SDK.PronunciationAssessmentResult.fromResult(result);
    const detail = JSON.parse(result.properties.getProperty(
      SDK.PropertyId.SpeechServiceResponse_JsonResult) || '{}');
    const best = (detail.NBest || [])[0] || {};
    return {
      accuracyScore: scores.accuracyScore,
      fluencyScore: scores.fluencyScore,
      completenessScore: scores.completenessScore,
      prosodyScore: scores.prosodyScore,
      pronunciationScore: scores.pronunciationScore,
      // Azure reports duration in 100-nanosecond ticks; this is the billing unit.
      durationSeconds: result.duration ? result.duration / 10_000_000 : undefined,
      words: (best.Words || []).map((w) => ({
        word: w.Word,
        accuracyScore: (w.PronunciationAssessment || {}).AccuracyScore,
        errorType: (w.PronunciationAssessment || {}).ErrorType,
      })),
    };
  } finally {
    recognizer.close();
  }
}
