import { useEffect, useRef } from 'react'
import { useI18n } from '../../i18n/I18nProvider'
import { useResponsive } from '../../hooks/useResponsive'
import { YubiAvatar3D } from '../yubi-studio/YubiAvatar3D'
import { DEFAULT_DESIGN } from '../yubi-studio/yubiDesign'

type FlightPoint = {
  x: number
  y: number
  scale: number
  opacity: number
}

const SCENE_POINTS: Record<string, Omit<FlightPoint, 'x'> & { rtlX: number }> = {
  hero: { rtlX: 0.27, y: 0.5, scale: 0.62, opacity: 1 },
  hub: { rtlX: 0.89, y: 0.38, scale: 0.68, opacity: 1 },
  features: { rtlX: 0.11, y: 0.55, scale: 0.62, opacity: 1 },
  faq: { rtlX: 0.89, y: 0.46, scale: 0.58, opacity: 1 },
  contact: { rtlX: 0.94, y: 0.52, scale: 0.64, opacity: 1 },
  exit: { rtlX: 0.5, y: -0.28, scale: 0.42, opacity: 0 },
}

const smoothstep = (value: number) => value * value * (3 - 2 * value)
const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value))

function pointFor(scene: string, isRtl: boolean): FlightPoint {
  const point = SCENE_POINTS[scene] ?? SCENE_POINTS.hero
  return {
    x: isRtl ? point.rtlX : 1 - point.rtlX,
    y: point.y,
    scale: point.scale,
    opacity: point.opacity,
  }
}

function Thrusters() {
  return (
    <span className="landing720-yubi-thrusters" aria-hidden="true">
      <span className="landing720-yubi-smoke">
        {Array.from({ length: 6 }, (_, index) => <b key={index} />)}
      </span>
      <i />
      <i />
    </span>
  )
}

export function LandingYubiArtwork() {
  return (
    <div className="landing720-yubi-artwork" aria-hidden="true">
      <div className="landing720-yubi-artwork__image">
        <svg className="landing720-yubi-station" viewBox="0 0 520 430" role="presentation">
          <defs>
            <linearGradient id="station-sky" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#15106f" />
              <stop offset=".5" stopColor="#4338bf" />
              <stop offset="1" stopColor="#167fae" />
            </linearGradient>
            <linearGradient id="station-glass" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#ffffff" stopOpacity=".28" />
              <stop offset=".46" stopColor="#b9b3ff" stopOpacity=".08" />
              <stop offset="1" stopColor="#70e7ff" stopOpacity=".2" />
            </linearGradient>
            <linearGradient id="station-floor" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#a6f4ff" stopOpacity=".42" />
              <stop offset="1" stopColor="#5242c6" stopOpacity=".08" />
            </linearGradient>
            <radialGradient id="station-portal">
              <stop offset="0" stopColor="#ffffff" stopOpacity=".3" />
              <stop offset=".48" stopColor="#69eaff" stopOpacity=".2" />
              <stop offset="1" stopColor="#8167ff" stopOpacity="0" />
            </radialGradient>
            <filter id="station-glow" x="-80%" y="-80%" width="260%" height="260%">
              <feGaussianBlur stdDeviation="7" />
            </filter>
          </defs>

          <rect width="520" height="430" rx="34" fill="url(#station-sky)" />
          <circle cx="260" cy="211" r="162" fill="url(#station-portal)" />
          <path className="landing720-station-orbit" d="M58 222C126 89 388 54 470 203" />
          <path className="landing720-station-orbit landing720-station-orbit--two" d="M86 289C204 359 392 329 456 236" />

          <g className="landing720-station-stars">
            <circle cx="76" cy="74" r="3" />
            <circle cx="129" cy="118" r="2" />
            <circle cx="445" cy="83" r="3" />
            <circle cx="406" cy="132" r="2" />
            <circle cx="52" cy="271" r="2" />
            <circle cx="474" cy="278" r="2.5" />
          </g>

          <g className="landing720-station-world">
            <circle cx="102" cy="101" r="39" fill="#7cecff" fillOpacity=".18" />
            <circle cx="102" cy="101" r="26" fill="#bdf7ff" fillOpacity=".1" />
            <path d="M64 105c20-14 52-18 76-4M77 79c19 7 37 22 45 43" />
          </g>

          <g className="landing720-station-gantry landing720-station-gantry--start">
            <path d="M31 89h77v280H31M42 120h55M42 162h55M42 204h55M42 246h55M42 288h55M42 330h55" />
            <path className="landing720-station-gantry__arm" d="M97 174h90l20 17M97 270h75l26-18" />
          </g>
          <g className="landing720-station-gantry landing720-station-gantry--end">
            <path d="M489 89h-77v280h77M478 120h-55M478 162h-55M478 204h-55M478 246h-55M478 288h-55M478 330h-55" />
            <path className="landing720-station-gantry__arm" d="M423 174h-90l-20 17M423 270h-75l-26-18" />
          </g>

          <g className="landing720-station-card landing720-station-card--book">
            <rect x="52" y="171" width="92" height="64" rx="15" />
            <path d="M75 190h22c8 0 12 5 12 12v20c0-7-4-11-12-11H75Zm34 12c0-7 4-12 12-12h6v21h-6c-8 0-12 4-12 11Z" />
          </g>
          <g className="landing720-station-card landing720-station-card--atom">
            <rect x="385" y="151" width="82" height="70" rx="16" />
            <ellipse cx="426" cy="186" rx="24" ry="9" />
            <ellipse cx="426" cy="186" rx="24" ry="9" transform="rotate(60 426 186)" />
            <ellipse cx="426" cy="186" rx="24" ry="9" transform="rotate(120 426 186)" />
            <circle cx="426" cy="186" r="4" />
          </g>

          <path className="landing720-station-arch" d="M139 356V193c0-68 54-123 121-123s121 55 121 123v163" />
          <path className="landing720-station-arch landing720-station-arch--inner" d="M165 356V202c0-54 43-98 95-98s95 44 95 98v154" />
          <g className="landing720-station-door landing720-station-door--start">
            <path d="M137 164h50v192h-50c-18-58-18-134 0-192Z" />
            <path d="M151 184h15v145h-15" />
          </g>
          <g className="landing720-station-door landing720-station-door--end">
            <path d="M383 164h-50v192h50c18-58 18-134 0-192Z" />
            <path d="M369 184h-15v145h15" />
          </g>

          <ellipse className="landing720-station-beam" cx="260" cy="329" rx="104" ry="65" />
          <path className="landing720-station-floor" d="M29 430c51-87 134-123 231-123s180 36 231 123Z" />
          <ellipse className="landing720-station-platform" cx="260" cy="369" rx="104" ry="25" />
          <ellipse className="landing720-station-platform-core" cx="260" cy="363" rx="70" ry="14" />

          <g className="landing720-station-console landing720-station-console--start">
            <path d="m36 302 78-20 24 92-104 23Z" />
            <path d="m57 317 47-12M61 333l30-8M65 350l51-13" />
            <circle cx="113" cy="321" r="5" />
          </g>
          <g className="landing720-station-console landing720-station-console--end">
            <path d="m484 302-78-20-24 92 104 23Z" />
            <path d="m463 317-47-12M459 333l-30-8M455 350l-51-13" />
            <circle cx="407" cy="321" r="5" />
          </g>
        </svg>
      </div>
      <span className="landing720-yubi-artwork__shine" />
      <span className="landing720-yubi-artwork__corner landing720-yubi-artwork__corner--one" />
      <span className="landing720-yubi-artwork__corner landing720-yubi-artwork__corner--two" />
    </div>
  )
}

export function LandingYubiJourney() {
  const { t, direction } = useI18n()
  const { isCompact } = useResponsive()
  const pilotRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const root = document.querySelector<HTMLElement>('.landing720')
    if (!root) return
    const revealTargets = Array.from(root.querySelectorAll<HTMLElement>('[data-yubi-reveal]'))
    if (!('IntersectionObserver' in window)) {
      revealTargets.forEach((target) => target.classList.add('is-yubi-revealed'))
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-yubi-revealed')
            observer.unobserve(entry.target)
          }
        })
      },
      { rootMargin: '0px 0px -12% 0px', threshold: 0.12 },
    )

    root.classList.add('is-yubi-motion-ready')
    revealTargets.forEach((target) => observer.observe(target))

    return () => {
      observer.disconnect()
      root.classList.remove('is-yubi-motion-ready')
    }
  }, [])

  useEffect(() => {
    const pilot = pilotRef.current
    const root = document.querySelector<HTMLElement>('.landing720')
    if (!pilot || !root) return

    const stops = Array.from(root.querySelectorAll<HTMLElement>('[data-yubi-stop]'))
    const artwork = root.querySelector<HTMLElement>('.landing720-yubi-artwork')
    if (stops.length === 0) return

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    let frame = 0
    let flightStopTimer = 0
    let resizeTimer = 0
    let isActivelyScrolling = false
    let previousScrollY = window.scrollY

    const update = () => {
      frame = 0
      const viewportWidth = window.innerWidth
      const viewportHeight = window.innerHeight
      const focusOffset = viewportHeight * 0.52
      const anchors = stops.map((element) => {
        const rect = element.getBoundingClientRect()
        const center = rect.top + window.scrollY + rect.height * 0.5
        return {
          element,
          scene: element.dataset.yubiStop ?? 'hero',
          center,
          trigger: Math.max(0, center - focusOffset),
        }
      })

      let index = 0
      while (index < anchors.length - 1 && window.scrollY > anchors[index + 1].trigger) index += 1

      const current = anchors[index]
      const next = anchors[Math.min(index + 1, anchors.length - 1)]
      const heroAnchor = anchors.find((anchor) => anchor.scene === 'hero')
      const distance = Math.max(1, next.trigger - current.trigger)
      const rawProgress = current === next ? 0 : clamp((window.scrollY - current.trigger) / distance, 0, 1)
      const progress = smoothstep(rawProgress)
      const scenePoint = (scene: string) => {
        const point = pointFor(scene, direction === 'rtl')
        if (scene !== 'hero' || !artwork) {
          return isCompact ? { ...point, scale: point.scale * 0.78 } : point
        }

        const artworkRect = artwork.getBoundingClientRect()
        const artworkDocumentY = artworkRect.top + window.scrollY + artworkRect.height * 0.5
        const dockScroll = Math.min(window.scrollY, heroAnchor?.trigger ?? 0)
        return {
          ...point,
          x: (artworkRect.left + artworkRect.width * 0.5) / viewportWidth,
          y: (artworkDocumentY - dockScroll) / viewportHeight,
          scale: clamp((artworkRect.width * 0.55) / pilot.offsetWidth, 0.48, isCompact ? 0.72 : point.scale),
        }
      }
      const from = scenePoint(current.scene)
      const to = scenePoint(next.scene)
      const arc = prefersReducedMotion.matches ? 0 : Math.sin(progress * Math.PI) * Math.min(88, viewportHeight * 0.1)
      const scale = from.scale + (to.scale - from.scale) * progress
      const pilotHalfWidth = pilot.offsetWidth * scale * 0.5
      const pilotHalfHeight = pilot.offsetHeight * scale * 0.5
      const safeInset = 16
      const isDockedToHero = current.scene === 'hero' && rawProgress === 0
      const x = clamp(
        (from.x + (to.x - from.x) * progress) * viewportWidth,
        safeInset + pilotHalfWidth,
        viewportWidth - safeInset - pilotHalfWidth,
      )
      const rawY = (from.y + (to.y - from.y) * progress) * viewportHeight - arc
      const y = isDockedToHero
        ? rawY
        : clamp(rawY, safeInset + pilotHalfHeight, viewportHeight - safeInset - pilotHalfHeight)
      const opacity = from.opacity + (to.opacity - from.opacity) * progress
      const directionDelta = (to.x - from.x) * viewportWidth
      const rotation = prefersReducedMotion.matches ? 0 : clamp(directionDelta * 0.018 * Math.sin(progress * Math.PI), -13, 13)
      const isFlying = !prefersReducedMotion.matches && isActivelyScrolling && current !== next

      pilot.style.left = `${x}px`
      pilot.style.top = `${y}px`
      pilot.style.opacity = `${opacity}`
      pilot.style.transform = `translate3d(-50%, -50%, 0) rotate(${rotation}deg) scale(${scale})`
      pilot.dataset.flying = isFlying ? 'true' : 'false'
      root.dataset.yubiFlying = isFlying ? 'true' : 'false'
      pilot.dataset.scene = progress > 0.55 ? next.scene : current.scene
      root.dataset.yubiScene = pilot.dataset.scene
    }

    const scheduleUpdate = () => {
      if (frame) return
      frame = window.requestAnimationFrame(update)
    }

    const handleScroll = () => {
      const scrollDelta = Math.abs(window.scrollY - previousScrollY)
      previousScrollY = window.scrollY
      isActivelyScrolling = !prefersReducedMotion.matches && scrollDelta > 0.5

      if (flightStopTimer) window.clearTimeout(flightStopTimer)
      flightStopTimer = window.setTimeout(() => {
        isActivelyScrolling = false
        pilot.dataset.flying = 'false'
        root.dataset.yubiFlying = 'false'
      }, 180)

      scheduleUpdate()
    }

    const handleResize = () => {
      scheduleUpdate()
      if (resizeTimer) window.clearTimeout(resizeTimer)
      resizeTimer = window.setTimeout(scheduleUpdate, 120)
    }

    update()
    resizeTimer = window.setTimeout(scheduleUpdate, 120)
    const resizeObserver = 'ResizeObserver' in window ? new ResizeObserver(scheduleUpdate) : null
    resizeObserver?.observe(document.documentElement)
    if (artwork) resizeObserver?.observe(artwork)
    stops.forEach((stop) => resizeObserver?.observe(stop))
    window.addEventListener('scroll', handleScroll, { passive: true })
    window.addEventListener('resize', handleResize, { passive: true })
    prefersReducedMotion.addEventListener('change', scheduleUpdate)

    return () => {
      if (frame) window.cancelAnimationFrame(frame)
      if (flightStopTimer) window.clearTimeout(flightStopTimer)
      if (resizeTimer) window.clearTimeout(resizeTimer)
      resizeObserver?.disconnect()
      window.removeEventListener('scroll', handleScroll)
      window.removeEventListener('resize', handleResize)
      prefersReducedMotion.removeEventListener('change', scheduleUpdate)
      delete root.dataset.yubiScene
      delete root.dataset.yubiFlying
    }
  }, [direction, isCompact])

  return (
    <>
      <div className="landing720-flight-scene" aria-hidden="true">
        <span className="landing720-flight-glow" />
        <span className="landing720-flight-orbit landing720-flight-orbit--outer" />
        <span className="landing720-flight-orbit landing720-flight-orbit--inner" />
        <span className="landing720-flight-beam" />
        <span className="landing720-flight-node landing720-flight-node--one" />
        <span className="landing720-flight-node landing720-flight-node--two" />
        <span className="landing720-flight-node landing720-flight-node--three" />
        {Array.from({ length: 8 }, (_, index) => (
          <span key={index} className={`landing720-flight-star landing720-flight-star--${index + 1}`} />
        ))}
      </div>

      <div ref={pilotRef} className="landing720-yubi-pilot" aria-hidden="true" data-flying="false">
        <span className="landing720-yubi-speed landing720-yubi-speed--one" />
        <span className="landing720-yubi-speed landing720-yubi-speed--two" />
        <span className="landing720-yubi-speed landing720-yubi-speed--three" />
        <div className="landing720-yubi-pilot__robot">
          <YubiAvatar3D initialDesign={DEFAULT_DESIGN} label={t('companion.title')} muted frontFacing />
          <Thrusters />
        </div>
      </div>
    </>
  )
}
