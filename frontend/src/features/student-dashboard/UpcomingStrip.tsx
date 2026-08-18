import { useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { navigate } from '../../app/router'
import { Icon } from '../../components/primitives'
import { useI18n } from '../../i18n/I18nProvider'
import type { CalendarItem } from '../../services/calendar'
import { formatCalendarDay, formatCalendarTime } from './calendarModel'

const ICONS = { task: 'backpack', goal: 'target', meeting: 'teacher', event: 'calendar', lesson: 'book' }

export function UpcomingStrip({ items }: { items: CalendarItem[] }) {
  const { t, language } = useI18n()
  const reduceMotion = useReducedMotion()
  const [isOpen, setIsOpen] = useState(false)
  const itemsRef = useRef<HTMLUListElement>(null)

  if (!items.length) return null

  const scrollItems = (forward: boolean) => {
    const track = itemsRef.current
    if (!track) return
    const rtl = document.documentElement.dir === 'rtl'
    const direction = (forward ? 1 : -1) * (rtl ? -1 : 1)
    track.scrollBy({ left: direction * track.clientWidth * 0.9, behavior: reduceMotion ? 'auto' : 'smooth' })
  }

  return (
    <motion.section
      className={`sd-upcoming${isOpen ? ' is-open' : ''}`}
      aria-label={t('sdash.upcoming.title')}
      initial={reduceMotion ? false : { opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
    >
      <AnimatePresence mode="wait" initial={false}>
        {!isOpen ? (
          <motion.button
            key="bubble"
            className="sd-upcoming__bubble"
            type="button"
            aria-expanded="false"
            aria-controls="sd-upcoming-items"
            onClick={() => setIsOpen(true)}
            initial={reduceMotion ? false : { opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={reduceMotion ? undefined : { opacity: 0, scale: 0.96 }}
          >
            <span>{t('sdash.upcoming.title')}</span>
            <Icon name="chevronLeft" size={17} aria-hidden="true" />
          </motion.button>
        ) : (
          <motion.div
            key="scroll"
            className="sd-upcoming__scrollStage"
            initial={reduceMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={reduceMotion ? undefined : { opacity: 0 }}
          >
            <div className="sd-upcoming__parchment" aria-hidden="true">
              <svg viewBox="0 0 1000 180" preserveAspectRatio="none">
                <rect className="sd-upcoming__paper" x="0" y="5" width="1000" height="170" rx="4" />
                <rect className="sd-upcoming__paperEdge" x="0" y="5" width="1000" height="4" />
                <rect className="sd-upcoming__paperEdge" x="0" y="171" width="1000" height="4" />
                <rect className="sd-upcoming__paperShade" x="0" y="5" width="8" height="170" />
                <rect className="sd-upcoming__paperShade" x="992" y="5" width="8" height="170" />
              </svg>
            </div>
            <button className="sd-upcoming__close" type="button" aria-label={t('sdash.upcoming.closeScroll')} onClick={() => setIsOpen(false)}>
              <Icon name="close" size={16} />
            </button>
            {items.length > 3 && (
              <button className="sd-upcoming__scrollArrow sd-upcoming__scrollArrow--back" type="button" aria-label={t('sdash.upcoming.previousItems')} onClick={() => scrollItems(false)}>
                <Icon name="chevronLeft" size={18} />
              </button>
            )}
            <ul id="sd-upcoming-items" className="sd-upcoming__items" ref={itemsRef}>
              {items.map((item) => (
                <li key={item.id} className={`sd-upcoming__item is-${item.kind} is-${item.status}`}>
                  <button type="button" onClick={() => navigate(item.action_route || '/student-dashboard/calendar')}>
                    <span className="sd-upcoming__icon" aria-hidden="true"><Icon name={ICONS[item.kind]} size={18} /></span>
                    <span className="sd-upcoming__copy">
                      <strong dir="auto">{item.title || t('sdash.calendar.untitled')}</strong>
                      <small className="sd-upcoming__when">
                        <Icon name="clock" size={12} />
                        {item.proximity ? t(`sdash.calendar.proximity.${item.proximity}`) : formatCalendarDay(item.start_at.slice(0, 10), language)}
                        {!item.all_day && ` · ${formatCalendarTime(item.start_at, language)}`}
                      </small>
                    </span>
                    <span className="sd-upcoming__open" aria-hidden="true"><Icon name="chevronLeft" size={15} /></span>
                  </button>
                </li>
              ))}
            </ul>
            {items.length > 3 && (
              <button className="sd-upcoming__scrollArrow sd-upcoming__scrollArrow--forward" type="button" aria-label={t('sdash.upcoming.nextItems')} onClick={() => scrollItems(true)}>
                <Icon name="chevronLeft" size={18} />
              </button>
            )}
            <span className="sd-upcoming__rod sd-upcoming__rod--right" aria-hidden="true" />
            <span className="sd-upcoming__rod sd-upcoming__rod--left" aria-hidden="true" />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  )
}