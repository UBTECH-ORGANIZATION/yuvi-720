/* Step one: what the conversation was.
 *
 * Two things: the write-up itself, and — folded away — the note that stays on
 * the teacher's side. What is worth RAISING used to sit here as a third,
 * collapsed section; it moved to the composer's context column, where it is
 * visible for all three steps instead of only this one and does not compete
 * with the textarea for the middle of the screen.
 *
 * The write-up is a plain textarea with an optional helper, never a form of
 * fields. A conversation with a child does not decompose into inputs, and the
 * moment it does the record becomes a checklist somebody filled in.
 */

import { useState } from 'react'
import { Icon } from '../../../../components/primitives'
import { useI18n } from '../../../../i18n/I18nProvider'
import { assistTeacherMentoring } from '../../../../services/teacher'

interface Props {
  learnerId: string
  notes: string
  teacherOnlyNote: string
  qa: { q: string; a: string }[]
  onNotes: (value: string) => void
  onTeacherOnlyNote: (value: string) => void
  onQa: (value: { q: string; a: string }[]) => void
}

/* Matches the server's clamp in mentoring.py (#503) — the two must agree or
   the field silently loses the tail on save. */
const NOTES_MAX = 4000

/** The counter appears only when it starts to matter. A standing "12/4000"
 *  under an empty field is chrome; near the ceiling it is the one fact the
 *  teacher needs before the field stops taking letters. */
function NotesCounter({ value }: { value: string }) {
  if (value.length < NOTES_MAX * 0.85) return null
  return (
    <span className="tch-step__counter" dir="ltr" aria-live="polite">
      {value.length}/{NOTES_MAX}
    </span>
  )
}

export function DiscussedStep({
  learnerId, notes, teacherOnlyNote, qa, onNotes, onTeacherOnlyNote, onQa,
}: Props) {
  const { t, language } = useI18n()
  const [helperOpen, setHelperOpen] = useState(false)
  const [question, setQuestion] = useState('')
  const [options, setOptions] = useState<string[]>([])
  const [phase, setPhase] = useState<'asking' | 'ready'>('asking')
  const [busy, setBusy] = useState(false)
  const [ownMode, setOwnMode] = useState(false)
  const [own, setOwn] = useState('')

  /* One turn: send the whole thread, take back a rewritten draft. The draft
     REPLACES the textarea rather than appending to it — the model is rebuilding
     the write-up from the answers, not chatting. */
  const ask = async (nextQa: { q: string; a: string }[], more = false) => {
    setBusy(true)
    try {
      const result = await assistTeacherMentoring(learnerId, {
        language, qa: nextQa, notes, more,
      })
      if (nextQa.length > 0 && result.draft?.trim()) onNotes(result.draft)
      setQuestion(result.question || '')
      setOptions(Array.isArray(result.options) ? result.options : [])
      setPhase(result.phase === 'ready' ? 'ready' : 'asking')
    } catch {
      // The helper is optional by construction; a failure closes it rather
      // than blocking the teacher from typing their own write-up.
      setHelperOpen(false)
    } finally {
      setBusy(false)
    }
  }

  const answer = (value: string) => {
    const next = [...qa, { q: question, a: value }]
    onQa(next)
    setOwnMode(false)
    setOwn('')
    void ask(next)
  }

  const openHelper = () => {
    setHelperOpen(true)
    if (!question) void ask(qa)
  }

  return (
    <div className="tch-step">
      <label className="tch-step__field">
        <span>{t('tch.mentoring.notes.label')}</span>
        <textarea
          className="sp-input tch-step__notes"
          rows={6}
          dir="auto"
          value={notes}
          maxLength={NOTES_MAX}
          placeholder={t('tch.mentoring.notes.placeholder')}
          onChange={(event) => onNotes(event.target.value)}
        />
        <NotesCounter value={notes} />
      </label>

      {!helperOpen ? (
        <button type="button" className="sp-btn sp-btn--sm sp-btn--ghost" onClick={openHelper}>
          <Icon name="wand" size={15} aria-hidden />
          {t('tch.mentoring.guide.open')}
        </button>
      ) : (
        <div className="tch-guide">
          <p className="tch-guide__title">
            <Icon name="wand" size={14} aria-hidden />
            {t('tch.mentoring.guide.title')}
          </p>

          {busy ? (
            <p className="tch-guide__thinking">{t('tch.mentoring.guide.thinking')}</p>
          ) : phase === 'ready' ? (
            <div className="tch-guide__chips">
              <button type="button" className="tch-chip" onClick={() => setHelperOpen(false)}>
                {t('tch.mentoring.guide.finish')}
              </button>
              <button type="button" className="tch-chip" onClick={() => void ask(qa, true)}>
                {t('tch.mentoring.guide.more')}
              </button>
            </div>
          ) : (
            <>
              {question ? <p className="tch-guide__q" dir="auto">{question}</p> : null}
              {ownMode ? (
                <div className="tch-guide__own">
                  <input
                    className="sp-input" dir="auto" maxLength={300} autoFocus
                    value={own}
                    onChange={(event) => setOwn(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && own.trim()) answer(own.trim())
                    }}
                  />
                  <button type="button" className="sp-btn sp-btn--sm"
                          disabled={!own.trim()} onClick={() => answer(own.trim())}>
                    {t('tch.mentoring.guide.send')}
                  </button>
                </div>
              ) : (
                <div className="tch-guide__chips">
                  {options.map((option, index) => (
                    <button key={index} type="button" className="tch-chip" dir="auto"
                            onClick={() => answer(option)}>
                      {option}
                    </button>
                  ))}
                  {/* Always available, never only the chips: the chips are
                      guesses at what happened, and the teacher was there. */}
                  <button type="button" className="tch-chip tch-chip--own"
                          onClick={() => setOwnMode(true)}>
                    <Icon name="message" size={13} aria-hidden />
                    {t('tch.mentoring.guide.own')}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Folded away, and labelled for what it is. The child can read the
          write-up above; this is the part they cannot. */}
      <details className="tch-step__aside">
        <summary>{t('tch.mentoring.teacherOnly.label')}</summary>
        <p className="tch-step__hint" dir="auto">{t('tch.mentoring.teacherOnly.hint')}</p>
        <textarea
          className="sp-input" rows={3} dir="auto"
          value={teacherOnlyNote}
          maxLength={NOTES_MAX}
          onChange={(event) => onTeacherOnlyNote(event.target.value)}
        />
        <NotesCounter value={teacherOnlyNote} />
      </details>
    </div>
  )
}
