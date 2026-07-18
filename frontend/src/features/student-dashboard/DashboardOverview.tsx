import { Icon } from '../../components/primitives'
import { useI18n } from '../../i18n/I18nProvider'
import type { DashboardDTO } from '../../services/brain'
import { LearningMap } from './LearningMap'
import { MyGoals } from './MyGoals'

interface DashboardOverviewProps {
  dashboard: DashboardDTO
  onMentoring: () => void
  onAskYuvi: () => void
}

export function DashboardOverview({ dashboard, onMentoring, onAskYuvi }: DashboardOverviewProps) {
  const { t } = useI18n()

  return (
    <>
      <MyGoals goals={dashboard.goals} onSeeAll={onMentoring} onAddGoal={onMentoring} />

      <LearningMap competencies={dashboard.competencies} onExplore={onAskYuvi} />
    </>
  )
}
