const PROGRESSION_NOTES = [392, 493.88, 587.33, 783.99, 987.77]

/** Plays a short synthesized ascent without loading or tracking external media. */
export function playProgressionAudio(durationMs: number): () => void {
  if (typeof window === 'undefined' || !('AudioContext' in window)) return () => undefined

  let context: AudioContext | null = null
  let closeTimer: number | null = null
  try {
    context = new AudioContext()
    const now = context.currentTime
    const durationSeconds = durationMs / 1000

    const master = context.createGain()
    master.gain.setValueAtTime(.0001, now)
    master.gain.exponentialRampToValueAtTime(.14, now + .18)
    master.gain.setValueAtTime(.14, now + Math.max(.2, durationSeconds - .6))
    master.gain.exponentialRampToValueAtTime(.0001, now + durationSeconds)
    master.connect(context.destination)

    const ascent = context.createOscillator()
    const ascentGain = context.createGain()
    ascent.type = 'sine'
    ascent.frequency.setValueAtTime(96, now)
    ascent.frequency.exponentialRampToValueAtTime(248, now + durationSeconds * .82)
    ascentGain.gain.setValueAtTime(.0001, now)
    ascentGain.gain.exponentialRampToValueAtTime(.055, now + .45)
    ascentGain.gain.exponentialRampToValueAtTime(.0001, now + durationSeconds)
    ascent.connect(ascentGain).connect(master)
    ascent.start(now)
    ascent.stop(now + durationSeconds)

    PROGRESSION_NOTES.forEach((frequency, index) => {
      const startsAt = now + .8 + index * Math.max(.72, (durationSeconds - 1.5) / PROGRESSION_NOTES.length)
      const oscillator = context?.createOscillator()
      const gain = context?.createGain()
      if (!oscillator || !gain || !context) return
      oscillator.type = index === PROGRESSION_NOTES.length - 1 ? 'sine' : 'triangle'
      oscillator.frequency.setValueAtTime(frequency, startsAt)
      gain.gain.setValueAtTime(.0001, startsAt)
      gain.gain.exponentialRampToValueAtTime(.18, startsAt + .05)
      gain.gain.exponentialRampToValueAtTime(.0001, startsAt + .58)
      oscillator.connect(gain).connect(master)
      oscillator.start(startsAt)
      oscillator.stop(startsAt + .62)
    })

    closeTimer = window.setTimeout(() => {
      void context?.close()
      context = null
    }, durationMs + 300)
  } catch {
    void context?.close()
    context = null
  }

  return () => {
    if (closeTimer != null) window.clearTimeout(closeTimer)
    void context?.close()
    context = null
  }
}
