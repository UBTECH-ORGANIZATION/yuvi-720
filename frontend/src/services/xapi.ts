/* xAPI client — the lesson host reports learning events to our LRS (§8.2).

   In production the content is a cross-origin iframe that POSTs these statements
   itself using the `slxapi` credentials we mint. Our reference lomda is
   same-origin, so the parent posts directly; the statement shapes + endpoints
   are identical, so swapping to a real provider iframe changes nothing here. */

import { apiPost } from './api'


const VERB_IRI_BASE = 'https://lxp.education.gov.il/xapi/moe/verbs/'
const ACTIVITY_IRI_BASE = 'https://lxp.education.gov.il/xapi/moe/activities/'

// MoE closed verb list (subset we emit) — never invent verbs.
export type MoeVerb =
  | 'enter' | 'exit' | 'attempted' | 'answered' | 'completed'
  | 'watched' | 'played' | 'paused' | 'read'
// MoE closed activity-type list (subset).
export type MoeActivityType =
  | 'question' | 'assignment' | 'onlinelesson' | 'video' | 'serious-game' | 'simulation'

export interface Slxapi {
  endpoint: string
  auth: string
  actor: { account: { name: string; homePage: string } }
}
export interface Launch {
  launch: string
  slxapi: Slxapi
}

export interface LaunchParams {
  objective_id?: string
  component_id?: string
  unit_id?: string
  subject?: string
}

/** Mint an slxapi launch context for a learner + objective/component. */
export function mintLaunch(params: LaunchParams): Promise<Launch> {
  return apiPost<Launch>('/api/xapi/launch', {
    ...params,
  })
}

export interface StatementParams {
  verb: MoeVerb
  objectId: string
  objectType: MoeActivityType
  success?: boolean
  scoreScaled?: number       // internal-only; never shown to the learner
  response?: string
  extensions?: Record<string, unknown>   // objective_id, subject, question_id, misconception, resume_token, is_assessment
}

/** Build a conformant xAPI statement (mandatory actor/verb/object). */
export function buildStatement(slxapi: Slxapi, p: StatementParams): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  if (p.success !== undefined) result.success = p.success
  if (p.response !== undefined) result.response = p.response
  if (p.scoreScaled !== undefined) result.score = { scaled: p.scoreScaled }

  const statement: Record<string, unknown> = {
    id: crypto.randomUUID(),
    actor: slxapi.actor,
    verb: { id: `${VERB_IRI_BASE}${p.verb}` },
    object: {
      id: p.objectId,
      definition: { type: `${ACTIVITY_IRI_BASE}${p.objectType}` },
    },
    context: { extensions: p.extensions ?? {} },
  }
  if (Object.keys(result).length) statement.result = result
  return statement
}

/** POST a statement to the LRS (content appends `statements` to the base URL). */
export async function postStatement(slxapi: Slxapi, statement: Record<string, unknown>): Promise<void> {
  try {
    await fetch(`${slxapi.endpoint}statements`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: slxapi.auth },
      body: JSON.stringify(statement),
    })
  } catch {
    // Retry policy is transparent to the learner and must not block the flow (§8.2).
    // A production provider queues + retries; the reference lomda drops silently.
  }
}

/** Convenience: build + post in one call. */
export function emit(slxapi: Slxapi, p: StatementParams): Promise<void> {
  return postStatement(slxapi, buildStatement(slxapi, p))
}
