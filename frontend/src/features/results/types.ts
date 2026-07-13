export type ProfileClaimCategory = 'strength' | 'characteristic' | 'preference' | 'interest' | 'support'
export type ProfileFeedbackVerdict = 'accurate' | 'unsure' | 'inaccurate'

export interface ProfileClaim {
  id: string
  source_id: string
  category: ProfileClaimCategory
  title: string
  description: string
  icon_key: string
  evidence_label: string
  feedback_status?: ProfileFeedbackVerdict | null
}

export interface ProfileSummary {
  hero_message: string
  claims: ProfileClaim[]
}

export interface MappingResults {
  student_name?: string
  scores?: Record<string, unknown>
}
