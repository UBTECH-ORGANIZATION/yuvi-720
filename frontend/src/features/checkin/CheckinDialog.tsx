/* The daily feelings check-in (#452): once per Israeli school day, on the
 * first visit — an optional look-back at what was hard last session, a
 * real-feelings pick (valence faces → word chips), and an empowering close.
 *
 * NOTE: this IS a stepper, and `ReflectionPanel`'s anti-stepper rationale
 * (one visible scroll of three questions beats hidden steps) deliberately
 * does not apply — every step here is a single pick, so there is nothing to
 * scan ahead to. Do not "fix" it back into one long panel.
 *
 * Skips are data: every step has a visible skip, and Escape/backdrop records
 * skip-remaining before dismissing. "Asked today" is the server-side doc —
 * created on open — so a learner who bails is not re-nagged (no localStorage,
 * hard project rule). */

import { useEffect, useState } from 'react'
import { Modal } from '../../components/primitives/Modal'
import { useI18n } from '../../i18n/I18nProvider'
import { useOnboarding } from '../../providers/OnboardingProvider'
import { useTour } from '../../components/tour/TourProvider'
import {
  answerCheckin, completeCheckin, getCheckinPending, sendCheckinFeeling,
  skipCheckin, startCheckin, type CheckinView,
} from '../../services/checkin'
import { CheckinCreature } from './CheckinCreatures'
import { ValenceFace } from './ValenceFaces'
import { VALENCES, VALENCE_FEELINGS, type Valence } from './feelings'
import './checkin.css'

type Step = 'callback' | 'feeling' | 'closing'

export function CheckinGate() {
  const { stage } = useOnboarding()
  const { language } = useI18n()
  const { isActive: isTourActive } = useTour()
  const [view, setView] = useState<CheckinView | null>(null)
  const [open, setOpen] = useState(false)

  /* One pending read after onboarding and any first-use tour. Starting creates
     the day's doc, which is what makes the ask once-per-day. Deferring one task
     lets the tour's own first-render effect claim the screen before this gate
     decides whether to ask. */
  useEffect(() => {
    if (stage !== 'done' || isTourActive) return
    let active = true
    const start = window.setTimeout(() => {
      getCheckinPending()
        .then(({ due }) => {
          if (!active || !due) return null
          return startCheckin(language).then((doc) => {
            if (!active) return null
            setView(doc)
            setOpen(true)
            return null
          })
        })
        .catch(() => {})
    }, 0)
    return () => {
      active = false
      window.clearTimeout(start)
    }
    // `language` is read at open time only: a later language switch must not
    // re-open a dialog that was already offered today.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, isTourActive])

  if (!open || !view) return null
  return (
    <CheckinDialog
      view={view}
      onDone={() => { setOpen(false); setView(null) }}
    />
  )
}

/* The whole sentence the child is agreeing to, with the picked word wearing
 * the family accent. The template comes from the locale as one string with a
 * `{feeling}` placeholder, split around a marker so the word can be its own
 * styled element without hardcoding word order per language. */
function Sentence({ feeling, t }: {
  feeling: string | null
  t: (key: string, params?: Record<string, string | number>) => string
}) {
  const MARK = '⁙'
  const [before, after] = t('checkin.sentence', { feeling: MARK }).split(MARK)
  return (
    <p className="ck-sentence" dir="auto">
      {before}
      <strong className={`ck-sentence__word${feeling ? '' : ' is-empty'}`}>
        {feeling ? t(`checkin.feeling.${feeling}`) : '· · ·'}
      </strong>
      {after}
    </p>
  )
}

function CheckinDialog({ view, onDone }: { view: CheckinView; onDone: () => void }) {
  const { t, language } = useI18n()
  const hasCallback = view.questions.length > 0
  const [step, setStep] = useState<Step>(hasCallback ? 'callback' : 'feeling')
  const [answer, setAnswer] = useState('')
  const [valence, setValence] = useState<Valence | null>(null)
  /* Picking a word SELECTS it (sentence, definition, creature appear); the
     confirm button is what sends — a feeling is worth a second look before
     it becomes the day's record. */
  const [feeling, setFeeling] = useState<string | null>(null)
  const [closingLine, setClosingLine] = useState<string | null>(null)
  const [sendFailed, setSendFailed] = useState(false)

  const checkinId = view.checkin_id

  /* Every exit is recorded. `steps` names what was waved off — a dismissal
     mid-way skips everything still ahead. */
  async function bail() {
    const remaining = step === 'callback' ? ['callback', 'feeling'] : ['feeling']
    if (step !== 'closing') {
      await skipCheckin(checkinId, remaining).catch(() => {})
    } else {
      await completeCheckin(checkinId).catch(() => {})
    }
    onDone()
  }

  function submitCallback() {
    // Fire-and-forget: the answer POST needs no reply the next step depends on.
    const text = answer.trim()
    if (text) void answerCheckin(checkinId, view.questions[0].id, text).catch(() => {})
    setStep('feeling')
  }

  /* Optimistic: the closing screen shows IMMEDIATELY (with its written
     heading), the send settles in the background, and the generated line
     swaps in when it arrives. Only a failure brings the dialog back — to the
     feeling step, pick intact, with a retry note. If the child closes before
     a failed send is noticed, the open day-doc keeps the check-in due, so
     the next visit simply asks again: nothing is silently lost. */
  function pickFeeling(picked: Valence, word: string) {
    setSendFailed(false)
    setStep('closing')
    sendCheckinFeeling(checkinId, picked, word, language)
      .then((result) => setClosingLine(result.closing_line))
      .catch(() => {
        setClosingLine(null)
        setStep('feeling')
        setSendFailed(true)
      })
  }

  function finish() {
    void completeCheckin(checkinId).catch(() => {})
    onDone()
  }

  return (
    <Modal
      open
      onClose={() => void bail()}
      titleId="ck-title"
      className="ck-dialog"
    >
      <div className="ck-root" data-valence={valence ?? undefined}>
        {/* The skip lives small in the top-left corner — out of the child's
            reading path, present on every step until the closing screen. */}
        {step !== 'closing' && (
          <button type="button" className="ck-skipTop" onClick={() => void bail()}>
            {t('checkin.skip')}
          </button>
        )}
        <header className="ck-head">
          <h2 id="ck-title">{t('checkin.title')}</h2>
          {step !== 'closing' && <p className="ck-subtitle">{t('checkin.subtitle')}</p>}
        </header>

        {step === 'callback' && (
          <section className="ck-step" aria-label={t('checkin.step0.heading')}>
            <p className="ck-question" dir="auto">{view.questions[0].text}</p>
            <textarea
              className="ck-answer"
              value={answer}
              maxLength={800}
              rows={3}
              placeholder={t('checkin.step0.placeholder')}
              onChange={(event) => setAnswer(event.target.value)}
              dir="auto"
            />
            <div className="ck-actions">
              <button type="button" className="ck-btn ck-btn--primary"
                      onClick={submitCallback}>
                {t('checkin.next')}
              </button>
              <button type="button" className="ck-btn ck-btn--ghost"
                      onClick={() => {
                        void skipCheckin(checkinId, ['callback']).catch(() => {})
                        setStep('feeling')
                      }}>
                {t('checkin.skipQuestion')}
              </button>
            </div>
          </section>
        )}

        {step === 'feeling' && (
          <section className="ck-step" aria-label={t('checkin.title')}>
            <div className="ck-faces" role="radiogroup" aria-label={t('checkin.valenceAria')}>
              {VALENCES.map((option) => (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={valence === option}
                  aria-label={t(`checkin.valence.${option}`)}
                  className={`ck-face ck-face--${option}${valence === option ? ' is-picked' : ''}`}
                  onClick={() => {
                    setValence((current) => (current === option ? null : option))
                    setFeeling(null)
                  }}
                >
                  <ValenceFace valence={option} size={30} />
                </button>
              ))}
            </div>

            {/* "אני מרגיש/ה ___ היום" — the picked word, in the family's own
                color, inside a whole sentence the child is agreeing to. */}
            <Sentence feeling={feeling} t={t} />

            {valence && (
              <div className="ck-chips" role="group" aria-label={t(`checkin.valence.${valence}`)}>
                {VALENCE_FEELINGS[valence].map((word) => (
                  <button
                    key={word}
                    type="button"
                    className={`ck-chip${feeling === word ? ' is-picked' : ''}`}
                    aria-pressed={feeling === word}
                    onClick={() => setFeeling((current) => (current === word ? null : word))}
                  >
                    {t(`checkin.feeling.${word}`)}
                  </button>
                ))}
              </div>
            )}

            {valence && feeling && (
              <div className="ck-defPanel">
                <p className="ck-defPanel__text" dir="auto">
                  {t(`checkin.feeling.def.${feeling}`)}
                </p>
                <div className="ck-creature"><CheckinCreature valence={valence} feeling={feeling} /></div>
              </div>
            )}

            {sendFailed && (
              <p className="ck-error" role="status" dir="auto">{t('checkin.sendFailed')}</p>
            )}

            {valence && feeling && (
              <div className="ck-actions">
                <button type="button" className="ck-btn ck-btn--primary"
                        onClick={() => pickFeeling(valence, feeling)}>
                  {t('checkin.next')}
                </button>
              </div>
            )}
          </section>
        )}

        {step === 'closing' && valence && (
          <section className="ck-step ck-step--closing" aria-label={t('checkin.closing.heading')}>
            <div className="ck-creature"><CheckinCreature valence={valence} feeling={feeling} /></div>
            <p className="ck-closing" dir="auto">{closingLine || t('checkin.closing.heading')}</p>
            <div className="ck-actions">
              <button type="button" className="ck-btn ck-btn--primary" onClick={finish}>
                {t('checkin.done')}
              </button>
            </div>
          </section>
        )}
      </div>
    </Modal>
  )
}
