// @ts-nocheck
/* eslint-disable */
import { useEffect, useMemo, useRef, useState } from 'react'
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

// Picking a category glides the lab camera to the part being edited.
const FOCUS_BY_TAB: Record<Tab, string> = {
  headTop: 'head',
  face: 'face',
  body: 'body',
  handR: 'hand',
  back: 'back',
  colors: 'full',
}

type Filter = 'all' | 'owned' | 'new' | 'special'
const FILTERS: Filter[] = ['all', 'owned', 'new', 'special']

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
  const [filter, setFilter] = useState<Filter>('all')
  // Try-before-you-buy: a locked item can be worn on the stage without being
  // owned, so sparks are never spent on a guess.
  const [preview, setPreview] = useState<YuviAsset | null>(null)
  const {
    avatarRef, loaded, design, activeTab, setActiveTab, muted, setMuted, justSaved,
    saving, isLocked, equip, setVariant, setColor, reset, save,
    wallet, priceOf, buy, buying,
  } = studio

  const clearPreview = (worn: YuviAsset | null = preview) => {
    if (!worn) return
    avatarRef.current?.equip(worn.slot, design.equipped[worn.slot] ?? null, true)
    setPreview(null)
  }
  const goToTab = (tab: Tab) => {
    clearPreview()
    setActiveTab(tab)
    setFilter('all')
    avatarRef.current?.focus(FOCUS_BY_TAB[tab])
  }

  // Frame the current category as soon as the WebGL controller is alive.
  const framedRef = useRef(false)
  useEffect(() => {
    if (!loaded || framedRef.current) return
    framedRef.current = true
    const id = window.setTimeout(() => avatarRef.current?.focus(FOCUS_BY_TAB[activeTab]), 260)
    return () => window.clearTimeout(id)
  }, [loaded, activeTab, avatarRef])

  const slotAssets = activeTab === 'colors' ? [] : assetsForSlot(activeTab as YuviSlot)
  const visibleAssets = slotAssets.filter((asset) => {
    const locked = PREVIEW_ALL ? false : isLocked(asset)
    if (filter === 'owned') return !locked
    if (filter === 'new') return Boolean(asset.isNew)
    if (filter === 'special') return Boolean(asset.requirementKey)
    return true
  })

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
              onClick={() => goToTab(tab)}
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
              <div className="ys-cat">
                <h2>{t(`YuviStudio.category.${activeTab}`)}</h2>
                <span className="ys-cat__count">
                  {t('YuviStudio.itemCount').replace('{count}', String(slotAssets.length))}
                </span>
              </div>
              <div className="ys-filters" role="group" aria-label={t(`YuviStudio.category.${activeTab}`)}>
                {FILTERS.map((key) => (
                  <button
                    key={key}
                    type="button"
                    className={`ys-filter${filter === key ? ' is-active' : ''}`}
                    aria-pressed={filter === key}
                    onClick={() => setFilter(key)}
                  >
                    {t(`YuviStudio.filter.${key}`)}
                  </button>
                ))}
              </div>
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
                {filter === 'all' && (
                  <Card
                    equipped={design.equipped[activeTab as YuviSlot] === null && !preview}
                    onClick={() => { clearPreview(); equip(activeTab as YuviSlot, null) }}
                    label={t('YuviStudio.none')}
                    none
                  />
                )}
                {visibleAssets.map((asset) => {
                  const locked = PREVIEW_ALL ? false : isLocked(asset)
                  const price = locked ? priceOf(asset.id) : null
                  const previewing = preview?.id === asset.id
                  return (
                    <Card
                      key={asset.id}
                      equipped={!preview && design.equipped[asset.slot] === asset.id}
                      previewing={previewing}
                      locked={locked}
                      isNew={Boolean(asset.isNew)}
                      price={price}
                      thumb={thumbnails[asset.id]}
                      label={t(asset.labelKey)}
                      tip={locked && asset.requirementKey ? t(asset.requirementKey) : undefined}
                      onClick={() => {
                        if (!locked) {
                          clearPreview()
                          return equip(asset.slot, asset.id)
                        }
                        // Locked items are worn first and paid for after — the
                        // preview bar carries the buy action.
                        clearPreview()
                        avatarRef.current?.equip(asset.slot, asset.id, true)
                        avatarRef.current?.focus(FOCUS_BY_TAB[asset.slot as Tab])
                        setPreview(asset)
                      }}
                    />
                  )
                })}
                {visibleAssets.length === 0 && filter !== 'all' && (
                  <p className="ys-empty">{t('YuviStudio.filter.empty')}</p>
                )}
              </div>
            </>
          )}
        </div>

        {preview && (
          <div className="ys-preview">
            <span className="ys-preview__tag">{t('YuviStudio.preview.tag')}</span>
            <div className="ys-preview__info">
              <strong>{t(preview.labelKey)}</strong>
              {priceOf(preview.id) !== null ? (
                <span className="ys-preview__price">
                  <Icon name="spark" size={13} />
                  {priceOf(preview.id)}
                </span>
              ) : (
                <span className="ys-preview__earn">
                  {preview.requirementKey ? t(preview.requirementKey) : ''}
                </span>
              )}
            </div>
            <div className="ys-preview__actions">
              {priceOf(preview.id) !== null && (
                <button
                  type="button"
                  className="ys-btn ys-btn--primary ys-btn--sm"
                  onClick={() => { setPurchaseError(null); setPending(preview) }}
                >
                  {t('YuviStudio.preview.buy')}
                </button>
              )}
              <button type="button" className="ys-btn ys-btn--ghost ys-btn--sm" onClick={() => clearPreview()}>
                {t('YuviStudio.preview.cancel')}
              </button>
            </div>
          </div>
        )}
      </aside>

      <section className="ys-stage">
        <div className="ys-stage__backdrop" aria-hidden />
        <div className={`ys-stage__canvas${robotHidden ? ' is-flight-hidden' : ''}`}>
          {loaded && (
            <YuviAvatar3D ref={avatarRef} initialDesign={design} muted={muted} orbit stage label={t('YuviStudio.avatarAlt')} />
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
              setPreview(null)
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
  equipped, previewing, locked, isNew, price, thumb, label, tip, none, onClick,
}: {
  equipped?: boolean
  previewing?: boolean
  locked?: boolean
  isNew?: boolean
  price?: number | null
  thumb?: string
  label: string
  tip?: string
  none?: boolean
  onClick: () => void
}) {
  const buyable = Boolean(locked) && typeof price === 'number'
  const classes = [
    'ys-card',
    equipped ? 'is-equipped' : '',
    previewing ? 'is-previewing' : '',
    locked ? 'is-locked' : '',
    buyable ? 'is-buyable' : '',
  ].filter(Boolean).join(' ')
  return (
    <button
      type="button"
      className={classes}
      onClick={onClick}
      aria-pressed={equipped}
      disabled={Boolean(locked) && !buyable && !tip}
    >
      <span className="ys-card__thumb">
        {none ? <span className="ys-card__none" /> : thumb ? <img src={thumb} alt={label} /> : <span className="ys-card__none" />}
      </span>
      <span className="ys-card__label">{label}</span>
      {equipped && <span className="ys-card__check" aria-hidden><Icon name="check" size={12} /></span>}
      {isNew && !locked && !equipped && <span className="ys-card__new" aria-hidden />}
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
