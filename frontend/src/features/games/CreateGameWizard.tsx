/* The "make a game" wizard, shared by the studio's Game Lab panel and the
 * lesson chat's Games tab.
 *
 * Three steps — objective, component, the brief — unless the host already
 * knows the first two: the lesson chat arrives with the objective and the
 * component of the screen the learner is on, and then only the brief is
 * left. `compact` is the chat variant: same markup, a narrower skin, and no
 * step strip once the context is fixed by the lesson rather than chosen.
 */

import { useEffect, useRef, useState } from 'react'
import { Icon } from '../../components/primitives'
import { useI18n } from '../../i18n/I18nProvider'
import {
  GAME_INSPIRATIONS, createGame, getPicker, prepareGame,
  type GameInspiration, type LearnerGame, type PickerComponent, type PickerObjective, type PickerSubject,
} from '../../services/games'
import { subjectLabel } from '../teacher-app/shared/subjectLabel'
import {
  TITLE_MAX, VIBE_MAX, createErrorKey, findComponent, findObjective, genreIcon, orderComponents, orderObjectives,
  type GameLabPreselect,
} from '../Yuvi-studio/panel/gameLabModel'
// The `.ys-*` skin lives with the studio; the chat renders the wizard too, so
// the sheet must be on the page whichever host mounts it first.
import '../../styles/Yuvi-studio.css'

export interface CreateGameWizardProps {
  isTouch: boolean
  preselect: GameLabPreselect | null
  onCreated: (game: LearnerGame) => void
  /** The chat column: narrower skin, and the lesson's context is not re-chosen. */
  compact?: boolean
}

export function CreateGameWizard({
  isTouch, preselect, onCreated, compact = false,
}: CreateGameWizardProps) {
  const { t } = useI18n()
  const [subjects, setSubjects] = useState<PickerSubject[] | null>(null)
  const [subject, setSubject] = useState<string | null>(null)
  const [pickerError, setPickerError] = useState(false)
  const [objective, setObjective] = useState<PickerObjective | null>(null)
  const [component, setComponent] = useState<PickerComponent | null>(null)
  const [inspirations, setInspirations] = useState<GameInspiration[]>([])
  const [vibe, setVibe] = useState('')
  const [name, setName] = useState('')
  const [deep, setDeep] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const preselected = useRef(false)
  // Both of the lesson's choices were found in the picker: the context is
  // the lesson's, so the compact wizard shows the brief alone.
  const [fixedContext, setFixedContext] = useState(false)

  useEffect(() => {
    let active = true
    setPickerError(false)
    getPicker()
      .then((result) => { if (active) setSubjects(result.subjects) })
      .catch(() => { if (active) setPickerError(true) })
    return () => { active = false }
  }, [])

  // The lesson page's "make a game for this" arrives with the objective and
  // component already chosen; land the learner on the genre step.
  useEffect(() => {
    if (!subjects || preselected.current || !preselect?.objective) return
    preselected.current = true
    const found = findObjective(subjects, preselect.objective)
    if (!found) return
    setObjective(found)
    const part = findComponent(found, preselect.component)
    if (part) { setComponent(part); prepareGame(part.id).catch(() => {}); setFixedContext(true) }
  }, [subjects, preselect])

  const step = !objective ? 1 : !component ? 2 : 3
  const shownSubject = subjects?.find((row) => row.subject === subject) ?? subjects?.[0] ?? null
  // In the chat, a fixed context is not a choice to walk back from.
  const locked = compact && fixedContext && step === 3
  // The picker is still loading the lesson's context: no step-1 flash.
  const settling = compact && !subjects && !pickerError && Boolean(preselect?.objective)

  const toggleInspiration = (chip: GameInspiration) => {
    setInspirations((current) => current.includes(chip) ? current.filter((c) => c !== chip) : [...current, chip])
  }

  const create = async () => {
    if (!objective || !component || creating) return
    setCreating(true)
    setCreateError(null)
    try {
      const game = await createGame({
        // A picker card may merge several catalog objectives with one title;
        // the component knows which one it belongs to.
        objective_id: component.objective_id || objective.id,
        unit_id: component.unit_id,
        component_id: component.id,
        inspirations,
        vibe: vibe.trim(),
        title: name.trim().slice(0, TITLE_MAX),
        device: isTouch ? 'touch' : 'keyboard',
        deep_thinking: deep,
      })
      onCreated(game)
    } catch (error) {
      setCreateError(t(createErrorKey(error)))
      setCreating(false)
    }
  }

  return (
    <section className={`ys-section ys-gamelab${compact ? ' ys-gamelab--compact' : ''}`} data-step={step}>
      {!locked && !settling && (
        <ol className="ys-gamelab-steps" aria-label={t('studio.gamelab.steps')}>
          {[1, 2, 3].map((n) => (
            <li
              key={n}
              className={n === step ? 'is-current' : n < step ? 'is-done' : ''}
              aria-current={n === step ? 'step' : undefined}
            >
              <span className="ys-gamelab-steps__n" aria-hidden>{n < step ? <Icon name="check" size={12} /> : n}</span>
              <span>{t(`studio.gamelab.step.${n}`)}</span>
            </li>
          ))}
        </ol>
      )}

      {settling && <p className="ys-empty">{t('studio.gamelab.loading')}</p>}

      {step === 1 && !settling && (
        <>
          <h2 className="ys-section__title">{t('studio.gamelab.pick.objective')}</h2>
          {pickerError && <p className="ys-note" role="alert">{t('studio.gamelab.error.picker')}</p>}
          {!subjects && !pickerError && <p className="ys-empty">{t('studio.gamelab.loading')}</p>}
          {subjects && subjects.length === 0 && <p className="ys-empty">{t('studio.gamelab.pick.none')}</p>}
          {subjects && subjects.length > 1 && (
            <div className="ys-gamelab-subjects" role="tablist" aria-label={t('studio.gamelab.pick.subject')}>
              {subjects.map((row) => (
                <button
                  key={row.subject}
                  type="button"
                  role="tab"
                  aria-selected={row.subject === shownSubject?.subject}
                  className={`ys-chip${row.subject === shownSubject?.subject ? ' is-active' : ''}`}
                  onClick={() => setSubject(row.subject)}
                >
                  {subjectLabel(row.subject, t)}
                </button>
              ))}
            </div>
          )}
          {shownSubject && (
            <ul className="ys-gamelab-picks">
              {orderObjectives(shownSubject.objectives).map((row) => (
                <li key={row.id}>
                  <button type="button" className="ys-gamelab-pick" onClick={() => { setObjective(row); setComponent(null) }}>
                    <span className="ys-gamelab-pick__title"><bdi dir="auto">{row.title}</bdi></span>
                    {row.topic_title && <span className="ys-gamelab-pick__sub"><bdi dir="auto">{row.topic_title}</bdi></span>}
                    {row.visited && <span className="ys-gamelab-badge">{t('studio.gamelab.visited')}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {step === 2 && objective && (
        <>
          <ChosenBar
            back={() => setObjective(null)}
            backLabel={t('studio.gamelab.back.objective')}
            lines={[objective.title]}
          />
          <h2 className="ys-section__title">{t('studio.gamelab.pick.component')}</h2>
          <ul className="ys-gamelab-picks">
            {orderComponents(objective.components).map((row) => (
              <li key={row.id}>
                <button type="button" className="ys-gamelab-pick" onClick={() => { setComponent(row); prepareGame(row.id).catch(() => {}) }}>
                  <span className="ys-gamelab-pick__title"><bdi dir="auto">{row.title}</bdi></span>
                  {row.unit_title && <span className="ys-gamelab-pick__sub"><bdi dir="auto">{row.unit_title}</bdi></span>}
                  {row.purpose && <span className="ys-gamelab-pick__purpose"><bdi dir="auto">{row.purpose}</bdi></span>}
                  {row.visited && (
                    <span className="ys-gamelab-pick__foot">
                      <span className="ys-gamelab-badge">{t('studio.gamelab.visited')}</span>
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {step === 3 && objective && component && (
        <>
          <ChosenBar
            back={locked ? undefined : () => setComponent(null)}
            backLabel={t('studio.gamelab.back.component')}
            lines={[objective.title, component.title]}
          />
          <h2 className="ys-section__title">{t('studio.gamelab.pick.brief')}</h2>
          <p className="ys-gamelab-lead">{t('studio.gamelab.brief.lead')}</p>
          <div className="ys-gamelab-field ys-gamelab-field--name">
            <input
              id="ys-gamelab-name"
              className="ys-gamelab-input"
              type="text"
              maxLength={TITLE_MAX}
              value={name}
              aria-label={t('studio.gamelab.name.label')}
              placeholder={t('studio.gamelab.name.placeholder')}
              onChange={(change) => setName(change.target.value.slice(0, TITLE_MAX))}
            />
            <span className="ys-gamelab-counter" aria-live="polite">{name.length}/{TITLE_MAX}</span>
          </div>
          <div className="ys-gamelab-field">
            <textarea
              id="ys-gamelab-vibe"
              className="ys-gamelab-textarea ys-gamelab-textarea--brief"
              rows={5}
              maxLength={VIBE_MAX}
              value={vibe}
              aria-label={t('studio.gamelab.pick.brief')}
              placeholder={t('studio.gamelab.brief.placeholder')}
              onChange={(change) => setVibe(change.target.value.slice(0, VIBE_MAX))}
            />
            <span className="ys-gamelab-counter" aria-live="polite">{vibe.length}/{VIBE_MAX}</span>
          </div>

          {/* Flavour only: Yuvi owns genre, engine and form. */}
          <p className="ys-subhead">{t('studio.gamelab.inspire.label')}</p>
          <div className="ys-chips" role="group" aria-label={t('studio.gamelab.inspire.label')}>
            {GAME_INSPIRATIONS.map((id) => (
              <button
                key={id}
                type="button"
                className={`ys-chip ys-gamelab-genre${inspirations.includes(id) ? ' is-active' : ''}`}
                aria-pressed={inspirations.includes(id)}
                onClick={() => toggleInspiration(id)}
              >
                <span aria-hidden>{genreIcon(id)}</span>
                {t(`studio.gamelab.inspire.${id}`)}
              </button>
            ))}
          </div>

          <button
            type="button"
            role="switch"
            aria-checked={deep}
            className={`ys-gamelab-switch${deep ? ' is-on' : ''}`}
            onClick={() => setDeep((on) => !on)}
          >
            <span className="ys-gamelab-switch__track" aria-hidden><span className="ys-gamelab-switch__knob" /></span>
            <span className="ys-gamelab-switch__text">
              <strong>{t('studio.gamelab.deep.label')}</strong>
              <small>{t('studio.gamelab.deep.hint')}</small>
            </span>
          </button>

          {createError && <p className="ys-note" role="alert">{createError}</p>}
          <button type="button" className="ys-btn ys-btn--primary ys-gamelab-create" onClick={() => void create()} disabled={creating}>
            <Icon name="wand" size={16} />
            {t(creating ? 'studio.gamelab.creating' : 'studio.gamelab.create')}
          </button>
        </>
      )}
    </section>
  )
}

/** What has been chosen so far, with one step back — or none, when the host
 *  fixed the choice. */
function ChosenBar({ back, backLabel, lines }: { back?: () => void; backLabel: string; lines: string[] }) {
  return (
    <div className="ys-gamelab-chosen">
      <div className="ys-gamelab-chosen__lines">
        {lines.map((line, index) => (
          <span key={index} className={index === lines.length - 1 ? 'is-last' : ''}><bdi dir="auto">{line}</bdi></span>
        ))}
      </div>
      {back && <button type="button" className="ys-chip" onClick={back}>{backLabel}</button>}
    </div>
  )
}
