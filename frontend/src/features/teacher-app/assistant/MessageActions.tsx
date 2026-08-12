/* The buttons an answer offers, under the answer.
 *
 * Three behaviours, one row:
 *
 *   navigate   → a validated in-app route. The model never authors a URL; the
 *                backend built it from a closed route table, and this checks it
 *                again before handing it to the router.
 *   followups  → sends its own label as the next question, the cheapest possible
 *                action and the same model the student companion uses.
 *   task       → opens a form in place. Nothing is written until the teacher
 *                confirms inside it.
 *
 * Rendered as a SIBLING of the bubble inside `.tch-dock__stack`, never inside
 * it: the bubble is `inline-size: fit-content`, so a form nested in it would be
 * squeezed to the width of the sentence above.
 *
 * `.tch-dock__row` forces `direction: ltr` so Yuvi stays physically left in
 * Hebrew — which means every chip here needs `dir="auto"` or Hebrew labels lay
 * out in the wrong visual order.
 */

import { useI18n } from '../../../i18n/I18nProvider'
import { navigate, useRoute } from '../../../app/router'
import { Icon } from '../../../components/primitives'
import type { AssistantAction, ActionOutcome } from '../../../services/teacherAssistant'
import { countKey } from '../shared/countLabel'
import { actionKey } from './actionKey'
import { isSafeAssistantRoute, labelFor } from './studentRefs'

interface Props {
  actions: AssistantAction[]
  outcomes: Record<string, ActionOutcome>
  /** The message these actions belong to, so open state cannot cross turns. */
  messageId: string
  /** Which action's form is open, if any — an `actionKey`, not a bare id. */
  openId: string | null
  onToggle: (id: string) => void
  onAsk: (question: string) => void
  busy: boolean
  /** Null for a learner who never finished mapping — a real state, not an
   *  error. `labelFor` renders the inert id rather than guessing a name. */
  nameOf: (learnerId: string) => string | null
}

export function MessageActions({
  actions, outcomes, messageId, openId, onToggle, onAsk, busy, nameOf,
}: Props) {
  const { t } = useI18n()
  const route = useRoute()
  if (!actions.length) return null

  const label = (action: AssistantAction) => {
    const params: Record<string, string | number> = { ...(action.params ?? {}) }
    // The model never sees a name, so an action carries an id and the browser
    // resolves it — the same substitution `StudentRef` does for `{{student:}}`.
    if (typeof params.learner_id === 'string') {
      params.name = labelFor(params.learner_id, nameOf(params.learner_id))
    }
    if (typeof params.count !== 'number') return t(action.label_key, params)

    // A count of one gets its own key, because `t()` has no plural engine and
    // "הצבה ל-1 תלמידים" is what the shared key renders. Where the action is
    // about exactly one child we also name them: a teacher confirming a write
    // should read who it is for, not how many.
    const only = action.learner_ids?.length === 1 ? action.learner_ids[0] : null
    if (only) params.name = labelFor(only, nameOf(only))
    return t(countKey(action.label_key, params.count), params)
  }

  return (
    <div className="tch-dock__actions" dir="auto" role="group"
         aria-label={t('tch.assistant.action.groupLabel')}>
      {actions.map((action) => {
        const done = outcomes[action.id]

        // A finished action is a receipt, not a button. Rendering it live again
        // after a reload is how a teacher assigns the same goal twice.
        if (done && done.status !== 'failed') {
          return (
            <span key={action.id} className="tch-dock__actionDone" dir="auto">
              <Icon name="check" size={13} aria-hidden />
              <span>{done.summary || t('tch.assistant.action.completed')}</span>
            </span>
          )
        }

        if (action.kind === 'followups') {
          return (action.questions ?? []).map((question, index) => (
            <button
              key={`${action.id}:${index}`}
              type="button"
              className="tch-dock__action tch-dock__action--ask"
              dir="auto"
              disabled={busy}
              onClick={() => onAsk(question)}
            >
              {question}
            </button>
          ))
        }

        if (action.kind === 'navigate') {
          if (!isSafeAssistantRoute(action.route)) return null
          // `navigate` to where you already are is a no-op, so a live-looking
          // button would simply do nothing when pressed. Say so instead.
          const here = action.route.split('?')[0] === route.split('?')[0]
          return (
            <button
              key={action.id}
              type="button"
              className="tch-dock__action"
              /* What kind of offer this is, so a check can target the goal form
                 rather than clicking the first expandable chip and asserting
                 against whatever it happened to open. */
              data-kind={action.kind}
              dir="auto"
              disabled={here}
              title={here ? t('tch.assistant.action.alreadyHere') : undefined}
              onClick={() => navigate(action.route as string)}
            >
              <Icon name={action.icon || 'arrow'} size={14} aria-hidden />
              <span>{label(action)}</span>
            </button>
          )
        }

        const isOpen = openId === actionKey(messageId, action.id)
        return (
          <button
            key={action.id}
            type="button"
            className={`tch-dock__action${isOpen ? ' is-open' : ''}`}
            data-kind={action.kind}
            dir="auto"
            aria-expanded={isOpen}
            onClick={() => onToggle(actionKey(messageId, action.id))}
          >
            <Icon name={action.icon || 'wand'} size={14} aria-hidden />
            <span>{label(action)}</span>
            {action.missing?.length ? (
              <span className="tch-dock__actionFlag" aria-hidden>•</span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}
