/* The client half of the admin guardrail contract.
 *
 *   node --test frontend/tests/          (Node 25 strips the types natively)
 *
 * The backend enforces the rules (`backend/tests/test_admin_org.py`); this
 * asserts the console reads them correctly. The failure this guards against is
 * specific and bad: showing a "do it anyway" button next to a refusal the server
 * will reject on retry, which teaches an admin that a guardrail is a formality.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { AdminRefusal, isOverridable } from '../src/services/adminGuardrails.ts'

describe('which refusals may be overridden', () => {
  it('lets an admin confirm past the unstaffed-group warning', () => {
    // Not a refusal on principle — a refusal to do it silently. Those learners
    // would otherwise become invisible to every teacher at once.
    assert.equal(isOverridable('would_leave_group_unstaffed'), true)
  })

  it('offers no override on the lockout guards', () => {
    // The backend rejects the retry too. An override button here would be the
    // UI promising something it cannot deliver.
    for (const code of ['cannot_revoke_self', 'cannot_remove_last_admin']) {
      assert.equal(isOverridable(code), false, `${code} must not be overridable`)
    }
  })

  it('offers no override on malformed input or unknown codes', () => {
    for (const code of ['username_taken', 'unknown_group', 'http_500', 'unexpected', '']) {
      assert.equal(isOverridable(code), false, `${code} must not be overridable`)
    }
  })
})

describe('refusals carry a machine-readable code', () => {
  it('keeps the code and status distinct from the message', () => {
    const refusal = new AdminRefusal('would_leave_group_unstaffed', 409)
    assert.equal(refusal.code, 'would_leave_group_unstaffed')
    assert.equal(refusal.status, 409)
    assert.equal(refusal.name, 'AdminRefusal')
    assert.ok(refusal instanceof Error)
  })

  it('is distinguishable from a transport failure', () => {
    // The console branches on `instanceof AdminRefusal` to decide between "you
    // may not do that" and "that failed" — a plain Error must not pass.
    assert.equal(new Error('boom') instanceof AdminRefusal, false)
  })
})
