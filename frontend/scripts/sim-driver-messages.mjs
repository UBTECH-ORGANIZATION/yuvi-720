/* Resolve simulated drivers into the exact string a learner would read.
 *
 * Uses the production `variantFor` and the real he.json, so what prints here is
 * what the card prints — not a paraphrase of it.
 */
import { readFileSync } from 'node:fs'
import { variantFor } from '../src/features/student-dashboard/driverVariants.ts'

const he = JSON.parse(readFileSync(new URL('../../locales/he.json', import.meta.url), 'utf8'))
const NAMES = {
    motivation_relevance: 'מוטיבציה ורלוונטיות',
    growth_mindset: 'תפיסת צמיחה',
    initiative_responsibility: 'יוזמה ואחריות',
    self_regulation: 'ויסות עצמי',
    self_awareness: 'מודעות עצמית',
    support_emotional: 'תמיכה וחוויה רגשית',
}
const ALLOWED = new Set([
    'inconsistent', 'low_engagement', 'quits_on_fail', 'hint_reliance',
    'guessing', 'low_reflection', 'isolation',
])

const scenarios = JSON.parse(readFileSync(0, 'utf8'))

for (const { scenario, domains } of scenarios) {
    console.log('\n━━━ ' + scenario + ' ━━━')
    // The card only draws a domain that cleared the change threshold.
    const moved = domains.filter((d) => d.shown)
    if (!moved.length) {
        console.log('   (nothing clears the 4-point threshold — six steady emblems)')
        continue
    }
    for (const d of moved) {
        const wantDir = d.delta >= 0 ? 'up' : 'down'
        // Exactly what driverFor() does: first driver pushing the same way.
        const picked = d.drivers.find((x) => x.dir === wantDir && ALLOWED.has(x.tag)) ?? null
        const variant = picked ? variantFor(picked.tag, picked.dir, picked.facts) : ''
        const key = picked
            ? (variant ? `actmap.why.${picked.tag}.${picked.dir}.${variant}` : `actmap.why.${picked.tag}.${picked.dir}`)
            : 'actmap.change.fallback'
        const arrow = d.delta > 0 ? '▲' : '▼'
        console.log(`  ${NAMES[d.key]}  ${d.prior}→${d.value} ${arrow}${Math.abs(d.delta)}`)
        console.log(`     "${he[key]}"`)
        if (picked) {
            console.log(`     ← ${picked.tag}:${picked.dir}${variant ? ' / ' + variant : ' / plain'}` +
                (picked.lesson ? ' + lesson name' : ''))
            const others = d.drivers.filter((x) => x !== picked).map((x) => `${x.tag}:${x.dir}`)
            if (others.length) console.log(`       (also moved, not shown: ${others.join(', ')})`)
        } else {
            console.log(`     ← NO usable driver — generic fallback` +
                (d.drivers.length ? ` (drivers point the other way: ${d.drivers.map((x) => x.tag + ':' + x.dir).join(', ')})` : ` (confidence ${d.conf})`))
        }
        if (d.delta < 0) console.log('     + "לשאול את יובי למה" button → opens the chat')
    }
}
