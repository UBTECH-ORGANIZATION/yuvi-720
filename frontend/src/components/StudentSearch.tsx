/* Any child's profile, from anywhere in the portal.
 *
 * The roster provider already holds every learner this teacher teaches, across
 * every class, with names and avatars — so the search is entirely client-side:
 * no endpoint, no debounce, no spinner. What the trigger costs the bar is one
 * 36px icon button; the input lives in a floating panel underneath it, because
 * the bar itself has no width to give — the scope segments and the navigation
 * already meet at 1310px, and an inline input would push the fold past what a
 * 1440px laptop can show.
 *
 * The list is three rows, always. Typing ranks by how the query sits in the
 * name (start of the name, start of a word, anywhere), and an empty input
 * shows the students this teacher looks up most — the point of the feature is
 * the child a teacher keeps returning to, and for them the answer should be
 * on screen before a single letter is typed.
 *
 * Picking a child from ANOTHER class moves the scope's class with the
 * navigation. The scope contract says the bar and the page must never describe
 * different people — landing on a profile while the bar still names the old
 * class would do exactly that. (`setGroupId` also clears the sub-group, which
 * is right: the old sub-group means nothing in the new class.)
 */

import { useMemo, useRef, useState } from 'react'
import { navigate } from '../app/router'
import { StudentAvatar } from '../features/teacher-app/shared/StudentAvatar'
import { useDismiss } from '../features/teacher-app/shared/useDismiss'
import { useI18n } from '../i18n/I18nProvider'
import { useAuth } from '../providers/AuthProvider'
import { useTeacherRoster } from '../providers/TeacherRosterProvider'
import { useTeacherScope } from '../providers/TeacherScopeProvider'
import type { RosterEntry } from '../services/teacher'
import { Icon } from './primitives'
import './student-search.css'

/** The dropdown never grows past this — a picker, not a roster. */
const MAX_ROWS = 3

/* ── who this teacher looks up ────────────────────────────────────────────────
   Per-browser convenience, so localStorage rather than the user document: the
   scope keys earned a preference because they change what every screen SHOWS;
   this only orders three suggestions. Keyed by user id — two teachers sharing
   a classroom machine must not see each other's children suggested. Every
   touch is wrapped: private windows and cleared site data make the accessor
   itself throw, and the search must simply start blank there. */

interface SearchHit { id: string; count: number; at: number }

const storageKey = (userId: string) => `sp:tch-student-search:${userId}`

function readHits(userId: string): SearchHit[] {
  try {
    const raw = window.localStorage.getItem(storageKey(userId))
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((row) => typeof row?.id === 'string') : []
  } catch {
    return []
  }
}

function recordHit(userId: string, learnerId: string): SearchHit[] {
  const hits = readHits(userId)
  const found = hits.find((row) => row.id === learnerId)
  const next = found
    ? hits.map((row) => row === found ? { ...row, count: row.count + 1, at: Date.now() } : row)
    : [...hits, { id: learnerId, count: 1, at: Date.now() }]
  // Most-picked first; recency only breaks ties. Capped so a year of use
  // cannot grow the entry unboundedly.
  next.sort((a, b) => b.count - a.count || b.at - a.at)
  const kept = next.slice(0, 20)
  try { window.localStorage.setItem(storageKey(userId), JSON.stringify(kept)) } catch { /* full or blocked */ }
  return kept
}

/** Where the query sits in the name: 0 start, 1 word start, 2 anywhere. */
function matchRank(name: string, query: string): number | null {
  const folded = name.toLocaleLowerCase()
  if (folded.startsWith(query)) return 0
  if (folded.split(/\s+/).some((word) => word.startsWith(query))) return 1
  if (folded.includes(query)) return 2
  return null
}

export function StudentSearch() {
  const { t } = useI18n()
  const { user } = useAuth()
  const { students, isLoading } = useTeacherRoster()
  const { groups, groupId, setGroupId } = useTeacherScope()

  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')
  const [active, setActive] = useState(0)
  /* Read once per open, not per keystroke — the list only changes on a pick,
     and a pick writes through this same state. */
  const [hits, setHits] = useState<SearchHit[]>([])

  const wrapper = useRef<HTMLDivElement>(null)
  useDismiss(wrapper, open, () => setOpen(false))

  const groupNames = useMemo(
    () => new Map(groups.map((row) => [row.id, row.name])), [groups])

  const query = value.trim().toLocaleLowerCase()

  const results = useMemo<RosterEntry[]>(() => {
    if (!query) {
      /* Nothing typed: the children this teacher looks up most, in that order.
         Mapped through the live roster so a learner who left the school simply
         stops being suggested. */
      const byId = new Map(students.map((row) => [row.learner_id, row]))
      return hits
        .map((hit) => byId.get(hit.id))
        .filter((row): row is RosterEntry => Boolean(row))
        .slice(0, MAX_ROWS)
    }
    const counts = new Map(hits.map((hit) => [hit.id, hit.count]))
    return students
      .map((row) => ({ row, rank: matchRank(row.display_name ?? row.learner_id, query) }))
      .filter((entry): entry is { row: RosterEntry; rank: number } => entry.rank !== null)
      .sort((a, b) =>
        a.rank - b.rank
        /* Equal placement: the child this teacher picks more often first. */
        || (counts.get(b.row.learner_id) ?? 0) - (counts.get(a.row.learner_id) ?? 0)
        || (a.row.display_name ?? a.row.learner_id)
             .localeCompare(b.row.display_name ?? b.row.learner_id))
      .slice(0, MAX_ROWS)
      .map((entry) => entry.row)
  }, [students, hits, query])

  /* While the roster is in flight, hold the trigger's place the way the scope
     segments hold theirs (`tch-scope__seg--pending`) — a labeled button that
     pops into a settled bar a second after it reads as chrome rearranging
     itself. Width is the rendered trigger's, not a guess. */
  if (isLoading) {
    return (
      <span className="tch-search__btn tch-search__btn--pending"
            style={{ inlineSize: 118 }} aria-hidden />
    )
  }

  /* No students at all (a brand-new teacher, or the roster failed): a search
     over nothing is a button that can only disappoint. */
  if (students.length === 0) return null

  const toggle = () => {
    if (!open && user) setHits(readHits(user.user_id))
    setValue('')
    setActive(0)
    setOpen((on) => !on)
  }

  const pick = (entry: RosterEntry) => {
    if (user) setHits(recordHit(user.user_id, entry.learner_id))
    setOpen(false)
    setValue('')
    /* The scope contract: the bar must name the class the profile belongs to. */
    if (entry.group_id && entry.group_id !== groupId) setGroupId(entry.group_id)
    navigate(`/teacher/student/${entry.learner_id}`)
  }

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') { setOpen(false); return }
    if (results.length === 0) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((index) => (index + 1) % results.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((index) => (index - 1 + results.length) % results.length)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      pick(results[Math.min(active, results.length - 1)])
    }
  }

  return (
    <div className="tch-search" ref={wrapper}>
      <button
        type="button"
        className="tch-search__btn"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={t('tch.search.label')}
        title={t('tch.search.label')}
        onClick={toggle}
      >
        <Icon name="search" size={16} />
        {/* The word, not only the glyph — a lone magnifier beside a lone bell
            is chrome a teacher has to guess at. */}
        <span>{t('tch.search.trigger')}</span>
      </button>

      {open && (
        <div className="tch-search__panel" role="dialog" aria-label={t('tch.search.label')}>
          <div className="tch-search__field">
            <Icon name="search" size={15} aria-hidden className="tch-search__fieldIcon" />
            <input
              /* eslint-disable-next-line jsx-a11y/no-autofocus -- the panel
                 only exists because the teacher just asked to type */
              autoFocus
              role="combobox"
              aria-expanded={results.length > 0}
              aria-controls="tch-search-list"
              aria-activedescendant={results.length ? `tch-search-opt-${active}` : undefined}
              aria-autocomplete="list"
              placeholder={t('tch.search.placeholder')}
              dir="auto"
              value={value}
              onChange={(event) => { setValue(event.target.value); setActive(0) }}
              onKeyDown={onKeyDown}
            />
          </div>

          {/* Say WHY these three, or an empty box suggests three random
              children. Only over history — typed results explain themselves. */}
          {!query && results.length > 0 && (
            <p className="tch-search__hint">{t('tch.search.recent')}</p>
          )}

          <ul id="tch-search-list" role="listbox" className="tch-search__list"
              aria-label={t('tch.search.label')}>
            {results.map((row, index) => (
              <li
                key={row.learner_id}
                id={`tch-search-opt-${index}`}
                role="option"
                aria-selected={index === active}
                className={`tch-search__row${index === active ? ' is-active' : ''}`}
                onMouseEnter={() => setActive(index)}
                onClick={() => pick(row)}
              >
                <StudentAvatar learnerId={row.learner_id} name={row.display_name}
                               size={28} choice={row.avatar ?? null} />
                <span className="tch-search__name" dir="auto">
                  {row.display_name ?? row.learner_id}
                </span>
                {/* The class, because the list crosses classes: two children
                    named נועה in two classes are told apart by nothing else. */}
                <span className="tch-search__group" dir="auto">
                  {groupNames.get(row.group_id) ?? ''}
                </span>
              </li>
            ))}
          </ul>

          {query && results.length === 0 && (
            <p className="tch-search__none">{t('tch.search.noResults')}</p>
          )}
        </div>
      )}
    </div>
  )
}
