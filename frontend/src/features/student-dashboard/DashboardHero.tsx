import { Icon } from '../../components/primitives'
import { useI18n } from '../../i18n/I18nProvider'
import type { DashboardDTO } from '../../services/brain'

interface DashboardHeroProps {
  dashboard: DashboardDTO
  isStarting: boolean
  actionError: boolean
  onStart: () => void
}

export function DashboardHero({
  dashboard,
  isStarting,
  actionError,
  onStart,
}: DashboardHeroProps) {
  const { t } = useI18n()
  const { hero } = dashboard
  const isComplete = hero.mode === 'complete'

  // Highlight the learner's name inside the localized greeting, whatever its
  // position in he/en/ar. A zero-width sentinel marks the name so we can wrap it.
  const NAME_MARK = '⁣'
  const greetingParts = t('sdash.greeting', {
    name: `${NAME_MARK}${dashboard.name}${NAME_MARK}`,
  }).split(NAME_MARK)

  return (
    <section className="sd-journey-hero" aria-labelledby="sd-journey-title">
      <div className="sd-journey-hero__content">
        <div className="sd-journey-hero__head">
          <p className="sd-journey-hero__welcome" dir="auto">
            {greetingParts.length === 3 ? (
              <>
                {greetingParts[0]}
                <span className="sd-journey-hero__name" dir="auto">{greetingParts[1]}</span>
                {greetingParts[2]}
              </>
            ) : (
              t('sdash.greeting', { name: dashboard.name })
            )}
          </p>
          <h1 id="sd-journey-title" className="sd-journey-hero__title" dir="auto">
            {hero.objectiveTitle || t('sdash.hero.complete.title')}
          </h1>
          <p className="sd-journey-hero__lead" dir="auto">{t(`sdash.hero.${hero.mode}.eyebrow`)}</p>
          {!isComplete && (
            <button className={`sd-button sd-button--primary${hero.mode === 'next' ? ' sd-button--directional' : ''}`} type="button" onClick={onStart} disabled={isStarting}>
              <span>{isStarting ? t('sdash.hero.starting') : t(`sdash.hero.${hero.mode}.action`)}</span>
              <Icon name={hero.mode === 'resume' ? 'reflect' : 'arrow'} size={18} />
            </button>
          )}
        </div>
        {actionError && <p className="sd-journey-hero__error" role="alert">{t('sdash.hero.actionError')}</p>}

        {hero.illustration?.tip && (
          <aside className="sd-journey-hero__tip">
            <span className="sd-journey-hero__tip-bulb" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <g className="sd-tip-rays" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                  <path d="M12 1.1v2.5" />
                  <path d="M20.6 4.4l-1.8 1.8" />
                  <path d="M3.4 4.4l1.8 1.8" />
                  <path d="M22.6 12h-2.5" />
                  <path d="M3.9 12H1.4" />
                </g>
                <path stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" d="M8.5 14.7a5 5 0 1 1 7 0c-.75.65-1.15 1.45-1.25 2.35H9.75c-.1-.9-.5-1.7-1.25-2.35z" />
                <path stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" d="M9.7 19.3h4.6M10.8 21.5h2.4" />
              </svg>
            </span>
            <span className="sd-journey-hero__tip-text" dir="auto">
              <strong>{t('sdash.hero.tip')}</strong> {hero.illustration.tip}
            </span>
          </aside>
        )}
      </div>
    </section>
  )
}
