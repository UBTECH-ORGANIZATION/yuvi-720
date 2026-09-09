export const SPORTS_ARTWORK_KINDS = {
  sportsArtworkBasketball: 'basketball', sportsArtworkSoccer: 'soccer',
  sportsArtworkRunners: 'runners', sportsArtworkOlympic: 'olympic',
  sportsArtworkPadel: 'padel', sportsArtworkTennis: 'tennis',
  sportsArtworkStrength: 'strength', sportsArtworkCycling: 'cycling',
} as const

export const SPORTS_LEGACY_ARTWORK_KINDS = {
  sportsArtworkBadminton: 'tennis', sportsArtworkTeamwork: 'cycling',
} as const

export const SPORTS_ARENA_STARTER_PROP_IDS = new Set([
  'sportsDumbbellRack', 'sportsSquatRack', 'sportsMiniGoal', 'sportsJerseyDisplay',
  'sportsBasketballHoop', 'sportsParkBench', 'sportsWallScoreboard',
  ...Object.keys(SPORTS_ARTWORK_KINDS), ...Object.keys(SPORTS_LEGACY_ARTWORK_KINDS),
])

export const SPORTS_NEW_ITEM_BOUNDS = {
  sportsBasketballHoop: { radius: 1.55, height: 4.18 },
  sportsParkBench: { radius: 1.65, height: 1.25 },
  sportsWallScoreboard: { radius: 3.05, height: 2.7 },
}

export const SPORTS_PAID_PROP_IDS = new Set([
  'sportsJerseyDisplayAlt', 'sportsPortableScoreboard', 'sportsSeatingBench',
  'sportsAdjustableBench', 'sportsRacketCorner', 'sportsLegPress', 'sportsCableMachine',
])

export function sportsPropLocked(kind: string, owned: ReadonlySet<string>): boolean | undefined {
  if (SPORTS_ARENA_STARTER_PROP_IDS.has(kind)) return !owned.has(kind) && !owned.has('layout:sportsArena')
  if (SPORTS_PAID_PROP_IDS.has(kind)) return !owned.has(kind)
  return undefined
}