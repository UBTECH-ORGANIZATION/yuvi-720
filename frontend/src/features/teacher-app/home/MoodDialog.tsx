/* Who is behind each feeling (#505) — the click the mood card always invited.
 *
 * Two tabs. "לפי תחושה": the chart IS the control — one proportional bar whose
 * colored segments are the family buttons themselves (face, name, how many
 * children), so where a family sits on the bar is where you press to open it.
 * It opens on the hardest family present, because the teacher who came here
 * came for the child having a hard week, not for the twelve who feel great.
 * "מה נכתב": one card per child who wrote, latest writer first; a card opens
 * that child's own notes with a way back — each quote with the question it
 * answered (PII-stripped at write).
 *
 * Framing rules carried over from the check-in itself:
 *   - a feeling opens a conversation, not an alarm — the note says so, and no
 *     family here is styled as a warning state: the five hues are the ring's;
 *   - never a ranking (C5): children within a family are alphabetical, and a
 *     name is a door to the child's own page, where their strip shows the run
 *     of days;
 *   - the exact feeling word rides beside the name — "קשה" is a family, and
 *     the child said something more specific than that.
 */

import { useState } from 'react'
import { navigate } from '../../../app/router'
import { Icon } from '../../../components/primitives'
import { Modal } from '../../../components/primitives/Modal'
import { useI18n } from '../../../i18n/I18nProvider'
import { ValenceFace } from '../../checkin/ValenceFaces'
import {
  VALENCES, type ClassMood, type MoodNote, type MoodStudent, type Valence,
} from '../../../services/teacher'

/* Hardest first — the reading order of a teacher triaging, not of a scale. */
const HARD_FIRST = [...VALENCES].reverse()

/* dd/mm, the same shorthand the class book uses — a date here is a hint, not
   a record. */
function dayLabel(date: string | null): string | null {
  if (!date || date.length < 10) return null
  return `${date.slice(8, 10)}/${date.slice(5, 7)}`
}

function openStudent(learnerId: string) {
  navigate(`/teacher/student/${encodeURIComponent(learnerId)}`)
}

export function MoodDialog({ mood, nameOf, open, onClose }: {
  mood: ClassMood
  nameOf: (learnerId: string) => string
  open: boolean
  onClose: () => void
}) {
  const { t } = useI18n()
  const [tab, setTab] = useState<'families' | 'notes'>('families')
  const notes = mood.notes ?? []

  return (
    <Modal open={open} onClose={onClose} titleId="tch-mood-dialog" className="tch-moodDlg">
      <header className="tch-moodDlg__head">
        <h2 id="tch-mood-dialog">{t('tch.pulse.mood')}</h2>
        <button
          type="button"
          className="sp-btn sp-btn--ghost sp-btn--sm"
          onClick={onClose}
          aria-label={t('tch.band.dialogClose')}
        >
          <Icon name="close" size={16} aria-hidden />
        </button>
      </header>
      <p className="tch-moodDlg__note">{t('tch.mood.dialog.note')}</p>

      <div className="tch-moodDlg__tabs" role="tablist">
        <button
          type="button" role="tab" aria-selected={tab === 'families'}
          className={`tch-moodDlg__tab${tab === 'families' ? ' is-active' : ''}`}
          onClick={() => setTab('families')}
        >
          {t('tch.mood.dialog.tab.families')}
        </button>
        <button
          type="button" role="tab" aria-selected={tab === 'notes'}
          className={`tch-moodDlg__tab${tab === 'notes' ? ' is-active' : ''}`}
          onClick={() => setTab('notes')}
        >
          {t('tch.mood.dialog.tab.notes')}
          <span className="tch-moodDlg__tabCount">{notes.length}</span>
        </button>
      </div>

      {tab === 'families'
        ? <FamiliesTab mood={mood} nameOf={nameOf} />
        : <NotesTab notes={notes} nameOf={nameOf} />}
    </Modal>
  )
}

function FamiliesTab({ mood, nameOf }: {
  mood: ClassMood
  nameOf: (learnerId: string) => string
}) {
  const { t } = useI18n()
  const childrenOf = (valence: Valence) => mood.students?.[valence] ?? []
  /* In the check-in's canonical best-to-hardest order, like the ring; sized by
     CHILDREN, not answers — the whole dialog is about who, and two different
     numbers on one bar was the confusion this replaces. */
  const present = VALENCES.filter((valence) => childrenOf(valence).length > 0)
  /* Opens on the hardest family present — the visit's likely reason — but the
     choice is the teacher's from there. */
  const [picked, setPicked] = useState<Valence | null>(null)
  const selected = picked && present.includes(picked)
    ? picked
    : HARD_FIRST.find((valence) => present.includes(valence)) ?? null

  return (
    <div className="tch-moodDlg__families">
      {/* the chart IS the control: each segment is its family's button, its
          width how many children, its spot on the bar where you press */}
      <div className="tch-moodDlg__bar" role="group" aria-label={t('tch.mood.dialog.tab.families')}>
        {present.map((valence) => (
          <button
            key={valence}
            type="button"
            className={`tch-moodDlg__seg is-${valence}${selected === valence ? ' is-active' : ''}`}
            style={{ flexGrow: childrenOf(valence).length }}
            aria-pressed={selected === valence}
            onClick={() => setPicked(valence)}
          >
            <ValenceFace valence={valence} size={20} />
            <span className="tch-moodDlg__segLabel">{t(`tch.mood.valence.${valence}`)}</span>
            <span className="tch-moodDlg__segCount">{childrenOf(valence).length}</span>
          </button>
        ))}
      </div>

      {selected ? <StudentList students={childrenOf(selected)} nameOf={nameOf} /> : null}
    </div>
  )
}

function StudentList({ students, nameOf }: {
  students: MoodStudent[]
  nameOf: (learnerId: string) => string
}) {
  const { t } = useI18n()
  /* Alphabetical on purpose — any other order would rank the children of one
     feeling against each other, which is the one thing this list must not do. */
  const rows = [...students]
    .map((student) => ({ ...student, name: nameOf(student.learner_id) }))
    .sort((a, b) => a.name.localeCompare(b.name))

  return (
    <ul className="tch-moodDlg__list">
      {rows.map((row) => {
        const when = dayLabel(row.date)
        return (
          <li key={row.learner_id}>
            <button
              type="button"
              className="tch-moodDlg__student"
              onClick={() => openStudent(row.learner_id)}
            >
              <span className="tch-moodDlg__name" dir="auto">{row.name}</span>
              <span className="tch-moodDlg__said">
                {row.feeling ? t(`checkin.feeling.${row.feeling}`) : null}
                {row.feeling && when ? ' · ' : null}
                {when ? <span dir="ltr">{when}</span> : null}
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

function NotesTab({ notes, nameOf }: {
  notes: MoodNote[]
  nameOf: (learnerId: string) => string
}) {
  const { t } = useI18n()
  const [who, setWho] = useState<string | null>(null)
  if (!notes.length) {
    return <p className="tch-moodDlg__empty">{t('tch.mood.dialog.notesEmpty')}</p>
  }

  /* One card per child, latest writer first — `notes` arrives newest-first,
     so first appearance IS that order. */
  const writers: { learner_id: string; latest: MoodNote; count: number }[] = []
  for (const note of notes) {
    const held = writers.find((writer) => writer.learner_id === note.learner_id)
    if (held) held.count += 1
    else writers.push({ learner_id: note.learner_id, latest: note, count: 1 })
  }

  if (who) {
    const own = notes.filter((note) => note.learner_id === who)
    return (
      <div className="tch-moodDlg__oneWriter">
        <div className="tch-moodDlg__writerBar">
          <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm" onClick={() => setWho(null)}>
            <Icon name="back" size={14} aria-hidden />
            {t('tch.mood.dialog.back')}
          </button>
          <span className="tch-moodDlg__writerName" dir="auto">{nameOf(who)}</span>
          <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm" onClick={() => openStudent(who)}>
            {t('tch.mood.dialog.profile')}
          </button>
        </div>
        <ul className="tch-moodDlg__notes">
          {own.map((note) => {
            const when = dayLabel(note.date)
            return (
              <li key={`${note.learner_id}:${note.date}`} className="tch-moodDlg__noteCard">
                <span className="tch-moodDlg__noteWhen">
                  {note.valence ? (
                    <span className={`tch-moodDlg__face is-${note.valence}`}>
                      <ValenceFace valence={note.valence} size={18} />
                    </span>
                  ) : null}
                  {note.feeling ? t(`checkin.feeling.${note.feeling}`) : null}
                  {note.feeling && when ? ' · ' : null}
                  {when ? <span dir="ltr">{when}</span> : null}
                </span>
                {note.question ? (
                  <p className="tch-moodDlg__noteQ" dir="auto">{note.question}</p>
                ) : null}
                <p className="tch-moodDlg__noteText" dir="auto">{note.text}</p>
              </li>
            )
          })}
        </ul>
      </div>
    )
  }

  return (
    <ul className="tch-moodDlg__writers">
      {writers.map((writer) => {
        const when = dayLabel(writer.latest.date)
        return (
          <li key={writer.learner_id}>
            <button
              type="button"
              className="tch-moodDlg__writer"
              onClick={() => setWho(writer.learner_id)}
            >
              {writer.latest.valence ? (
                <span className={`tch-moodDlg__face is-${writer.latest.valence}`}>
                  <ValenceFace valence={writer.latest.valence} size={22} />
                </span>
              ) : null}
              <span className="tch-moodDlg__name" dir="auto">{nameOf(writer.learner_id)}</span>
              <span className="tch-moodDlg__said">
                {writer.latest.feeling ? t(`checkin.feeling.${writer.latest.feeling}`) : null}
                {writer.latest.feeling && when ? ' · ' : null}
                {when ? <span dir="ltr">{when}</span> : null}
              </span>
              {writer.count > 1 ? (
                <span className="tch-moodDlg__count">{writer.count}</span>
              ) : null}
            </button>
          </li>
        )
      })}
    </ul>
  )
}
