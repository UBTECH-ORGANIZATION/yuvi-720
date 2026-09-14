import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { useI18n } from '../../i18n/I18nProvider'
import { YuviAvatar3D } from './YuviAvatar3D'
import type { YuviDesign } from './YuviDesign'

const EXIT_MS = 620
const designKey = (design: YuviDesign) => JSON.stringify(design)

/** A lightweight WebGL prologue that keeps the real Studio renderer free to finish loading behind it. */
export function StudioLoadingExperience({ design, ready, onExited }: { design: YuviDesign; ready: boolean; onExited: () => void }) {
  const { t } = useI18n()
  const mountRef = useRef<HTMLDivElement | null>(null)
  const onExitedRef = useRef(onExited)
  const [leaving, setLeaving] = useState(false)

  useEffect(() => { onExitedRef.current = onExited }, [onExited])

  useEffect(() => {
    if (ready) setLeaving(true)
  }, [ready])

  useEffect(() => {
    if (!leaving) return
    const timeout = window.setTimeout(() => onExitedRef.current(), EXIT_MS)
    return () => window.clearTimeout(timeout)
  }, [leaving])

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: !reduced, powerPreference: 'high-performance' })
    } catch {
      return
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, reduced ? 1 : 1.5))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    mount.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    scene.fog = new THREE.FogExp2(0x071026, 0.075)
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100)
    camera.position.set(0, 0.25, 7.2)
    scene.add(new THREE.HemisphereLight(0xaeeeff, 0x111138, 1.5))
    const key = new THREE.PointLight(0x66f4ff, 18, 12)
    key.position.set(2.5, 2.8, 3.8)
    scene.add(key)
    const rim = new THREE.PointLight(0xff679a, 11, 9)
    rim.position.set(-3, 1.1, -1)
    scene.add(rim)

    // The ring meshes share one Three.js parent. Its DOM counterpart below
    // also contains the exact Yuvi canvas, so both render layers move as one.
    const portalSystem = new THREE.Group()
    scene.add(portalSystem)
    const portal = new THREE.Group()
    // Keep the energy field around Yuvi's torso, clear of the face and halo.
    portal.position.y = -0.38
    portal.scale.setScalar(1)
    portalSystem.add(portal)
    const portalCore = new THREE.Mesh(new THREE.CircleGeometry(2.08, 48), new THREE.MeshBasicMaterial({ color: 0x2930a8, transparent: true, opacity: 0.27, blending: THREE.AdditiveBlending, depthWrite: false }))
    portal.add(portalCore)
    for (let index = 0; index < 3; index++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.58 + index * 0.22, 0.027 + index * 0.008, 10, 48), new THREE.MeshBasicMaterial({ color: index === 1 ? 0xff75b2 : 0x74f6ff, transparent: true, opacity: 0.82 - index * 0.15, blending: THREE.AdditiveBlending, depthWrite: false }))
      ring.rotation.x = Math.PI / 2.15 + index * 0.15
      ring.userData.speed = index % 2 ? -0.7 : 0.52
      portal.add(ring)
    }

    const particleCount = reduced ? 42 : 100
    const positions = new Float32Array(particleCount * 3)
    for (let index = 0; index < particleCount; index++) {
      const radius = 1.6 + Math.random() * 2.9
      const angle = Math.random() * Math.PI * 2
      positions[index * 3] = Math.cos(angle) * radius
      positions[index * 3 + 1] = (Math.random() - 0.5) * 4.8
      positions[index * 3 + 2] = Math.sin(angle) * radius * 0.35
    }
    const particles = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(positions, 3)), new THREE.PointsMaterial({ color: 0xbafcff, size: 0.035, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }))
    portalSystem.add(particles)

    let frame = 0
    const clock = new THREE.Clock()
    const resize = () => {
      const width = mount.clientWidth || 1
      const height = mount.clientHeight || 1
      renderer.setSize(width, height, false)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
    }
    const render = () => {
      const time = clock.getElapsedTime()
      portal.rotation.z = time * 0.08
      portal.children.forEach((child) => { if (child.userData.speed) child.rotation.z += child.userData.speed * 0.012 })
      particles.rotation.y = time * 0.07
      // The light pulse follows the ring cycle; position and scale are shared
      // by the DOM portal-system parent so the detailed Yuvi stays locked in.
      key.intensity = 15 + Math.sin(time * 2.2) * 3
      renderer.render(scene, camera)
      frame = requestAnimationFrame(render)
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(mount)
    render()
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      scene.traverse((object) => {
        const mesh = object as THREE.Mesh
        mesh.geometry?.dispose()
        const material = mesh.material as THREE.Material | THREE.Material[] | undefined
        if (Array.isArray(material)) material.forEach((entry) => entry.dispose())
        else material?.dispose()
      })
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [design])

  return <section className={`ys-loading${leaving ? ' is-leaving' : ''}`} aria-live="polite" aria-label={t('YuviStudio.loading.label')}>
    <div className="ys-loading__portal-system" aria-hidden>
      <div className="ys-loading__canvas" ref={mountRef} />
      <div className="ys-loading__yuvi">
        <YuviAvatar3D key={designKey(design)} initialDesign={design} label="" performanceMode="low" />
      </div>
    </div>
    <div className="ys-loading__copy">
      <p>{t('YuviStudio.loading.status')}</p>
      <span aria-hidden><i /><i /><i /></span>
    </div>
  </section>
}