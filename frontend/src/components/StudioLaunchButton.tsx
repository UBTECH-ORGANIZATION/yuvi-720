import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../i18n/I18nProvider'
import { navigate } from '../app/router'
import { useStudioTransition } from '../features/Yuvi-studio/StudioTransitionProvider'
import { formatStudioClock } from '../features/Yuvi-studio/studioTime'
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
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const secondsUntilAvailable = transition?.studioTime?.allowed === false
    ? Math.max(0, Math.ceil((new Date(transition.studioTime.available_at).getTime() - now) / 1000))
    : 0
  const activeStudioSeconds = transition?.activeStudioRemainingSeconds
  const showingActiveStudioTime = activeStudioSeconds !== null && activeStudioSeconds !== undefined
  const displayedSeconds = showingActiveStudioTime ? activeStudioSeconds : secondsUntilAvailable
  const timeLabel = formatStudioClock(displayedSeconds)

  useEffect(() => {
    if (transition?.studioTime?.allowed === false && secondsUntilAvailable === 0) {
      void transition.refreshStudioTime()
    }
  }, [secondsUntilAvailable, transition])

  const openStudio = () => {
    if (transition) transition.openStudio(buttonRef.current)
    else navigate('/yuvi-studio')
  }

  // Intent is the cheapest preload signal there is: by the time the click
  // lands, the studio, its catalog and three.js are usually already parsed.
  // The import is idempotent, so hover/focus/touch may all fire it.
  const warmStudio = () => {
    if (warmed.current) return
    warmed.current = true
    void import('../features/Yuvi-studio/StudioContent')
  }
  const warmed = useRef(false)

  return (
    <button
      ref={buttonRef}
      className={`studio-launch${transition?.isOpen ? ' is-active' : ''}`}
      type="button"
      disabled={!showingActiveStudioTime && transition?.studioTime?.allowed === false}
      data-tour="learner.studio"
      title={showingActiveStudioTime
        ? t('YuviStudio.time.remainingValue').replace('{time}', timeLabel)
        : secondsUntilAvailable ? t('YuviStudio.time.availableIn').replace('{time}', timeLabel) : t('YuviStudio.subtitle')}
      aria-label={showingActiveStudioTime
        ? t('YuviStudio.time.remainingValue').replace('{time}', timeLabel)
        : secondsUntilAvailable ? t('YuviStudio.time.availableIn').replace('{time}', timeLabel) : `${t('YuviStudio.title')} — ${t('YuviStudio.launcher')}`}
      onClick={openStudio}
      onPointerEnter={warmStudio}
      onFocus={warmStudio}
      onTouchStart={warmStudio}
    >
      <span className="studio-launch__head" aria-hidden="true">
        <YuviHeadIcon />
      </span>
      <span className="studio-launch__label">{showingActiveStudioTime || secondsUntilAvailable ? timeLabel : t('YuviStudio.title')}</span>
    </button>
  )
}
