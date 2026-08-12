/* One line of the brief, and the three things a teacher can do with it.
 *
 * The bullet used to be a sentence with a "למה?" disclosure and nothing else,
 * which made the most-read object on the dashboard a dead end: it could tell a
 * teacher four children had not started and give them no way to reach any of
 * the four.
 *
 * Three independent controls now, deliberately not nested inside one another:
 *
 *   the sentence  → an overlay link to where the claim lives
 *   the faces     → each child's own profile
 *   "למה?"        → the evidence, in place
 *
 * The overlay is a positioned `<a>` rather than a `<button>` wrapping the row,
 * because a button containing buttons is invalid and unusable by keyboard: the
 * inner controls become unreachable. The overlay sits *under* the chips and
 * the toggle in stacking order, so they win the click that lands on them.
 */

import { useState } from 'react'
import { navigate } from '../../../app/router'
import { Icon } from '../../../components/primitives'
import { useI18n } from '../../../i18n/I18nProvider'
import { useTeacherRoster } from '../../../providers/TeacherRosterProvider'
import type { BriefBullet } from '../../../services/teacher'
import { EvidenceToggle } from '../shared/EvidenceDisclosure'
import { StudentAvatar } from '../shared/StudentAvatar'

/** Faces before the row becomes a second roster. */
const MAX_FACES = 4

type Translate = (key: string, params?: Record<string, string | number>) => string

/** Where a claim leads, by the signal it stands on.
 *
 * Read from `because.signal`, which already round-trips to the client — the
 * destination is code's decision, like the people are. A signal with no entry
 * renders as text with no affordance, which is the honest option: a row that
 * looks clickable and goes nowhere is worse than one that does not.
 */
function routeFor(bullet: BriefBullet): string | null {
  const because = bullet.because
  if (!because) return null
  const raw = (because.raw ?? {}) as Record<string, unknown>
  const signal = because.signal ?? ''

  if (signal === 'learning_gap' || signal === 'worked_on') {
    const objectiveId = raw.objective_id
    return typeof objectiveId === 'string' && objectiveId
      ? `/teacher/learnings/${encodeURIComponent(objectiveId)}`
      : '/teacher/learnings'
  }
  if (signal === 'not_started') return '/teacher/students?filter=not_started'
  if (signal === 'needing_attention' || signal.startsWith('attention_')) {
    return '/teacher/students?filter=attention'
  }
  if (signal === 'active_in_window' || signal === 'active_pct') {
    return '/teacher/students?filter=active'
  }
  if (signal === 'goals_awaiting_approval' || signal === 'goals_needing_help') {
    return '/teacher/goals'
  }
  if (signal === 'subject_progress' || signal === 'objectives_mastered_total') {
    return '/teacher/learnings'
  }
  return null
}

export function BriefBulletRow({ bullet, t }: { bullet: BriefBullet; t: Translate }) {
  const { nameOf } = useTeacherRoster()
  const { t: translate } = useI18n()
  const [showWhy, setShowWhy] = useState(false)

  const route = routeFor(bullet)
  const people = bullet.learner_ids ?? []
  const visible = people.slice(0, MAX_FACES)
  const rest = people.length - visible.length

  const text = bullet.text
    ? bullet.text
    : bullet.text_key
      ? t(bullet.text_key, (bullet.params ?? {}) as Record<string, string | number>)
      : ''

  return (
    <li className={`tch-brief__bullet${route ? ' is-linked' : ''}`}>
      {route ? (
        <a
          className="tch-brief__bulletLink"
          href={route}
          aria-label={text}
          onClick={(event) => {
            // Left-click only: cmd/ctrl-click and middle-click should still
            // open a new tab, which is what the real href is for.
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
            event.preventDefault()
            navigate(route)
          }}
        />
      ) : null}

      <span className="tch-brief__bulletText" dir="auto">{text}</span>

      <div className="tch-brief__bulletFoot">
        {visible.length ? (
          <span className="tch-brief__people">
            {visible.map((learnerId) => (
              <button
                key={learnerId}
                type="button"
                className="tch-brief__person"
                title={nameOf(learnerId) ?? learnerId}
                onClick={() => navigate(`/teacher/student/${encodeURIComponent(learnerId)}`)}
              >
                <StudentAvatar learnerId={learnerId} size={22} />
                <bdi dir="auto">{nameOf(learnerId) ?? learnerId}</bdi>
              </button>
            ))}
            {rest > 0 ? (
              <span className="tch-brief__personMore">
                {translate('tch.brief.morePeople', { count: rest })}
              </span>
            ) : null}
          </span>
        ) : null}

        {/* Two sources, deliberately. An AI bullet carries the model's own
            sentence about the actual claim; a fallback bullet was assembled
            from numbers and keeps going through `describeEvidence`. */}
        {bullet.why ? (
          <>
            <button
              type="button"
              className="tch-evidence__toggle"
              aria-expanded={showWhy}
              onClick={() => setShowWhy((value) => !value)}
            >
              <Icon name={showWhy ? 'chevronUp' : 'chevronLeft'} size={12} aria-hidden />
              {t('tch.evidence.why')}
            </button>
            {showWhy ? <p className="tch-brief__why" dir="auto">{bullet.why}</p> : null}
          </>
        ) : (
          <EvidenceToggle raw={bullet.because?.raw} />
        )}

        {route ? (
          <span className="tch-brief__bulletGo" aria-hidden="true">
            <Icon name="chevronLeft" size={13} />
          </span>
        ) : null}
      </div>
    </li>
  )
}
