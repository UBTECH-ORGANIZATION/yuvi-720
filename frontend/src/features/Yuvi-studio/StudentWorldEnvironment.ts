import * as THREE from 'three'
import type { RoomLayoutId } from './RoomLayouts'

type StudentWorldId = Exclude<RoomLayoutId, 'lab'>

interface EnvironmentOptions {
  id: StudentWorldId
  floorY: number
  rich: boolean
  reduceMotion: boolean
}

export interface StudentWorldEnvironment {
  group: THREE.Group
  floorMaterial: THREE.MeshStandardMaterial
  update: (elapsed: number) => void
  dispose: () => void
}

const HALF_X = 24.4
const BACK_Z = -25.8
const FRONT_Z = 32.7
const DEPTH = FRONT_Z - BACK_Z
const MID_Z = (BACK_Z + FRONT_Z) / 2

export function createStudentWorldEnvironment(options: EnvironmentOptions): StudentWorldEnvironment {
  const { id, floorY, rich, reduceMotion } = options
  const group = new THREE.Group()
  group.name = `student-world-${id}`
  const resources = new Set<{ dispose: () => void }>()
  const track = <T extends { dispose: () => void }>(resource: T): T => { resources.add(resource); return resource }
  const animated: Array<(elapsed: number) => void> = []
  const palette = id === 'adventurePark'
    ? { floor: 0x17222a, wall: 0x283640, accent: 0x66f28f, second: 0xffcf4a, dark: 0x10171c }
    : id === 'sportsArena'
      ? { floor: 0x183332, wall: 0x4a2930, accent: 0x45d8df, second: 0xff625f, dark: 0x171315 }
      : { floor: 0x17131f, wall: 0x2c2335, accent: 0xff4fa3, second: 0x54e6ff, dark: 0x0e0b13 }
  const standard = (color: number, emissive = 0x000000) => track(new THREE.MeshStandardMaterial({
    color, roughness: 0.72, metalness: 0.22, emissive, emissiveIntensity: emissive ? 0.7 : 0,
  }))
  const glow = (color: number, opacity = 0.75) => track(new THREE.MeshBasicMaterial({
    color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
  }))
  const floorMaterial = standard(palette.floor)
  const floor = new THREE.Mesh(track(new THREE.PlaneGeometry(HALF_X * 2, DEPTH)), floorMaterial)
  floor.rotation.x = -Math.PI / 2
  floor.position.set(0, floorY + 0.006, MID_Z)
  group.add(floor)
  const wallMaterial = standard(palette.wall)
  const back = new THREE.Mesh(track(new THREE.PlaneGeometry(HALF_X * 2, 12)), wallMaterial)
  back.position.set(0, floorY + 6, BACK_Z)
  group.add(back)
  const sideGeometry = track(new THREE.PlaneGeometry(DEPTH, 12))
  const left = new THREE.Mesh(sideGeometry, wallMaterial)
  left.rotation.y = Math.PI / 2
  left.position.set(-HALF_X, floorY + 6, MID_Z)
  group.add(left)
  const right = left.clone()
  right.rotation.y = -Math.PI / 2
  right.position.x = HALF_X
  group.add(right)
  const ceiling = new THREE.Mesh(track(new THREE.PlaneGeometry(HALF_X * 2, DEPTH)), standard(palette.dark))
  ceiling.rotation.x = Math.PI / 2
  ceiling.position.set(0, floorY + 12, MID_Z)
  group.add(ceiling)

  const box = (width: number, height: number, depth: number, material: THREE.Material, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(track(new THREE.BoxGeometry(width, height, depth)), material)
    mesh.position.set(x, y, z)
    group.add(mesh)
    return mesh
  }

  const cylinder = (radius: number, height: number, material: THREE.Material, x: number, y: number, z: number, radialSegments = 12) => {
    const mesh = new THREE.Mesh(track(new THREE.CylinderGeometry(radius, radius, height, radialSegments)), material)
    mesh.position.set(x, y, z)
    group.add(mesh)
    return mesh
  }

  if (id === 'adventurePark') {
    const warehouse = new THREE.Group()
    warehouse.name = 'adventure-warehouse'
    group.add(warehouse)
    const steel = standard(0x17232a)
    const concrete = standard(0x35444a)
    const timber = standard(0x8a6845)
    const rubber = standard(0x252d31)
    const chalk = standard(0xcbd4d0)
    const plant = standard(0x3f7f59)
    const holdMaterials = [glow(palette.accent, 0.9), glow(palette.second, 0.85), glow(0xff6f91, 0.82)]

    for (const x of [-23.2, -12, 0, 12, 23.2]) {
      const column = box(0.42, 11.4, 0.42, steel, x, floorY + 5.7, BACK_Z + 0.55)
      warehouse.attach(column)
    }
    for (const z of [BACK_Z + 1.2, MID_Z, FRONT_Z - 2]) {
      const beam = box(HALF_X * 2 - 1.4, 0.28, 0.34, steel, 0, floorY + 11.2, z)
      warehouse.attach(beam)
    }
    const ductMaterial = standard(0x53656b)
    for (const x of [-16.5, 16.5]) {
      const duct = cylinder(0.48, DEPTH - 5, ductMaterial, x, floorY + 10.45, MID_Z, 16)
      duct.rotation.x = Math.PI / 2
      warehouse.attach(duct)
    }

    const bouldering = new THREE.Group()
    bouldering.name = 'adventure-bouldering'
    group.add(bouldering)
    const climbingPanels: THREE.Mesh[] = []
    for (const [index, x] of [-7.2, 0, 7.2].entries()) {
      const panel = box(7, 8.9, 0.62, index === 1 ? concrete : standard(index === 0 ? 0x405057 : 0x2e3c42), x, floorY + 4.7, BACK_Z + 0.5)
      panel.rotation.x = index === 1 ? -0.055 : index === 0 ? 0.035 : -0.025
      climbingPanels.push(panel)
      bouldering.attach(panel)
      const kickboard = box(6.7, 0.75, 0.3, rubber, x, floorY + 0.38, BACK_Z + 1.05)
      bouldering.attach(kickboard)
      const mat = box(6.5, 0.34, 4.4, standard(index === 1 ? 0x294b48 : 0x3d4546), x, floorY + 0.17, BACK_Z + 3)
      mat.rotation.y = index === 1 ? 0 : index === 0 ? 0.025 : -0.025
      bouldering.attach(mat)
    }
    const holdGeometry = track(new THREE.DodecahedronGeometry(0.24, 0))
    for (let index = 0; index < (rich ? 54 : 30); index += 1) {
      const route = index % 3
      const hold = new THREE.Mesh(holdGeometry, holdMaterials[route])
      const column = index % 9
      hold.position.set(-9.4 + column * 2.35 + Math.sin(index * 1.7) * 0.3, floorY + 1.15 + (index % 6) * 1.28, BACK_Z + 1.02)
      hold.rotation.set(index * 0.7, index * 0.4, 0)
      hold.scale.setScalar(0.72 + (index % 4) * 0.12)
      bouldering.add(hold)
    }
    for (const x of [-7.2, 0, 7.2]) {
      const tag = box(0.7, 0.16, 0.12, holdMaterials[(x === 0 ? 1 : x < 0 ? 0 : 2)], x, floorY + 0.88, BACK_Z + 1.22)
      bouldering.attach(tag)
    }

    const clubhouse = new THREE.Group()
    clubhouse.name = 'adventure-clubhouse'
    group.add(clubhouse)
    for (let tier = 0; tier < 3; tier += 1) {
      const seat = box(7.6 - tier * 0.65, 0.5 + tier * 0.42, 1.75, tier === 2 ? timber : standard(0x654c36), -20.1, floorY + 0.25 + tier * 0.21, 18.6 + tier * 1.35)
      clubhouse.attach(seat)
    }
    const cubbyFrame = box(0.75, 5.5, 6.4, steel, -23.55, floorY + 2.75, 25.4)
    clubhouse.attach(cubbyFrame)
    for (const y of [1.25, 2.65, 4.05]) {
      for (const z of [23.4, 25.4, 27.4]) {
        const cubby = box(0.86, 0.12, 1.65, chalk, -23.08, floorY + y, z)
        clubhouse.attach(cubby)
      }
    }
    const routeBoard = box(0.16, 3.6, 5.2, standard(0x172c2c), -23.85, floorY + 5.7, 14.5)
    clubhouse.attach(routeBoard)
    for (let index = 0; index < 5; index += 1) {
      const routeLine = box(0.12, 0.2, 3.8 - index * 0.45, holdMaterials[index % holdMaterials.length], -23.72, floorY + 4.5 + index * 0.58, 14.5 + (index % 2 ? 0.35 : -0.25))
      clubhouse.attach(routeLine)
    }
    for (const z of [18.2, 21.4, 27.5]) {
      const bottle = cylinder(0.18, 0.72, standard(z === 21.4 ? 0xe0a950 : 0x6e90a1), -22.4, floorY + 1.85, z, 10)
      clubhouse.attach(bottle)
    }

    const gear = new THREE.Group()
    gear.name = 'adventure-gear'
    group.add(gear)
    const ropeMaterial = standard(0xd19a45)
    for (const [index, x] of [-11.3, -9.8, 9.8, 11.3].entries()) {
      const rope = new THREE.Mesh(track(new THREE.TorusGeometry(0.48, 0.075, 8, 24)), ropeMaterial)
      rope.position.set(x, floorY + 2.2 + (index % 2) * 0.55, BACK_Z + 1.15)
      gear.add(rope)
    }
    for (const [index, z] of [17.7, 19.1, 24.5, 26].entries()) {
      const bag = box(0.8, 0.95, 0.48, standard(index % 2 ? 0x416878 : 0x8b4560), -21.7 + (index % 2) * 1.4, floorY + 0.48, z)
      bag.rotation.y = (index - 1.5) * 0.18
      gear.attach(bag)
    }
    for (const x of [-4.5, -3.7, 3.8, 4.65]) {
      const shoe = box(0.62, 0.22, 0.32, standard(x < 0 ? 0x4f7180 : 0xc55b6d), x, floorY + 0.15, BACK_Z + 5.6)
      shoe.rotation.y = x * 0.08
      gear.attach(shoe)
    }

    const mural = new THREE.Group()
    mural.name = 'adventure-mural'
    group.add(mural)
    const muralBase = box(0.18, 7.3, 16.5, standard(0x202c32), 24.15, floorY + 5.1, 15.5)
    mural.attach(muralBase)
    const muralColors = [holdMaterials[0], holdMaterials[1], holdMaterials[2]]
    for (let index = 0; index < (rich ? 14 : 9); index += 1) {
      const stroke = box(0.12, 0.18 + (index % 3) * 0.12, 4.2 + (index % 4) * 0.8, muralColors[index % 3], 24.02, floorY + 2 + (index % 6) * 0.92, 9 + (index % 5) * 2.9)
      stroke.rotation.x = (index % 2 ? 1 : -1) * (0.18 + (index % 4) * 0.08)
      mural.attach(stroke)
    }
    for (const [index, z] of [10, 17, 24].entries()) {
      const poster = box(0.11, 2.1 + index * 0.3, 1.55, standard(index % 2 ? 0xd7bd70 : 0x668fa0), 23.98, floorY + 7.8 - index * 0.45, z)
      poster.rotation.x = index % 2 ? -0.08 : 0.06
      mural.attach(poster)
    }

    const utility = new THREE.Group()
    utility.name = 'adventure-utility'
    group.add(utility)
    const cabinet = box(3.4, 4.8, 2.2, standard(0x28383f), 21.3, floorY + 2.4, 24.3)
    utility.attach(cabinet)
    for (const y of [1.1, 2.3, 3.5]) {
      const vent = box(2.8, 0.12, 0.18, steel, 21.3, floorY + y, 23.15)
      utility.attach(vent)
    }
    for (const [index, [plantX, plantZ]] of ([[19.1, 23.3], [22.5, 20.8]] as const).entries()) {
      const pot = cylinder(0.72, 0.85, standard(0x4b433a), plantX, floorY + 0.43, plantZ, 12)
      utility.attach(pot)
      for (let leaf = 0; leaf < 5; leaf += 1) {
        const blade = box(0.18, 1.45, 0.38, plant, plantX + Math.sin(leaf * 2.1) * 0.35, floorY + 1.35, plantZ + Math.cos(leaf * 2.1) * 0.35)
        blade.rotation.z = (leaf - 2) * 0.12
        utility.attach(blade)
      }
      utility.rotation.y = index * 0.02
    }

    const atmosphere = new THREE.Group()
    atmosphere.name = 'adventure-atmosphere'
    group.add(atmosphere)
    const fans: THREE.Group[] = []
    for (const x of [-10, 10]) {
      const fan = new THREE.Group()
      fan.position.set(x, floorY + 10.8, 8)
      const hub = cylinder(0.28, 0.5, steel, 0, 0, 0, 12)
      group.remove(hub)
      fan.add(hub)
      for (let index = 0; index < 4; index += 1) {
        const blade = box(3.2, 0.1, 0.45, steel, 0, 0, 0)
        group.remove(blade)
        blade.position.x = 1.6
        blade.rotation.y = index * Math.PI / 2
        const pivot = new THREE.Group()
        pivot.rotation.y = index * Math.PI / 2
        pivot.add(blade)
        fan.add(pivot)
      }
      atmosphere.add(fan)
      fans.push(fan)
    }
    const spotlightMaterial = glow(0x9defff, 0.055)
    const spotlights: THREE.Mesh[] = []
    for (const x of [-11, 11]) {
      const cone = new THREE.Mesh(track(new THREE.ConeGeometry(3.8, 10, 20, 1, true)), spotlightMaterial.clone())
      track(cone.material as THREE.Material)
      cone.position.set(x, floorY + 6.1, -10)
      cone.rotation.z = x < 0 ? -0.18 : 0.18
      atmosphere.add(cone)
      spotlights.push(cone)
    }
    const routeLights: THREE.MeshBasicMaterial[] = []
    for (let index = 0; index < 10; index += 1) {
      const lightMaterial = glow(index % 2 ? palette.accent : palette.second, 0.28)
      routeLights.push(lightMaterial)
      const strip = box(0.2, 0.05, 1.7, lightMaterial, -10.8 + index * 2.4, floorY + 0.04, FRONT_Z - 2.2)
      atmosphere.attach(strip)
    }
    animated.push((elapsed) => {
      fans.forEach((fan, index) => { fan.rotation.y = elapsed * (index ? -0.42 : 0.38) })
      spotlights.forEach((spotlight, index) => { spotlight.rotation.z = (index ? 0.16 : -0.16) + Math.sin(elapsed * 0.32 + index * 1.8) * 0.13 })
      routeLights.forEach((entry, index) => { entry.opacity = 0.22 + Math.max(0, Math.sin(elapsed * 1.15 - index * 0.34)) * 0.38 })
      gear.rotation.z = Math.sin(elapsed * 0.48) * 0.006
    })
  }

  if (id === 'sportsArena') {
    const shell = new THREE.Group()
    shell.name = 'sports-arena-shell'
    group.add(shell)
    const courtZone = new THREE.Group()
    courtZone.name = 'sports-street-court'
    group.add(courtZone)
    const steel = standard(0x172935)
    const concrete = standard(0x304451)
    const paleMetal = standard(0xd8edf2)
    const rubber = standard(0x14242e)
    const cyan = glow(palette.accent, 0.72)
    const coral = glow(palette.second, 0.72)

    for (const x of [-23.2, -12, 0, 12, 23.2]) {
      const column = box(0.38, 11.3, 0.38, steel, x, floorY + 5.65, BACK_Z + 0.48)
      shell.attach(column)
    }
    for (const z of [BACK_Z + 1, MID_Z, FRONT_Z - 2]) {
      const truss = box(HALF_X * 2 - 1.2, 0.24, 0.34, steel, 0, floorY + 11.15, z)
      shell.attach(truss)
    }
    for (const x of [-23.75, 23.75]) {
      for (let index = 0; index < 9; index += 1) {
        const cagePost = box(0.1, 6.8, 0.1, paleMetal, x, floorY + 3.4, BACK_Z + 4 + index * 6.2)
        shell.attach(cagePost)
      }
      for (const y of [1.2, 3.4, 5.6]) {
        const cageRail = box(0.1, 0.08, DEPTH - 6, standard(0x64808d), x, floorY + y, MID_Z)
        shell.attach(cageRail)
      }
    }

    const lineMaterial = glow(0xeafcff, 0.62)
    const courtOutlineGeometry = track(new THREE.BoxGeometry(30, 0.02, 44))
    const court = new THREE.LineSegments(
      track(new THREE.EdgesGeometry(courtOutlineGeometry)),
      lineMaterial,
    )
    court.position.set(0, floorY + 0.04, 3)
    courtZone.add(court)
    const centre = new THREE.Mesh(track(new THREE.RingGeometry(4.8, 4.95, 64)), lineMaterial)
    centre.rotation.x = -Math.PI / 2
    centre.position.set(0, floorY + 0.05, 3)
    courtZone.add(centre)
    for (const x of [-15, 15]) {
      const halfway = box(0.08, 0.025, 44, x < 0 ? coral : cyan, x, floorY + 0.045, 3)
      courtZone.attach(halfway)
    }
    for (const z of [-15, 21]) {
      const key = box(10, 0.025, 0.08, z < 0 ? cyan : coral, 0, floorY + 0.046, z)
      courtZone.attach(key)
      const arc = new THREE.Mesh(track(new THREE.RingGeometry(3.8, 3.92, 36, 1, 0, Math.PI)), z < 0 ? cyan : coral)
      arc.rotation.x = -Math.PI / 2
      arc.rotation.z = z < 0 ? 0 : Math.PI
      arc.position.set(0, floorY + 0.052, z + (z < 0 ? 0.1 : -0.1))
      courtZone.add(arc)
    }

    const hoops = new THREE.Group()
    hoops.name = 'sports-mounted-hoops'
    group.add(hoops)
    for (const [index, z] of [BACK_Z + 1.25, FRONT_Z - 1.25].entries()) {
      const towardCourt = index === 0 ? 1 : -1
      const backboard = box(5.2, 3.2, 0.18, standard(0xbcd1d8), 0, floorY + 6.1, z)
      hoops.attach(backboard)
      const target = box(2.15, 1.25, 0.08, rubber, 0, floorY + 6.05, z + towardCourt * 0.14)
      hoops.attach(target)
      const rim = new THREE.Mesh(track(new THREE.TorusGeometry(0.78, 0.065, 10, 28)), index === 0 ? coral : cyan)
      rim.rotation.x = Math.PI / 2
      rim.position.set(0, floorY + 4.55, z + towardCourt * 0.78)
      hoops.add(rim)
      for (let netIndex = 0; netIndex < 8; netIndex += 1) {
        const angle = netIndex / 8 * Math.PI * 2
        const cord = box(0.025, 0.72, 0.025, paleMetal, Math.cos(angle) * 0.65, floorY + 4.18, z + towardCourt * (0.78 + Math.sin(angle) * 0.65))
        cord.rotation.z = Math.cos(angle) * 0.18
        hoops.attach(cord)
      }
    }

    const bleachers = new THREE.Group()
    bleachers.name = 'sports-climbable-bleachers'
    group.add(bleachers)
    for (const side of [-1, 1]) {
      for (let tier = 0; tier < 3; tier += 1) {
        const x = side * (20.4 + tier * 1.1)
        const tierMesh = box(1.15, 0.32 + tier * 0.32, 24, tier === 2 ? concrete : standard(tier ? 0x29404d : 0x233944), x, floorY + (0.16 + tier * 0.16), 5)
        bleachers.attach(tierMesh)
        for (const z of [-5, 5, 15]) {
          const edge = box(0.06, 0.04, 6.8, side < 0 ? cyan : coral, x - side * 0.58, floorY + 0.34 + tier * 0.32, z)
          bleachers.attach(edge)
        }
      }
    }

    const scoreWall = new THREE.Group()
    scoreWall.name = 'sports-score-wall'
    group.add(scoreWall)
    const scoreboardMaterial = glow(palette.accent, 0.7)
    const scoreCase = box(10, 3.2, 0.35, standard(0x07131b), 0, floorY + 8.2, BACK_Z + 0.6)
    scoreWall.attach(scoreCase)
    const scoreBars: THREE.Mesh[] = []
    for (let index = 0; index < 8; index += 1) {
      const bar = box(0.55, 1.3, 0.12, index < 4 ? scoreboardMaterial : coral, -2.7 + index * 0.78, floorY + 8.2, BACK_Z + 0.82)
      scoreWall.attach(bar)
      scoreBars.push(bar)
    }
    const murals = new THREE.Group()
    murals.name = 'sports-motion-murals'
    group.add(murals)
    for (const [index, z] of [-12, -4, 12, 20].entries()) {
      const panel = box(0.14, 4.5, 5.6, standard(index % 2 ? 0x203c49 : 0x26333e), index % 2 ? 24.1 : -24.1, floorY + 5.1, z)
      murals.attach(panel)
      for (let stripe = 0; stripe < 4; stripe += 1) {
        const mark = box(0.08, 0.18 + stripe * 0.07, 3.9 - stripe * 0.45, (index + stripe) % 2 ? cyan : coral, index % 2 ? 24.0 : -24.0, floorY + 3.7 + stripe * 0.82, z + (stripe % 2 ? 0.45 : -0.3))
        mark.rotation.x = (stripe % 2 ? 1 : -1) * (0.12 + stripe * 0.07)
        murals.attach(mark)
      }
    }

    const lighting = new THREE.Group()
    lighting.name = 'sports-arena-lighting'
    group.add(lighting)
    const laneLights: THREE.MeshBasicMaterial[] = []
    for (let index = 0; index < 12; index += 1) {
      const material = glow(index % 2 ? palette.accent : palette.second, 0.24)
      laneLights.push(material)
      const laneLight = box(0.24, 0.04, 1.5, material, -13.2 + index * 2.4, floorY + 0.035, 26.5)
      lighting.attach(laneLight)
    }
    const highBayGlow = glow(0xf4fff5, 0.78)
    for (const z of [-9, 15]) {
      for (const x of [-14, -4.7, 4.7, 14]) {
        const housing = box(3.5, 0.24, 0.9, steel, x, floorY + 10.78, z)
        lighting.attach(housing)
        const panel = box(3.15, 0.035, 0.62, highBayGlow, x, floorY + 10.64, z)
        lighting.attach(panel)
      }
    }
    const gymFans: THREE.Group[] = []
    for (const [index, x] of [-9, 9].entries()) {
      const fan = new THREE.Group()
      fan.name = `sports-gym-fan-${index + 1}`
      fan.position.set(x, floorY + 10.25, 3)
      fan.add(cylinder(0.3, 0.28, standard(0x6b5858), 0, 0, 0, 14))
      for (let blade = 0; blade < 4; blade += 1) {
        const arm = box(3.4, 0.09, 0.42, standard(0x30262a), 0, 0, 0)
        arm.rotation.y = blade * Math.PI / 2
        fan.add(arm)
      }
      lighting.add(fan)
      gymFans.push(fan)
    }
    animated.push((elapsed) => {
      scoreBars.forEach((bar, index) => { bar.scale.y = 0.35 + Math.abs(Math.sin(elapsed * 1.8 + index)) * 0.65 })
      laneLights.forEach((material, index) => { material.opacity = 0.18 + Math.max(0, Math.sin(elapsed * 1.35 - index * 0.42)) * 0.42 })
      gymFans.forEach((fan, index) => { fan.rotation.y = elapsed * (index ? -0.46 : 0.42) })
    })
  }

  if (id === 'creatorLoft') {
    const shell = new THREE.Group()
    shell.name = 'creator-arcade-shell'
    group.add(shell)
    const darkMetal = standard(0x18131e)
    const brushedMetal = standard(0x53475d)
    for (const x of [-23.2, -11.6, 0, 11.6, 23.2]) {
      const column = box(0.36, 11.2, 0.36, darkMetal, x, floorY + 5.6, BACK_Z + 0.5)
      shell.attach(column)
    }
    for (const z of [BACK_Z + 1.2, MID_Z, FRONT_Z - 2]) {
      const beam = box(HALF_X * 2 - 1.2, 0.26, 0.34, darkMetal, 0, floorY + 11.2, z)
      shell.attach(beam)
    }

    const stage = new THREE.Group()
    stage.name = 'creator-led-stage'
    group.add(stage)
    const stageMaterial = standard(0x241a2b)
    const platform = box(18, 0.8, 7, stageMaterial, 0, floorY + 0.4, BACK_Z + 4)
    stage.attach(platform)
    const screenWall = box(18, 7, 0.5, standard(0x130f19), 0, floorY + 4.3, BACK_Z + 0.6)
    stage.attach(screenWall)
    const screenMaterials: THREE.MeshBasicMaterial[] = []
    for (let index = 0; index < 10; index += 1) {
      const screenMaterial = glow(index % 2 ? palette.accent : palette.second, 0.45)
      screenMaterials.push(screenMaterial)
      const screen = box(1.05, 2.4, 0.12, screenMaterial, -6.2 + index * 1.38, floorY + 3.5, BACK_Z + 0.9)
      stage.attach(screen)
    }
    const equalizer: THREE.Mesh[] = []
    for (let index = 0; index < 16; index += 1) {
      const bar = box(0.3, 1, 0.25, glow(index % 3 ? palette.second : palette.accent, 0.72), -7.5 + index, floorY + 1.3, BACK_Z + 7.1)
      stage.attach(bar)
      equalizer.push(bar)
    }

    const wallBays = new THREE.Group()
    wallBays.name = 'creator-arcade-wall-bays'
    group.add(wallBays)
    for (const side of [-1, 1]) {
      for (const [bayIndex, z] of [-12, -3, 8, 19].entries()) {
        const panel = box(0.15, 5.3, 6.6, standard(bayIndex % 2 ? 0x2b2132 : 0x34243a), side * 24.08, floorY + 5.2, z)
        wallBays.attach(panel)
        for (let pixel = 0; pixel < 7; pixel += 1) {
          const color = (pixel + bayIndex) % 2 ? palette.accent : palette.second
          const tile = box(0.08, 0.48 + (pixel % 3) * 0.2, 0.62, glow(color, 0.38), side * 23.98, floorY + 2.8 + (pixel % 4) * 1.0, z - 2.2 + pixel * 0.72)
          tile.rotation.x = (pixel % 2 ? -1 : 1) * 0.09
          wallBays.attach(tile)
        }
      }
    }

    const tickets = new THREE.Group()
    tickets.name = 'creator-ticket-scatter'
    group.add(tickets)
    const ticketMaterials = [standard(0xffd45c), standard(0xff7bbd), standard(0x63e9ff), standard(0x92f29d)]
    for (let index = 0; index < (rich ? 46 : 24); index += 1) {
      const x = -20 + ((index * 7.3) % 40)
      const z = -14 + ((index * 11.7) % 42)
      if (Math.abs(x) < 4.5 && Math.abs(z - 3) < 7) continue
      const ticket = box(0.34, 0.012, 0.13, ticketMaterials[index % ticketMaterials.length], x, floorY + 0.018, z)
      ticket.rotation.y = index * 0.91
      tickets.attach(ticket)
      if (index % 5 === 0) {
        const notch = box(0.055, 0.014, 0.15, darkMetal, x + Math.cos(index) * 0.12, floorY + 0.022, z + Math.sin(index) * 0.04)
        notch.rotation.y = ticket.rotation.y
        tickets.attach(notch)
      }
    }

    const ledAtmosphere = new THREE.Group()
    ledAtmosphere.name = 'creator-arcade-led-atmosphere'
    group.add(ledAtmosphere)
    const ceilingMaterials: THREE.MeshBasicMaterial[] = []
    for (let index = 0; index < 8; index += 1) {
      const ceilingMaterial = glow(index % 2 ? palette.accent : palette.second, 0.3)
      ceilingMaterials.push(ceilingMaterial)
      const rail = box(0.32, 0.18, DEPTH - 5, ceilingMaterial, -19.5 + index * 5.55, floorY + 11.65, MID_Z)
      ledAtmosphere.attach(rail)
    }
    const floorChaseMaterials: THREE.MeshBasicMaterial[] = []
    for (let index = 0; index < 14; index += 1) {
      const material = glow(index % 2 ? palette.second : palette.accent, 0.22)
      floorChaseMaterials.push(material)
      const strip = box(0.18, 0.025, 1.45, material, -11.7 + index * 1.8, floorY + 0.025, 28)
      strip.rotation.y = index % 2 ? 0.18 : -0.18
      ledAtmosphere.attach(strip)
    }
    for (const [index, z] of [-10, 2, 14, 26].entries()) {
      const marquee = box(9.5, 0.22, 0.32, index % 2 ? glow(palette.accent, 0.42) : glow(palette.second, 0.42), 0, floorY + 9.7, z)
      marquee.rotation.z = (index % 2 ? 1 : -1) * 0.025
      ledAtmosphere.attach(marquee)
    }

    animated.push((elapsed) => {
      equalizer.forEach((bar, index) => { bar.scale.y = 0.3 + Math.abs(Math.sin(elapsed * 2.2 + index * 0.65)) * 1.7 })
      screenMaterials.forEach((entry, index) => { entry.opacity = 0.28 + Math.abs(Math.sin(elapsed * 0.9 + index * 0.4)) * 0.42 })
      ceilingMaterials.forEach((entry, index) => { entry.opacity = 0.22 + Math.abs(Math.sin(elapsed * 0.55 + index * 0.7)) * 0.25 })
      floorChaseMaterials.forEach((entry, index) => { entry.opacity = 0.16 + Math.max(0, Math.sin(elapsed * 1.4 - index * 0.35)) * 0.4 })
    })
  }

  return {
    group,
    floorMaterial,
    update: (elapsed) => { if (!reduceMotion) animated.forEach((animate) => animate(elapsed)) },
    dispose: () => resources.forEach((resource) => resource.dispose()),
  }
}