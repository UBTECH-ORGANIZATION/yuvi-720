/* The weekly spine's manager (#242): rules in, the calendar shows expansions.
 *
 * One job: the week's rules. A slot is a RULE (subject, day, hours, who,
 * until-when), never a list of dated events, so ending one is setting
 * `valid_to`, not deleting history.
 *
 * Days off deliberately have NO editor here (by request): the national
 * calendar is seeded as data at boot and holidays simply appear on the
 * calendar and switch lessons off — nothing for a teacher to type.
 *
 * Per-occurrence changes (cancel one week, move one lesson) do NOT live
 * here — they belong to the occurrence, on the calendar item itself
 * (`LessonDetails`), which is where a teacher is looking when a week breaks.
 */

import { useCallback, useEffect, useState } from 'react'
import { Icon } from '../../../components/primitives'
import { Modal } from '../../../components/primitives/Modal'
import { useI18n } from '../../../i18n/I18nProvider'
import {
  clearLessonException, createTimetableSlot, deleteTimetableSlot,
  getGroupTimetable, setLessonException, updateTimetableSlot,
  type Subgroup, type TimetableSlot, type TimetableSlotDraft,
} from '../../../services/teacher'

/** School days shown in the week editor: Sunday through Friday. */
const WEEKDAYS = [0, 1, 2, 3, 4, 5]

/** 2023-01-01 was a Sunday — an anchor for locale weekday names. */
function weekdayName(weekday: number, language: string): string {
  const date = new Date(Date.UTC(2023, 0, 1 + weekday, 12))
  const locale = language === 'he' ? 'he-IL' : language === 'ar' ? 'ar' : 'en-GB'
  return new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' }).format(date)
}

const today = () => new Date().toISOString().slice(0, 10)

type Draft = TimetableSlotDraft & { _id?: string }

const BLANK: Draft = {
  subject: '', weekday: 0, start_time: '08:00', end_time: '08:45',
  valid_from: '', valid_to: null, subgroup_id: null, room: null,
}

export function TimetableManager({ groupId, subgroups, onClose, onChanged }: {
  groupId: string
  subgroups: Subgroup[]
  onClose: () => void
  /** Rules changed — the calendar behind the dialog re-expands. */
  onChanged: () => void
}) {
  const { t, language } = useI18n()
  const [slots, setSlots] = useState<TimetableSlot[] | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    getGroupTimetable(groupId)
      .then((result) => setSlots(result.slots))
      .catch(() => setSlots([]))
  }, [groupId])
  useEffect(load, [load])

  const subgroupName = (id: string | null) =>
    id ? subgroups.find((row) => row.id === id)?.name ?? id : null

  const submit = async () => {
    if (!draft) return
    setBusy(true); setError(null)
    try {
      if (draft._id) await updateTimetableSlot(draft._id, draft)
      else await createTimetableSlot(groupId, draft)
      setDraft(null); load(); onChanged()
    } catch {
      setError(t('tch.timetable.saveFailed'))
    } finally {
      setBusy(false)
    }
  }

  const retire = async (slot: TimetableSlot) => {
    setBusy(true)
    try {
      await deleteTimetableSlot(slot._id)
      load(); onChanged()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} titleId="tch-timetable" className="tch-tt">
      <header className="tch-tt__head">
        <h2 id="tch-timetable">{t('tch.timetable.title')}</h2>
        <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm"
                onClick={onClose} aria-label={t('tch.band.dialogClose')}>
          <Icon name="close" size={16} aria-hidden />
        </button>
      </header>
      <p className="tch-tt__note">{t('tch.timetable.note')}</p>

      {slots === null ? <p className="tch-tt__loading">…</p> : (
        <div className="tch-tt__week">
          {WEEKDAYS.map((weekday) => {
            const rows = slots.filter((slot) => slot.weekday === weekday)
            return (
              <section key={weekday} className="tch-tt__day">
                <h3>{weekdayName(weekday, language)}</h3>
                {rows.length === 0 ? (
                  <p className="tch-tt__empty">{t('tch.timetable.emptyDay')}</p>
                ) : (
                  <ul className="tch-tt__slots">
                    {rows.map((slot) => (
                      <li key={slot._id} className="tch-tt__slot">
                        <span className="tch-tt__hours" dir="ltr">
                          {slot.start_time}–{slot.end_time}
                        </span>
                        <span className="tch-tt__subject" dir="auto">
                          {slot.subject}
                          {slot.room ? ` · ${slot.room}` : ''}
                        </span>
                        {slot.subgroup_id ? (
                          <span className="tch-tt__who" dir="auto">
                            {subgroupName(slot.subgroup_id)}
                          </span>
                        ) : null}
                        {slot.valid_to ? (
                          <span className="tch-tt__until" dir="auto">
                            {t('tch.timetable.until', { date: slot.valid_to })}
                          </span>
                        ) : null}
                        <span className="tch-tt__slotActions">
                          <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm"
                                  onClick={() => setDraft({
                                    _id: slot._id, subject: slot.subject,
                                    subject_key: slot.subject_key,
                                    weekday: slot.weekday,
                                    start_time: slot.start_time, end_time: slot.end_time,
                                    valid_from: slot.valid_from, valid_to: slot.valid_to,
                                    subgroup_id: slot.subgroup_id, room: slot.room,
                                  })}>
                            {t('tch.timetable.edit')}
                          </button>
                          <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm"
                                  disabled={busy} onClick={() => void retire(slot)}>
                            {t('tch.timetable.remove')}
                          </button>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )
          })}
        </div>
      )}

      {draft ? (
        <form className="tch-tt__form" onSubmit={(event) => { event.preventDefault(); void submit() }}>
          <h3>{draft._id ? t('tch.timetable.edit') : t('tch.timetable.addSlot')}</h3>
          <div className="tch-tt__fields">
            <label>
              <span>{t('tch.timetable.subject')}</span>
              <input className="sp-input" required value={draft.subject} dir="auto"
                     onChange={(event) => setDraft({ ...draft, subject: event.target.value })} />
            </label>
            <label>
              <span>{t('tch.timetable.day')}</span>
              <select className="sp-input" value={draft.weekday}
                      onChange={(event) => setDraft({ ...draft, weekday: Number(event.target.value) })}>
                {WEEKDAYS.map((weekday) => (
                  <option key={weekday} value={weekday}>{weekdayName(weekday, language)}</option>
                ))}
              </select>
            </label>
            <label>
              <span>{t('tch.timetable.start')}</span>
              <input className="sp-input" type="time" required value={draft.start_time}
                     onChange={(event) => setDraft({ ...draft, start_time: event.target.value })} />
            </label>
            <label>
              <span>{t('tch.timetable.end')}</span>
              <input className="sp-input" type="time" required value={draft.end_time}
                     onChange={(event) => setDraft({ ...draft, end_time: event.target.value })} />
            </label>
            <label>
              <span>{t('tch.timetable.who')}</span>
              <select className="sp-input" value={draft.subgroup_id ?? ''}
                      onChange={(event) => setDraft({ ...draft, subgroup_id: event.target.value || null })}>
                <option value="">{t('tch.timetable.wholeClass')}</option>
                {subgroups.map((row) => (
                  <option key={row.id} value={row.id}>{row.name}</option>
                ))}
              </select>
            </label>
            <label>
              <span>{t('tch.timetable.room')}</span>
              <input className="sp-input" value={draft.room ?? ''} dir="auto"
                     onChange={(event) => setDraft({ ...draft, room: event.target.value || null })} />
            </label>
            <label>
              <span>{t('tch.timetable.validFrom')}</span>
              <input className="sp-input" type="date" required value={draft.valid_from}
                     onChange={(event) => setDraft({ ...draft, valid_from: event.target.value })} />
            </label>
            <label>
              <span>{t('tch.timetable.validTo')}</span>
              <input className="sp-input" type="date" value={draft.valid_to ?? ''}
                     onChange={(event) => setDraft({ ...draft, valid_to: event.target.value || null })} />
            </label>
          </div>
          {error ? <p className="tch-tt__error">{error}</p> : null}
          <div className="tch-tt__formActions">
            <button type="submit" className="sp-btn sp-btn--sm" disabled={busy}>
              {t('tch.timetable.save')}
            </button>
            <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm"
                    onClick={() => setDraft(null)}>
              {t('tch.timetable.cancel')}
            </button>
          </div>
        </form>
      ) : (
        <button type="button" className="sp-btn sp-btn--sm tch-tt__add"
                onClick={() => setDraft({ ...BLANK, valid_from: today() })}>
          <Icon name="plus" size={14} aria-hidden />
          {t('tch.timetable.addSlot')}
        </button>
      )}
    </Modal>
  )
}

/* One occurrence of a rule, opened from its calendar item. The actions here
 * are the exceptions: cancel THIS week's lesson, move it, or put it back —
 * the rule underneath never changes from this dialog. The occurrence's
 * source date is the id's own suffix (`slot:date`), which is what keeps a
 * moved lesson's actions pointed at the week it came from. */
export function LessonDetails({ item, zone, onClose, onChanged, onManage }: {
  item: { id: string; title: string; day: string; at: string | null
          meta: Record<string, unknown> }
  zone: string
  onClose: () => void
  onChanged: () => void
  onManage: () => void
}) {
  const { t } = useI18n()
  const [busy, setBusy] = useState(false)
  const [moving, setMoving] = useState(false)
  const [moveDate, setMoveDate] = useState(item.day)
  const slotId = String(item.meta.slot_id ?? item.id.split(':')[0])
  const sourceDay = item.id.slice(slotId.length + 1)
  const cancelled = item.meta.status === 'cancelled'
  const moved = !cancelled && sourceDay !== item.day

  const act = async (run: () => Promise<unknown>) => {
    setBusy(true)
    try { await run(); onChanged(); onClose() } finally { setBusy(false) }
  }

  const when = (value: unknown) => {
    try {
      return new Intl.DateTimeFormat('en-GB', {
        hour: '2-digit', minute: '2-digit', hour12: false, timeZone: zone,
      }).format(new Date(String(value)))
    } catch { return '' }
  }

  return (
    <Modal open onClose={onClose} titleId="tch-lesson" className="tch-tt__lesson">
      <header className="tch-tt__head">
        <h2 id="tch-lesson" dir="auto">{item.title}</h2>
        <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm"
                onClick={onClose} aria-label={t('tch.band.dialogClose')}>
          <Icon name="close" size={16} aria-hidden />
        </button>
      </header>
      <p className="tch-tt__lessonWhen" dir="auto">
        <span dir="ltr">{item.day}</span>
        {' · '}
        <span dir="ltr">{when(item.at)}–{when(item.meta.end_at)}</span>
        {item.meta.room ? ` · ${String(item.meta.room)}` : ''}
      </p>
      {cancelled ? (
        <p className="tch-tt__cancelledNote">{t('tch.timetable.cancelledNote')}</p>
      ) : null}
      {moved ? (
        <p className="tch-tt__movedNote">
          {t('tch.timetable.movedNote', { date: sourceDay })}
        </p>
      ) : null}

      <div className="tch-tt__lessonActions">
        {cancelled || moved ? (
          <button type="button" className="sp-btn sp-btn--sm" disabled={busy}
                  onClick={() => void act(() => clearLessonException(slotId, sourceDay))}>
            {t('tch.timetable.restore')}
          </button>
        ) : (
          <>
            <button type="button" className="sp-btn sp-btn--sm" disabled={busy}
                    onClick={() => void act(() =>
                      setLessonException(slotId, sourceDay, { kind: 'cancelled' }))}>
              {t('tch.timetable.cancelLesson')}
            </button>
            <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm"
                    onClick={() => setMoving((value) => !value)}>
              {t('tch.timetable.move')}
            </button>
          </>
        )}
        <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm" onClick={onManage}>
          {t('tch.timetable.manage')}
        </button>
      </div>

      {moving ? (
        <div className="tch-tt__moveForm">
          <label>
            <span>{t('tch.timetable.moveTo')}</span>
            <input className="sp-input" type="date" value={moveDate}
                   onChange={(event) => setMoveDate(event.target.value)} />
          </label>
          <button type="button" className="sp-btn sp-btn--sm" disabled={busy || !moveDate}
                  onClick={() => void act(() =>
                    setLessonException(slotId, sourceDay, { kind: 'moved', date: moveDate }))}>
            {t('tch.timetable.save')}
          </button>
        </div>
      ) : null}
    </Modal>
  )
}
