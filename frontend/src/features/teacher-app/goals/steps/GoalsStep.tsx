/* Step two: the goals that came out of the talk.
 *
 * ONE list of suggestions, from both sources, unlabelled by source. It shipped
 * as two side-by-side columns and then as two headed bands, and both were
 * wrong for the same reason: a teacher choosing a goal is not choosing a
 * PROVENANCE. Whether a suggestion came from the write-up they just typed or
 * from the learnings map does not change what they are deciding, and heading
 * each group with an explanation of where it came from turned four cards into
 * two sections with an empty one on top. Where a suggestion came from is still
 * on every card — behind "why?", which is the question it answers.
 *
 * The conversation's own ideas still come FIRST in the list. That ordering is
 * the whole of what the ranking has to say.
 *
 * Both sources load themselves. There used to be a "suggest" button over the
 * evidence half, which meant the most useful part of the step sat empty behind
 * a press for anyone who did not know to make it.
 *
 * Below them, writing one by hand — always available, deliberately not the
 * default: the suggestions carry their grounding and their countable action,
 * and a hand-written goal carries neither.
 *
 * Goals accumulate here. Nothing is written until the review step.
 */

import { useEffect, useRef, useState } from 'react'
import { EmptyState, Icon, Skeleton } from '../../../../components/primitives'
import { useI18n } from '../../../../i18n/I18nProvider'
import {
  getGoalSuggestions, mentoringGoalIdeas, suggestStudentGoals,
  type GoalDraft, type MentoringGoalDraft,
} from '../../../../services/teacher'
import { DraftCard } from '../../student/TeacherGoals'

/** A week out — the window the whole goal model promises. */
function weekFromToday(): string {
  const date = new Date()
  date.setDate(date.getDate() + 7)
  return date.toISOString().slice(0, 10)
}

interface Props {
  learnerId: string
  notes: string
  goals: MentoringGoalDraft[]
  onGoals: (goals: MentoringGoalDraft[]) => void
  /* Both bands are OWNED BY THE COMPOSER, which outlives this step. Holding
     them here meant every trip back from the read-back re-fetched — an empty
     band that filled itself in, which reads as lost work, and a second
     uncached model call for the conversation ideas. `null` still means "not
     asked yet", and asking is still this step's job. */
  fromTalk: GoalDraft[] | null
  onFromTalk: (rows: GoalDraft[]) => void
  evidence: GoalDraft[] | null
  onEvidence: (rows: GoalDraft[]) => void
}

export function GoalsStep({
  learnerId, notes, goals, onGoals,
  fromTalk, onFromTalk, evidence, onEvidence,
}: Props) {
  const { t, language } = useI18n()

  const [openGoal, setOpenGoal] = useState(-1)
  const askedRef = useRef(false)
  const generatedRef = useRef(false)
  /** Where a newly added goal appears, so pressing "write my own" can bring it
   *  into view rather than leaving the teacher looking at the button. */
  const chosenRef = useRef<HTMLElement | null>(null)

  /* Asked exactly once per write-up, on arriving here with something written.
     There is no button to ask again: suggestions that change on every press
     are suggestions a teacher learns to disbelieve, and each re-roll is paid
     for. The other band keeps that property with a server-side cache; this one
     has none, so "once" is kept by the answer living in the composer — the
     local ref only stops a second ask inside one mount. */
  useEffect(() => {
    if (askedRef.current || fromTalk !== null || !notes.trim()) return
    askedRef.current = true
    mentoringGoalIdeas(learnerId, { language, notes })
      .then((result) => onFromTalk(result.goals ?? []))
      .catch(() => onFromTalk([]))
    // `fromTalk` and `onFromTalk` are the guard and the sink, not triggers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [learnerId, language, notes])

  /* The cache first, and a generation only if it has nothing to give.
     This used to be read-only with a "suggest" button beside it, which meant
     the band was empty for every teacher who did not know to press it — the
     most useful half of the step, hidden behind a discoverability problem.

     Generating when the cache is empty is not a re-roll: the result is stored
     server-side under the same key, so the second teacher to open this student
     reads what the first one generated. `generatedRef` is what keeps it to at
     most one call per mount — without it a stale read and a failed generate
     would trade places forever. */
  useEffect(() => {
    if (evidence !== null) return
    let active = true
    getGoalSuggestions(learnerId, language)
      .then(async (result) => {
        if (!active) return
        const cached = result.goals ?? []
        if ((cached.length && !result.stale) || generatedRef.current) {
          onEvidence(cached)
          return
        }
        generatedRef.current = true
        // Keep the skeleton up rather than flashing "nothing here" for the
        // second or two the generation takes.
        if (cached.length) onEvidence(cached)
        const fresh = await suggestStudentGoals(learnerId, language).catch(() => null)
        if (active) onEvidence(fresh?.goals ?? cached)
      })
      .catch(() => { if (active) onEvidence([]) })
    return () => { active = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [learnerId, language])

  const add = (goal: MentoringGoalDraft) => {
    onGoals([...goals, goal])
    setOpenGoal(goals.length)
  }

  /* `action` and `because` travel with the goal. A teacher rewording a title
     must not silently turn a tracked goal into an untracked one. */
  const useDraft = (draft: GoalDraft, origin: 'conversation' | 'evidence') => add({
    title: draft.title,
    next_steps: draft.next_steps,
    deadline: draft.deadline || weekFromToday(),
    action: draft.action ?? null,
    because: draft.because,
    origin,
  })

  const patch = (index: number, changes: Partial<MentoringGoalDraft>) =>
    onGoals(goals.map((goal, at) => (at === index ? { ...goal, ...changes } : goal)))

  /* One list. The conversation's ideas lead — the person who was in the room
     outranks the event counts — and neither half is labelled with where it came
     from, because that is not what the teacher is choosing between. */
  const wanted = notes.trim() ? fromTalk : []
  const loading = wanted === null || evidence === null
  const suggestions = [
    ...(wanted ?? []).map((draft) => ({ draft, origin: 'conversation' as const })),
    ...(evidence ?? []).map((draft) => ({ draft, origin: 'evidence' as const })),
  ]

  /* A new blank goal, opened and scrolled to. Adding one used to leave the
     teacher looking at the button they had just pressed, with the fields that
     appeared somewhere below the fold. */
  const addOwn = () => {
    add({ title: '', next_steps: '', deadline: weekFromToday(),
          action: null, origin: 'manual' })
    window.requestAnimationFrame(() => {
      chosenRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    })
  }

  return (
    <div className="tch-step tch-goalsStep">
      <section className="tch-goalsStep__band">
        <header>
          <h4>{t('tch.mentoring.goals.ideas')}</h4>
          <small>{t('tch.mentoring.goals.ideas.hint')}</small>
        </header>
        {loading ? (
          /* Card-shaped and card-count, so the list does not jump when the
             real suggestions land under the teacher's cursor. */
          <ul className="tch-drafts" aria-busy="true">
            {[0, 1, 2].map((index) => (
              <li key={index} className="tch-draft tch-draft--skeleton">
                <Skeleton w="100%" h={168} />
              </li>
            ))}
          </ul>
        ) : suggestions.length ? (
          <ul className="tch-drafts">
            {suggestions.map(({ draft, origin }, index) => (
              <DraftCard key={`${origin}:${draft.title}:${index}`} draft={draft}
                         onUse={() => useDraft(draft, origin)} />
            ))}
          </ul>
        ) : (
          <p className="tch-goalsStep__none" dir="auto">
            {t('tch.goals.noSuggestions.body')}
          </p>
        )}
      </section>

      {/* One button, not a disclosure over a button. The accordion asked the
          teacher to open a thing in order to press a thing, and what it
          revealed was one line of hint and one more button — so pressing this
          adds the goal and scrolls its fields into view instead. The #253
          audience hint moved onto the fields themselves, where a teacher
          typing a title can actually read it. */}
      <button type="button" className="sp-btn tch-goalsStep__addOwn" onClick={addOwn}>
        <Icon name="plus" size={15} aria-hidden />
        {t('tch.mentoring.goals.own')}
      </button>

      <section className="tch-goalsStep__chosen"
               ref={(node) => { chosenRef.current = node }}>
        <h4>{t('tch.mentoring.goals.chosen', { count: goals.length })}</h4>
        {goals.length === 0 ? (
          <EmptyState title={t('tch.mentoring.goals.empty')}
                      body={t('tch.mentoring.goals.empty.body')} />
        ) : (
          <ul className="tch-chosenGoals">
            {goals.map((goal, index) => (
              <li key={index} className={openGoal === index ? 'is-open' : ''}>
                <div className="tch-chosenGoals__head">
                  <button type="button" onClick={() => setOpenGoal(openGoal === index ? -1 : index)}>
                    <Icon name={openGoal === index ? 'chevronDown' : 'chevronLeft'}
                          size={14} aria-hidden />
                    <strong dir="auto">{goal.title || t('tch.mentoring.goals.untitled')}</strong>
                  </button>
                  {!goal.deadline ? (
                    <span className="tch-chosenGoals__warn">
                      {t('tch.mentoring.goals.deadlineRequired')}
                    </span>
                  ) : null}
                  <button type="button" className="tch-chosenGoals__remove"
                          aria-label={t('tch.mentoring.goals.remove')}
                          onClick={() => onGoals(goals.filter((_, at) => at !== index))}>
                    <Icon name="close" size={14} />
                  </button>
                </div>

                {openGoal === index ? (
                  <div className="tch-chosenGoals__body">
                    <p className="tch-composer__audience" dir="auto">
                      <Icon name="spark" size={13} aria-hidden />
                      {t('tch.goals.field.audience')}
                    </p>
                    <label>
                      <span>{t('tch.goals.field.title')}</span>
                      <input className="sp-input" dir="auto" value={goal.title}
                             onChange={(event) => patch(index, { title: event.target.value })} />
                    </label>
                    <label>
                      <span>{t('tch.goals.field.steps')}</span>
                      <textarea className="sp-input" rows={2} dir="auto" value={goal.next_steps}
                                onChange={(event) => patch(index, { next_steps: event.target.value })} />
                    </label>
                    <label>
                      <span>{t('tch.goals.field.deadline')}</span>
                      <input className="sp-input" type="date" value={goal.deadline}
                             onChange={(event) => patch(index, { deadline: event.target.value })} />
                    </label>
                    {goal.action ? (
                      <p className="tch-goal__progress" dir="auto">
                        <Icon name="target" size={13} aria-hidden />
                        {t(`tch.goals.action.${goal.action.kind}`)}
                        {' · '}
                        {t('tch.goals.action.perWeek', { target: goal.action.target })}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
