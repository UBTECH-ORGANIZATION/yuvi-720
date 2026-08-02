import type { LearningSubject, LearningUnitDTO } from '../../services/learning'

export type GlyphVariant =
  | 'angle' | 'fraction' | 'graph' | 'orbit' | 'cell'
  | 'scale' | 'beaker' | 'particle' | 'generic'

/** Pick the illustration from what the lesson is ACTUALLY about.
 *
 *  This used to read the unit title plus a dotted sub-topic key, and when
 *  neither matched it fell back to one picture per subject — so "מדידה מעשית של
 *  מסה" (weighing solids, liquids and air on a balance) was drawn as a planet in
 *  orbit, because it is science and nothing else matched.
 *
 *  Kata gives us far more to go on: the ministry's sub-topic and topic titles and
 *  the goal's pedagogical description, which for that unit literally says
 *  "ימדדו מסת מוצקים במאזני כפות/זרוע". The picture is a reading of the content,
 *  so it should read the content. Order matters — the most specific object the
 *  learner will actually handle wins over the broad field it belongs to. */
export function pickGlyphVariant(
  title: string,
  subTopic: string,
  subject: LearningSubject,
  context: { subTopicTitle?: string; topicTitle?: string; description?: string } = {},
): GlyphVariant {
  const text = [
    title, subTopic, context.subTopicTitle, context.topicTitle, context.description,
  ].filter(Boolean).join(' ').toLowerCase()

  if (/(מאזני|לשקול|שקילה|מסה|משקל|balance|scale|mass|weigh|ميزان|كتلة)/.test(text)) return 'scale'
  if (/(נפח|נוזל|מנזורה|כלי קיבול|volume|liquid|beaker|حجم|سائل)/.test(text)) return 'beaker'
  if (/(חלקיק|אטום|מולקול|צבירה|particle|atom|molecul|جسيم|ذرة)/.test(text)) return 'particle'
  if (/(זווי|angle|زاوية|زوايا)/.test(text)) return 'angle'
  if (/(שבר|fraction|كسر|كسور)/.test(text)) return 'fraction'
  if (/(משוו|גרף|ליניא|graph|equation|معادلة|رسم)/.test(text)) return 'graph'
  if (/(תא|dna|ביולוג|cell|خلية|أحياء)/.test(text)) return 'cell'
  if (/(אנרג|שמש|כוכב|orbit|solar|energy|طاقة|شمس|كوكب)/.test(text)) return 'orbit'
  if (subject === 'science') return 'particle'
  return subject === 'math' ? 'graph' : 'generic'
}

/** Convenience over a whole unit — every signal the catalog carries. */
export function glyphForUnit(unit: LearningUnitDTO): GlyphVariant {
  return pickGlyphVariant(unit.title, unit.sub_topic, unit.subject, {
    subTopicTitle: unit.sub_topic_title,
    topicTitle: unit.topic_title,
    description: unit.goal_description,
  })
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
      {/* A balance with pans — the instrument the learner literally picks up in
          "מדידה מעשית של מסה": מאזני כפות/זרוע. The beam tips gently, because a
          balance settling IS the lesson. */}
      {variant === 'scale' && (
        <>
          {/* Column and foot — the part that does not move. */}
          <path className="sd-glyph-ray sd-glyph-ray--base" d="M80 96V42" />
          <path className="sd-glyph-ray sd-glyph-ray--base" d="M60 100h40" />
          <g className="sd-glyph-beam">
            {/* The beam, caught mid-tip: a balance at rest is the goal, not the
                starting state. Its midpoint is the pivot, so the arm turns
                around the post rather than drifting off it. */}
            <path className="sd-glyph-arc" d="M33 46 127 34" />
            {/* Strings to the rim, then a shallow pan hanging under each end.
                The pans used to be downward triangles, which read as arrowheads
                pointing at nothing rather than as something you load. */}
            <path className="sd-glyph-helix" d="M33 46 17 57M33 46 49 57M127 34 111 45M127 34 143 45" />
            <path className="sd-glyph-arc" d="M17 57q16 17 32 0" />
            <path className="sd-glyph-arc" d="M111 45q16 17 32 0" />
          </g>
          <circle className="sd-glyph-core" cx="80" cy="40" r="6" />
        </>
      )}
      {/* A measuring vessel with a liquid line — volume, the twin of mass in
          this sub-topic ("מסה ונפח של גופים"). */}
      {variant === 'beaker' && (
        <>
          <path className="sd-glyph-arc" d="M62 30h36v18l18 40a8 8 0 0 1-8 11H52a8 8 0 0 1-8-11l18-40z" />
          <path className="sd-glyph-liquid" d="M52 74h56l8 18a6 6 0 0 1-6 8H50a6 6 0 0 1-6-8z" />
          <path className="sd-glyph-ray" d="M104 56h10M104 66h10" />
        </>
      )}
      {/* Particles in a lattice — states of matter and the particle model. */}
      {variant === 'particle' && (
        <>
          <circle className="sd-glyph-ring" cx="80" cy="60" r="34" />
          <circle className="sd-glyph-dot" cx="66" cy="48" r="6" />
          <circle className="sd-glyph-dot" cx="94" cy="50" r="6" />
          <circle className="sd-glyph-dot" cx="62" cy="74" r="6" />
          <circle className="sd-glyph-dot" cx="92" cy="76" r="6" />
          <circle className="sd-glyph-core" cx="80" cy="62" r="7" />
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
