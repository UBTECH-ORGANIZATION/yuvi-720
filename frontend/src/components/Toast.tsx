import { useEffect } from 'react'
import type { ReactNode } from 'react'
import '../styles/toast.css'

/**
 * Generic top-of-screen toast. Reusable for any transient announcement
 * (rewards, saves, tips…). Auto-dismisses and can carry one action button.
 */
export interface ToastProps {
  icon?: ReactNode
  title: string
  body?: string
  actionLabel?: string
  onAction?: () => void
  onDismiss: () => void
  dismissLabel?: string
  /** Auto-dismiss delay in ms (0 disables). Default 7000. */
  autoDismissMs?: number
  variant?: 'reward' | 'info' | 'success'
}

export function Toast({
  icon,
  title,
  body,
  actionLabel,
  onAction,
  onDismiss,
  dismissLabel = '✕',
  autoDismissMs = 7000,
  variant = 'info',
}: ToastProps) {
  useEffect(() => {
    if (!autoDismissMs) return
    const handle = window.setTimeout(onDismiss, autoDismissMs)
    return () => window.clearTimeout(handle)
  }, [autoDismissMs, onDismiss])

  return (
    <div className={`app-toast app-toast--${variant}`} role="status">
      {icon && <span className="app-toast__icon" aria-hidden>{icon}</span>}
      <div className="app-toast__text">
        <strong>{title}</strong>
        {body && <span>{body}</span>}
      </div>
      <div className="app-toast__actions">
        {actionLabel && onAction && (
          <button type="button" className="app-toast__cta" onClick={onAction}>{actionLabel}</button>
        )}
        <button type="button" className="app-toast__close" onClick={onDismiss} aria-label={dismissLabel}>✕</button>
      </div>
    </div>
  )
}
