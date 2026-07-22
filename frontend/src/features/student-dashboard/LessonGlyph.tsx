import type { LearningSubject } from '../../services/learning'

export type GlyphVariant = 'angle' | 'fraction' | 'graph' | 'orbit' | 'cell' | 'generic'

/** Pick a topic glyph from lesson text — the visual hints at the subject
 *  matter, it is not decoration. Keyword match stays intentionally small. */
export function pickGlyphVariant(title: string, subTopic: string, subject: LearningSubject): GlyphVariant {
  const text = `${title} ${subTopic}`.toLowerCase()
  if (/(זווי|angle|زاوية|زوايا)/.test(text)) return 'angle'
  if (/(שבר|fraction|كسر|كسور)/.test(text)) return 'fraction'
  if (/(משוו|גרף|ליניא|graph|equation|معادلة|رسم)/.test(text)) return 'graph'
  if (/(תא|dna|ביולוג|cell|خلية|أحياء)/.test(text)) return 'cell'
  if (/(אנרג|שמש|כוכב|orbit|solar|energy|طاقة|شمس|كوكب)/.test(text)) return 'orbit'
  if (subject === 'science') return 'orbit'
  return subject === 'math' ? 'graph' : 'generic'
}

interface LessonGlyphProps {
  variant: GlyphVariant
}

/** A "living" vector illustration. One-time entry motion + a short hover
 *  replay are driven from CSS (student-dashboard.css), gated by reduced-motion. */
export function LessonGlyph({ variant }: LessonGlyphProps) {
  return (
    <svg
      className={`sd-lesson-glyph sd-lesson-glyph--${variant}`}
      viewBox="0 0 160 120"
      role="presentation"
      aria-hidden="true"
      fill="none"
    >
      {variant === 'angle' && (
        <>
          <path className="sd-glyph-ray sd-glyph-ray--base" d="M34 86h94" />
          <path className="sd-glyph-ray sd-glyph-ray--sweep" d="M34 86 122 34" />
          <path className="sd-glyph-arc" d="M62 86a28 28 0 0 1 12-23" />
          <circle className="sd-glyph-dot" cx="34" cy="86" r="5" />
        </>
      )}
      {variant === 'fraction' && (
        <>
          <circle className="sd-glyph-ring" cx="80" cy="60" r="34" />
          <path className="sd-glyph-slice" d="M80 60 80 26A34 34 0 0 1 110 60Z" />
          <line className="sd-glyph-bar" x1="52" y1="60" x2="108" y2="60" />
        </>
      )}
      {variant === 'graph' && (
        <>
          <path className="sd-glyph-ray sd-glyph-ray--base" d="M34 92V30" />
          <path className="sd-glyph-ray sd-glyph-ray--base" d="M34 92h96" />
          <path className="sd-glyph-curve" d="M40 82 66 62 92 70 126 38" />
          <circle className="sd-glyph-dot" cx="126" cy="38" r="5" />
        </>
      )}
      {variant === 'orbit' && (
        <>
          <circle className="sd-glyph-core" cx="80" cy="60" r="13" />
          <ellipse className="sd-glyph-orbit" cx="80" cy="60" rx="52" ry="22" />
          <circle className="sd-glyph-planet" cx="132" cy="60" r="6" />
        </>
      )}
      {variant === 'cell' && (
        <>
          <ellipse className="sd-glyph-ring" cx="80" cy="60" rx="42" ry="30" />
          <path className="sd-glyph-helix" d="M60 40c20 12 20 28 40 40" />
          <path className="sd-glyph-helix sd-glyph-helix--alt" d="M100 40c-20 12-20 28-40 40" />
          <circle className="sd-glyph-core" cx="80" cy="60" r="8" />
        </>
      )}
      {variant === 'generic' && (
        <>
          <path className="sd-glyph-spark" d="M80 30v18m0 24v18m30-30H92M68 60H50" />
          <circle className="sd-glyph-core" cx="80" cy="60" r="12" />
          <circle className="sd-glyph-dot" cx="80" cy="60" r="4" />
        </>
      )}
    </svg>
  )
}
