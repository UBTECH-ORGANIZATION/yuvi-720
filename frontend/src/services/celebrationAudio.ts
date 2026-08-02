/* The sound of finishing a component: a short crowd cheer.

   This replaced a synthesized "progression" arpeggio that rose in pitch for the
   length of the roadmap travel animation. It read as a UI chime — a lift noise —
   where the moment actually calls for applause, and it stretched to 6.8s when
   there was a next station to travel to, which no cheer should.

   Still fully synthesized: no media file to ship, load, cache or fail. The crowd
   is band-passed noise with a swell, the whoops are formant-ish sweeps, and the
   applause is a scatter of short noise transients that thins out as it settles. */

/** How long a cheer may run, however long the caller's animation is. */
const MAX_SECONDS = 3.4

function noiseBuffer(context: AudioContext, seconds: number): AudioBuffer {
  const frames = Math.max(1, Math.floor(context.sampleRate * seconds))
  const buffer = context.createBuffer(1, frames, context.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < frames; i += 1) data[i] = Math.random() * 2 - 1
  return buffer
}

/** Plays a short synthesized crowd cheer. Returns a stop handle. */
export function playCelebrationCheer(durationMs: number): () => void {
  if (typeof window === 'undefined' || !('AudioContext' in window)) return () => undefined

  let context: AudioContext | null = null
  let closeTimer: number | null = null

  try {
    context = new AudioContext()
    // Completing a lesson is always preceded by clicks, so the context should
    // already be unlocked; resume anyway rather than cheer into a muted tab.
    void context.resume?.()

    const now = context.currentTime
    const seconds = Math.min(Math.max(durationMs / 1000, 1.2), MAX_SECONDS)

    const master = context.createGain()
    master.gain.setValueAtTime(0.0001, now)
    master.gain.exponentialRampToValueAtTime(0.9, now + 0.12)
    master.gain.setValueAtTime(0.9, now + seconds * 0.55)
    master.gain.exponentialRampToValueAtTime(0.0001, now + seconds)
    master.connect(context.destination)

    const noise = noiseBuffer(context, 2)

    // ── The crowd itself: a swelling band of noise ──────────────────────────
    const crowd = context.createBufferSource()
    crowd.buffer = noise
    crowd.loop = true

    const crowdBand = context.createBiquadFilter()
    crowdBand.type = 'bandpass'
    crowdBand.frequency.setValueAtTime(760, now)
    crowdBand.Q.value = 0.8

    const crowdCut = context.createBiquadFilter()   // keep the rumble out
    crowdCut.type = 'highpass'
    crowdCut.frequency.value = 320

    const crowdGain = context.createGain()
    crowdGain.gain.setValueAtTime(0.0001, now)
    crowdGain.gain.exponentialRampToValueAtTime(0.16, now + 0.28)
    crowdGain.gain.setValueAtTime(0.16, now + seconds * 0.5)
    crowdGain.gain.exponentialRampToValueAtTime(0.0001, now + seconds)

    // A slow wobble across the band is what stops it sounding like flat hiss.
    const shimmer = context.createOscillator()
    const shimmerDepth = context.createGain()
    shimmer.frequency.value = 0.9
    shimmerDepth.gain.value = 260
    shimmer.connect(shimmerDepth).connect(crowdBand.frequency)
    shimmer.start(now)
    shimmer.stop(now + seconds)

    crowd.connect(crowdCut).connect(crowdBand).connect(crowdGain).connect(master)
    crowd.start(now)
    crowd.stop(now + seconds)

    // ── Individual whoops riding on top ────────────────────────────────────
    const whoops = 6
    for (let i = 0; i < whoops; i += 1) {
      const at = now + 0.04 + Math.random() * seconds * 0.5
      const length = 0.42 + Math.random() * 0.3
      const base = 300 + Math.random() * 190

      const voice = context.createOscillator()
      voice.type = 'sawtooth'
      voice.frequency.setValueAtTime(base, at)
      voice.frequency.exponentialRampToValueAtTime(base * 1.9, at + length * 0.45)
      voice.frequency.exponentialRampToValueAtTime(base * 1.25, at + length)

      // A wide band around the sweep gives it a vowel colour instead of a buzz.
      const formant = context.createBiquadFilter()
      formant.type = 'bandpass'
      formant.frequency.value = 850 + Math.random() * 500
      formant.Q.value = 2.4

      const gain = context.createGain()
      gain.gain.setValueAtTime(0.0001, at)
      gain.gain.exponentialRampToValueAtTime(0.045 + Math.random() * 0.03, at + 0.09)
      gain.gain.exponentialRampToValueAtTime(0.0001, at + length)

      let tail: AudioNode = gain
      if (typeof context.createStereoPanner === 'function') {
        const panner = context.createStereoPanner()
        panner.pan.value = Math.random() * 1.6 - 0.8
        gain.connect(panner)
        tail = panner
      }
      voice.connect(formant).connect(gain)
      tail.connect(master)
      voice.start(at)
      voice.stop(at + length + 0.02)
    }

    // ── Applause: dense at the burst, thinning as it settles ───────────────
    const claps = 26
    for (let i = 0; i < claps; i += 1) {
      // Squared random clusters the claps toward the beginning.
      const at = now + Math.pow(Math.random(), 1.7) * seconds * 0.86
      const burst = context.createBufferSource()
      burst.buffer = noise

      const body = context.createBiquadFilter()
      body.type = 'highpass'
      body.frequency.value = 1500 + Math.random() * 900

      const gain = context.createGain()
      gain.gain.setValueAtTime(0.0001, at)
      gain.gain.linearRampToValueAtTime(0.05 + Math.random() * 0.05, at + 0.004)
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.07)

      let tail: AudioNode = gain
      if (typeof context.createStereoPanner === 'function') {
        const panner = context.createStereoPanner()
        panner.pan.value = Math.random() * 1.8 - 0.9
        gain.connect(panner)
        tail = panner
      }
      burst.connect(body).connect(gain)
      tail.connect(master)
      burst.start(at, Math.random() * 1.5, 0.09)
    }

    closeTimer = window.setTimeout(() => {
      void context?.close()
      context = null
    }, seconds * 1000 + 260)
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
