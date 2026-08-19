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

import { navigate, useRoute } from '../app/router'
import { useI18n } from '../i18n/I18nProvider'
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

export function TeacherAppBar() {
  const pathname = useRoute()
  const { t } = useI18n()
  const active = sectionForRoute(pathname)

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
      <button
        type="button"
        className={active === 'tasks' ? 'is-active' : ''}
        aria-current={active === 'tasks' ? 'page' : undefined}
        onClick={() => navigate('/teacher/tasks')}
        data-tour="teacher.nav.tasks"
      >
        <Icon name="backpack" size={16} />
        <span>{t('tch.nav.tasks')}</span>
      </button>
      <button
        type="button"
        className={active === 'goals' ? 'is-active' : ''}
        aria-current={active === 'goals' ? 'page' : undefined}
        onClick={() => navigate('/teacher/goals')}
        data-tour="teacher.nav.goals"
      >
        <Icon name="target" size={16} />
        <span>{t('tch.nav.goals')}</span>
      </button>
      <button
        type="button"
        className={active === 'calendar' ? 'is-active' : ''}
        aria-current={active === 'calendar' ? 'page' : undefined}
        onClick={() => navigate('/teacher/calendar')}
        data-tour="teacher.nav.calendar"
      >
        <Icon name="calendar" size={16} />
        <span>{t('tch.nav.calendar')}</span>
      </button>
      <button
        type="button"
        className={active === 'messages' ? 'is-active' : ''}
        aria-current={active === 'messages' ? 'page' : undefined}
        onClick={() => navigate('/teacher/messages')}
        data-tour="teacher.nav.messages"
      >
        <Icon name="message" size={16} />
        <span>{t('tch.nav.messages')}</span>
      </button>
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

  return <AppBar center={navigation} leading={<ScopeControl />} trailing={trailing} />
}
