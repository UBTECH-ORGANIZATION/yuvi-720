/* The presentation component: one slide at a time, on a real stage.
 *
 * ## The stage
 *
 * A slide is a fixed 1280×720 box scaled to fit whatever holds it, not a card
 * that grows with its content. That is what makes it designable at all — the
 * teacher's preview, the child's screen and the projector show the same thing —
 * and it is what makes present mode and printing possible. `useFitToStage`
 * carries both halves: the stage scales to the page, the type scales to the
 * stage.
 *
 * ## Twelve layouts, and no generated markup
 *
 * `features/tasks` renders model output as React and never as HTML. So a
 * "richer slide" can never mean handing a model the markup — every layout here
 * is a component, and what the model chooses is which one, from a vocabulary
 * the backend validates. The reference implementation ships twenty-one layouts
 * as model-authored HTML documents in an iframe; the long tail there renders
 * badly and nobody finds out until a child is looking at it.
 *
 * ## The diagram
 *
 * Every layout that can hold a visual holds one, through `SceneRenderer` — the
 * same component the coach uses. It used to be `VisualSlot`, which read four
 * field names (`kind`, `url`, `video_url`, `image_url`) that the payload does
 * not have, and was called from one branch of the switch. So no deck has ever
 * shown a diagram, and nothing failed loudly enough to say so.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../../components/primitives'
import { useI18n } from '../../i18n/I18nProvider'
import { SceneRenderer } from '../visuals/SceneRenderer'
import { MathText } from './MathText'
import { STAGE_H, STAGE_W, useFitToStage } from './useFitToStage'
import type { Slide } from '../../services/tasks'

interface Props {
  slides: Slide[]
  /** Called once the last slide has been seen — the deck's completion signal. */
  onFinished?: () => void
  /** The subject the task was built for. Chooses the ground, and comes from the
   *  task spec — never from the model, which would make two decks on the same
   *  subject look unrelated. */
  subject?: string
  /** The teacher's override, for the lesson that sits in one subject and looks
   *  like another — a graph-paper ground on a physics deck full of equations.
   *  `auto` (the default) means "whatever the subject says". */
  theme?: string
  /** The teacher's copy: speaker notes under the stage, and a present button.
   *  Absent for a learner, so `notes` cannot render even if one arrives. */
  teacher?: boolean
  /** Rendered beside the deck nav — the review screen's per-slide controls. */
  slideActions?: (index: number, slide: Slide) => React.ReactNode
}

const GROUNDS = ['math', 'science', 'history', 'nature', 'language'] as const

/** The subject strings the catalogue actually produces, mapped to the five
 *  grounds we draw. Anything unrecognised keeps the default violet — a wrong
 *  ground is worse than no ground. */
function groundFor(subject?: string): string {
  const value = (subject ?? '').toLowerCase()
  if (!value) return 'default'
  if (/math|מתמט|رياض|geometry|algebra/.test(value)) return 'math'
  if (/science|physic|chem|biolog|מדע|פיזיק|כימ|ביולוג|علوم|فيزياء/.test(value)) return 'science'
  if (/history|civic|היסטור|אזרח|تاريخ/.test(value)) return 'history'
  if (/nature|geo|environment|טבע|גאוגר|סביבה|طبيعة|جغراف/.test(value)) return 'nature'
  if (/language|hebrew|arabic|english|literature|לשון|עברית|ספרות|אנגלית|لغة|عربية/.test(value)) {
    return 'language'
  }
  return GROUNDS.includes(value as typeof GROUNDS[number]) ? value : 'default'
}

export function SlideDeck({ slides, onFinished, subject, theme, teacher, slideActions }: Props) {
  const { t, language } = useI18n()
  const [at, setAt] = useState(0)
  const [presenting, setPresenting] = useState(false)
  const slide = slides[Math.min(at, slides.length - 1)]
  const deckRef = useRef<HTMLElement | null>(null)
  const fit = useFitToStage(slide?.id)
  const ground = useMemo(
    () => (theme && theme !== 'auto' ? theme : groundFor(subject)), [theme, subject])

  useEffect(() => {
    if (at >= slides.length - 1) onFinished?.()
  }, [at, slides.length, onFinished])

  const go = (delta: number) =>
    setAt((position) => Math.min(slides.length - 1, Math.max(0, position + delta)))

  /* Present mode. The arrows are reversed in a right-to-left page because the
     NEXT slide is to the left — a presenter reaches for the key on the side the
     deck moves towards, and getting this wrong makes the whole thing feel
     backwards. */
  useEffect(() => {
    if (!presenting) return
    const rtl = language === 'he' || language === 'ar'
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight') go(rtl ? -1 : 1)
      else if (event.key === 'ArrowLeft') go(rtl ? 1 : -1)
      else if (event.key === ' ' || event.key === 'PageDown') go(1)
      else if (event.key === 'PageUp') go(-1)
      else return
      event.preventDefault()
    }
    const onFullscreenChange = () => {
      if (!document.fullscreenElement) setPresenting(false)
    }
    window.addEventListener('keydown', onKey)
    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('fullscreenchange', onFullscreenChange)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presenting, language, slides.length])

  const present = async () => {
    try {
      await deckRef.current?.requestFullscreen?.()
      setPresenting(true)
    } catch {
      // Fullscreen refused (an iframe without the permission, an old Safari).
      // Presenting still works — it is just a large deck in the page.
      setPresenting(true)
    }
  }

  if (!slide) return null

  return (
    <section
      className={`yv-deck${presenting ? ' is-presenting' : ''}`}
      ref={deckRef}
      aria-roledescription="carousel"
      data-ground={ground}
    >
      {/* A visible way out of fullscreen. ESC works, but a projector-side
          teacher should not need to know a keyboard shortcut (#486). */}
      {presenting ? (
        <button
          type="button"
          className="yv-deck__exit"
          aria-label={t('tasks.deck.exit')}
          title={t('tasks.deck.exit')}
          onClick={() => {
            if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
            setPresenting(false)
          }}
        >
          <Icon name="close" size={18} />
        </button>
      ) : null}
      {/* The frame measures; the stage is measured. They are separate elements
          because a scaled element reports its scaled size, and a fit computed
          from that converges on zero. */}
      <div className={`yv-stage${fit.flow ? ' is-flow' : ''}`} ref={fit.frameRef}
           style={fit.flow ? undefined : { blockSize: `${STAGE_H * fit.scale}px` }}>
        {/* `key` on the slide id restarts the entrance animation on every
            advance — without it React reuses the node and the second slide
            appears already settled, which reads as a jump rather than a turn. */}
        <div
          key={slide.id}
          ref={fit.stageRef}
          className={`yv-slide yv-slide--${slide.layout}`}
          data-layout={slide.layout}
          style={fit.flow
            ? { ['--yv-text-fit' as string]: 1 }
            : {
                inlineSize: `${STAGE_W}px`,
                blockSize: `${STAGE_H}px`,
                transform: `scale(${fit.scale})`,
                ['--yv-text-fit' as string]: fit.textFit,
              }}
        >
          <span className="yv-slide__wash" aria-hidden="true" />
          <div className="yv-slide__inner">
            <SlideBody slide={slide} />
          </div>
        </div>
      </div>

      {/* The deck's own nav moves between SLIDES; the player's footer moves
          between PARTS of the task. Both used to read "הבא", stacked, which is
          two buttons appearing to do the same thing. This one says which. */}
      <nav className="yv-deck__nav" aria-label={t('tasks.deck.progress')}>
        <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm"
                disabled={at === 0} onClick={() => go(-1)}>
          {t('tasks.deck.prev')}
        </button>
        <ol className="yv-deck__dots" aria-label={t('tasks.deck.progress')}>
          {slides.map((entry, position) => (
            <li key={entry.id}>
              <button
                type="button" aria-current={position === at ? 'step' : undefined}
                aria-label={t('tasks.deck.goto', { n: String(position + 1) })}
                className={position === at ? 'is-at' : position < at ? 'is-seen' : ''}
                onClick={() => setAt(position)}
              />
            </li>
          ))}
        </ol>
        <button type="button" className="sp-btn sp-btn--sm"
                disabled={at >= slides.length - 1} onClick={() => go(1)}>
          {t('tasks.deck.next')}
        </button>
      </nav>

      {teacher ? (
        <div className="yv-deck__teacher">
          <div className="yv-deck__tools">
            <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm"
                    onClick={() => void present()}>
              <Icon name="play" size={15} />
              {t('tasks.deck.present')}
            </button>
            {/* The browser's own print pipeline, which is also its PDF export.
                A server-side renderer would mean Chromium in the API image for
                a button a teacher presses twice a term. */}
            <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm"
                    onClick={() => window.print()}>
              <Icon name="note" size={15} />
              {t('tasks.deck.print')}
            </button>
            {slideActions?.(at, slide)}
          </div>

          {/* Written to the teacher, about the class. The learner projection
              strips it server-side; this flag is the second lock. */}
          {slide.notes ? (
            <aside className="yv-deck__notes">
              <strong>{t('tasks.deck.notes')}</strong>
              <p dir="auto">{slide.notes}</p>
            </aside>
          ) : null}
          <span className="yv-deck__count" dir="ltr">{at + 1} / {slides.length}</span>
        </div>
      ) : null}

      {/* Every slide, laid out one per page. Hidden on screen, and the only
          thing on paper — `@media print` hides the app around it. */}
      {teacher ? <PrintSheet slides={slides} ground={ground} /> : null}
    </section>
  )
}

function SlideBody({ slide }: { slide: Slide }) {
  const { t } = useI18n()
  const title = <MathText as="h3" className="yv-slide__title" content={slide.title} />
  const body = <MathText as="p" className="yv-slide__body" content={slide.body} />
  /* A diagram belongs to the slide, not to one branch of this switch. It used
     to be reachable from `default` alone, so a comparison or a timeline could
     not show one even when the generator had drawn it. */
  const visual = slide.visual ? (
    <div className="yv-slide__visual"><SceneRenderer visual={slide.visual} /></div>
  ) : null

  switch (slide.layout) {
    case 'big_number':
      return (
        <>
          {slide.values?.length ? (
            <div className="yv-slide__figures">
              {slide.values.map((entry, index) => (
                <div key={index}>
                  <p className="yv-slide__figure">
                    <span className="yv-math" dir="ltr">{entry.value}</span>
                  </p>
                  <MathText as="small" content={entry.caption} />
                </div>
              ))}
            </div>
          ) : (
            /* `dir="ltr"` and the isolate, same as any formula — a bare number
               at the start of a Hebrew line otherwise picks up the paragraph's
               direction and a minus sign lands on the wrong end. */
            <p className="yv-slide__figure">
              <span className="yv-math" dir="ltr">{slide.value}</span>
            </p>
          )}
          {title}
          {body}
        </>
      )

    case 'compare':
      return (
        <>
          {title}
          <div className="yv-slide__sides">
            {(slide.sides ?? []).map((side, index) => (
              <div key={index} className="yv-slide__side">
                <MathText as="h4" className="yv-slide__sideTitle" content={side.label} />
                <ul>
                  {side.items.map((item, position) => (
                    <li key={position}><MathText content={item} /></li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          {visual}
        </>
      )

    /* No visual slot, deliberately: a timeline IS the diagram, and a second
       figure beside four numbered steps is what makes a slide overflow. */
    case 'timeline':
      return (
        <>
          {title}
          <ol className="yv-slide__steps">
            {(slide.steps ?? []).map((step, index) => (
              <li key={index}>
                <span className="yv-slide__stepNum" aria-hidden="true">{index + 1}</span>
                <div>
                  <MathText as="h4" content={step.label} />
                  <MathText as="p" content={step.body} />
                </div>
              </li>
            ))}
          </ol>
        </>
      )

    case 'text_image':
      return (
        <>
          {title}
          <div className="yv-slide__split">
            <div>{body}</div>
            {visual ?? (slide.image_url ? (
              <img className="yv-slide__img" src={slide.image_url} alt="" loading="lazy" />
            ) : null)}
          </div>
        </>
      )

    case 'fact_grid':
      return (
        <>
          {title}
          <ul className="yv-slide__tiles" data-count={(slide.cards ?? []).length}>
            {(slide.cards ?? []).map((card, index) => (
              <li key={index}>
                {card.emoji ? <span className="yv-tile__emoji" aria-hidden="true">{card.emoji}</span> : null}
                <MathText as="strong" content={card.front} />
                <MathText as="span" content={card.back} />
              </li>
            ))}
          </ul>
        </>
      )

    case 'reveal':
      return (
        <>
          {title}
          {body}
          <RevealCards cards={slide.cards ?? []} />
        </>
      )

    case 'title':
      return (
        <div className="yv-slide__cover">
          <div>
            {title}
            {body}
          </div>
          {/* Topic art from the authored library — the only images in this
              product, and the only ones a slide will render. `alt=""` because
              it is decoration: everything it depicts is in the title beside
              it, and announcing it twice helps nobody. */}
          {slide.image_url ? (
            <img className="yv-slide__art" src={slide.image_url} alt="" loading="lazy" />
          ) : visual}
        </div>
      )

    case 'quote':
      return (
        <blockquote className="yv-slide__quote">
          <MathText as="p" content={slide.body} />
          {slide.title.length ? <MathText as="cite" content={slide.title} /> : null}
        </blockquote>
      )

    case 'summary':
      return (
        <>
          <h3 className="yv-slide__title">
            <Icon name="check" size={18} />
            {t('tasks.deck.summary')}
          </h3>
          <Bullets slide={slide} />
          {slide.synthesized ? (
            <p className="yv-slide__assembled">{t('tasks.deck.assembled')}</p>
          ) : null}
        </>
      )

    case 'fact':
      return (
        <aside className="yv-slide__fact">
          {title}
          {body}
          {visual}
        </aside>
      )

    default:
      return (
        <>
          {title}
          {body}
          <Bullets slide={slide} />
          {visual}
        </>
      )
  }
}

/** Click to check yourself. Not scored, not reported, and deliberately not a
 *  question: the deck is where a child is allowed to just look at something. */
function RevealCards({ cards }: { cards: NonNullable<Slide['cards']> }) {
  const { t } = useI18n()
  const [open, setOpen] = useState<Set<number>>(new Set())

  const toggle = (index: number) => setOpen((current) => {
    const next = new Set(current)
    if (next.has(index)) next.delete(index)
    else next.add(index)
    return next
  })

  return (
    <ul className="yv-slide__reveal">
      {cards.map((card, index) => (
        <li key={index}>
          <button type="button" className={`yv-reveal${open.has(index) ? ' is-open' : ''}`}
                  aria-expanded={open.has(index)} onClick={() => toggle(index)}>
            {card.emoji ? <span aria-hidden="true">{card.emoji}</span> : null}
            <MathText className="yv-reveal__front" content={card.front} />
            {open.has(index)
              ? <MathText className="yv-reveal__back" content={card.back} />
              : <span className="yv-reveal__cue">{t('tasks.card.reveal')}</span>}
          </button>
        </li>
      ))}
    </ul>
  )
}

/** Every slide at once, one per page, for the browser's print/PDF pipeline.
 *
 *  Rendered rather than screenshotted: server-side rendering would need a
 *  headless browser in an image that has neither Node nor Chromium, and this
 *  route prints the real fonts, the real bidi and the real vector diagrams.
 */
function PrintSheet({ slides, ground }: { slides: Slide[]; ground: string }) {
  return (
    <div className="yv-print" aria-hidden="true" data-ground={ground}>
      {slides.map((slide) => (
        <div key={slide.id} className={`yv-slide yv-slide--${slide.layout}`}
             data-layout={slide.layout}>
          <span className="yv-slide__wash" aria-hidden="true" />
          <div className="yv-slide__inner"><SlideBody slide={slide} /></div>
        </div>
      ))}
    </div>
  )
}

function Bullets({ slide }: { slide: Slide }) {
  if (!slide.bullets?.length) return null
  return (
    <ul className="yv-slide__bullets">
      {slide.bullets.map((bullet, index) => (
        <li key={index}><MathText content={bullet} /></li>
      ))}
    </ul>
  )
}

/** Flashcards and click-reveal: study aids, which report engagement and not a
 *  score. Saying so in the data is what stops a "0%" appearing beside a block
 *  nobody could have got wrong. */
export function StudyBlock({ block }: { block: { id: string; widget: string;
  prompt?: import('./mathSegments').MathSegment[]
  cards?: { front: import('./mathSegments').MathSegment[]
            back: import('./mathSegments').MathSegment[] }[] } }) {
  const { t } = useI18n()
  const [flipped, setFlipped] = useState<Set<number>>(new Set())

  const toggle = (index: number) => setFlipped((current) => {
    const next = new Set(current)
    if (next.has(index)) next.delete(index)
    else next.add(index)
    return next
  })

  return (
    <section className="yv-study">
      {block.prompt?.length ? <MathText as="p" className="yv-study__prompt" content={block.prompt} /> : null}
      <ul className={`yv-study__cards is-${block.widget}`}>
        {(block.cards ?? []).map((card, index) => (
          <li key={index}>
            <button type="button" className={`yv-card${flipped.has(index) ? ' is-open' : ''}`}
                    aria-expanded={flipped.has(index)} onClick={() => toggle(index)}>
              <MathText className="yv-card__front" content={card.front} />
              {flipped.has(index)
                ? <MathText className="yv-card__back" content={card.back} />
                : <span className="yv-card__cue">{t('tasks.card.reveal')}</span>}
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
