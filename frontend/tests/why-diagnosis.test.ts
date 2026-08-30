/* The gap row's "למה?" answers the question now (#507) — source contracts. */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

const card = read('src/features/teacher-app/shared/DifficultiesCard.tsx')
const panel = read('src/features/teacher-app/shared/WhyDiagnosis.tsx')
const home = read('src/features/teacher-app/home/TeacherHomePage.tsx')
const gapsModel = read('src/features/teacher-app/home/gapsModel.ts')

test('the gaps surface injects the diagnosis loader', () => {
  // The card never fetches on its own; the caller hands it the loader, and
  // the lomda screen (whose rows are questions) stays on the raw toggle.
  assert.match(card, /loadWhy\s*\?\s*<DiagnosisToggle/)
  assert.match(home, /loadWhy=\{\(item\) => getGapDiagnosis\(/)
})

test('the panel is one paragraph and nothing else', () => {
  // By request: only the guidance renders — no folded sections, no raw dump.
  // The folds stay in the payload as the phrasing's grounding, and the
  // counters live on the row itself (sentence + split bar), where C4's
  // disclosure always was.
  assert.doesNotMatch(panel, /tch-why__parts|tch-why__questions|tch-why__errors/)
  assert.doesNotMatch(panel, /RawEvidence/)
  // The misconception tags stay in the gap row's evidence payload.
  assert.match(gapsModel, /sample_misconceptions/)
})

test('every why key exists in all three languages', () => {
  const keys = [
    'tch.why.loading', 'tch.why.none',
    'tch.why.rec.part', 'tch.why.rec.topic', 'tch.why.rec.question',
    'tch.why.rec.error.guess', 'tch.why.rec.error.partial',
    'tch.why.rec.error.misinterpret', 'tch.why.rec.error.careless',
  ]
  for (const language of ['he', 'ar', 'en']) {
    const locale = JSON.parse(read(`../locales/${language}.json`))
    for (const key of keys) {
      assert.ok(key in locale, `${key} missing in ${language}`)
    }
  }
})
