/** Which wording a cause gets, chosen from what the learner actually did.
 *
 * Without this every learner whose motivation slipped reads the same sentence,
 * however differently their week went — "you came in on fewer days" is not the
 * same message as "you didn't come in at all", and a child can tell.
 *
 * Returns '' to fall back to the plain per-cause sentence.
 */
export type DriverFacts = Record<string, number>

export function variantFor(tag: string, dir: 'up' | 'down', f?: DriverFacts): string {
    if (!f) return ''
    const n = (k: string) => (typeof f[k] === 'number' ? f[k] : null)
    const cmp = (k: string): [number | null, number | null] => [n(k), n(`${k}_prior`)]

    if (tag === 'inconsistent') {
        const [days, was] = cmp('active_days')
        if (days == null) return ''
        if (dir === 'down') return days === 0 ? 'none' : was != null && days < was ? 'fewer' : ''
        return was != null && days > was ? 'more' : ''
    }
    if (tag === 'low_engagement') {
        const done = n('completions')
        const started = n('objectives')
        if (done == null || started == null || started === 0) return ''
        if (dir === 'down') return done === 0 ? 'none' : done < started ? 'partial' : ''
        return done >= started ? 'all' : ''
    }
    if (tag === 'quits_on_fail') {
        const failed = n('failed_objs')
        const back = n('recovered_objs')
        if (failed == null || back == null || failed === 0) return ''
        return dir === 'down' ? (back === 0 ? 'none' : '') : back > 0 ? 'some' : ''
    }
    if (tag === 'hint_reliance' || tag === 'guessing') {
        const [now, was] = cmp(tag === 'guessing' ? 'guesses' : 'n_hint')
        if (now == null || was == null) return ''
        return dir === 'down' ? (now > was ? 'more' : '') : now < was ? 'fewer' : ''
    }
    if (tag === 'low_reflection') {
        const [now, was] = cmp('reflections')
        if (now == null) return ''
        if (dir === 'down') return now === 0 ? 'none' : was != null && now < was ? 'fewer' : ''
        return was != null && now > was ? 'more' : ''
    }
    if (tag === 'isolation') {
        const asks = n('n_hint')
        const stuck = n('failures')
        if (asks == null) return ''
        if (dir === 'down') return asks === 0 && (stuck ?? 0) > 0 ? 'none' : ''
        return asks > 0 ? 'some' : ''
    }
    return ''
}
