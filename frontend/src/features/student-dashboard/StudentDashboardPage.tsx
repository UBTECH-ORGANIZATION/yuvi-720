import { useEffect, useState } from 'react'
import { useI18n } from '../../i18n/I18nProvider'
import { useBrain } from '../../providers/BrainProvider'
import { getDashboard, type DashboardDTO } from '../../services/brain'
import { navigate } from '../../app/router'
import {
  Panel, SectionHeader, Card, StatusPill, EmptyState, LoadingState, ErrorState, Icon,
  type StatusTone,
} from '../../components/primitives'
import './student-dashboard.css'

/**
 * Student dashboard (720 Feature 4) — verbal, non-numeric, on real brain data.
 * Progress is shown as a bar + verbal level (no numeric grade); competencies as
 * verbal bands. Replaces the mock imperative page; reads the brain projection.
 */
export function StudentDashboardPage() {
  const { t, language } = useI18n()
  const { learnerId } = useBrain()
  const [dto, setDto] = useState<DashboardDTO | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    let active = true
    const controller = new AbortController()
    setLoading(true); setError(false)
    getDashboard(learnerId, language, controller.signal)
      .then((d) => active && setDto(d))
      .catch(() => active && setError(true))
      .finally(() => active && setLoading(false))
    return () => { active = false; controller.abort() }
  }, [learnerId, language])

  if (loading) return <div className="sd-wrap"><LoadingState title={t('sdash.loading')} /></div>
  if (error) return <div className="sd-wrap"><ErrorState title={t('sdash.error')} /></div>
  if (!dto) return null

  const hasData = dto.subjects.length > 0 || dto.mapping.strengths.length > 0
  if (!hasData) {
    return (
      <div className="sd-wrap">
        <EmptyState
          title={t('sdash.noData')}
          action={<button className="sd-cta" onClick={() => navigate('/learner-mapping')}>{t('sdash.noDataCta')}</button>}
        />
      </div>
    )
  }

  const band = (v: number): { tone: StatusTone; key: string } =>
    v >= 70 ? { tone: 'strong', key: 'sdash.band.strong' }
      : v >= 45 ? { tone: 'steady', key: 'sdash.band.steady' }
        : { tone: 'support', key: 'sdash.band.support' }

  const name = dto.name || 'תלמיד/ה'

  return (
    <div className="sd-wrap">
      <div className="sd-hero">
        <div className="sd-hero__avatar" aria-hidden="true">{name.slice(0, 1)}</div>
        <div>
          <h1 className="sd-hero__name" dir="auto">{name}</h1>
          <p className="sd-hero__sub">{t('sdash.subtitle')}</p>
        </div>
      </div>

      <div className="sd-grid">
        <Panel className="sd-span">
          <SectionHeader title={t('sdash.subjects')} />
          {dto.subjects.map((s) => {
            const lvl = s.progress >= 80 ? 'strong' : s.progress >= 50 ? 'steady' : 'support'
            return (
              <div className="sd-subject" key={s.name}>
                <div className="sd-subject__head">
                  <span className="sd-subject__name" dir="auto">{s.name}</span>
                  <StatusPill tone={lvl as StatusTone}>{s.level}</StatusPill>
                </div>
                {/* Visual progress only — no numeric grade shown to the learner. */}
                <div className="sd-bar"><div className="sd-bar__fill" style={{ inlineSize: `${s.progress}%` }} /></div>
                {s.curriculum.length > 0 && (
                  <div className="sd-curric">
                    {s.curriculum.map((c, i) => (
                      <span key={i} className={`sd-cur ${c.statusClass === 'curr-done' ? 'sd-cur--done' : c.statusClass === 'curr-current' ? 'sd-cur--current' : ''}`}>
                        <span className="sd-cur__dot" /><span dir="auto">{c.topic}</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </Panel>

        <Panel>
          <SectionHeader title={t('sdash.strengths')} />
          <div className="sd-chips">
            {dto.mapping.strengths.map((s, i) => <StatusPill key={i} tone="strong">{s}</StatusPill>)}
          </div>
          <div style={{ height: 'var(--sp-4)' }} />
          <SectionHeader title={t('sdash.challenges')} />
          <div className="sd-chips">
            {dto.difficulties.map((d, i) => <StatusPill key={i} tone="support">{d.text}</StatusPill>)}
          </div>
        </Panel>

        <Panel>
          <SectionHeader title={t('sdash.competencies')} />
          {dto.competencies.map((c) => {
            const b = band(c.value)
            return (
              <div className="sd-comp" key={c.label}>
                <span dir="auto">{c.label}</span>
                <StatusPill tone={b.tone}>{t(b.key)}</StatusPill>
              </div>
            )
          })}
        </Panel>

        <Panel>
          <SectionHeader title={t('sdash.goals')} />
          {dto.goals.length === 0 ? (
            <p style={{ color: 'var(--sp-ink-400)', fontSize: 'var(--sp-fs-sm)' }}>{t('sdash.goalsEmpty')}</p>
          ) : (
            dto.goals.map((g, i) => (
              <div className="sd-goal" key={i}>
                <Icon name="target" size={16} />
                <span dir="auto">{g.text}{g.meta ? <span className="sd-goal__meta"> · {g.meta}</span> : null}</span>
              </div>
            ))
          )}
        </Panel>

        <Panel className="sd-span">
          <SectionHeader title={t('sdash.mapping')} />
          <div className="sd-map__row"><span className="sd-map__label">{t('sdash.interests')}</span>
            <div className="sd-chips">{dto.mapping.interests.map((x, i) => <StatusPill key={i} tone="neutral">{x}</StatusPill>)}</div>
          </div>
          <div className="sd-map__row"><span className="sd-map__label">{t('sdash.learningStyle')}</span><span dir="auto">{dto.mapping.learningStyle}</span></div>
          <div className="sd-map__row"><span className="sd-map__label">{t('sdash.preferences')}</span>
            <div className="sd-chips">{dto.mapping.preferences.map((x, i) => <StatusPill key={i} tone="neutral">{x}</StatusPill>)}</div>
          </div>
          <div className="sd-map__row"><span className="sd-map__label">{t('sdash.environment')}</span><span dir="auto">{dto.mapping.environment}</span></div>
        </Panel>
      </div>
    </div>
  )
}
