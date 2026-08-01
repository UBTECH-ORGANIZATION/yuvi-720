import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { useI18n } from '../i18n/I18nProvider'
import { useCompanion } from '../providers/CompanionProvider'
import { YuviAvatar3D, type YuviAvatarHandle } from '../features/Yuvi-studio/YuviAvatar3D'
import { useStudioTransition } from '../features/Yuvi-studio/StudioTransitionProvider'
import { useYuviDesign } from '../features/Yuvi-studio/YuviDesignProvider'
import { YuviHeadIcon } from './YuviHeadIcon'
import './Yuvi-companion-dock.css'

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
  const avatarRef = useRef<YuviAvatarHandle | null>(null)
  const studioOpen = transition?.isOpen ?? false
  const [isScrolling, setIsScrolling] = useState(false)

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

  const previewText = isStreaming ? t('companion.thinking') : preview
  const showPreview = !isOpen && (isStreaming || unreadCount > 0) && Boolean(previewText)
  const openImmediately = () => {
    flushSync(() => open())
  }

  return (
    <aside
      className={`Yuvi-companion-dock${isOpen ? ' is-open' : ''}${isOpening ? ' is-opening' : ''}${isClosing ? ' is-closing' : ''}${isStreaming ? ' is-thinking' : ''}${studioOpen ? ' is-studio-open' : ''}${isScrolling && !isOpen && !isOpening && !isClosing ? ' is-scrolling' : ''}`}
      aria-label={t('companion.title')}
      aria-hidden={studioOpen || undefined}
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
        <span className="Yuvi-companion-dock__tooltip" role="tooltip" dir={direction}>
          {t('companion.tooltip')}
        </span>
        <div className="Yuvi-companion-dock__robot">
          {loaded && !studioOpen && (
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
          {!loaded && !studioOpen && (
            <span className="Yuvi-companion-dock__loader" role="presentation" />
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
