/* The story of the class — and the one place praise starts.
 *
 * A dashboard says what is true now. A feed says what *changed*, which is where
 * teaching happens: "recovered on fractions after 3 failed attempts" is worth
 * more before a lesson than any percentage.
 *
 * Two rules the markup keeps:
 *
 *   Chronological, never ranked (MoE C5). Rows are ordered by time and each
 *   describes one child on their own terms — there is no ordering by who is
 *   doing best, and no API here that could produce one.
 *
 *   Every row opens to its evidence (C4), because "recovered" is an inference
 *   and a teacher must be able to see the attempts behind it.
 *
 * Kudos lives here rather than in its own panel: praise should be attached to
 * the specific thing that earned it, so what Yuvi tells the child is concrete.
 */

import { useState } from 'react'
import { Icon } from '../../../components/primitives/Icon'
import { useI18n } from '../../../i18n/I18nProvider'
import { sendKudos, type Moment } from '../../../services/teacher'
import { RawEvidence } from '../shared/EvidenceDisclosure'
import './moments-feed.css'

const ICON: Record<string, string> = {
  recovery: 'spark',
  sustained_effort: 'clock',
  first_mastery: 'check',
  comeback: 'pulse',
  misconception_resolved: 'lightbulb',
  breakthrough: 'trendUp',
  wellbeing_shared: 'alert',
  goal_done: 'target',
}

function agoLabel(iso: string, t: (k: string, p?: Record<string, string | number>) => string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const minutes = Math.max(0, Math.round((Date.now() - then) / 60000))
  if (minutes < 1) return t('tch.live.ago.now')
  if (minutes < 60) return t('tch.live.ago.minutes', { count: minutes })
  const hours = Math.round(minutes / 60)
  if (hours < 24) return t('tch.live.ago.hours', { count: hours })
  return t('tch.live.ago.days', { count: Math.round(hours / 24) })
}

interface Props {
  moments: Moment[]
  /** Roster names; a moment carries a learner id, never a name. */
  nameOf?: (learnerId: string) => string | null
  /** Group feeds name the child; a single student's feed does not need to. */
  showLearner?: boolean
}

export function MomentsFeed({ moments, nameOf, showLearner = false }: Props) {
  const { t } = useI18n()

  if (!moments.length) {
    return <p className="tch-moments__none">{t('tch.moments.none')}</p>
  }

  return (
    <ul className="tch-moments">
      {moments.map((moment, index) => (
        <MomentRow
          key={`${moment.kind}-${moment.at}-${moment.learner_id ?? ''}-${index}`}
          moment={moment}
          name={showLearner && moment.learner_id ? nameOf?.(moment.learner_id) ?? moment.learner_id : null}
        />
      ))}
    </ul>
  )
}

function MomentRow({ moment, name }: { moment: Moment; name: string | null }) {
  const { t, language } = useI18n()
  const [isPraising, setIsPraising] = useState(false)
  /* The "why?" state is owned here rather than by `EvidenceToggle` because the
     toggle belongs on the meta LINE while the evidence belongs UNDER it — as one
     component they were siblings inside the same flex row, which wrapped the
     explanation into the middle of the row's own controls. */
  const [showWhy, setShowWhy] = useState(false)
  const hasWhy = Boolean(moment.evidence?.raw && Object.keys(moment.evidence.raw).length)
  const [draft, setDraft] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle')

  const sentence = t(moment.text_key, moment.params as Record<string, string | number>)

  async function praise() {
    if (!moment.learner_id || !draft.trim() || state === 'sending') return
    setState('sending')
    try {
      await sendKudos(moment.learner_id, draft.trim(), language, {
        kind: moment.kind, at: moment.at, objective_id: moment.objective_id,
      })
      setState('sent')
    } catch {
      setState('failed')
    }
  }

  return (
    <li className={`tch-moment tch-moment--${moment.kind}${moment.headline ? ' is-headline' : ''}`}>
      <span className="tch-moment__icon" aria-hidden="true">
        <Icon name={ICON[moment.kind] ?? 'pulse'} size={16} />
      </span>

      <div className="tch-moment__body">
        <p className="tch-moment__text" dir="auto">
          {name ? <strong className="tch-moment__who">{name}</strong> : null}
          <span>{sentence}</span>
        </p>

        {/* One quiet line under the sentence: when · why · praise. These used to
            be three stacked rows, which made every moment four lines tall and
            buried the sentence that is the point of the feed. */}
        <div className="tch-moment__meta">
          <span className="tch-moment__when">{agoLabel(moment.at, t)}</span>
          {hasWhy ? (
            <button
              type="button"
              className="tch-evidence__toggle"
              aria-expanded={showWhy}
              onClick={() => setShowWhy((value) => !value)}
            >
              <Icon name={showWhy ? 'chevronUp' : 'chevronLeft'} size={13} aria-hidden />
              {t('tch.evidence.why')}
            </button>
          ) : null}
          {moment.learner_id && state !== 'sent' && !isPraising ? (
            <button
              type="button"
              className="tch-moment__praise"
              onClick={() => setIsPraising(true)}
            >
              <Icon name="spark" size={13} aria-hidden />
              {t('tch.kudos.open')}
            </button>
          ) : null}
        </div>

        {showWhy ? <RawEvidence raw={moment.evidence?.raw} /> : null}

        {moment.learner_id ? (
          state === 'sent' ? (
            <p className="tch-moment__sent" role="status">
              <Icon name="check" size={13} aria-hidden />
              {t('tch.kudos.sent')}
            </p>
          ) : isPraising ? (
            <div className="tch-moment__kudos">
              {/* Named so the teacher knows the child hears this from Yuvi, in
                  Yuvi's voice — not as a portal notification from "the system". */}
              <p className="tch-moment__kudosHint">{t('tch.kudos.hint')}</p>
              <textarea
                value={draft}
                dir="auto"
                rows={2}
                placeholder={t('tch.kudos.placeholder')}
                aria-label={t('tch.kudos.title')}
                onChange={(event) => setDraft(event.target.value)}
              />
              <div className="tch-moment__kudosActions">
                <button
                  type="button"
                  className="sp-btn sp-btn--primary sp-btn--sm"
                  disabled={!draft.trim() || state === 'sending'}
                  onClick={praise}
                >
                  {state === 'sending' ? t('tch.kudos.sending') : t('tch.kudos.send')}
                </button>
                <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm" onClick={() => setIsPraising(false)}>
                  {t('tch.meeting.close')}
                </button>
              </div>
              {state === 'failed' ? (
                <p className="tch-moment__error" role="status">{t('tch.kudos.failed')}</p>
              ) : null}
            </div>
          ) : null
        ) : null}
      </div>
    </li>
  )
}
