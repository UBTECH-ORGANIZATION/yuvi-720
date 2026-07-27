import type { Language } from '../../i18n/I18nProvider'

/**
 * Local label map for Kata's dotted MOE taxonomy keys.
 *
 * Kata unit/component payloads carry NO human topic names — only dotted keys
 * like ``MOE.SCI.G7.CHEM.BODY-MAT-PROP.MASS-VOL``. To show a real subject →
 * sub-subject hierarchy we resolve labels from a small per-segment map, keyed by
 * the individual dotted segments, with a readable fallback that humanizes the
 * last known segment. It grows as Kata adds topics — an unknown segment simply
 * falls back to its de-dashed form.
 */
type Trilingual = Record<Language, string>

const SEGMENT_LABELS: Record<string, Trilingual> = {
  // Domains (subjects)
  SCI: { he: 'מדע וטכנולוגיה', ar: 'العلوم والتكنولوجيا', en: 'Science & Technology' },
  MATH: { he: 'מתמטיקה', ar: 'الرياضيات', en: 'Mathematics' },
  // Science chapters
  CHEM: { he: 'כימיה', ar: 'الكيمياء', en: 'Chemistry' },
  PHYS: { he: 'פיזיקה', ar: 'الفيزياء', en: 'Physics' },
  BIO: { he: 'ביולוגיה', ar: 'الأحياء', en: 'Biology' },
  // Sub-topics seen in the current catalog
  'BODY-MAT-PROP': { he: 'תכונות החומר', ar: 'خصائص المادة', en: 'Properties of matter' },
  'MASS-VOL': { he: 'מסה ונפח', ar: 'الكتلة والحجم', en: 'Mass & volume' },
  'MASS-PRACTICE': { he: 'מדידת מסה', ar: 'قياس الكتلة', en: 'Measuring mass' },
}

/** Grade segments like ``G7`` → a readable grade label. */
const GRADE_HE = ['', 'א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ז׳', 'ח׳', 'ט׳', 'י׳', 'יא׳', 'יב׳']

function humanize(segment: string): string {
  return segment
    .split('-')
    .map((word) => (word ? word[0] + word.slice(1).toLowerCase() : word))
    .join(' ')
}

function labelForSegment(segment: string, language: Language): string | null {
  const known = SEGMENT_LABELS[segment.toUpperCase()]
  if (known) return known[language] || known.he
  const grade = /^G(\d{1,2})$/i.exec(segment)
  if (grade) {
    const n = Number(grade[1])
    return language === 'he' ? `כיתה ${GRADE_HE[n] ?? n}` : `Grade ${n}`
  }
  return null
}

/** Split a dotted key into meaningful segments (drops the leading ``MOE`` + grade). */
function segments(key: string): string[] {
  return key
    .split('.')
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => s.toUpperCase() !== 'MOE')
}

/**
 * Human label for a sub-topic dotted key — the deepest known segment (e.g.
 * ``…MASS-VOL`` → "מסה ונפח"), falling back to a humanized last segment.
 */
export function subTopicLabel(subTopic: string | null | undefined, language: Language): string {
  if (!subTopic) return ''
  const parts = segments(subTopic)
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const label = labelForSegment(parts[i], language)
    if (label) return label
  }
  return parts.length ? humanize(parts[parts.length - 1]) : ''
}
