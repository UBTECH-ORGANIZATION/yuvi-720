/* Say a good word to the children who got a topic (#467).
 *
 * Shared: the dashboard's strengths column opens it for the children who
 * mastered a topic, and the student profile opens it for one child whose
 * "what's working" row just named something they did well. Same pipeline, same
 * words on Yuvi's card, same optional sparks — only the audience differs, which
 * is exactly what `StrengthItem` already carries.
 *
 * The card's other half already knows exactly who mastered something; until
 * now the only thing a teacher could do with that list was read it. This is the
 * action that belongs to it, and it reuses the good-word pipeline rather than
 * inventing a second kind of praise: the child gets the teacher's exact words
 * on Yuvi's card, and the sparks, if any, follow the words.
 *
 * Three deliberate choices:
 *
 *   * Everyone is selected to begin with, and each child can be dropped. The
 *     gesture is "well done, all of you"; making the teacher tick eight boxes
 *     to express it would be a tax on the only encouraging action on the page.
 *
 *   * ONE draft id for the whole dialog. A send to eight children is eight
 *     grants, and the server keys each on `{learner}:{draft}` — so a
 *     double-clicked send pays once per child rather than twice.
 *
 *   * A partial failure is reported as a partial failure. Sends are per child;
 *     if three of eight fail, saying "sent" would be a lie and saying "failed"
 *     would invite a retry that pays the five again.
 */

import { useEffect, useState } from 'react'
import { Icon } from '../../../components/primitives'
import { Modal } from '../../../components/primitives/Modal'
import { useI18n } from '../../../i18n/I18nProvider'
import { sendKudos } from '../../../services/teacher'
import { KudosSparks, useDraftId } from './KudosSparks'
import { StudentAvatar } from './StudentAvatar'
import type { StrengthItem } from './DifficultiesCard'

export function PraiseDialog({
  strength, names, onClose,
}: {
  strength: StrengthItem | null
  names: Map<string, string | null>
  /** `sent` is true only when at least one good word actually went out, so a
   *  caller can hide its own prompt afterwards. A cancelled dialog closes with
   *  false and changes nothing. */
  onClose: (sent?: boolean) => void
}) {
  const { t, language } = useI18n()
  const draftId = useDraftId()
  const [chosen, setChosen] = useState<string[]>([])
  const [message, setMessage] = useState('')
  const [sparks, setSparks] = useState(0)
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'failed' | 'partial'>('idle')
  const [failedCount, setFailedCount] = useState(0)

  /* Re-arm for each topic the teacher opens. Without this the previous topic's
     selection and half-typed message would be waiting inside the next one. */
  useEffect(() => {
    if (!strength) return
    setChosen(strength.learnerIds)
    setMessage('')
    setSparks(0)
    setState('idle')
    setFailedCount(0)
  }, [strength])

  if (!strength) return null

  const toggle = (learnerId: string) => {
    setChosen((current) => (current.includes(learnerId)
      ? current.filter((id) => id !== learnerId)
      : [...current, learnerId]))
  }

  async function send() {
    const text = message.trim()
    if (!text || !chosen.length || state === 'sending') return
    setState('sending')
    const results = await Promise.allSettled(chosen.map((learnerId) => sendKudos(
      learnerId, text, language,
      /* A general good word (#485/#495) carries no topic — no moment. */
      strength!.id ? { objective_id: strength!.id, kind: 'strength' } : undefined,
      { sparks, draftId },
    )))
    const failed = results.filter((row) => row.status === 'rejected').length
    setFailedCount(failed)
    if (!failed) {
      setState('sent')
      // Long enough to read the confirmation, short enough not to be a step.
      setTimeout(() => onClose(true), 1200)
    } else if (failed === chosen.length) {
      setState('failed')
    } else {
      // Some did go out, so the caller may treat this as said — but the dialog
      // stays open, because the teacher still has to decide about the rest.
      setState('partial')
    }
  }

  const busy = state === 'sending'
  return (
    <Modal open onClose={() => onClose(false)} titleId="tch-praise-title" className="tch-praise__modal">
      <div className="tch-praise">
        <h2 className="tch-praise__title" id="tch-praise-title">
          {t('tch.gaps.strength.praiseTitle')}
        </h2>
        {strength.title ? (
          <p className="tch-praise__topic" dir="auto">{strength.title}</p>
        ) : null}

        <fieldset className="tch-praise__who">
          <legend>{t('tch.gaps.strength.praiseWho', { count: chosen.length })}</legend>
          <div className="tch-praise__chips">
            {strength.learnerIds.map((learnerId) => {
              const on = chosen.includes(learnerId)
              return (
                <button
                  key={learnerId}
                  type="button"
                  className={`tch-praise__chip${on ? ' is-on' : ''}`}
                  aria-pressed={on}
                  disabled={busy}
                  onClick={() => toggle(learnerId)}
                >
                  <StudentAvatar
                    learnerId={learnerId}
                    name={names.get(learnerId) ?? null}
                    size={20}
                  />
                  <span dir="auto">{names.get(learnerId) ?? ''}</span>
                  {on ? <Icon name="check" size={12} aria-hidden /> : null}
                </button>
              )
            })}
          </div>
        </fieldset>

        <label className="tch-praise__field">
          <span>{t('tch.gaps.strength.praiseWords')}</span>
          <textarea
            className="sp-input"
            rows={3}
            value={message}
            disabled={busy}
            maxLength={400}
            placeholder={t('tch.kudos.placeholder')}
            onChange={(event) => setMessage(event.target.value)}
          />
        </label>

        <KudosSparks value={sparks} onChange={setSparks} disabled={busy} />

        <div className="tch-praise__actions">
          <button type="button" className="sp-btn sp-btn--ghost" onClick={() => onClose(false)}
                  disabled={busy}>
            {t('tch.subgroups.cancel')}
          </button>
          <button
            type="button"
            className="sp-btn sp-btn--primary"
            onClick={send}
            disabled={busy || !message.trim() || !chosen.length}
          >
            {busy ? t('tch.kudos.sending')
              : t('tch.gaps.strength.praiseSend', { count: chosen.length })}
          </button>
        </div>

        {state === 'sent' ? (
          <p className="tch-praise__status" role="status">{t('tch.kudos.sent')}</p>
        ) : null}
        {state === 'failed' ? (
          <p className="tch-praise__status is-bad" role="status">{t('tch.kudos.failed')}</p>
        ) : null}
        {/* Named honestly, and it names WHO is still owed one — a bare "some
            failed" leaves the teacher to either send twice or not at all. */}
        {state === 'partial' ? (
          <p className="tch-praise__status is-bad" role="status">
            {t('tch.gaps.strength.praisePartial', {
              sent: chosen.length - failedCount, failed: failedCount,
            })}
          </p>
        ) : null}
      </div>
    </Modal>
  )
}
