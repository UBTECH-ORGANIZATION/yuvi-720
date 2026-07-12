// Yubi avatar design model — mirrors the persisted `learner_state.avatar` shape.
// The design is non-identifying UI state: colours, a variant, and equipped items.

export type YubiVariant = 'classic' | 'girl'
export type YubiSlot = 'headTop' | 'face' | 'back' | 'handR' | 'body'

export interface YubiColors {
  /** Shell / helmet colour (recolourable — never a skin tone). */
  body: string
  eyes: string
  smile: string
  /** Antenna tip, chest ring and ear caps. */
  glow: string
}

export interface YubiDesign {
  version: number
  variant: YubiVariant
  colors: YubiColors
  equipped: Record<YubiSlot, string | null>
}

export const YUBI_SLOTS: YubiSlot[] = ['headTop', 'face', 'back', 'handR', 'body']

export const DEFAULT_DESIGN: YubiDesign = {
  version: 1,
  variant: 'classic',
  colors: { body: '#85878C', eyes: '#4eeef0', smile: '#74f7ff', glow: '#3fd9e0' },
  equipped: { headTop: null, face: null, back: null, handR: null, body: null },
}

const LEGACY_DEFAULT_BODY_COLOR = '#717378'

export function cloneDesign(design: YubiDesign): YubiDesign {
  return {
    version: design.version,
    variant: design.variant,
    colors: { ...design.colors },
    equipped: { ...design.equipped },
  }
}

/** Coerce whatever came back from the API into a safe, complete design. */
export function normalizeDesign(raw: unknown): YubiDesign {
  const base = cloneDesign(DEFAULT_DESIGN)
  if (!raw || typeof raw !== 'object') return base
  const record = raw as Record<string, unknown>

  if (record.variant === 'classic' || record.variant === 'girl') {
    base.variant = record.variant
  }
  if (record.colors && typeof record.colors === 'object') {
    const colors = record.colors as Record<string, unknown>
    for (const key of ['body', 'eyes', 'smile', 'glow'] as const) {
      if (typeof colors[key] !== 'string') continue
      const color = colors[key] as string
      base.colors[key] = key === 'body' && color.toUpperCase() === LEGACY_DEFAULT_BODY_COLOR
        ? DEFAULT_DESIGN.colors.body
        : color
    }
  }
  if (record.equipped && typeof record.equipped === 'object') {
    const equipped = record.equipped as Record<string, unknown>
    for (const slot of YUBI_SLOTS) {
      base.equipped[slot] = typeof equipped[slot] === 'string' ? (equipped[slot] as string) : null
    }
  }
  return base
}
