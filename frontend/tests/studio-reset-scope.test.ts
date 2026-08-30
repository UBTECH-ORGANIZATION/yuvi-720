/* Reset belongs to the station you are standing at.
 *
 * Both stations render the same footer component, so a single `resetAll()`
 * behind that one button meant tidying the floor at the room bench also stripped
 * Yuvi's hat, his colours and every item he was wearing — and dressing Yuvi and
 * pressing Reset there wiped a room of sixty props. One button, two victims.
 *
 * The studio component is `@ts-nocheck` and needs WebGL to render, so the seam
 * that can actually be pinned here is the source: one reset per station, and copy
 * that names what survives.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const studio = readFileSync(
  join(ROOT, 'frontend/src/features/Yuvi-studio/StudioContent.tsx'), 'utf8',
)
const he = JSON.parse(readFileSync(join(ROOT, 'locales/he.json'), 'utf8')) as Record<string, string>

test('no single action resets both the room and Yuvi', () => {
  // `resetAll` was exactly that action.
  assert.ok(!studio.includes('resetAll'), 'a combined reset is back')
  // The avatar branch has to leave before the room reset below it.
  assert.match(studio, /scope === 'avatar'[\s\S]{0,200}\breturn\b[\s\S]{0,200}roomState\.reset\(\)/)
})

test('each station gets its own footer, and so its own reset', () => {
  assert.match(studio, /footer=\{footerFor\('room'\)\}/)
  assert.match(studio, /footer=\{footerFor\('avatar'\)\}/)
})

test('the confirmation names the station it is about', () => {
  // A shared `YuviStudio.reset.title` would be a shared meaning again.
  assert.ok(!studio.includes("'YuviStudio.reset.title'"))
  assert.match(studio, /YuviStudio\.reset\.\$\{resetAsk\}\.title/)
  assert.match(studio, /YuviStudio\.reset\.\$\{resetAsk\}\.body/)
})

test('the button says which one it resets', () => {
  assert.match(studio, /YuviStudio\.reset\.\$\{scope\}/)
  for (const key of ['YuviStudio.reset.avatar', 'YuviStudio.reset.room']) {
    assert.ok(he[key], `${key} is missing from the source locale`)
  }
})

test('each confirmation promises the other half is safe', () => {
  // The whole point of the fix, in the only place the child reads it.
  assert.match(he['YuviStudio.reset.avatar.body'], /החדר לא ישתנה/)
  assert.match(he['YuviStudio.reset.room.body'], /יובי לא ישתנה/)
})

test('the retired shared strings are gone from every locale', () => {
  for (const lang of ['he', 'en', 'ar']) {
    const bundle = JSON.parse(readFileSync(join(ROOT, `locales/${lang}.json`), 'utf8'))
    for (const key of ['YuviStudio.reset', 'YuviStudio.reset.title', 'YuviStudio.reset.body']) {
      assert.ok(!(key in bundle), `${lang} still carries ${key}`)
    }
  }
})
