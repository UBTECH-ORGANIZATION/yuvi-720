/* Which ways in the login screen may offer.

   The list comes from the backend rather than a build flag, because the answer
   differs per deployment slot from the same bundle: in the cloud the Ministry's
   OpenID provider is the only door, while a developer's machine still needs the
   username/password form. Asking the server means the UI can never offer a
   method the server would refuse. */

import { apiGet } from './api'

export interface AuthProviders {
  /** Username/password. True only in local development. */
  password: boolean
  /** Ministry of Education unified sign-in. */
  moe: boolean
}

/* Fail closed on both: an unreachable backend shows neither door rather than a
   password form that cannot work. */
const NONE: AuthProviders = { password: false, moe: false }

export async function fetchAuthProviders(): Promise<AuthProviders> {
  try {
    const data = await apiGet<Partial<AuthProviders>>('/api/auth/providers')
    return { password: Boolean(data.password), moe: Boolean(data.moe) }
  } catch {
    return NONE
  }
}

/* A full-page navigation, not fetch: the Ministry must see this as a top-level
   browser visit so it can show its own consent and login screens. */
export function startMoeLogin(returnTo?: string) {
  const target = returnTo && returnTo.startsWith('/') && !returnTo.startsWith('//')
    ? returnTo
    : window.location.pathname + window.location.search
  window.location.assign(`/api/auth/moe/login?return_to=${encodeURIComponent(target)}`)
}

/* The `?auth_error=` code the callback hands back on a failed sign-in. Removed
   from the URL as soon as it is read, so a refresh does not re-raise it. */
export function consumeAuthError(): string | null {
  const params = new URLSearchParams(window.location.search)
  const code = params.get('auth_error')
  if (!code) return null
  params.delete('auth_error')
  const query = params.toString()
  window.history.replaceState(
    {},
    '',
    window.location.pathname + (query ? `?${query}` : '') + window.location.hash
  )
  return code
}
