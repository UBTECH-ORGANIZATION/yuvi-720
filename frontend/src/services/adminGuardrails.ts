/* The admin guardrail vocabulary: refusal codes and which of them may be
 * overridden.
 *
 * Deliberately dependency-free so it can be unit-tested directly under
 * `node --test` (which resolves ESM strictly and would choke on the extensionless
 * imports the rest of `services/` uses). `admin.ts` re-exports both, so callers
 * import from there and never need to know this file exists.
 */

/** A guardrail said no. `code` is one of the backend's `AdminError` codes. */
export class AdminRefusal extends Error {
  readonly code: string
  readonly status: number
  constructor(code: string, status: number) {
    super(code)
    this.name = 'AdminRefusal'
    this.code = code
    this.status = status
  }
}

/**
 * Guardrail codes an admin is allowed to override by confirming.
 *
 * Exactly one, and it must stay that way: `would_leave_group_unstaffed` is a
 * refusal to act *silently*, so confirming is the whole point. The others
 * (`cannot_revoke_self`, `cannot_remove_last_admin`) are refusals on principle
 * — the backend rejects the retry too, so offering an override button would be
 * a lie the UI tells about what will happen.
 */
const OVERRIDABLE = new Set(['would_leave_group_unstaffed'])

export function isOverridable(code: string): boolean {
  return OVERRIDABLE.has(code)
}
