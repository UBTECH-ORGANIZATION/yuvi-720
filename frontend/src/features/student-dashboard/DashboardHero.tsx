import { Icon, StatusPill } from '../../components/primitives'
import { useI18n } from '../../i18n/I18nProvider'
import type { DashboardDTO } from '../../services/brain'

interface DashboardHeroProps {
  dashboard: DashboardDTO
  isStarting: boolean
  actionError: boolean
  onStart: () => void
  onBrowse: () => void
}

export function DashboardHero({
  dashboard,
  isStarting,
  actionError,
  onStart,
  onBrowse,
}: DashboardHeroProps) {
  const { t } = useI18n()
  const { hero } = dashboard
  const isComplete = hero.mode === 'complete'

  return (
    <section className="sd-journey-hero" aria-labelledby="sd-journey-title">
      <div className="sd-journey-hero__glow" aria-hidden="true" />
      <div className="sd-journey-hero__content">
        <div className="sd-journey-hero__eyebrow">
          <Icon name={hero.mode === 'resume' ? 'clock' : 'spark'} size={16} />
          <span>{t(`sdash.hero.${hero.mode}.eyebrow`)}</span>
        </div>
        <p className="sd-journey-hero__welcome" dir="auto">
          {t('sdash.greeting', { name: dashboard.name })}
        </p>
        <h1 id="sd-journey-title" className="sd-journey-hero__title" dir="auto">
          {hero.objectiveTitle || t('sdash.hero.complete.title')}
        </h1>
        <p className="sd-journey-hero__reason" dir="auto">{hero.reason}</p>

        <div className="sd-journey-hero__meta">
          {hero.subjectName && <StatusPill tone="neutral">{hero.subjectName}</StatusPill>}
          {hero.pace && <StatusPill tone="steady">{hero.pace}</StatusPill>}
        </div>

        <div className="sd-journey-hero__actions">
          {!isComplete && (
            <button className="sd-button sd-button--primary" type="button" onClick={onStart} disabled={isStarting}>
              <span>{isStarting ? t('sdash.hero.starting') : t(`sdash.hero.${hero.mode}.action`)}</span>
              <Icon name={hero.mode === 'resume' ? 'reflect' : 'arrow'} size={18} />
            </button>
          )}
          <button className="sd-button sd-button--quiet" type="button" onClick={onBrowse}>
            <Icon name="book" size={18} />
            <span>{t('sdash.hero.browse')}</span>
          </button>
        </div>
        {actionError && <p className="sd-journey-hero__error" role="alert">{t('sdash.hero.actionError')}</p>}
      </div>

      <div className="sd-journey-hero__visual" aria-hidden="true">
        <div className="sd-orbit sd-orbit--outer" />
        <div className="sd-orbit sd-orbit--inner" />
        <div className="sd-orbit__node sd-orbit__node--done"><Icon name="check" size={18} /></div>
        <div className="sd-orbit__node sd-orbit__node--current"><Icon name="book" size={20} /></div>
        <div className="sd-orbit__node sd-orbit__node--next"><Icon name="spark" size={17} /></div>
        <div className="sd-orbit__center"><Icon name="target" size={34} /></div>
      </div>
    </section>
  )
}
