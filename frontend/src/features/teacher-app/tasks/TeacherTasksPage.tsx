/* Teacher tasks: what you have sent, and building the next one.
 *
 * The builder is a form, not a chat, and that is the same call the daily brief
 * makes: a model writes only what needs inference. A task's title, its question
 * count and who it goes to are not judgement calls — they are a teacher's
 * decision, and routing them through a conversation adds a way to get them
 * wrong. Yuvi writes the *content*, which is the whole of the hard part.
 *
 * (The chat can still open this form pre-filled — that is what Phase 1's
 * action framework is for — but the form is the surface that always works,
 * including with no provider at all.)
 *
 * Generation is polled, not awaited: it is several model calls and a teacher
 * must be able to leave the page and come back to a finished task.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { navigate } from '../../../app/router'
import {
  EmptyState, ErrorState, Icon, SectionHeader, Skeleton, StatusPill, Tooltip,
  type StatusTone,
} from '../../../components/primitives'
// Not re-exported from the primitives index — imported directly, like LoginDialog.
import { Modal } from '../../../components/primitives/Modal'
import { useI18n } from '../../../i18n/I18nProvider'
import { useAuth } from '../../../providers/AuthProvider'
import { useTeacherScope } from '../../../providers/TeacherScopeProvider'
import {
  closeTask, createTask, listCatalogLearnings, listTeacherTasks,
  startGeneration, suggestTaskNotes,
  type CatalogLearning, type TaskComponent, type TaskSpecInput, type TaskSummary,
} from '../../../services/tasks'
import { countKey } from '../shared/countLabel'
import { subjectLabel } from '../shared/subjectLabel'
import { clearDraft, isEmptyDraft, loadDraft, saveDraft } from './builderDraft'
import { putAudience, takeSeed, type TaskSeed } from './taskSeed'
import './teacher-tasks.css'

/** What a teacher may ask for. "Activity" is gone: its scored blocks were
 *  practice questions under another name, and its study cards are part of
 *  practice now. */
const COMPONENTS = ['presentation', 'practice', 'test'] as const

/** What a deck can be asked for, beyond how many slides.
 *
 *  Every one of these changes the OUTPUT — four change the prompt, one changes
 *  what is spent generating it, one changes only the render. A setting a
 *  teacher can move without being able to see what it did is worse than no
 *  setting: it teaches them not to trust the rest of the form either.
 *  Mirrors `SPEC_DEFAULTS["presentation"]` in `tasks/spec.py`. */
type DeckOptions = NonNullable<TaskSpecInput['presentation']>

const DECK_THEMES = ['auto', 'math', 'science', 'history', 'nature', 'language', 'plain'] as const
const DECK_DENSITIES = ['airy', 'balanced', 'full'] as const
/** The four that are simply on or off. Order is the order they are read in. */
const DECK_TOGGLES = ['diagrams', 'examples', 'self_check', 'teacher_notes'] as const
type BuildableComponent = (typeof COMPONENTS)[number]
const POLL_MS = 4000
/** How long the form waits after a keystroke before writing the draft. Long
 *  enough that typing a sentence is one write, short enough that closing the
 *  laptop mid-thought keeps the thought. */
const DRAFT_DEBOUNCE_MS = 400

export function TeacherTasksPage() {
  const { t } = useI18n()
  const { groupId } = useTeacherScope()
  const [tasks, setTasks] = useState<TaskSummary[] | null>(null)
  const [error, setError] = useState(false)
  const [building, setBuilding] = useState(false)
  const [query, setQuery] = useState('')
  const [subject, setSubject] = useState('all')
  /* Arriving from somewhere that already knows what the task is about — the
     class-gaps panel sends the objective and the children it is a gap for. */
  const [seed, setSeed] = useState<TaskSeed | null>(null)

  useEffect(() => {
    const arrived = takeSeed()
    if (!arrived) return
    setSeed(arrived)
    setBuilding(true)
  }, [])

  const load = useCallback(async () => {
    if (!groupId) return
    try {
      const payload = await listTeacherTasks(groupId)
      setTasks(payload.tasks)
    } catch {
      setError(true)
    }
  }, [groupId])

  useEffect(() => { void load() }, [load])

  /* Poll only while something is actually generating. A page that polls
     forever is a page that costs a request every four seconds for as long as
     a teacher leaves the tab open. */
  const generating = tasks?.some((task) => task.status === 'generating') ?? false
  useEffect(() => {
    if (!generating) return
    const id = setInterval(() => { void load() }, POLL_MS)
    return () => clearInterval(id)
  }, [generating, load])

  /* Filtered in the browser rather than on the server: this list is one class's
     tasks, it is already loaded, and a round trip per keystroke would make
     search feel slower than scrolling. */
  const subjects = useMemo(() => (
    [...new Set((tasks ?? []).map((task) => task.subject).filter(Boolean))] as string[]
  ), [tasks])

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return (tasks ?? []).filter((task) => (
      (subject === 'all' || task.subject === subject) &&
      (!needle || (task.title ?? '').toLowerCase().includes(needle))
    ))
  }, [tasks, query, subject])

  return (
    <div className="tch-tasks">
      <SectionHeader
        title={t('tch.tasks.title')}
        subtitle={t('tch.tasks.subtitle')}
        action={
          <button type="button" className="sp-btn sp-btn--sm"
                  onClick={() => setBuilding(true)}>
            <Icon name="plus" size={16} />
            {t('tch.tasks.new')}
          </button>
        }
      />

      {/* A centred dialog, not an inline panel. Building a task is a piece of
          work with a dozen fields, and expanding it in the page pushed the list
          the teacher was reading down the screen while they filled it in. The
          button is no longer a toggle either — "cancel" belongs inside the
          dialog, next to the thing it cancels.

          `dismissible={false}`: a click a pixel outside the dialog used to
          throw away a form a teacher had spent minutes on. It now leaves only
          through the cancel button — and even that keeps the draft. */}
      <Modal
        open={Boolean(building && groupId)}
        onClose={() => setBuilding(false)}
        titleId="tch-task-builder-title"
        className="tch-builder__modal"
        dismissible={false}
      >
        <div className="tch-builder__head">
          <h2 id="tch-task-builder-title" className="tch-builder__modalTitle" dir="auto">
            {t('tch.tasks.new')}
          </h2>
          {/* The brief note moved INTO the first step, beside the fields it is
              about. As a permanent header it was four lines of prose above
              every field in the dialog, read once and scrolled past forever. */}
        </div>
        {groupId ? (
          <TaskBuilder
            groupId={groupId}
            seed={seed}
            onCancel={() => { setBuilding(false); setSeed(null) }}
            onDone={() => { setBuilding(false); setSeed(null); void load() }}
          />
        ) : null}
      </Modal>

      {/* Only once there is something to lose. A search box above ONE task is
          furniture; above three it is already how a teacher finds last week's,
          and the threshold was set at five on a hunch that a class with three
          tasks is a class you can read. Classes get their fourth task in a
          fortnight, and until then the box costs a row of chrome. */}
      {(tasks?.length ?? 0) > 1 ? (
        <div className="tch-tasks__filters">
          <input className="sp-input tch-tasks__search" value={query} dir="auto"
                 type="search" aria-label={t('tch.tasks.searchLabel')}
                 placeholder={t('tch.tasks.searchLabel')}
                 onChange={(event) => setQuery(event.target.value)} />
          {subjects.length > 1 ? (
            <div className="tch-builder__chips">
              <button type="button" className={`tch-chip${subject === 'all' ? ' is-on' : ''}`}
                      aria-pressed={subject === 'all'} onClick={() => setSubject('all')}>
                {t('tch.tasks.allSubjects')}
              </button>
              {subjects.map((entry) => (
                <button key={entry} type="button"
                        className={`tch-chip${subject === entry ? ' is-on' : ''}`}
                        aria-pressed={subject === entry}
                        onClick={() => setSubject(entry)}>
                  {subjectLabel(entry, t)}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <ErrorState title={t('tch.tasks.error')} body={t('tch.tasks.errorBody')} />
      ) : tasks === null ? (
        <div className="tch-tasks__loading">
          {[0, 1, 2].map((index) => <Skeleton key={index} w="100%" h={64} />)}
        </div>
      ) : tasks.length === 0 ? (
        <EmptyState icon="backpack" title={t('tch.tasks.empty')} body={t('tch.tasks.emptyBody')} />
      ) : shown.length === 0 ? (
        <EmptyState icon="search" title={t('tch.tasks.noMatch')}
                    body={t('tch.tasks.noMatchBody')} />
      ) : (
        <ul className="tch-tasks__list">
          {shown.map((task) => (
            <TaskRow key={task.id} task={task} onChanged={load} />
          ))}
        </ul>
      )}
    </div>
  )
}

function TaskRow({ task, onChanged }: { task: TaskSummary; onChanged: () => void }) {
  const { t } = useI18n()
  const [busy, setBusy] = useState(false)

  const tone: StatusTone = task.status === 'live' ? 'strong'
    : task.status === 'generating' ? 'steady'
    : task.status === 'ready' ? 'support' : 'neutral'

  const act = async (run: () => Promise<unknown>) => {
    setBusy(true)
    try { await run(); onChanged() } finally { setBusy(false) }
  }

  return (
    <li className="tch-task">
      <div className="tch-task__main">
        {/* A heading, not a button. Where a title took you was a guess — the
            same click meant "look at what Yuvi wrote" before it was sent and
            "see what the class did" after. Both are buttons now, and both say
            which they are. */}
        <h3 className="tch-task__title" dir="auto">{task.title ?? t('tasks.untitled')}</h3>
        <p className="tch-task__meta">
          <StatusPill tone={tone}>{t(`tch.tasks.status.${task.status}`)}</StatusPill>
          {task.subject ? <span>{subjectLabel(task.subject, t)}</span> : null}
          {task.launch_count > 1 ? (
            <span>{t('tch.tasks.openings', { n: String(task.launch_count) })}</span>
          ) : null}
          {task.launch_count > 0 ? (
            <span>{t('tch.tasks.progress', {
              done: String(task.completed), all: String(task.assigned),
            })}</span>
          ) : null}
          {task.average_score !== null ? (
            <span>{t('tch.tasks.average', { n: String(task.average_score) })}</span>
          ) : null}
        </p>

        {/* Not swallowed. A teacher whose task is missing its deck should be
            told which pass failed rather than wondering where it went. */}
        {task.generation_failures.length > 0 ? (
          <p className="tch-task__failed">
            <Icon name="alert" size={14} />
            {t('tch.tasks.partial', {
              parts: task.generation_failures
                .map((entry) => t(`tasks.component.${entry.component}`)).join(', '),
            })}
          </p>
        ) : null}
      </div>

      <div className="tch-task__actions">
        {task.status === 'draft' ? (
          <button type="button" className="sp-btn sp-btn--sm" disabled={busy}
                  onClick={() => void act(() => startGeneration(task.id))}>
            <Icon name="wand" size={15} />
            {t('tch.tasks.generate')}
          </button>
        ) : null}
        {task.status === 'generating' ? (
          <span className="tch-task__working">
            <Icon name="clock" size={15} />
            {t('tch.tasks.working')}
          </span>
        ) : null}
        {/* Two named destinations instead of one ambiguous title. Review is
            where a task is read and sent from; progress is where a class's
            results live. Both stay available after sending — a task can be
            reviewed and opened again. */}
        {task.status !== 'draft' && task.status !== 'generating' ? (
          <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm" disabled={busy}
                  onClick={() => navigate(
                    `/teacher/tasks/${encodeURIComponent(task.id)}/review`)}>
            <Icon name="search" size={15} />
            {t('tch.tasks.review')}
          </button>
        ) : null}
        {task.launch_count > 0 ? (
          <button type="button" className="sp-btn sp-btn--sm" disabled={busy}
                  onClick={() => navigate(`/teacher/tasks/${encodeURIComponent(task.id)}`)}>
            <Icon name="chart" size={15} />
            {t('tch.tasks.progress.link')}
          </button>
        ) : null}
        {task.open_launches > 0 ? (
          <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm" disabled={busy}
                  onClick={() => void act(() => closeTask(task.id))}>
            {t('tch.tasks.close')}
          </button>
        ) : null}
      </div>
    </li>
  )
}

/** The spec form. Everything here is the teacher's decision, so none of it is
 *  inferred — the generation that follows is where the model earns its place.
 *
 *  Two things it now does that it did not:
 *
 *  **It can be grounded in real material.** Picking a lesson from the Kata
 *  catalogue puts that lesson's own screen-by-screen description in front of
 *  the generator, so the task is about what the class actually studied rather
 *  than about a topic string. It stays optional: a teacher inventing a task
 *  from scratch is a first-class case.
 *
 *  **It survives being closed.** The form writes itself to the teacher's own
 *  machine as they type, and the dialog no longer closes on a stray click.
 */
export function TaskBuilder({ groupId, seed, onDone, onCancel }: {
  groupId: string
  /** A task started from a finding elsewhere, rather than from a blank form. */
  seed?: TaskSeed | null
  onDone: () => void
  onCancel: () => void
}) {
  const { t, language } = useI18n()
  const { user } = useAuth()

  const teacherId = user?.user_id ?? ''
  const [learnings, setLearnings] = useState<CatalogLearning[] | null>(null)
  const [title, setTitle] = useState('')
  const [topic, setTopic] = useState('')
  const [notes, setNotes] = useState('')
  const [sourceId, setSourceId] = useState('')
  const [subject, setSubject] = useState('')
  const [difficulty, setDifficulty] = useState<'easy' | 'medium' | 'hard'>('medium')
  const [components, setComponents] = useState<BuildableComponent[]>(['practice'])
  const [counts, setCounts] = useState({ practice: 8, test: 10, presentation: 7 })
  /* How the deck is written and drawn. Defaults match the backend's
     `SPEC_DEFAULTS`, so a teacher who opens the panel and changes nothing sends
     exactly what a teacher who never opened it sends. */
  const [deck, setDeck] = useState<DeckOptions>({
    theme: 'auto', density: 'balanced', examples: true,
    diagrams: true, self_check: true, teacher_notes: true, key_concepts: '',
  })
  const [deadline, setDeadline] = useState(defaultDeadline())
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  const [restored, setRestored] = useState(false)
  const [suggesting, setSuggesting] = useState(false)
  const [suggestFailed, setSuggestFailed] = useState(false)
  /* Which section is on screen. The dialog holds a dozen fields that answer
     three separate questions — what it is about, what is in it, how Yuvi
     should write it — and as one column they read as one undifferentiated
     form, with the load-bearing brief at the bottom where nobody scrolled. */
  const [step, setStep] = useState(0)
  const titleRef = useRef<HTMLInputElement>(null)
  const stepRef = useRef<HTMLDivElement>(null)
  const flushDraft = useRef<() => void>(() => {})

  useEffect(() => { titleRef.current?.focus() }, [])

  useEffect(() => {
    const controller = new AbortController()
    listCatalogLearnings(language, controller.signal)
      .then((payload) => setLearnings(payload.learnings))
      // An empty list, not an error state: the picker is optional and a dead
      // catalogue must not block a teacher writing their own task.
      .catch(() => setLearnings([]))
    return () => controller.abort()
  }, [language])

  /* Restore once, on open. Guarded on `isEmptyDraft` so an untouched form
     from a previous session does not announce itself as recovered work.
     A seeded dialog restores nothing: the teacher has just said what this task
     is about, and last week's half-written one would overwrite the answer. The
     draft itself is left where it is, so the blank-form route still finds it. */
  useEffect(() => {
    if (seed) return
    const draft = loadDraft(teacherId, groupId)
    if (isEmptyDraft(draft) || !draft) return
    setTitle(String(draft.title ?? ''))
    setTopic(String(draft.topic ?? ''))
    setNotes(String(draft.notes ?? ''))
    setSourceId(String((draft.source as { component_id?: string } | null)?.component_id ?? ''))
    if (draft.difficulty === 'easy' || draft.difficulty === 'hard' || draft.difficulty === 'medium') {
      setDifficulty(draft.difficulty)
    }
    if (Array.isArray(draft.components)) {
      // A draft written before "activity" was folded into practice may still
      // name it. Dropped rather than restored: it is no longer something this
      // form can build.
      const picked = draft.components.filter(
        (entry): entry is BuildableComponent =>
          COMPONENTS.includes(entry as BuildableComponent))
      if (picked.length > 0) setComponents(picked)
    }
    if (draft.counts && typeof draft.counts === 'object') {
      setCounts((current) => ({ ...current, ...(draft.counts as typeof current) }))
    }
    if (draft.deck && typeof draft.deck === 'object') {
      setDeck((current) => ({ ...current, ...(draft.deck as DeckOptions) }))
    }
    if (typeof draft.deadline === 'string' && draft.deadline) setDeadline(draft.deadline)
    setRestored(true)
  }, [teacherId, groupId, seed])

  /* What the finding already knew. The title and the subject matter come
     straight across; the subject and the lesson are LOOKED UP, because a gap
     names a Kata objective and the catalogue knows which lesson teaches it —
     so a teacher who came from a gap opens the dialog with the material
     already picked rather than hunting for it by name. */
  useEffect(() => {
    if (!seed) return
    setTitle(seed.title)
    setTopic(seed.topic)
  }, [seed])

  useEffect(() => {
    if (!seed?.objectiveId || !learnings?.length) return
    const match = learnings.find((row) => row.objective_id === seed.objectiveId)
    if (!match) return
    setSubject((current) => current || match.subject || '')
    setSourceId((current) => current || match.component_id)
  }, [seed, learnings])

  /* Debounced, and deliberately not including `target`: a class was chosen for
     the group the draft is keyed to, and restoring a learner id that has since
     left the class would silently point the task at nobody.

     The `pagehide` flush is not belt-and-braces — it is the case this feature
     exists for. A teacher who closes the tab mid-sentence closes it inside the
     debounce window, so without the flush the one thing lost is the last thing
     they typed. Same pattern as the player's autosave, for the same reason.

     A seeded dialog writes nothing, which is the other half of restoring
     nothing. There is one draft per teacher per class, and a task started from
     a gap would otherwise overwrite the one they hand-wrote on Tuesday — five
     minutes of their own words replaced by a title a click generated. A seeded
     form can be recreated by pressing the same button again; that draft
     cannot. */
  useEffect(() => {
    const draft = {
      title, topic, notes, difficulty, components, counts, deck, deadline,
      source: sourceId ? { component_id: sourceId } : null,
    }
    const write = () => { if (!seed) saveDraft(teacherId, groupId, draft) }
    // Kept where `close()` can reach it: pressing cancel inside the debounce
    // window is the same case as closing the tab inside it, and loses the same
    // thing — the last sentence typed.
    flushDraft.current = write
    const id = setTimeout(write, DRAFT_DEBOUNCE_MS)
    window.addEventListener('pagehide', write)
    return () => {
      clearTimeout(id)
      window.removeEventListener('pagehide', write)
    }
  }, [teacherId, groupId, seed, title, topic, notes, difficulty, components, counts,
      deadline, sourceId])

  const toggle = (component: BuildableComponent) => setComponents((current) => (
    current.includes(component)
      ? current.filter((entry) => entry !== component)
      : [...current, component]
  ))

  const lesson = useMemo(
    () => (learnings ?? []).find((row) => row.component_id === sourceId) ?? null,
    [learnings, sourceId],
  )

  /** The subjects the catalogue actually has material for. */
  const subjects = useMemo(() => (
    [...new Set((learnings ?? []).map((row) => row.subject).filter(Boolean))] as string[]
  ), [learnings])

  /* Narrowed by the chosen subject before the search box ever sees them: a
     teacher who has said "maths" should not have to type past the science. */
  const filteredLessons = useMemo(
    () => (learnings ?? []).filter((row) => !subject || row.subject === subject),
    [learnings, subject],
  )

  const source = sourceId
    ? { component_id: sourceId, objective_id: lesson?.objective_id ?? null }
    : undefined

  /* The same three requirements the server checks in `assist.missing_fields`.
     Mirrored here because a disabled button has to react to a keystroke, and
     reconciled below: if the server disagrees, the server's answer replaces
     this one on screen. */
  const [missing, setMissing] = useState<string[] | null>(null)
  const locallyMissing = useMemo(() => {
    const gaps: string[] = []
    if (!title.trim()) gaps.push('title')
    if (components.length === 0) gaps.push('components')
    if (!topic.trim() && !sourceId) gaps.push('subject_matter')
    return gaps
  }, [title, components, topic, sourceId])
  const blocking = missing ?? locallyMissing

  const suggest = async () => {
    if (blocking.length > 0 || suggesting) return
    setSuggesting(true)
    setSuggestFailed(false)
    try {
      const payload = await suggestTaskNotes({
        title: title.trim(), topic: topic.trim(), difficulty, components,
        notes: notes.trim(), source, language,
      })
      if (payload.notes) setNotes(payload.notes)
      else if (payload.missing.length > 0) setMissing(payload.missing)
      else setSuggestFailed(true)
    } catch {
      setSuggestFailed(true)
    } finally {
      setSuggesting(false)
    }
  }

  // Whatever the local check says stops being interesting the moment the
  // teacher fixes it — otherwise a server answer sticks after its cause is gone.
  useEffect(() => { setMissing(null) }, [title, components, topic, sourceId])

  // Subject is required: it is what the list filters by, and a task with no
  // subject is a task nobody finds again.
  const ready = title.trim().length > 0 && components.length > 0 && Boolean(subject)

  /* The three questions this dialog asks, and what each one cannot leave
     unanswered. A step gates on ITS OWN fields only — being sent back two
     sections to fix something is what makes a wizard worse than a form. */
  const STEPS = ['about', 'parts', 'brief'] as const
  const gaps: string[][] = [
    [
      ...(title.trim() ? [] : ['title']),
      ...(subject ? [] : ['subject']),
      ...(topic.trim() || sourceId ? [] : ['subject_matter']),
    ],
    components.length ? [] : ['components'],
    [],
  ]
  const blockedAt = gaps.findIndex((missing) => missing.length > 0)
  /** Every step up to the first unanswered one. Dots past it are not links. */
  const reachable = (index: number) =>
    index <= step || blockedAt === -1 || index <= blockedAt

  const goTo = (index: number) => {
    setStep(index)
    // Focus the panel, not the first field: a screen reader should hear which
    // section it landed in before it hears a label.
    window.requestAnimationFrame(() => stepRef.current?.focus())
  }

  const create = async () => {
    if (!ready || busy) return
    setBusy(true)
    setFailed(null)
    const spec: TaskSpecInput = {
      title: title.trim(),
      topic: topic.trim() || lesson?.title || title.trim(),
      language,
      difficulty,
      notes: notes.trim(),
      components,
      // `study_count` is not a field on this form. Rehearsal cards are a
      // property of practice, not a quantity a teacher should have to decide —
      // the generator is told to write none at all when the topic has nothing
      // worth rehearsing that way.
      practice: { question_count: counts.practice },
      test: { question_count: counts.test },
      presentation: { slide_count: counts.presentation, ...deck },
      ...(source ? { source } : {}),
    }
    try {
      const created = await createTask({
        // No target: who receives it is decided in the launch dialog.
        group_id: groupId, spec, deadline: deadline || undefined,
      })
      // Who it was built for, remembered for the send dialog — the children a
      // gap was a gap for. A suggestion carried forward, not a send: nothing
      // reaches anyone until the teacher has read what Yuvi wrote.
      if (seed?.learnerIds.length) putAudience(created.task._id, seed.learnerIds)
      // Straight into generation: a draft nobody generates is a task that
      // never happens, and the teacher has already said what they want.
      await startGeneration(created.task._id)
      // And for the same reason, a seeded build does not clear the draft it
      // never touched.
      if (!seed) clearDraft(teacherId, groupId)
      onDone()
      // Into the review screen rather than back to the list: what happens next
      // is reading what Yuvi wrote, and the list is where a teacher goes to
      // find a task, not to watch one being written.
      navigate(`/teacher/tasks/${encodeURIComponent(created.task._id)}/review`)
    } catch (cause) {
      setFailed(String(cause))
      setBusy(false)
    }
  }

  /* Closing is not discarding. The dialog's own contract is that a form
     survives being closed — that is what the autosave and the "we brought your
     draft back" banner are for — and `clearDraft` here quietly broke it: press
     cancel on step 3 and five minutes of work was gone with no warning and no
     undo. Throwing it away has its own control, in the banner, where a teacher
     who wants a blank form asks for one.

     Sectioning made this worse rather than causing it: three screens is three
     times as many places to step out of, and cancel is the button next to the
     one that moves you on. */
  const close = () => {
    flushDraft.current()
    onCancel()
  }

  return (
    <div className="tch-builder">
      {restored ? (
        <p className="tch-builder__restored" dir="auto">
          <Icon name="reflect" size={15} aria-hidden="true" />
          <span>{t('tch.tasks.draftRestored')}</span>
          <button type="button" className="tch-builder__discard" onClick={() => {
            clearDraft(teacherId, groupId)
            setTitle(''); setTopic(''); setNotes(''); setSourceId('')
            setComponents(['practice']); setRestored(false)
          }}>
            {t('tch.tasks.draftDiscard')}
          </button>
        </p>
      ) : null}

      {/* The dots. Position in a piece of work, and a way back to any part of
          it already answered — a stepper that can only go forwards turns "let
          me change the title" into cancelling the whole dialog. */}
      <nav className="tch-builder__steps" aria-label={t('tch.tasks.new')}>
        {STEPS.map((name, index) => (
          <button
            key={name}
            type="button"
            /* Filled = behind you, bar = here, hollow = ahead. Marking every
               reachable step as done filled all three dots on an open dialog,
               which says "you have finished" to someone who has typed nothing. */
            className={`tch-builder__dot${index === step ? ' is-current' : ''}${
              index < step ? ' is-done' : ''}`}
            aria-current={index === step ? 'step' : undefined}
            aria-label={t('tch.tasks.goToStep', { name: t(`tch.tasks.step.${name}`) })}
            disabled={!reachable(index)}
            onClick={() => goTo(index)}
          >
            <span className="tch-builder__dotMark" aria-hidden="true" />
            <span className="tch-builder__dotName">{t(`tch.tasks.step.${name}`)}</span>
          </button>
        ))}
      </nav>

      <div className="tch-builder__step" ref={stepRef} tabIndex={-1}
           aria-label={t(`tch.tasks.step.${STEPS[step]}`)}>
        <p className="tch-builder__stepOf" dir="auto">
          {t('tch.tasks.stepOf', { step: step + 1, total: STEPS.length })}
        </p>

        {step === 0 ? <>
          {/* Said where the pre-filled fields are, not left to be inferred: a
              dialog that opens already typed-in has to say who typed it. */}
          {seed ? (
            <p className="tch-builder__note" dir="auto">
              <Icon name="wand" size={16} aria-hidden="true" />
              <span>{seed.learnerIds.length
                ? t(countKey('tch.tasks.fromGap', seed.learnerIds.length),
                    { count: seed.learnerIds.length })
                : t('tch.tasks.fromGap.none')}</span>
            </p>
          ) : null}

          {/* The single most load-bearing sentence in this dialog, now beside
              the fields it is actually about. */}
          <p className="tch-builder__note" dir="auto">
            <Icon name="lightbulb" size={16} aria-hidden="true" />
            <span>{t('tch.tasks.builderNote')}</span>
          </p>

          <label className="tch-builder__field">
            <span>{t('tch.tasks.field.title')}</span>
            <input ref={titleRef} className="sp-input" value={title} dir="auto"
                   placeholder={t('tch.tasks.field.titleHint')}
                   onChange={(event) => setTitle(event.target.value)} />
          </label>

      {/* Required, and drawn from the subjects the catalogue actually holds —
          so it can never offer one with no material behind it, and it needs no
          endpoint of its own. It is what the tasks list filters by. */}
      <label className="tch-builder__field">
        <span>{t('tch.tasks.field.subject')}</span>
        <select className="sp-input" value={subject} disabled={learnings === null}
                onChange={(event) => { setSubject(event.target.value); setSourceId('') }}>
          <option value="">
            {learnings === null ? t('tch.tasks.learning.loading') : t('tch.tasks.subject.pick')}
          </option>
          {subjects.map((entry) => (
            <option key={entry} value={entry}>{subjectLabel(entry, t)}</option>
          ))}
        </select>
      </label>

      {/* The lesson picker sits above the free-text topic on purpose: if there
          IS material for this, picking it beats describing it. A search box
          rather than one long list — fourteen lessons today, a curriculum's
          worth later, and a 200-option dropdown is not a picker. */}
      <LessonPicker
        lessons={filteredLessons}
        loading={learnings === null}
        value={sourceId}
        lesson={lesson}
        disabled={!subject}
        onPick={setSourceId}
      />

      <label className="tch-builder__field">
        <span>{t('tch.tasks.field.topic')}</span>
        <input className="sp-input" value={topic} dir="auto"
               placeholder={lesson ? (lesson.title ?? '') : t('tch.tasks.field.topicHint')}
               onChange={(event) => setTopic(event.target.value)} />
      </label>
        </> : null}

        {step === 1 ? <>
          <p className="tch-builder__note" dir="auto">
            <Icon name="lightbulb" size={16} aria-hidden="true" />
            <span>{t('tch.tasks.step.partsNote')}</span>
          </p>

      <fieldset className="tch-builder__field tch-builder__parts">
        <legend>
          <span>{t('tch.tasks.field.parts')}</span>
          <Tooltip label={t('tch.tasks.parts.help')} className="tch-builder__partsTip">
            <span className="tch-builder__partsHelp">
              <strong>{t('tch.tasks.parts.help')}</strong>
              <ul>
                {COMPONENTS.map((component) => (
                  <li key={component}>
                    <b>{t(`tasks.component.${component}`)}</b>
                    {' — '}
                    {t(`tch.tasks.parts.explain.${component}`)}
                  </li>
                ))}
              </ul>
            </span>
          </Tooltip>
        </legend>
        <div className="tch-builder__chips">
          {COMPONENTS.map((component) => (
            <button key={component} type="button"
                    className={`tch-chip${components.includes(component) ? ' is-on' : ''}`}
                    aria-pressed={components.includes(component)}
                    onClick={() => toggle(component)}>
              {t(`tasks.component.${component}`)}
            </button>
          ))}
        </div>
        {/* Said once, where the fourth chip used to be: the drag-and-drop
            question types did not go anywhere, they are practice questions and
            always were. A teacher who used to reach for "activity" needs to
            know that, or they will think the app lost a feature. */}
        {components.includes('practice') ? (
          <p className="tch-builder__hint" dir="auto">{t('tch.tasks.practiceIncludes')}</p>
        ) : null}
      </fieldset>

      {components.length > 0 ? (
        <div className="tch-builder__counts">
          {components.map((component) => (
            <label key={component} className="tch-builder__count">
              <span>{t(`tch.tasks.count.${component}`)}</span>
              <input type="number" className="sp-input" min={1} max={30}
                     value={counts[component]}
                     onChange={(event) => setCounts((current) => ({
                       ...current, [component]: Number(event.target.value) || 1,
                     }))} />
            </label>
          ))}
        </div>
      ) : null}

      {/* Everything else a deck can be asked for. Only when one is being built:
          a teacher writing a practice-only task should not have to scroll past
          seven fields about slides. */}
      {components.includes('presentation') ? (
        <fieldset className="tch-builder__field tch-builder__deck">
          <legend>
            <span>{t('tch.tasks.deck.legend')}</span>
            <Tooltip label={t('tch.tasks.deck.help')}>
              <span className="tch-builder__partsHelp">
                <strong>{t('tch.tasks.deck.help')}</strong>
                <dl>
                  {DECK_TOGGLES.map((key) => (
                    <div key={key}>
                      <dt>{t(`tch.tasks.deck.${key}`)}</dt>
                      <dd>{t(`tch.tasks.deck.explain.${key}`)}</dd>
                    </div>
                  ))}
                </dl>
              </span>
            </Tooltip>
          </legend>

          <div className="tch-builder__deckRow">
            <label>
              <span>{t('tch.tasks.deck.theme')}</span>
              <select className="sp-input" value={deck.theme}
                      onChange={(event) => setDeck((current) => ({
                        ...current, theme: event.target.value as DeckOptions['theme'] }))}>
                {DECK_THEMES.map((value) => (
                  <option key={value} value={value}>{t(`tch.tasks.deck.theme.${value}`)}</option>
                ))}
              </select>
            </label>
            <label>
              <span>{t('tch.tasks.deck.density')}</span>
              <select className="sp-input" value={deck.density}
                      onChange={(event) => setDeck((current) => ({
                        ...current, density: event.target.value as DeckOptions['density'] }))}>
                {DECK_DENSITIES.map((value) => (
                  <option key={value} value={value}>{t(`tch.tasks.deck.density.${value}`)}</option>
                ))}
              </select>
            </label>
          </div>

          {/* Chips rather than checkboxes, like every other multi-choice in
              this dialog, and pressed by default because the deck a teacher
              expects is the one with pictures, examples and notes in it. */}
          <div className="tch-builder__chips">
            {DECK_TOGGLES.map((key) => (
              <button key={key} type="button"
                      className={`tch-chip${deck[key] ? ' is-on' : ''}`}
                      aria-pressed={Boolean(deck[key])}
                      onClick={() => setDeck((current) => ({ ...current, [key]: !current[key] }))}>
                {t(`tch.tasks.deck.${key}`)}
              </button>
            ))}
          </div>

          {/* The highest-value field here: the difference between a deck about
              the topic and a deck about what this class is learning this week. */}
          <label className="tch-builder__deckConcepts">
            <span>{t('tch.tasks.deck.concepts')}</span>
            <input className="sp-input" dir="auto" value={deck.key_concepts ?? ''}
                   placeholder={t('tch.tasks.deck.conceptsHint')}
                   onChange={(event) => setDeck((current) => ({
                     ...current, key_concepts: event.target.value }))} />
          </label>
        </fieldset>
      ) : null}

      {/* No "who". Who receives a task is decided when it is sent — the same
          material goes to different children in different weeks, and choosing
          an audience while writing the questions made a task a one-shot
          document. The launch dialog owns that decision now. */}

      {/* A `div` rather than a wrapping `label`: the tooltip trigger is a real
          button, and inside a label every click on it would also drop focus
          into the select behind it. */}
      <div className="tch-builder__field">
        <div className="tch-builder__notesHead">
          <label htmlFor="tch-task-difficulty">{t('tch.tasks.field.difficulty')}</label>
          {/* What the level does, in the same terms the generator is given —
              steps, numbers, scaffolding, distractors, transfer. A teacher who
              sets a control has to be able to predict what it changes, and
              "easy / medium / hard" predicts nothing. */}
          <Tooltip label={t('tch.tasks.difficulty.help')}>
            <span className="tch-builder__partsHelp">
              <strong>{t('tch.tasks.difficulty.help')}</strong>
              <dl>
                {(['easy', 'medium', 'hard'] as const).map((level) => (
                  <div key={level}>
                    <dt>{t(`tch.tasks.difficulty.${level}`)}</dt>
                    <dd>{t(`tch.tasks.difficulty.explain.${level}`)}</dd>
                  </div>
                ))}
              </dl>
              <em>{t('tch.tasks.difficulty.explainSlides')}</em>
            </span>
          </Tooltip>
        </div>
        <select id="tch-task-difficulty" className="sp-input" value={difficulty}
                onChange={(event) => setDifficulty(event.target.value as never)}>
          <option value="easy">{t('tch.tasks.difficulty.easy')}</option>
          <option value="medium">{t('tch.tasks.difficulty.medium')}</option>
          <option value="hard">{t('tch.tasks.difficulty.hard')}</option>
        </select>
      </div>
        </> : null}

        {step === 2 ? <>
          {/* What is about to be built, in one line. The last step is where a
              teacher presses a button that spends a minute of generation, and
              the two decisions behind it are now on screens they cannot see. */}
          <p className="tch-builder__summary" dir="auto">
            {t('tch.tasks.summary', {
              title: title.trim(),
              subject: subject ? subjectLabel(subject, t) : '—',
              parts: components.map((entry) => t(`tasks.component.${entry}`)).join(' · '),
            })}
          </p>
          <p className="tch-builder__note" dir="auto">
            <Icon name="lightbulb" size={16} aria-hidden="true" />
            <span>{t('tch.tasks.step.briefNote')}</span>
          </p>

      <div className="tch-builder__field">
        <div className="tch-builder__notesHead">
          <label htmlFor="tch-task-notes">{t('tch.tasks.field.notes')}</label>
          <NotesSuggestButton
            missing={blocking} busy={suggesting} onClick={() => void suggest()}
          />
        </div>
        <textarea id="tch-task-notes" className="sp-input" rows={4} value={notes} dir="auto"
                  placeholder={t('tch.tasks.field.notesHint')}
                  onChange={(event) => setNotes(event.target.value)} />
        {suggestFailed ? (
          <small className="tch-builder__hint" dir="auto">{t('tch.tasks.suggestFailed')}</small>
        ) : null}
      </div>
        </> : null}
      </div>

      {failed ? <p className="tch-builder__failed" dir="auto">{t('tch.tasks.createFailed')}</p> : null}

      {/* Named rather than only greyed out: a disabled button with no reason
          beside it is the teacher's problem to solve by guessing. */}
      {gaps[step].length ? (
        <p className="tch-builder__needs" dir="auto">
          {t('tch.tasks.stepNeeds', {
            fields: gaps[step].map((field) => t(`tch.tasks.missing.${field}`)).join(' · '),
          })}
        </p>
      ) : null}

      <div className="tch-builder__actions">
        <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm" onClick={close}>
          {t('tch.tasks.cancel')}
        </button>
        <span className="tch-builder__actionsGap" />
        {step > 0 ? (
          <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm"
                  onClick={() => goTo(step - 1)}>
            {t('tch.tasks.back')}
          </button>
        ) : null}
        {step < STEPS.length - 1 ? (
          <button type="button" className="sp-btn sp-btn--sm tch-builder__next"
                  disabled={gaps[step].length > 0}
                  onClick={() => goTo(step + 1)}>
            {t('tch.tasks.next')}
            <Icon name="arrow" size={15} />
          </button>
        ) : (
          <button type="button" className="sp-btn sp-btn--sm" disabled={!ready || busy}
                  onClick={() => void create()}>
            <Icon name="wand" size={15} />
            {busy ? t('tch.tasks.creating') : t('tch.tasks.create')}
          </button>
        )}
      </div>
    </div>
  )
}

/** Finding one lesson in a curriculum, by typing part of its name.
 *
 *  A `<select>` was fine for fourteen lessons and is not a picker for two
 *  hundred: an option list has no search of its own beyond first-letter jump,
 *  and the thing a teacher knows is a fragment of the title, not its position
 *  in the ordering.
 *
 *  Matching runs over the lesson, its unit AND its objective, because those
 *  are three different ways to remember the same lesson — "coordinates" finds
 *  it whether that word is in the lesson's name or only in the unit's.
 */
function LessonPicker({ lessons, loading, value, lesson, disabled, onPick }: {
  lessons: CatalogLearning[]
  loading: boolean
  value: string
  lesson: CatalogLearning | null
  disabled: boolean
  onPick: (id: string) => void
}) {
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const listId = useId()

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const rows = needle
      ? lessons.filter((row) => [row.title, row.unit_title, row.objective_title]
          .some((text) => (text ?? '').toLowerCase().includes(needle)))
      : lessons
    return rows.slice(0, 40)
  }, [lessons, query])

  if (value && lesson) {
    return (
      <div className="tch-builder__field">
        <span>{t('tch.tasks.field.learning')}</span>
        <div className="tch-picker__picked">
          <div>
            <strong dir="auto">{lesson.title ?? lesson.component_id}</strong>
            <small className="tch-builder__hint" dir="auto">
              {t('tch.tasks.learning.picked', {
                objective: lesson.objective_title ?? '—',
                screens: String(lesson.screens_total),
                questions: String(lesson.questions_total),
              })}
            </small>
          </div>
          <button type="button" className="tch-builder__discard"
                  onClick={() => { onPick(''); setQuery(''); setOpen(true) }}>
            {t('tch.tasks.learning.change')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="tch-builder__field">
      <label htmlFor={listId}>{t('tch.tasks.field.learning')}</label>
      <input
        id={listId} className="sp-input" type="search" dir="auto" value={query}
        disabled={loading || disabled}
        placeholder={disabled ? t('tch.tasks.learning.needSubject')
                              : t('tch.tasks.learning.search')}
        onFocus={() => setOpen(true)}
        onChange={(event) => { setQuery(event.target.value); setOpen(true) }}
      />
      {open && !disabled && !loading ? (
        <ul className="tch-picker__list">
          {matches.map((row) => (
            <li key={row.component_id}>
              <button type="button" className="tch-picker__row"
                      onClick={() => { onPick(row.component_id); setOpen(false) }}>
                <span dir="auto">{row.title ?? row.component_id}</span>
                {/* WHAT THE LESSON TEACHES leads the sub-line — vendor lesson
                    names ("בסיסית 1", "ממוצעת 1") are edition labels a teacher
                    cannot navigate by; the objective is the idea they are
                    actually looking for. The unit follows only when it says
                    something the other two lines have not. */}
                <small dir="auto">
                  {[row.objective_title, row.unit_title]
                    .filter((text, index, all) => text && text !== row.title
                      && all.indexOf(text) === index)
                    .join(' · ')}
                </small>
              </button>
            </li>
          ))}
          {matches.length === 0 ? (
            <li className="tch-builder__hint">{t('tch.tasks.learning.noMatch')}</li>
          ) : null}
        </ul>
      ) : null}
      {/* Its own class so a short window can drop it: the label above already
          says the lesson is optional, and this sentence is the least load-
          bearing line in the dialog. */}
      <small className="tch-builder__hint tch-builder__pickerHint" dir="auto">
        {t('tch.tasks.learning.hint')}
      </small>
    </div>
  )
}

/** "Let Yuvi draft it" — and, when it can't yet, exactly what is missing.
 *
 *  Three deliberate choices, all the same choice really: the reason must reach
 *  the teacher.
 *
 *  **`aria-disabled`, not `disabled`.** A truly disabled button receives no
 *  pointer events and is skipped by the keyboard, so it can never explain
 *  itself — the one state in which it most needs to. This one stays hoverable,
 *  focusable and described; it just does nothing when pressed.
 *
 *  **The bubble hangs off the button itself**, not off a `?` beside it. The
 *  question here is "why can't I press this", and the thing being asked about
 *  is the thing you are pointing at.
 *
 *  **The reason is a list of field names**, rebuilt on every keystroke, so a
 *  teacher watches it shrink as they fill the form in.
 */
function NotesSuggestButton({ missing, busy, onClick }: {
  missing: string[]
  busy: boolean
  onClick: () => void
}) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const id = useId()
  const blocked = missing.length > 0
  const reason = blocked
    ? t('tch.tasks.suggestMissing', {
        fields: missing.map((field) => t(`tch.tasks.missing.${field}`)).join(' · '),
      })
    : t('tch.tasks.suggestReady')

  return (
    <span className="sp-tip tch-builder__suggest"
          onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button type="button"
              className={`sp-btn sp-btn--ghost sp-btn--sm${blocked ? ' is-blocked' : ''}`}
              aria-disabled={blocked || busy}
              aria-describedby={id}
              onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}
              onClick={() => { if (!blocked && !busy) onClick() }}>
        <Icon name="spark" size={14} aria-hidden="true" />
        {busy ? t('tch.tasks.suggesting') : t('tch.tasks.suggest')}
      </button>
      {/* Rendered whether or not it is visible, so `aria-describedby` always
          resolves — a screen reader announces the reason with the button. */}
      <span id={id} role="tooltip" dir="auto" hidden={!open}
            className="sp-tip__bubble is-interactive">
        {reason}
      </span>
    </span>
  )
}

/** A week out, matching `GoalComposer`'s default so the two feel like one app. */
function defaultDeadline(): string {
  const date = new Date()
  date.setDate(date.getDate() + 7)
  return date.toISOString().slice(0, 10)
}
