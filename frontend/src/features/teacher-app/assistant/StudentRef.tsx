/* Renders `{{student:<learner_id>}}` as a real name, at render time.
 *
 * This is the client half of the PII boundary. The tools return learner ids and
 * never `display_name`, so the model literally cannot write a student's name —
 * it writes the id in a marker, and the substitution happens here, in the
 * teacher's browser, from the roster the teacher app already loaded.
 *
 * The model never sees a name. The teacher always does.
 *
 * An unresolved id renders as the id rather than as the raw marker: if the
 * roster hasn't loaded, or the model invented an id, the teacher sees something
 * inert and obviously not-a-name instead of template syntax.
 *
 * Parsing lives in `studentRefs.ts` so it can be tested without a DOM.
 */

import { Fragment, type ReactNode } from 'react'
import { navigate } from '../../../app/router'
import {
  labelFor, parseAnswerBlocks, parseStudentRefs, type Segment,
} from './studentRefs'

export interface StudentNameLookup {
  (learnerId: string): string | null | undefined
}

function renderSegments(segments: Segment[], lookup: StudentNameLookup): ReactNode[] {
  return segments.map((segment, index) => {
    if (segment.kind === 'text') return <Fragment key={index}>{segment.text}</Fragment>
    if (segment.kind === 'bold') return <strong key={index}>{segment.text}</strong>
    return (
      <StudentRef
        key={index}
        learnerId={segment.learnerId}
        name={lookup(segment.learnerId)}
      />
    )
  })
}

export function renderWithStudentRefs(
  text: string, lookup: StudentNameLookup
): ReactNode[] {
  return renderSegments(parseStudentRefs(text), lookup)
}

/** An answer as paragraphs and lists — see `parseAnswerBlocks` for the grammar. */
export function renderAnswer(text: string, lookup: StudentNameLookup): ReactNode[] {
  return parseAnswerBlocks(text).map((block, index) =>
    block.kind === 'list' ? (
      <ul className="tch-dock__list" key={index}>
        {block.items.map((item, itemIndex) => (
          <li key={itemIndex}>{renderSegments(item, lookup)}</li>
        ))}
      </ul>
    ) : (
      <p className="tch-dock__para" key={index} dir="auto">
        {renderSegments(block.segments, lookup)}
      </p>
    )
  )
}

function StudentRef({ learnerId, name }: { learnerId: string; name?: string | null }) {
  return (
    <button
      type="button"
      className="tch-studentRef"
      dir="auto"
      onClick={() => navigate(`/teacher/student/${encodeURIComponent(learnerId)}`)}
    >
      {labelFor(learnerId, name)}
    </button>
  )
}
