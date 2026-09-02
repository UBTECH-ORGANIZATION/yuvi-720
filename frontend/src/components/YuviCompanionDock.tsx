import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { useI18n } from '../i18n/I18nProvider'
import { useCompanion } from '../providers/CompanionProvider'
import { useTour } from './tour/TourProvider'
import { YuviAvatar3D } from '../features/Yuvi-studio/YuviAvatar3DLazy'
import type { YuviAvatarHandle } from '../features/Yuvi-studio/YuviAvatar3D'
import { useStudioTransition } from '../features/Yuvi-studio/StudioTransitionProvider'
import { useYuviDesign } from '../features/Yuvi-studio/YuviDesignProvider'
import { YuviHeadIcon } from './YuviHeadIcon'
import './Yuvi-companion-dock.css'

/** How close the cursor has to get before Yuvi notices it, in px from his centre. */
const NOTICE_RADIUS = 220

/**
 * One global Yuvi control for learner routes.
 * - Yuvi does exactly one thing here: he opens the Learning Coach. The studio
 *   used to hang off his chest badge, which meant hovering him raised two
 *   different bubbles for two different destinations; it now has a named button
 *   in the app bar (StudioLaunchButton) instead.
 * - Proactive messages appear as a preview instead of taking over the screen.
 */
export function YuviCompanionDock() {
  const { t, direction } = useI18n()
  const { isOpen, isOpening, isClosing, panelWidth, open, isStreaming, unreadCount, preview } = useCompanion()
  const transition = useStudioTransition()
  const { design, loaded } = useYuviDesign()
  /* The tour borrows Yuvi. He flies the page himself during it, so the dock
     unmounts its own avatar rather than hiding it — two of him is confusing,
     and two WebGL contexts on a school laptop is worse.

     But only the AVATAR stands down. The dock itself stays visible and
     pressable, because the lesson tour spotlights it and asks the child to open
     the chat themselves — hiding the whole dock made that step point at a box
     with no size, and the provider skipped it in silence. Going to the studio is
     the one case where Yuvi is genuinely gone from the page. */
  const { isGuideFlying } = useTour()
  const avatarRef = useRef<YuviAvatarHandle | null>(null)
  const dockRef = useRef<HTMLElement | null>(null)
  const studioOpen = transition?.isOpen ?? false
  const away = studioOpen
  const avatarAway = studioOpen || isGuideFlying
  const [isScrolling, setIsScrolling] = useState(false)
  const [isNear, setIsNear] = useState(false)

  useEffect(() => {
    if (loaded) avatarRef.current?.applyDesign(design, false)
  }, [design, loaded])

  // While the learner scrolls, step Yuvi aside so he never obscures the content
  // being read; bring him back once scrolling settles.
  useEffect(() => {
    if (isOpen || isOpening || isClosing) {
      setIsScrolling(false)
      return
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    const onScroll = () => {
      setIsScrolling(true)
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => setIsScrolling(false), 650)
    }
    window.addEventListener('scroll', onScroll, { passive: true, capture: true })
    return () => {
      if (timer) clearTimeout(timer)
      window.removeEventListener('scroll', onScroll, { capture: true } as EventListenerOptions)
    }
  }, [isOpen, isOpening, isClosing])

  /* Yuvi notices a cursor coming near, which is most of what makes him read as
     alive rather than as a button with a face. Measured from his centre so it
     is a circle, not the dock's square, and coalesced onto a frame so a fast
     mouse cannot flood React with state updates. */
  useEffect(() => {
    if (isOpen || away) {
      setIsNear(false)
      return
    }
    let frame = 0
    const onMove = (event: PointerEvent) => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        const box = dockRef.current?.getBoundingClientRect()
        if (!box) return
        const dx = event.clientX - (box.x + box.width / 2)
        const dy = event.clientY - (box.y + box.height / 2)
        setIsNear(Math.hypot(dx, dy) < NOTICE_RADIUS)
      })
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    return () => {
      if (frame) cancelAnimationFrame(frame)
      window.removeEventListener('pointermove', onMove)
    }
  }, [isOpen, away])

  const previewText = isStreaming ? t('companion.thinking') : preview
  /* The same words as the launcher button, bent around the ring — the invitation
     should not be a second, different promise. RTL reverses the index so the
     text reads outward the correct way round rather than mirrored. */
  const orbitCharacters = Array.from(t('companion.launcher'))
  const showPreview = !isOpen && (isStreaming || unreadCount > 0) && Boolean(previewText)
  const openImmediately = () => {
    flushSync(() => open())
  }

  return (
    <aside
      ref={dockRef}
      className={`Yuvi-companion-dock${isOpen ? ' is-open' : ''}${isOpening ? ' is-opening' : ''}${isClosing ? ' is-closing' : ''}${isStreaming ? ' is-thinking' : ''}${studioOpen ? ' is-studio-open' : ''}${away ? ' is-away' : ''}${isNear && !isOpen ? ' is-near' : ''}${isScrolling && !isOpen && !isOpening && !isClosing ? ' is-scrolling' : ''}`}
      aria-label={t('companion.title')}
      aria-hidden={away || undefined}
      data-tour="learner.companion"
      data-opening={isOpening ? 'true' : 'false'}
      data-closing={isClosing ? 'true' : 'false'}
      style={{ '--sp-companion-width': `${panelWidth}px` } as React.CSSProperties}
    >
      {showPreview && (
        <div className="Yuvi-companion-dock__preview" role="status">
          <span className="Yuvi-companion-dock__preview-head"><YuviHeadIcon /></span>
          <span dir="auto">{previewText}</span>
        </div>
      )}

      <div
        className="Yuvi-companion-dock__portal"
        title={t('companion.launcher')}
        onClick={(event) => {
          const target = event.target
          if (target instanceof Element && target.closest('.Yuvi-companion-dock__robot')) return
          openImmediately()
        }}
      >
        <span className="Yuvi-companion-dock__base" aria-hidden="true" />
        <span className="Yuvi-companion-dock__ring Yuvi-companion-dock__ring--outer" aria-hidden="true">
          <span className="Yuvi-companion-dock__orbit-node Yuvi-companion-dock__orbit-node--one" />
          <span className="Yuvi-companion-dock__orbit-node Yuvi-companion-dock__orbit-node--two" />
        </span>
        <span className="Yuvi-companion-dock__ring Yuvi-companion-dock__ring--inner" aria-hidden="true" />
        {/* Decorative: the launcher name is already on the button and the
            tooltip, so a screen reader hearing it a third time learns nothing. */}
        <span className="Yuvi-companion-dock__orbit-label" aria-hidden="true" dir={direction}>
          {orbitCharacters.map((character, index) => (
            <span
              key={`${character}-${index}`}
              style={{
                '--orbit-index': direction === 'rtl' ? orbitCharacters.length - 1 - index : index,
                '--orbit-count': Math.max(orbitCharacters.length - 1, 1),
              } as React.CSSProperties}
            >
              <span>{character}</span>
            </span>
          ))}
        </span>
        <span className="Yuvi-companion-dock__tooltip" role="tooltip" dir={direction}>
          {t('companion.tooltip')}
        </span>
        <div className="Yuvi-companion-dock__robot">
          {loaded && !avatarAway && (
            <YuviAvatar3D
              ref={avatarRef}
              initialDesign={design}
              label={t('companion.launcher')}
              muted
              followPointer
              pulling={isOpening}
              pullingSide="right"
              pushing={isClosing}
              pushingSide="right"
              onAvatarClick={openImmediately}
            />
          )}
          {!loaded && !avatarAway && (
            <span className="Yuvi-companion-dock__loader" role="presentation" />
          )}
          {/* Yuvi is out flying the tour, so his plinth keeps a flat stand-in
              rather than an empty hole the child is being asked to press. */}
          {isGuideFlying && !studioOpen && (
            <span className="Yuvi-companion-dock__standin" aria-hidden="true">
              <YuviHeadIcon />
            </span>
          )}
          <span className="Yuvi-companion-dock__thrusters" aria-hidden="true">
            <i />
            <i />
          </span>
        </div>
        {unreadCount > 0 && !isOpen && (
          <span className="Yuvi-companion-dock__unread" aria-label={t('companion.unread')}>
            {unreadCount}
          </span>
        )}
      </div>
    </aside>
  )
}
