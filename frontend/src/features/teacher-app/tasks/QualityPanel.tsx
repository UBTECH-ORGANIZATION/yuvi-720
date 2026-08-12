/* What the checks found, before the teacher reads a word of the task.
 *
 * The review screen's whole premise is that a human reads generated content
 * before thirty children get it. That premise is sound and it is also a lot to
 * ask of somebody with four minutes between lessons — so this says where to
 * look first: the three or four items a machine could tell were off, named,
 * with the item number.
 *
 * Two rules the markup keeps:
 *
 * **A concern is never a verdict.** Nothing here disables the send button.
 * The teacher is the reviewer; a model that could veto their material would be
 * making a pedagogical decision it is not entitled to make.
 *
 * **"Not measured" is said out loud.** With no model provider there is no
 * judge, and the panel says so rather than showing the deterministic checks
 * alone as if they were the whole answer. A green tick that quietly means
 * "half the checks did not run" is the failure this panel exists to prevent.
 */

import { useState } from 'react'
import { Icon, Panel, StatusPill, type StatusTone } from '../../../components/primitives'
import { useI18n } from '../../../i18n/I18nProvider'
import type { QualityReport } from '../../../services/tasks'
import './teacher-tasks.css'

/** Named checks, in the order a teacher would want to hear about them. */
const CHECK_ORDER = [
  'components_present', 'counts', 'brief_vocabulary', 'lesson_vocabulary',
  'questions_follow_deck', 'no_duplicate_questions', 'math_segments_clean',
]

function toneFor(score: number | null): StatusTone {
  if (score === null) return 'neutral'
  if (score >= 8) return 'strong'
  if (score >= 6) return 'steady'
  return 'support'
}

export function QualityPanel({ report, busy, onRecheck }: {
  report: QualityReport
  busy?: boolean
  onRecheck?: () => void
}) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)

  const failing = CHECK_ORDER.filter((name) => report.checks?.[name]?.ok === false)
  const passing = CHECK_ORDER.filter((name) => report.checks?.[name]?.ok === true)
  const skipped = CHECK_ORDER.filter((name) => report.checks?.[name]?.ok === null)

  return (
    <Panel className="tch-quality">
      <div className="tch-quality__head">
        <div className="tch-quality__score">
          <StatusPill tone={toneFor(report.overall)}>
            {report.overall === null
              ? t('tch.quality.unmeasured')
              : t('tch.quality.score', { n: String(report.overall) })}
          </StatusPill>
          <strong dir="auto">{t('tch.quality.title')}</strong>
        </div>

        <div className="tch-quality__headActions">
          {onRecheck ? (
            <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm"
                    disabled={busy} onClick={onRecheck}>
              <Icon name="reflect" size={14} />
              {busy ? t('tch.tasks.working') : t('tch.quality.recheck')}
            </button>
          ) : null}
          <button type="button" className="tch-evidence__toggle"
                  aria-expanded={open} onClick={() => setOpen((value) => !value)}>
            <Icon name={open ? 'chevronUp' : 'chevronLeft'} size={14} aria-hidden />
            {t('tch.quality.details')}
          </button>
        </div>
      </div>

      {/* The headline, in one sentence a teacher can act on. */}
      <p className="tch-quality__lede" dir="auto">
        {failing.length === 0 && report.concerns.length === 0
          ? t('tch.quality.clean')
          : t('tch.quality.look', {
              list: report.concerns.slice(0, 3)
                .map((name) => t(`tch.quality.name.${name}`)).join(' · '),
            })}
      </p>

      {/* Findings first and always visible: they name an item, which is the
          only part of this panel that saves the teacher a search. */}
      {report.findings.length ? (
        <ul className="tch-quality__findings">
          {report.findings.map((finding, index) => (
            <li key={index} dir="auto">
              <Icon name="alert" size={13} aria-hidden />
              <span>
                {finding.component ? (
                  <strong>
                    {t(`tasks.component.${finding.component}`)}
                    {typeof finding.item === 'number' ? ` ${finding.item}` : ''}
                    {' — '}
                  </strong>
                ) : null}
                {finding.problem}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {!report.judged ? (
        <p className="tch-quality__note" dir="auto">
          <Icon name="alert" size={13} aria-hidden />
          {t('tch.quality.judgeUnavailable')}
        </p>
      ) : null}

      {open ? (
        <div className="tch-quality__detail">
          {/* The three scored dimensions, each with the judge's own sentence. */}
          {Object.entries(report.scores).map(([dimension, entry]) => (
            <div key={dimension} className="tch-quality__dim">
              <span className="tch-quality__dimName">
                {t(`tch.quality.dim.${dimension}`)}
              </span>
              <StatusPill tone={toneFor(entry.score)}>{entry.score}</StatusPill>
              <p dir="auto">{entry.why}</p>
            </div>
          ))}

          <ul className="tch-quality__checks">
            {[...failing, ...passing].map((name) => (
              <li key={name} className={report.checks[name].ok ? 'is-ok' : 'is-bad'}>
                <Icon name={report.checks[name].ok ? 'check' : 'close'} size={13} aria-hidden />
                <span>{t(`tch.quality.name.${name}`)}</span>
                <small dir="auto">{describe(name, report.checks[name], t)}</small>
              </li>
            ))}
            {/* Listed, dimmed, and never counted as a pass. */}
            {skipped.map((name) => (
              <li key={name} className="is-skipped">
                <Icon name="clock" size={13} aria-hidden />
                <span>{t(`tch.quality.name.${name}`)}</span>
                <small>{t('tch.quality.notApplicable')}</small>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Panel>
  )
}

/** The numbers behind one check, as a short phrase. The raw object is real
 *  evidence and unreadable; this is the same rule the evidence disclosures
 *  follow — show the datum, never the payload. */
function describe(
  name: string,
  check: Record<string, unknown>,
  t: (key: string, params?: Record<string, string | number>) => string,
): string {
  if (name === 'counts') {
    const rows = (check.components ?? []) as { component: string; asked: number | null; got: number }[]
    return rows
      .filter((row) => row.asked !== null)
      .map((row) => `${t(`tasks.component.${row.component}`)} ${row.got}/${row.asked}`)
      .join(' · ')
  }
  if (name === 'components_present') {
    const missing = (check.missing ?? []) as string[]
    return missing.map((component) => t(`tasks.component.${component}`)).join(' · ')
  }
  if (name === 'brief_vocabulary' || name === 'lesson_vocabulary') {
    const share = check.share as number | null
    return share === null || share === undefined
      ? '' : t('tch.quality.share', { n: String(Math.round(share * 100)) })
  }
  if (name === 'questions_follow_deck') {
    return t('tch.quality.grounded', {
      grounded: String(check.grounded ?? 0), total: String(check.total ?? 0),
    })
  }
  if (name === 'no_duplicate_questions') {
    return ((check.duplicates ?? []) as string[]).slice(0, 2).join(' · ')
  }
  if (name === 'math_segments_clean') {
    return ((check.examples ?? []) as string[]).slice(0, 2).join(' · ')
  }
  return ''
}
