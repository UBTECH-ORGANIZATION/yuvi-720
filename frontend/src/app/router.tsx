import { useEffect, useState } from 'react'

export function navigate(path: string, options: { replace?: boolean } = {}) {
  if (`${window.location.pathname}${window.location.search}` === path) return
  // `replace` is for automatic redirects: it keeps the route we bounced away
  // from out of history, so Back doesn't land on it and bounce again.
  if (options.replace) window.history.replaceState({}, '', path)
  else window.history.pushState({}, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

export function useRoute(): string {
  const [pathname, setPathname] = useState(`${window.location.pathname}${window.location.search}`)

  useEffect(() => {
    const onPopState = () => setPathname(`${window.location.pathname}${window.location.search}`)
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  return pathname
}

/* Which landing door the user entered through, kept for exactly one login.
   In memory on purpose: it must not survive a reload (a returning session at
   '/' belongs at its role home, not wherever a previous visitor clicked), and
   the project rule forbids localStorage for anything session-shaped anyway.
   Read-once so a stale hint can never replay into a later navigation. */
export type LoginIntent = 'student' | 'teacher'

let pendingLoginIntent: LoginIntent | null = null

export function recordLoginIntent(intent: LoginIntent) {
  pendingLoginIntent = intent
}

export function consumeLoginIntent(): LoginIntent | null {
  const intent = pendingLoginIntent
  pendingLoginIntent = null
  return intent
}
