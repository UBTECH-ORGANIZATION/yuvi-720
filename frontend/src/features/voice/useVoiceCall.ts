import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Live spoken practice with Yuvi.
 *
 * The audio path deliberately does not go through our servers: we ask the
 * backend for a short-lived secret, then open a WebRTC connection straight to
 * Azure. The learner's microphone stream never reaches a Yuvilab server and is
 * never stored — what we send back is the screened transcript of each turn and
 * the provider's own token counts, so the conversation can be metered and the
 * teacher can see that it happened without anyone keeping a child's voice.
 */

export type VoiceState = 'idle' | 'connecting' | 'listening' | 'speaking' | 'error'

type VoiceSession = {
  clientSecret: string
  webrtcUrl: string
  model: string
  disclosure: string
  sessionId?: string
}

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

  const peerRef = useRef<RTCPeerConnection | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const channelRef = useRef<RTCDataChannel | null>(null)
  const sessionRef = useRef<VoiceSession | null>(null)
  // The learner's line and Yuvi's line arrive on different events; a turn is
  // only worth persisting once both halves exist.
  const pendingRef = useRef<{ learner?: string; yuvi?: string }>({})

  const hangUp = useCallback(() => {
    channelRef.current?.close()
    peerRef.current?.close()
    streamRef.current?.getTracks().forEach((track) => track.stop())
    audioRef.current?.remove()
    channelRef.current = null
    peerRef.current = null
    streamRef.current = null
    audioRef.current = null
    sessionRef.current = null
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
      case 'input_audio_buffer.speech_started':
        setState('listening')
        break
      case 'conversation.item.input_audio_transcription.completed': {
        const text = String(event.transcript || '').trim()
        if (!text) break
        pendingRef.current.learner = text
        setTurns((previous) => [...previous, { role: 'learner', text }])
        break
      }
      case 'response.audio_transcript.done': {
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
          // The provider's own counts. We are the only ones who can persist
          // them, because the response never passed through our servers.
          postJson('/api/agent/voice/usage', {
            usage, sessionId: sessionRef.current?.sessionId, status: 'completed',
          }).catch(() => {})
        }
        break
      }
      case 'output_audio_buffer.started':
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
      const session = await postJson<VoiceSession>('/api/agent/voice/session', {
        language, surface, referenceText,
      })
      sessionRef.current = session
      setDisclosure(session.disclosure || '')

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream

      const peer = new RTCPeerConnection()
      peerRef.current = peer

      const audio = document.createElement('audio')
      audio.autoplay = true
      audioRef.current = audio
      peer.ontrack = (event) => { audio.srcObject = event.streams[0] }
      stream.getTracks().forEach((track) => peer.addTrack(track, stream))

      const channel = peer.createDataChannel('oai-events')
      channelRef.current = channel
      channel.addEventListener('message', (event) => onServerEvent(event.data))

      const offer = await peer.createOffer()
      await peer.setLocalDescription(offer)

      const answer = await fetch(`${session.webrtcUrl}?model=${encodeURIComponent(session.model)}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.clientSecret}`, 'Content-Type': 'application/sdp' },
        body: offer.sdp,
      })
      if (!answer.ok) throw new Error('sdp')
      await peer.setRemoteDescription({ type: 'answer', sdp: await answer.text() })
      setState('listening')
    } catch (error) {
      hangUp()
      setState('error')
    }
  }, [state, language, surface, onServerEvent, hangUp])

  return { state, turns, disclosure, stage, call, hangUp }
}
