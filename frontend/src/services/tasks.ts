/* Teacher-authored tasks — the client for both lanes.
 *
 * Two things this file's types are load-bearing about.
 *
 * **Every text field is a segment array**, never a string. That is the
 * Hebrew+math contract — see `features/tasks/mathSegments.ts` for why a
 * formula inside a Hebrew sentence cannot be one string — and typing it as
 * `MathSegment[]` is what stops a future caller rendering it with `{text}`.
 *
 * **The learner shape has no `answer` and no `score`.** They are absent from
 * `LearnerQuestion` rather than optional, so reading either is a type error
 * rather than a silent `undefined` that renders as blank. The server strips
 * them; this is the second lock on the same door.
 */

import { apiDelete, apiGet, apiPost, apiPut } from './api'
import type { CoachVisual } from './agents'
import type { MathSegment } from '../features/tasks/mathSegments'

export type QuestionType =
  | 'mcq' | 'true_false' | 'fill_blank' | 'matching'
  | 'ordering' | 'open_ended' | 'image_mcq' | 'multiple_correct'

export type TaskComponent = 'presentation' | 'practice' | 'test' | 'interactive'

export type TaskStatus = 'draft' | 'generating' | 'ready' | 'live' | 'closed'

export type AttemptStatus = 'not_started' | 'in_progress' | 'submitted' | 'graded'

export type InteractiveWidget =
  | 'match_pairs' | 'sort_items' | 'fill_blank_drag'
  | 'hotspots' | 'flashcards' | 'click_reveal'

export type SlideLayout =
  | 'title' | 'text' | 'text_image' | 'bullets' | 'big_number'
  | 'compare' | 'timeline' | 'fact' | 'summary'
  | 'reveal' | 'fact_grid' | 'quote'

/** A question as the learner receives it: no key, no explanation until after. */
export interface LearnerQuestion {
  id: string
  type: QuestionType
  prompt: MathSegment[]
  options?: MathSegment[][]
  targets?: MathSegment[][]
  hint?: MathSegment[]
  difficulty: 'easy' | 'medium' | 'hard'
  weight: number
  image_url?: string
  widget?: InteractiveWidget
  scored?: boolean
  cards?: { front: MathSegment[]; back: MathSegment[] }[]
  /** How many boxes a fill-in question needs, and what each is called.
   *
   *  The SHAPE of the answer, not the answer — the accepted values stay on the
   *  server. Present because the count lives only in the key, and without it
   *  the player sized its field list from what the child had already typed:
   *  one box for a two-blank question, so the second value could never be
   *  entered and was then marked wrong. */
  blanks?: { label?: string | null }[]
  /** Present only after submission. */
  explanation?: MathSegment[]
  verdict?: QuestionVerdict | null
}

export interface QuestionVerdict {
  correctness: number | null
  correct: boolean | null
  skipped: boolean
  detail: Record<string, unknown> | null
  /** The sentence this child read about this question, for open answers. */
  feedback?: string
}

export interface Slide {
  id: string
  layout: SlideLayout
  title: MathSegment[]
  body: MathSegment[]
  bullets?: MathSegment[][]
  value?: string
  /** `big_number` may show up to three figures — "3 מתוך 4" is two numbers,
   *  and one number per slide is what made a deck repeat itself. */
  values?: { value: string; caption: MathSegment[] }[]
  /** Topic art from the authored illustration library. Same-origin, inert,
   *  cached — never a photograph and never a model-generated image. */
  image_url?: string
  sides?: { label: MathSegment[]; items: MathSegment[][] }[]
  steps?: { label: MathSegment[]; body: MathSegment[] }[]
  /** `reveal` and `fact_grid`. A tile shows its front; a reveal card hides
   *  its back until the child asks for it. */
  cards?: { front: MathSegment[]; back: MathSegment[]; emoji?: string }[]
  key_points: string[]
  /* Typed, at last. It was `unknown`, which is how a field-name mismatch
     between the renderer and the payload survived unnoticed for a whole
     phase — every diagram this deck ever rendered was silently dropped. */
  visual?: CoachVisual | null
  /** The teacher's copy of the slide: what to say, what to ask, what students
   *  get wrong. Never sent to a learner — `attempts.learner_view` strips it. */
  notes?: string
  /** Assembled from the deck's own key points because the model omitted one. */
  synthesized?: boolean
}

export interface TaskContent {
  presentation?: { slides: Slide[] }
  practice?: { questions: LearnerQuestion[]; study?: LearnerQuestion[] }
  test?: {
    questions: LearnerQuestion[]
    time_limit_minutes?: number
    passing_grade?: number
    show_answers_after?: boolean
    retries?: number
  }
  /** Pre-merge tasks only. Still rendered, inside the practice step. */
  interactive?: { blocks: LearnerQuestion[] }
}

/** The answer key, one shape per question type — see `tasks/spec.py`.
 *
 *  Every field is optional because exactly one of them is present for any
 *  given question, and which one is decided by `type`. Reading the wrong one
 *  gives `undefined` rather than a wrong answer. */
export interface AnswerKey {
  index?: number
  value?: boolean
  indices?: number[]
  order?: number[]
  pairs?: [number, number][]
  /** `label` rides along with the key, which is how the TEACHER's preview knows
   *  what to write in front of each box — their copy has no stripped `blanks`
   *  shape, only this. */
  blanks?: { accept?: string[]; label?: string | null }[]
  rubric?: { criterion?: string; weight?: number }[]
}

/** A question as the *teacher* receives it: the learner shape plus the key.
 *
 *  A separate type rather than making `answer` optional on `LearnerQuestion`,
 *  so the learner lane keeps its guarantee — there, reading `.answer` is a
 *  type error, which is the second lock on the door the server already bolts. */
export interface TeacherQuestion extends LearnerQuestion {
  answer?: AnswerKey
  explanation?: MathSegment[]
}

export interface TeacherTaskContent {
  presentation?: { slides: Slide[] }
  practice?: {
    questions: TeacherQuestion[]
    /** Unscored rehearsal cards. They live here because "activity" stopped
     *  being a part of its own — its scored blocks were practice questions
     *  under another name, and these were the only thing it had that practice
     *  did not. */
    study?: TeacherQuestion[]
  }
  test?: {
    questions: TeacherQuestion[]
    time_limit_minutes?: number
    passing_grade?: number
    show_answers_after?: boolean
    retries?: number
  }
  /** Pre-merge tasks only. Still rendered, inside the practice step. */
  interactive?: { blocks: TeacherQuestion[] }
}

// ── the learner lane ────────────────────────────────────────────────────────

export interface MyTask {
  task_id: string
  /** The opening this row is. It, not `task_id`, is what every call takes —
   *  a child may hold the same task twice and the two are different papers. */
  launch_id: string
  /** 1 for the first sitting, 2 for a retake. Shown only when above 1. */
  repeat: number
  title: string | null
  subject: string | null
  components: TaskComponent[]
  assigned_at: string | null
  due_at: string | null
  status: AttemptStatus
  completed_at: string | null
  /** The teacher shut this opening — it can be read, not answered. */
  closed: boolean
  /** Per-part progress, e.g. `{ practice: { answered: 3, total: 8 } }`.
   *  The presentation has no per-question state, so it never appears here. */
  progress: Record<string, { answered: number; total: number }>
  /** Words. There is deliberately no number here. */
  feedback: string | null
}

export interface OpenTask {
  task_id: string
  launch_id: string
  title: string | null
  language: string
  /** How the deck is drawn. Sent to the CHILD's lane too, because the whole
   *  point of a fixed stage is that the teacher's preview and the child's
   *  screen are the same picture — without these the child got the default
   *  violet while the preview showed the subject's ground. */
  subject?: string
  theme?: string
  due_at: string | null
  content: TaskContent
  answers: Record<string, unknown>
  status: AttemptStatus
}

export interface SubmitResult {
  status: 'submitted'
  message: string
  sparks: number
  answered: number
  total: number
  content: TaskContent
}

export function listMyTasks(signal?: AbortSignal) {
  return apiGet<{ tasks: MyTask[] }>('/api/tasks', { signal })
}

/* Every call below takes a LAUNCH id, not a task id. A child may have been
   given the same task twice, and a task id could not say which paper — while
   defaulting to "the newest" would move them off the one they were writing. */

export function openTask(launchId: string, signal?: AbortSignal) {
  return apiGet<OpenTask>(`/api/tasks/${encodeURIComponent(launchId)}`, { signal })
}

export function saveAnswers(
  launchId: string, answers: Record<string, unknown>, timeSpent = 0,
) {
  return apiPost<{ saved: boolean; answered: number }>(
    `/api/tasks/${encodeURIComponent(launchId)}/answers`,
    { answers, time_spent: timeSpent },
  )
}

export function submitTask(
  launchId: string, answers: Record<string, unknown>, timeSpent = 0, language?: string,
) {
  return apiPost<SubmitResult>(
    `/api/tasks/${encodeURIComponent(launchId)}/submit`,
    { answers, time_spent: timeSpent, language },
  )
}

// ── the teacher lane ────────────────────────────────────────────────────────

export interface TaskSpecInput {
  title: string
  topic?: string
  subject?: string
  grade?: string
  language?: string
  components: TaskComponent[]
  difficulty?: 'easy' | 'medium' | 'hard'
  notes?: string
  /** Who the task was built FOR, when it came from a finding about particular
   *  children. An input to generation, not only a send list: the server turns
   *  these ids into an anonymous shared brief (which mistakes they repeat, which
   *  questions they missed) and weights it above the general topic. Ids never
   *  reach a model — see `backend/app/services/tasks/audience.py`. */
  audience?: { learner_ids: string[] }
  practice?: { question_count?: number }
  test?: {
    question_count?: number
    time_limit_minutes?: number
    passing_grade?: number
    show_answers_after?: boolean
    retries?: number
  }
  presentation?: {
    slide_count?: number
    /** The ground the deck is drawn on. `auto` derives it from the subject. */
    theme?: 'auto' | 'math' | 'science' | 'history' | 'nature' | 'language' | 'plain'
    /** How much goes on one slide. */
    density?: 'airy' | 'balanced' | 'full'
    examples?: boolean
    diagrams?: boolean
    self_check?: boolean
    teacher_notes?: boolean
    /** Terms the deck must cover, comma or newline separated. */
    key_concepts?: string
  }
  interactive?: { block_count?: number }
  /** The catalogue lesson this task is built on, as ids only.
   *
   *  Ids rather than the titles and the lesson text: a spec is stored and read
   *  back weeks later, and a copied-in description would go stale the moment
   *  the unit is re-imported. The generator resolves these against the live
   *  catalogue at the moment it writes. */
  source?: { component_id?: string | null; objective_id?: string | null }
}

export interface TaskSummary {
  id: string
  title: string | null
  status: TaskStatus
  subject: string | null
  target: { kind: 'learner' | 'subgroup' | 'group'; id: string } | null
  group_id: string
  components: TaskComponent[]
  /** Filed away by the teacher — kept with all its history, hidden by default. */
  archived: boolean
  deadline: string | null
  created_at: string
  /** Across every opening — the per-opening split is the tracking screen's. */
  assigned: number
  started: number
  completed: number
  average_score: number | null
  launch_count: number
  open_launches: number
  /** Kept visible after a retry, so a missing deck is explained not hidden. */
  generation_failures: { component: string; at: string; detail?: string }[]
}

/** One opening of a task: who got it, when, and how far they got.
 *
 *  The same task opened to 7א in September and to 7ב in March is two of these,
 *  with two rosters and two sets of results that must never be averaged. */
export interface TaskLaunch {
  id: string
  seq: number
  status: 'active' | 'closed'
  targets: { kind: string; id: string }[]
  learner_ids: string[]
  assigned: number
  completed: number
  average_score: number | null
  opened_at: string
  closed_at: string | null
  due_at: string | null
}

export interface TrackingQuestion {
  id: string
  component: TaskComponent
  type: QuestionType
  prompt: MathSegment[]
  prompt_text: string
  correct: string[]
  partial: string[]
  wrong: string[]
  skipped: string[]
}

export interface TrackingLearner {
  learner_id: string
  status: AttemptStatus
  score: number | null
  completed_at: string | null
  time_spent: number
  answered: number
  total: number
  needs_review: boolean
}

export interface TaskTracking {
  task_id: string
  /** Which opening these numbers describe. Never absent in practice — the
   *  server resolves "no opening given" to the newest one. */
  launch_id: string
  seq: number | null
  launch_status: 'active' | 'closed' | null
  title: string | null
  status: TaskStatus
  learners: TrackingLearner[]
  questions: TrackingQuestion[]
  /** How many children hold a paper older than the current content. */
  stale_snapshots: number
}

export interface LearnerAttempt {
  task_id: string
  learner_id: string
  status: AttemptStatus
  score: number | null
  time_spent: number
  completed_at: string | null
  /** The overall sentence the child saw on finishing — beside the score. */
  learner_feedback: string | null
  questions: {
    id: string
    component: TaskComponent
    type: QuestionType
    prompt: MathSegment[]
    answer_key: Record<string, unknown>
    options?: MathSegment[][]
    given: unknown
    correctness: number | null
    bucket: 'correct' | 'partial' | 'wrong' | 'skipped'
    detail: Record<string, unknown> | null
    feedback: string | null
  }[]
  assigned_at: string | null
  due_at: string | null
}

export function listTeacherTasks(groupId?: string, signal?: AbortSignal) {
  const query = groupId ? `?group_id=${encodeURIComponent(groupId)}` : ''
  return apiGet<{ tasks: TaskSummary[] }>(`/api/teacher/tasks${query}`, { signal })
}

export function setTaskArchived(taskId: string, archived: boolean) {
  return apiPost<{ archived: boolean }>(
    `/api/teacher/tasks/${encodeURIComponent(taskId)}/archive`, { archived },
  )
}

export function createTask(input: {
  group_id: string
  /** A DEFAULT audience, not the audience. Optional because who receives a
   *  task is chosen when it is opened — the chat builder names one up front,
   *  the form does not. */
  target_kind?: 'learner' | 'subgroup' | 'group'
  target_id?: string
  spec: TaskSpecInput
  deadline?: string
}) {
  return apiPost<{ task: { _id: string; status: TaskStatus } }>('/api/teacher/tasks', input)
}

export function startGeneration(taskId: string) {
  return apiPost<{ status: TaskStatus | 'generating' | 'not_found' }>(
    `/api/teacher/tasks/${encodeURIComponent(taskId)}/generate`, {},
  )
}

/** One measured check. `ok: null` means "there was nothing to check" — a task
 *  built without a catalogue lesson cannot be off-lesson — and the review
 *  screen renders that as absent rather than as a pass or a failure. */
export interface QualityCheck {
  ok: boolean | null
  [field: string]: unknown
}

/** How well the generated task did against the brief and the lesson.
 *  Advisory: it is shown to the teacher and never blocks a launch. */
export interface QualityReport {
  checks: Record<string, QualityCheck>
  scores: Record<string, { score: number; why: string }>
  findings: { component: string; item?: number | null; problem: string }[]
  /** False when no model was reachable — NOT the same as a low score. */
  judged: boolean
  overall: number | null
  /** The named checks and dimensions worth a teacher's eye, worst first. */
  concerns: string[]
}

export interface TeacherTask {
  task: {
    _id: string
    status: TaskStatus
    spec: TaskSpecInput
    deadline?: string | null
    target?: { kind: 'learner' | 'subgroup' | 'group'; id: string }
    generation: { component: string; ok: boolean; at: string; detail?: string }[]
    quality?: QualityReport | null
  }
  content: TeacherTaskContent
  status: TaskStatus
}

/** Measure the task against the brief and the lesson again — after a
 *  regeneration or an AI edit, which leave the stored report describing content
 *  that is no longer there. */
export function recheckQuality(taskId: string) {
  return apiPost<{ quality: QualityReport }>(
    `/api/teacher/tasks/${encodeURIComponent(taskId)}/quality`, {})
}

export function getTeacherTask(taskId: string, signal?: AbortSignal) {
  return apiGet<TeacherTask>(`/api/teacher/tasks/${encodeURIComponent(taskId)}`, { signal })
}

/** Open the task to these targets. Every call is a NEW opening — a second one
 *  gives everybody a fresh blank paper rather than topping up the first. */
export function launchTask(
  taskId: string,
  targets: { kind: string; id: string }[],
  dueAt?: string,
) {
  return apiPost<{
    task_id: string; launch_id: string; seq: number
    assigned: number; already_assigned: number
  }>(`/api/teacher/tasks/${encodeURIComponent(taskId)}/launch`,
     { targets, due_at: dueAt })
}

export function listTaskLaunches(taskId: string, signal?: AbortSignal) {
  return apiGet<{ launches: TaskLaunch[] }>(
    `/api/teacher/tasks/${encodeURIComponent(taskId)}/launches`, { signal })
}

/** Stop accepting work. No `launchId` closes every opening of the task. */
/** What deleting a task would take with it, read before the confirmation is
 *  shown. A draft nobody ever saw and a test forty children sat are very
 *  different decisions, and only one of them should give pause. */
export function taskImpact(taskId: string) {
  return apiGet<{ launches: number; attempts: number; learners: number }>(
    `/api/teacher/tasks/${encodeURIComponent(taskId)}/impact`)
}

/** Irreversible, and it takes the openings, the activations and the children's
 *  submitted attempts with it. Confirm first — see `taskImpact`. */
export function deleteTask(taskId: string) {
  return apiDelete<{ deleted: boolean; removed: Record<string, number> }>(
    `/api/teacher/tasks/${encodeURIComponent(taskId)}`)
}

export function closeTask(taskId: string, launchId?: string) {
  return apiPost<{ task_id: string; status: TaskStatus; closed: string[] }>(
    `/api/teacher/tasks/${encodeURIComponent(taskId)}/close`,
    { launch_id: launchId ?? null },
  )
}

export function reopenTask(taskId: string, launchId: string) {
  return apiPost<{ task_id: string; launch_id: string; status: TaskStatus }>(
    `/api/teacher/tasks/${encodeURIComponent(taskId)}/reopen`, { launch_id: launchId },
  )
}

/** One lesson in the Kata catalogue, as the builder's picker needs it. */
export interface CatalogLearning {
  component_id: string
  title: string | null
  unit_id: string | null
  unit_title: string | null
  objective_id: string | null
  objective_title: string | null
  subject: string | null
  order: number | null
  estimated_minutes: number | null
  is_assessment: boolean
  screens_total: number
  questions_total: number
}

export function listCatalogLearnings(language: string, signal?: AbortSignal) {
  return apiGet<{ learnings: CatalogLearning[] }>(
    `/api/teacher/catalog/learnings?language=${encodeURIComponent(language)}`, { signal })
}

/** Draft the notes-to-Yuvi field from the half-filled form.
 *
 *  `missing` is why the button is disabled, and it is the server's answer
 *  rather than the client's: the same list decides whether a call is worth
 *  making, so having the two sides compute it separately is how they drift. */
export function suggestTaskNotes(form: {
  title?: string
  topic?: string
  difficulty?: string
  components: TaskComponent[]
  notes?: string
  source?: { component_id?: string | null; objective_id?: string | null }
  learner_count?: number
  language: string
}) {
  return apiPost<{ notes: string | null; missing: string[]; error?: string }>(
    '/api/teacher/tasks/suggest-notes', form,
  )
}

export function saveTaskContent(
  taskId: string, component: TaskComponent, content: Record<string, unknown>,
) {
  return apiPut<{ content: Record<string, unknown> }>(
    `/api/teacher/tasks/${encodeURIComponent(taskId)}/content/${component}`, { content },
  )
}

export function regenerateTaskContent(
  taskId: string, component: TaskComponent, instructions?: string,
) {
  return apiPost<{ content: Record<string, unknown> }>(
    `/api/teacher/tasks/${encodeURIComponent(taskId)}/content/${component}/regenerate`,
    { instructions },
  )
}

export function aiEditTaskContent(
  taskId: string, component: TaskComponent,
  instructions: string,
  focus?: { slide_index?: number; question_index?: number },
) {
  return apiPost<{ content: Record<string, unknown> }>(
    `/api/teacher/tasks/${encodeURIComponent(taskId)}/content/${component}/ai-edit`,
    { instructions, ...focus },
  )
}

export function getTaskTracking(
  taskId: string, launchId?: string, signal?: AbortSignal,
) {
  const query = launchId ? `?launch_id=${encodeURIComponent(launchId)}` : ''
  return apiGet<TaskTracking>(
    `/api/teacher/tasks/${encodeURIComponent(taskId)}/tracking${query}`, { signal })
}

export function getLearnerAttempt(
  taskId: string, learnerId: string, launchId?: string, signal?: AbortSignal,
) {
  const query = launchId ? `?launch_id=${encodeURIComponent(launchId)}` : ''
  return apiGet<LearnerAttempt>(
    `/api/teacher/tasks/${encodeURIComponent(taskId)}/students/${encodeURIComponent(learnerId)}${query}`,
    { signal },
  )
}
