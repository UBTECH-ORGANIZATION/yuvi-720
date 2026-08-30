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

test('the raw layer keeps its place under the diagnosis (C4)', () => {
  assert.match(panel, /<RawEvidence raw=\{raw\} \/>/)
  // The misconception tags the gapsModel comment promises to the raw layer
  // are actually passed to it.
  assert.match(gapsModel, /sample_misconceptions/)
})

test('every why key exists in all three languages', () => {
  const keys = [
    'tch.why.loading', 'tch.why.none', 'tch.why.parts.title', 'tch.why.parts.line',
    'tch.why.questions.title', 'tch.why.questionName', 'tch.why.questions.line',
    'tch.why.errors.title', 'tch.why.error.guess', 'tch.why.error.partial',
    'tch.why.error.misinterpret', 'tch.why.error.careless',
    'tch.why.rec.title', 'tch.why.rec.part', 'tch.why.rec.question',
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
