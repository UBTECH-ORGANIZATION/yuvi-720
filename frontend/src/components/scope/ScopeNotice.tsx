/* "This filter is on, and this screen does not use it."
 *
 * The scope bar shows class, sub-group and subject on every teacher screen, and
 * lets them be set from every teacher screen — scope is one thing for the whole
 * portal, and choosing maths on Home is a choice that applies the moment the
 * teacher opens a profile.
 *
 * But not every screen narrows by all three. "Who needs attention, in maths"
 * has no defined meaning yet, so Home and the roster are class-wide whatever
 * the subject says; the learnings fold is class-wide, so a sub-group cannot
 * narrow it exactly. Showing a lit "מתמטיקה" chip over figures that cover every
 * subject would be the same lie `/groups/{id}/snapshot` used to tell when it
 * accepted a `subject` parameter and dropped it — with a control attached.
 *
 * So the rule is: never hide the filter, and never ignore it quietly. When a
 * dimension is SET and the screen does not narrow by it, the screen says so, in
 * one line, above its own content.
 *
 * Nothing is printed when nothing is narrowed — a teacher who has set no filter
 * needs no reassurance about filters, and a line on every screen would be
 * chrome nobody reads.
 *
 * Mounted once in the teacher shell rather than per page, so a new screen
 * cannot forget it.
 */

import { useRoute } from '../../app/router'
import { useI18n } from '../../i18n/I18nProvider'
import { useTeacherScope } from '../../providers/TeacherScopeProvider'
import { narrowsBy } from './scopeDimensions'
import './scope-control.css'

export function ScopeNotice() {
  const pathname = useRoute()
  const { t } = useI18n()
  const { subgroup, subject } = useTeacherScope()

  const narrows = narrowsBy(pathname)
  const lines: string[] = []

  if (subgroup && !narrows.subgroup) lines.push(t('tch.scope.notice.subgroup'))
  if (subject && !narrows.subject) lines.push(t('tch.scope.notice.subject'))

  if (!lines.length) return null

  return (
    /* `role="status"`, not an alert: it is a statement about the page, and it
       must not interrupt a screen reader mid-sentence when the teacher changes
       screens with a filter on. */
    <p className="tch-scopeNotice" role="status">
      {lines.map((line) => <span key={line}>{line}</span>)}
    </p>
  )
}
