import { useCallback, useEffect, useRef, useState } from 'react'
import { captureMicrophone, decodeBase64, encodeBase64, PcmPlayer, SAMPLE_RATE } from './pcmAudio'

/**
 * Live spoken practice with Yuvi.
 *
 * Audio is streamed to the backend, which relays it to Azure Voice Live. It goes
 * that way round rather than peer-to-peer because Voice Live has no ephemeral
 * secret a browser could safely hold, and because the relay is what decides
 * which voice Yuvi answers in — Hebrew speech gets a Hebrew voice, English gets
 * an English one. The recording itself is never stored: what comes back to us is
 * the screened transcript of each turn and the provider's own token counts.
 */

export type VoiceState = 'idle' | 'connecting' | 'listening' | 'speaking' | 'error'

export type VoiceCorrection = { say: string; note: string }
export type VoiceTurn = { role: 'learner' | 'yuvi'; text: string; correction?: VoiceCorrection }

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(String(response.status))
  return response.json() as Promise<T>
}

export function useVoiceCall(language: string, surface?: string) {
  const [state, setState] = useState<VoiceState>('idle')
  const [turns, setTurns] = useState<VoiceTurn[]>([])
  const [disclosure, setDisclosure] = useState('')
  const [stage, setStage] = useState<string | null>(null)

  const socketRef = useRef<WebSocket | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const contextRef = useRef<AudioContext | null>(null)
  const playerRef = useRef<PcmPlayer | null>(null)
  const stopMicRef = useRef<(() => void) | null>(null)
  const sessionIdRef = useRef<string | undefined>(undefined)
  // The learner's line and Yuvi's line arrive on different events; a turn is
  // only worth persisting once both halves exist.
  const pendingRef = useRef<{ learner?: string; yuvi?: string }>({})

  const hangUp = useCallback(() => {
    stopMicRef.current?.()
    playerRef.current?.clear()
    socketRef.current?.close()
    streamRef.current?.getTracks().forEach((track) => track.stop())
    void contextRef.current?.close().catch(() => {})
    stopMicRef.current = null
    playerRef.current = null
    socketRef.current = null
    streamRef.current = null
    contextRef.current = null
    sessionIdRef.current = undefined
    setState('idle')
  }, [])

  useEffect(() => hangUp, [hangUp])

  const flushTurn = useCallback(() => {
    const pending = pendingRef.current
    if (!pending.learner && !pending.yuvi) return
    pendingRef.current = {}
    const said = pending.learner || ''
    postJson<{ stage?: string; correction?: VoiceCorrection | null }>('/api/agent/voice/turn', {
      learnerText: said,
      coachText: pending.yuvi || '',
      language,
    })
      .then((result) => {
        if (result.stage) setStage(result.stage)
        // Hang the written recast on the line it belongs to, so the learner
        // reads it next to their own words instead of as a separate verdict.
        if (result.correction && said) {
          setTurns((previous) => {
            let index = -1
            for (let i = previous.length - 1; i >= 0; i -= 1) {
              if (previous[i].role === 'learner' && previous[i].text === said) { index = i; break }
            }
            if (index < 0) return previous
            const next = [...previous]
            next[index] = { ...next[index], correction: result.correction as VoiceCorrection }
            return next
          })
        }
      })
      .catch(() => { /* a lost transcript must never interrupt the conversation */ })
  }, [language])

  const onServerEvent = useCallback((raw: string) => {
    let event: any
    try { event = JSON.parse(raw) } catch { return }

    switch (event.type) {
      case 'yuvi.ready':
        if (event.stage) setStage(event.stage)
        setState('listening')
        break
      case 'session.created':
        sessionIdRef.current = event.session?.id
        break
      case 'input_audio_buffer.speech_started':
        // Barge-in: drop whatever Yuvi still had queued to say.
        playerRef.current?.clear()
        setState('listening')
        break
      case 'conversation.item.input_audio_transcription.completed': {
        const text = String(event.transcript || '').trim()
        if (!text) break
        pendingRef.current.learner = text
        setTurns((previous) => [...previous, { role: 'learner', text }])
        break
      }
      case 'response.audio.delta':
      case 'response.output_audio.delta':
        if (event.delta) playerRef.current?.push(decodeBase64(event.delta))
        break
      case 'response.audio_transcript.done':
      case 'response.output_audio_transcript.done': {
        const text = String(event.transcript || '').trim()
        if (!text) break
        pendingRef.current.yuvi = text
        setTurns((previous) => [...previous, { role: 'yuvi', text }])
        break
      }
      case 'response.done': {
        setState('listening')
        flushTurn()
        const usage = event.response?.usage
        if (usage) {
          postJson('/api/agent/voice/usage', {
            usage, sessionId: sessionIdRef.current, status: 'completed',
          }).catch(() => {})
        }
        break
      }
      case 'response.created':
        setState('speaking')
        break
      case 'error':
        setState('error')
        break
      default:
        break
    }
  }, [flushTurn])

  const call = useCallback(async (referenceText?: string) => {
    if (state !== 'idle' && state !== 'error') return
    setState('connecting')
    setTurns([])
    try {
      const session = await postJson<{ disclosure?: string }>('/api/agent/voice/session', {
        language, surface, referenceText,
      })
      setDisclosure(session.disclosure || '')

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      })
      streamRef.current = stream

      const context = new AudioContext({ sampleRate: SAMPLE_RATE })
      contextRef.current = context
      await context.resume()
      playerRef.current = new PcmPlayer(context)

      const socket = new WebSocket(
        `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/agent/voice/stream`,
      )
      socketRef.current = socket
      socket.addEventListener('message', (event) => onServerEvent(event.data))
      socket.addEventListener('close', () => { if (socketRef.current === socket) hangUp() })
      socket.addEventListener('error', () => setState('error'))

      await new Promise<void>((resolve, reject) => {
        socket.addEventListener('open', () => resolve(), { once: true })
        socket.addEventListener('close', () => reject(new Error('closed')), { once: true })
      })
      socket.send(JSON.stringify({ language, surface, referenceText }))

      stopMicRef.current = await captureMicrophone(context, stream, (chunk) => {
        if (socket.readyState !== WebSocket.OPEN) return
        socket.send(JSON.stringify({
          type: 'input_audio_buffer.append',
          audio: encodeBase64(chunk),
        }))
      })
    } catch {
      hangUp()
      setState('error')
    }
  }, [state, language, surface, onServerEvent, hangUp])

  return { state, turns, disclosure, stage, call, hangUp }
}
