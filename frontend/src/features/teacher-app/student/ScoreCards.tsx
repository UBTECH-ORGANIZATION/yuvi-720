/* The two habit scores on the status band (PBI 451): עצמאות rebuilt around HOW
 * the child uses Yuvi, and קשב וריכוז in place of התמדה.
 *
 * Reut's brief shapes every choice here: "בסוף זה טוב שהוא משתמש ביובי, השאלה
 * איך הוא משתמש ביובי" — so the score comes from the server's weighted read of
 * how the child works, never from counting help events; and "לא בהכרח קשת אלא
 * משהו נתוני" — which lives in the DIALOG as sentences with numbers in them:
 * what lowers the score first, what strengthens it after. The card headline
 * is the same half-dial as the subject cells, so the band reads as one row of
 * instruments (both calls: Gal, 2026-08-27).
 *
 * Rendering rules the server contract enforces and this file must not soften:
 * `value: null` with `evidenceOk: false` means "not enough evidence yet" — a
 * sentence, never a dial on thin data; `coverage.renormalized` means the score
 * runs on partial signals and the card caption SAYS so; `trend: null` means no
 * chip, never a flat arrow.
 */

import { useState } from 'react'
import { ProgressRing } from '../../../components/charts'
import { Card, Skeleton } from '../../../components/primitives'
import { Modal } from '../../../components/primitives/Modal'
import { useI18n } from '../../../i18n/I18nProvider'
import { describeEvidence } from '../shared/evidenceText'
import { StatDelta } from '../home/StatDelta'
import type { ScoreBlock, StudentScores, SubScore } from '../../../services/teacher'
import { deltaFromTrend, groupSubscores, scoreTone, type ScoreKind } from './scoreModel'

export function ScoreCards({ scores }: { scores: StudentScores | null }) {
  const { t } = useI18n()
  const [open, setOpen] = useState<ScoreKind | null>(null)

  if (scores === null) {
    /* Loading (or the read failed): quiet skeleton cells, no door — a door
       onto nothing would be a promise the click cannot keep. */
    return (
      <>
        {(['concentration', 'independence'] as const).map((kind) => (
          <Card key={kind} className="tch-status__cell">
            <h4>{t(`tch.student.${kind}`)}</h4>
            <Skeleton w={104} h={54} r={10} />
            <Skeleton w="72%" h={12} />
          </Card>
        ))}
      </>
    )
  }

  const blocks: { kind: ScoreKind; block: ScoreBlock }[] = [
    { kind: 'concentration', block: scores.concentration },
    { kind: 'independence', block: scores.independence },
  ]

  return (
    <>
      {blocks.map(({ kind, block }) => (
        <Card key={kind} className="tch-status__cell tch-status__cell--score">
          {/* Outside the door button — two interactive elements cannot nest.
              Renders nothing without an honest two-window comparison. */}
          <span className="tch-status__scoreDelta">
            <StatDelta delta={deltaFromTrend(block.trend)}
                       label={t(`tch.student.${kind}`)}
                       when={t('tch.period.prev.week')} />
          </span>
          <button
            type="button"
            className="tch-status__cellOpen"
            onClick={() => setOpen(kind)}
            aria-haspopup="dialog"
          >
            <h4>{t(`tch.student.${kind}`)}</h4>
            {block.evidenceOk && block.value !== null ? (
              /* The same 104px dial as the subject cells, so the band reads as
                 one row of instruments. The DIALOG behind it stays bars and
                 numbers — that is where Reut's "משהו נתוני" lives. */
              <ProgressRing arc="half" percent={block.value} size={104}
                            tone={scoreTone(block.value)}
                            label={t(`tch.student.${kind}`)} />
            ) : (
              /* Thin evidence: the honest sentence. The card stays a door —
                 the dialog is where "why not" is answered. */
              <p className="tch-status__none">{t('tch.score.noEvidence')}</p>
            )}
            <p className="tch-status__caption">
              {t('tch.score.window', { days: scores.windowDays })}
              {block.coverage.renormalized ? ` · ${t('tch.score.partial')}` : ''}
            </p>
          </button>
        </Card>
      ))}

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
 * and the card caption already marks a partial score. */
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
