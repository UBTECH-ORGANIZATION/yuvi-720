/* Documenting a conversation, in the order it happened.
 *
 * The old dialog was a form that posted one goal and closed. That shape
 * disagreed with the data model underneath it — a goal has never had an
 * independent existence, it is an element of a conversation — and with how
 * teachers actually work, which is to talk to a child and come out with two or
 * three things.
 *
 * Three steps: what we discussed, what we agreed, read it back. There is no
 * feeling step, which the learner's composer has: that step is a child telling
 * us how they felt, and a teacher documenting a talk has no feeling of their
 * own to file here.
 *
 * ## Why the shared Modal and not the learner's
 *
 * `MentoringPage`'s composer is a hand-rolled backdrop with no focus trap, no
 * Escape handling and no focus restore. The shape is worth copying; that part
 * is not.
 */

import { useEffect, useMemo, useState } from 'react'
import { Modal } from '../../../components/primitives/Modal'
import { Icon } from '../../../components/primitives'
import { useI18n } from '../../../i18n/I18nProvider'
import {
  documentMentoring, type GoalDraft, type TeacherMentoringDraft,
} from '../../../services/teacher'
import { ConfirmDialog } from '../shared/ConfirmDialog'
import { ConversationPrepPanel } from './ConversationPrepPanel'
import { DiscussedStep } from './steps/DiscussedStep'
import { GoalsStep } from './steps/GoalsStep'
import { ReviewStep } from './steps/ReviewStep'
import './teacher-mentoring.css'

/** No feeling step — see the header. The icon is what the step IS: a talk, a
 *  target, a page to read back. A numbered circle told the teacher only how
 *  many were left, which they could already see. */
const STEPS = [
  { id: 'discussed', icon: 'message' },
  { id: 'goals', icon: 'target' },
  { id: 'review', icon: 'document' },
] as const

interface Props {
  open: boolean
  draft: TeacherMentoringDraft
  candidates: { id: string; name: string }[]
  onDraft: (draft: TeacherMentoringDraft) => void
  onClose: () => void
  onSaved: () => void
}

export function MentoringComposer({
  open, draft, candidates, onDraft, onClose, onSaved,
}: Props) {
  const { t, language } = useI18n()
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState('')
  const [confirmClose, setConfirmClose] = useState(false)

  /* The goal suggestions belong to the WRITE-UP, not to the step that shows
     them, so they are held here — the composer is mounted for the whole draft,
     the goals step is not.
     Two reasons, and the second is the one that matters. Going back from the
     read-back used to land on an empty band that then repopulated, which reads
     as "it lost what I had". And `mentoringGoalIdeas` is deliberately uncached
     on the server, so every return to that step was buying a fresh model call
     and a fresh set of wordings — the exact re-roll this screen refuses to do
     anywhere else. Asked once per write-up; a new draft_id asks again. */
  const [goalIdeas, setGoalIdeas] = useState<GoalDraft[] | null>(null)
  const [goalEvidence, setGoalEvidence] = useState<GoalDraft[] | null>(null)
  useEffect(() => {
    setGoalIdeas(null)
    setGoalEvidence(null)
  }, [draft.draft_id])

  const learnerId = draft.learner_id
  /* Falls back to the id, the way `labelFor` and the roster do — never to a
     generic word for a child. The draft can legitimately name someone this
     screen's candidate list does not: the teaching assistant seeds drafts for
     any student the teacher can reach, and `candidates` is only the class
     currently in scope. Showing the id says "this one, and I don't have their
     name here"; "תלמיד/ה" would say nothing at all. */
  const studentName = useMemo(
    () => candidates.find((row) => row.id === learnerId)?.name || learnerId,
    [candidates, learnerId],
  )

  const named = draft.goals.filter((goal) => goal.title.trim() || goal.next_steps.trim())
  const goalsValid = named.every((goal) => Boolean(goal.deadline))
  /* Parallel to the step list. "Can I leave this step" and "can I save" are
     different questions — a talk with no goals is a valid record. */
  const stepValid = [Boolean(draft.notes.trim()), goalsValid, true]
  const canSave = Boolean(draft.notes.trim()) && goalsValid
  const isLast = draft.step === STEPS.length - 1
  const hasContent = Boolean(draft.notes.trim() || named.length || draft.teacher_only_note.trim())

  const patch = (changes: Partial<TeacherMentoringDraft>) => onDraft({ ...draft, ...changes })
  const go = (delta: number) =>
    patch({ step: Math.min(STEPS.length - 1, Math.max(0, draft.step + delta)) })

  const requestClose = () => (hasContent ? setConfirmClose(true) : onClose())

  const save = async () => {
    if (!canSave || !learnerId) return
    setSaving(true)
    setFailed('')
    try {
      await documentMentoring(learnerId, {
        notes: draft.notes.trim(),
        goals: named.map((goal) => ({
          title: goal.title.trim() || goal.next_steps.trim(),
          next_steps: goal.next_steps.trim(),
          deadline: goal.deadline,
          // Carried from the draft it came from: rewording a suggestion must
          // not quietly drop what the platform promised to count.
          action: goal.action,
        })),
        teacher_only_note: draft.teacher_only_note.trim(),
        // The same key on a retry, so a slow save that the teacher clicks
        // twice cannot become two conversations.
        draft_id: draft.draft_id,
        language,
      })
    } catch {
      setFailed(t('tch.mentoring.saveFailed'))
      return
    } finally {
      setSaving(false)
    }
    onSaved()
  }

  return (
    /* The step is on the dialog itself: it fixes the writing steps to one
       height so moving between them does not resize the window around the
       teacher, and lets the read-back shrink to what it actually holds. */
    <Modal open={open} onClose={requestClose} titleId="tch-mentoring-title"
           className={`tch-mentoringModal tch-mentoringModal--${STEPS[draft.step].id}`}
           dismissible={false}>
      <header className="tch-mentoringModal__head">
        <h2 id="tch-mentoring-title" dir="auto">
          {t('tch.mentoring.title', { name: studentName })}
        </h2>
        <p dir="auto">{t('tch.mentoring.lead')}</p>
      </header>

      <ol className="tch-stepper">
        {STEPS.map((step, index) => (
          <li key={step.id}
              className={index < draft.step ? 'is-complete' : index === draft.step ? 'is-current' : ''}>
            <span className="tch-stepper__dot">
              <Icon name={index < draft.step ? 'check' : step.icon} size={16} aria-hidden />
            </span>
            <span>{t(`tch.mentoring.step.${step.id}`)}</span>
          </li>
        ))}
      </ol>

      <div className="tch-mentoringModal__body">
        {/* Prep rather than a portrait: what to raise, what the numbers say,
            what to open with. It travels through the two steps where the
            teacher is still deciding what to write — and stops at the
            read-back, where there is nothing left to decide and the column
            would only be holding the dialog open around a short summary. */}
        {STEPS[draft.step].id !== 'review' ? (
          <ConversationPrepPanel key={learnerId} learnerId={learnerId} step={draft.step} />
        ) : null}

        <div className="tch-mentoringModal__stage">
          {/* Not on the goals step. That step opens on a headed band of its
              own ("goal ideas"), so a guide above it was a second heading
              introducing the same list — and the step name is already in the
              stepper two rows up. */}
          {STEPS[draft.step].id !== 'goals' ? (
            <p className="tch-step__guide" dir="auto">
              <strong>{t(`tch.mentoring.guide.${STEPS[draft.step].id}.title`)}</strong>
              <span>{t(`tch.mentoring.guide.${STEPS[draft.step].id}.desc`)}</span>
            </p>
          ) : null}

          {draft.step === 0 ? (
            <DiscussedStep
              learnerId={learnerId}
              notes={draft.notes}
              teacherOnlyNote={draft.teacher_only_note}
              qa={draft.qa}
              onNotes={(notes) => patch({ notes })}
              onTeacherOnlyNote={(teacher_only_note) => patch({ teacher_only_note })}
              onQa={(qa) => patch({ qa })}
            />
          ) : draft.step === 1 ? (
            <GoalsStep
              learnerId={learnerId}
              notes={draft.notes}
              goals={draft.goals}
              onGoals={(goals) => patch({ goals })}
              fromTalk={goalIdeas}
              onFromTalk={setGoalIdeas}
              evidence={goalEvidence}
              onEvidence={setGoalEvidence}
            />
          ) : (
            <ReviewStep
              notes={draft.notes}
              teacherOnlyNote={draft.teacher_only_note}
              goals={draft.goals}
              studentName={studentName}
            />
          )}
        </div>
      </div>

      <footer className="tch-mentoringModal__actions">
        <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm"
                onClick={() => (draft.step === 0 ? requestClose() : go(-1))}>
          {draft.step === 0 ? t('tch.subgroups.cancel') : t('tch.mentoring.back')}
        </button>
        {isLast ? (
          <button type="button" className="sp-btn sp-btn--sm"
                  disabled={saving || !canSave} onClick={() => void save()}>
            {saving ? t('tch.assistant.form.working') : t('tch.mentoring.save')}
          </button>
        ) : (
          <button type="button" className="sp-btn sp-btn--sm"
                  disabled={!stepValid[draft.step]} onClick={() => go(1)}>
            {t('tch.mentoring.next')}
          </button>
        )}
      </footer>

      {failed ? (
        <p className="tch-composer__failed" role="status" dir="auto">{failed}</p>
      ) : null}

      <ConfirmDialog
        open={confirmClose}
        title={t('tch.mentoring.discard.title')}
        body={t('tch.mentoring.discard.body')}
        confirmLabel={t('tch.mentoring.discard.confirm')}
        destructive
        onClose={() => setConfirmClose(false)}
        onConfirm={() => { setConfirmClose(false); onClose() }}
      />
    </Modal>
  )
}
