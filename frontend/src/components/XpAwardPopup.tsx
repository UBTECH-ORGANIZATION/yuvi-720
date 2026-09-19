import { useEffect, useState } from 'react'
import { useI18n } from '../i18n/I18nProvider'
import { useProgression } from '../providers/ProgressionProvider'
import { rewardLabel as nameReward } from '../services/levelRewards'

const REASON_KEYS: Record<string, string> = {
  'onboarding.personal_path_started': 'progression.reason.personalPathStarted',
  'learning_module.completed': 'progression.reason.module',
  'learning_goal.completed': 'progression.reason.goal',
  'teacher_quest.completed': 'progression.reason.quest',
  'personal_objective.started': 'progression.reason.objectiveStarted',
  'personal_objective.progressed': 'progression.reason.objectiveProgressed',
  'personal_objective.completed': 'progression.reason.objectiveCompleted',
  'learning_help.milestone': 'progression.reason.helpMilestone'
}

function LevelUpConfetti() {
  return (
    <div className="xp-level-up__confetti" aria-hidden="true">
      {Array.from({ length: 16 }, (_, index) => <i key={index} />)}
    </div>
  )
}

export function XpAwardPopup({ paused = false }: { paused?: boolean }) {
  const { t } = useI18n()
  const { pendingAwards, dismissAward } = useProgression()
  const [levelUp, setLevelUp] = useState(false)
  const batch = pendingAwards[0]
  const crossedLevels = batch?.receipts.flatMap((receipt) => {
    const before = receipt.entry?.levelBefore ?? receipt.progression.level
    const after = receipt.entry?.levelAfter ?? receipt.progression.level
    return Array.from({ length: Math.max(0, after - before) }, (_, index) => before + index + 1)
  }) ?? []

  useEffect(() => {
    if (!batch || paused || levelUp) return
    const timer = window.setTimeout(() => {
      if (crossedLevels.length) setLevelUp(true)
      else dismissAward()
    }, 5_500)
    return () => window.clearTimeout(timer)
  }, [batch, paused, levelUp, dismissAward, crossedLevels.length])

  if (!batch || paused) return null
  const totalXp = batch.receipts.reduce((sum, receipt) => sum + receipt.awarded, 0)
  const levelRewards = batch.receipts.flatMap((receipt) => receipt.levelRewards ?? [])
  const rewardLabel = (assetId: string) => nameReward(t, assetId)

  return (
    <>
      {!levelUp ? (
      <section className="xp-award" role="status" aria-live="polite">
        <div className="xp-award__mark" aria-hidden="true">XP</div>
        <div className="xp-award__content">
          <strong>{t('progression.award.title', { amount: String(totalXp) })}</strong>
          {batch.receipts.map((receipt) => (
            <span key={receipt.entry?.id ?? receipt.entry?.reason}>
              {t(REASON_KEYS[receipt.entry?.reason ?? ''] ?? 'progression.reason.earned')}
              <b dir="ltr">+{receipt.awarded} XP</b>
            </span>
          ))}
          {batch.sparks > 0 ? (
            <span>{t('progression.award.sparks')}<b>+{batch.sparks}</b></span>
          ) : null}
        </div>
        <button type="button" onClick={() => {
          if (crossedLevels.length) setLevelUp(true)
          else dismissAward()
        }} aria-label={t('progression.award.dismiss')}>×</button>
      </section>
      ) : null}

      {levelUp ? (
        <section className="xp-award xp-level-up" role="status" aria-live="polite">
          <LevelUpConfetti />
          <div className="level-up-dialog__medal" aria-hidden="true">
          {crossedLevels[crossedLevels.length - 1]}
          </div>
          <div className="xp-award__content">
            <strong>{t('progression.levelUp.title', {
              level: String(crossedLevels[crossedLevels.length - 1])
            })}</strong>
            {crossedLevels.length > 1 ? (
              <span>{t('progression.levelUp.multiple', { levels: crossedLevels.join(', ') })}</span>
            ) : null}
            {levelRewards.map((reward) => {
              const items = [...reward.avatarUnlocks, ...reward.roomUnlocks]
              return (
                <span key={reward.level}>
                  {reward.sparks > 0 ? t('progression.levelUp.rewardSparks', {
                    level: String(reward.level), sparks: String(reward.sparks)
                  }) : null}
                  {reward.sparks > 0 && items.length > 0 ? ' ' : null}
                  {items.length > 0 ? t('progression.levelUp.received', {
                    items: items.map(rewardLabel).join(', ')
                  }) : null}
                </span>
              )
            })}
          </div>
          <button type="button" onClick={() => {
            setLevelUp(false)
            dismissAward()
          }} aria-label={t('progression.award.dismiss')}>×</button>
        </section>
      ) : null}
    </>
  )
}