/* Pieces every console tab needs: mutation plumbing, refusal messages, names,
 * and the shell hooks (tab navigation, 401 handling).
 *
 * The guardrails are the point of this console, so the way a refusal is shown
 * is a first-class concern rather than a catch-all toast. Two kinds:
 *
 *   * a **refusal** the admin can override (`would_leave_group_unstaffed`) —
 *     rendered as a confirm bar that re-runs the same call with the flag set;
 *   * a **refusal on principle** (`cannot_revoke_self`, `cannot_remove_last_admin`)
 *     — rendered as a message with no override, because there isn't one.
 */

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { ApiError } from '../api'
import { useI18n } from '../i18n/I18nProvider'
import { AdminRefusal, isOverridable, type Person } from './api'

export const CONSOLE_TABS = ['overview', 'people', 'groups', 'games', 'audit'] as const
export type ConsoleTab = (typeof CONSOLE_TABS)[number]

/** The hash the shell maps each tab to — `#org-people` deep-links to People. */
export function consoleTabHash(tab: ConsoleTab): string {
  return `#org-${tab}`
}

interface ConsoleShell {
  /** Switch tabs; the shell owns the hash, the console only asks. */
  goToTab: (tab: ConsoleTab) => void
  /** 401 from the proxy: the admin session is gone, re-run the auth check. */
  onUnauthorized: () => void
}

export const ConsoleContext = createContext<ConsoleShell>({
  goToTab: (tab) => { window.location.hash = consoleTabHash(tab) },
  onUnauthorized: () => {},
})

export function useConsoleShell(): ConsoleShell {
  return useContext(ConsoleContext)
}

/** True (and the shell notified) when a fetch failed because the session is
 *  gone. Tabs call this in their catch so a stale cookie sends the admin back
 *  to the login page instead of leaving a silently empty panel. */
export function useUnauthorizedGuard(): (error: unknown) => boolean {
  const { onUnauthorized } = useConsoleShell()
  return useCallback((error: unknown) => {
    const status = error instanceof ApiError || error instanceof AdminRefusal ? error.status : 0
    if (status !== 401) return false
    onUnauthorized()
    return true
  }, [onUnauthorized])
}

/** Display name for a user id, falling back to the id itself — an admin console
 *  that hides the id it operates on is useless for support work, so both show. */
export function nameOf(people: Person[], userId: string): string {
  return people.find((person) => person.user_id === userId)?.display_name || userId
}

export function personLabel(person: Person): string {
  return person.display_name ? `${person.display_name} · ${person.user_id}` : person.user_id
}

interface MutationState {
  busy: boolean
  code: string | null
  /** Set when the refusal can be retried with confirmation. */
  retry: (() => void) | null
}

/**
 * Runs an admin mutation, capturing the guardrail code.
 *
 * `run` takes a factory rather than a promise so an overridable refusal can be
 * retried by calling the factory again with `confirm = true` — the component
 * never has to hold the arguments a second time.
 */
export function useAdminMutation(onDone: () => void) {
  const [state, setState] = useState<MutationState>({ busy: false, code: null, retry: null })
  const unauthorized = useUnauthorizedGuard()

  const run = useCallback((factory: (confirm: boolean) => Promise<unknown>) => {
    const attempt = (confirm: boolean) => {
      setState({ busy: true, code: null, retry: null })
      factory(confirm)
        .then(() => {
          setState({ busy: false, code: null, retry: null })
          onDone()
        })
        .catch((error: unknown) => {
          if (unauthorized(error)) return
          const code = error instanceof AdminRefusal ? error.code : 'unexpected'
          setState({
            busy: false,
            code,
            retry: isOverridable(code) ? () => attempt(true) : null,
          })
        })
    }
    attempt(false)
  }, [onDone, unauthorized])

  const clear = useCallback(() => setState({ busy: false, code: null, retry: null }), [])

  return { ...state, run, clear }
}

interface RefusalNoticeProps {
  code: string | null
  retry: (() => void) | null
  onDismiss: () => void
}

export function RefusalNotice({ code, retry, onDismiss }: RefusalNoticeProps) {
  const { t } = useI18n()
  if (!code) return null
  const key = `adm.refusal.${code}`
  const message = t(key)
  return (
    <div className={`adm-refusal${retry ? ' adm-refusal--overridable' : ''}`} role="alert">
      <p dir="auto">
        {/* `t()` returns the raw key when a code has no message yet — new backend
            guardrails must not leak `adm.refusal.foo` onto an admin's screen. */}
        {message === key ? t('adm.refusal.unexpected') : message}
      </p>
      <div className="adm-refusal__actions">
        {retry ? (
          <button type="button" className="adm-btn adm-btn--danger" onClick={retry}>
            {t('adm.refusal.confirm')}
          </button>
        ) : null}
        <button type="button" className="adm-btn adm-btn--ghost" onClick={onDismiss}>
          {t('adm.refusal.dismiss')}
        </button>
      </div>
    </div>
  )
}

export function AdminSection({ title, hint, children, action }: {
  title: string
  hint?: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="adm-section">
      <div className="adm-section__head">
        <div>
          <h2>{title}</h2>
          {hint ? <p className="adm-section__hint">{hint}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}
