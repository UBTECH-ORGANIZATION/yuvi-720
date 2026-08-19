/* What to bring into the conversation — the composer's context column.
 *
 * This replaces "מה יובי רואה" in that slot, and the swap is deliberate. The
 * reading is a paragraph ABOUT the child: accurate, dense, and no help at all
 * to someone who is about to sit down opposite them in thirty seconds. What a
 * teacher needs there is what to raise, what the numbers actually say, and
 * something to open with.
 *
 * So the column IS the prep: a line worth noticing, the movements the learnings
 * data can prove, and questions that quote the datum back. The long-form
 * reading is not folded underneath either — it is still one click away on the
 * student's profile, and a second collapsed panel in a 300px column is one more
 * thing to decide about at the moment a teacher has least room for one.
 *
 * ## One band at a time, behind a toggle
 *
 * The bands used to stack, each under its own small heading, inside a panel
 * that had a heading of its own. Three headings in a 300px column to introduce
 * six sentences — and the sentences are the point. So the headings ARE the
 * control now: a segmented toggle at the top, one band showing, the accent
 * travelling with it. Nothing above it repeats what it says.
 *
 * The grounding line under each card is gone too. It restated the sentence the
 * card had just made — "1 of 2 learning goals in science" under a paragraph
 * that had already said exactly that — so it cost a line and bought nothing.
 */

import { useEffect, useState, type CSSProperties } from 'react'
import { Icon, Skeleton } from '../../../components/primitives'
import { useI18n } from '../../../i18n/I18nProvider'
import { getMeetingPrep, type MeetingPrep, type MeetingPrepRow } from '../../../services/teacher'

/** The three bands, and which step each belongs to.
 *
 *  Not simply all three, all the time. Reading "aim at mass and volume" while
 *  still writing down what was said pulls the teacher forward into a decision
 *  they have not got to yet — and on the goals step the reverse: talking points
 *  are behind them, and the column should hold exactly the thing they are
 *  choosing from. The review step has no band at all: the composer does not
 *  mount this panel there, because a read-back is not a decision. */
const SECTIONS: {
  key: keyof MeetingPrep; labelKey: string; icon: string
  /** Drives the section's accent, so the three read apart at a glance. */
  tone: 'notice' | 'ask' | 'aim'
  /** Which composer steps this section belongs to. */
  steps: number[]
}[] = [
  { key: 'insights', labelKey: 'tch.meeting.insights', icon: 'lightbulb',
    tone: 'notice', steps: [0] },
  { key: 'questions', labelKey: 'tch.meeting.questions', icon: 'message',
    tone: 'ask', steps: [0] },
  { key: 'goal_ideas', labelKey: 'tch.meeting.goals', icon: 'target',
    tone: 'aim', steps: [1] },
]

export function ConversationPrepPanel({ learnerId, step }: {
  learnerId: string
  /** Which composer step is showing. Sections can wait for their moment. */
  step: number
}) {
  const { t, language } = useI18n()
  const [prep, setPrep] = useState<MeetingPrep | null>(null)
  const [failed, setFailed] = useState(false)
  /** Which band is showing. Held loosely: when the step changes the set of
   *  bands changes with it, and a pick that is no longer on offer simply falls
   *  back to the first one rather than blanking the column. */
  const [picked, setPicked] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setPrep(null); setFailed(false)
    getMeetingPrep(learnerId, language)
      .then((result) => { if (active) setPrep(result) })
      .catch(() => { if (active) setFailed(true) })
    return () => { active = false }
  }, [learnerId, language])

  /* Two row shapes reach here. The model path writes `text`; the deterministic
     fallback writes a locale key and its params, so it can answer in all three
     languages with no model at all. Rendering only the first would blank the
     panel in exactly the situation it is most needed. */
  const lineOf = (row: MeetingPrepRow): string =>
    row.text?.trim() || (row.text_key ? t(row.text_key, row.params ?? {}) : '')

  const sections = SECTIONS
    .filter((section) => section.steps.includes(step))
    .map((section) => ({ ...section, rows: (prep?.[section.key] ?? []).filter(lineOf) }))
    .filter((section) => section.rows.length)

  const at = Math.max(0, sections.findIndex((section) => section.key === picked))
  const current = sections[at]

  if (prep === null && !failed) {
    /* Toggle-shaped and card-shaped, in the places those will appear — a stack
       of bare bars moves the whole column when the real rows land. */
    return (
      <aside className="tch-prepPanel" aria-busy="true">
        <Skeleton w="100%" h={34} />
        <div className="tch-prepPanel__loading">
          <Skeleton w="100%" h={72} />
          <Skeleton w="100%" h={56} />
          <Skeleton w="100%" h={64} />
        </div>
      </aside>
    )
  }

  if (failed || !current) {
    /* Honest emptiness, not a padded sheet. A child with no observations behind
       them gets a conversation the teacher leads, which is fine — three
       invented talking points would not be. */
    return (
      <aside className="tch-prepPanel">
        <p className="tch-prepPanel__none">{t('tch.meeting.unavailable.body')}</p>
      </aside>
    )
  }

  return (
    <aside className="tch-prepPanel" data-tone={current.tone}>
      {/* The toggle is the header. Every band names itself, so a title above
          them could only have said "prep" a second time. The pill slides and
          re-tints in one motion, which is the whole cue that the column below
          changed under it. */}
      <div className="tch-prepPanel__tabs" role="tablist" data-tone={current.tone}
           style={{
             '--tch-tab-count': sections.length,
             '--tch-tab-index': at,
           } as CSSProperties}>
        <span className="tch-prepPanel__thumb" aria-hidden />
        {sections.map((section) => (
          <button key={section.key} type="button" role="tab"
                  id={`tch-prep-tab-${section.key}`}
                  aria-controls={`tch-prep-panel-${section.key}`}
                  aria-selected={section.key === current.key}
                  className="tch-prepPanel__tab" data-tone={section.tone}
                  onClick={() => setPicked(section.key)}>
            <Icon name={section.icon} size={14} aria-hidden />
            <span>{t(section.labelKey)}</span>
          </button>
        ))}
      </div>

      {/* Keyed by the band, so switching replays the entrance rather than
          swapping text in place under the teacher's eye. */}
      <ul key={current.key} className="tch-prepPanel__cards" role="tabpanel"
          id={`tch-prep-panel-${current.key}`}
          aria-labelledby={`tch-prep-tab-${current.key}`}>
        {current.rows.map((row, index) => (
          <li key={index} className="tch-prepCard" dir="auto">
            <p>{lineOf(row)}</p>
          </li>
        ))}
      </ul>
    </aside>
  )
}
