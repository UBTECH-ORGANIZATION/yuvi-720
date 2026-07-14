import type {
  LearningComponentDTO,
  LearningSubject,
  LearningUnitDTO,
} from '../../services/learning'

export interface LearningWorldLandmark {
  id: string
  unit: LearningUnitDTO
  component: LearningComponentDTO
  unitIndex: number
  stageIndex: number
  alternativeIndex: number
  displayIndex: number
  position: readonly [number, number, number]
}

export interface LearningWorldModel {
  subject: LearningSubject
  units: LearningUnitDTO[]
  landmarks: LearningWorldLandmark[]
  currentLandmarkId: string | null
  recommendedLandmarkId: string | null
}

function orderedComponents(unit: LearningUnitDTO) {
  return [...unit.components].sort((first, second) => (
    (first.order ?? Number.MAX_SAFE_INTEGER) - (second.order ?? Number.MAX_SAFE_INTEGER)
    || first.id.localeCompare(second.id)
  ))
}

/**
 * Presentation-only projection of provider units into stable world coordinates.
 * Provider order and Brain/xAPI progress remain untouched and authoritative.
 */
export function buildLearningWorldModel(
  catalogUnits: LearningUnitDTO[],
  subject: LearningSubject,
): LearningWorldModel {
  const units = catalogUnits.filter((unit) => unit.subject === subject)
  const landmarks: LearningWorldLandmark[] = []
  let displayIndex = 0

  units.forEach((unit, unitIndex) => {
    const components = orderedComponents(unit)
    const grouped = new Map<string, LearningComponentDTO[]>()
    components.forEach((component, componentIndex) => {
      const key = component.order == null ? `component:${componentIndex}` : `order:${component.order}`
      grouped.set(key, [...(grouped.get(key) ?? []), component])
    })

    const stages = [...grouped.values()]
    const districtX = unitIndex % 2 === 0 ? -4.4 : 4.4
    const districtZ = 4.5 - Math.floor(unitIndex / 2) * 10.5

    stages.forEach((stage, stageIndex) => {
      stage.forEach((component, alternativeIndex) => {
        const spread = stage.length <= 1 ? 0 : (alternativeIndex - (stage.length - 1) / 2) * 2.8
        const direction = unitIndex % 2 === 0 ? 1 : -1
        const curve = Math.sin(stageIndex * 1.15 + unitIndex * .7) * 1.15
        displayIndex += 1
        landmarks.push({
          id: component.id,
          unit,
          component,
          unitIndex,
          stageIndex,
          alternativeIndex,
          displayIndex,
          position: [districtX + spread + curve * direction, 0, districtZ - stageIndex * 3.35],
        })
      })
    })
  })

  const currentLandmark = landmarks.find(({ component }) => component.progress_state === 'current')
    ?? landmarks.find(({ unit, component }) => unit.current_component_id === component.id)
    ?? landmarks.find(({ component }) => component.progress_state === 'available')
    ?? [...landmarks].reverse().find(({ component }) => component.progress_state === 'completed')
    ?? null

  const recommendedLandmark = landmarks.find(({ unit, component }) => unit.next_component_id === component.id)
    ?? landmarks.find(({ component }) => component.progress_state === 'current')
    ?? landmarks.find(({ component }) => component.progress_state === 'available')
    ?? null

  return {
    subject,
    units,
    landmarks,
    currentLandmarkId: currentLandmark?.id ?? null,
    recommendedLandmarkId: recommendedLandmark?.id ?? null,
  }
}
