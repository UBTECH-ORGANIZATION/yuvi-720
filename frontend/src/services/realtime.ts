/* One EventSource per stream, shared by every consumer in the tab.
 *
 * HTTP/1.1 allows roughly six connections per origin, and an SSE stream holds
 * one open for as long as the page lives. The learner page alone wants coach
 * nudges and notifications; the teacher page wants alerts and presence. Opening
 * a connection per feature would spend that budget on plumbing and then quietly
 * starve ordinary fetches — the failure mode is not an error, it is requests
 * that simply never start.
 *
 * So: a ref-counted registry. The first subscriber to a URL opens the stream,
 * the last one to leave closes it, and everyone in between shares it.
 *
 * Reconnection is left to the browser, which already retries SSE with backoff.
 * What the browser cannot do is tell the server what we already saw — that is
 * the `cursor` callback: consumers that need gap-free replay (teacher alerts)
 * hand back a `?since=` value, and the next connection resumes from it.
 */

export interface RealtimeFrame {
  type: string
  [key: string]: unknown
}

type Handler = (frame: RealtimeFrame) => void

interface Channel {
  source: EventSource
  handlers: Set<Handler>
  /** Rebuilds the URL on reconnect so a replay cursor can advance. */
  url: () => string
  retry: number | null
}

const channels = new Map<string, Channel>()

function open(key: string, channel: Channel): EventSource {
  // Same-origin through the Vite proxy today, but be explicit: these streams are
  // session-scoped and must carry the auth cookie.
  const source = new EventSource(channel.url(), { withCredentials: true })
  source.onmessage = (event) => {
    let frame: RealtimeFrame
    try {
      frame = JSON.parse(event.data) as RealtimeFrame
    } catch {
      return                       // malformed frame: ignore, never tear down
    }
    if (!frame.type || frame.type === '_heartbeat') return
    // Copy before iterating: a handler may unsubscribe itself on the frame it
    // just received (a one-shot alert toast does exactly that).
    for (const handler of [...channel.handlers]) {
      try {
        handler(frame)
      } catch (error) {
        console.error('realtime handler failed', error)
      }
    }
  }
  source.onerror = () => {
    // EventSource reconnects on its own unless it has been closed. Only step in
    // when the browser has given up, and then rebuild the URL so any replay
    // cursor is current.
    if (source.readyState !== EventSource.CLOSED) return
    if (!channel.handlers.size) return
    channel.retry = window.setTimeout(() => {
      const current = channels.get(key)
      if (!current || !current.handlers.size) return
      current.source = open(key, current)
    }, 3000)
  }
  return source
}

/**
 * Listen to a stream, sharing the underlying connection.
 *
 * `url` is a function rather than a string so a reconnect can pick up a replay
 * cursor that advanced while the stream was live.
 */
export function subscribe(key: string, url: () => string, handler: Handler): () => void {
  let channel = channels.get(key)
  if (!channel) {
    channel = { source: null as unknown as EventSource, handlers: new Set(), url, retry: null }
    channels.set(key, channel)
    channel.source = open(key, channel)
  }
  channel.handlers.add(handler)

  return () => {
    const current = channels.get(key)
    if (!current) return
    current.handlers.delete(handler)
    if (current.handlers.size) return      // someone else is still listening
    if (current.retry !== null) window.clearTimeout(current.retry)
    current.source.close()
    channels.delete(key)
  }
}

/** Open connection count. Exposed for debugging, not for features. */
export function channelCount(): number {
  return channels.size
}
