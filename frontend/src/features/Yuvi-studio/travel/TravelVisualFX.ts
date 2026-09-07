import * as THREE from 'three'
import { PortalEffect } from './PortalEffect'
import type { TravelPhase } from './TravelStateMachine'

const ACTIVE = new Set<TravelPhase>(['portalOpening', 'yobiEntering', 'worldSwap', 'yobiExiting', 'landing', 'portalClosing', 'portalCooldown'])

/** Direct portal travel, rendered through the Studio's existing WebGL context. */
export class TravelVisualFX {
  private readonly group = new THREE.Group()
  private readonly sourcePortal: PortalEffect
  private readonly destinationPortal: PortalEffect
  private readonly avatarParticles: THREE.Points
  private readonly avatarStarts: Float32Array
  private readonly avatarColors: Float32Array
  private readonly impact: THREE.Mesh
  private phase: TravelPhase = 'idle'
  private phaseStartedAt = 0
  private active = false
  private captured = false
  private readonly originalPosition = new THREE.Vector3()
  private readonly originalScale = new THREE.Vector3(1, 1, 1)
  private readonly originalRotation = new THREE.Euler()
  private readonly sourceRobotPosition = new THREE.Vector3()
  private readonly sourcePortalPosition = new THREE.Vector3()
  private readonly destinationPortalPosition = new THREE.Vector3()

  constructor(
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
    renderer: THREE.WebGLRenderer,
    private readonly robot: THREE.Group,
    private readonly reducedMotion: boolean,
    private readonly capsuleAnchor: () => THREE.Vector3 | null,
  ) {
    this.group.visible = false
    scene.add(this.group)
    this.sourcePortal = new PortalEffect(reducedMotion)
    this.destinationPortal = new PortalEffect(reducedMotion)
    this.group.add(this.sourcePortal.group, this.destinationPortal.group)
    const count = reducedMotion ? 80 : 360
    this.avatarStarts = new Float32Array(count * 3)
    this.avatarColors = new Float32Array(count * 3)
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3))
    geometry.setAttribute('color', new THREE.BufferAttribute(this.avatarColors, 3))
    this.avatarParticles = new THREE.Points(geometry, new THREE.PointsMaterial({ size: reducedMotion ? 0.025 : 0.045, vertexColors: true, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }))
    this.avatarParticles.visible = false
    this.group.add(this.avatarParticles)
    this.impact = new THREE.Mesh(new THREE.RingGeometry(0.1, 0.52, 48), new THREE.MeshBasicMaterial({ color: 0xb7f8ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }))
    this.impact.rotation.x = -Math.PI / 2
    this.impact.visible = false
    this.group.add(this.impact)
  }

  setPhase(phase: TravelPhase) {
    this.phase = phase
    this.phaseStartedAt = performance.now()
    this.active = ACTIVE.has(phase)
    this.group.visible = this.active
    if (phase === 'portalOpening') {
      this.destinationPortal.close(1)
      this.beginDeparture()
    }
    if (phase === 'yobiEntering' || phase === 'portalCooldown') this.destinationPortal.close(1)
    if (phase === 'worldSwap') {
      this.sourcePortal.close(1)
      this.destinationPortal.close(1)
    }
    if (phase === 'yobiExiting') {
      this.sourcePortal.close(1)
      this.beginArrival()
    }
    if (phase === 'landing' || phase === 'portalClosing') this.sourcePortal.close(1)
    if (phase === 'landing') this.beginLanding()
    if (phase === 'idle') this.reset()
  }

  private beginDeparture() {
    this.captureOriginalTransform()
    this.robot.updateWorldMatrix(true, true)
    this.robot.getWorldPosition(this.sourceRobotPosition)
    this.sourcePortalPosition.copy(this.capsuleAnchor() ?? this.sourceRobotPosition)
    this.sourcePortal.setPosition(this.sourcePortalPosition)
    this.sourcePortal.open(0)
  }

  private beginArrival() {
    this.robot.updateWorldMatrix(true, true)
    this.captureArrivalTransform()
    this.destinationPortalPosition.copy(this.capsuleAnchor() ?? this.robot.getWorldPosition(new THREE.Vector3()))
    this.destinationPortal.setPosition(this.destinationPortalPosition)
    this.destinationPortal.open(1)
    this.destinationPortal.burst()
    this.robot.visible = true
    this.robot.scale.copy(this.originalScale).multiplyScalar(0.1)
    this.robot.rotation.z = 0.18
  }

  /** The destination room replaces the world at the midpoint, so it owns reset state. */
  private captureArrivalTransform() {
    this.originalPosition.copy(this.robot.position)
    this.originalRotation.copy(this.robot.rotation)
    this.captured = true
  }

  private beginLanding() {
    this.impact.position.copy(this.originalPosition)
    this.impact.position.y = -0.89
    this.impact.visible = true
    this.impact.scale.setScalar(0.18)
    ;(this.impact.material as THREE.MeshBasicMaterial).opacity = 0.85
    this.destinationPortal.burst()
  }

  private captureOriginalTransform() {
    if (this.captured) return
    this.captured = true
    this.originalPosition.copy(this.robot.position)
    this.originalScale.copy(this.robot.scale)
    this.originalRotation.copy(this.robot.rotation)
  }

  private captureAvatarParticles() {
    this.robot.updateWorldMatrix(true, true)
    const points: Array<{ point: THREE.Vector3; color: THREE.Color }> = []
    this.robot.traverse((object) => {
      const mesh = object as THREE.Mesh
      if (!mesh.isMesh || !mesh.geometry?.attributes.position) return
      const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material
      const color = (material as THREE.MeshStandardMaterial | THREE.MeshBasicMaterial)?.color?.clone() ?? new THREE.Color(0xbafcff)
      const positions = mesh.geometry.attributes.position
      const step = Math.max(1, Math.floor(positions.count / 22))
      for (let index = 0; index < positions.count; index += step) points.push({ point: new THREE.Vector3().fromBufferAttribute(positions, index).applyMatrix4(mesh.matrixWorld), color })
    })
    const targets = this.avatarParticles.geometry.attributes.position as THREE.BufferAttribute
    for (let index = 0; index < targets.count; index += 1) {
      const sample = points[index % Math.max(1, points.length)]
      const point = sample?.point ?? this.sourceRobotPosition
      const color = sample?.color ?? new THREE.Color(0xbafcff)
      this.avatarStarts.set([point.x, point.y, point.z], index * 3)
      this.avatarColors.set([color.r, color.g, color.b], index * 3)
      targets.setXYZ(index, point.x, point.y, point.z)
    }
    targets.needsUpdate = true
    ;(this.avatarParticles.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true
    this.avatarParticles.visible = true
    ;(this.avatarParticles.material as THREE.PointsMaterial).opacity = 0.94
  }

  update(time: number, delta: number) {
    if (!this.active) return
    const elapsed = (performance.now() - this.phaseStartedAt) / 1000
    if (this.phase === 'portalOpening') this.sourcePortal.open(Math.min(elapsed / 0.52, 1))
    if (this.phase === 'yobiEntering') {
      const progress = Math.min(elapsed / 0.68, 1)
      if (!this.avatarParticles.visible) this.captureAvatarParticles()
      this.robot.position.lerpVectors(this.originalPosition, this.sourcePortalPosition, progress)
      this.robot.scale.copy(this.originalScale).multiplyScalar(Math.max(0, 1 - progress))
      this.robot.visible = progress < 0.98
      this.updateParticleStream(this.sourcePortalPosition, progress, time, false)
    }
    if (this.phase === 'worldSwap') this.robot.visible = false
    if (this.phase === 'yobiExiting') {
      const progress = Math.min(elapsed / 0.56, 1)
      this.robot.position.copy(this.originalPosition)
      this.robot.position.y += Math.sin(progress * Math.PI) * 0.45
      this.robot.scale.copy(this.originalScale).multiplyScalar(0.1 + progress * 0.9)
      this.robot.rotation.z = (1 - progress) * 0.18
      this.updateParticleStream(this.originalPosition, progress, time, true)
    }
    if (this.phase === 'landing') {
      const progress = Math.min(elapsed / 0.34, 1)
      this.impact.scale.setScalar(0.18 + progress * 4)
      ;(this.impact.material as THREE.MeshBasicMaterial).opacity = 0.85 * (1 - progress)
    }
    if (this.phase === 'portalClosing') {
      const progress = Math.min(elapsed / 0.38, 1)
      this.destinationPortal.close(progress)
      ;(this.avatarParticles.material as THREE.PointsMaterial).opacity = Math.max(0, 0.36 * (1 - progress))
    }
    if (this.phase === 'portalCooldown') this.sourcePortal.close(Math.min(elapsed / 0.42, 1))
    this.sourcePortal.update(time, delta, this.camera)
    this.destinationPortal.update(time, delta, this.camera)
  }

  private updateParticleStream(target: THREE.Vector3, progress: number, time: number, reverse: boolean) {
    const positions = this.avatarParticles.geometry.attributes.position as THREE.BufferAttribute
    for (let index = 0; index < positions.count; index += 1) {
      const offset = index * 3
      const t = reverse ? 1 - progress : progress
      const swirl = (1 - t) * 0.14
      positions.setXYZ(index,
        THREE.MathUtils.lerp(this.avatarStarts[offset], target.x, t) + Math.sin(time * 12 + index) * swirl,
        THREE.MathUtils.lerp(this.avatarStarts[offset + 1], target.y + 0.25, t),
        THREE.MathUtils.lerp(this.avatarStarts[offset + 2], target.z, t) + Math.cos(time * 12 + index) * swirl,
      )
    }
    positions.needsUpdate = true
    ;(this.avatarParticles.material as THREE.PointsMaterial).opacity = 0.88 * (1 - progress * 0.45)
  }

  private reset() {
    this.robot.visible = true
    this.robot.position.copy(this.originalPosition)
    this.robot.scale.copy(this.originalScale)
    this.robot.rotation.copy(this.originalRotation)
    this.avatarParticles.visible = false
    this.impact.visible = false
    this.sourcePortal.close(1)
    this.destinationPortal.close(1)
    this.captured = false
  }

  render(renderer: THREE.WebGLRenderer) {
    renderer.render(this.scene, this.camera)
  }

  resize(_width: number, _height: number) {}

  dispose() {
    this.sourcePortal.dispose()
    this.destinationPortal.dispose()
    this.scene.remove(this.group)
    this.avatarParticles.geometry.dispose()
    ;(this.avatarParticles.material as THREE.Material).dispose()
    this.impact.geometry.dispose()
    ;(this.impact.material as THREE.Material).dispose()
  }
}
