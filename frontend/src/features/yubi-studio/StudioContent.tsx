// @ts-nocheck
/* eslint-disable */
import { useMemo } from 'react'
import { useI18n } from '../../i18n/I18nProvider'
import { LearnerAppBar } from '../../components/LearnerAppBar'
import { YubiAvatar3D } from './YubiAvatar3D'
import { assetsForSlot, getThumbnails, type YubiAsset } from './yubiAssets'
import type { YubiColors, YubiSlot, YubiVariant } from './yubiDesign'
import type { StudioDesign } from './useStudioDesign'
import '../../styles/yubi-studio.css'

type Tab = YubiSlot | 'colors'
const TABS: Tab[] = ['headTop', 'face', 'body', 'handR', 'back', 'colors']

// TEMP: show every asset unlocked so new items can be previewed on Yuvi.
const PREVIEW_ALL = true

const COLOR_OPTIONS: Record<keyof YubiColors, string[]> = {
  body: ['#85878C', '#9cc1e8', '#ff9ec4', '#b5f2c9', '#ffd27a', '#c9b6ff', '#8ee6f2', '#ff8f8f', '#9ad0ff'],
  eyes: ['#4eeef0', '#7c5cff', '#ff5d73', '#ffd166', '#5ce67e', '#ff8fd0'],
  smile: ['#74f7ff', '#7c5cff', '#ff5d73', '#3fd9e0', '#ffd166', '#ff8fd0'],
  glow: ['#3fd9e0', '#7c5cff', '#ff5d73', '#ffd166', '#aef7ff'],
}

/**
 * Presentational studio UI. `robotHidden` keeps the stage robot mounted (and
 * warming up) but invisible while the flight overlay animates onto its spot.
 */
export function StudioContent({
  studio,
  onClose,
  robotHidden = false,
}: {
  studio: StudioDesign
  onClose: () => void
  robotHidden?: boolean
}) {
  const { t } = useI18n()
  const thumbnails = useMemo(() => getThumbnails(), [])
  const {
    avatarRef, loaded, design, activeTab, setActiveTab, muted, setMuted, justSaved,
    saving, isLocked, equip, setVariant, setColor, reset, save,
  } = studio

  return (
    <div className="yubi-studio">
      <LearnerAppBar />
      <div className="ys-body">
        <aside className="ys-drawer">
        <div className="ys-drawer__head">
          <h1>{t('yubiStudio.title')}</h1>
          <p>{t('yubiStudio.subtitle')}</p>
        </div>

        <div className="ys-tabs" role="tablist" aria-label={t('yubiStudio.title')}>
          {TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={activeTab === tab}
              className={`ys-tab${activeTab === tab ? ' is-active' : ''}`}
              onClick={() => setActiveTab(tab)}
            >
              {t(`yubiStudio.tab.${tab}`)}
            </button>
          ))}
        </div>

        <div className="ys-panels">
          {activeTab === 'colors' ? (
            <ColorsPanel design={design} onPick={setColor} t={t} />
          ) : (
            <>
              {activeTab === 'headTop' && (
                <div className="ys-variant-row">
                  {(['classic', 'girl'] as YubiVariant[]).map((v) => (
                    <button
                      key={v}
                      type="button"
                      className={`ys-variant${design.variant === v ? ' is-active' : ''}`}
                      onClick={() => setVariant(v)}
                    >
                      {t(`yubiStudio.variant.${v}`)}
                    </button>
                  ))}
                </div>
              )}
              <div className="ys-grid">
                <Card
                  equipped={design.equipped[activeTab as YubiSlot] === null}
                  onClick={() => equip(activeTab as YubiSlot, null)}
                  label={t('yubiStudio.none')}
                  none
                />
                {assetsForSlot(activeTab as YubiSlot).map((asset) => {
                  const locked = PREVIEW_ALL ? false : isLocked(asset)
                  return (
                    <Card
                      key={asset.id}
                      equipped={design.equipped[asset.slot] === asset.id}
                      locked={locked}
                      thumb={thumbnails[asset.id]}
                      label={t(asset.labelKey)}
                      tip={locked && asset.requirementKey ? t(asset.requirementKey) : undefined}
                      onClick={() => { if (!locked) equip(asset.slot, asset.id) }}
                    />
                  )
                })}
              </div>
            </>
          )}
        </div>
      </aside>

      <section className="ys-stage">
        <div className={`ys-stage__canvas${robotHidden ? ' is-flight-hidden' : ''}`}>
          {loaded && (
            <YubiAvatar3D ref={avatarRef} initialDesign={design} muted={muted} orbit label={t('yubiStudio.avatarAlt')} />
          )}
        </div>
        <div className="ys-hint">{justSaved ? t('yubiStudio.saved') : t('yubiStudio.hint')}</div>
        <div className="ys-toolbar">
          <button type="button" className="ys-btn ys-btn--primary" onClick={save} disabled={saving}>{t('yubiStudio.save')}</button>
          <button type="button" className="ys-btn ys-btn--ghost" onClick={reset} disabled={saving}>{t('yubiStudio.reset')}</button>
          <button type="button" className="ys-btn ys-btn--mute" onClick={() => setMuted((m) => !m)}>
            {muted ? t('yubiStudio.sound.off') : t('yubiStudio.sound.on')}
          </button>
          <button type="button" className="ys-btn ys-btn--ghost" onClick={onClose} disabled={saving}>{t('yubiStudio.back')}</button>
        </div>
      </section>
      </div>
    </div>
  )
}

function Card({
  equipped, locked, thumb, label, tip, none, onClick,
}: {
  equipped?: boolean
  locked?: boolean
  thumb?: string
  label: string
  tip?: string
  none?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={`ys-card${equipped ? ' is-equipped' : ''}${locked ? ' is-locked' : ''}`}
      onClick={onClick}
      aria-pressed={equipped}
      disabled={locked}
    >
      <span className="ys-card__thumb">
        {none ? <span className="ys-card__none" /> : thumb ? <img src={thumb} alt={label} /> : <span className="ys-card__none" />}
      </span>
      <span className="ys-card__label">{label}</span>
      {locked && <span className="ys-card__lock" aria-hidden>🔒</span>}
      {locked && tip && <span className="ys-card__tip" role="tooltip">{tip}</span>}
    </button>
  )
}

function ColorsPanel({
  design, onPick, t,
}: {
  design: import('./yubiDesign').YubiDesign
  onPick: (key: keyof YubiColors, hex: string) => void
  t: (key: string) => string
}) {
  return (
    <>
      {(Object.keys(COLOR_OPTIONS) as (keyof YubiColors)[]).map((key) => (
        <div key={key} className="ys-swatch-group">
          <h3>{t(`yubiStudio.color.${key}`)}</h3>
          <div className="ys-swatches">
            {COLOR_OPTIONS[key].map((hex) => (
              <button
                key={hex}
                type="button"
                aria-label={hex}
                className={`ys-swatch${design.colors[key].toLowerCase() === hex.toLowerCase() ? ' is-active' : ''}`}
                style={{ background: hex }}
                onClick={() => onPick(key, hex)}
              />
            ))}
          </div>
        </div>
      ))}
    </>
  )
}
