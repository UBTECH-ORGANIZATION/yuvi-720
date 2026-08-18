/* Draws a validated agenda spec: one card per day, one row per thing on it.
 *
 * Nothing here comes from the model except the titles. Every day heading is
 * FORMATTED from the ISO date the spec carries, in the reader's own locale —
 * so a Hebrew reader gets "יום חמישי, 20 באוגוסט" and an English one gets
 * "Thursday, 20 August", from the same payload and with no chance of the
 * model naming the wrong weekday.
 *
 * The icons are the calendar screen's, deliberately: a test is a document
 * here because it is a document there, and a teacher who has read the board
 * should not have to learn a second visual vocabulary to read the chat.
 */

import { Icon } from '../primitives'
import './rich-text.css'
import { useI18n } from '../../i18n/I18nProvider'
import type { AgendaSpec, AgendaKind } from './agenda.ts'
import type { InlineRenderer } from './RichText'

/** Same map the calendar page draws from. */
const ICONS: Record<AgendaKind, string> = {
  test: 'document', lesson: 'book', reminder: 'bell', event: 'calendar',
  task: 'backpack', goal: 'target', meeting: 'teacher',
}

const localeOf = (language: string) =>
  language === 'he' ? 'he-IL' : language === 'ar' ? 'ar' : 'en-GB'

/** A `YYYY-MM-DD` read as UTC noon.
 *
 *  Midnight is what makes a calendar lose a day: parsed in a timezone behind
 *  UTC it lands on the previous date, so the heading disagrees with the data.
 *  Noon is far enough from both edges that no offset can shift it. */
function anchor(day: string): Date {
  const [year, month, date] = day.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, date, 12))
}

function todayInSchool(): string {
  // The reader's own today. Good enough for "is this today" — the school's
  // zone is Israel and the reader is in it; being an hour out at midnight
  // costs a highlight, never a fact.
  const now = new Date()
  return [now.getFullYear(),
          String(now.getMonth() + 1).padStart(2, '0'),
          String(now.getDate()).padStart(2, '0')].join('-')
}

export function AgendaView({ spec, inline }: { spec: AgendaSpec; inline: InlineRenderer }) {
  const { t, language } = useI18n()
  const locale = localeOf(language)
  const heading = new Intl.DateTimeFormat(locale, {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC',
  })
  const today = todayInSchool()

  return (
    <div className="sp-md-agenda" dir="auto">
      {spec.title ? <p className="sp-md-agenda__title">{spec.title}</p> : null}
      {spec.days.map((day) => (
        <section key={day.date}
                 className={`sp-md-agenda__day${day.date === today ? ' is-today' : ''}`}>
          <h4 className="sp-md-agenda__date">
            {heading.format(anchor(day.date))}
            {day.date === today
              ? <em className="sp-md-agenda__today">{t('tch.calendar.today')}</em>
              : null}
          </h4>
          <ul className="sp-md-agenda__items">
            {day.items.map((item, index) => (
              <li key={index} className={`sp-md-agenda__item sp-md-agenda__item--${item.kind}`}>
                <span className="sp-md-agenda__icon" aria-hidden="true">
                  <Icon name={ICONS[item.kind]} size={13} />
                </span>
                <span className="sp-md-agenda__body">
                  <span className="sp-md-agenda__what" dir="auto">{inline(item.title)}</span>
                  {/* Who it is for, when it is for someone in particular — a
                      "מפגש" with no name does not say with whom. Rendered
                      through the inline layer so a {{student:…}} reference
                      becomes the same chip it is anywhere else. */}
                  {item.who
                    ? <span className="sp-md-agenda__who" dir="auto">{inline(item.who)}</span>
                    : null}
                </span>
                {item.time
                  ? <time className="sp-md-agenda__time">{item.time}</time>
                  : <span className="sp-md-agenda__allDay">{t('tch.calendar.allDay')}</span>}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
