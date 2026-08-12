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
import {
  EmptyState, ErrorState, Panel, SectionHeader, SkeletonCard,
} from '../../../components/primitives'
import { useI18n } from '../../../i18n/I18nProvider'
import { Badge, type BadgeGlyph, type BadgeTier } from '../../../components/Badge'
import { getStudentBadges, type TeacherBadge } from '../../../services/teacher'
import '../../badges/badges-page.css'
import './teacher-badges.css'

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
      {/* Square cards, in the SAME language the child's own badges screen uses
          (`badge-card` from `features/badges`), rather than a second layout for
          the same objects. A teacher and a student talking about a badge should
          be looking at the same thing.

          And "how to earn it" is on every card, not only on the locked ones. A
          teacher asked "how does she get this?" about a badge at 50% needs the
          answer as much as about one at 0% — arguably more, because that is the
          conversation worth having. */}
      <ul className="tch-badges__grid badges-grid">
        {ordered.map((badge) => (
          <li key={`${badge.category}:${badge.subject}:${badge.title}`}
              className={`badge-card tch-badgeCard is-${badge.state}`}>
            {/* The real coin, not the glyph's name. `badge.glyph` is a key
                (`math`, `flame`, …) that only `Badge` knows how to draw — and
                rendering it as text printed "math" next to the title. */}
            <span className="badge-card__coin" aria-hidden="true">
              <Badge
                subject={badge.subject}
                glyph={badge.glyph as BadgeGlyph}
                tier={badge.tier as BadgeTier}
                state={badge.state}
                progress={badge.progress}
                size={120}
              />
            </span>

            <h3 className="badge-card__title" dir="auto">{badge.title}</h3>

            <span className={`badge-card__state badge-card__state--${badge.state}`}>
              {t(`tch.badges.${badge.state}`)}
              {badge.state === 'inprogress' ? (
                <span className="badge-card__pct">
                  {Math.round(badge.progress * 100)}%
                </span>
              ) : null}
            </span>

            {badge.howToEarn ? (
              <p className="badge-card__howto" dir="auto">
                <span className="badge-card__howto-label">{t('tch.badges.howTo')}</span>
                {badge.howToEarn}
              </p>
            ) : null}

            {/* The evidence: what this badge says the student can do. Folded,
                because it is a list of objective titles and the card is a
                glance — but present, which is the teacher-side difference. */}
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
          </li>
        ))}
      </ul>
    </Panel>
  )
}
