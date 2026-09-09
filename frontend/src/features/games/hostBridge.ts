/* The parent half of the game harness protocol.
 *
 * The served HTML carries `workers/game_gen/harness/yuvi_learn.js` and
 * `error_reporter.js`; both talk to us with `postMessage` frames shaped
 * `{source:'yuvi-game', type, nonce, ...}`. The nonce is minted per render and
 * written into the page as `window.__YUVI_NONCE`, so a frame that does not
 * carry it did not come from the game we are showing — another tab's game, a
 * stale iframe mid-swap, or anything else on the page that shouts at `window`.
 *
 * Grading is server-side: `learn.answer` becomes `/api/games/{id}/check` and
 * the verdict goes back as `learn.answer.result`. The harness gives up after
 * 8 s, so a failed call answers `{correct:false, feedback:'error'}` at once
 * rather than letting the game sit on a spinner for the full timeout.
 *
 * Pure by design (no DOM at module level): `handle` takes the frame and a
 * `reply`, and `attach` is the thin window binding — so the nonce filter and
 * the answer round trip can be tested under `node --test`.
 */

export const GAME_SOURCE = 'yuvi-game'
export const HOST_SOURCE = 'yuvi-host'

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

export interface CheckResult {
  correct: boolean
  correct_answer: string | null
  feedback: string | null
}

export interface HostAnswerReply {
  source: typeof HOST_SOURCE
  type: 'learn.answer.result'
  requestId: string
  correct: boolean
  correctAnswer?: string
  feedback?: string
}

export interface HostNextReply {
  source: typeof HOST_SOURCE
  type: 'learn.next.result'
  requestId: string
  question: unknown | null
}

export type HostReply = HostAnswerReply | HostNextReply

export interface HostBridgeOptions {
  nonce: string
  /** `checkAnswer(gameId, …)` with the game already bound. */
  check: (questionId: string, answer: string | number) => Promise<CheckResult>
  /** `nextQuestion(gameId, …)` bound to the game; blueprint games only. */
  next?: (runId: string, index: number) => Promise<unknown | null>
  onReady?: (total: number) => void
  onAsked?: (questionId: string, index: number) => void
  onAnswered?: (questionId: string, correct: boolean) => void
  onDone?: (progress: GameProgress, summary: unknown) => void
  onError?: (error: GameRuntimeError) => void
  /** Clock for `GameRuntimeError.at`; injectable for tests. */
  now?: () => number
}

export interface HostBridge {
  /** Feed one `message` payload. Returns true when it was ours and handled. */
  handle: (data: unknown, reply: (message: HostReply) => void) => boolean
  /** Bind to a window and the iframe to answer; returns the detach function. */
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

export function createHostBridge(options: HostBridgeOptions): HostBridge {
  const now = options.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()))
  const attachedAt = now()

  const handle: HostBridge['handle'] = (data, reply) => {
    if (!data || typeof data !== 'object') return false
    const frame = data as Record<string, unknown>
    if (frame.source !== GAME_SOURCE) return false
    if (!options.nonce || frame.nonce !== options.nonce) return false

    switch (frame.type) {
      case 'ready':
        options.onReady?.(asNumber(frame.total) ?? 0)
        return true
      case 'learn.asked':
        options.onAsked?.(asString(frame.questionId) ?? '', asNumber(frame.index) ?? 0)
        return true
      case 'learn.answered':
        options.onAnswered?.(asString(frame.questionId) ?? '', frame.correct === true)
        return true
      case 'learn.done': {
        const progress = (frame.progress && typeof frame.progress === 'object'
          ? frame.progress : {}) as Partial<GameProgress>
        options.onDone?.({
          asked: progress.asked ?? 0,
          answered: progress.answered ?? 0,
          correct: progress.correct ?? 0,
        }, frame.summary ?? null)
        return true
      }
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
      case 'learn.next': {
        const requestId = asString(frame.requestId)
        if (!requestId) return true
        const runId = asString(frame.runId) ?? 'run'
        const index = asNumber(frame.index) ?? 0
        const draw = options.next ? options.next(runId, index) : Promise.resolve(null)
        draw
          .then((question) => reply({ source: HOST_SOURCE, type: 'learn.next.result', requestId, question }))
          .catch(() => reply({ source: HOST_SOURCE, type: 'learn.next.result', requestId, question: null }))
        return true
      }
      case 'learn.answer': {
        const requestId = asString(frame.requestId)
        if (!requestId) return true
        const questionId = asString(frame.questionId) ?? ''
        const answer = typeof frame.answer === 'number' ? frame.answer : String(frame.answer ?? '')
        options.check(questionId, answer)
          .then((result) => reply({
            source: HOST_SOURCE,
            type: 'learn.answer.result',
            requestId,
            correct: result.correct === true,
            correctAnswer: result.correct_answer ?? undefined,
            feedback: result.feedback ?? undefined,
          }))
          .catch(() => reply({
            source: HOST_SOURCE,
            type: 'learn.answer.result',
            requestId,
            correct: false,
            feedback: 'error',
          }))
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
      handle(event.data, (message) => {
        try {
          frame()?.contentWindow?.postMessage(message, '*')
        } catch {
          /* the frame went away mid-answer — nothing to tell */
        }
      })
    }
    win.addEventListener('message', onMessage)
    return () => win.removeEventListener('message', onMessage)
  }

  return { handle, attach }
}
