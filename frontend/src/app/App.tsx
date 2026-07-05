import { LearnerMappingPage } from '../features/learner-mapping/LearnerMappingPage'
import { ResultsPage } from '../features/results/ResultsPage'
import { StudentDashboardPage } from '../features/student-dashboard/StudentDashboardPage'
import { TeacherViewPage } from '../features/teacher-view/TeacherViewPage'
import { MentoringPage } from '../features/mentoring/MentoringPage'
import { LearningPortalPage } from '../features/learning-portal/LearningPortalPage'
import { LessonPage } from '../features/learning-lesson/LessonPage'
import { LomdaCreatorPage } from '../features/learning-create/LomdaCreatorPage'
import { LanguageSwitcher } from '../components/LanguageSwitcher'
import { useI18n } from '../i18n/I18nProvider'
import { useRoute } from './router'

function pageForRoute(pathname: string) {
  if (pathname.startsWith('/results')) return <ResultsPage />
  if (pathname.startsWith('/student-dashboard')) return <StudentDashboardPage />
  if (pathname.startsWith('/teacher-view')) return <TeacherViewPage />
  if (pathname.startsWith('/mentoring')) return <MentoringPage />
  if (pathname.startsWith('/learning/lesson')) return <LessonPage />
  if (pathname.startsWith('/learning/create')) return <LomdaCreatorPage />
  if (pathname.startsWith('/learning')) return <LearningPortalPage />
  return <LearnerMappingPage />
}

export function App() {
  const pathname = useRoute()
  const { language } = useI18n()
  const isMappingRoute = pathname === '/' || pathname === ''
  const isLearningPortalRoute = pathname === '/learning' || pathname === '/learning/'

  return (
    <>
      {/* Keying by language forces every migrated route to remount and re-fetch
          content (and re-run its localization) whenever the language changes. */}
      <div key={language}>{pageForRoute(pathname)}</div>
      {/* The mapping page already shows a language switcher in its own app bar. */}
      {!isMappingRoute && !isLearningPortalRoute && <LanguageSwitcher variant="floating" />}
    </>
  )
}