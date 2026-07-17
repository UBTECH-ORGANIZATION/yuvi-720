import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import { Icon } from '../../components/primitives'
import { useI18n } from '../../i18n/I18nProvider'
import { YubiAvatar3D, type YubiAvatarHandle } from '../yubi-studio/YubiAvatar3D'
import type { YubiDesign } from '../yubi-studio/yubiDesign'
import type { LearningWorldModel } from './learningWorldModel'
import type { LearningWorldHandle, LearningWorldStats, YubiWorldProjection } from './learningWorldRenderer'

interface UnityInstance {
  SendMessage: (gameObject: string, method: string, parameter?: string | number) => void
  Quit: () => Promise<void>
}

interface UnityLoaderWindow extends Window {
  createUnityInstance?: (
    canvas: HTMLCanvasElement,
    config: UnityLoaderConfig,
    onProgress?: (progress: number) => void,
  ) => Promise<UnityInstance>
}

interface UnityLoaderConfig {
  arguments: string[]
  companyName: string
  productName: string
  productVersion: string
  dataUrl: string
  frameworkUrl: string
  codeUrl: string
  streamingAssetsUrl: string
  autoSyncPersistentDataPath: boolean
  matchWebGLToCanvasSize: boolean
  devicePixelRatio: number
  showBanner: (message: string, type: 'error' | 'warning' | string) => void
}

interface UnityBuildMetadata {
  buildId?: string
}

interface UnityBridgeEventDetail {
  type?: string
  payload?: string
}

interface LearningWorldUnityProps {
  world: LearningWorldModel
  design: YubiDesign
  lowPower: boolean
  reducedMotion: boolean
  simulate: string | null
  selectedLandmarkId: string | null
  ariaLabel: string
  onLandmarkSelect: (landmarkId: string) => void
  onYubiInteract: () => void
  onBlocked: () => void
  onReady: () => void
  onFatalError: () => void
  onStats: (stats: LearningWorldStats) => void
}

const BUILD_ROOT = '/unity-world/Build'
const BUILD_METADATA_URL = '/unity-world/build-version.json'
// Fixed overlay size — Yuvi no longer grows/shrinks with camera depth as he moves.
const AVATAR_SCALE = 0.62
let loaderPromise: Promise<void> | null = null
let loaderBuildId: string | null = null

function versionedBuildUrl(path: string, buildId: string) {
  return `${path}?v=${encodeURIComponent(buildId)}`
}

async function getUnityBuildId() {
  const response = await fetch(BUILD_METADATA_URL, { cache: 'no-store' })
  if (!response.ok) throw new Error('Unity build metadata failed')
  const lastModified = response.headers.get('last-modified')
  const metadata = await response.json() as UnityBuildMetadata
  return metadata.buildId ?? lastModified ?? 'legacy'
}

function loadUnityLoader(buildId: string) {
  const loaderUrl = versionedBuildUrl(`${BUILD_ROOT}/unity-world.loader.js`, buildId)
  if (loaderBuildId === buildId && (window as UnityLoaderWindow).createUnityInstance) return Promise.resolve()
  if (loaderBuildId === buildId && loaderPromise) return loaderPromise
  loaderBuildId = buildId
  loaderPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[data-yuvi-unity-loader="${loaderUrl}"]`)
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true })
      existing.addEventListener('error', () => reject(new Error('Unity loader failed')), { once: true })
      return
    }
    const script = document.createElement('script')
    script.src = loaderUrl
    script.async = true
    script.dataset.yuviUnityLoader = loaderUrl
    script.addEventListener('load', () => resolve(), { once: true })
    script.addEventListener('error', () => reject(new Error('Unity loader failed')), { once: true })
    document.head.append(script)
  }).catch((error) => {
    loaderPromise = null
    loaderBuildId = null
    throw error
  })
  return loaderPromise
}

function buildUnityConfig(
  world: LearningWorldModel,
  design: YubiDesign,
  lowPower: boolean,
  reducedMotion: boolean,
  simulate: string | null,
) {
  return JSON.stringify({
    subject: world.subject,
    selectedLandmarkId: world.recommendedLandmarkId ?? world.currentLandmarkId ?? '',
    currentLandmarkId: world.currentLandmarkId ?? '',
    recommendedLandmarkId: world.recommendedLandmarkId ?? '',
    reducedMotion,
    lowPower,
    externalAvatar: true,
    simulate: simulate ?? '',
    avatar: {
      variant: design.variant,
      body: design.colors.body,
      eyes: design.colors.eyes,
      smile: design.colors.smile,
      glow: design.colors.glow,
    },
    units: world.units.map((unit, order) => ({
      id: unit.id,
      order,
      completed: unit.components.length > 0
        && unit.components.every((component) => component.progress_state === 'completed'),
      reachable: unit.components.some((component) => component.progress_state !== 'locked'),
    })),
    landmarks: world.landmarks.map((landmark) => ({
      id: landmark.id,
      unitId: landmark.unit.id,
      state: landmark.component.progress_state,
      unitIndex: landmark.unitIndex,
      stageIndex: landmark.stageIndex,
      alternativeIndex: landmark.alternativeIndex,
      displayIndex: landmark.displayIndex,
      assessment: landmark.component.is_assessment,
    })),
  })
}

export const LearningWorldUnity = forwardRef<LearningWorldHandle, LearningWorldUnityProps>(function LearningWorldUnity({
  world,
  design,
  lowPower,
  reducedMotion,
  simulate,
  selectedLandmarkId,
  ariaLabel,
  onLandmarkSelect,
  onYubiInteract,
  onBlocked,
  onReady,
  onFatalError,
  onStats,
}, forwardedRef) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const instanceRef = useRef<UnityInstance | null>(null)
  const avatarRef = useRef<YubiAvatarHandle>(null)
  const travelCallbacksRef = useRef(new Map<string, () => void>())
  const readyRef = useRef(false)
  const [progress, setProgress] = useState(0)
  const [failed, setFailed] = useState(false)
  const { t } = useI18n()
  const [avatarProjection, setAvatarProjection] = useState<YubiWorldProjection | null>(null)
  // First person is the DEFAULT view; the mode is pushed to Unity as soon as the bridge reports ready.
  const [viewMode, setViewMode] = useState<'iso' | 'fps'>('fps')
  const viewModeRef = useRef<'iso' | 'fps'>('fps')
  const [helpOpen, setHelpOpen] = useState(false)
  const [flyIntent, setFlyIntent] = useState(false)
  const [headingAngle, setHeadingAngle] = useState(0)
  const prevProjRef = useRef<{ x: number; y: number } | null>(null)
  const serializedConfig = useMemo(
    () => buildUnityConfig(world, design, lowPower, reducedMotion, simulate),
    [design, lowPower, reducedMotion, simulate, world],
  )

  const send = useCallback((method: string, parameter = '') => {
    instanceRef.current?.SendMessage('LearningWorld', method, parameter)
  }, [])

  // Camera view toggle (isometric follow ↔ first person). Unity swaps the rig's mode; in first person the
  // avatar projection reports not-visible, so the three.js Yuvi overlay hides on its own — but we also gate
  // it on viewMode so there's no one-frame flash while the first projection arrives.
  const toggleViewMode = useCallback(() => {
    setViewMode((current) => {
      const next = current === 'iso' ? 'fps' : 'iso'
      viewModeRef.current = next
      instanceRef.current?.SendMessage('LearningWorld', 'SetViewMode', next)
      return next
    })
  }, [])

  useImperativeHandle(forwardedRef, () => ({
    focus: (landmarkId) => send('Focus', landmarkId),
    resetCamera: () => send('ResetCamera'),
    travelTo: (landmarkId, onComplete) => {
      travelCallbacksRef.current.set(landmarkId, onComplete)
      send('TravelTo', landmarkId)
    },
    showBlocked: (landmarkId) => send('ShowBlocked', landmarkId),
  }), [send])

  useEffect(() => {
    let cancelled = false
    const canvas = canvasRef.current
    if (!canvas) return

    const handleBridgeEvent = (event: Event) => {
      const detail = (event as CustomEvent<UnityBridgeEventDetail>).detail
      const type = detail?.type
      const payload = detail?.payload ?? ''
      if (type === 'ready') {
        readyRef.current = true
        // Apply the overlay's current view mode (first person by default) now that Unity listens.
        instanceRef.current?.SendMessage('LearningWorld', 'SetViewMode', viewModeRef.current)
        onReady()
      } else if (type === 'landmark-select' && payload) {
        onLandmarkSelect(payload)
      } else if (type === 'yubi-interact') {
        onYubiInteract()
      } else if (type === 'avatar-projection' && payload) {
        try {
          setAvatarProjection(JSON.parse(payload) as YubiWorldProjection)
        } catch {
          // A malformed visual projection must never affect world movement.
        }
      } else if (type === 'blocked' || type === 'bridge-blocked') {
        onBlocked()
      } else if (type === 'travel-complete') {
        const callback = travelCallbacksRef.current.get(payload)
        travelCallbacksRef.current.delete(payload)
        callback?.()
      } else if (type === 'stats' && payload) {
        try {
          onStats(JSON.parse(payload) as LearningWorldStats)
        } catch {
          // Invalid diagnostics never affect the learning experience.
        }
      } else if (type === 'error') {
        setFailed(true)
        onFatalError()
      }
    }

    window.addEventListener('yuvi-unity-world', handleBridgeEvent)
    void getUnityBuildId()
      .then(async (buildId) => {
        await loadUnityLoader(buildId)
        if (cancelled) return null
        const createUnityInstance = (window as UnityLoaderWindow).createUnityInstance
        if (!createUnityInstance) throw new Error('Unity runtime is unavailable')
        const config: UnityLoaderConfig = {
          arguments: [],
          companyName: 'Yuvilab',
          productName: 'Yuvilab Spark Learning World',
          productVersion: '1.0',
          dataUrl: versionedBuildUrl(`${BUILD_ROOT}/unity-world.data`, buildId),
          frameworkUrl: versionedBuildUrl(`${BUILD_ROOT}/unity-world.framework.js`, buildId),
          codeUrl: versionedBuildUrl(`${BUILD_ROOT}/unity-world.wasm`, buildId),
          streamingAssetsUrl: '/unity-world/StreamingAssets',
          autoSyncPersistentDataPath: true,
          matchWebGLToCanvasSize: true,
          devicePixelRatio: Math.min(window.devicePixelRatio || 1, lowPower ? 1 : 1.5),
          showBanner: (message, type) => {
            if (type === 'error') {
              console.error(message)
              setFailed(true)
              onFatalError()
            } else {
              console.warn(message)
            }
          },
        }
        return createUnityInstance(canvas, config, (nextProgress) => setProgress(nextProgress))
      })
      .then((instance) => {
        if (!instance) return
        if (cancelled) {
          void instance.Quit()
          return
        }
        instanceRef.current = instance
        instance.SendMessage('LearningWorld', 'Configure', serializedConfig)
      })
      .catch(() => {
        if (cancelled) return
        setFailed(true)
        onFatalError()
      })

    return () => {
      cancelled = true
      readyRef.current = false
      window.removeEventListener('yuvi-unity-world', handleBridgeEvent)
      travelCallbacksRef.current.clear()
      const instance = instanceRef.current
      instanceRef.current = null
      if (instance) void instance.Quit()
    }
  }, [onBlocked, onFatalError, onLandmarkSelect, onReady, onStats, onYubiInteract, serializedConfig])

  useEffect(() => {
    if (readyRef.current) send('SetSelected', selectedLandmarkId ?? '')
  }, [selectedLandmarkId, send])

  useEffect(() => {
    avatarRef.current?.applyDesign(design, false)
  }, [design])

  useEffect(() => {
    const handleVisibility = () => send('SetPaused', document.hidden ? '1' : '0')
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [send])

  // Fly vs. walk is inferred from the Space key (Unity owns the physics; this only picks the animation):
  // Space held → the vertical lift-off pose, otherwise ground movement is a walk.
  useEffect(() => {
    const setFly = (down: boolean) => (event: KeyboardEvent) => {
      if (event.code === 'Space' || event.key === ' ') setFlyIntent(down)
    }
    const onDown = setFly(true)
    const onUp = setFly(false)
    const onBlur = () => setFlyIntent(false)
    window.addEventListener('keydown', onDown)
    window.addEventListener('keyup', onUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onDown)
      window.removeEventListener('keyup', onUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  // Facing. Unity sends a screen-space yaw (`facing`) computed from world velocity through the camera — that
  // is authoritative once the camera follows Yuvi, since his screen position then barely moves. We fall back
  // to deriving it from on-screen movement for builds/cameras that don't send it. Frozen while flying so the
  // vertical lift doesn't spin him.
  useEffect(() => {
    const p = avatarProjection
    if (!p) return
    const prev = prevProjRef.current
    prevProjRef.current = { x: p.x, y: p.y }
    if (flyIntent) return
    if (p.hasFacing && typeof p.facing === 'number') { setHeadingAngle(p.facing / 1000); return }
    if (!prev) return
    const dx = p.x - prev.x
    const dy = p.y - prev.y
    if (dx * dx + dy * dy < 225) return
    setHeadingAngle(Math.atan2(dx, dy))
  }, [avatarProjection, flyIntent])

  const moving = Boolean(avatarProjection?.moving)
  const flying = flyIntent
  const walking = moving && !flyIntent
  const grounded = !moving && !flyIntent
  // Screen-space height above the ground (see YubiWorldProjection.altitude). Drives Yuvi's visual lift so
  // flying reads as rising into the air; the shadow stays at the ground point. 0 until the bridge sends it.
  const altitude = avatarProjection?.altitude ?? 0

  return (
    <div className={`learning-world-unity${failed ? ' has-failed' : ''}`} data-renderer="unity-webgl">
      <canvas
        id="yuvi-learning-world-canvas"
        ref={canvasRef}
        className="learning-world-unity__canvas"
        aria-label={ariaLabel}
        tabIndex={0}
      />
      <div className="learning-world-unity__view-controls">
        <button
          type="button"
          className="learning-world-unity__view-toggle"
          onClick={toggleViewMode}
          aria-pressed={viewMode === 'fps'}
          title={viewMode === 'fps' ? t('learning.world.view.switchToIso') : t('learning.world.view.switchToFps')}
        >
          <Icon name="camera" size={16} />
          <span>{viewMode === 'fps' ? t('learning.world.view.fps') : t('learning.world.view.iso')}</span>
        </button>
        <button
          type="button"
          className="learning-world-unity__view-help"
          onClick={() => setHelpOpen((open) => !open)}
          aria-expanded={helpOpen}
          aria-label={t('learning.world.help')}
          title={t('learning.world.help')}
        >
          <Icon name="help" size={16} />
        </button>
        {helpOpen && (
          <div className="learning-world-unity__help-panel" role="dialog" aria-label={t('learning.world.help.title')}>
            <div className="learning-world-unity__help-head">
              <strong>{t('learning.world.help.title')}</strong>
              <button type="button" onClick={() => setHelpOpen(false)} aria-label={t('learning.world.help.close')}>
                <Icon name="close" size={14} />
              </button>
            </div>
            <ul>
              <li>{t('learning.world.help.move')}</li>
              <li>{t('learning.world.help.fly')}</li>
              <li>{t('learning.world.help.look')}</li>
              <li>{t('learning.world.help.select')}</li>
            </ul>
          </div>
        )}
      </div>
      {viewMode === 'iso' && avatarProjection?.visible && (
        <div
          className={`learning-world-unity__three-avatar lw-player${flying ? ' is-flying' : ''}${walking ? ' is-walking' : ''}`}
          data-avatar-renderer="three-js"
          style={{
            left: `${avatarProjection.x / 100}%`,
            top: `${avatarProjection.y / 100}%`,
            '--unity-avatar-scale': String(AVATAR_SCALE),
          } as CSSProperties}
        >
          <span className="lw-player__shadow" aria-hidden="true" />
          <div
            className="lw-player__lift"
            style={{ transform: `translateY(-${(altitude / 100).toFixed(2)}vh)` } as CSSProperties}
          >
            <span className="lw-player__thrusters" aria-hidden="true"><i /><i /></span>
            <span className="lw-player__smoke" aria-hidden="true"><b /><b /><b /><b /><b /><b /></span>
            <div className="lw-player__avatar">
              <YubiAvatar3D
                ref={avatarRef}
                initialDesign={design}
                label={ariaLabel}
                muted
                onAvatarClick={onYubiInteract}
                grounded={grounded}
                flying={flying}
                walking={walking}
                headingAngle={headingAngle}
                performanceMode={lowPower ? 'low' : 'standard'}
              />
            </div>
          </div>
        </div>
      )}
      {!readyRef.current && !failed && (
        <div className="learning-world-unity__progress" role="status" aria-live="polite">
          <span style={{ '--unity-progress': `${Math.round(progress * 100)}%` } as CSSProperties} />
        </div>
      )}
    </div>
  )
})
