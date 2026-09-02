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

/* Extension spelled out: `node --test` loads this module directly and resolves
   imports literally. See the note in tsconfig.json. */
import { subjectLabel } from './subjectLabel.ts'

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
    if (looksLikeIsoDate(value)) return formatDate(value, language)
    // Vendor and coach diagnostic tags (`sign-error`, `place-value`,
    // `unit-confusion`…) reach evidence verbatim. The known ones get their
    // pedagogic Hebrew; a tag nobody has mapped yet degrades to a
    // de-hyphenated phrase — never to a raw machine code (#508).
    const tagged = t(`tch.tag.${value}`)
    if (tagged !== `tch.tag.${value}`) return tagged
    if (/^[a-z][a-z0-9]*([-_][a-z0-9]+)+$/.test(value)) return value.split(/[-_]/).join(' ')
    return value
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
  /* ── the habit-score sub-scores (PBI 451) ─────────────────────────────────
     FIRST in the list on purpose: these key pairs are specific, and the older
     detector templates below would otherwise consume a shared key (observed:
     `rapid_guesses` swallowed by the A-3 nudge sentence, which then claimed
     "the last 5 questions" about a 7-day window). Each sub-score's counters,
     told as the one sentence a teacher would ask for. */
  {
    needs: ['support_requests', 'after_own_attempt'],
    consumes: ['support_requests', 'after_own_attempt'],
    render: (raw, t) => t('tch.evidence.sent.score.tried', {
      total: num(raw.support_requests) ?? 0,
      after: num(raw.after_own_attempt) ?? 0,
    }),
  },
  {
    needs: ['labels', 'scored_messages'],
    consumes: ['labels', 'scored_messages'],
    render: (raw, t) => {
      const labels = (raw.labels ?? {}) as Record<string, unknown>
      const listed = Object.entries(labels)
        .filter(([, count]) => num(count))
        .map(([label, count]) => `${fieldLabel(label, t)} ×${num(count)}`)
        .join(', ')
      return listed
        ? t('tch.evidence.sent.score.quality', { list: listed })
        : t('tch.evidence.sent.score.qualityNone')
    },
  },
  {
    needs: ['solved', 'unassisted'],
    consumes: ['solved', 'unassisted'],
    render: (raw, t) => t('tch.evidence.sent.score.unassisted', {
      solved: num(raw.solved) ?? 0,
      unassisted: num(raw.unassisted) ?? 0,
    }),
  },
  {
    needs: ['struggled_questions', 'gave_up'],
    consumes: ['struggled_questions', 'gave_up'],
    render: (raw, t) => t('tch.evidence.sent.score.persistence', {
      struggled: num(raw.struggled_questions) ?? 0,
      gaveUp: num(raw.gave_up) ?? 0,
    }),
  },
  {
    needs: ['struggle_runs', 'recovered'],
    consumes: ['struggle_runs', 'recovered'],
    render: (raw, t) => t('tch.evidence.sent.score.recovery', {
      runs: num(raw.struggle_runs) ?? 0,
      recovered: num(raw.recovered) ?? 0,
    }),
  },
  {
    needs: ['support_decisions', 'ladder_max'],
    consumes: ['support_decisions', 'mean_hint_level', 'ladder_max'],
    render: (raw, t) => t('tch.evidence.sent.score.depth', {
      times: num(raw.support_decisions) ?? 0,
      mean: num(raw.mean_hint_level) ?? 0,
      max: num(raw.ladder_max) ?? 1,
    }),
  },
  {
    needs: ['idle_episodes', 'lesson_seconds'],
    consumes: ['idle_episodes', 'idle_seconds_min', 'lesson_seconds'],
    render: (raw, t) => t('tch.evidence.sent.score.idle', {
      episodes: num(raw.idle_episodes) ?? 0,
      idleMinutes: Math.round((num(raw.idle_seconds_min) ?? 0) / 60),
      lessonMinutes: Math.round((num(raw.lesson_seconds) ?? 0) / 60),
    }),
  },
  {
    needs: ['answers', 'rapid_guesses'],
    consumes: ['answers', 'rapid_guesses'],
    render: (raw, t) => t('tch.evidence.sent.score.rapid', {
      answers: num(raw.answers) ?? 0,
      rapid: num(raw.rapid_guesses) ?? 0,
    }),
  },
  {
    needs: ['work_sessions', 'sustained_streaks'],
    consumes: ['work_sessions', 'sustained_streaks'],
    render: (raw, t) => t('tch.evidence.sent.score.sustained', {
      sessions: num(raw.work_sessions) ?? 0,
      streaks: num(raw.sustained_streaks) ?? 0,
    }),
  },
  {
    needs: ['labeled_messages', 'off_topic'],
    consumes: ['labeled_messages', 'off_topic'],
    render: (raw, t) => t('tch.evidence.sent.score.offtopic', {
      total: num(raw.labeled_messages) ?? 0,
      off: num(raw.off_topic) ?? 0,
    }),
  },

  /* ── a hard question's difficulty row (#455) ──────────────────────────────
     The claim is "these children found this question hard"; the datum is who
     tried and who never got it, plus the rule that made the row exist. */
  {
    needs: ['tried_count', 'failed_count'],
    consumes: ['tried_count', 'failed_count',
      'hard_question_min_attempts', 'hard_question_max_success'],
    render: (raw, t) => {
      const parts = [t('tch.why.hardQuestion', {
        failed: num(raw.failed_count) ?? 0,
        tried: num(raw.tried_count) ?? 0,
      })]
      const attempts = num(raw.hard_question_min_attempts)
      const rate = num(raw.hard_question_max_success)
      if (attempts !== null && rate !== null) {
        parts.push(t('tch.why.hardQuestionRule', {
          attempts, percent: Math.round(rate * 100),
        }))
      }
      return parts.join(' ')
    },
  },
  /* ── the coach's own detectors, mirrored onto a teacher alert ─────────────
     `teacher_alerts.escalate_trigger` stores the trigger payload verbatim as
     the alert's evidence, so "why?" opened onto the detector's internals:

         type: wheel_spinning
         early warning: כן
         alternative: title Hear the difference, media format audio

     A teacher reading that cannot tell what was counted, what "failure" means
     here, or what Yuvi did about it. All three are answerable — the counters
     are in the payload and the rule is ours — so they are answered. */
  {
    needs: ['type'],
    consumes: ['type', 'objective_id', 'question_id', 'session_id',
      'misconception', 'streak', 'opportunities', 'early_warning', 'reason'],
    render: (raw, t) => {
      const kind = String(raw.type || '')
      const parts: string[] = []

      if (kind === 'misconception') {
        const streak = num(raw.streak)
        parts.push(streak === null
          ? t('tch.evidence.sent.det.misconception')
          : t('tch.evidence.sent.det.misconceptionN', { count: streak }))
        const tag = typeof raw.misconception === 'string' ? raw.misconception.trim() : ''
        if (tag) parts.push(t('tch.evidence.sent.det.pattern', { tag: misconceptionLabel(tag, t) }))
        // What "failure" means here, said once and in the same breath as the
        // count — a number of failures is only readable next to its definition.
        parts.push(t('tch.evidence.sent.det.whatCounts'))
      } else if (kind === 'wheel_spinning') {
        parts.push(t('tch.evidence.sent.det.wheel', {
          count: num(raw.opportunities) ?? 0,
        }))
        if (raw.early_warning === true) parts.push(t('tch.evidence.sent.det.early'))
        parts.push(t('tch.evidence.sent.det.whatCounts'))
      } else if (kind === 'rapid_guessing') {
        parts.push(t('tch.evidence.sent.det.rapid'))
      } else {
        // A detector kind nobody has written a sentence for yet. The label
        // exists (it is what the alert's own pill uses), so this stays prose.
        const label = t(`tch.evidence.detector.${kind}`)
        if (label !== `tch.evidence.detector.${kind}`) parts.push(label)
      }
      return parts.length ? parts.join(' ') : null
    },
  },
  { // what Yuvi offered instead — the 720 "different representation" response
    needs: ['alternative'],
    consumes: ['alternative'],
    render: (raw, t) => {
      const alternative = raw.alternative as
        { title?: string; media_format?: string } | null
      const title = String(alternative?.title || '').trim()
      if (!title) return null
      const format = String(alternative?.media_format || '').trim()
      return format
        ? t('tch.evidence.sent.det.alternativeAs', { title, format })
        : t('tch.evidence.sent.det.alternative', { title })
    },
  },
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
  { /* wheel spinning, as the daily insight computes it (no `type` key — the
       alert path above catches the detector's own payload first). `mastered`
       and `early_warning` are consumed here too: left over, they printed as
       "early warning: כן" under a sentence that had already said it. */
    needs: ['opportunities'],
    consumes: ['opportunities', 'spinning', 'successes', 'mastered', 'early_warning'],
    render: (raw, t) => {
      const sentence = t('tch.evidence.sent.wheelSpinning', {
        count: num(raw.opportunities) ?? 0,
      })
      const parts = [sentence]
      if (raw.early_warning === true) parts.push(t('tch.evidence.sent.det.early'))
      parts.push(t('tch.evidence.sent.det.whatCounts'))
      return parts.join(' ')
    },
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
        .map(([tag, count]) => {
          const label = misconceptionLabel(tag, t)
          return count && count > 1 ? `${label} ×${count}` : label
        })
        .filter(Boolean)
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
  { // personal best, the streak story — school days of practice in a row
    needs: ['streak_days'],
    consumes: ['streak_days', 'last_day'],
    render: (raw, t, language) => {
      const sentence = t('tch.evidence.sent.practiceStreak', {
        days: num(raw.streak_days) ?? 0,
      })
      return typeof raw.last_day === 'string'
        ? `${sentence} ${t('tch.evidence.sent.onDate', {
            date: formatDate(raw.last_day, language),
          })}`
        : sentence
    },
  },
  { // personal best, the best-day story — beat their own busiest day
    needs: ['answers', 'previous_best'],
    consumes: ['answers', 'previous_best', 'date'],
    render: (raw, t, language) => {
      const sentence = t('tch.evidence.sent.bestDay', {
        answers: num(raw.answers) ?? 0,
        previous: num(raw.previous_best) ?? 0,
      })
      return typeof raw.date === 'string'
        ? `${sentence} ${t('tch.evidence.sent.onDate', {
            date: formatDate(raw.date, language),
          })}`
        : sentence
    },
  },
  { // a heavy morning that still became a learning day
    needs: ['valence'],
    consumes: ['valence', 'feeling', 'date', 'answers'],
    render: (raw, t, language) => {
      const sentence = t('tch.evidence.sent.feelingsJourney', {
        answers: num(raw.answers) ?? 0,
      })
      return typeof raw.date === 'string'
        ? `${sentence} ${t('tch.evidence.sent.onDate', {
            date: formatDate(raw.date, language),
          })}`
        : sentence
    },
  },
  { // cracked a question most of the class finds hard
    needs: ['class_success_rate'],
    consumes: ['class_success_rate', 'class_attempts', 'question_key', 'tried_count'],
    render: (raw, t) => t('tch.evidence.sent.classHard', {
      tried: num(raw.tried_count) ?? 0,
      percent: Math.round((num(raw.class_success_rate) ?? 0) * 100),
    }),
  },
  { // a misconception that stopped coming back
    needs: ['tag'],
    consumes: ['tag', 'resolved_at', 'objective_id'],
    render: (raw, t, language) => {
      const sentence = t('tch.evidence.sent.misconceptionGone', { tag: misconceptionLabel(raw.tag, t) })
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

/* ── why a recommendation was made ──────────────────────────────────────────
 *
 * `describeEvidence` is shape-driven, which is right for a flag: the same
 * counters mean the same thing wherever they come from. A recommendation is
 * different — it already knows its own `signal`, and the signal names the
 * sentence exactly. Shape-matching it produced the screenshot a teacher
 * actually saw under "why?":
 *
 *     subject: science / objectives total: 1 / objectives mastered: 1 /
 *     objectives in progress: 0 / percent: 100
 *
 * which is the reason expressed as a payload. One signal, one sentence.
 */
type SignalSentence = (
  raw: Record<string, unknown>,
  value: unknown,
  t: Translate,
  language: string,
) => string | null

const SIGNAL_SENTENCE: Record<string, SignalSentence> = {
  days_inactive: (raw, value, t, language) => {
    const days = num(raw.days_inactive) ?? num(value) ?? 0
    const last = typeof raw.last_activity_at === 'string'
      ? formatDate(raw.last_activity_at, language) : null
    return t(last ? 'tch.why.inactiveSince' : 'tch.why.inactive', {
      days, threshold: num(raw.threshold) ?? days, date: last ?? '',
    })
  },
  trailing_fail_streak: (raw, value, t) => {
    const count = num(raw.fail_streak) ?? num(value) ?? 0
    const topic = typeof raw.objective_title === 'string' ? raw.objective_title.trim() : ''
    return t(topic ? 'tch.why.failStreakAt' : 'tch.why.failStreak', { count, topic })
  },
  distress_with_failure: (raw, value, t) => t('tch.why.distressWithFailure', {
    count: num(raw.fail_streak) ?? num(value) ?? 0,
    flags: num(raw.open_flags) ?? 1,
  }),
  prolonged_interaction: (raw, value, t) => {
    const seconds = num(raw.elapsed_seconds) ?? num(value)
    if (seconds === null) return null
    return t('tch.why.prolonged', { minutes: Math.max(1, Math.round(seconds / 60)) })
  },
  subject_mastery_percent: (raw, value, t) => t('tch.why.subjectMastery', {
    subject: subjectLabel(raw.subject as string | null | undefined, t),
    mastered: num(raw.objectives_mastered) ?? 0,
    total: num(raw.objectives_total) ?? 0,
    percent: num(raw.percent) ?? num(value) ?? 0,
  }),
  /* ── the dashboard band's reasons (#450) ─────────────────────────────────
     Each signal the classifier can emit gets its sentence; the classifier
     prefers emitting names that already exist above (days_inactive,
     trailing_fail_streak) where the shape matches. */
  wellbeing_distress: (_raw, _value, t) => t('tch.why.wellbeingDistress'),
  blocked_message: (raw, _value, t) => t('tch.why.blockedMessage', {
    count: num(raw.count) ?? 1,
  }),
  heavy_feeling_today: (raw, _value, t) => {
    const feeling = typeof raw.feeling === 'string' ? raw.feeling : ''
    return t('tch.why.heavyFeeling', {
      feeling: feeling ? t(`checkin.feeling.${feeling}`) : t('tch.why.heavyFeelingPlain'),
    })
  },
  fail_streak: (raw, value, t) => t('tch.why.failStreak', {
    count: num(raw.fail_streak) ?? num(value) ?? 3, topic: '',
  }),
  wheel_spinning: (raw, _value, t) => t('tch.why.wheelSpinning', {
    attempts: num(raw.opportunities) ?? num(raw.attempts) ?? 10,
  }),
  rapid_guessing: (raw, _value, t) => t('tch.why.rapidGuessing', {
    count: num(raw.count) ?? num(raw.rapid_guesses) ?? 3,
  }),
  answer_cycling: (_raw, _value, t) => t('tch.why.answerCycling'),
  overdue_goal: (raw, _value, t) => {
    const title = typeof raw.goal_text === 'string' ? raw.goal_text.trim() : ''
    return t(title ? 'tch.why.overdueGoalTitled' : 'tch.why.overdueGoal', { title })
  },
  help_requested: (_raw, _value, t) => t('tch.why.helpUnanswered'),
  high_mastery: (raw, _value, t) => t('tch.why.highMastery', {
    percent: Math.round((num(raw.score_ewma) ?? 0) * 100),
  }),
  mastery_level_confirmed: (raw, _value, t) => t('tch.why.masteryConfirmed', {
    percent: Math.round((num(raw.score_ewma) ?? 0) * 100),
  }),
  success_streak: (raw, _value, t) => t('tch.why.successStreak', {
    count: num(raw.streak) ?? 3,
  }),
  subject_strength: (raw, _value, t) => t('tch.why.subjectStrength', {
    subject: subjectLabel(raw.subject as string | null | undefined, t),
    percent: num(raw.percent) ?? 80,
  }),
  improving_week: (raw, _value, t) => {
    const now = num(raw.rate_now)
    if (now !== null) {
      return t('tch.why.improvingRates', {
        now: Math.round(now * 100),
        before: Math.round((num(raw.rate_prior) ?? 0) * 100),
      })
    }
    return t('tch.why.improvingMastery')
  },
  insufficient_evidence: (_raw, _value, t) => t('tch.why.insufficientEvidence'),
  steady: (_raw, _value, t) => t('tch.why.steady'),
  existing_strength: (raw, value, t) => {
    const labels = Array.isArray(raw.labels)
      ? raw.labels.map((entry) => String(entry).trim()).filter(Boolean) : []
    return labels.length
      ? t('tch.why.strengths', { list: labels.join(' · ') })
      : t('tch.why.strengthsCount', { count: num(value) ?? 0 })
  },
  /* The three a teacher goal draft can be grounded in. The backend now sends
     the few words behind each — the objective labels, the challenges, one line
     of the description — instead of the evidence object it handed the model. */
  struggle_items: (raw, _value, t) => {
    const labels = list(raw.labels)
    return labels.length ? t('tch.why.goalGaps', { list: labels.join(' · ') }) : null
  },
  challenges: (raw, _value, t) => {
    /* Challenges arrive two ways: as bare strings from the goal drafts, and as
       `{label, status}` objects from the brain view the prep sheet reads. The
       string-only version returned null for the second, which dropped through
       to the generic renderer and printed
       `0: {'label': '...', 'status': 'working'}` under a Hebrew sentence. */
    const items = list(raw.challenges).length ? list(raw.challenges)
      : (Array.isArray(raw.challenges) ? raw.challenges : [])
        .map((entry) => (entry && typeof entry === 'object'
          ? String((entry as Record<string, unknown>).label ?? '').trim() : ''))
        .filter(Boolean)
    return items.length ? t('tch.why.goalChallenges', { list: items.join(' · ') }) : null
  },
  student_description: (raw, _value, t) => {
    const observation = typeof raw.observation === 'string' ? raw.observation.trim() : ''
    return observation ? t('tch.why.goalDescription', { observation }) : null
  },
  /* The prep sheet's own three. `strengths` and `open_goals` arrive as label
     lists like the two above; the other two are the learnings map and whether
     the child has been here at all — the numbers a prep line rests on when it
     claims something moved. */
  strengths: (raw, _value, t) => {
    const labels = list(raw.labels)
    return labels.length ? t('tch.why.strengths', { list: labels.join(' · ') }) : null
  },
  open_goals: (raw, _value, t) => {
    const labels = list(raw.labels)
    return labels.length ? t('tch.why.openGoals', { list: labels.join(' · ') }) : null
  },
  objectives_progress: (raw, _value, t) => {
    const rows = Object.entries(raw)
      .filter((entry): entry is [string, Record<string, unknown>] =>
        Boolean(entry[1]) && typeof entry[1] === 'object')
      .slice(0, 2)
    if (!rows.length) return null
    return rows.map(([subject, row]) => t('tch.why.objectivesMap', {
      subject: subjectLabel(subject, t),
      mastered: num(row.mastered) ?? 0,
      total: num(row.total) ?? 0,
    })).join(' · ')
  },
  activity: (raw, _value, t, language) => {
    // "Never opened anything" and "quiet for nine days" are different facts,
    // and a prep line resting on either should say which.
    if (raw.started === false) return t('tch.why.neverStarted')
    const last = typeof raw.last_event_at === 'string'
      ? formatDate(raw.last_event_at, language) : null
    const days = num(raw.days_inactive)
    if (last) return t('tch.why.lastActive', { date: last, days: days ?? 0 })
    return null
  },
  /* The teacher's own sentence, from the write-up they just finished — the one
     piece of grounding they can check without leaving the screen. */
  conversation: (raw, _value, t) => {
    const observation = typeof raw.observation === 'string' ? raw.observation.trim() : ''
    return observation ? t('tch.why.goalConversation', { observation }) : null
  },
  no_evidence: (_raw, _value, t) => t('tch.why.noEvidence'),
  // The engine emitted no signal at all — say so, rather than dressing a
  // default up as a finding.
  default: (_raw, _value, t) => t('tch.why.noSignal'),
}

/** A string list from raw evidence, trimmed and de-blanked. */
function list(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((entry) => String(entry).trim()).filter(Boolean)
    : []
}

/** The one-sentence reason behind a recommendation.
 *
 * Falls back to the generic evidence rendering for a signal nobody has written
 * a sentence for yet — a new backend signal degrades to readable prose rather
 * than to a missing "why?". */
/* The vendor's misconception tags — `sign-error`, `unit-confusion` — reached
 * the screen verbatim inside a Hebrew sentence (#511). The vocabulary is the
 * content's and open-ended, so this is a dictionary for the tags seen so far
 * and a readable fallback for the rest: dashes and underscores become spaces,
 * and the tag is quoted so it reads as a name, never as broken copy. */
const TAG_KEY = /[^a-z0-9]+/g

export function misconceptionLabel(tag: unknown, t: Translate): string {
  const raw = String(tag ?? '').trim()
  if (!raw) return ''
  const key = `tch.misconception.${raw.toLowerCase().replace(TAG_KEY, '_').replace(/^_|_$/g, '')}`
  const known = t(key)
  if (known !== key) return known
  return `“${raw.replace(/[-_]+/g, ' ')}”`
}

export function describeSignal(
  signal: string,
  value: unknown,
  raw: Record<string, unknown> | null | undefined,
  t: Translate,
  language: string,
): string[] {
  const write = SIGNAL_SENTENCE[signal]
  if (write) {
    const sentence = write(raw ?? {}, value, t, language)
    if (sentence) return [sentence]
  }
  const label = t(`tch.signal.${signal}`)
  const head = label === `tch.signal.${signal}` ? null
    : value === null || value === undefined ? label : `${label}: ${scalarText(value, t, language)}`
  return [head, ...describeEvidence(raw, t, language)].filter((line): line is string => !!line)
}

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
