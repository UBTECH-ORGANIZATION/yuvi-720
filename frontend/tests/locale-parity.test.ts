/* he/en/ar must stay one key set.
 *
 * The three files are hand-edited and already number ~1750 keys each. A missing
 * key does not throw — `t()` returns the raw key — so a Hebrew-only addition
 * ships silently and an Arabic-speaking teacher reads `tch.attention.title` on
 * their dashboard. This test is the only thing standing between that and prod.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

const here = dirname(fileURLToPath(import.meta.url))
const localesDir = join(here, '..', '..', 'locales')

const LANGS = ['he', 'en', 'ar'] as const

function load(lang: string): Record<string, string> {
  return JSON.parse(readFileSync(join(localesDir, `${lang}.json`), 'utf8'))
}

test('all locales expose exactly the same key set', () => {
  const [he, en, ar] = LANGS.map(load)
  const heKeys = new Set(Object.keys(he))

  for (const [lang, bundle] of [['en', en], ['ar', ar]] as const) {
    const keys = new Set(Object.keys(bundle))
    const missing = [...heKeys].filter((key) => !keys.has(key))
    const extra = [...keys].filter((key) => !heKeys.has(key))
    assert.deepEqual(missing, [], `${lang} is missing keys present in he`)
    assert.deepEqual(extra, [], `${lang} has keys absent from he`)
  }
})

test('no locale value is empty', () => {
  for (const lang of LANGS) {
    const bundle = load(lang)
    const blank = Object.entries(bundle)
      .filter(([, value]) => typeof value !== 'string' || value.trim() === '')
      .map(([key]) => key)
    assert.deepEqual(blank, [], `${lang} has blank values`)
  }
})

test('interpolation placeholders match across locales', () => {
  const [he, en, ar] = LANGS.map(load)
  const placeholders = (value: string) =>
    (value.match(/\{[a-zA-Z0-9_]+\}/g) ?? []).slice().sort()

  for (const key of Object.keys(he)) {
    const expected = placeholders(he[key])
    for (const [lang, bundle] of [['en', en], ['ar', ar]] as const) {
      // A translation that drops `{count}` renders a sentence with a hole in it.
      assert.deepEqual(
        placeholders(bundle[key]), expected,
        `${lang}.${key} placeholders differ from he`
      )
    }
  }
})

/* Keys whose value is the SAME in every language on purpose. Keep this list
   short and justified — it is the escape hatch that would otherwise let a
   forgotten translation through disguised as an intentional one. */
const IDENTICAL_BY_DESIGN = new Set([
  // A multiplication sign and a number. There is nothing to translate, and
  // inventing a word here would make the badge wider in two languages.
  'tch.alert.occurrences',
  // A score out of ten. Same reason: digits and a slash, in every language.
  'tch.quality.score',
])

/* The two namespaces added for the teacher/admin system. Both are large and both
   were hand-edited across three files, so "same as Hebrew" means untranslated
   unless the key is listed above. */
for (const namespace of ['tch.', 'adm.'] as const) {
  test(`the ${namespace}* namespace is fully translated`, () => {
    const [he, en, ar] = LANGS.map(load)
    const keys = Object.keys(he).filter((key) => key.startsWith(namespace))
    assert.ok(keys.length > 100, `expected the ${namespace}* namespace to exist`)
    for (const key of keys) {
      for (const [lang, bundle] of [['en', en], ['ar', ar]] as const) {
        assert.ok(bundle[key], `${lang} is missing ${key}`)
        if (IDENTICAL_BY_DESIGN.has(key)) continue
        // A copy-paste of the Hebrew into en/ar is a missing translation wearing
        // a costume.
        assert.notEqual(bundle[key], he[key], `${lang}.${key} was not translated`)
      }
    }
  })
}
