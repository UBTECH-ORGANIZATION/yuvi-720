/* Meeting preparation, as a drawer inside the student profile.
 *
 * A drawer rather than a route (A8): preparing for a conversation is something
 * you do *while looking at* the student's profile, and pushing it to its own
 * screen would mean losing the context you are preparing from.
 *
 * It lives at `?meeting=1` so it deep-links and survives a reload — `useRoute()`
 * already includes the search string, so this needs no router work.
 *
 * Every suggestion carries its `because`. A prep sheet is exactly where an AI
 * would be tempted to produce plausible-sounding questions about events that
 * never happened, so a row that cannot cite an observation is dropped server-side
 * and never reaches this component.
 */

import { useEffect, useRef, useState } from 'react'
import { navigate } from '../../../app/router'
import { Icon } from '../../../components/primitives/Icon'
import { EmptyState, SkeletonCard } from '../../../components/primitives'
import { useI18n } from '../../../i18n/I18nProvider'
import { getMeetingPrep, type MeetingPrep, type MeetingPrepRow } from '../../../services/teacher'
import { EvidenceToggle, RawEvidence } from '../shared/EvidenceDisclosure'
import './meeting-prep.css'

interface Props {
  learnerId: string
  isOpen: boolean
  onClose: () => void
}

export function MeetingPrepDrawer({ learnerId, isOpen, onClose }: Props) {
  const { t, language } = useI18n()
  const [prep, setPrep] = useState<MeetingPrep | null>(null)
  const [error, setError] = useState(false)
  const closeRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!isOpen) return
    let active = true
    setPrep(null)
    setError(false)
    getMeetingPrep(learnerId, language)
      .then((result) => { if (active) setPrep(result) })
      .catch(() => { if (active) setError(true) })
    return () => { active = false }
  }, [isOpen, learnerId, language])

  // Escape closes, and focus lands on the close button — a full-height overlay
  // that can only be dismissed with a mouse is a keyboard trap.
  useEffect(() => {
    if (!isOpen) return
    closeRef.current?.focus()
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <>
      <div className="tch-drawer__scrim" onClick={onClose} aria-hidden="true" />
      <aside
        className="tch-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={t('tch.meeting.title')}
      >
        <header className="tch-drawer__head">
          <div>
            <h2>{t('tch.meeting.title')}</h2>
            <p>{t('tch.meeting.subtitle')}</p>
          </div>
          <button
            ref={closeRef}
            type="button"
            className="tch-drawer__close"
            onClick={onClose}
            aria-label={t('tch.meeting.close')}
          >
            <Icon name="close" size={18} aria-hidden />
          </button>
        </header>

        <div className="tch-drawer__body">
          {error ? (
            <EmptyState title={t('tch.error')} />
          ) : prep === null ? (
            <div aria-busy="true" style={{ display: 'grid', gap: 'var(--sp-3)' }}><SkeletonCard rows={3} /><SkeletonCard rows={2} /></div>
          ) : prep.unavailable ? (
            <div className="tch-drawer__empty">
              <EmptyState
                title={t('tch.meeting.unavailable')}
                body={t('tch.meeting.unavailable.body')}
              />
              {/* Even "we have nothing" states why. */}
              <RawEvidence raw={prep.because?.raw as Record<string, unknown>} />
            </div>
          ) : (
            <>
              <PrepSection title={t('tch.meeting.questions')} rows={prep.questions} icon="help" />
              <PrepSection title={t('tch.meeting.insights')} rows={prep.insights} icon="lightbulb" />
              <PrepSection title={t('tch.meeting.goals')} rows={prep.goal_ideas} icon="target" />
            </>
          )}
        </div>
      </aside>
    </>
  )
}

function PrepSection(
  { title, rows, icon }: { title: string; rows: MeetingPrepRow[]; icon: 'help' | 'lightbulb' | 'target' }
) {
  const { t } = useI18n()
  if (!rows?.length) return null

  return (
    <section className="tch-prep">
      <h3>
        <Icon name={icon} size={15} aria-hidden />
        {title}
      </h3>
      <ul>
        {rows.map((row, index) => (
          <li key={index}>
            <p dir="auto">
              {row.text ?? t(row.text_key ?? '', row.params as Record<string, string | number>)}
            </p>
            <EvidenceToggle raw={
              (typeof row.because?.raw === 'object' && row.because?.raw !== null
                ? row.because.raw
                : { signal: row.because?.signal }) as Record<string, unknown>
            } />
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Read/write the `?meeting=1` flag without a router library. */
export function useMeetingDrawer(route: string): [boolean, (open: boolean) => void] {
  const isOpen = new URLSearchParams(route.split('?')[1] ?? '').get('meeting') === '1'
  const setOpen = (open: boolean) => {
    const [path, search] = route.split('?')
    const params = new URLSearchParams(search ?? '')
    if (open) params.set('meeting', '1')
    else params.delete('meeting')
    const query = params.toString()
    navigate(query ? `${path}?${query}` : path)
  }
  return [isOpen, setOpen]
}
