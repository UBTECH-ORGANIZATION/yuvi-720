/* Which Yuvi-studio item each mapping section unlocks.

   This lives apart from `YuviAssets` because that module builds real Three.js
   geometry for every catalog entry — and the mapping page only ever needs the
   reward's id and its name. Importing it there would put the whole renderer on
   the questionnaire's critical path. The ids and label keys mirror the catalog;
   `tests/yuvi-rewards.test.ts` guards them against drift. */

// Completing a mapping section (0-based part index) unlocks an item.
// Keys align with the requirement copy (part index 3 == "section 4").
export const PHASE_REWARDS: Record<number, string> = {
  3: 'crown',
  4: 'jetpack',
  5: 'ironman',
}

export function rewardLabelKey(assetId: string): string {
  return `YuviStudio.item.${assetId}`
}
