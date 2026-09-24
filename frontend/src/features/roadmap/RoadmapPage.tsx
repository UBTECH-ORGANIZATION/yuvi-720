import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { ScrollToPlugin } from 'gsap/ScrollToPlugin'
import { navigate } from '../../app/router'
import { LearnerAppBar } from '../../components/LearnerAppBar'
import { ErrorState, Icon, LoadingState } from '../../components/primitives'
import { useI18n } from '../../i18n/I18nProvider'
import { useProgression } from '../../providers/ProgressionProvider'
import { useTheme } from '../../providers/ThemeProvider'
import { useStudioTransition } from '../Yuvi-studio/StudioTransitionProvider'
import { useYuviDesign } from '../Yuvi-studio/YuviDesignProvider'
import { rewardItems, rewardLabel, type RewardItem } from '../../services/levelRewards'
import {
  getProgressionRoadmap, type ProgressionRoadmap, type ProgressionStatus, type RoadmapLevel,
} from '../../services/progression'
import { createFpsGovernor, resolveRenderTier, storeTier } from '../Yuvi-studio/renderTier'
import { preRenderedThumb } from '../Yuvi-studio/studioThumbs'
import { WORLD_HOLOGRAM_FRAME, WORLD_HOLOGRAM_FRAMES, worldHologramStrip } from '../Yuvi-studio/worldHologramStrips'
import type { RoomLayoutId } from '../Yuvi-studio/RoomLayouts'
import {
  focusedIndex, isMilestone, levelState, positionIndex, roadmapWorld, scrollForIndex, xpAway, SEGMENT_PX,
  type LevelState, type RoadmapWorld,
} from './roadmapModel'
import { createRoadmapScene, type RoadmapScene, type SceneAnchor } from './RoadmapScene'
import './roadmap.css'

gsap.registerPlugin(ScrollTrigger, ScrollToPlugin)

/* The progress map: the whole XP ladder as a road through space, scrolled
   like a page. The scroll position IS the camera (ScrollTrigger scrubs it and
   snaps to the nearest pad), the pad the camera settles on raises its
   rewards, and a card beside them says what they are. The page mounts one
   WebGL context and nothing else that draws — it sits outside the learner
   shell, like the studio, so the companion dock's avatar does not open a
   second one next to it. */

const MIN_FLOATING_CARD_WIDTH = 720

export function RoadmapPage() {
  const { t } = useI18n()
  const { status: liveStatus } = useProgression()
  const [roadmap, setRoadmap] = useState<ProgressionRoadmap | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setFailed(false)
    getProgressionRoadmap(controller.signal)
      .then(setRoadmap)
      .catch(() => { if (!controller.signal.aborted) setFailed(true) })
    return () => controller.abort()
  }, [attempt])

  if (failed) {
    return (
      <div className="rm-page">
        <LearnerAppBar />
        <ErrorState title={t('roadmap.error')} action={<button className="sp-btn sp-btn--primary" type="button" onClick={() => setAttempt((n) => n + 1)}>{t('roadmap.retry')}</button>} />
      </div>
    )
  }
  if (!roadmap) {
    return (
      <div className="rm-page">
        <LearnerAppBar />
        <LoadingState title={t('roadmap.loading')} />
      </div>
    )
  }
  return <RoadmapStage roadmap={roadmap} status={liveStatus ?? roadmap.progression} />
}

interface StageProps {
  roadmap: ProgressionRoadmap
  status: ProgressionStatus
}

function RoadmapStage({ roadmap, status }: StageProps) {
  const { t, direction } = useI18n()
  const { theme } = useTheme()
  const { design } = useYuviDesign()
  const studioOpen = useStudioTransition()?.isOpen ?? false
  const levels = roadmap.levels
  const count = levels.length
  const stageRef = useRef<HTMLDivElement>(null)
  const cardRef = useRef<HTMLElement>(null)
  const sceneRef = useRef<RoadmapScene | null>(null)
  const statusRef = useRef(status)
  const designRef = useRef(design)
  const themeRef = useRef(theme)
  const focusRef = useRef(-1)
  const anchorRef = useRef<SceneAnchor | null>(null)
  const [focus, setFocus] = useState(-1)
  const [scrolled, setScrolled] = useState(false)
  const [webgl, setWebgl] = useState<'pending' | 'ready' | 'unavailable'>('pending')
  const reduceMotion = useMemo(
    () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches, [])
  // The learner's own pad. The beacon stands part-way to the next one
  // (`positionIndex`); the camera and the jump button settle on the pad.
  const meIndex = Math.max(0, Math.min(count - 1, status.level - 1))

  /** Where the card goes for an anchor: beside the raised rewards, on the
   *  side with more room, kept inside the viewport and under the app bar. On
   *  a narrow screen the CSS docks it at the bottom instead. */
  const placeCard = useCallback((anchor: SceneAnchor | null) => {
    const card = cardRef.current
    if (!card) return
    if (!anchor || !anchor.visible) { card.classList.add('is-offscreen'); return }
    card.classList.remove('is-offscreen')
    const vw = window.innerWidth
    const vh = window.innerHeight
    if (vw < MIN_FLOATING_CARD_WIDTH) { card.style.left = ''; card.style.top = ''; card.classList.remove('is-left', 'is-right'); return }
    const width = card.offsetWidth
    const height = card.offsetHeight
    const gap = 28
    // Beside the raised rewards, on the side with more room for the card.
    const roomRight = vw - anchor.spanRight
    const roomLeft = anchor.spanLeft
    const top = Math.max(88, Math.min(vh - height - 16, anchor.y - height / 2))
    const placement = (right: boolean) => ({
      right,
      left: right
        ? Math.min(vw - width - 16, anchor.spanRight + gap)
        : Math.max(16, anchor.spanLeft - gap - width),
    })
    const overlapsYuvi = (left: number) => anchor.yuviVisible
      && left < anchor.yuviRight
      && left + width > anchor.yuviLeft
      && top < anchor.yuviBottom
      && top + height > anchor.yuviTop
    const preferredRight = roomRight >= roomLeft
    const candidates = [placement(preferredRight), placement(!preferredRight)]
    // Yuvi moves beside locked pads; the card must choose the other side when
    // its normal reward-based preference would cover him.
    const chosen = candidates.find((candidate) => !overlapsYuvi(candidate.left)) ?? candidates[0]
    card.style.left = `${Math.round(chosen.left)}px`
    card.style.top = `${Math.round(top)}px`
    card.classList.toggle('is-right', chosen.right)
    card.classList.toggle('is-left', !chosen.right)
  }, [])

  // ── The scene, the scroll and the governor: one mount, one teardown.
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const resolved = resolveRenderTier('auto')
    // The governor may only drop here. This page is lighter than the studio,
    // so a fast frame here says nothing about the studio; a slow one does.
    const governor = createFpsGovernor({
      initial: resolved.final,
      ceiling: resolved.final,
      onChange: (next) => { sceneRef.current?.setQuality(next); storeTier(next) },
    })
    const scene = createRoadmapScene(stage, {
      levels,
      status: statusRef.current,
      design: designRef.current,
      theme: themeRef.current,
      tier: resolved.final,
      reduceMotion,
      onAnchor: (anchor) => { anchorRef.current = anchor; placeCard(anchor) },
      onFrame: (ms, now) => governor.sample(ms, now),
    })
    if (!scene) { setWebgl('unavailable'); return }
    sceneRef.current = scene
    setWebgl('ready')

    const maxScroll = () => Math.max(1, document.documentElement.scrollHeight - window.innerHeight)
    const focusOn = (index: number) => {
      if (index === focusRef.current) return
      focusRef.current = index
      scene.setFocus(index)
      setFocus(index)
    }
    const trigger = ScrollTrigger.create({
      start: 0,
      end: maxScroll,
      onUpdate: (self) => {
        const progress = self.progress * (count - 1)
        scene.setTarget(progress)
        focusOn(focusedIndex(progress, count))
      },
      snap: {
        snapTo: 1 / Math.max(1, count - 1),
        duration: reduceMotion ? 0.01 : { min: 0.15, max: 0.5 },
        delay: 0.05,
        ease: 'power2.out',
      },
    })

    // The scroll position is the camera, so a reload must not have the
    // browser put it back where it was over the fly-in below.
    const restoration = window.history.scrollRestoration
    window.history.scrollRestoration = 'manual'
    // Fly in: start a few pads back and travel up to the learner's own, so
    // the first thing the page does is show the road already travelled.
    const me = Math.max(0, Math.min(count - 1, statusRef.current.level - 1))
    const from = Math.max(0, me - 3)
    const target = scrollForIndex(me, maxScroll(), count)
    window.scrollTo(0, scrollForIndex(from, maxScroll(), count))
    scene.jumpTo(from)
    focusOn(reduceMotion ? me : from)
    let flight: gsap.core.Tween | null = null
    if (reduceMotion || from === me) {
      window.scrollTo(0, target)
    } else {
      flight = gsap.to(window, { scrollTo: { y: target, autoKill: false }, duration: 2.1, delay: 0.35, ease: 'power3.inOut' })
    }
    // The hint goes when the learner moves the road themselves — the fly-in
    // scrolls too, so a scroll event is not the signal.
    const onIntent = () => setScrolled(true)
    for (const type of ['wheel', 'touchmove', 'keydown']) window.addEventListener(type, onIntent, { passive: true, once: true })

    return () => {
      for (const type of ['wheel', 'touchmove', 'keydown']) window.removeEventListener(type, onIntent)
      flight?.kill()
      gsap.killTweensOf(window)
      trigger.kill()
      scene.dispose()
      sceneRef.current = null
      // The next page must not open two screens down.
      window.scrollTo(0, 0)
      window.history.scrollRestoration = restoration
    }
  }, [levels, count, reduceMotion, placeCard])

  useEffect(() => {
    statusRef.current = status
    sceneRef.current?.setStatus(status)
  }, [status])

  useEffect(() => {
    if (designRef.current === design) return
    designRef.current = design
    sceneRef.current?.setDesign(design)
  }, [design])

  useEffect(() => {
    themeRef.current = theme
    sceneRef.current?.setTheme(theme)
  }, [theme])

  // The studio opens as an overlay over this page and brings its own WebGL
  // context; the road stops drawing underneath it rather than sharing the GPU.
  useEffect(() => {
    sceneRef.current?.setPaused(studioOpen)
  }, [studioOpen])

  // The card slides in whenever the focus lands on a new pad.
  useEffect(() => {
    const card = cardRef.current
    if (!card || focus < 0) return
    placeCard(anchorRef.current)
    const tween = gsap.fromTo(card, { opacity: 0, y: reduceMotion ? 0 : 18, scale: reduceMotion ? 1 : 0.97 }, { opacity: 1, y: 0, scale: 1, duration: reduceMotion ? 0.15 : 0.42, ease: 'power3.out', delay: reduceMotion ? 0 : 0.12 })
    return () => { tween.kill() }
  }, [focus, placeCard, reduceMotion])

  const jumpTo = useCallback((index: number) => {
    const clamped = Math.max(0, Math.min(count - 1, Math.round(index)))
    const maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight)
    const distance = Math.abs(clamped - focusRef.current)
    gsap.to(window, {
      scrollTo: { y: scrollForIndex(clamped, maxScroll, count), autoKill: false },
      duration: reduceMotion ? 0.01 : Math.min(1.6, 0.35 + distance * 0.09),
      ease: 'power2.inOut',
      overwrite: true,
    })
  }, [count, reduceMotion])

  // ←/→ walk the road one pad at a time (mirrored for a right-to-left page);
  // ↑/↓ and the wheel scroll it natively.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable]')) return
      const forward = direction === 'rtl' ? 'ArrowLeft' : 'ArrowRight'
      const back = direction === 'rtl' ? 'ArrowRight' : 'ArrowLeft'
      if (event.key === forward) { event.preventDefault(); jumpTo(focusRef.current + 1) }
      else if (event.key === back) { event.preventDefault(); jumpTo(focusRef.current - 1) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [direction, jumpTo])

  const row = focus >= 0 ? levels[focus] : null
  const trackStyle = { blockSize: `calc(${(count - 1) * SEGMENT_PX}px + 100vh - var(--mapping-app-bar-height, 68px))` }

  return (
    <div className="rm-page" data-webgl={webgl}>
      <LearnerAppBar />
      <div className="rm-stage" ref={stageRef} aria-hidden="true" />
      {webgl === 'unavailable' ? (
        <LevelList levels={levels} status={status} />
      ) : (
        <>
          <div className="rm-track" style={trackStyle} aria-hidden="true" />
          <div className="rm-hud">
            <div className="rm-hud__title">
              <h1>{t('roadmap.title')}</h1>
              <p>{t('roadmap.subtitle')}</p>
            </div>
            <HereChip status={status} onJump={() => jumpTo(meIndex)} />
          </div>
          {row ? <WorldBadge key={roadmapWorld(row.level)} world={roadmapWorld(row.level)} /> : null}
          {row ? <LevelCard ref={cardRef} row={row} status={status} total={count} /> : null}
          <p className={`rm-hint${scrolled ? ' is-done' : ''}`} aria-hidden={scrolled}>
            <span className="rm-hint__mouse" aria-hidden="true"><i /></span>
            {t('roadmap.hint')}
          </p>
          <span className="rm-live" role="status" aria-live="polite">
            {row ? t('roadmap.rail.level', { level: String(row.level) }) : ''}
          </span>
        </>
      )}
    </div>
  )
}

/* ── The world Yuvi is flying through ──────────────────────────────────── */

const WORLD_EMBLEMS: Record<RoadmapWorld, React.ReactNode> = {
  snow: <><path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9" /><path d="M9.5 4.5 12 7l2.5-2.5M9.5 19.5 12 17l2.5 2.5" /></>,
  space: <><circle cx="12" cy="12" r="5" /><ellipse cx="12" cy="12" rx="10" ry="3.5" transform="rotate(-20 12 12)" /></>,
  music: <><path d="M9 18V5l11-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="17" cy="16" r="3" /></>,
  street: <><rect x="7" y="9" width="8" height="12" rx="2" /><path d="M9 9V6h4v3M11 6V4M17 5h.01M19 3h.01M19 7h.01" /></>,
  jungle: <><path d="M20 4C12 4 5 8 5 14c0 3 2 5 5 5 6 0 10-7 10-15Z" /><path d="M5 20c2-5 6-8 11-11" /></>,
}

function WorldBadge({ world }: { world: RoadmapWorld }) {
  const { t } = useI18n()
  const name = t(`roadmap.world.${world}`)
  return (
    <div className="rm-world" data-world={world} title={name}>
      <span className="rm-world__emblem" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          {WORLD_EMBLEMS[world]}
        </svg>
      </span>
      <span className="rm-world__text">
        <small>{t('roadmap.world.eyebrow')}</small>
        <strong>{name}</strong>
      </span>
    </div>
  )
}

/* ── "You are here" ─────────────────────────────────────────────────────── */

function HereChip({ status, onJump }: { status: ProgressionStatus; onJump: () => void }) {
  const { t } = useI18n()
  const percent = Math.round(Math.max(0, Math.min(1, status.progress)) * 100)
  return (
    <div className="rm-here">
      <span className="rm-here__medal" aria-hidden="true">
        <small>{t('progression.level')}</small>
        <strong>{status.level}</strong>
      </span>
      <div className="rm-here__body">
        <b>{t('roadmap.here.title')}</b>
        <span dir="ltr" className="rm-here__xp">
          {status.nextLevel
            ? t('progression.ratio', { current: String(status.currentLevelXp), required: String(status.xpToNext ?? 0) })
            : t('progression.maxLevel')}
        </span>
        <span className="rm-here__bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
          <i style={{ inlineSize: `${percent}%` }} />
        </span>
        <small>
          {status.nextLevel
            ? t('roadmap.here.away', { xp: String(Math.max(0, (status.xpToNext ?? 0) - status.currentLevelXp)), level: String(status.nextLevel) })
            : t('roadmap.here.max')}
        </small>
      </div>
      <button className="rm-here__jump" type="button" onClick={onJump}>
        <Icon name="target" size={16} />
        <span>{t('roadmap.here.jump')}</span>
      </button>
    </div>
  )
}

/* ── The card beside a pad ──────────────────────────────────────────────── */

const LevelCard = forwardRef<HTMLElement, { row: RoadmapLevel; status: ProgressionStatus; total: number }>(
  function LevelCard({ row, status, total }, ref) {
    const { t } = useI18n()
    const state = levelState(row.level, status)
    const items = rewardItems(row.reward)
    const milestone = isMilestone(row.level)
    const statusLine = state === 'reached'
      ? t('roadmap.card.reached')
      : state === 'current'
        ? (status.nextLevel
          ? t('roadmap.card.current', { current: String(status.currentLevelXp), required: String(status.xpToNext ?? 0) })
          : t('roadmap.card.currentMax'))
        : t('roadmap.card.locked', { xp: String(xpAway(row, status)) })
    return (
      <article className={`rm-card is-${state}${milestone ? ' is-milestone' : ''}`} ref={ref} key={row.level}>
        <header className="rm-card__head">
          <span className="rm-card__eyebrow">{t('roadmap.card.level')}</span>
          <h2>{t('roadmap.card.title', { level: String(row.level), total: String(total) })}</h2>
          <p className="rm-card__status">{statusLine}</p>
          {row.level > 1 ? <p className="rm-card__opens" dir="auto">{t('roadmap.card.opensAt', { xp: String(row.startXp) })}</p> : null}
        </header>
        {items.length ? (
          <>
            <h3 className="rm-card__label">{t('roadmap.card.unlocks')}</h3>
            <ul className="rm-card__items">
              {items.map((item) => <RewardRow key={item.id} item={item} state={state} />)}
            </ul>
          </>
        ) : (
          <p className="rm-card__start">{t('roadmap.card.start')}</p>
        )}
        {state === 'current' ? (
          <button className="rm-card__cta" type="button" onClick={() => navigate('/learning')}>
            <Icon name="spark" size={16} />
            <span>{t('roadmap.card.earn')}</span>
          </button>
        ) : state === 'reached' && items.length ? (
          <button className="rm-card__cta rm-card__cta--quiet" type="button" onClick={() => navigate('/yuvi-studio')}>
            <Icon name="palette" size={16} />
            <span>{t('roadmap.card.studio')}</span>
          </button>
        ) : null}
      </article>
    )
  })

function RewardRow({ item, state }: { item: RewardItem; state: LevelState }) {
  const { t } = useI18n()
  let picture: React.ReactNode
  let label: string
  if (item.kind === 'world' && item.world) {
    const strip = worldHologramStrip(item.world as RoomLayoutId)
    label = t('roadmap.item.world', { name: t(`YuviStudio.worlds.${item.world}.title`) })
    picture = strip ? (
      <span className="rm-holo" style={{
        backgroundImage: `url(${strip})`,
        aspectRatio: `${WORLD_HOLOGRAM_FRAME.width} / ${WORLD_HOLOGRAM_FRAME.height}`,
        '--rm-frames': WORLD_HOLOGRAM_FRAMES,
      } as React.CSSProperties} />
    ) : <Icon name="map" size={22} />
  } else if (item.kind === 'sparks') {
    label = t('roadmap.item.sparks', { amount: String(item.amount ?? 0) })
    picture = <Icon name="spark" size={22} />
  } else if (item.kind === 'hint') {
    label = t('roadmap.item.hint')
    picture = <Icon name="lightbulb" size={22} />
  } else if (item.kind === 'mood') {
    label = rewardLabel(t, item.id)
    picture = <Icon name="palette" size={22} />
  } else if (item.kind === 'sound') {
    label = rewardLabel(t, item.id)
    picture = <Icon name="sound" size={22} />
  } else {
    label = rewardLabel(t, item.id)
    const url = preRenderedThumb(item.kind === 'avatar' ? 'avatar' : 'room', item.id)
    picture = url ? <img src={url} alt="" loading="lazy" decoding="async" /> : <Icon name="image" size={22} />
  }
  return (
    <li className={`rm-item rm-item--${item.kind}`}>
      <span className="rm-item__picture">{picture}</span>
      <span className="rm-item__label">{label}</span>
      {state === 'locked' ? <Icon name="lock" size={14} /> : null}
    </li>
  )
}

/* ── No WebGL: the same ladder as a list ───────────────────────────────── */

function LevelList({ levels, status }: { levels: RoadmapLevel[]; status: ProgressionStatus }) {
  const { t } = useI18n()
  return (
    <div className="rm-list">
      <h1>{t('roadmap.title')}</h1>
      <p className="rm-list__note">{t('roadmap.noWebgl')}</p>
      <ol>
        {levels.map((row) => {
          const state = levelState(row.level, status)
          const items = rewardItems(row.reward)
          return (
            <li key={row.level} className={`rm-list__row is-${state}`}>
              <span className="rm-list__level">{row.level}</span>
              <div>
                <b>{state === 'current' ? t('roadmap.here.title') : state === 'reached' ? t('roadmap.card.reached') : t('roadmap.card.locked', { xp: String(xpAway(row, status)) })}</b>
                {items.length ? (
                  <ul className="rm-card__items">
                    {items.map((item) => <RewardRow key={item.id} item={item} state={state} />)}
                  </ul>
                ) : <p className="rm-card__start">{t('roadmap.card.start')}</p>}
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
