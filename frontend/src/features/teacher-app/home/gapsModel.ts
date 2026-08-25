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

export function gapToDifficultyItem(gap: LearningGap, t: Translate): DifficultyItem {
  return {
    id: gap.objective_id,
    title: gap.label,
    subtitle: gap.with_evidence
      ? `${t('tch.gaps.sentence.gap', {
          count: gap.struggling_count, tried: gap.with_evidence,
        })} ${t('tch.gaps.classSize', { size: gap.group_size })}`
      : t('tch.gaps.noneTried'),
    tooltip: gap.evidence?.sample_misconceptions?.length
      ? gap.evidence.sample_misconceptions.map(([tag]) => tag).join(' · ')
      : undefined,
    learnerIds: gap.learner_ids ?? [],
    evidence: {
      struggling_count: gap.struggling_count,
      mastered_count: gap.mastered_count,
      with_evidence: gap.with_evidence,
      group_size: gap.group_size,
    },
    seed: {
      title: t('tch.gaps.taskTitle', { label: gap.label }),
      topic: gap.label,
      objectiveId: gap.objective_id,
      learnerIds: gap.learner_ids ?? [],
    },
    subgroupName: gap.label,
  }
}
