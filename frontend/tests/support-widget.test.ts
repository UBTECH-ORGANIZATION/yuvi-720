/* What a supporter is allowed to see when a learner shares their screen.
 *
 *   node --test frontend/tests/
 *
 * Mode A sends the page's markup, so the masking rules are the only thing standing
 * between a supporter and a child's password, answer or free text. They are tested at
 * the rule level rather than through a live DOM: the table below is the contract, and
 * a regression in it is silent otherwise - the snapshot still renders, it just carries
 * something it should not.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { safePath } from '../src/features/support-widget/context.ts'
import { maskActionFor } from '../src/features/support-widget/domStream.ts'

describe('masking a shared page', () => {
  it('never lets a text field keep its value', () => {
    assert.equal(maskActionFor('input', { type: 'text' }), 'mask-value')
    assert.equal(maskActionFor('INPUT', { type: 'password' }), 'mask-value')
    assert.equal(maskActionFor('input', { type: 'email' }), 'mask-value')
    assert.equal(maskActionFor('input', {}), 'mask-value')
  })

  it('blanks a tick box instead of writing dots into it', () => {
    assert.equal(maskActionFor('input', { type: 'checkbox' }), 'blank-value')
    assert.equal(maskActionFor('input', { type: 'radio' }), 'blank-value')
  })

  it('masks anything the learner typed into a long field', () => {
    assert.equal(maskActionFor('textarea', {}), 'mask-text')
    assert.equal(maskActionFor('div', { contenteditable: 'true' }), 'mask-text')
  })

  it('honours an explicit opt-out marker on any element', () => {
    assert.equal(maskActionFor('div', { 'data-support-private': '' }), 'mask-text')
    assert.equal(maskActionFor('span', { 'data-support-private': 'true' }), 'mask-text')
  })

  it('leaves ordinary markup alone, or the supporter sees nothing useful', () => {
    assert.equal(maskActionFor('div', {}), 'none')
    assert.equal(maskActionFor('p', { class: 'lesson' }), 'none')
    assert.equal(maskActionFor('div', { contenteditable: 'false' }), 'none')
  })
})

describe('the route reported with a session', () => {
  const origin = 'https://spark.example.org'

  it('drops the query string, which is where ids usually hide', () => {
    assert.equal(safePath('/lesson?learner=dana&token=abc', origin), '/lesson')
  })

  it('replaces identifiers so a route cannot name a child', () => {
    assert.equal(safePath('/learner/6f1a2b3c4d5e/goals', origin), '/learner/:id/goals')
    assert.equal(safePath('/class/450/report', origin), '/class/:id/report')
  })

  it('keeps a plain route readable', () => {
    assert.equal(safePath('/dashboard', origin), '/dashboard')
  })

  it('says so when it cannot parse the input', () => {
    assert.equal(safePath('http://', origin), 'unknown')
  })
})
