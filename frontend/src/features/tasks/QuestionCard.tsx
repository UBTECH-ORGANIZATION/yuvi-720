/* One question, any of the eight types, as a controlled input.
 *
 * A single component rather than eight, because everything outside the answer
 * control is identical — prompt, hint, verdict, explanation — and eight copies
 * of that frame is eight places for the RTL handling to drift.
 *
 * Three rules hold across every type:
 *
 * 1. **Every text field goes through `MathText`.** Never `{segments}` and never
 *    `dangerouslySetInnerHTML`. The content is model-generated, and the bidi
 *    isolation is the whole reason this feature has a renderer at all.
 * 2. **The answer shape matches the server's vocabulary exactly** — a number
 *    for `mcq`, a sorted array for `multiple_correct`, `[left, right]` pairs
 *    for `matching`. `evaluate.py` reads these directly; a shape invented here
 *    scores as wrong.
 * 3. **`readOnly` is a real state, not a disabled one.** After submission the
 *    child re-reads their own answers beside the verdict, so the controls must
 *    still show what they chose.
 */

import { useMemo } from 'react'
import { Icon } from '../../components/primitives'
import { useI18n } from '../../i18n/I18nProvider'
import { MathText } from './MathText'
import { blankShape } from './questionShape'
import type { LearnerQuestion, QuestionVerdict } from '../../services/tasks'

interface Props {
  question: LearnerQuestion
  index: number
  value: unknown
  onChange: (value: unknown) => void
  readOnly?: boolean
  verdict?: QuestionVerdict | null
  showHint?: boolean
  onAskHint?: () => void
}

/** The verdict as a word and a tone. Four states, because "skipped" and
 *  "wrong" call for different things from a learner and a teacher alike. */
function bucketOf(verdict?: QuestionVerdict | null) {
  if (!verdict) return null
  if (verdict.skipped) return 'skipped' as const
  const score = verdict.correctness
  if (score === null || score === undefined) return 'pending' as const
  if (score >= 1) return 'correct' as const
  return score > 0 ? 'partial' as const : 'wrong' as const
}

export function QuestionCard({
  question, index, value, onChange, readOnly, verdict, showHint, onAskHint,
}: Props) {
  const { t } = useI18n()
  const bucket = bucketOf(verdict)

  return (
    <article className={`yv-q${bucket ? ` is-${bucket}` : ''}`}>
      <header className="yv-q__head">
        <span className="yv-q__num" aria-hidden="true">{index + 1}</span>
        <MathText as="div" className="yv-q__prompt" content={question.prompt} />
      </header>

      <div className="yv-q__body">
        <AnswerControl
          question={question} value={value} onChange={onChange} readOnly={readOnly}
        />
      </div>

      {question.hint && question.hint.length > 0 && !readOnly ? (
        showHint ? (
          <p className="yv-q__hint">
            <Icon name="lightbulb" size={15} />
            <MathText content={question.hint} />
          </p>
        ) : (
          <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm yv-q__hintBtn"
                  onClick={onAskHint}>
            <Icon name="lightbulb" size={15} />
            {t('tasks.hint.ask')}
          </button>
        )
      ) : null}

      {bucket && bucket !== 'pending' ? (
        <p className={`yv-q__verdict is-${bucket}`}>
          <Icon name={bucket === 'correct' ? 'check' : bucket === 'skipped' ? 'clock' : 'alert'}
                size={15} />
          {t(`tasks.verdict.${bucket}`)}
          {verdict?.feedback ? <span className="yv-q__said">{verdict.feedback}</span> : null}
        </p>
      ) : null}

      {readOnly && question.explanation && question.explanation.length > 0 ? (
        <div className="yv-q__why">
          <MathText content={question.explanation} />
        </div>
      ) : null}
    </article>
  )
}

function AnswerControl({ question, value, onChange, readOnly }: {
  question: LearnerQuestion
  value: unknown
  onChange: (value: unknown) => void
  readOnly?: boolean
}) {
  const { t } = useI18n()
  const options = question.options ?? []

  switch (question.type) {
    case 'mcq':
    case 'image_mcq':
      return (
        <ul className="yv-opts" role="radiogroup">
          {options.map((option, position) => (
            <li key={position}>
              <button
                type="button" role="radio" disabled={readOnly}
                aria-checked={value === position}
                className={`yv-opt${value === position ? ' is-picked' : ''}`}
                onClick={() => onChange(position)}
              >
                <span className="yv-opt__mark" aria-hidden="true" />
                <MathText content={option} />
              </button>
            </li>
          ))}
        </ul>
      )

    case 'true_false':
      return (
        <div className="yv-opts yv-opts--pair" role="radiogroup">
          {[true, false].map((choice) => (
            <button
              key={String(choice)} type="button" role="radio" disabled={readOnly}
              aria-checked={value === choice}
              className={`yv-opt${value === choice ? ' is-picked' : ''}`}
              onClick={() => onChange(choice)}
            >
              <span className="yv-opt__mark" aria-hidden="true" />
              {t(choice ? 'tasks.true' : 'tasks.false')}
            </button>
          ))}
        </div>
      )

    case 'multiple_correct': {
      /* Sorted on every change. The server compares sets, but a stable order
         keeps a saved draft byte-identical between renders — otherwise the
         autosave fires on a reorder that changed nothing. */
      const picked = Array.isArray(value) ? (value as number[]) : []
      return (
        <>
          <p className="yv-q__note">{t('tasks.multi.note')}</p>
          <ul className="yv-opts">
            {options.map((option, position) => {
              const on = picked.includes(position)
              return (
                <li key={position}>
                  <button
                    type="button" role="checkbox" aria-checked={on} disabled={readOnly}
                    className={`yv-opt${on ? ' is-picked' : ''}`}
                    onClick={() => onChange(
                      (on ? picked.filter((entry) => entry !== position) : [...picked, position])
                        .sort((a, b) => a - b),
                    )}
                  >
                    <span className="yv-opt__mark yv-opt__mark--box" aria-hidden="true" />
                    <MathText content={option} />
                  </button>
                </li>
              )
            })}
          </ul>
        </>
      )
    }

    case 'fill_blank': {
      /* The box count comes from the QUESTION, never from what has been typed
         so far — and from whichever of its three sources this copy carries.
         See `questionShape.ts`: the child's copy has a stripped `blanks` shape,
         the teacher's preview has the key itself and no shape at all, and a
         hand-edited question may have neither. */
      const shape = blankShape(question)
      const typed = Array.isArray(value) ? (value as string[]) : []
      return (
        <div className="yv-blanks">
          {shape.map((blank, position) => (
            <span key={position} className="yv-blank__pair">
              {/* `x =` in front of the box. A coordinate pair is two boxes a
                  child can otherwise fill in the wrong order without ever
                  being told which was which. LTR because a label is a symbol
                  or a unit, and both read left to right in every language. */}
              {blank.label ? (
                <span className="yv-blank__label" dir="ltr" aria-hidden="true">
                  {blank.label} =
                </span>
              ) : null}
              <input
                className="sp-input yv-blank" disabled={readOnly}
                value={typed[position] ?? ''} inputMode="text"
                aria-label={blank.label
                  ? t('tasks.blank.named', { name: blank.label })
                  : t('tasks.blank.label', { n: String(position + 1) })}
                placeholder={t('tasks.blank.placeholder')}
                onChange={(event) => {
                  const next = [...typed]
                  while (next.length < shape.length) next.push('')
                  next[position] = event.target.value
                  onChange(next)
                }}
              />
            </span>
          ))}
        </div>
      )
    }

    case 'ordering':
      return <Ordering options={options} value={value} onChange={onChange} readOnly={readOnly} />

    case 'matching':
      return (
        <Matching question={question} value={value} onChange={onChange} readOnly={readOnly} />
      )

    case 'open_ended':
      return (
        <textarea
          className="sp-input yv-open" rows={5} disabled={readOnly}
          value={typeof value === 'string' ? value : ''}
          placeholder={t('tasks.open.placeholder')}
          onChange={(event) => onChange(event.target.value)}
        />
      )

    default:
      return null
  }
}

/** Ordering, as move-up/move-down rather than drag.
 *
 *  Drag-and-drop is the obvious gesture and the wrong one here: it has no
 *  keyboard equivalent without building one, it is unreliable on touch, and in
 *  RTL the horizontal direction of a drag is ambiguous. Buttons work
 *  everywhere and are the accessible baseline; a drag layer can sit on top of
 *  this later without changing the value shape. */
function Ordering({ options, value, onChange, readOnly }: {
  options: import('./mathSegments').MathSegment[][]
  value: unknown
  onChange: (value: unknown) => void
  readOnly?: boolean
}) {
  const { t } = useI18n()
  const order = useMemo(() => {
    const given = Array.isArray(value) ? (value as number[]) : []
    // Any option the stored order does not mention is appended, so a partial
    // or stale answer still renders every choice exactly once.
    const seen = new Set(given.filter((entry) => entry >= 0 && entry < options.length))
    return [...given.filter((entry) => seen.has(entry)),
            ...options.map((_, position) => position).filter((entry) => !seen.has(entry))]
  }, [value, options])

  const move = (from: number, to: number) => {
    if (to < 0 || to >= order.length) return
    const next = [...order]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    onChange(next)
  }

  return (
    <ol className="yv-order">
      {order.map((optionIndex, position) => (
        <li key={optionIndex} className="yv-order__row">
          <span className="yv-order__pos" aria-hidden="true">{position + 1}</span>
          <MathText className="yv-order__text" content={options[optionIndex]} />
          <span className="yv-order__moves">
            <button type="button" className="sp-btn sp-btn--icon sp-btn--ghost"
                    disabled={readOnly || position === 0}
                    aria-label={t('tasks.order.up')}
                    onClick={() => move(position, position - 1)}>
              <Icon name="arrow" size={15} className="yv-order__up" />
            </button>
            <button type="button" className="sp-btn sp-btn--icon sp-btn--ghost"
                    disabled={readOnly || position === order.length - 1}
                    aria-label={t('tasks.order.down')}
                    onClick={() => move(position, position + 1)}>
              <Icon name="arrow" size={15} className="yv-order__down" />
            </button>
          </span>
        </li>
      ))}
    </ol>
  )
}

/** Matching: pick a left item, then its partner. Value is `[[left, right], …]`,
 *  which is exactly what `evaluate.score_question` intersects against. */
function Matching({ question, value, onChange, readOnly }: {
  question: LearnerQuestion
  value: unknown
  onChange: (value: unknown) => void
  readOnly?: boolean
}) {
  const { t } = useI18n()
  const left = question.options ?? []
  const right = question.targets ?? []
  const pairs = Array.isArray(value) ? (value as number[][]) : []
  const partnerOf = (index: number) => pairs.find((pair) => pair[0] === index)?.[1]

  const link = (leftIndex: number, rightIndex: number) => {
    // One partner each way: re-linking a left item replaces its pair, and
    // claiming a right item releases whoever held it.
    const next = pairs.filter((pair) => pair[0] !== leftIndex && pair[1] !== rightIndex)
    onChange([...next, [leftIndex, rightIndex]].sort((a, b) => a[0] - b[0]))
  }

  return (
    <div className="yv-match">
      {left.map((item, leftIndex) => (
        <div key={leftIndex} className="yv-match__row">
          <MathText className="yv-match__term" content={item} />
          <select
            className="sp-input yv-match__pick" disabled={readOnly}
            value={partnerOf(leftIndex) ?? ''}
            aria-label={t('tasks.match.pick')}
            onChange={(event) => {
              const picked = event.target.value
              if (picked === '') {
                onChange(pairs.filter((pair) => pair[0] !== leftIndex))
                return
              }
              link(leftIndex, Number(picked))
            }}
          >
            <option value="">{t('tasks.match.none')}</option>
            {right.map((target, rightIndex) => (
              <option key={rightIndex} value={rightIndex}>
                {target.map((segment) => (
                  segment.type === 'math' ? segment.value : segment.text
                )).join('')}
              </option>
            ))}
          </select>
        </div>
      ))}
    </div>
  )
}
