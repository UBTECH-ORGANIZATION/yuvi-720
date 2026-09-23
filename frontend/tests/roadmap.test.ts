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
import * as THREE from 'three'
import {
  anchorAt, focusedIndex, isMilestone, itemSlots, levelState, litFraction, positionIndex,
  progressForScroll, railVisualPosition, scrollForIndex, trackHeight, xpAway, SEGMENT_PX, SWAY,
  yuviPosition, idleBreakerPose, createYuviFlight, stationDesignLevel, roadmapBackgroundBlend,
} from '../src/features/roadmap/roadmapModel.ts'
import { createJungleStationAssets, stationArchetype, stationDetailProfile, stationFlowerVariant } from '../src/features/roadmap/RoadmapJungleStation.ts'
import { createSpaceStationAssets, spaceStationArchetype } from '../src/features/roadmap/RoadmapSpaceStation.ts'
import { createMusicStationAssets, musicStationArchetype } from '../src/features/roadmap/RoadmapMusicStation.ts'
import { createGraffitiStationAssets, graffitiStationArchetype, graffitiArtStyle } from '../src/features/roadmap/RoadmapGraffitiStation.ts'
import { createSnowStationAssets, snowStationArchetype } from '../src/features/roadmap/RoadmapSnowStation.ts'
import { createRoadmapBackground } from '../src/features/roadmap/RoadmapBackground.ts'
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

  it('removes the side rail while preserving keyboard navigation and the current-level jump', () => {
    const page = read('features/roadmap/RoadmapPage.tsx')
    assert.doesNotMatch(page, /rm-rail|<Rail\b|function Rail\b|scrubTo/)
    assert.match(page, /event\.key === forward/)
    assert.match(page, /<HereChip status=\{status\} onJump=\{\(\) => jumpTo\(meIndex\)\}/)
  })

  it('shows the focused level out of the roadmap total on one line in every language', () => {
    const page = read('features/roadmap/RoadmapPage.tsx')
    const css = read('features/roadmap/roadmap.css')
    assert.match(page, /<LevelCard[^>]*total=\{count\}/)
    assert.match(page, /t\('roadmap\.card\.title', \{ level: String\(row\.level\), total: String\(total\) \}\)/)
    assert.match(css, /\.rm-card h2\s*\{[^}]*white-space: nowrap/)
    for (const [language, expected] of [['he', '6 מתוך 50'], ['ar', '6 من 50'], ['en', '6 out of 50']]) {
      const locale = JSON.parse(readFileSync(new URL(`../../locales/${language}.json`, import.meta.url), 'utf8'))
      assert.equal(locale['roadmap.card.title'].replace('{level}', '6').replace('{total}', '50'), expected)
    }
  })
})

describe('jungle station variety', () => {
  it('distributes the first ten levels across three jungle types and preserves later stations', () => {
    const counts = new Map<string, number>()
    for (let level = 1; level <= 10; level++) {
      const archetype = stationArchetype(level)
      counts.set(archetype, (counts.get(archetype) ?? 0) + 1)
    }
    assert.deepEqual([...counts.keys()], ['tropical-canopy', 'vine-ruin', 'root-shrine'])
    assert.deepEqual([...counts.values()], [4, 3, 3])
    assert.equal(stationArchetype(10), 'tropical-canopy')
    const legacy = ['vine-ruin', 'tropical-canopy', 'shattered-garden', 'root-shrine']
    for (let level = 11; level <= 50; level++) {
      assert.equal(stationArchetype(level), legacy[(level - 1) % 4])
    }
  })

  it('gives each station type one restrained visual identity', () => {
    assert.deepEqual(stationDetailProfile(1, false), { roots: 0, leaves: 6, vines: 0, flowers: 0, stones: 0, monstera: 0 })
    assert.deepEqual(stationDetailProfile(2, false), { roots: 0, leaves: 2, vines: 2, flowers: 0, stones: 3, monstera: 0 })
    assert.deepEqual(stationDetailProfile(3, false), { roots: 3, leaves: 2, vines: 0, flowers: 0, stones: 0, monstera: 0 })
    assert.deepEqual(stationDetailProfile(10, true), stationDetailProfile(1, false))
    assert.deepEqual(stationDetailProfile(11, false), { roots: 2, leaves: 3, vines: 0, flowers: 3, stones: 6, monstera: 0 })
    assert.deepEqual(stationDetailProfile(20, true), { roots: 9, leaves: 3, vines: 0, flowers: 0, stones: 0, monstera: 0 })
  })

  it('does not add gate geometry to milestone stations', () => {
    const station = read('features/roadmap/RoadmapJungleStation.ts')
    const page = read('features/roadmap/RoadmapPage.tsx')
    assert.doesNotMatch(station, /ruinGeometry|const ruins = new THREE\.Group|const lintel/)
    assert.doesNotMatch(page, /roadmap\.card\.gate/)
  })

  it('keeps each jungle silhouette visible at low quality, including newly created stations', () => {
    const assets = createJungleStationAssets('light', 'low')
    try {
      for (let level = 1; level <= 10; level++) {
        const station = assets.create(level, level === 10)
        const silhouette = station.getObjectByName('jungle-silhouette')!
        const detail = station.getObjectByName('jungle-fine-detail')!
        assert.equal(silhouette.visible, true)
        assert.equal(detail.visible, false)
        let meshes = 0
        silhouette.traverseVisible((object) => {
          if (!(object instanceof THREE.Mesh)) return
          meshes++
          assert.ok(object.material instanceof THREE.ShaderMaterial)
        })
        assert.ok(meshes >= 4 && meshes <= 12)
        assert.ok(station.getObjectByName('jungle-extra-fern')?.visible)
        assets.setQuality('high')
        assert.equal(detail.visible, true)
        assets.setQuality('low')
        assert.equal(detail.visible, false)
        assert.equal(silhouette.visible, true)
      }
      assets.setQuality('medium')
      assert.equal(assets.create(1, false).getObjectByName('jungle-fine-detail')!.visible, true)
    } finally {
      assets.dispose()
    }
  })

  it('replaces hanging roots with a leafy tree and square slabs with rounded stones', () => {
    const assets = createJungleStationAssets('light', 'low')
    try {
      for (const level of [3, 6, 9]) {
        const station = assets.create(level, false)
        const tree = station.getObjectByName('jungle-tree')!
        assert.ok(tree.getObjectByName('jungle-tree-trunk'))
        const bounds = new THREE.Box3().setFromObject(tree)
        assert.ok(bounds.min.y > -0.1)
        assert.ok(bounds.max.y < 1.8)
        assert.ok(Math.hypot(tree.position.x, tree.position.z) > 1.5)
        assert.equal(station.getObjectByName('jungle-root-bundle-0'), undefined)
      }
      for (const level of [2, 5, 8]) {
        const station = assets.create(level, false)
        const rock = station.getObjectByName('jungle-weathered-rock-0') as THREE.Mesh
        assert.equal(rock.geometry.type, 'SphereGeometry')
        assert.equal(station.getObjectByName('jungle-slab-0'), undefined)
      }
    } finally {
      assets.dispose()
    }
  })

  it('uses repeatable jungle layouts and disposes every owned geometry and material', () => {
    const assets = createJungleStationAssets('light', 'high')
    const resources = new Set<THREE.BufferGeometry | THREE.Material>()
    const transforms = (station: THREE.Group) => {
      const values: number[][] = []
      station.traverse((object) => {
        values.push([...object.position.toArray(), ...object.quaternion.toArray(), ...object.scale.toArray()])
        if (object instanceof THREE.Mesh) {
          resources.add(object.geometry)
          for (const material of Array.isArray(object.material) ? object.material : [object.material]) resources.add(material)
        }
      })
      return values
    }
    for (let level = 1; level <= 50; level++) {
      assert.deepEqual(transforms(assets.create(level, level % 10 === 0)), transforms(assets.create(level, level % 10 === 0)))
    }
    const leaf = assets.create(1, false).getObjectByName('jungle-leaf-0') as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>
    const lightColor = leaf.material.uniforms.uBase.value.getHex()
    assets.setTheme('dark')
    assert.notEqual(leaf.material.uniforms.uBase.value.getHex(), lightColor)
    assets.setTheme('light')
    assert.equal(leaf.material.uniforms.uBase.value.getHex(), lightColor)
    let disposed = 0
    resources.forEach((resource) => resource.addEventListener('dispose', () => { disposed++ }))
    assets.dispose()
    assert.equal(disposed, resources.size)
  })

  it('mixes flower silhouettes across nearby stations', () => {
    const variants = new Set(Array.from({ length: 16 }, (_, index) => stationFlowerVariant(index + 1, index % 5)))
    assert.deepEqual([...variants].sort(), ['orchid', 'star-bloom', 'torch-flower'])
    for (const level of [2, 6, 10, 14]) {
      assert.equal(new Set(Array.from({ length: 5 }, (_, index) => stationFlowerVariant(level, index))).size, 3)
    }
  })
})

describe('space stations', () => {
  it('routes only space levels to the new factory and forwards the scene lifecycle', () => {
    const scene = read('features/roadmap/RoadmapScene.ts')
    assert.match(scene, /spaceStationArchetype\(row\.level\) \? spaceStations : jungleStations/)
    assert.match(scene, /group\.add\(stationAssets\.create\(designLevel, milestone\)\)/)
    for (const method of ['setTheme', 'setQuality', 'dispose']) {
      assert.ok(scene.includes(`spaceStations.${method}(`))
    }
  })

  it('covers only 11–20 with three types in a 4/3/3 distribution', () => {
    assert.deepEqual(Array.from({ length: 10 }, (_, index) => spaceStationArchetype(index + 11)), [
      'lunar-surface', 'orbital-deck', 'asteroid-outpost',
      'lunar-surface', 'orbital-deck', 'asteroid-outpost',
      'lunar-surface', 'orbital-deck', 'asteroid-outpost', 'lunar-surface',
    ])
    for (const level of [0, 10, 11.5, 21, 50, NaN]) assert.equal(spaceStationArchetype(level), null)
  })

  it('keeps essential props, flat landing tops and shader textures at every quality', () => {
    const assets = createSpaceStationAssets('light', 'low')
    try {
      for (let level = 11; level <= 20; level++) {
        const station = assets.create(level, level === 20)
        const detail = station.getObjectByName('space-fine-detail')!
        assert.equal(detail.visible, false)
        const ground = station.getObjectByName('space-ground')!
        station.updateMatrixWorld(true)
        const bounds = new THREE.Box3().setFromObject(ground)
        assert.ok(Math.abs(bounds.max.y - 0.08 * (level === 20 ? 1.22 : 1)) < 1e-6)
        let meshes = 0
        station.traverseVisible((object) => {
          if (object instanceof THREE.Mesh) {
            meshes++
            assert.ok(object.material instanceof THREE.ShaderMaterial)
          }
        })
        assert.ok(meshes >= 6 && meshes <= 9)
        assets.setQuality('high')
        assert.equal(detail.visible, true)
        assets.setQuality('low')
      }
      assert.throws(() => assets.create(21, false), RangeError)
    } finally { assets.dispose() }
  })

  it('pairs solar panels with a small instrument and satellite dishes with a small rock', () => {
    const assets = createSpaceStationAssets('light', 'low')
    try {
      for (const level of [12, 15, 18]) {
        const station = assets.create(level, false)
        const names: string[] = []
        station.traverseVisible((object) => names.push(object.name))
        assert.equal(names.filter((name) => name === 'solar-cells').length, 2)
        assert.ok(names.includes('orbital-instrument-box'))
        assert.ok(!names.some((name) => name.includes('beacon')))
      }
      for (const level of [13, 16, 19]) {
        const station = assets.create(level, false)
        const names: string[] = []
        station.traverseVisible((object) => names.push(object.name))
        assert.equal(names.filter((name) => name === 'antenna-dish').length, 2)
        assert.ok(names.includes('asteroid-fragment'))
        assert.ok(!names.some((name) => /sample|canister/.test(name)))
        station.updateMatrixWorld(true)
        const bounds = new THREE.Box3().setFromObject(station.getObjectByName('asteroid-fragment')!)
        assert.ok(Math.abs(bounds.min.y - 0.08) < 1e-6)
        assert.ok(bounds.getSize(new THREE.Vector3()).length() < 0.7)
      }
    } finally { assets.dispose() }
  })

  it('sizes main space props to 70 percent of standing Yuvi, including milestone stations', () => {
    const assets = createSpaceStationAssets('light', 'low')
    try {
      for (let level = 11; level <= 20; level++) {
        const station = assets.create(level, level === 20)
        station.updateMatrixWorld(true)
        const props = station.children.filter((child) => child.userData.spaceProp)
        assert.ok(props.length >= 2)
        for (const prop of props) {
          const bounds = new THREE.Box3().setFromObject(prop)
          const size = bounds.getSize(new THREE.Vector3())
          assert.ok(Math.abs(Math.max(size.x, size.y, size.z) - 2.1 * 0.7) < 1e-6, prop.name)
          assert.ok(Math.abs(bounds.min.y - 0.08 * station.scale.y) < 1e-6, prop.name)
          const nearestAcross = Math.max(bounds.min.x, Math.min(0, bounds.max.x))
          const nearestDepth = Math.max(bounds.min.z, Math.min(0, bounds.max.z))
          assert.ok(Math.hypot(nearestAcross, nearestDepth) > 0.75, prop.name)
        }
      }
    } finally { assets.dispose() }
  })

  it('shares and disposes resources once, with deterministic placement and live theme colors', () => {
    const assets = createSpaceStationAssets('light', 'high')
    const resources = new Set<THREE.BufferGeometry | THREE.Material>()
    const transforms = (station: THREE.Group) => {
      const result: number[][] = []
      station.traverse((object) => {
        result.push([...object.position.toArray(), ...object.quaternion.toArray(), ...object.scale.toArray()])
        if (object instanceof THREE.Mesh) {
          resources.add(object.geometry)
          resources.add(object.material)
        }
      })
      return result
    }
    for (let level = 11; level <= 20; level++) {
      assert.deepEqual(transforms(assets.create(level, level === 20)), transforms(assets.create(level, level === 20)))
    }
    const ground = assets.create(11, false).getObjectByName('space-ground') as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>
    const color = ground.material.uniforms.uBase.value.getHex()
    assets.setTheme('dark')
    assert.notEqual(ground.material.uniforms.uBase.value.getHex(), color)
    let disposed = 0
    resources.forEach((resource) => resource.addEventListener('dispose', () => { disposed++ }))
    assets.dispose()
    assert.equal(disposed, resources.size)
  })
})

describe('music stations', () => {
  it('routes music levels independently and forwards the scene lifecycle', () => {
    const scene = read('features/roadmap/RoadmapScene.ts')
    assert.match(scene, /musicStationArchetype\(row\.level\) \? musicStations/)
    for (const method of ['setTheme', 'setQuality', 'dispose']) assert.ok(scene.includes(`musicStations.${method}(`))
  })

  it('selects only 21-30 with a 4/3/3 live, DJ and drum pattern', () => {
    assert.deepEqual(Array.from({ length: 10 }, (_, index) => musicStationArchetype(index + 21)), [
      'live-stage', 'dj-booth', 'drum-stage', 'live-stage', 'dj-booth',
      'drum-stage', 'live-stage', 'dj-booth', 'drum-stage', 'live-stage',
    ])
    for (const level of [20, 31, 21.5, NaN]) assert.equal(musicStationArchetype(level), null)
  })

  it('fits three grounded music props around the platform circle without overhang or center obstruction', () => {
    const assets = createMusicStationAssets('light', 'low')
    try {
      for (let level = 21; level <= 30; level++) {
        const station = assets.create(level, level === 30)
        station.updateMatrixWorld(true)
        const props = station.children.filter((object) => object.userData.musicProp)
        assert.equal(props.length, 3)
        const boxes = props.map((prop) => new THREE.Box3().setFromObject(prop))
        for (let index = 0; index < boxes.length; index++) {
          for (const other of boxes.slice(index + 1)) assert.equal(boxes[index].intersectsBox(other), false)
        }
        for (const bounds of boxes) {
          const size = bounds.getSize(new THREE.Vector3())
          assert.ok(Math.max(size.x, size.y, size.z) <= 1.47 + 1e-6)
          assert.ok(Math.max(size.x, size.y, size.z) >= 0.65)
          assert.ok(Math.abs(bounds.min.y - 0.08 * station.scale.y) < 1e-6)
          assert.ok(bounds.distanceToPoint(new THREE.Vector3(0, bounds.min.y, 0)) > 0.75)
          const center = bounds.getCenter(new THREE.Vector3())
          assert.ok(Math.abs(Math.hypot(center.x, center.z) - 1.3 * station.scale.x) < 1e-6)
          for (const across of [bounds.min.x, bounds.max.x]) {
            for (const depth of [bounds.min.z, bounds.max.z]) {
              assert.ok(Math.hypot(across, depth) < 1.8 * station.scale.x)
            }
          }
        }
        const ground = new THREE.Box3().setFromObject(station.getObjectByName('music-ground')!)
        assert.ok(Math.abs(ground.max.y - 0.08 * station.scale.y) < 1e-6)
        assert.equal(station.getObjectByName('music-fine-detail')!.visible, false)
        assets.setQuality('high')
        assert.equal(station.getObjectByName('music-fine-detail')!.visible, true)
        assets.setQuality('low')
        const names: string[] = []
        station.traverseVisible((object) => {
          names.push(object.name)
          if (object instanceof THREE.Mesh) assert.ok(object.material instanceof THREE.ShaderMaterial)
        })
        if (musicStationArchetype(level) === 'live-stage') assert.ok(names.includes('guitar-body') && names.includes('microphone-grille'))
        if (musicStationArchetype(level) === 'dj-booth') assert.equal(names.filter((name) => name === 'turntable-record').length, 2)
        if (musicStationArchetype(level) === 'drum-stage') {
          assert.ok(names.includes('bass-drum') && names.includes('brushed-cymbal'))
          assert.equal(names.filter((name) => name === 'drum-stool-leg').length, 4)
          assert.ok(names.includes('drum-stool-footrest'))
          const seat = new THREE.Box3().setFromObject(station.getObjectByName('drum-stool-seat')!).getSize(new THREE.Vector3())
          assert.ok(seat.y < seat.x * 0.2)
          const stool = new THREE.Box3().setFromObject(station.getObjectByName('music-drum-stool')!).getSize(new THREE.Vector3())
          assert.ok(stool.y > stool.x * 1.8)
        }
      }
      assert.throws(() => assets.create(31, false), RangeError)
    } finally { assets.dispose() }
  })

  it('uses deterministic layouts, live theme uniforms and exactly-once shared resource disposal', () => {
    const assets = createMusicStationAssets('light', 'high')
    const resources = new Set<THREE.BufferGeometry | THREE.Material>()
    const transforms = (station: THREE.Group) => {
      const result: number[][] = []
      station.traverse((object) => {
        result.push([...object.position.toArray(), ...object.quaternion.toArray(), ...object.scale.toArray()])
        if (object instanceof THREE.Mesh) { resources.add(object.geometry); resources.add(object.material) }
      })
      return result
    }
    for (let level = 21; level <= 30; level++) {
      assert.deepEqual(transforms(assets.create(level, level === 30)), transforms(assets.create(level, level === 30)))
    }
    const ground = assets.create(21, false).getObjectByName('music-ground') as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>
    const color = ground.material.uniforms.uBase.value.getHex()
    assets.setTheme('dark')
    assert.notEqual(ground.material.uniforms.uBase.value.getHex(), color)
    let disposed = 0
    resources.forEach((resource) => resource.addEventListener('dispose', () => { disposed++ }))
    assets.dispose()
    assert.equal(disposed, resources.size)
  })
})

describe('graffiti stations', () => {
  it('routes graffiti levels independently and forwards theme, quality and disposal', () => {
    const scene = read('features/roadmap/RoadmapScene.ts')
    assert.match(scene, /graffitiStationArchetype\(row\.level\) \? graffitiStations/)
    for (const method of ['setTheme', 'setQuality', 'dispose']) assert.ok(scene.includes(`graffitiStations.${method}(`))
  })

  it('selects only 31-40 in the approved mural, skate, studio pattern', () => {
    assert.deepEqual(Array.from({ length: 10 }, (_, index) => graffitiStationArchetype(index + 31)), [
      'mural-corner', 'skate-spot', 'street-art-studio', 'mural-corner', 'skate-spot',
      'street-art-studio', 'mural-corner', 'skate-spot', 'street-art-studio', 'mural-corner',
    ])
    for (const level of [0, 30, 41, 31.5, NaN, Infinity]) assert.equal(graffitiStationArchetype(level), null)
  })

  it('keeps three grounded, nonoverlapping shader-textured props inside each platform at every tier', () => {
    for (const tier of ['low', 'medium', 'high'] as const) {
      const assets = createGraffitiStationAssets('light', tier)
      try {
        for (let level = 31; level <= 40; level++) {
          const station = assets.create(level, level === 40)
          station.updateMatrixWorld(true)
          const props = station.children.filter((object) => object.userData.graffitiProp)
          assert.equal(props.length, 3)
          const boxes = props.map((prop) => new THREE.Box3().setFromObject(prop))
          for (let index = 0; index < boxes.length; index++) {
            for (const other of boxes.slice(index + 1)) assert.equal(boxes[index].intersectsBox(other), false)
          }
          for (const [index, bounds] of boxes.entries()) {
            const size = bounds.getSize(new THREE.Vector3())
            assert.ok(Math.max(size.x, size.y, size.z) <= (props[index].userData.largeMural ? 1.85 : 1.47) + 1e-6)
            assert.ok(Math.max(size.x, size.y, size.z) >= 0.65)
            assert.ok(Math.abs(bounds.min.y - 0.08 * station.scale.y) < 1e-6)
            assert.ok(bounds.distanceToPoint(new THREE.Vector3(0, bounds.min.y, 0)) > 0.75)
            const center = bounds.getCenter(new THREE.Vector3())
            assert.ok(Math.abs(Math.hypot(center.x, center.z) - 1.3 * station.scale.x) < 1e-6)
            for (const across of [bounds.min.x, bounds.max.x]) {
              for (const depth of [bounds.min.z, bounds.max.z]) assert.ok(Math.hypot(across, depth) < 1.8 * station.scale.x)
            }
          }
          const ground = new THREE.Box3().setFromObject(station.getObjectByName('graffiti-ground')!)
          assert.ok(Math.abs(ground.max.y - 0.08 * station.scale.y) < 1e-6)
          const detail = station.getObjectByName('graffiti-fine-detail')!
          assert.equal(detail.visible, tier !== 'low')
          assets.setQuality('low')
          assert.equal(detail.visible, false)
          const names: string[] = []
          station.traverseVisible((object) => {
            names.push(object.name)
            if (object instanceof THREE.Mesh) assert.ok(object.material instanceof THREE.ShaderMaterial)
          })
          if (graffitiStationArchetype(level) === 'mural-corner') {
            assert.ok(names.includes('painted-brick-wall') && names.includes('bucket-handle'))
            assert.equal(names.filter((name) => name === 'spray-can-body').length, 3)
          } else if (graffitiStationArchetype(level) === 'skate-spot') {
            assert.ok(names.includes('painted-skateboard') && names.includes('skate-ledge-block'))
            assert.equal(names.filter((name) => name === 'skateboard-wheel').length, 4)
          } else {
            assert.ok(names.includes('easel-painting') && names.includes('paint-roller') && names.includes('crate-bottom'))
          }
          assets.setQuality('high')
          assert.equal(detail.visible, true)
          assets.setQuality(tier)
        }
        assert.throws(() => assets.create(41, false), RangeError)
      } finally { assets.dispose() }
    }
  })

  it('uses distinct artwork on every station and floor, larger murals, and shaped aerosol cans', () => {
    const assets = createGraffitiStationAssets('light', 'low')
    try {
      const styles = new Set<string>()
      const floorPatterns = new Set<number>()
      const mainPatterns = new Set<number>()
      for (let level = 31; level <= 40; level++) {
        const station = assets.create(level, level === 40)
        station.updateMatrixWorld(true)
        styles.add(graffitiArtStyle(level)!)
        const ground = station.getObjectByName('graffiti-ground') as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>
        floorPatterns.add(ground.material.uniforms.uPattern.value)
        const painting = (station.getObjectByName('painted-brick-wall') ?? station.getObjectByName('painted-skateboard') ?? station.getObjectByName('easel-painting')) as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>
        mainPatterns.add(painting.material.uniforms.uPattern.value)
        assert.notEqual(ground.material.uniforms.uPattern.value, painting.material.uniforms.uPattern.value)
        if (graffitiStationArchetype(level) !== 'skate-spot') {
          const size = new THREE.Box3().setFromObject(painting).getSize(new THREE.Vector3())
          assert.ok(size.x > 1.0 && size.y > 1.0, `mural size at ${level}`)
        }
        const body = station.getObjectByName('spray-can-body') as THREE.Mesh
        assert.equal(body.geometry.type, 'LatheGeometry')
        assert.ok(station.getObjectByName('spray-can-base-rim'))
        assert.ok(station.getObjectByName('spray-can-valve-rim'))
        const nozzle = station.getObjectByName('spray-can-nozzle') as THREE.Mesh
        assert.equal(nozzle.geometry.type, 'CylinderGeometry')
        const label = station.getObjectByName('spray-can-label') as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>
        assert.equal(label.material.uniforms.uKind.value, 6)
      }
      assert.equal(styles.size, 5)
      assert.equal(floorPatterns.size, 10)
      assert.equal(mainPatterns.size, 10)
    } finally { assets.dispose() }
  })

  it('shares resources with deterministic transforms, live colors and exactly-once disposal', () => {
    const assets = createGraffitiStationAssets('light', 'high')
    const resources = new Set<THREE.BufferGeometry | THREE.Material>()
    const transforms = (station: THREE.Group) => {
      const result: number[][] = []
      station.traverse((object) => {
        result.push([...object.position.toArray(), ...object.quaternion.toArray(), ...object.scale.toArray()])
        if (object instanceof THREE.Mesh) { resources.add(object.geometry); resources.add(object.material) }
      })
      return result
    }
    for (let level = 31; level <= 40; level++) assert.deepEqual(transforms(assets.create(level, level === 40)), transforms(assets.create(level, level === 40)))
    const ground = assets.create(31, false).getObjectByName('graffiti-ground') as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>
    const color = ground.material.uniforms.uBase.value.getHex()
    assets.setTheme('dark')
    assert.notEqual(ground.material.uniforms.uBase.value.getHex(), color)
    assets.setTheme('light')
    assert.equal(ground.material.uniforms.uBase.value.getHex(), color)
    let disposed = 0
    resources.forEach((resource) => resource.addEventListener('dispose', () => { disposed++ }))
    assets.dispose()
    assert.equal(disposed, resources.size)
  })
})

describe('snow stations', () => {
  it('bakes the shared Yubi astronaut only on entering space and owns its texture', () => {
    let bakes = 0, disposed = 0
    const targets: THREE.WebGLRenderTarget[] = []
    const background = createRoadmapBackground('dark', 'low', false, () => {
      bakes++
      const target = new THREE.WebGLRenderTarget(16, 16)
      target.addEventListener('dispose', () => { disposed++ })
      targets.push(target)
      return target
    })
    const renderer = { render() {} } as unknown as THREE.WebGLRenderer
    background.update(0, 0, 1.6, 1)
    background.render(renderer)
    assert.equal(bakes, 0)
    background.update(9.5, 1, 1.6, 1)
    background.render(renderer)
    background.update(10, 2, 1.6, 1)
    background.render(renderer)
    assert.equal(bakes, 1)
    const backdrop = background.scene.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>
    assert.equal(backdrop.material.uniforms.uAstronaut.value, targets[0].texture)
    assert.equal(backdrop.material.uniforms.uAstronautReady.value, 1)
    background.resetAstronaut()
    assert.equal(disposed, 1)
    assert.equal(backdrop.material.uniforms.uAstronautReady.value, 0)
    background.render(renderer)
    assert.equal(bakes, 2)
    assert.equal(backdrop.material.uniforms.uAstronaut.value, targets[1].texture)
    background.dispose()
    assert.equal(disposed, 2)
    const source = read('features/roadmap/RoadmapAstronaut.ts')
    assert.match(source, /createRoadmapYuvi\(design\)/)
    assert.match(source, /design\.equipped\.headTop = 'astro'/)
    assert.match(read('features/roadmap/RoadmapScene.ts'), /createRoadmapBackground\(theme, tier, reduceMotion, createRoadmapAstronautTexture\)/)
    assert.match(read('features/roadmap/RoadmapScene.ts'), /onContextLost = [^\n]+background\.resetAstronaut\(\)/)
  })

  it('shares one backdrop and particle pool with live palettes, quality and frozen reduced-motion time', () => {
    for (const reduced of [false, true]) {
      const background = createRoadmapBackground('light', 'high', reduced)
      const backdrop = background.scene.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>
      const particles = background.scene.children[1] as THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>
      assert.equal(background.scene.children.length, 2)
      assert.equal(particles.geometry.drawRange.count, 1350)
      background.setQuality('low')
      assert.equal(particles.geometry.drawRange.count, 240)
      background.setQuality('medium')
      assert.equal(particles.geometry.drawRange.count, 660)
      assert.equal(particles.material.uniforms.uParticleLimit.value, 220)
      background.update(9.5, 12, 390 / 844, 1.5)
      const uniforms = backdrop.material.uniforms
      assert.equal(uniforms.uMix.value, 0.5)
      assert.equal(uniforms.uTime.value, reduced ? 0 : 12)
      assert.equal(uniforms.uAspect.value, 390 / 844)
      const light = uniforms.uTop.value.map((color: THREE.Color) => color.getHex())
      background.setTheme('dark')
      uniforms.uTop.value.forEach((color: THREE.Color, index: number) => assert.notEqual(color.getHex(), light[index]))
      for (const progress of [0, 10, 20, 30, 40, 49]) {
        background.update(progress, 30, 1.6, 1)
        assert.equal(uniforms.uFrom.value, Math.min(4, Math.floor(progress / 10)))
        assert.ok(Number.isFinite(background.fogColor.r))
      }
      let disposed = 0
      for (const resource of [backdrop.geometry, backdrop.material, particles.geometry, particles.material]) resource.addEventListener('dispose', () => { disposed++ })
      background.dispose()
      assert.equal(disposed, 4)
    }
  })

  it('blends background worlds continuously only between boundary stations', () => {
    for (const boundary of [9, 19, 29, 39]) {
      const world = Math.floor(boundary / 10)
      assert.deepEqual(roadmapBackgroundBlend(boundary), { from: world, to: world + 1, mix: 0 })
      assert.deepEqual(roadmapBackgroundBlend(boundary + 0.5), { from: world, to: world + 1, mix: 0.5 })
      assert.equal(roadmapBackgroundBlend(boundary + 1).from, world + 1)
      assert.ok(roadmapBackgroundBlend(boundary + 0.999).mix > 0.999)
    }
    for (const progress of [-1, NaN, Infinity]) assert.equal(roadmapBackgroundBlend(progress).from, 0)
    for (const progress of [40, 45, 49, 100]) assert.deepEqual(roadmapBackgroundBlend(progress), { from: 4, to: 4, mix: 0 })
  })

  it('renders environments behind the road using the same renderer and eased progress', () => {
    const scene = read('features/roadmap/RoadmapScene.ts')
    const background = read('features/roadmap/RoadmapBackground.ts')
    assert.match(scene, /background\.update\(progress, clock\.t, camera\.aspect, renderer\.getPixelRatio\(\)\)/)
    assert.match(scene, /background\.render\(renderer\)\s+renderer\.clearDepth\(\)\s+renderer\.render\(scene, camera\)/)
    for (const method of ['setTheme', 'setQuality', 'dispose']) assert.ok(scene.includes(`background.${method}(`))
    assert.doesNotMatch(background, /requestAnimationFrame|setInterval|new THREE.WebGLRenderer/)
    assert.doesNotMatch(scene, /dustPositions|DUST_MAX/)
    assert.doesNotMatch(read('features/roadmap/roadmap.css'), /rm-stars/)
  })

  it('retains recognizable snowy boughs, orbital props, music notation and Yubi street murals', () => {
    const assets = createRoadmapBackground('light', 'high', false)
    try {
      const backdrop = assets.scene.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>
      const particles = assets.scene.children[1] as THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>
      for (const symbol of ['snowyFir', 'astronautArt', 'spaceStationArt', 'doughnutArt', 'dogArt', 'orbitalDrift', 'yubiMuralArt', 'waterTank', 'landing', 'stoop']) assert.ok(backdrop.material.fragmentShader.includes(symbol))
      assert.match(backdrop.material.fragmentShader, /fract\(phase\+uTime\*speed\)/)
      for (const detail of ['deepStarfield', 'starTrails', 'lunarSurface', 'lunarTerrain', 'fwidth(length(local))', 'vec3 craterNormal=', 'float innerWall=', 'float ejecta=', 'float maria=', 'float bowl=', 'float taper=']) {
        assert.ok(backdrop.material.fragmentShader.includes(detail))
      }
      assert.ok(backdrop.material.fragmentShader.indexOf('color=starTrails(') < backdrop.material.fragmentShader.indexOf('color=lunarSurface('))
      assert.match(backdrop.material.fragmentShader, /orbitalDrift\(0\.24,0\.009/)
      assert.match(backdrop.material.fragmentShader, /orbitalDrift\(0\.73,-0\.018/)
      assert.match(backdrop.material.fragmentShader, /orbitalDrift\(0\.4,0\.012/)
      for (const motion of ['turn(-0.23+uTime*0.07)', 'sin(uTime*0.15+1.0)', 'turn(0.22+uTime*0.024)', 'turn(uTime*0.34)', 'turn(-0.4-uTime*0.22)']) {
        assert.ok(backdrop.material.fragmentShader.includes(motion))
      }
      for (const symbol of ['trebleClef', 'noteGlyph']) assert.ok(particles.material.fragmentShader.includes(symbol))
      assert.equal(particles.geometry.getAttribute('aIndex').count, 1350)
      assert.ok(particles.material.vertexShader.includes('aIndex >= uParticleLimit'))
      assets.update(19.5, 10, 1.6, 1)
      assert.equal(backdrop.material.uniforms.uMix.value, 0.5)
    } finally { assets.dispose() }
  })

  it('swaps only the first and last ten station designs, preserving exact variants and milestones', () => {
    for (let level = 1; level <= 50; level++) {
      const designLevel = stationDesignLevel(level)
      assert.equal(designLevel, level <= 10 ? level + 40 : level >= 41 ? level - 40 : level)
      assert.equal(stationDesignLevel(designLevel), level)
      assert.equal(isMilestone(designLevel), isMilestone(level))
      if (level <= 10) assert.equal(snowStationArchetype(designLevel), snowStationArchetype(level + 40))
      if (level >= 41) assert.equal(stationArchetype(designLevel), stationArchetype(level - 40))
    }
    const scene = read('features/roadmap/RoadmapScene.ts')
    assert.match(scene, /const designLevel = stationDesignLevel\(row\.level\)/)
    assert.match(scene, /const milestone = isMilestone\(row\.level\)/)
    assert.match(scene, /const state = levelState\(row\.level, status\)/)
    assert.equal((scene.match(/stationDesignLevel\(row\.level\)/g) ?? []).length, 1)
  })

  it('routes snow levels independently and forwards the static scene lifecycle', () => {
    const scene = readFileSync(new URL('../src/features/roadmap/RoadmapScene.ts', import.meta.url), 'utf8')
    assert.match(scene, /snowStationArchetype\(designLevel\) \? snowStations/)
    for (const method of ['setTheme', 'setQuality', 'dispose']) assert.ok(scene.includes(`snowStations.${method}(`))
  })

  it('selects only 41-50 with the approved grove, ski and camp pattern', () => {
    assert.deepEqual(Array.from({ length: 10 }, (_, index) => snowStationArchetype(index + 41)), [
      'snowy-grove', 'ski-stop', 'ice-camp', 'snowy-grove', 'ski-stop',
      'ice-camp', 'snowy-grove', 'ski-stop', 'ice-camp', 'snowy-grove',
    ])
    for (const level of [0, 40, 51, 41.5, NaN, Infinity]) assert.equal(snowStationArchetype(level), null)
  })

  it('keeps larger snow props grounded and contained, with a snowman in each grove at every quality', () => {
    for (const tier of ['low', 'medium', 'high'] as const) {
      const assets = createSnowStationAssets('light', tier)
      try {
        for (let level = 41; level <= 50; level++) {
          const station = assets.create(level, level === 50)
          station.updateMatrixWorld(true)
          assert.equal(station.scale.x, level === 50 ? 1.22 : 1)
          const props = station.children.filter((object) => object.userData.snowProp)
          assert.equal(props.length, snowStationArchetype(level) === 'snowy-grove' ? 4 : 3)
          const boxes = props.map((prop) => new THREE.Box3().setFromObject(prop))
          for (let index = 0; index < boxes.length; index++) {
            for (const other of boxes.slice(index + 1)) assert.equal(boxes[index].intersectsBox(other), false)
          }
          for (const bounds of boxes) {
            const size = bounds.getSize(new THREE.Vector3())
            assert.ok(Math.max(size.x, size.y, size.z) <= 1.7 + 1e-6)
            assert.ok(Math.max(size.x, size.y, size.z) >= 0.65)
            assert.ok(Math.abs(bounds.min.y - 0.08 * station.scale.y) < 1e-6)
            assert.ok(bounds.distanceToPoint(new THREE.Vector3(0, bounds.min.y, 0)) > 0.75)
            for (const across of [bounds.min.x, bounds.max.x]) {
              for (const depth of [bounds.min.z, bounds.max.z]) assert.ok(Math.hypot(across, depth) < 1.8 * station.scale.x)
            }
          }
          const ground = new THREE.Box3().setFromObject(station.getObjectByName('snow-ground')!)
          assert.ok(Math.abs(ground.max.y - 0.08 * station.scale.y) < 1e-6)
          assert.ok(ground.max.y - ground.min.y > 0.4 * station.scale.y)
          const detail = station.getObjectByName('snow-fine-detail')!
          assert.equal(detail.visible, tier !== 'low')
          assets.setQuality('low')
          assert.equal(detail.visible, false)
          const names: string[] = []
          station.traverseVisible((object) => {
            names.push(object.name)
            if (object instanceof THREE.Mesh) assert.ok(object.material instanceof THREE.ShaderMaterial)
          })
          if (snowStationArchetype(level) === 'snowy-grove') {
            assert.ok(names.includes('snowman-head') && names.includes('snowman-carrot') && names.includes('snowman-scarf'))
            const snowman = new THREE.Box3().setFromObject(station.getObjectByName('snowman')!)
            assert.ok(snowman.max.y - snowman.min.y > 1.2)
            assert.equal(names.filter((name) => name === 'sled-runner').length, 2)
            assert.equal(names.filter((name) => name === 'fir-snow-cap').length, 3)
            assert.ok(names.includes('lantern-light') && names.includes('lantern-handle'))
          } else if (snowStationArchetype(level) === 'ski-stop') {
            assert.equal(names.filter((name) => name === 'curved-ski').length, 2)
            assert.equal(names.filter((name) => name === 'ski-binding').length, 4)
            assert.ok(names.includes('bench-seat-snow') && names.includes('backpack-pocket'))
          } else {
            assert.equal(names.filter((name) => name === 'ice-crystal-tip').length, 3)
            assert.ok(names.includes('igloo-entrance') && names.includes('flag-fabric'))
          }
          assert.equal(names.filter((name) => name === 'snowbank').length, 16)
          assets.setQuality('high')
          assert.equal(detail.visible, true)
          assets.setQuality(tier)
        }
        assert.throws(() => assets.create(51, false), RangeError)
      } finally { assets.dispose() }
    }
  })

  it('has a real open igloo doorway with a closed roof and rear shell', () => {
    const assets = createSnowStationAssets('light', 'low')
    try {
      const station = assets.create(43, false)
      const igloo = station.getObjectByName('snow-igloo')!
      igloo.removeFromParent()
      igloo.position.set(0, 0, 0)
      igloo.scale.setScalar(1)
      igloo.updateMatrixWorld(true)
      const ray = new THREE.Raycaster(new THREE.Vector3(0, 0.12, 2), new THREE.Vector3(0, 0, -1))
      const hits = ray.intersectObject(igloo, true)
      assert.ok(hits.length > 0)
      assert.ok(hits.every((hit) => hit.point.z < 0))
      ray.set(new THREE.Vector3(0, 0.48, 2), new THREE.Vector3(0, 0, -1))
      assert.ok(ray.intersectObject(igloo, true).some((hit) => hit.point.z > 0))
    } finally { assets.dispose() }
  })

  it('shares resources, repeats layouts and updates theme colors without leaking materials', () => {
    const assets = createSnowStationAssets('light', 'high')
    const resources = new Set<THREE.BufferGeometry | THREE.Material>()
    const transforms = (station: THREE.Group) => {
      const result: number[][] = []
      station.traverse((object) => {
        result.push([...object.position.toArray(), ...object.quaternion.toArray(), ...object.scale.toArray()])
        if (object instanceof THREE.Mesh) { resources.add(object.geometry); resources.add(object.material) }
      })
      return result
    }
    for (let level = 41; level <= 50; level++) assert.deepEqual(transforms(assets.create(level, level === 50)), transforms(assets.create(level, level === 50)))
    const ground = assets.create(41, false).getObjectByName('snow-ground') as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>
    const color = ground.material.uniforms.uBase.value.getHex()
    assets.setTheme('dark')
    assert.notEqual(ground.material.uniforms.uBase.value.getHex(), color)
    assets.setTheme('light')
    assert.equal(ground.material.uniforms.uBase.value.getHex(), color)
    let disposed = 0
    resources.forEach((resource) => resource.addEventListener('dispose', () => { disposed++ }))
    assets.dispose()
    assert.equal(disposed, resources.size)
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

  it('stays upright and front-facing between occasional spins while drifting into the road', () => {
    for (const rtl of [false, true]) {
      const origin = yuviPosition(status(5), 50, 4, rtl)
      const destination = yuviPosition(status(5), 50, 5, rtl)
      const flight = createYuviFlight(origin)
      flight.retarget(destination)
      flight.update(0.4)
      assert.ok(flight.position.z < origin.z)
      assert.ok(flight.position.z > destination.z)
      assert.equal(flight.yaw, 0)
      flight.update(2)
      assert.deepEqual(flight.position, destination)
    }
    const scene = read('features/roadmap/RoadmapScene.ts')
    const avatar = read('features/roadmap/RoadmapYuvi.ts')
    assert.match(scene, /yuvi\.object\.rotation\.set\(0, yuviFlight\.yaw, yuviFlight\.bank\)/)
    assert.match(scene, /yuviFlight\.retarget\(yuviPosition\(status, count, index, document\.documentElement\.dir === 'rtl'\), spin, reduceMotion \|\| immediate\)/)
    assert.match(scene, /if \(browsing && !immediate\) flightCount\+\+/)
    assert.match(scene, /const spin = browsing && !immediate && flightCount % 3 === 0 \? \(flightCount % 2 === 0 \? -1 : 1\) : 0/)
    assert.doesNotMatch(scene + avatar, /horizontalFlight|horizontalBlend|flightPitch|horizontalFaceTurn|leadLeft/)
    assert.match(avatar, /pose\.headYaw \* \(1 - flightBlend\),/)
  })

  it('shares the scene renderer and follows live level and design updates', () => {
    const scene = read('features/roadmap/RoadmapScene.ts')
    const avatar = read('features/roadmap/RoadmapYuvi.ts')
    assert.match(scene, /yuvi\.update\(clock\.t, reduceMotion, yuviFlight\.active \|\| hovering, dt\)/)
    assert.match(scene, /placeBeacon\(\)\s+targetYuvi\(\)/)
    assert.match(scene, /targetYuvi\(previous < 0, true\)/)
    assert.match(scene, /const yuviStandingAtCurrent = !yuviFlight\.active && yuviFocus === status\.level - 1/)
    assert.match(scene, /const beaconTarget = yuviStandingAtCurrent \? 0 : 1/)
    assert.match(scene, /anchorAt\(Math\.max\(0, Math\.min\(count - 1, status\.level - 1\)\)\)/)
    assert.doesNotMatch(scene, /beaconDistance|nearbyFade/)
    assert.match(avatar, /roadmap-yuvi-thruster/)
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
    assert.match(scene, /stationAssets\.create\(designLevel, milestone\)/)
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
