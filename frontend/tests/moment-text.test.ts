/* A moment's sentence must never stop mid-thought.
 *
 * Every moment arrives as a locale key plus params, and some of those params
 * are optional in practice: the catalogue may not be able to name an objective,
 * and a goal a child set themselves may have been saved with no title. What a
 * teacher saw was
 *
 *     סיימו את היעד:
 *
 * — a colon with nothing after it, which reads as a broken feed rather than as
 * missing metadata.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

import { momentSentence, placeholdersIn } from
  '../src/features/teacher-app/moments/momentText.ts'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const locales = {
  he: JSON.parse(read('../../locales/he.json')) as Record<string, string>,
  en: JSON.parse(read('../../locales/en.json')) as Record<string, string>,
  ar: JSON.parse(read('../../locales/ar.json')) as Record<string, string>,
}

const translate = (table: Record<string, string>) =>
  (key: string, params: Record<string, string | number> = {}) => {
    const template = table[key]
    if (template === undefined) return key
    return Object.entries(params).reduce(
      (text, [name, value]) => text.split(`{${name}}`).join(String(value)), template)
  }

describe('placeholdersIn', () => {
  it('finds every named hole, not just the first', () => {
    assert.deepEqual(placeholdersIn('התאושש/ה ב{label} אחרי {failures} כישלונות'),
                     ['label', 'failures'])
  })

  it('finds none in a sentence that needs none', () => {
    assert.deepEqual(placeholdersIn('שיתפו משהו שמצריך תשומת לב'), [])
  })
})

describe('momentSentence', () => {
  const t = translate(locales.he)

  it('uses the named sentence when the name is there', () => {
    const sentence = momentSentence('tch.moment.goalDone', { title: 'לסיים את הפרק' }, t)
    assert.match(sentence, /לסיים את הפרק/)
  })

  it('drops the clause rather than the word when a goal has no title', () => {
    // The bug, in one case: `{title}` is not `{label}`, so the older check —
    // which tested `{label}` alone — never fired for this row.
    const sentence = momentSentence('tch.moment.goalDone', { title: '' }, t)
    assert.equal(sentence, locales.he['tch.moment.goalDone.unnamed'])
    assert.ok(!sentence.trim().endsWith(':'), 'a sentence must not end on its colon')
  })

  it('treats a whitespace-only param as missing', () => {
    assert.equal(momentSentence('tch.moment.goalDone', { title: '   ' }, t),
                 locales.he['tch.moment.goalDone.unnamed'])
  })

  it('still drops an unnamed objective, which is what it did before', () => {
    const sentence = momentSentence(
      'tch.moment.firstMastery', { label: '', attempts: 6 }, t)
    assert.equal(sentence, 'הצלחה ראשונה אחרי 6 ניסיונות')
  })

  it('keeps the named sentence when there is no unnamed variant to fall back to', () => {
    // A rendered locale key on a teacher's screen is worse than a gap, so the
    // fallback is only taken when it exists.
    const sparse = translate({ 'x.only': 'nothing but {missing} here' })
    assert.equal(momentSentence('x.only', {}, sparse), 'nothing but {missing} here')
  })

  it('needs no params at all for a sentence that has no holes', () => {
    assert.equal(momentSentence('tch.moment.wellbeingShared', {}, t),
                 locales.he['tch.moment.wellbeingShared'])
  })
})

describe('every moment sentence that can lose a word has an unnamed twin', () => {
  /* The real guard. A new moment kind whose template interpolates something
     optional, shipped without its `.unnamed` variant, is exactly how the goal
     row got here — and this catches it in all three languages. */
  const OPTIONAL = new Set(['label', 'title', 'tag'])

  for (const [language, table] of Object.entries(locales)) {
    it(`holds in ${language}`, () => {
      const keys = Object.keys(table)
        .filter((key) => key.startsWith('tch.moment.') && !key.endsWith('.unnamed'))
      assert.ok(keys.length > 5, 'expected the moment sentences to exist')
      for (const key of keys) {
        const optional = placeholdersIn(table[key]).filter((name) => OPTIONAL.has(name))
        if (!optional.length) continue
        assert.ok(table[`${key}.unnamed`],
                  `${language}.${key} interpolates ${optional.join('/')} `
                  + 'but has no .unnamed variant')
        for (const name of optional) {
          assert.ok(!table[`${key}.unnamed`].includes(`{${name}}`),
                    `${language}.${key}.unnamed still interpolates {${name}}`)
        }
      }
    })
  }
})
