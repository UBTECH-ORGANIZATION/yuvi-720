/* The progress map (`/roadmap`).
 *
 *   node --test frontend/tests/
 *
 * The geometry and the arithmetic are pure (`roadmapModel.ts`) and tested
 * as such; the reward naming is shared with the level-up popup
 * (`services/levelRewards.ts`); the rest are source-level contracts on the
 * things that would fail silently: the page must stay outside the learner
 * shell (one WebGL context — the companion dock's avatar must not mount
 * beside the road), the route must be known, and the profile menu must
 * carry the door.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  anchorAt, focusedIndex, isMilestone, itemSlots, levelState, litFraction, positionIndex,
  progressForScroll, scrollForIndex, trackHeight, xpAway, SEGMENT_PX, SWAY,
} from '../src/features/roadmap/roadmapModel.ts'
import { rewardItems, rewardLabel } from '../src/services/levelRewards.ts'
import type { ProgressionStatus, RoadmapLevel, XpLevelReward } from '../src/services/progression.ts'

const SRC = fileURLToPath(new URL('../src/', import.meta.url))
const read = (path: string) => readFileSync(join(SRC, path), 'utf8')

const status = (level: number, progress = 0, totalXp = 0): ProgressionStatus => ({
  level, totalXp, currentLevelXp: 0, xpToNext: level < 50 ? 100 : null, nextLevel: level < 50 ? level + 1 : null,
  nextLevelTotalXp: null, progress, rulesVersion: 1, extraHintTokens: 0, claimedLevelRewards: [],
})
const reward = (partial: Partial<XpLevelReward> = {}): XpLevelReward => ({
  level: 2, sparks: 0, extraHintTokens: 0, avatarUnlocks: [], roomUnlocks: [], ...partial,
})

describe('the road', () => {
  it('climbs and runs forward one level at a time, swaying within its lane', () => {
    for (let i = 0; i < 50; i++) {
      const here = anchorAt(i)
      const next = anchorAt(i + 1)
      assert.ok(next.y > here.y, `level ${i + 1} climbs`)
      assert.ok(next.z < here.z, `level ${i + 1} runs forward`)
      assert.ok(Math.abs(here.x) <= SWAY + 1e-9)
    }
    assert.deepEqual(anchorAt(0), { x: 0, y: 0, z: 0 })
  })

  it('gates every tenth level', () => {
    assert.deepEqual([1, 5, 9, 10, 11, 20, 30, 50].map(isMilestone), [false, false, false, true, false, true, true, true])
  })
})

describe('the learner on the road', () => {
  it('names each level by where it stands relative to the learner', () => {
    const me = status(5)
    assert.equal(levelState(4, me), 'reached')
    assert.equal(levelState(5, me), 'current')
    assert.equal(levelState(6, me), 'locked')
  })

  it('stands part-way to the next pad, and lights the road that far', () => {
    assert.equal(positionIndex(status(5, 0.5), 50), 4.5)
    assert.equal(positionIndex(status(1, 0), 50), 0)
    // The cap has no next pad to be part-way to, whatever `progress` says.
    assert.equal(positionIndex({ ...status(50, 1), nextLevel: null }, 50), 49)
    assert.equal(litFraction(status(50, 1), 50), 1)
    assert.equal(litFraction(status(1, 0), 50), 0)
    assert.ok(Math.abs(litFraction(status(25, 0.5), 50) - 24.5 / 49) < 1e-12)
  })

  it('counts the XP still missing before a level opens', () => {
    const row: RoadmapLevel = { level: 10, startXp: 1800, xpToNext: 350, reward: reward({ level: 10 }) }
    assert.equal(xpAway(row, status(5, 0, 680)), 1120)
    assert.equal(xpAway(row, status(12, 0, 2500)), 0)
  })
})

describe('scroll ↔ road', () => {
  it('maps the scroll range onto the levels and back', () => {
    const max = 49 * SEGMENT_PX
    assert.equal(progressForScroll(0, max, 50), 0)
    assert.equal(progressForScroll(max, max, 50), 49)
    assert.equal(progressForScroll(max * 2, max, 50), 49, 'overscroll clamps')
    assert.equal(scrollForIndex(9, max, 50), 9 * SEGMENT_PX)
    assert.equal(progressForScroll(scrollForIndex(23, max, 50), max, 50), 23)
    assert.equal(progressForScroll(100, 0, 50), 0, 'no scroll range, no movement')
  })

  it('focuses the nearest pad', () => {
    assert.equal(focusedIndex(3.49, 50), 3)
    assert.equal(focusedIndex(3.5, 50), 4)
    assert.equal(focusedIndex(-1, 50), 0)
    assert.equal(focusedIndex(80, 50), 49)
  })

  it('makes the track exactly one segment per gap plus a viewport', () => {
    assert.equal(trackHeight(50, 900), 49 * SEGMENT_PX + 900)
    assert.equal(trackHeight(1, 900), 900)
  })
})

describe('items over a pad', () => {
  it('spreads a row across the road, symmetric about the centre', () => {
    const three = itemSlots(3)
    assert.equal(three.length, 3)
    assert.equal(three[1].x, 0)
    assert.equal(three[0].x, -three[2].x)
    assert.ok(three[0].z < 0 && three[1].z === 0, 'the outer ones sit back')
    const four = itemSlots(4)
    assert.ok(four[3].x - four[2].x < three[2].x - three[1].x, 'four pack tighter than three')
  })

  it('crowns a world above the row rather than seating it in it', () => {
    const [crown, ...row] = itemSlots(4, true)
    assert.equal(crown.x, 0)
    assert.ok(crown.y > row[0].y)
    assert.equal(row.length, 3)
    assert.equal(row[1].x, 0)
  })
})

describe('reward naming (shared with the level-up popup)', () => {
  const t = (key: string, params?: Record<string, string | number>) => {
    const known: Record<string, string> = {
      'progression.reward.globe': 'globe',
      'progression.reward.profileFrame': `frame ${params?.level}`,
      'progression.reward.prestigeObject': `sculpture ${params?.level}`,
      'progression.reward.item': 'a new item',
      'YuviStudio.item.laurel': 'Laurel wreath',
      'YuviStudio.room.item.trophyShelf': 'Medal shelf',
      'YuviStudio.room.item.prestige_room_object_30': 'Green crystal',
    }
    return known[key] ?? key
  }

  it('reads the table first, then the catalogue, then the level families', () => {
    assert.equal(rewardLabel(t, 'globe'), 'globe')
    assert.equal(rewardLabel(t, 'laurel'), 'Laurel wreath')
    assert.equal(rewardLabel(t, 'trophyShelf'), 'Medal shelf')
    assert.equal(rewardLabel(t, 'profile_level_frame_11'), 'frame 11')
    assert.equal(rewardLabel(t, 'prestige_level_frame_40'), 'frame 40')
    assert.equal(rewardLabel(t, 'prestige_room_object_30'), 'Green crystal', 'the catalogue name beats the generic family name')
    assert.equal(rewardLabel(t, 'prestige_room_object_35'), 'sculpture 35', 'and the family name covers a missing catalogue key')
    assert.equal(rewardLabel(t, 'something_new'), 'a new item')
  })

  it('lists what a level hands over: world first, then props and parts, then grants', () => {
    const items = rewardItems(reward({ level: 10, sparks: 25, roomUnlocks: ['room_audio_theme_10', 'layout:sportsArena', 'rocketModel'] }))
    assert.deepEqual(items.map((item) => item.kind), ['world', 'sound', 'room', 'sparks'])
    assert.equal(items[0].world, 'sportsArena')
    assert.equal(items[3].amount, 25)
    const twenty = rewardItems(reward({ level: 20, extraHintTokens: 1, roomUnlocks: ['room_theme_20', 'layout:creatorLoft', 'starProjector'] }))
    assert.deepEqual(twenty.map((item) => item.kind), ['world', 'mood', 'room', 'hint'])
    const frames = rewardItems(reward({ level: 11, avatarUnlocks: ['profile_level_frame_11', 'laurel'] }))
    assert.deepEqual(frames.map((item) => item.kind), ['frame', 'avatar'])
    assert.deepEqual(rewardItems(reward()), [])
  })

  it('is the one table the popup uses too', () => {
    const popup = read('components/XpAwardPopup.tsx')
    assert.match(popup, /from '\.\.\/services\/levelRewards'/)
    assert.doesNotMatch(popup, /REWARD_LABEL_KEYS/)
  })
})

describe('the page', () => {
  it('is a bare route like the studio: one WebGL context, no companion dock beside it', () => {
    const app = read('app/App.tsx')
    assert.match(app, /pathname\.startsWith\('\/roadmap'\)\) return <RoadmapPage \/>/)
    const learnerRoute = app.slice(app.indexOf('function isLearnerRoute('), app.indexOf('export function App('))
    assert.doesNotMatch(learnerRoute, /roadmap/)
    assert.match(app, /'\/roadmap',\n\s+'\/student-dashboard'/, 'protected')
    assert.match(app, /const RoadmapPage = lazy\(/, 'its own chunk')
    const scene = read('features/roadmap/RoadmapScene.ts')
    assert.equal((scene.match(/new THREE\.WebGLRenderer\(/g) ?? []).length, 1)
    assert.doesNotMatch(scene, /shadowMap\.enabled = true|castShadow = true/, 'no shadow map')
    assert.match(scene, /tierSettings\(/, 'tier-aware')
    assert.match(scene, /prefers-reduced-motion|reduceMotion/, 'honours reduced motion')
  })

  it('mounts the studio thumbnails and world strips, never catalogue geometry', () => {
    const scene = read('features/roadmap/RoadmapScene.ts')
    assert.match(scene, /preRenderedThumb\(/)
    assert.match(scene, /worldHologramStrip\(/)
    assert.doesNotMatch(scene, /RoomCatalog|YuviAssets|worldHolograms'/)
  })

  it('opens from the profile menu, for learners only', () => {
    const menu = read('components/UserMenu.tsx')
    assert.match(menu, /navigate\('\/roadmap'\)/)
    const row = menu.slice(menu.indexOf("navigate('/roadmap')") - 400, menu.indexOf("navigate('/roadmap')"))
    assert.match(row, /showProgression \?/, 'gated on the learner XP chip, so a teacher never sees it')
    assert.match(menu, /t\('roadmap\.menu'\)/)
  })

  it('bounds the ScrollTrigger snap to one pad per step and kills it on unmount', () => {
    const page = read('features/roadmap/RoadmapPage.tsx')
    assert.match(page, /snapTo: 1 \/ Math\.max\(1, count - 1\)/)
    assert.match(page, /trigger\.kill\(\)/)
    assert.match(page, /scene\.dispose\(\)/)
    assert.match(page, /window\.scrollTo\(0, 0\)/, 'the next page starts at the top')
  })
})
