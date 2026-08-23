/* The feelings vocabulary (#452) — a mirror of the server's canonical table
 * (`checkin_flow.VALENCE_FEELINGS`). Ids only; every word the learner sees
 * comes from the locale files. Never a number, never a scale. */

export type Valence = 'great' | 'good' | 'okay' | 'uneasy' | 'upset'

export const VALENCES: Valence[] = ['great', 'good', 'okay', 'uneasy', 'upset']

export const VALENCE_FEELINGS: Record<Valence, string[]> = {
  great: ['proud', 'excited', 'valued', 'joyful', 'confident'],
  good: ['calm', 'curious', 'hopeful', 'satisfied', 'grateful'],
  okay: ['fine', 'tired', 'bored', 'indifferent', 'distracted'],
  uneasy: ['worried', 'anxious', 'confused', 'overwhelmed', 'embarrassed'],
  upset: ['frustrated', 'angry', 'sad', 'lonely', 'discouraged'],
}
