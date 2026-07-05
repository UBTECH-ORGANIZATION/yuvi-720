export interface ProfileStrength {
  icon: string
  label: string
  desc: string
}

export interface ProfileImprove {
  icon: string
  label: string
  tip?: string
  desc?: string
}

export interface Profile {
  hero_message?: string
  strengths?: ProfileStrength[]
  improve?: ProfileImprove[]
  tips?: string[]
}

export interface MappingResults {
  student_name?: string
  scores?: Record<string, unknown>
}
