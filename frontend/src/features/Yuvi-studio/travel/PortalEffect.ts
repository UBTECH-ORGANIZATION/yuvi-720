import * as THREE from 'three'

/** A renderer-free, reusable black-hole portal. The Studio owns its one renderer. */
export class PortalEffect {
  readonly group = new THREE.Group()
  private readonly center: THREE.Mesh
  private readonly rings: THREE.Mesh[] = []
  private readonly particles: THREE.Points
  private readonly particlePositions: Float32Array
  private readonly flash: THREE.Sprite
  private readonly vortexMaterial: THREE.ShaderMaterial
  private opening = 0
  private closing = 0

  constructor(reducedMotion = false) {
    this.vortexMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: {
        time: { value: 0 },
        intensity: { value: 0 },
        collapse: { value: 0 },
      },
      vertexShader: `varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `varying vec2 vUv;
        uniform float time;
        uniform float intensity;
        uniform float collapse;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
        float noise(vec2 p) {
          vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0)), f.x), f.y);
        }
        void main() {
          vec2 p = vUv * 2.0 - 1.0;
          float radius = length(p);
          float angle = atan(p.y, p.x);
          float inward = pow(clamp(1.0 - radius, 0.0, 1.0), 1.7);
          float warp = noise(p * 5.2 + vec2(time * 0.34, -time * 0.23));
          angle += time * (0.75 + intensity * 2.8) + inward * (7.0 + collapse * 16.0) + warp * (0.9 + intensity * 1.2);
          radius = radius + sin(angle * 7.0 - time * 3.8 + warp * 4.0) * 0.035 * intensity;
          vec2 flow = vec2(cos(angle), sin(angle)) * radius;
          float bands = 0.5 + 0.5 * sin(angle * 9.0 - radius * 17.0 - time * (2.5 + intensity * 4.0) + warp * 6.0);
          float core = smoothstep(0.94, 0.04, radius + warp * 0.09);
          float blackHole = smoothstep(0.48 - collapse * 0.26, 0.04, radius);
          float edge = smoothstep(0.62, 0.98, radius) * (0.34 + bands * 0.66);
          float fresnel = pow(clamp(radius, 0.0, 1.0), 3.2);
          vec3 cyan = vec3(0.18, 0.91, 1.0);
          vec3 violet = vec3(0.58, 0.26, 1.0);
          vec3 white = vec3(0.86, 0.97, 1.0);
          float chroma = smoothstep(0.68, 0.98, radius) * sin(angle * 5.0 + time * 3.0);
          vec3 color = mix(cyan, violet, bands + chroma * 0.18);
          color = mix(color, white, edge * 0.48);
          color *= core * (0.46 + bands * 0.74);
          color += mix(cyan, violet, flow.x * 0.5 + 0.5) * fresnel * 0.75;
          color *= 1.0 - blackHole * (0.72 + collapse * 0.24);
          float alpha = core * (0.24 + intensity * 0.76) + edge * 0.42;
          gl_FragColor = vec4(color * intensity, alpha * intensity);
        }`,
    })
    this.center = new THREE.Mesh(new THREE.CircleGeometry(0.86, 96), this.vortexMaterial)
    this.group.add(this.center)
    for (let index = 0; index < 2; index += 1) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.92 + index * 0.055, index === 0 ? 0.055 : 0.014, 12, 80), new THREE.MeshStandardMaterial({ color: index ? 0x8f84d8 : 0xb8c8e7, emissive: index ? 0x813cff : 0x173f6b, emissiveIntensity: 0, metalness: index ? 0.16 : 0.86, roughness: index ? 0.28 : 0.2, transparent: true, opacity: 0 }))
      this.group.add(ring)
      this.rings.push(ring)
    }
    const count = reducedMotion ? 90 : 480
    this.particlePositions = new Float32Array(count * 3)
    for (let index = 0; index < count; index += 1) {
      const angle = Math.random() * Math.PI * 2
      const radius = 0.82 + Math.random() * 0.42
      this.particlePositions.set([Math.cos(angle) * radius, Math.sin(angle) * radius, (Math.random() - 0.5) * 0.12], index * 3)
    }
    const particleGeometry = new THREE.BufferGeometry()
    particleGeometry.setAttribute('position', new THREE.BufferAttribute(this.particlePositions, 3))
    particleGeometry.setDrawRange(0, 0)
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
    const activation = THREE.MathUtils.smoothstep(this.opening, 0.2, 1)
    const collapse = THREE.MathUtils.smoothstep(this.closing, 0.05, 0.92)
    this.center.scale.setScalar(scale)
    this.vortexMaterial.uniforms.time.value = time
    this.vortexMaterial.uniforms.intensity.value = scale * (0.72 + activation * 0.28)
    this.vortexMaterial.uniforms.collapse.value = collapse
    this.rings.forEach((ring, index) => {
      ring.rotation.z = time * (index ? -5.6 : 2.4) * (0.42 + activation)
      ring.rotation.x = Math.sin(time * 2.1 + index) * 0.08
      ring.scale.setScalar(scale * (1 + Math.sin(time * (3.4 + activation * 4.6) + index) * 0.055))
      const material = ring.material as THREE.MeshStandardMaterial
      material.opacity = (index ? 0.72 : 0.96) * scale
      material.emissiveIntensity = (index ? 1.9 : 0.34) * activation
    })
    const positions = this.particles.geometry.attributes.position as THREE.BufferAttribute
    for (let index = 0; index < positions.count; index += 1) {
      const start = index * 3
      const angle = Math.atan2(this.particlePositions[start + 1], this.particlePositions[start]) + time * (2.6 + (index % 5) * 0.16)
      const radius = Math.max(0.04, Math.hypot(this.particlePositions[start], this.particlePositions[start + 1]) - this.closing * 0.75)
      positions.setXYZ(index, Math.cos(angle) * radius, Math.sin(angle) * radius, this.particlePositions[start + 2] + Math.sin(time * 5 + index) * 0.05)
    }
    positions.needsUpdate = true
    this.particles.geometry.setDrawRange(0, Math.floor(positions.count * (0.28 + activation * 0.72)))
    ;(this.particles.material as THREE.PointsMaterial).opacity = (0.38 + activation * 0.55) * scale
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