/* Raw PCM16 plumbing for the spoken call.
 *
 * Voice Live speaks 24 kHz mono PCM16 in both directions, so the browser has to
 * do what WebRTC used to do for free: hand over microphone frames in that exact
 * shape, and play the reply back gaplessly. */

export const SAMPLE_RATE = 24000

/* Buffered inside the worklet rather than posted per render quantum. A quantum
   is 128 frames — about 5 ms — and one WebSocket frame per 5 ms of speech is a
   lot of traffic for no benefit. 1200 frames is 50 ms, which stays responsive. */
const CAPTURE_WORKLET = `
class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super()
    this.chunk = new Int16Array(1200)
    this.filled = 0
  }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0]
    if (!channel) return true
    for (let i = 0; i < channel.length; i += 1) {
      const sample = Math.max(-1, Math.min(1, channel[i]))
      this.chunk[this.filled] = sample < 0 ? sample * 0x8000 : sample * 0x7fff
      this.filled += 1
      if (this.filled === this.chunk.length) {
        this.port.postMessage(this.chunk.slice().buffer)
        this.filled = 0
      }
    }
    return true
  }
}
registerProcessor('pcm-capture', PcmCapture)
`

export function encodeBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

export function decodeBase64(value: string): Int16Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return new Int16Array(bytes.buffer)
}

/** Microphone → 50 ms PCM16 chunks. Returns a teardown function. */
export async function captureMicrophone(
  context: AudioContext,
  stream: MediaStream,
  onChunk: (chunk: ArrayBuffer) => void,
): Promise<() => void> {
  const moduleUrl = URL.createObjectURL(new Blob([CAPTURE_WORKLET], { type: 'text/javascript' }))
  try {
    await context.audioWorklet.addModule(moduleUrl)
  } finally {
    URL.revokeObjectURL(moduleUrl)
  }
  const source = context.createMediaStreamSource(stream)
  const node = new AudioWorkletNode(context, 'pcm-capture')
  node.port.onmessage = (event) => onChunk(event.data as ArrayBuffer)
  source.connect(node)
  // A worklet with no destination is not pulled by the graph. Routing it through
  // a muted gain keeps it running without the learner hearing themselves.
  const silence = context.createGain()
  silence.gain.value = 0
  node.connect(silence).connect(context.destination)
  return () => {
    node.port.onmessage = null
    source.disconnect()
    node.disconnect()
    silence.disconnect()
  }
}

/** Plays PCM16 chunks back to back, and can be cut off mid-sentence. */
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

  /** Barge-in: drop whatever Yuvi had queued so the learner is not talked over. */
  clear() {
    this.playing.forEach((source) => {
      try { source.stop() } catch { /* already finished */ }
    })
    this.playing.clear()
    this.nextStart = 0
  }
}
