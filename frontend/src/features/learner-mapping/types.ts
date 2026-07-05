export interface QuestionnaireOptionQuestion {
  id: number
  text: string
  dimension: string
  options: string[]
}

export interface QuestionnairePart {
  id: string
  title: string
  description?: string
  questions: QuestionnaireOptionQuestion[]
}

export interface Questionnaire {
  title: string
  intro: string
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