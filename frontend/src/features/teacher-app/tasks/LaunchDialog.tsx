/* Who gets this task, and by when.
 *
 * Sending is its own decision, made here rather than in the build dialog. The
 * same material goes to different children in different weeks, and choosing an
 * audience while writing the questions made a task feel like a one-shot
 * document — you wrote it for 7א, and that was who it was for, forever.
 *
 * ## Every opening is a new one
 *
 * Pressing send here always creates a new opening. If children have had this
 * task before they get a **fresh blank paper**, and their previous one keeps
 * its answers and its mark. That is a big enough difference to say out loud,
 * so the dialog says it — a teacher re-sending to the same class must not
 * discover the semantics from the results screen.
 *
 * ## Counting is the whole job
 *
 * A teacher picks a class, then removes two children, then adds a sub-group
 * that overlaps with it. The one thing they need back is *how many people this
 * will actually reach*, live, before they commit. So the count is resolved the
 * same way the server resolves it — union, de-duplicated — rather than by
 * adding up the sizes of the things selected.
 */

import { useEffect, useMemo, useState } from 'react'
import { Icon } from '../../../components/primitives'
import { Modal } from '../../../components/primitives/Modal'
import { useI18n } from '../../../i18n/I18nProvider'
import { useTeacherRoster } from '../../../providers/TeacherRosterProvider'
import { useTeacherScope } from '../../../providers/TeacherScopeProvider'
import { getGroupSnapshot } from '../../../services/teacher'
import { StudentAvatar } from '../shared/StudentAvatar'
import './teacher-tasks.css'

export interface LaunchChoice {
  targets: { kind: string; id: string }[]
  dueAt: string
  reach: number
}

interface Props {
  open: boolean
  groupId: string
  /** How many openings this task already has — 0 the first time. */
  previousLaunches: number
  /** Children this task was built for, if it started from a finding about
   *  particular children. Ticked for the teacher, never sent on their behalf. */
  suggested?: string[]
  busy?: boolean
  onClose: () => void
  onLaunch: (choice: LaunchChoice) => void
}

export function LaunchDialog({
  open, groupId, previousLaunches, suggested, busy, onClose, onLaunch,
}: Props) {
  const { t, language } = useI18n()
  const { nameOf } = useTeacherRoster()
  /* The provider's list — its one `groupId` prop is always the scoped class
     (TaskReviewPage reads it off the same provider), so a second fetch here was
     the same list twice. The AUDIENCE stays the dialog's own: who receives a
     task is this send's question, not the portal's. */
  const { subgroups } = useTeacherScope()
  /* THIS class's learners, not the teacher's whole roster.
     `useTeacherRoster` is every learner across every class a teacher has — it
     exists so a name can be resolved wherever an id turns up — and using it
     here made the dialog promise 18 recipients for a send that reached 6. The
     count above the send button has to be the number of people who receive it. */
  const [members, setMembers] = useState<string[] | null>(null)
  const [wholeClass, setWholeClass] = useState(true)
  const [pickedGroups, setPickedGroups] = useState<string[]>([])
  const [pickedLearners, setPickedLearners] = useState<string[]>([])
  const [dueAt, setDueAt] = useState(defaultDeadline())
  const [query, setQuery] = useState('')
  /** True while the ticks on screen are the ones this dialog made itself. */
  const [prefilled, setPrefilled] = useState(false)

  useEffect(() => {
    if (!open || !groupId) return
    getGroupSnapshot(groupId, language)
      .then((snapshot) => setMembers(
        (snapshot.students ?? []).map((student) => student.learner_id)))
      .catch(() => setMembers([]))
  }, [open, groupId, language])

  // Reopening the dialog starts fresh: a selection left over from a send that
  // already happened is a selection nobody chose for this one.
  useEffect(() => {
    if (!open) return
    setWholeClass(true)
    setPickedGroups([])
    setPickedLearners([])
    setQuery('')
    setPrefilled(false)
  }, [open])

  /* A task built from a class gap opens with those children already ticked.
     Filtered against THIS class's roster: the gap was computed for a group, and
     a child who has since left it must not be silently re-added by a stored
     suggestion. The dialog says so out loud below, because a picker that opens
     pre-ticked has to explain who ticked it.

     Deliberately after the reset above, and only while the selection is still
     the roster arriving, and once only: a teacher who unticks a name must not
     have it put back by the next render. */
  useEffect(() => {
    if (!open || !members || !suggested?.length || prefilled) return
    const inClass = suggested.filter((id) => members.includes(id))
    if (!inClass.length) return
    setWholeClass(false)
    setPickedLearners(inClass)
    setPrefilled(true)
  }, [open, members, suggested, prefilled])

  const roster = useMemo(() => (members ?? []).map((learnerId) => ({
    id: learnerId,
    name: nameOf(learnerId) ?? learnerId,
  })), [members, nameOf])

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return needle ? roster.filter((row) => row.name.toLowerCase().includes(needle)) : roster
  }, [roster, query])

  /* Resolved the way the server resolves it. Adding up the sizes of the
     selected things would double-count a child who is in two sub-groups, and
     the number a teacher reads before pressing send has to be the number of
     people who receive it. */
  const reach = useMemo(() => {
    if (wholeClass) return roster.length
    const people = new Set(pickedLearners)
    for (const id of pickedGroups) {
      const subgroup = subgroups.find((entry) => entry.id === id)
      for (const learner of subgroup?.learner_ids ?? []) people.add(learner)
    }
    return people.size
  }, [wholeClass, roster, pickedLearners, pickedGroups, subgroups])

  const targets: LaunchChoice['targets'] = wholeClass
    ? [{ kind: 'group', id: groupId }]
    : [
        ...pickedGroups.map((id) => ({ kind: 'subgroup', id })),
        ...pickedLearners.map((id) => ({ kind: 'learner', id })),
      ]

  const toggle = (list: string[], id: string) => (
    list.includes(id) ? list.filter((entry) => entry !== id) : [...list, id]
  )

  return (
    <Modal open={open} onClose={onClose} titleId="tch-launch-title"
           className="tch-launch__modal">
      <h2 id="tch-launch-title" className="tch-builder__modalTitle" dir="auto">
        {t('tch.tasks.launchTitle')}
      </h2>

      {/* Said before the choice, not after: a second opening behaves
          differently enough that finding out afterwards is finding out late. */}
      {previousLaunches > 0 ? (
        <p className="tch-builder__note" dir="auto">
          <Icon name="reflect" size={16} aria-hidden="true" />
          <span>{t('tch.tasks.launchAgainNote', { n: String(previousLaunches + 1) })}</span>
        </p>
      ) : null}

      <div className="tch-launch">
        <div className="tch-launch__modes">
          <button type="button"
                  className={`tch-chip${wholeClass ? ' is-on' : ''}`}
                  aria-pressed={wholeClass}
                  onClick={() => setWholeClass(true)}>
            {t('tch.tasks.target.wholeClass')}
          </button>
          <button type="button"
                  className={`tch-chip${!wholeClass ? ' is-on' : ''}`}
                  aria-pressed={!wholeClass}
                  onClick={() => setWholeClass(false)}>
            {t('tch.tasks.launchPick')}
          </button>
        </div>

        {!wholeClass ? (
          <>
            {subgroups.length > 0 ? (
              <fieldset className="tch-builder__field">
                <legend>{t('tch.tasks.launchSubgroups')}</legend>
                <div className="tch-builder__chips">
                  {subgroups.map((subgroup) => (
                    <button key={subgroup.id} type="button"
                            className={`tch-chip${pickedGroups.includes(subgroup.id) ? ' is-on' : ''}`}
                            aria-pressed={pickedGroups.includes(subgroup.id)}
                            onClick={() => setPickedGroups((current) => toggle(current, subgroup.id))}>
                      {subgroup.name} · {subgroup.size}
                    </button>
                  ))}
                </div>
              </fieldset>
            ) : null}

            {prefilled && pickedLearners.length ? (
              <p className="tch-builder__hint" dir="auto">
                {t('tch.tasks.launchSuggested')}
              </p>
            ) : null}

            <div className="tch-builder__field">
              <div className="tch-launch__head">
                <label htmlFor="tch-launch-search">{t('tch.tasks.launchStudents')}</label>
                <button type="button" className="tch-builder__discard"
                        onClick={() => setPickedLearners(
                          pickedLearners.length === roster.length
                            ? [] : roster.map((row) => row.id))}>
                  {pickedLearners.length === roster.length
                    ? t('tch.tasks.launchClear') : t('tch.tasks.launchAll')}
                </button>
              </div>
              <input id="tch-launch-search" className="sp-input" value={query} dir="auto"
                     placeholder={t('tch.tasks.launchSearch')}
                     onChange={(event) => setQuery(event.target.value)} />
              <ul className="tch-launch__list">
                {shown.map((row) => (
                  <li key={row.id}>
                    <label className="tch-launch__row">
                      <input type="checkbox" checked={pickedLearners.includes(row.id)}
                             onChange={() => setPickedLearners((current) => toggle(current, row.id))} />
                      <StudentAvatar learnerId={row.id} name={row.name} size={26} />
                      <span>{row.name}</span>
                    </label>
                  </li>
                ))}
                {shown.length === 0 ? (
                  <li className="tch-builder__hint">{t('tch.tasks.launchNoMatch')}</li>
                ) : null}
              </ul>
            </div>
          </>
        ) : null}

        <label className="tch-builder__field">
          <span>{t('tch.tasks.field.deadline')}</span>
          <input type="date" className="sp-input" value={dueAt}
                 onChange={(event) => setDueAt(event.target.value)} />
        </label>
      </div>

      <div className="tch-builder__actions">
        {/* "0" while the class roster is still in flight is a lie the teacher
            may act on — a promise of nobody, followed by a send to everybody.
            Nothing is claimed until the number is real. */}
        <span className="tch-launch__count" dir="auto">
          {members === null ? t('tch.tasks.launchCounting')
            : reach === 1 ? t('tch.tasks.launchReach.one')
            : t('tch.tasks.launchReach.many', { n: String(reach) })}
        </span>
        <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm" onClick={onClose}>
          {t('tch.tasks.cancel')}
        </button>
        <button type="button" className="sp-btn sp-btn--sm"
                disabled={members === null || reach === 0 || busy}
                onClick={() => onLaunch({ targets, dueAt, reach })}>
          <Icon name="send" size={15} />
          {busy ? t('tch.tasks.sending') : t('tch.tasks.send')}
        </button>
      </div>
    </Modal>
  )
}

/** A week out, matching the builder's default so the two feel like one app. */
function defaultDeadline(): string {
  const date = new Date()
  date.setDate(date.getDate() + 7)
  return date.toISOString().slice(0, 10)
}
