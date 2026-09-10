/* The parent half of the game harness protocol.
 *
 * The served HTML carries `workers/game_gen/harness/yuvi_learn.js` and
 * `error_reporter.js`; both talk to us with `postMessage` frames shaped
 * `{source:'yuvi-game', type, nonce, ...}`. The nonce is minted per render and
 * written into the page as `window.__YUVI_NONCE`, so a frame that does not
 * carry it did not come from the game we are showing — another tab's game, a
 * stale iframe mid-swap, or anything else on the page that shouts at `window`.
 *
 * The game talks, the host listens; nothing is graded here. The bridge inside
 * the page grades every question locally against the answer key the game was
 * written with, and only tells us what happened: a question was asked, it was
 * answered, the score moved, the game ended, something threw. There is no
 * reply channel — the host never posts anything back into the frame.
 *
 * Pure by design (no DOM at module level): `handle` takes the frame and
 * `attach` is the thin window binding — so the nonce filter and the event
 * fan-out can be tested under `node --test`.
 */

export const GAME_SOURCE = 'yuvi-game'

/** One runtime error the in-frame reporter caught. */
export interface GameRuntimeError {
  message: string
  stack?: string
  filename?: string
  line?: number
  /** ms since the page was attached — the auto-fix window is measured on it. */
  at: number
}

export interface GameProgress {
  asked: number
  answered: number
  correct: number
}

export interface HostBridgeOptions {
  nonce: string
  onReady?: () => void
  onAsked?: (questionId: string, index: number) => void
  onAnswered?: (questionId: string, correct: boolean) => void
  /** The game's own scoreboard moved (`YuviLearn.progress(patch)`); the frame
   *  carries whatever the game keeps — score, level, lives — plus the counters. */
  onProgress?: (progress: GameProgress, state: Record<string, unknown>) => void
  onDone?: (progress: GameProgress, summary: unknown) => void
  onError?: (error: GameRuntimeError) => void
  /** Clock for `GameRuntimeError.at`; injectable for tests. */
  now?: () => number
}

export interface HostBridge {
  /** Feed one `message` payload. Returns true when it was ours and handled. */
  handle: (data: unknown) => boolean
  /** Bind to a window, locked to the iframe we show; returns the detach function. */
  attach: (win: Window, frame: () => HTMLIFrameElement | null) => () => void
}

/** The nonce the server wrote into the page, or null when the HTML has none
 *  (an old render, or not a game at all — nothing will be trusted from it). */
export function parseNonce(html: string): string | null {
  const match = /window\.__YUVI_NONCE\s*=\s*(["'])([^"']*)\1/.exec(html)
  return match ? match[2] : null
}

/* Browser noise that says nothing about the game. "Script error." is the
   cross-origin stand-in for an error the browser refuses to describe, and the
   ResizeObserver loop warning fires on perfectly healthy layouts. Sending
   either to the fixer would have it "fix" code that is not broken. */
const NOISE = [/^Script error\.?$/i, /ResizeObserver loop/i]

export function isNoiseError(message: string): boolean {
  return NOISE.some((pattern) => pattern.test(message.trim()))
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function asProgress(value: unknown): GameProgress {
  const progress = (value && typeof value === 'object' ? value : {}) as Partial<GameProgress>
  return {
    asked: asNumber(progress.asked) ?? 0,
    answered: asNumber(progress.answered) ?? 0,
    correct: asNumber(progress.correct) ?? 0,
  }
}

export function createHostBridge(options: HostBridgeOptions): HostBridge {
  const now = options.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()))
  const attachedAt = now()

  const handle: HostBridge['handle'] = (data) => {
    if (!data || typeof data !== 'object') return false
    const frame = data as Record<string, unknown>
    if (frame.source !== GAME_SOURCE) return false
    if (!options.nonce || frame.nonce !== options.nonce) return false

    switch (frame.type) {
      case 'ready':
        options.onReady?.()
        return true
      case 'learn.asked':
        options.onAsked?.(asString(frame.questionId) ?? '', asNumber(frame.index) ?? 0)
        return true
      case 'learn.answered':
        options.onAnswered?.(asString(frame.questionId) ?? '', frame.correct === true)
        return true
      case 'learn.progress': {
        const state = (frame.state && typeof frame.state === 'object' ? frame.state : frame) as Record<string, unknown>
        options.onProgress?.(asProgress(frame.progress ?? state), state)
        return true
      }
      case 'learn.done':
        options.onDone?.(asProgress(frame.progress), frame.summary ?? null)
        return true
      case 'error': {
        const message = asString(frame.message) ?? 'Unknown error'
        if (isNoiseError(message)) return true
        options.onError?.({
          message,
          stack: asString(frame.stack),
          filename: asString(frame.filename),
          line: asNumber(frame.line),
          at: now() - attachedAt,
        })
        return true
      }
      default:
        return false
    }
  }

  const attach: HostBridge['attach'] = (win, frame) => {
    const onMessage = (event: MessageEvent) => {
      const target = frame()
      // The sandboxed frame has an opaque origin, so the origin cannot be
      // checked — the nonce is the identity. The source window is a second
      // lock for the window we are actually showing.
      if (target?.contentWindow && event.source !== target.contentWindow) return
      handle(event.data)
    }
    win.addEventListener('message', onMessage)
    return () => win.removeEventListener('message', onMessage)
  }

  return { handle, attach }
}
