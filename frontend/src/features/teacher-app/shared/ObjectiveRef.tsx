/* An objective, named — and openable.
 *
 * Wherever this app used to print an objective id, or worse, refer to "the same
 * objective" without saying which, it prints the title and makes it a button.
 * The button opens the catalogue's own account of the goal: what it asks a
 * child to be able to do, where it sits in the curriculum, what has to come
 * first, and which lessons teach it.
 *
 * The name resolves asynchronously and the row it sits in must not jump when it
 * arrives, so the unresolved state renders the fallback text at the same size —
 * never a spinner and never a blank.
 */

import { useEffect, useState } from 'react'
import { Icon } from '../../../components/primitives'
import { Modal } from '../../../components/primitives/Modal'
import { useI18n } from '../../../i18n/I18nProvider'
import { subjectLabel } from './subjectLabel'
import {
  cachedObjective, onObjectivesResolved, requestObjective, type ObjectiveInfo,
} from './objectiveInfo'

/** Subscribe one component to one objective.
 *
 *  Three states, not two: `undefined` is "the answer has not come back yet" and
 *  `null` is "the catalogue does not have this id". Collapsing them made a slow
 *  network indistinguishable from a retired objective, so the dialog either
 *  spun forever or claimed a real goal did not exist. */
export function useObjective(objectiveId?: string | null): ObjectiveInfo | null | undefined {
  const { language } = useI18n()
  const [, bump] = useState(0)

  useEffect(() => {
    if (!objectiveId) return
    requestObjective(objectiveId, language)
    return onObjectivesResolved(() => bump((value) => value + 1))
  }, [objectiveId, language])

  if (!objectiveId) return null
  return cachedObjective(objectiveId, language)
}

interface Props {
  objectiveId?: string | null
  /** Shown until the catalogue answers, and kept if it never does. */
  fallback?: string
  className?: string
}

export function ObjectiveRef({ objectiveId, fallback, className }: Props) {
  const { t } = useI18n()
  const info = useObjective(objectiveId)
  const [open, setOpen] = useState(false)

  const name = info?.title ?? fallback ?? ''
  if (!objectiveId || !name) return null

  return (
    <>
      <button
        type="button"
        className={`tch-objectiveRef${className ? ` ${className}` : ''}`}
        onClick={(event) => { event.stopPropagation(); setOpen(true) }}
        title={t('tch.objective.openHint')}
      >
        <bdi dir="auto">{name}</bdi>
        <Icon name="help" size={13} aria-hidden />
      </button>
      {open ? (
        <ObjectiveDialog objectiveId={objectiveId} onClose={() => setOpen(false)} />
      ) : null}
    </>
  )
}

/** The labelled line — "Objective: <name>" — as ONE component.
 *
 * Written after shipping the label and the name as separate elements, which
 * reproduced, on the alert row, the exact defect this round fixed in the
 * moments feed: while the catalogue lookup is in flight (or when it comes back
 * empty) the name renders nothing and the label is left sitting alone as
 *
 *     היעד:
 *
 * A caption with no value is worse than no caption. They live or die together
 * now, so no call site can get this wrong again.
 */
export function ObjectiveLine({ objectiveId, fallback }: {
  objectiveId?: string | null
  fallback?: string
}) {
  const { t } = useI18n()
  const info = useObjective(objectiveId)
  if (!objectiveId || !(info?.title ?? fallback)) return null
  return (
    <p className="tch-alert__objective" dir="auto">
      <span className="tch-alert__objectiveLabel">{t('tch.alert.objective')}</span>
      <ObjectiveRef objectiveId={objectiveId} fallback={fallback} />
    </p>
  )
}

export function ObjectiveDialog({ objectiveId, onClose }: {
  objectiveId: string
  onClose: () => void
}) {
  const { t } = useI18n()
  const info = useObjective(objectiveId)

  return (
    <Modal open onClose={onClose} titleId="tch-objective-title" className="tch-objective__modal">
      <h2 id="tch-objective-title" className="tch-objective__title" dir="auto">
        {info?.title ?? t('tch.objective.loading')}
      </h2>

      {info === undefined ? (
        <p className="tch-objective__body" dir="auto">{t('tch.objective.loading')}</p>
      ) : info === null ? (
        <p className="tch-objective__none" dir="auto">{t('tch.objective.unknown')}</p>
      ) : (
        <div className="tch-objective">
          {/* Where it sits. A goal read outside its curriculum and topic is a
              sentence with no scale — "identify the pattern" means one thing in
              year 7 arithmetic and another in year 9 algebra. */}
          <p className="tch-objective__where" dir="auto">
            {[
              subjectLabel(info.subject, t),
              info.curriculum_title || null,
              info.topic_title || null,
            ].filter(Boolean).join(' · ')}
          </p>

          {/* The ministry's own words, when the registry shipped them. */}
          {info.description ? (
            <p className="tch-objective__body" dir="auto">{info.description}</p>
          ) : (
            <p className="tch-objective__none" dir="auto">{t('tch.objective.noDescription')}</p>
          )}

          {info.prerequisites.length ? (
            <section className="tch-objective__section">
              <h3>{t('tch.objective.prerequisites')}</h3>
              <ul className="tch-objective__list">
                {info.prerequisites.map((prereq) => (
                  <li key={prereq.id} dir="auto">{prereq.title}</li>
                ))}
              </ul>
            </section>
          ) : null}

          {info.lessons.length ? (
            <section className="tch-objective__section">
              <h3>{t('tch.objective.lessons')}</h3>
              <ul className="tch-objective__list">
                {info.lessons.map((lesson) => (
                  <li key={lesson.component_id} dir="auto">
                    {lesson.title ?? lesson.component_id}
                    {/* The format only when it says something. Nearly every row
                        in this catalogue is "interactive-content", and a chip
                        repeated on all five lines is machine text pretending to
                        be a distinction. */}
                    {lesson.media_format && lesson.media_format !== 'interactive-content' ? (
                      <span className="tch-objective__format">{lesson.media_format}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      )}

      <div className="tch-objective__actions">
        <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm" onClick={onClose}>
          {t('tch.meeting.close')}
        </button>
      </div>
    </Modal>
  )
}
