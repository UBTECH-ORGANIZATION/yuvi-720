/* The live classroom: who is here, who is working, who is stuck.
 *
 * Zone 1 of Home, above the attention inbox, because during a lesson this is
 * the screen a teacher actually stands in front of.
 *
 * Two rules run through everything here:
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

const STATUS_ORDER: Record<PresenceStatus, number> = { in_lesson: 0, online: 1, offline: 2 }

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

interface LiveNowProps {
  presence: Presence[]
  nameFor: (learnerId: string) => string
  onOpen: (learnerId: string) => void
  isConnected: boolean
}

export function LiveNowStrip({ presence, nameFor, onOpen, isConnected }: LiveNowProps) {
  const { t } = useI18n()

  const rows = [...presence].sort((a, b) => {
    // Anyone who needs something comes first, then by how present they are.
    const needsA = a.help_requested_at || a.struggling ? 0 : 1
    const needsB = b.help_requested_at || b.struggling ? 0 : 1
    if (needsA !== needsB) return needsA - needsB
    const byStatus = STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
    if (byStatus !== 0) return byStatus
    return nameFor(a.learner_id).localeCompare(nameFor(b.learner_id))
  })

  const inLesson = rows.filter((row) => row.status === 'in_lesson').length
  const online = rows.filter((row) => row.status !== 'offline').length

  return (
    <div className="tch-live" data-tour="teacher.liveNow">
      <div className="tch-live__head">
        <h3>{t('tch.live.title')}</h3>
        <span className="tch-live__counts">
          {t('tch.live.counts', { inLesson, online, total: rows.length })}
        </span>
        {/* Honest about the channel itself: a stale board that looks live is
            worse than one that admits it is stale. */}
        <span className={`tch-live__link${isConnected ? ' is-live' : ''}`}>
          {isConnected ? t('tch.live.connected') : t('tch.live.reconnecting')}
        </span>
      </div>

      {rows.length ? (
        <ul className="tch-live__grid">
          {rows.map((row) => (
            <LiveTile key={row.learner_id} presence={row}
                      name={nameFor(row.learner_id)} onOpen={() => onOpen(row.learner_id)} />
          ))}
        </ul>
      ) : (
        <p className="tch-live__empty">{t('tch.live.none')}</p>
      )}
    </div>
  )
}

function LiveTile({ presence, name, onOpen }: {
  presence: Presence
  name: string
  onOpen: () => void
}) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const needs = Boolean(presence.help_requested_at || presence.struggling)

  /* WHERE, not just "in a lesson": the subject and the objective the child is
     sitting in right now, resolved server-side from the catalog. A teacher
     glancing at the strip mid-class wants "מתמטיקה · מערכת צירים", and when a
     tile turns red it must still say where the trouble is. */
  const location = presence.status === 'in_lesson'
    ? [
        presence.subject ? t(`tch.subject.${presence.subject}`) : null,
        presence.objective_title || presence.unit_title || null,
      ].filter(Boolean).join(' · ')
    : ''

  return (
    <li className={`tch-tile tch-tile--${presence.status}${needs ? ' is-needing' : ''}`}>
      <button type="button" className="tch-tile__main" onClick={onOpen}>
        <span className="tch-tile__avatar" aria-hidden="true">{name.slice(0, 1)}</span>
        <span className="tch-tile__id">
          <span className="tch-tile__name" dir="auto">{name}</span>
          {location ? (
            <span className="tch-tile__where" dir="auto">{location}</span>
          ) : (
            /* The rule: never a bare dot. */
            <span className="tch-tile__seen">{agoLabel(presence.last_seen_at, t)}</span>
          )}
        </span>
        <PresenceDot presence={presence} />
      </button>

      {presence.help_requested_at ? (
        <StatusPill tone="support">{t('tch.live.helpRequested')}</StatusPill>
      ) : null}

      {presence.struggling ? (
        <div className="tch-tile__struggle">
          <StatusPill tone="steady">
            {withFallback(
              t(`tch.attention.kind.${presence.struggling.kind}`),
              `tch.attention.kind.${presence.struggling.kind}`,
              presence.struggling.kind,
            )}
          </StatusPill>
          <button
            type="button"
            className="tch-evidence__toggle"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            <Icon name={open ? 'chevronUp' : 'chevronLeft'} size={13} aria-hidden="true" />
            {t('tch.evidence.why')}
          </button>
          {open ? <RawEvidence raw={presence.struggling.evidence} /> : null}
        </div>
      ) : null}
    </li>
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
        <div className="tch-alert__actions">
          <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm" onClick={onOpen}>
            {t('tch.attention.open')}
          </button>
          {alert.status === 'open' ? (
            <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm" onClick={onAcknowledge}>
              {t('tch.alert.ack')}
            </button>
          ) : null}
          <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm" onClick={onResolve}>
            {t('tch.alert.resolve')}
          </button>
        </div>
      </div>

      <p className="tch-alert__title" dir="auto">
        {title === alert.title_key ? t('tch.alert.fallback') : title}
      </p>

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
