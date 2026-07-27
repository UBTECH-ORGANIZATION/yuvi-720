// @ts-nocheck
/* eslint-disable */
import { useMemo, useState } from 'react'
import { useI18n } from '../../i18n/I18nProvider'
import { LearnerAppBar } from '../../components/LearnerAppBar'
import { Icon } from '../../components/primitives'
import { YuviAvatar3D } from './YuviAvatar3D'
import { assetsForSlot, getThumbnails, type YuviAsset } from './YuviAssets'
import type { YuviColors, YuviSlot, YuviVariant } from './YuviDesign'
import type { StudioDesign } from './useStudioDesign'
import '../../styles/Yuvi-studio.css'

type Tab = YuviSlot | 'colors'
const TABS: Tab[] = ['headTop', 'face', 'body', 'handR', 'back', 'colors']

// Locked items are real again: they are bought with sparks or earned at a
// milestone, which is the whole point of the reward loop.
const PREVIEW_ALL = false

const COLOR_OPTIONS: Record<keyof YuviColors, string[]> = {
  body: ['#F1F2FB', '#9cc1e8', '#ff9ec4', '#b5f2c9', '#ffd27a', '#c9b6ff', '#8ee6f2', '#ff8f8f', '#9ad0ff'],
  eyes: ['#4eeef0', '#7c5cff', '#ff5d73', '#ffd166', '#5ce67e', '#ff8fd0'],
  smile: ['#74f7ff', '#7c5cff', '#ff5d73', '#3fd9e0', '#ffd166', '#ff8fd0'],
  glow: ['#7C6BFF', '#3fd9e0', '#ff5d73', '#ffd166', '#aef7ff'],
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
  const [pending, setPending] = useState<YuviAsset | null>(null)
  const [purchaseError, setPurchaseError] = useState<string | null>(null)
  const {
    avatarRef, loaded, design, activeTab, setActiveTab, muted, setMuted, justSaved,
    saving, isLocked, equip, setVariant, setColor, reset, save,
    wallet, priceOf, buy, buying,
  } = studio

  return (
    <div className="Yuvi-studio">
      <LearnerAppBar />
      <div className="ys-body">
        <aside className="ys-drawer">
        <div className="ys-drawer__head">
          <h1>{t('YuviStudio.title')}</h1>
          <p>{t('YuviStudio.subtitle')}</p>
          {wallet && (
            <p className="ys-wallet">
              <Icon name="spark" size={15} />
              <strong>{wallet.balance}</strong>
              <span>{t('rewards.currency')}</span>
            </p>
          )}
        </div>

        <div className="ys-tabs" role="tablist" aria-label={t('YuviStudio.title')}>
          {TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={activeTab === tab}
              className={`ys-tab${activeTab === tab ? ' is-active' : ''}`}
              onClick={() => setActiveTab(tab)}
            >
              {t(`YuviStudio.tab.${tab}`)}
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
                  {(['classic', 'girl'] as YuviVariant[]).map((v) => (
                    <button
                      key={v}
                      type="button"
                      className={`ys-variant${design.variant === v ? ' is-active' : ''}`}
                      onClick={() => setVariant(v)}
                    >
                      {t(`YuviStudio.variant.${v}`)}
                    </button>
                  ))}
                </div>
              )}
              <div className="ys-grid">
                <Card
                  equipped={design.equipped[activeTab as YuviSlot] === null}
                  onClick={() => equip(activeTab as YuviSlot, null)}
                  label={t('YuviStudio.none')}
                  none
                />
                {assetsForSlot(activeTab as YuviSlot).map((asset) => {
                  const locked = PREVIEW_ALL ? false : isLocked(asset)
                  const price = locked ? priceOf(asset.id) : null
                  return (
                    <Card
                      key={asset.id}
                      equipped={design.equipped[asset.slot] === asset.id}
                      locked={locked}
                      price={price}
                      thumb={thumbnails[asset.id]}
                      label={t(asset.labelKey)}
                      tip={locked && asset.requirementKey ? t(asset.requirementKey) : undefined}
                      onClick={() => {
                        if (!locked) return equip(asset.slot, asset.id)
                        // Buyable items open the shop prompt; milestone-only
                        // items keep explaining how they are earned.
                        if (price !== null) {
                          setPurchaseError(null)
                          setPending(asset)
                        }
                      }}
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
            <YuviAvatar3D ref={avatarRef} initialDesign={design} muted={muted} orbit label={t('YuviStudio.avatarAlt')} />
          )}
        </div>
        <div className="ys-hint">{justSaved ? t('YuviStudio.saved') : t('YuviStudio.hint')}</div>
        <div className="ys-toolbar">
          <button type="button" className="ys-btn ys-btn--primary" onClick={save} disabled={saving}>{t('YuviStudio.save')}</button>
          <button type="button" className="ys-btn ys-btn--ghost" onClick={reset} disabled={saving}>{t('YuviStudio.reset')}</button>
          <button type="button" className="ys-btn ys-btn--mute" onClick={() => setMuted((m) => !m)}>
            {muted ? t('YuviStudio.sound.off') : t('YuviStudio.sound.on')}
          </button>
          <button type="button" className="ys-btn ys-btn--ghost" onClick={onClose} disabled={saving}>{t('YuviStudio.back')}</button>
        </div>
      </section>
      </div>
      {pending && (
        <PurchaseDialog
          asset={pending}
          price={priceOf(pending.id) ?? 0}
          balance={wallet?.balance ?? 0}
          busy={buying === pending.id}
          error={purchaseError}
          thumb={thumbnails[pending.id]}
          t={t}
          onCancel={() => { setPending(null); setPurchaseError(null) }}
          onConfirm={async () => {
            const result = await buy(pending.id)
            if (result?.ok) {
              equip(pending.slot, pending.id)
              setPending(null)
              return
            }
            setPurchaseError(result?.reason ?? 'unlock_failed')
          }}
        />
      )}
    </div>
  )
}

/* Buying is deliberately a two-step, confirmed action: sparks are scarce and a
   mis-tap should never spend a week of effort. */
function PurchaseDialog({
  asset, price, balance, busy, error, thumb, t, onCancel, onConfirm,
}: {
  asset: YuviAsset
  price: number
  balance: number
  busy: boolean
  error: string | null
  thumb?: string
  t: (key: string) => string
  onCancel: () => void
  onConfirm: () => void
}) {
  const missing = Math.max(0, price - balance)
  const affordable = missing === 0
  return (
    <div className="ys-shop-backdrop" role="presentation" onClick={onCancel}>
      <div
        className="ys-shop"
        role="dialog"
        aria-modal="true"
        aria-label={t('rewards.shop.title')}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="ys-shop__item">
          {thumb && <img src={thumb} alt="" />}
          <div>
            <h2>{t(asset.labelKey)}</h2>
            <p className="ys-shop__price">
              <Icon name="spark" size={14} />
              <strong>{price}</strong>
              <span>{t('rewards.currency')}</span>
            </p>
          </div>
        </div>
        <p className="ys-shop__balance">
          {t('rewards.shop.balance').replace('{count}', String(balance))}
        </p>
        {!affordable && (
          <p className="ys-shop__hint">
            {t('rewards.shop.missing').replace('{count}', String(missing))}
          </p>
        )}
        {error && error !== 'insufficient' && (
          <p className="ys-shop__hint">{t(`rewards.shop.error.${error}`)}</p>
        )}
        <div className="ys-shop__actions">
          <button
            type="button"
            className="ys-btn ys-btn--primary"
            disabled={!affordable || busy}
            onClick={onConfirm}
          >
            {t('rewards.shop.confirm')}
          </button>
          <button type="button" className="ys-btn ys-btn--ghost" onClick={onCancel} disabled={busy}>
            {t('rewards.shop.cancel')}
          </button>
        </div>
        <p className="ys-shop__earn">{t('rewards.shop.howToEarn')}</p>
      </div>
    </div>
  )
}

function Card({
  equipped, locked, price, thumb, label, tip, none, onClick,
}: {
  equipped?: boolean
  locked?: boolean
  price?: number | null
  thumb?: string
  label: string
  tip?: string
  none?: boolean
  onClick: () => void
}) {
  const buyable = Boolean(locked) && typeof price === 'number'
  return (
    <button
      type="button"
      className={`ys-card${equipped ? ' is-equipped' : ''}${locked ? ' is-locked' : ''}${buyable ? ' is-buyable' : ''}`}
      onClick={onClick}
      aria-pressed={equipped}
      disabled={Boolean(locked) && !buyable}
    >
      <span className="ys-card__thumb">
        {none ? <span className="ys-card__none" /> : thumb ? <img src={thumb} alt={label} /> : <span className="ys-card__none" />}
      </span>
      <span className="ys-card__label">{label}</span>
      {buyable && (
        <span className="ys-card__price">
          <Icon name="spark" size={13} />
          {price}
        </span>
      )}
      {locked && !buyable && <span className="ys-card__lock" aria-hidden><Icon name="lock" size={13} /></span>}
      {locked && !buyable && tip && <span className="ys-card__tip" role="tooltip">{tip}</span>}
    </button>
  )
}

function ColorsPanel({
  design, onPick, t,
}: {
  design: import('./YuviDesign').YuviDesign
  onPick: (key: keyof YuviColors, hex: string) => void
  t: (key: string) => string
}) {
  return (
    <>
      {(Object.keys(COLOR_OPTIONS) as (keyof YuviColors)[]).map((key) => (
        <div key={key} className="ys-swatch-group">
          <h3>{t(`YuviStudio.color.${key}`)}</h3>
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
