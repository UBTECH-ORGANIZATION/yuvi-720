/* Every activeness domain needs its own improvement advice, in all three
 * languages.
 *
 * `t()` returns the raw key on a miss, so a domain with no entry would put
 * `actmap.improve.self_regulation` in front of a child. Locale parity cannot
 * catch that: a key missing from all three files is still parity.
 *
 * The uniqueness check is the point of the feature — the six domains ask for
 * six different things, and one shared sentence ("keep going!") teaches none of
 * them.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

/** `COMPETENCY_ORDER` in app/services/dashboard.py. */
const DOMAINS = [
    'motivation_relevance', 'growth_mindset', 'initiative_responsibility',
    'self_regulation', 'self_awareness', 'support_emotional',
]

const here = dirname(fileURLToPath(import.meta.url))
const localeDir = join(here, '..', '..', 'locales')
const locales = ['he', 'en', 'ar'].map((lang) => ({
    lang,
    strings: JSON.parse(readFileSync(join(localeDir, `${lang}.json`), 'utf8')) as Record<string, string>,
}))

test('every domain has improvement advice in all three languages', () => {
    const missing: string[] = []
    for (const key of [...DOMAINS.map((d) => `actmap.improve.${d}`), 'actmap.improve.fallback']) {
        for (const { lang, strings } of locales) {
            if (!strings[key]) missing.push(`${lang}:${key}`)
        }
    }
    assert.deepEqual(missing, [])
})

test('each domain gets its own sentence, never a shared one', () => {
    for (const { lang, strings } of locales) {
        const tips = DOMAINS.map((d) => strings[`actmap.improve.${d}`])
        assert.equal(new Set(tips).size, DOMAINS.length, `${lang} reuses an improvement tip`)
    }
})

test('the advice is substantial enough to act on, and never the fallback', () => {
    for (const { lang, strings } of locales) {
        for (const domain of DOMAINS) {
            const tip = strings[`actmap.improve.${domain}`]
            assert.notEqual(tip, strings['actmap.improve.fallback'], `${lang}:${domain} fell back`)
            assert.ok(tip.length > 30, `${lang}:${domain} is too thin to act on`)
        }
    }
})
