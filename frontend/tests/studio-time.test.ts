import assert from 'node:assert/strict'
import test from 'node:test'
import { formatStudioClock } from '../src/features/Yuvi-studio/studioTime.ts'

test('formats the Studio allowance as hours, minutes, and seconds', () => {
  assert.equal(formatStudioClock(0), '00:00:00')
  assert.equal(formatStudioClock(65), '00:01:05')
  assert.equal(formatStudioClock(86400), '24:00:00')
})

test('clamps invalid negative Studio clock values to zero', () => {
  assert.equal(formatStudioClock(-1), '00:00:00')
})