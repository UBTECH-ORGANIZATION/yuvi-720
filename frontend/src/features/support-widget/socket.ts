import type { Envelope } from './types'

type Handler = (payload: Record<string, unknown>, envelope: Envelope) => void

/**
 * The widget half of the support connection.
 *
 * Reconnects with backoff because a student on school Wi-Fi drops constantly, and a
 * dropped socket must never look like "the supporter left". History is re-sent by the
 * service on every attach, so a reconnect is invisible in the chat.
 */
export class SupportSocket {
  private socket: WebSocket | null = null
  private readonly handlers = new Map<string, Set<Handler>>()
  private attempt = 0
  private closedByUs = false
  private heartbeat = 0

  constructor(
    private readonly url: string,
    private readonly onStateChange: (connected: boolean) => void,
  ) {}

  on(type: string, handler: Handler): void {
    const set = this.handlers.get(type) ?? new Set<Handler>()
    set.add(handler)
    this.handlers.set(type, set)
  }

  connect(): void {
    this.closedByUs = false
    const socket = new WebSocket(this.url)
    this.socket = socket

    socket.addEventListener('open', () => {
      this.attempt = 0
      this.onStateChange(true)
      this.heartbeat = window.setInterval(() => this.send('presence.ping', {}), 25_000)
    })

    socket.addEventListener('message', (event) => {
      let envelope: Envelope
      try {
        envelope = JSON.parse(String(event.data)) as Envelope
      } catch {
        return
      }
      const listeners = this.handlers.get(envelope.type)
      if (!listeners) return
      for (const handler of listeners) handler(envelope.payload ?? {}, envelope)
    })

    const down = () => {
      window.clearInterval(this.heartbeat)
      this.onStateChange(false)
      if (this.closedByUs) return
      this.attempt += 1
      const delay = Math.min(15_000, 500 * 2 ** Math.min(this.attempt, 5))
      window.setTimeout(() => this.connect(), delay)
    }
    socket.addEventListener('close', down)
    socket.addEventListener('error', () => socket.close())
  }

  send(type: string, payload: Record<string, unknown>): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return
    this.socket.send(JSON.stringify({ type, payload }))
  }

  close(): void {
    this.closedByUs = true
    window.clearInterval(this.heartbeat)
    this.socket?.close()
    this.socket = null
    this.onStateChange(false)
  }
}
