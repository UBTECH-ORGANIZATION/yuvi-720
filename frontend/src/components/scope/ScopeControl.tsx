/* Who the teacher is looking at, said once in the chrome.
 *
 * Before this, a teacher's scope was three things in three places: the class
 * could only be changed on Home because it WAS the Home page title, the subject
 * could not be changed anywhere (`setSubject` had no call sites, so it was
 * permanently null), and the sub-group was re-fetched and re-encoded by six
 * screens with no memory between them.
 *
 * One visible segment per dimension, each showing what it is currently set to
 * and opening only its own list:
 *
 *     [ז׳2 ⌄] [כל הכיתה ⌄] [כל המקצועות ⌄]      ← nothing narrowed: plain ink
 *     [ז׳2 ⌄] [קבוצת חיזוק ✕] [מתמטיקה ✕]       ← narrowed: filled, clearable
 *
 * NOT one trigger opening a sheet with all three inside. That version was built
 * first and failed the only requirement that mattered: a teacher looking at the
 * bar could not tell whether a subject was set without clicking. "Always show
 * the subject and class filter" means on the screen, not one click away.
 *
 * The narrowed segments are loud on purpose. All three parts persist to the
 * user document, so a teacher can arrive on Monday still filtered to six
 * children from last Tuesday and read the whole portal as the truth about their
 * class. What guards against that: the filled segment, its own ✕, the value
 * being readable without opening anything, and — on screens that do not narrow
 * by it — the notice that says so.
 *
 * It sits in the bar's LEADING slot, beside the logo. Not `center`: under
 * 1200px that collapses into an aria-hidden sheet behind a hamburger, which is
 * exactly where a persisted filter must not go. Not `trailing`: that is the
 * account cluster, scope is not an account fact, and the fossil of that attempt
 * (`.teacher-app-scope__field`) clamped it to `8ch` — which is where a scope
 * stops being a sentence.
 *
 * Every segment shows on every teacher screen, and can be set from every
 * teacher screen: scope is one thing for the whole portal, and choosing maths
 * on Home is a choice that applies the moment the teacher opens a profile. A
 * screen that does not narrow by a dimension says so instead of ignoring it
 * quietly — see `ScopeNotice` and `scopeDimensions.ts`.
 */

import { useRef, useState } from 'react'
import { navigate, useRoute } from '../../app/router'
import { useI18n } from '../../i18n/I18nProvider'
import { useTeacherScope } from '../../providers/TeacherScopeProvider'
import { subjectLabel } from '../../features/teacher-app/shared/subjectLabel'
import { useDismiss } from '../../features/teacher-app/shared/useDismiss'
import { Icon } from '../primitives'
import { narrowsBy } from './scopeDimensions'
import './scope-control.css'

type Dimension = 'class' | 'subgroup' | 'subject'

export function ScopeControl() {
  const pathname = useRoute()
  const { t } = useI18n()
  const {
    groups, groupId, setGroupId, group,
    subgroups, subgroupId, setSubgroupId, subgroup,
    subjects, subject, setSubject,
    isLoading, subgroupsReady, subjectsReady,
  } = useTeacherScope()

  /* Which segment's list is open, if any. One at a time — two open lists in a
     bar this size sit on top of each other. */
  const [open, setOpen] = useState<Dimension | null>(null)
  const wrapper = useRef<HTMLDivElement>(null)
  useDismiss(wrapper, open !== null, () => setOpen(null))

  const narrows = narrowsBy(pathname)

  /* Shown because the teacher HAS a class, sub-groups and a subject list — not
     because this screen happens to use them. The only thing that hides a
     segment is having nothing to put in it. */
  const showClass = Boolean(groupId)
  const showSubgroup = subgroups.length > 0
  const showSubject = subjects.length > 0

  /* Three lists, three requests, three moments — and the bar grew at each one,
     shoving the whole nav sideways twice while the teacher was already reading
     it. A segment whose list has not landed holds its width instead.

     "Not landed" is not "empty": the two are indistinguishable in the arrays
     above and mean opposite things, which is what `*Ready` is for. */
  const classPending = isLoading
  const subgroupPending = !isLoading && showClass && !subgroupsReady
  const subjectPending = !isLoading && showClass && !subjectsReady

  /* The admin console: no class, nothing to scope. Only once we know that —
     during the first load it is also what an ordinary teacher looks like. */
  if (!classPending && !showClass && !showSubgroup && !showSubject) return null

  if (classPending) {
    return (
      <div className="tch-scope" aria-busy="true" data-tour="teacher.scope">
        <Pending width={132} />
        <Pending width={104} />
        <Pending width={116} />
      </div>
    )
  }

  /* On a screen that is not about a class, picking one has to go somewhere: the
     child whose profile is open is not in the class just chosen, so staying put
     would leave the bar and the page describing different people. */
  const pickClass = (id: string) => {
    setGroupId(id)
    if (!narrows.class) navigate('/teacher/students')
  }

  return (
    /* `data-tour` on the WRAPPER rather than on a segment: a teacher with one
       class renders that segment as a `<span>`, and anchoring the tour to a
       button that does not exist would make the step a silent no-op for exactly
       the people with the simplest setup. */
    <div className="tch-scope" ref={wrapper} data-tour="teacher.scope">
      {showClass && (
        <Segment
          dimension="class"
          legend={t('tch.scope.group')}
          /* The class is never "cleared" — a teacher is always looking at one —
             so it carries no ✕ and never reads as a filter that is on. */
          label={group?.name ?? ''}
          narrowed={false}
          open={open}
          setOpen={setOpen}
          value={groupId ?? ''}
          options={groups.map((row) => ({ value: row.id, label: row.name }))}
          onPick={pickClass}
        />
      )}

      {showSubgroup && (
        <Segment
          dimension="subgroup"
          legend={t('tch.scope.subgroup')}
          label={subgroup?.name ?? t('tch.subgroups.wholeClass')}
          narrowed={Boolean(subgroup)}
          clearLabel={subgroup
            ? t('tch.scope.clearSubgroup', { name: subgroup.name }) : undefined}
          onClear={() => setSubgroupId(null)}
          open={open}
          setOpen={setOpen}
          value={subgroupId ?? ''}
          options={[
            { value: '', label: t('tch.subgroups.wholeClass') },
            ...subgroups.map((row) => ({
              value: row.id,
              label: t('tch.scope.subgroupOption', { name: row.name, count: row.size }),
            })),
          ]}
          onPick={(value) => setSubgroupId(value || null)}
        />
      )}
      {subgroupPending && <Pending width={104} />}

      {showSubject && (
        <Segment
          dimension="subject"
          legend={t('tch.scope.subject')}
          label={subject ? subjectLabel(subject, t) : t('tch.scope.allSubjects')}
          narrowed={Boolean(subject)}
          clearLabel={subject
            ? t('tch.scope.clearSubject', { name: subjectLabel(subject, t) }) : undefined}
          onClear={() => setSubject(null)}
          open={open}
          setOpen={setOpen}
          value={subject ?? ''}
          options={[
            { value: '', label: t('tch.scope.allSubjects') },
            ...subjects.map((entry) => ({ value: entry, label: subjectLabel(entry, t) })),
          ]}
          onPick={(value) => setSubject(value || null)}
        />
      )}
      {subjectPending && <Pending width={116} />}
    </div>
  )
}

/** A segment's width, held while its list is in flight.
 *
 *  Widths are the typical value's, not a maximum: the point is that the bar
 *  stops moving, and reserving the widest possible class name would trade one
 *  jump for a permanent hole. `aria-hidden` because there is nothing here to
 *  announce — the wrapper's `aria-busy` is what a screen reader needs. */
function Pending({ width }: { width: number }) {
  return (
    <span className="tch-scope__seg tch-scope__seg--pending"
          style={{ inlineSize: width }} aria-hidden />
  )
}

/** One dimension: what it is set to, and the list of what it could be. */
function Segment({
  dimension, legend, label, narrowed, clearLabel, onClear,
  open, setOpen, value, options, onPick,
}: {
  dimension: Dimension
  legend: string
  label: string
  narrowed: boolean
  clearLabel?: string
  onClear?: () => void
  open: Dimension | null
  setOpen: (next: Dimension | null) => void
  value: string
  options: { value: string; label: string }[]
  onPick: (value: string) => void
}) {
  const isOpen = open === dimension
  /* Only one real option means there is nothing to choose. The segment still
     renders — its value is the frame the screen is read inside — but as a line
     rather than a button that opens a list of one. */
  const canOpen = options.length > 1

  return (
    <span className={`tch-scope__seg${narrowed ? ' is-narrowed' : ''}`}>
      {canOpen ? (
        <button
          type="button"
          className="tch-scope__trigger"
          aria-expanded={isOpen}
          aria-haspopup="dialog"
          aria-label={`${legend}: ${label}`}
          onClick={() => setOpen(isOpen ? null : dimension)}
        >
          <span className="tch-scope__value" dir="auto">{label}</span>
          <Icon name="chevronDown" size={14} aria-hidden className="tch-scope__caret" />
        </button>
      ) : (
        <span className="tch-scope__trigger tch-scope__trigger--static">
          <span className="tch-scope__value" dir="auto">{label}</span>
        </span>
      )}

      {narrowed && clearLabel && onClear && (
        <button type="button" className="tch-scope__clear"
                aria-label={clearLabel} onClick={onClear}>
          <Icon name="close" size={12} aria-hidden />
        </button>
      )}

      {isOpen && canOpen && (
        <div className="tch-scope__pop" role="dialog" aria-label={legend}>
          <fieldset className="tch-scope__group">
            <legend className="tch-scope__legend">{legend}</legend>
            {options.map((option) => (
              <label
                key={option.value || '__all'}
                className={`tch-scope__option${option.value === value ? ' is-picked' : ''}`}
                /* `change` does not fire when the already-checked radio is
                   clicked, so picking what is already picked left the list open
                   with no response — the one click a teacher makes to say "yes,
                   this one, now go away". `onPick` is idempotent, so firing
                   from both is safe in whichever order the events arrive. */
                onClick={() => { onPick(option.value); setOpen(null) }}
              >
                <input
                  type="radio"
                  name={`tch-scope-${dimension}`}
                  value={option.value}
                  checked={option.value === value}
                  onChange={() => { onPick(option.value); setOpen(null) }}
                />
                <span dir="auto">{option.label}</span>
                {option.value === value && <Icon name="check" size={14} aria-hidden />}
              </label>
            ))}
          </fieldset>
        </div>
      )}
    </span>
  )
}
