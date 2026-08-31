/* The mood KPI's click-through (#505) — source-level contracts.
 *
 * Two of these pin real bugs found while building it: the dialog renders
 * through a portal, OUTSIDE `.tch-stats`, so the five family hues have to be
 * declared on `.tch-moodDlg` too or the bar renders transparent; and the pulse
 * panel's `.tch-home .tch-stats .tch-stat` reset out-specifies a bare
 * `.tch-stat--button:hover`, so the hover cue must carry the same prefix.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

const dialog = read('src/features/teacher-app/home/MoodDialog.tsx')
const home = read('src/features/teacher-app/home/TeacherHomePage.tsx')
const homeCss = read('src/features/teacher-app/home/teacher-home.css')
const sharedCss = read('src/features/teacher-app/shared/teacher-shared.css')

test('the home page opens the dialog from the mood KPI', () => {
  assert.match(home, /MoodDialog/)
  assert.match(home, /tch-stat--button/)
})

test('the family palette reaches the portal-rendered dialog', () => {
  // Declared on .tch-moodDlg itself — the dialog lives outside .tch-stats,
  // and inheriting nothing meant a transparent bar.
  const scopes = sharedCss.match(/^[^{@]*\.tch-moodDlg[^{]*\{/gm) ?? []
  assert.ok(scopes.length >= 2, 'light and dark palette scopes both name .tch-moodDlg')
})

test('the KPI hover cue out-specifies the pulse panel reset', () => {
  assert.match(homeCss, /\.tch-home \.tch-stats \.tch-stat--button:hover/)
})

test('the bar is the control and no family is ranked within', () => {
  // Segments are buttons sized by children; children sort alphabetically.
  assert.match(dialog, /className=\{`tch-moodDlg__seg is-\$\{valence\}/)
  assert.match(dialog, /localeCompare/)
})

test('every dialog key exists in all three languages', () => {
  const keys = [
    'tch.mood.dialog.note', 'tch.mood.dialog.tab.families',
    'tch.mood.dialog.tab.notes', 'tch.mood.dialog.notesEmpty',
    'tch.mood.dialog.back', 'tch.mood.dialog.profile',
  ]
  for (const language of ['he', 'ar', 'en']) {
    const locale = JSON.parse(read(`../locales/${language}.json`))
    for (const key of keys) {
      assert.ok(key in locale, `${key} missing in ${language}`)
    }
  }
})
