export interface QuestionnaireOptionQuestion {
  id: number
  text: string
  dimension?: string
  type?: string
  options: string[]
}

export interface QuestionnairePart {
  id: string
  title: string
  subtitle?: string
  dimension?: string
  description?: string
  questions: QuestionnaireOptionQuestion[]
}

export interface QuestionnaireIntro {
  greeting: string
  description: string
  duration: string
}

export type LearnerGender = 'male' | 'female'

export interface Questionnaire {
  title: string
  language?: string
  gender?: LearnerGender
  intro: QuestionnaireIntro
  parts: QuestionnairePart[]
}

export interface ChatMessage {
  role: 'assistant' | 'user'
  content: string
}

export interface QuestionLocation {
  partIndex: number
  partTitle: string
}