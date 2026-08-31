/* Every wording the driver card can ask for must exist in all three locales.
 *
 * `t()` returns the raw key on a miss, so a variant added in code but not in
 * `locales/*.json` puts `actmap.why.guessing.down.more` in front of a child —
 * silently, and only for the learners whose week happens to select it. Locale
 * parity cannot catch this: a key missing from all three files is still parity.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

import { variantFor } from '../src/features/student-dashboard/driverVariants.ts'

const here = dirname(fileURLToPath(import.meta.url))
const localesDir = join(here, '..', '..', 'locales')
const LANGS = ['he', 'en', 'ar'] as const
const load = (lang: string): Record<string, string> =>
    JSON.parse(readFileSync(join(localesDir, `${lang}.json`), 'utf8'))

const TAGS = [
    'inconsistent', 'low_engagement', 'quits_on_fail', 'hint_reliance',
    'guessing', 'low_reflection', 'isolation',
] as const

// Enough shapes to drive every branch: nothing at all, a drop to zero, a fall,
// a rise, and a full sweep.
const SHAPES: Record<string, number>[] = [
    {},
    { active_days: 0, active_days_prior: 5, completions: 0, objectives: 3, failed_objs: 2, recovered_objs: 0, n_hint: 0, n_hint_prior: 4, guesses: 0, guesses_prior: 6, reflections: 0, reflections_prior: 3, failures: 4 },
    { active_days: 2, active_days_prior: 6, completions: 1, objectives: 4, failed_objs: 3, recovered_objs: 1, n_hint: 7, n_hint_prior: 2, guesses: 9, guesses_prior: 1, reflections: 1, reflections_prior: 5, failures: 3 },
    { active_days: 7, active_days_prior: 2, completions: 4, objectives: 4, failed_objs: 2, recovered_objs: 2, n_hint: 1, n_hint_prior: 6, guesses: 1, guesses_prior: 8, reflections: 6, reflections_prior: 1, failures: 1 },
    { active_days: 3, active_days_prior: 3, completions: 2, objectives: 2, failed_objs: 0, recovered_objs: 0, n_hint: 3, n_hint_prior: 3, guesses: 2, guesses_prior: 2, reflections: 2, reflections_prior: 2, failures: 0 },
]

test('every driver wording the card can select exists in he/en/ar', () => {
    const bundles = LANGS.map((lang) => [lang, load(lang)] as const)
    const asked = new Set<string>()

    for (const tag of TAGS) {
        for (const dir of ['up', 'down'] as const) {
            for (const facts of SHAPES) {
                const variant = variantFor(tag, dir, facts)
                asked.add(variant ? `actmap.why.${tag}.${dir}.${variant}` : `actmap.why.${tag}.${dir}`)
            }
        }
    }

    assert.ok(asked.size > TAGS.length * 2, 'no variants selected — the check is vacuous')

    for (const key of [...asked].sort()) {
        for (const [lang, bundle] of bundles) {
            assert.ok(key in bundle, `${key} missing from ${lang}.json`)
            assert.ok(String(bundle[key]).trim(), `${key} is blank in ${lang}.json`)
        }
    }
})

test('a cause with no facts falls back to its plain sentence', () => {
    for (const tag of TAGS) {
        for (const dir of ['up', 'down'] as const) {
            assert.equal(variantFor(tag, dir, undefined), '')
        }
    }
})
