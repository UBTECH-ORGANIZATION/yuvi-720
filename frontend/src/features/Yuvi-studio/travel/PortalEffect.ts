import * as THREE from 'three'

/** A renderer-free, reusable black-hole portal. The Studio owns its one renderer. */
export class PortalEffect {
  readonly group = new THREE.Group()
  private readonly center: THREE.Mesh
  private readonly rings: THREE.Mesh[] = []
  private readonly particles: THREE.Points
  private readonly particlePositions: Float32Array
  private readonly flash: THREE.Sprite
  private opening = 0
  private closing = 0

  constructor(reducedMotion = false) {
    const centerMaterial = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide })
    this.center = new THREE.Mesh(new THREE.CircleGeometry(0.72, 64), centerMaterial)
    this.group.add(this.center)
    for (let index = 0; index < 3; index += 1) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.78 + index * 0.1, 0.028 - index * 0.004, 10, 64), new THREE.MeshBasicMaterial({ color: index === 1 ? 0xff75cf : index === 2 ? 0x9b7dff : 0x63edff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }))
      this.group.add(ring)
      this.rings.push(ring)
    }
    const count = reducedMotion ? 64 : 240
    this.particlePositions = new Float32Array(count * 3)
    for (let index = 0; index < count; index += 1) {
      const angle = Math.random() * Math.PI * 2
      const radius = 0.82 + Math.random() * 0.42
      this.particlePositions.set([Math.cos(angle) * radius, Math.sin(angle) * radius, (Math.random() - 0.5) * 0.12], index * 3)
    }
    const particleGeometry = new THREE.BufferGeometry()
    particleGeometry.setAttribute('position', new THREE.BufferAttribute(this.particlePositions, 3))
    this.particles = new THREE.Points(particleGeometry, new THREE.PointsMaterial({ color: 0xc8fbff, size: reducedMotion ? 0.025 : 0.045, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }))
    this.group.add(this.particles)
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }))
    this.flash.scale.setScalar(0.1)
    this.group.add(this.flash)
    this.group.visible = false
  }

  setPosition(position: THREE.Vector3) { this.group.position.copy(position) }

  open(progress: number) {
    this.opening = THREE.MathUtils.clamp(progress, 0, 1)
    this.closing = 0
    this.group.visible = true
  }

  close(progress: number) {
    this.closing = THREE.MathUtils.clamp(progress, 0, 1)
    if (this.closing >= 1) this.group.visible = false
  }

  burst() { ;(this.flash.material as THREE.SpriteMaterial).opacity = 1; this.flash.visible = true }

  update(time: number, delta: number, camera: THREE.Camera) {
    if (!this.group.visible) return
    this.group.quaternion.copy(camera.quaternion)
    const scale = this.opening * (1 - this.closing)
    this.center.scale.setScalar(scale)
    ;(this.center.material as THREE.MeshBasicMaterial).opacity = 0.98 * scale
    this.rings.forEach((ring, index) => {
      ring.rotation.z = time * (index % 2 ? -3.2 : 2.7)
      ring.rotation.x = Math.sin(time * 2.1 + index) * 0.1
      ring.scale.setScalar(scale * (1 + Math.sin(time * 5 + index) * 0.1))
      ;(ring.material as THREE.MeshBasicMaterial).opacity = 0.9 * scale
    })
    const positions = this.particles.geometry.attributes.position as THREE.BufferAttribute
    for (let index = 0; index < positions.count; index += 1) {
      const start = index * 3
      const angle = Math.atan2(this.particlePositions[start + 1], this.particlePositions[start]) + time * (2.6 + (index % 5) * 0.16)
      const radius = Math.max(0.04, Math.hypot(this.particlePositions[start], this.particlePositions[start + 1]) - this.closing * 0.75)
      positions.setXYZ(index, Math.cos(angle) * radius, Math.sin(angle) * radius, this.particlePositions[start + 2] + Math.sin(time * 5 + index) * 0.05)
    }
    positions.needsUpdate = true
    ;(this.particles.material as THREE.PointsMaterial).opacity = 0.88 * scale
    const flashMaterial = this.flash.material as THREE.SpriteMaterial
    flashMaterial.opacity = Math.max(0, flashMaterial.opacity - delta * 3.5)
    this.flash.scale.setScalar(0.2 + flashMaterial.opacity * 2.4)
    this.flash.visible = flashMaterial.opacity > 0.01
  }

  dispose() {
    this.group.traverse((object) => {
      const mesh = object as THREE.Mesh
      mesh.geometry?.dispose()
      const material = mesh.material as THREE.Material | THREE.Material[] | undefined
      Array.isArray(material) ? material.forEach((entry) => entry.dispose()) : material?.dispose()
    })
  }
}