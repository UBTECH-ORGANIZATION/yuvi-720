/* Math-aware read-aloud for completed Yuvi messages.
   Azure Speech is preferred; Web Speech is the no-credentials fallback. */

import type { YuviVariant } from '../features/Yuvi-studio/YuviDesign'
import { decodeBase64, PcmPlayer, SAMPLE_RATE } from './pcmAudio'

export type SpeechState = 'preparing' | 'playing' | 'idle'

type StateListener = (state: SpeechState) => void

const SPEECH_TERMS = {
  he: {
    equals: 'שווה', plus: 'ועוד', minus: 'פחות', times: 'כפול', divided: 'חלקי',
    sqrt: 'שורש של', squared: 'בריבוע', cubed: 'בחזקת שלוש', power: 'בחזקת',
    theta: 'תטא', alpha: 'אלפא', beta: 'בטא', pi: 'פאי',
  },
  ar: {
    equals: 'يساوي', plus: 'زائد', minus: 'ناقص', times: 'ضرب', divided: 'على',
    sqrt: 'الجذر التربيعي لـ', squared: 'تربيع', cubed: 'تكعيب', power: 'أس',
    theta: 'ثيتا', alpha: 'ألفا', beta: 'بيتا', pi: 'باي',
  },
  en: {
    equals: 'equals', plus: 'plus', minus: 'minus', times: 'times', divided: 'divided by',
    sqrt: 'the square root of', squared: 'squared', cubed: 'cubed', power: 'to the power of',
    theta: 'theta', alpha: 'alpha', beta: 'beta', pi: 'pi',
  },
} as const

type SpeechLanguage = keyof typeof SPEECH_TERMS

/** Yuvi speaks with the female voices — he-IL-HilaNeural and en-US-JennyNeural.
 *  Deliberately independent of the robot the learner built in the studio: the
 *  avatar picks how Yuvi looks, not how he sounds. */
const SPOKEN_VARIANT: YuviVariant = 'girl'

let generation = 0
let activeController: AbortController | null = null
let activeListener: StateListener | null = null
let activeContext: AudioContext | null = null
let activePlayer: PcmPlayer | null = null

function languageKey(language: string): SpeechLanguage {
  return language === 'ar' || language === 'en' ? language : 'he'
}

/** Text-only normalization used by browser speech when Azure is unavailable.
 *  Kept in sync with `normalize_math_for_speech` in backend/app/services/speech.py. */
export function normalizeMathForSpeech(text: string, language: string): string {
  const terms = SPEECH_TERMS[languageKey(language)]
  let spoken = (text || '')
    .replace(/```[^\n]*\n?[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/^[ \t]*(?:[-*+•]|\d+[.)])[ \t]+/gm, '')
    .replace(/\\[\[(]([\s\S]*?)\\[\])]/g, ' $1 ')
    .replace(/\$\$/g, ' ')
    .replace(/\$/g, ' ')

  for (let index = 0; index < 3; index += 1) {
    spoken = spoken.replace(/\\frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}/g, ` $1 ${terms.divided} $2 `)
  }
  spoken = spoken.replace(/\\sqrt\s*\{([^{}]+)\}/g, ` ${terms.sqrt} $1 `)
  const power = (_match: string, base: string, exponent: string) => {
    if (exponent === '2') return ` ${base} ${terms.squared} `
    if (exponent === '3') return ` ${base} ${terms.cubed} `
    return ` ${base} ${terms.power} ${exponent} `
  }
  spoken = spoken
    .replace(/([\w\d)]+)\s*\^\s*\{([^{}]+)\}/g, power)
    .replace(/([\w\d)]+)\s*\^\s*([\w\d]+)/g, power)

  const replacements: Array<[RegExp, string]> = [
    [/\\theta/g, terms.theta], [/\\alpha/g, terms.alpha], [/\\beta/g, terms.beta],
    [/\\pi/g, terms.pi], [/\\(?:times|cdot)/g, terms.times], [/\\div/g, terms.divided],
    [/\\(?:leq|le)|≤/g, languageKey(language) === 'en' ? 'is less than or equal to' : languageKey(language) === 'ar' ? 'أصغر من أو يساوي' : 'קטן או שווה ל'],
    [/\\(?:geq|ge)|≥/g, languageKey(language) === 'en' ? 'is greater than or equal to' : languageKey(language) === 'ar' ? 'أكبر من أو يساوي' : 'גדול או שווה ל'],
    [/\\(?:neq|ne)|≠/g, languageKey(language) === 'en' ? 'is not equal to' : languageKey(language) === 'ar' ? 'لا يساوي' : 'לא שווה ל'],
    [/×/g, terms.times], [/÷/g, terms.divided], [/=/g, terms.equals], [/\+/g, terms.plus], [/−/g, terms.minus],
  ]
  for (const [pattern, replacement] of replacements) spoken = spoken.replace(pattern, ` ${replacement} `)
  return spoken
    .replace(/(?<=\s)-(?=\s|\d)/g, ` ${terms.minus} `)
    .replace(/\*\*|__|`/g, '')
    .replace(/\\(?:left|right|mathrm|text|operatorname)\b/g, ' ')
    .replace(/(?<=\d)\s*\/\s*(?=\d)/g, ` ${terms.divided} `)
    .replace(/[/\\@#~|<>^"'‘’“”״׳`*_]/g, '')
    .replace(/[{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function cleanUpAudio() {
  activePlayer?.stop()
  activePlayer = null
  void activeContext?.close().catch(() => {})
  activeContext = null
}

export function stopCoachSpeech() {
  generation += 1
  activeController?.abort()
  activeController = null
  cleanUpAudio()
  window.speechSynthesis?.cancel()
  activeListener?.('idle')
  activeListener = null
}

function speakInBrowser(text: string, language: string, avatarVariant: YuviVariant, run: number): Promise<void> {
  if (!('speechSynthesis' in window)) throw new Error('speech synthesis unavailable')
  const utterance = new SpeechSynthesisUtterance(normalizeMathForSpeech(text, language))
  utterance.lang = languageKey(language) === 'he' ? 'he-IL' : languageKey(language) === 'ar' ? 'ar-SA' : 'en-US'
  const preferredNames = avatarVariant === 'girl'
    ? ['hila', 'zariyah', 'jenny', 'samantha', 'female']
    : ['avri', 'hamed', 'guy', 'david', 'alex', 'male']
  const localePrefix = utterance.lang.slice(0, 2).toLowerCase()
  const localeVoices = window.speechSynthesis.getVoices()
    .filter((voice) => voice.lang.toLowerCase().startsWith(localePrefix))
  utterance.voice = preferredNames
    .map((name) => localeVoices.find((voice) => voice.name.toLowerCase().includes(name)))
    .find(Boolean) || localeVoices[0] || null
  utterance.rate = 0.94
  utterance.pitch = 1
  return new Promise((resolve, reject) => {
    utterance.onend = () => resolve()
    utterance.onerror = (event) => event.error === 'canceled' ? resolve() : reject(new Error(event.error))
    if (run !== generation) return resolve()
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(utterance)
  })
}

type SpeechSegment = { index: number; language: string; audio: string }

/** Read the segment stream, handing each one over the moment it arrives. */
async function readSegments(
  body: unknown,
  signal: AbortSignal,
  onSegment: (segment: SpeechSegment) => void,
): Promise<void> {
  const response = await fetch('/api/agent/coach/tts/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  if (!response.ok || !response.body) throw new Error('azure speech unavailable')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) return
    buffer += decoder.decode(value, { stream: true })
    let split = buffer.indexOf('\n\n')
    while (split !== -1) {
      const line = buffer.slice(0, split).split('\n').find((l) => l.startsWith('data: '))
      buffer = buffer.slice(split + 2)
      if (line) {
        const payload = JSON.parse(line.slice(6))
        if (payload.done) return
        onSegment(payload as SpeechSegment)
      }
      split = buffer.indexOf('\n\n')
    }
  }
}

export type CoachSpeechSession = {
  /** Speak this text once everything queued before it has been spoken. */
  push: (text: string) => void
  /** Resolves when the last queued audio has finished playing. */
  end: () => Promise<void>
}

/**
 * Speak a reply while it is still being written.
 *
 * Waiting for the whole reply before synthesizing anything put the language
 * model — about four seconds of it — directly into the learner's wait. Handing
 * over one sentence at a time means Yuvi starts talking while he is still
 * deciding what to say next.
 */
export function beginCoachSpeech(
  language: string,
  onState: StateListener,
  conversationId: string = 'default',
  exchangeId?: string,
): CoachSpeechSession {
  stopCoachSpeech()
  const run = ++generation
  activeListener = onState
  const controller = new AbortController()
  activeController = controller
  onState('preparing')

  const context = new AudioContext({ sampleRate: SAMPLE_RATE })
  activeContext = context
  const player = new PcmPlayer(context)
  activePlayer = player
  let spoke = false
  // Sentences are synthesized one after another so they cannot arrive out of order.
  let queue: Promise<void> = context.resume().catch(() => {})

  const push = (text: string) => {
    const trimmed = (text || '').trim()
    if (!trimmed) return
    queue = queue
      .then(async () => {
        if (run !== generation) return
        await readSegments(
          {
            text: trimmed,
            language,
            avatar_variant: SPOKEN_VARIANT,
            conversation_id: conversationId,
            exchange_id: exchangeId,
          },
          controller.signal,
          (segment) => {
            if (run !== generation) return
            if (!spoke) {
              spoke = true
              onState('playing')
            }
            player.push(decodeBase64(segment.audio))
          },
        )
      })
      // One failed sentence must not silence the rest of the reply.
      .catch(() => {})
  }

  const end = async () => {
    await queue
    if (run !== generation) return
    await new Promise((resolve) => setTimeout(resolve, player.remainingSeconds * 1000))
    if (run !== generation) return
    cleanUpAudio()
    activeController = null
    activeListener = null
    onState('idle')
  }

  return { push, end }
}

export async function playCoachSpeech(
  text: string,
  language: string,
  onState: StateListener,
  conversationId: string = 'default',
  exchangeId?: string,
): Promise<void> {
  stopCoachSpeech()
  const run = ++generation
  activeListener = onState
  activeController = new AbortController()
  onState('preparing')

  let spoke = false
  try {
    const context = new AudioContext({ sampleRate: SAMPLE_RATE })
    activeContext = context
    await context.resume()
    const player = new PcmPlayer(context)
    activePlayer = player

    await readSegments(
      {
        text,
        language,
        avatar_variant: SPOKEN_VARIANT,
        conversation_id: conversationId,
        exchange_id: exchangeId,
      },
      activeController.signal,
      (segment) => {
        if (run !== generation) return
        if (!spoke) {
          spoke = true
          onState('playing')
        }
        player.push(decodeBase64(segment.audio))
      },
    )
    if (run !== generation) return
    // The stream is finished but the tail of it is still on the audio clock.
    await new Promise((resolve) => setTimeout(resolve, player.remainingSeconds * 1000))
  } catch (error) {
    if (run !== generation || (error instanceof DOMException && error.name === 'AbortError')) return
    if (!spoke) {
      onState('playing')
      await speakInBrowser(text, language, SPOKEN_VARIANT, run)
    }
  } finally {
    if (run === generation) {
      cleanUpAudio()
      activeController = null
      activeListener = null
      onState('idle')
    }
  }
}
