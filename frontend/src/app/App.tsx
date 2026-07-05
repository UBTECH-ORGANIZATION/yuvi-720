import { LearnerMappingPage } from '../features/learner-mapping/LearnerMappingPage'
import { ResultsPage } from '../features/results/ResultsPage'
import { StudentDashboardPage } from '../features/student-dashboard/StudentDashboardPage'
import { TeacherViewPage } from '../features/teacher-view/TeacherViewPage'
import { MentoringPage } from '../features/mentoring/MentoringPage'
import { LearningPortalPage } from '../features/learning-portal/LearningPortalPage'
import { LessonPage } from '../features/learning-lesson/LessonPage'
import { LomdaCreatorPage } from '../features/learning-create/LomdaCreatorPage'
import { useRoute } from './router'

export function App() {
  const pathname = useRoute()
  if (pathname.startsWith('/results')) return <ResultsPage />
  if (pathname.startsWith('/student-dashboard')) return <StudentDashboardPage />
  if (pathname.startsWith('/teacher-view')) return <TeacherViewPage />
  if (pathname.startsWith('/mentoring')) return <MentoringPage />
  if (pathname.startsWith('/learning/lesson')) return <LessonPage />
  if (pathname.startsWith('/learning/create')) return <LomdaCreatorPage />
  if (pathname.startsWith('/learning')) return <LearningPortalPage />
  return <LearnerMappingPage />
}