/* Math-aware read-aloud for completed Yuvi messages.
   Azure Speech is preferred; Web Speech is the no-credentials fallback. */

import { CURRENT_LEARNER_ID } from './xapi'
import type { YubiVariant } from '../features/yubi-studio/yubiDesign'

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

let generation = 0
let activeController: AbortController | null = null
let activeAudio: HTMLAudioElement | null = null
let activeUrl: string | null = null
let activeListener: StateListener | null = null

function languageKey(language: string): SpeechLanguage {
  return language === 'ar' || language === 'en' ? language : 'he'
}

/** Text-only normalization used by browser speech when Azure is unavailable. */
export function normalizeMathForSpeech(text: string, language: string): string {
  const terms = SPEECH_TERMS[languageKey(language)]
  let spoken = (text || '')
    .replace(/```[^\n]*\n?[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
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
    .replace(/[{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function cleanUpAudio() {
  activeAudio?.pause()
  activeAudio = null
  if (activeUrl) URL.revokeObjectURL(activeUrl)
  activeUrl = null
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

function waitForAudio(audio: HTMLAudioElement): Promise<void> {
  return new Promise((resolve, reject) => {
    audio.addEventListener('ended', () => resolve(), { once: true })
    audio.addEventListener('error', () => reject(new Error('audio playback failed')), { once: true })
  })
}

function speakInBrowser(text: string, language: string, avatarVariant: YubiVariant, run: number): Promise<void> {
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

export async function playCoachSpeech(
  text: string,
  language: string,
  avatarVariant: YubiVariant,
  onState: StateListener,
  conversationId: string = 'default',
  exchangeId?: string,
): Promise<void> {
  stopCoachSpeech()
  const run = ++generation
  activeListener = onState
  activeController = new AbortController()
  onState('preparing')

  try {
    const response = await fetch('/api/agent/coach/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        language,
        avatar_variant: avatarVariant,
        learner_id: CURRENT_LEARNER_ID,
        conversation_id: conversationId,
        exchange_id: exchangeId,
      }),
      signal: activeController.signal,
    })
    if (!response.ok) throw new Error('azure speech unavailable')
    const blob = await response.blob()
    if (run !== generation) return
    activeUrl = URL.createObjectURL(blob)
    activeAudio = new Audio(activeUrl)
    onState('playing')
    await activeAudio.play()
    await waitForAudio(activeAudio)
  } catch (error) {
    if (run !== generation || (error instanceof DOMException && error.name === 'AbortError')) return
    onState('playing')
    await speakInBrowser(text, language, avatarVariant, run)
  } finally {
    if (run === generation) {
      cleanUpAudio()
      activeController = null
      activeListener = null
      onState('idle')
    }
  }
}
