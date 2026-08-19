/* Three properties of the scope provider that fail silently.
 *
 *   node --test frontend/tests/
 *
 * There is no renderer in this suite, so these read the source — the same trade
 * `teacher-chrome.test.ts` makes, and for the same reason: each of these is one
 * line whose removal reviews cleanly and shows up much later as a screen that
 * is merely empty.
 *
 * All three come from bugs this provider was written to end. The roster used to
 * replace the sub-group LIST on a class change and keep the SELECTION, so
 * switching class filtered the new class by the old class's learner ids: zero
 * rows, four zeroed KPIs, and no card highlighted to explain any of it.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const source = readFileSync(
  fileURLToPath(new URL('../src/providers/TeacherScopeProvider.tsx', import.meta.url)), 'utf8')

/** One function body, by declaration. */
function body(name: string): string {
  const at = source.indexOf(`const ${name} = useCallback(`)
  assert.notEqual(at, -1, `no ${name}`)
  return source.slice(at, source.indexOf('}, [', at))
}

describe('changing class', () => {
  const select = body('selectGroup')

  it('drops the sub-group in the same commit as the class', () => {
    /* Not in an effect keyed on `groupId`: the frame between the two is the
       whole bug. React batches these, so the roster never observes a class and
       a sub-group that belong to different classes. */
    assert.match(select, /setSubgroupId\(null\)/)
  })

  it('drops the list with the selection', () => {
    // A stale list is not harmless: the reconcile below matches the selection
    // against it, and a surviving old list makes a dangling id look valid.
    assert.match(select, /setSubgroups\(\[\]\)/)
    assert.match(select, /setSubgroupsFor\(null\)/)
  })

  it('persists the widening rather than leaving it to the next write', () => {
    assert.match(select, /teacher_subgroup_id:\s*null/)
  })

  it('keeps the subject, which is not a fact about one class', () => {
    /* A teacher who teaches maths to two classes means maths in both. If the
       new class has nothing in it, the reconcile clears it — clearing here
       instead would make the bar forget a deliberate choice on every switch. */
    assert.doesNotMatch(select, /setSubject\(/)
  })
})

describe('a remembered narrowing that no longer resolves', () => {

  it('is only judged against a list known to be this class', () => {
    /* `subgroupsFor`/`subjectsFor` name the class each list describes. Without
       them the reconcile fires during a class change, against the previous
       class's answer, and clears a selection the teacher had just made. */
    for (const guard of [/subgroupsFor !== groupId/, /subjectsFor !== groupId/]) {
      assert.match(source, guard)
    }
  })

  it('widens, and never narrows', () => {
    /* The property that makes running this automatically safe: nothing here can
       reduce what a teacher sees without them asking. Both reconciles resolve a
       dangling id to "everyone" / "every subject" and write that back, so it
       cannot dangle again on the next load. */
    const reconciles = source.slice(source.indexOf('── the two reconciles'),
                                   source.indexOf('const selectGroup'))
    assert.match(reconciles, /setSubgroupId\(null\)/)
    assert.match(reconciles, /setSubject\(null\)/)
    // No other value is ever assigned in there.
    for (const call of reconciles.match(/set(?:SubgroupId|Subject)\([^)]*\)/g) ?? []) {
      assert.match(call, /\(null\)$/, `a reconcile narrows the scope: ${call}`)
    }
  })

  it('does not read a failed fetch as a deletion', () => {
    // Both fetches clear their `…For` marker before running and set it only on
    // success, so a network failure leaves the selection alone.
    assert.equal((source.match(/setSubgroupsFor\(null\)/g) ?? []).length >= 2, true)
    assert.equal((source.match(/setSubjectsFor\(null\)/g) ?? []).length >= 2, true)
  })
})

describe('the subject the teacher currently has', () => {

  it('is always among the options', () => {
    /* Before its list arrives, and when the fetch failed. A control showing a
       segment that is not one of its own options cannot be reasoned about —
       or, worse, cleared. */
    assert.match(source, /subject && !subjects\.includes\(subject\)/)
  })
})
