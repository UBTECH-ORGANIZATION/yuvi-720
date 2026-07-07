import { LearnerMappingPage } from '../features/learner-mapping/LearnerMappingPage'
import { ResultsPage } from '../features/results/ResultsPage'
import { StudentDashboardPage } from '../features/student-dashboard/StudentDashboardPage'
import { TeacherViewPage } from '../features/teacher-view/TeacherViewPage'
import { MentoringPage } from '../features/mentoring/MentoringPage'
import { LearningPortalPage } from '../features/learning-portal/LearningPortalPage'
import { LessonPage } from '../features/learning-lesson/LessonPage'
import { LomdaCreatorPage } from '../features/learning-create/LomdaCreatorPage'
import { LandingLoginPage } from '../features/landing-login/LandingLoginPage'
import { LanguageSwitcher } from '../components/LanguageSwitcher'
import { CompanionChat } from '../components/CompanionChat'
import { useI18n } from '../i18n/I18nProvider'
import { useRoute } from './router'

function pageForRoute(pathname: string) {
  if (pathname === '/' || pathname === '') return <LandingLoginPage />
  if (pathname.startsWith('/learner-mapping')) return <LearnerMappingPage />
  if (pathname.startsWith('/results')) return <ResultsPage />
  if (pathname.startsWith('/student-dashboard')) return <StudentDashboardPage />
  if (pathname.startsWith('/teacher-view')) return <TeacherViewPage />
  if (pathname.startsWith('/mentoring')) return <MentoringPage />
  if (pathname.startsWith('/learning/lesson')) return <LessonPage />
  if (pathname.startsWith('/learning/create')) return <LomdaCreatorPage />
  if (pathname.startsWith('/learning')) return <LearningPortalPage />
  return <LandingLoginPage />
}

// The floating Coach is a LEARNER companion — never on landing or teacher/admin
// surfaces. It is held off the mapping flow (already a guided chat) until that
// legacy chat is refactored onto the unified companion, to avoid a double-companion.
function isLearnerRoute(pathname: string) {
  return (
    pathname.startsWith('/results') ||
    pathname.startsWith('/student-dashboard') ||
    pathname.startsWith('/mentoring') ||
    pathname.startsWith('/learning')
  )
}

export function App() {
  const pathname = useRoute()
  const { language } = useI18n()
  const isLandingRoute = pathname === '/' || pathname === ''
  const isMappingRoute = pathname.startsWith('/learner-mapping')
  const isLearningPortalRoute = pathname === '/learning' || pathname === '/learning/'

  return (
    <>
      {/* Keying by language forces every migrated route to remount and re-fetch
          content (and re-run its localization) whenever the language changes. */}
      <div key={language}>{pageForRoute(pathname)}</div>
      {/* The mapping page already shows a language switcher in its own app bar. */}
      {!isLandingRoute && !isMappingRoute && !isLearningPortalRoute && <LanguageSwitcher variant="floating" />}
      {isLearnerRoute(pathname) && <CompanionChat />}
    </>
  )
}