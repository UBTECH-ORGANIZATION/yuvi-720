/* The two habit scores on the hero identity row (PBI 451): עצמאות rebuilt
 * around HOW the child uses Yuvi, and קשב וריכוז in place of התמדה.
 *
 * Reut's brief shapes every choice here: "בסוף זה טוב שהוא משתמש ביובי, השאלה
 * איך הוא משתמש ביובי" — so the score comes from the server's weighted read of
 * how the child works, never from counting help events; and "לא בהכרח קשת אלא
 * משהו נתוני" — which lives in the DIALOG as sentences with numbers in them:
 * what lowers the score first, what strengthens it after.
 *
 * The scores stand where the minutes/questions/help-used counters stood
 * (Gal, 2026-08-27): the raw counters were exactly the kind of number Reut
 * retired — 420 "שימוש בעזרה" reads as a verdict — and the minutes and
 * question counts live on in the trend dialog's charts. Each stat is a door
 * to its score dialog, so the band below stays subjects-only.
 *
 * Rendering rules the server contract enforces and this file must not soften:
 * `value: null` with `evidenceOk: false` means "not enough evidence yet" — a
 * dash, never a number on thin data; `coverage.renormalized` means the score
 * runs on partial signals and the stat's hint SAYS so; `trend: null` means no
 * chip, never a flat arrow.
 */

import { useState } from 'react'
import { Hint, Skeleton } from '../../../components/primitives'
import { Modal } from '../../../components/primitives/Modal'
import { useI18n } from '../../../i18n/I18nProvider'
import { describeEvidence } from '../shared/evidenceText'
import { StatDelta } from '../home/StatDelta'
import type { ScoreBlock, StudentScores, SubScore } from '../../../services/teacher'
import { deltaFromTrend, groupSubscores, scoreTone, type ScoreKind } from './scoreModel'

export function ScoreStats({ scores }: { scores: StudentScores | null }) {
  const { t } = useI18n()
  const [open, setOpen] = useState<ScoreKind | null>(null)

  if (scores === null) {
    /* Loading (or the read failed): the strip stands in the same place
       wearing its real captions — what each figure measures was never in
       question, only the figure. */
    return (
      <section className="tch-student__kpis" aria-busy="true"
               aria-label={t('tch.kpi.stripLabel')}>
        {(['concentration', 'independence'] as const).map((kind) => (
          <span key={kind} className="tch-stat">
            <Skeleton w={34} h={20} />
            <span className="tch-stat__label">{t(`tch.student.${kind}`)}</span>
          </span>
        ))}
      </section>
    )
  }

  const blocks: { kind: ScoreKind; block: ScoreBlock }[] = [
    { kind: 'concentration', block: scores.concentration },
    { kind: 'independence', block: scores.independence },
  ]

  return (
    <>
      <section className="tch-student__kpis tch-appear"
               aria-label={t('tch.kpi.stripLabel')}>
        {blocks.map(({ kind, block }) => {
          const measured = block.evidenceOk && block.value !== null
          const hint = measured
            ? t('tch.score.window', { days: scores.windowDays })
              + (block.coverage.renormalized ? ` · ${t('tch.score.partial')}` : '')
            : t('tch.score.noEvidence')
          return (
            <Hint key={kind} text={hint}>
              <button
                type="button"
                className="tch-stat"
                onClick={() => setOpen(kind)}
                aria-haspopup="dialog"
              >
                <strong
                  className={`tch-stat__value${measured ? ` is-${scoreTone(block.value)}` : ''}`}
                  dir="ltr"
                >
                  {measured ? `${block.value}%` : '—'}
                </strong>
                <span className="tch-stat__label">{t(`tch.student.${kind}`)}</span>
              </button>
            </Hint>
          )
        })}
      </section>

      <ScoreDialog
        kind={open}
        scores={scores}
        onClose={() => setOpen(null)}
      />
    </>
  )
}

/* One dialog, one component: the teacher's question is "why is it 72 and not
 * 100", so the answer is a short story, not a table (Gal, 2026-08-27). The
 * signals that COST points come first, ordered by how much they cost, each as
 * one sentence carrying its own numbers; what strengthens the score follows.
 * Nothing else: no gauges, no bars, no weights, no session-context panel, no
 * not-yet-measured footnote — signals without evidence simply don't appear,
 * and the stat's hover hint already marks a partial score. */
function ScoreDialog({ kind, scores, onClose }: {
  kind: ScoreKind | null
  scores: StudentScores
  onClose: () => void
}) {
  const { t } = useI18n()
  const block: ScoreBlock | null = kind ? scores[kind] : null
  const groups = block ? groupSubscores(block.subscores) : null

  return (
    <Modal open={kind !== null} onClose={onClose}
           titleId="tch-score-dialog" className="tch-scoreDialog">
      {kind && block && groups ? (
        <>
          <h2 id="tch-score-dialog" className="tch-builder__modalTitle" dir="auto">
            {t('tch.score.dialogTitle', { name: t(`tch.student.${kind}`) })}
          </h2>

          <div className="tch-scoreDialog__head">
            {block.evidenceOk && block.value !== null ? (
              <p className="tch-scoreCard__value" dir="ltr">
                <strong>{block.value}</strong>
                <span className="tch-scoreCard__scale">/100</span>
              </p>
            ) : (
              <p className="tch-status__none">{t('tch.score.noEvidence')}</p>
            )}
            <StatDelta delta={deltaFromTrend(block.trend)}
                       label={t(`tch.student.${kind}`)}
                       when={t('tch.period.prev.week')} />
            <span className="tch-scoreDialog__window">
              {t('tch.score.window', { days: scores.windowDays })}
            </span>
          </div>

          <SignalGroup tone="down" title={t('tch.score.drags')}
                       subs={groups.drags} />
          <SignalGroup tone="up" title={t('tch.score.strengths')}
                       subs={groups.strengths} />

          <div className="tch-builder__actions">
            <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm"
                    onClick={onClose}>
              {t('tch.subgroups.cancel')}
            </button>
          </div>
        </>
      ) : null}
    </Modal>
  )
}

/* One labeled group of signal lines. Each line is the signal's name and the
 * one sentence its own counters make — the evidence IS the text, always on
 * screen. The dot carries the direction a second way beside the grouping. */
function SignalGroup({ tone, title, subs }: {
  tone: 'down' | 'up'
  title: string
  subs: SubScore[]
}) {
  const { t, language } = useI18n()
  if (!subs.length) return null
  return (
    <section className={`tch-scoreDialog__group is-${tone}`}>
      <h3 dir="auto">{title}</h3>
      <ul>
        {subs.map((sub) => {
          const sentences = describeEvidence(
            sub.evidence as Record<string, unknown>, t, language)
          return (
            <li key={sub.key} dir="auto">
              <i className={`tch-scoreDialog__dot is-${scoreTone(sub.value)}`}
                 aria-hidden="true" />
              <span>
                <strong>{t(`tch.score.sub.${sub.key}`)}</strong>
                {sentences.length ? ` — ${sentences.join(' ')}` : ''}
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
