/* Explainability surfaces (MoE F6, "AI Explainable").
 *
 * The requirement is specific: when the system marks a student as needing
 * attention, it must show the raw datum that led there. So every flag and every
 * recommendation in this app is rendered through one of these, and neither can
 * be constructed without its evidence.
 */

import { useState } from 'react'
import { Icon, StatusPill } from '../../../components/primitives'
import { useI18n } from '../../../i18n/I18nProvider'
import type { AttentionFlag, TeacherRecommendation } from '../../../services/teacher'
import { describeEvidence, describeSignal } from './evidenceText'
import { ObjectiveLine } from './ObjectiveRef'

/** `t()` returns the raw key when a translation is missing, which would render
 *  `tch.evidence.field.score_ewma` to a teacher. Evidence keys come from the
 *  backend and can legitimately outpace the locale files, so fall back to
 *  something readable instead of leaking a key. */
export function withFallback(translated: string, key: string, fallback: string): string {
  return translated === key ? fallback : translated
}

/** Renders a `raw_evidence` / `because.raw` object as free-text sentences.
 *
 * Teachers read words, not payloads: known evidence shapes become real
 * localized sentences via `describeEvidence`, and anything unrecognized still
 * renders as "label: value" prose — never JSON.
 */
export function RawEvidence({ raw }: { raw?: Record<string, unknown> | null }) {
  const { t, language } = useI18n()
  const sentences = describeEvidence(raw, t, language)
  if (!sentences.length) return null
  return (
    <div className="tch-evidence__raw">
      {sentences.map((sentence, index) => (
        <p key={index} className="tch-evidence__sentence" dir="auto">{sentence}</p>
      ))}
    </div>
  )
}

/** The "why?" affordance on its own, for any surface that carries raw evidence.
 *
 * Extracted from `AttentionRow` when the moments feed and the weekly digest
 * needed the same behaviour: a feed of twenty-five rows with their evidence
 * permanently expanded is unreadable, and evidence that is merely *available*
 * is what the MoE spec asks for — not evidence that is always shouted.
 */
export function EvidenceToggle({ raw }: { raw?: Record<string, unknown> | null }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const hasRaw = Boolean(raw && Object.keys(raw).length)
  if (!hasRaw) return null

  return (
    <>
      <button
        type="button"
        className="tch-evidence__toggle"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name={open ? 'chevronUp' : 'chevronLeft'} size={14} aria-hidden="true" />
        {t('tch.evidence.why')}
      </button>
      {open ? <RawEvidence raw={raw} /> : null}
    </>
  )
}


interface AttentionRowProps {
  flag: AttentionFlag
  /** Rendered above the reason — usually the student's name. */
  title?: string
  onOpen?: () => void
}

const TONE_BY_KIND: Record<string, 'support' | 'steady' | 'neutral'> = {
  wellbeing: 'support',
  help_requested: 'support',
  inactivity: 'steady',
  low_success: 'steady',
  wheel_spinning: 'steady',
  rapid_guessing: 'steady',
  slow_progress: 'neutral',
  overdue_goal: 'neutral',
}

export function AttentionRow({ flag, title, onOpen }: AttentionRowProps) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const kind = flag.kind ?? 'unknown'
  const hasRaw = Boolean(flag.raw_evidence && Object.keys(flag.raw_evidence).length)
  const objectiveId = typeof flag.raw_evidence?.objective_id === 'string'
    ? flag.raw_evidence.objective_id : null

  return (
    <div className={`tch-attention tch-attention--${kind}`}>
      <div className="tch-attention__head">
        <div className="tch-attention__who">
          {title ? <strong dir="auto">{title}</strong> : null}
          <StatusPill tone={TONE_BY_KIND[kind] ?? 'neutral'}>
            {withFallback(t(`tch.attention.kind.${kind}`), `tch.attention.kind.${kind}`, flag.reason)}
          </StatusPill>
        </div>
        {onOpen ? (
          <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm" onClick={onOpen}>
            {t('tch.attention.open')}
          </button>
        ) : null}
      </div>

      {/* The evidence sentence is always visible — it is the reason, not a detail. */}
      <p className="tch-attention__evidence" dir="auto">{flag.evidence}</p>

      {/* And which objective it happened on, when the flag knows. Same reason
          as the alert row: "consecutive failures" with no subject names a
          symptom and withholds the only thing a teacher can act on. */}
      <ObjectiveLine objectiveId={objectiveId} />

      {hasRaw ? (
        <>
          <button
            type="button"
            className="tch-evidence__toggle"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            <Icon name={open ? 'chevronUp' : 'chevronLeft'} size={14} aria-hidden="true" />
            {t('tch.evidence.why')}
          </button>
          {open ? <RawEvidence raw={flag.raw_evidence} /> : null}
        </>
      ) : null}
    </div>
  )
}

const CATEGORY_TONE: Record<string, 'strong' | 'steady' | 'support' | 'neutral'> = {
  reinforce: 'steady',
  extra_practice: 'steady',
  deepen: 'strong',
  enrich: 'strong',
  refer_intervention: 'support',
}

export function RecommendationCard({ recommendation }: { recommendation: TeacherRecommendation }) {
  const { t, language } = useI18n()
  const [open, setOpen] = useState(false)
  /* One sentence, keyed off the signal — the reason a teacher can read. The
     shape-matched rendering underneath it printed the recommendation's raw
     payload as a column of `label: value` lines. */
  const why = describeSignal(
    recommendation.because.signal,
    recommendation.because.value,
    recommendation.because.raw,
    t,
    language,
  )
  return (
    <li className="tch-rec">
      <div className="tch-rec__head">
        <StatusPill tone={CATEGORY_TONE[recommendation.category] ?? 'neutral'}>
          {recommendation.category_label}
        </StatusPill>
      </div>
      <p className="tch-rec__text" dir="auto">{recommendation.text}</p>
      <button
        type="button"
        className="tch-evidence__toggle"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name={open ? 'chevronUp' : 'chevronLeft'} size={14} aria-hidden="true" />
        {t('tch.evidence.why')}
      </button>
      {open ? (
        <div className="tch-rec__because">
          {why.map((sentence, index) => (
            <p key={index} dir="auto">{sentence}</p>
          ))}
        </div>
      ) : null}
    </li>
  )
}
