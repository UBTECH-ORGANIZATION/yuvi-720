import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * The learner speaking, in whichever of their languages they reach for.
 *
 * Azure Speech settles on one locale per utterance, so a Hebrew sentence with
 * English inside it came back either as Hebrew phonetics ("I play" -> "אייפליי")
 * or, when English won, with the Hebrew Latinised. A transcription model has no
 * locale to pin, so each language keeps its own script. That also means we
 * cannot lean on the SDK for endpointing: we hold the microphone, decide here
 * when a turn has ended, and post that audio to be transcribed.
 */

export type DictationState =
  | 'idle'
  | 'starting'
  | 'listening'
  | 'transcribing'
  | 'paused'
  | 'error'

const TARGET_SAMPLE_RATE = 16000
/** Silence that ends a turn. Long enough to think mid-sentence, short enough
 *  that Yuvi is not left waiting once the learner has clearly finished. */
const SILENCE_MS = 500
/** Ignore blips of room noise that are not speech at all. */
const MIN_SPEECH_MS = 300
const MAX_TURN_MS = 20000
const SPEECH_RMS = 0.012
/** Frames kept from before speech was detected. A word is already a syllable in
 *  by the time it is loud enough to notice, and transcription without the onset
 *  turns "I play" into Hebrew phonetics. */
const PRE_ROLL_FRAMES = 4

function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i))
  }
  ascii(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  ascii(8, 'WAVEfmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  ascii(36, 'data')
  view.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(44 + i * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true)
  }
  return new Blob([view], { type: 'audio/wav' })
}

type Options = {
  /** What the lesson is about, which is what rescues fragments too short to
   *  identify from audio alone. */
  vocabulary?: () => string[]
}

export function useDictation(
  onUtterance: (text: string, language: string) => void,
  options: Options = {},
) {
  const [state, setState] = useState<DictationState>('idle')
  const [partial, setPartial] = useState('')
  const openingRef = useRef(false)
  // We hold the microphone ourselves. That is what makes muting instant, and it
  // is also what lets us capture the audio we send for transcription.
  const streamRef = useRef<MediaStream | null>(null)
  const contextRef = useRef<AudioContext | null>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null)
  const mutedRef = useRef(false)
  // The learner's intent to be heard, which outlives Yuvi taking a turn to talk.
  const wantedRef = useRef(false)

  const chunksRef = useRef<Float32Array[]>([])
  const preRollRef = useRef<Float32Array[]>([])
  const speakingRef = useRef(false)
  const silenceRef = useRef(0)
  const speechRef = useRef(0)

  // Both change identity on every render of the chat; neither should tear the
  // microphone down and rebuild it.
  const handlerRef = useRef(onUtterance)
  handlerRef.current = onUtterance
  const vocabularyRef = useRef(options.vocabulary)
  vocabularyRef.current = options.vocabulary

  const resetTurn = useCallback(() => {
    chunksRef.current = []
    preRollRef.current = []
    speakingRef.current = false
    silenceRef.current = 0
    speechRef.current = 0
  }, [])

  const teardown = useCallback(() => {
    processorRef.current?.disconnect()
    void contextRef.current?.close().catch(() => {})
    streamRef.current?.getTracks().forEach((track) => track.stop())
    processorRef.current = null
    contextRef.current = null
    streamRef.current = null
    mutedRef.current = false
    resetTurn()
    setPartial('')
  }, [resetTurn])

  const submit = useCallback(async (samples: Float32Array, sampleRate: number) => {
    setState('transcribing')
    // The microphone stays shut only if this turn is handed on; whoever takes it
    // reopens the mic when Yuvi has finished replying.
    let handed = false
    try {
      const form = new FormData()
      form.append('audio', encodeWav(samples, sampleRate), 'speech.wav')
      const terms = vocabularyRef.current?.() ?? []
      if (terms.length) form.append('vocabulary', terms.join(','))

      const response = await fetch('/api/speech/transcribe', {
        method: 'POST',
        body: form,
        credentials: 'same-origin',
      })
      if (!response.ok) throw new Error('transcription unavailable')
      const { text, language } = await response.json()
      const trimmed = (text || '').trim()
      if (trimmed && wantedRef.current) {
        handed = true
        handlerRef.current(trimmed, language || 'he')
      }
    } catch {
      // A dropped turn is recoverable by speaking again; the mic stays open.
    } finally {
      if (!handed) {
        mutedRef.current = false
        streamRef.current?.getAudioTracks().forEach((track) => { track.enabled = true })
      }
      setState(!wantedRef.current ? 'idle' : mutedRef.current ? 'paused' : 'listening')
    }
  }, [])

  /** Open the microphone and listen for the end of each spoken turn. */
  const open = useCallback(async () => {
    if (contextRef.current || openingRef.current) return
    openingRef.current = true
    setState('starting')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
      streamRef.current = stream
      // Yuvi may have started talking while permission was pending; the new
      // stream has to arrive already muted rather than undoing that.
      stream.getAudioTracks().forEach((track) => { track.enabled = !mutedRef.current })

      const context = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE })
      contextRef.current = context
      const source = context.createMediaStreamSource(stream)
      const processor = context.createScriptProcessor(4096, 1, 1)
      processorRef.current = processor
      const frameMs = (4096 / context.sampleRate) * 1000

      processor.onaudioprocess = (event) => {
        if (mutedRef.current) {
          resetTurn()
          return
        }
        const input = event.inputBuffer.getChannelData(0)
        let sum = 0
        for (let i = 0; i < input.length; i += 1) sum += input[i] * input[i]
        const rms = Math.sqrt(sum / input.length)
        const frame = new Float32Array(input)

        if (rms > SPEECH_RMS) {
          if (!speakingRef.current) {
            speakingRef.current = true
            chunksRef.current = preRollRef.current.slice()
            preRollRef.current = []
          }
          speechRef.current += frameMs
          silenceRef.current = 0
        } else if (speakingRef.current) {
          silenceRef.current += frameMs
        } else {
          preRollRef.current.push(frame)
          if (preRollRef.current.length > PRE_ROLL_FRAMES) preRollRef.current.shift()
          return
        }

        chunksRef.current.push(frame)
        const elapsed = speechRef.current + silenceRef.current
        if (silenceRef.current < SILENCE_MS && elapsed < MAX_TURN_MS) return

        const enough = speechRef.current >= MIN_SPEECH_MS
        const collected = chunksRef.current
        resetTurn()
        if (!enough) return

        // Yuvi's turn starts here, not when the transcript returns. Leaving the
        // microphone open across that round trip let a second turn start on top
        // of the first.
        mutedRef.current = true
        stream.getAudioTracks().forEach((track) => { track.enabled = false })

        const total = collected.reduce((count, chunk) => count + chunk.length, 0)
        const merged = new Float32Array(total)
        let offset = 0
        for (const chunk of collected) {
          merged.set(chunk, offset)
          offset += chunk.length
        }
        void submit(merged, context.sampleRate)
      }

      // The processor needs a sink, but the learner must not hear themselves
      // echoed back, so it drains through a silent gain node.
      const silent = context.createGain()
      silent.gain.value = 0
      source.connect(processor)
      processor.connect(silent)
      silent.connect(context.destination)

      // The learner may have closed the mic while permission was pending.
      if (!wantedRef.current) {
        teardown()
        return
      }
      setState(mutedRef.current ? 'paused' : 'listening')
    } catch {
      teardown()
      setState('error')
    } finally {
      openingRef.current = false
    }
  }, [resetTurn, submit, teardown])

  const start = useCallback(() => {
    wantedRef.current = true
    void open()
  }, [open])

  const stop = useCallback(() => {
    wantedRef.current = false
    teardown()
    setState('idle')
  }, [teardown])

  /** Mute the microphone while Yuvi speaks, so it never hears itself. Without
   *  this the reply leaks through the speakers, comes back as a new learner
   *  turn, and Yuvi ends up answering himself. */
  const pause = useCallback(() => {
    mutedRef.current = true
    streamRef.current?.getAudioTracks().forEach((track) => { track.enabled = false })
    resetTurn()
    setPartial('')
    setState((current) => (current === 'listening' || current === 'starting' ? 'paused' : current))
  }, [resetTurn])

  const resume = useCallback(() => {
    if (!wantedRef.current) return
    mutedRef.current = false
    streamRef.current?.getAudioTracks().forEach((track) => { track.enabled = true })
    resetTurn()
    if (!contextRef.current && !openingRef.current) {
      void open()
      return
    }
    setState((current) => (current === 'paused' ? 'listening' : current))
  }, [open, resetTurn])

  useEffect(() => () => { wantedRef.current = false; teardown() }, [teardown])

  const toggle = useCallback(() => {
    if (wantedRef.current) stop()
    else start()
  }, [start, stop])

  return { state, partial, start, stop, pause, resume, toggle }
}
