import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { apiGet, apiPost } from '../../services/api'
import { collectSessionContext, installContextProbes } from './context'
import { startDomStream, type DomStreamHandle } from './domStream'
import { WidgetPeer } from './rtc'
import { SupportSocket } from './socket'
import type { ChatMessage, ShareMode, SupportSessionGrant } from './types'

export type SessionPhase = 'idle' | 'connecting' | 'live' | 'ended' | 'unavailable'

export interface ShareState {
  active: boolean
  mode: ShareMode | null
  /** A supporter asked and the learner has not answered yet. */
  pending: ShareMode | null
}

export interface VoiceState {
  active: boolean
  pending: boolean
  muted: boolean
}

const APP_VERSION = (import.meta.env.VITE_APP_VERSION as string | undefined) ?? 'dev'

/**
 * Owns one support session: the token, the socket, chat, screen sharing and voice.
 *
 * Nothing starts without the learner pressing something. A supporter can only *ask*;
 * `share.request` and `voice.request` set a pending flag that the UI turns into a
 * consent prompt, and every stream can be stopped in one click from the indicator.
 */
export function useSupportSession() {
  const [phase, setPhase] = useState<SessionPhase>('idle')
  const [connected, setConnected] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [supporterTyping, setSupporterTyping] = useState(false)
  const [share, setShare] = useState<ShareState>({ active: false, mode: null, pending: null })
  const [voice, setVoice] = useState<VoiceState>({ active: false, pending: false, muted: false })
  const [unread, setUnread] = useState(0)

  const socketRef = useRef<SupportSocket | null>(null)
  const grantRef = useRef<SupportSessionGrant | null>(null)
  const domRef = useRef<DomStreamHandle | null>(null)
  const displayRef = useRef<MediaStream | null>(null)
  const micRef = useRef<MediaStream | null>(null)
  const peerRef = useRef<WidgetPeer | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const languageRef = useRef('he')

  useEffect(() => {
    installContextProbes()
  }, [])

  const send = useCallback((type: string, payload: Record<string, unknown>) => {
    socketRef.current?.send(type, payload)
  }, [])

  const stopSharing = useCallback(() => {
    domRef.current?.stop()
    domRef.current = null
    for (const track of displayRef.current?.getTracks() ?? []) track.stop()
    displayRef.current = null
    peerRef.current?.close()
    setShare({ active: false, mode: null, pending: null })
    send('share.stopped', {})
  }, [send])

  const stopVoice = useCallback(() => {
    for (const track of micRef.current?.getTracks() ?? []) track.stop()
    micRef.current = null
    setVoice({ active: false, pending: false, muted: false })
    send('voice.ended', {})
  }, [send])

  const disconnect = useCallback(() => {
    if (share.active) stopSharing()
    if (voice.active) stopVoice()
    peerRef.current?.close()
    peerRef.current = null
    socketRef.current?.close()
    socketRef.current = null
    grantRef.current = null
    setPhase('ended')
  }, [share.active, stopSharing, stopVoice, voice.active])

  const connect = useCallback(
    async (language: string) => {
      if (phase === 'connecting' || phase === 'live') return
      languageRef.current = language
      setPhase('connecting')
      let grant: SupportSessionGrant
      try {
        grant = await apiPost<SupportSessionGrant>('/api/support/widget/session', {})
      } catch {
        setPhase('unavailable')
        return
      }
      grantRef.current = grant

      const socket = new SupportSocket(
        `${grant.socket_url}?token=${encodeURIComponent(grant.token)}`,
        setConnected,
      )
      socketRef.current = socket

      const peer = new WidgetPeer(
        send,
        () => [displayRef.current, micRef.current].filter(Boolean) as MediaStream[],
        (stream) => {
          if (audioRef.current) {
            audioRef.current.srcObject = stream
            void audioRef.current.play().catch(() => undefined)
          }
        },
      )
      peerRef.current = peer
      void peer.loadIceServers(new URL(grant.socket_url).origin.replace(/^ws/, 'http'), grant.token)

      socket.on('session.ready', () => {
        setPhase('live')
        send('context.update', collectSessionContext(languageRef.current, APP_VERSION))
      })
      socket.on('chat.history', (_payload, envelope) => {
        const history = (envelope.payload ?? []) as unknown as ChatMessage[]
        setMessages(Array.isArray(history) ? history : [])
      })
      socket.on('chat.message', (payload) => {
        const message = payload as unknown as ChatMessage
        setMessages((current) => [...current, message])
        if (message.sender === 'supporter') {
          setSupporterTyping(false)
          setUnread((count) => count + 1)
        }
      })
      socket.on('chat.ack', (payload) => {
        setMessages((current) => [...current, payload as unknown as ChatMessage])
      })
      socket.on('chat.typing', () => {
        setSupporterTyping(true)
        window.setTimeout(() => setSupporterTyping(false), 3000)
      })
      socket.on('share.request', (payload) => {
        const mode = (payload.mode as ShareMode | undefined) ?? 'dom'
        setShare((current) => ({ ...current, pending: mode }))
      })
      socket.on('share.stop', () => stopSharing())
      socket.on('voice.request', () => setVoice((current) => ({ ...current, pending: true })))
      socket.on('voice.ended', () => stopVoice())
      socket.on('capture.request', (payload) => {
        // A screenshot is only ever taken while the learner is already sharing.
        if (!displayRef.current) {
          send('capture.result', { request_id: payload.request_id, data_url: null })
          return
        }
        void captureFrame(displayRef.current).then((dataUrl) => {
          send('capture.result', { request_id: payload.request_id, data_url: dataUrl })
        })
      })
      socket.on('rtc.offer', (payload) => {
        const description = payload.description as RTCSessionDescriptionInit | undefined
        if (description) void peer.onOffer(description)
      })
      socket.on('rtc.ice', (payload) => {
        const candidate = payload.candidate as RTCIceCandidateInit | undefined
        if (candidate) void peer.onIce(candidate)
      })

      socket.connect()
    },
    [phase, send, stopSharing, stopVoice],
  )

  const acceptShare = useCallback(
    async (mode: ShareMode) => {
      send('share.consent', { mode, at: new Date().toISOString() })
      if (mode === 'display') {
        try {
          const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
          displayRef.current = stream
          // The browser's own "stop sharing" bar must end the session too.
          stream.getVideoTracks()[0]?.addEventListener('ended', () => stopSharing())
        } catch {
          setShare((current) => ({ ...current, pending: null }))
          return
        }
      } else {
        domRef.current = startDomStream(send)
      }
      setShare({ active: true, mode, pending: null })
      send('share.started', { mode })
    },
    [send, stopSharing],
  )

  const declineShare = useCallback(() => {
    setShare((current) => ({ ...current, pending: null }))
    send('share.stopped', {})
  }, [send])

  const acceptVoice = useCallback(async () => {
    try {
      micRef.current = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      setVoice({ active: false, pending: false, muted: false })
      send('voice.declined', { reason: 'no_microphone' })
      return
    }
    setVoice({ active: true, pending: false, muted: false })
    send('voice.accepted', {})
  }, [send])

  const declineVoice = useCallback(() => {
    setVoice({ active: false, pending: false, muted: false })
    send('voice.declined', { reason: 'user_declined' })
  }, [send])

  const toggleMute = useCallback(() => {
    setVoice((current) => {
      const muted = !current.muted
      for (const track of micRef.current?.getAudioTracks() ?? []) track.enabled = !muted
      return { ...current, muted }
    })
  }, [])

  const sendMessage = useCallback(
    (body: string) => {
      const text = body.trim()
      if (!text) return
      send('chat.message', { body: text })
    },
    [send],
  )

  const notifyTyping = useCallback(() => send('chat.typing', {}), [send])

  const markRead = useCallback(() => {
    setUnread(0)
    send('chat.read', {})
  }, [send])

  // A closed tab must never leave a stream running.
  useEffect(() => {
    const onLeave = () => {
      if (share.active) stopSharing()
      socketRef.current?.close()
    }
    window.addEventListener('pagehide', onLeave)
    return () => window.removeEventListener('pagehide', onLeave)
  }, [share.active, stopSharing])

  // Refresh the technical context while the session is open, so the supporter sees the
  // learner move between screens without asking.
  useEffect(() => {
    if (phase !== 'live') return
    const timer = window.setInterval(() => {
      send('context.update', collectSessionContext(languageRef.current, APP_VERSION))
    }, 20_000)
    return () => window.clearInterval(timer)
  }, [phase, send])

  return useMemo(
    () => ({
      phase,
      connected,
      messages,
      supporterTyping,
      share,
      voice,
      unread,
      audioRef,
      connect,
      disconnect,
      sendMessage,
      notifyTyping,
      markRead,
      acceptShare,
      declineShare,
      stopSharing,
      acceptVoice,
      declineVoice,
      stopVoice,
      toggleMute,
    }),
    [
      acceptShare,
      acceptVoice,
      connect,
      connected,
      declineShare,
      declineVoice,
      disconnect,
      markRead,
      messages,
      notifyTyping,
      phase,
      sendMessage,
      share,
      stopSharing,
      stopVoice,
      supporterTyping,
      toggleMute,
      unread,
      voice,
    ],
  )
}

/** Grabs a single frame from the shared display stream for a bug report. */
async function captureFrame(stream: MediaStream): Promise<string | null> {
  const track = stream.getVideoTracks()[0]
  const Capture = (window as unknown as { ImageCapture?: new (t: MediaStreamTrack) => { grabFrame(): Promise<ImageBitmap> } })
    .ImageCapture
  if (!track || !Capture) return null
  try {
    const bitmap = await new Capture(track).grabFrame()
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0)
    return canvas.toDataURL('image/png')
  } catch {
    return null
  }
}

/** Lets the client hide the button entirely when support is not deployed. */
export async function isSupportEnabled(): Promise<boolean> {
  try {
    const config = await apiGet<{ enabled: boolean }>('/api/support/widget/config')
    return config.enabled
  } catch {
    return false
  }
}
