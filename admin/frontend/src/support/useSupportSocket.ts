import { useEffect, useRef } from 'react'

/* Live thread updates. The socket only carries pointers, so every event triggers
   the same refetch a poll would have done — a dropped socket therefore loses
   nothing, and the reconnect refetch closes any gap. */
const MAX_BACKOFF_MS = 30000
const IDLE_REFRESH_MS = 45000

export function useSupportSocket(url: string, onEvent: () => void) {
  const handler = useRef(onEvent)
  handler.current = onEvent

  useEffect(() => {
    let socket: WebSocket | null = null
    let retry = 0
    let reconnectTimer = 0
    let closed = false

    const connect = () => {
      if (closed) return
      const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws'
      socket = new WebSocket(`${scheme}://${window.location.host}${url}`)
      socket.onopen = () => {
        retry = 0
        handler.current()
      }
      socket.onmessage = () => handler.current()
      socket.onclose = () => {
        if (closed) return
        retry += 1
        const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** Math.min(retry, 5))
        reconnectTimer = window.setTimeout(connect, delay)
      }
    }

    const onVisible = () => {
      if (document.visibilityState === 'visible') handler.current()
    }

    connect()
    document.addEventListener('visibilitychange', onVisible)
    // Safety net for a socket that stays open but stops delivering.
    const idle = window.setInterval(() => handler.current(), IDLE_REFRESH_MS)

    return () => {
      closed = true
      window.clearTimeout(reconnectTimer)
      window.clearInterval(idle)
      document.removeEventListener('visibilitychange', onVisible)
      socket?.close()
    }
  }, [url])
}
