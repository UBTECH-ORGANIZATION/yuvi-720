/* Gap rows → the shared DifficultiesCard's shape (#450).
 *
 * The card was built for exactly this (its header names #450): same row, same
 * evidence panel, same two actions as the lomda screen — only the scope
 * differs (class-wide objective gaps here, one lomda's questions there). All
 * resolution happens in this mapper so the card keeps never fetching.
 */

import type { DifficultyItem } from '../shared/DifficultiesCard'
import type { LearningGap } from '../../../services/teacher'

type Translate = (key: string, params?: Record<string, string | number>) => string

export function gapToDifficultyItem(
  gap: LearningGap, t: Translate, note: string | null = null,
): DifficultyItem {
  return {
    id: gap.objective_id,
    title: gap.label,
    subtitle: gap.with_evidence
      ? `${t('tch.gaps.sentence.gap', {
          count: gap.struggling_count, tried: gap.with_evidence,
        })} ${t('tch.gaps.classSize', { size: gap.group_size })}`
      : t('tch.gaps.noneTried'),
    /* NO tooltip of misconception tags.
     *
     * It printed `sample_misconceptions` verbatim — "off-by-one · place-value ·
     * sign-error" — into a Hebrew interface. Those are not copy: they arrive
     * from the content vendor's xAPI extension (`events.py`, `ext["misconception"]`),
     * so the vocabulary is open-ended, unlocalised and outside our control.
     * Translating them is not possible in general and dropping the unknown ones
     * would leave a tooltip that silently says less than it seems to.
     *
     * Nothing is lost that a teacher is owed: the tags are still in the raw
     * evidence behind "למה?", which is the disclosure MoE C4 actually requires.
     * Machine identifiers belong there, not in a hover on a headline. */
    subjectLabel: gap.subject ?? null,
    learnerIds: gap.learner_ids ?? [],
    evidence: {
      struggling_count: gap.struggling_count,
      mastered_count: gap.mastered_count,
      with_evidence: gap.with_evidence,
      group_size: gap.group_size,
      /* The vendor's misconception tags, in the raw layer where the comment
         above promises them — machine identifiers belong here, not in copy. */
      sample_misconceptions: gap.evidence?.sample_misconceptions ?? [],
    },
    seed: {
      title: t('tch.gaps.taskTitle', { label: gap.label }),
      topic: gap.label,
      objectiveId: gap.objective_id,
      learnerIds: gap.learner_ids ?? [],
    },
    subgroupName: gap.label,
    split: {
      struggling: gap.struggling_count,
      mastered: gap.mastered_count,
      tried: gap.with_evidence,
      groupSize: gap.group_size,
    },
    note,
  }
}

/* The one topic holding the class back most — the KPI that answers "what do I
 * teach next" rather than "how many are struggling".
 *
 * Ranked by how much of the class is stuck on it, not by raw head-count: in a
 * split class an objective 12 of 15 struggle with matters more than one 14 of
 * 41 do. Ties break toward the topic with more corroborating evidence, so the
 * tile prefers the gap the teacher can actually see the working for (C4), and
 * a gap nobody has attempted yet never wins — with no evidence behind it, it
 * is a guess, and a dashboard that names the wrong topic costs a lesson.
 */
export function mostBlockingGap(gaps: LearningGap[]): LearningGap | null {
  const candidates = gaps.filter(
    (gap) => gap.kind === 'gap' && gap.with_evidence > 0 && gap.struggling_count > 0)
  if (candidates.length === 0) return null
  return candidates.reduce((worst, gap) => {
    if (gap.struggle_share !== worst.struggle_share) {
      return gap.struggle_share > worst.struggle_share ? gap : worst
    }
    return gap.with_evidence > worst.with_evidence ? gap : worst
  })
}
