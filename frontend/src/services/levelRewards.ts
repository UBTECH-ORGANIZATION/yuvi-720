import type { XpLevelReward } from './progression'

/* What a level reward is called, and what kind of thing it is.
 *
 * Shared by the level-up popup (`XpAwardPopup`) and the roadmap screen: one
 * table, so a reward cannot be named one way when it is won and another way
 * when it is promised. The ids are the settlement's own (`LEVEL_REWARDS` in
 * `backend/app/services/progression/rewards.py`); the keys mirror the
 * catalogue and the popup copy. */

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

type Translate = (key: string, params?: Record<string, string | number>) => string

/** The reward's name in the current language. Frames are a family named by
 *  their level; everything else is looked up in the table, then under the
 *  catalogue's own room and avatar names (a trophy shelf, a laurel, the
 *  prestige crystals), so a reward the table does not spell out still reads
 *  as the thing it is. `t()` hands back the key itself when a key is missing,
 *  which is how a miss is told from a hit. */
export function rewardLabel(t: Translate, assetId: string): string {
  const profileFrameLevel = assetId.match(/^(?:profile|prestige)_level_frame_(\d+)$/)
  if (profileFrameLevel) return t('progression.reward.profileFrame', { level: profileFrameLevel[1] })
  const keys = [REWARD_LABEL_KEYS[assetId], `YuviStudio.room.item.${assetId}`, `YuviStudio.item.${assetId}`]
  for (const key of keys) {
    if (!key) continue
    const label = t(key)
    if (label !== key) return label
  }
  const prestigeObjectLevel = assetId.match(/^prestige_room_object_(\d+)$/)
  if (prestigeObjectLevel) return t('progression.reward.prestigeObject', { level: prestigeObjectLevel[1] })
  return t('progression.reward.item')
}

/** What kind of thing an unlock is — decides how the roadmap draws it. */
export type RewardKind =
  | 'sparks'   // a spark grant
  | 'hint'     // an extra hint token
  | 'world'    // a whole studio world (`layout:*`)
  | 'frame'    // a profile frame (level or prestige)
  | 'mood'     // a room ambience / theme, not a placeable prop
  | 'sound'    // a room sound set
  | 'room'     // a placeable prop with a catalogue thumbnail
  | 'avatar'   // an avatar part with a catalogue thumbnail

export interface RewardItem {
  kind: RewardKind
  /** The settlement id (`'layout:sportsArena'`, `'laurel'`); sparks and hint
   *  tokens carry a synthetic one so a list can key on it. */
  id: string
  /** For 'sparks' the amount, for 'hint' the token count. */
  amount?: number
  /** For 'world', the layout id (`'sportsArena'`). */
  world?: string
}

const MOOD_IDS = new Set(['room_ambient_lights_06', 'room_theme_20', 'premium_room_ambience_27'])
const SOUND_IDS = new Set(['room_audio_theme_10'])

/** A level reward as the list of things it hands over, in the order the
 *  roadmap shows them: the world first (it is the headline), then props and
 *  parts, then the grants. */
export function rewardItems(reward: XpLevelReward): RewardItem[] {
  const items: RewardItem[] = []
  for (const id of reward.roomUnlocks) {
    if (id.startsWith('layout:')) items.push({ kind: 'world', id, world: id.slice('layout:'.length) })
  }
  for (const id of reward.roomUnlocks) {
    if (id.startsWith('layout:')) continue
    items.push({ kind: MOOD_IDS.has(id) ? 'mood' : SOUND_IDS.has(id) ? 'sound' : 'room', id })
  }
  for (const id of reward.avatarUnlocks) {
    items.push({ kind: /_level_frame_\d+$/.test(id) ? 'frame' : 'avatar', id })
  }
  if (reward.sparks > 0) items.push({ kind: 'sparks', id: `sparks:${reward.level}`, amount: reward.sparks })
  if (reward.extraHintTokens > 0) items.push({ kind: 'hint', id: `hint:${reward.level}`, amount: reward.extraHintTokens })
  return items
}
