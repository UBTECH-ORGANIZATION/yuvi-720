/* A game played over the lesson, in a dialog.
 *
 * The lesson chat's Games tab opens a game here instead of leaving for the
 * game page, so the lesson stays where it was. The dialog holds only the
 * playable frame (GamePlayerFrame) under a slim header: close at the reading
 * start, the title, "open full page" for Yuvi's chat (change / fix / ask live
 * on the game page and are not duplicated here), and fullscreen.
 *
 * It is modal for the keyboard as well as the eye: keydown is fenced at the
 * window's capture phase while it is open, so the companion's and the lesson's
 * own Escape / shortcut handlers never see a key meant for the game. The game
 * itself runs in its own document, so the fence does not touch it.
 */

import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../../components/primitives'
import { useI18n } from '../../i18n/I18nProvider'
import { navigate } from '../../app/router'
import type { LearnerGame } from '../../services/games'
import { GamePlayerFrame } from './GamePlayerFrame'
import './games.css'

const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], iframe, [tabindex]:not([tabindex="-1"])'

export interface GameDialogProps {
  game: LearnerGame
  /** The game page, for everything the dialog leaves out. */
  fullPagePath: string
  onClose: () => void
}

export function GameDialog({ game, fullPagePath, onClose }: GameDialogProps) {
  const { t, direction } = useI18n()
  const titleId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const [isFull, setIsFull] = useState(false)

  // Held in a ref so the fence below depends on nothing that changes per render.
  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose })

  useEffect(() => {
    returnFocusRef.current = document.activeElement as HTMLElement | null
    // The dialog itself, not the frame: the frame focuses itself once the
    // game has loaded, and until then the reader should hear the title.
    dialogRef.current?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        // In fullscreen the browser owns Escape (it leaves fullscreen).
        if (!document.fullscreenElement) { event.preventDefault(); onCloseRef.current() }
      } else if (event.key === 'Tab') {
        const items = [...(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) || [])]
        if (items.length) {
          const first = items[0]
          const last = items[items.length - 1]
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
        }
      }
      // The fence: nothing behind the dialog hears the keyboard while it is up.
      event.stopPropagation()
    }
    window.addEventListener('keydown', onKeyDown, true)

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      document.body.style.overflow = previousOverflow
      if (document.fullscreenElement) void document.exitFullscreen()
      returnFocusRef.current?.focus?.()
    }
  }, [])

  useEffect(() => {
    const onChange = () => setIsFull(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  const toggleFullscreen = () => {
    if (document.fullscreenElement) { void document.exitFullscreen(); return }
    void stageRef.current?.requestFullscreen?.()
  }
  const fullLabel = isFull ? t('games.player.exitFullscreen') : t('games.player.fullscreen')

  // Portal to <body>: the companion is a transformed, fixed panel, and a
  // fixed dialog inside it would be clipped to the chat column.
  return createPortal(
    <div className="game-dialog-backdrop" role="presentation">
      <div
        ref={dialogRef}
        className="game-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        dir={direction}
      >
        <header className="game-dialog__head">
          <button
            type="button"
            className="game-dialog__btn"
            onClick={onClose}
            aria-label={t('games.dialog.close')}
            data-tooltip={t('games.dialog.close')}
          >
            <Icon name="close" size={18} aria-hidden />
          </button>
          <h2 id={titleId} className="game-dialog__title" dir="auto">{game.title}</h2>
          <a
            className="sp-btn sp-btn--ghost sp-btn--sm game-dialog__full-page"
            href={fullPagePath}
            onClick={(event) => { event.preventDefault(); navigate(fullPagePath) }}
          >
            <Icon name="external" size={14} aria-hidden />
            <span>{t('games.dialog.fullPage')}</span>
          </a>
          <button
            type="button"
            className="game-dialog__btn"
            onClick={toggleFullscreen}
            aria-pressed={isFull}
            aria-label={fullLabel}
            data-tooltip={fullLabel}
          >
            <Icon name={isFull ? 'collapse' : 'expand'} size={18} aria-hidden />
          </button>
        </header>
        <div ref={stageRef} className="game-dialog__stage">
          <GamePlayerFrame gameId={game.game_id} version={game.current_version} title={game.title} />
        </div>
      </div>
    </div>,
    document.body,
  )
}
