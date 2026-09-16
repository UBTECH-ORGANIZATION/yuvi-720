/* The playable game itself: the sandboxed iframe, its loading and retry
 * states, and the host bridge that hears what the game reports.
 *
 * Shared by the game page's player (GamePlayer.tsx, which adds the build
 * console and Yuvi's chat around it) and the lesson chat's dialog
 * (GameDialog.tsx, which adds only a header).
 *
 * The iframe is `srcdoc`, never `src`: without `allow-same-origin` the page
 * has an opaque origin and could not fetch itself with the session cookie, so
 * the parent fetches the served HTML (harness already injected) and hands it
 * over. The nonce inside that HTML is the only identity the bridge trusts.
 * The frame takes keyboard focus as soon as it loads, so arrow keys drive the
 * game and not the page behind it.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useI18n } from '../../i18n/I18nProvider'
import { Icon } from '../../components/primitives'
import { fetchGameHtml } from '../../services/games'
import { createHostBridge, parseNonce, type GameProgress, type GameRuntimeError } from './hostBridge'
import './games.css'

export interface GamePlayerFrameProps {
  gameId: string
  version: number
  title: string
  onError?: (error: GameRuntimeError) => void
  onDone?: (progress: GameProgress) => void
  onAsked?: () => void
  onAnswered?: () => void
  /** A fresh page is in the frame: first load, a new version, a retry. */
  onPageLoaded?: () => void
}

export function GamePlayerFrame({
  gameId, version, title, onError, onDone, onAsked, onAnswered, onPageLoaded,
}: GamePlayerFrameProps) {
  const { t } = useI18n()
  const frameRef = useRef<HTMLIFrameElement>(null)
  const [html, setHtml] = useState<string | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [loadNonce, setLoadNonce] = useState(0)
  const nonce = useMemo(() => (html ? parseNonce(html) : null), [html])

  // The latest handlers, so the bridge attaches once per page and still calls
  // whatever the host means today (the host's closures move with its state).
  const handlers = useRef({ onError, onDone, onAsked, onAnswered, onPageLoaded })
  handlers.current = { onError, onDone, onAsked, onAnswered, onPageLoaded }

  // ── The page: fetched, never linked ────────────────────────────────────
  useEffect(() => {
    let active = true
    setLoadError(false)
    setHtml(null)
    fetchGameHtml(gameId, version)
      .then((text) => { if (active) setHtml(text) })
      .catch(() => { if (active) setLoadError(true) })
    return () => { active = false }
  }, [gameId, version, loadNonce])

  useEffect(() => {
    if (html) handlers.current.onPageLoaded?.()
  }, [html])

  // ── The bridge ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!nonce) return
    const bridge = createHostBridge({
      nonce,
      onAsked: () => handlers.current.onAsked?.(),
      onAnswered: () => handlers.current.onAnswered?.(),
      onDone: (progress) => handlers.current.onDone?.(progress),
      onError: (error) => handlers.current.onError?.(error),
    })
    return bridge.attach(window, () => frameRef.current)
  }, [nonce, gameId, version])

  if (loadError) {
    return (
      <div className="game-player__state" role="alert">
        <Icon name="alert" size={30} />
        <p>{t('games.player.loadError')}</p>
        <button type="button" className="sp-btn" onClick={() => setLoadNonce((value) => value + 1)}>
          {t('games.player.retry')}
        </button>
      </div>
    )
  }
  if (!html) {
    return (
      <div className="game-player__state" role="status" aria-live="polite">
        <span className="game-player__spinner" aria-hidden="true" />
        <p>{t('games.player.loading')}</p>
      </div>
    )
  }
  return (
    <iframe
      key={`${version}:${loadNonce}`}
      ref={frameRef}
      className="game-player__frame"
      title={title}
      sandbox="allow-scripts allow-pointer-lock"
      srcDoc={html}
      onLoad={(event) => event.currentTarget.focus()}
    />
  )
}
