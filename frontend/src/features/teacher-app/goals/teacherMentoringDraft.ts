/* The teacher's in-progress write-up, kept on the server.
 *
 * Mirrors what the learner composer does with `learner_state.mentoring_draft`
 * (MentoringPage.tsx): flush immediately when it closes, debounce while it is
 * open. Not `localStorage` — a record of a conversation with a child should
 * survive the device it was typed on, and a teacher who started on the laptop
 * in the staffroom should find it on the one in the classroom.
 *
 * ONE draft per teacher, not one per student. That is the same model the
 * learner side uses, and it keeps the resume question answerable: opening the
 * composer for a different child while a draft is open asks whether to resume
 * or discard, rather than silently keeping a pile of half-written records.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  getTeacherState, updateTeacherState, type TeacherMentoringDraft,
} from '../../../services/teacher'

/** Long enough that typing does not stream to the server, short enough that a
 *  closed laptop loses a sentence rather than a paragraph. */
const DEBOUNCE_MS = 600

export function emptyDraft(learnerId: string, draftId: string): TeacherMentoringDraft {
  return {
    open: true,
    draft_id: draftId,
    learner_id: learnerId,
    step: 0,
    notes: '',
    teacher_only_note: '',
    meeting_stage: '',
    goals: [],
    qa: [],
  }
}

/** A fresh idempotency key. `crypto.randomUUID` is unavailable over plain HTTP
 *  on some browsers, so there is a fallback — an id that never arrives would
 *  turn a double-click into two conversations. */
export function newDraftId(): string {
  const uuid = globalThis.crypto?.randomUUID?.()
  return uuid || `d_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

export function useMentoringDraft() {
  const [draft, setDraft] = useState<TeacherMentoringDraft | null>(null)
  const [loaded, setLoaded] = useState(false)
  /** Who is signed in. It arrives with the draft, so asking for it costs
   *  nothing — and the history needs it to know which write-ups are this
   *  teacher's to remove. */
  const [teacherId, setTeacherId] = useState('')
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => {
    let active = true
    getTeacherState()
      .then((state) => {
        if (!active) return
        setDraft(state.mentoring_draft ?? null)
        setTeacherId(state.teacher_id || '')
      })
      .catch(() => {})
      .finally(() => { if (active) setLoaded(true) })
    return () => {
      active = false
      window.clearTimeout(timer.current)
    }
  }, [])

  /** Keep the draft locally now, and on the server soon. Writes are
   *  fire-and-forget: a teacher must never be blocked from typing because a
   *  save is in flight, and the next keystroke retries anyway. */
  const persist = useCallback((next: TeacherMentoringDraft | null) => {
    setDraft(next)
    window.clearTimeout(timer.current)
    if (next === null || !next.open) {
      // Flushed immediately, so a fast reload does not re-open a composer the
      // teacher just closed.
      updateTeacherState({ mentoring_draft: next }).catch(() => {})
      return
    }
    timer.current = window.setTimeout(
      () => { updateTeacherState({ mentoring_draft: next }).catch(() => {}) },
      DEBOUNCE_MS,
    )
  }, [])

  const clear = useCallback(() => { persist(null) }, [persist])

  return { draft, loaded, teacherId, persist, clear }
}
