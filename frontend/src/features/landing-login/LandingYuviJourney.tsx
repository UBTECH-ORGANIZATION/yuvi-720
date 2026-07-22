import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../../i18n/I18nProvider'
import { useResponsive } from '../../hooks/useResponsive'
import { YuviAvatar3D } from '../Yuvi-studio/YuviAvatar3D'
import { DEFAULT_DESIGN } from '../Yuvi-studio/YuviDesign'

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
    <span className="landing720-Yuvi-thrusters" aria-hidden="true">
      <span className="landing720-Yuvi-smoke">
        {Array.from({ length: 6 }, (_, index) => <b key={index} />)}
      </span>
      <i />
      <i />
    </span>
  )
}

export function LandingYuviArtwork() {
  return (
    <div className="landing720-Yuvi-artwork" aria-hidden="true">
      <div className="landing720-Yuvi-artwork__image">
        <svg className="landing720-Yuvi-station" viewBox="0 0 620 436" role="presentation">
          <defs>
            <linearGradient id="holo-panel" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#ffffff" stopOpacity=".08" />
              <stop offset="1" stopColor="#9b7cff" stopOpacity=".05" />
            </linearGradient>
            <linearGradient id="holo-ring" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#c3b0ff" />
              <stop offset="1" stopColor="#7c5cf0" />
            </linearGradient>
            <linearGradient id="holo-accent" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#7c5cf0" />
              <stop offset="1" stopColor="#7fe6ff" />
            </linearGradient>
            <radialGradient id="holo-glow" cx="50%" cy="50%" r="50%">
              <stop offset="0" stopColor="#9d7cff" stopOpacity=".3" />
              <stop offset="1" stopColor="#9d7cff" stopOpacity="0" />
            </radialGradient>
            <linearGradient id="holo-cone" x1="0" y1="1" x2="0" y2="0">
              <stop offset="0" stopColor="#8f6cff" stopOpacity=".32" />
              <stop offset="1" stopColor="#8f6cff" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="holo-fig" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#cbbcff" stopOpacity=".9" />
              <stop offset="1" stopColor="#8a6ff0" stopOpacity=".45" />
            </linearGradient>
            <radialGradient id="holo-base" cx="50%" cy="50%" r="50%">
              <stop offset="0" stopColor="#b49bff" stopOpacity=".55" />
              <stop offset="1" stopColor="#b49bff" stopOpacity="0" />
            </radialGradient>
            <radialGradient id="holo-floor" cx="50%" cy="42%" r="60%">
              <stop offset="0" stopColor="#171226" />
              <stop offset=".6" stopColor="#0e0a1c" />
              <stop offset="1" stopColor="#0e0a1c" stopOpacity="0" />
            </radialGradient>
            <radialGradient id="holo-floor-sheen" cx="50%" cy="32%" r="54%">
              <stop offset="0" stopColor="#8a6ff0" stopOpacity=".24" />
              <stop offset="1" stopColor="#8a6ff0" stopOpacity="0" />
            </radialGradient>
            <clipPath id="holo-fig-clip">
              <circle cx="360" cy="190" r="21" />
              <path d="M332 244c0-24 13-39 28-39s28 15 28 39Z" />
            </clipPath>
          </defs>

          <g className="landing720-holo-scene" transform="translate(0 -6) scale(1)">
          <circle cx="378" cy="205" r="205" fill="url(#holo-glow)" />

          <g className="landing720-holo-floor">
            <ellipse className="landing720-holo-Yuvi-shadow" cx="150" cy="416" rx="92" ry="21" />
          </g>

          <g className="landing720-holo-float">
            <rect className="landing720-holo-glass" x="156" y="62" width="460" height="306" rx="32" />
            <rect className="landing720-holo-inner-glow" x="163" y="69" width="446" height="292" rx="27" />
            <rect className="landing720-holo-frame" x="156" y="62" width="460" height="306" rx="32" />
            <path className="landing720-holo-frame-shine" d="M188 65 Q160 65 160 92" />
            <path className="landing720-holo-edge-hi" d="M410 64 L188 64 Q160 64 160 92 L160 262" />
            <path className="landing720-holo-reflect" d="M182 118 L262 86" />
            <path className="landing720-holo-reflect" d="M182 150 L236 132" />

            <g className="landing720-holo-particles">
              <circle cx="270" cy="300" r="1.6" />
              <circle cx="352" cy="326" r="1.3" />
              <circle cx="432" cy="306" r="1.8" />
              <circle cx="500" cy="316" r="1.4" />
              <circle cx="232" cy="316" r="1.5" />
              <circle cx="312" cy="336" r="1.2" />
              <circle cx="412" cy="330" r="1.6" />
              <circle cx="540" cy="300" r="1.3" />
            </g>

            <g className="landing720-holo-lines">
              <path d="M290 160 L268 138" />
              <path d="M441 170 L512 132" />
              <path d="M452 206 L504 216" />
              <path d="M360 298 L360 318" />
            </g>

            <circle className="landing720-holo-packet landing720-holo-packet--a" r="2.4" />
            <circle className="landing720-holo-packet landing720-holo-packet--b cool" r="2.4" />
            <circle className="landing720-holo-packet landing720-holo-packet--c" r="2.4" />

            <circle className="landing720-holo-profile-glow" cx="360" cy="206" r="90" />
            <circle className="landing720-holo-pulse" cx="360" cy="206" r="86" />
            <circle className="landing720-holo-ring-bg" cx="360" cy="206" r="86" />
            <circle className="landing720-holo-ring" cx="360" cy="206" r="86" />
            <g className="landing720-holo-figure">
              <g className="landing720-holo-figure-fill">
                <circle cx="360" cy="190" r="21" />
                <path d="M332 244c0-24 13-39 28-39s28 15 28 39Z" />
              </g>
              <g clipPath="url(#holo-fig-clip)">
                <g className="landing720-holo-figure-scan">
                  <path d="M322 162H398M322 173H398M322 184H398M322 195H398M322 206H398M322 217H398M322 228H398M322 239H398M322 250H398" />
                </g>
              </g>
              <g className="landing720-holo-figure-line">
                <circle cx="360" cy="190" r="21" />
                <path d="M332 244c0-24 13-39 28-39s28 15 28 39Z" />
              </g>
              <g className="landing720-holo-figure-dots">
                <circle cx="360" cy="169" r="1.8" />
                <circle cx="341" cy="183" r="1.6" />
                <circle cx="379" cy="183" r="1.6" />
                <circle cx="333" cy="238" r="1.8" />
                <circle cx="387" cy="238" r="1.8" />
              </g>
            </g>

            <g className="landing720-holo-ai">
              <circle className="landing720-holo-ai-orbit" cx="360" cy="206" r="96" />
              <g className="landing720-holo-ai-nodes">
                <circle cx="360" cy="112" r="3" />
                <circle cx="443" cy="159" r="3" />
                <circle cx="443" cy="253" r="3" />
                <circle cx="360" cy="300" r="3" />
                <circle cx="277" cy="253" r="3" />
                <circle cx="277" cy="159" r="3" />
              </g>
              <g className="landing720-holo-ai-scan">
                <circle cx="360" cy="112" r="2.8" />
                <circle cx="360" cy="300" r="2.8" />
              </g>
            </g>

            <g transform="translate(232 120)">
              <circle className="landing720-holo-arc-bg" r="24" />
              <circle className="landing720-holo-arc" r="24" />
              <circle className="landing720-holo-dot" cx="0" cy="-24" r="2.8" />
            </g>

            <g className="landing720-holo-radar" transform="translate(542 116)">
              <polygon className="landing720-holo-radar-grid" points="0,-28 26,-8 17,23 -17,23 -26,-8" />
              <polygon className="landing720-holo-radar-grid" points="0,-17 16,-5 10,14 -10,14 -16,-5" />
              <polygon className="landing720-holo-radar-data" points="0,-22 19,-4 11,18 -13,13 -17,-6" />
            </g>

            <g className="landing720-holo-trend" transform="translate(506 198)">
              <path className="axis" d="M0 42H74" />
              <path className="line" d="M2 34 L16 24 L30 29 L44 14 L58 19 L74 6" />
              <circle cx="74" cy="6" r="2.6" />
            </g>

            <g className="landing720-holo-next" transform="translate(198 320)">
              <rect width="376" height="40" rx="13" />
              <circle className="landing720-holo-next-target" cx="26" cy="20" r="13" />
              <circle className="landing720-holo-next-target" cx="26" cy="20" r="7" />
              <circle className="landing720-holo-next-core" cx="26" cy="20" r="2.4" />
              <path className="landing720-holo-next-bar" d="M52 15h194" />
              <path className="landing720-holo-next-bar" d="M52 26h132" />
              <path className="landing720-holo-next-arrow" d="M330 20h20M341 13l7 7-7 7" />
            </g>
          </g>
          </g>
        </svg>
      </div>
      <span className="landing720-Yuvi-artwork__shine" />
      <span className="landing720-Yuvi-artwork__corner landing720-Yuvi-artwork__corner--one" />
      <span className="landing720-Yuvi-artwork__corner landing720-Yuvi-artwork__corner--two" />
    </div>
  )
}

export function LandingYuviJourney() {
  const { t, direction, language } = useI18n()
  const { isCompact } = useResponsive()
  const pilotRef = useRef<HTMLDivElement | null>(null)
  const sceneRef = useRef<string>('hero')
  const [scene, setScene] = useState<string>('hero')

  useEffect(() => {
    const root = document.querySelector<HTMLElement>('.landing720')
    if (!root) return
    const revealTargets = Array.from(root.querySelectorAll<HTMLElement>('[data-Yuvi-reveal]'))
    if (!('IntersectionObserver' in window)) {
      revealTargets.forEach((target) => target.classList.add('is-Yuvi-revealed'))
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-Yuvi-revealed')
            observer.unobserve(entry.target)
          }
        })
      },
      { rootMargin: '0px 0px -12% 0px', threshold: 0.12 },
    )

    root.classList.add('is-Yuvi-motion-ready')
    revealTargets.forEach((target) => observer.observe(target))

    return () => {
      observer.disconnect()
      root.classList.remove('is-Yuvi-motion-ready')
    }
  }, [])

  useEffect(() => {
    const pilot = pilotRef.current
    const root = document.querySelector<HTMLElement>('.landing720')
    if (!pilot || !root) return

    // Queried fresh on every update rather than captured once. On a language
    // switch the landing remounts, and this effect can run before the hero's
    // artwork is queryable — a captured `artwork` would then stay null for the
    // life of the effect and Yuvi would dock to the static fallback point
    // instead of the illustration, stranding him beside the hero.
    const readScene = () => ({
      stops: Array.from(root.querySelectorAll<HTMLElement>('[data-Yuvi-stop]')),
      artwork: root.querySelector<HTMLElement>('.landing720-Yuvi-artwork'),
    })
    if (readScene().stops.length === 0) return

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    let frame = 0
    let resizeTimer = 0

    // Smooth-follow (spring-like) state. Yuvi no longer tracks the raw scroll
    // position frame-for-frame. Each section publishes a *resting target* and a
    // separate render loop eases toward it, so the old scroll-coupled slide
    // becomes a calm companion that trails the reader, settles beside each
    // section, and — on a fast scroll — arrives gradually instead of snapping.
    let targetX = 0
    let targetY = 0
    let targetScale = 0.6
    let targetOpacity = 1
    let targetScene = 'hero'
    let renderX = 0
    let renderY = 0
    let renderScale = 0.6
    let renderOpacity = 1
    let renderRotation = 0
    let hasRender = false
    let tickFrame = 0
    let lastTick = 0

    // Slow, non-overshooting time constants (seconds). Larger = gentler trail.
    // Horizontal is the slowest so a section-to-section turn reads as a
    // deliberate "look over here", never a scroll-speed chase.
    const FOLLOW_TAU_X = 0.6
    const FOLLOW_TAU_Y = 0.42
    const FOLLOW_TAU_MISC = 0.3

    const tick = (now: number) => {
      tickFrame = 0
      if (!hasRender) return
      const reduce = prefersReducedMotion.matches
      const dt = lastTick ? Math.min(0.05, (now - lastTick) / 1000) : 1 / 60
      lastTick = now
      const easeToward = (tau: number) => (reduce ? 1 : 1 - Math.exp(-dt / tau))
      const alphaX = easeToward(FOLLOW_TAU_X)
      const alphaY = easeToward(FOLLOW_TAU_Y)
      const alphaMisc = easeToward(FOLLOW_TAU_MISC)

      const previousX = renderX
      renderX += (targetX - renderX) * alphaX
      renderY += (targetY - renderY) * alphaY
      renderScale += (targetScale - renderScale) * alphaMisc
      renderOpacity += (targetOpacity - renderOpacity) * alphaMisc

      // A soft lean toward the direction of travel that relaxes back upright
      // once Yuvi settles — no rocket-style tilt.
      const desiredRotation = reduce ? 0 : clamp((renderX - previousX) * 0.5, -5, 5)
      renderRotation += (desiredRotation - renderRotation) * alphaMisc

      pilot.style.left = `${renderX}px`
      pilot.style.top = `${renderY}px`
      pilot.style.opacity = `${renderOpacity}`
      pilot.style.transform = `translate3d(-50%, -50%, 0) rotate(${renderRotation}deg) scale(${renderScale})`

      const distance = Math.hypot(targetX - renderX, targetY - renderY)
      // Only surface the travel cue for a genuine catch-up (fast scroll);
      // ordinary trailing stays calm and rests.
      const catchingUp = !reduce && distance > 42
      pilot.dataset.flying = catchingUp ? 'true' : 'false'
      root.dataset.yuviFlying = catchingUp ? 'true' : 'false'
      pilot.dataset.scene = targetScene
      root.dataset.yuviScene = targetScene

      const settled =
        distance < 0.4 &&
        Math.abs(targetOpacity - renderOpacity) < 0.01 &&
        Math.abs(targetScale - renderScale) < 0.002 &&
        Math.abs(renderRotation) < 0.05
      if (settled) {
        renderX = targetX
        renderY = targetY
        renderScale = targetScale
        renderOpacity = targetOpacity
        renderRotation = 0
        pilot.style.left = `${renderX}px`
        pilot.style.top = `${renderY}px`
        pilot.style.opacity = `${renderOpacity}`
        pilot.style.transform = `translate3d(-50%, -50%, 0) rotate(0deg) scale(${renderScale})`
        pilot.dataset.flying = 'false'
        root.dataset.yuviFlying = 'false'
        return
      }
      tickFrame = window.requestAnimationFrame(tick)
    }

    const startTick = () => {
      if (tickFrame) return
      lastTick = 0
      tickFrame = window.requestAnimationFrame(tick)
    }

    const update = () => {
      frame = 0
      const { stops, artwork } = readScene()
      if (stops.length === 0) return
      const viewportWidth = window.innerWidth
      const viewportHeight = window.innerHeight
      const focusOffset = viewportHeight * 0.52
      const anchors = stops.map((element) => {
        const rect = element.getBoundingClientRect()
        const center = rect.top + window.scrollY + rect.height * 0.5
        return {
          scene: element.dataset.yuviStop ?? 'hero',
          trigger: Math.max(0, center - focusOffset),
        }
      })

      // Pick the section Yuvi belongs to and rest at *its* anchor. There is
      // deliberately no scroll-fraction interpolation between sections anymore —
      // easing between resting spots is owned entirely by the render loop.
      let index = 0
      while (index < anchors.length - 1 && window.scrollY > anchors[index + 1].trigger) index += 1
      const active = anchors[index]
      const heroAnchor = anchors.find((anchor) => anchor.scene === 'hero')

      const scenePoint = (scene: string) => {
        const point = pointFor(scene, direction === 'rtl')
        if (scene !== 'hero' || !artwork) {
          return isCompact ? { ...point, scale: point.scale * 0.78 } : point
        }
        const artworkRect = artwork.getBoundingClientRect()
        const artworkDocumentY = artworkRect.top + window.scrollY + artworkRect.height * 0.74
        const dockScroll = Math.min(window.scrollY, heroAnchor?.trigger ?? 0)
        return {
          ...point,
          x: (artworkRect.left + artworkRect.width * 0.25) / viewportWidth,
          y: (artworkDocumentY - dockScroll) / viewportHeight,
          scale: clamp((artworkRect.width * 0.32) / pilot.offsetWidth, 0.42, isCompact ? 0.6 : 0.72),
        }
      }

      const point = scenePoint(active.scene)
      const scale = point.scale
      const pilotHalfWidth = pilot.offsetWidth * scale * 0.5
      const pilotHalfHeight = pilot.offsetHeight * scale * 0.5
      const safeInset = 16
      const isDockedToHero = active.scene === 'hero'
      const rawY = point.y * viewportHeight
      targetX = clamp(
        point.x * viewportWidth,
        safeInset + pilotHalfWidth,
        viewportWidth - safeInset - pilotHalfWidth,
      )
      targetY = isDockedToHero
        ? rawY
        : clamp(rawY, safeInset + pilotHalfHeight, viewportHeight - safeInset - pilotHalfHeight)
      targetScale = scale
      targetOpacity = point.opacity
      targetScene = active.scene

      // Publish the resting scene to React so the avatar can hold a sustained
      // presenting pose in the hero (turned toward the hologram, near hand out)
      // and a neutral front pose elsewhere. Guarded so it only fires on change.
      if (active.scene !== sceneRef.current) {
        sceneRef.current = active.scene
        setScene(active.scene)
      }

      if (artwork) {
        const r = artwork.getBoundingClientRect()
        lastAnchor = { x: r.left + r.width * 0.5, y: r.top, w: r.width }
      }

      // First paint: adopt the target so Yuvi appears already docked instead of
      // sliding in from the CSS default position.
      if (!hasRender) {
        renderX = targetX
        renderY = targetY
        renderScale = targetScale
        renderOpacity = targetOpacity
        hasRender = true
      }
      startTick()
    }

    const scheduleUpdate = () => {
      if (frame) return
      frame = window.requestAnimationFrame(update)
    }

    const handleScroll = () => {
      scheduleUpdate()
    }

    const handleResize = () => {
      scheduleUpdate()
      if (resizeTimer) window.clearTimeout(resizeTimer)
      resizeTimer = window.setTimeout(scheduleUpdate, 120)
    }

    // Re-anchor every frame for a short window instead of at a few fixed
    // delays. A language switch remounts the page, mirrors the layout and swaps
    // text asynchronously (the locale JSON is fetched), so the hero artwork
    // keeps moving for several hundred ms — and a re-render in the middle of
    // that would cancel any timers we had pending. Driving it off rAF until the
    // layout stops moving is immune to both.
    let lastAnchor: { x: number; y: number; w: number } | null = null
    let settleUntil = 0
    let settleFrame = 0
    const settleLoop = () => {
      update()
      settleFrame = performance.now() < settleUntil ? window.requestAnimationFrame(settleLoop) : 0
    }
    const beginSettle = (duration = 1500) => {
      settleUntil = performance.now() + duration
      if (!settleFrame) settleFrame = window.requestAnimationFrame(settleLoop)
    }

    // Self-healing anchor watch. Nothing emits an event when an element merely
    // *moves* — ResizeObserver only fires on size — yet the hero artwork shifts
    // on locale swaps, font loads and image loads. Rather than guessing at
    // delays, cheaply re-read its rect and re-dock Yuvi whenever it has drifted.
    const anchorWatch = window.setInterval(() => {
      const { artwork: current } = readScene()
      if (!current || !lastAnchor) return
      const r = current.getBoundingClientRect()
      const moved =
        Math.abs(r.left + r.width * 0.5 - lastAnchor.x) > 0.5 ||
        Math.abs(r.top - lastAnchor.y) > 0.5 ||
        Math.abs(r.width - lastAnchor.w) > 0.5
      if (moved) scheduleUpdate()
    }, 150)

    update()
    beginSettle()
    resizeTimer = window.setTimeout(scheduleUpdate, 120)
    const resizeObserver = 'ResizeObserver' in window ? new ResizeObserver(scheduleUpdate) : null
    resizeObserver?.observe(document.documentElement)
    const initial = readScene()
    if (initial.artwork) resizeObserver?.observe(initial.artwork)
    initial.stops.forEach((stop) => resizeObserver?.observe(stop))

    // ResizeObserver fires on size, not position. Switching he <-> en mirrors the
    // hero: the artwork keeps its exact dimensions but jumps to the other side,
    // so nothing above notices and Yuvi is left stranded mid-page. Watch the
    // `dir`/`lang` attributes that I18nProvider writes on <html> instead.
    const localeObserver = new MutationObserver(() => beginSettle())
    localeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['dir', 'lang'],
    })
    window.addEventListener('scroll', handleScroll, { passive: true })
    window.addEventListener('resize', handleResize, { passive: true })
    prefersReducedMotion.addEventListener('change', scheduleUpdate)

    return () => {
      if (frame) window.cancelAnimationFrame(frame)
      if (tickFrame) window.cancelAnimationFrame(tickFrame)
      if (resizeTimer) window.clearTimeout(resizeTimer)
      if (settleFrame) window.cancelAnimationFrame(settleFrame)
      window.clearInterval(anchorWatch)
      resizeObserver?.disconnect()
      localeObserver.disconnect()
      window.removeEventListener('scroll', handleScroll)
      window.removeEventListener('resize', handleResize)
      prefersReducedMotion.removeEventListener('change', scheduleUpdate)
      delete root.dataset.yuviScene
      delete root.dataset.yuviFlying
    }
  }, [direction, language, isCompact])

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

      <div ref={pilotRef} className="landing720-Yuvi-pilot" aria-hidden="true" data-flying="false">
        <span className="landing720-Yuvi-speed landing720-Yuvi-speed--one" />
        <span className="landing720-Yuvi-speed landing720-Yuvi-speed--two" />
        <span className="landing720-Yuvi-speed landing720-Yuvi-speed--three" />
        <div className="landing720-Yuvi-pilot__robot">
          <YuviAvatar3D
            initialDesign={DEFAULT_DESIGN}
            label={t('companion.title')}
            muted
            frontFacing={scene !== 'hero'}
            presenting={scene === 'hero'}
            presentingSide="right"
          />
          <Thrusters />
        </div>
      </div>
    </>
  )
}
