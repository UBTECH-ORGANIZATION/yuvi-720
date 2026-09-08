/* The full-screen game overlay.
 *
 * Three things on the screen: a slim bar (which game, which lesson, what it
 * cost, how to leave), the game itself in a sandboxed iframe, and Yuvi's edit
 * panel — a small chat where the learner says what should change, a "something
 * is broken" button, and the live status of whatever job that started.
 *
 * The iframe is `srcdoc`, never `src`: without `allow-same-origin` the page
 * has an opaque origin and could not fetch itself with the session cookie, so
 * the parent fetches the served HTML (harness already injected) and hands it
 * over. The nonce inside that HTML is the only identity the bridge trusts.
 *
 * Runtime errors from the frame are kept (last 20). One that fires in the
 * first seconds after load is treated as "the game does not start" and sent
 * for a fix automatically, once per version — the backend caps fixes at two
 * per version and says so with a 429, which the panel shows as a sentence
 * rather than a failure.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useI18n } from '../../i18n/I18nProvider'
import { useResponsive } from '../../hooks/useResponsive'
import { Icon } from '../../components/primitives'
import { subscribe } from '../../services/realtime'
import { playCelebrationCheer } from '../../services/celebrationAudio'
import {
  checkAnswer, editGame, fetchGameHtml, isGameFrame, reportBug,
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

export type PlayerPanel = 'edit' | 'bug'

interface PlayerJob {
  id: string
  kind: 'edit' | 'fix'
  /** What the learner wrote — or the auto-fix line when Yuvi started it. */
  text: string
  auto?: boolean
  status: 'queued' | 'running' | 'done' | 'failed' | 'capped'
  /** The finer build step when the worker reports one. */
  step?: string
}

interface GamePlayerProps {
  game: LearnerGame
  onClose: () => void
  /** Open with the side panel showing this form. */
  initialPanel?: PlayerPanel | null
  /** The list behind the overlay keeps its card current. */
  onGameChange?: (next: Partial<LearnerGame> & { game_id: string }) => void
}

const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], iframe, [tabindex]:not([tabindex="-1"])'

let jobSeq = 0
const nextJobId = () => `job-${Date.now().toString(36)}-${++jobSeq}`

function statusOf(error: unknown): number {
  return (error as { status?: number } | null)?.status ?? 0
}

export function GamePlayer({ game, onClose, initialPanel = null, onGameChange }: GamePlayerProps) {
  const { t, direction } = useI18n()
  const { isCompact } = useResponsive()
  const rootRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<HTMLIFrameElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)

  const [status, setStatus] = useState<GameStatus>(game.status)
  const [version, setVersion] = useState(game.current_version)
  const [sparks, setSparks] = useState(game.sparks_spent)
  const [html, setHtml] = useState<string | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [loadNonce, setLoadNonce] = useState(0)
  const nonce = useMemo(() => (html ? parseNonce(html) : null), [html])

  const [panelOpen, setPanelOpen] = useState(() => !isCompact || initialPanel !== null)
  const [panel, setPanel] = useState<PlayerPanel>(initialPanel ?? 'edit')
  const [draft, setDraft] = useState('')
  const [bugNote, setBugNote] = useState('')
  const [sending, setSending] = useState(false)
  const [jobs, setJobs] = useState<PlayerJob[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [leaveConfirm, setLeaveConfirm] = useState(false)
  const [finished, setFinished] = useState<GameProgress | null>(null)
  const [total, setTotal] = useState(0)
  const [errorCount, setErrorCount] = useState(0)

  const errorsRef = useRef<GameRuntimeError[]>([])
  const questionOpenRef = useRef(false)
  const autoFixedVersionRef = useRef<number | null>(null)
  const toastTimer = useRef<number | null>(null)
  const cheerStop = useRef<(() => void) | null>(null)
  const draftRef = useRef<HTMLTextAreaElement>(null)

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

  // ── The bridge ─────────────────────────────────────────────────────────
  const submitBug = useCallback(async (note: string, auto: boolean) => {
    const errors: RuntimeErrorReport[] = errorsRef.current.map((error) => ({
      message: error.message,
      ...(error.stack ? { stack: error.stack } : {}),
      ...(error.filename ? { filename: error.filename } : {}),
      ...(error.line != null ? { line: error.line } : {}),
    }))
    const job: PlayerJob = {
      id: nextJobId(), kind: 'fix', auto, status: 'queued',
      text: auto ? t('games.bug.auto') : (note.trim() || t('games.bug.sent')),
    }
    setJobs((current) => [...current, job])
    setSending(true)
    try {
      await reportBug(game.game_id, errors, note.trim())
      setStatus('fixing')
      onGameChange?.({ game_id: game.game_id, status: 'fixing' })
    } catch (error) {
      const code = statusOf(error)
      setJobs((current) => current.map((row) =>
        row.id === job.id ? { ...row, status: code === 429 ? 'capped' : 'failed' } : row))
      setNotice(code === 429 ? t('games.bug.capReached')
        : code === 409 ? t('games.edit.busy') : t('games.edit.error'))
    } finally {
      setSending(false)
    }
  }, [game.game_id, onGameChange, t])

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
          setPanelOpen(true)
          void submitBug('', true)
        }
      },
    })
    return bridge.attach(window, () => frameRef.current)
  }, [nonce, game.game_id, version, status, submitBug])

  // ── Live status from the worker ────────────────────────────────────────
  useEffect(() => {
    return subscribe('learner-triggers', () => '/api/agent/triggers/subscribe', (frame) => {
      if (!isGameFrame(frame) || frame.game_id !== game.game_id) return
      const live = frame as GameFrame
      if (live.status) {
        setStatus(live.status)
        onGameChange?.({ game_id: game.game_id, status: live.status, current_version: live.v })
      }
      if (live.status === 'ready' && live.v > version) {
        setJobs((current) => current.map((row) =>
          row.status === 'queued' || row.status === 'running' ? { ...row, status: 'done' } : row))
        setVersion(live.v)
        setNotice(null)
        showToast(t('games.player.updated'))
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
  }, [game.game_id, version, onGameChange, showToast, t])

  // ── Edit chat ──────────────────────────────────────────────────────────
  const submitEdit = async () => {
    const text = draft.trim()
    if (!text || sending) return
    const job: PlayerJob = { id: nextJobId(), kind: 'edit', text, status: 'queued' }
    setJobs((current) => [...current, job])
    setDraft('')
    setNotice(null)
    setSending(true)
    try {
      await editGame(game.game_id, text)
      setStatus('building')
      onGameChange?.({ game_id: game.game_id, status: 'building' })
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

  // ── Leaving ────────────────────────────────────────────────────────────
  const requestClose = useCallback(() => {
    if (questionOpenRef.current && !finished) { setLeaveConfirm(true); return }
    onClose()
  }, [finished, onClose])

  useEffect(() => {
    document.body.classList.add('is-game-fullscreen')
    returnFocusRef.current = document.activeElement as HTMLElement | null
    rootRef.current?.focus()
    return () => {
      document.body.classList.remove('is-game-fullscreen')
      returnFocusRef.current?.focus?.()
      if (toastTimer.current) window.clearTimeout(toastTimer.current)
      cheerStop.current?.()
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        if (leaveConfirm) setLeaveConfirm(false)
        else requestClose()
        return
      }
      if (event.key !== 'Tab' || !rootRef.current) return
      const items = [...rootRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)]
      if (!items.length) return
      const first = items[0]
      const last = items[items.length - 1]
      // The iframe swallows focus once inside it; the trap only turns the ends.
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [leaveConfirm, requestClose])

  useEffect(() => {
    if (panelOpen && panel === 'edit' && initialPanel) draftRef.current?.focus()
    // Only on the first paint of the panel the caller asked for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const busy = status !== 'ready' && status !== 'failed'
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

  const panelToggleLabel = panelOpen ? t('games.player.panelClose') : t('games.player.panelOpen')

  return createPortal(
    <div
      ref={rootRef}
      className={`game-player${panelOpen ? ' is-panel-open' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={game.title}
      tabIndex={-1}
      dir={direction}
    >
      <header className="game-player__bar">
        <button
          type="button"
          className="game-player__exit"
          onClick={requestClose}
          aria-label={t('games.player.exit')}
          data-tooltip={t('games.player.exit')}
        >
          <Icon name="close" size={18} />
        </button>
        <div className="game-player__id">
          <strong className="game-player__title" dir="auto">{game.title}</strong>
          <span className="game-player__chip" dir="auto">
            <Icon name="book" size={13} aria-hidden="true" />
            {game.component_title}
          </span>
        </div>
        <div className="game-player__meta">
          <span className="game-player__chip" title={t('games.card.sparks', { count: sparks })}>
            <Icon name="spark" size={13} aria-hidden="true" />
            {sparks}
          </span>
          <span className="game-player__chip">{t('games.card.version', { v: version })}</span>
          {busy && (
            <span className="game-player__chip is-busy" role="status">
              <span className="game-player__pulse" aria-hidden="true" />
              {t(`games.status.${status}`)}
            </span>
          )}
          <button
            type="button"
            className={`game-player__panel-toggle${panelOpen ? ' is-active' : ''}`}
            onClick={() => setPanelOpen((value) => !value)}
            aria-expanded={panelOpen}
            aria-controls="game-player-panel"
            aria-label={panelToggleLabel}
            data-tooltip={panelToggleLabel}
          >
            <Icon name="wand" size={18} />
          </button>
        </div>
      </header>

      <div className="game-player__stage">
        {status === 'ready' && html ? (
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
            <button type="button" className="game-player__btn" onClick={() => setLoadNonce((value) => value + 1)}>
              {t('games.player.retry')}
            </button>
          </div>
        ) : (
          <div className="game-player__state" role="status" aria-live="polite">
            <span className="game-player__spinner" aria-hidden="true" />
            <p>{busy ? t(`games.status.${status}`) : t('games.player.loading')}</p>
          </div>
        )}

        {finished && (
          <div className="game-player__done" role="status">
            <Icon name="spark" size={22} aria-hidden="true" />
            <strong>{t('games.player.done')}</strong>
            <span>{t('games.player.doneScore', { correct: finished.correct, total: total || finished.answered })}</span>
            <button type="button" className="game-player__btn" onClick={onClose}>{t('games.player.exit')}</button>
          </div>
        )}

        {toast && (
          <div className="game-player__toast" role="status">
            <Icon name="check" size={15} aria-hidden="true" />
            {toast}
          </div>
        )}
      </div>

      <aside
        id="game-player-panel"
        className="game-player__panel"
        aria-label={t('games.player.chat.label')}
        hidden={!panelOpen}
      >
        <div className="game-player__panel-tabs" role="tablist" aria-label={t('games.player.chat.label')}>
          <button
            type="button"
            role="tab"
            aria-selected={panel === 'edit'}
            className={panel === 'edit' ? 'is-active' : ''}
            onClick={() => setPanel('edit')}
          >
            <Icon name="wand" size={15} />
            <span>{t('games.edit.title')}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={panel === 'bug'}
            className={panel === 'bug' ? 'is-active' : ''}
            onClick={() => setPanel('bug')}
          >
            <Icon name="alert" size={15} />
            <span>{t('games.bug.button')}</span>
            {errorCount > 0 && <em className="game-player__count" aria-hidden="true">{errorCount}</em>}
          </button>
        </div>

        <div className="game-player__thread" role="log" aria-live="polite" aria-relevant="additions text">
          {jobs.length === 0 && (
            <p className="game-player__hint" dir="auto">
              {panel === 'bug' ? t('games.bug.title') : t('games.edit.placeholder')}
            </p>
          )}
          {jobs.map((job) => (
            <div key={job.id} className={`game-player__job is-${job.status}${job.auto ? ' is-auto' : ''}`}>
              {!job.auto && <p className="game-player__bubble game-player__bubble--you" dir="auto">{job.text}</p>}
              <p className="game-player__bubble game-player__bubble--yuvi" dir="auto">
                {job.auto ? job.text : jobLine(job)}
                {(job.status === 'queued' || job.status === 'running') && (
                  <span className="game-player__dots" aria-hidden="true"><i /><i /><i /></span>
                )}
                {job.auto && job.status !== 'queued' && job.status !== 'running' && ` ${jobLine(job)}`}
              </p>
            </div>
          ))}
          {notice && <p className="game-player__notice" role="status" dir="auto">{notice}</p>}
        </div>

        {panel === 'edit' ? (
          <form
            className="game-player__composer"
            onSubmit={(event) => { event.preventDefault(); void submitEdit() }}
          >
            <textarea
              ref={draftRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={t('games.edit.placeholder')}
              aria-label={t('games.edit.placeholder')}
              rows={2}
              dir={draft.trim() ? 'auto' : direction}
              disabled={busy}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void submitEdit() }
              }}
            />
            <button
              type="submit"
              className="game-player__btn game-player__btn--send"
              disabled={busy || sending || !draft.trim()}
              aria-label={t('games.edit.send')}
              data-tooltip={t('games.edit.send')}
            >
              <Icon name="send" size={17} />
            </button>
          </form>
        ) : (
          <form
            className="game-player__composer game-player__composer--bug"
            onSubmit={(event) => { event.preventDefault(); void submitBug(bugNote, false); setBugNote('') }}
          >
            <textarea
              value={bugNote}
              onChange={(event) => setBugNote(event.target.value)}
              placeholder={t('games.bug.placeholder')}
              aria-label={t('games.bug.placeholder')}
              rows={2}
              dir={bugNote.trim() ? 'auto' : direction}
              disabled={busy}
            />
            <div className="game-player__composer-row">
              <small className="game-player__caught">
                {errorCount > 0 ? t('games.bug.errorsCaught', { count: errorCount }) : ''}
              </small>
              <button type="submit" className="game-player__btn" disabled={busy || sending}>
                <Icon name="alert" size={15} aria-hidden="true" />
                {t('games.bug.send')}
              </button>
            </div>
          </form>
        )}
      </aside>

      {leaveConfirm && (
        <div className="game-player__confirm" role="alertdialog" aria-label={t('games.player.leaveTitle')}>
          <div className="game-player__confirm-card">
            <p className="game-player__confirm-title">{t('games.player.leaveTitle')}</p>
            <p className="game-player__confirm-body">{t('games.player.leaveBody')}</p>
            <div className="game-player__confirm-actions">
              <button type="button" className="game-player__btn" onClick={() => setLeaveConfirm(false)} autoFocus>
                {t('games.player.leaveNo')}
              </button>
              <button type="button" className="game-player__btn game-player__btn--quiet" onClick={onClose}>
                {t('games.player.leaveYes')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body,
  )
}
