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
import { Icon, Panel, SectionHeader, Tooltip } from '../../../components/primitives'
import { useI18n } from '../../../i18n/I18nProvider'
import type { TaskSeed } from '../tasks/taskSeed'
import { EvidenceToggle } from './EvidenceDisclosure'
import { StudentFacepile } from './StudentFacepile'

export interface DifficultyItem {
  /** Row key — a question key here, an objective id for #450. Never shown. */
  id: string
  /** The difficulty's name, already resolved (topic or honest fallback). */
  title: string
  /** Where it lives — screen title, objective title. */
  subtitle?: string | null
  /** The exact source under the title (question text), on hover/focus. */
  tooltip?: ReactNode
  /** Who this is about. Roster order; a selection, never a ranking. */
  learnerIds: string[]
  /** The raw data behind the claim, for the why-toggle. */
  evidence: Record<string, unknown>
  /** A ready task-builder seed for these learners on this material. */
  seed: TaskSeed
  /** Suggested name for a sub-group made of these learners. */
  subgroupName: string
}

export function DifficultiesCard({
  title, subtitle, items, names, emptyLabel, onBuildTask, onCreateSubgroup, className,
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
}) {
  const { t } = useI18n()
  return (
    <Panel className={['tch-difficulties', className].filter(Boolean).join(' ')}>
      <SectionHeader title={title} subtitle={subtitle} />
      {items.length ? (
        <ul className="tch-difficulties__list">
          {items.map((item) => (
            <li key={item.id} className="tch-difficulty">
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
                <EvidenceToggle raw={item.evidence} />
                {/* No one is currently stuck on it (everyone who tried got
                    there in the end) → a finding without a fix-list: the
                    evidence stays, the actions have nobody to act on. */}
                {item.learnerIds.length > 0 ? (
                  <>
                    <button
                      type="button"
                      className="sp-btn sp-btn--ghost sp-btn--sm"
                      onClick={() => onBuildTask(item.seed)}
                    >
                      <Icon name="backpack" size={14} aria-hidden />
                      {t('tch.learnings.diffBuildTask')}
                    </button>
                    {/* A sub-group of one is not a group — a single stuck
                        learner gets a task, not an organisational unit. */}
                    {item.learnerIds.length >= 2 && (
                      <button
                        type="button"
                        className="sp-btn sp-btn--ghost sp-btn--sm"
                        onClick={() => onCreateSubgroup(item)}
                      >
                        <Icon name="users" size={14} aria-hidden />
                        {t('tch.learnings.diffSubgroup')}
                      </button>
                    )}
                  </>
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
      )}
    </Panel>
  )
}
