import { useEffect, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Icon, StatusPill } from '../../components/primitives'
import { useMediaQuery } from '../../hooks/useResponsive'
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
  const prefersReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  const [imageFailed, setImageFailed] = useState(false)
  const showIllustration = Boolean(hero.illustration && !imageFailed)
  const illustrationUrl = prefersReducedMotion
    ? hero.illustration?.staticUrl || hero.illustration?.url
    : hero.illustration?.url

  useEffect(() => setImageFailed(false), [hero.illustration?.assetId])

  const updateHeroGlow = (event: ReactPointerEvent<HTMLElement>) => {
    if (prefersReducedMotion || event.pointerType !== 'mouse') return
    const bounds = event.currentTarget.getBoundingClientRect()
    const x = ((event.clientX - bounds.left) / bounds.width) * 100
    const y = ((event.clientY - bounds.top) / bounds.height) * 100
    event.currentTarget.style.setProperty('--sd-pointer-x', `${x}%`)
    event.currentTarget.style.setProperty('--sd-pointer-y', `${y}%`)
    event.currentTarget.style.setProperty('--sd-pointer-opacity', '1')
  }

  const hideHeroGlow = (event: ReactPointerEvent<HTMLElement>) => {
    event.currentTarget.style.setProperty('--sd-pointer-opacity', '0')
  }

  return (
    <section
      className="sd-journey-hero"
      aria-labelledby="sd-journey-title"
      onPointerMove={updateHeroGlow}
      onPointerLeave={hideHeroGlow}
    >
      <div className="sd-journey-hero__glow" aria-hidden="true" />
      <div className="sd-journey-hero__content">
        <div className="sd-journey-hero__head">
          <p className="sd-journey-hero__welcome" dir="auto">
            {t('sdash.greeting', { name: dashboard.name })}
          </p>
          <span className="sd-journey-hero__eyebrow">
            <Icon name={hero.mode === 'resume' ? 'clock' : 'spark'} size={15} />
            {t(`sdash.hero.${hero.mode}.eyebrow`)}
          </span>
          <h1 id="sd-journey-title" className="sd-journey-hero__title" dir="auto">
            {hero.objectiveTitle || t('sdash.hero.complete.title')}
          </h1>
          <div className="sd-journey-hero__meta">
            {hero.subjectName && <StatusPill tone="neutral">{hero.subjectName}</StatusPill>}
            {hero.pace && <StatusPill tone="steady">{hero.pace}</StatusPill>}
          </div>
        </div>

        {!isComplete && (
          <div className="sd-journey-hero__progress" aria-hidden="true">
            <div className="sd-journey-hero__progress-head">
              <span>{t('sdash.hero.progress')}</span>
              <span>{hero.stats.overallProgress}%</span>
            </div>
            <div className="sd-journey-hero__progress-track">
              <div
                className="sd-journey-hero__progress-fill"
                style={{ inlineSize: `${hero.stats.overallProgress}%` }}
              />
            </div>
          </div>
        )}

        <div className="sd-journey-hero__actions">
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
            <Icon name="lightbulb" size={17} />
            <div>
              <strong>{t('sdash.hero.tip')}</strong>
              <span dir="auto">{hero.illustration.tip}</span>
            </div>
          </aside>
        )}
      </div>

      <div className="sd-journey-hero__visual">
        {showIllustration ? (
          <figure className="sd-lesson-illustration">
            <div className="sd-lesson-illustration__badge">
              <Icon name="target" size={15} />
              <span>{t('sdash.hero.currentLesson')}</span>
            </div>
            <img
              src={illustrationUrl}
              alt={hero.illustration!.alt}
              width={hero.illustration!.width}
              height={hero.illustration!.height}
              decoding="async"
              onError={() => setImageFailed(true)}
            />
            {hero.illustration!.aiGenerated && (
              <figcaption className="sd-lesson-illustration__ai"><Icon name="spark" size={12} />{t('sdash.hero.aiIllustration')}</figcaption>
            )}
          </figure>
        ) : (
          <div className="sd-orbit-wrap" aria-hidden="true">
            <div className="sd-orbit sd-orbit--outer" />
            <div className="sd-orbit sd-orbit--inner" />
            <div className="sd-orbit__node sd-orbit__node--done"><Icon name="check" size={18} /></div>
            <div className="sd-orbit__node sd-orbit__node--current"><Icon name="book" size={20} /></div>
            <div className="sd-orbit__node sd-orbit__node--next"><Icon name="spark" size={17} /></div>
            <div className="sd-orbit__center"><Icon name="target" size={34} /></div>
          </div>
        )}
        <dl className="sd-journey-hero__stats">
          <div><dt><Icon name="clock" size={15} />{t('sdash.hero.timeSpent')}</dt><dd>{hero.stats.timeSpentMinutes === null ? t('sdash.hero.notAvailable') : t('sdash.hero.minutes', { count: hero.stats.timeSpentMinutes })}</dd></div>
          <div><dt><Icon name="chart" size={15} />{t('sdash.hero.progress')}</dt><dd>{hero.stats.overallProgress}%</dd></div>
          <div><dt><Icon name="check" size={15} />{t('sdash.hero.completedUnits')}</dt><dd>{hero.stats.completedUnits}</dd></div>
        </dl>
      </div>
    </section>
  )
}
