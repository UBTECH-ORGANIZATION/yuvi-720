import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { formatStudioClock } from '../src/features/Yuvi-studio/studioTime.ts'

test('formats the Studio allowance as total minutes and seconds', () => {
  assert.equal(formatStudioClock(0), '00:00')
  assert.equal(formatStudioClock(65), '01:05')
  assert.equal(formatStudioClock(3600), '60:00')
  assert.equal(formatStudioClock(86400), '1440:00')
})

test('clamps invalid negative Studio clock values to zero', () => {
  assert.equal(formatStudioClock(-1), '00:00')
})

test('the timer expires only inside the room with a server-approved dev capability', () => {
  const launcher = readFileSync(new URL('../src/components/StudioLaunchButton.tsx', import.meta.url), 'utf8')
  assert.match(launcher, /canExpire = showingActiveStudioTime && transition\?\.studioTime\?\.debug_can_expire === true/)
  assert.match(launcher, /if \(!showingActiveStudioTime\) \{\s+openStudio\(\)\s+return/)
  assert.match(launcher, /if \(!canExpire \|\| expiring\) return/)
  assert.match(launcher, /await transition.expireStudioTime\(\)/)
  assert.match(launcher, /showingActiveStudioTime \? <bdi>.*<\/bdi> : t\('YuviStudio.title'\)/)
  assert.doesNotMatch(launcher, /showingActiveStudioTime \|\| secondsUntilAvailable \? timeLabel/)
})

test('a server-expired budget opens the timeout dialog and stops movement', () => {
  const studio = readFileSync(new URL('../src/features/Yuvi-studio/StudioContent.tsx', import.meta.url), 'utf8')
  assert.match(studio, /if \(studioTime && remainingSeconds === 0\) setTimeExpired\(true\)/)
  assert.match(studio, /lockRoam=\{timeExpired \|\|/)
  assert.match(studio, /window.location.assign\('\/student-dashboard'\)/)
})