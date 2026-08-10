/* Badges as learning evidence, not decoration.
 *
 * A badge in the kid's world is a reward. On the teacher's side it has to answer
 * a different question — *what does this certify the student can actually do?* —
 * so every row lists the objectives behind it rather than just a glyph and a
 * name. That is the same explainability contract every other number here keeps.
 *
 * Locked badges are shown too. "Not started" is information a teacher can act
 * on; hiding it would make the tab look like a trophy case.
 */

import { useEffect, useState } from 'react'
import { EmptyState, ErrorState, Panel, SectionHeader, SkeletonCard, StatusPill } from '../../../components/primitives'
import { useI18n } from '../../../i18n/I18nProvider'
import { Badge, type BadgeGlyph, type BadgeTier } from '../../../components/Badge'
import { getStudentBadges, type TeacherBadge } from '../../../services/teacher'
import './teacher-badges.css'

/* Real values from the `StatusTone` union — it has no `success`, and an unknown
   tone silently renders as the default pill. */
const TONE: Record<string, 'strong' | 'support' | 'neutral'> = {
  earned: 'strong',
  inprogress: 'support',
  locked: 'neutral',
}

export function TeacherBadges({ learnerId }: { learnerId: string }) {
  const { t, language } = useI18n()
  const [badges, setBadges] = useState<TeacherBadge[] | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let active = true
    setBadges(null)
    setError(false)
    getStudentBadges(learnerId, language)
      .then((response) => { if (active) setBadges(response.badges ?? []) })
      .catch(() => { if (active) setError(true) })
    return () => { active = false }
  }, [learnerId, language])

  if (error) return <ErrorState title={t('tch.error')} />
  if (badges === null) return <div aria-busy="true"><SkeletonCard rows={3} /></div>
  if (!badges.length) return <EmptyState title={t('tch.badges.none')} />

  // Earned first — this is an ordering of one student's own badges by state,
  // not a comparison with anybody else.
  const ordered = [...badges].sort((a, b) => {
    const rank = { earned: 0, inprogress: 1, locked: 2 } as const
    return (rank[a.state] ?? 3) - (rank[b.state] ?? 3)
  })

  return (
    <Panel className="tch-badges">
      <SectionHeader
        title={t('tch.badges.title')}
        subtitle={t('tch.badges.subtitle')}
      />
      <ul className="tch-badges__list">
        {ordered.map((badge) => (
          <li key={`${badge.category}:${badge.subject}:${badge.title}`}
              className={`tch-badge is-${badge.state}`}>
            {/* The real coin, not the glyph's name. `badge.glyph` is a key
                (`math`, `flame`, …) that only `Badge` knows how to draw — and
                rendering it as text printed "math" next to the title. */}
            <span className="tch-badge__glyph" aria-hidden="true">
              <Badge
                subject={badge.subject}
                glyph={badge.glyph as BadgeGlyph}
                tier={badge.tier as BadgeTier}
                state={badge.state}
                progress={badge.progress}
                size={52}
                mini
              />
            </span>

            <div className="tch-badge__body">
              <div className="tch-badge__head">
                <strong dir="auto">{badge.title}</strong>
                <StatusPill tone={TONE[badge.state] ?? 'neutral'}>
                  {t(`tch.badges.${badge.state}`)}
                </StatusPill>
              </div>

              {badge.state === 'inprogress' ? (
                <p className="tch-badge__progress">
                  {t('tch.badges.progress', { percent: Math.round(badge.progress * 100) })}
                </p>
              ) : null}

              {/* The evidence: what this badge says the student can do. */}
              {badge.certifies?.length ? (
                <details className="tch-badge__certifies">
                  <summary>{t('tch.badges.certifies')}</summary>
                  <ul>
                    {badge.certifies.map((objective) => (
                      <li key={objective} dir="auto">{objective}</li>
                    ))}
                  </ul>
                </details>
              ) : null}

              {badge.state === 'locked' && badge.howToEarn ? (
                <p className="tch-badge__howto" dir="auto">
                  <span>{t('tch.badges.howTo')}: </span>{badge.howToEarn}
                </p>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  )
}
