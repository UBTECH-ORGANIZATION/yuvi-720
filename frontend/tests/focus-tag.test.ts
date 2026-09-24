/* The chat never renders the coach's focus tag, even half-streamed. */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { stripFocusTags } from '../src/services/focusTag.ts'

test('a whole tag is removed wherever it sits', () => {
  assert.equal(stripFocusTags('⟦o3⟧ הסתכלו על הטבלה'), ' הסתכלו על הטבלה')
  assert.equal(stripFocusTags('ראו [[q]] שוב'), 'ראו  שוב')
  assert.equal(stripFocusTags('【opts】'), '')
  assert.equal(stripFocusTags('⟦השאלה⟧ מה שואלים?'), ' מה שואלים?')
})

test('a half-streamed tag waits instead of flashing', () => {
  assert.equal(stripFocusTags('הסתכלו ⟦o', true), 'הסתכלו ')
  assert.equal(stripFocusTags('⟦השא', true), '')
  assert.equal(stripFocusTags('הסתכלו ⟦o', false), 'הסתכלו ⟦o')
})

test('an opener that never closed is dropped with its token', () => {
  assert.equal(stripFocusTags('⟦التص|> هذه الشاشة'), 'هذه الشاشة')
})

test('ordinary brackets are text', () => {
  assert.equal(stripFocusTags('[חשוב] קראו [[שוב]]'), '[חשוב] קראו [[שוב]]')
})
