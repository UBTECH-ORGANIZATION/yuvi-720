/* The step between "Yuvi wrote it" and "thirty children have it".
 *
 * ## Why this screen exists
 *
 * Generation produced a lesson, a set of questions and an answer key that no
 * human has read. Sending that straight out makes the teacher the person who
 * finds out it was wrong — from the class, after the fact. So `ready` is a
 * stop: the content is shown here exactly as a child will see it, and the only
 * way to `live` is through this page.
 *
 * The status ladder already had this gate. `ready` has always meant "content
 * exists and nobody has it", and `activate()` freezes a per-learner snapshot,
 * so a task can be rewritten any number of times before launch and never once
 * afterwards changes the paper under a child mid-attempt. What was missing was
 * anything to *do* in that state except press send. This is that.
 *
 * ## The preview is the real player
 *
 * Not a rendering of the JSON, and not a teacher-shaped approximation:
 * `TaskPlayer` in `readOnly`, the same component the child runs. A preview
 * that renders content its own way is a preview that can disagree with the
 * thing it is previewing — the case where a question looks fine here and
 * breaks in the player is exactly the case this screen is for.
 *
 * The answer key is the one thing added on top, behind a toggle. It is the
 * teacher's material and they must be able to check it, but shown by default
 * it would make the preview stop being what the child sees.
 *
 * ## Three ways to change it, all of them the teacher's call
 *
 * Regenerate (throw this component away and ask again), AI edit (keep it, and
 * describe the one thing to change), and — from here — launch. Instructions
 * given to an edit are used for that pass only and never written back into the
 * spec: "make question 3 easier" describes one regeneration, not the task the
 * teacher asked for.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { navigate } from '../../../app/router'
import {
  ErrorState, Icon, Panel, Skeleton, StatusPill, type StatusTone,
} from '../../../components/primitives'
import { useI18n } from '../../../i18n/I18nProvider'
import { useTeacherScope } from '../../../providers/TeacherScopeProvider'
import { MathText } from '../../tasks/MathText'
import { partsToText, toRenderParts, type MathSegment } from '../../tasks/mathSegments'
import { TaskPlayer } from '../../tasks/TaskPlayer'
import {
  aiEditTaskContent, getTeacherTask, launchTask, listTaskLaunches,
  regenerateTaskContent, startGeneration,
  type TaskComponent, type TaskLaunch, type TeacherQuestion, type TeacherTask,
  type TeacherTaskContent,
} from '../../../services/tasks'
import { LaunchDialog, type LaunchChoice } from './LaunchDialog'
import { clearAudience, readAudience } from './taskSeed'
import './teacher-tasks.css'

/** Three parts, matching the player exactly — see the note on its own `ORDER`.
 *  `interactive` content still renders, inside practice. */
const ORDER: TaskComponent[] = ['presentation', 'practice', 'test']
const POLL_MS = 4000

export function TaskReviewPage({ taskId }: { taskId: string }) {
  const { t } = useI18n()
  const { groupId } = useTeacherScope()
  const [data, setData] = useState<TeacherTask | null>(null)
  const [launches, setLaunches] = useState<TaskLaunch[]>([])
  const [error, setError] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [launched, setLaunched] = useState<number | null>(null)
  const [sending, setSending] = useState(false)
  /* Who this task was built for, if it was started from a finding about
     particular children — read once per task, so the array the dialog sees is
     the same array on every render and cannot re-trigger its prefill. */
  const [suggested, setSuggested] = useState<string[]>([])
  useEffect(() => { setSuggested(readAudience(taskId)) }, [taskId])
  const [showKey, setShowKey] = useState(false)
  const [demo, setDemo] = useState(false)
  /* The rewriting controls, closed by default. They are three boxes of buttons
     for the case where the teacher is unhappy with what Yuvi wrote, and that is
     not the common case — reading it is. */
  const [editing, setEditing] = useState(false)
  const [failed, setFailed] = useState(false)

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const [payload, openings] = await Promise.all([
        getTeacherTask(taskId, signal),
        listTaskLaunches(taskId, signal).catch(() => ({ launches: [] })),
      ])
      setData(payload)
      setLaunches(openings.launches)
    } catch {
      if (!signal?.aborted) setError(true)
    }
  }, [taskId])

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  /* A teacher lands here straight out of the builder, so the first thing this
     page usually shows is a task still being written. Polling stops the moment
     it is not. */
  const generating = data?.status === 'generating'
  useEffect(() => {
    if (!generating) return
    const id = setInterval(() => { void load() }, POLL_MS)
    return () => clearInterval(id)
  }, [generating, load])

  const present = useMemo(() => {
    const content = data?.content ?? {}
    return ORDER.filter((component) => hasContent(content, component))
  }, [data])

  /* Per component, only the LATEST pass counts — the log keeps every attempt,
     and a component that failed once but generated on retry is not missing. */
  const failures = useMemo(() => {
    const latest = new Map((data?.task.generation ?? []).map((entry) => [entry.component, entry]))
    return [...latest.values()].filter((entry) => !entry.ok)
  }, [data])

  const act = async (key: string, run: () => Promise<unknown>) => {
    setBusy(key)
    setFailed(false)
    try {
      await run()
      await load()
    } catch {
      setFailed(true)
    } finally {
      setBusy(null)
    }
  }

  if (error) {
    return (
      <div className="tch-review">
        <ErrorState title={t('tch.tasks.error')} body={t('tch.tasks.errorBody')} />
      </div>
    )
  }

  const status = data?.status
  const tone: StatusTone = status === 'live' ? 'strong'
    : status === 'generating' ? 'steady'
    : status === 'ready' ? 'support' : 'neutral'

  return (
    <div className="tch-review" aria-busy={data === null}>
      {/* ONE band at the top, not three.
          What this screen was: a header, then a whole card whose only content
          was a send button, then a row of three boxes of per-part controls,
          then a mode toggle, then a hint — five stacked strips before the
          content they were all about. Identity and every action a teacher can
          take now share one row; the editing controls moved behind the one
          button that opens them. */}
      <header className="tch-review__bar">
        <div className="tch-review__id">
          <h1 dir="auto">{data?.task.spec?.title ?? t('tasks.untitled')}</h1>
          <p className="tch-review__sub" dir="auto">
            {status ? <StatusPill tone={tone}>{t(`tch.tasks.status.${status}`)}</StatusPill> : null}
            <span>{launches.length > 0
              ? t('tch.tasks.openings', { n: String(launches.length) })
              : t('tch.tasks.reviewSubtitle')}</span>
          </p>
        </div>

        <div className="tch-review__nav">
          {/* Sending is the action a teacher came here to take, so it is the
              only filled button on the screen and it is first. */}
          {data !== null && status !== 'generating' && present.length > 0 ? (
            <button type="button" className="sp-btn sp-btn--sm" disabled={busy !== null}
                    title={t('tch.tasks.launchNote')}
                    onClick={() => setSending(true)}>
              <Icon name="send" size={15} />
              {launches.length > 0 ? t('tch.tasks.sendAgain') : t('tch.tasks.send')}
            </button>
          ) : null}
          {launches.length > 0 ? (
            <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm"
                    onClick={() => navigate(
                      `/teacher/tasks/${encodeURIComponent(taskId)}`)}>
              <Icon name="chart" size={15} />
              {t('tch.tasks.progress.link')}
            </button>
          ) : null}
          <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm"
                  onClick={() => navigate('/teacher/tasks')}>
            {t('tch.tasks.backToList')}
          </button>
        </div>
      </header>

      {groupId ? (
        <LaunchDialog
          open={sending}
          groupId={groupId}
          previousLaunches={launches.length}
          suggested={suggested}
          busy={busy === 'launch'}
          onClose={() => setSending(false)}
          onLaunch={(choice: LaunchChoice) => void act('launch', async () => {
            const result = await launchTask(taskId, choice.targets, choice.dueAt)
            // The suggestion has been answered. A second opening is its own
            // decision, and pre-ticking the first one's children would present
            // it as one already taken.
            clearAudience(taskId)
            setSuggested([])
            setLaunched(result.assigned)
            setSending(false)
          })}
        />
      ) : null}

      {data === null ? (
        <div className="tch-tasks__loading">
          <Skeleton w="100%" h={56} />
          <Skeleton w="100%" h={320} />
        </div>
      ) : status === 'generating' ? (
        <Panel>
          <p className="tch-review__working" dir="auto">
            <Icon name="clock" size={16} />
            {t('tch.tasks.working')}
          </p>
          <div className="tch-tasks__loading">
            {[0, 1, 2].map((index) => <Skeleton key={index} w="100%" h={72} />)}
          </div>
        </Panel>
      ) : present.length === 0 ? (
        <Panel>
          <p dir="auto">{t('tch.tasks.reviewEmpty')}</p>
          <button type="button" className="sp-btn sp-btn--sm" disabled={busy !== null}
                  onClick={() => void act('generate', () => startGeneration(taskId))}>
            <Icon name="wand" size={15} />
            {t('tch.tasks.generate')}
          </button>
        </Panel>
      ) : (
        <>
          {failures.length > 0 ? (
            <p className="tch-task__failed" dir="auto">
              <Icon name="alert" size={14} />
              {t('tch.tasks.partial', {
                parts: failures.map((entry) => t(`tasks.component.${entry.component}`)).join(', '),
              })}
            </p>
          ) : null}

          {/* Editing is refused once children hold copies — the same rule the
              server enforces. Saying so beats offering a button that 400s. */}
          {status === 'live' || status === 'closed' ? (
            <p className="tch-review__sent" dir="auto">
              <Icon name="lock" size={14} />
              {t('tch.tasks.reviewSent')}
            </p>
          ) : null}

          {failed ? (
            <p className="tch-builder__failed" dir="auto">{t('tch.tasks.reviewFailed')}</p>
          ) : null}

          {/* One toolbar, directly above the thing it controls: how to view it,
              whether to show the key, and — behind a single button — the
              rewriting controls, which are the rarest of the three and used to
              take a whole band of the screen whether or not anyone wanted them. */}
          <div className="tch-review__toolbar">
            {/* Look at it, or sit it. "How will the student see this" has one
                honest answer: by being the student, in the real player. */}
            <div className="tch-review__modes" role="group"
                 aria-label={t('tch.tasks.previewMode')}>
              <button type="button" className={`tch-chip${demo ? '' : ' is-on'}`}
                      aria-pressed={!demo} onClick={() => setDemo(false)}>
                <Icon name="search" size={14} />
                {t('tch.tasks.modeLook')}
              </button>
              <button type="button" className={`tch-chip${demo ? ' is-on' : ''}`}
                      aria-pressed={demo} onClick={() => setDemo(true)}>
                <Icon name="play" size={14} />
                {t('tch.tasks.modeSolve')}
              </button>
            </div>

            <p className="tch-review__hint" dir="auto">
              {demo ? t('tch.tasks.demoNote') : t('tch.tasks.previewNote')}
            </p>

            <label className="tch-review__switch">
              <input type="checkbox" checked={showKey}
                     onChange={(event) => setShowKey(event.target.checked)} />
              <span>{t('tch.tasks.showKey')}</span>
            </label>

            {status !== 'live' && status !== 'closed' ? (
              <button type="button"
                      className={`sp-btn sp-btn--ghost sp-btn--sm${editing ? ' is-active' : ''}`}
                      aria-expanded={editing}
                      onClick={() => setEditing((value) => !value)}>
                <Icon name="wand" size={14} />
                {t('tch.tasks.editContent')}
              </button>
            ) : null}
          </div>

          {editing && status !== 'live' && status !== 'closed' ? (
            <div className="tch-review__parts">
              {present.map((component) => (
                <ComponentControls
                  key={component}
                  component={component}
                  busy={busy}
                  onRegenerate={() => act(
                    `regen:${component}`, () => regenerateTaskContent(taskId, component))}
                  onEdit={(instructions) => act(
                    `edit:${component}`, () => aiEditTaskContent(taskId, component, instructions))}
                />
              ))}
            </div>
          ) : null}

          {showKey ? <AnswerKeyPanel content={data.content} /> : null}

          {/* `key` on the content AND on the mode: a regenerated component, or
              a switch into solving, must reset the player's step and answers
              rather than merge into them. */}
          <Panel className="tch-review__stage">
            <TaskPlayer
              key={`${demo ? 'demo' : 'view'}:${fingerprint(data.content)}`}
              content={data.content}
              readOnly={!demo}
              demo={demo}
              subject={data.task.spec?.subject}
              theme={data.task.spec?.presentation?.theme}
              /* The teacher's own copy: speaker notes, present and print, and
                 the per-slide rewrite below. Never passed in the learner lane. */
              teacher={!demo}
              slideActions={status !== 'live' && status !== 'closed'
                ? (index) => (
                    <SlideRewrite
                      busy={busy}
                      index={index}
                      onEdit={(instructions) => act(
                        'edit:presentation',
                        () => aiEditTaskContent(taskId, 'presentation', instructions,
                                                { slide_index: index }))}
                    />
                  )
                : undefined}
            />
          </Panel>

          {launched !== null ? (
            <p className="tch-review__done" dir="auto">
              <Icon name="check" size={15} />
              {/* Two keys, not one with a count: `t()` has no plural engine,
                  so "sent to 1 students" is what one key would render. */}
              {launched === 1
                ? t('tch.tasks.launched.one')
                : t('tch.tasks.launched.many', { n: String(launched) })}
              <button type="button" className="tch-builder__discard"
                      onClick={() => navigate(`/teacher/tasks/${encodeURIComponent(taskId)}`)}>
                {t('tch.tasks.toTracking')}
              </button>
            </p>
          ) : null}
        </>
      )}
    </div>
  )
}

/** "Change this slide." The one place per-component is the wrong unit.
 *
 *  A teacher looking at a deck is unhappy with a SLIDE, and the whole-component
 *  edit box makes them describe which one in words to a model that then rewrites
 *  the other fourteen. The backend has taken `slide_index` since the edit path
 *  was built ([revise.py](backend/app/services/tasks/revise.py)) and the client
 *  function has always accepted it — the only caller passed three arguments.
 */
function SlideRewrite({ busy, index, onEdit }: {
  busy: string | null
  index: number
  onEdit: (instructions: string) => void
}) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [instructions, setInstructions] = useState('')
  const working = busy === 'edit:presentation'

  return (
    <>
      <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm"
              disabled={busy !== null} aria-expanded={open}
              onClick={() => setOpen((value) => !value)}>
        <Icon name="wand" size={15} />
        {t('tch.tasks.editSlide', { n: String(index + 1) })}
      </button>
      {open ? (
        <div className="tch-review__slideEdit">
          <textarea className="sp-input" rows={2} value={instructions} dir="auto"
                    placeholder={t('tch.tasks.editSlideHint')}
                    onChange={(event) => setInstructions(event.target.value)} />
          <button type="button" className="sp-btn sp-btn--sm"
                  disabled={busy !== null || instructions.trim().length === 0}
                  onClick={() => { onEdit(instructions.trim()); setInstructions(''); setOpen(false) }}>
            {working ? t('tch.tasks.working') : t('tch.tasks.aiEditApply')}
          </button>
        </div>
      ) : null}
    </>
  )
}

/** Regenerate, or describe one change. Per component, because that is the unit
 *  the generator writes in and the unit a teacher is unhappy with. */
function ComponentControls({ component, busy, onRegenerate, onEdit }: {
  component: TaskComponent
  busy: string | null
  onRegenerate: () => void
  onEdit: (instructions: string) => void
}) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [instructions, setInstructions] = useState('')
  const working = busy === `regen:${component}` || busy === `edit:${component}`

  return (
    <div className={`tch-review__part${working ? ' is-working' : ''}`}>
      <div className="tch-review__partHead">
        <strong>{t(`tasks.component.${component}`)}</strong>
        <div className="tch-review__partBtns">
          <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm"
                  disabled={busy !== null} onClick={() => setOpen((value) => !value)}>
            <Icon name="wand" size={14} />
            {t('tch.tasks.aiEdit')}
          </button>
          <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm"
                  disabled={busy !== null} onClick={onRegenerate}>
            <Icon name="reflect" size={14} />
            {busy === `regen:${component}` ? t('tch.tasks.working') : t('tch.tasks.regenerate')}
          </button>
        </div>
      </div>

      {open ? (
        <div className="tch-review__edit">
          <textarea className="sp-input" rows={2} value={instructions} dir="auto"
                    placeholder={t('tch.tasks.aiEditHint')}
                    onChange={(event) => setInstructions(event.target.value)} />
          <button type="button" className="sp-btn sp-btn--sm"
                  disabled={busy !== null || instructions.trim().length === 0}
                  onClick={() => { onEdit(instructions.trim()); setInstructions(''); setOpen(false) }}>
            {busy === `edit:${component}` ? t('tch.tasks.working') : t('tch.tasks.aiEditApply')}
          </button>
        </div>
      ) : null}
    </div>
  )
}

/** Every scored question with its key, as a list a teacher can read down.
 *
 *  Deliberately separate from the preview rather than annotating it: the
 *  preview's job is to be what the child sees, and a preview with the answers
 *  written on it is no longer that. */
function AnswerKeyPanel({ content }: { content: TeacherTaskContent }) {
  const { t } = useI18n()
  const rows = useMemo(() => ORDER.flatMap((component) => (
    questionsIn(content, component).map((question) => ({ component, question }))
  )), [content])

  if (rows.length === 0) return null

  return (
    <Panel className="tch-review__key">
      <h3 dir="auto">{t('tch.tasks.keyTitle')}</h3>
      <ol>
        {rows.map(({ component, question }, index) => (
          <li key={`${component}:${question.id}`}>
            <span className="tch-review__keyWhere">{t(`tasks.component.${component}`)}</span>
            <MathText content={question.prompt} />
            <span className="tch-review__keyAnswer" dir="auto">
              {describeKey(question, t)}
            </span>
          </li>
        ))}
      </ol>
    </Panel>
  )
}

/** Every SCORED question in a part — this feeds the answer key, so a study card
 *  with no key does not belong in it. Practice absorbs the old fourth part's
 *  blocks, the same way the player does. */
function questionsIn(content: TeacherTaskContent, component: TaskComponent): TeacherQuestion[] {
  if (component === 'test') return content.test?.questions ?? []
  if (component !== 'practice') return []
  return [
    ...(content.practice?.questions ?? []),
    ...(content.interactive?.blocks ?? []),
  ].filter((question) => question.scored !== false)
}

function hasContent(content: TeacherTaskContent, component: TaskComponent): boolean {
  if (component === 'presentation') return (content.presentation?.slides?.length ?? 0) > 0
  if (component === 'test') return (content.test?.questions?.length ?? 0) > 0
  if (component !== 'practice') return false
  // A task whose only questions came from the old fourth part still HAS a
  // practice step — that is where they render now.
  return (content.practice?.questions?.length ?? 0) > 0
    || (content.practice?.study?.length ?? 0) > 0
    || (content.interactive?.blocks?.length ?? 0) > 0
}

/** The key as one readable phrase.
 *
 *  Reads the field this question's `type` says is present and no other — the
 *  shapes are exclusive (`tasks/spec.py`), so a fallback chain across all of
 *  them would happily report a stale field left by a hand edit. */
function describeKey(
  question: TeacherQuestion, t: (key: string, params?: Record<string, string>) => string,
): string {
  const key = question.answer
  if (!key) return t('tch.tasks.key.none')
  const options = question.options ?? []
  const label = (index: number): string => {
    const option = options[index]
    return option ? textOf(option) : `#${index + 1}`
  }
  switch (question.type) {
    case 'mcq':
    case 'image_mcq':
      return typeof key.index === 'number' ? label(key.index) : t('tch.tasks.key.none')
    case 'true_false':
      return key.value ? t('tasks.true') : t('tasks.false')
    case 'multiple_correct':
      return (key.indices ?? []).map(label).join(' · ') || t('tch.tasks.key.none')
    case 'ordering':
      return (key.order ?? []).map((index, place) => `${place + 1}. ${label(index)}`).join(' · ')
    case 'matching':
      return (key.pairs ?? [])
        .map(([left, right]) => `${label(left)} → ${textOf(question.targets?.[right] ?? [])}`)
        .join(' · ')
    case 'fill_blank':
      return (key.blanks ?? [])
        .map((blank) => (blank.accept ?? []).join(' / '))
        .filter(Boolean).join(' · ') || t('tch.tasks.key.none')
    case 'open_ended':
      return (key.rubric ?? [])
        .map((entry) => entry.criterion).filter(Boolean).join(' · ') ||
        t('tch.tasks.key.rubric')
    default:
      return t('tch.tasks.key.none')
  }
}

/** Segments → one plain string, through the same reader the renderer uses, so
 *  a formula reads here exactly as it does on the card. */
function textOf(segments: MathSegment[]): string {
  return partsToText(toRenderParts(segments)).trim()
}

/** Cheap identity for "is this the same content" — the ids and lengths, not a
 *  deep hash. It only has to change when a regeneration replaces a component. */
function fingerprint(content: TeacherTaskContent): string {
  return ORDER.map((component) => {
    if (component === 'presentation') {
      return `p${(content.presentation?.slides ?? []).map((slide) => slide.id).join(',')}`
    }
    return `${component[0]}${questionsIn(content, component).map((q) => q.id).join(',')}`
  }).join('|')
}
