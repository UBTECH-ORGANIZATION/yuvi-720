import { useEffect, useRef } from 'react'
import { flushSync } from 'react-dom'
import { useI18n } from '../i18n/I18nProvider'
import { useCompanion } from '../providers/CompanionProvider'
import { navigate } from '../app/router'
import { YubiAvatar3D, type YubiAvatarHandle } from '../features/yubi-studio/YubiAvatar3D'
import { useStudioTransition } from '../features/yubi-studio/StudioTransitionProvider'
import { useYubiDesign } from '../features/yubi-studio/YubiDesignProvider'
import { YuviHeadIcon } from './YuviHeadIcon'
import './yubi-companion-dock.css'

/**
 * One global Yuvi control for learner routes.
 * - Yuvi's body opens the Learning Coach.
 * - The permanent chest Y opens the character studio.
 * - Proactive messages appear as a preview instead of taking over the screen.
 */
export function YubiCompanionDock() {
  const { t, direction } = useI18n()
  const { isOpen, isOpening, isClosing, panelWidth, open, close, isStreaming, unreadCount, preview } = useCompanion()
  const transition = useStudioTransition()
  const { design, loaded } = useYubiDesign()
  const avatarRef = useRef<YubiAvatarHandle | null>(null)
  const studioOpen = transition?.isOpen ?? false

  useEffect(() => {
    if (loaded) avatarRef.current?.applyDesign(design, false)
  }, [design, loaded])

  const openStudio = (sourceEl: HTMLElement) => {
    close()
    if (transition) transition.openStudio(sourceEl)
    else navigate('/yuvi-studio')
  }

  const previewText = isStreaming ? t('companion.thinking') : preview
  const showPreview = !isOpen && (isStreaming || unreadCount > 0) && Boolean(previewText)
  const orbitLabel = t('companion.launcher')
  const orbitCharacters = Array.from(orbitLabel)
  const openImmediately = () => {
    flushSync(() => open())
  }

  return (
    <aside
      className={`yubi-companion-dock${isOpen ? ' is-open' : ''}${isOpening ? ' is-opening' : ''}${isClosing ? ' is-closing' : ''}${isStreaming ? ' is-thinking' : ''}${studioOpen ? ' is-studio-open' : ''}`}
      aria-label={t('companion.title')}
      aria-hidden={studioOpen || undefined}
      data-opening={isOpening ? 'true' : 'false'}
      data-closing={isClosing ? 'true' : 'false'}
      style={{ '--sp-companion-width': `${panelWidth}px` } as React.CSSProperties}
    >
      {showPreview && (
        <div className="yubi-companion-dock__preview" role="status">
          <span className="yubi-companion-dock__preview-head"><YuviHeadIcon /></span>
          <span dir="auto">{previewText}</span>
        </div>
      )}

      <div
        className="yubi-companion-dock__portal"
        title={t('companion.launcher')}
        onClick={(event) => {
          const target = event.target
          if (target instanceof Element && target.closest('.yubi-companion-dock__robot')) return
          openImmediately()
        }}
      >
        <span className="yubi-companion-dock__ring yubi-companion-dock__ring--outer" aria-hidden="true" />
        <span className="yubi-companion-dock__ring yubi-companion-dock__ring--inner" aria-hidden="true" />
        <span className="yubi-companion-dock__orbit-label" aria-hidden="true" dir={direction}>
          {orbitCharacters.map((character, index) => (
            <span
              key={`${character}-${index}`}
              style={{
                '--orbit-index': direction === 'rtl' ? orbitCharacters.length - 1 - index : index,
                '--orbit-count': Math.max(orbitCharacters.length - 1, 1),
              } as React.CSSProperties}
            >
              <span>{character === ' ' ? '\u00a0' : character}</span>
            </span>
          ))}
        </span>
        <span className="yubi-companion-dock__orbit-node yubi-companion-dock__orbit-node--one" aria-hidden="true" />
        <span className="yubi-companion-dock__orbit-node yubi-companion-dock__orbit-node--two" aria-hidden="true" />
        <div className="yubi-companion-dock__robot">
          {loaded && !studioOpen && (
            <YubiAvatar3D
              ref={avatarRef}
              initialDesign={design}
              label={t('companion.launcher')}
              muted
              interactiveY
              pulling={isOpening}
              pullingSide="right"
              yTooltip={t('yubiStudio.launcher')}
              onYClick={openStudio}
              onAvatarClick={openImmediately}
            />
          )}
          {!loaded && !studioOpen && (
            <span className="yubi-companion-dock__loader" role="presentation" />
          )}
          <span className="yubi-companion-dock__thrusters" aria-hidden="true">
            <i />
            <i />
          </span>
        </div>
        {unreadCount > 0 && !isOpen && (
          <span className="yubi-companion-dock__unread" aria-label={t('companion.unread')}>
            {unreadCount}
          </span>
        )}
      </div>
    </aside>
  )
}
