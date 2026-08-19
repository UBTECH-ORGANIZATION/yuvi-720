/* Who the teacher is looking at, said once in the chrome.
 *
 * Before this, a teacher's scope was three things in three places: the class
 * could only be changed on Home because it WAS the Home page title, the subject
 * could not be changed anywhere (`setSubject` had no call sites, so it was
 * permanently null), and the sub-group was re-fetched and re-encoded by six
 * screens with no memory between them.
 *
 * It reads as a sentence and stays quiet when nothing is narrowed:
 *
 *     ז׳2                          ← just the class: plain ink, no decoration
 *     ז׳2 · [קבוצת חיזוק ×] · [מתמטיקה ×]
 *
 * The narrowed segments are loud on purpose. All three parts persist to the
 * user document now, so a teacher can arrive on Monday still filtered to six
 * children from last Tuesday and read the whole portal as the truth about their
 * class. Four things guard against that: the filled pill, the accent on the
 * trigger, a clear on each segment, and — elsewhere — every scope-caused empty
 * state naming the scope and offering to clear it.
 *
 * It sits in the bar's LEADING slot, beside the logo. Not `center`: under
 * 1200px that collapses into an aria-hidden sheet behind a hamburger, which is
 * exactly where a persisted filter must not go. Not `trailing`: that is the
 * account cluster, scope is not an account fact, and the fossil of that attempt
 * (`.teacher-app-scope__field`) clamped it to `8ch` — which is where a scope
 * stops being a sentence.
 *
 * Every segment is shown on every teacher screen. An earlier version hid the
 * ones a screen could not narrow by, and that was worse than the problem it
 * solved: the student profile hides class and sub-group, so when its subject
 * list failed to load the whole control vanished — and a control that is not
 * there is indistinguishable from one that is broken.
 *
 * Nothing is hidden and nothing is silently ignored: `scopeDimensions.ts` says
 * what each screen narrows by, and a dimension that is SET but not narrowed by
 * is announced on the screen itself (see `ScopeNotice`). Setting it still
 * works from anywhere — scope is one thing for the whole portal, and choosing
 * maths on Home is a choice that applies the moment the teacher opens a
 * profile or the learnings list.
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

export function ScopeControl() {
  const pathname = useRoute()
  const { t } = useI18n()
  const {
    groups, groupId, setGroupId, group,
    subgroups, subgroupId, setSubgroupId, subgroup,
    subjects, subject, setSubject,
  } = useTeacherScope()

  const [isOpen, setIsOpen] = useState(false)
  const wrapper = useRef<HTMLDivElement>(null)
  useDismiss(wrapper, isOpen, () => setIsOpen(false))

  const narrows = narrowsBy(pathname)

  /* Shown because the teacher has a class, a subject list and sub-groups — not
     because this screen happens to use them. The only thing that hides a
     segment is having nothing to put in it. */
  const showClass = Boolean(groupId)
  const showSubgroup = subgroups.length > 0
  const showSubject = subjects.length > 0

  /* The admin console: no class, nothing to scope. */
  if (!showClass && !showSubgroup && !showSubject) return null

  /* A teacher with one class, no sub-groups and no subject list has nothing to
     choose. The control still renders, because the class name is the frame
     every screen is read inside, but as a line rather than a button that opens
     an empty sheet. */
  const canOpen = (showClass && groups.length > 1) || showSubgroup || showSubject

  const narrowedSubgroup = subgroup
  const narrowedSubject = subject
  const isNarrowed = Boolean(narrowedSubgroup || narrowedSubject)

  /* On a screen that is not about a class, picking one has to go somewhere: the
     child whose profile is open is not in the class just chosen, so staying put
     would leave the bar and the page describing different people. */
  const pickClass = (id: string) => {
    setGroupId(id)
    if (!narrows.class) navigate('/teacher/students')
  }

  /* The class is always the lead, on every screen — it is the frame the whole
     portal is read inside, and a bar that dropped it on a profile left a lone
     caret with nothing beside it. */
  const lead = showClass ? (group?.name ?? '') : t('tch.scope.label')

  const segments = (
    <>
      <span className="tch-scope__class">{lead}</span>
      {canOpen && <Icon name="chevronDown" size={14} aria-hidden className="tch-scope__caret" />}
    </>
  )

  return (
    /* `data-tour` on the WRAPPER, not the trigger: a teacher with one class and
       no sub-groups gets a `<span>` below, and anchoring the tour to a button
       that does not exist would make the step a silent no-op for exactly the
       people with the simplest setup. */
    <div className="tch-scope" ref={wrapper} data-tour="teacher.scope">
      {canOpen ? (
        <button
          type="button"
          className={`tch-scope__trigger${isNarrowed ? ' is-narrowed' : ''}`}
          aria-expanded={isOpen}
          aria-haspopup="dialog"
          aria-label={t('tch.scope.label')}
          onClick={() => setIsOpen((open) => !open)}
        >
          {segments}
        </button>
      ) : (
        <span className="tch-scope__trigger tch-scope__trigger--static">{segments}</span>
      )}

      {/* One chip per narrowing, each with its own way out. Never truncated:
          a warning you cannot finish reading is not a warning. */}
      {narrowedSubgroup && (
        <span className="tch-scope__chip">
          <span className="tch-scope__chipLabel">{narrowedSubgroup.name}</span>
          <button
            type="button"
            className="tch-scope__clear"
            aria-label={t('tch.scope.clearSubgroup', { name: narrowedSubgroup.name })}
            onClick={() => setSubgroupId(null)}
          >
            <Icon name="close" size={12} aria-hidden />
          </button>
        </span>
      )}
      {narrowedSubject && (
        <span className="tch-scope__chip">
          <span className="tch-scope__chipLabel">{subjectLabel(narrowedSubject, t)}</span>
          <button
            type="button"
            className="tch-scope__clear"
            aria-label={t('tch.scope.clearSubject', {
              name: subjectLabel(narrowedSubject, t),
            })}
            onClick={() => setSubject(null)}
          >
            <Icon name="close" size={12} aria-hidden />
          </button>
        </span>
      )}

      {isOpen && canOpen && (
        <div className="tch-scope__pop" role="dialog" aria-label={t('tch.scope.label')}>
          {showClass && groups.length > 1 && (
            <Choice
              legend={t('tch.scope.group')}
              name="tch-scope-group"
              value={groupId ?? ''}
              options={groups.map((row) => ({ value: row.id, label: row.name }))}
              onPick={(value) => { pickClass(value); setIsOpen(false) }}
            />
          )}
          {showSubgroup && (
            <Choice
              legend={t('tch.scope.subgroup')}
              name="tch-scope-subgroup"
              value={subgroupId ?? ''}
              options={[
                { value: '', label: t('tch.subgroups.wholeClass') },
                ...subgroups.map((row) => ({
                  value: row.id,
                  label: t('tch.scope.subgroupOption', { name: row.name, count: row.size }),
                })),
              ]}
              onPick={(value) => { setSubgroupId(value || null); setIsOpen(false) }}
            />
          )}
          {showSubject && (
            <Choice
              legend={t('tch.scope.subject')}
              name="tch-scope-subject"
              value={subject ?? ''}
              options={[
                { value: '', label: t('tch.scope.allSubjects') },
                ...subjects.map((entry) => ({
                  value: entry, label: subjectLabel(entry, t),
                })),
              ]}
              onPick={(value) => { setSubject(value || null); setIsOpen(false) }}
            />
          )}
        </div>
      )}
    </div>
  )
}

/* One dimension: pick exactly one of a set. Native radios rather than a styled
   listbox — arrow-key navigation, the group semantics and the announced
   "3 of 5" all come free, and none of them survive a div wearing a role. */
function Choice({ legend, name, value, options, onPick }: {
  legend: string
  name: string
  value: string
  options: { value: string; label: string }[]
  onPick: (value: string) => void
}) {
  return (
    <fieldset className="tch-scope__group">
      <legend className="tch-scope__legend">{legend}</legend>
      {options.map((option) => (
        <label
          key={option.value || '__all'}
          className={`tch-scope__option${option.value === value ? ' is-picked' : ''}`}
          /* `change` does not fire when the already-checked radio is clicked,
             so picking what is already picked left the sheet open with no
             response — the one click a teacher makes to say "yes, this one,
             now go away". `onPick` is idempotent, so calling it from both is
             safe whichever order the events arrive in. */
          onClick={() => onPick(option.value)}
        >
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={option.value === value}
            onChange={() => onPick(option.value)}
          />
          <span dir="auto">{option.label}</span>
          {option.value === value && <Icon name="check" size={14} aria-hidden />}
        </label>
      ))}
    </fieldset>
  )
}
