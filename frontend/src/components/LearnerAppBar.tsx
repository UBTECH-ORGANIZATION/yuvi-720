import { useEffect, useState } from 'react'
import { useRoute, navigate } from '../app/router'
import { useI18n } from '../i18n/I18nProvider'
import { useBrain } from '../providers/BrainProvider'
import { getMyUnread } from '../services/directMessages'
import { subscribe } from '../services/realtime'
import { AppBar } from './AppBar'
import { Icon } from './primitives'
import { StudioLaunchButton } from './StudioLaunchButton'
import { WalletChip } from './WalletChip'
import { NotificationBell } from './NotificationBell'
import './learner-app-bar.css'

/** Unread teacher messages: counted on load, re-read on entering or leaving
 *  the chat (which is where it changes), and bumped live off the same stream
 *  the page already holds — a badge that waits for a poll is a badge that
 *  says "nothing" while the toast above it says otherwise. */
function useMyUnread(pathname: string) {
  const [count, setCount] = useState(0)
  const onChat = pathname.startsWith('/student-dashboard/chat')

  useEffect(() => {
    let active = true
    const read = () => {
      getMyUnread()
        .then((result) => { if (active) setCount(result.total ?? 0) })
        .catch(() => { if (active) setCount(0) })
    }
    read()
    const timer = window.setInterval(read, 120_000)
    const unsubscribe = subscribe(
      'learner-triggers', () => '/api/agent/triggers/subscribe',
      (frame) => {
        if (frame.type === 'direct_message' && frame.sender === 'teacher') read()
      })
    return () => { active = false; window.clearInterval(timer); unsubscribe() }
  }, [onChat])

  return count
}

type LearnerSection = 'dashboard' | 'learning' | 'tasks' | 'goals' | 'chat' | 'calendar'

interface LearnerAppBarProps {
  studentName?: string
}

function sectionForRoute(pathname: string): LearnerSection | null {
  if (pathname.startsWith('/student-dashboard/chat')) return 'chat'
  if (pathname.startsWith('/student-dashboard/calendar')) return 'calendar'
  if (pathname.startsWith('/student-dashboard')) return 'dashboard'
  if (pathname.startsWith('/learning')) return 'learning'
  if (pathname.startsWith('/tasks')) return 'tasks'
  if (pathname.startsWith('/mentoring')) return 'goals'
  return null
}

export function LearnerAppBar({ studentName }: LearnerAppBarProps) {
  const pathname = useRoute()
  const { t } = useI18n()
  const { brain } = useBrain()
  const activeSection = sectionForRoute(pathname)
  const unread = useMyUnread(pathname)
  const displayName = studentName || brain?.identity.display_name || t('sdash.learnerFallback')

  const navigation = (
    <nav className="learner-app-nav" aria-label={t('sdash.nav.label')}>
      <button
        className={activeSection === 'dashboard' ? 'is-active' : ''}
        type="button"
        aria-current={activeSection === 'dashboard' ? 'page' : undefined}
        onClick={() => navigate('/student-dashboard')}
      >
        <Icon name="chart" size={16} />
        <span>{t('sdash.nav.dashboard')}</span>
      </button>
      <button
        className={activeSection === 'learning' ? 'is-active' : ''}
        type="button"
        aria-current={activeSection === 'learning' ? 'page' : undefined}
        onClick={() => navigate('/learning')}
      >
        <Icon name="book" size={16} />
        <span>{t('sdash.nav.learning')}</span>
      </button>
      <button
        className={activeSection === 'tasks' ? 'is-active' : ''}
        type="button"
        aria-current={activeSection === 'tasks' ? 'page' : undefined}
        onClick={() => navigate('/tasks')}
      >
        <Icon name="backpack" size={16} />
        <span>{t('sdash.nav.tasks')}</span>
      </button>
      <button
        className={activeSection === 'goals' ? 'is-active' : ''}
        type="button"
        aria-current={activeSection === 'goals' ? 'page' : undefined}
        onClick={() => navigate('/mentoring')}
      >
        <Icon name="target" size={16} />
        <span>{t('sdash.nav.goals')}</span>
      </button>
      <button
        className={activeSection === 'chat' ? 'is-active' : ''}
        type="button"
        aria-current={activeSection === 'chat' ? 'page' : undefined}
        onClick={() => navigate('/student-dashboard/chat')}
      >
        <Icon name="message" size={16} />
        <span>{t('sdash.nav.chat')}</span>
        {/* Messages waiting from a teacher, visible from any screen — the
            same contract as the teacher's own badges. */}
        {unread > 0 && (
          <span className="learner-app-nav__badge"
                aria-label={t('sdash.nav.unreadMessages', { count: unread })}>
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
      <button
        className={activeSection === 'calendar' ? 'is-active' : ''}
        type="button"
        aria-current={activeSection === 'calendar' ? 'page' : undefined}
        onClick={() => navigate('/student-dashboard/calendar')}
      >
        <Icon name="calendar" size={16} />
        <span>{t('sdash.nav.calendar')}</span>
      </button>
    </nav>
  )

  return (
    <AppBar
      center={navigation}
      trailing={
        <div className="learner-app-bar__trailing">
          <StudioLaunchButton />
          <NotificationBell />
          <WalletChip />
        </div>
      }
    />
  )
}