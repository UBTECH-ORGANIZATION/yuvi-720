/* Raw evidence → teacher-readable sentences.
 *
 * The MoE explainability rule says the raw datum must be SHOWABLE — it never
 * said it must look like a JSON dump. Every known evidence shape the backend
 * emits gets a real localized sentence; anything unrecognized degrades to a
 * "label: value" clause through the existing `tch.evidence.field.*` labels —
 * never to braces on a teacher's screen.
 *
 * Keys that are machine plumbing (event ids, session ids) are dropped: they
 * explain nothing to a teacher, and the honest number next to them does.
 */

type Translate = (key: string, params?: Record<string, string | number>) => string

/** Machine identifiers: real evidence to us, noise to a teacher. */
const HIDDEN = /(?:^|_)(?:id|ids)$|^timestamp|^window$|^timing_quality$|^min_group_evidence$/

function looksLikeIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T/.test(value)
}

function formatDate(value: string, language: string): string {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleDateString(
    language === 'he' ? 'he-IL' : language === 'ar' ? 'ar' : 'en-GB',
    { day: 'numeric', month: 'short' }
  )
}

function fieldLabel(key: string, t: Translate): string {
  const translated = t(`tch.evidence.field.${key}`)
  return translated === `tch.evidence.field.${key}` ? key.split('_').join(' ') : translated
}

function scalarText(value: unknown, t: Translate, language: string): string {
  if (typeof value === 'boolean') {
    return t(value ? 'tch.evidence.value.yes' : 'tch.evidence.value.no')
  }
  if (typeof value === 'number') {
    return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100)
  }
  if (typeof value === 'string') {
    return looksLikeIsoDate(value) ? formatDate(value, language) : value
  }
  return String(value)
}

/** Flatten any value into prose — never braces or brackets. */
function proseValue(value: unknown, t: Translate, language: string): string {
  if (Array.isArray(value)) {
    return value.map((item) => proseValue(item, t, language)).join(' · ')
  }
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .filter(([key, entry]) => !HIDDEN.test(key) && entry !== null && entry !== undefined)
      .map(([key, entry]) => `${fieldLabel(key, t)} ${scalarText(entry, t, language)}`)
      .join(', ')
  }
  return scalarText(value, t, language)
}

interface Template {
  /** Keys that must all be present for the template to apply. */
  needs: string[]
  /** Keys the template consumes (removed from the fallback pass). */
  consumes: string[]
  render: (raw: Record<string, unknown>, t: Translate, language: string) => string | null
}

const num = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

const TEMPLATES: Template[] = [
  { // struggle counters (mastery entry)
    needs: ['attempts', 'successes'],
    consumes: ['attempts', 'successes', 'failures', 'score_ewma', 'level', 'needs_review'],
    render: (raw, t) => {
      const attempts = num(raw.attempts) ?? 0
      const parts = [t('tch.evidence.sent.attempts', {
        attempts,
        successes: num(raw.successes) ?? 0,
        failures: num(raw.failures) ?? Math.max(0, attempts - (num(raw.successes) ?? 0)),
      })]
      const score = num(raw.score_ewma)
      if (score !== null) {
        parts.push(t('tch.evidence.sent.score', { score: Math.round(score * 100) / 100 }))
      }
      if (raw.needs_review === true) parts.push(t('tch.evidence.sent.needsReview'))
      return parts.join(' ')
    },
  },
  { // inactivity flag
    needs: ['days_inactive'],
    consumes: ['days_inactive', 'threshold', 'last_event_at'],
    render: (raw, t, language) => {
      const days = num(raw.days_inactive)
      if (days === null) return null
      let sentence = t('tch.evidence.sent.inactive', {
        days, threshold: num(raw.threshold) ?? days,
      })
      if (typeof raw.last_event_at === 'string') {
        sentence += ` ${t('tch.evidence.sent.lastSeen', {
          date: formatDate(raw.last_event_at, language),
        })}`
      }
      return sentence
    },
  },
  { // consecutive failures
    needs: ['fail_streak'],
    consumes: ['fail_streak', 'threshold'],
    render: (raw, t) => t('tch.evidence.sent.failStreak', {
      count: num(raw.fail_streak) ?? 0,
      threshold: num(raw.threshold) ?? 3,
    }),
  },
  { // rapid guessing
    needs: ['rapid_guesses'],
    consumes: ['rapid_guesses', 'window'],
    render: (raw, t) => t('tch.evidence.sent.rapid', {
      count: num(raw.rapid_guesses) ?? 0,
      window: num(raw.window) ?? 5,
    }),
  },
  { // wheel spinning
    needs: ['opportunities'],
    consumes: ['opportunities', 'spinning', 'successes'],
    render: (raw, t) => t('tch.evidence.sent.wheelSpinning', {
      count: num(raw.opportunities) ?? 0,
    }),
  },
  { // prolonged time on one question
    needs: ['elapsed_seconds'],
    consumes: ['elapsed_seconds', 'occurred_at'],
    render: (raw, t) => {
      const seconds = num(raw.elapsed_seconds)
      if (seconds === null) return null
      return t('tch.evidence.sent.prolonged', { minutes: Math.max(1, Math.round(seconds / 60)) })
    },
  },
  { // related goals — a count, not a list of ids
    needs: ['goal_ids'],
    consumes: ['goal_ids'],
    render: (raw, t) => {
      const goals = Array.isArray(raw.goal_ids) ? raw.goal_ids.length : 0
      return goals ? t('tch.evidence.sent.goals', { count: goals }) : null
    },
  },
  { // group gap / strength counters
    needs: ['struggling_count', 'with_evidence'],
    consumes: ['struggling_count', 'mastered_count', 'with_evidence', 'group_size',
      'struggle_share', 'mastery_share', 'threshold'],
    render: (raw, t) => t('tch.evidence.sent.gap', {
      struggling: num(raw.struggling_count) ?? 0,
      mastered: num(raw.mastered_count) ?? 0,
      withEvidence: num(raw.with_evidence) ?? 0,
      groupSize: num(raw.group_size) ?? 0,
    }),
  },
  { // common wrong-answer patterns
    needs: ['sample_misconceptions'],
    consumes: ['sample_misconceptions'],
    render: (raw, t) => {
      const samples = Array.isArray(raw.sample_misconceptions) ? raw.sample_misconceptions : []
      const parts = samples
        .filter((pair): pair is [string, number] => Array.isArray(pair) && pair.length >= 1)
        .map(([tag, count]) => (count && count > 1 ? `${tag} ×${count}` : String(tag)))
      return parts.length
        ? t('tch.evidence.sent.misconceptions', { list: parts.join(' · ') })
        : null
    },
  },
  { // wellbeing flag
    needs: ['open_flags'],
    consumes: ['open_flags', 'at', 'source', 'category'],
    render: (raw, t, language) => t('tch.evidence.sent.wellbeing', {
      count: num(raw.open_flags) ?? 1,
      date: typeof raw.at === 'string' ? formatDate(raw.at, language) : '—',
    }),
  },
  { // self-vs-system awareness
    needs: ['gap', 'samples'],
    consumes: ['gap', 'samples'],
    render: (raw, t) => t('tch.evidence.sent.awareness', {
      gap: scalarText(raw.gap, t, 'en'),
      samples: Array.isArray(raw.samples) ? raw.samples.length : num(raw.samples) ?? 0,
    }),
  },

  /* ── moments ──────────────────────────────────────────────────────────────
     The feed is the surface a teacher reads FASTEST, so "failures before: 32"
     was the worst place in the app to leave a key–value pair. Every kind the
     moments engine emits has a sentence here. */
  { // recovery — succeeded after failing on the same objective
    needs: ['failures_before'],
    consumes: ['failures_before', 'objective_id'],
    render: (raw, t) => t('tch.evidence.sent.recovery', {
      count: num(raw.failures_before) ?? 0,
    }),
  },
  { // first mastery — how much work it took to get there
    needs: ['attempts_before_first_success'],
    consumes: ['attempts_before_first_success', 'objective_id'],
    render: (raw, t) => t('tch.evidence.sent.firstMastery', {
      count: num(raw.attempts_before_first_success) ?? 0,
    }),
  },
  { // comeback — returned after a gap
    needs: ['days_away'],
    consumes: ['days_away', 'threshold', 'last_event_at'],
    render: (raw, t, language) => {
      const days = num(raw.days_away)
      if (days === null) return null
      let sentence = t('tch.evidence.sent.comeback', { days })
      if (typeof raw.last_event_at === 'string') {
        sentence += ` ${t('tch.evidence.sent.lastSeen', {
          date: formatDate(raw.last_event_at, language),
        })}`
      }
      return sentence
    },
  },
  { // sustained effort — one long, honest sitting
    needs: ['answers', 'minutes'],
    consumes: ['answers', 'minutes'],
    render: (raw, t) => t('tch.evidence.sent.sustained', {
      answers: num(raw.answers) ?? 0,
      minutes: num(raw.minutes) ?? 0,
    }),
  },
  { // a misconception that stopped coming back
    needs: ['tag'],
    consumes: ['tag', 'resolved_at', 'objective_id'],
    render: (raw, t, language) => {
      const sentence = t('tch.evidence.sent.misconceptionGone', { tag: String(raw.tag) })
      return typeof raw.resolved_at === 'string'
        ? `${sentence} ${t('tch.evidence.sent.onDate', {
            date: formatDate(raw.resolved_at, language),
          })}`
        : sentence
    },
  },
  { // something a child shared that needs a person — the flag itself, never the chat
    needs: ['category'],
    consumes: ['category', 'source', 'resolved', 'evidence'],
    render: (raw, t) => {
      const quoted = typeof raw.evidence === 'string' && raw.evidence.trim()
        ? t('tch.evidence.sent.sharedQuote', { text: raw.evidence.trim() })
        : t('tch.evidence.sent.shared')
      return raw.resolved
        ? `${quoted} ${t('tch.evidence.sent.sharedHandled')}`
        : quoted
    },
  },
  { // a goal carried to the end — who set it, and whether it was approved
    needs: ['source'],
    consumes: ['source', 'approved_by'],
    render: (raw, t) => {
      const source = String(raw.source || '')
      const who = source === 'teacher' || source === 'mentoring'
        ? t('tch.evidence.sent.goalFromTeacher')
        : t('tch.evidence.sent.goalFromLearner')
      return raw.approved_by ? `${who} ${t('tch.evidence.sent.goalApproved')}` : who
    },
  },
]

/** Turn a raw-evidence object into localized sentences. Never returns braces. */
export function describeEvidence(
  raw: Record<string, unknown> | null | undefined,
  t: Translate,
  language: string,
): string[] {
  if (!raw) return []
  const remaining: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (value === null || value === undefined || value === '') continue
    if (Array.isArray(value) && value.length === 0) continue
    // goal_ids is the one id-list a template turns into a human count.
    if (HIDDEN.test(key) && key !== 'goal_ids') continue
    remaining[key] = value
  }

  const sentences: string[] = []
  for (const template of TEMPLATES) {
    if (!template.needs.every((key) => key in remaining)) continue
    const sentence = template.render(remaining, t, language)
    for (const key of template.consumes) delete remaining[key]
    if (sentence) sentences.push(sentence)
  }

  // Whatever no template recognized still shows — as words, not JSON.
  for (const [key, value] of Object.entries(remaining)) {
    sentences.push(`${fieldLabel(key, t)}: ${proseValue(value, t, language)}`)
  }
  return sentences
}
