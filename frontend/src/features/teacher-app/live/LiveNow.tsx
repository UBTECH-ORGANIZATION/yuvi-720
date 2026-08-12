/* Presence, and the alert row.
 *
 * This used to also carry `LiveNowStrip`, a board of one tile per child. It was
 * removed because the roster said the same thing twice: presence is already a
 * column, a filter and a KPI on that screen, and the strip sat a hundred pixels
 * above them repeating it in a third shape.
 *
 * Two rules survive it and still run through everything here:
 *
 * **Never a bare dot.** Every status is rendered with "last seen X ago" beside
 * it. A dropped SSE connection is usually a sleeping laptop, so a green dot on
 * its own would be a claim we cannot support. Absence is not an event.
 *
 * **Never a bare "struggling".** The badge always carries the detector's own
 * evidence, expandable in place — the same explainability rule as every other
 * flag in this app.
 */

import { useState } from 'react'
import { Icon, StatusPill } from '../../../components/primitives'
import { useI18n } from '../../../i18n/I18nProvider'
import type { Presence, PresenceStatus, TeacherAlert } from '../../../services/teacher'
import { RawEvidence, withFallback } from '../shared/EvidenceDisclosure'
import { ObjectiveLine } from '../shared/ObjectiveRef'
import './live-now.css'

/** Coarse "how long ago", in whole units. Deliberately imprecise: presence is a
 *  best-effort signal and a to-the-second timestamp would imply otherwise. */
type Translate = (key: string, params?: Record<string, string | number>) => string

export function agoLabel(iso: string | null, t: Translate): string {
  if (!iso) return t('tch.live.neverSeen')
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (seconds < 60) return t('tch.live.ago.now')
  if (seconds < 3600) return t('tch.live.ago.minutes', { count: Math.floor(seconds / 60) })
  if (seconds < 86400) return t('tch.live.ago.hours', { count: Math.floor(seconds / 3600) })
  return t('tch.live.ago.days', { count: Math.floor(seconds / 86400) })
}

export function PresenceDot({ presence }: { presence?: Presence | null }) {
  const { t } = useI18n()
  const status: PresenceStatus = presence?.status ?? 'offline'
  const label = t(`tch.live.status.${status}`)
  return (
    <span className={`tch-dot tch-dot--${status}`} title={`${label} · ${agoLabel(presence?.last_seen_at ?? null, t)}`}>
      <span className="tch-dot__mark" aria-hidden="true" />
      <span className="sp-sr-only">{label}</span>
    </span>
  )
}

/* ── alerts ───────────────────────────────────────────────────────────────── */

interface AlertRowProps {
  alert: TeacherAlert
  name: string
  onOpen: () => void
  onAcknowledge: () => void
  onResolve: () => void
}

export function AlertRow({ alert, name, onOpen, onAcknowledge, onResolve }: AlertRowProps) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  // `params` is `unknown`-valued on the wire (the server stores whatever the
  // raiser passed); only scalars can be interpolated, so anything else is
  // dropped rather than rendered as "[object Object]".
  const params = Object.fromEntries(
    Object.entries(alert.params ?? {})
      .filter(([, value]) => typeof value === 'string' || typeof value === 'number')
  ) as Record<string, string | number>
  const title = t(alert.title_key, params)
  /* The alert names its objective in `params` (and the detector payload keeps
     it too, for alerts raised before that was true). Read as a string only —
     `params` is `unknown`-valued on the wire. */
  const objectiveId = typeof alert.params?.objective_id === 'string'
    ? alert.params.objective_id
    : typeof (alert.evidence?.raw as Record<string, unknown> | undefined)?.objective_id === 'string'
      ? String((alert.evidence?.raw as Record<string, unknown>).objective_id)
      : null

  return (
    <div className={`tch-alert tch-alert--${alert.severity} is-${alert.status}`}>
      <div className="tch-alert__head">
        <div className="tch-alert__who">
          <strong dir="auto">{name}</strong>
          <StatusPill tone={alert.severity === 'urgent' ? 'support' : 'steady'}>
            {withFallback(t(`tch.alert.kind.${alert.kind}`), `tch.alert.kind.${alert.kind}`, alert.kind)}
          </StatusPill>
          {alert.occurrences > 1 ? (
            <span className="tch-alert__count">
              {t('tch.alert.occurrences', { count: alert.occurrences })}
            </span>
          ) : null}
        </div>
        {/* Both of these change what happens to the row and neither said so.
            "ראיתי" and "טופל" are one word each and a teacher pressing the
            wrong one either loses a live condition off their list or keeps a
            handled one on it, so each carries the sentence that says which. */}
        <div className="tch-alert__actions">
          <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm" onClick={onOpen}>
            {t('tch.attention.open')}
          </button>
          {alert.status === 'open' ? (
            <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm"
                    title={t('tch.alert.ackHint')} onClick={onAcknowledge}>
              {t('tch.alert.ack')}
            </button>
          ) : null}
          <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm"
                  title={t('tch.alert.resolveHint')} onClick={onResolve}>
            {t('tch.alert.resolve')}
          </button>
        </div>
      </div>

      <p className="tch-alert__title" dir="auto">
        {title === alert.title_key ? t('tch.alert.fallback') : title}
      </p>

      {/* WHICH objective. "three consecutive failures on the same objective"
          named no objective at all, so the row asked a teacher to act on a
          thing it would not identify. The name opens the catalogue's account
          of the goal, because knowing its title is only half the question. */}
      <ObjectiveLine objectiveId={objectiveId} />

      <button
        type="button"
        className="tch-evidence__toggle"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name={open ? 'chevronUp' : 'chevronLeft'} size={14} aria-hidden="true" />
        {t('tch.evidence.why')}
      </button>
      {/* The server refuses to store an alert without raw evidence, so this is
          never empty — the disclosure is guaranteed to have something to show. */}
      {open ? <RawEvidence raw={alert.evidence?.raw} /> : null}
    </div>
  )
}
