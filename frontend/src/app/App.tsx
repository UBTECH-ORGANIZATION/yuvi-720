import { LearnerMappingPage } from '../features/learner-mapping/LearnerMappingPage'
import { ResultsPage } from '../features/results/ResultsPage'
import { StudentDashboardPage } from '../features/student-dashboard/StudentDashboardPage'
import { TeacherViewPage } from '../features/teacher-view/TeacherViewPage'
import { MentoringPage } from '../features/mentoring/MentoringPage'
import { LearningPortalPage } from '../features/learning-portal/LearningPortalPage'
import { LessonPage } from '../features/learning-lesson/LessonPage'
import { LomdaCreatorPage } from '../features/learning-create/LomdaCreatorPage'
import { LandingLoginPage } from '../features/landing-login/LandingLoginPage'
import { YubiStudioPage } from '../features/yubi-studio/YubiStudioPage'
import { CompanionChat } from '../components/CompanionChat'
import { YubiCompanionDock } from '../components/YubiCompanionDock'
import { useI18n } from '../i18n/I18nProvider'
import { useCompanion } from '../providers/CompanionProvider'
import { useRoute } from './router'

function pageForRoute(pathname: string) {
  if (pathname === '/' || pathname === '') return <LandingLoginPage />
  if (pathname.startsWith('/learner-mapping')) return <LearnerMappingPage />
  if (pathname.startsWith('/results')) return <ResultsPage />
  if (pathname.startsWith('/yuvi-studio')) return <YubiStudioPage />
  if (pathname.startsWith('/student-dashboard')) return <StudentDashboardPage />
  if (pathname.startsWith('/teacher-view')) return <TeacherViewPage />
  if (pathname.startsWith('/mentoring')) return <MentoringPage />
  if (pathname.startsWith('/learning/lesson')) return <LessonPage />
  if (pathname.startsWith('/learning/create')) return <LomdaCreatorPage />
  if (pathname.startsWith('/learning')) return <LearningPortalPage />
  return <LandingLoginPage />
}

// The floating Coach begins only once the learner reaches the dashboard. Mapping
// and results are one guided onboarding flow, so showing a second companion there
// would compete with Yubi's profile-verification experience.
function isLearnerRoute(pathname: string) {
  return (
    pathname.startsWith('/student-dashboard') ||
    pathname.startsWith('/mentoring') ||
    pathname.startsWith('/learning')
  )
}

export function App() {
  const pathname = useRoute()
  const { language, direction } = useI18n()
  const { isOpen, isOpening, isClosing, panelWidth } = useCompanion()
  const isStudioRoute = pathname.startsWith('/yuvi-studio')
  const isActiveTaskRoute = pathname.startsWith('/learning/lesson')
  const isLearningWorldRoute = pathname === '/learning' || pathname.startsWith('/learning?')
  const learnerRoute = isLearnerRoute(pathname)
  const routePage = <div key={`${language}:${pathname}`}>{pageForRoute(pathname)}</div>

  return (
    <>
      {/* Keying by language forces every migrated route to remount and re-fetch
          content (and re-run its localization) whenever the language changes. */}
      {learnerRoute ? (
        <div
          className={`sp-learner-shell${isActiveTaskRoute ? ' is-task-route' : ''}${isLearningWorldRoute ? ' is-world-route' : ''}${isOpen && !isOpening && !isClosing ? ' is-companion-open' : ''}${isOpening ? ' is-companion-opening' : ''}${isClosing ? ' is-companion-closing' : ''}`}
          style={{ '--sp-companion-width': `${panelWidth}px` } as React.CSSProperties}
        >
          <CompanionChat />
          <div className="sp-learner-shell__content" dir={direction}>{routePage}</div>
        </div>
      ) : routePage}
      {learnerRoute && !isStudioRoute && !isActiveTaskRoute && !isLearningWorldRoute && <YubiCompanionDock />}
    </>
  )
}