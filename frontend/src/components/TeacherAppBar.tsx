/* Teacher chrome (F6). Mirrors LearnerAppBar so the two lanes feel like one product.
 *
 * Few nav items on purpose. Alerts live in the Home inbox, the assistant is a
 * dock, and live presence is the top of Home. A nav that lists every capability
 * is a nav a teacher has to read.
 *
 * Scope DOES live here, and that reverses an earlier decision recorded in this
 * file: the class switcher was moved out of the chrome and onto the Home page
 * title, on the reasoning that switching class is a dashboard act. It is not.
 * A teacher reads the roster, the tasks and the calendar of a class too, and
 * with the picker on Home the only way to change class from any of them was to
 * go back to Home first — which is also why the subject filter, whose plumbing
 * has existed for months, never got a control at all and stayed permanently
 * null. One control in the chrome, and the whole portal follows it.
 */

import { useEffect, useRef, useState } from 'react'

import { navigate, useRoute } from '../app/router'
import { useDismiss } from '../features/teacher-app/shared/useDismiss'
import { useI18n } from '../i18n/I18nProvider'
import { getPendingGoalCount } from '../services/teacher'
import { getTeacherUnread } from '../services/directMessages'
import { AppBar } from './AppBar'
import { NotificationBell } from './NotificationBell'
import { TourButton } from './tour/TourButton'
import { Icon } from './primitives'
import { ScopeControl } from './scope/ScopeControl'
import './teacher-app-bar.css'

type TeacherSection =
  'home' | 'students' | 'learnings' | 'tasks' | 'goals' | 'calendar' | 'messages'

/* Order matters: every branch must be tested before the bare `/teacher`
   catch-all, or a new section highlights "home" while the teacher stands on
   it. That is what `/teacher/tasks` did — the route existed, the screen
   worked, and nothing in the nav either led to it or lit up on it. */
function sectionForRoute(pathname: string): TeacherSection | null {
  if (pathname.startsWith('/teacher/goals')) return 'goals'
  if (pathname.startsWith('/teacher/calendar')) return 'calendar'
  if (pathname.startsWith('/teacher/learnings')) return 'learnings'
  if (pathname.startsWith('/teacher/tasks')) return 'tasks'
  if (pathname.startsWith('/teacher/messages')) return 'messages'
  if (pathname.startsWith('/teacher/students') || pathname.startsWith('/teacher/student/')) {
    return 'students'
  }
  if (pathname.startsWith('/teacher')) return 'home'
  return null
}

/** The screens that live behind "עוד".
 *
 *  Chosen by how a teacher arrives at them, not by how important they are: the
 *  four left in the bar are where the day is spent, these three are opened
 *  because something specific needs doing. */
const FOLDED: { id: TeacherSection; path: string; icon: string; labelKey: string }[] = [
  { id: 'tasks', path: '/teacher/tasks', icon: 'backpack', labelKey: 'tch.nav.tasks' },
  { id: 'calendar', path: '/teacher/calendar', icon: 'calendar', labelKey: 'tch.nav.calendar' },
  { id: 'messages', path: '/teacher/messages', icon: 'message', labelKey: 'tch.nav.messages' },
]

/** Goals waiting for sign-off, on every screen.
 *
 * The number lives here rather than on the mentoring page because a teacher
 * should not have to visit a screen to discover it had something for them.
 * `TeacherAppBar` sits ABOVE the pathname-keyed route div in `App.tsx`, so it
 * survives navigation and this fetch happens once per session rather than once
 * per page — the interval is what keeps it honest after that, and it re-reads
 * on arriving at the mentoring screen, which is where the count changes.
 */
const PENDING_REFRESH_MS = 120_000

function usePendingGoals(pathname: string) {
  const [count, setCount] = useState(0)
  const onMentoring = pathname.startsWith('/teacher/goals')

  useEffect(() => {
    let active = true
    const read = () => {
      getPendingGoalCount()
        .then((result) => { if (active) setCount(result.count ?? 0) })
        // A badge that cannot be counted shows nothing. Guessing a number here
        // would be worse than the teacher not knowing.
        .catch(() => { if (active) setCount(0) })
    }
    read()
    const timer = window.setInterval(read, PENDING_REFRESH_MS)
    return () => { active = false; window.clearInterval(timer) }
    // Re-read on entering or leaving the screen that changes it: approving a
    // goal there must clear the badge without waiting two minutes.
  }, [onMentoring])

  return count
}

/** Messages waiting to be read, same contract as the goals badge: counted
 *  where the teacher already is, re-read on entering/leaving the screen that
 *  changes it, and absent rather than guessed when it cannot be counted. */
function useUnreadMessages(pathname: string) {
  const [count, setCount] = useState(0)
  const onMessages = pathname.startsWith('/teacher/messages')

  useEffect(() => {
    let active = true
    const read = () => {
      getTeacherUnread()
        .then((result) => { if (active) setCount(result.total ?? 0) })
        .catch(() => { if (active) setCount(0) })
    }
    read()
    const timer = window.setInterval(read, PENDING_REFRESH_MS)
    return () => { active = false; window.clearInterval(timer) }
  }, [onMessages])

  return count
}

function NavBadge({ count, label }: { count: number; label: string }) {
  if (count <= 0) return null
  return (
    <span className="teacher-app-nav__badge" aria-label={label}>
      {count > 99 ? '99+' : count}
    </span>
  )
}

export function TeacherAppBar() {
  const pathname = useRoute()
  const { t } = useI18n()
  const active = sectionForRoute(pathname)
  const pending = usePendingGoals(pathname)
  const unreadMessages = useUnreadMessages(pathname)

  const [moreOpen, setMoreOpen] = useState(false)
  const moreRef = useRef<HTMLDivElement>(null)
  useDismiss(moreRef, moreOpen, () => setMoreOpen(false))
  const moreActive = FOLDED.some((entry) => entry.id === active)
  /* Navigating from anywhere else — a link on the page, the assistant, the
     back button — must not leave the fold hanging open over the screen it just
     moved to. */
  useEffect(() => { setMoreOpen(false) }, [pathname])

  const navigation = (
    <nav className="teacher-app-nav" aria-label={t('tch.nav.label')}>
      <button
        type="button"
        className={active === 'home' ? 'is-active' : ''}
        aria-current={active === 'home' ? 'page' : undefined}
        onClick={() => navigate('/teacher')}
        data-tour="teacher.nav.home"
      >
        <Icon name="chart" size={16} />
        <span>{t('tch.nav.home')}</span>
      </button>
      <button
        type="button"
        className={active === 'students' ? 'is-active' : ''}
        aria-current={active === 'students' ? 'page' : undefined}
        onClick={() => navigate('/teacher/students')}
        data-tour="teacher.nav.students"
      >
        <Icon name="users" size={16} />
        <span>{t('tch.nav.students')}</span>
      </button>
      {/* Beside the students, because it is about them. The conversations a
          teacher has held sit one thought away from the roster of who they
          were with — further down the bar, between the task builder and the
          calendar, it read as another piece of planning machinery. */}
      <button
        type="button"
        className={active === 'goals' ? 'is-active' : ''}
        aria-current={active === 'goals' ? 'page' : undefined}
        onClick={() => navigate('/teacher/goals')}
        data-tour="teacher.nav.goals"
      >
        {/* `note`, not `target`: the screen is the written record of the talks
            held with each student. `message` means the messages inbox — two
            speech bubbles in one bar would read as two doors onto the same
            thing. */}
        <Icon name="note" size={16} />
        <span>{t('tch.nav.goals')}</span>
        {/* What is waiting, said where the teacher already is. A count that
            only appears once you open the screen is a count that tells you
            nothing you did not just find out. */}
        {pending > 0 ? (
          <span className="teacher-app-nav__badge"
                aria-label={t('tch.nav.pendingGoals', { count: pending })}>
            {pending > 99 ? '99+' : pending}
          </span>
        ) : null}
      </button>
      <button
        type="button"
        className={active === 'learnings' ? 'is-active' : ''}
        aria-current={active === 'learnings' ? 'page' : undefined}
        onClick={() => navigate('/teacher/learnings')}
        data-tour="teacher.nav.learnings"
      >
        <Icon name="library" size={16} />
        <span>{t('tch.nav.learnings')}</span>
      </button>
      {/* The rest, folded. Four screens a teacher lives on stay in the bar;
          the three they arrive at for a reason sit one press behind "עוד".
          Nothing is removed — a nav that lists every capability is a nav a
          teacher has to READ, and reading it is the cost paid on every glance
          at the four that matter. The fold still says where you are: the
          trigger lights when the open screen is one of its own. */}
      <div
        className={`teacher-app-nav__more${moreOpen ? ' is-open' : ''}`}
        ref={moreRef}
        onMouseEnter={() => setMoreOpen(true)}
        onMouseLeave={() => setMoreOpen(false)}
      >
        <button
          type="button"
          className={`teacher-app-nav__moreTrigger${moreActive ? ' is-active' : ''}`}
          aria-expanded={moreOpen}
          aria-haspopup="true"
          onClick={() => setMoreOpen((on) => !on)}
        >
          <span>{t('tch.nav.more')}</span>
          <Icon name="chevronDown" size={14} aria-hidden />
          {/* The messages screen lives inside this fold, so its badge must
              surface on the trigger — a count behind a closed menu tells the
              teacher nothing until they already opened it. */}
          <NavBadge count={unreadMessages}
                    label={t('tch.nav.unreadMessages', { count: unreadMessages })} />
        </button>
        {/* Always in the DOM, shown by class. Below the fold-point this whole
            nav becomes a sheet behind a hamburger, and a dropdown inside a
            dropdown is a worse answer than the flat list it already was — the
            compact rules simply reveal this in place. */}
        <div className="teacher-app-nav__pop" role="menu">
          {FOLDED.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="menuitem"
              className={active === entry.id ? 'is-active' : ''}
              aria-current={active === entry.id ? 'page' : undefined}
              onClick={() => { setMoreOpen(false); navigate(entry.path) }}
              data-tour={`teacher.nav.${entry.id}`}
            >
              <Icon name={entry.icon} size={16} />
              <span>{t(entry.labelKey)}</span>
              {entry.id === 'messages' && (
                <NavBadge count={unreadMessages}
                          label={t('tch.nav.unreadMessages', { count: unreadMessages })} />
              )}
            </button>
          ))}
        </div>
      </div>
      {/* The admin console is deliberately NOT in this nav anymore: it is a
          control plane an admin visits occasionally at /admin, not a teaching
          surface — and for the teachers who are not admins it was dead chrome.
          The backend still gates every /api/admin route on the live grant. */}
    </nav>
  )

  const trailing = (
    <div className="teacher-app-scope">
      <NotificationBell />
      {/* Last, and quiet: the way back into the tour after it was dismissed. */}
      <TourButton />
    </div>
  )

  /* 1310, not the default 1200: the scope segments make this bar wider than a
     learner's, and below that the navigation and the scope overlap rather than
     either of them giving way. Folding the nav sooner is the right trade —
     scope is what the teacher must always be able to see. Measured, not
     guessed: raise the nav's spacing and this number has to move with it. */
  return (
    <AppBar
      center={navigation}
      leading={<ScopeControl />}
      trailing={trailing}
      compactBelow={1310}
    />
  )
}
