/* The form a chat action opens, and the only place in the dock that writes.
 *
 * The write itself is not new code and not a new endpoint: pressing confirm
 * calls exactly the same service function the goals screen, the notes panel and
 * the messages screen call. The assistant drafted; the teacher assigns. That is
 * why `teacher_tools/registry.py` can still say, truthfully, that no tool in it
 * writes — a jailbroken prompt can put a filled-in form on screen, and a human
 * still has to press the button.
 *
 * "Guided" is two halves. The model asks for what it could not infer, in prose.
 * This side flags the same fields (`missing`) and keeps confirm disabled until
 * they are filled — so the teacher is never handed a form that cannot succeed.
 */

import { useEffect, useState } from 'react'

import { navigate } from '../../../app/router'
import { useI18n } from '../../../i18n/I18nProvider'
import { Icon } from '../../../components/primitives'
import {
  approveStudentGoal, assignGroupGoal, assignStudentGoal, acknowledgeAlert,
  createTeacherInsight, sendKudos,
} from '../../../services/teacher'
import {
  createTask, listCatalogLearnings, startGeneration,
  type CatalogLearning, type TaskComponent, type TaskSpecInput,
} from '../../../services/tasks'
import { subjectLabel } from '../shared/subjectLabel'
import type { AssistantAction } from '../../../services/teacherAssistant'
import { useTeacherRoster } from '../../../providers/TeacherRosterProvider'
import { countKey } from '../shared/countLabel'
import { labelFor } from './studentRefs'

/** A week out, matching the default the learner-side goal composer uses. */
function defaultDeadline() {
  const date = new Date()
  date.setDate(date.getDate() + 7)
  return date.toISOString().slice(0, 10)
}

interface Props {
  action: AssistantAction
  groupId: string
  language: string
  /** Null for a learner with no display name — rendered as the inert id. */
  nameOf: (learnerId: string) => string | null
  onDone: (summary: string) => void
  onCancel: () => void
}

export function AssistantTaskForm(props: Props) {
  switch (props.action.kind) {
    case 'draft_goal':   return <GoalForm {...props} />
    case 'draft_note':   return <NoteForm {...props} />
    case 'draft_kudos':  return <KudosForm {...props} />
    case 'draft_task':   return <TaskForm {...props} />
    case 'approve_goals': return <ApproveList {...props} />
    case 'ack_alerts':   return <AlertList {...props} />
    default:             return null
  }
}

/* ── shell ────────────────────────────────────────────────────────────────── */

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="tch-dock__form" dir="auto">
      <p className="tch-dock__formTitle">{title}</p>
      {children}
    </div>
  )
}

function Foot({ label, busy, disabled, error, onConfirm, onCancel }: {
  label: string; busy: boolean; disabled: boolean; error: string
  onConfirm: () => void; onCancel: () => void
}) {
  const { t } = useI18n()
  return (
    <>
      <div className="tch-dock__formFoot">
        <button type="button" className="sp-btn sp-btn--sm"
                disabled={disabled || busy} onClick={onConfirm}>
          {busy ? t('tch.assistant.form.working') : label}
        </button>
        <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm" onClick={onCancel}>
          {t('tch.assistant.form.cancel')}
        </button>
      </div>
      {error ? <p className="tch-dock__formError" role="status">{error}</p> : null}
    </>
  )
}

/* ── a goal ───────────────────────────────────────────────────────────────── */

function GoalForm({ action, groupId, language, nameOf, onDone, onCancel }: Props) {
  const { t } = useI18n()
  const { students } = useTeacherRoster()
  const drafted = action.learner_ids ?? []
  /* When the model drafted for nobody — `missing` contains "learners" — the
     teacher picks from the whole class rather than being handed an empty form.
     Before this, that case rendered a goal with no target and a live confirm
     button. */
  const candidates = drafted.length
    ? drafted
    : students.map((student) => student.learner_id)
  const [selected, setSelected] = useState<Set<string>>(new Set(drafted))
  const [title, setTitle] = useState(action.title ?? '')
  const [steps, setSteps] = useState(action.next_steps ?? '')
  const [deadline, setDeadline] = useState(action.deadline || defaultDeadline())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const missingTitle = !title.trim()

  const confirm = async () => {
    setBusy(true); setError('')
    const ids = [...selected]
    const goal = { title: title.trim(), next_steps: steps.trim(), deadline }
    try {
      if (ids.length === 1) {
        await assignStudentGoal(ids[0], goal, language)
        onDone(t('tch.assistant.form.goalDoneOne', { name: labelFor(ids[0], nameOf(ids[0])) }))
      } else {
        const result = await assignGroupGoal(groupId, ids, goal, language)
        // A partial success is not a success. `assignGroupGoal` skips a learner
        // who left the class between the draft and the click, and saying
        // "assigned to 6" when it was 5 is the kind of quiet lie this codebase
        // spends a lot of effort not telling.
        const assigned = result.assigned.length
        onDone(result.skipped?.length
          ? t(countKey('tch.assistant.form.goalDoneSkipped', assigned),
              { count: assigned, skipped: result.skipped.length,
                name: labelFor(result.assigned[0] ?? '', nameOf(result.assigned[0] ?? '')) })
          // A group assign can still land on one learner — the others were
          // skipped — so this branch is not safely plural either.
          : assigned === 1
            ? t('tch.assistant.form.goalDoneOne',
                { name: labelFor(result.assigned[0], nameOf(result.assigned[0])) })
            : t('tch.assistant.form.goalDone', { count: assigned }))
      }
    } catch {
      setError(t('tch.assistant.form.failed')); setBusy(false)
    }
  }

  return (
    <Shell title={t('tch.assistant.form.goalTitle')}>
      {/* Always, including for exactly one child.
          Hiding this at `length <= 1` is how a goal drafted for one arbitrary
          student out of a described set reached a teacher who confirmed it
          without ever seeing whose name was on it. Who a write is about is not
          a detail to be elided when there is only one of them. */}
      <p className="tch-dock__fieldLabel">
        {drafted.length
          ? t('tch.assistant.form.goalFor')
          : t('tch.assistant.form.goalPickWho')}
      </p>
      {candidates.length ? (
        <ul className="tch-dock__people">
          {candidates.map((id) => {
            const on = selected.has(id)
            return (
              <li key={id}>
                <button type="button" className={`tch-chip${on ? ' is-on' : ''}`}
                        aria-pressed={on} dir="auto"
                        onClick={() => setSelected((current) => {
                          const next = new Set(current)
                          if (next.has(id)) next.delete(id); else next.add(id)
                          return next
                        })}>
                  {on ? <Icon name="check" size={12} aria-hidden /> : null}
                  {labelFor(id, nameOf(id))}
                </button>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="tch-dock__formNote">{t('tch.assistant.form.goalNoRoster')}</p>
      )}

      <label className="tch-dock__field">
        <span>
          {t('tch.goals.field.title')}
          {missingTitle ? (
            <em className="tch-dock__needed">{t('tch.assistant.form.needed')}</em>
          ) : null}
        </span>
        <input className="sp-input" dir="auto" value={title} autoFocus={missingTitle}
               onChange={(event) => setTitle(event.target.value)} />
      </label>
      <label className="tch-dock__field">
        <span>{t('tch.goals.field.steps')}</span>
        <textarea className="sp-input" dir="auto" rows={2} value={steps}
                  onChange={(event) => setSteps(event.target.value)} />
      </label>
      <label className="tch-dock__field">
        <span>{t('tch.goals.field.deadline')}</span>
        <input className="sp-input" type="date" value={deadline}
               onChange={(event) => setDeadline(event.target.value)} />
      </label>

      <Foot label={t(countKey('tch.assistant.form.assign', selected.size), {
              count: selected.size,
              name: labelFor([...selected][0] ?? '', nameOf([...selected][0] ?? '')),
            })}
            busy={busy} disabled={!selected.size || missingTitle}
            error={error} onConfirm={() => void confirm()} onCancel={onCancel} />
    </Shell>
  )
}

/* ── a note ───────────────────────────────────────────────────────────────── */

function NoteForm({ action, nameOf, onDone, onCancel }: Props) {
  const { t } = useI18n()
  const learnerId = action.learner_id ?? ''
  const [text, setText] = useState(action.text ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const confirm = async () => {
    setBusy(true); setError('')
    try {
      await createTeacherInsight(learnerId, {
        kind: (action.note_kind as 'note') || 'note',
        text: text.trim(),
        visibility: 'private',
      })
      onDone(t('tch.assistant.form.noteDone', { name: labelFor(learnerId, nameOf(learnerId)) }))
    } catch {
      setError(t('tch.assistant.form.failed')); setBusy(false)
    }
  }

  return (
    <Shell title={t('tch.assistant.form.noteTitle', { name: labelFor(learnerId, nameOf(learnerId)) })}>
      <label className="tch-dock__field">
        <span>
          {t('tch.assistant.form.noteText')}
          {!text.trim() ? (
            <em className="tch-dock__needed">{t('tch.assistant.form.needed')}</em>
          ) : null}
        </span>
        <textarea className="sp-input" dir="auto" rows={3} value={text}
                  onChange={(event) => setText(event.target.value)} />
      </label>
      <Foot label={t('tch.assistant.form.save')} busy={busy} disabled={!text.trim()}
            error={error} onConfirm={() => void confirm()} onCancel={onCancel} />
    </Shell>
  )
}

/* ── a good word ──────────────────────────────────────────────────────────── */

function KudosForm({ action, language, nameOf, onDone, onCancel }: Props) {
  const { t } = useI18n()
  const learnerId = action.learner_id ?? ''
  const [message, setMessage] = useState(action.message ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const confirm = async () => {
    setBusy(true); setError('')
    try {
      await sendKudos(learnerId, message.trim(), language)
      onDone(t('tch.assistant.form.kudosDone', { name: labelFor(learnerId, nameOf(learnerId)) }))
    } catch {
      setError(t('tch.assistant.form.failed')); setBusy(false)
    }
  }

  return (
    <Shell title={t('tch.assistant.form.kudosTitle', { name: labelFor(learnerId, nameOf(learnerId)) })}>
      {/* The child reads this, in their teacher's name — so it is shown as
          editable prose, never sent silently as the model wrote it. */}
      <p className="tch-dock__formNote">{t('tch.assistant.form.kudosNote')}</p>
      <label className="tch-dock__field">
        <span>{t('tch.assistant.form.kudosText')}</span>
        <textarea className="sp-input" dir="auto" rows={3} value={message}
                  onChange={(event) => setMessage(event.target.value)} />
      </label>
      <Foot label={t('tch.assistant.form.send')} busy={busy} disabled={!message.trim()}
            error={error} onConfirm={() => void confirm()} onCancel={onCancel} />
    </Shell>
  )
}

/* ── a task ───────────────────────────────────────────────────────────────── */

/** The three parts, in the order a child meets them. Same list the builder
 *  offers — the chat is a second door onto one task model, not a second one. */
const PARTS = ['presentation', 'practice', 'test'] as const

/** The model's `components` arrive as plain strings over the wire. The tool
 *  already dropped anything that is not one of the three, and this is the type
 *  system being told the same thing. */
function asParts(raw: string[] | undefined): TaskComponent[] {
  const wanted = new Set(raw ?? [])
  const kept = PARTS.filter((part) => wanted.has(part))
  return kept.length ? kept : ['practice']
}

function TaskForm({ action, groupId, language, onDone, onCancel }: Props) {
  const { t } = useI18n()
  const [title, setTitle] = useState(action.title ?? '')
  const [topic, setTopic] = useState(action.topic ?? '')
  const [subject, setSubject] = useState(action.subject ?? '')
  const [parts, setParts] = useState<TaskComponent[]>(() => asParts(action.components))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  /* Only to name the lesson the model attached and to fill the subject list.
     The id is what travels — a copied-in lesson title would go stale the moment
     the unit is re-imported, which is why `TaskSpecInput.source` holds ids. */
  const [catalog, setCatalog] = useState<CatalogLearning[] | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    listCatalogLearnings(language, controller.signal)
      .then((payload) => setCatalog(payload.learnings ?? []))
      .catch(() => setCatalog([]))
    return () => controller.abort()
  }, [language])

  const subjects = [...new Set((catalog ?? []).map((row) => row.subject).filter(Boolean))] as string[]
  const lesson = action.source_component_id
    ? (catalog ?? []).find((row) => row.component_id === action.source_component_id)
    : undefined

  const missingTitle = !title.trim()
  const missingSubject = !subject
  // The server's rule: a task needs something to be ABOUT, and a catalogue
  // lesson counts as much as a written topic.
  const missingMatter = !topic.trim() && !action.source_component_id

  const confirm = async () => {
    if (busy) return
    setBusy(true); setError('')
    const spec: TaskSpecInput = {
      title: title.trim(),
      topic: topic.trim() || lesson?.title || title.trim(),
      subject,
      language,
      difficulty: (action.difficulty as 'easy' | 'medium' | 'hard') || 'medium',
      components: parts,
      ...(action.source_component_id
        ? { source: { component_id: action.source_component_id,
                      objective_id: lesson?.objective_id ?? null } }
        : {}),
    }
    try {
      // The same two calls the builder makes, in the same order: a draft nobody
      // generates is a task that never happens.
      const created = await createTask({ group_id: groupId, spec })
      await startGeneration(created.task._id)
      onDone(t('tch.assistant.form.taskDone', { title: spec.title }))
      // Into the review screen, where the teacher reads what Yuvi wrote and
      // decides who gets it. The dock travels with them.
      navigate(`/teacher/tasks/${encodeURIComponent(created.task._id)}/review`)
    } catch {
      setError(t('tch.assistant.form.failed')); setBusy(false)
    }
  }

  return (
    <Shell title={t('tch.assistant.form.taskTitle')}>
      <label className="tch-dock__field">
        <span>
          {t('tch.tasks.field.title')}
          {missingTitle ? (
            <em className="tch-dock__needed">{t('tch.assistant.form.needed')}</em>
          ) : null}
        </span>
        <input className="sp-input" dir="auto" value={title} autoFocus={missingTitle}
               onChange={(event) => setTitle(event.target.value)} />
      </label>

      <label className="tch-dock__field">
        <span>
          {t('tch.tasks.field.subject')}
          {missingSubject ? (
            <em className="tch-dock__needed">{t('tch.assistant.form.needed')}</em>
          ) : null}
        </span>
        <select className="sp-input" value={subject} disabled={catalog === null}
                onChange={(event) => setSubject(event.target.value)}>
          <option value="">
            {catalog === null ? t('tch.tasks.learning.loading') : t('tch.tasks.subject.pick')}
          </option>
          {subjects.map((entry) => (
            <option key={entry} value={entry}>{subjectLabel(entry, t)}</option>
          ))}
        </select>
      </label>

      <label className="tch-dock__field">
        <span>
          {t('tch.tasks.field.topic')}
          {missingMatter ? (
            <em className="tch-dock__needed">{t('tch.assistant.form.needed')}</em>
          ) : null}
        </span>
        <textarea className="sp-input" dir="auto" rows={2} value={topic}
                  onChange={(event) => setTopic(event.target.value)} />
      </label>

      {/* Named, not hidden: the lesson is what keeps the questions on the
          material the class actually studied, and a teacher confirming a write
          should see what it is built on. */}
      {action.source_component_id ? (
        <p className="tch-dock__formNote" dir="auto">
          {t('tch.assistant.form.taskFromLesson', {
            lesson: lesson?.title || action.source_component_id,
          })}
        </p>
      ) : null}

      <p className="tch-dock__fieldLabel">{t('tch.tasks.field.parts')}</p>
      <ul className="tch-dock__people">
        {PARTS.map((part) => {
          const on = parts.includes(part)
          return (
            <li key={part}>
              <button type="button" className={`tch-chip${on ? ' is-on' : ''}`}
                      aria-pressed={on} dir="auto"
                      onClick={() => setParts((current) => (
                        current.includes(part)
                          ? current.filter((entry) => entry !== part)
                          : PARTS.filter((entry) => current.includes(entry) || entry === part)
                      ))}>
                {on ? <Icon name="check" size={12} aria-hidden /> : null}
                {t(`tasks.component.${part}`)}
              </button>
            </li>
          )
        })}
      </ul>

      <Foot label={t('tch.assistant.form.taskCreate')} busy={busy}
            disabled={missingTitle || missingSubject || missingMatter || !parts.length}
            error={error} onConfirm={() => void confirm()} onCancel={onCancel} />
    </Shell>
  )
}

/* ── approving finished goals ─────────────────────────────────────────────── */

function ApproveList({ action, nameOf, onDone, onCancel }: Props) {
  const { t } = useI18n()
  const goals = action.goals ?? []
  const [approved, setApproved] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  const approve = async (goalId: string, learnerId: string, conversationId: string) => {
    setBusy(goalId); setError('')
    try {
      await approveStudentGoal(learnerId, goalId, conversationId)
      const next = new Set(approved); next.add(goalId)
      setApproved(next)
      if (next.size === goals.length) {
        onDone(t(countKey('tch.assistant.form.approvedAll', next.size), { count: next.size }))
      }
    } catch {
      setError(t('tch.assistant.form.failed'))
    }
    setBusy('')
  }

  return (
    <Shell title={t('tch.assistant.form.approveTitle')}>
      <ul className="tch-dock__rows">
        {goals.map((goal) => (
          <li key={goal.goal_id}>
            <span dir="auto">
              <strong>{labelFor(goal.learner_id, nameOf(goal.learner_id))}</strong> — {goal.title}
            </span>
            {approved.has(goal.goal_id) ? (
              <span className="tch-dock__rowDone"><Icon name="check" size={13} aria-hidden /></span>
            ) : (
              <button type="button" className="sp-btn sp-btn--sm"
                      disabled={busy === goal.goal_id}
                      onClick={() => void approve(goal.goal_id, goal.learner_id, goal.conversation_id)}>
                {t('tch.assistant.form.approve')}
              </button>
            )}
          </li>
        ))}
      </ul>
      {error ? <p className="tch-dock__formError" role="status">{error}</p> : null}
      <div className="tch-dock__formFoot">
        <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm" onClick={onCancel}>
          {t('tch.assistant.form.close')}
        </button>
      </div>
    </Shell>
  )
}

/* ── closing alerts ───────────────────────────────────────────────────────── */

function AlertList({ action, nameOf, onDone, onCancel }: Props) {
  const { t } = useI18n()
  const alerts = action.alerts ?? []
  const [acked, setAcked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState('')

  const ack = async (alertId: string) => {
    setBusy(alertId)
    try {
      await acknowledgeAlert(alertId)
      const next = new Set(acked); next.add(alertId)
      setAcked(next)
      if (next.size === alerts.length) {
        onDone(t(countKey('tch.assistant.form.ackedAll', next.size), { count: next.size }))
      }
    } catch { /* the row simply stays actionable */ }
    setBusy('')
  }

  return (
    <Shell title={t('tch.assistant.form.ackTitle')}>
      <ul className="tch-dock__rows">
        {alerts.map((alert) => (
          <li key={alert.alert_id}>
            <span dir="auto">{alert.learner_id ? labelFor(alert.learner_id, nameOf(alert.learner_id)) : t('tch.assistant.form.alert')}</span>
            {acked.has(alert.alert_id) ? (
              <span className="tch-dock__rowDone"><Icon name="check" size={13} aria-hidden /></span>
            ) : (
              <button type="button" className="sp-btn sp-btn--sm"
                      disabled={busy === alert.alert_id}
                      onClick={() => void ack(alert.alert_id)}>
                {t('tch.assistant.form.ack')}
              </button>
            )}
          </li>
        ))}
      </ul>
      <div className="tch-dock__formFoot">
        <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm" onClick={onCancel}>
          {t('tch.assistant.form.close')}
        </button>
      </div>
    </Shell>
  )
}
