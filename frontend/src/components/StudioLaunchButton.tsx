import { useRef } from 'react'
import { useI18n } from '../i18n/I18nProvider'
import { navigate } from '../app/router'
import { useStudioTransition } from '../features/Yuvi-studio/StudioTransitionProvider'
import { YuviHeadIcon } from './YuviHeadIcon'
import './studio-launch-button.css'

/* The one, obvious way into the character studio.
   It used to live on Yuvi's chest badge, which put two different actions —
   "talk to Yuvi" and "dress Yuvi" — inside the same little robot and popped two
   tooltips at once. Here the action is named, always in the same place, and the
   button itself is the shared element the studio flies out of. */
export function StudioLaunchButton() {
  const { t } = useI18n()
  const transition = useStudioTransition()
  const buttonRef = useRef<HTMLButtonElement | null>(null)

  const openStudio = () => {
    if (transition) transition.openStudio(buttonRef.current)
    else navigate('/yuvi-studio')
  }

  return (
    <button
      ref={buttonRef}
      className={`studio-launch${transition?.isOpen ? ' is-active' : ''}`}
      type="button"
      title={t('YuviStudio.subtitle')}
      aria-label={`${t('YuviStudio.title')} — ${t('YuviStudio.launcher')}`}
      onClick={openStudio}
    >
      <span className="studio-launch__head" aria-hidden="true">
        <YuviHeadIcon />
      </span>
      <span className="studio-launch__label">{t('YuviStudio.title')}</span>
    </button>
  )
}
