/* The bell and its panel. Same component for a learner and a teacher.
 *
 * Every row is a deep link: clicking navigates to the object itself and marks
 * the row read in one gesture. A notification you have to go and find the
 * subject of is an announcement, not a notification.
 *
 * Dismissal shows an undo strip rather than vanishing silently — the row is
 * soft-deleted on the server, so undo is a refetch of something that still
 * exists, and the "show dismissed" toggle can always bring the history back.
 */

import { useEffect, useRef, useState } from 'react'
import { navigate } from '../app/router'
import { useI18n } from '../i18n/I18nProvider'
import { useNotifications } from '../providers/NotificationsProvider'
import { useOptionalTeacherRoster } from '../providers/TeacherRosterProvider'
import { listNotifications, type AppNotification } from '../services/notifications'
import { Icon } from './primitives'
import './notification-bell.css'
import { formatDay } from '../i18n/dates'

function scalarParams(params: Record<string, unknown>): Record<string, string | number> {
  return Object.fromEntries(
    Object.entries(params ?? {})
      .filter(([, value]) => typeof value === 'string' || typeof value === 'number')
  ) as Record<string, string | number>
}

export function NotificationBell() {
  const { t } = useI18n()
  const {
    notifications, unread, pendingUndo, markRead, markAllRead,
    dismiss, undoDismiss, dismissAll,
  } = useNotifications()
  const [open, setOpen] = useState(false)
  /* Null for a learner, and that is the point — this is the same component on
     both sides of the app. When a teacher is reading, it turns the `actor_id`
     every notification already carries into the child's name. */
  const roster = useOptionalTeacherRoster()
  const [showDismissed, setShowDismissed] = useState(false)
  const [dismissedRows, setDismissedRows] = useState<AppNotification[]>([])
  const panelRef = useRef<HTMLDivElement>(null)

  // Close on outside click / Escape — the panel is a popover, not a page.
  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (!panelRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  useEffect(() => {
    if (!showDismissed) { setDismissedRows([]); return }
    listNotifications(true)
      .then((result) => setDismissedRows(
        (result.notifications ?? []).filter((row) => row.dismissed_at)))
      .catch(() => {})
  }, [showDismissed, open])

  /* A notification's action is written when it is raised and never rewritten,
     so every improvement to where a row lands leaves the existing rows behind.
     Safety alerts have now been through two of those: a bare profile link, then
     `?focus=flags`, and now the tab and the flag id. The ones already in a
     teacher's bell still carry the old routes — and this is the alert where
     landing in the wrong place matters most.
     So the destination is repaired on the way out, by kind: a safety row with
     no tab in its route is sent to the tab that holds disclosures. It cannot
     name WHICH one — that id was never stored — and the tab says so rather
     than scrolling nowhere. */
  const destination = (row: AppNotification): string | undefined => {
    const route = row.actions?.[0]?.route
    if (!route || row.title_key !== 'tch.alert.safety') return route
    if (route.includes('tab=') || route.includes('focus=')) return route
    return `${route}${route.includes('?') ? '&' : '?'}tab=wellbeing`
  }

  const openRow = (row: AppNotification) => {
    void markRead([row._id])
    const route = destination(row)
    if (route) { setOpen(false); navigate(route) }
  }

  const rows = showDismissed ? [...notifications, ...dismissedRows] : notifications

  return (
    <div className="notif" ref={panelRef}>
      <button
        type="button"
        className="notif__bell"
        aria-expanded={open}
        aria-label={t('notif.title')}
        onClick={() => setOpen((value) => !value)}
        data-tour="notifications.bell"
      >
        <Icon name="bell" size={18} />
        {unread > 0 ? (
          <span className="notif__badge" aria-hidden="true">{unread > 9 ? '9+' : unread}</span>
        ) : null}
      </button>

      {open ? (
        <div className="notif__panel" role="dialog" aria-label={t('notif.title')}>
          <header className="notif__head">
            <strong>{t('notif.title')}</strong>
            <div className="notif__headActions">
              {unread > 0 ? (
                <button type="button" className="notif__link" onClick={() => void markAllRead()}>
                  {t('notif.markAllRead')}
                </button>
              ) : null}
              {notifications.length ? (
                <button type="button" className="notif__link" onClick={() => void dismissAll()}>
                  {t('notif.clearAll')}
                </button>
              ) : null}
            </div>
          </header>

          {pendingUndo.length ? (
            <div className="notif__undo" role="status">
              <span>{t('notif.dismissed', { count: pendingUndo.length })}</span>
              <button
                type="button"
                className="notif__link"
                onClick={() => void undoDismiss(pendingUndo[pendingUndo.length - 1]._id)}
              >
                {t('notif.undo')}
              </button>
            </div>
          ) : null}

          {rows.length ? (
            <ul className="notif__list">
              {rows.map((row) => {
                const title = t(row.title_key, scalarParams(row.params))
                /* WHO. "A student wrote something that needs an adult" is a
                   sentence a teacher cannot act on: with six classes it does
                   not say which child, and the row was the only place that
                   knew. `actor_id` has been on every notification all along. */
                const who = row.actor_id ? roster?.nameOf(row.actor_id) ?? null : null
                return (
                  <li
                    key={row._id}
                    className={`notif__row${row.read_at ? '' : ' is-unread'}${row.dismissed_at ? ' is-dismissed' : ''}`}
                  >
                    <button type="button" className="notif__rowMain" onClick={() => openRow(row)}>
                      {!row.read_at ? <span className="notif__dot" aria-hidden="true" /> : null}
                      <span className="notif__text" dir="auto">
                        {who ? <strong className="notif__who"><bdi>{who}</bdi></strong> : null}
                        {/* A new backend kind must not surface as a raw key. */}
                        {title === row.title_key ? t('notif.fallback') : title}
                      </span>
                      <time className="notif__at" dateTime={row.created_at}>
                        {formatDay(row.created_at)}
                      </time>
                    </button>
                    {!row.dismissed_at ? (
                      <button
                        type="button"
                        className="notif__dismiss"
                        aria-label={t('notif.dismiss')}
                        onClick={() => void dismiss(row._id)}
                      >
                        <Icon name="close" size={13} />
                      </button>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="notif__empty">{t('notif.empty')}</p>
          )}

          <footer className="notif__foot">
            <label className="notif__toggle">
              <input
                type="checkbox"
                checked={showDismissed}
                onChange={(event) => setShowDismissed(event.target.checked)}
              />
              {/* Nothing a user was told ever silently disappears. */}
              <span>{t('notif.showDismissed')}</span>
            </label>
          </footer>
        </div>
      ) : null}
    </div>
  )
}
