/* "המסלול שלי" — the unit's route as a 3D flight path.

   The tab used to render the same flat SVG ladder as the portal card, squeezed
   into a 380px panel: the stations were a vertical list of pills and the "path"
   was a dashed line behind them. In the panel it read as a table of contents,
   not as a place the learner is travelling through.

   This is a real scene instead: the components are gem stations threaded along a
   curve that banks through space, the completed run of the track is lit, and
   Yuvi's marker sits on the station the learner is actually on (flying between
   them when the lesson reports a move).

   Two hard rules kept from the flat version:
   - Every state comes from `progress_state` (Brain/xAPI). Nothing here infers
     progress from position on the curve.
   - The canvas is decorative. The stations are real HTML buttons projected on
     top of it, so the track is keyboard-navigable and readable by a screen
     reader exactly like the list it replaced. */

import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useI18n } from '../../i18n/I18nProvider'
import { useYuviDesign } from '../Yuvi-studio/YuviDesignProvider'
import { YuviAvatar3D } from '../Yuvi-studio/YuviAvatar3D'
import type { LearningComponentDTO, LearningProgressState, LearningUnitDTO } from '../../services/learning'
import { horizon, stationGlyph } from '../learning/pathView'
import { buildPlatform, designFor, type RoomKind } from './track-platform'
import './companion-track-3d.css'

interface CompanionTrack3DProps {
  unit: LearningUnitDTO
  activeComponentId?: string | null
  /** Where the learner just came from — the marker flies this leg once. */
  travellingFromId?: string | null
  onSelect?: (component: LearningComponentDTO) => void
}

const STATE_COLOR: Record<LearningProgressState, number> = {
  completed: 0x34d399,
  current: 0xa78bfa,
  available: 0x60a5fa,
  locked: 0x4b5563,
  // Never drawn on the route — an optional extra lives in the details panel —
  // but the map has to be total, and this is the tone it takes if it ever is.
  skipped: 0x64748b,
}

/** Vertical gap between stations, in world units. Wide enough that a station
    and the one after it never overlap now that they sit on opposite sides. */
const STEP = 3.2
/** How far the route swings left/right. The stations alternate sides, so this
    is half the total width of the switchback — the learner reads the route as
    walking across and back rather than straight down a corridor.
    Kept TIGHT on purpose: the frustum has to be wide enough to hold both
    columns, and every unit of swing zooms the whole diorama out. At 2.15 the
    rooms shrank to ~90px and all the furniture inside them turned to mush. */
const SWING = 1.3
/** Stations kept in frame at once. A long unit scrolls this window along the
    track rather than shrinking every station to a dot. */
const WINDOW_STATIONS = 2
// True isometric: equal foreshortening on both ground axes. An orthographic
// camera is what makes it read as a diorama rather than a corridor — with a
// perspective lens the far platforms taper and the shared edges stop lining up.
const ISO = new THREE.Vector3(1, 0.82, 1).normalize()
/** Half a platform plus breathing room, so a station on the outside of the
    switchback is never clipped by the frustum edge. This is also the zoom dial:
    the frustum is grown until `SWING + SIZE_MARGIN` fits, so a larger margin
    pulls the camera back and every room gets smaller. */
const SIZE_MARGIN = 1.55
/** Fraction of the visible height left empty at the BOTTOM of the panel, where
    the current-lesson card sits and the panel's own chrome crowds in. Station 1
    is the lowest point of the track, so without this it sat right on the edge. */
const BOTTOM_GUTTER = 0.09

function purposeKey(component: LearningComponentDTO) {
  if (component.is_assessment) return 'learning.component.assessment'
  if (component.purpose === 'instruction') return 'learning.component.instruction'
  if (component.purpose === 'practice') return 'learning.component.practice'
  return 'learning.component.activity'
}

/** Furnish each room for the work done in it — same reading as the caption. */
function roomKind(component: LearningComponentDTO): RoomKind {
  if (component.is_assessment) return 'assessment'
  if (component.purpose === 'instruction') return 'instruction'
  if (component.purpose === 'practice') return 'practice'
  return 'activity'
}

export function CompanionTrack3D({
  unit,
  activeComponentId,
  travellingFromId,
  onSelect,
}: CompanionTrack3DProps) {
  const { t } = useI18n()
  const { design } = useYuviDesign()
  const hostRef = useRef<HTMLDivElement>(null)
  const labelLayerRef = useRef<HTMLDivElement>(null)
  /** Where the real avatar is parked over the canvas, written by the loop. */
  const mascotRef = useRef<HTMLDivElement>(null)
  /** The pan indicator: a real, draggable scrollbar over the canvas. A canvas
   *  has no native scrollbar, so without this the track gave no sign that there
   *  was more of it above and below the frame. */
  const scrollRef = useRef<HTMLDivElement>(null)
  const thumbRef = useRef<HTMLDivElement>(null)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  /** Leaving the open activity is a real decision, so it is confirmed rather
   *  than executed on the click that lands on a station. */
  const [pending, setPending] = useState<LearningComponentDTO | null>(null)

  const components = useMemo(
    // This learner's route only, and only as far as it is actually decided —
    // the rest is fog, which is what lets an adaptive path grow a step without
    // anything on screen having to renumber.
    () => horizon(unit).nodes,
    [unit],
  )

  const hasHorizon = useMemo(() => horizon(unit).hasHorizon, [unit])

  // Station coordinates: a SWITCHBACK. Stations alternate left and right of the
  // centre line, so each room gets the full panel width to itself instead of
  // being stacked in a narrow column — and the path between them reads as a walk
  // across the space rather than a straight drop.
  const points = useMemo(
    () => components.map((component, index) => new THREE.Vector3(
      (index % 2 === 0 ? -1 : 1) * SWING,
      index * STEP,
      // A little depth alternation as well, so the two columns do not sit on one
      // flat plane and the isometric projection has something to separate.
      (index % 2 === 0 ? 0.5 : -0.5),
    )),
    [components],
  )

  const activeIndex = Math.max(0, components.findIndex((c) => c.id === activeComponentId))

  // Live refs so the animation loop never restarts on a hover or a prop tick.
  const activeIndexRef = useRef(activeIndex)
  const hoveredRef = useRef<string | null>(null)
  // The mascot is built once per scene; the design ref lets a later save be
  // picked up on the next rebuild without making the design a scene dependency
  // (which would tear down and re-create the whole track on every avatar tweak).
  const designRef = useRef(design)
  useEffect(() => { activeIndexRef.current = activeIndex }, [activeIndex])
  useEffect(() => { hoveredRef.current = hoveredId }, [hoveredId])
  useEffect(() => { designRef.current = design }, [design])

  useEffect(() => {
    const host = hostRef.current
    if (!host || components.length === 0) return

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const scene = new THREE.Scene()
    scene.fog = new THREE.FogExp2(0x0b1030, 0.018)

    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200)
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'low-power',
    })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setClearColor(0x000000, 0)
    host.appendChild(renderer.domElement)
    renderer.domElement.setAttribute('aria-hidden', 'true')

    const disposables: { dispose(): void }[] = []
    // Generic so the concrete geometry/material type survives — a widened
    // return here loses `setAttribute`, `index`, and every mesh constructor.
    const track = <T extends { dispose(): void }>(obj: T): T => {
      disposables.push(obj)
      return obj
    }

    // Lighting shaped for ISOMETRIC read: a strong key from above-right so the
    // top faces stay bright, one cool fill so the two side faces separate from
    // each other, and a low ambient — lifting ambient too far flattens the cube
    // back into a silhouette. The interiors need enough of it to be legible
    // through the glass, so this rig is brighter than a bare-platform one.
    scene.add(new THREE.AmbientLight(0x8f9ede, 0.95))
    const key = new THREE.DirectionalLight(0xffffff, 3.1)
    key.position.set(5, 10, 6)
    scene.add(key)
    const sideFill = new THREE.DirectionalLight(0x7aa2ff, 1.25)
    sideFill.position.set(-7, 1.5, 4)
    scene.add(sideFill)
    const backRim = new THREE.DirectionalLight(0xc9b6ff, 0.9)
    backRim.position.set(2, 3, -8)
    scene.add(backRim)
    // A soft lamp low over each room's open front, so the furniture inside is
    // lit rather than reading as a dark box behind glass. Each platform also
    // carries its own lamp (see `buildPlatform`); this one adds a warm accent
    // over whichever room the learner is actually looking at.
    const interior = new THREE.PointLight(0xfff2d8, 16, 9, 2)
    interior.position.set(1.6, 1.4, 1.6)
    scene.add(interior)
    // Front fill: the rooms open towards the camera, and without something
    // coming from that side every interior sat in its own shadow.
    const frontFill = new THREE.DirectionalLight(0xfff4e2, 1.5)
    frontFill.position.set(6, 4, 9)
    scene.add(frontFill)

    // ── The route between platforms ────────────────────────────────────────
    // Two tubes on one curve: a dim full-length rail, and a bright overlay
    // drawn only as far as the learner has actually completed.
    const curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.4)
    const railGeo = track(new THREE.TubeGeometry(curve, Math.max(64, components.length * 14), 0.05, 8, false))
    const railMat = track(new THREE.MeshBasicMaterial({ color: 0x33407a, transparent: true, opacity: 0.75 }))
    scene.add(new THREE.Mesh(railGeo, railMat))

    // Lit as far as the SERVER says this learner has walked. Derived counts got
    // this wrong the moment a path could skip or repeat a station.
    if (unit.progress_ratio > 0) {
      const litGeo = track(new THREE.TubeGeometry(curve, 160, 0.075, 8, false))
      litGeo.setDrawRange(0, Math.floor(litGeo.index!.count * Math.max(0.02, Math.min(1, unit.progress_ratio))))
      const litMat = track(new THREE.MeshBasicMaterial({ color: 0x34d399, transparent: true, opacity: 0.9 }))
      scene.add(new THREE.Mesh(litGeo, litMat))
    }

    // ── Where the known path ends ──────────────────────────────────────────
    // Three shrinking dashes continuing the switchback, then nothing. The tail
    // of an adaptive path genuinely is not decided — it depends on how the next
    // station goes — so drawing stations there would be a promise we would have
    // to take back. Fog is the honest version, and it is the reason a path that
    // grows can reveal a station instead of renumbering the map.
    if (hasHorizon && points.length > 0) {
      const last = points[points.length - 1]
      const side = points.length % 2 === 0 ? -1 : 1
      for (let step = 0; step < 3; step += 1) {
        const t = step + 1
        const dashGeo = track(new THREE.SphereGeometry(0.14 - step * 0.035, 10, 8))
        const dashMat = track(new THREE.MeshBasicMaterial({
          color: 0x8fa3ff, transparent: true, opacity: 0.4 - step * 0.11,
        }))
        const dash = new THREE.Mesh(dashGeo, dashMat)
        dash.position.set(last.x + side * t * 0.55, last.y + t * 0.95, last.z)
        scene.add(dash)
      }
      const mistGeo = track(new THREE.SphereGeometry(0.9, 16, 12))
      const mistMat = track(new THREE.MeshBasicMaterial({
        color: 0x9db4ff, transparent: true, opacity: 0.12,
      }))
      const mist = new THREE.Mesh(mistGeo, mistMat)
      mist.position.set(last.x + side * 1.9, last.y + 3.4, last.z - 0.3)
      scene.add(mist)
    }

    // ── Stations, as lit dioramas ──────────────────────────────────────────
    const stations: {
      id: string
      platform: ReturnType<typeof buildPlatform>
      locked: boolean
    }[] = []

    // Which design each station gets. Purpose alone repeated itself — this unit
    // has three `practice` components in a row, and three identical labs made
    // the route read as one room copied down a line. Counting the OCCURRENCE of
    // each purpose fixes that within a purpose, but the families overlap
    // (`activity` and `practice` both offer the market), so stations 1 and 4
    // still collided. We therefore walk each purpose's options and take the
    // first one no other station has claimed, only reusing once a family is
    // exhausted.
    const seenKinds = new Map<RoomKind, number>()
    const used = new Set<string>()
    const designs = components.map((component) => {
      const kind = roomKind(component)
      const occurrence = seenKinds.get(kind) ?? 0
      seenKinds.set(kind, occurrence + 1)
      let choice = designFor(kind, occurrence)
      for (let step = 0; step < 4 && used.has(choice); step += 1) {
        choice = designFor(kind, occurrence + step + 1)
      }
      used.add(choice)
      return choice
    })

    components.forEach((component, index) => {
      const color = STATE_COLOR[component.progress_state] ?? STATE_COLOR.locked
      const locked = component.progress_state === 'locked'
      const platform = buildPlatform({
        color,
        locked,
        current: component.progress_state === 'current',
        assessment: component.is_assessment,
        design: designs[index],
      }, track)
      platform.group.position.copy(points[index])
      platform.hitbox.userData.id = component.id
      scene.add(platform.group)
      stations.push({ id: component.id, platform, locked })
    })

    // ── The learner's own Yuvi ────────────────────────────────────────
    // He is NOT rebuilt here. A hand-made copy in this scene drifted from the
    // real figure the moment the studio changed — different proportions, no
    // equipped assets, no chest badge. Instead the loop projects his world
    // position to screen space and the actual `YuviAvatar3D` is laid over the
    // canvas at that point, exactly as the learning world does it. One figure,
    // one source of truth, and every asset the learner has equipped comes free.

    // ── Starfield ──────────────────────────────────────────────────────────
    const starCount = 260
    const starPos = new Float32Array(starCount * 3)
    const spanY = points[points.length - 1].y + 8
    for (let i = 0; i < starCount; i += 1) {
      starPos[i * 3] = (Math.random() - 0.5) * 28
      starPos[i * 3 + 1] = Math.random() * spanY - 4
      starPos[i * 3 + 2] = (Math.random() - 0.5) * 24 - 6
    }
    const starGeo = track(new THREE.BufferGeometry())
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3))
    const starMat = track(new THREE.PointsMaterial({
      color: 0x9fb4ff, size: 0.06, transparent: true, opacity: 0.75, sizeAttenuation: true,
    }))
    scene.add(new THREE.Points(starGeo, starMat))

    // ── Marker travel ──────────────────────────────────────────────────────
    const fromIndex = travellingFromId
      ? components.findIndex((c) => c.id === travellingFromId)
      : -1
    let travel = fromIndex >= 0 && fromIndex !== activeIndexRef.current ? 0 : 1

    // ── Interaction ────────────────────────────────────────────────────────
    const raycaster = new THREE.Raycaster()
    const pointer = new THREE.Vector2()
    let pointerInside = false
    const onPointerMove = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect()
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
      pointerInside = true
    }
    const onPointerLeave = () => { pointerInside = false; setHoveredId(null) }
    renderer.domElement.addEventListener('pointermove', onPointerMove)
    renderer.domElement.addEventListener('pointerleave', onPointerLeave)

    // ── Panning ────────────────────────────────────────────────────────────
    // The camera used to be welded to the active station, so a unit taller than
    // the window simply hid its other stations: there was no way to look ahead
    // at what is coming or back at what was done. Wheel and drag now move the
    // view along the track, and once the learner has taken over we stop pulling
    // them back to the active station — an auto-recentre while they are reading
    // reads as the panel fighting them.
    //
    // `browse` is a world-Y offset from the auto-focus, so the clamp below stays
    // expressed in the same track coordinates as `focusYFor`.
    let browse = 0
    let browsing = false
    let followedIndex = -1
    let dragging = false
    let dragStartY = 0
    let dragStartBrowse = 0
    // How much of a station a drag covers per pixel — derived from the frustum
    // so the diorama tracks the finger 1:1 whatever the panel size.
    let worldPerPixel = 0.01
    // The frustum is GROWN in `resize` until both columns of the switchback fit,
    // so the height actually on screen is usually more than `visibleSpan`. The
    // clamp has to use the real one — measuring against the nominal value let
    // the pan range collapse to nothing on a narrow panel, which is why the
    // wheel appeared to do nothing at all.
    // Set by the first `resize()`, which runs during setup before anything can
    // pan. Starting from `visibleSpan` here would read it before its own
    // declaration further down.
    let shownSpan = 0

    const canPan = () => {
      const { lo, hi } = panRange()
      return hi - lo > 0.01
    }

    const clampBrowse = () => {
      const { lo, hi } = panRange()
      if (hi <= lo) { browse = 0; return }
      const focus = focusYFor(Math.min(activeIndexRef.current, points.length - 1))
      browse = Math.min(Math.max(focus + browse, lo), hi) - focus
    }

    const onWheel = (event: WheelEvent) => {
      // Only claim the gesture when there is somewhere to go; otherwise the
      // panel behind us should keep scrolling normally.
      if (!canPan()) return
      event.preventDefault()
      browsing = true
      // A wheel moves the CONTENT, not the camera: scrolling down pulls the
      // diorama up so you see what sits below the frame, exactly like scrolling
      // a page. The camera therefore travels the other way — it used to follow
      // the wheel directly, which meant scrolling down walked the view UP the
      // track and every gesture read backwards.
      browse -= event.deltaY * worldPerPixel
      clampBrowse()
    }
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || !canPan()) return
      dragging = true
      dragStartY = event.clientY
      dragStartBrowse = browse
      renderer.domElement.setPointerCapture(event.pointerId)
      host.classList.add('is-panning')
    }
    const onPointerDrag = (event: PointerEvent) => {
      if (!dragging) return
      const moved = event.clientY - dragStartY
      if (Math.abs(moved) > 3) browsing = true
      browse = dragStartBrowse + moved * worldPerPixel
      clampBrowse()
    }
    const endDrag = (event: PointerEvent) => {
      if (!dragging) return
      dragging = false
      if (renderer.domElement.hasPointerCapture(event.pointerId)) {
        renderer.domElement.releasePointerCapture(event.pointerId)
      }
      host.classList.remove('is-panning')
    }
    renderer.domElement.addEventListener('wheel', onWheel, { passive: false })
    renderer.domElement.addEventListener('pointerdown', onPointerDown)
    renderer.domElement.addEventListener('pointermove', onPointerDrag)
    renderer.domElement.addEventListener('pointerup', endDrag)
    renderer.domElement.addEventListener('pointercancel', endDrag)

    // ── Scrollbar ──────────────────────────────────────────────────────────
    // A canvas has no scrollbar of its own, so a track taller than the panel
    // gave no sign that it continued above and below the frame. This is a real
    // one: the loop sizes and places the thumb from the camera, and grabbing it
    // (or clicking the rail) drives the camera back.
    const scrollEl = scrollRef.current
    const thumbEl = thumbRef.current
    /** Thumb height as a fraction of the rail — the share of the track on screen. */
    const thumbFraction = () => {
      const span = shownSpan || visibleSpan
      const total = lastY - firstY + span   // the pan range plus one frame
      return Math.max(0.14, Math.min(1, span / Math.max(total, 0.001)))
    }
    let scrollDragging = false
    /** Point the camera at the track position the rail was grabbed at. The
     *  thumb centre follows the pointer, so the usable rail is shortened by the
     *  thumb's own height — otherwise the ends were unreachable. */
    const scrollTo = (clientY: number) => {
      if (!scrollEl) return
      const rect = scrollEl.getBoundingClientRect()
      const frac = thumbFraction()
      const usable = rect.height * (1 - frac)
      const { lo, hi } = panRange()
      if (usable <= 0 || hi <= lo) return
      const p = Math.min(Math.max((clientY - rect.top - rect.height * frac * 0.5) / usable, 0), 1)
      browsing = true
      // Rail top = top of the track = the HIGHEST camera position.
      browse = (hi - p * (hi - lo)) - focusYFor(Math.min(activeIndexRef.current, points.length - 1))
      clampBrowse()
    }
    const onScrollDown = (event: PointerEvent) => {
      if (event.button !== 0 || !canPan()) return
      event.preventDefault()
      scrollDragging = true
      scrollEl?.setPointerCapture(event.pointerId)
      scrollTo(event.clientY)
    }
    const onScrollMove = (event: PointerEvent) => {
      if (!scrollDragging) return
      scrollTo(event.clientY)
    }
    const onScrollUp = (event: PointerEvent) => {
      if (!scrollDragging) return
      scrollDragging = false
      if (scrollEl?.hasPointerCapture(event.pointerId)) scrollEl.releasePointerCapture(event.pointerId)
    }
    scrollEl?.addEventListener('pointerdown', onScrollDown)
    scrollEl?.addEventListener('pointermove', onScrollMove)
    scrollEl?.addEventListener('pointerup', onScrollUp)
    scrollEl?.addEventListener('pointercancel', onScrollUp)

    // ── Loop ───────────────────────────────────────────────────────────────
    // ── Camera framing ─────────────────────────────────────────────────────
    // Derived from the track, not hard-coded: an orthographic frustum sized to
    // the window of stations we want in view. A fixed size framed only two of
    // five stations in a 380px panel — the rest sat above and below it with
    // nothing to say they existed.
    const firstY = points[0].y
    const lastY = points[points.length - 1].y
    const visibleSpan = Math.min(lastY - firstY, STEP * (WINDOW_STATIONS - 1)) + 2.4
    // Distance only has to clear the geometry — an ortho camera's framing comes
    // from the frustum, not from how far away it stands.
    const distance = 40
    // Keep the window inside the track so the ends are never half-empty, then
    // lift the whole diorama by a slice of the frame: the bottom of the panel
    // carries the current-lesson card, and station 1 — which sits at the very
    // bottom of the track — was tucked underneath it.
    // Looking a little lower down the track raises everything on screen by the
    // same amount, which is the "padding" this needs (the scene is a canvas, so
    // CSS padding would only letterbox it).
    //
    // The gutter belongs to the BOTTOM end only. Taking it off the top of the
    // range as well (as this first did) left a matching band of empty sky above
    // the last station, so panning up ran past the end of the track into
    // nothing — which is what made the pan feel like it overshot.
    const panRange = () => {
      const span = shownSpan || visibleSpan
      const half = span / 2
      const lo = firstY + half - span * BOTTOM_GUTTER   // station 1 clear of the card
      return { lo, hi: Math.max(lastY - half, lo) }     // last station at the top edge
    }
    const focusYFor = (index: number) => {
      const { lo, hi } = panRange()
      const gutter = (shownSpan || visibleSpan) * BOTTOM_GUTTER
      return Math.min(Math.max(points[index].y - gutter, lo), hi)
    }

    const labels = labelLayerRef.current
    const mascotEl = mascotRef.current
    const projected = new THREE.Vector3()
    const mascotAt = new THREE.Vector3()
    const camTarget = new THREE.Vector3()
    const camDesired = new THREE.Vector3()
    const isoOffset = ISO.clone().multiplyScalar(distance)
    let raf = 0
    let running = true
    const clock = new THREE.Clock()

    const resize = () => {
      const { clientWidth, clientHeight } = host
      if (!clientWidth || !clientHeight) return
      renderer.setSize(clientWidth, clientHeight, false)
      // Height drives the frustum so the station window is honoured whatever the
      // panel width — but the switchback is WIDE, so the frustum is then grown
      // until both columns fit. Without this the outer stations sat outside the
      // frustum on a narrow panel and simply vanished.
      let halfH = visibleSpan / 2
      const aspect = clientWidth / clientHeight
      const neededHalfW = SWING + SIZE_MARGIN
      if (halfH * aspect < neededHalfW) halfH = neededHalfW / aspect
      const halfW = halfH * aspect
      camera.top = halfH
      camera.bottom = -halfH
      camera.left = -halfW
      camera.right = halfW
      camera.updateProjectionMatrix()
      shownSpan = halfH * 2
      // World units per screen pixel, so a drag moves the diorama exactly as far
      // as the finger. `2 * halfH` world units map onto `clientHeight` pixels.
      worldPerPixel = (halfH * 2) / clientHeight
    }
    const observer = new ResizeObserver(resize)
    observer.observe(host)
    resize()

    // Start framed on the active station so the first frame is not a jump.
    const startY = focusYFor(Math.min(activeIndexRef.current, points.length - 1))
    camTarget.set(0, startY, 0)
    camera.position.copy(camTarget).add(isoOffset)
    camera.lookAt(camTarget)

    const frame = () => {
      if (!running) return
      raf = requestAnimationFrame(frame)
      // `getDelta()` FIRST, then read the accumulated time off the clock.
      // `getElapsedTime()` internally calls `getDelta()` and consumes it, so
      // asking for elapsed-then-delta handed every frame a delta of ~0: the
      // camera lerp, the hover ease and the platform lift are all delta-driven,
      // so they resolved to "move 0% of the way" and the whole scene was frozen
      // apart from the `elapsed`-driven sway. Panning looked broken for exactly
      // this reason — the target was updating, the camera just never chased it.
      const delta = Math.min(clock.getDelta(), 0.05)
      const elapsed = clock.elapsedTime

      const index = Math.min(activeIndexRef.current, points.length - 1)
      const focus = points[index]
      // Moving to a new station hands the camera back: the learner's browsing
      // was about the OLD position, and leaving them parked there after they
      // progressed would hide the station they just unlocked.
      if (index !== followedIndex) {
        followedIndex = index
        browsing = false
        browse = 0
      }

      // Camera: hold the window over the active station. The drift is a gentle
      // orbit around the iso axis rather than a sideways slide — sliding an
      // orthographic camera shears the whole diorama.
      const sway = reduceMotion ? 0 : Math.sin(elapsed * 0.16) * 0.06
      // Follow the active station until the learner takes over; from then on the
      // view is theirs. A station change re-arms the follow (`browsing` is
      // cleared below), so finishing a component still carries them onward.
      camDesired.set(0, focusYFor(index) + (browsing ? browse : 0), 0)
      camTarget.lerp(camDesired, 1 - Math.pow(0.002, delta))
      const orbit = isoOffset.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), sway)
      camera.position.copy(camTarget).add(orbit)
      camera.lookAt(camTarget)

      stations.forEach((station) => {
        station.platform.update(elapsed, station.id === hoveredRef.current, delta)
      })
      // One interior lamp is cheaper than five; park it over whichever room the
      // learner is looking at (the hovered one, else the active one).
      const litIndex = hoveredRef.current
        ? Math.max(0, components.findIndex((c) => c.id === hoveredRef.current))
        : index
      const litAt = points[litIndex] ?? focus
      interior.position.set(litAt.x + 1.5, litAt.y + 1.5, litAt.z + 1.5)

      // Yuvi walks the reported leg once, then settles on the platform deck.
      if (travel < 1) travel = Math.min(1, travel + delta * 0.45)
      const legFrom = fromIndex >= 0 ? points[fromIndex] : focus
      mascotAt.lerpVectors(legFrom, focus, travel)
      mascotAt.y += stations[index]?.platform.standY ?? 0.16
      // Stand in the open front-right quarter of the deck — the corner the
      // furniture deliberately leaves clear — rather than dead centre, where he
      // covered the room and collided with the station's own title card.
      mascotAt.x += 0.5
      mascotAt.z += 0.5
      // Hand his screen position to the DOM overlay that holds the real avatar.
      if (mascotEl) {
        projected.copy(mascotAt).project(camera)
        const rect = host.getBoundingClientRect()
        const mx = (projected.x * 0.5 + 0.5) * rect.width
        const my = (-projected.y * 0.5 + 0.5) * rect.height
        mascotEl.style.transform =
          `translate3d(${Math.round(mx)}px, ${Math.round(my)}px, 0) translate(-50%, -100%)`
        mascotEl.style.opacity = projected.z < 1 ? '1' : '0'
      }

      // Scrollbar: sized and placed from where the camera actually is, so it
      // reports the wheel, the drag and the auto-follow alike. Hidden outright
      // when the whole track fits — a full-length thumb is just noise.
      if (scrollEl && thumbEl) {
        const { lo, hi } = panRange()
        const room = hi - lo
        scrollEl.hidden = room <= 0.01
        if (room > 0.01) {
          const frac = thumbFraction()
          const p = Math.min(Math.max((hi - camTarget.y) / room, 0), 1)
          thumbEl.style.height = `${frac * 100}%`
          thumbEl.style.top = `${p * (1 - frac) * 100}%`
        }
      }

      // Hover picking (canvas only; the HTML buttons handle their own hover).
      if (pointerInside) {
        raycaster.setFromCamera(pointer, camera)
        const hit = raycaster.intersectObjects(stations.map((s) => s.platform.hitbox), false)[0]
        const id = hit ? String(hit.object.userData.id) : null
        if (id !== hoveredRef.current) setHoveredId(id)
        renderer.domElement.style.cursor = id ? 'pointer' : 'default'
      }

      // Project each station to screen space and place its HTML button there.
      if (labels) {
        const rect = host.getBoundingClientRect()
        stations.forEach((station, i) => {
          const el = labels.children[i] as HTMLElement | undefined
          if (!el) return
          projected.copy(points[i]).project(camera)
          const x = (projected.x * 0.5 + 0.5) * rect.width
          const y = (-projected.y * 0.5 + 0.5) * rect.height
          const visible = projected.z < 1 && y > -60 && y < rect.height + 60
          el.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0) translate(-50%, -50%)`
          el.style.opacity = visible ? '1' : '0'
          el.style.pointerEvents = visible ? 'auto' : 'none'
          // Which way the title card may open. Text direction is irrelevant
          // here — what matters is which side of the panel has room, and that
          // changes per station as the track banks.
          el.dataset.side = x > rect.width * 0.55 ? 'start' : 'end'
        })
      }

      renderer.render(scene, camera)
    }
    raf = requestAnimationFrame(frame)
    setReady(true)

    const onVisibility = () => {
      if (document.hidden) {
        running = false
        cancelAnimationFrame(raf)
      } else if (!running) {
        running = true
        clock.getDelta()   // drop the paused span so nothing lurches
        raf = requestAnimationFrame(frame)
      }
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      running = false
      cancelAnimationFrame(raf)
      document.removeEventListener('visibilitychange', onVisibility)
      observer.disconnect()
      renderer.domElement.removeEventListener('pointermove', onPointerMove)
      renderer.domElement.removeEventListener('pointerleave', onPointerLeave)
      renderer.domElement.removeEventListener('wheel', onWheel)
      renderer.domElement.removeEventListener('pointerdown', onPointerDown)
      renderer.domElement.removeEventListener('pointermove', onPointerDrag)
      renderer.domElement.removeEventListener('pointerup', endDrag)
      renderer.domElement.removeEventListener('pointercancel', endDrag)
      scrollEl?.removeEventListener('pointerdown', onScrollDown)
      scrollEl?.removeEventListener('pointermove', onScrollMove)
      scrollEl?.removeEventListener('pointerup', onScrollUp)
      scrollEl?.removeEventListener('pointercancel', onScrollUp)
      disposables.forEach((item) => item.dispose())
      renderer.dispose()
      host.removeChild(renderer.domElement)
    }
    // Rebuilt only when the route or the learner's place on it really changes.
  }, [components, points, travellingFromId, activeComponentId])

  const stateLabel = (state: LearningProgressState) => t(`learning.track.state.${state}`)

  return (
    <div className={`ct3d${ready ? ' is-ready' : ''}`}>
      <div className="ct3d__canvas" ref={hostRef} />

      {/* The learner's REAL Yuvi, parked on the station they are on. Positioned
          by the render loop from his projected world position. */}
      <div className="ct3d__mascot" ref={mascotRef} aria-hidden="true">
        <YuviAvatar3D
          initialDesign={design}
          label=""
          muted
          grounded
          performanceMode="low"
        />
      </div>

      {/* The real, focusable stations. Positioned over the canvas by the loop. */}
      <div className="ct3d__labels" ref={labelLayerRef}>
        {components.map((component) => {
          const isActive = component.id === activeComponentId
          const locked = component.progress_state === 'locked'
          return (
            <button
              key={component.path_node_id}
              type="button"
              className={`ct3d__station is-${component.progress_state}${isActive ? ' is-active' : ''}`}
              disabled={locked}
              aria-current={isActive ? 'step' : undefined}
              onMouseEnter={() => setHoveredId(component.id)}
              onMouseLeave={() => setHoveredId((current) => (current === component.id ? null : current))}
              onFocus={() => setHoveredId(component.id)}
              onBlur={() => setHoveredId((current) => (current === component.id ? null : current))}
              onClick={() => {
                if (locked) return
                // Already here: nothing to leave, so no warning to give.
                if (component.id === activeComponentId) return
                setPending(component)
              }}
              aria-label={`${component.title} — ${stateLabel(component.progress_state)}`}
            >
              {/* A state glyph rather than an ordinal: with a repeatable station
                  and a skippable stage, array position stopped being a step
                  number, and the real one is the server's `path_index`. */}
              <span className="ct3d__station-num" aria-hidden="true">{stationGlyph(component)}</span>
              <span className="ct3d__station-card" aria-hidden="true">
                <strong dir="auto">{component.title}</strong>
                <small>{t(purposeKey(component))} · {stateLabel(component.progress_state)}</small>
              </span>
            </button>
          )
        })}
      </div>

      {/* The pan indicator. Sized, placed and shown/hidden by the render loop —
          it is the canvas's stand-in for a scrollbar, and it is draggable. */}
      <div className="ct3d__scroll" ref={scrollRef} aria-hidden="true" hidden>
        <div className="ct3d__scroll-thumb" ref={thumbRef} />
      </div>

      {pending && (
        <div
          className="ct3d__confirm"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="ct3d-confirm-title"
          aria-describedby="ct3d-confirm-body"
        >
          <div className="ct3d__confirm-card">
            <h3 id="ct3d-confirm-title">{t('learning.track.leave.title')}</h3>
            <p id="ct3d-confirm-body">
              {t('learning.track.leave.body', { title: pending.title })}
            </p>
            <div className="ct3d__confirm-actions">
              <button type="button" className="ct3d__confirm-stay" onClick={() => setPending(null)}>
                {t('learning.track.leave.stay')}
              </button>
              <button
                type="button"
                className="ct3d__confirm-go"
                autoFocus
                onClick={() => { const target = pending; setPending(null); onSelect?.(target) }}
              >
                {t('learning.track.leave.go')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
