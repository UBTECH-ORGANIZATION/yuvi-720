import { useRoute, navigate } from '../app/router'
import { useI18n } from '../i18n/I18nProvider'
import { useBrain } from '../providers/BrainProvider'
import { AppBar } from './AppBar'
import { Icon } from './primitives'
import './learner-app-bar.css'

type LearnerSection = 'dashboard' | 'learning' | 'goals' | 'chat' | 'calendar'

interface LearnerAppBarProps {
  studentName?: string
}

function sectionForRoute(pathname: string): LearnerSection | null {
  if (pathname.startsWith('/student-dashboard/chat')) return 'chat'
  if (pathname.startsWith('/student-dashboard/calendar')) return 'calendar'
  if (pathname.startsWith('/student-dashboard')) return 'dashboard'
  if (pathname.startsWith('/learning')) return 'learning'
  if (pathname.startsWith('/mentoring')) return 'goals'
  return null
}

export function LearnerAppBar({ studentName }: LearnerAppBarProps) {
  const pathname = useRoute()
  const { t } = useI18n()
  const { brain } = useBrain()
  const activeSection = sectionForRoute(pathname)
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
      studentName={displayName}
      studentSubtitle={t('sdash.appbar.subtitle')}
      center={navigation}
    />
  )
}