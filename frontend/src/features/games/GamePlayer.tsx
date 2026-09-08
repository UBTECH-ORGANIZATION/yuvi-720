/* The game player — the body of the game page (GamePage.tsx).
 *
 * A learner page like any other: platform theme, the app bar above it, a back
 * button that says where it goes. The game fills the stage; a small floating
 * HUD carries back / title / status / fullscreen. Yuvi's chat sits on the
 * right in the companion's own visual language, and it is ONE chat: a message
 * is either a change (it carries the runtime errors the frame reported, so
 * "the ship is stuck" and "make the ship faster" are the same ask) or a
 * question about the game, answered without a rebuild.
 *
 * While Yuvi builds, the stage turns into the build console: the code streams
 * in as it is written, the same way vibe-coding-kids shows it, and the chat
 * waits until the game is ready.
 *
 * The iframe is `srcdoc`, never `src`: without `allow-same-origin` the page
 * has an opaque origin and could not fetch itself with the session cookie, so
 * the parent fetches the served HTML (harness already injected) and hands it
 * over. The nonce inside that HTML is the only identity the bridge trusts.
 *
 * Runtime errors from the frame are kept (last 20). One that fires in the
 * first seconds after load is treated as "the game does not start" and sent
 * for a fix automatically, once per version.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useI18n } from '../../i18n/I18nProvider'
import { Icon } from '../../components/primitives'
import { YuviHeadIcon } from '../../components/YuviHeadIcon'
import { subscribe } from '../../services/realtime'
import { playCelebrationCheer } from '../../services/celebrationAudio'
import {
  askGame, checkAnswer, editGame, fetchGameHtml, getGame, getGameLive, isGameFrame, reportBug,
  type GameFrame, type GameStatus, type LearnerGame, type RuntimeErrorReport,
} from '../../services/games'
import { createHostBridge, parseNonce, type GameProgress, type GameRuntimeError } from './hostBridge'
import './games.css'

/** Errors kept for a bug report — the backend reads at most this many too. */
const MAX_ERRORS = 20
/** An error this soon after load means the game never started: fix it unasked. */
const AUTO_FIX_WINDOW_MS = 3000
/** How long the "updated" strip stays up. */
const TOAST_MS = 3200
/** The cheer at the end, and the banner that goes with it. */
const CHEER_MS = 1800
/** The live code view keeps this much of the tail; the rest scrolled by. */
const LIVE_CODE_MAX = 80_000
const THINK_TEXT_MAX = 12_000

type ChatMode = 'change' | 'ask'

interface PlayerJob {
  id: string
  kind: 'edit' | 'fix' | 'ask'
  /** What the learner wrote — or the auto-fix line when Yuvi started it. */
  text: string
  auto?: boolean
  status: 'queued' | 'running' | 'done' | 'failed' | 'capped'
  /** The finer build step when the worker reports one. */
  step?: string
  /** Yuvi's answer, for a question. */
  reply?: string
}

type BuildPhase = 'thinking' | 'writing' | 'validating' | 'judging'

interface GamePlayerProps {
  game: LearnerGame
  onBack: () => void
  /** Where "back" lands, so the button can say so: the studio shelf or the lesson. */
  backTo?: 'studio' | 'lesson'
}

let jobSeq = 0
const nextJobId = () => `job-${Date.now().toString(36)}-${++jobSeq}`

function statusOf(error: unknown): number {
  return (error as { status?: number } | null)?.status ?? 0
}

/** The streamed tool input is JSON text; undo the escapes so it reads as code. */
function unescapeJson(text: string): string {
  return text
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\')
}

/** The code argument of the tool input so far — the model may put the title
 * and the design brief before it, and those are not code. Until the `html`
 * (or `patches`) key has arrived there is nothing to show yet. */

export function GamePlayer({ game: initial, onBack, backTo = 'studio' }: GamePlayerProps) {
  const backLabel = backTo === 'lesson' ? 'games.player.backLesson' : 'games.player.back'
  const { t, direction } = useI18n()
  const stageRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<HTMLIFrameElement>(null)
  const codeRef = useRef<HTMLPreElement>(null)

  const [game, setGame] = useState<LearnerGame>(initial)
  const [status, setStatus] = useState<GameStatus>(initial.status)
  const [version, setVersion] = useState(initial.current_version)
  const [sparks, setSparks] = useState(initial.sparks_spent)
  const [html, setHtml] = useState<string | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [loadNonce, setLoadNonce] = useState(0)
  const nonce = useMemo(() => (html ? parseNonce(html) : null), [html])

  const [mode, setMode] = useState<ChatMode>('change')
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [jobs, setJobs] = useState<PlayerJob[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [leaveConfirm, setLeaveConfirm] = useState(false)
  const [finished, setFinished] = useState<GameProgress | null>(null)
  const [total, setTotal] = useState(0)
  const [errorCount, setErrorCount] = useState(0)
  const [liveCode, setLiveCode] = useState('')
  const rawRef = useRef('')
  const [liveStep, setLiveStep] = useState<string>('')
  const [thinkingChars, setThinkingChars] = useState(0)
  // Yuvi's reasoning as it streams, kept to a tail: the kid reads what Yuvi
  // is weighing, in the collapsible log, never on the stage.
  const [thinkingText, setThinkingText] = useState('')
  const thinkRef = useRef<HTMLDivElement>(null)
  const [phase, setPhase] = useState<BuildPhase>('thinking')
  const [startedAt, setStartedAt] = useState<number | null>(null)
  // What Yuvi did so far, one line per phase, for the collapsible log in the chat.
  const [buildLog, setBuildLog] = useState<{ phase: BuildPhase; at: number }[]>([])
  const [now, setNow] = useState(() => Date.now())
  const [isFull, setIsFull] = useState(false)

  const errorsRef = useRef<GameRuntimeError[]>([])
  const questionOpenRef = useRef(false)
  const autoFixedVersionRef = useRef<number | null>(null)
  const toastTimer = useRef<number | null>(null)
  const cheerStop = useRef<(() => void) | null>(null)
  const draftRef = useRef<HTMLInputElement>(null)

  const busy = status !== 'ready' && status !== 'failed'

  const showToast = useCallback((text: string) => {
    setToast(text)
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), TOAST_MS)
  }, [])

  // ── The page: fetched, never linked ────────────────────────────────────
  useEffect(() => {
    if (status !== 'ready') return
    let active = true
    setLoadError(false)
    setHtml(null)
    fetchGameHtml(game.game_id, version)
      .then((text) => { if (active) setHtml(text) })
      .catch(() => { if (active) setLoadError(true) })
    return () => { active = false }
  }, [game.game_id, version, status, loadNonce])

  // A new version is a new page: what broke before is not evidence now.
  useEffect(() => {
    errorsRef.current = []
    setErrorCount(0)
    questionOpenRef.current = false
    setFinished(null)
  }, [version, html])

  // The live code view follows the writing.
  useEffect(() => {
    const el = codeRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [liveCode])

  // A page opened mid-build catches up from the job's snapshot: the phase,
  // how long it has been thinking, and the code written so far.
  useEffect(() => {
    if (!busy) return
    let active = true
    getGameLive(game.game_id).then((live) => {
      if (!active || !live.active) return
      if (live.phase) setPhase(live.phase)
      setThinkingChars(live.thinking_chars ?? 0)
      if (live.thinking_tail) setThinkingText(live.thinking_tail)
      if (live.code_tail) { rawRef.current = live.code_tail; setLiveCode(live.code_tail) }
      const started = typeof live.started_at === 'number' ? live.started_at * 1000
        : live.started_at ? Date.parse(String(live.started_at)) : NaN
      setStartedAt(Number.isFinite(started) ? started : Date.now())
    }).catch(() => {})
    return () => { active = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, game.game_id])

  // The elapsed clock ticks while the build runs.
  useEffect(() => {
    if (!busy) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [busy])

  // Frames are the fast path; the snapshot is the truth. While a build runs
  // the page re-reads it every few seconds, so a dropped relay (Redis
  // hiccup, a laptop worker) still shows the phase, the clock and the code.
  useEffect(() => {
    if (!busy) return
    let active = true
    const tick = async () => {
      try {
        const live = await getGameLive(game.game_id)
        if (!active) return
        if (!live.active) {
          // The job ended and the "ready" frame never arrived: ask the row.
          const row = await getGame(game.game_id)
          if (!active) return
          setGame(row); setSparks(row.sparks_spent); setStatus(row.status)
          if (row.current_version > version) { setVersion(row.current_version); setLiveCode(''); showToast(t('games.player.updated')) }
          return
        }
        if (live.phase) setPhase(live.phase)
        if (typeof live.thinking_chars === 'number') setThinkingChars((current) => Math.max(current, live.thinking_chars ?? 0))
        if (live.thinking_tail) setThinkingText((current) => (live.thinking_tail!.length > current.length ? live.thinking_tail! : current))
        if (live.code_tail && live.code_tail.length > rawRef.current.length) {
          rawRef.current = live.code_tail
          setLiveCode(live.code_tail)
        }
      } catch { /* next tick */ }
    }
    const timer = window.setInterval(() => { void tick() }, 5000)
    return () => { active = false; window.clearInterval(timer) }
  }, [busy, game.game_id, version, showToast, t])

  useEffect(() => {
    const onChange = () => setIsFull(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  // ── The bridge ─────────────────────────────────────────────────────────
  const caughtErrors = (): RuntimeErrorReport[] => errorsRef.current.map((error) => ({
    message: error.message,
    ...(error.stack ? { stack: error.stack } : {}),
    ...(error.filename ? { filename: error.filename } : {}),
    ...(error.line != null ? { line: error.line } : {}),
  }))

  const submitBug = useCallback(async (note: string, auto: boolean) => {
    const errors = caughtErrors()
    const job: PlayerJob = {
      id: nextJobId(), kind: 'fix', auto, status: 'queued',
      text: auto ? t('games.bug.auto') : (note.trim() || t('games.bug.sent')),
    }
    setJobs((current) => [...current, job])
    setSending(true)
    try {
      await reportBug(game.game_id, errors, note.trim())
      setStatus('fixing')
    } catch (error) {
      const code = statusOf(error)
      setJobs((current) => current.map((row) =>
        row.id === job.id ? { ...row, status: code === 429 ? 'capped' : 'failed' } : row))
      setNotice(code === 429 ? t('games.bug.capReached')
        : code === 409 ? t('games.edit.busy') : t('games.edit.error'))
    } finally {
      setSending(false)
    }
  }, [game.game_id, t])

  useEffect(() => {
    if (!nonce) return
    const bridge = createHostBridge({
      nonce,
      check: (questionId, answer) => checkAnswer(game.game_id, questionId, answer),
      onReady: (count) => setTotal(count),
      onAsked: () => { questionOpenRef.current = true },
      onAnswered: () => { questionOpenRef.current = false },
      onDone: (progress) => {
        questionOpenRef.current = false
        setFinished(progress)
        cheerStop.current?.()
        cheerStop.current = playCelebrationCheer(CHEER_MS)
      },
      onError: (error) => {
        const kept = [...errorsRef.current, error].slice(-MAX_ERRORS)
        errorsRef.current = kept
        setErrorCount(kept.length)
        // The game did not even start: fix it before the child has to ask.
        // Once per version — the second attempt is the child's call.
        if (error.at <= AUTO_FIX_WINDOW_MS && autoFixedVersionRef.current !== version && status === 'ready') {
          autoFixedVersionRef.current = version
          void submitBug('', true)
        }
      },
    })
    return bridge.attach(window, () => frameRef.current)
  }, [nonce, game.game_id, version, status, submitBug])

  // ── Live status and code from the worker ───────────────────────────────
  useEffect(() => {
    return subscribe('learner-triggers', () => '/api/agent/triggers/subscribe', (frame) => {
      if (!isGameFrame(frame) || frame.game_id !== game.game_id) return
      const live = frame as GameFrame
      if (live.event === 'code' && live.chunk) {
        setPhase('writing')
        // The worker sends decoded code, and `reset` means "start over with
        // the complete game" (the deltas were partial; the hand-in is whole).
        const next = (live.reset ? '' : rawRef.current) + live.chunk
        rawRef.current = next.length > LIVE_CODE_MAX ? next.slice(next.length - LIVE_CODE_MAX) : next
        setLiveCode(rawRef.current)
        return
      }
      if (live.event === 'thinking') {
        setPhase('thinking')
        if (typeof live.thinking_chars === 'number') setThinkingChars(live.thinking_chars)
        if (live.chunk) setThinkingText((current) => (current + live.chunk).slice(-THINK_TEXT_MAX))
        return
      }
      if (live.event === 'validate' || live.event === 'validated') setPhase('validating')
      if (live.event === 'judge') setPhase('judging')
      if (live.event && live.event !== 'code') setLiveStep(live.event)
      if (live.status) setStatus(live.status)
      if (live.status === 'ready' && live.v > version) {
        setJobs((current) => current.map((row) =>
          row.status === 'queued' || row.status === 'running' ? { ...row, status: 'done' } : row))
        setVersion(live.v)
        setLiveCode('')
        rawRef.current = ''
        setNotice(null)
        showToast(t('games.player.updated'))
        // The brief, the thumbnail and what it cost live on the game row.
        getGame(game.game_id).then((row) => { setGame(row); setSparks(row.sparks_spent) }).catch(() => {})
        return
      }
      if (live.status === 'failed') {
        setJobs((current) => current.map((row) =>
          row.status === 'queued' || row.status === 'running' ? { ...row, status: 'failed' } : row))
        return
      }
      if (live.status && live.status !== 'ready') {
        setJobs((current) => current.map((row) =>
          row.status === 'queued' || row.status === 'running'
            ? { ...row, status: 'running', step: live.event } : row))
      }
    })
  }, [game.game_id, version, showToast, t])

  // ── The one chat ───────────────────────────────────────────────────────
  const submit = async () => {
    const text = draft.trim()
    if (sending || busy) return
    if (mode === 'ask') {
      if (!text) return
      const job: PlayerJob = { id: nextJobId(), kind: 'ask', text, status: 'running' }
      setJobs((current) => [...current, job])
      setDraft('')
      setSending(true)
      try {
        const { answer } = await askGame(game.game_id, text)
        setJobs((current) => current.map((row) => row.id === job.id ? { ...row, status: 'done', reply: answer } : row))
      } catch {
        setJobs((current) => current.map((row) => row.id === job.id ? { ...row, status: 'failed', reply: t('games.chat.askError') } : row))
      } finally {
        setSending(false)
      }
      return
    }
    // Words go as an edit that carries the caught errors; no words with
    // errors caught is a plain fix request.
    if (!text) { if (errorCount > 0) await submitBug('', false); return }
    const job: PlayerJob = { id: nextJobId(), kind: 'edit', text, status: 'queued' }
    setJobs((current) => [...current, job])
    setDraft('')
    setNotice(null)
    setSending(true)
    try {
      await editGame(game.game_id, text, caughtErrors())
      setStatus('building')
      setLiveCode('')
      rawRef.current = ''
      setThinkingChars(0)
      setThinkingText('')
      setPhase('thinking')
      setStartedAt(Date.now())
    } catch (error) {
      const code = statusOf(error)
      setJobs((current) => current.map((row) =>
        row.id === job.id ? { ...row, status: code === 429 ? 'capped' : 'failed' } : row))
      setNotice(code === 429 ? t('games.edit.capReached')
        : code === 409 ? t('games.edit.busy') : t('games.edit.error'))
      // Refused words come back to the box: retyping them is the wrong cost.
      setDraft(text)
    } finally {
      setSending(false)
    }
  }

  // ── Leaving, fullscreen ────────────────────────────────────────────────
  const requestBack = useCallback(() => {
    if (questionOpenRef.current && !finished) { setLeaveConfirm(true); return }
    onBack()
  }, [finished, onBack])

  const toggleFullscreen = () => {
    if (document.fullscreenElement) { void document.exitFullscreen(); return }
    void stageRef.current?.requestFullscreen?.()
  }

  useEffect(() => () => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
    cheerStop.current?.()
    if (document.fullscreenElement) void document.exitFullscreen()
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && leaveConfirm) { event.preventDefault(); setLeaveConfirm(false) }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [leaveConfirm])

  const jobLine = (job: PlayerJob) => {
    if (job.status === 'capped') return job.kind === 'fix' ? t('games.bug.capReached') : t('games.edit.capReached')
    if (job.status === 'failed') return t('games.edit.failed')
    if (job.status === 'done') return t('games.edit.done')
    if (job.status === 'running') {
      const stepKey = job.step ? `games.step.${job.step}` : ''
      const step = stepKey ? t(stepKey) : ''
      return step && step !== stepKey ? step : t('games.edit.running')
    }
    return t('games.edit.queued')
  }

  const stepLabel = (() => {
    const key = liveStep ? `games.step.${liveStep}` : ''
    const text = key ? t(key) : ''
    return text && text !== key ? text : t(`games.status.${status}`)
  })()
  const codeLines = liveCode ? liveCode.split('\n').length : 0
  useEffect(() => {
    if (!busy) return
    setBuildLog((current) => (current.length && current[current.length - 1].phase === phase)
      ? current
      : [...current, { phase, at: Date.now() }])
  }, [busy, phase])
  useEffect(() => { if (!busy) setBuildLog([]) }, [busy])
  useEffect(() => {
    const box = thinkRef.current
    if (box) box.scrollTop = box.scrollHeight
  }, [thinkingText])

  const elapsedMin = startedAt ? Math.max(0, Math.floor((now - startedAt) / 60000)) : 0
  const elapsedSec = startedAt ? Math.max(0, Math.floor((now - startedAt) / 1000) % 60) : 0
  const thinkingWords = Math.round(thinkingChars / 5)
  const canSend = !busy && !sending && (draft.trim().length > 0 || (mode === 'change' && errorCount > 0))
  const fullLabel = isFull ? t('games.player.exitFullscreen') : t('games.player.fullscreen')
  // One short figure beside the phase in the collapsed log: thought words while
  // thinking, code lines while writing, nothing otherwise.
  const buildStat = phase === 'thinking' && thinkingWords > 0 ? t('games.build.words', { count: thinkingWords })
    : phase === 'writing' && codeLines > 0 ? t('games.build.lines', { count: codeLines })
    : ''
  const clock = (at: number) => {
    const base = startedAt ?? at
    const secs = Math.max(0, Math.floor((at - base) / 1000))
    return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`
  }

  return (
    <main className="game-player" dir={direction} aria-label={game.title}>
      <div ref={stageRef} className={`game-player__stage${isFull ? ' is-fullscreen' : ''}`}>
        {busy ? (
          <section className="game-player__build" aria-live="polite">
            <header className="game-player__build-head">
              <span className="game-player__pulse" aria-hidden="true" />
              <strong>{t('games.build.title')}</strong>
              <span className="game-player__build-step">{stepLabel}</span>
              <span className="game-player__build-lines">
                {startedAt ? t('games.build.elapsed', { min: elapsedMin, sec: String(elapsedSec).padStart(2, '0') }) : ''}
                {codeLines > 0 ? ` · ${t('games.build.lines', { count: codeLines })}` : ''}
              </span>
            </header>
            {/* Thinking is invisible work: a pulse and a count, never the
                reasoning itself. The code takes over the moment it starts. */}
            {!liveCode && (
              <div className={`game-player__thinking is-${phase}`} dir="auto">
                <span className="game-player__bot" aria-hidden="true">
                  <i className="game-player__bot-ring" />
                  <i className="game-player__bot-orbit"><b /></i>
                  <i className="game-player__bot-orbit is-second"><b /></i>
                  <span className="game-player__bot-face"><YuviHeadIcon /></span>
                </span>
                <strong>{t(`games.build.phase.${phase}`)}</strong>
              </div>
            )}
            <pre ref={codeRef} className="game-player__code" dir="ltr" aria-label={t('games.build.title')} hidden={!liveCode}>
              {liveCode}
            </pre>
          </section>
        ) : status === 'ready' && html ? (
          <iframe
            key={`${version}:${loadNonce}`}
            ref={frameRef}
            className="game-player__frame"
            title={game.title}
            sandbox="allow-scripts allow-pointer-lock"
            srcDoc={html}
          />
        ) : status === 'failed' ? (
          <div className="game-player__state" role="alert">
            <Icon name="alert" size={30} />
            <p>{t('games.player.failed')}</p>
          </div>
        ) : loadError ? (
          <div className="game-player__state" role="alert">
            <Icon name="alert" size={30} />
            <p>{t('games.player.loadError')}</p>
            <button type="button" className="sp-btn" onClick={() => setLoadNonce((value) => value + 1)}>
              {t('games.player.retry')}
            </button>
          </div>
        ) : (
          <div className="game-player__state" role="status" aria-live="polite">
            <span className="game-player__spinner" aria-hidden="true" />
            <p>{t('games.player.loading')}</p>
          </div>
        )}

        <div className="game-player__hud">
          <button type="button" className="game-player__back" onClick={requestBack}>
            <Icon name="chevronLeft" size={16} />
            <span>{t(backLabel)}</span>
          </button>
          <span className="game-player__hud-title" dir="auto">{game.title}</span>
          {busy && (
            <span className="game-player__hud-status" role="status">
              <span className="game-player__pulse" aria-hidden="true" />
              {t(`games.status.${status}`)}
            </span>
          )}
          <button
            type="button"
            className="game-player__hud-btn game-player__full"
            onClick={toggleFullscreen}
            aria-pressed={isFull}
            aria-label={fullLabel}
            data-tooltip={fullLabel}
          >
            <Icon name={isFull ? 'collapse' : 'expand'} size={18} />
          </button>
        </div>

        {finished && (
          <div className="game-player__done" role="status">
            <Icon name="spark" size={22} aria-hidden="true" />
            <strong>{t('games.player.done')}</strong>
            <span>{t('games.player.doneScore', { correct: finished.correct, total: total || finished.answered })}</span>
            <button type="button" className="sp-btn sp-btn--primary" onClick={onBack}>{t(backLabel)}</button>
          </div>
        )}

        {toast && (
          <div className="game-player__toast" role="status">
            <Icon name="check" size={15} aria-hidden="true" />
            {toast}
          </div>
        )}

        {leaveConfirm && (
          <div className="game-player__confirm" role="alertdialog" aria-label={t('games.player.leaveTitle')}>
            <div className="game-player__confirm-card">
              <p className="game-player__confirm-title">{t('games.player.leaveTitle')}</p>
              <p className="game-player__confirm-body">{t('games.player.leaveBody')}</p>
              <div className="game-player__confirm-actions">
                <button type="button" className="sp-btn sp-btn--primary" onClick={() => setLeaveConfirm(false)} autoFocus>
                  {t('games.player.leaveNo')}
                </button>
                <button type="button" className="sp-btn" onClick={onBack}>
                  {t('games.player.leaveYes')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <aside className="game-chat" aria-label={t('games.player.chat.label')}>
        <header className="game-chat__head">
          <span className="game-chat__avatar" aria-hidden="true"><YuviHeadIcon /></span>
          <div className="game-chat__id">
            <strong dir="auto">{t('games.chat.title')}</strong>
            <span className="game-chat__meta">
              <Icon name="spark" size={12} aria-hidden="true" />
              {t('games.card.sparks', { count: sparks })}
            </span>
          </div>
        </header>

        <div className="game-chat__thread" role="log" aria-live="polite" aria-relevant="additions text">
          {game.description && (
            <div className="game-chat__msg game-chat__msg--yuvi game-chat__msg--brief" dir="auto">{game.description}</div>
          )}
          {busy ? (
            <details className="game-chat__msg game-chat__msg--yuvi game-chat__log" dir="auto">
              <summary>
                <span className="game-chat__log-orb" aria-hidden="true" />
                <strong>{t(`games.build.phase.${phase}`)}</strong>
                <span className="game-chat__log-stat">{buildStat}</span>
                <Icon name="chevronDown" size={14} />
              </summary>
              {thinkingText ? (
                <div ref={thinkRef} className="game-chat__log-think" dir="auto" aria-label={t('games.build.phase.thinking')}>
                  {thinkingText}
                </div>
              ) : (
                <p className="game-chat__log-detail">
                  {phase === 'writing' ? (liveCode ? t('games.build.lines', { count: codeLines }) : t('games.build.writingBrief'))
                    : phase === 'thinking' ? t('games.build.waiting')
                    : t(`games.build.phase.${phase}`)}
                </p>
              )}
              <ol className="game-chat__log-steps">
                {buildLog.map((entry) => (
                  <li key={`${entry.phase}-${entry.at}`}>
                    <time>{clock(entry.at)}</time>
                    <span>{t(`games.build.phase.${entry.phase}`)}</span>
                  </li>
                ))}
              </ol>
              <p className="game-chat__log-foot">{t('games.chat.building')}</p>
            </details>
          ) : jobs.length === 0 && (
            <div className="game-chat__msg game-chat__msg--yuvi game-chat__msg--hint" dir="auto">{t('games.chat.hint')}</div>
          )}
          {jobs.map((job) => (
            <div key={job.id} className={`game-chat__job is-${job.status}${job.auto ? ' is-auto' : ''}`}>
              {!job.auto && <div className="game-chat__msg game-chat__msg--you" dir="auto">{job.text}</div>}
              <div className="game-chat__msg game-chat__msg--yuvi" dir="auto">
                {job.kind === 'ask'
                  ? (job.reply ?? t('games.chat.thinking'))
                  : job.auto ? job.text : jobLine(job)}
                {(job.status === 'queued' || job.status === 'running') && (
                  <span className="game-chat__dots" aria-hidden="true"><i /><i /><i /></span>
                )}
                {job.auto && job.status !== 'queued' && job.status !== 'running' && ` ${jobLine(job)}`}
              </div>
            </div>
          ))}
          {notice && <p className="game-chat__notice" role="status" dir="auto">{notice}</p>}
        </div>

        <form className="game-chat__composer-shell" onSubmit={(event) => { event.preventDefault(); void submit() }}>
          <div className="game-chat__modes" role="radiogroup" aria-label={t('games.chat.mode.label')}>
            {(['change', 'ask'] as ChatMode[]).map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={mode === option}
                className={`game-chat__mode${mode === option ? ' is-active' : ''}`}
                onClick={() => setMode(option)}
                disabled={busy}
              >
                <Icon name={option === 'change' ? 'wand' : 'help'} size={13} aria-hidden="true" />
                {t(`games.chat.mode.${option}`)}
              </button>
            ))}
            {mode === 'change' && errorCount > 0 && !busy && (
              <small className="game-chat__caught" dir="auto">
                <Icon name="alert" size={12} aria-hidden="true" />
                {t('games.chat.errorsAttached', { count: errorCount })}
              </small>
            )}
          </div>
          <div className="game-chat__composer">
            <input
              ref={draftRef}
              type="text"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={busy ? t('games.chat.building') : mode === 'ask' ? t('games.chat.askPlaceholder') : t('games.chat.placeholder')}
              aria-label={mode === 'ask' ? t('games.chat.askPlaceholder') : t('games.chat.placeholder')}
              dir={draft.trim() ? 'auto' : direction}
              disabled={busy}
              maxLength={600}
            />
            <button
              type="submit"
              className="game-chat__send"
              disabled={!canSend}
              aria-label={mode === 'ask' ? t('games.chat.mode.ask') : draft.trim() ? t('games.edit.send') : t('games.chat.fixOnly')}
            >
              <Icon name="send" size={17} />
            </button>
          </div>
        </form>
      </aside>
    </main>
  )
}
