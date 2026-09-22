import * as THREE from 'three'
import { createYuviAvatarRig } from '../Yuvi-studio/YuviAvatarRig'
import { getAsset } from '../Yuvi-studio/YuviAssets'
import { cloneDesign, type YuviDesign, type YuviSlot } from '../Yuvi-studio/YuviDesign'
import { tierSettings } from '../Yuvi-studio/renderTier'
import { idleBreakerPose } from './roadmapModel'

export function createRoadmapYuvi(savedDesign: YuviDesign) {
  const design = cloneDesign(savedDesign)
  const rig = createYuviAvatarRig(design, tierSettings('low', true), 'low')
  const { robot, head, armL, armR, legL, legR, faceLight } = rig
  robot.name = 'roadmap-yuvi'
  robot.position.set(0, 0, 0)
  const body = new THREE.Color(design.colors.body)
  const glow = new THREE.Color(design.colors.glow)
  rig.blueMat.color.copy(body)
  rig.jointMat.color.copy(body.clone().lerp(rig.CORE_COLOR, 0.84))
  rig.whiteMat.color.copy(rig.CORE_COLOR.clone().lerp(body, 0.14))
  for (const material of [rig.ringMat, rig.earCapMat, rig.antennaTipMat]) {
    material.color.copy(glow)
    material.emissive.copy(glow)
  }
  rig.haloGlowMat.color.copy(glow)

  const anchors: Record<YuviSlot, THREE.Group> = {
    headTop: new THREE.Group(), face: new THREE.Group(), back: new THREE.Group(),
    handR: new THREE.Group(), body: new THREE.Group(),
  }
  head.add(anchors.headTop, anchors.face)
  anchors.face.position.set(0, -0.03, 0)
  robot.add(anchors.back, anchors.body)
  anchors.back.position.set(0, 0.9, -0.22)
  anchors.body.position.set(0, 0.82, 0.04)
  armR.add(anchors.handR)
  anchors.handR.position.set(0.058, -0.56, 0.12)
  for (const slot of Object.keys(anchors) as YuviSlot[]) {
    const assetId = design.equipped[slot]
    const asset = assetId ? getAsset(assetId) : null
    if (!asset) continue
    anchors[slot].add(asset.build())
    if (slot === 'headTop') {
      rig.antenna.visible = false
      rig.nativeEarParts.forEach((part) => { part.visible = !asset.hideEars })
    }
  }

  const exhaustCanvas = document.createElement('canvas')
  exhaustCanvas.width = 64
  exhaustCanvas.height = 192
  const exhaustContext = exhaustCanvas.getContext('2d')!
  const gradient = exhaustContext.createLinearGradient(0, 0, 0, 192)
  for (const [stop, color] of [[0, '#ffffff'], [0.1, '#ffffff'], [0.18, '#bff7ff'], [0.38, '#38d8ff'], [0.63, '#6f5bff'], [1, 'rgba(111,91,255,0)']] as const) {
    gradient.addColorStop(stop, color)
  }
  exhaustContext.fillStyle = gradient
  exhaustContext.beginPath()
  exhaustContext.moveTo(16, 0)
  exhaustContext.bezierCurveTo(-12, 45, 18, 164, 32, 192)
  exhaustContext.bezierCurveTo(46, 164, 76, 45, 48, 0)
  exhaustContext.fill()
  const coreGradient = exhaustContext.createLinearGradient(0, 0, 0, 128)
  coreGradient.addColorStop(0, '#ffffff')
  coreGradient.addColorStop(0.42, '#ffe57a')
  coreGradient.addColorStop(0.72, '#ff7a36')
  coreGradient.addColorStop(1, 'rgba(255,122,54,0)')
  exhaustContext.fillStyle = coreGradient
  exhaustContext.beginPath()
  exhaustContext.ellipse(32, 62, 9, 62, 0, 0, Math.PI * 2)
  exhaustContext.fill()
  const exhaustTexture = new THREE.CanvasTexture(exhaustCanvas)
  exhaustTexture.colorSpace = THREE.SRGBColorSpace
  const exhaustMaterial = new THREE.SpriteMaterial({
    map: exhaustTexture, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, toneMapped: false,
  })
  const thrusters = [legL, legR].map((leg, index) => {
    const flame = new THREE.Sprite(exhaustMaterial)
    flame.name = `roadmap-yuvi-thruster-${index}`
    flame.center.set(0.5, 1)
    flame.position.set(0, -0.54, 0.1)
    flame.visible = false
    leg.add(flame)
    return flame
  })
  let flightBlend = 0
  let horizontalBlend = 0
  let flightPitch = 0
  let horizontalFaceTurn = 0
  const geometries = new Set<THREE.BufferGeometry>()
  const materials = new Set<THREE.Material>([rig.ringMat, exhaustMaterial])
  robot.traverse((object) => {
    if (object instanceof THREE.Light) object.visible = false
    if (!(object instanceof THREE.Mesh)) return
    geometries.add(object.geometry)
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      material.depthTest = true
      materials.add(material)
    }
  })
  faceLight.draw()
  return {
    object: robot,
    get flightPitch() { return flightPitch },
    update(seconds: number, reduceMotion: boolean, airborne: boolean, horizontalFlight: boolean, leadLeft: boolean, dt: number) {
      flightBlend = reduceMotion ? 0 : THREE.MathUtils.lerp(flightBlend, airborne ? 1 : 0, 1 - Math.exp(-dt * 14))
      horizontalBlend = reduceMotion ? 0 : THREE.MathUtils.lerp(horizontalBlend, horizontalFlight ? 1 : 0, 1 - Math.exp(-dt * 18))
      const pitchTarget = !reduceMotion && horizontalFlight ? -Math.PI / 2 : 0
      flightPitch = THREE.MathUtils.lerp(flightPitch, pitchTarget, 1 - Math.exp(-dt * 9))
      const faceTurnTarget = !reduceMotion && horizontalFlight ? Math.PI : 0
      horizontalFaceTurn = THREE.MathUtils.lerp(horizontalFaceTurn, faceTurnTarget, 1 - Math.exp(-dt * 12))
      const pose = idleBreakerPose(seconds, reduceMotion)
      const flutter = reduceMotion ? 0 : Math.sin(seconds * 9.5) * 0.06
      head.rotation.set(
        pose.headPitch * (1 - flightBlend),
        pose.headYaw * (1 - flightBlend) + horizontalFaceTurn,
        pose.headRoll * (1 - flightBlend),
      )
      const uprightLeftArm = THREE.MathUtils.lerp(pose.leftArm, -2.15 - flutter, flightBlend)
      const uprightRightArm = THREE.MathUtils.lerp(pose.rightArm, 2.15 + flutter, flightBlend)
      const horizontalLeftArm = leadLeft ? -Math.PI + flutter : -0.18
      const horizontalRightArm = leadLeft ? 0.18 : Math.PI - flutter
      armL.rotation.z = THREE.MathUtils.lerp(uprightLeftArm, horizontalLeftArm, horizontalBlend)
      armR.rotation.z = THREE.MathUtils.lerp(uprightRightArm, horizontalRightArm, horizontalBlend)
      armL.rotation.x = THREE.MathUtils.lerp(0, leadLeft ? -0.55 : 0.75, horizontalBlend)
      armR.rotation.x = THREE.MathUtils.lerp(0, leadLeft ? -0.75 : 0.55, horizontalBlend)
      legL.rotation.x = legR.rotation.x = flightBlend * 0.12
      exhaustMaterial.opacity = flightBlend * 0.9
      thrusters.forEach((flame, index) => {
        flame.visible = flightBlend > 0.01
        flame.scale.set(0.26, (0.72 + Math.sin(seconds * 30 + index) * 0.08) * flightBlend, 1)
      })
    },
    dispose() {
      robot.removeFromParent()
      faceLight.texture.dispose()
      exhaustTexture.dispose()
      geometries.forEach((geometry) => geometry.dispose())
      materials.forEach((material) => material.dispose())
    },
  }
}