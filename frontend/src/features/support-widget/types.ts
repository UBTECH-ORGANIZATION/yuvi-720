/** Wire types shared with the support service WebSocket (`/ws/widget`). */

export interface Envelope {
  type: string
  session_id?: string
  payload?: Record<string, unknown>
}

export interface SupportSessionGrant {
  token: string
  session_id: string
  ticket_id: string
  expires_in: number
  socket_url: string
}

export interface ChatMessage {
  message_id: string
  ticket_id: string
  session_id?: string | null
  sender: 'user' | 'supporter' | 'system'
  sender_ref: string
  body: string
  sent_at?: string
  created_at?: string
}

export type ShareMode = 'dom' | 'display'

export interface ShareRequest {
  mode: ShareMode
  reason?: string
}
