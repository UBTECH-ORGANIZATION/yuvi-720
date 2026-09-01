/* The difficulties-and-actions card (#455): what was hard, WHO found it hard,
 * and what to do about it — with the evidence behind every claim (MoE C4).
 *
 * Shared on purpose: this same card is the class-wide sub-group-suggestion
 * surface of the dashboard refactor (#450) — same row shape, same evidence
 * panel, same two actions; only the scope differs (one lomda's hard questions
 * here, class-wide objective gaps there). All data resolution stays in the
 * caller: rows arrive with their titles, members and seeds already made, so
 * the card never fetches and never invents.
 *
 * The "who" is a selection, never a ranking — faces in roster order, no
 * metric beside any of them (`StudentFacepile`'s own contract). Ids never
 * appear in visible text (the phase7 rule).
 */

import type { ReactNode } from 'react'
import { Hint, Icon, Panel, SectionHeader, Tooltip } from '../../../components/primitives'
import { useI18n } from '../../../i18n/I18nProvider'
import type { GapDiagnosis } from '../../../services/teacher'
import type { TaskSeed } from '../tasks/taskSeed'
import { EvidenceToggle } from './EvidenceDisclosure'
import { subjectLabel } from './subjectLabel'
import { StudentFacepile } from './StudentFacepile'
import { DiagnosisToggle } from './WhyDiagnosis'

export interface DifficultyItem {
  /** Row key — a question key here, an objective id for #450. Never shown. */
  id: string
  /** The difficulty's name, already resolved (topic or honest fallback). */
  title: string
  /** Where it lives — screen title, objective title. */
  subtitle?: string | null
  /** The exact source under the title (question text), on hover/focus. */
  tooltip?: ReactNode
  /** Raw subject key for the row's corner tag ("math", "science"). The card
   *  localises it — the caller has no business knowing the label. */
  subjectLabel?: string | null
  /** Who this is about. Roster order; a selection, never a ranking. */
  learnerIds: string[]
  /** The raw data behind the claim, for the why-toggle. */
  evidence: Record<string, unknown>
  /** A ready task-builder seed for these learners on this material. */
  seed: TaskSeed
  /** Suggested name for a sub-group made of these learners. */
  subgroupName: string
}

/** A topic the class has, on the whole, got — the other half of the same
 *  picture. No fix-list, because there is nothing to fix; the action here is
 *  to say so to the children who got there. */
export interface StrengthItem {
  id: string
  title: string
  learnerIds: string[]
  /** Raw subject key for the corner tag, as on a difficulty row. */
  subjectLabel?: string | null
  /** True when a difficulty in the SAME card carries this title.
   *
   *  It looks like a contradiction and is not: an objective can be both, and
   *  when it is, the two rows are about DIFFERENT children — one set is stuck
   *  on it, another set has it. Unlabelled, a teacher reads the repeat as a
   *  rendering bug and stops trusting the card, so the row says it outright. */
  alsoADifficulty?: boolean
}

export function DifficultiesCard({
  title, subtitle, items, names, emptyLabel, onBuildTask, onCreateSubgroup, className,
  strengths = [], strengthsTitle, strengthsHeading, itemsTitle, onPraise, loadWhy,
}: {
  title: string
  subtitle?: string
  items: DifficultyItem[]
  /** Names the caller already has; falls back to the portal roster inside. */
  names?: Map<string, string | null>
  /** What the card says when there is nothing to fix — silence reads as a gap. */
  emptyLabel: string
  onBuildTask: (seed: TaskSeed) => void
  onCreateSubgroup: (item: DifficultyItem) => void
  className?: string
  /* ── the other half ──────────────────────────────────────────────────────
     What the class has got, in the SAME card as what it has not, divided by a
     rule rather than split into two panels. They are one reading of one class
     and a teacher forms the judgement by comparing them; two cards made the
     strengths look like a separate, lesser feature sitting underneath — and
     left the difficulties card looking half-empty when a class had one gap. */
  strengths?: StrengthItem[]
  strengthsTitle?: string
  strengthsHeading?: string
  /** Heading for the difficulties column. Only meaningful beside strengths —
   *  with one column the card's own title already names what is in it. */
  itemsTitle?: string
  /** Say a good word to the children who got a topic, sparks optional (#467).
   *  Absent on surfaces with no messaging, and the button is then not drawn:
   *  a praise action that cannot send is worse than none. */
  onPraise?: (strength: StrengthItem) => void
  /** A deeper answer for "למה?" (#507), fetched on first open. The card still
   *  never fetches on its own — the caller injects the loader, and rows fall
   *  back to the plain raw-evidence toggle without one (the lomda screen's
   *  rows are questions, which have no objective-level diagnosis to load). */
  loadWhy?: (item: DifficultyItem) => Promise<GapDiagnosis | null>
}) {
  const { t } = useI18n()
  /* Two columns only when there is something to put in the second one. With no
     strengths the divider would be a rule down the side of an empty half. */
  const split = strengths.length > 0

  const difficulties = items.length ? (
        <ul className="tch-difficulties__list">
          {items.map((item) => (
            <li key={item.id} className="tch-difficulty">
              {/* Which subject this belongs to, at the row's corner. With the
                  class read across every subject at once, three rows of topic
                  names give no clue whether the teacher is looking at their own
                  lesson or someone else's. */}
              {item.subjectLabel ? (
                <span className="tch-difficulty__subject">
                  {subjectLabel(item.subjectLabel, t)}
                </span>
              ) : null}
              <div className="tch-difficulty__what">
                {item.tooltip ? (
                  <Tooltip
                    label={t('tch.learnings.diffSource')}
                    className="tch-difficulty__tip"
                    trigger={
                      <strong className="tch-difficulty__title" dir="auto">{item.title}</strong>
                    }
                  >
                    <span dir="auto">{item.tooltip}</span>
                  </Tooltip>
                ) : (
                  <strong className="tch-difficulty__title" dir="auto">{item.title}</strong>
                )}
                {item.subtitle ? (
                  <span className="tch-difficulty__where" dir="auto">{item.subtitle}</span>
                ) : null}
              </div>
              <div className="tch-difficulty__actions">
                <StudentFacepile
                  learnerIds={item.learnerIds}
                  names={names}
                  label={t('tch.learnings.diffWho')}
                  heading={t('tch.learnings.diffWho')}
                />
                {loadWhy
                  ? <DiagnosisToggle item={item} load={loadWhy} />
                  : <EvidenceToggle raw={item.evidence} />}
                {/* No one is currently stuck on it (everyone who tried got
                    there in the end) → a finding without a fix-list: the
                    evidence stays, the actions have nobody to act on. */}
                {/* Icon-only, each explaining itself on hover/focus: two
                    worded buttons on every row made the actions the loudest
                    text on the card, repeated once per gap. The name lives in
                    the tooltip and the aria-label — never dropped, just moved
                    off the scan path. */}
                {item.learnerIds.length > 0 ? (
                  <span className="tch-difficulty__quick">
                    <Hint text={t('tch.learnings.diffBuildTask')}>
                      <button
                        type="button"
                        className="sp-btn sp-btn--ghost sp-btn--sm tch-difficulty__iconBtn"
                        aria-label={t('tch.learnings.diffBuildTask')}
                        onClick={() => onBuildTask(item.seed)}
                      >
                        <Icon name="backpack" size={15} aria-hidden />
                      </button>
                    </Hint>
                    {/* A sub-group of one is not a group — a single stuck
                        learner gets a task, not an organisational unit. */}
                    {item.learnerIds.length >= 2 && (
                      <Hint text={t('tch.learnings.diffSubgroup')}>
                        <button
                          type="button"
                          className="sp-btn sp-btn--ghost sp-btn--sm tch-difficulty__iconBtn"
                          aria-label={t('tch.learnings.diffSubgroup')}
                          onClick={() => onCreateSubgroup(item)}
                        >
                          <Icon name="users" size={15} aria-hidden />
                        </button>
                      </Hint>
                    )}
                  </span>
                ) : (
                  <span className="tch-difficulty__resolved">
                    {t('tch.learnings.diffResolved')}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
  ) : (
        <p className="tch-difficulties__empty">{emptyLabel}</p>
  )

  /* The other half of the same reading, as cards down the far column.
     Not a second panel and not a list filed underneath: a teacher decides what
     to do by weighing what the class has against what it has not, and stacking
     one under the other made the strengths look like an appendix — and left
     the difficulties half of the card looking empty whenever a class had a
     single gap. Side by side, with a rule between, they are one picture. */
  const strengthsColumn = (
    <div className="tch-strengths">
      <h4 className="tch-strengths__title">{strengthsTitle}</h4>
      <ul className="tch-strengths__list">
        {strengths.map((strength) => (
          <li key={strength.id} className="tch-strength">
            {strength.subjectLabel ? (
              <span className="tch-difficulty__subject">
                {subjectLabel(strength.subjectLabel, t)}
              </span>
            ) : null}
            <bdi className="tch-strength__title" dir="auto">{strength.title}</bdi>
            {strength.alsoADifficulty ? (
              <span className="tch-strength__note">{t('tch.gaps.strength.alsoAGap')}</span>
            ) : null}
            <div className="tch-strength__row">
              <StudentFacepile
                learnerIds={strength.learnerIds}
                names={names}
                label={strengthsHeading ?? ''}
                heading={strengthsHeading ?? ''}
                size={20}
              />
              {/* The one action a strength deserves. A class that only ever
                  gets told what it got wrong learns that this card is bad
                  news; the sparks are optional and default to none, because
                  most good words should be just words (#467). */}
              {onPraise && strength.learnerIds.length > 0 ? (
                <button
                  type="button"
                  className="sp-btn sp-btn--ghost sp-btn--sm tch-strength__praise"
                  onClick={() => onPraise(strength)}
                >
                  {/* `spark` rather than a heart: there is no heart in the
                      set, and this is the same mark the album's good-word
                      button already wears. */}
                  <Icon name="spark" size={14} aria-hidden />
                  {t('tch.gaps.strength.praise')}
                </button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )

  return (
    <Panel className={[
      'tch-difficulties', split ? 'tch-difficulties--split' : '', className,
    ].filter(Boolean).join(' ')}>
      <SectionHeader title={title} subtitle={subtitle} />
      {split ? (
        <div className="tch-difficulties__cols">
          <div className="tch-difficulties__col">
            {itemsTitle ? <h4 className="tch-strengths__title">{itemsTitle}</h4> : null}
            {difficulties}
          </div>
          <div className="tch-difficulties__col">{strengthsColumn}</div>
        </div>
      ) : difficulties}
    </Panel>
  )
}
