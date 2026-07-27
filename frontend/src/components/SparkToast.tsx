import { navigate } from '../app/router'
import { useI18n } from '../i18n/I18nProvider'
import { useRewards } from '../providers/RewardsProvider'
import { Icon } from './primitives'
import { Toast } from './Toast'

/* Announces a fresh spark grant once, wherever the learner happens to be.

   Deliberately about the action ("you moved a goal forward"), never about a
   score, and it always points at what the sparks are for. */

export function SparkToast() {
  const { t } = useI18n()
  const { lastGrant, acknowledgeGrant } = useRewards()

  if (!lastGrant || lastGrant.granted <= 0) return null

  const reasonKey = `rewards.earned.${lastGrant.reason ?? 'goal.started'}`
  const reason = t(reasonKey)

  return (
    <Toast
      variant="reward"
      icon={<Icon name="spark" size={18} />}
      title={t('rewards.earned.title', { count: lastGrant.granted })}
      body={reason === reasonKey ? undefined : reason}
      actionLabel={t('rewards.earned.cta')}
      onAction={() => {
        acknowledgeGrant()
        navigate('/yuvi-studio')
      }}
      onDismiss={acknowledgeGrant}
    />
  )
}
