/* The live classroom (#249, B5): who is where, on what, and who needs me NOW.
 *
 * This is what the students screen opens on. The roster answers week-scale
 * questions and stays behind the mode toggle; this view answers the one a
 * teacher has while thirty children work in front of them.
 *
 * Every number, band and label comes from `liveModel` — one source, so the
 * pulse card, the spread strip and the rows can never disagree. The honesty
 * rules travel with it: a dot always has a time beside it, "struggling" always
 * carries its evidence, a child the model cannot place renders as unknown.
 *
 * The focus lane rides along: each row says where the PLANNER is pointing that
 * child (the profile's "מיקוד", class-wide), the pulse card draws the class's
 * division across subjects, and the focus panel changes it — grounded in the
 * planner's own next step, never a guess over the catalog.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { navigate } from '../../../app/router'
import { EmptyState, Hint, Icon, Skeleton } from '../../../components/primitives'
import { Modal } from '../../../components/primitives/Modal'
import { useI18n } from '../../../i18n/I18nProvider'
import {
  type LearnerFocus, type Presence,
} from '../../../services/teacher'
import { FocusPanel } from './FocusPanel'
import { MessageRefused, sendMessage } from '../../../services/directMessages'
import { useTeacherLive } from '../../../providers/TeacherLiveProvider'
import { NoFeelingFace, ValenceFace } from '../../checkin/ValenceFaces'
import { VALENCES, type Valence } from '../../checkin/feelings'
import { StudentAvatar } from '../shared/StudentAvatar'
import { useDismiss } from '../shared/useDismiss'
import { agoLabel } from './LiveNow'
import {
  inBucket, liveCounts, signalOf, spreadByObjective, triageOrder, whereOf,
  type LiveCounts, type Signal, type Where,
} from './liveModel'
import './live-class.css'

type Translate = (key: string, params?: Record<string, string | number>) => string

interface LiveRowData {
  learner_id: string
  name: string
}

interface LiveClassViewProps {
  rows: LiveRowData[]
  presence: Record<string, Presence>
  focusOf: Record<string, LearnerFocus>
  isConnected: boolean
  groupId: string | null
  /** The focus panel changed a pin — the page refetches the class map. */
  onFocusChanged: () => void
}

const BLANK_PRESENCE: Presence = {
  learner_id: '', status: 'offline', connections: 0,
  component_id: null, unit_id: null, objective_id: null, session_id: null,
  subject: null, unit_title: null, objective_title: null,
  last_seen_at: null, lesson_entered_at: null, struggling: null,
  help_requested_at: null, surface: null, surface_screen: null, surface_title: null, surface_subject: null, surface_at: null, chat_at: null,
}

/** The place, as precisely as we honestly can: on a lesson page, the actual
 *  learning's name (catalog-resolved server-side); otherwise the exact
 *  reported screen when the server recognised one, the coarse bucket when
 *  not. Proven lesson and chat stay coarse — their "what" column already
 *  names the content. */
function whereLabel(presence: Presence, where: Where, t: Translate): string {
  if ((where === 'browsing' || where === 'studio') && presence.surface_screen) {
    if (presence.surface_screen === 'learning_lesson' && presence.surface_title) {
      // The subject rides in the location too: "מתמטיקה · <the learning>".
      const subject = subjectDisplay(presence.surface_subject, t)
      return subject ? `${subject} · ${presence.surface_title}` : presence.surface_title
    }
    const key = `tch.liveView.screen.${presence.surface_screen}`
    const label = t(key)
    if (label !== key) return label
  }
  return t(`tch.liveView.where.${where}`)
}

/** A subject KEY as the reader's word for it, falling back to the key. */
function subjectDisplay(key: string | null | undefined, t: Translate): string | null {
  if (!key) return null
  const localeKey = `tch.subject.${key}`
  const localized = t(localeKey)
  return localized !== localeKey ? localized : key
}

/* ── column identity: subject and objective as their own cells ────────────── */

/* Four calm tints (primary/success/warn/info) shared by the subject chips,
   the where chips and the filter menus — the color IS the column's legend, so
   the same subject must land on the same tint everywhere. Known subjects get
   fixed seats; anything new hashes into the same four. */
const SUBJECT_HUE: Record<string, number> = { math: 0, science: 1, english: 2, language: 3 }

function hueOf(key: string): number {
  if (key in SUBJECT_HUE) return SUBJECT_HUE[key]
  let hash = 0
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) >>> 0
  }
  return hash % 4
}

const WHERE_HUE: Partial<Record<Where, number>> = { lesson: 1, chat: 3, studio: 0, browsing: 2 }
const WHERE_ORDER: Where[] = ['lesson', 'chat', 'studio', 'browsing', 'unknown', 'offline']

/** The subject a row belongs to right now: the live lesson's when in one,
 *  the planner's focus otherwise. Key for color and filtering, label for eyes. */
function subjectOf(
  frame: Presence, focus: LearnerFocus | undefined, where: Where, t: Translate,
): { key: string; label: string } | null {
  // Live truth first: the proven lesson's subject, then the lesson PAGE the
  // client reports (its subject comes from the catalog, and may differ from
  // where the planner points), then the planner's focus.
  const key = (where === 'lesson' && frame.subject)
    || (frame.surface_screen === 'learning_lesson' && frame.surface_subject)
    || focus?.subject || null
  if (!key) return null
  const localeKey = `tch.subject.${key}`
  const localized = t(localeKey)
  return {
    key,
    label: localized !== localeKey ? localized : (focus?.subject_name || key),
  }
}

const KPI_ICON = {
  hand: 'hand', struggling: 'alert', lesson: 'pulse', elsewhere: 'compass', offline: 'clock',
} as const

function KpiSegment({ bucket, counts, active, hot, onPick, t }: {
  bucket: keyof LiveCounts
  counts: LiveCounts
  active: keyof LiveCounts | null
  hot: boolean
  onPick: (update: (current: keyof LiveCounts | null) => keyof LiveCounts | null) => void
  t: Translate
}) {
  return (
    <button
      type="button"
      className={`tch-liveKpi tch-liveKpi--${bucket}${
        active === bucket ? ' is-active' : ''}${hot ? ' is-hot' : ''}`}
      aria-pressed={active === bucket}
      title={t(`tch.liveView.kpi.${bucket}Hint`)}
      onClick={() => onPick((current) => (current === bucket ? null : bucket))}
    >
      <Icon name={KPI_ICON[bucket]} size={15} aria-hidden />
      <strong className="tch-liveKpi__value">{counts[bucket]}</strong>
      <span className="tch-liveKpi__label">{t(`tch.liveView.kpi.${bucket}`)}</span>
      {active === bucket && (
        /* The ✕ says, on the chip itself, that the same click releases the
           filter (#506) — aria-pressed already tells assistive tech. */
        <span className="tch-chipOff" aria-hidden="true"><Icon name="close" size={12} /></span>
      )}
    </button>
  )
}

/* A small speedometer: what share of the class the planner points at one
 * subject. A half-circle arc, filled to the share. */
const GAUGE_ARC = 81.7   // semicircle length for r=26 in the 60×34 viewBox

function SubjectGauge({ label, count, total, hue }: {
  label: string
  count: number
  total: number
  /** The subject's seat in the shared four-tint palette — the same color its
   *  chips wear in the table, so gauge and column agree on who is who. */
  hue: number
}) {
  const share = total > 0 ? count / total : 0
  return (
    <div className={`tch-gauge is-hue-${hue}`} title={`${label} · ${count}/${total}`}>
      <svg viewBox="0 0 60 34" aria-hidden="true">
        <path
          d="M4 30 A26 26 0 0 1 56 30"
          fill="none" stroke="var(--sp-bg-subtle)" strokeWidth="6" strokeLinecap="round"
        />
        <path
          className="tch-gauge__fill"
          d="M4 30 A26 26 0 0 1 56 30"
          fill="none" strokeWidth="6" strokeLinecap="round"
          strokeDasharray={`${Math.max(0.001, share) * GAUGE_ARC} ${GAUGE_ARC}`}
        />
      </svg>
      <strong className="tch-gauge__pct">{Math.round(share * 100)}%</strong>
      <span className="tch-gauge__label" dir="auto">{label}</span>
    </div>
  )
}

/* The loading frame paints everything that is FIXED — the four filter chips
 * with their icons and names, the table and its column headers — and greys
 * only the measurements: counts, names, cells. Eight anonymous grey cards
 * here made the whole screen read as "nothing yet" when most of it was
 * already known (the same rule as the home page's skeleton). */
export function LiveClassSkeleton() {
  const { t } = useI18n()
  return (
    <section className="tch-liveClass" aria-hidden="true">
      <div className="tch-livePulse">
        <div className="tch-livePulse__segs">
          {(['hand', 'lesson', 'elsewhere', 'offline'] as const).map((key) => (
            /* Inert spans, not disabled buttons — nothing looks pressable
               before it is. Only each chip's count is still a question. */
            <span key={key} className={`tch-liveKpi tch-liveKpi--${key}`}>
              <Icon name={KPI_ICON[key]} size={15} aria-hidden />
              <Skeleton w={18} h={16} r={4} />
              <span className="tch-liveKpi__label">{t(`tch.liveView.kpi.${key}`)}</span>
            </span>
          ))}
        </div>
        {/* Two gauge stand-ins at the row's end, in the real gauges' shapes —
            the arc and its label — so the strip neither grows nor reflows
            when the class's subject split lands. */}
        <div className="tch-livePulse__gauges">
          {[0, 1].map((index) => (
            <span key={index} className="tch-gauge">
              <Skeleton w={60} h={30} r={8} />
              <Skeleton w={44} h={9} />
            </span>
          ))}
        </div>
      </div>
      <div className="tch-liveTable">
        <div className="tch-liveHead">
          <span className="tch-liveHead__cell">{t('tch.liveView.col.student')}</span>
          <span className="tch-liveHead__cell">{t('tch.liveView.col.feeling')}</span>
          <span className="tch-liveHead__cell">{t('tch.liveView.col.where')}</span>
          <span className="tch-liveHead__cell">{t('tch.liveView.col.subject')}</span>
          <span className="tch-liveHead__cell">{t('tch.liveView.col.objective')}</span>
          <span className="tch-liveHead__cell tch-liveHead__cell--actions" />
        </div>
        <ul className="tch-liveRows">
          {Array.from({ length: 8 }, (_, index) => (
            <li key={index} className="tch-liveRow">
              <div className="tch-liveRow__main">
                <span className="tch-liveRow__who">
                  <Skeleton w={34} h={34} r={999} />
                  <Skeleton w={index % 3 === 1 ? 96 : 72} h={12} />
                </span>
                <span className="tch-liveRow__feeling"><Skeleton w={22} h={22} r={999} /></span>
                <span><Skeleton w={90} h={12} /></span>
                <span><Skeleton w={64} h={16} r={999} /></span>
                <span><Skeleton w="70%" h={12} /></span>
                <span className="tch-liveRow__do">
                  <Skeleton w={30} h={30} r={8} />
                  <Skeleton w={30} h={30} r={8} />
                </span>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

export function LiveClassView({
  rows, presence, focusOf, isConnected, groupId, onFocusChanged,
}: LiveClassViewProps) {
  const { t } = useI18n()
  /* ONE clock for the whole view. Durations tick, ago-labels roll over, quiet
     signals appear — all from this, so no two cells disagree on what time it
     is. 1s keeps the "כבר X דק׳" column honest at the minute boundary. */
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const handle = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(handle)
  }, [])

  /* Momentary filters. Not preferences, not URL state: a glance-question
     ("who has a hand up?") pressed and released. Both compose with the
     sub-group scope, which the parent already applied to `rows`. */
  const [bucket, setBucket] = useState<keyof LiveCounts | null>(null)
  const [objective, setObjective] = useState<string | null>(null)
  /* The column filters: same momentary spirit, but living where the data
     lives — on the table headers, like any grown-up grid. */
  const [whereFilter, setWhereFilter] = useState<Where | null>(null)
  const [subjectFilter, setSubjectFilter] = useState<string | null>(null)
  /* The in-list name search (#504): the top-bar search is for reaching any
     child anywhere; this one narrows the rows in front of the teacher's eyes. */
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<{ kind: 'message' | 'focus'; learnerId: string } | null>(null)

  /* The raised hand's clear path, brought to the row: the provider holds the
     open coach_handoff alerts; resolving one lowers the hand on the child's
     screen-facing state too (the server clears `help_requested_at`). */
  const { openAlerts, resolve } = useTeacherLive()
  const handAlertOf = useMemo(() => {
    const map: Record<string, string> = {}
    for (const alert of openAlerts) {
      if (alert.kind === 'coach_handoff' && !(alert.learner_id in map)) {
        map[alert.learner_id] = alert._id
      }
    }
    return map
  }, [openAlerts])

  const presenceOf = (learnerId: string) => presence[learnerId] ?? BLANK_PRESENCE
  const inScopeFrames = useMemo(
    () => rows.map((row) => presenceOf(row.learner_id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, presence])

  const counts = useMemo(() => liveCounts(inScopeFrames, now), [inScopeFrames, now])
  const spread = useMemo(() => spreadByObjective(inScopeFrames, now), [inScopeFrames, now])

  /* The class divided across subjects by planner focus — the gauges. Counted
     over the rows in scope so a sub-group narrows this along with everything
     else on the screen. */
  const subjectShares = useMemo(() => {
    const bySubject = new Map<string, { key: string; label: string; count: number }>()
    for (const row of rows) {
      const focus = focusOf[row.learner_id]
      if (!focus?.subject) continue
      const held = bySubject.get(focus.subject)
      if (held) held.count += 1
      else {
        bySubject.set(focus.subject, {
          key: focus.subject, label: focus.subject_name || focus.subject, count: 1,
        })
      }
    }
    return [...bySubject.values()].sort((a, b) => b.count - a.count)
  }, [rows, focusOf])

  /* What each column filter offers: the distinct values actually present in
     scope, each with its count — a menu entry with a zero is a lie about the
     class in front of you. */
  const whereOptions = useMemo(() => {
    const tally = new Map<Where, number>()
    for (const frame of inScopeFrames) {
      const where = whereOf(frame, now)
      tally.set(where, (tally.get(where) ?? 0) + 1)
    }
    return WHERE_ORDER.filter((where) => tally.has(where)).map((where) => ({
      id: where as string,
      label: t(`tch.liveView.where.${where}`),
      count: tally.get(where) ?? 0,
      hue: WHERE_HUE[where] ?? null,
    }))
  }, [inScopeFrames, now, t])

  const subjectOptions = useMemo(() => {
    const tally = new Map<string, { label: string; count: number }>()
    for (const row of rows) {
      const frame = presenceOf(row.learner_id)
      const subject = subjectOf(frame, focusOf[row.learner_id], whereOf(frame, now), t)
      if (!subject) continue
      const held = tally.get(subject.key)
      if (held) held.count += 1
      else tally.set(subject.key, { label: subject.label, count: 1 })
    }
    return [...tally.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .map(([key, value]) => ({ id: key, label: value.label, count: value.count, hue: hueOf(key) }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, presence, focusOf, now, t])

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const filtered = rows.filter((row) => {
      if (needle && !row.name.toLowerCase().includes(needle)) return false
      const frame = presenceOf(row.learner_id)
      const where = whereOf(frame, now)
      if (bucket && !inBucket(frame, bucket, now)) return false
      if (objective && !(where === 'lesson' && frame.objective_id === objective)) return false
      if (whereFilter && where !== whereFilter) return false
      if (subjectFilter
          && subjectOf(frame, focusOf[row.learner_id], where, t)?.key !== subjectFilter) {
        return false
      }
      return true
    })
    return triageOrder(filtered, presenceOf, now)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, presence, focusOf, bucket, objective, whereFilter, subjectFilter, query, now, t])

  const anyFilter = Boolean(bucket || objective || whereFilter || subjectFilter
    || query.trim())
  const clearFilters = () => {
    setBucket(null); setObjective(null); setWhereFilter(null); setSubjectFilter(null)
    setQuery('')
  }

  return (
    <section className="tch-liveClass" aria-label={t('tch.liveView.title')}>
      {/* The honesty label only when it has news: live is this screen's normal
          state, and a standing "עדכון חי" chip was one more thing to read on
          every visit. Losing the feed is the exception worth a line. */}
      {!isConnected && (
        <div className="tch-liveBar">
          <span className="tch-liveBar__conn" role="status">
            <span className="tch-liveBar__connDot" aria-hidden="true" />
            {t('tch.live.reconnecting')}
          </span>
        </div>
      )}

      {/* ONE card, three questions: who needs me, where is everyone, and what
          is the class focused on. Every count is a momentary filter; the
          gauges draw the planner's division of the class across subjects. */}
      <div
        className="tch-livePulse"
        role="group"
        aria-label={t('tch.liveView.kpiLabel')}
        data-tour="teacher.liveNow"
      >
        {/* One flat row of four chips, no headings, no clusters: hand first
            (the urgent one — it alone may go hot), then the three places a
            child can be. The struggling count left the strip with the row
            signal it duplicated; strugglers still wear their amber row edge. */}
        <div className="tch-livePulse__segs">
          {(['hand', 'lesson', 'elsewhere', 'offline'] as const).map((key) => (
            <KpiSegment key={key} bucket={key} counts={counts} active={bucket}
                        hot={key === 'hand' && counts.hand > 0} onPick={setBucket} t={t} />
          ))}
        </div>
        {subjectShares.length > 0 && (
          <div className="tch-livePulse__gauges"
               role="group" aria-label={t('tch.liveView.classFocus')}>
            {subjectShares.map((share) => (
              <SubjectGauge key={share.key} label={share.label} hue={hueOf(share.key)}
                            count={share.count} total={rows.length} />
            ))}
          </div>
        )}
      </div>

      {spread.length > 0 && (
        <div className="tch-liveSpread" role="group" aria-label={t('tch.liveView.spread')}>
          <span className="tch-liveSpread__label">{t('tch.liveView.spread')}</span>
          {spread.map((cluster) => (
            <button
              key={cluster.objective_id}
              type="button"
              className={`sp-btn sp-btn--pill sp-btn--sm${
                objective === cluster.objective_id ? ' is-active' : ''}`}
              aria-pressed={objective === cluster.objective_id}
              onClick={() => setObjective((current) =>
                current === cluster.objective_id ? null : cluster.objective_id)}
            >
              <span dir="auto">{cluster.title || t('tch.liveView.spread.unnamed')}</span>
              <span className="tch-liveSpread__count">{cluster.count}</span>
              {objective === cluster.objective_id && (
                <span className="tch-chipOff" aria-hidden="true"><Icon name="close" size={12} /></span>
              )}
            </button>
          ))}
        </div>
      )}

      {anyFilter && (
        <p className="tch-liveClass__filterNote" role="status">
          {t('tch.liveView.filtered', { count: visible.length })}
          <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm"
                  onClick={clearFilters}>
            {t('tch.liveView.filter.clear')}
          </button>
        </p>
      )}

      {/* The rows are a table now: named columns, and the two whose values
          repeat (place, subject) filter from their own header. The header
          stays up when a filter empties the list — it holds the way back. */}
      <div className="tch-liveTable">
        <div className="tch-liveHead">
          <label className="tch-liveHead__cell tch-liveHead__search">
            <Icon name="search" size={13} aria-hidden />
            <span className="sp-sr-only">{t('tch.students.searchLabel')}</span>
            <input
              type="search"
              value={query}
              placeholder={t('tch.liveView.col.student')}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <span className="tch-liveHead__cell">{t('tch.liveView.col.feeling')}</span>
          <HeadFilter label={t('tch.liveView.col.where')} options={whereOptions}
                      value={whereFilter}
                      onChange={(id) => setWhereFilter(id as Where | null)} t={t} />
          <HeadFilter label={t('tch.liveView.col.subject')} options={subjectOptions}
                      value={subjectFilter} onChange={setSubjectFilter} t={t} />
          <span className="tch-liveHead__cell">{t('tch.liveView.col.objective')}</span>
          <span className="tch-liveHead__cell tch-liveHead__cell--actions">
            <span className="sp-sr-only">{t('tch.liveView.col.actions')}</span>
          </span>
        </div>
        {visible.length === 0 ? (
          <EmptyState title={t(anyFilter ? 'tch.liveView.emptyFiltered' : 'tch.liveView.empty')} />
        ) : (
          <ul className="tch-liveRows">
            {visible.map((row) => (
              <LiveRow
                key={row.learner_id}
                row={row}
                frame={presenceOf(row.learner_id)}
                focus={focusOf[row.learner_id]}
                now={now}
                groupId={groupId}
                open={open?.learnerId === row.learner_id ? open.kind : null}
                onOpen={(kind) => setOpen((current) => (
                  current?.learnerId === row.learner_id && current.kind === kind
                    ? null : kind && { kind, learnerId: row.learner_id }
                ))}
                onFocusChanged={onFocusChanged}
                onResolveHand={handAlertOf[row.learner_id]
                  ? () => void resolve(handAlertOf[row.learner_id])
                  : null}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

/* ── a header cell that filters its own column ────────────────────────────── */

interface FilterOption {
  id: string
  label: string
  count: number
  hue: number | null
}

function HeadFilter({ label, options, value, onChange, t }: {
  label: string
  options: FilterOption[]
  value: string | null
  onChange: (id: string | null) => void
  t: Translate
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const cellRef = useRef<HTMLSpanElement | null>(null)
  useDismiss(cellRef, menuOpen, () => setMenuOpen(false))
  const active = options.find((option) => option.id === value)

  return (
    <span className={`tch-liveHead__cell tch-liveHead__filter${value ? ' is-filtered' : ''}`}
          ref={cellRef}>
      <button
        type="button"
        className="tch-liveHead__filterBtn"
        aria-expanded={menuOpen}
        aria-label={t('tch.liveView.filter.colHint', { col: label })}
        onClick={() => setMenuOpen((current) => !current)}
      >
        {active ? `${label}: ${active.label}` : label}
        <Icon name="chevronDown" size={12} aria-hidden />
      </button>
      {menuOpen && (
        <span className="tch-liveHead__menu">
          <button type="button" aria-pressed={value === null}
                  onClick={() => { onChange(null); setMenuOpen(false) }}>
            {t('tch.liveView.filter.all')}
          </button>
          {options.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={value === option.id}
              onClick={() => {
                onChange(value === option.id ? null : option.id)
                setMenuOpen(false)
              }}
            >
              <span className={`tch-liveChip is-hue-${option.hue ?? 'none'}`} dir="auto">
                {option.label}
              </span>
              <span className="tch-liveHead__optCount">{option.count}</span>
            </button>
          ))}
        </span>
      )}
    </span>
  )
}

/* ── one child ────────────────────────────────────────────────────────────── */

interface LiveRowProps {
  row: LiveRowData
  frame: Presence
  focus: LearnerFocus | undefined
  now: number
  groupId: string | null
  open: 'message' | 'focus' | null
  onOpen: (kind: 'message' | 'focus' | null) => void
  onFocusChanged: () => void
  /** Resolves this child's open hand alert, when one exists. */
  onResolveHand: (() => void) | null
}

function LiveRow({
  row, frame, focus, now, groupId, open, onOpen, onFocusChanged, onResolveHand,
}: LiveRowProps) {
  const { t } = useI18n()
  const where = whereOf(frame, now)
  const signal = signalOf(frame, now)
  /* A lesson-page chip wears the lesson green: it counts under the lesson KPI
     (see `countsAsLesson`), and a chip colored "elsewhere" beside a KPI that
     counts it as lesson would read as the screen disagreeing with itself. */
  const whereHue = where === 'browsing' && frame.surface_screen === 'learning_lesson'
    ? WHERE_HUE.lesson : WHERE_HUE[where]

  /* Subject and objective are their own columns. In a lesson both come from
     the live frame, first-hand, and the objective reads live (primary).
     Anywhere else they say where the PLANNER is pointing this child — the
     class-wide "מיקוד" — muted, with the pin when a teacher set it. */
  const subject = subjectOf(frame, focus, where, t)
  const liveTitle = where === 'lesson'
    ? [frame.unit_title, frame.objective_title].filter(Boolean).join(' · ')
    : ''
  const objectiveCell = liveTitle
    ? { label: liveTitle, live: true, pinned: false }
    : focus?.objective_title
      ? { label: focus.objective_title, live: false, pinned: Boolean(focus.pinned) }
      : null

  return (
    <li className={`tch-liveRow is-${where}${signal ? ` has-${signal.kind}` : ''}`}>
      <div className="tch-liveRow__main">
        <button
          type="button"
          className="tch-liveRow__who"
          onClick={() => navigate(`/teacher/student/${row.learner_id}`)}
        >
          <StudentAvatar learnerId={row.learner_id} name={row.name} size={34} />
          <span className="tch-liveRow__name" dir="auto">{row.name}</span>
        </button>

        {/* Today's check-in feeling (#452), a column of its own: just the
            face — the word rides the app tooltip (a native `title` is too
            slow to ever be seen). A child who has not answered yet wears the
            dashed empty face, never a blank cell. */}
        <span className="tch-liveRow__feeling">
          {focus?.feeling && VALENCES.includes(focus.feeling.valence as Valence) ? (
            <Hint text={t(`checkin.feeling.${focus.feeling.feeling}`)}>
              <span className={`tch-liveRow__mood is-${focus.feeling.valence}`}>
                <ValenceFace valence={focus.feeling.valence as Valence} size={22} />
              </span>
            </Hint>
          ) : (
            <Hint text={t('tch.liveView.noFeeling')}>
              <span className="tch-liveRow__mood is-none">
                <NoFeelingFace size={22} />
              </span>
            </Hint>
          )}
        </span>

        <span className="tch-liveRow__where">
          <span className="tch-liveRow__place">
            <span className={`tch-dot tch-dot--${frame.status}`} aria-hidden="true">
              <span className="tch-dot__mark" />
            </span>
            {/* No chip for the offline majority: a grey dot, a dimmed row and
                "לפני 7 ימים" already say it, and forty "לא מחובר/ת" chips were
                the loudest thing on the table. A child who IS somewhere gets
                the place named; `unknown` keeps its label too — the honesty
                rule that an unplaceable child is said, not blanked. */}
            {where !== 'offline' && (
              <span className={`tch-liveChip is-hue-${whereHue ?? 'none'}`} dir="auto"
                    title={whereLabel(frame, where, t)}>
                {whereLabel(frame, where, t)}
              </span>
            )}
            {/* A time only where the dot would otherwise stand bare: last seen,
                on the rows that are not live anywhere. A placed child's chip is
                the whole answer — the "כבר X דק׳" duration beside it read as a
                second clock and is gone. */}
            {(where === 'offline' || where === 'unknown') && (
              <span className="tch-liveRow__seen">
                {agoLabel(frame.last_seen_at, t)}
              </span>
            )}
          </span>
          {/* The signal rides with the place — it stopped being a column of
              its own because it is empty for most rows most of the time. */}
          <SignalCell signal={signal} onResolveHand={onResolveHand} t={t} />
        </span>

        <span className="tch-liveRow__subject">
          {subject ? (
            <span className={`tch-liveChip is-hue-${hueOf(subject.key)}`} dir="auto">
              {subject.label}
            </span>
          ) : (
            <span className="tch-liveRow__blank" aria-hidden="true">—</span>
          )}
        </span>

        <span className="tch-liveRow__objective" dir="auto">
          {objectiveCell ? (
            <span className={objectiveCell.live
              ? 'tch-liveRow__objLive' : 'tch-liveRow__objFocus'}>
              {objectiveCell.pinned && <Icon name="target" size={12} aria-hidden />}
              {objectiveCell.label}
            </span>
          ) : (
            <span className="tch-liveRow__blank" aria-hidden="true">—</span>
          )}
        </span>

        {/* Icon-only, like the gaps card's row actions: two worded buttons on
            every one of forty rows were half the table's text. The names live
            on hover/focus and aria-label. */}
        <span className="tch-liveRow__do">
          <Hint text={t('tch.liveView.act.message')}>
            <button
              type="button"
              className={`sp-btn sp-btn--ghost sp-btn--sm tch-liveRow__iconBtn${
                open === 'message' ? ' is-active' : ''}`}
              aria-expanded={open === 'message'}
              aria-label={t('tch.liveView.act.message')}
              onClick={() => onOpen('message')}
            >
              <Icon name="message" size={15} aria-hidden />
            </button>
          </Hint>
          <Hint text={t('tch.liveView.act.focus')}>
            <button
              type="button"
              className={`sp-btn sp-btn--ghost sp-btn--sm tch-liveRow__iconBtn${
                open === 'focus' ? ' is-active' : ''}`}
              aria-expanded={open === 'focus'}
              aria-label={t('tch.liveView.act.focus')}
              onClick={() => onOpen('focus')}
            >
              <Icon name="target" size={15} aria-hidden />
            </button>
          </Hint>
        </span>
      </div>

      {open === 'message' && (
        <MessagePanel learnerId={row.learner_id} name={row.name} onClose={() => onOpen(null)} />
      )}
      {/* The pin dialog floats over the table (#244 follow-up): inline it
          pushed the roster apart and read as more rows. The shared Modal owns
          dismissal and borrows the panel's heading as its title. */}
      {open === 'focus' && (
        <Modal open onClose={() => onOpen(null)} titleId="tch-focus-panel-title"
               className="tch-focusModal">
          <FocusPanel learnerId={row.learner_id} groupId={groupId}
                      onChanged={onFocusChanged} />
        </Modal>
      )}
    </li>
  )
}

function SignalCell({ signal, onResolveHand, t }: {
  signal: Signal
  onResolveHand: (() => void) | null
  t: Translate
}) {
  if (!signal) return null
  if (signal.kind === 'hand') {
    /* One chip carries the whole state: the hand, its age, and its clear
       path — the same verb as the alert lane. Resolving here lowers the
       alert on Home and the hand on this row; they are one state. */
    return (
      <span className="tch-handChip">
        <Icon name="hand" size={12} aria-hidden />
        <span className="tch-handChip__text">
          {t('tch.liveView.signal.hand')} · {agoLabel(signal.since, t)}
        </span>
        {onResolveHand && (
          <button type="button" className="tch-handChip__done" onClick={onResolveHand}
                  title={t('tch.alert.resolveHint')}>
            <Icon name="check" size={12} aria-hidden />
            {t('tch.alert.resolve')}
          </button>
        )}
      </span>
    )
  }
  if (signal.kind === 'quiet') {
    return (
      <span className="tch-liveRow__quiet">
        {t('tch.liveView.signal.quiet')} · {agoLabel(signal.since, t)}
      </span>
    )
  }
  /* Struggling draws NO text here any more — the pill, its clock and the
     "למה?" disclosure were the busiest thing on the table. The row's amber
     start edge (`has-struggling`) still marks the child, and the full story
     lives on their profile. */
  return null
}

/* ── row actions ──────────────────────────────────────────────────────────── */

function MessagePanel({ learnerId, name, onClose }: {
  learnerId: string; name: string; onClose: () => void
}) {
  const { t, language } = useI18n()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [errorKey, setErrorKey] = useState<string | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  useDismiss(panelRef, true, onClose)

  async function submit() {
    const body = text.trim()
    if (!body || busy) return
    setBusy(true)
    setErrorKey(null)
    try {
      await sendMessage(learnerId, body, language)
      setSent(true)
      setText('')
      window.setTimeout(onClose, 1200)
    } catch (error) {
      // The moderation refusal carries its own locale key; anything else is
      // the network's fault, said as such.
      setErrorKey(error instanceof MessageRefused
        ? (error.key || 'moderation.default') : 'tch.liveView.msg.failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="tch-liveRow__panel" ref={panelRef}>
      <label className="sp-sr-only" htmlFor={`live-msg-${learnerId}`}>
        {t('tch.liveView.msg.title', { name })}
      </label>
      <input
        id={`live-msg-${learnerId}`}
        className="sp-input"
        type="text"
        value={text}
        placeholder={t('tch.liveView.msg.title', { name })}
        maxLength={400}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Enter') void submit() }}
        // eslint-disable-next-line jsx-a11y/no-autofocus
        autoFocus
      />
      <button type="button" className="sp-btn sp-btn--sm" disabled={busy || !text.trim()}
              onClick={() => void submit()}>
        {t('tch.liveView.msg.send')}
      </button>
      {sent && <p role="status" className="tch-liveRow__panelNote">{t('tch.liveView.msg.sent')}</p>}
      {errorKey && (
        <p role="status" className="tch-liveRow__panelNote is-error">{t(errorKey)}</p>
      )}
    </div>
  )
}
