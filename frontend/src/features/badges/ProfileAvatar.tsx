import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Badge } from '../../components/Badge'
import { getLearnerState } from '../../services/api'
import type { AvatarChoice } from './types'

/** Fired after the avatar choice is saved, so every ProfileAvatar refreshes. */
export const AVATAR_UPDATED_EVENT = 'yuvilab:avatar-updated'

export function announceAvatarUpdated(choice: AvatarChoice) {
  window.dispatchEvent(new CustomEvent(AVATAR_UPDATED_EVENT, { detail: choice }))
}

function coerce(raw: unknown): AvatarChoice {
  if (raw && typeof raw === 'object' && 'kind' in raw) {
    const kind = (raw as { kind?: string }).kind
    if (kind === 'badge' || kind === 'yuvi' || kind === 'initial') return raw as AvatarChoice
  }
  return { kind: 'initial' }
}

/**
 * Reads the current avatar choice from `learner_state.avatar` and keeps it in
 * sync — an initial fetch plus a live update whenever the picker saves. Decoupled
 * from any provider so it can be dropped into the app bar or the shelf.
 */
export function useAvatarChoice(): AvatarChoice {
  const [choice, setChoice] = useState<AvatarChoice>({ kind: 'initial' })

  useEffect(() => {
    let alive = true
    getLearnerState()
      .then((state) => { if (alive) setChoice(coerce(state.avatar)) })
      .catch(() => { /* logged-out / not ready — keep the initial */ })

    const onUpdate = (e: Event) => setChoice(coerce((e as CustomEvent).detail))
    window.addEventListener(AVATAR_UPDATED_EVENT, onUpdate)
    return () => { alive = false; window.removeEventListener(AVATAR_UPDATED_EVENT, onUpdate) }
  }, [])

  return choice
}

export interface ProfileAvatarProps {
  /** shown when no badge is chosen (e.g. the user's initials). */
  fallback: ReactNode
  className?: string
  /** override the fetched choice (e.g. a preview on the shelf). */
  choice?: AvatarChoice
  size?: number
}

/**
 * The one place the profile picture is resolved: a mini badge coin when the
 * learner picked one, else the fallback (initials). Drop it wherever the avatar
 * shows so a chosen badge appears everywhere consistently.
 */
export function ProfileAvatar({ fallback, className, choice, size }: ProfileAvatarProps) {
  const fetched = useAvatarChoice()
  const active = choice ?? fetched
  if (active.kind === 'badge') {
    return (
      <span className={className} style={size ? { width: size, height: size } : undefined}>
        <Badge subject={active.badge.subject} glyph={active.badge.glyph} tier={active.badge.tier} state="earned" mini />
      </span>
    )
  }
  return <span className={className}>{fallback}</span>
}
