/* The one card that answers the teacher's opening question (#450): which of my
 * students is fine, which is wobbling, which needs me today.
 *
 * v2 layout (by request): ONE flat list, no per-band sections. Every row wears
 * its band as its face — the band icon replaces the letter avatar — so a scan
 * down the card reads as a row of faces. Ordering is red → orange → green with
 * recent movers floating to the top of their band, each wearing a small trend
 * chart for the direction they moved. All the filter chips sit together in the
 * title row at its inline END (top-left in Hebrew). Clicking a student opens
 * the why-dialog; nothing here ranks anyone (C5).
 */

import { forwardRef, useState } from 'react'
import { Hint, Icon } from '../../../components/primitives'
import { useI18n } from '../../../i18n/I18nProvider'
import { BandFace, type Band } from './BandFace'
import { BandHelpDialog } from './BandHelpDialog'
import {
  applyFilters, isFreshChange, moveDirection, sortForCard, type BandedStudent,
} from './bandModel'

const PAGE_SIZE = 24

export const StudentsBandCard = forwardRef<HTMLElement, {
  students: BandedStudent[]
  subgroupLearnerIds: string[]
  /** Non-null when the scope bar narrowed to a sub-group — shows the notice. */
  subgroupName: string | null
  bandFilter: Band | null
  onBandFilter: (band: Band | null) => void
  onOpenStudent: (student: BandedStudent) => void
}>(function StudentsBandCard(
  { students, subgroupLearnerIds, subgroupName, bandFilter, onBandFilter, onOpenStudent },
  ref,
) {
  const { t } = useI18n()
  const [expanded, setExpanded] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [freshOnly, setFreshOnly] = useState(false)

  const inScope = applyFilters(students, {
    subgroupLearnerIds: subgroupName ? subgroupLearnerIds : null,
  })
  const filtered = sortForCard(applyFilters(inScope, { band: bandFilter, freshOnly }))
  const shown = expanded ? filtered : filtered.slice(0, PAGE_SIZE)
  const countOf = (band: Band) =>
    inScope.filter((row) => row.band.band === band).length
  const freshCount = inScope.filter((row) => isFreshChange(row.band)).length

  return (
    /* `Panel` is a plain function component (no ref forwarding) and the
       attention KPI needs to scroll here — so the sp-panel class sits on a
       ref-able section directly. */
    <section ref={ref} className="sp-panel tch-bands" data-tour="teacher.bands">
      {/* Title on one side; every filter together on the other — the card's
          whole chrome is a single row. */}
      <div className="tch-bands__bar">
        <div className="tch-bands__titles">
          <h2>
            {t('tch.band.title')}
            <Hint text={t('tch.band.helpHint')}>
              <button
                type="button"
                className="tch-bands__help"
                aria-label={t('tch.band.helpOpen')}
                onClick={() => setHelpOpen(true)}
              >
                ?
              </button>
            </Hint>
          </h2>
          <p>
            {subgroupName
              ? t('tch.band.scopeNotice', { name: subgroupName })
              : t('tch.band.subtitle')}
          </p>
        </div>
        <div className="tch-bands__tools">
          <div className="tch-bands__filters" role="group" aria-label={t('tch.band.filterAria')}>
            {(['red', 'orange', 'green'] as Band[]).map((band) => (
              <button
                key={band}
                type="button"
                className={`tch-bands__chip is-${band}${bandFilter === band ? ' is-active' : ''}`}
                aria-pressed={bandFilter === band}
                onClick={() => onBandFilter(bandFilter === band ? null : band)}
              >
                <BandFace band={band} size={20} />
                {t(`tch.band.${band}`)}
                <span className="tch-bands__chipCount">{countOf(band)}</span>
              </button>
            ))}
            {/* the movers: who changed band in the last two days */}
            <button
              type="button"
              className={`tch-bands__chip is-fresh${freshOnly ? ' is-active' : ''}`}
              aria-pressed={freshOnly}
              onClick={() => setFreshOnly((value) => !value)}
            >
              <Icon name="pulse" size={14} aria-hidden />
              {t('tch.band.freshFilter')}
              <span className="tch-bands__chipCount">{freshCount}</span>
            </button>
          </div>
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="tch-bands__empty">{t('tch.band.empty')}</p>
      ) : (
        <ul className="tch-bands__list">
          {shown.map((student) => {
            const direction = moveDirection(student.band)
            return (
              <li key={student.learner_id}>
                <button
                  type="button"
                  className={`tch-bands__student is-${student.band.band}`}
                  onClick={() => onOpenStudent(student)}
                >
                  <BandFace band={student.band.band} size={30} />
                  <span className="tch-bands__name" dir="auto">
                    {student.display_name || student.learner_id}
                  </span>
                  {direction && (
                    /* momentum, not a label: which WAY the fresh change went */
                    <span
                      className={`tch-bands__move is-${direction}`}
                      title={t(direction === 'up' ? 'tch.band.movedUp' : 'tch.band.movedDown')}
                    >
                      <Icon name={direction === 'up' ? 'trendUp' : 'trendDown'} size={13} aria-hidden />
                    </span>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {filtered.length > PAGE_SIZE && !expanded && (
        <button
          type="button"
          className="sp-btn sp-btn--ghost sp-btn--sm tch-bands__more"
          onClick={() => setExpanded(true)}
        >
          <Icon name="chevronDown" size={14} aria-hidden />
          {t('tch.band.showMore', { count: filtered.length - PAGE_SIZE })}
        </button>
      )}
      <BandHelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
    </section>
  )
})
