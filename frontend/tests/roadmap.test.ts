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
  progressForScroll, railVisualPosition, scrollForIndex, trackHeight, xpAway, SEGMENT_PX, SWAY,
  yuviPosition, idleBreakerPose, createYuviFlight,
} from '../src/features/roadmap/roadmapModel.ts'
import { stationArchetype, stationDetailProfile, stationFlowerVariant } from '../src/features/roadmap/RoadmapJungleStation.ts'
import { rewardItems, rewardLabel } from '../src/services/levelRewards.ts'
import type { ProgressionStatus, RoadmapLevel, XpLevelReward } from '../src/services/progression.ts'

const SRC = fileURLToPath(new URL('../src/', import.meta.url))
const read = (path: string) => readFileSync(join(SRC, path), 'utf8').replace(/\r\n/g, '\n')

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

  it('marks every tenth level as a milestone', () => {
    assert.deepEqual([1, 5, 9, 10, 11, 20, 30, 50].map(isMilestone), [false, false, false, true, false, true, true, true])
  })

  it('grows the rail from level 1 at the bottom to level 50 at the top', () => {
    assert.equal(railVisualPosition(0, 50), 1)
    assert.equal(railVisualPosition(49, 50), 0)
    assert.ok(railVisualPosition(9, 50) > railVisualPosition(39, 50))
  })

  it('shows the exact focused level without a native slider dot', () => {
    const page = read('features/roadmap/RoadmapPage.tsx')
    const css = read('features/roadmap/roadmap.css')
    assert.match(page, /className="rm-rail__current"[^>]*>\{focusedLevel\}<\/output>/)
    assert.match(css, /\.rm-rail__current\s*\{/)
    assert.match(css, /\.rm-rail__range::-webkit-slider-thumb[\s\S]*?background: transparent/)
    assert.doesNotMatch(css, /\.rm-rail__dot\.is-current::before/)
  })
})

describe('jungle station variety', () => {
  it('distributes all 50 levels across four station archetypes', () => {
    const counts = new Map<string, number>()
    for (let level = 1; level <= 50; level++) {
      const archetype = stationArchetype(level)
      counts.set(archetype, (counts.get(archetype) ?? 0) + 1)
    }
    assert.deepEqual([...counts.keys()], ['vine-ruin', 'tropical-canopy', 'shattered-garden', 'root-shrine'])
    assert.deepEqual([...counts.values()], [13, 13, 12, 12])
  })

  it('gives each station type one restrained visual identity', () => {
    assert.deepEqual(stationDetailProfile(1, false), { roots: 3, leaves: 4, vines: 3, flowers: 0, stones: 3, monstera: 0 })
    assert.deepEqual(stationDetailProfile(2, false), { roots: 2, leaves: 7, vines: 0, flowers: 0, stones: 0, monstera: 3 })
    assert.deepEqual(stationDetailProfile(3, false), { roots: 2, leaves: 3, vines: 0, flowers: 3, stones: 6, monstera: 0 })
    assert.deepEqual(stationDetailProfile(4, false), { roots: 8, leaves: 3, vines: 0, flowers: 0, stones: 0, monstera: 0 })
  })

  it('does not add gate geometry to milestone stations', () => {
    const station = read('features/roadmap/RoadmapJungleStation.ts')
    const page = read('features/roadmap/RoadmapPage.tsx')
    assert.doesNotMatch(station, /ruinGeometry|const ruins = new THREE\.Group|const lintel/)
    assert.doesNotMatch(page, /roadmap\.card\.gate/)
  })

  it('mixes flower silhouettes across nearby stations', () => {
    const variants = new Set(Array.from({ length: 16 }, (_, index) => stationFlowerVariant(index + 1, index % 5)))
    assert.deepEqual([...variants].sort(), ['orchid', 'star-bloom', 'torch-flower'])
    for (const level of [2, 6, 10, 14]) {
      assert.equal(new Set(Array.from({ length: 5 }, (_, index) => stationFlowerVariant(level, index))).size, 3)
    }
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

describe('Yuvi on the focused level', () => {
  it('starts on the current pad, independent of partial XP', () => {
    const anchor = anchorAt(4)
    assert.deepEqual(yuviPosition(status(5, 0.75), 50), {
      x: anchor.x, y: anchor.y + 0.07, z: anchor.z + 0.8,
    })
    assert.deepEqual(yuviPosition(status(5, 0), 50), yuviPosition(status(5, 0.99), 50))
    assert.notDeepEqual(yuviPosition(status(5), 50), yuviPosition(status(6), 50))
    assert.deepEqual(yuviPosition(status(51), 50), yuviPosition(status(50), 50))
  })

  it('lands inside reached rings and hovers outside locked rings, mirrored in RTL', () => {
    for (const index of [0, 3, 4, 5, 9, 49]) {
      const anchor = anchorAt(index)
      const position = yuviPosition(status(5), 50, index)
      const mirrored = yuviPosition(status(5), 50, index, true)
      if (index < 5) {
        assert.equal(position.x, anchor.x)
        assert.equal(position.y, anchor.y + 0.07)
      } else {
        assert.ok(position.x - anchor.x > (isMilestone(index + 1) ? 2.52 : 1.8))
        assert.equal(position.y, anchor.y + 0.65)
        assert.ok(Math.abs(mirrored.x + position.x - 2 * anchor.x) < 1e-9)
      }
    }
    assert.deepEqual(yuviPosition(status(5), 50, -20), yuviPosition(status(5), 50, 0))
    assert.deepEqual(yuviPosition(status(5), 50, 80), yuviPosition(status(5), 50, 49))
  })

  it('flies vertically and horizontally, sometimes spinning, then lands exactly', () => {
    const origin = yuviPosition(status(5), 50, 3)
    const destination = yuviPosition(status(5), 50, 4)
    for (const spin of [0, 1, -1]) {
      const flight = createYuviFlight(origin)
      flight.retarget(destination, spin)
      flight.update(0.4)
      assert.notEqual(flight.position.x, origin.x)
      assert.notEqual(flight.position.z, origin.z)
      assert.ok(flight.position.y > Math.max(origin.y, destination.y))
      assert.equal(Math.sign(flight.yaw), spin)
      flight.update(2)
      assert.deepEqual(flight.position, destination)
      assert.equal(flight.active, false)
      assert.equal(flight.yaw, 0)
      assert.equal(flight.bank, 0)
    }
  })

  it('reverses from the visible position and velocity without jumping', () => {
    const origin = yuviPosition(status(5), 50, 3)
    const flight = createYuviFlight(origin)
    flight.retarget(yuviPosition(status(5), 50, 6), 1)
    flight.update(0.3)
    const previous = { ...flight.position }
    flight.update(0.0001)
    const visible = { ...flight.position }
    const yaw = flight.yaw
    flight.retarget(origin, -1)
    assert.deepEqual(flight.position, visible)
    assert.equal(flight.yaw, yaw)
    flight.update(0.0001)
    for (const axis of ['x', 'y', 'z'] as const) {
      assert.ok(Math.abs((flight.position[axis] - visible[axis]) - (visible[axis] - previous[axis])) < 0.00001)
    }
    flight.update(2)
    assert.deepEqual(flight.position, origin)
  })

  it('lands when a focused level unlocks and skips flight for reduced motion', () => {
    const flight = createYuviFlight(yuviPosition(status(5), 50, 5))
    const landing = yuviPosition(status(6), 50, 5)
    flight.retarget(landing)
    assert.equal(flight.active, true)
    flight.update(2)
    assert.deepEqual(flight.position, landing)
    const next = yuviPosition(status(6), 50, 9)
    flight.retarget(next, 1, true)
    assert.deepEqual(flight.position, next)
    assert.equal(flight.active, false)
    assert.equal(flight.yaw, 0)
  })

  it('returns to a neutral standing pose between idle breakers', () => {
    const neutral = idleBreakerPose(0)
    for (const seconds of [5, 6, 10, 11, 16, 17, 18, 36]) {
      assert.deepEqual(idleBreakerPose(seconds), neutral)
    }
    assert.notEqual(idleBreakerPose(2).headYaw, neutral.headYaw)
    assert.ok(idleBreakerPose(8).rightArm > 1)
    assert.ok(idleBreakerPose(14).leftArm < -2)
    for (const seconds of [2, 8, 14]) {
      assert.deepEqual(idleBreakerPose(seconds, true), neutral)
      assert.deepEqual(idleBreakerPose(seconds + 18), idleBreakerPose(seconds))
    }
  })

  it('shares the scene renderer and follows live level and design updates', () => {
    const scene = read('features/roadmap/RoadmapScene.ts')
    const avatar = read('features/roadmap/RoadmapYuvi.ts')
    assert.match(scene, /horizontalFlight && yuviFlight\.active, leadLeft, dt/)
    assert.match(scene, /yuvi\.object\.rotation\.set\(yuvi\.flightPitch, yuviFlight\.yaw, yuviFlight\.bank\)/)
    assert.match(scene, /placeBeacon\(\)\s+targetYuvi\(\)/)
    assert.match(scene, /targetYuvi\(previous < 0, true\)/)
    assert.match(scene, /flightCount % 3 === 0/)
    assert.match(scene, /browsing && !immediate && changedLevel/)
    assert.match(scene, /horizontalFlight = forwardFlight/)
    assert.match(scene, /const yuviStandingAtCurrent = !yuviFlight\.active && yuviFocus === status\.level - 1/)
    assert.match(scene, /const beaconTarget = yuviStandingAtCurrent \? 0 : 1/)
    assert.match(scene, /anchorAt\(Math\.max\(0, Math\.min\(count - 1, status\.level - 1\)\)\)/)
    assert.doesNotMatch(scene, /beaconDistance|nearbyFade/)
    assert.match(avatar, /roadmap-yuvi-thruster/)
    assert.match(avatar, /const pitchTarget = !reduceMotion && horizontalFlight \? -Math\.PI \/ 2 : 0/)
    assert.match(avatar, /const faceTurnTarget = !reduceMotion && horizontalFlight \? Math\.PI : 0/)
    assert.match(avatar, /const horizontalLeftArm = leadLeft \? -Math\.PI \+ flutter : -0\.18/)
    assert.match(avatar, /const horizontalRightArm = leadLeft \? 0\.18 : Math\.PI - flutter/)
    assert.match(avatar, /armL\.rotation\.x = THREE\.MathUtils\.lerp\(0, leadLeft \? -0\.55 : 0\.75, horizontalBlend\)/)
    assert.match(avatar, /armR\.rotation\.x = THREE\.MathUtils\.lerp\(0, leadLeft \? -0\.75 : 0\.55, horizontalBlend\)/)
    assert.match(avatar, /exhaustTexture\.dispose\(\)/)
    assert.match(scene, /yuvi\.dispose\(\)/)
    assert.match(avatar, /createYuviAvatarRig/)
    assert.doesNotMatch(avatar, /WebGLRenderer|requestAnimationFrame|setInterval/)
    assert.match(read('features/roadmap/RoadmapPage.tsx'), /setDesign\(design\)/)
    assert.match(read('features/Yuvi-studio/YuviAvatar3D.tsx'), /createYuviAvatarRig\(design, settings, tier\)/)
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
    assert.match(popup, /className="xp-award__roadmap" onClick=\{openRoadmap\}/)
    assert.match(popup, /\{t\('roadmap\.title'\)\}/)
    assert.match(popup, /navigate\('\/roadmap'\)/)
  })
})

describe('the page', () => {
  it('updates both its chrome and WebGL scene when the app theme changes', () => {
    const page = read('features/roadmap/RoadmapPage.tsx')
    const scene = read('features/roadmap/RoadmapScene.ts')
    const css = read('features/roadmap/roadmap.css')
    assert.match(page, /const \{ theme \} = useTheme\(\)/)
    assert.match(page, /theme: themeRef\.current/)
    assert.match(page, /sceneRef\.current\?\.setTheme\(theme\)/)
    assert.match(scene, /const SCENE_THEME = \{[\s\S]*dark:[\s\S]*light:/)
    assert.match(scene, /setTheme: applyTheme/)
    assert.match(scene, /SCENE_THEME\[theme\]\.fog/)
    assert.match(scene, /theme === 'light' \? THREE\.NormalBlending : THREE\.AdditiveBlending/)
    assert.match(scene, /applyRewardGlow\(node\.glow, node\.item, pad\.state === 'locked', next\)/)
    assert.match(css, /\[data-theme='light'\] \.rm-page/)
    assert.match(css, /\[data-theme='light'\] \.rm-stage/)
    assert.match(css, /\.rm-card__cta:not\(\.rm-card__cta--quiet\).*color: #fff/)
  })

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

  it('renders stations without a road mesh or road shader', () => {
    const scene = read('features/roadmap/RoadmapScene.ts')
    assert.doesNotMatch(scene, /ROAD_GLOW|ROAD_WIDTH|roadBase|roadGlowMaterial|function ribbon/)
  })

  it('builds the stations as shader-textured floating jungle ruins', () => {
    const scene = read('features/roadmap/RoadmapScene.ts')
    const station = read('features/roadmap/RoadmapJungleStation.ts')
    assert.match(scene, /createJungleStationAssets\(theme, tier\)/)
    assert.match(scene, /jungleStations\.create\(row\.level, milestone\)/)
    assert.doesNotMatch(scene, /stemGeometry|padGeometry|gateGeometry/)
    assert.match(station, /new THREE\.ShaderMaterial/g)
    assert.match(station, /float fbm\(vec3 p\)/)
    assert.match(station, /mossMask/)
    assert.match(station, /uAmbient/)
    assert.match(station, /stationDetailProfile/)
    assert.match(station, /'vine-ruin', 'tropical-canopy', 'shattered-garden', 'root-shrine'/)
    assert.match(station, /stationArchetype\(level\)/)
    assert.match(station, /addClimbingVines/)
    assert.match(station, /addFlower/)
    assert.match(station, /addBrokenStones/)
    assert.match(station, /fracturedStoneGeometry/)
    assert.match(station, /addMonsteraMonkey/)
    assert.match(station, /monsteraMonkeyLeafGeometry/)
    assert.match(station, /lichenMaterial/)
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
