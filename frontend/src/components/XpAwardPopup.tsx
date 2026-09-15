import { useEffect, useState } from 'react'
import { useI18n } from '../i18n/I18nProvider'
import { useProgression } from '../providers/ProgressionProvider'

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

const REWARD_LABEL_KEYS: Record<string, string> = {
  studio_wall_decals_03: 'progression.reward.wallDecals',
  neon: 'progression.reward.neonAmbience',
  level_furniture_05: 'YuviStudio.room.item.level_furniture_05',
  room_ambient_lights_06: 'progression.reward.ambientLights',
  stringLights: 'progression.reward.stringLights',
  studio_desk_accessory_08: 'progression.reward.deskDisplay',
  globe: 'progression.reward.globe',
  level_furniture_09: 'progression.reward.trophyStand',
  parkCarousel: 'progression.reward.parkCarousel',
  room_audio_theme_10: 'progression.reward.roomAudio',
  'layout:sportsArena': 'progression.reward.sportsArena',
  rocketModel: 'progression.reward.rocketModel',
  studio_posters_13: 'progression.reward.studioPosters',
  parkTree: 'progression.reward.parkTree',
  level_furniture_14: 'progression.reward.creativeDisplay',
  telescope: 'progression.reward.telescope',
  parkBasketSwing: 'progression.reward.basketSwing',
  level_furniture_17: 'progression.reward.soundWaveLamp',
  level_furniture_18: 'progression.reward.constellationLamp',
  room_theme_20: 'progression.reward.roomTheme',
  'layout:creatorLoft': 'progression.reward.creatorLoft',
  starProjector: 'progression.reward.starProjector',
  studio_display_shelf_23: 'progression.reward.displayShelf',
  trophies: 'progression.reward.trophyCollection',
  level_furniture_24: 'progression.reward.makerCorner',
  dragonwings: 'YuviStudio.item.dragonwings',
  level_furniture_26: 'progression.reward.achievementDisplay',
  premium_room_ambience_27: 'progression.reward.premiumAmbience',
  personal_journey_monument_29: 'progression.reward.journeyMonument'
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
  const rewardLabel = (assetId: string) => {
    const profileFrameLevel = assetId.match(/^(?:profile|prestige)_level_frame_(\d+)$/)
    if (profileFrameLevel) return t('progression.reward.profileFrame', { level: profileFrameLevel[1] })
    const prestigeObjectLevel = assetId.match(/^prestige_room_object_(\d+)$/)
    if (prestigeObjectLevel) return t('progression.reward.prestigeObject', { level: prestigeObjectLevel[1] })
    return t(REWARD_LABEL_KEYS[assetId] ?? 'progression.reward.item')
  }

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