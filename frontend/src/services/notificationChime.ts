/* The bell's sound: two soft notes, synthesized.

   The first bell sound in the app, rung when a game finishes building while the
   learner is still on the page. Like `celebrationAudio.ts`, it ships no media
   file — a sine pair with a short envelope, well under a second, quiet enough
   to sit under a classroom. It is a nudge, not an alarm.

   Silent when the learner asked for less motion (the same preference the
   studio honours), when they muted it, or when the browser has no audio at
   all. It never throws: a bell that crashes the notification handler would
   cost the notification itself. */

const MUTE_KEY = 'yuvilab:chime'
const MUTED = 'off'

/** Total length of the chime, both notes and their tails. */
const CHIME_SECONDS = 0.55

export function isChimeMuted(): boolean {
  try {
    return window.localStorage.getItem(MUTE_KEY) === MUTED
  } catch {
    return false
  }
}

export function setChimeMuted(muted: boolean): void {
  try {
    if (muted) window.localStorage.setItem(MUTE_KEY, MUTED)
    else window.localStorage.removeItem(MUTE_KEY)
  } catch {
    /* private mode or blocked storage — the chime simply stays on */
  }
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
  } catch {
    return false
  }
}

function note(context: AudioContext, master: GainNode, frequency: number, at: number, length: number, peak: number) {
  const voice = context.createOscillator()
  voice.type = 'sine'
  voice.frequency.value = frequency

  // A faint octave adds a little bell to a plain sine without any edge.
  const shimmer = context.createOscillator()
  shimmer.type = 'sine'
  shimmer.frequency.value = frequency * 2

  const gain = context.createGain()
  gain.gain.setValueAtTime(0.0001, at)
  gain.gain.exponentialRampToValueAtTime(peak, at + 0.018)
  gain.gain.exponentialRampToValueAtTime(0.0001, at + length)

  const shimmerGain = context.createGain()
  shimmerGain.gain.value = 0.18

  voice.connect(gain)
  shimmer.connect(shimmerGain).connect(gain)
  gain.connect(master)
  voice.start(at)
  shimmer.start(at)
  voice.stop(at + length + 0.02)
  shimmer.stop(at + length + 0.02)
}

/** Rings the chime once. Safe to call from any handler; never throws. */
export function playNotificationChime(): void {
  if (typeof window === 'undefined' || !('AudioContext' in window)) return
  if (isChimeMuted() || prefersReducedMotion()) return

  let context: AudioContext | null = null
  try {
    context = new AudioContext()
    // Autoplay policy: a context created before any gesture stays suspended and
    // the notes are simply not heard. Resume, never insist.
    void context.resume?.()
    const now = context.currentTime

    const master = context.createGain()
    master.gain.value = 0.5
    master.connect(context.destination)

    // A rising pair — E5 then A5 — the shape of "something arrived for you".
    note(context, master, 659.25, now, 0.30, 0.22)
    note(context, master, 880.0, now + 0.16, 0.38, 0.2)

    const handle = context
    window.setTimeout(() => { void handle.close().catch(() => undefined) }, CHIME_SECONDS * 1000 + 120)
  } catch {
    void context?.close().catch(() => undefined)
  }
}
