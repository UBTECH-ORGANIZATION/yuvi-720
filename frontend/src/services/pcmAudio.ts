/* Gapless playback of raw PCM16 the backend synthesised.
 *
 * Yuvi's replies come back as several audio segments — one per language — and
 * MP3 would put an encoder-padding gap between each. Raw 24 kHz PCM scheduled
 * on the Web Audio clock plays them as one continuous sentence. */

export const SAMPLE_RATE = 24000

export function decodeBase64(value: string): Int16Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return new Int16Array(bytes.buffer)
}

export class PcmPlayer {
  private nextStart = 0
  private playing = new Set<AudioBufferSourceNode>()

  constructor(private readonly context: AudioContext) {}

  push(samples: Int16Array) {
    if (!samples.length) return
    const buffer = this.context.createBuffer(1, samples.length, SAMPLE_RATE)
    const channel = buffer.getChannelData(0)
    for (let i = 0; i < samples.length; i += 1) channel[i] = samples[i] / 0x8000
    const source = this.context.createBufferSource()
    source.buffer = buffer
    source.connect(this.context.destination)
    const startAt = Math.max(this.context.currentTime, this.nextStart)
    source.start(startAt)
    this.nextStart = startAt + buffer.duration
    this.playing.add(source)
    source.onended = () => this.playing.delete(source)
  }

  /** True while audio is still queued ahead of the clock. */
  get isSpeaking() {
    return this.playing.size > 0
  }

  /** Seconds of already-scheduled audio still to play. */
  get remainingSeconds() {
    return Math.max(0, this.nextStart - this.context.currentTime)
  }

  stop() {
    this.playing.forEach((source) => {
      try { source.stop() } catch { /* already finished */ }
    })
    this.playing.clear()
    this.nextStart = 0
  }
}
