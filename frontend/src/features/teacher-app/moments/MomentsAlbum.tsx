/* The class book (#450 v3) — the page's cinematic finale.
 *
 * Not a card with a book inside: the section IS the book. Scrolling down to it
 * pins the viewport on a tall stage; the closed, leather-bound cover rises and
 * fills the view, then turns open, and the first spread is in front of the
 * teacher with nothing else on screen. Scrolling back up plays the whole thing
 * in reverse — the book closes and the dashboard returns. The choreography is
 * driven by one scroll-progress variable (--p, 0→1 across the stage) written
 * straight onto the element — no re-render per scroll tick — and every phase
 * (rise, cover turn, page reveal) is a CSS clamp() over it.
 *
 * Inside: a Hebrew book. The opening page of a spread sits on the RIGHT and
 * advancing turns the left page over the spine — a real 3D leaf, outgoing page
 * on its front, incoming on its back. Buttons, arrow keys and a horizontal
 * swipe all turn it. In LTR the whole geometry mirrors.
 *
 * The book holds the top ten of the FINISHED period via `bookModel.topMoments`
 * over `momentsInEdition` — a rating of MOMENTS (improvement first), never of
 * students (C5). Each page's picture is one of the kind's drawn plates,
 * assigned per-page by `platePlan`, with the hand-drawn SVG scene as the
 * final fallback.
 */

import { useEffect, useRef, useState } from 'react'
import { Icon, SectionHeader, Skeleton } from '../../../components/primitives'
import { useAuth } from '../../../providers/AuthProvider'
import { useI18n } from '../../../i18n/I18nProvider'
import { sendKudos, type Moment } from '../../../services/teacher'
import { RawEvidence } from '../shared/EvidenceDisclosure'
import { KudosSparks, useDraftId } from '../shared/KudosSparks'
import { periodIdForDays } from '../shared/periodModel'
import { StudentAvatar } from '../shared/StudentAvatar'
import { agoLabel } from '../live/LiveNow'
import { MomentScene } from './MomentScene'
import { momentSentence } from './momentText'
import {
  bookEdition, coverVariant, momentsInEdition, platePlan, project, topMoments,
} from './bookModel'
import './moments-album.css'

const TURN_MS = 750
/* --p at which the cover has finished opening and the pages take input —
   deliberately near the stage's end, so "fully open" and "bottom of the page"
   coincide and further scrolling turns pages instead of leaving the book. */
const OPEN_AT = 0.85

export function MomentsAlbum({
  moments, nameOf, groupName = null, groupId = null, isLoading = false,
  periodDays = 7,
}: {
  moments: Moment[]
  nameOf: (learnerId: string) => string | null
  groupName?: string | null
  groupId?: string | null
  /** Whether the feed is still in flight. An empty list means "quiet period"
   *  only once this is false — see the quiet block below. */
  isLoading?: boolean
  /** The dashboard's period. The book is the edition BEFORE it. */
  periodDays?: number
}) {
  const { t, direction } = useI18n()
  const { user, updatePreferences } = useAuth()
  /* The edition this book IS — the finished period, not the one in progress —
     and the pages are drawn from that window alone, so the range stamped on
     the cover describes what is actually inside. */
  const edition = bookEdition(periodDays)
  const pages = topMoments(momentsInEdition(moments, edition))
  /* "last week" / "yesterday" / "last month" — the copy names the stretch the
     book is about rather than saying "the previous period", which is what a
     settings screen calls it and not what a teacher does. Written per period
     instead of interpolated from a noun: Hebrew agreement does not survive
     "{period} שקט" once one of the periods is plural. */
  const when = t(`tch.period.prev.${periodIdForDays(periodDays)}`)
  /* variants[i] is page i's plate — same-kind pages never share a picture */
  const variants = platePlan(pages)
  const spreadCount = Math.ceil(pages.length / 2)
  const [coverArtOk, setCoverArtOk] = useState(true)

  const stageRef = useRef<HTMLElement | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [spread, setSpread] = useState(0)
  const [turn, setTurn] = useState<null | { to: number; forward: boolean }>(null)
  const swipeFrom = useRef<number | null>(null)
  const rtl = direction === 'rtl'

  /* Each edition arrives gift-wrapped ONCE per TEACHER: the unwrap is recorded
     on the user's preferences ({group_id: edition key}), so the ceremony
     follows them across browsers and survives a cleared cache — and tomorrow's
     edition arrives wrapped again. The key is the DAY, not the period, so a
     teacher who switches from week to month is not handed a second present for
     a book they have already opened this morning. */
  const groupKey = groupId ?? 'all'
  const [gift, setGift] = useState<'wrapped' | 'popping' | 'emerging' | 'done'>(() => (
    user?.preferences.teacher_book_seen?.[groupKey] === edition.key ? 'done' : 'wrapped'
  ))
  const wasGift = useRef(gift !== 'done')
  const [showHint, setShowHint] = useState(false)
  const giftRef = useRef<HTMLButtonElement | null>(null)
  /* while the unwrap intro drives --p itself, the scroll measurer stands back */
  const introRef = useRef(false)

  /* The unwrap timeline: pop the box, then the book rises out of it CLOSED
     (--p pinned at the risen-closed pose) with a golden flash, holds a beat,
     and the cover swings open by itself — the same scroll choreography, played
     on a clock. The reader is glided to the floor meanwhile, so when the
     intro hands control back the scroll position agrees with what they see. */
  const beginIntro = () => {
    const stage = stageRef.current
    if (!stage) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      stage.style.setProperty('--p', '1')
      setIsOpen(true)
      return
    }
    const scroller = stage.closest('.sp-teacher-shell__main')
    scroller?.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' })
    introRef.current = true
    setIsOpen(false)
    stage.style.setProperty('--p', '0.3000')
    const HOLD = 600
    const TOTAL = 2500
    const start = performance.now()
    const tick = (now: number) => {
      const raw = Math.min(1, Math.max(0, (now - start - HOLD) / (TOTAL - HOLD)))
      const eased = 1 - (1 - raw) ** 3
      stage.style.setProperty('--p', (0.3 + eased * 0.7).toFixed(4))
      if (raw < 1) {
        requestAnimationFrame(tick)
      } else {
        introRef.current = false
        setIsOpen(true)
      }
    }
    requestAnimationFrame(tick)
  }

  const openGift = () => {
    if (gift !== 'wrapped') return
    setGift('popping')
    /* fire-and-forget: a failed write only means one more ceremony next visit */
    void updatePreferences({
      teacher_book_seen: {
        ...(user?.preferences.teacher_book_seen ?? {}),
        [groupKey]: edition.key,
      },
    }).catch(() => {})
    /* the book starts rising while the confetti is still in the air… */
    window.setTimeout(() => {
      setGift('emerging')
      beginIntro()
    }, 650)
    /* …and the spent wrapping leaves once everything has landed */
    window.setTimeout(() => setGift('done'), 1700)
  }

  /* The nudge: a teacher who has been LOOKING at the present for a few
     seconds without clicking gets a small "click me". Timed from visibility,
     not from mount — the present may live far below the fold. */
  useEffect(() => {
    if (gift !== 'wrapped') return
    const target = giftRef.current
    if (!target) return
    let timer = 0
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        if (!timer) timer = window.setTimeout(() => setShowHint(true), 3500)
      } else if (timer) {
        window.clearTimeout(timer)
        timer = 0
      }
    }, { threshold: 0.5 })
    observer.observe(target)
    return () => {
      observer.disconnect()
      if (timer) window.clearTimeout(timer)
    }
    /* pages.length too: before the moments land there IS no gift element, and
       an effect that bailed once must retry when it appears */
  }, [gift, pages.length])

  /* Scroll → --p. Written directly on the stage element so a scroll tick never
     re-renders React; only crossing the open threshold flips state. Listening
     in the capture phase catches inner scroll containers too. */
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      stage.style.setProperty('--p', '1')
      setIsOpen(true)
      return
    }
    /* The teacher pages scroll inside `.sp-teacher-shell__main`, not the
       window — so "a viewport" here is the SCROLLER's box, not 100vh. The
       stage publishes the scroller's height as --stage-vh (the CSS sizes the
       stage and the pin off it), which is what makes the stage's end land
       exactly on the scroller's last scrollable pixel: the book is the floor. */
    const scroller = stage.closest('.sp-teacher-shell__main') ?? document.documentElement
    let frame = 0
    const measure = () => {
      frame = 0
      if (introRef.current) return // the unwrap intro owns --p right now
      const viewport = scroller.clientHeight
      stage.style.setProperty('--stage-vh', `${viewport}px`)
      const rect = stage.getBoundingClientRect()
      const scrollerTop = scroller === document.documentElement
        ? 0
        : scroller.getBoundingClientRect().top
      const travel = Math.max(1, rect.height - viewport)
      const progress = Math.min(1, Math.max(0, (scrollerTop - rect.top) / travel))
      stage.style.setProperty('--p', progress.toFixed(4))
      setIsOpen((open) => (open === progress >= OPEN_AT ? open : progress >= OPEN_AT))
    }
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(measure) }
    measure()
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    return () => {
      if (frame) cancelAnimationFrame(frame)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
    }
  }, [pages.length])

  const goTo = (next: number) => {
    if (turn || next === spread || next < 0 || next >= spreadCount) return
    setTurn({ to: next, forward: next > spread })
    window.setTimeout(() => {
      setSpread(next)
      setTurn(null)
    }, TURN_MS)
  }
  const forward = () => goTo(spread + 1)
  const back = () => goTo(spread - 1)

  /* At the bottom of the page the wheel becomes the page-turner: scrolling
     further down flips forward, scrolling up flips back — until spread 0,
     where scrolling up is released to close the book and return the page.
     Mirrored through refs so the non-passive listener binds once. */
  const wheelState = useRef({
    isOpen, spread, turning: turn !== null, lastTurn: 0, acc: 0, lastWheel: 0, gift, goTo,
  })
  wheelState.current = { ...wheelState.current, isOpen, spread, turning: turn !== null, gift, goTo }
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const onWheel = (event: WheelEvent) => {
      const state = wheelState.current
      if (state.gift !== 'done') return // the present takes no page turns
      if (!state.isOpen) return
      const progress = parseFloat(stage.style.getPropertyValue('--p') || '0')
      if (progress < 0.999) { state.acc = 0; return }
      if (event.deltaY < 0 && state.spread === 0) return // let the book close
      event.preventDefault()
      const now = Date.now()
      if (state.turning || now - state.lastTurn < TURN_MS + 150) { state.acc = 0; return }
      /* A trackpad speaks in many tiny deltas, not one big notch — a fixed
         per-event threshold swallows a gentle two-finger scroll entirely (the
         floor LOOKS dead). Accumulate instead: a pause or a change of
         direction starts a fresh gesture. */
      if (now - state.lastWheel > 400 || Math.sign(event.deltaY) !== Math.sign(state.acc || event.deltaY)) {
        state.acc = 0
      }
      /* Distance alone cannot tell a flick from a crawl, and making a flick
         travel the same 40px as a slow drag is what makes a turner feel
         heavy. So ask where the gesture is HEADING, not only where it has
         been: project the momentum from the current velocity and commit as
         soon as the projection clears the threshold. A fast two-finger flick
         turns on its second frame; a gentle scroll still accumulates. The
         first event of a fresh gesture has no velocity to read (its `dt`
         spans the pause that reset it) and contributes distance only. */
      const dt = Math.max(now - state.lastWheel, 1)
      const velocity = (event.deltaY / dt) * 1000 // px per second
      state.lastWheel = now
      state.acc += event.deltaY
      const projected = state.acc + project(velocity)
      if (Math.abs(projected) < 40) return
      const direction = state.acc > 0 ? 1 : -1
      state.acc = 0
      state.lastTurn = now
      state.goTo(state.spread + direction)
    }
    stage.addEventListener('wheel', onWheel, { passive: false })
    return () => stage.removeEventListener('wheel', onWheel)
    /* Re-keyed like the scroll effect: on a fresh load the moments land AFTER
       the first render, so the stage (and its ref) does not exist yet — with
       [] deps this effect would bail once and the floor wheel would never
       turn a page. */
  }, [pages.length])

  /* Spread k holds pages 2k (the opening page) and 2k+1. In a Hebrew book the
     opening page of a spread is the RIGHT one; in LTR it is the left.

     During a FORWARD turn the flying leaf is the sheet [old closing | new
     opening]: the opening half keeps the old page until the leaf lands on it,
     while the closing half already reveals the new one underneath. A BACK turn
     is the mirror: the leaf is [old opening | new closing], the closing half
     keeps its old page, the opening half reveals the earlier spread's. */
  const pageAt = (index: number): Moment | null => pages[index] ?? null
  const shownSpread = turn ? turn.to : spread
  const underOpening = turn?.forward === false ? pageAt(turn.to * 2) : pageAt(spread * 2)
  const underClosing = turn?.forward
    ? pageAt(turn.to * 2 + 1)
    : pageAt(spread * 2 + 1)
  const leafFront = turn
    ? (turn.forward ? pageAt(spread * 2 + 1) : pageAt(spread * 2))
    : null
  const leafBack = turn
    ? (turn.forward ? pageAt(turn.to * 2) : pageAt(turn.to * 2 + 1))
    : null

  /* Still fetching. Holds the quiet state's exact shape so the section does not
     jump when the answer arrives, and — crucially — does not claim the period
     was quiet before anyone has looked. */
  if (isLoading) {
    return (
      <section className="sp-panel tch-album tch-album--quiet" data-tour="teacher.moments" aria-busy="true">
        <SectionHeader title={t('tch.album.title', { when })} subtitle={t('tch.album.subtitle', { when })} />
        <div className="tch-quiet">
          <div className="tch-quiet__book tch-quiet__book--pending" aria-hidden="true" />
          <div className="tch-quiet__text">
            <Skeleton w="120px" h={16} />
            <Skeleton w="260px" h={12} />
          </div>
        </div>
      </section>
    )
  }

  /* A quiet stretch is a NORMAL stretch, not a failure state — a holiday, a
     short week, a class that spent it off-screen. Since the book is about a
     FINISHED period, this is a page a teacher will genuinely meet, so it names
     which stretch was quiet and when the next book comes rather than leaving a
     grey line where a section should be.
     No present, and nothing recorded as unwrapped: there is no edition to hand
     over, and tomorrow's book must still arrive gift-wrapped. */
  if (pages.length === 0) {
    return (
      <section className="sp-panel tch-album tch-album--quiet" data-tour="teacher.moments">
        <SectionHeader title={t('tch.album.title', { when })} subtitle={t('tch.album.subtitle', { when })} />
        <div className="tch-quiet">
          <div className="tch-quiet__book" aria-hidden="true">
            {coverArtOk ? (
              <img
                className="tch-quiet__cover"
                src={`/moments/cover-${coverVariant(groupName)}.jpg`}
                alt=""
                onError={() => setCoverArtOk(false)}
              />
            ) : null}
            <span className="tch-quiet__band"><bdi dir="ltr">{edition.label}</bdi></span>
          </div>
          <div className="tch-quiet__text">
            <strong className="tch-quiet__title">{t('tch.album.quietTitle', { when })}</strong>
            <p className="tch-album__empty">{t('tch.album.quietBody', { when })}</p>
            <p className="tch-quiet__next">{t('tch.album.quietNext')}</p>
          </div>
        </div>
      </section>
    )
  }

  return (
    <section
      ref={stageRef}
      className={`tch-album tch-bookStage${isOpen ? ' is-open' : ''}${gift === 'wrapped' || gift === 'popping' ? ' is-gift' : ''}`}
      data-tour="teacher.moments"
    >
      <div className="tch-bookStage__pin">
        <header className="tch-bookStage__head">
          <div className="tch-bookStage__titles">
            <h2>
              {t('tch.album.title', { when })}
              {/* the edition's week, right in the title */}
              <span className="tch-bookStage__dates">
                {' - '}
                <bdi dir="ltr">{edition.label}</bdi>
              </span>
            </h2>
            <p>{t('tch.album.subtitle', { when })}</p>
          </div>
        </header>

        {/* The first sight of a week's edition: a wrapped present where the
            book stands. One click pops it and the book is handed over. */}
        {gift !== 'done' ? (
          <button
            ref={giftRef}
            type="button"
            className={`tch-gift${gift !== 'wrapped' ? ' is-popping' : ''}${showHint ? ' has-hint' : ''}`}
            aria-label={t('tch.album.giftOpen')}
            onClick={openGift}
          >
            <GiftBox />
            {/* the nudge: a cursor taps the present, click-rings and all */}
            <span className="tch-gift__cursor" aria-hidden="true">
              <svg viewBox="0 0 44 44" width="52" height="52">
                <circle className="tch-gift__cursorRing" cx="14" cy="13" r="9" />
                <circle className="tch-gift__cursorRing tch-gift__cursorRing--late" cx="14" cy="13" r="9" />
                <path
                  d="M14 11 L 32 23.5 L 24 25.4 L 28.8 35 L 24.9 36.9 L 20.2 27.3 L 14.6 32 Z"
                  fill="#fff" stroke="#3b3566" strokeWidth="1.8" strokeLinejoin="round"
                />
              </svg>
            </span>
            <span className="tch-gift__hint" aria-hidden="true">{t('tch.album.giftHint')}</span>
          </button>
        ) : null}

        <div className={`tch-book3d${rtl ? ' is-rtl' : ' is-ltr'}${wasGift.current && (gift === 'emerging' || gift === 'done') ? ' is-born' : ''}`}>
          {/* The turners live ON the book, at its outer edges — a lightbox
              affordance, not a toolbar in a far corner. In a Hebrew book the
              pages advance leftward, so NEXT sits on the left edge pointing
              left and PREV on the right; LTR mirrors both. They surface with
              the cover's opening (opacity follows --open). */}
          <button
            type="button"
            className="tch-album__navBtn tch-album__navBtn--prev"
            aria-label={t('tch.album.prev')}
            disabled={!isOpen || spread === 0 || turn !== null}
            onClick={back}
          >
            <Icon
              name="chevronLeft" size={17} aria-hidden
              className={rtl ? 'tch-album__flip' : undefined}
            />
          </button>
          <button
            type="button"
            className="tch-album__navBtn tch-album__navBtn--next"
            aria-label={t('tch.album.next')}
            disabled={!isOpen || spread >= spreadCount - 1 || turn !== null}
            onClick={forward}
          >
            <Icon
              name="chevronLeft" size={17} aria-hidden
              className={rtl ? undefined : 'tch-album__flip'}
            />
          </button>
          {/* The direction class must sit on .tch-book ITSELF: the leaf's
              animation-name and the gutter shading are keyed on
              `.tch-book.is-rtl` — as a descendant selector they never match
              and the page turn silently becomes a pop. */}
          <div
            className={`tch-book${rtl ? ' is-rtl' : ' is-ltr'}`}
            onPointerDown={(event) => { swipeFrom.current = event.clientX }}
            onPointerUp={(event) => {
              const from = swipeFrom.current
              swipeFrom.current = null
              if (from === null || !isOpen) return
              const delta = event.clientX - from
              if (Math.abs(delta) < 48) return
              /* Dragging mimics the physical turn: in a Hebrew book you push
                 the left page to the right to advance. */
              if ((delta > 0) === rtl) forward()
              else back()
            }}
            onKeyDown={(event) => {
              if (!isOpen) return
              if (event.key === 'ArrowRight') (rtl ? back : forward)()
              if (event.key === 'ArrowLeft') (rtl ? forward : back)()
            }}
            tabIndex={0}
            role="group"
            aria-label={t('tch.album.title', { when })}
          >
            <div className="tch-book__spine" aria-hidden="true" />
            {/* The opening half (right in RTL) and the closing half. */}
            <div className="tch-book__half tch-book__half--opening">
              {underOpening && (
                <BookPage
                  moment={underOpening}
                  variant={variants[pages.indexOf(underOpening)]}
                  nameOf={nameOf}
                />
              )}
            </div>
            <div className="tch-book__half tch-book__half--closing">
              {/* No title page: lifting the cover reveals the spread's real
                  page straight away — the book starts at its content. */}
              {underClosing && (
                <BookPage
                  moment={underClosing}
                  variant={variants[pages.indexOf(underClosing)]}
                  nameOf={nameOf}
                />
              )}
            </div>

            {turn && (
              <div className={`tch-book__leaf${turn.forward ? ' is-forward' : ' is-back'}`}>
                <div className="tch-book__leafFace tch-book__leafFace--front">
                  {leafFront && (
                    <BookPage
                      moment={leafFront}
                      variant={variants[pages.indexOf(leafFront)]}
                      nameOf={nameOf}
                    />
                  )}
                </div>
                <div className="tch-book__leafFace tch-book__leafFace--back">
                  {leafBack && (
                    <BookPage
                      moment={leafBack}
                      variant={variants[pages.indexOf(leafBack)]}
                      nameOf={nameOf}
                    />
                  )}
                </div>
              </div>
            )}

            {/* The front cover: leather, embossed, hinged on the spine. It
                turns open with the scroll and fades once it has lain flat. */}
            <div className="tch-book__cover" aria-hidden="true">
              <div className="tch-book__coverFace tch-book__coverFace--front">
                {/* the cover artwork — a drawn still life, framed in gilt;
                    if the plate is missing the leather stands alone */}
                {coverArtOk ? (
                  <span className="tch-book__coverArt">
                    <img
                      src={`/moments/cover-${coverVariant(groupName)}.jpg`}
                      alt=""
                      onError={() => setCoverArtOk(false)}
                    />
                  </span>
                ) : null}
                <div className="tch-book__coverFrame">
                  <span className="tch-book__coverEmblem">
                    <svg viewBox="0 0 48 32" width="42" height="28" aria-hidden="true">
                      <path
                        d="M24 5 C18 1 8 1 3 4 v 23 c 5 -3 15 -3 21 1 c 6 -4 16 -4 21 -1 v -23 c -5 -3 -15 -3 -21 1 Z M24 5 v 23"
                        fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                  <strong>{t('tch.album.title', { when })}</strong>
                  {groupName ? (
                    <span className="tch-book__coverGroup" dir="auto">{groupName}</span>
                  ) : null}
                  {/* the edition's week — the next book arrives when it ends */}
                  <span className="tch-book__coverDates">{edition.label}</span>
                  <span className="tch-book__coverRule" />
                </div>
              </div>
              <div className="tch-book__coverFace tch-book__coverFace--inner" />
            </div>
          </div>
          {/* the folio line, centred under the spread like a printed page number */}
          <span className="tch-album__pageOf">
            {t('tch.album.pageOf', { page: shownSpread + 1, total: spreadCount })}
          </span>
        </div>

        {/* Every plate warmed up front (ten small JPEGs): a leaf mid-flight
            must never wait on a network fetch — that was the "bugged" turn. */}
        <div className="tch-book__preload" aria-hidden="true">
          {pages.map((moment, index) => (
            <img
              key={`${moment.kind}:${moment.learner_id}:${moment.at}`}
              src={`/moments/${moment.kind}-${variants[index]}.jpg`}
              alt=""
            />
          ))}
        </div>
      </div>
    </section>
  )
}

function BookPage({ moment, variant, nameOf }: {
  moment: Moment
  /** the page's assigned plate, from `platePlan` — distinct within a kind */
  variant: number
  nameOf: (id: string) => string | null
}) {
  const { t, language } = useI18n()
  /* The plate: this page's assigned variant → the kind's first plate → the SVG. */
  const [plate, setPlate] = useState<'variant' | 'first' | 'scene'>('variant')
  const [showWhy, setShowWhy] = useState(false)
  const [isPraising, setIsPraising] = useState(false)
  const [draft, setDraft] = useState('')
  const [sparks, setSparks] = useState(0)
  const draftId = useDraftId()
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle')
  const name = moment.learner_id ? nameOf(moment.learner_id) : null
  const hasWhy = Boolean(moment.evidence?.raw && Object.keys(moment.evidence.raw).length)
  const sentence = momentSentence(
    moment.text_key, moment.params as Record<string, string | number>, t)

  async function praise() {
    if (!moment.learner_id || !draft.trim() || state === 'sending') return
    setState('sending')
    try {
      await sendKudos(moment.learner_id, draft.trim(), language, {
        kind: moment.kind, at: moment.at, objective_id: moment.objective_id,
      }, { sparks, draftId })
      setState('sent')
      setIsPraising(false)
    } catch {
      setState('failed')
    }
  }

  return (
    <article className="tch-book__page">
      <div className="tch-book__plate">
        {plate === 'scene'
          ? <MomentScene kind={moment.kind} />
          : (
            <img
              src={`/moments/${moment.kind}-${plate === 'first' ? 1 : variant}.jpg`}
              alt=""
              draggable={false}
              onError={() => setPlate((current) => (
                /* falling back to -1 when -1 IS the variant would re-set the
                   same src — React would not reload it and no second error
                   would ever fire, leaving a stuck broken image */
                current === 'variant' && variant !== 1 ? 'first' : 'scene'
              ))}
            />
          )}
      </div>
      <p className="tch-album__sentence" dir="auto">{sentence}</p>
      {moment.learner_id ? (
        <p className="tch-book__byline" dir="auto">
          <StudentAvatar learnerId={moment.learner_id} name={name} size={22} />
          <bdi>{name ?? moment.learner_id}</bdi>
          <span className="tch-album__ago">{agoLabel(moment.at, t)}</span>
        </p>
      ) : null}
      <div className="tch-album__meta">
        {hasWhy ? (
          <button
            type="button"
            className="tch-evidence__toggle"
            aria-expanded={showWhy}
            onClick={() => setShowWhy((value) => !value)}
          >
            <Icon name={showWhy ? 'chevronUp' : 'chevronLeft'} size={13} aria-hidden />
            {t('tch.evidence.why')}
          </button>
        ) : null}
        {moment.learner_id && state !== 'sent' && !isPraising ? (
          <button
            type="button"
            className="sp-btn sp-btn--ghost sp-btn--sm"
            onClick={() => setIsPraising(true)}
          >
            <Icon name="spark" size={13} aria-hidden />
            {t('tch.kudos.open')}
          </button>
        ) : null}
      </div>
      {showWhy ? <RawEvidence raw={moment.evidence?.raw} /> : null}
      {state === 'sent' ? (
        <p className="tch-album__sent" role="status">
          <Icon name="check" size={13} aria-hidden />
          {t('tch.kudos.sent')}
        </p>
      ) : isPraising ? (
        <div className="tch-album__kudos">
          <p className="tch-album__kudosHint">{t('tch.kudos.hint')}</p>
          <textarea
            value={draft}
            dir="auto"
            rows={2}
            placeholder={t('tch.kudos.placeholder')}
            aria-label={t('tch.kudos.title')}
            onChange={(event) => setDraft(event.target.value)}
          />
          <KudosSparks value={sparks} onChange={setSparks} disabled={state === 'sending'} />
          <div className="tch-album__kudosActions">
            <button
              type="button"
              className="sp-btn sp-btn--primary sp-btn--sm"
              disabled={!draft.trim() || state === 'sending'}
              onClick={praise}
            >
              {state === 'sending' ? t('tch.kudos.sending') : t('tch.kudos.send')}
            </button>
            <button
              type="button"
              className="sp-btn sp-btn--ghost sp-btn--sm"
              onClick={() => setIsPraising(false)}
            >
              {t('tch.meeting.close')}
            </button>
          </div>
          {state === 'failed' ? (
            <p className="tch-album__error" role="status">{t('tch.kudos.failed')}</p>
          ) : null}
        </div>
      ) : null}
      <span className="tch-book__folio" aria-hidden="true" />
    </article>
  )
}

/* The week's present, drawn flat-cartoon: thick ink outlines, a plump box
 * that tapers toward the floor, candy-pink paper with cream polka dots and a
 * fat glossy bow in the brand cyan. The group skeleton is load-bearing — the
 * unwrap flies the lid (bow and all), sinks the box and bursts the 16 confetti
 * children as separate CSS targets. Purely decorative; the button around it
 * holds the accessible name. */
function GiftBox() {
  const ink = '#34306b'
  return (
    <svg viewBox="0 0 220 230" width="460" height="481" aria-hidden="true" className="tch-gift__art">
      <defs>
        <linearGradient id="tchGiftPaper" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ff92a7" />
          <stop offset="0.55" stopColor="#f25c7a" />
          <stop offset="1" stopColor="#d84067" />
        </linearGradient>
        <linearGradient id="tchGiftLid" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffa2b4" />
          <stop offset="1" stopColor="#f06a86" />
        </linearGradient>
        <linearGradient id="tchGiftRibbon" x1="0" y1="0" x2="0.6" y2="1">
          <stop offset="0" stopColor="#5fe3f9" />
          <stop offset="0.5" stopColor="#23c3e8" />
          <stop offset="1" stopColor="#0f9dc4" />
        </linearGradient>
      </defs>

      {/* ground */}
      <ellipse cx="110" cy="212" rx="82" ry="11" fill="rgba(52, 48, 107, 0.18)" />

      {/* confetti — asleep until the pop */}
      <g className="tch-gift__confetti">
        <rect x="104" y="82" width="8" height="5" rx="1.5" fill="#ffd166" />
        <rect x="112" y="78" width="7" height="7" rx="1.5" fill="#7c6cf2" />
        <circle cx="102" cy="80" r="3.4" fill="#22c3e6" />
        <rect x="118" y="85" width="6" height="6" rx="1.5" fill="#ff6b81" />
        <circle cx="96" cy="86" r="3" fill="#3ddc97" />
        <rect x="92" y="79" width="7" height="4.5" rx="1.5" fill="#ff9f43" />
        <circle cx="124" cy="79" r="2.8" fill="#ffe8d9" />
        <rect x="101" y="74" width="4.5" height="7" rx="1.5" fill="#ff6b81" />
        <rect x="108" y="77" width="5.5" height="9" rx="1.5" fill="#3ddc97" />
        <circle cx="116" cy="75" r="3.2" fill="#ffd166" />
        <rect x="88" y="86" width="7" height="5.5" rx="1.5" fill="#22c3e6" />
        <circle cx="128" cy="86" r="3.4" fill="#7c6cf2" />
        <path d="M99 79 l3.5 -6 3.5 6 Z" fill="#ff6b81" />
        <path d="M119 83 l3.5 -6 3.5 6 Z" fill="#ffe8d9" />
        <rect x="95" y="73" width="4.5" height="4.5" rx="1.2" fill="#ff9f43" />
        <circle cx="110" cy="88" r="2.6" fill="#ffd166" />
      </g>

      {/* the box — wider at the shoulders, like it can barely hold still */}
      <g className="tch-gift__box">
        <path
          d="M50 112 L59 196 Q60.5 208 71 208 L149 208 Q159.5 208 161 196 L170 112 Z"
          fill="url(#tchGiftPaper)" stroke={ink} strokeWidth="5" strokeLinejoin="round"
        />
        {/* cream polka dots */}
        <circle cx="72" cy="138" r="5" fill="rgba(255, 232, 217, 0.9)" />
        <circle cx="147" cy="132" r="4.2" fill="rgba(255, 232, 217, 0.9)" />
        <circle cx="66" cy="180" r="4" fill="rgba(255, 232, 217, 0.85)" />
        <circle cx="150" cy="180" r="5.2" fill="rgba(255, 232, 217, 0.9)" />
        <circle cx="86" cy="199" r="3.2" fill="rgba(255, 232, 217, 0.8)" />
        <circle cx="135" cy="158" r="3.4" fill="rgba(255, 232, 217, 0.85)" />
        {/* the vertical ribbon, tapering with the box */}
        <path
          d="M97 112 L101 208 L119 208 L123 112 Z"
          fill="url(#tchGiftRibbon)" stroke={ink} strokeWidth="4" strokeLinejoin="round"
        />
        <path d="M101.5 114 L105 206" stroke="rgba(255,255,255,0.35)" strokeWidth="4" strokeLinecap="round" fill="none" />
        {/* shade under the lid */}
        <path d="M50 112 L170 112 L168.5 125 L51.5 125 Z" fill="rgba(56, 22, 60, 0.22)" />
        {/* glossy shine down the left flank */}
        <path d="M64 134 Q60 160 68 182" stroke="rgba(255,255,255,0.35)" strokeWidth="7" strokeLinecap="round" fill="none" />
      </g>

      {/* the lid, its ribbon and the bow — they fly off together */}
      <g className="tch-gift__lid">
        <rect x="36" y="80" width="148" height="36" rx="16" fill="url(#tchGiftLid)" stroke={ink} strokeWidth="5" />
        <rect x="40" y="102" width="140" height="10" rx="5" fill="rgba(56, 22, 60, 0.16)" />
        <rect x="48" y="87" width="44" height="8" rx="4" fill="rgba(255,255,255,0.45)" />
        <rect x="95" y="80" width="30" height="36" fill="url(#tchGiftRibbon)" stroke={ink} strokeWidth="4" />
        <rect x="100" y="82" width="5" height="32" rx="2.5" fill="rgba(255,255,255,0.3)" />
        {/* bow tails */}
        <path d="M108 80 L86 62 L96 50 L112 70 Z" fill="#1db4d8" stroke={ink} strokeWidth="4" strokeLinejoin="round" />
        <path d="M112 80 L134 62 L124 50 L108 70 Z" fill="#45d6f2" stroke={ink} strokeWidth="4" strokeLinejoin="round" />
        {/* fat bow loops with a shadowed hole and a shine */}
        <path
          d="M110 76 C 94 42, 52 46, 58 72 C 62 91, 96 92, 110 76 Z"
          fill="url(#tchGiftRibbon)" stroke={ink} strokeWidth="5" strokeLinejoin="round"
        />
        <path d="M102 73 C 90 54, 68 56, 71 70 C 74 81, 94 81, 102 73 Z" fill="rgba(8, 90, 120, 0.3)" />
        <path d="M78 52 Q 92 50 100 60" stroke="rgba(255,255,255,0.5)" strokeWidth="5" strokeLinecap="round" fill="none" />
        <path
          d="M110 76 C 126 42, 168 46, 162 72 C 158 91, 124 92, 110 76 Z"
          fill="url(#tchGiftRibbon)" stroke={ink} strokeWidth="5" strokeLinejoin="round"
        />
        <path d="M118 73 C 130 54, 152 56, 149 70 C 146 81, 126 81, 118 73 Z" fill="rgba(8, 90, 120, 0.3)" />
        <path d="M142 52 Q 128 50 120 60" stroke="rgba(255,255,255,0.5)" strokeWidth="5" strokeLinecap="round" fill="none" />
        {/* the knot */}
        <rect x="98" y="66" width="24" height="22" rx="9" fill="url(#tchGiftRibbon)" stroke={ink} strokeWidth="5" />
        <circle cx="104" cy="72" r="3" fill="rgba(255,255,255,0.6)" />
      </g>

      {/* chunky twinkle stars + two cheer ticks */}
      <g className="tch-gift__sparks" fill="#ffd166" stroke={ink} strokeWidth="3" strokeLinejoin="round">
        <path d="M44 44 Q46.5 52.5 55 55 Q46.5 57.5 44 66 Q41.5 57.5 33 55 Q41.5 52.5 44 44 Z" />
        <path d="M182 42 Q183.8 48.2 190 50 Q183.8 51.8 182 58 Q180.2 51.8 174 50 Q180.2 48.2 182 42 Z" />
        <path d="M196 117 Q197.6 122.4 203 124 Q197.6 125.6 196 131 Q194.4 125.6 189 124 Q194.4 122.4 196 117 Z" />
        <path d="M66 42 Q70 33 79 30" fill="none" stroke="#ffd166" strokeWidth="4.5" strokeLinecap="round" />
        <path d="M150 34 Q156 28 165 27" fill="none" stroke="#ffd166" strokeWidth="4.5" strokeLinecap="round" />
      </g>
    </svg>
  )
}
